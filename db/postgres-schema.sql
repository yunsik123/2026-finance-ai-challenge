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
