import crypto from 'node:crypto'
import type { Fund, Restaurant, SalesPoint } from './types.ts'

/**
 * AI 점주 경영 리포트와 AI 인사이트 해석의 재료·검증·폴백을 모아둔 모듈.
 *
 * 원칙 세 가지.
 * 1) 숫자는 서버가 계산한다. 생성형에게는 이미 확정된 수치만 넘기고 해석만 시킨다.
 *    매출·쿠폰 사용률을 모델이 다시 계산하게 두면 화면 표와 리포트 문장이 어긋난다.
 * 2) 결과는 반드시 정규화·검증을 통과해야 화면에 나간다. 실패하면 규칙 기반 폴백으로 내려간다.
 *    AI 키가 없거나 호출이 실패해도 사장님 화면이 비지 않아야 한다.
 * 3) 같은 자료로는 같은 결과를 쓴다. factsFingerprint 로 캐시 키를 만들고, 자료가 실제로
 *    바뀐 달에만 다시 호출한다. "등록될 때마다 분석"이 곧 "볼 때마다 과금"이 되면 안 된다.
 */

export interface ReportBlock { title: string; body: string }

export interface OwnerReportFacts {
  restaurantId: string
  restaurantName: string
  category: string
  neighborhood: string
  openedYears: number
  reportMonth: string
  monthlySales: number
  previousSales: number | null
  salesChange: number
  repeatRate: number
  footTrafficGrowth: number
  closingRate: number
  competition: string
  rating: number
  reviewCount: number
  avgPrice: number
  maxMenuPrice: number
  couponIssued: number
  couponUsed: number
  couponUseRate: number
  outstandingCoupon: number
  couponExposure: number
  maxDiscount: number
  minIssueDiscount: number
  investorCount: number
  fundStatus: string
  fundProgress: number
  salesHistory: SalesPoint[]
  connectedSources: string[]
  hasCostData: boolean
  salesDisclosure: boolean
  area?: {
    name: string
    footTrafficGrowth: number
    localSalesGrowth: number
    closureRate: number
    competitorDensity: number
    rentGrowthRate: number
  }
}

export interface OwnerReport {
  headline: string
  salesCause: ReportBlock
  repeatPlan: ReportBlock
  couponPlan: ReportBlock & { discount: number }
  costCheck: ReportBlock & { items: string[] }
  tasks: string[]
  watchout: string
}

export interface InsightFacts {
  id: string
  name: string
  category: string
  neighborhood: string
  salesGrowth: number
  repeatRate: number
  stabilityScore: number
  closingRate: number
  footTrafficGrowth: number
  competition: string
  rating: number
  reviewCount: number
  openedYears: number
  riskLevel: string
  fundProgress: number
  maxDiscount: number
  minIssueDiscount: number
  /** 사장님이 월매출을 공개한 가게만 실제 금액이 들어간다. 비공개면 성장지수만 넘긴다. */
  monthlySales?: number
  salesDisclosure: boolean
}

export interface InsightCard { id: string; name: string; traits: string[]; caution: string }
export interface InsightSummary { cards: InsightCard[]; comparison: string }

export interface SalesAnomaly {
  month: string
  sales: number
  changeRate: number
  robustScore: number
  severity: 'warning' | 'critical'
  direction: 'increase' | 'decrease'
  reason: string
}

export interface AnomalyDetection {
  status: 'normal' | 'watch' | 'critical' | 'insufficient_data'
  method: string
  sampleSize: number
  baselineChangeRate: number
  expectedRange: { min: number; max: number }
  anomalies: SalesAnomaly[]
  summary: string
  nextChecks: string[]
}

const clampText = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
/**
 * 모델이 내부 필드명을 문장에 옮겨 적었는지 본다.
 * "footTrafficGrowth가 9.2%로" 같은 문장은 사장님에게 의미가 없으므로 통째로 폴백시킨다.
 * camelCase 만 잡으므로 POS·CSV·AI 같은 실제 한국어 문장 속 약어는 걸리지 않는다.
 */
export const leaksFieldName = (values: string[]) => values.some((text) => /[a-z]{2,}[A-Z][a-z]/.test(text))
const round1 = (value: number) => Number(value.toFixed(1))
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * 최근 월매출의 이상치를 강건 통계(Median/MAD)로 찾는다.
 * 평균·표준편차만 쓰면 한 번의 급등락이 기준선까지 끌고 가므로 작은 표본에는
 * 중앙값과 MAD를 쓴다. 탐지 수치와 판정은 생성형 AI가 바꾸지 못한다.
 */
export function detectSalesAnomalies(history: SalesPoint[]): AnomalyDetection {
  const points = history
    .filter((point) => /^\d{4}-\d{2}$/.test(point.month) && Number.isFinite(point.sales) && point.sales >= 0)
    .slice(-24)
  if (points.length < 6) return {
    status: 'insufficient_data', method: 'robust-mad-v1', sampleSize: points.length,
    baselineChangeRate: 0, expectedRange: { min: 0, max: 0 }, anomalies: [],
    summary: `월매출 자료가 ${points.length}개월뿐이라 이상 여부를 판단하지 않았습니다. 최소 6개월 자료가 필요합니다.`,
    nextChecks: ['최근 6개월 이상의 월별 POS 매출을 연결하기'],
  }

  const changes = points.slice(1).map((point, index) => {
    const previous = points[index].sales
    return previous > 0 ? (point.sales - previous) / previous * 100 : 0
  })
  const center = median(changes)
  const mad = median(changes.map((value) => Math.abs(value - center)))
  // 완만한 계열의 작은 잡음을 이상으로 오인하지 않도록 최소 변동 폭 4%p를 둔다.
  const robustSigma = Math.max(4, mad / 0.6745)
  const expectedHalfWidth = Math.max(12, robustSigma * 3.5)
  const expectedRange = { min: round1(center - expectedHalfWidth), max: round1(center + expectedHalfWidth) }
  const anomalies = changes.flatMap((change, index): SalesAnomaly[] => {
    const robustScore = Math.abs(change - center) / robustSigma
    // 통계 점수뿐 아니라 20% 이상의 실질 변화가 함께 있어야 경고한다.
    if (robustScore < 3.5 || Math.abs(change) < 20) return []
    const point = points[index + 1]
    const severity = robustScore >= 5 || Math.abs(change) >= 35 ? 'critical' : 'warning'
    const direction = change >= 0 ? 'increase' : 'decrease'
    return [{
      month: point.month, sales: point.sales, changeRate: round1(change), robustScore: round1(robustScore),
      severity, direction,
      reason: `${point.month.replace('-', '년 ')}월 매출 변화 ${change >= 0 ? '+' : ''}${round1(change)}%가 평소 변화 범위(${expectedRange.min}%~${expectedRange.max}%)를 벗어났습니다.`,
    }]
  })
  const recent = anomalies.filter((item) => points.slice(-3).some((point) => point.month === item.month))
  const status = recent.some((item) => item.severity === 'critical') ? 'critical'
    : recent.length || anomalies.length ? 'watch' : 'normal'
  return {
    status, method: 'robust-mad-v1', sampleSize: points.length,
    baselineChangeRate: round1(center), expectedRange, anomalies,
    summary: anomalies.length
      ? `최근 ${points.length}개월 중 평소 흐름을 벗어난 달이 ${anomalies.length}개 감지됐습니다. 원인을 단정하지 않고 POS 취소·영업일·행사·휴점 기록과 먼저 대조해야 합니다.`
      : `최근 ${points.length}개월의 월매출 변화는 강건 통계 기준의 평소 범위 안에 있습니다.`,
    nextChecks: anomalies.length
      ? ['POS 취소·환불과 누락 거래 확인', '휴점·영업일수·행사 일정 대조', '카드 정산액과 사업계좌 입금액 교차확인']
      : ['다음 달 매출 입력 후 같은 기준으로 다시 확인'],
  }
}

/** 자료가 실제로 바뀌었을 때만 다시 분석하기 위한 지문. */
export function factsFingerprint(value: unknown) {
  return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

export const ANOMALY_EXPLANATION_SYSTEM = `당신은 식당 월매출 이상탐지 결과를 설명하는 한국어 분석가입니다.
- 수치 판정은 강건 통계 엔진이 확정했습니다. 탐지 건수·월·증감률을 바꾸거나 새 이상을 만들지 마세요.
- 이상은 오류나 부정을 뜻하지 않습니다. 확인 순서만 설명하고 원인을 단정하지 마세요.
- 수익·매출 회복을 보장하거나 투자 판단을 권유하지 마세요.
- JSON 객체 하나만 출력하세요.`

export function anomalyExplanationPrompt(result: AnomalyDetection) {
  const schema = { summary: '<2문장 이내>', nextChecks: ['<확인할 일 1>', '<확인할 일 2>', '<확인할 일 3>'] }
  return `다음 통계 탐지 결과를 사장님이 이해할 수 있게 설명하세요.\n${JSON.stringify(result)}\n\n${JSON.stringify(schema)}`
}

export function applyAnomalyExplanation(result: AnomalyDetection, parsed: Record<string, unknown>): AnomalyDetection | null {
  const summary = clampText(parsed.summary, 320)
  const nextChecks = (Array.isArray(parsed.nextChecks) ? parsed.nextChecks : [])
    .map((item) => clampText(item, 100)).filter(Boolean).slice(0, 4)
  if (!summary || nextChecks.length < 2 || leaksFieldName([summary, ...nextChecks])) return null
  return { ...result, summary, nextChecks }
}

const sourceLabels: Record<string, string> = {
  pos: 'POS 매출', account: '사업용 계좌', card: '카드·VAN 정산',
  delivery: '배달 플랫폼', tax: '세무 신고자료', debt: '대출·상환정보',
}

/** 원가·급여·수수료를 말하려면 실제 자료가 붙어 있어야 한다. 없으면 '점검 항목'까지만 말한다. */
const costCapableSources = ['account', 'card', 'tax', 'debt']

export function buildOwnerReportFacts(input: {
  restaurant: Restaurant
  fund?: Fund
  connectedSources: string[]
  area?: OwnerReportFacts['area']
}): OwnerReportFacts {
  const { restaurant, fund } = input
  const history = (restaurant.salesHistory || []).slice(-6)
  const current = history.at(-1)
  const previous = history.at(-2)
  const salesChange = current?.growthRate
    ?? (previous?.sales && current?.sales ? (current.sales - previous.sales) / previous.sales * 100 : restaurant.salesGrowth)
  const couponIssued = fund?.totalCouponIssued || 0
  const couponUsed = fund?.totalCouponUsed || 0
  const outstanding = Math.max(0, couponIssued - couponUsed)
  const monthlySales = current?.sales || restaurant.monthlySales
  const connectedSources = [...new Set(input.connectedSources)].filter((item) => item in sourceLabels)
  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    category: restaurant.category,
    neighborhood: restaurant.neighborhood,
    openedYears: restaurant.openedYears,
    reportMonth: current?.month || new Date().toISOString().slice(0, 7),
    monthlySales,
    previousSales: previous?.sales ?? null,
    salesChange: round1(salesChange),
    repeatRate: restaurant.repeatRate,
    footTrafficGrowth: restaurant.footTrafficGrowth,
    closingRate: restaurant.closingRate,
    competition: restaurant.competition,
    rating: restaurant.rating,
    reviewCount: restaurant.reviewCount,
    avgPrice: restaurant.avgPrice,
    maxMenuPrice: restaurant.maxMenuPrice,
    couponIssued,
    couponUsed,
    couponUseRate: couponIssued ? Math.round(couponUsed / couponIssued * 100) : 0,
    outstandingCoupon: outstanding,
    couponExposure: monthlySales ? Math.min(100, Math.round(outstanding / monthlySales * 100)) : 0,
    maxDiscount: fund?.maxDiscount || 0,
    minIssueDiscount: fund?.minIssueDiscount || 0,
    investorCount: fund?.investorCount || 0,
    fundStatus: fund?.status || 'none',
    fundProgress: fund?.goal ? Math.round(fund.raised / fund.goal * 100) : 0,
    salesHistory: history,
    connectedSources,
    hasCostData: connectedSources.some((item) => costCapableSources.includes(item)),
    salesDisclosure: Boolean(restaurant.salesDisclosure),
    area: input.area,
  }
}

/** 업종별 비용 점검 항목. 원가 자료가 없을 때 '무엇부터 확인할지'만 알려주는 용도다. */
function costItemsFor(category: string) {
  if (category === '베이커리') return ['식재료·포장재 단가', '오븐 전력비', '폐기율']
  if (category === '카페') return ['원두·유제품 단가', '배달 수수료', '인건비']
  return ['식재료 원가', '배달·결제 수수료', '인건비']
}

/** 제안 할인율은 어느 경로로 만들어졌든 이 범위를 벗어나면 안 된다. */
function clampDiscount(value: number, facts: OwnerReportFacts) {
  const ceiling = facts.maxDiscount > 0 ? facts.maxDiscount : 15
  const floor = Math.min(facts.minIssueDiscount > 0 ? facts.minIssueDiscount : 5, ceiling)
  if (!Number.isFinite(value)) return Math.min(10, ceiling)
  return Math.max(floor, Math.min(ceiling, Math.round(value)))
}

/** AI 없이도 같은 모양으로 나가는 규칙 기반 리포트. 키 미설정·호출 실패·검증 실패의 착지점. */
export function ownerReportFallback(facts: OwnerReportFacts): OwnerReport {
  const costItems = costItemsFor(facts.category)
  const discount = clampDiscount(facts.repeatRate < 55 ? 15 : 10, facts)
  return {
    headline: `${facts.reportMonth.replace('-', '년 ')}월 ${facts.restaurantName}의 매출은 전월 대비 ${facts.salesChange >= 0 ? '+' : ''}${facts.salesChange}%, 재방문율은 ${facts.repeatRate}%입니다.`,
    salesCause: {
      title: facts.salesChange >= 0 ? '매출 흐름이 유지·상승 중입니다' : '매출 감소 요인 점검이 필요합니다',
      body: facts.salesChange >= 3
        ? `유동인구 증가율 ${facts.footTrafficGrowth}%와 재방문율 ${facts.repeatRate}%가 매출 상승에 함께 영향을 준 것으로 보입니다.`
        : facts.salesChange >= 0
          ? '매출은 유지됐지만 성장 폭이 작습니다. 신규 유입보다 재방문 고객의 기여도를 먼저 확인해보세요.'
          : '매출이 전월보다 감소했습니다. 상권 유동인구와 시간대별 주문 감소를 나눠 확인할 필요가 있습니다.',
    },
    repeatPlan: {
      title: `현재 재방문율 ${facts.repeatRate}%`,
      body: facts.repeatRate >= 65
        ? '단골 비중이 높은 편입니다. 기존 고객에게 방문 주기별 감사 혜택을 제공해 이탈을 줄여보세요.'
        : '첫 방문 후 14일 안에 재방문할 수 있는 소액 쿠폰과 대표 메뉴 알림을 시험해보세요.',
    },
    couponPlan: {
      discount,
      title: `${discount}% 소규모 실험`,
      body: '전체 고객에게 일괄 적용하지 말고 재방문 대상에게 2주간 시험한 뒤 사용률과 객단가를 비교하세요.',
    },
    costCheck: {
      title: facts.hasCostData ? '연결된 자료로 확인할 항목' : '직접 비용 자료 미연동',
      items: costItems,
      body: facts.hasCostData
        ? `연결된 ${facts.connectedSources.map((item) => sourceLabels[item]).join('·')} 자료에서 아래 항목의 월별 추이를 먼저 확인해보세요.`
        : '실제 매입·급여·수수료 자료가 연결되기 전에는 비용이 늘었다고 단정할 수 없습니다. 아래 항목부터 장부와 대조해보세요.',
    },
    tasks: [
      '시간대별 매출과 전월 차이를 주 1회 기록하기',
      `재방문 고객 대상 ${discount}% 쿠폰을 소규모로 2주간 시험하기`,
      `${costItems[0]}의 매입 단가와 사용량을 분리해 확인하기`,
    ],
    watchout: facts.couponExposure >= 15
      ? `미사용 쿠폰 최대 할인액이 ${won(facts.outstandingCoupon)}으로 월매출의 ${facts.couponExposure}%입니다. 다음 발급의 할인율과 범위를 먼저 조정해보세요.`
      : '이 리포트는 운영 판단을 돕는 참고 정보입니다. 원가·세무·노무 자료가 연결되지 않은 항목은 실제 장부와 전문가 확인을 거쳐주세요.',
  }
}

export const OWNER_REPORT_SYSTEM = `당신은 한국 소상공인 식당의 월간 운영 데이터를 읽고 사장님에게 설명하는 분석가입니다.
지켜야 할 규칙:
- 반드시 한국어로만 씁니다. 영어 단어를 섞지 않습니다.
- 주어진 수치만 사용합니다. 주어지지 않은 금액·비율·순위를 새로 만들지 않습니다.
- 인과관계를 단정하지 않습니다. "~로 보입니다", "~를 함께 확인해보세요"처럼 씁니다.
- connectedSources 에 원가·세무·계좌 자료가 없으면 비용이 늘었다고 말하지 않고, 무엇을 확인해야 하는지만 말합니다.
- 수익 보장, 매출 상승 보장, 투자 권유는 절대 쓰지 않습니다.
- 각 문장은 사장님이 내일 실제로 할 수 있는 행동으로 끝냅니다.
- 지정한 JSON 객체 하나만 출력합니다. 설명 문장이나 코드블록을 덧붙이지 않습니다.`

/**
 * 생성형에게 넘기는 재료는 한국어 라벨로 바꾼다.
 * 영문 키를 그대로 주면 모델이 "footTrafficGrowth가 9.2%로" 처럼 필드명을 문장에 옮겨 적는다.
 * 사장님이 읽을 글에 내부 변수명이 나오면 안 된다.
 */
function ownerFactsInKorean(facts: OwnerReportFacts) {
  const labelled: Record<string, unknown> = {
    '가게 이름': facts.restaurantName,
    '업종': facts.category,
    '동네': facts.neighborhood,
    '영업 연차': `${facts.openedYears}년`,
    '기준 월': facts.reportMonth,
    '이번 달 매출': `${facts.monthlySales.toLocaleString('ko-KR')}원`,
    '지난 달 매출': facts.previousSales === null ? '자료 없음' : `${facts.previousSales.toLocaleString('ko-KR')}원`,
    '전월 대비 매출 변화': `${facts.salesChange}%`,
    '최근 6개월 매출 추이': facts.salesHistory.map((point) => `${point.month} ${point.sales.toLocaleString('ko-KR')}원(${point.growthRate >= 0 ? '+' : ''}${point.growthRate}%)`),
    '재방문율': `${facts.repeatRate}%`,
    '상권 유동인구 증가율': `${facts.footTrafficGrowth}%`,
    '주변 폐업률': `${facts.closingRate}%`,
    '경쟁 강도': facts.competition,
    '평점': `${facts.rating}점 (리뷰 ${facts.reviewCount}건)`,
    '객단가': `${facts.avgPrice.toLocaleString('ko-KR')}원`,
    '누적 발급 쿠폰 최대 할인액': `${facts.couponIssued.toLocaleString('ko-KR')}원`,
    '실제 사용된 쿠폰 할인액': `${facts.couponUsed.toLocaleString('ko-KR')}원`,
    '쿠폰 사용률': `${facts.couponUseRate}%`,
    '아직 사용되지 않은 쿠폰 부담': `${facts.outstandingCoupon.toLocaleString('ko-KR')}원`,
    '월매출 대비 미사용 쿠폰 비율': `${facts.couponExposure}%`,
    '쿠폰 최소 발급률': `${facts.minIssueDiscount}%`,
    '쿠폰 최대 할인율': `${facts.maxDiscount}%`,
    '투자자 수': `${facts.investorCount}명`,
    '모집 달성률': `${facts.fundProgress}%`,
    '연결된 원천자료': facts.connectedSources.length ? facts.connectedSources.map((item) => sourceLabels[item]) : '없음',
    '원가·세무 자료 연결 여부': facts.hasCostData ? '연결됨' : '연결 안 됨',
    '월매출 공개 여부': facts.salesDisclosure ? '공개' : '비공개',
  }
  if (facts.area) labelled['상권 정보'] = {
    '상권 이름': facts.area.name,
    '상권 유동인구 증가율': `${facts.area.footTrafficGrowth}%`,
    '상권 매출 증가율': `${facts.area.localSalesGrowth}%`,
    '상권 폐업률': `${facts.area.closureRate}%`,
    '경쟁 밀도': facts.area.competitorDensity,
    '임대료 상승률': `${facts.area.rentGrowthRate}%/년`,
  }
  return labelled
}

export function ownerReportPrompt(facts: OwnerReportFacts) {
  return `아래는 한 식당의 이번 달 확정 운영 수치입니다. 이 수치를 다시 계산하지 말고 해석만 하세요.

${JSON.stringify(ownerFactsInKorean(facts), null, 1)}

작성 지침:
- 숫자를 인용할 때는 위에 적힌 한국어 지표 이름을 그대로 쓰세요. 영문 단어나 변수명을 문장에 넣지 마세요.
- "원인"이라고 단정하지 말고 "함께 움직인 것으로 보입니다", "먼저 확인해보세요"처럼 쓰세요.
- 실행 과제는 무엇을·어떤 범위에·얼마 동안 할지와 무엇으로 결과를 확인할지를 함께 적으세요.
- 원가·세무 자료 연결 여부가 "연결 안 됨"이면 비용이 늘었다고 말하지 말고, 무엇을 장부와 대조해야 하는지만 쓰세요.
- 금액이 크다/작다를 말할 때는 반드시 월매출 대비 비율을 기준으로 판단하세요. 월매출 대비 미사용 쿠폰 비율이 8% 미만이면 부담이 크다고 쓰지 마세요.

다음 JSON 스키마로만 답하세요. <> 안은 채워야 할 설명이며 그 문구를 그대로 값으로 쓰면 안 됩니다.
{
 "headline":"<이번 달을 한 문장으로. 매출 변화와 재방문율을 함께 언급. 90자 이내>",
 "salesCause":{"title":"<매출 변화의 성격을 한 줄로. 24자 이내>","body":"<어떤 지표가 함께 움직였는지 짚어 설명. 상권 유동인구 증가율·재방문율·최근 6개월 매출 추이 중 실제 근거가 되는 값을 지목. 2~3문장>"},
 "repeatPlan":{"title":"<재방문율 관련 한 줄. 24자 이내>","body":"<이 가게의 재방문율 수준에 맞는 실행안. 대상·기간·확인 방법을 포함. 2~3문장>"},
 "couponPlan":{"discount":<제안 할인율 정수. 쿠폰 최소 발급률 이상, 쿠폰 최대 할인율 이하>,"title":"<제안을 한 줄로. 24자 이내>","body":"<왜 그 할인율인지, 어떤 범위에 얼마 동안 시험할지. 쿠폰 사용률과 월매출 대비 미사용 쿠폰 비율을 근거로. 2~3문장>"},
 "costCheck":{"title":"<비용 점검 상태를 한 줄로. 24자 이내>","items":["<가장 먼저 확인할 비용 항목 3개. 이 업종에서 실제로 큰 비용부터. 각 16자 이내>"],"body":"<무엇을 어떤 자료와 대조해야 하는지. 2문장>"},
 "tasks":["<다음 달 실행 과제 3개. 각 45자 이내. '무엇을 얼마 동안 하고 무엇으로 확인한다' 형태로>"],
 "watchout":"<이 가게에서 지금 가장 주의해야 할 점 한 문장. 월매출 대비 미사용 쿠폰 비율이 높으면 그 부담을 먼저 언급>"
}`
}

/** 모델이 만든 리포트를 화면에 내보내도 되는 모양으로 자른다. 핵심 칸이 비면 폴백을 쓴다. */
export function normalizeOwnerReport(parsed: Record<string, unknown>, facts: OwnerReportFacts): OwnerReport | null {
  const block = (value: unknown, titleMax = 40): ReportBlock | null => {
    if (!value || typeof value !== 'object') return null
    const title = clampText((value as { title?: unknown }).title, titleMax)
    const body = clampText((value as { body?: unknown }).body, 320)
    return title && body ? { title, body } : null
  }
  const headline = clampText(parsed.headline, 140)
  const salesCause = block(parsed.salesCause)
  const repeatPlan = block(parsed.repeatPlan)
  const couponRaw = parsed.couponPlan as Record<string, unknown> | undefined
  const couponPlan = block(couponRaw)
  const costRaw = parsed.costCheck as Record<string, unknown> | undefined
  const costCheck = block(costRaw)
  const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).map((item) => clampText(item, 90)).filter(Boolean).slice(0, 4)
  if (!headline || !salesCause || !repeatPlan || !couponPlan || !costCheck || tasks.length < 2) return null
  const items = (Array.isArray(costRaw?.items) ? costRaw!.items : []).map((item) => clampText(item, 24)).filter(Boolean).slice(0, 4)
  return {
    headline,
    salesCause,
    repeatPlan,
    couponPlan: { ...couponPlan, discount: clampDiscount(Number(couponRaw?.discount), facts) },
    costCheck: { ...costCheck, items: items.length ? items : costItemsFor(facts.category) },
    tasks,
    watchout: clampText(parsed.watchout, 220) || ownerReportFallback(facts).watchout,
  }
}

/** 공개정보 해석의 규칙 기반 폴백. 화면에 있던 임계값 판정을 서버로 옮겨 문장까지 완성한다. */
export function insightFallback(facts: InsightFacts[]): InsightSummary {
  const cards = facts.map((item) => {
    const traits: string[] = []
    if (item.salesGrowth >= 22) traits.push(`매출 성장률이 ${item.salesGrowth}%로 높아 빠른 성장세를 중요하게 보는 분께 참고가 됩니다.`)
    if (item.repeatRate >= 65) traits.push(`재방문율이 ${item.repeatRate}%로 단골 기반의 꾸준함이 지표에 드러납니다.`)
    if (item.stabilityScore >= 88) traits.push(`상권 안정성 ${item.stabilityScore}점으로 주변 폐업률 대비 운영 안정성이 높은 편입니다.`)
    if (item.maxDiscount >= 45) traits.push(`최대 할인율이 ${item.maxDiscount}%까지 설정돼 쿠폰 혜택 폭이 넓습니다.`)
    if (item.fundProgress < 65) traits.push(`모집 달성률이 ${item.fundProgress}%로 아직 초기 단계입니다.`)
    return {
      id: item.id,
      name: item.name,
      traits: traits.slice(0, 2).length ? traits.slice(0, 2) : ['여러 지표가 중간 범위에 있어 한 가지 성향보다 균형 비교가 필요합니다.'],
      caution: item.closingRate >= 12
        ? `주변 폐업률이 ${item.closingRate}%로 높아 상권 변동을 함께 확인해야 합니다.`
        : `종합 위험은 ${item.riskLevel} 수준으로 표시돼 있으며, 회수 시점은 보장되지 않습니다.`,
    }
  })
  return {
    cards,
    comparison: `선택한 ${facts.length}곳은 성장률 ${facts.map((item) => `${item.name} ${item.salesGrowth}%`).join(', ')}로 공개 수치가 다릅니다. 같은 항목끼리 나란히 보고 본인의 방문 가능성과 감수할 수 있는 범위를 기준으로 판단해주세요.`,
  }
}

export const INSIGHT_SUMMARY_SYSTEM = `당신은 공개된 상권·식당 지표를 있는 그대로 설명하는 해설자입니다.
지켜야 할 규칙:
- 반드시 한국어로만 씁니다.
- 주어진 수치만 사용합니다. 없는 값을 만들지 않습니다.
- 특정 가게가 더 낫다거나 유리하다고 말하지 않습니다. 순위를 매기지 않고 투자 금액을 제안하지 않습니다.
- 수익·원금·회수 시점을 보장하는 표현을 쓰지 않습니다.
- salesDisclosure 가 false 인 가게는 월매출 금액을 언급하지 않고 성장지수로만 설명합니다.
- 각 문장은 어떤 지표가 근거인지 드러나게 씁니다.
- 지정한 JSON 객체 하나만 출력합니다.`

function insightFactsInKorean(facts: InsightFacts[]) {
  return facts.map((item) => ({
    '식별자': item.id,
    '가게 이름': item.name,
    '업종': item.category,
    '동네': item.neighborhood,
    '매출 성장률': `${item.salesGrowth}%`,
    '재방문율': `${item.repeatRate}%`,
    '상권 안정성 점수': `${item.stabilityScore}점 (100점 만점)`,
    '주변 폐업률': `${item.closingRate}%`,
    '상권 유동인구 증가율': `${item.footTrafficGrowth}%`,
    '경쟁 강도': item.competition,
    '평점': `${item.rating}점 (리뷰 ${item.reviewCount}건)`,
    '영업 연차': `${item.openedYears}년`,
    '종합 위험': item.riskLevel,
    '모집 달성률': `${item.fundProgress}%`,
    '쿠폰 최소 발급률': `${item.minIssueDiscount}%`,
    '쿠폰 최대 할인율': `${item.maxDiscount}%`,
    // 비공개 가게는 금액 자체를 넘기지 않는다. 성장률만으로 설명해야 한다.
    '월매출': item.salesDisclosure && item.monthlySales !== undefined ? `${item.monthlySales.toLocaleString('ko-KR')}원` : '사장님이 비공개로 설정 — 금액을 언급하지 말 것',
  }))
}

export function insightPrompt(facts: InsightFacts[]) {
  return `아래는 이용자가 비교하려고 선택한 가게들의 공개 지표입니다.

${JSON.stringify(insightFactsInKorean(facts), null, 1)}

작성 지침:
- 숫자를 인용할 때는 위에 적힌 한국어 지표 이름을 그대로 쓰세요. 영문 단어나 변수명을 문장에 넣지 마세요.
- 어느 가게가 더 낫다고 말하지 말고, 각 가게의 수치가 어떤 성격인지만 설명하세요.

다음 JSON 스키마로만 답하세요.
{
 "cards":[{"id":"<위 데이터의 식별자 값 그대로>","traits":["<이 가게의 수치가 보여주는 특징 2개. 각 문장에 근거 지표와 값을 넣고 70자 이내>"],"caution":"<이 가게를 볼 때 함께 확인해야 할 점 한 문장. 60자 이내>"}],
 "comparison":"<선택한 가게들의 수치가 서로 어떻게 다른지 2~3문장. 어느 쪽이 낫다고 말하지 말고 차이의 성격만 설명>"
}
cards 는 반드시 위 데이터에 있는 모든 가게를 같은 순서로 포함하세요.`
}

export function normalizeInsight(parsed: Record<string, unknown>, facts: InsightFacts[]): InsightSummary | null {
  const raw = Array.isArray(parsed.cards) ? parsed.cards as Record<string, unknown>[] : []
  const comparison = clampText(parsed.comparison, 400)
  if (!comparison) return null
  const cards = facts.map((item) => {
    const found = raw.find((card) => String(card?.id || '') === item.id)
    const traits = (Array.isArray(found?.traits) ? found!.traits : []).map((trait) => clampText(trait, 140)).filter(Boolean).slice(0, 3)
    const caution = clampText(found?.caution, 160)
    const text = [...traits, caution].join(' ')
    const allowedNumbers = [item.salesGrowth, item.repeatRate, item.stabilityScore, item.closingRate, item.footTrafficGrowth,
      item.rating, item.reviewCount, item.openedYears, item.fundProgress, item.maxDiscount, item.minIssueDiscount]
    const grounded = allowedNumbers.some((value) => new RegExp(`(^|[^\\d])${String(value).replace('.', '\\.')}([^\\d]|$)`).test(text))
    const leaksPrivateSales = !item.salesDisclosure && /[\d,]+\s*원/.test(text)
    return traits.length && grounded && !leaksPrivateSales ? { id: item.id, name: item.name, traits, caution } : null
  })
  // 한 가게라도 해석이 비면 화면에 빈 카드가 생긴다. 그럴 바에는 규칙 기반 전체를 쓴다.
  const namesGrounded = facts.every((item) => comparison.includes(item.name))
  return cards.every(Boolean) && namesGrounded ? { cards: cards as InsightCard[], comparison } : null
}
