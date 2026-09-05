import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Bot, CalendarDays, Check, Gift, ReceiptText, RefreshCw, Repeat2, Store, Ticket, TrendingUp, Users } from 'lucide-react'
import { api } from './lib/api.ts'
import type { OwnerReportResponse } from './types.ts'
import './owner-dashboard.css'

type Props = { data: any; onDividend: (fundId: string) => void }
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

export default function OwnerDashboard({ data, onDividend }: Props) {
  const restaurant = data.restaurants[0]
  const fund = data.funds[0]
  const history = restaurant.salesHistory || []
  const current = history.at(-1)
  const previous = history.at(-2)
  const salesChange = current?.growthRate ?? (previous?.sales ? ((current.sales - previous.sales) / previous.sales * 100) : restaurant.salesGrowth)
  const reportMonth = current?.month || new Date().toISOString().slice(0, 7)
  const useRate = fund.totalCouponIssued ? Math.round(fund.totalCouponUsed / fund.totalCouponIssued * 100) : 0
  const outstanding = Math.max(0, fund.totalCouponIssued - fund.totalCouponUsed)
  const exposure = Math.min(100, Math.round(outstanding / restaurant.monthlySales * 100))

  // 리포트 문장은 서버에서 받아온다. 매출·재방문·쿠폰 수치를 그대로 넘기고 생성형이 해석하며,
  // AI 키가 없거나 호출이 실패하면 서버가 같은 모양의 규칙 기반 리포트를 대신 내려준다.
  const [analysis, setAnalysis] = useState<OwnerReportResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadReport = useCallback(async (refresh = false) => {
    setLoading(true)
    setError('')
    try {
      const result = await api<OwnerReportResponse>('/api/ai/owner-report', {
        method: 'POST',
        body: JSON.stringify({ restaurantId: restaurant.id, refresh }),
      })
      setAnalysis(result)
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '경영 리포트를 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }, [restaurant.id])

  // 매출 이력·쿠폰 사용액이 바뀌면 서버 지문도 바뀌어 새 분석이 돌고, 그대로면 만들어둔 해석을 재사용한다.
  useEffect(() => { void loadReport() }, [loadReport, current?.month, fund.totalCouponUsed, fund.totalCouponIssued])

  const report = analysis?.report
  const aiGenerated = analysis?.provider === 'openai'

  return <div className="owner-dashboard">
    <div className="dashboard-heading"><div><span>사장님 운영 대시보드</span><h2>{restaurant.name}의 현재 운영 현황</h2><p>투자금, 쿠폰 부담과 월간 경영 지표를 함께 확인하세요.</p></div></div>
    <div className="owner-kpis"><div><Store /><span>모인 투자금</span><b>{won(fund.raised)}</b><small>목표의 {Math.round(fund.raised / fund.goal * 100)}%</small></div><div><Users /><span>함께한 투자자</span><b>{fund.investorCount}명</b><small>현재 참여 인원</small></div><div><Ticket /><span>발급 쿠폰 혜택</span><b>{won(fund.totalCouponIssued)}</b><small>누적 최대 할인액 기준</small></div><div><BarChart3 /><span>실제 사용 혜택</span><b>{won(fund.totalCouponUsed)}</b><small>발급액의 {useRate}% 사용</small></div></div>

    <section className="ai-owner-report">
      <div className="report-heading">
        <div><span><CalendarDays /> AI 점주 경영 리포트</span><h2>{reportMonth.replace('-', '년 ')}월 운영 요약</h2><p>{report?.headline || '현재 연결된 매출·고객·쿠폰 데이터를 바탕으로 만든 월간 참고 리포트입니다.'}</p></div>
        <div className="report-actions">
          <b className={aiGenerated ? 'ai' : ''}>{loading ? '분석 중' : aiGenerated ? <><Bot /> AI 분석 완료</> : '자동 규칙 요약'}</b>
          <button type="button" onClick={() => void loadReport(true)} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /> 다시 분석</button>
        </div>
      </div>
      <div className="report-summary"><div><small>최근 월 매출</small><b>{won(current?.sales || restaurant.monthlySales)}</b></div><div><small>전월 대비</small><b className={salesChange >= 0 ? 'positive' : 'negative'}>{salesChange >= 0 ? '+' : ''}{salesChange.toFixed(1)}%</b></div><div><small>재방문율</small><b>{restaurant.repeatRate}%</b></div><div><small>쿠폰 사용률</small><b>{useRate}%</b></div></div>

      {error && <div className="report-warning"><AlertTriangle /><p>{error} 아래 수치는 원장 그대로이며, 해석 문장만 다시 불러오면 됩니다.</p></div>}

      {loading && !report ? <div className="report-grid">{[0, 1, 2, 3].map((slot) => <article key={slot} className="report-skeleton"><i /><div><span /><b /><p /></div></article>)}</div> : report ? <>
        <div className="report-grid">
          <article><div className="report-icon coral"><TrendingUp /></div><div><span>최근 매출 변화 원인</span><h3>{report.salesCause.title}</h3><p>{report.salesCause.body}</p><small>상관관계에 기반한 해석이며 원인을 확정하지 않습니다.</small></div></article>
          <article><div className="report-icon green"><Repeat2 /></div><div><span>재방문율 개선 방법</span><h3>{report.repeatPlan.title}</h3><p>{report.repeatPlan.body}</p><small>고객 동의 범위 내 메시지와 혜택을 사용하세요.</small></div></article>
          <article><div className="report-icon yellow"><Ticket /></div><div><span>쿠폰 할인율 제안</span><h3>{report.couponPlan.title}</h3><p>{report.couponPlan.body}</p><small>최대 할인율 {fund.maxDiscount}% · 수익 보장 또는 가격 결정이 아닙니다.</small></div></article>
          <article><div className="report-icon navy"><ReceiptText /></div><div><span>비용 증가 점검 항목</span><h3>{report.costCheck.title}</h3><p>{report.costCheck.body}</p><div className="cost-tags">{report.costCheck.items.map((item) => <em key={item}>{item} 확인 필요</em>)}</div><small>실제 매입·급여·수수료 자료 연결 전에는 비용 증가로 단정하지 않습니다.</small></div></article>
        </div>
        <div className="next-actions"><div><Check /><span><b>다음 달 실행 과제</b><small>실행 후 결과를 다음 리포트에서 비교합니다.</small></span></div><ol>{report.tasks.map((task) => <li key={task}>{task}</li>)}</ol></div>
        <div className="report-warning"><AlertTriangle /><p>{report.watchout}</p></div>
        <p className="report-provenance">{aiGenerated ? `${analysis!.model} 모델이 위 원장 수치만 받아 해석했습니다.` : '외부 AI 연결 전이라 같은 원장 수치로 만든 규칙 기반 요약을 표시했습니다.'} · 기준 시각 {new Date(analysis!.generatedAt).toLocaleString('ko-KR')}{analysis!.cached ? ' · 자료가 바뀌지 않아 직전 분석을 재사용했습니다.' : ''}</p>
      </> : null}
    </section>

    <div className="owner-dashboard-grid"><section className="coupon-health"><div className="subheading"><div><span>쿠폰 손익 안전선</span><h2>이번 달 예상 쿠폰 부담</h2></div></div><div className="health-amount"><b>{won(outstanding)}</b><span>아직 사용되지 않은 최대 할인액</span></div><div className="health-track"><i style={{ width: `${exposure}%` }} /></div><div className="health-labels"><span>월매출 대비 {exposure}%</span><b>{exposure < 8 ? '안정' : exposure < 15 ? '관찰' : '주의'}</b></div><p>최대 할인액 기준의 보수적인 수치입니다. 실제 사용률이 높아지면 다음 쿠폰의 할인율과 발급 범위를 조정해보세요.</p></section><section className="fund-control"><div className="subheading"><div><span>투자자 관계</span><h2>식당 감사 쿠폰</h2></div><Gift /></div><p>매출이 좋은 달에는 투자자에게 식당 감사 쿠폰을 보낼 수 있습니다. 현재 예상 쿠폰 부담을 먼저 확인하세요.</p><div className="dividend-preview"><TrendingUp /><div><b>식당 감사 쿠폰 10%</b><span>최대 {won(restaurant.maxMenuPrice * .1)} × {fund.investorCount}명</span></div></div><button className="button full" onClick={() => onDividend(fund.id)}>10% 식당 감사 쿠폰 보내기</button></section></div>
  </div>
}
