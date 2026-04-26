# agentbox

Declarative Claude Code sandboxes on Docker `sbx`.

## Install

Prerequisites:
- [Bun](https://bun.sh)
- Docker `sbx` (`brew install docker/tap/sbx`), then `sbx login`
- `sbx secret set -g anthropic`

```sh
bun install
bun run build           # produces dist/agentbox
sudo cp dist/agentbox /usr/local/bin/agentbox
```

## Use

```sh
agentbox doctor                          # verify environment
agentbox up ./project-x.yaml             # bootstrap + launch agent
agentbox ls                              # list sandboxes
agentbox shell project-x                 # poke around
agentbox stop project-x                  # pause
agentbox start project-x                 # resume
agentbox rm project-x                    # tear down
```

See `../docs/superpowers/specs/2026-04-25-agentbox-design.md` for the full
config schema and architecture.

## Status

This is an active development project. Some commands may have edge cases not
yet covered by tests; report bugs against the test suite.
