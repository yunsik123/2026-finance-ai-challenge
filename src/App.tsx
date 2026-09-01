import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import {
  ArrowRight, BadgeCheck, BarChart3, Bell, Bot, Building2, Check, ChevronRight, CircleDollarSign,
  Clock3, Gift, HandCoins, Heart, LayoutDashboard, LogOut, MapPin, Menu, MessageCircle, Search,
  ShieldCheck, Sparkles, Store, Ticket, TrendingUp, UserRound, Users, WalletCards, X,
} from 'lucide-react'
import { api, clearToken, getToken, setToken } from './lib/api.ts'
import OwnerDashboard from './OwnerDashboard.tsx'
import CouponMarket from './CouponMarket.tsx'
import FundDetailModal from './FundDetailModal.tsx'
import InsightPage from './InsightPage.tsx'
import OwnerCenter from './OwnerCenter.tsx'
import WalletTopup from './WalletTopup.tsx'
import TrustCenter from './TrustCenter.tsx'
import FloatingAiChat from './FloatingAiChat.tsx'
import type { ApplicationResult, Coupon, MeState, Position, PublicState, Restaurant, Role, User } from './types.ts'

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

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }

  const refresh = async () => {
    const publicData = await api<PublicState>('/api/public')
    setState(publicData)
    if (getToken()) {
      try { setMe(await api<MeState>('/api/me')) }
      catch { clearToken(); setMe(null) }
    }
    setLoading(false)
  }

  useEffect(() => {
    refresh().catch((error) => { setLoading(false); notify(error.message) })
    const socket = io()
    socket.on('state:changed', () => refresh().catch(() => undefined))
    return () => { socket.disconnect() }
  }, [])

  const requireLogin = (callback?: () => void) => {
    if (!me) { setAuthOpen(true); return false }
    callback?.()
    return true
  }

  const onAuth = async (token: string) => {
    setToken(token)
    setAuthOpen(false)
    await refresh()
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
      <Header user={me?.user} onLogin={() => setAuthOpen(true)} onLogout={logout} />
      <main>
        <Routes>
          <Route path="/" element={<Home state={state} onSelect={setSelected} onExplore={() => navigate('/discover')} favoriteIds={me?.favoriteRestaurantIds || []} onFavorite={toggleFavorite} />} />
          <Route path="/discover" element={<Discover restaurants={state.restaurants} onSelect={setSelected} favoriteIds={me?.favoriteRestaurantIds || []} onFavorite={toggleFavorite} />} />
          <Route path="/market" element={<CouponMarket state={state} me={me} requireLogin={requireLogin} refresh={refresh} notify={notify} />} />
          <Route path="/insight" element={<InsightPage state={state} onSelect={setSelected} notify={notify} />} />
          <Route path="/trust" element={<TrustCenter state={state} onSelect={setSelected} />} />
          <Route path="/owner" element={<OwnerCenter me={me} onLogin={() => setAuthOpen(true)} refresh={refresh} notify={notify} />} />
          <Route path="/my" element={<MyPage me={me} restaurants={state.restaurants} requireLogin={requireLogin} onSelect={setSelected} transact={transact} refresh={refresh} notify={notify} />} />
        </Routes>
      </main>
      <Footer />
      <MobileNav />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onAuth={onAuth} notify={notify} />}
      {selected && <FundDetailModal restaurant={state.restaurants.find((r) => r.id === selected.id) || selected} me={me} onClose={() => setSelected(null)} onLogin={() => setAuthOpen(true)} refresh={refresh} notify={notify} />}
      {toast && <div className="toast"><Check size={18} />{toast}</div>}
      <FloatingAiChat role={me?.user.role || 'investor'} />
    </div>
  )
}

function Header({ user, onLogin, onLogout }: { user?: User; onLogin: () => void; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setMenuOpen(false), [location.pathname])
  return <header className="site-header">
    <div className="header-inner">
      <NavLink to="/" className="logo"><span className="brand-mark">묵</span><span>먹투<small>먹는 투자의 시작</small></span></NavLink>
      <nav className={menuOpen ? 'desktop-nav open' : 'desktop-nav'}>
        <NavLink to="/discover">식당 발견</NavLink><NavLink to="/market">거래장</NavLink><NavLink to="/insight">AI 인사이트</NavLink><NavLink to="/trust">검증 데이터룸</NavLink><NavLink to="/owner">사장님 센터</NavLink>
      </nav>
      <div className="header-actions">
        <button className="icon-button hide-mobile" aria-label="알림"><Bell size={20} /></button>
        {user ? <div className="user-menu"><NavLink to="/my" className="avatar">{user.name.slice(0, 1)}</NavLink><div className="user-copy hide-mobile"><b>{user.name}</b><span>{user.role === 'owner' ? '사장님' : compactWon(user.cash)}</span></div><button className="icon-button hide-mobile" onClick={onLogout} aria-label="로그아웃"><LogOut size={18} /></button></div> : <button className="button small" onClick={onLogin}>로그인</button>}
        <button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="메뉴">{menuOpen ? <X /> : <Menu />}</button>
      </div>
    </div>
  </header>
}

function MobileNav() {
  return <nav className="mobile-nav">
    <NavLink to="/"><Store /><span>홈</span></NavLink><NavLink to="/discover"><Search /><span>발견</span></NavLink><NavLink to="/market"><ArrowRight /><span>거래</span></NavLink><NavLink to="/insight"><Sparkles /><span>AI</span></NavLink><NavLink to="/my"><UserRound /><span>MY</span></NavLink>
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
        <div className="trust-row"><span><ShieldCheck /> 6단계 성장성 심사</span><span><CircleDollarSign /> 1천원 단위 거래</span><span><Users /> 1% 투자 한도</span></div>
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
        <Step icon="💸" number="02" title="1천원부터 응원 투자" text="한 식당 최대 1%까지, 모금 중엔 자유롭게 넣고 빼요." />
        <Step icon="🎟️" number="03" title="할인율이 매일 차곡차곡" text="투자액과 성장에 따라 쿠폰 혜택이 매일 쌓여요." />
        <Step icon="🤝" number="04" title="필요할 때 투자 회수" text="모금 후엔 새 투자자와 1천원씩 자동 매칭돼요." />
      </div>
    </section>
    <section className="content-section etf-section">
      <SectionTitle eyebrow="한 번에 골고루" title="맛으로 묶은 먹투 펀드" description="지역과 음식 취향을 골라 여러 식당을 함께 응원해요." />
      <div className="etf-grid">{state.etfs.map((etf) => <article className="etf-card" key={etf.id}><span className="etf-emoji">{etf.emoji}</span><div className="etf-copy"><span>{etf.region} · {etf.category}</span><h3>{etf.name}</h3><p>{etf.description}</p></div><div className="etf-stats"><span>최근 성장 <b>+{etf.growth}%</b></span><span>최대 쿠폰 <strong>{etf.maxDiscount}%</strong></span></div><button className="round-arrow" aria-label="상세보기"><ArrowRight /></button></article>)}</div>
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
  const [sort, setSort] = useState('추천순')
  const categories = ['전체', ...new Set(restaurants.map((r) => r.category))]
  const filtered = useMemo(() => restaurants.filter((r) => (category === '전체' || r.category === category) && `${r.name}${r.region}${r.neighborhood}${r.tags.join('')}`.includes(query)).sort((a, b) => sort === '성장률순' ? b.salesGrowth - a.salesGrowth : sort === '마감임박순' ? new Date(a.fund.endsAt).getTime() - new Date(b.fund.endsAt).getTime() : b.opportunityScore - a.opportunityScore), [restaurants, query, category, sort])
  return <div className="page-wrap"><div className="page-heading"><span className="eyebrow coral">식당 발견</span><h1>내 취향에 맞는<br />맛있는 기회를 찾아보세요.</h1><p>모든 식당과 수치는 서비스 시연을 위한 가상 데이터입니다.</p></div><div className="discover-toolbar"><label className="search-box"><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="식당, 동네, 음식 검색" /></label><select value={sort} onChange={(e) => setSort(e.target.value)}><option>추천순</option><option>성장률순</option><option>마감임박순</option></select></div><div className="chip-row">{categories.map((item) => <button className={item === category ? 'active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div><div className="result-row"><b>{filtered.length}개의 식당</b><span>AI 기회점수는 성장성·단골·안정성을 함께 반영해요.</span></div><div className="restaurant-grid">{filtered.map((r) => <RestaurantCard key={r.id} restaurant={r} onClick={() => onSelect(r)} favorite={favoriteIds.includes(r.id)} onFavorite={() => onFavorite(r)} />)}</div></div>
}

function FundModal({ restaurant: r, me, onClose, onLogin, transact }: { restaurant: Restaurant; me: MeState | null; onClose: () => void; onLogin: () => void; transact: (kind: 'invest' | 'withdraw', id: string, amount: number) => Promise<void> }) {
  const [amount, setAmount] = useState(50000)
  const [tab, setTab] = useState<'invest' | 'withdraw'>('invest')
  const position = me?.positions.find((p) => p.fundId === r.fund.id)
  const progress = Math.min(100, Math.round(r.fund.raised / r.fund.goal * 100))
  const max = Math.floor(r.fund.goal * .01 / 1000) * 1000
  const submit = async () => { if (!me) { onLogin(); return } await transact(tab, r.fund.id, amount) }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="fund-modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={onClose}><X /></button><div className="fund-modal-scroll"><div className="fund-hero" style={{ background: `linear-gradient(145deg, ${r.color}28, ${r.color}70)` }}><span>{r.emoji}</span><div><small>{r.neighborhood} · {r.category}</small><h2>{r.name}</h2><p>{r.tagline}</p></div></div><div className="fund-content"><div className="detail-tags"><span><BadgeCheck /> 기초 심사 완료</span><span><BarChart3 /> 기회점수 {r.opportunityScore}</span><span><ShieldCheck /> 위험 {r.fund.riskLevel}</span></div><h3>{r.story}</h3><p className="muted">자금 사용처 · {r.fund.purpose}</p><div className="fund-big-progress"><div><span>{r.fund.status === 'funding' ? `${progress}% 모였어요` : '모금 완료 · 예약 거래 중'}</span><strong>{compactWon(r.fund.raised)} <small>/ {compactWon(r.fund.goal)}</small></strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div><div className="metric-grid"><Metric label="매출 성장" value={`+${r.salesGrowth}%`} accent /><Metric label="재방문율" value={`${r.repeatRate}%`} /><Metric label="운영 이력" value={`${r.openedYears}년`} /><Metric label="상권 유동" value={`+${r.footTrafficGrowth}%`} accent /><Metric label="주변 폐업률" value={`${r.closingRate}%`} /><Metric label="최대 쿠폰" value={`${r.fund.maxDiscount}%`} accent /></div><div className="coupon-explain"><Ticket /><div><b>혜택은 이렇게 쌓여요</b><p>10만원 기준 하루 {r.fund.dailyRatePer100k}% + 매출 보너스 {r.fund.salesBonus}%{r.fund.status === 'funding' && ` + 최초 투자 보너스 ${r.fund.earlyBonus}%`}</p></div></div><div className="menu-highlight"><span>대표 메뉴</span><b>{r.signature}</b><small>{won(r.avgPrice)}대</small></div></div></div><aside className="order-panel"><div className="order-tabs"><button className={tab === 'invest' ? 'active' : ''} onClick={() => setTab('invest')}>투자하기</button><button className={tab === 'withdraw' ? 'active' : ''} onClick={() => setTab('withdraw')}>회수하기</button></div><div className="balance-row"><span>{tab === 'invest' ? '보유 먹투머니' : '회수 가능 금액'}</span><b>{won(tab === 'invest' ? me?.user.cash || 0 : position?.availableAmount || 0)}</b></div><label className="amount-input"><input type="number" step="1000" min="1000" value={amount} onChange={(e) => setAmount(Math.max(1000, Math.floor(Number(e.target.value) / 1000) * 1000))} /><span>원</span></label><div className="quick-amounts">{[10000, 50000, 100000].map((v) => <button key={v} onClick={() => setAmount(v)}>+{v / 10000}만</button>)}<button onClick={() => setAmount(tab === 'invest' ? Math.min(me?.user.cash || 0, max) : position?.availableAmount || 0)}>최대</button></div>{tab === 'invest' && <div className="limit-note"><span>개인 투자 한도</span><b>{won(max)}</b></div>}{r.fund.status === 'trading' && <div className="matching-note"><Clock3 /><p>모금이 끝난 펀드예요. 반대 주문과 <b>1,000원 단위</b>로 선착순 매칭됩니다.</p></div>}<button className="button full large" onClick={submit}>{me ? tab === 'invest' ? r.fund.status === 'funding' ? '응원 투자하기' : '예약 투자 걸기' : r.fund.status === 'funding' ? '바로 회수하기' : '회수 주문 걸기' : '로그인하고 시작하기'}</button><p className="order-risk">원금과 회수 시점은 보장되지 않아요. 투자 전 식당 정보와 위험을 확인하세요.</p></aside></div></div>
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <div><span>{label}</span><b className={accent ? 'coral-text' : ''}>{value}</b></div> }

function Market({ state, me, requireLogin, refresh, notify }: { state: PublicState; me: MeState | null; requireLogin: (cb?: () => void) => boolean; refresh: () => Promise<void>; notify: (m: string) => void }) {
  const [tab, setTab] = useState<'fund' | 'coupon'>('fund')
  const trading = state.restaurants.filter((r) => r.fund.status === 'trading')
  const swap = async (listingId: string, discount: number) => {
    if (!requireLogin()) return
    const offered = me?.coupons.find((c) => c.status === 'available' && Math.abs(c.discount - discount) < 10)
    if (!offered) { notify('할인율 차이가 10% 미만인 보유 쿠폰이 필요해요.'); return }
    try { const result = await api<{ message: string }>(`/api/listings/${listingId}/swap`, { method: 'POST', body: JSON.stringify({ couponId: offered.id }) }); notify(result.message); await refresh() } catch (e) { notify((e as Error).message) }
  }
  return <div className="page-wrap"><div className="page-heading compact"><span className="eyebrow coral">실시간 거래장</span><h1>천 원부터 이어지는<br />맛있는 바통 터치</h1><p>펀드 총액은 유지하고, 투자자끼리 1,000원 단위로 순서대로 교대해요.</p></div><div className="big-tabs"><button className={tab === 'fund' ? 'active' : ''} onClick={() => setTab('fund')}><ArrowRight /> 펀드 예약 거래</button><button className={tab === 'coupon' ? 'active' : ''} onClick={() => setTab('coupon')}><Ticket /> 쿠폰 교환장</button></div>{tab === 'fund' ? <div className="market-layout"><div className="trade-list"><div className="trade-head"><span>식당</span><span>매수 대기</span><span>회수 대기</span><span>최대 혜택</span></div>{trading.map((r) => <article className="trade-row" key={r.id}><div className="trade-name"><span style={{ background: `${r.color}35` }}>{r.emoji}</span><div><b>{r.name}</b><small>{r.neighborhood} · {r.category}</small></div></div><div><small>사려는 금액</small><b className="green-text">{compactWon(r.fund.openBuyAmount)}</b></div><div><small>나오려는 금액</small><b>{compactWon(r.fund.openSellAmount)}</b></div><div><small>쿠폰</small><b className="coral-text">{r.fund.maxDiscount}%</b></div><NavLink to="/discover" className="round-arrow"><ChevronRight /></NavLink></article>)}</div><aside className="market-guide"><span>💡</span><h3>예약 거래는 이렇게</h3><ol><li><b>1</b>원하는 금액을 예약해요.</li><li><b>2</b>반대 주문이 생기면 선착순으로 만나요.</li><li><b>3</b>1,000원씩 즉시 투자자만 바뀌어요.</li></ol><p>펀드 총액은 줄지 않지만, 매수자가 없으면 회수가 늦어질 수 있어요.</p></aside></div> : <div className="coupon-market"><div className="coupon-intro"><div><h2>안 쓰는 쿠폰을<br />먹고 싶은 쿠폰으로</h2><p>할인율 차이가 10% 미만인 쿠폰끼리 안전하게 맞바꿔요.</p></div><Ticket /></div><div className="coupon-listings">{state.listings.map((listing) => <article className="listing-card" key={listing.id}><div className="coupon-ticket"><span>{listing.restaurant?.emoji}</span><div><small>{listing.restaurant?.name}</small><b>{listing.coupon?.discount}%</b><p>최대 {won(listing.coupon?.maxDiscountWon || 0)} 할인</p></div></div><div className="swap-wants"><ArrowRight /><span>{listing.wantedRegion}<br /><b>{listing.wantedCategory} 쿠폰</b></span></div><div className="listing-user"><small>{listing.userName}님의 제안</small><button className="button small" onClick={() => swap(listing.id, listing.coupon?.discount || 0)}>교환하기</button></div></article>)}{!state.listings.length && <Empty icon="🎟️" title="아직 열린 교환이 없어요" text="내 쿠폰을 먼저 올려보세요." />}</div></div>}</div>
}

function Insight({ state, onSelect, notify }: { state: PublicState; onSelect: (r: Restaurant) => void; notify: (m: string) => void }) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([{ role: 'ai', text: '안녕하세요! SG-LLM 생성형 AI 상담원이에요. 식당 데이터, 투자 회수, 쿠폰 규칙을 무엇이든 물어보세요. 😊' }])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [aiStatus, setAiStatus] = useState<'online' | 'error'>('online')
  const ask = async (q?: string) => { const value = (q || question).trim(); if (!value || asking) return; setMessages((m) => [...m, { role: 'user', text: value }]); setQuestion(''); setAsking(true); try { const result = await api<{ answer: string; mode: string; provider?: string; model?: string }>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question: value }) }); setAiStatus(result.mode === 'generative-ai' ? 'online' : 'error'); setMessages((m) => [...m, { role: 'ai', text: result.answer }]) } catch (e) { setAiStatus('error'); notify((e as Error).message) } finally { setAsking(false) } }
  return <div className="page-wrap"><div className="page-heading compact"><span className="eyebrow coral"><Bot /> 먹투 AI</span><h1>숫자 너머의 맛있는<br />가능성을 읽어드려요.</h1><p>가상 식당 데이터와 먹투 규칙을 바탕으로 SG-LLM 생성형 AI가 답변합니다.</p></div><div className="insight-layout"><section><div className="ai-picks"><div className="subheading"><div><span>AI 오늘의 발견</span><h2>성장성과 단골이 함께 좋은 곳</h2></div><Sparkles /></div>{[...state.restaurants].sort((a,b) => b.opportunityScore - a.opportunityScore).slice(0,3).map((r, i) => <button className="pick-row" key={r.id} onClick={() => onSelect(r)}><span className="pick-rank">0{i+1}</span><span className="food-mini" style={{ background: `${r.color}35` }}>{r.emoji}</span><div><b>{r.name}</b><small>{r.neighborhood} · 성장 {r.salesGrowth}% · 단골 {r.repeatRate}%</small></div><span className="score-ring">{r.opportunityScore}</span></button>)}</div><div className="articles"><div className="subheading"><div><span>이번 주 읽을거리</span><h2>AI가 정리한 상권 이야기</h2></div></div>{state.articles.map((article) => <article className="article-card" key={article.id}><span>{article.icon}</span><div><small>{article.eyebrow} · {shortDate(article.publishedAt)}</small><h3>{article.title}</h3><p>{article.summary}</p><div className="tag-row">{article.tags.map((t) => <span key={t}>{t}</span>)}</div></div></article>)}</div></section><aside className="chat-panel"><div className="chat-head"><span className="bot-avatar"><Bot /></span><div><b>먹투 생성형 AI 상담원</b><small><i /> {aiStatus === 'online' ? 'SG-LLM · 온라인' : 'SG-LLM · 연결 확인 필요'}</small></div></div><div className="chat-messages">{messages.map((m, i) => <div className={`chat-bubble ${m.role}`} key={i}>{m.text}</div>)}{asking && <div className="chat-bubble ai typing">···</div>}</div><div className="suggestions">{['단골 많은 곳 추천해줘', '투자금은 어떻게 회수해?', '소복소복 분석해줘'].map((q) => <button key={q} onClick={() => ask(q)}>{q}</button>)}</div><form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask() }}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="궁금한 것을 물어보세요" /><button><ArrowRight /></button></form><p className="ai-disclaimer">SG-LLM이 생성한 답변은 참고용이며 투자 권유가 아닙니다.</p></aside></div></div>
}

function OwnerPage({ me, requireLogin, refresh, notify }: { me: MeState | null; requireLogin: (cb?: () => void) => boolean; refresh: () => Promise<void>; notify: (m: string) => void }) {
  const [result, setResult] = useState<ApplicationResult | null>(me?.applications.at(-1) || null)
  const [submitting, setSubmitting] = useState(false)
  const owner = me?.user.role === 'owner'
  const [ownerData, setOwnerData] = useState<any>(null)
  const [showApplication, setShowApplication] = useState(false)
  useEffect(() => {
    if (owner) api<any>('/api/owner').then(setOwnerData).catch(() => undefined)
  }, [owner, me?.applications.length])
  const sendDividend = async (fundId: string) => {
    try {
      const response = await api<{ message: string }>('/api/owner/funds/' + fundId + '/dividend', { method: 'POST', body: JSON.stringify({ discount: 10 }) })
      notify(response.message)
      setOwnerData(await api<any>('/api/owner'))
      await refresh()
    } catch (error) { notify((error as Error).message) }
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!requireLogin()) return; if (!owner) { notify('소상공인 계정으로 이용해주세요.'); return }
    const form = new FormData(event.currentTarget); const payload: Record<string, unknown> = {}
    for (const [key, value] of form.entries()) payload[key] = value
    for (const key of ['businessVerified','licenseVerified','identityVerified','posConsent','cardConsent']) payload[key] = form.get(key) === 'on'
    for (const key of ['taxArrears','overdue']) payload[key] = form.get(key) === 'yes'
    setSubmitting(true)
    try { const response = await api<{ message: string; application: ApplicationResult }>('/api/applications', { method: 'POST', body: JSON.stringify(payload) }); setResult(response.application); notify(response.message); await refresh() } catch (e) { notify((e as Error).message) } finally { setSubmitting(false) }
  }
  return <div className="owner-page"><section className="owner-page-hero"><div><span className="eyebrow light"><Store /> 먹투 사장님 센터</span><h1>매출표에 다 담기지 않는<br /><em>우리 가게의 가능성.</em></h1><p>규모보다 성장의 방향, 담보보다 실제 단골의 지지를 봅니다.</p><div className="owner-values"><span><Check /> 신청비 0원</span><span><Check /> 평균 3분 예비심사</span><span><Check /> 조건부 승인 가능</span></div></div><div className="review-flow"><b>6단계 균형 심사</b>{['기본 자격 확인','6개월 매출·현금흐름','부채·상환 부담','운영·세금·행정 이력','상권 경쟁력·성장성','종합 한도와 조건 결정'].map((t,i) => <div key={t}><span>{i+1}</span><p>{t}</p><Check /></div>)}</div></section><div className="owner-body">{owner && ownerData?.restaurants?.length && !showApplication ? <OwnerDashboard data={ownerData} onDividend={sendDividend} onNewFund={() => { setResult(null); setShowApplication(true) }} /> : result ? <ReviewResult result={result} onAgain={() => setResult(null)} /> : <form className="application-form" onSubmit={submit}><div className="form-heading"><span>예비 펀딩 심사</span><h2>가게의 오늘을 알려주세요</h2><p>정확한 수치는 추후 POS·카드 데이터 연동으로 검증합니다. 예비심사는 성장 가능성을 확인하기 위한 단계예요.</p></div>{!me && <div className="login-nudge"><UserRound /><div><b>제출하려면 로그인이 필요해요</b><p>먼저 내용을 작성한 뒤 소상공인 계정으로 가입할 수 있어요.</p></div></div>}{me && !owner && <div className="login-nudge warning"><UserRound /><div><b>현재 투자자 계정이에요</b><p>소상공인 계정을 새로 만들어 심사를 제출해주세요.</p></div></div>}<FormSection number="1" title="기본 자격과 동의" hint="가게가 실제로 운영 중인지 먼저 확인해요."><div className="field-grid"><Field label="상호명"><input name="restaurantName" required placeholder="예: 소복소복" /></Field><Field label="대표자명"><input name="ownerName" required placeholder="사업자등록증과 동일하게" /></Field><Field label="사업자등록번호"><input name="businessNumber" required placeholder="000-00-00000" /></Field><Field label="영업신고번호"><input name="licenseNumber" required placeholder="신고번호 입력" /></Field></div><div className="check-grid">{[['businessVerified','사업자등록 확인'],['licenseVerified','영업신고 확인'],['identityVerified','대표자 본인 확인'],['posConsent','POS 데이터 제공 동의'],['cardConsent','카드매출 데이터 제공 동의']].map(([name,label]) => <label className="check-card" key={name}><input type="checkbox" name={name} defaultChecked /><Check /> {label}</label>)}</div></FormSection><FormSection number="2" title="최근 6개월 영업 흐름" hint="절대 매출보다 꾸준함과 성장 방향을 중요하게 봐요."><div className="field-grid three"><NumberField name="monthlySales" label="최근 월평균 매출" suffix="원" defaultValue={38000000} /><NumberField name="monthlyOperatingCashflow" label="월평균 영업현금흐름" suffix="원" defaultValue={6400000} /><NumberField name="salesGrowth" label="6개월 매출 성장률" suffix="%" defaultValue={16} /><NumberField name="salesVolatility" label="월매출 변동폭" suffix="%" defaultValue={12} /><NumberField name="repeatRate" label="추정 재방문율" suffix="%" defaultValue={54} /><NumberField name="foodCostRatio" label="식재료 원가율" suffix="%" defaultValue={34} /></div></FormSection><FormSection number="3" title="부채와 상환 부담" hint="대출이 있다는 이유만으로 탈락하지 않아요. 감당 가능한지가 중요해요."><div className="field-grid three"><NumberField name="totalDebt" label="기존 대출 잔액" suffix="원" defaultValue={42000000} /><NumberField name="monthlyDebtPayment" label="월 상환액" suffix="원" defaultValue={1700000} /><NumberField name="leaseDepositLoan" label="임차보증금 대출" suffix="원" defaultValue={0} /></div><div className="yesno-row"><span>최근 12개월 연체</span><label><input type="radio" name="overdue" value="no" defaultChecked /> 없음</label><label><input type="radio" name="overdue" value="yes" /> 있음</label></div></FormSection><FormSection number="4" title="운영 안정성" hint="오래됐다는 이유보다, 문제를 어떻게 관리했는지 살펴봐요."><div className="field-grid three"><NumberField name="operatingYears" label="현재 상호 영업기간" suffix="년" defaultValue={3} /><NumberField name="ownerChangeCount" label="최근 3년 사업주 변경" suffix="회" defaultValue={0} /><NumberField name="adminPenaltyCount" label="최근 3년 행정처분" suffix="회" defaultValue={0} /></div><div className="yesno-row"><span>국세·지방세 체납</span><label><input type="radio" name="taxArrears" value="no" defaultChecked /> 없음</label><label><input type="radio" name="taxArrears" value="yes" /> 있음</label></div></FormSection><FormSection number="5" title="상권과 고객의 지지" hint="AI가 공공·제휴 데이터를 연동하기 전 사용할 예비 수치예요."><div className="field-grid three"><NumberField name="footTrafficGrowth" label="상권 유동인구 증감" suffix="%" defaultValue={8} /><NumberField name="districtSalesGrowth" label="동일 업종 상권매출 증감" suffix="%" defaultValue={6} /><NumberField name="nearbyClosingRate" label="주변 동종업 폐업률" suffix="%" defaultValue={9} /></div><Field label="단골과 성장에 대한 설명"><textarea name="growthStory" rows={4} required placeholder="가게를 다시 찾는 고객, 최근 달라진 점, 앞으로의 계획을 들려주세요." /></Field></FormSection><FormSection number="6" title="펀딩 계획" hint="무리한 금액보다 목표와 실행계획이 선명한 모금을 권해요."><div className="field-grid"><NumberField name="requestedLimit" label="희망 모금액" suffix="원" defaultValue={30000000} /><Field label="최대 쿠폰 할인율"><select name="maxDiscount" defaultValue="40"><option value="30">30%</option><option value="35">35%</option><option value="40">40%</option><option value="45">45%</option><option value="50">50%</option><option value="55">55%</option><option value="60">60%</option></select></Field></div><Field label="자금 사용 계획"><textarea name="fundPurpose" rows={3} required placeholder="예: 저온 저장고 1,800만원, 주방 동선 개선 1,200만원" /></Field></FormSection><button className="button full huge" disabled={submitting}>{submitting ? '성장 가능성을 분석하고 있어요...' : 'AI 예비심사 결과 보기'} <ArrowRight /></button><p className="form-disclaimer">예비심사 결과는 최종 펀딩 승인이 아니며, 실제 서비스에서는 제휴기관의 본인·사업자·매출 데이터 검증과 수동 심사가 추가됩니다.</p></form>}</div></div>
}

function FormSection({ number, title, hint, children }: { number: string; title: string; hint: string; children: ReactNode }) { return <section className="form-section"><div className="form-section-title"><span>{number}</span><div><h3>{title}</h3><p>{hint}</p></div></div>{children}</section> }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label> }
function NumberField({ name, label, suffix, defaultValue }: { name: string; label: string; suffix: string; defaultValue: number }) { return <Field label={label}><div className="number-field"><input type="number" name={name} defaultValue={defaultValue} required /><span>{suffix}</span></div></Field> }

function ReviewResult({ result, onAgain }: { result: ApplicationResult; onAgain: () => void }) {
  const labels = { approved: '펀딩 가능', conditional: '조건부 가능', manual_review: '사람이 한 번 더 검토', rejected: '현재는 보완 필요' }
  return <div className="review-result"><div className={`result-hero ${result.status}`}><span className="result-icon">{result.status === 'approved' ? '🎉' : result.status === 'conditional' ? '🌱' : result.status === 'manual_review' ? '🔎' : '🧭'}</span><small>먹투 성장 가능성 예비심사</small><h2>{labels[result.status]}</h2><p>{result.explanation}</p><div className="result-score"><strong>{result.score}</strong><span>/ 100</span></div>{result.approvedLimit > 0 && <div className="approved-limit"><span>권장 펀딩 한도</span><b>{compactWon(result.approvedLimit)}</b></div>}</div><div className="result-columns"><ResultList title="눈에 띈 강점" icon={<TrendingUp />} items={result.strengths} /><ResultList title="확인한 항목" icon={<ShieldCheck />} items={result.checks} /><ResultList title="다음 단계 제안" icon={<Sparkles />} items={result.improvements} /></div><div className="result-actions"><button className="button large">담당자 검토 요청 <ArrowRight /></button><button className="button secondary large" onClick={onAgain}>다시 입력하기</button></div><div className="fair-review"><Bot /><p><b>왜 바로 탈락시키지 않았나요?</b><br />먹투는 기존 신용점수만으로 판단하지 않습니다. 실제 고객의 재방문과 최근 성장 흐름이 보이면 조건부 승인이나 사람의 추가 검토 기회를 제공합니다.</p></div></div>
}
function ResultList({ title, icon, items }: { title: string; icon: ReactNode; items: string[] }) { return <section><h3>{icon}{title}</h3><ul>{items.map((item) => <li key={item}><Check />{item}</li>)}</ul></section> }

function MyPage({ me, restaurants, requireLogin, onSelect, transact, refresh, notify }: { me: MeState | null; restaurants: Restaurant[]; requireLogin: (cb?: () => void) => boolean; onSelect: (r: Restaurant) => void; transact: (kind: 'invest' | 'withdraw', id: string, amount: number) => Promise<void>; refresh: () => Promise<void>; notify: (m: string) => void }) {
  useEffect(() => { if (!me) requireLogin() }, [])
  if (!me) return <div className="page-wrap"><Empty icon="👋" title="로그인하고 내 먹투를 확인하세요" text="투자, 쿠폰, 예약 거래 현황이 한곳에 모여요." /></div>
  const invested = me.positions.reduce((sum, p) => sum + p.amount, 0)
  const favorites = restaurants.filter((restaurant) => me.favoriteRestaurantIds.includes(restaurant.id))
  const issue = async (position: Position) => { try { const r = await api<{ message: string }>(`/api/positions/${position.id}/coupon`, { method: 'POST' }); notify(r.message); await refresh() } catch (e) { notify((e as Error).message) } }
  const listCoupon = async (coupon: Coupon) => { try { const r = await api<{ message: string }>(`/api/coupons/${coupon.id}/list`, { method: 'POST', body: JSON.stringify({ wantedCategory: '한식', wantedRegion: '서울' }) }); notify(r.message); await refresh() } catch (e) { notify((e as Error).message) } }
  return <div className="page-wrap my-page"><div className="my-head"><div><span className="eyebrow coral">MY 먹투</span><h1>{me.user.name}님, 오늘도<br />혜택이 자라고 있어요.</h1></div><div className="wallet-card"><WalletCards /><span>사용 가능 먹투머니</span><b>{won(me.user.cash)}</b><WalletTopup balance={me.user.cash} refresh={refresh} notify={notify} /></div></div><div className="portfolio-summary"><div><span>총 투자금</span><b>{won(invested)}</b><small>{me.positions.length}개 식당 응원 중</small></div><div><span>발급 가능 쿠폰</span><b>{me.positions.filter((p) => p.couponProgress >= 10).length}장</b><small>10%부터 꺼내 쓸 수 있어요</small></div><div><span>보유 쿠폰</span><b>{me.coupons.filter((c) => c.status === 'available').length}장</b><small>최대 {won(me.coupons.reduce((s,c) => s + c.maxDiscountWon,0))} 혜택</small></div><div><span>대기 중 거래</span><b>{me.orders.filter((o) => ['open','partial'].includes(o.status)).length}건</b><small>실시간으로 자동 매칭돼요</small></div><div><span>관심 식당</span><b>{favorites.length}곳</b><small>승재 버전의 찜 기능을 안전한 계정 저장으로 연결했어요</small></div></div><section className="my-section"><div className="subheading"><div><span>나의 식당</span><h2>투자와 쿠폰 성장</h2></div></div><div className="position-grid">{me.positions.map((p) => <article className="position-card" key={p.id}><button className="position-store" onClick={() => onSelect(p.restaurant)}><span style={{ background: `${p.restaurant.color}35` }}>{p.restaurant.emoji}</span><div><b>{p.restaurant.name}</b><small>{p.early ? '최초 투자자 · 매출 보너스 ' + p.fund.earlyBonus + '% 계속 우대' : p.fund.status === 'trading' ? '예약 거래 가능' : '일반 투자자'}</small></div><ChevronRight /></button><div className="position-amount"><span>투자금</span><b>{won(p.amount)}</b></div><div className="coupon-growth"><div><span>다음 쿠폰 할인율</span><b>{p.couponProgress.toFixed(1)}% <small>/ {p.fund.maxDiscount}%</small></b></div><div className="progress-track coupon"><i style={{ width: `${p.couponProgress / p.fund.maxDiscount * 100}%` }} /></div><small>10만원당 하루 {p.fund.dailyRatePer100k}% · 매출 보너스 +{(p.fund.salesBonus * (p.early ? 1 + p.fund.earlyBonus / 100 : 1)).toFixed(1)}%</small></div><div className="position-actions"><button disabled={p.couponProgress < 10} onClick={() => issue(p)}><Ticket /> 쿠폰 발급</button><button onClick={() => transact('withdraw', p.fund.id, Math.min(10000, p.availableAmount))}><HandCoins /> 1만원 회수</button></div></article>)}{!me.positions.length && <Empty icon="🍽️" title="아직 응원하는 식당이 없어요" text="마음에 드는 식당을 발견해보세요." />}</div></section>{favorites.length > 0 && <section className="my-section"><div className="subheading"><div><span>관심 목록</span><h2>다시 보고 싶은 식당</h2></div><NavLink to="/discover">더 찾아보기 <ChevronRight /></NavLink></div><div className="favorite-strip">{favorites.map((restaurant) => <button key={restaurant.id} onClick={() => onSelect(restaurant)}><span style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><div><b>{restaurant.name}</b><small>{restaurant.neighborhood} · 기회점수 {restaurant.opportunityScore}</small></div><ChevronRight /></button>)}</div></section>}<section className="my-section"><div className="subheading"><div><span>내 지갑</span><h2>보유 쿠폰</h2></div><NavLink to="/market">교환장 가기 <ChevronRight /></NavLink></div><div className="my-coupons">{me.coupons.filter((c) => c.status !== 'used').map((c) => <article className={`my-coupon ${c.status}`} key={c.id}><span className="coupon-food">{c.restaurant?.emoji || '🎟️'}</span><div><small>{c.type === 'dividend' ? '깜짝 배당' : c.type === 'etf' ? 'ETF 펀드' : '투자 혜택'}</small><h3>{c.title}</h3><b>{c.discount}% <span>최대 {won(c.maxDiscountWon)}</span></b><p>{shortDate(c.expiresAt)}까지</p></div><button disabled={c.status === 'listed'} onClick={() => listCoupon(c)}>{c.status === 'listed' ? '교환 대기 중' : '교환장에 올리기'}</button></article>)}</div></section></div>
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty"><span>{icon}</span><b>{title}</b><p>{text}</p></div> }

function AuthModal({ onClose, onAuth, notify }: { onClose: () => void; onAuth: (token: string) => Promise<void>; notify: (m: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [role, setRole] = useState<Role>('investor')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { const result = await api<{ token?: string; requiresEmailConfirmation?: boolean; message?: string }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password'), name: form.get('name'), role }) }); if (result.token) await onAuth(result.token); else if (result.requiresEmailConfirmation) notify(result.message || '이메일 인증 후 로그인해주세요.'); else throw new Error('로그인 토큰을 받지 못했어요.') } catch (e) { notify((e as Error).message) } finally { setBusy(false) } }
  const demo = async (type: Role) => { setBusy(true); try { const result = await api<{ token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: type === 'owner' ? 'owner@meoktu.demo' : 'investor@meoktu.demo', password: 'demo1234!' }) }); await onAuth(result.token) } catch (e) { notify((e as Error).message) } finally { setBusy(false) } }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="auth-modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={onClose}><X /></button><div className="auth-brand"><span className="brand-mark">묵</span><div><b>먹투에 오신 걸 환영해요</b><p>맛있는 성장을 함께 시작해볼까요?</p></div></div><div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>로그인</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>회원가입</button></div><form onSubmit={submit}>{mode === 'signup' && <><div className="role-picker"><button type="button" className={role === 'investor' ? 'active' : ''} onClick={() => setRole('investor')}><UserRound /><span><b>투자자</b><small>맛집을 응원하고 혜택 받기</small></span></button><button type="button" className={role === 'owner' ? 'active' : ''} onClick={() => setRole('owner')}><Store /><span><b>소상공인</b><small>단골에게 펀딩 받기</small></span></button></div><Field label="이름"><input name="name" required placeholder="이름을 입력해주세요" /></Field></>}<Field label="이메일"><input name="email" type="email" required placeholder="hello@meoktu.kr" /></Field><Field label="비밀번호"><input name="password" type="password" required minLength={8} placeholder="8자 이상 입력해주세요" /></Field><button className="button full large" disabled={busy}>{busy ? '잠시만요...' : mode === 'login' ? '로그인' : '먹투 시작하기'}</button></form>{mode === 'login' && <><div className="divider"><span>또는 데모로 바로 보기</span></div><div className="demo-buttons"><button onClick={() => demo('investor')}>😋 투자자 데모</button><button onClick={() => demo('owner')}>👩‍🍳 사장님 데모</button></div></>}<p className="auth-legal">계속하면 먹투의 이용약관과 개인정보처리방침에 동의하게 됩니다.</p></div></div>
}

function Footer() { return <footer><div className="footer-inner"><div><div className="logo footer-logo"><span className="brand-mark">묵</span><span>먹투<small>먹는 투자의 시작</small></span></div><p>좋아하는 식당의 내일을<br />오늘의 단골과 함께 만듭니다.</p></div><div className="footer-links"><div><b>서비스</b><NavLink to="/discover">식당 발견</NavLink><NavLink to="/market">거래장</NavLink><NavLink to="/insight">AI 인사이트</NavLink><NavLink to="/trust">검증 데이터룸</NavLink></div><div><b>사장님</b><NavLink to="/owner">펀딩 심사</NavLink><a href="#">운영 가이드</a><a href="#">쿠폰 손익 관리</a></div><div><b>안내</b><a href="#">이용약관</a><a href="#">개인정보처리방침</a><a href="#">위험 고지</a></div></div></div><div className="footer-bottom"><span>© 2026 먹투. MVP Demo.</span><p>식당·투자·거래 수치는 가상이며, 일부 상권 설명은 출처가 표시된 공공자료를 사용합니다. 금융상품 판매 서비스가 아닙니다.</p></div></footer> }

export default App
