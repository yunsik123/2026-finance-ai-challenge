import fs from 'fs';
import path from 'path';

const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const CHAT_MODEL = (process.env.MOA_CHAT_MODEL && !['gpt-5.6-luna', 'luna'].includes(process.env.MOA_CHAT_MODEL))
  ? process.env.MOA_CHAT_MODEL
  : (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini');
const OCR_MODEL = (process.env.MOA_OCR_MODEL && !['claude-haiku-4-5-20251001', 'gpt-5.6-luna', 'luna'].includes(process.env.MOA_OCR_MODEL))
  ? process.env.MOA_OCR_MODEL
  : (process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini');
const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const MOA_DATA_SCOPE = `모아가 모집 심사 전에 실제로 받는 정보는 다음뿐입니다.
- 사업체 기본정보: 상호명, 업종, 사업자등록번호, 업력, 주소, 소개, 최근 월평균 매출
- 재무·위험 입력값: 최근 6개월 월별 매출, 월 영업현금흐름, 총 부채, 월 부채 상환액, 연체 횟수, 근로자 수, 세금 정상 납부 여부, 재방문율, 온라인 매출 비중, 유동인구·상권매출 증감률, 경쟁 밀도, 주변 폐업률
- 투자자 공개 확인 6항목: 최근 12개월 매출, 비용 구조, 부채와 상환 부담, 자금 사용계획, 주요 위험요인, 견적·계약 증빙
- 모집안: 제목, 목표 금액, 기간, 상세 자금 사용계획, 위험 대응계획, 2개 이상의 지급 단계와 합계 100%의 지급 비율
- 모집 공개 후 지급 단계 증빙: 해당 단계 조건에 맞는 세금계산서·영수증·매출전표·계약서·견적서·설치 완료 사진 등의 이미지

현재 구현은 재무제표, 최근 3개월 은행 거래 내역, 세금 신고서 파일을 필수 제출받지 않습니다. 사업자등록번호를 입력하고 운영자가 확인 상태를 기록하지만 사업자등록증 파일 업로드 기능은 없습니다. 세금 정상 납부 여부는 예/아니오 입력값이지 세금 신고서 업로드가 아닙니다.`;

export function isMissingSubmissionQuestion(message) {
  const text = String(message || '').replace(/\s+/g, ' ');
  return /(?:제출|자료|서류|항목).*(?:빠진|누락|부족|미제출|안\s*낸|안\s*한)/.test(text)
    || /(?:빠진|누락|부족|미제출).*(?:제출|자료|서류|항목)/.test(text);
}

function safeList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 30) : [];
}

export function formatMissingSubmissionAnswer(status) {
  if (!status || status.canDetermineOwnerMissingItems !== true) {
    return '현재 화면은 소상공인 본인의 저장 현황을 확인할 수 있는 상태가 아니어서 특정 사업의 누락 항목을 확정할 수 없습니다. 소상공인 계정으로 로그인해 다시 물으면 저장된 값과 필수 항목을 바로 대조합니다.\n\n모아는 재무제표, 최근 3개월 은행 거래 내역, 세금 신고서 파일을 필수 제출받지 않습니다. 사업자등록번호와 재무·위험 수치를 입력받고, 모집 공개 후에는 현재 지급 단계 조건에 맞는 증빙 이미지만 받습니다.';
  }

  const groups = [
    ['사업체 기본정보', safeList(status.business?.missing)],
    ['재무·위험 입력값', safeList(status.metrics?.missing)],
    ['투자자 공개 항목', safeList(status.disclosures?.missing)],
    ['모집안·지급 조건', safeList(status.campaign?.missing)]
  ].filter(([, items]) => items.length);
  const lines = groups.length
    ? ['현재 저장 상태에서 빠진 항목입니다.', ...groups.map(([name, items]) => `- ${name}: ${items.join(', ')}`)]
    : ['현재 저장 상태 기준으로 모집 심사 전 필수 입력값과 공개 항목에 누락이 없습니다.'];

  if (status.business?.saved && status.business?.verificationStatus !== 'verified') {
    lines.push('- 확인 상태: 사업자 정보는 저장됐지만 아직 운영자 확인 전입니다. 별도 사업자등록증 파일 업로드를 뜻하지 않습니다.');
  }
  if (status.execution?.requiredNow && status.execution?.currentMilestone) {
    const milestone = status.execution.currentMilestone;
    lines.push(`- 현재 지급 단계 증빙: “${milestone.title || '현재 단계'}”의 조건(${milestone.condition || '등록된 조건'})에 맞는 증빙 이미지가 필요합니다.`);
  }
  lines.push('', '재무제표, 최근 3개월 은행 거래 내역, 세금 신고서 파일은 현재 모아의 필수 제출 항목이 아닙니다. 세금 정상 납부 여부는 예/아니오 입력값으로만 받습니다.');
  return lines.join('\n');
}

export function buildChatSystemPrompt(context) {
  return `당신은 소상공인 펀딩 플랫폼 모아의 심사·이용 상담사입니다. 한국어로 짧고 명확하게 답하세요. 현재 컨텍스트의 수치와 상태를 근거로 사용하되, 확인된 사실·사업자 주장·AI 추정을 구분하세요. 투자자에게 사업의 강점뿐 아니라 허위 가능성, 현금흐름, 부채, 폐업, 정보 부족 위험과 추가 확인 자료를 함께 설명하세요. 자금 지급은 앞 단계 완료, 원본 증빙 승인, 확인된 예치 잔액을 모두 충족해야 한다는 원칙을 지키세요. 특정 참여를 지시하거나 수익을 보장하지 마세요.

${MOA_DATA_SCOPE}

중요 답변 규칙:
1. 제출 자료의 누락 여부는 컨텍스트의 “모아 제출 현황”만 근거로 판단하세요.
2. 현황을 확인할 수 없으면 어느 화면·권한 때문에 확인할 수 없는지 설명하고, 일반 금융기관 서류를 모아의 필수 자료처럼 나열하지 마세요.
3. 재무제표·은행 거래 내역·세금 신고서를 추가로 언급해야 할 때도 현재 모아의 구현 항목이 아니라고 분명히 밝히세요.
4. 모집 심사 전 입력·공시 항목과 모집 공개 후 마일스톤 증빙을 구분하세요.

현재 화면에서 전달된 미검증 정보:
${String(context || '').slice(0, 12000)}`;
}

function loadApiKey() {
  const envKey = (process.env.OPENAI_API_KEY || process.env.SGLLM_API_KEY || process.env.GPT_API_KEY || '').trim();
  if (envKey) return envKey;

  const candidateFiles = ['.env.gptapi', '.env.local', '.env', '.env.development.local'];
  for (const filename of candidateFiles) {
    try {
      const fullPath = path.resolve(process.cwd(), filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8').trim();
        if (content.startsWith('sk-')) return content.split(/\s+/)[0].trim();
        const match = content.match(/(?:OPENAI_API_KEY|SGLLM_API_KEY|GPT_API_KEY)\s*=\s*["']?([^"'\r\n]+)["']?/);
        if (match && match[1]) return match[1].trim();
      }
    } catch {}
  }
  return '';
}

function jsonBlock(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return { rawText: text };
}

async function callOpenAi(payload) {
  const apiKey = loadApiKey();
  if (!apiKey) {
    throw Object.assign(new Error('OpenAI API 키가 필요합니다. Vercel 환경변수 OPENAI_API_KEY 또는 .env.gptapi 파일을 확인해 주세요.'), { status: 503 });
  }
  const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = data?.error?.message || data?.message || `OpenAI API 오류 (${response.status})`;
    throw Object.assign(new Error(errorMsg), { status: response.status >= 500 ? 502 : response.status });
  }
  return data;
}

async function currentUser(authorization) {
  if (!authorization || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: authorization } });
  return response.ok ? response.json() : null;
}

async function currentProfile(user, authorization) {
  if (!user || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,role&id=eq.${user.id}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: authorization } }
  );
  const rows = response.ok ? await response.json() : [];
  return rows[0] || null;
}

async function saveOcr(user, authorization, filename, plan, result, model) {
  if (!user || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const commonHeaders = { apikey: SUPABASE_KEY, Authorization: authorization, 'Content-Type': 'application/json' };
  const businessResponse = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=id&user_id=eq.${user.id}&limit=1`, { headers: commonHeaders });
  const businesses = businessResponse.ok ? await businessResponse.json() : [];
  const response = await fetch(`${SUPABASE_URL}/rest/v1/ocr_analyses?select=id`, {
    method: 'POST', headers: { ...commonHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: user.id, business_id: businesses[0]?.id || null, filename, plan, result, model })
  });
  const rows = response.ok ? await response.json() : [];
  return rows[0]?.id || null;
}

async function handleChat(body) {
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12).filter(item => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string').map(item => ({ role: item.role, content: item.content.slice(0, 4000) })) : [];
  if (!messages.length) throw Object.assign(new Error('대화 내용이 필요합니다.'), { status: 400 });
  const context = String(body.context || '').slice(0, 12000);
  const latestQuestion = [...messages].reverse().find(item => item.role === 'user')?.content || '';
  if (isMissingSubmissionQuestion(latestQuestion)) {
    return {
      ok: true,
      message: formatMissingSubmissionAnswer(body.submissionStatus),
      model: 'moa-submission-rules-v1'
    };
  }
  const system = buildChatSystemPrompt(context);
  const result = await callOpenAi({
    model: CHAT_MODEL,
    messages: [{ role: 'system', content: system }, ...messages],
    max_tokens: 1200,
    temperature: 0.3
  });
  return {
    ok: true,
    message: result?.choices?.[0]?.message?.content || '답변을 생성하지 못했습니다.',
    model: result.model || CHAT_MODEL,
    usage: result.usage
  };
}

async function handleOcr(body, authorization) {
  const match = String(body.image || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw Object.assign(new Error('PNG, JPG 또는 WebP 이미지만 분석할 수 있습니다.'), { status: 400 });
  const estimatedBytes = Math.floor(match[2].replace(/\s/g, '').length * .75);
  if (!estimatedBytes || estimatedBytes > 6 * 1024 * 1024) throw Object.assign(new Error('이미지는 6MB 이하여야 합니다.'), { status: 400 });
  const user = await currentUser(authorization);
  if (!user) throw Object.assign(new Error('소상공인 로그인이 필요합니다.'), { status: 401 });
  const profile = await currentProfile(user, authorization);
  if (profile?.role !== 'owner') throw Object.assign(new Error('소상공인 계정에서만 증빙을 분석할 수 있습니다.'), { status: 403 });
  const plan = String(body.plan || '등록된 사업계획 없음').slice(0, 2000);
  const prompt = `소상공인이 제출한 매출전표·영수증·세금계산서 이미지를 보이는 내용만 판독하세요. 승인 사용계획: ${plan}. JSON만 반환: {"documentType":"영수증|세금계산서|매출전표|계약서|기타","merchant":"","businessNumber":"","date":"","items":[{"name":"","quantity":1,"amount":0}],"subtotal":0,"tax":0,"total":0,"paymentMethod":"","planMatch":"적합|검토 필요|부적합","confidence":0,"warnings":[],"rawText":""}. OCR은 지급 승인이 아니며 읽을 수 없는 값은 추측하지 마세요.`;
  const result = await callOpenAi({
    model: OCR_MODEL,
    messages: [
      { role: 'system', content: '당신은 한국어 사업 증빙 OCR 검증 보조자입니다. 보이는 정보만 JSON으로 구조화하세요.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${match[1]};base64,${match[2]}` } }
        ]
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500,
    temperature: 0.1
  });
  const text = result?.choices?.[0]?.message?.content || '';
  if (!text) throw Object.assign(new Error('OCR 결과가 비어 있습니다.'), { status: 502 });
  const structured = jsonBlock(text);
  structured.warnings = Array.isArray(structured.warnings) ? structured.warnings : [];
  const model = result.model || OCR_MODEL;
  const analysisId = await saveOcr(user, authorization, String(body.filename || '').slice(0, 255), plan, structured, model);
  return { ok: true, result: structured, model, analysisId };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'POST 요청만 지원합니다.' });
  try {
    const mode = String(request.query.mode || '');
    const result = mode === 'chat' ? await handleChat(request.body || {}) : mode === 'ocr' ? await handleOcr(request.body || {}, request.headers.authorization || '') : null;
    if (!result) return response.status(404).json({ ok: false, error: 'AI 경로를 찾을 수 없습니다.' });
    return response.status(200).json(result);
  } catch (error) {
    return response.status(error.status || 500).json({ ok: false, error: error.message || 'AI 처리 중 오류가 발생했습니다.' });
  }
}
