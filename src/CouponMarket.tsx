import { useState } from 'react'
import { ArrowRight, RotateCcw, Ticket } from 'lucide-react'
import { api } from './lib/api.ts'
import type { MeState, PublicState } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

export default function CouponMarket({ state, me, requireLogin, refresh, notify }: { state: PublicState; me: MeState | null; requireLogin: () => boolean; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const swap = async (listingId: string, discount: number, ownerId: string) => {
    if (!requireLogin()) return
    if (ownerId === me?.user.id) { notify('내가 올린 쿠폰은 직접 교환할 수 없어요.'); return }
    const offered = me?.coupons.find((coupon) => coupon.status === 'available' && Math.abs(coupon.discount - discount) < 10)
    if (!offered) { notify('할인율 차이가 10% 미만인 보유 쿠폰이 필요해요.'); return }
    setBusyId(listingId)
    try { const result = await api<{ message: string }>(`/api/listings/${listingId}/swap`, { method: 'POST', body: JSON.stringify({ couponId: offered.id }) }); notify(result.message); await refresh() }
    catch (error) { notify((error as Error).message) }
    finally { setBusyId(null) }
  }
  const cancel = async (listingId: string) => {
    if (!requireLogin()) return
    setBusyId(listingId)
    try { const result = await api<{ message: string }>(`/api/listings/${listingId}`, { method: 'DELETE' }); notify(result.message); await refresh() }
    catch (error) { notify((error as Error).message) }
    finally { setBusyId(null) }
  }
  return <div className="page-wrap coupon-market-page">
    <div className="page-heading compact"><span className="eyebrow coral"><Ticket /> 쿠폰 교환장</span><h1>안 쓰는 혜택을<br />먹고 싶은 혜택으로.</h1><p>펀드 투자·회수 예약은 각 식당 상세에서 진행하고, 이곳에서는 방문할 수 있는 식당의 쿠폰을 맞바꿔요.</p></div>
    <div className="coupon-market-guide"><div><b>{state.listings.length}</b><span>교환 가능한 쿠폰</span></div><p><Ticket /> 할인율 차이가 10% 미만인 쿠폰끼리만 교환됩니다. 교환 즉시 두 사용자의 지갑에 반영돼요.</p></div>
    <div className="coupon-listings enhanced-listings">{state.listings.map((listing) => {
      const mine = listing.userId === me?.user.id
      return <article className={`listing-card enhanced ${mine ? 'mine' : ''}`} key={listing.id}>
        {mine && <span className="my-listing-badge">내가 올린 쿠폰</span>}
        <div className="coupon-ticket" style={{ background: `linear-gradient(145deg, ${listing.restaurant?.color || '#ff8465'}18, #fff)` }}><span>{listing.restaurant?.emoji || '🎟️'}</span><div><small>{listing.restaurant?.neighborhood} · {listing.restaurant?.name}</small><b>{listing.coupon?.discount}%</b><p>{listing.coupon?.title}</p></div></div>
        <div className="swap-wants"><ArrowRight /><span>바꾸고 싶은 쿠폰<br /><b>{listing.wantedRegion} · {listing.wantedCategory}</b></span></div>
        <div className="listing-meta"><span>{listing.userName}님의 제안</span><small>최대 {won(listing.coupon?.maxDiscountWon || 0)} 할인</small></div>
        {mine
          ? <button className="button full cancel-listing" disabled={busyId === listing.id} onClick={() => cancel(listing.id)}><RotateCcw /> {busyId === listing.id ? '돌려받는 중...' : '교환 취소하고 쿠폰 되찾기'}</button>
          : <button className="button full" disabled={busyId === listing.id} onClick={() => swap(listing.id, listing.coupon?.discount || 0, listing.userId)}>{busyId === listing.id ? '교환 중...' : '내 쿠폰과 교환하기'}</button>}
      </article>
    })}</div>
  </div>
}