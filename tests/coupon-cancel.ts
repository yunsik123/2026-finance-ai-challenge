const base = 'http://localhost:8787'
async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json()
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
const before = await request('/api/public')
const listing = before.listings.find((item: any) => item.userId === login.user.id)
assert(listing?.couponId, '김소담 계정의 열린 교환 제안이 필요합니다.')

const cancelled = await request(`/api/listings/${listing.id}`, { method: 'DELETE' }, login.token)
assert(cancelled.coupon.status === 'available', '취소한 쿠폰은 즉시 available 상태로 돌아와야 합니다.')
const afterCancel = await request('/api/me', {}, login.token)
const recovered = afterCancel.coupons.find((item: any) => item.id === listing.couponId)
assert(recovered?.status === 'available', '취소한 쿠폰이 김소담 지갑에 다시 보여야 합니다.')
assert(!(await request('/api/public')).listings.some((item: any) => item.id === listing.id), '취소한 매물은 교환장에서 사라져야 합니다.')

const relisted = await request(`/api/coupons/${listing.couponId}/list`, { method: 'POST', body: JSON.stringify({ wantedCategory: listing.wantedCategory, wantedRegion: listing.wantedRegion }) }, login.token)
assert(relisted.listing.status === 'open', '검증 후 쿠폰을 다시 교환장에 복원해야 합니다.')
assert((await request('/api/me', {}, login.token)).coupons.find((item: any) => item.id === listing.couponId)?.status === 'listed', '재등록한 쿠폰은 listed 상태여야 합니다.')

console.log(`PASS: ${listing.coupon?.title} 취소 → 지갑 복원 → 교환장 재등록`)