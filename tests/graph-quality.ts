/**
 * 지식그래프·AI 알고리즘 정밀 검증 (오프라인 100+ 케이스).
 *
 * 왜 필요한가.
 *   "AI가 그래프를 보고 답한다"는 설명은 그래프가 실제로 성립할 때만 참이다.
 *   지금까지의 통합 테스트는 엔드포인트가 200을 돌려주는지를 봤고, 그래프 자체가
 *   말이 되는지는 보지 않았다. 매달린 엣지 하나, 역할 경계 하나가 새면
 *   AI 답변은 조용히 틀린 근거를 읽는다.
 *
 * 그래서 서버·AI 없이 모듈을 직접 불러 다음을 검사한다.
 *   A. 그래프 구조 정합성 — 매달린 엣지·중복 id·절차 순서·속성 형태
 *   B. 역할 분리와 비공개 경계 — 투자자 그래프에 사장님 심사값이 섞이지 않는가
 *   C. 검색 적합성 — 질문마다 실제로 필요한 노드가 근거로 뽑히는가
 *   D. 답변 라우팅 — 현황 질문에 절차를 읊지 않는가
 *   E. 이상탐지 수학 — 중앙값·MAD 기반 판정이 실제로 로버스트한가
 *   F. 증거 원장 — 교차대조 점수·등급·미대조 처리
 *   G. 문서 자동 분류 — 열 이름·문서종류·파일명 신호
 *   H. 지표 집계 — 자료 제공처마다 다른 열 이름을 흡수하는가
 *
 * 실행: npm run test:graph
 */
import { buildKnowledgeGraph, retrieveKnowledgeSubgraph, answerGraphProcessQuestion, questionTerms, normalizeOcrBoxes, assessRestaurant } from '../server/trust.ts'
import {
  answerOwnerStatusQuestion, answerSupportQuestion, isOwnerStatusQuestion, isSupportQuestion,
  matchSupportPrograms, ownerSituation, ownerSituationGraph, reviewStages, supportProgramNodes,
} from '../server/knowledge.ts'
import { buildEvidenceLedger, metricMeta } from '../server/evidence.ts'
import { classifyDocument, correctionStats, fieldsFromOcr, type OwnerDocument } from '../server/documents.ts'
import { deriveMetricsFromUploads } from '../server/metrics.ts'
import { detectSalesAnomalies, buildOwnerReportFacts, ownerReportFallback, insightFallback, normalizeOwnerReport, normalizeInsight } from '../server/ai-analysis.ts'
import { orchestrateFinancialVerification, verifyBusiness } from '../server/verification.ts'
import { assessCredit, deriveCreditInput, toIndustry } from '../server/credit.ts'
import { restaurants as seedRestaurants, funds as seedFunds } from '../server/seed.ts'
import type { Application, OcrAnalysis } from '../server/types.ts'

/* ── 작은 테스트 러너 ─────────────────────────────────────── */

let passed = 0
const failures: string[] = []
const groupCounts = new Map<string, number>()
let group = ''

const describe = (name: string) => { group = name }
const check = (name: string, condition: unknown, detail = '') => {
  groupCounts.set(group, (groupCounts.get(group) || 0) + 1)
  if (condition) { passed += 1; return }
  failures.push(`[${group}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected), `기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`)
const near = (name: string, actual: number | null, expected: number, tolerance = 0.5) =>
  check(name, actual !== null && Math.abs(actual - expected) <= tolerance, `기대 ${expected}±${tolerance}, 실제 ${actual}`)

/* ── 공통 고정물 ──────────────────────────────────────────── */

const restaurant = seedRestaurants[0]
const fund = seedFunds.find((item) => item.restaurantId === restaurant.id)
const assessment = assessRestaurant(restaurant, fund)

const investorGraph = buildKnowledgeGraph('investor', restaurant, fund, {
  assessment, holding: { amount: 120_000, couponProgress: 12.4, early: true },
})
const ownerGraph = buildKnowledgeGraph('owner', restaurant, fund, {
  assessment,
  claim: { verificationStatus: 'manual_review', requestedLimit: 30_000_000, dataConfidence: 82 },
  verification: { status: 'needs_review', readyForAdminReview: false, mismatchCount: 2, missingCount: 1 },
})
const policyOnlyGraph = buildKnowledgeGraph('investor')

const ocrAnalysis = (over: Partial<OcrAnalysis> & { result?: Record<string, unknown> } = {}): OcrAnalysis => ({
  id: over.id || 'ocr-1',
  userId: 'u-owner',
  filename: over.filename || 'doc.png',
  sourceId: over.sourceId || 'tax',
  plan: '검증',
  result: over.result || {},
  model: 'test',
  status: over.status || 'ai_extracted',
  createdAt: '2026-09-01T00:00:00.000Z',
})

/* ══ A. 그래프 구조 정합성 ═══════════════════════════════════ */
describe('A. 그래프 구조')

for (const [label, graph] of [['투자자', investorGraph], ['사장님', ownerGraph]] as const) {
  const ids = new Set(graph.nodes.map((node) => node.id))
  check(`${label} 그래프에 노드가 있다`, graph.nodes.length > 10, `노드 ${graph.nodes.length}개`)
  check(`${label} 그래프에 엣지가 있다`, graph.edges.length > 5, `엣지 ${graph.edges.length}개`)

  const dangling = graph.edges.filter((edge) => !ids.has(edge.from) || !ids.has(edge.to))
  eq(`${label} 그래프에 매달린 엣지가 없다`, dangling.map((edge) => `${edge.from}-${edge.relation}->${edge.to}`), [])

  const duplicates = graph.nodes.map((node) => node.id).filter((id, index, all) => all.indexOf(id) !== index)
  eq(`${label} 그래프의 노드 id가 중복되지 않는다`, duplicates, [])

  eq(`${label} 그래프 버전이 고정돼 있다`, graph.graphVersion, 'meoktu-role-graph-v2')

  const steps = graph.nodes.filter((node) => node.type === 'GuideStep')
    .sort((a, b) => Number(a.properties.order) - Number(b.properties.order))
  check(`${label} 절차 단계가 존재한다`, steps.length >= 6, `단계 ${steps.length}개`)
  eq(`${label} 절차 순서가 1부터 빈틈없이 이어진다`,
    steps.map((step) => Number(step.properties.order)),
    steps.map((_, index) => index + 1))

  const nextEdges = graph.edges.filter((edge) => edge.relation === 'NEXT')
  eq(`${label} NEXT 엣지가 단계 수보다 하나 적다`, nextEdges.length, steps.length - 1)

  const pages = new Set(graph.nodes.filter((node) => node.type === 'SitePage').map((node) => node.id))
  check(`${label} 화면 지도 노드가 붙어 있다`, pages.size >= 3, `화면 ${pages.size}개`)
  const stepsWithScreen = new Set(graph.edges.filter((edge) => edge.relation === 'HAPPENS_ON').map((edge) => edge.from))
  check(`${label} 모든 절차 단계가 화면과 연결된다`,
    steps.every((step) => stepsWithScreen.has(step.id)),
    `연결 안 된 단계: ${steps.filter((step) => !stepsWithScreen.has(step.id)).map((step) => step.label).join(', ')}`)

  check(`${label} 서비스 규칙 노드가 있다`, graph.nodes.some((node) => node.type === 'ServiceRule'))
  check(`${label} 모든 노드에 출처가 있다`, graph.nodes.every((node) => Boolean(node.source)),
    graph.nodes.filter((node) => !node.source).map((node) => node.id).join(', '))
  check(`${label} 모든 노드에 라벨이 있다`, graph.nodes.every((node) => node.label.trim().length > 0))

  const badProperty = graph.nodes.flatMap((node) => Object.entries(node.properties)
    .filter(([, value]) => value === null || value === undefined || typeof value === 'object')
    .map(([key]) => `${node.id}.${key}`))
  eq(`${label} 노드 속성이 스칼라 값만 갖는다`, badProperty, [])

  const tooLong = graph.nodes.flatMap((node) => Object.entries(node.properties)
    .filter(([, value]) => typeof value === 'string' && value.length > 200)
    .map(([key]) => `${node.id}.${key}`))
  eq(`${label} 문자열 속성이 200자를 넘지 않는다`, tooLong, [])
}

check('식당 노드가 붙는다', investorGraph.nodes.some((node) => node.id === `restaurant:${restaurant.id}`))
check('상권 노드와 LOCATED_IN 엣지가 함께 붙는다',
  investorGraph.nodes.some((node) => node.type === 'CommercialArea')
  && investorGraph.edges.some((edge) => edge.relation === 'LOCATED_IN'))
check('펀드 노드와 RAISES 엣지가 함께 붙는다',
  investorGraph.nodes.some((node) => node.type === 'FundingCampaign')
  && investorGraph.edges.some((edge) => edge.relation === 'RAISES'))
check('식당 없이 만든 그래프는 정책 노드만 갖는다',
  !policyOnlyGraph.nodes.some((node) => ['Restaurant', 'FundingCampaign', 'CommercialArea', 'CreditAssessment'].includes(node.type)))
check('식당 없는 그래프도 매달린 엣지가 없다', (() => {
  const ids = new Set(policyOnlyGraph.nodes.map((node) => node.id))
  return policyOnlyGraph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))
})())

/* ══ B. 역할 분리와 비공개 경계 ═════════════════════════════ */
describe('B. 역할 분리')

eq('투자자 그래프의 역할 표시', investorGraph.role, 'investor')
eq('사장님 그래프의 역할 표시', ownerGraph.role, 'owner')
check('투자자 절차와 사장님 절차의 단계 라벨이 다르다',
  JSON.stringify(investorGraph.nodes.filter((n) => n.type === 'GuideStep').map((n) => n.label))
  !== JSON.stringify(ownerGraph.nodes.filter((n) => n.type === 'GuideStep').map((n) => n.label)))
check('투자자 그래프에는 사장님 제출 수치 노드가 없다',
  !investorGraph.nodes.some((node) => node.type === 'FinancialClaim'))
check('투자자 그래프에는 교차검증 실행 노드가 없다',
  !investorGraph.nodes.some((node) => node.type === 'VerificationRun'))
check('사장님 그래프에는 투자자 보유분 노드가 없다',
  !ownerGraph.nodes.some((node) => node.type === 'InvestorHolding'))
check('사장님 그래프에는 제출 수치 노드가 있다',
  ownerGraph.nodes.some((node) => node.type === 'FinancialClaim'))
check('사장님 그래프에는 교차검증 노드가 있다',
  ownerGraph.nodes.some((node) => node.type === 'VerificationRun'))
check('투자자 그래프에는 보유분 노드가 있다',
  investorGraph.nodes.some((node) => node.type === 'InvestorHolding'))
check('맥락을 주지 않으면 보유분·제출수치 노드가 생기지 않는다', (() => {
  const bare = buildKnowledgeGraph('owner', restaurant, fund)
  return !bare.nodes.some((node) => ['InvestorHolding', 'FinancialClaim', 'VerificationRun', 'CreditAssessment'].includes(node.type))
})())
check('예비평가 노드 라벨에 등급과 점수가 들어간다', (() => {
  const node = investorGraph.nodes.find((item) => item.type === 'CreditAssessment')
  return Boolean(node && /\d/.test(node.label))
})())
check('예비평가 노드는 확률 보정이 아님을 명시한다', (() => {
  const node = investorGraph.nodes.find((item) => item.type === 'CreditAssessment')
  return node?.properties.calibratedProbability === false
})())
check('매출 비공개 식당은 그래프 속성에 그 사실이 남는다', (() => {
  const priv = buildKnowledgeGraph('investor', { ...restaurant, salesDisclosure: false }, fund)
  const node = priv.nodes.find((item) => item.type === 'Restaurant')
  return node?.properties.salesDisclosure === false
})())
check('식당 노드에 정확한 월매출액이 실려 나가지 않는다', (() => {
  const node = investorGraph.nodes.find((item) => item.type === 'Restaurant')
  return !Object.keys(node?.properties || {}).includes('monthlySales')
})())

/* ══ C. 검색 적합성 ═════════════════════════════════════════ */
describe('C. 검색 적합성')

/** 질문을 넣고 뽑힌 노드에서 특정 타입/조건이 나오는지 본다. */
const retrieved = (graph: typeof investorGraph, question: string) => retrieveKnowledgeSubgraph(graph, question)
const hasType = (graph: typeof investorGraph, question: string, type: string) =>
  retrieved(graph, question).nodes.some((node) => node.type === type)
const hasText = (graph: typeof investorGraph, question: string, needle: string) =>
  JSON.stringify(retrieved(graph, question)).includes(needle)

const retrievalCases: Array<[string, typeof investorGraph, string, string]> = [
  ['펀딩 신청은 어떻게 하나요?', ownerGraph, 'GuideStep', '신청 절차 질문은 절차 노드를 본다'],
  ['투자는 어떤 순서로 참여해요?', investorGraph, 'GuideStep', '참여 절차 질문은 절차 노드를 본다'],
  ['쿠폰 교환 조건이 뭐예요?', investorGraph, 'ServiceRule', '조건 질문은 규칙 노드를 본다'],
  ['할인율 차이 제한이 몇 %인가요?', investorGraph, 'ServiceRule', '숫자 규칙 질문은 규칙 노드를 본다'],
  ['에스크로는 며칠 잠기나요?', investorGraph, 'ServiceRule', '에스크로 질문은 규칙 노드를 본다'],
  ['이 동네 상권은 어떤가요?', investorGraph, 'CommercialArea', '상권 질문은 상권 노드를 본다'],
  ['목표 금액이 얼마인가요?', investorGraph, 'FundingCampaign', '모금 질문은 펀드 노드를 본다'],
  ['내 투자잔액이 얼마예요?', investorGraph, 'InvestorHolding', '보유분 질문은 보유 노드를 본다'],
  ['이 식당 재방문율이 어때요?', investorGraph, 'Restaurant', '식당 지표 질문은 식당 노드를 본다'],
  ['교차검증에서 뭐가 안 맞았어요?', ownerGraph, 'VerificationRun', '검증 질문은 검증 노드를 본다'],
  ['제가 낸 자료로 신뢰도가 얼마예요?', ownerGraph, 'FinancialClaim', '제출자료 질문은 제출 노드를 본다'],
  ['예비평가 등급이 왜 이렇게 나왔어요?', ownerGraph, 'CreditAssessment', '등급 질문은 평가 노드를 본다'],
  ['쿠폰은 어디서 교환하나요?', investorGraph, 'SitePage', '화면 위치 질문은 화면 노드를 본다'],
  ['먹투머니는 어디서 충전해요?', investorGraph, 'SitePage', '충전 위치 질문은 화면 노드를 본다'],
]
for (const [question, graph, type, name] of retrievalCases) {
  check(name, hasType(graph, question, type), `질문 "${question}" → 뽑힌 타입 ${[...new Set(retrieved(graph, question).nodes.map((n) => n.type))].join(', ')}`)
}

check('검색은 언제나 근거를 하나 이상 돌려준다',
  ['아무 말', '?', '알려줘', '음', '어떻게'].every((question) => retrieved(investorGraph, question).nodes.length > 0))
check('검색 결과는 요청 한도 근처로 제한된다',
  retrieved(investorGraph, '쿠폰 투자 회수 심사 상권 자료 교환 할인율').nodes.length <= 12,
  `노드 ${retrieved(investorGraph, '쿠폰 투자 회수 심사 상권 자료 교환 할인율').nodes.length}개`)
check('검색 결과의 엣지는 뽑힌 노드와 이어진다', (() => {
  const subgraph = retrieved(ownerGraph, '심사 자료 어떻게 제출해요')
  const ids = new Set(subgraph.nodes.map((node) => node.id))
  return subgraph.edges.every((edge) => ids.has(edge.from) || ids.has(edge.to))
})())
check('검색 결과에 그래프 버전이 실린다', retrieved(investorGraph, '투자 절차').graphVersion === 'meoktu-role-graph-v2')
check('sources 는 4건 이하로 요약된다', retrieved(investorGraph, '쿠폰 교환 할인율 조건 제한').sources.length <= 4)
check('sources 항목에 id·label·type 이 모두 있다',
  retrieved(investorGraph, '쿠폰 교환 조건').sources.every((item) => item.id && item.label && item.type))
check('같은 질문은 항상 같은 결과를 준다', (() => {
  const first = JSON.stringify(retrieved(ownerGraph, '자료 뭐 내야 해요').nodes.map((n) => n.id))
  const second = JSON.stringify(retrieved(ownerGraph, '자료 뭐 내야 해요').nodes.map((n) => n.id))
  return first === second
})())
check('상권 질문에 상권명이 실제로 실린다', hasText(investorGraph, '망원동 상권 어때요', '망원'))

const terms = questionTerms('쿠폰 할인율 차이 제한이 몇 %야?')
check('규칙 의도를 감지한다', terms.asksRule)
check('검색어를 두 글자 이상으로 자른다', terms.terms.every((term) => term.length > 1))
check('별칭이 확장된다', terms.terms.includes('할인율'))
check('절차 질문은 규칙 의도로 잡히지 않는다', !questionTerms('펀딩 신청 절차 알려주세요').asksRule)
check('숫자 표기가 달라도 규칙 의도를 잡는다', questionTerms('며칠이나 잠기나요').asksRule)

/* ══ D. 답변 라우팅 ═════════════════════════════════════════ */
describe('D. 답변 라우팅')

check('절차 질문에는 단계 목록으로 답한다',
  answerGraphProcessQuestion('펀딩 신청 절차가 어떻게 되나요', retrieved(ownerGraph, '펀딩 신청 절차가 어떻게 되나요')).includes('1.'))
eq('절차와 무관한 질문에는 빈 답을 준다',
  answerGraphProcessQuestion('오늘 날씨 어때', retrieved(investorGraph, '오늘 날씨 어때')), '')
check('사장님 절차 답변은 화면 메뉴가 아니라 순서임을 밝힌다',
  answerGraphProcessQuestion('심사 자료 제출 절차', retrieved(ownerGraph, '심사 자료 제출 절차')).includes('순서'))

const ownerStatusQuestions = ['내 심사 어떻게 돼가요?', '심사 어디까지 진행됐어요', '뭐가 부족해요?', '제 가게 펀딩 상태 알려줘']
for (const question of ownerStatusQuestions) {
  check(`현황 질문으로 인식한다: ${question}`, isOwnerStatusQuestion(question))
}
for (const question of ['쿠폰 교환은 어디서 해요?', '투자 한도가 얼마예요?', '먹투가 뭐하는 곳이에요?']) {
  check(`현황 질문이 아니다: ${question}`, !isOwnerStatusQuestion(question))
}
for (const question of ['정부 지원 뭐 받을 수 있어요?', '소상공인 정책자금 알려줘', '폐업하면 뭐가 있나요?']) {
  check(`지원제도 질문으로 인식한다: ${question}`, isSupportQuestion(question))
}
check('지원제도 답변에 기준 시점이 붙는다', /202\d/.test(answerSupportQuestion('정책자금 알려줘')))
check('제도 이름 없이 물어도 대표 제도를 찾는다', matchSupportPrograms('정책자금', 3).length > 0 || isSupportQuestion('정책자금'))
check('지원제도 노드도 그래프 규격을 지킨다',
  supportProgramNodes(matchSupportPrograms('정책자금 대출', 2)).every((node) => node.id && node.label && node.source))

const noApplication = ownerSituation({ connections: [], restaurant, fund })
const submitted: Application = {
  id: 'app-1', userId: 'u-owner', restaurantName: restaurant.name, submittedAt: '2026-09-01T00:00:00.000Z',
  status: 'manual_review', requestedLimit: 30_000_000, approvedLimit: 0, score: 58,
  data: { connectedSources: ['business', 'license', 'identity', 'pos', 'account'], dataConfidence: 78, financialVerification: { mismatches: ['월 매출 불일치'] } },
  strengths: [], checks: [], improvements: [], explanation: '',
}
const inReview = ownerSituation({ application: submitted, connections: [], restaurant, fund })
const approved = ownerSituation({ application: { ...submitted, status: 'approved', score: 81 }, connections: [], restaurant, fund })

check('신청 전이면 접수 전으로 말한다', !noApplication.hasApplication && noApplication.statusLabel.includes('전'))
check('신청 전에는 6단계 중 마지막 단계로 튀지 않는다', noApplication.currentStage.order < reviewStages.length)
check('접수 후에는 단계 문장을 완성해서 준다', /\d단계 중 \d단계/.test(inReview.stageLabel))
eq('수동 심사 상태 문구', inReview.statusLabel, '운영자 확인 중')
check('불일치 건수를 현황에 담는다', inReview.mismatches.length === 1)
check('승인 + 공개 펀드면 마지막 단계로 간다', approved.currentStage.order === reviewStages.length)
check('현황 답변에 단계 문장이 그대로 쓰인다', answerOwnerStatusQuestion(inReview).includes(inReview.stageLabel))
check('현황 답변에 다음 할 일이 번호로 붙는다', answerOwnerStatusQuestion(inReview).includes('1.'))
check('현황 그래프 노드가 규격을 지킨다', (() => {
  const graph = ownerSituationGraph(inReview, `restaurant:${restaurant.id}`)
  const ids = new Set(graph.nodes.map((node) => node.id))
  return graph.nodes.every((node) => node.id && node.label)
    && graph.edges.every((edge) => ids.has(edge.from) || edge.to.startsWith('restaurant:') || ids.has(edge.to))
})())
check('현황 그래프는 신청 전에도 만들어진다', ownerSituationGraph(noApplication).nodes.length > 0)

/* ══ E. 이상탐지 수학 ═══════════════════════════════════════ */
describe('E. 이상탐지')

const series = (values: number[]) => values.map((sales, index) => ({
  month: `2026-${String(index + 1).padStart(2, '0')}`, sales, growthRate: 0, bonusRate: 0,
}))

const spike = detectSalesAnomalies(series([100, 102, 101, 103, 102, 104, 170, 105]))
check('급등 월을 찾는다', spike.anomalies.some((item) => item.month === '2026-07' && item.direction === 'increase'))
check('급등 뒤 원복도 급락으로 본다', spike.anomalies.some((item) => item.month === '2026-08' && item.direction === 'decrease'))
check('이상 상태를 정해진 값으로 표시한다', ['normal', 'watch', 'critical', 'insufficient_data'].includes(spike.status), `상태 ${spike.status}`)
check('이상이 있으면 normal 이 아니다', spike.status !== 'normal')

const smooth = detectSalesAnomalies(series([100, 103, 106, 109, 112, 115, 118, 121]))
eq('완만한 성장은 이상으로 잡지 않는다', smooth.anomalies.length, 0)
eq('완만한 성장의 상태는 normal', smooth.status, 'normal')

const flat = detectSalesAnomalies(series([100, 100, 100, 100, 100, 100]))
eq('변화가 전혀 없으면 이상이 없다', flat.anomalies.length, 0)

const dip = detectSalesAnomalies(series([200, 205, 198, 202, 60, 199, 203, 201]))
check('급락 월을 찾는다', dip.anomalies.some((item) => item.month === '2026-05' && item.direction === 'decrease'))

const short = detectSalesAnomalies(series([100, 130]))
eq('자료가 6개월 미만이면 판정을 미룬다', short.status, 'insufficient_data')
eq('빈 자료도 안전하게 처리한다', detectSalesAnomalies([]).anomalies.length, 0)
check('한 번의 극단값이 기준선을 흔들지 않는다', (() => {
  const withOutlier = detectSalesAnomalies(series([100, 101, 99, 100, 5000, 100, 101, 99]))
  // 5000이 평균을 끌어올려도 나머지 달을 이상으로 오판하면 안 된다.
  return withOutlier.anomalies.filter((item) => item.direction === 'increase').length <= 2
})())
check('모든 이상 항목에 월과 방향이 있다',
  spike.anomalies.every((item) => /^\d{4}-\d{2}$/.test(item.month) && ['increase', 'decrease'].includes(item.direction)))

/* ══ F. 증거 원장 ═══════════════════════════════════════════ */
describe('F. 증거 원장')

const baseEvidence = [
  { sourceId: 'pos', file: 'pos.csv', rows: 3120, columns: ['영업일', '주문금액'], produced: ['recent12MonthAverageSales'] },
  { sourceId: 'account', file: 'account.csv', rows: 1204, columns: ['거래일시', '입금액'], produced: ['accountMonthlyInflow'] },
]
const matched = buildEvidenceLedger({
  metrics: { recent12MonthAverageSales: 36_100_000, accountMonthlyInflow: 35_760_000 },
  evidence: baseEvidence, analyses: [], uploadedSources: ['pos', 'account'], partnerSources: [],
})
const posAccount = matched.crossChecks.find((item) => item.code === 'pos-account')
eq('매출↔계좌 대조가 만들어진다', posAccount?.code, 'pos-account')
near('차이율을 큰 쪽 기준으로 계산한다', posAccount?.differenceRate ?? null, 0.9, 0.2)
eq('허용 범위 안이면 통과', posAccount?.status, 'passed')
check('통과한 대조는 90점 이상', (posAccount?.score ?? 0) >= 90, `점수 ${posAccount?.score}`)
check('종합 점수가 나온다', matched.quality.score !== null)
eq('종합 등급이 높음', matched.quality.grade, '높음')
eq('대조 가능한 쌍 수는 고정', matched.quality.possiblePairs, 8)
check('아직 대조 못한 항목을 이름으로 남긴다', matched.quality.notCompared.length > 0)
check('매출 지표에 근거가 두 건 이상 붙는다', (() => {
  const link = matched.links.find((item) => item.metric === 'recent12MonthAverageSales')
  return (link?.supports.length || 0) >= 2
})())
check('근거에 파일명과 행수가 남는다', (() => {
  const link = matched.links.find((item) => item.metric === 'recent12MonthAverageSales')
  return link?.supports.some((support) => support.file === 'pos.csv' && support.rows === 3120) || false
})())

const mismatchedLedger = buildEvidenceLedger({
  metrics: { recent12MonthAverageSales: 18_000_000, accountMonthlyInflow: 26_000_000, cardMonthlyAverage: 21_000_000 },
  evidence: baseEvidence, analyses: [], uploadedSources: ['pos', 'account', 'card'], partnerSources: [],
})
check('큰 차이는 통과로 처리하지 않는다',
  mismatchedLedger.crossChecks.find((item) => item.code === 'pos-account')?.status !== 'passed')
eq('카드가 매출보다 크면 불일치', mismatchedLedger.crossChecks.find((item) => item.code === 'pos-card')?.status, 'failed')
check('불일치 설명을 사장님 문장으로 남긴다',
  mismatchedLedger.quality.mismatches.some((text) => text.includes('카드')))
check('불일치가 있으면 등급이 높음이 아니다', mismatchedLedger.quality.grade !== '높음')

const quarterlyTax = buildEvidenceLedger({
  metrics: { recent12MonthAverageSales: 36_000_000 },
  evidence: [baseEvidence[0]], analyses: [ocrAnalysis({
    sourceId: 'tax', filename: 'vat.png',
    result: { total: 108_000_000, periodStart: '2026-04-01', periodEnd: '2026-06-30', confidence: .93 },
  })],
  uploadedSources: ['pos', 'tax'], partnerSources: [],
})
const taxCheck = quarterlyTax.crossChecks.find((item) => item.code === 'pos-tax')
eq('분기 신고액을 월 기준으로 환산한다', taxCheck?.right.value, 36_000_000)
eq('환산 후 일치하면 통과', taxCheck?.status, 'passed')

const undatedTax = buildEvidenceLedger({
  metrics: { recent12MonthAverageSales: 36_000_000 },
  evidence: [baseEvidence[0]],
  analyses: [ocrAnalysis({ sourceId: 'tax', result: { total: 108_000_000, confidence: .9 } })],
  uploadedSources: ['pos', 'tax'], partnerSources: [],
})
eq('과세기간을 못 읽으면 통과로 두지 않는다', undatedTax.crossChecks.find((item) => item.code === 'pos-tax')?.status, 'review')

const wrongNumber = buildEvidenceLedger({
  metrics: {}, evidence: [],
  analyses: [ocrAnalysis({ sourceId: 'business', result: { businessNumber: '999-99-99999', confidence: .95 } })],
  uploadedSources: ['business'], partnerSources: [], declared: { businessNumber: '123-45-67891' },
})
const identityCheck = wrongNumber.crossChecks.find((item) => item.code === 'identity-document')
eq('사업자번호가 다르면 불일치', identityCheck?.status, 'failed')
eq('사업자번호 불일치는 0점', identityCheck?.score, 0)

const sameNumber = buildEvidenceLedger({
  metrics: {}, evidence: [],
  analyses: [ocrAnalysis({ sourceId: 'business', result: { businessNumber: '123-45-67891', confidence: .95 } })],
  uploadedSources: ['business'], partnerSources: [], declared: { businessNumber: '123-45-67891' },
})
eq('사업자번호가 같으면 통과', sameNumber.crossChecks.find((item) => item.code === 'identity-document')?.status, 'passed')

const empty = buildEvidenceLedger({ metrics: {}, evidence: [], analyses: [], uploadedSources: [], partnerSources: [] })
eq('대조할 게 없으면 점수는 0이 아니라 미산정', empty.quality.score, null)
eq('미산정일 때 등급도 미산정', empty.quality.grade, '미산정')
eq('미산정일 때 대조 쌍은 0', empty.quality.comparedPairs, 0)
check('가중평균이 실제로 가중치를 쓴다', (() => {
  // 가중치 3의 매출↔계좌는 완벽, 가중치 1의 인건비는 어긋난 상황.
  const ledger = buildEvidenceLedger({
    metrics: { recent12MonthAverageSales: 10_000_000, accountMonthlyInflow: 10_000_000, monthlyPayroll: 20_000_000 },
    evidence: baseEvidence, analyses: [], uploadedSources: ['pos', 'account', 'staff'], partnerSources: [],
  })
  const payroll = ledger.crossChecks.find((item) => item.code === 'payroll-sales')
  // 단순 평균이면 50점, 가중평균이면 3:1 이라 75점 부근이어야 한다.
  return payroll?.score === 0 && (ledger.quality.score ?? 0) >= 70
})())
check('기관 연결로 들어온 근거는 출처가 다르게 표시된다', (() => {
  const ledger = buildEvidenceLedger({
    metrics: { recent12MonthAverageSales: 10_000_000 },
    evidence: [baseEvidence[0]], analyses: [], uploadedSources: [], partnerSources: ['pos'],
  })
  return ledger.links[0]?.supports[0]?.kind === 'partner'
})())
check('공개 상권값은 public 출처로 붙는다', (() => {
  const ledger = buildEvidenceLedger({
    metrics: { districtSalesGrowth: 4.2 }, evidence: [], analyses: [],
    uploadedSources: [], partnerSources: [], publicMetrics: { districtSalesGrowth: 4.2 },
  })
  return ledger.links.some((link) => link.metric === 'districtSalesGrowth' && link.supports.some((s) => s.kind === 'public'))
})())
check('모든 지표 라벨이 정의돼 있다', Object.values(metricMeta).every((meta) => meta.label && meta.unit))
check('근거 없는 지표는 목록에 넣지 않는다', matched.links.every((link) => link.supports.length > 0))

/* ══ G. 문서 자동 분류 ═════════════════════════════════════ */
describe('G. 문서 분류')

const classifyCases: Array<[string, Parameters<typeof classifyDocument>[0], string]> = [
  ['POS 표를 알아본다', { filename: 'a.csv', headers: ['영업일', '주문금액', '결제수단'], tabular: true }, 'pos'],
  ['열 이름이 달라도 POS 로 본다', { filename: '2026상반기.csv', headers: ['거래일자', '판매금액', '결제방법'], tabular: true }, 'pos'],
  ['계좌 표를 알아본다', { filename: 'b.csv', headers: ['거래일시', '입금액', '출금액', '잔액'], tabular: true }, 'account'],
  ['은행 표기가 달라도 계좌로 본다', { filename: '거래내역.csv', headers: ['거래일자', '맡기신금액', '찾으신금액', '거래후잔액'], tabular: true }, 'account'],
  ['카드 정산표를 알아본다', { filename: 'c.csv', headers: ['승인일', '승인금액', '가맹점수수료', '정산일'], tabular: true }, 'card'],
  ['배달 정산표를 알아본다', { filename: 'd.csv', headers: ['주문일', '배달플랫폼', '주문건수', '주문금액'], tabular: true }, 'delivery'],
  ['고객 방문 표를 알아본다', { filename: 'e.csv', headers: ['고객해시', '첫방문일', '방문횟수'], tabular: true }, 'customer'],
  ['대출 표를 알아본다', { filename: 'f.csv', headers: ['기준월', '금융기관', '대출잔액', '월원리금'], tabular: true }, 'debt'],
  ['급여 표를 알아본다', { filename: 'g.csv', headers: ['기준월', '직원수', '급여총액'], tabular: true }, 'staff'],
  ['임대차 표를 알아본다', { filename: 'h.csv', headers: ['임대인', '월세', '보증금', '계약기간'], tabular: true }, 'lease'],
  ['사업자등록증을 알아본다', { filename: 'IMG_2841.jpg', documentType: '사업자등록증명' }, 'business'],
  ['영업신고증을 알아본다', { filename: 'IMG_2842.jpg', documentType: '영업신고증' }, 'license'],
  ['부가세 신고서를 납세 자료로 본다', { filename: 'scan.pdf', documentType: '부가가치세 신고서' }, 'tax'],
  ['손익계산서도 납세·재무 자료로 본다', { filename: '2026상반기_손익.pdf', documentType: '손익계산서' }, 'tax'],
  ['임대차계약서를 알아본다', { filename: 'x.pdf', documentType: '임대차계약서' }, 'lease'],
  ['부채증명서를 알아본다', { filename: 'y.pdf', documentType: '금융거래확인서' }, 'debt'],
  ['파일 이름만으로도 추정한다', { filename: '사업자등록증_사본.pdf' }, 'business'],
  ['통장 파일명을 계좌로 추정한다', { filename: '통장거래내역_2026.pdf' }, 'account'],
]
for (const [name, input, expected] of classifyCases) {
  const result = classifyDocument(input)
  eq(name, result.sourceId, expected)
}
eq('알 수 없는 파일은 억지로 배정하지 않는다', classifyDocument({ filename: 'scan001.jpg' }).sourceId, 'other')
eq('알 수 없으면 확신도 0', classifyDocument({ filename: 'scan001.jpg' }).confidence, 0)
check('열 이름 근거가 가장 높은 확신도를 갖는다',
  classifyDocument({ filename: 'a.csv', headers: ['영업일', '주문금액'], tabular: true }).confidence
  > classifyDocument({ filename: 'pos_매출.pdf' }).confidence)
eq('열 이름 근거는 basis 가 columns', classifyDocument({ filename: 'a.csv', headers: ['영업일', '주문금액'], tabular: true }).basis, 'columns')
eq('판독 결과 근거는 basis 가 document-type', classifyDocument({ filename: 'a.jpg', documentType: '사업자등록증' }).basis, 'document-type')
eq('파일명 근거는 basis 가 filename', classifyDocument({ filename: '사업자등록증.pdf' }).basis, 'filename')
check('분류 이유를 사람이 읽는 문장으로 남긴다',
  classifyDocument({ filename: 'a.csv', headers: ['영업일', '주문금액'], tabular: true }).reason.length > 5)
check('후보를 함께 제시한다', Array.isArray(classifyDocument({ filename: '매출_카드.csv', headers: ['승인일', '승인금액', '수수료'], tabular: true }).alternatives))

const fields = fieldsFromOcr({ merchant: '샘플식당', businessNumber: '123-45-67891', total: 36_100_000, date: '2026-08-31', confidence: .9 })
eq('판독 항목을 확인용으로 뽑는다', fields.length, 4)
check('처음에는 모두 미확인 상태', fields.every((field) => field.state === 'ai'))
eq('빈 값은 확인 항목에 넣지 않는다', fieldsFromOcr({ merchant: '', total: null }).length, 0)

const lockerDocuments: OwnerDocument[] = [{
  id: 'doc-1', userId: 'u', filename: 'a.png', fileHash: 'a'.repeat(64), byteSize: 100, mimeType: 'image/png',
  sourceId: 'business', classification: { sourceId: 'business', confidence: .9, basis: 'document-type', reason: '', alternatives: [], model: 'v1' },
  reclassified: false, status: 'confirmed', createdAt: '', updatedAt: '', usedInApplicationIds: [],
  fields: [
    { key: 'merchant', label: '상호', aiValue: '샘플식당', confirmedValue: '샘플식당', state: 'confirmed' },
    { key: 'total', label: '금액', aiValue: '100', confirmedValue: '120', state: 'corrected' },
    { key: 'date', label: '기준일', aiValue: '2026-08-31', confirmedValue: null, state: 'ai' },
  ],
}]
const stats = correctionStats(lockerDocuments)
eq('확인한 항목 수를 센다', stats.reviewedFields, 2)
eq('고친 항목 수를 센다', stats.correctedFields, 1)
eq('판독 일치율은 확인한 것 중 그대로 맞은 비율', stats.accuracy, 50)
eq('확인한 게 없으면 일치율은 미산정', correctionStats([]).accuracy, null)

/* ══ H. 지표 집계와 열 별칭 ════════════════════════════════ */
describe('H. 지표 집계')

const posCsv = [
  '거래일자,판매금액,결제방법,환불액',
  ...Array.from({ length: 12 }, (_, month) => Array.from({ length: 3 }, (_, day) =>
    `2026-${String(month + 1).padStart(2, '0')}-0${day + 1},1000000,카드,0`).join('\n')),
].join('\n')
const posOnly = deriveMetricsFromUploads([{ sourceId: 'pos', name: 'pos.csv', text: posCsv }])
eq('열 이름이 달라도 월평균 매출을 계산한다', posOnly.metrics.recent12MonthAverageSales, 3_000_000)
eq('POS 관찰 개월 수를 센다', posOnly.metrics.posMonthsObserved, 12)
check('계산해낸 지표를 근거 목록에 남긴다', posOnly.evidence[0]?.produced.includes('recent12MonthAverageSales'))
eq('근거에 행 수가 남는다', posOnly.evidence[0]?.rows, 36)

const bankCsv = [
  '거래일자,맡기신금액,찾으신금액,거래후잔액',
  ...Array.from({ length: 12 }, (_, month) =>
    `2026-${String(month + 1).padStart(2, '0')}-15,3000000,2500000,5000000`),
].join('\n')
const withBank = deriveMetricsFromUploads([
  { sourceId: 'pos', name: 'pos.csv', text: posCsv },
  { sourceId: 'account', name: 'bank.csv', text: bankCsv },
])
eq('은행 표기가 달라도 입금액을 읽는다', withBank.metrics.accountMonthlyInflow, 3_000_000)
eq('POS와 계좌가 같으면 일치도 100', withBank.metrics.salesReconciliationRate, 100)
check('현금흐름을 계좌에서 계산한다', typeof withBank.metrics.estimatedMonthlyOperatingCashflow === 'number')

const skewedBank = bankCsv.replace(/3000000/g, '9000000')
const skewed = deriveMetricsFromUploads([
  { sourceId: 'pos', name: 'pos.csv', text: posCsv },
  { sourceId: 'account', name: 'bank.csv', text: skewedBank },
])
check('POS와 계좌가 크게 다르면 경고한다', skewed.warnings.some((text) => text.includes('일치도')))
eq('자료가 모순이면 순현금흐름 비율을 내지 않는다', skewed.metrics.netCashflowRatio, undefined)

const leaseCsv = '임대인,월차임,임대보증금\n홍길동,3500000,50000000'
const lease = deriveMetricsFromUploads([{ sourceId: 'lease', name: 'lease.csv', text: leaseCsv }])
eq('임차료 별칭을 흡수한다', lease.metrics.monthlyRent, 3_500_000)
eq('보증금 별칭을 흡수한다', lease.metrics.leaseDeposit, 50_000_000)

const debtCsv = '기준월,대출기관,대출잔액,월납입액,적용금리\n2026-08,○○은행,40000000,900000,5.4'
const debt = deriveMetricsFromUploads([{ sourceId: 'debt', name: 'debt.csv', text: debtCsv }])
eq('대출 별칭을 흡수한다', debt.metrics.totalLoanBalance, 40_000_000)
eq('상환액 별칭을 흡수한다', debt.metrics.monthlyDebtPayment, 900_000)
near('금리 별칭을 흡수한다', Number(debt.metrics.averageInterestRate), 5.4, 0.01)

const staffCsv = '급여월,근무인원,인건비\n2026-07,4,9000000\n2026-08,5,10000000'
const staff = deriveMetricsFromUploads([{ sourceId: 'staff', name: 'staff.csv', text: staffCsv }])
eq('인건비 별칭을 흡수한다', staff.metrics.monthlyPayroll, 9_500_000)

const brokenCsv = '엉뚱한열,다른열\n1,2'
const broken = deriveMetricsFromUploads([{ sourceId: 'pos', name: 'x.csv', text: brokenCsv }])
check('읽을 열이 없으면 지어내지 않고 경고한다',
  Object.keys(broken.metrics).length === 0 && broken.warnings.length > 0)
check('쉼표가 들어간 메뉴명을 지킨다', (() => {
  const quoted = 'IDX,영업일,주문금액,메뉴\n1,2026-08-01,15000,"고등어, 된장국"'
  const result = deriveMetricsFromUploads([{ sourceId: 'pos', name: 'q.csv', text: quoted }])
  return result.metrics.recent12MonthAverageSales === 15_000
})())

/* ══ I. 심사 파이프라인 연결 ═══════════════════════════════ */
describe('I. 심사 연결')

const business = verifyBusiness({ businessNumber: '123-45-67891', ownerName: '김소담', licenseNumber: '제 2022-마포-0451 호', identityVerified: true })
check('올바른 사업자번호는 통과한다', business.verified, business.message)
check('검증번호가 틀리면 걸러낸다', !verifyBusiness({ businessNumber: '123-45-67890', ownerName: '김소담', licenseNumber: 'x', identityVerified: true }).checks.사업자번호_검증번호)
check('본인인증 없으면 통과하지 않는다', !verifyBusiness({ businessNumber: '123-45-67891', ownerName: '김소담', licenseNumber: 'x', identityVerified: false }).verified)

const orchestration = orchestrateFinancialVerification({
  claims: { businessNumber: '123-45-67891', monthlySales: 36_000_000, monthlyDebtPayment: 900_000, taxCompliant: true },
  analyses: [ocrAnalysis({ sourceId: 'business', result: { businessNumber: '123-45-67891', date: '2026-01-02', confidence: .95 } })],
  connectedSources: ['business', 'pos', 'account'],
})
eq('교차검증은 6단계로 고정', orchestration.steps.length, 6)
check('모든 단계에 설명이 붙는다', orchestration.steps.every((step) => step.detail.length > 0))
check('제출 안 한 자료는 실패 대신 미대조로 남는다',
  orchestration.steps.filter((step) => step.status === 'not_compared').length > 0)
check('사업자 식별 단계는 통과한다', orchestration.steps[0].status === 'passed')

const creditInput = deriveCreditInput({
  industry: toIndustry('한식'),
  connectedSources: ['pos', 'account', 'business', 'license', 'identity'],
  derivedMetrics: { ...withBank.metrics, operatingYears: 4 },
  restaurant,
  reviews: [],
})
const credit = assessCredit(creditInput)
check('신용평가가 등급을 낸다', ['A+', 'A', 'B+', 'B', 'C', 'D'].includes(credit.grade))
eq('지표 총 개수는 35개', credit.totalCount, 35)
check('산정한 지표 수가 총 개수를 넘지 않는다', credit.measuredCount <= credit.totalCount)
check('산정하지 못한 지표는 미산정으로 남는다', credit.missing.length === credit.totalCount - credit.measuredCount)
check('자료가 적으면 임시 등급으로 표시한다', credit.provisional === true || credit.coverage >= 50)
eq('자료가 하나도 없으면 산정 지표도 없다', assessCredit({ industry: '외식' }).measuredCount, 0)
check('업종 매핑이 동작한다', toIndustry('카페·베이커리') === '외식' && toIndustry('의원') === '보건')

const reportFacts = buildOwnerReportFacts({ restaurant, fund, connectedSources: ['pos', 'account'] })
check('경영 리포트 사실은 서버가 확정한다', typeof reportFacts.salesChange === 'number' && typeof reportFacts.couponUseRate === 'number')
const fallbackReport = ownerReportFallback(reportFacts)
check('AI 없이도 같은 모양의 리포트를 만든다',
  Boolean(fallbackReport.headline && fallbackReport.salesCause?.title && fallbackReport.costCheck?.items?.length))
eq('사실과 다른 숫자를 만든 리포트는 거부한다',
  normalizeOwnerReport({ headline: '매출이 200% 늘었어요', salesCause: { title: 'a', body: 'b' } }, reportFacts), null)

const insightFacts = seedRestaurants.slice(0, 2).map((item) => ({
  id: item.id, name: item.name, category: item.category, region: item.region, neighborhood: item.neighborhood,
  salesGrowth: item.salesGrowth, repeatRate: item.repeatRate, openedYears: item.openedYears,
  closingRate: item.closingRate, footTrafficGrowth: item.footTrafficGrowth, rating: item.rating,
  maxDiscount: 40, riskLevel: '보통', salesDisclosure: Boolean(item.salesDisclosure),
})) as Parameters<typeof insightFallback>[0]
const insight = insightFallback(insightFacts)
eq('인사이트는 비교한 식당 수만큼 카드를 만든다', insight.cards.length, 2)
check('인사이트 카드에 주의사항이 있다', insight.cards.every((card) => card.caution.length > 0))
eq('없는 식당을 만들어낸 인사이트는 거부한다',
  normalizeInsight({ cards: [{ id: 'r-nowhere', name: '없는가게', traits: ['a'], caution: 'b' }], comparison: 'c' }, insightFacts), null)

/* ══ J. 판독 좌표 정규화 ══════════════════════════════════ */
describe('J. 판독 좌표')

eq('좌표가 아닌 값은 버린다', normalizeOcrBoxes('nope').length, 0)
eq('허용 필드가 아니면 버린다', normalizeOcrBoxes([{ field: 'merchant|total', bbox: [1, 2, 3, 4], confidence: .9 }]).length, 0)
eq('이미지 전체를 가리키는 상자는 근거로 쓰지 않는다',
  normalizeOcrBoxes([{ field: 'total', bbox: [0, 0, 1000, 1000], confidence: .9 }]).length, 0)
eq('정상 상자는 남긴다', normalizeOcrBoxes([{ field: 'total', label: '금액', value: '1000', bbox: [100, 200, 150, 40], confidence: .9 }]).length, 1)
check('좌표를 이미지 범위 안으로 자른다', (() => {
  const [box] = normalizeOcrBoxes([{ field: 'total', bbox: [900, 900, 500, 500], confidence: 2 }])
  return box.bbox[0] + box.bbox[2] <= 1000 && box.bbox[1] + box.bbox[3] <= 1000 && box.confidence <= 1
})())
eq('폭이나 높이가 0이면 버린다', normalizeOcrBoxes([{ field: 'total', bbox: [10, 10, 0, 10], confidence: .9 }]).length, 0)

/* ── 결과 ─────────────────────────────────────────────────── */

const total = passed + failures.length
console.log(`\n지식그래프·AI 알고리즘 검증: ${passed}/${total} 통과`)
for (const [name, count] of groupCounts) console.log(`  ${name}: ${count}건`)
if (failures.length) {
  console.error(`\n❌ 실패 ${failures.length}건`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
if (total < 100) {
  console.error(`\n❌ 케이스가 ${total}건뿐입니다. 100건 이상을 유지해야 합니다.`)
  process.exit(1)
}
console.log(`\n✅ ${total}개 케이스 전부 통과`)
