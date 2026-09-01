// 소상공인 프로젝트에서 이식한 모듈 통합 테스트.
// 상권분석 · 위험모형 연동 · 동적 지식그래프 · 사업자 진위확인 · 재무 교차검증.
const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`

async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  return { ok: response.ok, status: response.status, body: await response.json() as Record<string, any> }
}
async function ok(path: string, options: RequestInit = {}, token?: string) {
  const result = await request(path, options, token)
  if (!result.ok) throw new Error(`${path}: ${result.status} ${result.body.error || ''}`)
  return result.body
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

/* ── 1. 상권 원천데이터 매칭 ─────────────────────────────────── */

// 목화다방은 성수동 → 성수동 상권과 정확히 매칭되어야 한다.
const seongsu = await ok('/api/trust/r-mokhwa')
const area = seongsu.assessment.commercialArea
assert(area, '성수동 식당은 상권 데이터가 붙어야 합니다.')
assert(area.matchLevel === 'exact', '동 이름이 일치하면 exact 매칭이어야 합니다.')
assert(area.areaCode === 'SEOUL_SEONGDONG_SEONGSU', `성수동 상권이어야 합니다. (${area.areaCode})`)
assert(area.footTraffic.dailyAverage > 0 && area.marketDynamics.closureRate > 0, '상권 지표 원본이 함께 와야 합니다.')
assert(area.insight.opportunity && area.insight.caution, '투자자용 기회·위험 문장이 있어야 합니다.')

// 바다의 식탁은 부산 광안리 → 동 이름은 없지만 시 단위로 참고 매칭.
const busan = await ok('/api/trust/r-bada')
assert(busan.assessment.commercialArea?.matchLevel === 'nearby', '동 데이터가 없으면 시·구 참고 매칭이어야 합니다.')

// 인천 송도동은 데이터셋에 없다 — 추측해서 붙이지 않아야 한다.
const incheon = await ok('/api/trust/r-greenbowl')
assert(!incheon.assessment.commercialArea, '연동되지 않은 지역에 상권을 임의로 붙이면 안 됩니다.')
assert(incheon.assessment.missing.some((item: string) => item.includes('상권')), '미연동 사실을 missing 에 밝혀야 합니다.')
assert(incheon.assessment.confidence < seongsu.assessment.confidence, '상권 데이터가 없으면 신뢰도가 낮아야 합니다.')

/* ── 2. 위험모형이 상권 지표를 실제로 쓰는가 ──────────────────── */

assert(seongsu.assessment.methodology.modelVersion.includes('commercial'), '상권 연동 시 모형 버전이 달라야 합니다.')
assert(seongsu.assessment.methodology.calibratedProbability === false, '예비점수를 부도확률로 표현하면 안 됩니다.')
assert(seongsu.assessment.contributions.length === 5, '5개 구성요소 기여도를 공개해야 합니다.')
assert(Array.isArray(seongsu.assessment.contextualAlerts), '맥락 경고 배열이 있어야 합니다.')

// 서촌은 폐업률 13.7% · 경쟁밀도 0.83 → 맥락 경고가 떠야 한다.
const seochonLike = await ok('/api/trust/r-huaxiang')   // 연남동: 폐업률 10.4 · 경쟁밀도 0.71
assert(seochonLike.assessment.contextualAlerts.length > 0, '경쟁 밀도가 높은 상권은 맥락 경고가 있어야 합니다.')

/* ── 3. 동적 지식그래프 ─────────────────────────────────────── */

const graph = seongsu.graph
const types = new Set(graph.nodes.map((node: any) => node.type))
assert(graph.graphVersion === 'meoktu-role-graph-v2', '확장된 그래프 버전이어야 합니다.')
assert(types.has('GuideStep'), '역할별 절차 노드가 있어야 합니다.')
assert(types.has('Restaurant'), '대상 식당 노드가 있어야 합니다.')
assert(types.has('CommercialArea'), '상권 노드가 그래프에 들어가야 합니다.')
assert(types.has('FundingCampaign'), '펀딩 노드가 있어야 합니다.')
assert(types.has('CreditAssessment'), '위험평가 노드가 그래프에 들어가야 합니다.')
assert(graph.nodes.every((node: any) => node.source), '모든 노드에 출처가 표시되어야 합니다.')
assert(graph.edges.some((edge: any) => edge.relation === 'LOCATED_IN'), '식당→상권 관계가 있어야 합니다.')
assert(graph.edges.some((edge: any) => edge.relation === 'ASSESSED_BY'), '식당→평가 관계가 있어야 합니다.')

// 로그인한 투자자가 보면 내 보유분 노드가 붙는다.
const investor = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'investor@meoktu.demo', password: 'demo1234!' }) })
const myGraph = await ok('/api/knowledge-graph?restaurantId=r-mokhwa', {}, investor.token)
assert(myGraph.nodes.some((node: any) => node.type === 'InvestorHolding'), '투자자의 보유분이 그래프에 반영되어야 합니다.')

/* ── 4. 사업자 진위확인 ─────────────────────────────────────── */

const owner = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
const application = (extra: Record<string, unknown>) => ({
  restaurantName: '검증테스트', businessNumber: '1234567891', ownerName: '김소담', licenseNumber: '제2024-000123호',
  connectedSources: ['business', 'license', 'identity', 'pos', 'account', 'card', 'tax', 'debt', 'lease'],
  uploadedDocuments: { business: 'b.pdf', license: 'l.pdf', pos: 'p.csv', account: 'a.csv', card: 'c.csv', tax: 't.pdf', debt: 'd.pdf', lease: 'e.pdf' },
  identityVerified: true, privacyConsent: true, creditConsent: true,
  fundPurpose: '주방 설비 교체', businessPlan: '조리 시간을 단축합니다.', requestedLimit: 30000000,
  ...extra,
})

const badFormat = await request('/api/applications', { method: 'POST', body: JSON.stringify(application({ businessNumber: '123' })) }, owner.token)
assert(!badFormat.ok && badFormat.body.error.includes('10자리'), '사업자번호 자릿수 오류를 잡아야 합니다.')

// 검증번호(마지막 자리)만 틀린 값 — 형식은 맞지만 실제로 존재할 수 없는 번호
const badChecksum = await request('/api/applications', { method: 'POST', body: JSON.stringify(application({ businessNumber: '1234567890' })) }, owner.token)
assert(!badChecksum.ok && badChecksum.body.error.includes('검증번호'), '사업자번호 검증번호 오류를 잡아야 합니다.')

const noOwner = await request('/api/applications', { method: 'POST', body: JSON.stringify(application({ ownerName: '' })) }, owner.token)
assert(!noOwner.ok, '대표자명 없이 접수되면 안 됩니다.')

/* ── 5. 재무 교차검증이 심사에 연결되는가 ─────────────────────── */

const reviewed = await ok('/api/applications', { method: 'POST', body: JSON.stringify(application({})) }, owner.token)
const financial = reviewed.application.data.financialVerification
const business = reviewed.application.data.businessVerification
assert(business?.verified === true, '유효한 사업자 정보는 진위확인을 통과해야 합니다.')
assert(financial?.steps?.length === 6, `재무 교차검증 6단계가 기록되어야 합니다. (${financial?.steps?.length})`)
assert(financial.steps.every((step: any) => step.detail), '각 단계에 사람이 읽을 수 있는 근거가 있어야 합니다.')
assert(typeof financial.readyForAdminReview === 'boolean', '운영자 확인 준비 여부를 남겨야 합니다.')
assert(reviewed.application.checks.some((item: string) => item.includes('사업자 진위확인')), '심사 근거에 진위확인 결과가 포함되어야 합니다.')
assert(reviewed.application.checks.some((item: string) => item.includes('운영자')), 'AI 판독이 최종 승인이 아님을 명시해야 합니다.')

// 감사 이력에 두 검증이 모두 남는가
const ownerData = await ok('/api/owner', {}, owner.token)
assert(ownerData.auditEvents.some((item: any) => item.action === 'application.business_verified'), '사업자 진위확인 감사 이력이 남아야 합니다.')
assert(ownerData.auditEvents.some((item: any) => item.action === 'application.financial_orchestrated'), '재무 교차검증 감사 이력이 남아야 합니다.')

/* ── 6. AI 상담이 상권 근거를 인용할 수 있는가 ────────────────── */

const ai = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question: '목화다방 상권은 어때?', restaurantId: 'r-mokhwa' }) })
assert(ai.sources?.length, 'AI 답변에 근거 노드가 표시되어야 합니다.')
assert(ai.retrieval?.graphVersion === 'meoktu-role-graph-v2', 'AI가 확장된 그래프를 사용해야 합니다.')

console.log('PASS: 상권 매칭(exact/nearby/미연동) | 위험모형 연동 | 동적 지식그래프 | 사업자 진위확인 | 재무 교차검증 6단계 | AI 근거')
