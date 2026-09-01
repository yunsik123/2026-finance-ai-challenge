import { useEffect, useState, type FormEvent } from 'react'
import { Check, Clock3, LifeBuoy, MessageSquare, Send } from 'lucide-react'
import { api } from './lib/api.ts'
import type { MeState, PublicState } from './types.ts'

type SupportType = { id: string; label: string }
type SupportRequest = {
  id: string; type: string; subject: string; description: string
  status: 'received' | 'in_review' | 'answered' | 'closed'
  answer?: string; createdAt: string; answeredAt?: string; restaurantId?: string
}

const statusLabel: Record<SupportRequest['status'], string> = {
  received: '접수 완료', in_review: '확인 중', answered: '답변 완료', closed: '종료',
}

const stamp = (value: string) => new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * 1:1 문의.
 * AI 상담원은 공개된 정보와 절차만 답할 수 있다. 내 계정의 거래나 심사처럼
 * 사람이 확인해야 하는 문제를 넘길 창구가 없어서 사용자가 막다른 길에 놓였었다.
 */
export default function SupportPage({ me, state, onLogin, notify }: {
  me: MeState | null
  state: PublicState
  onLogin: () => void
  notify: (message: string) => void
}) {
  const [types, setTypes] = useState<SupportType[]>([])
  const [requests, setRequests] = useState<SupportRequest[]>([])
  const [type, setType] = useState('investment')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const demo = me?.user.sessionMode === 'demo'

  useEffect(() => {
    if (!me) return
    api<{ requests: SupportRequest[]; types: SupportType[] }>('/api/support/requests')
      .then((result) => { setRequests(result.requests); setTypes(result.types) })
      .catch(() => undefined)
  }, [me])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!me) { onLogin(); return }
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      const result = await api<{ message: string; request: SupportRequest }>('/api/support/requests', {
        method: 'POST',
        body: JSON.stringify({
          type,
          subject: form.get('subject'),
          description: form.get('description'),
          restaurantId: form.get('restaurantId') || undefined,
        }),
      })
      notify(result.message)
      if (!demo) setRequests((current) => [result.request, ...current])
      event.currentTarget.reset()
    } catch (error) { notify((error as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="page-wrap support-page">
    <div className="page-heading compact">
      <span className="eyebrow coral"><LifeBuoy /> 1:1 문의</span>
      <h1>AI가 답하기 어려운 일은<br />사람이 확인해드려요.</h1>
      <p>투자·회수, 쿠폰, 교환장, 심사처럼 내 계정과 관련된 문제를 남겨주세요. 답변은 알림으로 알려드립니다.</p>
    </div>

    <div className="support-layout">
      <form className="support-form" onSubmit={submit}>
        <div className="support-types">
          {(types.length ? types : [{ id: 'investment', label: '투자·회수' }, { id: 'coupon', label: '쿠폰' }, { id: 'exchange', label: '교환장' }, { id: 'owner', label: '사장님 심사' }, { id: 'account', label: '계정·로그인' }, { id: 'other', label: '기타' }])
            .map((item) => <button type="button" key={item.id} className={type === item.id ? 'active' : ''} onClick={() => setType(item.id)}>{item.label}</button>)}
        </div>
        <label className="field"><span>제목</span><input name="subject" required minLength={3} maxLength={100} placeholder="어떤 문제인지 한 줄로 적어주세요" /></label>
        <label className="field"><span>관련 식당 (선택)</span>
          <select name="restaurantId" defaultValue="">
            <option value="">해당 없음</option>
            {state.restaurants.map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}
          </select>
        </label>
        <label className="field"><span>내용</span><textarea name="description" rows={6} required minLength={10} maxLength={2000} placeholder="언제, 어떤 화면에서, 무엇을 하려다 막혔는지 적어주시면 확인이 빨라요." /></label>
        {demo && <p className="support-demo-note">체험 모드에서는 접수 화면까지만 확인할 수 있고 실제로 전달되지는 않아요.</p>}
        <button className="button full large" disabled={busy}>{busy ? '접수하고 있어요...' : me ? '문의 보내기' : '로그인하고 문의하기'} <Send /></button>
        <p className="support-privacy">문의 내용은 답변과 서비스 개선에만 사용하고, 계정 정보 외의 개인정보는 적지 말아주세요.</p>
      </form>

      <aside className="support-history">
        <h2><MessageSquare /> 내 문의 내역</h2>
        {!me && <p className="support-empty">로그인하면 지금까지 남긴 문의와 답변을 볼 수 있어요.</p>}
        {me && !requests.length && <p className="support-empty">아직 남긴 문의가 없어요.</p>}
        {requests.map((request) => <article className={`support-item ${request.status}`} key={request.id}>
          <button onClick={() => setOpenId(openId === request.id ? null : request.id)}>
            <div>
              <b>{request.subject}</b>
              <small><Clock3 /> {stamp(request.createdAt)}</small>
            </div>
            <span className={`support-status ${request.status}`}>{request.status === 'answered' ? <Check /> : null}{statusLabel[request.status]}</span>
          </button>
          {openId === request.id && <div className="support-detail">
            <p>{request.description}</p>
            {request.answer
              ? <div className="support-answer"><b>먹투 답변</b><p>{request.answer}</p>{request.answeredAt && <small>{stamp(request.answeredAt)}</small>}</div>
              : <p className="support-waiting">확인 중이에요. 답변이 등록되면 알림으로 알려드릴게요.</p>}
          </div>}
        </article>)}
      </aside>
    </div>
  </div>
}
