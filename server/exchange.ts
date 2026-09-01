// 쿠폰 교환장 규칙 엔진.
// 서버 검증과 클라이언트 안내가 같은 규칙을 쓰도록, 판정 로직을 여기 한 곳에만 둔다.
import type { Coupon, CouponListing, CouponOffer, Restaurant } from './types.ts'

export const EXCHANGE_RULES = {
  /** 두 쿠폰의 할인율 차이가 이 값 미만이어야 교환된다. */
  maxDiscountGap: 10,
  /** 액면가(최대 할인 금액) 비율 상한. 30%인데 2,880원짜리와 11,520원짜리가 맞바꿔지는 걸 막는다. */
  maxValueRatio: 2.5,
  /** 만료가 이 일수보다 적게 남은 쿠폰은 교환장에 올릴 수도, 제안할 수도 없다. */
  minDaysLeft: 7,
  /** 등록한 교환 제안이 자동으로 만료되기까지의 기간. */
  listingTtlDays: 30,
  /** 보낸 교환 제안이 자동으로 만료되기까지의 기간. */
  offerTtlDays: 7,
  /** 한 사람이 동시에 열어둘 수 있는 교환 등록 수. */
  maxOpenListingsPerUser: 5,
  /** 한 사람이 동시에 보낼 수 있는 교환 제안 수. */
  maxPendingOffersPerUser: 10,
  /** 한 등록이 받을 수 있는 대기 제안 수. */
  maxOffersPerListing: 20,
  /** 사장님이 교환 코드를 확인하지 않으면 쿠폰이 지갑으로 되돌아가기까지의 시간(분). */
  redeemHoldMinutes: 20,
} as const

export type RuleIssue = { code: string; message: string }

/** 받침 유무에 따라 "…이에요 / …예요"를 골라 붙인다. */
function ieyo(word: string) {
  const last = word.codePointAt(word.length - 1) ?? 0
  const hangul = last >= 0xac00 && last <= 0xd7a3
  const hasBatchim = hangul ? (last - 0xac00) % 28 !== 0 : /[0-9a-zA-Z]$/.test(word)
  return `${word}${hasBatchim ? '이에요' : '예요'}`
}

const day = 86_400_000
export const daysLeft = (expiresAt: string, at = Date.now()) => (new Date(expiresAt).getTime() - at) / day

/** 지갑에서 꺼내 쓸 수 있는 상태인지. */
export const isSpendable = (coupon: Coupon) => coupon.status === 'available'

export function couponUsable(coupon: Coupon, at = Date.now()): RuleIssue[] {
  const issues: RuleIssue[] = []
  if (coupon.status === 'used') issues.push({ code: 'used', message: '이미 사용한 쿠폰이에요.' })
  else if (coupon.status === 'expired') issues.push({ code: 'expired', message: '기간이 지난 쿠폰이에요.' })
  else if (coupon.status === 'listed') issues.push({ code: 'listed', message: '이미 교환장에 올라가 있는 쿠폰이에요.' })
  else if (coupon.status === 'offered') issues.push({ code: 'offered', message: '다른 교환 제안에 걸어둔 쿠폰이에요.' })
  else if (coupon.status === 'redeeming') issues.push({ code: 'redeeming', message: '사장님 확인을 기다리는 중인 쿠폰이에요.' })
  const left = daysLeft(coupon.expiresAt, at)
  if (left <= 0) issues.push({ code: 'expired', message: '기간이 지난 쿠폰이에요.' })
  else if (left < EXCHANGE_RULES.minDaysLeft) {
    issues.push({ code: 'expiring', message: `만료 ${EXCHANGE_RULES.minDaysLeft}일 전부터는 교환할 수 없어요. (${Math.ceil(left)}일 남음)` })
  }
  return issues
}

export function normalizePreferences(input: unknown, allowed: string[]) {
  const list = Array.isArray(input) ? input : typeof input === 'string' && input.trim() ? [input] : []
  const cleaned = list.map((item) => String(item).trim()).filter((item) => item && item !== '상관없음' && allowed.includes(item))
  return [...new Set(cleaned)].slice(0, 6)
}

/**
 * 등록자가 걸어둔 조건(업종·지역·최소 할인율)에 제안 쿠폰이 맞는지 본다.
 * 조건 배열이 비어 있으면 "상관없음"이라 통과시킨다.
 */
export function matchesPreferences(listing: CouponListing, offeredRestaurant?: Restaurant, offered?: Coupon): RuleIssue[] {
  const issues: RuleIssue[] = []
  const categories = listing.wantedCategories || []
  const regions = listing.wantedRegions || []
  if (categories.length && (!offeredRestaurant || !categories.includes(offeredRestaurant.category))) {
    issues.push({ code: 'category', message: `등록자가 원하는 업종은 ${ieyo(categories.join('·'))}.` })
  }
  if (regions.length && (!offeredRestaurant || !regions.includes(offeredRestaurant.region))) {
    issues.push({ code: 'region', message: `등록자가 원하는 지역은 ${ieyo(regions.join('·'))}.` })
  }
  if (offered && listing.minDiscount > 0 && offered.discount < listing.minDiscount) {
    issues.push({ code: 'minDiscount', message: `등록자가 요청한 최소 할인율은 ${listing.minDiscount}%예요.` })
  }
  return issues
}

/** 두 쿠폰이 서로 맞바꿀 만한 값어치인지. 할인율 밴드 + 액면가 밴드를 함께 본다. */
export function balanced(a: Coupon, b: Coupon): RuleIssue[] {
  const issues: RuleIssue[] = []
  const gap = Math.abs(a.discount - b.discount)
  if (gap >= EXCHANGE_RULES.maxDiscountGap) {
    issues.push({ code: 'discountGap', message: `할인율 차이가 ${EXCHANGE_RULES.maxDiscountGap}% 미만이어야 해요. (현재 ${gap.toFixed(1)}%p)` })
  }
  const high = Math.max(a.maxDiscountWon, b.maxDiscountWon)
  const low = Math.min(a.maxDiscountWon, b.maxDiscountWon)
  if (low <= 0 || high / low > EXCHANGE_RULES.maxValueRatio) {
    const ratio = low > 0 ? (high / low).toFixed(1) : '∞'
    issues.push({ code: 'valueGap', message: `최대 할인 금액 차이가 ${EXCHANGE_RULES.maxValueRatio}배를 넘어요. (현재 ${ratio}배)` })
  }
  return issues
}

export type SwapContext = {
  listing: CouponListing
  wanted: Coupon
  offered: Coupon
  offeredRestaurant?: Restaurant
  offerUserId: string
  at?: number
}

/** 교환 한 건이 성립하는지 전부 확인한다. 제안 생성·수락·즉시교환이 모두 이 함수를 통과한다. */
export function checkSwap({ listing, wanted, offered, offeredRestaurant, offerUserId, at = Date.now() }: SwapContext) {
  const issues: RuleIssue[] = []
  if (listing.status !== 'open') issues.push({ code: 'listingClosed', message: '이미 마감된 교환 등록이에요.' })
  if (listing.userId === offerUserId) issues.push({ code: 'self', message: '내가 올린 쿠폰과는 교환할 수 없어요.' })
  if (offered.userId !== offerUserId) issues.push({ code: 'notOwned', message: '내가 가진 쿠폰만 제안할 수 있어요.' })
  if (offered.id === listing.couponId) issues.push({ code: 'sameCoupon', message: '같은 쿠폰끼리는 교환할 수 없어요.' })
  if (wanted.status !== 'listed') issues.push({ code: 'wantedGone', message: '상대 쿠폰이 이미 교환장에서 내려갔어요.' })
  if (daysLeft(wanted.expiresAt, at) <= 0) issues.push({ code: 'wantedExpired', message: '상대 쿠폰의 기간이 지났어요.' })
  issues.push(...couponUsable(offered, at).filter((issue) => issue.code !== 'offered'))
  issues.push(...matchesPreferences(listing, offeredRestaurant, offered))
  issues.push(...balanced(offered, wanted))
  const seen = new Set<string>()
  const unique = issues.filter((issue) => !seen.has(issue.code) && seen.add(issue.code))
  return { ok: unique.length === 0, issues: unique }
}

/** 만료 처리. 읽기·쓰기 전에 항상 한 번 돌려서 유령 매물이 남지 않게 한다. */
export function sweepExpired(input: { coupons: Coupon[]; couponListings: CouponListing[]; couponOffers: CouponOffer[] }, at = Date.now()) {
  const touched: string[] = []
  const listingById = new Map(input.couponListings.map((listing) => [listing.id, listing]))

  for (const offer of input.couponOffers) {
    if (offer.status !== 'pending') continue
    const listing = listingById.get(offer.listingId)
    const stale = new Date(offer.createdAt).getTime() + EXCHANGE_RULES.offerTtlDays * day < at
    const coupon = input.coupons.find((item) => item.id === offer.offerCouponId)
    const gone = !listing || listing.status !== 'open'
    const dead = !coupon || daysLeft(coupon.expiresAt, at) <= 0
    if (stale || gone || dead) {
      offer.status = 'expired'
      offer.resolvedAt = new Date(at).toISOString()
      if (coupon && coupon.status === 'offered') coupon.status = 'available'
      touched.push(`offer:${offer.id}`)
    }
  }

  for (const listing of input.couponListings) {
    if (listing.status !== 'open') continue
    const coupon = input.coupons.find((item) => item.id === listing.couponId)
    const stale = new Date(listing.expiresAt || listing.createdAt).getTime() < at
    const dead = !coupon || daysLeft(coupon.expiresAt, at) <= 0
    if (stale || dead) {
      listing.status = 'expired'
      if (coupon && coupon.status === 'listed') coupon.status = daysLeft(coupon.expiresAt, at) <= 0 ? 'expired' : 'available'
      touched.push(`listing:${listing.id}`)
    }
  }

  for (const coupon of input.coupons) {
    if (coupon.status === 'used' || coupon.status === 'expired') continue
    if (daysLeft(coupon.expiresAt, at) > 0) continue
    coupon.status = 'expired'
    touched.push(`coupon:${coupon.id}`)
  }

  // 사장님이 확인하지 않은 사용 요청은 지갑으로 되돌린다.
  for (const coupon of input.coupons) {
    if (coupon.status !== 'redeeming') continue
    const heldSince = new Date(coupon.redeemRequestedAt || coupon.createdAt).getTime()
    if (heldSince + EXCHANGE_RULES.redeemHoldMinutes * 60_000 >= at) continue
    coupon.status = daysLeft(coupon.expiresAt, at) > 0 ? 'available' : 'expired'
    coupon.redeemCode = undefined
    coupon.redeemRequestedAt = undefined
    touched.push(`redeem:${coupon.id}`)
  }

  return touched
}
