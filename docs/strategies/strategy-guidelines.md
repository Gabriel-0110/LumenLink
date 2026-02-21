# Strategy Guidelines

- Keep signal generation deterministic and explainable.
- Emit confidence and reason on every signal.
- Avoid strategy-side execution assumptions; risk engine decides final permission.
- Validate indicators against sufficient lookback windows.
- Add unit tests for edge conditions and no-data behavior.
