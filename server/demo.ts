/**
 * 체험 모드 샌드박스.
 *
 * 지금까지 체험 세션은 GET과 AI 상담·문서 판독만 되고 나머지는 전부 403이었다.
 * 그래서 "투자해보기", "쿠폰 받아보기", "기관 연결해보기"를 눌러도 막힌 화면만 봤고,
 * 서비스가 무엇을 하는 곳인지 알 수 없었다.
 *
 * 여기서는 체험 세션마다 메모리 위에 자기만의 원장을 하나 만든다.
 * 이 원장은 db.json에 저장되지 않고, 다른 사용자에게 보이지 않으며,
 * 서버가 재시작되거나 만료 시간이 지나면 사라진다.
 * 그래서 "공유 원장은 절대 건드리지 않는다"는 원래 규칙을 지키면서도
 * 체험자가 실제 버튼을 눌러 결과를 볼 수 있다.
 */

import type {
  Application, Coupon, CouponListing, CouponOffer, CouponTrade, DataConnection,
  LegalConsent, Notification, Position, Review, Role, VisitVerification, WalletTransaction,
} from './types.ts'

/** 4시간. 체험 토큰의 만료 시간과 맞춘다. */
const TTL = 1000 * 60 * 60 * 4
/** 한 서버가 들고 있을 체험 세션 수 상한. 넘으면 오래된 것부터 버린다. */
const MAX_SESSIONS = 400

export type DemoSandbox = {
  id: string
  role: Role
  createdAt: number
  touchedAt: number
  cash: number
  positions: Position[]
  coupons: Coupon[]
  listings: CouponListing[]
  offers: CouponOffer[]
  trades: CouponTrade[]
  reviews: Review[]
  visits: VisitVerification[]
  favorites: string[]
  connections: DataConnection[]
  applications: Application[]
  notifications: Notification[]
  walletTransactions: WalletTransaction[]
  /** 체험에서도 위험고지 동의를 똑같이 받고 남긴다. 세션이 끝나면 함께 사라진다. */
  consents: LegalConsent[]
  /** 체험 투자로 늘어난 것처럼 보여줄 펀드별 금액. 실제 펀드는 그대로다. */
  fundDeltas: Record<string, number>
  /** 사장님 체험에서 매출 공개 토글 상태. */
  salesDisclosure?: boolean
  /** 가입 축하 쿠폰을 이미 넣어줬는지. 세션당 한 번만 넣는다. */
  welcomed?: boolean
  /**
   * 운영자 체험에서 누른 상태 변경.
   *
   * 관리자 화면은 투자자·사장님 화면과 달리 '공유 원장 그 자체'를 다룬다.
   * 그래서 예전처럼 진짜 운영자 계정으로 체험 로그인을 시키면,
   * 체험하러 들어온 사람이 실제 회원을 이용정지시키고 실제 심사를 승인·거절해버린다.
   * 여러 명이 동시에 들어오면 서로의 변경을 덮어쓰기까지 한다.
   * 그래서 체험 운영자의 변경은 원장에 쓰지 않고 이 덮개에만 담아,
   * 그 세션의 화면에서만 반영된 것처럼 보이게 한다.
   */
  adminOverrides: AdminOverrides
}

/** 체험 운영자가 바꾼 값. 키는 각 항목의 id 다. */
export type AdminOverrides = {
  applications: Record<string, string>
  users: Record<string, 'active' | 'suspended'>
  restaurants: Record<string, boolean>
  funds: Record<string, string>
  reviews: Record<string, 'published' | 'hidden'>
  coupons: Record<string, string>
  support: Record<string, { status: string; answer?: string; answeredAt?: string }>
}

const emptyAdminOverrides = (): AdminOverrides => ({
  applications: {}, users: {}, restaurants: {}, funds: {}, reviews: {}, coupons: {}, support: {},
})

const sandboxes = new Map<string, DemoSandbox>()

const sweep = () => {
  const deadline = Date.now() - TTL
  for (const [key, sandbox] of sandboxes) if (sandbox.touchedAt < deadline) sandboxes.delete(key)
  if (sandboxes.size > MAX_SESSIONS) {
    const oldest = [...sandboxes.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)
    for (const [key] of oldest.slice(0, sandboxes.size - MAX_SESSIONS)) sandboxes.delete(key)
  }
}

/** 체험 세션의 원장을 가져온다. 없으면 시작 자산과 함께 만든다. */
export function sandboxFor(id: string, role: Role): DemoSandbox {
  sweep()
  const existing = sandboxes.get(id)
  if (existing) {
    existing.touchedAt = Date.now()
    return existing
  }
  const created: DemoSandbox = {
    id, role, createdAt: Date.now(), touchedAt: Date.now(),
    // 체험자가 첫 화면에서 바로 투자 버튼을 눌러볼 수 있게 시작 잔액을 준다.
    cash: role === 'investor' ? 300_000 : 0,
    positions: [], coupons: [], listings: [], offers: [], trades: [],
    reviews: [], visits: [], favorites: [], connections: [],
    applications: [], notifications: [], walletTransactions: [], consents: [],
    fundDeltas: {},
    adminOverrides: emptyAdminOverrides(),
  }
  sandboxes.set(id, created)
  return created
}

export function sandboxExists(id: string) {
  return sandboxes.has(id)
}

export function resetSandbox(id: string) {
  sandboxes.delete(id)
}

export function sandboxCount() {
  sweep()
  return sandboxes.size
}

let counter = 0
/** 체험 원장 안에서만 쓰는 id. 실제 원장 id와 섞이지 않게 접두어를 붙인다. */
export function demoId(prefix: string) {
  counter += 1
  return `demo-${prefix}-${Date.now().toString(36)}-${counter}`
}

/** 체험 응답에 항상 붙는 안내. UI가 이 문구로 "저장 안 됨"을 알린다. */
export const DEMO_NOTICE = '체험 모드 결과예요. 이 기록은 저장되지 않고 브라우저를 닫거나 4시간이 지나면 사라집니다.'

export function demoNotification(sandbox: DemoSandbox, type: string, title: string, body: string, link?: string) {
  const notification: Notification = {
    id: demoId('notify'), userId: sandbox.id, type, title, body, link, read: false, createdAt: new Date().toISOString(),
  }
  sandbox.notifications.unshift(notification)
  sandbox.notifications = sandbox.notifications.slice(0, 30)
  return notification
}

export type { Coupon, CouponListing, CouponOffer, CouponTrade, LegalConsent, Position, Review, VisitVerification }
