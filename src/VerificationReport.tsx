import { BadgeCheck, Check, CircleDashed, FileSearch, TriangleAlert, X } from 'lucide-react'
import type { BusinessVerification, FinancialOrchestration, VerificationStepStatus } from './types.ts'

const stepIcon: Record<VerificationStepStatus, React.ReactNode> = {
  passed: <Check />,
  review: <TriangleAlert />,
  failed: <X />,
  not_compared: <CircleDashed />,
}
const stepLabel: Record<VerificationStepStatus, string> = {
  passed: '통과', review: '확인 필요', failed: '불일치', not_compared: '미대조',
}

/**
 * 사업자 진위확인 + 재무자료 AI 교차검증 결과.
 * AI 판독이 승인 결정이 아니라는 점을 화면에서도 분명히 한다.
 */
export default function VerificationReport({ business, financial }: {
  business?: BusinessVerification
  financial?: FinancialOrchestration
}) {
  if (!business && !financial) return null

  return <section className="verification-report">
    {business && <div className="business-verify">
      <div className="verify-head">
        <BadgeCheck className={business.verified ? 'ok' : 'warn'} />
        <div>
          <b>사업자 진위확인 {business.verified ? '통과' : '보완 필요'}</b>
          <small>{business.message}</small>
        </div>
      </div>
      <ul className="verify-checks">
        {Object.entries(business.checks).map(([label, passed]) => <li key={label} className={passed ? 'ok' : 'fail'}>
          {passed ? <Check size={13} /> : <X size={13} />} {label.replace(/_/g, ' ')}
        </li>)}
      </ul>
    </div>}

    {financial && <div className="financial-verify">
      <div className="verify-head">
        <FileSearch />
        <div>
          <b>재무자료 AI 교차검증 6단계</b>
          <small>
            판독 문서 {financial.documentCount}건 · 평균 신뢰도 {Math.round(financial.averageConfidence * 100)}%
            {financial.readyForAdminReview ? ' · 운영자 확인 준비 완료' : ' · 추가 확인 필요'}
          </small>
        </div>
      </div>

      <ol className="verify-steps">
        {financial.steps.map((step) => <li key={step.code} className={step.status}>
          <span className="verify-mark">{stepIcon[step.status]}</span>
          <div>
            <b>{step.label}<em>{stepLabel[step.status]}</em></b>
            <p>{step.detail}</p>
          </div>
        </li>)}
      </ol>

      {financial.comparisons.length > 0 && <table className="verify-table">
        <thead><tr><th>대조 항목</th><th>신고값</th><th>문서 판독값</th><th>차이</th></tr></thead>
        <tbody>{financial.comparisons.map((item) => <tr key={item.label} className={item.status}>
          <td>{item.label}</td>
          <td>{item.claimed === null ? '—' : item.claimed.toLocaleString('ko-KR')}</td>
          <td>{item.observed === null ? '—' : item.observed.toLocaleString('ko-KR')}</td>
          <td>{item.differenceRate === null ? '미대조' : `${item.differenceRate}%`}</td>
        </tr>)}</tbody>
      </table>}

      {financial.mismatches.length > 0 && <div className="verify-alert fail">
        <b><X size={14} /> 불일치</b>
        <ul>{financial.mismatches.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>}
      {financial.warnings.length > 0 && <div className="verify-alert warn">
        <b><TriangleAlert size={14} /> 확인 필요</b>
        <ul>{financial.warnings.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>}

      <p className="verify-disclaimer">
        AI 판독은 보조자료입니다. 여기서 통과로 표시돼도 운영자가 원본을 확인해야 공식 재무심사가 됩니다.
      </p>
    </div>}
  </section>
}
