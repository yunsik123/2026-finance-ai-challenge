import type { Article, Database, EtfFund, Fund, Restaurant, Review } from './types.ts'

const now = new Date()
const day = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString()

export const restaurants: Restaurant[] = [
  {
    id: 'r-sobok', ownerId: 'u-owner', name: '소복소복', emoji: '🍚', category: '한식', region: '서울', neighborhood: '망원동',
    tagline: '제철 재료를 차곡차곡 담은 한 상', description: '망원시장에서 매일 들여온 제철 식재료로 정갈한 가정식을 만듭니다.', signature: '들기름 고등어 한상', avgPrice: 13000, maxMenuPrice: 19000,
    openedYears: 4, monthlySales: 48600000, salesGrowth: 18.4, repeatRate: 61, footTrafficGrowth: 9.2, competition: '보통', closingRate: 7.8,
    rating: 4.8, reviewCount: 1284, supporters: 347, communityScore: 92, stabilityScore: 81, story: '두 자매가 할머니의 반찬 레시피로 시작한 작은 식당이에요. 더 넓은 주방과 저온 저장고를 준비하려 합니다.', color: '#ff8465', tags: ['재방문 61%', '매출 상승', '로컬 식재료']
  },
  {
    id: 'r-huaxiang', name: '화향면관', emoji: '🍜', category: '중식', region: '서울', neighborhood: '연남동',
    tagline: '불향 가득, 매일 뽑는 도삭면', description: '주문과 동시에 면을 깎고 직접 만든 향신유로 깊은 풍미를 냅니다.', signature: '우육 도삭면', avgPrice: 12000, maxMenuPrice: 28000,
    openedYears: 2, monthlySales: 57900000, salesGrowth: 26.8, repeatRate: 54, footTrafficGrowth: 12.5, competition: '높음', closingRate: 11.2,
    rating: 4.7, reviewCount: 934, supporters: 512, communityScore: 89, stabilityScore: 74, story: '호텔 중식당 출신 셰프가 여는 첫 독립 매장입니다. 제면실 확장을 통해 대기 시간을 줄이려 해요.', color: '#f5b83d', tags: ['성장률 26.8%', '웨이팅 맛집', '셰프 스토리']
  },
  {
    id: 'r-mokhwa', name: '목화다방', emoji: '☕', category: '카페', region: '서울', neighborhood: '성수동',
    tagline: '천천히 내리는 커피와 구움과자', description: '소규모 농장의 원두와 국산 제철 과일로 만드는 동네 로스터리입니다.', signature: '참외 크림 라떼', avgPrice: 7000, maxMenuPrice: 12000,
    openedYears: 3, monthlySales: 34200000, salesGrowth: 14.2, repeatRate: 67, footTrafficGrowth: 8.1, competition: '높음', closingRate: 13.5,
    rating: 4.9, reviewCount: 641, supporters: 286, communityScore: 95, stabilityScore: 84, story: '동네 단골과 함께 성장한 12석 로스터리. 작은 로스팅룸을 마련해 원두 납품을 시작하려 합니다.', color: '#7bbf9d', tags: ['단골 67%', '고평점', '로스터리']
  },
  {
    id: 'r-bada', name: '바다의 식탁', emoji: '🐟', category: '일식', region: '부산', neighborhood: '광안리',
    tagline: '오늘 잡은 생선으로 여는 작은 이자카야', description: '부산 공동어시장에서 직접 고른 제철 생선과 사케 페어링을 선보입니다.', signature: '오늘의 모둠 사시미', avgPrice: 29000, maxMenuPrice: 58000,
    openedYears: 5, monthlySales: 73100000, salesGrowth: 11.6, repeatRate: 58, footTrafficGrowth: 6.4, competition: '보통', closingRate: 8.6,
    rating: 4.8, reviewCount: 1112, supporters: 438, communityScore: 86, stabilityScore: 88, story: '어부였던 아버지와 요리사 아들이 함께 운영합니다. 숙성고를 들여 비수기 원가를 안정시키려 합니다.', color: '#66a6d9', tags: ['5년 운영', '원가 안정', '로컬 수산']
  },
  {
    id: 'r-oven', name: '오후의 오븐', emoji: '🥐', category: '베이커리', region: '대전', neighborhood: '소제동',
    tagline: '골목에 퍼지는 버터 향', description: '우리 밀과 발효종으로 매일 소량 굽는 동네 빵집입니다.', signature: '소금버터 크루아상', avgPrice: 6500, maxMenuPrice: 36000,
    openedYears: 1, monthlySales: 29100000, salesGrowth: 34.1, repeatRate: 49, footTrafficGrowth: 17.8, competition: '낮음', closingRate: 9.1,
    rating: 4.7, reviewCount: 489, supporters: 221, communityScore: 91, stabilityScore: 68, story: '오픈 1년 만에 오전 품절이 잦아졌어요. 중고 데크오븐을 추가해 더 많은 이웃을 만나려 합니다.', color: '#dc9f6b', tags: ['성장률 34.1%', '오전 품절', '우리 밀']
  },
  {
    id: 'r-nokturn', name: '녹턴 키친', emoji: '🍝', category: '양식', region: '대구', neighborhood: '동성로',
    tagline: '밤이 되면 더 맛있는 생면 파스타', description: '지역 농가의 채소와 매일 반죽하는 생면으로 계절 파스타를 만듭니다.', signature: '청도 미나리 라구', avgPrice: 21000, maxMenuPrice: 42000,
    openedYears: 3, monthlySales: 44800000, salesGrowth: 16.9, repeatRate: 56, footTrafficGrowth: 7.2, competition: '보통', closingRate: 10.1,
    rating: 4.6, reviewCount: 718, supporters: 192, communityScore: 83, stabilityScore: 79, story: '지역 식재료를 양식으로 풀어내는 팀입니다. 런치 운영을 위한 인력과 제면기를 마련합니다.', color: '#8f86c9', tags: ['지역 농가', '생면', '런치 확장']
  },
  {
    id: 'r-dotori', name: '도토리분식', emoji: '🍢', category: '분식', region: '서울', neighborhood: '신림동',
    tagline: '학생 때 그 맛, 조금 더 건강하게', description: '직접 뽑은 쌀떡과 채소 육수로 만드는 든든한 동네 분식집입니다.', signature: '들깨 크림 떡볶이', avgPrice: 8500, maxMenuPrice: 16000,
    openedYears: 7, monthlySales: 38500000, salesGrowth: 8.7, repeatRate: 72, footTrafficGrowth: 3.4, competition: '보통', closingRate: 6.3,
    rating: 4.8, reviewCount: 1762, supporters: 608, communityScore: 97, stabilityScore: 93, story: '7년 동안 학생들의 아지트였어요. 배달 의존도를 낮추고 홀을 고쳐 더 오래 머무는 가게가 되려 합니다.', color: '#ef6f72', tags: ['단골 72%', '7년 운영', '동네 사랑방']
  },
  {
    id: 'r-greenbowl', name: '그린볼 클럽', emoji: '🥗', category: '샐러드', region: '인천', neighborhood: '송도동',
    tagline: '든든해서 다시 찾는 한 끼 샐러드', description: '지역 농가 채소와 직접 만든 소스로 구성한 고단백 샐러드 전문점입니다.', signature: '수비드 닭다리 그레인볼', avgPrice: 14500, maxMenuPrice: 19000,
    openedYears: 2, monthlySales: 32700000, salesGrowth: 22.5, repeatRate: 63, footTrafficGrowth: 10.7, competition: '낮음', closingRate: 8.9,
    rating: 4.7, reviewCount: 576, supporters: 168, communityScore: 87, stabilityScore: 76, story: '점심 정기구독 고객이 빠르게 늘고 있습니다. 친환경 다회용기 세척 설비를 마련하려 해요.', color: '#62b77d', tags: ['구독 성장', '고단백', '친환경']
  },
  {
    id: 'r-podo', name: '포도상점', emoji: '🍷', category: '주점', region: '광주', neighborhood: '동명동',
    tagline: '우리 술과 제철 안주의 편안한 밤', description: '소규모 양조장의 우리 술을 소개하고 남도 식재료로 안주를 냅니다.', signature: '제철 한상과 전통주 3잔', avgPrice: 26000, maxMenuPrice: 49000,
    openedYears: 4, monthlySales: 51600000, salesGrowth: 13.1, repeatRate: 59, footTrafficGrowth: 5.5, competition: '보통', closingRate: 9.8,
    rating: 4.9, reviewCount: 823, supporters: 308, communityScore: 90, stabilityScore: 85, story: '지역 양조장 18곳과 함께합니다. 작은 냉장 창고를 만들어 더 다양한 술을 안정적으로 소개하려 합니다.', color: '#a65f83', tags: ['전통주', '지역 상생', '고평점']
  },
  {
    id: 'r-mealmill', name: '밀밀키친', emoji: '🌮', category: '세계음식', region: '서울', neighborhood: '이태원동',
    tagline: '서울 골목에서 만나는 멕시코 집밥', description: '직접 구운 또르띠야와 천천히 익힌 고기로 만드는 멕시코 가정식입니다.', signature: '비리아 타코 플레이트', avgPrice: 18000, maxMenuPrice: 32000,
    openedYears: 2, monthlySales: 46900000, salesGrowth: 29.3, repeatRate: 46, footTrafficGrowth: 14.2, competition: '높음', closingRate: 12.7,
    rating: 4.6, reviewCount: 998, supporters: 401, communityScore: 82, stabilityScore: 70, story: '푸드트럭에서 시작해 첫 매장을 열었습니다. 또르띠야 생산 장비로 품질과 원가를 함께 잡으려 합니다.', color: '#e47e44', tags: ['성장률 29.3%', '푸드트럭 출신', '직접 생산']
  },
  {
    id: 'r-sunmandu', name: '선만두', emoji: '🥟', category: '한식', region: '수원', neighborhood: '행궁동',
    tagline: '매일 아침 빚는 얇은 피 왕만두', description: '3대째 이어온 레시피로 당일 빚고 당일 판매합니다.', signature: '김치 왕만두전골', avgPrice: 11000, maxMenuPrice: 27000,
    openedYears: 11, monthlySales: 62100000, salesGrowth: 7.4, repeatRate: 69, footTrafficGrowth: 4.1, competition: '낮음', closingRate: 5.4,
    rating: 4.8, reviewCount: 2304, supporters: 711, communityScore: 96, stabilityScore: 96, story: '행궁동을 지켜온 만두집입니다. 냉동 유통이 아닌 가까운 지역 당일 배송을 위한 냉장차를 마련합니다.', color: '#d78a63', tags: ['11년 운영', '단골 69%', '3대 레시피']
  },
  {
    id: 'r-jejudam', name: '제주담 국수', emoji: '🍲', category: '한식', region: '제주', neighborhood: '노형동',
    tagline: '제주의 계절을 한 그릇에', description: '제주 돼지와 톳, 모자반으로 맑고 깊은 국수를 만듭니다.', signature: '모자반 고기국수', avgPrice: 12000, maxMenuPrice: 24000,
    openedYears: 6, monthlySales: 68400000, salesGrowth: 12.2, repeatRate: 52, footTrafficGrowth: 8.8, competition: '보통', closingRate: 7.1,
    rating: 4.7, reviewCount: 1845, supporters: 523, communityScore: 88, stabilityScore: 90, story: '관광객과 주민이 함께 찾는 국수집입니다. 비수기에도 고용을 지키기 위한 온라인 육수 판매를 준비합니다.', color: '#58a5a5', tags: ['6년 운영', '제주 식재료', '온라인 확장']
  }
]

const profileData: Record<string, { foodDescription: string; strengths: string[]; menus: Array<[string, number, string]>; diningNotes: string }> = {
  'r-sobok': { foodDescription: '제철 생선과 나물, 직접 담근 장을 중심으로 매일 구성이 조금씩 달라지는 가정식 한상을 냅니다. 자극적인 양념보다 재료의 온도와 식감을 살리는 집밥이 중심입니다.', strengths: ['망원시장 당일 식재료 조달', '반찬 구성의 계절성', '점심 단골 비중이 높은 안정적 수요'], menus: [['들기름 고등어 한상',13000,'들기름에 구운 고등어와 제철 반찬 5종'],['제철 채소 비빔밥',11000,'직접 만든 장과 나물로 비비는 한 그릇'],['두부 들깨탕',12000,'고소한 들깨 육수의 따뜻한 탕']], diningNotes: '혼밥과 2인 방문이 모두 편하고 평일 11시 40분 이전이 비교적 여유로워요.' },
  'r-huaxiang': { foodDescription: '주문 즉시 칼로 깎는 도삭면과 매장에서 직접 끓이는 우육 육수가 핵심인 면 전문점입니다. 향신료 강도를 조절할 수 있어 입문자와 마니아 모두 찾습니다.', strengths: ['주문 즉시 제면', '호텔 중식 경력 셰프', '면·육수 자체 생산으로 품질 통제'], menus: [['우육 도삭면',12000,'팔각 향이 은은한 우육 육수와 넓은 면'],['마라 비빔면',11000,'산초 향과 고추기름이 선명한 비빔 도삭면'],['홍소 가지',15000,'겉은 바삭하고 속은 촉촉한 가지 요리']], diningNotes: '면은 순한맛부터 얼얼한맛까지 조절 가능하며 점심에는 대기가 생길 수 있어요.' },
  'r-mokhwa': { foodDescription: '직접 로스팅한 싱글오리진 커피와 제철 과일 구움과자를 작은 배치로 선보이는 로스터리입니다. 단맛을 과하게 올리지 않은 디저트가 커피와 잘 맞습니다.', strengths: ['소량 당일 로스팅', '국산 제철 과일 디저트', '높은 재방문과 원두 정기구독'], menus: [['참외 크림 라떼',7000,'참외 콩포트와 담백한 우유 크림'],['오늘의 필터커피',6500,'원두 특성에 맞춘 핸드드립'],['제철 과일 휘낭시에',3800,'국산 과일을 넣은 촉촉한 구움과자']], diningNotes: '좌석이 12석이라 긴 작업보다는 조용한 커피 한 잔에 어울려요.' },
  'r-bada': { foodDescription: '부산 공동어시장에서 고른 생선을 숙성도에 맞춰 내는 이자카야입니다. 제철 회와 구이, 지역 양조장 사케 페어링이 중심입니다.', strengths: ['당일 수산물 선별', '생선별 숙성 관리', '제철 메뉴 회전이 빠른 구성'], menus: [['오늘의 모둠 사시미',29000,'그날 좋은 생선 5종의 소량 모둠'],['제철 생선 숯불구이',24000,'껍질은 바삭하고 속은 촉촉한 숯불구이'],['부산 어묵 나베',18000,'직접 우린 다시와 지역 어묵']], diningNotes: '어종은 매일 달라지며 예약 시 알레르기와 선호 어종을 알려주세요.' },
  'r-oven': { foodDescription: '우리 밀과 천연 발효종을 사용해 크루아상과 식사빵을 매일 소량 굽습니다. 버터 향은 풍부하지만 결은 가볍게 만드는 것이 특징입니다.', strengths: ['우리 밀 사용', '장시간 저온 발효', '오전 생산·당일 판매 원칙'], menus: [['소금버터 크루아상',4800,'겹은 바삭하고 속은 촉촉한 대표 제품'],['발효종 시골빵',7500,'산미가 은은한 데일리 식사빵'],['제철 과일 데니시',6500,'계절 과일과 커스터드의 조합']], diningNotes: '인기 제품은 정오 전에 품절될 수 있고 예약 픽업이 가능해요.' },
  'r-nokturn': { foodDescription: '매일 반죽하는 생면과 대구·경북 농가 식재료를 결합한 계절 파스타를 냅니다. 소스보다 면의 탄력과 채소 향이 먼저 느껴지는 구성입니다.', strengths: ['매일 만드는 생면', '지역 농가 직거래', '계절마다 바뀌는 짧은 메뉴'], menus: [['청도 미나리 라구',21000,'미나리 향을 살린 소고기 라구 생면'],['의성 마늘 봉골레',19000,'구운 마늘과 조개의 깔끔한 오일 파스타'],['계절 채소 라자냐',23000,'지역 채소를 층층이 구운 라자냐']], diningNotes: '저녁 중심 운영이며 생면 소진 시 조기 마감할 수 있어요.' },
  'r-dotori': { foodDescription: '직접 뽑은 쌀떡과 채소 육수를 바탕으로 익숙한 분식에 고소한 재료를 더합니다. 학생부터 가족까지 부담 없이 먹을 수 있는 양과 가격을 지킵니다.', strengths: ['7년간 유지된 동네 단골', '쌀떡 자체 생산', '학교·주거 수요가 섞인 안정적 상권'], menus: [['들깨 크림 떡볶이',8500,'들깨의 고소함과 매콤함이 조화로운 떡볶이'],['채소 육수 라볶이',7500,'깔끔한 채소 육수의 추억의 맛'],['수제 김말이',4500,'당면과 채소를 직접 말아 튀긴 사이드']], diningNotes: '맵기 조절이 가능하고 2~3인 세트 구성이 알차요.' },
  'r-greenbowl': { foodDescription: '지역 농가 채소, 잡곡, 매장 조리 단백질을 한 그릇에 균형 있게 담습니다. 샐러드지만 따뜻한 곡물과 든든한 양으로 점심 식사 수요가 높습니다.', strengths: ['점심 정기구독 성장', '매장 조리 고단백 토핑', '다회용기 회수 시스템'], menus: [['수비드 닭다리 그레인볼',14500,'잡곡과 촉촉한 닭다리살의 든든한 한 끼'],['두부 스테이크 볼',13000,'구운 두부와 참깨 소스의 식물성 메뉴'],['계절 채소 수프',6500,'지역 농가 채소를 갈아 끓인 수프']], diningNotes: '드레싱과 곡물 양을 선택할 수 있고 정기구독 픽업대가 따로 있어요.' },
  'r-podo': { foodDescription: '남도 식재료로 만든 제철 안주와 소규모 양조장의 우리 술을 잔 단위로 소개합니다. 설명은 친절하지만 분위기는 편안한 동네 술집입니다.', strengths: ['지역 양조장 18곳 협업', '잔술 중심의 낮은 진입장벽', '계절 식재료 안주'], menus: [['제철 한상과 전통주 3잔',26000,'세 가지 작은 안주와 술 페어링'],['남도 제철전',16000,'계절 채소와 해산물을 얇게 부친 전'],['오늘의 약주',7000,'양조장 이야기를 곁들인 잔술']], diningNotes: '술을 잘 모르는 손님에게도 취향을 물어 세 잔 구성을 추천해줘요.' },
  'r-mealmill': { foodDescription: '매일 굽는 옥수수 또르띠야와 장시간 익힌 고기로 멕시코 가정식을 냅니다. 향신료는 선명하지만 한국 제철 채소를 곁들여 균형을 잡습니다.', strengths: ['또르띠야 매장 생산', '푸드트럭에서 검증한 메뉴', '점심·야간 수요가 모두 존재'], menus: [['비리아 타코 플레이트',18000,'진한 고기 스튜에 찍어 먹는 타코 3개'],['구운 버섯 타코',15000,'제철 버섯과 살사의 채식 타코'],['엘로테',7000,'치즈와 라임을 곁들인 구운 옥수수']], diningNotes: '고수 제외와 맵기 조절이 가능하고 타코는 주문 즉시 조립해요.' },
  'r-sunmandu': { foodDescription: '3대째 이어온 반죽과 속 배합으로 매일 아침 만두를 빚습니다. 얇은 피와 꽉 찬 속, 담백한 사골·채소 육수가 특징입니다.', strengths: ['11년 운영과 높은 재방문', '당일 생산·당일 판매', '가족 단위 수요가 꾸준한 메뉴'], menus: [['김치 왕만두전골',11000,'직접 빚은 김치만두와 채소가 넉넉한 전골'],['고기 왕만두',7000,'육즙과 부추 향이 살아 있는 찐만두'],['만두국',10000,'맑고 담백한 육수의 한 끼']], diningNotes: '주말에는 포장 대기가 있을 수 있고 전골은 2인부터 주문 가능해요.' },
  'r-jejudam': { foodDescription: '제주 돼지와 모자반·톳 등 해조류로 맑고 깊은 국수를 냅니다. 관광객용 과한 간보다 주민이 자주 먹을 수 있는 담백함을 지향합니다.', strengths: ['제주 식재료 공급망', '관광객·주민 수요의 균형', '육수 HMR로 확장 가능한 레시피'], menus: [['모자반 고기국수',12000,'모자반 향과 제주 돼지 육수의 대표 국수'],['톳 비빔국수',11000,'새콤한 양념과 톳의 식감'],['돔베고기 소',18000,'국수와 곁들이기 좋은 삶은 제주 돼지']], diningNotes: '해조류 향이 낯설다면 기본 고기국수로 시작하기 좋아요.' }
}

const salesMonths = ['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']
const privateSalesRestaurants = new Set(['r-bada','r-nokturn','r-podo','r-sunmandu'])
restaurants.forEach((restaurant, index) => {
  const profile = profileData[restaurant.id]
  const start = restaurant.monthlySales / (1 + restaurant.salesGrowth / 100)
  const curve = [0,.08,.14,.19,.27,.34,.46,.55,.64,.76,.88,1]
  const salesHistory = salesMonths.map((month, pointIndex) => {
    const seasonal = 1 + Math.sin((pointIndex + index) * 1.31) * .022
    const sales = Math.round((start + (restaurant.monthlySales - start) * curve[pointIndex]) * seasonal / 10000) * 10000
    const previous = pointIndex === 0 ? start : Math.round((start + (restaurant.monthlySales - start) * curve[pointIndex - 1]) * (1 + Math.sin((pointIndex - 1 + index) * 1.31) * .022) / 10000) * 10000
    const growthRate = Number(((sales - previous) / Math.max(1, previous) * 100).toFixed(1))
    return { month, sales, growthRate, bonusRate: Number(Math.max(0, Math.min(18, growthRate * .9)).toFixed(1)) }
  })
  Object.assign(restaurant, {
    foodDescription: profile.foodDescription,
    strengths: profile.strengths,
    menuHighlights: profile.menus.map(([name, price, description]) => ({ name, price, description })),
    diningNotes: profile.diningNotes,
    salesDisclosure: !privateSalesRestaurants.has(restaurant.id),
    salesHistory,
  })
})

export const reviews: Review[] = restaurants.flatMap((restaurant, index) => [
  { id: `rv-${index}-1`, restaurantId: restaurant.id, userId: `seed-reviewer-${index}-1`, userName: ['김한끼','이단골','최냠냠','오미식'][index % 4], rating: 5, content: `${restaurant.signature}이 대표 메뉴인 이유를 알겠어요. 재료가 신선하고 설명도 친절했습니다.`, visitVerified: true, createdAt: day(-3 - index) },
  { id: `rv-${index}-2`, restaurantId: restaurant.id, userId: `seed-reviewer-${index}-2`, userName: ['박소담','윤접시','한입만','정맛객'][index % 4], rating: index % 3 === 0 ? 4 : 5, content: `${restaurant.neighborhood}에서 다시 방문하고 싶은 곳이에요. 가격대와 양의 균형이 좋았습니다.`, visitVerified: true, createdAt: day(-12 - index) },
  { id: `rv-${index}-3`, restaurantId: restaurant.id, userId: `seed-reviewer-${index}-3`, userName: ['강포크','임수저','조단골','문먹방'][index % 4], rating: 4, content: `피크 시간에는 조금 기다렸지만 음식의 개성이 분명했고 다음에는 다른 메뉴도 먹어보고 싶어요.`, visitVerified: true, createdAt: day(-25 - index) },
])
const fundData: Array<Partial<Fund> & Pick<Fund, 'restaurantId' | 'status' | 'goal' | 'raised' | 'maxDiscount' | 'purpose'>> = [
  { restaurantId: 'r-sobok', status: 'funding', goal: 30000000, raised: 23760000, maxDiscount: 40, purpose: '저온 저장고와 주방 동선 개선' },
  { restaurantId: 'r-huaxiang', status: 'funding', goal: 45000000, raised: 28890000, maxDiscount: 50, purpose: '도삭면 제면실 확장' },
  { restaurantId: 'r-mokhwa', status: 'trading', goal: 20000000, raised: 20000000, maxDiscount: 35, purpose: '소형 로스터와 환기 설비 도입' },
  { restaurantId: 'r-bada', status: 'trading', goal: 50000000, raised: 50000000, maxDiscount: 30, purpose: '생선 숙성고 및 냉장 설비' },
  { restaurantId: 'r-oven', status: 'funding', goal: 18000000, raised: 14580000, maxDiscount: 45, purpose: '중고 데크오븐 추가 도입' },
  { restaurantId: 'r-nokturn', status: 'funding', goal: 25000000, raised: 10400000, maxDiscount: 40, purpose: '제면기와 런치 운영 준비' },
  { restaurantId: 'r-dotori', status: 'trading', goal: 28000000, raised: 28000000, maxDiscount: 35, purpose: '홀 리뉴얼 및 배달 의존도 개선' },
  { restaurantId: 'r-greenbowl', status: 'funding', goal: 22000000, raised: 17380000, maxDiscount: 45, purpose: '다회용기 세척 설비' },
  { restaurantId: 'r-podo', status: 'trading', goal: 32000000, raised: 32000000, maxDiscount: 40, purpose: '전통주 저온 저장고' },
  { restaurantId: 'r-mealmill', status: 'funding', goal: 36000000, raised: 19800000, maxDiscount: 55, purpose: '또르띠야 생산 장비' },
  { restaurantId: 'r-sunmandu', status: 'trading', goal: 40000000, raised: 40000000, maxDiscount: 30, purpose: '수도권 당일 배송 냉장차' },
  { restaurantId: 'r-jejudam', status: 'funding', goal: 42000000, raised: 31500000, maxDiscount: 45, purpose: '육수 HMR 생산 설비' },
]

export const funds: Fund[] = fundData.map((f, index) => {
  const restaurant = restaurants.find((r) => r.id === f.restaurantId)!
  const status = f.status
  return {
    id: `f-${restaurant.id.slice(2)}`, restaurantId: f.restaurantId, round: index % 4 === 0 ? 2 : 1, status,
    goal: f.goal, raised: f.raised, maxDiscount: f.maxDiscount, minIssueDiscount: 10, dailyRatePer100k: 0.5,
    salesBonus: Math.min(35, Math.round(restaurant.salesGrowth * 0.8)), earlyBonus: 50, startedAt: day(status === 'funding' ? -13 - index : -90 - index),
    endsAt: day(status === 'funding' ? 18 - index : -45), purpose: f.purpose, investorCount: Math.round(f.raised / 82000),
    totalCouponIssued: status === 'trading' ? Math.round(f.raised * 0.078) : Math.round(f.raised * 0.016),
    totalCouponUsed: status === 'trading' ? Math.round(f.raised * 0.046) : Math.round(f.raised * 0.006),
    openBuyAmount: 0, openSellAmount: 0,
    riskLevel: restaurant.stabilityScore >= 88 ? '낮음' : restaurant.stabilityScore >= 73 ? '보통' : '주의'
  }
})

export const articles: Article[] = [
  {
    id: 'a-1', eyebrow: '공공데이터 상권 브리핑', title: '망원역·연남동 상권을 같은 숫자로 보면 안 되는 이유',
    summary: '서울시 상권영역과 분기별 추정매출 자료를 기준으로 두 생활권의 크기와 업종 구성을 읽는 방법을 정리했습니다.',
    content: '서울시 상권영역 자료에서 망원역은 발달상권, 연남동에는 동교로25길·27길·38길과 성미산로32길 등 여러 골목상권이 별도로 잡힙니다. 따라서 “연남동 전체”와 “망원역 한 상권”의 매출 합계를 그대로 비교하면 면적과 점포 수 차이가 섞일 수 있습니다.\n\n서울시 추정매출 자료는 상권 내 점포의 카드 기반 추정매출을 분기별로 제공하며, 2024년부터 공간 단위가 표준단위구역으로 바뀌었습니다. 먹투는 상권 총매출 자체보다 동일 업종의 전년 동기 변화, 점포당 매출, 생활·직장인구의 시간대 구성을 함께 보는 방식으로 브리핑합니다.\n\n가상 식당 소복소복은 망원동 생활수요와 점심 재방문이 강점이고, 화향면관은 연남동 방문수요 속에서 높은 성장률을 보이는 설정입니다. 두 식당 수치는 시연용 가상 데이터이며, 상권 원자료와 식당 자체 데이터를 분리해 해석해야 합니다.',
    tags: ['망원역', '연남동', '서울시 공공데이터'], icon: '📈', publishedAt: day(-1),
    sourceName: '서울 열린데이터광장 · 서울시 상권분석서비스(추정매출-상권)', sourceUrl: 'https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do',
    dataNote: '상권 자료는 서울시·서울신용보증재단 공개 데이터의 구조와 상권 구분을 사용했습니다. 개별 식당과 식당 매출은 가상입니다.'
  },
  {
    id: 'a-2', eyebrow: 'SCB 해설', title: '매출 규모보다 “상권보다 더 빨리 크는가”를 보는 이유',
    summary: '금융위가 공개한 SCB 평가요소와 먹투의 성장성 심사를 연결해 설명합니다.',
    content: '금융위원회가 공개한 소상공인 특화 신용평가체계(SCB)는 매출·업종·상권 같은 비금융정보로 미래 성장성을 평가합니다. 매출 상세분석, 상권 상세분석, 업력, 근로자 수, 고객 수요, 방문·재방문과 같은 유통플랫폼 지표가 예시로 제시됐습니다.\n\n먹투도 같은 방향으로 POS·카드·계좌·배달·세무 자료를 교차검증합니다. 예를 들어 상권 음식업 매출이 4% 늘 때 한 식당의 검증된 매출이 14% 늘었다면, 단순한 시장 상승보다 식당 고유의 경쟁력이 더 크게 작용했을 가능성을 살펴볼 수 있습니다.\n\n다만 먹투의 점수는 금융기관의 공식 SCB 등급이 아닙니다. MVP에서는 원천데이터 연결 흐름과 설명 가능한 자동지표를 시연하고, 실제 서비스에서는 적격 데이터 사업자·금융기관과의 제휴 및 수동 심사가 필요합니다.',
    tags: ['SCB', '성장성', '교차검증'], icon: '🧭', publishedAt: day(-3),
    sourceName: '금융위원회 · 소상공인 특화 신용평가체계 도입방안', sourceUrl: 'https://www.fsc.go.kr/no010101/86674',
    dataNote: '정책 설명은 금융위원회 공개자료를 요약했습니다. 먹투 점수와 사례 식당은 서비스 시연용입니다.'
  },
  {
    id: 'a-3', eyebrow: '쿠폰 리포트', title: '최대 할인율이 높다고 항상 좋은 건 아니에요',
    summary: '쿠폰 소진 속도와 식당의 원가율을 함께 보는 법을 알려드려요.',
    content: '최대 할인율은 혜택의 상한이지 확정 수익률이 아닙니다. 투자 기간과 매월 발생한 매출 보너스, 쿠폰을 실제로 사용할 수 있는 거리, 식당의 원가 구조를 함께 봐야 합니다.\n\n최초 투자자는 일회성 20% 점프 대신, 보유 기간 내내 매출 보너스를 50% 더 받습니다. 예를 들어 일반 투자자의 해당 월 매출 보너스가 10%라면 최초 투자자는 15%를 적용받습니다.\n\n식당 상세의 월매출 그래프에서 각 달에 적용된 보너스를 확인할 수 있습니다. 매출 비공개 식당은 보너스 산정 결과만 공개하고 실제 매출액은 숨깁니다.',
    tags: ['쿠폰', '최초 투자자', '가이드'], icon: '🎟️', publishedAt: day(-5),
    dataNote: '쿠폰 계산 규칙과 예시는 먹투 MVP의 가상 시뮬레이션입니다.'
  }
]
export const etfs: EtfFund[] = [
  { id: 'e-mapochina', name: '마포 중식 한바퀴', emoji: '🥢', region: '마포구', category: '중식', restaurantIds: ['r-huaxiang', 'r-mealmill'], minimum: 10000, maxDiscount: 35, growth: 18.6, members: 841, description: '마포 생활권의 면·중화요리 제휴점에서 쓰는 분산 쿠폰' },
  { id: 'e-localbakery', name: '동네빵 행복지수', emoji: '🥖', region: '전국', category: '베이커리', restaurantIds: ['r-oven', 'r-mokhwa'], minimum: 10000, maxDiscount: 30, growth: 21.2, members: 1260, description: '우리 밀과 지역 로스터리를 함께 응원하는 펀드' },
  { id: 'e-nighttable', name: '밤의 식탁', emoji: '🌙', region: '전국', category: '저녁', restaurantIds: ['r-bada', 'r-nokturn', 'r-podo'], minimum: 10000, maxDiscount: 32, growth: 12.4, members: 617, description: '저녁 시간을 빛내는 로컬 다이닝 3곳에 나눠 응원해요' }
]

export function createSeed(ownerHash: string, investorHash: string): Database {
  return {
    schemaVersion: 4,
    users: [
      { id: 'u-admin', email: 'admin@meoktu.demo', name: '먹투 운영팀', role: 'admin', passwordHash: ownerHash, cash: 0, accountStatus: 'active', createdAt: day(-500) },
      { id: 'u-owner', email: 'owner@meoktu.demo', name: '김소담', role: 'owner', passwordHash: ownerHash, cash: 0, createdAt: day(-400) },
      { id: 'u-investor', email: 'investor@meoktu.demo', name: '박한입', role: 'investor', passwordHash: investorHash, cash: 1640000, createdAt: day(-160) },
      { id: 'u-market-a', email: 'market-a@meoktu.demo', name: '동네단골A', role: 'investor', passwordHash: investorHash, cash: 920000, createdAt: day(-210) },
      { id: 'u-market-b', email: 'market-b@meoktu.demo', name: '동네단골B', role: 'investor', passwordHash: investorHash, cash: 880000, createdAt: day(-190) },
    ],
    restaurants,
    funds,
    positions: [
      { id: 'p-1', userId: 'u-investor', fundId: 'f-mokhwa', amount: 120000, early: true, couponProgress: 24.5, updatedAt: day(-2) },
      { id: 'p-2', userId: 'u-investor', fundId: 'f-dotori', amount: 80000, early: false, couponProgress: 13.2, updatedAt: day(-1) },
      { id: 'p-3', userId: 'u-investor', fundId: 'f-sobok', amount: 60000, early: true, couponProgress: 8.6, updatedAt: day(-1) },
      { id: 'p-market-mokhwa', userId: 'u-market-a', fundId: 'f-mokhwa', amount: 210000, early: true, couponProgress: 17.1, updatedAt: day(-3) },
      { id: 'p-market-bada', userId: 'u-market-b', fundId: 'f-bada', amount: 170000, early: false, couponProgress: 11.2, updatedAt: day(-4) },
      { id: 'p-market-dotori', userId: 'u-market-a', fundId: 'f-dotori', amount: 230000, early: true, couponProgress: 28.3, updatedAt: day(-2) },
      { id: 'p-market-podo', userId: 'u-market-b', fundId: 'f-podo', amount: 160000, early: false, couponProgress: 19.4, updatedAt: day(-5) },
      { id: 'p-market-sunmandu', userId: 'u-market-a', fundId: 'f-sunmandu', amount: 260000, early: true, couponProgress: 21.8, updatedAt: day(-6) },
    ],
    orders: [
      { id: 'o-seed-mokhwa-sell', userId: 'u-market-a', fundId: 'f-mokhwa', type: 'sell', originalAmount: 80000, remaining: 80000, status: 'open', createdAt: day(-2) },
      { id: 'o-seed-bada-buy', userId: 'u-market-a', fundId: 'f-bada', type: 'buy', originalAmount: 120000, remaining: 120000, status: 'open', createdAt: day(-2.2) },
      { id: 'o-seed-dotori-sell', userId: 'u-market-a', fundId: 'f-dotori', type: 'sell', originalAmount: 90000, remaining: 90000, status: 'open', createdAt: day(-1.8) },
      { id: 'o-seed-podo-buy', userId: 'u-market-a', fundId: 'f-podo', type: 'buy', originalAmount: 70000, remaining: 70000, status: 'open', createdAt: day(-1.5) },
      { id: 'o-seed-sunmandu-sell', userId: 'u-market-a', fundId: 'f-sunmandu', type: 'sell', originalAmount: 110000, remaining: 110000, status: 'open', createdAt: day(-1.2) },
    ],
    coupons: [
      { id: 'c-1', userId: 'u-investor', restaurantId: 'r-podo', fundId: 'f-podo', title: '포도상점 응원 쿠폰', discount: 25, maxDiscountWon: 12250, type: 'fund', status: 'available', expiresAt: day(90), createdAt: day(-10) },
      { id: 'c-2', userId: 'u-investor', restaurantId: 'r-huaxiang', fundId: 'f-huaxiang', title: '화향면관 첫 투자자 쿠폰', discount: 30, maxDiscountWon: 8400, type: 'fund', status: 'available', expiresAt: day(75), createdAt: day(-7) },
      { id: 'c-market-1', userId: 'u-owner', restaurantId: 'r-bada', fundId: 'f-bada', title: '바다의 식탁 20% 쿠폰', discount: 20, maxDiscountWon: 11600, type: 'dividend', status: 'listed', expiresAt: day(60), createdAt: day(-4) },
      { id: 'c-market-2', userId: 'u-owner', restaurantId: 'r-mokhwa', fundId: 'f-mokhwa', title: '목화다방 24% 쿠폰', discount: 24, maxDiscountWon: 2880, type: 'fund', status: 'listed', expiresAt: day(55), createdAt: day(-6) },
      { id: 'c-market-3', userId: 'u-market-a', restaurantId: 'r-dotori', fundId: 'f-dotori', title: '도토리분식 28% 쿠폰', discount: 28, maxDiscountWon: 4480, type: 'fund', status: 'listed', expiresAt: day(48), createdAt: day(-8) },
      { id: 'c-market-4', userId: 'u-market-a', restaurantId: 'r-oven', fundId: 'f-oven', title: '오후의 오븐 32% 쿠폰', discount: 32, maxDiscountWon: 11520, type: 'dividend', status: 'listed', expiresAt: day(67), createdAt: day(-3) },
      { id: 'c-market-5', userId: 'u-market-b', restaurantId: 'r-greenbowl', fundId: 'f-greenbowl', title: '그린볼 클럽 22% 쿠폰', discount: 22, maxDiscountWon: 4180, type: 'fund', status: 'listed', expiresAt: day(72), createdAt: day(-9) },
      { id: 'c-market-6', userId: 'u-market-b', restaurantId: 'r-sunmandu', fundId: 'f-sunmandu', title: '선만두 30% 쿠폰', discount: 30, maxDiscountWon: 8100, type: 'dividend', status: 'listed', expiresAt: day(81), createdAt: day(-5) },
      { id: 'c-market-7', userId: 'u-market-a', restaurantId: 'r-huaxiang', fundId: 'f-huaxiang', title: '화향면관 26% 쿠폰', discount: 26, maxDiscountWon: 7280, type: 'fund', status: 'available', expiresAt: day(70), createdAt: day(-6) },
      { id: 'c-market-8', userId: 'u-market-b', restaurantId: 'r-sobok', fundId: 'f-sobok', title: '소복소복 21% 쿠폰', discount: 21, maxDiscountWon: 4830, type: 'fund', status: 'available', expiresAt: day(64), createdAt: day(-11) },
    ],
    couponListings: [
      { id: 'cl-1', userId: 'u-owner', couponId: 'c-market-1', wantedCategories: ['한식', '분식'], wantedRegions: ['서울'], minDiscount: 0, autoAccept: true, note: '망원동 근처면 더 좋아요!', status: 'open', createdAt: day(-2), expiresAt: day(28) },
      { id: 'cl-2', userId: 'u-owner', couponId: 'c-market-2', wantedCategories: ['베이커리', '카페'], wantedRegions: [], minDiscount: 20, autoAccept: false, note: '디저트 쿠폰으로 바꾸고 싶어요.', status: 'open', createdAt: day(-3), expiresAt: day(27) },
      { id: 'cl-3', userId: 'u-market-a', couponId: 'c-market-3', wantedCategories: ['카페'], wantedRegions: ['서울'], minDiscount: 0, autoAccept: false, note: '', status: 'open', createdAt: day(-4), expiresAt: day(26) },
      { id: 'cl-4', userId: 'u-market-a', couponId: 'c-market-4', wantedCategories: [], wantedRegions: ['수원', '서울'], minDiscount: 25, autoAccept: false, note: '액면가 비슷한 쿠폰이면 뭐든 좋아요.', status: 'open', createdAt: day(-1), expiresAt: day(29) },
      { id: 'cl-5', userId: 'u-market-b', couponId: 'c-market-5', wantedCategories: ['세계음식', '중식'], wantedRegions: [], minDiscount: 0, autoAccept: true, note: '', status: 'open', createdAt: day(-5), expiresAt: day(25) },
      { id: 'cl-6', userId: 'u-market-b', couponId: 'c-market-6', wantedCategories: [], wantedRegions: [], minDiscount: 0, autoAccept: true, note: '아무 쿠폰이나 환영합니다.', status: 'open', createdAt: day(-2.5), expiresAt: day(27.5) },
    ],
    couponOffers: [],
    couponTrades: [],
    notifications: [],
    applications: [],
    reviews,
    visitVerifications: [],
    walletTransactions: [],
    favorites: [],
    auditEvents: [],
    ocrAnalyses: [],
    supportRequests: [],
    dataConnections: [],
    articles,
    etfs,
  }
}
