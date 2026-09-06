import type { OwnerDocument } from './documents.ts'

export type { OwnerDocument }

export type Role = 'investor' | 'owner' | 'admin'
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
  accountStatus?: 'active' | 'suspended'
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
  /** 심사로 등록된 식당의 공개 여부. 기존 시드 식당은 값이 없어도 공개한다. */
  verificationStatus?: 'submitted' | 'verified' | 'rejected'
  sourceApplicationId?: string
  /**
   * 이 식당이 어느 사업체인가. 숫자만 남긴 사업자등록번호다.
   * 같은 사업체로 두 번째 펀드가 만들어지는 것을 막는 유일한 열쇠라서 상호명이 아니라
   * 이 값으로 판단한다. 상호는 계정마다 다르게 적을 수 있지만 사업자번호는 하나뿐이다.
   */
  businessNumber?: string
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
  /** 서버 계산 결과이며, 운영자의 최종 심사 상태와 구분한다. */
  recommendedStatus?: 'approved' | 'conditional' | 'manual_review' | 'rejected'
  requestedLimit: number
  approvedLimit: number
  score: number
  data: Record<string, unknown>
  strengths: string[]
  checks: string[]
  improvements: string[]
  explanation: string
  /**
   * 운영자가 보완을 요청하며 적은 말. 사장님 화면에 그대로 보인다.
   * 이게 없으면 사장님은 '보완 필요'라는 상태만 보고 무엇을 고쳐야 하는지 알 수 없다.
   */
  reviewNote?: string
  /** 운영자가 최종 결정을 내린 시각. */
  reviewedAt?: string
  /** 이 신청이 어떤 신청을 보완해서 다시 낸 것인가. */
  resubmittedFrom?: string
  /** 이 신청을 보완해 다시 낸 신청. 값이 있으면 이 건은 더 이상 진행 중이 아니다. */
  supersededBy?: string
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
  status?: 'published' | 'hidden'
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

/**
 * 1:1 고객지원 문의.
 * 승재 프로젝트의 disputes 테이블(/api/support/requests)을 먹투 데이터 모델로 옮겼다.
 */
export interface SupportRequest {
  id: string
  userId: string
  userName: string
  type: 'investment' | 'coupon' | 'exchange' | 'review' | 'owner' | 'account' | 'other'
  subject: string
  description: string
  restaurantId?: string
  priority: 'normal' | 'high'
  status: 'received' | 'in_review' | 'answered' | 'closed'
  answer?: string
  createdAt: string
  answeredAt?: string
}

export interface Favorite {
  userId: string
  restaurantId: string
  createdAt: string
}

/**
 * 약관 동의 기록.
 * 가입뿐 아니라 투자·회수·펀딩신청 때마다 "그 시점에 적용된 약관 버전"과 동의 시각을 남긴다.
 * 나중에 약관이 바뀌어도 각 거래가 어떤 문서에 근거했는지 되짚을 수 있어야 하기 때문이다.
 */
export interface LegalConsent {
  id: string
  userId: string
  context: 'signup' | 'invest' | 'withdraw' | 'owner_application'
  documentIds: string[]
  version: string
  resourceType?: string
  resourceId?: string
  amount?: number
  riskAcknowledged?: boolean
  agreedAt: string
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
  /** 문서 원장. 판독 결과와 사장님 확인·수정 이력이 여기 쌓인다. */
  documents?: OwnerDocument[]
  dataConnections: DataConnection[]
  articles: Article[]
  etfs: EtfFund[]
  supportRequests?: SupportRequest[]
  legalConsents?: LegalConsent[]
}
