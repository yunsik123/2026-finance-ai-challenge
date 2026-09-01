// 사업자 진위확인 + 재무자료 AI 교차검증.
//
// 소상공인 프로젝트의 business-verification / financial-verification 을 먹투 데이터 모델에 맞춰 옮겼다.
// 원본은 문서 종류를 문자열 정규식으로 추측했지만, 먹투는 사장님이 어느 칸에 올렸는지(sourceId)를
// 알고 있으므로 그 값을 1차 기준으로 쓰고 OCR 판독 결과를 2차로 본다.
//
// 중요한 원칙: 이 모듈은 승인 여부를 결정하지 않는다. AI 판독은 보조자료이고,
// 최종 승인은 운영자가 원본을 확인한 뒤에 이뤄진다.
import crypto from 'node:crypto'
import type { OcrAnalysis } from './types.ts'

export type VerificationStatus = 'passed' | 'review' | 'failed' | 'not_compared'

export interface BusinessVerification {
  provider: string
  verified: boolean
  checks: Record<string, boolean>
  checkedAt: string
  message: string
}

/** 실제 국세청·식품안전나라 API를 붙일 때는 이 어댑터 구현만 바꾸면 된다. */
export function verifyBusiness(input: {
  businessNumber?: unknown
  ownerName?: unknown
  licenseNumber?: unknown
  identityVerified?: unknown
  applicantName?: string
}, provider = 'format-check-v1'): BusinessVerification {
  const number = String(input.businessNumber || '').replace(/\D/g, '')
  const checks = {
    사업자번호_형식: number.length === 10,
    사업자번호_검증번호: number.length === 10 && businessNumberChecksum(number),
    대표자명_입력: Boolean(String(input.ownerName || '').trim()),
    영업신고번호_입력: Boolean(String(input.licenseNumber || '').trim()),
    대표자_본인인증: input.identityVerified === true,
  }
  const verified = Object.values(checks).every(Boolean)
  return {
    provider,
    verified,
    checks,
    checkedAt: new Date().toISOString(),
    message: verified
      ? '사업자번호 형식·검증번호와 대표자 본인인증을 통과했습니다. 국세청 원본 대조는 운영자 확인 단계에서 이뤄집니다.'
      : '사업자번호, 대표자명, 영업신고번호, 본인인증 항목을 다시 확인해 주세요.',
  }
}

/** 국세청 사업자등록번호 검증번호 규칙. 오타를 즉시 잡아준다. */
function businessNumberChecksum(number: string) {
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  const digits = [...number].map(Number)
  let sum = digits.slice(0, 9).reduce((total, digit, index) => total + digit * weights[index], 0)
  sum += Math.floor((digits[8] * 5) / 10)
  return (10 - (sum % 10)) % 10 === digits[9]
}

/** 사장님이 올린 칸(sourceId)을 문서 성격으로 옮긴다. */
function documentCategory(sourceId: string, documentType: string) {
  if (['pos', 'card', 'delivery'].includes(sourceId)) return 'sales'
  if (sourceId === 'debt') return 'debt'
  if (sourceId === 'tax') return 'tax'
  if (sourceId === 'account') return 'bank'
  if (['business', 'license'].includes(sourceId)) return 'identity'
  if (/매출|전표|pos|카드/i.test(documentType)) return 'sales'
  if (/부채|대출|상환/i.test(documentType)) return 'debt'
  if (/납세|세금|계산서/i.test(documentType)) return 'tax'
  return 'other'
}

const rate = (claimed: number | null, observed: number | null) =>
  claimed === null || observed === null ? null : Math.abs(claimed - observed) / Math.max(Math.abs(observed), 1)

function compare(label: string, claimed: number | null, observed: number | null, source: string, tolerance = .05) {
  const delta = rate(claimed, observed)
  if (delta === null) return { label, claimed, observed, source, differenceRate: null, status: 'not_compared' as VerificationStatus }
  return {
    label, claimed, observed, source,
    differenceRate: Number((delta * 100).toFixed(1)),
    status: (delta <= tolerance ? 'passed' : delta <= .15 ? 'review' : 'failed') as VerificationStatus,
  }
}

export interface FinancialOrchestration {
  version: string
  steps: Array<{ code: string; label: string; status: VerificationStatus; detail: string }>
  comparisons: Array<{ label: string; claimed: number | null; observed: number | null; source: string; differenceRate: number | null; status: VerificationStatus }>
  missingDocuments: string[]
  mismatches: string[]
  warnings: string[]
  documentCount: number
  averageConfidence: number
  readyForAdminReview: boolean
  recommendedStatus: 'ready_for_admin' | 'mismatch' | 'needs_documents' | 'low_confidence' | 'needs_review'
}

/**
 * 6단계 교차검증. AI OCR 판독 결과와 사장님이 신고한 수치를 대조한다.
 * 어느 단계가 왜 걸렸는지 사람이 읽을 수 있게 detail 을 함께 남긴다.
 */
export function orchestrateFinancialVerification(input: {
  claims: { businessNumber?: unknown; monthlySales?: number | null; monthlyDebtPayment?: number | null; taxCompliant?: boolean }
  analyses: OcrAnalysis[]
  connectedSources: string[]
}): FinancialOrchestration {
  const documents = input.analyses.map((analysis) => {
    const result = analysis.result as Record<string, any>
    const raw = Number(result.confidence || 0)
    return {
      filename: analysis.filename,
      sourceId: analysis.sourceId,
      category: documentCategory(analysis.sourceId, String(result.documentType || '')),
      businessNumber: String(result.businessNumber || '').replace(/\D/g, ''),
      date: String(result.date || result.periodEnd || ''),
      total: Number.isFinite(Number(result.total)) ? Number(result.total) : null,
      planMatch: String(result.planMatch || ''),
      confidence: Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw)),
      aiRead: analysis.status === 'ai_extracted',
      fingerprint: crypto.createHash('sha1')
        .update(`${result.businessNumber || ''}|${result.date || ''}|${result.total || ''}|${result.merchant || ''}`)
        .digest('hex'),
    }
  })

  const has = (category: string) => documents.some((item) => item.category === category)
  const missingDocuments = [
    !input.connectedSources.includes('pos') && 'POS·카드매출 내역',
    !input.connectedSources.includes('debt') && '부채·월 상환 내역',
    !input.connectedSources.includes('tax') && '납세 확인 자료',
  ].filter(Boolean) as string[]

  const steps: FinancialOrchestration['steps'] = [
    { code: 'identity', label: '사업자 식별값 대조', status: 'not_compared', detail: '' },
    { code: 'period', label: '문서 기준기간 확인', status: 'not_compared', detail: '' },
    { code: 'sales', label: '매출 교차검증', status: 'not_compared', detail: '' },
    { code: 'debt', label: '부채·상환액 교차검증', status: 'not_compared', detail: '' },
    { code: 'tax', label: '납세 상태 교차검증', status: 'not_compared', detail: '' },
    { code: 'consistency', label: '문서 간 모순·중복 검사', status: 'not_compared', detail: '' },
  ]
  const comparisons: FinancialOrchestration['comparisons'] = []

  // ① 사업자 식별값
  const expected = String(input.claims.businessNumber || '').replace(/\D/g, '')
  const observed = documents.map((item) => item.businessNumber).filter(Boolean)
  const identityMismatch = Boolean(expected) && observed.some((value) => value !== expected)
  if (!documents.length) {
    steps[0].status = 'not_compared'
    steps[0].detail = 'AI 판독한 이미지 문서가 없어 대조하지 못했습니다.'
  } else if (identityMismatch) {
    steps[0].status = 'failed'
    steps[0].detail = `문서에서 읽은 사업자번호(${[...new Set(observed)].join(', ')})가 신고한 ${expected}와 다릅니다.`
  } else if (!observed.length) {
    steps[0].status = 'review'
    steps[0].detail = '문서에서 사업자번호를 읽지 못했습니다. 운영자가 원본을 확인해야 합니다.'
  } else {
    steps[0].status = 'passed'
    steps[0].detail = `${observed.length}개 문서의 사업자번호가 신고값과 일치합니다.`
  }

  // ② 기준기간
  const dated = documents.filter((item) => item.date)
  steps[1].status = !documents.length ? 'not_compared' : dated.length === documents.length ? 'passed' : dated.length ? 'review' : 'failed'
  steps[1].detail = !documents.length ? '판독한 문서가 없습니다.'
    : `${dated.length}/${documents.length}개 문서에서 기준일자를 확인했습니다.`

  // ③ 매출
  const salesDocuments = documents.filter((item) => item.category === 'sales' && item.total !== null)
  if (!input.connectedSources.includes('pos')) {
    steps[2].status = 'failed'
    steps[2].detail = 'POS·카드매출 원자료가 제출되지 않았습니다.'
  } else if (!salesDocuments.length) {
    steps[2].status = 'review'
    steps[2].detail = 'POS 자료는 제출됐지만 이미지 판독으로 금액을 확인하지 못했습니다. 운영자 확인이 필요합니다.'
  } else {
    const observedSales = salesDocuments.reduce((sum, item) => sum + (item.total || 0), 0) / salesDocuments.length
    const comparison = compare('월 매출', input.claims.monthlySales ?? null, observedSales, salesDocuments[0].filename, .15)
    comparisons.push(comparison)
    steps[2].status = comparison.status
    steps[2].detail = comparison.differenceRate === null
      ? '비교할 신고 매출값이 없습니다.'
      : `문서 판독액과 산출 매출의 차이가 ${comparison.differenceRate}%입니다.`
  }

  // ④ 부채
  const debtDocument = documents.find((item) => item.category === 'debt')
  if (!input.connectedSources.includes('debt')) {
    steps[3].status = 'not_compared'
    steps[3].detail = '부채 증빙이 제출되지 않아 상환부담을 확인할 수 없습니다.'
  } else if (!debtDocument || debtDocument.total === null) {
    steps[3].status = 'review'
    steps[3].detail = '부채 증빙에서 금액을 읽지 못했습니다.'
  } else {
    const comparison = compare('월 상환액', input.claims.monthlyDebtPayment ?? null, debtDocument.total, debtDocument.filename, .1)
    comparisons.push(comparison)
    steps[3].status = comparison.status
    steps[3].detail = comparison.differenceRate === null
      ? '문서값만 확인했고 비교할 신고값이 없습니다.'
      : `신고 상환액과 문서값의 차이가 ${comparison.differenceRate}%입니다.`
  }

  // ⑤ 납세
  const warningsFromPlan: string[] = []
  const taxDocument = documents.find((item) => item.category === 'tax')
  if (!input.connectedSources.includes('tax')) {
    steps[4].status = 'not_compared'
    steps[4].detail = '홈택스 신고자료가 제출되지 않았습니다.'
  } else if (!taxDocument) {
    steps[4].status = 'review'
    steps[4].detail = '납세 자료가 제출됐지만 판독되지 않았습니다.'
  } else {
    // planMatch는 "이 문서가 신고한 자금 사용계획과 맞는가"이지 납세 성실도가 아니다.
    // 예전에는 이 값을 그대로 납세 판정으로 읽어서, 사업자등록증에 찍힌 '적합'이
    // 납세 단계를 자동으로 통과시켰다. 납세는 신고값과 문서값으로만 판정한다.
    const claimedCompliant = input.claims.taxCompliant
    const taxAmount = taxDocument.total
    if (claimedCompliant === false) {
      steps[4].status = 'failed'
      steps[4].detail = '사장님이 납세 의무 이행을 "아니오"로 신고했습니다. 완납 후 다시 제출해야 합니다.'
    } else if (taxAmount === null) {
      steps[4].status = 'review'
      steps[4].detail = `납세 자료(${taxDocument.filename})에서 금액을 읽지 못했습니다. 운영자가 원본을 확인해야 합니다.`
    } else if (claimedCompliant !== true) {
      steps[4].status = 'review'
      steps[4].detail = `납세 자료는 판독했지만(신고액 ${taxAmount.toLocaleString()}원) 납세 의무 이행 신고가 비어 있습니다.`
    } else {
      steps[4].status = 'passed'
      steps[4].detail = `납세 자료에서 신고액 ${taxAmount.toLocaleString()}원을 확인했고, 사장님 신고와 어긋나지 않습니다.`
    }
    // 자금계획 적합성은 별도 경고로만 남긴다. 판정 근거로는 쓰지 않는다.
    if (taxDocument.planMatch === '부적합') warningsFromPlan.push(`${taxDocument.filename}이 신고한 자금 사용계획과 맞지 않는다고 판독됐습니다.`)
  }

  // ⑥ 중복·모순
  const fingerprints = documents.filter((item) => item.aiRead).map((item) => item.fingerprint)
  const duplicated = new Set(fingerprints).size !== fingerprints.length
  steps[5].status = !documents.length ? 'not_compared' : duplicated ? 'failed' : 'passed'
  steps[5].detail = duplicated
    ? '내용이 동일한 문서가 중복 제출됐습니다.'
    : documents.length ? '문서 간 중복이나 모순이 발견되지 않았습니다.' : '판독한 문서가 없습니다.'

  const mismatches = [
    ...(identityMismatch ? ['문서의 사업자등록번호가 신고한 번호와 다릅니다.'] : []),
    ...(duplicated ? ['동일한 내용의 문서가 중복 제출됐습니다.'] : []),
    ...comparisons.filter((item) => item.status === 'failed').map((item) => `${item.label} 신고값과 문서값이 크게 다릅니다.`),
  ]
  const averageConfidence = documents.length
    ? Number((documents.reduce((sum, item) => sum + item.confidence, 0) / documents.length).toFixed(2))
    : 0
  const warnings = [
    ...comparisons.filter((item) => item.status === 'review').map((item) => `${item.label} 차이가 허용범위를 넘어 운영자 확인이 필요합니다.`),
    ...documents.filter((item) => item.aiRead && item.confidence < .75).map((item) => `${item.filename} 판독 신뢰도가 ${Math.round(item.confidence * 100)}%로 낮습니다.`),
    ...missingDocuments.map((item) => `${item}가 아직 제출되지 않았습니다.`),
    ...warningsFromPlan,
  ]

  const readyForAdminReview = missingDocuments.length === 0
    && mismatches.length === 0
    && steps.every((step) => step.status === 'passed')
    && averageConfidence >= .75

  return {
    version: 'meoktu-financial-orchestrator-v1',
    steps, comparisons, missingDocuments, mismatches, warnings,
    documentCount: documents.length,
    averageConfidence,
    readyForAdminReview,
    // 신뢰도가 실제로 낮을 때만 'low_confidence'라고 부른다. 판독은 잘 됐는데
    // 어떤 단계가 아직 확인 중일 뿐인 경우까지 신뢰도 탓으로 돌리면 사유가 틀린다.
    recommendedStatus: readyForAdminReview ? 'ready_for_admin'
      : mismatches.length ? 'mismatch'
        : missingDocuments.length ? 'needs_documents'
          : averageConfidence < .75 ? 'low_confidence' : 'needs_review',
  }
}
