-- ============================================================================
-- Cloud SQL 호환 레이어.
--
-- db/ 아래 SQL 은 Supabase 를 전제로 쓰였다. Supabase 가 기본으로 제공하던 것 중
-- 스키마가 실제로 의존하는 것은 딱 두 가지다.
--   · 롤 anon / authenticated / service_role  — grant 와 정책의 대상
--   · auth 스키마의 users 테이블과 uid() 함수 — profiles.auth_user_id 의 참조 대상
--
-- Cloud SQL 에는 이것들이 없다. 그래서 SQL 파일을 고치는 대신 없는 것을 여기서 만든다.
-- 스키마 파일 24개를 손대지 않아야 나중에 다시 옮길 때도 그대로 쓸 수 있다.
--
-- RLS 주의: 정책은 그대로 살아 있지만 force row level security 를 걸지 않았으므로
-- 테이블 소유자(서버가 접속하는 롤)는 RLS 를 우회한다. Supabase 에서 service_role 이
-- 하던 역할과 같다. 브라우저가 DB 에 직접 붙지 않는 구조라 노출면도 같다.
-- ============================================================================

create extension if not exists pgcrypto;

-- Supabase 가 만들어 주던 롤들. 로그인 불가로 만들어 권한 대상 이름으로만 쓴다.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'authenticator'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- profiles.auth_user_id 가 참조하는 대상. Supabase Auth 를 안 쓰면 비어 있게 된다.
-- 시연용 시드 계정은 원래도 auth_user_id 가 비어 있으므로 동작에 차이가 없다.
create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- 정책이 부르는 함수. 세션에 JWT 클레임이 없으면 null 이고,
-- 그때 정책은 "내 것"을 하나도 고르지 못해 아무 행도 통과시키지 않는다(안전한 기본값).
create or replace function auth.uid() returns uuid
  language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
