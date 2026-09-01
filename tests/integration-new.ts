const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`

async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json() as Record<string, any>
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const publicState = await request('/api/public')
const restaurant = publicState.restaurants[0]
const trust = await request(`/api/trust/${restaurant.id}`)
assert(trust.assessment.contributions.length === 5, '위험평가는 5개 구성요소를 공개해야 합니다.')
assert(trust.assessment.methodology.calibratedProbability === false, '예비점수를 부도확률로 표현하면 안 됩니다.')
assert(trust.graph.nodes.filter((node: any) => node.type === 'GuideStep').length === 7, '투자자 절차 그래프가 필요합니다.')

const investor = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'investor@meoktu.demo', password: 'demo1234!' }) })
await request(`/api/favorites/${restaurant.id}`, { method: 'PUT' }, investor.token)
assert((await request('/api/me', {}, investor.token)).favoriteRestaurantIds.includes(restaurant.id), '찜한 식당이 계정 원장에 저장되어야 합니다.')
await request(`/api/favorites/${restaurant.id}`, { method: 'DELETE' }, investor.token)
assert(!(await request('/api/me', {}, investor.token)).favoriteRestaurantIds.includes(restaurant.id), '찜 해제가 계정 원장에 반영되어야 합니다.')

const owner = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const ocr = await request('/api/ai/ocr', { method: 'POST', body: JSON.stringify({ image, filename: 'receipt.png', sourceId: 'tax', plan: '주방 설비 교체' }) }, owner.token)
assert(['ai_extracted', 'manual_review'].includes(ocr.analysis.status), 'OCR 결과는 자동 판독 또는 수동 검토 상태여야 합니다.')
const ownerData = await request('/api/owner', {}, owner.token)
assert(ownerData.ocrAnalyses.some((item: any) => item.id === ocr.analysis.id), 'OCR 구조화 결과가 원장에 남아야 합니다.')
assert(ownerData.auditEvents.some((item: any) => item.resourceId === ocr.analysis.id), 'OCR 작업 감사 이력이 남아야 합니다.')

console.log('PASS: trust model | role graph | favorites ledger | OCR/manual review | audit trail')
