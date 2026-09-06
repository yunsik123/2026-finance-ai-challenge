/**
 * 합성 심사 서류(OCR 테스트용) 생성기.
 *
 * 왜 이 파일이 생겼나.
 *   public/samples 의 01~10 번 PNG 는 저장소 안에 만드는 방법이 없는 그림 파일이었다.
 *   그래서 거기 찍힌 사업자등록번호 123-45-67890 이 국세청 검증번호를 통과하지 못한다는 것을
 *   아무도 고칠 수 없었다. 서버는 그 번호로 접수를 거절하는데(server/verification.ts),
 *   데모 자료는 그 번호를 그대로 보여주고 있었으니 데모가 끝까지 흐를 수 없었다.
 *
 *   이제 모든 합성 서류를 이 파일 하나에서 만든다. 사업체 정보는 PROFILE 한 곳에만 있고,
 *   문서와 화면(src/OwnerCenter.tsx 의 sampleProfile)이 같은 값을 쓴다.
 *   번호를 바꾸려면 여기만 고치고 `node scripts/make-sample-docs.mjs` 를 다시 돌리면 된다.
 *
 * 모든 문서에는 'TEST ONLY · 법적 효력 없음' 워터마크와 가상 직인이 들어간다.
 * 실제 서류로 오인될 수 있는 파일을 만들지 않기 위한 안전장치이며 지우면 안 된다.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 검증번호까지 맞는 사업자등록번호인지 확인한다. server/verification.ts 와 같은 계산이다. */
export function businessNumberChecksum(number) {
  const digits = [...number.replace(/\D/g, '')].map(Number)
  if (digits.length !== 10) return false
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5]
  let sum = digits.slice(0, 9).reduce((total, digit, index) => total + digit * weights[index], 0)
  sum += Math.floor((digits[8] * 5) / 10)
  return (10 - (sum % 10)) % 10 === digits[9]
}

/**
 * 데모 사업체 하나. 화면·문서·CSV 가 전부 이 값을 따른다.
 * businessNumber 는 반드시 검증번호를 통과하는 값이어야 한다(아래에서 실제로 검사한다).
 */
export const PROFILE = {
  businessName: '먹투 테스트식당',
  ownerName: '김테스트',
  businessNumber: '123-45-67891',
  licenseNumber: '제2026-테스트-0001호',
  address: '서울특별시 마포구 테스트로 123, 1층',
  openedAt: '2022년 03월 10일',
  category: '식품접객업 · 일반음식점',
  area: '82.50',
  documentNo: 'TEST-2026-0906',
}

if (!businessNumberChecksum(PROFILE.businessNumber)) {
  throw new Error(`PROFILE.businessNumber(${PROFILE.businessNumber})가 국세청 검증번호를 통과하지 못합니다. 서버가 접수를 거절하므로 데모가 끝까지 흐르지 않습니다.`)
}

/* ── 표 자료에서 숫자를 가져온다 ─────────────────────────────
 *
 * 문서에 찍는 금액을 여기에 손으로 적어두면 반드시 어긋난다. 실제로 어긋나 있었다.
 * 데모 자료의 POS 12개월 합계는 2억2천만원인데 집계표 그림에는 4억1천6백만원이,
 * 대출잔액은 4,800만원인데 신고값과 문서에는 7,000만원이 찍혀 있었다.
 * 그래서 심사 결과에 '신고 대출잔액과 자료가 31% 다르다'는 불일치가 잡혔다.
 *
 * 이제 문서는 같은 폴더의 CSV 를 읽어 그 합계를 그대로 인쇄한다.
 * 표와 그림이 구조적으로 갈라질 수 없다.
 */
const samplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'samples')

function readCsv(name) {
  const text = fs.readFileSync(path.join(samplesDir, name), 'utf8').trim()
  const [head, ...body] = text.split(/\r?\n/)
  const headers = head.split(',')
  return body.filter(Boolean).map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']))
  })
}
const num = (value) => Number(String(value).replace(/[^\d.-]/g, '')) || 0
const monthOf = (value) => String(value).slice(0, 7)
const sumBy = (list, key) => list.reduce((total, row) => total + num(row[key]), 0)

const posRows = readCsv('meoktu-pos-sample.csv')
const cardRows = readCsv('meoktu-card-settlement-sample.csv')
const deliveryRows = readCsv('meoktu-delivery-sample.csv')
const accountRows = readCsv('meoktu-account-sample.csv')
const debtRows = readCsv('meoktu-debt-sample.csv')
const staffRows = readCsv('meoktu-staff-sample.csv')
const summaryRows = readCsv('meoktu-monthly-summary-sample.csv')

/** POS 월별 집계. 집계표 그림이 그대로 인쇄한다. */
const posMonths = [...new Set(posRows.map((row) => monthOf(row['영업일'])))].sort()
const posByMonth = posMonths.map((month) => {
  const rows = posRows.filter((row) => monthOf(row['영업일']) === month)
  return {
    month,
    sales: sumBy(rows, '주문금액'),
    orders: rows.length,
    card: rows.filter((row) => row['결제수단'] === '카드').reduce((total, row) => total + num(row['주문금액']), 0),
    refund: sumBy(rows, '취소환불액'),
  }
})
const lastMonth = posMonths[posMonths.length - 1]
const cardLast = cardRows.filter((row) => monthOf(row['승인일']) === lastMonth)
const deliveryLast = deliveryRows.filter((row) => monthOf(row['주문일']) === lastMonth)
const debtLast = debtRows.filter((row) => row['기준월'] === lastMonth)
const staffLast = staffRows.filter((row) => row['기준월'] === lastMonth)
const summaryLast = summaryRows.filter((row) => row['기준월'] === lastMonth)[0] || {}

/** 문서에 찍히는 대표 금액. 전부 위 CSV 에서 계산한 값이다. */
export const TOTALS = {
  posAnnualSales: posByMonth.reduce((total, item) => total + item.sales, 0),
  cardApproved: sumBy(cardLast, '승인금액'),
  cardFee: sumBy(cardLast, '수수료'),
  cardDeposit: sumBy(cardLast, '실제입금액'),
  deliveryOrder: sumBy(deliveryLast, '주문금액'),
  deliveryFee: sumBy(deliveryLast, '수수료'),
  deliveryOrders: sumBy(deliveryLast, '주문건수'),
  loanBalance: sumBy(debtLast, '잔액'),
  monthlyDebtService: sumBy(debtLast, '월원리금'),
  monthlyRent: num(summaryLast['월임차료']),
  netPayroll: sumBy(staffLast, '급여총액'),
  staffCount: sumBy(staffLast, '직원수'),
  deposit: 50_000_000,
  lastMonth,
}
TOTALS.deliverySettlement = TOTALS.deliveryOrder - TOTALS.deliveryFee
// 과세표준은 12개월 POS 매출을 만원 단위로 맞춘 값으로 둔다. 신고매출과 실매출이
// 완전히 같을 수는 없지만, 데모의 '깨끗한 세트'에서는 대조가 통과해야 한다.
TOTALS.vatTaxBase = Math.round(TOTALS.posAnnualSales / 10000) * 10000
TOTALS.vatPaid = Math.round(TOTALS.vatTaxBase * .055 / 10000) * 10000
/** 자금 사용계획·소유구조는 화면의 데모 자동입력(src/OwnerCenter.tsx)과 같은 값이어야 한다. */
export const FUND_USE_PLAN = [
  { category: '주방설비', amount: 18_000_000, note: '저온 저장고 1대 교체' },
  { category: '인테리어', amount: 12_000_000, note: '주방 동선 개선 공사' },
]
export const FUND_USE_TOTAL = FUND_USE_PLAN.reduce((total, item) => total + item.amount, 0)
export const OWNERSHIP = [{ name: PROFILE.ownerName, role: '대표자', share: 100 }]
export const DEBT_ROWS = debtLast
export const POS_BY_MONTH = posByMonth
export const CARD_LAST = cardLast
export const STAFF_RECENT = staffRows.slice(-6)
export const ACCOUNT_LAST = accountRows.filter((row) => monthOf(row['거래일시']) === lastMonth)
export const DELIVERY_BY_PLATFORM = [...new Set(deliveryLast.map((row) => row['플랫폼']))].map((platform) => {
  const list = deliveryLast.filter((row) => row['플랫폼'] === platform)
  return { platform, orders: sumBy(list, '주문건수'), amount: sumBy(list, '주문금액'), fee: sumBy(list, '수수료') }
})

const won = (value) => `₩${value.toLocaleString('en-US')}`
const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ── 공통 뼈대 ──────────────────────────────────────────────── */

const STYLE = `
*{box-sizing:border-box}
body{margin:0;width:1240px;height:1754px;background:#f5f3f2;
  font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#1a1a1a;position:relative;overflow:hidden}
.page{position:absolute;inset:44px;background:#fff;border:1px solid #d8d4d2;border-radius:10px;padding:52px 62px;display:flex;flex-direction:column}
h1{margin:18px 0 0;text-align:center;font-size:40px;font-weight:800;letter-spacing:.06em}
.sub{margin:12px 0 0;text-align:center;font-size:15px;color:#8a8580}
.rule{margin:26px 0 34px;border-bottom:2px solid #2b2b2b}
table{width:100%;border-collapse:collapse;font-size:17px}
th,td{border:1px solid #cfcbc8;padding:15px 18px;text-align:left;vertical-align:middle}
th{width:26%;background:#efedeb;font-weight:700}
td{font-weight:400}
table.grid th{width:auto;text-align:center;background:#efedeb;font-size:15px;padding:12px 10px}
table.grid td{text-align:right;font-size:15px;padding:11px 10px}
table.grid td.text{text-align:left}
table.grid tr.total td,table.grid tr.total th{background:#f7f5f3;font-weight:800}
.foot{margin-top:auto;padding-top:22px;border-top:1px solid #e2dedb;display:flex;align-items:flex-end;justify-content:space-between}
.foot small{font-size:13px;color:#8a8580}
.stamp{width:118px;height:118px;border:3px solid #c0392b;border-radius:50%;display:grid;place-items:center;
  color:#c0392b;font-size:14px;font-weight:800;line-height:1.35;text-align:center;transform:rotate(-8deg);opacity:.85}
.mark{position:absolute;left:0;right:0;top:52%;bottom:9%;pointer-events:none;
  display:flex;flex-direction:column;justify-content:space-around;align-items:center}
.mark span{font-size:50px;font-weight:700;color:#c0392b;opacity:.11;white-space:nowrap;letter-spacing:.04em}
.note{margin-top:20px;font-size:14px;color:#8a8580;line-height:1.7}
`

/** 촬영본·스캔본은 같은 문서를 기울이고 그림자·조명을 얹어 만든다. 실제로 사장님이 올리는 모습에 가깝다. */
const PHOTO_STYLE = `
body{background:#3b3a38}
.page{inset:96px 104px;transform:rotate(-1.4deg) perspective(2200px) rotateX(1.6deg);
  box-shadow:0 40px 90px rgba(0,0,0,.55);border-radius:4px}
body::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(118deg,rgba(255,246,214,.30) 0%,rgba(255,255,255,0) 34%,rgba(0,0,0,.24) 100%)}
`
const SCAN_STYLE = `
body{background:#e8e6e2}
.page{inset:60px;transform:rotate(.6deg);filter:grayscale(.35) contrast(1.08) brightness(.98)}
body::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(96deg,rgba(0,0,0,.05) 0 2px,rgba(0,0,0,0) 2px 7px)}
`

export const VARIANT_STYLE = { clean: '', photo: PHOTO_STYLE, scan: SCAN_STYLE }

function page({ title, body, variant = 'clean' }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700;800&display=swap" rel="stylesheet">
<style>${STYLE}${VARIANT_STYLE[variant] || ''}</style></head><body>
<div class="page">
  <h1>${escape(title)}</h1>
  <p class="sub">합성 테스트 문서 · 실제 기관 발급문서가 아닙니다</p>
  <div class="rule"></div>
  ${body}
  <div class="foot">
    <small>문서번호: ${PROFILE.documentNo} · 모든 상호·성명·번호·금액은 가상입니다.</small>
    <div class="stamp">테스트<br>가상발급</div>
  </div>
</div>
<div class="mark"><span>TEST ONLY · 법적 효력 없음</span><span>TEST ONLY · 법적 효력 없음</span></div>
</body></html>`
}

/** 라벨-값 두 칸짜리 증명서. */
const rows = (pairs) => `<table>${pairs.map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`).join('')}</table>`

/** 여러 열짜리 명세표. 마지막 행을 합계로 강조할 수 있다. */
function grid(headers, body, { totalRow } = {}) {
  const head = `<tr>${headers.map((item) => `<th>${escape(item)}</th>`).join('')}</tr>`
  const lines = body.map((line) => `<tr>${line.map((cell, index) => `<td class="${index === 0 ? 'text' : ''}">${escape(cell)}</td>`).join('')}</tr>`).join('')
  const total = totalRow ? `<tr class="total">${totalRow.map((cell, index) => `<td class="${index === 0 ? 'text' : ''}">${escape(cell)}</td>`).join('')}</tr>` : ''
  return `<table class="grid">${head}${lines}${total}</table>`
}

const money = (value) => value.toLocaleString('en-US')
/** 금액을 한글 표기로. 증명서에 '금 ○○○원정'으로 찍는다. */
function koreanMoney(value) {
  const units = [['억', 1e8], ['만', 1e4]]
  let rest = value
  let text = ''
  for (const [label, size] of units) {
    const part = Math.floor(rest / size)
    if (part > 0) { text += `${part.toLocaleString('ko-KR')}${label} `; rest -= part * size }
  }
  if (rest > 0) text += `${rest.toLocaleString('ko-KR')} `
  return `금 ${text.trim()}원정`
}

/* ── 문서 정의 ──────────────────────────────────────────────── */

/**
 * 파일 이름 → 문서.
 * public/samples 에 이 이름 그대로 나가고, src/OwnerCenter.tsx 의 uploadOptions 가 이 주소를 가리킨다.
 */
export const SYNTHETIC_DOCUMENTS = [
  {
    file: '01_business_registration_certificate_clean', variant: 'clean',
    title: '사 업 자 등 록 증 (테스트용)',
    body: rows([
      ['등록번호', PROFILE.businessNumber],
      ['상호', PROFILE.businessName],
      ['성명(대표자)', PROFILE.ownerName],
      ['개업연월일', PROFILE.openedAt],
      ['사업장 소재지', PROFILE.address],
      ['업태', '음식점업'],
      ['종목', '한식 일반음식점'],
      ['공동사업자', '없음'],
      ['발급사유', '테스트용 합성 발급'],
    ]) + '<p class="note">실제 사업자등록증은 국세청이 발급합니다. 이 문서는 판독 시험용으로 만든 가상 문서이며 법적 효력이 없습니다.</p>',
  },
  { file: '01_business_registration_certificate_photo', variant: 'photo', sameAs: '01_business_registration_certificate_clean' },
  {
    file: '02_food_business_license_clean', variant: 'clean',
    title: '영 업 신 고 증 (테스트용)',
    body: rows([
      ['신고번호', PROFILE.licenseNumber],
      ['영업의 종류', PROFILE.category],
      ['영업소 명칭', PROFILE.businessName],
      ['대표자', PROFILE.ownerName],
      ['사업자등록번호', PROFILE.businessNumber],
      ['소재지', PROFILE.address],
      ['영업장 면적', `${PROFILE.area} ㎡`],
      ['신고일', PROFILE.openedAt],
    ]) + '<p class="note">식품위생법 제37조에 따른 영업신고증 형태의 가상 문서입니다. 신고번호는 관할 관청이 ‘제 연도-일련번호 호’ 형태로 부여합니다.</p>',
  },
  { file: '02_food_business_license_photo', variant: 'photo', sameAs: '02_food_business_license_clean' },
  {
    file: '03_vat_tax_base_certificate_clean', variant: 'clean',
    title: '부가가치세 과세표준증명 (테스트용)',
    body: rows([
      ['납세자 성명', PROFILE.ownerName],
      ['사업자등록번호', PROFILE.businessNumber],
      ['상호', PROFILE.businessName],
      ['사업장 소재지', PROFILE.address],
      ['과세기간', `${POS_BY_MONTH[0].month.replace('-', '년 ')}월 ~ ${TOTALS.lastMonth.replace('-', '년 ')}월`],
      ['과세표준', `${koreanMoney(TOTALS.vatTaxBase)} (${won(TOTALS.vatTaxBase)})`],
      ['납부세액', `${koreanMoney(TOTALS.vatPaid)} (${won(TOTALS.vatPaid)})`],
      ['발급용도', '금융기관 제출용 · 테스트'],
    ]),
  },
  { file: '03_vat_tax_base_certificate_scan', variant: 'scan', sameAs: '03_vat_tax_base_certificate_clean' },
  {
    file: '04_pos_sales_summary', variant: 'clean',
    title: 'POS 월별 매출 집계표 (테스트용)',
    body: rows([['상호', PROFILE.businessName], ['사업자등록번호', PROFILE.businessNumber], ['집계기간', `${POS_BY_MONTH[0].month} ~ ${TOTALS.lastMonth}`]])
      + grid(['영업월', '매출액(원)', '주문건수', '카드매출(원)', '취소환불액(원)'],
        POS_BY_MONTH.map((item) => [item.month, money(item.sales), money(item.orders), money(item.card), money(item.refund)]),
        { totalRow: ['합계', money(TOTALS.posAnnualSales), money(POS_BY_MONTH.reduce((total, item) => total + item.orders, 0)), '', ''] }),
  },
  {
    file: '05_card_van_settlement', variant: 'clean',
    title: '카드·VAN 정산 내역서 (테스트용)',
    body: rows([['가맹점명', PROFILE.businessName], ['사업자등록번호', PROFILE.businessNumber], ['정산월', TOTALS.lastMonth]])
      + grid(['승인일', '승인금액(원)', '취소금액(원)', '수수료(원)', '실입금액(원)'],
        CARD_LAST.slice(0, 12).map((row) => [row['승인일'], money(Number(row['승인금액'])), money(Number(row['취소금액'])), money(Number(row['수수료'])), money(Number(row['실제입금액']))]),
        { totalRow: [`${TOTALS.lastMonth} 합계`, money(TOTALS.cardApproved), '', money(TOTALS.cardFee), money(TOTALS.cardDeposit)] })
      + '<p class="note">가맹점 정산 내역서 형태의 가상 문서입니다. 표에는 최근 12영업일만 싣고 합계는 해당 월 전체 기준입니다.</p>',
  },
  {
    file: '06_business_bank_statement_clean', variant: 'clean',
    title: '사업용 계좌 거래내역서 (테스트용)',
    body: rows([['예금주', `${PROFILE.businessName} (${PROFILE.ownerName})`], ['사업자등록번호', PROFILE.businessNumber], ['조회기간', `${TOTALS.lastMonth}-01 ~ ${TOTALS.lastMonth}-31`]])
      + grid(['거래일시', '적요', '입금(원)', '출금(원)', '잔액(원)'],
        ACCOUNT_LAST.slice(0, 13).map((row) => [row['거래일시'], row['적요'], money(Number(row['입금액'])), money(Number(row['출금액'])), money(Number(row['잔액']))]))
      + '<p class="note">거래내역 저장 화면에서 내려받은 형태의 가상 문서입니다. 표에는 해당 월 앞부분만 실었습니다.</p>',
  },
  { file: '06_business_bank_statement_photo', variant: 'photo', sameAs: '06_business_bank_statement_clean' },
  {
    file: '07_delivery_platform_settlement', variant: 'clean',
    title: '배달 플랫폼 정산 내역서 (테스트용)',
    body: rows([['상호', PROFILE.businessName], ['사업자등록번호', PROFILE.businessNumber], ['정산월', TOTALS.lastMonth]])
      + grid(['플랫폼', '주문건수', '주문금액(원)', '중개수수료(원)', '정산입금액(원)'],
        DELIVERY_BY_PLATFORM.map((item) => [item.platform, money(item.orders), money(item.amount), money(item.fee), money(item.amount - item.fee)]),
        { totalRow: ['합계', money(TOTALS.deliveryOrders), money(TOTALS.deliveryOrder), money(TOTALS.deliveryFee), money(TOTALS.deliverySettlement)] }),
  },
  {
    file: '08_debt_schedule', variant: 'clean',
    title: '대출 잔액·상환 내역서 (테스트용)',
    body: rows([['차주', `${PROFILE.businessName} (${PROFILE.ownerName})`], ['사업자등록번호', PROFILE.businessNumber], ['기준월', TOTALS.lastMonth]])
      + grid(['금융기관', '대출종류', '대출잔액(원)', '이자율(%)', '월 원리금(원)', '만기일'],
        DEBT_ROWS.map((row) => [row['금융기관'], row['대출종류'], money(Number(row['잔액'])), row['금리'], money(Number(row['월원리금'])), row['만기일'] || '-']),
        { totalRow: ['합계', '', money(TOTALS.loanBalance), '', money(TOTALS.monthlyDebtService), ''] }),
  },
  {
    file: '09_commercial_lease_excerpt', variant: 'clean',
    title: '상가건물 임대차계약서 발췌 (테스트용)',
    body: rows([
      ['임차인', `${PROFILE.businessName} (${PROFILE.ownerName})`],
      ['사업자등록번호', PROFILE.businessNumber],
      ['소재지', PROFILE.address],
      ['임차 면적', `${PROFILE.area} ㎡`],
      ['보증금', `${koreanMoney(TOTALS.deposit)} (${won(TOTALS.deposit)})`],
      ['월 차임(월세)', `${koreanMoney(TOTALS.monthlyRent)} (${won(TOTALS.monthlyRent)})`],
      ['관리비', '금 삼십오만원정 (₩350,000)'],
      ['계약기간', '2025년 03월 10일 ~ 2028년 03월 09일'],
    ]) + '<p class="note">상가건물 임대차보호법에 따른 표준계약서 형식의 발췌본입니다. 심사에는 보증금·월 차임·계약기간·소재지만 확인합니다.</p>',
  },
  {
    file: '11_fund_use_plan', variant: 'clean',
    title: '자금 사용계획서 (테스트용)',
    body: rows([['상호', PROFILE.businessName], ['사업자등록번호', PROFILE.businessNumber], ['신청 금액', won(FUND_USE_TOTAL)]])
      + grid(['사용 항목', '금액(원)', '비중(%)', '집행 계획'],
        FUND_USE_PLAN.map((item) => [item.category, money(item.amount), (item.amount / FUND_USE_TOTAL * 100).toFixed(1), item.note]),
        { totalRow: ['합계', money(FUND_USE_TOTAL), '100.0', ''] })
      + '<p class="note">사장님이 화면에서 직접 적는 자금 사용계획과 같은 내용입니다. 합계는 희망 펀딩액과 일치해야 접수됩니다.</p>',
  },
  {
    file: '12_ownership_structure', variant: 'clean',
    title: '사업체 소유구조 확인서 (테스트용)',
    body: rows([['상호', PROFILE.businessName], ['사업자등록번호', PROFILE.businessNumber], ['기준일', `${TOTALS.lastMonth}-31`]])
      + grid(['소유자', '관계', '지분율(%)', '의결권(%)', '확인'],
        OWNERSHIP.map((item) => [item.name, item.role, String(item.share), String(item.share), '확인']),
        { totalRow: ['합계', '-', '100', '100', '-'] })
      + `<p class="note">지분 20% 이상 보유자는 주요 소유자로 표시합니다. 현재 실질 소유자: ${OWNERSHIP.filter((item) => item.share >= 20).map((item) => item.name).join(', ')}.</p>`,
  },
  {
    file: '10_payroll_ledger', variant: 'clean',
    title: '급여대장 (테스트용)',
    body: rows([['상호', PROFILE.businessName], ['사업자등록번호', PROFILE.businessNumber], ['지급월', TOTALS.lastMonth]])
      + grid(['기준월', '직원수', '급여총액(원)', '사회보험 가입자수'],
        STAFF_RECENT.map((row) => [row['기준월'], row['직원수'], money(Number(row['급여총액'])), row['사회보험가입자수']]),
        { totalRow: [`${TOTALS.lastMonth} 지급`, money(TOTALS.staffCount), money(TOTALS.netPayroll), ''] }),
  },
]

/** 파일 하나의 HTML. sameAs 가 있으면 같은 내용을 다른 변형(촬영본·스캔본)으로 낸다. */
export function documentHtml(document) {
  const source = document.sameAs
    ? SYNTHETIC_DOCUMENTS.find((item) => item.file === document.sameAs)
    : document
  if (!source) throw new Error(`sameAs 대상이 없습니다: ${document.sameAs}`)
  return page({ title: source.title, body: source.body, variant: document.variant })
}
