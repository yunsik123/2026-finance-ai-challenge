-- ⚠️ 이 파일은 대체되었습니다. 적용하지 마세요.
--
-- 운영 스키마는 db/schema.sql · db/policies.sql · db/functions.sql · db/import.sql 이고
-- `npm run db:apply` 로 meoktu 스키마에 적용합니다.
--
-- 이 초안을 그대로 실행하면 public 에 profiles·coupons·favorites 같은 이름의 테이블을
-- 새 스키마와 다른 구조로 만들어 버립니다. 설계 이력으로만 남겨 둡니다.

-- 먹투 운영 DB 전환 초안 (PostgreSQL/Supabase)
-- 현재 로컬 MVP는 data/db.json을 사용한다. 이 파일은 운영 전환 시 적용할 원장 구조이며
-- service_role 키는 반드시 서버에서만 사용한다.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('investor', 'owner', 'admin')),
  display_name text not null,
  cash_balance bigint not null default 0 check (cash_balance >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id),
  name text not null,
  category text not null,
  region text not null,
  description text not null default '',
  sales_disclosure boolean not null default false,
  metrics jsonb not null default '{}'::jsonb,
  verification_status text not null default 'draft'
    check (verification_status in ('draft', 'submitted', 'verified', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.funds (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  status text not null check (status in ('funding', 'trading', 'closed')),
  goal bigint not null check (goal > 0 and goal % 1000 = 0),
  raised bigint not null default 0 check (raised >= 0 and raised <= goal),
  max_discount numeric(5,2) not null,
  purpose text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  fund_id uuid not null references public.funds(id),
  amount bigint not null default 0 check (amount >= 0 and amount % 1000 = 0),
  coupon_progress numeric(6,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique(user_id, fund_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  fund_id uuid not null references public.funds(id),
  side text not null check (side in ('buy', 'sell')),
  original_amount bigint not null check (original_amount > 0 and original_amount % 1000 = 0),
  remaining bigint not null check (remaining >= 0 and remaining % 1000 = 0),
  status text not null check (status in ('open', 'partial', 'filled', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists orders_fifo_idx on public.orders(fund_id, side, status, created_at);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, restaurant_id)
);

create table if not exists public.ocr_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  restaurant_id uuid references public.restaurants(id),
  filename text not null,
  source_id text not null,
  plan text not null default '',
  result jsonb not null,
  model text not null,
  status text not null check (status in ('ai_extracted', 'manual_review', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  summary text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_resource_idx on public.audit_events(resource_type, resource_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.funds enable row level security;
alter table public.positions enable row level security;
alter table public.orders enable row level security;
alter table public.favorites enable row level security;
alter table public.ocr_analyses enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles read self" on public.profiles for select using (id = auth.uid());
create policy "restaurants public verified" on public.restaurants for select using (verification_status = 'verified' or owner_id = auth.uid());
create policy "owners manage draft restaurant" on public.restaurants for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "funds public for visible restaurants" on public.funds for select using (
  exists(select 1 from public.restaurants r where r.id = restaurant_id and (r.verification_status = 'verified' or r.owner_id = auth.uid()))
);
create policy "positions read self" on public.positions for select using (user_id = auth.uid());
create policy "orders read self" on public.orders for select using (user_id = auth.uid());
create policy "favorites manage self" on public.favorites for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ocr owner read self" on public.ocr_analyses for select using (user_id = auth.uid());
create policy "audit actor read self" on public.audit_events for select using (actor_id = auth.uid());

-- 투자·회수·FIFO 매칭, 쿠폰 발행, 운영자 승인과 감사 기록은 브라우저의 직접 INSERT가
-- 아니라 SECURITY DEFINER RPC 안에서 검증·잠금·원장 기록을 하나의 트랜잭션으로 처리해야 한다.

-- ─────────────────────────────────────────────────────────────
-- 쿠폰 교환장. 원장 성격이라 상태 전이는 전부 RPC 안에서만 일어나야 한다.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  restaurant_id uuid not null references public.restaurants(id),
  fund_id uuid references public.funds(id),
  title text not null,
  discount numeric(5,2) not null check (discount > 0 and discount <= 100),
  max_discount_won bigint not null check (max_discount_won >= 0),
  type text not null check (type in ('fund', 'dividend', 'etf')),
  status text not null default 'available'
    check (status in ('available', 'listed', 'offered', 'redeeming', 'used', 'expired')),
  acquired_from_user_id uuid references public.profiles(id),
  acquired_at timestamptz,
  redeem_code text unique,
  redeem_requested_at timestamptz,
  used_at timestamptz,
  used_at_restaurant_id uuid references public.restaurants(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists coupons_wallet_idx on public.coupons(user_id, status, expires_at);

create table if not exists public.coupon_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  coupon_id uuid not null references public.coupons(id),
  wanted_categories text[] not null default '{}',
  wanted_regions text[] not null default '{}',
  min_discount numeric(5,2) not null default 0,
  auto_accept boolean not null default true,
  note text not null default '',
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled', 'expired')),
  completed_with_user_id uuid references public.profiles(id),
  completed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- 한 쿠폰은 동시에 하나의 열린 매물에만 걸릴 수 있다.
create unique index if not exists coupon_listings_one_open_idx
  on public.coupon_listings(coupon_id) where status = 'open';

create table if not exists public.coupon_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.coupon_listings(id),
  offer_user_id uuid not null references public.profiles(id),
  offer_coupon_id uuid not null references public.coupons(id),
  message text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
-- 같은 매물에 같은 사람이 대기 제안을 두 번 걸 수 없다.
create unique index if not exists coupon_offers_one_pending_idx
  on public.coupon_offers(listing_id, offer_user_id) where status = 'pending';
-- 한 쿠폰은 동시에 하나의 대기 제안에만 걸릴 수 있다(에스크로).
create unique index if not exists coupon_offers_escrow_idx
  on public.coupon_offers(offer_coupon_id) where status = 'pending';

create table if not exists public.coupon_trades (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.coupon_listings(id),
  offer_id uuid references public.coupon_offers(id),
  mode text not null check (mode in ('instant', 'offer')),
  lister_user_id uuid not null references public.profiles(id),
  lister_coupon_id uuid not null references public.coupons(id),
  taker_user_id uuid not null references public.profiles(id),
  taker_coupon_id uuid not null references public.coupons(id),
  created_at timestamptz not null default now(),
  check (lister_user_id <> taker_user_id)
);
create index if not exists coupon_trades_user_idx on public.coupon_trades(lister_user_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_inbox_idx on public.notifications(user_id, read, created_at desc);

alter table public.coupons enable row level security;
alter table public.coupon_listings enable row level security;
alter table public.coupon_offers enable row level security;
alter table public.coupon_trades enable row level security;
alter table public.notifications enable row level security;

create policy "coupons read own" on public.coupons for select using (user_id = auth.uid());
create policy "listings read open" on public.coupon_listings for select using (status = 'open' or user_id = auth.uid());
create policy "offers read participants" on public.coupon_offers for select using (
  offer_user_id = auth.uid()
  or exists(select 1 from public.coupon_listings l where l.id = listing_id and l.user_id = auth.uid())
);
create policy "trades read participants" on public.coupon_trades for select using (lister_user_id = auth.uid() or taker_user_id = auth.uid());
create policy "notifications read own" on public.notifications for select using (user_id = auth.uid());
create policy "notifications update own" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 소상공인이 직접 올린 파일과 혼동하지 않도록, 제휴기관·마이데이터형 연결을 별도로 기록한다.
create table if not exists public.data_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_id text not null check (source_id in ('pos', 'account', 'card', 'delivery', 'tax', 'debt')),
  provider text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  consent_scope text not null,
  record_count bigint not null default 0 check (record_count >= 0),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  unique(user_id, source_id)
);
alter table public.data_connections enable row level security;
create policy "data connections read own" on public.data_connections for select using (user_id = auth.uid());
-- 연결 상태 변경은 기관 OAuth/전자서명 콜백을 검증하는 서버 어댑터만 수행한다.

-- 교환 체결은 반드시 아래 형태의 SECURITY DEFINER RPC 안에서 한 트랜잭션으로 처리한다.
--   1) select ... for update 로 두 쿠폰과 매물 행을 잠근다
--   2) 할인율·액면가·만료·등록자 조건을 다시 검사한다
--   3) 두 쿠폰의 user_id 를 교환하고 매물을 completed 로 바꾼다
--   4) 같은 매물의 나머지 pending 제안을 declined 로 바꾸고 에스크로를 푼다
--   5) coupon_trades, audit_events, notifications 를 같은 트랜잭션에서 기록한다
-- 브라우저의 직접 INSERT/UPDATE 로는 어떤 상태 전이도 허용하지 않는다.
