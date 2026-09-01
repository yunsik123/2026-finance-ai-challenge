import { BarChart3, Gift, Store, Ticket, TrendingUp, Users } from 'lucide-react'
import './owner-dashboard.css'

type Props = {
  data: any
  onDividend: (fundId: string) => void
  onNewFund: () => void
}

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

export default function OwnerDashboard({ data, onDividend, onNewFund }: Props) {
  const restaurant = data.restaurants[0]
  const fund = data.funds[0]
  const useRate = fund.totalCouponIssued ? Math.round(fund.totalCouponUsed / fund.totalCouponIssued * 100) : 0
  const outstanding = Math.max(0, fund.totalCouponIssued - fund.totalCouponUsed)
  const exposure = Math.min(100, Math.round(outstanding / restaurant.monthlySales * 100))
  return <div className="owner-dashboard">
    <div className="dashboard-heading"><div><span>사장님 운영 대시보드</span><h2>{restaurant.name}의 펀드가 잘 자라고 있어요</h2><p>발급·사용 쿠폰과 예상 부담을 매출에 맞춰 매일 확인하세요.</p></div><button className="button" onClick={onNewFund}>추가 펀딩 준비</button></div>
    <div className="owner-kpis"><div><Store /><span>모인 투자금</span><b>{won(fund.raised)}</b><small>목표의 {Math.round(fund.raised / fund.goal * 100)}%</small></div><div><Users /><span>함께한 투자자</span><b>{fund.investorCount}명</b><small>1인 최대 목표액의 1%</small></div><div><Ticket /><span>발급 쿠폰 혜택</span><b>{won(fund.totalCouponIssued)}</b><small>누적 최대 할인액 기준</small></div><div><BarChart3 /><span>실제 사용 혜택</span><b>{won(fund.totalCouponUsed)}</b><small>발급액의 {useRate}% 사용</small></div></div>
    <div className="owner-dashboard-grid"><section className="coupon-health"><div className="subheading"><div><span>쿠폰 손익 안전판</span><h2>이번 달 예상 쿠폰 부담</h2></div></div><div className="health-amount"><b>{won(outstanding)}</b><span>아직 사용되지 않은 최대 할인액</span></div><div className="health-track"><i style={{ width: `${exposure}%` }} /></div><div className="health-labels"><span>월매출 대비 {exposure}%</span><b>{exposure < 8 ? '안정' : exposure < 15 ? '관찰' : '주의'}</b></div><p>최대 할인액 기준의 보수적인 수치예요. 발급 속도와 실제 사용률이 높아지면 최대 할인율을 낮추거나 배당 쿠폰을 잠시 쉬어보세요.</p></section><section className="fund-control"><div className="subheading"><div><span>투자자 관계</span><h2>깜짝 배당 쿠폰</h2></div><Gift /></div><p>매출이 좋은 달에는 투자자에게 감사 쿠폰을 보낼 수 있어요. 현재 원가와 미사용 쿠폰 부담을 먼저 확인하세요.</p><div className="dividend-preview"><TrendingUp /><div><b>추천 배당 10%</b><span>최대 {won(restaurant.maxMenuPrice * .1)} × {fund.investorCount}명</span></div></div><button className="button full" onClick={() => onDividend(fund.id)}>10% 배당 쿠폰 보내기</button></section></div>
  </div>
}
