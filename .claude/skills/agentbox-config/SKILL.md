---
name: agentbox-config
description: Full reference for the agentbox YAML config schema and CLI commands. Load whenever writing, validating, or explaining an agentbox config or CLI invocation.
user-invocable: false
---

# agentbox config reference

## Full annotated config

Every valid field is shown below. Fields marked `# required` must be present; all others are optional.

```yaml
# All valid top-level fields. Schema uses Zod .strict() — unknown fields are a validation error.

name: my-sandbox          # optional string. Defaults to config filename stem.
                          # Ephemeral mode appends a short uuid automatically.

mode: ephemeral           # REQUIRED. "durable" | "ephemeral"
                          # durable: sandbox persists after agent exits (use agentbox stop/start)
                          # ephemeral: sandbox auto-removes when agent exits

auth: api_key             # optional. "api_key" | "session". Defaults to api_key.

base_template: my-image   # optional string. sbx base template image name.
                          # Defaults to the Docker sandbox default.

secrets:                  # optional string[]. Secret names from the sbx secret store.
  - anthropic             # e.g. registered via: sbx secret set -g anthropic

env:                      # optional map<string, string>. Env vars for the agent.
  RUST_LOG: debug         # Values support ${VAR} shell expansion from the host env.
  API_URL: ${MY_API_URL}  # Throws if VAR is not set in host environment.

repos:                    # optional. Repos to mount or clone into the sandbox workspace.

  # Local repo — mounted from host via git worktree
  - source: local         # discriminator field, required
    path: ~/dev/my-repo   # required. Supports ${VAR} expansion.
    branch: feat/new      # optional. Creates a new worktree branch on host.

  # Remote git repo — cloned inside the VM
  - source: git           # discriminator field, required
    url: https://github.com/org/repo  # required
    branch: main          # optional
    place: workspace      # optional. "workspace" (default) | "vm"

skills:                   # optional string[]. Skill directories to inject into the agent.
  - ~/.claude/skills/my-skill          # bare name → ~/.claude/skills/<name>
  - ~/path/to/skill-dir                # absolute or ~-prefixed path
  - superpowers:brainstorming          # plugin form: <plugin>:<skill>

plugins:                  # optional string[]. Plugin directories to inject into the agent.
  - superpowers            # bare name → searches all cached marketplaces
  - ~/path/to/plugin-dir   # absolute or ~-prefixed path
  - marketplace:plugin     # marketplace-qualified form

hooks:                    # optional. Claude Code hooks injected into agent's settings.json.
                          # Each hook type is an array of {matcher, command} objects.
                          # matcher is a regex string matched against the tool name.
  PreToolUse:
    - matcher: "Bash"
      command: "echo 'about to run bash'"
  PostToolUse:
    - matcher: "Edit|Write|MultiEdit"
      command: "cd /workspace && bun run format"
  Stop:
    - matcher: ".*"
      command: "notify-send 'Agent stopped'"
  UserPromptSubmit:
    - matcher: ".*"
      command: "echo 'user submitted a prompt'"
  SessionStart:
    - matcher: ".*"
      command: "echo 'session started'"

lifecycle:                # optional. Shell commands run at specific sandbox lifecycle phases.
  post_create:            # after VM is created, before agent starts
    - apt-get install -y ripgrep
  pre_agent:              # immediately before the agent process starts
    - cd /workspace && bun install
  on_stop:                # after the agent stops
    - git push origin HEAD

network:                  # optional. Network policy.
  allow:                  # list of allowed network targets
    - host                # "host" permits access to the Docker host network

prompt: |                 # optional string. Initial prompt sent to the agent.
  Audit the auth module.  # Supports ${VAR} expansion.
  Write a report to AUDIT.md when done.
```

## CLI commands

| Command | Description |
|---------|-------------|
| `agentbox up <path>.yaml [--name <n>] [--replace] [--keep] [--keep-on-error] [-v]` | Create, bootstrap, and start a sandbox |
| `agentbox run <name>` | Resume a stopped durable sandbox |
| `agentbox stop <name>` | Pause a running sandbox (durable mode only) |
| `agentbox shell <name>` | Open an interactive shell inside the sandbox |
| `agentbox rm <name> [--force] [--prune-branches]` | Tear down sandbox, remove worktrees, drop registry entry |
| `agentbox ls` | List all managed sandboxes with status |
| `agentbox doctor` | Verify prerequisites (sbx, auth, secrets, templates) |
| `agentbox init [<path>] [--force]` | Generate an example YAML config in the current directory |

## Key constraints

- **Schema is strict**: unknown fields cause a validation error — only the fields above are valid.
- **`mode` is the only required field** — all others are optional.
- **`repos` discriminated union**: `source` must be exactly `local` or `git`. No other values.
- **`hooks` entries are objects** `{matcher: string, command: string}` — not shell arrays.
- **`${VAR}` interpolation** only works in three places: `prompt`, `env` values, and `repos[].path`. It does NOT work in other string fields (e.g., `name`, `base_template`, `secrets`).
- **`agentbox stop`** only works in `durable` mode. Ephemeral sandboxes auto-remove on exit.
