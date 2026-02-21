# Overview

This project is a TypeScript-first scaffold for automated crypto trading with strict safety defaults:

- `MODE=paper` by default
- explicit live-trading enablement required
- risk limits and guardrails enforced before execution
- no secrets in code or docs

The architecture separates concerns across config, secrets, market data, strategy, risk, execution, alerts, and ops loops.
