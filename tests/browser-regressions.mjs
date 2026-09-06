// Real browser regressions against an isolated local ledger. No production credentials or data.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

const root = path.resolve(import.meta.dirname, '..')
const dir = await mkdtemp(path.join(tmpdir(), 'meoktu-browser-'))
const port = Number(process.env.MEOKTU_BROWSER_PORT || 8892)
const base = `http://127.0.0.1:${port}`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (check, label, timeout = 15000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await pause(100)
  }
  throw new Error(`Timed out: ${label}`)
}
let server, chrome, socket
const errors = []
try {
  // Refuse an occupied port instead of modifying another local server's ledger.
  const occupied = await fetch(`${base}/api/health`).then(() => true, () => false)
  assert(!occupied, 'Browser test port is occupied')
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root, stdio: 'ignore', env: { ...process.env, PORT: String(port), STATE_STORE: 'file',
      MEOKTU_DATA_DIR: path.join(dir, 'data'), SUPABASE_AUTH_DISABLED: '1', AI_DISABLED: '1', NEO4J_URI: '' },
  })
  await until(() => fetch(`${base}/api/health`).then(r => r.ok, () => false), 'test server')
  chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-debugging-port=0', `--user-data-dir=${path.join(dir, 'chrome')}`, 'about:blank',
  ], { stdio: 'ignore' })
  let debugPort
  await until(async () => {
    debugPort = await readFile(path.join(dir, 'chrome', 'DevToolsActivePort'), 'utf8').then(s => s.split('\n')[0], () => '')
    return Boolean(debugPort)
  }, 'Chrome debugger')
  const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json())
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
  await once(socket, 'open')
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (!message.id) return
    const entry = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, label) => {
    try { await until(() => evaluate(expression), label) }
    catch (error) { console.error(await evaluate('JSON.stringify({text:document.body.innerText.slice(-1800), fields:[...document.querySelectorAll("input,textarea")].map(e=>({name:e.name,value:e.value,valid:e.validationMessage})), calls:testNetwork.calls})')); throw error }
  }
  const click = async text => {
    assert(await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true })()`), `Button missing: ${text}`)
  }
  const visit = async route => {
    await evaluate('window.__navigating = true')
    await send('Page.navigate', { url: base + route })
    await waitFor('window.__navigating !== true && document.readyState === "complete" && Boolean(document.querySelector(".app-shell"))', route)
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.testNetwork = { failPublic: false, failMe: false, delayMe: false, held: [], calls: [] };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (url === '/api/public' && testNetwork.failPublic) return new Response('<html>gateway error</html>', {status: 502});
      if (url === '/api/me' && testNetwork.failMe) return new Response('{}', {status: 503});
      if (url === '/api/me' && testNetwork.delayMe) {
        const response = await originalFetch(...args);
        return new Promise(resolve => testNetwork.held.push(() => resolve(response)));
      }
      const response = await originalFetch(...args);
      if (url.includes('/support/')) testNetwork.calls.push({url, method:args[1]?.method, body:await response.clone().text()});
      return response;
    };
  ` })
  // Initial HTTP failure must show a usable retry action instead of an endless spinner.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.testNetwork.failPublic = sessionStorage.getItem("fail-start") === "1"' })
  await visit('/')
  await evaluate('sessionStorage.setItem("fail-start", "1")')
  await send('Page.reload')
  await waitFor('document.body.innerText.includes("다시 시도")', 'initial failure recovery')
  await evaluate('testNetwork.failPublic = false; sessionStorage.removeItem("fail-start")')
  await click('다시 시도')
  await waitFor('Boolean(document.querySelector(".app-shell"))', 'retry loaded application')
  console.log('PASS: initial request failure and retry')

  const login = async role => {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${role}@meoktu.demo`, password: 'demo1234!' }) })
    assert(response.ok)
    const { token } = await response.json()
    await evaluate(`localStorage.setItem('meoktu-token', ${JSON.stringify(token)})`)
    await visit(role === 'owner' ? '/owner/my' : '/my')
  }
  await login('investor')
  await evaluate('testNetwork.failMe = true; window.dispatchEvent(new Event("focus"))')
  await waitFor('document.body.innerText.includes("계정 정보를 갱신하지 못했어요")', 'transient account failure')
  assert(await evaluate('Boolean(localStorage.getItem("meoktu-token")) && Boolean(document.querySelector(".wallet-card"))'))
  await evaluate('testNetwork.failMe = false')
  await click('다시 시도')
  await waitFor('!document.body.innerText.includes("계정 정보를 갱신하지 못했어요")', 'account recovery')
  console.log('PASS: transient account failure preserves session and wallet')

  const cashBefore = await evaluate('fetch("/api/me", {headers:{Authorization:"Bearer " + localStorage.getItem("meoktu-token")}}).then(r => r.json()).then(r => r.user.cash)')
  await click('충전하기')
  await click('100,000원 시연용 충전')
  await waitFor('!document.querySelector(".topup-modal")', 'wallet topup')
  const cashAfter = await evaluate('fetch("/api/me", {headers:{Authorization:"Bearer " + localStorage.getItem("meoktu-token")}}).then(r => r.json()).then(r => r.user.cash)')
  assert.equal(cashAfter, cashBefore + 100000)
  await visit('/discover')
  await evaluate('document.querySelector(".restaurant-card").click()')
  await waitFor('Boolean(document.querySelector(".detail-order-panel"))', 'fund detail')
  await evaluate('document.querySelector(".detail-order-panel .button.full.large").click()')
  await waitFor('Boolean(document.querySelector(".trade-confirm .consent-reader-head"))', 'trade confirmation and legal index')
  await evaluate('document.querySelectorAll(".consent-reader-head").forEach(button => button.click())')
  await waitFor('document.querySelectorAll(".consent-reader-agree input").length > 0 && [...document.querySelectorAll(".consent-reader-agree input")].every(input => !input.disabled)', 'investment consent documents')
  await evaluate('document.querySelectorAll(".consent-reader-agree input").forEach(input => input.click()); document.querySelector(".risk-confirm-check input").click()')
  await click('확인하고 투자하기')
  await waitFor('!document.querySelector(".trade-confirm")', 'investment accepted')
  const cashInvested = await evaluate('fetch("/api/me", {headers:{Authorization:"Bearer " + localStorage.getItem("meoktu-token")}}).then(r => r.json()).then(r => r.user.cash)')
  assert.equal(cashInvested, cashAfter - 50000)
  console.log('PASS: wallet topup and consent-based investment update the ledger')

  await visit('/support')
  await evaluate(`document.querySelector('[name=subject]').value = '브라우저 접수 회귀검증'; document.querySelector('textarea[name=description]').value = '실제 폼 제출 후 오류 없이 초기화되는지 검증합니다.'; document.querySelector('.support-form').requestSubmit()`)
  await waitFor('document.querySelector("[name=subject]").value === "" && document.querySelector(".support-history").innerText.includes("브라우저 접수 회귀검증")', 'support submission/reset')
  assert(!await evaluate('document.body.innerText.includes("Cannot read")'))
  console.log('PASS: support submission, history, form reset')

  await evaluate('document.querySelector(".floating-ai-trigger").click()')
  await click('내 쿠폰과 예약 주문 현황 알려줘')
  await waitFor('document.querySelectorAll(".floating-message.ai").length > 1', 'personal AI reply')
  await evaluate('testNetwork.delayMe = true; window.dispatchEvent(new Event("focus"))')
  await waitFor('testNetwork.held.length > 0', 'in-flight authenticated request')
  await evaluate('document.querySelector("[aria-label=로그아웃]").click()')
  await waitFor('Boolean(document.querySelector(".app-shell")) && !localStorage.getItem("meoktu-token")', 'logout')
  await evaluate('testNetwork.delayMe = false; testNetwork.held.forEach(release => release()); testNetwork.held = []')
  await pause(300)
  assert(await evaluate('!document.querySelector("[aria-label=로그아웃]") && !document.querySelector(".floating-ai-panel") && !document.querySelector(".support-item")'))
  console.log('PASS: logout ignores old requests and clears personal AI/support state')
  await evaluate('localStorage.setItem("meoktu-token", "expired-test-session"); window.dispatchEvent(new StorageEvent("storage", {key:"meoktu-token", newValue:"expired-test-session"}))')
  await waitFor('!localStorage.getItem("meoktu-token") && Boolean(document.querySelector(".app-shell"))', 'invalid session cleared after storage event')
  console.log('PASS: cross-tab session changes and invalid authentication recovery')

  for (const route of ['/discover', '/market', '/insight', '/legal', '/legal/privacy', '/support', '/missing-page']) await visit(route)
  await visit('/insight')
  await evaluate('document.querySelectorAll(".compare-selector button")[0].click(); document.querySelectorAll(".compare-selector button")[1].click()')
  await waitFor('Boolean(document.querySelector(".compare-narrative"))', 'AI public comparison')
  await evaluate('document.querySelectorAll(".compare-selector button")[1].click()')
  await waitFor('!document.querySelector(".compare-narrative")', 'comparison cleared when selection removed')
  await login('owner')
  await waitFor('Boolean(document.querySelector(".owner-dashboard"))', 'owner dashboard')
  await waitFor('Boolean(document.querySelector(".report-grid h3"))', 'owner report')
  // 사장님 센터는 세 단계로 넘어간다. 자료 업로드 화면에는 준비 안내와 자료 분류만 남긴다.
  // 단계가 실제로 전환되는지, 필수 자료가 없으면 넘어가지 못하는지,
  // 마지막 단계에서만 제출 버튼이 나오는지까지 실제 브라우저로 확인한다.
  // /owner 로 들어가면 첫 단계 주소로 넘어간다. 단계마다 주소가 실제로 바뀌어야 한다.
  await visit('/owner')
  await waitFor('location.pathname === "/owner/store"', 'owner redirects to first step url')
  await waitFor('document.querySelectorAll(".wizard-rail button").length === 3', 'owner wizard rail')
  await waitFor('Boolean(document.querySelector(".wizard-step.active .identity-action"))', 'wizard starts on store step')
  // 1단계: 아무것도 채우지 않고 다음을 누르면 주소가 바뀌지 않아야 한다.
  await click('다음')
  await waitFor('location.pathname === "/owner/store" && Boolean(document.querySelector(".wizard-step.active .identity-action"))', 'wizard blocks empty store step')
  // 앞 단계를 끝내지 않은 채 뒤 단계 주소를 직접 열면 되돌려보낸다.
  await evaluate('history.pushState({}, "", "/owner/plan"); window.dispatchEvent(new PopStateEvent("popstate"))')
  await waitFor('location.pathname === "/owner/store"', 'direct access to a later step is redirected back')
  // 데모 채우기 버튼은 단계마다 하나씩 있고, 자기 화면의 칸만 채운다.
  // 1단계 버튼은 가게 정보와 대표자 본인인증까지 끝낸다. 예전에는 이 버튼이 2단계에만 있어서,
  // 본인인증을 손으로 마친 사람만 데모를 만날 수 있었다.
  assert(await evaluate('document.querySelectorAll(".step-demo-fill-bar .virtual-data-upload-btn").length === 1'), '1단계에 데모 채우기 버튼이 있어야 합니다')
  await evaluate('document.querySelector(".step-demo-fill-bar .virtual-data-upload-btn").click()')
  await waitFor('Boolean(document.querySelector(".identity-action.verified"))', 'store demo fills fields and verifies identity')
  await waitFor('document.querySelector("[name=restaurantName]").value === "먹투 테스트식당" && document.querySelector("[name=ownerName]").value === "김테스트"', 'store demo fills store fields')
  // 타 페이지까지 채우지 않는다. 1단계 버튼을 눌러도 자료는 하나도 올라가 있으면 안 된다.
  assert(await evaluate('!document.querySelector(".sample-clear")'), '1단계 데모 채우기가 자료 업로드까지 건드리면 안 됩니다')
  await click('다음')
  await waitFor('location.pathname === "/owner/upload" && Boolean(document.querySelector(".wizard-step.active .intake-zone"))', 'store step advances to upload step')
  assert(await evaluate('document.querySelector(".desktop-nav a.active")?.innerText === "사장님 센터"'), '신청 하위 경로에서도 사장님 센터가 활성화되어야 합니다')
  assert(await evaluate('Boolean(document.querySelector(".document-preparation-guide")) && !document.querySelector(".ai-upload-feedback")'), '자료 안내는 보이고 AI 판독 펼쳐보기는 없어야 합니다')
  // 2단계 버튼은 자료 칸과 부채 신고만 채운다.
  assert(await evaluate('document.querySelectorAll(".virtual-data-upload-btn").length === 1'), '2단계 데모 버튼은 하나여야 합니다')
  await evaluate('document.querySelector(".virtual-data-upload-btn").click()')
  await waitFor('document.querySelectorAll(".document-upload-card.uploaded").length === 11', 'sample uploads')
  assert(await evaluate(`(() => {
    const card = [...document.querySelectorAll('.document-upload-card')].find(item => item.innerText.includes('사업용 계좌 내역'))
    const button = card && [...card.querySelectorAll('button')].find(item => item.innerText.includes('올린 자료 열어보기'))
    if (!button) return false
    button.click()
    return true
  })()`), '사업용 계좌 데모 자료 열기 버튼이 있어야 합니다')
  await waitFor('Boolean(document.querySelector(".doc-table"))', 'uploaded table preview')
  await evaluate('document.querySelector(".doc-modal-head button").click()')
  // 만능 업로드함. 어떤 자료인지 고르지 않고 던져도 알맞은 칸에 들어가야 한다.
  // 열 이름이 제각각인 CSV 와, 브라우저에서 그림으로 바꿔야 하는 PDF 를 둘 다 넣어 본다.
  await evaluate('document.querySelector(".sample-clear").click()')
  await waitFor('document.querySelectorAll(".document-upload-card.uploaded").length === 0', 'uploads cleared')
  await evaluate(`(async () => {
    const drop = async (url, name, type) => {
      const blob = await fetch(url).then(r => r.blob())
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], name, { type }))
      document.querySelector('.intake-zone').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    }
    // 열 이름이 '거래일자/판매금액'인 어긋난 POS 자료. 표 머리글만 보고 POS 칸으로 가야 한다.
    await drop('/samples/meoktu-rough-pos-sample.csv', '2026상반기_정산.csv', 'text/csv')
  })()`)
  // 처리 결과 목록을 없앴으므로, 어느 칸에 들어갔는지는 자료 카드로 확인한다.
  await waitFor('document.querySelectorAll(".document-upload-card.uploaded").length === 1', 'universal intake classified a table')
  await waitFor('Boolean([...document.querySelectorAll(".document-upload-card.uploaded")].find(card => card.innerText.includes("POS 매출 원자료")))', 'table routed to POS slot')
  await waitFor('Boolean(document.querySelector(".document-upload-card.uploaded .document-classified"))', 'classification reason shown on card')
  // 엑셀은 브라우저에서 표로 바꿔 넣는다. 은행식 열 이름('맡기신금액')이라도 계좌 칸으로 가야 한다.
  await evaluate(`(async () => {
    const blob = await fetch('/samples/meoktu-account-sample.xlsx').then(r => r.blob())
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], '거래내역조회.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    document.querySelector('.intake-zone').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })()`)
  await waitFor('document.querySelectorAll(".document-upload-card.uploaded").length === 2', 'xlsx intake finished')
  await waitFor('Boolean([...document.querySelectorAll(".document-upload-card.uploaded")].find(card => card.innerText.includes("사업용 계좌 내역") && /\\d,?\\d*행/.test(card.innerText)))', 'xlsx converted to table rows')

  // PDF 는 브라우저에서 첫 장을 그림으로 바꿔 판독 경로로 보낸다. 변환 자체가 도는지 본다.
  await evaluate(`(async () => {
    const blob = await fetch('/samples/meoktu-business-sample.pdf').then(r => r.blob())
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'meoktu-business-sample.pdf', { type: 'application/pdf' }))
    document.querySelector('.intake-zone').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  })()`)
  await waitFor('document.querySelectorAll(".document-upload-card.uploaded").length === 3', 'pdf intake finished')
  await waitFor('Boolean([...document.querySelectorAll(".document-upload-card.uploaded")].find(card => card.innerText.includes("사업자등록 자료")))', 'pdf routed to business slot')
  // 다시 샘플로 채워 필수 자료를 갖춘 뒤 남은 단계를 확인한다.
  await evaluate('document.querySelector(".virtual-data-upload-btn").click()')
  await waitFor('document.querySelectorAll(".document-upload-card.uploaded").length === 11', 'sample uploads restored')

  // 요건 구조: 필수/택1 배지와 발급 안내가 실제로 그려지는지.
  await waitFor('document.querySelectorAll(".document-group").length >= 5', 'requirement groups rendered')
  await waitFor('document.querySelectorAll(".document-upload-card").length === 11', 'every document slot is rendered')
  await waitFor('document.querySelectorAll(".requirement-badge.req-must").length >= 3', 'required badges')
  await waitFor('document.querySelectorAll(".requirement-badge.req-oneof").length >= 4', 'sales one-of badges')
  await waitFor('Boolean(document.querySelector(".sales-evidence-status.ok"))', 'sales evidence satisfied')
  await evaluate('document.querySelectorAll(".issuance-trigger")[0].click()')
  await waitFor('Boolean(document.querySelector(".issuance-dialog a[href^=\'https://\']"))', 'issuance help shows an official link')
  await evaluate('document.querySelector(".issuance-dialog header button").click()')
  await waitFor('!document.querySelector(".issuance-dialog")', 'issuance help closes')
  // 부채는 답을 해야 넘어간다. 샘플이 '대출 있음'으로 채워둔 상태여야 한다.
  await waitFor('Boolean(document.querySelector(".debt-choice button.active"))', 'debt question answered')

  // 부정확했던 문서 판독 상세 UI는 자료 목록에 노출하지 않는다.
  assert(await evaluate('document.querySelector(".ai-upload-feedback") === null'), 'AI 판독 상세 영역이 남아 있습니다')
  assert(await evaluate('document.querySelector(".analysis-row") === null'), 'AI 판독 결과 행이 남아 있습니다')
  assert(await evaluate('document.body.innerText.includes("어떻게 읽었나요?") === false'), '삭제한 판독 상세 문구가 남아 있습니다')

  // 2 → 3단계 전환. 자료가 모두 있으니 넘어가야 한다.
  await click('다음')
  await waitFor('location.pathname === "/owner/plan" && Boolean(document.querySelector(".wizard-step.active .consent-reader-head"))', 'consent step url')
  // 브라우저 뒤로 가기로 앞 단계에 돌아가야 한다. 단계가 진짜 페이지라는 뜻이다.
  await evaluate('history.back()')
  await waitFor('location.pathname === "/owner/upload" && Boolean(document.querySelector(".intake-zone"))', 'browser back returns to upload step')
  await evaluate('history.forward()')
  await waitFor('location.pathname === "/owner/plan"', 'browser forward returns to consent step')
  // 3단계 버튼은 자금 계획만 채운다. 필수 고지 동의는 사장님이 직접 확인해야 하므로 건드리지 않는다.
  assert(await evaluate('document.querySelectorAll(".step-demo-fill-bar .virtual-data-upload-btn").length === 1'), '3단계에 데모 채우기 버튼이 있어야 합니다')
  await evaluate('document.querySelector(".step-demo-fill-bar .virtual-data-upload-btn").click()')
  await waitFor('document.querySelector("[name=fundPurpose]").value.includes("저온 저장고") && document.querySelectorAll(".fund-use-row").length >= 2', 'plan demo fills the funding plan')
  await evaluate('document.querySelectorAll(".consent-reader-head").forEach(button => button.click())')
  await waitFor('[...document.querySelectorAll(".consent-reader-agree input")].length === 3 && [...document.querySelectorAll(".consent-reader-agree input")].every(input => !input.disabled)', 'application consent documents')
  assert(await evaluate('[...document.querySelectorAll(".consent-reader-agree input")].every(input => !input.checked)'), '데모 채우기가 필수 고지 동의까지 체크하면 안 됩니다')
  await evaluate('document.querySelectorAll(".consent-reader-agree input").forEach(input => input.click())')
  // 이전으로 돌아가도 입력이 남아 있어야 한다. 단계 전환으로 값이 사라지면 신청을 다시 써야 한다.
  await evaluate('document.querySelectorAll(".wizard-rail button")[0].click()')
  await waitFor('location.pathname === "/owner/store" && document.querySelector("[name=restaurantName]").value === "먹투 테스트식당"', 'store input survives page change')
  await evaluate('document.querySelectorAll(".wizard-rail button")[2].click()')
  await waitFor('location.pathname === "/owner/plan"', 'rail navigates by url')
  // 자금 사용계획: 합계가 희망 펀딩액과 맞아야 제출된다.
  await waitFor('document.querySelectorAll(".fund-use-row").length >= 2', 'fund use rows')
  await waitFor('Boolean(document.querySelector(".fund-use-total.match"))', 'fund use total matches requested amount')
  await click('먹투 예비평가 시작')
  await waitFor('location.pathname === "/owner/result" && (Boolean(document.querySelector(".source-review-result")) || document.body.innerText.includes("Restaurant Health Profile"))', 'application submitted on result url')
  await waitFor('Boolean(document.querySelector(".result-score-primary"))', 'growth score is prominent')
  assert(await evaluate(`(() => {
    const score = document.querySelector('.result-score-primary')
    const evidence = document.querySelector('.evidence-panel')
    return Boolean(score && evidence && (score.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING))
  })()`), '성장성 예비평가 점수는 자료 근거보다 먼저 보여야 합니다')
  assert(await evaluate('document.querySelector(".financial-verify") === null'), '재무자료 AI 교차검증 6단계가 남아 있습니다')
  // 증거 원장이 결과 화면에 실제로 그려지는지. 서버가 값을 만들어도 화면에 길이 없으면 의미가 없다.
  await waitFor('Boolean(document.querySelector(".evidence-panel .quality-dial"))', 'evidence quality dial')
  // 데모 자료는 표(CSV)와 서류(PNG)를 함께 넣으므로 자료끼리 대조가 실제로 돌아야 한다.
  // 표를 빼고 그림만 넣던 때에는 이 카드가 통째로 비었다.
  await waitFor('document.querySelectorAll(".evidence-panel .crosscheck").length >= 4', 'cross-check cards')
  assert(await evaluate('document.querySelectorAll(".evidence-panel .crosscheck.failed").length === 0'), '깨끗한 데모 세트에서 불일치가 나오면 안 됩니다')
  await waitFor('Boolean(document.querySelector(".evidence-panel .evidence-links li"))', 'evidence ledger links')
  await evaluate('document.querySelector(".evidence-links li > button").click()')
  await waitFor('document.querySelectorAll(".evidence-links li.open .support").length > 0', 'metric evidence expands')
  // 화면에서 받은 심사 자료가 결과에 다시 나오는지. 점수와 무관하다는 안내도 함께 있어야 한다.
  await waitFor('Boolean(document.querySelector(".extras-summary"))', 'application extras summary')
  assert(await evaluate('document.querySelector(".extras-summary").innerText.includes("자금 사용계획")'), '자금 사용계획 요약이 없습니다')
  assert(await evaluate('document.querySelector(".extras-summary").innerText.includes("부채현황")'), '부채현황 요약이 없습니다')
  console.log('PASS: public routes, owner dashboard, AI report, per-step URL navigation, samples, document preview, evidence ledger, funding application')
  await login('admin')
  await waitFor('Boolean(document.querySelector(".admin-hub"))', 'admin dashboard')
  for (let index = 0; index < 9; index++) {
    await evaluate(`document.querySelectorAll('.admin-sidebar nav button')[${index}].click()`)
    await waitFor(`document.querySelectorAll('.admin-sidebar nav button')[${index}].classList.contains('active')`, 'admin tab ' + index)
  }
  await click('심사 관리')
  await evaluate('document.querySelector(".admin-review-button").click()')
  await waitFor('Boolean(document.querySelector(".admin-review-modal"))', 'admin application detail')
  console.log('PASS: AI comparison selection, admin tabs and application detail')
  assert.deepEqual(errors, [], 'Uncaught browser errors')
  console.log('PASS: browser console has no uncaught errors')
} finally {
  socket?.close()
  for (const child of [chrome, server]) {
    if (!child || child.exitCode !== null) continue
    const stopped = once(child, 'exit')
    child.kill('SIGTERM')
    await Promise.race([stopped, pause(3000)])
    if (child.exitCode === null) { child.kill('SIGKILL'); await stopped }
  }
  await rm(dir, { recursive: true, force: true, maxRetries: 3 })
}
