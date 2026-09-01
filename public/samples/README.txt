먹투 MVP · 사장님 센터 업로드 체험용 샘플 자료
==============================================

모든 값은 하나의 가상 식당에서 나온 것처럼 서로 맞물리게 만들었습니다.
  상호 샘플식당 / 대표자 김소담 / 사업자등록번호 123-45-67891
  주소 서울특별시 마포구 망원동 12-3 / 기간 2025-09 ~ 2026-08 (12개월)

[표 형태 자료]
  meoktu-pos-sample.csv               POS 주문 원자료 (주문 단위)
  meoktu-account-sample.csv           사업용 계좌 입출금 내역
  meoktu-card-settlement-sample.csv   카드 승인·정산 내역
  meoktu-delivery-sample.csv          배달 플랫폼 주문·정산 집계
  meoktu-customer-sample.csv          재방문 산정용 가명 고객 자료
  meoktu-debt-sample.csv              대출 잔액·월 원리금 상환
  meoktu-staff-sample.csv             월별 직원 수·급여 총액
  meoktu-monthly-summary-sample.csv   월별 매출·배달비중·고정비 요약(대조용)

[문서 형태 자료 · AI 문서 판독 체험용 · PNG와 PDF 모두 제공]
  meoktu-business-sample.png / .pdf   사업자등록 증빙
  meoktu-license-sample.png  / .pdf   영업신고 증빙
  meoktu-tax-sample.png      / .pdf   부가가치세 과세표준 증빙
  meoktu-lease-sample.png    / .pdf   임대차 조건

[한 번에 받기]
  meoktu-sample-pack.zip              위 파일 전체 묶음

사용법
  1. 사장님 센터 > 2단계 'B. 소상공인 직접 업로드'에서 파일을 내려받습니다.
  2. 같은 카드의 '파일 선택'으로 그대로 올리면 형식 검사와 열·행 수 확인이 됩니다.
  3. PNG 문서는 'AI 문서 판독'으로 자동 대조까지 체험할 수 있습니다.
     (PDF는 형식 검사만 하고 이미지 판독은 PNG에서만 동작합니다.)
  4. 신청서 1단계에는 위 상호·대표자·사업자등록번호를 그대로 입력하면
     문서에서 읽은 값과 신고값이 일치해 교차검증이 통과합니다.

재생성
  node scripts/make-sample-data.mjs    CSV 표 자료 8종
  node scripts/make-sample-docs.mjs    문서 4종의 PNG·PDF와 묶음 zip
                                       (크롬이 필요하며 CHROME_PATH 로 경로 지정 가능)

모든 값은 가상이며 실제 금융기관·세무·영업 증빙으로 사용할 수 없습니다.
문서 이미지에는 '실제 제출 불가' 표시가 들어가 있습니다.
