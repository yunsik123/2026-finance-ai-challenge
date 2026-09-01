import { useState } from 'react'
import { ArrowRight, Bot, ExternalLink, Sparkles, X } from 'lucide-react'
import { api } from './lib/api.ts'
import type { PublicState, Restaurant } from './types.ts'

const shortDate = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

export default function InsightPage({ state, onSelect, notify }: { state: PublicState; onSelect: (restaurant: Restaurant) => void; notify: (message: string) => void }) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([{ role: 'ai', text: '안녕하세요! OpenAI 기반 먹투 생성형 AI 상담원이에요. 식당의 메뉴·리뷰·공개 매출·보너스 이력까지 물어보세요. 😊' }])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [online, setOnline] = useState(true)
  const [articleId, setArticleId] = useState<string | null>(null)
  const article = state.articles.find((item) => item.id === articleId)
  const ask = async (suggestion?: string) => {
    const value = (suggestion || question).trim()
    if (!value || asking) return
    setMessages((current) => [...current, { role: 'user', text: value }])
    setQuestion(''); setAsking(true)
    try { const result = await api<{ answer: string; mode: string }>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question: value }) }); setOnline(result.mode?.includes('generative') || result.mode === 'generative-ai'); setMessages((current) => [...current, { role: 'ai', text: result.answer }]) }
    catch (error) { setOnline(false); notify((error as Error).message) }
    finally { setAsking(false) }
  }
  return <div className="page-wrap">
    <div className="page-heading compact"><span className="eyebrow coral"><Bot /> 먹투 AI</span><h1>숫자 너머의 맛있는<br />가능성을 읽어드려요.</h1><p>공공 상권자료와 가상 식당 원천데이터를 구분해 설명하고, 비공개 매출은 답변에서 보호합니다.</p></div>
    <div className="insight-layout"><section><div className="ai-picks"><div className="subheading"><div><span>AI 오늘의 발견</span><h2>성장성과 단골이 함께 좋은 곳</h2></div><Sparkles /></div>{[...state.restaurants].sort((a,b) => b.opportunityScore - a.opportunityScore).slice(0,3).map((restaurant, index) => <button className="pick-row" key={restaurant.id} onClick={() => onSelect(restaurant)}><span className="pick-rank">0{index+1}</span><span className="food-mini" style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><div><b>{restaurant.name}</b><small>{restaurant.neighborhood} · 성장 {restaurant.salesGrowth}% · 평점 {restaurant.rating}</small></div><span className="score-ring">{restaurant.opportunityScore}</span></button>)}</div>
      <div className="articles enhanced-articles"><div className="subheading"><div><span>이번 주 읽을거리</span><h2>AI가 정리한 상권 이야기</h2></div></div>{state.articles.map((item) => <button className="article-card article-button" key={item.id} onClick={() => setArticleId(item.id)}><span>{item.icon}</span><div><small>{item.eyebrow} · {shortDate(item.publishedAt)}</small><h3>{item.title}</h3><p>{item.summary}</p><div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><b className="read-more">자세히 읽기 <ArrowRight /></b></div></button>)}</div>
    </section><aside className="chat-panel"><div className="chat-head"><span className="bot-avatar"><Bot /></span><div><b>먹투 생성형 AI 상담원</b><small><i /> {online ? 'OpenAI GPT · 온라인' : 'OpenAI GPT · 연결 확인 필요'}</small></div></div><div className="chat-messages">{messages.map((message, index) => <div className={`chat-bubble ${message.role}`} key={index}>{message.text}</div>)}{asking && <div className="chat-bubble ai typing">···</div>}</div><div className="suggestions">{['펀드 등록은 어디서 해?','쿠폰 교환은 어디서 하나요?','최초 투자자 혜택 설명해줘','소복소복 리뷰와 강점 알려줘'].map((item) => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div><form className="chat-input" onSubmit={(event) => { event.preventDefault(); ask() }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="궁금한 것을 물어보세요" /><button><ArrowRight /></button></form><p className="ai-disclaimer">OpenAI GPT가 생성한 답변은 참고용이며 투자 권유가 아닙니다.</p></aside></div>
    {article && <div className="modal-backdrop article-backdrop" onMouseDown={() => setArticleId(null)}><article className="article-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setArticleId(null)}><X /></button><span className="article-modal-icon">{article.icon}</span><small>{article.eyebrow} · {shortDate(article.publishedAt)}</small><h2>{article.title}</h2><div className="article-lead">{article.summary}</div><div className="article-content">{article.content.split('\n\n').map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>{article.dataNote && <div className="article-data-note"><b>데이터 구분</b><p>{article.dataNote}</p></div>}{article.sourceUrl && <a href={article.sourceUrl} target="_blank" rel="noreferrer" className="article-source">{article.sourceName || '원문 자료'} <ExternalLink /></a>}<div className="tag-row">{article.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></article></div>}
  </div>
}