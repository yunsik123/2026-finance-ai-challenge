# Supabase 초기화

1. Supabase SQL Editor에서 `schema.sql`을 실행한다.
2. 이어서 `seed.sql`을 실행한다. 시드는 모두 `is_demo = true`인 가상 자료다.
3. Authentication의 Email provider를 활성화한다.
4. Vercel에는 `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`만 등록한다.

`service_role`, DB 비밀번호, 개인 원본 증빙은 Git/Vercel 프론트엔드 환경변수에 넣지 않는다. OCR 원본을 운영 저장할 때는 별도 private Storage bucket과 signed URL, 악성 파일 검사를 추가해야 한다.

`knowledge_nodes`와 `knowledge_edges`는 PostgreSQL property graph 저장소이며 `graph_neighborhood()`가 순환 방지 재귀 탐색을 제공한다. 전용 Graph DB가 필요해지면 동일한 node/edge 키를 Neo4j 또는 Apache AGE로 동기화할 수 있다.

`credit_assessments`는 금융위원회 문서에 공개된 미래성장성 방향을 재현한 설명용 PoC다. 공식 SCB/CSS 결과가 아니며 자동 승인이나 투자 권유에 사용하면 안 된다.
