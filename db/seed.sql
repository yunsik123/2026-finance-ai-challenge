-- 개발/심사용 가상 사업체·모집 6건. 실제 고객·신용정보나 투자상품이 아니다.
begin;

alter table public.businesses disable trigger guard_business_review_trigger;
insert into public.businesses(
  id, user_id, name, category, business_number, address, monthly_sales,
  business_age, description, owner_story, highlights, menu_items, verification_status, verification_note, is_demo
) values
('10000000-0000-4000-8000-000000000001',null,'온기린 식당','한식','101-81-10001','서울 성동구 성수이로 18',31800000,8,
  '매일 아침 가락시장에서 공수한 제철 채소와 갓 지은 가마솥밥으로 인근 직장인과 동네 주민의 든든한 한 끼를 책임져온 8년 차 성수동 대표 한식당입니다.',
  '어릴 적 어머니가 차려주시던 따뜻한 집밥 한 상의 온기를 전하고 싶어 성수동에 문을 연 지 8년이 흘렀습니다. 유행을 좇기보다는 매일 먹어도 속이 편안한 건강한 식사를 만드는 것이 저희의 변함없는 철학입니다. 노후된 주방 설비를 안전한 친환경 저전력 인덕션으로 교체하여 조리 환경을 개선하고, 앞으로도 10년, 20년 변함없는 온기를 전하겠습니다.',
  '["#성수동솥밥명가", "#제철건강집밥", "#8년전통한식", "#직장인점심성지", "#정갈한7첩반상"]'::jsonb,
  '[{"name":"제철 버섯 영양 솥밥 정식","price":14000,"description":"6가지 제철 버섯과 은행, 밤을 넣은 가마솥 밥과 정갈한 7첩 계절 반상","isSignature":true,"category":"솥밥정식"},{"name":"한우 사골 된장찌개와 직화 제육","price":13000,"description":"24시간 푹 고아낸 한우 사골 육수에 불향 가득 직화 제육볶음 세트","isSignature":true,"category":"정식"},{"name":"완도 활전복 해물 뚝배기","price":18000,"description":"살아있는 완도 전복과 신선한 해산물이 듬뿍 들어간 시원한 보양 뚝배기","isSignature":false,"category":"특선"},{"name":"수제 떡갈비 구이 (단품 추가)","price":8000,"description":"국내산 암퇘지와 소고기를 황금비율로 다져 구워낸 육즙 가득 떡갈비","isSignature":false,"category":"일품요리"}]'::jsonb,
  'verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000002',null,'목화 로스터리','카페','101-81-10002','서울 마포구 성미산로 42',24100000,6,
  '연남동 조용한 골목 끝에서 직접 생두를 선별·로스팅하며 스페셜티 원두 납품과 정기구독 서비스를 함께 운영하는 6년 차 로스터리 카페입니다.',
  '연남동 작은 공간에서 커피를 볶기 시작한 지 어느덧 6년이 되었습니다. 좋은 커피 한 잔이 누군가의 지친 하루를 위로할 수 있다는 믿음으로, 매일 새벽 결점두를 손으로 골라내고 기후에 맞춰 로스팅 프로파일을 세밀하게 조율합니다. 이번 펀딩은 신형 12kg 대형 로스터 도입을 통해 더 안정적인 품질의 구독 원두를 생산하고, 단골 구독자분들과 투자자분들께 더 깊고 다채로운 커피를 선보이기 위한 새로운 도전입니다.',
  '["#스페셜티로스터리", "#연남동핸드드립", "#원두정기구독", "#수제디저트페어링", "#6년단골성지"]'::jsonb,
  '[{"name":"성미산 블렌드 핸드드립","price":6500,"description":"다크초콜릿의 묵직함과 헤이즐넛의 고소함, 깔끔한 후미가 매력적인 시그니처 블렌드","isSignature":true,"category":"핸드드립"},{"name":"에티오피아 예가체프 G1 워시드","price":7000,"description":"은은한 재스민 꽃향기와 살구, 베리류의 화사한 산미가 돋보이는 싱글오리진","isSignature":true,"category":"싱글오리진"},{"name":"이달의 로스터리 구독 원두 (200g)","price":16000,"description":"갓 볶은 제철 스페셜티 싱글오리진 원두 2종 정기 배송 패키지","isSignature":false,"category":"원두"},{"name":"바닐라빈 까눌레 & 휘낭시에 세트","price":6800,"description":"마다가스카르산 천연 바닐라빈과 프랑스 고메버터로 매일 아침 구워내는 구움과자","isSignature":false,"category":"디저트"}]'::jsonb,
  'verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000003',null,'일구의 식탁','양식','101-81-10003','서울 종로구 자하문로 91',19600000,4,
  '매일 아침 유기농 세몰리나와 달걀노른자로 직접 제면하는 생면 파스타와 서촌의 계절 코스를 선보이는 4년 차 이탈리안 레스토랑입니다.',
  '건면에서는 결코 느낄 수 없는 생면 고유의 쫄깃하고 부드러운 식감, 그리고 계절 식재료가 뿜어내는 깊은 풍미를 접시에 담아냅니다. 예약제로만 운영하며 테이블 하나하나에 정성을 쏟아왔지만, 찾아주시는 많은 분들의 발길을 돌려보내야 했던 아쉬움이 컸습니다. 이번 공간 확장으로 점심 생면 워크숍과 더 많은 좌석을 마련하여 서촌을 찾는 분들께 특별한 미식 경험을 선물하겠습니다.',
  '["#서촌생면파스타", "#자가제면워크숍", "#이탈리안코스요리", "#데이트예약명소", "#내추럴와인페어링"]'::jsonb,
  '[{"name":"생트러플 타야린 파스타","price":24000,"description":"매일 아침 뽑은 얇은 타야린 생면에 이탈리아산 생트러플 버터 소스를 듬뿍 얹은 시그니처","isSignature":true,"category":"파스타"},{"name":"포르치니 버섯 비프 라구 파파르델레","price":22000,"description":"8시간 동안 정성껏 끓여낸 진한 소고기 라구와 넓적한 파파르델레 생면","isSignature":true,"category":"파스타"},{"name":"웻에이징 한우 채끝 스테이크 (200g)","price":45000,"description":"2주간 저온 숙성하여 숯불 향을 입힌 최상급 한우 채끝과 구운 계절 채소","isSignature":false,"category":"메인"},{"name":"수제 티라미수와 에스프레소","price":9000,"description":"사보이아르디 쿠키와 마스카포네 치즈로 정통 방식으로 만든 디저트","isSignature":false,"category":"디저트"}]'::jsonb,
  'verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000004',null,'행궁 종이공방','생활·서비스','101-81-10004','경기 수원시 팔달구 행궁로 27',16400000,5,
  '전통 닥나무 한지를 현대적 감각의 공예품과 인테리어 소품으로 재해석하고, 원데이 클래스를 운영하는 수원 행궁동 대표 문화 공방입니다.',
  '천 년을 숨 쉬는 우리의 전통 한지가 박물관 속 유물이 아니라, 누구나 일상에서 만지고 느끼는 따뜻한 예술이 되기를 꿈꿉니다. 아이부터 직장인, 외국인 관광객까지 한지를 뜯고 붙이며 마음을 치유하는 공간을 5년간 가꾸어왔습니다. 평일 단체 체험 공간을 확장하여 학생들과 직장인 워크숍 수요를 수용하고, 전통의 아름다움을 더 널리 나누고자 합니다.',
  '["#수원행궁동공방", "#전통한지원데이클래스", "#문화체험워크숍", "#핸드메이드한지조명", "#힐링체험공간"]'::jsonb,
  '[{"name":"한지 달 무드등 만들기 원데이 클래스","price":35000,"description":"전통 한지의 은은한 빛 투과를 활용해 나만의 감성 무드등을 제작하는 90분 체험","isSignature":true,"category":"체험클래스"},{"name":"천연 염색 한지 엽서 & 책갈피 세트","price":12000,"description":"쪽, 치자 등 천연 염료로 물들인 고급 수제 한지 엽서 5종 세트","isSignature":true,"category":"공예품"},{"name":"전통 닥종이 인형 공예 키트","price":25000,"description":"집에서도 손쉽게 한지 공예의 멋을 즐길 수 있는 올인원 DIY 키트","isSignature":false,"category":"DIY키트"}]'::jsonb,
  'verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000005',null,'전포 소리수선소','생활·서비스','101-81-10005','부산 부산진구 전포대로 186',22400000,7,
  '빈티지 턴테이블, 진공관 앰프, 수동 아날로그 음향 기기의 정밀 복원 수리와 청음실을 결합한 부산 전포동 전문 수리 스튜디오입니다.',
  '음악이 디지털 파일로 소비되는 시대지만, LP판 위를 긁고 지나가는 바늘의 아날로그 질감은 사람의 마음을 울리는 고유한 울림이 있습니다. 버려질 위기에 처한 빈티지 기기들을 한 땀 한 땀 살려내며 기기의 역사와 주인의 추억을 복원한다는 자부심으로 7년을 지켜왔습니다. 최신 정밀 계측 장비를 도입해 수리 기간을 획기적으로 줄이고 더 완벽한 음질을 복원해 드리겠습니다.',
  '["#빈티지오디오수리", "#턴테이블전문복원", "#전포카페거리명소", "#아날로그청음실", "#7년경력장인정신"]'::jsonb,
  '[{"name":"턴테이블 카트리지 정밀 정렬 & 세팅","price":40000,"description":"톤암 각도, 안티스케이팅, 침압 정밀 계측을 통한 최적의 LP 재생 밸런스 조정","isSignature":true,"category":"정밀수리"},{"name":"빈티지 앰프 전해콘덴서 오버홀","price":150000,"description":"노후 부품을 오디오 그레이드 부품으로 전면 교체하여 잡음 제거 및 출력 복원","isSignature":true,"category":"오버홀"},{"name":"프리미엄 LP 클리닝 & 정전기 방지 케어","price":15000,"description":"초음파 세척기를 이용한 미세 홈 이물질 제거 및 보호 슬리브 증정","isSignature":false,"category":"케어"}]'::jsonb,
  'verified','가상 투자 검토 예시',true),
('10000000-0000-4000-8000-000000000006',null,'은행동 빵실험실','카페','101-81-10006','대전 중구 중앙로 164',28700000,3,
  '지역 농산물 발효빵과 온라인 선물세트를 판매하는 베이커리입니다.',
  '빵의 도시 대전에서, 매일 먹어도 더부룩하지 않고 구수함이 입안 가득 맴도는 천연 발효빵을 만들겠다는 고집으로 시작했습니다. 첨가물 없이 물, 밀가루, 소금, 그리고 오랜 시간의 발효만으로 빵의 본질을 찾습니다. 온라인 택배 주문이 급증함에 따라 항온 항습 발효실과 신선 포장 라인을 증설하여 전국 각지의 고객분들께 당일 구운 최상의 빵을 보내드리겠습니다.',
  '["#대전빵지순례", "#천연발효사워도우", "#지역유기농밀", "#속편한비건빵", "#온라인주문폭주"]'::jsonb,
  '[{"name":"보문산 맷돌 사워도우 깜빠뉴","price":8500,"description":"직접 맷돌로 제분한 통밀과 72시간 저온 발효종으로 구워낸 겉바속촉 시그니처 식사빵","isSignature":true,"category":"천연발효빵"},{"name":"공주 밤 듬뿍 발효 식빵","price":9000,"description":"달콤한 국산 통밤이 아낌없이 들어간 쫄깃하고 부드러운 유기농 식빵","isSignature":true,"category":"식빵"},{"name":"무화과 피칸 호밀 바게트","price":6500,"description":"와인에 졸인 건무화과와 고소한 피칸이 씹히는 담백한 유럽식 식사 바게트","isSignature":false,"category":"바게트"},{"name":"시그니처 발효빵 4종 홈 딜리버리 박스","price":32000,"description":"당일 구운 베스트 빵 4종을 특수 산소 차단 포장으로 집까지 배송하는 세트","isSignature":false,"category":"선물세트"}]'::jsonb,
  'verified','가상 투자 검토 예시',true)
on conflict(id) do update set
  name=excluded.name, category=excluded.category, address=excluded.address,
  monthly_sales=excluded.monthly_sales, business_age=excluded.business_age,
  description=excluded.description, owner_story=excluded.owner_story,
  highlights=excluded.highlights, menu_items=excluded.menu_items,
  verification_status='verified', is_demo=true, updated_at=now();
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
