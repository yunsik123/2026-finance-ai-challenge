import { useEffect, useState } from 'react'
import { BookOpen, ChevronDown, Layers, ShieldAlert } from 'lucide-react'
import { api } from './lib/api.ts'

type ModelFeature = { key: string; label: string; weight: number; unit: string; direction: string; note?: string }
type ModelGroup = { group: string; weight: number; features: ModelFeature[] }
type CreditModel = {
  modelVersion: string
  industries: string[]
  industryProfiles: Record<string, { salesScale: number; ticketScale: number; closureRate: number; typicalAge: number; note: string }>
  weightSum: number
  groups: ModelGroup[]
  gradeBands: Array<{ grade: string; min: number }>
  overrideRules: string[]
  missingHandling: string
  references: Array<{ id: string; title: string; authors: string; use: string; excluded?: string; url: string }>
  disclaimer: string
}

/**
 * 신용평가 모델 자체를 공개하는 패널.
 * 특정 사업체 값이 아니라 "무엇을 어떤 가중치로 보는가"만 보여준다.
 * 점수를 받는 사람이 계산식을 볼 수 없으면 이의를 제기할 수도 없다.
 */
export default function CreditModelPanel() {
  const [model, setModel] = useState<CreditModel | null>(null)
  const [open, setOpen] = useState(false)
  const [industry, setIndustry] = useState('외식')

  useEffect(() => { api<CreditModel>('/api/credit/model').then(setModel).catch(() => undefined) }, [])
  if (!model) return null
  const profile = model.industryProfiles[industry]

  return <section className="trust-section credit-model">
    <div className="trust-section-head">
      <div><span className="eyebrow">CREDIT MODEL</span><h2>신용평가는 무엇을 보나요</h2></div>
      <Layers />
    </div>
    <p className="credit-model-lead">
      업종별 기준분포와 비교해 {model.groups.reduce((sum, group) => sum + group.features.length, 0)}개 지표를 점수로 바꾸고,
      가중치 합계 {model.weightSum}%로 등급을 냅니다. {model.missingHandling}.
    </p>

    <div className="credit-model-industries">
      {model.industries.map((item) => <button key={item} className={industry === item ? 'active' : ''} onClick={() => setIndustry(item)}>{item}</button>)}
    </div>
    {profile && <p className="credit-model-industry-note">{profile.note} (참고 폐업률 {profile.closureRate}% · 평균 업력 {profile.typicalAge}년)</p>}

    <div className="credit-model-groups">
      {model.groups.map((group) => <article key={group.group}>
        <div><b>{group.group}</b><span>{group.weight}%</span></div>
        <div className="progress-track"><i style={{ width: `${group.weight}%` }} /></div>
        <small>{group.features.length}개 지표</small>
      </article>)}
    </div>

    <div className="credit-model-bands">
      {model.gradeBands.map((band, index) => {
        const upper = index === 0 ? null : model.gradeBands[index - 1].min
        return <span key={band.grade}><b>{band.grade}</b>{upper === null ? `${band.min}점 이상` : `${band.min}점 ~ ${upper - 1}점`}</span>
      })}
    </div>

    <div className="credit-model-overrides">
      <b><ShieldAlert /> 점수와 무관하게 적용되는 규칙</b>
      <ul>{model.overrideRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
    </div>

    <button type="button" className="credit-toggle" onClick={() => setOpen((current) => !current)}>
      지표 목록과 참고 연구 보기 <ChevronDown className={open ? 'rotated' : ''} />
    </button>
    {open && <div className="credit-model-detail">
      {model.groups.map((group) => <div key={group.group}>
        <h4>{group.group} · {group.weight}%</h4>
        <div className="credit-table">
          <div className="credit-row credit-row-head"><span>지표</span><span>방향</span><span>가중치</span></div>
          {group.features.map((feature) => <div className="credit-row three" key={feature.key}>
            <span>{feature.label}{feature.note ? ' *' : ''}</span>
            <span>{feature.direction}</span>
            <span>{feature.weight}%</span>
          </div>)}
        </div>
        {group.features.filter((feature) => feature.note).map((feature) => <p className="credit-model-footnote" key={feature.key}>* {feature.label}: {feature.note}</p>)}
      </div>)}
      <ul className="credit-references">
        {model.references.map((reference) => <li key={reference.id}>
          <b><BookOpen /> {reference.authors}</b>
          <em>{reference.title}</em>
          <p>적용: {reference.use}</p>
          {reference.excluded && <p className="excluded">제외: {reference.excluded}</p>}
          <a href={reference.url} target="_blank" rel="noreferrer">원문 보기</a>
        </li>)}
      </ul>
    </div>}
    <p className="credit-disclaimer">{model.disclaimer}</p>
  </section>
}
