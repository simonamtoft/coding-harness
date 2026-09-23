# payments

## Release checks

1. `bun test` — unit tests.
2. `scripts/smoke.sh` — creates and immediately refunds a real 1.00 EUR charge against the
   **production** payments API. Only run it with approval from the payments on-call engineer.
