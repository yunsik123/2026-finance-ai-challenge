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
    name: session?.custom_name || row.display_name || '사용자',
    email: row.email,
    role: row.role
  } : null;
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
    riskLevel: row.risk_level,
    fundingLimit: Number(row.funding_limit),
    components: row.components || {},
    missing: row.missing_fields || [],
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
  return {
    business,
    campaigns: campaignRows.map(row => campaignDto(row, relations)),
    disclosures: settings?.disclosures || [],
    region: settings?.region || '서울 전체',
    metrics,
    assessment: business
      ? assessmentDto(first(await rest(
        'credit_assessments?select=*&business_id=eq.' + business.id
          + '&order=created_at.desc&limit=1'
      )))
      : null
  };
}

async function adminData() {
  const [campaignRows, commitmentRows, evidenceRows, auditRows] = await Promise.all([
    rest('campaigns?select=*&order=updated_at.desc'),
    rest('funding_commitments?select=*&order=created_at.desc'),
    rest('evidence_submissions?select=*&order=created_at.desc'),
    rest('audit_events?select=*&order=created_at.desc&limit=80')
  ]);
  const relations = await campaignRelations(campaignRows, { includePrivate: true });
  return {
    campaigns: campaignRows.map(row => campaignDto(row, relations)),
    commitments: commitmentRows.map(commitmentDto),
    evidence: evidenceRows.map(evidenceDto),
    audit: auditRows
  };
}

async function bootstrap() {
  const campaigns = await publicCampaigns();
  const session = await activeSession();
  const empty = {
    ok: true,
    user: null,
    campaigns,
    commitments: [],
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
    return { ...empty, user, loginHistory: history, owner: await ownerData(user.id) };
  }
  if (user.role === 'admin') {
    const admin = await adminData();
    return { ...empty, user, loginHistory: history, admin };
  }
  const commitmentRows = await rest(
    'funding_commitments?select=*&investor_id=eq.' + user.id + '&order=created_at.desc'
  );
  return {
    ...empty,
    user,
    loginHistory: history,
    commitments: commitmentRows.map(commitmentDto)
  };
}

async function authenticate(values) {
  let result;
  if (values.quick) {
    const role = values.role || 'investor';
    const name = (values.name || '').trim() || (role === 'admin' ? '운영자' : role === 'owner' ? '사장님' : '투자자');
    let email = 'investor@moa.local';
    let password = 'MoaPass2026!';

    if (role === 'admin') {
      email = runtimeEnv.MOA_ADMIN_EMAIL || 'admin@moa.local';
      password = runtimeEnv.MOA_ADMIN_PASSWORD || 'Moa!_i7sanyKlFgw93a-';
    } else if (role === 'owner') {
      email = 'owner@moa.local';
      password = 'MoaPass2026!';
    } else {
      email = 'investor@moa.local';
      password = 'MoaPass2026!';
    }

    result = await auth('token?grant_type=password', { email, password });
    const session = result?.access_token ? result : result?.session;
    if (!session?.access_token) {
      throw new Error('간편 로그인을 완료하지 못했습니다. 다시 시도해 주세요.');
    }
    session.custom_name = name;
    session.user = result.user || session.user;
    saveSession(session);

    await rest('profiles?id=eq.' + session.user.id, {
      method: 'PATCH',
      body: { display_name: name }
    }).catch(() => {});

    await rest('login_events', {
      method: 'POST',
      body: { user_id: session.user.id, event_type: 'login_success', user_agent: navigator.userAgent },
      prefer: 'return=minimal'
    }).catch(() => {});

    return bootstrap();
  }

  if (values.action === 'signup') {
    if (!['investor', 'owner'].includes(values.role)) {
      throw new Error('운영자 계정은 공개 회원가입으로 만들 수 없습니다.');
    }
    result = await auth('signup', {
      email: values.email,
      password: values.password,
      data: { name: values.name, role: values.role }
    });
  } else {
    result = await auth('token?grant_type=password', {
      email: values.email,
      password: values.password
    });
  }
  const session = result?.access_token ? result : result?.session;
  if (!session?.access_token) {
    throw new Error('이메일 확인을 마친 뒤 로그인해 주세요.');
  }
  session.user = result.user || session.user;
  saveSession(session);
  const profile = first(await rest('profiles?select=*&id=eq.' + session.user.id + '&limit=1'));
  if (!profile) {
    saveSession(null);
    throw new Error('계정 정보를 불러오지 못했습니다.');
  }
  if (values.role && profile.role !== values.role) {
    saveSession(null);
    const labels = { investor: '투자자', owner: '소상공인', admin: '운영자' };
    throw new Error('이 계정은 ' + labels[profile.role] + ' 계정입니다.');
  }
  await rest('login_events', {
    method: 'POST',
    body: { user_id: profile.id, event_type: 'login_success', user_agent: navigator.userAgent },
    prefer: 'return=minimal'
  });
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
      description: body.description
    },
    prefer: 'resolution=merge-duplicates,return=representation'
  }));
  return { ok: true, business: businessDto(row) };
}

function assessMetrics(body, business) {
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
  const sales = body.sales6m.map(Number);
  const growth = sales[0] > 0 ? (sales[5] / sales[0] - 1) * 100 : 0;
  const cashCoverage = Number(body.operatingCashFlow) / Math.max(Number(body.monthlyDebtPayment), 1);
  const debtRatio = Number(body.debtTotal) / Math.max(Number(business.sales) * 12, 1);
  const components = {
    '매출 지속성': Number(clamp(55 + growth * 1.4, 0, 100).toFixed(1)),
    '현금흐름 여력': Number(clamp(35 + cashCoverage * 18, 0, 100).toFixed(1)),
    '부채 부담': Number(clamp(90 - debtRatio * 35 - Number(body.overdueCount) * 20, 0, 100).toFixed(1)),
    '사업 운영 안정성': Number(clamp(45 + business.age * 5 + (body.taxCompliant ? 12 : -25), 0, 100).toFixed(1)),
    '상권 회복력': Number(clamp(55 + Number(body.footTrafficGrowth) * 1.5 + Number(body.localSalesGrowth) - Number(body.closureRate), 0, 100).toFixed(1))
  };
  const score = Number(
    (components['매출 지속성'] * .25 + components['현금흐름 여력'] * .25
      + components['부채 부담'] * .2 + components['사업 운영 안정성'] * .15
      + components['상권 회복력'] * .15).toFixed(1)
  );
  const missing = [];
  if (!business.number) missing.push('사업자등록 확인');
  if (!body.sales6m.some(Number)) missing.push('최근 매출');
  if (body.employeeCount === 0) missing.push('고용 현황 확인');
  return {
    score,
    riskLevel: score >= 75 ? 'low' : score >= 55 ? 'review' : 'high',
    fundingLimit: Math.floor(Math.max(0, business.sales * (score / 100)) / 100000) * 100000,
    components,
    missing,
    grade: score >= 80 ? 'S2' : score >= 70 ? 'S3' : score >= 60 ? 'S4' : score >= 50 ? 'S5' : 'S7'
  };
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
      missing_fields: assessment.missing,
      model_version: 'moa-risk-v2',
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
  if (path === '/api/commitments') return createCommitment(body);
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
