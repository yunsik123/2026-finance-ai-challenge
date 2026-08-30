# 🗄️ MOA Database Directory

이 디렉토리는 **MOA (모아) 소상공인 AI 크라우드펀딩 플랫폼**의 데이터베이스 스키마, ERD 다이어그램, 시드 데이터 및 백엔드 연동 명세를 관리합니다.

---

## 📁 파일 구성

| 파일명 | 설명 | 비고 |
|---|---|---|
| 📊 **[`ERD.md`](./ERD.md)** | **시각적 ERD 다이어그램 및 전체 스키마 명세** | `Ctrl + Shift + V` (macOS: `Cmd + Shift + V`)로 미리보기 |
| 📜 **[`schema.sql`](./schema.sql)** | Supabase PostgreSQL DDL 스키마 원본 (테이블, 트리거, RLS, RPC 함수) | 프로덕션 배포 스크립트 |
| 🌱 **[`seed.sql`](./seed.sql)** | 초기 시드 데이터 (기본 상권 데이터, 가상 사업체, 지식 노드 등) | 개발/테스트 초기화용 |
| 📖 **[`BACKEND.md`](./BACKEND.md)** | 백엔드 아키텍처 및 Supabase/Vercel API 통신 규격 | 아키텍처 설명서 |

---

## 🚀 빠른 시작 (Quick Start)

### 1. 시각적 ERD 다이어그램 확인
- 에디터에서 [`ERD.md`](./ERD.md)를 열고 단축키 **`Ctrl + Shift + V`** (macOS: `Cmd + Shift + V`)를 누르면 엔티티 관계도와 데이터 흐름을 시각적으로 확인할 수 있습니다.

### 2. Supabase 데이터베이스 동기화
```bash
# 로컬 스키마를 Supabase에 일괄 적용
npm run db:apply
```
