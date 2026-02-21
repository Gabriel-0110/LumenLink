#!/usr/bin/env bash
set -euo pipefail

# Creates/updates AWS Secrets Manager values without echoing secret contents.

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

read -r -p "AWS region [us-east-1]: " AWS_REGION
AWS_REGION="${AWS_REGION:-us-east-1}"

create_or_update_secret() {
  local secret_id="$1"
  local secret_value="$2"

  if aws secretsmanager describe-secret --region "$AWS_REGION" --secret-id "$secret_id" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value --region "$AWS_REGION" --secret-id "$secret_id" --secret-string "$secret_value" >/dev/null
    echo "Updated secret: $secret_id"
  else
    aws secretsmanager create-secret --region "$AWS_REGION" --name "$secret_id" --secret-string "$secret_value" >/dev/null
    echo "Created secret: $secret_id"
  fi
}

read -r -p "Coinbase key secret ID: " SECRET_ID_COINBASE_KEY
read -r -s -p "Coinbase API key value (hidden): " COINBASE_API_KEY
echo
create_or_update_secret "$SECRET_ID_COINBASE_KEY" "$COINBASE_API_KEY"

read -r -p "Coinbase secret secret ID: " SECRET_ID_COINBASE_SECRET
read -r -s -p "Coinbase API secret value (hidden): " COINBASE_API_SECRET
echo
create_or_update_secret "$SECRET_ID_COINBASE_SECRET" "$COINBASE_API_SECRET"

read -r -p "Coinbase passphrase secret ID: " SECRET_ID_COINBASE_PASSPHRASE
read -r -s -p "Coinbase passphrase value (hidden): " COINBASE_API_PASSPHRASE
echo
create_or_update_secret "$SECRET_ID_COINBASE_PASSPHRASE" "$COINBASE_API_PASSPHRASE"

echo "Done. Keep secret IDs in .env and docs metadata only."
