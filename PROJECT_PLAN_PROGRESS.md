# MOA 프로젝트 계획·진행상황 및 인수인계

> 최종 갱신: 2026-08-30 (Asia/Seoul)  
> 목적: 다음 작업자가 현재 구현 범위, DB 무결성, Mock 경계, 검증 결과와 후속 우선순위를 한 문서에서 확인한다.

## 1. 서비스 정의

MOA는 음식점·소상공인이 소비자에게 자금을 조달하고, 투자자가 현금 배당이나 지분 대신 음식점에서 사용할 쿠폰을 받는 서비스다. 모집 종료 후 펀드 총액은 고정되고 기존 투자자의 회수 요청과 신규 투자자의 투자 예약을 1,000원 단위 FIFO로 교체한다.

핵심 흐름은 `펀딩 심사 → 펀드 개설 → 모집 중 직접 투자/회수 → 모집 종료 → 예약/회수 자동 매칭 → 쿠폰 누적/발급/사용`이다.

## 2. 작업 전 점검 결과

### 기존에 이미 구현되어 있던 기능

| 기능 | 관련 파일 | 실제 작동 상태 |
|---|---|---|
| 투자자/소상공인/운영자 회원 구분 | `db/schema.sql`, `src/supabase-cloud.js`, `src/app.js` | Supabase Auth, `profiles.role`, 역할별 화면, RLS 연결 |
| 사업체·6개월 재무·부채·상권 입력 | `index.html`, `src/app.js`, `commercial_area/` | 계정별 DB 저장, 주소 기반 Mock 상권 데이터 연결 |
| 정량 위험 심사 | `src/supabase-cloud.js` | 5대 요인, S등급, 위험도, 최대 한도를 `credit_assessments`에 저장 |
| 모집안 심사·승인 | `db/schema.sql`, `src/app.js` | 공시/평가/지급단계를 RPC에서 검사, 승인 전 비공개 |
| 예치·증빙·단계별 지급 | `db/schema.sql`, `api/ai.js` | 예치 확인, 이미지 OCR, 순차 지급, 감사 로그 연결 |
| AI 상담 | `api/ai.js`, `src/submission-status.js` | 현재 사용자 저장 상태를 컨텍스트로 사용, 누락 자료는 규칙 기반 답변 |

### 작업 전 일부 구현 상태

- 사업자등록번호·기본정보는 있었지만 대표자, 영업신고, 개업일, POS/카드 동의와 검증 어댑터가 없었다.
- AI 정량 점수는 있었지만 등급 사유, 긍정/위험 요인, 한도 설명이 한 화면에 연결되지 않았다.
- 펀드에는 목표·기간·계획만 있었고 심사 한도 강제와 쿠폰 정책이 없었다.
- `funding_commitments`는 참여 의사/예치 기록이어서 실제 투자잔액이나 회수와 달랐다.
- 중단된 `src/supabase-cloud.js` 변경은 존재하지 않는 테이블을 직접 INSERT/PATCH했으며 원자성이 없고 UI 호출도 없었다.

### 작업 전 미구현 상태

- 실제 투자잔액, 1% 한도, 1,000원 단위, 자동 모집 종료
- 종료 후 FIFO 투자 예약/회수 매칭과 펀드 총액 불변성
- 시간 기반 쿠폰 누적, 중간/자동/회수 발급, 사용·소유권
- 투자자 Portfolio 및 소상공인 쿠폰 비용 Dashboard
- 매출 성장 보너스, 배당 쿠폰, 쿠폰 교환, 랭킹/테마/인사이트

## 3. 이번 작업에서 구현한 기능

### P0 핵심 흐름

- Mock 사업자 검증 어댑터와 대표자/영업신고/개업일/POS·카드 동의 저장
- 설명 가능한 심사 카드: S등급, 가능 여부, 최대 한도, 5대 요인, 긍정/위험 근거
- 펀드 개설 시 최대/최소 쿠폰율, 할인 상한, 대표 메뉴·가격, 추가 혜택 저장
- AI 심사 한도를 넘는 목표금액을 UI와 DB 트리거에서 모두 거부
- 모집 중 즉시 투자/추가 투자/일부·전액 회수와 목표 달성 자동 종료
- 모집 종료 후 투자 예약/회수 요청 FIFO 매칭
- 목표액 1%의 1인 한도와 모든 투자·회수·매칭의 1,000원 단위 강제
- 실제 투자잔액, 예약잔액, 회수잔액, 매칭 원장을 Supabase DB에서 관리
- 투자금·유지시간 기반 쿠폰 할인율 누적, 최대율 자동 발급(접근 시 lazy settlement), 최소율 중간 발급
- 투자금 회수 시 최소 발급률 이상 쿠폰 발급, 미만이면 미발급
- 쿠폰 사용 시 주문금액/할인액/사용시각 저장
- 투자자 Portfolio 및 소상공인 펀드·쿠폰 비용 Dashboard

### P1/P2 연결

- 월 매출 성장률에 따른 투자자 쿠폰 보너스
- 소상공인 전 투자자 배당 쿠폰
- 할인율 차이 10%p 미만 쿠폰의 원자적 소유권 교환
- 저장된 캠페인만 사용하는 종합 랭킹, AI 인사이트, 테마 컬렉션
- CSV 권장 열/예시와 영수증·계약서 사진 촬영 가이드를 화면에 추가

## 4. DB 변경

### 기존 테이블 확장

- `businesses`: 대표자, 개업일, 영업신고, 신청자 일치, POS/카드 동의
- `business_metrics`: 카드/현금 6개월 매출, 고정비·임대료·인건비·원재료비, 행정처분/대표자 변경
- `campaigns`: `fund_status`, `current_amount`, 종료시각, 쿠폰 정책, 대표 메뉴/가격, 이미지/추가 혜택
- 원격에 남아 있던 빈 legacy `coupons` 테이블은 삭제하지 않고 호환 컬럼과 기본값을 추가했다.

### 새 테이블

`fund_policies`, `investments`, `investment_reservations`, `withdrawal_requests`, `matching_transactions`, `coupon_transactions`, `coupon_trades`, `dividend_coupons`, `restaurant_monthly_sales`, `ai_contents`, `thematic_funds`, `thematic_fund_restaurants`

`coupons`는 기존 이름을 재사용해 소유자, 캠페인, 할인율, 유형, 사용상태, 주문금액, 할인액을 확장했다.

### 주요 RPC

- `invest_fund`: 투자 한도/단위/상태 검사, 모집 중 잔액 반영 또는 종료 후 예약
- `withdraw_fund`: 모집 중 즉시 회수 또는 종료 후 회수 대기
- `process_fund_matching`: 캠페인 advisory lock + 행 잠금 + FIFO `SKIP LOCKED`
- `settle_investment_coupon`, `issue_accrued_coupon`, `use_coupon`
- `close_fund`, `record_monthly_sales`, `issue_dividend_coupon`
- `create_coupon_trade`, `accept_coupon_trade`

## 5. 투자·회수·매칭 무결성

1. 캠페인별 `pg_advisory_xact_lock`과 캠페인 행 `FOR UPDATE`로 동시 거래를 직렬화한다.
2. 예약과 회수는 `(created_at, id)` 순서로 선택해 FIFO를 보장한다.
3. 양쪽 주문의 남은 금액 중 작은 값을 1,000원 단위로 매칭한다.
4. 기존 투자자의 잔액을 줄이고 신규 투자자의 잔액을 같은 트랜잭션에서 늘린다.
5. `matching_transactions`에 양쪽 주문, 사용자, 금액을 기록한다.
6. 모집 종료 후에는 `campaigns.current_amount`를 갱신하지 않는다. 따라서 펀드 총액은 변하지 않는다.
7. RLS는 투자자 본인, 해당 펀드 소상공인, 운영자만 사적 주문/잔액을 조회하게 한다.

## 6. 쿠폰 보상 로직

기본 정책은 `투자금 / 100,000 × 일별 0.5%p × 경과일`이다. 정책값은 `fund_policies`에 있어 변경 가능하다. 잔액이 변하기 직전에 기존 금액 기준 적립률을 먼저 정산해 과거 기간에 새 투자금이 소급 적용되지 않게 한다.

- 최대 할인율 도달: 최대율 쿠폰 생성 후 나머지 할인율로 새 적립 시작
- 중간 발급: 최소율 이상일 때 현재 할인율 쿠폰 생성 후 0으로 초기화
- 회수: 실제 회수/매칭 시 정산하고 최소율 이상이면 회수 쿠폰 발급
- 월 성장: 전월 대비 성장률 × 정책 배수(기본 0.2)를 적립률에 추가
- 사용: 소유자/상태/유효기간 확인 후 할인액을 계산해 `used` 처리
- 교환: 두 쿠폰을 잠그고 할인율 차이를 재검사한 뒤 같은 트랜잭션에서 소유자를 교체

## 7. AI 연결 상태

- 정량 심사는 `moa-risk-v2` 구성요인과 S등급을 유지한다.
- 화면에서 매출 변화, 연체, 상권 성장, 세금 상태를 근거로 긍정/위험과 한도 이유를 설명한다.
- AI 상담은 현재 사용자 사업·캠페인·상권·제출현황을 사용한다.
- “빠진 자료” 질문은 존재하지 않는 일반 금융서류를 지어내지 않고 실제 저장 상태만 답한다.
- `ai_contents.source_metrics`에 사용한 캠페인/지표를 저장해 존재하지 않는 음식점·숫자를 만들지 않는다.

## 8. Demo/Mock 경계

- 사업자 검증: `src/business-verification.js`의 `mock-v1`; 국세청/식품안전 API 미연결
- 상권: `commercial_area/commercial_data.json`의 예시 상권
- POS·카드 매출: 수동 입력/CSV 형식 가이드만 제공, 자동 수집 미연결
- AI 심사: 사업자 입력값 기반 보조 평가이며 공식 신용평가 아님
- 결제·예치·송금: DB 상태와 무결성만 구현, 실제 PG/은행 자금 이동 없음
- 증빙: 이미지 OCR은 동작하지만 원본 private Storage 영구보관은 미연결
- 자동 쿠폰 배치: DB 접근/거래 시 lazy settlement; 무접속 상태 정기 발급은 Supabase Cron 필요

## 9. 자료 입력 가이드

### CSV 권장 형식

UTF-8, 월은 `YYYY-MM`, 금액은 쉼표 없는 원 단위 정수:

`year_month,total_sales,card_sales,cash_sales,operating_cash_flow,fixed_cost,rent,labor_cost,material_cost`

예: `2026-08,31800000,25800000,6000000,6400000,12000000,3200000,5400000,3400000`

현재 UI는 6개월 값을 직접 입력하며 CSV 업로드/매핑은 후속 POS 연결 범위다.

### 영수증·계약서 이미지

- PNG/JPG/WebP, 파일당 6MB 이하
- 문서 한 장, 네 모서리가 보이게 수평 촬영
- 공급자, 거래일, 품목, 합계가 선명하고 반사/그림자가 없어야 함
- 여러 문서 겹침, 잘림, 손가락 가림, 심한 기울어짐은 재촬영
- 주민번호·계좌번호 등 불필요한 개인정보는 가린다.
- PDF/CSV 원본 보관은 아직 지원하지 않는다.

## 10. Demo 데이터

- 6개 사업체, 서로 다른 매출/부채/상권/등급/최대 쿠폰율
- 모집 중과 모집 완료 캠페인
- 투자자 2명, 실제 투자잔액 3건
- 50,000원 예약 중 10,000원 매칭, 30,000원 회수 중 10,000원 매칭 예시
- 적립 중 투자, 발급 쿠폰, 배당 쿠폰
- 2개 테마, 2개 근거 기반 AI 콘텐츠, 월 매출 4건

## 11. 검증 결과

- `npm test`: 문법 + Node 테스트 통과
- `npm run build`: Vite production build 통과
- `npm run db:apply`: 연결된 Supabase 스키마/시드 재적용 통과
- `node scripts/verify_live_scenarios.mjs`: 실제 Supabase에서 통과
  - 모집 중 +1,000원 투자 후 -1,000원 회수
  - 종료 펀드 30,000원 회수 요청과 기존 예약 자동 매칭
  - 매칭 전후 펀드 총액과 투자잔액 합계 불변
  - 중간 쿠폰 생성, 적립률 초기화, 30,000원 주문 사용/할인액 기록
  - 월 매출 저장과 성장률/보너스 계산
  - 활성 투자자 2명에게 배당 쿠폰 지급

## 12. 후속 우선순위와 확인 포인트

1. PG/에스크로/환불 웹훅과 실제 자금 원장 연결 전에는 “결제 완료”로 표현하지 않는다.
2. 국세청 사업자 진위, 식품안전 영업신고, 본인/계좌 실명 API를 검증 어댑터에 연결한다.
3. private Storage, 악성파일 검사, 중복 해시, 보존·파기 정책을 증빙 흐름에 추가한다.
4. Supabase Cron으로 일별 쿠폰 정산/자동 발급과 월말 매출 보너스 배치를 등록한다.
5. 추가 펀딩 라운드는 테이블을 별도 `fund_rounds`로 분리하고 재심사 한도를 적용한다.
6. 실제 금융상품 해당 여부, 전자금융·선불전자지급·소비자보호·개인정보 법률 검토가 필요하다.
7. 쿠폰 거래 취소/만료, 알림, 분쟁 처리와 감사 로그를 고도화한다.
8. 브라우저 E2E 자동화는 현재 실 DB 스크립트보다 부족하므로 Playwright 도입을 권장한다.

## 13. 주요 변경 파일

- `db/schema.sql`, `db/seed.sql`
- `src/supabase-cloud.js`, `src/app.js`, `src/styles.css`, `src/demo-campaigns.js`
- `src/business-verification.js`, `src/submission-status.js`
- `index.html`, `api/ai.js`
- `scripts/apply_supabase.mjs`, `scripts/verify_live_scenarios.mjs`
- `tests/*.test.mjs`, `package.json`

