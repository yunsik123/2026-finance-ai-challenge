import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, BarChart3, Bot, CalendarDays, Check, ReceiptText, RefreshCw, Repeat2, Store, Ticket, TrendingUp, Users } from 'lucide-react'
import { api } from './lib/api.ts'
import type { AnomalyDetectionResponse, Fund, OwnerReportResponse, Restaurant } from './types.ts'
import './owner-dashboard.css'

/**
 * 선택한 펀드 하나의 운영 현황.
 *
 * 예전에는 원장 전체를 받아 restaurants[0]·funds[0] 만 읽었다.
 * 그래서 사장님이 가게를 두 곳 등록해도 화면에는 늘 첫 번째 가게만 나왔다.
 * 이제 어느 가게·펀드를 볼지는 마이페이지가 정하고, 이 화면은 받은 한 쌍만 그린다.
 */
type Props = { restaurant: Restaurant; fund: Fund }
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

export default function OwnerDashboard({ restaurant, fund }: Props) {
  const history = restaurant.salesHistory || []
  const current = history.at(-1)
  const previous = history.at(-2)
  const salesChange = current?.growthRate ?? (current && previous?.sales ? ((current.sales - previous.sales) / previous.sales * 100) : restaurant.salesGrowth)
  const reportMonth = current?.month || new Date().toISOString().slice(0, 7)
  const useRate = fund.totalCouponIssued ? Math.round(fund.totalCouponUsed / fund.totalCouponIssued * 100) : 0
  const outstanding = Math.max(0, fund.totalCouponIssued - fund.totalCouponUsed)
  const exposure = Math.min(100, Math.round(outstanding / restaurant.monthlySales * 100))

  // 리포트 문장은 서버에서 받아온다. 매출·재방문·쿠폰 수치를 그대로 넘기고 생성형이 해석하며,
  // AI 키가 없거나 호출이 실패하면 서버가 같은 모양의 규칙 기반 리포트를 대신 내려준다.
  const [analysis, setAnalysis] = useState<OwnerReportResponse | null>(null)
  const [anomaly, setAnomaly] = useState<AnomalyDetectionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [anomalyLoading, setAnomalyLoading] = useState(true)
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

  const loadAnomalies = useCallback(async (refresh = false) => {
    setAnomalyLoading(true)
    try {
      setAnomaly(await api<AnomalyDetectionResponse>('/api/ai/anomaly-detection', {
        method: 'POST', body: JSON.stringify({ restaurantId: restaurant.id, refresh }),
      }))
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '매출 이상탐지를 불러오지 못했어요.')
    } finally { setAnomalyLoading(false) }
  }, [restaurant.id])

  // 매출 이력·쿠폰 사용액이 바뀌면 서버 지문도 바뀌어 새 분석이 돌고, 그대로면 만들어둔 해석을 재사용한다.
  useEffect(() => { void loadReport() }, [loadReport, current?.month, fund.totalCouponUsed, fund.totalCouponIssued])
  useEffect(() => { void loadAnomalies() }, [loadAnomalies, current?.month, current?.sales])

  const report = analysis?.report
  const aiGenerated = analysis?.provider === 'openai'
  const anomalyResult = anomaly?.result

  return <div className="owner-dashboard">
    <div className="dashboard-heading"><div><span>사장님 운영 대시보드</span><h2>{restaurant.name}의 현재 운영 현황</h2><p>투자금, 쿠폰 부담과 월간 경영 지표를 함께 확인하세요.</p></div></div>
    <div className="owner-kpis"><div><Store /><span>모인 투자금</span><b>{won(fund.raised)}</b><small>목표의 {Math.round(fund.raised / fund.goal * 100)}%</small></div><div><Users /><span>함께한 투자자</span><b>{fund.investorCount}명</b><small>현재 참여 인원</small></div><div><Ticket /><span>발급 쿠폰 혜택</span><b>{won(fund.totalCouponIssued)}</b><small>누적 최대 할인액 기준</small></div><div><BarChart3 /><span>실제 사용 혜택</span><b>{won(fund.totalCouponUsed)}</b><small>발급액의 {useRate}% 사용</small></div></div>

    <section className="ai-owner-report">
      <div className="report-heading">
        <div><span><CalendarDays /> AI 점주 경영 리포트 · 상권·식당 분석</span><h2>{reportMonth.replace('-', '년 ')}월 운영 요약</h2><p>{report?.headline || '현재 연결된 매출·고객·쿠폰과 공개 상권 데이터를 바탕으로 만든 월간 참고 리포트입니다.'}</p></div>
        <div className="report-actions">
          <b className={aiGenerated ? 'ai' : ''}>{loading ? '분석 중' : aiGenerated ? <><Bot /> AI 분석 완료</> : '자동 규칙 요약'}</b>
          <button type="button" onClick={() => void loadReport(true)} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /> 다시 분석</button>
        </div>
      </div>
      <div className="report-summary"><div><small>최근 월 매출</small><b>{won(current?.sales || restaurant.monthlySales)}</b></div><div><small>전월 대비</small><b className={salesChange >= 0 ? 'positive' : 'negative'}>{salesChange >= 0 ? '+' : ''}{salesChange.toFixed(1)}%</b></div><div><small>재방문율</small><b>{restaurant.repeatRate}%</b></div><div><small>쿠폰 사용률</small><b>{useRate}%</b></div></div>
      {analysis?.facts.area && <div className="report-area-source"><b>{analysis.facts.area.name} 상권 원자료</b><span>유동인구 {analysis.facts.area.footTrafficGrowth >= 0 ? '+' : ''}{analysis.facts.area.footTrafficGrowth}%</span><span>상권매출 {analysis.facts.area.localSalesGrowth >= 0 ? '+' : ''}{analysis.facts.area.localSalesGrowth}%</span><span>폐업률 {analysis.facts.area.closureRate}%</span><small>주소 기반 공개 상권자료를 식당 원장과 구분해 분석</small></div>}

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
        <p className="report-provenance">{aiGenerated ? 'AI가 위 원장 수치만 받아 해석했습니다.' : '연결된 원장 수치로 규칙 기반 요약을 표시했습니다.'} · 기준 시각 {new Date(analysis!.generatedAt).toLocaleString('ko-KR')}{analysis!.cached ? ' · 자료가 바뀌지 않아 직전 분석을 재사용했습니다.' : ''}</p>
      </> : null}
    </section>

    <section className={`anomaly-panel ${anomalyResult?.status || 'loading'}`}>
      <div className="anomaly-heading">
        <div><span><Activity /> 매출 이상탐지</span><h2>평소 흐름을 벗어난 달을 확인해요</h2><p>월별 변화의 중앙값과 MAD를 사용해 한 번의 급등락에도 기준선이 흔들리지 않게 계산합니다.</p></div>
        <div className="report-actions">
          <b className={anomaly?.provider === 'openai' ? 'ai' : ''}>{anomalyLoading ? '탐지 중' : anomaly?.provider === 'openai' ? <><Bot /> AI 설명 완료</> : '통계 엔진 분석'}</b>
          <button type="button" onClick={() => void loadAnomalies(true)} disabled={anomalyLoading}><RefreshCw className={anomalyLoading ? 'spin' : ''} /> 다시 탐지</button>
        </div>
      </div>
      {anomalyResult && <>
        <div className="anomaly-summary"><strong>{anomalyResult.status === 'critical' ? '즉시 확인' : anomalyResult.status === 'watch' ? '확인 필요' : anomalyResult.status === 'normal' ? '특이 신호 없음' : '자료 부족'}</strong><p>{anomalyResult.summary}</p></div>
        <div className="anomaly-baseline"><span>분석 표본 <b>{anomalyResult.sampleSize}개월</b></span><span>평소 월 변화 <b>{anomalyResult.baselineChangeRate >= 0 ? '+' : ''}{anomalyResult.baselineChangeRate}%</b></span><span>예상 범위 <b>{anomalyResult.expectedRange.min}% ~ {anomalyResult.expectedRange.max}%</b></span></div>
        {anomalyResult.anomalies.length > 0 && <div className="anomaly-events">{anomalyResult.anomalies.map((item) => <article className={item.severity} key={item.month}><AlertTriangle /><div><b>{item.month.replace('-', '년 ')}월 · {item.changeRate >= 0 ? '+' : ''}{item.changeRate}%</b><p>{item.reason}</p></div><strong>{won(item.sales)}</strong></article>)}</div>}
        <div className="anomaly-checks"><b>사람이 확인할 순서</b><ol>{anomalyResult.nextChecks.map((item) => <li key={item}>{item}</li>)}</ol></div>
        <p className="report-provenance">수치 판정은 {anomalyResult.method} 통계 엔진이 수행했습니다. {anomaly?.provider === 'openai' ? 'AI는 판정을 바꾸지 않고 설명만 작성했습니다.' : '통계 결과와 고정 확인 절차를 표시합니다.'}</p>
      </>}
    </section>

    <div className="owner-dashboard-grid owner-dashboard-grid-single"><section className="coupon-health"><div className="subheading"><div><span>쿠폰 손익 안전선</span><h2>이번 달 예상 쿠폰 부담</h2></div></div><div className="health-amount"><b>{won(outstanding)}</b><span>아직 사용되지 않은 최대 할인액</span></div><div className="health-track"><i style={{ width: `${exposure}%` }} /></div><div className="health-labels"><span>월매출 대비 {exposure}%</span><b>{exposure < 8 ? '안정' : exposure < 15 ? '관찰' : '주의'}</b></div><p>최대 할인액 기준의 보수적인 수치입니다. 실제 사용률이 높아지면 다음 쿠폰의 할인율과 발급 범위를 조정해보세요.</p></section></div>
  </div>
}
