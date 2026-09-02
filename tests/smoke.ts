import { readFileSync } from 'node:fs'
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

// 심사는 올린 CSV 본문을 실제로 합산해서 나온다.
// 예전에는 상호명 글자코드로 만든 난수를 지표로 썼기 때문에 파일 이름만 보내도 승인이 났다.
// 지금은 읽을 자료가 없으면 지표가 미산정이 되고 자동승인이 나오지 않아야 한다.
const samples = (name: string) => readFileSync(new URL(`../public/samples/${name}`, import.meta.url), 'utf8')
const documentContents = {
  pos: samples('meoktu-pos-sample.csv'), account: samples('meoktu-account-sample.csv'),
  card: samples('meoktu-card-settlement-sample.csv'), delivery: samples('meoktu-delivery-sample.csv'),
  customer: samples('meoktu-customer-sample.csv'), debt: samples('meoktu-debt-sample.csv'),
  staff: samples('meoktu-staff-sample.csv'),
}
const applicationBody = (contents: Record<string, string>) => JSON.stringify({
  restaurantName: '테스트키친', businessNumber: '1234567891', ownerName: '김소담', licenseNumber: '제2024-000123호',
  // 상권 지표는 주소로 매칭한다. 실제 신청서에서도 필수 입력이다.
  address: '서울특별시 마포구 망원동 12-3',
  connectedSources: ['business', 'license', 'identity', 'pos', 'account', 'card', 'delivery', 'tax', 'customer', 'lease', 'debt', 'staff'],
  uploadedDocuments: { business: 'business.pdf', license: 'license.pdf', pos: 'pos.csv', account: 'account.csv', card: 'card.csv', delivery: 'delivery.csv', tax: 'tax.pdf', customer: 'customer.csv', lease: 'lease.pdf', debt: 'debt.pdf', staff: 'staff.csv' },
  documentContents: contents, identityVerified: true, privacyConsent: true, creditConsent: true,
  fundPurpose: '주방 설비 교체', businessPlan: '조리 시간을 단축해 좌석 회전율과 고객 만족도를 높입니다.', requestedLimit: 30000000,
})

const review = await request('/api/applications', { method: 'POST', body: applicationBody(documentContents) }, owner.token)
if (!['approved', 'conditional'].includes(review.application.status)) {
  throw new Error(`review failed: ${review.application.status} (${review.application.score}점)`)
}
const metrics = review.application.data.derivedMetrics
if (!(metrics.recent12MonthAverageSales > 0)) throw new Error('POS 원자료에서 매출이 계산되지 않았습니다')
// 11,083행을 실제로 읽었다는 근거가 심사 기록에 남아야 한다.
// 근거는 화면용 지표가 아니라 별도 필드(metricEvidence)에 담긴다.
const posEvidence = (review.application.data.metricEvidence || []).find((item: { sourceId: string }) => item.sourceId === 'pos')
if (!posEvidence || posEvidence.rows < 1000) throw new Error('POS 파싱 근거가 남지 않았습니다')
if (!(review.application.data.creditAssessment.coverage > 50)) throw new Error('신용평가 산정률이 너무 낮습니다')
// 화면에 그대로 뿌려지는 지표라 집계 중간값이나 배열이 섞이면 안 된다.
for (const [key, value] of Object.entries(metrics)) {
  if (key.startsWith('_')) throw new Error(`화면용 지표에 내부 키가 섞였습니다: ${key}`)
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    throw new Error(`화면용 지표에 객체가 섞였습니다: ${key}`)
  }
}
// 주소만으로도 상권 지표가 채워져야 한다(등록 전 신청자 포함).
if (metrics.districtSalesGrowth === null) throw new Error('주소 기반 상권 매칭이 되지 않았습니다')
checks.push(`source-data review (${review.application.status}, ${review.application.score}점, POS ${posEvidence.rows}행, 산정률 ${review.application.data.creditAssessment.coverage}%)`)

// 같은 신청서인데 본문만 빼면 자동승인이 나오면 안 된다. 지어낸 값으로 채우지 않는다는 뜻이다.
const empty = await request('/api/applications', { method: 'POST', body: applicationBody({}) }, owner.token)
if (['approved', 'conditional'].includes(empty.application.status)) {
  throw new Error('읽을 자료가 없는데도 자동승인이 났습니다')
}
if (empty.application.data.derivedMetrics.recent12MonthAverageSales !== null) {
  throw new Error('자료가 없는데 매출 값이 만들어졌습니다')
}
checks.push(`no-data guard (${empty.application.status}, 매출 미산정)`)

const html = await fetch(base).then((response) => response.text())
if (!html.includes('<title>먹투')) throw new Error('production client missing')
// 새로고침·북마크로 들어오는 깊은 링크도 SPA를 받아야 한다.
const deepLink = await fetch(`${base}/market`)
if (!deepLink.ok || !(await deepLink.text()).includes('<title>먹투')) throw new Error('SPA deep link fallback missing')
checks.push('production client served + deep link')
console.log(`PASS: ${checks.join(' | ')}`)
