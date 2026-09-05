import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Bot, Check, ExternalLink, Loader2, Scale, Sparkles, X } from 'lucide-react'
import { api } from './lib/api.ts'
import type { InsightSummaryResponse, PublicState, Restaurant } from './types.ts'
import './insight.css'

const shortDate = (value: string) => new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
const progress = (restaurant: Restaurant) => Math.min(100, Math.round(restaurant.fund.raised / restaurant.fund.goal * 100))

export default function InsightPage({ state, onSelect }: { state: PublicState; onSelect: (restaurant: Restaurant) => void }) {
  const [articleId, setArticleId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const article = state.articles.find((item) => item.id === articleId)
  const selected = useMemo(() => selectedIds.map((id) => state.restaurants.find((restaurant) => restaurant.id === id)).filter(Boolean) as Restaurant[], [selectedIds, state.restaurants])
  const toggleCompare = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < 3 ? [...ids, id] : ids)
  // 비교 대상이 정해지면 그 조합의 공개 지표를 서버로 보내 해석을 받는다.
  // 서버가 같은 조합·같은 수치면 만들어둔 해석을 재사용하고, AI 연결이 없으면 규칙 기반 해석을 내려준다.
  const [interpretation, setInterpretation] = useState<InsightSummaryResponse | null>(null)
  const [interpreting, setInterpreting] = useState(false)
  const comparisonKey = selectedIds.join(',')
  useEffect(() => {
    if (selected.length < 2) { setInterpretation(null); return }
    let live = true
    setInterpreting(true)
    api<InsightSummaryResponse>('/api/ai/insight-summary', { method: 'POST', body: JSON.stringify({ restaurantIds: selectedIds }) })
      .then((result) => { if (live) setInterpretation(result) })
      .catch(() => { if (live) setInterpretation(null) })
      .finally(() => { if (live) setInterpreting(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonKey, selected.length])
  const comparisonRows = [
    ['매출 성장률', '최근 매출의 성장 방향', (restaurant: Restaurant) => `${restaurant.salesGrowth > 0 ? '+' : ''}${restaurant.salesGrowth}%`],
    ['재방문율', '단골 고객 기반의 참고 지표', (restaurant: Restaurant) => `${restaurant.repeatRate}%`],
    ['상권 안정성', '100점 기준·주변 폐업률 반영', (restaurant: Restaurant) => `${restaurant.stabilityScore}점`],
    ['모집 달성률', '목표 모집액 대비 현재 모집액', (restaurant: Restaurant) => `${progress(restaurant)}%`],
    ['쿠폰 혜택', '최소 발급률부터 최대 할인율까지', (restaurant: Restaurant) => `${restaurant.fund.minIssueDiscount}%부터 · 최대 ${restaurant.fund.maxDiscount}%`],
    ['종합 위험', '공개자료와 식당 지표로 산정', (restaurant: Restaurant) => `${restaurant.fund.riskLevel}`],
  ] as const
  return <div className="page-wrap insight-page">
    <div className="page-heading compact"><span className="eyebrow coral"><Bot /> 먹투 AI</span><h1>숫자 너머의 맛있는<br />가능성을 읽어드려요.</h1><p>공공 상권자료와 가상 식당 원천데이터를 구분해 설명하고, 비공개 매출은 답변에서 보호합니다.</p></div>
    <div className="insight-layout"><section><section className="ai-compare">
        <div className="compare-heading"><div><span><Scale /> 가게 비교</span><h2>가게 2~3개의 공개정보를 나란히 살펴보세요</h2><p>모든 이용자에게 동일한 공개 수치를 비교하며 특정 가게나 투자금액을 추천하지 않습니다.</p></div><strong>{selected.length}<small>/3 선택</small></strong></div>
        <div className="compare-selector">{state.restaurants.map((restaurant) => { const checked = selectedIds.includes(restaurant.id); return <button key={restaurant.id} className={checked ? 'selected' : ''} disabled={!checked && selectedIds.length >= 3} onClick={() => toggleCompare(restaurant.id)} aria-pressed={checked}><span style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><div><b>{restaurant.name}</b><small>{restaurant.neighborhood} · {restaurant.category}</small></div><i>{checked && <Check />}</i></button> })}</div>
        {selected.length < 2 ? <div className="compare-empty"><Scale /><b>비교할 가게를 2개 이상 선택해주세요.</b><span>최대 3개까지 한눈에 비교할 수 있어요.</span></div> : <>
          <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>비교 항목</th>{selected.map((restaurant) => <th key={restaurant.id}><button onClick={() => onSelect(restaurant)}>{restaurant.emoji} {restaurant.name}</button></th>)}</tr></thead><tbody>{comparisonRows.map(([label, note, value]) => <tr key={label}><th><b>{label}</b><small>{note}</small></th>{selected.map((restaurant) => <td key={restaurant.id}>{value(restaurant)}</td>)}</tr>)}</tbody></table></div>
          <div className="compare-explanations"><div className="compare-explanation-head"><Sparkles /><div><span>AI 공개정보 해석</span><h3>수치가 보여주는 특징</h3></div>{interpreting ? <em className="insight-status"><Loader2 className="spin" /> 해석 중</em> : interpretation?.provider === 'openai' ? <em className="insight-status ai"><Bot /> AI 분석</em> : interpretation ? <em className="insight-status">자동 규칙 요약</em> : null}</div>
            {interpreting && !interpretation ? <div className="fit-grid">{selected.map((restaurant) => <article key={restaurant.id} className="fit-skeleton" style={{ borderColor: `${restaurant.color}75` }}><div><span style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><b>{restaurant.name}</b></div><i /><i /></article>)}</div> : <div className="fit-grid">{selected.map((restaurant) => { const card = interpretation?.summary.cards.find((item) => item.id === restaurant.id); return <article key={restaurant.id} style={{ borderColor: `${restaurant.color}75` }}><div><span style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><b>{restaurant.name}</b></div>{card?.traits.length ? <ul>{card.traits.map((trait) => <li key={trait}>{trait}</li>)}</ul> : <p>여러 지표가 중간 범위에 있어 한 가지 성향보다 균형 비교가 필요합니다.</p>}{card?.caution && <em className="fit-caution">{card.caution}</em>}<small>공개정보 요약일 뿐 투자 추천이나 수익 보장이 아닙니다.</small></article> })}</div>}
            {interpretation && <p className="compare-narrative">{interpretation.summary.comparison}</p>}</div>
          <div className="compare-disclaimer"><b>비교 전 확인</b><p>모든 수치는 데모 데이터입니다. 투자 결정에는 최신 원자료와 본인의 상황을 별도로 확인해야 합니다.</p></div>
        </>}
      </section><div className="ai-picks"><div className="subheading"><div><span>가게 한 눈에 보기</span><h2>성장·단골 지표 상위 가게</h2></div><Sparkles /></div>{[...state.restaurants].sort((a,b) => b.opportunityScore - a.opportunityScore).slice(0,3).map((restaurant, index) => <button className="pick-row" key={restaurant.id} onClick={() => onSelect(restaurant)}><span className="pick-rank">0{index+1}</span><span className="food-mini" style={{ background: `${restaurant.color}35` }}>{restaurant.emoji}</span><div><b>{restaurant.name}</b><small>{restaurant.neighborhood} · 성장 {restaurant.salesGrowth}% · 평점 {restaurant.rating}</small></div><span className="score-ring">{restaurant.opportunityScore}</span></button>)}</div>
      <div className="articles enhanced-articles"><div className="subheading"><div><span>이번 주 읽을거리</span><h2>AI가 정리한 상권 이야기</h2></div></div>{state.articles.map((item) => <button className="article-card article-button" key={item.id} onClick={() => setArticleId(item.id)}><span>{item.icon}</span><div><small>{item.eyebrow} · {shortDate(item.publishedAt)}</small><h3>{item.title}</h3><p>{item.summary}</p><div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><b className="read-more">자세히 읽기 <ArrowRight /></b></div></button>)}</div>
    </section></div>
    {article && <div className="modal-backdrop article-backdrop" onMouseDown={() => setArticleId(null)}><article className="article-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setArticleId(null)}><X /></button><span className="article-modal-icon">{article.icon}</span><small>{article.eyebrow} · {shortDate(article.publishedAt)}</small><h2>{article.title}</h2><div className="article-lead">{article.summary}</div><div className="article-content">{article.content.split('\n\n').map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>{article.dataNote && <div className="article-data-note"><b>데이터 구분</b><p>{article.dataNote}</p></div>}{article.sourceUrl && <a href={article.sourceUrl} target="_blank" rel="noreferrer" className="article-source">{article.sourceName || '원문 자료'} <ExternalLink /></a>}<div className="tag-row">{article.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></article></div>}
  </div>
}
