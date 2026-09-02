-- ============================================================================
-- app_state.data JSONB 원장 → meoktu 정규화 테이블 이관.
--
-- 원장 전체를 인자로 받아 한 트랜잭션에서 옮긴다. 중간에 실패하면 전부 되돌아가므로
-- "절반만 옮겨진" 상태가 생기지 않는다. 여러 번 돌려도 결과가 같다(멱등).
--
-- 참조 무결성이 성립하도록 부모 → 자식 순서로 넣고,
-- 원장에 남아 있지만 대상이 사라진 참조(예: 탈퇴한 사용자의 감사기록)는 null 로 눕힌다.
-- 그런 행을 통째로 버리면 분쟁 때 근거가 사라지기 때문이다.
-- ============================================================================

create or replace function meoktu.import_ledger(payload jsonb)
  returns jsonb language plpgsql security definer set search_path = meoktu, public as $fn$
declare v_report jsonb := '{}'::jsonb; v_n integer;
begin
  -- ── 회원 ────────────────────────────────────────────────────────────────
  insert into meoktu.profiles(id, auth_user_id, email, name, role, cash, account_status, password_hash, created_at)
  select x.id,
         -- Supabase Auth 로 가입한 사용자는 passwordHash 자리에 'supabase:<uuid>' 표식이 들어간다.
         -- RLS 는 auth.uid() 를 이 열과 맞춰 보므로 여기서 연결해 두지 않으면
         -- 정책이 항상 거짓이 되어 브라우저가 자기 데이터도 못 읽는다.
         -- auth.users 에 실제로 있는 id 만 넣는다(계정이 지워졌으면 FK 위반이 난다).
         (select u.id from auth.users u
           where x."passwordHash" like 'supabase:%'
             and u.id::text = substring(x."passwordHash" from 10)),
         x.email, x.name, x.role, greatest(coalesce(x.cash, 0), 0),
         coalesce(x."accountStatus", 'active'), x."passwordHash", coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'users', '[]'::jsonb)) as x(
      id text, email text, name text, role text, cash bigint,
      "accountStatus" text, "passwordHash" text, "createdAt" timestamptz)
  on conflict (id) do update set
    auth_user_id = coalesce(excluded.auth_user_id, meoktu.profiles.auth_user_id),
    email = excluded.email, name = excluded.name, role = excluded.role,
    cash = excluded.cash, account_status = excluded.account_status,
    password_hash = excluded.password_hash;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('profiles', v_n);

  -- ── 식당 ────────────────────────────────────────────────────────────────
  insert into meoktu.restaurants(
    id, owner_id, name, emoji, category, region, neighborhood, tagline, description,
    signature, story, color, tags, avg_price, max_menu_price, opened_years, monthly_sales,
    sales_growth, repeat_rate, foot_traffic_growth, competition, closing_rate, rating,
    review_count, supporters, community_score, stability_score, sales_disclosure,
    verification_status, food_description, dining_notes, strengths, menu_highlights)
  select x.id,
         -- 원장에 남아 있어도 계정이 없으면 소유자를 비운다(FK 위반 방지).
         (select p.id from meoktu.profiles p where p.id = x."ownerId"),
         x.name, coalesce(x.emoji, '🍽️'), x.category, x.region, coalesce(x.neighborhood, ''),
         coalesce(x.tagline, ''), coalesce(x.description, ''), coalesce(x.signature, ''),
         coalesce(x.story, ''), coalesce(x.color, '#ff6948'),
         coalesce(x.tags, '{}'), coalesce(x."avgPrice", 0), coalesce(x."maxMenuPrice", 0),
         coalesce(x."openedYears", 0), greatest(coalesce(x."monthlySales", 0), 0),
         coalesce(x."salesGrowth", 0), least(greatest(coalesce(x."repeatRate", 0), 0), 1),
         coalesce(x."footTrafficGrowth", 0), coalesce(x.competition, '보통'),
         coalesce(x."closingRate", 0), least(greatest(coalesce(x.rating, 0), 0), 5),
         coalesce(x."reviewCount", 0), coalesce(x.supporters, 0),
         coalesce(x."communityScore", 0), coalesce(x."stabilityScore", 0),
         coalesce(x."salesDisclosure", false),
         -- 기존 원장에는 심사 상태 개념이 없었다. 이미 노출 중인 식당이므로 verified 로 옮긴다.
         'verified',
         x."foodDescription", x."diningNotes", coalesce(x.strengths, '{}'),
         coalesce(x."menuHighlights", '[]'::jsonb)
    from jsonb_to_recordset(coalesce(payload->'restaurants', '[]'::jsonb)) as x(
      id text, "ownerId" text, name text, emoji text, category text, region text,
      neighborhood text, tagline text, description text, signature text, story text,
      color text, tags text[], "avgPrice" integer, "maxMenuPrice" integer,
      "openedYears" numeric, "monthlySales" bigint, "salesGrowth" numeric,
      "repeatRate" numeric, "footTrafficGrowth" numeric, competition text,
      "closingRate" numeric, rating numeric, "reviewCount" integer, supporters integer,
      "communityScore" integer, "stabilityScore" integer, "salesDisclosure" boolean,
      "foodDescription" text, "diningNotes" text, strengths text[], "menuHighlights" jsonb)
  on conflict (id) do update set
    name = excluded.name, monthly_sales = excluded.monthly_sales,
    sales_growth = excluded.sales_growth, repeat_rate = excluded.repeat_rate,
    rating = excluded.rating, review_count = excluded.review_count,
    supporters = excluded.supporters, sales_disclosure = excluded.sales_disclosure;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('restaurants', v_n);

  -- 12개월 매출 이력은 식당 문서 안에 배열로 들어 있어 행으로 펼친다.
  insert into meoktu.restaurant_sales(restaurant_id, month, sales, growth_rate, bonus_rate)
  select r->>'id', s->>'month', greatest((s->>'sales')::bigint, 0),
         coalesce((s->>'growthRate')::numeric, 0), coalesce((s->>'bonusRate')::numeric, 0)
    from jsonb_array_elements(coalesce(payload->'restaurants', '[]'::jsonb)) r
    cross join jsonb_array_elements(coalesce(r->'salesHistory', '[]'::jsonb)) s
   where s->>'month' is not null
  on conflict (restaurant_id, month) do update set
    sales = excluded.sales, growth_rate = excluded.growth_rate, bonus_rate = excluded.bonus_rate;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('restaurant_sales', v_n);

  -- ── 펀딩 ────────────────────────────────────────────────────────────────
  insert into meoktu.funds(
    id, restaurant_id, round, status, goal, raised, max_discount, min_issue_discount,
    daily_rate_per_100k, sales_bonus, early_bonus, purpose, investor_count,
    total_coupon_issued, total_coupon_used, open_buy_amount, open_sell_amount,
    risk_level, started_at, ends_at)
  select x.id, x."restaurantId", coalesce(x.round, 1), x.status, x.goal,
         least(greatest(coalesce(x.raised, 0), 0), x.goal), x."maxDiscount",
         coalesce(x."minIssueDiscount", 10), coalesce(x."dailyRatePer100k", 0),
         coalesce(x."salesBonus", 0), coalesce(x."earlyBonus", 0), coalesce(x.purpose, ''),
         coalesce(x."investorCount", 0), coalesce(x."totalCouponIssued", 0),
         coalesce(x."totalCouponUsed", 0), coalesce(x."openBuyAmount", 0),
         coalesce(x."openSellAmount", 0), coalesce(x."riskLevel", '보통'),
         x."startedAt", x."endsAt"
    from jsonb_to_recordset(coalesce(payload->'funds', '[]'::jsonb)) as x(
      id text, "restaurantId" text, round integer, status text, goal bigint, raised bigint,
      "maxDiscount" numeric, "minIssueDiscount" numeric, "dailyRatePer100k" numeric,
      "salesBonus" numeric, "earlyBonus" numeric, purpose text, "investorCount" integer,
      "totalCouponIssued" bigint, "totalCouponUsed" bigint, "openBuyAmount" bigint,
      "openSellAmount" bigint, "riskLevel" text, "startedAt" timestamptz, "endsAt" timestamptz)
   where exists (select 1 from meoktu.restaurants r where r.id = x."restaurantId")
  on conflict (id) do update set
    status = excluded.status, raised = excluded.raised,
    investor_count = excluded.investor_count,
    total_coupon_issued = excluded.total_coupon_issued,
    total_coupon_used = excluded.total_coupon_used;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('funds', v_n);

  insert into meoktu.positions(id, user_id, fund_id, amount, early, coupon_progress, updated_at)
  select x.id, x."userId", x."fundId", greatest(coalesce(x.amount, 0), 0),
         coalesce(x.early, false), greatest(coalesce(x."couponProgress", 0), 0),
         coalesce(x."updatedAt", now())
    from jsonb_to_recordset(coalesce(payload->'positions', '[]'::jsonb)) as x(
      id text, "userId" text, "fundId" text, amount bigint, early boolean,
      "couponProgress" numeric, "updatedAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
     and exists (select 1 from meoktu.funds f where f.id = x."fundId")
  on conflict (user_id, fund_id) do update set
    amount = excluded.amount, coupon_progress = excluded.coupon_progress,
    early = excluded.early, updated_at = excluded.updated_at;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('positions', v_n);

  insert into meoktu.orders(id, user_id, fund_id, type, original_amount, remaining, status, created_at)
  select x.id, x."userId", x."fundId", x.type, x."originalAmount",
         least(coalesce(x.remaining, 0), x."originalAmount"), x.status, coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'orders', '[]'::jsonb)) as x(
      id text, "userId" text, "fundId" text, type text, "originalAmount" bigint,
      remaining bigint, status text, "createdAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
     and exists (select 1 from meoktu.funds f where f.id = x."fundId")
  on conflict (id) do update set remaining = excluded.remaining, status = excluded.status;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('orders', v_n);

  -- ── 쿠폰과 교환 ─────────────────────────────────────────────────────────
  insert into meoktu.coupons(
    id, user_id, restaurant_id, fund_id, title, discount, max_discount_won, type, status,
    acquired_from_user_id, acquired_at, redeem_code, redeem_requested_at,
    used_at, used_at_restaurant_id, expires_at, created_at)
  select x.id, x."userId", x."restaurantId",
         (select f.id from meoktu.funds f where f.id = x."fundId"),
         x.title, x.discount, greatest(coalesce(x."maxDiscountWon", 0), 0), x.type, x.status,
         (select p.id from meoktu.profiles p where p.id = x."acquiredFromUserId"),
         x."acquiredAt", x."redeemCode", x."redeemRequestedAt", x."usedAt",
         (select r.id from meoktu.restaurants r where r.id = x."usedAtRestaurantId"),
         x."expiresAt", coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'coupons', '[]'::jsonb)) as x(
      id text, "userId" text, "restaurantId" text, "fundId" text, title text,
      discount numeric, "maxDiscountWon" bigint, type text, status text,
      "acquiredFromUserId" text, "acquiredAt" timestamptz, "redeemCode" text,
      "redeemRequestedAt" timestamptz, "usedAt" timestamptz, "usedAtRestaurantId" text,
      "expiresAt" timestamptz, "createdAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
     and exists (select 1 from meoktu.restaurants r where r.id = x."restaurantId")
  on conflict (id) do update set
    user_id = excluded.user_id, status = excluded.status,
    acquired_from_user_id = excluded.acquired_from_user_id, acquired_at = excluded.acquired_at,
    redeem_code = excluded.redeem_code, used_at = excluded.used_at;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('coupons', v_n);

  insert into meoktu.coupon_listings(
    id, user_id, coupon_id, wanted_categories, wanted_regions, min_discount,
    auto_accept, note, status, completed_with_user_id, completed_at, expires_at, created_at)
  select x.id, x."userId", x."couponId",
         coalesce(x."wantedCategories", '{}'), coalesce(x."wantedRegions", '{}'),
         greatest(coalesce(x."minDiscount", 0), 0), coalesce(x."autoAccept", true),
         coalesce(x.note, ''), x.status,
         (select p.id from meoktu.profiles p where p.id = x."completedWithUserId"),
         x."completedAt", coalesce(x."expiresAt", now() + interval '30 days'),
         coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'couponListings', '[]'::jsonb)) as x(
      id text, "userId" text, "couponId" text, "wantedCategories" text[],
      "wantedRegions" text[], "minDiscount" numeric, "autoAccept" boolean, note text,
      status text, "completedWithUserId" text, "completedAt" timestamptz,
      "expiresAt" timestamptz, "createdAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
     and exists (select 1 from meoktu.coupons c where c.id = x."couponId")
  on conflict (id) do update set status = excluded.status, completed_at = excluded.completed_at;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('coupon_listings', v_n);

  insert into meoktu.coupon_offers(
    id, listing_id, offer_user_id, offer_coupon_id, message, status, resolved_at, created_at)
  select x.id, x."listingId", x."offerUserId", x."offerCouponId", coalesce(x.message, ''),
         x.status, x."resolvedAt", coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'couponOffers', '[]'::jsonb)) as x(
      id text, "listingId" text, "offerUserId" text, "offerCouponId" text, message text,
      status text, "resolvedAt" timestamptz, "createdAt" timestamptz)
   where exists (select 1 from meoktu.coupon_listings l where l.id = x."listingId")
     and exists (select 1 from meoktu.coupons c where c.id = x."offerCouponId")
     and exists (select 1 from meoktu.profiles p where p.id = x."offerUserId")
  on conflict (id) do update set status = excluded.status, resolved_at = excluded.resolved_at;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('coupon_offers', v_n);

  insert into meoktu.coupon_trades(
    id, listing_id, offer_id, mode, lister_user_id, lister_coupon_id,
    lister_gave_discount, lister_gave_value_won, taker_user_id, taker_coupon_id,
    taker_gave_discount, taker_gave_value_won, created_at)
  select x.id, x."listingId",
         (select o.id from meoktu.coupon_offers o where o.id = x."offerId"),
         x.mode, x."listerUserId", x."listerCouponId",
         coalesce(x."listerGaveDiscount", 0), coalesce(x."listerGaveValueWon", 0),
         x."takerUserId", x."takerCouponId",
         coalesce(x."takerGaveDiscount", 0), coalesce(x."takerGaveValueWon", 0),
         coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'couponTrades', '[]'::jsonb)) as x(
      id text, "listingId" text, "offerId" text, mode text, "listerUserId" text,
      "listerCouponId" text, "listerGaveDiscount" numeric, "listerGaveValueWon" bigint,
      "takerUserId" text, "takerCouponId" text, "takerGaveDiscount" numeric,
      "takerGaveValueWon" bigint, "createdAt" timestamptz)
   where exists (select 1 from meoktu.coupon_listings l where l.id = x."listingId")
     and exists (select 1 from meoktu.profiles p where p.id = x."listerUserId")
     and exists (select 1 from meoktu.profiles p where p.id = x."takerUserId")
     and exists (select 1 from meoktu.coupons c where c.id = x."listerCouponId")
     and exists (select 1 from meoktu.coupons c where c.id = x."takerCouponId")
     and x."listerUserId" <> x."takerUserId"
  on conflict (id) do nothing;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('coupon_trades', v_n);

  -- ── 심사·증빙 ───────────────────────────────────────────────────────────
  insert into meoktu.applications(
    id, user_id, restaurant_name, status, requested_limit, approved_limit, score,
    strengths, checks, improvements, explanation, data, submitted_at)
  select x.id, x."userId", x."restaurantName", x.status,
         greatest(coalesce(x."requestedLimit", 0), 0), greatest(coalesce(x."approvedLimit", 0), 0),
         coalesce(x.score, 0), coalesce(x.strengths, '{}'), coalesce(x.checks, '{}'),
         coalesce(x.improvements, '{}'), coalesce(x.explanation, ''),
         coalesce(x.data, '{}'::jsonb), coalesce(x."submittedAt", now())
    from jsonb_to_recordset(coalesce(payload->'applications', '[]'::jsonb)) as x(
      id text, "userId" text, "restaurantName" text, status text, "requestedLimit" bigint,
      "approvedLimit" bigint, score numeric, strengths text[], checks text[],
      improvements text[], explanation text, data jsonb, "submittedAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
  on conflict (id) do update set status = excluded.status, data = excluded.data;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('applications', v_n);

  insert into meoktu.ocr_analyses(id, user_id, filename, source_id, plan, result, model, status, created_at)
  select x.id, x."userId", x.filename, x."sourceId", coalesce(x.plan, ''),
         coalesce(x.result, '{}'::jsonb), x.model, x.status, coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'ocrAnalyses', '[]'::jsonb)) as x(
      id text, "userId" text, filename text, "sourceId" text, plan text, result jsonb,
      model text, status text, "createdAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
  on conflict (id) do nothing;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('ocr_analyses', v_n);

  insert into meoktu.data_connections(
    id, user_id, source_id, provider, status, consent_scope, record_count, connected_at, last_synced_at)
  select x.id, x."userId", x."sourceId", x.provider, coalesce(x.status, 'active'),
         coalesce(x."consentScope", ''), greatest(coalesce(x."recordCount", 0), 0),
         coalesce(x."connectedAt", now()), coalesce(x."lastSyncedAt", now())
    from jsonb_to_recordset(coalesce(payload->'dataConnections', '[]'::jsonb)) as x(
      id text, "userId" text, "sourceId" text, provider text, status text,
      "consentScope" text, "recordCount" bigint, "connectedAt" timestamptz, "lastSyncedAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
  on conflict (user_id, source_id) do update set
    status = excluded.status, record_count = excluded.record_count,
    last_synced_at = excluded.last_synced_at;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('data_connections', v_n);

  -- ── 리뷰·관심·문의·알림·감사 ────────────────────────────────────────────
  insert into meoktu.visit_verifications(id, restaurant_id, user_id, verified_at, used_for_review)
  select x.id, x."restaurantId", x."userId", coalesce(x."verifiedAt", now()),
         coalesce(x."usedForReview", false)
    from jsonb_to_recordset(coalesce(payload->'visitVerifications', '[]'::jsonb)) as x(
      id text, "restaurantId" text, "userId" text, "verifiedAt" timestamptz, "usedForReview" boolean)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
     and exists (select 1 from meoktu.restaurants r where r.id = x."restaurantId")
  on conflict (id) do update set used_for_review = excluded.used_for_review;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('visit_verifications', v_n);

  insert into meoktu.reviews(id, restaurant_id, user_id, user_name, rating, content, visit_verified, status, created_at)
  select x.id, x."restaurantId",
         -- 계정이 없는 시연 리뷰어는 참조를 비우고 본문은 살린다.
         (select p.id from meoktu.profiles p where p.id = x."userId"), x."userName",
         least(greatest(coalesce(x.rating, 3), 1), 5), x.content,
         coalesce(x."visitVerified", false), coalesce(x.status, 'published'),
         coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'reviews', '[]'::jsonb)) as x(
      id text, "restaurantId" text, "userId" text, "userName" text, rating integer,
      content text, "visitVerified" boolean, status text, "createdAt" timestamptz)
   where exists (select 1 from meoktu.restaurants r where r.id = x."restaurantId")
     and char_length(coalesce(x.content, '')) >= 10
  on conflict (id) do update set status = excluded.status;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('reviews', v_n);

  insert into meoktu.favorites(user_id, restaurant_id, created_at)
  select x."userId", x."restaurantId", coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'favorites', '[]'::jsonb)) as x(
      "userId" text, "restaurantId" text, "createdAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
     and exists (select 1 from meoktu.restaurants r where r.id = x."restaurantId")
  on conflict (user_id, restaurant_id) do nothing;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('favorites', v_n);

  insert into meoktu.support_requests(
    id, user_id, user_name, type, subject, description, restaurant_id,
    priority, status, answer, created_at, answered_at)
  select x.id, x."userId", x."userName", x.type, x.subject, x.description,
         (select r.id from meoktu.restaurants r where r.id = x."restaurantId"),
         coalesce(x.priority, 'normal'), coalesce(x.status, 'received'), x.answer,
         coalesce(x."createdAt", now()), x."answeredAt"
    from jsonb_to_recordset(coalesce(payload->'supportRequests', '[]'::jsonb)) as x(
      id text, "userId" text, "userName" text, type text, subject text, description text,
      "restaurantId" text, priority text, status text, answer text,
      "createdAt" timestamptz, "answeredAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
  on conflict (id) do update set status = excluded.status, answer = excluded.answer;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('support_requests', v_n);

  insert into meoktu.notifications(id, user_id, type, title, body, link, read, created_at)
  select x.id, x."userId", x.type, x.title, x.body, x.link, coalesce(x.read, false),
         coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'notifications', '[]'::jsonb)) as x(
      id text, "userId" text, type text, title text, body text, link text,
      read boolean, "createdAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
  on conflict (id) do update set read = excluded.read;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('notifications', v_n);

  -- 감사기록은 행위자가 사라져도 버리지 않는다. 분쟁의 유일한 근거이기 때문이다.
  insert into meoktu.audit_events(id, actor_id, action, resource_type, resource_id, summary, created_at)
  select x.id, (select p.id from meoktu.profiles p where p.id = x."actorId"),
         x.action, x."resourceType", x."resourceId", coalesce(x.summary, ''),
         coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'auditEvents', '[]'::jsonb)) as x(
      id text, "actorId" text, action text, "resourceType" text, "resourceId" text,
      summary text, "createdAt" timestamptz)
  on conflict (id) do nothing;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('audit_events', v_n);

  insert into meoktu.wallet_transactions(id, user_id, type, amount, created_at)
  select x.id, x."userId", x.type, x.amount, coalesce(x."createdAt", now())
    from jsonb_to_recordset(coalesce(payload->'walletTransactions', '[]'::jsonb)) as x(
      id text, "userId" text, type text, amount bigint, "createdAt" timestamptz)
   where exists (select 1 from meoktu.profiles p where p.id = x."userId")
  on conflict (id) do nothing;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('wallet_transactions', v_n);

  -- ── 공개 콘텐츠 ─────────────────────────────────────────────────────────
  insert into meoktu.articles(id, eyebrow, title, summary, content, tags, icon, source_name, source_url, data_note, published_at)
  select x.id, coalesce(x.eyebrow, ''), x.title, coalesce(x.summary, ''), coalesce(x.content, ''),
         coalesce(x.tags, '{}'), coalesce(x.icon, ''), x."sourceName", x."sourceUrl",
         x."dataNote", coalesce(x."publishedAt", now())
    from jsonb_to_recordset(coalesce(payload->'articles', '[]'::jsonb)) as x(
      id text, eyebrow text, title text, summary text, content text, tags text[],
      icon text, "sourceName" text, "sourceUrl" text, "dataNote" text, "publishedAt" timestamptz)
  on conflict (id) do update set title = excluded.title, content = excluded.content;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('articles', v_n);

  insert into meoktu.etf_funds(id, name, emoji, region, category, minimum, max_discount, growth, members, description)
  select x.id, x.name, coalesce(x.emoji, ''), coalesce(x.region, ''), coalesce(x.category, ''),
         greatest(coalesce(x.minimum, 0), 0), coalesce(x."maxDiscount", 0),
         coalesce(x.growth, 0), greatest(coalesce(x.members, 0), 0), coalesce(x.description, '')
    from jsonb_to_recordset(coalesce(payload->'etfs', '[]'::jsonb)) as x(
      id text, name text, emoji text, region text, category text, minimum bigint,
      "maxDiscount" numeric, growth numeric, members integer, description text)
  on conflict (id) do update set members = excluded.members, growth = excluded.growth;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('etf_funds', v_n);

  insert into meoktu.etf_members(etf_id, restaurant_id)
  select e->>'id', rid
    from jsonb_array_elements(coalesce(payload->'etfs', '[]'::jsonb)) e
    cross join lateral jsonb_array_elements_text(coalesce(e->'restaurantIds', '[]'::jsonb)) rid
   where exists (select 1 from meoktu.restaurants r where r.id = rid)
     and exists (select 1 from meoktu.etf_funds f where f.id = e->>'id')
  on conflict (etf_id, restaurant_id) do nothing;
  get diagnostics v_n = row_count; v_report := v_report || jsonb_build_object('etf_members', v_n);

  return v_report;
end $fn$;
