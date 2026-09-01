# 먹투 웹사이트 MVP 공유본

## 실행 방법 (Windows PowerShell)

1. Node.js 20 이상을 설치합니다.
2. 이 폴더에서 `npm install`을 실행합니다.
3. `.env.example`을 복사해 `.env`를 만들고 `APP_SECRET`을 입력합니다.
4. 생성형 AI를 사용하려면 `AI_API_KEY`에 본인의 SG-LLM 키를 입력합니다. 보안을 위해 실제 키는 이 공유본에 포함하지 않았습니다.
5. `npm run dev`를 실행합니다.
6. 브라우저에서 `http://localhost:5173`을 엽니다.

## 데모 계정

- 투자자: investor@meoktu.demo / demo1234!
- 사장님: owner@meoktu.demo / demo1234!

## 포함된 내용

- 가상 식당·펀드·쿠폰·매출 그래프·리뷰 데이터 생성 코드
- 투자·회수 예약 자동 매칭과 Socket.IO 실시간 갱신
- 먹투머니 시연용 충전
- 쿠폰 교환장 및 내 쿠폰 교환 취소·복원
- 방문 인증 리뷰
- 자료별 소상공인 심사 업로드 화면과 최소 필수 동의
- SG-LLM 생성형 AI 상담원·추천·상권 브리핑

`data/db.json`은 포함하지 않았습니다. 처음 실행하면 `server/seed.ts`를 바탕으로 자동 생성됩니다.
이 프로젝트는 시연용 MVP이며 실제 투자금 수취·보관 서비스가 아닙니다.