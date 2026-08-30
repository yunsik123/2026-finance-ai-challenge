import { verifyBusiness } from './business-verification.js';
import { assessMetrics } from './risk-model.js';

const runtimeEnv = import.meta.env || {};
const supabaseUrl = String(runtimeEnv.VITE_SUPABASE_URL || '')
  .trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const publishableKey = String(
  runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY || runtimeEnv.VITE_SUPABASE_ANON_KEY || ''
).trim();
const SESSION_KEY = 'moa.session.v2';

export const cloudConfigured = Boolean(supabaseUrl && publishableKey);

function storedSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return session?.access_token ? session : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function cloudSessionHeaders() {
  const session = storedSession();
  return session?.access_token ? { Authorization: 'Bearer ' + session.access_token } : {};
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(
      data?.message || data?.msg || data?.error_description || data?.error
      || ('Supabase 요청 실패 (' + response.status + ')')
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

async function auth(path, body, token = '') {
  return requestJson(supabaseUrl + '/auth/v1/' + path, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: 'Bearer ' + (token || publishableKey),
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function activeSession() {
  const session = storedSession();
  if (!session) return null;
  if (!session.expires_at || session.expires_at * 1000 > Date.now() + 60_000) return session;
  if (!session.refresh_token) {
    saveSession(null);
    return null;
  }
  try {
    const refreshed = await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    saveSession(refreshed);
    return refreshed;
  } catch {
    saveSession(null);
    return null;
  }
}

async function rest(path, { method = 'GET', body, prefer = '', anonymous = false } = {}) {
  const session = anonymous ? null : await activeSession();
  const headers = {
    apikey: publishableKey,
    Authorization: 'Bearer ' + (session?.access_token || publishableKey),
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return requestJson(supabaseUrl + '/rest/v1/' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const first = rows => Array.isArray(rows) ? (rows[0] || null) : rows;
const idsFilter = ids => '(' + ids.map(id => '"' + id + '"').join(',') + ')';
const byId = rows => new Map((rows || []).map(row => [row.id, row]));
const grouped = (rows, field) => {
  const result = new Map();
  (rows || []).forEach(row => {
    const key = row[field];
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  });
  return result;
};

function userDto(row, session = null) {
  return row ? {
    id: row.id,
    name: row.display_name || '사용자',
    email: row.email?.endsWith('@accounts.moa.local') ? '' : row.email,
    role: row.role
  } : null;
}

export function normalizeQuickAccountName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

export async function quickAccountEmail(name, role) {
  const normalizedName = normalizeQuickAccountName(name);
  if (!['investor', 'owner'].includes(role)) throw new Error('간편 계정을 만들 수 없는 역할입니다.');
  if (normalizedName.length < 2 || normalizedName.length > 40) {
    throw new Error('로그인 이름은 2자 이상 40자 이하로 입력해 주세요.');
  }
  const bytes = new TextEncoder().encode(role + ':' + normalizedName);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 40);
  return 'q-' + role + '-' + hash + '@accounts.moa.local';
}

function businessDto(row) {
  return row ? {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    category: row.category,
    number: row.business_number,
    address: row.address,
    sales: Number(row.monthly_sales),
    age: Number(row.business_age),
    description: row.description,
    verificationStatus: row.verification_status,
    verificationNote: row.verification_note || '',
    representativeName: row.representative_name || '',
    openingDate: row.opening_date || '',
    restaurantLicenseConfirmed: Boolean(row.restaurant_license_confirmed),
    applicantIsRepresentative: Boolean(row.applicant_is_representative),
    posDataConsent: Boolean(row.pos_data_consent),
    cardSalesConsent: Boolean(row.card_sales_consent),
    ownerStory: row.owner_story || '',
    highlights: Array.isArray(row.highlights) ? row.highlights : (typeof row.highlights === 'string' ? (row.highlights.startsWith('[') ? JSON.parse(row.highlights) : row.highlights.split(',').map(s => s.trim())) : []),
    menuItems: Array.isArray(row.menu_items) ? row.menu_items : (typeof row.menu_items === 'string' && row.menu_items.startsWith('[') ? JSON.parse(row.menu_items) : []),
    isDemo: Boolean(row.is_demo)
  } : null;
}

function milestoneDto(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sequence: Number(row.sequence_no),
    title: row.title,
    condition: row.condition_text,
    percent: Number(row.release_percent),
    status: row.status,
    dueDate: row.due_date || ''
  };
}

function assessmentDto(row) {
  return row ? {
    id: row.id,
    score: Number(row.score),
    grade: row.s_grade || 'S5',
    riskLevel: row.risk_level,
    fundingLimit: Number(row.funding_limit),
    components: row.components || {},
    contributions: row.contributions || [],
    diagnostics: row.model_inputs || {},
    methodology: row.methodology || {},
    modelVersion: row.model_version || '',
    missing: row.missing_fields || [],
    isOfficial: Boolean(row.is_official),
    verificationRunId: row.verification_run_id || null,
    createdAt: row.created_at
  } : null;
}

function financialVerificationDto(row, business = null) {
  return row ? {
    id: row.id, businessId: row.business_id, userId: row.user_id,
    claimedMetrics: row.claimed_metrics || {}, documents: row.document_results || [],
    orchestration: row.orchestration || {}, status: row.status,
    reviewNote: row.review_note || '', reviewedAt: row.reviewed_at,
    business,
    createdAt: row.created_at
  } : null;
}

function campaignDto(row, relations = {}) {
  const business = relations.businesses?.get(row.business_id);
  const stats = relations.stats?.get(row.id) || {};
  const assessments = relations.assessments?.get(row.business_id) || [];
  return {
    id: row.id,
    userId: row.user_id,
    businessId: row.business_id,
    name: row.name,
    target: Number(row.target_amount),
    duration: Number(row.duration_days),
    plan: row.plan,
    risk: row.risk,
    status: row.status,
    fundStatus: row.fund_status || 'fundraising',
    currentAmount: Number(row.current_amount || 0),
    maxDiscountRate: Number(row.max_discount_rate || 30),
    minCouponRate: Number(row.min_coupon_rate || 10),
    couponMaxAmount: row.coupon_max_amount ? Number(row.coupon_max_amount) : null,
    closedAt: row.closed_at || null,
    representativeMenu: row.representative_menu || '',
    representativeMenuPrice: Number(row.representative_menu_price || 0),
    closesAt: row.closes_at || null,
    imageUrl: row.image_url || '',
    investorBenefits: row.investor_benefits || '',
    reviewNote: row.review_note || '',
    publishedAt: row.published_at,
    isDemo: Boolean(business?.is_demo),
    business: businessDto(business),
    milestones: (relations.milestones?.get(row.id) || [])
      .sort((a, b) => a.sequence_no - b.sequence_no).map(milestoneDto),
    assessment: assessmentDto(assessments[0]),
    committedTotal: Number(stats.committed_total || 0),
    escrowTotal: Number(stats.escrow_total || 0),
    investorCount: Number(stats.investor_count || 0),
    evidence: (relations.evidence?.get(row.id) || []).map(evidenceDto),
    disbursements: (relations.disbursements?.get(row.id) || []).map(disbursementDto)
  };
}

function commitmentDto(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    investorId: row.investor_id,
    amount: Number(row.amount),
    status: row.status,
    createdAt: row.created_at
  };
}

function evidenceDto(row) {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    campaignId: row.campaign_id,
    businessId: row.business_id,
    userId: row.user_id,
    filename: row.filename,
    claimedAmount: Number(row.claimed_amount),
    planMatch: row.plan_match,
    result: row.result || {},
    status: row.status,
    reviewNote: row.review_note || '',
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  };
}

function disbursementDto(row) {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    campaignId: row.campaign_id,
    amount: Number(row.amount),
    status: row.status,
    releasedAt: row.released_at
  };
}

// ─── 새 DTO 함수들 ─────────────────────────────────────────────

function investmentDto(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    investorId: row.investor_id,
    investedAmount: Number(row.invested_amount),
    couponAccrualRate: Number(row.accrued_discount || 0),
    lastAccrualUpdate: row.last_accrual_at,
    status: row.status,
    investedAt: row.invested_at
  };
}

function couponDto(row) {
  const rawRate = Number(row.discount_rate || 0);
  const rate = Number(rawRate.toFixed(4));
  const rawDesc = row.description ? String(row.description) : '';
  const cleanDesc = rawDesc.replace(/(\d+\.\d{3,})%/g, (m, p) => Number(Number(p).toFixed(4)) + '%');
  return {
    id: row.id,
    campaignId: row.campaign_id,
    ownerId: row.owner_id,
    originalInvestorId: row.original_investor_id,
    discountRate: rate,
    couponType: row.coupon_type,
    benefitKind: row.benefit_kind || 'percent',
    description: cleanDesc || (rate > 0 ? `${rate}% 할인` : ''),
    maxDiscountAmount: row.max_discount_amount ? Number(row.max_discount_amount) : null,
    status: row.status,
    usedOrderAmount: row.used_order_amount ? Number(row.used_order_amount) : null,
    discountAmount: row.discount_amount ? Number(row.discount_amount) : null,
    usedAt: row.used_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

function reservationDto(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    investorId: row.investor_id,
    reservedAmount: Number(row.reserved_amount),
    matchedAmount: Number(row.matched_amount || 0),
    status: row.status,
    createdAt: row.created_at
  };
}

function withdrawalDto(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    investorId: row.investor_id,
    requestedAmount: Number(row.requested_amount),
    matchedAmount: Number(row.matched_amount || 0),
    status: row.status,
    couponIssued: Boolean(row.coupon_issued),
    createdAt: row.created_at
  };
}

function thematicFundDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    region: row.region || '',
    category: row.category || '',
    imageUrl: row.image_url || '',
    isActive: Boolean(row.is_active)
  };
}

function aiContentDto(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    contentType: row.content_type,
    createdAt: row.created_at
  };
}

function rankingDto(campaign, investment, couponCount) {
  return {
    campaignId: campaign.id,
    businessName: campaign.business?.name || '',
    category: campaign.business?.category || '',
    address: campaign.business?.address || '',
    score: campaign.assessment?.score || 0,
    riskLevel: campaign.assessment?.riskLevel || 'review',
    investorCount: campaign.investorCount || 0,
    totalFunded: campaign.currentAmount || campaign.committedTotal || 0,
    couponCount: couponCount || 0,
    representativeMenu: campaign.representativeMenu || '',
    maxDiscountRate: campaign.maxDiscountRate || 30
  };
}

// ─── 쿠폰 누적 할인율 계산 ──────────────────────────────────────

function calculateCouponAccrual(investedAmount, startDate, dailyGrowthRate = 0.5) {
  const now = new Date();
  const start = new Date(startDate);
  const diffMs = now - start;
  const days = Math.max(0, diffMs / (1000 * 60 * 60 * 24));
  // discount_growth = investment_amount / 100000 × daily_growth_rate × days
  const growthRate = (investedAmount / 100000) * dailyGrowthRate * days;
  return Number(growthRate.toFixed(2));
}

async function campaignRelations(campaignRows, { anonymous = false, includePrivate = false } = {}) {
  if (!campaignRows.length) {
    return {
      businesses: new Map(), milestones: new Map(), assessments: new Map(),
      stats: new Map(), evidence: new Map(), disbursements: new Map()
    };
  }
  const campaignIds = campaignRows.map(row => row.id);
  const businessIds = [...new Set(campaignRows.map(row => row.business_id))];
  const [businessRows, milestoneRows, assessmentRows, statRows, evidenceRows, disbursementRows] = await Promise.all([
    rest('businesses?select=*&id=in.' + idsFilter(businessIds), { anonymous }),
    rest('campaign_milestones?select=*&campaign_id=in.' + idsFilter(campaignIds) + '&order=sequence_no.asc', { anonymous }),
    rest('credit_assessments?select=*&business_id=in.' + idsFilter(businessIds) + '&order=created_at.desc', { anonymous }),
    rest('rpc/public_campaign_stats', { method: 'POST', body: {}, anonymous }),
    rest(
      'evidence_submissions?select=*&campaign_id=in.' + idsFilter(campaignIds)
        + (includePrivate ? '' : '&status=eq.approved') + '&order=created_at.desc',
      { anonymous }
    ),
    rest('disbursements?select=*&campaign_id=in.' + idsFilter(campaignIds) + '&order=created_at.asc', { anonymous })
  ]);
  return {
    businesses: byId(businessRows),
    milestones: grouped(milestoneRows, 'campaign_id'),
    assessments: grouped(assessmentRows, 'business_id'),
    stats: new Map((statRows || []).map(row => [row.campaign_id, row])),
    evidence: grouped(evidenceRows, 'campaign_id'),
    disbursements: grouped(disbursementRows, 'campaign_id')
  };
}

async function publicCampaigns() {
  const rows = await rest(
    'campaigns?select=*&status=eq.published&order=published_at.desc',
    { anonymous: true }
  );
  const relations = await campaignRelations(rows, { anonymous: true });
  return rows.map(row => campaignDto(row, relations));
}

async function loginHistory(userId) {
  const rows = await rest(
    'login_events?select=event_type,user_agent,created_at&user_id=eq.' + userId
      + '&order=created_at.desc&limit=8'
  );
  return rows.map(row => ({
    event: row.event_type,
    label: row.event_type === 'login_success' ? '로그인' : '로그아웃',
    createdAt: row.created_at,
    userAgent: row.user_agent
  }));
}

async function ownerData(userId) {
  const businessRows = await rest('businesses?select=*&user_id=eq.' + userId + '&limit=1');
  const business = businessDto(first(businessRows));
  const campaignRows = await rest(
    'campaigns?select=*&user_id=eq.' + userId + '&order=updated_at.desc'
  );
  const relations = await campaignRelations(campaignRows, { includePrivate: true });
  const settings = first(await rest('user_settings?select=*&user_id=eq.' + userId + '&limit=1'));
  const metrics = business
    ? first(await rest('business_metrics?select=*&business_id=eq.' + business.id + '&limit=1'))
    : null;
  const financialVerification = business
    ? financialVerificationDto(first(await rest(
      'financial_verification_runs?select=*&business_id=eq.' + business.id + '&order=created_at.desc&limit=1'
    ))) : null;
  return {
    business,
    campaigns: campaignRows.map(row => campaignDto(row, relations)),
    disclosures: settings?.disclosures || [],
    region: settings?.region || '서울 전체',
    metrics,
    financialVerification,
    assessment: business
      ? assessmentDto(first(await rest(
        'credit_assessments?select=*&business_id=eq.' + business.id
          + '&order=created_at.desc&limit=1'
      )))
      : null
  };
}

async function adminData() {
  const [campaignRows, commitmentRows, evidenceRows, financialRows, businessRows, auditRows] = await Promise.all([
    rest('campaigns?select=*&order=updated_at.desc'),
    rest('funding_commitments?select=*&order=created_at.desc'),
    rest('evidence_submissions?select=*&order=created_at.desc'),
    rest('financial_verification_runs?select=*&order=created_at.desc'),
    rest('businesses?select=*'),
    rest('audit_events?select=*&order=created_at.desc&limit=80')
  ]);
  const relations = await campaignRelations(campaignRows, { includePrivate: true });
  const businesses = byId(businessRows);
  return {
    campaigns: campaignRows.map(row => campaignDto(row, relations)),
    commitments: commitmentRows.map(commitmentDto),
    evidence: evidenceRows.map(evidenceDto),
    financialVerifications: financialRows.map(row => financialVerificationDto(row, businessDto(businesses.get(row.business_id)))),
    audit: auditRows
  };
}

async function bootstrap() {
  const [campaigns, rankingData, thematicData, insightData] = await Promise.all([
    publicCampaigns(), getRankings(), getThematicFunds(), getAiContents()
  ]);
  const session = await activeSession();
  const empty = {
    ok: true,
    user: null,
    campaigns,
    commitments: [],
    portfolio: null,
    ownerFund: null,
    discovery: {
      rankings: rankingData.rankings || [], themes: thematicData.funds || [], insights: insightData.contents || []
    },
    loginHistory: [],
    owner: null,
    admin: null
  };
  if (!session?.user?.id) return empty;
  const profile = first(await rest('profiles?select=*&id=eq.' + session.user.id + '&limit=1'));
  if (!profile) {
    saveSession(null);
    return empty;
  }
  const user = userDto(profile, session);
  const history = await loginHistory(user.id);
  if (user.role === 'owner') {
    const [owner, ownerFund] = await Promise.all([ownerData(user.id), getOwnerCouponDashboard()]);
    return { ...empty, user, loginHistory: history, owner, ownerFund };
  }
  if (user.role === 'admin') {
    const admin = await adminData();
    return { ...empty, user, loginHistory: history, admin };
  }
  const [commitmentRows, portfolio] = await Promise.all([
    rest('funding_commitments?select=*&investor_id=eq.' + user.id + '&order=created_at.desc'),
    getMyInvestments()
  ]);
  return {
    ...empty,
    user,
    loginHistory: history,
    commitments: commitmentRows.map(commitmentDto),
    portfolio
  };
}

async function authenticate(values) {
  const role = values.role || 'investor';
  const rawInput = String(values.name || values.email || '').trim();
  const isEmailInput = rawInput.includes('@');
  const displayName = isEmailInput ? (values.name || rawInput.split('@')[0]) : rawInput;
  const password = String(values.password || '');
  const action = values.action || 'login';

  if (action === 'signup' && !['investor', 'owner'].includes(role)) {
    throw new Error('운영자 계정은 공개 회원가입으로 만들 수 없습니다.');
  }
  if (!['investor', 'owner', 'admin'].includes(role)) {
    throw new Error('올바른 역할을 선택해 주세요.');
  }
  if (!rawInput) {
    throw new Error('로그인 아이디 또는 이메일을 입력해 주세요.');
  }
  if (password.length < 6 || password.length > 72) {
    throw new Error('비밀번호는 6자 이상 72자 이하로 입력해 주세요.');
  }

  let email = isEmailInput ? rawInput : '';
  if (!email) {
    if (role === 'admin') {
      email = rawInput.toLowerCase() === 'admin' ? 'admin@moa.local' : (rawInput + '@moa.local');
    } else {
      email = await quickAccountEmail(rawInput, role);
    }
  }
  let session = null;

  if (action === 'signup') {
    // 1. 서버리스 Direct Auth 시도 (Admin API로 email_confirm=true 생성하여 Email Rate Limit 완전 차단)
    try {
      const serverAuthRes = await fetch('/api/ai/auth-direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: displayName, role, action: 'signup' })
      });
      if (serverAuthRes.ok) {
        const data = await serverAuthRes.json();
        if (data.session?.access_token) {
          session = data.session;
        }
      }
    } catch (directErr) {
      // 서버리스가 없는 로컬/오프라인 환경일 경우 아래 Supabase 직접 호출로 fallback
    }

    // 2. 만약 Direct Auth 세션이 없으면 Supabase Auth Client로 가입 또는 자동 로그인 시도
    if (!session?.access_token) {
      // 먼저 기존 계정인지 비밀번호 로그인을 시도
      const autoLogin = await auth('token?grant_type=password', { email, password }).catch(() => null);
      if (autoLogin?.access_token) {
        session = autoLogin;
      } else {
        try {
          const signupRes = await auth('signup', {
            email,
            password,
            data: { name: displayName, role, account_type: isEmailInput ? 'email' : 'quick' }
          });
          session = signupRes?.access_token ? signupRes : signupRes?.session;
          if (!session?.access_token) {
            const tokenRes = await auth('token?grant_type=password', { email, password }).catch(() => null);
            if (tokenRes?.access_token) session = tokenRes;
          }
        } catch (signupError) {
          // 가입 에러 시 마지막으로 비밀번호 로그인 재시도
          const lastTryLogin = await auth('token?grant_type=password', { email, password }).catch(() => null);
          if (lastTryLogin?.access_token) {
            session = lastTryLogin;
          } else {
            if ([400, 409, 422].includes(signupError.status) || signupError.message?.includes('already registered')) {
              throw new Error('이미 등록된 로그인 아이디입니다. 비밀번호를 확인하거나 다른 이름을 입력해 주세요.');
            }
            throw new Error('계정을 준비하지 못했습니다. 비밀번호를 확인해 주세요.');
          }
        }
      }
    }
  } else {
    // 다시 로그인 (Login)
    try {
      const loginRes = await auth('token?grant_type=password', { email, password });
      session = loginRes?.access_token ? loginRes : loginRes?.session;
    } catch (loginError) {
      if ([400, 401].includes(loginError.status) || loginError.message?.includes('Invalid login credentials')) {
        throw new Error('로그인 정보가 일치하지 않습니다. 처음이라면 [처음 시작]을 선택해 주세요.');
      }
      throw loginError;
    }
  }

  if (!session?.access_token) {
    throw new Error('로그인 토큰을 발급받지 못했습니다. 다시 시도해 주세요.');
  }

  saveSession(session);

  const profile = first(await rest('profiles?select=*&id=eq.' + session.user.id + '&limit=1'));
  if (!profile) {
    // 프로필이 아직 생성 중인 경우 잠시 대기 후 재조회
    await new Promise(r => setTimeout(r, 400));
  }
  const finalProfile = first(await rest('profiles?select=*&id=eq.' + session.user.id + '&limit=1'));
  if (finalProfile && role && finalProfile.role !== role && finalProfile.role !== 'admin') {
    saveSession(null);
    const labels = { investor: '투자자', owner: '소상공인', admin: '운영자' };
    throw new Error('이 계정은 ' + (labels[finalProfile.role] || finalProfile.role) + ' 계정입니다.');
  }

  await rest('login_events', {
    method: 'POST',
    body: { user_id: session.user.id, event_type: 'login_success', user_agent: navigator.userAgent },
    prefer: 'return=minimal'
  }).catch(() => {});

  return bootstrap();
}

async function logout() {
  const session = await activeSession();
  if (session?.user?.id) {
    await rest('login_events', {
      method: 'POST',
      body: { user_id: session.user.id, event_type: 'logout', user_agent: navigator.userAgent },
      prefer: 'return=minimal'
    }).catch(() => {});
    await auth('logout', undefined, session.access_token).catch(() => {});
  }
  saveSession(null);
  return { ok: true };
}

async function saveBusiness(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const verification = await verifyBusiness(body);
  if (!verification.verified) throw new Error(verification.message);
  const row = first(await rest('businesses?on_conflict=user_id&select=*', {
    method: 'POST',
    body: {
      user_id: session.user.id,
      name: body.name,
      category: body.category,
      business_number: body.number,
      address: body.address,
      monthly_sales: body.sales,
      business_age: body.age,
      description: body.description,
      representative_name: body.representativeName || '',
      opening_date: body.openingDate || null,
      restaurant_license_confirmed: Boolean(body.restaurantLicenseConfirmed),
      applicant_is_representative: Boolean(body.applicantIsRepresentative),
      pos_data_consent: Boolean(body.posDataConsent),
      card_sales_consent: Boolean(body.cardSalesConsent),
      owner_story: body.ownerStory || '',
      highlights: body.highlights || [],
      menu_items: body.menuItems || []
    },
    prefer: 'resolution=merge-duplicates,return=representation'
  }));
  return { ok: true, business: businessDto(row), verification };
}

async function saveMetrics(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const business = businessDto(first(await rest(
    'businesses?select=*&user_id=eq.' + session.user.id + '&limit=1'
  )));
  if (!business) throw new Error('사업체 정보를 먼저 저장해 주세요.');
  await rest('business_metrics?on_conflict=business_id', {
    method: 'POST',
    body: {
      business_id: business.id,
      sales_6m: body.sales6m,
      operating_cash_flow: body.operatingCashFlow,
      debt_total: body.debtTotal,
      monthly_debt_payment: body.monthlyDebtPayment,
      overdue_count: body.overdueCount,
      employee_count: body.employeeCount,
      tax_compliant: body.taxCompliant,
      foot_traffic_growth: body.footTrafficGrowth,
      local_sales_growth: body.localSalesGrowth,
      competitor_density: body.competitorDensity,
      closure_rate: body.closureRate,
      repeat_rate: body.repeatRate,
      digital_sales_ratio: body.digitalSalesRatio,
      card_sales_6m: body.cardSales6m || [],
      cash_sales_6m: body.cashSales6m || [],
      monthly_fixed_cost: body.monthlyFixedCost || 0,
      monthly_rent: body.monthlyRent || 0,
      monthly_labor_cost: body.monthlyLaborCost || 0,
      monthly_material_cost: body.monthlyMaterialCost || 0,
      administrative_action_count: body.administrativeActionCount || 0,
      representative_change_count: body.representativeChangeCount || 0,
      source_dates: { owner_input: new Date().toISOString().slice(0, 10) },
      updated_at: new Date().toISOString()
    },
    prefer: 'resolution=merge-duplicates,return=minimal'
  });
  const assessment = assessMetrics(body, business);
  await rest('credit_assessments', {
    method: 'POST',
    body: {
      business_id: business.id,
      score: assessment.score,
      s_grade: assessment.grade,
      risk_level: assessment.riskLevel,
      funding_limit: assessment.fundingLimit,
      components: assessment.components,
      contributions: assessment.contributions,
      model_inputs: assessment.diagnostics,
      methodology: assessment.methodology,
      missing_fields: assessment.missing,
      model_version: assessment.methodology.modelVersion,
      is_official: false
    },
    prefer: 'return=minimal'
  });
  return { ok: true, assessment };
}

async function saveDisclosures(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const row = first(await rest('user_settings?on_conflict=user_id&select=*', {
    method: 'POST',
    body: {
      user_id: session.user.id,
      disclosures: body.values,
      updated_at: new Date().toISOString()
    },
    prefer: 'resolution=merge-duplicates,return=representation'
  }));
  return { ok: true, disclosures: row.disclosures || [] };
}

async function saveCampaign(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const business = first(await rest(
    'businesses?select=id&user_id=eq.' + session.user.id + '&limit=1'
  ));
  if (!business) throw new Error('사업체 정보를 먼저 저장해 주세요.');
  const payload = {
    user_id: session.user.id,
    business_id: business.id,
    name: body.name,
    target_amount: body.target,
    duration_days: body.duration,
    plan: body.plan,
    risk: body.risk,
    max_discount_rate: body.maxDiscountRate || 30,
    min_coupon_rate: body.minCouponRate || 10,
    coupon_max_amount: body.couponMaxAmount || null,
    representative_menu: body.representativeMenu || '',
    representative_menu_price: body.representativeMenuPrice || 0,
    image_url: body.imageUrl || '',
    investor_benefits: body.investorBenefits || '',
    updated_at: new Date().toISOString()
  };
  const campaign = body.id
    ? first(await rest('campaigns?id=eq.' + body.id + '&select=*', {
      method: 'PATCH', body: payload, prefer: 'return=representation'
    }))
    : first(await rest('campaigns?select=*', {
      method: 'POST', body: payload, prefer: 'return=representation'
    }));
  if (!campaign) throw new Error('모집안을 저장하지 못했습니다.');
  await rest('campaign_milestones?campaign_id=eq.' + campaign.id, {
    method: 'DELETE',
    prefer: 'return=minimal'
  });
  const milestones = body.milestones.map((item, index) => ({
    campaign_id: campaign.id,
    sequence_no: index + 1,
    title: item.title,
    condition_text: item.condition,
    release_percent: item.percent,
    due_date: item.dueDate || null,
    status: 'planned'
  }));
  await rest('campaign_milestones', {
    method: 'POST',
    body: milestones,
    prefer: 'return=minimal'
  });
  return { ok: true, campaignId: campaign.id };
}

async function rpc(name, body) {
  return first(await rest('rpc/' + name, {
    method: 'POST',
    body,
    prefer: 'return=representation'
  }));
}

async function createCommitment(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const row = first(await rest('funding_commitments?select=*', {
    method: 'POST',
    body: {
      campaign_id: body.campaignId,
      investor_id: session.user.id,
      amount: body.amount,
      risk_consent: body.riskConsent,
      status: 'committed'
    },
    prefer: 'return=representation'
  }));
  return { ok: true, commitment: commitmentDto(row) };
}

async function passwordRecovery(body) {
  await auth('recover', {
    email: body.email,
    redirect_to: window.location.origin
  });
  return { ok: true };
}

// ─── 새 API 핸들러들: 투자/회수/쿠폰/대시보드 ───────────────────

async function getPolicies() {
  try {
    const rows = await rest('fund_policies?select=*', { anonymous: true });
    const policies = {};
    (rows || []).forEach(row => { policies[row.policy_key] = row.policy_value; });
    return policies;
  } catch {
    return {
      max_investment_ratio: { value: 0.01 },
      investment_unit: { value: 1000 },
      daily_coupon_growth_rate: { value: 0.5 },
      coupon_trade_max_diff: { value: 10 },
      sales_growth_bonus_multiplier: { value: 0.2 }
    };
  }
}

async function investInCampaign(body) {
  const amount = Number(body.amount);
  const policies = await getPolicies();
  const unit = policies.investment_unit?.value || 1000;
  if (!amount || amount < unit || amount % unit !== 0) {
    throw new Error(`투자 금액은 ${unit.toLocaleString()}원 단위로 입력해 주세요.`);
  }
  const result = await rpc('invest_fund', {
    p_campaign_id: body.campaignId,
    p_amount: amount,
    p_risk_consent: Boolean(body.riskConsent)
  });
  return { ok: true, ...(result || {}) };
}

async function closeFund(body) {
  const result = await rpc('close_fund', { p_campaign_id: body.campaignId });
  return { ok: true };
}

async function requestWithdrawal(body) {
  const amount = Number(body.amount);
  const policies = await getPolicies();
  const unit = policies.investment_unit?.value || 1000;
  if (!amount || amount < unit || amount % unit !== 0) {
    throw new Error(`회수 금액은 ${unit.toLocaleString()}원 단위로 입력해 주세요.`);
  }
  const result = await rpc('withdraw_fund', {
    p_campaign_id: body.campaignId,
    p_amount: amount
  });
  return { ok: true, ...(result || {}) };
}

async function issueCoupon(body) {
  const result = await rpc('issue_accrued_coupon', { p_campaign_id: body.campaignId });
  return { ok: true, coupon: result ? couponDto(result) : null };
}

async function useCoupon(body) {
  const result = await rpc('use_coupon', {
    p_coupon_id: body.couponId,
    p_order_amount: Number(body.orderAmount)
  });
  return { ok: true, coupon: result ? couponDto(result) : null };
}

async function getMyCoupons() {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const rows = await rest(
    'coupons?select=*&owner_id=eq.' + session.user.id + '&order=created_at.desc'
  );
  return { ok: true, coupons: (rows || []).map(couponDto) };
}

async function getMyInvestments() {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const userId = session.user.id;

  const [invRows, resRows, wdRows, couponRows, tradeRows, marketCouponRows] = await Promise.all([
    rest('investments?select=*&investor_id=eq.' + userId + '&order=invested_at.desc'),
    rest('investment_reservations?select=*&investor_id=eq.' + userId + '&status=in.(pending,partial)&order=created_at.desc'),
    rest('withdrawal_requests?select=*&investor_id=eq.' + userId + '&status=in.(pending,partial)&order=created_at.desc'),
    rest('coupons?select=*&owner_id=eq.' + userId + '&order=created_at.desc'),
    rest('coupon_trades?select=*&status=eq.open&order=created_at.asc'),
    rest('coupons?select=*&status=eq.trade_pending')
  ]);

  const policies = await getPolicies();
  const dailyRate = policies.daily_coupon_growth_rate?.value || 0.5;

  // 각 투자에 대해 현재 누적 할인율을 계산
  const investments = (invRows || []).map(row => {
    const dto = investmentDto(row);
    const newAccrual = calculateCouponAccrual(dto.investedAmount, dto.lastAccrualUpdate, dailyRate);
    dto.currentAccrualRate = Number((dto.couponAccrualRate + newAccrual).toFixed(2));
    return dto;
  });

  const totalInvested = investments.reduce((sum, inv) => sum + (inv.status === 'active' ? inv.investedAmount : 0), 0);
  const totalCoupons = (couponRows || []).length;
  const availableCoupons = (couponRows || []).filter(r => r.status === 'available').length;

  return {
    ok: true,
    investments,
    reservations: (resRows || []).map(reservationDto),
    withdrawals: (wdRows || []).map(withdrawalDto),
    coupons: (couponRows || []).map(couponDto),
    trades: tradeRows || [],
    marketCoupons: (marketCouponRows || []).map(couponDto),
    summary: { totalInvested, totalCoupons, availableCoupons }
  };
}

async function getOwnerCouponDashboard() {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const userId = session.user.id;

  const business = first(await rest('businesses?select=id&user_id=eq.' + userId + '&limit=1'));
  if (!business) return { ok: true, campaigns: [], coupons: [], monthlySales: [] };

  const campaigns = await rest('campaigns?select=*&business_id=eq.' + business.id + '&order=updated_at.desc');
  const campaignIds = campaigns.map(c => c.id);
  if (!campaignIds.length) return { ok: true, campaigns: [], coupons: [], monthlySales: [] };

  const [couponRows, salesRows, investmentRows, reservationRows, withdrawalRows] = await Promise.all([
    rest('coupons?select=*&campaign_id=in.' + idsFilter(campaignIds) + '&order=created_at.desc'),
    rest('restaurant_monthly_sales?select=*&business_id=eq.' + business.id + '&order=year_month.desc&limit=12'),
    rest('investments?select=*&campaign_id=in.' + idsFilter(campaignIds) + '&invested_amount=gt.0'),
    rest('investment_reservations?select=*&campaign_id=in.' + idsFilter(campaignIds) + '&status=in.(pending,partial)'),
    rest('withdrawal_requests?select=*&campaign_id=in.' + idsFilter(campaignIds) + '&status=in.(pending,partial)')
  ]);

  const totalIssued = (couponRows || []).length;
  const usedCount = (couponRows || []).filter(r => r.status === 'used').length;
  const availableCount = (couponRows || []).filter(r => r.status === 'available').length;

  const usedCoupons = (couponRows || []).filter(row => row.status === 'used');
  const couponRevenue = usedCoupons.reduce((sum, row) => sum + Number(row.used_order_amount || 0), 0);
  const discountCost = usedCoupons.reduce((sum, row) => sum + Number(row.discount_amount || 0), 0);
  const averageDiscountRate = totalIssued
    ? (couponRows || []).reduce((sum, row) => sum + Number(row.discount_rate || 0), 0) / totalIssued : 0;
  return {
    ok: true,
    coupons: (couponRows || []).map(couponDto),
    monthlySales: salesRows || [],
    investments: (investmentRows || []).map(investmentDto),
    reservations: (reservationRows || []).map(reservationDto),
    withdrawals: (withdrawalRows || []).map(withdrawalDto),
    summary: {
      totalIssued, usedCount, availableCount, couponRevenue, discountCost,
      averageDiscountRate: Number(averageDiscountRate.toFixed(1)),
      investorCount: new Set((investmentRows || []).map(row => row.investor_id)).size,
      reservationAmount: (reservationRows || []).reduce((sum, row) => sum + Number(row.reserved_amount - row.matched_amount), 0),
      withdrawalAmount: (withdrawalRows || []).reduce((sum, row) => sum + Number(row.requested_amount - row.matched_amount), 0)
    },
    campaignIds
  };
}

async function getRankings() {
  const campaigns = await publicCampaigns();
  // 종합 랭킹: 신용점수 × 0.4 + 투자자수 정규화 × 0.3 + 쿠폰매력도 × 0.3
  const ranked = campaigns
    .filter(c => c.status === 'published' || c.fundStatus === 'closed')
    .map(c => {
      const score = c.assessment?.score || 0;
      const investorScore = Math.min(c.investorCount / 100, 1) * 100;
      const couponScore = Math.min(c.maxDiscountRate / 60, 1) * 100;
      const totalScore = score * 0.4 + investorScore * 0.3 + couponScore * 0.3;
      return { ...rankingDto(c), totalScore: Number(totalScore.toFixed(1)) };
    })
    .sort((a, b) => b.totalScore - a.totalScore);
  return { ok: true, rankings: ranked };
}

async function getThematicFunds() {
  try {
    const funds = await rest('thematic_funds?select=*&is_active=eq.true&order=created_at.desc', { anonymous: true });
    const links = await rest('thematic_fund_restaurants?select=*', { anonymous: true });
    return {
      ok: true,
      funds: (funds || []).map(f => ({
        ...thematicFundDto(f),
        campaignIds: (links || []).filter(l => l.thematic_fund_id === f.id).map(l => l.campaign_id)
      }))
    };
  } catch {
    return { ok: true, funds: [] };
  }
}

async function getAiContents() {
  try {
    const rows = await rest(
      'ai_contents?select=*&is_published=eq.true&order=created_at.desc&limit=20',
      { anonymous: true }
    );
    return { ok: true, contents: (rows || []).map(aiContentDto) };
  } catch {
    return { ok: true, contents: [] };
  }
}

async function issueDividendCoupon(body) {
  const issuedCount = await rpc('issue_dividend_coupon', {
    p_campaign_id: body.campaignId,
    p_title: body.title || '감사 쿠폰',
    p_description: body.description || '',
    p_benefit_kind: body.benefitKind || 'percent',
    p_discount_value: Number(body.discountValue || 10),
    p_target: body.target || 'all'
  });
  return { ok: true, issuedCount: Number(issuedCount || 0) };
}

async function saveCampaignCouponSettings(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  await rest('campaigns?id=eq.' + body.campaignId + '&user_id=eq.' + session.user.id, {
    method: 'PATCH',
    body: {
      max_discount_rate: body.maxDiscountRate || 30,
      min_coupon_rate: body.minCouponRate || 10,
      coupon_max_amount: body.couponMaxAmount || null,
      representative_menu: body.representativeMenu || '',
      representative_menu_price: body.representativeMenuPrice || 0,
      updated_at: new Date().toISOString()
    },
    prefer: 'return=minimal'
  });
  return { ok: true };
}

async function saveMonthlySales(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const business = first(await rest('businesses?select=id&user_id=eq.' + session.user.id + '&limit=1'));
  if (!business) throw new Error('사업체를 먼저 등록해 주세요.');
  const result = await rpc('record_monthly_sales', {
    p_business_id: business.id,
    p_year_month: body.yearMonth,
    p_total_sales: Number(body.totalSales || 0),
    p_coupon_sales: Number(body.couponSales || 0),
    p_coupon_discount_total: Number(body.couponDiscountTotal || 0),
    p_coupons_used: Number(body.couponsUsed || 0)
  });
  return { ok: true, sales: result };
}

async function createCouponTrade(body) {
  const result = await rpc('create_coupon_trade', { p_coupon_id: body.couponId });
  return { ok: true, trade: result };
}

async function acceptCouponTrade(body) {
  const result = await rpc('accept_coupon_trade', { p_trade_id: body.tradeId, p_coupon_id: body.couponId });
  return { ok: true, trade: result };
}

async function getAssessmentExplanation(body) {
  const session = await activeSession();
  if (!session) throw new Error('로그인이 필요합니다.');
  const assessment = first(await rest(
    'credit_assessments?select=*&business_id=eq.' + body.businessId + '&order=created_at.desc&limit=1'
  ));
  if (!assessment) throw new Error('평가 결과를 찾을 수 없습니다.');
  const metrics = first(await rest(
    'business_metrics?select=*&business_id=eq.' + body.businessId + '&limit=1'
  ));
  const business = first(await rest(
    'businesses?select=*&id=eq.' + body.businessId + '&limit=1'
  ));
  // AI 설명을 위한 컨텍스트 생성
  const components = assessment.components || {};
  const explanation = generateAssessmentExplanation(assessment, metrics, business);
  return { ok: true, explanation, assessment: assessmentDto(assessment) };
}

function generateAssessmentExplanation(assessment, metrics, business) {
  const c = assessment.components || {};
  const grade = assessment.s_grade || 'S5';
  const score = Number(assessment.score);
  const riskLabel = assessment.risk_level === 'low' ? '낮음' : assessment.risk_level === 'high' ? '높음' : '보통';

  let explanation = `### ${business?.name || '사업체'} 신용평가 결과: ${grade} 등급 (${score}점)\n\n`;
  explanation += `**종합 위험도:** ${riskLabel}\n\n`;

  // 매출 지속성
  const sales6m = metrics?.sales_6m || [];
  if (sales6m.length >= 2) {
    const first = Number(sales6m[0]), last = Number(sales6m[sales6m.length - 1]);
    const growth = first > 0 ? ((last / first - 1) * 100).toFixed(1) : 0;
    explanation += `**📊 매출 지속성 (${c['매출 지속성'] || '-'}점):** `;
    if (growth > 5) explanation += `최근 6개월간 매출이 ${growth}% 증가하여 성장 추세가 확인됩니다.`;
    else if (growth > 0) explanation += `최근 6개월간 매출이 소폭(${growth}%) 증가하였으나 성장률이 크지 않습니다.`;
    else explanation += `최근 6개월간 매출이 ${growth}% 감소하여 매출 하락 위험이 있습니다.`;
    explanation += '\n\n';
  }

  // 현금흐름 여력
  const cashFlow = Number(metrics?.operating_cash_flow || 0);
  const debtPayment = Number(metrics?.monthly_debt_payment || 1);
  const cashCoverage = (cashFlow / debtPayment).toFixed(1);
  explanation += `**💰 현금흐름 여력 (${c['현금흐름 여력'] || '-'}점):** `;
  if (cashCoverage > 3) explanation += `월 영업현금흐름이 부채 상환액의 ${cashCoverage}배로 여유가 있습니다.`;
  else if (cashCoverage > 1.5) explanation += `월 영업현금흐름이 부채 상환액의 ${cashCoverage}배로 보통 수준입니다.`;
  else explanation += `월 영업현금흐름이 부채 상환액의 ${cashCoverage}배로 유동성 위험이 있습니다.`;
  explanation += '\n\n';

  // 부채 부담
  const debtTotal = Number(metrics?.debt_total || 0);
  const annualSales = Number(business?.monthly_sales || 0) * 12;
  const debtRatio = annualSales > 0 ? (debtTotal / annualSales * 100).toFixed(0) : '∞';
  explanation += `**📋 부채 부담 (${c['부채 부담'] || '-'}점):** `;
  explanation += `총 부채(${(debtTotal / 10000).toFixed(0)}만원)는 연매출 대비 ${debtRatio}% 수준입니다. `;
  if (Number(metrics?.overdue_count || 0) > 0) explanation += `연체 이력(${metrics.overdue_count}건)이 있어 주의가 필요합니다.`;
  else explanation += '연체 이력은 없습니다.';
  explanation += '\n\n';

  // 사업 운영 안정성
  explanation += `**🏢 사업 운영 안정성 (${c['사업 운영 안정성'] || '-'}점):** `;
  explanation += `업력 ${business?.business_age || 0}년, 세금 ${metrics?.tax_compliant ? '정상 납부' : '미납 이력 있음'}. `;
  explanation += `근로자 ${metrics?.employee_count || 0}명으로 `;
  if (Number(business?.business_age || 0) >= 5) explanation += '장기 운영 실적이 안정성을 뒷받침합니다.';
  else explanation += '상대적으로 신생 사업체입니다.';
  explanation += '\n\n';

  // 상권 회복력
  explanation += `**📍 상권 회복력 (${c['상권 회복력'] || '-'}점):** `;
  explanation += `유동인구 증감률 ${metrics?.foot_traffic_growth || 0}%, 상권 매출 증감률 ${metrics?.local_sales_growth || 0}%, `;
  explanation += `주변 폐업률 ${metrics?.closure_rate || 0}%.`;
  explanation += '\n\n';

  // 투자 한도
  explanation += `**적정 투자 한도:** ${(Number(assessment.funding_limit) / 10000).toFixed(0)}만원\n\n`;

  // 누락 항목
  const missing = assessment.missing_fields || [];
  if (missing.length) {
    explanation += `> ⚠️ 추가 확인 필요: ${missing.join(', ')}\n`;
  }

  return explanation;
}

export async function cloudRequest(path, options = {}) {
  if (!cloudConfigured) throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
  if (path.startsWith('/api/ai/') || path === '/api/health') return null;
  const body = options.body ? JSON.parse(options.body) : {};
  const method = options.method || 'GET';
  if (path === '/api/bootstrap' && method === 'GET') return bootstrap();
  if (path === '/api/auth/session' && method === 'POST') return authenticate(body);
  if (path === '/api/auth/session' && method === 'DELETE') return logout();
  if (path === '/api/auth/recover') return passwordRecovery(body);
  if (path === '/api/business') return saveBusiness(body);
  if (path === '/api/business/metrics') return saveMetrics(body);
  if (path === '/api/disclosures') return saveDisclosures(body);
  if (path === '/api/campaign') return saveCampaign(body);
  if (path === '/api/campaign/submit') {
    await rpc('submit_campaign', { p_campaign_id: body.campaignId });
    return { ok: true };
  }
  if (path === '/api/campaign/coupon-settings') return saveCampaignCouponSettings(body);
  if (path === '/api/campaign/close') return closeFund(body);
  if (path === '/api/commitments') return createCommitment(body);
  // 새로운 투자/회수 API
  if (path === '/api/invest') return investInCampaign(body);
  if (path === '/api/withdraw') return requestWithdrawal(body);
  if (path === '/api/coupon/issue') return issueCoupon(body);
  if (path === '/api/coupon/use') return useCoupon(body);
  if (path === '/api/coupon/trade') return createCouponTrade(body);
  if (path === '/api/coupon/trade/accept') return acceptCouponTrade(body);
  if (path === '/api/coupons' && method === 'GET') return getMyCoupons();
  if (path === '/api/investments' && method === 'GET') return getMyInvestments();
  if (path === '/api/owner/coupons' && method === 'GET') return getOwnerCouponDashboard();
  if (path === '/api/owner/dividend') return issueDividendCoupon(body);
  if (path === '/api/owner/monthly-sales') return saveMonthlySales(body);
  if (path === '/api/rankings' && method === 'GET') return getRankings();
  if (path === '/api/thematic-funds' && method === 'GET') return getThematicFunds();
  if (path === '/api/ai-contents' && method === 'GET') return getAiContents();
  if (path === '/api/policies' && method === 'GET') return getPolicies();
  if (path === '/api/assessment/explanation') return getAssessmentExplanation(body);
  if (path === '/api/evidence') {
    const evidence = await rpc('submit_milestone_evidence', {
      p_milestone_id: body.milestoneId,
      p_ocr_analysis_id: body.analysisId || null,
      p_filename: body.filename,
      p_claimed_amount: body.claimedAmount,
      p_plan_match: body.planMatch,
      p_result: body.result || {}
    });
    return { ok: true, evidence: evidenceDto(evidence) };
  }
  if (path === '/api/admin/campaign') {
    await rpc('review_campaign', {
      p_campaign_id: body.campaignId,
      p_decision: body.decision,
      p_note: body.note || ''
    });
    return { ok: true };
  }
  if (path === '/api/admin/evidence') {
    await rpc('review_evidence', {
      p_evidence_id: body.evidenceId,
      p_decision: body.decision,
      p_note: body.note || ''
    });
    return { ok: true };
  }
  if (path === '/api/admin/financial-verification') {
    await rpc('review_financial_verification', {
      p_run_id: body.verificationId,
      p_decision: body.decision,
      p_note: body.note || ''
    });
    return { ok: true };
  }
  if (path === '/api/admin/escrow') {
    await rpc('confirm_commitment_escrow', { p_commitment_id: body.commitmentId });
    return { ok: true };
  }
  if (path === '/api/admin/release') {
    await rpc('release_milestone', { p_milestone_id: body.milestoneId });
    return { ok: true };
  }
  throw new Error('지원하지 않는 데이터 요청입니다: ' + path);
}
