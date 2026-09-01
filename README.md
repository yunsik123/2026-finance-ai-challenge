# 먹투 (Meoktu)

좋아하는 식당을 실제 고객이 직접 펀딩하고, 혜택을 식당 할인 쿠폰으로 돌려받는 로컬 푸드 펀딩 MVP입니다.

## 바로 실행

```powershell
npm install
npm run dev
```

- 웹: `http://localhost:5173`
- 같은 와이파이의 다른 컴퓨터: 실행 PC의 내부 IP를 확인한 뒤 `http://<내부-IP>:5173`
- 투자자 데모: `investor@meoktu.demo` / `demo1234!`
- 사장님 데모: `owner@meoktu.demo` / `demo1234!`

서버는 `0.0.0.0`에서 열리고, 모든 계정·주문·쿠폰은 `data/db.json`에 저장됩니다. Socket.IO로 거래 변경을 접속 중인 모든 브라우저에 알립니다.

## 구현된 핵심 흐름

- 투자자/소상공인 분리 회원가입과 로그인
- 가상 식당 12곳, 개별 펀드 12개, 테마 펀드 3개
- 모금 중 즉시 투자·회수 및 모금 종료 후 1,000원 단위 FIFO 예약 매칭
- 목표액 1% 개인 투자 한도, 최초 투자자 가속 혜택
- 투자액·매출 보너스 기반 쿠폰 할인율 누적과 10% 이상 수동 발급
- 할인율 차이가 10% 미만인 쿠폰 교환
- 6단계 소상공인 심사와 승인/조건부 승인/수동 검토/보완 결과 설명
- AI 데이터 상담원, 추천 식당, 상권·쿠폰 리포트
- 식당별 5요소 투명 위험평가와 역할별 심사 절차 지식그래프
- 계정별 관심 식당, 이미지 증빙 AI OCR, 서버 감사 이력
- 사장님 쿠폰 발행·사용 손익 모니터링용 데이터 모델과 배당 쿠폰 API

## AI 연결

현재 서버는 OpenAI의 Chat Completions API(`gpt-4o-mini` 등)를 통해 실제 생성형 AI 답변과 영수증/증빙 OCR을 처리합니다. 설정은 프로젝트 루트의 `.env` 또는 `.env.local`에서만 읽으며, 브라우저에는 API 키가 전달되지 않습니다.

- `OPENAI_API_KEY`: OpenAI API 키
- `OPENAI_BASE_URL`: 기본값 `https://api.openai.com/v1`
- `OPENAI_CHAT_MODEL`: AI 상담원 모델 (기본값 `gpt-4o-mini`)
- `OPENAI_OCR_MODEL`: 사업자 증빙/영수증 판독 모델 (기본값 `gpt-4o-mini`)

다른 PC나 서버에 배포할 때는 `.env.example`을 복사해 값을 설정하세요. `.env`는 Git 제외 대상으로 유지하고, 채팅이나 화면에 노출된 키는 재발급하는 편이 안전합니다.

이미지 OCR은 사장님이 문서별 **AI 문서 판독**을 직접 누른 경우에만 서버를 통해 호출됩니다. 원본 이미지는 로컬 JSON DB에 저장하지 않고 구조화된 판독 결과와 감사 이력만 남깁니다. AI 설정이 없거나 호출에 실패하면 자동 승인하지 않고 `manual_review`로 기록합니다.

## 데이터 저장과 운영 전환

로컬 실행은 설치 없이 확인하기 쉬운 `data/db.json` 원장을 계속 사용합니다. `db/postgres-schema.sql`에는 소상공인 프로젝트와 승재 프로젝트의 DB 설계를 합쳐 PostgreSQL/Supabase 전환용 테이블, 인덱스와 RLS 정책을 마련했습니다. 운영에서는 투자·회수·FIFO 매칭과 운영자 승인을 브라우저 직접 쓰기가 아닌 트랜잭션 RPC로 구현하고, `SUPABASE_SERVICE_ROLE_KEY`는 서버 환경변수에서만 사용해야 합니다.

## Supabase Auth

서버에 `SUPABASE_URL`(또는 `VITE_SUPABASE_URL`)과 `SUPABASE_PUBLISHABLE_KEY`(또는 `VITE_SUPABASE_PUBLISHABLE_KEY`)가 있으면 일반 회원가입·로그인은 Supabase Auth를 우선 사용합니다. `SUPABASE_SERVICE_ROLE_KEY`까지 서버에 설정하면 회원가입 시 이메일 확인을 완료한 사용자를 서버에서 만들고 즉시 로그인합니다. 서비스 역할 키는 절대로 `VITE_` 접두어로 노출하지 않습니다.

Supabase가 설정되지 않은 로컬 환경과 `@meoktu.demo` 데모 계정은 기존 로컬 인증으로 계속 동작합니다. `GET /api/health`의 `authProvider` 값으로 현재 인증 모드를 확인할 수 있습니다.

`SUPABASE_AUTH_DISABLED=1`을 주면 Supabase 키가 있어도 로컬 데모 인증만 사용합니다. 통합 테스트는 항상 이 모드로 서버를 띄우므로, 테스트를 돌려도 실제 Supabase 프로젝트에 계정이 생기지 않습니다.

## 통합 테스트

```bash
npm run test:integration
```

`tests/run.ts`가 `SUPABASE_AUTH_DISABLED=1`로 서버를 직접 띄우고 4개 스위트를 실행한 뒤 서버를 정리합니다. 8787에 이미 서버가 떠 있으면 그 서버를 재사용하되, Supabase Auth 모드라면 실제 프로젝트를 오염시키지 않도록 실행을 중단합니다.

`npm run build`와 `npm run check`는 `tsc -b --force`를 사용합니다. 증분 캐시(`.tsbuildinfo`)가 남아 있으면 실제 구문 오류를 건너뛰고 통과할 수 있어, 배포에서만 빌드가 깨지는 사고를 막기 위한 조치입니다.

## GraphRAG AI 상담

모든 페이지 오른쪽 아래의 **AI와 상담하기** 버튼은 질문을 역할별 지식그래프에서 검색합니다. 관련 노드와 1-hop 관계를 추출한 뒤 생성형 AI 컨텍스트에 넣고, 화면에는 참고한 그래프 노드를 함께 표시합니다. AI 키가 없거나 외부 호출이 실패해도 절차 질문은 로컬 그래프 검색 결과로 답합니다.

## Vercel

`api/index.ts`가 Express 서버리스 함수 진입점이고, `vercel.json`이 `/api/*` 요청을 함수로 전달하고 나머지 경로를 Vite SPA로 연결합니다. 필요한 Vercel 환경변수는 다음과 같습니다.

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (선택, 기본: `https://api.openai.com/v1`)
- `OPENAI_CHAT_MODEL`, `OPENAI_OCR_MODEL` (선택, 기본: `gpt-4o-mini`)
- `APP_SECRET`

Vercel 서버리스 환경의 `/tmp` JSON은 영구 저장소가 아닙니다. Supabase Auth 계정은 영구 저장되지만 투자·쿠폰·감사 원장을 실제 운영 데이터로 보존하려면 `db/postgres-schema.sql`과 RPC 데이터 계층으로 전환해야 합니다. 현재 서버리스 JSON 경로는 데모 실행용입니다.

## 실제 서비스 전 필요한 연동

- 사업자등록·영업신고·대표자 본인확인 제공사
- 여신금융협회/카드사 또는 POS 매출 데이터 제휴
- 국세·지방세 납부 및 행정처분 확인 가능한 합법적 데이터 제휴
- 상권 유동인구·업종 매출·폐업률 데이터(KOSIS, 소상공인시장진흥공단 등)
- 결제/예치금/정산 사업자와 전자금융·자본시장·유사수신 관련 법률 검토
- 공개 배포용 관리형 DB(PostgreSQL 등), 비밀번호 재설정과 이메일 인증

현재 코드는 기능 검증용 MVP입니다. 실제 투자금 수취나 보관 기능을 켜기 전에 금융·소비자보호·개인정보 법률 검토가 반드시 필요합니다.
