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

const demo = ({ id, name, category, address, sales, age, description, ownerStory, highlights, menuItems, campaignName,
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
  representativeMenu: menuItems?.[0]?.name || (category === '카페' ? '시그니처 핸드드립' : '대표 시그니처 메뉴'),
  representativeMenuPrice: menuItems?.[0]?.price || (category === '카페' ? 6500 : 24000),
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
    ownerStory: ownerStory || '손님 한 분 한 분께 정성과 신뢰를 담은 최고의 경험을 드리고자 매일 정직하게 준비합니다.',
    highlights: highlights || ['#지역명소', '#정직한재료', '#단골많은가게'],
    menuItems: menuItems || [],
    verificationStatus: 'demo_verified'
  },
  milestones: milestones.map((item, index) => milestone(`demo-${id}`, index + 1, ...item)),
  assessment: {
    score,
    isOfficial: false,
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
    description: '매일 아침 가락시장에서 공수한 제철 채소와 갓 지은 가마솥밥으로 인근 직장인과 동네 주민의 든든한 한 끼를 책임져온 8년 차 성수동 대표 한식당입니다.',
    ownerStory: '어릴 적 어머니가 차려주시던 따뜻한 집밥 한 상의 온기를 전하고 싶어 성수동에 문을 연 지 8년이 흘렀습니다. 유행을 좇기보다는 매일 먹어도 속이 편안한 건강한 식사를 만드는 것이 저희의 변함없는 철학입니다. 노후된 주방 설비를 안전한 친환경 저전력 인덕션으로 교체하여 조리 환경을 개선하고, 앞으로도 10년, 20년 변함없는 온기를 전하겠습니다.',
    highlights: ['#성수동솥밥명가', '#제철건강집밥', '#8년전통한식', '#직장인점심성지', '#정갈한7첩반상'],
    menuItems: [
      { name: '제철 버섯 영양 솥밥 정식', price: 14000, description: '6가지 제철 버섯과 은행, 밤을 넣은 가마솥 밥과 정갈한 7첩 계절 반상', isSignature: true, category: '솥밥정식' },
      { name: '한우 사골 된장찌개와 직화 제육', price: 13000, description: '24시간 푹 고아낸 한우 사골 육수에 불향 가득 직화 제육볶음 세트', isSignature: true, category: '정식' },
      { name: '완도 활전복 해물 뚝배기', price: 18000, description: '살아있는 완도 전복과 신선한 해산물이 듬뿍 들어간 시원한 보양 뚝배기', isSignature: false, category: '특선' },
      { name: '수제 떡갈비 구이 (단품 추가)', price: 8000, description: '국내산 암퇘지와 소고기를 황금비율로 다져 구워낸 육즙 가득 떡갈비', isSignature: false, category: '일품요리' }
    ],
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
    description: '연남동 조용한 골목 끝에서 직접 생두를 선별·로스팅하며 스페셜티 원두 납품과 정기구독 서비스를 함께 운영하는 6년 차 로스터리 카페입니다.',
    ownerStory: '연남동 작은 공간에서 커피를 볶기 시작한 지 어느덧 6년이 되었습니다. 좋은 커피 한 잔이 누군가의 지친 하루를 위로할 수 있다는 믿음으로, 매일 새벽 결점두를 손으로 골라내고 기후에 맞춰 로스팅 프로파일을 세밀하게 조율합니다. 이번 펀딩은 신형 12kg 대형 로스터 도입을 통해 더 안정적인 품질의 구독 원두를 생산하고, 단골 구독자분들과 투자자분들께 더 깊고 다채로운 커피를 선보이기 위한 새로운 도전입니다.',
    highlights: ['#스페셜티로스터리', '#연남동핸드드립', '#원두정기구독', '#수제디저트페어링', '#6년단골성지'],
    menuItems: [
      { name: '성미산 블렌드 핸드드립', price: 6500, description: '다크초콜릿의 묵직함과 헤이즐넛의 고소함, 깔끔한 후미가 매력적인 시그니처 블렌드', isSignature: true, category: '핸드드립' },
      { name: '에티오피아 예가체프 G1 워시드', price: 7000, description: '은은한 재스민 꽃향기와 살구, 베리류의 화사한 산미가 돋보이는 싱글오리진', isSignature: true, category: '싱글오리진' },
      { name: '이달의 로스터리 구독 원두 (200g)', price: 16000, description: '갓 볶은 제철 스페셜티 싱글오리진 원두 2종 정기 배송 패키지', isSignature: false, category: '원두' },
      { name: '바닐라빈 까눌레 & 휘낭시에 세트', price: 6800, description: '마다가스카르산 천연 바닐라빈과 프랑스 고메버터로 매일 아침 구워내는 구움과자', isSignature: false, category: '디저트' }
    ],
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
    description: '매일 아침 유기농 세몰리나와 달걀노른자로 직접 제면하는 생면 파스타와 서촌의 계절 코스를 선보이는 4년 차 이탈리안 레스토랑입니다.',
    ownerStory: '건면에서는 결코 느낄 수 없는 생면 고유의 쫄깃하고 부드러운 식감, 그리고 계절 식재료가 뿜어내는 깊은 풍미를 접시에 담아냅니다. 예약제로만 운영하며 테이블 하나하나에 정성을 쏟아왔지만, 찾아주시는 많은 분들의 발길을 돌려보내야 했던 아쉬움이 컸습니다. 이번 공간 확장으로 점심 생면 워크숍과 더 많은 좌석을 마련하여 서촌을 찾는 분들께 특별한 미식 경험을 선물하겠습니다.',
    highlights: ['#서촌생면파스타', '#자가제면워크숍', '#이탈리안코스요리', '#데이트예약명소', '#내추럴와인페어링'],
    menuItems: [
      { name: '생트러플 타야린 파스타', price: 24000, description: '매일 아침 뽑은 얇은 타야린 생면에 이탈리아산 생트러플 버터 소스를 듬뿍 얹은 시그니처', isSignature: true, category: '파스타' },
      { name: '포르치니 버섯 비프 라구 파파르델레', price: 22000, description: '8시간 동안 정성껏 끓여낸 진한 소고기 라구와 넓적한 파파르델레 생면', isSignature: true, category: '파스타' },
      { name: '웻에이징 한우 채끝 스테이크 (200g)', price: 45000, description: '2주간 저온 숙성하여 숯불 향을 입힌 최상급 한우 채끝과 구운 계절 채소', isSignature: false, category: '메인' },
      { name: '수제 티라미수와 에스프레소', price: 9000, description: '사보이아르디 쿠키와 마스카포네 치즈로 정통 방식으로 만든 디저트', isSignature: false, category: '디저트' }
    ],
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
    description: '전통 닥나무 한지를 현대적 감각의 공예품과 인테리어 소품으로 재해석하고, 원데이 클래스를 운영하는 수원 행궁동 대표 문화 공방입니다.',
    ownerStory: '천 년을 숨 쉬는 우리의 전통 한지가 박물관 속 유물이 아니라, 누구나 일상에서 만지고 느끼는 따뜻한 예술이 되기를 꿈꿉니다. 아이부터 직장인, 외국인 관광객까지 한지를 뜯고 붙이며 마음을 치유하는 공간을 5년간 가꾸어왔습니다. 평일 단체 체험 공간을 확장하여 학생들과 직장인 워크숍 수요를 수용하고, 전통의 아름다움을 더 널리 나누고자 합니다.',
    highlights: ['#수원행궁동공방', '#전통한지원데이클래스', '#문화체험워크숍', '#핸드메이드한지조명', '#힐링체험공간'],
    menuItems: [
      { name: '한지 달 무드등 만들기 원데이 클래스', price: 35000, description: '전통 한지의 은은한 빛 투과를 활용해 나만의 감성 무드등을 제작하는 90분 체험', isSignature: true, category: '체험클래스' },
      { name: '천연 염색 한지 엽서 & 책갈피 세트', price: 12000, description: '쪽, 치자 등 천연 염료로 물들인 고급 수제 한지 엽서 5종 세트', isSignature: true, category: '공예품' },
      { name: '전통 닥종이 인형 공예 키트', price: 25000, description: '집에서도 손쉽게 한지 공예의 멋을 즐길 수 있는 올인원 DIY 키트', isSignature: false, category: 'DIY키트' }
    ],
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
    description: '빈티지 턴테이블, 진공관 앰프, 수동 아날로그 음향 기기의 정밀 복원 수리와 청음실을 결합한 부산 전포동 전문 수리 스튜디오입니다.',
    ownerStory: '음악이 디지털 파일로 소비되는 시대지만, LP판 위를 긁고 지나가는 바늘의 아날로그 질감은 사람의 마음을 울리는 고유한 울림이 있습니다. 버려질 위기에 처한 빈티지 기기들을 한 땀 한 땀 살려내며 기기의 역사와 주인의 추억을 복원한다는 자부심으로 7년을 지켜왔습니다. 최신 정밀 계측 장비를 도입해 수리 기간을 획기적으로 줄이고 더 완벽한 음질을 복원해 드리겠습니다.',
    highlights: ['#빈티지오디오수리', '#턴테이블전문복원', '#전포카페거리명소', '#아날로그청음실', '#7년경력장인정신'],
    menuItems: [
      { name: '턴테이블 카트리지 정밀 정렬 & 세팅', price: 40000, description: '톤암 각도, 안티스케이팅, 침압 정밀 계측을 통한 최적의 LP 재생 밸런스 조정', isSignature: true, category: '정밀수리' },
      { name: '빈티지 앰프 전해콘덴서 오버홀', price: 150000, description: '노후 부품을 오디오 그레이드 부품으로 전면 교체하여 잡음 제거 및 출력 복원', isSignature: true, category: '오버홀' },
      { name: '프리미엄 LP 클리닝 & 정전기 방지 케어', price: 15000, description: '초음파 세척기를 이용한 미세 홈 이물질 제거 및 보호 슬리브 증정', isSignature: false, category: '케어' }
    ],
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
    description: '지역 유기농 밀가루와 100% 천연 효모종으로 속 편한 발효빵과 시그니처 선물 세트를 굽는 대전 중앙로 대표 베이커리입니다.',
    ownerStory: '빵의 도시 대전에서, 매일 먹어도 더부룩하지 않고 구수함이 입안 가득 맴도는 천연 발효빵을 만들겠다는 고집으로 시작했습니다. 첨가물 없이 물, 밀가루, 소금, 그리고 오랜 시간의 발효만으로 빵의 본질을 찾습니다. 온라인 택배 주문이 급증함에 따라 항온 항습 발효실과 신선 포장 라인을 증설하여 전국 각지의 고객분들께 당일 구운 최상의 빵을 보내드리겠습니다.',
    highlights: ['#대전빵지순례', '#천연발효사워도우', '#지역유기농밀', '#속편한비건빵', '#온라인주문폭주'],
    menuItems: [
      { name: '보문산 맷돌 사워도우 깜빠뉴', price: 8500, description: '직접 맷돌로 제분한 통밀과 72시간 저온 발효종으로 구워낸 겉바속촉 시그니처 식사빵', isSignature: true, category: '천연발효빵' },
      { name: '공주 밤 듬뿍 발효 식빵', price: 9000, description: '달콤한 국산 통밤이 아낌없이 들어간 쫄깃하고 부드러운 유기농 식빵', isSignature: true, category: '식빵' },
      { name: '무화과 피칸 호밀 바게트', price: 6500, description: '와인에 졸인 건무화과와 고소한 피칸이 씹히는 담백한 유럽식 식사 바게트', isSignature: false, category: '바게트' },
      { name: '시그니처 발효빵 4종 홈 딜리버리 박스', price: 32000, description: '당일 구운 베스트 빵 4종을 특수 산소 차단 포장으로 집까지 배송하는 세트', isSignature: false, category: '선물세트' }
    ],
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
