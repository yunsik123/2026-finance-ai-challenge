/**
 * 사장님 센터 — 펀딩 신청.
 *
 * 이전 화면은 한 페이지에 1~4단계가 세로로 다 펼쳐져 있었고, 자료는 11개 칸에
 * "정확히 이 서류"를 골라 넣어야 했다. 세무사에게 받은 파일 이름이
 * '2026상반기_손익.pdf' 하나뿐인 사장님에게는 그 화면 자체가 벽이다.
 *
 * 그래서 두 가지를 바꿨다.
 *  ① 화면을 네 단계로 쪼개고 한 번에 한 가지만 묻는다(단계 전환).
 *  ② 입구를 하나로 열었다. 사진·PDF·엑셀·CSV 를 그냥 올리면 무엇인지 서버가 판단하고
 *     해당 칸에 스스로 들어간다. 표준화하는 것은 입력 양식이 아니라 출력 데이터다.
 *
 * 3단계에서 "AI가 읽은 값 맞나요?"를 묻는 이유는 두 개다. 사장님이 오독을 잡을 수 있고,
 * 그 확인·수정 결과가 문서함에 정답으로 쌓여 다음 판독을 개선할 재료가 된다.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Banknote, Building2, Check, ChevronRight, Database, Download, Eraser, Eye,
  FileSpreadsheet, FileText, FolderDown, Image as ImageIcon, Landmark, Link2, LockKeyhole, PlugZap, ReceiptText,
  RotateCcw, ShieldCheck, Sparkles, Store, Trash2, TriangleAlert, UploadCloud, UserCheck, Users, type LucideIcon,
} from 'lucide-react'
import { api } from './lib/api.ts'
import { DocumentModal, HighlightedImage, LocalFileViewer, fileSizeLabel, type OcrBox } from './DocumentViewer.tsx'
import VerificationReport from './VerificationReport.tsx'
import CreditGradePanel from './CreditGradePanel.tsx'
import EvidencePanel from './EvidencePanel.tsx'
import { LegalConsentReader, useLegalIndex } from './LegalCenter.tsx'
import { csvShape, hashFile, kindOf, pdfFirstPageToPng, sheetToCsv } from './lib/file-intake.ts'
import {
  ApplicationExtrasSummary, DebtDeclaration, FundUsePlanEditor, IssuanceHelp, OwnershipEditor,
  RequirementBadge, SalesEvidenceStatus, TargetPicker,
} from './ApplicationExtras.tsx'
import type {
  ApplicationResult, DeclaredDebt, DocumentClassification, DocumentField, DocumentGuide, DocumentGuideIndex,
  DocumentStats, FundUseItem, MeState, OcrAnalysis, OwnerDocument, OwnershipRow,
} from './types.ts'
import './evidence.css'

/** AI 판독 이미지 상한(MB). 서버 LIMITS.uploadMb 기본값과 같은 값을 유지한다. */
const UPLOAD_MB = 12

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

type UploadOption = {
  id: string
  icon: LucideIcon
  title: string
  exact: string
  columns: string
  accept: string
  /** 요건(필수·택1·조건부·선택)은 서버의 /api/document-guide 가 정한다. 여기 두면 두 곳이 갈라진다. */
  sampleUrl?: string
  sampleLabel?: string
  /** 같은 문서의 PDF 판. 실제 발급 서류가 대부분 PDF라서 함께 제공한다. */
  samplePdfUrl?: string
  /** 같은 자료의 엑셀 판. 은행·세무 프로그램은 xlsx 로 내려주는 경우가 많다. */
  sampleAltUrl?: string
  sampleAltLabel?: string
}
const uploadOptions: UploadOption[] = [
  { id: 'business', icon: Building2, title: '사업자등록 자료', exact: '사업자등록증명 또는 사업자등록증 사본 1부', columns: '확인 항목: 상호, 대표자, 개업일, 사업장 주소, 업태·종목', accept: '.pdf,.jpg,.jpeg,.png', sampleUrl: '/samples/meoktu-business-sample.png', sampleLabel: 'PNG 샘플', samplePdfUrl: '/samples/meoktu-business-sample.pdf' },
  { id: 'license', icon: BadgeCheck, title: '영업신고 자료', exact: '일반·휴게음식점 영업신고증 사본 1부', columns: '확인 항목: 신고번호, 영업소 명칭·주소, 영업 종류, 대표자', accept: '.pdf,.jpg,.jpeg,.png', sampleUrl: '/samples/meoktu-license-sample.png', sampleLabel: 'PNG 샘플', samplePdfUrl: '/samples/meoktu-license-sample.pdf' },
  { id: 'pos', icon: FileSpreadsheet, title: 'POS 매출 원자료', exact: '최근 12개월 주문 단위 내역 CSV 1개', columns: '필요한 열: 영업일, 주문금액, 결제수단, 취소환불액', accept: '.csv,.xlsx', sampleUrl: '/samples/meoktu-pos-sample.csv', sampleLabel: 'CSV 샘플' },
  { id: 'account', icon: Landmark, title: '사업용 계좌 내역', exact: '최근 12개월 입출금 거래내역 CSV 또는 엑셀 1개', columns: '필요한 열: 거래일시, 입금액, 출금액, 잔액 (은행 화면의 “맡기신금액·찾으신금액·거래후잔액”도 그대로 읽습니다)', accept: '.csv,.xlsx', sampleUrl: '/samples/meoktu-account-sample.csv', sampleLabel: 'CSV 샘플', sampleAltUrl: '/samples/meoktu-account-sample.xlsx', sampleAltLabel: '엑셀 샘플' },
  { id: 'card', icon: ReceiptText, title: '카드 매출·정산', exact: '최근 12개월 카드 승인·정산 내역 CSV 1개', columns: '필요한 열: 승인일, 승인금액, 취소금액, 수수료, 실제입금액', accept: '.csv,.xlsx', sampleUrl: '/samples/meoktu-card-settlement-sample.csv', sampleLabel: 'CSV 샘플' },
  { id: 'delivery', icon: Link2, title: '배달 플랫폼 정산', exact: '최근 12개월 배달앱 정산 내역 CSV 1개', columns: '필요한 열: 주문일, 주문금액, 주문건수, 재주문건수', accept: '.csv,.xlsx', sampleUrl: '/samples/meoktu-delivery-sample.csv', sampleLabel: 'CSV 샘플' },
  { id: 'tax', icon: Database, title: '납세 자료', exact: '최근 2개 과세기간 부가세 신고서 또는 납세증명 1부', columns: '확인 항목: 과세기간, 신고 매출액, 납세 상태', accept: '.pdf,.jpg,.jpeg,.png', sampleUrl: '/samples/meoktu-tax-sample.png', sampleLabel: 'PNG 샘플', samplePdfUrl: '/samples/meoktu-tax-sample.pdf' },
  { id: 'customer', icon: Users, title: '고객 방문 자료', exact: '가명처리된 고객 방문 이력 CSV 1개', columns: '필요한 열: 고객해시, 첫방문일, 방문횟수', accept: '.csv,.xlsx', sampleUrl: '/samples/meoktu-customer-sample.csv', sampleLabel: 'CSV 샘플' },
  { id: 'lease', icon: Building2, title: '임대차 자료', exact: '임대차계약서 사본 1부 또는 월 임차료 내역', columns: '확인 항목: 보증금, 월 임차료, 계약기간, 주소', accept: '.pdf,.jpg,.jpeg,.png,.csv', sampleUrl: '/samples/meoktu-lease-sample.png', sampleLabel: 'PNG 샘플', samplePdfUrl: '/samples/meoktu-lease-sample.pdf' },
  { id: 'debt', icon: Banknote, title: '부채·상환 자료', exact: '금융기관 대출 잔액·상환 내역 CSV 1개', columns: '필요한 열: 기준월, 금융기관, 잔액, 월원리금, 금리', accept: '.csv,.xlsx,.pdf', sampleUrl: '/samples/meoktu-debt-sample.csv', sampleLabel: 'CSV 샘플' },
  { id: 'staff', icon: Users, title: '인력·급여 자료', exact: '최근 12개월 직원수·급여 총액 CSV 1개', columns: '필요한 열: 기준월, 직원수, 급여총액', accept: '.csv,.xlsx', sampleUrl: '/samples/meoktu-staff-sample.csv', sampleLabel: 'CSV 샘플' },
]

const partnerOptions = [
  { id: 'pos', icon: FileSpreadsheet, title: 'POS 매출', provider: 'POS 제휴 중계', scope: '최근 12개월 주문·결제·취소 집계' },
  { id: 'account', icon: Landmark, title: '사업용 계좌', provider: '금융 마이데이터 중계', scope: '최근 12개월 입출금과 잔액' },
  { id: 'card', icon: ReceiptText, title: '카드·VAN 정산', provider: '카드 정산 제휴', scope: '승인·취소·수수료·실입금' },
  { id: 'delivery', icon: Link2, title: '배달 플랫폼', provider: '배달 플랫폼 제휴', scope: '주문·수수료·재주문 집계' },
  { id: 'tax', icon: Database, title: '세무 신고자료', provider: '세무자료 전송 어댑터', scope: '최근 2개 과세기간 신고매출' },
  { id: 'debt', icon: Banknote, title: '대출·상환정보', provider: '금융기관 대출정보 중계', scope: '잔액·금리·만기·월 상환액' },
] as const

type DocumentMetadata = { name: string; size: number; type: string; rowCount: number; headers: string[] }

/**
 * public/samples 의 12개월 가상 원자료와 값이 맞물리는 '샘플식당' 프로필.
 * 한 번에 업로드 버튼이 1·4단계 입력란까지 같은 값으로 채워야
 * 문서 판독값과 신고값이 일치해 교차검증 결과를 그대로 볼 수 있다.
 */
const sampleProfile: Record<string, string> = {
  restaurantName: '샘플식당',
  category: '한식',
  signature: '들기름 고등어 한상',
  avgPrice: '13000',
  ownerName: '김소담',
  businessNumber: '123-45-67891',
  licenseNumber: '제 2022-마포-0451 호',
  address: '서울특별시 마포구 망원동 12-3',
  fundPurpose: '저온 저장고 교체 1,800만원 / 주방 동선 개선 1,200만원',
  businessPlan: '망원동 골목 상권에서 12개월 연속 재방문 고객이 늘고 있습니다. 저장·조리 설비를 바꿔 품절과 대기시간을 줄이고 점심 회전율을 높이려 합니다.',
  expectedEffect: '좌석 24석 → 38석, 점심 회전율 2.1회 → 2.8회, 재료 품절로 인한 판매 손실 월 180만원 감소',
}

/**
 * 샘플 두 갈래.
 *
 * clean 은 서로 완벽하게 맞는 12종이다. 승인까지 그대로 흐른다.
 * rough 는 같은 사업체의 같은 원장이지만 POS 는 8개월치만, 계좌에는 대출 입금이 섞이고,
 * 카드는 12개월 전체다. 실제로 사장님이 주는 자료가 이렇게 어긋나 있다.
 * 이 세트를 넣으면 매출↔계좌·매출↔카드 대조에서 불일치가 잡히고 수동 심사로 넘어간다.
 * 데모에서 보여줘야 할 장면은 완벽한 통과가 아니라 이쪽이다.
 */
type SampleSet = { id: 'clean' | 'rough'; label: string; description: string; overrides?: Record<string, string> }
const sampleSets: SampleSet[] = [
  { id: 'clean', label: '정리된 자료로 보기', description: '12개월치가 서로 딱 맞는 자료 11종입니다. 교차검증이 모두 통과하는 흐름을 봅니다.' },
  {
    id: 'rough', label: '실제 사장님 자료처럼 보기', description: 'POS는 8개월치만, 계좌에는 대출 입금이 섞이고, 카드는 12개월 전체인 자료입니다. 열 이름도 제각각이라 불일치가 잡힙니다.',
    overrides: {
      pos: '/samples/meoktu-rough-pos-sample.csv',
      account: '/samples/meoktu-rough-account-sample.csv',
      card: '/samples/meoktu-rough-card-sample.csv',
    },
  },
]

const sampleMimeTypes: Record<string, string> = { csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', pdf: 'application/pdf' }

/** CSV는 열·행 수까지 세어 업로드 카드와 심사 원장에 남긴다. */
async function readDocumentMetadata(file: File): Promise<DocumentMetadata> {
  let rowCount = 0
  let headers: string[] = []
  if (/\.csv$/i.test(file.name)) {
    const shape = csvShape(await file.text())
    headers = shape.headers.slice(0, 40)
    rowCount = shape.rowCount
  }
  return { name: file.name, size: file.size, type: file.type || 'application/octet-stream', rowCount, headers }
}

/** public/samples 의 정적 파일을 실제 선택한 것과 같은 File 객체로 바꾼다. */
async function fetchSampleFile(url: string, title: string): Promise<File> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${title} 샘플 파일을 불러오지 못했어요.`)
  const blob = await response.blob()
  const name = url.split('/').pop() || 'sample'
  const extension = (name.split('.').pop() || '').toLowerCase()
  return new File([blob], name, { type: sampleMimeTypes[extension] || blob.type || 'application/octet-stream' })
}

const metricLabels: Record<string, string> = {
  recent12MonthAverageSales: '최근 12개월 평균매출', recent12MonthSalesGrowth: '최근 12개월 성장률', estimatedMonthlyOperatingCashflow: '추정 월 영업현금흐름', salesVolatility: '매출 변동성', repeatRate: '재방문율', averageTicket: '객단가', deliverySalesShare: '배달매출 비중', rentToSalesRatio: '임차료/매출', debtServiceToCashflowRatio: '원리금상환/현금흐름', operatingYears: '검증 업력', staffTrend: '직원 추이', districtSalesGrowth: '상권 매출 성장률', relativeSalesGrowth: '상권 대비 초과성장', salesReconciliationRate: '매출 교차검증 일치도',
}
const moneyMetrics = new Set(['recent12MonthAverageSales', 'estimatedMonthlyOperatingCashflow', 'averageTicket'])
const percentMetrics = new Set(['recent12MonthSalesGrowth', 'salesVolatility', 'repeatRate', 'deliverySalesShare', 'rentToSalesRatio', 'debtServiceToCashflowRatio', 'districtSalesGrowth', 'relativeSalesGrowth', 'salesReconciliationRate'])

/** 만능 업로드함이 처리 중인 파일 한 줄. */
type IntakeRow = {
  key: string
  filename: string
  state: 'working' | 'done' | 'failed'
  message: string
  sourceId?: string
  confidence?: number
  alternatives?: string[]
}

/**
 * 단계마다 주소가 하나씩 있다.
 *
 * 한 화면에서 보였다/숨겼다 하는 방식이 아니라 실제로 페이지가 넘어간다. 그래서
 * 브라우저 뒤로·앞으로 버튼이 그대로 동작하고, 지금 어느 단계인지 주소만 봐도 알 수 있고,
 * "2단계 주소"를 그대로 공유·북마크할 수 있다.
 *
 * 대신 단계가 바뀌면 그 단계의 입력칸은 화면에서 사라진다. 그래서 입력값을 DOM 이 아니라
 * fields 상태에 들고 있어야 한다(아래 emptyFields). 고른 파일도 마찬가지로 상위 상태에 남는다.
 */
const stepDefinitions = [
  { id: 'store', slug: 'store', title: '가게 정보', hint: '사업자등록증에 적힌 대로 넣어주세요.' },
  { id: 'upload', slug: 'upload', title: '자료 올리기', hint: '가지고 계신 파일을 그냥 올려주세요. 무엇인지는 먹투가 알아봅니다.' },
  { id: 'reading', slug: 'reading', title: '읽은 값 확인', hint: 'AI가 읽은 값이 맞는지만 봐주세요.' },
  { id: 'plan', slug: 'plan', title: '동의와 계획', hint: '꼭 필요한 동의와 자금 계획만 받습니다.' },
] as const

/** 결과 화면도 자기 주소를 갖는다. 새로고침해도 결과가 남아 있어야 하기 때문이다. */
const RESULT_SLUG = 'result'

/** 신청서에 사장님이 직접 적는 값. 단계를 넘나들어도 살아 있어야 해서 상태로 들고 있는다. */
type ApplicationFields = Record<string, string>
const emptyFields = (): ApplicationFields => ({
  restaurantName: '', ownerName: '', category: '한식', signature: '', avgPrice: '12000',
  businessNumber: '', licenseNumber: '', address: '',
  requestedLimit: '30000000', fundingPeriodMonths: '18', ownCapital: '10000000', maxDiscount: '40',
  fundPurpose: '', businessPlan: '', expectedEffect: '',
})
/** 1단계에서 반드시 채워야 하는 칸. */
const storeFieldRules: Array<[string, string]> = [
  ['restaurantName', '상호명을 입력해주세요.'],
  ['ownerName', '대표자명을 입력해주세요.'],
  ['signature', '대표 메뉴를 입력해주세요.'],
  ['businessNumber', '사업자등록번호를 입력해주세요.'],
  ['licenseNumber', '영업신고번호를 입력해주세요.'],
  ['address', '사업장 주소를 입력해주세요. 상권 분석에 사용됩니다.'],
]
/** 4단계에서 반드시 채워야 하는 칸. */
const planFieldRules: Array<[string, string]> = [
  ['fundPurpose', '자금 사용계획을 적어주세요.'],
  ['businessPlan', '사업계획과 차별성을 적어주세요.'],
  ['expectedEffect', '예상 효과를 적어주세요.'],
]

export default function OwnerCenter({ me, onLogin, refresh, notify }: { me: MeState | null; onLogin: () => void; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const owner = me?.user.role === 'owner'
  const demoMode = me?.user.sessionMode === 'demo'
  const [ownerData, setOwnerData] = useState<any>(null)
  const [uploadedFiles, setUploadedFiles] = useState<Record<string, string>>({})
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({})
  const filesRef = useRef<Record<string, File>>({})
  const [documentMetadata, setDocumentMetadata] = useState<Record<string, DocumentMetadata>>({})
  const [ocrResults, setOcrResults] = useState<Record<string, OcrAnalysis>>({})
  /** 판독에 쓴 그림. PDF 는 첫 페이지를 PNG 로 바꾼 결과라 원본 파일로는 다시 그릴 수 없다. */
  const [ocrImages, setOcrImages] = useState<Record<string, string>>({})
  const [classifications, setClassifications] = useState<Record<string, DocumentClassification>>({})
  const [documentRecords, setDocumentRecords] = useState<Record<string, OwnerDocument>>({})
  const [analyzingSource, setAnalyzingSource] = useState('')
  const [identityVerified, setIdentityVerified] = useState(false)
  const [result, setResult] = useState<ApplicationResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fillingSample, setFillingSample] = useState('')
  const [intakeRows, setIntakeRows] = useState<IntakeRow[]>([])
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** 지금 열어 본 업로드 자료의 출처 id. 파일은 브라우저 안에만 있고 서버로 보내지 않는다. */
  const [openedDocument, setOpenedDocument] = useState('')
  const [fields, setFields] = useState<ApplicationFields>(emptyFields)
  /** 제출 자료 요건·발급 안내. 서버에서 내려받아 화면과 AI 상담이 같은 값을 쓴다. */
  const [guide, setGuide] = useState<DocumentGuideIndex | null>(null)
  const [targetRestaurantId, setTargetRestaurantId] = useState('')
  const [fundUsePlan, setFundUsePlan] = useState<FundUseItem[]>([{ category: '주방설비', amount: 0, note: '' }])
  const [declaredDebt, setDeclaredDebt] = useState<DeclaredDebt>({ hasDebt: false, loans: [], answered: false })
  const [ownership, setOwnership] = useState<OwnershipRow[]>([])
  const legal = useLegalIndex()
  const [agreedDocuments, setAgreedDocuments] = useState<string[]>([])

  // 단계는 주소에서 읽는다. 상태로 들고 있으면 뒤로 가기가 동작하지 않는다.
  const location = useLocation()
  const navigate = useNavigate()
  const slug = location.pathname.replace(/^\/owner\/?/, '').split('/')[0]
  const showingResult = slug === RESULT_SLUG
  const routeStep = stepDefinitions.findIndex((definition) => definition.slug === slug)
  const step = routeStep < 0 ? 0 : routeStep
  /** 어느 방향으로 넘어왔는지. 전환 애니메이션 방향에만 쓴다. */
  const previousStep = useRef(step)
  const direction: 'next' | 'back' = step >= previousStep.current ? 'next' : 'back'
  useEffect(() => { previousStep.current = step }, [step])
  useEffect(() => { setAgreedDocuments([]) }, [legal?.version])

  const consentDocuments = (legal?.documents || []).filter((document) => legal?.required.owner_application.includes(document.id))
  const allConsentsAgreed = consentDocuments.length > 0 && consentDocuments.every((document) => agreedDocuments.includes(document.id))
  const toggleConsent = (documentId: string) => setAgreedDocuments((current) => current.includes(documentId)
    ? current.filter((item) => item !== documentId) : [...current, documentId])

  useEffect(() => {
    let live = true
    api<DocumentGuideIndex>('/api/document-guide').then((result) => { if (live) setGuide(result) }).catch(() => undefined)
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!owner) { setOwnerData(null); return }
    let live = true
    api<any>('/api/owner').then((result) => { if (live) setOwnerData(result) }).catch(() => undefined)
    return () => { live = false }
  }, [owner, me])
  const setField = (name: string) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setFields((current) => ({ ...current, [name]: event.target.value }))

  const restaurant = ownerData?.restaurants?.[0]
  // 이미 등록된 가게가 있으면 비어 있는 칸만 채워준다. 사장님이 고쳐 쓴 값은 덮지 않는다.
  useEffect(() => {
    if (!restaurant) return
    setFields((current) => ({
      ...current,
      restaurantName: current.restaurantName || restaurant.name || '',
      category: current.category === '한식' && restaurant.category ? restaurant.category : current.category,
      signature: current.signature || restaurant.signature || '',
      avgPrice: current.avgPrice === '12000' && restaurant.avgPrice ? String(restaurant.avgPrice) : current.avgPrice,
    }))
  }, [restaurant?.id])
  const metrics = result?.data?.derivedMetrics || {}
  const confidence = result?.data?.dataConfidence || 0
  const uploadedCount = useMemo(() => Object.keys(uploadedFiles).length, [uploadedFiles])
  const activeConnections = ownerData?.dataConnections || me?.dataConnections || []
  const connectedIds = useMemo(() => new Set<string>(activeConnections.map((item: any) => item.sourceId)), [activeConnections])
  const evidenceCount = new Set([...Object.keys(uploadedFiles), ...connectedIds]).size
  const openedFile = openedDocument ? selectedFiles[openedDocument] : undefined
  const lockerDocuments: OwnerDocument[] = ownerData?.documents || []
  const documentStats: DocumentStats | undefined = ownerData?.documentStats

  /** 필수 자료가 업로드 또는 기관연결로 채워졌는지. */
  /*
   * 필수 자료는 세 갈래다.
   *   · 무조건 필수 — 사업자등록·영업신고·사업용 계좌
   *   · 매출 확인 택1 — POS·카드·납세·배달 중 하나 이상
   *   · 대출 있으면 필수 — 부채현황(화면에서 직접 신고)
   * 요건 목록은 서버(/api/document-guide)에서 받고, 못 받았을 때만 같은 값을 기본으로 쓴다.
   */
  const requiredSources = guide?.requiredSources ?? ['business', 'license', 'account']
  const salesEvidenceSources = guide?.salesEvidenceSources ?? ['pos', 'card', 'tax', 'delivery']
  const hasSource = (source: string) => Boolean(uploadedFiles[source]) || connectedIds.has(source)
  const missingRequired = requiredSources.filter((source) => !hasSource(source))
  const satisfiedSalesEvidence = salesEvidenceSources.filter(hasSource)
  /** 매출 자료가 하나도 없으면 접수되지 않는다. */
  const salesEvidenceMissing = satisfiedSalesEvidence.length === 0
  const guideFor = (sourceId: string): DocumentGuide | undefined => guide?.guides.find((item) => item.sourceId === sourceId)
  /** 자료를 요건 묶음으로 나눈다. 화면도 이 순서로 보여준다. */
  const groupOrder = ['사업체 확인', '매출 확인', '현금흐름 확인', '추가 자료']
  const groupedOptions = groupOrder.map((group) => ({
    group,
    options: uploadOptions.filter((option) => (guideFor(option.id)?.group ?? '추가 자료') === group),
  })).filter((entry) => entry.options.length > 0)
  /** 부채 묶음의 업로드 칸. 부채는 답(신고) 아래에 증빙 칸을 붙여 보여준다. */
  const debtOptions = uploadOptions.filter((option) => guideFor(option.id)?.group === '부채 확인')
  /** groupOrder·부채 묶음 어디에도 안 들어간 칸이 있으면 화면에서 사라진다. 남은 것은 추가 자료로 보낸다. */
  const placedIds = new Set([...groupedOptions.flatMap((entry) => entry.options.map((option) => option.id)), ...debtOptions.map((option) => option.id)])
  const unplacedOptions = uploadOptions.filter((option) => !placedIds.has(option.id))
  const fundUseTotal = fundUsePlan.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  /** 판독 결과가 있는 자료. 3단계에서 확인받을 대상이다. */
  const readingSources = useMemo(() => Object.keys(ocrResults), [ocrResults])
  const unreviewedReadings = readingSources.filter((source) => {
    const record = documentRecords[source]
    if (!record) return true
    return record.fields.some((field) => field.state === 'ai')
  })

  const resetApplication = () => {
    setOpenedDocument('')
    setUploadedFiles({})
    filesRef.current = {}
    setSelectedFiles({})
    setDocumentMetadata({})
    setOcrResults({})
    setOcrImages({})
    setClassifications({})
    setDocumentRecords({})
    setIntakeRows([])
    setIdentityVerified(false)
    setAgreedDocuments([])
    setFields(emptyFields())
    setTargetRestaurantId('')
    setFundUsePlan([{ category: '주방설비', amount: 0, note: '' }])
    setDeclaredDebt({ hasDebt: false, loans: [], answered: false })
    setOwnership([])
    setResult(null)
    navigate('/owner/store')
  }
  /** 결과 화면에서 다시 신청 화면으로 돌아온다. 사장님 센터의 기본 화면은 항상 펀딩 신청이다. */
  const goBack = () => resetApplication()

  /** 단계 이동 = 주소 이동. 뒤로 가기가 그대로 동작해야 하므로 상태로 넘기지 않는다. */
  const goToStep = (next: number, replace = false) => {
    const target = stepDefinitions[Math.max(0, Math.min(stepDefinitions.length - 1, next))]
    navigate(`/owner/${target.slug}`, { replace })
    // 새 단계는 화면 위쪽부터 읽어야 한다.
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  /**
   * 그 단계를 끝냈는지 조용히 판정한다.
   * 안내 문구를 띄우지 않는 판정이 따로 필요하다. 주소로 바로 들어온 사람을
   * 앞 단계로 되돌릴 때 경고를 쏟아붓지 않아야 하고, 단계 표시줄의 활성 여부도 이 값으로 정한다.
   */
  const stepComplete = (index: number) => {
    if (index === 0) return storeFieldRules.every(([name]) => fields[name]?.trim()) && identityVerified
    if (index === 1) {
      return missingRequired.length === 0 && !salesEvidenceMissing && declaredDebt.answered
        && (!declaredDebt.hasDebt || declaredDebt.loans.some((loan) => loan.lender.trim() || loan.balance > 0))
    }
    if (index === 2) return unreviewedReadings.length === 0
    if (index === 3) {
      return planFieldRules.every(([name]) => fields[name]?.trim())
        && Number(fields.requestedLimit) >= 5000000
        && fundUseTotal === Number(fields.requestedLimit)
        && fundUsePlan.some((item) => item.amount > 0)
        && allConsentsAgreed
    }
    return true
  }

  /** 아직 못 끝낸 첫 단계. 여기까지만 주소로 열 수 있다. */
  const firstIncompleteStep = () => {
    for (let index = 0; index < stepDefinitions.length; index += 1) if (!stepComplete(index)) return index
    return stepDefinitions.length - 1
  }

  /** 지금 단계를 떠나도 되는지. 못 넘어가면 이유를 알려주고 그 칸으로 커서를 옮긴다. */
  const focusField = (name: string) => {
    const element = document.querySelector<HTMLElement>(`[name="${name}"]`)
    element?.focus()
  }
  const validateStep = (index: number) => {
    if (index === 0) {
      for (const [name, message] of storeFieldRules) {
        if (!fields[name]?.trim()) { notify(message); focusField(name); return false }
      }
      if (!identityVerified) { notify('대표자 본인인증을 먼저 완료해주세요.'); return false }
      return true
    }
    if (index === 1) {
      if (missingRequired.length) {
        const labels = missingRequired.map((source) => uploadOptions.find((option) => option.id === source)?.title || source)
        notify(`${labels.join(', ')}이(가) 아직 없어요. 필수 자료라서 올리거나 기관 연결로 채워주세요.`)
        return false
      }
      if (salesEvidenceMissing) {
        notify('매출을 확인할 수 있는 자료가 하나는 필요해요. POS·카드 매출·납세 자료·배달 정산 중 편한 것 하나만 올려주세요.')
        return false
      }
      if (!declaredDebt.answered) {
        notify('대출이 있는지 없는지 선택해주세요. 상환 부담을 함께 봐야 투자자에게 설명할 수 있어요.')
        return false
      }
      if (declaredDebt.hasDebt && !declaredDebt.loans.some((loan) => loan.lender.trim() || loan.balance > 0)) {
        notify('대출이 있다고 하셨어요. 금융기관과 잔액을 한 건 이상 적어주세요.')
        return false
      }
      return true
    }
    if (index === 2) {
      if (unreviewedReadings.length) {
        notify(`AI가 읽은 값 중 아직 확인하지 않은 서류가 ${unreviewedReadings.length}건 있어요. 맞는지 확인해주세요.`)
        return false
      }
      return true
    }
    if (index === 3) {
      for (const [name, message] of planFieldRules) {
        if (!fields[name]?.trim()) { notify(message); focusField(name); return false }
      }
      if (!(Number(fields.requestedLimit) >= 5000000)) {
        notify('희망 펀딩액은 500만원 이상으로 입력해주세요.')
        focusField('requestedLimit')
        return false
      }
      if (!fundUsePlan.some((item) => item.amount > 0)) {
        notify('투자금을 어디에 쓸지 항목별로 한 줄 이상 적어주세요.')
        return false
      }
      if (fundUseTotal !== Number(fields.requestedLimit)) {
        notify(`자금 사용계획 합계(${fundUseTotal.toLocaleString('ko-KR')}원)를 희망 펀딩액(${Number(fields.requestedLimit).toLocaleString('ko-KR')}원)과 맞춰주세요.`)
        return false
      }
      if (!allConsentsAgreed) { notify('필수 고지사항을 모두 확인하고 동의해주세요.'); return false }
      return true
    }
    return true
  }

  const nextStep = () => {
    if (!validateStep(step)) return
    goToStep(step + 1)
  }

  /**
   * 주소를 정리한다.
   *
   * /owner 로 들어오면 첫 단계로 보내고, 없는 주소도 첫 단계로 돌린다.
   * 앞 단계를 끝내지 않은 채 뒤 단계 주소를 직접 열었으면(새로고침·북마크·직접 입력)
   * 못 끝낸 첫 단계로 조용히 되돌린다. 그 단계의 입력값은 화면에 없으므로 그냥 두면
   * 빈 신청서가 제출되기 때문이다.
   */
  useEffect(() => {
    if (!owner) return
    if (showingResult) {
      // 결과 없이 결과 주소를 열었으면 신청서로 돌려보낸다(새로고침 후가 대표적이다).
      if (!result) goToStep(firstIncompleteStep(), true)
      return
    }
    if (routeStep < 0) { goToStep(result ? 0 : firstIncompleteStep(), true); return }
    const allowed = firstIncompleteStep()
    if (step > allowed) goToStep(allowed, true)
  }, [owner, slug, showingResult, Boolean(result), step, routeStep,
    fields.restaurantName, fields.ownerName, fields.signature, fields.businessNumber, fields.licenseNumber, fields.address,
    fields.fundPurpose, fields.businessPlan, fields.expectedEffect, fields.requestedLimit,
    identityVerified, missingRequired.length, salesEvidenceMissing, declaredDebt.answered, declaredDebt.hasDebt,
    fundUseTotal, unreviewedReadings.length, allConsentsAgreed])

  /* ── 파일 받기 ───────────────────────────────────────────── */

  /** 파일 하나를 어느 칸에 넣는다. 표는 CSV 로 바꿔 넣어 서버 집계 경로를 그대로 태운다. */
  const placeFile = async (sourceId: string, file: File) => {
    filesRef.current = { ...filesRef.current, [sourceId]: file }
    setSelectedFiles((current) => ({ ...current, [sourceId]: file }))
    setUploadedFiles((current) => ({ ...current, [sourceId]: file.name }))
    const metadata = await readDocumentMetadata(file)
    if (filesRef.current[sourceId] !== file) return metadata
    setDocumentMetadata((current) => ({ ...current, [sourceId]: metadata }))
    return metadata
  }

  /** 문서함에 한 줄 남긴다. 원본 파일은 보내지 않고 해시·분류·판독항목만 보낸다. */
  const registerDocument = async (input: {
    file: File
    sourceId: string
    documentType?: string
    metadata: DocumentMetadata
    ocrAnalysisId?: string
    fields?: DocumentField[]
  }) => {
    try {
      const fileHash = await hashFile(input.file)
      const response = await api<{ document: OwnerDocument }>('/api/owner/documents', {
        method: 'POST',
        body: JSON.stringify({
          filename: input.file.name, fileHash, byteSize: input.file.size,
          mimeType: input.file.type || 'application/octet-stream',
          sourceId: input.sourceId, documentType: input.documentType,
          headers: input.metadata.headers, rowCount: input.metadata.rowCount,
          ocrAnalysisId: input.ocrAnalysisId, fields: input.fields || [],
        }),
      })
      setDocumentRecords((current) => ({ ...current, [input.sourceId]: response.document }))
      return response.document
    } catch {
      // 문서함 기록이 실패해도 심사 자체는 진행할 수 있어야 한다.
      return undefined
    }
  }

  /**
   * 만능 업로드함. 무엇인지 묻지 않고 받는다.
   *
   * 표(CSV·엑셀)는 열 이름으로 분류하고, 사진·PDF 는 판독 결과의 문서 종류로 분류한다.
   * 열 이름 신호가 판독보다 정확하기 때문에 표는 AI를 부르지 않는다(비용·시간 절약).
   */
  const intakeFiles = async (files: File[]) => {
    if (!owner) { onLogin(); return }
    if (intakeBusy) return
    setIntakeBusy(true)
    const accepted = files.slice(0, 12)
    for (const original of accepted) {
      const key = `${original.name}-${original.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const pending: IntakeRow = { key, filename: original.name, state: 'working', message: '살펴보는 중이에요...' }
      setIntakeRows((current) => [pending, ...current].slice(0, 20))
      const update = (patch: Partial<IntakeRow>) => setIntakeRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
      try {
        if (original.size > 20 * 1024 * 1024) throw new Error('20MB 이하 파일만 올릴 수 있어요.')
        const kind = kindOf(original)
        if (kind === 'unknown') throw new Error('사진·PDF·엑셀·CSV 파일만 읽을 수 있어요.')

        let working = original
        if (kind === 'sheet') {
          update({ message: '엑셀을 표로 바꾸는 중이에요...' })
          const { csv } = await sheetToCsv(original)
          if (!csv.trim()) throw new Error('엑셀에서 읽을 내용을 찾지 못했어요.')
          working = new File([csv], `${original.name.replace(/\.(xlsx|xlsm)$/i, '')}.csv`, { type: 'text/csv' })
        }

        if (kind === 'csv' || kind === 'sheet') {
          const shape = csvShape(await working.text())
          update({ message: `열 ${shape.headers.length}개를 보고 무엇인지 확인하는 중이에요...` })
          const { classification } = await api<{ classification: DocumentClassification }>('/api/documents/classify', {
            method: 'POST',
            body: JSON.stringify({ filename: working.name, headers: shape.headers, tabular: true }),
          })
          if (classification.sourceId === 'other') {
            update({ state: 'done', message: classification.reason, sourceId: 'other', confidence: 0, alternatives: uploadOptions.map((option) => option.id) })
            continue
          }
          const metadata = await placeFile(classification.sourceId, working)
          setClassifications((current) => ({ ...current, [classification.sourceId]: classification }))
          void registerDocument({ file: working, sourceId: classification.sourceId, metadata })
          update({
            state: 'done', sourceId: classification.sourceId, confidence: classification.confidence,
            alternatives: classification.alternatives,
            message: `${labelOf(classification.sourceId)}로 넣었어요 · ${shape.headers.length}열 ${shape.rowCount.toLocaleString('ko-KR')}행 · ${classification.reason}`,
          })
          continue
        }

        // 사진과 PDF 는 판독을 거쳐야 무엇인지 알 수 있다.
        update({ message: kind === 'pdf' ? 'PDF 첫 장을 그림으로 바꾸는 중이에요...' : '사진을 읽는 중이에요...' })
        const dataUrl = kind === 'pdf' ? (await pdfFirstPageToPng(original)).dataUrl : await readAsDataUrl(original)
        const estimatedMb = (dataUrl.length * .75) / 1024 / 1024
        if (estimatedMb > UPLOAD_MB) throw new Error(`판독할 그림이 ${UPLOAD_MB}MB를 넘어요. 더 작은 파일로 올려주세요.`)
        update({ message: 'AI가 서류를 읽는 중이에요...' })
        const response = await api<{ analysis: OcrAnalysis; classification: DocumentClassification; fields: DocumentField[] }>('/api/ai/ocr', {
          method: 'POST',
          body: JSON.stringify({ image: dataUrl, filename: original.name, sourceId: 'auto', plan: '펀딩 신청 원천자료 사전검증' }),
        })
        const resolved = response.analysis.sourceId && response.analysis.sourceId !== 'other'
          ? response.analysis.sourceId : response.classification.sourceId
        if (!resolved || resolved === 'other') {
          update({ state: 'done', message: response.classification.reason, sourceId: 'other', confidence: 0, alternatives: uploadOptions.map((option) => option.id) })
          continue
        }
        const metadata = await placeFile(resolved, original)
        setOcrResults((current) => ({ ...current, [resolved]: response.analysis }))
        setOcrImages((current) => ({ ...current, [resolved]: dataUrl }))
        setClassifications((current) => ({ ...current, [resolved]: response.classification }))
        void registerDocument({
          file: original, sourceId: resolved, metadata,
          documentType: String((response.analysis.result as Record<string, unknown>)?.documentType || ''),
          ocrAnalysisId: response.analysis.id, fields: response.fields,
        })
        update({
          state: 'done', sourceId: resolved, confidence: response.classification.confidence,
          alternatives: response.classification.alternatives,
          message: `${labelOf(resolved)}로 넣었어요 · ${response.classification.reason}`,
        })
      } catch (error) {
        update({ state: 'failed', message: (error as Error).message })
      }
    }
    setIntakeBusy(false)
    await refresh().catch(() => undefined)
    api<any>('/api/owner').then((data) => setOwnerData(data)).catch(() => undefined)
  }

  /** 자동 분류가 틀렸을 때 사장님이 직접 고친다. 이 교정도 문서함에 남는다. */
  const reassign = async (row: IntakeRow, sourceId: string) => {
    const file = row.sourceId && row.sourceId !== 'other' ? selectedFiles[row.sourceId] : undefined
    if (!file) { notify('이 파일을 다시 올려주세요. 원본이 화면에 남아 있지 않아요.'); return }
    if (row.sourceId && row.sourceId !== sourceId) clearSlot(row.sourceId)
    const metadata = await placeFile(sourceId, file)
    setIntakeRows((current) => current.map((item) => (item.key === row.key
      ? { ...item, sourceId, message: `${labelOf(sourceId)}로 바꿨어요. 사장님이 직접 고른 분류예요.`, confidence: 1 } : item)))
    const analysis = row.sourceId ? ocrResults[row.sourceId] : undefined
    if (analysis && row.sourceId) {
      setOcrResults((current) => {
        const next = { ...current }
        delete next[row.sourceId!]
        next[sourceId] = analysis
        return next
      })
      setOcrImages((current) => {
        const next = { ...current }
        const image = next[row.sourceId!]
        delete next[row.sourceId!]
        if (image) next[sourceId] = image
        return next
      })
    }
    void registerDocument({ file, sourceId, metadata, ocrAnalysisId: analysis?.id, fields: documentRecords[row.sourceId || '']?.fields })
    notify(`${labelOf(sourceId)}로 바꿨어요.`)
  }

  const clearSlot = (sourceId: string) => {
    filesRef.current = { ...filesRef.current }
    delete filesRef.current[sourceId]
    setSelectedFiles((current) => { const next = { ...current }; delete next[sourceId]; return next })
    setUploadedFiles((current) => { const next = { ...current }; delete next[sourceId]; return next })
    setDocumentMetadata((current) => { const next = { ...current }; delete next[sourceId]; return next })
    setOcrResults((current) => { const next = { ...current }; delete next[sourceId]; return next })
    setOcrImages((current) => { const next = { ...current }; delete next[sourceId]; return next })
  }

  const selectFile = async (sourceId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.size > 20 * 1024 * 1024) {
      event.target.value = ''
      notify('업로드 파일은 20MB 이하여야 해요.')
      return
    }
    if (!file) { clearSlot(sourceId); return }
    // 엑셀은 표로 바꿔 넣는다. 그러지 않으면 서버가 열을 읽지 못한다.
    let working = file
    if (kindOf(file) === 'sheet') {
      try {
        const { csv } = await sheetToCsv(file)
        working = new File([csv], `${file.name.replace(/\.(xlsx|xlsm)$/i, '')}.csv`, { type: 'text/csv' })
      } catch (error) { notify((error as Error).message); return }
    }
    setOcrResults((current) => { const next = { ...current }; delete next[sourceId]; return next })
    setOcrImages((current) => { const next = { ...current }; delete next[sourceId]; return next })
    try {
      const metadata = await placeFile(sourceId, working)
      if (filesRef.current[sourceId] !== working) return
      notify(metadata.rowCount
        ? `${working.name}: ${metadata.headers.length}개 열·${metadata.rowCount.toLocaleString('ko-KR')}개 행을 확인했어요.`
        : `${working.name} 파일 형식과 크기를 확인했어요.`)
      void registerDocument({ file: working, sourceId, metadata })
    } catch (error) { if (filesRef.current[sourceId] === working) notify((error as Error).message) }
  }

  /**
   * 샘플 자료 한 번에 올리기. 세트를 골라 채운다.
   * 3단계 필수 동의는 사장님이 직접 확인해야 하므로 자동으로 체크하지 않는다.
   */
  const fillWithSamples = async (set: SampleSet) => {
    if (!owner) return
    const options = uploadOptions.filter((option) => option.sampleUrl)
    setFillingSample(set.id)
    try {
      const urls = options.map((option) => set.overrides?.[option.id] || (option.sampleUrl as string))
      const files = await Promise.all(urls.map((url, index) => fetchSampleFile(url, options[index].title)))
      const metadataList = await Promise.all(files.map(readDocumentMetadata))
      const names: Record<string, string> = {}
      const picked: Record<string, File> = {}
      const metadata: Record<string, DocumentMetadata> = {}
      options.forEach((option, index) => {
        names[option.id] = files[index].name
        picked[option.id] = files[index]
        metadata[option.id] = metadataList[index]
      })
      setUploadedFiles(names)
      filesRef.current = picked
      setSelectedFiles(picked)
      setDocumentMetadata(metadata)
      setOcrResults({})
      setOcrImages({})
      setIntakeRows(options.map((option, index) => ({
        key: `sample-${set.id}-${option.id}`,
        filename: files[index].name,
        state: 'done' as const,
        sourceId: option.id,
        confidence: 1,
        message: `${set.id === 'rough' && set.overrides?.[option.id] ? '어긋난 샘플' : '샘플'} 자료를 ${option.title} 칸에 넣었어요.`,
      })))
      setFields((current) => ({ ...current, ...sampleProfile }))
      setIdentityVerified(true)
      // 샘플은 새로 추가된 항목까지 채운다. 안 채우면 샘플로 끝까지 가볼 수 없다.
      setFundUsePlan([
        { category: '주방설비', amount: 18000000, note: '저온 저장고 1대 교체' },
        { category: '인테리어', amount: 12000000, note: '주방 동선 개선 공사' },
      ])
      setDeclaredDebt({
        hasDebt: true, answered: true,
        loans: [{ lender: '○○은행', balance: 40000000, rate: 5.4, monthlyPayment: 900000, maturity: '2028-06' }],
      })
      setOwnership([{ name: '김소담', share: 100, role: '대표자' }])
      const rows = metadataList.reduce((sum, item) => sum + item.rowCount, 0)
      goToStep(1)
      notify(set.id === 'rough'
        ? `어긋난 샘플 ${files.length}종을 올렸어요. 표 자료 ${rows.toLocaleString('ko-KR')}행을 확인했습니다. 자동분석을 돌리면 매출↔계좌·매출↔카드 대조에서 불일치가 잡힙니다.`
        : `샘플 자료 ${files.length}종을 올렸어요. 표 자료 ${rows.toLocaleString('ko-KR')}행을 확인했고 가게 정보와 자금 계획란도 채웠습니다.`)
      // 문서함에도 남긴다. 화면을 막지 않도록 뒤에서 처리한다.
      void Promise.allSettled(options.map((option, index) => registerDocument({
        file: files[index], sourceId: option.id, metadata: metadataList[index],
      }))).then(() => api<any>('/api/owner').then((data) => setOwnerData(data)).catch(() => undefined))
    } catch (error) { notify((error as Error).message) }
    finally { setFillingSample('') }
  }

  /** 샘플로 채운 업로드만 비운다. 입력한 사업체 정보는 그대로 둔다. */
  const clearUploads = () => {
    setOpenedDocument('')
    setUploadedFiles({})
    filesRef.current = {}
    setSelectedFiles({})
    setDocumentMetadata({})
    setOcrResults({})
    setOcrImages({})
    setIntakeRows([])
    for (const option of uploadOptions) {
      const field = document.querySelector<HTMLInputElement>(`input[name="document-${option.id}"]`)
      if (field) field.value = ''
    }
    notify('업로드한 자료를 모두 비웠어요.')
  }

  const connectPartner = async (sourceId: string) => {
    try {
      const response = await api<{ message: string }>(`/api/data-connections/${sourceId}`, { method: 'POST', body: JSON.stringify({ consent: true }) })
      notify(response.message)
      setOwnerData(await api<any>('/api/owner'))
      await refresh()
    } catch (error) { notify((error as Error).message) }
  }

  const analyzeDocument = async (sourceId: string) => {
    const file = selectedFiles[sourceId]
    if (!file) return
    const kind = kindOf(file)
    if (kind !== 'image' && kind !== 'pdf') return notify('사진 또는 PDF 서류만 AI 판독할 수 있어요.')
    if (analyzingSource) return
    setAnalyzingSource(sourceId)
    try {
      const dataUrl = kind === 'pdf' ? (await pdfFirstPageToPng(file)).dataUrl : await readAsDataUrl(file)
      const estimatedMb = (dataUrl.length * .75) / 1024 / 1024
      if (estimatedMb > UPLOAD_MB) throw new Error(`AI 판독 그림은 ${UPLOAD_MB}MB 이하여야 해요.`)
      const response = await api<{ message: string; analysis: OcrAnalysis; fields: DocumentField[] }>('/api/ai/ocr', {
        method: 'POST',
        body: JSON.stringify({ image: dataUrl, filename: file.name, sourceId, plan: '펀딩 신청 원천자료 사전검증' }),
      })
      if (filesRef.current[sourceId] !== file) return
      setOcrResults((current) => ({ ...current, [sourceId]: response.analysis }))
      setOcrImages((current) => ({ ...current, [sourceId]: dataUrl }))
      notify(response.message)
      void registerDocument({
        file, sourceId, metadata: documentMetadata[sourceId] || await readDocumentMetadata(file),
        documentType: String((response.analysis.result as Record<string, unknown>)?.documentType || ''),
        ocrAnalysisId: response.analysis.id, fields: response.fields,
      })
    } catch (error) { notify((error as Error).message) }
    finally { setAnalyzingSource('') }
  }

  /** "이 값 맞나요?" 결과를 문서함에 확정한다. 여기서 만들어지는 것이 판독 정확도의 정답 라벨이다. */
  const reviewField = async (sourceId: string, key: string, value: string | null) => {
    const record = documentRecords[sourceId]
    if (!record) { notify('문서함에 아직 등록되지 않았어요. 잠시 후 다시 시도해주세요.'); return }
    try {
      const response = await api<{ document: OwnerDocument; message: string }>(`/api/owner/documents/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: [value === null ? { key, confirmed: true } : { key, value }] }),
      })
      setDocumentRecords((current) => ({ ...current, [sourceId]: response.document }))
    } catch (error) { notify((error as Error).message) }
  }

  const confirmAllFields = async (sourceId: string) => {
    const record = documentRecords[sourceId]
    if (!record) { notify('문서함에 아직 등록되지 않았어요. 잠시 후 다시 시도해주세요.'); return }
    try {
      const response = await api<{ document: OwnerDocument; message: string }>(`/api/owner/documents/${record.id}`, {
        method: 'PATCH', body: JSON.stringify({ confirmAll: true }),
      })
      setDocumentRecords((current) => ({ ...current, [sourceId]: response.document }))
      notify(response.message)
    } catch (error) { notify((error as Error).message) }
  }

  const removeLockerDocument = async (documentId: string) => {
    try {
      await api(`/api/owner/documents/${documentId}`, { method: 'DELETE' })
      setOwnerData(await api<any>('/api/owner'))
      notify('문서함에서 지웠어요.')
    } catch (error) { notify((error as Error).message) }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!owner) { onLogin(); return }
    if (!legal || !allConsentsAgreed) { notify('필수 고지사항을 모두 확인하고 동의해주세요.'); return }
    if (submitting || fillingSample) return
    for (let index = 0; index < stepDefinitions.length; index += 1) {
      if (!validateStep(index)) { goToStep(index); return }
    }
    setSubmitting(true)
    try {
      const connectedSources = [...Object.keys(uploadedFiles), ...(identityVerified ? ['identity'] : [])]
      // CSV 본문을 함께 보낸다. 서버가 이 원자료를 직접 합산해 심사 지표를 만든다.
      // 이미지·PDF 는 보내지 않는다. 문서는 'AI 판독' 경로가 따로 있고 원본은 저장하지 않는다.
      const documentContents: Record<string, string> = {}
      for (const [sourceId, file] of Object.entries(selectedFiles)) {
        if (!/\.csv$/i.test(file.name)) continue
        documentContents[sourceId] = await file.text()
      }
      // 입력값은 폼(DOM)이 아니라 상태에서 모은다. 단계가 넘어가면 앞 단계의 칸은 화면에 없다.
      const payload: Record<string, unknown> = {
        ...fields,
        // 화면에서 직접 받은 심사 자료. 서버가 다시 검증하고, 점수에는 넣지 않는다.
        targetRestaurantId,
        fundUsePlan: fundUsePlan.filter((item) => item.amount > 0),
        declaredDebt: {
          hasDebt: declaredDebt.hasDebt,
          loans: declaredDebt.hasDebt ? declaredDebt.loans.filter((loan) => loan.lender.trim() || loan.balance > 0) : [],
        },
        ownership: ownership.filter((row) => row.name.trim() && row.share > 0),
        connectedSources,
        uploadedDocuments: uploadedFiles,
        documentContents,
        documentMetadata,
        identityVerified,
        privacyConsent: agreedDocuments.includes('privacy'),
        creditConsent: agreedDocuments.includes('credit-info'),
        consent: { version: legal.version, documentIds: agreedDocuments },
      }
      const response = await api<{ message: string; application: ApplicationResult }>('/api/applications', { method: 'POST', body: JSON.stringify(payload) })
      setResult(response.application)
      notify(response.message)
      // 결과도 자기 주소로 넘어간다. 뒤로 가기를 누르면 신청서 마지막 단계로 돌아온다.
      navigate(`/owner/${RESULT_SLUG}`)
      await refresh()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    catch (error) { notify((error as Error).message) }
    finally { setSubmitting(false) }
  }

  /** 주소로 열 수 있는 마지막 단계. 앞 단계를 끝내야 다음 주소가 열린다. */
  const reachableStep = Math.max(step, firstIncompleteStep())
  const stepState = (index: number) => {
    if (index === step) return 'current'
    if (stepComplete(index)) return 'done'
    return ''
  }

  return <div className="owner-page owner-v2">
    <section className="owner-page-hero">
      <div><span className="eyebrow light"><Store /> 먹투 사장님 센터</span><h1>가지고 계신 자료를<br /><em>그냥 올려주세요.</em></h1><p>재무제표를 새로 만들 필요 없어요. 사진·PDF·엑셀·CSV 무엇이든 올리면 먹투가 무슨 자료인지 알아보고, 필요한 값을 뽑아 서로 맞는지 대조합니다.</p><div className="owner-values"><span><Check /> 신청비 0원</span><span><Check /> 양식 작성 없음</span><span><Check /> 사진·PDF·엑셀 가능</span><span><Check /> 자동 분류</span><span><Check /> 자료 일치도 공개</span><span><Check /> 부족한 자료는 미산정</span></div></div>
      <div className="review-flow data-flow"><b>펀딩 등록 흐름</b>{['가게 정보 확인', '자료 올리기(자동 분류)', 'AI가 읽은 값 확인', '동의와 자금 계획', '35지표 예비평가와 자료 일치도', '운영자 확인 후 펀딩 등록'].map((title, index) => <div key={title}><span>{index + 1}</span><p>{title}</p><Check /></div>)}</div>
    </section>

    <div className="owner-page-body">
      {owner && !result && <section className="owner-funding-status">
        <div className="owner-status-head">
          <div><span className="eyebrow coral"><Store /> 펀딩 등록</span><h2>자료를 올리면 먹투가 정리합니다</h2><p>이 화면에서는 신규 펀딩 신청과 심사 자료 제출만 진행합니다. 등록 후 펀드 현황과 운영 기능은 마이페이지에서 확인할 수 있어요.</p></div>
          <NavLink className="button secondary" to="/owner/my">마이페이지 <ChevronRight /></NavLink>
        </div>
      </section>}
      {demoMode && <section className="demo-mode-banner"><ShieldCheck /><div><b>사장님 체험 모드 · 저장되지 않아요</b><p>만능 업로드함, 자동 분류, AI 판독값 확인, 심사 접수, 자료 일치도 확인까지 실제와 똑같이 눌러볼 수 있어요. 이 체험 기록은 다른 사용자에게 보이지 않고 브라우저를 닫으면 사라집니다.</p></div></section>}

      {showingResult && result ? <section className="source-review-result">
        <div className="result-heading">
          <span className={`result-badge ${result.status}`}>{result.status === 'approved' ? '펀딩 가능' : result.status === 'conditional' ? '조건부 승인' : result.status === 'manual_review' ? '운영자 확인 필요' : '보완 필요'}</span>
          <h2>먹투가 자동 계산한 Restaurant Health Profile</h2>
          <p>{result.restaurantName} · 먹투 성장성 예비평가 {result.score}점 · 데이터 신뢰도 {confidence}%</p>
        </div>
        <div className="result-metrics">{Object.entries(metrics).map(([key, value]) => <div key={key}><span>{metricLabels[key] || key}</span><b>{value === null || value === undefined ? '미산정' : moneyMetrics.has(key) ? won(Number(value)) : percentMetrics.has(key) ? `${value}%` : String(value)}</b></div>)}</div>
        {result.data?.sourceProvenance && <div className="source-provenance-result"><div><b>사장님 직접 업로드</b><span>{result.data.sourceProvenance.ownerUploaded?.join(', ') || '없음'}</span></div><div><b>제휴기관 연결</b><span>{result.data.sourceProvenance.partnerConnected?.join(', ') || '없음'}</span></div></div>}

        {/* 사장님이 화면에서 직접 적은 심사 자료. 점수와 무관하다는 것도 함께 밝힌다. */}
        <ApplicationExtrasSummary
          fundUsePlan={result.data?.fundUsePlan}
          declaredDebt={result.data?.declaredDebt}
          ownership={result.data?.ownership}
          salesBasis={result.data?.salesBasis}
        />

        {/* 이번 라운드의 핵심 화면. 숫자마다 근거를 붙이고 자료끼리 맞춰본 결과를 보여준다. */}
        <EvidencePanel ledger={result.data?.evidenceLedger} />

        <VerificationReport business={result.data?.businessVerification} financial={result.data?.financialVerification} />
        {result.data?.creditAssessment && <CreditGradePanel credit={result.data.creditAssessment} combined={result.data.combinedAssessment} />}
        <div className="result-columns"><section><h3>확인된 강점</h3>{result.strengths.map((item) => <p key={item}><Check /> {item}</p>)}</section><section><h3>보강하면 좋은 자료</h3>{result.improvements.map((item) => <p key={item}>{item}</p>)}</section></div>
        <div className="result-checks"><b>검증 절차</b>{result.checks.map((item) => <p key={item}>{item}</p>)}</div>
        <div className="result-explanation"><b>심사 설명</b><p>{result.explanation}</p><span>AI 제안 한도 {won(result.approvedLimit)}{result.requestedLimit ? ` · 희망 ${won(result.requestedLimit)}` : ''} · 운영자 확정 전 참고값</span></div>
        <div className="result-why"><b>왜 바로 탈락시키지 않았나요?</b><p>먹투는 기존 신용점수만으로 판단하지 않습니다. 실제 고객의 재방문과 최근 성장 흐름이 보이면 조건부 승인이나 사람의 추가 검토 기회를 드려요. 자료가 부족하다는 이유만으로 자동 거절하지 않습니다.</p></div>
        <div className="owner-result-actions"><NavLink className="button" to="/owner/my">마이페이지에서 결과 확인</NavLink><button className="button secondary" onClick={goBack}>새 펀딩 신청서 작성</button></div>
      </section> : <form
        noValidate
        className={`application-form source-application owner-wizard ${!owner ? 'locked' : ''}`}
        onSubmit={(event) => {
          // 단계마다 폼이 따로 있다. 마지막 단계에서만 실제로 접수하고, 그 전에는 다음 주소로 넘긴다.
          if (step === stepDefinitions.length - 1) { void submit(event); return }
          event.preventDefault()
          nextStep()
        }}
      >
        {!owner && <div className="owner-lock-overlay"><LockKeyhole /><h2>사장님 계정 전용 기능이에요</h2><p>상호명과 자료 업로드를 포함한 모든 입력은 소상공인 계정으로 로그인한 뒤 사용할 수 있습니다.</p><button type="button" className="button" onClick={onLogin}>{me ? '소상공인 계정으로 다시 로그인' : '로그인·회원가입'}</button></div>}
        <fieldset disabled={!owner || submitting || Boolean(fillingSample)}>
          <div className="form-heading"><span>원천데이터 기반 예비심사</span><h2>{stepDefinitions[step].title}</h2><p>{stepDefinitions[step].hint}</p></div>

          {/* 샘플 자료 버튼은 어느 단계에서든 보이게 둔다.
              2단계 안에만 두었더니, 1단계를 채우지 못한 사장님은 1·4단계 입력까지
              함께 채워주는 이 버튼에 도달할 방법이 없었다(실제 브라우저 검사에서 걸렸다). */}
          {owner && <div className="sample-sets">
            {sampleSets.map((set) => <button
              type="button" key={set.id} className={`sample-set ${set.id}`}
              disabled={Boolean(fillingSample)} onClick={() => void fillWithSamples(set)}
            >
              <span>{set.id === 'clean' ? <Sparkles /> : <TriangleAlert />}</span>
              <div><b>{fillingSample === set.id ? '샘플 자료를 불러오는 중...' : set.label}</b><p>{set.description}</p></div>
            </button>)}
            {uploadedCount > 0 && <button type="button" className="sample-clear" disabled={Boolean(fillingSample)} onClick={clearUploads}><Eraser /> 업로드 비우기</button>}
          </div>}

          <nav className="wizard-rail" aria-label="신청 단계">
            {stepDefinitions.map((definition, index) => <button
              type="button" key={definition.id}
              className={stepState(index)}
              disabled={index > reachableStep}
              onClick={() => { if (index <= reachableStep) goToStep(index) }}
            >
              <i>{stepComplete(index) && index !== step ? <Check /> : index + 1}</i>
              <span><b>{definition.title}</b><small>{index === step ? '진행 중' : stepComplete(index) ? '완료' : index <= reachableStep ? '작성 중' : '대기'}</small></span>
            </button>)}
          </nav>
          {/* 지금 어느 주소에 있는지 그대로 보여준다. 단계가 진짜로 넘어간다는 걸 알 수 있게. */}
          <p className="wizard-route" aria-live="polite">
            <span>{step + 1}/{stepDefinitions.length}</span>
            <code>/owner/{stepDefinitions[step].slug}</code>
          </p>

          <div className="wizard-stage">
            {/* ── 1단계 · 가게 정보 ─────────────────────────── */}
            {step === 0 && <section className={`wizard-step active ${direction === 'back' ? 'back' : ''}`}>
              {/* 새 가게인가, 이미 등록한 가게의 다음 회차인가. 처음에 정해야 회차가 꼬이지 않는다. */}
              {(ownerData?.restaurants || []).length > 0 && <div className="form-section">
                <TargetPicker
                  restaurants={ownerData.restaurants}
                  value={targetRestaurantId}
                  onChange={(restaurantId) => {
                    setTargetRestaurantId(restaurantId)
                    const picked = (ownerData?.restaurants || []).find((item: any) => item.id === restaurantId)
                    if (picked) {
                      setFields((current) => ({
                        ...current,
                        restaurantName: picked.name,
                        category: picked.category || current.category,
                        signature: picked.signature || current.signature,
                        avgPrice: String(picked.avgPrice || current.avgPrice),
                      }))
                    }
                  }}
                />
              </div>}

              <div className="form-section">
                <div className="form-section-title"><span>1</span><div><h3>사업체 기본정보와 대표자 확인</h3><p>상권 자료는 주소를 기준으로 먹투가 직접 수집합니다.</p></div></div>
                <div className="field-grid">
                  <label className="field"><span>상호명</span><input name="restaurantName" placeholder="예: 소복소복" value={fields.restaurantName} onChange={setField('restaurantName')} /></label>
                  <label className="field"><span>대표자명</span><input name="ownerName" placeholder="사업자등록증과 동일하게" value={fields.ownerName} onChange={setField('ownerName')} /></label>
                  <label className="field"><span>업종</span><select name="category" value={fields.category} onChange={setField('category')}><option>한식</option><option>중식</option><option>일식</option><option>양식</option><option>카페·베이커리</option><option>분식</option><option>주점</option><option>기타</option></select></label>
                  <label className="field"><span>대표 메뉴</span><input name="signature" placeholder="예: 들기름 고등어 한상" value={fields.signature} onChange={setField('signature')} /></label>
                  <label className="field"><span>평균 식사 가격</span><div className="number-field"><input type="number" name="avgPrice" min={1000} step={1000} value={fields.avgPrice} onChange={setField('avgPrice')} /><span>원</span></div></label>
                  <label className="field"><span>사업자등록번호</span><input name="businessNumber" placeholder="000-00-00000" value={fields.businessNumber} onChange={setField('businessNumber')} /></label>
                  <label className="field"><span>영업신고번호</span><input name="licenseNumber" placeholder="신고번호 입력" value={fields.licenseNumber} onChange={setField('licenseNumber')} /></label>
                  <label className="field full-field"><span>사업장 주소</span><input name="address" placeholder="상권·경쟁·생활인구 분석에 사용됩니다." value={fields.address} onChange={setField('address')} /></label>
                </div>
                <button type="button" className={`identity-action ${identityVerified ? 'verified' : ''}`} onClick={() => setIdentityVerified(true)}><UserCheck />{identityVerified ? '대표자 본인인증 완료' : '휴대전화로 대표자 본인인증'}<span>{identityVerified ? '신청자와 대표자 일치 여부를 확인했습니다.' : 'MVP에서는 버튼을 누르면 시연용 인증이 완료됩니다.'}</span></button>
                <OwnershipEditor rows={ownership} ownerName={fields.ownerName} onChange={setOwnership} />
              </div>
            </section>}

            {/* ── 2단계 · 자료 올리기 ───────────────────────── */}
            {step === 1 && <section className={`wizard-step active ${direction === 'back' ? 'back' : ''}`}>
              <UniversalIntake
                dragging={dragging} busy={intakeBusy} rows={intakeRows}
                onDragState={setDragging}
                onFiles={(files) => void intakeFiles(files)}
                onReassign={(row, sourceId) => void reassign(row, sourceId)}
              />

              {lockerDocuments.length > 0 && <DocumentLocker
                documents={lockerDocuments} stats={documentStats}
                onRemove={(id) => void removeLockerDocument(id)}
              />}

              <div className="form-section evidence-source-section">
                <div className="form-section-title"><span>2</span><div><h3>자료가 어느 칸에 들어갔는지 확인해주세요</h3><p>기관에서 동의 기반으로 전송받은 자료와 사장님이 직접 올린 파일을 원장에 서로 다른 출처로 남깁니다.</p></div></div>
                <div className="source-progress"><div><b>{evidenceCount}개</b><span>확보 자료</span></div><div className="progress-track"><i style={{ width: `${Math.min(100, evidenceCount / uploadOptions.length * 100)}%` }} /></div><small>필수: 사업자등록·영업신고 + POS·사업계좌(기관 연결 또는 직접 업로드)</small></div>
                {missingRequired.length > 0 && <p className="wizard-missing"><TriangleAlert /> 아직 없는 필수 자료: {missingRequired.map((source) => labelOf(source)).join(', ')}</p>}

                <div className="evidence-lane partner-lane"><div className="evidence-lane-heading"><PlugZap /><div><b>A. 제휴기관·마이데이터형 연결</b><p>동의 범위·제공기관·동기화 시각이 함께 기록됩니다. 현재 버튼은 실제 기관 API 대신 시연 어댑터를 사용합니다.</p></div></div><div className="partner-connection-grid">{partnerOptions.map((option) => { const Icon = option.icon; const connection = activeConnections.find((item: any) => item.sourceId === option.id); return <article className={connection ? 'connected' : ''} key={option.id}><Icon /><div><b>{option.title}</b><span>{option.provider}</span><small>{option.scope}</small>{connection && <em><Check /> {connection.recordCount.toLocaleString()}건 · {new Date(connection.lastSyncedAt).toLocaleDateString('ko-KR')}</em>}</div><button type="button" disabled={Boolean(connection)} onClick={() => connectPartner(option.id)}>{connection ? '연결됨' : '동의하고 연결'}</button></article> })}</div></div>

                <div className="evidence-lane upload-lane">
                <div className="evidence-lane-heading"><UploadCloud /><div><b>B. 자료가 들어간 칸</b><p>위에서 올린 파일이 여기에 자동으로 들어갑니다. 비어 있는 칸은 직접 골라 넣어도 됩니다. 엑셀은 표로 바꿔서 넣습니다.</p></div></div>
                <SamplePack />
                {/* 요건 묶음으로 나눠 보여준다. 무엇이 필수이고 무엇이 택1인지가 카드 옆에 그대로 붙는다. */}
                {groupedOptions.map(({ group, options: groupOptions }) => {
                  const options = group === '추가 자료' ? [...groupOptions, ...unplacedOptions] : groupOptions
                  return <div className="document-group" key={group}>
                  <div className="document-group-head">
                    <h4>{group}</h4>
                    <small>{group === '사업체 확인' ? '두 가지 모두 필요해요'
                      : group === '매출 확인' ? '아래 중 하나 이상만 있으면 됩니다'
                        : group === '현금흐름 확인' ? '반드시 필요해요'
                          : '없어도 접수되지만, 올리면 산정되는 평가 지표가 늘어나요'}</small>
                  </div>
                  {group === '매출 확인' && <SalesEvidenceStatus
                    satisfied={satisfiedSalesEvidence}
                    options={options.map((option) => ({ id: option.id, title: option.title }))}
                  />}
                  <div className="document-upload-grid">
                    {options.map((option) => <DocumentUploadCard
                      key={option.id} option={option} guide={guideFor(option.id)}
                      fileName={uploadedFiles[option.id]} metadata={documentMetadata[option.id]}
                      classification={classifications[option.id]}
                      onChange={(event) => selectFile(option.id, event)}
                      onOpen={() => setOpenedDocument(option.id)}
                    />)}
                  </div>
                </div>
                })}
              </div>
              {/* 부채는 자료보다 답이 먼저다. 대출이 없으면 클릭 한 번으로 끝나고,
                  있으면 적어주신 값과 증빙을 대조한다. 증빙 업로드 칸도 이 묶음 안에 둔다. */}
              <div className="document-group">
                <div className="document-group-head"><h4>부채 확인</h4><small>대출이 있으면 필수예요</small></div>
                <DebtDeclaration value={declaredDebt} onChange={setDeclaredDebt} />
                {debtOptions.length > 0 && <div className="document-upload-grid">
                  {debtOptions.map((option) => <DocumentUploadCard
                    key={option.id} option={option} guide={guideFor(option.id)}
                    fileName={uploadedFiles[option.id]} metadata={documentMetadata[option.id]}
                    classification={classifications[option.id]}
                    onChange={(event) => selectFile(option.id, event)}
                    onOpen={() => setOpenedDocument(option.id)}
                  />)}
                </div>}
              </div>
                <p className="mvp-source-note">MVP는 직접 업로드 파일의 이름·크기·형식과 CSV 열·행 수를 검증해 심사 출처로 기록합니다. 사진·PDF 는 브라우저에서 그림으로 바꿔 판독 요청만 서버로 보내며 원본 이미지는 저장하지 않습니다. 실제 기관 연결은 현재 모의 어댑터이고, 운영 전 기관 OAuth·전자서명·암호화 보관으로 교체해야 합니다.</p>
              </div>
            </section>}

            {/* ── 3단계 · 읽은 값 확인 ─────────────────────── */}
            {step === 2 && <section className={`wizard-step active ${direction === 'back' ? 'back' : ''}`}>
              <div className="form-section">
                <div className="form-section-title"><span>3</span><div><h3>AI가 읽은 값이 맞는지 봐주세요</h3><p>틀린 값을 고쳐주시면 그 자리에서 바로 반영되고, 다음 판독을 더 정확하게 만드는 데도 쓰입니다.</p></div></div>
                <ReadingConfirm
                  sources={readingSources}
                  ocrResults={ocrResults}
                  ocrImages={ocrImages}
                  records={documentRecords}
                  analyzing={analyzingSource}
                  tables={Object.entries(documentMetadata).filter(([, metadata]) => metadata.rowCount > 0)}
                  pendingDocuments={Object.entries(selectedFiles).filter(([sourceId, file]) => !ocrResults[sourceId] && (kindOf(file) === 'image' || kindOf(file) === 'pdf'))}
                  onAnalyze={(sourceId) => void analyzeDocument(sourceId)}
                  onConfirmField={(sourceId, key) => void reviewField(sourceId, key, null)}
                  onCorrectField={(sourceId, key, value) => void reviewField(sourceId, key, value)}
                  onConfirmAll={(sourceId) => void confirmAllFields(sourceId)}
                  onOpen={(sourceId) => setOpenedDocument(sourceId)}
                />
              </div>
            </section>}

            {/* ── 4단계 · 동의와 계획 ──────────────────────── */}
            {step === 3 && <section className={`wizard-step active ${direction === 'back' ? 'back' : ''}`}>
              <div className="form-section legal-consent-section">
                <div className="form-section-title"><span>4</span><div><h3>분석에 꼭 필요한 동의만 확인</h3><p>마케팅·광고 동의는 받지 않습니다. ‘전문 보기’를 누르면 수집 항목·목적·보유기간과 이의제기 절차가 펼쳐지고, 그 전문 맨 아래에서 동의할 수 있습니다.</p></div></div>
                <div className="consent-progress"><b>{consentDocuments.filter((document) => agreedDocuments.includes(document.id)).length}/{consentDocuments.length}</b><span>필수 고지 동의 완료</span><small>각 항목의 전문을 펼치면 맨 아래에서 동의할 수 있어요.</small></div>
                {consentDocuments.map((document) => <LegalConsentReader key={`${legal?.version}:${document.id}`} documentId={document.id} title={document.title} summary={document.summary} agreed={agreedDocuments.includes(document.id)} onToggle={() => toggleConsent(document.id)} />)}
                {!consentDocuments.length && <p className="legal-loading">필수 고지사항을 불러오는 중이에요.</p>}
                <div className="automated-analysis-note"><ShieldCheck /><p><b>자동분석 안내</b> 먹투 모델은 예비 점수와 설명을 만들지만 자동으로 최종 거절하지 않습니다. 자료 부족·불일치는 수동 심사로 보내며, 사장님은 결과 설명과 재검토를 요청할 수 있습니다.</p></div>
              </div>

              <div className="form-section">
                <div className="form-section-title"><span>5</span><div><h3>사장님이 직접 작성할 내용</h3><p>데이터만으로 알 수 없는 자금 목적과 실행계획만 직접 설명해주세요.</p></div></div>
                <div className="field-grid">
                  <label className="field"><span>희망 펀딩액</span><div className="number-field"><input type="number" name="requestedLimit" min={5000000} step={1000000} value={fields.requestedLimit} onChange={setField('requestedLimit')} /><span>원</span></div></label>
                  <label className="field"><span>필요 기간</span><div className="number-field"><input type="number" name="fundingPeriodMonths" min={3} max={36} value={fields.fundingPeriodMonths} onChange={setField('fundingPeriodMonths')} /><span>개월</span></div></label>
                  <label className="field"><span>사장 자기자금</span><div className="number-field"><input type="number" name="ownCapital" min={0} step={1000000} value={fields.ownCapital} onChange={setField('ownCapital')} /><span>원</span></div></label>
                  <label className="field"><span>최대 쿠폰 할인율</span><select name="maxDiscount" value={fields.maxDiscount} onChange={setField('maxDiscount')}><option value="30">30%</option><option value="35">35%</option><option value="40">40%</option><option value="45">45%</option><option value="50">50%</option></select></label>
                </div>
                <FundUsePlanEditor items={fundUsePlan} requestedLimit={Number(fields.requestedLimit) || 0} onChange={setFundUsePlan} />
                <label className="field"><span>자금 사용계획 설명</span><textarea name="fundPurpose" rows={3} placeholder="예: 저온 저장고를 바꿔 품절을 줄이고, 주방 동선을 고쳐 점심 회전율을 올립니다." value={fields.fundPurpose} onChange={setField('fundPurpose')} /></label>
                <label className="field"><span>사업계획과 차별성</span><textarea name="businessPlan" rows={4} placeholder="왜 고객이 다시 찾는지, 자금을 어떻게 성장으로 연결할지 설명해주세요." value={fields.businessPlan} onChange={setField('businessPlan')} /></label>
                <label className="field"><span>예상 효과</span><textarea name="expectedEffect" rows={3} placeholder="예: 좌석 24→38석, 점심 회전율 개선, 품절 감소" value={fields.expectedEffect} onChange={setField('expectedEffect')} /></label>
              </div>

              <section className="three-check-system"><h3>먹투 3중 검증</h3><div><span>① 공식자료</span><p>사업자·홈택스·대출·임대차</p></div><div><span>② 실제 영업자료</span><p>POS·카드·계좌·배달</p></div><div><span>③ 외부자료</span><p>상권·리뷰·고객수요·경쟁</p></div><small>서로 맞지 않는 값은 원인을 분류하고 수동 심사 대상으로 표시합니다.</small></section>
            </section>}
          </div>

          <div className="wizard-nav">
            <p className="wizard-hint">{step === stepDefinitions.length - 1
              ? '자동분석을 누르면 올린 자료에서 지표를 계산하고 자료끼리 대조한 결과까지 함께 보여드려요.'
              : stepDefinitions[step].hint}</p>
            <div className="wizard-nav-buttons">
              {step > 0 && <button type="button" className="wizard-back" onClick={() => goToStep(step - 1)}><ArrowLeft /> 이전</button>}
              {step < stepDefinitions.length - 1
                ? <button type="button" className="wizard-next" onClick={nextStep}>다음 <ArrowRight /></button>
                : <button className="wizard-next" disabled={submitting || !identityVerified || !allConsentsAgreed}>
                  {submitting ? '원천데이터를 교차검증하고 있어요...' : !identityVerified ? '대표자 본인인증을 먼저 완료해주세요' : !allConsentsAgreed ? '필수 고지사항에 모두 동의해주세요' : demoMode ? '체험으로 자동분석 해보기' : '먹투 자동분석 시작'} <Database />
                </button>}
            </div>
          </div>
          <p className="form-disclaimer">이 결과는 금융기관의 공식 신용평가나 정부 SCB 결과가 아닌 먹투 성장성 예비평가이며 최종 펀딩 승인이 아닙니다. 실제 서비스 출시 전 개인정보·신용정보 처리 구조와 보유기간은 전문 법률 검토 및 제휴기관 요건 확인이 필요합니다.</p>
        </fieldset>
      </form>}
    </div>
    {openedFile && <DocumentModal
      title={uploadOptions.find((option) => option.id === openedDocument)?.title || '제출 자료'}
      filename={openedFile.name}
      meta={`${fileSizeLabel(openedFile.size)} · ${openedFile.type || '형식 미확인'}${documentMetadata[openedDocument]?.rowCount ? ` · ${documentMetadata[openedDocument].headers.length}열 ${documentMetadata[openedDocument].rowCount.toLocaleString('ko-KR')}행` : ''} · 내 브라우저에서만 열립니다`}
      onClose={() => setOpenedDocument('')}
    >
      <LocalFileViewer file={openedFile} boxes={boxesOf(ocrResults[openedDocument])} />
    </DocumentModal>}
  </div>
}

const labelOf = (sourceId: string) => uploadOptions.find((option) => option.id === sourceId)?.title || sourceId

/** 판독 결과에서 좌표 상자만 꺼낸다. 서버가 이미 0~1000 기준으로 정규화해 준다. */
function boxesOf(analysis?: OcrAnalysis): OcrBox[] {
  const boxes = (analysis?.result as Record<string, unknown> | undefined)?.boundingBoxes
  return Array.isArray(boxes) ? (boxes as OcrBox[]) : []
}

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'))
  reader.readAsDataURL(file)
})

/**
 * 만능 업로드함.
 *
 * 문서 종류를 먼저 고르게 하지 않는다. 고령 사장님에게 "부가세 신고서를 이 칸에"라고
 * 요구하는 순간 화면이 벽이 되기 때문이다. 받아놓고 뒤에서 판단한다.
 */
function UniversalIntake({ dragging, busy, rows, onDragState, onFiles, onReassign }: {
  dragging: boolean
  busy: boolean
  rows: IntakeRow[]
  onDragState: (value: boolean) => void
  onFiles: (files: File[]) => void
  onReassign: (row: IntakeRow, sourceId: string) => void
}) {
  return <div className="intake-block">
    <div
      className={`intake-zone ${dragging ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
      onDragOver={(event) => { event.preventDefault(); onDragState(true) }}
      onDragLeave={() => onDragState(false)}
      onDrop={(event) => {
        event.preventDefault()
        onDragState(false)
        onFiles(Array.from(event.dataTransfer.files || []))
      }}
    >
      <span><UploadCloud /></span>
      <h3>가지고 계신 자료를 그냥 올려주세요</h3>
      <p>어떤 서류인지 고르지 않아도 됩니다. 사진을 찍은 것, 세무사에게 받은 PDF, 은행에서 내린 엑셀 무엇이든 올리면 먹투가 무슨 자료인지 알아보고 알맞은 칸에 넣습니다.</p>
      <label className="intake-pick">
        <UploadCloud /> {busy ? '자료를 살펴보는 중...' : '파일 고르기'}
        <input
          type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx"
          onChange={(event) => {
            onFiles(Array.from(event.target.files || []))
            event.target.value = ''
          }}
        />
      </label>
      <div className="intake-formats"><em>사진 (JPG·PNG)</em><em>PDF</em><em>엑셀 (XLSX)</em><em>CSV</em><em>한 번에 여러 개</em></div>
    </div>

    {rows.length > 0 && <div className="intake-results">
      {rows.map((row) => <div className={`intake-row ${row.state}`} key={row.key}>
        <span className="intake-icon">{row.state === 'failed' ? <TriangleAlert /> : row.state === 'working' ? <RotateCcw /> : /\.csv$/i.test(row.filename) ? <FileSpreadsheet /> : /\.pdf$/i.test(row.filename) ? <FileText /> : <ImageIcon />}</span>
        <div>
          <b>{row.filename}</b>
          <small>{row.message}</small>
          {row.state === 'done' && row.confidence !== undefined && row.sourceId !== 'other' && <span className={`intake-confidence ${row.confidence < .7 ? 'low' : ''}`}>
            먹투 판단 확신 {Math.round(row.confidence * 100)}%
          </span>}
        </div>
        {row.state === 'done' && <div className="intake-kind-pick">
          <select
            value={row.sourceId && row.sourceId !== 'other' ? row.sourceId : ''}
            onChange={(event) => { if (event.target.value) onReassign(row, event.target.value) }}
            aria-label={`${row.filename} 자료 종류`}
          >
            <option value="">직접 고르기</option>
            {uploadOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
          </select>
        </div>}
      </div>)}
    </div>}
  </div>
}

/**
 * 판독값 확인.
 *
 * 이 화면의 버튼 하나하나가 정답 라벨이 된다. "맞아요"를 누르면 AI 값이 확정되고,
 * 고치면 고친 값이 확정되면서 어느 항목에서 오독이 나는지가 문서함에 쌓인다.
 * 이 기록이 없으면 판독 정확도를 주장할 근거가 서비스에 존재하지 않는다.
 */
function ReadingConfirm({ sources, ocrResults, ocrImages, records, analyzing, tables, pendingDocuments, onAnalyze, onConfirmField, onCorrectField, onConfirmAll, onOpen }: {
  sources: string[]
  ocrResults: Record<string, OcrAnalysis>
  ocrImages: Record<string, string>
  records: Record<string, OwnerDocument>
  analyzing: string
  tables: Array<[string, DocumentMetadata]>
  pendingDocuments: Array<[string, File]>
  onAnalyze: (sourceId: string) => void
  onConfirmField: (sourceId: string, key: string) => void
  onCorrectField: (sourceId: string, key: string, value: string) => void
  onConfirmAll: (sourceId: string) => void
  onOpen: (sourceId: string) => void
}) {
  return <div className="reading-list">
    {pendingDocuments.length > 0 && <div className="reading-pending">
      <b>아직 읽지 않은 서류가 {pendingDocuments.length}건 있어요</b>
      {pendingDocuments.map(([sourceId, file]) => <div key={sourceId}>
        <span>{labelOf(sourceId)} · {file.name}</span>
        <button type="button" disabled={Boolean(analyzing)} onClick={() => onAnalyze(sourceId)}>
          {analyzing === sourceId ? 'AI가 읽는 중...' : 'AI로 읽기'}
        </button>
      </div>)}
    </div>}

    {sources.map((sourceId) => {
      const analysis = ocrResults[sourceId]
      const result = (analysis.result || {}) as Record<string, any>
      const record = records[sourceId]
      const boxes = boxesOf(analysis)
      const image = ocrImages[sourceId]
      const confirmed = record ? record.fields.length > 0 && record.fields.every((field) => field.state !== 'ai') : false
      return <article className={`reading-card ${confirmed ? 'confirmed' : ''}`} key={sourceId}>
        <header>
          <div>
            <b>{labelOf(sourceId)}</b>
            <small>{analysis.filename} · {result.documentType || '문서 종류 미확인'} · 판독 확신 {Math.round((Number(result.confidence) || 0) * 100)}%</small>
          </div>
          {confirmed
            ? <span className="reading-state"><Check /> 확인 완료</span>
            : <span className="reading-state" style={{ color: '#a1720d' }}><TriangleAlert /> 확인 필요</span>}
        </header>
        <div className="reading-body">
          {image
            ? <HighlightedImage url={image} name={analysis.filename} boxes={boxes} />
            : <button type="button" className="reading-open" onClick={() => onOpen(sourceId)}><Eye /> 올린 자료 열어보기</button>}
          <div className="reading-fields">
            {record?.fields.length ? record.fields.map((field) => <ReadingField
              key={field.key} field={field}
              onConfirm={() => onConfirmField(sourceId, field.key)}
              onCorrect={(value) => onCorrectField(sourceId, field.key, value)}
            />) : <p className="reading-empty">이 서류에서 확인할 값을 읽지 못했어요. 운영자가 원본을 확인합니다.</p>}
            {(result.warnings || []).map((warning: string) => <p className="reading-warning" key={warning}><TriangleAlert /> {warning}</p>)}
          </div>
        </div>
        {record?.fields.length ? <div className="reading-actions">
          <button type="button" className="primary" onClick={() => onConfirmAll(sourceId)}><Check /> 이 서류 값 전부 맞아요</button>
          <button type="button" onClick={() => onOpen(sourceId)}><Eye /> 원본 다시 보기</button>
        </div> : null}
      </article>
    })}

    {tables.length > 0 && <div className="reading-tables">
      <b>표 자료는 먹투가 직접 합산했어요</b>
      <p>표는 값을 하나씩 확인할 필요가 없습니다. 열 이름을 찾아 전체 행을 합산하고, 결과는 다음 단계의 자료 일치도에서 다른 자료와 맞춰봅니다.</p>
      <ul>{tables.map(([sourceId, metadata]) => <li key={sourceId}>
        <span>{labelOf(sourceId)}</span>
        <b>{metadata.rowCount.toLocaleString('ko-KR')}행 · {metadata.headers.length}열</b>
        <small>{metadata.headers.slice(0, 5).join(', ')}{metadata.headers.length > 5 ? ' …' : ''}</small>
        <button type="button" onClick={() => onOpen(sourceId)}><Eye /> 열어보기</button>
      </li>)}</ul>
    </div>}

    {!sources.length && !tables.length && !pendingDocuments.length && <p className="reading-empty">
      아직 올린 자료가 없어요. 이전 단계로 돌아가 자료를 올려주세요.
    </p>}
  </div>
}

function ReadingField({ field, onConfirm, onCorrect }: { field: DocumentField; onConfirm: () => void; onCorrect: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.confirmedValue ?? field.aiValue ?? '')
  const shown = field.state === 'ai' ? field.aiValue : field.confirmedValue ?? field.aiValue
  return <div className={`reading-field ${field.state}`}>
    <small>{field.label}</small>
    {editing
      ? <input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
      : <b>{shown || '값 없음'}</b>}
    <div className="field-actions">
      {editing
        ? <>
          <button type="button" className="on" onClick={() => { onCorrect(draft); setEditing(false) }}>저장</button>
          <button type="button" onClick={() => { setDraft(shown ?? ''); setEditing(false) }}>취소</button>
        </>
        : <>
          <button type="button" className={field.state !== 'ai' ? 'on' : ''} onClick={onConfirm}>
            {field.state === 'ai' ? '맞아요' : field.state === 'corrected' ? '수정됨' : '확인됨'}
          </button>
          <button type="button" onClick={() => setEditing(true)}>고치기</button>
        </>}
    </div>
  </div>
}

/**
 * 문서함.
 *
 * 지금까지 올린 자료는 제출하면 사라졌다. 다음 라운드에 처음부터 다시 올려야 했고,
 * "판독이 얼마나 정확한가"를 말할 근거도 남지 않았다.
 * 여기서 확인·수정 이력을 보여준다. 확인한 항목 중 그대로 맞았던 비율이 곧 판독 정확도다.
 */
function DocumentLocker({ documents, stats, onRemove }: { documents: OwnerDocument[]; stats?: DocumentStats; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const shown = open ? documents : documents.slice(0, 4)
  return <div className="document-locker">
    <header>
      <b>내 문서함 <small>{documents.length}건</small></b>
      <p>한 번 올린 자료는 여기에 남습니다. 다음 라운드에 다시 올리지 않아도 되고, 사장님이 고쳐준 값은 판독 정확도를 재는 기준이 됩니다.</p>
    </header>
    {stats && <div className="locker-stats">
      <span>확인 완료 {stats.confirmedDocuments}/{stats.documentCount}건</span>
      <span>확인한 항목 {stats.reviewedFields}개</span>
      <span>사장님이 고친 항목 {stats.correctedFields}개</span>
      {stats.accuracy !== null && <span>판독 일치율 {stats.accuracy}%</span>}
      {stats.reclassifiedDocuments > 0 && <span>분류 교정 {stats.reclassifiedDocuments}건</span>}
    </div>}
    <div className="locker-list">
      {shown.map((document) => <div className="locker-row" key={document.id}>
        <div>
          <b>{document.filename}</b>
          <small>
            {labelOf(document.sourceId)} · {document.status === 'confirmed' ? '확인 완료' : '확인 대기'}
            {document.rowCount ? ` · ${document.rowCount.toLocaleString('ko-KR')}행` : ''}
            {document.usedInApplicationIds.length ? ` · 신청 ${document.usedInApplicationIds.length}회 사용` : ''}
            {document.reclassified ? ' · 분류를 사장님이 고침' : ''}
          </small>
        </div>
        <button type="button" className="locker-remove" onClick={() => onRemove(document.id)} aria-label={`${document.filename} 문서함에서 지우기`}><Trash2 /></button>
      </div>)}
    </div>
    {documents.length > 4 && <button type="button" className="locker-more" onClick={() => setOpen(!open)}>
      {open ? '접기' : `나머지 ${documents.length - 4}건 더 보기`}
    </button>}
  </div>
}

/**
 * 자료가 없어도 업로드 흐름을 그대로 체험할 수 있게 만든 샘플 묶음.
 * 12개월치 가상 원자료가 서로 맞물려 있어서 교차검증 결과까지 확인할 수 있다.
 */
function SamplePack() {
  return <div className="sample-pack">
    <div className="sample-pack-head">
      <span><FolderDown /></span>
      <div>
        <b>준비된 자료가 없어도 괜찮아요 · 샘플 자료 한 번에 받기</b>
        <p>가상 식당 <em>샘플식당</em>의 12개월 원자료입니다. 내려받아 그대로 올려보면 형식 검사·열·행 확인과 AI 문서 판독까지 전부 체험할 수 있어요.</p>
      </div>
      <a className="button small" href="/samples/meoktu-sample-pack.zip" download><Download /> 전체 묶음 받기 (ZIP)</a>
    </div>
    <ul className="sample-pack-hint">
      <li><Check /> 1단계에는 <b>샘플식당 · 김소담 · 123-45-67891 · 서울특별시 마포구 망원동 12-3</b>을 그대로 입력하면 문서 판독값과 일치해요.</li>
      <li><Check /> 각 자료 카드의 <b>샘플 다운로드</b> 버튼으로 필요한 파일만 따로 받을 수도 있어요.</li>
      <li><Check /> 자료를 올린 뒤에는 <b>올린 자료 열어보기</b>로 내려받지 않고 그 자리에서 내용을 확인할 수 있어요.</li>
      <li><Check /> 문서 자료는 <b>PNG와 PDF</b>를 함께 제공하고, 모두 ‘실제 제출 불가’ 표시가 들어간 가상 문서입니다.</li>
    </ul>
  </div>
}

function DocumentUploadCard({ option, guide, fileName, metadata, classification, onChange, onOpen }: { option: UploadOption; guide?: DocumentGuide; fileName?: string; metadata?: DocumentMetadata; classification?: DocumentClassification; onChange: (event: ChangeEvent<HTMLInputElement>) => void; onOpen: () => void }) {
  const Icon = option.icon
  return <div className={`document-upload-card ${fileName ? 'uploaded' : ''}`}>
    <span className="document-icon"><Icon /></span>
    <div className="document-copy">
      {/* 요건은 서버가 내려준 값을 그대로 쓴다. 화면과 AI 상담이 다른 말을 하면 안 된다. */}
      {guide
        ? <div className="document-badges"><RequirementBadge requirement={guide.requirement} label={guide.requirementLabel} /><IssuanceHelp guide={guide} /></div>
        : <span className="optional">선택 제출</span>}
      <b>{option.title}</b><p>{guide?.exact || option.exact}</p><small>{option.columns}</small>{fileName && <strong><Check /> {fileName}{metadata?.rowCount ? ` · ${metadata.headers.length}열 ${metadata.rowCount}행` : ''}</strong>}
      {/* 자동으로 들어온 자료는 무엇을 보고 그렇게 판단했는지 밝힌다. */}
      {fileName && classification && <em className="document-classified">먹투가 자동으로 넣었어요 · {classification.reason}</em>}
      {fileName && <button type="button" className="doc-open-button" onClick={onOpen}><Eye /> 올린 자료 열어보기</button>}
      {option.sampleUrl && <a className="sample-download" href={option.sampleUrl} download><Download /> {option.sampleLabel} 다운로드</a>}{option.samplePdfUrl && <a className="sample-download" href={option.samplePdfUrl} download><Download /> PDF 샘플 다운로드</a>}{option.sampleAltUrl && <a className="sample-download" href={option.sampleAltUrl} download><Download /> {option.sampleAltLabel} 다운로드</a>}</div>
    <label className="document-action"><UploadCloud />{fileName ? '다시 선택' : '파일 선택'}<input type="file" name={`document-${option.id}`} accept={option.accept} onChange={onChange} /></label>
  </div>
}
