/**
 * 소상공인 35개 지표 · 6개 업종 신용평가 엔진.
 *
 * 출처와 계보
 * -----------
 * 지표 목록·가중치·등급 경계는 승재 프로젝트의 신용평가 시뮬레이터
 * (scripts/validate_credit_model.py, seed_credit_demo.py)에서 그대로 가져왔다.
 * 그쪽은 5,000개 합성 표본으로 규칙점수의 AUC/KS와 등급 단조성을 확인하는
 * 파이썬 배치였고, 여기서는 같은 정의를 요청 시점에 한 사업체에 적용한다.
 *
 * 근거 논문 (소상공인코딩 docs/PAPER_APPLICATIONS.md의 검토 결과를 따른다)
 *   · Blanco, Pino-Mejías, Lara & Rayo (2013) — 페루 미소금융 신용평가.
 *     재무비율만이 아니라 대출조건·연체·거시변수를 함께 쓰라는 설계를 받아들였다.
 *     단, 논문의 MLP는 재현하지 않는다. 우리에겐 같은 정의의 부도 라벨이 없다.
 *   · Rayo, Lara & Camino (2010) — 페루 Edpyme 로짓 모형(검증표본 정확도 77.70%).
 *     고객·사업·대출·거시 변수를 나눠 모으고, 점수가 심사자를 대체하지 않게 하는
 *     운영 구조를 받아들였다.
 *   · Hair et al. (2025) — 개인 신용점수 대신 사업 현금흐름을 중심에 둔다.
 *   · Nguyen & Sagara (2020, ADBI) — 현금잔액과 상환 현금유출을 핵심 변수로 둔다.
 *   · 윤상용(2019), 이동현 외(2020) — 상권 폐업률·활성도 변화를 지표로 쓴다.
 *
 * 하지 않는 것
 *   · 부도확률(PD)·예상손실·위험기반 금리를 계산하지 않는다.
 *   · 휴리스틱 기여도를 SHAP 값이라고 부르지 않는다.
 *   · 측정하지 못한 지표를 0점으로 깎지 않는다. 가중치에서 빼고 '미산정'으로 남긴다.
 *
 * 기존 5요소 상권 위험평가(trust.ts assessRestaurant)와는 서로를 대체하지 않는다.
 * trust.ts는 투자자에게 보여줄 '이 식당이 왜 이 점수인가'를 5개로 요약하고,
 * 여기는 사장님에게 보여줄 '내 신용등급이 왜 이 등급인가'를 35개로 펼친다.
 * combineAssessments()가 둘을 하나의 화면 값으로 묶는다.
 */

export const creditModelVersion = 'meoktu-credit-35v-v1'
export const industries = ['외식', '도소매', '숙박', '제조', '부동산', '보건'] as const
export type Industry = (typeof industries)[number]

export type FeatureGroup = '신용·부채' | '매출·거래' | '현금흐름' | '운영·상권' | '고객·평판'

type FeatureSpec = {
  key: string
  label: string
  group: FeatureGroup
  weight: number
  unit: string
  /** 값이 낮을수록 좋은 지표. */
  lowerIsBetter?: boolean
  /** 업종 기준분포의 하위10%·중앙·상위10% 값. 이 세 점을 지나는 꺾은선으로 백분위를 근사한다. */
  band: [number, number, number]
  /** 업종 규모에 비례해 기준선을 옮겨야 하는 지표. */
  scaleBy?: 'sales' | 'ticket'
  note?: string
}

/**
 * 가중치 합계 = 100. 승재 시뮬레이터의 WEIGHTS와 같다.
 * band 값은 시뮬레이터가 합성 데이터를 만들 때 쓴 분포 파라미터에서 뽑은 기준선이다.
 */
export const featureSpecs: FeatureSpec[] = [
  // ── 신용·부채 25 ─────────────────────────────────────────────
  { key: 'delinquency_12m', label: '최근 12개월 연체 횟수', group: '신용·부채', weight: 10, unit: '회', lowerIsBetter: true, band: [0, 0, 2] },
  { key: 'max_delinquency_days', label: '최대 연체일수', group: '신용·부채', weight: 7, unit: '일', lowerIsBetter: true, band: [0, 0, 45] },
  { key: 'total_loan_balance', label: '총 대출잔액', group: '신용·부채', weight: 5, unit: '원', lowerIsBetter: true, band: [8_000_000, 42_000_000, 180_000_000], scaleBy: 'sales' },
  { key: 'number_of_lenders', label: '거래 금융기관 수', group: '신용·부채', weight: 3, unit: '곳', lowerIsBetter: true, band: [0, 1, 4] },

  // ── 매출·거래 24 ─────────────────────────────────────────────
  { key: 'card_sales_avg_12m', label: '12개월 평균 카드매출', group: '매출·거래', weight: 5, unit: '원', band: [9_000_000, 24_000_000, 68_000_000], scaleBy: 'sales' },
  { key: 'sales_growth_3m', label: '최근 3개월 매출 성장률', group: '매출·거래', weight: 2.5, unit: '%', band: [-14, 4, 26] },
  { key: 'sales_growth_12m', label: '최근 12개월 매출 성장률', group: '매출·거래', weight: 3, unit: '%', band: [-11, 6, 24] },
  { key: 'relative_sales_growth', label: '상권 대비 상대 성장률', group: '매출·거래', weight: 3, unit: '%p', band: [-9, 1.5, 15] },
  { key: 'sales_volatility_12m', label: '매출 변동성', group: '매출·거래', weight: 4, unit: '%', lowerIsBetter: true, band: [8, 15, 28] },
  { key: 'transaction_count_growth', label: '결제건수 증가율', group: '매출·거래', weight: 2, unit: '%', band: [-13, 5, 24] },
  { key: 'average_ticket', label: '객단가', group: '매출·거래', weight: 1.5, unit: '원', band: [9_000, 16_000, 34_000], scaleBy: 'ticket' },
  { key: 'refund_cancel_ratio', label: '환불·취소 비율', group: '매출·거래', weight: 3, unit: '%', lowerIsBetter: true, band: [1.2, 3.4, 8.5] },

  // ── 현금흐름 27 ──────────────────────────────────────────────
  { key: 'avg_cash_balance', label: '평균 현금잔액', group: '현금흐름', weight: 6, unit: '원', band: [3_500_000, 14_000_000, 46_000_000], scaleBy: 'sales' },
  { key: 'min_cash_balance', label: '최저 현금잔액', group: '현금흐름', weight: 7, unit: '원', band: [500_000, 4_200_000, 18_000_000], scaleBy: 'sales' },
  { key: 'net_cashflow_ratio', label: '순현금흐름 비율', group: '현금흐름', weight: 7, unit: '%', band: [-4, 11, 27] },
  { key: 'debt_repayment_to_inflow', label: '원리금상환 / 현금유입', group: '현금흐름', weight: 7, unit: '%', lowerIsBetter: true, band: [8, 26, 62] },

  // ── 운영·상권 14 ─────────────────────────────────────────────
  { key: 'business_age', label: '업력', group: '운영·상권', weight: 4, unit: '년', band: [1, 4.5, 13] },
  { key: 'employee_count_growth', label: '직원 수 증가율', group: '운영·상권', weight: 2, unit: '%', band: [-16, 2, 24] },
  { key: 'area_sales_growth', label: '상권 매출 성장률', group: '운영·상권', weight: 1.5, unit: '%', band: [-3, 3.2, 11] },
  { key: 'foot_traffic_growth', label: '유동인구 증가율', group: '운영·상권', weight: 1.5, unit: '%', band: [-5, 3, 13] },
  { key: 'competitor_density', label: '경쟁 밀도', group: '운영·상권', weight: 1.5, unit: '지수', lowerIsBetter: true, band: [.35, .55, .82], note: '이정민·이승일(2021)의 U자형 결과 때문에 단독 감점이 아니라 낮은 가중치로만 반영한다.' },
  { key: 'area_closure_rate', label: '상권 폐업률', group: '운영·상권', weight: 2, unit: '%', lowerIsBetter: true, band: [5, 9.5, 17] },
  { key: 'relative_area_rank', label: '상권 내 상대순위', group: '운영·상권', weight: 1.5, unit: '%', band: [25, 52, 82] },

  // ── 고객·평판 10 ─────────────────────────────────────────────
  { key: 'customer_growth', label: '고객 수 증가율', group: '고객·평판', weight: 2, unit: '%', band: [-14, 5, 27] },
  { key: 'repeat_customer_rate', label: '재방문율', group: '고객·평판', weight: 3, unit: '%', band: [28, 46, 68] },
  { key: 'rating_mean', label: '평균 평점', group: '고객·평판', weight: .5, unit: '점', band: [3.7, 4.2, 4.7] },
  { key: 'rating_variance', label: '평점 분산', group: '고객·평판', weight: .4, unit: '', lowerIsBetter: true, band: [.25, .45, .85] },
  { key: 'review_growth', label: '리뷰 증가율', group: '고객·평판', weight: .4, unit: '%', band: [-15, 12, 62] },
  { key: 'negative_review_ratio', label: '부정 리뷰 비율', group: '고객·평판', weight: .8, unit: '%', lowerIsBetter: true, band: [4, 9, 20] },
  { key: 'taste_sentiment', label: '맛 만족도', group: '고객·평판', weight: .35, unit: '점', band: [52, 66, 80] },
  { key: 'price_sentiment', label: '가격 만족도', group: '고객·평판', weight: .35, unit: '점', band: [48, 63, 78] },
  { key: 'service_sentiment', label: '서비스 만족도', group: '고객·평판', weight: .35, unit: '점', band: [51, 66, 80] },
  { key: 'atmosphere_sentiment', label: '분위기 만족도', group: '고객·평판', weight: .35, unit: '점', band: [50, 65, 79] },
  { key: 'bookmark_growth', label: '찜·저장 증가율', group: '고객·평판', weight: .7, unit: '%', band: [-12, 16, 74] },
  { key: 'platform_visit_growth', label: '플랫폼 조회 증가율', group: '고객·평판', weight: .8, unit: '%', band: [-10, 14, 68] },
]

/**
 * 업종별 기준선 보정. 제조업 매출 3천만원과 외식업 매출 3천만원은
 * 같은 뜻이 아니므로 규모 지표의 기준분포를 업종 배수로 옮긴다.
 */
export const industryProfiles: Record<Industry, {
  salesScale: number; ticketScale: number; closureRate: number; typicalAge: number; note: string
}> = {
  외식: { salesScale: 1, ticketScale: 1, closureRate: 12.4, typicalAge: 4.2, note: '회전율이 높고 폐업률이 가장 높은 업종. 현금흐름 변동성이 등급을 크게 가릅니다.' },
  도소매: { salesScale: 1.35, ticketScale: 1.6, closureRate: 10.8, typicalAge: 5.6, note: '재고 회전과 매입채무가 현금흐름을 좌우해 최저 현금잔액을 특히 중요하게 봅니다.' },
  숙박: { salesScale: 1.6, ticketScale: 4.5, closureRate: 9.6, typicalAge: 6.1, note: '계절성이 커서 매출 변동성 기준을 완만하게 두고 상권 유동인구를 함께 봅니다.' },
  제조: { salesScale: 2.4, ticketScale: 8, closureRate: 7.2, typicalAge: 8.4, note: '거래처 편중과 수주 주기 때문에 결제건수보다 순현금흐름과 상환부담을 우선합니다.' },
  부동산: { salesScale: 1.1, ticketScale: 12, closureRate: 9.1, typicalAge: 7, note: '거래 건수가 적어 객단가·건수 지표의 해석이 제한적이고, 업력과 연체 이력 비중이 큽니다.' },
  보건: { salesScale: 2.1, ticketScale: 3.2, closureRate: 5.4, typicalAge: 7.8, note: '폐업률이 가장 낮고 매출이 안정적이라 같은 점수라도 상대순위가 낮게 나올 수 있습니다.' },
}

/** 음식점 카테고리를 6대 업종 코드로 옮긴다. */
export function toIndustry(category?: string): Industry {
  if (!category) return '외식'
  if (/(도매|소매|마트|편의점|판매)/.test(category)) return '도소매'
  if (/(숙박|호텔|모텔|게스트|펜션)/.test(category)) return '숙박'
  if (/(제조|공장|가공)/.test(category)) return '제조'
  if (/(부동산|중개)/.test(category)) return '부동산'
  if (/(의원|병원|약국|보건|한의)/.test(category)) return '보건'
  return '외식'
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** band의 세 점을 지나는 꺾은선으로 백분위를 근사한다. 바깥은 2~98로 자른다. */
function percentileOf(value: number, [low, mid, high]: [number, number, number]) {
  if (!Number.isFinite(value)) return 50
  if (value <= low) return clamp(10 - (low - value) / Math.max(1e-9, Math.abs(low) || 1) * 8, 2, 10)
  if (value <= mid) return 10 + (value - low) / Math.max(1e-9, mid - low) * 40
  if (value <= high) return 50 + (value - mid) / Math.max(1e-9, high - mid) * 40
  return clamp(90 + (value - high) / Math.max(1e-9, high - mid) * 8, 90, 98)
}

export type CreditInput = { industry?: Industry } & { [metric: string]: number | null | Industry | undefined }

export type FeatureResult = {
  key: string; label: string; group: FeatureGroup; weight: number; unit: string
  value: number | null
  /** 0~100. 높을수록 좋다. 미산정이면 null. */
  score: number | null
  measured: boolean
  note?: string
}

export type CreditAssessment = ReturnType<typeof assessCredit>

/**
 * 35개 지표를 업종 기준분포와 비교해 신용점수와 등급을 만든다.
 *
 * 측정되지 않은 지표는 가중치에서 빼고 나머지로 다시 정규화한다.
 * 그래서 자료를 덜 낸 사장님이 자동으로 낮은 등급을 받지 않고,
 * 대신 coverage(측정 가중치 비율)가 떨어져 신뢰도로 표시된다.
 */
export function assessCredit(input: CreditInput) {
  const industry = input.industry && industries.includes(input.industry) ? input.industry : '외식'
  const profile = industryProfiles[industry]

  const features: FeatureResult[] = featureSpecs.map((spec) => {
    const raw = input[spec.key] as number | null | undefined
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    if (value === null) {
      return { key: spec.key, label: spec.label, group: spec.group, weight: spec.weight, unit: spec.unit, value: null, score: null, measured: false, note: spec.note }
    }
    const scale = spec.scaleBy === 'sales' ? profile.salesScale : spec.scaleBy === 'ticket' ? profile.ticketScale : 1
    const band = spec.band.map((point) => point * scale) as [number, number, number]
    const percentile = percentileOf(value, band)
    const score = Number((spec.lowerIsBetter ? 100 - percentile : percentile).toFixed(1))
    return { key: spec.key, label: spec.label, group: spec.group, weight: spec.weight, unit: spec.unit, value, score, measured: true, note: spec.note }
  })

  const measured = features.filter((feature) => feature.measured)
  const measuredWeight = measured.reduce((sum, feature) => sum + feature.weight, 0)
  const coverage = Number((measuredWeight).toFixed(1)) // 가중치 합이 100이라 그대로 %가 된다.
  const rawScore = measuredWeight
    ? measured.reduce((sum, feature) => sum + feature.score! * feature.weight, 0) / measuredWeight
    : 50

  /**
   * 자료가 적을수록 점수를 중앙(50)으로 당긴다.
   *
   * 미산정 지표를 가중치에서 빼고 재정규화하면 점수는 나오지만, 그 점수가
   * 얼마나 믿을 만한지는 전혀 반영되지 않는다. 35개 중 10개만 본 63점과
   * 30개를 본 63점이 같은 등급으로 나가는 게 예전 동작이었다.
   *
   * 표본이 적을수록 추정치를 모집단 평균 쪽으로 당기는 표준적인 축소추정이다.
   * 한쪽으로만 깎는 게 아니라 양방향이라, 자료가 적다고 감점되지도 않고
   * 반대로 좋은 지표 몇 개만 내고 상위 등급을 받아 가지도 못한다.
   * 산정률 100%면 계수가 1이라 원점수가 그대로 나간다.
   */
  const SHRINK_K = 40
  const shrink = Number((((coverage / (coverage + SHRINK_K)) / (100 / (100 + SHRINK_K)))).toFixed(3))
  let score = Number((50 + (rawScore - 50) * shrink).toFixed(1))

  // 정책 오버라이드. 승재 시뮬레이터와 같은 규칙: 90일 이상 연체는 점수와 무관하게 D.
  // 이건 '자료가 없다'가 아니라 '나쁜 자료가 있다'이므로 축소추정을 거치지 않는다.
  const overrides: string[] = []
  const maxDelinquency = input.max_delinquency_days as number | null | undefined
  if (typeof maxDelinquency === 'number' && maxDelinquency >= 90) {
    overrides.push('최대 연체일수가 90일 이상이라 점수와 관계없이 최하 등급으로 고정했습니다.')
  }
  if (shrink < 1 && Math.abs(score - rawScore) >= 0.5) {
    overrides.push(`산정률 ${coverage}%에 맞춰 원점수 ${rawScore.toFixed(1)}점을 ${score}점으로 조정했습니다. 측정하지 못한 지표가 많을수록 판정을 평균에 가깝게 둡니다.`)
  }

  /**
   * 산정률 상한. 점수가 아무리 높아도 자료가 없으면 그 등급을 줄 수 없다.
   *
   * 상한은 위쪽으로만 건다. 자료가 없다는 것과 실적이 나쁘다는 것은 다른 문제라
   * C 아래로는 내리지 않는다. 자료 부족을 최하 등급으로 표시하면
   * 미산정을 감점하지 않는다는 원칙과 정면으로 어긋난다.
   */
  const gradeLadder = ['D', 'C', 'B', 'B+', 'A', 'A+'] as const
  const coverageCap = coverage >= 75 ? 'A+' : coverage >= 60 ? 'A' : coverage >= 45 ? 'B+' : coverage >= 30 ? 'B' : 'C'

  const scored = score >= 85 ? 'A+' : score >= 75 ? 'A' : score >= 65 ? 'B+' : score >= 55 ? 'B' : score >= 45 ? 'C' : 'D'
  const capped = gradeLadder.indexOf(scored as typeof gradeLadder[number]) > gradeLadder.indexOf(coverageCap)
  if (capped) {
    overrides.push(`측정된 지표의 가중치가 ${coverage}%라 ${scored} 판정을 보류하고 ${coverageCap}까지만 부여했습니다. 부족한 자료를 채우면 다시 산정합니다.`)
  }

  const forcedD = overrides.some((item) => item.includes('최하 등급'))
  const grade = forcedD ? 'D' : capped ? coverageCap : scored

  /**
   * 잠정 등급 여부. 산정률이 절반에 못 미치면 확정 등급이라고 말할 수 없다.
   * combineAssessments 가 같은 기준으로 수동 심사를 요청하므로 두 값이 늘 함께 움직인다.
   */
  const provisional = coverage < 50

  // 그룹별 요약. 사장님 화면에서 5개 막대로 보여준다.
  const groups = (['신용·부채', '매출·거래', '현금흐름', '운영·상권', '고객·평판'] as FeatureGroup[]).map((group) => {
    const inGroup = features.filter((feature) => feature.group === group)
    const known = inGroup.filter((feature) => feature.measured)
    const weight = inGroup.reduce((sum, feature) => sum + feature.weight, 0)
    const knownWeight = known.reduce((sum, feature) => sum + feature.weight, 0)
    return {
      group,
      weight: Number(weight.toFixed(1)),
      score: knownWeight ? Number((known.reduce((sum, feature) => sum + feature.score! * feature.weight, 0) / knownWeight).toFixed(1)) : null,
      measuredCount: known.length,
      totalCount: inGroup.length,
    }
  })

  // 기여도. 기준 50점 대비 가중 편차이며, SHAP 값이 아니다.
  const contributions = measured.map((feature) => ({
    key: feature.key, label: feature.label, group: feature.group,
    score: feature.score!, weight: feature.weight,
    contribution: Number(((feature.score! - 50) * feature.weight / 100).toFixed(2)),
  })).sort((a, b) => b.contribution - a.contribution)

  return {
    modelVersion: creditModelVersion,
    industry,
    industryNote: profile.note,
    score,
    /** 축소추정·상한을 적용하기 전의 원점수. 왜 등급이 조정됐는지 설명할 때 쓴다. */
    rawScore: Number(rawScore.toFixed(1)),
    grade,
    /** 산정률이 절반에 못 미쳐 확정 등급이라고 부를 수 없는 경우. */
    provisional,
    coverage,
    /** 측정된 지표 개수 / 전체 35개. */
    measuredCount: measured.length,
    totalCount: featureSpecs.length,
    confidence: Number(Math.min(95, 45 + coverage * .5).toFixed(0)),
    groups,
    features,
    contributions,
    topDrivers: contributions.slice(0, 5),
    topDrags: [...contributions].reverse().filter((item) => item.contribution < 0).slice(0, 5),
    missing: features.filter((feature) => !feature.measured).map((feature) => feature.label),
    overrides,
    methodology: {
      type: 'industry_percentile_weighted_rule_score',
      weightSum: 100,
      gradeBands: 'A+ 85 / A 75 / B+ 65 / B 55 / C 45 / D',
      calibratedProbability: false,
      missingHandling: '미산정 지표는 감점하지 않고 가중치에서 제외한 뒤 나머지로 재정규화. 산정률이 낮을수록 점수를 평균(50)으로 축소하고, 산정률 상한까지만 등급을 부여',
      coverageCap: `${coverageCap} (산정률 ${coverage}%)`,
      shrinkFactor: shrink,
      disclaimer: '이 결과는 먹투 성장성 예비평가입니다. 금융기관의 공식 신용평가나 정부 SCB 결과가 아니며 부도확률을 계산하지 않습니다.',
    },
    references: creditReferences,
  }
}

export const creditReferences = [
  { id: 'blanco2013', title: 'Credit scoring models for the microfinance industry using neural networks: Evidence from Peru', authors: 'Blanco, Pino-Mejías, Lara & Rayo (2013)', use: '재무비율만이 아니라 대출조건·연체·거시변수를 함께 나눠 저장하는 변수 설계', excluded: '논문의 MLP와 AUC·부도확률은 재현하지 않음 (동일 정의의 부도 라벨 없음)', url: 'https://doi.org/10.1016/j.eswa.2012.07.051' },
  { id: 'rayo2010', title: 'A Credit Scoring Model for Institutions of Microfinance under the Basel II Normative', authors: 'Rayo, Lara & Camino (2010)', use: '고객·사업·대출·거시 변수를 구분해 수집하고, 점수가 심사자를 대체하지 않게 하는 운영 구조', excluded: '내부등급법(IRB) 규제자본·예상손실·위험기반 금리는 계산하지 않음', url: 'https://www.scielo.org.pe/scielo.php?pid=S2077-18862010000100005&script=sci_arttext' },
  { id: 'hair2025', title: 'Modernizing Access to Credit for Younger Entrepreneurs: From FICO to Cash Flow', authors: 'Hair et al. (2025)', use: '대표자 개인 신용점수 대신 사업 현금흐름을 중심 지표로 배치 (현금흐름 그룹 27%)', url: 'https://doi.org/10.3386/w33367' },
  { id: 'adbi2020', title: 'Credit Risk Database for SME Financial Inclusion', authors: 'Nguyen & Sagara (2020, ADBI WP1111)', use: '현금잔액과 상환 관련 현금유출을 단기 위험의 핵심 변수로 채택', url: 'https://www.adb.org/publications/credit-risk-database-sme-financial-inclusion' },
  { id: 'yoon2019', title: '지역상권 특성이 자영업자 폐업률에 미치는 영향에 관한 연구', authors: '윤상용 (2019)', use: '상권 폐업률·유동인구·상권매출 성장을 운영·상권 그룹에 반영', url: 'https://doi.org/10.22778/jci.2019.42.3.21' },
  { id: 'lee2021', title: '상업시설 업종별 밀도가 음식점 폐업에 미치는 영향 분석', authors: '이정민·이승일 (2021)', use: '경쟁 밀도의 U자형 효과 때문에 단독 감점 대신 최저 가중치(1.5%)로만 반영', url: 'https://kpaj.or.kr/_PR/view/?aidx=28268&bidx=2492' },
]

/**
 * 5요소 상권 위험평가(trust.ts)와 35지표 신용등급을 하나로 묶는다.
 * 둘은 보는 대상이 달라 평균이 아니라 '함께 보여주기'가 맞다.
 * 다만 화면에 하나의 종합값이 필요해 가중 혼합값도 같이 낸다.
 */
export function combineAssessments(
  risk: { score: number; grade: string; riskLevel: string; confidence: number },
  credit: CreditAssessment,
) {
  // 상권·성장성(5요소) 40%, 신용·현금흐름(35지표) 60%.
  // 현금흐름을 앞세우라는 Hair et al.(2025)의 결론을 따른 배분이다.
  const blended = Number((risk.score * .4 + credit.score * .6).toFixed(1))
  const agreement = Math.abs(risk.score - credit.score)
  return {
    blendedScore: blended,
    creditGrade: credit.grade,
    riskGrade: risk.grade,
    confidence: Math.round((risk.confidence + credit.confidence) / 2),
    weights: { 성장성_상권_5요소: 40, 신용_현금흐름_35지표: 60 },
    agreement: Number(agreement.toFixed(1)),
    agreementNote: agreement <= 8
      ? '두 평가가 비슷한 결론을 냈어요.'
      : agreement <= 18
        ? '두 평가가 다소 다른 신호를 보내 운영자 확인이 도움이 됩니다.'
        : '두 평가의 차이가 커서 자동 판정 대신 운영자가 원본을 확인해야 합니다.',
    needsHumanReview: agreement > 18 || credit.overrides.length > 0 || credit.coverage < 50,
  }
}

/* ------------------------------------------------------------------ */
/* 실제 먹투 데이터 → 35개 지표                                        */
/* ------------------------------------------------------------------ */

export type DeriveSource = {
  industry?: Industry
  /** 연결·업로드된 원천자료 목록. 없는 자료가 채우는 지표는 미산정으로 남긴다. */
  connectedSources?: string[]
  /** /api/applications가 계산한 파생지표. */
  derivedMetrics?: Record<string, unknown>
  restaurant?: {
    salesGrowth?: number; repeatRate?: number; openedYears?: number
    footTrafficGrowth?: number; closingRate?: number; rating?: number
    reviewCount?: number; stabilityScore?: number; monthlySales?: number
    communityScore?: number; supporters?: number
  }
  commercialArea?: {
    competitorDensity?: number; closureRate?: number
    areaSalesGrowth?: number; footTrafficGrowth?: number
  }
  /** 먹투에 실제로 쌓인 리뷰. 없으면 평판 지표를 미산정으로 둔다. */
  reviews?: Array<{ rating: number }>
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * 있는 자료만으로 35개 지표를 채운다.
 *
 * 원칙: 해당 원천자료가 연결되지 않았으면 그 지표는 null(미산정)이다.
 * 추정으로 빈칸을 메우면 자료를 안 낸 사장님이 점수를 얻는 셈이 되고,
 * 반대로 0으로 채우면 감점이 된다. 둘 다 하지 않는다.
 */
export function deriveCreditInput(source: DeriveSource): CreditInput {
  const { connectedSources = [], derivedMetrics = {}, restaurant = {}, commercialArea = {}, reviews = [] } = source
  const has = (key: string) => connectedSources.includes(key)

  const monthlySales = num(derivedMetrics.recent12MonthAverageSales) ?? num(restaurant.monthlySales)
  const cashflow = num(derivedMetrics.estimatedMonthlyOperatingCashflow)
  const salesGrowth = num(derivedMetrics.recent12MonthSalesGrowth) ?? num(restaurant.salesGrowth)
  const debtRatio = num(derivedMetrics.debtServiceToCashflowRatio)

  const input: CreditInput = { industry: source.industry }

  // ── 신용·부채: 대출·상환 증빙이 있어야 산정 ──────────────────
  // 부채 증빙을 연결해도 그 서류에서 읽어낸 값만 쓴다.
  // 예전에는 연체·대출잔액·금융기관 수를 상호명 글자코드로 만든 난수로 채웠는데,
  // 그건 자료가 아니라 지어낸 숫자다. 가중치 최대 47.5점이 거기서 나왔고,
  // "90일 이상 연체면 무조건 D등급"이라는 정책 오버라이드까지 그 난수를 보고 발동했다.
  // 읽어내지 못한 값은 null(미산정)로 둔다. 모델이 가중치에서 빼고 재정규화하며,
  // coverage가 떨어져 "무엇을 모르는지"가 화면에 그대로 드러난다.
  input.delinquency_12m = num(derivedMetrics.delinquencyCount12m)
  input.max_delinquency_days = num(derivedMetrics.maxDelinquencyDays)
  input.total_loan_balance = num(derivedMetrics.totalLoanBalance)
  input.number_of_lenders = num(derivedMetrics.numberOfLenders)
  input.debt_repayment_to_inflow = debtRatio // 사장님이 신고한 값이 있으면 그것만 쓴다.

  // ── 매출·거래: POS 원자료 기준 ───────────────────────────────
  if (has('pos')) {
    input.card_sales_avg_12m = monthlySales
    input.sales_growth_12m = salesGrowth
    input.sales_growth_3m = num(derivedMetrics.recent3MonthSalesGrowth)
    input.sales_volatility_12m = num(derivedMetrics.salesVolatility)
    input.transaction_count_growth = num(derivedMetrics.transactionCountGrowth)
    input.average_ticket = num(derivedMetrics.averageTicket)
    input.refund_cancel_ratio = num(derivedMetrics.refundCancelRatio)
  }
  input.relative_sales_growth = num(derivedMetrics.relativeSalesGrowth)

  // ── 현금흐름: 사업용 계좌가 있어야 잔액을 말할 수 있다 ───────
  if (has('account') && monthlySales) {
    // 잔액은 계좌 원자료에서 나와야 한다. 매출에 계수를 곱해 만든 값은 잔액이 아니다.
    input.avg_cash_balance = num(derivedMetrics.averageCashBalance)
    input.min_cash_balance = num(derivedMetrics.minimumCashBalance)
    // 집계 단계에서 이미 계산·검증한 값을 쓴다.
    // 거기서 POS와 계좌의 일치도가 낮으면 이 값을 아예 만들지 않으므로,
    // 여기서 다시 나눠 계산하면 그 안전장치를 무력화하게 된다.
    input.net_cashflow_ratio = num(derivedMetrics.netCashflowRatio)
  }

  // ── 운영·상권 ────────────────────────────────────────────────
  input.business_age = num(derivedMetrics.operatingYears) ?? num(restaurant.openedYears)
  if (has('staff')) {
    const trend = String(derivedMetrics.staffTrend || '')
    const [before, after] = trend.split('→').map((part) => Number(part.replace(/[^0-9]/g, '')))
    input.employee_count_growth = Number.isFinite(before) && Number.isFinite(after) && before > 0
      ? Number(((after - before) / before * 100).toFixed(1))
      : null
  }
  input.area_sales_growth = num(commercialArea.areaSalesGrowth) ?? num(derivedMetrics.districtSalesGrowth)
  input.foot_traffic_growth = num(commercialArea.footTrafficGrowth) ?? num(restaurant.footTrafficGrowth)
  input.competitor_density = num(commercialArea.competitorDensity)
  input.area_closure_rate = num(commercialArea.closureRate) ?? num(restaurant.closingRate)
  input.relative_area_rank = num(restaurant.stabilityScore)

  // ── 고객·평판 ────────────────────────────────────────────────
  const repeatRate = num(derivedMetrics.repeatRate) ?? num(restaurant.repeatRate)
  if (has('customer') || has('delivery')) {
    input.repeat_customer_rate = repeatRate
    input.customer_growth = num(derivedMetrics.customerGrowth)
  } else {
    // 먹투 자체 재방문 지표가 있으면 그것만 쓰고, 고객 증가율은 미산정으로 둔다.
    input.repeat_customer_rate = repeatRate
  }

  if (reviews.length >= 3) {
    const ratings = reviews.map((review) => review.rating)
    const mean = ratings.reduce((sum, value) => sum + value, 0) / ratings.length
    const variance = ratings.reduce((sum, value) => sum + (value - mean) ** 2, 0) / ratings.length
    input.rating_mean = Number(mean.toFixed(2))
    input.rating_variance = Number(variance.toFixed(3))
    input.negative_review_ratio = Number((ratings.filter((value) => value <= 2).length / ratings.length * 100).toFixed(1))
  } else if (num(restaurant.rating) !== null && (restaurant.reviewCount ?? 0) >= 10) {
    input.rating_mean = num(restaurant.rating)
  }
  // 감성 4종·리뷰 증가율·찜·조회는 검증된 원문 리뷰 소스가 붙기 전까지 미산정으로 둔다.
  // (PAPER_APPLICATIONS.md의 Luca 2011 / Li 2023 검토 결론)

  return input
}
