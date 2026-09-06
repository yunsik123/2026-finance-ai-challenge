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
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Banknote, Building2, Check, ChevronRight, Database, Download, Eraser, Eye,
  FileSpreadsheet, FileText, FolderDown, Landmark, Link2, LockKeyhole, PlugZap, ReceiptText,
  RotateCcw, ShieldCheck, Store, Trash2, TriangleAlert, UploadCloud, UserCheck, Users, X, type LucideIcon,
} from 'lucide-react'
import { api } from './lib/api.ts'
import { DocumentModal, LocalFileViewer, fileSizeLabel } from './DocumentViewer.tsx'
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
  /**
   * '데모자료 한번에 업로드'가 이 칸에 넣을 파일.
   *
   * 카드에 걸린 sampleUrl 과 일부러 다르게 둘 수 있다. 매출·계좌 같은 기간 자료는
   * 사장님이 보기엔 집계표 그림이 자연스럽지만, 서버가 숫자를 세어 자료끼리 대조하려면
   * 표(CSV) 본문이 있어야 한다. 그림만 넣으면 지표가 하나도 산정되지 않고
   * 결과 화면의 교차검증 카드가 통째로 비어버린다(실제로 그런 상태였다).
   */
  demoUrl?: string
  /** 같은 자료의 엑셀 판. 은행·세무 프로그램은 xlsx 로 내려주는 경우가 많다. */
  sampleAltUrl?: string
  sampleAltLabel?: string
}
const uploadOptions: UploadOption[] = [
  {
    id: 'business',
    icon: Building2,
    title: '사업자등록 자료',
    exact: '사업자등록증명 또는 사업자등록증 사본 1부',
    columns: '확인 항목: 상호, 대표자, 개업일, 사업장 주소, 업태·종목',
    accept: '.png,.jpg,.jpeg,.pdf',
    sampleUrl: '/meoktu_ocr_test_documents/actual_public_examples/01a_business_registration_actual_left.png',
    sampleLabel: '사업자등록증 PNG',
  },
  {
    id: 'license',
    icon: BadgeCheck,
    title: '영업신고 자료',
    exact: '일반·휴게음식점 영업신고증 사본 1부',
    columns: '확인 항목: 신고번호, 영업소 명칭·주소, 영업 종류, 대표자',
    accept: '.png,.jpg,.jpeg,.pdf',
    sampleUrl: '/meoktu_ocr_test_documents/actual_public_examples/02_food_business_license_actual_redacted.png',
    sampleLabel: '영업신고증 PNG',
  },
  {
    id: 'account',
    icon: Landmark,
    title: '사업용 계좌 내역',
    exact: '최근 12개월 사업용 계좌 거래내역서 또는 엑셀',
    columns: '확인 항목: 거래일시, 입금액, 출금액, 잔액 (은행 화면 캡처 또는 내역서)',
    accept: '.png,.jpg,.jpeg,.pdf,.csv,.xlsx',
    sampleUrl: '/meoktu_ocr_test_documents/variable_vendor_screens/07_bank_export_actual_screen.png',
    sampleLabel: '계좌내역 PNG',
    sampleAltUrl: '/samples/meoktu-account-sample.csv',
    sampleAltLabel: 'CSV 샘플',
    demoUrl: '/samples/meoktu-account-sample.csv',
  },
  {
    id: 'pos',
    icon: FileSpreadsheet,
    title: 'POS 매출 원자료',
    exact: '최근 12개월 POS 월별 매출 집계표 또는 주문 내역',
    columns: '확인 항목: 월별 매출액, 주문건수, 결제수단별 금액, 취소환불액',
    accept: '.png,.jpg,.jpeg,.pdf,.csv,.xlsx',
    sampleUrl: '/meoktu_ocr_test_documents/variable_vendor_screens/06_pos_actual_screen.png',
    demoUrl: '/samples/meoktu-pos-sample.csv',
    sampleLabel: '집계표 PNG',
    sampleAltUrl: '/samples/meoktu-pos-sample.csv',
    sampleAltLabel: 'CSV 샘플',
  },
  {
    id: 'card',
    icon: ReceiptText,
    title: '카드 매출·정산',
    exact: '최근 12개월 카드·VAN 정산 내역서',
    columns: '확인 항목: 승인건수, 승인금액, 수수료, 실입금액',
    accept: '.png,.jpg,.jpeg,.pdf,.csv,.xlsx',
    sampleUrl: '/meoktu_ocr_test_documents/variable_vendor_screens/08_card_settlement_actual_screen.png',
    demoUrl: '/samples/meoktu-card-settlement-sample.csv',
    sampleLabel: '정산표 PNG',
    sampleAltUrl: '/samples/meoktu-card-settlement-sample.csv',
    sampleAltLabel: 'CSV 샘플',
  },
  {
    id: 'delivery',
    icon: Link2,
    title: '배달 플랫폼 정산',
    exact: '최근 12개월 배달앱 월별 정산 내역서',
    columns: '확인 항목: 배달 주문금액, 중개수수료, 정산입금액, 주문건수',
    accept: '.png,.jpg,.jpeg,.pdf,.csv,.xlsx',
    sampleUrl: '/meoktu_ocr_test_documents/variable_vendor_screens/09_delivery_settlement_reference.png',
    demoUrl: '/samples/meoktu-delivery-sample.csv',
    sampleLabel: '정산표 PNG',
    sampleAltUrl: '/samples/meoktu-delivery-sample.csv',
    sampleAltLabel: 'CSV 샘플',
  },
  {
    id: 'tax',
    icon: Database,
    title: '납세 자료',
    exact: '최근 2개 과세기간 부가세 신고서 또는 과세표준증명원',
    columns: '확인 항목: 과세기간, 과세표준(매출액), 납세 상태',
    accept: '.png,.jpg,.jpeg,.pdf',
    sampleUrl: '/meoktu_ocr_test_documents/official_forms_pdf/03_vat_tax_base_official-1.png',
    sampleLabel: '과세표준증명 PNG',
  },
  {
    id: 'customer',
    icon: Users,
    title: '고객 방문 자료',
    exact: '가명처리된 고객 방문 이력 CSV 1개',
    columns: '필요한 열: 고객해시, 첫방문일, 방문횟수',
    accept: '.csv,.xlsx',
    sampleUrl: '/samples/meoktu-customer-sample.csv',
    sampleLabel: 'CSV 샘플',
  },
  {
    id: 'lease',
    icon: Building2,
    title: '임대차 자료',
    exact: '상가 임대차계약서 사본 1부 또는 요약본',
    columns: '확인 항목: 보증금, 월 임차료(월세), 계약기간, 소재지 주소',
    accept: '.png,.jpg,.jpeg,.pdf,.csv',
    sampleUrl: '/meoktu_ocr_test_documents/official_forms_pdf/05_commercial_lease_official_reference-1.png',
    sampleLabel: '임대차계약서 PNG',
  },
  {
    id: 'debt',
    icon: Banknote,
    title: '부채·상환 자료',
    exact: '금융기관 대출 잔액·상환 내역서 (Debt Schedule)',
    columns: '확인 항목: 대출기관, 대출잔액, 이자율, 월 원리금 상환액, 만기일',
    accept: '.png,.jpg,.jpeg,.pdf,.csv,.xlsx',
    sampleUrl: '/samples/08_debt_schedule.png',
    demoUrl: '/samples/meoktu-debt-sample.csv',
    sampleLabel: '부채현황 PNG',
    sampleAltUrl: '/samples/meoktu-debt-sample.csv',
    sampleAltLabel: 'CSV 샘플',
  },
  {
    id: 'staff',
    icon: Users,
    title: '인력·급여 자료',
    exact: '최근 12개월 급여대장 사본 1부',
    columns: '확인 항목: 직원수, 기본급, 지급총액, 공제내역, 실지급액',
    accept: '.png,.jpg,.jpeg,.pdf,.csv,.xlsx',
    sampleUrl: '/samples/10_payroll_ledger.png',
    demoUrl: '/samples/meoktu-staff-sample.csv',
    sampleLabel: '급여대장 PNG',
    sampleAltUrl: '/samples/meoktu-staff-sample.csv',
    sampleAltLabel: 'CSV 샘플',
  },
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
 * public/samples 의 가상 원자료(OCR 테스트용 합성 서류)와 값이 맞물리는 '먹투 테스트식당' 프로필.
 * 문서 판독값과 신고값이 같아야 교차검증 결과를 그대로 볼 수 있어서, 여기 적힌 값이
 * 곧 합성 서류에 인쇄된 값이다.
 *
 * 단계별로 따로 나눠 둔 이유가 있다. 데모 채우기 버튼은 각 단계 화면에 하나씩 있고,
 * 그 버튼은 자기 화면에 있는 칸만 채운다. 한 버튼이 세 화면을 다 채워버리면
 * 사장님은 자기가 무엇을 확인해야 하는지 모른 채 마지막 화면까지 떠밀려 간다.
 */
/** 1단계(가게 정보) 화면의 칸. */
const storeSampleFields: Record<string, string> = {
  restaurantName: '먹투 테스트식당',
  category: '한식',
  signature: '들기름 고등어 한상',
  avgPrice: '13000',
  ownerName: '김테스트',
  businessNumber: '123-45-67891',
  licenseNumber: '제2026-테스트-0001호',
  address: '서울특별시 마포구 테스트로 123, 1층',
}
/** 1단계의 대표자·지분 표. 대표자명은 위 프로필과 같아야 판독값과 어긋나지 않는다. */
const sampleOwnership: OwnershipRow[] = [{ name: storeSampleFields.ownerName, share: 100, role: '대표자' }]
/** 3단계(동의와 계획) 화면의 칸. 합계는 아래 sampleFundUsePlan 과 반드시 같아야 한다. */
const planSampleFields: Record<string, string> = {
  requestedLimit: '30000000',
  fundingPeriodMonths: '18',
  ownCapital: '10000000',
  maxDiscount: '40',
  fundPurpose: '저온 저장고 교체 1,800만원 / 주방 동선 개선 1,200만원',
  businessPlan: '마포구 테스트로 골목 상권에서 12개월 연속 재방문 고객이 늘고 있습니다. 저장·조리 설비를 바꿔 품절과 대기시간을 줄이고 점심 회전율을 높이려 합니다.',
  expectedEffect: '좌석 24석 → 38석, 점심 회전율 2.1회 → 2.8회, 재료 품절로 인한 판매 손실 월 180만원 감소',
}
/** 3단계 자금 사용계획. 합계 3,000만원 = planSampleFields.requestedLimit. 어긋나면 다음으로 못 넘어간다. */
const sampleFundUsePlan: FundUseItem[] = [
  { category: '주방설비', amount: 18000000, note: '저온 저장고 1대 교체' },
  { category: '인테리어', amount: 12000000, note: '주방 동선 개선 공사' },
]
/**
 * 2단계 부채 신고값.
 * 데모 부채 자료(meoktu-debt-sample.csv)의 최근월과 정확히 같게 둔다.
 * 어긋나면 결과 화면에서 '신고 대출잔액과 자료가 다르다'는 불일치로 잡힌다.
 */
const sampleDeclaredDebt: DeclaredDebt = {
  hasDebt: true, answered: true,
  loans: [
    { lender: '한빛은행', balance: 27600000, rate: 5.4, monthlyPayment: 780000, maturity: '2029-04' },
    { lender: '소상공인시장진흥공단', balance: 20400000, rate: 2.9, monthlyPayment: 370000, maturity: '2029-04' },
  ],
}

/**
 * 샘플 두 갈래.
 *
 * clean 은 서로 완벽하게 맞는 11종이다. 승인까지 그대로 흐른다.
 * rough 는 같은 사업체의 같은 원장이지만 POS 는 8개월치만, 계좌에는 대출 입금이 섞이고,
 * 카드는 12개월 전체다. 실제로 사장님이 주는 자료가 이렇게 어긋나 있다.
 * 이 세트를 넣으면 매출↔계좌·매출↔카드 대조에서 불일치가 잡히고 수동 심사로 넘어간다.
 * 데모에서 보여줘야 할 장면은 완벽한 통과가 아니라 이쪽이다.
 */
type SampleSet = { id: 'clean' | 'rough'; label: string; description: string; overrides?: Record<string, string> }
const sampleSets: SampleSet[] = [
  { id: 'clean', label: '데모자료 한번에 업로드하기', description: '가상 서류와 매출·계좌 표 자료를 업로드 과정에 맞게 구성한 예시 자료입니다.' },
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
  { id: 'upload', slug: 'upload', title: '자료 올리기', hint: '필수 자료와 선택 자료를 구분해 안내해드려요.' },
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
/**
 * 사업자등록번호 검사. 서버 verifyBusiness 와 같은 규칙을 화면에서 먼저 돌린다.
 *
 * 서버는 자리수와 국세청 검증번호를 모두 보고 안 맞으면 접수를 400 으로 막는다.
 * 그런데 화면은 아무 말도 하지 않아서, 마지막 '자동분석 시작'을 누른 뒤에야
 * 두 화면 앞에서 잘못 적은 번호 때문에 막혔다는 걸 알게 됐다. 같은 검사를 여기서 먼저 한다.
 */
const businessNumberDigits = (value: string) => value.replace(/\D/g, '')
/** 국세청 사업자등록번호 검증번호 규칙. server/verification.ts 와 같은 계산이다. */
const businessNumberChecksum = (number: string) => {
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  const digits = [...number].map(Number)
  let sum = digits.slice(0, 9).reduce((total, digit, index) => total + digit * weights[index], 0)
  sum += Math.floor((digits[8] * 5) / 10)
  return (10 - (sum % 10)) % 10 === digits[9]
}
const businessNumberValid = (value: string) => {
  const digits = businessNumberDigits(value)
  return digits.length === 10 && businessNumberChecksum(digits)
}
/**
 * 영업신고번호.
 *
 * 처음에는 숫자만 받았다. 그런데 meoktu_ocr_test_documents 의 실제 영업신고증 공개본을 보면
 * 신고번호는 '제 2024-0123 호', '제 2022-마포-0451 호'처럼 연도·관할구청명·일련번호가
 * 섞인 형태로 발급된다. 숫자만 받으면 사장님이 서류에 적힌 번호를 그대로 못 넣는다.
 *
 * 그래서 '숫자여야 한다'는 요구는 이렇게 지킨다.
 *   · 서식 글자(제·호)와 공백은 떼고 본다.
 *   · 남은 것은 숫자·하이픈·관할구청 이름(한글)만 허용한다.
 *   · 연도나 일련번호에 해당하는 4자리 이상 숫자가 반드시 있어야 한다.
 * 이러면 '신고번호 입력' 같은 글자나 아무 말이나 적은 값은 그대로 걸린다.
 */
const licenseNumberCore = (value: string) => value.trim().replace(/^제\s*/, '').replace(/\s*호$/, '').trim()
const licenseNumberValid = (value: string) => {
  const core = licenseNumberCore(value)
  if (!core) return false
  if (!/^[\d가-힣\s-]+$/.test(core)) return false
  return /\d{4,}/.test(core.replace(/-/g, ' '))
}

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
  const [classifications, setClassifications] = useState<Record<string, DocumentClassification>>({})
  const [documentRecords, setDocumentRecords] = useState<Record<string, OwnerDocument>>({})
  const [identityVerified, setIdentityVerified] = useState(false)
  const [result, setResult] = useState<ApplicationResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fillingSample, setFillingSample] = useState('')
  /** 지금 살펴보는 중인 파일 이름. 목록 대신 한 줄로만 보여준다. */
  const [intakeNote, setIntakeNote] = useState('')
  const [intakeBusy, setIntakeBusy] = useState(false)
  /** 제휴기관 연결 동의서를 띄운 출처 id. 동의 없이 바로 연결되지 않게 한 단계 둔다. */
  const [consentPartner, setConsentPartner] = useState('')
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
  const groupOrder = ['사업체 확인', '현금흐름 확인', '매출 확인', '추가 자료']
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

  /**
   * 입력 중에 바로 보여주는 형식 오류.
   * 비어 있을 때는 아무 말도 하지 않는다. 아직 안 쓴 칸에 빨간 글씨를 띄우면 겁부터 먹는다.
   */
  const businessNumberError = !fields.businessNumber.trim() || businessNumberValid(fields.businessNumber) ? ''
    : businessNumberDigits(fields.businessNumber).length !== 10
      ? `사업자등록번호 형식이 맞지 않아요. 000-00-00000 처럼 숫자 10자리로 넣어주세요. (지금 숫자 ${businessNumberDigits(fields.businessNumber).length}자리)`
      : '숫자 10자리는 맞지만 국세청 검증번호가 맞지 않아요. 사업자등록증의 번호를 다시 확인해주세요.'
  const licenseNumberError = fields.licenseNumber.trim() && !licenseNumberValid(fields.licenseNumber)
    ? '영업신고번호를 신고증에 적힌 대로 넣어주세요. 연도와 일련번호(4자리 이상 숫자)가 들어가야 합니다. (예: 제 2024-0123 호)'
    : ''

  const resetApplication = () => {
    setOpenedDocument('')
    setUploadedFiles({})
    filesRef.current = {}
    setSelectedFiles({})
    setDocumentMetadata({})
    setClassifications({})
    setDocumentRecords({})
    setIntakeNote('')
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
    if (index === 0) {
      return storeFieldRules.every(([name]) => fields[name]?.trim()) && identityVerified
        && businessNumberValid(fields.businessNumber) && licenseNumberValid(fields.licenseNumber)
    }
    if (index === 1) {
      return missingRequired.length === 0 && !salesEvidenceMissing && declaredDebt.answered
        && (!declaredDebt.hasDebt || declaredDebt.loans.some((loan) => loan.lender.trim() || loan.balance > 0))
    }
    if (index === 2) {
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
      if (!businessNumberValid(fields.businessNumber)) {
        notify(businessNumberDigits(fields.businessNumber).length === 10
          ? '사업자등록번호 검증번호가 맞지 않아요. 사업자등록증의 번호를 다시 확인해주세요.'
          : '사업자등록번호 형식이 맞지 않아요. 000-00-00000 처럼 숫자 10자리로 입력해주세요.')
        focusField('businessNumber')
        return false
      }
      if (!licenseNumberValid(fields.licenseNumber)) {
        notify('영업신고번호를 신고증에 적힌 대로 입력해주세요. 연도와 일련번호(4자리 이상 숫자)가 들어가야 합니다. (예: 제 2024-0123 호)')
        focusField('licenseNumber')
        return false
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
    fundUseTotal, allConsentsAgreed])

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
   *
   * 처리 결과를 줄줄이 나열하지 않고 어느 칸에 들어갔는지는 아래 'B. 자료 업로드'에서
   * 바로 보여준다. 진행 중인 파일 한 줄과 실패 알림만 남긴다.
   */
  const intakeFiles = async (files: File[]) => {
    if (!owner) { onLogin(); return }
    if (intakeBusy) return
    setIntakeBusy(true)
    const accepted = files.slice(0, 12)
    let placed = 0
    for (const original of accepted) {
      const note = (message: string) => setIntakeNote(`${original.name} · ${message}`)
      try {
        note('살펴보는 중이에요...')
        if (original.size > 20 * 1024 * 1024) throw new Error('20MB 이하 파일만 올릴 수 있어요.')
        const kind = kindOf(original)
        if (kind === 'unknown') throw new Error('사진·PDF·엑셀·CSV 파일만 읽을 수 있어요.')

        let working = original
        if (kind === 'sheet') {
          note('엑셀을 표로 바꾸는 중이에요...')
          const { csv } = await sheetToCsv(original)
          if (!csv.trim()) throw new Error('엑셀에서 읽을 내용을 찾지 못했어요.')
          working = new File([csv], `${original.name.replace(/\.(xlsx|xlsm)$/i, '')}.csv`, { type: 'text/csv' })
        }

        if (kind === 'csv' || kind === 'sheet') {
          const shape = csvShape(await working.text())
          note(`열 ${shape.headers.length}개를 보고 무엇인지 확인하는 중이에요...`)
          const { classification } = await api<{ classification: DocumentClassification }>('/api/documents/classify', {
            method: 'POST',
            body: JSON.stringify({ filename: working.name, headers: shape.headers, tabular: true }),
          })
          if (classification.sourceId === 'other') {
            notify(`${working.name}: ${classification.reason} 아래 자료 칸에서 직접 골라 넣어주세요.`)
            continue
          }
          const metadata = await placeFile(classification.sourceId, working)
          setClassifications((current) => ({ ...current, [classification.sourceId]: classification }))
          void registerDocument({ file: working, sourceId: classification.sourceId, metadata })
          placed += 1
          continue
        }

        // 사진과 PDF 는 판독을 거쳐야 무엇인지 알 수 있다.
        note(kind === 'pdf' ? 'PDF 첫 장을 그림으로 바꾸는 중이에요...' : '사진을 읽는 중이에요...')
        const dataUrl = kind === 'pdf' ? (await pdfFirstPageToPng(original)).dataUrl : await readAsDataUrl(original)
        const estimatedMb = (dataUrl.length * .75) / 1024 / 1024
        if (estimatedMb > UPLOAD_MB) throw new Error(`판독할 그림이 ${UPLOAD_MB}MB를 넘어요. 더 작은 파일로 올려주세요.`)
        note('서류 종류를 확인하는 중이에요...')
        const response = await api<{ analysis: OcrAnalysis; classification: DocumentClassification; fields: DocumentField[] }>('/api/ai/ocr', {
          method: 'POST',
          body: JSON.stringify({ image: dataUrl, filename: original.name, sourceId: 'auto', plan: '펀딩 신청 원천자료 사전검증' }),
        })
        const resolved = response.analysis.sourceId && response.analysis.sourceId !== 'other'
          ? response.analysis.sourceId : response.classification.sourceId
        if (!resolved || resolved === 'other') {
          notify(`${original.name}: ${response.classification.reason} 아래 자료 칸에서 직접 골라 넣어주세요.`)
          continue
        }
        const metadata = await placeFile(resolved, original)
        setClassifications((current) => ({ ...current, [resolved]: response.classification }))
        void registerDocument({
          file: original, sourceId: resolved, metadata,
          documentType: String((response.analysis.result as Record<string, unknown>)?.documentType || ''),
          ocrAnalysisId: response.analysis.id, fields: response.fields,
        })
        placed += 1
      } catch (error) {
        // 실패는 목록이 없어졌으니 알림으로 알린다. 조용히 사라지면 안 된다.
        notify(`${original.name}: ${(error as Error).message}`)
      }
    }
    setIntakeNote('')
    setIntakeBusy(false)
    if (placed) notify(`${placed}개 자료를 알맞은 칸에 넣었어요. 아래에서 어느 칸에 들어갔는지 확인해주세요.`)
    await refresh().catch(() => undefined)
    api<any>('/api/owner').then((data) => setOwnerData(data)).catch(() => undefined)
  }

  const clearSlot = (sourceId: string) => {
    filesRef.current = { ...filesRef.current }
    delete filesRef.current[sourceId]
    setSelectedFiles((current) => { const next = { ...current }; delete next[sourceId]; return next })
    setUploadedFiles((current) => { const next = { ...current }; delete next[sourceId]; return next })
    setDocumentMetadata((current) => { const next = { ...current }; delete next[sourceId]; return next })
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
   * 1단계 화면만 데모 값으로 채운다.
   *
   * 예전에는 데모 채우기 버튼이 2단계에만 있었다. 그런데 2단계로 넘어가려면
   * 1단계를 먼저 끝내야 한다(firstIncompleteStep). 대표자 본인인증까지 손으로 마친
   * 사람만 데모 버튼을 만날 수 있었다는 뜻이다. 순서가 거꾸로였다.
   * 그래서 1단계에도 버튼을 두고, 여기서 본인인증까지 함께 끝낸다.
   *
   * 자료 업로드와 자금 계획은 손대지 않는다. 각 화면의 버튼이 자기 몫만 채운다.
   */
  const fillStoreDemo = () => {
    setFields((current) => ({ ...current, ...storeSampleFields }))
    setIdentityVerified(true)
    setOwnership(sampleOwnership.map((row) => ({ ...row })))
    notify('가게 정보와 대표자 본인인증을 데모 값으로 채웠어요.')
  }

  /**
   * 3단계 화면만 데모 값으로 채운다.
   *
   * 필수 고지 동의는 채우지 않는다. 사장님이 전문을 펼쳐 직접 확인해야 하는 항목이고,
   * 그걸 버튼 한 번으로 넘기면 데모가 실제 서비스에서 그대로 문제가 되는 흐름을 가르치게 된다.
   */
  const fillPlanDemo = () => {
    setFields((current) => ({ ...current, ...planSampleFields }))
    setFundUsePlan(sampleFundUsePlan.map((item) => ({ ...item })))
    notify('희망 펀딩액과 자금 사용계획을 데모 값으로 채웠어요. 필수 고지 동의는 직접 확인해주세요.')
  }

  /**
   * 2단계 화면만 데모 자료로 채운다. 세트를 골라 채운다.
   *
   * 자료 칸과 부채 신고까지만 손댄다. 1단계(가게 정보·본인인증)와
   * 3단계(자금 계획)는 각 화면의 버튼이 따로 채운다.
   */
  const fillWithSamples = async (set: SampleSet) => {
    if (!owner) return
    const options = uploadOptions.filter((option) => option.demoUrl || option.sampleUrl)
    setFillingSample(set.id)
    try {
      // 표 자료는 CSV(demoUrl), 서류는 합성 PNG(sampleUrl)로 준비한다.
      const urls = options.map((option) => set.overrides?.[option.id] || option.demoUrl || (option.sampleUrl as string))
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
      // 부채 신고는 이 화면(2단계) 안에 있는 칸이라 여기서 함께 채운다.
      setDeclaredDebt({ ...sampleDeclaredDebt, loans: sampleDeclaredDebt.loans.map((loan) => ({ ...loan })) })
      const rows = metadataList.reduce((sum, item) => sum + item.rowCount, 0)
      notify(set.id === 'rough'
        ? `연습용 샘플 ${files.length}종을 올렸어요. 표 자료 ${rows.toLocaleString('ko-KR')}행을 확인했고 부채 신고란도 함께 채웠습니다.`
        : `데모 자료 ${files.length}종을 올렸어요. 매출·계좌 표 자료 ${rows.toLocaleString('ko-KR')}행을 확인했고 부채 신고란도 함께 채웠습니다.`)
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
    setIntakeNote('')
    for (const option of uploadOptions) {
      const field = document.querySelector<HTMLInputElement>(`input[name="document-${option.id}"]`)
      if (field) field.value = ''
    }
    notify('업로드한 자료를 모두 비웠어요.')
  }

  /** 동의서를 읽고 확인한 뒤에만 불린다. 서버도 consent:true 없이는 연결을 거절한다. */
  const connectPartner = async (sourceId: string) => {
    try {
      const response = await api<{ message: string }>(`/api/data-connections/${sourceId}`, { method: 'POST', body: JSON.stringify({ consent: true }) })
      notify(response.message)
      setConsentPartner('')
      setOwnerData(await api<any>('/api/owner'))
      await refresh()
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
      <div><span className="eyebrow light"><Store /> 먹투 사장님 센터</span><h1>가지고 계신 자료를<br /><em>그냥 올려주세요.</em></h1><p>재무제표를 새로 만들 필요 없어요. 사진·PDF·엑셀·CSV 무엇이든 올리면 먹투가 자료를 알맞은 항목으로 분류하고 평가에 필요한 정보를 정리합니다.</p><div className="owner-values"><span><Check /> 신청비 0원</span><span><Check /> 양식 작성 없음</span><span><Check /> 사진·PDF·엑셀 가능</span><span><Check /> 자동 분류</span><span><Check /> 자료 근거 제공</span><span><Check /> 부족한 자료는 미산정</span></div></div>
      <div className="review-flow data-flow"><b>펀딩 등록 흐름</b>{['가게 정보 확인', '자료 올리기 · 자동 분류', '동의와 자금 계획', '35지표 성장성 예비평가', '운영자 확인 후 펀딩 등록'].map((title, index) => <div key={title}><span>{index + 1}</span><p>{title}</p><Check /></div>)}</div>
    </section>

    <div className="owner-page-body">
      {owner && !result && <section className="owner-funding-status">
        <div className="owner-status-head">
          <div><span className="eyebrow coral"><Store /> 펀딩 등록</span><h2>자료를 올리면 먹투가 정리합니다</h2><p>이 화면에서는 신규 펀딩 신청과 심사 자료 제출만 진행합니다. 등록 후 펀드 현황과 운영 기능은 마이페이지에서 확인할 수 있어요.</p></div>
          <NavLink className="button secondary" to="/owner/my">마이페이지 <ChevronRight /></NavLink>
        </div>
      </section>}
      {demoMode && <section className="demo-mode-banner"><ShieldCheck /><div><b>사장님 체험 모드 · 저장되지 않아요</b><p>자료 업로드, 자동 분류, 심사 접수, 성장성 예비평가 확인까지 실제와 똑같이 눌러볼 수 있어요. 이 체험 기록은 다른 사용자에게 보이지 않고 브라우저를 닫으면 사라집니다.</p></div></section>}

      {showingResult && result ? <section className="source-review-result">
        <div className="result-heading">
          <span className={`result-badge ${result.status}`}>{result.status === 'approved' ? '펀딩 가능' : result.status === 'conditional' ? '조건부 승인' : result.status === 'manual_review' ? '운영자 확인 필요' : '보완 필요'}</span>
          <h2>먹투 성장성 예비평가 결과</h2>
          <p>{result.restaurantName} · 운영자 최종 검토 전 예비평가입니다.</p>
        </div>
        <div className={`result-score-primary ${result.status}`}>
          <div><span>먹투 성장성 예비평가</span><strong>{result.score}<small>/100</small></strong><p>{result.explanation}</p></div>
          <aside><span>AI 제안 한도</span><b>{won(result.approvedLimit)}</b>{result.requestedLimit ? <small>희망 펀딩액 {won(result.requestedLimit)}</small> : null}</aside>
        </div>
        {result.data?.creditAssessment && <CreditGradePanel credit={result.data.creditAssessment} combined={result.data.combinedAssessment} />}

        <div className="result-support-heading"><div><span>상세 자료</span><h3>자료 근거와 데이터 신뢰도</h3><p>아래 내용은 위 예비평가 점수를 구성한 제출 자료와 산정 근거입니다.</p></div><strong>{confidence}%<small>데이터 신뢰도</small></strong></div>
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

        <VerificationReport business={result.data?.businessVerification} />
        <div className="result-columns"><section><h3>확인된 강점</h3>{result.strengths.map((item) => <p key={item}><Check /> {item}</p>)}</section><section><h3>보강하면 좋은 자료</h3>{result.improvements.map((item) => <p key={item}>{item}</p>)}</section></div>
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

          {/* 업로드 비우기는 올린 자료가 있을 때만.
              데모 채우기 버튼은 단계마다 그 화면 안에 하나씩 둔다(StepDemoFill·SamplePack). */}
          {owner && uploadedCount > 0 && <div className="sample-sets">
            <button type="button" className="sample-clear" disabled={Boolean(fillingSample)} onClick={clearUploads}><Eraser /> 업로드 비우기</button>
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
              {/* 이 화면 칸과 대표자 본인인증까지만 채운다. 자료 업로드는 다음 화면 버튼이 맡는다. */}
              <StepDemoFill
                label="가게 정보·대표자확인 데모로 채우기"
                busy={Boolean(fillingSample)}
                onFill={fillStoreDemo}
              />

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
                {/* 이 칸들은 이 화면 맨 위의 '가게 정보·대표자확인 데모로 채우기'가 채운다. */}
                <div className="form-section-title"><span>1</span><div><h3>사업체 기본정보와 대표자 확인</h3><p>상권 자료는 주소를 기준으로 먹투가 직접 수집합니다.</p></div></div>
                <div className="field-grid">
                  <label className="field"><span>상호명</span><input name="restaurantName" placeholder="예: 소복소복" value={fields.restaurantName} onChange={setField('restaurantName')} /></label>
                  <label className="field"><span>대표자명</span><input name="ownerName" placeholder="사업자등록증과 동일하게" value={fields.ownerName} onChange={setField('ownerName')} /></label>
                  <label className="field"><span>업종</span><select name="category" value={fields.category} onChange={setField('category')}><option>한식</option><option>중식</option><option>일식</option><option>양식</option><option>카페·베이커리</option><option>분식</option><option>주점</option><option>기타</option></select></label>
                  <label className="field"><span>대표 메뉴</span><input name="signature" placeholder="예: 들기름 고등어 한상" value={fields.signature} onChange={setField('signature')} /></label>
                  <label className="field"><span>평균 식사 가격</span><div className="number-field"><input type="number" name="avgPrice" min={1000} step={1000} value={fields.avgPrice} onChange={setField('avgPrice')} /><span>원</span></div></label>
                  <label className={`field ${businessNumberError ? 'invalid' : ''}`}><span>사업자등록번호</span><input name="businessNumber" inputMode="numeric" placeholder="000-00-00000" value={fields.businessNumber} onChange={setField('businessNumber')} />{businessNumberError && <em className="field-error"><TriangleAlert /> {businessNumberError}</em>}</label>
                  <label className={`field ${licenseNumberError ? 'invalid' : ''}`}><span>영업신고번호</span><input name="licenseNumber" inputMode="numeric" placeholder="신고증에 적힌 대로 (예: 제 2024-0123 호)" value={fields.licenseNumber} onChange={setField('licenseNumber')} />{licenseNumberError && <em className="field-error"><TriangleAlert /> {licenseNumberError}</em>}</label>
                  <label className="field full-field"><span>사업장 주소</span><input name="address" placeholder="상권·경쟁·생활인구 분석에 사용됩니다." value={fields.address} onChange={setField('address')} /></label>
                </div>
                <button type="button" className={`identity-action ${identityVerified ? 'verified' : ''}`} onClick={() => setIdentityVerified(true)}><UserCheck />{identityVerified ? '대표자 본인인증 완료' : '휴대전화로 대표자 본인인증'}<span>{identityVerified ? '신청자와 대표자 일치 여부를 확인했습니다.' : 'MVP에서는 버튼을 누르면 시연용 인증이 완료됩니다.'}</span></button>
                <OwnershipEditor rows={ownership} onChange={setOwnership} />
              </div>
            </section>}

            {/* ── 2단계 · 자료 올리기 ───────────────────────── */}
            {step === 1 && <section className={`wizard-step active ${direction === 'back' ? 'back' : ''}`}>
              <DocumentPreparationGuide />
              {/* 준비된 자료가 없는 사람이 가장 먼저 만나야 하는 버튼이라 맨 위에 둔다.
                  예전에는 화면 맨 아래에 있어서, 올릴 자료가 없는 사람은 스크롤을 다 내려야 발견했다. */}
              <SamplePack
                busy={Boolean(fillingSample)}
                onLoadDemo={() => void fillWithSamples(sampleSets[0])}
              />

              <UniversalIntake
                dragging={dragging} busy={intakeBusy} note={intakeNote}
                onDragState={setDragging}
                onFiles={(files) => void intakeFiles(files)}
              />

              <div className="form-section evidence-source-section">
                <div className="form-section-title"><span>2</span><div><h3>자료가 어느 칸에 들어갔는지 확인해주세요</h3><p>기관에서 동의 기반으로 전송받은 자료와 사장님이 직접 올린 파일을 원장에 서로 다른 출처로 남깁니다.</p></div></div>
                <div className="source-progress"><div><b>{evidenceCount}개</b><span>확보 자료</span></div><div className="progress-track"><i style={{ width: `${Math.min(100, evidenceCount / uploadOptions.length * 100)}%` }} /></div><small>필수: 사업자등록·영업신고 + POS·사업계좌(기관 연결 또는 직접 업로드)</small></div>
                {missingRequired.length > 0 && <p className="wizard-missing"><TriangleAlert /> 아직 없는 필수 자료: {missingRequired.map((source) => labelOf(source)).join(', ')}</p>}

                {/* 기관 연결은 동의서를 읽고 나서만 이뤄진다. 신용정보 제공 동의를 버튼 한 번으로
                    끝내면 실제 서비스에서 그대로 문제가 된다. */}
                <div className="evidence-lane partner-lane"><div className="evidence-lane-heading"><PlugZap /><div><b>A. 제휴기관·마이데이터형 연결</b><p>동의 범위·제공기관·동기화 시각이 함께 기록됩니다. ‘동의하고 연결’을 누르면 조회 범위와 보유기간이 적힌 동의서를 먼저 보여드립니다. 현재 버튼은 실제 기관 API 대신 시연 어댑터를 사용합니다.</p></div></div><div className="partner-connection-grid">{partnerOptions.map((option) => { const Icon = option.icon; const connection = activeConnections.find((item: any) => item.sourceId === option.id); return <article className={connection ? 'connected' : ''} key={option.id}><Icon /><div><b>{option.title}</b><span>{option.provider}</span><small>{option.scope}</small>{connection && <em><Check /> {connection.recordCount.toLocaleString()}건 · {new Date(connection.lastSyncedAt).toLocaleDateString('ko-KR')}</em>}</div><button type="button" disabled={Boolean(connection)} onClick={() => setConsentPartner(option.id)}>{connection ? '연결됨' : '동의하고 연결'}</button></article> })}</div></div>

                <div className="evidence-lane upload-lane">
                <div className="evidence-lane-heading"><UploadCloud /><div><b>B. 자료 업로드</b><p>위에서 올린 파일이 여기에 자동으로 들어갑니다. 비어 있는 칸은 직접 골라 넣어도 됩니다. 엑셀은 표로 바꿔서 넣습니다.</p></div></div>
                {/* 요건 묶음으로 나눠 보여준다. 무엇이 필수이고 무엇이 택1인지가 카드 옆에 그대로 붙는다. */}
                {groupedOptions.map(({ group, options: groupOptions }) => {
                  const options = group === '추가 자료' ? [...groupOptions, ...unplacedOptions] : groupOptions
                  return <div className="document-group" key={group}>
                  <div className="document-group-head">
                    <h4>{group}</h4>
                    <small>{group === '사업체 확인' ? '두 가지 모두 필요해요'
                      : group === '현금흐름 확인' ? '반드시 필요해요'
                        : group === '매출 확인' ? '아래 중 하나 이상만 있으면 됩니다'
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
                      partnerConnected={connectedIds.has(option.id)}
                    />)}
                  </div>
                </div>
                })}

                {uploadedCount > 0 && <p className={`upload-ready-summary ${missingRequired.length === 0 && !salesEvidenceMissing ? 'complete' : ''}`}>
                  {missingRequired.length === 0 && !salesEvidenceMissing ? <Check /> : <TriangleAlert />}
                  {missingRequired.length === 0 && !salesEvidenceMissing
                    ? '필수 자료가 모두 확보되었습니다. 아래 부채 확인을 마치면 다음 단계로 진행할 수 있어요.'
                    : `현재 ${uploadedCount}개 자료가 등록되었습니다. 위 안내를 참고해 필수 자료를 더 채워주세요.`}
                </p>}
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
                <p className="mvp-source-note">MVP는 직접 업로드 파일의 이름·크기·형식과 CSV 열·행 수를 확인해 심사 출처로 기록합니다. 사진·PDF 원본은 저장하지 않습니다. 실제 기관 연결은 현재 모의 어댑터이고, 운영 전 기관 OAuth·전자서명·암호화 보관으로 교체해야 합니다.</p>
              </div>
            </section>}

            {/* ── 3단계 · 동의와 계획 ──────────────────────── */}
            {step === 2 && <section className={`wizard-step active ${direction === 'back' ? 'back' : ''}`}>
              {/* 자금 계획 칸만 채운다. 필수 고지 동의는 전문을 펼쳐 직접 확인해야 해서 건드리지 않는다. */}
              <StepDemoFill
                label="자금계획 데모로 채우기"
                busy={Boolean(fillingSample)}
                onFill={fillPlanDemo}
              />

              <div className="form-section legal-consent-section">
                <div className="form-section-title"><span>3</span><div><h3>분석에 꼭 필요한 동의만 확인</h3><p>마케팅·광고 동의는 받지 않습니다. ‘전문 보기’를 누르면 수집 항목·목적·보유기간과 이의제기 절차가 펼쳐지고, 그 전문 맨 아래에서 동의할 수 있습니다.</p></div></div>
                <div className="consent-progress"><b>{consentDocuments.filter((document) => agreedDocuments.includes(document.id)).length}/{consentDocuments.length}</b><span>필수 고지 동의 완료</span><small>각 항목의 전문을 펼치면 맨 아래에서 동의할 수 있어요.</small></div>
                {consentDocuments.map((document) => <LegalConsentReader key={`${legal?.version}:${document.id}`} documentId={document.id} title={document.title} summary={document.summary} agreed={agreedDocuments.includes(document.id)} onToggle={() => toggleConsent(document.id)} />)}
                {!consentDocuments.length && <p className="legal-loading">필수 고지사항을 불러오는 중이에요.</p>}
                <div className="automated-analysis-note"><ShieldCheck /><p><b>자동분석 안내</b> 먹투 모델은 예비 점수와 설명을 만들지만 자동으로 최종 거절하지 않습니다. 자료 부족·불일치는 수동 심사로 보내며, 사장님은 결과 설명과 재검토를 요청할 수 있습니다.</p></div>
              </div>

              <div className="form-section">
                <div className="form-section-title"><span>4</span><div><h3>사장님이 직접 작성할 내용</h3><p>데이터만으로 알 수 없는 자금 목적과 실행계획만 직접 설명해주세요.</p></div></div>
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
                  {submitting ? '성장성 예비평가를 계산하고 있어요...' : !identityVerified ? '대표자 본인인증을 먼저 완료해주세요' : !allConsentsAgreed ? '필수 고지사항에 모두 동의해주세요' : demoMode ? '체험으로 예비평가 보기' : '먹투 예비평가 시작'} <Database />
                </button>}
            </div>
          </div>
          <p className="form-disclaimer">이 결과는 금융기관의 공식 신용평가나 정부 SCB 결과가 아닌 먹투 성장성 예비평가이며 최종 펀딩 승인이 아닙니다. 실제 서비스 출시 전 개인정보·신용정보 처리 구조와 보유기간은 전문 법률 검토 및 제휴기관 요건 확인이 필요합니다.</p>
        </fieldset>
      </form>}
    </div>
    {consentPartner && (() => {
      const option = partnerOptions.find((item) => item.id === consentPartner)
      if (!option) return null
      return <PartnerConsentModal
        option={option}
        onCancel={() => setConsentPartner('')}
        onConfirm={() => void connectPartner(option.id)}
        onOpenTerms={() => { setConsentPartner(''); navigate('/legal/credit-info') }}
      />
    })()}
    {openedFile && <DocumentModal
      title={uploadOptions.find((option) => option.id === openedDocument)?.title || '제출 자료'}
      filename={openedFile.name}
      meta={`${fileSizeLabel(openedFile.size)} · ${openedFile.type || '형식 미확인'}${documentMetadata[openedDocument]?.rowCount ? ` · ${documentMetadata[openedDocument].headers.length}열 ${documentMetadata[openedDocument].rowCount.toLocaleString('ko-KR')}행` : ''} · 내 브라우저에서만 열립니다`}
      onClose={() => setOpenedDocument('')}
    >
      <LocalFileViewer file={openedFile} />
    </DocumentModal>}
  </div>
}

const labelOf = (sourceId: string) => uploadOptions.find((option) => option.id === sourceId)?.title || sourceId

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
 *
 * 처리 결과 목록은 없앴다. 어느 칸에 무엇이 들어갔는지는 바로 아래 'B. 자료 업로드'이
 * 보여준다. 여기서는 진행 중인 한 줄만 남긴다.
 */
function UniversalIntake({ dragging, busy, note, onDragState, onFiles }: {
  dragging: boolean
  busy: boolean
  note: string
  onDragState: (value: boolean) => void
  onFiles: (files: File[]) => void
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
      {busy && note && <p className="intake-progress" aria-live="polite"><RotateCcw /> {note}</p>}
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
 * 화면 하나를 데모 값으로 채우는 버튼.
 *
 * 단계마다 하나씩 둔다. 그리고 각 버튼은 자기 화면에 보이는 칸만 채운다.
 * 한 버튼이 세 화면을 다 채우면 화면에 없는 값이 조용히 바뀌고, 사장님은
 * 자기가 무엇을 확인해야 하는지 모른 채 마지막 화면까지 떠밀려 간다.
 *
 * 2단계(자료 올리기)는 넣는 것이 파일이라 안내할 내용이 따로 있어서 SamplePack 이 맡는다.
 */
function StepDemoFill({ label, busy, onFill }: {
  title?: string
  description?: ReactNode
  label: string
  busy: boolean
  onFill: () => void
}) {
  return <div className="step-demo-fill-bar">
    <button type="button" className="virtual-data-upload-btn compact" disabled={busy} onClick={onFill}>
      <FolderDown /> {label}
    </button>
  </div>
}

/** 자료 업로드를 시작하기 전에 준비 기준을 한눈에 보여준다. */
function DocumentPreparationGuide() {
  const groups = [
    { icon: Building2, title: '사업체 확인', badge: '둘 다 필수', description: '사업자등록 자료와 영업신고 자료를 준비해주세요.' },
    { icon: Landmark, title: '현금흐름 확인', badge: '필수', description: '최근 12개월 사업용 계좌 내역이 필요해요.' },
    { icon: FileSpreadsheet, title: '매출 확인', badge: '하나 이상', description: 'POS·카드·납세·배달 정산 중 편한 자료 하나면 됩니다.' },
    { icon: FileText, title: '추가 자료', badge: '선택', description: '고객 방문·임대차·급여 자료는 있으면 평가 근거가 더 풍부해져요.' },
  ]
  return <section className="document-preparation-guide">
    <header><span>먼저 확인해주세요</span><h3>어떤 자료를 올리면 되나요?</h3><p>모든 자료를 준비할 필요는 없습니다. 아래 필수 기준만 채우고, 추가 자료는 가지고 있는 것만 올려주세요.</p></header>
    <div>{groups.map(({ icon: Icon, title, badge, description }) => <article key={title}><Icon /><span><b>{title}</b><em>{badge}</em><small>{description}</small></span></article>)}</div>
  </section>
}

/**
 * 자료가 없어도 업로드 흐름을 그대로 체험할 수 있게 만든 데모 묶음.
 *
 * ZIP 을 내려받아 다시 올리라고 하던 안내를 없앴다. 두 단계를 거칠 이유가 없다.
 * 여기서 바로 10종을 각 칸에 넣고 1·3단계 입력까지 채운다. 개별 파일이 필요하면
 * 아래 자료 카드마다 붙어 있는 '샘플 다운로드'로 받을 수 있다.
 */
function SamplePack({ busy, onLoadDemo }: { busy: boolean; onLoadDemo: () => void }) {
  return <div className="sample-pack sample-pack-top">
    <div className="sample-pack-head">
      <span><FolderDown /></span>
      <div>
        <b>준비된 자료가 없어도 괜찮아요 · 데모 자료로 바로 체험하기</b>
        <p>가상 식당 <em>먹투 테스트식당</em>의 12개월 원자료입니다. 누르면 자료 10종이 알맞은 칸에 바로 들어가고, 아래 <b>부채 확인</b>란까지 함께 채워집니다. 이 화면 밖의 칸은 건드리지 않아요.</p>
      </div>
      <button type="button" className="virtual-data-upload-btn" disabled={busy} onClick={onLoadDemo}>
        <UploadCloud /> {busy ? '데모 자료를 불러오는 중...' : '데모자료 한번에 업로드'}
      </button>
    </div>
    <ul className="sample-pack-hint">
      <li><Check /> 넣은 자료는 아래 <b>B. 자료 업로드</b>에서 어느 칸에 들어갔는지 바로 확인할 수 있어요.</li>
      <li><Check /> 각 자료 카드의 <b>샘플 다운로드</b> 버튼으로 필요한 파일만 따로 받을 수도 있어요.</li>
      <li><Check /> 자료를 올린 뒤에는 <b>올린 자료 열어보기</b>로 내려받지 않고 그 자리에서 내용을 확인할 수 있어요.</li>
      <li><Check /> 문서 자료는 <b>PNG와 PDF</b>를 함께 제공하고, 모두 ‘실제 제출 불가’ 표시가 들어간 가상 문서입니다.</li>
    </ul>
  </div>
}

/**
 * 제휴기관 연결 동의서.
 *
 * 신용정보 제공은 버튼 한 번으로 끝낼 일이 아니다. 어디에서 무엇을 얼마나 가져가고
 * 언제까지 두는지 읽고 나서 동의하도록 한 단계를 둔다. 서버도 consent 없이는 거절한다.
 */
function PartnerConsentModal({ option, onCancel, onConfirm, onOpenTerms }: {
  option: { id: string; title: string; provider: string; scope: string }
  onCancel: () => void
  onConfirm: () => void
  onOpenTerms: () => void
}) {
  const [agreed, setAgreed] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return createPortal(
    <div className="partner-consent-backdrop" onMouseDown={onCancel}>
      <div
        className="partner-consent-dialog" role="dialog" aria-modal="true"
        aria-label={`${option.title} 연결 동의서`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span><ShieldCheck /> 개인(신용)정보 제3자 조회·제공 동의</span>
            <h3>{option.title} 자료를 연결할까요?</h3>
            <p>아래 범위 안에서만 가져옵니다. 동의하지 않아도 파일을 직접 올려 신청할 수 있어요.</p>
          </div>
          <button type="button" onClick={onCancel} aria-label="닫기"><X /></button>
        </header>

        <div className="partner-consent-terms">
          <section>
            <h4>제공받는 기관</h4>
            <p>{option.provider}</p>
          </section>
          <section>
            <h4>조회·수집 범위</h4>
            <p>{option.scope}</p>
          </section>
          <section>
            <h4>이용 목적</h4>
            <p>제출 자료를 바탕으로 먹투 성장성 예비평가를 산출합니다. 이 평가는 금융기관의 공식 신용평가가 아니며, 대출 승인·거절의 근거로 쓰이지 않습니다.</p>
          </section>
          <section>
            <h4>보유·이용 기간</h4>
            <p>동의일로부터 심사 종료 후 5년. 연결을 해제하면 법령상 보관 의무가 있는 자료를 빼고 지체 없이 파기합니다.</p>
          </section>
          <section>
            <h4>동의 거부 권리</h4>
            <p>거부하셔도 됩니다. 이 경우 해당 자료를 직접 업로드해 주시면 같은 심사를 받을 수 있습니다.</p>
          </section>
          <section>
            <h4>현재 단계 안내</h4>
            <p>MVP 에서는 실제 기관 API 대신 시연 어댑터가 동작하며, 실제 제3자 제공은 이뤄지지 않습니다.</p>
          </section>
        </div>

        <button type="button" className="partner-consent-link" onClick={onOpenTerms}>
          <FileText /> 개인(신용)정보 처리·제공 동의서 전문 보기
        </button>

        <label className="partner-consent-agree">
          <input type="checkbox" checked={agreed} onChange={() => setAgreed((current) => !current)} />
          <span>위 <b>조회 범위·목적·보유기간</b>을 확인했고, {option.provider}에서 자료를 받아오는 데 동의합니다.</span>
        </label>

        <div className="partner-consent-actions">
          <button type="button" onClick={onCancel}>취소</button>
          <button type="button" className="primary" disabled={!agreed} onClick={onConfirm}>동의하고 연결</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function DocumentUploadCard({ option, guide, fileName, metadata, classification, onChange, onOpen, partnerConnected }: { option: UploadOption; guide?: DocumentGuide; fileName?: string; metadata?: DocumentMetadata; classification?: DocumentClassification; onChange: (event: ChangeEvent<HTMLInputElement>) => void; onOpen: () => void; partnerConnected?: boolean }) {
  const Icon = option.icon
  const govSources = new Set(['business', 'license', 'tax'])
  return <div className={`document-upload-card ${fileName ? 'uploaded' : ''} ${partnerConnected ? 'partner-connected' : ''}`}>
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
      {partnerConnected && <p className="partner-connected-notice">제휴기관에서 동의 기반으로 전송받은 자료가 있어 직접 업로드가 필요하지 않습니다.</p>}
      {option.sampleUrl && <a className="sample-download" href={option.sampleUrl} download><Download /> 테스트용 {option.sampleLabel} 다운로드</a>}{option.samplePdfUrl && <a className="sample-download" href={option.samplePdfUrl} download><Download /> 테스트용 PDF 샘플 다운로드</a>}{!govSources.has(option.id) && option.sampleAltUrl && <a className="sample-download" href={option.sampleAltUrl} download><Download /> 테스트용 {option.sampleAltLabel} 다운로드</a>}</div>
    {partnerConnected
      ? <span className="document-action partner-blocked"><PlugZap /> 기관 연결됨</span>
      : <label className="document-action"><UploadCloud />{fileName ? '다시 선택' : '파일 선택'}<input type="file" name={`document-${option.id}`} accept={option.accept} onChange={onChange} /></label>}
  </div>
}
