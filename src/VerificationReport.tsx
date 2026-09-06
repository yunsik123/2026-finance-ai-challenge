import { BadgeCheck, Check, X } from 'lucide-react'
import type { BusinessVerification } from './types.ts'

/**
 * 사업자 진위확인 결과만 간단히 보여준다.
 * 불완전한 문서 판독값과 재무 6단계 결과는 사용자 화면에 노출하지 않는다.
 */
export default function VerificationReport({ business }: {
  business?: BusinessVerification
}) {
  if (!business) return null

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

  </section>
}
