-- MOA production schema
-- Supabase Auth + PostgreSQL/RLS가 인증과 모든 서비스 데이터를 담당한다.

begin;
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'investor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'investor' where role = 'consumer';
alter table public.profiles add constraint profiles_role_check
  check (role in ('investor', 'owner', 'admin'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(coalesce(new.email, '사용자'), '@', 1)),
    case when new.raw_user_meta_data->>'role' = 'owner' then 'owner' else 'investor' end
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();
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
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.profiles(id) on delete cascade,
  name text not null,
  category text not null,
  business_number text not null,
  address text not null,
  monthly_sales bigint not null default 0 check (monthly_sales >= 0),
  business_age numeric not null default 0 check (business_age >= 0),
  description text not null default '',
  owner_story text not null default '',
  highlights jsonb not null default '[]'::jsonb,
  menu_items jsonb not null default '[]'::jsonb,
  verification_status text not null default 'unverified',
  verification_note text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.businesses add column if not exists verification_note text not null default '';
alter table public.businesses add column if not exists owner_story text not null default '';
alter table public.businesses add column if not exists highlights jsonb not null default '[]'::jsonb;
alter table public.businesses add column if not exists menu_items jsonb not null default '[]'::jsonb;
-- 운영 계정이 없는 공개 가상 예시는 user_id를 비워 둘 수 있다. 일반 사용자의 쓰기 정책은 auth.uid() 일치를 계속 강제한다.
alter table public.businesses alter column user_id drop not null;

create table if not exists public.business_metrics (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  sales_6m bigint[] not null default '{}',
  operating_cash_flow bigint not null default 0,
  debt_total bigint not null default 0,
  monthly_debt_payment bigint not null default 0,
  overdue_count integer not null default 0,
  employee_count integer not null default 0,
  tax_compliant boolean not null default true,
  foot_traffic_growth numeric not null default 0,
  local_sales_growth numeric not null default 0,
  competitor_density numeric not null default 0,
  closure_rate numeric not null default 0,
  repeat_rate numeric not null default 0,
  digital_sales_ratio numeric not null default 0,
  source_dates jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.business_metrics add column if not exists source_dates jsonb not null default '{}';

create table if not exists public.credit_assessments (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  score numeric not null check (score between 0 and 100),
  s_grade text not null default 'S5',
  risk_level text not null default 'review' check (risk_level in ('low', 'review', 'high')),
  funding_limit bigint not null default 0,
  components jsonb not null default '{}',
  missing_fields text[] not null default '{}',
  model_version text not null default 'moa-risk-v2',
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.credit_assessments add column if not exists risk_level text not null default 'review';
alter table public.credit_assessments add column if not exists s_grade text not null default 'S5';
alter table public.credit_assessments add column if not exists contributions jsonb not null default '[]';
alter table public.credit_assessments add column if not exists model_inputs jsonb not null default '{}';
alter table public.credit_assessments add column if not exists methodology jsonb not null default '{}';

-- 아래 제출 RPC가 생성될 때부터 참조할 수 있도록 재무 검증 원장을 먼저 정의한다.
create table if not exists public.financial_verification_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  claimed_metrics jsonb not null default '{}', document_results jsonb not null default '[]',
  orchestration jsonb not null default '{}', model text not null default '',
  status text not null default 'needs_documents'
    check (status in ('needs_documents','mismatch','ready_for_admin','approved','rejected')),
  review_note text not null default '', reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.credit_assessments add column if not exists verification_run_id uuid references public.financial_verification_runs(id) on delete set null;

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  region text not null default '서울 전체',
  disclosures text[] not null default '{}',
  updated_at timestamptz not null default now()
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
  review_note text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.campaigns add column if not exists review_note text not null default '';
alter table public.campaigns add column if not exists published_at timestamptz;
alter table public.campaigns alter column user_id drop not null;

create table if not exists public.campaign_milestones (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sequence_no integer not null check (sequence_no between 1 and 20),
  title text not null,
  condition_text text not null,
  release_percent numeric not null check (release_percent > 0 and release_percent <= 100),
  status text not null default 'planned' check (status in ('planned', 'evidence_submitted', 'approved', 'rejected', 'released')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, sequence_no)
);

create table if not exists public.funding_commitments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  investor_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check (amount >= 1000),
  risk_consent boolean not null check (risk_consent),
  status text not null default 'committed' check (status in ('committed', 'escrowed', 'cancelled', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ocr_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  filename text not null default '',
  plan text not null,
  result jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.evidence_submissions (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.campaign_milestones(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ocr_analysis_id uuid references public.ocr_analyses(id) on delete set null,
  filename text not null,
  claimed_amount bigint not null default 0 check (claimed_amount >= 0),
  plan_match text not null default '검토 필요',
  result jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.disbursements (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid unique not null references public.campaign_milestones(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  amount bigint not null check (amount > 0),
  status text not null default 'released' check (status in ('approved', 'released', 'cancelled')),
  approved_by uuid not null references public.profiles(id) on delete restrict,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists campaigns_status_idx on public.campaigns(status, updated_at desc);
create index if not exists milestones_campaign_idx on public.campaign_milestones(campaign_id, sequence_no);
create index if not exists commitments_campaign_idx on public.funding_commitments(campaign_id, status);
create index if not exists evidence_status_idx on public.evidence_submissions(status, created_at);
create index if not exists assessment_business_idx on public.credit_assessments(business_id, created_at desc);
create index if not exists audit_entity_idx on public.audit_events(entity_type, entity_id, created_at desc);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.public_campaign_stats()
returns table(campaign_id uuid, committed_total bigint, escrow_total bigint, investor_count bigint)
language sql stable security definer set search_path = public as $$
  select c.id,
         coalesce(sum(f.amount) filter (where f.status in ('committed','escrowed')), 0)::bigint,
         coalesce(sum(f.amount) filter (where f.status = 'escrowed'), 0)::bigint,
         count(distinct f.investor_id) filter (where f.status in ('committed','escrowed'))::bigint
  from public.campaigns c
  left join public.funding_commitments f on f.campaign_id = c.id
  where c.status = 'published'
  group by c.id;
$$;

create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception '계정 역할은 운영자만 변경할 수 있습니다.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_profile_role_trigger on public.profiles;
create trigger guard_profile_role_trigger before update on public.profiles
for each row execute function public.guard_profile_role();

create or replace function public.guard_business_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and not public.is_admin() then
    new.verification_status := 'unverified';
    new.verification_note := '';
  elsif tg_op = 'UPDATE' and not public.is_admin() then
    if new.verification_status is distinct from old.verification_status
       or new.verification_note is distinct from old.verification_note then
      raise exception '사업자 검증 상태는 운영자만 변경할 수 있습니다.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_business_review_trigger on public.businesses;
create trigger guard_business_review_trigger before insert or update on public.businesses
for each row execute function public.guard_business_review();

create or replace function public.guard_campaign_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.review_note := '';
    new.published_at := null;
  elsif new.status is distinct from old.status then
    if not (new.status = 'submitted' and old.status in ('draft', 'needs_changes')) then
      raise exception '해당 모집 상태로 직접 변경할 수 없습니다.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_campaign_status_trigger on public.campaigns;
create trigger guard_campaign_status_trigger before insert or update on public.campaigns
for each row execute function public.guard_campaign_status();

create or replace function public.submit_campaign(p_campaign_id uuid)
returns public.campaigns language plpgsql security definer set search_path = public as $$
declare
  c public.campaigns;
  milestone_count integer;
  percent_total numeric;
  disclosure_count integer;
begin
  select * into c from public.campaigns where id = p_campaign_id for update;
  if c.id is null or (c.user_id <> auth.uid() and not public.is_admin()) then
    raise exception '제출할 모집안을 찾을 수 없습니다.';
  end if;
  if c.status not in ('draft', 'needs_changes') then
    raise exception '현재 상태에서는 다시 제출할 수 없습니다.';
  end if;
  select count(*), coalesce(sum(release_percent), 0)
    into milestone_count, percent_total
  from public.campaign_milestones where campaign_id = p_campaign_id;
  select cardinality(disclosures) into disclosure_count
  from public.user_settings where user_id = c.user_id;
  if milestone_count < 2 or percent_total <> 100 then
    raise exception '지급 단계는 2개 이상이며 지급 비율 합계가 100%%여야 합니다.';
  end if;
  if coalesce(disclosure_count, 0) < 6 then
    raise exception '필수 공시 6개 항목을 모두 확인해 주세요.';
  end if;
  if not exists(
    select 1 from public.credit_assessments a
    join public.financial_verification_runs v on v.id = a.verification_run_id
    where a.business_id = c.business_id and a.is_official and v.status = 'approved'
  ) then
    raise exception '증빙 OCR 교차검증과 운영자 승인을 마친 공식 재무·위험 심사가 필요합니다.';
  end if;
  update public.campaigns set status = 'submitted', review_note = '', updated_at = now()
    where id = p_campaign_id returning * into c;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id)
    values(auth.uid(), 'campaign_submitted', 'campaign', p_campaign_id::text);
  return c;
end;
$$;

create or replace function public.review_campaign(p_campaign_id uuid, p_decision text, p_note text default '')
returns public.campaigns language plpgsql security definer set search_path = public as $$
declare c public.campaigns;
begin
  if not public.is_admin() then raise exception '운영자 권한이 필요합니다.'; end if;
  if p_decision not in ('published', 'needs_changes', 'rejected') then
    raise exception '지원하지 않는 심사 결정입니다.';
  end if;
  select * into c from public.campaigns where id = p_campaign_id for update;
  if c.id is null or c.status not in ('submitted', 'needs_changes', 'published') then
    raise exception '심사할 모집안을 찾을 수 없습니다.';
  end if;
  if p_decision = 'published'
     and not exists(select 1 from public.businesses b where b.id=c.business_id and b.is_demo)
     and not exists(
       select 1 from public.credit_assessments a
       join public.financial_verification_runs v on v.id=a.verification_run_id
       where a.business_id=c.business_id and a.is_official and v.status='approved'
     ) then
    raise exception '공식 재무 원자료 검증이 없는 모집은 공개할 수 없습니다.';
  end if;
  update public.campaigns
    set status = p_decision,
        review_note = trim(coalesce(p_note, '')),
        published_at = case when p_decision = 'published' then coalesce(published_at, now()) else published_at end,
        updated_at = now()
    where id = p_campaign_id returning * into c;
  update public.businesses
    set verification_status = case when p_decision = 'published' then 'verified' when p_decision = 'rejected' then 'rejected' else 'pending' end,
        verification_note = trim(coalesce(p_note, '')),
        updated_at = now()
    where id = c.business_id;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, detail)
    values(auth.uid(), 'campaign_' || p_decision, 'campaign', p_campaign_id::text, jsonb_build_object('note', p_note));
  return c;
end;
$$;

create or replace function public.submit_milestone_evidence(
  p_milestone_id uuid, p_ocr_analysis_id uuid, p_filename text,
  p_claimed_amount bigint, p_plan_match text, p_result jsonb
)
returns public.evidence_submissions language plpgsql security definer set search_path = public as $$
declare
  m public.campaign_milestones;
  c public.campaigns;
  e public.evidence_submissions;
begin
  select * into m from public.campaign_milestones where id = p_milestone_id for update;
  select * into c from public.campaigns where id = m.campaign_id;
  if m.id is null or c.user_id <> auth.uid() then raise exception '증빙을 제출할 지급 단계를 찾을 수 없습니다.'; end if;
  if c.status <> 'published' then raise exception '공개 승인된 모집만 증빙을 제출할 수 있습니다.'; end if;
  if m.status not in ('planned', 'rejected') then raise exception '현재 단계에는 증빙을 다시 제출할 수 없습니다.'; end if;
  if exists(
    select 1 from public.campaign_milestones prior
    where prior.campaign_id = m.campaign_id and prior.sequence_no < m.sequence_no and prior.status <> 'released'
  ) then raise exception '앞 단계 지급이 완료된 후 다음 증빙을 제출할 수 있습니다.'; end if;
  insert into public.evidence_submissions(
    milestone_id, campaign_id, business_id, user_id, ocr_analysis_id,
    filename, claimed_amount, plan_match, result
  ) values (
    m.id, c.id, c.business_id, auth.uid(), p_ocr_analysis_id,
    left(coalesce(p_filename, ''), 255), greatest(coalesce(p_claimed_amount, 0), 0),
    left(coalesce(p_plan_match, '검토 필요'), 30), coalesce(p_result, '{}')
  ) returning * into e;
  update public.campaign_milestones set status = 'evidence_submitted', updated_at = now() where id = m.id;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id)
    values(auth.uid(), 'evidence_submitted', 'evidence', e.id::text);
  return e;
end;
$$;

create or replace function public.review_evidence(p_evidence_id uuid, p_decision text, p_note text default '')
returns public.evidence_submissions language plpgsql security definer set search_path = public as $$
declare e public.evidence_submissions;
begin
  if not public.is_admin() then raise exception '운영자 권한이 필요합니다.'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception '지원하지 않는 검토 결정입니다.'; end if;
  update public.evidence_submissions
    set status = p_decision, review_note = trim(coalesce(p_note, '')),
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_evidence_id and status = 'pending'
    returning * into e;
  if e.id is null then raise exception '검토 대기 중인 증빙을 찾을 수 없습니다.'; end if;
  update public.campaign_milestones set status = p_decision, updated_at = now() where id = e.milestone_id;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, detail)
    values(auth.uid(), 'evidence_' || p_decision, 'evidence', e.id::text, jsonb_build_object('note', p_note));
  return e;
end;
$$;

create or replace function public.confirm_commitment_escrow(p_commitment_id uuid)
returns public.funding_commitments language plpgsql security definer set search_path = public as $$
declare f public.funding_commitments;
begin
  if not public.is_admin() then raise exception '운영자 권한이 필요합니다.'; end if;
  update public.funding_commitments set status = 'escrowed', updated_at = now()
    where id = p_commitment_id and status = 'committed' returning * into f;
  if f.id is null then raise exception '확인할 참여 약정을 찾을 수 없습니다.'; end if;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id)
    values(auth.uid(), 'commitment_escrowed', 'commitment', f.id::text);
  return f;
end;
$$;

create or replace function public.release_milestone(p_milestone_id uuid)
returns public.disbursements language plpgsql security definer set search_path = public as $$
declare
  m public.campaign_milestones;
  c public.campaigns;
  release_amount bigint;
  escrow_total bigint;
  released_total bigint;
  d public.disbursements;
begin
  if not public.is_admin() then raise exception '운영자 권한이 필요합니다.'; end if;
  select * into m from public.campaign_milestones where id = p_milestone_id for update;
  select * into c from public.campaigns where id = m.campaign_id;
  if m.id is null or m.status <> 'approved' then raise exception '승인된 증빙이 있는 단계만 지급할 수 있습니다.'; end if;
  if exists(
    select 1 from public.campaign_milestones prior
    where prior.campaign_id = m.campaign_id and prior.sequence_no < m.sequence_no and prior.status <> 'released'
  ) then raise exception '앞 단계 지급을 먼저 완료해 주세요.'; end if;
  release_amount := floor(c.target_amount * m.release_percent / 100.0);
  select coalesce(sum(amount), 0) into escrow_total from public.funding_commitments
    where campaign_id = c.id and status = 'escrowed';
  select coalesce(sum(amount), 0) into released_total from public.disbursements
    where campaign_id = c.id and status = 'released';
  if escrow_total < released_total + release_amount then
    raise exception '확인된 예치 금액이 이번 지급액보다 부족합니다.';
  end if;
  insert into public.disbursements(milestone_id, campaign_id, amount, status, approved_by, released_at)
    values(m.id, c.id, release_amount, 'released', auth.uid(), now()) returning * into d;
  update public.campaign_milestones set status = 'released', updated_at = now() where id = m.id;
  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, detail)
    values(auth.uid(), 'milestone_released', 'milestone', m.id::text, jsonb_build_object('amount', release_amount));
  return d;
end;
$$;

alter table public.profiles enable row level security;
alter table public.login_events enable row level security;
alter table public.businesses enable row level security;
alter table public.business_metrics enable row level security;
alter table public.credit_assessments enable row level security;
alter table public.user_settings enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_milestones enable row level security;
alter table public.funding_commitments enable row level security;
alter table public.ocr_analyses enable row level security;
alter table public.evidence_submissions enable row level security;
alter table public.disbursements enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "profiles own select" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
drop policy if exists "profiles scoped read" on public.profiles;
create policy "profiles scoped read" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy "profiles own update" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "login own select" on public.login_events;
drop policy if exists "login own insert" on public.login_events;
drop policy if exists "login scoped read" on public.login_events;
create policy "login scoped read" on public.login_events for select
  using (user_id = auth.uid() or public.is_admin());
create policy "login own insert" on public.login_events for insert
  with check (user_id = auth.uid());

drop policy if exists "business public or own read" on public.businesses;
drop policy if exists "business owner insert" on public.businesses;
drop policy if exists "business owner update" on public.businesses;
drop policy if exists "business scoped read" on public.businesses;
create policy "business scoped read" on public.businesses for select
  using (verification_status = 'verified' or user_id = auth.uid() or public.is_admin());
create policy "business owner insert" on public.businesses for insert
  with check (user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
create policy "business owner update" on public.businesses for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "metrics public or own read" on public.business_metrics;
drop policy if exists "metrics owner write" on public.business_metrics;
drop policy if exists "metrics scoped read" on public.business_metrics;
create policy "metrics scoped read" on public.business_metrics for select
  using (exists(select 1 from public.businesses b where b.id = business_id and (b.verification_status = 'verified' or b.user_id = auth.uid())) or public.is_admin());
create policy "metrics owner write" on public.business_metrics for all
  using (exists(select 1 from public.businesses b where b.id = business_id and b.user_id = auth.uid()))
  with check (exists(select 1 from public.businesses b where b.id = business_id and b.user_id = auth.uid()));

drop policy if exists "assessment public or own read" on public.credit_assessments;
drop policy if exists "assessment owner insert" on public.credit_assessments;
drop policy if exists "assessment scoped read" on public.credit_assessments;
create policy "assessment scoped read" on public.credit_assessments for select
  using (exists(select 1 from public.businesses b where b.id = business_id and (b.verification_status = 'verified' or b.user_id = auth.uid())) or public.is_admin());
create policy "assessment owner insert" on public.credit_assessments for insert
  with check (exists(select 1 from public.businesses b where b.id = business_id and b.user_id = auth.uid()));

drop policy if exists "settings own" on public.user_settings;
create policy "settings own" on public.user_settings for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "campaign own read" on public.campaigns;
drop policy if exists "campaign owner write" on public.campaigns;
drop policy if exists "campaign scoped read" on public.campaigns;
drop policy if exists "campaign owner insert" on public.campaigns;
drop policy if exists "campaign owner update" on public.campaigns;
create policy "campaign scoped read" on public.campaigns for select
  using (status = 'published' or user_id = auth.uid() or public.is_admin());
create policy "campaign owner insert" on public.campaigns for insert
  with check (user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
create policy "campaign owner update" on public.campaigns for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "milestone scoped read" on public.campaign_milestones;
drop policy if exists "milestone owner write" on public.campaign_milestones;
create policy "milestone scoped read" on public.campaign_milestones for select
  using (exists(select 1 from public.campaigns c where c.id = campaign_id and (c.status = 'published' or c.user_id = auth.uid())) or public.is_admin());
create policy "milestone owner write" on public.campaign_milestones for all
  using (exists(select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'needs_changes')))
  with check (exists(select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid() and c.status in ('draft', 'needs_changes')));

drop policy if exists "commitment scoped read" on public.funding_commitments;
drop policy if exists "commitment investor insert" on public.funding_commitments;
create policy "commitment scoped read" on public.funding_commitments for select
  using (investor_id = auth.uid() or exists(select 1 from public.campaigns c where c.id = campaign_id and c.user_id = auth.uid()) or public.is_admin());
create policy "commitment investor insert" on public.funding_commitments for insert
  with check (investor_id = auth.uid() and status = 'committed' and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role in ('investor','admin')));

drop policy if exists "ocr own" on public.ocr_analyses;
create policy "ocr own" on public.ocr_analyses for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

drop policy if exists "evidence scoped read" on public.evidence_submissions;
create policy "evidence scoped read" on public.evidence_submissions for select
  using (user_id = auth.uid() or public.is_admin() or (status = 'approved' and exists(select 1 from public.campaigns c where c.id = campaign_id and c.status = 'published')));

drop policy if exists "disbursement scoped read" on public.disbursements;
create policy "disbursement scoped read" on public.disbursements for select
  using (public.is_admin() or exists(select 1 from public.campaigns c where c.id = campaign_id and (c.status = 'published' or c.user_id = auth.uid())));

drop policy if exists "audit admin read" on public.audit_events;
create policy "audit admin read" on public.audit_events for select using (public.is_admin());

revoke all on public.profiles, public.businesses, public.business_metrics, public.credit_assessments,
  public.user_settings, public.campaigns, public.campaign_milestones, public.funding_commitments,
  public.ocr_analyses, public.evidence_submissions, public.disbursements, public.audit_events
  from anon, authenticated;
grant select on public.businesses, public.business_metrics, public.credit_assessments,
  public.campaigns, public.campaign_milestones, public.evidence_submissions, public.disbursements to anon;
grant select on public.profiles, public.login_events, public.businesses, public.business_metrics,
  public.credit_assessments, public.user_settings, public.campaigns, public.campaign_milestones,
  public.funding_commitments, public.ocr_analyses, public.evidence_submissions,
  public.disbursements, public.audit_events to authenticated;
grant insert on public.login_events, public.businesses, public.business_metrics,
  public.credit_assessments, public.user_settings, public.campaigns, public.campaign_milestones,
  public.funding_commitments, public.ocr_analyses to authenticated;
grant update on public.profiles, public.businesses, public.business_metrics, public.user_settings,
  public.campaigns, public.campaign_milestones to authenticated;
grant delete on public.campaign_milestones to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.public_campaign_stats() to anon, authenticated;
grant execute on function public.submit_campaign(uuid) to authenticated;
grant execute on function public.review_campaign(uuid, text, text) to authenticated;
grant execute on function public.submit_milestone_evidence(uuid, uuid, text, bigint, text, jsonb) to authenticated;
grant execute on function public.review_evidence(uuid, text, text) to authenticated;
grant execute on function public.confirm_commitment_escrow(uuid) to authenticated;
grant execute on function public.release_milestone(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 소비 쿠폰형 펀드 확장: 투자 잔액, FIFO 유동성 매칭, 쿠폰 보상
-- 기존 심사·예치·마일스톤 구조를 유지하면서 실제 서비스 흐름을 추가한다.
-- ---------------------------------------------------------------------------

alter table public.businesses add column if not exists representative_name text not null default '';
alter table public.businesses add column if not exists opening_date date;
alter table public.businesses add column if not exists restaurant_license_confirmed boolean not null default false;
alter table public.businesses add column if not exists applicant_is_representative boolean not null default false;
alter table public.businesses add column if not exists pos_data_consent boolean not null default false;
alter table public.businesses add column if not exists card_sales_consent boolean not null default false;
alter table public.businesses add column if not exists owner_story text not null default '';
alter table public.businesses add column if not exists highlights jsonb not null default '[]'::jsonb;
alter table public.businesses add column if not exists menu_items jsonb not null default '[]'::jsonb;

alter table public.business_metrics add column if not exists card_sales_6m bigint[] not null default '{}';
alter table public.business_metrics add column if not exists cash_sales_6m bigint[] not null default '{}';
alter table public.business_metrics add column if not exists monthly_fixed_cost bigint not null default 0;
alter table public.business_metrics add column if not exists monthly_rent bigint not null default 0;
alter table public.business_metrics add column if not exists monthly_labor_cost bigint not null default 0;
alter table public.business_metrics add column if not exists monthly_material_cost bigint not null default 0;
alter table public.business_metrics add column if not exists administrative_action_count integer not null default 0;
alter table public.business_metrics add column if not exists representative_change_count integer not null default 0;

alter table public.campaigns add column if not exists fund_status text not null default 'preparing';
alter table public.campaigns add column if not exists current_amount bigint not null default 0;
alter table public.campaigns add column if not exists closes_at timestamptz;
alter table public.campaigns add column if not exists closed_at timestamptz;
alter table public.campaigns add column if not exists max_discount_rate numeric not null default 30;
alter table public.campaigns add column if not exists min_coupon_rate numeric not null default 10;
alter table public.campaigns add column if not exists coupon_max_amount bigint;
alter table public.campaigns add column if not exists representative_menu text not null default '';
alter table public.campaigns add column if not exists representative_menu_price bigint not null default 0;
alter table public.campaigns add column if not exists image_url text not null default '';
alter table public.campaigns add column if not exists investor_benefits text not null default '';
alter table public.campaigns drop constraint if exists campaigns_fund_status_check;
alter table public.campaigns add constraint campaigns_fund_status_check
  check (fund_status in ('preparing', 'fundraising', 'closed'));
alter table public.campaigns drop constraint if exists campaigns_current_amount_check;
alter table public.campaigns add constraint campaigns_current_amount_check check (current_amount >= 0);
alter table public.campaigns drop constraint if exists campaigns_coupon_rate_check;
alter table public.campaigns add constraint campaigns_coupon_rate_check
  check (max_discount_rate between 30 and 60 and min_coupon_rate between 1 and max_discount_rate);
update public.campaigns c set
  current_amount = greatest(c.current_amount, coalesce((
    select sum(f.amount) from public.funding_commitments f
    where f.campaign_id=c.id and f.status in ('committed','escrowed')
  ),0)),
  fund_status = case
    when c.status='published' and greatest(c.current_amount,coalesce((select sum(f.amount) from public.funding_commitments f where f.campaign_id=c.id and f.status in ('committed','escrowed')),0))>=c.target_amount then 'closed'
    when c.status='published' then 'fundraising'
    else c.fund_status end,
  closes_at = case when c.status='published' then coalesce(c.closes_at,c.published_at+make_interval(days=>c.duration_days)) else c.closes_at end
where c.status='published' and c.fund_status='preparing';

create table if not exists public.fund_policies (
  policy_key text primary key,
  policy_value jsonb not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.fund_policies(policy_key, policy_value, description) values
  ('max_investment_ratio', '{"value":0.01}', '캠페인 목표액 대비 1인 최대 보유 비율'),
  ('investment_unit', '{"value":1000}', '투자·회수·매칭 최소 거래 단위'),
  ('daily_coupon_growth_rate', '{"value":0.5}', '10만원 투자 기준 일별 할인율 증가폭'),
  ('coupon_trade_max_diff', '{"value":10}', '교환 가능한 쿠폰 할인율 차이(미만)'),
  ('sales_growth_bonus_multiplier', '{"value":0.2}', '월 매출 성장률 1%당 쿠폰 보너스')
on conflict (policy_key) do nothing;

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  investor_id uuid not null references public.profiles(id) on delete cascade,
  invested_amount bigint not null default 0 check (invested_amount >= 0),
  accrued_discount numeric not null default 0 check (accrued_discount >= 0),
  last_accrual_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  invested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, investor_id)
);

create table if not exists public.investment_reservations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  investor_id uuid not null references public.profiles(id) on delete cascade,
  reserved_amount bigint not null check (reserved_amount >= 1000),
  matched_amount bigint not null default 0 check (matched_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'partial', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (matched_amount <= reserved_amount)
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  investor_id uuid not null references public.profiles(id) on delete cascade,
  requested_amount bigint not null check (requested_amount >= 1000),
  matched_amount bigint not null default 0 check (matched_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'partial', 'completed', 'cancelled')),
  coupon_issued boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (matched_amount <= requested_amount)
);

create table if not exists public.matching_transactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  reservation_id uuid not null references public.investment_reservations(id) on delete restrict,
  withdrawal_id uuid not null references public.withdrawal_requests(id) on delete restrict,
  incoming_investor_id uuid not null references public.profiles(id) on delete restrict,
  outgoing_investor_id uuid not null references public.profiles(id) on delete restrict,
  amount bigint not null check (amount >= 1000 and amount % 1000 = 0),
  matched_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  original_investor_id uuid references public.profiles(id) on delete set null,
  discount_rate numeric not null check (discount_rate > 0 and discount_rate <= 100),
  coupon_type text not null default 'accrual' check (coupon_type in ('accrual', 'withdrawal', 'dividend', 'sales_bonus')),
  benefit_kind text not null default 'percent' check (benefit_kind in ('percent', 'fixed', 'menu')),
  description text not null default '',
  max_discount_amount bigint,
  status text not null default 'available' check (status in ('available', 'trade_pending', 'used', 'expired')),
  used_order_amount bigint,
  discount_amount bigint,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
-- 2026-08 이전 데모 coupons 테이블(user_id/store_name/title/code 중심)이 남아 있어도
-- 데이터를 삭제하지 않고 투자 쿠폰 원장 컬럼을 확장한다.
alter table public.coupons add column if not exists campaign_id uuid references public.campaigns(id) on delete cascade;
alter table public.coupons add column if not exists owner_id uuid references public.profiles(id) on delete restrict;
alter table public.coupons add column if not exists original_investor_id uuid references public.profiles(id) on delete set null;
alter table public.coupons add column if not exists discount_rate numeric not null default 1;
alter table public.coupons add column if not exists coupon_type text not null default 'accrual';
alter table public.coupons add column if not exists benefit_kind text not null default 'percent';
alter table public.coupons add column if not exists description text not null default '';
alter table public.coupons add column if not exists max_discount_amount bigint;
alter table public.coupons add column if not exists status text not null default 'available';
alter table public.coupons add column if not exists used_order_amount bigint;
alter table public.coupons add column if not exists discount_amount bigint;
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='coupons' and column_name='user_id') then
    alter table public.coupons alter column user_id drop not null;
    alter table public.coupons alter column source_type set default 'investment';
    alter table public.coupons alter column source_id set default '';
    alter table public.coupons alter column store_name set default '';
    alter table public.coupons alter column title set default '';
    alter table public.coupons alter column benefit set default '';
    alter table public.coupons alter column code set default gen_random_uuid()::text;
    alter table public.coupons alter column expires_at set default (current_date + 365);
  end if;
end $$;

create table if not exists public.coupon_transactions (
  id bigint generated always as identity primary key,
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  transaction_type text not null check (transaction_type in ('issued', 'used', 'trade_listed', 'traded', 'expired')),
  from_owner_id uuid references public.profiles(id) on delete set null,
  to_owner_id uuid references public.profiles(id) on delete set null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.coupon_trades (
  id uuid primary key default gen_random_uuid(),
  offered_coupon_id uuid not null references public.coupons(id) on delete restrict,
  offered_by uuid not null references public.profiles(id) on delete cascade,
  requested_coupon_id uuid references public.coupons(id) on delete restrict,
  accepted_by uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.dividend_coupons (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  issuer_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  benefit_kind text not null default 'percent' check (benefit_kind in ('percent', 'fixed', 'menu')),
  discount_value numeric not null check (discount_value > 0),
  target text not null default 'all' check (target in ('all', 'proportional')),
  issued_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_monthly_sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  year_month date not null,
  total_sales bigint not null default 0 check (total_sales >= 0),
  coupon_sales bigint not null default 0 check (coupon_sales >= 0),
  coupon_discount_total bigint not null default 0 check (coupon_discount_total >= 0),
  coupons_used integer not null default 0 check (coupons_used >= 0),
  growth_rate numeric not null default 0,
  bonus_rate numeric not null default 0,
  verification_status text not null default 'owner_claimed'
    check (verification_status in ('owner_claimed','verified','rejected')),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(business_id, year_month)
);
alter table public.restaurant_monthly_sales add column if not exists verification_status text not null default 'owner_claimed';
alter table public.restaurant_monthly_sales add column if not exists verified_by uuid references public.profiles(id) on delete set null;
alter table public.restaurant_monthly_sales add column if not exists verified_at timestamptz;
alter table public.restaurant_monthly_sales drop constraint if exists restaurant_monthly_sales_verification_status_check;
alter table public.restaurant_monthly_sales add constraint restaurant_monthly_sales_verification_status_check
  check (verification_status in ('owner_claimed','verified','rejected'));

create table if not exists public.ai_contents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  content_type text not null default 'insight',
  source_metrics jsonb not null default '{}',
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.thematic_funds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  region text not null default '',
  category text not null default '',
  image_url text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.thematic_fund_restaurants (
  thematic_fund_id uuid not null references public.thematic_funds(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  weight numeric not null default 1 check (weight > 0),
  primary key(thematic_fund_id, campaign_id)
);

create index if not exists investments_investor_idx on public.investments(investor_id, status);
create index if not exists reservations_fifo_idx on public.investment_reservations(campaign_id, status, created_at, id);
create index if not exists withdrawals_fifo_idx on public.withdrawal_requests(campaign_id, status, created_at, id);
create index if not exists matching_campaign_idx on public.matching_transactions(campaign_id, matched_at desc);
create index if not exists coupons_owner_idx on public.coupons(owner_id, status, created_at desc);
create index if not exists coupons_campaign_idx on public.coupons(campaign_id, status);

create or replace function public.policy_number(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (policy_value->>'value')::numeric from public.fund_policies where policy_key = p_key), p_default);
$$;

create or replace function public.settle_investment_coupon(p_investment_id uuid, p_force_issue boolean default false, p_coupon_type text default 'accrual')
returns numeric language plpgsql security definer set search_path = public as $$
declare
  i public.investments;
  c public.campaigns;
  elapsed_days numeric;
  total_rate numeric;
  issue_rate numeric;
begin
  select * into i from public.investments where id = p_investment_id for update;
  if i.id is null then return 0; end if;
  select * into c from public.campaigns where id = i.campaign_id;
  elapsed_days := greatest(0, extract(epoch from (now() - i.last_accrual_at)) / 86400.0);
  total_rate := i.accrued_discount + (i.invested_amount / 100000.0)
    * public.policy_number('daily_coupon_growth_rate', 0.5) * elapsed_days;

  while total_rate >= c.max_discount_rate loop
    insert into public.coupons(campaign_id, owner_id, original_investor_id, discount_rate,
      coupon_type, description, max_discount_amount, expires_at)
    values(c.id, i.investor_id, i.investor_id, c.max_discount_rate, 'accrual',
      c.name || ' 투자 유지 보상', c.coupon_max_amount, now() + interval '1 year');
    total_rate := total_rate - c.max_discount_rate;
  end loop;

  if p_force_issue and total_rate >= c.min_coupon_rate then
    issue_rate := round(least(total_rate, c.max_discount_rate), 4);
    insert into public.coupons(campaign_id, owner_id, original_investor_id, discount_rate,
      coupon_type, description, max_discount_amount, expires_at)
    values(c.id, i.investor_id, i.investor_id, issue_rate, p_coupon_type,
      c.name || case when p_coupon_type = 'withdrawal' then ' 회수 보상' else ' 중간 발급' end,
      c.coupon_max_amount, now() + interval '1 year');
    total_rate := 0;
  end if;

  update public.investments set accrued_discount = round(total_rate, 2),
    last_accrual_at = now(), updated_at = now() where id = i.id;
  return round(total_rate, 2);
end;
$$;

create or replace function public.process_fund_matching(p_campaign_id uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  r public.investment_reservations;
  w public.withdrawal_requests;
  chunk bigint;
  total_matched bigint := 0;
  outgoing public.investments;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));
  perform 1 from public.campaigns where id = p_campaign_id and fund_status = 'closed' for update;
  loop
    select * into r from public.investment_reservations
      where campaign_id = p_campaign_id and status in ('pending','partial')
      order by created_at, id for update skip locked limit 1;
    exit when r.id is null;
    select * into w from public.withdrawal_requests
      where campaign_id = p_campaign_id and status in ('pending','partial')
        and investor_id <> r.investor_id
      order by created_at, id for update skip locked limit 1;
    exit when w.id is null;
    chunk := least(r.reserved_amount - r.matched_amount, w.requested_amount - w.matched_amount);
    chunk := floor(chunk / 1000.0) * 1000;
    exit when chunk < 1000;

    select * into outgoing from public.investments
      where campaign_id = p_campaign_id and investor_id = w.investor_id for update;
    if outgoing.id is null or outgoing.invested_amount < chunk then
      update public.withdrawal_requests set status = 'cancelled', updated_at = now() where id = w.id;
      continue;
    end if;
    if not w.coupon_issued then
      perform public.settle_investment_coupon(outgoing.id, true, 'withdrawal');
      update public.withdrawal_requests set coupon_issued = true where id = w.id;
    else
      perform public.settle_investment_coupon(outgoing.id, false, 'accrual');
    end if;
    update public.investments set invested_amount = invested_amount - chunk,
      status = case when invested_amount - chunk = 0 then 'withdrawn' else 'active' end,
      updated_at = now() where id = outgoing.id;
    if exists(select 1 from public.investments where campaign_id=p_campaign_id and investor_id=r.investor_id) then
      perform public.settle_investment_coupon((select id from public.investments where campaign_id=p_campaign_id and investor_id=r.investor_id), false, 'accrual');
    end if;
    insert into public.investments(campaign_id, investor_id, invested_amount, status)
      values(p_campaign_id, r.investor_id, chunk, 'active')
      on conflict(campaign_id, investor_id) do update set
        invested_amount = public.investments.invested_amount + excluded.invested_amount,
        status = 'active', updated_at = now();
    update public.investment_reservations set matched_amount = matched_amount + chunk,
      status = case when matched_amount + chunk = reserved_amount then 'completed' else 'partial' end,
      updated_at = now() where id = r.id;
    update public.withdrawal_requests set matched_amount = matched_amount + chunk,
      status = case when matched_amount + chunk = requested_amount then 'completed' else 'partial' end,
      updated_at = now() where id = w.id;
    insert into public.matching_transactions(campaign_id, reservation_id, withdrawal_id,
      incoming_investor_id, outgoing_investor_id, amount)
    values(p_campaign_id, r.id, w.id, r.investor_id, w.investor_id, chunk);
    total_matched := total_matched + chunk;
  end loop;
  return total_matched;
end;
$$;

create or replace function public.invest_fund(p_campaign_id uuid, p_amount bigint, p_risk_consent boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.campaigns;
  unit bigint := public.policy_number('investment_unit', 1000)::bigint;
  max_amount bigint;
  holding bigint;
  queued bigint;
  reservation_id uuid;
  matched bigint := 0;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id = auth.uid() and role in ('investor','admin')) then
    raise exception '투자자 로그인이 필요합니다.';
  end if;
  if not p_risk_consent then raise exception '투자 위험 확인이 필요합니다.'; end if;
  if p_amount < unit or p_amount % unit <> 0 then raise exception '투자금은 %원 단위여야 합니다.', unit; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));
  select * into c from public.campaigns where id = p_campaign_id and status = 'published' for update;
  if c.id is null then raise exception '공개된 펀드를 찾을 수 없습니다.'; end if;
  if not exists(select 1 from public.businesses b where b.id=c.business_id and b.is_demo)
     and not exists(
       select 1 from public.credit_assessments a
       join public.financial_verification_runs v on v.id=a.verification_run_id
       where a.business_id=c.business_id and a.is_official and v.status='approved'
     ) then
    raise exception '공식 재무 검증이 유효하지 않아 현재 참여할 수 없습니다.';
  end if;
  max_amount := floor(c.target_amount * public.policy_number('max_investment_ratio', 0.01) / unit) * unit;
  select coalesce(invested_amount, 0) into holding from public.investments
    where campaign_id = c.id and investor_id = auth.uid();
  select coalesce(sum(reserved_amount - matched_amount), 0) into queued
    from public.investment_reservations where campaign_id = c.id and investor_id = auth.uid()
      and status in ('pending','partial');
  if coalesce(holding, 0) + queued + p_amount > max_amount then
    raise exception '1인 최대 투자금 %원을 초과합니다.', max_amount;
  end if;

  if c.fund_status = 'fundraising' then
    if c.current_amount + p_amount > c.target_amount then raise exception '남은 모집금액을 초과합니다.'; end if;
    if holding > 0 then
      perform public.settle_investment_coupon((select id from public.investments where campaign_id=c.id and investor_id=auth.uid()), false, 'accrual');
    end if;
    insert into public.investments(campaign_id, investor_id, invested_amount, status)
      values(c.id, auth.uid(), p_amount, 'active')
      on conflict(campaign_id, investor_id) do update set
        invested_amount = public.investments.invested_amount + excluded.invested_amount,
        status = 'active', updated_at = now();
    insert into public.funding_commitments(campaign_id, investor_id, amount, risk_consent, status)
      values(c.id, auth.uid(), p_amount, true, 'committed');
    update public.campaigns set current_amount = current_amount + p_amount,
      fund_status = case when current_amount + p_amount >= target_amount then 'closed' else fund_status end,
      closed_at = case when current_amount + p_amount >= target_amount then now() else closed_at end,
      updated_at = now() where id = c.id;
    return jsonb_build_object('mode','invested','investedAmount',coalesce(holding,0)+p_amount,
      'fundClosed',c.current_amount+p_amount>=c.target_amount);
  elsif c.fund_status = 'closed' then
    insert into public.investment_reservations(campaign_id, investor_id, reserved_amount)
      values(c.id, auth.uid(), p_amount) returning id into reservation_id;
    matched := public.process_fund_matching(c.id);
    return jsonb_build_object('mode','reserved','reservationId',reservation_id,'matchedNow',matched);
  end if;
  raise exception '현재 투자할 수 없는 펀드입니다.';
end;
$$;

create or replace function public.withdraw_fund(p_campaign_id uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.campaigns;
  i public.investments;
  unit bigint := public.policy_number('investment_unit', 1000)::bigint;
  already_requested bigint;
  request_id uuid;
  matched bigint := 0;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if p_amount < unit or p_amount % unit <> 0 then raise exception '회수금은 %원 단위여야 합니다.', unit; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 0));
  select * into c from public.campaigns where id = p_campaign_id and status = 'published' for update;
  select * into i from public.investments where campaign_id = p_campaign_id and investor_id = auth.uid() for update;
  if c.id is null or i.id is null then raise exception '회수할 투자잔액이 없습니다.'; end if;
  select coalesce(sum(requested_amount - matched_amount),0) into already_requested
    from public.withdrawal_requests where campaign_id=p_campaign_id and investor_id=auth.uid()
      and status in ('pending','partial');
  if p_amount + already_requested > i.invested_amount then raise exception '회수 가능한 투자잔액을 초과합니다.'; end if;
  if c.fund_status = 'fundraising' then
    perform public.settle_investment_coupon(i.id, true, 'withdrawal');
    update public.investments set invested_amount=invested_amount-p_amount,
      status=case when invested_amount-p_amount=0 then 'withdrawn' else 'active' end,
      updated_at=now() where id=i.id;
    update public.campaigns set current_amount=current_amount-p_amount, updated_at=now() where id=c.id;
    insert into public.withdrawal_requests(campaign_id, investor_id, requested_amount, matched_amount, status, coupon_issued)
      values(c.id,auth.uid(),p_amount,p_amount,'completed',true) returning id into request_id;
    return jsonb_build_object('mode','withdrawn','requestId',request_id,'remainingAmount',i.invested_amount-p_amount);
  elsif c.fund_status = 'closed' then
    insert into public.withdrawal_requests(campaign_id, investor_id, requested_amount)
      values(c.id,auth.uid(),p_amount) returning id into request_id;
    matched := public.process_fund_matching(c.id);
    return jsonb_build_object('mode','queued','requestId',request_id,'matchedNow',matched);
  end if;
  raise exception '현재 회수할 수 없는 펀드입니다.';
end;
$$;

create or replace function public.close_fund(p_campaign_id uuid)
returns public.campaigns language plpgsql security definer set search_path = public as $$
declare c public.campaigns;
begin
  select * into c from public.campaigns where id=p_campaign_id for update;
  if c.id is null or (c.user_id<>auth.uid() and not public.is_admin()) then raise exception '종료할 펀드를 찾을 수 없습니다.'; end if;
  if c.status<>'published' or c.fund_status<>'fundraising' or c.current_amount<=0 then raise exception '모집 중이며 투자금이 있는 펀드만 종료할 수 있습니다.'; end if;
  update public.campaigns set fund_status='closed',closed_at=now(),updated_at=now() where id=c.id returning * into c;
  return c;
end;
$$;

create or replace function public.issue_accrued_coupon(p_campaign_id uuid)
returns public.coupons language plpgsql security definer set search_path = public as $$
declare i public.investments; before_count bigint; result public.coupons;
begin
  select * into i from public.investments where campaign_id=p_campaign_id and investor_id=auth.uid() for update;
  if i.id is null or i.invested_amount<=0 then raise exception '활성 투자가 없습니다.'; end if;
  select count(*) into before_count from public.coupons where owner_id=auth.uid() and campaign_id=p_campaign_id;
  perform public.settle_investment_coupon(i.id,true,'accrual');
  select * into result from public.coupons where owner_id=auth.uid() and campaign_id=p_campaign_id
    order by created_at desc limit 1;
  if (select count(*) from public.coupons where owner_id=auth.uid() and campaign_id=p_campaign_id)<=before_count then
    raise exception '최소 발급 할인율에 아직 도달하지 않았습니다.';
  end if;
  return result;
end;
$$;

create or replace function public.use_coupon(p_coupon_id uuid, p_order_amount bigint)
returns public.coupons language plpgsql security definer set search_path = public as $$
declare c public.coupons; discounted bigint;
begin
  select * into c from public.coupons where id=p_coupon_id for update;
  if c.id is null or c.owner_id<>auth.uid() or c.status<>'available' then raise exception '사용 가능한 본인 쿠폰이 아닙니다.'; end if;
  if c.expires_at is not null and c.expires_at<now() then
    update public.coupons set status='expired' where id=c.id;
    raise exception '유효기간이 지난 쿠폰입니다.';
  end if;
  if p_order_amount<=0 then raise exception '주문금액을 입력해 주세요.'; end if;
  discounted := floor(p_order_amount*c.discount_rate/100.0);
  if c.max_discount_amount is not null then discounted:=least(discounted,c.max_discount_amount); end if;
  update public.coupons set status='used',used_order_amount=p_order_amount,discount_amount=discounted,used_at=now()
    where id=c.id returning * into c;
  insert into public.coupon_transactions(coupon_id,actor_id,transaction_type,from_owner_id,to_owner_id,detail)
    values(c.id,auth.uid(),'used',auth.uid(),auth.uid(),jsonb_build_object('orderAmount',p_order_amount,'discountAmount',discounted));
  return c;
end;
$$;

create or replace function public.issue_dividend_coupon(p_campaign_id uuid,p_title text,p_description text,
  p_benefit_kind text,p_discount_value numeric,p_target text default 'all')
returns integer language plpgsql security definer set search_path=public as $$
declare c public.campaigns; issued integer;
begin
  select * into c from public.campaigns where id=p_campaign_id;
  if c.id is null or c.user_id<>auth.uid() then raise exception '본인 펀드만 배당 쿠폰을 발급할 수 있습니다.'; end if;
  if p_benefit_kind not in ('percent','fixed','menu') or p_discount_value<=0 then raise exception '쿠폰 혜택값을 확인해 주세요.'; end if;
  insert into public.dividend_coupons(campaign_id,issuer_id,title,description,benefit_kind,discount_value,target)
    values(c.id,auth.uid(),left(p_title,80),coalesce(p_description,''),p_benefit_kind,p_discount_value,p_target);
  insert into public.coupons(campaign_id,owner_id,original_investor_id,discount_rate,coupon_type,benefit_kind,description,max_discount_amount,expires_at)
    select c.id,i.investor_id,i.investor_id,
      case when p_benefit_kind='percent' then least(p_discount_value,100) else 1 end,
      'dividend',p_benefit_kind,left(p_title||case when p_description<>'' then ' · '||p_description else '' end,200),
      case when p_benefit_kind='fixed' then p_discount_value::bigint else c.coupon_max_amount end,now()+interval '6 months'
    from public.investments i where i.campaign_id=c.id and i.invested_amount>0;
  get diagnostics issued=row_count;
  update public.dividend_coupons set issued_count=issued where campaign_id=c.id and issuer_id=auth.uid()
    and created_at=(select max(created_at) from public.dividend_coupons where campaign_id=c.id and issuer_id=auth.uid());
  return issued;
end;
$$;

create or replace function public.record_monthly_sales(p_business_id uuid,p_year_month date,p_total_sales bigint,
  p_coupon_sales bigint default 0,p_coupon_discount_total bigint default 0,p_coupons_used integer default 0)
returns public.restaurant_monthly_sales language plpgsql security definer set search_path=public as $$
declare previous_sales bigint; growth numeric:=0; bonus numeric:=0; result public.restaurant_monthly_sales;
begin
  if not exists(select 1 from public.businesses where id=p_business_id and user_id=auth.uid()) then raise exception '본인 사업장만 입력할 수 있습니다.'; end if;
  select total_sales into previous_sales from public.restaurant_monthly_sales where business_id=p_business_id and year_month<p_year_month order by year_month desc limit 1;
  if coalesce(previous_sales,0)>0 then growth:=round((p_total_sales-previous_sales)*100.0/previous_sales,2); end if;
  -- 사업자 직접 입력은 미검증 주장이다. 검증 전에는 투자자 쿠폰 적립률을 바꾸지 않는다.
  bonus:=0;
  insert into public.restaurant_monthly_sales(business_id,year_month,total_sales,coupon_sales,coupon_discount_total,coupons_used,growth_rate,bonus_rate,verification_status,verified_by,verified_at)
    values(p_business_id,date_trunc('month',p_year_month)::date,p_total_sales,p_coupon_sales,p_coupon_discount_total,p_coupons_used,growth,bonus,'owner_claimed',null,null)
    on conflict(business_id,year_month) do update set total_sales=excluded.total_sales,coupon_sales=excluded.coupon_sales,
      coupon_discount_total=excluded.coupon_discount_total,coupons_used=excluded.coupons_used,growth_rate=excluded.growth_rate,bonus_rate=0,
      verification_status='owner_claimed',verified_by=null,verified_at=null
    returning * into result;
  return result;
end;
$$;

create or replace function public.create_coupon_trade(p_coupon_id uuid)
returns public.coupon_trades language plpgsql security definer set search_path=public as $$
declare c public.coupons; t public.coupon_trades;
begin
  select * into c from public.coupons where id=p_coupon_id for update;
  if c.id is null or c.owner_id<>auth.uid() or c.status<>'available' then raise exception '교환 등록 가능한 본인 쿠폰이 아닙니다.'; end if;
  update public.coupons set status='trade_pending' where id=c.id;
  insert into public.coupon_trades(offered_coupon_id,offered_by) values(c.id,auth.uid()) returning * into t;
  return t;
end;
$$;

create or replace function public.accept_coupon_trade(p_trade_id uuid,p_coupon_id uuid)
returns public.coupon_trades language plpgsql security definer set search_path=public as $$
declare t public.coupon_trades; offered public.coupons; requested public.coupons;
begin
  select * into t from public.coupon_trades where id=p_trade_id for update;
  select * into offered from public.coupons where id=t.offered_coupon_id for update;
  select * into requested from public.coupons where id=p_coupon_id for update;
  if t.id is null or t.status<>'open' or t.offered_by=auth.uid() then raise exception '교환 가능한 제안이 아닙니다.'; end if;
  if requested.id is null or requested.owner_id<>auth.uid() or requested.status<>'available' then raise exception '교환할 본인 쿠폰을 확인해 주세요.'; end if;
  if abs(offered.discount_rate-requested.discount_rate)>=public.policy_number('coupon_trade_max_diff',10) then raise exception '할인율 차이가 10%%p 미만인 쿠폰끼리만 교환할 수 있습니다.'; end if;
  update public.coupons set owner_id=auth.uid(),status='available' where id=offered.id;
  update public.coupons set owner_id=t.offered_by,status='available' where id=requested.id;
  update public.coupon_trades set requested_coupon_id=requested.id,accepted_by=auth.uid(),status='completed',completed_at=now() where id=t.id returning * into t;
  return t;
end;
$$;

create or replace function public.guard_campaign_fund_config()
returns trigger language plpgsql security definer set search_path=public as $$
declare assessment_limit bigint;
begin
  select funding_limit into assessment_limit from public.credit_assessments where business_id=new.business_id order by created_at desc limit 1;
  if new.target_amount>coalesce(assessment_limit,0) and not public.is_admin() then raise exception 'AI 심사 최대 펀딩 한도를 초과합니다.'; end if;
  if tg_op='UPDATE' and old.fund_status='closed' and new.current_amount<>old.current_amount and not public.is_admin() then raise exception '모집 종료 후 펀드 총액은 직접 변경할 수 없습니다.'; end if;
  return new;
end;
$$;
drop trigger if exists guard_campaign_fund_config_trigger on public.campaigns;
create trigger guard_campaign_fund_config_trigger before insert or update on public.campaigns
for each row execute function public.guard_campaign_fund_config();

-- 캠페인 공개 승인 시 실제 모집을 시작하고 종료 예정일을 확정한다.
create or replace function public.start_fund_after_publish()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='published' and old.status is distinct from 'published' then
    new.fund_status:='fundraising';
    new.closes_at:=coalesce(new.closes_at,now()+make_interval(days=>new.duration_days));
  end if;
  return new;
end;
$$;
drop trigger if exists start_fund_after_publish_trigger on public.campaigns;
create trigger start_fund_after_publish_trigger before update on public.campaigns
for each row execute function public.start_fund_after_publish();

alter table public.fund_policies enable row level security;
alter table public.investments enable row level security;
alter table public.investment_reservations enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.matching_transactions enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_transactions enable row level security;
alter table public.coupon_trades enable row level security;
alter table public.dividend_coupons enable row level security;
alter table public.restaurant_monthly_sales enable row level security;
alter table public.ai_contents enable row level security;
alter table public.thematic_funds enable row level security;
alter table public.thematic_fund_restaurants enable row level security;

drop policy if exists "fund policies public read" on public.fund_policies;
drop policy if exists "investments scoped read" on public.investments;
drop policy if exists "reservations scoped read" on public.investment_reservations;
drop policy if exists "withdrawals scoped read" on public.withdrawal_requests;
drop policy if exists "matching scoped read" on public.matching_transactions;
drop policy if exists "coupons owner or merchant read" on public.coupons;
drop policy if exists "coupon transactions scoped read" on public.coupon_transactions;
drop policy if exists "coupon trades public read" on public.coupon_trades;
drop policy if exists "dividend merchant read" on public.dividend_coupons;
drop policy if exists "sales scoped read" on public.restaurant_monthly_sales;
drop policy if exists "ai contents public read" on public.ai_contents;
drop policy if exists "thematic funds public read" on public.thematic_funds;
drop policy if exists "thematic links public read" on public.thematic_fund_restaurants;
create policy "fund policies public read" on public.fund_policies for select using (true);
create policy "investments scoped read" on public.investments for select using
  (investor_id=auth.uid() or public.is_admin() or exists(select 1 from public.campaigns c where c.id=campaign_id and c.user_id=auth.uid()));
create policy "reservations scoped read" on public.investment_reservations for select using
  (investor_id=auth.uid() or public.is_admin() or exists(select 1 from public.campaigns c where c.id=campaign_id and c.user_id=auth.uid()));
create policy "withdrawals scoped read" on public.withdrawal_requests for select using
  (investor_id=auth.uid() or public.is_admin() or exists(select 1 from public.campaigns c where c.id=campaign_id and c.user_id=auth.uid()));
create policy "matching scoped read" on public.matching_transactions for select using
  (incoming_investor_id=auth.uid() or outgoing_investor_id=auth.uid() or public.is_admin() or exists(select 1 from public.campaigns c where c.id=campaign_id and c.user_id=auth.uid()));
create policy "coupons owner or merchant read" on public.coupons for select using
  (owner_id=auth.uid() or public.is_admin() or exists(select 1 from public.campaigns c where c.id=campaign_id and c.user_id=auth.uid())
    or exists(select 1 from public.coupon_trades t where t.offered_coupon_id=id and t.status='open'));
create policy "coupon transactions scoped read" on public.coupon_transactions for select using
  (actor_id=auth.uid() or from_owner_id=auth.uid() or to_owner_id=auth.uid() or public.is_admin());
create policy "coupon trades public read" on public.coupon_trades for select using (status='open' or offered_by=auth.uid() or accepted_by=auth.uid() or public.is_admin());
create policy "dividend merchant read" on public.dividend_coupons for select using
  (issuer_id=auth.uid() or public.is_admin());
create policy "sales scoped read" on public.restaurant_monthly_sales for select using
  (public.is_admin() or exists(select 1 from public.businesses b where b.id=business_id and (b.user_id=auth.uid() or b.verification_status='verified')));
create policy "ai contents public read" on public.ai_contents for select using (is_published or public.is_admin());
create policy "thematic funds public read" on public.thematic_funds for select using (is_active or public.is_admin());
create policy "thematic links public read" on public.thematic_fund_restaurants for select using (true);

revoke all on public.fund_policies,public.investments,public.investment_reservations,public.withdrawal_requests,
  public.matching_transactions,public.coupons,public.coupon_transactions,public.coupon_trades,public.dividend_coupons,
  public.restaurant_monthly_sales,public.ai_contents,public.thematic_funds,public.thematic_fund_restaurants from anon,authenticated;
grant select on public.fund_policies,public.ai_contents,public.thematic_funds,public.thematic_fund_restaurants to anon,authenticated;
grant select on public.investments,public.investment_reservations,public.withdrawal_requests,public.matching_transactions,
  public.coupons,public.coupon_transactions,public.coupon_trades,public.dividend_coupons,public.restaurant_monthly_sales to authenticated;
grant execute on function public.policy_number(text,numeric) to authenticated;
grant execute on function public.invest_fund(uuid,bigint,boolean) to authenticated;
grant execute on function public.withdraw_fund(uuid,bigint) to authenticated;
grant execute on function public.close_fund(uuid) to authenticated;
grant execute on function public.issue_accrued_coupon(uuid) to authenticated;
grant execute on function public.use_coupon(uuid,bigint) to authenticated;
grant execute on function public.issue_dividend_coupon(uuid,text,text,text,numeric,text) to authenticated;
grant execute on function public.record_monthly_sales(uuid,date,bigint,bigint,bigint,integer) to authenticated;
grant execute on function public.create_coupon_trade(uuid) to authenticated;
grant execute on function public.accept_coupon_trade(uuid,uuid) to authenticated;

-- 모집 전 재무자료 검증: 입력값은 주장으로 저장되고 OCR 교차검증·운영자 승인 후 공식화된다.
create table if not exists public.financial_verification_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  claimed_metrics jsonb not null default '{}', document_results jsonb not null default '[]',
  orchestration jsonb not null default '{}', model text not null default '',
  status text not null default 'needs_documents'
    check (status in ('needs_documents','mismatch','ready_for_admin','approved','rejected')),
  review_note text not null default '', reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists financial_verification_queue_idx on public.financial_verification_runs(status,created_at desc);
alter table public.business_metrics add column if not exists verification_status text not null default 'owner_claimed';
alter table public.business_metrics add column if not exists verification_run_id uuid references public.financial_verification_runs(id) on delete set null;
alter table public.business_metrics add column if not exists verified_by uuid references public.profiles(id) on delete set null;
alter table public.business_metrics add column if not exists verified_at timestamptz;
alter table public.business_metrics drop constraint if exists business_metrics_verification_status_check;
alter table public.business_metrics add constraint business_metrics_verification_status_check
  check (verification_status in ('owner_claimed','ai_reviewed','approved','rejected'));
alter table public.credit_assessments add column if not exists verification_run_id uuid references public.financial_verification_runs(id) on delete set null;

create or replace function public.guard_business_metrics_verification()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then
    new.verification_status:='owner_claimed'; new.verification_run_id:=null;
    new.verified_by:=null; new.verified_at:=null;
    if tg_op='UPDATE' then
      update public.credit_assessments set is_official=false where business_id=new.business_id and is_official;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_business_metrics_verification_trigger on public.business_metrics;
create trigger guard_business_metrics_verification_trigger before insert or update on public.business_metrics
for each row execute function public.guard_business_metrics_verification();

create or replace function public.review_financial_verification(p_run_id uuid,p_decision text,p_note text default '')
returns public.financial_verification_runs language plpgsql security definer set search_path=public as $$
declare r public.financial_verification_runs; m public.business_metrics;
begin
  if not public.is_admin() then raise exception '운영자 권한이 필요합니다.'; end if;
  if p_decision not in ('approved','rejected') then raise exception '지원하지 않는 검증 결정입니다.'; end if;
  select * into r from public.financial_verification_runs where id=p_run_id for update;
  if r.id is null or r.status not in ('ready_for_admin','mismatch','needs_documents','rejected') then raise exception '검토 가능한 재무 검증을 찾을 수 없습니다.'; end if;
  select * into m from public.business_metrics where business_id=r.business_id for update;
  if m.business_id is null then raise exception '재무 입력값을 찾을 수 없습니다.'; end if;
  if m.updated_at>r.created_at then raise exception '검증 후 재무 입력값이 변경되었습니다. 새 검증이 필요합니다.'; end if;
  if p_decision='approved' and coalesce((r.orchestration->>'readyForAdminReview')::boolean,false) is not true then
    raise exception '필수 문서 누락 또는 불일치가 있어 승인할 수 없습니다.';
  end if;
  update public.financial_verification_runs set status=p_decision,review_note=trim(coalesce(p_note,'')),
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=r.id returning * into r;
  update public.business_metrics set verification_status=p_decision,verification_run_id=r.id,
    verified_by=auth.uid(),verified_at=case when p_decision='approved' then now() else null end where business_id=r.business_id;
  update public.credit_assessments set is_official=false where business_id=r.business_id;
  if p_decision='approved' then
    update public.credit_assessments set is_official=true,verification_run_id=r.id
    where id=(select id from public.credit_assessments where business_id=r.business_id order by created_at desc limit 1);
  end if;
  insert into public.audit_events(actor_user_id,action,entity_type,entity_id,detail)
    values(auth.uid(),'financial_verification_'||p_decision,'financial_verification',r.id::text,jsonb_build_object('note',p_note));
  return r;
end;
$$;
alter table public.financial_verification_runs enable row level security;
drop policy if exists "financial verification scoped read" on public.financial_verification_runs;
drop policy if exists "financial verification owner insert" on public.financial_verification_runs;
create policy "financial verification scoped read" on public.financial_verification_runs for select using (user_id=auth.uid() or public.is_admin());
create policy "financial verification owner insert" on public.financial_verification_runs for insert with check
  (user_id=auth.uid() and exists(select 1 from public.businesses b where b.id=business_id and b.user_id=auth.uid()));
revoke all on public.financial_verification_runs from anon,authenticated;
grant select on public.financial_verification_runs to authenticated;
grant execute on function public.review_financial_verification(uuid,text,text) to authenticated;

-- 역할별 PostgreSQL Property Graph. 서비스 원장과 같은 DB에서 출처·검증 상태를 보존한다.
create table if not exists public.knowledge_nodes (
  id text primary key, role_scope text not null check (role_scope in ('shared','investor','owner')),
  business_id uuid references public.businesses(id) on delete cascade, node_type text not null, label text not null,
  properties jsonb not null default '{}', source_ref text not null default 'MOA_SERVICE_POLICY',
  verification_status text not null default 'policy_verified', updated_at timestamptz not null default now()
);
alter table public.knowledge_nodes add column if not exists role_scope text not null default 'shared';
alter table public.knowledge_nodes add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.knowledge_nodes add column if not exists node_type text not null default 'GuideStep';
alter table public.knowledge_nodes add column if not exists label text not null default '';
alter table public.knowledge_nodes add column if not exists properties jsonb not null default '{}';
alter table public.knowledge_nodes add column if not exists source_ref text not null default 'MOA_SERVICE_POLICY';
alter table public.knowledge_nodes add column if not exists verification_status text not null default 'policy_verified';
alter table public.knowledge_nodes add column if not exists updated_at timestamptz not null default now();
alter table public.knowledge_nodes drop constraint if exists knowledge_nodes_role_scope_check;
alter table public.knowledge_nodes add constraint knowledge_nodes_role_scope_check check (role_scope in ('shared','investor','owner'));

create table if not exists public.knowledge_edges (
  id text primary key, role_scope text not null check (role_scope in ('shared','investor','owner')),
  business_id uuid references public.businesses(id) on delete cascade,
  source_node_id text not null references public.knowledge_nodes(id) on delete cascade,
  target_node_id text not null references public.knowledge_nodes(id) on delete cascade,
  relation_type text not null, evidence_refs jsonb not null default '[]',
  confidence numeric not null default 1 check (confidence between 0 and 1), updated_at timestamptz not null default now()
);
alter table public.knowledge_edges add column if not exists role_scope text not null default 'shared';
alter table public.knowledge_edges add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.knowledge_edges add column if not exists evidence_refs jsonb not null default '[]';
alter table public.knowledge_edges add column if not exists confidence numeric not null default 1;
alter table public.knowledge_edges add column if not exists updated_at timestamptz not null default now();
alter table public.knowledge_edges drop constraint if exists knowledge_edges_role_scope_check;
alter table public.knowledge_edges drop constraint if exists knowledge_edges_confidence_check;
alter table public.knowledge_edges add constraint knowledge_edges_role_scope_check check (role_scope in ('shared','investor','owner'));
alter table public.knowledge_edges add constraint knowledge_edges_confidence_check check (confidence between 0 and 1);

create index if not exists knowledge_nodes_scope_idx on public.knowledge_nodes(role_scope,business_id,node_type);
create index if not exists knowledge_edges_scope_idx on public.knowledge_edges(role_scope,business_id,relation_type);
insert into public.knowledge_nodes(id,role_scope,node_type,label,properties) values
('investor:start','investor','GuideStep','투자 시작','{"order":1,"instruction":"투자자 계정으로 로그인하고 공개 모집을 탐색합니다."}'),
('investor:review','investor','GuideStep','사업과 위험 검토','{"order":2,"instruction":"공식 재무검증, 상권, 위험과 지급조건을 확인합니다."}'),
('investor:commit','investor','GuideStep','위험 동의 후 참여','{"order":3,"instruction":"한도와 단위 안에서 참여하고 예치 상태를 확인합니다."}'),
('investor:monitor','investor','GuideStep','모집·집행 추적','{"order":4,"instruction":"중요 변경과 마일스톤 증빙·지급을 추적합니다."}'),
('investor:exit','investor','GuideStep','회수 요청','{"order":5,"instruction":"종료 후에는 신규 예약과 FIFO 매칭을 기다립니다."}'),
('owner:business','owner','GuideStep','사업체·대표자 등록','{"order":1,"instruction":"사업자번호, 대표자, 영업신고와 주소를 등록합니다."}'),
('owner:claims','owner','GuideStep','재무 수치 주장 입력','{"order":2,"instruction":"입력값은 검증 전 사업자 주장으로 저장됩니다."}'),
('owner:documents','owner','GuideStep','근거자료 업로드','{"order":3,"instruction":"POS·카드매출, 부채, 납세 자료를 업로드합니다."}'),
('owner:orchestration','owner','GuideStep','AI 교차검증','{"order":4,"instruction":"OCR 추출 후 식별값·기간·금액·중복을 대조합니다."}'),
('owner:adminReview','owner','GuideStep','운영자 원본 확인','{"order":5,"instruction":"운영자 승인 후에만 공식 심사로 승격됩니다."}'),
('owner:campaign','owner','GuideStep','모집안·공시 작성','{"order":6,"instruction":"목표, 용도, 위험, 공시와 지급단계를 작성합니다."}')
on conflict(id) do update set properties=excluded.properties,label=excluded.label,updated_at=now();
insert into public.knowledge_edges(id,role_scope,source_node_id,target_node_id,relation_type) values
('investor:start-review','investor','investor:start','investor:review','NEXT'),
('investor:review-commit','investor','investor:review','investor:commit','NEXT'),
('investor:commit-monitor','investor','investor:commit','investor:monitor','NEXT'),
('investor:monitor-exit','investor','investor:monitor','investor:exit','NEXT'),
('owner:business-claims','owner','owner:business','owner:claims','NEXT'),
('owner:claims-documents','owner','owner:claims','owner:documents','REQUIRES'),
('owner:documents-orchestration','owner','owner:documents','owner:orchestration','VERIFIED_BY'),
('owner:orchestration-review','owner','owner:orchestration','owner:adminReview','REVIEWED_BY'),
('owner:review-campaign','owner','owner:adminReview','owner:campaign','UNLOCKS')
on conflict(id) do update set relation_type=excluded.relation_type,updated_at=now();
create or replace function public.role_knowledge_graph(p_role text,p_business_id uuid default null)
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object('role',p_role,
    'nodes',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from public.knowledge_nodes n where n.role_scope in ('shared',p_role) and (n.business_id is null or n.business_id=p_business_id)),'[]'::jsonb),
    'edges',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.knowledge_edges e where e.role_scope in ('shared',p_role) and (e.business_id is null or e.business_id=p_business_id)),'[]'::jsonb)
  ) where p_role in ('investor','owner');
$$;
alter table public.knowledge_nodes enable row level security;
alter table public.knowledge_edges enable row level security;
drop policy if exists "knowledge nodes scoped read" on public.knowledge_nodes;
drop policy if exists "knowledge edges scoped read" on public.knowledge_edges;
create policy "knowledge nodes scoped read" on public.knowledge_nodes for select using
  (business_id is null or public.is_admin() or exists(select 1 from public.businesses b where b.id=business_id and (b.user_id=auth.uid() or b.verification_status='verified')));
create policy "knowledge edges scoped read" on public.knowledge_edges for select using
  (business_id is null or public.is_admin() or exists(select 1 from public.businesses b where b.id=business_id and (b.user_id=auth.uid() or b.verification_status='verified')));
revoke all on public.knowledge_nodes,public.knowledge_edges from anon,authenticated;
grant select on public.knowledge_nodes,public.knowledge_edges to anon,authenticated;
grant execute on function public.role_knowledge_graph(text,uuid) to anon,authenticated;

commit;
