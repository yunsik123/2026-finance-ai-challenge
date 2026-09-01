import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Bot, Database, MessageCircle, Sparkles, X } from 'lucide-react'
import { api } from './lib/api.ts'
import type { Role } from './types.ts'

type Source = { id: string; label: string; type: string }
type Message = { role: 'user' | 'ai'; text: string; sources?: Source[] }

export default function FloatingAiChat({ role }: { role: Role }) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [mode, setMode] = useState('graph-rag-local')
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: '안녕하세요! 먹투 AI예요. 식당 데이터와 투자·심사 절차는 물론, “어느 메뉴로 가야 하는지”까지 화면 지도를 검색해서 안내해드려요.' },
  ])
  const scrollRef = useRef<HTMLDivElement>(null)
  const suggestions = role === 'owner'
    ? ['펀드 등록은 어디서 해?', '샘플 자료는 어디서 받아?', '펀딩 신청에 필요한 자료는?']
    : ['쿠폰 교환은 어디서 해?', '투자금은 어떻게 회수해?', '소복소복 분석해줘']

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, asking, open])

  const ask = async (suggestion?: string) => {
    const value = (suggestion || question).trim()
    if (!value || asking) return
    setOpen(true); setQuestion(''); setAsking(true)
    setMessages((current) => [...current, { role: 'user', text: value }])
    try {
      const result = await api<{ answer: string; mode: string; sources?: Source[] }>('/api/ai/chat', {
        method: 'POST', body: JSON.stringify({ question: value, role }),
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
      <header><span className="floating-ai-avatar"><Bot /></span><div><b>먹투 AI 상담원</b><small><i /> GraphRAG · {mode.includes('generative') ? '생성형 AI 연결' : '로컬 그래프 검색'}</small></div><button onClick={() => setOpen(false)} aria-label="AI 상담 닫기"><X /></button></header>
      <div className="floating-ai-context"><Database /><span>역할별 지식그래프와 공개 식당 데이터에서 근거를 검색합니다.</span></div>
      <div className="floating-ai-messages" ref={scrollRef}>{messages.map((message, index) => <div className={`floating-message ${message.role}`} key={index}><p>{message.text}</p>{message.sources && message.sources.length > 0 && <div className="floating-sources"><span><Sparkles /> 참고한 그래프</span>{message.sources.map((source) => <small key={source.id}>{source.label}</small>)}</div>}</div>)}{asking && <div className="floating-message ai typing">···</div>}</div>
      <div className="floating-ai-suggestions">{suggestions.map((item) => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div>
      <form onSubmit={submit}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="식당·투자·심사 절차를 물어보세요" aria-label="AI 상담 질문" /><button disabled={asking || !question.trim()} aria-label="질문 보내기"><ArrowRight /></button></form>
      <p className="floating-ai-notice">답변은 참고용이며 투자 권유나 원금 보장이 아닙니다.</p>
    </section>}
    <button className="floating-ai-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={open ? 'AI 상담 닫기' : 'AI와 상담하기'}>{open ? <X /> : <MessageCircle />}<span>{open ? '닫기' : 'AI와 상담하기'}</span></button>
  </div>
}
