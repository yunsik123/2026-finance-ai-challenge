import { AlertTriangle, BarChart3, CalendarDays, Check, Gift, ReceiptText, Repeat2, Store, Ticket, TrendingUp, Users } from 'lucide-react'
import './owner-dashboard.css'

type Props = { data: any; onDividend: (fundId: string) => void; onNewFund: () => void }
const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

export default function OwnerDashboard({ data, onDividend, onNewFund }: Props) {
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
  const suggestedDiscount = restaurant.repeatRate < 55 ? Math.min(15, fund.maxDiscount) : Math.min(10, fund.maxDiscount)
  const salesReason = salesChange >= 3
    ? `유동인구 증가율 ${restaurant.footTrafficGrowth}%와 재방문율 ${restaurant.repeatRate}%가 매출 상승에 함께 영향을 준 것으로 보입니다.`
    : salesChange >= 0
      ? `매출은 유지됐지만 성장 폭이 작습니다. 신규 유입보다 재방문 고객의 기여도를 먼저 확인해보세요.`
      : `매출이 전월보다 감소했습니다. 상권 유동인구와 시간대별 주문 감소를 나눠 확인할 필요가 있습니다.`
  const repeatAction = restaurant.repeatRate >= 65
    ? '단골 비중이 높은 편입니다. 기존 고객에게 방문 주기별 감사 혜택을 제공해 이탈을 줄여보세요.'
    : '첫 방문 후 14일 안에 재방문할 수 있는 소액 쿠폰과 대표 메뉴 알림을 시험해보세요.'
  const costItems = restaurant.category === '베이커리'
    ? ['식재료·포장재 단가', '오븐 전력비', '폐기율']
    : restaurant.category === '카페'
      ? ['원두·유제품 단가', '배달 수수료', '인건비']
      : ['식재료 원가', '배달·결제 수수료', '인건비']
  const tasks = [
    `시간대별 매출과 전월 차이를 주 1회 기록하기`,
    `재방문 고객 대상 ${suggestedDiscount}% 쿠폰을 소규모로 2주간 시험하기`,
    `${costItems[0]}의 매입 단가와 사용량을 분리해 확인하기`,
  ]

  return <div className="owner-dashboard">
    <div className="dashboard-heading"><div><span>사장님 운영 대시보드</span><h2>{restaurant.name}의 현재 운영 현황</h2><p>투자금, 쿠폰 부담과 월간 경영 지표를 함께 확인하세요.</p></div><button className="button" onClick={onNewFund}>추가 펀딩 준비</button></div>
    <div className="owner-kpis"><div><Store /><span>모인 투자금</span><b>{won(fund.raised)}</b><small>목표의 {Math.round(fund.raised / fund.goal * 100)}%</small></div><div><Users /><span>함께한 투자자</span><b>{fund.investorCount}명</b><small>현재 참여 인원</small></div><div><Ticket /><span>발급 쿠폰 혜택</span><b>{won(fund.totalCouponIssued)}</b><small>누적 최대 할인액 기준</small></div><div><BarChart3 /><span>실제 사용 혜택</span><b>{won(fund.totalCouponUsed)}</b><small>발급액의 {useRate}% 사용</small></div></div>

    <section className="ai-owner-report">
      <div className="report-heading"><div><span><CalendarDays /> AI 점주 경영 리포트</span><h2>{reportMonth.replace('-', '년 ')}월 운영 요약</h2><p>현재 연결된 매출·고객·쿠폰 데이터를 바탕으로 만든 월간 참고 리포트입니다.</p></div><b>월간 자동 분석</b></div>
      <div className="report-summary"><div><small>최근 월 매출</small><b>{won(current?.sales || restaurant.monthlySales)}</b></div><div><small>전월 대비</small><b className={salesChange >= 0 ? 'positive' : 'negative'}>{salesChange >= 0 ? '+' : ''}{salesChange.toFixed(1)}%</b></div><div><small>재방문율</small><b>{restaurant.repeatRate}%</b></div><div><small>쿠폰 사용률</small><b>{useRate}%</b></div></div>
      <div className="report-grid">
        <article><div className="report-icon coral"><TrendingUp /></div><div><span>최근 매출 변화 원인</span><h3>{salesChange >= 0 ? '매출 흐름이 유지·상승 중입니다' : '매출 감소 요인 점검이 필요합니다'}</h3><p>{salesReason}</p><small>상관관계에 기반한 해석이며 원인을 확정하지 않습니다.</small></div></article>
        <article><div className="report-icon green"><Repeat2 /></div><div><span>재방문율 개선 방법</span><h3>현재 재방문율 {restaurant.repeatRate}%</h3><p>{repeatAction}</p><small>고객 동의 범위 내 메시지와 혜택을 사용하세요.</small></div></article>
        <article><div className="report-icon yellow"><Ticket /></div><div><span>쿠폰 할인율 제안</span><h3>{suggestedDiscount}% 소규모 실험</h3><p>전체 고객에게 일괄 적용하지 말고 재방문 대상에게 2주간 시험한 뒤 사용률과 객단가를 비교하세요.</p><small>최대 할인율 {fund.maxDiscount}% · 수익 보장 또는 가격 결정이 아닙니다.</small></div></article>
        <article><div className="report-icon navy"><ReceiptText /></div><div><span>비용 증가 점검 항목</span><h3>직접 비용 자료 미연동</h3><div className="cost-tags">{costItems.map((item) => <em key={item}>{item} 확인 필요</em>)}</div><small>실제 매입·급여·수수료 자료 연결 전에는 비용 증가로 단정하지 않습니다.</small></div></article>
      </div>
      <div className="next-actions"><div><Check /><span><b>다음 달 실행 과제</b><small>실행 후 결과를 다음 리포트에서 비교합니다.</small></span></div><ol>{tasks.map((task) => <li key={task}>{task}</li>)}</ol></div>
      <div className="report-warning"><AlertTriangle /><p>이 리포트는 운영 판단을 돕는 참고 정보입니다. 원가·세무·노무 자료가 연결되지 않은 항목은 반드시 실제 장부와 전문가 확인을 거쳐주세요.</p></div>
    </section>

    <div className="owner-dashboard-grid"><section className="coupon-health"><div className="subheading"><div><span>쿠폰 손익 안전선</span><h2>이번 달 예상 쿠폰 부담</h2></div></div><div className="health-amount"><b>{won(outstanding)}</b><span>아직 사용되지 않은 최대 할인액</span></div><div className="health-track"><i style={{ width: `${exposure}%` }} /></div><div className="health-labels"><span>월매출 대비 {exposure}%</span><b>{exposure < 8 ? '안정' : exposure < 15 ? '관찰' : '주의'}</b></div><p>최대 할인액 기준의 보수적인 수치입니다. 실제 사용률이 높아지면 다음 쿠폰의 할인율과 발급 범위를 조정해보세요.</p></section><section className="fund-control"><div className="subheading"><div><span>투자자 관계</span><h2>깜짝 배당 쿠폰</h2></div><Gift /></div><p>매출이 좋은 달에는 투자자에게 감사 쿠폰을 보낼 수 있습니다. 현재 예상 쿠폰 부담을 먼저 확인하세요.</p><div className="dividend-preview"><TrendingUp /><div><b>배당 쿠폰 10%</b><span>최대 {won(restaurant.maxMenuPrice * .1)} × {fund.investorCount}명</span></div></div><button className="button full" onClick={() => onDividend(fund.id)}>10% 배당 쿠폰 보내기</button></section></div>
  </div>
}
