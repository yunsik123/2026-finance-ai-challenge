import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BadgeCheck, ChevronRight, CircleAlert, Clock3, Eye, FileCheck2, Store, WalletCards } from 'lucide-react'
import { api } from './lib/api.ts'
import OwnerDashboard from './OwnerDashboard.tsx'
import VerificationReport from './VerificationReport.tsx'
import CreditGradePanel from './CreditGradePanel.tsx'
import type { ApplicationResult, Fund, MeState, Restaurant } from './types.ts'
import './owner-my.css'

type AuditEvent = { id: string; action: string; summary: string; createdAt: string }

type OwnerState = {
  restaurants: Restaurant[]
  funds: Fund[]
  applications: ApplicationResult[]
  auditEvents?: AuditEvent[]
}

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const date = (value: string) => new Date(value).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const statusCopy = {
  approved: { label: 'AI 검증 통과', detail: 'AI 검증 기준을 충족했어요. 운영자 최종 승인 뒤 투자자 식당 목록에 공개됩니다.', icon: BadgeCheck },
  conditional: { label: '조건부 승인', detail: '성장성은 확인됐지만 운영자 확인 또는 일부 자료 보강이 필요해요.', icon: Clock3 },
  manual_review: { label: '추가 검토 중', detail: '자료 부족이나 불일치를 운영자가 직접 확인하고 있어요.', icon: FileCheck2 },
  rejected: { label: '보완 후 재신청', detail: '현재 자료로는 검증을 통과하지 못했어요. 보완 항목을 확인해주세요.', icon: CircleAlert },
} as const

/** 심사 기록이 아직 없는 운영 중 식당의 검증 상태 문구. 원장의 verificationStatus 를 그대로 읽는다. */
const restaurantStatusCopy = {
  verified: { label: '공개 검증 완료', detail: '운영자 최종 승인까지 끝나 투자자 식당 목록에 공개 중인 펀드예요.', icon: BadgeCheck, tone: 'approved' },
  submitted: { label: '운영자 확인 중', detail: '제출한 자료를 운영자가 확인하고 있어요. 확인이 끝나면 투자자에게 공개됩니다.', icon: FileCheck2, tone: 'manual_review' },
  rejected: { label: '보완 후 재신청', detail: '현재 자료로는 검증을 통과하지 못했어요. 자료를 보강해 다시 신청해주세요.', icon: CircleAlert, tone: 'rejected' },
} as const

/** 감사 로그의 내부 동작 코드를 사장님이 읽을 말로 바꾼다. */
const auditActions: Record<string, string> = {
  'application.analyzed': '예비심사 실행',
  'application.credit_graded': '먹투 성장성 예비평가 산정',
  'application.business_verified': '사업자 진위확인',
  'application.financial_orchestrated': '제출자료 대조',
  'data_connection.connected': '기관 연결',
  'data_connection.revoked': '기관 연결 해제',
  'coupon.dividend_issued': '식당 감사 쿠폰 발송',
  'coupon.list': '쿠폰 교환장 등록',
  'coupon.unlist': '쿠폰 교환장 등록 취소',
  'coupon.listing_updated': '교환 조건 수정',
  'coupon.offer': '교환 제안',
  'coupon.offer_declined': '교환 제안 거절',
  'coupon.offer_withdrawn': '교환 제안 철회',
  'coupon.swap': '쿠폰 교환 체결',
  'coupon.redeem_requested': '쿠폰 사용 요청',
  'coupon.redeemed': '쿠폰 사용 확인',
  'favorite.created': '관심 식당 등록',
  'favorite.deleted': '관심 식당 해제',
  'ocr.analyzed': 'AI 문서 확인',
  'support.created': '1:1 문의 접수',
  'auth.supabase_profile_created': '계정 생성',
}
const auditActionLabel = (action: string) => auditActions[action] || action.split('.').pop()?.replace(/_/g, ' ') || action

export default function OwnerMyPage({ me, refresh, notify }: { me: MeState; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [owner, setOwner] = useState<OwnerState | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const applications = useMemo(() => [...(owner?.applications || me.applications)].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [owner, me.applications])
  const selected = applications.find((item) => item.id === selectedId) || applications[0]
  const restaurant = owner?.restaurants.find((item) => item.sourceApplicationId === selected?.id)
    || owner?.restaurants.find((item) => item.name === selected?.restaurantName)
    || owner?.restaurants[0]
  const fund = owner?.funds.find((item) => item.restaurantId === restaurant?.id) || owner?.funds[0]
  const auditEvents = owner?.auditEvents || []

  const load = useCallback(async () => { setOwner(await api<OwnerState>('/api/owner')) }, [])
  useEffect(() => { load().catch(() => undefined) }, [load, me.applications.length])

  const sendDividend = async (fundId: string) => {
    try { const response = await api<{ message: string }>(`/api/owner/funds/${fundId}/dividend`, { method: 'POST', body: JSON.stringify({ discount: 10 }) }); notify(response.message); await load(); await refresh() }
    catch (error) { notify((error as Error).message) }
  }
  const toggleDisclosure = async () => {
    if (!restaurant) return
    try { const response = await api<{ message: string }>(`/api/owner/restaurants/${restaurant.id}/sales-disclosure`, { method: 'PATCH', body: JSON.stringify({ public: !restaurant.salesDisclosure }) }); notify(response.message); await load(); await refresh() }
    catch (error) { notify((error as Error).message) }
  }

  const hasFund = Boolean(restaurant && fund)
  // 심사 기록이 없어도 이미 운영 중인 펀드가 있으면 원장의 검증 상태를 그대로 보여준다.
  const restaurantStatus = restaurant ? restaurantStatusCopy[restaurant.verificationStatus || 'verified'] : undefined

  if (!selected && !hasFund) return <div className="page-wrap owner-my-page">
    <header className="owner-my-head"><div><span className="eyebrow coral"><Store /> 사장님 MY</span><h1>{me.user.name}님의<br />내 식당 펀드</h1><p>펀딩을 신청하면 검증 현황과 AI 경영 리포트를 이곳에서 계속 확인할 수 있어요.</p></div><NavLink className="button" to="/owner">첫 펀딩 신청하기 <ChevronRight /></NavLink></header>
    <section className="owner-my-empty"><FileCheck2 /><h2>아직 접수한 펀딩 심사가 없어요</h2><p>사장님 센터에서 원천자료를 제출하면 AI 예비평가 결과와 공개 여부가 여기에 기록됩니다.</p></section>
  </div>

  const status = selected ? statusCopy[selected.status] : undefined
  const StatusIcon = status?.icon
  const RestaurantStatusIcon = restaurantStatus?.icon
  const published = selected
    ? selected.status === 'approved' && restaurant?.verificationStatus !== 'submitted' && restaurant?.verificationStatus !== 'rejected' && Boolean(fund)
    : restaurant?.verificationStatus !== 'submitted' && restaurant?.verificationStatus !== 'rejected' && Boolean(fund)

  return <div className="page-wrap owner-my-page">
    <header className="owner-my-head"><div><span className="eyebrow coral"><Store /> 사장님 MY</span><h1>{me.user.name}님의<br />내 식당 펀드</h1><p>모집 현황과 AI 경영 리포트, 검증 결과를 한곳에서 확인하세요.</p></div><NavLink className="button" to="/owner">{hasFund ? '추가 펀딩 신청' : '펀딩 신청하기'} <ChevronRight /></NavLink></header>

    {me.user.sessionMode === 'demo' && <div className="owner-my-demo"><Eye /><p><b>체험 모드 결과입니다.</b> 심사 화면과 결과 확인은 동일하지만 체험 식당은 다른 투자자 계정에 공개되지 않습니다.</p></div>}

    {hasFund && <OwnerDashboard data={owner} onDividend={sendDividend} />}

    {restaurant && <section className="sales-disclosure-control"><div><span><Eye /></span><div><b>투자자 매출 데이터 공개</b><p>보너스 산정 결과는 항상 공개하고, 정확한 월매출 그래프는 사장님이 선택합니다.</p></div></div><button className={restaurant.salesDisclosure ? 'active' : ''} onClick={toggleDisclosure}><i />{restaurant.salesDisclosure ? '월매출 공개 중' : '월매출 비공개'}</button></section>}

    <div className="subheading owner-my-verification-heading"><div><span>FUND VERIFICATION</span><h2>내 펀드 검증 현황</h2></div></div>

    {selected && status && StatusIcon ? <section className={`owner-verification-hero ${selected.status}`}>
      <div className="owner-status-icon"><StatusIcon /></div>
      <div><span>최신 AI 검증 결과</span><h2>{status.label}</h2><p>{status.detail}</p><small>{selected.restaurantName} · {date(selected.submittedAt)}</small></div>
      <div className="owner-score"><span>예비평가</span><b>{selected.score}<small>/100</small></b><em>제안 한도 {won(selected.approvedLimit)}</em></div>
    </section> : restaurant && restaurantStatus && RestaurantStatusIcon ? <section className={`owner-verification-hero ${restaurantStatus.tone}`}>
      <div className="owner-status-icon"><RestaurantStatusIcon /></div>
      <div><span>현재 검증 상태</span><h2>{restaurantStatus.label}</h2><p>{restaurantStatus.detail}</p><small>{restaurant.name} · {restaurant.region} {restaurant.neighborhood} · {restaurant.category}</small></div>
      <div className="owner-score"><span>먹투 기회점수</span><b>{restaurant.opportunityScore}<small>/100</small></b><em>펀딩 목표 {won(fund?.goal || 0)}</em></div>
    </section> : null}

    <section className={`owner-publication ${published ? 'published' : ''}`}>
      <div className="owner-publication-icon">{published ? <Eye /> : <Clock3 />}</div>
      <div><span>투자자 공개 상태</span><h2>{published ? '식당 발견 목록에 공개 중' : selected?.status === 'approved' ? '운영자 최종 승인 대기' : '최종 승인 후 공개돼요'}</h2><p>{published ? `${restaurant?.region} ${restaurant?.neighborhood} · ${restaurant?.category} · 펀딩 목표 ${won(fund?.goal || 0)}` : 'AI 검증 통과만으로 바로 공개하지 않으며, 운영자 최종 승인 전에는 투자자에게 노출되지 않습니다.'}</p></div>
      {published && <strong><BadgeCheck /> 공개 검증 완료</strong>}
    </section>

    {selected && <>
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
    </>}

    {!selected && restaurant && <section className="owner-my-empty owner-my-empty-inline"><FileCheck2 /><h2>이 펀드는 운영자 검증으로 등록됐어요</h2><p>AI 예비평가 리포트와 신용등급 카드는 위 <b>추가 펀딩 신청</b>으로 다음 라운드를 접수하면 이곳에 함께 쌓입니다.</p></section>}

    {applications.length > 0 && <section className="owner-application-history">
      <div className="subheading"><div><span>APPLICATION HISTORY</span><h2>심사 신청 내역</h2></div><NavLink to="/legal">내 동의 기록 보기 <ChevronRight /></NavLink></div>
      <div>{applications.map((application) => { const itemStatus = statusCopy[application.status]; return <button className={application.id === selected?.id ? 'active' : ''} key={application.id} onClick={() => setSelectedId(application.id)}><span className={`owner-history-status ${application.status}`}>{itemStatus.label}</span><div><b>{application.restaurantName}</b><small>{date(application.submittedAt)} · AI {application.score}점</small></div><strong>{won(application.approvedLimit)}</strong><ChevronRight /></button> })}</div>
    </section>}

    {auditEvents.length > 0 && <section className="owner-audit"><div><span className="eyebrow">AUDIT TRAIL</span><h2>내 계정 변경 이력</h2><p>심사 접수, 자료 연결, 등급 산정처럼 중요한 변경을 시간과 함께 남겨둡니다.</p></div><div>{auditEvents.slice(0, 8).map((event) => <article key={event.id}><span><BadgeCheck /></span><div><b>{event.summary}</b><small>{date(event.createdAt)} · {auditActionLabel(event.action)}</small></div></article>)}</div></section>}
  </div>
}
