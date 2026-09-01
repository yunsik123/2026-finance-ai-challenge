/**
 * 먹투 웹사이트 UI 내비게이션 지식.
 *
 * 심사 절차 그래프(trust.ts의 GuideStep)는 "무엇을 검증하는가"를 설명하지만
 * "화면 어디를 눌러야 하는가"는 담고 있지 않다. 그래서 AI 상담원이
 * "펀드 등록하려면 어디로 가야 하나요?" 같은 질문에 절차 단계 이름을
 * 그대로 읽어주는 문제가 있었다. 이 파일이 그 빈틈을 메운다.
 *
 * 여기의 메뉴명·버튼명은 실제 화면(App.tsx / OwnerCenter.tsx / MyPage 등)과
 * 1:1로 맞춰야 한다. 화면 문구를 바꾸면 이 파일도 함께 고칠 것.
 */

export type SitePage = {
  id: string
  name: string
  route: string
  /** 사용자가 실제로 눌러서 도달하는 경로. */
  menuPath: string
  audience: 'all' | 'investor' | 'owner'
  login: 'none' | 'any' | 'owner'
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
    purpose: '먹투 서비스 소개와 오늘의 추천 식당을 한눈에 보는 첫 화면',
    actions: ['서비스 작동 방식 확인', '기회점수 상위 식당 보기', '먹투 펀드(ETF) 묶음 보기', '사장님 안내 배너로 이동'],
  },
  {
    id: 'page:discover', name: '식당 발견', route: '/discover', menuPath: '상단 메뉴 > 식당 발견',
    audience: 'investor', login: 'none',
    purpose: '투자할 식당을 검색·필터로 찾고 상세 정보를 여는 화면',
    actions: ['식당·동네·음식 검색', '업종 칩과 추천순·성장률순·마감임박순 정렬', '식당 카드 클릭으로 상세창 열기', '하트 아이콘으로 찜하기'],
  },
  {
    id: 'page:market', name: '거래장', route: '/market', menuPath: '상단 메뉴 > 거래장',
    audience: 'investor', login: 'none',
    purpose: '가지고 있는 쿠폰을 다른 사람의 쿠폰과 맞바꾸는 쿠폰 교환장',
    actions: ['교환장 둘러보기 탭에서 매물 검색·필터', '교환 제안하기 버튼으로 내 쿠폰 제안', '내 교환 탭에서 받은 제안 수락·거절', '거래 이력 확인'],
  },
  {
    id: 'page:insight', name: 'AI 인사이트', route: '/insight', menuPath: '상단 메뉴 > AI 인사이트',
    audience: 'all', login: 'none',
    purpose: 'AI 상담원과 대화하고 AI가 정리한 상권 읽을거리를 보는 화면',
    actions: ['오른쪽 상담창에 질문 입력', '추천 질문 칩 클릭', 'AI 오늘의 발견에서 식당 상세 열기', '상권 아티클 자세히 읽기'],
  },
  {
    id: 'page:trust', name: '검증 데이터룸', route: '/trust', menuPath: '상단 메뉴 > 검증 데이터룸',
    audience: 'all', login: 'none',
    purpose: '식당 예비점수가 어떤 근거로 계산됐는지 공개하는 화면',
    actions: ['분석할 식당 선택', '점수 구성요소와 가중치 확인', '주소 기반 상권 분석 확인', '투자자 확인 절차 그래프 보기'],
  },
  {
    id: 'page:owner', name: '사장님 센터', route: '/owner', menuPath: '상단 메뉴 > 사장님 센터',
    audience: 'owner', login: 'none',
    purpose: '소상공인이 펀딩(펀드)을 등록·신청하고 자료를 제출하며 운영 현황을 보는 화면',
    actions: ['펀딩 신청서 작성과 자료 업로드', '제휴기관 데이터 연결', 'AI 문서 판독(OCR)', '펀딩 대시보드와 쿠폰 부담 확인', '매장 쿠폰 확인', '투자자 매출 공개 설정'],
  },
  {
    id: 'page:my', name: 'MY 먹투', route: '/my', menuPath: '오른쪽 위 프로필 동그라미(또는 모바일 하단 MY)',
    audience: 'investor', login: 'any',
    purpose: '내 투자금, 쿠폰, 지갑, 관심 식당을 모아 보는 개인 화면',
    actions: ['먹투머니 충전', '투자한 식당별 쿠폰 성장 확인', '쿠폰 발급과 1만원 회수', '쿠폰 지갑에서 교환장 등록', '관심 식당 다시 보기'],
  },
  {
    id: 'page:ai-widget', name: 'AI 상담 버튼', route: '(모든 화면 공통)', menuPath: '화면 오른쪽 아래 “AI와 상담하기” 버튼',
    audience: 'all', login: 'none',
    purpose: '어느 화면에서든 바로 열 수 있는 떠 있는 AI 상담창',
    actions: ['질문 입력', '역할별 추천 질문 클릭', '답변의 근거 그래프 확인'],
  },
  {
    id: 'page:auth', name: '로그인·회원가입 창', route: '(팝업)', menuPath: '오른쪽 위 “로그인” 버튼',
    audience: 'all', login: 'none',
    purpose: '로그인, 회원가입, 저장되지 않는 체험 모드 시작',
    actions: ['로그인 탭에서 이메일·비밀번호 입력', '회원가입 탭에서 투자자 또는 소상공인 역할 선택', '“😋 투자자 AI 체험”·“👩‍🍳 사장님 업로드 체험” 버튼으로 체험 시작'],
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
      '3단계 필수 동의 2개를 체크하고, 4단계에서 희망 펀딩액·자금 사용계획을 작성해요.',
      '맨 아래 “먹투 자동분석 시작” 버튼을 누르면 예비심사 결과가 바로 나와요.',
    ],
    note: '이미 펀딩을 운영 중인 사장님은 사장님 센터 대시보드의 “추가 펀딩 준비” 버튼으로 새 펀딩을 시작합니다.',
  },
  {
    id: 'task:invest', intent: '식당에 투자하기', pageId: 'page:discover',
    keywords: ['투자하려', '투자하는법', '투자어디', '어떻게투자', '응원하려', '돈넣', '투자참여'],
    steps: [
      '상단 메뉴의 “식당 발견”을 클릭해 원하는 식당을 찾아요.',
      '식당 카드를 클릭하면 상세창이 열려요.',
      '상세창의 “투자하기” 탭에서 금액을 고르고(1,000원 단위) 아래 버튼을 누르면 참여됩니다.',
    ],
    note: '한 식당에 목표액의 1%까지만 투자할 수 있고, 투자하려면 로그인과 먹투머니 충전이 필요해요.',
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
      '상단 메뉴의 “거래장”을 클릭해요.',
      '“교환장 둘러보기” 탭에서 원하는 매물의 “교환 제안하기”를 누르고 내줄 쿠폰을 고릅니다.',
      '내 쿠폰을 먼저 올리려면 “MY 먹투”의 쿠폰 지갑에서 “교환장 등록”을 누르세요.',
      '받은 제안은 거래장의 “내 교환” 탭에서 수락하거나 거절할 수 있어요.',
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
    keywords: ['자료업로드', '서류제출', '파일올리', '증빙제출', '자료제출', '업로드어디'],
    steps: [
      '상단 메뉴 “사장님 센터”로 들어가 펀딩 신청서를 엽니다.',
      '2단계 “자료를 가져오는 방법을 구분해주세요”에서 A(제휴기관 연결) 또는 B(직접 업로드)를 고릅니다.',
      'B 영역의 자료 카드에서 “파일 선택”을 눌러 파일을 올리면 CSV는 열·행 수까지 즉시 확인해줍니다.',
      '이미지 문서는 “AI 문서 판독” 버튼으로 OCR 교차검증을 돌릴 수 있어요.',
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
    id: 'task:check-evidence', intent: '심사 점수 근거 확인하기', pageId: 'page:trust',
    keywords: ['점수근거', '심사근거', '어떻게점수', '검증데이터', '데이터룸', '신뢰도확인'],
    steps: [
      '상단 메뉴의 “검증 데이터룸”을 클릭해요.',
      '“분석할 식당”을 고르면 점수 구성요소·가중치·상권 분석·누락 자료가 모두 펼쳐집니다.',
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
      '회원가입 탭에서 “투자자” 또는 “소상공인”을 고르고 이름·이메일·비밀번호를 입력합니다.',
      '저장 없이 둘러보려면 로그인 탭 아래 “😋 투자자 AI 체험” 또는 “👩‍🍳 사장님 업로드 체험”을 누르세요.',
    ],
    note: '체험 모드에서는 AI 상담과 샘플 업로드·OCR만 되고 투자·충전·쿠폰 교환·심사 접수는 막혀 있어요.',
  },
  {
    id: 'task:notifications', intent: '알림 확인하기', pageId: 'page:home',
    keywords: ['알림', '알람', '소식확인'],
    steps: ['오른쪽 위 종 모양 아이콘을 누르면 투자·쿠폰·심사 알림이 펼쳐집니다.'],
  },
]

const pageById = new Map(sitePages.map((page) => [page.id, page]))

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
