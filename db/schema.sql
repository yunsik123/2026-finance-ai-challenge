-- ============================================================================
-- 먹투 운영 스키마 (PostgreSQL / Supabase)
--
-- 이 파일이 실제 저장 구조다. data/db.json 과 app_state.data JSONB 는
-- 단일 원장 한 덩어리였고, 여기서는 도메인별 테이블로 나눈다.
--
-- 설계 결정 두 가지를 먼저 밝힌다.
--
--  ① 기본키는 uuid 가 아니라 text 다.
--     기존 원장의 식별자가 'u-owner', 'r-sobok', 'f-sobok-1' 처럼 뜻이 있는
--     문자열이고, 감사기록·알림·쿠폰 코드가 전부 이 값을 참조한다.
--     uuid 로 갈아끼우면 기존 데이터를 옮길 때 모든 참조를 다시 매핑해야 하고
--     그 과정에서 원장이 깨질 위험이 실이익보다 크다. 새로 만드는 행은
--     gen_random_uuid()::text 를 기본값으로 쓰므로 충돌하지 않는다.
--
--  ② profiles.id 와 auth.users.id 를 분리한다.
--     Supabase Auth 의 사용자 id 는 uuid 이고 위 ① 때문에 그대로 쓸 수 없다.
--     profiles.auth_user_id 로 연결하고, RLS 는 이 열을 기준으로 판단한다.
--     시연용 시드 계정은 auth_user_id 가 비어 있고 서버(service_role)로만 다룬다.
--
-- 적용:  psql "$DATABASE_URL" -f db/schema.sql
--   또는 Supabase 대시보드 SQL Editor 에 붙여넣기
-- ============================================================================

create extension if not exists pgcrypto;

-- 전용 스키마.
-- 이 Supabase 프로젝트의 public 에는 이전 설계에서 만든 테이블(businesses, campaigns,
-- knowledge_nodes 등)이 남아 있고 profiles·coupons·favorites 처럼 이름이 겹치는 것도 있다.
-- 남의 데이터를 지우지 않고 새 원장을 깨끗하게 두려고 스키마를 분리했다.
create schema if not exists meoktu;
grant usage on schema meoktu to anon, authenticated, service_role;

-- 새 행의 기본키. 기존 데이터는 자기 id 를 그대로 유지한다.
create or replace function meoktu.new_id() returns text
  language sql volatile as $$ select gen_random_uuid()::text $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 회원
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.profiles (
  id            text primary key default meoktu.new_id(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  email         text not null unique,
  name          text not null,
  role          text not null check (role in ('investor', 'owner', 'admin')),
  -- 먹투머니 잔액. 음수로 내려가면 안 되는 값이라 DB 에서 막는다.
  cash          bigint not null default 0 check (cash >= 0),
  account_status text not null default 'active' check (account_status in ('active', 'suspended')),
  -- Supabase Auth 로 옮기기 전의 자체 로그인용 해시. Auth 전환이 끝나면 null 이 된다.
  password_hash text,
  created_at    timestamptz not null default now()
);
create index if not exists profiles_role_idx on meoktu.profiles(role);

-- 현재 요청자의 profiles.id. RLS 정책이 전부 이걸 쓴다.
-- service_role 로 접근하면 auth.uid() 가 null 이라 정책이 아니라 bypass 로 통과한다.
create or replace function meoktu.current_profile_id() returns text
  language sql stable security definer set search_path = meoktu, public as $$
  select id from meoktu.profiles where auth_user_id = auth.uid()
$$;

create or replace function meoktu.current_role_name() returns text
  language sql stable security definer set search_path = meoktu, public as $$
  select role from meoktu.profiles where auth_user_id = auth.uid()
$$;


create table if not exists meoktu.wallet_transactions (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  type       text not null check (type in ('demo_topup', 'invest', 'withdraw', 'trade_settle')),
  amount     bigint not null,
  memo       text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_user_idx on meoktu.wallet_transactions(user_id, created_at desc);


-- ────────────────────────────────────────────────────────────────────────────
-- 식당과 펀딩
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.restaurants (
  id            text primary key default meoktu.new_id(),
  owner_id      text references meoktu.profiles(id) on delete set null,
  name          text not null,
  emoji         text not null default '🍽️',
  category      text not null,
  region        text not null,
  neighborhood  text not null default '',
  tagline       text not null default '',
  description   text not null default '',
  signature     text not null default '',
  story         text not null default '',
  color         text not null default '#ff6948',
  tags          text[] not null default '{}',
  -- 영업 지표. 심사·위험평가·신용등급이 전부 이 값을 읽는다.
  avg_price     integer not null default 0 check (avg_price >= 0),
  max_menu_price integer not null default 0 check (max_menu_price >= 0),
  opened_years  numeric(5,2) not null default 0 check (opened_years >= 0),
  monthly_sales bigint not null default 0 check (monthly_sales >= 0),
  sales_growth  numeric(6,4) not null default 0,
  repeat_rate   numeric(6,4) not null default 0 check (repeat_rate between 0 and 1),
  foot_traffic_growth numeric(6,4) not null default 0,
  competition   text not null default '보통' check (competition in ('낮음', '보통', '높음')),
  closing_rate  numeric(6,4) not null default 0,
  rating        numeric(3,2) not null default 0 check (rating between 0 and 5),
  review_count  integer not null default 0 check (review_count >= 0),
  supporters    integer not null default 0 check (supporters >= 0),
  community_score integer not null default 0,
  stability_score integer not null default 0,
  -- 사장님이 매출 차트를 투자자에게 공개할지 여부.
  sales_disclosure boolean not null default false,
  verification_status text not null default 'draft'
    check (verification_status in ('draft', 'submitted', 'verified', 'rejected')),
  -- 서술형 부가정보는 조회만 하고 조건 검색을 하지 않아 jsonb 로 둔다.
  food_description text,
  dining_notes  text,
  strengths     text[] not null default '{}',
  menu_highlights jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists restaurants_owner_idx on meoktu.restaurants(owner_id);
create index if not exists restaurants_discover_idx on meoktu.restaurants(region, category);

-- 12개월 실매출 이력. 차트와 심사 근거로 같이 쓰이므로 행으로 저장한다.
create table if not exists meoktu.restaurant_sales (
  restaurant_id text not null references meoktu.restaurants(id) on delete cascade,
  month         text not null,
  sales         bigint not null check (sales >= 0),
  growth_rate   numeric(6,4) not null default 0,
  bonus_rate    numeric(6,4) not null default 0,
  primary key (restaurant_id, month)
);

create table if not exists meoktu.funds (
  id            text primary key default meoktu.new_id(),
  restaurant_id text not null references meoktu.restaurants(id) on delete cascade,
  round         integer not null default 1 check (round >= 1),
  status        text not null check (status in ('funding', 'trading', 'closed')),
  goal          bigint not null check (goal > 0 and goal % 1000 = 0),
  raised        bigint not null default 0 check (raised >= 0),
  max_discount  numeric(5,2) not null check (max_discount > 0 and max_discount <= 100),
  min_issue_discount numeric(5,2) not null default 10,
  daily_rate_per_100k numeric(8,5) not null default 0,
  sales_bonus   numeric(6,4) not null default 0,
  early_bonus   numeric(6,4) not null default 0,
  purpose       text not null default '',
  investor_count integer not null default 0 check (investor_count >= 0),
  total_coupon_issued bigint not null default 0,
  total_coupon_used bigint not null default 0,
  open_buy_amount bigint not null default 0,
  open_sell_amount bigint not null default 0,
  risk_level    text not null default '보통' check (risk_level in ('낮음', '보통', '주의')),
  started_at    timestamptz not null,
  ends_at       timestamptz not null,
  created_at    timestamptz not null default now(),
  -- 모집액이 목표를 넘을 수 없다. 동시 투자 경합에서 이걸 DB 가 최종적으로 막는다.
  constraint funds_raised_within_goal check (raised <= goal),
  constraint funds_period check (ends_at > started_at)
);
create index if not exists funds_restaurant_idx on meoktu.funds(restaurant_id, round desc);
create index if not exists funds_status_idx on meoktu.funds(status, ends_at);


-- ────────────────────────────────────────────────────────────────────────────
-- 투자와 예약 거래
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.positions (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  fund_id    text not null references meoktu.funds(id) on delete cascade,
  amount     bigint not null default 0 check (amount >= 0 and amount % 1000 = 0),
  -- 최초 투자자 영구 가속 혜택.
  early      boolean not null default false,
  coupon_progress numeric(7,4) not null default 0 check (coupon_progress >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, fund_id)
);
create index if not exists positions_fund_idx on meoktu.positions(fund_id);

create table if not exists meoktu.orders (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  fund_id    text not null references meoktu.funds(id) on delete cascade,
  type       text not null check (type in ('buy', 'sell')),
  original_amount bigint not null check (original_amount > 0 and original_amount % 1000 = 0),
  remaining  bigint not null check (remaining >= 0 and remaining % 1000 = 0),
  status     text not null check (status in ('open', 'partial', 'filled', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint orders_remaining_within_original check (remaining <= original_amount)
);
-- FIFO 매칭이 매번 쓰는 순서. 시간 우선이라 created_at 오름차순 인덱스가 필요하다.
create index if not exists orders_fifo_idx on meoktu.orders(fund_id, type, status, created_at);
create index if not exists orders_user_idx on meoktu.orders(user_id, created_at desc);


-- ────────────────────────────────────────────────────────────────────────────
-- 쿠폰과 사용자 간 교환
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.coupons (
  id            text primary key default meoktu.new_id(),
  user_id       text not null references meoktu.profiles(id) on delete cascade,
  restaurant_id text not null references meoktu.restaurants(id) on delete cascade,
  fund_id       text references meoktu.funds(id) on delete set null,
  title         text not null,
  discount      numeric(5,2) not null check (discount > 0 and discount <= 100),
  max_discount_won bigint not null default 0 check (max_discount_won >= 0),
  type          text not null check (type in ('fund', 'dividend', 'etf')),
  status        text not null default 'available'
    check (status in ('available', 'listed', 'offered', 'redeeming', 'used', 'expired')),
  acquired_from_user_id text references meoktu.profiles(id) on delete set null,
  acquired_at   timestamptz,
  redeem_code   text,
  redeem_requested_at timestamptz,
  used_at       timestamptz,
  used_at_restaurant_id text references meoktu.restaurants(id) on delete set null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists coupons_wallet_idx on meoktu.coupons(user_id, status, expires_at);
create index if not exists coupons_restaurant_idx on meoktu.coupons(restaurant_id, status);
-- 사용 코드는 사장님 화면에서 이걸로 조회하므로 살아있는 코드끼리 중복되면 안 된다.
create unique index if not exists coupons_redeem_code_idx
  on meoktu.coupons(redeem_code) where redeem_code is not null;

create table if not exists meoktu.coupon_listings (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  coupon_id  text not null references meoktu.coupons(id) on delete cascade,
  wanted_categories text[] not null default '{}',
  wanted_regions text[] not null default '{}',
  min_discount numeric(5,2) not null default 0 check (min_discount >= 0),
  auto_accept boolean not null default true,
  note       text not null default '',
  status     text not null default 'open' check (status in ('open', 'completed', 'cancelled', 'expired')),
  completed_with_user_id text references meoktu.profiles(id) on delete set null,
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- 한 쿠폰이 동시에 두 매물로 올라가는 이중 등록을 DB 가 막는다.
create unique index if not exists coupon_listings_one_open_idx
  on meoktu.coupon_listings(coupon_id) where status = 'open';
create index if not exists coupon_listings_browse_idx on meoktu.coupon_listings(status, created_at desc);

create table if not exists meoktu.coupon_offers (
  id         text primary key default meoktu.new_id(),
  listing_id text not null references meoktu.coupon_listings(id) on delete cascade,
  offer_user_id text not null references meoktu.profiles(id) on delete cascade,
  offer_coupon_id text not null references meoktu.coupons(id) on delete cascade,
  message    text not null default '',
  status     text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
-- 같은 매물에 같은 사람이 대기 제안을 두 번 걸 수 없다.
create unique index if not exists coupon_offers_one_pending_idx
  on meoktu.coupon_offers(listing_id, offer_user_id) where status = 'pending';
-- 에스크로: 한 쿠폰은 동시에 하나의 대기 제안에만 묶인다.
-- B 와 C 가 같은 쿠폰으로 동시에 제안하는 이중 지출을 DB 가 막는 지점이다.
create unique index if not exists coupon_offers_escrow_idx
  on meoktu.coupon_offers(offer_coupon_id) where status = 'pending';

create table if not exists meoktu.coupon_trades (
  id         text primary key default meoktu.new_id(),
  listing_id text not null references meoktu.coupon_listings(id) on delete cascade,
  offer_id   text references meoktu.coupon_offers(id) on delete set null,
  mode       text not null check (mode in ('instant', 'offer')),
  lister_user_id text not null references meoktu.profiles(id),
  lister_coupon_id text not null references meoktu.coupons(id),
  lister_gave_discount numeric(5,2) not null,
  lister_gave_value_won bigint not null default 0,
  taker_user_id text not null references meoktu.profiles(id),
  taker_coupon_id text not null references meoktu.coupons(id),
  taker_gave_discount numeric(5,2) not null,
  taker_gave_value_won bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint coupon_trades_two_parties check (lister_user_id <> taker_user_id)
);
create index if not exists coupon_trades_lister_idx on meoktu.coupon_trades(lister_user_id, created_at desc);
create index if not exists coupon_trades_taker_idx on meoktu.coupon_trades(taker_user_id, created_at desc);


-- ────────────────────────────────────────────────────────────────────────────
-- 심사 · 증빙 · 검증
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.applications (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  restaurant_id text references meoktu.restaurants(id) on delete set null,
  restaurant_name text not null,
  status     text not null check (status in ('approved', 'conditional', 'manual_review', 'rejected')),
  requested_limit bigint not null check (requested_limit >= 0),
  approved_limit bigint not null default 0 check (approved_limit >= 0),
  score      numeric(6,2) not null default 0,
  strengths  text[] not null default '{}',
  checks     text[] not null default '{}',
  improvements text[] not null default '{}',
  explanation text not null default '',
  -- 파생지표·교차검증·신용등급 원본. 구조가 심사 엔진 버전마다 달라져서 jsonb 로 둔다.
  data       jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);
create index if not exists applications_user_idx on meoktu.applications(user_id, submitted_at desc);

create table if not exists meoktu.ocr_analyses (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  application_id text references meoktu.applications(id) on delete set null,
  filename   text not null,
  source_id  text not null,
  plan       text not null default '',
  result     jsonb not null default '{}'::jsonb,
  model      text not null,
  status     text not null check (status in ('ai_extracted', 'manual_review', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists ocr_user_idx on meoktu.ocr_analyses(user_id, created_at desc);

create table if not exists meoktu.data_connections (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  source_id  text not null check (source_id in ('pos', 'account', 'card', 'delivery', 'tax', 'debt')),
  provider   text not null,
  status     text not null default 'active' check (status in ('active', 'revoked')),
  consent_scope text not null,
  record_count bigint not null default 0 check (record_count >= 0),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  unique (user_id, source_id)
);


-- ────────────────────────────────────────────────────────────────────────────
-- 리뷰 · 관심 · 문의 · 알림 · 감사
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.visit_verifications (
  id         text primary key default meoktu.new_id(),
  restaurant_id text not null references meoktu.restaurants(id) on delete cascade,
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  verified_at timestamptz not null default now(),
  used_for_review boolean not null default false
);
create index if not exists visits_user_idx on meoktu.visit_verifications(user_id, restaurant_id, used_for_review);

create table if not exists meoktu.reviews (
  id         text primary key default meoktu.new_id(),
  restaurant_id text not null references meoktu.restaurants(id) on delete cascade,
  -- 작성자 참조는 비어 있을 수 있다. 시연용 가상 리뷰어처럼 계정이 없는 작성자가 있고,
  -- 계정이 사라져도 리뷰 본문은 식당의 평판 근거로 남아야 하기 때문이다.
  -- 표시 이름은 user_name 에 따로 보관한다.
  user_id    text references meoktu.profiles(id) on delete set null,
  user_name  text not null,
  rating     integer not null check (rating between 1 and 5),
  content    text not null check (char_length(content) >= 10),
  visit_verified boolean not null default false,
  status     text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now()
);
create index if not exists reviews_restaurant_idx on meoktu.reviews(restaurant_id, created_at desc);

create table if not exists meoktu.favorites (
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  restaurant_id text not null references meoktu.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

create table if not exists meoktu.support_requests (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  user_name  text not null,
  type       text not null check (type in ('investment', 'coupon', 'exchange', 'review', 'owner', 'account', 'other')),
  subject    text not null,
  description text not null,
  restaurant_id text references meoktu.restaurants(id) on delete set null,
  priority   text not null default 'normal' check (priority in ('normal', 'high')),
  status     text not null default 'received' check (status in ('received', 'in_review', 'answered', 'closed')),
  answer     text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists support_queue_idx on meoktu.support_requests(status, priority, created_at);

create table if not exists meoktu.notifications (
  id         text primary key default meoktu.new_id(),
  user_id    text not null references meoktu.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null,
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_inbox_idx on meoktu.notifications(user_id, read, created_at desc);

-- 감사기록은 분쟁이 생겼을 때 무슨 일이 있었는지 말해줄 유일한 근거라 지우지 않는다.
create table if not exists meoktu.audit_events (
  id         text primary key default meoktu.new_id(),
  actor_id   text references meoktu.profiles(id) on delete set null,
  action     text not null,
  resource_type text not null,
  resource_id text not null,
  summary    text not null,
  created_at timestamptz not null default now()
);
create index if not exists audit_resource_idx on meoktu.audit_events(resource_type, resource_id, created_at desc);
create index if not exists audit_actor_idx on meoktu.audit_events(actor_id, created_at desc);


-- ────────────────────────────────────────────────────────────────────────────
-- 콘텐츠 (읽기 전용 공개 데이터)
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.articles (
  id         text primary key default meoktu.new_id(),
  eyebrow    text not null default '',
  title      text not null,
  summary    text not null default '',
  content    text not null default '',
  tags       text[] not null default '{}',
  icon       text not null default '',
  source_name text,
  source_url text,
  data_note  text,
  published_at timestamptz not null default now()
);

create table if not exists meoktu.etf_funds (
  id         text primary key default meoktu.new_id(),
  name       text not null,
  emoji      text not null default '',
  region     text not null default '',
  category   text not null default '',
  minimum    bigint not null default 0 check (minimum >= 0),
  max_discount numeric(5,2) not null default 0,
  growth     numeric(6,4) not null default 0,
  members    integer not null default 0 check (members >= 0),
  description text not null default ''
);

create table if not exists meoktu.etf_members (
  etf_id     text not null references meoktu.etf_funds(id) on delete cascade,
  restaurant_id text not null references meoktu.restaurants(id) on delete cascade,
  primary key (etf_id, restaurant_id)
);


-- ────────────────────────────────────────────────────────────────────────────
-- 저장소 메타. 서버 인스턴스가 여러 개일 때 캐시 무효화에 쓴다.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists meoktu.ledger_meta (
  id         text primary key,
  version    bigint not null default 0,
  lock_owner text,
  locked_at  timestamptz,
  updated_at timestamptz not null default now()
);
insert into meoktu.ledger_meta(id, version) values ('meoktu', 0) on conflict (id) do nothing;
