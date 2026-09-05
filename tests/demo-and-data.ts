// 체험 샌드박스(실제 동작 + 공유 원장 무변경) · 직접 업로드/제휴 연결 출처 · 역할별 지식그래프 통합 테스트.
const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`

async function request(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const contentType = response.headers.get('content-type') || ''
  const body = contentType.includes('application/json') ? await response.json() as Record<string, any> : await response.text()
  return { ok: response.ok, status: response.status, body }
}
async function ok(path: string, options: RequestInit = {}, token?: string) {
  const result = await request(path, options, token)
  if (!result.ok) throw new Error(`${path}: ${result.status} ${(result.body as any)?.error || ''}`)
  return result.body as Record<string, any>
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const legal = await ok('/api/legal')

/* 1. 체험 세션은 실제로 동작하되 공유 원장을 건드리지 않는다. */
const demoInvestor = await ok('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'investor' }) })
const demoInvestorMe = await ok('/api/me', {}, demoInvestor.token)
assert(demoInvestorMe.user.sessionMode === 'demo', '투자자 체험 토큰은 demo 세션이어야 합니다.')
assert(demoInvestorMe.user.cash > 0, '체험 투자자는 바로 눌러볼 수 있는 시작 잔액을 가져야 합니다.')
assert(demoInvestorMe.coupons.length === 5, '투자자 체험은 매번 시작 쿠폰 5장을 받아야 합니다.')

const ledgerCashBefore = (await ok('/api/public')).stats.funded
const demoTopup = await ok('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount: 50000 }) }, demoInvestor.token)
assert(demoTopup.ephemeral === true, '체험 충전 결과는 비영구임을 표시해야 합니다.')
assert(demoTopup.balance === demoInvestorMe.user.cash + 50000, '체험 충전이 체험 잔액에 반영되어야 합니다.')

const demoTarget = (await ok('/api/public')).restaurants.find((item: any) => item.fund.status === 'funding')
const demoInvest = await ok(`/api/funds/${demoTarget.fund.id}/invest`, { method: 'POST', body: JSON.stringify({
  amount: 20000,
  consent: { version: legal.version, documentIds: legal.required.invest, riskAcknowledged: true },
}) }, demoInvestor.token)
assert(demoInvest.ephemeral === true, '체험 투자 결과는 비영구임을 표시해야 합니다.')
const demoAfterInvest = await ok('/api/me', {}, demoInvestor.token)
assert(demoAfterInvest.positions.some((item: any) => item.fundId === demoTarget.fund.id && item.amount === 20000), '체험 투자금이 체험 포트폴리오에 남아야 합니다.')

const demoCoupon = await ok(`/api/positions/${demoAfterInvest.positions[0].id}/coupon`, { method: 'POST' }, demoInvestor.token)
assert(demoCoupon.coupon?.discount > 0, '체험 투자자는 쿠폰을 발급받아 볼 수 있어야 합니다.')
await ok(`/api/restaurants/${demoTarget.id}/visit/verify`, { method: 'POST' }, demoInvestor.token)
const demoReview = await ok(`/api/restaurants/${demoTarget.id}/reviews`, { method: 'POST', body: JSON.stringify({ rating: 5, content: '체험으로 남겨보는 리뷰입니다.' }) }, demoInvestor.token)
assert(demoReview.ephemeral === true, '체험 리뷰도 비영구여야 합니다.')
const demoPublic = await ok('/api/public', {}, demoInvestor.token)
assert(demoPublic.restaurants.find((item: any) => item.id === demoTarget.id).reviews.some((item: any) => item.id === demoReview.review.id), '체험 리뷰는 본인 화면에서는 보여야 합니다.')
const sharedPublic = await ok('/api/public')
assert(!sharedPublic.restaurants.find((item: any) => item.id === demoTarget.id).reviews.some((item: any) => item.id === demoReview.review.id), '체험 리뷰가 공유 원장에 남으면 안 됩니다.')
assert(sharedPublic.stats.funded === ledgerCashBefore, '체험 투자가 공유 원장의 누적 펀딩을 바꾸면 안 됩니다.')

const otherDemo = await ok('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'investor' }) })
const otherDemoMe = await ok('/api/me', {}, otherDemo.token)
assert(otherDemo.token !== demoInvestor.token && otherDemoMe.user.id !== demoInvestorMe.user.id, '투자자 체험에 다시 들어가면 새 세션이어야 합니다.')
assert(otherDemoMe.user.cash === demoInvestorMe.demo.startingCash, '새 투자자 체험의 잔액은 시작 금액으로 초기화되어야 합니다.')
assert(otherDemoMe.positions.length === 0, '체험 세션끼리도 서로의 기록이 보이면 안 됩니다.')
// 새 체험 세션의 지갑에는 자기 가입 축하 쿠폰만 있어야 한다. 앞 세션이 발급한 쿠폰이 섞이면 안 된다.
assert(!otherDemoMe.coupons.some((item: any) => item.id === demoCoupon.coupon.id), '앞 체험 세션의 쿠폰이 보이면 안 됩니다.')
assert(otherDemoMe.coupons.length === 5 && otherDemoMe.coupons.every((item: any) => item.status === 'available' && !item.fundId),
  '새 투자자 체험은 시작 쿠폰 5장만 들고 시작해야 합니다.')

// 가입 축하 쿠폰만으로 교환장에서 실제 교환까지 해볼 수 있어야 한다.
const demoMarket = await ok('/api/public', {}, otherDemo.token)
const swappable = demoMarket.listings.find((item: any) => item.matchableCouponIds.length > 0)
assert(swappable, '체험 지갑 기준으로 교환 가능한 매물이 표시되어야 합니다.')
const demoSwap = await ok(`/api/listings/${swappable.id}/offers`, {
  method: 'POST', body: JSON.stringify({ couponId: swappable.matchableCouponIds[0] }),
}, otherDemo.token)
assert(demoSwap.ephemeral === true && demoSwap.coupon?.id, '체험 교환은 비영구 결과로 체결되어야 합니다.')
const afterSwap = await ok('/api/me', {}, otherDemo.token)
assert(afterSwap.coupons.some((item: any) => item.id === demoSwap.coupon.id), '교환으로 받은 쿠폰이 체험 지갑에 있어야 합니다.')
assert(afterSwap.coupons.find((item: any) => item.id === swappable.matchableCouponIds[0])?.status === 'used', '내놓은 쿠폰은 지갑에서 빠져야 합니다.')
const sharedAfterSwap = await ok('/api/public')
assert(sharedAfterSwap.listings.some((item: any) => item.id === swappable.id), '체험 교환이 공유 원장의 매물을 가져가면 안 됩니다.')

const ownerAccount = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
const beforeOcrCount = (await ok('/api/owner', {}, ownerAccount.token)).ocrAnalyses.length
const demoOwner = await ok('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'owner' }) })
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const demoOcr = await ok('/api/ai/ocr', { method: 'POST', body: JSON.stringify({ image, filename: 'mvp-sample.png', sourceId: 'business', plan: '체험' }) }, demoOwner.token)
assert(demoOcr.ephemeral === true, '체험 OCR은 비영구 결과임을 표시해야 합니다.')
assert((await ok('/api/owner', {}, ownerAccount.token)).ocrAnalyses.length === beforeOcrCount, '체험 OCR 결과를 실제 계정 원장에 저장하면 안 됩니다.')
const demoConnection = await ok('/api/data-connections/pos', { method: 'POST', body: JSON.stringify({}) }, demoOwner.token)
assert(demoConnection.ephemeral === true && demoConnection.connection.sourceId === 'pos', '체험 사장님은 기관 연결을 눌러볼 수 있어야 합니다.')
assert((await ok('/api/owner', {}, ownerAccount.token)).dataConnections.every((item: any) => item.id !== demoConnection.connection.id), '체험 기관 연결이 실제 계정 원장에 남으면 안 됩니다.')
const freshDemoOwner = await ok('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'owner' }) })
const freshDemoOwnerState = await ok('/api/owner', {}, freshDemoOwner.token)
assert(freshDemoOwner.token !== demoOwner.token, '사장님 체험에 다시 들어가면 새 세션이어야 합니다.')
assert(freshDemoOwnerState.dataConnections.length === 0 && freshDemoOwnerState.applications.length === 0,
  '새 사장님 체험에는 이전 체험의 기관 연결과 심사 기록이 남지 않아야 합니다.')
const invalidDemoApplication = await request('/api/applications', { method: 'POST', body: '{}' }, demoOwner.token)
assert(invalidDemoApplication.status === 400, '체험 심사도 실제와 같은 입력 검증을 거쳐야 합니다.')

/* 2. 실제 로그인 계정은 원장을 변경하고 제휴 연결을 서버에 저장한다. */
const investorAccount = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'investor@meoktu.demo', password: 'demo1234!' }) })
const cashBefore = (await ok('/api/me', {}, investorAccount.token)).user.cash
await ok('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, investorAccount.token)
assert((await ok('/api/me', {}, investorAccount.token)).user.cash === cashBefore + 1000, '실제 로그인 계정의 변경은 공유 원장에 저장되어야 합니다.')

const posConnection = await ok('/api/data-connections/pos', { method: 'POST', body: JSON.stringify({ consent: true }) }, ownerAccount.token)
assert(posConnection.connection.sourceId === 'pos', 'POS 제휴 연결이 서버 원장에 저장되어야 합니다.')
const ownerAfterConnection = await ok('/api/owner', {}, ownerAccount.token)
assert(ownerAfterConnection.dataConnections.some((item: any) => item.sourceId === 'pos'), '소상공인 화면에서 활성 기관 연결을 다시 읽을 수 있어야 합니다.')

const applicationPayload = {
  restaurantName: '출처구분 테스트식당', businessNumber: '1234567891', ownerName: '김소담', licenseNumber: '제2026-000123호', address: '서울시 마포구 망원동',
  connectedSources: ['business', 'license', 'identity', 'account'],
  uploadedDocuments: { business: 'meoktu-business-sample.png', license: 'license-sample.png', account: 'meoktu-account-sample.csv' },
  documentMetadata: { account: { size: 512, type: 'text/csv', rowCount: 5, headers: ['거래일시', '입금액', '출금액', '잔액', '거래상대방', '적요'] } },
  identityVerified: true, privacyConsent: true, creditConsent: true,
  consent: { version: legal.version, documentIds: legal.required.owner_application },
  fundPurpose: '주방 설비 교체', businessPlan: '조리 시간을 줄이고 좌석 회전율을 높입니다.', expectedEffect: '대기시간 단축', requestedLimit: 30000000,
}
const reviewed = await ok('/api/applications', { method: 'POST', body: JSON.stringify(applicationPayload) }, ownerAccount.token)
const provenance = reviewed.application.data.sourceProvenance
assert(provenance.ownerUploaded.includes('business') && provenance.ownerUploaded.includes('account'), '직접 업로드 출처가 별도로 남아야 합니다.')
assert(provenance.partnerConnected.includes('pos'), '제휴기관 연결 출처가 별도로 남아야 합니다.')
assert(reviewed.application.data.documentMetadata.account.rowCount === 5, '업로드 CSV의 검증 메타데이터가 남아야 합니다.')

/* 3. 심사자가 실제 샘플을 내려받을 수 있다. */
const csv = await request('/samples/meoktu-pos-sample.csv')
assert(csv.ok && String(csv.body).includes('영업일') && String(csv.body).includes('주문금액'), 'POS CSV 샘플을 다운로드할 수 있어야 합니다.')
const png = await fetch(`${base}/samples/meoktu-business-sample.png`)
assert(png.ok && Number(png.headers.get('content-length') || 0) > 1000, 'OCR용 PNG 샘플을 다운로드할 수 있어야 합니다.')

/* 4. 투자자·소상공인 GraphRAG가 서로 다른 절차와 동적 근거를 검색한다. */
const investorGraph = await ok('/api/knowledge-graph?role=investor&restaurantId=r-mokhwa', {}, investorAccount.token)
assert(investorGraph.role === 'investor', '투자자 그래프 역할이 유지되어야 합니다.')
assert(investorGraph.nodes.some((node: any) => node.type === 'InvestorHolding'), '로그인 투자자의 보유분 노드가 필요합니다.')
assert(investorGraph.nodes.every((node: any) => node.source), '투자자 그래프 모든 노드에 출처가 필요합니다.')

const ownerGraph = await ok('/api/knowledge-graph?role=owner&restaurantId=r-sobok', {}, ownerAccount.token)
assert(ownerGraph.role === 'owner', '소상공인 그래프 역할이 유지되어야 합니다.')
assert(ownerGraph.nodes.some((node: any) => node.type === 'FinancialClaim'), '소상공인 그래프에 심사 청구 노드가 필요합니다.')
assert(ownerGraph.nodes.some((node: any) => node.type === 'VerificationRun'), '소상공인 그래프에 교차검증 실행 노드가 필요합니다.')
assert(ownerGraph.edges.some((edge: any) => edge.relation === 'REVIEWED_BY'), '교차검증과 운영자 확인 관계가 필요합니다.')

const ownerAi = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'owner', restaurantId: 'r-sobok', question: '마이데이터 연동과 직접 업로드는 어떻게 구분해?' }) }, ownerAccount.token)
assert(ownerAi.sources?.length && ownerAi.retrieval?.graphVersion === 'meoktu-role-graph-v2', '소상공인 AI가 GraphRAG 근거와 버전을 반환해야 합니다.')
assert(ownerAi.answer.includes('사장님') || ownerAi.answer.includes('업로드'), '소상공인 역할 절차로 답해야 합니다.')
const investorAi = await ok('/api/ai/chat', { method: 'POST', body: JSON.stringify({ role: 'investor', restaurantId: 'r-mokhwa', question: '투자금 회수 절차를 알려줘' }) }, investorAccount.token)
// 생성형 답변은 같은 근거로도 표현이 매번 달라진다. 특정 단어로 검사하면
// 기능이 멀쩡해도 실행마다 실패한다(실제로 표현만 바뀌어 3회 중 1회 실패했다).
// 그래서 검사 대상을 "무엇을 근거로 골랐는가"로 옮긴다. 이 값은 그래프와 질문이 같으면
// 항상 같고, 검색이 깨지면 바로 달라지므로 오히려 더 강한 검사다.
assert(investorAi.sources?.length, '투자자 상담이 GraphRAG 근거를 반환해야 합니다.')
assert(investorAi.sources.some((source: any) => source.type === 'GuideStep'),
  '투자자 역할 그래프에서 회수 절차 노드를 근거로 골라야 합니다.')
assert(/회수|매칭|예약/.test(investorAi.answer), '회수 질문에 회수 절차로 답해야 합니다.')

console.log('PASS: 체험 샌드박스(충전·투자·쿠폰·리뷰·기관연결) | 공유 원장 무변경 | 세션 간 격리 | 직접 업로드/제휴 출처 | 샘플 다운로드 | 역할별 지식그래프')
