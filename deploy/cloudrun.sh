#!/usr/bin/env bash
# Deploys the API server to Cloud Run in the Firebase project (run in Google Cloud Shell).
#   1. cp deploy/env.example.yaml deploy/env.yaml   and fill it in
#   2. bash deploy/cloudrun.sh
# Safe to re-run: it redeploys with the same secrets and data.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-ewb---generator}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-ewb-api}"
BUCKET="${PROJECT_ID}-ewb-data"
ENV_FILE="deploy/env.yaml"
SECRETS_FILE="deploy/secrets.env"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE. Run: cp deploy/env.example.yaml deploy/env.yaml  and fill it in."; exit 1; }
if grep -qE 'gak_your_key|re_your_key' "$ENV_FILE"; then echo "Fill in GSTINAPI_KEY and RESEND_API_KEY in $ENV_FILE first."; exit 1; fi

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "== Enabling services"
gcloud services enable compute.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com identitytoolkit.googleapis.com

# Cloud Run and Cloud Build run as the default compute service account, which
# Google creates a little after the Compute Engine API is first enabled.
echo "== Waiting for $SA"
for _ in $(seq 1 30); do
  gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 && break
  sleep 10
done
gcloud iam service-accounts describe "$SA" >/dev/null || { echo "Service account $SA not found. Wait a few minutes and run this script again."; exit 1; }
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/run.builder --condition=None >/dev/null

echo "== Data bucket gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectUser >/dev/null

echo "== Permission to mark accounts verified (Firebase Auth admin)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/firebaseauth.admin --condition=None >/dev/null

echo "== Server secrets"
if [ ! -f "$SECRETS_FILE" ]; then
  {
    echo "OTP_PEPPER=$(openssl rand -hex 32)"
    echo "EWB_CREDENTIALS_SECRET=$(openssl rand -hex 32)"
    echo "WALLET_ADMIN_TOKEN=$(openssl rand -hex 24)"
  } > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  echo "   Created $SECRETS_FILE (keep it; changing these later breaks saved logins)."
fi
# Combine settings + secrets into one env file for this deploy.
DEPLOY_ENV="$(mktemp)"
trap 'rm -f "$DEPLOY_ENV"' EXIT
cat "$ENV_FILE" > "$DEPLOY_ENV"
echo 'NODE_ENV: "production"' >> "$DEPLOY_ENV"
echo 'DATA_DIR: "/data"' >> "$DEPLOY_ENV"
while IFS='=' read -r key value; do [ -n "$key" ] && echo "$key: \"$value\"" >> "$DEPLOY_ENV"; done < "$SECRETS_FILE"

echo "== Building and deploying $SERVICE (takes a few minutes)"
gcloud run deploy "$SERVICE" --source . --region "$REGION" \
  --allow-unauthenticated --execution-environment gen2 \
  --max-instances 1 --memory 512Mi \
  --env-vars-file "$DEPLOY_ENV" \
  --add-volume name=data,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount volume=data,mount-path=/data

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "== Checking $URL"
curl -fsS "$URL/api/healthz" && echo
echo
echo "Done. Server URL: $URL"
echo "Put it in artifacts/ewb-vendor-app/eas.json as EXPO_PUBLIC_API_URL, then rebuild the APK."
echo "Razorpay webhook URL (if used): $URL/api/payments/razorpay/webhook"
