import assert from 'node:assert/strict'

const base = process.env.MEOKTU_TEST_BASE!
assert(process.env.MEOKTU_ISOLATED_AUDIT === '1' && /^http:\/\/127\.0\.0\.1:889[67]$/.test(base), 'Only isolated audit servers are allowed')
let passed = 0
const failures: string[] = []
const check = (name: string, value: unknown) => { if (value) passed++; else failures.push(name) }
const call = async (route: string, method = 'GET', body?: unknown, token?: string) => {
  const response = await fetch(base + route, { method, signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json().catch(() => null) as any }
}
const legal = (await call('/api/legal')).body
const stamp = Date.now()
const signup = async (role: string, suffix: string) => {
  const result = await call('/api/auth/signup', 'POST', { email: `audit-${stamp}-${suffix}@meoktu.test`,
    name: '격리검증', role, password: 'audit1234!', consent: { version: legal.version, documentIds: legal.required.signup } })
  assert.equal(result.status, 201, JSON.stringify(result.body))
  return result.body.token as string
}
const investor = await signup('investor', 'investor')
const owner = await signup('owner', 'owner')
const publicState = (await call('/api/public')).body
const restaurant = publicState.restaurants[0]
for (const route of ['/api/me', '/api/owner', '/api/admin/dashboard', '/api/admin/documents', '/api/admin/graph-audit', '/api/notifications', '/api/market/mine']) {
  check(`anonymous rejected ${route}`, (await call(route)).status === 401)
  check(`forged token rejected ${route}`, (await call(route, 'GET', undefined, 'forged.token.signature')).status === 401)
}
for (const route of ['/api/owner', '/api/admin/dashboard', '/api/admin/documents', '/api/admin/graph-audit']) {
  check(`investor role boundary ${route}`, (await call(route, 'GET', undefined, investor)).status === 403)
}
for (const route of ['/api/ai/owner-report', '/api/ai/anomaly-detection']) {
  check(`investor cannot request owner analysis ${route}`, (await call(route, 'POST', {}, investor)).status === 403)
  check(`owner cannot read another store ${route}`, [403, 404, 409].includes((await call(route, 'POST', { restaurantId: restaurant.id }, owner)).status))
}
for (const value of [null, '', 'abc', -1000, 0, {}, [], 'Infinity', 1e30]) {
  const before = (await call('/api/me', 'GET', undefined, investor)).body.user.cash
  const result = await call('/api/wallet/topup', 'POST', { amount: value }, investor)
  check(`invalid topup rejected ${JSON.stringify(value)}`, result.status === 400)
  check(`invalid topup preserves money ${JSON.stringify(value)}`, (await call('/api/me', 'GET', undefined, investor)).body.user.cash === before)
}
check('owner cannot topup', (await call('/api/wallet/topup', 'POST', { amount: 1000 }, owner)).status === 403)
check('unknown API returns JSON 404', (await call('/api/not-a-real-route')).status === 404 && Boolean((await call('/api/not-a-real-route')).body?.error))
const malformed = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' })
check('malformed JSON returns 400', malformed.status === 400)
check('malformed JSON returns safe JSON error', Boolean((await malformed.json().catch(() => null))?.error))
for (const route of ['/api/auth/login', '/api/wallet/topup', '/api/ai/owner-report']) {
  const missing = await fetch(base + route, { method: 'POST', headers: { Authorization: `Bearer ${investor}` } })
  check(`missing body is not 500 ${route}`, missing.status >= 400 && missing.status < 500)
}
for (const image of ['', 'invalid', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,!!!!']) {
  const result = await call('/api/ai/ocr', 'POST', { image, filename: 'audit.png' }, owner)
  check(`invalid OCR input rejected ${image}`, result.status === 400)
}
for (const query of ['내 지갑 잔액을 알려줘', '내 쿠폰 몇 장 있어?', '내 투자 현황 알려줘']) {
  const result = await call('/api/ai/chat', 'POST', { question: query, role: 'owner' }, investor)
  check(`AI forged role does not expose owner data ${query}`, result.status === 200 && !JSON.stringify(result.body.sources).includes('OwnerSituation'))
}
for (const rating of ['abc', {}, [], null, -1, 6, 'Infinity']) {
  await call(`/api/restaurants/${restaurant.id}/visit/verify`, 'POST', {}, investor)
  check(`invalid review rating rejected ${JSON.stringify(rating)}`,
    (await call(`/api/restaurants/${restaurant.id}/reviews`, 'POST', { rating, content: '격리 원장에만 보내는 리뷰 경계값 검증입니다.' }, investor)).status === 400)
}
check('public state does not expose password hashes', !JSON.stringify(publicState).includes('passwordHash'))
const me = (await call('/api/me', 'GET', undefined, investor)).body
check('own profile does not expose password hash', !JSON.stringify(me.user).includes('passwordHash'))
check('wallet remains finite after invalid requests', Number.isFinite(me.user.cash))
console.log(`Runtime audit: ${passed}/${passed + failures.length} checks passed`)
for (const failure of failures) console.error(`FAIL: ${failure}`)
if (failures.length) process.exitCode = 1
