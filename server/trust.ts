import type { Fund, Restaurant, Role } from './types.ts'

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
  const components = {
    '매출 지속성': Number(clamp(58 + restaurant.salesGrowth * 1.25 + (restaurant.repeatRate - 35) * .2).toFixed(1)),
    '현금흐름 여력': Number(clamp(52 + restaurant.salesGrowth * .7 + fundingProgress * 12).toFixed(1)),
    '부채 부담': 60,
    '사업 운영 안정성': Number(clamp(42 + restaurant.openedYears * 4 + restaurant.stabilityScore * .3).toFixed(1)),
    '상권 회복력': Number(clamp(62 + restaurant.footTrafficGrowth * 1.2 - restaurant.closingRate * 1.1).toFixed(1)),
  }
  const contributions = Object.entries(weights).map(([label, weight]) => {
    const componentScore = components[label as keyof typeof components]
    return { label, componentScore, weight, contribution: Number(((componentScore - baseline) * weight).toFixed(1)) }
  })
  const score = clamp(Number((baseline + contributions.reduce((sum, item) => sum + item.contribution, 0)).toFixed(1)))
  return {
    score,
    grade: score >= 80 ? 'S2' : score >= 70 ? 'S3' : score >= 60 ? 'S4' : score >= 50 ? 'S5' : 'S7',
    riskLevel: score >= 75 ? 'low' : score >= 55 ? 'review' : 'high',
    confidence: 76,
    components,
    contributions,
    missing: ['공식 부채·상환 원자료'],
    diagnostics: {
      fundingProgress: Number((fundingProgress * 100).toFixed(1)),
      salesGrowth: restaurant.salesGrowth,
      repeatRate: restaurant.repeatRate,
      operatingYears: restaurant.openedYears,
      footTrafficGrowth: restaurant.footTrafficGrowth,
      closureRate: restaurant.closingRate,
    },
    methodology: {
      type: 'transparent_additive_prescreen',
      baseline,
      calibratedProbability: false,
      modelVersion: 'meoktu-moa-risk-v1',
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
  ['원천자료 제출', 'POS·계좌·카드·납세·부채 자료를 종류별로 제출합니다.'],
  ['AI OCR 교차검증', '문서 식별값·기간·금액·누락을 구조화해 비교합니다.'],
  ['운영자 원본 확인', 'AI 결과는 보조자료이며 사람이 원본을 확인합니다.'],
  ['모집안 작성', '자금 용도, 위험 대응, 공개항목과 지급 단계를 작성합니다.'],
  ['모집 심사·공개', '공식 검증과 운영자 심사 뒤 투자자에게 공개합니다.'],
  ['집행 증빙 제출', '공개 후 현재 단계의 계약서·영수증·완료 사진을 제출합니다.'],
]

export function buildKnowledgeGraph(role: Role, restaurant?: Restaurant, fund?: Fund) {
  const steps = role === 'owner' ? ownerSteps : investorSteps
  const prefix = role === 'owner' ? 'owner' : 'investor'
  const nodes: Array<{ id: string; type: string; label: string; properties: Record<string, string | number | boolean> }> = steps.map(([label, instruction], index) => ({
    id: `${prefix}:step:${index + 1}`,
    type: 'GuideStep',
    label,
    properties: { order: index + 1, instruction },
  }))
  const edges = nodes.slice(0, -1).map((node, index) => ({ from: node.id, relation: 'NEXT', to: nodes[index + 1].id }))
  if (restaurant) {
    const businessId = `restaurant:${restaurant.id}`
    nodes.push({ id: businessId, type: 'Restaurant', label: restaurant.name, properties: { category: restaurant.category, region: restaurant.neighborhood, salesGrowth: restaurant.salesGrowth } })
    edges.push({ from: nodes[Math.min(2, nodes.length - 1)].id, relation: 'EXAMINES', to: businessId })
    if (fund) {
      const fundId = `fund:${fund.id}`
      nodes.push({ id: fundId, type: 'FundingCampaign', label: `${restaurant.name} ${fund.round}차 펀딩`, properties: { goal: fund.goal, raised: fund.raised, status: fund.status } })
      edges.push({ from: businessId, relation: 'RAISES', to: fundId })
    }
  }
  return { graphVersion: 'meoktu-role-graph-v1', role, generatedAt: new Date().toISOString(), nodes, edges }
}

type KnowledgeGraph = ReturnType<typeof buildKnowledgeGraph>

const queryAliases: Record<string, string[]> = {
  투자: ['참여', '위험 동의', '손실 감내', '한도'],
  회수: ['회수 요청', 'FIFO', '매칭', '신규 예약'],
  심사: ['검증 자료', '운영자 원본 확인', '모집 심사'],
  서류: ['자료', '원천자료', '증빙', '업로드'],
  자료: ['서류', '원천자료', '증빙', '검증'],
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
