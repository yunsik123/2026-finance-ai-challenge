import { useMemo, useState } from 'react'
import { ArrowRight, Bot, Check, ExternalLink, Scale, Sparkles, X } from 'lucide-react'
import { api } from './lib/api.ts'
import type { PublicState, Restaurant, Role } from './types.ts'

const shortDate = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
const progress = (restaurant: Restaurant) => Math.min(100, Math.round(restaurant.fund.raised / restaurant.fund.goal * 100))

function fitSummary(restaurant: Restaurant) {
  const traits: string[] = []
  if (restaurant.salesGrowth >= 22) traits.push('빠른 매출 성장을 중요시하는 성향')
  if (restaurant.repeatRate >= 65) traits.push('단골 기반의 꾸준함을 중요시하는 성향')
  if (restaurant.stabilityScore >= 88) traits.push('상권과 운영 안정성을 우선하는 성향')
  if (restaurant.fund.maxDiscount >= 45) traits.push('쿠폰 혜택을 적극 활용하는 성향')
  if (progress(restaurant) < 65) traits.push('모집 초기의 불확실성을 감수할 수 있는 성향')
  return traits.slice(0, 2)
}

export default function InsightPage({ state, role, onSelect, notify }: { state: PublicState; role: Role; onSelect: (restaurant: Restaurant) => void; notify: (message: string) => void }) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([{ role: 'ai', text: role === 'owner' ? '안녕하세요, 사장님! 심사 현황과 펀딩 운영, 제출 자료를 편하게 물어보세요. 😊' : '안녕하세요! 식당 정보와 내 투자·쿠폰·예약 거래를 편하게 물어보세요. 😊' }])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [online, setOnline] = useState(true)
  const [articleId, setArticleId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const article = state.articles.find((item) => item.id === articleId)
  const selected = useMemo(() => selectedIds.map((id) => state.restaurants.find((restaurant) => restaurant.id === id)).filter(Boolean) as Restaurant[], [selectedIds, state.restaurants])
  const toggleCompare = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < 3 ? [...ids, id] : ids)
  const comparisonRows = [
    ['매출 성장룰', '최근 매출의 성장 방향', (restaurant: Restaurant) => `${restaurant.salesGrowth > 0 ? '+' : ''}${restaurant.salesGrowth}%`],
    ['재방문율', '단골 고객 기반의 참고 지표', (restaurant: Restaurant) => `${restaurant.repeatRate}%`],
    ['상권 안정성', '100점 기준·주변 폐업룰 당 반영', (restaurant: Restaurant) => `${restaurant.stabilityScore}점`],
    ['모집 달성룰', '목표 모집액 대비 현재 모집액', (restaurant: Restaurant) => `${progress(restaurant)}%`],
    ['쿠폰 혜택', '최소 발급룰부터 최대 할인율까지', (restaurant: Restaurant) => `${restaurant.fund.minIssueDiscount}%부터 · 최대 ${restaurant.fund.maxDiscount}%`],
    ['종합 위험', '공개자료와 식당지표로 꼬시', (restaurant: Restaurant) => `${restaurant.fund.riskLevel}`],
  ] as const
  const ask = async (suggestion?: string) => {
    const value = (suggestion || question).trim()
    if (!value || asking) return
    setMessages((current) => [...current, { role: 'user', text: value }])
    setQuestion(''); setAsking(true)
    try { const result = await api<{ answer: string; mode: string }>('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question: value, role, currentPath: '/insight' }) }); setOnline(result.mode?.includes('generative') || result.mode === 'generative-ai' || result.mode?.includes('local')); setMessages((current) => [...current, { role: 'ai', text: result.answer }]) }
    catch (error) { setOnline(false); notify((error as Error).message) }
    finally { setAsking(false) }
  }
  return <div className="page-wrap">
    <div className="page-heading compact"><span className="eyebrow coral"><Bot /> 먹투 AI</span><h1>숫자 너머의 맛있는<br />가능성을 읽어드려요.</h1><p>공공 상권자료와 가상 식당 원천데이터를 구분해 설명하고, 비공개 매출은 답변에서 보호합니다.</p></div>
    <div className="insight-layout"><section><section className="ai-compare">
        <div className="compare-heading"><div><span><Scale /> AI 투자 비교</span><h2>가게 2~3개를 나란히 살펴보세요</h2><p>수치와 성향을 비교하되 특정 가게에 대한 투자 권유는 하지 않습니다.</p></div><strong>{selected.length}<small>/3 선택</small></strong></div>
        <div className="compare-selector">{state.restaurants.map((restaurant) => { const checked = selectedIds.includes(restaurant.id); return <button key={restaurant.id} className={checked ? 'selected' : ''} disabled={!checked && selectedIds.length >= 3} onClick={() => toggleCompare(restaurant.id)} aria-pressed={checked}><span style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><div><b>{restaurant.name}</b><small>{restaurant.neighborhood} · {restaurant.category}</small></div><i>{checked && <Check />}</i></button> })}</div>
        {selected.length < 2 ? <div className="compare-empty"><Scale /><b>비교할 가게를 2개 이상 선택해주세요.</b><span>최대 3개까지 한눈에 비교할 수 있어요.</span></div> : <>
          <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>비교 항목</th>{selected.map((restaurant) => <th key={restaurant.id}><button onClick={() => onSelect(restaurant)}>{restaurant.emoji} {restaurant.name}</button></th>)}</tr></thead><tbody>{comparisonRows.map(([label, note, value]) => <tr key={label}><th><b>{label}</b><small>{note}</small></th>{selected.map((restaurant) => <td key={restaurant.id}>{value(restaurant)}</td>)}</tr>)}</tbody></table></div>
          <div className="compare-explanations"><div className="compare-explanation-head"><Sparkles /><div><span>AI 성향 해석</span><h3>수치가 보여주는 특징</h3></div></div><div className="fit-grid">{selected.map((restaurant) => <article key={restaurant.id} style={{ borderColor: `${restaurant.color}75` }}><div><span style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><b>{restaurant.name}</b></div>{fitSummary(restaurant).length ? <ul>{fitSummary(restaurant).map((trait) => <li key={trait}>{trait}에 참고할 만합니다.</li>)}</ul> : <p>여러 지표가 중간 범위에 있어 한 가지 성향보다 균형 비교가 필요합니다.</p>}<small>이는 적합성 설명이며 투자 추천이나 수익 보장이 아닙니다.</small></article>)}</div></div>
          <div className="compare-disclaimer"><b>비교 전 확인</b><p>모든 수치는 데모 데이터입니다. 투자 결정에는 최신 원자료와 본인의 상황을 별도로 확인해야 합니다.</p></div>
        </>}
      </section><div className="ai-picks"><div className="subheading"><div><span>AI 오늘의 발견</span><h2>성장성과 단골이 함께 좋은 곳</h2></div><Sparkles /></div>{[...state.restaurants].sort((a,b) => b.opportunityScore - a.opportunityScore).slice(0,3).map((restaurant, index) => <button className="pick-row" key={restaurant.id} onClick={() => onSelect(restaurant)}><span className="pick-rank">0{index+1}</span><span className="food-mini" style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><div><b>{restaurant.name}</b><small>{restaurant.neighborhood} · 성장 {restaurant.salesGrowth}% · 평점 {restaurant.rating}</small></div><span className="score-ring">{restaurant.opportunityScore}</span></button>)}</div>
      <div className="articles enhanced-articles"><div className="subheading"><div><span>이번 주 읽을거리</span><h2>AI가 정리한 상권 이야기</h2></div></div>{state.articles.map((item) => <button className="article-card article-button" key={item.id} onClick={() => setArticleId(item.id)}><span>{item.icon}</span><div><small>{item.eyebrow} · {shortDate(item.publishedAt)}</small><h3>{item.title}</h3><p>{item.summary}</p><div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><b className="read-more">자세히 읽기 <ArrowRight /></b></div></button>)}</div>
    </section><aside className="chat-panel"><div className="chat-head"><span className="bot-avatar"><Bot /></span><div><b>먹투 AI · {role === 'owner' ? '사장님 상담' : '투자자 상담'}</b><small><i /> {online ? '상담 가능' : '기본 안내 모드'}</small></div></div><div className="chat-messages">{messages.map((message, index) => <div className={`chat-bubble ${message.role}`} key={index}>{message.text}</div>)}{asking && <div className="chat-bubble ai typing">···</div>}</div><div className="suggestions">{(role === 'owner' ? ['내 심사는 지금 몇 단계야?','내 가게 모금과 쿠폰 부담 현황 알려줘','추가 펀딩은 어디서 시작해?','쿠폰 사용 확인은 어떻게 해?'] : ['내 쿠폰과 예약 주문 현황 알려줘','쿠폰 교환은 어디서 하나요?','투자금은 어떻게 회수해?','소복소복 리뷰와 강점 알려줘']).map((item) => <button key={item} onClick={() => ask(item)}>{item}</button>)}</div><form className="chat-input" onSubmit={(event) => { event.preventDefault(); ask() }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={role === 'owner' ? '심사·펀딩·가게 운영을 물어보세요' : '투자·쿠폰·식당 정보를 물어보세요'} /><button><ArrowRight /></button></form><p className="ai-disclaimer">AI 답변은 참고용이며 투자 권유가 아닙니다.</p></aside></div>
    {article && <div className="modal-backdrop article-backdrop" onMouseDown={() => setArticleId(null)}><article className="article-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setArticleId(null)}><X /></button><span className="article-modal-icon">{article.icon}</span><small>{article.eyebrow} · {shortDate(article.publishedAt)}</small><h2>{article.title}</h2><div className="article-lead">{article.summary}</div><div className="article-content">{article.content.split('\n\n').map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>{article.dataNote && <div className="article-data-note"><b>데이터 구분</b><p>{article.dataNote}</p></div>}{article.sourceUrl && <a href={article.sourceUrl} target="_blank" rel="noreferrer" className="article-source">{article.sourceName || '원문 자료'} <ExternalLink /></a>}<div className="tag-row">{article.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></article></div>}
  </div>
}
