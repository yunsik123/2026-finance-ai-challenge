import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BadgeCheck, BarChart3, Check, Clock3, HandCoins, LockKeyhole, ShieldCheck, Star, Ticket, TrendingUp, WalletCards, X } from 'lucide-react'
import { api } from './lib/api.ts'
import { useAmountInput } from './lib/amount.ts'
import CommercialAreaPanel from './CommercialAreaPanel.tsx'
import type { CommercialAreaView, MeState, Restaurant, SalesPoint } from './types.ts'
import './fund-detail-preview.css'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const compactWon = (value: number) => value >= 100000000 ? `${(value / 100000000).toFixed(1)}억원` : `${Math.round(value / 10000).toLocaleString()}만원`

interface Props {
  restaurant: Restaurant
  me: MeState | null
  onClose: () => void
  onLogin: () => void
  refresh: () => Promise<void>
  notify: (message: string) => void
}

function RevenueChart({ restaurant }: { restaurant: Restaurant }) {
  const history = restaurant.salesHistory || []
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, history.length - 1))
  if (!restaurant.salesDisclosure || !history.length) {
    return <section className="sales-private"><LockKeyhole /><div><b>월별 매출액은 비공개예요</b><p>사장님이 정확한 매출 공개를 선택하지 않았습니다. 먹투가 검증한 성장지수와 보너스 결과만 심사에 반영해요.</p></div></section>
  }
  const width = 720
  const height = 230
  const padX = 34
  const padY = 26
  const min = Math.min(...history.map((point) => point.sales)) * .96
  const max = Math.max(...history.map((point) => point.sales)) * 1.04
  const pointAt = (point: SalesPoint, index: number) => ({
    x: padX + index * ((width - padX * 2) / Math.max(1, history.length - 1)),
    y: height - padY - ((point.sales - min) / Math.max(1, max - min)) * (height - padY * 2),
  })
  const points = history.map(pointAt)
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `${padX},${height - padY} ${line} ${width - padX},${height - padY}`
  const selected = history[selectedIndex]
  return <section className="revenue-section">
    <div className="detail-section-head"><div><span>가상 POS 검증 데이터</span><h3>월매출 성장과 쿠폰 보너스</h3></div><div className="chart-legend"><i /> 월매출 <b>●</b> 매출 보너스</div></div>
    <div className="chart-summary"><div><span>{selected.month.replace('-', '.')}</span><b>{compactWon(selected.sales)}</b></div><div><span>전월 대비</span><b className={selected.growthRate >= 0 ? 'up' : 'down'}>{selected.growthRate >= 0 ? '+' : ''}{selected.growthRate}%</b></div><div><span>이달 매출 보너스</span><b className="bonus">+{selected.bonusRate}%</b></div></div>
    <div className="sales-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${restaurant.name} 월매출 추이`}>
        <defs><linearGradient id={`sales-gradient-${restaurant.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={restaurant.color} stopOpacity=".3" /><stop offset="1" stopColor={restaurant.color} stopOpacity=".02" /></linearGradient></defs>
        {[0,1,2,3].map((lineIndex) => <line key={lineIndex} x1={padX} x2={width-padX} y1={padY + lineIndex * ((height-padY*2)/3)} y2={padY + lineIndex * ((height-padY*2)/3)} className="chart-grid-line" />)}
        <polygon points={area} fill={`url(#sales-gradient-${restaurant.id})`} />
        <polyline points={line} fill="none" stroke={restaurant.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => <g key={history[index].month} className="chart-point" onClick={() => setSelectedIndex(index)} role="button" tabIndex={0}>
          <circle cx={point.x} cy={point.y} r={index === selectedIndex ? 8 : 5} fill={index === selectedIndex ? restaurant.color : '#fff'} stroke={restaurant.color} strokeWidth="3" />
          <text x={point.x} y={height - 6} textAnchor="middle">{history[index].month.slice(5)}월</text>
        </g>)}
      </svg>
    </div>
    <div className="bonus-timeline">{history.map((point, index) => <button className={index === selectedIndex ? 'active' : ''} key={point.month} onClick={() => setSelectedIndex(index)}><span>{point.month.slice(5)}월</span><b>+{point.bonusRate}%</b></button>)}</div>
    <p className="data-caption">식당·매출 수치는 MVP 시연용 가상 데이터입니다. 공개 여부는 사장님이 선택하며, 보너스 계산 이력은 투자자에게 남습니다.</p>
  </section>
}

export default function FundDetailModal({ restaurant: r, me, onClose, onLogin, refresh, notify }: Props) {
  const { amount, setAmount, commit: commitAmount, bind: amountBind } = useAmountInput(50000)
  const [tab, setTab] = useState<'invest' | 'withdraw'>('invest')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [riskAccepted, setRiskAccepted] = useState(false)
  // 상권 분석은 이 모달을 열 때만 필요하므로 별도로 가져온다.
  const [area, setArea] = useState<CommercialAreaView | undefined>()
  useEffect(() => {
    let live = true
    setArea(undefined)
    api<{ assessment: { commercialArea?: CommercialAreaView } }>(`/api/trust/${r.id}`)
      .then((result) => { if (live) setArea(result.assessment.commercialArea) })
      .catch(() => undefined)
    return () => { live = false }
  }, [r.id])
  const [lastResult, setLastResult] = useState<{ message: string; matched?: number; queued?: number } | null>(null)
  const [rating, setRating] = useState(5)
  const [reviewText, setReviewText] = useState('')
  const position = me?.positions.find((item) => item.fundId === r.fund.id)
  const openOrders = me?.orders.filter((order) => order.fundId === r.fund.id && ['open','partial'].includes(order.status)) || []
  const openOrder = openOrders[0]
  const progress = Math.min(100, Math.round(r.fund.raised / r.fund.goal * 100))
  const riskTone = r.fund.riskLevel === '낮음' ? 'low' : r.fund.riskLevel === '보통' ? 'medium' : 'high'
  const max = Math.floor(r.fund.goal * .01 / 1000) * 1000
  const pendingBuy = openOrders.filter((order) => order.type === 'buy').reduce((sum, order) => sum + order.remaining, 0)
  const remainingLimit = Math.max(0, max - (position?.amount || 0) - pendingBuy)
  const hasVisitProof = me?.visitVerifications.some((item) => item.restaurantId === r.id && !item.usedForReview)
  const effectiveSalesBonus = r.fund.salesBonus * (position?.early ? 1 + r.fund.earlyBonus / 100 : 1)
  const orderBook = useMemo(() => r.fund.openBuyAmount > 0
    ? { kind: 'buy', label: '투자 예약 대기', amount: r.fund.openBuyAmount, note: '회수 주문이 들어오면 즉시 1,000원씩 체결돼요.' }
    : r.fund.openSellAmount > 0
      ? { kind: 'sell', label: '회수 대기', amount: r.fund.openSellAmount, note: '투자 예약을 넣으면 앞선 주문부터 즉시 체결돼요.' }
      : { kind: 'empty', label: '대기 주문 없음', amount: 0, note: '지금 주문하면 반대 주문이 생길 때 자동으로 체결돼요.' }, [r.fund.openBuyAmount, r.fund.openSellAmount])

  const transact = async () => {
    if (!me) { onLogin(); return }
    setBusy(true)
    try {
      const result = await api<{ message: string; matched: number; queued: number }>(`/api/funds/${r.fund.id}/${tab}`, { method: 'POST', body: JSON.stringify({ amount }) })
      setLastResult(result)
      setConfirming(false)
      setRiskAccepted(false)
      notify(result.message)
      await refresh()
    } catch (error) { notify((error as Error).message) }
    finally { setBusy(false) }
  }
  const reviewTransaction = () => {
    if (!me) { onLogin(); return }
    // 확인창과 서버로 나가는 금액을 1,000원 단위로 맞춘 뒤 열어준다.
    commitAmount()
    setRiskAccepted(false)
    setConfirming(true)
  }
  const issueCoupon = async () => {
    if (!position) return
    setBusy(true)
    try { const result = await api<{ message: string }>(`/api/positions/${position.id}/coupon`, { method: 'POST' }); notify(result.message); await refresh() }
    catch (error) { notify((error as Error).message) }
    finally { setBusy(false) }
  }
  const cancelOrder = async () => {
    if (!openOrder) return
    try { const result = await api<{ message: string }>(`/api/orders/${openOrder.id}`, { method: 'DELETE' }); setLastResult({ message: result.message }); notify(result.message); await refresh() }
    catch (error) { notify((error as Error).message) }
  }
  const verifyVisit = async () => {
    if (!me) { onLogin(); return }
    try { const result = await api<{ message: string }>(`/api/restaurants/${r.id}/visit/verify`, { method: 'POST' }); notify(result.message); await refresh() }
    catch (error) { notify((error as Error).message) }
  }
  const postReview = async () => {
    try { const result = await api<{ message: string }>(`/api/restaurants/${r.id}/reviews`, { method: 'POST', body: JSON.stringify({ rating, content: reviewText }) }); notify(result.message); setReviewText(''); await refresh() }
    catch (error) { notify((error as Error).message) }
  }

  return <div className="modal-backdrop detail-backdrop" onMouseDown={onClose}>
    <div className="fund-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="닫기"><X /></button>
      <main className="fund-detail-scroll">
        <div className="fund-hero enhanced" style={{ background: `linear-gradient(145deg, ${r.color}28, ${r.color}70)` }}><span>{r.emoji}</span><div><small>{r.neighborhood} · {r.category}</small><h2>{r.name}</h2><p>{r.tagline}</p><div className="hero-rating"><Star fill="currentColor" /> {r.rating.toFixed(1)} <span>방문 리뷰 {r.reviewCount.toLocaleString()}개</span></div></div></div>
        <div className="fund-detail-content">
          {area && <CommercialAreaPanel area={area} category={r.category} compact />}
          {(position || openOrder) && <section className="my-investment-panel">
            <div className="my-investment-title"><span><Check /> 내 투자 현황</span><b>{position?.early ? '최초 투자자 · 계속 우대' : '일반 투자자'}</b></div>
            <div className="my-investment-grid"><div><span>현재 투자금</span><strong>{won(position?.amount || 0)}</strong></div><div><span>쌓인 쿠폰 할인율</span><strong>{(position?.couponProgress || 0).toFixed(1)}%</strong></div><div><span>실제 매출 보너스</span><strong>+{effectiveSalesBonus.toFixed(1)}%</strong></div></div>
            {position && <><div className="coupon-progress-row"><div className="progress-track coupon"><i style={{ width: `${Math.min(100, position.couponProgress / r.fund.maxDiscount * 100)}%` }} /></div><span>{r.fund.minIssueDiscount}%부터 발급 · 최대 {r.fund.maxDiscount}%</span></div><div className="my-investment-actions"><button disabled={position.couponProgress < r.fund.minIssueDiscount || busy} onClick={issueCoupon}><Ticket /> 지금 쿠폰 발급</button><button onClick={() => setTab('withdraw')}><HandCoins /> 투자금 회수</button></div></>}
            {position?.early && <p className="early-benefit"><TrendingUp /> 일회성 점프가 아니라, 투자금을 보유하는 동안 매월 매출 보너스를 일반 투자자보다 <b>{r.fund.earlyBonus}% 더 받아요.</b></p>}
            {openOrder && <div className="my-open-order"><div><Clock3 /><span><b>{openOrder.type === 'buy' ? '투자 예약' : '회수 주문'} {won(openOrder.remaining)} 대기 중</b><small>체결된 금액은 자동으로 내 투자금과 잔액에 반영됩니다.</small></span></div><button onClick={cancelOrder}>대기 취소</button></div>}
          </section>}
          {lastResult && <div className="transaction-result"><Check /><div><b>{lastResult.message}</b>{typeof lastResult.matched === 'number' && <p>즉시 체결 {won(lastResult.matched)} · 대기 {won(lastResult.queued || 0)}</p>}</div></div>}
          <div className="detail-tags"><span><BadgeCheck /> 기초 심사 완료</span><span><BarChart3 /> 기회점수 {r.opportunityScore}</span><span className={`risk-badge risk-${riskTone}`}><ShieldCheck /> 위험도 {r.fund.riskLevel}</span></div>
          <section className="decision-summary">
            <div className="decision-summary-head"><div><span>투자 전 한눈에 보기</span><h3>돈의 용도와 회수 조건부터 확인하세요</h3></div><ShieldCheck /></div>
            <div className="decision-facts">
              <article><HandCoins /><span>현재 모집</span><b>{compactWon(r.fund.raised)}</b><small>목표 {compactWon(r.fund.goal)} · {progress}% 달성</small></article>
              <article><WalletCards /><span>자금 사용처</span><b>{r.fund.purpose}</b><small>모집된 금액은 표시된 사업 목적에 사용돼요.</small></article>
              <article><BarChart3 /><span>개인 투자 한도</span><b>{compactWon(max)}</b><small>먹투 자체 투기 방지 기준 · 법정 투자한도는 별도 적용</small></article>
              <article><Clock3 /><span>회수 방식</span><b>{r.fund.status === 'funding' ? '모금 중 바로 회수' : '예약 순서대로 매칭'}</b><small>{r.fund.status === 'funding' ? '현재 모금 단계에서 요청할 수 있어요.' : orderBook.note}</small></article>
            </div>
            <div className="decision-risk"><AlertTriangle /><div><b>손실·유동성 위험</b><p>원금과 회수 시점은 보장되지 않으며, 모금 종료 후에는 다른 투자자의 예약이 있어야 회수될 수 있어요. 쿠폰은 금융수익이 아니라 해당 식당에서 사용하는 할인 혜택입니다.</p></div></div>
            <div className="decision-source"><BadgeCheck /><span><b>데이터 기준</b> 펀딩 시작 {new Date(r.fund.startedAt).toLocaleDateString('ko-KR')} · 종료 예정 {new Date(r.fund.endsAt).toLocaleDateString('ko-KR')}</span><em>MVP 시연 데이터</em></div>
          </section>
          <section className="restaurant-story"><span>이 식당은요</span><h3>{r.foodDescription || r.description}</h3><p>{r.story}</p><div className="strength-list">{r.strengths?.map((strength) => <span key={strength}><Check /> {strength}</span>)}</div></section>
          <section className="menu-detail-section"><div className="detail-section-head"><div><span>음식과 메뉴</span><h3>무엇을 잘하는 식당인가요?</h3></div></div><div className="menu-detail-grid">{r.menuHighlights?.map((menu) => <article key={menu.name}><span>{r.emoji}</span><div><b>{menu.name}</b><p>{menu.description}</p></div><strong>{won(menu.price)}</strong></article>)}</div><p className="dining-note">💡 {r.diningNotes}</p></section>
          <section className="fund-overview"><div className="fund-big-progress"><div><span>{r.fund.status === 'funding' ? `${progress}% 모였어요` : '모금 완료 · 예약 거래 중'}</span><strong>{compactWon(r.fund.raised)} <small>/ {compactWon(r.fund.goal)}</small></strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div></div><p>자금 사용처 · {r.fund.purpose}</p><div className="metric-grid"><div><span>매출 성장지수</span><b>+{r.salesGrowth}%</b></div><div><span>재방문율</span><b>{r.repeatRate}%</b></div><div><span>운영 이력</span><b>{r.openedYears}년</b></div><div><span>주변 폐업률</span><b>{r.closingRate}%</b></div></div></section>
          <RevenueChart restaurant={r} />
          <section className="reviews-section"><div className="detail-section-head"><div><span>방문 인증 리뷰</span><h3>실제 손님은 어떻게 느꼈을까요?</h3></div><b className="review-score"><Star fill="currentColor" /> {r.rating.toFixed(1)}</b></div><div className="review-list">{r.reviews?.map((review) => <article key={review.id}><div><b>{review.userName}</b><span>{'★'.repeat(review.rating)}{'☆'.repeat(5-review.rating)}</span></div><p>{review.content}</p><small><BadgeCheck /> 방문 인증 · {new Date(review.createdAt).toLocaleDateString('ko-KR')}</small></article>)}</div><div className="review-compose">{!hasVisitProof ? <button className="verify-visit" onClick={verifyVisit}><BadgeCheck /> 방문 인증하고 리뷰 쓰기 <small>MVP에서는 시연용으로 즉시 인증됩니다.</small></button> : <><div className="rating-picker">{[1,2,3,4,5].map((value) => <button className={value <= rating ? 'active' : ''} onClick={() => setRating(value)} key={value}>★</button>)}</div><textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} placeholder="음식과 서비스에 대한 솔직한 경험을 10자 이상 적어주세요." /><button className="button" onClick={postReview}>리뷰 등록</button></>}</div></section>
        </div>
      </main>
      <aside className="detail-order-panel">
        <div className="order-tabs"><button className={tab === 'invest' ? 'active' : ''} onClick={() => setTab('invest')}>투자하기</button><button className={tab === 'withdraw' ? 'active' : ''} onClick={() => setTab('withdraw')}>회수하기</button></div>
        {r.fund.status === 'trading' && <div className={`orderbook-card ${orderBook.kind}`}><span>{orderBook.label}</span><b>{won(orderBook.amount)}</b><p>{orderBook.note}</p></div>}
        <div className="balance-row"><span>{tab === 'invest' ? '보유 먹투머니' : '회수 가능 금액'}</span><b>{won(tab === 'invest' ? me?.user.cash || 0 : position?.availableAmount || 0)}</b></div>
        <label className="amount-input"><input aria-label={tab === 'invest' ? '투자 금액' : '회수 금액'} {...amountBind} /><span>원</span></label>
        <div className="quick-amounts">{[10000,50000,100000].map((value) => <button key={value} onClick={() => setAmount(value)}>+{value/10000}만</button>)}<button onClick={() => setAmount(tab === 'invest' ? Math.min(me?.user.cash || 0, remainingLimit) : position?.availableAmount || 0)}>최대</button></div>
        {tab === 'invest' && <div className="limit-note"><span>남은 개인 투자 한도</span><b>{won(remainingLimit)}</b></div>}
        <div className="benefit-preview"><Ticket /><div><span>혜택 적립 속도</span><b>10만원당 하루 {r.fund.dailyRatePer100k}%</b><p>매출 보너스 +{r.fund.salesBonus}%{position?.early ? ` · 최초 투자자 적용 +${effectiveSalesBonus.toFixed(1)}%` : r.fund.status === 'funding' ? ` · 최초 투자자는 매출 보너스 ${r.fund.earlyBonus}% 우대` : ''}</p></div></div>
        <button className="button full large" disabled={busy || (tab === 'withdraw' && !position)} onClick={reviewTransaction}>{busy ? '처리 중...' : !me ? '로그인하고 시작하기' : tab === 'invest' ? r.fund.status === 'funding' ? '투자하기' : '투자 예약 확인하기' : r.fund.status === 'funding' ? '회수 내용 확인하기' : '회수 주문 확인하기'}</button>
        <p className="order-risk">원금과 회수 시점은 보장되지 않아요. 대기 주문은 이 화면에서 취소할 수 있습니다.</p>
      </aside>
      {confirming && <div className="trade-confirm-backdrop" onMouseDown={() => setConfirming(false)}><section className="trade-confirm" onMouseDown={(event) => event.stopPropagation()}>
        <button className="trade-confirm-close" onClick={() => setConfirming(false)} aria-label="확인창 닫기"><X /></button>
        <span className="eyebrow coral">최종 확인</span><h3>{tab === 'invest' ? '투자 조건을 확인해주세요' : '회수 조건을 확인해주세요'}</h3>
        <dl><div><dt>식당</dt><dd>{r.name}</dd></div><div><dt>{tab === 'invest' ? '투자 금액' : '회수 요청'}</dt><dd>{won(amount)}</dd></div><div><dt>처리 방식</dt><dd>{r.fund.status === 'funding' ? '즉시 반영' : '1,000원 단위 예약 매칭'}</dd></div>{tab === 'invest' && <div><dt>쿠폰 조건</dt><dd>{r.fund.minIssueDiscount}%부터 발급 · 최대 {r.fund.maxDiscount}%</dd></div>}</dl>
        <label className="risk-confirm-check"><input type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} /><span><i className="risk-checkbox" aria-hidden="true">{riskAccepted && <Check />}</i><AlertTriangle /><b>원금과 회수 시점이 보장되지 않으며 쿠폰은 금융수익이 아님을 확인했습니다.</b></span></label>
        <button className="button full large" disabled={!riskAccepted || busy} onClick={transact}>{busy ? '처리 중...' : tab === 'invest' ? '확인하고 투자하기' : '확인하고 회수 요청하기'}</button>
      </section></div>}
    </div>
  </div>
}
