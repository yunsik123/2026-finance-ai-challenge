-- 개발/심사용 가상 데이터 3건. 실제 고객·신용정보가 아니다.

insert into public.stores(id, payload) values
('ongi', '{"id":"ongi","name":"온기린 식당","category":"한식","area":"서울 성동구","growth":"+18.2%","support":92,"target":30000000,"funded":27600000,"coupon":{"title":"온기린 10% 감사 쿠폰","benefit":"식사 금액 10% 할인","condition":"2만원 이상 주문 시"},"risks":["식재료 원가 상승","공사 중 매출 공백"]}'),
('mokhwa', '{"id":"mokhwa","name":"목화 로스터리","category":"카페","area":"서울 마포구","growth":"+12.6%","support":74,"target":24000000,"funded":17760000,"coupon":{"title":"목화 커피 1잔 쿠폰","benefit":"아메리카노 1잔","condition":"참여자 전용"},"risks":["원두 가격·환율 변동","장비 도입 효과 지연"]}'),
('table', '{"id":"table","name":"일구의 식탁","category":"양식","area":"서울 종로구","growth":"+9.4%","support":61,"target":40000000,"funded":24400000,"coupon":{"title":"생면 파스타 쿠폰","benefit":"5,000원 할인","condition":"3만원 이상 주문 시"},"risks":["업력과 장기자료 부족","상환부담이 현금흐름보다 큼"]}')
on conflict(id) do update set payload=excluded.payload, updated_at=now();

insert into public.businesses(id, name, category, business_number, address, monthly_sales, business_age, description, verification_status, is_demo) values
('10000000-0000-4000-8000-000000000001','온기린 식당','한식','101-81-10001','서울 성동구 성수이로 18',31800000,8,'제철 식재료와 단골 중심 운영 가상 사업체','demo_verified',true),
('10000000-0000-4000-8000-000000000002','목화 로스터리','카페','101-81-10002','서울 마포구 성미산로 42',24100000,6,'직접 로스팅과 정기구독 가상 사업체','demo_verified',true),
('10000000-0000-4000-8000-000000000003','일구의 식탁','양식','101-81-10003','서울 종로구 자하문로 91',19600000,4,'제품력은 높지만 자료 보완이 필요한 가상 사업체','demo_verified',true)
on conflict(id) do update set name=excluded.name, monthly_sales=excluded.monthly_sales, business_age=excluded.business_age, description=excluded.description;

insert into public.business_metrics(
 business_id,segment,cb_grade,sales_6m,operating_cash_flow,debt_total,monthly_debt_payment,overdue_count,employee_count,tax_compliant,admin_penalties,owner_changes,foot_traffic_growth,local_sales_growth,competitor_density,closure_rate,repeat_rate,rating,digital_sales_ratio,qualitative_bonus,source_dates
) values
('10000000-0000-4000-8000-000000000001','숙박·음식점업',5,array[25200000,26700000,27400000,28900000,30100000,31800000],6400000,42000000,1450000,0,5,true,0,0,8.4,6.1,.54,7.8,62,4.7,31,7.5,'{"sales":"2026-07","commercial_area":"2026-06"}'),
('10000000-0000-4000-8000-000000000002','숙박·음식점업',4,array[21800000,22100000,22900000,22600000,23600000,24100000],4200000,35000000,1320000,0,3,true,0,0,3.2,4.5,.71,10.4,48,4.5,44,6.2,'{"sales":"2026-07","commercial_area":"2026-06"}'),
('10000000-0000-4000-8000-000000000003','숙박·음식점업',7,array[18100000,20500000,19200000,21400000,18700000,19600000],1900000,68000000,2650000,1,4,true,0,0,5.1,3.8,.83,13.7,41,4.6,22,5.4,'{"sales":"2026-07","commercial_area":"2026-06"}')
on conflict(business_id) do update set sales_6m=excluded.sales_6m, operating_cash_flow=excluded.operating_cash_flow, debt_total=excluded.debt_total, monthly_debt_payment=excluded.monthly_debt_payment, updated_at=now();

insert into public.credit_assessments(business_id,score,s_grade,funding_limit,components,missing_fields) values
('10000000-0000-4000-8000-000000000001',84.3,'S2',41900000,'{"매출 성장":25,"상권 내 경쟁력":11,"현금흐름 지속성":18.3,"부채 회복력":13.6,"경영 안정성":8.9,"비계량 가점":7.5}','{}'),
('10000000-0000-4000-8000-000000000002',71.8,'S4',28300000,'{"매출 성장":19.3,"상권 내 경쟁력":8.7,"현금흐름 지속성":16.8,"부채 회복력":12.7,"경영 안정성":8.1,"비계량 가점":6.2}','{}'),
('10000000-0000-4000-8000-000000000003',52.8,'S6',18700000,'{"매출 성장":17.8,"상권 내 경쟁력":8.4,"현금흐름 지속성":13.9,"부채 회복력":0,"경영 안정성":7.3,"비계량 가점":5.4}','{}');

do $$
declare b record; prefix text;
begin
  for b in select id,name,address,category from public.businesses where is_demo loop
    prefix := 'business:' || b.id::text;
    insert into public.knowledge_nodes(id,business_id,node_type,label) values
      (prefix,b.id,'Business',b.name),
      ('owner:'||b.id,b.id,'Owner','가상 대표자'),
      ('area:'||b.id,b.id,'CommercialArea',split_part(b.address,' ',2)),
      ('category:'||b.id,b.id,'Category',b.category),
      ('sales:'||b.id,b.id,'Metric','최근 6개월 매출'),
      ('cash:'||b.id,b.id,'Metric','영업현금흐름'),
      ('debt:'||b.id,b.id,'Risk','부채·상환부담'),
      ('grade:'||b.id,b.id,'Assessment','성장등급')
    on conflict(id) do update set label=excluded.label;

    insert into public.knowledge_edges(id,business_id,source_node_id,target_node_id,relation_type,evidence) values
      ('owner-business:'||b.id,b.id,'owner:'||b.id,prefix,'OPERATES','가상 프로필'),
      ('business-area:'||b.id,b.id,prefix,'area:'||b.id,'LOCATED_IN',b.address),
      ('business-category:'||b.id,b.id,prefix,'category:'||b.id,'BELONGS_TO',b.category),
      ('business-sales:'||b.id,b.id,prefix,'sales:'||b.id,'HAS_SIGNAL','월별 카드매출'),
      ('business-cash:'||b.id,b.id,prefix,'cash:'||b.id,'HAS_SIGNAL','영업현금흐름'),
      ('business-debt:'||b.id,b.id,prefix,'debt:'||b.id,'EXPOSED_TO','부채·월상환액'),
      ('sales-grade:'||b.id,b.id,'sales:'||b.id,'grade:'||b.id,'SUPPORTS','매출 성장 구성점수'),
      ('cash-grade:'||b.id,b.id,'cash:'||b.id,'grade:'||b.id,'SUPPORTS','현금흐름 구성점수'),
      ('debt-grade:'||b.id,b.id,'debt:'||b.id,'grade:'||b.id,'LIMITS','부채 회복력 구성점수')
    on conflict(id) do update set evidence=excluded.evidence;
  end loop;
end $$;
