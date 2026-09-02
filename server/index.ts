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
import type { Application, Coupon, CouponListing, CouponOffer, CouponTrade, DataConnection, Database, Fund, FundStatus, Notification, Order, Position, Review, Role, SupportRequest, User } from './types.ts'
import { answerGraphProcessQuestion, assessRestaurant, buildKnowledgeGraph, normalizeOcrBoxes, retrieveKnowledgeSubgraph } from './trust.ts'
import { answerNavigationQuestion, isNavigationQuestion, matchUiTasks, navigationBrief, pageForRoute } from './sitemap.ts'
import { deriveMetricsFromUploads, type RawUpload } from './metrics.ts'
import {
  assessCredit, combineAssessments, creditModelVersion, creditReferences, deriveCreditInput,
  featureSpecs, industries, industryProfiles, toIndustry, type CreditAssessment,
} from './credit.ts'
import { DEMO_NOTICE, demoId, demoNotification, sandboxFor, type DemoSandbox } from './demo.ts'
import {
  answerOwnerStatusQuestion, answerSupportQuestion, defaultSupportPrograms, isOwnerStatusQuestion, isSupportQuestion,
  knowledgeAsOf, matchSupportPrograms, ownerSituation, ownerSituationGraph, supportProgramNodes,
} from './knowledge.ts'
import { COMMERCIAL_NOTE, COMMERCIAL_SOURCE, commercialInsight, findCommercialArea } from './commercial.ts'
import { orchestrateFinancialVerification, verifyBusiness } from './verification.ts'
import { checkSwap, couponUsable, daysLeft, EXCHANGE_RULES, normalizePreferences, sweepExpired } from './exchange.ts'
import { FileStateStore, SupabaseStateStore, TableStateStore, type StateStore } from './store.ts'

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
// MEOKTU_DATA_DIR 을 주면 개발 서버의 원장을 건드리지 않고 별도 원장으로 띄울 수 있다.
// (통합 테스트가 실제 data/db.json 의 쿠폰 매물을 소진시키는 문제를 막는다.)
const dataDir = process.env.MEOKTU_DATA_DIR
  ? path.resolve(root, process.env.MEOKTU_DATA_DIR)
  : process.env.VERCEL ? path.join('/tmp', 'meoktu') : path.join(root, 'data')
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
// STATE_STORE=tables 는 meoktu 스키마의 정규화 테이블 24개에 저장한다(운영 목표 구조).
// STATE_STORE=supabase 는 app_state.data JSONB 한 칸에 저장한다(이전 구조, 호환용).
if ((stateStoreMode === 'supabase' || stateStoreMode === 'tables') && (!supabaseUrl || !supabaseServiceKey)) {
  const missing = [
    !supabaseUrl && 'SUPABASE_URL (or VITE_SUPABASE_URL)',
    !supabaseServiceKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean).join(', ')
  throw new Error(`STATE_STORE=${stateStoreMode} requires ${missing}`)
}
const useSharedState = stateStoreMode === 'supabase' || stateStoreMode === 'tables'
  || (stateStoreMode !== 'file' && Boolean(supabaseUrl && supabaseServiceKey) && Boolean(process.env.VERCEL))
// 정규화 테이블은 반드시 STATE_STORE=tables 로 명시해야 켜진다.
// 미지정이면 예전대로 app_state 를 쓴다. 이미 떠 있는 배포가 meoktu 스키마를
// 적용하기 전에 자동으로 갈아타면 기동 자체가 실패하기 때문이다(npm run db:migrate 선행 필요).
const store: StateStore = useSharedState && supabaseUrl && supabaseServiceKey
  ? (stateStoreMode === 'tables'
      ? new TableStateStore(supabaseUrl, supabaseServiceKey)
      : new SupabaseStateStore(supabaseUrl, supabaseServiceKey, process.env.STATE_ROW_ID || 'meoktu'))
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
  // 체험 세션마다 다른 id를 준다. 그래야 각자의 체험 원장이 섞이지 않는다.
  const sub = `demo-${role}-${crypto.randomBytes(6).toString('hex')}`
  const payload = Buffer.from(JSON.stringify({ sub, role, mode: 'demo', exp: Date.now() + 1000 * 60 * 60 * 4 })).toString('base64url')
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
  current.supportRequests ??= []

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
  for (const offer of template.couponOffers) if (!current.couponOffers.some((item) => item.id === offer.id)) current.couponOffers.push(offer)
  for (const listing of current.couponListings) migrateListing(listing)
  for (const review of seedReviews) if (!current.reviews.some((item) => item.id === review.id)) current.reviews.push(review)
  current.articles = seedArticles
  current.etfs = template.etfs
  current.schemaVersion = 5
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
  db.supportRequests ??= []
  const sharedDemoHash = db.users.find((user) => user.id === 'u-owner')?.passwordHash
    || db.users.find((user) => user.id === 'u-investor')?.passwordHash
  if (sharedDemoHash && !db.users.some((user) => user.id === 'u-admin' || user.email === 'admin@meoktu.demo')) {
    db.users.unshift({
      id: 'u-admin', email: 'admin@meoktu.demo', name: '먹투 운영팀', role: 'admin',
      passwordHash: sharedDemoHash, cash: 0, accountStatus: 'active', createdAt: now(),
    })
  }
  for (const user of db.users) user.accountStatus ??= 'active'
}

async function loadDatabase() {
  if (store instanceof FileStateStore) await fs.mkdir(dataDir, { recursive: true })
  const snapshot = await store.read()
  if (snapshot) {
    db = snapshot.data
    stateVersion = snapshot.version
    if ((db.schemaVersion || 0) < 5) {
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
    if (store instanceof SupabaseStateStore || store instanceof TableStateStore) {
      // 첫 기동에서만 심는다. 다른 인스턴스가 이미 심었으면 그쪽 값을 그대로 쓴다.
      const seeded = await store.seed(db)
      if (seeded) { db = seeded.data; stateVersion = seeded.version }
    } else {
      stateVersion = await store.write(db, stateVersion) ?? 0
    }
  }
  normalizeDatabase()
  console.log(`원장 저장소: ${store.kind}${store.kind === 'file' ? '' : ` (version ${stateVersion})`}`)
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

/**
 * 거래를 Postgres 트랜잭션으로 실행한다.
 *
 * 정규화 테이블 모드에서만 쓴다. RPC 가 테이블을 직접 바꾸므로
 * 호출 뒤에는 메모리 원장이 낡은 상태다. 반드시 다시 읽어야 하고,
 * 이 경로에서는 saveDatabase() 를 부르면 안 된다.
 * 낡은 메모리를 통째로 다시 써서 RPC 가 바꾼 내용을 지워버리기 때문이다.
 */
const ledgerRpcEnabled = store.kind === 'tables'

async function runLedgerRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const result = await (store as TableStateStore).callRpc<T>(fn, args)
  // 버전 비교를 건너뛰고 무조건 다시 읽는다. RPC 직후에는 반드시 달라져 있다.
  const snapshot = await store.read()
  if (snapshot) {
    db = snapshot.data
    stateVersion = snapshot.version
    normalizeDatabase()
  }
  return result
}

/** RPC 가 raise exception 으로 돌려준 사장님용 문구만 꺼낸다. */
function rpcMessage(error: unknown) {
  const raw = (error as Error).message || ''
  const match = raw.match(/"message":"([^"]+)"/) || raw.match(/ERROR:\s*[0-9A-Z]*:?\s*(.+)/)
  const text = (match?.[1] || raw).replace(/\\n[\s\S]*$/, '').trim()
  return text || '요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.'
}

/** 공유 원장에서 최신 상태를 따라잡는다. 버전만 먼저 확인해 불필요한 전체 조회를 줄인다. */
async function refreshState(force = false) {
  if (store.kind === 'file') return
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
  // 감사기록은 오래된 것부터 지우지 않는다. 투자·쿠폰 교환 분쟁이 생겼을 때
  // 무슨 일이 있었는지 말해줄 수 있는 유일한 근거이고, 그게 사라지면 되돌릴 방법이 없다.
  // (알림은 근거가 아니므로 링버퍼를 유지한다.)
  db.auditEvents.push({ id: id('audit'), actorId, action, resourceType, resourceId, summary: summary.slice(0, 300), createdAt: now() })
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
/** 요청자 식별용. 프록시 뒤에서도 원 IP를 본다. */
function callerIp(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }) {
  const forwarded = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'anonymous')
  return forwarded.split(',')[0].trim() || 'anonymous'
}

/** 남은 여유가 있는지만 본다(기록하지 않는다). 실패한 시도만 세고 싶을 때 쓴다. */
function rateLimitPeek(key: string, limit: number, windowMs: number) {
  const at = Date.now()
  const hits = (rateBuckets.get(key) || []).filter((time) => time > at - windowMs)
  rateBuckets.set(key, hits)
  return hits.length < limit
}

/** 실패 한 번을 기록한다. */
function rateLimitHit(key: string) {
  const hits = rateBuckets.get(key) || []
  hits.push(Date.now())
  rateBuckets.set(key, hits)
}

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

/**
 * 쿠폰 장부의 단일 출처는 db.coupons다.
 * 펀드에 누적 발급·사용액을 따로 더해두면 실제 쿠폰 레코드와 조금씩 어긋나서
 * 사장님 화면의 "발급 − 사용"과 "아직 사용되지 않은 부담"이 서로 맞지 않게 된다.
 * 그래서 집계는 저장하지 않고 쿠폰 레코드에서 매번 다시 만든다.
 */
function syncCouponLedger(fundId?: string) {
  for (const fund of db.funds) {
    if (fundId && fund.id !== fundId) continue
    const issued = db.coupons.filter((coupon) => coupon.fundId === fund.id)
    fund.totalCouponIssued = issued.reduce((sum, coupon) => sum + coupon.maxDiscountWon, 0)
    fund.totalCouponUsed = issued.filter((coupon) => coupon.status === 'used').reduce((sum, coupon) => sum + coupon.maxDiscountWon, 0)
  }
}

function issueCoupon(position: Position) {
  accrue(position)
  const fund = db.funds.find((item) => item.id === position.fundId)
  const restaurant = fund && db.restaurants.find((item) => item.id === fund.restaurantId)
  if (!fund || !restaurant) return undefined
  // 발급 기준에 못 미치면 아무 일도 일어나지 않는다. 예전에는 여기서 진행률을 0으로
  // 지웠는데, 그러면 쿠폰도 못 받고 그동안 쌓인 혜택만 사라졌다.
  if (position.couponProgress < fund.minIssueDiscount) return undefined
  const discount = Math.min(fund.maxDiscount, Math.floor(position.couponProgress * 10) / 10)
  const coupon: Coupon = {
    id: id('coupon'), userId: position.userId, restaurantId: restaurant.id, fundId: fund.id,
    title: `${restaurant.name} ${discount}% 응원 쿠폰`, discount,
    maxDiscountWon: Math.floor(restaurant.maxMenuPrice * discount / 100), type: 'fund', status: 'available',
    createdAt: now(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString(),
  }
  db.coupons.push(coupon)
  syncCouponLedger(fund.id)
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
  const fund = db.funds.find((item) => item.id === fundId)
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
    const buyerWasNew = buyerPosition.amount === 0
    buyerPosition.amount += matched
    sellerPosition.amount -= matched
    // 투자자 수는 들어올 때만 늘고 나갈 때는 줄지 않아서 시간이 갈수록 부풀었다.
    if (fund) {
      if (buyerWasNew) fund.investorCount += 1
      if (sellerPosition.amount <= 0) fund.investorCount = Math.max(0, fund.investorCount - 1)
    }
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
    // 정지는 로그인 시점이 아니라 요청마다 확인해야 한다. 토큰 유효기간이 14일이라
    // 로그인 때만 보면 관리자가 정지시킨 계정이 2주 동안 계속 거래할 수 있다.
    if (user.accountStatus === 'suspended') return res.status(403).json({ error: '이용이 일시 정지된 계정이에요. 운영팀에 문의해주세요.' })
    if (requiredRole && user.role !== requiredRole) return res.status(403).json({ error: '이 계정에서는 사용할 수 없는 기능이에요.' })
    req.user = user
    next()
  }
}

function restaurantView() {
  return db.restaurants.map((restaurant) => {
    const fund = db.funds.find((item) => item.restaurantId === restaurant.id)
    const opportunityScore = Math.round(restaurant.salesGrowth * 1.1 + restaurant.repeatRate * 0.32 + restaurant.communityScore * 0.22 + restaurant.stabilityScore * 0.2 - restaurant.closingRate * 0.35)
    const reviews = db.reviews.filter((review) => review.restaurantId === restaurant.id && review.status !== 'hidden').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
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
syncCouponLedger()
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
  if (store.kind === 'file') return next()
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

/* ── 체험 모드 ─────────────────────────────────────────────────
 * 체험 세션의 쓰기는 공유 원장(db.json) 대신 메모리 샌드박스로 보낸다.
 * 규칙은 그대로다: 다른 사람이 보는 데이터는 절대 바뀌지 않는다.
 * 달라진 건 체험자가 "막혔습니다" 대신 실제 결과를 본다는 점이다.
 */

/** 체험 기관 연결에 쓰는 가상 제휴사. 실제 기관 API를 부르지 않는다. */
const DEMO_PARTNER_PROVIDERS: Record<string, { title: string; provider: string; scope: string; records: number }> = {
  pos: { title: 'POS 매출', provider: 'POS 제휴 중계(체험)', scope: '최근 12개월 주문·결제·취소 집계', records: 18420 },
  account: { title: '사업용 계좌', provider: '금융 마이데이터 중계(체험)', scope: '최근 12개월 입출금과 잔액', records: 3260 },
  card: { title: '카드·VAN 정산', provider: '카드 정산 제휴(체험)', scope: '승인·취소·수수료·실입금', records: 9840 },
  delivery: { title: '배달 플랫폼', provider: '배달 플랫폼 제휴(체험)', scope: '주문·수수료·재주문 집계', records: 5120 },
  tax: { title: '세무 신고자료', provider: '세무자료 전송 어댑터(체험)', scope: '최근 2개 과세기간 신고매출', records: 8 },
  debt: { title: '대출·상환정보', provider: '금융기관 대출정보 중계(체험)', scope: '잔액·금리·만기·월 상환액', records: 24 },
}

const demoRestaurantOf = (restaurantId?: string) => db.restaurants.find((item) => item.id === restaurantId)

/** 체험 원장 기준의 투자 잔액. 없으면 만든다. */
function demoPosition(sandbox: DemoSandbox, fundId: string) {
  let position = sandbox.positions.find((item) => item.fundId === fundId)
  if (!position) {
    position = { id: demoId('position'), userId: sandbox.id, fundId, amount: 0, early: true, couponProgress: 0, updatedAt: now() }
    sandbox.positions.push(position)
  }
  return position
}

/**
 * 체험 세션의 쓰기 요청을 샌드박스에서 처리한다.
 * false를 돌려주면 "실제 라우터에 넘겨라"는 뜻이다.
 */
async function handleDemoMutation(req: AuthedRequest, res: Response, user: SessionUser): Promise<boolean | void> {
  const sandbox = sandboxFor(user.id, user.role)
  const pathname = req.originalUrl.split('?')[0]
  const body = (req.body || {}) as Record<string, any>
  const method = req.method
  const done = (payload: Record<string, unknown>) => { res.json({ ...payload, ephemeral: true, demoNotice: DEMO_NOTICE }) }
  const match = (pattern: RegExp) => pattern.exec(pathname)

  /* 지갑 충전 */
  if (method === 'POST' && pathname === '/api/wallet/topup') {
    const amount = round1000(body.amount)
    if (amount < 1000 || amount > 5_000_000) { res.status(400).json({ error: '체험 충전은 1,000원부터 500만원까지 가능해요.' }); return }
    sandbox.cash += amount
    sandbox.walletTransactions.unshift({ id: demoId('wallet'), userId: sandbox.id, type: 'demo_topup', amount, createdAt: now() })
    return done({ message: `${amount.toLocaleString()} 먹투머니를 체험용으로 충전했어요.`, balance: sandbox.cash })
  }

  /* 관심 식당 */
  const favorite = match(/^\/api\/favorites\/([^/]+)$/)
  if (favorite && (method === 'PUT' || method === 'DELETE')) {
    const restaurant = demoRestaurantOf(favorite[1])
    if (!restaurant) { res.status(404).json({ error: '식당을 찾을 수 없어요.' }); return }
    if (method === 'PUT') {
      if (!sandbox.favorites.includes(restaurant.id)) sandbox.favorites.push(restaurant.id)
    } else {
      sandbox.favorites = sandbox.favorites.filter((item) => item !== restaurant.id)
    }
    return done({
      message: method === 'PUT' ? `${restaurant.name}을 관심 식당에 저장했어요.` : '관심 식당에서 해제했어요.',
      favoriteRestaurantIds: sandbox.favorites,
    })
  }

  /* 투자 / 회수 */
  const fundAction = match(/^\/api\/funds\/([^/]+)\/(invest|withdraw)$/)
  if (fundAction && method === 'POST') {
    const fund = db.funds.find((item) => item.id === fundAction[1])
    if (!fund) { res.status(404).json({ error: '펀드를 찾을 수 없어요.' }); return }
    const restaurant = demoRestaurantOf(fund.restaurantId)
    const amount = round1000(body.amount)
    if (amount < 1000) { res.status(400).json({ error: '1,000원 단위로 입력해주세요.' }); return }
    const position = demoPosition(sandbox, fund.id)
    if (fundAction[2] === 'invest') {
      const limit = Math.floor(fund.goal * .01 / 1000) * 1000
      if (amount > sandbox.cash) { res.status(400).json({ error: '체험 잔액이 부족해요. MY 먹투에서 먹투머니를 충전해보세요.' }); return }
      if (position.amount + amount > limit) { res.status(400).json({ error: `한 식당 투자 한도는 목표액의 1%(${limit.toLocaleString()}원)예요.` }); return }
      sandbox.cash -= amount
      position.amount += amount
      position.updatedAt = now()
      sandbox.fundDeltas[fund.id] = (sandbox.fundDeltas[fund.id] || 0) + amount
      demoNotification(sandbox, 'invest', '체험 투자 완료', `${restaurant?.name || '식당'}에 ${amount.toLocaleString()}원을 체험 투자했어요.`, '/my')
      return done({ message: `${restaurant?.name || '식당'}에 ${amount.toLocaleString()}원을 체험 투자했어요.`, matched: amount, queued: 0, matches: [], balance: sandbox.cash })
    }
    if (amount > position.amount) { res.status(400).json({ error: '회수할 금액이 보유 투자금보다 많아요.' }); return }
    position.amount -= amount
    position.updatedAt = now()
    sandbox.cash += amount
    sandbox.fundDeltas[fund.id] = (sandbox.fundDeltas[fund.id] || 0) - amount
    return done({ message: `${amount.toLocaleString()}원을 체험 회수했어요.`, matched: amount, queued: 0, matches: [], balance: sandbox.cash })
  }

  /* 쿠폰 발급 */
  const couponIssue = match(/^\/api\/positions\/([^/]+)\/coupon$/)
  if (couponIssue && method === 'POST') {
    const position = sandbox.positions.find((item) => item.id === couponIssue[1])
    if (!position) { res.status(404).json({ error: '투자 내역을 찾을 수 없어요.' }); return }
    const fund = db.funds.find((item) => item.id === position.fundId)
    const restaurant = fund && demoRestaurantOf(fund.restaurantId)
    if (!fund || !restaurant) { res.status(404).json({ error: '식당 정보를 찾을 수 없어요.' }); return }
    // 체험자는 며칠을 기다릴 수 없으니 투자금 비례로 즉시 할인율을 만든다.
    const ratio = position.amount / Math.max(1, fund.goal * .01)
    const discount = Math.max(fund.minIssueDiscount, Math.min(fund.maxDiscount, Math.round(ratio * fund.maxDiscount)))
    const coupon: Coupon = {
      id: demoId('coupon'), userId: sandbox.id, restaurantId: restaurant.id, fundId: fund.id,
      title: `${restaurant.name} ${discount}% 응원 쿠폰`, discount,
      maxDiscountWon: Math.floor(restaurant.maxMenuPrice * discount / 100), type: 'fund', status: 'available',
      createdAt: now(), expiresAt: new Date(Date.now() + 86400000 * 90).toISOString(),
    }
    sandbox.coupons.unshift(coupon)
    position.couponProgress = 0
    demoNotification(sandbox, 'coupon', '체험 쿠폰 발급', `${coupon.title}을 받았어요.`, '/my')
    return done({ message: `${discount}% 쿠폰을 체험 발급했어요.`, coupon })
  }

  /* 방문 인증 */
  const visit = match(/^\/api\/restaurants\/([^/]+)\/visit\/verify$/)
  if (visit && method === 'POST') {
    const restaurant = demoRestaurantOf(visit[1])
    if (!restaurant) { res.status(404).json({ error: '식당을 찾을 수 없어요.' }); return }
    let verification = sandbox.visits.find((item) => item.restaurantId === restaurant.id && !item.usedForReview)
    if (!verification) {
      verification = { id: demoId('visit'), restaurantId: restaurant.id, userId: sandbox.id, verifiedAt: now(), usedForReview: false }
      sandbox.visits.push(verification)
    }
    return done({ message: `${restaurant.name} 방문을 체험 인증했어요. 이제 리뷰를 써볼 수 있어요.`, verification })
  }

  /* 리뷰 작성 — 이 세션에서만 보인다 */
  const review = match(/^\/api\/restaurants\/([^/]+)\/reviews$/)
  if (review && method === 'POST') {
    const restaurant = demoRestaurantOf(review[1])
    if (!restaurant) { res.status(404).json({ error: '식당을 찾을 수 없어요.' }); return }
    const rating = Math.round(Number(body.rating))
    const content = String(body.content || '').trim().slice(0, 500)
    if (rating < 1 || rating > 5) { res.status(400).json({ error: '평점은 1점부터 5점까지 선택해주세요.' }); return }
    if (content.length < 10) { res.status(400).json({ error: '리뷰를 10자 이상 작성해주세요.' }); return }
    const verification = sandbox.visits.find((item) => item.restaurantId === restaurant.id && !item.usedForReview)
    if (!verification) { res.status(400).json({ error: '방문 인증 후 리뷰를 작성할 수 있어요.' }); return }
    verification.usedForReview = true
    const created: Review = {
      id: demoId('review'), restaurantId: restaurant.id, userId: sandbox.id, userName: user.name,
      rating, content, visitVerified: true, createdAt: now(),
    }
    sandbox.reviews.unshift(created)
    return done({ message: '체험 리뷰를 남겼어요. 이 리뷰는 체험 창에서만 보이고 저장되지 않아요.', review: created })
  }

  /* 쿠폰 교환장 등록 */
  const listCoupon = match(/^\/api\/coupons\/([^/]+)\/list$/)
  if (listCoupon && method === 'POST') {
    const coupon = sandbox.coupons.find((item) => item.id === listCoupon[1])
    if (!coupon) { res.status(404).json({ error: '체험 지갑에서 쿠폰을 찾을 수 없어요.' }); return }
    if (coupon.status !== 'available') { res.status(400).json({ error: '이미 교환장에 올렸거나 사용한 쿠폰이에요.' }); return }
    coupon.status = 'listed'
    const listing: CouponListing = {
      id: demoId('listing'), userId: sandbox.id, couponId: coupon.id,
      wantedCategories: Array.isArray(body.wantedCategories) ? body.wantedCategories.map(String).slice(0, 5) : [],
      wantedRegions: Array.isArray(body.wantedRegions) ? body.wantedRegions.map(String).slice(0, 5) : [],
      minDiscount: Number(body.minDiscount) || 0, autoAccept: body.autoAccept === true,
      note: String(body.note || '').slice(0, 200), status: 'open',
      createdAt: now(), expiresAt: new Date(Date.now() + 86400000 * 14).toISOString(),
    }
    sandbox.listings.unshift(listing)
    return done({ message: '쿠폰을 체험 교환장에 올렸어요.', listing })
  }

  /* 교환장 등록 취소 */
  const cancelListing = match(/^\/api\/listings\/([^/]+)$/)
  if (cancelListing && method === 'DELETE') {
    const listing = sandbox.listings.find((item) => item.id === cancelListing[1])
    if (!listing) { res.status(404).json({ error: '체험 매물을 찾을 수 없어요.' }); return }
    listing.status = 'cancelled'
    const coupon = sandbox.coupons.find((item) => item.id === listing.couponId)
    if (coupon) coupon.status = 'available'
    return done({ message: '교환장 등록을 취소했어요. 쿠폰을 지갑으로 되돌렸어요.' })
  }

  /* 즉시 교환 — 공개 매물의 쿠폰을 체험 지갑으로 가져온다 (실제 매물은 그대로 남는다) */
  const swap = match(/^\/api\/listings\/([^/]+)\/swap$/)
  if (swap && method === 'POST') {
    const listing = db.couponListings.find((item) => item.id === swap[1] && item.status === 'open')
    const wanted = listing && db.coupons.find((item) => item.id === listing.couponId)
    const mine = sandbox.coupons.find((item) => item.id === String(body.couponId) && item.status === 'available')
    if (!listing || !wanted) { res.status(404).json({ error: '교환할 매물을 찾을 수 없어요.' }); return }
    if (!mine) { res.status(400).json({ error: '내놓을 체험 쿠폰을 먼저 골라주세요. MY 먹투에서 투자한 식당의 쿠폰을 발급받을 수 있어요.' }); return }
    const restaurant = demoRestaurantOf(wanted.restaurantId)
    mine.status = 'used'
    mine.usedAt = now()
    const received: Coupon = {
      ...wanted, id: demoId('coupon'), userId: sandbox.id, status: 'available',
      acquiredFromUserId: listing.userId, acquiredAt: now(), createdAt: now(),
    }
    sandbox.coupons.unshift(received)
    sandbox.trades.unshift({
      id: demoId('trade'), listingId: listing.id, mode: 'instant',
      listerUserId: listing.userId, listerCouponId: wanted.id, listerGaveDiscount: wanted.discount, listerGaveValueWon: wanted.maxDiscountWon,
      takerUserId: sandbox.id, takerCouponId: mine.id, takerGaveDiscount: mine.discount, takerGaveValueWon: mine.maxDiscountWon,
      createdAt: now(),
    })
    demoNotification(sandbox, 'exchange', '체험 교환 완료', `${restaurant?.name || '식당'} ${wanted.discount}% 쿠폰을 받았어요.`, '/my')
    return done({ message: `${restaurant?.name || '식당'} ${wanted.discount}% 쿠폰으로 체험 교환했어요.`, coupon: received })
  }

  /* 쿠폰 사용 요청 */
  const redeem = match(/^\/api\/coupons\/([^/]+)\/redeem$/)
  if (redeem && method === 'POST') {
    const coupon = sandbox.coupons.find((item) => item.id === redeem[1])
    if (!coupon) { res.status(404).json({ error: '체험 지갑에서 쿠폰을 찾을 수 없어요.' }); return }
    coupon.status = 'redeeming'
    coupon.redeemCode = `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    coupon.redeemRequestedAt = now()
    return done({ message: '사장님께 보여줄 사용 코드를 만들었어요.', coupon, code: coupon.redeemCode })
  }

  /* 사장님 쿠폰 확인 */
  if (method === 'POST' && pathname === '/api/owner/coupons/verify') {
    const code = String(body.code || '').trim().toUpperCase()
    if (!code) { res.status(400).json({ error: '쿠폰 코드를 입력해주세요.' }); return }
    if (!code.startsWith('DEMO-')) {
      res.status(404).json({ error: '체험 모드에서는 체험으로 만든 DEMO- 코드만 확인할 수 있어요. 투자자 체험에서 쿠폰을 발급하고 사용 요청을 눌러보세요.' })
      return
    }
    return done({
      message: '체험 쿠폰을 확인 처리했어요. 실제 계정에서는 이 순간 투자자 지갑의 쿠폰이 사용 완료로 바뀝니다.',
      coupon: { id: demoId('coupon'), code, status: 'used', usedAt: now(), title: '체험 쿠폰', discount: 15 },
    })
  }

  /* 제휴기관 연결 / 해제 */
  const connection = match(/^\/api\/data-connections\/([^/]+)$/)
  if (connection && (method === 'POST' || method === 'DELETE')) {
    const sourceId = connection[1]
    const provider = DEMO_PARTNER_PROVIDERS[sourceId]
    if (!provider) { res.status(400).json({ error: '연결할 수 있는 기관이 아니에요.' }); return }
    if (method === 'DELETE') {
      sandbox.connections = sandbox.connections.filter((item) => item.sourceId !== sourceId)
      return done({ message: `${provider.title} 연결을 해제했어요.` })
    }
    if (sandbox.connections.some((item) => item.sourceId === sourceId)) {
      res.status(409).json({ error: '이미 연결된 기관이에요.' })
      return
    }
    const created: DataConnection = {
      id: demoId('connection'), userId: sandbox.id, sourceId: sourceId as DataConnection['sourceId'],
      provider: provider.provider, status: 'active', consentScope: provider.scope,
      recordCount: provider.records, connectedAt: now(), lastSyncedAt: now(),
    }
    sandbox.connections.push(created)
    demoNotification(sandbox, 'connection', '체험 기관 연결', `${provider.title} 자료를 체험 연결했어요.`, '/owner')
    return done({ message: `${provider.title} 자료를 체험 연결했어요. ${provider.records.toLocaleString()}건을 불러온 것으로 처리했어요.`, connection: created })
  }

  /* 1:1 문의 접수 */
  if (method === 'POST' && pathname === '/api/support/requests') {
    const subject = String(body.subject || '').trim()
    const description = String(body.description || '').trim()
    if (subject.length < 3) { res.status(400).json({ error: '제목은 3자 이상 입력해주세요.' }); return }
    if (description.length < 10) { res.status(400).json({ error: '내용은 10자 이상 입력해주세요.' }); return }
    return done({
      message: '체험 모드에서도 접수 화면을 그대로 확인했어요. 실제 계정에서는 이 문의가 운영자에게 전달됩니다.',
      request: { id: demoId('support'), subject, description, status: 'received', createdAt: now() },
    })
  }

  /* 알림 읽음 */
  if (method === 'POST' && pathname === '/api/notifications/read') {
    for (const item of sandbox.notifications) item.read = true
    return done({ message: '알림을 모두 읽음 처리했어요.', unreadNotifications: 0 })
  }

  /* 매출 공개 토글 */
  if (method === 'PATCH' && /^\/api\/owner\/restaurants\/[^/]+\/sales-disclosure$/.test(pathname)) {
    sandbox.salesDisclosure = body.salesDisclosure === true
    return done({ message: sandbox.salesDisclosure ? '월매출을 공개로 바꿨어요.' : '월매출을 비공개로 바꿨어요.', salesDisclosure: sandbox.salesDisclosure })
  }

  /* 심사 접수는 실제 채점 로직을 그대로 쓰기 위해 실제 라우터로 넘긴다.
     (그 핸들러 안에서 체험 세션이면 원장 대신 샌드박스에 저장한다.) */
  if (method === 'POST' && pathname === '/api/applications') return false

  res.status(403).json({ error: '이 기능은 체험 모드에서 아직 준비되지 않았어요. 회원가입하면 바로 이용할 수 있어요.' })
}

app.use('/api', async (req: AuthedRequest, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next()
  const viewer = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  if (viewer?.sessionMode !== 'demo') return next()
  const pathname = req.originalUrl.split('?')[0]
  // AI 상담·문서 판독은 원래 경로를 그대로 쓴다. 둘 다 공유 원장에 쓰지 않는다.
  if (pathname === '/api/ai/chat' || pathname === '/api/ai/ocr' || pathname.startsWith('/api/auth/')) return next()
  req.user = viewer
  try {
    if (await handleDemoMutation(req, res, viewer) === false) return next()
  } catch (error) {
    next(error)
  }
})

/** 체험 세션이 보는 /api/me. 공유 원장 대신 샌드박스를 읽는다. */
function demoMeState(user: SessionUser) {
  const sandbox = sandboxFor(user.id, user.role)
  const positions = sandbox.positions.filter((item) => item.amount > 0).map((position) => {
    const fund = db.funds.find((item) => item.id === position.fundId)
    const restaurant = fund && db.restaurants.find((item) => item.id === fund.restaurantId)
    return { ...position, fund, restaurant, availableAmount: position.amount }
  })
  const coupons = sandbox.coupons.map((coupon) => {
    const restaurant = db.restaurants.find((item) => item.id === coupon.restaurantId)
    return {
      ...coupon, restaurant,
      daysLeft: Math.max(0, Math.floor((new Date(coupon.expiresAt).getTime() - Date.now()) / 86400000)),
      tradable: coupon.status === 'available',
      blockers: coupon.status === 'available' ? [] : ['체험 지갑에서 이미 사용했거나 교환장에 올린 쿠폰이에요.'],
    }
  })
  return {
    user: { ...publicUser(user), cash: sandbox.cash },
    positions,
    orders: [],
    coupons,
    applications: sandbox.applications,
    visitVerifications: sandbox.visits,
    walletTransactions: sandbox.walletTransactions,
    favoriteRestaurantIds: sandbox.favorites,
    ocrAnalyses: [],
    dataConnections: sandbox.connections.map(({ userId: _unused, ...item }) => item),
    notifications: sandbox.notifications,
    unreadNotifications: sandbox.notifications.filter((item) => !item.read).length,
    exchange: {
      openListings: sandbox.listings.filter((item) => item.status === 'open').length,
      offersReceived: 0,
      offersSent: 0,
      trades: sandbox.trades.length,
    },
    rules: EXCHANGE_RULES,
    demo: { notice: DEMO_NOTICE, startingCash: 300000 },
  }
}

/** 공개 데이터 위에 이 체험 세션의 리뷰·투자분·매물만 얹는다. */
function withDemoOverlay(state: ReturnType<typeof publicState>, user: SessionUser) {
  const sandbox = sandboxFor(user.id, user.role)
  const restaurants = state.restaurants.map((restaurant) => {
    const myReviews = sandbox.reviews.filter((review) => review.restaurantId === restaurant.id)
    const delta = restaurant.fund ? sandbox.fundDeltas[restaurant.fund.id] || 0 : 0
    if (!myReviews.length && !delta) return restaurant
    return {
      ...restaurant,
      reviews: [...myReviews, ...(restaurant.reviews || [])].slice(0, 10),
      reviewCount: restaurant.reviewCount + myReviews.length,
      fund: restaurant.fund && delta ? { ...restaurant.fund, raised: Math.max(0, restaurant.fund.raised + delta) } : restaurant.fund,
    }
  })
  // 필드 모양은 listingView() 와 정확히 같아야 한다. 다르면 교환장 화면이 깨진다.
  const myListings = sandbox.listings.filter((item) => item.status === 'open').map((listing) => {
    const coupon = sandbox.coupons.find((item) => item.id === listing.couponId)
    const restaurant = coupon && db.restaurants.find((item) => item.id === coupon.restaurantId)
    return {
      ...listing, coupon, restaurant, userName: user.name,
      offerCount: 0, myOfferId: undefined, matchableCouponIds: [] as string[], mine: true,
    }
  })
  return { ...state, restaurants, listings: [...myListings, ...state.listings], demo: { notice: DEMO_NOTICE } }
}


app.get('/api/health', (_req, res) => res.json({
  ok: true,
  time: now(),
  authProvider: supabaseAuthConfigured ? 'supabase-with-local-demo-fallback' : 'local-demo',
  stateStore: store.kind,
  stateVersion: store.kind === 'file' ? undefined : stateVersion,
}))
app.get('/api/public', async (req: AuthedRequest, res) => {
  const viewer = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  const state = publicState(viewer?.id)
  // 체험 세션에는 자기가 쓴 리뷰와 체험 투자분을 얹어서 보여준다.
  // 공유 원장은 그대로이므로 다른 사용자 화면은 바뀌지 않는다.
  if (viewer?.sessionMode === 'demo') return res.json(withDemoOverlay(state, viewer))
  res.json(state)
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
  if (!rateLimit(`signup:${callerIp(req)}`, 20, 60_000)) return res.status(429).json({ error: '가입 시도가 너무 많아요. 잠시 후 다시 시도해주세요.' })
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
  // 비밀번호 검증이 scrypt라 시도 한 번마다 서버 CPU를 크게 쓴다. 제한이 없으면
  // 대입 공격이자 그 자체로 자원 고갈 경로가 된다. 다만 세는 건 '실패한 시도'뿐이다.
  // 성공까지 세면 한 사무실에서 여러 명이 정상적으로 로그인하는 것도 막힌다.
  const { email, password, role } = req.body as { email?: string; password?: string; role?: Role }
  const ipKey = `login:ip:${callerIp(req)}`
  const accountKey = `login:account:${String(email || '').toLowerCase()}`
  const tooManyFailures = !rateLimitPeek(ipKey, 30, 60_000) || !rateLimitPeek(accountKey, 8, 60_000)
  if (tooManyFailures) return res.status(429).json({ error: '로그인 시도가 너무 많아요. 1분 뒤에 다시 시도해주세요.' })
  if (role && role !== 'owner' && role !== 'investor') return res.status(400).json({ error: '로그인 유형을 다시 선택해주세요.' })
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase())
  if (user?.accountStatus === 'suspended') return res.status(403).json({ error: '이용이 일시 정지된 계정이에요.' })
  if (user && password && !user.passwordHash.startsWith('supabase:') && await verifyPassword(password, user.passwordHash)) {
    if (role && user.role !== role) return res.status(403).json({ error: `이 계정은 ${user.role === 'owner' ? '사장님' : user.role === 'investor' ? '투자자' : '관리자'} 유형으로 가입되어 있어요. 로그인 유형을 바꿔주세요.` })
    return res.json({ token: tokenFor(user), user: publicUser(user), provider: 'local-demo' })
  }
  if (supabaseAuthConfigured && email && password) {
    try {
      const session = await supabaseRequest('token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: String(email).toLowerCase(), password }) })
      const profileRole = db.users.find((item) => item.email === String(email).toLowerCase())?.role || session.user?.user_metadata?.role
      if (role && profileRole && profileRole !== role) return res.status(403).json({ error: `이 계정은 ${profileRole === 'owner' ? '사장님' : profileRole === 'investor' ? '투자자' : '관리자'} 유형으로 가입되어 있어요. 로그인 유형을 바꿔주세요.` })
      return res.json({ token: session.access_token, user: session.user, provider: 'supabase' })
    } catch { /* return the common authentication error below */ }
  }
  rateLimitHit(ipKey)
  rateLimitHit(accountKey)
  res.status(401).json({ error: '이메일 또는 비밀번호를 확인해주세요.' })
})

app.get('/api/me', auth(), async (req: AuthedRequest, res) => {
  const user = req.user!
  // 체험 세션은 공유 원장이 아니라 자기 샌드박스를 본다.
  if (user.sessionMode === 'demo') return res.json(demoMeState(user))
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

app.get('/api/admin/dashboard', auth('admin'), (_req, res) => {
  const applications = [...db.applications].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
  res.json({
    stats: {
      users: db.users.filter((user) => user.role !== 'admin').length,
      owners: db.users.filter((user) => user.role === 'owner').length,
      pendingApplications: applications.filter((application) => application.status === 'manual_review').length,
      activeFunds: db.funds.filter((fund) => fund.status !== 'closed').length,
      funded: db.funds.reduce((sum, fund) => sum + fund.raised, 0),
      openSupport: (db.supportRequests || []).filter((request) => !['answered', 'closed'].includes(request.status)).length,
      coupons: db.coupons.length,
    },
    users: db.users
      .filter((user) => user.role !== 'admin')
      .map((user) => ({
        ...publicUser(user),
        positions: db.positions.filter((position) => position.userId === user.id && position.amount > 0).length,
        applications: db.applications.filter((application) => application.userId === user.id).length,
      })),
    applications: applications.map((application) => {
      const owner = db.users.find((user) => user.id === application.userId)
      return { ...application, owner: owner ? publicUser(owner) : undefined }
    }),
    restaurants: db.restaurants,
    funds: db.funds,
    reviews: db.reviews,
    support: [...(db.supportRequests || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    coupons: db.coupons,
  })
})

app.patch('/api/admin/users/:id', auth('admin'), async (req: AuthedRequest, res) => {
  const user = db.users.find((item) => item.id === req.params.id)
  if (!user) return res.status(404).json({ error: '회원을 찾지 못했어요.' })
  if (user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 변경할 수 없어요.' })
  if (req.body.accountStatus === 'active' || req.body.accountStatus === 'suspended') user.accountStatus = req.body.accountStatus
  audit(req.user!.id, 'admin.user_status', 'user', user.id, `${user.email} 계정 상태 ${user.accountStatus}`)
  await saveDatabase(); changed(); res.json(publicUser(user))
})

app.patch('/api/admin/restaurants/:id', auth('admin'), async (req: AuthedRequest, res) => {
  const restaurant = db.restaurants.find((item) => item.id === req.params.id)
  if (!restaurant) return res.status(404).json({ error: '식당을 찾지 못했어요.' })
  if (typeof req.body.salesDisclosure === 'boolean') restaurant.salesDisclosure = req.body.salesDisclosure
  await saveDatabase(); changed(); res.json(restaurant)
})

app.patch('/api/admin/funds/:id', auth('admin'), async (req: AuthedRequest, res) => {
  const fund = db.funds.find((item) => item.id === req.params.id)
  if (!fund) return res.status(404).json({ error: '펀드룰 찾지 못했어요.' })
  if (!['funding', 'trading', 'closed'].includes(req.body.status)) return res.status(400).json({ error: '펀드 상태를 다시 선택해주세요.' })
  fund.status = req.body.status
  await saveDatabase(); changed(); res.json(fund)
})

app.patch('/api/admin/applications/:id', auth('admin'), async (req: AuthedRequest, res) => {
  const application = db.applications.find((item) => item.id === req.params.id)
  if (!application) return res.status(404).json({ error: '심사를 찾지 못했어요.' })
  if (['approved', 'conditional', 'manual_review', 'rejected'].includes(req.body.status)) application.status = req.body.status
  await saveDatabase(); changed(); res.json(application)
})

app.patch('/api/admin/reviews/:id', auth('admin'), async (req: AuthedRequest, res) => {
  const review = db.reviews.find((item) => item.id === req.params.id)
  if (!review) return res.status(404).json({ error: '리뷰를 찾지 못했어요.' })
  review.status = req.body.status === 'hidden' ? 'hidden' : 'published'
  await saveDatabase(); changed(); res.json(review)
})

app.patch('/api/admin/support/:id', auth('admin'), async (req: AuthedRequest, res) => {
  const request = (db.supportRequests || []).find((item) => item.id === req.params.id)
  if (!request) return res.status(404).json({ error: '문의를 찾지 못했어요.' })
  const answer = String(req.body.answer || '').trim()
  request.status = answer ? 'answered' : req.body.status === 'closed' ? 'closed' : 'in_review'
  if (answer) { request.answer = answer.slice(0, 2000); request.answeredAt = now(); pushNotification(request.userId, 'support', '문의에 답변이 도착했어요', `“${request.subject}” 문의의 답변을 확인해보세요.`, '/support') }
  await saveDatabase(); changed(); res.json(request)
})

app.patch('/api/admin/coupons/:id', auth('admin'), async (req: AuthedRequest, res) => {
  const coupon = db.coupons.find((item) => item.id === req.params.id)
  if (!coupon) return res.status(404).json({ error: '쿠폰을 찾지 못했어요.' })
  if (['available', 'used', 'expired'].includes(req.body.status)) coupon.status = req.body.status
  await saveDatabase(); changed(); res.json(coupon)
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
  if (ledgerRpcEnabled) {
    // 주문 마감·현금 환불·호가 재계산을 한 트랜잭션에서 처리한다.
    try {
      const result = await runLedgerRpc<{ refunded: number }>('cancel_order', { p_user: req.user!.id, p_order: order.id })
      changed()
      return res.json({ message: result.refunded ? `예약을 취소하고 ${result.refunded.toLocaleString()} 먹투머니를 돌려받았어요.` : '회수 대기 주문을 취소했어요.' })
    } catch (error) { return res.status(400).json({ error: rpcMessage(error) }) }
  }
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
  if (ledgerRpcEnabled) {
    // 잔액 차감·포지션·모금액·FIFO 매칭을 Postgres 트랜잭션 하나로 처리한다.
    // 검증도 그 안에서 다시 하므로 여기서 미리 거를 필요가 없다.
    try {
      const result = await runLedgerRpc<{ matched: number; queued: number; matches: unknown[] }>(
        'invest', { p_user: user.id, p_fund: fund.id, p_amount: amount })
      changed()
      const message = result.queued === 0
        ? (fund.status === 'funding' ? `${result.matched.toLocaleString()}원이 바로 투자됐어요.` : '예약한 금액이 모두 투자됐어요.')
        : result.matched > 0 ? `${result.matched.toLocaleString()}원이 투자되고 나머지는 예약됐어요.`
        : '매도자가 나타나면 1,000원부터 순서대로 투자돼요.'
      return res.json({ message, matched: result.matched, queued: result.queued, matches: result.matches })
    } catch (error) { return res.status(400).json({ error: rpcMessage(error) }) }
  }
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
  if (ledgerRpcEnabled) {
    // 돈이 오가는 부분만 트랜잭션으로 처리하고, 쿠폰 정산은 적립률 계산이
    // 서버에 있어 체결 결과를 받아 이어서 한다. 체결이 0원이면 쿠폰도 없다.
    try {
      const result = await runLedgerRpc<{ matched: number; queued: number; matches: unknown[] }>(
        'withdraw_investment', { p_user: user.id, p_fund: fund.id, p_amount: amount })
      const settled = db.positions.find((p) => p.userId === user.id && p.fundId === fund.id)
      const coupon = result.matched > 0 && settled ? issueCoupon(settled) : undefined
      if (coupon) await saveDatabase()
      changed()
      const message = result.queued === 0 ? (fund.status === 'funding' ? `${result.matched.toLocaleString()}원을 바로 회수했어요.` : '신청한 금액을 모두 회수했어요.')
        : result.matched > 0 ? `${result.matched.toLocaleString()}원이 회수되고 나머지는 대기 중이에요.`
        : '사는 사람이 나타나면 1,000원부터 순서대로 회수돼요.'
      return res.json({ message, matched: result.matched, queued: result.queued, coupon, matches: result.matches })
    } catch (error) { return res.status(400).json({ error: rpcMessage(error) }) }
  }
  const position = db.positions.find((p) => p.userId === user.id && p.fundId === fund.id)
  if (!position) return res.status(400).json({ error: '보유한 투자금이 없어요.' })
  if (fund.status === 'trading' && db.orders.some((order) => order.userId === user.id && order.fundId === fund.id && order.type === 'buy' && order.remaining > 0)) return res.status(400).json({ error: '이 펀드의 투자 예약을 먼저 취소하거나 체결해주세요.' })
  const alreadySelling = db.orders.filter((o) => o.userId === user.id && o.fundId === fund.id && o.type === 'sell' && o.remaining > 0).reduce((sum, o) => sum + o.remaining, 0)
  if (position.amount - alreadySelling < amount) return res.status(400).json({ error: '주문 가능한 투자금보다 큰 금액이에요.' })
  if (fund.status === 'funding') {
    // 모금 중 회수는 그 자리에서 확정되므로 지금까지 쌓인 혜택도 함께 정산한다.
    const coupon = issueCoupon(position)
    position.amount -= amount
    fund.raised = Math.max(0, fund.raised - amount)
    user.cash += amount
    if (position.amount <= 0) fund.investorCount = Math.max(0, fund.investorCount - 1)
    await saveDatabase(); changed()
    return res.json({ message: `${amount.toLocaleString()}원을 바로 회수했어요.`, matched: amount, queued: 0, coupon })
  }
  const order: Order = { id: id('order'), userId: user.id, fundId: fund.id, type: 'sell', originalAmount: amount, remaining: amount, status: 'open', createdAt: now() }
  db.orders.push(order)
  const matches = matchOrders(fund.id)
  const matched = amount - order.remaining
  // 예약 거래에서는 사는 사람이 나타나야 회수가 성립한다. 체결 전에 쿠폰을 내주면
  // 아직 돌려받지도 못한 투자금에 혜택이 먼저 나가고, 주문을 취소해도 쿠폰은 남는다.
  const coupon = matched > 0 ? issueCoupon(position) : undefined
  await saveDatabase(); changed()
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
/**
 * 펀드 예약 주문장(호가창).
 *
 * 먹투의 모금이 끝난 펀드는 가격이 움직이지 않는다. 1,000원은 언제나 1,000원이고
 * 대신 "누가 먼저 줄을 섰는가"만 남는다. 그래서 승재 프로젝트의 가격·시간 우선
 * 호가창 대신 시간 우선 단일가 대기열로 옮겨 붙였다.
 * 주문 자체는 예전부터 db.orders 에 쌓이고 matchOrders 가 FIFO로 체결해왔는데,
 * 화면에서 볼 방법이 없어서 "예약 거래장"이 사라진 것처럼 보였다. 이 API가 그 창이다.
 */
app.get('/api/market/orderbook', async (req: AuthedRequest, res) => {
  const viewer = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  const wanted = typeof req.query.fundId === 'string' ? req.query.fundId : undefined
  const funds = db.funds.filter((fund) => fund.status === 'trading' && (!wanted || fund.id === wanted))
  const books = funds.map((fund) => {
    const restaurant = db.restaurants.find((item) => item.id === fund.restaurantId)
    const open = db.orders
      .filter((order) => order.fundId === fund.id && order.remaining > 0 && ['open', 'partial'].includes(order.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    // 대기열은 익명이다. 누가 얼마를 걸었는지가 아니라 내 앞에 얼마가 있는지만 알려준다.
    const queue = (type: 'buy' | 'sell') => {
      let ahead = 0
      return open.filter((order) => order.type === type).map((order, index) => {
        const entry = {
          rank: index + 1,
          amount: order.remaining,
          amountAhead: ahead,
          waitingSince: order.createdAt,
          mine: Boolean(viewer && order.userId === viewer.id),
          orderId: viewer && order.userId === viewer.id ? order.id : undefined,
        }
        ahead += order.remaining
        return entry
      })
    }
    const buyQueue = queue('buy')
    const sellQueue = queue('sell')
    return {
      fundId: fund.id,
      restaurantId: restaurant?.id,
      restaurantName: restaurant?.name,
      emoji: restaurant?.emoji,
      neighborhood: restaurant?.neighborhood,
      category: restaurant?.category,
      color: restaurant?.color,
      goal: fund.goal,
      raised: fund.raised,
      maxDiscount: fund.maxDiscount,
      buyQueue,
      sellQueue,
      buyTotal: buyQueue.reduce((sum, item) => sum + item.amount, 0),
      sellTotal: sellQueue.reduce((sum, item) => sum + item.amount, 0),
      myPosition: viewer ? db.positions.find((item) => item.userId === viewer.id && item.fundId === fund.id)?.amount ?? 0 : 0,
    }
  })
  res.json({
    unit: 1000,
    rule: '가격은 1,000원으로 고정이고 먼저 예약한 순서대로 체결됩니다. 반대 주문이 없으면 대기합니다.',
    books: books.sort((a, b) => (b.buyTotal + b.sellTotal) - (a.buyTotal + a.sellTotal)),
  })
})

/* ── 1:1 고객지원 ───────────────────────────────────────────────
 * 승재 프로젝트의 문의 접수(disputes)를 먹투로 옮겼다.
 * AI 상담원이 답할 수 없는 계정·거래 문제를 사람에게 넘기는 통로다.
 */
const SUPPORT_TYPES = ['investment', 'coupon', 'exchange', 'review', 'owner', 'account', 'other'] as const
const SUPPORT_TYPE_LABELS: Record<string, string> = {
  investment: '투자·회수', coupon: '쿠폰', exchange: '교환장', review: '리뷰',
  owner: '사장님 심사', account: '계정·로그인', other: '기타',
}

app.get('/api/support/requests', auth(), (req: AuthedRequest, res) => {
  const mine = (db.supportRequests || []).filter((item) => item.userId === req.user!.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  res.json({ requests: mine, types: SUPPORT_TYPES.map((type) => ({ id: type, label: SUPPORT_TYPE_LABELS[type] })) })
})

app.post('/api/support/requests', auth(), async (req: AuthedRequest, res) => {
  const body = req.body as Record<string, unknown>
  const type = String(body.type || 'other') as SupportRequest['type']
  const subject = String(body.subject || '').trim()
  const description = String(body.description || '').trim()
  if (!SUPPORT_TYPES.includes(type as typeof SUPPORT_TYPES[number])) return res.status(400).json({ error: '문의 유형을 다시 선택해주세요.' })
  if (subject.length < 3 || subject.length > 100) return res.status(400).json({ error: '제목은 3자 이상 100자 이하로 입력해주세요.' })
  if (description.length < 10 || description.length > 2000) return res.status(400).json({ error: '내용은 10자 이상 2,000자 이하로 입력해주세요.' })
  const restaurantId = typeof body.restaurantId === 'string' && db.restaurants.some((item) => item.id === body.restaurantId)
    ? body.restaurantId : undefined
  const request: SupportRequest = {
    id: id('support'), userId: req.user!.id, userName: req.user!.name, type,
    subject: subject.slice(0, 100), description: description.slice(0, 2000), restaurantId,
    priority: type === 'investment' || type === 'account' ? 'high' : 'normal',
    status: 'received', createdAt: now(),
  }
  db.supportRequests ??= []
  db.supportRequests.push(request)
  pushNotification(req.user!.id, 'support', '문의를 접수했어요',
    `“${request.subject}” 문의가 접수됐어요. 영업일 기준 1~2일 안에 답변드릴게요.`, '/support')
  audit(req.user!.id, 'support.created', 'support', request.id, `${SUPPORT_TYPE_LABELS[type]} 문의 접수 · ${request.subject}`)
  await saveDatabase(); changed()
  res.status(201).json({ message: '문의를 접수했어요. 답변은 알림으로 알려드릴게요.', request })
})

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
    if (ledgerRpcEnabled) {
      // 쿠폰 잠금·매물 생성·감사기록을 한 트랜잭션으로. 중복 등록은 부분 유니크 인덱스가 막는다.
      try {
        const created = await runLedgerRpc<{ listingId: string }>('list_coupon', {
          p_user: me.id, p_coupon: coupon.id,
          p_categories: listing.wantedCategories, p_regions: listing.wantedRegions,
          p_min_discount: listing.minDiscount, p_auto_accept: listing.autoAccept, p_note: listing.note,
        })
        changed()
        const saved = db.couponListings.find((item) => item.id === created.listingId)
        return { status: 200, body: { message: '쿠폰 교환장에 등록했어요.', listing: saved && listingView(saved, me.id) } }
      } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
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
    if (ledgerRpcEnabled) {
      // 매물 마감·쿠폰 반환·걸린 제안 에스크로 해제를 한 트랜잭션으로 처리한다.
      try {
        await runLedgerRpc('cancel_listing', { p_user: me.id, p_listing: listing.id })
        changed()
        const returned = db.coupons.find((item) => item.id === listing.couponId)
        return { status: 200, body: { message: `${coupon.title} 교환을 취소하고 내 지갑으로 돌려받았어요.`, coupon: returned && couponView(returned) } }
      } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
    }
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
    if (ledgerRpcEnabled) {
      // 소유자 맞교환·매물 마감·남은 제안 정리·체결기록을 한 트랜잭션으로.
      // 두 사람이 동시에 같은 매물을 가져가면 매물 행 잠금에서 한쪽만 통과한다.
      try {
        const done = await runLedgerRpc<{ tradeId: string }>('instant_swap', {
          p_user: me.id, p_listing: listing.id, p_coupon: offered.id })
        changed()
        const settled = db.couponTrades.find((item) => item.id === done.tradeId)
        const received = db.coupons.find((item) => item.id === wanted.id)
        return { status: 200, body: { message: `${offered.title} → ${wanted.title} 교환이 완료됐어요!`, trade: settled, coupon: received && couponView(received) } }
      } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
    }
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
      if (ledgerRpcEnabled) {
        try {
          const done = await runLedgerRpc<{ tradeId: string }>('instant_swap', {
            p_user: me.id, p_listing: listing.id, p_coupon: offered.id })
          changed()
          return { status: 200, body: { message: `${offered.title} → ${wanted.title} 교환이 바로 완료됐어요!`, trade: db.couponTrades.find((item) => item.id === done.tradeId), settled: true } }
        } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
      }
      const trade = settleSwap(listing, wanted, offered, me.id, 'instant')
      await saveDatabase(); changed()
      return { status: 200, body: { message: `${offered.title} → ${wanted.title} 교환이 바로 완료됐어요!`, trade, settled: true } }
    }

    if (ledgerRpcEnabled) {
      // 제안 생성과 동시에 쿠폰을 offered 로 잠근다(에스크로).
      // 같은 쿠폰으로 두 곳에 제안하는 것은 coupon_offers_escrow_idx 가 DB 에서 막는다.
      try {
        const created = await runLedgerRpc<{ offerId: string }>('offer_coupon', {
          p_user: me.id, p_listing: listing.id, p_coupon: offered.id,
          p_message: String(req.body.message || '').slice(0, 140) })
        changed()
        return { status: 201, body: { message: '교환 제안을 보냈어요. 등록자가 수락하면 바로 교환돼요.', offer: db.couponOffers.find((item) => item.id === created.offerId), settled: false } }
      } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
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
    if (ledgerRpcEnabled) {
      try {
        await runLedgerRpc('resolve_offer', { p_user: me.id, p_offer: offer.id, p_action: 'withdrawn' })
        changed()
        const returned = db.coupons.find((item) => item.id === offer.offerCouponId)
        return { status: 200, body: { message: '교환 제안을 취소하고 쿠폰을 돌려받았어요.', coupon: returned && couponView(returned) } }
      } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
    }
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
    if (ledgerRpcEnabled) {
      try {
        const done = await runLedgerRpc<{ tradeId: string }>('accept_offer', { p_user: me.id, p_offer: offer.id })
        changed()
        return { status: 200, body: { message: `${userName(offer.offerUserId)}님과 교환을 완료했어요!`, trade: db.couponTrades.find((item) => item.id === done.tradeId) } }
      } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
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
    if (ledgerRpcEnabled) {
      try {
        await runLedgerRpc('resolve_offer', { p_user: me.id, p_offer: offer.id, p_action: 'declined' })
        changed()
        return { status: 200, body: { message: '제안을 거절했어요.' } }
      } catch (error) { return { status: 400, body: { error: rpcMessage(error) } } }
    }
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
    if (fund) syncCouponLedger(fund.id)
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
  // CSV 본문. 집계에만 쓰고 저장하지 않는다.
  // 이미지·PDF 는 여기로 오지 않는다(문서는 AI 판독 경로가 따로 있다).
  const rawBodies = data.documentContents && typeof data.documentContents === 'object' && !Array.isArray(data.documentContents)
    ? data.documentContents as Record<string, unknown> : {}
  const rawContents: Record<string, string> = Object.fromEntries(
    uploadedSources
      .filter((source) => typeof rawBodies[source] === 'string')
      // 한 파일당 6MB. express 본문 상한(8MB) 안에서 POS 12개월치(약 0.6MB)를 넉넉히 담는다.
      .map((source) => [source, String(rawBodies[source]).slice(0, 6 * 1024 * 1024)]),
  )
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

  // ── 원자료 집계 ───────────────────────────────────────────────
  //
  // 예전에는 여기서 상호명 글자코드로 만든 난수를 지표로 썼다.
  //   const numericSeed = [...restaurantName].reduce((s, c) => s + c.charCodeAt(0), 0)
  //   const monthlySales = 32000000 + (numericSeed % 1700) * 10000
  // 파일을 올려도 읽지 않았고 같은 상호면 늘 같은 매출이 나왔다.
  // 그 값이 신용등급 35개 지표의 입력이었으니 등급이 자료와 무관했다.
  //
  // 이제 올라온 CSV 본문을 실제로 파싱해 계산한다. 읽어내지 못한 지표는
  // 지어내지 않고 null(미산정)로 남기고, coverage 로 "무엇을 모르는지" 드러낸다.
  // 원본 텍스트는 집계에만 쓰고 저장하지 않는다.
  const rawUploads: RawUpload[] = uploadedSources
    .map((source) => ({ source, text: rawContents[source] }))
    .filter((item): item is { source: string; text: string } => typeof item.text === 'string' && item.text.length > 0)
    .map((item) => ({ sourceId: item.source, name: String(uploadedDocuments[item.source]), text: item.text }))
  const aggregated = deriveMetricsFromUploads(rawUploads)
  const measured = aggregated.metrics
  const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

  const monthlySales = asNumber(measured.recent12MonthAverageSales)
  const salesGrowth = asNumber(measured.recent12MonthSalesGrowth)
  const operatingCashflow = asNumber(measured.estimatedMonthlyOperatingCashflow)
  const salesVolatility = asNumber(measured.salesVolatility)
  const repeatRate = asNumber(measured.repeatRate) ?? asNumber(measured.deliveryRepeatRatio)
  const averageTicket = asNumber(measured.averageTicket)
  const deliveryShare = asNumber(measured.deliverySalesShare)
  const rentRatio = asNumber(measured.rentToSalesRatio)
  const monthlyDebtPayment = asNumber(measured.monthlyDebtPayment)
  const debtServiceRatio = asNumber(measured.debtServiceToCashflowRatio)
  // 업력은 어느 CSV에도 없다. 사업자등록증 개업일이 붙기 전까지는 등록된 식당 값만 쓴다.
  const knownRestaurant = db.restaurants.find((item) => item.name === restaurantName)
  const operatingYears = asNumber(knownRestaurant?.openedYears)
  const staffTrend = typeof measured.staffTrend === 'string' ? measured.staffTrend : null
  // 상권 성장률은 주소로 매칭한 공개 상권자료에서 가져온다.
  // 처음 신청하는 사장님은 db.restaurants 에 없으므로 이름 매칭만으로는 항상 미산정이 됐다.
  // (시연의 '샘플식당'도 시드에 없어서 상권 지표가 늘 비어 있었다.)
  // findCommercialArea 는 동네·지역 문자열만 보므로 입력한 주소를 그대로 넘겨 찾는다.
  const address = String(data.address || '').trim()
  const areaMatch = knownRestaurant
    ? findCommercialArea(knownRestaurant)
    : findCommercialArea({ neighborhood: address, region: address })
  const districtSalesGrowth = asNumber(areaMatch?.area.spending.localSalesGrowth)
  const relativeGrowth = salesGrowth !== null && districtSalesGrowth !== null
    ? Number((salesGrowth - districtSalesGrowth).toFixed(1)) : null
  const reconciliationRate = asNumber(measured.salesReconciliationRate)

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
  // 판독한 부채 증빙의 금액을 신용지표(total_loan_balance)로 그대로 흘려보낸다.
  // 여기가 "AI가 서류를 읽어 등급을 낸다"가 실제로 성립하는 유일한 연결점이다.
  const debtDocumentTotal = myAnalyses
    .filter((item) => item.sourceId === 'debt' && item.status === 'ai_extracted')
    .map((item) => Number((item.result as Record<string, unknown>).total))
    .find((value) => Number.isFinite(value) && value > 0) ?? null
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
  // 미산정은 감점하지 않는다. 자료를 덜 낸 것과 나쁜 실적은 다른 문제라
  // 감점 대신 dataConfidence 와 신용등급 coverage 로 드러낸다.
  score += salesGrowth === null ? 0 : Math.min(17, Math.max(-10, salesGrowth * .75))
  score += relativeGrowth === null ? 0 : Math.min(8, Math.max(0, relativeGrowth) * .8)
  score += repeatRate === null ? 0 : Math.min(8, repeatRate * .14)
  score += Math.min(10, dataConfidence * .1)
  score += operatingYears === null ? 0 : operatingYears >= 3 ? 5 : 2
  score += reconciliationRate === null ? 0 : reconciliationRate >= 94 ? 5 : reconciliationRate >= 85 ? 2 : -5
  score += debtServiceRatio === null ? 0 : debtServiceRatio <= 45 ? 4 : debtServiceRatio <= 70 ? 0 : -8
  // 교차검증 결과 반영: 불일치는 감점, 운영자 확인 준비 완료는 가점
  score += financialVerification.mismatches.length ? -12 : financialVerification.readyForAdminReview ? 4 : 0
  score += businessVerification.verified ? 0 : -6
  score = Math.max(0, Math.min(100, Math.round(score)))

  // 매출을 읽어내지 못하면 한도를 계산하지 않는다. 0으로 두고 수동 심사로 보낸다.
  const capacity = monthlySales === null ? 0
    : Math.round((monthlySales * .42 + Math.max(0, operatingCashflow ?? 0) * 2.2) / 1000000) * 1000000
  const approvedLimit = Math.max(5000000, Math.min(requestedLimit || capacity, capacity, 100000000))
  // 사업자 진위확인 실패나 문서 불일치는 점수와 무관하게 사람이 봐야 한다.
  const status: Application['status'] = !basicVerified || !coreOperations || !businessVerification.verified || financialVerification.mismatches.length
    ? 'manual_review'
    : score >= 78 ? 'approved'
      : score >= 58 ? 'conditional'
        : score >= 40 ? 'manual_review' : 'rejected'

  // 계산해낸 값만 말한다. 읽지 못한 지표를 문장으로 지어내지 않는다.
  const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
  const strengths = [
    monthlySales === null
      ? 'POS 원자료를 읽지 못해 매출 지표는 미산정으로 남겼어요. CSV 열 이름을 확인해주세요.'
      : `POS 주문 ${(aggregated.evidence.find((item) => item.sourceId === 'pos')?.rows ?? 0).toLocaleString('ko-KR')}건을 직접 합산해 월평균 매출 ${won(monthlySales)}을 계산했어요.`,
    salesGrowth === null ? '매출 성장률은 12개월치 자료가 모여야 계산할 수 있어요.'
      : relativeGrowth === null ? `최근 12개월 매출 성장률은 ${salesGrowth}%예요. (상권 비교값은 주소 매칭 후 산정)`
      : `매출 성장률 ${salesGrowth}%로 상권 성장률 ${districtSalesGrowth}%보다 ${relativeGrowth}%p ${relativeGrowth >= 0 ? '높아요' : '낮아요'}.`,
    repeatRate === null ? '재방문 식별 데이터는 없지만 불이익 대신 미산정으로 처리했어요.'
      : `가명 고객 자료에서 재방문율 ${repeatRate}%가 계산됐어요.`,
    reconciliationRate === null ? 'POS와 계좌를 함께 올리면 매출 교차검증 일치도를 낼 수 있어요.'
      : `POS 매출과 계좌 실제 입금의 일치도는 ${reconciliationRate}%예요.`,
    operatingCashflow === null ? '사업용 계좌를 올리면 월 영업현금흐름을 직접 계산할 수 있어요.'
      : `계좌 입출금에서 월 영업현금흐름 ${won(operatingCashflow)}을 계산했어요.`,
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
  // 파일을 읽다 발견한 문제는 그대로 사장님에게 알린다.
  improvements.push(...aggregated.warnings)
  for (const source of uploadedSources) {
    if (!/\.csv$/i.test(String(uploadedDocuments[source] || ''))) continue
    if (rawContents[source]) continue
    improvements.push(`${uploadedDocuments[source]} 본문을 받지 못해 지표를 계산하지 못했어요. 파일을 다시 선택해주세요.`)
  }
  improvements.push(...financialVerification.mismatches)
  improvements.push(...financialVerification.warnings.slice(0, 3))
  if (!improvements.length) improvements.push('연결된 원천자료의 최신성을 유지하고 자금 사용 결과를 월별로 공개해주세요.')

  const derivedMetrics = {
    // 원자료에서 계산해낸 값 전부. 신용평가 35개 지표가 여기서 입력을 가져가므로
    // 집계 결과를 통째로 깔아두고, 아래에서 이름이 다른 것만 다시 맞춘다.
    // (예전에는 여기 나열된 15개만 넘어가서, 대출 CSV를 올려도
    //  총 대출잔액·금융기관 수·평균금리가 신용평가에 닿지 않고 미산정으로 남았다.)
    ...measured,
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
    staffTrend,
    districtSalesGrowth,
    relativeSalesGrowth: relativeGrowth,
    salesReconciliationRate: reconciliationRate,
    // 대출잔액은 CSV 집계를 우선하고, 표가 없을 때만 AI가 판독한 증빙 금액을 쓴다.
    totalLoanBalance: asNumber(measured.totalLoanBalance) ?? debtDocumentTotal,
  }

  /**
   * 화면에 내보낼 지표만 추린다.
   *
   * 결과 화면은 derivedMetrics 를 그대로 순회하며 카드를 그린다.
   * 그래서 집계 중간값(posOrderCount, cardApprovedTotal 등)과 파싱 근거 배열까지
   * 사장님 화면에 라벨 없는 camelCase 로 찍혔고, 배열은 '[object Object]'로 나왔다.
   * 클라이언트가 이름을 아는 지표만 남기고, 파싱 근거는 별도 필드로 옮긴다.
   */
  const displayMetricKeys = [
    'recent12MonthAverageSales', 'recent12MonthSalesGrowth', 'estimatedMonthlyOperatingCashflow',
    'salesVolatility', 'repeatRate', 'averageTicket', 'deliverySalesShare', 'rentToSalesRatio',
    'debtServiceToCashflowRatio', 'operatingYears', 'staffTrend', 'districtSalesGrowth',
    'relativeSalesGrowth', 'salesReconciliationRate',
  ]
  const displayMetrics = Object.fromEntries(
    displayMetricKeys.map((key) => [key, (derivedMetrics as Record<string, unknown>)[key] ?? null]),
  )
  // 35개 지표 · 6개 업종 신용등급. 5요소 상권 위험평가와 함께 낸다.
  // 자료가 없는 지표는 감점 대신 미산정으로 남고 coverage로 드러난다.
  const industry = toIndustry(String(data.industry || data.category || ''))
  const matchedRestaurant = db.restaurants.find((item) => item.name === restaurantName)
  const located = matchedRestaurant ? findCommercialArea(matchedRestaurant) : undefined
  const creditAssessment = assessCredit(deriveCreditInput({
    industry,
    connectedSources,
    derivedMetrics,
    restaurant: matchedRestaurant,
    commercialArea: located && {
      competitorDensity: located.area.marketDynamics.competitorDensity,
      closureRate: located.area.marketDynamics.closureRate,
      areaSalesGrowth: located.area.spending.localSalesGrowth,
      footTrafficGrowth: located.area.footTraffic.growthRate,
    },
    reviews: matchedRestaurant ? db.reviews.filter((review) => review.restaurantId === matchedRestaurant.id) : [],
  }))
  const riskAssessment = matchedRestaurant
    ? assessRestaurant(matchedRestaurant, db.funds.find((item) => item.restaurantId === matchedRestaurant.id))
    : undefined
  const combined = riskAssessment ? combineAssessments(riskAssessment, creditAssessment) : undefined

  strengths.push(`${industry} 업종 35개 지표 중 ${creditAssessment.measuredCount}개를 산정해 신용등급 ${creditAssessment.grade}(${creditAssessment.score}점)이 나왔어요.`)
  if (creditAssessment.topDrivers.length) strengths.push(`가장 크게 기여한 지표는 ${creditAssessment.topDrivers.slice(0, 2).map((item) => item.label).join(', ')}예요.`)
  for (const drag of creditAssessment.topDrags.slice(0, 2)) {
    improvements.push(`${drag.label}이(가) ${industry} 업종 기준으로 하위권(${drag.score}점)이라 등급을 끌어내리고 있어요.`)
  }
  if (creditAssessment.missing.length >= 8) improvements.push(`아직 산정하지 못한 신용지표가 ${creditAssessment.missing.length}개예요. 대출·계좌·재방문 자료를 연결하면 등급 근거가 촘촘해져요.`)

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
    data: { ...data, uploadedDocuments, documentMetadata, connectedSources, sourceProvenance, dataConfidence,
      // 화면은 이름을 아는 지표만 그린다. 집계 중간값이 라벨 없이 새어 나가지 않게 한다.
      derivedMetrics: displayMetrics,
      // 신용평가가 다시 읽어야 하는 전체 집계값과, 어느 파일 몇 행에서 나왔는지의 근거.
      measuredMetrics: derivedMetrics, metricEvidence: aggregated.evidence,
      businessVerification, financialVerification, creditAssessment, combinedAssessment: combined }, strengths, checks, improvements, explanation,
  }
  // 체험 세션은 같은 채점 로직을 쓰되 결과를 공유 원장이 아닌 체험 원장에 남긴다.
  if (req.user!.sessionMode === 'demo') {
    const sandbox = sandboxFor(req.user!.id, 'owner')
    sandbox.applications.unshift(application)
    demoNotification(sandbox, 'application', '체험 심사 완료', `${restaurantName} 예비심사 ${score}점 · 신용등급 ${creditAssessment.grade}`, '/owner')
    return res.status(201).json({ message: '체험 심사가 끝났어요. 결과는 저장되지 않습니다.', application, ephemeral: true, demoNotice: DEMO_NOTICE })
  }
  db.applications.push(application)
  // 감사 로그는 사장님 화면에 그대로 보인다. 내부 코드값 대신 사람이 읽는 말로 남긴다.
  const statusWord = { approved: '펀딩 가능', conditional: '조건부 승인', manual_review: '운영자 확인 필요', rejected: '보완 필요' }[status]
  audit(req.user!.id, 'application.analyzed', 'application', application.id, `${restaurantName} 예비심사 ${statusWord} · ${score}점`)
  audit(req.user!.id, 'application.credit_graded', 'application', application.id,
    `신용등급 ${creditAssessment.grade} (${creditAssessment.score}점) · ${creditAssessment.industry} 업종 · 지표 ${creditAssessment.measuredCount}/${creditAssessment.totalCount} 산정`)
  audit(req.user!.id, 'application.business_verified', 'application', application.id, `사업자 진위확인 ${businessVerification.verified ? '통과' : '보완 필요'}`)
  const verificationWord: Record<string, string> = {
    ready_for_admin: '운영자 확인 준비 완료', mismatch: '값이 서로 맞지 않음',
    needs_documents: '자료 부족', low_confidence: '판독 신뢰도 낮음',
    needs_review: '운영자 확인 필요',
  }
  audit(req.user!.id, 'application.financial_orchestrated', 'application', application.id,
    `자료 대조 ${verificationWord[financialVerification.recommendedStatus] || financialVerification.recommendedStatus} · 문서 ${financialVerification.documentCount}건 · 불일치 ${financialVerification.mismatches.length}건`)
  await saveDatabase(); changed()
  res.status(201).json({ message: '원천데이터 기반 먹투 자동분석이 완료됐어요.', application })
})

app.get('/api/owner', auth('owner'), (req: AuthedRequest, res) => {
  if (req.user!.sessionMode === 'demo') {
    // 체험 사장님에게는 샘플 식당 하나를 빌려주고, 변경분은 샌드박스에만 남긴다.
    const sandbox = sandboxFor(req.user!.id, 'owner')
    const sample = db.restaurants[0]
    const sampleFund = sample && db.funds.find((item) => item.restaurantId === sample.id)
    return res.json({
      restaurants: sample ? [{ ...sample, salesDisclosure: sandbox.salesDisclosure ?? sample.salesDisclosure }] : [],
      funds: sampleFund ? [sampleFund] : [],
      positions: [],
      coupons: sandbox.coupons,
      applications: sandbox.applications,
      auditEvents: [],
      ocrAnalyses: [],
      dataConnections: sandbox.connections.map(({ userId: _unused, ...item }) => item),
      demo: { notice: DEMO_NOTICE },
    })
  }
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
  syncCouponLedger(fund.id)
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
              { type: 'text', text: `문서를 판독해 JSON만 반환하세요. 등록된 자금 사용계획: ${plan}.
스키마의 <> 안은 채워야 할 설명이며, 그 문구를 값으로 그대로 쓰면 안 됩니다.
{"documentType":"<영수증·세금계산서·매출전표·계약서·사업자등록·영업신고·납세증명·부채증명·기타 중 하나>","merchant":"<상호. 없으면 빈 문자열>","businessNumber":"<사업자등록번호. 없으면 빈 문자열>","date":"<문서 기준일 YYYY-MM-DD. 없으면 빈 문자열>","periodStart":"<과세기간 시작일. 없으면 빈 문자열>","periodEnd":"<과세기간 종료일. 없으면 빈 문자열>","total":<대표 금액을 숫자로. 금액이 없으면 null>,"planMatch":"<이 문서가 위 자금 사용계획과 맞는지: 적합·검토 필요·부적합 중 하나. 사용계획과 무관한 서류면 '검토 필요'>","confidence":<0.0~1.0 사이 실수. 이번 판독을 얼마나 확신하는지. 예시값이 아니라 실제 확신도를 넣고 절대 0으로 두지 마세요>,"warnings":["<판독하며 걸린 점. 없으면 빈 배열>"],"rawText":"<읽은 원문>","boundingBoxes":[{"field":"<merchant 또는 businessNumber 또는 date 또는 total 중 정확히 하나만>","label":"<화면에 보여줄 이름>","value":"<그 자리에서 읽은 값>","bbox":[<x>,<y>,<width>,<height>],"confidence":<0.0~1.0>}]}
bbox는 0~1000 기준 [x,y,width,height]이며 이미지 전체를 가리키는 [0,0,1000,1000]은 쓰지 마세요. 읽히지 않는 값은 추측하지 마세요.` },
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
      // 모델이 확신도를 안 주거나 0으로 주면 판정을 보류(0.5)하되 파이프라인은 계속 흐르게 한다.
      // 0을 그대로 흘리면 뒤의 6단계 교차검증이 영영 통과하지 못한다.
      const reportedConfidence = Number(parsed.confidence)
      result = {
        ...parsed,
        confidence: Number.isFinite(reportedConfidence) && reportedConfidence > 0
          ? Math.min(1, reportedConfidence > 1 ? reportedConfidence / 100 : reportedConfidence)
          : .5,
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

type ConsultationAccount = {
  role: Role
  cash: number
  invested: number
  positions: number
  readyCoupons: number
  coupons: Record<string, number>
  openOrders: number
  buyWaiting: number
  sellWaiting: number
  openListings: number
  offersReceived: number
  offersSent: number
  unreadNotifications: number
  favorites: number
}

/**
 * 로그인 사용자의 현재 원장에서 상담에 필요한 집계값만 뽑는다.
 * 쿠폰 코드·상대방·문서 원문처럼 상담에 불필요한 개인정보는 포함하지 않는다.
 */
function consultationAccount(user?: SessionUser): ConsultationAccount | undefined {
  if (!user || user.role === 'admin') return undefined
  if (user.sessionMode === 'demo') {
    const state = demoMeState(user)
    const openOrders = (state.orders as Order[]).filter((item) => ['open', 'partial'].includes(item.status))
    const coupons = state.coupons as Array<Coupon & { status: Coupon['status'] }>
    return {
      role: user.role,
      cash: Number(state.user.cash || 0),
      invested: (state.positions as Position[]).reduce((sum, item) => sum + item.amount, 0),
      positions: state.positions.length,
      readyCoupons: (state.positions as Position[]).filter((item) => item.couponProgress >= 10).length,
      coupons: Object.fromEntries(['available', 'listed', 'offered', 'redeeming', 'used', 'expired'].map((status) => [status, coupons.filter((item) => item.status === status).length])),
      openOrders: openOrders.length,
      buyWaiting: openOrders.filter((item) => item.type === 'buy').reduce((sum, item) => sum + item.remaining, 0),
      sellWaiting: openOrders.filter((item) => item.type === 'sell').reduce((sum, item) => sum + item.remaining, 0),
      openListings: state.exchange.openListings,
      offersReceived: state.exchange.offersReceived,
      offersSent: state.exchange.offersSent,
      unreadNotifications: state.unreadNotifications,
      favorites: state.favoriteRestaurantIds.length,
    }
  }
  const positions = db.positions.filter((item) => item.userId === user.id && item.amount > 0)
  const coupons = db.coupons.filter((item) => item.userId === user.id)
  const openOrders = db.orders.filter((item) => item.userId === user.id && item.remaining > 0 && ['open', 'partial'].includes(item.status))
  return {
    role: user.role,
    cash: user.cash,
    invested: positions.reduce((sum, item) => sum + item.amount, 0),
    positions: positions.length,
    readyCoupons: positions.filter((item) => item.couponProgress >= 10).length,
    coupons: Object.fromEntries(['available', 'listed', 'offered', 'redeeming', 'used', 'expired'].map((status) => [status, coupons.filter((item) => item.status === status).length])),
    openOrders: openOrders.length,
    buyWaiting: openOrders.filter((item) => item.type === 'buy').reduce((sum, item) => sum + item.remaining, 0),
    sellWaiting: openOrders.filter((item) => item.type === 'sell').reduce((sum, item) => sum + item.remaining, 0),
    openListings: db.couponListings.filter((item) => item.userId === user.id && item.status === 'open').length,
    offersReceived: db.couponOffers.filter((offer) => offer.status === 'pending' && db.couponListings.some((listing) => listing.id === offer.listingId && listing.userId === user.id)).length,
    offersSent: db.couponOffers.filter((offer) => offer.offerUserId === user.id && offer.status === 'pending').length,
    unreadNotifications: db.notifications.filter((item) => item.userId === user.id && !item.read).length,
    favorites: db.favorites.filter((item) => item.userId === user.id).length,
  }
}

function isAccountStatusQuestion(question: string) {
  const text = question.replace(/\s/g, '')
  return /(내|나의|보유|잔액|현재).*(쿠폰|머니|잔액|투자금|투자내역|예약|주문|대기|교환제안|알림|찜|관심)|몇(장|건)|쿠폰.*현황|예약.*현황/.test(text)
}

function answerAccountStatusQuestion(question: string, account?: ConsultationAccount) {
  if (!isAccountStatusQuestion(question)) return ''
  if (!account) return '내 투자·쿠폰·예약 거래 현황은 로그인한 뒤 확인할 수 있어요. 오른쪽 위 “로그인”에서 가입한 유형을 고르고 로그인해주세요.'
  const text = question.replace(/\s/g, '')
  const money = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
  const parts: string[] = []
  if (/(머니|잔액|투자금|투자내역)/.test(text)) parts.push(`사용 가능한 먹투머니는 ${money(account.cash)}이고, ${account.positions}개 식당에 총 ${money(account.invested)}을 투자 중이에요.`)
  if (/(쿠폰|몇장)/.test(text)) parts.push(`쿠폰은 사용 가능 ${account.coupons.available || 0}장, 교환 중 ${(account.coupons.listed || 0) + (account.coupons.offered || 0)}장, 매장 확인 대기 ${account.coupons.redeeming || 0}장이에요. 추가로 발급 가능한 투자 혜택은 ${account.readyCoupons}장입니다.`)
  if (/(예약|주문|대기|회수)/.test(text)) parts.push(`예약 주문은 ${account.openOrders}건이며 투자 대기 ${money(account.buyWaiting)}, 회수 대기 ${money(account.sellWaiting)}입니다.`)
  if (/(교환|제안)/.test(text)) parts.push(`교환장 등록 ${account.openListings}건, 받은 제안 ${account.offersReceived}건, 보낸 제안 ${account.offersSent}건이 처리 중이에요.`)
  if (/알림/.test(text)) parts.push(`읽지 않은 알림은 ${account.unreadNotifications}건이에요.`)
  if (/(찜|관심)/.test(text)) parts.push(`관심 식당은 ${account.favorites}곳이에요.`)
  if (!parts.length) parts.push(`현재 ${account.positions}개 식당에 투자 중이고 사용 가능한 쿠폰은 ${account.coupons.available || 0}장, 대기 주문은 ${account.openOrders}건이에요.`)
  parts.push('자세한 내역은 상단 “마이페이지”에서 확인할 수 있어요.')
  return parts.join(' ')
}

type OwnerLedger = {
  restaurantName: string
  fundStatus?: FundStatus
  round: number
  goal: number
  raised: number
  investorCount: number
  couponIssuedWon: number
  couponUsedWon: number
  outstandingCouponWon: number
  redeemingCoupons: number
  usedCoupons: number
  salesDisclosure: boolean
  applicationStatus?: string
  unreadNotifications: number
  openSupport: number
}

/**
 * 사장님 상담의 원장은 개인 지갑이 아니라 "내 가게"다.
 * 투자자용 집계(먹투머니·내 투자금)를 그대로 읽어주면 사장님에게는 아무 의미가 없어서,
 * 모금·투자자·쿠폰 부담처럼 실제로 결정을 바꾸는 값만 따로 모은다.
 */
function ownerLedgerFor(user?: SessionUser): OwnerLedger | undefined {
  if (!user || user.role !== 'owner') return undefined
  const restaurant = user.sessionMode === 'demo'
    ? db.restaurants[0]
    : db.restaurants.find((item) => item.ownerId === user.id)
  if (!restaurant) return undefined
  const fund = db.funds.find((item) => item.restaurantId === restaurant.id)
  const coupons = db.coupons.filter((item) => item.restaurantId === restaurant.id)
  const application = [...db.applications].reverse().find((item) => item.userId === user.id)
  return {
    restaurantName: restaurant.name,
    fundStatus: fund?.status,
    round: fund?.round || 0,
    goal: fund?.goal || 0,
    raised: fund?.raised || 0,
    investorCount: fund?.investorCount || 0,
    couponIssuedWon: fund?.totalCouponIssued || 0,
    couponUsedWon: fund?.totalCouponUsed || 0,
    // 아직 쓰이지 않은 쿠폰의 최대 할인액이 다음 달에 실제로 나갈 수 있는 부담이다.
    outstandingCouponWon: coupons.filter((item) => ['available', 'listed', 'offered', 'redeeming'].includes(item.status)).reduce((sum, item) => sum + item.maxDiscountWon, 0),
    redeemingCoupons: coupons.filter((item) => item.status === 'redeeming').length,
    usedCoupons: coupons.filter((item) => item.status === 'used').length,
    salesDisclosure: Boolean(restaurant.salesDisclosure),
    applicationStatus: application?.status,
    unreadNotifications: db.notifications.filter((item) => item.userId === user.id && !item.read).length,
    openSupport: (db.supportRequests || []).filter((item) => item.userId === user.id && !['answered', 'closed'].includes(item.status)).length,
  }
}

const fundStatusLabel: Record<FundStatus, string> = { funding: '모금 중', trading: '예약 거래 중', closed: '종료' }
const applicationStatusLabel: Record<string, string> = {
  approved: '승인', conditional: '조건부 승인', manual_review: '수동 검토 중', rejected: '보완 필요',
}

/**
 * 사장님은 "투자자 몇 명이야?"처럼 주어 없이 가게 수치를 묻는다.
 * 투자자용 판별식은 "내/보유"를 요구해서 이런 질문을 놓치므로 사장님용을 따로 둔다.
 */
function isOwnerLedgerQuestion(question: string) {
  const text = question.replace(/\s/g, '')
  return isAccountStatusQuestion(question)
    // "목표금액이랑 모인 금액 얼마야?"처럼 목표·모금액을 직접 묻는 문장도 운영 원장 질문이다.
    || /(모금|모집|모인|모였|목표|펀드|펀딩|투자자|쿠폰|매출|부담|배당|정산).*(몇|얼마|현황|상태|됐|남았)/.test(text)
    || /몇(명|곳)/.test(text)
}

function answerOwnerLedgerQuestion(question: string, ledger?: OwnerLedger) {
  if (!isOwnerLedgerQuestion(question)) return ''
  if (!ledger) return '아직 등록된 가게가 없어요. 상단 “사장님 센터”에서 펀딩 신청을 먼저 진행하면 운영 현황을 안내해드릴 수 있어요.'
  const text = question.replace(/\s/g, '')
  const money = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
  const parts: string[] = []
  if (/(쿠폰|몇장)/.test(text)) parts.push(`${ledger.restaurantName}에서 발급된 쿠폰의 최대 할인액은 ${money(ledger.couponIssuedWon)}이고 실제 사용된 금액은 ${money(ledger.couponUsedWon)}이에요. 아직 사용되지 않은 쿠폰 부담은 ${money(ledger.outstandingCouponWon)}, 지금 매장 확인을 기다리는 쿠폰은 ${ledger.redeemingCoupons}장입니다.`)
  if (/(모금|펀드|펀딩|투자금|투자자|목표)/.test(text)) parts.push(`${ledger.round}회차 펀드는 ${ledger.fundStatus ? fundStatusLabel[ledger.fundStatus] : '준비 중'} 상태이고, 목표 ${money(ledger.goal)} 중 ${money(ledger.raised)}이 모였어요. 함께하는 투자자는 ${ledger.investorCount}명입니다.`)
  if (/(심사|승인|신청)/.test(text)) parts.push(ledger.applicationStatus ? `최근 심사 결과는 “${applicationStatusLabel[ledger.applicationStatus] || ledger.applicationStatus}”예요.` : '아직 제출한 심사 신청이 없어요.')
  if (/(매출|공개)/.test(text)) parts.push(`월매출은 현재 투자자에게 ${ledger.salesDisclosure ? '공개' : '비공개'} 상태예요.`)
  if (/알림/.test(text)) parts.push(`읽지 않은 알림은 ${ledger.unreadNotifications}건이에요.`)
  if (/(문의|신고)/.test(text)) parts.push(`처리 중인 내 문의는 ${ledger.openSupport}건이에요.`)
  if (!parts.length) parts.push(`${ledger.restaurantName}의 ${ledger.round}회차 펀드는 목표 ${money(ledger.goal)} 중 ${money(ledger.raised)}이 모였고 투자자는 ${ledger.investorCount}명이에요. 아직 사용되지 않은 쿠폰 부담은 ${money(ledger.outstandingCouponWon)}입니다.`)
  parts.push('자세한 운영 현황은 상단 “사장님 센터”의 운영 대시보드에서 확인할 수 있어요.')
  return parts.join(' ')
}

/**
 * 신용평가 모델 자체를 공개한다. 검증 데이터룸에서 "이 등급이 어떻게 나오는가"를
 * 보여주기 위한 것이고, 특정 사업체 값은 담지 않는다.
 */
app.get('/api/credit/model', (_req, res) => {
  res.json({
    modelVersion: creditModelVersion,
    industries,
    industryProfiles,
    weightSum: Number(featureSpecs.reduce((sum, spec) => sum + spec.weight, 0).toFixed(1)),
    groups: ['신용·부채', '매출·거래', '현금흐름', '운영·상권', '고객·평판'].map((group) => ({
      group,
      weight: Number(featureSpecs.filter((spec) => spec.group === group).reduce((sum, spec) => sum + spec.weight, 0).toFixed(1)),
      features: featureSpecs.filter((spec) => spec.group === group).map((spec) => ({
        key: spec.key, label: spec.label, weight: spec.weight, unit: spec.unit,
        direction: spec.lowerIsBetter ? '낮을수록 좋음' : '높을수록 좋음',
        note: spec.note,
      })),
    })),
    gradeBands: [
      { grade: 'A+', min: 85 }, { grade: 'A', min: 75 }, { grade: 'B+', min: 65 },
      { grade: 'B', min: 55 }, { grade: 'C', min: 45 }, { grade: 'D', min: 0 },
    ],
    overrideRules: [
      '최대 연체일수 90일 이상이면 점수와 무관하게 D',
      '측정 가중치가 50% 미만이면 70점 상한 (상위 등급 보류)',
    ],
    missingHandling: '측정하지 못한 지표는 감점하지 않고 가중치에서 제외한 뒤 나머지로 재정규화',
    references: creditReferences,
    disclaimer: '참고용 예비평가입니다. 금융기관의 공식 신용등급이 아니며 부도확률을 계산하지 않습니다.',
  })
})

/**
 * 점주 AI 경영·신용 진단.
 * 승재 프로젝트의 /api/ai/management-credit-diagnosis 를 먹투 데이터 모델로 옮겼다.
 * 외부 AI가 연결돼 있으면 생성형 답변을, 아니면 같은 근거로 규칙 기반 리포트를 낸다.
 */
app.post('/api/ai/management-credit-diagnosis', auth('owner'), async (req: AuthedRequest, res) => {
  const owned = db.restaurants.filter((item) => item.ownerId === req.user!.id)
  const restaurant = (typeof req.body?.restaurantId === 'string' && owned.find((item) => item.id === req.body.restaurantId)) || owned[0]
  const application = [...db.applications].reverse().find((item) => item.userId === req.user!.id)
  if (!restaurant && !application) {
    return res.status(409).json({ error: '진단할 자료가 아직 없어요. 사장님 센터에서 펀딩 신청을 먼저 진행해주세요.' })
  }

  const fund = restaurant ? db.funds.find((item) => item.restaurantId === restaurant.id) : undefined
  const connections = db.dataConnections.filter((item) => item.userId === req.user!.id)
  // 신용등급을 다시 계산할 때는 화면용으로 추린 값이 아니라 전체 집계값을 써야 한다.
  // (예전 심사 기록에는 measuredMetrics 가 없으므로 derivedMetrics 로 되돌아간다.)
  const derivedMetrics = (application?.data?.measuredMetrics
    || application?.data?.derivedMetrics
    || {}) as Record<string, unknown>
  const connectedSources = Array.isArray(application?.data?.connectedSources)
    ? (application!.data!.connectedSources as unknown[]).map(String)
    : connections.filter((item) => item.status === 'active').map((item) => item.sourceId as string)

  const located = restaurant ? findCommercialArea(restaurant) : undefined
  const industry = toIndustry(restaurant?.category)
  const credit = (application?.data?.creditAssessment as CreditAssessment | undefined) || assessCredit(deriveCreditInput({
    industry, connectedSources, derivedMetrics,
    restaurant,
    commercialArea: located && {
      competitorDensity: located.area.marketDynamics.competitorDensity,
      closureRate: located.area.marketDynamics.closureRate,
      areaSalesGrowth: located.area.spending.localSalesGrowth,
      footTrafficGrowth: located.area.footTraffic.growthRate,
    },
    reviews: restaurant ? db.reviews.filter((review) => review.restaurantId === restaurant.id) : [],
  }))
  const risk = restaurant ? assessRestaurant(restaurant, fund) : undefined
  const combined = risk ? combineAssessments(risk, credit) : undefined
  const situation = ownerSituation({ application, connections, restaurant, fund })

  const strengths = credit.topDrivers.slice(0, 4).map((item) => `${item.label}이(가) ${industry} 업종 기준 상위권(${item.score}점)이라 등급을 올리고 있어요.`)
  const risks = credit.topDrags.slice(0, 4).map((item) => `${item.label}이(가) ${item.score}점으로 낮아 등급을 끌어내리고 있어요.`)
  if (risk?.contextualAlerts?.length) risks.push(...risk.contextualAlerts.slice(0, 2))
  const actions = [...situation.nextActions]
  if (credit.missing.length) actions.push(`아직 산정하지 못한 지표 ${credit.missing.length}개(${credit.missing.slice(0, 3).join(', ')} 등)를 채우면 등급 근거가 촘촘해져요.`)

  const report = {
    headline: `${restaurant?.name || application?.restaurantName || '내 가게'}의 현재 신용등급은 ${credit.grade}(${credit.score}점)이고, 심사는 ${situation.currentStage.total}단계 중 ${situation.currentStage.order}단계예요.`,
    industry,
    industryNote: credit.industryNote,
    grade: credit.grade,
    score: credit.score,
    coverage: credit.coverage,
    measured: `${credit.measuredCount}/${credit.totalCount}개 지표 산정`,
    groups: credit.groups,
    strengths: strengths.length ? strengths : ['현재 산정된 지표에서 뚜렷한 강점 신호를 더 확인할 자료가 필요해요.'],
    risks: risks.length ? risks : ['현재 산정된 지표에서 뚜렷한 고위험 신호는 확인되지 않았어요.'],
    actions: actions.slice(0, 5),
    overrides: credit.overrides,
    notice: '참고용 예비평가입니다. 금융기관의 공식 신용등급이 아니며 대출 승인·거절의 근거가 아닙니다.',
  }

  res.json({
    provider: aiApiUrl && aiApiKey ? 'meoktu-credit-engine+ai' : 'meoktu-credit-engine',
    restaurantId: restaurant?.id ?? null,
    modelVersion: credit.modelVersion,
    report,
    credit,
    risk: risk && { score: risk.score, grade: risk.grade, riskLevel: risk.riskLevel, components: risk.components },
    combined,
    situation,
    references: credit.references,
  })
})

app.post('/api/ai/chat', async (req: AuthedRequest, res) => {
  const question = String(req.body.question || '').slice(0, 800)
  if (!question.trim()) return res.status(400).json({ error: '궁금한 내용을 입력해주세요.' })
  const asker = await userFromAuthorization(req.headers.authorization).catch(() => undefined)
  // 로그인 없이도 상담은 열어두되, 외부 AI 호출 비용이 무제한으로 새지 않도록 IP 단위로 제한한다.
  const caller = asker?.id
    || String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anonymous').split(',')[0].trim()
  if (!rateLimit(`ai:${caller}`, 20, 60_000)) return res.status(429).json({ error: 'AI 상담 요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  const normalizedQuestion = question.replace(/\s/g, '').toLocaleLowerCase('ko')
  // 화면 안내 질문은 묻는 내용에 맞는 역할 그래프를 써야 한다.
  // 투자자로 로그인한 사람이 "펀드 등록은 어디서 해?"라고 물으면 사장님 절차를 봐야 답이 된다.
  const askedRole: Role = asker?.role === 'owner' ? 'owner' : req.body.role === 'owner' ? 'owner' : 'investor'
  const ownerIntent = /(펀딩|펀드)(등록|신청|개설|모집)|사장님|소상공인|자료업로드|서류제출|심사접수|매출공개|영업신고|사업자등록/.test(normalizedQuestion)
  const role: Role = ownerIntent ? 'owner' : askedRole
  const requestedRestaurant = typeof req.body.restaurantId === 'string' ? db.restaurants.find((item) => item.id === req.body.restaurantId) : undefined
  const mentionedRestaurant = db.restaurants.find((item) => normalizedQuestion.includes(item.name.replace(/\s/g, '').toLocaleLowerCase('ko')))
  // 사장님이 "내 심사 어떻게 돼가?"처럼 가게 이름을 빼고 물어도 자기 가게 기준으로 답해야 한다.
  const ownRestaurant = asker?.role === 'owner' ? db.restaurants.find((item) => item.ownerId === asker.id) : undefined
  const graphRestaurant = mentionedRestaurant || requestedRestaurant || ownRestaurant
  const graphFund = graphRestaurant ? db.funds.find((item) => item.restaurantId === graphRestaurant.id) : undefined
  const askerPosition = asker && graphFund ? db.positions.find((item) => item.userId === asker.id && item.fundId === graphFund.id && item.amount > 0) : undefined
  // 심사·신용·제출자료는 해당 사장님 본인 상담에만 붙인다. 투자자나 다른 가게 질문에는 절대 섞지 않는다.
  const ownsGraphRestaurant = Boolean(asker?.role === 'owner' && (!graphRestaurant || graphRestaurant.ownerId === asker.id))
  const application = ownsGraphRestaurant ? [...db.applications].reverse().find((item) => item.userId === asker!.id) : undefined
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
  // 투자자는 개인 지갑 원장을, 사장님은 내 가게 운영 원장을 본다. 서로 섞이면 답이 무의미해진다.
  const ownerRole = asker?.role === 'owner'
  const account = ownerRole ? undefined : consultationAccount(asker)
  const ownerLedger = ownerLedgerFor(asker)
  const accountQuestion = ownerRole ? isOwnerLedgerQuestion(question) : isAccountStatusQuestion(question)
  if (accountQuestion && (account || ownerLedger)) {
    knowledgeGraph.nodes.push({
      id: 'viewer:account', type: 'AccountSummary', label: ownerRole ? '내 가게 운영 현황' : '내 투자자 계정 현황',
      source: 'MEOKTU_ACCOUNT_LEDGER', properties: ownerLedger ? {
        role: 'owner', restaurantName: ownerLedger.restaurantName, fundRound: ownerLedger.round,
        fundStatus: ownerLedger.fundStatus || 'none', goal: ownerLedger.goal, raised: ownerLedger.raised,
        investorCount: ownerLedger.investorCount, couponIssuedWon: ownerLedger.couponIssuedWon,
        couponUsedWon: ownerLedger.couponUsedWon, outstandingCouponWon: ownerLedger.outstandingCouponWon,
        redeemingCoupons: ownerLedger.redeemingCoupons, usedCoupons: ownerLedger.usedCoupons,
        salesDisclosure: ownerLedger.salesDisclosure, applicationStatus: ownerLedger.applicationStatus || 'none',
        unreadNotifications: ownerLedger.unreadNotifications, openSupport: ownerLedger.openSupport,
      } : {
        role: account!.role, cash: account!.cash, invested: account!.invested, positions: account!.positions,
        readyCoupons: account!.readyCoupons, availableCoupons: account!.coupons.available || 0,
        listedCoupons: account!.coupons.listed || 0, offeredCoupons: account!.coupons.offered || 0,
        redeemingCoupons: account!.coupons.redeeming || 0, openOrders: account!.openOrders,
        buyWaiting: account!.buyWaiting, sellWaiting: account!.sellWaiting, openListings: account!.openListings,
        offersReceived: account!.offersReceived, offersSent: account!.offersSent,
        unreadNotifications: account!.unreadNotifications, favorites: account!.favorites,
      },
    })
  }
  // 사장님 개인 상황과 공적 지원제도를 같은 그래프에 올린다.
  // 이게 있어야 "지금 내 심사 어디까지 됐어?", "뭐가 부족해?", "정책자금 받을 수 있어?"에
  // 절차 설명이 아니라 실제 현재값으로 답할 수 있다.
  const ownerConnections = asker?.role === 'owner' ? db.dataConnections.filter((item) => item.userId === asker.id) : []
  const situation = ownsGraphRestaurant
    ? ownerSituation({ application, connections: ownerConnections, restaurant: graphRestaurant, fund: graphFund })
    : undefined
  if (situation) {
    const situationGraph = ownerSituationGraph(situation, graphRestaurant ? `restaurant:${graphRestaurant.id}` : undefined)
    knowledgeGraph.nodes.push(...situationGraph.nodes)
    knowledgeGraph.edges.push(...situationGraph.edges)
  }
  // 35지표 신용등급도 그래프에 올린다. "내 등급 왜 이래요?"에 답하려면 필요하다.
  const storedCredit = application?.data?.creditAssessment as CreditAssessment | undefined
  if (storedCredit) {
    knowledgeGraph.nodes.push({
      id: 'credit:grade', type: 'CreditGrade', label: `신용등급 ${storedCredit.grade} (${storedCredit.score}점)`,
      source: 'MEOKTU_CREDIT_35V',
      properties: {
        industry: storedCredit.industry, grade: storedCredit.grade, score: storedCredit.score,
        measured: `${storedCredit.measuredCount}/${storedCredit.totalCount}`, coverage: storedCredit.coverage,
        topDrivers: storedCredit.topDrivers.slice(0, 3).map((item) => `${item.label} ${item.score}점`).join(', '),
        topDrags: storedCredit.topDrags.slice(0, 3).map((item) => `${item.label} ${item.score}점`).join(', '),
        missingCount: storedCredit.missing.length,
        calibratedProbability: false,
      },
    })
    if (graphRestaurant) knowledgeGraph.edges.push({ from: `restaurant:${graphRestaurant.id}`, relation: 'GRADED_AS', to: 'credit:grade' })
  }

  // 제도 이름을 모른 채 "정부 지원 뭐 있어?"라고 물으면 키워드 매칭이 비는데,
  // 그대로 두면 "제공할 수 없다"고 답해버린다. 지원제도 질문이면 대표 제도라도 근거로 붙인다.
  const matchedPrograms = matchSupportPrograms(question, 3)
  if (!matchedPrograms.length && isSupportQuestion(question)) matchedPrograms.push(...defaultSupportPrograms(3))
  if (matchedPrograms.length) knowledgeGraph.nodes.push(...supportProgramNodes(matchedPrograms))

  const retrievedGraph = retrieveKnowledgeSubgraph(knowledgeGraph, question)
  if (accountQuestion && (account || ownerLedger) && !retrievedGraph.nodes.some((node) => node.id === 'viewer:account')) {
    const accountNode = knowledgeGraph.nodes.find((node) => node.id === 'viewer:account')
    if (accountNode) retrievedGraph.nodes.push(accountNode)
    retrievedGraph.sources.unshift({ id: 'viewer:account', label: ownerRole ? '내 가게 운영 현황' : '내 투자자 계정 현황', type: 'AccountSummary' })
  }
  // 검색에서 밀려나도 사장님 현황·지원제도는 근거에 남긴다. 이게 질문의 핵심일 때가 많다.
  if (situation && isOwnerStatusQuestion(question) && !retrievedGraph.nodes.some((node) => node.id === 'owner:situation')) {
    retrievedGraph.nodes.push(...ownerSituationGraph(situation).nodes as typeof retrievedGraph.nodes)
  }
  for (const program of matchedPrograms) {
    if (!retrievedGraph.nodes.some((node) => node.id === program.id)) {
      retrievedGraph.nodes.push(...supportProgramNodes([program]) as typeof retrievedGraph.nodes)
    }
  }
  // 화면 지도는 별도로 뽑는다. 절차 노드에 밀려서 빠지면 "어디로 가야 해요" 질문이 다시 망가진다.
  const currentPage = pageForRoute(req.body.currentPath)
  const navigation = { ...navigationBrief(question), currentScreen: currentPage ? { name: currentPage.name, route: currentPage.route, purpose: currentPage.purpose, actions: currentPage.actions } : undefined }
  const navigationAnswer = answerNavigationQuestion(question)
  const wantsNavigation = isNavigationQuestion(question) || matchUiTasks(question, 1).length > 0
  const graphAnswer = answerGraphProcessQuestion(question, retrievedGraph)
  const fallback = localAiAnswer(question)
  const accountAnswer = ownerRole ? answerOwnerLedgerQuestion(question, ownerLedger) : answerAccountStatusQuestion(question, account)
  const statusAnswer = situation && isOwnerStatusQuestion(question) ? answerOwnerStatusQuestion(situation) : ''
  const supportAnswer = isSupportQuestion(question) ? answerSupportQuestion(question) : ''
  const currentPageAnswer = currentPage && /(이\s*화면|여기서|현재\s*화면)/.test(question)
    ? `지금 보고 있는 “${currentPage.name}”은 ${currentPage.purpose}입니다. 여기에서 ${currentPage.actions.slice(0, 4).join(', ')}을 할 수 있어요.` : ''
  // 우선순위: 내 현황 > 화면 위치 > 지원제도 > 절차 > 일반 답변.
  // "내 심사 어디까지 됐어?"에 절차 단계를 읊어주면 답이 안 된다.
  // 사장님 질문은 "내 가게 ~"라는 이유만으로 전부 심사 안내에 걸린다.
  // 모금·쿠폰·투자자 같은 운영 수치를 물었으면 심사 단계가 아니라 운영 원장으로 답해야 한다.
  const ownerAsk = question.replace(/\s/g, '')
  const reviewIntent = /(심사|신청|승인|보완|자료|서류|등급|접수|단계)/.test(ownerAsk)
  const opsIntent = /(모금|모집|쿠폰|투자자|매출|부담|목표|배당|정산|알림|문의)/.test(ownerAsk)
  // "내 쿠폰 교환장에 어떻게 올려?"는 현황 집계가 아니라 클릭 순서를 원하는 질문이다.
  // 방법을 묻는 문장이면 원장 요약보다 화면 안내가 먼저다.
  const howToIntent = /(어떻게|어디서|어디에|어디로|어디야|방법|하려면|려면)/.test(ownerAsk)
  // "제안한 쿠폰 다른 데 쓸 수 있어?"는 내 쿠폰 장수를 묻는 게 아니라 교환 규칙을 묻는 질문이다.
  // 규칙을 물었는데 원장 집계를 읽어주면 질문에 답하지 못한 것이 된다.
  const ruleIntent = /(제한|조건|규칙|기준|공식|되나요|되나\?|수있|가능한가|가능해|잠기|에스크로|며칠|얼마나쌓|몇%|몇퍼센트)/.test(ownerAsk)
  const rawLedgerAnswer = ownerRole
    ? (!reviewIntent && opsIntent ? (accountAnswer || statusAnswer) : (statusAnswer || accountAnswer))
    : (accountAnswer || statusAnswer)
  const ledgerAnswer = (howToIntent && wantsNavigation && navigationAnswer) || ruleIntent ? '' : rawLedgerAnswer
  const localAnswer = ledgerAnswer || currentPageAnswer || ((wantsNavigation && navigationAnswer) ? navigationAnswer : (supportAnswer || graphAnswer || fallback))
  // 개인 원장 값은 외부 생성형 서비스로 보내지 않고 서버 원장에서 집계한 답을 그대로 돌려준다.
  if (ledgerAnswer) return res.json({
    answer: localAnswer,
    mode: ownerRole ? 'owner-ledger-local' : 'account-ledger-local',
    provider: 'meoktu-private-ledger',
    sources: retrievedGraph.sources,
    retrieval: { strategy: 'private-ledger-summary', graphVersion: retrievedGraph.graphVersion },
  })
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
            content: `너는 먹투 웹사이트의 친절하고 신중한 한국어 생성형 AI 상담원이다. 실제로 웹사이트를 함께 보며 안내하는 직원처럼 말한다. 현재 상담 역할은 ${role === 'owner' ? '사장님' : '투자자'}이고, 역할에 없는 비공개 정보를 추측하거나 공개하면 안 된다.

[화면 안내 규칙 — 가장 중요]
- "어디로 가야 해요", "어디서 하나요", "어떻게 신청해요" 같은 질문은 **화면 위치 질문**이다. 반드시 아래 '화면 지도'의 menuPath와 steps를 그대로 활용해 "상단 메뉴의 OO을 클릭하세요"처럼 눌러야 할 메뉴와 버튼 이름으로 답한다.
- 심사 절차 정보의 단계 이름(예: '사업체·대표자 등록', '데이터 출처 선택', '제출자료 자동 확인')은 **심사가 진행되는 순서의 이름**이지 화면에 있는 메뉴나 버튼이 아니다. 이것을 "OO 단계로 가셔야 합니다"처럼 이동할 장소인 것처럼 안내하면 안 된다. 절차를 설명할 때는 "심사는 이런 순서로 진행돼요"라고 순서임을 밝힌다.
- 화면 지도에 없는 메뉴, 버튼, 페이지 이름을 지어내지 않는다.
- 화면 지도의 intent(예: '쿠폰 교환하기', '먹투머니 충전하기')는 **기능을 부르는 이름일 뿐 화면에 적힌 메뉴명이 아니다.** 눌러야 할 것을 말할 때는 menuPath와 steps의 따옴표 안 문구만 그대로 인용한다.
- 먹투에는 상담 전화번호나 이메일 창구가 없다. 대신 화면 안에 “1:1 문의” 접수 화면이 있으니, AI가 답할 수 없는 계정·거래 문제는 그 화면으로 안내한다.
- 사장님(소상공인) 기능은 소상공인 계정 로그인이 필요하다는 점을 필요할 때 알려준다.

[내용 규칙]
- 제공된 가상 식당 데이터와 먹투 이용 규칙 안에서만 답한다.
- 데이터에 없는 사실을 지어내지 말고, 모르면 모른다고 말한다.
- sales.visibility가 owner_private이면 정확한 매출액이나 월별 이력을 추측하거나 공개하지 않는다.
- 식당 비교 시 성장률뿐 아니라 재방문율, 운영 이력, 상권 위험, 쿠폰의 실제 사용 가능성을 함께 설명한다.
- 투자 권유, 수익 보장, 원금 보장으로 오해될 표현을 쓰지 않는다. "투자할 만한 가치가 높다", "지금이 기회다" 같은 판단은 하지 말고, 판단 재료(성장률·재방문율·운영 이력·상권 위험)를 보여주고 결정은 사용자에게 맡긴다.
- 투자금은 예금이 아니며 모금 종료 뒤에는 반대 주문이 있어야 1,000원 단위로 회수된다는 점을 필요할 때 명확히 알린다.
- 아래 참고자료를 우선 근거로 사용하되, 원문을 그대로 복사하지 말고 사람이 이해할 문장으로 풀어서 설명한다.

[말투 규칙 — 내부 용어 금지]
- 사용자는 소상공인과 일반 투자자다. 내부 시스템 용어를 답변에 절대 쓰지 않는다.
- 금지어: GraphRAG, 지식그래프, 그래프 검색, 노드, 엣지, 임베딩, 벡터, RAG, 프롬프트, LLM, OpenAI, GPT, OCR, 파싱, 스키마, API, 데이터셋, 모델 버전.
- "그래프에서 검색했습니다", "노드에 따르면", "OCR 검증 결과" 같은 표현 대신 "먹투에 등록된 정보로는", "제출하신 서류를 확인해 보니"처럼 사람이 쓰는 말로 바꾼다.
- 답변 끝에 어떤 기술로 답을 만들었는지 설명하는 문장을 붙이지 않는다.

[사장님 현황 규칙]
- 아래 '사장님 현재 상황'이 있으면 그것이 이 사장님의 실제 지금 상태다. "심사 어떻게 돼가요", "뭐가 부족해요" 같은 질문에는 절차 설명이 아니라 이 값으로 답한다.
- 단계는 "6단계 중 3단계"처럼 숫자로 말하고, 비어 있는 자료는 이름을 그대로 말한다.
- 현황이 없으면 있는 척하지 말고 "아직 접수 전"이라고 말한다.

[지원제도 규칙]
- 아래 '참고 지원제도'는 먹투 밖의 공적 제도다. 사장님이 자금·세금·폐업·보증을 물으면 함께 안내한다.
- 금액·금리·기간은 해마다 바뀌므로 단정하지 말고 "${knowledgeAsOf} 기준이며 확정 조건은 기관 공고를 확인해야 한다"고 덧붙인다.
- 먹투가 이 제도를 대신 신청해주는 것처럼 말하지 않는다.

[형식]
- 답변은 읽기 쉬운 3~7문장. 클릭 순서나 해야 할 일을 안내할 때만 번호 목록을 쓴다.
- 반드시 한국어로만 답한다. 영어 단어를 섞지 않는다.
- 단계 번호는 '사장님 현재 상황'의 stageLabel 값을 그대로 쓴다. 임의로 다른 숫자를 만들지 않는다.

화면 지도(UI 내비게이션): ${JSON.stringify(navigation)}

사장님 현재 상황: ${situation ? JSON.stringify(situation) : '없음(투자자이거나 아직 심사 접수 전)'}

참고 지원제도: ${matchedPrograms.length ? JSON.stringify(matchedPrograms) : '이 질문과 연결된 제도 없음'}

참고자료(먹투 절차·현황 정보): ${JSON.stringify(retrievedGraph)}

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
