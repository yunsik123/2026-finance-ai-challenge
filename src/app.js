import { cloudConfigured, cloudRequest, cloudSessionHeaders } from './supabase-cloud.js';
import { DEMO_CAMPAIGNS } from './demo-campaigns.js';
import { buildSubmissionStatus } from './submission-status.js';
import { buildRoleKnowledgeGraph } from './knowledge-graph.js';
import { scoreContributions } from './risk-model.js';
import { buildAuditReport, renderAuditReportHtml } from './audit-report.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import QRCode from 'qrcode';
import {
  getCommercialAreaByAddress,
  getCommercialInsightCards,
  renderCommercialInsightCards
} from '../commercial_area/commercial_client.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const won = value => Number(value || 0).toLocaleString('ko-KR') + '원';
const shortDate = value => value ? new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(value)) : '-';
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

const roleLabels = { investor: '투자자', owner: '소상공인', admin: '운영자' };
const campaignStatusLabels = {
  draft: '작성 중',
  submitted: '심사 대기',
  needs_changes: '보완 필요',
  published: '모집 공개',
  rejected: '심사 반려',
  closed: '모집 종료'
};
const milestoneStatusLabels = {
  planned: '증빙 대기',
  evidence_submitted: '증빙 심사 중',
  approved: '지급 승인 대기',
  rejected: '증빙 보완 필요',
  released: '지급 완료'
};
const commitmentStatusLabels = {
  committed: '예치 확인 대기',
  escrowed: '예치 확인',
  cancelled: '취소',
  refunded: '환불'
};

const state = {
  user: null,
  campaigns: [],
  commitments: [],
  portfolio: null,
  ownerFund: null,
  discovery: { rankings: [], themes: [], insights: [] },
  loginHistory: [],
  owner: null,
  admin: null,
  currentCampaign: null,
  adminPreviewCampaign: null,
  ownerStep: 'business',
  adminTab: 'campaigns',
  quickRole: 'investor',
  quickAuthAction: 'signup',
  authRole: null,
  authAction: 'login',
  evidenceImage: '',
  evidenceFilename: '',
  evidenceResult: null,
  evidenceAnalysisId: null,
  financialDocumentImages: [],
  chatHistory: [],
  investorAreaCode: '',
  ownerAreaCode: '',
  campaignView: 'grid',
  map: null,
  mapMarkers: null,
  redeemCoupon: null,
  auditReport: null
};

function campaignsWithExamples(campaigns = []) {
  const liveIds = new Set(campaigns.map(item => item.id));
  const liveBusinessNames = new Set(campaigns.map(item => item.business?.name).filter(Boolean));
  return [...campaigns, ...DEMO_CAMPAIGNS.filter(item =>
    !liveIds.has(item.id) && !liveBusinessNames.has(item.business?.name)
  )];
}

async function apiRequest(path, options = {}) {
  if (cloudConfigured) {
    const data = await cloudRequest(path, options);
    if (data !== null) return data;
  } else if (!path.startsWith('/api/ai/') && path !== '/api/health') {
    throw new Error('서비스 데이터 연결이 설정되지 않았습니다.');
  }
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...cloudSessionHeaders(),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({ ok: false, error: '응답을 확인하지 못했습니다.' }));
  if (!response.ok || !data.ok) {
    const error = new Error(data.error || '요청을 처리하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function showToast(message, type = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 3600);
}

function openModal(id) {
  const modal = typeof id === 'string' ? $('#' + id) : id;
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setTimeout(() => $('input, button, textarea, select', modal)?.focus(), 30);
}

function closeModal(target) {
  const modal = target?.classList?.contains('modal') ? target : target?.closest?.('.modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!$('.modal.open')) document.body.classList.remove('modal-open');
}

document.addEventListener('click', event => {
  const closeButton = event.target.closest('[data-close-modal]');
  if (closeButton) {
    closeModal(closeButton);
  }
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if ($('#aiDrawer').classList.contains('open')) closeChat();
  else closeModal($('.modal.open'));
});

function applyBootstrap(data) {
  state.user = data.user || null;
  state.campaigns = campaignsWithExamples(data.campaigns || []);
  state.commitments = data.commitments || [];
  state.portfolio = data.portfolio || null;
  state.ownerFund = data.ownerFund || null;
  state.discovery = data.discovery || { rankings: [], themes: [], insights: [] };
  state.loginHistory = data.loginHistory || [];
  state.owner = data.owner || null;
  state.admin = data.admin || null;
  if (state.user?.role === 'admin' && !state.adminPreviewCampaign) {
    state.adminPreviewCampaign = state.admin?.campaigns?.[0] || null;
  }
}

async function refreshData(message = '') {
  const data = await apiRequest('/api/bootstrap');
  applyBootstrap(data);
  renderAll();
  if (message) showToast(message);
}

function allowedViews() {
  if (!state.user) return ['investor'];
  if (state.user.role === 'admin') return ['investor', 'owner', 'admin'];
  return [state.user.role];
}

function defaultView() {
  return state.user?.role === 'owner' ? 'owner'
    : state.user?.role === 'admin' ? 'admin'
      : 'investor';
}

function switchView(view, scroll = true) {
  if (!state.user && view !== 'investor') {
    showToast('로그인이 필요한 화면입니다.', 'info');
    selectQuickRole(view === 'owner' ? 'owner' : 'admin');
    openModal('authModal');
    return;
  }
  if (!allowedViews().includes(view)) {
    showToast('현재 계정에서는 이 화면을 이용할 수 없습니다.', 'error');
    return;
  }
  $$('.view').forEach(section => section.classList.toggle('active', section.id === view + 'View'));
  $$('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'owner') renderOwner();
  if (view === 'admin') renderAdmin();
  updateChatContext();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateHeader() {
  const nav = $('#roleNavigation');
  const allowed = allowedViews();
  nav.classList.remove('hidden');
  $$('[data-view]', nav).forEach(button => {
    button.classList.toggle('locked', Boolean(state.user && !allowed.includes(button.dataset.view)));
    button.classList.toggle('active', button.dataset.view === (state.user ? defaultView() : 'investor'));
  });
  $('#accountLabel').textContent = state.user ? state.user.name + '님' : '로그인';
  $('#openMyCommitments').classList.toggle('hidden', state.user?.role !== 'investor');
}

function renderAccount() {
  if (!state.user) return;
  $('#accountAvatar').textContent = state.user.name.slice(0, 1);
  $('#accountSummary').textContent = (state.user.email || state.user.name) + ' · ' + roleLabels[state.user.role] + ' 계정';
  const list = $('#loginHistoryList');
  list.innerHTML = state.loginHistory.length
    ? state.loginHistory.map(item =>
      '<div class="login-event"><strong>' + escapeHTML(item.label) + '</strong><span>'
      + escapeHTML(shortDate(item.createdAt)) + '</span></div>'
    ).join('')
    : '<p>접속 기록이 없습니다.</p>';
}

function renderAll() {
  $('#appLoading').classList.add('hidden');
  updateHeader();
  renderAccount();
  renderInvestor();
  renderOwner();
  renderAdmin();
  if (state.user) {
    $('.optional-auth-close')?.classList.remove('hidden');
    closeModal($('#authModal'));
    switchView(defaultView(), false);
  } else {
    $('.optional-auth-close')?.classList.remove('hidden');
    closeModal($('#authModal'));
    switchView('investor', false);
  }
}

$('#accountButton').addEventListener('click', () => {
  if (state.user) openModal('accountModal');
  else openModal('authModal');
});
$('#logoutButton').addEventListener('click', async () => {
  try { await apiRequest('/api/auth/session', { method: 'DELETE' }); } catch {}
  closeModal($('#accountModal'));
  applyBootstrap({ user: null, campaigns: state.campaigns });
  renderAll();
  showToast('로그아웃되었습니다.', 'info');
});
$$('[data-view]').forEach(button => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

const quickRoleLabels = {
  investor: '투자자',
  owner: '소상공인',
  admin: '운영자'
};

function quickSubmitText() {
  const role = quickRoleLabels[state.quickRole] || '투자자';
  if (state.quickRole === 'admin') return '운영자 이메일로 로그인하기';
  return state.quickAuthAction === 'signup'
    ? role + ' 계정 만들고 시작하기'
    : role + '로 로그인하기';
}

function setQuickAuthAction(action) {
  state.quickAuthAction = action === 'login' ? 'login' : 'signup';
  $$('[data-quick-auth-action]').forEach(button => {
    button.classList.toggle('active', button.dataset.quickAuthAction === state.quickAuthAction);
  });
  $('#quickSubmitLabel').textContent = quickSubmitText();
  $('#authDescription').textContent = state.quickAuthAction === 'signup'
    ? '로그인 아이디와 비밀번호를 입력하면 바로 계정이 생성됩니다.'
    : '가입 시 사용한 로그인 아이디와 비밀번호를 입력해 주세요.';
  $('#quickAuthPassword').autocomplete = state.quickAuthAction === 'signup' ? 'new-password' : 'current-password';
}

function selectQuickRole(role) {
  state.quickRole = role === 'owner' ? 'owner' : 'investor';
  $$('.quick-role-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.quickRole === state.quickRole);
  });
  const submitLabel = $('#quickSubmitLabel');
  if (submitLabel) submitLabel.textContent = quickSubmitText();
  $('#authDescription').textContent = state.quickAuthAction === 'signup'
    ? '로그인 아이디와 비밀번호를 입력하면 바로 계정이 생성됩니다.'
    : '가입 시 사용한 로그인 아이디와 비밀번호를 입력해 주세요.';
  const nameInput = $('#quickAuthName');
  if (nameInput) nameInput.focus();
}

$$('.quick-role-btn').forEach(button => {
  button.addEventListener('click', () => selectQuickRole(button.dataset.quickRole));
});

$$('[data-quick-auth-action]').forEach(button => {
  button.addEventListener('click', () => setQuickAuthAction(button.dataset.quickAuthAction));
});
setQuickAuthAction('signup');

$('#quickAuthForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#quickAuthSubmit');
  const nameInput = $('#quickAuthName');
  const passwordInput = $('#quickAuthPassword');
  const name = nameInput.value.trim();
  const password = passwordInput.value;
  if (name.length < 2) {
    showToast('로그인 아이디를 2자 이상 입력해 주세요.', 'info');
    nameInput.focus();
    return;
  }
  if (password.length < 8) {
    showToast('비밀번호를 8자 이상 입력해 주세요.', 'info');
    passwordInput.focus();
    return;
  }
  submit.disabled = true;
  const submitLabel = $('#quickSubmitLabel');
  if (submitLabel) submitLabel.textContent = '계정을 준비하고 있습니다…';
  try {
    const data = await apiRequest('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({
        quick: true,
        action: state.quickAuthAction,
        role: state.quickRole || 'investor',
        name,
        password
      })
    });
    nameInput.value = '';
    passwordInput.value = '';
    applyBootstrap(data);
    renderAll();
    showToast(state.user.name + '님, 환영합니다.');
  } catch (error) {
    showToast(error.message || '로그인에 실패했습니다.', 'error');
  } finally {
    submit.disabled = false;
    if (submitLabel) submitLabel.textContent = quickSubmitText();
  }
});

$('#openAdminLogin')?.addEventListener('click', () => {
  if (state.user?.role === 'admin') {
    switchView('admin');
  } else {
    openModal('adminAuthModal');
  }
});

$('#adminAuthForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#adminAuthSubmit');
  const nameInput = $('#adminAuthName');
  const passwordInput = $('#adminAuthPassword');
  const name = nameInput.value.trim();
  const password = passwordInput.value;
  if (!name || !password) {
    showToast('운영자 아이디와 비밀번호를 입력해 주세요.', 'info');
    return;
  }
  submit.disabled = true;
  submit.textContent = '운영자 권한 확인 중…';
  try {
    const data = await apiRequest('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({
        role: 'admin',
        name,
        password,
        action: 'login'
      })
    });
    nameInput.value = '';
    passwordInput.value = '';
    applyBootstrap(data);
    closeModal($('#adminAuthModal'));
    renderAll();
    switchView('admin');
    showToast('운영자 통제실에 접속했습니다.');
  } catch (error) {
    showToast(error.message || '운영자 로그인에 실패했습니다.', 'error');
  } finally {
    submit.disabled = false;
    submit.innerHTML = '운영자 통제실 입장 <span>→</span>';
  }
});

function renderInvestor() {
  renderCampaignGrid();
  if (state.campaignView === 'map') requestAnimationFrame(renderCampaignMap);
  renderDiscovery();
  renderPortfolio();
  renderCommitments();
}

function renderDiscovery() {
  const discovery = state.discovery || {};
  $('#rankingList').innerHTML = (discovery.rankings || []).slice(0, 5).map((item, index) =>
    '<button class="discovery-row" type="button" data-open-campaign="' + item.campaignId + '"><b>' + (index + 1) + '</b><span><strong>'
    + escapeHTML(item.businessName) + '</strong><small>' + escapeHTML(item.category) + ' · AI ' + item.score + '점</small></span><em>' + item.totalScore + '</em></button>'
  ).join('') || '<p class="empty-copy">랭킹 데이터 준비 중</p>';
  $('#themeList').innerHTML = (discovery.themes || []).map(item => '<article class="theme-row"><strong>' + escapeHTML(item.name) + '</strong><span>'
    + escapeHTML(item.region) + ' · ' + escapeHTML(item.category) + ' · 음식점 ' + (item.campaignIds || []).length + '곳</span><p>' + escapeHTML(item.description) + '</p></article>').join('') || '<p class="empty-copy">테마 데이터 준비 중</p>';
  $('#insightList').innerHTML = (discovery.insights || []).map(item => '<article class="insight-row"><small>' + escapeHTML(item.contentType) + '</small><strong>'
    + escapeHTML(item.title) + '</strong><p>' + escapeHTML(item.content) + '</p></article>').join('') || '<p class="empty-copy">인사이트 데이터 준비 중</p>';
}

$('#rankingList').addEventListener('click', event => {
  const button = event.target.closest('[data-open-campaign]');
  if (button) openCampaignDetail(button.dataset.openCampaign);
});

function campaignLabel(id) {
  const campaign = state.campaigns.find(item => item.id === id);
  return campaign?.business?.name || campaign?.name || '음식점 펀드';
}

function renderPortfolio() {
  const summary = $('#portfolioSummary');
  const grid = $('#investorPortfolio');
  const wallet = $('#couponWallet');
  if (!state.user || state.user.role !== 'investor' || !state.portfolio) {
    summary.innerHTML = '<article><small>내 포트폴리오</small><strong>로그인 후 실제 투자·쿠폰 현황을 확인하세요</strong></article>';
    grid.innerHTML = '';
    wallet.innerHTML = '';
    return;
  }
  const portfolio = state.portfolio;
  const todayGrowth = (portfolio.investments || []).reduce((sum, item) =>
    sum + item.investedAmount / 100000 * .5, 0);
  summary.innerHTML = '<article><small>총 투자금</small><strong>' + won(portfolio.summary?.totalInvested) + '</strong></article>'
    + '<article><small>투자 음식점</small><strong>' + (portfolio.investments || []).filter(item => item.investedAmount > 0).length + '곳</strong></article>'
    + '<article><small>오늘 예상 쿠폰 성장</small><strong>+' + todayGrowth.toFixed(2) + '%p</strong></article>'
    + '<article><small>사용 가능 쿠폰</small><strong>' + (portfolio.summary?.availableCoupons || 0) + '장</strong></article>';
  grid.innerHTML = (portfolio.investments || []).length
    ? portfolio.investments.map(item => {
      const campaign = state.campaigns.find(value => value.id === item.campaignId);
      const max = campaign?.maxDiscountRate || 30;
      const rate = Math.min(item.currentAccrualRate || 0, max);
      const days = item.investedAmount > 0 ? Math.max(0, (max - rate) / (item.investedAmount / 100000 * .5)) : 0;
      return '<article class="portfolio-card"><div><span class="status-pill ' + (campaign?.fundStatus === 'closed' ? 'closed' : 'published') + '">'
        + (campaign?.fundStatus === 'closed' ? '모집 완료 · 매칭 거래' : '모집 중') + '</span><h3>' + escapeHTML(campaignLabel(item.campaignId)) + '</h3></div>'
        + '<div class="portfolio-values"><span>투자잔액 <b>' + won(item.investedAmount) + '</b></span><span>현재 할인율 <b>' + rate.toFixed(2) + '%</b></span></div>'
        + '<div class="coupon-progress"><i style="width:' + Math.min(100, rate / max * 100) + '%"></i></div>'
        + '<small>최대 ' + max + '% · 예상 ' + Math.ceil(days) + '일 후 자동 발급</small>'
        + '<div class="card-actions"><button type="button" data-issue-coupon="' + item.campaignId + '">현재 할인율로 발급</button><button type="button" data-withdraw-campaign="' + item.campaignId + '" data-balance="' + item.investedAmount + '">투자금 회수</button></div></article>';
    }).join('')
    : '<div class="empty-state"><strong>아직 실제 투자잔액이 없습니다</strong><p>공개 펀드 상세에서 투자하면 쿠폰 할인율이 쌓이기 시작합니다.</p></div>';
  const queueRows = [
    ...(portfolio.reservations || []).map(item => '<div><b>투자 예약</b><span>' + escapeHTML(campaignLabel(item.campaignId)) + '</span><strong>' + won(item.reservedAmount - item.matchedAmount) + ' 남음</strong></div>'),
    ...(portfolio.withdrawals || []).map(item => '<div><b>회수 대기</b><span>' + escapeHTML(campaignLabel(item.campaignId)) + '</span><strong>' + won(item.requestedAmount - item.matchedAmount) + ' 남음</strong></div>')
  ];
  const coupons = portfolio.coupons || [];
  wallet.innerHTML = '<div class="panel-heading"><div><h3>내 쿠폰 지갑</h3><p>발급된 쿠폰의 소유자와 사용 상태는 DB에서 관리됩니다.</p></div><strong>' + coupons.length + '장</strong></div>'
    + (queueRows.length ? '<div class="queue-list">' + queueRows.join('') + '</div>' : '')
    + '<div class="coupon-grid">' + (coupons.length ? coupons.map(item => '<article class="coupon-ticket ' + item.status + '"><small>'
      + escapeHTML(campaignLabel(item.campaignId)) + '</small><strong>' + (item.benefitKind === 'percent' ? item.discountRate + '% 할인' : escapeHTML(item.description)) + '</strong><span>'
      + (item.status === 'available' ? '사용 가능' : item.status === 'used' ? '사용 완료' : '상태 ' + escapeHTML(item.status)) + '</span>'
      + (item.status === 'available' ? '<div class="coupon-actions"><button type="button" data-use-coupon="' + item.id + '">음식점 사용</button><button type="button" data-list-coupon="' + item.id + '">교환 등록</button></div>' : '') + '</article>').join('')
      : '<p class="empty-copy">발급된 쿠폰이 없습니다.</p>') + '</div>'
    + renderCouponMarket(portfolio);
}

function renderCouponMarket(portfolio) {
  const marketCoupons = new Map((portfolio.marketCoupons || []).map(item => [item.id, item]));
  const ownAvailable = (portfolio.coupons || []).filter(item => item.status === 'available');
  const rows = (portfolio.trades || []).map(trade => {
    const offered = marketCoupons.get(trade.offered_coupon_id);
    if (!offered) return '';
    const candidate = ownAvailable.find(item => item.id !== offered.id && Math.abs(item.discountRate - offered.discountRate) < 10);
    return '<article class="trade-row"><span><b>' + escapeHTML(campaignLabel(offered.campaignId)) + ' ' + offered.discountRate + '%</b><small>할인율 차이 10%p 미만 쿠폰만 가능</small></span>'
      + (trade.offered_by === state.user.id ? '<em>내 교환 제안</em>' : candidate ? '<button type="button" data-accept-trade="' + trade.id + '" data-coupon-id="' + candidate.id + '">내 ' + candidate.discountRate + '% 쿠폰과 교환</button>' : '<em>교환 가능한 내 쿠폰 없음</em>') + '</article>';
  }).filter(Boolean);
  return '<details class="coupon-market"><summary>쿠폰 교환소 (' + rows.length + '건)</summary><div>' + (rows.join('') || '<p class="empty-copy">열린 교환 제안이 없습니다.</p>') + '</div></details>';
}

$('#investorPortfolio').addEventListener('click', async event => {
  const issue = event.target.closest('[data-issue-coupon]');
  const withdraw = event.target.closest('[data-withdraw-campaign]');
  if (!issue && !withdraw) return;
  const button = issue || withdraw;
  button.disabled = true;
  try {
    if (issue) {
      await apiRequest('/api/coupon/issue', {
        method: 'POST', body: JSON.stringify({ campaignId: issue.dataset.issueCoupon })
      });
      await refreshData('현재 누적 할인율로 쿠폰을 발급했습니다. 적립률은 0%부터 다시 시작합니다.');
    } else {
      const amount = Number(window.prompt('회수할 금액을 1,000원 단위로 입력하세요.', Math.min(30000, Number(withdraw.dataset.balance))));
      if (!amount) return;
      const result = await apiRequest('/api/withdraw', {
        method: 'POST', body: JSON.stringify({ campaignId: withdraw.dataset.withdrawCampaign, amount })
      });
      await refreshData(result.mode === 'queued' ? '회수 요청을 등록했습니다. 투자 예약자와 자동 매칭됩니다.' : '투자금 회수가 반영됐습니다. 발급 기준 이상인 쿠폰도 함께 처리했습니다.');
    }
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#couponWallet').addEventListener('click', async event => {
  const button = event.target.closest('[data-use-coupon], [data-list-coupon], [data-accept-trade]');
  if (!button) return;
  if (button.dataset.listCoupon) {
    button.disabled = true;
    try {
      await apiRequest('/api/coupon/trade', { method: 'POST', body: JSON.stringify({ couponId: button.dataset.listCoupon }) });
      await refreshData('쿠폰을 교환소에 등록했습니다. 할인율 차이 10%p 미만 쿠폰과 교환할 수 있습니다.');
    } catch (error) { showToast(error.message, 'error'); button.disabled = false; }
    return;
  }
  if (button.dataset.acceptTrade) {
    button.disabled = true;
    try {
      await apiRequest('/api/coupon/trade/accept', { method: 'POST', body: JSON.stringify({ tradeId: button.dataset.acceptTrade, couponId: button.dataset.couponId }) });
      await refreshData('두 쿠폰의 소유권을 안전하게 교환했습니다.');
    } catch (error) { showToast(error.message, 'error'); button.disabled = false; }
    return;
  }
  const coupon = (state.portfolio?.coupons || []).find(item => item.id === button.dataset.useCoupon);
  if (!coupon) return showToast('사용할 쿠폰을 현재 원장에서 확인하지 못했습니다.', 'error');
  state.redeemCoupon = coupon;
  $('#couponRedeemSummary').textContent = campaignLabel(coupon.campaignId) + ' · ' + coupon.discountRate + '% 할인';
  $('#couponOrderAmount').value = 30000;
  $('#couponQr').innerHTML = '<span class="loader"></span>';
  openModal('couponRedeemModal');
  try {
    const payload = JSON.stringify({ type: 'MOA_COUPON_V1', couponId: coupon.id, campaignId: coupon.campaignId });
    const dataUrl = await QRCode.toDataURL(payload, { width: 260, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#173d34', light: '#ffffff' } });
    $('#couponQr').innerHTML = '<img src="' + dataUrl + '" alt="MOA 쿠폰 ' + escapeHTML(coupon.id) + ' QR 코드">';
  } catch (error) {
    $('#couponQr').innerHTML = '<p>QR 생성 실패: ' + escapeHTML(error.message) + '</p>';
  }
});

$('#couponRedeemForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const coupon = state.redeemCoupon;
  const orderAmount = Number($('#couponOrderAmount').value);
  if (!coupon || !orderAmount) return;
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    const result = await apiRequest('/api/coupon/use', {
      method: 'POST', body: JSON.stringify({ couponId: coupon.id, orderAmount })
    });
    closeModal($('#couponRedeemModal'));
    state.redeemCoupon = null;
    await refreshData('쿠폰 사용이 완료됐습니다. 할인액 ' + won(result.coupon?.discountAmount || 0) + '이 DB 원장에 기록됐습니다.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function renderInvestorLocation(address, updateInput = true) {
  const result = $('#investorLocationResult');
  const area = getCommercialAreaByAddress(address);
  if (updateInput) $('#investorLocation').value = address;
  result.classList.remove('hidden');
  if (!area) {
    state.investorAreaCode = '';
    result.innerHTML = '<div class="location-empty"><strong>아직 연결된 상권 데이터가 없습니다</strong>'
      + '<p>현재는 성수·연남·서촌·행궁동·전포·대전 중앙로 예시 상권을 지원합니다. 주소는 저장하거나 검색할 수 있지만, 수치 자동 반영 전 최신 공공데이터 확인이 필요합니다.</p></div>';
    renderCampaignGrid();
    if (state.campaignView === 'map') renderCampaignMap();
    return;
  }
  state.investorAreaCode = area.areaCode;
  const nearby = state.campaigns.filter(item => getCommercialAreaByAddress(item.business?.address)?.areaCode === area.areaCode).length;
  result.innerHTML = renderCommercialInsightCards(area)
    + '<div class="location-match-summary"><strong>이 상권의 예시 모집 ' + nearby + '건을 추렸습니다.</strong>'
    + '<button type="button" id="clearInvestorLocation">전체 모집 다시 보기</button></div>';
  $('#clearInvestorLocation')?.addEventListener('click', () => {
    state.investorAreaCode = '';
    $('#investorLocation').value = '';
    result.classList.add('hidden');
    renderCampaignGrid();
    if (state.campaignView === 'map') renderCampaignMap();
  });
  renderCampaignGrid();
  if (state.campaignView === 'map') renderCampaignMap();
}

$('#investorLocationForm').addEventListener('submit', event => {
  event.preventDefault();
  const address = $('#investorLocation').value.trim();
  if (!address) {
    showToast('관심 지역이나 주소를 입력해 주세요.', 'info');
    $('#investorLocation').focus();
    return;
  }
  renderInvestorLocation(address, false);
});

$$('[data-location-pick]').forEach(button => {
  button.addEventListener('click', () => renderInvestorLocation(button.dataset.locationPick));
});

function filteredCampaigns() {
  const query = $('#campaignSearch').value.trim().toLocaleLowerCase('ko');
  return state.campaigns.filter(item => {
    const haystack = [
      item.name, item.business?.name, item.business?.category,
      item.business?.address, item.plan
    ].join(' ').toLocaleLowerCase('ko');
    const itemArea = getCommercialAreaByAddress(item.business?.address);
    const locationMatches = !state.investorAreaCode || itemArea?.areaCode === state.investorAreaCode;
    return locationMatches && (!query || haystack.includes(query));
  });
}

function renderCampaignGrid() {
  const grid = $('#campaignGrid');
  const campaigns = filteredCampaigns();
  if (!campaigns.length) {
    grid.innerHTML = '<div class="empty-state"><strong>현재 공개된 모집이 없습니다</strong>'
      + '<p>운영자 심사를 통과한 모집만 이곳에 표시됩니다.</p></div>';
    return;
  }
  const tones = ['#dce8e2', '#efd8cd', '#e7dfc7', '#d9e3eb'];
  grid.innerHTML = campaigns.map((item, index) => {
    const funded = item.currentAmount || item.committedTotal || item.escrowTotal || 0;
    const percent = Math.min(100, Math.round(funded / Math.max(item.target, 1) * 100));
    const assessment = item.assessment;
    const risk = assessment
      ? assessment.riskLevel === 'low' ? '낮은 보완 위험'
        : assessment.riskLevel === 'high' ? '집중 확인 필요' : '추가 확인 필요'
      : '자료 확인 필요';
    const area = getCommercialAreaByAddress(item.business?.address);
    return '<article class="campaign-card">'
      + '<div class="campaign-card-top" style="--card-tone:' + tones[index % tones.length] + '">'
      + '<span>' + (item.isDemo ? '가상 투자 검토 예시' : item.fundStatus === 'closed' ? '모집 완료 · 예약 가능' : '운영자 심사 완료 · 모집 중') + '</span><h3>' + escapeHTML(item.business?.name || item.name) + '</h3>'
      + '<p>' + escapeHTML(item.business?.address || '') + ' · ' + escapeHTML(item.business?.category || '') + '</p></div>'
      + '<div class="campaign-card-body"><p>' + escapeHTML(item.name) + '</p>'
      + '<div class="funding-bar"><span style="width:' + percent + '%"></span></div>'
      + '<div class="campaign-numbers"><strong>' + won(funded) + ' 펀드 총액</strong><span>목표 ' + won(item.target) + '</span></div>'
      + '<div class="campaign-facts"><span>' + item.milestones.length + '단계 조건부 지급</span>'
      + '<span>' + escapeHTML(risk) + '</span>'
      + '<span>쿠폰 최대 ' + item.maxDiscountRate + '%</span>'
      + (area ? '<span class="area-fact">유동인구 ' + Math.round(area.dailyFootTraffic / 100) / 100 + '만 · 상권매출 +' + area.localSalesGrowth + '%</span>' : '') + '</div>'
      + '<button type="button" data-open-campaign="' + item.id + '">계획·위험·지급 조건 보기 →</button></div></article>';
  }).join('');
}

function renderCampaignMap() {
  if (state.campaignView !== 'map' || !$('#campaignMap')) return;
  if (!state.map) {
    state.map = L.map('campaignMap', { scrollWheelZoom: false }).setView([36.4, 127.8], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
    state.mapMarkers = L.layerGroup().addTo(state.map);
  }
  state.mapMarkers.clearLayers();
  const points = [];
  filteredCampaigns().forEach((campaign, index) => {
    const area = getCommercialAreaByAddress(campaign.business?.address);
    if (!area?.latitude || !area?.longitude) return;
    const sameAreaIndex = points.filter(point => point.areaCode === area.areaCode).length;
    const latitude = area.latitude + Math.sin(sameAreaIndex * 2.4) * .0014;
    const longitude = area.longitude + Math.cos(sameAreaIndex * 2.4) * .0014;
    points.push({ latitude, longitude, areaCode: area.areaCode });
    const icon = L.divIcon({
      className: 'moa-map-pin',
      html: '<span><b>' + escapeHTML(String(index + 1)) + '</b></span>',
      iconSize: [32, 38], iconAnchor: [16, 38]
    });
    const marker = L.marker([latitude, longitude], { icon }).addTo(state.mapMarkers);
    marker.bindPopup('<div class="map-popup"><b>' + escapeHTML(campaign.business?.name || campaign.name)
      + '</b><span>' + escapeHTML(area.areaName) + '</span><button type="button" data-map-campaign="'
      + escapeHTML(campaign.id) + '">계획·위험 보기</button></div>');
  });
  if (points.length === 1) state.map.setView([points[0].latitude, points[0].longitude], 14);
  else if (points.length > 1) state.map.fitBounds(points.map(point => [point.latitude, point.longitude]), { padding: [35, 35], maxZoom: 13 });
  else state.map.setView([36.4, 127.8], 7);
  setTimeout(() => state.map?.invalidateSize(), 0);
}

$$('[data-campaign-view]').forEach(button => button.addEventListener('click', () => {
  state.campaignView = button.dataset.campaignView === 'map' ? 'map' : 'grid';
  $$('[data-campaign-view]').forEach(item => item.classList.toggle('active', item.dataset.campaignView === state.campaignView));
  $('#campaignGrid').classList.toggle('hidden', state.campaignView !== 'grid');
  $('#campaignMapShell').classList.toggle('hidden', state.campaignView !== 'map');
  if (state.campaignView === 'map') requestAnimationFrame(renderCampaignMap);
}));

$('#campaignMap')?.addEventListener('click', event => {
  const button = event.target.closest('[data-map-campaign]');
  if (button) openCampaignDetail(button.dataset.mapCampaign);
});

$('#campaignSearch').addEventListener('input', () => {
  renderCampaignGrid();
  if (state.campaignView === 'map') renderCampaignMap();
});
$('#campaignGrid').addEventListener('click', event => {
  const button = event.target.closest('[data-open-campaign]');
  if (button) openCampaignDetail(button.dataset.openCampaign);
});
$('#browseCampaigns').addEventListener('click', () => {
  $('#campaigns').scrollIntoView({ behavior: 'smooth' });
});
$('#openProcessGuide').addEventListener('click', () => openModal('processModal'));
$('#openMyCommitments').addEventListener('click', () => {
  switchView('investor');
  setTimeout(() => $('#myCommitmentsSection').scrollIntoView({ behavior: 'smooth' }), 100);
});

function renderCommitments() {
  const list = $('#investorCommitments');
  if (!state.user || state.user.role !== 'investor') {
    list.innerHTML = '<div class="empty-state"><strong>로그인 후 내 참여를 확인할 수 있습니다</strong></div>';
    return;
  }
  if (!state.commitments.length) {
    list.innerHTML = '<div class="empty-state"><strong>아직 참여한 모집이 없습니다</strong>'
      + '<p>사업계획과 위험, 지급 조건을 충분히 확인한 뒤 결정해 주세요.</p></div>';
    return;
  }
  list.innerHTML = state.commitments.map(commitment => {
    const campaign = state.campaigns.find(item => item.id === commitment.campaignId);
    const released = (campaign?.disbursements || []).reduce((sum, item) => sum + item.amount, 0);
    return '<article class="commitment-row"><div><small>모집</small><strong>'
      + escapeHTML(campaign?.business?.name || '모집 정보 확인 중') + '</strong></div>'
      + '<div><small>참여 금액</small><strong>' + won(commitment.amount) + '</strong></div>'
      + '<div><small>예치 상태</small><strong>' + escapeHTML(commitmentStatusLabels[commitment.status] || commitment.status) + '</strong></div>'
      + '<div><small>현재 지급액</small><strong>' + won(released) + '</strong></div></article>';
  }).join('');
}

function renderDetailMenuList(menuItems, representativeMenu, representativePrice) {
  const items = (menuItems && menuItems.length) ? menuItems
    : representativeMenu ? [{ name: representativeMenu, price: representativePrice || 0, description: '', isSignature: true, category: '대표' }]
      : [];
  if (!items.length) return '<p class="empty-copy">사업자가 등록한 메뉴 정보가 없습니다.</p>';
  return items.map(item =>
    `<article class="detail-menu-card ${item.isSignature ? 'signature' : ''}">
      <div class="detail-menu-header">
        <div>
          <strong class="detail-menu-name">${escapeHTML(item.name)}</strong>
          ${item.isSignature ? '<span class="signature-tag">시그니처 ⭐</span>' : ''}
          ${item.category ? `<small class="menu-cat-pill">${escapeHTML(item.category)}</small>` : ''}
        </div>
        <span class="detail-menu-price">${won(item.price)}</span>
      </div>
      ${item.description ? `<p class="detail-menu-desc">${escapeHTML(item.description)}</p>` : ''}
    </article>`
  ).join('');
}

function assessmentContributions(assessment) {
  const stored = Array.isArray(assessment?.contributions) ? assessment.contributions : [];
  return stored.length ? stored : scoreContributions(assessment?.components || {});
}

function renderContributionWaterfall(assessment) {
  if (!assessment) return '';
  const contributions = assessmentContributions(assessment);
  const max = Math.max(1, ...contributions.map(item => Math.abs(Number(item.contribution || 0))));
  return '<div class="score-waterfall"><div class="waterfall-heading"><div><b>기준 60점에서 최종 '
    + escapeHTML(assessment.score) + '점까지</b><span>각 구성요인의 가중치 기여를 정확히 분해합니다.</span></div><strong>'
    + escapeHTML(assessment.grade || 'S5') + '</strong></div>'
    + contributions.map(item => {
      const value = Number(item.contribution || 0);
      const positive = value >= 0;
      return '<div class="waterfall-row"><span>' + escapeHTML(item.label) + '</span><div class="waterfall-track '
        + (positive ? 'positive' : 'negative') + '"><i style="width:' + Math.max(3, Math.abs(value) / max * 100) + '%"></i></div><b>'
        + (positive ? '+' : '') + value.toFixed(1) + '</b></div>';
    }).join('')
    + '<p>이 차트는 학습 모델의 SHAP 추정치를 가장하지 않고, MOA의 현재 가중 합산식을 SHAP 워터폴 형식으로 표시한 것입니다.</p></div>';
}

function openCampaignDetail(id) {
  const campaign = state.campaigns.find(item => item.id === id)
    || state.admin?.campaigns?.find(item => item.id === id);
  if (!campaign) return;
  state.currentCampaign = campaign;
  const funded = campaign.currentAmount || campaign.committedTotal || campaign.escrowTotal || 0;
  const percent = Math.min(100, Math.round(funded / Math.max(campaign.target, 1) * 1000) / 10);
  const released = (campaign.disbursements || []).reduce((sum, item) => sum + item.amount, 0);
  const milestones = campaign.milestones.map(item =>
    '<div class="detail-milestone"><b>' + item.sequence + '</b><div><strong>'
    + escapeHTML(item.title) + ' · ' + item.percent + '%</strong><small>'
    + escapeHTML(item.condition) + '</small></div><span>'
    + escapeHTML(milestoneStatusLabels[item.status] || item.status) + '</span></div>'
  ).join('');
  const isGuest = !state.user;
  const canCommit = state.user?.role === 'investor';
  const area = getCommercialAreaByAddress(campaign.business?.address);
  const assessment = campaign.assessment;
  const assessmentHtml = assessment
    ? '<section class="detail-section"><div class="detail-section-title"><h3>지속가능성 점검</h3><strong class="detail-score">'
      + assessment.score + '점</strong></div><p><b>'
      + (campaign.isDemo ? '가상 검토용 평가 예시' : assessment.isOfficial ? '운영자 원자료 승인 평가' : '미검증 예비평가')
      + '</b> · 점수만으로 승인하지 않습니다. 매출·현금흐름·부채·업력·상권 자료를 함께 본 보조 지표입니다.</p>'
      + '<div class="detail-factor-chips">' + Object.entries(assessment.components || {}).map(([key, value]) =>
        '<span>' + escapeHTML(key) + ' <b>' + escapeHTML(value) + '</b></span>'
      ).join('') + '</div>' + renderContributionWaterfall(assessment) + '</section>'
    : '';
  const closed = campaign.fundStatus === 'closed';
  const commitButtonHtml = campaign.isDemo
    ? '<button class="primary-button full-button" type="submit">예시 투자 검토 완료 <span>→</span></button>'
    : isGuest
    ? '<button class="primary-button full-button" type="button" id="promptLoginCommit">로그인하고 참여하기 <span>→</span></button>'
    : '<button class="primary-button full-button" type="submit" ' + (canCommit ? '' : 'disabled')
      + '>' + (canCommit ? (closed ? '투자 예약 등록' : '펀드 투자하기') : '투자자 계정에서 참여 가능') + '</button>';

  const highlights = Array.isArray(campaign.business?.highlights)
    ? campaign.business.highlights
    : (typeof campaign.business?.highlights === 'string' ? campaign.business.highlights.split(',').map(s => s.trim()) : []);
  const highlightsHtml = highlights.map(tag => `<span class="detail-hero-tag">${escapeHTML(tag.startsWith('#') ? tag : '#' + tag)}</span>`).join('');

  const discountPrice = Math.round((campaign.representativeMenuPrice || 15000) * (1 - campaign.maxDiscountRate / 100));

  $('#campaignDetailContent').innerHTML =
    `<div class="detail-hero">
      <div class="detail-hero-status-row">
        <span class="detail-type-badge">${campaign.isDemo ? '가상 투자 검토 예시 · 실제 모집 아님' : '운영자 심사 완료 · 조건부 지급'}</span>
        <span class="detail-category-badge">${escapeHTML(campaign.business?.category || '외식·음료')}</span>
      </div>
      <h2 id="campaignDetailTitle">${escapeHTML(campaign.business?.name || campaign.name)}</h2>
      <p class="detail-hero-address">📍 ${escapeHTML(campaign.business?.address || '')} · 업력 ${campaign.business?.age || 1}년차</p>
      ${highlightsHtml ? `<div class="detail-hero-tags">${highlightsHtml}</div>` : ''}
    </div>

    <div class="detail-tab-nav" role="tablist">
      <button class="detail-tab-btn active" data-detail-tab="story" type="button">☕ 가게 & 메뉴 소개</button>
      <button class="detail-tab-btn" data-detail-tab="funding" type="button">💼 펀딩 & 자금 집행</button>
      <button class="detail-tab-btn" data-detail-tab="assessment" type="button">📊 AI 심사 & 상권 분석</button>
    </div>

    <div class="detail-body">
      <div class="detail-columns">
        <div class="detail-tab-panes">

          <!-- 탭 1: 가게 & 메뉴 소개 -->
          <div class="detail-tab-pane active" id="detailTab-story">
            <section class="detail-section owner-quote-section">
              <div class="owner-quote-header">
                <span class="quote-symbol">“</span>
                <h3>사장님의 한마디 & 철학</h3>
              </div>
              <blockquote class="owner-quote-body">
                ${escapeHTML(campaign.business?.ownerStory || '사업자가 등록한 소개글이 없습니다.')}
              </blockquote>
              <div class="owner-quote-author">
                <strong>${escapeHTML(campaign.business?.representativeName || campaign.business?.name || '대표')} 사장님</strong>
                <small>${escapeHTML(campaign.business?.category || '매장')} 운영 ${campaign.business?.age || 1}년차</small>
              </div>
            </section>

            <section class="detail-section store-story-section">
              <h3>가게 이야기</h3>
              <p class="store-story-text">${escapeHTML(campaign.business?.description || '매장 정보가 등록되어 있습니다.')}</p>
            </section>

            <section class="detail-section menu-section">
              <div class="detail-section-title">
                <h3>시그니처 메뉴판</h3>
                <small class="menu-notice">매장 추천 및 대표 메뉴</small>
              </div>
              <div class="detail-menu-grid">
                ${renderDetailMenuList(campaign.business?.menuItems, campaign.representativeMenu, campaign.representativeMenuPrice)}
              </div>
            </section>

            <section class="detail-section reward-benefit-section">
              <div class="reward-benefit-header">
                <span class="reward-icon">🎁</span>
                <div>
                  <h3>단골 투자자 전용 혜택 안내</h3>
                  <p>펀드에 참여하면 10만원당 매일 +0.5%p씩 누적되어 최대 <b>${campaign.maxDiscountRate}%</b> 쿠폰이 발급됩니다.</p>
                </div>
              </div>
              <div class="reward-simulation-card">
                <div class="sim-col">
                  <small>대표 메뉴</small>
                  <strong>${escapeHTML(campaign.representativeMenu || '시그니처')}</strong>
                </div>
                <div class="sim-arrow">→</div>
                <div class="sim-col">
                  <small>정상 가격</small>
                  <del>${won(campaign.representativeMenuPrice || 10000)}</del>
                </div>
                <div class="sim-arrow">→</div>
                <div class="sim-col highlight">
                  <small>최대 혜택가 (${campaign.maxDiscountRate}% OFF)</small>
                  <strong class="sim-discount">${won(discountPrice)}</strong>
                </div>
              </div>
            </section>
          </div>

          <!-- 탭 2: 펀딩 목적 & 자금 집행 -->
          <div class="detail-tab-pane hidden" id="detailTab-funding">
            <section class="detail-section">
              <div class="campaign-title-box">
                <span class="eyebrow">펀딩 목적</span>
                <h3>${escapeHTML(campaign.name)}</h3>
              </div>
              <h4 class="plan-subheading">상세 자금 사용계획</h4>
              <p>${escapeHTML(campaign.plan)}</p>
            </section>

            <section class="detail-section coupon-policy-detail">
              <h3>현금 배당이 아닌 쿠폰 보상 정책</h3>
              <div><strong>최대 ${campaign.maxDiscountRate}% 할인</strong><span>최소 ${campaign.minCouponRate}%부터 중간 발급</span></div>
              <p>10만원 투자 기준 하루 +0.5%p가 쌓이며, 최대 할인율 도달 시 쿠폰이 발급되고 다시 0%부터 시작합니다.
              ${campaign.representativeMenu ? '<br>' + escapeHTML(campaign.representativeMenu) + ' 기준 예상 최대 ' + won(Math.min(campaign.couponMaxAmount || Infinity, campaign.representativeMenuPrice * campaign.maxDiscountRate / 100)) + ' 할인' : ''}</p>
            </section>

            <section class="detail-section">
              <h3>단계별(마일스톤) 지급 조건</h3>
              <p class="milestone-desc">자금을 일괄 지급하지 않고, 각 단계별 공사·구매 증빙(영수증, 세금계산서)을 확인한 뒤 순차 지급합니다.</p>
              <div class="detail-milestones">${milestones}</div>
            </section>
          </div>

          <!-- 탭 3: AI 심사 & 상권 분석 -->
          <div class="detail-tab-pane hidden" id="detailTab-assessment">
            ${assessmentHtml}
            ${area ? `<section class="detail-section commercial-detail-section"><h3>주소로 확인한 입지</h3>${renderCommercialInsightCards(area, campaign.business?.category)}</section>` : ''}
            <section class="detail-section">
              <h3>공개된 주요 위험과 대응</h3>
              <p>${escapeHTML(campaign.risk)}</p>
            </section>
          </div>

        </div>

        <aside class="commitment-form">
          <div class="detail-fund-stat-box">
            <div class="fund-stat-row">
              <small>목표 금액</small>
              <strong>${won(campaign.target)}</strong>
            </div>
            <div class="funding-bar"><span style="width:${percent}%"></span></div>
            <div class="fund-stat-sub">
              <span>현재 <b>${won(funded)}</b> (${percent}%)</span>
              <span>참여자 <b>${campaign.investorCount}명</b></span>
            </div>
          </div>

          <span class="status-pill ${closed ? 'closed' : 'published'}">${closed ? '모집 완료' : '모집 중'}</span>
          <h3>${campaign.isDemo ? '투자 검토 연습' : (closed ? 'FIFO 투자 예약' : '실제 투자')}</h3>
          <p>${campaign.isDemo ? '가상 사업체로 계획·위험·입지·지급 조건을 확인하는 예시입니다. 실제 금액은 등록되지 않습니다.' : closed ? '기존 투자자의 회수 요청과 1,000원 단위로 선착순 자동 매칭됩니다. 펀드 총액은 변하지 않습니다.' : '1인 한도는 목표액의 1%이며, 모집 중에는 즉시 투자잔액에 반영됩니다.'}</p>
          <form id="commitmentForm">
            <label>${closed ? '예약 금액' : '투자 금액'}<input id="commitmentAmount" type="number" min="1000" step="1000" value="100000" required></label>
            <label class="check-line"><input id="commitmentRisk" type="checkbox" required> 원금 손실 가능성과 사업·증빙 위험을 확인했습니다.</label>
            ${commitButtonHtml}
          </form>
        </aside>
      </div>
    </div>`;

  openModal('campaignModal');

  $$('.detail-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.detail-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      const targetTab = btn.dataset.detailTab;
      $$('.detail-tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === 'detailTab-' + targetTab);
        pane.classList.toggle('hidden', pane.id !== 'detailTab-' + targetTab);
      });
    });
  });

  $('#promptLoginCommit')?.addEventListener('click', () => {
    closeModal($('#campaignModal'));
    selectQuickRole('investor');
    openModal('authModal');
  });
  $('#commitmentForm').addEventListener('submit', submitCommitment);
}

async function submitCommitment(event) {
  event.preventDefault();
  if (state.currentCampaign?.isDemo) {
    closeModal($('#campaignModal'));
    showToast('가상 예시 검토를 완료했습니다. 실제 참여금은 등록되지 않았습니다.', 'info');
    return;
  }
  if (!state.user) {
    showToast('로그인이 필요합니다. 간편 로그인을 진행해 주세요.', 'info');
    closeModal($('#campaignModal'));
    selectQuickRole('investor');
    openModal('authModal');
    return;
  }
  if (state.user.role !== 'investor') return;
  const amount = Number($('#commitmentAmount').value);
  if (amount < 1000 || !$('#commitmentRisk').checked) {
    showToast('금액과 위험 확인 동의를 확인해 주세요.', 'error');
    return;
  }
  const submit = $('#commitmentForm button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await apiRequest('/api/invest', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: state.currentCampaign.id,
        amount,
        riskConsent: true
      })
    });
    closeModal($('#campaignModal'));
    await refreshData(result.mode === 'reserved' ? '투자 예약을 등록했습니다. 회수 요청과 FIFO로 자동 매칭됩니다.' : '투자잔액에 반영됐고 쿠폰 할인율 적립이 시작됐습니다.');
    $('#myCommitmentsSection').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
}

function ownerModel() {
  if (state.user?.role === 'owner') {
    const campaign = state.owner?.campaigns?.[0] || null;
    return {
      business: state.owner?.business || null,
      campaigns: state.owner?.campaigns || [],
      campaign,
      disclosures: state.owner?.disclosures || [],
      metrics: state.owner?.metrics || null,
      financialVerification: state.owner?.financialVerification || null,
      assessment: state.owner?.assessment || null,
      readOnly: false
    };
  }
  const campaign = state.adminPreviewCampaign || state.admin?.campaigns?.[0] || null;
  return {
    business: campaign?.business || null,
    campaigns: campaign ? [campaign] : [],
    campaign,
    disclosures: [],
    metrics: null,
    financialVerification: null,
    assessment: campaign?.assessment || null,
    readOnly: true
  };
}

function renderOwner() {
  if (!state.user || !['owner', 'admin'].includes(state.user.role)) return;
  const model = ownerModel();
  const campaign = model.campaign;
  $('#ownerName').textContent = model.readOnly
    ? (model.business?.name || '선택된 사업')
    : state.user.name + ' 사장님';
  renderOwnerProgress(model);
  renderDisclosures(model.disclosures);
  fillBusinessForm(model.business);
  fillMetricsForm(model);
  renderFinancialVerification(model.financialVerification);
  renderAssessment(model.assessment);
  renderAssessmentExplanation(model);
  fillCampaignForm(campaign);
  renderOwnerExecution(campaign);
  renderOwnerFundDashboard(campaign);
  setOwnerReadOnly(model.readOnly);
  showOwnerStep(state.ownerStep, false);
}

function renderOwnerProgress(model) {
  const campaign = model.campaign;
  $('#businessStepState').textContent = model.business ? '저장 완료' : '시작 전';
  const financialApproved = model.financialVerification?.status === 'approved' && model.assessment?.isOfficial;
  $('#riskStepState').textContent = financialApproved ? '공식 검증 완료'
    : model.metrics ? '원자료 검증 필요' : '시작 전';
  $('#campaignStepState').textContent = campaign
    ? (campaignStatusLabels[campaign.status] || campaign.status) : '시작 전';
  const releasedCount = campaign?.milestones?.filter(item => item.status === 'released').length || 0;
  $('#executionStepState').textContent = campaign?.status === 'published'
    ? releasedCount + ' / ' + campaign.milestones.length + ' 지급' : '공개 승인 후';
  const status = $('#ownerCampaignStatus');
  status.textContent = campaign ? (campaignStatusLabels[campaign.status] || campaign.status) : '모집안 없음';
  status.className = 'status-pill ' + (campaign?.status || '');
  const complete = {
    business: Boolean(model.business),
    risk: Boolean(financialApproved),
    campaign: Boolean(campaign),
    execution: Boolean(campaign?.milestones?.some(item => item.status === 'released'))
  };
  $$('[data-owner-step]').forEach(button => {
    button.classList.toggle('complete', complete[button.dataset.ownerStep]);
  });
}

const ownerStepMeta = {
  business: ['1단계', '사업체 기본정보'],
  risk: ['2단계', '재무·위험 자료'],
  campaign: ['3단계', '모집안과 지급조건'],
  execution: ['4단계', '증빙과 자금 집행']
};

function showOwnerStep(step, scroll = true) {
  state.ownerStep = step;
  $$('.owner-step').forEach(section => section.classList.toggle('active', section.id === 'ownerStep-' + step));
  $$('[data-owner-step]').forEach(button => button.classList.toggle('active', button.dataset.ownerStep === step));
  $('#ownerStepEyebrow').textContent = ownerStepMeta[step][0];
  $('#ownerStepTitle').textContent = ownerStepMeta[step][1];
  if (scroll) $('.workspace-main').scrollIntoView({ behavior: 'smooth' });
}
$$('[data-owner-step]').forEach(button => {
  button.addEventListener('click', () => showOwnerStep(button.dataset.ownerStep));
});

function setOwnerReadOnly(readOnly) {
  if (!readOnly) return;
  ['businessForm', 'metricsForm', 'financialVerificationForm', 'disclosureForm', 'campaignForm', 'evidenceForm', 'monthlySalesForm', 'dividendCouponForm', 'ownerFundDashboard'].forEach(id => {
    $$('input, select, textarea, button', $('#' + id)).forEach(element => { element.disabled = true; });
  });
  $('#businessVerificationBadge').textContent = '운영자 미리보기';
}

function defaultBusinessMenuRows() {
  return [
    { name: '', price: '', category: '대표', description: '', isSignature: true }
  ];
}

function renderBusinessMenuRows(items) {
  const rows = (items && items.length) ? items : defaultBusinessMenuRows();
  const container = $('#businessMenuRows');
  if (!container) return;
  container.innerHTML = rows.map((item, index) =>
    `<div class="menu-edit-row">
      <div class="menu-edit-top">
        <label class="menu-name-label"><span>메뉴명</span><input class="menu-edit-name" required placeholder="예: 시그니처 솥밥" value="${escapeHTML(item.name || '')}"></label>
        <label class="menu-price-label"><span>가격(원)</span><input class="menu-edit-price" type="number" min="0" step="500" required placeholder="14000" value="${item.price || ''}"></label>
        <label class="menu-cat-label"><span>분류</span><input class="menu-edit-category" placeholder="식사/디저트" value="${escapeHTML(item.category || '')}"></label>
        <label class="menu-sig-label"><input class="menu-edit-signature" type="checkbox" ${item.isSignature ? 'checked' : ''}><span>시그니처 ⭐</span></label>
        <button type="button" class="remove-menu-row" aria-label="메뉴 삭제">×</button>
      </div>
      <label class="menu-desc-label"><span>메뉴 설명 및 맛 특징</span><input class="menu-edit-desc" placeholder="예: 6가지 제철 버섯과 밤을 넣은 가마솥밥" value="${escapeHTML(item.description || '')}"></label>
    </div>`
  ).join('');
}

function collectBusinessMenuRows() {
  return $$('.menu-edit-row').map(row => ({
    name: $('.menu-edit-name', row)?.value.trim() || '',
    price: Number($('.menu-edit-price', row)?.value || 0),
    category: $('.menu-edit-category', row)?.value.trim() || '',
    description: $('.menu-edit-desc', row)?.value.trim() || '',
    isSignature: Boolean($('.menu-edit-signature', row)?.checked)
  })).filter(item => item.name);
}

function fillBusinessForm(business) {
  $('#businessName').value = business?.name || '';
  $('#businessCategory').value = business?.category || '한식';
  $('#businessNumber').value = business?.number || '';
  $('#businessRepresentative').value = business?.representativeName || '';
  $('#businessOpeningDate').value = business?.openingDate || '';
  $('#businessAge').value = business?.age || '';
  $('#businessAddress').value = business?.address || '';
  $('#businessDescription').value = business?.description || '';
  $('#businessOwnerStory').value = business?.ownerStory || '';
  $('#businessHighlights').value = Array.isArray(business?.highlights)
    ? business.highlights.join(', ')
    : (typeof business?.highlights === 'string' ? business.highlights : '');
  renderBusinessMenuRows(business?.menuItems);
  $('#businessSales').value = business?.sales || '';
  $('#businessLicense').checked = Boolean(business?.restaurantLicenseConfirmed);
  $('#businessApplicantMatch').checked = Boolean(business?.applicantIsRepresentative);
  $('#businessPosConsent').checked = Boolean(business?.posDataConsent);
  $('#businessCardConsent').checked = Boolean(business?.cardSalesConsent);
  const labels = {
    unverified: '미확인',
    pending: '확인 중',
    verified: '운영자 확인',
    rejected: '보완 필요'
  };
  $('#businessVerificationBadge').textContent = labels[business?.verificationStatus] || '미확인';
  if (business?.address) renderOwnerLocationAnalysis(business.address, false);
  else {
    state.ownerAreaCode = '';
    $('#ownerLocationResult').classList.add('hidden');
    $('#locationMetricsSource').textContent = '사업체 주소를 분석하면 아래 4개 지표를 자동으로 채울 수 있습니다.';
  }
}

$('#addBusinessMenuRow')?.addEventListener('click', () => {
  const rows = collectBusinessMenuRows();
  rows.push({ name: '', price: '', category: '', description: '', isSignature: false });
  renderBusinessMenuRows(rows);
});

$('#businessMenuRows')?.addEventListener('click', event => {
  const button = event.target.closest('.remove-menu-row');
  if (!button) return;
  const rows = collectBusinessMenuRows();
  if (rows.length <= 1) {
    showToast('메뉴는 최소 1개 이상 등록해 주세요.', 'info');
    return;
  }
  button.closest('.menu-edit-row').remove();
});

$('#generateAiStoreStory')?.addEventListener('click', async () => {
  const name = $('#businessName').value.trim();
  const category = $('#businessCategory').value;
  const address = $('#businessAddress').value.trim();
  const button = $('#generateAiStoreStory');
  button.disabled = true;
  button.textContent = '스토리 생성 중... ✨';
  try {
    const res = await apiRequest('/api/ai?mode=story-generator', {
      method: 'POST',
      body: JSON.stringify({ name, category, address })
    });
    if (res.story) {
      if (res.story.description) $('#businessDescription').value = res.story.description;
      if (res.story.ownerStory) $('#businessOwnerStory').value = res.story.ownerStory;
      if (res.story.highlights) {
        $('#businessHighlights').value = Array.isArray(res.story.highlights)
          ? res.story.highlights.join(', ')
          : res.story.highlights;
      }
      if (res.story.menuItems?.length) renderBusinessMenuRows(res.story.menuItems);
      showToast('AI가 매장 소개와 사장님의 한마디, 추천 메뉴판을 작성했습니다!');
    }
  } catch (error) {
    showToast('스토리 생성 중 오류가 발생했습니다: ' + error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'AI로 스토리·메뉴 채우기 ✨';
  }
});

function renderOwnerLocationAnalysis(address, applyMetrics = false) {
  const result = $('#ownerLocationResult');
  const area = getCommercialAreaByAddress(address);
  result.classList.remove('hidden');
  if (!area) {
    state.ownerAreaCode = '';
    result.innerHTML = '<div class="location-empty"><strong>주소는 입력할 수 있지만 자동 분석 데이터가 아직 없습니다</strong>'
      + '<p>현재 연결된 예시 상권은 성수·연남·서촌·행궁동·전포·대전 중앙로입니다. 지원 외 주소는 운영자가 최신 공공데이터를 확인한 뒤 지표를 보완해야 합니다.</p></div>';
    $('#locationMetricsSource').textContent = '입력한 주소에 연결된 예시 상권 데이터가 없어 직접 입력이 필요합니다.';
    return;
  }
  state.ownerAreaCode = area.areaCode;
  const category = $('#businessCategory').value;
  const insight = getCommercialInsightCards(area, category);
  const applyButton = state.user?.role === 'owner'
    ? '<button class="secondary-button" type="button" id="applyLocationMetrics">상권 지표 4개 자동 채우기</button>'
    : '<span class="preview-label">읽기 전용 입지 분석</span>';
  result.innerHTML = '<div class="owner-location-heading"><div><span>매칭된 상권</span><strong>'
    + escapeHTML(area.areaName) + '</strong></div>' + applyButton + '</div>'
    + '<div class="owner-location-metrics"><span>유동인구 증감 <b>+' + area.growthRate + '%</b></span>'
    + '<span>상권 매출 증감 <b>+' + area.localSalesGrowth + '%</b></span>'
    + '<span>경쟁 밀도 <b>' + area.competitorDensity + '</b></span>'
    + '<span>주변 폐업률 <b>' + area.closureRate + '%</b></span></div>'
    + '<p><b>사업자 관점</b> ' + escapeHTML(insight.opportunity) + ' ' + escapeHTML(insight.caution) + '</p>';
  $('#locationMetricsSource').textContent = area.areaName + ' 데이터가 매칭되었습니다. 자동 채우기 후 원자료와 기준일을 확인해 주세요.';
  $('#applyLocationMetrics')?.addEventListener('click', () => applyOwnerAreaMetrics(area));
  if (applyMetrics) applyOwnerAreaMetrics(area);
}

function applyOwnerAreaMetrics(area) {
  if (!area || state.user?.role !== 'owner') return;
  $('#metricsFootTraffic').value = area.growthRate;
  $('#metricsLocalGrowth').value = area.localSalesGrowth;
  $('#metricsCompetition').value = area.competitorDensity;
  $('#metricsClosure').value = area.closureRate;
  $('#locationMetricsSource').innerHTML = '<b>' + escapeHTML(area.areaName)
    + '</b> 예시 데이터가 반영되었습니다. 기준일과 원자료는 운영자 심사에서 다시 확인합니다.';
  showToast('주소 기반 상권 지표 4개를 재무·위험 자료에 반영했습니다.');
}

$('#analyzeOwnerLocation').addEventListener('click', () => {
  const address = $('#businessAddress').value.trim();
  if (!address) {
    showToast('사업장 주소를 먼저 입력해 주세요.', 'info');
    $('#businessAddress').focus();
    return;
  }
  renderOwnerLocationAnalysis(address, false);
});

$('#businessAddress').addEventListener('change', () => {
  state.ownerAreaCode = '';
  $('#ownerLocationResult').classList.add('hidden');
  $('#locationMetricsSource').textContent = '주소가 변경되었습니다. 입지 분석 후 지표를 다시 반영해 주세요.';
});

$('#businessForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'owner') return;
  const button = $('#businessForm button[type="submit"]');
  button.disabled = true;
  try {
    const rawHighlights = $('#businessHighlights').value;
    const highlights = rawHighlights.split(',').map(s => s.trim()).filter(Boolean);
    const menuItems = collectBusinessMenuRows();
    await apiRequest('/api/business', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#businessName').value.trim(),
        category: $('#businessCategory').value,
        number: $('#businessNumber').value.trim(),
        representativeName: $('#businessRepresentative').value.trim(),
        openingDate: $('#businessOpeningDate').value,
        age: Number($('#businessAge').value),
        address: $('#businessAddress').value.trim(),
        description: $('#businessDescription').value.trim(),
        ownerStory: $('#businessOwnerStory').value.trim(),
        highlights,
        menuItems,
        sales: Number($('#businessSales').value),
        restaurantLicenseConfirmed: $('#businessLicense').checked,
        applicantIsRepresentative: $('#businessApplicantMatch').checked,
        posDataConsent: $('#businessPosConsent').checked,
        cardSalesConsent: $('#businessCardConsent').checked
      })
    });
    await refreshData('사업체 정보를 저장했습니다.');
    showOwnerStep('risk');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function renderDisclosures(values = []) {
  $$('input[name="disclosure"]').forEach(input => {
    input.checked = values.includes(input.value);
  });
  $('#disclosureProgress').textContent = values.length + ' / 6';
}
$('#disclosureForm').addEventListener('change', () => {
  $('#disclosureProgress').textContent = $$('input[name="disclosure"]:checked').length + ' / 6';
});
$('#disclosureForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'owner') return;
  const values = $$('input[name="disclosure"]:checked').map(input => input.value);
  try {
    await apiRequest('/api/disclosures', {
      method: 'POST',
      body: JSON.stringify({ values })
    });
    await refreshData('투자자 공개 항목을 저장했습니다.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

function fillMetricsForm(model) {
  const metrics = model.metrics;
  if (!metrics) {
    if (!$('#metricsSales6m').value && model.business?.sales) {
      $('#metricsSales6m').value = Array(6).fill(model.business.sales).join(', ');
    }
    return;
  }
  $('#metricsSales6m').value = (metrics.sales_6m || []).join(', ');
  $('#metricsCashFlow').value = metrics.operating_cash_flow;
  $('#metricsCardSales6m').value = (metrics.card_sales_6m || []).join(', ');
  $('#metricsCashSales6m').value = (metrics.cash_sales_6m || []).join(', ');
  $('#metricsDebtTotal').value = metrics.debt_total;
  $('#metricsDebtPayment').value = metrics.monthly_debt_payment;
  $('#metricsOverdue').value = metrics.overdue_count;
  $('#metricsEmployees').value = metrics.employee_count;
  $('#metricsTax').value = String(metrics.tax_compliant);
  $('#metricsFootTraffic').value = metrics.foot_traffic_growth;
  $('#metricsLocalGrowth').value = metrics.local_sales_growth;
  $('#metricsCompetition').value = metrics.competitor_density;
  $('#metricsClosure').value = metrics.closure_rate;
  $('#metricsRepeat').value = metrics.repeat_rate;
  $('#metricsDigital').value = metrics.digital_sales_ratio;
  $('#metricsFixedCost').value = metrics.monthly_fixed_cost || 0;
  $('#metricsRent').value = metrics.monthly_rent || 0;
  $('#metricsLabor').value = metrics.monthly_labor_cost || 0;
  $('#metricsMaterial').value = metrics.monthly_material_cost || 0;
  $('#metricsAdministrativeActions').value = metrics.administrative_action_count || 0;
  $('#metricsRepresentativeChanges').value = metrics.representative_change_count || 0;
}

function collectMetricClaims() {
  const sales6m = $('#metricsSales6m').value.split(/[\s,]+/).filter(Boolean).map(Number);
  const optionalSeries = id => $(id).value.split(/[\s,]+/).filter(Boolean).map(Number);
  const cardSales6m = optionalSeries('#metricsCardSales6m');
  const cashSales6m = optionalSeries('#metricsCashSales6m');
  if (sales6m.length !== 6 || sales6m.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('최근 6개월 매출을 쉼표로 구분해 정확히 6개 입력해 주세요.');
  }
  if ([cardSales6m, cashSales6m].some(values => values.length && (values.length !== 6 || values.some(value => !Number.isFinite(value) || value < 0)))) {
    throw new Error('카드·현금 매출은 비워두거나 각각 6개를 입력해 주세요.');
  }
  return {
    sales6m, cardSales6m, cashSales6m,
    operatingCashFlow: Number($('#metricsCashFlow').value),
    debtTotal: Number($('#metricsDebtTotal').value),
    monthlyDebtPayment: Number($('#metricsDebtPayment').value),
    overdueCount: Number($('#metricsOverdue').value),
    employeeCount: Number($('#metricsEmployees').value),
    taxCompliant: $('#metricsTax').value === 'true',
    footTrafficGrowth: Number($('#metricsFootTraffic').value),
    localSalesGrowth: Number($('#metricsLocalGrowth').value),
    competitorDensity: Number($('#metricsCompetition').value),
    closureRate: Number($('#metricsClosure').value),
    repeatRate: Number($('#metricsRepeat').value),
    digitalSalesRatio: Number($('#metricsDigital').value),
    monthlyFixedCost: Number($('#metricsFixedCost').value),
    monthlyRent: Number($('#metricsRent').value),
    monthlyLaborCost: Number($('#metricsLabor').value),
    monthlyMaterialCost: Number($('#metricsMaterial').value),
    administrativeActionCount: Number($('#metricsAdministrativeActions').value),
    representativeChangeCount: Number($('#metricsRepresentativeChanges').value)
  };
}

$('#metricsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'owner') return;
  if (!state.owner?.business) {
    showToast('사업체 정보를 먼저 저장해 주세요.', 'info');
    showOwnerStep('business');
    return;
  }
  const button = $('#metricsForm button[type="submit"]');
  button.disabled = true;
  try {
    await apiRequest('/api/business/metrics', {
      method: 'POST',
      body: JSON.stringify(collectMetricClaims())
    });
    await refreshData('사업자 주장을 저장했습니다. 근거자료 검증 전에는 공식 심사에 사용할 수 없습니다.');
    showOwnerStep('risk', false);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

const verificationStatusLabels = {
  needs_documents: '자료 보완', mismatch: '불일치 확인', ready_for_admin: '운영자 검토 대기',
  approved: '공식 검증 완료', rejected: '검증 반려'
};

function renderFinancialVerification(verification) {
  const badge = $('#financialVerificationBadge');
  const result = $('#financialVerificationStatus');
  if (!badge || !result) return;
  badge.textContent = verificationStatusLabels[verification?.status] || '자료 대기';
  badge.className = 'status-pill ' + (verification?.status === 'approved' ? 'published' : verification ? 'submitted' : '');
  result.classList.toggle('hidden', !verification);
  if (!verification) return;
  const flow = verification.orchestration || {};
  const statusLabel = value => ({ passed: '통과', matched: '일치', review: '확인 필요', failed: '실패', pending: '대기' }[value] || value);
  result.innerHTML = '<div class="verification-summary"><strong>' + escapeHTML(verificationStatusLabels[verification.status] || verification.status)
    + '</strong><span>문서 ' + Number(flow.documentCount || verification.documents?.length || 0) + '개 · OCR 평균 신뢰도 '
    + Math.round(Number(flow.averageConfidence || 0) * 100) + '%</span></div>'
    + '<div class="verification-steps">' + (flow.steps || []).map(step => '<div class="' + escapeHTML(step.status) + '"><b>'
      + escapeHTML(statusLabel(step.status)) + '</b><span>' + escapeHTML(step.label) + '</span></div>').join('') + '</div>'
    + (flow.missingDocuments?.length ? '<p class="verification-alert"><b>빠진 자료</b> ' + escapeHTML(flow.missingDocuments.join(', ')) + '</p>' : '')
    + (flow.mismatches?.length ? '<p class="verification-alert"><b>불일치</b> ' + escapeHTML(flow.mismatches.join(' ')) + '</p>' : '')
    + (flow.warnings?.length ? '<p class="verification-warning"><b>확인사항</b> ' + escapeHTML(flow.warnings.join(' ')) + '</p>' : '')
    + renderFinancialDocumentViewers(verification)
    + '<p class="privacy-note">현재 버전은 개인정보 노출을 줄이기 위해 원본 이미지를 DB에 저장하지 않고 구조화된 판독 결과와 SHA-256 지문만 저장합니다. 운영자 원본 열람용 비공개 스토리지는 후속 연결 항목입니다.</p>';
}

function comparisonStatusForBox(box, document, verification) {
  const fieldLabels = { monthlySales: '월평균 매출', debtTotal: '총 부채', monthlyDebtPayment: '월 상환액', taxCompliant: '세금 정상 납부' };
  if (box.field === 'businessNumber') {
    const expected = String(ownerModel().business?.number || verification?.business?.number || '').replace(/\D/g, '');
    const observed = String(document.businessNumber || box.value || '').replace(/\D/g, '');
    return expected && observed ? (expected === observed ? 'matched' : 'mismatch') : 'review';
  }
  const comparison = (verification?.orchestration?.comparisons || []).find(item =>
    item.source === document.filename && item.label === fieldLabels[box.field]);
  return comparison?.status || 'review';
}

function renderOcrViewer(image, boxes = [], statusResolver = () => 'review', title = '') {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(String(image || ''))) return '';
  const overlays = boxes.map(box => {
    const [x, y, width, height] = box.bbox || [];
    if (![x, y, width, height].every(Number.isFinite)) return '';
    const status = statusResolver(box);
    return '<span class="ocr-box ' + escapeHTML(status) + '" style="left:' + x / 10 + '%;top:' + y / 10
      + '%;width:' + width / 10 + '%;height:' + height / 10 + '%"><b>' + escapeHTML(box.label) + '</b><em>'
      + escapeHTML(box.value || '') + '</em></span>';
  }).join('');
  return '<figure class="ocr-viewer"><figcaption>' + escapeHTML(title) + '</figcaption><div><img src="' + image
    + '" alt="' + escapeHTML(title) + '">' + overlays + '</div><p><i></i>일치 <i></i>확인 필요 <i></i>불일치</p></figure>';
}

function renderFinancialDocumentViewers(verification) {
  const documents = verification?.documents || [];
  const viewers = documents.map((document, index) => renderOcrViewer(
    state.financialDocumentImages[index],
    document.boundingBoxes || [],
    box => comparisonStatusForBox(box, document, verification),
    document.filename || '재무 근거자료'
  )).filter(Boolean);
  if (!viewers.length) return '';
  return '<details class="ocr-viewer-group" open><summary>AI 필드 위치·입력값 대조</summary><p>원본은 이 브라우저 세션에서만 표시됩니다.</p><div>' + viewers.join('') + '</div></details>';
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(file.name + ' 파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

$('#financialVerificationForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'owner') return;
  if (!state.owner?.metrics) {
    showToast('먼저 사업자 주장 수치를 저장해 주세요.', 'info');
    return;
  }
  const files = [...$('#financialEvidenceFiles').files];
  if (!files.length || files.length > 6) {
    showToast('재무자료 이미지를 1개 이상 6개 이하로 선택해 주세요.', 'error');
    return;
  }
  if (files.some(file => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 6 * 1024 * 1024)) {
    showToast('각 파일은 PNG·JPG·WebP 형식의 6MB 이하여야 합니다.', 'error');
    return;
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
    showToast('한 번에 올리는 파일 합계는 20MB 이하여야 합니다.', 'error');
    return;
  }
  const button = $('#runFinancialVerification');
  button.disabled = true;
  button.textContent = '문서별 판독·대조 중…';
  try {
    const documents = await Promise.all(files.map(async file => ({ filename: file.name, image: await fileAsDataUrl(file) })));
    state.financialDocumentImages = documents.map(item => item.image);
    const data = await apiRequest('/api/ai/financial-verify', {
      method: 'POST', body: JSON.stringify({ claims: collectMetricClaims(), documents })
    });
    renderFinancialVerification({ ...(data.verification || {}), documents: data.documents, orchestration: data.orchestration,
      status: data.verification?.status || data.orchestration?.recommendedStatus });
    await refreshData(data.orchestration?.readyForAdminReview
      ? '교차검증을 마쳤습니다. 운영자 원본 검토 대기열로 보냈습니다.'
      : '교차검증을 마쳤습니다. 빠진 자료와 불일치 항목을 확인해 주세요.');
    showOwnerStep('risk', false);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = '자료 판독·교차검증 <span>→</span>';
  }
});

function renderAssessment(assessment) {
  const panel = $('#assessmentPanel');
  panel.classList.toggle('hidden', !assessment);
  if (!assessment) return;
  $('#assessmentScore').textContent = (assessment.isOfficial ? '공식 ' : '예비 ') + (assessment.grade || 'S5') + ' · ' + assessment.score;
  const labels = { low: '낮은 보완 위험', review: '추가 확인 필요', high: '집중 확인 필요' };
  $('#assessmentRisk').textContent = labels[assessment.riskLevel] || '추가 확인 필요';
  $('#assessmentRisk').className = 'risk-badge ' + assessment.riskLevel;
  $('#assessmentFactors').innerHTML = Object.entries(assessment.components || {}).map(([name, value]) =>
    '<div class="factor-row"><div><span>' + escapeHTML(name) + '</span><b>'
    + escapeHTML(value) + '점</b></div><i><span style="width:' + Math.min(100, Number(value)) + '%"></span></i></div>'
  ).join('');
  $('#assessmentMissing').textContent = assessment.missing?.length
    ? '추가 확인 자료: ' + assessment.missing.join(', ')
    : assessment.isOfficial ? '원자료 교차검증과 운영자 승인을 마친 공식 평가입니다.'
      : '입력값 기반 예비점검입니다. 원자료 검증 전에는 모집 승인 근거가 아닙니다.';
}

function renderAssessmentExplanation(model) {
  const panel = $('#assessmentExplanation');
  const assessment = model.assessment;
  panel.classList.toggle('hidden', !assessment);
  if (!assessment) return;
  const metrics = model.metrics || {};
  const sales = metrics.sales_6m || [];
  const growth = sales.length > 1 && Number(sales[0]) > 0 ? (Number(sales.at(-1)) / Number(sales[0]) - 1) * 100 : 0;
  const positives = [];
  const risks = [];
  if (growth > 0) positives.push('최근 6개월 매출 ' + growth.toFixed(1) + '% 성장');
  else risks.push('최근 6개월 매출 정체 또는 감소');
  if (Number(metrics.overdue_count || 0) > 0) risks.push('연체 이력 ' + metrics.overdue_count + '회');
  else positives.push('최근 연체 이력 없음');
  if (Number(metrics.local_sales_growth || 0) > 0) positives.push('상권 매출 +' + metrics.local_sales_growth + '%');
  if (!metrics.tax_compliant) risks.push('세금 납부 상태 확인 필요');
  panel.innerHTML = '<div class="panel-heading"><div><p class="eyebrow">' + (assessment.isOfficial ? '공식 검증 평가' : '사업자 주장 기반 예비점검') + '</p><h3>' + escapeHTML(assessment.grade || 'S5')
    + ' 등급 · 펀딩 ' + (assessment.fundingLimit > 0 ? '가능' : '보완 필요') + '</h3></div><strong>최대 ' + won(assessment.fundingLimit) + '</strong></div>'
    + '<div class="explanation-columns"><div><b>긍정 요인</b><ul>' + (positives.length ? positives : ['입력 자료 추가 확인']).map(item => '<li>' + escapeHTML(item) + '</li>').join('')
    + '</ul></div><div><b>주요 위험</b><ul>' + (risks.length ? risks : ['중대한 정량 위험 신호 없음']).map(item => '<li>' + escapeHTML(item) + '</li>').join('') + '</ul></div></div>'
    + renderContributionWaterfall(assessment)
    + '<p>최근 매출·현금흐름·부채 상환 부담·운영 안정성·상권 지표를 함께 반영했습니다. '
    + (assessment.isOfficial ? '운영자가 원자료와 AI 교차검증 결과를 확인한 공식 평가입니다.' : '아직 원자료가 승인되지 않은 참고용 결과이며 모집 제출을 열지 않습니다.') + '</p>';
}

function defaultMilestones() {
  return [
    { title: '계약 확인', condition: '견적서와 공급 계약 확인', percent: 20, dueDate: '' },
    { title: '구매 착수', condition: '세금계산서와 결제 증빙 확인', percent: 40, dueDate: '' },
    { title: '설치 완료', condition: '완료 사진과 최종 비용 검수', percent: 40, dueDate: '' }
  ];
}

function renderMilestoneRows(items) {
  const rows = items?.length ? items : defaultMilestones();
  $('#milestoneRows').innerHTML = rows.map((item, index) =>
    '<div class="milestone-row"><b>' + (index + 1) + '</b>'
    + '<label>단계명<input class="milestone-title" required value="' + escapeHTML(item.title) + '"></label>'
    + '<label>달성 조건·필수 증빙<input class="milestone-condition" required value="' + escapeHTML(item.condition) + '"></label>'
    + '<label>지급 %<input class="milestone-percent" type="number" min="1" max="100" required value="' + item.percent + '"></label>'
    + '<button type="button" class="remove-milestone" aria-label="지급 단계 삭제">×</button></div>'
  ).join('');
  updateMilestoneTotal();
}

function updateMilestoneTotal() {
  const total = $$('.milestone-percent').reduce((sum, input) => sum + Number(input.value || 0), 0);
  $('#milestoneTotal').textContent = total + '%';
  $('#milestoneTotal').style.color = total === 100 ? '#397c65' : '#a84838';
}

function fillCampaignForm(campaign) {
  $('#campaignName').value = campaign?.name || '';
  $('#campaignTarget').value = campaign?.target || 30000000;
  $('#campaignDuration').value = String(campaign?.duration || 30);
  $('#campaignPlan').value = campaign?.plan || '';
  $('#campaignRisk').value = campaign?.risk || '';
  $('#campaignMaxDiscount').value = String(campaign?.maxDiscountRate || 30);
  $('#campaignMinCoupon').value = campaign?.minCouponRate || 10;
  $('#campaignCouponMax').value = campaign?.couponMaxAmount || '';
  $('#campaignRepresentativeMenu').value = campaign?.representativeMenu || '';
  $('#campaignRepresentativePrice').value = campaign?.representativeMenuPrice || '';
  $('#campaignBenefits').value = campaign?.investorBenefits || '';
  renderMilestoneRows(campaign?.milestones);
  const editable = !campaign || ['draft', 'needs_changes'].includes(campaign.status);
  const officiallyVerified = state.owner?.assessment?.isOfficial
    && state.owner?.financialVerification?.status === 'approved';
  $('#submitCampaign').disabled = !editable || state.user?.role !== 'owner' || !officiallyVerified;
  $('#submitCampaign').title = officiallyVerified ? '' : '재무 원자료 검증과 운영자 승인이 먼저 필요합니다.';
  $('#campaignForm button[type="submit"]').disabled = !editable || state.user?.role !== 'owner';
  const message = $('#campaignReviewMessage');
  message.classList.toggle('hidden', !campaign?.reviewNote);
  message.textContent = campaign?.reviewNote ? '운영자 의견: ' + campaign.reviewNote : '';
}

$('#addMilestone').addEventListener('click', () => {
  const items = collectMilestones(false);
  if (items.length >= 8) {
    showToast('지급 단계는 최대 8개까지 만들 수 있습니다.', 'info');
    return;
  }
  items.push({ title: '', condition: '', percent: 0, dueDate: '' });
  renderMilestoneRows(items);
});
$('#milestoneRows').addEventListener('input', updateMilestoneTotal);
$('#milestoneRows').addEventListener('click', event => {
  const button = event.target.closest('.remove-milestone');
  if (!button) return;
  if ($$('.milestone-row').length <= 2) {
    showToast('지급 단계는 최소 2개가 필요합니다.', 'info');
    return;
  }
  button.closest('.milestone-row').remove();
  $$('.milestone-row').forEach((row, index) => { $('b', row).textContent = index + 1; });
  updateMilestoneTotal();
});

function collectMilestones(validate = true) {
  const items = $$('.milestone-row').map(row => ({
    title: $('.milestone-title', row).value.trim(),
    condition: $('.milestone-condition', row).value.trim(),
    percent: Number($('.milestone-percent', row).value),
    dueDate: ''
  }));
  if (validate) {
    if (items.length < 2 || items.some(item => !item.title || !item.condition || item.percent <= 0)) {
      throw new Error('각 지급 단계의 이름, 조건과 지급 비율을 모두 입력해 주세요.');
    }
    const total = items.reduce((sum, item) => sum + item.percent, 0);
    if (total !== 100) throw new Error('지급 비율 합계가 100%여야 합니다.');
  }
  return items;
}

async function persistCampaign() {
  if (state.user?.role !== 'owner') throw new Error('소상공인 계정에서만 저장할 수 있습니다.');
  if (!state.owner?.business) throw new Error('사업체 정보를 먼저 저장해 주세요.');
  const campaign = state.owner?.campaigns?.[0] || null;
  const target = Number($('#campaignTarget').value);
  const limit = Number(state.owner?.assessment?.fundingLimit || 0);
  if (!limit) throw new Error('재무·위험 심사를 먼저 완료해 주세요.');
  if (target > limit) throw new Error('목표금액은 AI 심사 최대 한도 ' + won(limit) + '를 초과할 수 없습니다.');
  const maxDiscountRate = Number($('#campaignMaxDiscount').value);
  const minCouponRate = Number($('#campaignMinCoupon').value);
  if (minCouponRate > maxDiscountRate) throw new Error('최소 발급 할인율은 최대 할인율보다 높을 수 없습니다.');
  const result = await apiRequest('/api/campaign', {
    method: 'POST',
    body: JSON.stringify({
      id: campaign?.id,
      name: $('#campaignName').value.trim(),
      target,
      duration: Number($('#campaignDuration').value),
      plan: $('#campaignPlan').value.trim(),
      risk: $('#campaignRisk').value.trim(),
      maxDiscountRate,
      minCouponRate,
      couponMaxAmount: Number($('#campaignCouponMax').value) || null,
      representativeMenu: $('#campaignRepresentativeMenu').value.trim(),
      representativeMenuPrice: Number($('#campaignRepresentativePrice').value) || 0,
      investorBenefits: $('#campaignBenefits').value.trim(),
      milestones: collectMilestones()
    })
  });
  return result.campaignId;
}

$('#campaignForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#campaignForm button[type="submit"]');
  button.disabled = true;
  try {
    await persistCampaign();
    await refreshData('모집안과 지급 조건을 저장했습니다.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#submitCampaign').addEventListener('click', async () => {
  const button = $('#submitCampaign');
  button.disabled = true;
  try {
    if (!state.owner?.assessment?.isOfficial || state.owner?.financialVerification?.status !== 'approved') {
      throw new Error('재무 원자료 교차검증과 운영자 승인을 먼저 완료해 주세요.');
    }
    const campaignId = await persistCampaign();
    await apiRequest('/api/campaign/submit', {
      method: 'POST',
      body: JSON.stringify({ campaignId })
    });
    await refreshData('운영자 심사를 요청했습니다. 승인 전에는 투자자에게 공개되지 않습니다.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function renderOwnerExecution(campaign) {
  const timeline = $('#ownerMilestoneFlow');
  if (!campaign) {
    timeline.innerHTML = '<div class="empty-state"><strong>저장된 모집안이 없습니다</strong>'
      + '<p>모집안과 단계별 지급 조건을 먼저 작성해 주세요.</p></div>';
    $('#evidenceMilestone').innerHTML = '<option value="">제출 가능한 단계 없음</option>';
    $('#analyzeEvidence').disabled = true;
    return;
  }
  timeline.innerHTML = campaign.milestones.map(item =>
    '<article class="execution-item ' + item.status + '"><b>' + item.sequence + '</b><div><strong>'
    + escapeHTML(item.title) + ' · ' + item.percent + '%</strong><small>'
    + escapeHTML(item.condition) + '</small></div><span>'
    + escapeHTML(milestoneStatusLabels[item.status] || item.status) + '</span></article>'
  ).join('');
  const eligible = campaign.milestones.filter((item, index) =>
    ['planned', 'rejected'].includes(item.status)
    && campaign.status === 'published'
    && campaign.milestones.slice(0, index).every(previous => previous.status === 'released')
  );
  $('#evidenceMilestone').innerHTML = eligible.length
    ? eligible.map(item => '<option value="' + item.id + '">' + item.sequence + '. '
      + escapeHTML(item.title) + ' (' + item.percent + '%)</option>').join('')
    : '<option value="">현재 제출 가능한 단계 없음</option>';
  $('#analyzeEvidence').disabled = !eligible.length || !state.evidenceImage || state.user?.role !== 'owner';
}

function renderOwnerFundDashboard(campaign) {
  const panel = $('#ownerFundDashboard');
  if (!campaign || campaign.status !== 'published') {
    panel.innerHTML = '<div class="empty-state"><strong>펀드 공개 승인 후 운영 현황이 표시됩니다</strong><p>투자잔액·예약·회수·쿠폰 비용을 DB 기준으로 집계합니다.</p></div>';
    return;
  }
  const data = state.ownerFund || {};
  const summary = data.summary || {};
  const funded = campaign.currentAmount || 0;
  const percent = Math.min(100, funded / Math.max(campaign.target, 1) * 100);
  const estimatedGrossProfit = Math.max(0, Number(summary.couponRevenue || 0) * .65 - Number(summary.discountCost || 0));
  const burdenRatio = Number(summary.couponRevenue || 0) > 0 ? Number(summary.discountCost || 0) / summary.couponRevenue * 100 : 0;
  panel.innerHTML = '<div class="panel-heading"><div><p class="eyebrow">실시간 펀드·쿠폰 운영</p><h3>' + escapeHTML(campaign.name) + '</h3></div><span class="status-pill '
    + (campaign.fundStatus === 'closed' ? 'closed' : 'published') + '">' + (campaign.fundStatus === 'closed' ? '모집 완료' : '모집 중') + '</span></div>'
    + '<div class="owner-fund-stats"><article><small>펀드 총액</small><strong>' + won(funded) + '</strong><span>목표의 ' + percent.toFixed(1) + '%</span></article>'
    + '<article><small>투자자</small><strong>' + (summary.investorCount || 0) + '명</strong><span>예약 ' + won(summary.reservationAmount) + '</span></article>'
    + '<article><small>회수 요청</small><strong>' + won(summary.withdrawalAmount) + '</strong><span>FIFO 자동 매칭</span></article>'
    + '<article><small>쿠폰</small><strong>' + (summary.totalIssued || 0) + '장</strong><span>사용 ' + (summary.usedCount || 0) + ' · 미사용 ' + (summary.availableCount || 0) + '</span></article>'
    + '<article><small>쿠폰 주문 매출</small><strong>' + won(summary.couponRevenue) + '</strong><span>할인액 ' + won(summary.discountCost) + '</span></article>'
    + '<article><small>추정 매출총이익</small><strong>' + won(estimatedGrossProfit) + '</strong><span>평균 할인율 ' + (summary.averageDiscountRate || 0) + '%</span></article></div>'
    + (burdenRatio > 20 ? '<p class="cost-warning">현재 쿠폰 할인 부담이 쿠폰 주문 매출의 ' + burdenRatio.toFixed(1) + '%입니다. 최대 할인율이나 배당 쿠폰 지급 규모를 점검하세요.</p>' : '')
    + (campaign.fundStatus === 'fundraising' ? '<button class="secondary-button" type="button" id="closeFundNow">현재 ' + won(funded) + '으로 모집 직접 종료</button>' : '<p class="fund-lock-note">모집 종료 후 펀드 총액은 고정되며, 투자 예약과 회수 요청이 같은 금액으로 교체됩니다.</p>');
  $('#closeFundNow')?.addEventListener('click', async event => {
    if (!window.confirm('목표금액 미달이어도 현재 펀드 총액으로 모집을 종료할까요? 종료 후에는 예약·회수 매칭 방식으로만 거래됩니다.')) return;
    event.currentTarget.disabled = true;
    try {
      await apiRequest('/api/campaign/close', { method: 'POST', body: JSON.stringify({ campaignId: campaign.id }) });
      await refreshData('모집을 종료했습니다. 펀드 총액은 고정되고 FIFO 매칭이 시작됩니다.');
    } catch (error) { showToast(error.message, 'error'); event.currentTarget.disabled = false; }
  });
}

$('#monthlySalesForm').addEventListener('submit', async event => {
  event.preventDefault();
  const campaign = ownerModel().campaign;
  if (!campaign) return;
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    const result = await apiRequest('/api/owner/monthly-sales', { method: 'POST', body: JSON.stringify({
      yearMonth: $('#salesYearMonth').value + '-01', totalSales: Number($('#salesTotal').value),
      couponSales: Number($('#salesCouponRevenue').value), couponDiscountTotal: Number($('#salesDiscountTotal').value), couponsUsed: 0
    }) });
    await refreshData('월 매출을 미검증 기록으로 저장했습니다. 성장률은 참고값이며 원자료 검증 전에는 쿠폰 보너스를 지급하지 않습니다.');
  } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
});

$('#dividendCouponForm').addEventListener('submit', async event => {
  event.preventDefault();
  const campaign = ownerModel().campaign;
  if (!campaign) return;
  const button = $('button[type="submit"]', event.currentTarget);
  button.disabled = true;
  try {
    const result = await apiRequest('/api/owner/dividend', { method: 'POST', body: JSON.stringify({
      campaignId: campaign.id, title: $('#dividendTitle').value.trim(), description: $('#dividendDescription').value.trim(),
      benefitKind: $('#dividendKind').value, discountValue: Number($('#dividendValue').value), target: 'all'
    }) });
    event.currentTarget.reset();
    await refreshData('활성 투자자 ' + result.issuedCount + '명에게 배당 쿠폰을 지급했습니다.');
  } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
});

$('#evidenceFile').addEventListener('change', event => {
  const file = event.target.files[0];
  state.evidenceImage = '';
  state.evidenceResult = null;
  state.evidenceAnalysisId = null;
  $('#evidenceAnalysis').classList.add('hidden');
  $('#sendEvidence').disabled = true;
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 6 * 1024 * 1024) {
    showToast('PNG, JPG, WebP 형식의 6MB 이하 이미지를 선택해 주세요.', 'error');
    event.target.value = '';
    return;
  }
  state.evidenceFilename = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    state.evidenceImage = reader.result;
    $('#evidencePreview').src = state.evidenceImage;
    $('#evidencePreview').classList.remove('hidden');
    $('#analyzeEvidence').disabled = !$('#evidenceMilestone').value;
  };
  reader.readAsDataURL(file);
});

$('#analyzeEvidence').addEventListener('click', async () => {
  const campaign = ownerModel().campaign;
  const milestone = campaign?.milestones.find(item => item.id === $('#evidenceMilestone').value);
  if (!state.evidenceImage || !milestone) return;
  const button = $('#analyzeEvidence');
  button.disabled = true;
  button.textContent = '증빙을 분석하고 있습니다…';
  try {
    const data = await apiRequest('/api/ai/ocr', {
      method: 'POST',
      body: JSON.stringify({
        image: state.evidenceImage,
        filename: state.evidenceFilename,
        plan: campaign.plan + '\n현재 지급 조건: ' + milestone.condition
      })
    });
    state.evidenceResult = data.result;
    state.evidenceAnalysisId = data.analysisId;
    const warnings = Array.isArray(data.result.warnings) ? data.result.warnings : [];
    const planStatus = data.result.planMatch === '적합' ? 'matched' : data.result.planMatch === '부적합' ? 'mismatch' : 'review';
    $('#evidenceAnalysis').innerHTML = '<strong>계획 일치: '
      + escapeHTML(data.result.planMatch || '검토 필요') + '</strong>'
      + '<span>공급자 ' + escapeHTML(data.result.merchant || '판독 안 됨')
      + ' · 합계 ' + won(data.result.total) + '</span>'
      + (warnings.length ? '<p>' + warnings.map(escapeHTML).join(' · ') + '</p>' : '')
      + renderOcrViewer(state.evidenceImage, data.result.boundingBoxes || [], () => planStatus, state.evidenceFilename);
    $('#evidenceAnalysis').classList.remove('hidden');
    $('#sendEvidence').disabled = false;
    showToast('증빙 분석이 끝났습니다. 결과를 확인한 뒤 제출해 주세요.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '증빙 내용 다시 분석';
  }
});

$('#evidenceForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state.evidenceResult || !$('#evidenceMilestone').value) return;
  const button = $('#sendEvidence');
  button.disabled = true;
  try {
    await apiRequest('/api/evidence', {
      method: 'POST',
      body: JSON.stringify({
        milestoneId: $('#evidenceMilestone').value,
        analysisId: state.evidenceAnalysisId,
        filename: state.evidenceFilename,
        claimedAmount: Number($('#evidenceAmount').value),
        planMatch: state.evidenceResult.planMatch || '검토 필요',
        result: state.evidenceResult
      })
    });
    state.evidenceImage = '';
    state.evidenceResult = null;
    state.evidenceAnalysisId = null;
    $('#evidenceForm').reset();
    $('#evidencePreview').classList.add('hidden');
    $('#evidenceAnalysis').classList.add('hidden');
    await refreshData('증빙을 운영자 검토 대기열에 제출했습니다.');
    showOwnerStep('execution');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function renderAdmin() {
  if (state.user?.role !== 'admin' || !state.admin) return;
  const campaigns = state.admin.campaigns || [];
  const commitments = state.admin.commitments || [];
  const evidence = state.admin.evidence || [];
  const financial = state.admin.financialVerifications || [];
  const financialQueue = financial.filter(item => item.status === 'ready_for_admin');
  const campaignQueue = campaigns.filter(item => item.status === 'submitted');
  const escrowQueue = commitments.filter(item => item.status === 'committed');
  const evidenceQueue = evidence.filter(item => item.status === 'pending');
  const releaseQueue = campaigns.flatMap(item =>
    item.milestones.filter(milestone => milestone.status === 'approved')
  );
  $('#adminStats').innerHTML =
    '<article><small>재무 원자료 대기</small><strong>' + financialQueue.length + '</strong></article>'
    + '<article><small>모집 심사 대기</small><strong>' + campaignQueue.length + '</strong></article>'
    + '<article><small>예치 확인 대기</small><strong>' + escrowQueue.length + '</strong></article>'
    + '<article><small>증빙·지급 대기</small><strong>' + (evidenceQueue.length + releaseQueue.length) + '</strong></article>';
  $('#financialQueueCount').textContent = financialQueue.length;
  $('#campaignQueueCount').textContent = campaignQueue.length;
  $('#escrowQueueCount').textContent = escrowQueue.length;
  $('#evidenceQueueCount').textContent = evidenceQueue.length + releaseQueue.length;
  renderAdminFinancial(financial);
  renderAdminCampaigns(campaigns);
  renderAdminEscrow(commitments, campaigns);
  renderAdminEvidence(evidence, campaigns);
  renderAdminAudit(state.admin.audit || []);
  showAdminTab(state.adminTab);
}

function renderAdminFinancial(rows) {
  const list = $('#adminFinancialList');
  if (!rows.length) {
    list.innerHTML = '<div class="empty-state"><strong>제출된 재무 원자료 검증이 없습니다</strong></div>';
    return;
  }
  list.innerHTML = rows.map(item => {
    const flow = item.orchestration || {};
    const canApprove = item.status === 'ready_for_admin' && flow.readyForAdminReview === true;
    const final = ['approved', 'rejected'].includes(item.status);
    return '<article class="review-card"><div class="review-card-header"><div><span class="status-pill '
      + (item.status === 'approved' ? 'published' : item.status === 'rejected' ? 'rejected' : 'submitted') + '">'
      + escapeHTML(verificationStatusLabels[item.status] || item.status) + '</span><h3>'
      + escapeHTML(item.business?.name || '사업체 ' + String(item.businessId).slice(0, 8)) + '</h3><p>'
      + escapeHTML(item.business?.number || '') + ' · ' + shortDate(item.createdAt) + '</p></div><strong>문서 '
      + Number(flow.documentCount || item.documents?.length || 0) + '개</strong></div>'
      + '<div class="review-card-grid"><div><small>사업자 식별</small><strong>'
      + escapeHTML(flow.steps?.find(step => step.code === 'identity')?.status || '-') + '</strong></div><div><small>매출 대조</small><strong>'
      + escapeHTML(flow.steps?.find(step => step.code === 'sales')?.status || '-') + '</strong></div><div><small>부채 대조</small><strong>'
      + escapeHTML(flow.steps?.find(step => step.code === 'debt')?.status || '-') + '</strong></div><div><small>OCR 신뢰도</small><strong>'
      + Math.round(Number(flow.averageConfidence || 0) * 100) + '%</strong></div></div>'
      + (flow.missingDocuments?.length ? '<p class="verification-alert">빠진 자료: ' + escapeHTML(flow.missingDocuments.join(', ')) + '</p>' : '')
      + (flow.mismatches?.length ? '<p class="verification-alert">불일치: ' + escapeHTML(flow.mismatches.join(' ')) + '</p>' : '')
      + (final ? '<p class="review-note">운영자 기록: ' + escapeHTML(item.reviewNote || '기록 없음') + '</p>'
        : '<div class="review-actions"><input id="financialNote-' + item.id + '" placeholder="원본 대조 근거와 승인·반려 사유">'
          + '<button class="reject" type="button" data-financial-review="rejected" data-id="' + item.id + '">반려</button>'
          + '<button class="approve" type="button" data-financial-review="approved" data-id="' + item.id + '" '
          + (canApprove ? '' : 'disabled title="AI 교차검증을 모두 통과한 건만 승인할 수 있습니다."') + '>원본 확인·공식 승인</button></div>')
      + '</article>';
  }).join('');
}

function renderAdminCampaigns(campaigns) {
  const list = $('#adminCampaignList');
  const visible = campaigns.filter(item => ['submitted', 'needs_changes', 'published', 'rejected'].includes(item.status));
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state"><strong>심사할 모집안이 없습니다</strong></div>';
    return;
  }
  list.innerHTML = visible.map(item => {
    const assessment = item.assessment;
    return '<article class="review-card"><div class="review-card-header"><div><span class="status-pill '
      + item.status + '">' + escapeHTML(campaignStatusLabels[item.status] || item.status)
      + '</span><h3>' + escapeHTML(item.business?.name || item.name) + '</h3><p>'
      + escapeHTML(item.name) + ' · ' + escapeHTML(item.business?.address || '') + '</p></div>'
      + '<div class="review-header-actions"><button class="plain-button" type="button" data-audit-report="' + item.id + '">심사 보고서</button>'
      + '<button class="plain-button" type="button" data-preview-owner="' + item.id + '">소상공인 화면으로 보기</button></div></div>'
      + '<div class="review-card-grid"><div><small>사업자 상태</small><strong>'
      + escapeHTML(item.business?.verificationStatus || '미확인') + '</strong></div>'
      + '<div><small>위험 점검</small><strong>' + (assessment ? assessment.score + '점' : '자료 없음') + '</strong></div>'
      + '<div><small>평가 근거</small><strong>' + (assessment?.isOfficial ? '공식 원자료 승인' : '예비·미검증') + '</strong></div>'
      + '<div><small>목표 금액</small><strong>' + won(item.target) + '</strong></div>'
      + '<div><small>지급 조건</small><strong>' + item.milestones.length + '단계 · '
      + item.milestones.reduce((sum, milestone) => sum + milestone.percent, 0) + '%</strong></div></div>'
      + '<div class="risk-review"><div><strong>자금 사용계획</strong><br>'
      + escapeHTML(item.plan) + '</div><div><strong>사업자가 공개한 위험</strong><br>'
      + escapeHTML(item.risk) + '</div></div>'
      + '<div class="review-actions"><input id="campaignNote-' + item.id
      + '" placeholder="승인 근거 또는 보완 요청 사유" value="' + escapeHTML(item.reviewNote || '') + '">'
      + '<button type="button" data-campaign-review="needs_changes" data-id="' + item.id + '">보완 요청</button>'
      + '<button class="reject" type="button" data-campaign-review="rejected" data-id="' + item.id + '">반려</button>'
      + '<button class="approve" type="button" data-campaign-review="published" data-id="' + item.id + '" '
      + (assessment?.isOfficial ? '' : 'disabled title="공식 재무검증이 필요합니다."')
      + '>승인하고 공개</button></div></article>';
  }).join('');
}

function renderAdminEscrow(commitments, campaigns) {
  const list = $('#adminEscrowList');
  const visible = commitments.filter(item => ['committed', 'escrowed'].includes(item.status));
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state"><strong>확인할 참여 약정이 없습니다</strong></div>';
    return;
  }
  list.innerHTML = visible.map(item => {
    const campaign = campaigns.find(value => value.id === item.campaignId);
    return '<article class="review-card"><div class="review-card-header"><div><span class="status-pill '
      + (item.status === 'escrowed' ? 'published' : 'submitted') + '">'
      + escapeHTML(commitmentStatusLabels[item.status]) + '</span><h3>'
      + escapeHTML(campaign?.business?.name || '모집') + '</h3><p>'
      + escapeHTML(campaign?.name || '') + ' · ' + shortDate(item.createdAt) + '</p></div><strong>'
      + won(item.amount) + '</strong></div><div class="review-actions">'
      + '<button class="approve" type="button" data-confirm-escrow="' + item.id + '" '
      + (item.status === 'escrowed' ? 'disabled' : '') + '>예치 확인 완료</button></div></article>';
  }).join('');
}

function renderAdminEvidence(evidence, campaigns) {
  const list = $('#adminEvidenceList');
  const pending = evidence.filter(item => ['pending', 'approved'].includes(item.status));
  const releaseItems = campaigns.flatMap(campaign =>
    campaign.milestones.filter(item => item.status === 'approved').map(item => ({ campaign, milestone: item }))
  );
  if (!pending.length && !releaseItems.length) {
    list.innerHTML = '<div class="empty-state"><strong>검토할 증빙이나 지급 단계가 없습니다</strong></div>';
    return;
  }
  const evidenceCards = pending.map(item => {
    const campaign = campaigns.find(value => value.id === item.campaignId);
    const milestone = campaign?.milestones.find(value => value.id === item.milestoneId);
    const result = item.result || {};
    return '<article class="review-card"><div class="review-card-header"><div><span class="status-pill '
      + (item.status === 'approved' ? 'published' : 'submitted') + '">'
      + (item.status === 'pending' ? '증빙 심사 대기' : '증빙 승인') + '</span><h3>'
      + escapeHTML(campaign?.business?.name || '') + ' · ' + escapeHTML(milestone?.title || '') + '</h3><p>'
      + escapeHTML(item.filename) + ' · ' + shortDate(item.createdAt) + '</p></div><strong>'
      + won(item.claimedAmount) + '</strong></div>'
      + '<div class="review-card-grid"><div><small>계획 일치</small><strong>'
      + escapeHTML(item.planMatch) + '</strong></div><div><small>공급자</small><strong>'
      + escapeHTML(result.merchant || '판독 안 됨') + '</strong></div><div><small>문서 합계</small><strong>'
      + won(result.total) + '</strong></div><div><small>AI 신뢰도</small><strong>'
      + escapeHTML(result.confidence ?? '-') + '%</strong></div></div>'
      + (item.status === 'pending'
        ? '<div class="review-actions"><input id="evidenceNote-' + item.id
          + '" placeholder="원본 대조 결과와 승인·반려 사유"><button class="reject" type="button" data-evidence-review="rejected" data-id="'
          + item.id + '">증빙 반려</button><button class="approve" type="button" data-evidence-review="approved" data-id="'
          + item.id + '">증빙 승인</button></div>'
        : '') + '</article>';
  }).join('');
  const releaseCards = releaseItems.map(({ campaign, milestone }) =>
    '<article class="review-card"><div class="review-card-header"><div><span class="status-pill submitted">최종 지급 확인</span><h3>'
    + escapeHTML(campaign.business?.name || '') + ' · ' + escapeHTML(milestone.title) + '</h3><p>앞 단계 완료, 증빙 승인, 예치 잔액을 다시 확인합니다.</p></div><strong>'
    + won(Math.floor(campaign.target * milestone.percent / 100)) + '</strong></div>'
    + '<div class="review-actions"><button class="approve" type="button" data-release-milestone="'
    + milestone.id + '">조건 확인 후 지급 승인</button></div></article>'
  ).join('');
  list.innerHTML = evidenceCards + releaseCards;
}

function renderAdminAudit(rows) {
  $('#adminAuditList').innerHTML = rows.length
    ? rows.map(item =>
      '<div class="audit-row"><time>' + escapeHTML(shortDate(item.created_at)) + '</time><strong>'
      + escapeHTML(item.action) + '</strong><span>' + escapeHTML(item.entity_type)
      + ' · ' + escapeHTML(item.entity_id) + '</span></div>'
    ).join('')
    : '<div class="empty-state"><strong>감사 기록이 없습니다</strong></div>';
}

function showAdminTab(tab) {
  state.adminTab = tab;
  $$('.admin-tab').forEach(section => section.classList.toggle('active', section.id === 'adminTab-' + tab));
  $$('[data-admin-tab]').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tab));
}
$$('[data-admin-tab]').forEach(button => {
  button.addEventListener('click', () => showAdminTab(button.dataset.adminTab));
});

$('#adminCampaignList').addEventListener('click', async event => {
  const reportButton = event.target.closest('[data-audit-report]');
  if (reportButton) {
    const campaign = state.admin.campaigns.find(item => item.id === reportButton.dataset.auditReport);
    const verification = (state.admin.financialVerifications || []).find(item => item.businessId === campaign?.businessId) || null;
    state.auditReport = buildAuditReport({
      campaign,
      verification,
      evidence: state.admin.evidence || [],
      audit: state.admin.audit || []
    });
    $('#auditReportPreview').innerHTML = renderAuditReportHtml(state.auditReport);
    openModal('auditReportModal');
    return;
  }
  const preview = event.target.closest('[data-preview-owner]');
  if (preview) {
    state.adminPreviewCampaign = state.admin.campaigns.find(item => item.id === preview.dataset.previewOwner);
    switchView('owner');
    return;
  }
  const button = event.target.closest('[data-campaign-review]');
  if (!button) return;
  const note = $('#campaignNote-' + button.dataset.id).value.trim();
  if (button.dataset.campaignReview !== 'published' && !note) {
    showToast('보완 요청이나 반려 사유를 입력해 주세요.', 'error');
    return;
  }
  await runAdminAction(button, '/api/admin/campaign', {
    campaignId: button.dataset.id,
    decision: button.dataset.campaignReview,
    note
  }, '모집 심사 결과를 저장했습니다.');
});

function auditReportDocument() {
  return state.auditReport ? renderAuditReportHtml(state.auditReport, { standalone: true }) : '';
}

$('#downloadAuditReport')?.addEventListener('click', () => {
  const html = auditReportDocument();
  if (!html) return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'MOA-심사보고서-' + (state.auditReport.business.name || '사업체').replace(/[^\p{L}\p{N}_-]+/gu, '-') + '.html';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
});

$('#printAuditReport')?.addEventListener('click', () => {
  const html = auditReportDocument();
  if (!html) return;
  const preview = window.open('', '_blank');
  if (!preview) return showToast('인쇄 미리보기를 열려면 팝업을 허용해 주세요.', 'info');
  preview.opener = null;
  preview.document.write(html);
  preview.document.close();
  preview.addEventListener('load', () => preview.print(), { once: true });
});

$('#adminFinancialList').addEventListener('click', async event => {
  const button = event.target.closest('[data-financial-review]');
  if (!button) return;
  const note = $('#financialNote-' + button.dataset.id).value.trim();
  if (!note) {
    showToast('원본 대조 결과와 승인·반려 근거를 입력해 주세요.', 'error');
    return;
  }
  await runAdminAction(button, '/api/admin/financial-verification', {
    verificationId: button.dataset.id,
    decision: button.dataset.financialReview,
    note
  }, '재무 원자료 검토 결과를 저장했습니다.');
});

$('#adminEscrowList').addEventListener('click', async event => {
  const button = event.target.closest('[data-confirm-escrow]');
  if (!button) return;
  await runAdminAction(button, '/api/admin/escrow', {
    commitmentId: button.dataset.confirmEscrow
  }, '예치 확인 상태를 저장했습니다.');
});

$('#adminEvidenceList').addEventListener('click', async event => {
  const review = event.target.closest('[data-evidence-review]');
  if (review) {
    const note = $('#evidenceNote-' + review.dataset.id).value.trim();
    if (review.dataset.evidenceReview === 'rejected' && !note) {
      showToast('반려 사유를 입력해 주세요.', 'error');
      return;
    }
    await runAdminAction(review, '/api/admin/evidence', {
      evidenceId: review.dataset.id,
      decision: review.dataset.evidenceReview,
      note
    }, '증빙 검토 결과를 저장했습니다.');
    return;
  }
  const release = event.target.closest('[data-release-milestone]');
  if (release) {
    await runAdminAction(release, '/api/admin/release', {
      milestoneId: release.dataset.releaseMilestone
    }, '조건과 예치 잔액을 확인해 지급 승인 기록을 남겼습니다.');
  }
});

async function runAdminAction(button, path, body, message) {
  button.disabled = true;
  try {
    await apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
    await refreshData(message);
    switchView('admin', false);
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
  }
}

function buildAiContext() {
  const parts = [];
  if (state.currentCampaign) {
    parts.push('현재 투자자가 보는 모집: ' + JSON.stringify(state.currentCampaign));
    const campaignArea = getCommercialAreaByAddress(state.currentCampaign.business?.address);
    if (campaignArea) parts.push('주소 기반 상권 분석: ' + JSON.stringify(campaignArea));
  }
  const owner = ownerModel();
  if (owner.business) parts.push('현재 소상공인 사업: ' + JSON.stringify(owner.business));
  const ownerArea = getCommercialAreaByAddress(owner.business?.address);
  if (ownerArea) parts.push('사업장 주소 기반 상권 분석: ' + JSON.stringify(ownerArea));
  if (owner.campaign) parts.push('현재 모집안과 지급 단계: ' + JSON.stringify(owner.campaign));
  if (state.user?.role === 'owner') {
    parts.push('모아 제출 현황(누락 항목 판단의 기준): '
      + JSON.stringify(buildSubmissionStatus(owner, state.user.role)));
  } else {
    parts.push('모아 제출 현황: 소상공인 본인 화면이 아니므로 개별 누락 여부를 확정할 수 없음');
  }
  if (state.user?.role === 'admin' && state.admin) {
    parts.push('운영자 대기열 요약: 모집 ' + state.admin.campaigns.filter(item => item.status === 'submitted').length
      + '건, 증빙 ' + state.admin.evidence.filter(item => item.status === 'pending').length + '건');
  }
  return parts.join('\n');
}

function currentKnowledgeGraph() {
  const role = state.user?.role === 'owner' ? 'owner' : 'investor';
  const owner = ownerModel();
  const campaign = role === 'investor' ? state.currentCampaign : owner.campaign;
  const address = role === 'owner' ? owner.business?.address : campaign?.business?.address;
  return buildRoleKnowledgeGraph({
    role,
    campaign,
    owner,
    area: getCommercialAreaByAddress(address),
    portfolio: state.portfolio?.investments || []
  });
}

function updateChatContext() {
  const active = $('.view.active')?.id;
  $('#aiContextLabel').textContent = active === 'ownerView'
    ? '현재 사업·모집 단계의 자료를 함께 봅니다'
    : active === 'adminView'
      ? '현재 심사 대기열과 승인 조건을 함께 봅니다'
      : state.currentCampaign
        ? state.currentCampaign.business?.name + ' 모집을 함께 봅니다'
        : '현재 화면을 바탕으로 답합니다';
}

function openChat(prefill = '') {
  $('#aiDrawer').classList.add('open');
  $('#aiDrawer').setAttribute('aria-hidden', 'false');
  $('#drawerBackdrop').classList.add('open');
  document.body.classList.add('drawer-open');
  if (prefill) $('#chatInput').value = prefill;
  updateChatContext();
  setTimeout(() => $('#chatInput').focus(), 30);
}

function closeChat() {
  $('#aiDrawer').classList.remove('open');
  $('#aiDrawer').setAttribute('aria-hidden', 'true');
  $('#drawerBackdrop').classList.remove('open');
  document.body.classList.remove('drawer-open');
}

$('#aiFab').addEventListener('click', () => openChat());
$('#closeAiDrawer').addEventListener('click', closeChat);
$('#drawerBackdrop').addEventListener('click', closeChat);
$$('[data-open-chat]').forEach(button => {
  button.addEventListener('click', () => openChat(button.dataset.openChat));
});
$$('#chatSuggestions button').forEach(button => {
  button.addEventListener('click', () => {
    $('#chatInput').value = button.textContent;
    $('#chatForm').requestSubmit();
  });
});

$('#chatInput').addEventListener('input', event => {
  event.target.style.height = 'auto';
  event.target.style.height = Math.min(event.target.scrollHeight, 120) + 'px';
});
$('#chatInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('#chatForm').requestSubmit();
  }
});

function appendChatMessage(role, content, loading = false) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message ' + role + (loading ? ' loading' : '');
  const avatar = document.createElement('span');
  avatar.textContent = role === 'assistant' ? 'AI' : (state.user?.name?.slice(0, 1) || '나');
  const paragraph = document.createElement('p');
  paragraph.textContent = content;
  wrapper.append(avatar, paragraph);
  $('#chatMessages').append(wrapper);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  return wrapper;
}

$('#chatForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#chatInput');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  input.style.height = 'auto';
  appendChatMessage('user', question);
  state.chatHistory.push({ role: 'user', content: question });
  const loading = appendChatMessage('assistant', '근거와 확인할 자료를 정리하고 있습니다…', true);
  const submit = $('#chatForm button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await apiRequest('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        messages: state.chatHistory,
        context: buildAiContext(),
        knowledgeGraph: currentKnowledgeGraph(),
        submissionStatus: buildSubmissionStatus(ownerModel(), state.user?.role || '')
      })
    });
    loading.remove();
    appendChatMessage('assistant', data.message);
    state.chatHistory.push({ role: 'assistant', content: data.message });
  } catch (error) {
    loading.remove();
    appendChatMessage('assistant', '지금은 답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    submit.disabled = false;
    input.focus();
  }
});

async function initialize() {
  try {
    const data = await apiRequest('/api/bootstrap');
    applyBootstrap(data);
    renderDisclosures(state.owner?.disclosures || []);
    renderAll();
  } catch (error) {
    applyBootstrap({ campaigns: [] });
    renderAll();
    showToast('실시간 연결 없이 가상 투자 검토 예시를 표시합니다.', 'info');
  }
}

initialize();
