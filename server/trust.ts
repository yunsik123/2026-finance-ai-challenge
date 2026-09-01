import type { Fund, Restaurant, Role } from './types.ts'
import { commercialGraphProperties, commercialInsight, commercialResilience, findCommercialArea, type CommercialArea } from './commercial.ts'

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const baseline = 60
const weights = Object.freeze({
  '매출 지속성': .25,
  '현금흐름 여력': .25,
  '부채 부담': .2,
  '사업 운영 안정성': .15,
  '상권 회복력': .15,
})

export function assessRestaurant(restaurant: Restaurant, fund?: Fund) {
  const fundingProgress = fund?.goal ? fund.raised / fund.goal : 0
  const located = findCommercialArea(restaurant)
  const area = located?.area

  // 상권 원천데이터가 있으면 '상권 회복력'을 식당 자체 추정치 대신 상권 지표로 계산한다.
  const resilience = area
    ? commercialResilience(area)
    : Number(clamp(62 + restaurant.footTrafficGrowth * 1.2 - restaurant.closingRate * 1.1).toFixed(1))

  const components = {
    '매출 지속성': Number(clamp(58 + restaurant.salesGrowth * 1.25 + (restaurant.repeatRate - 35) * .2).toFixed(1)),
    '현금흐름 여력': Number(clamp(52 + restaurant.salesGrowth * .7 + fundingProgress * 12).toFixed(1)),
    '부채 부담': 60,
    '사업 운영 안정성': Number(clamp(42 + restaurant.openedYears * 4 + restaurant.stabilityScore * .3).toFixed(1)),
    '상권 회복력': resilience,
  }
  const contributions = Object.entries(weights).map(([label, weight]) => {
    const componentScore = components[label as keyof typeof components]
    return { label, componentScore, weight, contribution: Number(((componentScore - baseline) * weight).toFixed(1)) }
  })
  const score = clamp(Number((baseline + contributions.reduce((sum, item) => sum + item.contribution, 0)).toFixed(1)))

  // 점수에 직접 반영하지 않고 따로 알리는 맥락 경고 (소상공인 프로젝트 risk-model 이식).
  const contextualAlerts: string[] = []
  if (area) {
    const competitors = area.marketDynamics.categoryCompetitorCount?.[restaurant.category]
    if (area.marketDynamics.competitorDensity >= .7) {
      contextualAlerts.push(`경쟁 밀도 ${area.marketDynamics.competitorDensity} — 같은 상권에 ${restaurant.category} ${competitors ? `${competitors}곳이 ` : ''}밀집해 있습니다.`)
    }
    if (area.marketDynamics.closureRate >= 12) contextualAlerts.push(`주변 폐업률 ${area.marketDynamics.closureRate}% — 생존기간과 임대 조건을 함께 확인하세요.`)
    if (area.realEstate.rentGrowthRate >= 5) contextualAlerts.push(`임대료가 연 ${area.realEstate.rentGrowthRate}% 오르고 있어 원가 부담이 커질 수 있습니다.`)
    if (area.spending.externalConsumerRatio >= 78) contextualAlerts.push(`외지 소비 비중 ${area.spending.externalConsumerRatio}% — 유행 변화에 매출이 민감할 수 있습니다.`)
  }

  const missing = ['공식 부채·상환 원자료']
  if (!area) missing.push('상권 원천데이터(이 동네는 아직 미연동)')

  return {
    score,
    grade: score >= 80 ? 'S2' : score >= 70 ? 'S3' : score >= 60 ? 'S4' : score >= 50 ? 'S5' : 'S7',
    riskLevel: score >= 75 ? 'low' : score >= 55 ? 'review' : 'high',
    // 상권 원천데이터가 붙으면 신뢰도가 올라간다.
    confidence: area ? (located.matchLevel === 'exact' ? 86 : 80) : 72,
    components,
    contributions,
    missing,
    contextualAlerts,
    commercialArea: area && {
      ...commercialGraphProperties(area),
      areaName: area.areaName,
      summary: area.summary,
      matchLevel: located.matchLevel,
      insight: commercialInsight(area, restaurant.category),
      footTraffic: area.footTraffic,
      marketDynamics: area.marketDynamics,
      spending: area.spending,
      realEstate: area.realEstate,
      demographics: area.demographics,
    },
    diagnostics: {
      fundingProgress: Number((fundingProgress * 100).toFixed(1)),
      salesGrowth: restaurant.salesGrowth,
      repeatRate: restaurant.repeatRate,
      operatingYears: restaurant.openedYears,
      footTrafficGrowth: restaurant.footTrafficGrowth,
      closureRate: restaurant.closingRate,
      commercialAreaCode: area?.areaCode ?? null,
    },
    methodology: {
      type: 'transparent_additive_prescreen',
      baseline,
      calibratedProbability: false,
      modelVersion: area ? 'meoktu-moa-risk-v2-commercial' : 'meoktu-moa-risk-v2',
    },
  }
}

const investorSteps = [
  ['탐색', '관심 지역·업종의 공개 식당을 찾습니다.'],
  ['구조 이해', '현금 이자 대신 투자 유지기간과 성장에 따라 소비 쿠폰이 쌓입니다.'],
  ['검증 자료 확인', '사업 정보, 위험요인, 상권, 자금 사용계획을 함께 봅니다.'],
  ['손실 감내 확인', '생활자금은 제외하고 한 식당에 집중하지 않습니다.'],
  ['위험 동의 후 참여', '1,000원 단위와 목표액 1% 개인 한도 안에서 참여합니다.'],
  ['집행 추적', '매출 공개와 쿠폰 적립, 자금 집행 상태를 확인합니다.'],
  ['회수 요청', '모집 후에는 신규 예약과 FIFO로 매칭될 때 회수됩니다.'],
]

const ownerSteps = [
  ['사업체·대표자 등록', '사업자번호, 대표자, 영업신고, 주소를 등록합니다.'],
  ['데이터 출처 선택', '사업자·영업신고·임대차는 직접 업로드하고, POS·계좌·카드·세무·부채는 제휴기관 연결 또는 대체 업로드 중 출처를 명확히 선택합니다.'],
  ['AI OCR 교차검증', '문서 식별값·기간·금액·누락을 구조화해 비교합니다.'],
  ['운영자 원본 확인', 'AI 결과는 보조자료이며 사람이 원본을 확인합니다.'],
  ['모집안 작성', '자금 용도, 위험 대응, 공개항목과 지급 단계를 작성합니다.'],
  ['모집 심사·공개', '공식 검증과 운영자 심사 뒤 투자자에게 공개합니다.'],
  ['집행 증빙 제출', '공개 후 현재 단계의 계약서·영수증·완료 사진을 제출합니다.'],
]

export type GraphNode = { id: string; type: string; label: string; properties: Record<string, string | number | boolean>; source: string }
export type GraphEdge = { from: string; relation: string; to: string }

/** 그래프에 넣기 좋은 크기로 값을 다듬는다. 중첩 객체는 노드를 부풀리므로 넣지 않는다. */
const props = (input: Record<string, unknown>) => {
  const output: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string') output[key] = value.slice(0, 200)
    else if (typeof value === 'number' || typeof value === 'boolean') output[key] = value
  }
  return output
}

export type GraphContext = {
  restaurant?: Restaurant
  fund?: Fund
  /** assessRestaurant 결과. 넣으면 CreditAssessment 노드가 붙는다. */
  assessment?: { score: number; grade: string; riskLevel: string; confidence: number; components: Record<string, number> }
  /** 투자자의 이 펀드 보유분. */
  holding?: { amount: number; couponProgress: number; early: boolean }
  /** 사장님이 신고한 재무 수치와 AI 교차검증 결과. */
  claim?: { verificationStatus: string; requestedLimit?: number; dataConfidence?: number }
  verification?: { status: string; readyForAdminReview: boolean; mismatchCount: number; missingCount: number }
}

/**
 * 역할별 절차 그래프 + 지금 보고 있는 대상의 동적 노드.
 * 소상공인 프로젝트의 dynamicInvestorGraph / dynamicOwnerGraph 를 먹투 데이터 모델에 맞춰 이식했다.
 */
export function buildKnowledgeGraph(role: Role, restaurant?: Restaurant, fund?: Fund, context: GraphContext = {}) {
  const steps = role === 'owner' ? ownerSteps : investorSteps
  const prefix = role === 'owner' ? 'owner' : 'investor'
  const nodes: GraphNode[] = steps.map(([label, instruction], index) => ({
    id: `${prefix}:step:${index + 1}`,
    type: 'GuideStep',
    label,
    properties: { order: index + 1, instruction },
    source: 'MEOKTU_SERVICE_POLICY',
  }))
  const edges: GraphEdge[] = nodes.slice(0, -1).map((node, index) => ({ from: node.id, relation: 'NEXT', to: nodes[index + 1].id }))
  const stepId = (order: number) => `${prefix}:step:${Math.min(order, steps.length)}`

  if (!restaurant) return { graphVersion: 'meoktu-role-graph-v2', role, generatedAt: new Date().toISOString(), nodes, edges }

  const businessId = `restaurant:${restaurant.id}`
  nodes.push({
    id: businessId, type: 'Restaurant', label: restaurant.name, source: 'RESTAURANT_RECORD',
    properties: props({
      category: restaurant.category, region: restaurant.region, neighborhood: restaurant.neighborhood,
      salesGrowth: restaurant.salesGrowth, repeatRate: restaurant.repeatRate, openedYears: restaurant.openedYears,
      salesDisclosure: Boolean(restaurant.salesDisclosure), rating: restaurant.rating,
    }),
  })
  edges.push({ from: stepId(3), relation: 'EXAMINES', to: businessId })

  // 상권 노드 — AI가 "왜 이 동네인가"를 근거로 답할 수 있게 한다.
  const located = findCommercialArea(restaurant)
  if (located) {
    const areaId = `area:${located.area.areaCode}`
    nodes.push({
      id: areaId, type: 'CommercialArea', label: located.area.areaName, source: 'COMMERCIAL_AREA_DATA',
      properties: props({ ...commercialGraphProperties(located.area), matchLevel: located.matchLevel, summary: located.area.summary }),
    })
    edges.push({ from: businessId, relation: 'LOCATED_IN', to: areaId })
    edges.push({ from: areaId, relation: 'INFORMS', to: stepId(3) })
  }

  if (fund) {
    const fundId = `fund:${fund.id}`
    nodes.push({
      id: fundId, type: 'FundingCampaign', label: `${restaurant.name} ${fund.round}차 펀딩`, source: 'FUND_RECORD',
      properties: props({
        goal: fund.goal, raised: fund.raised, status: fund.status, riskLevel: fund.riskLevel,
        maxDiscount: fund.maxDiscount, purpose: fund.purpose, investorCount: fund.investorCount,
        openBuyAmount: fund.openBuyAmount, openSellAmount: fund.openSellAmount,
      }),
    })
    edges.push({ from: businessId, relation: 'RAISES', to: fundId })
    edges.push({ from: stepId(role === 'owner' ? 7 : 5), relation: role === 'owner' ? 'CREATES' : 'PARTICIPATES_IN', to: fundId })

    if (context.holding) {
      const holdingId = `holding:${fund.id}`
      nodes.push({
        id: holdingId, type: 'InvestorHolding', label: '내 투자잔액', source: 'INVESTOR_PORTFOLIO',
        properties: props({ amount: context.holding.amount, accruedDiscount: Number(context.holding.couponProgress.toFixed(1)), earlyInvestor: context.holding.early }),
      })
      edges.push({ from: holdingId, relation: 'INVESTED_IN', to: fundId })
      edges.push({ from: stepId(7), relation: 'SETTLES', to: holdingId })
    }
  }

  if (context.assessment) {
    const assessmentId = `assessment:${restaurant.id}`
    nodes.push({
      id: assessmentId, type: 'CreditAssessment', label: `${context.assessment.grade} ${context.assessment.score}점`, source: 'PROVISIONAL_ASSESSMENT',
      properties: props({
        score: context.assessment.score, grade: context.assessment.grade, riskLevel: context.assessment.riskLevel,
        confidence: context.assessment.confidence, calibratedProbability: false, ...context.assessment.components,
      }),
    })
    edges.push({ from: businessId, relation: 'ASSESSED_BY', to: assessmentId })
    edges.push({ from: stepId(3), relation: 'USES', to: assessmentId })
  }

  if (context.claim) {
    const claimId = `claim:${restaurant.id}`
    nodes.push({
      id: claimId, type: 'FinancialClaim', label: '사장님이 제출한 재무·운영 수치', source: 'OWNER_CLAIM',
      properties: props({ verificationStatus: context.claim.verificationStatus, requestedLimit: context.claim.requestedLimit, dataConfidence: context.claim.dataConfidence }),
    })
    edges.push({ from: businessId, relation: 'CLAIMS', to: claimId })
    edges.push({ from: claimId, relation: 'REQUIRES', to: stepId(4) })
  }

  if (context.verification) {
    const runId = `verification:${restaurant.id}`
    nodes.push({
      id: runId, type: 'VerificationRun', label: '재무자료 AI 교차검증', source: 'FINANCIAL_VERIFICATION_RUN',
      properties: props({
        status: context.verification.status, readyForAdminReview: context.verification.readyForAdminReview,
        mismatches: context.verification.mismatchCount, missingDocuments: context.verification.missingCount,
      }),
    })
    edges.push({ from: stepId(5), relation: 'PRODUCES', to: runId })
    edges.push({ from: runId, relation: 'REVIEWED_BY', to: stepId(6) })
  }

  return { graphVersion: 'meoktu-role-graph-v2', role, generatedAt: new Date().toISOString(), nodes, edges }
}

type KnowledgeGraph = ReturnType<typeof buildKnowledgeGraph>

const queryAliases: Record<string, string[]> = {
  투자: ['참여', '위험 동의', '손실 감내', '한도'],
  회수: ['회수 요청', 'FIFO', '매칭', '신규 예약'],
  심사: ['검증 자료', '운영자 원본 확인', '모집 심사'],
  서류: ['자료', '원천자료', '증빙', '업로드'],
  자료: ['서류', '원천자료', '증빙', '검증'],
  업로드: ['직접 업로드', '소상공인 제출', '대체 업로드', '원천자료'],
  연동: ['제휴기관', '마이데이터', '금융기관', 'POS', '계좌', '카드', '세무'],
  마이데이터: ['제휴기관', '연동', '금융기관', '계좌', '카드', '부채'],
  제휴: ['연동', '마이데이터', '기관 전송', '동의 범위'],
  쿠폰: ['소비 쿠폰', '적립', '혜택'],
  사장님: ['사업체', '대표자', '모집안', '집행'],
}

export function retrieveKnowledgeSubgraph(graph: KnowledgeGraph, question: string, limit = 6) {
  const normalized = question.toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim()
  const baseTerms = normalized.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1)
  const matchedAliases = Object.entries(queryAliases)
    .filter(([keyword]) => normalized.includes(keyword))
    .flatMap(([keyword, aliases]) => [keyword, ...aliases])
  const terms = [...new Set([...baseTerms, ...matchedAliases])]
  const scored = graph.nodes.map((node, index) => {
    const haystack = `${node.label} ${JSON.stringify(node.properties)}`.toLocaleLowerCase('ko')
    const exactLabel = normalized.includes(node.label.toLocaleLowerCase('ko')) ? 5 : 0
    const score = exactLabel + terms.reduce((sum, term) => sum + (haystack.includes(term.toLocaleLowerCase('ko')) ? 1 : 0), 0)
    return { node, index, score }
  }).sort((a, b) => b.score - a.score || a.index - b.index)
  const direct = scored.filter((item) => item.score > 0).slice(0, limit)
  const selected = direct.length ? direct : scored.slice(0, Math.min(3, limit))
  const selectedIds = new Set(selected.map((item) => item.node.id))
  const relatedEdges = graph.edges.filter((edge) => selectedIds.has(edge.from) || selectedIds.has(edge.to)).slice(0, 12)
  for (const edge of relatedEdges) {
    if (selectedIds.size >= limit + 2) break
    selectedIds.add(edge.from); selectedIds.add(edge.to)
  }
  const nodes = graph.nodes.filter((node) => selectedIds.has(node.id))
  return {
    graphVersion: graph.graphVersion,
    role: graph.role,
    nodes,
    edges: relatedEdges,
    sources: selected.slice(0, 4).map((item) => ({ id: item.node.id, label: item.node.label, type: item.node.type })),
  }
}

export function answerGraphProcessQuestion(question: string, subgraph: ReturnType<typeof retrieveKnowledgeSubgraph>) {
  if (!/(어떻게|절차|순서|준비|등록|제출|자료|서류|업로드|회수|심사|참여)/.test(question)) return ''
  const steps = subgraph.nodes.filter((node) => node.type === 'GuideStep')
    .sort((a, b) => Number(a.properties.order) - Number(b.properties.order))
  if (!steps.length) return ''
  const title = subgraph.role === 'owner' ? '사장님 모집·심사 절차에서 관련 단계를 찾았어요.' : '투자자 참여 절차에서 관련 단계를 찾았어요.'
  return [title, ...steps.map((step) => `${step.properties.order}. ${step.label}: ${step.properties.instruction}`), '', '이 답변은 먹투 역할별 지식그래프에서 질문과 연결된 노드·관계를 검색해 만들었습니다.'].join('\n')
}

export function normalizeOcrBoxes(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 24).flatMap((entry) => {
    const item = entry as Record<string, unknown>
    const box = Array.isArray(item.bbox) ? item.bbox.map(Number) : []
    if (box.length !== 4 || box.some((number) => !Number.isFinite(number))) return []
    const [x, y, width, height] = box
    if (width <= 0 || height <= 0) return []
    const safeX = clamp(x, 0, 999)
    const safeY = clamp(y, 0, 999)
    return [{
      field: String(item.field || 'unknown').slice(0, 80),
      label: String(item.label || item.field || '필드').slice(0, 120),
      value: String(item.value ?? '').slice(0, 300),
      bbox: [safeX, safeY, clamp(width, 1, 1000 - safeX), clamp(height, 1, 1000 - safeY)],
      confidence: clamp(Number(item.confidence || 0), 0, 1),
    }]
  })
}
