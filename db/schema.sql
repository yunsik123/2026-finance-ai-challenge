-- MOA Supabase production schema
-- Supabase SQL Editor에서 한 번 실행한다. service_role 키는 프론트엔드에 넣지 않는다.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null check (role in ('consumer', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(coalesce(new.email, '사용자'), '@', 1)),
    case when new.raw_user_meta_data->>'role' = 'owner' then 'owner' else 'consumer' end
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('login_success', 'logout')),
  ip_hint text not null default '',
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.stores (
  id text primary key,
  payload jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete cascade,
  name text not null,
  category text not null,
  business_number text not null default '',
  address text not null,
  monthly_sales bigint not null default 0 check (monthly_sales >= 0),
  business_age numeric not null default 0 check (business_age >= 0),
  description text not null default '',
  verification_status text not null default 'unverified',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_metrics (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  segment text not null default '숙박·음식점업',
  cb_grade smallint not null default 5 check (cb_grade between 1 and 10),
  sales_6m bigint[] not null default '{}',
  operating_cash_flow bigint not null default 0,
  debt_total bigint not null default 0,
  monthly_debt_payment bigint not null default 0,
  overdue_count integer not null default 0,
  employee_count integer not null default 0,
  tax_compliant boolean not null default true,
  admin_penalties integer not null default 0,
  owner_changes integer not null default 0,
  foot_traffic_growth numeric not null default 0,
  local_sales_growth numeric not null default 0,
  competitor_density numeric not null default 0,
  closure_rate numeric not null default 0,
  repeat_rate numeric not null default 0,
  rating numeric not null default 0,
  digital_sales_ratio numeric not null default 0,
  qualitative_bonus numeric not null default 0,
  source_dates jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_assessments (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  score numeric not null check (score between 0 and 100),
  s_grade text not null check (s_grade ~ '^S([1-9]|10)$'),
  funding_limit bigint not null default 0,
  components jsonb not null,
  missing_fields text[] not null default '{}',
  model_version text not null default 'moa-scb-demo-v1',
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists credit_assessments_business_idx
on public.credit_assessments(business_id, created_at desc);

create table if not exists public.knowledge_nodes (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  node_type text not null,
  label text not null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.knowledge_edges (
  id text primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  source_node_id text not null references public.knowledge_nodes(id) on delete cascade,
  target_node_id text not null references public.knowledge_nodes(id) on delete cascade,
  relation_type text not null,
  evidence text not null default '',
  weight numeric not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_edges_source_idx on public.knowledge_edges(source_node_id);
create index if not exists knowledge_edges_target_idx on public.knowledge_edges(target_node_id);

create or replace function public.graph_neighborhood(root_node text, max_depth integer default 2)
returns table(node_id text, depth integer, path text[]) language sql stable security invoker as $$
  with recursive walk(node_id, depth, path) as (
    select root_node, 0, array[root_node]
    union all
    select case when e.source_node_id = w.node_id then e.target_node_id else e.source_node_id end,
           w.depth + 1,
           w.path || case when e.source_node_id = w.node_id then e.target_node_id else e.source_node_id end
    from walk w
    join public.knowledge_edges e on e.source_node_id = w.node_id or e.target_node_id = w.node_id
    where w.depth < least(greatest(max_depth, 0), 4)
      and not (case when e.source_node_id = w.node_id then e.target_node_id else e.source_node_id end = any(w.path))
  )
  select * from walk;
$$;

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, store_id)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  target_amount bigint not null check (target_amount >= 100000),
  duration_days integer not null check (duration_days between 1 and 365),
  plan text not null,
  risk text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id text not null references public.stores(id) on delete cascade,
  amount bigint not null check (amount >= 1000),
  risk_consent boolean not null check (risk_consent),
  status text not null default 'demo_recorded',
  created_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id text references public.stores(id) on delete set null,
  source_type text not null,
  source_id text not null,
  store_name text not null,
  title text not null,
  benefit text not null,
  condition_text text not null default '',
  code text not null unique,
  expires_at date not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, source_type, source_id)
);

create table if not exists public.issued_coupon_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  name text not null,
  benefit text not null,
  quantity integer not null check (quantity between 1 and 1000),
  condition_text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  region text not null default '서울 성동구',
  disclosures text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.ocr_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  filename text not null default '',
  storage_path text,
  plan text not null,
  result jsonb not null,
  model text not null,
  sha256 text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.login_events enable row level security;
alter table public.stores enable row level security;
alter table public.businesses enable row level security;
alter table public.business_metrics enable row level security;
alter table public.credit_assessments enable row level security;
alter table public.knowledge_nodes enable row level security;
alter table public.knowledge_edges enable row level security;
alter table public.favorites enable row level security;
alter table public.campaigns enable row level security;
alter table public.contributions enable row level security;
alter table public.coupons enable row level security;
alter table public.issued_coupon_templates enable row level security;
alter table public.user_settings enable row level security;
alter table public.ocr_analyses enable row level security;

create policy "profiles own select" on public.profiles for select using (id = auth.uid());
create policy "profiles own update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "login own select" on public.login_events for select using (user_id = auth.uid());
create policy "login own insert" on public.login_events for insert with check (user_id = auth.uid());
create policy "stores public read" on public.stores for select using (is_active);
create policy "business public or own read" on public.businesses for select using (verification_status in ('demo_verified','verified') or user_id = auth.uid());
create policy "business owner insert" on public.businesses for insert with check (user_id = auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='owner'));
create policy "business owner update" on public.businesses for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "metrics public or own read" on public.business_metrics for select using (exists(select 1 from public.businesses b where b.id=business_id and (b.verification_status in ('demo_verified','verified') or b.user_id=auth.uid())));
create policy "metrics owner write" on public.business_metrics for all using (exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid())) with check (exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid()));
create policy "assessment public or own read" on public.credit_assessments for select using (exists(select 1 from public.businesses b where b.id=business_id and (b.verification_status in ('demo_verified','verified') or b.user_id=auth.uid())));
create policy "assessment owner insert" on public.credit_assessments for insert with check (exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid()));
create policy "graph nodes public or own" on public.knowledge_nodes for select using (exists(select 1 from public.businesses b where b.id=business_id and (b.verification_status in ('demo_verified','verified') or b.user_id=auth.uid())));
create policy "graph edges public or own" on public.knowledge_edges for select using (exists(select 1 from public.businesses b where b.id=business_id and (b.verification_status in ('demo_verified','verified') or b.user_id=auth.uid())));
create policy "graph nodes owner write" on public.knowledge_nodes for all using (exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid())) with check (exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid()));
create policy "graph edges owner write" on public.knowledge_edges for all using (exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid())) with check (exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid()));
create policy "favorites own" on public.favorites for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "campaign own read" on public.campaigns for select using (user_id=auth.uid() or status='published');
create policy "campaign owner write" on public.campaigns for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "contribution own" on public.contributions for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "coupon own" on public.coupons for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "coupon template own" on public.issued_coupon_templates for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "settings own" on public.user_settings for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "ocr own" on public.ocr_analyses for all using (user_id=auth.uid()) with check (user_id=auth.uid());

grant usage on schema public to anon, authenticated;
grant select on public.stores, public.businesses, public.business_metrics, public.credit_assessments, public.knowledge_nodes, public.knowledge_edges to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.login_events, public.favorites, public.campaigns, public.contributions, public.coupons, public.issued_coupon_templates, public.user_settings, public.ocr_analyses to authenticated;
grant insert, update on public.businesses, public.business_metrics to authenticated;
grant insert on public.credit_assessments to authenticated;
grant insert, update, delete on public.knowledge_nodes, public.knowledge_edges to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.graph_neighborhood(text, integer) to anon, authenticated;
