import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BadgeCheck, ChevronRight, CircleAlert, Clock3, Eye, FileCheck2, History, ListChecks, Store, WalletCards } from 'lucide-react'
import { api } from './lib/api.ts'
import OwnerDashboard from './OwnerDashboard.tsx'
import CouponVerify from './CouponVerify.tsx'
import VerificationReport from './VerificationReport.tsx'
import CreditGradePanel from './CreditGradePanel.tsx'
import EvidencePanel from './EvidencePanel.tsx'
import { ApplicationExtrasSummary } from './ApplicationExtras.tsx'
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
   * 사업체 하나에 '펀드 + 그 사업체의 심사 이력 전체'를 묶는다.
   *
   * 예전에는 이 목록을 db.restaurants 로만 만들었다. 그런데 가게 원장은 운영자가 최종 승인해
   * 공개할 때 비로소 생긴다. 그래서 두 사업체에 펀딩을 냈어도 아직 승인 전이면
   * 목록이 비어 고를 대상이 하나도 없었고, 화면은 늘 가장 최근 신청 하나만 보여줬다.
   *
   * 그래서 승인 전 신청까지 사업체로 센다. 묶는 기준은 강한 것부터다.
   *   ① 신청서에 담긴 targetRestaurantId (같은 가게의 다음 회차)
   *   ② 그 신청으로 만들어진 가게 원장(sourceApplicationId)
   *   ③ 사업자등록번호 — 상호를 바꿔 적어도 같은 사업체로 묶인다
   *   ④ 마지막으로 상호명
   */
  const businessGroups = useMemo(() => {
    const restaurants = owner?.restaurants || []
    const funds = owner?.funds || []
    const digits = (value?: string | null) => String(value || '').replace(/\D/g, '')
    const fundsOf = (restaurantId: string) => [...funds].filter((item) => item.restaurantId === restaurantId)
      // 한 가게에 라운드가 여러 개면 진행 중인 것을, 없으면 가장 최근 라운드를 본다.
      .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.round - a.round)

    type Group = { key: string; name: string; restaurant?: Restaurant; fund?: Fund; applications: ApplicationResult[] }
    const groups: Group[] = restaurants.map((restaurant) => ({
      key: restaurant.id, name: restaurant.name, restaurant, fund: fundsOf(restaurant.id)[0], applications: [],
    }))

    /** 이 신청이 이미 만들어진 가게 원장에 속하는가. */
    const restaurantFor = (application: ApplicationResult) => restaurants.find((restaurant) =>
      application.data?.targetRestaurantId === restaurant.id
      || restaurant.sourceApplicationId === application.id
      || (!application.data?.targetRestaurantId && restaurant.name === application.restaurantName))

    for (const application of applications) {
      const restaurant = restaurantFor(application)
      if (restaurant) {
        groups.find((group) => group.key === restaurant.id)?.applications.push(application)
        continue
      }
      // 아직 가게로 등록되지 않은 신청. 사업자번호(없으면 상호)로 묶어 하나의 사업체로 센다.
      const identity = digits(application.data?.businessNumber) || application.restaurantName
      const key = `pending:${identity}`
      const existing = groups.find((group) => group.key === key)
      if (existing) existing.applications.push(application)
      else groups.push({ key, name: application.restaurantName, applications: [application] })
    }
    // 회차가 큰 것이 위로. 각 사업체 안에서는 최근 신청이 먼저다.
    for (const group of groups) {
      group.applications.sort((a, b) => (Number(b.data?.applicationRound) || 0) - (Number(a.data?.applicationRound) || 0)
        || b.submittedAt.localeCompare(a.submittedAt))
    }
    return groups
  }, [owner, applications])

  const picked = applications.find((item) => item.id === selectedId)
  /**
   * 아무것도 안 골랐을 때 무엇을 보여줄까.
   *
   * 목록 첫 번째를 그냥 쓰면 안 된다. 운영자가 먼저 등록해 둔 가게처럼 심사 기록이 없는
   * 사업체가 앞에 있으면, 방금 낸 신청 결과를 두고도 빈 리포트가 뜬다.
   * 그래서 가장 최근에 신청한 사업체를 기본으로 연다.
   */
  const defaultGroup = businessGroups.find((group) => group.applications.some((item) => item.id === applications[0]?.id))
    || businessGroups.find((group) => group.applications.length > 0)
    || businessGroups[0]
  const active = picked
    ? businessGroups.find((group) => group.applications.some((item) => item.id === picked.id))
    : businessGroups.find((group) => group.key === selectedRestaurantId) || defaultGroup
  // 사업체를 고르면 그 사업체의 최근 심사가 리포트 기준이 된다.
  const selected = picked || active?.applications[0]
  const restaurant = active?.restaurant
  const fund = active?.fund
  /** 지금 고른 사업체의 회차 목록. 회차마다 검증 리포트가 따로 나온다. */
  const rounds = active?.applications || []
  const showFund = (groupKey: string) => { setSelectedRestaurantId(groupKey); setSelectedId('') }
  const auditEvents = owner?.auditEvents || []
  const visibleAuditEvents = auditEvents.filter((event) => event.action !== 'coupon.dividend_issued' && event.action !== 'ocr.analyzed' && event.action !== 'application.financial_orchestrated').slice(0, 8)

  const loadId = useRef(0)
  const load = useCallback(async () => {
    const requestId = ++loadId.current
    const result = await api<OwnerState>('/api/owner')
    if (requestId === loadId.current) setOwner(result)
  }, [])
  useEffect(() => { void load().catch(() => undefined); return () => { ++loadId.current } }, [load, me])

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

    {businessGroups.length > 1 && <section className="owner-fund-switcher">
      <div className="owner-fund-switcher-head">
        <div><span className="eyebrow coral"><Store /> 내 사업체 {businessGroups.length}곳</span><h2>어느 사업체를 볼까요?</h2><p>사업체를 고르면 아래 운영 현황, 검증 리포트, 매출 공개 설정이 모두 그 사업체 기준으로 바뀝니다. 운영자 승인 전이라 아직 펀드가 열리지 않은 신청도 여기서 고를 수 있어요.</p></div>
      </div>
      <div className="owner-fund-switcher-list">{businessGroups.map((group) => {
        const isActive = group.key === active?.key
        const progress = group.fund ? Math.min(100, Math.round(group.fund.raised / group.fund.goal * 100)) : 0
        // 가게 원장이 아직 없으면 그 사업체의 최근 심사 결과를 상태로 보여준다.
        const latest = group.applications[0]
        const state = group.restaurant
          ? restaurantStatusCopy[group.restaurant.verificationStatus || 'verified']
          : latest ? { label: statusCopy[latest.status].label, tone: latest.status } : { label: '심사 준비 중', tone: 'manual_review' }
        return <button type="button" key={group.key} aria-pressed={isActive} className={isActive ? 'active' : ''} onClick={() => showFund(group.key)}>
          <span className="owner-fund-emoji">{group.restaurant?.emoji || '🍽️'}</span>
          <div className="owner-fund-copy">
            <b>{group.name}</b>
            <small>{group.restaurant
              ? `${group.restaurant.region} ${group.restaurant.neighborhood} · ${group.restaurant.category}`
              : `심사 ${group.applications.length}건 · 운영자 승인 전`}</small>
            {group.fund
              ? <em>{group.fund.round}차 모집 · {won(group.fund.raised)} / {won(group.fund.goal)} ({progress}%)</em>
              : <em>{group.applications.length > 1 ? `검증 리포트 ${group.applications.length}건` : '아직 모집 중인 펀드가 없어요'}</em>}
            {group.fund && <span className="owner-fund-progress"><i style={{ width: `${progress}%` }} /></span>}
          </div>
          <span className={`owner-fund-state ${state.tone}`}>{state.label}</span>
        </button>
      })}</div>
    </section>}

    {restaurant && fund && <OwnerDashboard key={`${restaurant.id}:${fund.id}`} restaurant={restaurant} fund={fund} />}
    {restaurant && <CouponVerify refresh={refresh} notify={notify} />}

    {restaurant && <section className={`sales-disclosure-control ${restaurant.salesDisclosure ? 'is-public' : ''}`}>
      <div className="sales-disclosure-copy"><span><Eye /></span><div><small>데이터 공개 설정{businessGroups.length > 1 ? ` · ${restaurant.name}` : ''}</small><b>투자자 매출 데이터 공개</b><p>검증된 매출 성장지수는 항상 공개하고, 정확한 월별 매출액은 사장님이 선택한 경우에만 보여줍니다.</p></div></div>
      <div className="sales-disclosure-action"><div><small>현재 공개 범위</small><strong>{restaurant.salesDisclosure ? '성장지수 + 월별 매출액' : '성장지수만 공개'}</strong></div><button type="button" aria-pressed={restaurant.salesDisclosure} className={restaurant.salesDisclosure ? 'active' : ''} onClick={toggleDisclosure}><i />{restaurant.salesDisclosure ? '월별 매출 공개 중' : '월별 매출 공개하기'}</button></div>
    </section>}

    {/*
      * 운영자가 보완을 요청했을 때 무엇을 고쳐야 하는지 가장 먼저 보여준다.
      * 예전에는 '보완 후 재신청'이라는 상태만 떴고 운영자가 적은 사유는 어디에도
      * 나오지 않았다. 사장님은 무엇을 고쳐야 하는지 알 수 없었다.
      * 이미 보완해 다시 낸 건(supersededBy)에는 띄우지 않는다.
      */}
    {selected && !selected.supersededBy && (selected.status === 'rejected' || selected.status === 'conditional') && <section className={`owner-review-note ${selected.status}`}>
      <div className="owner-review-note-head">
        <CircleAlert />
        <div>
          <small>{selected.reviewedAt ? `${date(selected.reviewedAt)} 운영자 확인` : '운영자 확인'}</small>
          <b>{selected.status === 'rejected' ? '보완이 필요해요' : '조건부로 승인됐어요'}</b>
        </div>
      </div>
      <p className="owner-review-note-body">{selected.reviewNote
        || (selected.status === 'rejected'
          ? '운영자가 남긴 상세 사유가 없어요. 아래 보완 항목을 확인해 자료를 보강해주세요.'
          : '조건부 승인입니다. 아래 보완 항목을 확인해주세요.')}</p>
      {selected.status === 'rejected' && <NavLink className="button" to={`/owner?resubmit=${selected.id}`}>
        보완해서 다시 제출하기 <ChevronRight />
      </NavLink>}
    </section>}

    <section className="owner-verification-report">
      <header className="owner-report-cover">
        <div><span><FileCheck2 /> FUND VERIFICATION REPORT</span><h2>내 펀드 검증 리포트</h2><p>최종 결과부터 평가 근거와 보완 항목까지 하나의 리포트로 정리했어요.</p></div>
        <div className="owner-report-identity"><small>검증 대상</small><b>{selected?.restaurantName || restaurant?.name}{Number(selected?.data?.applicationRound) ? ` · ${selected!.data!.applicationRound}회차` : ''}</b><span>{selected ? date(selected.submittedAt) : '현재 운영 원장 기준'}</span></div>
      </header>

      {/*
        같은 사업체로 회차를 여러 번 받으면 검증 리포트도 회차마다 하나씩 남는다.
        회차마다 제출한 자료도, 점수도, 대조 결과도 다르기 때문에 하나로 덮으면 안 된다.
        예전에는 최신 회차만 펼쳐 보였고 지난 회차는 맨 아래 '심사 신청 내역'까지
        내려가야 바꿀 수 있었다. 리포트 바로 위에서 고르게 한다.
      */}
      {rounds.length > 1 && <div className="owner-report-rounds">
        <div className="owner-report-rounds-head">
          <b>이 사업체의 검증 리포트 {rounds.length}건</b>
          <small>회차마다 제출 자료와 평가 결과가 다릅니다. 고른 회차 기준으로 아래 리포트 전체가 바뀝니다.</small>
        </div>
        <div className="owner-report-round-list">{rounds.map((application) => {
          const round = Number(application.data?.applicationRound) || 0
          const isActive = application.id === selected?.id
          return <button
            type="button" key={application.id} aria-pressed={isActive}
            className={isActive ? 'active' : ''} onClick={() => setSelectedId(application.id)}
          >
            <b>{round ? `${round}회차` : '심사'}</b>
            <small>{date(application.submittedAt)}</small>
            <span className={`owner-history-status ${application.status}`}>{statusCopy[application.status].label}</span>
            <em>예비평가 {application.score}점 · 제안 한도 {won(application.approvedLimit)}</em>
          </button>
        })}</div>
      </div>}

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

        {(selected.data?.businessVerification || selected.data?.evidenceLedger) && <div className="owner-report-section">
          <div className="owner-report-section-title"><span>03</span><div><small>EVIDENCE</small><h3>제출 자료와 평가 근거</h3><p>사업자 확인 결과와 예비평가에 사용한 자료 근거를 확인하세요.</p></div></div>
          {/* 이 심사에 쓰인 값마다 근거를 남겨둔다. 결과 화면에서 한 번 보고 끝나면 안 되는 정보다. */}
          <ApplicationExtrasSummary
            fundUsePlan={selected.data?.fundUsePlan}
            declaredDebt={selected.data?.declaredDebt}
            ownership={selected.data?.ownership}
            salesBasis={selected.data?.salesBasis}
          />
          <EvidencePanel ledger={selected.data?.evidenceLedger} title="이 심사에서 쓴 숫자의 근거" />
          <VerificationReport business={selected.data?.businessVerification} />
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
        <div className="owner-application-list">{applications.map((application) => {
          const itemStatus = statusCopy[application.status]
          const round = Number(application.data?.applicationRound) || undefined
          const kind = application.data?.applicationKind
          return <button type="button" className={application.id === selected?.id ? 'active' : ''} key={application.id} onClick={() => setSelectedId(application.id)}>
            <span className={`owner-history-status ${application.status}`}>{itemStatus.label}</span>
            <div>
              <b>{application.restaurantName}{round ? <em className="owner-history-round">{round}회차</em> : null}</b>
              <small>
                {kind === 'additional-round' ? '기존 가게 추가 회차' : kind === 'new-store' ? '새 가게 등록' : '심사 신청'}
                {' · '}{date(application.submittedAt)} · 예비평가 {application.score}점
                {application.data?.salesBasis ? ` · 매출 기준 ${application.data.salesBasis}` : ''}
              </small>
            </div>
            <span className="owner-history-limit"><small>제안 한도</small><strong>{won(application.approvedLimit)}</strong></span>
            <ChevronRight />
          </button>
        })}</div>
      </div>}

      {visibleAuditEvents.length > 0 && <div className="owner-record-section owner-audit">
        <div className="owner-record-heading"><span><History /></span><div><small>ACCOUNT HISTORY</small><h3>내 계정 변경 이력</h3><p>심사, 자료 연결, 등급 산정 등 중요 활동만 기록해요.</p></div></div>
        <div className="owner-audit-list">{visibleAuditEvents.map((event, index) => <article key={event.id}><span className="owner-audit-marker"><i />{index < visibleAuditEvents.length - 1 && <em />}</span><div><b>{auditSummary(event)}</b><small>{auditActionLabel(event.action)}</small></div><time dateTime={event.createdAt}>{date(event.createdAt)}</time></article>)}</div>
      </div>}
    </section>}
  </div>
}
