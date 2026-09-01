import { useEffect, useState } from 'react'
import { BarChart3, CircleDollarSign, ShieldCheck, Store, Users } from 'lucide-react'
import { api } from './lib/api.ts'
import type { ApplicationResult, MeState, User } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

type AdminApplication = ApplicationResult & { userId: string; owner?: User }
type AdminUser = User & { positions: number; applications: number }
type Dashboard = {
  stats: { users: number; owners: number; pendingApplications: number; activeFunds: number; funded: number }
  users: AdminUser[]
  applications: AdminApplication[]
}

const statusLabel: Record<ApplicationResult['status'], string> = {
  approved: '승인',
  conditional: '조건부 승인',
  manual_review: '관리자 검토 대기',
  rejected: '보완 필요',
}

export default function AdminCenter({ me, onLogin, notify }: { me: MeState | null; onLogin: () => void; notify: (message: string) => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [tab, setTab] = useState<'applications' | 'users'>('applications')

  useEffect(() => {
    if (me?.user.role !== 'admin') return
    api<Dashboard>('/api/admin/dashboard').then(setDashboard).catch((error) => notify(error.message))
  }, [me?.user.id, me?.user.role])

  if (me?.user.role !== 'admin') {
    return <div className="page-wrap admin-locked">
      <ShieldCheck />
      <h1>먹투 관리자 전용</h1>
      <p>회원 현황과 소상공인 심사 결과는 관리자 계정에서만 확인할 수 있어요.</p>
      <button className="button" onClick={onLogin}>관리자 데모로 로그인</button>
    </div>
  }

  if (!dashboard) return <div className="page-wrap admin-loading">운영 데이터를 불러오는 중...</div>

  return <div className="page-wrap admin-page">
    <section className="admin-hero">
      <div><span className="eyebrow coral"><ShieldCheck /> 먹투 운영센터</span><h1>AI가 읽고,<br />사람이 마지막으로 확인해요.</h1><p>회원과 펀딩, 소상공인 심사 현황을 한곳에서 확인합니다.</p></div>
      <div className="admin-badge">ADMIN<small>{me.user.name}</small></div>
    </section>
    <section className="admin-kpis">
      <div><Users /><span>전체 회원</span><b>{dashboard.stats.users}명</b></div>
      <div><Store /><span>사장님 회원</span><b>{dashboard.stats.owners}명</b></div>
      <div><BarChart3 /><span>추가 검토 대기</span><b>{dashboard.stats.pendingApplications}건</b></div>
      <div><CircleDollarSign /><span>누적 펀딩</span><b>{won(dashboard.stats.funded)}</b></div>
    </section>
    <div className="admin-tabs">
      <button className={tab === 'applications' ? 'active' : ''} onClick={() => setTab('applications')}>소상공인 심사</button>
      <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>회원 현황</button>
    </div>
    {tab === 'applications' ? <section className="admin-review-list">
      {dashboard.applications.length ? dashboard.applications.map((application) => <article key={application.id}>
        <span className={`review-state ${application.status}`}>{statusLabel[application.status]}</span>
        <div className="review-main"><small>{application.owner?.name || '사장님'} · {new Date(application.submittedAt).toLocaleDateString('ko-KR')}</small><h3>{application.restaurantName}</h3><p>{application.explanation}</p></div>
        <div className="review-score"><small>AI 분석 점수</small><b>{application.score}</b><span>{won(application.approvedLimit)}</span></div>
      </article>) : <div className="admin-empty"><ShieldCheck /><b>현재 관리자 검토를 기다리는 신청이 없어요.</b><p>사장님이 추가 검토 대상으로 심사를 제출하면 여기에 표시됩니다.</p></div>}
    </section> : <section className="admin-user-table">
      <div className="table-head"><span>회원</span><span>유형</span><span>투자 식당</span><span>심사 신청</span><span>상태</span></div>
      {dashboard.users.map((user) => <div key={user.id}><span><b>{user.name}</b><small>{user.email}</small></span><span>{user.role === 'owner' ? '사장님' : '투자자'}</span><span>{user.positions}곳</span><span>{user.applications}건</span><span className={user.accountStatus === 'suspended' ? 'suspended' : 'active'}>{user.accountStatus === 'suspended' ? '이용 정지' : '정상'}</span></div>)}
    </section>}
  </div>
}
