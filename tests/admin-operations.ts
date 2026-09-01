const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`

async function raw(path: string, options: RequestInit = {}, token?: string) {
  return fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
}
async function ok(path: string, options: RequestInit = {}, token?: string) {
  const response = await raw(path, options, token)
  const body = await response.json() as Record<string, any>
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const admin = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@meoktu.demo', password: 'demo1234!' }) })
const investor = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'investor@meoktu.demo', password: 'demo1234!' }) })
assert((await raw('/api/admin/dashboard', {}, investor.token)).status === 403, '투자자는 관리자 운영 데이터를 볼 수 없어야 합니다.')

const dashboard = await ok('/api/admin/dashboard', {}, admin.token)
for (const key of ['users', 'applications', 'restaurants', 'funds', 'reviews', 'support', 'coupons']) assert(Array.isArray(dashboard[key]), `관리자 대시보드에 ${key} 목록이 필요합니다.`)

const user = dashboard.users[0]
if (user) {
  const original = user.accountStatus || 'active'
  const changed = original === 'active' ? 'suspended' : 'active'
  await ok(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ accountStatus: changed }) }, admin.token)
  assert((await ok('/api/admin/dashboard', {}, admin.token)).users.find((item: any) => item.id === user.id).accountStatus === changed, '회원 상태 변경이 저장되어야 합니다.')
  await ok(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ accountStatus: original }) }, admin.token)
}

const restaurant = dashboard.restaurants[0]
if (restaurant) {
  await ok(`/api/admin/restaurants/${restaurant.id}`, { method: 'PATCH', body: JSON.stringify({ salesDisclosure: !restaurant.salesDisclosure }) }, admin.token)
  await ok(`/api/admin/restaurants/${restaurant.id}`, { method: 'PATCH', body: JSON.stringify({ salesDisclosure: Boolean(restaurant.salesDisclosure) }) }, admin.token)
}

const review = dashboard.reviews[0]
if (review) {
  const original = review.status || 'published'
  await ok(`/api/admin/reviews/${review.id}`, { method: 'PATCH', body: JSON.stringify({ status: original === 'hidden' ? 'published' : 'hidden' }) }, admin.token)
  await ok(`/api/admin/reviews/${review.id}`, { method: 'PATCH', body: JSON.stringify({ status: original }) }, admin.token)
}

console.log('PASS: admin authorization | unified dashboard | reversible user/store/review operations')
