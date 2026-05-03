# agentbox — Design Spec

**Status:** Draft
**Date:** 2026-04-25
**Author:** travis@gala.games (with Claude)

## 1. Problem

Running Claude Code agents on a developer's host machine for long-running tasks
forces a tradeoff between safety and oversight. Approving every Bash invocation
is tedious; running with `--dangerously-skip-permissions` on the host risks
unintended damage. Today there's no clean way to:

- Hand the agent autonomous control over a clean Linux environment with full
  Docker access, while keeping the host filesystem and processes safe.
- Re-use an existing Anthropic credential without re-authenticating per session.
- Inject the developer's curated skills, hooks, and starting prompt into a
  fresh, reproducible environment from a declarative artifact.
- Spin up either persistent (long-lived workspace) or ephemeral (one-shot,
  fire-and-forget) sandboxes from the same source of truth.

## 2. Solution overview

`agentbox` is a Bun/TypeScript CLI that turns a YAML config into a
fully-bootstrapped, pre-authorized Claude Code sandbox running on Docker
Sandboxes (`sbx`). One declarative artifact → one command → an autonomous
agent in a microVM with the right skills, hooks, repos, network policy, and
starting prompt already loaded.

`agentbox` is a thin orchestration layer on top of `sbx`. It does not
re-implement sandboxing, credential storage, or network policy — those are
`sbx`'s responsibilities. It coordinates them according to a YAML spec.

### What `agentbox` is NOT

- Not a sandbox runtime (delegates to `sbx`).
- Not a credential store (`sbx secret set -g anthropic` remains the source of
  truth; `agentbox` validates that secrets are configured).
- Not a multi-agent orchestrator (one config = one sandbox; concurrency comes
  from launching multiple independent ephemeral configs).
- Not an MCP/templates manager (deferred to v2).

### Responsibility boundaries

| Layer            | Owns                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `agentbox` CLI   | YAML parsing, validation, lifecycle commands, host-side prep, file injection             |
| `sbx`            | VM lifecycle, network policy enforcement, credential proxy, the Claude Code agent itself |
| Claude Code      | Agent loop, skill invocation, hook firing                                                |
| YAML config file | Declarative description of "what this sandbox should be"                                 |

## 3. CLI surface

```
agentbox up <path>.yaml [--name <name>] [--replace] [--keep] [--keep-on-error] [-v|--verbose]
agentbox start <name>
agentbox stop <name>
agentbox shell <name>
agentbox rm <name> [--force] [--prune-branches]
agentbox ls
agentbox doctor
```

### Command behavior

- **`up`** — create + bootstrap + start. Mode-aware (durable vs ephemeral as
  declared in YAML). `--name` overrides the YAML's `name:` field.
  `--replace` permits overwriting an existing sandbox of the same name.
  `--keep` preserves an ephemeral sandbox after the agent exits (skips
  auto-`rm`); has no effect for durable mode. `--keep-on-error` preserves a
  partial sandbox after a failed bootstrap for debugging.
- **`start`** — re-run a durable sandbox after a `stop`. Re-runs `pre_agent`
  hooks, then launches the agent. Skips `sbx create` and config injection.
- **`stop`** — stop the running agent and pause the sandbox. Runs `on_stop`
  hooks. Sandbox VM persists (durable mode).
- **`shell`** — `sbx exec -it <name> bash`. For inspection/debugging.
- **`rm`** — full teardown: `on_stop` hooks → `sbx rm` → `git worktree remove`
  for each worktree → delete sandbox parent dir → drop registry entry. Refuses
  if any worktree is dirty unless `--force`.
- **`ls`** — list all `agentbox`-managed sandboxes with status (running /
  stopped / orphaned), mode, config path, and underlying `sbx` ID.
- **`doctor`** — verify prereqs: `sbx` installed, `sbx login` complete,
  required secrets configured, base templates pullable. Reconciles registry
  drift and offers cleanup.

### Naming and the registry

- `~/.agentbox/registry.json` stores `name → { config_path, mode, created_at,
  sbx_sandbox_id, config_hash }`.
- The agentbox name and the underlying `sbx` sandbox name are the same
  (avoids two layers of naming).
- Resolution at `up` time:
  1. `--name <foo>` flag wins.
  2. Else, `name:` field in the YAML.
  3. Else, derived from the YAML filename (`project-x.yaml` → `project-x`).
  4. For `mode: ephemeral`, suffix with a short timestamp/uuid so concurrent
     runs don't collide (`project-x-a3f9`).
- Name collision on `up` is a fatal error unless `--replace`.

## 4. YAML schema

### Full example

```yaml
name: project-x                         # optional; --name flag or filename used otherwise
mode: durable                           # durable | ephemeral
base_template: claude-code-docker       # claude-code | claude-code-docker | <custom OCI ref>

repos:
  - source: local
    path: ~/dev/project-a
    branch: agent/feature-x             # optional; defaults to agentbox/<sandbox-name>
  - source: local
    path: ~/dev/shared-libs
    branch: agent/shared-libs-bumps     # any branch name; falls back to default if omitted
  - source: git
    url: git@github.com:org/lib.git
    branch: main
    place: workspace                    # workspace (default) | vm

skills:
  - coding-standards                    # from ~/.claude/skills/<name>/
  - tdd-workflow
  - superpowers:brainstorming           # plugin-namespaced
  - ~/dev/work-skills/our-style         # explicit path

hooks:                                  # written into in-sandbox settings.json
  PostToolUse:
    - matcher: "Bash"
      command: "echo $CLAUDE_TOOL_INPUT >> /tmp/cmd.log"

lifecycle:                              # shell commands run by agentbox
  post_create:                          # after sandbox VM exists, before agent starts
    - "cd shared-libs && npm install"
  pre_agent:                            # right before launching claude
    - "make seed-db"
  on_stop:                              # when agent exits / agentbox stop
    - "git -C project-a status"

network:                                # declarative sbx policy rules
  allow:
    - "*.npmjs.org:443"
    - "github.com:443"
    - "api.anthropic.com:443"

env:                                    # written to /etc/sandbox-persistent.sh
  BRAVE_API_KEY: ${BRAVE_API_KEY}       # ${VAR} resolves from host env at bootstrap
  RUST_LOG: debug

secrets:                                # validated (not stored) by agentbox doctor / up
  - anthropic                           # required
  - github                              # optional but recommended

prompt: ./prompts/refactor-auth.md      # path-or-string (auto-detected)
```

### Schema rules

- All fields except `mode` are optional. Smallest valid config: `mode:
  ephemeral`.
- `${VAR}` interpolation is supported only in `env`, `prompt`, and
  `repos[*].path`.
- `prompt`: if the value resolves to an existing file, contents are read; else
  treated as inline text.
- `mode: ephemeral` defaults: sandbox auto-removed on agent exit unless
  `--keep` passed at `up`.
- `mode: durable` defaults: sandbox persists after agent exit; manage manually
  with `start`/`stop`/`rm`.
- Validation via `zod`. Invalid configs fail at `up` with line/column hints
  pointing into the YAML.

### Field reference

#### `name` (string, optional)

Sandbox identity. Used as the `sbx` sandbox name and as the registry key. Must
be unique across all currently-registered sandboxes. `--name` flag overrides.

#### `mode` (`durable` | `ephemeral`, required)

- `durable` — sandbox persists after agent exits. Resume via `agentbox start`.
- `ephemeral` — sandbox auto-removed when agent exits (unless `--keep` is
  passed). Best for fire-and-forget runs and parallelism.

#### `base_template` (string, optional)

Defaults to `claude-code-docker`. Accepts any of the published `sbx` template
variants or a fully-qualified custom OCI image reference (e.g.,
`docker.io/myorg/my-template:v1`).

#### `repos[]` (array, optional)

Each entry describes one repo to make available in the sandbox.

| Field    | Type                  | Notes                                                                                                                                    |
| -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `source` | `local` \| `git`      | Required.                                                                                                                                |
| `path`   | string                | For `source: local`. Must be an existing git repo on the host.                                                                           |
| `url`    | string                | For `source: git`. Any git-pullable URL.                                                                                                 |
| `branch` | string                | For `source: local`: branch to check out in the worktree. Defaults to `agentbox/<sandbox-name>` (created off current HEAD if it doesn't exist). For `source: git`: branch to clone. |
| `place`  | `workspace` \| `vm`   | For `source: git` only. `workspace` (default): cloned into the parent workspace dir, visible on host. `vm`: cloned into `/home/agent/repos/<name>/`, VM-only. |

All repos that land in the workspace appear as siblings under
`~/.agentbox/sandboxes/<name>/repos/` on the host (and at the same absolute
path inside the VM).

#### `skills[]` (array, optional)

Each entry resolves to a skill source directory:

- Bare name (`coding-standards`) → `~/.claude/skills/<name>/`
- Plugin-namespaced (`superpowers:brainstorming`) → resolved from the local
  plugin cache at `~/.claude/plugins/cache/.../skills/<name>/`
- Absolute or `~`-prefixed path → used directly

Resolved skills are copied to `/home/agent/.claude/skills/<name>/` inside the
sandbox at `up` time. Re-synced on `start` so local edits to skill source
files are picked up. If any skill ref can't be resolved, `up` fails.

#### `hooks` (object, optional)

Claude Code hooks. Merged into `/home/agent/.claude/settings.json` inside the
sandbox at `up` time. Schema follows the standard Claude Code hooks format
(`PreToolUse`, `PostToolUse`, `Stop`, etc., each with `matcher` + `command`).

#### `lifecycle` (object, optional)

Bootstrap shell commands run by `agentbox` at named phases.

| Phase         | When it runs                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `post_create` | After `sbx create` succeeds and skills/hooks/env have been injected, before git repos are cloned and `pre_agent` runs         |
| `pre_agent`   | After git repos are cloned, right before `sbx run claude` launches                                                            |
| `on_stop`     | When the agent exits or `agentbox stop`/`rm` is called                                                                        |

Each command runs as `sbx exec <name> bash -lc "<cmd>"`, so persistent env
vars from `/etc/sandbox-persistent.sh` are sourced. Output is captured to the
per-invocation log.

#### `network` (object, optional)

```yaml
network:
  allow:
    - "*.npmjs.org:443"
    - "github.com:443"
```

Each entry is appended to the sandbox's network policy via `sbx policy allow
network`. If `network.allow` is omitted, the sandbox uses `sbx`'s default
policy.

#### `env` (object, optional)

Map of `KEY: VALUE`. Written to `/etc/sandbox-persistent.sh` as `export KEY=VALUE`
on bootstrap, so all interactive shells and `sbx exec ... bash -c` invocations
see them. Use this for non-credential vars like `BRAVE_API_KEY` or `RUST_LOG`.
Real credentials should go through `sbx secret` instead.

`${HOST_VAR}` interpolation in values reads from the host environment at `up`
time.

#### `secrets[]` (array, optional)

List of `sbx`-supported service names that must be configured before launch
(e.g., `anthropic`, `openai`, `github`). `agentbox up` and `agentbox doctor`
verify each is set in the host keychain via `sbx secret ls -g`. Missing
secrets produce an actionable error pointing to the exact `sbx secret set`
command to run.

#### `prompt` (string, optional)

Inline text or a path to a file. Auto-detected: if the value resolves to an
existing file on disk, its contents are read; otherwise it's treated as a
literal prompt string. The resolved content is passed as the first user
message to Claude Code via `sbx run claude ... -- "<prompt>"`.

## 5. Architecture

### Component diagram

```
┌──────────────────────── HOST ──────────────────────────┐
│                                                        │
│  ~/.agentbox/                                          │
│    ├─ registry.json     name → {config, sbx_id, mode}  │
│    ├─ logs/<name>-<ts>.log                             │
│    └─ sandboxes/<name>/repos/<repo>/  (worktrees +     │
│                                       cloned repos)    │
│                                                        │
│  agentbox CLI ──spawns──> sbx CLI ──manages──> microVM │
│      │                                            │    │
│      │ reads                                      │    │
│      ▼                                            ▼    │
│  project-x.yaml         /home/agent/.claude/{skills,   │
│                                      settings.json}    │
│                         /etc/sandbox-persistent.sh     │
│                         workspace mount = parent dir   │
│                         claude --dangerously-skip-     │
│                                  permissions <prompt>  │
│                                                        │
│  Anthropic creds ──> macOS keychain (sbx secret)       │
│                  ──> sbx proxy injects at runtime      │
│                      (never enter the VM)              │
└────────────────────────────────────────────────────────┘
```

### Workspace model

`sbx` mounts a single host directory as the sandbox's workspace, bidirectional
and at the same absolute path inside the VM. `agentbox` creates and uses
`~/.agentbox/sandboxes/<name>/repos/` as that workspace.

For each `source: local` repo:

1. `agentbox` ensures the host repo is a git repo and the desired branch
   exists (creating it from current HEAD if not).
2. `git -C <path> worktree add <parent>/<reponame> <branch>` creates a
   detached working directory on the chosen branch under the parent dir.
3. The worktree is what the agent sees and modifies. The user's main checkout
   is untouched.

For each `source: git` repo:

- `place: workspace` (default) → cloned into `<parent>/<reponame>` after the
  VM is up, via `sbx exec git clone`. Visible on the host alongside the
  worktrees.
- `place: vm` → cloned into `/home/agent/repos/<reponame>/` inside the VM,
  invisible to the host.

The agent starts in the parent dir. `ls` reveals all repos as immediate
children. The agent navigates with `cd <reponame>`. No CLAUDE.md is
auto-generated; the agent figures out the layout from its first directory
listing.

### `agentbox up` execution sequence

1. **Parse & validate** — load YAML, resolve `${VAR}` interpolations,
   zod-validate. Check skill paths exist, host repos exist and are git repos,
   secrets configured, network entries syntactically valid. Pure host-side,
   reversible. Fail fast.
2. **Acquire registry lock** — `flock`-style lock on `~/.agentbox/registry.json`.
3. **Check name collision** — if registry already has an entry for this name
   and `--replace` not set, fail.
4. **Create worktrees** — for each `source: local` repo, create branch (if
   needed) and add worktree under the parent dir. Failures here roll back any
   already-created worktrees.
5. **Apply network policy** — `sbx policy allow network <entry>` per entry.
6. **Create sandbox** — `sbx create --name <name> --template <base_template>
   <parent-dir>`. From this point a partial sandbox exists; failures trigger
   teardown unless `--keep-on-error`.
7. **Inject configuration** — pipe a tar stream through `sbx exec <name> tar
   -xf - -C /` to deliver:
   - `/home/agent/.claude/skills/<each>/` (resolved skills)
   - `/home/agent/.claude/settings.json` (synthesized from `hooks`)
   - `/etc/sandbox-persistent.sh` (synthesized from `env`)
8. **Run `lifecycle.post_create`** — `sbx exec <name> bash -lc "<cmd>"` per
   entry. Output captured to the log.
9. **Clone git repos** — `sbx exec <name> bash -lc "git clone <url> <dest>"`
   for each.
10. **Run `lifecycle.pre_agent`** — same pattern.
11. **Write registry entry** — atomic write (tmpfile + rename). Includes
    config path, mode, timestamp, `sbx` sandbox ID, hash of the config file
    (for drift detection later).
12. **Start agent** — `sbx run claude <parent-dir> --name <name> --
    "<prompt>"` with stdio inherited so the user sees the agent TUI directly.
13. **On agent exit** — run `lifecycle.on_stop`. If `mode: ephemeral` and
    `--keep` not set, run `agentbox rm <name>` (which handles `sbx rm`,
    worktree removal, registry cleanup).

### Other commands

- **`start <name>`** — registry lookup → `sbx start <name>` → run
  `pre_agent` → `sbx run claude` (skip `sbx create`, skip injection — those
  persist in the durable sandbox).
- **`stop <name>`** — `sbx stop <name>` then run `on_stop` hooks against the
  stopped sandbox via `sbx exec` (sandbox is paused, not removed).
- **`rm <name>`** — confirm (unless `--force`), run `on_stop`, `sbx rm
  <name>`, `git worktree remove` per worktree, delete `<parent-dir>`, drop
  registry entry. With `--prune-branches`, also delete the agentbox-managed
  branches on the host repos.
- **`shell <name>`** — `sbx exec -it <name> bash`.
- **`ls`** — read registry, cross-check with `sbx ls`, show name / mode /
  status / config path. Drift cases:
  - Registry has entry, `sbx` doesn't → status `orphaned`.
  - `sbx` has sandbox, registry doesn't → status `unmanaged` (informational
    only; not ours).
- **`doctor`** — verify `sbx` on PATH, `sbx login` done, `anthropic` secret
  configured, base templates pullable. Reconcile registry drift and offer
  interactive cleanup of orphaned entries.

## 6. Errors, atomicity, and state

### Atomicity guarantees

- Validation and worktree creation are pure host-side operations; failures
  there roll back cleanly with no `sbx` state involved.
- After `sbx create` succeeds, any subsequent failure in `up` triggers
  full teardown by default (`sbx rm`, worktree removal, parent dir delete).
  `--keep-on-error` preserves the partial sandbox for debugging.
- The registry write is the last step before the agent launches. If it fails,
  full teardown runs. The registry never contains entries for sandboxes that
  failed to bootstrap.

### Concurrency

- A file lock on `~/.agentbox/registry.json` serializes registry mutations.
  Two concurrent `up` invocations cannot interleave their reads/writes.
- Two `up` calls with the same name → second one fails after acquiring the
  lock and observing the existing entry.
- Concurrent ephemeral runs with different names share no contention.

### Logging

- Each invocation writes to `~/.agentbox/logs/<name>-<timestamp>.log`,
  capturing every command, every `sbx` invocation, and lifecycle hook output.
- `--verbose` / `-v` tees the log to stderr for live observation.

### Error UX

Every fatal error includes: what failed, the underlying command's exit
code/output, and one concrete next step.

```
✗ secret not configured: anthropic
  Required by: secrets[0]
  Fix: sbx secret set -g anthropic

✗ git worktree creation failed for ~/dev/project-a
  Branch 'agentbox/foo' already checked out at /Users/travis/dev/project-a
  Fix: pick a different branch in repos[0].branch, or `git worktree remove`
       the existing one
```

## 7. Testing strategy

| Tier            | Coverage                                                                                              | Runs in                                            |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Unit**        | YAML parsing, zod schema, path resolution, env interpolation, registry serialization, error formatting | Every commit (Bun's built-in test runner)          |
| **Integration** | Bootstrap pipeline with `sbx` mocked. Verifies command sequencing, argument construction, error paths | Every commit                                       |
| **E2E**         | Real `sbx`, real microVM, real Claude Code, fixtures: minimal, multi-repo, ephemeral                  | Manually + nightly CI; gated by `AGENTBOX_E2E=1`   |

E2E discipline: each test is one happy path end-to-end (`up` → assertion
inside sandbox → `rm`); cleanup in a finally-block; no retries or quarantine.
Failures are signal that `sbx` semantics changed, not test flakiness.

Out of scope: testing `sbx` itself, Anthropic API responses, long-running
agent behavior.

## 8. Build & distribution

- Source: TypeScript, runs on Bun 1.x. `zod` for schema validation; `yaml`
  npm package or `Bun.YAML` for parsing.
- Distribution: `bun build --compile --target=bun-darwin-arm64 ./src/cli.ts
  --outfile dist/agentbox` produces a single static binary.
- Initial install method: place the binary on PATH manually. Homebrew tap or
  release-asset auto-update is a v2 concern.

## 9. Out of scope (v2+)

- MCP server configuration injection.
- Raw non-repo `mounts:` field for non-git host directories (notes, SDKs,
  reference material).
- Per-repo read-only mounts.
- Multi-host or remote sandboxing (CI runners, shared infrastructure).
- A web UI or daemon mode.
- Automatic skill drift detection (notify when a skill source changes after a
  durable sandbox is up).

## 10. Open questions

None at spec time. Track new questions during implementation in the plan
document.
