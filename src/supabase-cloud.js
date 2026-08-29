const runtimeEnv = import.meta.env || {};
const supabaseUrl = String(runtimeEnv.VITE_SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const publishableKey = String(runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY || runtimeEnv.VITE_SUPABASE_ANON_KEY || '');
const SESSION_KEY = 'moa.supabase.session.v1';

export const cloudConfigured = Boolean(supabaseUrl && publishableKey);

export function cloudSessionHeaders() {
  const session = loadSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function loadSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!value?.access_token || (value.expires_at && value.expires_at * 1000 <= Date.now())) return null;
    return value;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || `Supabase 요청 실패 (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function auth(path, body, token = '') {
  return requestJson(`${supabaseUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token || publishableKey}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function rest(path, { method = 'GET', body, prefer = '', token } = {}) {
  const session = loadSession();
  const accessToken = token === undefined ? session?.access_token : token;
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${accessToken || publishableKey}`,
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return requestJson(`${supabaseUrl}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function first(rows) { return Array.isArray(rows) ? rows[0] || null : rows; }
function userDto(profile) {
  return profile ? { id: profile.id, name: profile.display_name, email: profile.email, role: profile.role } : null;
}
function businessDto(row) {
  return row ? { id: row.id, name: row.name, category: row.category, number: row.business_number, address: row.address, sales: Number(row.monthly_sales), age: Number(row.business_age), description: row.description, verificationStatus: row.verification_status } : null;
}
function campaignDto(row) {
  return row ? { id: row.id, name: row.name, target: Number(row.target_amount), duration: String(row.duration_days), plan: row.plan, risk: row.risk, status: row.status === 'draft' ? '초안' : row.status } : null;
}
function couponDto(row) {
  return { id: row.id, store: row.store_name, title: row.title, benefit: row.benefit, condition: row.condition_text, code: row.code, used: Boolean(row.used_at), expires: row.expires_at };
}
function randomCode(prefix = 'MOA') {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

async function publicStores() {
  const rows = await rest('stores?select=payload&is_active=eq.true&order=created_at.asc', { token: '' });
  return rows.map(row => row.payload);
}

async function publicRecommendations(stores) {
  const businesses = await rest('businesses?select=id,name&is_demo=eq.true&order=name.asc', { token: '' });
  const storeMap = new Map(stores.map(store => [store.name, store]));
  const values = await Promise.all(businesses.map(async business => {
    const assessment = first(await rest(`credit_assessments?select=score,s_grade,components,missing_fields&business_id=eq.${business.id}&order=created_at.desc&limit=1`, { token: '' }));
    const store = storeMap.get(business.name);
    if (!assessment || !store) return null;
    const components = assessment.components || {};
    const strengths = Object.entries(components).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2).map(([name]) => name);
    const coupon = store.coupon?.benefit || '';
    return {
      storeId: store.id, name: business.name,
      score: Number((Number(assessment.score) * .65 + Number(store.support || 0) * .25 + (coupon.includes('%') ? 5 : 3)).toFixed(1)),
      sGrade: assessment.s_grade, growth: store.growth, coupon, reasons: strengths,
      risks: store.risks || [], dataGaps: assessment.missing_fields || [],
      notice: '추천 점수는 비교 탐색용이며 투자 권유·수익 보장이 아닙니다.'
    };
  }));
  return values.filter(Boolean).sort((a, b) => b.score - a.score);
}

async function ownerIntelligence(business) {
  if (!business) return null;
  const [assessmentRow, nodes, edges] = await Promise.all([
    rest(`credit_assessments?select=*&business_id=eq.${business.id}&order=created_at.desc&limit=1`),
    rest(`knowledge_nodes?select=id,node_type,label,properties&business_id=eq.${business.id}`),
    rest(`knowledge_edges?select=source_node_id,target_node_id,relation_type,evidence,weight&business_id=eq.${business.id}`)
  ]);
  const row = first(assessmentRow);
  if (!row) return null;
  const components = row.components || {};
  const weaknessLimits = { '매출 성장': 12, '상권 내 경쟁력': 7.5, '현금흐름 지속성': 10, '부채 회복력': 10, '경영 안정성': 5, '비계량 가점': 3 };
  const weaknesses = Object.entries(components).filter(([name, value]) => Number(value) <= (weaknessLimits[name] ?? -1)).map(([name]) => name);
  const missing = row.missing_fields || [];
  const assessment = {
    score: Number(row.score), grade: row.s_grade, fundingLimit: Number(row.funding_limit),
    components, missing, strengths: Object.entries(components).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2).map(([name]) => name),
    weaknesses, modelVersion: row.model_version, official: false,
    notice: '공개된 SCB 추진 방향을 재현한 설명용 PoC이며 금융회사·CB사의 공식 신용등급이 아닙니다.'
  };
  const graph = {
    nodes: nodes.map(node => ({ id: node.id, type: node.node_type, label: node.label })),
    edges: edges.map(edge => ({ source: edge.source_node_id, target: edge.target_node_id, relation: edge.relation_type, evidence: edge.evidence })),
    pathCount: edges.length
  };
  const weakText = weaknesses.join(', ') || '뚜렷한 취약 구성요인은 없음';
  const missingText = missing.join(', ') || '필수 기준자료는 모두 등록됨';
  return { assessment, graph, diagnosis: `${business.name}은 현재 설명용 성장등급 ${assessment.grade}(${assessment.score}점)입니다. 그래프의 ${nodes.length}개 노드와 ${edges.length}개 근거 관계를 추적한 결과, 보완 우선순위는 ${weakText}입니다. 부족 자료: ${missingText}. 점수만으로 승인이나 투자를 자동 결정하지 말고 원본 증빙과 운영자 심사를 함께 확인하세요.` };
}

function assessMetrics(metrics, business) {
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
  const sales = metrics.sales6m.map(Number);
  const absoluteGrowth = sales[0] > 0 ? (sales[5] / sales[0] - 1) * 100 : 0;
  const relativeGrowth = absoluteGrowth - Number(metrics.localSalesGrowth || 0);
  const cashFlow = Number(metrics.operatingCashFlow || 0);
  const debtPayment = Number(metrics.monthlyDebtPayment || 0);
  const components = {
    '매출 성장': Number((clamp(50 + absoluteGrowth * 2 + relativeGrowth) * .25).toFixed(1)),
    '상권 내 경쟁력': Number((clamp(45 + Number(metrics.footTrafficGrowth || 0) * 2 + (1 - Number(metrics.competitorDensity || .5)) * 25 - Math.max(0, Number(metrics.closureRate || 10) - 10)) * .15).toFixed(1)),
    '현금흐름 지속성': Number((clamp(45 + cashFlow / Math.max(business.sales, 1) * 170 + Math.min(15, Number(metrics.repeatRate || 0) / 5)) * .20).toFixed(1)),
    '부채 회복력': Number((clamp(80 - debtPayment / Math.max(cashFlow, 1) * 45 - Number(metrics.debtTotal || 0) / Math.max(business.sales * 12, 1) * 18 - Number(metrics.overdueCount || 0) * 22) * .20).toFixed(1)),
    '경영 안정성': Number((clamp(45 + Math.min(business.age, 10) * 4 + (metrics.taxCompliant ? 12 : -25)) * .10).toFixed(1)),
    '비계량 가점': 0
  };
  const score = Number(clamp(Object.values(components).reduce((sum, value) => sum + value, 0)).toFixed(1));
  const grade = [[90,'S1'],[82,'S2'],[75,'S3'],[68,'S4'],[60,'S5'],[52,'S6'],[44,'S7'],[36,'S8'],[28,'S9'],[0,'S10']].find(([limit]) => score >= limit)[1];
  return { score, grade, fundingLimit: Math.floor(Math.max(5000000, business.sales * (.35 + score / 100 * 1.15)) / 100000) * 100000, components, missing: [], modelVersion: 'moa-scb-demo-v1' };
}

async function saveMetrics(body) {
  const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
  const business = businessDto(first(await rest(`businesses?select=*&user_id=eq.${session.user.id}&limit=1`)));
  if (!business) throw new Error('사업체 정보를 먼저 등록해 주세요.');
  await rest('business_metrics?on_conflict=business_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      business_id: business.id, segment: '숙박·음식점업', sales_6m: body.sales6m,
      operating_cash_flow: body.operatingCashFlow, debt_total: body.debtTotal,
      monthly_debt_payment: body.monthlyDebtPayment, overdue_count: body.overdueCount,
      employee_count: body.employeeCount, tax_compliant: body.taxCompliant,
      foot_traffic_growth: body.footTrafficGrowth, local_sales_growth: body.localSalesGrowth,
      competitor_density: body.competitorDensity, closure_rate: body.closureRate,
      repeat_rate: body.repeatRate, digital_sales_ratio: body.digitalSalesRatio,
      source_dates: { owner_input: new Date().toISOString().slice(0, 10) }
    }
  });
  const assessment = assessMetrics(body, business);
  await rest('credit_assessments', { method: 'POST', prefer: 'return=minimal', body: { business_id: business.id, score: assessment.score, s_grade: assessment.grade, funding_limit: assessment.fundingLimit, components: assessment.components, missing_fields: assessment.missing, model_version: assessment.modelVersion, is_official: false } });
  const id = business.id;
  const nodes = [
    [`business:${id}`,'Business',business.name], [`owner:${id}`,'Owner','대표자'],
    [`area:${id}`,'CommercialArea',business.address.split(' ')[1] || business.address],
    [`category:${id}`,'Category',business.category], [`sales:${id}`,'Metric','최근 6개월 매출'],
    [`cash:${id}`,'Metric','영업현금흐름'], [`debt:${id}`,'Risk','부채·상환부담'],
    [`grade:${id}`,'Assessment',assessment.grade]
  ].map(([nodeId,nodeType,label]) => ({ id: nodeId, business_id: id, node_type: nodeType, label }));
  await rest('knowledge_nodes?on_conflict=id', { method: 'POST', body: nodes, prefer: 'resolution=merge-duplicates,return=minimal' });
  const edges = [
    ['owner','business','OPERATES','회원·사업체 등록'], ['business','area','LOCATED_IN',business.address],
    ['business','category','BELONGS_TO',business.category], ['business','sales','HAS_SIGNAL',JSON.stringify(body.sales6m)],
    ['business','cash','HAS_SIGNAL',String(body.operatingCashFlow)], ['business','debt','EXPOSED_TO',String(body.debtTotal)],
    ['sales','grade','SUPPORTS',`매출 성장 ${assessment.components['매출 성장']}`],
    ['cash','grade','SUPPORTS',`현금흐름 ${assessment.components['현금흐름 지속성']}`],
    ['debt','grade','LIMITS',`부채 회복력 ${assessment.components['부채 회복력']}`]
  ].map(([source,target,relation,evidence], index) => ({ id: `edge:${id}:${index}`, business_id: id, source_node_id: `${source}:${id}`, target_node_id: `${target}:${id}`, relation_type: relation, evidence }));
  await rest('knowledge_edges?on_conflict=id', { method: 'POST', body: edges, prefer: 'resolution=merge-duplicates,return=minimal' });
  return { ok: true, intelligence: await ownerIntelligence(business) };
}

async function bootstrap() {
  const stores = await publicStores();
  const recommendations = await publicRecommendations(stores);
  const session = loadSession();
  const empty = { ok: true, user: null, stores, favorites: [], business: null, campaign: null, contributions: {}, coupons: [], disclosures: [], issuedCoupon: null, region: '서울 성동구', recentOcr: null, loginHistory: [], intelligence: null, recommendations };
  if (!session?.user?.id) return empty;
  const userId = session.user.id;
  const profile = first(await rest(`profiles?select=*&id=eq.${userId}&limit=1`));
  if (!profile) { saveSession(null); return empty; }
  const [favoriteRows, businessRows, campaignRows, contributionRows, couponRows, settingsRows, issuedRows, ocrRows, loginRows] = await Promise.all([
    rest(`favorites?select=store_id&user_id=eq.${userId}`),
    rest(`businesses?select=*&user_id=eq.${userId}&limit=1`),
    rest(`campaigns?select=*&user_id=eq.${userId}&order=updated_at.desc&limit=1`),
    rest(`contributions?select=store_id,amount&user_id=eq.${userId}`),
    rest(`coupons?select=*&user_id=eq.${userId}&order=created_at.desc`),
    rest(`user_settings?select=*&user_id=eq.${userId}&limit=1`),
    rest(`issued_coupon_templates?select=*&user_id=eq.${userId}&order=created_at.desc&limit=1`),
    rest(`ocr_analyses?select=id,result,model,created_at&user_id=eq.${userId}&order=created_at.desc&limit=1`),
    rest(`login_events?select=event_type,ip_hint,user_agent,created_at&user_id=eq.${userId}&order=created_at.desc&limit=10`)
  ]);
  const contributionMap = {};
  contributionRows.forEach(row => { contributionMap[row.store_id] = (contributionMap[row.store_id] || 0) + Number(row.amount); });
  const business = businessDto(first(businessRows));
  const settings = first(settingsRows);
  const issued = first(issuedRows);
  const recent = first(ocrRows);
  return {
    ...empty, user: userDto(profile), favorites: favoriteRows.map(row => row.store_id), business,
    campaign: campaignDto(first(campaignRows)), contributions: contributionMap,
    coupons: couponRows.map(couponDto), disclosures: settings?.disclosures || [],
    region: settings?.region || '서울 성동구',
    issuedCoupon: issued ? { id: issued.id, name: issued.name, benefit: issued.benefit, quantity: issued.quantity, condition: issued.condition_text } : null,
    recentOcr: recent ? { id: recent.id, result: recent.result, model: recent.model, createdAt: recent.created_at } : null,
    loginHistory: loginRows.map(row => ({ event: row.event_type, label: row.event_type === 'login_success' ? '로그인' : '로그아웃', ip: row.ip_hint, userAgent: row.user_agent, createdAt: row.created_at })),
    intelligence: profile.role === 'owner' ? await ownerIntelligence(business) : null
  };
}

async function createOrLogin(values) {
  let result;
  try {
    result = await auth('token?grant_type=password', { email: values.email, password: values.password });
  } catch (loginError) {
    try {
      result = await auth('signup', { email: values.email, password: values.password, data: { name: values.name, role: values.role } });
    } catch (signupError) {
      throw new Error(loginError.status === 400 ? '이메일 또는 비밀번호가 올바르지 않습니다.' : signupError.message);
    }
  }
  const session = result?.access_token ? result : result?.session;
  if (!session?.access_token) throw new Error('가입 확인 이메일을 확인한 뒤 로그인해 주세요.');
  session.user = result.user || session.user;
  saveSession(session);
  let profile = first(await rest(`profiles?select=*&id=eq.${session.user.id}&limit=1`));
  if (!profile) {
    profile = first(await rest('profiles?on_conflict=id&select=*', { method: 'POST', body: { id: session.user.id, email: values.email.toLowerCase(), display_name: values.name, role: values.role }, prefer: 'resolution=merge-duplicates,return=representation' }));
  }
  if (profile.role !== values.role) { saveSession(null); throw new Error(`이 이메일은 ${profile.role === 'owner' ? '소상공인' : '투자자'} 계정입니다.`); }
  await rest('login_events', { method: 'POST', body: { user_id: session.user.id, event_type: 'login_success', user_agent: navigator.userAgent }, prefer: 'return=minimal' });
  return bootstrap();
}

async function logout() {
  const session = loadSession();
  if (session?.user?.id) {
    await rest('login_events', { method: 'POST', body: { user_id: session.user.id, event_type: 'logout', user_agent: navigator.userAgent }, prefer: 'return=minimal' }).catch(() => {});
    await auth('logout', undefined, session.access_token).catch(() => {});
  }
  saveSession(null);
  return { ok: true };
}

async function toggleFavorite(body) {
  const session = loadSession(); if (!session) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  const userId = session.user.id;
  const found = first(await rest(`favorites?select=store_id&user_id=eq.${userId}&store_id=eq.${encodeURIComponent(body.storeId)}&limit=1`));
  if (found) await rest(`favorites?user_id=eq.${userId}&store_id=eq.${encodeURIComponent(body.storeId)}`, { method: 'DELETE', prefer: 'return=minimal' });
  else await rest('favorites', { method: 'POST', body: { user_id: userId, store_id: body.storeId }, prefer: 'return=minimal' });
  const rows = await rest(`favorites?select=store_id&user_id=eq.${userId}`);
  return { ok: true, saved: !found, favorites: rows.map(row => row.store_id) };
}

async function saveBusiness(body) {
  const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
  const row = first(await rest('businesses?on_conflict=user_id&select=*', { method: 'POST', body: { user_id: session.user.id, name: body.name, category: body.category, business_number: body.number, address: body.address, monthly_sales: body.sales, business_age: body.age, description: body.description }, prefer: 'resolution=merge-duplicates,return=representation' }));
  return { ok: true, business: businessDto(row) };
}

async function saveCampaign(body) {
  const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
  const business = first(await rest(`businesses?select=id&user_id=eq.${session.user.id}&limit=1`));
  if (!business) throw new Error('사업체 정보를 먼저 등록해 주세요.');
  const payload = { user_id: session.user.id, business_id: business.id, name: body.name, target_amount: body.target, duration_days: body.duration, plan: body.plan, risk: body.risk };
  const path = body.id ? `campaigns?id=eq.${body.id}&user_id=eq.${session.user.id}&select=*` : 'campaigns?select=*';
  const row = first(await rest(path, { method: body.id ? 'PATCH' : 'POST', body: payload, prefer: 'return=representation' }));
  return { ok: true, campaign: campaignDto(row) };
}

async function recordContribution(body) {
  const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
  if (body.riskConsent !== true) throw new Error('위험 확인 동의가 필요합니다.');
  await rest('contributions', { method: 'POST', body: { user_id: session.user.id, store_id: body.storeId, amount: body.amount, risk_consent: true }, prefer: 'return=minimal' });
  const stores = await publicStores(); const store = stores.find(item => item.id === body.storeId);
  if (!store) throw new Error('가게를 찾을 수 없습니다.');
  const sourceId = `funding-${body.storeId}`;
  await rest('coupons?on_conflict=user_id,source_type,source_id', { method: 'POST', body: { user_id: session.user.id, store_id: body.storeId, source_type: 'funding', source_id: sourceId, store_name: store.name, title: store.coupon.title, benefit: store.coupon.benefit, condition_text: store.coupon.condition, code: randomCode(`MOA-${body.storeId.toUpperCase()}`), expires_at: '2027-12-31' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
  const amounts = await rest(`contributions?select=amount&user_id=eq.${session.user.id}&store_id=eq.${body.storeId}`);
  const coupon = first(await rest(`coupons?select=*&user_id=eq.${session.user.id}&source_type=eq.funding&source_id=eq.${sourceId}&limit=1`));
  return { ok: true, total: amounts.reduce((sum, row) => sum + Number(row.amount), 0), coupon: couponDto(coupon) };
}

async function useCoupon(body) {
  const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
  const row = first(await rest(`coupons?id=eq.${body.couponId}&user_id=eq.${session.user.id}&select=*`, { method: 'PATCH', body: { used_at: new Date().toISOString() }, prefer: 'return=representation' }));
  return { ok: true, coupon: couponDto(row) };
}

async function saveSettings(body, kind) {
  const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
  const payload = { user_id: session.user.id, [kind]: kind === 'disclosures' ? body.values : body.region, updated_at: new Date().toISOString() };
  const row = first(await rest('user_settings?on_conflict=user_id&select=*', { method: 'POST', body: payload, prefer: 'resolution=merge-duplicates,return=representation' }));
  return kind === 'disclosures' ? { ok: true, disclosures: row.disclosures } : { ok: true, region: row.region };
}

async function issueCoupon(body) {
  const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
  const business = first(await rest(`businesses?select=id&user_id=eq.${session.user.id}&limit=1`));
  const row = first(await rest('issued_coupon_templates?select=*', { method: 'POST', body: { user_id: session.user.id, business_id: business?.id || null, name: body.name, benefit: body.benefit, quantity: body.quantity, condition_text: body.condition }, prefer: 'return=representation' }));
  return { ok: true, issuedCoupon: { id: row.id, name: row.name, benefit: row.benefit, quantity: row.quantity, condition: row.condition_text } };
}

export async function cloudRequest(path, options = {}) {
  if (!cloudConfigured) return null;
  if (path.startsWith('/api/ai/') || path === '/api/health') return null;
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === '/api/bootstrap' && (!options.method || options.method === 'GET')) return bootstrap();
  if (path === '/api/stores') return { ok: true, stores: await publicStores() };
  if (path === '/api/recommendations') { const stores = await publicStores(); return { ok: true, recommendations: await publicRecommendations(stores) }; }
  if (path === '/api/auth/session' && options.method === 'POST') return createOrLogin(body);
  if (path === '/api/auth/session' && options.method === 'DELETE') return logout();
  if (path === '/api/favorites/toggle') return toggleFavorite(body);
  if (path === '/api/business') return saveBusiness(body);
  if (path === '/api/business/metrics') return saveMetrics(body);
  if (path === '/api/campaign') return saveCampaign(body);
  if (path === '/api/contributions') return recordContribution(body);
  if (path === '/api/coupons/use') return useCoupon(body);
  if (path === '/api/coupons/issue') return issueCoupon(body);
  if (path === '/api/disclosures') return saveSettings(body, 'disclosures');
  if (path === '/api/preferences/region') return saveSettings(body, 'region');
  if (path === '/api/knowledge-graph') {
    const session = loadSession(); if (!session) throw new Error('로그인이 필요합니다.');
    const business = businessDto(first(await rest(`businesses?select=*&user_id=eq.${session.user.id}&limit=1`)));
    return { ok: true, intelligence: await ownerIntelligence(business) };
  }
  if (path === '/api/login-history') return bootstrap().then(data => ({ ok: true, loginHistory: data.loginHistory }));
  return null;
}
