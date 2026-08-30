# 모아(MOA) 상권분석 연동 모듈 (Commercial Area Analysis)

이 디렉터리는 공공데이터(소상공인시장진흥공단, 서울시 열린데이터광장) 및 통신사·카드사 상권분석 데이터를 모아 플랫폼의 **SCB 신용평가**와 **투자자 IR 지표**에 손쉽게 연동하기 위해 사전 구축된 패키지입니다.

---

## 1. 파일 구성

| 파일 | 역할 |
|---|---|
| `commercial_data.json` | 성수동, 연남동, 서촌, 수원 행궁동 등 주요 상권의 실전형 표준 데이터셋 |
| `api_client.py` | 서울시 상권분석 API / 공공데이터포털 연동 및 Mock Fallback 클라이언트 |
| `scb_bridge.py` | 상권 원천 데이터를 `moa_intelligence.py`의 SCB 평가 변수로 자동 변환 |
| `investor_insights.py` | 상권 데이터를 투자자 관점의 핵심 포인트·위험요인·인사이트 카드로 가공 |
| `commercial_client.js` | 프론트엔드(`app.js`) 또는 Vercel 서버리스에서 즉시 import하여 사용할 수 있는 JS 모듈 |
| `test_commercial.py` | 상권 데이터 조회 및 SCB 연동 단위 테스트 스크립트 |

---

## 2. 활용 가능한 국내 공공/민간 상권 API

### ① 서울시 열린데이터광장 상권분석서비스 API
* **URL**: [https://data.seoul.go.kr](https://data.seoul.go.kr)
* **제공 데이터**:
  * `OA-15560`: 서울시 상권분석서비스 (길단위인구-유동인구)
  * `OA-15571`: 서울시 상권분석서비스 (상권-추정매출)
  * `OA-15572`: 서울시 상권분석서비스 (상권-점포/개폐업)
  * `OA-15574`: 서울시 상권분석서비스 (상권-직장인구 / 상주인구)
* **발급 방법**: 서울시 열린데이터광장 회원가입 후 인증키 즉시 발급

### ② 소상공인시장진흥공단 상권정보 API (공공데이터포털)
* **URL**: [https://data.go.kr](https://data.go.kr) (소상공인시장진흥공단_상가(상권)정보)
* **제공 데이터**: 반경/행정동별 업종별 점포 수, 신규 점포, 폐업 점포 현황

### ③ 카카오/VWorld 주소-좌표 변환 API
* 도로명 주소(예: "서울 성동구 성수이로 18")를 입력받아 법정동/행정동 코드 및 상권 코드로 매핑

---

## 3. 상권 데이터 표준 포맷 (`commercial_data.json`)

```json
{
  "areaCode": "SEOUL_SEONGSU",
  "areaName": "서울 성동구 성수동 상권",
  "footTraffic": {
    "dailyAverage": 48200,
    "growthRate": 8.4,
    "peakTime": "12:00~14:00, 18:00~21:00",
    "weekdayRatio": 64.2,
    "weekendRatio": 35.8,
    "age2030Ratio": 68.5,
    "genderRatio": { "male": 47.8, "female": 52.2 }
  },
  "demographics": {
    "workerPopulation": 32400,
    "residentPopulation": 14200,
    "primaryCustomerType": "직장인 및 2030 방문객"
  },
  "marketDynamics": {
    "totalStores": 620,
    "foodBeverageRatio": 54.2,
    "categoryDensity": 0.54,
    "closureRate": 7.8,
    "averageLifespanYears": 4.6
  },
  "spending": {
    "averageTicketSize": 28500,
    "localSalesGrowth": 6.1,
    "externalConsumerRatio": 71.4
  },
  "realEstate": {
    "averageRentPerPyung": 185000,
    "rentGrowthRate": 4.2
  }
}
```

---

## 4. 나중에 웹에 붙이는 방법 (간단 연동 가이드)

### Python 백엔드 (`server.py` 또는 `moa_db.py`)
```python
from commercial_area.api_client import CommercialAreaClient
from commercial_area.scb_bridge import transform_to_scb_metrics
from commercial_area.investor_insights import build_commercial_insights

client = CommercialAreaClient()
area_data = client.get_area_by_address(business["address"], business["category"])

# 1) SCB 평가 변수 자동 도출
scb_inputs = transform_to_scb_metrics(area_data)
# {'footTrafficGrowth': 8.4, 'localSalesGrowth': 6.1, 'competitorDensity': 0.54, 'closureRate': 7.8, 'qualitativeBonus': 7.5}

# 2) 투자자용 상권 브리프 카드 생성
investor_card = build_commercial_insights(area_data, business["category"])
```

### 프론트엔드 (`app.js`)
```javascript
import { getCommercialAreaByAddress, getCommercialInsightCards } from './commercial_area/commercial_client.js';

const areaData = getCommercialAreaByAddress(store.address, store.category);
const insights = getCommercialInsightCards(areaData);
// 가게 상세 모달이나 소상공인 대시보드에 1초 만에 렌더링 가능!
```
