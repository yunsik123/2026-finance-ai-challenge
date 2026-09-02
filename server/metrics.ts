/**
 * 원자료 집계 엔진.
 *
 * 사장님이 올린 CSV를 서버에서 직접 읽어 심사 지표를 계산한다.
 *
 * 왜 만들었나
 * -----------
 * 이 자리에는 원래 이런 코드가 있었다.
 *
 *   const numericSeed = [...restaurantName].reduce((s, c) => s + c.charCodeAt(0), 0)
 *   const monthlySales = 32000000 + (numericSeed % 1700) * 10000
 *   const salesGrowth  = Number((8.5 + (numericSeed % 83) / 10).toFixed(1))
 *
 * 상호명 글자코드로 만든 결정론적 난수다. 파일을 올려도 읽지 않았고,
 * 같은 상호면 어떤 파일을 올리든 늘 같은 매출이 나왔다.
 * 그 값이 신용등급 35개 지표의 입력으로 그대로 들어갔으니
 * 등급 자체가 자료와 무관했다.
 *
 * 이제 여기서 실제 행을 세고 합산한다. 읽어내지 못한 지표는 지어내지 않고
 * null(미산정)로 남긴다. assessCredit()이 가중치에서 빼고 재정규화하며
 * coverage가 떨어져 "무엇을 모르는지"가 화면에 드러난다.
 *
 * 개인정보
 * --------
 * 원본 텍스트는 이 모듈 안에서만 존재하고 집계값만 밖으로 나간다.
 * 호출부는 반환값만 저장하며 CSV 본문은 어디에도 기록하지 않는다.
 */

export type RawUpload = { sourceId: string; name: string; text: string }

export type MetricEvidence = {
  sourceId: string
  file: string
  rows: number
  columns: string[]
  /** 이 파일에서 실제로 계산해낸 지표 이름들. */
  produced: string[]
  note?: string
}

export type DerivedMetrics = Record<string, number | string | null>

const round1 = (value: number) => Number(value.toFixed(1))
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** 숫자 칸에 붙은 원화 기호·쉼표·공백을 걷어낸다. 빈 칸은 null. */
function toNumber(cell: string | undefined): number | null {
  if (cell === undefined) return null
  const cleaned = cell.replace(/[₩,\s"]/g, '').replace(/원$/, '')
  if (!cleaned || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm', 'YYYY-MM' 모두 월 키로 바꾼다. */
function toMonth(cell: string | undefined): string | null {
  if (!cell) return null
  const match = cell.match(/(\d{4})[-./](\d{1,2})/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : null
}

/**
 * 따옴표로 감싼 칸과 그 안의 쉼표를 지키는 CSV 파서.
 * 메뉴명에 쉼표가 들어간 POS 자료에서 split(',')만 쓰면 열이 밀린다.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const clean = text.replace(/^﻿/, '')
  const lines: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index]
    if (quoted) {
      if (character === '"') {
        if (clean[index + 1] === '"') { cell += '"'; index += 1 } else quoted = false
      } else cell += character
      continue
    }
    if (character === '"') { quoted = true; continue }
    if (character === ',') { row.push(cell); cell = ''; continue }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && clean[index + 1] === '\n') index += 1
      row.push(cell); cell = ''
      if (row.some((item) => item.trim())) lines.push(row)
      row = []
      continue
    }
    cell += character
  }
  row.push(cell)
  if (row.some((item) => item.trim())) lines.push(row)

  const headers = (lines.shift() || []).map((item) => item.trim())
  const rows = lines.map((line) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => { record[header] = (line[index] ?? '').trim() })
    return record
  })
  return { headers, rows }
}

/** 열 이름이 자료 제공처마다 조금씩 달라서 후보를 여러 개 받는다. */
function pick(row: Record<string, string>, ...candidates: string[]): string | undefined {
  for (const name of candidates) if (row[name] !== undefined && row[name] !== '') return row[name]
  return undefined
}

/** 월별 합계 맵을 월 오름차순 배열로 만든다. */
function byMonth(entries: Array<[string | null, number]>): Array<{ month: string; total: number }> {
  const map = new Map<string, number>()
  for (const [month, value] of entries) {
    if (!month) continue
    map.set(month, (map.get(month) || 0) + value)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, total]) => ({ month, total }))
}

/**
 * 성장률. 앞 3개월 평균 대비 뒤 3개월 평균의 변화율(%)이다.
 * 12개월 자료에서 양 끝 분기를 비교하는 방식이라 한 달치 이상값에 덜 흔들린다.
 */
function growthRate(series: Array<{ month: string; total: number }>, window = 3): number | null {
  if (series.length < window * 2) return null
  const head = series.slice(0, window).reduce((sum, item) => sum + item.total, 0) / window
  const tail = series.slice(-window).reduce((sum, item) => sum + item.total, 0) / window
  if (head <= 0) return null
  return round1((tail - head) / head * 100)
}

/** 변동성 = 월별 값의 변동계수(표준편차/평균, %). */
function volatility(series: Array<{ month: string; total: number }>): number | null {
  if (series.length < 3) return null
  const values = series.map((item) => item.total)
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean <= 0) return null
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return round1(Math.sqrt(variance) / mean * 100)
}


// ── 자료별 집계 ──────────────────────────────────────────────────────────────

/** POS 주문 원자료 → 매출 규모·성장·변동성·객단가·환불비율. */
function fromPos(rows: Record<string, string>[]) {
  const orders = rows.map((row) => ({
    month: toMonth(pick(row, '영업일', '주문일', '결제일', 'date')),
    amount: toNumber(pick(row, '주문금액', '결제금액', '금액', 'amount')) ?? 0,
    refund: toNumber(pick(row, '취소환불액', '취소금액', '환불액')) ?? 0,
  })).filter((order) => order.month)

  if (!orders.length) return { metrics: {}, produced: [] as string[] }

  const sales = byMonth(orders.map((order) => [order.month, order.amount - order.refund]))
  const counts = byMonth(orders.map((order) => [order.month, 1]))
  const grossTotal = orders.reduce((sum, order) => sum + order.amount, 0)
  const refundTotal = orders.reduce((sum, order) => sum + order.refund, 0)
  const monthlyAverage = sales.reduce((sum, item) => sum + item.total, 0) / sales.length

  const metrics: DerivedMetrics = {
    recent12MonthAverageSales: Math.round(monthlyAverage),
    recent12MonthSalesGrowth: growthRate(sales, 3),
    recent3MonthSalesGrowth: growthRate(sales, 1),
    salesVolatility: volatility(sales),
    averageTicket: orders.length ? Math.round(grossTotal / orders.length) : null,
    refundCancelRatio: grossTotal > 0 ? round1(refundTotal / grossTotal * 100) : null,
    transactionCountGrowth: growthRate(counts, 3),
    posMonthsObserved: sales.length,
    posOrderCount: orders.length,
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

/** 사업용 계좌 → 현금잔액·순현금흐름. 잔액은 계좌에서만 나올 수 있는 값이다. */
function fromAccount(rows: Record<string, string>[]) {
  const entries = rows.map((row) => ({
    month: toMonth(pick(row, '거래일시', '거래일', '일자', 'date')),
    inflow: toNumber(pick(row, '입금액', '입금', 'deposit')) ?? 0,
    outflow: toNumber(pick(row, '출금액', '출금', 'withdraw')) ?? 0,
    balance: toNumber(pick(row, '잔액', 'balance')),
  })).filter((entry) => entry.month)

  if (!entries.length) return { metrics: {}, produced: [] as string[] }

  const balances = entries.map((entry) => entry.balance).filter(isNum)
  // 월말 잔액의 평균이 아니라 거래 시점 잔액의 평균을 쓴다.
  // 월말에만 잔고를 채워두는 경우를 평균이 가려주지 않게 하기 위해서다.
  const net = byMonth(entries.map((entry) => [entry.month, entry.inflow - entry.outflow]))
  const inflow = byMonth(entries.map((entry) => [entry.month, entry.inflow]))

  const metrics: DerivedMetrics = {
    averageCashBalance: balances.length ? Math.round(balances.reduce((sum, value) => sum + value, 0) / balances.length) : null,
    minimumCashBalance: balances.length ? Math.round(Math.min(...balances)) : null,
    estimatedMonthlyOperatingCashflow: net.length ? Math.round(net.reduce((sum, item) => sum + item.total, 0) / net.length) : null,
    accountMonthlyInflow: inflow.length ? Math.round(inflow.reduce((sum, item) => sum + item.total, 0) / inflow.length) : null,
    accountMonthsObserved: net.length,
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

/** 카드 정산 → 실제 입금액. POS 매출과 대조해 일치도를 낸다. */
function fromCard(rows: Record<string, string>[]) {
  const entries = rows.map((row) => ({
    month: toMonth(pick(row, '승인일', '거래일', '일자')),
    approved: toNumber(pick(row, '승인금액')) ?? 0,
    cancelled: toNumber(pick(row, '취소금액')) ?? 0,
    settled: toNumber(pick(row, '실제입금액', '입금액', '정산금액')) ?? 0,
    fee: toNumber(pick(row, '수수료')) ?? 0,
  })).filter((entry) => entry.month)

  if (!entries.length) return { metrics: {}, produced: [] as string[] }
  const approved = entries.reduce((sum, entry) => sum + entry.approved - entry.cancelled, 0)
  const settled = entries.reduce((sum, entry) => sum + entry.settled, 0)
  const fee = entries.reduce((sum, entry) => sum + entry.fee, 0)
  const months = byMonth(entries.map((entry) => [entry.month, entry.approved - entry.cancelled]))

  const metrics: DerivedMetrics = {
    cardApprovedTotal: Math.round(approved),
    cardSettledTotal: Math.round(settled),
    cardFeeRatio: approved > 0 ? round1(fee / approved * 100) : null,
    cardMonthlyAverage: months.length ? Math.round(months.reduce((sum, item) => sum + item.total, 0) / months.length) : null,
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

/** 배달 플랫폼 → 배달 매출 비중과 재주문. */
function fromDelivery(rows: Record<string, string>[]) {
  const entries = rows.map((row) => ({
    month: toMonth(pick(row, '주문일', '일자', '기준월')),
    amount: toNumber(pick(row, '주문금액')) ?? 0,
    cancelled: toNumber(pick(row, '취소금액')) ?? 0,
    orders: toNumber(pick(row, '주문건수')) ?? 0,
    repeat: toNumber(pick(row, '재주문건수')) ?? 0,
    rating: toNumber(pick(row, '평균평점')),
  })).filter((entry) => entry.month)

  if (!entries.length) return { metrics: {}, produced: [] as string[] }
  const months = byMonth(entries.map((entry) => [entry.month, entry.amount - entry.cancelled]))
  const totalOrders = entries.reduce((sum, entry) => sum + entry.orders, 0)
  const repeatOrders = entries.reduce((sum, entry) => sum + entry.repeat, 0)
  const ratings = entries.map((entry) => entry.rating).filter(isNum)

  const metrics: DerivedMetrics = {
    deliveryMonthlyAverage: months.length ? Math.round(months.reduce((sum, item) => sum + item.total, 0) / months.length) : null,
    deliveryRepeatRatio: totalOrders > 0 ? round1(repeatOrders / totalOrders * 100) : null,
    deliveryRatingMean: ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null,
    deliveryOrderGrowth: growthRate(byMonth(entries.map((entry) => [entry.month, entry.orders])), 3),
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

/** 가명 고객 자료 → 재방문율과 신규 고객 증가율. */
function fromCustomer(rows: Record<string, string>[]) {
  const customers = rows.map((row) => ({
    visits: toNumber(pick(row, '방문횟수', '재방문횟수')) ?? 0,
    first: toMonth(pick(row, '첫방문일')),
  })).filter((customer) => customer.visits > 0)

  if (!customers.length) return { metrics: {}, produced: [] as string[] }
  const repeat = customers.filter((customer) => customer.visits >= 2).length
  const newByMonth = byMonth(customers.map((customer) => [customer.first, 1]))

  const metrics: DerivedMetrics = {
    repeatRate: round1(repeat / customers.length * 100),
    customerGrowth: growthRate(newByMonth, 3),
    customerCount: customers.length,
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

/**
 * 대출·상환 증빙 → 잔액·기관 수·월 원리금.
 * 연체 이력은 이 자료에 없다. 그래서 연체 지표는 계속 미산정으로 남는다.
 * (신용·부채 그룹 25점 중 17점이 연체 지표라 coverage가 눈에 띄게 떨어진다.
 *  그게 정확한 표시다. 없는 자료를 있는 것처럼 만들지 않는다.)
 */
function fromDebt(rows: Record<string, string>[]) {
  const entries = rows.map((row) => ({
    month: toMonth(pick(row, '기준월', '일자')),
    lender: pick(row, '금융기관', '기관명') || '',
    balance: toNumber(pick(row, '잔액', '대출잔액')) ?? 0,
    payment: toNumber(pick(row, '월원리금', '월상환액')) ?? 0,
    rate: toNumber(pick(row, '금리')),
  })).filter((entry) => entry.month)

  if (!entries.length) return { metrics: {}, produced: [] as string[] }
  // 가장 최근 기준월의 잔액 합이 현재 부채다. 전월 행까지 더하면 이중계상이 된다.
  const latest = entries.map((entry) => entry.month!).sort().at(-1)!
  const current = entries.filter((entry) => entry.month === latest)
  const rates = current.map((entry) => entry.rate).filter(isNum)

  const metrics: DerivedMetrics = {
    totalLoanBalance: Math.round(current.reduce((sum, entry) => sum + entry.balance, 0)),
    numberOfLenders: new Set(current.map((entry) => entry.lender).filter(Boolean)).size,
    monthlyDebtPayment: Math.round(current.reduce((sum, entry) => sum + entry.payment, 0)),
    averageInterestRate: rates.length ? Number((rates.reduce((sum, value) => sum + value, 0) / rates.length).toFixed(2)) : null,
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

/** 직원·급여 → 인원 추이. */
function fromStaff(rows: Record<string, string>[]) {
  const entries = rows.map((row) => ({
    month: toMonth(pick(row, '기준월', '일자')),
    headcount: toNumber(pick(row, '직원수', '인원')) ?? 0,
    payroll: toNumber(pick(row, '급여총액', '급여')) ?? 0,
  })).filter((entry) => entry.month).sort((a, b) => a.month!.localeCompare(b.month!))

  if (entries.length < 2) return { metrics: {}, produced: [] as string[] }
  const first = entries[0]
  const last = entries[entries.length - 1]

  const metrics: DerivedMetrics = {
    staffTrend: `${first.headcount}명 → ${last.headcount}명`,
    employeeCountGrowth: first.headcount > 0 ? round1((last.headcount - first.headcount) / first.headcount * 100) : null,
    monthlyPayroll: Math.round(entries.reduce((sum, entry) => sum + entry.payroll, 0) / entries.length),
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

/** 임대차 조건이 표로 온 경우. 월임차료를 매출 대비 비율로 쓴다. */
function fromLease(rows: Record<string, string>[]) {
  const rent = rows.map((row) => toNumber(pick(row, '월임차료', '월세', '임차료'))).find(isNum)
  const deposit = rows.map((row) => toNumber(pick(row, '보증금'))).find(isNum)
  const metrics: DerivedMetrics = {
    monthlyRent: isNum(rent) ? rent : null,
    leaseDeposit: isNum(deposit) ? deposit : null,
  }
  return { metrics, produced: Object.keys(metrics).filter((key) => isNum(metrics[key])) }
}

const handlers: Record<string, (rows: Record<string, string>[]) => { metrics: DerivedMetrics; produced: string[] }> = {
  pos: fromPos, account: fromAccount, card: fromCard, delivery: fromDelivery,
  customer: fromCustomer, debt: fromDebt, staff: fromStaff, lease: fromLease,
}


/**
 * 올라온 파일 전체를 읽어 심사 지표를 만든다.
 *
 * 자료 사이를 잇는 계산(배달 비중, 임차료 비율, 상환부담, 매출 교차검증)은
 * 개별 파일이 아니라 여기서 한다. 두 자료가 다 있어야 말이 되는 값이기 때문이다.
 */
export function deriveMetricsFromUploads(uploads: RawUpload[]) {
  const metrics: DerivedMetrics = {}
  const evidence: MetricEvidence[] = []
  const warnings: string[] = []

  for (const upload of uploads) {
    const handler = handlers[upload.sourceId]
    if (!handler) continue
    let parsed
    try {
      parsed = parseCsv(upload.text)
    } catch {
      warnings.push(`${upload.name}을(를) 표로 읽지 못했어요. 형식을 확인해주세요.`)
      continue
    }
    if (!parsed.rows.length) {
      warnings.push(`${upload.name}에 데이터 행이 없어요.`)
      continue
    }
    const result = handler(parsed.rows)
    if (!result.produced.length) {
      warnings.push(`${upload.name}에서 필요한 열을 찾지 못했어요. (읽은 열: ${parsed.headers.slice(0, 6).join(', ')})`)
    }
    Object.assign(metrics, result.metrics)
    evidence.push({
      sourceId: upload.sourceId, file: upload.name,
      rows: parsed.rows.length, columns: parsed.headers, produced: result.produced,
    })
  }

  // ── 자료를 가로질러야 나오는 값 ──────────────────────────────
  const sales = metrics.recent12MonthAverageSales
  const cashflow = metrics.estimatedMonthlyOperatingCashflow

  if (isNum(sales) && sales > 0) {
    if (isNum(metrics.deliveryMonthlyAverage)) {
      metrics.deliverySalesShare = round1(metrics.deliveryMonthlyAverage / sales * 100)
    }
    if (isNum(metrics.monthlyRent)) {
      metrics.rentToSalesRatio = round1(metrics.monthlyRent / sales * 100)
    }
    // 매출 교차검증: POS 매출과 계좌 입금이 얼마나 맞는가.
    // 100%를 넘으면 계좌에 매출 외 입금(대출·보조금)이 섞였다는 뜻이라 그대로 두고 경고한다.
    let reconciled = true
    if (isNum(metrics.accountMonthlyInflow) && metrics.accountMonthlyInflow > 0) {
      const rate = round1(Math.min(sales, metrics.accountMonthlyInflow) / Math.max(sales, metrics.accountMonthlyInflow) * 100)
      metrics.salesReconciliationRate = rate
      if (rate < 80) {
        reconciled = false
        warnings.push(`POS 매출과 계좌 입금의 차이가 커요. (일치도 ${rate}%) 매출 외 입금이 섞였거나 기간이 다른 자료일 수 있어 확인이 필요합니다.`)
      }
    }
    // 순현금흐름 비율은 '계좌에서 나온 현금흐름 ÷ POS에서 나온 매출'이다.
    // 두 자료가 서로 어긋나면 이 나눗셈은 실적이 아니라 불일치를 재는 값이 된다.
    // 실제로 POS 매출만 40%로 줄인 자료를 넣었더니 분모만 작아져서
    // 비율이 10.9% → 27.9%로 뛰고 신용점수가 올라갔다. 자료가 모순인데 등급이 좋아지면 안 된다.
    // 그래서 일치도가 낮으면 계산하지 않고 미산정으로 남긴다.
    if (isNum(cashflow)) {
      if (reconciled) metrics.netCashflowRatio = round1(cashflow / sales * 100)
      else warnings.push('POS와 계좌가 서로 맞지 않아 순현금흐름 비율은 미산정으로 두었어요.')
    }
    // 카드 정산 대조. 카드 승인액이 POS 매출을 넘으면 자료가 어긋난 것이다.
    if (isNum(metrics.cardMonthlyAverage) && metrics.cardMonthlyAverage > sales * 1.05) {
      warnings.push('카드 승인금액이 POS 매출보다 커요. 기간이 다른 자료가 섞였을 수 있습니다.')
    }
  }

  if (isNum(metrics.monthlyDebtPayment) && isNum(cashflow) && cashflow > 0) {
    metrics.debtServiceToCashflowRatio = round1(metrics.monthlyDebtPayment / cashflow * 100)
  }
  if (isNum(metrics.monthlyDebtPayment) && isNum(metrics.accountMonthlyInflow) && metrics.accountMonthlyInflow > 0) {
    metrics.debtRepaymentToInflow = round1(metrics.monthlyDebtPayment / metrics.accountMonthlyInflow * 100)
  }

  return { metrics, evidence, warnings }
}
