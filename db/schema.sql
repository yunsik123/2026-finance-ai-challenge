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
  verification_status text not null default 'unverified',
  verification_note text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.businesses add column if not exists verification_note text not null default '';
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
  if not exists(select 1 from public.credit_assessments where business_id = c.business_id) then
    raise exception '재무·위험 자료를 먼저 등록해 주세요.';
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

commit;
