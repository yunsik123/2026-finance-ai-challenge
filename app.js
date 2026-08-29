import { cloudConfigured, cloudRequest, cloudSessionHeaders } from './src/supabase-cloud.js';

let stores = [
  {
    id: 'ongi', name: '온기린 식당', category: '한식', area: '서울 성동구',
    desc: '제철 재료로 차리는 따뜻한 한 끼', growth: '+18.2%', support: 92,
    target: 30000000, funded: 27600000, investors: 184, daysLeft: 8,
    tone: '#d9b88f', badge: '성장 주목', since: 2018,
    campaign: '오래된 주방을 더 안전하고 효율적으로 바꿉니다',
    plan: [['업소용 냉장고 교체', 12000000], ['주방 환기 설비 개선', 10000000], ['초기 식자재·운전자금', 8000000]],
    points: ['최근 6개월 매출이 완만하게 증가했어요.', '지역 단골 리뷰에서 재방문 언급이 많아요.', '장비 교체 목적과 견적 금액이 구체적이에요.'],
    risks: ['식재료 원가 상승 시 수익성이 낮아질 수 있어요.', '주방 공사 기간 중 매출 공백이 발생할 수 있어요.'],
    coupon: { title: '온기린 10% 감사 쿠폰', benefit: '식사 금액 10% 할인', condition: '2만원 이상 주문 시' }
  },
  {
    id: 'mokhwa', name: '목화 로스터리', category: '카페', area: '서울 마포구',
    desc: '동네에서 직접 볶는 매일의 커피', growth: '+12.6%', support: 74,
    target: 24000000, funded: 17760000, investors: 126, daysLeft: 14,
    tone: '#a7bba5', badge: '방문 인증', since: 2020,
    campaign: '더 신선한 커피를 위한 소형 로스터를 들여옵니다',
    plan: [['소형 로스터 구매', 16000000], ['배기 설비 공사', 5000000], ['생두 구매', 3000000]],
    points: ['원두 구독 고객이 꾸준히 늘고 있어요.', '장비 견적과 설치 일정이 제출됐어요.'],
    risks: ['커피 원두 가격과 환율 변동에 영향을 받아요.', '장비 도입 후 판매량 증가가 계획보다 느릴 수 있어요.'],
    coupon: { title: '목화 커피 1잔 쿠폰', benefit: '아메리카노 1잔', condition: '펀딩 참여자 전용' }
  },
  {
    id: 'table', name: '일구의 식탁', category: '양식', area: '서울 종로구',
    desc: '천천히 빚어 완성한 생면 파스타', growth: '+9.4%', support: 61,
    target: 40000000, funded: 24400000, investors: 97, daysLeft: 19,
    tone: '#d4a083', badge: '신규 공개', since: 2022,
    campaign: '점심 회전율을 높일 두 번째 제면기를 마련합니다',
    plan: [['제면기 및 반죽기', 22000000], ['주방 동선 개선', 10000000], ['신메뉴 개발', 8000000]],
    points: ['대표 메뉴 관련 긍정 리뷰 비중이 높아요.', '점심 시간 품절 데이터가 설비 수요를 뒷받침해요.'],
    risks: ['업력이 짧아 장기 매출 데이터가 부족해요.', '설비 증설이 실제 수요 증가로 이어지지 않을 수 있어요.'],
    coupon: { title: '생면 파스타 5천원 쿠폰', benefit: '5,000원 할인', condition: '3만원 이상 주문 시' }
  },
  {
    id: 'spring', name: '봄날 명상소', category: '생활', area: '서울 영등포구',
    desc: '쉼의 시간을 돌보는 친환경 명상 공간', growth: '+15.1%', support: 83,
    target: 18000000, funded: 14940000, investors: 143, daysLeft: 6,
    tone: '#9eb8bc', badge: '지역 추천', since: 2019,
    campaign: '소규모 마음돌봄 프로그램 공간을 확장합니다',
    plan: [['방음 공사', 9000000], ['명상 도구 구매', 4000000], ['프로그램 개발·홍보', 5000000]],
    points: ['예약 재방문율이 지역 동종업체 평균보다 높다는 자체 자료가 있어요.', '소규모 확장으로 고정비 증가를 제한했어요.'],
    risks: ['자체 제출 재방문율은 외부 검증이 필요해요.', '프로그램 운영자 개인 역량 의존도가 높아요.'],
    coupon: { title: '봄날 체험권', benefit: '입문 명상 1회', condition: '사전 예약 필수' }
  },
  {
    id: 'field', name: '들녘 밥상', category: '한식', area: '경기 수원시',
    desc: '농가에서 바로 받은 재료의 집밥', growth: '+7.8%', support: 57,
    target: 26000000, funded: 14820000, investors: 88, daysLeft: 23,
    tone: '#c8b994', badge: '정보 충실', since: 2017,
    campaign: '지역 농가 직거래를 위한 저온 저장고를 설치합니다',
    plan: [['저온 저장고', 18000000], ['전기 증설', 5000000], ['운송·포장 장비', 3000000]],
    points: ['지역 농가와의 기존 거래 내역이 제출됐어요.', '식재료 폐기율 절감 목표가 수치로 제시됐어요.'],
    risks: ['저장고 전기료와 유지비가 증가할 수 있어요.', '계절별 농산물 수급 변동이 커요.'],
    coupon: { title: '들녘 반찬 쿠폰', benefit: '계절 반찬 증정', condition: '식사 주문 시' }
  },
  {
    id: 'garden', name: '작은 정원', category: '카페', area: '인천 부평구',
    desc: '식물과 구움과자가 있는 골목 카페', growth: '+11.3%', support: 68,
    target: 20000000, funded: 13600000, investors: 109, daysLeft: 12,
    tone: '#91ad96', badge: '이웃 추천', since: 2021,
    campaign: '작은 베이킹 작업실을 분리해 생산량을 늘립니다',
    plan: [['오븐 교체', 9000000], ['작업대·환기 공사', 7000000], ['원재료·패키지', 4000000]],
    points: ['구움과자 예약 주문이 꾸준히 증가했어요.', '비교적 작은 규모로 단계별 집행이 가능해요.'],
    risks: ['카페 매출의 주말 편중이 커요.', '인근 신규 카페 진입으로 경쟁이 늘었어요.'],
    coupon: { title: '작은 정원 디저트 쿠폰', benefit: '구움과자 1개', condition: '음료 주문 시' }
  }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const won = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;

let favorites = new Set();
let currentUser = null;
let business = null;
let campaign = null;
let contributions = {};
let coupons = [];
let issuedCoupon = null;
let disclosureValues = [];
let selectedRegion = '서울 성동구';
let activeFilter = 'all';
let favoritesOnly = false;
let searchTerm = '';
let currentStore = null;
let pendingAction = null;
let receiptDataUrl = '';
let receiptFilename = '';
let lastOcrResult = null;
let chatHistory = [];
let loginHistory = [];
let intelligence = null;
let recommendations = [];

const grid = $('#storeGrid');
const searchInput = $('#storeSearch');
const resultSummary = $('#resultSummary');

async function apiRequest(path, options = {}) {
  if (cloudConfigured) {
    const cloudData = await cloudRequest(path, options);
    if (cloudData !== null) return cloudData;
  }
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(cloudConfigured ? cloudSessionHeaders() : {}), ...(options.headers || {}) } : { ...(cloudConfigured ? cloudSessionHeaders() : {}), ...(options.headers || {}) }
  });
  let data;
  try { data = await response.json(); } catch { data = { ok: false, error: '서버 응답을 해석하지 못했습니다.' }; }
  if (!response.ok || !data.ok) {
    const error = new Error(data.error || `요청 실패 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function applyBootstrap(data) {
  if (Array.isArray(data.stores) && data.stores.length) stores = data.stores;
  currentUser = data.user || null;
  favorites = new Set(data.favorites || []);
  business = data.business || null;
  campaign = data.campaign || null;
  contributions = data.contributions || {};
  coupons = data.coupons || [];
  issuedCoupon = data.issuedCoupon || null;
  disclosureValues = data.disclosures || [];
  selectedRegion = data.region || '서울 성동구';
  lastOcrResult = data.recentOcr?.result || null;
  loginHistory = data.loginHistory || [];
  intelligence = data.intelligence || null;
  recommendations = data.recommendations || [];
}

function showToast(message, type = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

function openModal(id) {
  $$('.modal.open').forEach(modal => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  });
  const modal = typeof id === 'string' ? $(`#${id}`) : id;
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setTimeout(() => $('input, textarea, button:not(.modal-close)', modal)?.focus(), 30);
}

function closeModal(modal) {
  const target = modal?.classList?.contains('modal') ? modal : modal?.closest?.('.modal');
  if (target) {
    target.classList.remove('open');
    target.setAttribute('aria-hidden', 'true');
  }
  if (!$('.modal.open')) document.body.classList.remove('modal-open');
}

$$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if ($('#aiDrawer').classList.contains('open')) closeAiDrawer();
    else closeModal($('.modal.open'));
  }
});

function requireLogin(role, action) {
  if (!currentUser) {
    pendingAction = action;
    $(`input[name="authRole"][value="${role}"]`).checked = true;
    openModal('authModal');
    showToast('이 기능은 로그인 후 이용할 수 있어요.', 'info');
    return false;
  }
  if (role && currentUser.role !== role) {
    showToast(role === 'owner' ? '소상공인 계정으로 로그인해 주세요.' : '소비자 계정으로 로그인해 주세요.', 'error');
    openModal('accountModal');
    return false;
  }
  action?.();
  return true;
}

function updateAuthUI() {
  const label = $('#loginLabel');
  if (currentUser) {
    label.textContent = `${currentUser.name}님`;
    $('#accountAvatar').textContent = currentUser.name.slice(0, 1);
    $('#accountSummary').textContent = `${currentUser.email} · ${currentUser.role === 'owner' ? '소상공인' : '소비자'} 계정`;
    $('#ownerGreeting').textContent = currentUser.role === 'owner' ? `${currentUser.name} 사장님` : '사장님';
  } else {
    label.textContent = '로그인';
    $('#ownerGreeting').textContent = '사장님';
  }
  renderLoginHistory();
  updateCouponUI();
}

function renderLoginHistory() {
  const list = $('#loginHistoryList');
  if (!list) return;
  if (!currentUser || !loginHistory.length) {
    list.innerHTML = '<p>로그인 기록이 없습니다.</p>';
    return;
  }
  list.innerHTML = loginHistory.slice(0, 6).map(item => `<div class="login-event"><span class="event-dot ${escapeHTML(item.event)}"></span><div><strong>${escapeHTML(item.label)}</strong><small>${escapeHTML(item.createdAt)} · ${escapeHTML(item.ip || 'IP 미수집')}</small></div></div>`).join('');
}

$('#loginButton').addEventListener('click', () => openModal(currentUser ? 'accountModal' : 'authModal'));
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const role = $('input[name="authRole"]:checked').value;
  const submit = $('#authForm button[type="submit"]');
  const password = $('#authPassword').value;
  submit.disabled = true; submit.textContent = '서버에서 확인 중…';
  try {
    const data = await apiRequest('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ name: $('#authName').value.trim(), email: $('#authEmail').value.trim(), password, role })
    });
    applyBootstrap(data);
    $('#authPassword').value = '';
    closeModal($('#authModal'));
    renderStores(); renderRecommendations(); updateAuthUI(); updateOwnerUI(); updateDisclosureUI(); updateRegionUI();
    switchView(role === 'owner' ? 'owner' : 'consumer');
    showToast(`${currentUser.name}님, 로그인되었습니다.`);
    const action = pendingAction;
    pendingAction = null;
    action?.();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false; submit.innerHTML = '로그인하고 시작하기 <span>→</span>';
  }
});
$('#logoutButton').addEventListener('click', async () => {
  try { await apiRequest('/api/auth/session', { method: 'DELETE' }); } catch {}
  applyBootstrap({ stores, user: null });
  closeModal($('#accountModal'));
  renderStores(); renderRecommendations(); updateAuthUI(); updateOwnerUI(); updateDisclosureUI(); updateRegionUI();
  switchView('consumer');
  showToast('로그아웃되었습니다.', 'info');
});
$('#switchRoleButton').addEventListener('click', () => {
  closeModal($('#accountModal'));
  switchView(currentUser?.role === 'owner' ? 'owner' : 'consumer');
});

function switchView(view) {
  $$('.audience-btn').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('.audience-switch').classList.toggle('owner', view === 'owner');
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `${view}View`));
  $('#couponWalletButton').classList.toggle('hidden', view === 'owner');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateAiContextLabel();
}

$$('.audience-btn').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$$('[data-scroll]').forEach(button => button.addEventListener('click', () => $(button.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' })));
$('#searchButton').addEventListener('click', () => {
  switchView('consumer');
  setTimeout(() => { $('#discover').scrollIntoView({ behavior: 'smooth' }); searchInput.focus(); }, 200);
});
$('#howItWorks').addEventListener('click', () => openModal('infoModal'));

function visibleStores() {
  const query = searchTerm.trim().toLocaleLowerCase('ko');
  return stores.filter(store =>
    (activeFilter === 'all' || store.category === activeFilter) &&
    (!favoritesOnly || favorites.has(store.id)) &&
    (!query || `${store.name} ${store.category} ${store.area} ${store.desc} ${store.campaign}`.toLocaleLowerCase('ko').includes(query))
  );
}

function contributionAmount(storeId) {
  return Number(contributions[storeId] || 0);
}

function renderStores() {
  const visible = visibleStores();
  resultSummary.textContent = searchTerm || activeFilter !== 'all' || favoritesOnly ? `${visible.length}개의 펀딩을 찾았어요.` : `지금 모집 중인 펀딩 ${stores.length}곳`;
  if (!visible.length) {
    grid.innerHTML = '<div class="empty-state"><strong>조건에 맞는 가게가 없어요.</strong><p>검색어나 필터를 바꿔 다시 찾아보세요.</p><button type="button" id="resetFilters">전체 펀딩 보기</button></div>';
    $('#resetFilters').addEventListener('click', resetDiscovery);
    return;
  }
  grid.innerHTML = visible.map((store, index) => {
    const saved = favorites.has(store.id);
    const extra = contributionAmount(store.id);
    const progress = Math.min(100, Math.round((store.funded + extra) / store.target * 100));
    return `<article class="store-card" data-store-id="${store.id}" style="animation:fade .4s ${index * .05}s both">
      <div class="store-image" style="--tone:${store.tone}"><div class="scene"></div><span class="badge">${store.badge}</span><span class="days-badge">D-${store.daysLeft}</span><button class="save${saved ? ' saved' : ''}" type="button" data-id="${store.id}" aria-label="${store.name} ${saved ? '찜 해제' : '찜하기'}" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button></div>
      <button class="store-card-content" type="button" data-open-store="${store.id}" aria-label="${store.name} 펀딩 상세 보기"><span class="store-meta">${store.area} · ${store.category}</span><h3>${store.name}</h3><p>${store.campaign}</p><div class="funding-mini"><div><span style="width:${progress}%"></span></div><b>${progress}%</b></div><div class="store-stats"><div><small>현재 모집액</small><strong class="up">${won(store.funded + extra)}</strong></div><div><small>참여 이웃</small><strong>${store.investors + (extra ? 1 : 0)}명</strong></div></div><span class="detail-link">사업계획과 위험 보기 →</span></button>
    </article>`;
  }).join('');
}

function renderRecommendations() {
  const container = $('#recommendationGrid');
  if (!container) return;
  if (!recommendations.length) {
    container.innerHTML = '<div class="data-loading">비교 가능한 소상공인 자료가 아직 없습니다.</div>';
    return;
  }
  container.innerHTML = recommendations.map((item, index) => `<article class="recommendation-card" data-recommend-store="${escapeHTML(item.storeId)}">
    <div class="recommend-rank"><span>${index + 1}</span><small>탐색 순위</small></div>
    <div class="recommend-main"><div><span class="grade-chip">${escapeHTML(item.sGrade)}</span><b>${escapeHTML(item.score)}점</b></div><h3>${escapeHTML(item.name)}</h3><p>${(item.reasons || []).map(escapeHTML).join(' · ') || '추가 강점 자료 확인 필요'}</p><small>매출 ${escapeHTML(item.growth || '-')} · 혜택 ${escapeHTML(item.coupon || '-')}</small></div>
    <div class="recommend-risk"><strong>같이 볼 위험</strong><p>${escapeHTML((item.risks || [])[0] || '원자료 확인 필요')}</p></div>
  </article>`).join('');
}

$('#recommendationGrid')?.addEventListener('click', event => {
  const card = event.target.closest('[data-recommend-store]');
  if (card) openStoreDetail(card.dataset.recommendStore);
});

function resetDiscovery() {
  activeFilter = 'all'; favoritesOnly = false; searchTerm = ''; searchInput.value = '';
  $$('.filter').forEach(button => button.classList.toggle('active', button.dataset.filter === 'all'));
  $('#favoritesFilter').classList.remove('active');
  $('#favoritesFilter').setAttribute('aria-pressed', 'false');
  renderStores();
}

async function toggleFavorite(storeId) {
  if (!currentUser) {
    pendingAction = () => toggleFavorite(storeId);
    $('input[name="authRole"][value="consumer"]').checked = true;
    openModal('authModal');
    showToast('찜을 저장하려면 로그인해 주세요.', 'info');
    return;
  }
  try {
    const data = await apiRequest('/api/favorites/toggle', { method: 'POST', body: JSON.stringify({ storeId }) });
    favorites = new Set(data.favorites);
    renderStores();
    showToast(data.saved ? '찜한 가게에 추가했어요.' : '찜을 해제했어요.', 'info');
  } catch (error) { showToast(error.message, 'error'); }
}

grid.addEventListener('click', event => {
  const saveButton = event.target.closest('.save');
  if (saveButton) {
    toggleFavorite(saveButton.dataset.id);
    return;
  }
  const card = event.target.closest('.store-card');
  if (card) openStoreDetail(card.dataset.storeId);
});

function openFeaturedStore() { openStoreDetail('ongi'); }
$('#featuredStorePreview').addEventListener('click', openFeaturedStore);
$('#featuredStorePreview').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openFeaturedStore();
  }
});

$$('.filter').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  $$('.filter').forEach(item => item.classList.toggle('active', item === button));
  renderStores();
}));
$('#favoritesFilter').addEventListener('click', event => {
  favoritesOnly = !favoritesOnly;
  event.currentTarget.classList.toggle('active', favoritesOnly);
  event.currentTarget.setAttribute('aria-pressed', String(favoritesOnly));
  renderStores();
});
searchInput.addEventListener('input', event => { searchTerm = event.target.value; renderStores(); });
$('#clearSearch').addEventListener('click', () => { searchTerm = ''; searchInput.value = ''; searchInput.focus(); renderStores(); });
$('.all-button').addEventListener('click', resetDiscovery);

function openStoreDetail(id) {
  const store = stores.find(item => item.id === id);
  if (!store) return;
  currentStore = store;
  const extra = contributionAmount(id);
  const progress = Math.min(100, Math.round((store.funded + extra) / store.target * 100));
  const planTotal = store.plan.reduce((sum, [, amount]) => sum + amount, 0);
  $('#storeDetailContent').innerHTML = `
    <div class="store-detail-hero" style="--tone:${store.tone}"><div><span class="badge">${store.badge}</span><p>${store.area} · ${store.category} · since ${store.since}</p><h2 id="storeDetailTitle">${store.name}</h2><h3>${store.campaign}</h3></div><button class="detail-save ${favorites.has(id) ? 'saved' : ''}" id="detailSaveButton" type="button">${favorites.has(id) ? '♥ 찜함' : '♡ 찜하기'}</button></div>
    <div class="store-detail-body">
      <section class="funding-summary"><div class="funding-numbers"><div><small>모인 금액</small><strong>${won(store.funded + extra)}</strong><span>목표 ${won(store.target)}</span></div><div><small>참여 이웃</small><strong>${store.investors + (extra ? 1 : 0)}명</strong></div><div><small>남은 기간</small><strong>${store.daysLeft}일</strong></div></div><div class="detail-progress"><span style="width:${progress}%"></span></div><b>${progress}% 달성</b></section>
      <div class="detail-grid"><div>
        <section class="detail-section"><div class="detail-heading"><span>01</span><h3>사업계획과 자금 사용</h3></div><p>${store.desc}</p><div class="plan-table">${store.plan.map(([name, amount]) => `<div><span>${name}</span><b>${won(amount)}</b></div>`).join('')}<div class="total"><span>합계</span><b>${won(planTotal)}</b></div></div></section>
        <section class="detail-section"><div class="detail-heading"><span>02</span><h3>AI가 정리한 판단 근거</h3><button id="askStoreAiButton" type="button">AI에게 더 묻기</button></div><div class="analysis-columns"><div class="positive"><h4>투자 포인트</h4><ul>${store.points.map(point => `<li>${point}</li>`).join('')}</ul></div><div class="negative"><h4>위험 및 확인사항</h4><ul>${store.risks.map(risk => `<li>${risk}</li>`).join('')}</ul></div></div><p class="source-note">예시 데이터 기반 AI 요약 · 실제 투자 판단 전 원자료 확인 필요</p></section>
        <section class="detail-section"><div class="detail-heading"><span>03</span><h3>단계별 지급 계획</h3></div><div class="milestone-list"><div class="done"><b>1</b><p><strong>계약 확인 · 20%</strong><small>견적서와 장비 계약 확인 후</small></p><span>검토완료</span></div><div class="active"><b>2</b><p><strong>구매 착수 · 40%</strong><small>세금계산서와 결제 증빙 확인 후</small></p><span>예정</span></div><div><b>3</b><p><strong>설치 완료 · 40%</strong><small>완료 사진과 최종 비용 검수 후</small></p><span>예정</span></div></div></section>
      </div><aside class="participation-card"><span class="reward-label">참여 리워드</span><h3>${store.coupon.title}</h3><p>${store.coupon.benefit}<small>${store.coupon.condition}</small></p><form id="participationForm"><label>참여 금액</label><div class="amount-options"><button type="button" data-amount="10000">1만원</button><button type="button" data-amount="30000" class="selected">3만원</button><button type="button" data-amount="50000">5만원</button></div><input id="participationAmount" type="number" min="1000" step="1000" value="30000" aria-label="참여 금액"><label class="check-line"><input id="riskConsent" type="checkbox" required> 손실 가능성과 데모 서비스임을 확인했습니다.</label><button class="primary-button full-button" type="submit">펀딩 참여하기</button></form><small class="prototype-note">실제 결제는 발생하지 않는 프로토타입입니다.</small></aside></div>
    </div>`;
  openModal('storeModal');

  $('#detailSaveButton').addEventListener('click', async () => {
    await toggleFavorite(id);
    if ($('#storeModal').classList.contains('open')) openStoreDetail(id);
  });
  $$('.amount-options button', $('#storeModal')).forEach(button => button.addEventListener('click', () => {
    $$('.amount-options button', $('#storeModal')).forEach(item => item.classList.toggle('selected', item === button));
    $('#participationAmount').value = button.dataset.amount;
  }));
  $('#askStoreAiButton').addEventListener('click', () => {
    closeModal($('#storeModal'));
    openAiDrawer(`이 가게의 투자 포인트와 위험요인을 균형 있게 설명해줘. 특히 추가로 확인할 자료를 알려줘.`);
  });
  $('#participationForm').addEventListener('submit', event => {
    event.preventDefault();
    const amount = Number($('#participationAmount')?.value || 0);
    const riskConsent = Boolean($('#riskConsent')?.checked);
    if (amount < 1000) { showToast('1,000원 이상 입력해 주세요.', 'error'); return; }
    if (!riskConsent) { showToast('위험 확인에 동의해 주세요.', 'error'); return; }
    requireLogin('consumer', () => completeParticipation(store, amount));
  });
  updateAiContextLabel();
}

async function completeParticipation(store, amount) {
  try {
    const data = await apiRequest('/api/contributions', {
      method: 'POST', body: JSON.stringify({ storeId: store.id, amount, riskConsent: true })
    });
    contributions[store.id] = data.total;
    const index = coupons.findIndex(coupon => coupon.id === data.coupon.id);
    if (index >= 0) coupons[index] = data.coupon; else coupons.unshift(data.coupon);
    closeModal($('#storeModal'));
    renderStores(); updateCouponUI();
    showToast(`${won(amount)} 참여가 DB에 기록되고 쿠폰이 지급됐어요.`);
    setTimeout(() => openCouponWallet(), 450);
  } catch (error) { showToast(error.message, 'error'); }
}

function updateCouponUI() {
  const available = coupons.filter(coupon => !coupon.used).length;
  $('#couponCount').textContent = available;
}

function openCouponWallet() {
  requireLogin('consumer', () => {
    renderCoupons();
    openModal('couponModal');
  });
}

function renderCoupons() {
  const list = $('#couponList');
  if (!coupons.length) {
    list.innerHTML = '<div class="empty-wallet"><span>🎟</span><p>아직 받은 쿠폰이 없어요.</p></div>';
    return;
  }
  list.innerHTML = coupons.map(coupon => `<article class="coupon-ticket ${coupon.used ? 'used' : ''}"><div><small>${escapeHTML(coupon.store)}</small><h3>${escapeHTML(coupon.title)}</h3><strong>${escapeHTML(coupon.benefit)}</strong><p>${escapeHTML(coupon.condition)} · ${escapeHTML(coupon.expires)}까지</p><code>${coupon.used ? '사용 완료' : escapeHTML(coupon.code)}</code></div><button type="button" data-use-coupon="${escapeHTML(coupon.id)}" ${coupon.used ? 'disabled' : ''}>${coupon.used ? '사용함' : '매장에서 사용'}</button></article>`).join('');
  $$('[data-use-coupon]', list).forEach(button => button.addEventListener('click', async () => {
    const coupon = coupons.find(item => item.id === button.dataset.useCoupon);
    if (!coupon || coupon.used) return;
    if (!confirm(`${coupon.title} 쿠폰을 사용 처리할까요?\n데모에서는 실제 매장 확인 없이 사용 상태가 변경됩니다.`)) return;
    try {
      const data = await apiRequest('/api/coupons/use', { method: 'POST', body: JSON.stringify({ couponId: coupon.id }) });
      Object.assign(coupon, data.coupon); renderCoupons(); updateCouponUI(); showToast('쿠폰 사용 기록을 DB에 저장했어요.');
    } catch (error) { showToast(error.message, 'error'); }
  }));
}
$('#couponWalletButton').addEventListener('click', openCouponWallet);

function fillBusinessForm() {
  if (!business) return;
  $('#businessName').value = business.name || '';
  $('#businessCategory').value = business.category || '한식';
  $('#businessNumber').value = business.number || '';
  $('#businessAddress').value = business.address || '';
  $('#businessSales').value = business.sales || '';
  $('#businessAge').value = business.age || '';
  $('#businessDescription').value = business.description || '';
}
function openBusinessForm() { requireLogin('owner', () => { fillBusinessForm(); openModal('businessModal'); }); }
$('#registerBusinessButton').addEventListener('click', openBusinessForm);
$('#editBusinessInline').addEventListener('click', openBusinessForm);
$('#businessForm').addEventListener('submit', async event => {
  event.preventDefault();
  const values = { name: $('#businessName').value.trim(), category: $('#businessCategory').value, number: $('#businessNumber').value.trim(), address: $('#businessAddress').value.trim(), sales: Number($('#businessSales').value || 0), age: Number($('#businessAge').value || 0), description: $('#businessDescription').value.trim() };
  const submit = $('#businessForm button[type="submit"]'); submit.disabled = true;
  try {
    const data = await apiRequest('/api/business', { method: 'POST', body: JSON.stringify(values) });
    business = data.business; closeModal($('#businessModal')); await refreshIntelligence(); updateOwnerUI(); showToast('사업체 정보를 DB에 저장했어요.');
  } catch (error) { showToast(error.message, 'error'); }
  finally { submit.disabled = false; }
});

function openCampaignForm() {
  requireLogin('owner', () => {
    if (!business) { showToast('사업체 정보를 먼저 등록해 주세요.', 'info'); openBusinessForm(); return; }
    if (campaign) { $('#campaignName').value = campaign.name || ''; $('#campaignTarget').value = campaign.target || ''; $('#campaignDuration').value = campaign.duration || '30'; $('#campaignPlan').value = campaign.plan || ''; $('#campaignRisk').value = campaign.risk || ''; }
    openModal('campaignModal');
  });
}
$('#createCampaignButton').addEventListener('click', openCampaignForm);
$('#campaignForm').addEventListener('submit', async event => {
  event.preventDefault();
  const values = { id: campaign?.id, name: $('#campaignName').value.trim(), target: Number($('#campaignTarget').value), duration: Number($('#campaignDuration').value), plan: $('#campaignPlan').value.trim(), risk: $('#campaignRisk').value.trim() };
  const submit = $('#campaignForm button[type="submit"]'); submit.disabled = true;
  try {
    const data = await apiRequest('/api/campaign', { method: 'POST', body: JSON.stringify(values) });
    campaign = data.campaign; $('#expensePlan').value = campaign.plan; closeModal($('#campaignModal')); updateOwnerUI(); showToast('펀딩 초안을 DB에 저장했어요.');
  } catch (error) { showToast(error.message, 'error'); }
  finally { submit.disabled = false; }
});

function updateOwnerUI() {
  const strip = $('#ownerStatusStrip');
  if (business) {
    strip.classList.add('registered');
    $('p', strip).innerHTML = `<strong>${escapeHTML(business.name)}</strong> · ${escapeHTML(business.category)} · ${escapeHTML(business.address)}${campaign ? ` · 펀딩 ${escapeHTML(campaign.status)}` : ''}`;
    $('#editBusinessInline').textContent = '정보 수정';
  } else {
    strip.classList.remove('registered');
    $('p', strip).innerHTML = '<strong>데모 사업체</strong> · 정보를 등록하면 대시보드와 AI 분석에 반영됩니다.';
    $('#editBusinessInline').textContent = '정보 등록';
  }
  if (issuedCoupon) renderIssuedCoupon(issuedCoupon);
  else {
    $('#issuedCouponSummary').classList.remove('active');
    $('#issuedCouponSummary').innerHTML = '<span>🎟</span><p><strong>아직 발행된 쿠폰이 없어요.</strong><small>펀딩 참여 리워드로 자동 지급할 수 있습니다.</small></p>';
  }
  renderIntelligence();
}

async function refreshIntelligence() {
  if (!currentUser || currentUser.role !== 'owner' || !business) { intelligence = null; return; }
  try {
    const data = await apiRequest('/api/knowledge-graph');
    intelligence = data.intelligence;
  } catch (error) {
    intelligence = null;
    showToast(`진단 갱신 실패: ${error.message}`, 'error');
  }
}

function renderIntelligence() {
  const empty = $('#intelligenceEmpty');
  const grid = $('#intelligenceGrid');
  if (!empty || !grid) return;
  if (!intelligence?.assessment) {
    empty.classList.remove('hidden'); grid.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden'); grid.classList.remove('hidden');
  const assessment = intelligence.assessment;
  $('#growthGrade').textContent = assessment.grade;
  $('#growthScore').textContent = `${assessment.score}점`;
  $('#fundingLimit').textContent = `설명용 한도 ${won(assessment.fundingLimit)}`;
  $('#assessmentNotice').textContent = assessment.notice;
  const maximums = { '매출 성장': 25, '상권 내 경쟁력': 15, '현금흐름 지속성': 20, '부채 회복력': 20, '경영 안정성': 10, '비계량 가점': 10 };
  $('#factorBars').innerHTML = Object.entries(assessment.components).map(([name, value]) => `<div class="factor-row"><div><span>${escapeHTML(name)}</span><b>${escapeHTML(value)} / ${maximums[name]}</b></div><i><em style="width:${Math.min(100, Number(value) / maximums[name] * 100)}%"></em></i></div>`).join('');
  $('#diagnosisText').textContent = intelligence.diagnosis;
  $('#graphSummary').innerHTML = `<span>${intelligence.graph.nodes.length}개 노드</span><span>${intelligence.graph.edges.length}개 관계</span><span>${(assessment.missing || []).length}개 부족자료</span>`;
}

$('#askDiagnosisAi')?.addEventListener('click', () => openAiDrawer('내 성장등급에서 모자란 기준과 이를 보완할 원자료를 근거 경로별로 설명해줘.'));

$('#openMetricsButton')?.addEventListener('click', () => requireLogin('owner', () => {
  if (!business) { showToast('사업체 정보를 먼저 등록해 주세요.', 'info'); openBusinessForm(); return; }
  if (!$('#metricsSales6m').value) $('#metricsSales6m').value = Array(6).fill(business.sales || 0).join(', ');
  openModal('metricsModal');
}));

$('#metricsForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const sales6m = $('#metricsSales6m').value.split(/[\s,]+/).filter(Boolean).map(Number);
  if (sales6m.length !== 6 || sales6m.some(value => !Number.isFinite(value) || value < 0)) {
    showToast('최근 6개월 매출을 쉼표로 구분해 정확히 6개 입력해 주세요.', 'error');
    return;
  }
  const values = {
    sales6m,
    operatingCashFlow: Number($('#metricsCashFlow').value), debtTotal: Number($('#metricsDebtTotal').value),
    monthlyDebtPayment: Number($('#metricsDebtPayment').value), overdueCount: Number($('#metricsOverdue').value),
    employeeCount: Number($('#metricsEmployees').value), taxCompliant: $('#metricsTax').value === 'true',
    footTrafficGrowth: Number($('#metricsFootTraffic').value), localSalesGrowth: Number($('#metricsLocalGrowth').value),
    competitorDensity: Number($('#metricsCompetition').value), closureRate: Number($('#metricsClosure').value),
    repeatRate: Number($('#metricsRepeat').value), digitalSalesRatio: Number($('#metricsDigital').value)
  };
  const submit = $('#metricsForm button[type="submit"]'); submit.disabled = true;
  try {
    const data = await apiRequest('/api/business/metrics', { method: 'POST', body: JSON.stringify(values) });
    intelligence = data.intelligence;
    renderIntelligence(); closeModal($('#metricsModal'));
    showToast('평가자료와 지식그래프를 갱신했어요.');
  } catch (error) { showToast(error.message, 'error'); }
  finally { submit.disabled = false; }
});

$('#editDisclosureButton').addEventListener('click', () => requireLogin('owner', () => openModal('disclosureModal')));
$('#disclosureForm').addEventListener('submit', async event => {
  event.preventDefault();
  const values = $$('input[name="disclosure"]:checked').map(input => input.value);
  try {
    const data = await apiRequest('/api/disclosures', { method: 'POST', body: JSON.stringify({ values }) });
    disclosureValues = data.disclosures;
    updateDisclosureUI(); closeModal($('#disclosureModal')); showToast('공시 상태를 DB에 저장했어요.');
  } catch (error) { showToast(error.message, 'error'); }
});
function updateDisclosureUI() {
  $$('input[name="disclosure"]').forEach(input => { input.checked = disclosureValues.includes(input.value); });
  const percent = Math.round(disclosureValues.length / 6 * 100);
  $('#disclosureDone').textContent = disclosureValues.length;
  $('#disclosurePercent').textContent = `${percent}%`;
  $('#disclosureRing').style.setProperty('--value', percent);
}

$('#regionButton').addEventListener('click', () => openModal('regionModal'));
$$('[data-region]').forEach(button => button.addEventListener('click', () => requireLogin('owner', async () => {
  const region = button.dataset.region;
  try {
    const data = await apiRequest('/api/preferences/region', { method: 'POST', body: JSON.stringify({ region }) });
    selectedRegion = data.region; updateRegionUI(); closeModal($('#regionModal')); showToast(`${region} 기준으로 DB에 저장했어요.`, 'info');
  } catch (error) { showToast(error.message, 'error'); }
})));

function updateRegionUI() {
  $('#regionButton').textContent = `${selectedRegion} ▾`;
  $$('[data-region]').forEach(button => { $('span', button).textContent = button.dataset.region === selectedRegion ? '✓' : ''; });
}

$('#couponIssueForm').addEventListener('submit', event => {
  event.preventDefault();
  requireLogin('owner', async () => {
    const values = { name: $('#couponName').value.trim(), benefit: $('#couponBenefit').value.trim(), quantity: Number($('#couponQuantity').value), condition: $('#couponCondition').value.trim() };
    try {
      const data = await apiRequest('/api/coupons/issue', { method: 'POST', body: JSON.stringify(values) });
      issuedCoupon = data.issuedCoupon; renderIssuedCoupon(issuedCoupon); showToast(`${issuedCoupon.quantity}장의 쿠폰 발행 정보를 DB에 저장했어요.`);
    } catch (error) { showToast(error.message, 'error'); }
  });
});
function renderIssuedCoupon(coupon) {
  $('#issuedCouponSummary').innerHTML = `<span>🎟</span><p><strong>${escapeHTML(coupon.name)}</strong><small>${escapeHTML(coupon.benefit)} · ${coupon.quantity}장 · ${escapeHTML(coupon.condition)}</small></p>`;
  $('#issuedCouponSummary').classList.add('active');
}

function validateReceiptFile(file) {
  if (!file) return false;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { showToast('PNG, JPG 또는 WebP 이미지만 올릴 수 있어요.', 'error'); return false; }
  if (file.size > 6 * 1024 * 1024) { showToast('이미지는 6MB 이하여야 해요.', 'error'); return false; }
  return true;
}
function loadReceipt(file) {
  if (!validateReceiptFile(file)) return;
  receiptFilename = file.name || '증빙 이미지';
  const reader = new FileReader();
  reader.onload = () => {
    receiptDataUrl = reader.result;
    $('#receiptPreview').src = receiptDataUrl;
    $('#receiptPreview').classList.add('visible');
    $('#receiptDropzone').classList.add('has-file');
    $('#runOcrButton').disabled = false;
    $('#runOcrButton').innerHTML = 'AI로 증빙 분석하기 <span>→</span>';
  };
  reader.readAsDataURL(file);
}
$('#receiptFile').addEventListener('change', event => loadReceipt(event.target.files[0]));
const dropzone = $('#receiptDropzone');
['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', event => loadReceipt(event.dataTransfer.files[0]));
$('#runOcrButton').addEventListener('click', () => requireLogin('owner', runOcr));

async function runOcr() {
  if (!receiptDataUrl) { showToast('분석할 증빙 이미지를 선택해 주세요.', 'error'); return; }
  const button = $('#runOcrButton');
  button.disabled = true; button.innerHTML = '<span class="button-spinner"></span> Ollama 우선으로 문서를 읽는 중…';
  $('#ocrResultPanel').innerHTML = '<div class="empty-tool-state loading"><span class="scan-icon">▣</span><h3>증빙 내용을 분석하고 있어요</h3><p>금액과 품목을 추출하고 사용계획과 비교합니다.</p></div>';
  try {
    const data = await apiRequest('/api/ai/ocr', { method: 'POST', body: JSON.stringify({ image: receiptDataUrl, filename: receiptFilename, plan: $('#expensePlan').value }) });
    lastOcrResult = data.result;
    renderOcrResult(data.result, data.model);
    showToast('AI 증빙 분석이 완료됐어요.');
  } catch (error) {
    $('#ocrResultPanel').innerHTML = `<div class="empty-tool-state error"><span>!</span><h3>분석을 완료하지 못했어요</h3><p>${escapeHTML(error.message)}</p><button type="button" id="retryOcrButton">다시 시도</button></div>`;
    $('#retryOcrButton').addEventListener('click', runOcr);
    showToast(error.message, 'error');
  } finally {
    button.disabled = false; button.innerHTML = '다시 분석하기 <span>↻</span>';
  }
}

function renderOcrResult(result, model) {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const items = Array.isArray(result.items) ? result.items : [];
  const matchClass = result.planMatch === '적합' ? 'match-good' : result.planMatch === '부적합' ? 'match-bad' : 'match-review';
  $('#ocrResultPanel').innerHTML = `<div class="ocr-result-header"><div><small>AI 판독 완료</small><h3>${escapeHTML(result.documentType || '증빙 문서')}</h3></div><span class="confidence">신뢰도 ${escapeHTML(result.confidence ?? '-')}%</span></div>
    <div class="ocr-match ${matchClass}"><span>${result.planMatch === '적합' ? '✓' : '!'}</span><div><small>사용계획 일치도</small><strong>${escapeHTML(result.planMatch || '검토 필요')}</strong></div></div>
    <dl class="ocr-fields"><div><dt>공급자</dt><dd>${escapeHTML(result.merchant || '판독 안 됨')}</dd></div><div><dt>사업자번호</dt><dd>${escapeHTML(result.businessNumber || '판독 안 됨')}</dd></div><div><dt>거래일</dt><dd>${escapeHTML(result.date || '판독 안 됨')}</dd></div><div><dt>합계 금액</dt><dd class="amount">${won(result.total)}</dd></div></dl>
    <div class="ocr-items"><h4>추출 품목</h4>${items.length ? items.map(item => `<div><span>${escapeHTML(item.name || '품목 미상')} × ${escapeHTML(item.quantity || 1)}</span><b>${won(item.amount)}</b></div>`).join('') : '<p>추출된 품목이 없습니다.</p>'}</div>
    <div class="ocr-warnings"><h4>사람이 확인할 항목</h4>${warnings.length ? `<ul>${warnings.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : '<p>AI가 표시한 추가 경고가 없습니다. 원본 대조는 필요합니다.</p>'}</div>
    <div class="ocr-result-actions"><button type="button" id="askOcrAiButton">AI에게 결과 질문</button><button type="button" id="approveEvidenceButton">검토 완료 처리</button></div><small class="model-note">${escapeHTML(model)} 분석 · AI 자동 지급 아님</small>`;
  $('#askOcrAiButton').addEventListener('click', () => openAiDrawer('방금 OCR 결과에서 사람이 반드시 확인해야 할 항목을 정리해줘.'));
  $('#approveEvidenceButton').addEventListener('click', () => showToast('1차 검토 완료로 표시했어요. 실제 지급에는 운영자 승인이 필요합니다.'));
}

async function checkApiHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    const configured = response.ok && (data.apiConfigured || ['auto', 'ollama'].includes(data.ocrEngine));
    $('#apiStatusBadge').textContent = data.ocrEngine === 'ollama' ? `Ollama · ${data.ollamaModel}` : data.ocrEngine === 'auto' ? 'Ollama 우선 OCR' : (configured ? 'SGLLM 연결됨' : 'API 키 필요');
    $('#apiStatusBadge').classList.toggle('connected', configured);
    $('#aiStatusDot').classList.toggle('offline', !configured);
  } catch {
    $('#apiStatusBadge').textContent = '전용 서버로 실행 필요';
    $('#aiStatusDot').classList.add('offline');
  }
}

function buildAiContext() {
  const parts = [];
  if (currentStore) parts.push(`선택 가게: ${currentStore.name}, 지역 ${currentStore.area}, 업종 ${currentStore.category}, 목표 ${won(currentStore.target)}, 기본 달성률 ${currentStore.support}%, 사업계획: ${currentStore.campaign}, 투자 포인트: ${currentStore.points.join(' / ')}, 위험: ${currentStore.risks.join(' / ')}`);
  if (business) parts.push(`등록 사업체: ${business.name}, ${business.category}, ${business.address}, 월평균매출 ${won(business.sales)}, 업력 ${business.age}년, 소개: ${business.description}`);
  if (campaign) parts.push(`작성 펀딩: ${campaign.name}, 목표 ${won(campaign.target)}, 계획: ${campaign.plan}, 위험: ${campaign.risk}`);
  if (lastOcrResult) parts.push(`최근 OCR 결과: ${JSON.stringify(lastOcrResult)}`);
  if (intelligence) parts.push(`DB 지식그래프 진단: ${JSON.stringify(intelligence)}`);
  return parts.join('\n');
}
function updateAiContextLabel() {
  const label = $('#aiContextLabel');
  if (currentStore && $('#consumerView').classList.contains('active')) label.textContent = `${currentStore.name} 펀딩 정보를 함께 보고 있어요.`;
  else if ($('#ownerView').classList.contains('active')) label.textContent = business ? `${business.name} 사업계획과 증빙을 함께 보고 있어요.` : '사업체 등록과 펀딩 계획 작성을 도와드려요.';
  else label.textContent = '플랫폼 이용과 펀딩 분석을 도와드려요.';
}
function openAiDrawer(prefill = '') {
  $('#aiDrawer').classList.add('open'); $('#aiDrawer').setAttribute('aria-hidden', 'false'); $('#drawerBackdrop').classList.add('open'); document.body.classList.add('drawer-open');
  updateAiContextLabel();
  if (prefill) $('#chatInput').value = prefill;
  setTimeout(() => $('#chatInput').focus(), 50);
}
function closeAiDrawer() { $('#aiDrawer').classList.remove('open'); $('#aiDrawer').setAttribute('aria-hidden', 'true'); $('#drawerBackdrop').classList.remove('open'); document.body.classList.remove('drawer-open'); }
$('#aiFab').addEventListener('click', () => openAiDrawer());
$('#closeAiDrawer').addEventListener('click', closeAiDrawer);
$('#drawerBackdrop').addEventListener('click', closeAiDrawer);
$$('#chatSuggestions button').forEach(button => button.addEventListener('click', () => { $('#chatInput').value = button.textContent; $('#chatForm').requestSubmit(); }));
$('#chatInput').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`; });

function appendChatMessage(role, content, loading = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `chat-message ${role}${loading ? ' loading-message' : ''}`;
  const avatar = document.createElement('span'); avatar.textContent = role === 'assistant' ? 'AI' : (currentUser?.name?.slice(0, 1) || '나');
  const paragraph = document.createElement('p'); paragraph.textContent = content;
  wrapper.append(avatar, paragraph); $('#chatMessages').append(wrapper); $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  return wrapper;
}
$('#chatForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#chatInput'); const question = input.value.trim(); if (!question) return;
  input.value = ''; input.style.height = 'auto';
  appendChatMessage('user', question); chatHistory.push({ role: 'user', content: question });
  const loading = appendChatMessage('assistant', '답변을 준비하고 있어요…', true);
  const submit = $('button[type="submit"]', $('#chatForm')); submit.disabled = true;
  try {
    const response = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: chatHistory, context: buildAiContext() }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'AI 답변을 받지 못했습니다.');
    loading.remove(); appendChatMessage('assistant', data.message); chatHistory.push({ role: 'assistant', content: data.message });
  } catch (error) {
    loading.remove(); appendChatMessage('assistant', `연결 오류: ${error.message}\n로컬 페이지를 server.py로 실행했는지 확인해 주세요.`);
  } finally { submit.disabled = false; input.focus(); }
});

async function initialize() {
  renderStores(); renderRecommendations(); updateAuthUI(); updateOwnerUI(); updateDisclosureUI(); updateRegionUI(); checkApiHealth();
  try {
    const data = await apiRequest('/api/bootstrap');
    applyBootstrap(data);
    renderStores(); renderRecommendations(); updateAuthUI(); updateOwnerUI(); updateDisclosureUI(); updateRegionUI();
    if (campaign?.plan) $('#expensePlan').value = campaign.plan;
    updateAiContextLabel();
  } catch (error) {
    showToast(`DB 연결 실패: ${error.message}`, 'error');
  }
}

initialize();
