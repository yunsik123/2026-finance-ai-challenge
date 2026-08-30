import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const filename of ['.env.development.local', '.env.local', '.env.admin.local']) {
  const fullPath = path.join(root, filename);
  if (!fs.existsSync(fullPath)) continue;
  for (const line of fs.readFileSync(fullPath, 'utf8').split('\n')) {
    const index = line.indexOf('=');
    if (index > 0 && !line.trim().startsWith('#')) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
}

const base = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!base || !key) throw new Error('Supabase 개발 환경변수가 필요합니다.');

const accounts = {
  investor: ['investor@moa.local', 'MoaPass2026!'],
  investor2: ['investor2@moa.local', 'MoaPass2026!'],
  owner: ['owner@moa.local', 'MoaPass2026!']
};
const campaignClosed = '20000000-0000-4000-8000-000000000001';
const campaignOpen = '20000000-0000-4000-8000-000000000002';

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.error || `${response.status} ${url}`);
  return body;
}

async function login([email, password]) {
  return json(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
}

function client(session) {
  const headers = { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
  return {
    get: path => json(`${base}/rest/v1/${path}`, { headers }),
    rpc: (name, body) => json(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) })
  };
}

const assert = (condition, message) => { if (!condition) throw new Error(`검증 실패: ${message}`); };
const sumHoldings = rows => rows.reduce((sum, row) => sum + Number(row.invested_amount), 0);

const [investorSession, investor2Session, ownerSession] = await Promise.all([
  login(accounts.investor), login(accounts.investor2), login(accounts.owner)
]);
const investor = client(investorSession);
const investor2 = client(investor2Session);
const owner = client(ownerSession);

// Scenario B: 모집 중 투자 → 추가 투자 → 즉시 일부 회수
const beforeOpen = await investor.get(`investments?select=*&campaign_id=eq.${campaignOpen}`);
await investor.rpc('invest_fund', { p_campaign_id: campaignOpen, p_amount: 1000, p_risk_consent: true });
const afterInvest = await investor.get(`investments?select=*&campaign_id=eq.${campaignOpen}`);
assert(Number(afterInvest[0].invested_amount) === Number(beforeOpen[0].invested_amount) + 1000, '모집 중 투자잔액 +1,000원');
await investor.rpc('withdraw_fund', { p_campaign_id: campaignOpen, p_amount: 1000 });
const afterWithdraw = await investor.get(`investments?select=*&campaign_id=eq.${campaignOpen}`);
assert(Number(afterWithdraw[0].invested_amount) === Number(beforeOpen[0].invested_amount), '모집 중 일부 회수 후 잔액 복원');

// Scenario C/D: 종료 펀드 회수 요청 → 기존 FIFO 예약과 자동 매칭 → 펀드 총액 불변
const fundBefore = (await investor.get(`campaigns?select=current_amount&campaign_id=eq.${campaignClosed}`.replace('campaign_id', 'id')))[0];
const holdingsBefore = await owner.get(`investments?select=invested_amount&campaign_id=eq.${campaignClosed}`);
const result = await investor2.rpc('withdraw_fund', { p_campaign_id: campaignClosed, p_amount: 30000 });
assert(result.mode === 'queued' && Number(result.matchedNow) > 0, '종료 후 회수 요청이 예약과 자동 매칭');
const fundAfter = (await investor.get(`campaigns?select=current_amount&id=eq.${campaignClosed}`))[0];
const holdingsAfter = await owner.get(`investments?select=invested_amount&campaign_id=eq.${campaignClosed}`);
assert(Number(fundAfter.current_amount) === Number(fundBefore.current_amount), '모집 종료 후 펀드 총액 불변');
assert(sumHoldings(holdingsAfter) === sumHoldings(holdingsBefore), '매칭 전후 투자잔액 합계 불변');

// Scenario E: 누적률 중간 발급 → 쿠폰 생성 → 적립률 초기화 → 주문 사용
const issued = await investor.rpc('issue_accrued_coupon', { p_campaign_id: campaignClosed });
assert(issued?.id && Number(issued.discount_rate) >= 10, '최소 할인율 이상 쿠폰 생성');
const used = await investor.rpc('use_coupon', { p_coupon_id: issued.id, p_order_amount: 30000 });
assert(used.status === 'used' && Number(used.discount_amount) > 0, '쿠폰 사용 및 할인액 기록');

// Scenario A 운영: 월 매출 저장과 배당 쿠폰 지급
const business = (await owner.get(`businesses?select=id&user_id=eq.${ownerSession.user.id}&limit=1`))[0];
const sales = await owner.rpc('record_monthly_sales', {
  p_business_id: business.id, p_year_month: '2026-09-01', p_total_sales: 34000000,
  p_coupon_sales: 1200000, p_coupon_discount_total: 120000, p_coupons_used: 8
});
assert(sales.id && Number(sales.total_sales) === 34000000, '소상공인 월 매출 DB 저장');
const issuedCount = await owner.rpc('issue_dividend_coupon', {
  p_campaign_id: campaignClosed, p_title: '실시간 시나리오 검증', p_description: '테스트 배당',
  p_benefit_kind: 'percent', p_discount_value: 10, p_target: 'all'
});
assert(Number(issuedCount) > 0, '활성 투자자에게 배당 쿠폰 일괄 발급');

// P1 쿠폰 교환: 같은 할인율의 배당 쿠폰 두 장을 잠금 후 원자적으로 소유권 교체
const [couponOne] = await investor.get('coupons?select=*&coupon_type=eq.dividend&order=created_at.desc&limit=1');
const [couponTwo] = await investor2.get('coupons?select=*&coupon_type=eq.dividend&order=created_at.desc&limit=1');
const trade = await investor.rpc('create_coupon_trade', { p_coupon_id: couponOne.id });
await investor2.rpc('accept_coupon_trade', { p_trade_id: trade.id, p_coupon_id: couponTwo.id });
const [swappedOne] = await investor2.get(`coupons?select=owner_id,status&id=eq.${couponOne.id}`);
const [swappedTwo] = await investor.get(`coupons?select=owner_id,status&id=eq.${couponTwo.id}`);
assert(swappedOne.owner_id === investor2Session.user.id && swappedTwo.owner_id === investorSession.user.id, '쿠폰 두 장 소유권 원자적 교환');

console.log(JSON.stringify({
  scenarioB: 'pass', scenarioC: 'pass', scenarioD: 'pass', scenarioE: 'pass',
  ownerSalesAndDividend: 'pass', couponTrade: 'pass', matchedAmount: Number(result.matchedNow), dividendRecipients: Number(issuedCount)
}, null, 2));
