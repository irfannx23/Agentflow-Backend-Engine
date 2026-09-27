# Development Guide

Use Node 22+ and pnpm 10+. Install with `pnpm install`, then run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `git diff --check`.

Business rules belong in an existing workflow or authoritative backend contract. Reusable TypeScript modules may normalize, validate, explain, and compose outputs, but must not add silent thresholds. Add fixtures for positive and missing evidence; missing evidence should normally remain `not_evaluated`.

When changing a migrated workflow, preserve node names, connection topology, RPC names, credential expressions, and payloads unless a separately approved compatibility fix requires otherwise. Run registry and n8n compatibility validation before commit.
