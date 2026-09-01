// 쿠폰 교환장 통합 테스트.
// 여러 사람이 동시에 붙는 상황을 가정하고, 조건 검증 · 에스크로 · 동시성 · 사용 확인까지 본다.
const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`

async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const body = await response.json() as Record<string, any>
  return { ok: response.ok, status: response.status, body }
}

async function ok(path: string, options: RequestInit = {}, token?: string) {
  const result = await request(path, options, token)
  if (!result.ok) throw new Error(`${path}: ${result.status} ${result.body.error || JSON.stringify(result.body)}`)
  return result.body
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const login = (email: string) => ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'demo1234!' }) })
const post = (path: string, body: unknown, token: string) => request(path, { method: 'POST', body: JSON.stringify(body) }, token)

const investor = await login('investor@meoktu.demo')
const owner = await login('owner@meoktu.demo')
const marketA = await login('market-a@meoktu.demo')
const marketB = await login('market-b@meoktu.demo')

const rules = await ok('/api/market/rules')
assert(rules.rules.maxDiscountGap === 10 && rules.rules.maxValueRatio > 1, '교환 규칙이 공개되어야 합니다.')
assert(rules.categories.length > 3 && rules.regions.length > 3, '업종·지역 선택지가 제공되어야 합니다.')

/* ── 1. 등록자가 건 조건을 서버가 실제로 강제하는가 ───────────────── */

// cl-3: 도토리분식(분식) 쿠폰, 원하는 업종 = 카페 / 지역 = 서울
const wrongCategory = await post('/api/listings/cl-3/offers', { couponId: 'c-2' }, investor.token)
assert(!wrongCategory.ok, '원하는 업종이 아닌 쿠폰 제안은 거절되어야 합니다.')
assert(wrongCategory.body.issues?.some((issue: any) => issue.code === 'category'), '업종 불일치 사유가 표시되어야 합니다.')

// cl-4: 원하는 지역 = 수원·서울, 최소 할인율 25%
const wrongRegion = await post('/api/listings/cl-4/offers', { couponId: 'c-1' }, investor.token)
assert(!wrongRegion.ok, '원하는 지역이 아닌 쿠폰 제안은 거절되어야 합니다.')
assert(wrongRegion.body.issues?.some((issue: any) => issue.code === 'region'), '지역 불일치 사유가 표시되어야 합니다.')

// cl-2: 목화다방 2,880원 vs 화향면관 8,400원 → 액면가 2.9배
const valueGap = await post('/api/listings/cl-2/offers', { couponId: 'c-2' }, investor.token)
assert(!valueGap.ok, '액면가 차이가 큰 교환은 거절되어야 합니다.')
assert(valueGap.body.issues?.some((issue: any) => issue.code === 'valueGap'), '액면가 격차 사유가 표시되어야 합니다.')

// 내가 올린 매물을 내가 가져가려는 시도
const selfSwap = await post('/api/listings/cl-1/offers', { couponId: 'c-market-1' }, owner.token)
assert(!selfSwap.ok, '자기 매물과의 교환은 막혀야 합니다.')

/* ── 2. 승인형 매물: 제안 → 에스크로 → 수락 ─────────────────────── */

// cl-3(승인형, 카페·서울)에 조건이 맞는 쿠폰을 만들어 제안한다.
const listedForCafe = await ok('/api/coupons/c-market-8/list', {
  method: 'POST',
  body: JSON.stringify({ wantedCategories: [], wantedRegions: [], autoAccept: false }),
}, marketB.token)
assert(listedForCafe.listing.status === 'open', '새 매물이 열려야 합니다.')

// 목화다방(카페·서울) 쿠폰을 가진 김소담이 cl-3에 제안한다. 24% vs 28%, 2,880 vs 4,480 → 1.6배
await ok('/api/listings/' + (await ok('/api/market/mine', {}, owner.token)).listings.find((item: any) => item.couponId === 'c-market-2')!.id, { method: 'DELETE' }, owner.token)
const offered = await ok('/api/listings/cl-3/offers', { method: 'POST', body: JSON.stringify({ couponId: 'c-market-2', message: '카페 쿠폰이에요!' }) }, owner.token)
assert(offered.settled === false && offered.offer.status === 'pending', '승인형 매물은 즉시 체결되지 않아야 합니다.')

// 제안에 건 쿠폰은 잠겨서 다른 곳에 못 쓴다 (에스크로).
const ownerWallet = await ok('/api/me', {}, owner.token)
assert(ownerWallet.coupons.find((item: any) => item.id === 'c-market-2')?.status === 'offered', '제안한 쿠폰은 잠겨야 합니다.')
const doubleSpend = await post('/api/coupons/c-market-2/list', { autoAccept: true }, owner.token)
assert(!doubleSpend.ok, '이미 제안에 건 쿠폰을 다시 교환장에 올릴 수 없어야 합니다.')

// 같은 매물에 중복 제안 금지
const duplicate = await post('/api/listings/cl-3/offers', { couponId: 'c-market-2' }, owner.token)
assert(!duplicate.ok, '같은 매물에 중복 제안을 보낼 수 없어야 합니다.')

// 등록자에게 알림이 갔는가
const aInbox = await ok('/api/notifications', {}, marketA.token)
assert(aInbox.notifications.some((item: any) => item.type === 'offer_received'), '등록자에게 제안 알림이 가야 합니다.')

// 제안자가 아닌 사람은 수락할 수 없다
const wrongAccepter = await post(`/api/offers/${offered.offer.id}/accept`, {}, marketB.token)
assert(!wrongAccepter.ok, '매물 등록자만 제안을 수락할 수 있어야 합니다.')

// 등록자가 수락 → 체결
const accepted = await ok(`/api/offers/${offered.offer.id}/accept`, { method: 'POST' }, marketA.token)
assert(accepted.trade.mode === 'offer', '제안 수락 거래로 기록되어야 합니다.')

const ownerAfter = await ok('/api/me', {}, owner.token)
const gotDotori = ownerAfter.coupons.find((item: any) => item.id === 'c-market-3')
assert(gotDotori?.status === 'available', '수락된 교환의 쿠폰이 제안자 지갑으로 와야 합니다.')
assert(gotDotori.acquiredFromUserId === marketA.user.id, '누구에게서 받았는지 남아야 합니다.')
assert(!ownerAfter.coupons.some((item: any) => item.id === 'c-market-2' && item.status !== 'used'), '내준 쿠폰은 내 지갑에서 빠져야 합니다.')
assert(ownerAfter.notifications.some((item: any) => item.type === 'trade_done'), '양쪽 모두 체결 알림을 받아야 합니다.')

const history = await ok('/api/market/mine', {}, owner.token)
assert(history.trades.some((trade: any) => trade.got?.id === 'c-market-3' && trade.gave?.id === 'c-market-2'), '거래 이력이 남아야 합니다.')

/* ── 3. 제안 취소는 에스크로를 풀어준다 ──────────────────────────── */

// 김소담이 방금 받은 도토리분식 쿠폰(28%, 4,480원)을 소복소복 매물(21%, 4,830원)에 걸어본다.
const parkOffer = await ok('/api/listings/' + listedForCafe.listing.id + '/offers', {
  method: 'POST', body: JSON.stringify({ couponId: 'c-market-3' }),
}, owner.token)
assert((await ok('/api/me', {}, owner.token)).coupons.find((item: any) => item.id === 'c-market-3')?.status === 'offered', '제안 중인 쿠폰은 잠겨야 합니다.')
await ok(`/api/offers/${parkOffer.offer.id}`, { method: 'DELETE' }, owner.token)
assert((await ok('/api/me', {}, owner.token)).coupons.find((item: any) => item.id === 'c-market-3')?.status === 'available', '제안을 취소하면 쿠폰이 지갑으로 돌아와야 합니다.')
assert(!(await ok('/api/market/listings')).listings.some((item: any) => item.myOfferId), '취소한 제안은 남으면 안 됩니다.')

/* ── 3-b. 여러 제안 중 하나를 수락하면 나머지는 자동으로 풀린다 ── */

// 조건 없는 승인형 매물을 열고 두 사람에게서 유효한 제안을 받는다.
await ok('/api/listings/cl-6', { method: 'DELETE' }, marketB.token)   // 선만두 30% 를 지갑으로 회수
await ok('/api/listings/cl-4', { method: 'DELETE' }, marketA.token)   // 오후의 오븐 32% 를 지갑으로 회수
const multi = await ok('/api/coupons/c-market-6/list', {
  method: 'POST', body: JSON.stringify({ wantedCategories: [], wantedRegions: [], autoAccept: false }),
}, marketB.token)
const offerFromOwner = await ok(`/api/listings/${multi.listing.id}/offers`, { method: 'POST', body: JSON.stringify({ couponId: 'c-market-3' }) }, owner.token)
const offerFromA = await ok(`/api/listings/${multi.listing.id}/offers`, { method: 'POST', body: JSON.stringify({ couponId: 'c-market-4' }) }, marketA.token)
assert(offerFromOwner.offer && offerFromA.offer, '서로 다른 두 사람의 제안이 함께 대기해야 합니다.')

await ok(`/api/offers/${offerFromOwner.offer.id}/accept`, { method: 'POST' }, marketB.token)
const loser = await ok('/api/me', {}, marketA.token)
assert(loser.coupons.find((item: any) => item.id === 'c-market-4')?.status === 'available', '수락되지 않은 제안의 쿠폰은 자동으로 풀려야 합니다.')
assert(loser.notifications.some((item: any) => item.type === 'offer_declined'), '탈락한 제안자에게도 알림이 가야 합니다.')
const closed = await ok('/api/market/mine', {}, marketA.token)
assert(!closed.sentOffers.some((offer: any) => offer.id === offerFromA.id && offer.status === 'pending'), '마감된 매물의 제안이 대기 상태로 남으면 안 됩니다.')

/* ── 4. 동시성: 두 사람이 같은 매물을 동시에 집어가도 한 명만 성공 ── */

const raceListing = await ok('/api/coupons/c-market-7/list', {
  method: 'POST', body: JSON.stringify({ autoAccept: true }),
}, marketA.token)
const [first, second] = await Promise.all([
  post(`/api/listings/${raceListing.listing.id}/swap`, { couponId: 'c-1' }, investor.token),
  post(`/api/listings/${raceListing.listing.id}/swap`, { couponId: 'c-market-3' }, owner.token),
])
const winners = [first, second].filter((item) => item.ok)
assert(winners.length === 1, `동시 교환은 정확히 한 명만 성공해야 합니다. (성공 ${winners.length}건)`)
const trades = await ok('/api/market/mine', {}, marketA.token)
assert(trades.trades.filter((trade: any) => trade.gave?.id === 'c-market-7').length === 1, '같은 쿠폰이 두 번 넘어가면 안 됩니다.')

/* ── 5. 쿠폰 사용: 코드 발급 → 사장님 확인 → 매출 반영 ───────────── */

// 김소담(u-owner)은 소복소복 사장님이다. 소복소복 쿠폰을 가진 사람이 사용 요청을 한다.
const beforeStats = (await ok('/api/public')).stats.couponUsed
await ok(`/api/listings/${listedForCafe.listing.id}`, { method: 'DELETE' }, marketB.token)
const holderToken = marketB.token
const holder = (await ok('/api/me', {}, holderToken)).coupons.find((item: any) => item.restaurantId === 'r-sobok' && item.status === 'available')
assert(holder, '사용 테스트에 쓸 소복소복 쿠폰이 필요합니다.')

const redeem = await ok(`/api/coupons/${holder.id}/redeem`, { method: 'POST' }, holderToken)
assert(/^[0-9A-F]{8}$/.test(redeem.code), '8자리 사용 코드가 발급되어야 합니다.')
assert((await ok('/api/me', {}, holderToken)).coupons.find((item: any) => item.id === holder.id)?.status === 'redeeming', '사용 요청 중인 쿠폰은 잠겨야 합니다.')

const wrongCode = await post('/api/owner/coupons/verify', { code: 'DEADBEEF' }, owner.token)
assert(!wrongCode.ok, '없는 코드는 확인되면 안 됩니다.')

const verified = await ok('/api/owner/coupons/verify', { method: 'POST', body: JSON.stringify({ code: redeem.code }) }, owner.token)
assert(verified.coupon.status === 'used', '사장님 확인 후 쿠폰이 사용 처리되어야 합니다.')
const reuse = await post('/api/owner/coupons/verify', { code: redeem.code }, owner.token)
assert(!reuse.ok, '같은 코드를 두 번 쓸 수 없어야 합니다.')
const afterStats = (await ok('/api/public')).stats.couponUsed
assert(afterStats === beforeStats + holder.maxDiscountWon, '사용된 쿠폰 혜택 통계가 실제 사용액만큼 늘어야 합니다.')

/* ── 6. 교환장 조회 필터와 매칭 안내 ─────────────────────────────── */

const market = await ok('/api/market/listings?matchable=1', {}, investor.token)
for (const listing of market.listings) {
  assert(listing.matchableCouponIds.length > 0, 'matchable 필터는 교환 가능한 매물만 돌려줘야 합니다.')
  assert(listing.userId !== investor.user.id, '내 매물은 교환 대상에 뜨면 안 됩니다.')
}
const byRegion = await ok('/api/market/listings?region=서울')
assert(byRegion.listings.every((listing: any) => listing.restaurant.region === '서울'), '지역 필터가 동작해야 합니다.')

console.log('PASS: 조건 강제 | 에스크로 | 중복·자기교환 차단 | 동시 교환 1건만 체결 | 사용 코드 검증 | 교환장 필터')
