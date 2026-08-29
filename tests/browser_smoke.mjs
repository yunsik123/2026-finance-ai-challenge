import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'moa-smoke-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  'http://127.0.0.1:8000/'
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = Date.now() + 15000;
let page;
while (Date.now() < deadline) {
  try {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
    page = pages.find(item => item.type === 'page' && item.url.includes('127.0.0.1:8000'));
    if (page) break;
  } catch {}
  await sleep(150);
}
if (!page) {
  chrome.kill('SIGTERM');
  throw new Error('Chrome 디버깅 페이지에 연결하지 못했습니다.');
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const browserErrors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') {
    browserErrors.push(message.params.exceptionDetails.text);
  }
});

function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await sleep(150);
  }
  throw new Error(`대기 시간 초과: ${expression}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await send('Runtime.enable');
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('#loginButton')`);
  await evaluate(`localStorage.clear(); location.reload()`);
  await waitFor(`document.readyState === 'complete' && document.querySelectorAll('.store-card').length === 6`);
  await waitFor(`document.querySelectorAll('.recommendation-card').length === 3`);

  await evaluate(`document.querySelector('#featuredStorePreview').click()`);
  assert(await evaluate(`document.querySelector('#storeModal').classList.contains('open') && document.querySelector('#storeDetailTitle').textContent === '온기린 식당'`), '메인 온기린 식당 일러스트에서 상세가 열리지 않습니다.');
  await evaluate(`document.querySelector('#storeModal [data-close-modal]').click()`);

  await evaluate(`document.querySelector('.store-card[data-store-id="ongi"] .store-image').click()`);
  assert(await evaluate(`document.querySelector('#storeModal').classList.contains('open')`), '가게 카드 이미지에서 상세가 열리지 않습니다.');
  await evaluate(`document.querySelector('#storeModal [data-close-modal]').click()`);

  await evaluate(`document.querySelector('#loginButton').click()`);
  assert(await evaluate(`document.querySelector('#authModal').classList.contains('open')`), '로그인 모달이 열리지 않습니다.');
  await evaluate(`
    document.querySelector('#authName').value='테스터';
    document.querySelector('#authEmail').value='tester@moa.local';
    document.querySelector('#authPassword').value='TestPass123!';
    document.querySelector('#authForm').requestSubmit();
  `);
  await waitFor(`document.querySelector('#loginLabel').textContent.includes('테스터')`);

  await evaluate(`document.querySelector('[data-open-store="ongi"]').click()`);
  assert(await evaluate(`document.querySelector('#storeModal').classList.contains('open') && document.querySelector('#storeDetailTitle').textContent === '온기린 식당'`), '가게 상세가 열리지 않습니다.');
  await evaluate(`document.querySelector('#riskConsent').checked=true; document.querySelector('#participationForm').requestSubmit()`);
  await waitFor(`document.querySelector('#couponModal').classList.contains('open')`);
  assert(await evaluate(`Number(document.querySelector('#couponCount').textContent) >= 2`), '참여 쿠폰이 지급되지 않았습니다.');
  await evaluate(`document.querySelector('#couponModal [data-close-modal]').click()`);

  await evaluate(`document.querySelector('#aiFab').click(); document.querySelector('#chatInput').value='이 서비스의 핵심 기능을 한 문장으로 알려줘'; document.querySelector('#chatForm').requestSubmit()`);
  await waitFor(`document.querySelectorAll('.chat-message.assistant').length >= 2 && !document.querySelector('.loading-message')`, 30000);
  assert(await evaluate(`document.querySelectorAll('.chat-message.assistant')[1].textContent.length > 10`), 'AI 답변이 표시되지 않았습니다.');

  await evaluate(`document.querySelector('#closeAiDrawer').click(); document.querySelector('#loginButton').click(); document.querySelector('#logoutButton').click()`);
  await waitFor(`document.querySelector('#loginLabel').textContent === '로그인'`);
  await evaluate(`document.querySelector('#loginButton').click()`);
  await waitFor(`document.querySelector('#authModal').classList.contains('open')`);
  await evaluate(`
    document.querySelector('input[name="authRole"][value="owner"]').checked=true;
    document.querySelector('#authName').value='김모아';
    document.querySelector('#authEmail').value='owner@moa.local';
    document.querySelector('#authPassword').value='OwnerPass123!';
    document.querySelector('#authForm').requestSubmit();
  `);
  await waitFor(`document.querySelector('#loginLabel').textContent.includes('김모아')`);
  await evaluate(`document.querySelector('[data-view="owner"]').click(); document.querySelector('#registerBusinessButton').click()`);
  assert(await evaluate(`document.querySelector('#businessModal').classList.contains('open')`), '사업체 등록 모달이 열리지 않습니다.');
  await evaluate(`
    document.querySelector('#businessName').value='테스트 식당';
    document.querySelector('#businessNumber').value='123-45-67890';
    document.querySelector('#businessAddress').value='서울 성동구 테스트로 1';
    document.querySelector('#businessSales').value='30000000';
    document.querySelector('#businessAge').value='3';
    document.querySelector('#businessDescription').value='지역 식재료를 사용하는 테스트 식당';
    document.querySelector('#businessForm .check-line input').checked=true;
    document.querySelector('#businessForm').requestSubmit();
  `);
  await waitFor(`document.querySelector('#ownerStatusStrip').textContent.includes('테스트 식당')`);

  await evaluate(`document.querySelector('#openMetricsButton').click()`);
  assert(await evaluate(`document.querySelector('#metricsModal').classList.contains('open')`), '평가자료 입력 모달이 열리지 않습니다.');
  await evaluate(`
    document.querySelector('#metricsSales6m').value='22000000,23500000,24800000,26500000,28400000,30000000';
    document.querySelector('#metricsCashFlow').value='5200000';
    document.querySelector('#metricsDebtTotal').value='35000000';
    document.querySelector('#metricsDebtPayment').value='1200000';
    document.querySelector('#metricsFootTraffic').value='7.2';
    document.querySelector('#metricsLocalGrowth').value='4.1';
    document.querySelector('#metricsCompetition').value='0.55';
    document.querySelector('#metricsClosure').value='8.5';
    document.querySelector('#metricsRepeat').value='55';
    document.querySelector('#metricsDigital').value='30';
    document.querySelector('#metricsForm').requestSubmit();
  `);
  await waitFor(`!document.querySelector('#metricsModal').classList.contains('open') && document.querySelector('#growthGrade').textContent.startsWith('S')`);
  assert(await evaluate(`document.querySelector('#graphSummary').textContent.includes('9개 관계')`), '지식그래프 관계 요약이 갱신되지 않았습니다.');

  await evaluate(`document.querySelector('#createCampaignButton').click()`);
  assert(await evaluate(`document.querySelector('#campaignModal').classList.contains('open')`), '펀딩 등록 모달이 열리지 않습니다.');
  await evaluate(`
    document.querySelector('#campaignName').value='주방 설비 교체';
    document.querySelector('#campaignPlan').value='냉장고 구매 2천만원, 설치 1천만원';
    document.querySelector('#campaignRisk').value='공사 지연과 원가 상승';
    document.querySelector('#campaignForm').requestSubmit();
  `);
  await waitFor(`document.querySelector('#ownerStatusStrip').textContent.includes('펀딩 초안')`);

  await evaluate(`document.querySelector('#editDisclosureButton').click()`);
  assert(await evaluate(`document.querySelector('#disclosureModal').classList.contains('open')`), '공시 모달이 열리지 않습니다.');
  await evaluate(`document.querySelectorAll('#disclosureForm input').forEach(input=>input.checked=true); document.querySelector('#disclosureForm').requestSubmit()`);
  await waitFor(`document.querySelector('#disclosurePercent').textContent === '100%'`);

  await evaluate(`document.querySelector('#regionButton').click(); document.querySelector('[data-region="서울 마포구"]').click()`);
  await waitFor(`document.querySelector('#regionButton').textContent.includes('서울 마포구')`);

  await evaluate(`document.querySelector('#couponIssueForm').requestSubmit()`);
  await waitFor(`document.querySelector('#issuedCouponSummary').classList.contains('active')`);

  await evaluate(`document.querySelector('#loginButton').click()`);
  await waitFor(`document.querySelector('#accountModal').classList.contains('open')`);
  assert(await evaluate(`document.querySelectorAll('#loginHistoryList .login-event').length >= 1`), '로그인 기록이 계정 화면에 표시되지 않았습니다.');
  await evaluate(`document.querySelector('#accountModal [data-close-modal]').click()`);

  assert(await evaluate(`document.querySelector('#receiptFile').accept.includes('image/png') && document.querySelector('#runOcrButton').disabled`), 'OCR 업로드 초기 상태가 올바르지 않습니다.');
  assert(browserErrors.length === 0, `브라우저 예외 발생: ${browserErrors.join(', ')}`);
  console.log('PASS 로그인기록/추천/SCB 입력/지식그래프/펀딩/쿠폰/AI상담/OCR UI');
} finally {
  socket.close();
  chrome.kill('SIGTERM');
}
