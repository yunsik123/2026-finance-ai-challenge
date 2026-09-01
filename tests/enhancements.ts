const base = 'http://localhost:8787'

async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error || JSON.stringify(body)}`)
  return body
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const stamp = Date.now()
const investor = await request('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email: `flow-${stamp}@meoktu.test`, password: 'test1234!', name: '흐름테스터', role: 'investor' }),
})

const before = await request('/api/me', {}, investor.token)
const topup = await request('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount: 123456 }) }, investor.token)
assert(topup.balance === before.user.cash + 123000, '충전 금액은 1,000원 단위로 반영되어야 합니다.')

const publicBefore = await request('/api/public')
assert(publicBefore.listings.length >= 6, '쿠폰 교환장에 다양한 매물이 필요합니다.')
assert(publicBefore.restaurants.some((item: any) => item.salesDisclosure === false && !item.salesHistory), '비공개 식당은 월별 매출 데이터를 노출하면 안 됩니다.')
assert(publicBefore.restaurants.some((item: any) => item.salesDisclosure === true && item.salesHistory?.length >= 12), '공개 식당은 12개월 매출 그래프 데이터가 필요합니다.')

const target = publicBefore.restaurants.find((item: any) => item.fund.status === 'trading' && item.fund.openSellAmount >= 20000 && item.fund.openBuyAmount === 0)
const fundId = target?.fund.id
const restaurantId = target?.id
assert(target?.fund.status === 'trading', '자동매칭 테스트 대상 펀드는 거래 중이어야 합니다.')
const invest = await request(`/api/funds/${fundId}/invest`, { method: 'POST', body: JSON.stringify({ amount: 20000 }) }, investor.token)
assert(invest.matched === 20000 && invest.queued === 0, '기존 회수 대기 주문과 투자 예약이 즉시 체결되어야 합니다.')

const afterInvest = await request('/api/me', {}, investor.token)
const position = afterInvest.positions.find((item: any) => item.fundId === fundId)
assert(position?.amount >= 20000, '체결된 투자금이 나의 식당에 즉시 나타나야 합니다.')

const withdraw = await request(`/api/funds/${fundId}/withdraw`, { method: 'POST', body: JSON.stringify({ amount: 10000 }) }, investor.token)
assert(withdraw.queued === 10000, '반대 투자 예약이 없으면 회수 주문이 대기해야 합니다.')
const order = (await request('/api/me', {}, investor.token)).orders.find((item: any) => item.type === 'sell' && item.remaining === 10000)
assert(order, '회수 대기 주문이 내 상태에 표시되어야 합니다.')

const publicAfterOrder = await request('/api/public')
const orderFund = publicAfterOrder.restaurants.find((item: any) => item.fund.id === fundId).fund
assert(!(orderFund.openBuyAmount > 0 && orderFund.openSellAmount > 0), '매수·매도 대기금액이 동시에 존재하면 안 됩니다.')
const counterparty = await request('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email: `counter-${stamp}@meoktu.test`, password: 'test1234!', name: '상대테스터', role: 'investor' }),
})
assert(orderFund.openSellAmount > 0 && orderFund.openSellAmount <= target.fund.goal * 0.01, '회수 대기금액은 한 사용자 투자 한도 안이어야 합니다.')
const counterInvest = await request(`/api/funds/${fundId}/invest`, { method: 'POST', body: JSON.stringify({ amount: orderFund.openSellAmount }) }, counterparty.token)
assert(counterInvest.matched === orderFund.openSellAmount && counterInvest.queued === 0, '다른 사용자의 투자 예약이 전체 회수 대기금액과 즉시 체결되어야 합니다.')
const sellerAfterMatch = await request('/api/me', {}, investor.token)
assert(!sellerAfterMatch.orders.some((item: any) => item.id === order.id && item.remaining > 0), '첫 사용자의 회수 대기 주문이 체결 완료되어야 합니다.')
const fundAfterMatch = (await request('/api/public')).restaurants.find((item: any) => item.fund.id === fundId).fund
assert(!(fundAfterMatch.openBuyAmount > 0 && fundAfterMatch.openSellAmount > 0), '체결 후에도 양쪽 대기열이 동시에 남으면 안 됩니다.')

await request(`/api/restaurants/${restaurantId}/visit/verify`, { method: 'POST', body: '{}' }, investor.token)
const review = await request(`/api/restaurants/${restaurantId}/reviews`, { method: 'POST', body: JSON.stringify({ rating: 5, content: '방문 인증 흐름을 확인하는 테스트 리뷰입니다.' }) }, investor.token)
assert(review.review.visitVerified, '리뷰에는 방문 인증 표시가 있어야 합니다.')

const owner = await request('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({ email: `owner-flow-${stamp}@meoktu.test`, password: 'test1234!', name: '심사테스터', role: 'owner' }),
})
const application = await request('/api/applications', {
  method: 'POST',
  body: JSON.stringify({
    businessNumber: '1234567891', ownerName: '김소담', licenseNumber: '제2024-000123호', restaurantName: '원천데이터 테스트 키친',
    ownerName: '심사테스터',
    address: '서울시 마포구 연남동',
    connectedSources: ['business', 'license', 'identity', 'pos', 'account', 'card', 'delivery', 'tax', 'customer', 'lease', 'debt', 'staff'],
    uploadedDocuments: { business: 'business.pdf', license: 'license.pdf', pos: 'pos.csv', account: 'account.csv', card: 'card.csv', delivery: 'delivery.csv', tax: 'tax.pdf', customer: 'customer.csv', lease: 'lease.pdf', debt: 'debt.pdf', staff: 'staff.csv' },
    identityVerified: true,
    privacyConsent: true,
    creditConsent: true,
    requestedLimit: 30000000,
    fundPurpose: '좌석 확대와 주방 설비 교체',
    businessPlan: '인테리어 1,500만원, 설비 1,000만원, 운전자금 500만원',
    expectedEffect: '좌석 18석에서 28석으로 확대',
    ownerCapital: 10000000,
  }),
}, owner.token)
assert(application.application.data.derivedMetrics.recent12MonthAverageSales > 0, '원천데이터로 자동 계산한 월평균 매출이 필요합니다.')
assert(application.application.data.dataConfidence >= 80, '전체 자료 연결 시 데이터 신뢰도가 높아야 합니다.')

console.log(JSON.stringify({
  walletTopup: topup.balance - before.user.cash,
  invested: invest,
  withdrawal: withdraw,
  counterpartyInvested: counterInvest.matched,
  review: review.review.id,
  applicationStatus: application.application.status,
  dataConfidence: application.application.data.dataConfidence,
  couponListings: publicBefore.listings.length,
}, null, 2))
