/**
 * 사장님 센터 업로드 체험용 샘플 자료 생성기.
 *
 *   node scripts/make-sample-data.mjs
 *
 * 모든 값은 하나의 가상 식당(샘플식당 · 김소담 · 123-45-67891)에서 나온 것처럼
 * 서로 맞물리게 만든다. POS 합계 ≈ 카드정산 + 현금, 계좌 입금 ≈ 카드 실입금,
 * 배달 매출 비중 ≈ 22% 처럼 교차검증이 실제로 맞아떨어져야 시연이 산다.
 *
 * 문서형 샘플(PNG)은 scripts/sample-docs/*.html 을 크롬 헤드리스로 렌더해서 만든다.
 * README 의 재생성 명령을 참고할 것.
 */
import fs from 'node:fs/promises'
import { rebuildSamplePack } from './zip-samples.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'samples')

const BUSINESS = { name: '샘플식당', owner: '김소담', number: '123-45-67891', address: '서울특별시 마포구 망원동 12-3' }
/** 12개월 구간: 2025-09 ~ 2026-08 */
const START = new Date(Date.UTC(2025, 8, 1))
const MONTHS = 12

// 재현 가능한 난수. 매번 같은 파일이 나와야 검토가 쉽다.
let seed = 20260901
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const pick = (list) => list[Math.floor(random() * list.length)]
const between = (min, max) => min + random() * (max - min)
const round = (value, unit = 100) => Math.round(value / unit) * unit
const iso = (date) => date.toISOString().slice(0, 10)
const hhmm = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

const menus = [
  { name: '들기름 고등어 한상', price: 13000 },
  { name: '제철 반상', price: 15000 },
  { name: '소복 정식', price: 17000 },
  { name: '묵은지 김치찜', price: 21000 },
  { name: '보리굴비 정식', price: 26000 },
  { name: '계란말이 추가', price: 6000 },
  { name: '동치미 국수', price: 9000 },
]

/** 달마다 완만하게 성장하고, 주말·성수기에 오르내린다. */
const monthFactor = (index) => 1 + index * 0.019
const weekdayFactor = (day) => [0.86, 0.82, 0.9, 0.95, 1.06, 1.28, 1.2][day]

const days = []
for (let m = 0; m < MONTHS; m += 1) {
  const monthStart = new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth() + m, 1))
  const dayCount = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate()
  for (let d = 1; d <= dayCount; d += 1) {
    const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), d))
    // 정기 휴무: 매월 두 번째·네 번째 월요일
    const closed = date.getUTCDay() === 1 && (d > 7 && d <= 14 || d > 21 && d <= 28)
    days.push({ date, monthIndex: m, closed })
  }
}

const csv = (headers, rows) => [headers.join(','), ...rows.map((row) => row.join(','))].join('\n') + '\n'
const write = async (name, content) => {
  await fs.writeFile(path.join(out, name), content, 'utf8')
  const size = Buffer.byteLength(content, 'utf8')
  console.log(`  ${name.padEnd(38)} ${String(content.split('\n').length - 2).padStart(6)}행  ${(size / 1024).toFixed(0)}KB`)
}

// ── POS 주문 원자료 ────────────────────────────────────────────────
const posRows = []
const dailySales = new Map()
const dailyByMethod = new Map()
for (const day of days) {
  if (day.closed) { dailySales.set(iso(day.date), 0); continue }
  const orders = Math.round(between(24, 34) * monthFactor(day.monthIndex) * weekdayFactor(day.date.getUTCDay()))
  let total = 0
  const methodTotals = { 카드: 0, 간편결제: 0, 현금: 0 }
  for (let i = 0; i < orders; i += 1) {
    const lunch = random() < 0.45
    const hour = lunch ? Math.floor(between(11, 14)) : Math.floor(between(17, 21))
    const minute = Math.floor(between(0, 60))
    const menu = pick(menus)
    const quantity = random() < 0.72 ? 1 : random() < 0.8 ? 2 : 3
    const amount = menu.price * quantity
    const method = random() < 0.72 ? '카드' : random() < 0.65 ? '간편결제' : '현금'
    // 취소·환불은 드물게 발생한다.
    const refund = random() < 0.012 ? amount : 0
    posRows.push([iso(day.date), hhmm(hour, minute), amount, method, menu.name, quantity, refund])
    if (!refund) { total += amount; methodTotals[method] += amount }
  }
  dailySales.set(iso(day.date), total)
  dailyByMethod.set(iso(day.date), methodTotals)
}
posRows.sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))

// ── 카드 정산 ──────────────────────────────────────────────────────
const cardRows = []
for (const day of days) {
  const key = iso(day.date)
  const methods = dailyByMethod.get(key)
  if (!methods) continue
  const approved = methods.카드 + methods.간편결제
  if (!approved) continue
  const cancelled = random() < 0.06 ? round(approved * between(0.01, 0.05)) : 0
  const fee = round((approved - cancelled) * 0.015, 10)
  const settleDate = new Date(day.date.getTime() + 2 * 86400000)
  cardRows.push([key, approved, cancelled, fee, iso(settleDate), approved - cancelled - fee])
}

// ── 사업용 계좌 거래내역 ───────────────────────────────────────────
//
// 비용은 그 달 실제 매출에 비례해서 잡는다.
// 예전에는 식재료·급여를 매출과 무관한 고정 범위에서 뽑았고,
// 그 결과 월매출 1,834만원인 식당의 12개월 출금이 3.1억(입금 2.0억)이 되어
// 잔액이 -9,591만원으로 끝났다. 존재할 수 없는 사업체라
// 이 자료로 신용등급을 매기면 현금흐름 지표가 전부 최하로 깔린다.
//
// 외식업 표준 원가구조에 맞춘다.
//   식재료·매입 34% / 인건비 28% / 임차료·관리비 고정 / 기타 운영비 6%
//   → 대출 원리금까지 갚고 월 10% 안팎이 남는 '건강하지만 평범한' 식당.
const accountRows = []
let balance = 12_400_000

/** 월별 실제 매출. 비용 규모의 기준이 된다. */
const monthlySales = Array.from({ length: MONTHS }, (_, m) => {
  const prefix = iso(new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth() + m, 1))).slice(0, 7)
  let sum = 0
  for (const [key, value] of dailySales) if (key.startsWith(prefix)) sum += value
  return sum
})
/** 인건비. 직원·급여 자료와 같은 값을 써야 두 파일이 교차검증을 통과한다. */
const monthlyPayroll = monthlySales.map((sales) => round(sales * 0.28, 1000))

/**
 * 4대보험 가입자(정직원) 수.
 *
 * 급여총액을 직원 수로 나눈 값이 최저임금에 못 미치면 안 된다.
 * 2025년 최저임금 10,030원 × 209시간 = 월 2,096,270원이고, 여기에 사용자 부담
 * 4대보험 약 10%를 더해 1인당 240만원을 정직원 1명의 최소 인건비로 본다.
 * 예전에는 직원 4~6명 전원을 가입자로 적어서 1인당 88만~116만원, 최저임금의
 * 42~55%가 되는 자료가 나왔다. 심사자료로 쓰면 곧바로 위법 신호로 잡히는 값이다.
 * 정직원은 급여총액이 감당하는 만큼만 두고 나머지는 시간제로 표시한다.
 */
const FULLTIME_COST = 2_400_000
const insuredCount = (m) => Math.max(1, Math.floor(monthlyPayroll[m] / FULLTIME_COST))

const suppliers = [
  { name: '망원시장 상회', memo: '식재료비', share: 0.55, chance: 0.62 },
  { name: '한빛수산', memo: '수산물 매입', share: 0.30, chance: 0.34 },
  { name: '우리쌀도정', memo: '곡물 매입', share: 0.15, chance: 0.18 },
]
// 달마다 매입 예산을 세우고, 영업일에 나눠 쓴다. 예산을 넘기면 그 달은 더 사지 않는다.
const openDaysInMonth = monthlySales.map((_, m) => days.filter((day) => day.monthIndex === m && !day.closed).length)
const purchaseBudget = monthlySales.map((sales) => sales * 0.34)
const spent = monthlySales.map(() => 0)

/** 현금 매출은 모아 뒀다가 3일에 한 번 통째로 넣는다. 한 푼도 새지 않아야 한다. */
let cashOnHand = 0

for (const day of days) {
  const key = iso(day.date)
  const m = day.monthIndex

  const settlement = cardRows.find((row) => row[4] === key)
  if (settlement) {
    balance += settlement[5]
    accountRows.push([`${key} 09:12`, settlement[5], 0, balance, '카드정산사', '카드 매출 정산 입금'])
  }

  cashOnHand += dailyByMethod.get(key)?.현금 || 0
  if (cashOnHand > 0 && day.date.getUTCDate() % 3 === 0) {
    balance += cashOnHand
    accountRows.push([`${key} 20:40`, cashOnHand, 0, balance, '자동입출금기', '현금 매출 입금'])
    cashOnHand = 0
  }

  if (!day.closed) {
    const perOpenDay = purchaseBudget[m] / Math.max(1, openDaysInMonth[m])
    for (const supplier of suppliers) {
      if (random() > supplier.chance) continue
      const amount = round(perOpenDay * supplier.share / supplier.chance * between(0.75, 1.25))
      if (amount <= 0 || spent[m] + amount > purchaseBudget[m]) continue
      spent[m] += amount
      balance -= amount
      accountRows.push([`${key} ${hhmm(Math.floor(between(8, 11)), Math.floor(between(0, 60)))}`, 0, amount, balance, supplier.name, supplier.memo])
    }
  }

  if (day.date.getUTCDate() === 5) {
    for (const [name, memo, amount] of [['한빛빌딩 임대', '월 임차료', 2_300_000], ['관리사무소', '공용관리비', 240_000]]) {
      balance -= amount
      accountRows.push([`${key} 10:00`, 0, amount, balance, name, memo])
    }
  }
  if (day.date.getUTCDate() === 10) {
    balance -= monthlyPayroll[m]
    accountRows.push([`${key} 11:30`, 0, monthlyPayroll[m], balance, '급여이체', '직원 급여'])
  }
  if (day.date.getUTCDate() === 20) {
    // 공과금·소모품·배달 수수료 등 나머지 운영비를 한 번에 턴다.
    const other = round(monthlySales[m] * 0.06, 1000)
    balance -= other
    accountRows.push([`${key} 14:00`, 0, other, balance, '기타 운영비', '공과금·소모품·수수료'])
  }
  if (day.date.getUTCDate() === 25) {
    for (const [name, amount] of [['한빛은행 대출상환', 780_000], ['소상공인정책자금 상환', 370_000]]) {
      balance -= amount
      accountRows.push([`${key} 09:00`, 0, amount, balance, name, '대출 원리금 상환'])
    }
  }
}
// 마지막 날까지 남은 현금은 마감 입금으로 넣는다.
if (cashOnHand > 0) {
  const key = iso(days[days.length - 1].date)
  balance += cashOnHand
  accountRows.push([`${key} 21:00`, cashOnHand, 0, balance, '자동입출금기', '현금 매출 입금'])
}

// ── 배달 플랫폼 정산 ───────────────────────────────────────────────
const deliveryRows = []
for (const day of days) {
  const key = iso(day.date)
  const sales = dailySales.get(key) || 0
  if (!sales) continue
  for (const platform of ['배달의민족', '쿠팡이츠']) {
    const share = platform === '배달의민족' ? between(0.13, 0.17) : between(0.05, 0.08)
    const amount = round(sales * share)
    if (amount < 20000) continue
    const count = Math.max(1, Math.round(amount / 24000))
    deliveryRows.push([key, platform, count, amount, round(amount * 0.135, 10), random() < 0.08 ? round(amount * 0.04) : 0,
      Math.round(count * between(0.3, 0.46)), between(4.5, 4.9).toFixed(1)])
  }
}

// ── 재방문(고객) 자료 ──────────────────────────────────────────────
const customerRows = []
for (let i = 0; i < 1400; i += 1) {
  const visits = random() < 0.62 ? 1 : Math.round(between(2, 9))
  const firstOffset = Math.floor(between(0, 330))
  const first = new Date(START.getTime() + firstOffset * 86400000)
  const last = new Date(Math.min(first.getTime() + Math.floor(between(0, 300)) * 86400000, START.getTime() + 364 * 86400000))
  const hash = `c${(i * 2654435761 % 0xffffff).toString(16).padStart(6, '0')}${(random() * 0xffff | 0).toString(16).padStart(4, '0')}`
  customerRows.push([hash, iso(first), visits === 1 ? iso(first) : iso(last), visits,
    round(visits * between(19000, 29000)), pick(['POS회원', '예약', '멤버십', '배달재주문'])])
}

// ── 대출·상환 ──────────────────────────────────────────────────────
const debtRows = []
const loans = [
  { bank: '한빛은행', kind: '운전자금대출', rate: 5.4, opening: 40_000_000, payment: 780_000, balance: 27_600_000 },
  { bank: '소상공인시장진흥공단', kind: '정책자금', rate: 2.9, opening: 30_000_000, payment: 370_000, balance: 20_400_000 },
]
for (let m = 0; m < MONTHS; m += 1) {
  const date = new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth() + m, 25))
  for (const loan of loans) {
    const balanceAtMonth = loan.balance + loan.payment * (MONTHS - 1 - m)
    debtRows.push([iso(date).slice(0, 7), loan.bank, loan.kind, loan.rate.toFixed(1),
      loan.opening, round(balanceAtMonth, 1000), loan.payment, m === MONTHS - 1 ? '2029-04-25' : ''])
  }
}

// ── 직원·급여 ──────────────────────────────────────────────────────
const staffRows = []
for (let m = 0; m < MONTHS; m += 1) {
  const date = new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth() + m, 1))
  // 정직원 + 시간제 2명(사장은 급여 대상이 아니다).
  const insured = insuredCount(m)
  const headcount = insured + 2
  // 급여총액은 계좌의 '직원 급여' 이체와 같은 값이어야 한다.
  // 두 파일이 어긋나면 교차검증에서 불일치로 잡히고, 그게 맞는 동작이다.
  staffRows.push([iso(date).slice(0, 7), headcount, monthlyPayroll[m], insured])
}

// ── 월별 요약(사장님이 눈으로 대조할 수 있게) ──────────────────────
const summaryRows = []
for (let m = 0; m < MONTHS; m += 1) {
  const prefix = iso(new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth() + m, 1))).slice(0, 7)
  let sales = 0
  for (const [key, value] of dailySales) if (key.startsWith(prefix)) sales += value
  const delivery = deliveryRows.filter((row) => row[0].startsWith(prefix)).reduce((sum, row) => sum + row[3], 0)
  summaryRows.push([prefix, sales, delivery, Math.round(delivery / Math.max(sales, 1) * 1000) / 10, 2_300_000, 1_150_000])
}

await fs.mkdir(out, { recursive: true })
console.log('샘플 자료를 생성합니다 (12개월 · 가상 데이터)')
await write('meoktu-pos-sample.csv', csv(['영업일', '결제시각', '주문금액', '결제수단', '메뉴', '수량', '취소환불액'], posRows))
await write('meoktu-account-sample.csv', csv(['거래일시', '입금액', '출금액', '잔액', '거래상대방', '적요'], accountRows))
await write('meoktu-card-settlement-sample.csv', csv(['승인일', '승인금액', '취소금액', '수수료', '정산일', '실제입금액'], cardRows))
await write('meoktu-delivery-sample.csv', csv(['주문일', '플랫폼', '주문건수', '주문금액', '수수료', '취소금액', '재주문건수', '평균평점'], deliveryRows))
await write('meoktu-customer-sample.csv', csv(['고객해시', '첫방문일', '최근방문일', '방문횟수', '누적결제액', '식별채널'], customerRows))
await write('meoktu-debt-sample.csv', csv(['기준월', '금융기관', '대출종류', '금리', '최초대출금', '잔액', '월원리금', '만기일'], debtRows))
await write('meoktu-staff-sample.csv', csv(['기준월', '직원수', '급여총액', '사회보험가입자수'], staffRows))
await write('meoktu-monthly-summary-sample.csv', csv(['기준월', '총매출', '배달매출', '배달비중(%)', '월임차료', '월원리금'], summaryRows))

const total = summaryRows.reduce((sum, row) => sum + row[1], 0)
console.log(`\n12개월 합계 매출 ${(total / 100000000).toFixed(2)}억원 · 월평균 ${(total / 12 / 10000).toFixed(0)}만원`)
console.log(`사업자: ${BUSINESS.name} / ${BUSINESS.owner} / ${BUSINESS.number} / ${BUSINESS.address}`)

// CSV만 다시 만들고 묶음을 그대로 두면 "전체 묶음 받기"가 옛 자료를 내려준다.
await rebuildSamplePack(out)
