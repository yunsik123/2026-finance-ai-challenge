import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { normalizeOcrBoxes, orchestrateFinancialVerification } from '../src/financial-verification.js';
import { answerRoleProcessQuestion, serializeKnowledgeGraph } from '../src/knowledge-graph.js';

const OPENAI_BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const CHAT_MODEL = (process.env.MOA_CHAT_MODEL && !['gpt-5.6-luna', 'luna'].includes(process.env.MOA_CHAT_MODEL))
  ? process.env.MOA_CHAT_MODEL
  : (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini');
const OCR_MODEL = (process.env.MOA_OCR_MODEL && !['claude-haiku-4-5-20251001', 'gpt-5.6-luna', 'luna'].includes(process.env.MOA_OCR_MODEL))
  ? process.env.MOA_OCR_MODEL
  : (process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini');
const SUPABASE_URL = String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const MOA_DATA_SCOPE = `모아가 모집 심사 전에 실제로 받는 정보는 다음뿐입니다.
- 사업체 기본정보: 상호명, 업종, 사업자등록번호, 업력, 주소, 소개, 최근 월평균 매출
- 재무·위험 입력값: 최근 6개월 월별 매출, 월 영업현금흐름, 총 부채, 월 부채 상환액, 연체 횟수, 근로자 수, 세금 정상 납부 여부, 재방문율, 온라인 매출 비중, 유동인구·상권매출 증감률, 경쟁 밀도, 주변 폐업률. 이 값은 입력 직후에는 사업자 주장이다.
- 모집 전 재무 검증자료: POS·카드매출 내역, 부채·월 상환 내역, 납세 확인 자료 이미지. OCR 교차검증과 운영자 원본 승인 후에만 공식 심사로 승격된다.
- 투자자 공개 확인 6항목: 최근 12개월 매출, 비용 구조, 부채와 상환 부담, 자금 사용계획, 주요 위험요인, 견적·계약 증빙
- 모집안: 제목, 목표 금액, 기간, 상세 자금 사용계획, 위험 대응계획, 2개 이상의 지급 단계와 합계 100%의 지급 비율
- 모집 공개 후 지급 단계 증빙: 해당 단계 조건에 맞는 세금계산서·영수증·매출전표·계약서·견적서·설치 완료 사진 등의 이미지

재무제표와 최근 3개월 은행 거래 내역은 보조자료이며 필수자료는 아닙니다. 사업자등록번호를 입력하고 운영자가 확인 상태를 기록하지만 사업자등록증 파일 업로드 기능은 아직 없습니다. 세금 정상 납부 여부는 예/아니오 입력값입니다.`;

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
  if (status.metrics?.saved && status.metrics?.verificationStatus !== 'approved') {
    lines.push(`- 재무 검증 상태: ${status.metrics?.verificationStatus || 'not_started'} — 입력 수치는 아직 공식 심사 자료가 아닙니다.`);
    if (status.metrics?.verificationMissingDocuments?.length) lines.push('- 부족한 재무 근거자료: ' + status.metrics.verificationMissingDocuments.join(', '));
    if (status.metrics?.verificationMismatches?.length) lines.push('- 확인할 불일치: ' + status.metrics.verificationMismatches.join(', '));
  }
  if (status.execution?.requiredNow && status.execution?.currentMilestone) {
    const milestone = status.execution.currentMilestone;
    lines.push(`- 현재 지급 단계 증빙: “${milestone.title || '현재 단계'}”의 조건(${milestone.condition || '등록된 조건'})에 맞는 증빙 이미지가 필요합니다.`);
  }
  lines.push('', '재무 수치는 먼저 사업자 주장으로 저장됩니다. 공식 심사에는 POS·카드매출, 부채·상환, 납세 확인 자료의 OCR 교차검증과 운영자 승인이 필요합니다. 재무제표와 최근 3개월 은행 거래 내역은 필수 제출 항목이 아닙니다.');
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
5. 역할별 지식그래프의 순서와 현재 상태를 우선 사용하고, 그래프에 없는 절차를 지어내지 마세요.

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
  const graphAnswer = answerRoleProcessQuestion(latestQuestion, body.knowledgeGraph);
  if (graphAnswer) return { ok: true, message: graphAnswer, model: 'moa-role-knowledge-graph-v1' };
  const graphContext = serializeKnowledgeGraph(body.knowledgeGraph, latestQuestion);
  const system = buildChatSystemPrompt(context + '\n역할별 지식그래프 검색 결과:\n' + graphContext);
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

function imagePayload(value) {
  const match = String(value || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  const base64 = match[2].replace(/\s/g, '');
  return { mime: match[1], base64, bytes: Math.floor(base64.length * .75) };
}

async function saveFinancialVerification(user, authorization, business, claims, documents, orchestration, model) {
  if (!user || !business || !SUPABASE_URL || !SUPABASE_KEY) return null;
  if (!SUPABASE_SERVICE_KEY) {
    throw Object.assign(new Error('재무검증 서버 저장 권한이 설정되지 않았습니다. SUPABASE_SERVICE_ROLE_KEY를 서버 환경변수로 등록해 주세요.'), { status: 503 });
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/financial_verification_runs?select=*`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: user.id, business_id: business.id, claimed_metrics: claims,
      document_results: documents, orchestration, model, status: orchestration.recommendedStatus
    })
  });
  const rows = response.ok ? await response.json() : [];
  if (!response.ok) throw Object.assign(new Error('재무 검증 결과를 저장하지 못했습니다.'), { status: 502 });
  return rows[0] || null;
}

async function handleFinancialVerification(body, authorization) {
  const user = await currentUser(authorization);
  if (!user) throw Object.assign(new Error('소상공인 로그인이 필요합니다.'), { status: 401 });
  const profile = await currentProfile(user, authorization);
  if (profile?.role !== 'owner') throw Object.assign(new Error('소상공인 계정에서만 재무자료를 검증할 수 있습니다.'), { status: 403 });
  const rawDocuments = Array.isArray(body.documents) ? body.documents.slice(0, 6) : [];
  if (rawDocuments.length < 1) throw Object.assign(new Error('검증할 재무자료 이미지를 선택해 주세요.'), { status: 400 });
  const parsed = rawDocuments.map(item => ({ ...item, parsed: imagePayload(item.image) }));
  if (parsed.some(item => !item.parsed || !item.parsed.bytes || item.parsed.bytes > 6 * 1024 * 1024)) {
    throw Object.assign(new Error('각 파일은 PNG, JPG, WebP 형식의 6MB 이하여야 합니다.'), { status: 400 });
  }
  if (parsed.reduce((sum, item) => sum + item.parsed.bytes, 0) > 20 * 1024 * 1024) {
    throw Object.assign(new Error('한 번에 분석할 파일의 합계는 20MB 이하여야 합니다.'), { status: 400 });
  }
  const headers = { apikey: SUPABASE_KEY, Authorization: authorization };
  const businessResponse = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=*&user_id=eq.${user.id}&limit=1`, { headers });
  const businesses = businessResponse.ok ? await businessResponse.json() : [];
  const business = businesses[0];
  if (!business) throw Object.assign(new Error('사업체 정보를 먼저 저장해 주세요.'), { status: 400 });
  const metricsResponse = await fetch(`${SUPABASE_URL}/rest/v1/business_metrics?select=*&business_id=eq.${business.id}&limit=1`, { headers });
  const metricRows = metricsResponse.ok ? await metricsResponse.json() : [];
  const metrics = metricRows[0];
  if (!metrics) throw Object.assign(new Error('사업자 주장 수치를 먼저 저장해 주세요.'), { status: 400 });
  // 요청 본문의 숫자를 신뢰하지 않고 DB에 저장된 최신 사업자 주장만 검증 기준으로 사용한다.
  const claims = {
    sales6m: metrics.sales_6m || [], cardSales6m: metrics.card_sales_6m || [], cashSales6m: metrics.cash_sales_6m || [],
    operatingCashFlow: Number(metrics.operating_cash_flow || 0), debtTotal: Number(metrics.debt_total || 0),
    monthlyDebtPayment: Number(metrics.monthly_debt_payment || 0), overdueCount: Number(metrics.overdue_count || 0),
    employeeCount: Number(metrics.employee_count || 0), taxCompliant: Boolean(metrics.tax_compliant),
    monthlyFixedCost: Number(metrics.monthly_fixed_cost || 0), monthlyRent: Number(metrics.monthly_rent || 0),
    monthlyLaborCost: Number(metrics.monthly_labor_cost || 0), monthlyMaterialCost: Number(metrics.monthly_material_cost || 0)
  };
  const content = [{ type: 'text', text: `아래 문서들은 소상공인이 입력한 재무수치의 근거자료입니다. 각 이미지를 독립적으로 분류하고 보이는 값만 추출하세요. 사업자등록번호 ${business.business_number}. 사업자 주장 ${JSON.stringify(claims).slice(0, 5000)}. JSON만 반환: {"documents":[{"index":0,"filename":"","documentType":"POS 매출내역|카드매출내역|부채 상환내역|납세증명|은행 거래내역|기타","businessNumber":"","representativeName":"","periodStart":"","periodEnd":"","date":"","monthlySales":[],"debtTotal":null,"monthlyDebtPayment":null,"taxCompliant":null,"operatingCashFlow":null,"confidence":0,"warnings":[],"boundingBoxes":[{"field":"businessNumber|date|monthlySales|debtTotal|monthlyDebtPayment|taxCompliant|operatingCashFlow","label":"사업자번호","value":"","bbox":[0,0,0,0],"confidence":0}]}]}. bbox는 이미지 왼쪽 위를 원점으로 한 0~1000 정규화 [x,y,width,height]입니다. 확실히 읽은 핵심 필드만 박스로 표시하고, 읽히지 않는 값은 null 또는 빈 배열로 두며 추측하지 마세요.` }];
  parsed.forEach((item, index) => {
    content.push({ type: 'text', text: `문서 ${index}: ${String(item.filename || `document-${index + 1}`).slice(0, 200)}` });
    content.push({ type: 'image_url', image_url: { url: `data:${item.parsed.mime};base64,${item.parsed.base64}` } });
  });
  const result = await callOpenAi({
    model: OCR_MODEL,
    messages: [{ role: 'system', content: '당신은 한국 소상공인 재무자료 OCR 추출기입니다. 문서별 식별값·기간·금액을 보이는 그대로 구조화하고 판단은 하지 않습니다.' }, { role: 'user', content }],
    response_format: { type: 'json_object' }, max_tokens: 3000, temperature: .1
  });
  const structured = jsonBlock(result?.choices?.[0]?.message?.content || '');
  const extracted = Array.isArray(structured.documents) ? structured.documents.slice(0, parsed.length) : [];
  const documents = parsed.map((item, index) => ({
    ...(extracted.find(document => Number(document.index) === index) || {}), index,
    filename: String(item.filename || `document-${index + 1}`).slice(0, 255),
    contentFingerprint: crypto.createHash('sha256').update(item.parsed.base64).digest('hex'),
    boundingBoxes: normalizeOcrBoxes(extracted.find(document => Number(document.index) === index)?.boundingBoxes)
  }));
  const orchestration = orchestrateFinancialVerification({
    claims, documents,
    business: { number: business.business_number, representativeName: business.representative_name }
  });
  const model = result.model || OCR_MODEL;
  const saved = await saveFinancialVerification(user, authorization, business, claims, documents, orchestration, model);
  return { ok: true, verification: saved, documents, orchestration, model };
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
  const prompt = `소상공인이 제출한 매출전표·영수증·세금계산서 이미지를 보이는 내용만 판독하세요. 승인 사용계획: ${plan}. JSON만 반환: {"documentType":"영수증|세금계산서|매출전표|계약서|기타","merchant":"","businessNumber":"","date":"","items":[{"name":"","quantity":1,"amount":0}],"subtotal":0,"tax":0,"total":0,"paymentMethod":"","planMatch":"적합|검토 필요|부적합","confidence":0,"warnings":[],"rawText":"","boundingBoxes":[{"field":"merchant|businessNumber|date|total|item","label":"공급자","value":"","bbox":[0,0,0,0],"confidence":0}]}. bbox는 0~1000 정규화 [x,y,width,height]로 확실히 읽은 핵심 필드만 표시하세요. OCR은 지급 승인이 아니며 읽을 수 없는 값은 추측하지 마세요.`;
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
  structured.boundingBoxes = normalizeOcrBoxes(structured.boundingBoxes);
  const model = result.model || OCR_MODEL;
  const analysisId = await saveOcr(user, authorization, String(body.filename || '').slice(0, 255), plan, structured, model);
  return { ok: true, result: structured, model, analysisId };
}

export function generateFallbackStoreStory({ name = '가게', category = '한식', address = '', keywords = '' }) {
  const storeName = name || '저희 매장';
  const region = address ? address.split(' ').slice(0, 2).join(' ') : '우리 동네';
  const safeKeywords = String(keywords || '').split(/[,\n]/).map(value => value.trim()).filter(Boolean).slice(0, 5);
  return {
    description: `${storeName}은(는) ${region}에 등록한 ${category} 사업체입니다.${safeKeywords.length ? ` 사업자가 입력한 특징은 ${safeKeywords.join(', ')}입니다.` : ' 게시 전에 실제 강점과 운영 현황을 사업자가 직접 보완해야 합니다.'}`,
    ownerStory: '',
    highlights: [`#${storeName.replace(/\s+/g, '')}`, `#${category.replace(/\s+/g, '')}`, ...safeKeywords.map(value => '#' + value.replace(/\s+/g, ''))],
    menuItems: [],
    requiresOwnerConfirmation: true
  };

  if (category === '카페' || category === '디저트') {
    return {
      description: `${region}에서 직접 엄선한 스페셜티 생두를 매일 로스팅하며, 향긋한 커피와 수제 디저트를 선보이는 로스터리 카페 ${storeName}입니다.`,
      ownerStory: `${region}의 조용한 골목에서 손님들께 일상의 작은 휴식과 위로를 전하고자 문을 열었습니다. 매일 아침 새벽부터 기후와 생두 상태를 점검하며 최적의 로스팅 프로파일을 연구합니다. 단골분들의 하루 시작을 책임진다는 자부심으로, 언제나 한결같이 신선하고 깊은 풍미의 커피를 약속드립니다.`,
      highlights: [`#${storeName.replace(/\s+/g, '')}`, '#스페셜티로스터리', '#핸드드립전문', '#수제디저트페어링', '#단골아지트'],
      menuItems: [
        { name: '시그니처 하우스 블렌드 핸드드립', price: 6500, description: '다크초콜릿의 묵직함과 헤이즐넛의 고소한 단맛이 어우러진 대표 커피', isSignature: true, category: '핸드드립' },
        { name: '스페셜티 싱글오리진 필터커피', price: 7000, description: '화사한 꽃향기와 은은한 과일 산미가 매력적인 시즌 한정 원두', isSignature: true, category: '핸드드립' },
        { name: '수제 바닐라빈 까눌레', price: 3800, description: '천연 바닐라빈을 듬뿍 넣어 겉은 바삭하고 속은 촉촉한 매일 아침 구워내는 구움과자', isSignature: false, category: '디저트' },
        { name: '이달의 로스터리 구독 원두 (200g)', price: 16000, description: '집에서도 카페의 맛을 그대로 즐길 수 있는 신선한 원두 정기 패키지', isSignature: false, category: '원두' }
      ]
    };
  }

  if (category === '양식' || category === '이탈리안') {
    return {
      description: `${region}에서 매일 아침 유기농 밀가루로 직접 제면하는 생면 파스타와 신선한 제철 요리를 선보이는 감성 레스토랑 ${storeName}입니다.`,
      ownerStory: `건면에서는 느낄 수 없는 생면 고유의 쫄깃한 식감과 계절 식재료의 본연의 맛을 한 접시에 담아내고 있습니다. 소중한 사람들과 특별한 추억을 나눌 수 있는 따뜻한 식탁을 꿈꾸며, 정직한 재료와 정성으로 음식을 만듭니다.`,
      highlights: [`#${storeName.replace(/\s+/g, '')}`, '#자가제면파스타', '#서촌핫플', '#와인페어링', '#데이트명소'],
      menuItems: [
        { name: '트러플 크림 생면 타야린', price: 24000, description: '직접 뽑은 쫄깃한 생면에 고급 트러플 버터와 크림 소스를 곁들인 시그니처', isSignature: true, category: '파스타' },
        { name: '진한 비프 라구 파파르델레', price: 22000, description: '장시간 뭉근하게 끓여낸 소고기 라구 소스와 넓은 생면 파스타', isSignature: true, category: '파스타' },
        { name: '숙성 한우 채끝 스테이크 (200g)', price: 45000, description: '최상급 한우를 저온 숙성하여 숯불 향을 입힌 대표 메인 요리', isSignature: false, category: '스테이크' },
        { name: '수제 클래식 티라미수', price: 8500, description: '마스카포네 치즈와 에스프레소의 조화가 일품인 수제 디저트', isSignature: false, category: '디저트' }
      ]
    };
  }

  return {
    description: `${region}에서 신선한 제철 로컬 식재료와 정갈한 손맛으로 오랜 단골들의 든든한 한 끼를 책임져온 ${storeName}입니다.`,
    ownerStory: `어릴 적 어머니가 차려주시던 따뜻한 집밥처럼, 매일 먹어도 속이 편안하고 든든한 밥상을 차리는 것이 저희의 신념입니다. 유행에 흔들리지 않고 좋은 식재료만을 고집하며, 찾아주시는 모든 손님들을 가족처럼 정성껏 모시겠습니다.`,
    highlights: [`#${storeName.replace(/\s+/g, '')}`, '#제철건강밥상', '#정갈한한상', '#현지인추천', '#정직한재료'],
    menuItems: [
      { name: '제철 영양 솥밥 정식', price: 14000, description: '제철 식재료와 갓 지은 가마솥밥, 정갈한 7첩 계절 반상이 제공되는 대표 메뉴', isSignature: true, category: '정식' },
      { name: '한우 사골 된장찌개와 직화구이', price: 13000, description: '24시간 푹 끓여낸 깊은 사골 육수에 불향 가득한 고기구이 세트', isSignature: true, category: '정식' },
      { name: '수제 떡갈비 구이', price: 12000, description: '국내산 암퇘지와 소고기를 황금비율로 다져 구워낸 육즙 가득 떡갈비', isSignature: false, category: '일품' },
      { name: '해물 파전과 계절 막걸리', price: 16000, description: '각종 해물과 쪽파를 바삭하게 부쳐낸 일품 안주 요리', isSignature: false, category: '안주' }
    ]
  };
}

async function handleStoryGenerator(body) {
  const name = String(body.name || '').trim();
  const category = String(body.category || '한식').trim();
  const address = String(body.address || '').trim();
  const keywords = String(body.keywords || '').trim();
  return { ok: true, story: generateFallbackStoreStory({ name, category, address, keywords }), model: 'moa-fact-only-copy-v1' };

  try {
    const prompt = `소상공인 펀딩 및 소개를 위한 매력적인 스토리텔링을 JSON으로 작성하세요.
상호: ${name || '가게'}
업종: ${category}
위치: ${address || '지역'}
키워드/특징: ${keywords || '단골, 정성, 맛있는 메뉴'}

JSON 형식:
{
  "description": "가게에 대한 1~2문장의 감성적이고 신뢰감 넘치는 소개글 (100~150자)",
  "ownerStory": "사장님의 창업 철학, 인사말, 손님에게 전하는 진심 어린 한마디 (200~300자)",
  "highlights": ["#해시태그1", "#해시태그2", "#해시태그3", "#해시태그4"],
  "menuItems": [
    { "name": "메뉴명1", "price": 14000, "description": "메뉴 특징 및 맛 설명", "isSignature": true, "category": "분류1" },
    { "name": "메뉴명2", "price": 12000, "description": "메뉴 특징 및 맛 설명", "isSignature": true, "category": "분류2" },
    { "name": "메뉴명3", "price": 8000, "description": "메뉴 특징 및 맛 설명", "isSignature": false, "category": "분류3" },
    { "name": "메뉴명4", "price": 6000, "description": "메뉴 특징 및 맛 설명", "isSignature": false, "category": "분류4" }
  ]
}`;

    const result = await callOpenAi({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: '당신은 소상공인을 위한 브랜드 스토리텔링 및 메뉴 브랜딩 전문가입니다. 한국어로 감동적이고 읽기 쉬운 문장으로 JSON을 생성하세요.' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1500,
      temperature: 0.7
    });

    const parsed = jsonBlock(result?.choices?.[0]?.message?.content || '');
    if (parsed.ownerStory && parsed.menuItems?.length) {
      return { ok: true, story: parsed, model: result.model || CHAT_MODEL };
    }
  } catch (err) {
    // Fallback to rule-based generator
  }

  const fallback = generateFallbackStoreStory({ name, category, address, keywords });
  return { ok: true, story: fallback, model: 'moa-story-rules-v1' };
}

async function handleDirectAuth(body) {
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const role = String(body.role || 'investor').trim();
  const action = String(body.action || 'signup').trim();

  if (!email || !password) {
    throw Object.assign(new Error('계정 정보와 비밀번호를 입력해 주세요.'), { status: 400 });
  }

  if (action === 'signup') {
    if (SUPABASE_SERVICE_KEY && SUPABASE_URL) {
      // Service Role Key로 이메일 확인(email_confirm: true)을 강제하여 이메일 발송/Rate Limit 없이 즉시 생성
      const adminCreateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { name: name || email.split('@')[0], role }
        })
      });
      const createData = await adminCreateRes.json().catch(() => ({}));
      if (!adminCreateRes.ok) {
        if (createData?.msg?.includes('already registered') || createData?.message?.includes('already registered') || createData?.error_description?.includes('already registered') || adminCreateRes.status === 422) {
          throw Object.assign(new Error('이미 사용 중인 로그인 이름 또는 이메일입니다. 다시 로그인해 주세요.'), { status: 409 });
        }
        throw Object.assign(new Error(createData?.message || createData?.msg || '계정 생성에 실패했습니다.'), { status: adminCreateRes.status });
      }
    } else if (SUPABASE_URL && SUPABASE_KEY) {
      // Service Key가 없는 환경에서는 일반 signup 호출
      const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password,
          data: { name: name || email.split('@')[0], role }
        })
      });
      const signupData = await signupRes.json().catch(() => ({}));
      if (!signupRes.ok) {
        if ([400, 409, 422].includes(signupRes.status) || signupData?.message?.includes('rate limit')) {
          throw Object.assign(new Error('이미 사용 중인 이름이거나 요청이 많습니다. 잠시 후 다시 시도해 주세요.'), { status: signupRes.status });
        }
        throw Object.assign(new Error(signupData?.message || '계정 생성 실패'), { status: signupRes.status });
      }
    }
  }

  // 가입 또는 로그인 시 토큰 발급
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY || SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY || SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    if (tokenRes.status === 400 || tokenRes.status === 401) {
      throw Object.assign(new Error('로그인 정보가 일치하지 않습니다. 처음이라면 [처음 시작]을 선택해 주세요.'), { status: 401 });
    }
    throw Object.assign(new Error(tokenData?.error_description || tokenData?.message || '로그인 토큰 발급 실패'), { status: tokenRes.status });
  }

  return { ok: true, session: tokenData };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ ok: false, error: 'POST 요청만 지원합니다.' });
  try {
    const mode = String(request.query.mode || '');
    const result = mode === 'chat' ? await handleChat(request.body || {})
      : mode === 'ocr' ? await handleOcr(request.body || {}, request.headers.authorization || '')
        : mode === 'financial-verify' ? await handleFinancialVerification(request.body || {}, request.headers.authorization || '')
          : mode === 'story-generator' ? await handleStoryGenerator(request.body || {})
            : mode === 'auth-direct' ? await handleDirectAuth(request.body || {}) : null;
    if (!result) return response.status(404).json({ ok: false, error: 'AI 경로를 찾을 수 없습니다.' });
    return response.status(200).json(result);
  } catch (error) {
    return response.status(error.status || 500).json({ ok: false, error: error.message || 'AI 처리 중 오류가 발생했습니다.' });
  }
}
