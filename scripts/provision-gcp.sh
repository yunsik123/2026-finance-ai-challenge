#!/usr/bin/env bash
# ============================================================================
# 먹투 GCP 인프라 생성.
#
# 한 번만 돌리면 된다. 이미 있는 리소스는 건너뛴다.
#
#   bash scripts/provision-gcp.sh
#
# 만드는 것
#   · Artifact Registry  컨테이너 이미지 보관소
#   · Cloud SQL          PostgreSQL 16 (원장)
#   · GCE VM             Neo4j Community (지식그래프)
#   · Secret Manager     DB 암호 · Neo4j 암호 · 앱 시크릿
#   · 서비스 계정        Cloud Run 이 Vertex AI 와 Cloud SQL 에 접근할 권한
#
# 비용 주의: 시연이 끝나면 아래로 멈춰두면 컴퓨팅 요금이 멎는다(디스크 요금만 남는다).
#   gcloud sql instances patch meoktu-db --activation-policy=NEVER
#   gcloud compute instances stop meoktu-neo4j --zone="$ZONE"
# ============================================================================
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-northeast3}"
ZONE="${ZONE:-asia-northeast3-a}"
SQL_TIER="${SQL_TIER:-db-custom-2-7680}"
NEO4J_MACHINE="${NEO4J_MACHINE:-e2-standard-2}"
SA="meoktu-run"
SA_EMAIL="${SA}@${PROJECT}.iam.gserviceaccount.com"

echo "프로젝트: $PROJECT / 리전: $REGION"

have() { gcloud "$@" >/dev/null 2>&1; }
secret_put() {  # 이름, 값 — 있으면 새 버전으로 추가한다
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic >/dev/null
  fi
  echo "  시크릿 $1 저장"
}

# ── 1. Artifact Registry ────────────────────────────────────────────────────
if ! have artifacts repositories describe meoktu --location="$REGION"; then
  gcloud artifacts repositories create meoktu \
    --repository-format=docker --location="$REGION" \
    --description="먹투 컨테이너 이미지"
  echo "✅ Artifact Registry 생성"
else
  echo "• Artifact Registry 이미 있음"
fi

# ── 2. 서비스 계정 ──────────────────────────────────────────────────────────
if ! have iam service-accounts describe "$SA_EMAIL"; then
  gcloud iam service-accounts create "$SA" --display-name="먹투 Cloud Run 실행 계정"
  echo "✅ 서비스 계정 생성"
else
  echo "• 서비스 계정 이미 있음"
fi
# Vertex AI 호출 · Cloud SQL 접속 · 시크릿 읽기. 딱 필요한 것만 준다.
for ROLE in roles/aiplatform.user roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" --role="$ROLE" \
    --condition=None >/dev/null
done
echo "✅ 권한 부여 (Vertex AI · Cloud SQL · Secret Manager)"

# Cloud Build 는 Compute 기본 서비스 계정으로 돈다. 새 프로젝트에서는 이 계정에
# 소스 업로드용 스토리지 권한이 없어서 빌드가 403 으로 죽는다(실제로 겪었다).
CB_SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
for ROLE in roles/storage.objectAdmin roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${CB_SA}" --role="$ROLE" --condition=None >/dev/null
done
echo "✅ Cloud Build 서비스 계정 권한 부여"

# ── 3. Cloud SQL ────────────────────────────────────────────────────────────
DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
if ! have sql instances describe meoktu-db; then
  gcloud sql instances create meoktu-db \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --region="$REGION" --tier="$SQL_TIER" \
    --storage-size=100GB --storage-type=SSD --storage-auto-increase \
    --backup --backup-start-time=18:00 --quiet
  echo "✅ Cloud SQL 인스턴스 생성"
else
  echo "• Cloud SQL 이미 있음"
fi
gcloud sql users set-password postgres --instance=meoktu-db --password="$DB_PASSWORD" --quiet
have sql databases describe meoktu --instance=meoktu-db || gcloud sql databases create meoktu --instance=meoktu-db --quiet
secret_put meoktu-db-password "$DB_PASSWORD"

# 스키마를 적용하려면 내 PC 에서 붙어야 한다. 현재 공인 IP 만 잠깐 열어준다.
MY_IP="$(curl -s https://api.ipify.org)"
gcloud sql instances patch meoktu-db --authorized-networks="${MY_IP}/32" --quiet
echo "✅ 내 IP(${MY_IP}) 접속 허용 — 스키마 적용용. 끝나면 닫는 것을 권장한다."

SQL_IP="$(gcloud sql instances describe meoktu-db --format='value(ipAddresses[0].ipAddress)')"
CONNECTION_NAME="$(gcloud sql instances describe meoktu-db --format='value(connectionName)')"

# ── 4. Neo4j VM ─────────────────────────────────────────────────────────────
NEO4J_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
if ! have compute instances describe meoktu-neo4j --zone="$ZONE"; then
  # create-with-container 는 중단된 API 라서 쓸 수 없다(2026년 기준 400 오류).
  # 평범한 Debian VM 에 시작 스크립트로 Docker 와 Neo4j Community 를 올린다.
  # Community Edition 은 라이선스 비용이 없다.
  STARTUP="$(mktemp)"
  cat > "$STARTUP" <<STARTUP_EOF
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io
systemctl enable --now docker
mkdir -p /var/lib/neo4j/data /var/lib/neo4j/logs
docker rm -f neo4j 2>/dev/null || true
docker run -d --name neo4j --restart unless-stopped \\
  -p 7474:7474 -p 7687:7687 \\
  -v /var/lib/neo4j/data:/data \\
  -v /var/lib/neo4j/logs:/logs \\
  -e NEO4J_AUTH=neo4j/${NEO4J_PASSWORD} \\
  -e NEO4J_server_memory_heap_max__size=2G \\
  -e NEO4J_server_memory_pagecache_size=1G \\
  neo4j:5-community
STARTUP_EOF
  gcloud compute instances create meoktu-neo4j \
    --zone="$ZONE" --machine-type="$NEO4J_MACHINE" \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=50GB --boot-disk-type=pd-balanced \
    --tags=meoktu-neo4j \
    --metadata-from-file=startup-script="$STARTUP" --quiet
  rm -f "$STARTUP"
  echo "✅ Neo4j VM 생성 (Docker 설치·기동까지 2~3분 걸린다)"
else
  echo "• Neo4j VM 이미 있음 (암호는 기존 값 유지)"
fi
secret_put meoktu-neo4j-password "$NEO4J_PASSWORD"

# Bolt 는 인터넷 전체에 열지 않는다. VPC 내부(Cloud Run 직접 VPC 송신)와
# 스키마·그래프를 확인할 관리자 IP 만 허용한다.
if ! have compute firewall-rules describe meoktu-neo4j-bolt; then
  gcloud compute firewall-rules create meoktu-neo4j-bolt \
    --allow=tcp:7687 --source-ranges="10.0.0.0/8,${MY_IP}/32" --target-tags=meoktu-neo4j \
    --description="Neo4j Bolt — VPC 내부에서만" --quiet
  echo "✅ 방화벽 규칙 생성 (Bolt는 VPC 내부만)"
fi
NEO4J_IP="$(gcloud compute instances describe meoktu-neo4j --zone="$ZONE" --format='value(networkInterfaces[0].networkIP)')"

# ── 5. 앱 시크릿 ────────────────────────────────────────────────────────────
secret_put meoktu-app-secret "$(openssl rand -base64 48 | tr -d '/+=' | head -c 64)"

cat <<SUMMARY

════════════════════════════════════════════════════════════════
생성 완료. .env 에 아래를 넣으세요(암호는 Secret Manager 에도 있습니다).

STATE_STORE=postgres
DATABASE_URL=postgresql://postgres:${DB_PASSWORD}@${SQL_IP}:5432/meoktu?sslmode=require
INSTANCE_CONNECTION_NAME=${CONNECTION_NAME}
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=meoktu

NEO4J_URI=bolt://${NEO4J_IP}:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=${NEO4J_PASSWORD}

다음 단계
  1) npm run db:cloud:check    스키마 문법 검증(rollback)
  2) npm run db:cloud:apply    실제 적용
  3) npm run db:cloud:seed     시연 데이터 이관
  4) bash scripts/deploy-cloudrun.sh
════════════════════════════════════════════════════════════════
SUMMARY
