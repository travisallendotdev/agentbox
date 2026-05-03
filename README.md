# agentbox

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-blue?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-black?logo=bun&logoColor=white)

Declarative, pre-authorized Claude Code sandboxes on Docker [`sbx`](https://docs.docker.com/sbx/).

## What it does

`agentbox` turns a YAML config file into a fully-bootstrapped Claude Code agent running inside an isolated Docker microVM. One command creates the sandbox, injects your credentials, clones your repos, loads your skills and hooks, and fires the agent — no manual setup, no host filesystem exposure.

`agentbox` is a thin orchestration layer on top of `sbx`. Sandboxing, network policy, and credential proxying are `sbx`'s responsibilities; `agentbox` coordinates them from a declarative YAML spec.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- Docker `sbx` — `brew install docker/tap/sbx`, then `sbx login`
- Anthropic API key registered as a secret: `sbx secret set -g anthropic`

## Install

```sh
git clone https://github.com/travisallen6/agentbox
cd agentbox
bun install
bun run build           # produces dist/agentbox (darwin-arm64)
sudo cp dist/agentbox /usr/local/bin/agentbox
```

## Quick start

Create a config file:

```yaml
# project-x.yaml
name: project-x
mode: ephemeral
secrets: [anthropic]
repos:
  - source: local
    path: ~/dev/project-x
skills:
  - ~/.claude/plugins/cache/superpowers/skills/brainstorming
prompt: |
  Audit the authentication module for security issues.
  Write a report to SECURITY_AUDIT.md when done.
```

Then run it:

```sh
agentbox doctor              # verify prerequisites
agentbox up project-x.yaml  # create sandbox, inject config, launch agent
agentbox ls                  # check status
agentbox shell project-x     # poke around inside the sandbox
agentbox rm project-x        # tear down when done
```

## YAML schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | no | Sandbox name. Defaults to filename stem. Ephemeral mode appends a short uuid. |
| `mode` | `durable` \| `ephemeral` | **yes** | `durable` persists after the agent exits; `ephemeral` auto-removes. |
| `auth` | `api_key` \| `session` | no | Credential type. Defaults to `api_key`. |
| `base_template` | string | no | `sbx` base template image. Defaults to the Docker sandbox default. |
| `secrets` | string[] | no | Secret names to inject from the `sbx` secret store (e.g., `[anthropic]`). |
| `env` | map | no | Environment variables. Values support `${VAR}` shell expansion. |
| `repos` | Repo[] | no | Repositories to clone into the sandbox workspace. See Repo schema below. |
| `skills` | string[] | no | Paths to skill directories to inject into the agent's skills home. |
| `plugins` | string[] | no | Plugin directories to inject into the agent's plugins home. |
| `hooks` | Hooks | no | Claude Code hook configuration injected into the agent's settings. |
| `lifecycle` | Lifecycle | no | Shell commands to run at `post_create`, `pre_agent`, and `on_stop` phases. |
| `network` | Network | no | Network policy. `allow: [host]` permits host networking. |
| `prompt` | string | no | Initial prompt sent to the agent on startup. Supports `${VAR}` expansion. |

### Repo

```yaml
# Local repo — mounted from host via worktree
repos:
  - source: local
    path: ~/dev/my-project   # required
    branch: feat/new-thing   # optional; creates a new worktree branch

# Remote git repo — cloned inside the VM
repos:
  - source: git
    url: https://github.com/org/repo
    branch: main             # optional
    place: workspace         # optional: 'workspace' (default) or 'vm'
```

### Lifecycle

```yaml
lifecycle:
  post_create: ["apt-get install -y ripgrep"]   # after VM is created
  pre_agent:   ["cd /workspace && bun install"] # before agent starts
  on_stop:     ["git push origin HEAD"]         # after agent stops
```

### Hooks

Standard Claude Code hook format, injected verbatim into the agent's `settings.json`:

```yaml
hooks:
  PreToolUse:
    - matcher: "Bash"
      command: "echo 'about to run bash'"
  Stop:
    - matcher: ".*"
      command: "notify-send 'Agent stopped'"
```

## Commands

| Command | Description |
|---------|-------------|
| `agentbox up <path>.yaml [--name <n>] [--replace] [--keep] [--keep-on-error] [-v]` | Create, bootstrap, and start a sandbox |
| `agentbox start <name>` | Resume a stopped durable sandbox |
| `agentbox stop <name>` | Pause a running sandbox (durable mode) |
| `agentbox shell <name>` | Open an interactive shell inside the sandbox |
| `agentbox rm <name> [--force] [--prune-branches]` | Tear down sandbox, remove worktrees, drop registry entry |
| `agentbox ls` | List all managed sandboxes with status |
| `agentbox doctor` | Verify prerequisites (sbx, auth, secrets, templates) |
| `agentbox init` | Generate an example YAML config in the current directory |

## Architecture

`agentbox` is a single compiled Bun binary with no runtime dependencies. It reads a YAML config, resolves local repos into git worktrees, stages skills/plugins/hooks/credentials into a tarball, creates an `sbx` sandbox, injects the tarball via stdin, runs lifecycle hooks, and launches the Claude Code agent. The registry at `~/.agentbox/registry.json` tracks active sandboxes for `ls`, `stop`, `rm`, and `start`.

See [`docs/specs/001-agentbox-design.md`](docs/specs/001-agentbox-design.md) for the full architecture, config schema details, and design decisions.

## Status

Active development. Core commands (`up`, `ls`, `stop`, `start`, `rm`, `shell`, `doctor`) are working. Some edge cases may not yet be covered by tests — report bugs against the test suite.
