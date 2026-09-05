import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import {
  ArrowRight, Bell, Building2, Check, ChevronRight, CircleDollarSign,
  HandCoins, Heart, LogOut, MapPin, Menu, MessageCircleQuestion, Search,
  ScrollText, ShieldCheck, Sparkles, Store, Ticket, TrendingUp, UserRound, Users, WalletCards, X,
} from 'lucide-react'
import { api, clearToken, getToken, setToken } from './lib/api.ts'
import MarketPage from './MarketPage.tsx'
import CouponWallet from './CouponWallet.tsx'
import NotificationBell from './NotificationBell.tsx'
import FundDetailModal from './FundDetailModal.tsx'
import InsightPage from './InsightPage.tsx'
import OwnerCenter from './OwnerCenter.tsx'
import OwnerMyPage from './OwnerMyPage.tsx'
import NearbyMap from './NearbyMap.tsx'
import AdminCenter from './AdminCenter.tsx'
import WalletTopup from './WalletTopup.tsx'
import SupportPage from './SupportPage.tsx'
import FloatingAiChat from './FloatingAiChat.tsx'
import LegalCenter, { LegalDocModal, useLegalIndex } from './LegalCenter.tsx'
import './ux-improvements.css'
import type { ApplicationResult, AppNotification, MeState, Position, PublicState, Restaurant, Role, User } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const compactWon = (value: number) => value >= 100000000 ? `${(value / 100000000).toFixed(1)}억원` : `${Math.round(value / 10000).toLocaleString()}만원`
const shortDate = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

function App() {
  const [state, setState] = useState<PublicState | null>(null)
  const [me, setMe] = useState<MeState | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [selected, setSelected] = useState<Restaurant | null>(null)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()
  const adminRoute = location.pathname.startsWith('/admin')
  const ownerOnly = me?.user.role === 'owner'

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  const refresh = async () => {
    try {
      const publicData = await api<PublicState>('/api/public')
      setState(publicData)
      if (getToken()) {
        try { setMe(await api<MeState>('/api/me')) }
        catch { clearToken(); setMe(null) }
      }
    } finally {
      // 통신이 실패해도 로딩 화면에 갇히지 않게 한다.
      setLoading(false)
    }
  }

  useEffect(() => {
    const reload = () => refresh().catch(() => undefined)
    reload()
    // 로컬·단일 서버에서는 소켓으로 즉시 반영된다.
    const socket = io({ reconnectionAttempts: 3, timeout: 4000 })
    socket.on('state:changed', reload)
    // 서버리스(Vercel)처럼 소켓을 못 여는 환경에서는 폴링과 포커스 복귀로 다른 사람의 변경을 따라잡는다.
    const timer = window.setInterval(() => {
      if (!socket.connected && document.visibilityState === 'visible') reload()
    }, 15000)
    const onFocus = () => { if (!socket.connected) reload() }
    window.addEventListener('focus', onFocus)
    return () => { socket.disconnect(); window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [])

  // 체험 세션도 그대로 진행시킨다. 서버가 공유 원장 대신 체험 원장에 기록한다.
  const requireLogin = (callback?: () => void) => {
    if (!me) { setAuthOpen(true); return false }
    callback?.()
    return true
  }

  const onAuth = async (token: string, destination?: string) => {
    setToken(token)
    setAuthOpen(false)
    await refresh()
    if (destination) navigate(destination)
    notify('반가워요! 먹투에 로그인했어요.')
  }

  const logout = () => {
    clearToken(); setMe(null); navigate('/'); notify('안전하게 로그아웃했어요.')
  }

  const transact = async (kind: 'invest' | 'withdraw', fundId: string, amount: number) => {
    if (!requireLogin()) return
    try {
      const result = await api<{ message: string }>(`/api/funds/${fundId}/${kind}`, { method: 'POST', body: JSON.stringify({ amount }) })
      notify(result.message); await refresh()
    } catch (error) { notify((error as Error).message) }
  }

  const toggleFavorite = async (restaurant: Restaurant) => {
    if (!requireLogin()) return
    const saved = me?.favoriteRestaurantIds.includes(restaurant.id)
    try {
      const result = await api<{ message: string }>(`/api/favorites/${restaurant.id}`, { method: saved ? 'DELETE' : 'PUT' })
      notify(result.message); await refresh()
    } catch (error) { notify((error as Error).message) }
  }

  if (loading || !state) return <div className="loading-screen"><span className="brand-mark">묵</span><p>맛있는 기회를 찾는 중...</p></div>

  return (
    <div className="app-shell">
      {!adminRoute && <Header user={me?.user} notifications={me?.notifications || []} unread={me?.unreadNotifications || 0} refresh={refresh} onLogin={() => setAuthOpen(true)} onLogout={logout} />}
      <main>
        <Routes>
          {ownerOnly ? <>
            <Route path="/owner" element={<OwnerCenter me={me} onLogin={() => setAuthOpen(true)} refresh={refresh} notify={notify} />} />
            <Route path="/owner/my" element={<OwnerMyPage me={me} refresh={refresh} notify={notify} />} />
            <Route path="/legal" element={<LegalCenter me={me} />} />
            <Route path="/legal/:documentId" element={<LegalCenter me={me} />} />
            <Route path="/support" element={<SupportPage me={me} state={state} onLogin={() => setAuthOpen(true)} notify={notify} />} />
            <Route path="*" element={<Navigate to="/owner" replace />} />
          </> : <>
            <Route path="/" element={<Home state={state} onSelect={setSelected} onExplore={() => navigate('/discover')} favoriteIds={me?.favoriteRestaurantIds || []} onFavorite={toggleFavorite} />} />
            <Route path="/discover" element={<Discover restaurants={state.restaurants} onSelect={setSelected} favoriteIds={me?.favoriteRestaurantIds || []} onFavorite={toggleFavorite} />} />
            <Route path="/market" element={<MarketPage state={state} me={me} requireLogin={requireLogin} onSelect={setSelected} refresh={refresh} notify={notify} />} />
            <Route path="/insight" element={<InsightPage state={state} onSelect={setSelected} />} />
            <Route path="/owner" element={<OwnerCenter me={me} onLogin={() => setAuthOpen(true)} refresh={refresh} notify={notify} />} />
            <Route path="/admin" element={<AdminCenter me={me} onLogin={() => setAuthOpen(true)} notify={notify} />} />
            <Route path="/my" element={<MyPage me={me} state={state} restaurants={state.restaurants} requireLogin={requireLogin} onSelect={setSelected} transact={transact} refresh={refresh} notify={notify} />} />
            <Route path="/support" element={<SupportPage me={me} state={state} onLogin={() => setAuthOpen(true)} notify={notify} />} />
            <Route path="/legal" element={<LegalCenter me={me} />} />
            <Route path="/legal/:documentId" element={<LegalCenter me={me} />} />
            <Route path="*" element={<NotFound />} />
          </>}
        </Routes>
      </main>
      {!adminRoute && !ownerOnly && <Footer />}
      {!adminRoute && <MobileNav user={me?.user} />}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuth={onAuth} notify={notify} />}
      {!ownerOnly && selected && <FundDetailModal restaurant={state.restaurants.find((r) => r.id === selected.id) || selected} me={me} onClose={() => setSelected(null)} onLogin={() => setAuthOpen(true)} refresh={refresh} notify={notify} />}
      {toast && <div className="toast"><Check size={18} />{toast}</div>}
      {!adminRoute && <FloatingAiChat role={me?.user.role || 'investor'} />}
    </div>
  )
}

function Header({ user, notifications, unread, refresh, onLogin, onLogout }: { user?: User; notifications: AppNotification[]; unread: number; refresh: () => Promise<void>; onLogin: () => void; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMenuOpen(false), [location.pathname])
  return <header className="site-header">
    <div className="header-inner">
      <NavLink to={user?.role === 'owner' ? '/owner' : '/'} className="logo"><span className="brand-mark">묵</span><span>먹투<small>먹는 투자의 시작</small></span></NavLink>
      <nav className={menuOpen ? 'desktop-nav open' : 'desktop-nav'}>
        {user?.role === 'admin' ? <NavLink to="/admin">운영센터</NavLink> : user?.role === 'owner' ? <><NavLink to="/owner">사장님 센터</NavLink><NavLink to="/owner/my">마이페이지</NavLink><NavLink to="/support">신고·문의</NavLink></> : <><NavLink to="/discover">식당 발견</NavLink><NavLink to="/market">거래장</NavLink><NavLink to="/insight">AI 인사이트</NavLink><NavLink to="/support">신고·문의</NavLink>{user?.role === 'investor' && <NavLink to="/my">마이페이지</NavLink>}</>}
      </nav>
      <div className="header-actions">
        {user ? <NotificationBell notifications={notifications} unread={unread} refresh={refresh} /> : <button className="icon-button hide-mobile" aria-label="알림" onClick={onLogin}><Bell size={20} /></button>}
        {user ? <div className="user-menu"><NavLink to={user.role === 'admin' ? '/admin' : user.role === 'owner' ? '/owner/my' : '/my'} className="avatar">{user.name.slice(0, 1)}</NavLink><div className="user-copy hide-mobile"><b>{user.name}</b><span>{user.role === 'admin' ? '관리자' : user.sessionMode === 'demo' ? `체험 모드 · ${user.role === 'owner' ? '사장님' : compactWon(user.cash)}` : user.role === 'owner' ? '사장님' : compactWon(user.cash)}</span></div><button className="icon-button hide-mobile" onClick={onLogout} aria-label="로그아웃"><LogOut size={18} /></button></div> : <button className="button small" onClick={onLogin}>로그인</button>}
        <button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="메뉴">{menuOpen ? <X /> : <Menu />}</button>
      </div>
    </div>
  </header>
}

function MobileNav({ user }: { user?: User }) {
  return <nav className={`mobile-nav ${user?.role === 'owner' ? 'owner-mobile-nav' : ''}`}>
    {user?.role === 'admin' ? <NavLink to="/admin"><ShieldCheck /><span>운영</span></NavLink> : user?.role === 'owner' ? <><NavLink to="/owner"><Building2 /><span>센터</span></NavLink><NavLink to="/owner/my"><UserRound /><span>MY</span></NavLink><NavLink to="/support"><MessageCircleQuestion /><span>문의</span></NavLink></> : <><NavLink to="/discover"><Search /><span>발견</span></NavLink><NavLink to="/market"><ArrowRight /><span>거래</span></NavLink><NavLink to="/insight"><Sparkles /><span>AI</span></NavLink><NavLink to="/support"><MessageCircleQuestion /><span>문의</span></NavLink>{user?.role === 'investor' ? <NavLink to="/my"><UserRound /><span>MY</span></NavLink> : <NavLink to="/"><Store /><span>홈</span></NavLink>}</>}
  </nav>
}

function Home({ state, onSelect, onExplore, favoriteIds, onFavorite }: { state: PublicState; onSelect: (r: Restaurant) => void; onExplore: () => void; favoriteIds: string[]; onFavorite: (r: Restaurant) => void }) {
  const featured = [...state.restaurants].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 4)
  return <>
    <section className="hero section-pad">
      <div className="hero-copy">
        <span className="eyebrow coral"><Sparkles size={15} /> 오늘의 단골이, 내일의 투자자로</span>
        <h1>좋아하는 식당의 성장을<br /><em>함께 먹어요.</em></h1>
        <p>실제 고객의 응원이 소상공인의 자금이 되고,<br className="hide-mobile" /> 그 성장은 맛있는 쿠폰으로 돌아옵니다.</p>
        <div className="hero-actions"><button className="button large" onClick={onExplore}>식당 둘러보기 <ArrowRight size={18} /></button><NavLink className="button secondary large" to="/owner">펀딩 시작하기</NavLink></div>
        <div className="trust-row"><span><ShieldCheck /> 35지표 먹투 성장성 예비평가</span><span><CircleDollarSign /> 1천원 단위 거래</span><span><Users /> 먹투 자체 1% 한도</span></div>
      </div>
      <div className="hero-visual">
        <div className="ticker-card ticker-main">
          <div className="ticker-top"><div className="food-avatar coral-bg">🍚</div><div><span>망원동 · 한식</span><b>소복소복</b></div><span className="up-pill"><TrendingUp />18.4%</span></div>
          <div className="chart-bars">{[28,42,36,55,48,69,62,78,73,92,88,100].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
          <div className="ticker-bottom"><div><span>모인 금액</span><b>2,376만원</b></div><div><span>최대 쿠폰</span><b className="coral-text">40%</b></div></div>
        </div>
        <div className="floating-card float-coupon"><span>🎟️</span><div><small>오늘 쌓인 혜택</small><b>+0.74%</b></div></div>
        <div className="floating-card float-user"><div className="mini-faces"><span>🥰</span><span>😋</span><span>🤤</span></div><div><b>347명</b><small>이 함께 응원 중</small></div></div>
        <div className="hero-blob blob-one" /><div className="hero-blob blob-two" />
      </div>
    </section>
    <section className="stat-strip"><div><b>{compactWon(state.stats.funded)}</b><span>누적 펀딩</span></div><i /><div><b>{state.stats.supporters.toLocaleString()}명</b><span>동네 투자자</span></div><i /><div><b>{state.stats.restaurants}곳</b><span>함께하는 식당</span></div><i /><div><b>{compactWon(state.stats.couponUsed)}</b><span>사용된 쿠폰 혜택</span></div></section>
    <section className="content-section">
      <SectionTitle eyebrow="지금 뜨는 맛집" title="데이터가 먼저 알아본 식당" description="매출 성장과 단골의 지지를 함께 봤어요." action={<NavLink to="/discover">전체 보기 <ChevronRight /></NavLink>} />
      <div className="restaurant-grid">{featured.map((r, i) => <RestaurantCard key={r.id} restaurant={r} rank={i + 1} onClick={() => onSelect(r)} favorite={favoriteIds.includes(r.id)} onFavorite={() => onFavorite(r)} />)}</div>
    </section>
    <section className="how-section content-section">
      <SectionTitle eyebrow="어떻게 작동하나요?" title="응원은 간단하고, 혜택은 차곡차곡" align="center" />
      <div className="steps-grid">
        <Step icon="🔎" number="01" title="진짜 단골 맛집 발견" text="매출과 상권, 실제 고객의 재방문 데이터를 살펴봐요." />
        <Step icon="💸" number="02" title="1천원부터 응원 투자" text="한 식당 최대 1%까지 참여해요. 이는 먹투의 투기 방지 규칙이며 법정 투자한도를 대신하지 않아요." />
        <Step icon="🎟️" number="03" title="할인율이 매일 차곡차곡" text="투자액과 성장에 따라 쿠폰 혜택이 매일 쌓여요." />
        <Step icon="🤝" number="04" title="필요할 때 투자 회수" text="모금 후엔 새 투자자와 1천원씩 자동 매칭돼요." />
      </div>
    </section>
    <section className="owner-banner content-section"><div><span className="eyebrow light"><Building2 /> 사장님이신가요?</span><h2>은행이 놓친 성장성,<br />단골은 알고 있어요.</h2><p>매출 규모만으로 평가하지 않습니다. 성장 흐름과 실제 고객의 지지를 함께 봐요.</p><NavLink to="/owner" className="button cream large">내 식당 가능성 확인하기 <ArrowRight /></NavLink></div><div className="owner-score-card"><span>먹투 성장 가능성</span><strong>82<small>/100</small></strong><div className="score-track"><i style={{ width: '82%' }} /></div><ul><li><Check /> 단골 재방문율 상위 12%</li><li><Check /> 최근 6개월 매출 꾸준한 상승</li><li><Check /> 상권 유동인구 전년비 +9.2%</li></ul></div></section>
    <section className="risk-note content-section"><ShieldCheck /><div><b>꼭 알아두세요</b><p>먹투의 투자금은 예금이 아니며 원금과 회수 시점이 보장되지 않습니다. 쿠폰은 식당이 제공하는 혜택이며 금융 수익이 아닙니다. 분산해서, 직접 방문할 식당을 중심으로 응원해 주세요.</p></div></section>
  </>
}

function SectionTitle({ eyebrow, title, description, action, align }: { eyebrow: string; title: string; description?: string; action?: ReactNode; align?: string }) {
  return <div className={`section-title ${align || ''}`}><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="section-action">{action}</div>}</div>
}

function Step({ icon, number, title, text }: { icon: string; number: string; title: string; text: string }) {
  return <article className="step-card"><span className="step-number">{number}</span><span className="step-icon">{icon}</span><h3>{title}</h3><p>{text}</p></article>
}

function RestaurantCard({ restaurant: r, onClick, rank, favorite, onFavorite }: { restaurant: Restaurant; onClick: () => void; rank?: number; favorite?: boolean; onFavorite?: () => void }) {
  const progress = Math.min(100, Math.round(r.fund.raised / r.fund.goal * 100))
  return <article className="restaurant-card" role="button" tabIndex={0} onClick={onClick} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onClick() }}>
    <div className="restaurant-cover" style={{ background: `linear-gradient(145deg, ${r.color}20, ${r.color}55)` }}><span className="big-food">{r.emoji}</span>{rank && <span className="rank-badge">{rank}</span>}<span className={`status-badge ${r.fund.status}`}>{r.fund.status === 'funding' ? '모금 중' : '거래 가능'}</span><button className={`heart-button ${favorite ? 'saved' : ''}`} aria-label={favorite ? '찜 해제' : '찜'} onClick={(event) => { event.stopPropagation(); onFavorite?.() }}><Heart fill={favorite ? 'currentColor' : 'none'} /></button></div>
    <div className="restaurant-body"><span className="meta"><MapPin /> {r.neighborhood} · {r.category}</span><div className="card-title"><h3>{r.name}</h3><span><TrendingUp /> {r.salesGrowth}%</span></div><p>{r.tagline}</p><div className="tag-row">{r.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="fund-progress"><div><span>{r.fund.status === 'funding' ? `${progress}% 달성` : '펀딩 완료'}</span><b>{compactWon(r.fund.raised)}</b></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div><small>{r.fund.investorCount}명이 응원 중</small><strong>최대 {r.fund.maxDiscount}%</strong></div></div></div>
  </article>
}

function Discover({ restaurants, onSelect, favoriteIds, onFavorite }: { restaurants: Restaurant[]; onSelect: (r: Restaurant) => void; favoriteIds: string[]; onFavorite: (r: Restaurant) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('전체')
  const [region, setRegion] = useState('전체 지역')
  const [risk, setRisk] = useState('전체 위험도')
  const [fundStatus, setFundStatus] = useState('전체 상태')
  const [sort, setSort] = useState('기본순')
  const [mapRestaurantId, setMapRestaurantId] = useState(restaurants[0]?.id || '')
  const categories = ['전체', ...new Set(restaurants.map((r) => r.category))]
  const regions = ['전체 지역', ...new Set(restaurants.map((r) => r.region))]
  const filtered = useMemo(() => restaurants.filter((r) =>
    (category === '전체' || r.category === category)
    && (region === '전체 지역' || r.region === region)
    && (risk === '전체 위험도' || r.fund.riskLevel === risk)
    && (fundStatus === '전체 상태' || r.fund.status === fundStatus)
    && `${r.name}${r.region}${r.neighborhood}${r.tags.join('')}`.includes(query),
  ).sort((a, b) => sort === '성장률순' ? b.salesGrowth - a.salesGrowth
    : sort === '혜택순' ? b.fund.maxDiscount - a.fund.maxDiscount
      : sort === '마감임박순' ? new Date(a.fund.endsAt).getTime() - new Date(b.fund.endsAt).getTime()
        : b.opportunityScore - a.opportunityScore), [restaurants, query, category, region, risk, fundStatus, sort])
  const resetFilters = () => { setQuery(''); setCategory('전체'); setRegion('전체 지역'); setRisk('전체 위험도'); setFundStatus('전체 상태'); setSort('기본순') }
  const mapRestaurant = restaurants.find((item) => item.id === mapRestaurantId) || restaurants[0]
  return <div className="page-wrap"><div className="page-heading"><span className="eyebrow coral">식당 발견</span><h1>내 취향에 맞는<br />맛있는 기회를 찾아보세요.</h1><p>모든 식당과 수치는 서비스 시연을 위한 가상 데이터입니다.</p></div><div className="discover-toolbar"><label className="search-box"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="식당, 동네, 음식 검색" /></label><select value={sort} onChange={(e) => setSort(e.target.value)}><option>기본순</option><option>성장률순</option><option>혜택순</option><option>마감임박순</option></select></div><div className="discover-filters"><select value={region} onChange={(e) => setRegion(e.target.value)}>{regions.map((item) => <option key={item}>{item}</option>)}</select><select value={risk} onChange={(e) => setRisk(e.target.value)}><option>전체 위험도</option><option>낮음</option><option>보통</option><option>주의</option></select><select value={fundStatus} onChange={(e) => setFundStatus(e.target.value)}><option value="전체 상태">전체 상태</option><option value="funding">모금 중</option><option value="trading">거래 가능</option></select><button onClick={resetFilters}>필터 초기화</button></div><div className="chip-row">{categories.map((item) => <button className={item === category ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>{mapRestaurant && <NearbyMap restaurant={mapRestaurant} restaurants={restaurants} onRestaurantChange={setMapRestaurantId} />}<div className="result-row"><b>{filtered.length}개의 식당</b><span>지역·혜택·위험도를 함께 확인한 뒤 직접 방문할 식당을 중심으로 살펴보세요.</span></div><div className="restaurant-grid">{filtered.map((r) => <RestaurantCard key={r.id} restaurant={r} onClick={() => onSelect(r)} favorite={favoriteIds.includes(r.id)} onFavorite={() => onFavorite(r)} />)}</div>{!filtered.length && <Empty icon="🔎" title="조건에 맞는 식당이 없어요" text="필터를 초기화하거나 검색 범위를 넓혀보세요." />}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }


function MyPage({ me, state, restaurants, requireLogin, onSelect, transact, refresh, notify }: { me: MeState | null; state: PublicState; restaurants: Restaurant[]; requireLogin: (cb?: () => void) => boolean; onSelect: (r: Restaurant) => void; transact: (kind: 'invest' | 'withdraw', id: string, amount: number) => Promise<void>; refresh: () => Promise<void>; notify: (m: string) => void }) {
  useEffect(() => { if (!me) requireLogin() }, [])
  if (!me) return <div className="page-wrap"><Empty icon="👋" title="로그인하고 내 먹투를 확인하세요" text="투자, 쿠폰, 예약 거래 현황이 한곳에 모여요." /></div>
  const invested = me.positions.reduce((sum, p) => sum + p.amount, 0)
  const favorites = restaurants.filter((restaurant) => me.favoriteRestaurantIds.includes(restaurant.id))
  const issue = async (position: Position) => { try { const r = await api<{ message: string }>(`/api/positions/${position.id}/coupon`, { method: 'POST' }); notify(r.message); await refresh() } catch (e) { notify((e as Error).message) } }
  return <div className="page-wrap my-page"><div className="my-head"><div><span className="eyebrow coral">MY 먹투</span><h1>{me.user.name}님, 오늘도<br />혜택이 자라고 있어요.</h1></div><div className="wallet-card"><WalletCards /><span>사용 가능 먹투머니</span><b>{won(me.user.cash)}</b><WalletTopup balance={me.user.cash} refresh={refresh} notify={notify} /></div></div>{me.exchange.offersReceived > 0 && <NavLink to="/market?view=mine" className="wallet-banner my-page-offer-banner"><Bell /><span><b>새 교환 제안 {me.exchange.offersReceived}건이 도착했어요</b><small>눌러서 쿠폰을 확인하고 수락하거나 거절하세요.</small></span><ChevronRight /></NavLink>}<div className="portfolio-summary"><div><span>총 투자금</span><b>{won(invested)}</b><small>{me.positions.length}개 식당 응원 중</small></div><div><span>발급 가능 쿠폰</span><b>{me.positions.filter((p) => p.couponProgress >= 10).length}장</b><small>10%부터 꺼내 쓸 수 있어요</small></div><div><span>보유 쿠폰</span><b>{me.coupons.filter((c) => c.status === 'available').length}장</b><small>최대 {won(me.coupons.reduce((s,c) => s + c.maxDiscountWon,0))} 혜택</small></div><div><span>대기 중 거래</span><b>{me.orders.filter((o) => ['open','partial'].includes(o.status)).length}건</b><small>실시간으로 자동 매칭돼요</small></div><div><span>관심 식당</span><b>{favorites.length}곳</b><small>계정에 저장돼서 다른 기기에서도 그대로 보여요</small></div></div><section className="my-section"><div className="subheading"><div><span>나의 식당</span><h2>투자와 쿠폰 성장</h2></div></div><div className="position-grid">{me.positions.map((p) => <article className="position-card" key={p.id}><button className="position-store" onClick={() => onSelect(p.restaurant)}><span style={{ background: `${p.restaurant.color}35` }}>{p.restaurant.emoji}</span><div><b>{p.restaurant.name}</b><small>{p.early ? '최초 투자자 · 매출 보너스 ' + p.fund.earlyBonus + '% 계속 우대' : p.fund.status === 'trading' ? '예약 거래 가능' : '일반 투자자'}</small></div><ChevronRight /></button><div className="position-amount"><span>투자금</span><b>{won(p.amount)}</b></div><div className="coupon-growth"><div><span>다음 쿠폰 할인율</span><b>{p.couponProgress.toFixed(1)}% <small>/ {p.fund.maxDiscount}%</small></b></div><div className="progress-track coupon"><i style={{ width: `${p.couponProgress / p.fund.maxDiscount * 100}%` }} /></div><small>10만원당 하루 {p.fund.dailyRatePer100k}% · 매출 보너스 +{(p.fund.salesBonus * (p.early ? 1 + p.fund.earlyBonus / 100 : 1)).toFixed(1)}%</small></div><div className="position-actions"><button disabled={p.couponProgress < 10} onClick={() => issue(p)}><Ticket /> 쿠폰 발급</button><button onClick={() => transact('withdraw', p.fund.id, Math.min(10000, p.availableAmount))}><HandCoins /> 1만원 회수</button></div></article>)}{!me.positions.length && <Empty icon="🍽️" title="아직 응원하는 식당이 없어요" text="마음에 드는 식당을 발견해보세요." />}</div></section>{favorites.length > 0 && <section className="my-section"><div className="subheading"><div><span>관심 목록</span><h2>다시 보고 싶은 식당</h2></div><NavLink to="/discover">더 찾아보기 <ChevronRight /></NavLink></div><div className="favorite-strip">{favorites.map((restaurant) => <button key={restaurant.id} onClick={() => onSelect(restaurant)}><span style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><div><b>{restaurant.name}</b><small>{restaurant.neighborhood} · 기회점수 {restaurant.opportunityScore}</small></div><ChevronRight /></button>)}</div></section>}<CouponWallet me={me} state={state} refresh={refresh} notify={notify} /></div>
}

function NotFound() {
  return <div className="page-wrap"><Empty icon="🧭" title="찾는 페이지가 없어요" text="주소를 다시 확인하거나 홈으로 돌아가 주세요." /><div className="notfound-actions"><NavLink className="button" to="/">홈으로</NavLink><NavLink className="button secondary" to="/discover">식당 둘러보기</NavLink></div></div>
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty"><span>{icon}</span><b>{title}</b><p>{text}</p></div> }

function AuthModal({ onClose, onAuth, notify }: { onClose: () => void; onAuth: (token: string, destination?: string) => Promise<void>; notify: (m: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [role, setRole] = useState<Role>('investor')
  const [busy, setBusy] = useState(false)
  // 가입 필수 문서는 서버가 알려준다. 문서가 늘어도 화면이 따라 바뀐다.
  const legal = useLegalIndex()
  const [agreed, setAgreed] = useState<string[]>([])
  const [reading, setReading] = useState('')
  const signupDocs = (legal?.documents || []).filter((document) => legal?.required.signup.includes(document.id))
  const allAgreed = signupDocs.length > 0 && signupDocs.every((document) => agreed.includes(document.id))
  const toggle = (documentId: string) => setAgreed((current) => current.includes(documentId) ? current.filter((item) => item !== documentId) : [...current, documentId])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (mode === 'signup' && !allAgreed) { notify('필수 약관에 모두 동의해야 가입할 수 있어요.'); return }
    setBusy(true)
    try {
      const consent = mode === 'signup' && legal ? { consent: { version: legal.version, documentIds: agreed } } : {}
      const result = await api<{ token?: string; requiresEmailConfirmation?: boolean; message?: string }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password'), name: form.get('name'), role, ...consent }) })
      if (result.token) await onAuth(result.token)
      else if (result.requiresEmailConfirmation) notify(result.message || '이메일 인증 후 로그인해주세요.')
      else throw new Error('로그인 토큰을 받지 못했어요.')
    } catch (e) { notify((e as Error).message) } finally { setBusy(false) }
  }
  const demo = async (type: Role) => { setBusy(true); try { const email = type === 'admin' ? 'admin@meoktu.demo' : type === 'owner' ? 'owner@meoktu.demo' : 'investor@meoktu.demo'; const result = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'demo1234!' }) }); await onAuth(result.token, type === 'admin' ? '/admin' : type === 'owner' ? '/owner' : undefined) } catch (e) { notify((e as Error).message) } finally { setBusy(false) } }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="auth-modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={onClose}><X /></button><div className="auth-brand"><span className="brand-mark">묵</span><div><b>먹투에 오신 걸 환영해요</b><p>맛있는 성장을 함께 시작해볼까요?</p></div></div><div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>로그인</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>회원가입</button></div><form onSubmit={submit}><div className="auth-role-heading"><b>{mode === 'login' ? '어떤 계정으로 로그인할까요?' : '어떤 계정으로 시작할까요?'}</b><small>{mode === 'login' ? '회원가입할 때 선택한 유형을 골라주세요.' : '가입 후에도 마이페이지에서 바로 확인할 수 있어요.'}</small></div><div className="role-picker"><button type="button" aria-pressed={role === 'investor'} className={role === 'investor' ? 'active' : ''} onClick={() => setRole('investor')}><UserRound /><span><b>투자자</b><small>맛집을 응원하고 혜택 받기</small></span></button><button type="button" aria-pressed={role === 'owner'} className={role === 'owner' ? 'active' : ''} onClick={() => setRole('owner')}><Store /><span><b>사장님</b><small>단골에게 펀딩 받기</small></span></button></div>{mode === 'signup' && <Field label="이름"><input name="name" required placeholder="이름을 입력해주세요" /></Field>}<Field label="이메일"><input name="email" type="email" required placeholder="hello@meoktu.kr" /></Field><Field label="비밀번호"><input name="password" type="password" required minLength={8} placeholder="8자 이상 입력해주세요" /></Field>{mode === 'signup' && <div className="consent-block"><label className="consent-all"><input type="checkbox" checked={allAgreed} onChange={(event) => setAgreed(event.target.checked ? signupDocs.map((document) => document.id) : [])} /><span>필수 약관에 모두 동의합니다</span></label>{signupDocs.map((document) => <div className="consent-row" key={document.id}><label><input type="checkbox" checked={agreed.includes(document.id)} onChange={() => toggle(document.id)} /><b className="consent-required">[필수]</b><span className="consent-name">{document.title}</span></label><button type="button" className="consent-view" onClick={() => setReading(document.id)}>보기</button></div>)}{!signupDocs.length && <p className="legal-loading">약관을 불러오는 중이에요.</p>}</div>}<button className="button full large" disabled={busy || (mode === 'signup' && !allAgreed)}>{busy ? '잠시만요...' : mode === 'login' ? `${role === 'owner' ? '사장님' : '투자자'}로 로그인` : '먹투 시작하기'}</button></form>{mode === 'login' && <><div className="divider"><span>또는 데모로 바로 보기</span></div><div className="demo-buttons"><button disabled={busy} onClick={() => demo('investor')}>😋 투자자 데모</button><button disabled={busy} onClick={() => demo('owner')}>👩‍🍳 사장님 데모</button><button disabled={busy} onClick={() => demo('admin')}>🛡️ 관리자 데모</button></div><p className="demo-limit-note">투자자 데모는 현재 화면에서 계속하고, 사장님·관리자 데모는 전용 화면으로 이동합니다.</p></>}<p className="auth-legal">{mode === 'signup' ? <>동의 시각과 적용 약관 버전({legal?.version || '확인 중'})이 함께 기록됩니다. </> : null}<NavLink to="/legal" onClick={onClose}>약관·고지 전체 보기</NavLink></p></div>{reading && <LegalDocModal documentId={reading} onClose={() => setReading('')} />}</div>
}

function Footer() { return <footer><div className="footer-inner"><div><div className="logo footer-logo"><span className="brand-mark">묵</span><span>먹투<small>먹는 투자의 시작</small></span></div><p>좋아하는 식당의 내일을<br />오늘의 단골과 함께 만듭니다.</p></div><div className="footer-links"><div><b>서비스</b><NavLink to="/discover">식당 발견</NavLink><NavLink to="/market">거래장</NavLink><NavLink to="/insight">AI 인사이트</NavLink></div><div><b>계정</b><NavLink to="/my">마이페이지</NavLink><NavLink to="/owner">사장님 센터</NavLink></div><div><b>도움말</b><NavLink to="/support">신고·문의</NavLink><NavLink to="/insight">AI 상담</NavLink></div><div><b>약관·고지</b><NavLink to="/legal/terms">이용약관</NavLink><NavLink to="/legal/privacy">개인정보처리방침</NavLink><NavLink to="/legal/investment-risk">투자 위험고지</NavLink><NavLink to="/legal">전체 문서</NavLink></div></div></div><div className="footer-bottom"><span>© 2026 먹투. MVP Demo.</span><p>식당·투자·거래 수치는 가상이며, 일부 상권 설명은 출처가 표시된 공공자료를 사용합니다. 금융상품 판매 서비스가 아닙니다.</p></div></footer> }

export default App
