-- 개발/심사용 가상 사업체·모집 6건. 실제 고객·신용정보나 투자상품이 아니다.
begin;

alter table public.businesses disable trigger guard_business_review_trigger;
insert into public.businesses(
  id, user_id, name, category, business_number, address, monthly_sales,
  business_age, description, verification_status, verification_note, is_demo
) values
('10000000-0000-4000-8000-000000000001',null,'온기린 식당','한식','101-81-10001','서울 성동구 성수이로 18',31800000,8,'제철 식재료와 인근 직장인 단골을 중심으로 8년째 운영 중인 한식당입니다.','verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000002',null,'목화 로스터리','카페','101-81-10002','서울 마포구 성미산로 42',24100000,6,'직접 로스팅한 원두와 정기구독 매출을 함께 운영하는 연남동 소형 로스터리입니다.','verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000003',null,'일구의 식탁','양식','101-81-10003','서울 종로구 자하문로 91',19600000,4,'예약제 생면 파스타와 계절 코스를 운영하는 서촌 레스토랑입니다.','verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000004',null,'행궁 종이공방','생활·서비스','101-81-10004','경기 수원시 팔달구 행궁로 27',16400000,5,'관광객 한지 공예 체험과 기업 워크숍을 운영하는 로컬 공방입니다.','verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000005',null,'전포 소리수선소','생활·서비스','101-81-10005','부산 부산진구 전포대로 186',22400000,7,'오디오 수리와 중고 기기 판매를 결합한 전포동 전문 수리점입니다.','verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000006',null,'은행동 빵실험실','카페','101-81-10006','대전 중구 중앙로 164',28700000,3,'지역 농산물 발효빵과 온라인 선물세트를 판매하는 베이커리입니다.','verified','가상 투자 검토 예시',true)
on conflict(id) do update set
  name=excluded.name, category=excluded.category, address=excluded.address,
  monthly_sales=excluded.monthly_sales, business_age=excluded.business_age,
  description=excluded.description, verification_status='verified', is_demo=true, updated_at=now();
alter table public.businesses enable trigger guard_business_review_trigger;

insert into public.business_metrics(
  business_id, sales_6m, operating_cash_flow, debt_total, monthly_debt_payment,
  overdue_count, employee_count, tax_compliant, foot_traffic_growth,
  local_sales_growth, competitor_density, closure_rate, repeat_rate,
  digital_sales_ratio, source_dates
) values
('10000000-0000-4000-8000-000000000001',array[25200000,26700000,27400000,28900000,30100000,31800000],6400000,42000000,1450000,0,5,true,8.4,6.1,.54,7.8,62,31,'{"sales":"2026-07","commercial_area":"2026-06"}'),
('10000000-0000-4000-8000-000000000002',array[21800000,22100000,22900000,22600000,23600000,24100000],4200000,35000000,1320000,0,3,true,3.2,4.5,.71,10.4,48,44,'{"sales":"2026-07","commercial_area":"2026-06"}'),
('10000000-0000-4000-8000-000000000003',array[18100000,20500000,19200000,21400000,18700000,19600000],1900000,68000000,2650000,1,4,true,5.1,3.8,.83,13.7,41,22,'{"sales":"2026-07","commercial_area":"2026-06"}'),
('10000000-0000-4000-8000-000000000004',array[13900000,14500000,15100000,14900000,15800000,16400000],3600000,18000000,720000,0,2,true,6.8,5.8,.62,9.1,55,18,'{"sales":"2026-07","commercial_area":"2026-06"}'),
('10000000-0000-4000-8000-000000000005',array[20500000,21100000,20800000,21600000,21900000,22400000],4700000,26000000,950000,0,3,true,4.7,4.1,.76,11.8,68,27,'{"sales":"2026-07","commercial_area":"2026-06"}'),
('10000000-0000-4000-8000-000000000006',array[22100000,23600000,24800000,25900000,27300000,28700000],5900000,31000000,1100000,0,5,true,5.9,6.4,.58,8.6,49,46,'{"sales":"2026-07","commercial_area":"2026-06"}')
on conflict(business_id) do update set
  sales_6m=excluded.sales_6m, operating_cash_flow=excluded.operating_cash_flow,
  debt_total=excluded.debt_total, monthly_debt_payment=excluded.monthly_debt_payment,
  foot_traffic_growth=excluded.foot_traffic_growth, local_sales_growth=excluded.local_sales_growth,
  competitor_density=excluded.competitor_density, closure_rate=excluded.closure_rate,
  source_dates=excluded.source_dates, updated_at=now();

delete from public.credit_assessments
where business_id in (
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006'
);
insert into public.credit_assessments(
  business_id, score, s_grade, risk_level, funding_limit, components, missing_fields, model_version, is_official
) values
('10000000-0000-4000-8000-000000000001',84.3,'S2','low',41900000,'{"매출 지속성":88,"현금흐름 여력":86,"부채 부담":78,"사업 운영 안정성":91,"상권 회복력":83}','{}','moa-risk-v2-demo',false),
('10000000-0000-4000-8000-000000000002',71.8,'S3','review',28300000,'{"매출 지속성":76,"현금흐름 여력":72,"부채 부담":70,"사업 운영 안정성":79,"상권 회복력":61}','{}','moa-risk-v2-demo',false),
('10000000-0000-4000-8000-000000000003',52.8,'S5','high',18700000,'{"매출 지속성":61,"현금흐름 여력":49,"부채 부담":34,"사업 운영 안정성":66,"상권 회복력":54}','{}','moa-risk-v2-demo',false),
('10000000-0000-4000-8000-000000000004',76.4,'S3','low',22600000,'{"매출 지속성":73,"현금흐름 여력":78,"부채 부담":84,"사업 운영 안정성":81,"상권 회복력":72}','{}','moa-risk-v2-demo',false),
('10000000-0000-4000-8000-000000000005',73.1,'S3','review',29500000,'{"매출 지속성":77,"현금흐름 여력":75,"부채 부담":82,"사업 운영 안정성":80,"상권 회복력":51}','{}','moa-risk-v2-demo',false),
('10000000-0000-4000-8000-000000000006',80.2,'S2','low',37400000,'{"매출 지속성":87,"현금흐름 여력":82,"부채 부담":76,"사업 운영 안정성":72,"상권 회복력":82}','{}','moa-risk-v2-demo',false);

alter table public.campaigns disable trigger guard_campaign_status_trigger;
alter table public.campaigns disable trigger guard_campaign_fund_config_trigger;
insert into public.campaigns(
  id, user_id, business_id, name, target_amount, duration_days, plan, risk, status, review_note, published_at
) values
('20000000-0000-4000-8000-000000000001',null,'10000000-0000-4000-8000-000000000001','노후 주방을 안전한 저전력 설비로 바꿉니다',30000000,45,'인덕션·환기 설비와 전기 증설, 공사 중 운영비에 사용합니다.','원재료 가격 상승과 공사 기간 중 매출 공백을 공급가 고정 계약과 단기 공정표로 대응합니다.','published','가상 투자 검토 예시','2026-08-01 09:00:00+09'),
('20000000-0000-4000-8000-000000000002',null,'10000000-0000-4000-8000-000000000002','로스터 교체로 구독 원두 생산량을 늘립니다',24000000,45,'12kg 로스터와 집진·덕트, 설치·검사비에 사용합니다.','원두 가격·환율 변동과 장비 도입 효과 지연을 선계약과 구독 사전예약으로 대응합니다.','published','가상 투자 검토 예시','2026-08-02 09:00:00+09'),
('20000000-0000-4000-8000-000000000003',null,'10000000-0000-4000-8000-000000000003','점심 좌석과 생면 작업실을 확장합니다',40000000,60,'인접 공간 보증금과 제면 장비, 인테리어에 사용합니다.','주변 폐업률과 경쟁 밀도, 상환 부담을 점심 사전예약 달성 조건으로 통제합니다.','published','가상 투자 검토 예시','2026-08-03 09:00:00+09'),
('20000000-0000-4000-8000-000000000004',null,'10000000-0000-4000-8000-000000000004','단체 체험실을 열어 평일 매출을 보완합니다',18000000,45,'체험 집기와 안전·환기 공사, 단체 예약 시스템에 사용합니다.','주말 관광객 의존과 임대료 상승을 평일 단체 계약 확보로 대응합니다.','published','가상 투자 검토 예시','2026-08-04 09:00:00+09'),
('20000000-0000-4000-8000-000000000005',null,'10000000-0000-4000-8000-000000000005','정밀 계측 장비로 수리 대기시간을 줄입니다',22000000,45,'정밀 계측기와 방음 작업대, 수리 부품 재고에 사용합니다.','전문 수요 의존과 기술 인력 부족을 장비 교육과 외주 기사 계약으로 대응합니다.','published','가상 투자 검토 예시','2026-08-05 09:00:00+09'),
('20000000-0000-4000-8000-000000000006',null,'10000000-0000-4000-8000-000000000006','발효실과 포장 설비로 온라인 출고를 안정화합니다',28000000,45,'저온 발효실과 자동 포장기, 전기 공사와 시험 생산에 사용합니다.','신규 경쟁과 택배 품질 위험을 온도 기록 테스트와 반품률 조건으로 통제합니다.','published','가상 투자 검토 예시','2026-08-06 09:00:00+09')
on conflict(id) do update set
  name=excluded.name, target_amount=excluded.target_amount, plan=excluded.plan,
  risk=excluded.risk, status='published', review_note=excluded.review_note,
  published_at=excluded.published_at, updated_at=now();
alter table public.campaigns enable trigger guard_campaign_status_trigger;
alter table public.campaigns enable trigger guard_campaign_fund_config_trigger;

alter table public.campaigns disable trigger guard_campaign_fund_config_trigger;
update public.campaigns set
  current_amount = case id
    when '20000000-0000-4000-8000-000000000001' then 22000000
    when '20000000-0000-4000-8000-000000000002' then 17760000
    when '20000000-0000-4000-8000-000000000003' then 12000000
    when '20000000-0000-4000-8000-000000000004' then 12600000
    when '20000000-0000-4000-8000-000000000005' then 9900000
    else 22960000 end,
  fund_status = case when id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000006') then 'closed' else 'fundraising' end,
  closed_at = case when id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000006') then '2026-08-20 18:00:00+09'::timestamptz else null end,
  max_discount_rate = case when id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000006') then 50 when id in ('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000004') then 40 else 30 end,
  min_coupon_rate = 10, coupon_max_amount = 15000,
  representative_menu = case when business_id in ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006') then '시그니처 음료·빵 세트' else '대표 메뉴' end,
  representative_menu_price = case when business_id in ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000006') then 12000 else 29000 end;
alter table public.campaigns enable trigger guard_campaign_fund_config_trigger;

insert into public.campaign_milestones(id, campaign_id, sequence_no, title, condition_text, release_percent) values
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,'설비 계약','공급계약서와 계약금 세금계산서 확인',20),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',2,'공사 착수','전기 증설·철거 작업 사진 확인',40),
('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',3,'설치 완료','설비 시운전과 잔금 세금계산서 확인',40),
('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002',1,'장비 발주','제조사 견적서와 발주서 확인',30),
('30000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002',2,'반입·설치','장비 일련번호와 설치 사진 확인',40),
('30000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000002',3,'검사·가동','안전검사서와 첫 생산 기록 확인',30),
('30000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000003',1,'수요 검증','점심 사전예약 300건 확인',10),
('30000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000003',2,'임대차 계약','확정일자 있는 계약서 원본 확인',50),
('30000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000003',3,'공간 완공','완공 사진과 제면 장비 검수',40),
('30000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000004',1,'단체 계약','학교·기업 예약 계약 8건 확인',20),
('30000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000004',2,'안전 공사','소방·환기 공사 완료 확인',45),
('30000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000004',3,'체험실 개장','집기 검수와 첫 단체 수업 확인',35),
('30000000-0000-4000-8000-000000000013','20000000-0000-4000-8000-000000000005',1,'장비·교육 계약','장비 견적과 교육 일정 확인',30),
('30000000-0000-4000-8000-000000000014','20000000-0000-4000-8000-000000000005',2,'작업대 완공','방음 측정값과 완공 사진 확인',30),
('30000000-0000-4000-8000-000000000015','20000000-0000-4000-8000-000000000005',3,'운영 개선','수리 대기시간 20% 단축 기록 확인',40),
('30000000-0000-4000-8000-000000000016','20000000-0000-4000-8000-000000000006',1,'설비 계약','발효실·포장기 통합 견적 확인',25),
('30000000-0000-4000-8000-000000000017','20000000-0000-4000-8000-000000000006',2,'시험 생산','온도 기록과 포장 파손 테스트 확인',35),
('30000000-0000-4000-8000-000000000018','20000000-0000-4000-8000-000000000006',3,'출고 안정화','4주 반품률 2% 이하 자료 확인',40)
on conflict(campaign_id, sequence_no) do update set
  title=excluded.title, condition_text=excluded.condition_text,
  release_percent=excluded.release_percent, updated_at=now();

insert into public.restaurant_monthly_sales(business_id,year_month,total_sales,coupon_sales,coupon_discount_total,coupons_used,growth_rate,bonus_rate) values
('10000000-0000-4000-8000-000000000001','2026-07-01',30100000,2100000,260000,18,0,0),
('10000000-0000-4000-8000-000000000001','2026-08-01',33800000,3500000,420000,31,12.29,2.46),
('10000000-0000-4000-8000-000000000002','2026-07-01',23600000,1800000,190000,22,0,0),
('10000000-0000-4000-8000-000000000002','2026-08-01',24100000,2200000,240000,27,2.12,.42)
on conflict(business_id,year_month) do update set total_sales=excluded.total_sales,coupon_sales=excluded.coupon_sales,
coupon_discount_total=excluded.coupon_discount_total,coupons_used=excluded.coupons_used,growth_rate=excluded.growth_rate,bonus_rate=excluded.bonus_rate;

insert into public.thematic_funds(id,name,description,region,category) values
('70000000-0000-4000-8000-000000000001','성수·연남 성장 맛집','상권 성장성과 AI 평가가 좋은 음식점을 묶은 탐색 컬렉션','서울','음식점'),
('70000000-0000-4000-8000-000000000002','로컬 카페·베이커리','지역 단골과 온라인 매출이 함께 성장하는 카페 테마','전국','카페')
on conflict(id) do update set name=excluded.name,description=excluded.description,region=excluded.region,category=excluded.category;
insert into public.thematic_fund_restaurants(thematic_fund_id,campaign_id) values
('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'),
('70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002'),
('70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000006')
on conflict do nothing;

insert into public.ai_contents(id,title,content,content_type,source_metrics) values
('80000000-0000-4000-8000-000000000001','이번 달 매출 성장 음식점','온기린 식당은 저장된 7월·8월 매출 기준 12.29% 성장했습니다.','growth','{"businessId":"10000000-0000-4000-8000-000000000001","growthRate":12.29}'),
('80000000-0000-4000-8000-000000000002','최대 쿠폰 할인율이 높은 펀드','온기린 식당과 은행동 빵실험실의 최대 쿠폰 할인율은 저장된 정책 기준 50%입니다.','coupon','{"campaignIds":["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000006"],"maxDiscountRate":50}')
on conflict(id) do update set title=excluded.title,content=excluded.content,source_metrics=excluded.source_metrics;

do $$
declare investor_one uuid; investor_two uuid; owner_one uuid;
begin
  select id into investor_one from public.profiles where email='investor@moa.local';
  select id into investor_two from public.profiles where email='investor2@moa.local';
  select id into owner_one from public.profiles where email='owner@moa.local';
  if owner_one is not null then
    update public.businesses set user_id=owner_one where id='10000000-0000-4000-8000-000000000001';
    update public.campaigns set user_id=owner_one where id='20000000-0000-4000-8000-000000000001';
  end if;
  if investor_one is not null and investor_two is not null then
    insert into public.investments(id,campaign_id,investor_id,invested_amount,accrued_discount,last_accrual_at) values
      ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',investor_one,110000,12.5,now()),
      ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',investor_two,190000,7,now()),
      ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002',investor_one,100000,17,now()-interval '2 days')
    on conflict(campaign_id,investor_id) do update set invested_amount=excluded.invested_amount,accrued_discount=excluded.accrued_discount,last_accrual_at=excluded.last_accrual_at,status='active';
    insert into public.investment_reservations(id,campaign_id,investor_id,reserved_amount,matched_amount,status,created_at) values
      ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',investor_one,50000,10000,'partial','2026-08-25 10:00:00+09')
    on conflict(id) do update set reserved_amount=excluded.reserved_amount,matched_amount=excluded.matched_amount,status=excluded.status;
    insert into public.withdrawal_requests(id,campaign_id,investor_id,requested_amount,matched_amount,status,coupon_issued,created_at) values
      ('51000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',investor_two,30000,10000,'partial',true,'2026-08-25 10:01:00+09')
    on conflict(id) do update set requested_amount=excluded.requested_amount,matched_amount=excluded.matched_amount,status=excluded.status;
    insert into public.matching_transactions(id,campaign_id,reservation_id,withdrawal_id,incoming_investor_id,outgoing_investor_id,amount,matched_at) values
      ('52000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',investor_one,investor_two,10000,'2026-08-25 10:01:00+09')
    on conflict(id) do nothing;
    insert into public.coupons(id,campaign_id,owner_id,original_investor_id,discount_rate,coupon_type,description,status,expires_at) values
      ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',investor_one,investor_one,30,'accrual','온기린 식당 투자 유지 30% 할인','available','2027-08-30'),
      ('60000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002',investor_one,investor_one,10,'dividend','로스터 교체 기념 배당 쿠폰','available','2027-02-28')
    on conflict(id) do update set owner_id=excluded.owner_id,status=excluded.status,expires_at=excluded.expires_at;
  end if;
end $$;

commit;
