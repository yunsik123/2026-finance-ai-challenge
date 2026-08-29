PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('consumer', 'owner')),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    email TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failure', 'logout')),
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_email ON login_events(email, created_at DESC);

CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, store_id)
);

CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    business_number TEXT NOT NULL,
    address TEXT NOT NULL,
    monthly_sales INTEGER NOT NULL DEFAULT 0 CHECK (monthly_sales >= 0),
    business_age REAL NOT NULL DEFAULT 0 CHECK (business_age >= 0),
    description TEXT NOT NULL DEFAULT '',
    verification_status TEXT NOT NULL DEFAULT 'demo_unverified',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_amount INTEGER NOT NULL CHECK (target_amount >= 100000),
    duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
    plan TEXT NOT NULL,
    risk TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount >= 1000),
    risk_consent INTEGER NOT NULL CHECK (risk_consent = 1),
    status TEXT NOT NULL DEFAULT 'demo_recorded',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contributions_user_store ON contributions(user_id, store_id);

CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    store_name TEXT NOT NULL,
    title TEXT NOT NULL,
    benefit TEXT NOT NULL,
    condition_text TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_coupons_user ON coupons(user_id, used_at, created_at DESC);

CREATE TABLE IF NOT EXISTS issued_coupon_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    benefit TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
    condition_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS disclosures (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    values_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    region TEXT NOT NULL DEFAULT '서울 성동구',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ocr_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
    filename TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL,
    result_json TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ocr_user ON ocr_analyses(user_id, created_at DESC);

-- 금융위원회 SCB 방향을 반영한 데모용 대안정보 프로필이다. 공식 신용등급이 아니다.
CREATE TABLE IF NOT EXISTS business_metrics (
    business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    segment TEXT NOT NULL DEFAULT '숙박·음식점업',
    cb_grade INTEGER NOT NULL DEFAULT 5 CHECK (cb_grade BETWEEN 1 AND 10),
    sales_6m_json TEXT NOT NULL DEFAULT '[]',
    operating_cash_flow INTEGER NOT NULL DEFAULT 0,
    debt_total INTEGER NOT NULL DEFAULT 0,
    monthly_debt_payment INTEGER NOT NULL DEFAULT 0,
    overdue_count INTEGER NOT NULL DEFAULT 0,
    employee_count INTEGER NOT NULL DEFAULT 0,
    tax_compliant INTEGER NOT NULL DEFAULT 1,
    admin_penalties INTEGER NOT NULL DEFAULT 0,
    owner_changes INTEGER NOT NULL DEFAULT 0,
    foot_traffic_growth REAL NOT NULL DEFAULT 0,
    local_sales_growth REAL NOT NULL DEFAULT 0,
    competitor_density REAL NOT NULL DEFAULT 0,
    closure_rate REAL NOT NULL DEFAULT 0,
    repeat_rate REAL NOT NULL DEFAULT 0,
    rating REAL NOT NULL DEFAULT 0,
    digital_sales_ratio REAL NOT NULL DEFAULT 0,
    qualitative_bonus REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
    s_grade TEXT NOT NULL,
    funding_limit INTEGER NOT NULL DEFAULT 0,
    components_json TEXT NOT NULL,
    missing_json TEXT NOT NULL,
    model_version TEXT NOT NULL DEFAULT 'moa-scb-demo-v1',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_credit_business ON credit_assessments(business_id, created_at DESC);

-- PostgreSQL/Supabase로 그대로 이식 가능한 property-graph 저장 형태.
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY,
    business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL,
    label TEXT NOT NULL,
    properties_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_business ON knowledge_nodes(business_id, node_type);

CREATE TABLE IF NOT EXISTS knowledge_edges (
    id TEXT PRIMARY KEY,
    business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    weight REAL NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_business ON knowledge_edges(business_id, relation_type);
