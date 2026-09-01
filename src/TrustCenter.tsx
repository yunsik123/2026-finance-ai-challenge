import { useEffect, useState } from 'react'
import { ArrowRight, BarChart3, Check, Database, FileSearch, GitBranch, ShieldCheck } from 'lucide-react'
import { api } from './lib/api.ts'
import type { KnowledgeGraph, PublicState, Restaurant, TrustAssessment } from './types.ts'

const labels = { low: '낮은 보완 위험', review: '추가 확인 필요', high: '집중 확인 필요' }

export default function TrustCenter({ state, onSelect }: { state: PublicState; onSelect: (restaurant: Restaurant) => void }) {
  const [restaurantId, setRestaurantId] = useState(state.restaurants[0]?.id || '')
  const [data, setData] = useState<{ assessment: TrustAssessment; graph: KnowledgeGraph } | null>(null)
  const [error, setError] = useState('')
  const restaurant = state.restaurants.find((item) => item.id === restaurantId)

  useEffect(() => {
    setData(null); setError('')
    api<{ assessment: TrustAssessment; graph: KnowledgeGraph }>(`/api/trust/${restaurantId}`).then(setData).catch((reason) => setError(reason.message))
  }, [restaurantId])

  return <div className="page-wrap trust-page">
    <div className="page-heading trust-heading"><div><span className="eyebrow coral"><ShieldCheck /> 검증 데이터룸</span><h1>점수보다 중요한 건,<br />점수가 만들어진 근거예요.</h1><p>소상공인 프로젝트의 투명한 위험모형과 역할별 지식그래프를 먹투 디자인 안에 연결했습니다.</p></div><div className="trust-method-card"><Database /><div><b>설명 가능한 예비심사</b><span>5개 구성요소 · 가중치 공개 · 누락자료 분리</span></div></div></div>
    <section className="trust-picker"><label><span>분석할 식당</span><select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>{state.restaurants.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.neighborhood}</option>)}</select></label>{restaurant && <button className="button secondary" onClick={() => onSelect(restaurant)}>식당 상세 보기 <ArrowRight /></button>}</section>
    {error && <div className="trust-error">{error}</div>}
    {!data && !error ? <div className="trust-loading">검증 근거를 불러오는 중...</div> : data && <>
      <section className="trust-score-grid">
        <article className={`trust-score ${data.assessment.riskLevel}`}><small>투명 위험 예비점수</small><strong>{data.assessment.score}<span>/100</span></strong><b>{data.assessment.grade} · {labels[data.assessment.riskLevel]}</b><p>채무불이행 확률이 아닌 설명 가능한 사전 점검 지표입니다.</p></article>
        <article className="trust-summary"><div><span>데이터 신뢰도</span><b>{data.assessment.confidence}%</b></div><div className="progress-track"><i style={{ width: `${data.assessment.confidence}%` }} /></div><ul><li><Check /> 모델 기준점 {data.assessment.methodology.baseline}점</li><li><Check /> 구성요소별 가중합 공개</li><li><FileSearch /> {data.assessment.missing.join(', ')}</li></ul></article>
      </section>
      <section className="trust-section"><div className="trust-section-head"><div><span className="eyebrow">WHY THIS SCORE</span><h2>점수 구성요소와 기여도</h2></div><BarChart3 /></div><div className="component-grid">{data.assessment.contributions.map((item) => <article key={item.label}><div><span>{item.label}</span><b>{item.componentScore}</b></div><div className="component-track"><i style={{ width: `${item.componentScore}%` }} /></div><p>가중치 {Math.round(item.weight * 100)}% <strong className={item.contribution >= 0 ? 'positive' : 'negative'}>{item.contribution >= 0 ? '+' : ''}{item.contribution}점</strong></p></article>)}</div><p className="method-note"><ShieldCheck /> {data.assessment.methodology.modelVersion} · 학습된 부도확률 모델이 아니며, 운영자 원본 확인을 대체하지 않습니다.</p></section>
      <section className="trust-section"><div className="trust-section-head"><div><span className="eyebrow">PROCESS GRAPH</span><h2>투자자 확인 절차</h2></div><GitBranch /></div><div className="process-graph">{data.graph.nodes.filter((node) => node.type === 'GuideStep').map((node, index, nodes) => <div className="process-node" key={node.id}><span>{String(node.properties.order).padStart(2, '0')}</span><div><b>{node.label}</b><p>{node.properties.instruction}</p></div>{index < nodes.length - 1 && <ArrowRight />}</div>)}</div></section>
    </>}
  </div>
}
