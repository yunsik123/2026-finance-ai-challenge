import { cloudConfigured, cloudRequest, cloudSessionHeaders } from './supabase-cloud.js';
import { DEMO_CAMPAIGNS } from './demo-campaigns.js';
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
  loginHistory: [],
  owner: null,
  admin: null,
  currentCampaign: null,
  adminPreviewCampaign: null,
  ownerStep: 'business',
  adminTab: 'campaigns',
  quickRole: 'investor',
  authRole: null,
  authAction: 'login',
  evidenceImage: '',
  evidenceFilename: '',
  evidenceResult: null,
  evidenceAnalysisId: null,
  chatHistory: [],
  investorAreaCode: '',
  ownerAreaCode: ''
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
  if (modal.id === 'authModal' && !state.user) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!$('.modal.open')) document.body.classList.remove('modal-open');
}

$$('[data-close-modal]').forEach(button => {
  button.addEventListener('click', () => closeModal(button));
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
  investor: '투자자로 바로 시작하기',
  owner: '소상공인으로 바로 시작하기',
  admin: '운영자로 바로 시작하기'
};

function selectQuickRole(role) {
  state.quickRole = role;
  $$('.quick-role-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.quickRole === role);
  });
  const label = quickRoleLabels[role] || '바로 시작하기';
  const submitLabel = $('#quickSubmitLabel');
  if (submitLabel) submitLabel.textContent = label;
  const nameInput = $('#quickAuthName');
  if (nameInput) nameInput.focus();
}

$$('.quick-role-btn').forEach(button => {
  button.addEventListener('click', () => selectQuickRole(button.dataset.quickRole));
});

$('#quickAuthForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#quickAuthSubmit');
  const nameInput = $('#quickAuthName');
  const name = nameInput.value.trim();
  if (!name) {
    showToast('이름 또는 닉네임을 입력해 주세요.', 'info');
    nameInput.focus();
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
        role: state.quickRole || 'investor',
        name
      })
    });
    nameInput.value = '';
    applyBootstrap(data);
    renderAll();
    showToast(state.user.name + '님, 환영합니다.');
  } catch (error) {
    showToast(error.message || '로그인에 실패했습니다.', 'error');
  } finally {
    submit.disabled = false;
    if (submitLabel) submitLabel.textContent = quickRoleLabels[state.quickRole || 'investor'];
  }
});

$('#toggleClassicAuth')?.addEventListener('click', () => {
  $('#quickRolePicker').classList.add('hidden');
  $('#quickAuthForm').classList.add('hidden');
  $('#toggleClassicAuth').parentElement.classList.add('hidden');
  $('#authForm').classList.remove('hidden');
  setAuthAction('login');
});

$('#backToQuickAuth')?.addEventListener('click', () => {
  $('#quickRolePicker').classList.remove('hidden');
  $('#quickAuthForm').classList.remove('hidden');
  $('#toggleClassicAuth').parentElement.classList.remove('hidden');
  $('#authForm').classList.add('hidden');
});

function setAuthAction(action) {
  state.authAction = action;
  $$('[data-auth-action]').forEach(button => {
    button.classList.toggle('active', button.dataset.authAction === action);
  });
  const signup = action === 'signup';
  $('#authNameLabel').classList.toggle('hidden', !signup);
  $('#authName').required = signup;
  $('#authSubmit').textContent = signup ? '회원가입하고 시작하기' : '로그인';
  $('#forgotPassword').classList.toggle('hidden', signup);
}

$$('[data-auth-action]').forEach(button => {
  button.addEventListener('click', () => setAuthAction(button.dataset.authAction));
});

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#authSubmit');
  submit.disabled = true;
  submit.textContent = '계정을 확인하고 있습니다…';
  try {
    const data = await apiRequest('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({
        action: state.authAction,
        role: state.quickRole || 'investor',
        name: $('#authName').value.trim(),
        email: $('#authEmail').value.trim(),
        password: $('#authPassword').value
      })
    });
    $('#authPassword').value = '';
    applyBootstrap(data);
    renderAll();
    showToast(state.user.name + '님, 환영합니다.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = state.authAction === 'signup' ? '회원가입하고 시작하기' : '로그인';
  }
});

$('#forgotPassword').addEventListener('click', async () => {
  const email = $('#authEmail').value.trim();
  if (!email) {
    showToast('재설정 안내를 받을 이메일을 먼저 입력해 주세요.', 'info');
    $('#authEmail').focus();
    return;
  }
  try {
    await apiRequest('/api/auth/recover', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    showToast('비밀번호 재설정 안내를 이메일로 보냈습니다.');
  } catch (error) {
    showToast(error.message, 'error');
  }
});

function renderInvestor() {
  renderCampaignGrid();
  renderCommitments();
}

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
  });
  renderCampaignGrid();
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

function renderCampaignGrid() {
  const grid = $('#campaignGrid');
  const query = $('#campaignSearch').value.trim().toLocaleLowerCase('ko');
  const campaigns = state.campaigns.filter(item => {
    const haystack = [
      item.name, item.business?.name, item.business?.category,
      item.business?.address, item.plan
    ].join(' ').toLocaleLowerCase('ko');
    const itemArea = getCommercialAreaByAddress(item.business?.address);
    const locationMatches = !state.investorAreaCode || itemArea?.areaCode === state.investorAreaCode;
    return locationMatches && (!query || haystack.includes(query));
  });
  if (!campaigns.length) {
    grid.innerHTML = '<div class="empty-state"><strong>현재 공개된 모집이 없습니다</strong>'
      + '<p>운영자 심사를 통과한 모집만 이곳에 표시됩니다.</p></div>';
    return;
  }
  const tones = ['#dce8e2', '#efd8cd', '#e7dfc7', '#d9e3eb'];
  grid.innerHTML = campaigns.map((item, index) => {
    const percent = Math.min(100, Math.round(item.escrowTotal / Math.max(item.target, 1) * 100));
    const assessment = item.assessment;
    const risk = assessment
      ? assessment.riskLevel === 'low' ? '낮은 보완 위험'
        : assessment.riskLevel === 'high' ? '집중 확인 필요' : '추가 확인 필요'
      : '자료 확인 필요';
    const area = getCommercialAreaByAddress(item.business?.address);
    return '<article class="campaign-card">'
      + '<div class="campaign-card-top" style="--card-tone:' + tones[index % tones.length] + '">'
      + '<span>' + (item.isDemo ? '가상 투자 검토 예시' : '운영자 심사 완료') + '</span><h3>' + escapeHTML(item.business?.name || item.name) + '</h3>'
      + '<p>' + escapeHTML(item.business?.address || '') + ' · ' + escapeHTML(item.business?.category || '') + '</p></div>'
      + '<div class="campaign-card-body"><p>' + escapeHTML(item.name) + '</p>'
      + '<div class="funding-bar"><span style="width:' + percent + '%"></span></div>'
      + '<div class="campaign-numbers"><strong>' + won(item.escrowTotal) + ' 예치 확인</strong><span>목표 ' + won(item.target) + '</span></div>'
      + '<div class="campaign-facts"><span>' + item.milestones.length + '단계 조건부 지급</span>'
      + '<span>' + escapeHTML(risk) + '</span>'
      + (area ? '<span class="area-fact">유동인구 ' + Math.round(area.dailyFootTraffic / 100) / 100 + '만 · 상권매출 +' + area.localSalesGrowth + '%</span>' : '') + '</div>'
      + '<button type="button" data-open-campaign="' + item.id + '">계획·위험·지급 조건 보기 →</button></div></article>';
  }).join('');
}

$('#campaignSearch').addEventListener('input', renderCampaignGrid);
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

function openCampaignDetail(id) {
  const campaign = state.campaigns.find(item => item.id === id)
    || state.admin?.campaigns?.find(item => item.id === id);
  if (!campaign) return;
  state.currentCampaign = campaign;
  const percent = Math.min(100, Math.round(campaign.escrowTotal / Math.max(campaign.target, 1) * 100));
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
      + assessment.score + '점</strong></div><p>점수만으로 승인하지 않습니다. 매출·현금흐름·부채·업력·상권 자료를 함께 본 보조 지표입니다.</p>'
      + '<div class="detail-factor-chips">' + Object.entries(assessment.components || {}).map(([key, value]) =>
        '<span>' + escapeHTML(key) + ' <b>' + escapeHTML(value) + '</b></span>'
      ).join('') + '</div></section>'
    : '';
  const commitButtonHtml = campaign.isDemo
    ? '<button class="primary-button full-button" type="submit">예시 투자 검토 완료 <span>→</span></button>'
    : isGuest
    ? '<button class="primary-button full-button" type="button" id="promptLoginCommit">로그인하고 참여하기 <span>→</span></button>'
    : '<button class="primary-button full-button" type="submit" ' + (canCommit ? '' : 'disabled')
      + '>' + (canCommit ? '참여 의사 등록' : '투자자 계정에서 참여 가능') + '</button>';

  $('#campaignDetailContent').innerHTML =
    '<div class="detail-hero"><span>' + (campaign.isDemo ? '가상 투자 검토 예시 · 실제 모집 아님' : '운영자 심사 완료 · 조건부 지급') + '</span><h2 id="campaignDetailTitle">'
    + escapeHTML(campaign.business?.name || campaign.name) + '</h2><p>'
    + escapeHTML(campaign.name) + '</p></div><div class="detail-body">'
    + '<div class="detail-summary"><div><small>목표 금액</small><strong>' + won(campaign.target) + '</strong></div>'
    + '<div><small>예치 확인</small><strong>' + won(campaign.escrowTotal) + ' · ' + percent + '%</strong></div>'
    + '<div><small>참여자</small><strong>' + campaign.investorCount + '명</strong></div>'
    + '<div><small>지급 완료</small><strong>' + won(released) + '</strong></div></div>'
    + '<div class="detail-columns"><div>'
    + '<section class="detail-section"><h3>사업과 자금 사용계획</h3><p>'
    + escapeHTML(campaign.business?.description || '') + '\n\n' + escapeHTML(campaign.plan) + '</p></section>'
    + '<section class="detail-section"><h3>공개된 주요 위험</h3><p>' + escapeHTML(campaign.risk) + '</p></section>'
    + assessmentHtml
    + (area ? '<section class="detail-section commercial-detail-section"><h3>주소로 확인한 입지</h3>'
      + renderCommercialInsightCards(area, campaign.business?.category) + '</section>' : '')
    + '<section class="detail-section"><h3>단계별 지급 조건</h3><div class="detail-milestones">'
    + milestones + '</div></section></div>'
    + '<aside class="commitment-form"><h3>' + (campaign.isDemo ? '투자 검토 연습' : '참여 약정') + '</h3>'
    + '<p>' + (campaign.isDemo ? '가상 사업체로 계획·위험·입지·지급 조건을 확인하는 예시입니다. 실제 금액은 등록되지 않습니다.' : '아래 금액은 참여 의사 등록입니다. 결제·예치 확인 전에는 지급 재원으로 계산되지 않습니다.') + '</p>'
    + '<form id="commitmentForm"><label>참여 금액<input id="commitmentAmount" type="number" min="1000" step="1000" value="100000" required></label>'
    + '<label class="check-line"><input id="commitmentRisk" type="checkbox" required> 원금 손실 가능성과 사업·증빙 위험을 확인했습니다.</label>'
    + commitButtonHtml + '</form></aside>'
    + '</div></div>';
  openModal('campaignModal');
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
    await apiRequest('/api/commitments', {
      method: 'POST',
      body: JSON.stringify({
        campaignId: state.currentCampaign.id,
        amount,
        riskConsent: true
      })
    });
    closeModal($('#campaignModal'));
    await refreshData('참여 의사가 등록되었습니다. 예치 확인 전에는 자금이 지급되지 않습니다.');
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
  renderAssessment(model.assessment);
  fillCampaignForm(campaign);
  renderOwnerExecution(campaign);
  setOwnerReadOnly(model.readOnly);
  showOwnerStep(state.ownerStep, false);
}

function renderOwnerProgress(model) {
  const campaign = model.campaign;
  $('#businessStepState').textContent = model.business ? '저장 완료' : '시작 전';
  $('#riskStepState').textContent = model.assessment ? '점검 완료' : '시작 전';
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
    risk: Boolean(model.assessment),
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
  ['businessForm', 'metricsForm', 'disclosureForm', 'campaignForm', 'evidenceForm'].forEach(id => {
    $$('input, select, textarea, button', $('#' + id)).forEach(element => { element.disabled = true; });
  });
  $('#businessVerificationBadge').textContent = '운영자 미리보기';
}

function fillBusinessForm(business) {
  $('#businessName').value = business?.name || '';
  $('#businessCategory').value = business?.category || '한식';
  $('#businessNumber').value = business?.number || '';
  $('#businessAge').value = business?.age || '';
  $('#businessAddress').value = business?.address || '';
  $('#businessDescription').value = business?.description || '';
  $('#businessSales').value = business?.sales || '';
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
    await apiRequest('/api/business', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#businessName').value.trim(),
        category: $('#businessCategory').value,
        number: $('#businessNumber').value.trim(),
        age: Number($('#businessAge').value),
        address: $('#businessAddress').value.trim(),
        description: $('#businessDescription').value.trim(),
        sales: Number($('#businessSales').value)
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
}

$('#metricsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.user?.role !== 'owner') return;
  if (!state.owner?.business) {
    showToast('사업체 정보를 먼저 저장해 주세요.', 'info');
    showOwnerStep('business');
    return;
  }
  const sales6m = $('#metricsSales6m').value.split(/[\s,]+/).filter(Boolean).map(Number);
  if (sales6m.length !== 6 || sales6m.some(value => !Number.isFinite(value) || value < 0)) {
    showToast('최근 6개월 매출을 쉼표로 구분해 정확히 6개 입력해 주세요.', 'error');
    return;
  }
  const button = $('#metricsForm button[type="submit"]');
  button.disabled = true;
  try {
    await apiRequest('/api/business/metrics', {
      method: 'POST',
      body: JSON.stringify({
        sales6m,
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
        digitalSalesRatio: Number($('#metricsDigital').value)
      })
    });
    await refreshData('재무·위험 점검을 갱신했습니다.');
    showOwnerStep('campaign');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

function renderAssessment(assessment) {
  const panel = $('#assessmentPanel');
  panel.classList.toggle('hidden', !assessment);
  if (!assessment) return;
  $('#assessmentScore').textContent = assessment.score;
  const labels = { low: '낮은 보완 위험', review: '추가 확인 필요', high: '집중 확인 필요' };
  $('#assessmentRisk').textContent = labels[assessment.riskLevel] || '추가 확인 필요';
  $('#assessmentRisk').className = 'risk-badge ' + assessment.riskLevel;
  $('#assessmentFactors').innerHTML = Object.entries(assessment.components || {}).map(([name, value]) =>
    '<div class="factor-row"><div><span>' + escapeHTML(name) + '</span><b>'
    + escapeHTML(value) + '점</b></div><i><span style="width:' + Math.min(100, Number(value)) + '%"></span></i></div>'
  ).join('');
  $('#assessmentMissing').textContent = assessment.missing?.length
    ? '추가 확인 자료: ' + assessment.missing.join(', ')
    : '필수 입력값은 채워졌습니다. 운영자가 원자료와 모순 여부를 별도로 확인합니다.';
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
  renderMilestoneRows(campaign?.milestones);
  const editable = !campaign || ['draft', 'needs_changes'].includes(campaign.status);
  $('#submitCampaign').disabled = !editable || state.user?.role !== 'owner';
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
  const result = await apiRequest('/api/campaign', {
    method: 'POST',
    body: JSON.stringify({
      id: campaign?.id,
      name: $('#campaignName').value.trim(),
      target: Number($('#campaignTarget').value),
      duration: Number($('#campaignDuration').value),
      plan: $('#campaignPlan').value.trim(),
      risk: $('#campaignRisk').value.trim(),
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
    $('#evidenceAnalysis').innerHTML = '<strong>계획 일치: '
      + escapeHTML(data.result.planMatch || '검토 필요') + '</strong>'
      + '<span>공급자 ' + escapeHTML(data.result.merchant || '판독 안 됨')
      + ' · 합계 ' + won(data.result.total) + '</span>'
      + (warnings.length ? '<p>' + warnings.map(escapeHTML).join(' · ') + '</p>' : '');
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
  const campaignQueue = campaigns.filter(item => item.status === 'submitted');
  const escrowQueue = commitments.filter(item => item.status === 'committed');
  const evidenceQueue = evidence.filter(item => item.status === 'pending');
  const releaseQueue = campaigns.flatMap(item =>
    item.milestones.filter(milestone => milestone.status === 'approved')
  );
  $('#adminStats').innerHTML =
    '<article><small>모집 심사 대기</small><strong>' + campaignQueue.length + '</strong></article>'
    + '<article><small>예치 확인 대기</small><strong>' + escrowQueue.length + '</strong></article>'
    + '<article><small>증빙·지급 대기</small><strong>' + (evidenceQueue.length + releaseQueue.length) + '</strong></article>';
  $('#campaignQueueCount').textContent = campaignQueue.length;
  $('#escrowQueueCount').textContent = escrowQueue.length;
  $('#evidenceQueueCount').textContent = evidenceQueue.length + releaseQueue.length;
  renderAdminCampaigns(campaigns);
  renderAdminEscrow(commitments, campaigns);
  renderAdminEvidence(evidence, campaigns);
  renderAdminAudit(state.admin.audit || []);
  showAdminTab(state.adminTab);
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
      + '<button class="plain-button" type="button" data-preview-owner="' + item.id + '">소상공인 화면으로 보기</button></div>'
      + '<div class="review-card-grid"><div><small>사업자 상태</small><strong>'
      + escapeHTML(item.business?.verificationStatus || '미확인') + '</strong></div>'
      + '<div><small>위험 점검</small><strong>' + (assessment ? assessment.score + '점' : '자료 없음') + '</strong></div>'
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
      + '<button class="approve" type="button" data-campaign-review="published" data-id="' + item.id
      + '">승인하고 공개</button></div></article>';
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
  if (state.user?.role === 'admin' && state.admin) {
    parts.push('운영자 대기열 요약: 모집 ' + state.admin.campaigns.filter(item => item.status === 'submitted').length
      + '건, 증빙 ' + state.admin.evidence.filter(item => item.status === 'pending').length + '건');
  }
  return parts.join('\n');
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
        context: buildAiContext()
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
