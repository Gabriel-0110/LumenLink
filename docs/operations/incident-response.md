# Incident Response

## Trigger Conditions

- Unexpected order behavior
- Elevated slippage/spread anomalies
- Auth leakage suspicion
- Reconciliation mismatch

## Immediate Actions

1. Enable `KILL_SWITCH=true`.
2. Move to `MODE=paper` if needed.
3. Pause scheduler loops.
4. Gather logs and metrics snapshots.

## Containment

- Revoke/rotate compromised keys.
- Disable live role credentials.
- Confirm no withdrawal scopes existed.

## Recovery

- Reconcile local vs exchange orders.
- Validate risk limits.
- Resume with paper mode first, then controlled live rollout.
