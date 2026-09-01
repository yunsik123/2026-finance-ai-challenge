import { useMemo, useState } from 'react'
import { ArrowLeftRight, Check, ChevronRight, Clock3, QrCode, Ticket, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { api } from './lib/api.ts'
import type { Coupon, ExchangeRules, MeState, PublicState } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const shortDate = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

const statusLabel: Record<Coupon['status'], string> = {
  available: '사용 가능',
  listed: '교환장에 등록됨',
  offered: '교환 제안에 걸어둠',
  redeeming: '사장님 확인 대기',
  used: '사용 완료',
  expired: '기간 만료',
}

/** 교환 조건을 직접 고르는 창. 예전엔 '한식·서울'이 코드에 박혀 있었다. */
function ListingComposer({ coupon, categories, regions, rules, busy, onClose, onSubmit }: {
  coupon: Coupon
  categories: string[]
  regions: string[]
  rules: ExchangeRules
  busy: boolean
  onClose: () => void
  onSubmit: (body: { wantedCategories: string[]; wantedRegions: string[]; minDiscount: number; autoAccept: boolean; note: string }) => void
}) {
  const [wantedCategories, setCategories] = useState<string[]>([])
  const [wantedRegions, setRegions] = useState<string[]>([])
  const [minDiscount, setMinDiscount] = useState(0)
  const [autoAccept, setAutoAccept] = useState(true)
  const [note, setNote] = useState('')

  const toggle = (list: string[], set: (value: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value].slice(0, 6))

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="offer-composer" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="닫기"><X /></button>
      <header>
        <span className="eyebrow coral"><Ticket /> 교환장 등록</span>
        <h2>어떤 쿠폰으로 바꾸고 싶으세요?</h2>
        <p><b>{coupon.restaurant?.name} {coupon.discount}%</b> 쿠폰을 올립니다. 조건에 맞는 사람만 교환을 제안할 수 있어요.</p>
      </header>

      <div className="composer-field">
        <span>원하는 업종 <small>비워두면 상관없음</small></span>
        <div className="chip-row">{categories.map((item) => <button key={item} type="button"
          className={wantedCategories.includes(item) ? 'chip on' : 'chip'}
          onClick={() => toggle(wantedCategories, setCategories, item)}>{item}</button>)}</div>
      </div>

      <div className="composer-field">
        <span>원하는 지역 <small>비워두면 상관없음</small></span>
        <div className="chip-row">{regions.map((item) => <button key={item} type="button"
          className={wantedRegions.includes(item) ? 'chip on' : 'chip'}
          onClick={() => toggle(wantedRegions, setRegions, item)}>{item}</button>)}</div>
      </div>

      <div className="composer-field">
        <span>최소 할인율 <b>{minDiscount}%</b></span>
        <input type="range" min={0} max={Math.max(0, Math.floor(coupon.discount + rules.maxDiscountGap - 1))} step={1}
          value={minDiscount} onChange={(event) => setMinDiscount(Number(event.target.value))} />
        <small className="composer-hint">할인율 차이 {rules.maxDiscountGap}%p 미만, 액면가 차이 {rules.maxValueRatio}배 이내라는 기본 규칙은 항상 함께 적용돼요.</small>
      </div>

      <div className="composer-field">
        <span>교환 방식</span>
        <div className="mode-choice">
          <button type="button" className={autoAccept ? 'on' : ''} onClick={() => setAutoAccept(true)}>
            <b>즉시 교환</b><small>조건이 맞으면 바로 체결돼요</small>
          </button>
          <button type="button" className={!autoAccept ? 'on' : ''} onClick={() => setAutoAccept(false)}>
            <b>승인 후 교환</b><small>제안을 보고 내가 고를게요</small>
          </button>
        </div>
      </div>

      <label className="offer-message">
        <span>한마디 (선택)</span>
        <input value={note} maxLength={140} onChange={(event) => setNote(event.target.value)} placeholder="예: 주말에 갈 수 있는 곳이면 좋아요" />
      </label>

      <button className="button full large" disabled={busy}
        onClick={() => onSubmit({ wantedCategories, wantedRegions, minDiscount, autoAccept, note })}>
        {busy ? '등록 중...' : '교환장에 올리기'}
      </button>
      <p className="offer-note">등록하면 이 쿠폰은 교환이 끝나거나 취소할 때까지 잠깁니다. {rules.listingTtlDays}일 뒤 자동으로 내려와요.</p>
    </div>
  </div>
}

export default function CouponWallet({ me, state, refresh, notify }: {
  me: MeState
  state: PublicState
  refresh: () => Promise<void>
  notify: (message: string) => void
}) {
  const rules = state.exchange.rules
  const [busyId, setBusyId] = useState<string | null>(null)
  const [listing, setListing] = useState<Coupon | null>(null)
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [showArchive, setShowArchive] = useState(false)

  const active = useMemo(() => me.coupons.filter((coupon) => !['used', 'expired'].includes(coupon.status)), [me.coupons])
  const archive = useMemo(() => me.coupons.filter((coupon) => ['used', 'expired'].includes(coupon.status)), [me.coupons])
  const totalValue = active.reduce((sum, coupon) => sum + coupon.maxDiscountWon, 0)

  const submitListing = async (body: Record<string, unknown>) => {
    if (!listing) return
    setBusyId(listing.id)
    try {
      const result = await api<{ message: string }>(`/api/coupons/${listing.id}/list`, { method: 'POST', body: JSON.stringify(body) })
      notify(result.message)
      setListing(null)
      await refresh()
    } catch (error) { notify((error as Error).message) }
    finally { setBusyId(null) }
  }

  const redeem = async (coupon: Coupon) => {
    setBusyId(coupon.id)
    try {
      const result = await api<{ message: string; code: string }>(`/api/coupons/${coupon.id}/redeem`, { method: 'POST' })
      setCodes((current) => ({ ...current, [coupon.id]: result.code }))
      notify(result.message)
      await refresh()
    } catch (error) { notify((error as Error).message) }
    finally { setBusyId(null) }
  }

  return <section className="my-section wallet-section">
    <div className="subheading">
      <div><span>내 지갑</span><h2>보유 쿠폰 {active.length}장 · 최대 {won(totalValue)}</h2></div>
      <NavLink to="/market">교환장 가기 <ChevronRight /></NavLink>
    </div>

    {(me.exchange.offersReceived > 0 || me.exchange.offersSent > 0) && <NavLink to="/market" className="wallet-banner">
      <ArrowLeftRight />
      <span>
        {me.exchange.offersReceived > 0 && <b>받은 교환 제안 {me.exchange.offersReceived}건</b>}
        {me.exchange.offersReceived > 0 && me.exchange.offersSent > 0 && ' · '}
        {me.exchange.offersSent > 0 && <>보낸 제안 {me.exchange.offersSent}건 대기 중</>}
      </span>
      <ChevronRight />
    </NavLink>}

    <div className="my-coupons">{active.map((coupon) => {
      const code = codes[coupon.id] || coupon.redeemCode
      const expiring = (coupon.daysLeft ?? 99) < rules.minDaysLeft
      return <article className={`my-coupon ${coupon.status} ${expiring ? 'expiring' : ''}`} key={coupon.id}>
        <span className="coupon-food">{coupon.restaurant?.emoji || '🎟️'}</span>
        <div>
          <small>{coupon.type === 'dividend' ? '깜짝 배당' : coupon.type === 'etf' ? 'ETF 펀드' : '투자 혜택'} · {statusLabel[coupon.status]}</small>
          <h3>{coupon.title}</h3>
          <b>{coupon.discount}% <span>최대 {won(coupon.maxDiscountWon)}</span></b>
          <p>{shortDate(coupon.expiresAt)}까지 · {coupon.daysLeft}일 남음{coupon.acquiredFromUserId ? ' · 교환으로 받은 쿠폰' : ''}</p>
          {expiring && coupon.status === 'available' && <p className="coupon-warn"><Clock3 size={13} /> 만료 {rules.minDaysLeft}일 전이라 교환은 안 되지만 사용은 가능해요.</p>}
        </div>
        {coupon.status === 'redeeming' && code
          ? <div className="redeem-code"><QrCode /><b>{code}</b><small>사장님께 보여주세요<br />{rules.redeemHoldMinutes}분 내 미확인 시 반환</small></div>
          : <div className="coupon-actions">
              <button disabled={coupon.status !== 'available' || busyId === coupon.id} onClick={() => redeem(coupon)}>
                <Check size={14} /> 사용하기
              </button>
              <button className="ghost" disabled={coupon.status !== 'available' || expiring || busyId === coupon.id} onClick={() => setListing(coupon)}>
                <ArrowLeftRight size={14} /> {coupon.status === 'listed' ? '교환 대기 중' : coupon.status === 'offered' ? '제안 중' : '교환장에 올리기'}
              </button>
            </div>}
      </article>
    })}
      {!active.length && <div className="market-empty"><span>🎟️</span><b>아직 보유한 쿠폰이 없어요</b><p>투자한 식당에서 할인율이 10%를 넘으면 쿠폰을 발급할 수 있어요.</p></div>}
    </div>

    {archive.length > 0 && <div className="coupon-archive">
      <button className="archive-toggle" onClick={() => setShowArchive(!showArchive)}>
        지난 쿠폰 {archive.length}장 {showArchive ? '접기' : '보기'} <ChevronRight className={showArchive ? 'flip' : ''} size={15} />
      </button>
      {showArchive && <div className="archive-list">{archive.map((coupon) => <div key={coupon.id}>
        <span>{coupon.restaurant?.emoji}</span>
        <b>{coupon.restaurant?.name} {coupon.discount}%</b>
        <small>{statusLabel[coupon.status]}{coupon.usedAt ? ` · ${shortDate(coupon.usedAt)}` : ''}</small>
      </div>)}</div>}
    </div>}

    {listing && <ListingComposer
      coupon={listing}
      categories={state.exchange.categories}
      regions={state.exchange.regions}
      rules={rules}
      busy={busyId === listing.id}
      onClose={() => setListing(null)}
      onSubmit={submitListing}
    />}
  </section>
}
