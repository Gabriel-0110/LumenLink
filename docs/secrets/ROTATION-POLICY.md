# Rotation Policy

## Policy

- Trading keys: rotate every 90 days.
- Alert tokens/webhooks: rotate every 180 days.
- Immediate rotation required after any suspected leakage.

## Procedure

1. Create new secret versions in AWS Secrets Manager.
2. Update key inventory metadata.
3. Deploy with new secrets.
4. Verify auth and alert health.
5. Revoke old keys in provider console.

## Validation

- Confirm bot can read secret.
- Confirm paper mode health before live enablement.
- Confirm no auth failures in logs after cutover.
