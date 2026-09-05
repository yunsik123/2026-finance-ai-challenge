-- ============================================================================
-- 원장 입출력.
--
-- 서버(server/store.ts)는 지금까지 app_state.data JSONB 한 덩어리를 통째로
-- 읽고 썼다. 여기서는 같은 모양의 JSON 을 정규화 테이블 24개에서 조립해 주고,
-- 반대로 받아서 테이블에 반영한다.
--
-- 이렇게 하면 라우트 53개를 건드리지 않고도 데이터가 실제 테이블에 산다.
-- FK·CHECK 제약이 걸리고, RLS 를 적용할 수 있고, SQL 로 조회할 수 있다.
-- (개별 라우트를 테이블 질의로 바꾸는 것은 그다음 단계다.)
--
-- 적용: npm run db:apply  (schema.sql · import.sql 다음)
-- ============================================================================

/** timestamptz → 앱이 쓰던 '...Z' 형식 문자열. 형식이 바뀌면 비교하는 코드가 깨진다. */
create or replace function meoktu.iso(ts timestamptz) returns text
  language sql immutable as $$
  select case when ts is null then null
    else to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
$$;

/** 빈 배열이면 null 을 주는 헬퍼. 원래 원장이 선택 필드를 아예 비워 두던 것과 맞춘다. */
create or replace function meoktu.arr(items text[]) returns jsonb
  language sql immutable as $$ select to_jsonb(coalesce(items, '{}')) $$;


/**
 * 정규화 테이블 → 원장 JSON.
 * 키 이름과 타입은 server/types.ts 의 Database 와 정확히 같아야 한다.
 */
create or replace function meoktu.export_ledger()
  returns jsonb language sql stable security definer set search_path = meoktu, public as $$
  select jsonb_build_object(
    'schemaVersion', 5,

    'users', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', p.id, 'email', p.email, 'name', p.name, 'role', p.role,
        'passwordHash', p.password_hash, 'cash', p.cash,
        'accountStatus', p.account_status, 'createdAt', meoktu.iso(p.created_at)
      )) order by p.created_at, p.id) from meoktu.profiles p), '[]'::jsonb),

    'restaurants', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', r.id, 'ownerId', r.owner_id, 'name', r.name, 'emoji', r.emoji,
        'category', r.category, 'region', r.region, 'neighborhood', r.neighborhood,
        'tagline', r.tagline, 'description', r.description, 'signature', r.signature,
        'story', r.story, 'color', r.color, 'tags', meoktu.arr(r.tags),
        'avgPrice', r.avg_price, 'maxMenuPrice', r.max_menu_price,
        'openedYears', r.opened_years, 'monthlySales', r.monthly_sales,
        'salesGrowth', r.sales_growth, 'repeatRate', r.repeat_rate,
        'footTrafficGrowth', r.foot_traffic_growth, 'competition', r.competition,
        'closingRate', r.closing_rate, 'rating', r.rating, 'reviewCount', r.review_count,
        'supporters', r.supporters, 'communityScore', r.community_score,
        'stabilityScore', r.stability_score, 'salesDisclosure', r.sales_disclosure,
        'verificationStatus', r.verification_status, 'sourceApplicationId', r.source_application_id,
        'foodDescription', r.food_description, 'diningNotes', r.dining_notes,
        'strengths', meoktu.arr(r.strengths), 'menuHighlights', r.menu_highlights,
        'salesHistory', coalesce((select jsonb_agg(jsonb_build_object(
            'month', s.month, 'sales', s.sales,
            'growthRate', s.growth_rate, 'bonusRate', s.bonus_rate) order by s.month)
          from meoktu.restaurant_sales s where s.restaurant_id = r.id), '[]'::jsonb)
      )) order by r.created_at, r.id) from meoktu.restaurants r), '[]'::jsonb),

    'funds', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'restaurantId', f.restaurant_id, 'round', f.round, 'status', f.status,
        'goal', f.goal, 'raised', f.raised, 'maxDiscount', f.max_discount,
        'minIssueDiscount', f.min_issue_discount, 'dailyRatePer100k', f.daily_rate_per_100k,
        'salesBonus', f.sales_bonus, 'earlyBonus', f.early_bonus,
        'startedAt', meoktu.iso(f.started_at), 'endsAt', meoktu.iso(f.ends_at),
        'purpose', f.purpose, 'investorCount', f.investor_count,
        'totalCouponIssued', f.total_coupon_issued, 'totalCouponUsed', f.total_coupon_used,
        'openBuyAmount', f.open_buy_amount, 'openSellAmount', f.open_sell_amount,
        'riskLevel', f.risk_level
      ) order by f.created_at, f.id) from meoktu.funds f), '[]'::jsonb),

    'positions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'userId', x.user_id, 'fundId', x.fund_id, 'amount', x.amount,
        'early', x.early, 'couponProgress', x.coupon_progress,
        'updatedAt', meoktu.iso(x.updated_at)
      ) order by x.id) from meoktu.positions x), '[]'::jsonb),

    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'userId', o.user_id, 'fundId', o.fund_id, 'type', o.type,
        'originalAmount', o.original_amount, 'remaining', o.remaining, 'status', o.status,
        'createdAt', meoktu.iso(o.created_at)
      ) order by o.created_at, o.id) from meoktu.orders o), '[]'::jsonb),

    'coupons', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', c.id, 'userId', c.user_id, 'restaurantId', c.restaurant_id, 'fundId', c.fund_id,
        'title', c.title, 'discount', c.discount, 'maxDiscountWon', c.max_discount_won,
        'type', c.type, 'status', c.status,
        'acquiredFromUserId', c.acquired_from_user_id, 'acquiredAt', meoktu.iso(c.acquired_at),
        'redeemCode', c.redeem_code, 'redeemRequestedAt', meoktu.iso(c.redeem_requested_at),
        'usedAt', meoktu.iso(c.used_at), 'usedAtRestaurantId', c.used_at_restaurant_id,
        'expiresAt', meoktu.iso(c.expires_at), 'createdAt', meoktu.iso(c.created_at)
      )) order by c.created_at, c.id) from meoktu.coupons c), '[]'::jsonb),

    'couponListings', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', l.id, 'userId', l.user_id, 'couponId', l.coupon_id,
        'wantedCategories', meoktu.arr(l.wanted_categories), 'wantedRegions', meoktu.arr(l.wanted_regions),
        'minDiscount', l.min_discount, 'autoAccept', l.auto_accept, 'note', l.note,
        'status', l.status, 'createdAt', meoktu.iso(l.created_at),
        'expiresAt', meoktu.iso(l.expires_at), 'completedAt', meoktu.iso(l.completed_at),
        'completedWithUserId', l.completed_with_user_id
      )) order by l.created_at, l.id) from meoktu.coupon_listings l), '[]'::jsonb),

    'couponOffers', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', o.id, 'listingId', o.listing_id, 'offerUserId', o.offer_user_id,
        'offerCouponId', o.offer_coupon_id, 'message', o.message, 'status', o.status,
        'createdAt', meoktu.iso(o.created_at), 'resolvedAt', meoktu.iso(o.resolved_at)
      )) order by o.created_at, o.id) from meoktu.coupon_offers o), '[]'::jsonb),

    'couponTrades', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', t.id, 'listingId', t.listing_id, 'offerId', t.offer_id, 'mode', t.mode,
        'listerUserId', t.lister_user_id, 'listerCouponId', t.lister_coupon_id,
        'listerGaveDiscount', t.lister_gave_discount, 'listerGaveValueWon', t.lister_gave_value_won,
        'takerUserId', t.taker_user_id, 'takerCouponId', t.taker_coupon_id,
        'takerGaveDiscount', t.taker_gave_discount, 'takerGaveValueWon', t.taker_gave_value_won,
        'createdAt', meoktu.iso(t.created_at)
      )) order by t.created_at, t.id) from meoktu.coupon_trades t), '[]'::jsonb),

    'notifications', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', n.id, 'userId', n.user_id, 'type', n.type, 'title', n.title, 'body', n.body,
        'link', n.link, 'read', n.read, 'createdAt', meoktu.iso(n.created_at)
      )) order by n.created_at, n.id) from meoktu.notifications n), '[]'::jsonb),

    'applications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'userId', a.user_id, 'restaurantName', a.restaurant_name,
        'submittedAt', meoktu.iso(a.submitted_at), 'status', a.status,
        'requestedLimit', a.requested_limit, 'approvedLimit', a.approved_limit,
        'score', a.score, 'data', a.data, 'strengths', meoktu.arr(a.strengths),
        'checks', meoktu.arr(a.checks), 'improvements', meoktu.arr(a.improvements),
        'explanation', a.explanation
      ) order by a.submitted_at, a.id) from meoktu.applications a), '[]'::jsonb),

    'reviews', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', v.id, 'restaurantId', v.restaurant_id, 'userId', v.user_id,
        'userName', v.user_name, 'rating', v.rating, 'content', v.content,
        'visitVerified', v.visit_verified, 'status', v.status,
        'createdAt', meoktu.iso(v.created_at)
      )) order by v.created_at, v.id) from meoktu.reviews v), '[]'::jsonb),

    'visitVerifications', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'restaurantId', x.restaurant_id, 'userId', x.user_id,
        'verifiedAt', meoktu.iso(x.verified_at), 'usedForReview', x.used_for_review
      ) order by x.verified_at, x.id) from meoktu.visit_verifications x), '[]'::jsonb),

    'walletTransactions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'userId', w.user_id, 'type', w.type, 'amount', w.amount,
        'createdAt', meoktu.iso(w.created_at)
      ) order by w.created_at, w.id) from meoktu.wallet_transactions w), '[]'::jsonb),

    'favorites', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', f.user_id, 'restaurantId', f.restaurant_id,
        'createdAt', meoktu.iso(f.created_at)
      ) order by f.created_at) from meoktu.favorites f), '[]'::jsonb),

    'auditEvents', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', e.id, 'actorId', e.actor_id, 'action', e.action,
        'resourceType', e.resource_type, 'resourceId', e.resource_id,
        'summary', e.summary, 'createdAt', meoktu.iso(e.created_at)
      )) order by e.created_at, e.id) from meoktu.audit_events e), '[]'::jsonb),

    'ocrAnalyses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'userId', o.user_id, 'filename', o.filename, 'sourceId', o.source_id,
        'plan', o.plan, 'result', o.result, 'model', o.model, 'status', o.status,
        'createdAt', meoktu.iso(o.created_at)
      ) order by o.created_at, o.id) from meoktu.ocr_analyses o), '[]'::jsonb),

    'dataConnections', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'userId', d.user_id, 'sourceId', d.source_id, 'provider', d.provider,
        'status', d.status, 'consentScope', d.consent_scope, 'recordCount', d.record_count,
        'connectedAt', meoktu.iso(d.connected_at), 'lastSyncedAt', meoktu.iso(d.last_synced_at)
      ) order by d.connected_at, d.id) from meoktu.data_connections d), '[]'::jsonb),

    'supportRequests', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', s.id, 'userId', s.user_id, 'userName', s.user_name, 'type', s.type,
        'subject', s.subject, 'description', s.description, 'restaurantId', s.restaurant_id,
        'priority', s.priority, 'status', s.status, 'answer', s.answer,
        'createdAt', meoktu.iso(s.created_at), 'answeredAt', meoktu.iso(s.answered_at)
      )) order by s.created_at, s.id) from meoktu.support_requests s), '[]'::jsonb),

    'articles', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', a.id, 'eyebrow', a.eyebrow, 'title', a.title, 'summary', a.summary,
        'content', a.content, 'tags', meoktu.arr(a.tags), 'icon', a.icon,
        'sourceName', a.source_name, 'sourceUrl', a.source_url, 'dataNote', a.data_note,
        'publishedAt', meoktu.iso(a.published_at)
      )) order by a.published_at desc, a.id) from meoktu.articles a), '[]'::jsonb),

    'etfs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'emoji', e.emoji, 'region', e.region,
        'category', e.category, 'minimum', e.minimum, 'maxDiscount', e.max_discount,
        'growth', e.growth, 'members', e.members, 'description', e.description,
        'restaurantIds', coalesce((select jsonb_agg(m.restaurant_id order by m.restaurant_id)
          from meoktu.etf_members m where m.etf_id = e.id), '[]'::jsonb)
      ) order by e.id) from meoktu.etf_funds e), '[]'::jsonb)
  )
$$;


/**
 * 원장 JSON → 정규화 테이블. compare-and-set 으로 버전을 확인하고 한 트랜잭션에서 반영한다.
 *
 * expected_version 이 현재 버전과 다르면 아무것도 하지 않고 null 을 돌려준다.
 * (다른 인스턴스가 먼저 썼다는 뜻. 호출부가 다시 읽고 재시도한다.)
 *
 * import_ledger 는 upsert 만 하므로, 원장에서 사라진 행을 지우는 일은 여기서 한다.
 * 지우기 전에 payload 가 멀쩡한지부터 본다. 빈 원장을 잘못 넘기면
 * 전체 삭제가 되어버리기 때문이다.
 */
create or replace function meoktu.save_ledger(payload jsonb, expected_version bigint)
  returns bigint language plpgsql security definer set search_path = meoktu, public as $$
declare v_current bigint; v_ids text[];
begin
  select version into v_current from meoktu.ledger_meta where id = 'meoktu' for update;
  if v_current is null then
    insert into meoktu.ledger_meta(id, version) values ('meoktu', 0) on conflict do nothing;
    v_current := 0;
  end if;
  if v_current <> expected_version then return null; end if;

  if jsonb_array_length(coalesce(payload->'users', '[]'::jsonb)) = 0 then
    raise exception '사용자가 없는 원장은 저장할 수 없어요. 잘못된 저장 요청입니다.'
      using errcode = 'check_violation';
  end if;

  perform meoktu.import_ledger(payload);

  -- 원장에서 사라진 행 정리. 감사기록·거래체결처럼 append-only 인 표는 건드리지 않는다.
  select array_agg(value->>'id') into v_ids from jsonb_array_elements(payload->'notifications');
  delete from meoktu.notifications where not (id = any (coalesce(v_ids, '{}')));

  select array_agg(value->>'userId' || '|' || (value->>'restaurantId')) into v_ids
    from jsonb_array_elements(payload->'favorites');
  delete from meoktu.favorites where not (user_id || '|' || restaurant_id = any (coalesce(v_ids, '{}')));

  select array_agg(value->>'id') into v_ids from jsonb_array_elements(payload->'orders');
  delete from meoktu.orders where not (id = any (coalesce(v_ids, '{}')));

  select array_agg(value->>'id') into v_ids from jsonb_array_elements(payload->'coupons');
  delete from meoktu.coupons where not (id = any (coalesce(v_ids, '{}')));

  update meoktu.ledger_meta set version = v_current + 1, updated_at = now() where id = 'meoktu';
  return v_current + 1;
end $$;


/** 전역 쓰기 잠금. 15초 넘게 잡고 있으면 죽은 인스턴스로 보고 뺏는다. */
create or replace function meoktu.acquire_lock(owner text) returns boolean
  language plpgsql security definer set search_path = meoktu, public as $$
declare v_ok boolean;
begin
  update meoktu.ledger_meta
     set lock_owner = owner, locked_at = now()
   where id = 'meoktu' and (lock_owner is null or locked_at < now() - interval '15 seconds')
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function meoktu.release_lock(owner text) returns void
  language sql security definer set search_path = meoktu, public as $$
  update meoktu.ledger_meta set lock_owner = null, locked_at = null
   where id = 'meoktu' and lock_owner = owner;
$$;

do $$
declare f text;
begin
  foreach f in array array['export_ledger()', 'save_ledger(jsonb,bigint)',
                           'acquire_lock(text)', 'release_lock(text)', 'import_ledger(jsonb)'] loop
    execute format('revoke all on function meoktu.%s from anon, authenticated', f);
  end loop;
end $$;


/** 원장과 버전을 한 번에 읽는다. 두 번 나눠 읽으면 그 사이에 버전이 바뀔 수 있다. */
create or replace function meoktu.read_ledger()
  returns jsonb language sql stable security definer set search_path = meoktu, public as $$
  select jsonb_build_object(
    'version', coalesce((select version from meoktu.ledger_meta where id = 'meoktu'), 0),
    'data', meoktu.export_ledger())
$$;
revoke all on function meoktu.read_ledger() from anon, authenticated;

/** 버전만 확인한다. 조회 요청이 매번 원장 전체를 조립하지 않게 한다. */
create or replace function meoktu.read_ledger_version()
  returns jsonb language sql stable security definer set search_path = meoktu, public as $$
  select jsonb_build_object('version', coalesce((select version from meoktu.ledger_meta where id = 'meoktu'), 0))
$$;
revoke all on function meoktu.read_ledger_version() from anon, authenticated;
