-- ============================================================================
-- 먹투 거래 RPC
--
-- 투자·회수·FIFO 매칭·쿠폰 교환처럼 "여러 행이 동시에 맞아떨어져야 하는" 일은
-- 전부 여기서 한 트랜잭션으로 처리한다. 애플리케이션이 읽고-판단하고-쓰는 사이에
-- 다른 요청이 끼어드는 창이 없어야 하기 때문이다.
--
-- 공통 규칙
--   · 모든 함수는 security definer 다. 호출자는 자기 행만 다룰 수 있고,
--     상대방 행 변경은 함수 안에서 검증을 통과한 뒤에만 일어난다.
--   · 잠금은 항상 select ... for update 로 잡고, 두 행 이상을 잠글 때는
--     id 오름차순으로 잡는다(교착 방지).
--   · 실패는 raise exception 으로 알린다. 트랜잭션 전체가 되돌아간다.
--
-- 적용:  psql "$DATABASE_URL" -f db/functions.sql   (schema.sql 다음에)
-- ============================================================================

-- 교환 규칙 상수. server/exchange.ts 의 EXCHANGE_RULES 와 같은 값을 유지해야 한다.
create or replace function meoktu.exchange_rules()
  returns table (max_discount_gap numeric, max_value_ratio numeric, min_days_left integer,
                 listing_ttl_days integer, offer_ttl_days integer,
                 max_open_listings integer, max_pending_offers integer,
                 max_offers_per_listing integer, redeem_hold_minutes integer)
  language sql immutable as $$ select 10::numeric, 2.5::numeric, 7, 30, 7, 5, 10, 20, 20 $$;



/**
 * 원장 버전 올리기.
 *
 * 거래 RPC 는 테이블을 직접 바꾸므로, 서버 인스턴스들이 들고 있는 메모리 원장이
 * 그 순간 낡은 것이 된다. 버전을 올려두면 각 인스턴스가 다음 요청에서
 * "내가 아는 버전과 다르네" 하고 다시 읽어간다. 이걸 빼먹으면
 * 한 인스턴스에서 일어난 투자가 다른 인스턴스 화면에 영영 안 보인다.
 */
create or replace function meoktu.bump_version() returns bigint
  language sql security definer set search_path = meoktu, public as $$
  insert into meoktu.ledger_meta(id, version) values ('meoktu', 1)
  on conflict (id) do update set version = meoktu.ledger_meta.version + 1, updated_at = now()
  returning version;
$$;

create or replace function meoktu.log_audit(
  p_actor text, p_action text, p_resource_type text, p_resource_id text, p_summary text
) returns void language sql security definer set search_path = meoktu, public as $$
  insert into meoktu.audit_events(id, actor_id, action, resource_type, resource_id, summary)
  values (meoktu.new_id(), p_actor, p_action, p_resource_type, p_resource_id, p_summary);
$$;

create or replace function meoktu.push_notification(
  p_user text, p_type text, p_title text, p_body text, p_link text default null
) returns void language sql security definer set search_path = meoktu, public as $$
  insert into meoktu.notifications(id, user_id, type, title, body, link)
  values (meoktu.new_id(), p_user, p_type, p_title, p_body, p_link);
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 투자
-- ────────────────────────────────────────────────────────────────────────────

/**
 * FIFO 매칭. server/index.ts 의 matchOrders() 를 그대로 옮긴 것이다.
 *
 * 규칙(앱과 한 글자도 달라선 안 된다)
 *   · 매수·매도 모두 created_at 오름차순. 가격 개념이 없고 시간 우선만 있다.
 *   · 같은 사람의 매수·매도는 건너뛴다(자가거래 방지). 먼저 들어온 쪽 인덱스를 민다.
 *   · 체결 단위 1,000원 미만이면 멈춘다.
 *   · 매도자의 실제 보유액이 1,000원에 못 미치면 그 매도 주문은 취소 처리한다.
 *   · 매도자에게 현금이 가고, 매수자 포지션이 늘어난다. early 는 넘어가지 않는다.
 *     (모금 중 참여자만 early 이고 2차 매수자는 아니다.)
 */
create or replace function meoktu.match_orders(p_fund text)
  returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare
  v_buy meoktu.orders%rowtype;
  v_sell meoktu.orders%rowtype;
  v_seller_amount bigint;
  v_buyer_amount bigint;
  v_matched bigint;
  v_matches jsonb := '[]'::jsonb;
begin
  loop
    -- 매번 가장 오래된 매수·매도를 다시 고른다. 자가거래 건너뛰기는 아래에서 처리한다.
    select * into v_buy from meoktu.orders
     where fund_id = p_fund and type = 'buy' and remaining > 0 and status in ('open','partial')
     order by created_at, id limit 1 for update;
    exit when not found;

    select * into v_sell from meoktu.orders
     where fund_id = p_fund and type = 'sell' and remaining > 0 and status in ('open','partial')
       and user_id <> v_buy.user_id
     order by created_at, id limit 1 for update;
    exit when not found;

    v_matched := least(v_buy.remaining, v_sell.remaining);
    exit when v_matched < 1000;

    select coalesce(amount, 0) into v_seller_amount from meoktu.positions
     where user_id = v_sell.user_id and fund_id = p_fund for update;
    v_matched := least(v_matched, coalesce(v_seller_amount, 0));
    if v_matched < 1000 then
      -- 팔 물량이 없는 유령 매도 주문. 없애지 않으면 무한 루프가 된다.
      update meoktu.orders set remaining = 0, status = 'cancelled' where id = v_sell.id;
      continue;
    end if;

    select coalesce(amount, 0) into v_buyer_amount from meoktu.positions
     where user_id = v_buy.user_id and fund_id = p_fund;

    insert into meoktu.positions(id, user_id, fund_id, amount, early, updated_at)
    values (meoktu.new_id(), v_buy.user_id, p_fund, v_matched, false, now())
    on conflict (user_id, fund_id) do update
      set amount = meoktu.positions.amount + excluded.amount, updated_at = now();

    update meoktu.positions set amount = amount - v_matched, updated_at = now()
     where user_id = v_sell.user_id and fund_id = p_fund;
    update meoktu.profiles set cash = cash + v_matched where id = v_sell.user_id;
    insert into meoktu.wallet_transactions(id, user_id, type, amount, memo)
    values (meoktu.new_id(), v_sell.user_id, 'trade_settle', v_matched, p_fund);

    update meoktu.orders set remaining = remaining - v_matched,
           status = case when remaining - v_matched = 0 then 'filled' else 'partial' end
     where id in (v_buy.id, v_sell.id);

    -- 투자자 수는 들어올 때만 늘고 나갈 때만 준다.
    update meoktu.funds set investor_count = greatest(0, investor_count
        + case when coalesce(v_buyer_amount, 0) = 0 then 1 else 0 end
        - case when v_seller_amount - v_matched <= 0 then 1 else 0 end)
     where id = p_fund;

    v_matches := v_matches || jsonb_build_object(
      'amount', v_matched, 'buyerId', v_buy.user_id, 'sellerId', v_sell.user_id);
  end loop;

  update meoktu.funds set
    open_buy_amount = coalesce((select sum(remaining) from meoktu.orders
      where fund_id = p_fund and type = 'buy' and status in ('open','partial')), 0),
    open_sell_amount = coalesce((select sum(remaining) from meoktu.orders
      where fund_id = p_fund and type = 'sell' and status in ('open','partial')), 0)
   where id = p_fund;

  return v_matches;
end $$;


/**
 * 투자. server/index.ts 의 POST /api/funds/:fundId/invest 와 같은 규칙이다.
 *
 *   모금 중(funding)  → 즉시 체결. 남은 모금액을 넘으면 넘은 만큼만 받고 나머지는 돌려준다.
 *                       모금 중 참여자에게는 early 를 붙인다(매출 보너스 영구 가속).
 *   예약 거래(trading) → 매수 주문을 만들고 FIFO 로 맞춘다. early 는 붙지 않는다.
 *
 * 한 트랜잭션 안에서 잔액·한도·모금액을 다시 확인하고 반영하므로,
 * 두 사람이 동시에 마지막 잔여분을 채우려 해도 한쪽만 성공한다.
 */
create or replace function meoktu.invest(
  p_user text, p_fund text, p_amount bigint
) returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare
  v_user meoktu.profiles%rowtype;
  v_fund meoktu.funds%rowtype;
  v_held bigint;
  v_pending bigint;
  v_limit bigint;
  v_accepted bigint;
  v_order text;
  v_matches jsonb;
  v_remaining bigint;
begin
  if p_amount is null or p_amount < 1000 or p_amount % 1000 <> 0 then
    raise exception '투자는 1,000원 단위로 가능해요.' using errcode = 'check_violation';
  end if;

  select * into v_user from meoktu.profiles where id = p_user for update;
  if not found then raise exception '사용자를 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  if v_user.account_status <> 'active' then
    raise exception '이용이 정지된 계정이에요.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_fund from meoktu.funds where id = p_fund for update;
  if not found or v_fund.status = 'closed' then
    raise exception '투자 가능한 펀드를 찾을 수 없어요.' using errcode = 'no_data_found';
  end if;
  if v_user.cash < p_amount then
    raise exception '보유 머니가 부족해요.' using errcode = 'check_violation';
  end if;

  -- 같은 펀드에 회수 대기를 걸어둔 채로 다시 사면 자기 주문끼리 엉킨다.
  if v_fund.status = 'trading' and exists (select 1 from meoktu.orders
      where user_id = p_user and fund_id = p_fund and type = 'sell' and remaining > 0) then
    raise exception '이 펀드의 회수 대기 주문을 먼저 취소하거나 체결해주세요.' using errcode = 'check_violation';
  end if;

  select coalesce(amount, 0) into v_held from meoktu.positions
   where user_id = p_user and fund_id = p_fund for update;
  v_held := coalesce(v_held, 0);
  select coalesce(sum(remaining), 0) into v_pending from meoktu.orders
   where user_id = p_user and fund_id = p_fund and type = 'buy' and remaining > 0;

  -- 개인 한도는 목표액의 1%를 1,000원 단위로 내림한 값이다.
  v_limit := floor(v_fund.goal * 0.01 / 1000) * 1000;
  if v_held + v_pending + p_amount > v_limit then
    raise exception '한 식당에는 목표액의 1%%인 %원까지 투자할 수 있어요.',
      to_char(v_limit, 'FM999,999,999') using errcode = 'check_violation';
  end if;

  if v_fund.status = 'funding' then
    v_accepted := least(p_amount, v_fund.goal - v_fund.raised);
    if v_accepted <= 0 then
      raise exception '이미 목표액을 채운 펀드예요.' using errcode = 'check_violation';
    end if;
    update meoktu.profiles set cash = cash - v_accepted where id = p_user;
    insert into meoktu.positions(id, user_id, fund_id, amount, early, updated_at)
    values (meoktu.new_id(), p_user, p_fund, v_accepted, true, now())
    on conflict (user_id, fund_id) do update
      set amount = meoktu.positions.amount + excluded.amount, early = true, updated_at = now();
    update meoktu.funds set
        raised = raised + v_accepted,
        investor_count = investor_count + case when v_held = 0 then 1 else 0 end,
        status = case when raised + v_accepted >= goal then 'trading' else status end,
        ends_at = case when raised + v_accepted >= goal then now() else ends_at end
     where id = p_fund;
    insert into meoktu.wallet_transactions(id, user_id, type, amount, memo)
    values (meoktu.new_id(), p_user, 'invest', -v_accepted, p_fund);
    perform meoktu.log_audit(p_user, 'fund.invested', 'fund', p_fund,
      format('%s원 투자', to_char(v_accepted, 'FM999,999,999')));
    perform meoktu.bump_version();
  return jsonb_build_object('matched', v_accepted, 'queued', 0, 'matches', '[]'::jsonb);
  end if;

  -- 예약 거래: 현금을 잠그고 매수 주문을 만든다. 취소하면 남은 만큼 돌려받는다.
  update meoktu.profiles set cash = cash - p_amount where id = p_user;
  v_order := meoktu.new_id();
  insert into meoktu.orders(id, user_id, fund_id, type, original_amount, remaining, status)
  values (v_order, p_user, p_fund, 'buy', p_amount, p_amount, 'open');
  v_matches := meoktu.match_orders(p_fund);
  select remaining into v_remaining from meoktu.orders where id = v_order;
  perform meoktu.log_audit(p_user, 'fund.buy_ordered', 'fund', p_fund,
    format('투자 예약 %s원 중 %s원 체결',
      to_char(p_amount, 'FM999,999,999'), to_char(p_amount - v_remaining, 'FM999,999,999')));
  perform meoktu.bump_version();
  return jsonb_build_object('matched', p_amount - v_remaining, 'queued', v_remaining,
                            'orderId', v_order, 'matches', v_matches);
end $$;


/**
 * 투자금 회수. server/index.ts 의 POST /api/funds/:fundId/withdraw 와 같은 규칙이다.
 *
 *   모금 중  → 즉시 환불.
 *   예약 거래 → 매도 주문을 만들고 FIFO 로 맞춘다. 체결된 만큼만 현금이 된다.
 *
 * 쿠폰 정산(issueCoupon)은 아직 여기 없다. 적립률 계산이 서버에 있어서
 * 라우트가 체결 결과를 받아 이어서 처리한다. 그 부분까지 옮기기 전에는
 * 이 함수만으로 회수 라우트를 대체하면 안 된다.
 */
create or replace function meoktu.withdraw_investment(
  p_user text, p_fund text, p_amount bigint
) returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare
  v_fund meoktu.funds%rowtype;
  v_held bigint;
  v_selling bigint;
  v_order text;
  v_matches jsonb;
  v_remaining bigint;
begin
  if p_amount is null or p_amount < 1000 or p_amount % 1000 <> 0 then
    raise exception '회수는 1,000원 단위로 가능해요.' using errcode = 'check_violation';
  end if;
  select * into v_fund from meoktu.funds where id = p_fund for update;
  if not found then raise exception '펀드를 찾을 수 없어요.' using errcode = 'no_data_found'; end if;

  select coalesce(amount, 0) into v_held from meoktu.positions
   where user_id = p_user and fund_id = p_fund for update;
  if v_held is null then raise exception '보유한 투자금이 없어요.' using errcode = 'check_violation'; end if;

  if v_fund.status = 'trading' and exists (select 1 from meoktu.orders
      where user_id = p_user and fund_id = p_fund and type = 'buy' and remaining > 0) then
    raise exception '이 펀드의 투자 예약을 먼저 취소하거나 체결해주세요.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(remaining), 0) into v_selling from meoktu.orders
   where user_id = p_user and fund_id = p_fund and type = 'sell' and remaining > 0;
  if v_held - v_selling < p_amount then
    raise exception '주문 가능한 투자금보다 큰 금액이에요.' using errcode = 'check_violation';
  end if;

  if v_fund.status = 'funding' then
    update meoktu.positions set amount = amount - p_amount, updated_at = now()
     where user_id = p_user and fund_id = p_fund;
    update meoktu.funds set
        raised = greatest(0, raised - p_amount),
        investor_count = greatest(0, investor_count - case when v_held - p_amount <= 0 then 1 else 0 end)
     where id = p_fund;
    update meoktu.profiles set cash = cash + p_amount where id = p_user;
    insert into meoktu.wallet_transactions(id, user_id, type, amount, memo)
    values (meoktu.new_id(), p_user, 'withdraw', p_amount, p_fund);
    perform meoktu.log_audit(p_user, 'fund.withdrawn', 'fund', p_fund,
      format('모금 중 즉시 회수 %s원', to_char(p_amount, 'FM999,999,999')));
    perform meoktu.bump_version();
  return jsonb_build_object('matched', p_amount, 'queued', 0, 'matches', '[]'::jsonb);
  end if;

  v_order := meoktu.new_id();
  insert into meoktu.orders(id, user_id, fund_id, type, original_amount, remaining, status)
  values (v_order, p_user, p_fund, 'sell', p_amount, p_amount, 'open');
  v_matches := meoktu.match_orders(p_fund);
  select remaining into v_remaining from meoktu.orders where id = v_order;
  perform meoktu.log_audit(p_user, 'fund.sell_ordered', 'fund', p_fund,
    format('회수 주문 %s원 중 %s원 체결',
      to_char(p_amount, 'FM999,999,999'), to_char(p_amount - v_remaining, 'FM999,999,999')));
  perform meoktu.bump_version();
  return jsonb_build_object('matched', p_amount - v_remaining, 'queued', v_remaining,
                            'orderId', v_order, 'matches', v_matches);
end $$;


/** 미체결 주문 취소. 매수 주문이면 잠가둔 현금을 돌려준다. */
create or replace function meoktu.cancel_order(p_user text, p_order text)
  returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare v_order meoktu.orders%rowtype;
begin
  select * into v_order from meoktu.orders where id = p_order for update;
  if not found then raise exception '주문을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  if v_order.user_id <> p_user then
    raise exception '내 주문만 취소할 수 있어요.' using errcode = 'insufficient_privilege';
  end if;
  if v_order.status not in ('open', 'partial') then
    raise exception '이미 마감된 주문이에요.' using errcode = 'check_violation';
  end if;

  update meoktu.orders set status = 'cancelled' where id = p_order;

  if v_order.type = 'buy' then
    update meoktu.profiles set cash = cash + v_order.remaining where id = p_user;
    insert into meoktu.wallet_transactions(id, user_id, type, amount, memo)
    values (meoktu.new_id(), p_user, 'withdraw', v_order.remaining, v_order.fund_id);
  end if;

  update meoktu.funds
     set open_buy_amount = coalesce((select sum(remaining) from meoktu.orders
            where fund_id = v_order.fund_id and type = 'buy' and status in ('open','partial')), 0),
         open_sell_amount = coalesce((select sum(remaining) from meoktu.orders
            where fund_id = v_order.fund_id and type = 'sell' and status in ('open','partial')), 0)
   where id = v_order.fund_id;

  perform meoktu.log_audit(p_user, 'order.cancelled', 'order', p_order, '대기 주문 취소');
  perform meoktu.bump_version();
  return jsonb_build_object('orderId', p_order, 'refunded',
    case when v_order.type = 'buy' then v_order.remaining else 0 end);
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 쿠폰 교환 (에스크로)
--
-- A 가 쿠폰 하나를 올렸는데 B 와 C 가 동시에 가져가려는 상황이 여기서 갈린다.
-- 매물 행을 for update 로 잠그고 status='open' 을 다시 확인하므로
-- 먼저 잠근 쪽만 completed 로 바꾸고, 나중 요청은 '이미 마감된 교환'으로 떨어진다.
-- 제안 방식도 coupon_offers_escrow_idx(부분 유니크 인덱스)가
-- 같은 쿠폰을 두 제안에 동시에 거는 것을 DB 차원에서 막는다.
-- ────────────────────────────────────────────────────────────────────────────

/** 교환 성립 조건 검사. 제안 생성·수락·즉시교환이 모두 이걸 통과해야 한다. */
create or replace function meoktu.check_swap(p_listing text, p_offered_coupon text, p_offer_user text)
  returns text language plpgsql stable security definer set search_path = meoktu, public as $$
declare
  v_listing meoktu.coupon_listings%rowtype;
  v_wanted  meoktu.coupons%rowtype;
  v_offered meoktu.coupons%rowtype;
  v_restaurant meoktu.restaurants%rowtype;
  r record;
  v_gap numeric; v_high bigint; v_low bigint; v_days numeric;
begin
  select * into r from meoktu.exchange_rules();
  select * into v_listing from meoktu.coupon_listings where id = p_listing;
  if not found then return '교환 등록을 찾을 수 없어요.'; end if;
  if v_listing.status <> 'open' then return '이미 마감된 교환 등록이에요.'; end if;
  if v_listing.user_id = p_offer_user then return '내가 올린 쿠폰과는 교환할 수 없어요.'; end if;

  select * into v_wanted from meoktu.coupons where id = v_listing.coupon_id;
  if not found then return '상대 쿠폰을 찾을 수 없어요.'; end if;
  if v_wanted.status <> 'listed' then return '상대 쿠폰이 이미 교환장에서 내려갔어요.'; end if;
  if v_wanted.expires_at <= now() then return '상대 쿠폰의 기간이 지났어요.'; end if;

  select * into v_offered from meoktu.coupons where id = p_offered_coupon;
  if not found then return '제안할 쿠폰을 찾을 수 없어요.'; end if;
  if v_offered.user_id <> p_offer_user then return '내가 가진 쿠폰만 제안할 수 있어요.'; end if;
  if v_offered.id = v_listing.coupon_id then return '같은 쿠폰끼리는 교환할 수 없어요.'; end if;
  if v_offered.status not in ('available', 'offered') then return '지금 교환에 쓸 수 없는 상태의 쿠폰이에요.'; end if;

  v_days := extract(epoch from (v_offered.expires_at - now())) / 86400;
  if v_days <= 0 then return '기간이 지난 쿠폰이에요.'; end if;
  if v_days < r.min_days_left then
    return format('만료 %s일 전부터는 교환할 수 없어요.', r.min_days_left);
  end if;

  -- 등록자가 걸어둔 조건. 배열이 비어 있으면 '상관없음'이라 통과시킨다.
  select * into v_restaurant from meoktu.restaurants where id = v_offered.restaurant_id;
  if array_length(v_listing.wanted_categories, 1) is not null
     and not (v_restaurant.category = any (v_listing.wanted_categories)) then
    return format('등록자가 원하는 업종은 %s이에요.', array_to_string(v_listing.wanted_categories, '·'));
  end if;
  if array_length(v_listing.wanted_regions, 1) is not null
     and not (v_restaurant.region = any (v_listing.wanted_regions)) then
    return format('등록자가 원하는 지역은 %s이에요.', array_to_string(v_listing.wanted_regions, '·'));
  end if;
  if v_listing.min_discount > 0 and v_offered.discount < v_listing.min_discount then
    return format('등록자가 요청한 최소 할인율은 %s%%예요.', v_listing.min_discount);
  end if;

  -- 값어치 밴드. 할인율과 액면가를 함께 봐야 30%짜리끼리도 헐값 교환이 안 된다.
  v_gap := abs(v_offered.discount - v_wanted.discount);
  if v_gap >= r.max_discount_gap then
    return format('할인율 차이가 %s%% 미만이어야 해요. (현재 %sp)', r.max_discount_gap, round(v_gap, 1));
  end if;
  v_high := greatest(v_offered.max_discount_won, v_wanted.max_discount_won);
  v_low  := least(v_offered.max_discount_won, v_wanted.max_discount_won);
  if v_low <= 0 or v_high::numeric / v_low > r.max_value_ratio then
    return format('최대 할인 금액 차이가 %s배를 넘어요.', r.max_value_ratio);
  end if;

  return null;  -- 통과
end $$;


/** 교환장에 쿠폰을 올린다. 쿠폰은 listed 로 잠기고 지갑에서 쓸 수 없게 된다. */
create or replace function meoktu.list_coupon(
  p_user text, p_coupon text, p_categories text[], p_regions text[],
  p_min_discount numeric, p_auto_accept boolean, p_note text
) returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare
  v_coupon meoktu.coupons%rowtype;
  v_open   integer;
  v_id     text;
  r        record;
  v_days   numeric;
begin
  select * into r from meoktu.exchange_rules();
  select * into v_coupon from meoktu.coupons where id = p_coupon for update;
  if not found then raise exception '쿠폰을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  if v_coupon.user_id <> p_user then
    raise exception '내 쿠폰만 등록할 수 있어요.' using errcode = 'insufficient_privilege';
  end if;
  if v_coupon.status <> 'available' then
    raise exception '지금 교환장에 올릴 수 없는 상태의 쿠폰이에요.' using errcode = 'check_violation';
  end if;
  v_days := extract(epoch from (v_coupon.expires_at - now())) / 86400;
  if v_days < r.min_days_left then
    raise exception '만료 %일 전부터는 교환할 수 없어요.', r.min_days_left using errcode = 'check_violation';
  end if;

  select count(*) into v_open from meoktu.coupon_listings where user_id = p_user and status = 'open';
  if v_open >= r.max_open_listings then
    raise exception '동시에 열어둘 수 있는 교환 등록은 %개까지예요.', r.max_open_listings using errcode = 'check_violation';
  end if;

  v_id := meoktu.new_id();
  insert into meoktu.coupon_listings(id, user_id, coupon_id, wanted_categories, wanted_regions,
                                     min_discount, auto_accept, note, status, expires_at)
  values (v_id, p_user, p_coupon, coalesce(p_categories, '{}'), coalesce(p_regions, '{}'),
          coalesce(p_min_discount, 0), coalesce(p_auto_accept, true), coalesce(p_note, ''),
          'open', now() + (r.listing_ttl_days || ' days')::interval);

  update meoktu.coupons set status = 'listed' where id = p_coupon;
  perform meoktu.log_audit(p_user, 'coupon.list', 'coupon', p_coupon, '쿠폰 교환장 등록');
  perform meoktu.bump_version();
  return jsonb_build_object('listingId', v_id);
end $$;


/** 등록 취소. 잠겨 있던 쿠폰을 지갑으로 돌려주고 대기 제안도 함께 푼다. */
create or replace function meoktu.cancel_listing(p_user text, p_listing text)
  returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare v_listing meoktu.coupon_listings%rowtype;
begin
  select * into v_listing from meoktu.coupon_listings where id = p_listing for update;
  if not found then raise exception '교환 등록을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  if v_listing.user_id <> p_user then
    raise exception '내가 올린 등록만 취소할 수 있어요.' using errcode = 'insufficient_privilege';
  end if;
  if v_listing.status <> 'open' then
    raise exception '이미 마감된 교환 등록이에요.' using errcode = 'check_violation';
  end if;

  update meoktu.coupon_listings set status = 'cancelled' where id = p_listing;
  update meoktu.coupons
     set status = case when expires_at <= now() then 'expired' else 'available' end
   where id = v_listing.coupon_id and status = 'listed';

  -- 걸려 있던 제안들의 에스크로를 푼다. 안 풀면 상대 쿠폰이 영영 묶인다.
  insert into meoktu.notifications(id, user_id, type, title, body, link)
  select meoktu.new_id(), o.offer_user_id, 'offer_declined', '교환 등록이 내려갔어요',
         format('%s 매물이 취소되어 걸어둔 쿠폰을 지갑으로 돌려드렸어요.',
                (select title from meoktu.coupons where id = v_listing.coupon_id)), '/market'
    from meoktu.coupon_offers o where o.listing_id = p_listing and o.status = 'pending';

  update meoktu.coupons
     set status = case when expires_at <= now() then 'expired' else 'available' end
   where status = 'offered'
     and id in (select offer_coupon_id from meoktu.coupon_offers
                 where listing_id = p_listing and status = 'pending');
  update meoktu.coupon_offers set status = 'declined', resolved_at = now()
   where listing_id = p_listing and status = 'pending';

  perform meoktu.log_audit(p_user, 'coupon.unlist', 'listing', p_listing,
    format('%s 교환 취소', (select title from meoktu.coupons where id = v_listing.coupon_id)));
  perform meoktu.bump_version();
  return jsonb_build_object('listingId', p_listing);
end $$;


/**
 * 교환 제안. 제안한 쿠폰은 offered 로 잠긴다(에스크로).
 * 같은 쿠폰으로 두 곳에 동시에 제안하는 것은 coupon_offers_escrow_idx 가 막는다.
 */
create or replace function meoktu.offer_coupon(
  p_user text, p_listing text, p_coupon text, p_message text
) returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare
  v_reason  text;
  v_listing meoktu.coupon_listings%rowtype;
  v_pending integer;
  v_id      text;
  r         record;
begin
  select * into r from meoktu.exchange_rules();
  select * into v_listing from meoktu.coupon_listings where id = p_listing for update;
  if not found then raise exception '교환 등록을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;

  -- 두 쿠폰을 id 순서로 잠근다(교착 방지).
  perform 1 from meoktu.coupons
   where id in (v_listing.coupon_id, p_coupon) order by id for update;

  v_reason := meoktu.check_swap(p_listing, p_coupon, p_user);
  if v_reason is not null then raise exception '%', v_reason using errcode = 'check_violation'; end if;

  select count(*) into v_pending from meoktu.coupon_offers
   where offer_user_id = p_user and status = 'pending';
  if v_pending >= r.max_pending_offers then
    raise exception '동시에 보낼 수 있는 교환 제안은 %개까지예요.', r.max_pending_offers using errcode = 'check_violation';
  end if;
  select count(*) into v_pending from meoktu.coupon_offers
   where listing_id = p_listing and status = 'pending';
  if v_pending >= r.max_offers_per_listing then
    raise exception '이 등록은 대기 제안이 가득 찼어요.' using errcode = 'check_violation';
  end if;

  v_id := meoktu.new_id();
  insert into meoktu.coupon_offers(id, listing_id, offer_user_id, offer_coupon_id, message, status)
  values (v_id, p_listing, p_user, p_coupon, coalesce(p_message, ''), 'pending');
  update meoktu.coupons set status = 'offered' where id = p_coupon;

  perform meoktu.push_notification(v_listing.user_id, 'offer_received', '새 교환 제안이 왔어요',
    format('%s님이 %s%% %s(으)로 교환을 제안했어요.',
      (select name from meoktu.profiles where id = p_user),
      (select discount from meoktu.coupons where id = p_coupon),
      (select title from meoktu.coupons where id = p_coupon)), '/my');
  perform meoktu.log_audit(p_user, 'coupon.offer', 'listing', p_listing,
    format('%s 교환 제안', (select title from meoktu.coupons where id = p_coupon)));
  perform meoktu.bump_version();
  return jsonb_build_object('offerId', v_id);
end $$;


/**
 * 실제 교환 체결. 제안 수락과 즉시 교환이 모두 여기로 온다.
 * 두 쿠폰의 소유자를 맞바꾸고, 매물을 completed 로 닫고,
 * 남은 대기 제안의 에스크로를 풀고, 체결 기록·알림까지 한 트랜잭션에 넣는다.
 */
create or replace function meoktu.settle_swap(
  p_listing text, p_offer text, p_taker text, p_taker_coupon text, p_mode text
) returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare
  v_listing meoktu.coupon_listings%rowtype;
  v_wanted  meoktu.coupons%rowtype;
  v_offered meoktu.coupons%rowtype;
  v_reason  text;
  v_trade   text;
begin
  select * into v_listing from meoktu.coupon_listings where id = p_listing for update;
  if not found then raise exception '교환 등록을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  -- 여기서 status 를 다시 본다. 동시에 두 사람이 들어와도 한쪽만 통과한다.
  if v_listing.status <> 'open' then
    raise exception '이미 마감된 교환 등록이에요.' using errcode = 'check_violation';
  end if;

  perform 1 from meoktu.coupons
   where id in (v_listing.coupon_id, p_taker_coupon) order by id for update;

  v_reason := meoktu.check_swap(p_listing, p_taker_coupon, p_taker);
  if v_reason is not null then raise exception '%', v_reason using errcode = 'check_violation'; end if;

  select * into v_wanted  from meoktu.coupons where id = v_listing.coupon_id;
  select * into v_offered from meoktu.coupons where id = p_taker_coupon;

  -- 소유자 교환. 직전 소유자를 남겨 이력 화면에서 누구와 바꿨는지 보여준다.
  update meoktu.coupons
     set user_id = p_taker, status = 'available',
         acquired_from_user_id = v_listing.user_id, acquired_at = now()
   where id = v_wanted.id;
  update meoktu.coupons
     set user_id = v_listing.user_id, status = 'available',
         acquired_from_user_id = p_taker, acquired_at = now()
   where id = v_offered.id;

  update meoktu.coupon_listings
     set status = 'completed', completed_at = now(), completed_with_user_id = p_taker
   where id = p_listing;

  if p_offer is not null then
    update meoktu.coupon_offers set status = 'accepted', resolved_at = now() where id = p_offer;
  end if;

  -- 같은 매물에 걸려 있던 나머지 제안은 거절 처리하고 에스크로를 푼다.
  update meoktu.coupons set status = 'available'
   where status = 'offered'
     and id in (select offer_coupon_id from meoktu.coupon_offers
                 where listing_id = p_listing and status = 'pending');
  update meoktu.coupon_offers set status = 'declined', resolved_at = now()
   where listing_id = p_listing and status = 'pending';

  v_trade := meoktu.new_id();
  insert into meoktu.coupon_trades(id, listing_id, offer_id, mode,
    lister_user_id, lister_coupon_id, lister_gave_discount, lister_gave_value_won,
    taker_user_id, taker_coupon_id, taker_gave_discount, taker_gave_value_won)
  values (v_trade, p_listing, p_offer, p_mode,
    v_listing.user_id, v_wanted.id, v_wanted.discount, v_wanted.max_discount_won,
    p_taker, v_offered.id, v_offered.discount, v_offered.max_discount_won);

  perform meoktu.push_notification(v_listing.user_id, 'swap_done', '쿠폰 교환이 완료됐어요',
    format('%s님과 교환했어요. 지갑에서 %s을(를) 확인해보세요.',
      (select name from meoktu.profiles where id = p_taker), v_offered.title), '/my');
  perform meoktu.push_notification(p_taker, 'swap_done', '쿠폰 교환이 완료됐어요',
    format('%s님과 교환했어요. 지갑에서 %s을(를) 확인해보세요.',
      (select name from meoktu.profiles where id = v_listing.user_id), v_wanted.title), '/my');
  perform meoktu.log_audit(p_taker, 'coupon.swap', 'coupon_trade', v_trade, '쿠폰 교환 체결');

  perform meoktu.bump_version();
  return jsonb_build_object('tradeId', v_trade, 'receivedCouponId', v_wanted.id, 'gaveCouponId', v_offered.id);
end $$;


/** 매물 주인이 제안을 수락한다. */
create or replace function meoktu.accept_offer(p_user text, p_offer text)
  returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare v_offer meoktu.coupon_offers%rowtype; v_listing meoktu.coupon_listings%rowtype;
begin
  select * into v_offer from meoktu.coupon_offers where id = p_offer for update;
  if not found then raise exception '교환 제안을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  if v_offer.status <> 'pending' then
    raise exception '이미 처리된 제안이에요.' using errcode = 'check_violation';
  end if;
  select * into v_listing from meoktu.coupon_listings where id = v_offer.listing_id;
  if v_listing.user_id <> p_user then
    raise exception '내가 올린 등록의 제안만 수락할 수 있어요.' using errcode = 'insufficient_privilege';
  end if;
  return meoktu.settle_swap(v_offer.listing_id, v_offer.id, v_offer.offer_user_id, v_offer.offer_coupon_id, 'offer');
end $$;


/** 조건을 만족하면 승인 없이 바로 맞바꾼다(자동수락 매물). */
create or replace function meoktu.instant_swap(p_user text, p_listing text, p_coupon text)
  returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare v_listing meoktu.coupon_listings%rowtype;
begin
  select * into v_listing from meoktu.coupon_listings where id = p_listing;
  if not found then raise exception '교환 등록을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  if not v_listing.auto_accept then
    raise exception '이 등록은 등록자의 수락이 필요해요.' using errcode = 'check_violation';
  end if;
  return meoktu.settle_swap(p_listing, null, p_user, p_coupon, 'instant');
end $$;


/** 제안 거절·철회. 어느 쪽이든 잠긴 쿠폰을 지갑으로 되돌린다. */
create or replace function meoktu.resolve_offer(p_user text, p_offer text, p_action text)
  returns jsonb language plpgsql security definer set search_path = meoktu, public as $$
declare v_offer meoktu.coupon_offers%rowtype; v_listing meoktu.coupon_listings%rowtype;
begin
  if p_action not in ('declined', 'withdrawn') then
    raise exception '알 수 없는 처리예요.' using errcode = 'check_violation';
  end if;
  select * into v_offer from meoktu.coupon_offers where id = p_offer for update;
  if not found then raise exception '교환 제안을 찾을 수 없어요.' using errcode = 'no_data_found'; end if;
  if v_offer.status <> 'pending' then
    raise exception '이미 처리된 제안이에요.' using errcode = 'check_violation';
  end if;

  select * into v_listing from meoktu.coupon_listings where id = v_offer.listing_id;
  if p_action = 'declined' and v_listing.user_id <> p_user then
    raise exception '내가 올린 등록의 제안만 거절할 수 있어요.' using errcode = 'insufficient_privilege';
  end if;
  if p_action = 'withdrawn' and v_offer.offer_user_id <> p_user then
    raise exception '내가 보낸 제안만 철회할 수 있어요.' using errcode = 'insufficient_privilege';
  end if;

  update meoktu.coupon_offers set status = p_action, resolved_at = now() where id = p_offer;
  update meoktu.coupons
     set status = case when expires_at <= now() then 'expired' else 'available' end
   where id = v_offer.offer_coupon_id and status = 'offered';

  if p_action = 'declined' then
    perform meoktu.push_notification(v_offer.offer_user_id, 'offer_declined', '교환 제안이 거절됐어요',
      format('%s님이 제안을 거절했어요. 걸어둔 쿠폰은 지갑으로 돌아왔어요.',
        (select name from meoktu.profiles where id = p_user)), '/market');
  else
    perform meoktu.push_notification(v_listing.user_id, 'offer_withdrawn', '교환 제안이 취소됐어요',
      format('%s님이 보낸 교환 제안을 거두었어요.',
        (select name from meoktu.profiles where id = p_user)), '/my');
  end if;

  perform meoktu.log_audit(p_user,
    case p_action when 'declined' then 'coupon.offer_declined' else 'coupon.offer_withdrawn' end,
    'coupon_offer', p_offer, '교환 제안 ' || case p_action when 'declined' then '거절' else '철회' end);
  perform meoktu.bump_version();
  return jsonb_build_object('offerId', p_offer, 'status', p_action);
end $$;


/**
 * 만료 청소. 조회·쓰기 전에 돌려서 유령 매물과 영원히 잠긴 쿠폰이 남지 않게 한다.
 * 순서가 중요하다. 제안 → 매물 → 쿠폰 → 사용요청 순으로 풀어야
 * 앞 단계에서 푼 쿠폰이 뒤 단계에서 다시 판정된다.
 */
create or replace function meoktu.sweep_expired() returns integer
  language plpgsql security definer set search_path = meoktu, public as $$
declare v_count integer := 0; v_n integer; r record;
begin
  select * into r from meoktu.exchange_rules();

  -- ① 기한이 지났거나, 매물이 닫혔거나, 쿠폰이 죽은 제안
  with dead as (
    update meoktu.coupon_offers o set status = 'expired', resolved_at = now()
     where o.status = 'pending'
       and (o.created_at + (r.offer_ttl_days || ' days')::interval < now()
            or not exists (select 1 from meoktu.coupon_listings l
                            where l.id = o.listing_id and l.status = 'open')
            or exists (select 1 from meoktu.coupons c
                        where c.id = o.offer_coupon_id and c.expires_at <= now()))
    returning o.offer_coupon_id
  )
  update meoktu.coupons set status = 'available'
   where status = 'offered' and id in (select offer_coupon_id from dead);
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- ② 기한이 지났거나 쿠폰이 죽은 매물
  with dead as (
    update meoktu.coupon_listings l set status = 'expired'
     where l.status = 'open'
       and (l.expires_at < now()
            or exists (select 1 from meoktu.coupons c where c.id = l.coupon_id and c.expires_at <= now()))
    returning l.coupon_id
  )
  update meoktu.coupons
     set status = case when expires_at <= now() then 'expired' else 'available' end
   where status = 'listed' and id in (select coupon_id from dead);
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- ③ 기간이 지난 쿠폰
  update meoktu.coupons set status = 'expired'
   where status not in ('used', 'expired') and expires_at <= now();
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- ④ 사장님이 확인하지 않은 사용 요청은 지갑으로 되돌린다.
  update meoktu.coupons
     set status = case when expires_at <= now() then 'expired' else 'available' end,
         redeem_code = null, redeem_requested_at = null
   where status = 'redeeming'
     and coalesce(redeem_requested_at, created_at) + (r.redeem_hold_minutes || ' minutes')::interval < now();
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  if v_count > 0 then perform meoktu.bump_version(); end if;
  return v_count;
end $$;


-- 브라우저에서 직접 호출할 수 있는 것은 없다. 서버(service_role)만 실행한다.
do $$
declare f text;
begin
  foreach f in array array[
    'invest(text,text,bigint)', 'withdraw_investment(text,text,bigint)', 'cancel_order(text,text)',
    'list_coupon(text,text,text[],text[],numeric,boolean,text)', 'cancel_listing(text,text)',
    'offer_coupon(text,text,text,text)', 'settle_swap(text,text,text,text,text)',
    'accept_offer(text,text)', 'instant_swap(text,text,text)', 'resolve_offer(text,text,text)',
    'sweep_expired()', 'log_audit(text,text,text,text,text)',
    'push_notification(text,text,text,text,text)'
  ] loop
    execute format('revoke all on function meoktu.%s from anon, authenticated', f);
  end loop;
end $$;
