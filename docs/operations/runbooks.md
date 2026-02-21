# Runbooks

## Start

```bash
pnpm install
cp .env.example .env
pnpm run paper
```

## Stop

- Send `SIGTERM` (Ctrl+C locally). Graceful shutdown is implemented in scheduler.

## Common Failures

- Secret retrieval failures: verify IAM role/policy and secret IDs.
- Exchange auth failures: verify keys and clock sync.
- Risk blocks all orders: inspect limits and guard thresholds.

## Key Rotation

1. Rotate in provider console.
2. Update AWS secret values.
3. Update key inventory metadata.
4. Restart bot and verify health.

## Kill Switch

1. Set `KILL_SWITCH=true`.
2. Restart service (or reload env in deployment system).
3. Verify `/status` reports `killSwitch: true`.
4. Confirm live orders are rejected.
