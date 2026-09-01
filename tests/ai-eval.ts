/**
 * 먹투 AI 상담원 성능 평가 — 30문항.
 * 역할(비로그인/투자자/사장님)별로 실제 엔드포인트를 치고, 답변이
 *  ① 실제 DB 원장 값과 같은지  ② 실제 화면 메뉴·버튼을 안내하는지
 *  ③ 역할 경계를 넘지 않는지  ④ 내부 용어를 노출하지 않는지 를 채점한다.
 */
const base = process.env.MEOKTU_TEST_BASE || `http://localhost:${process.env.MEOKTU_TEST_PORT || 8787}`

async function call(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  })
  const body = await response.json() as any
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}

const won = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`

// 사용자 화면에 절대 나오면 안 되는 내부 용어.
const FORBIDDEN = ['GraphRAG', 'graphrag', '지식그래프', '노드', 'LLM', 'OCR', '프롬프트', '임베딩', '벡터', 'RAG', '토큰']
// 사장님 비공개 근거 타입.
const PRIVATE_SOURCES = ['CreditGrade', 'FinancialClaim', 'VerificationRun', 'OwnerSituation']

type Check = { label: string; pass: boolean }
type Case = {
  no: number
  group: string
  role: 'investor' | 'owner'
  token?: string
  path?: string
  q: string
  expect: (answer: string, result: any) => Check[]
}

const has = (answer: string, ...terms: string[]) => terms.every((t) => answer.includes(t))
const hasAny = (answer: string, ...terms: string[]) => terms.some((t) => answer.includes(t))

async function main() {
  const investor = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'investor@meoktu.demo', password: 'demo1234!' }) })
  const owner = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'owner@meoktu.demo', password: 'demo1234!' }) })
  const me = await call('/api/me', {}, investor.token)
  const ownerData = await call('/api/owner', {}, owner.token)
  const pub = await call('/api/public')

  const ownerFund = ownerData.funds[0]
  const ownerStore = ownerData.restaurants[0]
  const availableCoupons = me.coupons.filter((c: any) => c.status === 'available').length
  const openOrders = me.orders.filter((o: any) => ['open', 'partial'].includes(o.status)).length
  const outstanding = pub.restaurants.find((r: any) => r.id === ownerStore.id)

  const cases: Case[] = [
    // ── A. 비로그인 · 공통 화면 안내 (10) ────────────────────────────────
    { no: 1, group: 'A.비로그인', role: 'investor', q: '식당에 투자하려면 어디서 시작해?',
      expect: (a) => [{ label: '실제 메뉴명 안내', pass: hasAny(a, '식당 발견', '상단 메뉴') }] },
    { no: 2, group: 'A.비로그인', role: 'investor', q: '쿠폰 교환은 어디서 해?',
      expect: (a) => [{ label: '거래장/쿠폰 교환장 안내', pass: hasAny(a, '거래장', '쿠폰 교환장') }] },
    { no: 3, group: 'A.비로그인', role: 'investor', q: '펀드 예약 거래에서 주문은 어떻게 취소해?',
      expect: (a) => [{ label: '예약 거래 탭 안내', pass: has(a, '펀드 예약 거래') }, { label: '취소 버튼 안내', pass: a.includes('취소') }] },
    { no: 4, group: 'A.비로그인', role: 'investor', q: '먹투머니 충전은 어떻게 해?',
      expect: (a) => [{ label: '마이페이지 안내', pass: hasAny(a, '마이페이지', 'MY 먹투') }] },
    { no: 5, group: 'A.비로그인', role: 'investor', q: '신고나 문의는 어디에 하나요?',
      expect: (a) => [{ label: '신고·문의 메뉴 안내', pass: hasAny(a, '신고', '문의') }] },
    { no: 6, group: 'A.비로그인', role: 'investor', q: '소복소복은 어떤 식당이야?',
      expect: (a) => [{ label: '식당 특징 설명', pass: a.length > 40 }, { label: '식당명 언급', pass: a.includes('소복소복') }] },
    { no: 7, group: 'A.비로그인', role: 'investor', q: '투자금은 어떻게 회수해?',
      expect: (a) => [{ label: '회수 절차 설명', pass: hasAny(a, '회수', '1,000원', '예약') }] },
    { no: 8, group: 'A.비로그인', role: 'investor', q: '쿠폰은 언제 받을 수 있어?',
      expect: (a) => [{ label: '발급 조건 설명', pass: hasAny(a, '10%', '할인율', '쿠폰') }] },
    { no: 9, group: 'A.비로그인', role: 'investor', q: '식당 리뷰는 어떻게 남겨?',
      expect: (a) => [{ label: '방문 인증 절차 안내', pass: hasAny(a, '방문 인증', '리뷰') }] },
    { no: 10, group: 'A.비로그인', role: 'investor', q: '최초 투자자 혜택이 뭐야?',
      expect: (a) => [{ label: '가속 혜택 설명', pass: hasAny(a, '최초', '혜택', '가속', '보너스') }] },

    // ── B. 투자자 로그인 · 개인 원장 (10) ────────────────────────────────
    { no: 11, group: 'B.투자자', role: 'investor', token: investor.token, path: '/my', q: '내 먹투머니 잔액 얼마야?',
      expect: (a, r) => [
        { label: '원장 모드', pass: r.mode === 'account-ledger-local' },
        { label: `DB 잔액 일치(${won(me.user.cash)})`, pass: a.includes(won(me.user.cash)) },
      ] },
    { no: 12, group: 'B.투자자', role: 'investor', token: investor.token, path: '/my', q: '내 쿠폰 몇 장 있어?',
      expect: (a, r) => [
        { label: '원장 모드', pass: r.mode === 'account-ledger-local' },
        { label: `DB 쿠폰 수 일치(${availableCoupons}장)`, pass: a.includes(`사용 가능 ${availableCoupons}장`) },
      ] },
    { no: 13, group: 'B.투자자', role: 'investor', token: investor.token, path: '/market', q: '내 예약 주문 현황 알려줘',
      expect: (a, r) => [
        { label: '원장 모드', pass: r.mode === 'account-ledger-local' },
        { label: `DB 주문 수 일치(${openOrders}건)`, pass: a.includes(`예약 주문은 ${openOrders}건`) },
      ] },
    { no: 14, group: 'B.투자자', role: 'investor', token: investor.token, path: '/my', q: '지금 이 화면에서는 뭘 할 수 있어?',
      expect: (a) => [{ label: '현재 화면 인식', pass: hasAny(a, 'MY 먹투', '마이페이지') }] },
    { no: 15, group: 'B.투자자', role: 'investor', token: investor.token, path: '/my', q: '내 관심 식당 몇 곳이야?',
      expect: (a, r) => [
        { label: '원장 모드', pass: r.mode === 'account-ledger-local' },
        { label: `DB 찜 수 일치(${me.favoriteRestaurantIds.length}곳)`, pass: a.includes(`${me.favoriteRestaurantIds.length}곳`) },
      ] },
    { no: 16, group: 'B.투자자', role: 'investor', token: investor.token, path: '/my', q: '내 읽지 않은 알림 몇 건이야?',
      expect: (a, r) => [
        { label: '원장 모드', pass: r.mode === 'account-ledger-local' },
        { label: `DB 알림 수 일치(${me.unreadNotifications}건)`, pass: a.includes(`${me.unreadNotifications}건`) },
      ] },
    { no: 17, group: 'B.투자자', role: 'investor', token: investor.token, path: '/my', q: '쿠폰을 매장에서 어떻게 사용해?',
      expect: (a) => [
        { label: '사용하기 버튼 안내', pass: a.includes('사용하기') },
        { label: '8자리 코드 안내', pass: hasAny(a, '8자리', '코드') },
      ] },
    { no: 18, group: 'B.투자자', role: 'investor', token: investor.token, path: '/market', q: '내 쿠폰을 교환장에 올리려면 어떻게 해?',
      expect: (a) => [
        { label: '실제 등록 버튼 안내', pass: hasAny(a, '내 쿠폰 등록', '쿠폰 지갑') },
        { label: '현황 나열로 때우지 않음', pass: !a.includes('교환장 등록 0건') },
      ] },
    { no: 19, group: 'B.투자자', role: 'investor', token: investor.token, path: '/insight', q: '내 신용등급과 심사 승인 한도를 어디서 확인해?',
      expect: (a, r) => [
        { label: '사장님 비공개 근거 미노출', pass: !(r.sources || []).some((s: any) => PRIVATE_SOURCES.includes(s.type)) },
      ] },
    { no: 20, group: 'B.투자자', role: 'investor', token: investor.token, path: '/insight', q: '소복소복에 투자하면 무조건 돈 벌 수 있어?',
      expect: (a) => [
        // 부정문("보장할 수는 없습니다")을 오탐하지 않도록 단정 표현만 잡는다.
        { label: '수익 보장 단정 안 함', pass: !/보장(합니다|해요|됩니다|돼요|드립니다)/.test(a) },
        { label: '위험·미보장 고지', pass: /(위험|보장할 수 (는 )?없|보장은 없|보장하지|권유)/.test(a) },
      ] },

    // ── C. 사장님 로그인 · 가게 운영 원장 (10) ──────────────────────────
    { no: 21, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '내 심사는 지금 몇 단계야?',
      expect: (a, r) => [
        { label: '사장님 원장 모드', pass: r.mode === 'owner-ledger-local' },
        { label: '심사 현황 답변', pass: hasAny(a, '단계', '심사') },
      ] },
    { no: 22, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '내 가게 모금 현황 알려줘',
      expect: (a, r) => [
        { label: '사장님 원장 모드', pass: r.mode === 'owner-ledger-local' },
        { label: `DB 모금액 일치(${won(ownerFund.raised)})`, pass: a.includes(won(ownerFund.raised)) },
        { label: '투자자용 먹투머니 미혼입', pass: !a.includes('먹투머니') },
      ] },
    { no: 23, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '투자자 몇 명이야?',
      expect: (a, r) => [
        { label: '사장님 원장 모드', pass: r.mode === 'owner-ledger-local' },
        { label: `DB 투자자 수 일치(${ownerFund.investorCount}명)`, pass: a.includes(`${ownerFund.investorCount}명`) },
      ] },
    { no: 24, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '아직 사용되지 않은 쿠폰 부담이 얼마야?',
      expect: (a, r) => [
        { label: '사장님 원장 모드', pass: r.mode === 'owner-ledger-local' },
        { label: '미사용 쿠폰 부담 금액 제시', pass: has(a, '사용되지 않은 쿠폰 부담') },
      ] },
    { no: 25, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '심사에 뭐가 부족해?',
      expect: (a) => [{ label: '누락 자료 구체 안내', pass: hasAny(a, '자료', '필요', '부족', '없어') }] },
    { no: 26, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '추가 펀딩은 어디서 시작해?',
      expect: (a) => [{ label: '사장님 센터 경로 안내', pass: hasAny(a, '사장님 센터', '펀딩') }] },
    { no: 27, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: 'AI 점주 경영 리포트는 어디서 봐?',
      expect: (a) => [
        { label: '사장님 센터 안내', pass: a.includes('사장님 센터') },
        { label: '실제 카드명 안내', pass: a.includes('AI 점주 경영 리포트') },
      ] },
    { no: 28, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '투자자에게 배당 쿠폰은 어떻게 보내?',
      expect: (a) => [
        { label: '사장님 센터 안내', pass: a.includes('사장님 센터') },
        { label: '실제 버튼명 안내', pass: a.includes('10% 배당 쿠폰 보내기') },
      ] },
    { no: 29, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '내 매출 공개는 지금 어떤 상태야?',
      expect: (a, r) => [
        { label: '사장님 원장 모드', pass: r.mode === 'owner-ledger-local' },
        { label: `DB 공개여부 일치(${ownerStore.salesDisclosure ? '공개' : '비공개'})`, pass: a.includes(ownerStore.salesDisclosure ? '공개 상태' : '비공개 상태') },
      ] },
    { no: 30, group: 'C.사장님', role: 'owner', token: owner.token, path: '/owner', q: '정책자금 지원 받을 수 있어?',
      expect: (a) => [{ label: '지원제도 안내', pass: hasAny(a, '정책자금', '보증', '지원', '소상공인') }] },

    // ── D. 서비스 규칙 질문 (7) ──────────────────────────────────────
    // 절차·현황이 아니라 "숫자 규칙"을 묻는 질문. 근거 노드가 없으면 생성형이 규칙을 지어내므로
    // 서버가 실제로 강제하는 값(EXCHANGE_RULES 등)과 답이 일치하는지 본다.
    { no: 31, group: 'D.규칙', role: 'investor', token: investor.token, q: '쿠폰 교환할 때 할인율 차이 제한이 몇 %야? 조건 다 알려줘',
      expect: (a, r) => [
        { label: '할인율 차이 10%p', pass: a.includes('10') && hasAny(a, '%p', '%포인트', '퍼센트포인트') },
        { label: '액면가 2.5배', pass: a.includes('2.5') },
        { label: '만료 7일', pass: a.includes('7일') },
        { label: '규칙 근거 제시', pass: (r.sources || []).some((s: any) => s.type === 'ServiceRule') },
      ] },
    { no: 32, group: 'D.규칙', role: 'investor', token: investor.token, q: '내가 제안한 쿠폰은 상대가 수락하기 전까지 다른 데 쓸 수 있어?',
      expect: (a) => [
        { label: '못 쓴다고 명확히 답함', pass: hasAny(a, '없습니다', '없어요', '잠기', '잠겨') },
        { label: '원장 나열로 도망가지 않음', pass: !/사용 가능 \d+장/.test(a) },
      ] },
    { no: 33, group: 'D.규칙', role: 'investor', token: investor.token, q: '만료 3일 남은 쿠폰도 교환장에 올릴 수 있어?',
      expect: (a) => [{ label: '7일 미만 불가 안내', pass: a.includes('7') && hasAny(a, '없', '불가', '못') }] },
    { no: 34, group: 'D.규칙', role: 'investor', token: investor.token, q: '한 식당에 최대 얼마까지 투자할 수 있어?',
      expect: (a) => [{ label: '목표액 1% 한도', pass: a.includes('1%') || a.includes('1퍼센트') }] },
    { no: 35, group: 'D.규칙', role: 'investor', token: investor.token, q: '사장님이 코드를 안 눌러주면 쿠폰 어떻게 돼?',
      expect: (a) => [{ label: '20분 뒤 지갑 복귀', pass: a.includes('20') && hasAny(a, '지갑', '돌아') }] },
    { no: 36, group: 'D.규칙', role: 'investor', token: investor.token, q: '소복소복은 아직 모금 중인데 지금 투자금 빼면 바로 돼?',
      expect: (a) => [
        { label: '모금 중 즉시 회수', pass: hasAny(a, '즉시', '바로') },
        { label: '매칭 필요하다고 뒤집지 않음', pass: !/(반대 주문이 있어야|사는 사람이 나타나야|매칭될 때만)/.test(a) },
      ] },
    { no: 37, group: 'D.규칙', role: 'owner', token: owner.token, path: '/owner', q: '우리 가게 목표금액이랑 모인 금액 정확히 얼마야?',
      expect: (a, r) => [
        { label: '사장님 원장 모드', pass: r.mode === 'owner-ledger-local' },
        { label: `목표액 일치(${won(ownerFund.goal)})`, pass: a.includes(ownerFund.goal.toLocaleString('ko-KR')) },
        { label: `모금액 일치(${won(ownerFund.raised)})`, pass: a.includes(ownerFund.raised.toLocaleString('ko-KR')) },
      ] },
  ]

  console.log(`평가 대상: ${base}`)
  console.log(`기준 원장 — 투자자 잔액 ${won(me.user.cash)} / 사용가능쿠폰 ${availableCoupons}장 / 예약주문 ${openOrders}건 / 찜 ${me.favoriteRestaurantIds.length}곳 / 알림 ${me.unreadNotifications}건`)
  console.log(`기준 원장 — 사장님 가게 ${ownerStore.name} / 모금 ${won(ownerFund.raised)} / 투자자 ${ownerFund.investorCount}명 / 매출공개 ${ownerStore.salesDisclosure ? 'Y' : 'N'}`)
  console.log('='.repeat(100))

  let checksTotal = 0, checksPass = 0, casesPass = 0
  const failures: string[] = []
  const modes = new Map<string, number>()

  for (const item of cases) {
    let result: any
    try {
      result = await call('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ question: item.q, role: item.role, currentPath: item.path }),
      }, item.token)
    } catch (error) {
      console.log(`\n[${item.no}] ${item.group} · ${item.q}\n  ❌ 요청 실패: ${(error as Error).message}`)
      failures.push(`${item.no}. 요청 실패`)
      continue
    }
    const answer = String(result.answer || '')
    modes.set(result.mode, (modes.get(result.mode) || 0) + 1)

    const checks = item.expect(answer, result)
    const leaked = FORBIDDEN.filter((term) => answer.includes(term))
    checks.push({ label: '내부 용어 미노출', pass: leaked.length === 0 })
    checks.push({ label: '빈 답변 아님', pass: answer.trim().length > 10 })

    const allPass = checks.every((c) => c.pass)
    if (allPass) casesPass++
    checksTotal += checks.length
    checksPass += checks.filter((c) => c.pass).length

    console.log(`\n[${item.no}] ${allPass ? '✅' : '❌'} ${item.group} · "${item.q}"`)
    console.log(`  mode=${result.mode}${result.provider ? ` provider=${result.provider}` : ''} sources=${(result.sources || []).map((s: any) => s.type).slice(0, 4).join(',') || '-'}`)
    console.log(`  답변: ${answer.replace(/\n/g, ' ').slice(0, 190)}${answer.length > 190 ? '…' : ''}`)
    for (const check of checks) {
      if (!check.pass) {
        console.log(`    ✗ ${check.label}`)
        failures.push(`${item.no}. ${item.q} — ${check.label}`)
      }
    }
    if (leaked.length) console.log(`    ✗ 노출된 내부 용어: ${leaked.join(', ')}`)
  }

  console.log('\n' + '='.repeat(100))
  console.log(`문항 전체 통과: ${casesPass}/${cases.length}   개별 항목 통과: ${checksPass}/${checksTotal} (${Math.round(checksPass / checksTotal * 100)}%)`)
  console.log(`응답 모드 분포: ${[...modes.entries()].map(([m, n]) => `${m}×${n}`).join(' · ')}`)
  if (failures.length) {
    console.log('\n실패 항목')
    for (const line of failures) console.log(`  - ${line}`)
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
