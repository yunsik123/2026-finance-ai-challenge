import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BadgeCheck, ChevronRight, CircleAlert, Clock3, Eye, FileCheck2, Store, WalletCards } from 'lucide-react'
import { api } from './lib/api.ts'
import VerificationReport from './VerificationReport.tsx'
import CreditGradePanel from './CreditGradePanel.tsx'
import type { ApplicationResult, Fund, MeState, Restaurant } from './types.ts'
import './owner-my.css'

type OwnerState = {
  restaurants: Restaurant[]
  funds: Fund[]
  applications: ApplicationResult[]
}

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const date = (value: string) => new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const statusCopy = {
  approved: { label: 'AI 검증 통과', detail: 'AI 검증 기준을 충족했어요. 운영자 최종 승인 뒤 투자자 식당 목록에 공개됩니다.', icon: BadgeCheck },
  conditional: { label: '조건부 승인', detail: '성장성은 확인됐지만 운영자 확인 또는 일부 자료 보강이 필요해요.', icon: Clock3 },
  manual_review: { label: '추가 검토 중', detail: '자료 부족이나 불일치를 운영자가 직접 확인하고 있어요.', icon: FileCheck2 },
  rejected: { label: '보완 후 재신청', detail: '현재 자료로는 검증을 통과하지 못했어요. 보완 항목을 확인해주세요.', icon: CircleAlert },
} as const

export default function OwnerMyPage({ me }: { me: MeState }) {
  const [owner, setOwner] = useState<OwnerState | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const applications = useMemo(() => [...(owner?.applications || me.applications)].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [owner, me.applications])
  const selected = applications.find((item) => item.id === selectedId) || applications[0]
  const restaurant = owner?.restaurants.find((item) => item.sourceApplicationId === selected?.id)
    || owner?.restaurants.find((item) => item.name === selected?.restaurantName)
    || owner?.restaurants[0]
  const fund = owner?.funds.find((item) => item.restaurantId === restaurant?.id)

  useEffect(() => {
    let live = true
    api<OwnerState>('/api/owner').then((result) => { if (live) setOwner(result) }).catch(() => undefined)
    return () => { live = false }
  }, [me.applications.length])

  if (!selected) return <div className="page-wrap owner-my-page">
    <header className="owner-my-head"><div><span className="eyebrow coral"><Store /> 사장님 MY</span><h1>{me.user.name}님의<br />검증 현황</h1><p>AI 심사를 접수하면 통과 여부와 보완할 자료를 이곳에서 계속 확인할 수 있어요.</p></div><NavLink className="button" to="/owner">첫 펀딩 신청하기 <ChevronRight /></NavLink></header>
    <section className="owner-my-empty"><FileCheck2 /><h2>아직 접수한 펀딩 심사가 없어요</h2><p>원천자료를 제출하면 AI 예비평가 결과와 공개 여부가 여기에 기록됩니다.</p></section>
  </div>

  const status = statusCopy[selected.status]
  const StatusIcon = status.icon
  const published = selected.status === 'approved' && restaurant?.verificationStatus !== 'submitted' && restaurant?.verificationStatus !== 'rejected' && Boolean(fund)

  return <div className="page-wrap owner-my-page">
    <header className="owner-my-head"><div><span className="eyebrow coral"><Store /> 사장님 MY</span><h1>{me.user.name}님의<br />검증 현황</h1><p>심사 결과와 투자자 공개 상태를 한곳에서 확인하세요.</p></div><NavLink className="button" to="/owner">추가 펀딩 신청 <ChevronRight /></NavLink></header>

    {me.user.sessionMode === 'demo' && <div className="owner-my-demo"><Eye /><p><b>체험 모드 결과입니다.</b> 심사 화면과 결과 확인은 동일하지만 체험 식당은 다른 투자자 계정에 공개되지 않습니다.</p></div>}

    <section className={`owner-verification-hero ${selected.status}`}>
      <div className="owner-status-icon"><StatusIcon /></div>
      <div><span>최신 AI 검증 결과</span><h2>{status.label}</h2><p>{status.detail}</p><small>{selected.restaurantName} · {date(selected.submittedAt)}</small></div>
      <div className="owner-score"><span>예비평가</span><b>{selected.score}<small>/100</small></b><em>제안 한도 {won(selected.approvedLimit)}</em></div>
    </section>

    <section className={`owner-publication ${published ? 'published' : ''}`}>
      <div className="owner-publication-icon">{published ? <Eye /> : <Clock3 />}</div>
      <div><span>투자자 공개 상태</span><h2>{published ? '식당 발견 목록에 공개 중' : selected.status === 'approved' ? '운영자 최종 승인 대기' : '최종 승인 후 공개돼요'}</h2><p>{published ? `${restaurant?.region} ${restaurant?.neighborhood} · ${restaurant?.category} · 펀딩 목표 ${won(fund?.goal || 0)}` : 'AI 검증 통과만으로 바로 공개하지 않으며, 운영자 최종 승인 전에는 투자자에게 노출되지 않습니다.'}</p></div>
      {published && <strong><BadgeCheck /> 공개 검증 완료</strong>}
    </section>

    <div className="owner-my-summary">
      <article><FileCheck2 /><span>사업자 확인</span><b>{selected.data?.businessVerification?.verified ? '통과' : '확인 필요'}</b></article>
      <article><WalletCards /><span>제안 펀딩 한도</span><b>{won(selected.approvedLimit)}</b></article>
      <article><Eye /><span>데이터 신뢰도</span><b>{selected.data?.dataConfidence || 0}%</b></article>
    </div>

    {selected.data?.creditAssessment && <CreditGradePanel credit={selected.data.creditAssessment} combined={selected.data.combinedAssessment} />}
    <VerificationReport business={selected.data?.businessVerification} financial={selected.data?.financialVerification} />

    <div className="owner-review-grid">
      <section><h3>확인된 강점</h3>{selected.strengths.map((item) => <p key={item}><BadgeCheck /> {item}</p>)}</section>
      <section><h3>보완하면 좋은 항목</h3>{selected.improvements.length ? selected.improvements.map((item) => <p key={item}><CircleAlert /> {item}</p>) : <p><BadgeCheck /> 현재 추가 보완 요청이 없어요.</p>}</section>
    </div>

    <section className="owner-application-history">
      <div className="subheading"><div><span>APPLICATION HISTORY</span><h2>심사 신청 내역</h2></div><NavLink to="/legal">내 동의 기록 보기 <ChevronRight /></NavLink></div>
      <div>{applications.map((application) => { const itemStatus = statusCopy[application.status]; return <button className={application.id === selected.id ? 'active' : ''} key={application.id} onClick={() => setSelectedId(application.id)}><span className={`owner-history-status ${application.status}`}>{itemStatus.label}</span><div><b>{application.restaurantName}</b><small>{date(application.submittedAt)} · AI {application.score}점</small></div><strong>{won(application.approvedLimit)}</strong><ChevronRight /></button> })}</div>
    </section>
  </div>
}
