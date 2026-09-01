import { useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  Bot, CircleDollarSign, ClipboardCheck, Gift, LayoutDashboard, LifeBuoy,
  MessageSquareWarning, RefreshCw, Search, ShieldCheck, Star, Store, Users,
} from 'lucide-react'
import { api } from './lib/api.ts'
import type { ApplicationResult, Coupon, Fund, MeState, Restaurant, Review, User } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const date = (value: string) => new Date(value).toLocaleDateString('ko-KR')

type AdminApplication = ApplicationResult & { userId: string; owner?: User }
type AdminUser = User & { positions: number; applications: number }
type SupportRequest = {
  id: string; userId: string; userName: string; type: string; subject: string; description: string
  priority: 'normal' | 'high'; status: 'received' | 'in_review' | 'answered' | 'closed'
  answer?: string; createdAt: string; answeredAt?: string
}
type Dashboard = {
  stats: { users: number; owners: number; pendingApplications: number; activeFunds: number; funded: number; openSupport: number; coupons: number }
  users: AdminUser[]; applications: AdminApplication[]; restaurants: Restaurant[]; funds: Fund[]
  reviews: Review[]; support: SupportRequest[]; coupons: Coupon[]
}
type Tab = 'overview' | 'applications' | 'users' | 'restaurants' | 'funds' | 'reviews' | 'support' | 'coupons' | 'ai'

const applicationLabel: Record<ApplicationResult['status'], string> = {
  approved: '승인', conditional: '조건부 승인', manual_review: '관리자 검토', rejected: '보완 필요',
}
const tabItems: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: '운영 현황', icon: LayoutDashboard },
  { id: 'applications', label: '심사 관리', icon: ClipboardCheck },
  { id: 'users', label: '회원 관리', icon: Users },
  { id: 'restaurants', label: '식당 관리', icon: Store },
  { id: 'funds', label: '펀딩 관리', icon: CircleDollarSign },
  { id: 'reviews', label: '리뷰 관리', icon: Star },
  { id: 'support', label: '신고·문의', icon: LifeBuoy },
  { id: 'coupons', label: '쿠폰 관리', icon: Gift },
  { id: 'ai', label: 'AI 운영 점검', icon: Bot },
]

function Empty({ text }: { text: string }) {
  return <div className="admin-empty"><ShieldCheck /><b>{text}</b><p>검색 조건을 바꾸거나 새 데이터가 들어온 뒤 다시 확인해주세요.</p></div>
}

export default function AdminCenter({ me, onLogin, notify }: { me: MeState | null; onLogin: () => void; notify: (message: string) => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const load = async () => {
    if (me?.user.role !== 'admin') return
    try { setDashboard(await api<Dashboard>('/api/admin/dashboard')) }
    catch (error) { notify((error as Error).message) }
  }
  useEffect(() => { void load() }, [me?.user.id, me?.user.role])

  const mutate = async (id: string, path: string, body: Record<string, unknown>, message: string) => {
    setBusy(id)
    try {
      await api(path, { method: 'PATCH', body: JSON.stringify(body) })
      await load(); notify(message)
    } catch (error) { notify((error as Error).message) }
    finally { setBusy('') }
  }

  const filtered = <T,>(items: T[]) => {
    const needle = query.trim().toLocaleLowerCase('ko-KR')
    return needle ? items.filter((item) => JSON.stringify(item).toLocaleLowerCase('ko-KR').includes(needle)) : items
  }

  const aiAlerts = useMemo(() => {
    if (!dashboard) return []
    const alerts: Array<{ level: 'high' | 'medium' | 'low'; title: string; detail: string }> = []
    dashboard.restaurants.filter((item) => item.closingRate >= 10).forEach((item) => alerts.push({ level: 'high', title: `${item.name} 상권 위험 확인`, detail: `참고 폐업률 ${item.closingRate}%로 운영자 확인이 필요합니다.` }))
    dashboard.funds.filter((item) => item.status === 'funding' && item.raised / item.goal < .4).forEach((item) => alerts.push({ level: 'medium', title: `${dashboard.restaurants.find((r) => r.id === item.restaurantId)?.name || '식당'} 펀딩 속도 저조`, detail: `목표 대비 ${Math.round(item.raised / item.goal * 100)}% 모집 상태입니다.` }))
    if (dashboard.stats.openSupport) alerts.push({ level: 'medium', title: '미처리 고객 문의', detail: `${dashboard.stats.openSupport}건의 문의가 운영자 답변을 기다리고 있습니다.` })
    if (!alerts.length) alerts.push({ level: 'low', title: '중대한 운영 경고 없음', detail: '현재 규칙 기반 자동 점검에서 긴급 항목이 발견되지 않았습니다.' })
    return alerts
  }, [dashboard])

  if (me?.user.role !== 'admin') return <div className="page-wrap admin-locked">
    <ShieldCheck /><h1>먹투 관리자 전용</h1><p>운영센터는 관리자 계정에서만 확인할 수 있어요.</p>
    <button className="button" onClick={onLogin}>관리자 데모로 로그인</button>
  </div>
  if (!dashboard) return <div className="admin-loading">운영 데이터를 불러오는 중...</div>

  const overview = <>
    <section className="admin-kpis">
      <article><Users /><span>전체 회원</span><b>{dashboard.stats.users}명</b><small>사장님 {dashboard.stats.owners}명</small></article>
      <article><CircleDollarSign /><span>누적 펀딩</span><b>{won(dashboard.stats.funded)}</b><small>운영 펀드 {dashboard.stats.activeFunds}개</small></article>
      <article><ClipboardCheck /><span>검토 대기</span><b>{dashboard.stats.pendingApplications}건</b><small>전체 심사 {dashboard.applications.length}건</small></article>
      <article><LifeBuoy /><span>미처리 문의</span><b>{dashboard.stats.openSupport}건</b><small>쿠폰 {dashboard.stats.coupons}장</small></article>
    </section>
    <div className="admin-overview-grid">
      <section className="admin-panel"><div className="admin-panel-head"><div><small>실시간 운영</small><h2>우선 확인할 항목</h2></div><MessageSquareWarning /></div>{aiAlerts.slice(0, 4).map((alert) => <article className="admin-alert" key={alert.title}><i className={alert.level} /><div><b>{alert.title}</b><p>{alert.detail}</p></div></article>)}</section>
      <section className="admin-panel"><div className="admin-panel-head"><div><small>최근 접수</small><h2>소상공인 심사</h2></div><ClipboardCheck /></div>{dashboard.applications.slice(0, 4).map((item) => <article className="admin-brief" key={item.id}><div><b>{item.restaurantName}</b><span>{item.owner?.name || '사장님'} · {date(item.submittedAt)}</span></div><em className={item.status}>{applicationLabel[item.status]}</em></article>)}</section>
    </div>
  </>

  const applications = <section className="admin-list">{filtered(dashboard.applications).map((item) => <article className="admin-row-card" key={item.id}>
    <div className="admin-row-main"><span className={`admin-status ${item.status}`}>{applicationLabel[item.status]}</span><div><small>{item.owner?.name || '사장님'} · {date(item.submittedAt)}</small><h3>{item.restaurantName}</h3><p>{item.explanation}</p></div></div>
    <div className="admin-score"><small>AI 점수</small><b>{item.score}</b><span>{won(item.approvedLimit)}</span></div>
    <select disabled={busy === item.id} value={item.status} onChange={(event) => mutate(item.id, `/api/admin/applications/${item.id}`, { status: event.target.value }, '심사 상태를 변경했어요.')}><option value="approved">승인</option><option value="conditional">조건부 승인</option><option value="manual_review">관리자 검토</option><option value="rejected">보완 필요</option></select>
  </article>)}{!filtered(dashboard.applications).length && <Empty text="표시할 심사가 없어요." />}</section>

  const users = <section className="admin-table"><div className="admin-table-head"><span>회원</span><span>유형</span><span>이용 현황</span><span>가입일</span><span>계정</span></div>{filtered(dashboard.users).map((user) => <div className="admin-table-row" key={user.id}><span><b>{user.name}</b><small>{user.email}</small></span><span>{user.role === 'owner' ? '사장님' : '투자자'}</span><span>투자 {user.positions} · 심사 {user.applications}</span><span>{date(user.createdAt)}</span><button disabled={busy === user.id} className={user.accountStatus === 'suspended' ? 'restore' : 'danger'} onClick={() => mutate(user.id, `/api/admin/users/${user.id}`, { accountStatus: user.accountStatus === 'suspended' ? 'active' : 'suspended' }, user.accountStatus === 'suspended' ? '계정을 복구했어요.' : '계정을 이용 정지했어요.')}>{user.accountStatus === 'suspended' ? '정지 해제' : '이용 정지'}</button></div>)}</section>

  const restaurants = <section className="admin-card-grid">{filtered(dashboard.restaurants).map((item) => <article className="admin-entity-card" key={item.id}><div className="admin-entity-icon">{item.emoji}</div><div><small>{item.region} · {item.category}</small><h3>{item.name}</h3><p>월 매출 {won(item.monthlySales)} · 성장 {item.salesGrowth > 0 ? '+' : ''}{item.salesGrowth}%</p></div><button disabled={busy === item.id} onClick={() => mutate(item.id, `/api/admin/restaurants/${item.id}`, { salesDisclosure: !item.salesDisclosure }, item.salesDisclosure ? '매출 공개를 해제했어요.' : '매출 공개를 승인했어요.')}>{item.salesDisclosure ? '매출 공개 중' : '매출 비공개'}</button></article>)}</section>

  const funds = <section className="admin-table"><div className="admin-table-head fund"><span>펀드</span><span>라운드</span><span>모금액</span><span>달성률</span><span>상태</span></div>{filtered(dashboard.funds).map((item) => <div className="admin-table-row fund" key={item.id}><span><b>{dashboard.restaurants.find((r) => r.id === item.restaurantId)?.name || item.restaurantId}</b><small>{item.purpose}</small></span><span>{item.round}차</span><span>{won(item.raised)} / {won(item.goal)}</span><span>{Math.round(item.raised / item.goal * 100)}%</span><select disabled={busy === item.id} value={item.status} onChange={(event) => mutate(item.id, `/api/admin/funds/${item.id}`, { status: event.target.value }, '펀드 상태를 변경했어요.')}><option value="funding">모금 중</option><option value="trading">거래 중</option><option value="closed">종료</option></select></div>)}</section>

  const reviews = <section className="admin-list">{filtered(dashboard.reviews).map((item) => <article className="admin-row-card review" key={item.id}><div className="admin-row-main"><span className={`admin-status ${item.status === 'hidden' ? 'rejected' : 'approved'}`}>{item.status === 'hidden' ? '숨김' : '게시'}</span><div><small>{item.userName} · {date(item.createdAt)} · 별점 {item.rating}</small><h3>{dashboard.restaurants.find((r) => r.id === item.restaurantId)?.name || '식당 리뷰'}</h3><p>{item.content}</p></div></div><button disabled={busy === item.id} className={item.status === 'hidden' ? 'restore' : 'danger'} onClick={() => mutate(item.id, `/api/admin/reviews/${item.id}`, { status: item.status === 'hidden' ? 'published' : 'hidden' }, item.status === 'hidden' ? '리뷰를 다시 게시했어요.' : '리뷰를 숨겼어요.')}>{item.status === 'hidden' ? '다시 게시' : '숨기기'}</button></article>)}{!filtered(dashboard.reviews).length && <Empty text="표시할 리뷰가 없어요." />}</section>

  const support = <section className="admin-list">{filtered(dashboard.support).map((item) => <article className="admin-support-card" key={item.id}><div className="admin-support-head"><span className={`admin-status ${item.priority === 'high' ? 'rejected' : 'manual_review'}`}>{item.priority === 'high' ? '긴급' : item.status}</span><div><small>{item.userName} · {date(item.createdAt)}</small><h3>{item.subject}</h3></div></div><p>{item.description}</p>{item.answer && <blockquote><b>기존 답변</b>{item.answer}</blockquote>}<textarea value={answers[item.id] || ''} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="고객에게 전달할 답변을 입력하세요." /><div><button className="button secondary small" disabled={busy === item.id} onClick={() => mutate(item.id, `/api/admin/support/${item.id}`, { status: 'closed' }, '문의를 종결했어요.')}>종결</button><button className="button small" disabled={busy === item.id || !answers[item.id]?.trim()} onClick={async () => { await mutate(item.id, `/api/admin/support/${item.id}`, { answer: answers[item.id] }, '답변을 전송했어요.'); setAnswers((current) => ({ ...current, [item.id]: '' })) }}>답변 전송</button></div></article>)}{!filtered(dashboard.support).length && <Empty text="접수된 문의가 없어요." />}</section>

  const coupons = <section className="admin-table"><div className="admin-table-head coupon"><span>쿠폰</span><span>소유자</span><span>할인</span><span>만료일</span><span>상태</span></div>{filtered(dashboard.coupons).map((item) => <div className="admin-table-row coupon" key={item.id}><span><b>{item.title}</b><small>{dashboard.restaurants.find((r) => r.id === item.restaurantId)?.name || item.restaurantId}</small></span><span>{dashboard.users.find((u) => u.id === item.userId)?.name || '-'}</span><span>{item.discount}%</span><span>{date(item.expiresAt)}</span><select disabled={busy === item.id || !['available', 'used', 'expired'].includes(item.status)} value={item.status} onChange={(event) => mutate(item.id, `/api/admin/coupons/${item.id}`, { status: event.target.value }, '쿠폰 상태를 변경했어요.')}><option value="available">사용 가능</option>{!['available', 'used', 'expired'].includes(item.status) && <option value={item.status}>{item.status}</option>}<option value="used">사용 완료</option><option value="expired">만료</option></select></div>)}</section>

  const ai = <section className="admin-ai-panel"><div className="admin-ai-intro"><Bot /><div><span>규칙 기반 운영 보조</span><h2>AI 운영 점검</h2><p>상권 위험, 펀딩 진행률, 미처리 문의를 함께 읽어 운영자가 먼저 볼 항목을 정리합니다. 자동 제재나 자동 승인에는 사용하지 않습니다.</p></div></div><div className="admin-ai-alerts">{aiAlerts.map((alert) => <article key={alert.title}><i className={alert.level} /><div><b>{alert.title}</b><p>{alert.detail}</p></div><span>{alert.level === 'high' ? '긴급 확인' : alert.level === 'medium' ? '확인 권장' : '정상'}</span></article>)}</div></section>

  const content: Record<Tab, ReactElement> = { overview, applications, users, restaurants, funds, reviews, support, coupons, ai }
  const current = tabItems.find((item) => item.id === tab)!
  return <div className="admin-hub">
    <aside className="admin-sidebar"><div className="admin-brand"><span className="brand-mark">묵</span><div><b>먹투 운영센터</b><small>MEOKTU ADMIN</small></div></div><nav>{tabItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setQuery('') }}><Icon />{item.label}{item.id === 'support' && dashboard.stats.openSupport > 0 && <em>{dashboard.stats.openSupport}</em>}</button> })}</nav><div className="admin-profile"><ShieldCheck /><div><b>{me.user.name}</b><span>{me.user.email}</span></div></div></aside>
    <main className="admin-main"><header className="admin-topbar"><div><span>운영센터 / {current.label}</span><h1>{current.label}</h1></div><div className="admin-tools">{tab !== 'overview' && tab !== 'ai' && <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름·내용 검색" /></label>}<button onClick={load} aria-label="새로고침"><RefreshCw /></button></div></header>{content[tab]}</main>
  </div>
}
