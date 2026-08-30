import fs from 'node:fs';

const env = {};
for (const filename of ['.env.development.local', '.env.local', '.env.admin.local']) {
  if (!fs.existsSync(filename)) continue;
  for (const line of fs.readFileSync(filename, 'utf8').split('\n')) {
    const index = line.indexOf('=');
    if (index > 0 && !line.trim().startsWith('#')) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
}

const base = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key || !serviceKey) throw new Error('Supabase URL, publishable key, service role key가 필요합니다.');

async function request(url, options = {}, expectedStatus = 200) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (response.status !== expectedStatus) throw new Error(body?.message || body?.error || `${response.status} ${url}`);
  return body;
}

async function login(email, password) {
  return request(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
}

const ownerSession = await login('owner@moa.local', 'MoaPass2026!');
const adminSession = await login(env.MOA_ADMIN_EMAIL || 'admin@moa.local', env.MOA_ADMIN_PASSWORD);
const ownerHeaders = { apikey: key, Authorization: `Bearer ${ownerSession.access_token}`, 'Content-Type': 'application/json' };
const adminHeaders = { apikey: key, Authorization: `Bearer ${adminSession.access_token}`, 'Content-Type': 'application/json' };
const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const assert = (condition, message) => { if (!condition) throw new Error('검증 실패: ' + message); };

const [business] = await request(`${base}/rest/v1/businesses?select=*&user_id=eq.${ownerSession.user.id}&limit=1`, { headers: ownerHeaders });
const [metrics] = await request(`${base}/rest/v1/business_metrics?select=*&business_id=eq.${business.id}&limit=1`, { headers: ownerHeaders });
assert(business?.id && metrics?.business_id, '소상공인 사업체와 재무 주장 조회');

const graph = await request(`${base}/rest/v1/rpc/role_knowledge_graph`, {
  method: 'POST', headers: ownerHeaders, body: JSON.stringify({ p_role: 'owner', p_business_id: business.id })
});
assert(graph.role === 'owner' && graph.nodes.some(node => node.id === 'owner:documents'), '소상공인 지식그래프 RPC');

const forged = await fetch(`${base}/rest/v1/financial_verification_runs`, {
  method: 'POST', headers: ownerHeaders,
  body: JSON.stringify({ business_id: business.id, user_id: ownerSession.user.id, status: 'ready_for_admin', orchestration: { readyForAdminReview: true } })
});
assert([401, 403].includes(forged.status), '브라우저 역할의 재무검증 레코드 직접 위조 차단');

const claims = {
  sales6m: metrics.sales_6m, debtTotal: Number(metrics.debt_total),
  monthlyDebtPayment: Number(metrics.monthly_debt_payment), taxCompliant: Boolean(metrics.tax_compliant)
};
const [run] = await request(`${base}/rest/v1/financial_verification_runs?select=*`, {
  method: 'POST', headers: serviceHeaders,
  body: JSON.stringify({
    business_id: business.id, user_id: ownerSession.user.id, claimed_metrics: claims,
    document_results: [{ filename: 'integration-structured-result', contentFingerprint: 'integration-test' }],
    orchestration: { version: 'integration-test', readyForAdminReview: true, documentCount: 3, averageConfidence: 1,
      steps: [{ code: 'identity', status: 'passed' }, { code: 'period', status: 'passed' },
        { code: 'sales', status: 'passed' }, { code: 'debt', status: 'passed' }, { code: 'tax', status: 'passed' },
        { code: 'consistency', status: 'passed' }], missingDocuments: [], mismatches: [], warnings: [] },
    model: 'integration-test', status: 'ready_for_admin'
  })
}, 201);
assert(run?.id, '서버 전용 역할의 구조화 검증 결과 저장');

await request(`${base}/rest/v1/rpc/review_financial_verification`, {
  method: 'POST', headers: adminHeaders,
  body: JSON.stringify({ p_run_id: run.id, p_decision: 'approved', p_note: '통합 테스트 원본 대조 승인' })
});
const [assessment] = await request(`${base}/rest/v1/credit_assessments?select=*&business_id=eq.${business.id}&order=created_at.desc&limit=1`, { headers: ownerHeaders });
assert(assessment.is_official === true && assessment.verification_run_id === run.id, '운영자 승인 후 최신 평가만 공식화');

console.log(JSON.stringify({ knowledgeGraphRpc: 'pass', forgedOwnerInsertBlocked: 'pass', serverInsert: 'pass', adminOfficialApproval: 'pass' }, null, 2));
