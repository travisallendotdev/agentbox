# agentbox

A Bun/TypeScript CLI that turns a YAML config into a fully-bootstrapped Claude Code sandbox on Docker `sbx`.

## Build

```sh
bun run build       # compiles to dist/agentbox (darwin-arm64)
```

## Test

```sh
bun test                         # unit tests, no external deps required
bun test tests/integration       # requires sbx running + authenticated
```

## Lint & format

```sh
bun run check    # BiomeJS lint + format check (read-only)
bun run format   # BiomeJS auto-fix lint + format issues
```

## Type check

```sh
bun run typecheck
```
