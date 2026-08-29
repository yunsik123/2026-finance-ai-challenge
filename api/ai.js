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
  const system = `당신은 지역 소상공인 펀딩 플랫폼 모아의 근거 중심 상담사입니다. 한국어로 답하세요. DB 지식그래프/평가 컨텍스트가 있으면 해당 노드, 관계, 수치를 근거로 사용하고 부족자료를 명시하세요. 투자자에게 장점과 손실·폐업·정보부족 위험을 같은 비중으로 설명하세요. 특정 투자를 지시하거나 수익을 보장하지 마세요. 설명용 성장등급은 공식 SCB가 아니라고 밝히세요.\n\n검증되지 않은 현재 컨텍스트:\n${context}`;
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
  structured.warnings.push('OpenAI Vision(gpt-4o-mini)을 사용하여 증빙을 분석했습니다.');
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
