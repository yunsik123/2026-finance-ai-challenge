/**
 * 증거 패널 — "이 숫자, 어디서 나왔어요?"
 *
 * 심사 결과 화면은 지금까지 숫자 카드만 그렸다. 서버는 지표마다 근거(어느 파일 몇 행)와
 * 자료끼리 맞춰본 결과를 이미 계산해 저장하고 있었는데 화면에 나오는 길이 없었다.
 * 그래서 사장님도 투자자도 "AI가 점수를 지어낸 것"과 구분할 수 없었다.
 *
 * 이 화면이 하는 일은 하나다. 값 하나를 누르면 그 값이 어느 자료에서 나왔고,
 * 다른 자료로 봤을 때 얼마였고, 둘의 차이가 몇 %인지 그대로 펼친다.
 */
import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, CircleDashed, FileSpreadsheet, FileText, Globe, PlugZap, Scale, X } from 'lucide-react'
import type { EvidenceCrossCheck, EvidenceLedger, EvidenceLink, EvidenceSupport, VerificationStepStatus } from './types.ts'
import './evidence.css'

const statusIcon: Record<VerificationStepStatus, React.ReactNode> = {
  passed: <Check />, review: <AlertTriangle />, failed: <X />, not_compared: <CircleDashed />,
}
const statusWord: Record<VerificationStepStatus, string> = {
  passed: '일치', review: '확인 필요', failed: '불일치', not_compared: '미대조',
}
const kindIcon: Record<EvidenceSupport['kind'], React.ReactNode> = {
  upload: <FileSpreadsheet />, document: <FileText />, partner: <PlugZap />, public: <Globe />, declared: <Scale />,
}
const kindWord: Record<EvidenceSupport['kind'], string> = {
  upload: '올린 표에서 계산', document: '서류 판독', partner: '기관 연결', public: '공개 자료', declared: '사장님 신고값',
}

/** 단위에 맞춰 사람이 읽는 문자열로 바꾼다. 없는 값은 '미산정'이다. */
function formatValue(value: number | string | null, unit: EvidenceLink['unit']) {
  if (value === null || value === undefined || value === '') return '미산정'
  if (typeof value === 'string') return value
  if (unit === 'won') return `${Math.round(value).toLocaleString('ko-KR')}원`
  if (unit === 'percent') return `${value}%`
  if (unit === 'years') return `${value}년`
  if (unit === 'count') return `${value.toLocaleString('ko-KR')}개`
  return String(value)
}

export default function EvidencePanel({ ledger, title = '이 숫자가 어디서 나왔는지 보여드려요' }: {
  ledger?: EvidenceLedger
  title?: string
}) {
  const [openMetric, setOpenMetric] = useState('')
  if (!ledger || (!ledger.links.length && !ledger.crossChecks.length)) return null
  const quality = ledger.quality

  return <section className="evidence-panel">
    <header className="evidence-head">
      <div>
        <span className="eyebrow"><Scale /> 자료 근거와 일치도</span>
        <h2>{title}</h2>
        <p>먹투는 사장님이 적어 넣은 숫자를 그대로 쓰지 않아요. 올려주신 자료에서 직접 계산하고, 서로 다른 자료끼리 맞춰본 결과를 함께 보여드립니다.</p>
      </div>
      <QualityDial quality={quality} />
    </header>

    {ledger.crossChecks.length > 0 && <div className="evidence-crosschecks">
      <h3>서로 다른 자료를 맞춰봤어요</h3>
      <div className="crosscheck-grid">
        {ledger.crossChecks.map((check) => <CrossCheckCard key={check.code} check={check} />)}
      </div>
      {quality.notCompared.length > 0 && <p className="evidence-note">
        <CircleDashed /> 아직 대조하지 못한 항목: {quality.notCompared.join(', ')}. 해당 자료를 올리면 일치도가 더 촘촘해져요.
      </p>}
    </div>}

    {ledger.links.length > 0 && <div className="evidence-links">
      <h3>값마다 근거를 남겼어요 <small>{ledger.links.length}개 지표</small></h3>
      <ul>
        {ledger.links.map((link) => {
          const open = openMetric === link.metric
          return <li key={link.metric} className={open ? 'open' : ''}>
            <button type="button" onClick={() => setOpenMetric(open ? '' : link.metric)} aria-expanded={open}>
              <span className="link-label">{link.label}</span>
              <b className="link-value">{formatValue(link.value, link.unit)}</b>
              <em className="link-count">근거 {link.supports.length}건</em>
              <ChevronDown />
            </button>
            {open && <div className="link-supports">
              {link.supports.map((support, index) => <div className={`support support-${support.kind}`} key={`${support.sourceId}-${index}`}>
                <span className="support-icon">{kindIcon[support.kind]}</span>
                <div>
                  <b>{support.sourceLabel}</b>
                  <small>{kindWord[support.kind]}{support.file ? ` · ${support.file}` : ''}{support.rows ? ` · ${support.rows.toLocaleString('ko-KR')}행` : ''}</small>
                  {support.note && <em>{support.note}</em>}
                </div>
                <div className="support-value">
                  <b>{formatValue(support.value, link.unit)}</b>
                  <small>확신 {Math.round(support.confidence * 100)}%</small>
                </div>
              </div>)}
            </div>}
          </li>
        })}
      </ul>
    </div>}

    <p className="evidence-disclaimer">
      여기 보이는 값은 모두 제출된 자료에서 계산한 것이고, 읽어내지 못한 항목은 추정하지 않고 미산정으로 남겼어요.
      자료 일치도는 승인 결과가 아니며 최종 승인은 운영자가 원본을 확인한 뒤 이뤄집니다.
    </p>
  </section>
}

/** 자료 일치도 하나. 점수와 함께 "몇 쌍을 맞춰봤는지"를 반드시 같이 보여준다. */
export function QualityDial({ quality, compact = false }: { quality: EvidenceLedger['quality']; compact?: boolean }) {
  const score = quality.score
  const tone = score === null ? 'none' : score >= 90 ? 'good' : score >= 75 ? 'fair' : 'warn'
  return <div className={`quality-dial tone-${tone} ${compact ? 'compact' : ''}`}>
    <div className="quality-score">
      <b>{score === null ? '—' : score}</b>
      <small>{score === null ? '대조할 자료 부족' : `자료 일치도 · ${quality.grade}`}</small>
    </div>
    <ul>
      <li><span>대조한 자료 쌍</span><b>{quality.comparedPairs}/{quality.possiblePairs}</b></li>
      <li><span>사용한 자료 종류</span><b>{quality.sourceCount}종</b></li>
      <li><span>판독한 서류</span><b>{quality.documentCount}건</b></li>
      <li><span>불일치</span><b>{quality.mismatches.length}건</b></li>
    </ul>
  </div>
}

function CrossCheckCard({ check }: { check: EvidenceCrossCheck }) {
  const won = (value: number) => value.toLocaleString('ko-KR')
  return <article className={`crosscheck ${check.status}`}>
    <header>
      <span className="crosscheck-mark">{statusIcon[check.status]}</span>
      <div><b>{check.label}</b><em>{statusWord[check.status]}</em></div>
      <strong>{check.differenceRate}%<small>차이</small></strong>
    </header>
    <div className="crosscheck-pair">
      <div><small>{check.left.label}</small><b>{won(check.left.value)}</b></div>
      <span>↔</span>
      <div><small>{check.right.label}</small><b>{won(check.right.value)}</b></div>
    </div>
    <p>{check.detail}</p>
    <footer>허용 차이 {check.tolerance}% · 이 대조의 점수 {check.score}점 · 가중치 {check.weight}</footer>
  </article>
}
