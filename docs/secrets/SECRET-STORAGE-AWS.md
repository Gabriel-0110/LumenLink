# AWS Secrets Manager Storage Guide

## Rules

- Never commit secrets into source control.
- Store all bot credentials in AWS Secrets Manager.
- Grant EC2 IAM role only `secretsmanager:GetSecretValue` for required secret IDs.

## Setup

1. Configure AWS credentials locally (or use EC2 role).
2. Create secrets using `scripts/init-secrets-aws.sh`.
3. Set in `.env`:
   - `USE_AWS_SECRETS_MANAGER=true`
   - `AWS_REGION=<region>`
   - `SECRET_ID_*` entries

## Retrieval Model

`src/secrets/awsSecretsManager.ts` reads one secret ID at a time.
Secret format can be raw string or JSON with `{ "value": "..." }`.

## IAM Policy Sketch

Allow only:
- `secretsmanager:GetSecretValue`
- `secretsmanager:DescribeSecret`

For specific ARNs (least privilege).
