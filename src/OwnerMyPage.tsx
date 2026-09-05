import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BadgeCheck, ChevronRight, CircleAlert, Clock3, Eye, FileCheck2, History, ListChecks, Store, WalletCards } from 'lucide-react'
import { api } from './lib/api.ts'
import OwnerDashboard from './OwnerDashboard.tsx'
import CouponVerify from './CouponVerify.tsx'
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
  'ai.owner_report': '경영 리포트 분석',
  'ai.anomaly_detection': '매출 이상징후 분석',
  'support.created': '1:1 문의 접수',
  'auth.supabase_profile_created': '계정 생성',
}
const auditActionLabel = (action: string) => auditActions[action] || action.split('.').pop()?.replace(/_/g, ' ') || action
/** 기존 감사 기록에 저장된 제공사·모델명은 사용자 화면에서 감춘다. */
const auditSummary = (event: AuditEvent) => {
  if (event.action === 'ai.owner_report' || event.action === 'ai.anomaly_detection') return event.summary.split(' · ')[0]
  return event.summary.replace(/\s*·\s*(?:gpt|chatgpt|o\d|claude|gemini|meoktu-)[\w.-]*/gi, '').trim()
}

export default function OwnerMyPage({ me, refresh, notify }: { me: MeState; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [owner, setOwner] = useState<OwnerState | null>(null)
  /** 이력에서 직접 고른 심사 신청. */
  const [selectedId, setSelectedId] = useState('')
  /** 위 '내 펀드'에서 고른 가게. 신청을 직접 고르면 그 신청의 가게가 우선한다. */
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('')
  const applications = useMemo(() => [...(owner?.applications || me.applications)].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)), [owner, me.applications])

  /**
   * 사장님이 등록한 가게마다 '현재 라운드 펀드 + 그 가게의 심사 이력'을 묶는다.
   *
   * 예전에는 restaurants[0]·funds[0] 만 읽어서 가게를 두 곳 등록해도
   * 첫 번째 가게의 모금액·리포트·매출 공개 설정만 보였다.
   */
  const portfolios = useMemo(() => {
    const restaurants = owner?.restaurants || []
    const funds = owner?.funds || []
    return restaurants.map((restaurant) => ({
      restaurant,
      // 한 가게에 라운드가 여러 개면 진행 중인 것을, 없으면 가장 최근 라운드를 본다.
      fund: [...funds].filter((item) => item.restaurantId === restaurant.id)
        .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.round - a.round)[0],
      applications: applications.filter((item) => restaurant.sourceApplicationId === item.id || item.restaurantName === restaurant.name),
    }))
  }, [owner, applications])

  const picked = applications.find((item) => item.id === selectedId)
  const active = picked
    ? portfolios.find((item) => item.restaurant.sourceApplicationId === picked.id || item.restaurant.name === picked.restaurantName)
    : portfolios.find((item) => item.restaurant.id === selectedRestaurantId) || portfolios[0]
  // 가게를 고르면 그 가게의 최근 심사가 리포트 기준이 된다. 아직 가게가 없으면 최근 신청을 본다.
  const selected = picked || active?.applications[0] || (portfolios.length ? undefined : applications[0])
  const restaurant = active?.restaurant
  const fund = active?.fund
  const showFund = (restaurantId: string) => { setSelectedRestaurantId(restaurantId); setSelectedId('') }
  const auditEvents = owner?.auditEvents || []
  const visibleAuditEvents = auditEvents.filter((event) => event.action !== 'coupon.dividend_issued').slice(0, 8)

  const load = useCallback(async () => { setOwner(await api<OwnerState>('/api/owner')) }, [])
  useEffect(() => { load().catch(() => undefined) }, [load, me.applications.length])

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
    <header className="owner-my-head"><div><span className="eyebrow coral"><Store /> 사장님 MY</span><h1>{me.user.name}님의<br />내 식당 펀드</h1><p>등록된 내 식당의 모집 현황과 운영 리포트, 검증 결과를 한곳에서 확인하세요.</p></div><NavLink className={hasFund ? 'button secondary' : 'button'} to="/owner">{hasFund ? '새 펀딩 등록하기' : '펀딩 등록하기'} <ChevronRight /></NavLink></header>

    {me.user.sessionMode === 'demo' && <div className="owner-my-demo"><Eye /><p><b>체험 모드 결과입니다.</b> 심사 화면과 결과 확인은 동일하지만 체험 식당은 다른 투자자 계정에 공개되지 않습니다.</p></div>}

    {portfolios.length > 1 && <section className="owner-fund-switcher">
      <div className="owner-fund-switcher-head">
        <div><span className="eyebrow coral"><Store /> 내 펀드 {portfolios.length}개</span><h2>어느 가게를 볼까요?</h2><p>가게를 고르면 아래 운영 현황, 검증 리포트, 매출 공개 설정이 모두 그 가게 기준으로 바뀝니다.</p></div>
      </div>
      <div className="owner-fund-switcher-list">{portfolios.map((item) => {
        const isActive = item.restaurant.id === restaurant?.id
        const progress = item.fund ? Math.min(100, Math.round(item.fund.raised / item.fund.goal * 100)) : 0
        const state = restaurantStatusCopy[item.restaurant.verificationStatus || 'verified']
        return <button type="button" key={item.restaurant.id} aria-pressed={isActive} className={isActive ? 'active' : ''} onClick={() => showFund(item.restaurant.id)}>
          <span className="owner-fund-emoji">{item.restaurant.emoji}</span>
          <div className="owner-fund-copy">
            <b>{item.restaurant.name}</b>
            <small>{item.restaurant.region} {item.restaurant.neighborhood} · {item.restaurant.category}</small>
            {item.fund
              ? <em>{item.fund.round}차 모집 · {won(item.fund.raised)} / {won(item.fund.goal)} ({progress}%)</em>
              : <em>아직 모집 중인 펀드가 없어요</em>}
            {item.fund && <span className="owner-fund-progress"><i style={{ width: `${progress}%` }} /></span>}
          </div>
          <span className={`owner-fund-state ${state.tone}`}>{state.label}</span>
        </button>
      })}</div>
    </section>}

    {restaurant && fund && <OwnerDashboard restaurant={restaurant} fund={fund} />}
    {restaurant && <CouponVerify refresh={refresh} notify={notify} />}

    {restaurant && <section className={`sales-disclosure-control ${restaurant.salesDisclosure ? 'is-public' : ''}`}>
      <div className="sales-disclosure-copy"><span><Eye /></span><div><small>데이터 공개 설정{portfolios.length > 1 ? ` · ${restaurant.name}` : ''}</small><b>투자자 매출 데이터 공개</b><p>검증된 매출 성장지수는 항상 공개하고, 정확한 월별 매출액은 사장님이 선택한 경우에만 보여줍니다.</p></div></div>
      <div className="sales-disclosure-action"><div><small>현재 공개 범위</small><strong>{restaurant.salesDisclosure ? '성장지수 + 월별 매출액' : '성장지수만 공개'}</strong></div><button type="button" aria-pressed={restaurant.salesDisclosure} className={restaurant.salesDisclosure ? 'active' : ''} onClick={toggleDisclosure}><i />{restaurant.salesDisclosure ? '월별 매출 공개 중' : '월별 매출 공개하기'}</button></div>
    </section>}

    <section className="owner-verification-report">
      <header className="owner-report-cover">
        <div><span><FileCheck2 /> FUND VERIFICATION REPORT</span><h2>내 펀드 검증 리포트</h2><p>최종 결과부터 평가 근거와 보완 항목까지 하나의 리포트로 정리했어요.</p></div>
        <div className="owner-report-identity"><small>검증 대상</small><b>{selected?.restaurantName || restaurant?.name}</b><span>{selected ? date(selected.submittedAt) : '현재 운영 원장 기준'}</span></div>
      </header>

      <div className="owner-report-section">
        <div className="owner-report-section-title"><span>01</span><div><small>RESULT</small><h3>최종 결과와 공개 상태</h3><p>현재 심사 결과와 투자자에게 보이는 범위를 함께 확인하세요.</p></div></div>
        {selected && status && StatusIcon ? <div className={`owner-verification-hero ${selected.status}`}>
          <div className="owner-status-icon"><StatusIcon /></div>
          <div><span>최신 AI 검증 결과</span><h2>{status.label}</h2><p>{status.detail}</p><small>{selected.restaurantName} · {date(selected.submittedAt)}</small></div>
          <div className="owner-score"><span>예비평가</span><b>{selected.score}<small>/100</small></b><em>제안 한도 {won(selected.approvedLimit)}</em></div>
        </div> : restaurant && restaurantStatus && RestaurantStatusIcon ? <div className={`owner-verification-hero ${restaurantStatus.tone}`}>
          <div className="owner-status-icon"><RestaurantStatusIcon /></div>
          <div><span>현재 검증 상태</span><h2>{restaurantStatus.label}</h2><p>{restaurantStatus.detail}</p><small>{restaurant.name} · {restaurant.region} {restaurant.neighborhood} · {restaurant.category}</small></div>
          <div className="owner-score"><span>먹투 기회점수</span><b>{restaurant.opportunityScore}<small>/100</small></b><em>펀딩 목표 {won(fund?.goal || 0)}</em></div>
        </div> : null}

        <div className={`owner-publication ${published ? 'published' : ''}`}>
          <div className="owner-publication-icon">{published ? <Eye /> : <Clock3 />}</div>
          <div><span>투자자 공개 상태</span><h2>{published ? '식당 발견 목록에 공개 중' : selected?.status === 'approved' ? '운영자 최종 승인 대기' : '최종 승인 후 공개돼요'}</h2><p>{published ? `${restaurant?.region} ${restaurant?.neighborhood} · ${restaurant?.category} · 펀딩 목표 ${won(fund?.goal || 0)}` : 'AI 검증 통과만으로 바로 공개하지 않으며, 운영자 최종 승인 전에는 투자자에게 노출되지 않습니다.'}</p></div>
          {published && <strong><BadgeCheck /> 공개 검증 완료</strong>}
        </div>
      </div>

      {selected && <>
        <div className="owner-report-section">
          <div className="owner-report-section-title"><span>02</span><div><small>SCORE</small><h3>평가 요약과 핵심 지표</h3><p>한도와 신뢰도, 업종별 성장성 평가를 같은 기준으로 읽을 수 있어요.</p></div></div>
          <div className="owner-my-summary">
            <article><FileCheck2 /><span>사업자 확인</span><b>{selected.data?.businessVerification?.verified ? '통과' : '확인 필요'}</b></article>
            <article><WalletCards /><span>제안 펀딩 한도</span><b>{won(selected.approvedLimit)}</b></article>
            <article><Eye /><span>데이터 신뢰도</span><b>{selected.data?.dataConfidence || 0}%</b></article>
          </div>
          {selected.data?.creditAssessment && <CreditGradePanel credit={selected.data.creditAssessment} combined={selected.data.combinedAssessment} />}
        </div>

        {(selected.data?.businessVerification || selected.data?.financialVerification) && <div className="owner-report-section">
          <div className="owner-report-section-title"><span>03</span><div><small>VERIFICATION</small><h3>제출 자료 검증 결과</h3><p>사업자 정보와 재무자료가 서로 일치하는지 단계별로 보여줍니다.</p></div></div>
          <VerificationReport business={selected.data?.businessVerification} financial={selected.data?.financialVerification} />
        </div>}

        <div className="owner-report-section">
          <div className="owner-report-section-title"><span>04</span><div><small>NEXT STEP</small><h3>확인된 강점과 보완 순서</h3><p>잘하고 있는 점은 유지하고, 다음 심사 전에 채울 항목을 순서대로 확인하세요.</p></div></div>
          <div className="owner-review-grid">
            <section><h3>확인된 강점</h3>{selected.strengths.map((item) => <p key={item}><BadgeCheck /> {item}</p>)}</section>
            <section><h3>보완하면 좋은 항목</h3>{selected.improvements.length ? selected.improvements.map((item) => <p key={item}><CircleAlert /> {item}</p>) : <p><BadgeCheck /> 현재 추가 보완 요청이 없어요.</p>}</section>
          </div>
        </div>
      </>}

      {!selected && restaurant && <div className="owner-report-section"><div className="owner-my-empty owner-my-empty-inline"><FileCheck2 /><h2>이 펀드는 운영자 검증으로 등록됐어요</h2><p>AI 예비평가 리포트와 신용등급은 추가 펀딩 신청으로 다음 라운드를 접수하면 이 리포트에 함께 쌓입니다.</p></div></div>}
    </section>

    {(applications.length > 0 || visibleAuditEvents.length > 0) && <section className="owner-record-report">
      <header className="owner-record-cover">
        <div><span><History /> ACTIVITY ARCHIVE</span><h2>심사와 계정 활동 기록</h2><p>신청 결과와 중요 변경을 한 곳에서 시간 순으로 확인하세요.</p></div>
        <NavLink to="/legal">내 동의 기록 <ChevronRight /></NavLink>
      </header>

      {applications.length > 0 && <div className="owner-record-section owner-application-history">
        <div className="owner-record-heading"><span><ListChecks /></span><div><small>APPLICATIONS</small><h3>심사 신청 내역</h3><p>항목을 선택하면 위 검증 리포트가 해당 신청 기준으로 바뀌어요.</p></div></div>
        <div className="owner-application-list">{applications.map((application) => { const itemStatus = statusCopy[application.status]; return <button type="button" className={application.id === selected?.id ? 'active' : ''} key={application.id} onClick={() => setSelectedId(application.id)}><span className={`owner-history-status ${application.status}`}>{itemStatus.label}</span><div><b>{application.restaurantName}</b><small>{date(application.submittedAt)} · 예비평가 {application.score}점</small></div><span className="owner-history-limit"><small>제안 한도</small><strong>{won(application.approvedLimit)}</strong></span><ChevronRight /></button> })}</div>
      </div>}

      {visibleAuditEvents.length > 0 && <div className="owner-record-section owner-audit">
        <div className="owner-record-heading"><span><History /></span><div><small>ACCOUNT HISTORY</small><h3>내 계정 변경 이력</h3><p>심사, 자료 연결, 등급 산정 등 중요 활동만 기록해요.</p></div></div>
        <div className="owner-audit-list">{visibleAuditEvents.map((event, index) => <article key={event.id}><span className="owner-audit-marker"><i />{index < visibleAuditEvents.length - 1 && <em />}</span><div><b>{auditSummary(event)}</b><small>{auditActionLabel(event.action)}</small></div><time dateTime={event.createdAt}>{date(event.createdAt)}</time></article>)}</div>
      </div>}
    </section>}
  </div>
}
