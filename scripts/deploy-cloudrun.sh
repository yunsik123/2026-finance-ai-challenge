#!/usr/bin/env bash
# ============================================================================
# 먹투 Cloud Run 배포.
#
#   bash scripts/deploy-cloudrun.sh            평소용 (min-instances=0, 안 쓰면 요금 0)
#   DEMO=1 bash scripts/deploy-cloudrun.sh     시연용 (min-instances=2, 콜드스타트 없음)
#
# 시연이 끝나면 반드시 평소용으로 되돌려야 요금이 멎는다.
#   gcloud run services update meoktu --region=asia-northeast3 --min-instances=0
#
# 왜 이 설정인가
#   · session-affinity  socket.io 는 같은 인스턴스로 계속 붙어야 실시간 연결이 안 끊긴다.
#   · concurrency 80    Node 한 프로세스가 감당할 동시 요청. 넘으면 인스턴스가 늘어난다.
#   · max-instances 40  트래픽이 몰려도 40대까지 자동으로 늘어난다.
#   · vpc-egress        Neo4j VM 의 내부 IP 로 나가야 하므로 사설 대역만 VPC 로 보낸다.
# ============================================================================
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-northeast3}"
ZONE="${ZONE:-asia-northeast3-a}"
SERVICE="${SERVICE:-meoktu}"
SA_EMAIL="meoktu-run@${PROJECT}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/meoktu/${SERVICE}"

MIN_INSTANCES=0
if [[ "${DEMO:-0}" == "1" ]]; then MIN_INSTANCES=2; echo "▶ 시연 모드: min-instances=2"; fi

CONNECTION_NAME="$(gcloud sql instances describe meoktu-db --format='value(connectionName)')"
NEO4J_IP="$(gcloud compute instances describe meoktu-neo4j --zone="$ZONE" --format='value(networkInterfaces[0].networkIP)')"

echo "▶ 이미지 빌드 (Cloud Build)"
# 로컬 Docker 없이 클라우드에서 빌드한다. Apple Silicon 과 배포 아키텍처가 달라도 안전하다.
#
# CI 에서는 빌드를 비동기로 던지고 상태만 직접 확인한다.
#
# 왜냐하면 gcloud builds submit 은 기본 로그 버킷(GCS)에서 로그를 읽어 화면에 흘리는데,
# 그러려면 호출자가 프로젝트 Viewer/Owner 여야 한다. 배포 전용 계정에 그만큼 넓은 권한을
# 주고 싶지 않다. 그렇다고 두면 빌드가 성공해도 이 명령이 오류로 끝나 배포까지 가지 못한다.
# (--suppress-logs 로도 이 검사는 피하지 못한다.)
if [[ -n "${CI:-}" ]]; then
  BUILD_ID="$(gcloud builds submit --tag "${IMAGE}:latest" --quiet --async --format='value(id)')"
  echo "  빌드 ${BUILD_ID} 진행 중 (로그: 콘솔에서 확인)"
  while true; do
    BUILD_STATUS="$(gcloud builds describe "$BUILD_ID" --format='value(status)')"
    case "$BUILD_STATUS" in
      SUCCESS) echo "  빌드 성공"; break ;;
      FAILURE|TIMEOUT|CANCELLED|EXPIRED|INTERNAL_ERROR)
        echo "  빌드 실패: ${BUILD_STATUS}"
        echo "  로그: https://console.cloud.google.com/cloud-build/builds/${BUILD_ID}?project=${PROJECT}"
        exit 1 ;;
    esac
    sleep 10
  done
else
  gcloud builds submit --tag "${IMAGE}:latest" --quiet
fi

echo "▶ Cloud Run 배포"
gcloud run deploy "$SERVICE" \
  --image="${IMAGE}:latest" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --service-account="$SA_EMAIL" \
  --cpu=4 --memory=8Gi \
  --min-instances="$MIN_INSTANCES" --max-instances=40 \
  --concurrency=80 --timeout=300 \
  --session-affinity \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --network=default --subnet=default --vpc-egress=private-ranges-only \
  --set-env-vars="NODE_ENV=production,STATE_STORE=postgres,INSTANCE_CONNECTION_NAME=${CONNECTION_NAME},DB_USER=postgres,DB_NAME=meoktu,GOOGLE_CLOUD_PROJECT=${PROJECT},VERTEX_LOCATION=global,VERTEX_CHAT_MODEL=gemini-3-flash-preview,VERTEX_OCR_MODEL=gemini-3-flash-preview,NEO4J_URI=bolt://${NEO4J_IP}:7687,NEO4J_USER=neo4j" \
  --set-secrets="DB_PASSWORD=meoktu-db-password:latest,NEO4J_PASSWORD=meoktu-neo4j-password:latest,APP_SECRET=meoktu-app-secret:latest" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
echo
echo "════════════════════════════════════════════════════════════════"
echo "배포 완료: $URL"
echo
echo "확인:  curl -s ${URL}/api/health | python3 -m json.tool"
echo "로그:  gcloud run services logs tail ${SERVICE} --region=${REGION}"
echo "════════════════════════════════════════════════════════════════"
