export type Role = 'investor' | 'owner' | 'admin'

export interface SalesPoint { month: string; sales: number; growthRate: number; bonusRate: number }
export interface MenuHighlight { name: string; price: number; description: string }
export interface Review { id: string; restaurantId: string; userId: string; userName: string; rating: number; content: string; visitVerified: boolean; createdAt: string; status?: 'published' | 'hidden' }

export interface User { id: string; email: string; name: string; role: Role; cash: number; accountStatus?: 'active' | 'suspended'; createdAt: string; sessionMode?: 'account' | 'demo' }

export interface DataConnection {
  id: string; sourceId: 'pos' | 'account' | 'card' | 'delivery' | 'tax' | 'debt'; provider: string
  status: 'active' | 'revoked'; consentScope: string; recordCount: number; connectedAt: string; lastSyncedAt: string
}

export interface Fund {
  id: string; restaurantId: string; round: number; status: 'funding' | 'trading' | 'closed'; goal: number; raised: number
  maxDiscount: number; minIssueDiscount: number; dailyRatePer100k: number; salesBonus: number; earlyBonus: number
  startedAt: string; endsAt: string; purpose: string; investorCount: number; totalCouponIssued: number; totalCouponUsed: number
  openBuyAmount: number; openSellAmount: number; riskLevel: string
}

export interface Restaurant {
  id: string; ownerId?: string; verificationStatus?: 'submitted' | 'verified' | 'rejected'; sourceApplicationId?: string; name: string; emoji: string; category: string; region: string; neighborhood: string
  tagline: string; description: string; signature: string; avgPrice: number; maxMenuPrice: number; openedYears: number
  monthlySales: number; salesGrowth: number; repeatRate: number; footTrafficGrowth: number; competition: string; closingRate: number
  rating: number; reviewCount: number; supporters: number; communityScore: number; stabilityScore: number; story: string; color: string; tags: string[]
  foodDescription?: string; strengths?: string[]; menuHighlights?: MenuHighlight[]; diningNotes?: string
  salesDisclosure?: boolean; salesHistory?: SalesPoint[]; reviews?: Review[]; opportunityScore: number; fund: Fund
}

/** AI 점주 경영 리포트. 생성형이 만들든 규칙 폴백이든 서버가 같은 모양으로 내려준다. */
export interface ReportBlock { title: string; body: string }

export interface OwnerReport {
  headline: string
  salesCause: ReportBlock
  repeatPlan: ReportBlock
  couponPlan: ReportBlock & { discount: number }
  costCheck: ReportBlock & { items: string[] }
  tasks: string[]
  watchout: string
}

export interface OwnerReportFacts {
  reportMonth: string; monthlySales: number; salesChange: number; repeatRate: number
  couponUseRate: number; couponExposure: number; outstandingCoupon: number; maxDiscount: number
  area?: { name: string; footTrafficGrowth: number; localSalesGrowth: number; closureRate: number; competitorDensity: number; rentGrowthRate: number }
}

export interface OwnerReportResponse {
  facts: OwnerReportFacts; report: OwnerReport
  provider: 'google-vertex-ai' | 'meoktu-rule-engine'; model: string; generatedAt: string; cached: boolean
}

export interface SalesAnomaly {
  month: string
  sales: number
  changeRate: number
  robustScore: number
  severity: 'warning' | 'critical'
  direction: 'increase' | 'decrease'
  reason: string
}

export interface AnomalyDetectionResponse {
  result: {
    status: 'insufficient_data' | 'normal' | 'watch' | 'critical'
    method: 'robust-mad-v1'
    sampleSize: number
    baselineChangeRate: number
    expectedRange: { min: number; max: number }
    anomalies: SalesAnomaly[]
    summary: string
    nextChecks: string[]
  }
  provider: 'google-vertex-ai' | 'meoktu-statistical-engine'
  model: string
  generatedAt: string
  cached: boolean
}

export interface InsightCard { id: string; name: string; traits: string[]; caution: string }

export interface InsightSummaryResponse {
  summary: { cards: InsightCard[]; comparison: string }
  provider: 'google-vertex-ai' | 'meoktu-rule-engine'; model: string; generatedAt: string; cached: boolean
}

export interface PublicState {
  restaurants: Restaurant[]
  funds: Fund[]
  etfs: Array<{ id: string; name: string; emoji: string; region: string; category: string; restaurantIds: string[]; minimum: number; maxDiscount: number; growth: number; members: number; description: string }>
  articles: Array<{ id: string; eyebrow: string; title: string; summary: string; content: string; tags: string[]; icon: string; publishedAt: string; sourceName?: string; sourceUrl?: string; dataNote?: string }>
  listings: Listing[]
  exchange: {
    rules: ExchangeRules
    categories: string[]
    regions: string[]
    openListings: number
    completedTrades: number
    pendingOffers: number
  }
  stats: { funded: number; restaurants: number; supporters: number; couponUsed: number }
}

export interface Position {
  id: string; fundId: string; amount: number; early: boolean; couponProgress: number; availableAmount: number
  fund: Fund; restaurant: Restaurant
}

export type CouponStatus = 'available' | 'listed' | 'offered' | 'redeeming' | 'used' | 'expired'

export interface Coupon {
  id: string; userId?: string; restaurantId: string; fundId?: string; title: string; discount: number; maxDiscountWon: number
  type: 'fund' | 'dividend' | 'etf'; status: CouponStatus; expiresAt: string; createdAt?: string; restaurant?: Restaurant
  daysLeft?: number; tradable?: boolean; blockers?: string[]
  acquiredFromUserId?: string; acquiredAt?: string
  redeemCode?: string; redeemRequestedAt?: string; usedAt?: string
}

export interface ExchangeRules {
  maxDiscountGap: number; maxValueRatio: number; minDaysLeft: number; listingTtlDays: number; offerTtlDays: number
  maxOpenListingsPerUser: number; maxPendingOffersPerUser: number; maxOffersPerListing: number; redeemHoldMinutes: number
}

export interface Listing {
  id: string; userId: string; couponId: string
  wantedCategories: string[]; wantedRegions: string[]; minDiscount: number; autoAccept: boolean; note: string
  status: 'open' | 'completed' | 'cancelled' | 'expired'; createdAt: string; expiresAt: string
  userName?: string; coupon?: Coupon; restaurant?: Restaurant
  offerCount: number; myOfferId?: string; matchableCouponIds: string[]; mine: boolean
}

export interface Offer {
  id: string; listingId: string; offerUserId: string; offerCouponId: string; message: string
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'; createdAt: string; resolvedAt?: string
  coupon?: Coupon; fromUserName?: string; toUserName?: string; listing?: Listing
  stillValid?: boolean; issues?: Array<{ code: string; message: string }>
}

export interface TradeRecord {
  id: string; createdAt: string; mode: 'instant' | 'offer'; counterpartyName: string
  gave?: Coupon; got?: Coupon
}

export interface MarketMine {
  listings: Array<Listing & { offers: Offer[] }>
  sentOffers: Offer[]
  trades: TradeRecord[]
  rules: ExchangeRules
}

export interface AppNotification {
  id: string; type: string; title: string; body: string; link?: string; read: boolean; createdAt: string
}

export interface MeState {
  user: User
  positions: Position[]
  coupons: Coupon[]
  orders: Array<{ id: string; fundId: string; type: 'buy' | 'sell'; originalAmount: number; remaining: number; status: string; createdAt: string }>
  applications: ApplicationResult[]
  visitVerifications: Array<{ id: string; restaurantId: string; verifiedAt: string; usedForReview: boolean }>
  walletTransactions: Array<{ id: string; type: 'demo_topup'; amount: number; createdAt: string }>
  favoriteRestaurantIds: string[]
  ocrAnalyses: OcrAnalysis[]
  dataConnections: DataConnection[]
  notifications: AppNotification[]
  unreadNotifications: number
  exchange: { openListings: number; offersReceived: number; offersSent: number; trades: number }
  rules: ExchangeRules
  legalConsents?: LegalConsentRecord[]
  legalVersion?: string
}

export type LegalContext = 'signup' | 'invest' | 'withdraw' | 'owner_application'

export interface LegalSummary {
  id: string
  title: string
  summary: string
  audience: 'all' | 'investor' | 'owner'
  requiredFor: LegalContext[]
}

export interface LegalDocument extends LegalSummary {
  sections: Array<{ heading: string; body: string[] }>
}

export interface LegalIndex {
  version: string
  documents: LegalSummary[]
  required: Record<LegalContext, string[]>
}

export interface LegalConsentRecord {
  id: string
  context: LegalContext
  documentIds: string[]
  version: string
  resourceType?: string
  resourceId?: string
  amount?: number
  riskAcknowledged?: boolean
  agreedAt: string
}

export interface OcrResult {
  documentType?: string; merchant?: string; businessNumber?: string; date?: string
  total?: number; planMatch?: string; confidence?: number; warnings?: string[]; rawText?: string
  boundingBoxes?: Array<{ field: string; label: string; value: string; bbox: [number, number, number, number]; confidence: number }>
}

export interface OcrAnalysis {
  id: string; filename: string; sourceId: string; plan: string; result: OcrResult
  model: string; status: 'ai_extracted' | 'manual_review'; createdAt: string
}

export interface CommercialAreaView {
  areaCode: string; areaName: string; region: string; summary: string
  latitude?: number | null; longitude?: number | null
  matchLevel: 'exact' | 'nearby'
  dailyFootTraffic: number; footTrafficGrowth: number; competitorDensity: number; closureRate: number
  localSalesGrowth: number; averageTicketSize: number; rentGrowthRate: number; primaryCustomer: string
  insight: { competition: string; stability: string; opportunity: string; caution: string; gentrification: string }
  footTraffic: { dailyAverage: number; growthRate: number; peakTimes: string[]; weekdayRatio: number; weekendRatio: number; ageDistribution?: Record<string, number>; genderRatio?: { male: number; female: number } }
  marketDynamics: { totalStores: number; foodBeverageRatio: number; categoryCompetitorCount?: Record<string, number>; competitorDensity: number; closureRate: number; averageLifespanYears: number }
  spending: { averageTicketSize: number; localSalesGrowth: number; externalConsumerRatio: number; peakSpendingDay: string }
  realEstate: { averageRentPerPyung: number; rentGrowthRate: number; gentrificationRisk: string }
  demographics: { workerPopulation: number; residentPopulation: number; primaryCustomerProfile: string; transitAccessibility: string }
}

export interface TrustAssessment {
  score: number; grade: string; riskLevel: 'low' | 'review' | 'high'; confidence: number
  components: Record<string, number>
  contributions: Array<{ label: string; componentScore: number; weight: number; contribution: number }>
  missing: string[]
  contextualAlerts: string[]
  commercialArea?: CommercialAreaView
  methodology: { type: string; baseline: number; calibratedProbability: boolean; modelVersion: string }
}

export type VerificationStepStatus = 'passed' | 'review' | 'failed' | 'not_compared'

export interface FinancialOrchestration {
  version: string
  steps: Array<{ code: string; label: string; status: VerificationStepStatus; detail: string }>
  comparisons: Array<{ label: string; claimed: number | null; observed: number | null; source: string; differenceRate: number | null; status: VerificationStepStatus }>
  missingDocuments: string[]; mismatches: string[]; warnings: string[]
  documentCount: number; averageConfidence: number; readyForAdminReview: boolean
  recommendedStatus: string
}

export interface BusinessVerification {
  provider: string; verified: boolean; checks: Record<string, boolean>; checkedAt: string; message: string
}

export interface KnowledgeGraph {
  role: Role; generatedAt: string; graphVersion?: string
  nodes: Array<{ id: string; type: string; label: string; properties: Record<string, string | number | boolean>; source?: string }>
  edges: Array<{ from: string; relation: string; to: string }>
}

export interface ApplicationResult {
  id: string; restaurantName: string; status: 'approved' | 'conditional' | 'manual_review' | 'rejected'
  requestedLimit: number; approvedLimit: number; score: number; strengths: string[]; checks: string[]; improvements: string[]
  explanation: string; submittedAt: string
  data?: {
    derivedMetrics?: Record<string, number | string | null>
    dataConfidence?: number
    connectedSources?: string[]
    sourceProvenance?: { ownerUploaded?: string[]; partnerConnected?: string[]; identityVerified?: boolean }
    businessVerification?: BusinessVerification
    financialVerification?: FinancialOrchestration
    creditAssessment?: CreditAssessment
    combinedAssessment?: CombinedAssessment
  }
}

/** 35개 지표 · 6개 업종 신용평가 결과 (server/credit.ts). */
export interface CreditAssessment {
  modelVersion: string
  industry: string
  industryNote: string
  score: number
  /** 축소추정·산정률 상한을 적용하기 전의 원점수. */
  rawScore?: number
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D'
  /** 산정률이 절반에 못 미쳐 확정 등급이라고 부를 수 없는 경우. */
  provisional?: boolean
  /** 측정된 지표의 가중치 합. 100이면 35개 전부 산정됨. */
  coverage: number
  measuredCount: number
  totalCount: number
  confidence: number
  groups: Array<{ group: string; weight: number; score: number | null; measuredCount: number; totalCount: number }>
  features: Array<{ key: string; label: string; group: string; weight: number; unit: string; value: number | null; score: number | null; measured: boolean; note?: string }>
  contributions: Array<{ key: string; label: string; group: string; score: number; weight: number; contribution: number }>
  topDrivers: Array<{ key: string; label: string; score: number; weight: number; contribution: number }>
  topDrags: Array<{ key: string; label: string; score: number; weight: number; contribution: number }>
  missing: string[]
  overrides: string[]
  methodology: { type: string; weightSum: number; gradeBands: string; calibratedProbability: boolean; missingHandling: string; disclaimer: string }
  references: Array<{ id: string; title: string; authors: string; use: string; excluded?: string; url: string }>
}

export interface CombinedAssessment {
  blendedScore: number
  creditGrade: string
  riskGrade: string
  confidence: number
  weights: Record<string, number>
  agreement: number
  agreementNote: string
  needsHumanReview: boolean
}
