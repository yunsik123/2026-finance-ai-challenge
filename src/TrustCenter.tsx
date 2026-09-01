import { useEffect, useState } from 'react'
import { ArrowRight, BarChart3, Check, Database, FileSearch, GitBranch, MapPin, ShieldCheck, TriangleAlert } from 'lucide-react'
import { api } from './lib/api.ts'
import CommercialAreaPanel from './CommercialAreaPanel.tsx'
import CreditModelPanel from './CreditModelPanel.tsx'
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
    <div className="page-heading trust-heading"><div><span className="eyebrow coral"><ShieldCheck /> 검증 데이터룸</span><h1>점수보다 중요한 건,<br />점수가 만들어진 근거예요.</h1><p>어떤 자료를 어떻게 계산해 점수가 나왔는지, 그리고 아직 확인하지 못한 항목까지 그대로 보여드립니다.</p></div><div className="trust-method-card"><Database /><div><b>설명 가능한 예비심사</b><span>5개 구성요소 · 가중치 공개 · 누락자료 분리</span></div></div></div>
    <section className="trust-picker"><label><span>분석할 식당</span><select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>{state.restaurants.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.neighborhood}</option>)}</select></label>{restaurant && <button className="button secondary" onClick={() => onSelect(restaurant)}>식당 상세 보기 <ArrowRight /></button>}</section>
    {error && <div className="trust-error">{error}</div>}
    {!data && !error ? <div className="trust-loading">검증 근거를 불러오는 중...</div> : data && <>
      <section className="trust-score-grid">
        <article className={`trust-score ${data.assessment.riskLevel}`}><small>투명 위험 예비점수</small><strong>{data.assessment.score}<span>/100</span></strong><b>{data.assessment.grade} · {labels[data.assessment.riskLevel]}</b><p>채무불이행 확률이 아닌 설명 가능한 사전 점검 지표입니다.</p></article>
        <article className="trust-summary"><div><span>데이터 신뢰도</span><b>{data.assessment.confidence}%</b></div><div className="progress-track"><i style={{ width: `${data.assessment.confidence}%` }} /></div><ul><li><Check /> 모델 기준점 {data.assessment.methodology.baseline}점</li><li><Check /> 구성요소별 가중합 공개</li><li><FileSearch /> {data.assessment.missing.join(', ')}</li></ul></article>
      </section>
      {data.assessment.commercialArea
        ? <CommercialAreaPanel area={data.assessment.commercialArea} category={restaurant?.category} />
        : <section className="commercial-missing"><MapPin /><div><b>이 동네는 상권 원천데이터가 아직 연동되지 않았어요</b><p>상권 지표 없이 식당 자체 수치만으로 '상권 회복력'을 추정했기 때문에 데이터 신뢰도를 낮춰 표시합니다.</p></div></section>}
      {data.assessment.contextualAlerts?.length > 0 && <section className="contextual-alerts">
        <h3><TriangleAlert /> 점수에 반영하지 않고 따로 알리는 맥락</h3>
        <ul>{data.assessment.contextualAlerts.map((alert) => <li key={alert}>{alert}</li>)}</ul>
      </section>}
      <section className="trust-section"><div className="trust-section-head"><div><span className="eyebrow">WHY THIS SCORE</span><h2>점수 구성요소와 기여도</h2></div><BarChart3 /></div><div className="component-grid">{data.assessment.contributions.map((item) => <article key={item.label}><div><span>{item.label}</span><b>{item.componentScore}</b></div><div className="component-track"><i style={{ width: `${item.componentScore}%` }} /></div><p>가중치 {Math.round(item.weight * 100)}% <strong className={item.contribution >= 0 ? 'positive' : 'negative'}>{item.contribution >= 0 ? '+' : ''}{item.contribution}점</strong></p></article>)}</div><p className="method-note"><ShieldCheck /> 기준점 {data.assessment.methodology.baseline}점에서 5개 요소의 가중 기여도를 더한 값이에요. 부도 확률을 예측하는 점수가 아니고, 사람이 원본을 확인하는 절차를 대신하지도 않습니다.{data.assessment.commercialArea ? ' 상권 원천자료가 연결된 동네라 상권 회복력은 추정치 대신 실제 지표로 계산했어요.' : ''}</p></section>
      <CreditModelPanel />
      <section className="trust-section"><div className="trust-section-head"><div><span className="eyebrow">PROCESS</span><h2>투자자 확인 절차</h2></div><GitBranch /></div><div className="process-graph">{data.graph.nodes.filter((node) => node.type === 'GuideStep').map((node, index, nodes) => <div className="process-node" key={node.id}><span>{String(node.properties.order).padStart(2, '0')}</span><div><b>{node.label}</b><p>{node.properties.instruction}</p></div>{index < nodes.length - 1 && <ArrowRight />}</div>)}</div></section>
    </>}
  </div>
}
