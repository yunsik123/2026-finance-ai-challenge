import { useState } from 'react'
import { ArrowLeftRight, CandlestickChart } from 'lucide-react'
import CouponMarket from './CouponMarket.tsx'
import FundOrderbook from './FundOrderbook.tsx'
import type { MeState, PublicState, Restaurant } from './types.ts'

/**
 * 거래장은 두 가지다.
 *   · 쿠폰 교환장 — 가진 쿠폰을 다른 쿠폰과 맞바꾼다 (P2P 에스크로 교환).
 *   · 펀드 예약 거래 — 모금이 끝난 펀드의 투자 자리를 1,000원 단위로 넘겨받는다.
 * 초기 MVP에 있던 예약 거래 화면이 쿠폰 교환장으로 대체되면서 사라졌었다.
 * 서버의 주문 대기열은 그대로 살아 있었으므로 화면만 되돌린다.
 */
export default function MarketPage(props: {
  state: PublicState
  me: MeState | null
  requireLogin: () => boolean
  onSelect: (restaurant: Restaurant) => void
  refresh: () => Promise<void>
  notify: (message: string) => void
}) {
  const [tab, setTab] = useState<'coupon' | 'fund'>('coupon')
  return <div className="market-shell">
    <div className="market-mode-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'coupon'} className={tab === 'coupon' ? 'active' : ''} onClick={() => setTab('coupon')}>
        <ArrowLeftRight /> 쿠폰 교환장
      </button>
      <button role="tab" aria-selected={tab === 'fund'} className={tab === 'fund' ? 'active' : ''} onClick={() => setTab('fund')}>
        <CandlestickChart /> 펀드 예약 거래
      </button>
    </div>
    {tab === 'coupon'
      ? <CouponMarket state={props.state} me={props.me} requireLogin={props.requireLogin} refresh={props.refresh} notify={props.notify} />
      : <div className="page-wrap">
        <div className="page-heading compact">
          <span className="eyebrow coral"><CandlestickChart /> 펀드 예약 거래</span>
          <h1>모금이 끝난 자리를<br />1,000원씩 이어받아요.</h1>
          <p>가격은 1,000원으로 고정이고, 먼저 예약한 순서대로 자리를 넘겨받습니다.</p>
        </div>
        <FundOrderbook {...props} />
      </div>}
  </div>
}
