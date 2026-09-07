# 전체 검증 · 2026-09-07

`STATE_STORE=postgres` 로 옮긴 뒤, 파일 저장소에서만 통과하던 것이 공유 원장에서도
같은 결과를 내는지 확인했다. 서버·원장·SQL 을 모두 일회용 로컬 인스턴스에서 돌렸고,
운영 데이터에는 쓰기를 하지 않았다(라이브 점검만 읽기 전용으로 접속).

## 결과

| 항목 | 결과 |
| --- | --- |
| 스위트 (postgres) | 13/13 통과 · `suites-postgres.json` |
| 스위트 (file) | 4/4 통과 · `suites-file.json` |
| 저장 신뢰성 단위 테스트 | 15/15 통과 · `npm run test:storage` |
| 부하 | `load-postgres.json` · `load-file.json` |
| 라이브 연결 점검 | Postgres·Neo4j 연결, 불변식 4종 통과 · `live-connections.json` |

## 이 검증에서 찾아 고친 것

공유 원장에서만 드러나는 문제였다. 파일 저장소는 단일 프로세스라 셋 다 통과했다.

1. **회수가 전부 실패했다.** `consented_fund_action` 이 동의 문서 목록이 비어 있으면
   거절했는데, 회수에는 필수 약관 문서가 없다(`server/legal.ts` 의 `requiredFor`).
   게다가 `recordConsent()` 는 문서가 없으면 기록 자체를 만들지 않아 동의가 null 로
   넘어갔다. 위험 확인만 있어도 기록을 남기고, SQL 은 형태만 확인하도록 고쳤다.
2. **교환에서 탈락한 제안자에게 알림이 가지 않았다.** `settle_swap()` 이 남은 제안을
   거절 처리하고 쿠폰만 돌려줬다. 서버 경로와 같은 안내를 보내도록 맞췄다.
3. **기동 시 맞춘 파생값이 저장되지 않았다.** 공유 원장 모드의 저장은 쓰기 잠금을 쥔
   요청만 수행하는데(`LedgerContext.save`), 기동 코드에는 그 컨텍스트가 없어
   `saveDatabase()` 가 조용히 아무것도 하지 않았다. 그래서 `funds.total_coupon_used`
   가 전 펀드에서 0으로 남았다. 기동 정리를 `ledger.run(true, …)` 안으로 옮겼다.

저장 신뢰성 수정 5건(요청 사본 갱신, 잠금 해제 실패 시 큐 반환, 파일 저장 큐 오염,
손상 파일 무음 처리, 직렬화 시점)은 `tests/storage-reliability.ts` 가 회귀로 잡는다.
수정 전 코드에서 이 파일을 돌리면 정확히 그 5개가 실패한다.

## 재현

```bash
npm run check            # 타입
npm run test:storage     # 저장 신뢰성 단위 테스트 (외부 의존 없음)
npm run test:integration # 통합 스위트 (파일 저장소)
npm run test:browser     # 실제 브라우저 회귀

# 공유 원장 모드. 아래 포트에 일회용 postgres 가 필요하다.
docker run -d --name meoktu-audit-postgres \
  -e POSTGRES_PASSWORD=audit-local-only -p 15439:5432 postgres:16
node tests/system-audit.mjs --postgres   # 결과가 이 폴더의 json 으로 남는다
node tests/system-audit.mjs              # 파일 저장소 기준

npm run audit:live       # 운영 연결 점검(읽기 전용). DATABASE_URL·NEO4J_* 필요
```

## 부하 수치를 읽는 법

동시성은 **동시에 처리 중인 HTTP 요청 수**다. 접속 사용자 수도, 운영 서비스의 보장
처리량도 아니다. 로컬 단일 인스턴스에 합성 원장을 올리고 AI 를 끈 상태의 값이므로
용량 산정 근거로 쓸 수 없다.

읽기는 동시성을 올려도 초당 처리량이 유지되고 지연만 늘어난다(postgres 기준 약
620/s). 쓰기는 원장 전역 잠금으로 직렬화되므로 60~70/s 대에서 평평해지고, 이때도
실패 없이 전부 200 으로 끝난다 — 느려질지언정 갱신이 유실되지 않는다는 뜻이다.
서로 다른 두 인스턴스가 같은 원장에 동시에 쓰는 경우도 같다.
