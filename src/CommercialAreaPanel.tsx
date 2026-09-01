import { Building2, Footprints, MapPin, Store, TrendingDown, TrendingUp, TriangleAlert, Wallet } from 'lucide-react'
import type { CommercialAreaView } from './types.ts'

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const people = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}명`

/**
 * 주소 기반 상권 분석 패널 (소상공인 프로젝트의 commercial_area 모듈을 먹투 화면에 이식).
 * compact 는 식당 상세 모달용 요약, 기본형은 검증 데이터룸용 전체 보기.
 */
export default function CommercialAreaPanel({ area, category, compact }: {
  area: CommercialAreaView
  category?: string
  compact?: boolean
}) {
  const competitors = category ? area.marketDynamics.categoryCompetitorCount?.[category] : undefined
  const risky = area.marketDynamics.closureRate >= 12 || area.marketDynamics.competitorDensity >= .75

  if (compact) {
    return <section className="commercial-compact">
      <div className="commercial-compact-head">
        <MapPin />
        <div>
          <small>주소 기반 입지 분석{area.matchLevel === 'nearby' ? ' · 같은 시·구 참고' : ''}</small>
          <b>{area.areaName}</b>
        </div>
      </div>
      <div className="commercial-compact-grid">
        <div><span>일 유동인구</span><b>{people(area.footTraffic.dailyAverage)}</b><em className={area.footTraffic.growthRate >= 0 ? 'up' : 'down'}>{area.footTraffic.growthRate >= 0 ? '+' : ''}{area.footTraffic.growthRate}%</em></div>
        <div><span>상권 매출 성장</span><b>{area.spending.localSalesGrowth}%</b><em>객단가 {won(area.spending.averageTicketSize)}</em></div>
        <div><span>주변 폐업률</span><b>{area.marketDynamics.closureRate}%</b><em>경쟁밀도 {area.marketDynamics.competitorDensity}</em></div>
        <div><span>{category ? `${category} 경쟁점포` : '총 점포'}</span><b>{(competitors ?? area.marketDynamics.totalStores).toLocaleString('ko-KR')}곳</b><em>{area.insight.competition} 경쟁</em></div>
      </div>
      <p className="commercial-compact-note">{area.insight.caution}</p>
    </section>
  }

  return <section className="commercial-panel">
    <div className="commercial-head">
      <div>
        <span className="eyebrow coral"><MapPin /> 주소 기반 입지 분석</span>
        <h3>{area.areaName}</h3>
        <p>{area.summary}</p>
      </div>
      <div className={`commercial-verdict ${risky ? 'watch' : 'stable'}`}>
        <b>{area.insight.stability}</b>
        <small>경쟁 {area.insight.competition}</small>
      </div>
    </div>

    {area.matchLevel === 'nearby' && <p className="commercial-match-note">
      이 식당이 있는 동의 상권 데이터가 아직 없어, 같은 시·구의 대표 상권 지표를 참고값으로 보여줍니다.
    </p>}

    <div className="commercial-grid">
      <article><Footprints /><span>일 유동인구</span><b>{people(area.footTraffic.dailyAverage)}</b>
        <em className={area.footTraffic.growthRate >= 0 ? 'up' : 'down'}>
          {area.footTraffic.growthRate >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {area.footTraffic.growthRate}% 성장
        </em></article>
      <article><Building2 /><span>배후 직장인</span><b>{people(area.demographics.workerPopulation)}</b><em>거주 {people(area.demographics.residentPopulation)}</em></article>
      <article><Wallet /><span>평균 객단가</span><b>{won(area.spending.averageTicketSize)}</b><em>외지 소비 {area.spending.externalConsumerRatio}%</em></article>
      <article><Store /><span>주변 폐업률</span><b>{area.marketDynamics.closureRate}%</b><em>평균 생존 {area.marketDynamics.averageLifespanYears}년</em></article>
    </div>

    <div className="commercial-detail">
      <div>
        <h4>손님이 몰리는 때</h4>
        <ul>
          {area.footTraffic.peakTimes.map((time) => <li key={time}>{time}</li>)}
          <li>평일 {area.footTraffic.weekdayRatio}% · 주말 {area.footTraffic.weekendRatio}%</li>
          <li>소비 피크 {area.spending.peakSpendingDay}</li>
        </ul>
      </div>
      <div>
        <h4>주 이용 연령</h4>
        {area.footTraffic.ageDistribution
          ? <div className="age-bars">
              {Object.entries(area.footTraffic.ageDistribution).map(([band, share]) => <div key={band}>
                <i style={{ height: `${Math.min(100, share * 2)}%` }} />
                <span>{band.replace('sPlus', '대+').replace('s', '대')}</span>
                <small>{share}%</small>
              </div>)}
            </div>
          : <p className="commercial-customer">이 상권은 연령 분포 원자료가 공개되지 않았어요.</p>}
        <p className="commercial-customer">{area.demographics.primaryCustomerProfile}</p>
      </div>
      <div>
        <h4>경쟁·임대</h4>
        <ul>
          <li>총 {area.marketDynamics.totalStores.toLocaleString('ko-KR')}개 점포 · 음식업 {area.marketDynamics.foodBeverageRatio}%</li>
          {competitors !== undefined && <li>같은 업종({category}) {competitors.toLocaleString('ko-KR')}곳</li>}
          <li>평당 임대료 {won(area.realEstate.averageRentPerPyung)} (연 {area.realEstate.rentGrowthRate}% 상승)</li>
          <li>{area.demographics.transitAccessibility}</li>
        </ul>
      </div>
    </div>

    <div className="commercial-investor-view">
      <p><b>기회</b>{area.insight.opportunity}</p>
      <p className="caution"><b><TriangleAlert size={13} /> 확인할 위험</b>{area.insight.caution}</p>
      <p className="caution"><b>젠트리피케이션</b>{area.insight.gentrification}</p>
    </div>
  </section>
}
