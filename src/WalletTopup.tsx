import { useState } from 'react'
import { Check, WalletCards, X } from 'lucide-react'
import { api } from './lib/api.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

export default function WalletTopup({ balance, refresh, notify }: { balance: number; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(100000)
  const [busy, setBusy] = useState(false)
  const topup = async () => {
    setBusy(true)
    try {
      const result = await api<{ message: string; balance: number }>('/api/wallet/topup', { method: 'POST', body: JSON.stringify({ amount }) })
      notify(result.message)
      await refresh()
      setOpen(false)
    } catch (error) { notify((error as Error).message) }
    finally { setBusy(false) }
  }
  return <>
    <button onClick={() => setOpen(true)}>충전하기</button>
    {open && <div className="modal-backdrop wallet-backdrop" onMouseDown={() => setOpen(false)}><section className="topup-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setOpen(false)}><X /></button><span className="topup-icon"><WalletCards /></span><h2>먹투머니 충전</h2><p>결제가 발생하지 않는 MVP 시연용 충전입니다.</p><div className="topup-balance"><span>현재 잔액</span><b>{won(balance)}</b></div><label className="amount-input"><input type="number" min="1000" max="5000000" step="1000" value={amount} onChange={(event) => setAmount(Math.max(1000, Math.floor(Number(event.target.value) / 1000) * 1000))} /><span>원</span></label><div className="topup-options">{[50000,100000,500000,1000000].map((value) => <button className={amount === value ? 'active' : ''} key={value} onClick={() => setAmount(value)}>+{won(value)}</button>)}</div><div className="topup-after"><Check /><span>충전 후 잔액</span><b>{won(balance + amount)}</b></div><button className="button full large" disabled={busy} onClick={topup}>{busy ? '충전 중...' : `${won(amount)} 시연용 충전`}</button><small>실제 카드·계좌 결제, 환불 또는 현금 가치가 발생하지 않습니다.</small></section></div>}
  </>
}