/**
 * 소상공인이 실제로 궁금해하는 "밖의 정보"와 "내 상황"을 같은 그래프에 올린다.
 *
 * 두 갈래로 나뉜다.
 *   ① supportPrograms — 정책자금·보증·세제·공제처럼 먹투 밖에 있지만
 *      사장님이라면 알아야 하는 공적 지원제도 지식. 정적이고 모두에게 같다.
 *   ② ownerSituation() — 이 사장님의 지금 상태. 제출한 자료, 연결한 기관,
 *      심사 어디까지 갔는지, 무엇이 비어 있는지. 요청마다 새로 계산된다.
 *
 * ①은 "무엇을 할 수 있는지"를, ②는 "지금 나는 어디쯤인지"를 답하게 해준다.
 * 둘을 같은 그래프에 넣어야 AI가 "사장님은 지금 POS가 비어 있는데,
 * 그것만 채우면 조건부 승인 구간이고 이럴 땐 이런 제도도 같이 볼 수 있어요"처럼
 * 두 정보를 이어 붙인 답을 만들 수 있다.
 *
 * 주의: 지원제도의 금액·금리·기간은 해마다 공고로 바뀐다. 여기 값은 안내용
 * 기준일 스냅샷이고, 확정 조건은 각 기관 공고를 봐야 한다는 문구를 항상 함께 낸다.
 */

import type { Application, DataConnection, Fund, Restaurant } from './types.ts'

export const knowledgeAsOf = '2026-08'

export type SupportProgram = {
  id: string
  /** 화면·답변에 그대로 쓰는 제도 이름. */
  name: string
  category: '정책자금' | '보증' | '세제' | '공제·보험' | '재기지원' | '교육·컨설팅' | '판로·디지털' | '상권정보'
  agency: string
  summary: string
  /** 대상 조건. AI가 "사장님은 해당될 수 있어요"를 말할 때 쓴다. */
  eligibility: string
  benefit: string
  /** 신청 창구. */
  channel: string
  /** 이 제도를 떠올리게 하는 질문 키워드. */
  keywords: string[]
  caution?: string
}

export const supportPrograms: SupportProgram[] = [
  {
    id: 'program:policy-fund',
    name: '소상공인 정책자금 (일반경영안정자금)',
    category: '정책자금',
    agency: '소상공인시장진흥공단',
    summary: '업력과 신용도 요건을 갖춘 소상공인에게 시중보다 낮은 금리로 운전자금을 빌려주는 대표 제도입니다.',
    eligibility: '상시근로자 5인 미만(제조·건설·운수·광업은 10인 미만) 소상공인. 사업자등록이 되어 있고 휴·폐업 상태가 아니어야 합니다.',
    benefit: '업체당 한도와 금리는 매년 공고로 정해지며, 통상 정책금리에 연동한 변동금리로 운전자금을 지원합니다.',
    channel: '소상공인 정책자금 누리집에서 온라인 신청 후 지역 소진공 센터에서 상담·서류 확인',
    keywords: ['정책자금', '대출', '자금', '운전자금', '저금리', '소진공', '소상공인정책자금'],
    caution: '연간 예산 소진 시 접수가 조기 마감될 수 있고, 세금 체납이나 금융기관 연체가 있으면 제한됩니다.',
  },
  {
    id: 'program:credit-guarantee',
    name: '지역신용보증재단 보증서 대출',
    category: '보증',
    agency: '지역신용보증재단 (신용보증재단중앙회)',
    summary: '담보가 부족한 소상공인 대신 보증서를 발급해 은행 대출을 받을 수 있게 해주는 제도입니다.',
    eligibility: '사업장이 있는 지역의 재단에 신청. 업종별 제한 업종(사행성·유흥 등)은 제외됩니다.',
    benefit: '보증비율 범위 안에서 은행 대출이 가능하고, 보증료가 별도로 붙습니다.',
    channel: '사업장 소재지 지역신용보증재단 또는 협약 은행 창구',
    keywords: ['보증', '보증서', '신보', '지역신용보증재단', '담보없이', '담보'],
    caution: '보증료와 대출이자가 별도입니다. 기존 보증 잔액이 많으면 추가 보증이 어려울 수 있습니다.',
  },
  {
    id: 'program:noranumbrella',
    name: '노란우산공제',
    category: '공제·보험',
    agency: '중소기업중앙회',
    summary: '폐업·노령 등에 대비해 사업주가 매달 적립하는 공제로, 압류가 금지되고 소득공제 혜택이 있습니다.',
    eligibility: '소기업·소상공인 대표자. 업종별 매출액 기준을 충족해야 합니다.',
    benefit: '납입부금에 대한 소득공제와 폐업 시 공제금 지급. 적립금은 법률상 압류가 제한됩니다.',
    channel: '중소기업중앙회 노란우산 홈페이지 또는 협약 은행',
    keywords: ['노란우산', '공제', '퇴직금', '소득공제', '폐업대비'],
  },
  {
    id: 'program:tax-vat',
    name: '부가가치세 간이과세·신용카드 매출세액공제',
    category: '세제',
    agency: '국세청',
    summary: '연 매출 규모에 따라 간이과세를 적용받거나, 카드·현금영수증 매출에 대해 세액공제를 받을 수 있습니다.',
    eligibility: '직전 연도 공급대가 기준을 충족하는 개인사업자. 음식점업은 별도 의제매입세액공제도 함께 봅니다.',
    benefit: '세율·납부의무 경감과 카드매출 세액공제. 음식점은 농수산물 의제매입세액공제 적용 가능.',
    channel: '홈택스 신고 또는 세무대리인',
    keywords: ['부가세', '세금', '간이과세', '세액공제', '홈택스', '의제매입'],
    caution: '매출 규모가 기준을 넘으면 일반과세로 전환됩니다. 적용 여부는 신고 전에 확인해야 합니다.',
  },
  {
    id: 'program:duruforall',
    name: '두루누리 사회보험료 지원',
    category: '공제·보험',
    agency: '근로복지공단 · 국민연금공단',
    summary: '소규모 사업장의 저임금 근로자와 사업주가 부담하는 고용보험·국민연금 보험료 일부를 지원합니다.',
    eligibility: '근로자 수와 월 보수 기준을 모두 충족하는 사업장. 신규 가입 근로자 중심으로 지원됩니다.',
    benefit: '보험료의 일정 비율을 사업주·근로자 몫으로 나누어 지원',
    channel: '4대사회보험 정보연계센터 또는 근로복지공단',
    keywords: ['사회보험', '고용보험', '국민연금', '두루누리', '직원', '인건비'],
  },
  {
    id: 'program:hope-return',
    name: '희망리턴패키지 (재기지원)',
    category: '재기지원',
    agency: '소상공인시장진흥공단',
    summary: '폐업을 준비하거나 이미 폐업한 소상공인의 사업정리·재취업·재창업을 단계별로 돕는 프로그램입니다.',
    eligibility: '폐업 예정이거나 폐업한 소상공인',
    benefit: '사업정리 컨설팅과 점포 원상복구비, 재취업·재창업 교육과 수당',
    channel: '소상공인 지원포털 또는 지역 소진공 센터',
    keywords: ['폐업', '재기', '희망리턴', '정리', '재창업', '문닫'],
    caution: '폐업 신고 전후 신청 시점에 따라 받을 수 있는 항목이 달라집니다.',
  },
  {
    id: 'program:consulting',
    name: '소상공인 역량강화 교육·컨설팅',
    category: '교육·컨설팅',
    agency: '소상공인시장진흥공단 · 지자체',
    summary: '경영·세무·마케팅·위생 등 실무 교육과 전문가 현장 컨설팅을 저렴하거나 무료로 제공합니다.',
    eligibility: '사업자등록을 마친 소상공인',
    benefit: '분야별 전문가 컨설팅과 온라인 교육 수강',
    channel: '소상공인 지식배움터 및 지역 센터',
    keywords: ['교육', '컨설팅', '배우', '강의', '전문가'],
  },
  {
    id: 'program:online-channel',
    name: '온라인 판로·스마트상점 지원',
    category: '판로·디지털',
    agency: '소상공인시장진흥공단',
    summary: '온라인몰 입점, 라이브커머스, 키오스크·테이블오더 같은 스마트 기술 도입 비용을 지원합니다.',
    eligibility: '오프라인 매장을 운영하는 소상공인. 지원 항목별로 자부담 비율이 있습니다.',
    benefit: '기술 도입비 일부 지원과 온라인 채널 입점·콘텐츠 제작 지원',
    channel: '소상공인 지원포털 공고별 접수',
    keywords: ['온라인', '배달', '스마트상점', '키오스크', '판로', '마케팅', '홍보'],
  },
  {
    id: 'program:commercial-data',
    name: '상권정보시스템',
    category: '상권정보',
    agency: '소상공인시장진흥공단',
    summary: '업종별 점포 수, 매출 추정, 유동인구, 임대 시세를 지도 위에서 무료로 확인할 수 있는 공공 서비스입니다.',
    eligibility: '누구나 무료 이용',
    benefit: '창업·업종 전환 전 상권 분석 보고서를 직접 뽑아볼 수 있습니다.',
    channel: '상권정보시스템 웹사이트',
    keywords: ['상권', '유동인구', '입지', '경쟁', '점포수', '창업'],
    caution: '추정 매출은 카드사 표본 기반 추정치라 실제 매출과 차이가 있을 수 있습니다.',
  },
  {
    id: 'program:card-fee',
    name: '영세·중소가맹점 카드수수료 우대',
    category: '세제',
    agency: '금융위원회 · 여신금융협회',
    summary: '연 매출 구간에 따라 카드 가맹점 수수료율을 우대 적용받습니다.',
    eligibility: '연 매출액이 우대 구간에 해당하는 가맹점. 국세청 매출자료로 매년 재산정됩니다.',
    benefit: '구간별 우대 수수료율 적용과 초과 납부분 환급',
    channel: '여신금융협회 조회 후 카드사 자동 적용',
    keywords: ['카드수수료', '수수료', '가맹점', '결제', '우대'],
  },
]

const squash = (value: string) => value.replace(/\s+/g, '').toLocaleLowerCase('ko')

/** 질문에 걸리는 지원제도를 점수순으로 찾는다. */
export function matchSupportPrograms(question: string, limit = 3) {
  const text = squash(question)
  const scored = supportPrograms.map((program) => {
    let score = 0
    for (const keyword of program.keywords) if (text.includes(squash(keyword))) score += 3
    if (text.includes(squash(program.category))) score += 2
    if (text.includes(squash(program.name))) score += 5
    return { program, score }
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((item) => item.program)
}

/**
 * 제도 이름 없이 "정부 지원 뭐 있어?"라고만 물었을 때 쓰는 대표 제도.
 * 매칭이 비었다고 근거 없이 두면 상담이 "알려줄 수 없다"로 끝나버린다.
 */
export function defaultSupportPrograms(limit = 3) {
  return supportPrograms.slice(0, limit)
}

/** 지원제도를 묻는 질문인지 판별한다. */
export function isSupportQuestion(question: string) {
  const text = squash(question)
  return /(지원|정책자금|보조금|보증|공제|세금|세액|절세|폐업|재기|융자|대출|컨설팅|교육|수수료|상권정보|정부|국가|공공|지자체|소진공)/.test(text)
}

/** 외부 AI 없이도 지원제도를 안내하는 로컬 답변. */
export function answerSupportQuestion(question: string) {
  const matched = matchSupportPrograms(question, 2)
  if (!matched.length) return ''
  const lines = matched.map((program) => [
    `· ${program.name} (${program.agency})`,
    `  ${program.summary}`,
    `  대상: ${program.eligibility}`,
    `  신청: ${program.channel}`,
    ...(program.caution ? [`  유의: ${program.caution}`] : []),
  ].join('\n'))
  return [
    '사장님이 확인해볼 만한 지원제도예요.',
    '',
    ...lines,
    '',
    `※ ${knowledgeAsOf} 기준 안내이고, 금액·금리·기간은 해마다 공고로 바뀝니다. 신청 전에 각 기관 공고를 꼭 확인해주세요.`,
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* 사장님 개인 실시간 상황                                             */
/* ------------------------------------------------------------------ */

export type ReviewStage = { id: string; order: number; label: string; done: string }

/** 심사 진행 단계. 사장님에게 "지금 몇 번째"를 보여주기 위한 순서값. */
export const reviewStages: ReviewStage[] = [
  { id: 'stage:identity', order: 1, label: '대표자·사업체 확인', done: '사업자등록번호와 대표자 본인인증이 끝났어요.' },
  { id: 'stage:evidence', order: 2, label: '자료 제출', done: '필수 자료 4종(사업자등록·영업신고·POS·사업계좌)이 모두 들어왔어요.' },
  { id: 'stage:crosscheck', order: 3, label: '자료 대조', done: '제출 자료끼리 값이 서로 맞는지 확인을 마쳤어요.' },
  { id: 'stage:scoring', order: 4, label: '성장성 예비평가', done: '매출·현금흐름·상권을 반영한 예비 점수가 나왔어요.' },
  { id: 'stage:admin', order: 5, label: '운영자 확인', done: '운영자가 원본을 확인하는 단계예요.' },
  { id: 'stage:open', order: 6, label: '모집 공개', done: '투자자에게 공개돼 모금이 진행 중이에요.' },
]

const requiredSourceLabels: Record<string, string> = {
  business: '사업자등록 자료',
  license: '영업신고 자료',
  pos: 'POS 매출 원자료',
  account: '사업용 계좌 거래내역',
}

const optionalSourceLabels: Record<string, string> = {
  card: '카드·정산 자료',
  delivery: '배달 플랫폼 자료',
  tax: '홈택스 신고자료',
  customer: '재방문 산정자료',
  lease: '임대차계약서',
  debt: '대출·상환 증빙',
  staff: '직원·급여 증빙',
}

export type OwnerSituation = ReturnType<typeof ownerSituation>

/**
 * 사장님의 지금 상태를 한 덩어리로 만든다.
 * 심사 신청 전이면 "무엇부터 하면 되는지", 신청 뒤면 "어디까지 갔고 뭐가 비었는지"를 담는다.
 */
export function ownerSituation(input: {
  application?: Application
  connections?: DataConnection[]
  restaurant?: Restaurant
  fund?: Fund
}) {
  const { application, connections = [], restaurant, fund } = input
  const connectedFromApplication = Array.isArray(application?.data?.connectedSources)
    ? (application!.data!.connectedSources as unknown[]).map(String)
    : []
  const connectedFromPartner = connections.filter((item) => item.status === 'active').map((item) => item.sourceId as string)
  const connected = [...new Set([...connectedFromApplication, ...connectedFromPartner])]

  const missingRequired = Object.keys(requiredSourceLabels).filter((source) => !connected.includes(source))
  const missingOptional = Object.keys(optionalSourceLabels).filter((source) => !connected.includes(source))
  const verification = application?.data?.financialVerification as Record<string, any> | undefined
  const mismatches: string[] = Array.isArray(verification?.mismatches) ? verification!.mismatches.map(String) : []

  // 지금 단계 판정. 뒤에서부터 만족하는 첫 단계를 현재 단계로 본다.
  let currentStage = reviewStages[0]
  if (application) {
    currentStage = reviewStages[2]
    if (application.status === 'approved' || application.status === 'conditional') currentStage = reviewStages[4]
    else if (application.status === 'manual_review') currentStage = reviewStages[4]
    else currentStage = reviewStages[3]
  }
  // 펀드가 열려 있다고 해서 심사가 끝난 건 아니다. 예전에는 신청 여부와 무관하게
  // 6단계로 덮어써서 "아직 신청 전인데 6단계 중 6단계"라는 자기모순이 나왔다.
  const fundIsPublic = Boolean(fund && fund.status !== 'closed')
  const approved = application?.status === 'approved' || application?.status === 'conditional'
  if (fundIsPublic && approved) currentStage = reviewStages[5]
  else if (!application && connected.length) currentStage = reviewStages[1]

  const statusLabel = !application ? '아직 심사 신청 전'
    : application.status === 'approved' ? '펀딩 가능 (승인)'
      : application.status === 'conditional' ? '조건부 승인'
        : application.status === 'manual_review' ? '운영자 확인 중'
          : '보완 후 재신청 필요'

  // 다음에 할 일. 가장 효과가 큰 것부터 최대 4개.
  const nextActions: string[] = []
  if (!application) {
    if (missingRequired.length) nextActions.push(`필수 자료 중 ${missingRequired.map((s) => requiredSourceLabels[s]).join(', ')}이(가) 아직 없어요. 사장님 센터에서 올리거나 기관 연결로 채워주세요.`)
    else nextActions.push('필수 자료가 다 모였어요. 사장님 센터에서 “먹투 자동분석 시작”을 눌러 심사를 접수해주세요.')
  } else {
    if (mismatches.length) nextActions.push(`제출 자료 사이에 맞지 않는 값이 ${mismatches.length}건 있어요: ${mismatches.slice(0, 2).join(' / ')}`)
    if (missingRequired.length) nextActions.push(`필수 자료 ${missingRequired.map((s) => requiredSourceLabels[s]).join(', ')}이(가) 비어 있어 자동심사로 넘어가지 못해요.`)
    if (application.status === 'conditional') nextActions.push('조건부 승인이라 한도가 낮게 잡혔어요. 홈택스·대출 자료를 추가하면 한도 재산정을 요청할 수 있어요.')
    if (application.status === 'manual_review') nextActions.push('운영자가 원본을 확인하는 중이에요. 추가 자료를 올려두면 확인이 빨라집니다.')
    if (missingOptional.length >= 4) nextActions.push(`선택 자료(${missingOptional.slice(0, 3).map((s) => optionalSourceLabels[s]).join(', ')} 등)를 더 연결하면 데이터 신뢰도가 올라가 점수에 반영돼요.`)
  }
  if (restaurant && restaurant.salesDisclosure === false) nextActions.push('월매출을 공개로 바꾸면 투자자에게 보이는 근거가 늘어나 모집 속도에 도움이 돼요.')
  if (!nextActions.length) nextActions.push('지금 당장 채워야 할 항목은 없어요. 연결한 자료의 최신성만 유지해주세요.')

  return {
    hasApplication: Boolean(application),
    statusLabel,
    score: application?.score ?? null,
    approvedLimit: application?.approvedLimit ?? null,
    requestedLimit: application?.requestedLimit ?? null,
    dataConfidence: Number(application?.data?.dataConfidence) || null,
    currentStage: { order: currentStage.order, label: currentStage.label, total: reviewStages.length },
    /** AI가 숫자를 헷갈리지 않게 완성된 문장으로도 준다. */
    stageLabel: `${reviewStages.length}단계 중 ${currentStage.order}단계 · ${currentStage.label}`,
    connectedSources: connected.map((source) => requiredSourceLabels[source] || optionalSourceLabels[source] || source),
    missingRequired: missingRequired.map((source) => requiredSourceLabels[source]),
    missingOptional: missingOptional.map((source) => optionalSourceLabels[source]),
    mismatches,
    nextActions: nextActions.slice(0, 4),
    fundStatus: fund ? (fund.status === 'funding' ? '모금 중' : fund.status === 'trading' ? '모금 종료·예약 거래 중' : '종료') : null,
    fundProgress: fund && fund.goal ? Number((fund.raised / fund.goal * 100).toFixed(1)) : null,
  }
}

/** 사장님이 "내 심사 어떻게 돼가?"라고 물었는지 판별한다. */
export function isOwnerStatusQuestion(question: string) {
  const text = squash(question)
  const aboutMe = /(내|제|우리|저희)(심사|신청|가게|매장|펀딩|점수|등급|상태|현황|진행)/.test(text)
  const aboutProgress = /(심사|신청|펀딩).*(어떻게|어디까지|진행|현황|상태|됐|되고|남았|부족)/.test(text)
  const aboutMissing = /(뭐가|무엇이|어떤게).*(부족|필요|모자)/.test(text)
  return aboutMe || aboutProgress || aboutMissing
}

/** 외부 AI 없이도 "내 상황"을 설명하는 로컬 답변. */
export function answerOwnerStatusQuestion(situation: OwnerSituation) {
  const head = situation.hasApplication
    ? `지금 사장님 심사는 ${situation.stageLabel} 단계이고, 상태는 ${situation.statusLabel}이에요.`
    : '아직 심사를 접수하지 않으셨어요. 사장님 센터에서 자료를 올리면 바로 예비 결과를 볼 수 있어요.'
  const score = situation.score !== null
    ? `예비 점수는 ${situation.score}점이고 데이터 신뢰도는 ${situation.dataConfidence ?? '-'}%예요.`
    : ''
  const have = situation.connectedSources.length ? `확보된 자료: ${situation.connectedSources.join(', ')}.` : '확보된 자료가 아직 없어요.'
  const lack = situation.missingRequired.length ? `아직 없는 필수 자료: ${situation.missingRequired.join(', ')}.` : '필수 자료는 모두 들어왔어요.'
  const fund = situation.fundStatus ? `펀딩은 ${situation.fundStatus}${situation.fundProgress !== null ? ` (${situation.fundProgress}% 모집)` : ''}이에요.` : ''
  return [head, score, have, lack, fund, '', '다음으로 하면 좋은 일이에요.', ...situation.nextActions.map((item, index) => `${index + 1}. ${item}`)]
    .filter(Boolean).join('\n')
}

/** 지원제도를 그래프 노드로 변환한다. trust.ts의 GraphNode와 같은 형태. */
export function supportProgramNodes(programs: SupportProgram[] = supportPrograms) {
  return programs.map((program) => ({
    id: program.id,
    type: 'SupportProgram',
    label: program.name,
    source: 'PUBLIC_SUPPORT_PROGRAM',
    properties: {
      category: program.category,
      agency: program.agency,
      summary: program.summary,
      eligibility: program.eligibility,
      benefit: program.benefit,
      channel: program.channel,
      asOf: knowledgeAsOf,
      ...(program.caution ? { caution: program.caution } : {}),
    },
  }))
}

/** 사장님 현재 상황을 그래프 노드·엣지로 변환한다. */
export function ownerSituationGraph(situation: OwnerSituation, businessNodeId?: string) {
  const nodes = [
    {
      id: 'owner:situation',
      type: 'OwnerSituation',
      label: `내 심사 현황 · ${situation.statusLabel}`,
      source: 'LIVE_OWNER_STATE',
      properties: {
        stage: situation.stageLabel,
        status: situation.statusLabel,
        ...(situation.score !== null ? { score: situation.score } : {}),
        ...(situation.dataConfidence !== null ? { dataConfidence: situation.dataConfidence } : {}),
        ...(situation.approvedLimit !== null ? { approvedLimit: situation.approvedLimit } : {}),
        connectedSources: situation.connectedSources.join(', ') || '없음',
        missingRequired: situation.missingRequired.join(', ') || '없음',
        missingOptional: situation.missingOptional.join(', ') || '없음',
        mismatchCount: situation.mismatches.length,
        ...(situation.fundStatus ? { fundStatus: situation.fundStatus } : {}),
      },
    },
    {
      id: 'owner:nextActions',
      type: 'NextAction',
      label: '지금 하면 좋은 일',
      source: 'LIVE_OWNER_STATE',
      properties: Object.fromEntries(situation.nextActions.map((action, index) => [`action${index + 1}`, action])),
    },
  ]
  const edges = [{ from: 'owner:situation', relation: 'SUGGESTS', to: 'owner:nextActions' }]
  if (businessNodeId) edges.push({ from: businessNodeId, relation: 'CURRENT_STATE', to: 'owner:situation' })
  return { nodes, edges }
}
