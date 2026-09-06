/**
 * 문서 자동 분류와 문서 원장.
 *
 * 왜 필요한가.
 *   기존 사장님 센터는 카드 11장을 두고 "여기에는 POS 정산 CSV, 여기에는 부가세 신고서"를
 *   정확히 골라 넣게 했다. 세무사에게 받은 파일 이름이 '2026상반기_손익.pdf' 하나뿐인
 *   70대 사장님에게는 이 화면 자체가 벽이다.
 *   그래서 입구를 하나로 열고(아무 파일이나 받는다), 대신 들어온 파일이 무엇인지
 *   서버가 판단한다. 표준화하는 건 입력 양식이 아니라 출력 데이터다.
 *
 * 분류 근거는 강한 것부터 쓴다.
 *   ① 표 머리글(CSV·엑셀 열 이름) — 지표 계산기가 실제로 읽는 열과 같은 신호라 가장 정확하다.
 *   ② AI 판독이 돌려준 문서 종류 — 이미지·PDF 는 여기서 갈린다.
 *   ③ 파일 이름 — 위 둘이 없을 때의 마지막 단서.
 * 셋 다 약하면 'other' 로 두고 사장님에게 직접 고르게 한다. 억지로 배정하지 않는다.
 */

/** 분류 결과가 될 수 있는 출처. uploadOptions 의 id 와 같은 값을 쓴다. */
export const documentKinds = [
  'business', 'license', 'tax', 'debt', 'lease',
  'pos', 'account', 'card', 'delivery', 'customer', 'staff',
] as const
export type DocumentKind = (typeof documentKinds)[number] | 'other'

export type Classification = {
  sourceId: DocumentKind
  /** 0~1. 0.5 미만이면 화면에서 "확인해주세요"로 표시한다. */
  confidence: number
  /** 무엇을 보고 그렇게 판단했는지. 사장님 화면에 그대로 보여준다. */
  basis: 'columns' | 'document-type' | 'filename' | 'unknown'
  reason: string
  /** 다음으로 가능성 있는 후보. 사장님이 바꿀 때 위에 띄운다. */
  alternatives: DocumentKind[]
}

/**
 * 표 머리글 신호.
 * metrics.ts 의 각 핸들러가 실제로 찾는 열 이름과 맞춰 둔다.
 * 한 출처를 확정하려면 must 중 하나 + any 중 하나가 모두 있어야 한다.
 */
const columnSignals: Array<{ sourceId: DocumentKind; must: RegExp; any: RegExp; label: string; priority: number }> = [
  // priority 는 신호의 특이성이다. '주문금액'은 POS 정산표에도 배달 정산표에도 있으므로,
  // 배달·카드처럼 그 자료에서만 나오는 단어를 가진 쪽을 먼저 택한다.
  // (실측: ['주문일','배달플랫폼','주문건수','주문금액'] 표가 POS 로 분류됐다.)
  { sourceId: 'delivery', must: /배달|배민|요기|쿠팡이츠|플랫폼/, any: /주문|금액|건수|재주문|평점/, label: '배달 주문·평점 열', priority: 3 },
  { sourceId: 'card', must: /카드|가맹/, any: /정산|수수료|승인금액|입금액|승인/, label: '카드 승인·정산 열', priority: 3 },
  { sourceId: 'debt', must: /대출|차입|부채|여신/, any: /잔액|상환|금리|이자|원리금|납입/, label: '대출 잔액·상환 열', priority: 3 },
  { sourceId: 'staff', must: /직원|인원|급여|인건/, any: /인원|급여|월|명|지급|인건/, label: '인원·급여 열', priority: 3 },
  { sourceId: 'lease', must: /임대|임차|보증금|월세|월차임/, any: /금액|보증금|월세|임료|차임|기간/, label: '임대차 금액 열', priority: 3 },
  { sourceId: 'customer', must: /고객|회원/, any: /방문|횟수|최초|재방문|가입/, label: '고객 방문 이력 열', priority: 3 },
  // 실제 은행 거래내역 저장 화면(meoktu_ocr_test_documents/variable_vendor_screens)의 열 이름:
  // 거래일자·거래시간·적요·출금(원)·입금(원)·내용·잔액(원)·거래점. 은행마다 이름이 달라
  // '맡기신금액/찾으신금액'을 쓰는 곳도 있어 둘 다 신호로 둔다.
  { sourceId: 'account', must: /입금|출금|맡기신|찾으신/, any: /잔액|금액|적요|잔고|거래점|거래일|내용/, label: '계좌 입출금·잔액 열', priority: 2 },
  { sourceId: 'pos', must: /주문|결제|영수|판매|매출/, any: /금액|승인|합계|가격|총액/, label: 'POS 주문·결제 열', priority: 1 },
]

/** AI 판독이 돌려준 문서 종류 → 출처. 판독 프롬프트의 선택지와 맞춘다. */
const documentTypeSignals: Array<{ sourceId: DocumentKind; pattern: RegExp }> = [
  { sourceId: 'business', pattern: /사업자\s*등록|사업자등록증명|고유번호증/ },
  // 실제 영업신고증에는 '영업의 종류: 식품접객업 · 일반음식점'이 찍혀 나온다.
  { sourceId: 'license', pattern: /영업\s*신고|영업허가|영업신고증|위생|식품접객업|일반음식점|휴게음식점/ },
  { sourceId: 'tax', pattern: /납세|부가\s*가치세|부가세|세금계산서|소득세|과세|국세|지방세|신고서|손익|재무제표|재무상태|결산/ },
  { sourceId: 'debt', pattern: /부채|대출|여신|차입|상환|금융거래확인|채무/ },
  { sourceId: 'lease', pattern: /임대차|전세|월세|계약서|점포계약/ },
  { sourceId: 'card', pattern: /매출\s*전표|카드\s*매출|가맹점\s*정산|승인내역/ },
  { sourceId: 'pos', pattern: /포스|pos|정산표|일일\s*정산|매출\s*집계/i },
  { sourceId: 'account', pattern: /거래내역|통장|입출금|예금/ },
]

/** 파일 이름 신호. 가장 약한 단서라 confidence 를 낮게 준다. */
const filenameSignals: Array<{ sourceId: DocumentKind; pattern: RegExp }> = [
  { sourceId: 'business', pattern: /사업자|등록증|business/i },
  { sourceId: 'license', pattern: /영업|신고증|license|위생/i },
  { sourceId: 'tax', pattern: /부가세|납세|세금|국세|홈택스|hometax|tax|손익|재무|결산|소득/i },
  { sourceId: 'debt', pattern: /대출|부채|상환|여신|loan|debt/i },
  { sourceId: 'lease', pattern: /임대|임차|월세|보증금|계약|lease/i },
  { sourceId: 'pos', pattern: /pos|포스|매출|정산|판매/i },
  { sourceId: 'account', pattern: /통장|계좌|입출금|거래내역|account|bank/i },
  { sourceId: 'card', pattern: /카드|card|가맹/i },
  { sourceId: 'delivery', pattern: /배달|배민|요기|쿠팡|delivery/i },
  { sourceId: 'customer', pattern: /고객|회원|방문|customer/i },
  { sourceId: 'staff', pattern: /직원|급여|인건|인원|payroll|staff/i },
]

const emptyResult = (reason: string): Classification => ({
  sourceId: 'other', confidence: 0, basis: 'unknown', reason, alternatives: [],
})

/**
 * 신청서(빈 서식)를 발급본으로 착각해 올리는 경우.
 *
 * 국가법령정보센터에서 받을 수 있는 '식품 영업 신고서'는 영업신고증을 받기 위해 내는
 * 신청서지 발급본이 아니다(meoktu_ocr_test_documents/official_forms_pdf 참고).
 * 이걸 영업신고증으로 분류해버리면 요건이 충족된 것처럼 보이고, 정작 심사에서는
 * 확인할 값이 하나도 없다. 서식 번호('별지 제37호서식')와 '신고서/신청서' 표기로 먼저 걸러낸다.
 */
const applicationFormPattern = /별지\s*제?\s*\d+\s*호?\s*서식|영업\s*신고서|영업\s*신청서|신고\s*신청서/
const issuedDocumentPattern = /신고증|허가증|등록증|증명원|증명서/
function applicationFormReason(filename: string, documentType: string) {
  const text = `${filename} ${documentType}`
  if (!applicationFormPattern.test(text)) return ''
  if (issuedDocumentPattern.test(text)) return ''
  return '이 파일은 관청에 내는 신고서(신청서) 서식으로 보여요. 심사에는 신청서가 아니라 발급받은 영업신고증(또는 사업자등록증명)이 필요합니다.'
}

/**
 * 파일 하나를 분류한다.
 * headers 가 있으면(표 자료) 그것만으로 거의 확정된다.
 * documentType 은 AI 판독 결과, filename 은 마지막 단서다.
 */
export function classifyDocument(input: {
  filename?: string
  headers?: string[]
  documentType?: string
  /** 표 자료인지. CSV·엑셀이면 true. */
  tabular?: boolean
}): Classification {
  const filename = String(input.filename || '')
  const headerText = (input.headers || []).join(' ')
  const documentType = String(input.documentType || '')

  // 표가 아닌데 신청서 서식이면 여기서 멈춘다. 억지로 배정하면 요건만 채워지고 값은 없다.
  if (!headerText.trim()) {
    const formReason = applicationFormReason(filename, documentType)
    if (formReason) return emptyResult(formReason)
  }

  // ① 표 머리글
  if (headerText.trim()) {
    const matched = columnSignals.filter((signal) => signal.must.test(headerText) && signal.any.test(headerText))
      .sort((a, b) => b.priority - a.priority)
    if (matched.length === 1) {
      return {
        sourceId: matched[0].sourceId, confidence: .95, basis: 'columns',
        reason: `표에서 ${matched[0].label}을 찾았어요.`,
        alternatives: filenameCandidates(filename).filter((item) => item !== matched[0].sourceId).slice(0, 2),
      }
    }
    if (matched.length > 1) {
      // 특이성이 같은 신호가 겹치면 파일 이름으로 가른다. 특이성이 다르면 더 특이한 쪽이 맞다.
      const topPriority = matched[0].priority
      const tied = matched.filter((signal) => signal.priority === topPriority)
      const hint = tied.length > 1
        ? filenameCandidates(filename).find((item) => tied.some((signal) => signal.sourceId === item))
        : undefined
      const picked = hint || matched[0].sourceId
      const decided = tied.length === 1 || Boolean(hint)
      return {
        sourceId: picked, confidence: decided ? .85 : .6, basis: 'columns',
        reason: tied.length === 1
          ? `표에서 ${matched[0].label}을 찾았어요.`
          : `표 열이 ${tied.map((item) => item.label).join(', ')}과 모두 비슷해서 ${hint ? '파일 이름을 함께 봤어요' : '가장 가까운 쪽으로 두었어요'}.`,
        alternatives: matched.map((item) => item.sourceId).filter((item) => item !== picked).slice(0, 3),
      }
    }
  }

  // ② AI 판독이 알려준 문서 종류
  if (documentType.trim()) {
    const matched = documentTypeSignals.find((signal) => signal.pattern.test(documentType))
    if (matched) {
      return {
        sourceId: matched.sourceId, confidence: .85, basis: 'document-type',
        reason: `서류에서 “${documentType.slice(0, 40)}”를 읽었어요.`,
        alternatives: filenameCandidates(filename).filter((item) => item !== matched.sourceId).slice(0, 2),
      }
    }
  }

  // ③ 파일 이름
  const candidates = filenameCandidates(filename)
  if (candidates.length) {
    return {
      sourceId: candidates[0], confidence: candidates.length === 1 ? .6 : .45, basis: 'filename',
      reason: `파일 이름 “${filename.slice(0, 40)}”을 보고 추정했어요. 맞는지 확인해주세요.`,
      alternatives: candidates.slice(1, 3),
    }
  }

  return emptyResult(input.tabular
    ? '표에서 알아볼 수 있는 열 이름을 찾지 못했어요. 어떤 자료인지 골라주세요.'
    : '어떤 서류인지 확실하지 않아요. 직접 골라주세요.')
}

function filenameCandidates(filename: string): DocumentKind[] {
  if (!filename) return []
  return filenameSignals.filter((signal) => signal.pattern.test(filename)).map((signal) => signal.sourceId)
}

/**
 * 문서 원장 한 줄.
 *
 * 원본 파일은 서버에 올리지 않는다(그 약속은 그대로 지킨다).
 * 대신 "무엇이었고, AI가 어떻게 읽었고, 사장님이 그걸 맞다고 했는지 고쳤는지"를 남긴다.
 * 사장님이 값을 고치는 순간이 곧 정답 라벨이고, 이 기록이 쌓여야
 * 다음 라운드에 "지난번 자료 그대로 쓰기"와 판독 정확도 개선이 가능해진다.
 */
export interface OwnerDocument {
  id: string
  userId: string
  filename: string
  /** 브라우저에서 계산한 내용 해시. 같은 파일을 두 번 올리면 갱신만 한다. */
  fileHash: string
  byteSize: number
  mimeType: string
  /** 확정 분류. 사장님이 바꿨다면 바꾼 값. */
  sourceId: string
  classification: Classification & { model: string }
  /** 사장님이 분류를 손으로 바꿨는가. */
  reclassified: boolean
  fields: DocumentField[]
  ocrAnalysisId?: string
  rowCount?: number
  headers?: string[]
  status: 'pending' | 'confirmed'
  createdAt: string
  updatedAt: string
  /** 이 문서가 반영된 심사 신청 id. 재신청 때 어느 자료를 다시 썼는지 추적한다. */
  usedInApplicationIds: string[]
}

export type DocumentField = {
  key: string
  label: string
  /** AI가 읽은 값. */
  aiValue: string | null
  /** 사장님이 확인·수정한 값. */
  confirmedValue: string | null
  state: 'ai' | 'confirmed' | 'corrected'
}

/** 판독 결과에서 사장님에게 확인받을 항목만 뽑는다. */
export function fieldsFromOcr(result: Record<string, unknown>): DocumentField[] {
  const pick: Array<{ key: string; label: string }> = [
    { key: 'merchant', label: '상호' },
    { key: 'businessNumber', label: '사업자등록번호' },
    { key: 'date', label: '문서 기준일' },
    { key: 'periodStart', label: '기간 시작' },
    { key: 'periodEnd', label: '기간 종료' },
    { key: 'total', label: '금액' },
  ]
  return pick.flatMap(({ key, label }) => {
    const raw = result[key]
    if (raw === undefined || raw === null || raw === '') return []
    const value = typeof raw === 'number' ? String(raw) : String(raw).slice(0, 200)
    if (!value.trim()) return []
    return [{ key, label, aiValue: value, confirmedValue: null, state: 'ai' as const }]
  })
}

/** 확정값. 사장님이 고쳤으면 고친 값, 아니면 AI 값. */
export function effectiveValue(field: DocumentField) {
  return field.state === 'ai' ? field.aiValue : field.confirmedValue ?? field.aiValue
}

/**
 * 원장에 쌓인 교정 이력 요약.
 * "AI가 읽은 값 중 몇 %를 사장님이 그대로 확인했는가"가 판독 품질의 실측치다.
 * 이 숫자가 없으면 판독 정확도를 주장할 근거가 없다.
 */
export function correctionStats(documents: OwnerDocument[]) {
  const fields = documents.flatMap((document) => document.fields)
  const reviewed = fields.filter((field) => field.state !== 'ai')
  const corrected = fields.filter((field) => field.state === 'corrected')
  return {
    documentCount: documents.length,
    confirmedDocuments: documents.filter((item) => item.status === 'confirmed').length,
    fieldCount: fields.length,
    reviewedFields: reviewed.length,
    correctedFields: corrected.length,
    reclassifiedDocuments: documents.filter((item) => item.reclassified).length,
    /** 확인한 항목 중 그대로 맞았던 비율(%). 확인한 게 없으면 null. */
    accuracy: reviewed.length ? Math.round((reviewed.length - corrected.length) / reviewed.length * 100) : null,
  }
}
