import { readFileSync } from 'node:fs'

const base = process.env.MEOKTU_TEST_BASE || 'http://localhost:8787'
const call = async (path: string, options: RequestInit = {}, token?: string) => {
  const response = await fetch(base + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const body = await response.json() as Record<string, any>
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const sample = (name: string) => readFileSync(new URL(`../public/samples/${name}`, import.meta.url), 'utf8')

const legal = await call('/api/legal')
for (const documentId of ['privacy', 'credit-info', 'ai-assessment']) {
  assert(legal.required.owner_application.includes(documentId), `펀딩 신청 고지에 ${documentId}가 필요합니다.`)
  const document = await call(`/api/legal/${documentId}`)
  assert(document.document.sections.length > 0, `${documentId} 전문을 열 수 있어야 합니다.`)
}

const stamp = Date.now()
const owner = await call('/api/auth/signup', { method: 'POST', body: JSON.stringify({
  email: `owner-publication-${stamp}@meoktu.test`, password: 'test1234!', name: '공개검증 사장님', role: 'owner',
  consent: { version: legal.version, documentIds: legal.required.signup },
}) })
const documents = ['business', 'license', 'pos', 'account', 'card', 'delivery', 'tax', 'customer', 'lease', 'debt', 'staff']
const submitted = await call('/api/applications', { method: 'POST', body: JSON.stringify({
  restaurantName: `검증식당-${stamp}`, ownerName: '김소담', businessNumber: '1234567891', licenseNumber: '제2024-000123호',
  address: '서울특별시 마포구 망원동 12-3', category: '한식', signature: '들기름 고등어 한상', avgPrice: 13000,
  connectedSources: [...documents, 'identity'], uploadedDocuments: Object.fromEntries(documents.map((id) => [id, `${id}.${['business', 'license', 'tax', 'lease'].includes(id) ? 'pdf' : 'csv'}`])),
  documentContents: {
    pos: sample('meoktu-pos-sample.csv'), account: sample('meoktu-account-sample.csv'), card: sample('meoktu-card-settlement-sample.csv'),
    delivery: sample('meoktu-delivery-sample.csv'), customer: sample('meoktu-customer-sample.csv'), debt: sample('meoktu-debt-sample.csv'), staff: sample('meoktu-staff-sample.csv'),
  },
  identityVerified: true, privacyConsent: true, creditConsent: true,
  consent: { version: legal.version, documentIds: legal.required.owner_application },
  requestedLimit: 30000000, fundingPeriodMonths: 18, maxDiscount: 40,
  fundPurpose: '저온 저장고와 주방 설비 교체', businessPlan: '재방문 고객을 위한 좌석과 조리 설비를 확장합니다.', expectedEffect: '대기시간 단축과 좌석 회전율 개선',
}) }, owner.token)

const admin = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@meoktu.demo', password: 'demo1234!' }) })
const deniedDetail = await fetch(`${base}/api/admin/applications/${submitted.application.id}`, { headers: { Authorization: `Bearer ${owner.token}` } })
assert(deniedDetail.status === 403, '사장님은 관리자용 심사 상세자료를 조회할 수 없어야 합니다.')
const adminDetail = await call(`/api/admin/applications/${submitted.application.id}`, {}, admin.token)
assert(adminDetail.application.data.creditAssessment?.modelVersion, '운영자 상세에 35지표 AI 평가 근거가 있어야 합니다.')
assert(adminDetail.application.data.financialVerification?.steps?.length === 6, '운영자 상세에 6단계 교차검증 결과가 있어야 합니다.')
assert(Object.keys(adminDetail.application.data.documentMetadata || {}).length === documents.length, '운영자 상세에 제출 파일 메타데이터가 모두 있어야 합니다.')
assert(!adminDetail.application.data.documentContents, '관리자 대시보드 응답에 고객 거래 CSV 원문 전체를 저장·노출하면 안 됩니다.')
assert(Array.isArray(adminDetail.ocrAnalyses), '운영자 상세에 신청과 연결된 AI 판독 목록이 있어야 합니다.')

// 샘플이 운영자 확인 판정인 경우에도 관리자가 승인하면 같은 공개 파이프라인을 타야 한다.
if (submitted.application.status !== 'approved') {
  await call(`/api/admin/applications/${submitted.application.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }, admin.token)
}

const ownerState = await call('/api/owner', {}, owner.token)
const publicState = await call('/api/public')
const privateRestaurant = ownerState.restaurants.find((item: any) => item.name === submitted.application.restaurantName)
const publicRestaurant = publicState.restaurants.find((item: any) => item.name === submitted.application.restaurantName)
assert(privateRestaurant?.verificationStatus === 'verified', '사장님 원장에 검증 통과 식당이 연결되어야 합니다.')
assert(publicRestaurant?.fund?.status === 'funding', '검증 통과 식당과 펀드가 투자자 공개 목록에 함께 보여야 합니다.')
assert(ownerState.applications.some((item: any) => item.id === submitted.application.id && item.status === 'approved'), '사장님 마이페이지용 심사 결과가 저장되어야 합니다.')

console.log(`PASS: owner consent details | admin AI/document review detail | application ${submitted.application.status} | approved publication | owner verification history`)
