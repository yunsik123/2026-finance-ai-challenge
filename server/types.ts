export type Role = 'investor' | 'owner'
export type FundStatus = 'funding' | 'trading' | 'closed'

export interface SalesPoint { month: string; sales: number; growthRate: number; bonusRate: number }
export interface MenuHighlight { name: string; price: number; description: string }

export interface User {
  id: string
  email: string
  name: string
  role: Role
  passwordHash: string
  cash: number
  createdAt: string
}

export interface DataConnection {
  id: string
  userId: string
  sourceId: 'pos' | 'account' | 'card' | 'delivery' | 'tax' | 'debt'
  provider: string
  status: 'active' | 'revoked'
  consentScope: string
  recordCount: number
  connectedAt: string
  lastSyncedAt: string
}

export interface Restaurant {
  id: string
  ownerId?: string
  name: string
  emoji: string
  category: string
  region: string
  neighborhood: string
  tagline: string
  description: string
  signature: string
  avgPrice: number
  maxMenuPrice: number
  openedYears: number
  monthlySales: number
  salesGrowth: number
  repeatRate: number
  footTrafficGrowth: number
  competition: '낮음' | '보통' | '높음'
  closingRate: number
  rating: number
  reviewCount: number
  supporters: number
  communityScore: number
  stabilityScore: number
  story: string
  color: string
  tags: string[]
  foodDescription?: string
  strengths?: string[]
  menuHighlights?: MenuHighlight[]
  diningNotes?: string
  salesDisclosure?: boolean
  salesHistory?: SalesPoint[]
}

export interface Fund {
  id: string
  restaurantId: string
  round: number
  status: FundStatus
  goal: number
  raised: number
  maxDiscount: number
  minIssueDiscount: number
  dailyRatePer100k: number
  salesBonus: number
  earlyBonus: number
  startedAt: string
  endsAt: string
  purpose: string
  investorCount: number
  totalCouponIssued: number
  totalCouponUsed: number
  openBuyAmount: number
  openSellAmount: number
  riskLevel: '낮음' | '보통' | '주의'
}

export interface Position {
  id: string
  userId: string
  fundId: string
  amount: number
  early: boolean
  couponProgress: number
  updatedAt: string
}

export interface Order {
  id: string
  userId: string
  fundId: string
  type: 'buy' | 'sell'
  originalAmount: number
  remaining: number
  status: 'open' | 'partial' | 'filled' | 'cancelled'
  createdAt: string
}

export type CouponStatus = 'available' | 'listed' | 'offered' | 'redeeming' | 'used' | 'expired'

export interface Coupon {
  id: string
  userId: string
  restaurantId: string
  fundId?: string
  title: string
  discount: number
  maxDiscountWon: number
  type: 'fund' | 'dividend' | 'etf'
  status: CouponStatus
  expiresAt: string
  createdAt: string
  /** 교환으로 넘어온 쿠폰이면 직전 소유자. 이력 화면에서 "누구와 바꿨는지"를 보여준다. */
  acquiredFromUserId?: string
  acquiredAt?: string
  /** 사장님 확인을 기다리는 사용 요청. */
  redeemCode?: string
  redeemRequestedAt?: string
  usedAt?: string
  usedAtRestaurantId?: string
}

export interface CouponListing {
  id: string
  userId: string
  couponId: string
  /** 빈 배열이면 "상관없음". 레거시 wantedCategory/wantedRegion은 마이그레이션 때 여기로 들어온다. */
  wantedCategories: string[]
  wantedRegions: string[]
  minDiscount: number
  /** true면 조건을 만족하는 상대가 승인 없이 즉시 교환할 수 있다. */
  autoAccept: boolean
  note: string
  status: 'open' | 'completed' | 'cancelled' | 'expired'
  createdAt: string
  expiresAt: string
  completedAt?: string
  completedWithUserId?: string
}

export interface CouponOffer {
  id: string
  listingId: string
  offerUserId: string
  offerCouponId: string
  message: string
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
  createdAt: string
  resolvedAt?: string
}

export interface CouponTrade {
  id: string
  listingId: string
  offerId?: string
  mode: 'instant' | 'offer'
  listerUserId: string
  listerCouponId: string
  listerGaveDiscount: number
  listerGaveValueWon: number
  takerUserId: string
  takerCouponId: string
  takerGaveDiscount: number
  takerGaveValueWon: number
  createdAt: string
}

export interface Notification {
  id: string
  userId: string
  type: string
  title: string
  body: string
  link?: string
  read: boolean
  createdAt: string
}

export interface Application {
  id: string
  userId: string
  restaurantName: string
  submittedAt: string
  status: 'approved' | 'conditional' | 'manual_review' | 'rejected'
  requestedLimit: number
  approvedLimit: number
  score: number
  data: Record<string, unknown>
  strengths: string[]
  checks: string[]
  improvements: string[]
  explanation: string
}

export interface Review {
  id: string
  restaurantId: string
  userId: string
  userName: string
  rating: number
  content: string
  visitVerified: boolean
  createdAt: string
}

export interface VisitVerification {
  id: string
  restaurantId: string
  userId: string
  verifiedAt: string
  usedForReview: boolean
}

export interface WalletTransaction {
  id: string
  userId: string
  type: 'demo_topup'
  amount: number
  createdAt: string
}

export interface Favorite {
  userId: string
  restaurantId: string
  createdAt: string
}

export interface AuditEvent {
  id: string
  actorId?: string
  action: string
  resourceType: string
  resourceId: string
  summary: string
  createdAt: string
}

export interface OcrAnalysis {
  id: string
  userId: string
  filename: string
  sourceId: string
  plan: string
  result: Record<string, unknown>
  model: string
  status: 'ai_extracted' | 'manual_review'
  createdAt: string
}

export interface Article {
  id: string
  eyebrow: string
  title: string
  summary: string
  content: string
  tags: string[]
  icon: string
  publishedAt: string
  sourceName?: string
  sourceUrl?: string
  dataNote?: string
}

export interface EtfFund {
  id: string
  name: string
  emoji: string
  region: string
  category: string
  restaurantIds: string[]
  minimum: number
  maxDiscount: number
  growth: number
  members: number
  description: string
}

export interface Database {
  schemaVersion?: number
  users: User[]
  restaurants: Restaurant[]
  funds: Fund[]
  positions: Position[]
  orders: Order[]
  coupons: Coupon[]
  couponListings: CouponListing[]
  couponOffers: CouponOffer[]
  couponTrades: CouponTrade[]
  notifications: Notification[]
  applications: Application[]
  reviews: Review[]
  visitVerifications: VisitVerification[]
  walletTransactions: WalletTransaction[]
  favorites: Favorite[]
  auditEvents: AuditEvent[]
  ocrAnalyses: OcrAnalysis[]
  dataConnections: DataConnection[]
  articles: Article[]
  etfs: EtfFund[]
}
