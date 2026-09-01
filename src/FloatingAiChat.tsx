import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Bot, Database, MessageCircle, Sparkles, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { api } from './lib/api.ts'
import type { Role } from './types.ts'

type Source = { id: string; label: string; type: string }
type Message = { role: 'user' | 'ai'; text: string; sources?: Source[] }

export default function FloatingAiChat({ role }: { role: Role }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [mode, setMode] = useState('graph-rag-local')
  const online = mode.includes('generative')
  const intro = role === 'owner'
    ? '안녕하세요, 사장님! 내 심사 현황과 필요한 자료, 추가 펀딩, 쿠폰 확인, 경영 리포트까지 현재 원장과 화면 순서에 맞춰 안내해드릴게요. 😊'
    : '안녕하세요! 내 투자·쿠폰·예약 거래 현황과 식당 정보, 화면 이용 방법을 현재 원장에 맞춰 안내해드릴게요. 😊'
  const [messages, setMessages] = useState<Message[]>([{ role: 'ai', text: intro }])
  const scrollRef = useRef<HTMLDivElement>(null)
  const suggestions = role === 'owner'
    ? ['내 심사는 지금 몇 단계야?', '내 가게 모금과 쿠폰 부담 현황 알려줘', '추가 펀딩은 어디서 시작해?']
    : ['내 쿠폰과 예약 주문 현황 알려줘', '쿠폰은 어디서 사용하고 교환해?', '투자금은 어떻게 회수해?']

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, asking, open])
  useEffect(() => { setMessages([{ role: 'ai', text: intro }]); setQuestion('') }, [role])

  const ask = async (suggestion?: string) => {
    const value = (suggestion || question).trim()
    if (!value || asking) return
    setOpen(true); setQuestion(''); setAsking(true)
    setMessages((current) => [...current, { role: 'user', text: value }])
    try {
      const result = await api<{ answer: string; mode: string; sources?: Source[] }>('/api/ai/chat', {
        method: 'POST', body: JSON.stringify({ question: value, role, currentPath: location.pathname }),
      })
      setMode(result.mode)
      setMessages((current) => [...current, { role: 'ai', text: result.answer, sources: result.sources }])
    } catch (error) {
      setMessages((current) => [...current, { role: 'ai', text: `잠시 연결이 원활하지 않아요. ${(error as Error).message}` }])
    } finally { setAsking(false) }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); ask() }
  return <div className={`floating-ai ${open ? 'open' : ''}`}>
    {open && <section className="floating-ai-panel" aria-label="먹투 AI 상담">
      <header><span className="floating-ai-avatar"><Bot /></span><div><b>먹투 AI 상담원</b><small><i /> {online ? '상담 가능' : '기본 안내 모드'}</small></div><button onClick={() => setOpen(false)} aria-label="AI 상담 닫기"><X /></button></header>
      <div className="floating-ai-context"><Database /><span><b>{role === 'owner' ? '사장님 상담' : '투자자 상담'}</b> · 현재 화면과 {role === 'owner' ? '내 심사·가게' : '내 투자·쿠폰'} 원장을 확인해 안내해요.</span></div>
      <div className="floating-ai-messages" ref={scrollRef}>{messages.map((message, index) => <div className={`floating-message ${message.role}`} key={index}><p>{message.text}</p>{message.sources && message.sources.length > 0 && <div className="floating-sources"><span><Sparkles /> 참고한 정보</span>{message.sources.map((source) => <small key={source.id}>{source.label}</small>)}</div>}</div>)}{asking && <div className="floating-message ai typing">···</div>}</div>
      <div className="floating-ai-suggestions">{suggestions.map((item) => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div>
      <form onSubmit={submit}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={role === 'owner' ? '내 심사·펀딩·쿠폰 운영을 물어보세요' : '내 투자·쿠폰·예약 거래를 물어보세요'} aria-label="AI 상담 질문" /><button disabled={asking || !question.trim()} aria-label="질문 보내기"><ArrowRight /></button></form>
      <p className="floating-ai-notice">답변은 참고용이며 투자 권유나 원금 보장이 아닙니다.</p>
    </section>}
    <button className="floating-ai-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={open ? 'AI 상담 닫기' : 'AI와 상담하기'}>{open ? <X /> : <MessageCircle />}<span>{open ? '닫기' : 'AI와 상담하기'}</span></button>
  </div>
}
