# MOA — 소상공인 데이터 기반 펀딩

소상공인과 지역 투자 참여자를 연결하는 기능형 MVP입니다. 회원 유형별 로그인, 펀딩·쿠폰, 매출전표 OCR, 설명 가능한 성장평가, property graph 기반 자료 진단, 투자자 비교 추천을 제공합니다.

> 현재 금전 거래는 데모 기록이며 `S1~S10` 성장등급과 추천 점수는 금융위원회의 공개된 SCB 추진 방향을 재현한 PoC입니다. 공식 CB/SCB, 투자 권유 또는 수익 보장이 아닙니다.

## 구조

```text
index.html / styles.css / features.css / metrics.css
app.js
└─ src/supabase-cloud.js       Supabase Auth·PostgREST 브라우저 어댑터

api/
├─ health.js                   Vercel 상태 API
└─ ai.js                       Vercel SGLLM 챗·Vision OCR 프록시

db/
├─ schema.sql                  Supabase PostgreSQL + RLS + property graph
├─ seed.sql                    가상 소상공인 3곳·평가·그래프 시드
└─ README.md

server.py / moa_db.py          로컬 API·SQLite 인증/감사로그
moa_intelligence.py            설명형 성장평가·추천·그래프 진단
schema.sql                     로컬 SQLite 스키마
seed/demo_owners.json          로컬 가상 소상공인 계정 3명
tests/                         백엔드·실브라우저 통합 테스트
```

Vercel에서는 Supabase Authentication/PostgreSQL/RLS가 영속 저장을 담당합니다. 로컬에서는 SQLite와 `HttpOnly` 세션 쿠키로 동일한 사용자 흐름을 검증할 수 있습니다.

## 핵심 기능

- 투자자/소상공인 역할별 회원가입·로그인과 최근 로그인/로그아웃 기록
- 사용자별 찜, 데모 참여, 리워드 쿠폰 지급·사용
- 사업체·펀딩·공시·상권 기준·쿠폰 정책 관리
- 최근 6개월 매출, 영업현금흐름, 부채·상환, 연체, 고용, 세금, 상권 입력
- 금융위 SCB 방향의 매출 성장·상권 지위·지속성·회복력 중심 설명형 `S1~S10` 평가
- `knowledge_nodes` / `knowledge_edges`와 재귀 탐색 함수 기반 자료 부족 진단
- 성장성, 위험, 쿠폰 혜택을 함께 보여 주는 일반 투자자 탐색 추천
- 영수증·세금계산서·매출전표 OCR 및 사업계획 일치도 저장
- 로컬 `Ollama Vision → SGLLM Vision` 순서의 OCR fallback
- Vercel에서는 로컬 Ollama에 접근할 수 없으므로 서버리스 SGLLM Vision 사용

## 로컬 실행

```bash
npm install
python3 server.py
```

<http://127.0.0.1:8000>을 엽니다. Ollama Vision 모델은 환경에 맞게 지정합니다.

```bash
MOA_OCR_ENGINE=auto \
OLLAMA_URL=http://127.0.0.1:11434 \
OLLAMA_OCR_MODEL=qwen2.5vl:7b \
python3 server.py
```

- `auto`: Ollama를 먼저 호출하고 연결 불가 시 SGLLM Vision 사용
- `ollama`: Ollama만 허용하며 실패를 숨기지 않음
- `cloud`: SGLLM Vision만 사용

Ollama 모델은 이미지 입력을 지원해야 합니다. OCR 결과는 자동 지급 승인이 아니며 원본 대조와 운영자 검토가 필요합니다.

### 로컬 데모 소상공인

비밀번호는 모두 `Demo1234!`입니다.

| 이름 | 이메일 | 가상 평가 특성 |
|---|---|---|
| 김온기 | `ongi-owner@moa.demo` | 매출·현금흐름 우수 |
| 박목화 | `mokhwa-owner@moa.demo` | 중간 성장·경쟁 심화 |
| 이일구 | `table-owner@moa.demo` | 부채 회복력 보완 필요 |

## Supabase 설정

`.env.development.local` 또는 Vercel 환경변수에 아래 두 값만 넣습니다. URL 뒤에 `/rest/v1`을 붙이지 않습니다. 코드에도 방어적 정규화가 들어 있습니다.

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Supabase SQL Editor에서 다음 순서로 실행합니다.

1. `db/schema.sql`
2. `db/seed.sql`

브라우저나 Git에는 `service_role`, DB 비밀번호, SGLLM 키를 넣지 않습니다. 상세 RLS와 Graph DB 구조는 [db/README.md](db/README.md)를 참고하세요.

## Vercel 설정

```bash
npm run build
vercel link
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production
vercel env add SGLLM_API_KEY production
vercel --prod
```

`VITE_` 두 값은 브라우저용 publishable 설정이고 `SGLLM_API_KEY`는 서버리스 함수에서만 읽습니다. 환경변수를 바꾸면 다시 배포해야 합니다.

## 검증

```bash
node --check app.js
node --check src/supabase-cloud.js
node --check api/ai.js
python3 -m py_compile server.py moa_db.py moa_intelligence.py
npm run build
python3 tests/backend_integration.py
node tests/browser_smoke.mjs
```

브라우저 테스트는 실행 중인 `server.py`와 macOS Google Chrome을 사용합니다.

## 실서비스 전 필수 작업

- 이메일 확인·비밀번호 재설정·MFA·로그인 rate limit
- 사업자 진위·대표자 본인확인, 개인정보 보존/파기 정책
- private Storage, 파일 악성코드 검사, 암호화, 중복 이미지 해시
- 운영자 심사·이의제기·평가 버전 관리와 편향/성능 검증
- 결제·예치·환불·전자계약 및 관련 인허가/법률 검토
- 공식 SCB 제공기관 연동 전까지 PoC 등급을 금융 의사결정에 사용하지 않기
