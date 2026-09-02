-- ============================================================================
-- 거래 RPC 동작 검증.
--
--   node scripts/apply-db.mjs --test
--
-- schema.sql + functions.sql 뒤에 이어 붙여 begin ... rollback 안에서 돌린다.
-- 단언이 하나라도 깨지면 raise exception 으로 전체가 실패한다.
-- 특히 ⑦⑧은 "A 의 쿠폰 하나를 B 와 C 가 동시에 가져가려 할 때 한쪽만 성립하는가"를
-- 확인하는 테스트다. 이 두 개가 통과하지 못하면 교환장을 열면 안 된다.
-- ============================================================================

do $$
declare v jsonb; v_err text; v_c1 text; v_c2 text; v_c3 text; v_listing text; v_pass int := 0; v_fail int := 0;
  procedure_note text;
begin
  -- 시드
  insert into meoktu.profiles(id,email,name,role,cash) values
    ('A','a@t.io','투자자A','investor',1000000),
    ('B','b@t.io','투자자B','investor',1000000),
    ('C','c@t.io','투자자C','investor',1000000),
    ('O','o@t.io','사장','owner',0);
  insert into meoktu.restaurants(id,owner_id,name,category,region,verification_status)
    values ('R1','O','샘플식당','한식','서울 마포구','verified'),
           ('R2',null,'다른식당','한식','서울 마포구','verified');
  insert into meoktu.funds(id,restaurant_id,status,goal,max_discount,started_at,ends_at)
    values ('F1','R1','funding',10000000,40,now()-interval '1 day',now()+interval '30 days');

  -- ① 모금 중 투자: 모금액이 늘고 잔액이 줄어야 한다.
  v := meoktu.invest('A','F1',50000);
  if (v->>'matched')::bigint = 50000
     and (select raised from meoktu.funds where id='F1') = 50000
     and (select cash from meoktu.profiles where id='A') = 950000
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 모금 중 투자 반영 이상: %', v; end if;

  -- ② 모금 중 참여자에게는 early 가 붙는다(2차 매수자는 안 붙는다).
  if (select early from meoktu.positions where user_id='A' and fund_id='F1')
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 모금 중 참여자 early 누락'; end if;

  -- ③ 1,000원 단위 위반
  begin v := meoktu.invest('A','F1',1500); v_fail:=v_fail+1; raise notice '✗ 단위 위반이 통과됨';
  exception when others then v_pass:=v_pass+1; end;

  -- ④ 개인 한도(목표액 1% = 10만원) 초과
  begin v := meoktu.invest('A','F1',60000); v_fail:=v_fail+1; raise notice '✗ 개인 한도 초과가 통과됨';
  exception when others then v_pass:=v_pass+1; end;

  -- ⑤ 잔액 부족
  update meoktu.profiles set cash = 1000 where id='B';
  begin v := meoktu.invest('B','F1',50000); v_fail:=v_fail+1; raise notice '✗ 잔액 부족이 통과됨';
  exception when others then v_pass:=v_pass+1; end;
  update meoktu.profiles set cash = 1000000 where id='B';

  -- ⑥ 모금 중 즉시 회수 → 잔액 복귀
  v := meoktu.withdraw_investment('A','F1',20000);
  if (v->>'matched')::bigint = 20000
     and (select cash from meoktu.profiles where id='A') = 1000000 - 30000
     and (select raised from meoktu.funds where id='F1') = 30000
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 즉시 회수 결과 이상: %', v; end if;

  -- ⑥-1 남은 모금액보다 크게 넣으면 넘은 만큼은 받지 않는다(부분 체결).
  insert into meoktu.funds(id,restaurant_id,status,goal,raised,max_discount,started_at,ends_at)
    values ('F2','R1','funding',5000000,4990000,40,now()-interval '1 day',now()+interval '10 days');
  v := meoktu.invest('B','F2',50000);
  if (v->>'matched')::bigint = 10000
     and (select raised from meoktu.funds where id='F2') = 5000000
     and (select cash from meoktu.profiles where id='B') = 990000
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 부분 체결 이상: %', v; end if;

  -- ⑥-2 목표액을 채우면 예약 거래로 넘어간다.
  if (select status from meoktu.funds where id='F2') = 'trading'
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 목표 달성 후에도 모금 중'; end if;

  -- ⑥-3 예약 거래 FIFO: B가 회수 주문, C가 투자 주문 → 매칭되고 B에게 현금이 간다.
  v := meoktu.withdraw_investment('B','F2',5000);
  if (v->>'queued')::bigint = 5000
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 매수자 없는데 체결됨: %', v; end if;
  v := meoktu.invest('C','F2',5000);
  if (v->>'matched')::bigint = 5000
     and (select amount from meoktu.positions where user_id='C' and fund_id='F2') = 5000
     and (select cash from meoktu.profiles where id='B') = 995000
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ FIFO 매칭 이상: %', v; end if;

  -- ⑥-4 2차 매수자에게는 early 가 붙지 않는다.
  if not (select early from meoktu.positions where user_id='C' and fund_id='F2')
  then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 2차 매수자에게 early 가 붙음'; end if;

  -- ⑥-5 자가거래 방지: 같은 사람이 양쪽에 걸어도 체결되지 않는다.
  v := meoktu.withdraw_investment('C','F2',5000);
  begin
    v := meoktu.invest('C','F2',5000);
    v_fail:=v_fail+1; raise notice '✗ 회수 대기 중인데 투자가 통과됨';
  exception when others then v_pass:=v_pass+1; end;

  -- ⑦ 쿠폰 교환: 이중거래 방지 (핵심)
  insert into meoktu.coupons(id,user_id,restaurant_id,title,discount,max_discount_won,type,status,expires_at) values
    ('C1','A','R1','A의 쿠폰',30,10000,'fund','available',now()+interval '60 days'),
    ('C2','B','R2','B의 쿠폰',32,12000,'fund','available',now()+interval '60 days'),
    ('C3','C','R2','C의 쿠폰',31,11000,'fund','available',now()+interval '60 days');

  v := meoktu.list_coupon('A','C1','{}','{}',0,true,'');
  v_listing := v->>'listingId';
  if (select status from meoktu.coupons where id='C1') = 'listed'
    then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 등록 후 쿠폰이 listed 가 아님'; end if;

  -- B 가 먼저 가져간다
  v := meoktu.instant_swap('B',v_listing,'C2');
  if (select user_id from meoktu.coupons where id='C1') = 'B'
     and (select user_id from meoktu.coupons where id='C2') = 'A'
    then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 소유자 교환이 안 됨'; end if;

  -- C 가 같은 매물을 가져가려 하면 반드시 실패해야 한다
  begin
    v := meoktu.instant_swap('C',v_listing,'C3');
    v_fail:=v_fail+1; raise notice '✗ 이중거래 발생! C 도 같은 매물을 가져감';
  exception when others then v_pass:=v_pass+1; end;

  -- C 의 쿠폰은 그대로 C 가 갖고 있어야 한다
  if (select user_id from meoktu.coupons where id='C3') = 'C'
    then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 실패한 거래인데 C 쿠폰이 넘어감'; end if;

  -- ⑧ 에스크로: 같은 쿠폰으로 두 곳에 동시 제안 불가
  insert into meoktu.coupons(id,user_id,restaurant_id,title,discount,max_discount_won,type,status,expires_at) values
    ('C4','A','R1','A쿠폰2',30,10000,'fund','available',now()+interval '60 days'),
    ('C5','B','R2','B쿠폰2',31,11000,'fund','available',now()+interval '60 days'),
    ('C6','C','R2','C쿠폰2',30,10000,'fund','available',now()+interval '60 days');
  v := meoktu.list_coupon('A','C4','{}','{}',0,false,''); v_c1 := v->>'listingId';
  v := meoktu.list_coupon('C','C6','{}','{}',0,false,''); v_c2 := v->>'listingId';
  v := meoktu.offer_coupon('B',v_c1,'C5','');
  if (select status from meoktu.coupons where id='C5') = 'offered'
    then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 제안 후 에스크로 잠김 안 됨'; end if;
  begin
    v := meoktu.offer_coupon('B',v_c2,'C5','');
    v_fail:=v_fail+1; raise notice '✗ 같은 쿠폰으로 두 곳에 제안됨(에스크로 뚫림)';
  exception when others then v_pass:=v_pass+1; end;

  -- ⑨ 할인율 차이 10%p 이상은 거절
  insert into meoktu.coupons(id,user_id,restaurant_id,title,discount,max_discount_won,type,status,expires_at)
    values ('C7','B','R2','격차큰쿠폰',15,10000,'fund','available',now()+interval '60 days');
  v_err := meoktu.check_swap(v_c2,'C7','B');
  if v_err is not null then v_pass:=v_pass+1;
    else v_fail:=v_fail+1; raise notice '✗ 할인율 격차 15 vs 30 인데 통과됨'; end if;

  -- ⑩ 제안 철회하면 에스크로가 풀린다
  v := meoktu.resolve_offer('B',(select id from meoktu.coupon_offers where offer_coupon_id='C5' and status='pending'),'withdrawn');
  if (select status from meoktu.coupons where id='C5') = 'available'
    then v_pass:=v_pass+1; else v_fail:=v_fail+1; raise notice '✗ 철회 후 에스크로가 안 풀림'; end if;

  raise notice '=== 통과 % / 실패 % ===', v_pass, v_fail;
  if v_fail > 0 then raise exception 'RPC 검증 실패 %건', v_fail; end if;
end $$;
