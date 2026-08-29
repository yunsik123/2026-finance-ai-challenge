# 모아 백엔드 및 데이터베이스 구조

> 2026-08 배포 구조: Vercel에서는 `src/supabase-cloud.js`가 Supabase Auth/PostgREST/RLS를 사용하고 `api/ai.js`가 AI 키를 숨긴 서버리스 프록시로 동작한다. 아래 `server.py`·SQLite 설명은 동일 기능의 로컬 개발/통합 테스트 경로다. 운영 스키마와 3개 가상 시드는 `db/schema.sql`, `db/seed.sql`이 권위 있는 원본이다.

```text
Vercel 정적 Vite 앱
  ├─ Supabase Auth + PostgreSQL + RLS
  │    ├─ 사용자별 사업·펀딩·쿠폰·OCR·로그인 이력
  │    └─ credit_assessments + knowledge_nodes/edges
  └─ Vercel Functions
       ├─ DB/지식그래프 컨텍스트 챗봇
       └─ SGLLM Vision OCR (로컬은 Ollama 우선)
```

## 현재 구조

```text
브라우저
  │
  ├─ HTML / CSS / JavaScript
  │
  └─ /api/* JSON 요청
          │
     server.py
       ├─ 인증·입력 검증·역할 확인
       ├─ moa_db.py ── SQLite(data/moa.db)
       └─ SGLLM Gateway
            ├─ AI 상담: Chat Completions
            └─ 증빙 OCR: Claude Messages Vision
```

외부 프레임워크 없이 Python 표준 라이브러리와 SQLite로 실행된다. SGLLM API 키는 서버 프로세스만 읽으며 브라우저에는 전달하지 않는다.

## 인증 방식

1. 사용자가 이름, 이메일, 비밀번호, 역할을 제출한다.
2. 처음 사용하는 이메일이면 `users`에 계정을 생성한다.
3. 비밀번호는 16바이트 임의 salt와 PBKDF2-SHA256 260,000회 결과만 저장한다.
4. 로그인 성공 시 32바이트 수준의 임의 세션 토큰을 발급한다.
5. DB에는 토큰 원문이 아니라 SHA-256 해시만 저장한다.
6. 브라우저에는 `HttpOnly; SameSite=Strict` 쿠키로 전달한다.
7. 서버는 요청마다 세션 만료와 계정 역할을 확인한다.

현재 로컬 HTTP 환경이므로 쿠키에 `Secure`를 사용하지 않는다. HTTPS 배포 시 `Secure`를 반드시 추가해야 한다.

## 테이블

| 테이블 | 저장 내용 |
|---|---|
| `users` | 이메일, 이름, 소비자/소상공인 역할, 비밀번호 해시 |
| `sessions` | 해시된 로그인 토큰, 사용자, 만료 시각 |
| `stores` | 공개 펀딩 가게 JSON과 활성 상태 |
| `favorites` | 사용자별 찜한 가게 |
| `businesses` | 소상공인의 사업체 정보와 검증 상태 |
| `campaigns` | 목표금액, 기간, 사용계획, 위험요인, 상태 |
| `contributions` | 소비자별 데모 참여 금액과 위험 동의 |
| `coupons` | 지급 쿠폰, 코드, 출처, 사용 시각 |
| `issued_coupon_templates` | 소상공인이 발행한 쿠폰 정책과 수량 |
| `disclosures` | 공시 완료 항목 |
| `preferences` | 사용자별 분석 지역 |
| `ocr_analyses` | 파일명, 승인 계획, 구조화 OCR 결과, 모델 |

관계와 제약조건은 [schema.sql](./schema.sql)에 정의돼 있다. 외래키 삭제 규칙, 중복 쿠폰 방지, 금액·수량 범위도 DB 수준에서 검사한다.

## API

### 공통

| Method | Path | 기능 |
|---|---|---|
| `GET` | `/api/health` | SGLLM·DB 구성 상태 |
| `GET` | `/api/bootstrap` | 로그인 사용자와 화면에 필요한 전체 초기 상태 |
| `GET` | `/api/stores` | 공개 가게 목록 |

### 인증

| Method | Path | 기능 |
|---|---|---|
| `POST` | `/api/auth/session` | 기존 계정 로그인 또는 신규 계정 생성 |
| `DELETE` | `/api/auth/session` | 현재 세션 삭제 및 쿠키 만료 |

### 소비자

| Method | Path | 기능 |
|---|---|---|
| `POST` | `/api/favorites/toggle` | 가게 찜 등록·해제 |
| `POST` | `/api/contributions` | 위험 동의와 데모 참여 기록, 쿠폰 지급 |
| `POST` | `/api/coupons/use` | 사용자 소유 쿠폰 사용 처리 |

### 소상공인

| Method | Path | 기능 |
|---|---|---|
| `POST` | `/api/business` | 사업체 등록·수정 |
| `POST` | `/api/campaign` | 펀딩 초안 등록·수정 |
| `POST` | `/api/disclosures` | 공시 완료 항목 저장 |
| `POST` | `/api/preferences/region` | 분석 지역 저장 |
| `POST` | `/api/coupons/issue` | 쿠폰 발행 정책 저장 |
| `POST` | `/api/ai/ocr` | 증빙 이미지 분석 후 결과 DB 저장 |

### AI

| Method | Path | 기능 |
|---|---|---|
| `POST` | `/api/ai/chat` | 현재 화면 컨텍스트를 포함한 SGLLM 상담 |
| `POST` | `/api/ai/ocr` | Claude Vision OCR와 사업계획 일치도 분석 |

## 펀딩 참여 트랜잭션

`/api/contributions` 요청은 한 DB 트랜잭션에서 처리된다.

```text
로그인·소비자 역할 확인
  → 가게 존재 확인
  → 위험 동의와 금액 범위 확인
  → contributions 저장
  → 해당 가게의 참여 리워드 쿠폰 생성
  → 사용자 누적 참여액과 쿠폰 반환
```

같은 사용자가 같은 가게에 여러 번 참여해도 `UNIQUE(user_id, source_type, source_id)` 제약으로 리워드 쿠폰은 한 번만 발행된다.

## OCR 저장 흐름

```text
소상공인 세션 확인
  → 이미지 형식·6MB 제한 검사
  → SGLLM Claude Vision 호출
  → JSON 결과 파싱
  → ocr_analyses에 사용자·사업체·계획·결과·모델 저장
  → 화면에 판독 결과 반환
```

OCR은 지급을 자동 승인하지 않는다. `planMatch`, `confidence`, `warnings`는 운영자의 검토 순서를 돕는 정보다.

## 실행과 DB 위치

```bash
python3 server.py
```

- 기본 DB: `data/moa.db`
- 다른 DB 사용: `MOA_DB_PATH=/path/to/moa.db python3 server.py`
- SQLite WAL 모드와 외래키 검사를 활성화한다.
- 서버 시작 시 `schema.sql`을 적용하고 `seed/stores.json`의 가게를 upsert한다.

## 테스트

```bash
python3 tests/backend_integration.py
node tests/browser_smoke.mjs
```

백엔드 테스트는 임시 디렉터리에 별도의 DB를 만들고 인증, 세션, 찜, 참여, 쿠폰, 사업체, 펀딩, 공시, 지역 API와 재조회를 검증한다. 브라우저 테스트는 실제 Chrome에서 같은 기능과 SGLLM AI 응답을 클릭 검증한다.

## 실서비스 전 필요한 작업

- PostgreSQL과 정식 마이그레이션 도구 도입
- 이메일 인증, 비밀번호 재설정, 로그인 시도 제한
- 휴대전화 본인확인과 사업자등록 진위 확인
- HTTPS, `Secure` 쿠키, CSRF 토큰, 세션 관리 화면
- Object Storage 악성 파일 검사와 원본 증빙 암호화
- 결제·예치·환불·전자계약 및 관련 인허가 파트너 연동
- 운영자 심사·자금 지급 승인·분쟁 처리 UI
- 감사 로그, 모니터링, 백업·복구, 개인정보 보존·파기 정책
