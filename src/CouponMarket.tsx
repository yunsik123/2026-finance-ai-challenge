import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ArrowRight, ArrowLeftRight, Check, Clock3, Filter, Handshake, Inbox, RotateCcw, Search, Send, Ticket, TriangleAlert, WalletCards, X } from 'lucide-react'
import { api } from './lib/api.ts'
import type { Coupon, ExchangeRules, Listing, MarketMine, MeState, PublicState } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const shortDate = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

/**
 * 화면용 사유 안내. 최종 판정은 서버가 다시 하므로 여기서는
 * "왜 이 쿠폰은 못 거는지"를 먼저 알려주는 용도로만 쓴다.
 */
function explain(listing: Listing, mine: Coupon, rules: ExchangeRules): string[] {
  const reasons: string[] = []
  const wanted = listing.coupon
  if (!wanted) return ['매물 정보를 불러오지 못했어요.']
  if (mine.status !== 'available') reasons.push(mine.blockers?.[0] || '지금은 쓸 수 없는 쿠폰이에요.')
  if ((mine.daysLeft ?? 99) < rules.minDaysLeft) reasons.push(`만료 ${rules.minDaysLeft}일 전 쿠폰은 교환할 수 없어요.`)
  if (listing.wantedCategories.length && mine.restaurant && !listing.wantedCategories.includes(mine.restaurant.category)) {
    reasons.push(`원하는 업종: ${listing.wantedCategories.join('·')}`)
  }
  if (listing.wantedRegions.length && mine.restaurant && !listing.wantedRegions.includes(mine.restaurant.region)) {
    reasons.push(`원하는 지역: ${listing.wantedRegions.join('·')}`)
  }
  if (listing.minDiscount > 0 && mine.discount < listing.minDiscount) reasons.push(`최소 할인율 ${listing.minDiscount}% 이상`)
  const gap = Math.abs(mine.discount - wanted.discount)
  if (gap >= rules.maxDiscountGap) reasons.push(`할인율 차이 ${gap.toFixed(1)}%p (${rules.maxDiscountGap}%p 미만이어야 해요)`)
  const high = Math.max(mine.maxDiscountWon, wanted.maxDiscountWon)
  const low = Math.min(mine.maxDiscountWon, wanted.maxDiscountWon)
  if (low > 0 && high / low > rules.maxValueRatio) reasons.push(`액면가 차이 ${(high / low).toFixed(1)}배 (${rules.maxValueRatio}배 이내)`)
  return reasons
}

function CouponTicket({ coupon, restaurant, compact }: { coupon?: Coupon; restaurant?: Listing['restaurant']; compact?: boolean }) {
  const color = restaurant?.color || coupon?.restaurant?.color || '#ff8465'
  const place = restaurant || coupon?.restaurant
  return <div className={`coupon-ticket ${compact ? 'compact' : ''}`} style={{ background: `linear-gradient(145deg, ${color}18, #fff)` }}>
    <span>{place?.emoji || '🎟️'}</span>
    <div>
      <small>{place?.neighborhood ? `${place.neighborhood} · ` : ''}{place?.name}</small>
      <b>{coupon?.discount}%</b>
      <p>{coupon?.title}</p>
    </div>
  </div>
}

/** 어떤 쿠폰을 내줄지 직접 고르는 창. 예전엔 시스템이 임의로 골라 보냈다. */
function OfferComposer({ listing, coupons, rules, busy, onClose, onSubmit }: {
  listing: Listing
  coupons: Coupon[]
  rules: ExchangeRules
  busy: boolean
  onClose: () => void
  onSubmit: (couponId: string, message: string) => void
}) {
  const ranked = useMemo(() => coupons
    .map((coupon) => ({ coupon, eligible: listing.matchableCouponIds.includes(coupon.id), reasons: explain(listing, coupon, rules) }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.coupon.maxDiscountWon - a.coupon.maxDiscountWon), [coupons, listing, rules])
  const [picked, setPicked] = useState(() => ranked.find((item) => item.eligible)?.coupon.id || '')
  const [message, setMessage] = useState('')

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="offer-composer" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="닫기"><X /></button>
      <header>
        <span className="eyebrow coral"><ArrowLeftRight /> 교환 제안</span>
        <h2>어떤 쿠폰을 내주시겠어요?</h2>
        <p>{listing.userName}님은 <b>{listing.wantedRegions.length ? listing.wantedRegions.join('·') : '지역 상관없이'} {listing.wantedCategories.length ? listing.wantedCategories.join('·') : '업종 상관없이'}</b> 쿠폰을 찾고 있어요.</p>
      </header>
      <div className="offer-target"><CouponTicket coupon={listing.coupon} restaurant={listing.restaurant} compact /><ArrowLeftRight /><span>내 쿠폰</span></div>
      <div className="offer-picker">
        {ranked.map(({ coupon, eligible, reasons }) => <button
          key={coupon.id}
          type="button"
          className={`offer-option ${picked === coupon.id ? 'picked' : ''} ${eligible ? '' : 'blocked'}`}
          disabled={!eligible}
          onClick={() => setPicked(coupon.id)}
        >
          <span className="offer-emoji">{coupon.restaurant?.emoji || '🎟️'}</span>
          <div>
            <b>{coupon.restaurant?.name} {coupon.discount}%</b>
            <small>최대 {won(coupon.maxDiscountWon)} · {coupon.daysLeft}일 남음</small>
            {!eligible && <em>{reasons[0]}</em>}
          </div>
          {eligible ? (picked === coupon.id ? <Check /> : <span className="offer-dot" />) : <TriangleAlert />}
        </button>)}
        {!ranked.length && <p className="offer-empty">보유한 쿠폰이 없어요. 투자한 식당에서 쿠폰을 먼저 발급받아 주세요.</p>}
      </div>
      {!listing.autoAccept && <label className="offer-message">
        <span>등록자에게 한마디 (선택)</span>
        <input value={message} maxLength={140} onChange={(event) => setMessage(event.target.value)} placeholder="예: 망원동 자주 가서 잘 쓸게요!" />
      </label>}
      <button className="button full large" disabled={!picked || busy} onClick={() => onSubmit(picked, message)}>
        {busy ? '보내는 중...' : listing.autoAccept ? '바로 교환하기' : '교환 제안 보내기'}
      </button>
      <p className="offer-note">
        {listing.autoAccept
          ? '이 매물은 자동 수락이라 버튼을 누르면 즉시 두 지갑에 반영돼요.'
          : `제안한 쿠폰은 등록자가 답할 때까지 잠깁니다. ${rules.offerTtlDays}일 안에 답이 없으면 자동으로 돌아와요.`}
      </p>
    </div>
  </div>
}

export default function CouponMarket({ state, me, requireLogin, refresh, notify }: {
  state: PublicState
  me: MeState | null
  requireLogin: () => boolean
  refresh: () => Promise<void>
  notify: (message: string) => void
}) {
  const rules = state.exchange.rules
  const [tab, setTab] = useState<'browse' | 'mine'>('browse')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [composing, setComposing] = useState<Listing | null>(null)
  const [mine, setMine] = useState<MarketMine | null>(null)
  const [filters, setFilters] = useState({ category: '', region: '', matchable: false, query: '' })

  const loadMine = useCallback(async () => {
    if (!me) { setMine(null); return }
    try { setMine(await api<MarketMine>('/api/market/mine')) }
    catch (error) { notify((error as Error).message) }
  }, [me])

  useEffect(() => { loadMine() }, [loadMine, state])

  const run = async (id: string, task: () => Promise<{ message: string }>) => {
    if (!requireLogin()) return
    setBusyId(id)
    try { notify((await task()).message); await refresh(); await loadMine() }
    catch (error) { notify((error as Error).message) }
    finally { setBusyId(null) }
  }

  const listings = useMemo(() => state.listings.filter((listing) => {
    if (filters.category && listing.restaurant?.category !== filters.category) return false
    if (filters.region && listing.restaurant?.region !== filters.region) return false
    if (filters.matchable && !listing.matchableCouponIds.length) return false
    if (filters.query) {
      const haystack = `${listing.restaurant?.name} ${listing.coupon?.title} ${listing.note}`.toLocaleLowerCase('ko')
      if (!haystack.includes(filters.query.toLocaleLowerCase('ko'))) return false
    }
    return true
  }).sort((a, b) => Number(b.matchableCouponIds.length > 0) - Number(a.matchableCouponIds.length > 0) || b.createdAt.localeCompare(a.createdAt)),
  [state.listings, filters])

  const myCoupons = (me?.coupons || []).filter((coupon) => coupon.status === 'available')
  const receivedOffers = mine?.listings.flatMap((listing) => listing.offers) || []

  const submitOffer = async (couponId: string, message: string) => {
    const listing = composing
    if (!listing) return
    setBusyId(listing.id)
    try {
      const result = await api<{ message: string }>(`/api/listings/${listing.id}/offers`, {
        method: 'POST', body: JSON.stringify({ couponId, message }),
      })
      notify(result.message)
      setComposing(null)
      await refresh(); await loadMine()
    } catch (error) { notify((error as Error).message) }
    finally { setBusyId(null) }
  }

  return <div className="page-wrap coupon-market-page">
    <div className="page-heading compact">
      <span className="eyebrow coral"><Ticket /> 쿠폰 교환장</span>
      <h1>안 쓰는 혜택을<br />먹고 싶은 혜택으로.</h1>
      <p>원하는 업종·지역을 걸어 올리면, 조건이 맞는 사람만 교환을 제안할 수 있어요.</p>
    </div>

    <div className="market-stats">
      <div><b>{state.exchange.openListings}</b><span>열린 매물</span></div>
      <div><b>{state.exchange.pendingOffers}</b><span>대기 중 제안</span></div>
      <div><b>{state.exchange.completedTrades}</b><span>성사된 교환</span></div>
      <div><b>{myCoupons.length}</b><span>내 교환 가능 쿠폰</span></div>
    </div>

    <ul className="exchange-rules">
      <li><Check /> 할인율 차이 {rules.maxDiscountGap}%p 미만</li>
      <li><Check /> 최대 할인 금액 차이 {rules.maxValueRatio}배 이내</li>
      <li><Check /> 만료 {rules.minDaysLeft}일 이상 남은 쿠폰만</li>
      <li><Check /> 제안한 쿠폰은 결과가 날 때까지 잠금(에스크로)</li>
    </ul>

    <div className="market-tabs">
      <button className={tab === 'browse' ? 'active' : ''} onClick={() => setTab('browse')}><Search /> 교환장 둘러보기</button>
      <button className={tab === 'mine' ? 'active' : ''} onClick={() => { if (requireLogin()) setTab('mine') }}>
        <Inbox /> 내 교환
        {receivedOffers.length > 0 && <i className="tab-badge">{receivedOffers.length}</i>}
      </button>
    </div>

    {tab === 'browse' ? <>
      <div className="market-filters">
        <label className="filter-search"><Search size={16} /><input value={filters.query} placeholder="식당·쿠폰 검색" onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
        <label><Filter size={15} /><select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
          <option value="">모든 업종</option>{state.exchange.categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <label><select value={filters.region} onChange={(event) => setFilters({ ...filters, region: event.target.value })}>
          <option value="">모든 지역</option>{state.exchange.regions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <button className={`filter-toggle ${filters.matchable ? 'on' : ''}`} onClick={() => setFilters({ ...filters, matchable: !filters.matchable })}>
          <Handshake size={15} /> 내가 바꿀 수 있는 것만
        </button>
      </div>

      <div className="coupon-listings enhanced-listings">{listings.map((listing) => {
        const matchable = listing.matchableCouponIds.length
        return <article className={`listing-card enhanced ${listing.mine ? 'mine' : ''} ${matchable ? 'matchable' : ''}`} key={listing.id}>
          <div className="listing-flags">
            {listing.mine && <span className="my-listing-badge">내가 올린 쿠폰</span>}
            <span className={`mode-badge ${listing.autoAccept ? 'instant' : 'approval'}`}>{listing.autoAccept ? '즉시 교환' : '등록자 승인'}</span>
            {!listing.mine && matchable > 0 && <span className="match-badge">내 쿠폰 {matchable}장 교환 가능</span>}
          </div>
          <CouponTicket coupon={listing.coupon} restaurant={listing.restaurant} />
          <div className="swap-wants">
            <ArrowRight />
            <span>바꾸고 싶은 쿠폰<br />
              <b>{listing.wantedRegions.length ? listing.wantedRegions.join('·') : '지역 무관'} · {listing.wantedCategories.length ? listing.wantedCategories.join('·') : '업종 무관'}</b>
              {listing.minDiscount > 0 && <em> · {listing.minDiscount}% 이상</em>}
            </span>
          </div>
          {listing.note && <p className="listing-note">“{listing.note}”</p>}
          <div className="listing-meta">
            <span>{listing.userName}님의 제안</span>
            <small>최대 {won(listing.coupon?.maxDiscountWon || 0)} 할인 · {shortDate(listing.expiresAt)}까지</small>
          </div>
          {listing.offerCount > 0 && <div className="listing-offers-count"><Inbox size={14} /> 받은 제안 {listing.offerCount}건</div>}

          {listing.mine
            ? <button className="button full cancel-listing" disabled={busyId === listing.id}
                onClick={() => run(listing.id, () => api(`/api/listings/${listing.id}`, { method: 'DELETE' }))}>
                <RotateCcw /> {busyId === listing.id ? '돌려받는 중...' : '교환 취소하고 쿠폰 되찾기'}
              </button>
            : listing.myOfferId
              ? <button className="button full secondary" disabled={busyId === listing.id}
                  onClick={() => run(listing.id, () => api(`/api/offers/${listing.myOfferId}`, { method: 'DELETE' }))}>
                  <Clock3 /> 제안 보낸 상태 · 취소하기
                </button>
              : <button className="button full" disabled={busyId === listing.id || (Boolean(me) && !matchable)}
                  onClick={() => { if (requireLogin()) setComposing(listing) }}>
                  {!me ? '로그인하고 교환하기' : matchable ? <><ArrowLeftRight size={16} /> 교환 제안하기</> : '조건에 맞는 내 쿠폰이 없어요'}
                </button>}
        </article>
      })}
        {!listings.length && <div className="market-empty"><span>🎟️</span><b>조건에 맞는 매물이 없어요</b><p>필터를 넓혀보거나, 내 쿠폰을 먼저 교환장에 올려보세요.</p></div>}
        {/* 매물이 적어도 화면이 비어 보이지 않게, 다음 행동을 바로 안내한다. */}
        {listings.length > 0 && <article className="listing-cta">
          <span>🎫</span>
          <b>내 쿠폰도 교환장에 올려보세요</b>
          <p>MY 먹투 쿠폰 지갑에서 원하는 업종·지역을 걸어 올리면<br />조건이 맞는 사람만 교환을 제안할 수 있어요.</p>
          <NavLink to="/my"><WalletCards size={16} /> 쿠폰 지갑 열기</NavLink>
        </article>}
      </div>
    </> : <div className="my-exchange">
      <section>
        <div className="subheading"><div><span>받은 제안</span><h2>수락하면 바로 교환돼요</h2></div><Inbox /></div>
        {mine?.listings.filter((listing) => listing.status === 'open').map((listing) => <article className="exchange-row" key={listing.id}>
          <CouponTicket coupon={listing.coupon} restaurant={listing.restaurant} compact />
          <div className="exchange-offers">
            {listing.offers.length === 0 && <p className="muted">아직 받은 제안이 없어요. 조건을 넓히면 더 많은 제안이 와요.</p>}
            {listing.offers.map((offer) => <div className={`offer-row ${offer.stillValid ? '' : 'stale'}`} key={offer.id}>
              <span className="offer-emoji">{offer.coupon?.restaurant?.emoji || '🎟️'}</span>
              <div>
                <b>{offer.fromUserName}님 · {offer.coupon?.restaurant?.name} {offer.coupon?.discount}%</b>
                <small>최대 {won(offer.coupon?.maxDiscountWon || 0)} · {shortDate(offer.createdAt)}</small>
                {offer.message && <em>“{offer.message}”</em>}
                {!offer.stillValid && <em className="warn">{offer.issues?.[0]?.message}</em>}
              </div>
              <div className="offer-actions">
                <button className="button small" disabled={busyId === offer.id || !offer.stillValid}
                  onClick={() => run(offer.id, () => api(`/api/offers/${offer.id}/accept`, { method: 'POST' }))}>수락</button>
                <button className="button small ghost" disabled={busyId === offer.id}
                  onClick={() => run(offer.id, () => api(`/api/offers/${offer.id}/decline`, { method: 'POST' }))}>거절</button>
              </div>
            </div>)}
          </div>
          <button className="button small ghost" disabled={busyId === listing.id}
            onClick={() => run(listing.id, () => api(`/api/listings/${listing.id}`, { method: 'DELETE' }))}>등록 내리기</button>
        </article>)}
        {!mine?.listings.some((listing) => listing.status === 'open') && <p className="muted">교환장에 올린 쿠폰이 없어요. MY 먹투 지갑에서 올릴 수 있어요.</p>}
      </section>

      <section>
        <div className="subheading"><div><span>보낸 제안</span><h2>상대의 답을 기다리는 중</h2></div><Send /></div>
        <div className="sent-offers">
          {mine?.sentOffers.filter((offer) => offer.status === 'pending').map((offer) => <div className="offer-row" key={offer.id}>
            <span className="offer-emoji">{offer.coupon?.restaurant?.emoji || '🎟️'}</span>
            <div>
              <b>{offer.toUserName}님에게 {offer.coupon?.restaurant?.name} {offer.coupon?.discount}% 제안</b>
              <small>{offer.listing?.restaurant?.name} {offer.listing?.coupon?.discount}% 쿠폰과 교환 희망 · {shortDate(offer.createdAt)}</small>
            </div>
            <button className="button small ghost" disabled={busyId === offer.id}
              onClick={() => run(offer.id, () => api(`/api/offers/${offer.id}`, { method: 'DELETE' }))}>제안 취소</button>
          </div>)}
          {!mine?.sentOffers.some((offer) => offer.status === 'pending') && <p className="muted">보낸 제안이 없어요.</p>}
        </div>
      </section>

      <section>
        <div className="subheading"><div><span>거래 이력</span><h2>지금까지 바꾼 쿠폰</h2></div><ArrowLeftRight /></div>
        <div className="trade-history">
          {mine?.trades.map((trade) => <div className="trade-record" key={trade.id}>
            <small>{shortDate(trade.createdAt)} · {trade.counterpartyName}님 · {trade.mode === 'instant' ? '즉시 교환' : '제안 수락'}</small>
            <div>
              <span className="gave">{trade.gave?.restaurant?.emoji} {trade.gave?.restaurant?.name} {trade.gave?.discount}%</span>
              <ArrowRight size={14} />
              <span className="got">{trade.got?.restaurant?.emoji} {trade.got?.restaurant?.name} {trade.got?.discount}%</span>
            </div>
          </div>)}
          {!mine?.trades.length && <p className="muted">아직 교환한 쿠폰이 없어요.</p>}
        </div>
      </section>
    </div>}

    {composing && <OfferComposer
      listing={composing}
      coupons={myCoupons}
      rules={rules}
      busy={busyId === composing.id}
      onClose={() => setComposing(null)}
      onSubmit={submitOffer}
    />}
  </div>
}
