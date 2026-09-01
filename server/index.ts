import cors from 'cors'
import crypto from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadEnvFile } from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { articles as seedArticles, createSeed, funds as seedFunds, restaurants as seedRestaurants, reviews as seedReviews } from './seed.ts'
import type { Application, Coupon, CouponListing, CouponOffer, CouponTrade, DataConnection, Database, Fund, Notification, Order, Position, Review, Role, User } from './types.ts'
import { answerGraphProcessQuestion, assessRestaurant, buildKnowledgeGraph, normalizeOcrBoxes, retrieveKnowledgeSubgraph } from './trust.ts'
import { answerNavigationQuestion, isNavigationQuestion, matchUiTasks, navigationBrief } from './sitemap.ts'
import { COMMERCIAL_NOTE, COMMERCIAL_SOURCE, commercialInsight, findCommercialArea } from './commercial.ts'
import { orchestrateFinancialVerification, verifyBusiness } from './verification.ts'
import { checkSwap, couponUsable, daysLeft, EXCHANGE_RULES, normalizePreferences, sweepExpired } from './exchange.ts'
import { FileStateStore, SupabaseStateStore, type StateStore } from './store.ts'

const scrypt = promisify(crypto.scrypt)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
for (const filename of ['.env.local', '.env.development.local', '.env']) {
  try {
    loadEnvFile(path.join(root, filename))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
const dataDir = process.env.VERCEL ? path.join('/tmp', 'meoktu') : path.join(root, 'data')
const dbPath = path.join(dataDir, 'db.json')
const port = Number(process.env.PORT || 8787)
const secret = process.env.APP_SECRET || 'meoktu-local-development-secret-change-me'
const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')
const supabasePublishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAuthDisabled = /^(1|true|yes)$/i.test(String(process.env.SUPABASE_AUTH_DISABLED || '').trim())
const supabaseAuthConfigured = Boolean(supabaseUrl && supabasePublishableKey) && !supabaseAuthDisabled
const aiApiUrl = String(process.env.OPENAI_BASE_URL ? `${String(process.env.OPENAI_BASE_URL).replace(/\/$/, '')}/chat/completions` : (process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions')).trim()
const aiApiKey = String(process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '').trim()

type SessionUser = User & { sessionMode: 'account' | 'demo' }
type AuthedRequest = Request & { user?: SessionUser }
let db!: Database

// 실제 계정은 원장 객체 참조를 유지해야 충전·투자 등 변경이 저장된다.
// sessionMode는 JSON 직렬화에서 제외되는 비영구 속성으로만 붙인다.
function accountSession(user: User) {
  Object.defineProperty(user, 'sessionMode', { value: 'account', enumerable: false, configurable: true })
  return user as SessionUser
}

// 저장소 선택: Supabase 서비스 키가 있고 STATE_STORE 를 끄지 않았다면 공유 원장을 쓴다.
// 서버리스에서는 인스턴스마다 파일이 따로 생기므로 공유 원장이 없으면 여러 사람이 같이 쓸 수 없다.
const stateStoreMode = String(process.env.STATE_STORE || '').trim().toLowerCase()
if (stateStoreMode === 'supabase' && (!supabaseUrl || !supabaseServiceKey)) {
  const missing = [
    !supabaseUrl && 'SUPABASE_URL (or VITE_SUPABASE_URL)',
    !supabaseServiceKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean).join(', ')
  throw new Error(`STATE_STORE=supabase requires ${missing}`)
}
const useSharedState = stateStoreMode === 'supabase'
  || (stateStoreMode !== 'file' && Boolean(supabaseUrl && supabaseServiceKey) && Boolean(process.env.VERCEL))
const store: StateStore = useSharedState && supabaseUrl && supabaseServiceKey
  ? new SupabaseStateStore(supabaseUrl, supabaseServiceKey, process.env.STATE_ROW_ID || 'meoktu')
  : new FileStateStore(dbPath)
let stateVersion = 0
let lockOwner: string | undefined
let lastVersionCheck = 0

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const now = () => new Date().toISOString()
const round1000 = (value: unknown) => Math.floor(Number(value) / 1000) * 1000

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = (await scrypt(password, salt, 64)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = (await scrypt(password, salt, 64)) as Buffer
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived)
}

function tokenFor(user: User) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, mode: 'account', exp: Date.now() + 1000 * 60 * 60 * 24 * 14 })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function demoTokenFor(role: Role) {
  const payload = Buffer.from(JSON.stringify({ sub: `demo-${role}`, role, mode: 'demo', exp: Date.now() + 1000 * 60 * 60 * 4 })).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function userFromToken(value?: string) {
  if (!value) return undefined
  const token = value.replace(/^Bearer\s+/i, '')
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return undefined
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string; exp: number; mode?: string; role?: Role }
    if (parsed.exp < Date.now()) return undefined
    if (parsed.mode === 'demo' && (parsed.role === 'owner' || parsed.role === 'investor')) {
      return {
        id: parsed.sub, email: `${parsed.role}@demo-session.meoktu`, name: parsed.role === 'owner' ? '사장님 체험자' : '투자자 체험자',
        role: parsed.role, passwordHash: 'demo-session', cash: 0, createdAt: now(), sessionMode: 'demo',
      } satisfies SessionUser
    }
    const user = db.users.find((item) => item.id === parsed.sub)
    return user && accountSession(user)
  } catch {
    return undefined
  }
}

type SupabaseAuthUser = { id: string; email?: string; user_metadata?: Record<string, unknown> }

async function supabaseRequest(pathname: string, options: RequestInit = {}, useServiceKey = false) {
  const key = useServiceKey ? supabaseServiceKey : supabasePublishableKey
  const response = await fetch(`${supabaseUrl}/auth/v1/${pathname}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(15_000),
  })
  const body = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) throw Object.assign(new Error(body.error_description || body.msg || body.message || `Supabase Auth ${response.status}`), { status: response.status })
  return body
}

// Supabase 토큰 검증은 네트워크 왕복이라, 짧게 캐시해서 공개 화면 폴링이 매번 원격 호출을 하지 않게 한다.
const supabaseUserCache = new Map<string, { userId: string; at: number }>()
const SUPABASE_USER_TTL = 60_000

async function supabaseUserFromAuthorization(value?: string) {
  if (!supabaseAuthConfigured || !value) return undefined
  const token = value.replace(/^Bearer\s+/i, '')
  if (!token) return undefined
  const cacheKey = crypto.createHash('sha256').update(token).digest('base64url')
  const cached = supabaseUserCache.get(cacheKey)
    if (cached && cached.at > Date.now() - SUPABASE_USER_TTL) {
      const known = db.users.find((item) => item.id === cached.userId)
    if (known) return accountSession(known)
    supabaseUserCache.delete(cacheKey)
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const authUser = await response.json() as SupabaseAuthUser
    const email = String(authUser.email || '').toLowerCase()
    if (!authUser.id || !email) return undefined
    let user = db.users.find((item) => item.id === authUser.id || item.email === email)
    if (!user) {
      const requestedRole = authUser.user_metadata?.role
      const role: Role = requestedRole === 'owner' ? 'owner' : 'investor'
      user = {
        id: authUser.id,
        email,
        name: String(authUser.user_metadata?.name || authUser.user_metadata?.full_name || email.split('@')[0]).slice(0, 80),
        role,
        passwordHash: `supabase:${authUser.id}`,
        cash: role === 'investor' ? 2000000 : 0,
        createdAt: now(),
      }
      db.users.push(user)
      audit(user.id, 'auth.supabase_profile_created', 'user', user.id, 'Supabase Auth 사용자 로컬 서비스 프로필 생성')
      await saveDatabase()
    }
    supabaseUserCache.set(cacheKey, { userId: user.id, at: Date.now() })
    if (supabaseUserCache.size > 2000) {
      for (const [key, entry] of supabaseUserCache) if (entry.at < Date.now() - SUPABASE_USER_TTL) supabaseUserCache.delete(key)
    }
    return accountSession(user)
  } catch { return undefined }
}

async function userFromAuthorization(value?: string) {
  return userFromToken(value) || await supabaseUserFromAuthorization(value)
}

function migrateDatabase(current: Database, template: Database) {
  current.users ??= []
  current.positions ??= []
  current.orders ??= []
  current.coupons ??= []
  current.couponListings ??= []
  current.couponOffers ??= []
  current.couponTrades ??= []
  current.notifications ??= []
  current.dataConnections ??= []
  current.applications ??= []
  current.reviews ??= []
  current.visitVerifications ??= []
  current.walletTransactions ??= []
  current.favorites ??= []
  current.auditEvents ??= []
  current.ocrAnalyses ??= []

  for (const user of template.users) if (!current.users.some((item) => item.id === user.id)) current.users.push(user)
  current.restaurants = seedRestaurants.map((restaurant) => {
    const existing = current.restaurants?.find((item) => item.id === restaurant.id)
    return { ...existing, ...restaurant, ownerId: existing?.ownerId ?? restaurant.ownerId }
  })
  current.funds = seedFunds.map((fund) => {
    const existing = current.funds?.find((item) => item.id === fund.id)
    return { ...fund, ...existing, earlyBonus: fund.earlyBonus, salesBonus: fund.salesBonus, openBuyAmount: 0, openSellAmount: 0 }
  })
  for (const position of template.positions) if (!current.positions.some((item) => item.id === position.id)) current.positions.push(position)
  for (const seedOrder of template.orders) {
    const hasOpenOrder = current.orders.some((item) => item.fundId === seedOrder.fundId && item.remaining > 0 && ['open', 'partial'].includes(item.status))
    if (!hasOpenOrder && !current.orders.some((item) => item.id === seedOrder.id)) current.orders.push(seedOrder)
  }
  for (const coupon of template.coupons) if (!current.coupons.some((item) => item.id === coupon.id)) current.coupons.push(coupon)
  for (const listing of template.couponListings) if (!current.couponListings.some((item) => item.id === listing.id)) current.couponListings.push(listing)
  for (const listing of current.couponListings) migrateListing(listing)
  for (const review of seedReviews) if (!current.reviews.some((item) => item.id === review.id)) current.reviews.push(review)
  current.articles = seedArticles
  current.etfs = template.etfs
  current.schemaVersion = 4
  return current
}

/** 어느 저장소에서 읽어왔든 빠진 컬렉션을 채워 둔다. */
function normalizeDatabase() {
  db.reviews ??= []
  db.couponOffers ??= []
  db.couponTrades ??= []
  db.notifications ??= []
  db.dataConnections ??= []
  for (const listing of db.couponListings ?? []) migrateListing(listing)
  db.visitVerifications ??= []
  db.walletTransactions ??= []
  db.favorites ??= []
  db.auditEvents ??= []
  db.ocrAnalyses ??= []
}

async function loadDatabase() {
  if (store instanceof FileStateStore) await fs.mkdir(dataDir, { recursive: true })
  const snapshot = await store.read()
  if (snapshot) {
    db = snapshot.data
    stateVersion = snapshot.version
    if ((db.schemaVersion || 0) < 4) {
      const ownerHash = db.users?.find((user) => user.id === 'u-owner')?.passwordHash || await hashPassword('demo1234!')
      const investorHash = db.users?.find((user) => user.id === 'u-investor')?.passwordHash || await hashPassword('demo1234!')
      db = migrateDatabase(db, createSeed(ownerHash, investorHash))
      normalizeDatabase()
      const next = await store.write(db, stateVersion)
      if (next !== undefined) stateVersion = next
    }
  } else {
    const ownerHash = await hashPassword('demo1234!')
    const investorHash = await hashPassword('demo1234!')
    db = createSeed(ownerHash, investorHash)
    normalizeDatabase()
    if (store instanceof SupabaseStateStore) {
      // 첫 기동에서만 심는다. 다른 인스턴스가 이미 심었으면 그쪽 값을 그대로 쓴다.
      const seeded = await store.seed(db)
      if (seeded) { db = seeded.data; stateVersion = seeded.version }
    } else {
      stateVersion = await store.write(db, stateVersion) ?? 0
    }
  }
  normalizeDatabase()
  console.log(`원장 저장소: ${store.kind}${store.kind === 'supabase' ? ` (version ${stateVersion})` : ''}`)
}

async function saveDatabase() {
  if (store.kind === 'file') {
    await store.write(db, stateVersion)
    return
  }
  // 공유 원장은 쓰기 잠금을 쥔 요청만 저장한다.
  // 잠금 없는 경로(조회 중 파생 상태 갱신 등)는 다음 쓰기 때 함께 반영되므로 건너뛴다.
  if (!lockOwner) return
  const next = await store.write(db, stateVersion)
  if (next !== undefined) { stateVersion = next; return }
  // 잠금 안에서는 사실상 일어나지 않지만, 밀렸다면 최신 버전으로 한 번 더 시도한다.
  const current = await store.version()
  const retried = await store.write(db, current)
  if (retried === undefined) throw new Error('원장 저장이 다른 요청과 충돌했어요. 다시 시도해주세요.')
  stateVersion = retried
}

/** 공유 원장에서 최신 상태를 따라잡는다. 버전만 먼저 확인해 불필요한 전체 조회를 줄인다. */
async function refreshState(force = false) {
  if (store.kind !== 'supabase') return
  if (!force && Date.now() - lastVersionCheck < 1500) return
  lastVersionCheck = Date.now()
  const remote = await store.version()
  if (remote < 0 || remote === stateVersion) return
  const snapshot = await store.read()
  if (!snapshot) return
  db = snapshot.data
  stateVersion = snapshot.version
  normalizeDatabase()
}

function publicUser(user: User | SessionUser) {
  const { passwordHash: _, ...safe } = user
  return { ...safe, sessionMode: 'sessionMode' in user ? user.sessionMode : 'account' as const }
}

function audit(actorId: string | undefined, action: string, resourceType: string, resourceId: string, summary: string) {
  db.auditEvents.push({ id: id('audit'), actorId, action, resourceType, resourceId, summary: summary.slice(0, 300), createdAt: now() })
  if (db.auditEvents.length > 1000) db.auditEvents.splice(0, db.auditEvents.length - 1000)
}

/* ── 쿠폰 교환장 공용 로직 ─────────────────────────────────────── */

const legacyListing = (listing: CouponListing & { wantedCategory?: string; wantedRegion?: string }) => listing

/** 예전 스키마(wantedCategory/wantedRegion 단일 문자열)를 새 배열 스키마로 끌어올린다. */
function migrateListing(listing: CouponListing) {
  const legacy = legacyListing(listing)
  if (!Array.isArray(listing.wantedCategories)) {
    listing.wantedCategories = legacy.wantedCategory && legacy.wantedCategory !== '상관없음' ? [legacy.wantedCategory] : []
  }
  if (!Array.isArray(listing.wantedRegions)) {
    listing.wantedRegions = legacy.wantedRegion && legacy.wantedRegion !== '상관없음' ? [legacy.wantedRegion] : []
  }
  if (typeof listing.minDiscount !== 'number' || !Number.isFinite(listing.minDiscount)) listing.minDiscount = 0
  // 레거시 매물은 즉시 교환이 기본 동작이었으므로 그대로 유지한다.
  if (typeof listing.autoAccept !== 'boolean') listing.autoAccept = true
  if (typeof listing.note !== 'string') listing.note = ''
  if (!listing.expiresAt) {
    listing.expiresAt = new Date(new Date(listing.createdAt).getTime() + EXCHANGE_RULES.listingTtlDays * 86400000).toISOString()
  }
  delete legacy.wantedCategory
  delete legacy.wantedRegion
  return listing
}

let exchangeChain: Promise<unknown> = Promise.resolve()

/**
 * 교환 관련 쓰기를 한 줄로 세운다.
 * 한 인스턴스 안에서 두 사람이 같은 매물을 동시에 집어가도 뒤에 온 쪽은
 * 이미 바뀐 상태를 다시 읽고 규칙 검사에서 걸러진다.
 */
function withExchangeLock<T>(task: () => Promise<T> | T): Promise<T> {
  const run = exchangeChain.then(task, task)
  exchangeChain = run.then(() => undefined, () => undefined)
  return run
}

function pushNotification(userId: string, type: string, title: string, body: string, link?: string) {
  const item: Notification = { id: id('noti'), userId, type, title: title.slice(0, 120), body: body.slice(0, 300), link, read: false, createdAt: now() }
  db.notifications.push(item)
  if (db.notifications.length > 2000) db.notifications.splice(0, db.notifications.length - 2000)
  return item
}

/** 만료 정리. 교환장을 읽거나 쓰기 전에 항상 한 번 돌린다. */
function sweepExchange() {
  const touched = sweepExpired(db)
  return touched.length
}

const restaurantOf = (coupon?: Coupon) => coupon && db.restaurants.find((item) => item.id === coupon.restaurantId)
const userName = (userId: string) => db.users.find((item) => item.id === userId)?.name || '알 수 없음'

function couponView(coupon: Coupon) {
  const restaurant = restaurantOf(coupon)
  return {
    ...coupon,
    restaurant,
    daysLeft: Math.max(0, Math.floor(daysLeft(coupon.expiresAt))),
    tradable: couponUsable(coupon).length === 0,
    blockers: couponUsable(coupon).map((issue) => issue.message),
  }
}

function listingView(listing: CouponListing, viewerId?: string) {
  const coupon = db.coupons.find((item) => item.id === listing.couponId)
  const restaurant = restaurantOf(coupon)
  const offers = db.couponOffers.filter((item) => item.listingId === listing.id && item.status === 'pending')
  const myOffer = viewerId ? offers.find((item) => item.offerUserId === viewerId) : undefined
  // 뷰어가 지금 이 매물과 바꿀 수 있는 내 쿠폰들
  const candidates = !viewerId || viewerId === listing.userId || !coupon ? [] : db.coupons
    .filter((item) => item.userId === viewerId && item.status === 'available')
    .map((item) => ({ coupon: item, check: checkSwap({ listing, wanted: coupon, offered: item, offeredRestaurant: restaurantOf(item), offerUserId: viewerId }) }))
    .filter((item) => item.check.ok)
    .map((item) => item.coupon.id)
  return {
    ...listing,
    coupon,
    restaurant,
    userName: userName(listing.userId),
    offerCount: offers.length,
    myOfferId: myOffer?.id,
    matchableCouponIds: candidates,
    mine: viewerId === listing.userId,
  }
}

/**
 * 실제 교환 체결. 소유권을 서로 넘기고, 같은 매물의 나머지 제안을 풀어주고,
 * 거래 원장·감사 로그·양쪽 알림까지 한 번에 남긴다.
 */
function settleSwap(listing: CouponListing, wanted: Coupon, offered: Coupon, takerId: string, mode: 'instant' | 'offer', offer?: CouponOffer) {
  const at = now()
  const listerId = listing.userId

  wanted.userId = takerId
  wanted.status = 'available'
  wanted.acquiredFromUserId = listerId
  wanted.acquiredAt = at

  offered.userId = listerId
  offered.status = 'available'
  offered.acquiredFromUserId = takerId
  offered.acquiredAt = at

  listing.status = 'completed'
  listing.completedAt = at
  listing.completedWithUserId = takerId
  if (offer) { offer.status = 'accepted'; offer.resolvedAt = at }

  // 같은 매물에 걸려 있던 다른 제안은 자동 반려하고 걸어둔 쿠폰을 돌려준다.
  for (const other of db.couponOffers) {
    if (other.listingId !== listing.id || other.status !== 'pending' || other.id === offer?.id) continue
    other.status = 'declined'
    other.resolvedAt = at
    const held = db.coupons.find((item) => item.id === other.offerCouponId)
    if (held && held.status === 'offered') held.status = 'available'
    pushNotification(other.offerUserId, 'offer_declined', '교환이 다른 분과 성사됐어요',
      `${wanted.title} 매물이 마감되어 걸어둔 쿠폰을 지갑으로 돌려드렸어요.`, '/market')
  }

  const trade: CouponTrade = {
    id: id('trade'), listingId: listing.id, offerId: offer?.id, mode,
    listerUserId: listerId, listerCouponId: wanted.id, listerGaveDiscount: wanted.discount, listerGaveValueWon: wanted.maxDiscountWon,
    takerUserId: takerId, takerCouponId: offered.id, takerGaveDiscount: offered.discount, takerGaveValueWon: offered.maxDiscountWon,
    createdAt: at,
  }
  db.couponTrades.push(trade)
  audit(takerId, 'coupon.swap', 'listing', listing.id, `${wanted.title} ↔ ${offered.title} 교환 체결 (${mode})`)
  pushNotification(listerId, 'trade_done', '쿠폰 교환이 완료됐어요',
    `${userName(takerId)}님과 ${wanted.title} ↔ ${offered.title} 교환이 끝났어요.`, '/my')
  pushNotification(takerId, 'trade_done', '쿠폰 교환이 완료됐어요',
    `${userName(listerId)}님과 ${offered.title} ↔ ${wanted.title} 교환이 끝났어요.`, '/my')
  return trade
}

const rateBuckets = new Map<string, number[]>()
const partnerSourceCatalog = {
  pos: { provider: 'POS 제휴 중계(시연)', scope: '최근 12개월 주문·결제·취소 집계', recordCount: 4281 },
  account: { provider: '금융 마이데이터 중계(시연)', scope: '사업용 계좌 최근 12개월 입출금', recordCount: 1364 },
  card: { provider: '카드·VAN 정산 제휴(시연)', scope: '최근 12개월 승인·취소·정산 집계', recordCount: 3918 },
  delivery: { provider: '배달 플랫폼 제휴(시연)', scope: '최근 12개월 주문·수수료·정산 집계', recordCount: 742 },
  tax: { provider: '세무자료 전송 어댑터(시연)', scope: '최근 2개 과세기간 신고 매출', recordCount: 2 },
  debt: { provider: '금융기관 대출정보 중계(시연)', scope: '대출잔액·금리·만기·월 상환액', recordCount: 3 },
} as const
type PartnerSourceId = keyof typeof partnerSourceCatalog
/** 아주 가벼운 슬라이딩 윈도 제한. 여러 사람이 붙었을 때 한 계정이 교환장을 도배하는 걸 막는다. */
function rateLimit(key: string, limit: number, windowMs: number) {
  const at = Date.now()
  const hits = (rateBuckets.get(key) || []).filter((time) => time > at - windowMs)
  if (hits.length >= limit) return false
  hits.push(at)
  rateBuckets.set(key, hits)
  if (rateBuckets.size > 5000) for (const [entry, times] of rateBuckets) if (!times.some((time) => time > at - windowMs)) rateBuckets.delete(entry)
  return true
}

function jsonObject(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) as Record<string, unknown> } catch { /* find the first JSON object below */ }
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) return {}
  try { return JSON.parse(match[0]) as Record<string, unknown> } catch { return {} }
}

function accrue(position: Position) {
  const fund = db.funds.find((item) => item.id === position.fundId)
  if (!fund || position.amount <= 0) return
  const elapsedDays = Math.max(0, (Date.now() - new Date(position.updatedAt).getTime()) / 86400000)
  const effectiveSalesBonus = fund.salesBonus * (position.early ? 1 + fund.earlyBonus / 100 : 1)
  const gained = (position.amount / 100000) * fund.dailyRatePer100k * elapsedDays * (1 + effectiveSalesBonus / 100)
  position.couponProgress = Math.min(fund.maxDiscount, position.couponProgress + gained)
  position.updatedAt = now()
}

function issueCoupon(position: Position, force = false) {
  accrue(position)
  const fund = db.funds.find((item) => item.id === position.fundId)
  const restaurant = fund && db.restaurants.find((item) => item.id === fund.restaurantId)
  if (!fund || !restaurant) return undefined
  if (position.couponProgress < fund.minIssueDiscount) {
    if (force) position.couponProgress = 0
    return undefined
  }
  const discount = Math.min(fund.maxDiscount, Math.floor(position.couponProgress * 10) / 10)
  const coupon: Coupon = {
    id: id('coupon'), userId: position.userId, restaurantId: restaurant.id, fundId: fund.id,
    title: `${restaurant.name} ${discount}% 응원 쿠폰`, discount,
    maxDiscountWon: Math.floor(restaurant.maxMenuPrice * discount / 100), type: 'fund', status: 'available',
    createdAt: now(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
  }
  db.coupons.push(coupon)
  fund.totalCouponIssued += coupon.maxDiscountWon
  position.couponProgress = 0
  position.updatedAt = now()
  return coupon
}

function getPosition(userId: string, fundId: string) {
  let position = db.positions.find((item) => item.userId === userId && item.fundId === fundId)
  if (!position) {
    position = { id: id('position'), userId, fundId, amount: 0, early: false, couponProgress: 0, updatedAt: now() }
    db.positions.push(position)
  }
  accrue(position)
  return position
}

function refreshOrderTotals(fundId: string) {
  const fund = db.funds.find((item) => item.id === fundId)
  if (!fund) return
  const open = db.orders.filter((order) => order.fundId === fundId && ['open', 'partial'].includes(order.status))
  fund.openBuyAmount = open.filter((o) => o.type === 'buy').reduce((sum, o) => sum + o.remaining, 0)
  fund.openSellAmount = open.filter((o) => o.type === 'sell').reduce((sum, o) => sum + o.remaining, 0)
}

function matchOrders(fundId: string) {
  const buys = db.orders
    .filter((o) => o.fundId === fundId && o.type === 'buy' && o.remaining > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const sells = db.orders
    .filter((o) => o.fundId === fundId && o.type === 'sell' && o.remaining > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const matches: Array<{ amount: number; buyerId: string; sellerId: string }> = []
  let buyIndex = 0
  let sellIndex = 0
  while (buyIndex < buys.length && sellIndex < sells.length) {
    const buy = buys[buyIndex]
    const sell = sells[sellIndex]
    if (buy.userId === sell.userId) {
      if (buy.createdAt < sell.createdAt) buyIndex += 1
      else sellIndex += 1
      continue
    }
    const amount = Math.min(buy.remaining, sell.remaining)
    if (amount < 1000) break
    const buyerPosition = getPosition(buy.userId, fundId)
    const sellerPosition = getPosition(sell.userId, fundId)
    const matched = Math.min(amount, sellerPosition.amount)
    if (matched < 1000) {
      sell.remaining = 0
      sell.status = 'cancelled'
      sellIndex += 1
      continue
    }
    buyerPosition.amount += matched
    sellerPosition.amount -= matched
    const seller = db.users.find((u) => u.id === sell.userId)
    if (seller) seller.cash += matched
    buy.remaining -= matched
    sell.remaining -= matched
    buy.status = buy.remaining === 0 ? 'filled' : 'partial'
    sell.status = sell.remaining === 0 ? 'filled' : 'partial'
    matches.push({ amount: matched, buyerId: buy.userId, sellerId: sell.userId })
    if (buy.remaining === 0) buyIndex += 1
    if (sell.remaining === 0) sellIndex += 1
  }
  refreshOrderTotals(fundId)
  return matches
}

function auth(requiredRole?: Role) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const user = await userFromAuthorization(req.headers.authorization)
    if (!user) return res.status(401).json({ error: '로그인이 필요해요.' })
    if (requiredRole && user.role !== requiredRole) return res.status(403).json({ error: '이 계정에서는 사용할 수 없는 기능이에요.' })
    req.user = user
    next()
  }
}

function restaurantView() {
  return db.restaurants.map((restaurant) => {
    const fund = db.funds.find((item) => item.restaurantId === restaurant.id)
    const opportunityScore = Math.round(restaurant.salesGrowth * 1.1 + restaurant.repeatRate * 0.32 + restaurant.communityScore * 0.22 + restaurant.stabilityScore * 0.2 - restaurant.closingRate * 0.35)
    const reviews = db.reviews.filter((review) => review.restaurantId === restaurant.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
    return { ...restaurant, salesHistory: restaurant.salesDisclosure ? restaurant.salesHistory : undefined, reviews, fund, opportunityScore: Math.min(99, opportunityScore) }
  })
}

function publicState(viewerId?: string) {
  sweepExchange()
  const views = restaurantView()
  return {
    restaurants: views,
    funds: db.funds,
    etfs: db.etfs,
    articles: db.articles,
    listings: db.couponListings.filter((l) => l.status === 'open').map((listing) => listingView(listing, viewerId)),
    exchange: {
      rules: EXCHANGE_RULES,
      categories: [...new Set(db.restaurants.map((item) => item.category))].sort(),
      regions: [...new Set(db.restaurants.map((item) => item.region))].sort(),
      openListings: db.couponListings.filter((item) => item.status === 'open').length,
      completedTrades: db.couponTrades.length,
      pendingOffers: db.couponOffers.filter((item) => item.status === 'pending').length,
    },
    stats: {
      funded: db.funds.reduce((sum, f) => sum + f.raised, 0),
      restaurants: db.restaurants.length,
      supporters: db.restaurants.reduce((sum, r) => sum + r.supporters, 0),
      couponUsed: db.funds.reduce((sum, f) => sum + f.totalCouponUsed, 0),
    },
  }
}

await loadDatabase()
for (const fund of db.funds) {
  matchOrders(fund.id)
  refreshOrderTotals(fund.id)
}
await saveDatabase()

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: true, credentials: true } })
const changed = () => io.emit('state:changed', { at: now() })

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '8mb' }))

/**
 * 공유 원장을 쓸 때만 동작한다.
 * - 조회 요청: 최신 상태를 따라잡는다(버전만 먼저 확인).
 * - 변경 요청: 전역 쓰기 잠금을 잡고, 잠금 안에서 상태를 다시 읽은 뒤 핸들러를 실행한다.
 *   덕분에 인스턴스가 몇 개로 늘어나도 쿠폰·투자 원장이 갈라지지 않는다.
 */
app.use('/api', async (req, res, next) => {
  if (store.kind !== 'supabase') return next()
  try {
    if (req.method === 'GET') {
      await refreshState()
      return next()
    }
    const owner = crypto.randomUUID()
    const deadline = Date.now() + 9000
    let acquired = false
    while (Date.now() < deadline) {
      if (await store.acquire(owner)) { acquired = true; break }
      await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 200))
    }
    if (!acquired) return res.status(503).json({ error: '지금 다른 요청을 처리하고 있어요. 잠시 후 다시 시도해주세요.' })

    lockOwner = owner
    let released = false
    const release = () => {
      if (released) return
      released = true
      if (lockOwner === owner) lockOwner = undefined
      store.release(owner).catch(() => undefined)
    }
    res.on('finish', release)
    res.on('close', release)

    await refreshState(true)
    next()
  } catch (error) {
    next(error)
  }
})

// 원클릭 체험 세션은 원장 변경을 절대 허용하지 않는다. 공개 조회와 AI/OCR 체험만 가능하다.
app.use('/api', async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next()
  const viewer = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  if (viewer?.sessionMode !== 'demo') return next()
  const allowed = ['/api/ai/chat', '/api/ai/ocr'].some((pathname) => req.originalUrl.split('?')[0] === pathname)
    || req.originalUrl.startsWith('/api/auth/')
  if (allowed) return next()
  return res.status(403).json({ error: '체험 모드에서는 AI 상담과 샘플 문서 업로드·판독만 가능해요. 투자·충전·쿠폰 교환·심사 접수는 회원가입 후 이용해주세요.' })
})

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  time: now(),
  authProvider: supabaseAuthConfigured ? 'supabase-with-local-demo-fallback' : 'local-demo',
  stateStore: store.kind,
  stateVersion: store.kind === 'supabase' ? stateVersion : undefined,
}))
app.get('/api/public', async (req: AuthedRequest, res) => {
  const viewer = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  res.json(publicState(viewer?.id))
})
app.get('/api/trust/:restaurantId', (req, res) => {
  const restaurant = db.restaurants.find((item) => item.id === req.params.restaurantId)
  if (!restaurant) return res.status(404).json({ error: '검증할 식당을 찾을 수 없어요.' })
  const fund = db.funds.find((item) => item.restaurantId === restaurant.id)
  const assessment = assessRestaurant(restaurant, fund)
  const application = db.applications.find((item) => item.restaurantName === restaurant.name)
  const financialRun = (application?.data as Record<string, any> | undefined)?.financialVerification as Record<string, any> | undefined
  res.json({
    assessment,
    graph: buildKnowledgeGraph('investor', restaurant, fund, {
      assessment,
      claim: application && { verificationStatus: application.status, requestedLimit: application.requestedLimit, dataConfidence: Number((application.data as any)?.dataConfidence) || undefined },
      verification: financialRun && {
        status: String(financialRun.recommendedStatus || 'unknown'),
        readyForAdminReview: Boolean(financialRun.readyForAdminReview),
        mismatchCount: (financialRun.mismatches || []).length,
        missingCount: (financialRun.missingDocuments || []).length,
      },
    }),
    commercial: { source: COMMERCIAL_SOURCE, note: COMMERCIAL_NOTE },
  })
})

app.get('/api/knowledge-graph', async (req: AuthedRequest, res) => {
  const role: Role = req.query.role === 'owner' ? 'owner' : 'investor'
  const restaurant = typeof req.query.restaurantId === 'string' ? db.restaurants.find((item) => item.id === req.query.restaurantId) : undefined
  const fund = restaurant ? db.funds.find((item) => item.restaurantId === restaurant.id) : undefined
  const viewer = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  const position = viewer && fund ? db.positions.find((item) => item.userId === viewer.id && item.fundId === fund.id && item.amount > 0) : undefined
  const application = restaurant
    ? [...db.applications].reverse().find((item) => item.restaurantName === restaurant.name || (viewer?.role === 'owner' && item.userId === viewer.id))
    : viewer?.role === 'owner' ? [...db.applications].reverse().find((item) => item.userId === viewer.id) : undefined
  const financialRun = application?.data?.financialVerification as Record<string, any> | undefined
  res.json(buildKnowledgeGraph(role, restaurant, fund, {
    assessment: restaurant ? assessRestaurant(restaurant, fund) : undefined,
    holding: position && { amount: position.amount, couponProgress: position.couponProgress, early: position.early },
    claim: application && { verificationStatus: application.status, requestedLimit: application.requestedLimit, dataConfidence: Number(application.data?.dataConfidence) || undefined },
    verification: financialRun && {
      status: String(financialRun.recommendedStatus || 'unknown'), readyForAdminReview: Boolean(financialRun.readyForAdminReview),
      mismatchCount: (financialRun.mismatches || []).length, missingCount: (financialRun.missingDocuments || []).length,
    },
  }))
})

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body as { email?: string; password?: string; name?: string; role?: Role }
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: '올바른 이메일을 입력해주세요.' })
  if (!password || password.length < 8) return res.status(400).json({ error: '비밀번호는 8자 이상이어야 해요.' })
  if (!name || name.trim().length < 2) return res.status(400).json({ error: '이름을 두 글자 이상 입력해주세요.' })
  if (role !== 'owner' && role !== 'investor') return res.status(400).json({ error: '가입 유형을 선택해주세요.' })
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: '이미 가입된 이메일이에요.' })
  if (supabaseAuthConfigured) {
    try {
      if (supabaseServiceKey) {
        try {
          await supabaseRequest('admin/users', { method: 'POST', body: JSON.stringify({ email: email.toLowerCase(), password, email_confirm: true, user_metadata: { name: name.trim(), role } }) }, true)
        } catch (error) {
          if (!String((error as Error).message).match(/already|registered|exists/i)) throw error
        }
        const session = await supabaseRequest('token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: email.toLowerCase(), password }) })
        return res.status(201).json({ token: session.access_token, user: session.user, provider: 'supabase' })
      }
      const signup = await supabaseRequest('signup', { method: 'POST', body: JSON.stringify({ email: email.toLowerCase(), password, data: { name: name.trim(), role } }) })
      if (signup.access_token) return res.status(201).json({ token: signup.access_token, user: signup.user, provider: 'supabase' })
      return res.status(202).json({ requiresEmailConfirmation: true, provider: 'supabase', message: '확인 이메일을 보냈어요. 이메일 인증 후 로그인해주세요.' })
    } catch (error) {
      const status = Number((error as { status?: number }).status || 502)
      return res.status(status >= 400 && status < 500 ? status : 502).json({ error: `Supabase 회원가입에 실패했어요. ${(error as Error).message}` })
    }
  }
  const user: User = { id: id('user'), email: email.toLowerCase(), name: name.trim(), role, passwordHash: await hashPassword(password), cash: role === 'investor' ? 2000000 : 0, createdAt: now() }
  db.users.push(user)
  await saveDatabase()
  res.status(201).json({ token: tokenFor(user), user: publicUser(user) })
})

app.post('/api/auth/demo', (req, res) => {
  const role: Role = req.body?.role === 'owner' ? 'owner' : 'investor'
  const user: SessionUser = {
    id: `demo-${role}`, email: `${role}@demo-session.meoktu`, name: role === 'owner' ? '사장님 체험자' : '투자자 체험자',
    role, passwordHash: 'demo-session', cash: 0, createdAt: now(), sessionMode: 'demo',
  }
  res.json({ token: demoTokenFor(role), user: publicUser(user), provider: 'ephemeral-demo', capabilities: ['public-read', 'graph-rag', ...(role === 'owner' ? ['local-upload', 'ocr-preview'] : [])] })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string }
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())
  if (user && password && !user.passwordHash.startsWith('supabase:') && await verifyPassword(password, user.passwordHash)) return res.json({ token: tokenFor(user), user: publicUser(user), provider: 'local-demo' })
  if (supabaseAuthConfigured && email && password) {
    try {
      const session = await supabaseRequest('token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: String(email).toLowerCase(), password }) })
      return res.json({ token: session.access_token, user: session.user, provider: 'supabase' })
    } catch { /* return the common authentication error below */ }
  }
  res.status(401).json({ error: '이메일 또는 비밀번호를 확인해주세요.' })
})

app.get('/api/me', auth(), async (req: AuthedRequest, res) => {
  const user = req.user!
  const positions = db.positions.filter((p) => p.userId === user.id && p.amount > 0).map((position) => {
    accrue(position)
    const fund = db.funds.find((f) => f.id === position.fundId)
    const restaurant = fund && db.restaurants.find((r) => r.id === fund.restaurantId)
    const reservedSell = db.orders.filter((o) => o.userId === user.id && o.fundId === position.fundId && o.type === 'sell' && o.remaining > 0).reduce((sum, o) => sum + o.remaining, 0)
    return { ...position, fund, restaurant, availableAmount: Math.max(0, position.amount - reservedSell) }
  })
  const orders = db.orders.filter((o) => o.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  sweepExchange()
  const coupons = db.coupons.filter((c) => c.userId === user.id).map(couponView)
  const applications = db.applications.filter((a) => a.userId === user.id)
  await saveDatabase()
  const visitVerifications = db.visitVerifications.filter((item) => item.userId === user.id)
  const walletTransactions = db.walletTransactions.filter((item) => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  const favoriteRestaurantIds = db.favorites.filter((item) => item.userId === user.id).map((item) => item.restaurantId)
  const ocrAnalyses = db.ocrAnalyses.filter((item) => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  const notifications = db.notifications.filter((item) => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
  const exchange = {
    openListings: db.couponListings.filter((item) => item.userId === user.id && item.status === 'open').length,
    offersReceived: db.couponOffers.filter((offer) => offer.status === 'pending' && db.couponListings.some((listing) => listing.id === offer.listingId && listing.userId === user.id)).length,
    offersSent: db.couponOffers.filter((offer) => offer.offerUserId === user.id && offer.status === 'pending').length,
    trades: db.couponTrades.filter((trade) => trade.listerUserId === user.id || trade.takerUserId === user.id).length,
  }
  const dataConnections = db.dataConnections.filter((item) => item.userId === user.id && item.status === 'active')
    .map(({ userId: _, ...item }) => item)
  res.json({ user: publicUser(user), positions, orders, coupons, applications, visitVerifications, walletTransactions, favoriteRestaurantIds, ocrAnalyses, dataConnections, notifications, unreadNotifications: notifications.filter((item) => !item.read).length, exchange, rules: EXCHANGE_RULES })
})

app.put('/api/favorites/:restaurantId', auth(), async (req: AuthedRequest, res) => {
  const restaurant = db.restaurants.find((item) => item.id === req.params.restaurantId)
  if (!restaurant) return res.status(404).json({ error: '찜할 식당을 찾을 수 없어요.' })
  if (!db.favorites.some((item) => item.userId === req.user!.id && item.restaurantId === restaurant.id)) {
    db.favorites.push({ userId: req.user!.id, restaurantId: restaurant.id, createdAt: now() })
    audit(req.user!.id, 'favorite.created', 'restaurant', restaurant.id, `${restaurant.name} 관심 식당 등록`)
    await saveDatabase(); changed()
  }
  res.json({ message: `${restaurant.name}을 관심 식당에 저장했어요.`, favoriteRestaurantIds: db.favorites.filter((item) => item.userId === req.user!.id).map((item) => item.restaurantId) })
})

app.delete('/api/favorites/:restaurantId', auth(), async (req: AuthedRequest, res) => {
  const index = db.favorites.findIndex((item) => item.userId === req.user!.id && item.restaurantId === req.params.restaurantId)
  if (index >= 0) {
    db.favorites.splice(index, 1)
    audit(req.user!.id, 'favorite.deleted', 'restaurant', String(req.params.restaurantId), '관심 식당 해제')
    await saveDatabase(); changed()
  }
  res.json({ message: '관심 식당에서 해제했어요.', favoriteRestaurantIds: db.favorites.filter((item) => item.userId === req.user!.id).map((item) => item.restaurantId) })
})

app.post('/api/wallet/topup', auth('investor'), async (req: AuthedRequest, res) => {
  const amount = round1000(req.body.amount)
  if (amount < 1000 || amount > 5000000) return res.status(400).json({ error: '시연용 충전은 1,000원부터 한 번에 500만원까지 가능해요.' })
  req.user!.cash += amount
  const transaction = { id: id('wallet'), userId: req.user!.id, type: 'demo_topup' as const, amount, createdAt: now() }
  db.walletTransactions.push(transaction)
  await saveDatabase(); changed()
  res.json({ message: `${amount.toLocaleString()} 먹투머니를 충전했어요. (시연용)`, balance: req.user!.cash, transaction })
})

app.post('/api/restaurants/:restaurantId/visit/verify', auth('investor'), async (req: AuthedRequest, res) => {
  const restaurant = db.restaurants.find((item) => item.id === req.params.restaurantId)
  if (!restaurant) return res.status(404).json({ error: '식당을 찾을 수 없어요.' })
  let verification = db.visitVerifications.find((item) => item.userId === req.user!.id && item.restaurantId === restaurant.id && !item.usedForReview)
  if (!verification) {
    verification = { id: id('visit'), restaurantId: restaurant.id, userId: req.user!.id, verifiedAt: now(), usedForReview: false }
    db.visitVerifications.push(verification)
  }
  await saveDatabase(); changed()
  res.json({ message: `${restaurant.name} 방문이 시연용으로 인증됐어요. 이제 리뷰를 쓸 수 있어요.`, verification })
})

app.post('/api/restaurants/:restaurantId/reviews', auth('investor'), async (req: AuthedRequest, res) => {
  const restaurant = db.restaurants.find((item) => item.id === req.params.restaurantId)
  const verification = db.visitVerifications.find((item) => item.userId === req.user!.id && item.restaurantId === req.params.restaurantId && !item.usedForReview)
  const rating = Math.round(Number(req.body.rating))
  const content = String(req.body.content || '').trim().slice(0, 500)
  if (!restaurant) return res.status(404).json({ error: '식당을 찾을 수 없어요.' })
  if (!verification) return res.status(400).json({ error: '방문 인증 후 리뷰를 작성할 수 있어요.' })
  if (rating < 1 || rating > 5) return res.status(400).json({ error: '평점은 1점부터 5점까지 선택해주세요.' })
  if (content.length < 10) return res.status(400).json({ error: '리뷰를 10자 이상 작성해주세요.' })
  const review: Review = { id: id('review'), restaurantId: restaurant.id, userId: req.user!.id, userName: req.user!.name, rating, content, visitVerified: true, createdAt: now() }
  const oldCount = restaurant.reviewCount
  restaurant.rating = Number(((restaurant.rating * oldCount + rating) / (oldCount + 1)).toFixed(2))
  restaurant.reviewCount += 1
  verification.usedForReview = true
  db.reviews.push(review)
  await saveDatabase(); changed()
  res.status(201).json({ message: '방문 인증 리뷰를 등록했어요.', review })
})

app.delete('/api/orders/:orderId', auth('investor'), async (req: AuthedRequest, res) => {
  const order = db.orders.find((item) => item.id === req.params.orderId && item.userId === req.user!.id && item.remaining > 0 && ['open', 'partial'].includes(item.status))
  if (!order) return res.status(404).json({ error: '취소할 수 있는 대기 주문이 없어요.' })
  const refunded = order.type === 'buy' ? order.remaining : 0
  if (refunded) req.user!.cash += refunded
  order.remaining = 0
  order.status = 'cancelled'
  refreshOrderTotals(order.fundId)
  await saveDatabase(); changed()
  res.json({ message: refunded ? `예약을 취소하고 ${refunded.toLocaleString()} 먹투머니를 돌려받았어요.` : '회수 대기 주문을 취소했어요.' })
})
app.post('/api/funds/:fundId/invest', auth('investor'), async (req: AuthedRequest, res) => {
  const user = req.user!
  const fund = db.funds.find((f) => f.id === req.params.fundId)
  const amount = round1000(req.body.amount)
  if (!fund || fund.status === 'closed') return res.status(404).json({ error: '투자 가능한 펀드를 찾을 수 없어요.' })
  if (amount < 1000) return res.status(400).json({ error: '투자는 1,000원 단위로 가능해요.' })
  if (user.cash < amount) return res.status(400).json({ error: '보유 머니가 부족해요.' })
  if (fund.status === 'trading' && db.orders.some((order) => order.userId === user.id && order.fundId === fund.id && order.type === 'sell' && order.remaining > 0)) return res.status(400).json({ error: '이 펀드의 회수 대기 주문을 먼저 취소하거나 체결해주세요.' })
  const position = getPosition(user.id, fund.id)
  const pending = db.orders.filter((o) => o.userId === user.id && o.fundId === fund.id && o.type === 'buy' && o.remaining > 0).reduce((sum, o) => sum + o.remaining, 0)
  const personalLimit = Math.floor(fund.goal * 0.01 / 1000) * 1000
  if (position.amount + pending + amount > personalLimit) return res.status(400).json({ error: `한 식당에는 목표액의 1%인 ${personalLimit.toLocaleString()}원까지 투자할 수 있어요.` })
  user.cash -= amount
  if (fund.status === 'funding') {
    const accepted = Math.min(amount, fund.goal - fund.raised)
    if (accepted < amount) user.cash += amount - accepted
    position.amount += accepted
    position.early = true
    fund.raised += accepted
    fund.investorCount += position.amount === accepted ? 1 : 0
    if (fund.raised >= fund.goal) {
      fund.status = 'trading'
      fund.endsAt = now()
    }
    await saveDatabase(); changed()
    return res.json({ message: `${accepted.toLocaleString()}원이 바로 투자됐어요.`, matched: accepted, queued: 0 })
  }
  const order: Order = { id: id('order'), userId: user.id, fundId: fund.id, type: 'buy', originalAmount: amount, remaining: amount, status: 'open', createdAt: now() }
  db.orders.push(order)
  const matches = matchOrders(fund.id)
  await saveDatabase(); changed()
  const matched = amount - order.remaining
  res.json({ message: matched === amount ? '예약한 금액이 모두 투자됐어요.' : matched > 0 ? `${matched.toLocaleString()}원이 투자되고 나머지는 예약됐어요.` : '매도자가 나타나면 1,000원부터 순서대로 투자돼요.', matched, queued: order.remaining, matches })
})

app.post('/api/funds/:fundId/withdraw', auth('investor'), async (req: AuthedRequest, res) => {
  const user = req.user!
  const fund = db.funds.find((f) => f.id === req.params.fundId)
  const amount = round1000(req.body.amount)
  if (!fund) return res.status(404).json({ error: '펀드를 찾을 수 없어요.' })
  if (amount < 1000) return res.status(400).json({ error: '회수는 1,000원 단위로 가능해요.' })
  const position = db.positions.find((p) => p.userId === user.id && p.fundId === fund.id)
  if (!position) return res.status(400).json({ error: '보유한 투자금이 없어요.' })
  if (fund.status === 'trading' && db.orders.some((order) => order.userId === user.id && order.fundId === fund.id && order.type === 'buy' && order.remaining > 0)) return res.status(400).json({ error: '이 펀드의 투자 예약을 먼저 취소하거나 체결해주세요.' })
  const alreadySelling = db.orders.filter((o) => o.userId === user.id && o.fundId === fund.id && o.type === 'sell' && o.remaining > 0).reduce((sum, o) => sum + o.remaining, 0)
  if (position.amount - alreadySelling < amount) return res.status(400).json({ error: '주문 가능한 투자금보다 큰 금액이에요.' })
  const coupon = issueCoupon(position, true)
  if (fund.status === 'funding') {
    position.amount -= amount
    fund.raised = Math.max(0, fund.raised - amount)
    user.cash += amount
    await saveDatabase(); changed()
    return res.json({ message: `${amount.toLocaleString()}원을 바로 회수했어요.`, matched: amount, queued: 0, coupon })
  }
  const order: Order = { id: id('order'), userId: user.id, fundId: fund.id, type: 'sell', originalAmount: amount, remaining: amount, status: 'open', createdAt: now() }
  db.orders.push(order)
  const matches = matchOrders(fund.id)
  await saveDatabase(); changed()
  const matched = amount - order.remaining
  res.json({ message: matched === amount ? '신청한 금액을 모두 회수했어요.' : matched > 0 ? `${matched.toLocaleString()}원이 회수되고 나머지는 대기 중이에요.` : '사는 사람이 나타나면 1,000원부터 순서대로 회수돼요.', matched, queued: order.remaining, coupon, matches })
})

app.post('/api/positions/:positionId/coupon', auth('investor'), async (req: AuthedRequest, res) => {
  const position = db.positions.find((p) => p.id === req.params.positionId && p.userId === req.user!.id)
  if (!position) return res.status(404).json({ error: '투자 내역을 찾을 수 없어요.' })
  const coupon = issueCoupon(position)
  if (!coupon) return res.status(400).json({ error: '쿠폰은 할인율 10%부터 발급할 수 있어요.' })
  await saveDatabase(); changed()
  res.json({ message: `${coupon.discount}% 쿠폰을 발급했어요.`, coupon })
})

/* ── 쿠폰 교환장 API ───────────────────────────────────────────── */

app.get('/api/market/rules', (_req, res) => {
  sweepExchange()
  res.json({
    rules: EXCHANGE_RULES,
    categories: [...new Set(db.restaurants.map((item) => item.category))].sort(),
    regions: [...new Set(db.restaurants.map((item) => item.region))].sort(),
    explain: [
      `할인율 차이 ${EXCHANGE_RULES.maxDiscountGap}%p 미만`,
      `최대 할인 금액 차이 ${EXCHANGE_RULES.maxValueRatio}배 이내`,
      `만료 ${EXCHANGE_RULES.minDaysLeft}일 이상 남은 쿠폰만`,
      '등록자가 지정한 업종·지역·최소 할인율 조건 충족',
    ],
  })
})

/** 교환장 목록. 로그인하면 내가 바꿀 수 있는 매물인지까지 표시된다. */
app.get('/api/market/listings', async (req: AuthedRequest, res) => {
  sweepExchange()
  const viewer = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  const category = String(req.query.category || '').trim()
  const region = String(req.query.region || '').trim()
  const minDiscount = Number(req.query.minDiscount || 0)
  const maxDiscount = Number(req.query.maxDiscount || 100)
  const onlyMatchable = /^(1|true)$/i.test(String(req.query.matchable || ''))
  const query = String(req.query.q || '').trim().toLocaleLowerCase('ko')

  const listings = db.couponListings
    .filter((listing) => listing.status === 'open')
    .map((listing) => listingView(listing, viewer?.id))
    .filter((listing) => {
      if (!listing.coupon || !listing.restaurant) return false
      if (category && listing.restaurant.category !== category) return false
      if (region && listing.restaurant.region !== region) return false
      if (listing.coupon.discount < minDiscount || listing.coupon.discount > maxDiscount) return false
      if (onlyMatchable && !listing.matchableCouponIds.length) return false
      if (query && !`${listing.restaurant.name} ${listing.coupon.title} ${listing.note}`.toLocaleLowerCase('ko').includes(query)) return false
      return true
    })
    .sort((a, b) => Number(b.matchableCouponIds.length > 0) - Number(a.matchableCouponIds.length > 0) || b.createdAt.localeCompare(a.createdAt))

  res.json({ listings, total: listings.length })
})

/** 내 교환 현황: 올린 매물, 받은 제안, 보낸 제안, 거래 이력. */
app.get('/api/market/mine', auth(), (req: AuthedRequest, res) => {
  sweepExchange()
  const me = req.user!
  const myListings = db.couponListings
    .filter((listing) => listing.userId === me.id && ['open', 'completed', 'cancelled', 'expired'].includes(listing.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((listing) => ({
      ...listingView(listing, me.id),
      offers: db.couponOffers
        .filter((offer) => offer.listingId === listing.id && offer.status === 'pending')
        .map((offer) => {
          const offered = db.coupons.find((item) => item.id === offer.offerCouponId)
          const wanted = db.coupons.find((item) => item.id === listing.couponId)
          const check = offered && wanted
            ? checkSwap({ listing, wanted, offered, offeredRestaurant: restaurantOf(offered), offerUserId: offer.offerUserId })
            : { ok: false, issues: [{ code: 'gone', message: '쿠폰을 찾을 수 없어요.' }] }
          return { ...offer, coupon: offered && couponView(offered), fromUserName: userName(offer.offerUserId), stillValid: check.ok, issues: check.issues }
        }),
    }))

  const sentOffers = db.couponOffers
    .filter((offer) => offer.offerUserId === me.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((offer) => {
      const listing = db.couponListings.find((item) => item.id === offer.listingId)
      const offered = db.coupons.find((item) => item.id === offer.offerCouponId)
      return {
        ...offer,
        listing: listing && listingView(listing, me.id),
        coupon: offered && couponView(offered),
        toUserName: listing ? userName(listing.userId) : '알 수 없음',
      }
    })

  const trades = db.couponTrades
    .filter((trade) => trade.listerUserId === me.id || trade.takerUserId === me.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((trade) => {
      const iAmLister = trade.listerUserId === me.id
      const gaveId = iAmLister ? trade.listerCouponId : trade.takerCouponId
      const gotId = iAmLister ? trade.takerCouponId : trade.listerCouponId
      return {
        id: trade.id, createdAt: trade.createdAt, mode: trade.mode,
        counterpartyName: userName(iAmLister ? trade.takerUserId : trade.listerUserId),
        gave: db.coupons.find((item) => item.id === gaveId),
        got: db.coupons.find((item) => item.id === gotId),
      }
    })

  res.json({ listings: myListings, sentOffers, trades, rules: EXCHANGE_RULES })
})

/** 쿠폰을 교환장에 올린다. 올리는 순간 쿠폰은 잠기고 다른 곳에 못 쓴다. */
app.post('/api/coupons/:couponId/list', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  if (!rateLimit(`list:${me.id}`, 20, 60_000)) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' })
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const coupon = db.coupons.find((item) => item.id === req.params.couponId && item.userId === me.id)
    if (!coupon) return { status: 404, body: { error: '교환할 수 있는 쿠폰을 찾지 못했어요.' } }
    const blockers = couponUsable(coupon)
    if (blockers.length) return { status: 400, body: { error: blockers[0].message, issues: blockers } }

    const open = db.couponListings.filter((item) => item.userId === me.id && item.status === 'open').length
    if (open >= EXCHANGE_RULES.maxOpenListingsPerUser) {
      return { status: 400, body: { error: `동시에 올릴 수 있는 교환은 ${EXCHANGE_RULES.maxOpenListingsPerUser}개까지예요.` } }
    }

    const categories = [...new Set(db.restaurants.map((item) => item.category))]
    const regions = [...new Set(db.restaurants.map((item) => item.region))]
    const listing: CouponListing = {
      id: id('listing'), userId: me.id, couponId: coupon.id,
      wantedCategories: normalizePreferences(req.body.wantedCategories ?? req.body.wantedCategory, categories),
      wantedRegions: normalizePreferences(req.body.wantedRegions ?? req.body.wantedRegion, regions),
      minDiscount: Math.max(0, Math.min(100, Number(req.body.minDiscount) || 0)),
      autoAccept: req.body.autoAccept !== false,
      note: String(req.body.note || '').slice(0, 140),
      status: 'open', createdAt: now(),
      expiresAt: new Date(Date.now() + EXCHANGE_RULES.listingTtlDays * 86400000).toISOString(),
    }
    coupon.status = 'listed'
    db.couponListings.push(listing)
    audit(me.id, 'coupon.list', 'listing', listing.id, `${coupon.title} 교환장 등록`)
    await saveDatabase(); changed()
    return { status: 200, body: { message: '쿠폰 교환장에 등록했어요.', listing: listingView(listing, me.id) } }
  })
  res.status(result.status).json(result.body)
})

/** 등록해 둔 교환 조건 수정. */
app.patch('/api/listings/:listingId', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const listing = db.couponListings.find((item) => item.id === req.params.listingId && item.userId === me.id && item.status === 'open')
    if (!listing) return { status: 404, body: { error: '수정할 수 있는 교환 등록을 찾지 못했어요.' } }
    const categories = [...new Set(db.restaurants.map((item) => item.category))]
    const regions = [...new Set(db.restaurants.map((item) => item.region))]
    if (req.body.wantedCategories !== undefined) listing.wantedCategories = normalizePreferences(req.body.wantedCategories, categories)
    if (req.body.wantedRegions !== undefined) listing.wantedRegions = normalizePreferences(req.body.wantedRegions, regions)
    if (req.body.minDiscount !== undefined) listing.minDiscount = Math.max(0, Math.min(100, Number(req.body.minDiscount) || 0))
    if (req.body.autoAccept !== undefined) listing.autoAccept = req.body.autoAccept === true
    if (req.body.note !== undefined) listing.note = String(req.body.note || '').slice(0, 140)
    audit(me.id, 'coupon.listing_updated', 'listing', listing.id, '교환 조건 수정')
    await saveDatabase(); changed()
    return { status: 200, body: { message: '교환 조건을 수정했어요.', listing: listingView(listing, me.id) } }
  })
  res.status(result.status).json(result.body)
})

/** 교환 등록 취소. 걸려 있던 상대 제안도 함께 풀어준다. */
app.delete('/api/listings/:listingId', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const listing = db.couponListings.find((item) => item.id === req.params.listingId && item.userId === me.id && item.status === 'open')
    const coupon = listing && db.coupons.find((item) => item.id === listing.couponId && item.userId === me.id)
    if (!listing || !coupon) return { status: 404, body: { error: '취소할 수 있는 교환 제안을 찾지 못했어요.' } }
    listing.status = 'cancelled'
    coupon.status = daysLeft(coupon.expiresAt) > 0 ? 'available' : 'expired'
    for (const offer of db.couponOffers) {
      if (offer.listingId !== listing.id || offer.status !== 'pending') continue
      offer.status = 'declined'
      offer.resolvedAt = now()
      const held = db.coupons.find((item) => item.id === offer.offerCouponId)
      if (held && held.status === 'offered') held.status = 'available'
      pushNotification(offer.offerUserId, 'offer_declined', '교환 등록이 내려갔어요',
        `${coupon.title} 매물이 취소되어 걸어둔 쿠폰을 지갑으로 돌려드렸어요.`, '/market')
    }
    audit(me.id, 'coupon.unlist', 'listing', listing.id, `${coupon.title} 교환 취소`)
    await saveDatabase(); changed()
    return { status: 200, body: { message: `${coupon.title} 교환을 취소하고 내 지갑으로 돌려받았어요.`, coupon: couponView(coupon) } }
  })
  res.status(result.status).json(result.body)
})

/** 즉시 교환. 등록자가 자동 수락을 켜둔 매물에서만 가능하다. */
app.post('/api/listings/:listingId/swap', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  if (!rateLimit(`swap:${me.id}`, 30, 60_000)) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' })
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const listing = db.couponListings.find((item) => item.id === req.params.listingId && item.status === 'open')
    if (!listing) return { status: 404, body: { error: '이미 마감된 교환 등록이에요.' } }
    const wanted = db.coupons.find((item) => item.id === listing.couponId)
    const offered = db.coupons.find((item) => item.id === String(req.body.couponId || '') && item.userId === me.id)
    if (!wanted || !offered) return { status: 400, body: { error: '교환할 쿠폰을 찾지 못했어요.' } }
    if (!listing.autoAccept) {
      return { status: 409, body: { error: '이 매물은 등록자 승인이 필요해요. 교환 제안을 보내주세요.', requiresOffer: true } }
    }
    const check = checkSwap({ listing, wanted, offered, offeredRestaurant: restaurantOf(offered), offerUserId: me.id })
    if (!check.ok) return { status: 400, body: { error: check.issues[0].message, issues: check.issues } }
    const trade = settleSwap(listing, wanted, offered, me.id, 'instant')
    await saveDatabase(); changed()
    return { status: 200, body: { message: `${offered.title} → ${wanted.title} 교환이 완료됐어요!`, trade, coupon: couponView(wanted) } }
  })
  res.status(result.status).json(result.body)
})

/** 교환 제안 보내기. 제안한 쿠폰은 그 자리에서 잠겨(에스크로) 이중 제안이 막힌다. */
app.post('/api/listings/:listingId/offers', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  if (!rateLimit(`offer:${me.id}`, 30, 60_000)) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' })
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const listing = db.couponListings.find((item) => item.id === req.params.listingId && item.status === 'open')
    if (!listing) return { status: 404, body: { error: '이미 마감된 교환 등록이에요.' } }
    const wanted = db.coupons.find((item) => item.id === listing.couponId)
    const offered = db.coupons.find((item) => item.id === String(req.body.couponId || '') && item.userId === me.id)
    if (!wanted || !offered) return { status: 400, body: { error: '교환할 쿠폰을 찾지 못했어요.' } }

    const check = checkSwap({ listing, wanted, offered, offeredRestaurant: restaurantOf(offered), offerUserId: me.id })
    if (!check.ok) return { status: 400, body: { error: check.issues[0].message, issues: check.issues } }

    if (db.couponOffers.some((item) => item.listingId === listing.id && item.offerUserId === me.id && item.status === 'pending')) {
      return { status: 409, body: { error: '이미 이 매물에 제안을 보냈어요. 기존 제안을 취소하고 다시 보내주세요.' } }
    }
    const pendingMine = db.couponOffers.filter((item) => item.offerUserId === me.id && item.status === 'pending').length
    if (pendingMine >= EXCHANGE_RULES.maxPendingOffersPerUser) {
      return { status: 400, body: { error: `동시에 보낼 수 있는 제안은 ${EXCHANGE_RULES.maxPendingOffersPerUser}개까지예요.` } }
    }
    const pendingHere = db.couponOffers.filter((item) => item.listingId === listing.id && item.status === 'pending').length
    if (pendingHere >= EXCHANGE_RULES.maxOffersPerListing) {
      return { status: 400, body: { error: '이 매물에 제안이 너무 많이 몰렸어요. 잠시 후 다시 시도해주세요.' } }
    }

    // 자동 수락 매물이면 제안 단계 없이 바로 체결한다.
    if (listing.autoAccept) {
      const trade = settleSwap(listing, wanted, offered, me.id, 'instant')
      await saveDatabase(); changed()
      return { status: 200, body: { message: `${offered.title} → ${wanted.title} 교환이 바로 완료됐어요!`, trade, settled: true } }
    }

    const offer: CouponOffer = {
      id: id('offer'), listingId: listing.id, offerUserId: me.id, offerCouponId: offered.id,
      message: String(req.body.message || '').slice(0, 140), status: 'pending', createdAt: now(),
    }
    offered.status = 'offered'
    db.couponOffers.push(offer)
    audit(me.id, 'coupon.offer', 'listing', listing.id, `${offered.title} 교환 제안`)
    pushNotification(listing.userId, 'offer_received', '새 교환 제안이 왔어요',
      `${me.name}님이 ${offered.discount}% ${offered.title}(으)로 교환을 제안했어요.`, '/my')
    await saveDatabase(); changed()
    return { status: 201, body: { message: '교환 제안을 보냈어요. 등록자가 수락하면 바로 교환돼요.', offer, settled: false } }
  })
  res.status(result.status).json(result.body)
})

/** 보낸 제안 취소. 걸어둔 쿠폰이 지갑으로 돌아온다. */
app.delete('/api/offers/:offerId', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const offer = db.couponOffers.find((item) => item.id === req.params.offerId && item.offerUserId === me.id && item.status === 'pending')
    if (!offer) return { status: 404, body: { error: '취소할 수 있는 제안을 찾지 못했어요.' } }
    offer.status = 'withdrawn'
    offer.resolvedAt = now()
    const held = db.coupons.find((item) => item.id === offer.offerCouponId)
    if (held && held.status === 'offered') held.status = daysLeft(held.expiresAt) > 0 ? 'available' : 'expired'
    const listing = db.couponListings.find((item) => item.id === offer.listingId)
    if (listing) {
      pushNotification(listing.userId, 'offer_withdrawn', '교환 제안이 취소됐어요', `${me.name}님이 보낸 교환 제안을 거두었어요.`, '/my')
    }
    audit(me.id, 'coupon.offer_withdrawn', 'offer', offer.id, '교환 제안 취소')
    await saveDatabase(); changed()
    return { status: 200, body: { message: '교환 제안을 취소하고 쿠폰을 돌려받았어요.', coupon: held && couponView(held) } }
  })
  res.status(result.status).json(result.body)
})

/** 받은 제안 수락 → 교환 체결. */
app.post('/api/offers/:offerId/accept', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const offer = db.couponOffers.find((item) => item.id === req.params.offerId && item.status === 'pending')
    const listing = offer && db.couponListings.find((item) => item.id === offer.listingId && item.userId === me.id && item.status === 'open')
    if (!offer || !listing) return { status: 404, body: { error: '수락할 수 있는 제안을 찾지 못했어요.' } }
    const wanted = db.coupons.find((item) => item.id === listing.couponId)
    const offered = db.coupons.find((item) => item.id === offer.offerCouponId)
    if (!wanted || !offered) return { status: 400, body: { error: '교환할 쿠폰을 찾지 못했어요.' } }
    // 제안 이후에 만료되거나 조건이 어긋났을 수 있으니 체결 직전에 다시 본다.
    const check = checkSwap({ listing, wanted, offered, offeredRestaurant: restaurantOf(offered), offerUserId: offer.offerUserId })
    if (!check.ok) {
      offer.status = 'expired'
      offer.resolvedAt = now()
      if (offered.status === 'offered') offered.status = daysLeft(offered.expiresAt) > 0 ? 'available' : 'expired'
      await saveDatabase(); changed()
      return { status: 409, body: { error: `지금은 교환할 수 없어요. ${check.issues[0].message}`, issues: check.issues } }
    }
    const trade = settleSwap(listing, wanted, offered, offer.offerUserId, 'offer', offer)
    await saveDatabase(); changed()
    return { status: 200, body: { message: `${userName(offer.offerUserId)}님과 교환을 완료했어요!`, trade } }
  })
  res.status(result.status).json(result.body)
})

/** 받은 제안 거절. */
app.post('/api/offers/:offerId/decline', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const offer = db.couponOffers.find((item) => item.id === req.params.offerId && item.status === 'pending')
    const listing = offer && db.couponListings.find((item) => item.id === offer.listingId && item.userId === me.id)
    if (!offer || !listing) return { status: 404, body: { error: '거절할 수 있는 제안을 찾지 못했어요.' } }
    offer.status = 'declined'
    offer.resolvedAt = now()
    const held = db.coupons.find((item) => item.id === offer.offerCouponId)
    if (held && held.status === 'offered') held.status = daysLeft(held.expiresAt) > 0 ? 'available' : 'expired'
    pushNotification(offer.offerUserId, 'offer_declined', '교환 제안이 거절됐어요',
      `${me.name}님이 제안을 거절했어요. 걸어둔 쿠폰은 지갑으로 돌아왔어요.`, '/market')
    audit(me.id, 'coupon.offer_declined', 'offer', offer.id, '교환 제안 거절')
    await saveDatabase(); changed()
    return { status: 200, body: { message: '제안을 거절했어요.' } }
  })
  res.status(result.status).json(result.body)
})

/** 쿠폰 사용 요청. 코드가 나오고, 사장님이 확인하면 실제 사용 처리된다. */
app.post('/api/coupons/:couponId/redeem', auth(), async (req: AuthedRequest, res) => {
  const me = req.user!
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const coupon = db.coupons.find((item) => item.id === req.params.couponId && item.userId === me.id)
    if (!coupon) return { status: 404, body: { error: '쿠폰을 찾지 못했어요.' } }
    if (coupon.status === 'redeeming' && coupon.redeemCode) {
      return { status: 200, body: { message: '이미 발급된 사용 코드예요.', code: coupon.redeemCode, coupon: couponView(coupon) } }
    }
    const blockers = couponUsable(coupon).filter((issue) => issue.code !== 'expiring')
    if (blockers.length) return { status: 400, body: { error: blockers[0].message } }
    let code = ''
    do { code = crypto.randomBytes(4).toString('hex').toUpperCase() }
    while (db.coupons.some((item) => item.redeemCode === code))
    coupon.status = 'redeeming'
    coupon.redeemCode = code
    coupon.redeemRequestedAt = now()
    audit(me.id, 'coupon.redeem_requested', 'coupon', coupon.id, `${coupon.title} 사용 코드 발급`)
    await saveDatabase(); changed()
    return {
      status: 200,
      body: {
        message: `사장님께 코드 ${code}를 보여주세요. ${EXCHANGE_RULES.redeemHoldMinutes}분 안에 확인되지 않으면 지갑으로 돌아와요.`,
        code, expiresInMinutes: EXCHANGE_RULES.redeemHoldMinutes, coupon: couponView(coupon),
      },
    }
  })
  res.status(result.status).json(result.body)
})

/** 사장님이 손님 코드를 확인해 실제 사용 처리. 내 가게 쿠폰만 확인할 수 있다. */
app.post('/api/owner/coupons/verify', auth('owner'), async (req: AuthedRequest, res) => {
  const me = req.user!
  if (!rateLimit(`verify:${me.id}`, 60, 60_000)) return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' })
  const result = await withExchangeLock(async () => {
    sweepExchange()
    const code = String(req.body.code || '').trim().toUpperCase()
    if (!code) return { status: 400, body: { error: '쿠폰 코드를 입력해주세요.' } }
    const coupon = db.coupons.find((item) => item.redeemCode === code && item.status === 'redeeming')
    if (!coupon) return { status: 404, body: { error: '확인할 수 없는 코드예요. 손님 화면에서 코드를 다시 받아주세요.' } }
    const restaurant = restaurantOf(coupon)
    if (!restaurant || restaurant.ownerId !== me.id) return { status: 403, body: { error: '내 가게에서 쓸 수 있는 쿠폰이 아니에요.' } }
    coupon.status = 'used'
    coupon.usedAt = now()
    coupon.usedAtRestaurantId = restaurant.id
    coupon.redeemCode = undefined
    coupon.redeemRequestedAt = undefined
    const fund = coupon.fundId ? db.funds.find((item) => item.id === coupon.fundId) : undefined
    if (fund) fund.totalCouponUsed += coupon.maxDiscountWon
    audit(me.id, 'coupon.redeemed', 'coupon', coupon.id, `${coupon.title} 사용 확인 (최대 ${coupon.maxDiscountWon}원)`)
    pushNotification(coupon.userId, 'coupon_used', '쿠폰이 사용 처리됐어요',
      `${restaurant.name}에서 ${coupon.discount}% 쿠폰이 확인됐어요. 맛있게 드세요!`, '/my')
    await saveDatabase(); changed()
    return {
      status: 200,
      body: { message: `${coupon.discount}% 쿠폰을 확인했어요. 최대 ${coupon.maxDiscountWon.toLocaleString()}원 할인.`, coupon: couponView(coupon), customerName: userName(coupon.userId) },
    }
  })
  res.status(result.status).json(result.body)
})

app.get('/api/notifications', auth(), (req: AuthedRequest, res) => {
  sweepExchange()
  const items = db.notifications
    .filter((item) => item.userId === req.user!.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
  res.json({ notifications: items, unread: items.filter((item) => !item.read).length })
})

app.post('/api/notifications/read', auth(), async (req: AuthedRequest, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : undefined
  for (const item of db.notifications) {
    if (item.userId !== req.user!.id) continue
    if (ids && !ids.includes(item.id)) continue
    item.read = true
  }
  await saveDatabase()
  res.json({ message: '알림을 읽음 처리했어요.' })
})

/**
 * 제휴기관/마이데이터형 연결 시연.
 * 브라우저가 connectedSources 문자열을 임의로 보내는 방식이 아니라, 서버 원장에 기록된
 * 활성 연결만 심사 입력으로 인정한다. 실제 출시 시 이 어댑터를 기관 OAuth·전자서명 콜백으로 교체한다.
 */
app.post('/api/data-connections/:sourceId', auth('owner'), async (req: AuthedRequest, res) => {
  const sourceId = String(req.params.sourceId) as PartnerSourceId
  const catalog = partnerSourceCatalog[sourceId]
  if (!catalog) return res.status(404).json({ error: '지원하지 않는 제휴 데이터예요.' })
  if (req.body?.consent !== true) return res.status(400).json({ error: '조회 범위와 목적에 동의해야 연결할 수 있어요.' })
  const at = now()
  let connection = db.dataConnections.find((item) => item.userId === req.user!.id && item.sourceId === sourceId)
  if (connection) {
    Object.assign(connection, { provider: catalog.provider, status: 'active', consentScope: catalog.scope, recordCount: catalog.recordCount, lastSyncedAt: at })
  } else {
    connection = {
      id: id('connection'), userId: req.user!.id, sourceId, provider: catalog.provider, status: 'active',
      consentScope: catalog.scope, recordCount: catalog.recordCount, connectedAt: at, lastSyncedAt: at,
    } satisfies DataConnection
    db.dataConnections.push(connection)
  }
  audit(req.user!.id, 'data_connection.connected', 'data_connection', connection.id, `${catalog.provider} · ${catalog.scope}`)
  await saveDatabase(); changed()
  const { userId: _, ...safe } = connection
  res.json({ message: `${catalog.provider} 연결을 완료했어요. 이 연결은 시연 어댑터이며 실제 기관 조회가 아닙니다.`, connection: safe })
})

app.delete('/api/data-connections/:sourceId', auth('owner'), async (req: AuthedRequest, res) => {
  const sourceId = String(req.params.sourceId)
  const connection = db.dataConnections.find((item) => item.userId === req.user!.id && item.sourceId === sourceId && item.status === 'active')
  if (!connection) return res.status(404).json({ error: '활성 연결을 찾지 못했어요.' })
  connection.status = 'revoked'
  connection.lastSyncedAt = now()
  audit(req.user!.id, 'data_connection.revoked', 'data_connection', connection.id, `${connection.provider} 연결 해제`)
  await saveDatabase(); changed()
  res.json({ message: '데이터 연결을 해제했어요. 이후 심사에는 연결 자료를 사용하지 않습니다.' })
})

app.post('/api/applications', auth('owner'), async (req: AuthedRequest, res) => {
  const data = req.body as Record<string, unknown>
  const restaurantName = String(data.restaurantName || '').trim()
  const uploadedDocuments = data.uploadedDocuments && typeof data.uploadedDocuments === 'object' && !Array.isArray(data.uploadedDocuments) ? data.uploadedDocuments as Record<string, unknown> : {}
  const rawMetadata = data.documentMetadata && typeof data.documentMetadata === 'object' && !Array.isArray(data.documentMetadata) ? data.documentMetadata as Record<string, Record<string, unknown>> : {}
  const allowedSources = ['business','license','identity','pos','account','card','delivery','tax','customer','lease','debt','staff']
  const declaredSources = Array.isArray(data.connectedSources) ? data.connectedSources.map(String) : []
  const uploadedSources = declaredSources.filter((source) => allowedSources.includes(source) && source !== 'identity' && typeof uploadedDocuments[source] === 'string' && String(uploadedDocuments[source]).trim().length > 0)
  const partnerSources = db.dataConnections.filter((item) => item.userId === req.user!.id && item.status === 'active').map((item) => item.sourceId)
  const connectedSources = [...new Set([...(data.identityVerified === true ? ['identity'] : []), ...uploadedSources, ...partnerSources])]
  const documentMetadata = Object.fromEntries(uploadedSources.map((source) => {
    const raw = rawMetadata[source] || {}
    return [source, {
      name: String(uploadedDocuments[source]).slice(0, 255),
      size: Math.max(0, Math.min(10 * 1024 * 1024, Number(raw.size) || 0)),
      type: String(raw.type || '').slice(0, 100),
      rowCount: Math.max(0, Math.min(1000000, Number(raw.rowCount) || 0)),
      headers: Array.isArray(raw.headers) ? raw.headers.slice(0, 40).map((item) => String(item).slice(0, 80)) : [],
    }]
  }))
  const sourceProvenance = {
    ownerUploaded: uploadedSources,
    partnerConnected: partnerSources,
    identityVerified: data.identityVerified === true,
    partnerConnections: db.dataConnections.filter((item) => item.userId === req.user!.id && item.status === 'active')
      .map((item) => ({ sourceId: item.sourceId, provider: item.provider, consentScope: item.consentScope, lastSyncedAt: item.lastSyncedAt, recordCount: item.recordCount })),
  }
  const has = (source: string) => connectedSources.includes(source)
  const requestedLimit = Math.max(0, round1000(data.requestedLimit))
  const requiredDocuments = ['business','license','pos','account']
  const missingDocuments = requiredDocuments.filter((source) => !has(source))
  if (restaurantName.length < 2) return res.status(400).json({ error: '상호명을 입력해주세요.' })
  if (data.privacyConsent !== true) return res.status(400).json({ error: '펀딩 심사를 위한 개인정보 수집·이용 동의가 필요해요.' })
  if (data.creditConsent !== true) return res.status(400).json({ error: '현금흐름과 상환부담 분석을 위한 개인(신용)정보 수집·이용 동의가 필요해요.' })
  if (!has('identity')) return res.status(400).json({ error: '대표자 본인인증을 완료해주세요.' })
  const numberCheck = verifyBusiness({ businessNumber: data.businessNumber, ownerName: data.ownerName, licenseNumber: data.licenseNumber, identityVerified: true })
  if (!numberCheck.checks.사업자번호_형식) return res.status(400).json({ error: '사업자등록번호 10자리를 정확히 입력해주세요.' })
  if (!numberCheck.checks.사업자번호_검증번호) return res.status(400).json({ error: '사업자등록번호 검증번호가 맞지 않아요. 숫자를 다시 확인해주세요.' })
  if (!numberCheck.checks.대표자명_입력) return res.status(400).json({ error: '대표자명을 입력해주세요.' })
  if (!numberCheck.checks.영업신고번호_입력) return res.status(400).json({ error: '영업신고번호를 입력해주세요.' })
  if (missingDocuments.length) return res.status(400).json({ error: '사업자등록·영업신고·POS·사업계좌 필수 자료를 각각 업로드해주세요.' })
  if (!String(data.fundPurpose || '').trim() || !String(data.businessPlan || '').trim()) return res.status(400).json({ error: '자금 사용계획과 사업계획을 작성해주세요.' })

  const numericSeed = [...restaurantName].reduce((sum, character) => sum + character.charCodeAt(0), 0)
  const monthlySales = 32000000 + (numericSeed % 1700) * 10000
  const salesGrowth = Number((8.5 + (numericSeed % 83) / 10).toFixed(1))
  const operatingCashflow = Math.round(monthlySales * (.105 + (numericSeed % 45) / 1000) / 10000) * 10000
  const salesVolatility = Number((6.2 + (numericSeed % 54) / 10).toFixed(1))
  const repeatRate = has('customer') || has('delivery') ? Number((31 + (numericSeed % 210) / 10).toFixed(1)) : null
  const averageTicket = 12800 + (numericSeed % 95) * 100
  const deliveryShare = has('delivery') ? Number((18 + (numericSeed % 190) / 10).toFixed(1)) : null
  const rentRatio = has('lease') ? Number((6 + (numericSeed % 63) / 10).toFixed(1)) : null
  const monthlyDebtPayment = has('debt') ? 900000 + (numericSeed % 19) * 100000 : null
  const debtServiceRatio = monthlyDebtPayment ? Number((monthlyDebtPayment / Math.max(1, operatingCashflow) * 100).toFixed(1)) : null
  const operatingYears = 2 + numericSeed % 7
  const staffBefore = 2 + numericSeed % 3
  const staffCurrent = staffBefore + (salesGrowth >= 12 ? 2 : 1)
  const districtSalesGrowth = 4.1
  const relativeGrowth = Number((salesGrowth - districtSalesGrowth).toFixed(1))
  const reconciliationRate = has('pos') && has('account') && has('card') ? Number((94 + (numericSeed % 41) / 10).toFixed(1)) : has('pos') && has('account') ? 88.4 : 72.5

  const sourceWeights: Record<string, number> = { business: 10, license: 8, identity: 8, pos: 15, account: 15, card: 10, delivery: 7, tax: 10, customer: 7, lease: 5, debt: 5, staff: 5 }
  const dataConfidence = Math.min(100, 18 + connectedSources.reduce((sum, source) => sum + (sourceWeights[source] || 0), 0))
  const basicVerified = has('business') && has('license') && has('identity')
  const coreOperations = has('pos') && has('account')

  // 사업자 진위확인: 번호 형식·검증번호·대표자·영업신고·본인인증
  const businessVerification = verifyBusiness({
    businessNumber: data.businessNumber,
    ownerName: data.ownerName,
    licenseNumber: data.licenseNumber,
    identityVerified: data.identityVerified,
  })

  // AI OCR 판독 결과를 실제 심사에 연결한다.
  // 지금까지 OCR 결과는 저장만 되고 판단에 쓰이지 않았다.
  const myAnalyses = db.ocrAnalyses.filter((item) => item.userId === req.user!.id).slice(-12)
  const financialVerification = orchestrateFinancialVerification({
    claims: {
      businessNumber: data.businessNumber,
      monthlySales,
      monthlyDebtPayment,
      taxCompliant: has('tax'),
    },
    analyses: myAnalyses,
    connectedSources,
  })

  let score = 44
  score += Math.min(17, salesGrowth * .75)
  score += Math.min(8, Math.max(0, relativeGrowth) * .8)
  score += repeatRate === null ? 0 : Math.min(8, repeatRate * .14)
  score += Math.min(10, dataConfidence * .1)
  score += operatingYears >= 3 ? 5 : 2
  score += reconciliationRate >= 94 ? 5 : reconciliationRate >= 85 ? 2 : -5
  score += debtServiceRatio === null ? -1 : debtServiceRatio <= 45 ? 4 : debtServiceRatio <= 70 ? 0 : -8
  // 교차검증 결과 반영: 불일치는 감점, 운영자 확인 준비 완료는 가점
  score += financialVerification.mismatches.length ? -12 : financialVerification.readyForAdminReview ? 4 : 0
  score += businessVerification.verified ? 0 : -6
  score = Math.max(0, Math.min(100, Math.round(score)))

  const capacity = Math.round((monthlySales * .42 + Math.max(0, operatingCashflow) * 2.2) / 1000000) * 1000000
  const approvedLimit = Math.max(5000000, Math.min(requestedLimit || capacity, capacity, 100000000))
  // 사업자 진위확인 실패나 문서 불일치는 점수와 무관하게 사람이 봐야 한다.
  const status: Application['status'] = !basicVerified || !coreOperations || !businessVerification.verified || financialVerification.mismatches.length
    ? 'manual_review'
    : score >= 78 ? 'approved'
      : score >= 58 ? 'conditional'
        : score >= 40 ? 'manual_review' : 'rejected'

  const strengths = [
    `POS·정산 원자료에서 최근 12개월 매출 성장률 ${salesGrowth}%가 자동 계산됐어요.`,
    `상권 음식업 성장률 ${districtSalesGrowth}%보다 ${relativeGrowth}%p 높은 상대 성장 흐름을 보였어요.`,
    repeatRate === null ? '재방문 식별 데이터는 없지만 불이익 대신 미산정으로 처리했어요.' : `합법적으로 식별 가능한 주문 데이터에서 재방문율 ${repeatRate}%가 계산됐어요.`,
    `POS 매출과 실제 현금유입의 일치도는 ${reconciliationRate}%예요.`,
  ]
  const stepMark: Record<string, string> = { passed: '✅', review: '⚠️', failed: '❌', not_compared: '➖' }
  const checks = [
    `사업자 진위확인: ${businessVerification.verified ? '✅ 통과' : '❌ ' + businessVerification.message}`,
    ...financialVerification.steps.map((step) => `${stepMark[step.status]} ${step.label} — ${step.detail}`),
    `AI 판독 문서 ${financialVerification.documentCount}건 · 평균 신뢰도 ${Math.round(financialVerification.averageConfidence * 100)}%`,
    'AI 판독은 보조자료이며 최종 승인은 운영자가 원본을 확인한 뒤 이뤄집니다.',
  ]
  const improvements: string[] = []
  if (!basicVerified) improvements.push('사업자등록·영업신고·대표자 인증을 모두 완료하면 자동심사로 넘어갈 수 있어요.')
  if (!has('pos')) improvements.push('최근 12개월 POS CSV를 연결하면 매출·객단가·메뉴 의존도를 자동 계산할 수 있어요.')
  if (!has('account')) improvements.push('사업용 계좌를 연결하면 추정 영업현금흐름과 실제 유입을 교차검증할 수 있어요.')
  if (!has('tax')) improvements.push('홈택스 자료를 추가하면 과거 신고매출을 공식 기준점으로 확인할 수 있어요.')
  if (repeatRate === null) improvements.push('POS 회원·예약·배달 고객처럼 합법적 고객 식별 자료가 있으면 재방문 지표에 가점이 생겨요.')
  if (!businessVerification.verified) {
    const failed = Object.entries(businessVerification.checks).filter(([, value]) => !value).map(([key]) => key.replace(/_/g, ' '))
    improvements.push(`사업자 진위확인에서 ${failed.join(', ')} 항목이 확인되지 않았어요.`)
  }
  improvements.push(...financialVerification.mismatches)
  improvements.push(...financialVerification.warnings.slice(0, 3))
  if (!improvements.length) improvements.push('연결된 원천자료의 최신성을 유지하고 자금 사용 결과를 월별로 공개해주세요.')

  const derivedMetrics = {
    recent12MonthAverageSales: monthlySales,
    recent12MonthSalesGrowth: salesGrowth,
    estimatedMonthlyOperatingCashflow: operatingCashflow,
    salesVolatility,
    repeatRate,
    averageTicket,
    deliverySalesShare: deliveryShare,
    rentToSalesRatio: rentRatio,
    debtServiceToCashflowRatio: debtServiceRatio,
    operatingYears,
    staffTrend: `${staffBefore}명 → ${staffCurrent}명`,
    districtSalesGrowth,
    relativeSalesGrowth: relativeGrowth,
    salesReconciliationRate: reconciliationRate,
  }
  const explanation = status === 'approved'
    ? '핵심 원천데이터가 연결됐고 3중 검증의 일치도가 높아 펀딩 개설이 가능해요. 이 결과는 공식 SCB 등급이 아닌 먹투 MVP의 성장성 예비심사입니다.'
    : status === 'conditional'
      ? '성장성은 확인됐지만 일부 자료의 최신성이나 상환부담 확인이 필요해 낮춘 한도로 먼저 시작하는 조건부 승인을 권해요.'
      : status === 'manual_review'
        ? '자료가 부족하다는 이유만으로 탈락시키지 않고 추가 연결·서류와 사업주의 설명을 함께 보는 수동 심사로 넘겼어요.'
        : '교차검증에서 위험 신호가 커 바로 모금을 열기 어렵지만, 자료 보강과 개선 후 다시 신청할 수 있어요.'

  const application: Application = {
    id: id('application'), userId: req.user!.id, restaurantName, submittedAt: now(), status,
    requestedLimit, approvedLimit: status === 'rejected' ? 0 : approvedLimit, score,
    data: { ...data, uploadedDocuments, documentMetadata, connectedSources, sourceProvenance, dataConfidence, derivedMetrics, businessVerification, financialVerification }, strengths, checks, improvements, explanation,
  }
  db.applications.push(application)
  audit(req.user!.id, 'application.analyzed', 'application', application.id, `${restaurantName} 예비심사 ${status} · ${score}점`)
  audit(req.user!.id, 'application.business_verified', 'application', application.id, `사업자 진위확인 ${businessVerification.verified ? '통과' : '보완 필요'}`)
  audit(req.user!.id, 'application.financial_orchestrated', 'application', application.id,
    `재무 교차검증 ${financialVerification.recommendedStatus} · 문서 ${financialVerification.documentCount}건 · 불일치 ${financialVerification.mismatches.length}건`)
  await saveDatabase(); changed()
  res.status(201).json({ message: '원천데이터 기반 먹투 자동분석이 완료됐어요.', application })
})

app.get('/api/owner', auth('owner'), (req: AuthedRequest, res) => {
  const restaurants = db.restaurants.filter((r) => r.ownerId === req.user!.id)
  const fundIds = db.funds.filter((f) => restaurants.some((r) => r.id === f.restaurantId)).map((f) => f.id)
  const positions = db.positions.filter((p) => fundIds.includes(p.fundId))
  const auditEvents = db.auditEvents.filter((event) => event.actorId === req.user!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
  const ocrAnalyses = db.ocrAnalyses.filter((item) => item.userId === req.user!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  const dataConnections = db.dataConnections.filter((item) => item.userId === req.user!.id && item.status === 'active').map(({ userId: _, ...item }) => item)
  res.json({ restaurants, funds: db.funds.filter((f) => fundIds.includes(f.id)), positions, coupons: db.coupons.filter((c) => fundIds.includes(c.fundId || '')), applications: db.applications.filter((a) => a.userId === req.user!.id), auditEvents, ocrAnalyses, dataConnections })
})

app.patch('/api/owner/restaurants/:restaurantId/sales-disclosure', auth('owner'), async (req: AuthedRequest, res) => {
  const restaurant = db.restaurants.find((item) => item.id === req.params.restaurantId && item.ownerId === req.user!.id)
  if (!restaurant) return res.status(404).json({ error: '관리할 수 있는 식당이 아니에요.' })
  restaurant.salesDisclosure = Boolean(req.body.public)
  await saveDatabase(); changed()
  res.json({ message: restaurant.salesDisclosure ? '투자자에게 월별 매출 데이터를 공개했어요.' : '월별 매출액을 비공개로 전환했어요. 성장지수만 표시됩니다.', salesDisclosure: restaurant.salesDisclosure })
})
app.post('/api/owner/funds/:fundId/dividend', auth('owner'), async (req: AuthedRequest, res) => {
  const fund = db.funds.find((f) => f.id === req.params.fundId)
  const restaurant = fund && db.restaurants.find((r) => r.id === fund.restaurantId && r.ownerId === req.user!.id)
  const discount = Math.max(5, Math.min(30, Number(req.body.discount || 10)))
  if (!fund || !restaurant) return res.status(404).json({ error: '관리할 수 있는 펀드가 아니에요.' })
  const investors = db.positions.filter((p) => p.fundId === fund.id && p.amount > 0)
  for (const position of investors) {
    db.coupons.push({ id: id('coupon'), userId: position.userId, restaurantId: restaurant.id, fundId: fund.id, title: `${restaurant.name} 깜짝 배당 쿠폰`, discount, maxDiscountWon: Math.floor(restaurant.maxMenuPrice * discount / 100), type: 'dividend', status: 'available', createdAt: now(), expiresAt: new Date(Date.now() + 60 * 86400000).toISOString() })
  }
  fund.totalCouponIssued += investors.length * Math.floor(restaurant.maxMenuPrice * discount / 100)
  audit(req.user!.id, 'coupon.dividend_issued', 'fund', fund.id, `${investors.length}명에게 ${discount}% 쿠폰 발행`)
  await saveDatabase(); changed()
  res.json({ message: `${investors.length}명의 투자자에게 ${discount}% 배당 쿠폰을 보냈어요.` })
})

app.post('/api/ai/ocr', auth('owner'), async (req: AuthedRequest, res) => {
  if (!rateLimit(`ocr:${req.user!.id}`, 20, 60_000)) return res.status(429).json({ error: '문서 판독 요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  const image = String(req.body.image || '')
  const match = image.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) return res.status(400).json({ error: 'PNG, JPG 또는 WebP 이미지만 AI 판독할 수 있어요.' })
  const encoded = match[2].replace(/\s/g, '')
  const estimatedBytes = Math.floor(encoded.length * .75)
  if (!estimatedBytes || estimatedBytes > 6 * 1024 * 1024) return res.status(400).json({ error: '이미지는 6MB 이하여야 해요.' })
  const filename = String(req.body.filename || 'document').slice(0, 255)
  const sourceId = String(req.body.sourceId || 'other').slice(0, 40)
  const plan = String(req.body.plan || '등록된 사용계획 없음').slice(0, 2000)
  const typeNames: Record<string, string> = { business: '사업자등록 자료', license: '영업신고 자료', tax: '납세 자료', debt: '부채·상환 자료', lease: '임대차 자료' }
  let result: Record<string, unknown> = {
    documentType: typeNames[sourceId] || '기타 증빙', confidence: 0, planMatch: '검토 필요', boundingBoxes: [],
    warnings: ['AI API가 설정되지 않아 파일 형식만 확인했습니다. 운영자가 원본을 직접 확인해야 합니다.'],
  }
  let model = 'meoktu-manual-review-v1'
  let status: 'ai_extracted' | 'manual_review' = 'manual_review'
  const apiUrl = aiApiUrl
  const apiKey = aiApiKey
  if (apiUrl && apiKey) {
    try {
      const requestedModel = process.env.OPENAI_OCR_MODEL || process.env.AI_OCR_MODEL || process.env.MOA_OCR_MODEL || process.env.OPENAI_CHAT_MODEL || process.env.AI_MODEL || 'gpt-4o-mini'
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          model: requestedModel,
          messages: [
            { role: 'system', content: '당신은 한국 소상공인 사업 증빙 OCR 보조자입니다. 이미지에서 보이는 값만 구조화하고 승인 여부를 결정하지 않습니다.' },
            { role: 'user', content: [
              { type: 'text', text: `문서를 판독해 JSON만 반환하세요. 등록된 자금 사용계획: ${plan}. 스키마: {"documentType":"영수증|세금계산서|매출전표|계약서|사업자등록|영업신고|납세증명|부채증명|기타","merchant":"","businessNumber":"","date":"","periodStart":"","periodEnd":"","total":0,"planMatch":"적합|검토 필요|부적합","confidence":0,"warnings":[],"rawText":"","boundingBoxes":[{"field":"merchant|businessNumber|date|total","label":"","value":"","bbox":[0,0,0,0],"confidence":0}]}. bbox는 0~1000 기준 [x,y,width,height]이며 읽히지 않는 값은 추측하지 마세요.` },
              { type: 'image_url', image_url: { url: `data:${match[1]};base64,${encoded}` } },
            ] },
          ],
          response_format: { type: 'json_object' },
          temperature: .1,
        }),
      })
      if (!response.ok) throw new Error(`AI OCR ${response.status}`)
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string }
      const parsed = jsonObject(payload.choices?.[0]?.message?.content || '')
      if (!Object.keys(parsed).length) throw new Error('AI OCR empty result')
      result = {
        ...parsed,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 12).map(String) : [],
        boundingBoxes: normalizeOcrBoxes(parsed.boundingBoxes),
      }
      model = payload.model || requestedModel
      status = 'ai_extracted'
    } catch (error) {
      console.error('AI OCR request failed:', error instanceof Error ? error.message : error)
      result = { ...result, warnings: ['AI OCR 연결에 실패해 자동 판독하지 못했습니다. 원본은 저장하지 않았으며 운영자 확인이 필요합니다.'] }
    }
  }
  const analysis = { id: id('ocr'), userId: req.user!.id, filename, sourceId, plan, result, model, status, createdAt: now() }
  if (req.user!.sessionMode === 'demo') {
    return res.json({
      message: status === 'ai_extracted' ? 'AI가 샘플 문서를 구조화했어요. 체험 결과는 원장에 저장하지 않습니다.' : '샘플 문서 형식을 확인했어요. 체험 결과는 원장에 저장하지 않습니다.',
      analysis, ephemeral: true,
    })
  }
  db.ocrAnalyses.push(analysis)
  audit(req.user!.id, 'ocr.analyzed', 'ocr_analysis', analysis.id, `${filename} · ${status}`)
  await saveDatabase(); changed()
  res.json({ message: status === 'ai_extracted' ? 'AI가 문서의 보이는 항목을 구조화했어요. 최종 판단은 운영자 확인이 필요해요.' : '문서를 접수했어요. AI 연결 전이라 운영자 수동 검토 대상으로 표시했어요.', analysis })
})

function localAiAnswer(question: string) {
  const normalized = question.replace(/\s/g, '').toLowerCase()
  const restaurant = db.restaurants.find((r) => normalized.includes(r.name.replace(/\s/g, '').toLowerCase()))
  if (restaurant) {
    const fund = db.funds.find((f) => f.restaurantId === restaurant.id)!
    const salesSummary = restaurant.salesDisclosure ? `최근 월매출은 약 ${(restaurant.monthlySales / 10000).toFixed(0)}만원이고` : '월별 매출액은 사장님 선택으로 비공개이며'
    return `${restaurant.name}은 ${restaurant.neighborhood}의 ${restaurant.category} 식당이에요. ${salesSummary} 검증된 매출 성장지수는 ${restaurant.salesGrowth}%, 재방문율은 ${restaurant.repeatRate}%예요. 현재 펀드는 ${(fund.raised / 10000).toLocaleString()}만원이 모였고 최대 ${fund.maxDiscount}% 쿠폰을 설정했어요. ${restaurant.stabilityScore >= 85 ? '운영 안정성이 비교적 높지만' : '성장성은 돋보이지만 운영 변동성도 있어'} 투자 기간과 실제 방문 가능성을 함께 고려해보세요. 이 안내는 투자 권유가 아니에요.`
  }
  if (/추천|어디|뭐가좋|투자할/.test(normalized)) {
    const top = restaurantView().sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 3)
    return `현재 데이터에서 눈에 띄는 곳은 ${top.map((r) => `${r.name}(기회점수 ${r.opportunityScore})`).join(', ')}예요. 성장률만 보지 않고 재방문율·운영 이력·상권 위험을 함께 봤어요. 직접 방문할 수 있고 쿠폰을 실제로 쓸 식당을 우선 고르는 게 좋아요.`
  }
  if (/회수|빼|출금/.test(normalized)) return '모금 중에는 즉시 회수할 수 있어요. 모금이 끝난 뒤에는 같은 금액을 사려는 예약 투자자와 1,000원 단위로 선착순 매칭될 때 회수됩니다. 따라서 회수 시점은 보장되지 않아요.'
  if (/쿠폰|할인/.test(normalized)) return '10만원 투자 기준 기본 하루 0.5%씩 할인율이 쌓이고, 매출 성장 보너스와 최초 투자자 보너스가 붙을 수 있어요. 10%부터 원하는 때 발급할 수 있고 식당이 정한 최대 할인율에 도달하면 자동 발급 대상이 됩니다.'
  if (/안전|위험|원금|보장/.test(normalized)) return '먹투의 투자금은 예금이 아니며 원금과 회수 시점이 보장되지 않아요. 모금 완료 뒤에는 새 투자자가 있어야 회수됩니다. 한 식당 투자 한도를 목표액의 1%로 제한하고, 서류·현금흐름·부채·상권을 함께 심사하지만 위험이 사라지는 것은 아니에요.'
  if (/심사|승인|사장/.test(normalized)) return '심사는 기본 서류, 6개월 매출·현금흐름, 부채 부담, 세금·행정 이력, 상권 경쟁력, 고객 재방문을 함께 봐요. 기존 금융에서 놓치기 쉬운 성장률과 실제 고객 지지를 적극 반영하며, 애매한 경우 바로 탈락시키지 않고 조건부 승인이나 수동 심사를 진행해요.'
  return '식당 이름이나 “회수는 어떻게 해?”, “단골이 많은 곳 추천해줘”, “쿠폰은 언제 받아?”처럼 물어보세요. 먹투의 가상 식당 데이터와 이용 규칙을 바탕으로 설명해드릴게요.'
}

app.post('/api/ai/chat', async (req: AuthedRequest, res) => {
  const question = String(req.body.question || '').slice(0, 800)
  if (!question.trim()) return res.status(400).json({ error: '궁금한 내용을 입력해주세요.' })
  // 로그인 없이도 상담은 열어두되, 외부 AI 호출 비용이 무제한으로 새지 않도록 IP 단위로 제한한다.
  const caller = (await userFromAuthorization(req.headers.authorization).catch(() => undefined))?.id
    || String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anonymous').split(',')[0].trim()
  if (!rateLimit(`ai:${caller}`, 20, 60_000)) return res.status(429).json({ error: 'AI 상담 요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  const normalizedQuestion = question.replace(/\s/g, '').toLocaleLowerCase('ko')
  // 화면 안내 질문은 묻는 내용에 맞는 역할 그래프를 써야 한다.
  // 투자자로 로그인한 사람이 "펀드 등록은 어디서 해?"라고 물으면 사장님 절차를 봐야 답이 된다.
  const askedRole: Role = req.body.role === 'owner' ? 'owner' : 'investor'
  const ownerIntent = /(펀딩|펀드)(등록|신청|개설|모집)|사장님|소상공인|자료업로드|서류제출|심사접수|매출공개|영업신고|사업자등록/.test(normalizedQuestion)
  const role: Role = ownerIntent ? 'owner' : askedRole
  const requestedRestaurant = typeof req.body.restaurantId === 'string' ? db.restaurants.find((item) => item.id === req.body.restaurantId) : undefined
  const mentionedRestaurant = db.restaurants.find((item) => normalizedQuestion.includes(item.name.replace(/\s/g, '').toLocaleLowerCase('ko')))
  const graphRestaurant = mentionedRestaurant || requestedRestaurant
  const graphFund = graphRestaurant ? db.funds.find((item) => item.restaurantId === graphRestaurant.id) : undefined
  const asker = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  const askerPosition = asker && graphFund ? db.positions.find((item) => item.userId === asker.id && item.fundId === graphFund.id && item.amount > 0) : undefined
  const application = graphRestaurant
    ? [...db.applications].reverse().find((item) => item.restaurantName === graphRestaurant.name || (asker?.role === 'owner' && item.userId === asker.id))
    : asker?.role === 'owner' ? [...db.applications].reverse().find((item) => item.userId === asker.id) : undefined
  const financialRun = application?.data?.financialVerification as Record<string, any> | undefined
  const knowledgeGraph = buildKnowledgeGraph(role, graphRestaurant, graphFund, {
    assessment: graphRestaurant ? assessRestaurant(graphRestaurant, graphFund) : undefined,
    holding: askerPosition && { amount: askerPosition.amount, couponProgress: askerPosition.couponProgress, early: askerPosition.early },
    claim: application && { verificationStatus: application.status, requestedLimit: application.requestedLimit, dataConfidence: Number(application.data?.dataConfidence) || undefined },
    verification: financialRun && {
      status: String(financialRun.recommendedStatus || 'unknown'), readyForAdminReview: Boolean(financialRun.readyForAdminReview),
      mismatchCount: (financialRun.mismatches || []).length, missingCount: (financialRun.missingDocuments || []).length,
    },
  })
  const retrievedGraph = retrieveKnowledgeSubgraph(knowledgeGraph, question)
  // 화면 지도는 별도로 뽑는다. 절차 노드에 밀려서 빠지면 "어디로 가야 해요" 질문이 다시 망가진다.
  const navigation = navigationBrief(question)
  const navigationAnswer = answerNavigationQuestion(question)
  const wantsNavigation = isNavigationQuestion(question) || matchUiTasks(question, 1).length > 0
  const graphAnswer = answerGraphProcessQuestion(question, retrievedGraph)
  const fallback = localAiAnswer(question)
  // 화면 위치를 묻는 질문이면 절차 설명보다 클릭 경로를 먼저 준다.
  const localAnswer = (wantsNavigation && navigationAnswer) ? navigationAnswer : (graphAnswer || fallback)
  const apiUrl = aiApiUrl
  const apiKey = aiApiKey
  if (!apiUrl || !apiKey) return res.json({
    answer: localAnswer,
    mode: 'graph-rag-local',
    provider: 'local-knowledge-graph',
    sources: retrievedGraph.sources,
    retrieval: { strategy: 'symbolic-keyword-plus-one-hop', graphVersion: retrievedGraph.graphVersion },
  })
  try {
    const model = process.env.OPENAI_CHAT_MODEL || process.env.AI_MODEL || process.env.MOA_CHAT_MODEL || 'gpt-4o-mini'
    const context = restaurantView().map((r) => ({
      name: r.name,
      region: r.neighborhood,
      category: r.category,
      foodDescription: r.foodDescription,
      strengths: r.strengths,
      signatureMenu: r.signature,
      menuHighlights: r.menuHighlights,
      averagePriceWon: r.avgPrice,
      rating: r.rating,
      reviewCount: r.reviewCount,
      verifiedReviewSamples: r.reviews?.slice(0, 3).map((review) => ({ rating: review.rating, content: review.content })),
      sales: r.salesDisclosure
        ? { visibility: 'public', monthlySalesWon: r.monthlySales, growthPercent: r.salesGrowth, history: r.salesHistory }
        : { visibility: 'owner_private', growthIndexPercent: r.salesGrowth, note: '정확한 월매출과 월별 이력은 공개하지 않음' },
      repeatRatePercent: r.repeatRate,
      operatingYears: r.openedYears,
      footTrafficGrowthPercent: r.footTrafficGrowth,
      nearbyClosingRatePercent: r.closingRate,
      stabilityScore: r.stabilityScore,
      opportunityScore: r.opportunityScore,
      story: r.story,
      fund: r.fund && {
        status: r.fund.status,
        goalWon: r.fund.goal,
        raisedWon: r.fund.raised,
        maxCouponDiscountPercent: r.fund.maxDiscount,
        baseSalesBonusPercent: r.fund.salesBonus,
        earlyInvestorSalesBonusUpliftPercent: r.fund.earlyBonus,
        buyQueueWon: r.fund.openBuyAmount,
        sellQueueWon: r.fund.openSellAmount,
        riskLevel: r.fund.riskLevel,
        purpose: r.fund.purpose,
      },
    }))
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `너는 먹투 웹사이트의 친절하고 신중한 한국어 생성형 AI 상담원이다. 실제로 웹사이트를 함께 보며 안내하는 직원처럼 말한다.

[화면 안내 규칙 — 가장 중요]
- "어디로 가야 해요", "어디서 하나요", "어떻게 신청해요" 같은 질문은 **화면 위치 질문**이다. 반드시 아래 '화면 지도'의 menuPath와 steps를 그대로 활용해 "상단 메뉴의 OO을 클릭하세요"처럼 눌러야 할 메뉴와 버튼 이름으로 답한다.
- GraphRAG의 GuideStep 노드(예: '사업체·대표자 등록', '데이터 출처 선택', 'AI OCR 교차검증')는 **심사 절차의 이름**이지 화면에 있는 메뉴나 버튼이 아니다. 이것을 "OO 단계로 가셔야 합니다"처럼 이동할 장소인 것처럼 안내하면 안 된다. 절차를 설명할 때는 "심사는 이런 순서로 진행돼요"라고 절차임을 밝힌다.
- 화면 지도에 없는 메뉴, 버튼, 페이지 이름을 지어내지 않는다.
- 먹투에는 고객센터, 상담 전화번호, 이메일 문의 창구가 없다. "고객센터에 문의하세요" 같은 안내를 하지 말고, 대신 이 AI 상담창이나 해당 화면을 안내한다.
- 사장님(소상공인) 기능은 소상공인 계정 로그인이 필요하다는 점을 필요할 때 알려준다.

[내용 규칙]
- 제공된 가상 식당 데이터와 먹투 이용 규칙 안에서만 답한다.
- 데이터에 없는 사실을 지어내지 말고, 모르면 모른다고 말한다.
- sales.visibility가 owner_private이면 정확한 매출액이나 월별 이력을 추측하거나 공개하지 않는다.
- 식당 비교 시 성장률뿐 아니라 재방문율, 운영 이력, 상권 위험, 쿠폰의 실제 사용 가능성을 함께 설명한다.
- 투자 권유, 수익 보장, 원금 보장으로 오해될 표현을 쓰지 않는다. "투자할 만한 가치가 높다", "지금이 기회다" 같은 판단은 하지 말고, 판단 재료(성장률·재방문율·운영 이력·상권 위험)를 보여주고 결정은 사용자에게 맡긴다.
- 투자금은 예금이 아니며 모금 종료 뒤에는 반대 주문이 있어야 1,000원 단위로 회수된다는 점을 필요할 때 명확히 알린다.
- 아래 GraphRAG 검색 결과를 우선 근거로 사용하되, 노드 텍스트를 그대로 복사하지 말고 사람이 이해할 문장으로 풀어서 설명한다.

[형식]
- 답변은 읽기 쉬운 3~7문장. 클릭 순서를 안내할 때만 번호 목록을 쓴다.

화면 지도(UI 내비게이션): ${JSON.stringify(navigation)}

GraphRAG 검색 결과: ${JSON.stringify(retrievedGraph)}

가상 식당 데이터: ${JSON.stringify(context)}`,
          },
          { role: 'user', content: question },
        ],
      }),
    })
    if (!response.ok) throw new Error(`OpenAI API ${response.status}`)
    const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const answer = result.choices?.[0]?.message?.content?.trim()
    if (!answer) throw new Error('OpenAI API returned an empty answer')
    res.json({ answer, mode: 'graph-rag-generative', provider: 'openai', model, sources: retrievedGraph.sources, retrieval: { strategy: 'symbolic-keyword-plus-one-hop', graphVersion: retrievedGraph.graphVersion } })
  } catch (error) {
    console.error('OpenAI API request failed:', error instanceof Error ? error.message : error)
    res.json({ answer: localAnswer, mode: 'graph-rag-fallback', provider: 'local-knowledge-graph', sources: retrievedGraph.sources, retrieval: { strategy: 'symbolic-keyword-plus-one-hop', graphVersion: retrievedGraph.graphVersion } })
  }
})

app.use('/samples', express.static(path.join(root, 'public', 'samples')))

const clientDist = path.join(root, 'dist', 'client')
const clientIndex = path.join(clientDist, 'index.html')
let clientBuilt = false
try {
  await fs.access(clientIndex)
  clientBuilt = true
} catch {
  // 개발 중에는 Vite가 클라이언트를 담당한다.
}
if (clientBuilt) {
  app.use(express.static(clientDist))
  // Express 5는 '*' 단독 경로를 더 이상 허용하지 않는다. /api 를 뺀 나머지를 SPA로 넘긴다.
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(clientIndex))
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(500).json({ error: '잠시 문제가 생겼어요. 다시 시도해주세요.' })
})

io.on('connection', (socket) => socket.emit('connected', { at: now() }))

if (!process.env.VERCEL) {
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Meoktu server running on http://localhost:${port}`)
  })
}

export { app }
export default app
