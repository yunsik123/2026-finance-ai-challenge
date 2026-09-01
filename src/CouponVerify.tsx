import { useState, type FormEvent } from 'react'
import { QrCode, ScanLine, TicketCheck } from 'lucide-react'
import { api } from './lib/api.ts'
import type { Coupon } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

type Verified = { message: string; coupon: Coupon; customerName: string }

/** 손님이 화면에 띄운 코드를 사장님이 입력해 실제 사용 처리하는 창구. */
export default function CouponVerify({ refresh, notify }: { refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<Verified[]>([])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = code.trim().toUpperCase()
    if (!value || busy) return
    setBusy(true)
    try {
      const result = await api<Verified>('/api/owner/coupons/verify', { method: 'POST', body: JSON.stringify({ code: value }) })
      setRecent((current) => [result, ...current].slice(0, 5))
      setCode('')
      notify(result.message)
      await refresh()
    } catch (error) { notify((error as Error).message) }
    finally { setBusy(false) }
  }

  return <section className="coupon-verify">
    <div className="subheading">
      <div><span>매장 쿠폰 확인</span><h2>손님 코드로 쿠폰을 사용 처리하세요</h2></div>
      <ScanLine />
    </div>
    <p className="verify-guide">손님이 MY 먹투 지갑에서 <b>사용하기</b>를 누르면 8자리 코드가 뜹니다. 그 코드를 여기에 입력하면 그 자리에서 사용 처리되고, 대시보드의 실제 사용 혜택에 바로 반영돼요.</p>
    <form className="verify-form" onSubmit={submit}>
      <label>
        <QrCode />
        <input value={code} maxLength={8} placeholder="예: 4F2A9C10" autoComplete="off"
          onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))} />
      </label>
      <button className="button" disabled={code.length !== 8 || busy}>{busy ? '확인 중...' : '쿠폰 확인'}</button>
    </form>
    {recent.length > 0 && <ul className="verify-log">{recent.map((item, index) => <li key={`${item.coupon.id}-${index}`}>
      <TicketCheck />
      <div>
        <b>{item.customerName}님 · {item.coupon.discount}% 할인</b>
        <small>{item.coupon.title} · 최대 {won(item.coupon.maxDiscountWon)} 차감</small>
      </div>
    </li>)}</ul>}
  </section>
}
