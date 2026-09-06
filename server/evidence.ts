/**
 * 증거 원장(Evidence Ledger).
 *
 * 지금까지 심사는 "숫자"를 냈다. 월평균매출 3,610만원, 성장률 8.4%.
 * 그런데 사장님도 투자자도 운영자도 "그 숫자가 어디서 나왔는지"는 볼 수 없었다.
 * metrics.ts 가 계산 근거(어느 파일 몇 행)를 이미 만들고 있었지만
 * 화면까지 이어지지 않아서, 결과적으로 "AI가 점수를 지어낸 것"과 구분되지 않았다.
 *
 * 이 모듈은 두 가지를 만든다.
 *   ① links   — 지표 하나에 붙은 근거 목록. "3,610만원은 POS 3,120행 합산이고,
 *                계좌 입금으로는 3,576만원, 차이는 0.94%다."
 *   ② crossChecks / quality — 서로 다른 자료끼리 실제로 맞춰본 결과와 그 종합 점수.
 *
 * 원칙은 verification.ts 와 같다. 여기서 점수가 높게 나와도 승인이 아니고,
 * 값이 없는 항목은 벌점 대신 '미산정'으로 남긴다. 없는 근거를 만들어 채우지 않는다.
 */
import type { DerivedMetrics, MetricEvidence } from './metrics.ts'
import type { OcrAnalysis } from './types.ts'
import type { VerificationStatus } from './verification.ts'

export const EVIDENCE_LEDGER_VERSION = 'meoktu-evidence-ledger-v1'

/** 출처 id → 사장님이 읽을 이름. 화면·AI 답변·운영자 화면이 같은 이름을 쓴다. */
export const sourceLabels: Record<string, string> = {
  business: '사업자등록 자료',
  license: '영업신고 자료',
  identity: '대표자 본인인증',
  pos: 'POS 정산 자료',
  account: '사업용 계좌 내역',
  card: '카드 매출 자료',
  delivery: '배달 플랫폼 자료',
  customer: '고객 방문 자료',
  tax: '납세 자료',
  debt: '부채·상환 자료',
  lease: '임대차 자료',
  staff: '인력·급여 자료',
  commercial: '공개 상권 자료',
}

type Unit = 'won' | 'percent' | 'years' | 'count' | 'text'

/** 근거를 붙일 지표. 여기 없는 집계 중간값은 사장님 화면에 내보내지 않는다. */
export const metricMeta: Record<string, { label: string; unit: Unit }> = {
  recent12MonthAverageSales: { label: '최근 12개월 평균매출', unit: 'won' },
  recent12MonthSalesGrowth: { label: '최근 12개월 성장률', unit: 'percent' },
  recent3MonthSalesGrowth: { label: '최근 3개월 성장률', unit: 'percent' },
  estimatedMonthlyOperatingCashflow: { label: '추정 월 영업현금흐름', unit: 'won' },
  accountMonthlyInflow: { label: '계좌 월 입금액', unit: 'won' },
  averageCashBalance: { label: '평균 예금잔액', unit: 'won' },
  minimumCashBalance: { label: '최저 예금잔액', unit: 'won' },
  salesVolatility: { label: '매출 변동성', unit: 'percent' },
  repeatRate: { label: '재방문율', unit: 'percent' },
  averageTicket: { label: '객단가', unit: 'won' },
  cardMonthlyAverage: { label: '카드 월평균 승인액', unit: 'won' },
  cardFeeRatio: { label: '카드 수수료율', unit: 'percent' },
  deliveryMonthlyAverage: { label: '배달 월평균 매출', unit: 'won' },
  deliverySalesShare: { label: '배달매출 비중', unit: 'percent' },
  deliveryRepeatRatio: { label: '배달 재주문율', unit: 'percent' },
  monthlyRent: { label: '월 임차료', unit: 'won' },
  leaseDeposit: { label: '임대 보증금', unit: 'won' },
  rentToSalesRatio: { label: '임차료/매출', unit: 'percent' },
  totalLoanBalance: { label: '총 대출잔액', unit: 'won' },
  monthlyDebtPayment: { label: '월 원리금 상환액', unit: 'won' },
  numberOfLenders: { label: '금융기관 수', unit: 'count' },
  averageInterestRate: { label: '평균 대출금리', unit: 'percent' },
  debtServiceToCashflowRatio: { label: '원리금상환/현금흐름', unit: 'percent' },
  monthlyPayroll: { label: '월 인건비', unit: 'won' },
  operatingYears: { label: '검증 업력', unit: 'years' },
  staffTrend: { label: '직원 추이', unit: 'text' },
  districtSalesGrowth: { label: '상권 매출 성장률', unit: 'percent' },
  relativeSalesGrowth: { label: '상권 대비 초과성장', unit: 'percent' },
  salesReconciliationRate: { label: '매출 교차검증 일치도', unit: 'percent' },
  netCashflowRatio: { label: '순현금흐름 비율', unit: 'percent' },
}

export type EvidenceSupport = {
  /** upload=사장님이 올린 표, document=이미지·PDF 판독, partner=기관 연결, public=공개자료, declared=사장님 신고값 */
  kind: 'upload' | 'document' | 'partner' | 'public' | 'declared'
  sourceId: string
  sourceLabel: string
  file?: string
  rows?: number
  value: number | string | null
  /** 0~1. 표 집계는 1, 판독값은 모델 신뢰도, 신고값은 0.5. */
  confidence: number
  note?: string
}

export type EvidenceLink = {
  metric: string
  label: string
  unit: Unit
  value: number | string | null
  supports: EvidenceSupport[]
}

export type CrossCheck = {
  code: string
  label: string
  left: { label: string; value: number; sourceId: string }
  right: { label: string; value: number; sourceId: string }
  /** |a-b| / max(a,b) × 100. 상한 검사(카드≤매출)에서는 초과분만 센다. */
  differenceRate: number
  /** 이 정도 차이는 정상으로 본다(%). */
  tolerance: number
  status: VerificationStatus
  /** 0~100. 차이가 tolerance 면 75점, 4배면 0점. */
  score: number
  weight: number
  detail: string
}

export type EvidenceQuality = {
  /** 대조한 쌍이 하나도 없으면 null. 0점이 아니다. */
  score: number | null
  grade: '높음' | '보통' | '주의' | '미산정'
  comparedPairs: number
  possiblePairs: number
  /** 대조 가능한 쌍 중 실제로 대조한 비율(%). */
  coverage: number
  sourceCount: number
  documentCount: number
  averageDocumentConfidence: number
  mismatches: string[]
  notCompared: string[]
}

export type EvidenceLedger = {
  version: string
  links: EvidenceLink[]
  crossChecks: CrossCheck[]
  quality: EvidenceQuality
}

const round1 = (value: number) => Number(value.toFixed(1))
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 차이율 → 점수. tolerance 에서 75점, 2배에서 50점, 4배에서 0점. */
function pairScore(differenceRate: number, tolerance: number) {
  if (tolerance <= 0) return differenceRate === 0 ? 100 : 0
  return Math.round(clamp(100 - (differenceRate / tolerance) * 25, 0, 100))
}

function statusFor(differenceRate: number, tolerance: number): VerificationStatus {
  if (differenceRate <= tolerance) return 'passed'
  if (differenceRate <= tolerance * 2) return 'review'
  return 'failed'
}

/** 두 값이 같은 것을 재는지 볼 때 쓴다. 큰 쪽을 분모로 둬서 순서에 상관없이 같은 값이 나온다. */
function differenceOf(a: number, b: number) {
  const scale = Math.max(Math.abs(a), Math.abs(b))
  if (!scale) return 0
  return round1(Math.abs(a - b) / scale * 100)
}

type DocumentReading = {
  sourceId: string
  filename: string
  total: number | null
  businessNumber: string
  date: string
  periodStart: string
  periodEnd: string
  confidence: number
  aiRead: boolean
}

function readDocuments(analyses: OcrAnalysis[]): DocumentReading[] {
  return analyses.map((analysis) => {
    const result = (analysis.result || {}) as Record<string, unknown>
    const raw = Number(result.confidence || 0)
    const total = Number(result.total)
    return {
      sourceId: analysis.sourceId,
      filename: analysis.filename,
      total: Number.isFinite(total) && total > 0 ? total : null,
      businessNumber: String(result.businessNumber || '').replace(/\D/g, ''),
      date: String(result.date || ''),
      periodStart: String(result.periodStart || ''),
      periodEnd: String(result.periodEnd || ''),
      confidence: clamp(raw > 1 ? raw / 100 : raw, 0, 1),
      aiRead: analysis.status === 'ai_extracted',
    }
  })
}

/**
 * 판독한 문서 금액을 '월 기준'으로 바꾼다.
 * 부가세 신고서는 보통 분기(3개월)라서 그대로 월매출과 비교하면 3배 차이가 난다.
 * 과세기간이 적혀 있으면 그 개월 수로 나누고, 없으면 나누지 않고 기간 미상으로 표시한다.
 */
function monthsCovered(reading: DocumentReading) {
  const start = reading.periodStart.match(/(\d{4})[-./](\d{1,2})/)
  const end = reading.periodEnd.match(/(\d{4})[-./](\d{1,2})/)
  if (!start || !end) return null
  const months = (Number(end[1]) - Number(start[1])) * 12 + (Number(end[2]) - Number(start[2])) + 1
  return months >= 1 && months <= 24 ? months : null
}

export type EvidenceInput = {
  /** deriveMetricsFromUploads 의 metrics 전체(집계 중간값 포함). */
  metrics: DerivedMetrics
  /** 어느 파일 몇 행에서 무엇을 계산했는지. */
  evidence: MetricEvidence[]
  /** AI 판독 결과. */
  analyses: OcrAnalysis[]
  /** 사장님이 직접 올린 출처 id. */
  uploadedSources: string[]
  /** 기관 연결로 들어온 출처 id. */
  partnerSources: string[]
  /** 사장님이 폼에 적어 넣은 값. */
  declared?: { businessNumber?: string }
  /** 주소로 찾은 공개 상권 자료에서 온 값. */
  publicMetrics?: { districtSalesGrowth?: number | null }
}

/** 대조를 시도할 쌍의 전체 목록. coverage 분모로 쓴다. */
const PAIR_CODES = [
  'pos-account', 'pos-card', 'pos-delivery', 'pos-tax',
  'debt-document', 'lease-document', 'identity-document', 'payroll-sales',
] as const

export function buildEvidenceLedger(input: EvidenceInput): EvidenceLedger {
  const metrics = input.metrics || {}
  const documents = readDocuments(input.analyses || [])
  const crossChecks: CrossCheck[] = []
  /** 지표에 "다른 자료로 본 값"을 덧붙이기 위한 임시 저장소. */
  const crossSupports: Record<string, EvidenceSupport[]> = {}

  const addSupport = (metric: string, support: EvidenceSupport) => {
    crossSupports[metric] ??= []
    crossSupports[metric].push(support)
  }

  const sales = isNum(metrics.recent12MonthAverageSales) ? metrics.recent12MonthAverageSales : null
  const inflow = isNum(metrics.accountMonthlyInflow) ? metrics.accountMonthlyInflow : null
  const card = isNum(metrics.cardMonthlyAverage) ? metrics.cardMonthlyAverage : null
  const delivery = isNum(metrics.deliveryMonthlyAverage) ? metrics.deliveryMonthlyAverage : null
  const payroll = isNum(metrics.monthlyPayroll) ? metrics.monthlyPayroll : null
  const rent = isNum(metrics.monthlyRent) ? metrics.monthlyRent : null
  const loanBalance = isNum(metrics.totalLoanBalance) ? metrics.totalLoanBalance : null

  // ① POS 매출 ↔ 계좌 입금. 같은 것을 재는 두 자료라 가장 무겁게 본다.
  if (sales !== null && inflow !== null && inflow > 0) {
    const difference = differenceOf(sales, inflow)
    crossChecks.push({
      code: 'pos-account', label: '매출 ↔ 계좌 입금',
      left: { label: 'POS 월평균 매출', value: sales, sourceId: 'pos' },
      right: { label: '계좌 월 입금액', value: inflow, sourceId: 'account' },
      differenceRate: difference, tolerance: 15,
      status: statusFor(difference, 15), score: pairScore(difference, 15), weight: 3,
      detail: difference <= 15
        ? `POS 매출과 계좌 입금의 차이가 ${difference}%로 서로 맞습니다.`
        : `POS 매출과 계좌 입금의 차이가 ${difference}%입니다. 매출 외 입금이 섞였거나 기간이 다른 자료일 수 있어요.`,
    })
    addSupport('recent12MonthAverageSales', {
      kind: 'upload', sourceId: 'account', sourceLabel: sourceLabels.account,
      value: inflow, confidence: 1, note: `계좌 입금 기준 추정 · POS와 ${difference}% 차이`,
    })
  }

  // ② 카드 승인액은 매출의 일부여야 한다. 매출보다 크면 자료가 어긋난 것이다.
  if (sales !== null && card !== null && sales > 0) {
    const share = round1(card / sales * 100)
    const excess = Math.max(0, round1(share - 100))
    crossChecks.push({
      code: 'pos-card', label: '매출 ↔ 카드 승인액',
      left: { label: 'POS 월평균 매출', value: sales, sourceId: 'pos' },
      right: { label: '카드 월평균 승인액', value: card, sourceId: 'card' },
      differenceRate: excess, tolerance: 5,
      status: statusFor(excess, 5), score: pairScore(excess, 5), weight: 2,
      detail: excess === 0
        ? `카드 승인액이 매출의 ${share}%로 매출 범위 안에 있습니다.`
        : `카드 승인액이 POS 매출의 ${share}%입니다. 카드가 매출보다 클 수 없으니 기간이 다른 자료가 섞였을 수 있어요.`,
    })
    addSupport('recent12MonthAverageSales', {
      kind: 'upload', sourceId: 'card', sourceLabel: sourceLabels.card,
      value: card, confidence: 1, note: `매출의 ${share}%`,
    })
  }

  // ③ 배달 매출도 전체 매출을 넘을 수 없다.
  if (sales !== null && delivery !== null && sales > 0) {
    const share = round1(delivery / sales * 100)
    const excess = Math.max(0, round1(share - 100))
    crossChecks.push({
      code: 'pos-delivery', label: '매출 ↔ 배달 매출',
      left: { label: 'POS 월평균 매출', value: sales, sourceId: 'pos' },
      right: { label: '배달 월평균 매출', value: delivery, sourceId: 'delivery' },
      differenceRate: excess, tolerance: 5,
      status: statusFor(excess, 5), score: pairScore(excess, 5), weight: 1,
      detail: excess === 0
        ? `배달 매출이 전체 매출의 ${share}%입니다.`
        : `배달 매출이 전체 매출의 ${share}%로 계산됩니다. 두 자료의 기간을 확인해주세요.`,
    })
  }

  // ④ POS 매출 ↔ 납세 자료 판독액. 분기 신고서면 개월 수로 나눠 월 기준으로 맞춘다.
  const taxDocument = documents.find((item) => item.sourceId === 'tax' && item.total !== null && item.aiRead)
  if (sales !== null && taxDocument?.total) {
    const months = monthsCovered(taxDocument)
    const monthly = months ? Math.round(taxDocument.total / months) : taxDocument.total
    const difference = differenceOf(sales, monthly)
    const tolerance = 20
    crossChecks.push({
      code: 'pos-tax', label: '매출 ↔ 신고매출',
      left: { label: 'POS 월평균 매출', value: sales, sourceId: 'pos' },
      right: { label: months ? `신고매출 월환산(${months}개월)` : '신고매출 판독액(기간 미상)', value: monthly, sourceId: 'tax' },
      differenceRate: difference, tolerance,
      status: months ? statusFor(difference, tolerance) : 'review',
      score: months ? pairScore(difference, tolerance) : 50, weight: 3,
      detail: !months
        ? '납세 자료에서 과세기간을 읽지 못해 월 기준으로 환산하지 못했습니다. 운영자 확인이 필요합니다.'
        : difference <= tolerance
          ? `신고매출을 ${months}개월로 나눈 값과 POS 매출의 차이가 ${difference}%입니다.`
          : `신고매출 월환산값과 POS 매출의 차이가 ${difference}%입니다. 현금매출 누락 또는 기간 불일치를 확인해야 합니다.`,
    })
    addSupport('recent12MonthAverageSales', {
      kind: 'document', sourceId: 'tax', sourceLabel: sourceLabels.tax, file: taxDocument.filename,
      value: monthly, confidence: taxDocument.confidence,
      note: months ? `신고액 ${taxDocument.total.toLocaleString('ko-KR')}원 ÷ ${months}개월` : '과세기간 미확인',
    })
  }

  // ⑤ 부채 표 집계 ↔ 부채 증빙 판독액.
  const debtDocument = documents.find((item) => item.sourceId === 'debt' && item.total !== null && item.aiRead)
  if (loanBalance !== null && debtDocument?.total) {
    const difference = differenceOf(loanBalance, debtDocument.total)
    crossChecks.push({
      code: 'debt-document', label: '대출잔액 ↔ 부채 증빙',
      left: { label: '부채 표 합계', value: loanBalance, sourceId: 'debt' },
      right: { label: '부채 증빙 판독액', value: debtDocument.total, sourceId: 'debt' },
      differenceRate: difference, tolerance: 10,
      status: statusFor(difference, 10), score: pairScore(difference, 10), weight: 2,
      detail: difference <= 10
        ? `제출한 부채 표와 증빙 서류의 잔액이 ${difference}% 차이로 일치합니다.`
        : `부채 표 합계와 증빙 판독액의 차이가 ${difference}%입니다. 최근 상환분이 반영되지 않았을 수 있어요.`,
    })
    addSupport('totalLoanBalance', {
      kind: 'document', sourceId: 'debt', sourceLabel: sourceLabels.debt, file: debtDocument.filename,
      value: debtDocument.total, confidence: debtDocument.confidence,
    })
  }

  // ⑥ 임대차 표 ↔ 임대차 계약서 판독액.
  const leaseDocument = documents.find((item) => item.sourceId === 'lease' && item.total !== null && item.aiRead)
  if (rent !== null && leaseDocument?.total) {
    const difference = differenceOf(rent, leaseDocument.total)
    crossChecks.push({
      code: 'lease-document', label: '월 임차료 ↔ 계약서',
      left: { label: '임대차 표 월세', value: rent, sourceId: 'lease' },
      right: { label: '계약서 판독 금액', value: leaseDocument.total, sourceId: 'lease' },
      differenceRate: difference, tolerance: 10,
      status: statusFor(difference, 10), score: pairScore(difference, 10), weight: 1,
      detail: difference <= 10
        ? `임대차 자료와 계약서의 임차료가 ${difference}% 차이로 일치합니다.`
        : `임대차 자료의 월세와 계약서 판독액의 차이가 ${difference}%입니다.`,
    })
    addSupport('monthlyRent', {
      kind: 'document', sourceId: 'lease', sourceLabel: sourceLabels.lease, file: leaseDocument.filename,
      value: leaseDocument.total, confidence: leaseDocument.confidence,
    })
  }

  // ⑦ 신고 사업자번호 ↔ 문서에서 읽은 사업자번호. 숫자가 다르면 곧바로 불일치다.
  const declaredNumber = String(input.declared?.businessNumber || '').replace(/\D/g, '')
  const readNumbers = [...new Set(documents.filter((item) => item.businessNumber).map((item) => item.businessNumber))]
  if (declaredNumber && readNumbers.length) {
    const mismatched = readNumbers.filter((value) => value !== declaredNumber)
    const difference = mismatched.length ? 100 : 0
    crossChecks.push({
      code: 'identity-document', label: '사업자번호 ↔ 서류 판독값',
      left: { label: '신고한 사업자번호', value: Number(declaredNumber), sourceId: 'declared' },
      right: { label: '서류에서 읽은 번호', value: Number(readNumbers[0]), sourceId: 'business' },
      differenceRate: difference, tolerance: 0,
      status: mismatched.length ? 'failed' : 'passed',
      score: mismatched.length ? 0 : 100, weight: 3,
      detail: mismatched.length
        ? `서류에서 읽은 사업자번호(${mismatched.join(', ')})가 신고값 ${declaredNumber}와 다릅니다.`
        : `${readNumbers.length}개 서류의 사업자번호가 신고값과 같습니다.`,
    })
  }

  // ⑧ 인건비가 매출보다 크면 자료가 모순이다.
  if (sales !== null && payroll !== null && sales > 0) {
    const share = round1(payroll / sales * 100)
    const excess = Math.max(0, round1(share - 100))
    crossChecks.push({
      code: 'payroll-sales', label: '매출 ↔ 인건비',
      left: { label: 'POS 월평균 매출', value: sales, sourceId: 'pos' },
      right: { label: '월 인건비', value: payroll, sourceId: 'staff' },
      differenceRate: excess, tolerance: 5,
      status: statusFor(excess, 5), score: pairScore(excess, 5), weight: 1,
      detail: excess === 0
        ? `인건비가 매출의 ${share}%입니다.`
        : `인건비가 매출의 ${share}%로 계산됩니다. 급여 자료와 매출 자료의 기간이 다를 수 있어요.`,
    })
  }

  // ── 지표별 근거 묶기 ────────────────────────────────────────
  const links: EvidenceLink[] = []
  const uploadedSet = new Set(input.uploadedSources || [])
  const partnerSet = new Set(input.partnerSources || [])

  for (const [metric, meta] of Object.entries(metricMeta)) {
    const value = (metrics as Record<string, unknown>)[metric]
    const known = value !== undefined && value !== null
    const supports: EvidenceSupport[] = []

    // 표에서 계산한 값: 어느 파일 몇 행에서 나왔는지가 그대로 근거다.
    for (const item of input.evidence || []) {
      if (!item.produced.includes(metric)) continue
      supports.push({
        kind: partnerSet.has(item.sourceId) && !uploadedSet.has(item.sourceId) ? 'partner' : 'upload',
        sourceId: item.sourceId,
        sourceLabel: sourceLabels[item.sourceId] || item.sourceId,
        file: item.file, rows: item.rows,
        value: known ? (value as number | string) : null,
        confidence: 1,
        note: `${item.rows.toLocaleString('ko-KR')}행 집계`,
      })
    }
    // 다른 자료로 같은 값을 본 결과.
    supports.push(...(crossSupports[metric] || []))

    if (metric === 'districtSalesGrowth' && isNum(input.publicMetrics?.districtSalesGrowth)) {
      supports.push({
        kind: 'public', sourceId: 'commercial', sourceLabel: sourceLabels.commercial,
        value: input.publicMetrics!.districtSalesGrowth!, confidence: 1, note: '주소로 찾은 공개 상권 자료',
      })
    }
    if (!supports.length) continue
    links.push({ metric, label: meta.label, unit: meta.unit, value: known ? (value as number | string) : null, supports })
  }

  // ── 종합 일치도 ─────────────────────────────────────────────
  const weightSum = crossChecks.reduce((sum, item) => sum + item.weight, 0)
  const score = weightSum
    ? Math.round(crossChecks.reduce((sum, item) => sum + item.score * item.weight, 0) / weightSum)
    : null
  const aiDocuments = documents.filter((item) => item.aiRead)
  const sourceCount = new Set([...uploadedSet, ...partnerSet]).size
  const comparedCodes = new Set(crossChecks.map((item) => item.code))

  const quality: EvidenceQuality = {
    score,
    grade: score === null ? '미산정' : score >= 90 ? '높음' : score >= 75 ? '보통' : '주의',
    comparedPairs: crossChecks.length,
    possiblePairs: PAIR_CODES.length,
    coverage: Math.round(crossChecks.length / PAIR_CODES.length * 100),
    sourceCount,
    documentCount: aiDocuments.length,
    averageDocumentConfidence: aiDocuments.length
      ? Number((aiDocuments.reduce((sum, item) => sum + item.confidence, 0) / aiDocuments.length).toFixed(2))
      : 0,
    mismatches: crossChecks.filter((item) => item.status === 'failed').map((item) => item.detail),
    notCompared: PAIR_CODES.filter((code) => !comparedCodes.has(code)).map((code) => crossCheckTitles[code]),
  }

  return { version: EVIDENCE_LEDGER_VERSION, links, crossChecks, quality }
}

/** 아직 대조하지 못한 쌍을 사장님에게 설명할 때 쓰는 이름. */
const crossCheckTitles: Record<string, string> = {
  'pos-account': '매출 ↔ 계좌 입금',
  'pos-card': '매출 ↔ 카드 승인액',
  'pos-delivery': '매출 ↔ 배달 매출',
  'pos-tax': '매출 ↔ 신고매출',
  'debt-document': '대출잔액 ↔ 부채 증빙',
  'lease-document': '월 임차료 ↔ 계약서',
  'identity-document': '사업자번호 ↔ 서류 판독값',
  'payroll-sales': '매출 ↔ 인건비',
}
