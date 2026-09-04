import type { Fund, Restaurant, Role } from './types.ts'
import { commercialGraphProperties, commercialInsight, commercialResilience, findCommercialArea, type CommercialArea } from './commercial.ts'
import { siteGraphEdges, siteGraphNodes } from './sitemap.ts'
import { EXCHANGE_RULES } from './exchange.ts'

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
  ['위험 동의 후 참여', '1,000원 단위와 목표액 1% 개인 한도 안에서 참여합니다. 1%는 먹투 자체 투기 방지 규칙이며 법정 투자한도를 대신하지 않습니다.'],
  ['집행 추적', '매출 공개와 쿠폰 적립, 자금 집행 상태를 확인합니다.'],
  ['회수 요청', '모집 후에는 신규 예약과 FIFO로 매칭될 때 회수됩니다.'],
]

const ownerSteps = [
  ['사업체·대표자 등록', '사업자번호, 대표자, 영업신고, 주소를 등록합니다.'],
  ['데이터 출처 선택', '사업자·영업신고·임대차는 직접 업로드하고, POS·계좌·카드·세무·부채는 제휴기관 연결 또는 대체 업로드 중 출처를 명확히 선택합니다.'],
  ['제출자료 자동 확인', '제출한 문서의 상호·사업자번호·기간·금액이 서로 맞는지 자동으로 대조합니다.'],
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
 * 서비스 규칙 노드.
 *
 * 절차 그래프(GuideStep)는 "무엇을 하는가"만 담고 있어서, "할인율 차이 제한이 몇 %야?",
 * "제안한 쿠폰 다른 데 쓸 수 있어?", "10만원 넣으면 한 달에 몇 % 쌓여?" 같은
 * 숫자 규칙 질문에는 근거가 없었다. 근거가 없으면 생성형 답변이 규칙을 지어낸다.
 * 그래서 서버가 실제로 강제하는 상수(EXCHANGE_RULES 등)를 그대로 노드로 올린다.
 */
function serviceRuleNodes(): GraphNode[] {
  return [
    {
      id: 'rule:exchange', type: 'ServiceRule', label: '쿠폰 교환 성립 조건', source: 'MEOKTU_EXCHANGE_RULES',
      properties: {
        discountGapRule: `두 쿠폰의 할인율 차이가 ${EXCHANGE_RULES.maxDiscountGap}%p 미만이어야 교환된다`,
        valueRatioRule: `최대 할인 금액(액면가) 차이가 ${EXCHANGE_RULES.maxValueRatio}배를 넘으면 교환되지 않는다`,
        expiryRule: `만료까지 ${EXCHANGE_RULES.minDaysLeft}일 미만 남은 쿠폰은 올릴 수도, 제안할 수도 없다`,
        escrowRule: '제안에 건 쿠폰은 결과가 날 때까지 잠기고, 그 사이에는 매장 사용·재등록·다른 제안에 쓸 수 없다',
        listingExpiry: `등록한 매물은 ${EXCHANGE_RULES.listingTtlDays}일 뒤 자동 만료된다`,
        offerExpiry: `보낸 제안은 ${EXCHANGE_RULES.offerTtlDays}일 뒤 자동 만료되고 쿠폰은 지갑으로 돌아온다`,
        limits: `한 사람이 동시에 매물 ${EXCHANGE_RULES.maxOpenListingsPerUser}건, 제안 ${EXCHANGE_RULES.maxPendingOffersPerUser}건까지 열어둘 수 있다`,
        selfTradeRule: '자기 매물에는 제안할 수 없고, 같은 매물에 같은 사람이 대기 제안을 두 번 걸 수 없다',
        settlement: '교환이 성립하면 두 쿠폰의 주인이 동시에 바뀌고, 같은 매물의 나머지 대기 제안은 자동으로 거절되어 쿠폰이 풀린다',
      },
    },
    {
      id: 'rule:redeem', type: 'ServiceRule', label: '쿠폰 매장 사용 규칙', source: 'MEOKTU_EXCHANGE_RULES',
      properties: {
        codeRule: '지갑에서 “사용하기”를 누르면 8자리 사용 코드가 나오고, 사장님이 그 코드를 확인해야 사용 처리된다',
        holdRule: `사장님이 ${EXCHANGE_RULES.redeemHoldMinutes}분 안에 확인하지 않으면 쿠폰은 다시 지갑으로 돌아온다`,
        stateRule: '매장 확인을 기다리는 쿠폰은 교환장에 올릴 수 없다',
      },
    },
    {
      id: 'rule:coupon-accrual', type: 'ServiceRule', label: '쿠폰 할인율 적립 공식', source: 'MEOKTU_FUND_POLICY',
      properties: {
        formula: '적립 할인율(%p) = (투자금 ÷ 100,000) × 0.5 × 보유일수 × (1 + 해당 펀드 매출 보너스 ÷ 100)',
        baseRate: '10만원당 하루 0.5%p가 기본 적립분이다',
        earlyBonus: '최초 투자자는 매출 보너스를 50% 더 받는다(보너스 자체가 1.5배가 되며, 할인율이 1.5배가 되는 것이 아니다)',
        issueFloor: '누적 할인율이 10% 이상이어야 쿠폰으로 발급할 수 있다',
        cap: '누적 할인율은 그 펀드의 최대 할인율(식당마다 30~55%)을 넘지 않는다',
        resetRule: '쿠폰을 발급하면 누적 할인율은 0으로 초기화되고 다시 쌓인다',
        example: '10만원을 최초 투자자로 30일 보유하고 매출 보너스가 14.7%인 펀드라면 0.5 × 30 × (1 + 0.147 × 1.5) ≈ 18.3%p가 쌓인다',
      },
    },
    {
      id: 'rule:invest-withdraw', type: 'ServiceRule', label: '투자·회수 규칙', source: 'MEOKTU_FUND_POLICY',
      properties: {
        unit: '투자와 회수 모두 1,000원 단위로만 가능하다',
        personalCap: '한 식당 개인 한도는 목표액의 1%다. 이는 먹투 자체 투기 방지 규칙이며 법정 투자한도를 대신하지 않는다',
        duringFunding: '펀드 상태가 “모금 중”이면 신청한 금액이 그 자리에서 전액 즉시 회수된다. 이때는 사는 사람이 없어도 되고 기다릴 필요도 없다',
        afterFunding: '펀드 상태가 “예약 거래 중”(모금 마감 뒤)일 때만 사는 사람이 필요하다. 이 경우 같은 금액을 사려는 예약 투자자와 1,000원 단위 선착순(FIFO)으로 매칭될 때 회수되고, 매칭 전까지는 회수 대기로 남는다',
        doNotMix: '두 규칙을 섞어 말하면 안 된다. “모금 중”은 즉시 회수, “예약 거래 중”은 매칭 대기다',
        noGuarantee: '투자금은 예금이 아니며 원금도 회수 시점도 보장되지 않는다',
        cancelRule: '아직 체결되지 않은 예약 주문은 언제든 취소할 수 있고, 투자 예약을 취소하면 먹투머니로 즉시 돌아온다',
      },
    },
  ]
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

  // 화면 지도(UI 내비게이션)를 같은 그래프에 붙인다.
  // 이게 없으면 "어디로 가야 하나요"에 절차 단계 이름만 읽어주게 된다.
  nodes.push(...siteGraphNodes() as GraphNode[])
  edges.push(...siteGraphEdges())
  // 서비스 규칙(교환 조건·적립 공식·회수 규칙)도 같은 그래프에 올린다.
  nodes.push(...serviceRuleNodes())
  const stepScreens = role === 'owner'
    ? ['page:owner', 'page:owner', 'page:owner', 'page:owner', 'page:owner', 'page:owner', 'page:owner']
    : ['page:discover', 'page:home', 'page:insight', 'page:home', 'page:discover', 'page:my', 'page:my']
  steps.forEach((_, index) => {
    const screen = stepScreens[index]
    if (screen) edges.push({ from: stepId(index + 1), relation: 'HAPPENS_ON', to: screen })
  })

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
  교환: ['할인율', '액면가', '만료', '에스크로', '제안', '매물', '잠기'],
  제한: ['할인율', '차이', '한도', '단위', '조건'],
  조건: ['할인율', '차이', '만료', '한도', '규칙'],
  적립: ['할인율', '보너스', '보유일수', '공식'],
  에스크로: ['잠기', '제안', '결과', '지갑'],
  단위: ['1,000원', '한도', '회수'],
}

export function retrieveKnowledgeSubgraph(graph: KnowledgeGraph, question: string, limit = 6) {
  const normalized = question.toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim()
  const baseTerms = normalized.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1)
  const matchedAliases = Object.entries(queryAliases)
    .filter(([keyword]) => normalized.includes(keyword))
    .flatMap(([keyword, aliases]) => [keyword, ...aliases])
  const terms = [...new Set([...baseTerms, ...matchedAliases])]
  // "제한이 몇 %야", "쓸 수 있어?", "얼마나 쌓여" 처럼 규칙을 묻는 문장은
  // 절차 단계보다 서비스 규칙 노드를 먼저 봐야 한다. 안 그러면 생성형이 규칙을 지어낸다.
  const asksRule = /(제한|조건|규칙|몇\s*%|몇\s*퍼센트|얼마나|되나요|되나|수\s*있|가능한가|가능해|공식|기준)/.test(normalized)
  const scored = graph.nodes.map((node, index) => {
    const haystack = `${node.label} ${JSON.stringify(node.properties)}`.toLocaleLowerCase('ko')
    const exactLabel = normalized.includes(node.label.toLocaleLowerCase('ko')) ? 5 : 0
    const termScore = terms.reduce((sum, term) => sum + (haystack.includes(term.toLocaleLowerCase('ko')) ? 1 : 0), 0)
    // 규칙 노드는 실제로 질문 단어와 겹칠 때만 끌어올린다. 무조건 올리면 절차 노드를 밀어낸다.
    const ruleBoost = asksRule && node.type === 'ServiceRule' && termScore > 0 ? 3 : 0
    const score = exactLabel + ruleBoost + termScore
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
  // 절차 단계는 '심사 기준'이지 화면 메뉴가 아니다. 화면 이름을 함께 밝혀 혼동을 막는다.
  const screen = subgraph.nodes.find((node) => node.type === 'SitePage')
  const title = subgraph.role === 'owner'
    ? '사장님 펀딩 심사는 아래 단계로 진행돼요. (화면 메뉴 이름이 아니라 심사가 진행되는 순서예요.)'
    : '투자자 참여 절차는 아래 순서로 진행돼요. (화면 메뉴 이름이 아니라 확인하는 순서예요.)'
  const where = screen ? [``, `화면에서는 ${screen.properties.menuPath}에서 진행합니다.`] : []
  return [title, ...steps.map((step) => `${step.properties.order}. ${step.label}: ${step.properties.instruction}`), ...where].join('\n')
}

/** 판독 상자가 가리킬 수 있는 필드. 여기 없는 이름은 모델이 지어낸 것으로 본다. */
const OCR_BOX_FIELDS = ['merchant', 'businessNumber', 'date', 'total'] as const

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
    // 모델이 스키마의 선택지 문자열("merchant|businessNumber|date|total")을 값으로
    // 그대로 넣어오는 일이 있었다. 허용값 밖이면 좌표를 믿을 수 없으므로 버린다.
    const field = String(item.field || '').trim()
    if (!OCR_BOX_FIELDS.includes(field as (typeof OCR_BOX_FIELDS)[number])) return []
    // 이미지 전체를 가리키는 상자는 "여기 어딘가"라는 뜻이라 근거로 쓸 수 없다.
    if (safeX === 0 && safeY === 0 && width >= 1000 && height >= 1000) return []
    return [{
      field,
      label: String(item.label || field).slice(0, 120),
      value: String(item.value ?? '').slice(0, 300),
      bbox: [safeX, safeY, clamp(width, 1, 1000 - safeX), clamp(height, 1, 1000 - safeY)],
      confidence: clamp(Number(item.confidence || 0), 0, 1),
    }]
  })
}
