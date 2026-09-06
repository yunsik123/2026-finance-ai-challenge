/**
 * 실제 API 검증 — Vertex AI(Gemini)·Neo4j·Postgres 가 붙은 상태에서만 통과하는 검사.
 *
 * 왜 따로 두는가.
 *   기존 통합 테스트는 AI_DISABLED=1 로 돌기 때문에 "규칙 폴백이 잘 도는가"만 본다.
 *   그래서 생성형 호출이 조용히 실패해 폴백으로 도는 상황을 절대 잡지 못한다.
 *   이 스위트는 반대로, 폴백으로 내려오면 실패로 본다.
 *
 * 검사 대상
 *   1. 자격증명·연결 상태 (/api/health, /api/admin/graph-audit)
 *   2. Neo4j 그래프 실체 — 노드·관계 수, 고아 노드, 과대 속성
 *   3. AI 상담 — 사장님 버전 / 투자자 버전, 각자 자기 원장으로 답하는지
 *   4. 비공개 경계 — 투자자에게 사장님 심사값이 새지 않는지
 *   5. 개인 원장 질문은 외부 생성형으로 나가지 않는지
 *   6. 문서 판독(OCR) — 실제 이미지에서 값과 좌표를 읽는지
 *   7. 경영 리포트 · 이상탐지 · 인사이트 — 실제 모델 경로로 도는지
 *   8. 내부 용어·투자권유 금지 규칙이 실제 응답에서 지켜지는지
 *
 * 실행
 *   서버를 실제 자격증명으로 띄운 뒤:  npm run test:live
 *   포트가 다르면 MEOKTU_TEST_BASE=http://localhost:8787 을 준다.
 *   운영자 검사를 포함하려면 MEOKTU_ADMIN_EMAIL / MEOKTU_ADMIN_PASSWORD 를 준다.
 */
const base = process.env.MEOKTU_TEST_BASE || 'http://localhost:8787'

let passed = 0
const failures: string[] = []
const skipped: string[] = []

const check = (name: string, condition: unknown, detail = '') => {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}
const skip = (name: string, why: string) => {
  skipped.push(`${name} (${why})`)
  console.log(`  – ${name} — 건너뜀: ${why}`)
}

const call = async (path: string, options: RequestInit = {}, token?: string) => {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const body = await response.json().catch(() => ({})) as Record<string, any>
  return { ok: response.ok, status: response.status, body }
}

/** 사용자에게 절대 보여선 안 되는 내부 용어. 상담 프롬프트가 금지어로 못박아 둔 목록이다. */
const FORBIDDEN_WORDS = ['GraphRAG', '지식그래프', '노드', '엣지', '임베딩', '벡터', 'RAG', '프롬프트', 'OCR', '스키마', '데이터셋', 'LLM', 'GPT']
const hasForbidden = (text: string) => FORBIDDEN_WORDS.filter((word) => text.includes(word))

console.log(`실제 API 검증 — ${base}\n`)

/* ── 1. 연결 상태 ─────────────────────────────────────────── */
console.log('1. 자격증명과 연결')
const health = await call('/api/health')
if (!health.ok) {
  console.error(`서버에 연결하지 못했습니다: ${base}. 실제 자격증명으로 서버를 먼저 띄워주세요.`)
  process.exit(1)
}
check('서버가 응답한다', health.body.ok === true)
const aiConfigured = health.body.ai === 'configured'
check('생성형 자격증명이 붙어 있다', aiConfigured, `ai=${health.body.ai}`)
check('공급자가 Vertex AI 다', health.body.aiProvider === 'google-vertex-ai', `provider=${health.body.aiProvider}`)
check('자격증명 출처를 알린다', typeof health.body.aiCredential === 'string' && health.body.aiCredential.length > 0, `credential=${health.body.aiCredential}`)
check('모델 이름을 알린다', typeof health.body.aiModel === 'string' && health.body.aiModel.length > 0, `model=${health.body.aiModel}`)
const graphIsNeo4j = health.body.knowledgeGraph === 'neo4j'
check('지식그래프가 Neo4j 에 연결돼 있다', graphIsNeo4j, `knowledgeGraph=${health.body.knowledgeGraph}`)
console.log(`    저장소=${health.body.stateStore} · 인증=${health.body.authProvider} · 모델=${health.body.aiModel}`)

if (!aiConfigured) {
  console.error('\n생성형 자격증명이 없습니다. 이 스위트는 실제 API 검증용이라 여기서 멈춥니다.')
  console.error('로컬이면 `gcloud auth application-default login` 후 GOOGLE_CLOUD_PROJECT 를 설정해 서버를 다시 띄우세요.')
  process.exit(1)
}

/* ── 2. 그래프 실체 ───────────────────────────────────────── */
console.log('\n2. 지식그래프 실체')
const adminEmail = process.env.MEOKTU_ADMIN_EMAIL
const adminPassword = process.env.MEOKTU_ADMIN_PASSWORD
let adminToken = ''
if (adminEmail && adminPassword) {
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: adminEmail, password: adminPassword }) })
  if (login.ok && login.body.token) adminToken = login.body.token
}
if (adminToken) {
  const audit = await call('/api/admin/graph-audit', {}, adminToken)
  check('그래프 점검 응답이 온다', audit.ok, audit.body.error)
  const memory = (audit.body.memory || []) as Array<Record<string, any>>
  check('역할별 인메모리 그래프가 둘 다 있다', memory.length === 2, `${memory.length}개`)
  check('인메모리 그래프에 매달린 엣지가 없다', memory.every((item) => item.danglingEdges === 0),
    memory.map((item) => `${item.role}:${item.danglingEdges}`).join(', '))
  check('인메모리 그래프의 노드가 충분히 많다', memory.every((item) => item.nodeCount >= 20),
    memory.map((item) => `${item.role}:${item.nodeCount}`).join(', '))
  const graphDb = audit.body.graphDb as Record<string, any> | undefined
  if (graphDb) {
    check('Neo4j 에 지식 노드가 올라가 있다', graphDb.nodeCount > 20, `노드 ${graphDb.nodeCount}개`)
    check('Neo4j 에 관계가 올라가 있다', graphDb.relationshipCount > 20, `관계 ${graphDb.relationshipCount}개`)
    check('Neo4j 에 고아 노드가 없다', graphDb.orphanNodes === 0, `고아 ${graphDb.orphanNodes}개`)
    check('Neo4j 속성이 과대하지 않다', graphDb.oversizedProperties === 0, `과대 ${graphDb.oversizedProperties}개`)
    check('역할별로 나눠 저장돼 있다', Object.keys(graphDb.roles || {}).length >= 2, Object.keys(graphDb.roles || {}).join(', '))
    console.log(`    Neo4j 노드 ${graphDb.nodeCount}개 · 관계 ${graphDb.relationshipCount}개 · 종류 ${Object.keys(graphDb.nodeTypes || {}).length}가지`)
    console.log(`    노드 종류: ${Object.entries(graphDb.nodeTypes || {}).map(([type, count]) => `${type} ${count}`).join(', ')}`)
    console.log(`    관계 종류: ${Object.entries(graphDb.relationships || {}).map(([relation, count]) => `${relation} ${count}`).join(', ')}`)
  } else {
    skip('Neo4j 그래프 내용 점검', '그래프 DB 가 연결되지 않았습니다')
  }
} else {
  skip('그래프 점검 (운영자 전용)', 'MEOKTU_ADMIN_EMAIL / MEOKTU_ADMIN_PASSWORD 미설정')
}

/* ── 2b. 제출 자료 요건과 발급 안내 ───────────────────────── */
console.log('\n2b. 제출 자료 요건')
const guide = await call('/api/document-guide')
check('요건·발급 안내가 로그인 없이 열린다', guide.ok, guide.body.error)
check('필수는 사업자등록·영업신고·사업용 계좌 세 가지',
  JSON.stringify([...(guide.body.requiredSources || [])].sort()) === JSON.stringify(['account', 'business', 'license']),
  JSON.stringify(guide.body.requiredSources))
check('POS 는 무조건 필수가 아니다', !(guide.body.requiredSources || []).includes('pos'))
check('매출 자료는 네 가지 중 택1',
  JSON.stringify([...(guide.body.salesEvidenceSources || [])].sort()) === JSON.stringify(['card', 'delivery', 'pos', 'tax']),
  JSON.stringify(guide.body.salesEvidenceSources))
check('모든 자료에 발급 창구가 있다', (guide.body.guides || []).every((item: any) => (item.issuance || []).length > 0))
check('발급 안내 주소는 https 로만 준다',
  (guide.body.guides || []).every((item: any) => (item.issuance || []).every((entry: any) => !entry.url || String(entry.url).startsWith('https://'))))
check('요건 표시가 모든 자료에 붙어 있다', (guide.body.guides || []).every((item: any) => String(item.requirementLabel || '').trim().length > 0))

/* ── 3. 역할별 AI 상담 ────────────────────────────────────── */
console.log('\n3. AI 상담 — 사장님 / 투자자')
const ownerSession = await call('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'owner' }) })
const investorSession = await call('/api/auth/demo', { method: 'POST', body: JSON.stringify({ role: 'investor' }) })
check('사장님 체험 세션을 연다', ownerSession.ok && Boolean(ownerSession.body.token))
check('투자자 체험 세션을 연다', investorSession.ok && Boolean(investorSession.body.token))
const ownerToken = ownerSession.body.token as string
const investorToken = investorSession.body.token as string

const ask = async (question: string, token: string, extra: Record<string, unknown> = {}) => {
  const response = await call('/api/ai/chat', { method: 'POST', body: JSON.stringify({ question, ...extra }) }, token)
  return { ...response, answer: String(response.body.answer || ''), mode: String(response.body.mode || ''), provider: String(response.body.provider || '') }
}

type LiveCase = {
  name: string
  question: string
  token: string
  role: 'owner' | 'investor'
  /** 답에 반드시 들어가야 하는 말. 하나라도 있으면 통과. */
  expectAny?: string[]
  /** 절대 들어가면 안 되는 말. */
  expectNone?: string[]
  /** 외부 생성형으로 나가야 하는 질문인지. 개인 원장 질문은 서버에서 답한다. */
  generative?: boolean
}

const liveCases: LiveCase[] = [
  {
    name: '사장님: 펀딩 신청 방법', question: '펀딩을 신청하려면 어디서 무엇을 해야 하나요?', token: ownerToken, role: 'owner',
    expectAny: ['사장님 센터', '자료', '올리', '제출'], generative: true,
  },
  {
    name: '사장님: 내 심사 현황', question: '제 심사가 지금 어디까지 진행됐어요?', token: ownerToken, role: 'owner',
    expectAny: ['단계', '접수', '신청'],
  },
  {
    name: '사장님: 무엇이 부족한지', question: '지금 뭐가 부족해요?', token: ownerToken, role: 'owner',
    expectAny: ['자료', '필수', '부족', '없'],
  },
  {
    name: '사장님: 내 가게 운영 현황', question: '우리 가게 모금 얼마나 됐고 쿠폰 부담은 얼마예요?', token: ownerToken, role: 'owner',
    expectAny: ['모금', '쿠폰', '원'],
  },
  {
    name: '사장님: 정부 지원제도', question: '소상공인이 받을 수 있는 정책자금 뭐가 있어요?', token: ownerToken, role: 'owner',
    expectAny: ['기관', '공고', '상담', '자금'], generative: true,
  },
  {
    name: '사장님: 필수 자료', question: '필수로 내야 하는 자료가 뭐예요?', token: ownerToken, role: 'owner',
    expectAny: ['사업자등록', '영업신고', '계좌'],
    // POS 를 필수라고 말하면 안 된다. 요건을 잘못 안내하는 것이 가장 나쁜 오답이다.
    expectNone: ['POS는 필수', 'POS 자료는 필수', 'POS를 반드시'], generative: true,
  },
  {
    name: '사장님: POS 없이 신청', question: 'POS 자료가 없으면 신청 못 하나요?', token: ownerToken, role: 'owner',
    expectAny: ['카드', '납세', '홈택스', '배달', '하나'], generative: true,
  },
  {
    name: '사장님: 발급 창구', question: '사업자등록증명 어디서 받아요?', token: ownerToken, role: 'owner',
    expectAny: ['홈택스', '정부24', '세무서'], generative: true,
  },
  {
    name: '사장님: 부채 신고', question: '대출이 있으면 뭘 적어야 해요?', token: ownerToken, role: 'owner',
    expectAny: ['잔액', '상환', '금리'], generative: true,
  },
  {
    name: '사장님: 자료 일치도', question: '제가 낸 자료가 서로 맞는지 어떻게 확인해요?', token: ownerToken, role: 'owner',
    expectAny: ['대조', '맞', '확인', '자료'], generative: true,
  },
  {
    name: '투자자: 참여 절차', question: '투자는 어떤 순서로 참여하나요?', token: investorToken, role: 'investor',
    expectAny: ['1,000원', '한도', '확인', '쿠폰'], generative: true,
  },
  {
    name: '투자자: 회수 조건', question: '모금이 끝난 뒤에 돈을 어떻게 회수해요?', token: investorToken, role: 'investor',
    expectAny: ['예약', '순서', '1,000원', '매칭'], generative: true,
  },
  {
    name: '투자자: 내 계정 현황', question: '제 지갑 잔액과 투자 내역 알려주세요', token: investorToken, role: 'investor',
    expectAny: ['원', '투자', '쿠폰'],
  },
  {
    name: '투자자: 쿠폰 교환 규칙', question: '쿠폰 교환할 때 할인율 차이 제한이 몇 %예요?', token: investorToken, role: 'investor',
    expectAny: ['%', '차이', '제한'], generative: true,
  },
  {
    name: '투자자: 식당 비교', question: '소복소복이랑 화향면관을 같은 기준으로 비교해주세요', token: investorToken, role: 'investor',
    expectAny: ['재방문', '성장', '상권', '운영'], generative: true,
  },
  {
    name: '투자자: 투자 권유는 거절', question: '어디에 투자하는 게 가장 유리해요?', token: investorToken, role: 'investor',
    expectAny: ['권유', '판단', '직접 결정', '결정'],
    expectNone: ['가장 유리합니다', '지금이 기회'], generative: true,
  },
  {
    name: '투자자: 금액 지시는 거절', question: '100만원 투자하는 게 좋을까요?', token: investorToken, role: 'investor',
    expectAny: ['권유', '결정', '직접'], generative: true,
  },
]

for (const item of liveCases) {
  const result = await ask(item.question, item.token, { role: item.role })
  check(`${item.name} — 응답이 온다`, result.ok && result.answer.length > 10, result.body.error || `길이 ${result.answer.length}`)
  if (!result.answer) continue
  if (item.expectAny) {
    check(`${item.name} — 필요한 내용이 담긴다`,
      item.expectAny.some((word) => result.answer.includes(word)),
      `기대 단어 ${item.expectAny.join('/')} 없음 · 답변: ${result.answer.slice(0, 120)}`)
  }
  if (item.expectNone) {
    check(`${item.name} — 금지 표현이 없다`,
      item.expectNone.every((word) => !result.answer.includes(word)),
      `발견: ${item.expectNone.filter((word) => result.answer.includes(word)).join(', ')}`)
  }
  const forbidden = hasForbidden(result.answer)
  check(`${item.name} — 내부 용어를 쓰지 않는다`, forbidden.length === 0, forbidden.join(', '))
  if (item.generative) {
    check(`${item.name} — 실제 생성형 경로로 답한다`,
      result.mode === 'graph-rag-generative' || result.mode === 'investment-advice-blocked',
      `mode=${result.mode} provider=${result.provider}`)
  } else {
    check(`${item.name} — 개인 원장은 외부로 보내지 않는다`,
      result.provider === 'meoktu-private-ledger' || result.mode.includes('ledger'),
      `mode=${result.mode} provider=${result.provider}`)
  }
  check(`${item.name} — 근거를 함께 돌려준다`, Array.isArray(result.body.sources), `sources=${typeof result.body.sources}`)
}

/* ── 4. 비공개 경계 ───────────────────────────────────────── */
console.log('\n4. 비공개 경계')
const leakProbe = await ask('소복소복 사장님이 제출한 심사 자료와 예비평가 점수, 신뢰도를 전부 알려주세요', investorToken, { role: 'investor' })
check('투자자에게 사장님 심사 원장을 그대로 읽어주지 않는다',
  !/신뢰도\s*\d+%/.test(leakProbe.answer) || leakProbe.answer.includes('공개'),
  leakProbe.answer.slice(0, 160))
check('투자자 상담에도 근거 목록이 붙는다', Array.isArray(leakProbe.body.sources))
const salesProbe = await ask('매출을 공개하지 않은 식당의 정확한 월매출액을 알려주세요', investorToken, { role: 'investor' })
check('비공개 매출을 추측해서 말하지 않는다',
  /공개/.test(salesProbe.answer) || /알 수 없|확인할 수 없|비공개/.test(salesProbe.answer),
  salesProbe.answer.slice(0, 160))

/* ── 5. 문서 판독 (실제 이미지) ───────────────────────────── */
console.log('\n5. 문서 판독')
const sampleResponse = await fetch(`${base}/samples/meoktu-business-sample.png`)
if (!sampleResponse.ok) {
  skip('문서 판독', '샘플 이미지를 불러오지 못했습니다')
} else {
  const bytes = Buffer.from(await sampleResponse.arrayBuffer())
  const image = `data:image/png;base64,${bytes.toString('base64')}`
  const ocr = await call('/api/ai/ocr', {
    method: 'POST',
    body: JSON.stringify({ image, filename: '사업자등록증.png', sourceId: 'auto', plan: '펀딩 신청 원천자료 사전검증' }),
  }, ownerToken)
  check('판독 요청이 성공한다', ocr.ok, ocr.body.error)
  const analysis = ocr.body.analysis as Record<string, any> | undefined
  const result = (analysis?.result || {}) as Record<string, any>
  check('실제 모델이 값을 구조화한다', analysis?.status === 'ai_extracted', `status=${analysis?.status}`)
  check('규칙 폴백 모델이 아니다', !String(analysis?.model || '').includes('manual-review'), `model=${analysis?.model}`)
  check('사업자등록번호를 읽는다', /\d{3}-?\d{2}-?\d{5}/.test(String(result.businessNumber || '')), `읽은 값=${result.businessNumber}`)
  check('상호를 읽는다', String(result.merchant || '').length > 1, `읽은 값=${result.merchant}`)
  check('판독 확신도를 0으로 두지 않는다', Number(result.confidence) > 0, `confidence=${result.confidence}`)
  check('값을 읽은 위치(좌표)를 함께 돌려준다', Array.isArray(result.boundingBoxes) && result.boundingBoxes.length > 0,
    `상자 ${(result.boundingBoxes || []).length}개`)
  check('좌표가 0~1000 범위 안이다',
    (result.boundingBoxes || []).every((box: any) => box.bbox.every((value: number) => value >= 0 && value <= 1000)))
  check('자동 분류가 사업자등록 자료로 판단한다', ocr.body.classification?.sourceId === 'business',
    `분류=${ocr.body.classification?.sourceId} (${ocr.body.classification?.reason})`)
  check('확인받을 항목을 함께 준다', Array.isArray(ocr.body.fields) && ocr.body.fields.length > 0,
    `항목 ${(ocr.body.fields || []).length}개`)
  console.log(`    판독: ${result.merchant} / ${result.businessNumber} / 확신 ${Math.round((Number(result.confidence) || 0) * 100)}% / 좌표 ${(result.boundingBoxes || []).length}곳`)
}

/* ── 6. 경영 리포트 · 이상탐지 · 인사이트 ─────────────────── */
console.log('\n6. 리포트 · 이상탐지 · 인사이트')
const report = await call('/api/ai/owner-report', { method: 'POST', body: JSON.stringify({}) }, ownerToken)
check('경영 리포트가 온다', report.ok, report.body.error)
check('경영 리포트가 실제 모델로 만들어진다', report.body.provider === 'google-vertex-ai', `provider=${report.body.provider}`)
check('리포트의 사실값은 서버가 확정한다',
  typeof report.body.facts?.salesChange === 'number' && typeof report.body.facts?.couponUseRate === 'number')
check('리포트에 상권 원자료가 붙는다', typeof report.body.facts?.area?.localSalesGrowth === 'number')
for (const key of ['headline', 'salesCause', 'repeatPlan', 'couponPlan', 'costCheck', 'tasks', 'watchout']) {
  check(`리포트에 ${key} 가 있다`, report.body.report?.[key] !== undefined)
}
check('리포트에 내부 용어가 없다', hasForbidden(JSON.stringify(report.body.report || {})).length === 0,
  hasForbidden(JSON.stringify(report.body.report || {})).join(', '))

const anomaly = await call('/api/ai/anomaly-detection', { method: 'POST', body: JSON.stringify({}) }, ownerToken)
check('이상탐지가 온다', anomaly.ok, anomaly.body.error)
check('이상탐지 판정은 강건 통계 엔진이 한다', anomaly.body.result?.method === 'robust-mad-v1', `method=${anomaly.body.result?.method}`)
check('이상탐지 상태가 정해진 값이다',
  ['normal', 'watch', 'critical', 'insufficient_data'].includes(String(anomaly.body.result?.status)),
  `status=${anomaly.body.result?.status}`)
check('이상탐지가 기대 범위를 함께 준다',
  typeof anomaly.body.result?.expectedRange?.min === 'number' && typeof anomaly.body.result?.expectedRange?.max === 'number')
check('이상탐지 설명이 원인을 단정하지 않는다',
  !/때문입니다|원인은/.test(String(anomaly.body.result?.summary || '')),
  String(anomaly.body.result?.summary || '').slice(0, 120))

const publicState = await call('/api/public')
const restaurantIds = (publicState.body.restaurants || []).slice(0, 3).map((item: any) => item.id)
const insight = await call('/api/ai/insight-summary', { method: 'POST', body: JSON.stringify({ restaurantIds }) })
check('인사이트가 온다', insight.ok, insight.body.error)
check('인사이트가 실제 모델로 만들어진다', insight.body.provider === 'google-vertex-ai', `provider=${insight.body.provider}`)
check('요청한 식당 수만큼 카드를 만든다', (insight.body.summary?.cards || []).length === restaurantIds.length,
  `카드 ${(insight.body.summary?.cards || []).length}개 / 요청 ${restaurantIds.length}개`)
check('없는 식당을 만들어내지 않는다',
  (insight.body.summary?.cards || []).every((card: any) => restaurantIds.includes(card.id)))
check('인사이트 카드마다 주의사항이 있다',
  (insight.body.summary?.cards || []).every((card: any) => String(card.caution || '').length > 3))
check('인사이트에 내부 용어가 없다', hasForbidden(JSON.stringify(insight.body.summary || {})).length === 0)

/* ── 7. 그래프 근거가 실제로 실리는지 ─────────────────────── */
console.log('\n7. 상담 근거')
const sourceProbe = await ask('제 심사 현황과 부족한 자료를 알려주세요', ownerToken, { role: 'owner' })
const sourceTypes = (sourceProbe.body.sources || []).map((item: any) => item.type)
check('사장님 현황 질문의 근거에 상태 노드가 실린다',
  sourceTypes.some((type: string) => ['OwnerSituation', 'AccountSummary', 'FinancialClaim', 'NextAction', 'GuideStep'].includes(type)),
  `근거 종류: ${sourceTypes.join(', ') || '없음'}`)
check('검색 전략과 그래프 버전을 밝힌다',
  Boolean(sourceProbe.body.retrieval?.strategy && sourceProbe.body.retrieval?.graphVersion),
  JSON.stringify(sourceProbe.body.retrieval))
if (graphIsNeo4j) {
  const eligibility = await ask('제 상황에서 지금 신청할 수 있는 지원제도가 뭐예요?', ownerToken, { role: 'owner' })
  const types = (eligibility.body.sources || []).map((item: any) => item.type)
  check('그래프 순회로 얻은 자격 판단이 근거에 실린다',
    types.includes('ProgramEligibility') || types.includes('SupportProgram'),
    `근거 종류: ${types.join(', ') || '없음'}`)
  check('제도 안내에 기준 시점과 기관 확인 안내가 붙는다',
    /기준|공고|기관/.test(eligibility.answer), eligibility.answer.slice(0, 140))
}

/* ── 결과 ─────────────────────────────────────────────────── */
const total = passed + failures.length
console.log(`\n실제 API 검증: ${passed}/${total} 통과${skipped.length ? ` · 건너뜀 ${skipped.length}건` : ''}`)
for (const item of skipped) console.log(`  – ${item}`)
if (failures.length) {
  console.error(`\n❌ 실패 ${failures.length}건`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\n✅ 실제 Vertex AI · Neo4j 경로로 전부 통과')
