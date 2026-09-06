/**
 * 제출 자료의 요건과 발급 창구.
 *
 * 왜 서버에 두는가.
 *   "사업자등록증명 어디서 받아요?"는 사장님이 가장 많이 막히는 지점이고,
 *   화면 도움말과 AI 상담이 서로 다른 말을 하면 그때부터 못 믿는 화면이 된다.
 *   그래서 요건(필수·택1·조건부·선택)과 발급 창구를 한 곳에 적고,
 *   화면(GET /api/document-guide)과 AI 지식그래프가 같은 값을 읽는다.
 *
 * 필수 구조는 이렇게 잡았다.
 *   ① 사업체 확인 — 사업자등록 + 영업신고            (필수)
 *   ② 현금흐름    — 사업용 계좌                      (필수)
 *   ③ 매출 확인   — POS·카드·납세·배달 중 하나 이상  (택1 필수)
 *   ④ 부채 확인   — 대출이 있으면 필수               (화면에서 직접 신고)
 *   ⑤ 추가 자료   — 올리면 산정 지표가 늘어남         (선택)
 *
 * POS 를 무조건 필수로 두지 않는 것이 핵심이다. 포스를 안 쓰거나 자료를 뽑을 줄 모르는
 * 사장님이 실제로 많고, 그런 가게가 신청 자체에서 막히면 안 된다.
 *
 * 주소는 바뀔 수 있다. 확신하지 못하는 창구는 기관·메뉴 이름으로만 적고 링크를 비웠다.
 * 없는 주소를 적어두는 것이 안 적는 것보다 나쁘다.
 */

export type DocumentRequirement = 'required' | 'sales-one-of' | 'conditional' | 'optional'

export type DocumentGuide = {
  sourceId: string
  title: string
  requirement: DocumentRequirement
  /** 화면 배지에 그대로 쓰는 말. */
  requirementLabel: string
  group: '사업체 확인' | '매출 확인' | '현금흐름 확인' | '부채 확인' | '추가 자료'
  /** 정확히 무엇을 몇 부 내면 되는지. */
  exact: string
  /** 이 자료가 없으면 무엇을 산정할 수 없는지. 사장님이 우선순위를 정할 수 있게. */
  whyItMatters: string
  /** 어디서 어떻게 받는지. */
  issuance: Array<{ channel: string; how: string; url?: string; note?: string }>
}

export const DOCUMENT_GUIDE_VERSION = 'meoktu-document-guide-2026-09'

export const documentGuides: DocumentGuide[] = [
  {
    sourceId: 'business',
    title: '사업자등록 자료',
    requirement: 'required',
    requirementLabel: '필수',
    group: '사업체 확인',
    exact: '사업자등록증명 또는 사업자등록증 사본 1부',
    whyItMatters: '상호·대표자·개업일·업종을 확인하는 기준 서류예요. 이게 없으면 업력과 업종별 평가 기준을 정할 수 없어요.',
    issuance: [
      { channel: '국세청 홈택스', how: '로그인 → 상단 “증명·등록·신청” → 즉시발급 증명 → 사업자등록증명 → 발급(PDF 저장)', url: 'https://www.hometax.go.kr' },
      { channel: '정부24', how: '검색창에 “사업자등록증명” → 발급하기 → 본인인증 후 PDF 저장', url: 'https://www.gov.kr' },
      { channel: '세무서·무인민원발급기', how: '가까운 세무서 민원실 또는 무인민원발급기에서 즉시 발급', note: '온라인이 어려우면 이 방법이 가장 빠릅니다.' },
    ],
  },
  {
    sourceId: 'license',
    title: '영업신고 자료',
    requirement: 'required',
    requirementLabel: '필수',
    group: '사업체 확인',
    exact: '일반음식점·휴게음식점 영업신고증 사본 1부',
    whyItMatters: '실제로 영업 중인 음식점인지 확인하는 서류예요. 투자자에게 공개되는 “실재 영업 확인”의 근거가 됩니다.',
    issuance: [
      { channel: '관할 시·군·구청 위생과', how: '신분증을 갖고 방문해 영업신고증 재발급 요청 (보통 즉시 발급)' },
      { channel: '정부24', how: '검색창에 “영업신고증” → 재발급 신청 → 본인인증', url: 'https://www.gov.kr', note: '지자체에 따라 온라인 재발급이 안 되는 곳도 있어요.' },
      { channel: '식품안전나라', how: '“음식점 정보” 검색으로 내 업소의 영업 종류·신고번호를 먼저 확인할 수 있어요', url: 'https://www.foodsafetykorea.go.kr' },
    ],
  },
  {
    sourceId: 'account',
    title: '사업용 계좌 내역',
    requirement: 'required',
    requirementLabel: '필수',
    group: '현금흐름 확인',
    exact: '최근 12개월 입출금 거래내역 CSV 또는 엑셀 1개',
    whyItMatters: '실제로 돈이 들어오고 나간 기록이에요. 매출이 통장에 실제로 들어왔는지, 고정비와 상환 부담이 얼마인지는 이 자료로만 확인할 수 있어 필수입니다.',
    issuance: [
      { channel: '인터넷뱅킹', how: '로그인 → 조회 → 거래내역 조회 → 기간 12개월 지정 → 엑셀(또는 CSV) 내려받기' },
      { channel: '은행 모바일 앱', how: '계좌 → 거래내역 → 기간 조회 → 내려받기·메일로 보내기', note: '앱에서 파일이 안 되면 “거래내역서 메일 발송”을 쓰면 엑셀이 옵니다.' },
      { channel: '은행 지점', how: '통장·신분증을 갖고 방문해 “거래내역서 12개월” 출력 요청', note: '종이로 받았다면 사진을 찍어 올려도 됩니다.' },
    ],
  },
  {
    sourceId: 'pos',
    title: 'POS 매출 원자료',
    requirement: 'sales-one-of',
    requirementLabel: '매출 확인 자료 (택1)',
    group: '매출 확인',
    exact: '최근 12개월 주문 단위 내역 CSV 또는 엑셀 1개',
    whyItMatters: '가장 촘촘한 매출 자료예요. 객단가·환불비율·주문건수 증가까지 계산할 수 있어서 산정되는 평가 지표가 가장 많아집니다.',
    issuance: [
      { channel: 'POS 관리자 화면', how: '매출·정산 메뉴에서 기간을 12개월로 지정하고 “엑셀 내려받기”를 누르세요. 주문 단위(건별) 내역이어야 합니다.', note: '토스플레이스·OKPOS·유니온포스·페이앳 등 기기마다 메뉴 이름이 조금씩 달라요.' },
      { channel: '프랜차이즈 본사 시스템', how: '가맹점 관리자 페이지의 매출 조회에서 기간별 내역을 내려받으세요.' },
      { channel: 'POS 대리점·설치업체', how: '기기 설치업체에 전화해 “최근 12개월 주문 내역 엑셀”을 요청하면 대신 뽑아주는 곳이 많아요.', note: 'POS 자료를 못 구하면 아래 카드 매출자료나 납세 자료로 대체할 수 있어요.' },
    ],
  },
  {
    sourceId: 'card',
    title: '카드 매출·정산 자료',
    requirement: 'sales-one-of',
    requirementLabel: '매출 확인 자료 (택1)',
    group: '매출 확인',
    exact: '최근 12개월 카드 승인·정산 내역 CSV 또는 엑셀 1개',
    whyItMatters: 'POS가 없어도 매출을 확인할 수 있는 가장 현실적인 대체 자료예요. 카드 비중이 높은 가게라면 POS와 거의 같은 결과가 나옵니다.',
    issuance: [
      { channel: '여신금융협회', how: '가맹점 회원가입 후 카드매출 조회에서 기간별 승인·입금 내역을 내려받으세요.', url: 'https://www.crefia.or.kr' },
      { channel: 'VAN사 가맹점 포털', how: '나이스정보통신·KIS정보통신·한국정보통신 등 단말기 VAN사 가맹점 사이트의 매출조회에서 엑셀로 내려받기' },
      { channel: '카드사 가맹점 사이트', how: '주거래 카드사 가맹점 메뉴에서 승인·정산 내역 조회', note: '여러 카드사를 쓰면 여신금융협회에서 한 번에 보는 편이 쉽습니다.' },
    ],
  },
  {
    sourceId: 'tax',
    title: '납세 자료 (홈택스)',
    requirement: 'sales-one-of',
    requirementLabel: '매출 확인 자료 (택1) · 강력권장',
    group: '매출 확인',
    exact: '최근 2개 과세기간 부가가치세 신고서 또는 매출액 사실증명 1부',
    whyItMatters: '국가에 신고한 매출이라 가장 강한 기준점이에요. POS·카드·계좌 매출과 이 값을 맞춰보면 자료 일치도가 크게 올라갑니다.',
    issuance: [
      { channel: '국세청 홈택스 — 신고내역', how: '로그인 → “세금신고” → 부가가치세 → 신고내역 조회에서 신고서를 PDF로 내려받기', url: 'https://www.hometax.go.kr' },
      { channel: '국세청 홈택스 — 사실증명', how: '“증명·등록·신청” → 사실증명 신청 → 부가가치세 과세표준증명(매출액) 발급', url: 'https://www.hometax.go.kr', note: '신고서가 복잡하면 이 증명 한 장이 더 간단합니다.' },
      { channel: '담당 세무사', how: '기장을 맡긴 세무사에게 “최근 2년 부가세 신고서”를 요청하면 PDF로 바로 받을 수 있어요.', note: '먹투는 세무사가 준 PDF를 그대로 올려도 읽습니다. 양식을 다시 만들 필요 없어요.' },
    ],
  },
  {
    sourceId: 'delivery',
    title: '배달 플랫폼 정산',
    requirement: 'sales-one-of',
    requirementLabel: '매출 확인 자료 (택1)',
    group: '매출 확인',
    exact: '최근 12개월 배달앱 정산 내역 CSV 또는 엑셀 1개',
    whyItMatters: '배달 비중과 재주문율을 계산해요. 배달 위주 가게라면 성장 흐름이 여기서 가장 잘 드러납니다.',
    issuance: [
      { channel: '배달의민족 셀프서비스', how: '사장님 계정 로그인 → 정산 → 기간 선택 후 내려받기', url: 'https://ceo.baemin.com' },
      { channel: '쿠팡이츠 스토어', how: '사장님 계정 → 정산관리에서 기간별 내역 내려받기' },
      { channel: '요기요 사장님 포털', how: '정산 메뉴에서 기간별 정산서 내려받기', note: '여러 앱을 쓰면 각각 내려받아 모두 올려도 됩니다.' },
    ],
  },
  {
    sourceId: 'debt',
    title: '부채·상환 자료',
    requirement: 'conditional',
    requirementLabel: '대출 있으면 필수',
    group: '부채 확인',
    exact: '금융기관 대출 잔액·월 상환액 내역 (증빙은 선택)',
    whyItMatters: '투자금을 갚아나갈 여력을 보는 핵심 항목이에요. 화면에서 직접 적어주시면 되고, 증빙까지 올리면 신고값과 맞는지 대조해 신뢰도가 올라갑니다.',
    issuance: [
      { channel: '한국신용정보원 크레딧포유', how: '본인인증 후 “대출현황 조회”에서 전 금융기관 대출을 한 번에 확인', url: 'https://www.credit4u.or.kr' },
      { channel: '거래 금융기관', how: '인터넷뱅킹·앱의 대출 메뉴에서 잔액·금리·월 상환액·만기 확인, 필요하면 부채증명서 발급' },
      { channel: '금융거래확인서', how: '은행 창구나 앱에서 “금융거래확인서”를 받으면 잔액이 한 장에 정리돼 나옵니다.' },
    ],
  },
  {
    sourceId: 'customer',
    title: '고객 방문 자료',
    requirement: 'optional',
    requirementLabel: '선택 · 있으면 가점 요소',
    group: '추가 자료',
    exact: '가명처리된 고객 방문 이력 CSV 1개',
    whyItMatters: '재방문율은 먹투가 가장 중요하게 보는 차별 지표예요. 없으면 감점하지 않고 미산정으로 둡니다.',
    issuance: [
      { channel: 'POS 회원·적립 시스템', how: '고객관리 메뉴에서 방문횟수·최초방문일이 담긴 내역 내려받기', note: '이름·전화번호는 지우고 올려주세요. 먹투는 식별정보를 받지 않습니다.' },
      { channel: '예약 서비스', how: '캐치테이블·네이버예약 등의 사장님 화면에서 예약·방문 이력 내려받기' },
      { channel: '배달앱 재주문 자료', how: '배달 정산자료에 재주문 건수가 포함돼 있으면 그것으로도 계산됩니다.' },
    ],
  },
  {
    sourceId: 'lease',
    title: '임대차 자료',
    requirement: 'optional',
    requirementLabel: '선택 · 조건부',
    group: '추가 자료',
    exact: '임대차계약서 사본 1부 또는 월 임차료 내역',
    whyItMatters: '임차료가 매출에서 차지하는 비중을 계산해요. 고정비 부담을 설명할 수 있어 조건부 승인에서 특히 도움이 됩니다.',
    issuance: [
      { channel: '보관 중인 계약서', how: '임대차계약서 원본을 사진으로 찍거나 스캔해서 올리면 됩니다.' },
      { channel: '인터넷등기소', how: '확정일자를 받은 계약이면 확정일자 부여 현황을 조회할 수 있어요', url: 'https://www.iros.go.kr' },
      { channel: '임대인·부동산', how: '계약서를 분실했다면 임대인이나 중개사무소에 사본을 요청하세요.' },
    ],
  },
  {
    sourceId: 'staff',
    title: '인력·급여 자료',
    requirement: 'optional',
    requirementLabel: '선택',
    group: '추가 자료',
    exact: '최근 12개월 직원수·급여 총액 내역 1개',
    whyItMatters: '고용이 늘고 있는지, 인건비 구조가 매출에 비해 무리가 없는지를 봐요. 보조 지표라 없어도 감점하지 않습니다.',
    issuance: [
      { channel: '4대보험 정보연계센터', how: '사업장 로그인 후 “가입자 명부”에서 월별 가입자 수 확인', url: 'https://www.4insure.or.kr' },
      { channel: '급여대장·회계 프로그램', how: '급여관리 메뉴에서 월별 지급총액 내려받기' },
      { channel: '담당 세무사', how: '기장 세무사에게 “원천세 신고 내역” 또는 급여대장을 요청' },
    ],
  },
]

export const guideBySource = new Map(documentGuides.map((guide) => [guide.sourceId, guide]))

/** 매출을 확인할 수 있는 자료. 이 중 하나만 있어도 접수된다. */
export const SALES_EVIDENCE_SOURCES = documentGuides
  .filter((guide) => guide.requirement === 'sales-one-of')
  .map((guide) => guide.sourceId)

/** 무조건 있어야 하는 자료. */
export const ALWAYS_REQUIRED_SOURCES = documentGuides
  .filter((guide) => guide.requirement === 'required')
  .map((guide) => guide.sourceId)

/**
 * 제출 요건을 AI 지식그래프 노드로 바꾼다.
 *
 * 이게 있어야 "사업자등록증 어디서 받아요?", "POS 없으면 안 되나요?" 같은 질문에
 * 절차 설명이 아니라 실제 요건과 발급 창구로 답할 수 있다.
 */
export function documentGuideGraph() {
  type GuideNode = { id: string; type: string; label: string; source: string; properties: Record<string, string | number | boolean> }
  const nodes: GuideNode[] = documentGuides.map((guide) => ({
    id: `document:${guide.sourceId}`,
    type: 'DocumentRequirement',
    label: `${guide.title} · ${guide.requirementLabel}`,
    source: 'MEOKTU_DOCUMENT_GUIDE',
    properties: {
      요건: guide.requirementLabel,
      묶음: guide.group,
      정확히무엇을: guide.exact,
      왜필요한가: guide.whyItMatters,
      발급창구: guide.issuance.map((item) => `${item.channel}: ${item.how}${item.url ? ` (${item.url})` : ''}`).join(' / ').slice(0, 200),
      기준일: DOCUMENT_GUIDE_VERSION,
      keywords: `${guide.title} 발급 어디서 어떻게 받 준비 서류 자료 제출 ${guide.sourceId} ${guide.group}`,
    },
  }))
  // 묶음 노드를 세워 자료를 그 아래에 매단다. "매출 자료 뭐 내면 돼요?"를 순회로 답할 수 있다.
  const groups = [...new Set(documentGuides.map((guide) => guide.group))]
  for (const group of groups) {
    nodes.push({
      id: `document-group:${group}`,
      type: 'DocumentGroup',
      label: `${group} 자료`,
      source: 'MEOKTU_DOCUMENT_GUIDE',
      properties: {
        묶음: group,
        요건: group === '매출 확인' ? '아래 중 하나 이상이면 됩니다' : group === '부채 확인' ? '대출이 있으면 필수' : group === '추가 자료' ? '선택' : '필수',
        기준일: DOCUMENT_GUIDE_VERSION,
        keywords: `${group} 자료 필수 선택 무엇 준비 제출`,
      },
    })
  }
  const edges = documentGuides.map((guide) => ({
    from: `document:${guide.sourceId}`, relation: 'BELONGS_TO', to: `document-group:${guide.group}`,
  }))
  return { nodes, edges }
}
