import { io } from 'socket.io-client'

const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`
async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json() as Record<string, any>
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}

const checks: string[] = []
const publicState = await request('/api/public')
if (publicState.restaurants.length !== 12 || publicState.funds.length !== 12) throw new Error('seed count mismatch')
checks.push('12 restaurants and funds')

const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'investor@meoktu.demo', password: 'demo1234!' }) })
const me = await request('/api/me', {}, login.token)
if (!me.positions.length || !me.coupons.length) throw new Error('portfolio missing')
checks.push('investor login and portfolio')

const socket = io(base)
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('socket timeout')), 4000)
  socket.once('connected', () => { clearTimeout(timeout); resolve() })
})
const changed = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('realtime timeout')), 4000)
  socket.once('state:changed', () => { clearTimeout(timeout); resolve() })
})
await request('/api/funds/f-sobok/invest', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, login.token)
await changed
socket.disconnect()
checks.push('investment and realtime broadcast')

const ai = await request('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question: '소복소복 분석해줘' }) })
if (!ai.answer.includes('소복소복')) throw new Error('AI assistant failed')
checks.push('AI restaurant answer')

const owner = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
const review = await request('/api/applications', { method: 'POST', body: JSON.stringify({ restaurantName: '테스트키친', businessNumber: '1234567891', ownerName: '김소담', licenseNumber: '제2024-000123호', connectedSources: ['business', 'license', 'identity', 'pos', 'account', 'card', 'delivery', 'tax', 'customer', 'lease', 'debt', 'staff'], uploadedDocuments: { business: 'business.pdf', license: 'license.pdf', pos: 'pos.csv', account: 'account.csv', card: 'card.csv', delivery: 'delivery.csv', tax: 'tax.pdf', customer: 'customer.csv', lease: 'lease.pdf', debt: 'debt.pdf', staff: 'staff.csv' }, identityVerified: true, privacyConsent: true, creditConsent: true, fundPurpose: '주방 설비 교체', businessPlan: '조리 시간을 단축해 좌석 회전율과 고객 만족도를 높입니다.', requestedLimit: 30000000 }) }, owner.token)
if (!['approved', 'conditional'].includes(review.application.status)) throw new Error('review failed')
checks.push(`source-data review (${review.application.status}, ${review.application.score})`)

const html = await fetch(base).then((response) => response.text())
if (!html.includes('<title>먹투')) throw new Error('production client missing')
// 새로고침·북마크로 들어오는 깊은 링크도 SPA를 받아야 한다.
const deepLink = await fetch(`${base}/market`)
if (!deepLink.ok || !(await deepLink.text()).includes('<title>먹투')) throw new Error('SPA deep link fallback missing')
checks.push('production client served + deep link')
console.log(`PASS: ${checks.join(' | ')}`)
