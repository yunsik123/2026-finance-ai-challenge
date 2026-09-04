import { answerNavigationQuestion, pageForRoute } from '../server/sitemap.ts'

const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`
async function ok(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json() as Record<string, any>
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const money = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

// 실제 화면 문구와 상담 지도가 맞는지 기능별로 확인한다.
const navigationCases = [
  ['쿠폰을 매장에서 어떻게 사용해?', ['마이페이지', '사용하기', '8자리']],
  ['내 쿠폰 상태는 어디서 봐?', ['마이페이지', '사용 가능', '지난 쿠폰']],
  ['펀드 예약 거래에서 주문은 어떻게 취소해?', ['펀드 예약 거래', '취소']],
  ['AI 점주 경영 리포트는 어디서 봐?', ['사장님 센터', 'AI 점주 경영 리포트']],
  ['투자자에게 식당 감사 쿠폰은 어떻게 보내?', ['사장님 센터', '10% 식당 감사 쿠폰 보내기']],
] as const
for (const [question, expected] of navigationCases) {
  const answer = answerNavigationQuestion(question)
  for (const text of expected) assert(answer.includes(text), `“${question}” 안내에 “${text}”가 필요합니다.`)
}
assert(pageForRoute('/my?tab=coupon')?.name === 'MY 먹투', '현재 경로를 마이페이지 상담 문맥으로 읽어야 합니다.')

// 투자자 개인 원장 값이 AI 답변에 즉시 반영되는지 확인한다.
const investor = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'investor@meoktu.demo', password: 'demo1234!' }) })
const before = await ok('/api/me', {}, investor.token)
const accountQuestion = '내 먹투머니 잔액과 쿠폰, 예약 주문 현황 알려줘'
const accountBefore = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'investor', currentPath: '/my', question: accountQuestion }) }, investor.token)
assert(accountBefore.mode === 'account-ledger-local', '개인 원장 질문은 외부 AI가 아닌 내부 원장 모드로 답해야 합니다.')
assert(accountBefore.answer.includes(money(before.user.cash)), 'AI 답변의 먹투머니가 현재 DB 원장과 같아야 합니다.')
assert(accountBefore.sources.some((source: any) => source.type === 'AccountSummary'), '투자자 상담 근거에 계정 원장 요약이 필요합니다.')
await ok('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, investor.token)
const accountAfter = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'investor', currentPath: '/my', question: accountQuestion }) }, investor.token)
assert(accountAfter.answer.includes(money(before.user.cash + 1000)), 'DB 변경 직후 AI 답변에도 새 잔액이 반영되어야 합니다.')

// 투자자가 사장님 역할을 임의로 보내도 비공개 심사·신용 노드는 나오면 안 된다.
const spoofed = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'owner', restaurantId: 'r-sobok', question: '내 신용등급과 심사 승인 한도를 어디서 확인해?' }) }, investor.token)
assert(!spoofed.sources.some((source: any) => ['CreditGrade', 'FinancialClaim', 'VerificationRun', 'OwnerSituation'].includes(source.type)), '투자자 상담에 사장님의 비공개 심사 근거가 노출되면 안 됩니다.')

// 사장님은 본인 심사 원장을 바탕으로 현재 단계를 답해야 한다.
const owner = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
const ownerMe = await ok('/api/me', {}, owner.token)
const ownerStatus = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'owner', currentPath: '/owner', question: '내 심사는 지금 몇 단계야?' }) }, owner.token)
if (ownerMe.applications?.length) {
  assert(ownerStatus.mode === 'owner-ledger-local' && /\d단계/.test(ownerStatus.answer), '접수 이력이 있는 사장님 상담은 본인 심사 원장의 현재 단계를 답해야 합니다.')
}

// 사장님의 "현황" 질문은 투자자용 지갑 집계가 아니라 내 가게 운영 원장으로 답해야 한다.
const ownerLedger = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'owner', currentPath: '/owner', question: '내 가게 모금과 쿠폰 부담 현황 알려줘' }) }, owner.token)
assert(ownerLedger.mode === 'owner-ledger-local', '사장님 현황 질문은 사장님 원장 모드로 답해야 합니다.')
assert(!/먹투머니/.test(ownerLedger.answer), '사장님 답변에 투자자용 먹투머니 잔액이 섞이면 안 됩니다.')
assert(/투자자는 \d+명/.test(ownerLedger.answer) && /사용되지 않은 쿠폰 부담/.test(ownerLedger.answer), '사장님 답변은 모금·투자자 수와 미사용 쿠폰 부담을 담아야 합니다.')
const ownerPublic = await ok('/api/public')
const ownerFund = ownerPublic.restaurants.find((item: any) => item.name === '소복소복')?.fund
assert(ownerFund && ownerLedger.answer.includes(money(ownerFund.raised)), '사장님 답변의 모금액이 현재 DB 펀드 원장과 같아야 합니다.')
assert(ownerLedger.sources.some((source: any) => source.type === 'AccountSummary'), '사장님 상담 근거에 가게 운영 원장 요약이 필요합니다.')

// "관심 식당 몇 곳"처럼 다른 낱말로 물어도 원장 집계로 답해야 한다(외부 AI 추측 금지).
const favoriteAsk = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'investor', currentPath: '/my', question: '내 관심 식당 몇 곳이야?' }) }, investor.token)
assert(favoriteAsk.mode === 'account-ledger-local', '관심 식당 질문도 개인 원장 모드로 답해야 합니다.')
assert(favoriteAsk.answer.includes(`관심 식당은 ${before.favoriteRestaurantIds.length}곳`), 'AI 답변의 관심 식당 수가 현재 DB 원장과 같아야 합니다.')

// "어떻게 올려?"는 현황 나열이 아니라 클릭 순서로 답해야 한다.
const howTo = '내 쿠폰을 교환장에 올리려면 어떻게 해?'
assert(answerNavigationQuestion(howTo).includes('내 쿠폰 등록'), '쿠폰 등록 안내는 실제 주황색 버튼 이름을 알려줘야 합니다.')
const howToReply = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'investor', currentPath: '/market', question: howTo }) }, investor.token)
assert(howToReply.mode !== 'account-ledger-local', '방법을 묻는 질문에 보유 쿠폰 집계로 답하면 안 됩니다.')

// 상담 AI는 개인별 투자금액이나 가장 유리한 식당을 대신 결정하지 않는다.
for (const question of ['소복소복에 50만원 투자하는 게 좋을까?', '어느 식당이 가장 유리한지 골라줘']) {
  const blocked = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'investor', currentPath: '/insight', question }) }, investor.token)
  assert(blocked.mode === 'investment-advice-blocked', `“${question}”은 투자 권유 차단 정책이 적용되어야 합니다.`)
  assert(blocked.provider === 'meoktu-policy', '투자 권유 차단은 외부 생성형 AI 호출 전에 서버 정책으로 처리해야 합니다.')
  assert(blocked.answer.includes('투자 금액을 정하거나') && blocked.answer.includes('공개되는'), '차단 답변은 투자 결정 거절과 공개정보 요약 대안을 함께 안내해야 합니다.')
  assert(!/\d[\d,]*(?:만|천)?\s*원(?:을|를)?\s*(?:투자|넣)하세요/.test(blocked.answer), '차단 답변이 구체적인 투자금액을 다시 권유하면 안 됩니다.')
}

// 예약 거래 카드의 “예약 걸기”와 “취소”가 사용하는 실제 API 흐름을 검증한다.
const stamp = Date.now()
const queueUser = await ok('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: `queue-ui-${stamp}@meoktu.test`, password: 'test1234!', name: '예약화면테스터', role: 'investor' }) })
const publicState = await ok('/api/public')
const emptyBookFund = publicState.funds.find((fund: any) => fund.status === 'trading' && fund.openSellAmount === 0)
assert(emptyBookFund, '즉시 체결될 회수 주문이 없는 거래 중 펀드가 필요합니다.')
const queued = await ok(`/api/funds/${emptyBookFund.id}/invest`, { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, queueUser.token)
assert(queued.queued === 1000, '상세 화면의 투자 예약이 대기열에 들어가야 합니다.')
const book = (await ok('/api/market/orderbook', {}, queueUser.token)).books.find((item: any) => item.fundId === emptyBookFund.id)
const mine = book.buyQueue.find((entry: any) => entry.mine)
assert(mine?.orderId && mine.amount === 1000, '예약 거래 화면에서 내 주문과 취소 대상 ID를 확인할 수 있어야 합니다.')
await ok(`/api/orders/${mine.orderId}`, { method: 'DELETE' }, queueUser.token)
const afterCancel = (await ok('/api/market/orderbook', {}, queueUser.token)).books.find((item: any) => item.fundId === emptyBookFund.id)
assert(!afterCancel.buyQueue.some((entry: any) => entry.mine), '취소 버튼 API 실행 후 내 예약이 대기열에서 사라져야 합니다.')

console.log('PASS: role-aware AI guide | live account ledger | owner store ledger | owner privacy boundary | how-to over ledger dump | investment advice hard block | coupon guidance | orderbook reserve/cancel click flow')
