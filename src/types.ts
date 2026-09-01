export type Role = 'investor' | 'owner'

export interface SalesPoint { month: string; sales: number; growthRate: number; bonusRate: number }
export interface MenuHighlight { name: string; price: number; description: string }
export interface Review { id: string; restaurantId: string; userId: string; userName: string; rating: number; content: string; visitVerified: boolean; createdAt: string }

export interface User { id: string; email: string; name: string; role: Role; cash: number; createdAt: string }

export interface Fund {
  id: string; restaurantId: string; round: number; status: 'funding' | 'trading' | 'closed'; goal: number; raised: number
  maxDiscount: number; minIssueDiscount: number; dailyRatePer100k: number; salesBonus: number; earlyBonus: number
  startedAt: string; endsAt: string; purpose: string; investorCount: number; totalCouponIssued: number; totalCouponUsed: number
  openBuyAmount: number; openSellAmount: number; riskLevel: string
}

export interface Restaurant {
  id: string; ownerId?: string; name: string; emoji: string; category: string; region: string; neighborhood: string
  tagline: string; description: string; signature: string; avgPrice: number; maxMenuPrice: number; openedYears: number
  monthlySales: number; salesGrowth: number; repeatRate: number; footTrafficGrowth: number; competition: string; closingRate: number
  rating: number; reviewCount: number; supporters: number; communityScore: number; stabilityScore: number; story: string; color: string; tags: string[]
  foodDescription?: string; strengths?: string[]; menuHighlights?: MenuHighlight[]; diningNotes?: string
  salesDisclosure?: boolean; salesHistory?: SalesPoint[]; reviews?: Review[]; opportunityScore: number; fund: Fund
}

export interface PublicState {
  restaurants: Restaurant[]
  funds: Fund[]
  etfs: Array<{ id: string; name: string; emoji: string; region: string; category: string; restaurantIds: string[]; minimum: number; maxDiscount: number; growth: number; members: number; description: string }>
  articles: Array<{ id: string; eyebrow: string; title: string; summary: string; content: string; tags: string[]; icon: string; publishedAt: string; sourceName?: string; sourceUrl?: string; dataNote?: string }>
  listings: Array<{ id: string; userId: string; couponId: string; wantedCategory: string; wantedRegion: string; userName?: string; coupon?: Coupon; restaurant?: Restaurant }>
  stats: { funded: number; restaurants: number; supporters: number; couponUsed: number }
}

export interface Position {
  id: string; fundId: string; amount: number; early: boolean; couponProgress: number; availableAmount: number
  fund: Fund; restaurant: Restaurant
}

export interface Coupon {
  id: string; restaurantId: string; fundId?: string; title: string; discount: number; maxDiscountWon: number
  type: 'fund' | 'dividend' | 'etf'; status: 'available' | 'listed' | 'used'; expiresAt: string; restaurant?: Restaurant
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

export interface TrustAssessment {
  score: number; grade: string; riskLevel: 'low' | 'review' | 'high'; confidence: number
  components: Record<string, number>
  contributions: Array<{ label: string; componentScore: number; weight: number; contribution: number }>
  missing: string[]
  methodology: { type: string; baseline: number; calibratedProbability: boolean; modelVersion: string }
}

export interface KnowledgeGraph {
  role: Role; generatedAt: string
  nodes: Array<{ id: string; type: string; label: string; properties: Record<string, string | number | boolean> }>
  edges: Array<{ from: string; relation: string; to: string }>
}

export interface ApplicationResult {
  id: string; restaurantName: string; status: 'approved' | 'conditional' | 'manual_review' | 'rejected'
  requestedLimit: number; approvedLimit: number; score: number; strengths: string[]; checks: string[]; improvements: string[]
  explanation: string; submittedAt: string
  data?: { derivedMetrics?: Record<string, number | string | null>; dataConfidence?: number; connectedSources?: string[] }
}
