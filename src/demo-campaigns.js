// 투자자가 서비스의 검토 흐름을 바로 체험할 수 있도록 제공하는 가상 모집안입니다.
// 실제 사업체·실제 투자상품이 아니며, Supabase 시드가 비어 있어도 화면에 표시됩니다.

const milestone = (campaignId, sequence, title, condition, percent) => ({
  id: `${campaignId}-m${sequence}`,
  campaignId,
  sequence,
  title,
  condition,
  percent,
  status: 'planned',
  dueDate: ''
});

const demo = ({ id, name, category, address, sales, age, description, campaignName,
  target, escrowTotal, investorCount, plan, risk, score, riskLevel, components,
  milestones }) => ({
  id: `demo-${id}`,
  businessId: `demo-business-${id}`,
  name: campaignName,
  target,
  duration: 45,
  plan,
  risk,
  status: 'published',
  fundStatus: escrowTotal / target >= .8 ? 'closed' : 'fundraising',
  currentAmount: escrowTotal,
  maxDiscountRate: score >= 80 ? 50 : score >= 70 ? 40 : 30,
  minCouponRate: 10,
  couponMaxAmount: 15000,
  representativeMenu: category === '카페' ? '시그니처 음료' : '대표 메뉴',
  representativeMenuPrice: category === '카페' ? 6500 : 29000,
  publishedAt: '2026-08-01T09:00:00+09:00',
  isDemo: true,
  business: {
    id: `demo-business-${id}`,
    name,
    category,
    address,
    sales,
    age,
    description,
    verificationStatus: 'demo_verified'
  },
  milestones: milestones.map((item, index) => milestone(`demo-${id}`, index + 1, ...item)),
  assessment: {
    score,
    riskLevel,
    fundingLimit: Math.round(sales * score / 100000) * 100000,
    components,
    missing: [],
    createdAt: '2026-08-01T09:00:00+09:00'
  },
  committedTotal: escrowTotal,
  escrowTotal,
  investorCount,
  evidence: [],
  disbursements: []
});

export const DEMO_CAMPAIGNS = [
  demo({
    id: 'ongi', name: '온기린 식당', category: '한식', address: '서울 성동구 성수이로 18',
    sales: 31800000, age: 8,
    description: '제철 식재료와 인근 직장인 단골을 중심으로 8년째 운영 중인 한식당입니다.',
    campaignName: '노후 주방을 안전한 저전력 설비로 바꿉니다', target: 30000000,
    escrowTotal: 27600000, investorCount: 92,
    plan: '인덕션·환기 설비 2,100만원, 전기 증설 600만원, 공사 중 운영비 300만원에 사용합니다.',
    risk: '원재료 가격 상승과 공사 기간 중 매출 공백이 있습니다. 공급가 고정 계약과 휴업 3일 이내 공정표로 대응합니다.',
    score: 84.3, riskLevel: 'low',
    components: { '매출 지속성': 88, '현금흐름 여력': 86, '부채 부담': 78, '사업 운영 안정성': 91, '상권 회복력': 83 },
    milestones: [
      ['설비 계약', '공급계약서와 계약금 세금계산서 확인', 20],
      ['공사 착수', '전기 증설·철거 작업 사진 확인', 40],
      ['설치 완료', '설비 시운전 영상과 잔금 세금계산서 확인', 40]
    ]
  }),
  demo({
    id: 'mokhwa', name: '목화 로스터리', category: '카페', address: '서울 마포구 성미산로 42',
    sales: 24100000, age: 6,
    description: '직접 로스팅한 원두와 정기구독 매출을 함께 운영하는 연남동 소형 로스터리입니다.',
    campaignName: '로스터 교체로 구독 원두 생산량을 늘립니다', target: 24000000,
    escrowTotal: 17760000, investorCount: 74,
    plan: '12kg 로스터 1,750만원, 집진·덕트 430만원, 설치·검사비 220만원에 사용합니다.',
    risk: '원두 가격과 환율 변동, 장비 도입 효과 지연 가능성이 있습니다. 3개월분 원두 선계약과 구독 사전예약으로 대응합니다.',
    score: 71.8, riskLevel: 'review',
    components: { '매출 지속성': 76, '현금흐름 여력': 72, '부채 부담': 70, '사업 운영 안정성': 79, '상권 회복력': 61 },
    milestones: [
      ['장비 발주', '제조사 견적서와 발주서 확인', 30],
      ['반입·설치', '장비 일련번호와 설치 사진 확인', 40],
      ['검사·가동', '안전검사서와 첫 생산 기록 확인', 30]
    ]
  }),
  demo({
    id: 'table19', name: '일구의 식탁', category: '양식', address: '서울 종로구 자하문로 91',
    sales: 19600000, age: 4,
    description: '예약제 생면 파스타와 계절 코스를 운영하며 저녁 객단가가 높은 서촌 레스토랑입니다.',
    campaignName: '점심 좌석과 생면 작업실을 확장합니다', target: 40000000,
    escrowTotal: 24400000, investorCount: 61,
    plan: '인접 공간 보증금 2,000만원, 제면 장비 900만원, 인테리어 900만원, 초기 재료비 200만원입니다.',
    risk: '주변 폐업률과 경쟁 밀도가 높고 상환 부담이 큽니다. 확장 계약 전 점심 사전예약 300건 달성을 지급 조건으로 둡니다.',
    score: 52.8, riskLevel: 'high',
    components: { '매출 지속성': 61, '현금흐름 여력': 49, '부채 부담': 34, '사업 운영 안정성': 66, '상권 회복력': 54 },
    milestones: [
      ['수요 검증', '점심 사전예약 300건과 환불 조건 확인', 10],
      ['임대차 계약', '확정일자 있는 계약서 원본 확인', 50],
      ['공간 완공', '완공 사진·제면 장비 검수 확인', 40]
    ]
  }),
  demo({
    id: 'haenggung', name: '행궁 종이공방', category: '생활·서비스', address: '경기 수원시 팔달구 행궁로 27',
    sales: 16400000, age: 5,
    description: '관광객 대상 한지 공예 체험과 기업 워크숍을 운영하는 행궁동 로컬 공방입니다.',
    campaignName: '단체 체험실을 열어 평일 매출을 보완합니다', target: 18000000,
    escrowTotal: 12600000, investorCount: 48,
    plan: '체험 테이블·집기 650만원, 안전·환기 공사 520만원, 단체 예약 시스템 330만원, 재료비 300만원입니다.',
    risk: '주말 관광객 의존도가 높고 임대료가 상승 중입니다. 학교·기업 평일 계약 8건 확보 후 공사를 시작합니다.',
    score: 76.4, riskLevel: 'low',
    components: { '매출 지속성': 73, '현금흐름 여력': 78, '부채 부담': 84, '사업 운영 안정성': 81, '상권 회복력': 72 },
    milestones: [
      ['단체 계약', '학교·기업 예약 계약 8건 확인', 20],
      ['안전 공사', '소방·환기 공사 완료 확인', 45],
      ['체험실 개장', '집기 검수와 첫 단체 수업 확인', 35]
    ]
  }),
  demo({
    id: 'jeonpo', name: '전포 소리수선소', category: '생활·서비스', address: '부산 부산진구 전포대로 186',
    sales: 22400000, age: 7,
    description: '오디오·턴테이블 수리와 중고 기기 판매를 결합한 전포동 전문 수리점입니다.',
    campaignName: '정밀 계측 장비로 수리 대기시간을 줄입니다', target: 22000000,
    escrowTotal: 9900000, investorCount: 37,
    plan: '오실로스코프·신호발생기 1,200만원, 방음 작업대 600만원, 부품 재고 400만원에 사용합니다.',
    risk: '관광 소비보다 전문 수요에 의존하고 기술 인력 충원이 어렵습니다. 장비 교육 이수와 외주 기사 계약을 먼저 확인합니다.',
    score: 73.1, riskLevel: 'review',
    components: { '매출 지속성': 77, '현금흐름 여력': 75, '부채 부담': 82, '사업 운영 안정성': 80, '상권 회복력': 51 },
    milestones: [
      ['장비·교육 계약', '장비 견적과 교육 일정 확인', 30],
      ['작업대 완공', '방음 측정값과 완공 사진 확인', 30],
      ['운영 개선', '수리 리드타임 20% 단축 기록 확인', 40]
    ]
  }),
  demo({
    id: 'daejeon', name: '은행동 빵실험실', category: '카페', address: '대전 중구 중앙로 164',
    sales: 28700000, age: 3,
    description: '지역 농산물 발효빵과 선물세트를 판매하며 온라인 주문 비중이 빠르게 늘고 있는 베이커리입니다.',
    campaignName: '발효실과 포장 설비로 온라인 출고를 안정화합니다', target: 28000000,
    escrowTotal: 22960000, investorCount: 83,
    plan: '저온 발효실 1,100만원, 자동 포장기 900만원, 전기 공사 500만원, 시험 생산비 300만원입니다.',
    risk: '신규 베이커리 경쟁과 성수기 택배 품질 위험이 있습니다. 온도 기록 포장 테스트와 반품률 기준을 지급 조건에 포함합니다.',
    score: 80.2, riskLevel: 'low',
    components: { '매출 지속성': 87, '현금흐름 여력': 82, '부채 부담': 76, '사업 운영 안정성': 72, '상권 회복력': 82 },
    milestones: [
      ['설비 계약', '발효실·포장기 통합 견적 확인', 25],
      ['시험 생산', '온도 기록과 포장 파손 테스트 확인', 35],
      ['출고 안정화', '4주 반품률 2% 이하 자료 확인', 40]
    ]
  })
];
