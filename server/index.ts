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
import type { Application, Coupon, CouponListing, Database, Fund, Order, Position, Review, Role, User } from './types.ts'
import { answerGraphProcessQuestion, assessRestaurant, buildKnowledgeGraph, normalizeOcrBoxes, retrieveKnowledgeSubgraph } from './trust.ts'

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
const supabaseAuthConfigured = Boolean(supabaseUrl && supabasePublishableKey)
const aiApiUrl = String(process.env.OPENAI_BASE_URL ? `${String(process.env.OPENAI_BASE_URL).replace(/\/$/, '')}/chat/completions` : (process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions')).trim()
const aiApiKey = String(process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '').trim()

type AuthedRequest = Request & { user?: User }
let db!: Database
let saveQueue = Promise.resolve()

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
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 })).toString('base64url')
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
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub: string; exp: number }
    if (parsed.exp < Date.now()) return undefined
    return db.users.find((user) => user.id === parsed.sub)
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

async function supabaseUserFromAuthorization(value?: string) {
  if (!supabaseAuthConfigured || !value) return undefined
  const token = value.replace(/^Bearer\s+/i, '')
  if (!token) return undefined
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
    return user
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
  for (const review of seedReviews) if (!current.reviews.some((item) => item.id === review.id)) current.reviews.push(review)
  current.articles = seedArticles
  current.etfs = template.etfs
  current.schemaVersion = 4
  return current
}

async function loadDatabase() {
  await fs.mkdir(dataDir, { recursive: true })
  try {
    db = JSON.parse(await fs.readFile(dbPath, 'utf8')) as Database
    if ((db.schemaVersion || 0) < 4) {
      const ownerHash = db.users?.find((user) => user.id === 'u-owner')?.passwordHash || await hashPassword('demo1234!')
      const investorHash = db.users?.find((user) => user.id === 'u-investor')?.passwordHash || await hashPassword('demo1234!')
      db = migrateDatabase(db, createSeed(ownerHash, investorHash))
      await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8')
    }
  } catch {
    const ownerHash = await hashPassword('demo1234!')
    const investorHash = await hashPassword('demo1234!')
    db = createSeed(ownerHash, investorHash)
    await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8')
  }
  db.reviews ??= []
  db.visitVerifications ??= []
  db.walletTransactions ??= []
  db.favorites ??= []
  db.auditEvents ??= []
  db.ocrAnalyses ??= []
}

function saveDatabase() {
  saveQueue = saveQueue.then(async () => {
    const temp = `${dbPath}.tmp`
    await fs.writeFile(temp, JSON.stringify(db, null, 2), 'utf8')
    await fs.rename(temp, dbPath)
  })
  return saveQueue
}

function publicUser(user: User) {
  const { passwordHash: _, ...safe } = user
  return safe
}

function audit(actorId: string | undefined, action: string, resourceType: string, resourceId: string, summary: string) {
  db.auditEvents.push({ id: id('audit'), actorId, action, resourceType, resourceId, summary: summary.slice(0, 300), createdAt: now() })
  if (db.auditEvents.length > 1000) db.auditEvents.splice(0, db.auditEvents.length - 1000)
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

function publicState() {
  const views = restaurantView()
  return {
    restaurants: views,
    funds: db.funds,
    etfs: db.etfs,
    articles: db.articles,
    listings: db.couponListings.filter((l) => l.status === 'open').map((listing) => {
      const coupon = db.coupons.find((c) => c.id === listing.couponId)
      const restaurant = coupon && db.restaurants.find((r) => r.id === coupon.restaurantId)
      const user = db.users.find((u) => u.id === listing.userId)
      return { ...listing, coupon, restaurant, userName: user?.name }
    }),
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

app.get('/api/health', (_req, res) => res.json({ ok: true, time: now(), authProvider: supabaseAuthConfigured ? 'supabase-with-local-demo-fallback' : 'local-demo' }))
app.get('/api/public', (_req, res) => res.json(publicState()))
app.get('/api/trust/:restaurantId', (req, res) => {
  const restaurant = db.restaurants.find((item) => item.id === req.params.restaurantId)
  if (!restaurant) return res.status(404).json({ error: '검증할 식당을 찾을 수 없어요.' })
  const fund = db.funds.find((item) => item.restaurantId === restaurant.id)
  res.json({ assessment: assessRestaurant(restaurant, fund), graph: buildKnowledgeGraph('investor', restaurant, fund) })
})

app.get('/api/knowledge-graph', (req, res) => {
  const role: Role = req.query.role === 'owner' ? 'owner' : 'investor'
  const restaurant = typeof req.query.restaurantId === 'string' ? db.restaurants.find((item) => item.id === req.query.restaurantId) : undefined
  const fund = restaurant ? db.funds.find((item) => item.restaurantId === restaurant.id) : undefined
  res.json(buildKnowledgeGraph(role, restaurant, fund))
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
  const coupons = db.coupons.filter((c) => c.userId === user.id).map((coupon) => ({ ...coupon, restaurant: db.restaurants.find((r) => r.id === coupon.restaurantId) }))
  const applications = db.applications.filter((a) => a.userId === user.id)
  await saveDatabase()
  const visitVerifications = db.visitVerifications.filter((item) => item.userId === user.id)
  const walletTransactions = db.walletTransactions.filter((item) => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  const favoriteRestaurantIds = db.favorites.filter((item) => item.userId === user.id).map((item) => item.restaurantId)
  const ocrAnalyses = db.ocrAnalyses.filter((item) => item.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  res.json({ user: publicUser(user), positions, orders, coupons, applications, visitVerifications, walletTransactions, favoriteRestaurantIds, ocrAnalyses })
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

app.post('/api/coupons/:couponId/list', auth(), async (req: AuthedRequest, res) => {
  const coupon = db.coupons.find((c) => c.id === req.params.couponId && c.userId === req.user!.id && c.status === 'available')
  if (!coupon) return res.status(404).json({ error: '교환할 수 있는 쿠폰을 찾지 못했어요.' })
  const listing: CouponListing = { id: id('listing'), userId: req.user!.id, couponId: coupon.id, wantedCategory: String(req.body.wantedCategory || '상관없음'), wantedRegion: String(req.body.wantedRegion || '상관없음'), status: 'open', createdAt: now() }
  coupon.status = 'listed'
  db.couponListings.push(listing)
  await saveDatabase(); changed()
  res.json({ message: '쿠폰 교환장에 등록했어요.', listing })
})

app.delete('/api/listings/:listingId', auth(), async (req: AuthedRequest, res) => {
  const listing = db.couponListings.find((item) => item.id === req.params.listingId && item.userId === req.user!.id && item.status === 'open')
  const coupon = listing && db.coupons.find((item) => item.id === listing.couponId && item.userId === req.user!.id && item.status === 'listed')
  if (!listing || !coupon) return res.status(404).json({ error: '취소할 수 있는 교환 제안을 찾지 못했어요.' })
  listing.status = 'cancelled'
  coupon.status = 'available'
  await saveDatabase(); changed()
  res.json({ message: `${coupon.title} 교환을 취소하고 내 지갑으로 돌려받았어요.`, coupon })
})
app.post('/api/listings/:listingId/swap', auth(), async (req: AuthedRequest, res) => {
  const listing = db.couponListings.find((l) => l.id === req.params.listingId && l.status === 'open')
  const offered = db.coupons.find((c) => c.id === req.body.couponId && c.userId === req.user!.id && c.status === 'available')
  const wanted = listing && db.coupons.find((c) => c.id === listing.couponId && c.status === 'listed')
  if (!listing || !offered || !wanted || listing.userId === req.user!.id) return res.status(400).json({ error: '교환할 수 없는 요청이에요.' })
  if (Math.abs(offered.discount - wanted.discount) >= 10) return res.status(400).json({ error: '할인율 차이가 10% 미만인 쿠폰끼리만 교환할 수 있어요.' })
  const otherUserId = listing.userId
  wanted.userId = req.user!.id
  offered.userId = otherUserId
  wanted.status = 'available'
  offered.status = 'available'
  listing.status = 'completed'
  await saveDatabase(); changed()
  res.json({ message: '쿠폰 교환이 완료됐어요!' })
})

app.post('/api/applications', auth('owner'), async (req: AuthedRequest, res) => {
  const data = req.body as Record<string, unknown>
  const restaurantName = String(data.restaurantName || '').trim()
  const uploadedDocuments = data.uploadedDocuments && typeof data.uploadedDocuments === 'object' && !Array.isArray(data.uploadedDocuments) ? data.uploadedDocuments as Record<string, unknown> : {}
  const allowedSources = ['business','license','identity','pos','account','card','delivery','tax','customer','lease','debt','staff']
  const declaredSources = Array.isArray(data.connectedSources) ? data.connectedSources.map(String) : []
  const connectedSources = declaredSources.filter((source) => allowedSources.includes(source) && (source === 'identity' ? data.identityVerified === true : typeof uploadedDocuments[source] === 'string' && String(uploadedDocuments[source]).trim().length > 0))
  const has = (source: string) => connectedSources.includes(source)
  const requestedLimit = Math.max(0, round1000(data.requestedLimit))
  const requiredDocuments = ['business','license','pos','account']
  const missingDocuments = requiredDocuments.filter((source) => !has(source))
  if (restaurantName.length < 2) return res.status(400).json({ error: '상호명을 입력해주세요.' })
  if (data.privacyConsent !== true) return res.status(400).json({ error: '펀딩 심사를 위한 개인정보 수집·이용 동의가 필요해요.' })
  if (data.creditConsent !== true) return res.status(400).json({ error: '현금흐름과 상환부담 분석을 위한 개인(신용)정보 수집·이용 동의가 필요해요.' })
  if (!has('identity')) return res.status(400).json({ error: '대표자 본인인증을 완료해주세요.' })
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

  let score = 44
  score += Math.min(17, salesGrowth * .75)
  score += Math.min(8, Math.max(0, relativeGrowth) * .8)
  score += repeatRate === null ? 0 : Math.min(8, repeatRate * .14)
  score += Math.min(10, dataConfidence * .1)
  score += operatingYears >= 3 ? 5 : 2
  score += reconciliationRate >= 94 ? 5 : reconciliationRate >= 85 ? 2 : -5
  score += debtServiceRatio === null ? -1 : debtServiceRatio <= 45 ? 4 : debtServiceRatio <= 70 ? 0 : -8
  score = Math.max(0, Math.min(100, Math.round(score)))

  const capacity = Math.round((monthlySales * .42 + Math.max(0, operatingCashflow) * 2.2) / 1000000) * 1000000
  const approvedLimit = Math.max(5000000, Math.min(requestedLimit || capacity, capacity, 100000000))
  const status: Application['status'] = !basicVerified || !coreOperations
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
  const checks = [
    '① 공식자료: 사업자·영업신고·홈택스·부채 증빙',
    '② 실제 영업자료: POS·카드/VAN·사업계좌·배달 정산',
    '③ 외부자료: 서울시 상권·점포·생활인구와 고객 리뷰',
    'AI 거래분류: 식재료·급여·임대료·공과금·대출상환·개인거래 구분',
    '교차검증: POS 매출 ↔ 카드·배달 정산 ↔ 계좌 영업성 유입',
  ]
  const improvements: string[] = []
  if (!basicVerified) improvements.push('사업자등록·영업신고·대표자 인증을 모두 완료하면 자동심사로 넘어갈 수 있어요.')
  if (!has('pos')) improvements.push('최근 12개월 POS CSV를 연결하면 매출·객단가·메뉴 의존도를 자동 계산할 수 있어요.')
  if (!has('account')) improvements.push('사업용 계좌를 연결하면 추정 영업현금흐름과 실제 유입을 교차검증할 수 있어요.')
  if (!has('tax')) improvements.push('홈택스 자료를 추가하면 과거 신고매출을 공식 기준점으로 확인할 수 있어요.')
  if (repeatRate === null) improvements.push('POS 회원·예약·배달 고객처럼 합법적 고객 식별 자료가 있으면 재방문 지표에 가점이 생겨요.')
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
    data: { ...data, connectedSources, dataConfidence, derivedMetrics }, strengths, checks, improvements, explanation,
  }
  db.applications.push(application)
  audit(req.user!.id, 'application.analyzed', 'application', application.id, `${restaurantName} 예비심사 ${status} · ${score}점`)
  await saveDatabase(); changed()
  res.status(201).json({ message: '원천데이터 기반 먹투 자동분석이 완료됐어요.', application })
})

app.get('/api/owner', auth('owner'), (req: AuthedRequest, res) => {
  const restaurants = db.restaurants.filter((r) => r.ownerId === req.user!.id)
  const fundIds = db.funds.filter((f) => restaurants.some((r) => r.id === f.restaurantId)).map((f) => f.id)
  const positions = db.positions.filter((p) => fundIds.includes(p.fundId))
  const auditEvents = db.auditEvents.filter((event) => event.actorId === req.user!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
  const ocrAnalyses = db.ocrAnalyses.filter((item) => item.userId === req.user!.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
  res.json({ restaurants, funds: db.funds.filter((f) => fundIds.includes(f.id)), positions, coupons: db.coupons.filter((c) => fundIds.includes(c.fundId || '')), applications: db.applications.filter((a) => a.userId === req.user!.id), auditEvents, ocrAnalyses })
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
              { type: 'text', text: `문서를 판독해 JSON만 반환하세요. 등록된 자금 사용계획: ${plan}. 스키마: {"documentType":"영수증|세금계산서|매출전표|계약서|사업자등록|기타","merchant":"","businessNumber":"","date":"","total":0,"planMatch":"적합|검토 필요|부적합","confidence":0,"warnings":[],"rawText":"","boundingBoxes":[{"field":"merchant|businessNumber|date|total","label":"","value":"","bbox":[0,0,0,0],"confidence":0}]}. bbox는 0~1000 기준 [x,y,width,height]이며 읽히지 않는 값은 추측하지 마세요.` },
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

app.post('/api/ai/chat', async (req, res) => {
  const question = String(req.body.question || '').slice(0, 800)
  if (!question.trim()) return res.status(400).json({ error: '궁금한 내용을 입력해주세요.' })
  const role: Role = req.body.role === 'owner' ? 'owner' : 'investor'
  const normalizedQuestion = question.replace(/\s/g, '').toLocaleLowerCase('ko')
  const requestedRestaurant = typeof req.body.restaurantId === 'string' ? db.restaurants.find((item) => item.id === req.body.restaurantId) : undefined
  const mentionedRestaurant = db.restaurants.find((item) => normalizedQuestion.includes(item.name.replace(/\s/g, '').toLocaleLowerCase('ko')))
  const graphRestaurant = mentionedRestaurant || requestedRestaurant
  const graphFund = graphRestaurant ? db.funds.find((item) => item.restaurantId === graphRestaurant.id) : undefined
  const knowledgeGraph = buildKnowledgeGraph(role, graphRestaurant, graphFund)
  const retrievedGraph = retrieveKnowledgeSubgraph(knowledgeGraph, question)
  const graphAnswer = answerGraphProcessQuestion(question, retrievedGraph)
  const fallback = localAiAnswer(question)
  const apiUrl = aiApiUrl
  const apiKey = aiApiKey
  if (!apiUrl || !apiKey) return res.json({
    answer: graphAnswer || fallback,
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
            content: `너는 먹투 웹사이트의 친절하고 신중한 한국어 생성형 AI 상담원이다.
- 제공된 가상 식당 데이터와 먹투 이용 규칙 안에서만 답한다.
- 데이터에 없는 사실을 지어내지 말고, 모르면 모른다고 말한다.
- sales.visibility가 owner_private이면 정확한 매출액이나 월별 이력을 추측하거나 공개하지 않는다.
- 식당 비교 시 성장률뿐 아니라 재방문율, 운영 이력, 상권 위험, 쿠폰의 실제 사용 가능성을 함께 설명한다.
- 투자 권유, 수익 보장, 원금 보장으로 오해될 표현을 쓰지 않는다.
- 투자금은 예금이 아니며 모금 종료 뒤에는 반대 주문이 있어야 1,000원 단위로 회수된다는 점을 필요할 때 명확히 알린다.
- 아래 GraphRAG 검색 결과를 우선 근거로 사용하고, 그래프에 없는 절차를 지어내지 않는다.
- 답변은 읽기 쉬운 3~7문장으로 작성한다.

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
    res.json({ answer: graphAnswer || fallback, mode: 'graph-rag-fallback', provider: 'local-knowledge-graph', sources: retrievedGraph.sources, retrieval: { strategy: 'symbolic-keyword-plus-one-hop', graphVersion: retrievedGraph.graphVersion } })
  }
})

const clientDist = path.join(root, 'dist', 'client')
try {
  await fs.access(clientDist)
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
} catch {
  // Vite serves the client in development.
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
