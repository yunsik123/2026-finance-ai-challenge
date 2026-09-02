-- ============================================================================
-- 먹투 행 수준 보안(RLS)
--
-- 원칙
--   · 서버(service_role)는 RLS 를 우회한다. 투자·매칭·교환처럼 남의 행을 함께
--     바꿔야 하는 거래는 전부 db/functions.sql 의 RPC 안에서만 일어난다.
--   · 브라우저(anon/authenticated)에는 "내 것 읽기"와 공개 데이터만 연다.
--     쓰기는 관심 식당 정도의 무해한 것만 허용하고 나머지는 전부 막는다.
--   · 판단 기준은 auth.uid() 가 아니라 meoktu.current_profile_id() 다.
--     profiles.id 가 text 이고 auth.users.id 는 uuid 라서 한 단계 거친다.
--
-- 적용:  psql "$DATABASE_URL" -f db/policies.sql   (schema.sql 다음에)
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','wallet_transactions','restaurants','restaurant_sales','funds',
    'positions','orders','coupons','coupon_listings','coupon_offers','coupon_trades',
    'applications','ocr_analyses','data_connections','visit_verifications','reviews',
    'favorites','support_requests','notifications','audit_events',
    'articles','etf_funds','etf_members','ledger_meta'
  ] loop
    execute format('alter table meoktu.%I enable row level security', t);
    -- 기본은 전면 차단. 아래에서 필요한 것만 연다.
    execute format('revoke all on meoktu.%I from anon, authenticated', t);
  end loop;
end $$;

-- 정책을 다시 심을 수 있게 같은 이름이 있으면 지운다.
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'meoktu' loop
    execute format('drop policy %I on meoktu.%I', p.policyname, p.tablename);
  end loop;
end $$;

grant select on meoktu.restaurants, meoktu.restaurant_sales, meoktu.funds,
  meoktu.reviews, meoktu.articles, meoktu.etf_funds, meoktu.etf_members to anon, authenticated;
grant select on meoktu.profiles, meoktu.positions, meoktu.orders, meoktu.coupons,
  meoktu.coupon_listings, meoktu.coupon_offers, meoktu.coupon_trades, meoktu.applications,
  meoktu.ocr_analyses, meoktu.data_connections, meoktu.wallet_transactions,
  meoktu.visit_verifications, meoktu.support_requests, meoktu.notifications,
  meoktu.audit_events, meoktu.favorites to authenticated;
grant insert, delete on meoktu.favorites to authenticated;
grant update on meoktu.notifications to authenticated;


-- ── 회원 ────────────────────────────────────────────────────────────────────
-- 다른 사람의 이메일·잔액은 어떤 경우에도 브라우저로 나가지 않는다.
create policy profiles_select_self on meoktu.profiles
  for select to authenticated using (id = meoktu.current_profile_id());

create policy wallet_select_self on meoktu.wallet_transactions
  for select to authenticated using (user_id = meoktu.current_profile_id());


-- ── 식당·펀딩: 공개 데이터 ──────────────────────────────────────────────────
-- 심사를 통과한 식당은 로그인 없이도 보인다. 준비 중인 식당은 주인에게만 보인다.
create policy restaurants_select_public on meoktu.restaurants
  for select to anon, authenticated
  using (verification_status = 'verified' or owner_id = meoktu.current_profile_id());

-- 매출 차트는 사장님이 공개로 켠 식당만. 주인 본인은 항상 볼 수 있다.
create policy restaurant_sales_select on meoktu.restaurant_sales
  for select to anon, authenticated using (exists (
    select 1 from meoktu.restaurants r
    where r.id = restaurant_id
      and (r.sales_disclosure or r.owner_id = meoktu.current_profile_id())
  ));

create policy funds_select_public on meoktu.funds
  for select to anon, authenticated using (exists (
    select 1 from meoktu.restaurants r
    where r.id = restaurant_id
      and (r.verification_status = 'verified' or r.owner_id = meoktu.current_profile_id())
  ));

-- 식당 정보 수정은 주인만. 단, 소유권(owner_id)과 심사 상태는 스스로 못 바꾼다.
-- 그 두 값을 바꾸려면 심사 RPC 를 거쳐야 한다.
create policy restaurants_update_own on meoktu.restaurants
  for update to authenticated
  using (owner_id = meoktu.current_profile_id())
  with check (owner_id = meoktu.current_profile_id());


-- ── 투자·주문 ───────────────────────────────────────────────────────────────
-- 조회만 연다. 체결·회수는 잔액과 펀드 모금액을 같이 바꿔야 해서 RPC 전용이다.
create policy positions_select_self on meoktu.positions
  for select to authenticated using (user_id = meoktu.current_profile_id());

create policy orders_select_self on meoktu.orders
  for select to authenticated using (user_id = meoktu.current_profile_id());


-- ── 쿠폰·교환 ───────────────────────────────────────────────────────────────
create policy coupons_select_self on meoktu.coupons
  for select to authenticated using (user_id = meoktu.current_profile_id());

-- 교환장은 열린 매물이면 남의 것도 보여야 거래가 성립한다.
create policy coupon_listings_select on meoktu.coupon_listings
  for select to authenticated
  using (status = 'open' or user_id = meoktu.current_profile_id());

-- 제안은 당사자(제안자·매물 주인)에게만 보인다.
create policy coupon_offers_select on meoktu.coupon_offers
  for select to authenticated using (
    offer_user_id = meoktu.current_profile_id()
    or exists (select 1 from meoktu.coupon_listings l
               where l.id = listing_id and l.user_id = meoktu.current_profile_id())
  );

create policy coupon_trades_select on meoktu.coupon_trades
  for select to authenticated using (
    lister_user_id = meoktu.current_profile_id() or taker_user_id = meoktu.current_profile_id()
  );


-- ── 심사·증빙 ───────────────────────────────────────────────────────────────
-- 사업자·재무 자료는 남에게 절대 보이면 안 되는 신용정보다.
create policy applications_select_self on meoktu.applications
  for select to authenticated using (user_id = meoktu.current_profile_id());

create policy ocr_select_self on meoktu.ocr_analyses
  for select to authenticated using (user_id = meoktu.current_profile_id());

create policy data_connections_select_self on meoktu.data_connections
  for select to authenticated using (user_id = meoktu.current_profile_id());


-- ── 리뷰·관심·문의·알림·감사 ────────────────────────────────────────────────
create policy reviews_select_public on meoktu.reviews
  for select to anon, authenticated
  using (status = 'published' or user_id = meoktu.current_profile_id());

create policy visits_select_self on meoktu.visit_verifications
  for select to authenticated using (user_id = meoktu.current_profile_id());

-- 관심 식당은 부작용이 없어 브라우저가 직접 넣고 뺄 수 있게 열어둔다.
create policy favorites_select_self on meoktu.favorites
  for select to authenticated using (user_id = meoktu.current_profile_id());
create policy favorites_insert_self on meoktu.favorites
  for insert to authenticated with check (user_id = meoktu.current_profile_id());
create policy favorites_delete_self on meoktu.favorites
  for delete to authenticated using (user_id = meoktu.current_profile_id());

create policy support_select_self on meoktu.support_requests
  for select to authenticated using (user_id = meoktu.current_profile_id());

create policy notifications_select_self on meoktu.notifications
  for select to authenticated using (user_id = meoktu.current_profile_id());
-- 읽음 표시만 허용한다. 남의 알림을 내 것으로 옮기는 것은 with check 가 막는다.
create policy notifications_update_self on meoktu.notifications
  for update to authenticated
  using (user_id = meoktu.current_profile_id())
  with check (user_id = meoktu.current_profile_id());

create policy audit_select_self on meoktu.audit_events
  for select to authenticated using (actor_id = meoktu.current_profile_id());


-- ── 공개 콘텐츠 ─────────────────────────────────────────────────────────────
create policy articles_select_all on meoktu.articles for select to anon, authenticated using (true);
create policy etf_select_all on meoktu.etf_funds for select to anon, authenticated using (true);
create policy etf_members_select_all on meoktu.etf_members for select to anon, authenticated using (true);

-- ledger_meta 는 서버 전용이라 어떤 정책도 만들지 않는다(= 전면 차단).
