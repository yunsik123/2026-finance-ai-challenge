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

  await visit('/support')
  await evaluate(`document.querySelector('[name=subject]').value = '브라우저 접수 회귀검증'; document.querySelector('[name=description]').value = '실제 폼 제출 후 오류 없이 초기화되는지 검증합니다.'; document.querySelector('.support-form').requestSubmit()`)
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

  for (const route of ['/discover', '/market', '/insight', '/legal', '/legal/privacy', '/support', '/missing-page']) await visit(route)
  await login('owner')
  await waitFor('Boolean(document.querySelector(".owner-dashboard"))', 'owner dashboard')
  await waitFor('Boolean(document.querySelector(".report-grid h3"))', 'owner report')
  await visit('/owner')
  await click('샘플 자료 한 번에 올리기')
  await waitFor('document.querySelectorAll(".document-upload-card.uploaded").length === 12', 'sample uploads')
  console.log('PASS: public routes, owner dashboard, AI report, sample uploads')
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
