// AI 점주 경영 리포트 / AI 인사이트 해석 검증.
// AI 키가 없는 환경에서도 통과해야 한다. 두 엔드포인트 모두 생성형이 없으면
// 같은 모양의 규칙 기반 결과를 내려주는 것이 계약이기 때문이다.
import { detectSalesAnomalies } from '../server/ai-analysis.ts'
const base = process.env.MEOKTU_TEST_BASE || 'http://localhost:8787'
const call = async (path: string, options: RequestInit = {}, token?: string) => {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json() as Record<string, any>
  return { ok: response.ok, status: response.status, body }
}
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }

const synthetic = [100, 102, 101, 103, 102, 104, 170, 105].map((sales, index) => ({
  month: `2026-${String(index + 1).padStart(2, '0')}`, sales, growthRate: 0, bonusRate: 0,
}))
const syntheticDetection = detectSalesAnomalies(synthetic)
assert(syntheticDetection.anomalies.some((item) => item.month === '2026-07' && item.direction === 'increase'), '평소 흐름에서 벗어난 급등 월을 찾아야 합니다.')
assert(syntheticDetection.anomalies.some((item) => item.month === '2026-08' && item.direction === 'decrease'), '급등 뒤 원복된 급락도 별도 이상으로 찾아야 합니다.')

// 서버에 AI 키가 붙어 있으면 폴백으로 도는 것 자체가 회귀다. 그때는 생성형 경로를 강제로 검사한다.
const health = await call('/api/health')
const aiConfigured = health.body.ai === 'configured'
const expectProvider = (provider: string, where: string) => {
  assert(['google-vertex-ai', 'meoktu-rule-engine'].includes(provider), `알 수 없는 ${where} 생성 경로: ${provider}`)
  if (aiConfigured) assert(provider === 'google-vertex-ai', `AI 키가 설정됐는데 ${where}가 규칙 폴백으로 내려왔습니다.`)
}
console.log(aiConfigured ? `AI 연결됨(${health.body.aiModel}) — 생성형 경로를 검사합니다.` : 'AI 키 없음 — 규칙 폴백 경로를 검사합니다.')

const demo = await call('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'owner' }) })
assert(demo.ok, '사장님 체험 세션을 열 수 있어야 합니다.')
const ownerToken = demo.body.token as string

const report = await call('/api/ai/owner-report', { method: 'POST', body: JSON.stringify({}) }, ownerToken)
assert(report.ok, `경영 리포트 호출 실패: ${report.body.error}`)
const { facts, report: body, provider } = report.body
expectProvider(provider, '경영 리포트')
assert(/^\d{4}-\d{2}$/.test(facts.reportMonth), '리포트 기준 월이 있어야 합니다.')
assert(typeof facts.salesChange === 'number' && typeof facts.couponUseRate === 'number', '매출 변화와 쿠폰 사용률은 서버가 확정해 내려야 합니다.')
assert(facts.area?.name && typeof facts.area.localSalesGrowth === 'number' && typeof facts.area.competitorDensity === 'number', '상권 리포트에는 주소 기반 상권 원자료가 포함돼야 합니다.')
for (const key of ['headline', 'salesCause', 'repeatPlan', 'couponPlan', 'costCheck', 'tasks', 'watchout']) {
  assert(body[key], `리포트에 ${key} 칸이 있어야 합니다.`)
}
for (const key of ['salesCause', 'repeatPlan', 'couponPlan', 'costCheck']) {
  assert(body[key].title && body[key].body, `${key} 칸의 제목과 본문이 모두 채워져야 합니다.`)
}
assert(body.tasks.length >= 2 && body.tasks.length <= 4, '다음 달 실행 과제는 2~4개여야 합니다.')
assert(body.costCheck.items.length >= 1, '비용 점검 항목이 있어야 합니다.')
// 제안 할인율이 펀드가 정한 범위를 넘으면 사장님이 그대로 실행했을 때 손실 한도를 벗어난다.
assert(body.couponPlan.discount <= facts.maxDiscount, `제안 할인율 ${body.couponPlan.discount}%가 최대 할인율 ${facts.maxDiscount}%를 넘습니다.`)
assert(body.couponPlan.discount >= Math.min(facts.minIssueDiscount || 5, facts.maxDiscount), '제안 할인율이 최소 발급률보다 낮습니다.')
// 원가·세무 자료가 붙지 않은 상태에서 비용이 늘었다고 단정하면 사실이 아닌 진단이 된다.
if (!facts.hasCostData) {
  const costText = `${body.costCheck.title} ${body.costCheck.body}`
  assert(!/비용이\s*(늘|증가|상승)했|원가가\s*(올랐|늘)/.test(costText), `비용 자료 미연동인데 비용 증가를 단정했습니다: ${costText}`)
}
const allText = [body.headline, body.salesCause.body, body.repeatPlan.body, body.couponPlan.body, body.costCheck.body, body.watchout, ...body.tasks].join(' ')
assert(!/(수익|매출|원금).{0,6}보장/.test(allText), `보장 표현이 리포트에 들어갔습니다: ${allText}`)
// 내부 필드명이 사장님 문장에 그대로 나오면 읽을 수 없는 리포트가 된다.
assert(!/[a-z]{2,}[A-Z][a-z]/.test(allText), `내부 필드명이 리포트 문장에 노출됐습니다: ${allText}`)

const again = await call('/api/ai/owner-report', { method: 'POST', body: JSON.stringify({}) }, ownerToken)
assert(again.body.report.headline === body.headline, '자료가 그대로면 같은 해석을 재사용해야 합니다.')

const anonymous = await call('/api/ai/owner-report', { method: 'POST', body: JSON.stringify({}) })
assert(anonymous.status === 401, '로그인 없이 경영 리포트를 볼 수 없어야 합니다.')

const anomaly = await call('/api/ai/anomaly-detection', { method: 'POST', body: JSON.stringify({}) }, ownerToken)
assert(anomaly.ok, `이상탐지 호출 실패: ${anomaly.body.error}`)
assert(['google-vertex-ai', 'meoktu-statistical-engine'].includes(anomaly.body.provider), '이상탐지 생성 경로를 표시해야 합니다.')
if (aiConfigured && anomaly.body.result.status !== 'insufficient_data') assert(anomaly.body.provider === 'google-vertex-ai', 'AI 키가 설정됐는데 이상탐지 설명이 생성형 경로를 타지 않았습니다.')
assert(anomaly.body.result.method === 'robust-mad-v1', '이상탐지는 강건 MAD 알고리즘 버전을 공개해야 합니다.')
assert(anomaly.body.result.sampleSize >= 6, '체험 식당은 이상탐지에 충분한 월별 자료가 있어야 합니다.')
assert(Number.isFinite(anomaly.body.result.baselineChangeRate), '평소 월 변화 기준값이 숫자여야 합니다.')
assert(anomaly.body.result.expectedRange.min < anomaly.body.result.expectedRange.max, '정상 예상 범위를 내려줘야 합니다.')
assert(Array.isArray(anomaly.body.result.anomalies) && Array.isArray(anomaly.body.result.nextChecks), '이상 월과 확인 순서를 구조화해 내려줘야 합니다.')
const anonymousAnomaly = await call('/api/ai/anomaly-detection', { method: 'POST', body: JSON.stringify({}) })
assert(anonymousAnomaly.status === 401, '로그인 없이 사장님 매출 이상탐지를 볼 수 없어야 합니다.')

const publicState = await call('/api/public')
const ids = (publicState.body.restaurants as Array<{ id: string }>).slice(0, 2).map((item) => item.id)
const tooFew = await call('/api/ai/insight-summary', { method: 'POST', body: JSON.stringify({ restaurantIds: ids.slice(0, 1) }) })
assert(tooFew.status === 400, '가게를 1개만 고르면 해석을 거절해야 합니다.')
const duplicate = await call('/api/ai/insight-summary', { method: 'POST', body: JSON.stringify({ restaurantIds: [ids[0], ids[0]] }) })
assert(duplicate.status === 400, '같은 가게를 두 번 보내 비교 개수를 채울 수 없어야 합니다.')

const insight = await call('/api/ai/insight-summary', { method: 'POST', body: JSON.stringify({ restaurantIds: ids }) })
assert(insight.ok, `인사이트 해석 호출 실패: ${insight.body.error}`)
expectProvider(insight.body.provider, '인사이트 해석')
const summary = insight.body.summary
assert(summary.cards.length === ids.length, '선택한 가게 수만큼 해석 카드가 나와야 합니다.')
assert(summary.cards.every((card: { id: string }, index: number) => card.id === ids[index]), '카드 순서가 선택 순서와 같아야 합니다.')
assert(summary.cards.every((card: { traits: string[] }) => card.traits.length > 0), '모든 카드에 해석 문장이 있어야 합니다.')
assert(summary.comparison.length > 20, '비교 문단이 있어야 합니다.')
const insightText = [summary.comparison, ...summary.cards.flatMap((card: { traits: string[]; caution: string }) => [...card.traits, card.caution])].join(' ')
assert(!/(가장|제일)\s*(유리|좋|낫|추천)/.test(insightText), `특정 가게를 권유하는 표현이 들어갔습니다: ${insightText}`)
assert(!/(수익|원금).{0,6}보장/.test(insightText), `보장 표현이 해석에 들어갔습니다: ${insightText}`)
assert(!/[a-z]{2,}[A-Z][a-z]/.test(insightText), `내부 필드명이 해석 문장에 노출됐습니다: ${insightText}`)

console.log('✅ AI 경영 리포트·인사이트 해석 검증 통과')
