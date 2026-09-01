// 체험 세션 격리 · 직접 업로드/제휴 연결 출처 · 역할별 GraphRAG 통합 테스트.
const base = 'http://localhost:8787'

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

/* 1. 원클릭 데모는 계정 원장과 분리되고 변경 기능이 차단된다. */
const demoInvestor = await ok('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'investor' }) })
const demoInvestorMe = await ok('/api/me', {}, demoInvestor.token)
assert(demoInvestorMe.user.sessionMode === 'demo', '투자자 체험 토큰은 demo 세션이어야 합니다.')
const blockedTopup = await request('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount: 1000 }) }, demoInvestor.token)
assert(blockedTopup.status === 403 && (blockedTopup.body as any).error.includes('체험 모드'), '체험 세션의 충전·원장 변경을 막아야 합니다.')

const ownerAccount = await ok('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
const beforeOcrCount = (await ok('/api/owner', {}, ownerAccount.token)).ocrAnalyses.length
const demoOwner = await ok('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'owner' }) })
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const demoOcr = await ok('/api/ai/ocr', { method: 'POST', body: JSON.stringify({ image, filename: 'mvp-sample.png', sourceId: 'business', plan: '체험' }) }, demoOwner.token)
assert(demoOcr.ephemeral === true, '체험 OCR은 비영구 결과임을 표시해야 합니다.')
assert((await ok('/api/owner', {}, ownerAccount.token)).ocrAnalyses.length === beforeOcrCount, '체험 OCR 결과를 실제 계정 원장에 저장하면 안 됩니다.')
const blockedApplication = await request('/api/applications', { method: 'POST', body: '{}' }, demoOwner.token)
assert(blockedApplication.status === 403, '체험 세션의 심사 접수를 막아야 합니다.')

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
assert(investorAi.sources?.length && investorAi.answer.includes('투자자'), '투자자 역할 그래프에서 회수 절차를 답해야 합니다.')

console.log('PASS: 체험 세션 격리 | 실제 계정 원장 | 직접 업로드/제휴 출처 | 샘플 다운로드 | 투자자·소상공인 GraphRAG')
