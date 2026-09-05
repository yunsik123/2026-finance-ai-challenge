import { useState } from 'react'
import { ChevronDown, Gauge, Layers, TrendingDown, TrendingUp } from 'lucide-react'
import type { CombinedAssessment, CreditAssessment } from './types.ts'

const gradeTone: Record<string, string> = { 'A+': 'best', A: 'good', 'B+': 'good', B: 'fair', C: 'watch', D: 'risk' }

const formatValue = (value: number | null, unit: string) => {
  if (value === null) return '미산정'
  if (unit === '원') return `${Math.round(value).toLocaleString('ko-KR')}원`
  if (unit === '') return value.toFixed(2)
  return `${Number(value.toFixed(1)).toLocaleString('ko-KR')}${unit}`
}

/**
 * 35개 지표 신용등급 결과 화면.
 *
 * 등급 하나만 크게 보여주고 끝내지 않는다. 사장님이 알아야 하는 건
 * "왜 이 등급인지"와 "무엇을 채우면 올라가는지"라서, 기여도 상·하위와
 * 미산정 지표를 같은 카드 안에서 함께 편다.
 */
export default function CreditGradePanel({ credit, combined }: { credit: CreditAssessment; combined?: CombinedAssessment }) {
  const [openAll, setOpenAll] = useState(false)

  return <section className="credit-panel">
    <div className="credit-head">
      <div>
        <span className="eyebrow">먹투 성장성 예비평가</span>
        <h2>{credit.industry} 업종 기준 예비평가 결과</h2>
        <p>35개 지표 중 {credit.measuredCount}개를 산정했어요. {credit.industryNote}</p>
      </div>
      {/* 산정률이 절반에 못 미치면 확정 등급이라고 말할 수 없다.
          등급만 크게 보이면 자료를 덜 낸 결과가 확정 판정처럼 읽힌다. */}
      <div className={`credit-grade ${gradeTone[credit.grade] || 'fair'} ${credit.provisional ? 'provisional' : ''}`}>
        {credit.provisional && <em>자료 보완 필요</em>}
        <b>{credit.grade}</b>
        <span>{credit.score}점</span>
      </div>
    </div>

    <div className="credit-meters">
      <div>
        <span><Gauge /> 지표 산정률</span>
        <b>{credit.coverage}%</b>
        <div className="progress-track"><i style={{ width: `${credit.coverage}%` }} /></div>
        <small>{credit.provisional
          ? '산정하지 못한 지표는 감점하지 않지만, 절반에 못 미쳐 자료 보완이 필요해요. 자료를 채우면 다시 평가해요.'
          : '산정하지 못한 지표는 감점하지 않고 가중치에서 뺐어요.'}</small>
      </div>
      {combined && <div>
        <span><Layers /> 종합 점수</span>
        <b>{combined.blendedScore}점</b>
        <div className="progress-track"><i style={{ width: `${combined.blendedScore}%` }} /></div>
        <small>성장성·상권 {combined.weights['성장성_상권_5요소']}% + 신용·현금흐름 {combined.weights['신용_현금흐름_35지표']}% · {combined.agreementNote}</small>
      </div>}
    </div>

    <div className="credit-groups">
      {credit.groups.map((group) => <article key={group.group}>
        <div><b>{group.group}</b><span>가중치 {group.weight}%</span></div>
        <div className="progress-track"><i className={group.score === null ? 'unknown' : ''} style={{ width: `${group.score ?? 0}%` }} /></div>
        <small>{group.score === null ? '자료 없음 · 미산정' : `${group.score}점 · ${group.measuredCount}/${group.totalCount}개 산정`}</small>
      </article>)}
    </div>

    <div className="credit-drivers">
      <section>
        <h3><TrendingUp /> 평가점수를 올린 지표</h3>
        {credit.topDrivers.length ? credit.topDrivers.map((item) => <p key={item.key}><b>{item.label}</b><span>{item.score}점 · 가중치 {item.weight}%</span></p>) : <p className="muted">아직 뚜렷한 상위 지표가 없어요.</p>}
      </section>
      <section>
        <h3><TrendingDown /> 평가점수를 낮춘 지표</h3>
        {credit.topDrags.length ? credit.topDrags.map((item) => <p key={item.key}><b>{item.label}</b><span>{item.score}점 · 가중치 {item.weight}%</span></p>) : <p className="muted">평균을 크게 밑도는 지표는 없어요.</p>}
      </section>
    </div>

    {credit.overrides.length > 0 && <div className="credit-overrides">
      <b>평가 조정 규칙이 적용됐어요</b>
      {credit.overrides.map((item) => <p key={item}>{item}</p>)}
    </div>}

    {credit.missing.length > 0 && <div className="credit-missing">
      <b>아직 산정하지 못한 지표 {credit.missing.length}개</b>
      <p>{credit.missing.join(' · ')}</p>
      <small>해당 자료를 연결하면 다음 심사부터 평가 근거에 함께 반영돼요.</small>
    </div>}

    <button type="button" className="credit-toggle" onClick={() => setOpenAll((current) => !current)}>
      35개 지표 전부 보기 <ChevronDown className={openAll ? 'rotated' : ''} />
    </button>
    {openAll && <div className="credit-table">
      <div className="credit-row credit-row-head"><span>지표</span><span>값</span><span>점수</span><span>가중치</span></div>
      {credit.features.map((feature) => <div className={`credit-row ${feature.measured ? '' : 'missing'}`} key={feature.key}>
        <span>{feature.label}</span>
        <span>{formatValue(feature.value, feature.unit)}</span>
        <span>{feature.score === null ? '—' : `${feature.score}점`}</span>
        <span>{feature.weight}%</span>
      </div>)}
    </div>}

    <p className="credit-disclaimer">{credit.methodology.disclaimer} 평가 구간: {credit.methodology.gradeBands}.</p>
  </section>
}
