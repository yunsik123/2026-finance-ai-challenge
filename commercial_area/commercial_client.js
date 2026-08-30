/**
 * 모아(MOA) 프론트엔드용 상권분석 클라이언트 모듈.
 * 
 * 브라우저 화면(가게 상세 모달, 소상공인 대시보드)에서
 * 주소 기반으로 상권 분석 지표와 투자자 브리프 카드를 즉시 불러올 수 있습니다.
 */

// 사전 구축된 주요 상권 데이터
export const COMMERCIAL_AREAS = {
  SEOUL_SEONGDONG_SEONGSU: {
    areaCode: 'SEOUL_SEONGDONG_SEONGSU',
    region: '서울 성동구',
    areaName: '성수동 카페거리·연무장길 상권',
    aliases: ['성수', '성수동', '성수이로', '뚝섬', '서울숲', '성동구'],
    summary: 'IT 스타트업·패션 플래그십과 젊은 층 유입이 활발한 서울 대표 핫플레이스 발달상권',
    dailyFootTraffic: 54200,
    growthRate: 8.4,
    workerPopulation: 38500,
    externalRatio: 74.2,
    competitorDensity: 0.54,
    closureRate: 7.8,
    averageTicketSize: 29800,
    localSalesGrowth: 6.1,
    primaryCustomer: '2030 직장인 및 외지 주말 방문객',
    transit: '지하철 2호선 성수역·뚝섬역 초역세권'
  },
  SEOUL_MAPO_YEONNAM: {
    areaCode: 'SEOUL_MAPO_YEONNAM',
    region: '서울 마포구',
    areaName: '연남동·경의선숲길 로스터리 골목상권',
    aliases: ['마포', '마포구', '연남', '연남동', '성미산로', '홍대입구', '망원'],
    summary: '개성 있는 스페셜티 카페와 공방 중심의 문화 소비형 골목상권',
    dailyFootTraffic: 41500,
    growthRate: 3.2,
    workerPopulation: 19800,
    externalRatio: 78.5,
    competitorDensity: 0.71,
    closureRate: 10.4,
    averageTicketSize: 22400,
    localSalesGrowth: 4.5,
    primaryCustomer: '20대 여성 중심 산책·데이트 및 디저트 탐방객',
    transit: '지하철 2호선·경의중앙선 홍대입구역 도보 5~10분'
  },
  SEOUL_JONGNO_SEOCHON: {
    areaCode: 'SEOUL_JONGNO_SEOCHON',
    region: '서울 종로구',
    areaName: '서촌·통의동 감성 미식 골목상권',
    aliases: ['종로', '종로구', '서촌', '통의동', '자하문로', '경복궁', '청와대'],
    summary: '역사 문화 공간과 고즈넉한 파인다이닝·전통 맛집이 공존하는 목적형 상권',
    dailyFootTraffic: 33200,
    growthRate: 5.1,
    workerPopulation: 27000,
    externalRatio: 66.8,
    competitorDensity: 0.83,
    closureRate: 13.7,
    averageTicketSize: 36500,
    localSalesGrowth: 3.8,
    primaryCustomer: '정부청사/기업 직장인 및 미식·전시 방문객',
    transit: '지하철 3호선 경복궁역 도보 5분'
  },
  GYEONGGI_SUWON_HAENGGUNG: {
    areaCode: 'GYEONGGI_SUWON_HAENGGUNG',
    region: '경기 수원시',
    areaName: '수원 화성 행궁동 공방·행리단길 상권',
    aliases: ['수원', '수원시', '행궁동', '행리단길', '화성행궁', '팔달구'],
    summary: '세계문화유산 화성을 배경으로 급성장한 로컬 로드샵 및 특색 음식점 상권',
    dailyFootTraffic: 28400,
    growthRate: 6.8,
    workerPopulation: 11500,
    externalRatio: 81.2,
    competitorDensity: 0.62,
    closureRate: 9.1,
    averageTicketSize: 25400,
    localSalesGrowth: 5.8,
    primaryCustomer: '경기 남부권 2030 주말 나들이객 및 관광객',
    transit: '수원역 연계 버스 10분, 행궁광장 인접'
  }
};

/**
 * 주소 문자열로부터 일치하는 상권 데이터 반환
 */
export function getCommercialAreaByAddress(address = '') {
  const clean = String(address || '').trim().toLowerCase();
  for (const area of Object.values(COMMERCIAL_AREAS)) {
    if (area.aliases.some(alias => clean.includes(alias.toLowerCase()))) {
      return area;
    }
  }
  // 기본값으로 성수동 상권 반환
  return COMMERCIAL_AREAS.SEOUL_SEONGDONG_SEONGSU;
}

/**
 * 투자자용 상권 인사이트 HTML 카드 컴포넌트 생성
 */
export function renderCommercialInsightCards(area) {
  if (!area) return '';
  return `
    <div class="commercial-insight-box">
      <div class="commercial-header">
        <span class="commercial-tag">📍 상권 분석</span>
        <strong>${area.areaName}</strong>
      </div>
      <p class="commercial-summary">${area.summary}</p>
      <div class="commercial-metrics-grid">
        <div class="c-metric">
          <small>일 유동인구</small>
          <b>${(area.dailyFootTraffic || 0).toLocaleString()}명</b>
          <span class="trend ${area.growthRate >= 0 ? 'up' : 'down'}">${area.growthRate >= 0 ? '+' : ''}${area.growthRate}% 성장</span>
        </div>
        <div class="c-metric">
          <small>배후 직장인</small>
          <b>${(area.workerPopulation || 0).toLocaleString()}명</b>
          <span class="note">평일 점심 수요</span>
        </div>
        <div class="c-metric">
          <small>외지인 소비비중</small>
          <b>${area.externalRatio}%</b>
          <span class="note">광역 고객 유입력</span>
        </div>
        <div class="c-metric">
          <small>주변 폐업률</small>
          <b>${area.closureRate}%</b>
          <span class="note">경쟁 밀도 ${area.competitorDensity}</span>
        </div>
      </div>
    </div>
  `;
}
