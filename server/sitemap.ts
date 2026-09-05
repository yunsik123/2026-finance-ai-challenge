/**
 * 먹투 웹사이트 UI 내비게이션 지식.
 *
 * 심사 절차 그래프(trust.ts의 GuideStep)는 "무엇을 검증하는가"를 설명하지만
 * "화면 어디를 눌러야 하는가"는 담고 있지 않다. 그래서 AI 상담원이
 * "펀드 등록하려면 어디로 가야 하나요?" 같은 질문에 절차 단계 이름을
 * 그대로 읽어주는 문제가 있었다. 이 파일이 그 빈틈을 메운다.
 *
 * 여기의 메뉴명·버튼명은 실제 화면(App.tsx / MarketPage.tsx / OwnerCenter.tsx /
 * SupportPage.tsx / CreditGradePanel.tsx / MyPage 등)과 1:1로 맞춰야 한다.
 * 화면 문구를 바꾸면 이 파일도 반드시 함께 고칠 것.
 * 안 고치면 AI 상담원이 존재하지 않는 버튼을 안내하게 된다.
 */

export type SitePage = {
  id: string
  name: string
  route: string
  /** 사용자가 실제로 눌러서 도달하는 경로. */
  menuPath: string
  audience: 'all' | 'investor' | 'owner' | 'admin'
  login: 'none' | 'any' | 'owner' | 'admin'
  purpose: string
  actions: string[]
}

export type UiTask = {
  id: string
  /** "무엇을 하려는가"의 대표 이름. */
  intent: string
  /** 질문 매칭용 키워드. 공백 없이 비교한다. */
  keywords: string[]
  pageId: string
  /** 사용자가 순서대로 눌러야 하는 화면 동작. */
  steps: string[]
  note?: string
}

export const sitePages: SitePage[] = [
  {
    id: 'page:home', name: '홈', route: '/', menuPath: '왼쪽 위 먹투 로고',
    audience: 'all', login: 'none',
    purpose: '먹투 서비스 소개와 공개지표 상위 식당을 한눈에 보는 첫 화면',
    actions: ['서비스 작동 방식 확인', '공개 기회점수 상위 식당 보기', '사장님 안내 배너로 이동'],
  },
  {
    id: 'page:discover', name: '식당 발견', route: '/discover', menuPath: '상단 메뉴 > 식당 발견',
    audience: 'investor', login: 'none',
    purpose: '투자할 식당을 검색·필터로 찾고 상세 정보를 여는 화면',
    actions: ['식당·동네·음식 검색', '업종 칩과 기본순·성장률순·마감임박순 정렬', '식당 카드 클릭으로 상세창 열기', '하트 아이콘으로 찜하기'],
  },
  {
    id: 'page:market', name: '거래장', route: '/market', menuPath: '상단 메뉴 > 거래장',
    audience: 'investor', login: 'none',
    purpose: '쿠폰을 서로 맞바꾸는 “쿠폰 교환장”과, 모금이 끝난 펀드 자리를 넘겨받는 “펀드 예약 거래”가 위쪽 탭으로 나뉜 화면',
    actions: ['위쪽 “쿠폰 교환장” 탭에서 매물 검색·필터', '주황색 “내 쿠폰 등록” 버튼으로 보유 쿠폰 즉시 등록', '교환 제안하기 버튼으로 내 쿠폰 제안', '내 교환 탭에서 받은 제안 수락·거절', '위쪽 “펀드 예약 거래” 탭에서 투자 대기·회수 대기 줄 확인', '내 예약 주문 취소'],
  },
  {
    id: 'page:insight', name: 'AI 인사이트', route: '/insight', menuPath: '상단 메뉴 > AI 인사이트',
    audience: 'all', login: 'none',
    purpose: 'AI가 공개정보를 요약·비교하고 상권 읽을거리를 보여주는 화면',
    actions: ['식당을 최대 3곳 선택해 공개 성장률·재방문율·기회점수 비교', '선택한 가게들의 AI 공개정보 해석 읽기', '예시 질문 칩 클릭', '공개정보 한눈에 보기에서 식당 상세 열기', '상권 아티클 자세히 읽기'],
  },
  {
    id: 'page:owner', name: '사장님 센터', route: '/owner', menuPath: '상단 메뉴 > 사장님 센터',
    audience: 'owner', login: 'none',
    purpose: '소상공인이 펀딩(펀드)을 등록·신청하고 자료를 제출하며 운영 현황을 보는 화면',
    actions: ['AI 점주 경영 리포트 확인', '추가 펀딩 준비와 순서별 신청서 작성', '샘플 자료 다운로드와 한 번에 업로드', '제휴기관 데이터 연결', 'AI 문서 자동 확인', '35개 지표 먹투 성장성 예비평가 확인', '펀딩 대시보드와 쿠폰 부담 확인', '매장 쿠폰 확인', '투자자 매출 공개 설정'],
  },
  {
    id: 'page:owner-my', name: '사장님 마이페이지', route: '/owner/my', menuPath: '상단 메뉴 > 마이페이지(또는 오른쪽 위 프로필 동그라미)',
    audience: 'owner', login: 'owner',
    purpose: '내 펀딩 신청의 AI 검증 통과 여부, 보완 항목, 제안 한도와 투자자 공개 상태를 확인하는 화면',
    actions: ['최신 AI 검증 결과 확인', '사업자·재무 검증 결과 확인', '투자자 식당 목록 공개 여부 확인', '과거 심사 신청 내역 비교', '신청 당시 약관 동의 기록 확인'],
  },
  {
    id: 'page:my', name: 'MY 먹투', route: '/my', menuPath: '오른쪽 위 프로필 동그라미(또는 모바일 하단 MY)',
    audience: 'investor', login: 'any',
    purpose: '내 투자금, 쿠폰, 지갑, 관심 식당을 모아 보는 개인 화면',
    actions: ['먹투머니 충전', '받은 교환 제안 배너에서 수락·거절 화면으로 이동', '투자한 식당별 쿠폰 성장 확인', '쿠폰 발급과 1만원 회수', '쿠폰 지갑 상태별 필터', '쿠폰 사용 코드 발급', '쿠폰 지갑에서 교환장 등록', '지난 쿠폰 내역 확인', '관심 식당 다시 보기'],
  },
  {
    id: 'page:support', name: '신고·문의', route: '/support', menuPath: '상단 메뉴 > 신고·문의',
    audience: 'all', login: 'none',
    purpose: 'AI가 답하기 어려운 계정·거래·심사 문제를 사람에게 접수하고 답변을 확인하는 화면',
    actions: ['문의 유형 선택(투자·회수 / 쿠폰 / 교환장 / 리뷰 / 사장님 심사 / 계정 / 기타)', '제목과 내용 작성', '관련 식당 선택(선택 사항)', '“문의 보내기” 버튼으로 접수', '오른쪽 “내 문의 내역”에서 답변 확인'],
  },
  {
    id: 'page:admin', name: '운영센터', route: '/admin', menuPath: '관리자 로그인 후 운영센터',
    audience: 'admin', login: 'admin',
    purpose: '회원·식당·펀드·심사·리뷰·문의·쿠폰과 AI 운영 경고를 통합 관리하는 관리자 전용 화면',
    actions: ['회원 이용 정지·복구', '식당 매출 공개 설정', '펀드와 심사 상태 변경', '리뷰 게시·숨김', '고객 문의 답변·종결', '쿠폰 상태 확인', 'AI 운영 점검 확인'],
  },
  {
    id: 'page:ai-widget', name: 'AI 상담 버튼', route: '(모든 화면 공통)', menuPath: '화면 오른쪽 아래 “AI와 상담하기” 버튼',
    audience: 'all', login: 'none',
    purpose: '어느 화면에서든 바로 열 수 있는 떠 있는 AI 상담창',
    actions: ['질문 입력', '역할별 추천 질문 클릭', '직전 대화를 이어 후속 질문하기'],
  },
  {
    id: 'page:auth', name: '로그인·회원가입 창', route: '(팝업)', menuPath: '오른쪽 위 “로그인” 버튼',
    audience: 'all', login: 'none',
    purpose: '로그인, 회원가입, 저장되지 않는 체험 모드 시작',
    actions: ['로그인 탭에서 투자자 또는 사장님 유형을 고른 뒤 이메일·비밀번호 입력', '회원가입 탭에서 투자자 또는 사장님 역할 선택', '투자자·사장님·관리자 데모 버튼으로 즉시 체험 시작'],
  },
]

export const uiTasks: UiTask[] = [
  {
    id: 'task:fund-register', intent: '펀딩(펀드) 등록·신청하기', pageId: 'page:owner',
    keywords: ['펀드등록', '펀딩등록', '펀드신청', '펀딩신청', '펀딩받', '투자유치', '자금모집', '모집등록', '펀드개설', '펀딩시작', '펀딩하려', '등록할수있', '신청하려면'],
    steps: [
      '오른쪽 위 “로그인” 버튼에서 소상공인(사장님) 계정으로 로그인해요. 계정이 없으면 회원가입 탭에서 “소상공인”을 고르면 돼요.',
      '상단 메뉴의 “사장님 센터”를 클릭해요(홈 화면의 “펀딩 시작하기” 버튼도 같은 화면으로 연결돼요).',
      '1단계에서 상호명·대표자명·사업자등록번호·영업신고번호·사업장 주소를 적고 “휴대전화로 대표자 본인인증”을 눌러요.',
      '2단계에서 제휴기관 연결(POS·계좌·카드 등) 또는 직접 업로드로 자료를 올려요. 각 카드의 “샘플 다운로드”로 형식을 먼저 확인할 수 있어요.',
      '3단계에서 각 필수 고지의 “전문 보기”를 눌러 내용을 확인한 뒤 동의하고, 4단계에서 희망 펀딩액·자금 사용계획을 작성해요.',
      '맨 아래 “먹투 자동분석 시작” 버튼을 누르면 예비심사 결과가 바로 나와요.',
      '이후 상단 “마이페이지”에서 검증 통과 여부와 투자자 공개 상태를 계속 확인할 수 있어요.',
    ],
    note: '이미 펀딩을 운영 중인 사장님은 사장님 센터 대시보드의 “추가 펀딩 준비” 버튼으로 새 펀딩을 시작합니다.',
  },
  {
    id: 'task:owner-verification-status', intent: '사장님 심사·공개 상태 확인하기', pageId: 'page:owner-my',
    keywords: ['심사결과', '검증결과', '검증통과', '승인여부', '통과했', '탈락했', '공개상태', '내식당보여', '투자자에게보여'],
    steps: [
      '사장님 계정으로 로그인한 뒤 상단 “마이페이지”를 누르거나 오른쪽 위 프로필 동그라미를 눌러요.',
      '맨 위 최신 AI 검증 결과에서 통과·조건부 승인·추가 검토·보완 상태와 제안 한도를 확인해요.',
      '바로 아래 “투자자 공개 상태”가 “식당 발견 목록에 공개 중”이면 투자자에게 식당과 펀딩이 노출된 상태예요.',
      '검증을 통과하지 못했다면 사업자·재무 검증과 “보완하면 좋은 항목”을 확인한 뒤 사장님 센터에서 다시 신청할 수 있어요.',
    ],
  },
  {
    id: 'task:invest', intent: '식당에 투자하기', pageId: 'page:discover',
    keywords: ['투자하려', '투자하는법', '투자어디', '어떻게투자', '응원하려', '돈넣', '투자참여'],
    steps: [
      '상단 메뉴의 “식당 발견”을 클릭해 원하는 식당을 찾아요.',
      '식당 카드를 클릭하면 상세창이 열려요.',
      '상세창의 “투자하기” 탭에서 금액을 고르고(1,000원 단위) 아래 버튼을 누르면 참여됩니다.',
    ],
    note: '한 식당 목표액의 1% 한도는 먹투 자체 투기 방지 규칙이고 법정 투자한도를 대신하지 않아요. 투자하려면 로그인과 먹투머니 충전이 필요해요.',
  },
  {
    id: 'task:withdraw', intent: '투자금 회수하기', pageId: 'page:my',
    keywords: ['회수', '출금', '돈빼', '환불', '투자취소'],
    steps: [
      '오른쪽 위 프로필 동그라미를 눌러 “MY 먹투”로 들어가요.',
      '“나의 식당” 카드에서 “1만원 회수” 버튼을 누르면 바로 회수돼요.',
      '더 큰 금액이나 예약 회수는 식당 상세창의 “회수하기” 탭에서 금액을 지정하면 됩니다.',
    ],
    note: '모금 중에는 즉시 회수되고, 모금이 끝난 뒤에는 새 투자자와 1,000원 단위로 매칭될 때 회수됩니다.',
  },
  {
    id: 'task:coupon-issue', intent: '쿠폰 발급받기', pageId: 'page:my',
    keywords: ['쿠폰발급', '쿠폰받', '쿠폰꺼내', '할인권받'],
    steps: [
      '“MY 먹투”의 “나의 식당” 카드에서 할인율이 10% 이상 쌓였는지 확인해요.',
      '카드 아래 “쿠폰 발급” 버튼을 누르면 쿠폰 지갑에 담깁니다.',
      '식당 상세창의 “지금 쿠폰 발급” 버튼으로도 같은 발급이 가능해요.',
    ],
  },
  {
    id: 'task:coupon-exchange', intent: '쿠폰 교환하기', pageId: 'page:market',
    keywords: ['쿠폰교환', '쿠폰바꾸', '교환장', '쿠폰거래', '거래장'],
    steps: [
      '상단 메뉴의 “거래장”을 클릭하고, 위쪽 탭이 “쿠폰 교환장”인지 확인해요.',
      '“교환장 둘러보기” 탭에서 원하는 매물의 “교환 제안하기”를 누르고 내줄 쿠폰을 고릅니다.',
      '내 쿠폰을 먼저 올리려면 거래장 오른쪽 위의 주황색 “내 쿠폰 등록”을 누르세요. MY 먹투의 쿠폰 지갑에서도 등록할 수 있어요.',
      '받은 제안은 마이페이지 위쪽의 “새 교환 제안” 배너를 누르거나, 거래장의 “내 교환” 탭에서 수락·거절할 수 있어요.',
    ],
    note: '거래장 위쪽에는 “쿠폰 교환장”과 “펀드 예약 거래” 두 개의 탭이 있어요. 쿠폰을 바꾸는 곳은 앞쪽 탭이에요.',
  },
  {
    id: 'task:coupon-use', intent: '보유 쿠폰 사용하기', pageId: 'page:my',
    keywords: ['쿠폰사용', '쿠폰을사용', '쿠폰쓰기', '사용코드', '쿠폰코드', '매장에서사용', '쿠폰을매장에서', '어떻게사용', '할인받'],
    steps: [
      '투자자 계정으로 로그인한 뒤 상단 메뉴의 “마이페이지”로 들어가요.',
      '쿠폰 지갑에서 “사용 가능” 필터를 누르고 사용할 쿠폰의 “사용하기”를 눌러요.',
      '나타난 8자리 코드를 매장 사장님께 보여주세요.',
      '사장님이 사장님 센터의 “매장 쿠폰 확인”에서 코드를 확인하면 사용 완료됩니다.',
    ],
    note: '사용 요청 중에는 쿠폰이 잠기며, 정해진 시간 안에 매장 확인이 없으면 다시 지갑으로 돌아옵니다.',
  },
  {
    id: 'task:coupon-wallet', intent: '내 쿠폰 상태 확인하기', pageId: 'page:my',
    keywords: ['내쿠폰', '보유쿠폰', '쿠폰현황', '쿠폰상태', '지난쿠폰', '사용완료쿠폰', '만료쿠폰'],
    steps: [
      '상단 메뉴의 “마이페이지”로 들어가 쿠폰 지갑까지 내려가요.',
      '전체·사용 가능·교환 중·확인 대기 필터로 현재 쿠폰을 나눠 볼 수 있어요.',
      '사용 완료·기간 만료 쿠폰은 아래 “지난 쿠폰 보기”에서 확인합니다.',
    ],
  },
  {
    id: 'task:topup', intent: '먹투머니 충전하기', pageId: 'page:my',
    keywords: ['충전', '머니충전', '입금', '돈넣는'],
    steps: [
      '오른쪽 위 프로필 동그라미를 눌러 “MY 먹투”로 들어가요.',
      '오른쪽 위 지갑 카드의 “충전하기” 버튼을 누르고 금액을 선택하면 됩니다.',
    ],
    note: 'MVP에서는 실제 결제가 일어나지 않는 시연용 충전입니다.',
  },
  {
    id: 'task:coupon-verify', intent: '매장에서 손님 쿠폰 확인하기', pageId: 'page:owner',
    keywords: ['쿠폰확인', '쿠폰사용처리', '손님쿠폰', '쿠폰검증', '쿠폰코드'],
    steps: [
      '사장님 계정으로 로그인한 뒤 상단 메뉴 “사장님 센터”로 들어가요.',
      '“매장 쿠폰 확인” 창구에 손님이 보여준 8자리 코드를 입력하고 “쿠폰 확인”을 누릅니다.',
    ],
  },
  {
    id: 'task:sample-download', intent: '심사 자료 샘플 파일 받기', pageId: 'page:owner',
    keywords: ['샘플', '예시파일', '양식', '서식', '견본', '데모파일', '템플릿'],
    steps: [
      '상단 메뉴 “사장님 센터”로 들어가요.',
      '2단계 “B. 소상공인 직접 업로드” 영역 맨 위의 “샘플 자료 한 번에 받기”에서 전체 묶음을 내려받을 수 있어요.',
      '각 자료 카드의 “샘플 다운로드” 버튼으로 필요한 파일만 따로 받을 수도 있습니다.',
      '내려받은 파일을 같은 카드의 “파일 선택” 버튼으로 그대로 올려보면 업로드와 AI 판독을 체험할 수 있어요.',
    ],
  },
  {
    id: 'task:upload-documents', intent: '심사 자료 업로드하기', pageId: 'page:owner',
    keywords: ['자료업로드', '서류제출', '파일올리', '증빙제출', '자료제출', '업로드어디', '샘플자료', '한번에업로드', '일괄업로드'],
    steps: [
      '상단 메뉴 “사장님 센터”로 들어가 펀딩 신청서를 엽니다.',
      '2단계 “자료를 가져오는 방법을 구분해주세요”에서 A(제휴기관 연결) 또는 B(직접 업로드)를 고릅니다.',
      '샘플 자료로 전체 흐름을 확인하려면 B 영역 아래의 “샘플 자료 한 번에 올리기”를 누르세요. 데모 계정과 직접 가입한 사장님 계정에서 모두 사용할 수 있습니다.',
      'B 영역의 자료 카드에서 “파일 선택”을 눌러 파일을 올리면 CSV는 열·행 수까지 즉시 확인해줍니다.',
      '이미지 서류는 “AI 문서 판독” 버튼을 누르면 값이 서로 맞는지 자동으로 확인해줘요.',
    ],
  },
  {
    id: 'task:sales-disclosure', intent: '투자자에게 매출 공개 설정하기', pageId: 'page:owner',
    keywords: ['매출공개', '매출비공개', '공개설정', '월매출공개'],
    steps: [
      '사장님 센터 대시보드에서 “투자자 매출 데이터 공개” 카드를 찾아요.',
      '오른쪽 토글 버튼을 누르면 월매출 공개와 비공개가 바뀝니다.',
    ],
  },
  {
    id: 'task:owner-report', intent: 'AI 점주 경영 리포트 확인하기', pageId: 'page:owner',
    keywords: ['점주리포트', '경영리포트', '매출원인', '재방문개선', '쿠폰할인율제안', '비용점검', '다음달과제'],
    steps: [
      '사장님 계정으로 로그인한 뒤 상단 메뉴의 “사장님 센터”로 들어가요.',
      '운영 대시보드의 “AI 점주 경영 리포트”에서 매출 변화·재방문율·쿠폰 사용률을 확인해요.',
      '매출·쿠폰 자료가 바뀌면 새로 분석되고, 오른쪽 위 “다시 분석”을 누르면 그 자리에서 다시 해석해요.',
      '아래 실행 과제와 비용 점검 항목을 실제 장부와 대조해 다음 달 운영에 참고하세요.',
    ],
    note: '수치는 원장에서 확정해 계산하고 해석 문장만 AI가 씁니다. 참고 해석이며 원인이나 수익을 보장하지 않습니다.',
  },
  {
    id: 'task:owner-dividend', intent: '투자자에게 식당 감사 쿠폰 보내기', pageId: 'page:owner',
    keywords: ['배당쿠폰', '감사쿠폰', '투자자쿠폰', '쿠폰보내'],
    steps: [
      '사장님 센터 대시보드에서 먼저 “쿠폰 손익 안전선”을 확인해요.',
      '“투자자 관계” 카드의 “10% 식당 감사 쿠폰 보내기”를 누르면 현재 투자자에게 쿠폰이 발급됩니다.',
    ],
    note: '발송 전에 아직 사용되지 않은 최대 할인액과 월매출 대비 부담을 반드시 확인하세요.',
  },
  {
    id: 'task:review', intent: '식당 방문 인증 리뷰 남기기', pageId: 'page:discover',
    keywords: ['리뷰작성', '후기작성', '리뷰남기', '방문인증', '별점'],
    steps: [
      '식당 발견에서 식당 카드를 눌러 상세창을 열어요.',
      '리뷰 영역의 “방문 인증”을 먼저 누른 뒤 별점과 내용을 작성해요.',
      '등록된 리뷰에는 방문 인증 표시가 붙습니다.',
    ],
  },
  {
    id: 'task:compare-restaurants', intent: 'AI 공개정보 요약으로 식당 비교하기', pageId: 'page:insight',
    keywords: ['식당비교', '추천비교', '성장률비교', '재방문율비교', '기회점수비교', '어디투자'],
    steps: [
      '상단 메뉴의 “AI 인사이트”를 클릭해요.',
      'AI 공개정보 요약 영역에서 비교할 식당을 최대 3곳 선택해요.',
      '성장률·재방문율·기회점수를 한 표에서 비교하고 식당 상세를 열어 확인해요.',
    ],
  },
  {
    id: 'task:ai-consult', intent: 'AI 상담 받기', pageId: 'page:insight',
    keywords: ['상담', 'ai물어', 'ai질문', '챗봇', '문의'],
    steps: [
      '상단 메뉴의 “AI 인사이트”에서 오른쪽 상담창을 이용하거나,',
      '어느 화면에서든 오른쪽 아래 “AI와 상담하기” 버튼을 눌러 물어보면 됩니다.',
    ],
  },
  {
    id: 'task:signup', intent: '회원가입·로그인·체험 모드 시작', pageId: 'page:auth',
    keywords: ['회원가입', '가입', '로그인', '체험', '데모', '계정만들'],
    steps: [
      '오른쪽 위 “로그인” 버튼을 눌러요.',
      '로그인은 “투자자” 또는 “사장님” 유형을 먼저 고른 뒤 가입한 이메일·비밀번호를 입력합니다. 새 계정은 회원가입 탭에서 유형과 이름까지 입력해요.',
      '바로 둘러보려면 로그인 탭 아래 투자자·사장님·관리자 데모 중 하나를 누르세요.',
    ],
    note: '체험 모드에서도 투자·쿠폰 발급·교환·리뷰·기관 연결·심사 접수를 실제처럼 눌러볼 수 있어요. 다만 그 기록은 나에게만 보이고 저장되지 않아요.',
  },
  {
    id: 'task:support', intent: '1:1 문의하기·고객지원 받기', pageId: 'page:support',
    keywords: ['문의', '고객센터', '고객지원', '상담신청', '접수', '신고', '항의', '민원', '답변받', '사람이랑', '담당자'],
    steps: [
      '상단 메뉴의 “신고·문의”를 눌러요.',
      '문의 유형을 고르고 제목과 내용을 적어요. 언제 어떤 화면에서 막혔는지 적으면 확인이 빨라져요.',
      '“문의 보내기” 버튼을 누르면 접수되고, 답변은 알림으로 알려드려요.',
      '오른쪽 “내 문의 내역”에서 접수 상태와 답변을 다시 볼 수 있어요.',
    ],
    note: '먹투에는 상담 전화번호나 이메일 창구가 없고, 이 1:1 문의가 사람에게 닿는 유일한 통로예요.',
  },
  {
    id: 'task:fund-orderbook', intent: '펀드 예약 거래 대기줄 보기', pageId: 'page:market',
    keywords: ['예약거래', '호가', '대기줄', '순번', '매수대기', '회수대기', '주문장', '거래대기', '언제회수', '차례'],
    steps: [
      '상단 메뉴의 “거래장”을 클릭해요.',
      '위쪽 탭에서 “펀드 예약 거래”를 눌러요.',
      '식당별로 “투자 대기”와 “회수 대기” 줄에 각각 얼마가 걸려 있는지 볼 수 있어요.',
      '내 주문에는 테두리가 표시되고 “취소” 버튼으로 뺄 수 있어요.',
      '새로 예약하려면 카드의 “예약 걸기 · 상세 보기”를 눌러 식당 상세창에서 금액을 넣어요.',
    ],
    note: '가격은 1,000원으로 고정이고 먼저 예약한 순서대로 체결돼요. 반대 주문이 없으면 회수가 늦어질 수 있어요.',
  },
  {
    id: 'task:credit-grade', intent: '내 먹투 성장성 예비평가·경영 진단 확인하기', pageId: 'page:owner',
    keywords: ['신용등급', '등급', '내점수', '몇점', '신용평가', '경영진단', '진단', '35개', '지표', '왜이등급'],
    steps: [
      '소상공인 계정으로 로그인한 뒤 상단 메뉴의 “사장님 센터”로 가요.',
      '자료를 올리고 “먹투 자동분석 시작”을 누르면 결과 화면이 나와요.',
      '결과 화면의 “업종 기준 예비평가 결과” 카드에서 결과 구간과 점수, 평가점수를 올린 지표와 낮춘 지표를 볼 수 있어요.',
      '“35개 지표 전부 보기”를 누르면 지표별 값·점수·가중치가 모두 펼쳐져요.',
    ],
    note: '자료가 없는 지표는 감점하지 않고 “미산정”으로 빠지며, 그만큼 지표 산정률이 낮게 표시돼요.',
  },
  {
    id: 'task:notifications', intent: '알림 확인하기', pageId: 'page:home',
    keywords: ['알림', '알람', '소식확인'],
    steps: ['오른쪽 위 종 모양 아이콘을 누르면 투자·쿠폰·심사 알림이 펼쳐집니다.'],
  },
]

const pageById = new Map(sitePages.map((page) => [page.id, page]))

/** 브라우저가 보내준 현재 경로를 실제 화면 정보로 바꾼다. */
export function pageForRoute(route: unknown) {
  const safe = typeof route === 'string' ? route.split(/[?#]/)[0] : ''
  return sitePages.find((page) => page.route === safe)
}

const squash = (value: string) => value.replace(/\s+/g, '').toLocaleLowerCase('ko')

/** "어디로 가야 하나요" 류의 화면 위치 질문인지 판별한다. */
export function isNavigationQuestion(question: string) {
  const text = squash(question)
  const asksPlace = /(어디|어느|어떻게|방법|찾을수|들어가|가야|가면|눌러|클릭|메뉴|화면|페이지|탭|버튼|경로)/.test(text)
  const asksAction = /(등록|신청|가입|로그인|업로드|제출|교환|충전|발급|회수|투자|확인|설정|다운|받)/.test(text)
  return asksPlace && asksAction
}

/** 질문과 맞는 화면 안내를 점수순으로 찾는다. */
export function matchUiTasks(question: string, limit = 2) {
  const text = squash(question)
  const scored = uiTasks.map((task) => {
    let score = 0
    for (const keyword of task.keywords) if (text.includes(squash(keyword))) score += 3
    const page = pageById.get(task.pageId)
    if (page && text.includes(squash(page.name))) score += 2
    for (const piece of squash(task.intent).split(/[·()]/)) {
      if (piece.length > 1 && text.includes(piece)) score += 1
    }
    return { task, score }
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((item) => item.task)
}

/** 질문에서 직접 언급된 화면. "거래장이 뭐야" 같은 질문에 쓴다. */
export function matchSitePages(question: string, limit = 2) {
  const text = squash(question)
  return sitePages
    .filter((page) => text.includes(squash(page.name)) || (page.route.length > 1 && text.includes(page.route)))
    .slice(0, limit)
}

/**
 * 외부 AI 없이도 화면 위치를 제대로 안내하는 로컬 답변.
 * 절차 단계 이름을 그대로 읽어주지 않고 "어느 메뉴를 누르는지"부터 말한다.
 */
export function answerNavigationQuestion(question: string) {
  const tasks = matchUiTasks(question, 1)
  const task = tasks[0]
  if (!task) {
    const page = matchSitePages(question, 1)[0]
    if (!page) return ''
    return [
      `${page.name}은 ${page.menuPath}에서 열 수 있어요.`,
      page.purpose + '입니다.',
      `여기에서 ${page.actions.slice(0, 3).join(', ')}을(를) 할 수 있어요.`,
    ].join(' ')
  }
  const page = pageById.get(task.pageId)
  const head = page ? `${task.intent}는 ${page.menuPath}에서 시작해요.` : `${task.intent} 안내예요.`
  return [head, ...task.steps.map((step, index) => `${index + 1}. ${step}`), ...(task.note ? ['', task.note] : [])].join('\n')
}

/** 지식그래프에 붙일 화면 노드. trust.ts의 GuideStep과 같은 형태를 쓴다. */
export function siteGraphNodes() {
  const pages = sitePages.map((page) => ({
    id: page.id, type: 'SitePage', label: page.name, source: 'MEOKTU_UI_MAP',
    properties: {
      route: page.route, menuPath: page.menuPath, audience: page.audience,
      loginRequired: page.login, purpose: page.purpose, actions: page.actions.join(' / '),
    },
  }))
  const tasks = uiTasks.map((task) => ({
    id: task.id, type: 'UiTask', label: task.intent, source: 'MEOKTU_UI_MAP',
    properties: {
      screen: pageById.get(task.pageId)?.name || '',
      menuPath: pageById.get(task.pageId)?.menuPath || '',
      clickPath: task.steps.join(' → '),
      ...(task.note ? { note: task.note } : {}),
    },
  }))
  return [...pages, ...tasks]
}

export function siteGraphEdges() {
  return uiTasks.map((task) => ({ from: task.id, relation: 'PERFORMED_ON', to: task.pageId }))
}

/** 프롬프트에 넣을 압축된 화면 지도. */
export function navigationBrief(question: string) {
  const tasks = matchUiTasks(question, 3)
  const pages = matchSitePages(question, 2)
  const usedPages = new Set(pages.map((page) => page.id))
  for (const task of tasks) usedPages.add(task.pageId)
  return {
    screens: sitePages.filter((page) => usedPages.has(page.id)).map((page) => ({
      name: page.name, menuPath: page.menuPath, route: page.route, purpose: page.purpose, actions: page.actions,
    })),
    howTo: tasks.map((task) => ({
      intent: task.intent,
      screen: pageById.get(task.pageId)?.name,
      menuPath: pageById.get(task.pageId)?.menuPath,
      steps: task.steps,
      note: task.note,
    })),
    headerMenu: sitePages.filter((page) => page.menuPath.startsWith('상단 메뉴')).map((page) => `${page.name}(${page.route})`),
  }
}
