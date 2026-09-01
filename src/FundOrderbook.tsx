import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Clock3, Info, ListOrdered, RotateCcw, ShieldCheck, Store, TrendingUp } from 'lucide-react'
import { api } from './lib/api.ts'
import type { MeState, PublicState, Restaurant } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const compactWon = (value: number) => value >= 100000000 ? `${(value / 100000000).toFixed(1)}억원` : `${Math.round(value / 10000).toLocaleString()}만원`
const sinceLabel = (value: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 60) return `${minutes}분 대기`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}시간 대기`
  return `${Math.round(minutes / (60 * 24))}일 대기`
}

type QueueEntry = { rank: number; amount: number; amountAhead: number; waitingSince: string; mine: boolean; orderId?: string }
type Book = {
  fundId: string; restaurantId?: string; restaurantName?: string; emoji?: string
  neighborhood?: string; category?: string; color?: string
  goal: number; raised: number; maxDiscount: number
  buyQueue: QueueEntry[]; sellQueue: QueueEntry[]
  buyTotal: number; sellTotal: number; myPosition: number
}

/**
 * 모금이 끝난 펀드의 예약 대기열.
 *
 * 먹투에서 1,000원의 값은 변하지 않으므로 가격 호가창이 아니라 "줄 서기"를 보여준다.
 * 투자자가 알아야 하는 건 호가가 아니라 "내 앞에 얼마가 있고 언제쯤 차례가 오는가"다.
 */
export default function FundOrderbook({ state, me, requireLogin, onSelect, refresh, notify }: {
  state: PublicState
  me: MeState | null
  requireLogin: () => boolean
  onSelect: (restaurant: Restaurant) => void
  refresh: () => Promise<void>
  notify: (message: string) => void
}) {
  const [books, setBooks] = useState<Book[]>([])
  const [rule, setRule] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await api<{ rule: string; books: Book[] }>('/api/market/orderbook')
      setBooks(result.books); setRule(result.rule)
    } catch (error) { notify((error as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load, state])

  const cancel = async (orderId: string) => {
    if (!requireLogin()) return
    setBusy(orderId)
    try {
      const result = await api<{ message: string }>(`/api/orders/${orderId}`, { method: 'DELETE' })
      notify(result.message); await refresh(); await load()
    } catch (error) { notify((error as Error).message) }
    finally { setBusy('') }
  }

  const open = (book: Book) => {
    const restaurant = state.restaurants.find((item) => item.id === book.restaurantId)
    if (restaurant) onSelect(restaurant)
  }

  if (loading) return <div className="orderbook-loading">예약 대기열을 불러오는 중...</div>

  const totalBuy = books.reduce((sum, book) => sum + book.buyTotal, 0)
  const totalSell = books.reduce((sum, book) => sum + book.sellTotal, 0)
  const myOpenOrders = books.reduce((sum, book) => sum + [...book.buyQueue, ...book.sellQueue].filter((entry) => entry.mine).length, 0)

  return <section className="orderbook-section">
    <div className="orderbook-overview">
      <div><span><ListOrdered /> FIFO RESERVATION</span><h2>가격 경쟁 없이<br />먼저 선 순서만 지켜요.</h2><p>{rule}</p></div>
      <div className="orderbook-summary"><article><Store /><span>거래 가능 펀드</span><b>{books.length}곳</b></article><article className="buy"><ArrowDownToLine /><span>전체 투자 대기</span><b>{won(totalBuy)}</b></article><article className="sell"><ArrowUpFromLine /><span>전체 회수 대기</span><b>{won(totalSell)}</b></article><article><ShieldCheck /><span>내 대기 주문</span><b>{myOpenOrders}건</b></article></div>
    </div>
    <div className="orderbook-guide"><div><b>1</b><span><strong>식당 선택</strong><small>모금이 끝난 펀드를 고릅니다.</small></span></div><i /><div><b>2</b><span><strong>1,000원 단위 예약</strong><small>투자 또는 회수 금액을 예약합니다.</small></span></div><i /><div><b>3</b><span><strong>순서대로 자동 체결</strong><small>반대 주문이 오면 앞순서부터 교대합니다.</small></span></div></div>
    <div className="orderbook-rule"><Info /><p>대기 금액은 수익률이나 시세가 아닙니다. 투자금 1,000원의 가치는 항상 1,000원으로 고정됩니다.</p></div>
    {!books.length && <div className="empty"><span>⏳</span><b>지금은 모금이 끝난 펀드가 없어요</b><p>모금 중인 펀드는 식당 발견에서 바로 투자하고 언제든 회수할 수 있어요.</p></div>}
    <div className="orderbook-grid">
      {books.map((book) => <article className="orderbook-card" key={book.fundId}>
        <div className="orderbook-head" onClick={() => open(book)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') open(book) }}>
          <span className="orderbook-emoji" style={{ background: `${book.color || '#ff8465'}28` }}>{book.emoji}</span>
          <div>
            <b>{book.restaurantName}</b>
            <small>{book.neighborhood} · {book.category}</small>
          </div>
          <div className="orderbook-head-badges"><span className="orderbook-raised"><TrendingUp /> {compactWon(book.raised)} 모집완료</span><span>최대 쿠폰 {book.maxDiscount}%</span></div>
        </div>

        <div className="orderbook-queues">
          <div className="queue buy">
            <div className="queue-head"><ArrowDownToLine /><b>투자 대기</b><span>{won(book.buyTotal)}</span></div>
            {book.buyQueue.length ? book.buyQueue.slice(0, 5).map((entry) => <div className={`queue-row ${entry.mine ? 'mine' : ''}`} key={`${entry.rank}-${entry.waitingSince}`}>
              <span className="queue-rank">{entry.rank}</span>
              <b>{won(entry.amount)}</b>
              <small><Clock3 /> {sinceLabel(entry.waitingSince)}{entry.amountAhead > 0 ? ` · 내 앞 ${won(entry.amountAhead)}` : ' · 맨 앞 순서'}</small>
              {entry.mine && entry.orderId && <button disabled={busy === entry.orderId} onClick={() => cancel(entry.orderId!)}><RotateCcw /> 취소</button>}
            </div>) : <p className="queue-empty">사려는 사람이 아직 없어요.</p>}
          </div>

          <div className="queue sell">
            <div className="queue-head"><ArrowUpFromLine /><b>회수 대기</b><span>{won(book.sellTotal)}</span></div>
            {book.sellQueue.length ? book.sellQueue.slice(0, 5).map((entry) => <div className={`queue-row ${entry.mine ? 'mine' : ''}`} key={`${entry.rank}-${entry.waitingSince}`}>
              <span className="queue-rank">{entry.rank}</span>
              <b>{won(entry.amount)}</b>
              <small><Clock3 /> {sinceLabel(entry.waitingSince)}{entry.amountAhead > 0 ? ` · 내 앞 ${won(entry.amountAhead)}` : ' · 맨 앞 순서'}</small>
              {entry.mine && entry.orderId && <button disabled={busy === entry.orderId} onClick={() => cancel(entry.orderId!)}><RotateCcw /> 취소</button>}
            </div>) : <p className="queue-empty">나오려는 사람이 아직 없어요.</p>}
          </div>
        </div>

        {/* styles.css 의 전역 footer 규칙(회색 배경 · 큰 패딩)이 걸리므로 div 로 둔다. */}
        <div className="orderbook-foot">
          {book.myPosition > 0 ? <span className="orderbook-mine"><Banknote /> 내 투자금 <b>{won(book.myPosition)}</b></span> : <span className="orderbook-mine muted">현재 보유 투자금 없음</span>}
          <button className="button small" onClick={() => open(book)}>예약 걸기 · 상세 보기</button>
        </div>
      </article>)}
    </div>
    <p className="orderbook-note">
      펀드 총액은 유지되고 투자자만 1,000원 단위로 순서대로 교대해요. 매수자가 없으면 회수가 늦어질 수 있고, 회수 시점은 보장되지 않습니다.
      {me?.user.sessionMode === 'demo' && ' 체험 모드에서는 반대 주문 없이 바로 체결되는 것으로 보여줍니다.'}
    </p>
  </section>
}
