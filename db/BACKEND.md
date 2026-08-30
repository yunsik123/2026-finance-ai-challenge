# 모아 백엔드 및 데이터베이스 구조

> 2026-08 현재 배포 구조: **Supabase (PostgreSQL + Auth + RLS)** + **Vercel Serverless Functions**
> 프론트엔드는 `src/supabase-cloud.js`가 Supabase Auth/PostgREST/RLS를 직접 사용하고, `api/ai.js`가 OpenAI API 키를 숨긴 서버리스 프록시로 동작한다.

## 아키텍처

```text
브라우저 (Vite SPA)
  │
  ├─ src/supabase-cloud.js
  │    ├─ Supabase Auth REST (/auth/v1/*)
  │    ├─ PostgREST (/rest/v1/*)
  │    └─ PostgREST RPC (/rest/v1/rpc/*)
  │
  └─ Vercel Serverless Functions
       ├─ api/ai.js (Chat + Vision OCR)
       └─ api/health.js (시스템 상태 확인)
```

## 인증 방식

1. 사용자가 역할(**투자자** 또는 **소상공인**)을 선택하고 로그인 아이디(이름) 또는 이메일과 비밀번호를 입력한다. (운영자 계정은 보안상 일반 로그인 폼에 노출되지 않으며 사전 발급된 관리자 권한으로 제어)
2. 로그인 이름은 정규화한 뒤 역할과 함께 SHA-256 고유 식별자로 안전하게 변환된다.
3. **Email Rate Limit 없는 즉시 인증**:
   - 가입(`처음 시작`) 시 `email_confirm: true`를 강제하는 서버리스 Direct Auth 핸들러를 통해 불필요한 이메일 인증 메일 발송 및 Supabase의 **Email Rate Limit(시간당 메일 발송 제한)**을 100% 원천 차단합니다.
   - 메일함 확인 링크를 누를 필요 없이 비밀번호만으로 즉시 계정이 생성되고 자동 로그인됩니다.
4. JWT 토큰으로 `profiles` 테이블을 조회하여 실제 역할을 확인하고, 폼에서 선택한 역할과 불일치 시 강제 로그아웃.
5. 세션은 `localStorage` 키 `moa.session.v2`에 저장하며, 만료 60초 전 자동 갱신.
6. `login_events` 테이블에 로그인/로그아웃 이벤트와 접속 기기 정보를 기록.

## 데이터베이스 스키마 (Supabase PostgreSQL)

스키마 원본: [`schema.sql`](./schema.sql)

| 테이블 | 저장 내용 |
|---|---|
| `profiles` | Auth 사용자 프로필 (이름, 역할, 생성일) |
| `businesses` | 소상공인 사업체 정보 (상호, 업종, 사업자번호, 주소, 매출) |
| `business_metrics` | 재무·상권 지표 (매출, 현금흐름, 부채, 상권 데이터) |
| `credit_assessments` | 신용평가 결과 (점수, 등급, 리스크 레벨, 5대 요인) |
| `financial_verification_runs` | 모집 전 재무자료 OCR 결과, 순차 교차검증, 운영자 승인 상태 |
| `knowledge_nodes`, `knowledge_edges` | 투자자·소상공인 역할별 절차와 동적 근거 그래프 |
| `user_settings` | 사용자별 공시 항목 등 설정 |
| `campaigns` | 펀딩 모집안 (목표금액, 기간, 사용계획, 위험요인, 상태) |
| `campaign_milestones` | 단계별 지급 조건 (제목, 비율, 증빙 조건, 상태) |
| `funding_commitments` | 투자자 참여 약정 (금액, 상태, 위험 동의) |
| `ocr_analyses` | AI Vision OCR 분석 결과 (문서유형, 공급자, 금액, 일치도) |
| `evidence_submissions` | 증빙 제출 내역 (마일스톤별 증빙 파일, 분석 결과) |
| `disbursements` | 자금 지급 내역 (단계별 지급액, 승인일) |
| `audit_events` | 감사 로그 (액션, 대상, 시각, 실행자) |
| `login_events` | 로그인/로그아웃 이력 (시각, User-Agent) |

### Row Level Security (RLS)

모든 테이블에 RLS 정책이 적용되어 있으며, 사용자는 본인 데이터만 접근 가능하다. 운영자(`admin`) 역할은 전체 데이터에 접근할 수 있다.

### Stored Procedures (RPC)

| 함수 | 기능 |
|---|---|
| `handle_new_user()` | 회원가입 시 프로필 자동 생성 (트리거) |
| `submit_campaign()` | 공시 6개 + 2단계 이상 마일스톤 검증 후 심사 요청 |
| `review_campaign()` | 운영자가 모집안 승인/보완요청/반려 처리 |
| `review_financial_verification()` | 운영자가 원자료 대조 후 공식평가 승인/반려 |
| `role_knowledge_graph()` | 역할과 사업체 범위의 근거 그래프 조회 |
| `submit_milestone_evidence()` | 증빙 제출 (순차 단계 검증 포함) |
| `review_evidence()` | 운영자 증빙 승인/반려 |
| `confirm_commitment_escrow()` | 투자자 예치금 확인 처리 |
| `release_milestone()` | 조건 충족 확인 후 단계별 자금 지급 승인 |

## API 엔드포인트

### Vercel Serverless Functions

| Method | Path | 기능 |
|---|---|---|
| `GET` | `/api/health` | 시스템 구성 상태 확인 (API 키, Supabase, 모델 정보) |
| `POST` | `/api/ai/chat` | AI 상담 (현재 화면 컨텍스트 기반, 최근 12개 대화 유지) |
| `POST` | `/api/ai/ocr` | Vision OCR 증빙 분석 (영수증/세금계산서 → 구조화 JSON) |
| `POST` | `/api/ai/financial-verify` | 모집 전 재무자료 다중 OCR 및 주장 교차검증 |
| `POST` | `/api/ai/story-generator` | 가게 소개·사장님 이야기·메뉴 초안 생성 |

### Supabase PostgREST (프론트엔드에서 직접 호출)

프론트엔드 가상 경로 → `src/supabase-cloud.js` 내 `cloudRequest()`가 PostgREST 쿼리로 변환:

| 가상 경로 | 실제 동작 |
|---|---|
| `/api/auth/session` (POST) | Supabase Auth 로그인/회원가입 |
| `/api/auth/session` (DELETE) | Supabase Auth 로그아웃 |
| `/api/bootstrap` | 역할별 초기 데이터 일괄 로드 |
| `/api/business` | 사업체 정보 Upsert |
| `/api/business/metrics` | 재무 지표 Upsert + 신용평가 산출 |
| `/api/disclosures` | 공시 항목 저장 |
| `/api/campaign` | 모집안 + 마일스톤 저장 |
| `/api/campaign/submit` | 운영자 심사 요청 (RPC) |
| `/api/commitments` | 투자자 참여 약정 등록 |
| `/api/evidence` | 증빙 제출 (RPC) |
| `/api/admin/*` | 운영자 심사/예치확인/자금방출 (RPC) |

## 신용평가 알고리즘

`src/supabase-cloud.js`의 `assessMetrics()` 함수가 5대 핵심 지표를 가중 합산:

| 요인 | 비중 | 평가 내용 |
|---|---|---|
| 매출 지속성 | 25% | 6개월 매출 추세, 변동 계수 |
| 현금흐름 여력 | 20% | 영업현금흐름 / 월 매출 비율 |
| 부채 부담 | 20% | 부채비율, 월 상환 부담, 연체 이력 |
| 사업 운영 안정성 | 15% | 업력, 근로자, 세금 납부, 재방문율, 디지털화 |
| 상권 회복력 | 20% | 유동인구, 상권 매출, 경쟁 밀도, 폐업률 |

→ 종합 점수(0~100), 등급(S2~S7), 리스크 레벨, 펀딩 한도 산출

## 스키마 배포

```bash
npm run db:apply
# 또는
node scripts/apply_supabase.mjs
```

## 개발 환경 실행

```bash
npm run dev     # Vite 개발 서버
npm run build   # 프로덕션 빌드
npm run preview # 빌드 결과 미리보기
```

## 실서비스 전 필요한 작업

- 무차별 로그인 시도 방어 및 보안 레이트 리밋 정책 적용
- 휴대전화 본인확인과 사업자등록 진위 확인 API 연동
- PG사 결제 모듈 및 실제 은행 펌뱅킹 이체 API 연동
- Object Storage 악성 파일 검사와 원본 증빙 암호화
- 결제·예치·환불·전자계약 및 관련 인허가 파트너 연동
- 감사 로그 모니터링, 백업·복구, 개인정보 보존·파기 정책
