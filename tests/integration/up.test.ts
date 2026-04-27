import { test, expect, beforeEach } from "bun:test";
import { runUp } from "../../src/commands/up/run.ts";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getEntry } from "../../src/registry/registry.ts";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-up-"));
  process.env.AGENTBOX_HOME = workdir;
  // Fake claude home with a skill
  const ch = join(workdir, "claude-home/skills/coding-standards");
  mkdirSync(ch, { recursive: true });
  writeFileSync(join(ch, "skill.md"), "");
  process.env.CLAUDE_HOME = join(workdir, "claude-home");
});

function fakeSbxAlwaysOK(logFile: string): string {
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(
    p,
    `#!/bin/sh
echo "$@" >> ${logFile}
case "$1" in
  secret) echo anthropic ;;
  exec)
    # Real call: sbx exec <name> <cmd...>
    # If $3 is "tar", drain the tar stream from stdin so injectFiles doesn't block.
    case "$3" in
      tar) cat > /dev/null ;;
    esac
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return p;
}

function makeRepo(): string {
  const d = mkdtempSync(join(tmpdir(), "agbx-up-r-"));
  spawnSync("git", ["init", "-q", d]);
  spawnSync("git", ["-C", d, "commit", "-q", "--allow-empty", "-m", "init"]);
  return d;
}

test("happy path: durable mode, one local repo, registers and reports success", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbxAlwaysOK(join(workdir, "sbx.log"));
  const repo = makeRepo();
  const cfg = join(workdir, "x.yaml");
  writeFileSync(
    cfg,
    `mode: durable\nname: foo\nrepos:\n  - source: local\n    path: ${repo}\nsecrets: [anthropic]\nskills: [coding-standards]\n`,
  );
  const code = await runUp({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false });
  expect(code).toBe(0);
  expect(await getEntry("foo")).toBeDefined();
  const repoBaseName = repo.split("/").pop();
  expect(existsSync(join(workdir, "sandboxes/foo/repos/" + repoBaseName))).toBe(true);
  // sbx create should have received the staging dir as a `:ro` extra workspace
  // — that's the bind-mount transport we use for inject. Verify the arg is present.
  const sbxLog = await Bun.file(join(workdir, "sbx.log")).text();
  const createLine = sbxLog.split("\n").find((l) => l.startsWith("create "));
  expect(createLine).toBeDefined();
  expect(createLine).toContain(join(workdir, "sandboxes/foo/inject") + ":ro");
  // Each local-source repo's `.git` should be mounted (rw is sbx's default)
  // so the worktree's relative gitdir pointer resolves inside the VM.
  expect(createLine).toContain(join(repo, ".git"));
});

test("rollback cleans up host worktrees when sbx create fails", async () => {
  // Force `sbx create` to fail by making the fake sbx exit 1 on "create"
  const p = join(workdir, "fake-sbx-failcreate.sh");
  writeFileSync(
    p,
    `#!/bin/sh
case "$1" in
  secret) echo anthropic ;;
  create) exit 1 ;;
  *) exit 0 ;;
esac
`,
    { mode: 0o755 },
  );
  process.env.AGENTBOX_SBX_BIN = p;
  const repo = makeRepo();
  const cfg = join(workdir, "x.yaml");
  writeFileSync(
    cfg,
    `mode: durable\nname: foo\nrepos:\n  - source: local\n    path: ${repo}\nsecrets: [anthropic]\n`,
  );
  const code = await runUp({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false });
  expect(code).not.toBe(0);
  // Critical: host worktree should NOT leak — git worktree list on the source repo should not have it
  const out = await Bun.$`git -C ${repo} worktree list`.text();
  expect(out).not.toContain("agentbox/foo");
  // Sandbox dir should be cleaned up too
  expect(existsSync(join(workdir, "sandboxes/foo"))).toBe(false);
});

test("pre-flight detects existing sandbox dir from a failed prior run", async () => {
  const repo = makeRepo();
  // Create a leftover sandbox dir without a registry entry
  const sandboxDir = join(workdir, "sandboxes/foo");
  await Bun.$`mkdir -p ${sandboxDir}/repos`.quiet();
  process.env.AGENTBOX_SBX_BIN = fakeSbxAlwaysOK(join(workdir, "sbx.log"));
  const cfg = join(workdir, "x.yaml");
  writeFileSync(
    cfg,
    `mode: durable\nname: foo\nrepos:\n  - source: local\n    path: ${repo}\nsecrets: [anthropic]\n`,
  );
  const code = await runUp({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false });
  expect(code).toBe(1);
  // The leftover dir should still exist (we didn't clean it up — user told us to abort)
  expect(existsSync(sandboxDir)).toBe(true);
});

test("--replace overwrites an existing sandbox dir", async () => {
  const repo = makeRepo();
  // Create a leftover sandbox dir
  const sandboxDir = join(workdir, "sandboxes/foo");
  await Bun.$`mkdir -p ${sandboxDir}/repos`.quiet();
  process.env.AGENTBOX_SBX_BIN = fakeSbxAlwaysOK(join(workdir, "sbx.log"));
  const cfg = join(workdir, "x.yaml");
  writeFileSync(
    cfg,
    `mode: durable\nname: foo\nrepos:\n  - source: local\n    path: ${repo}\nsecrets: [anthropic]\n`,
  );
  const code = await runUp({ configPath: cfg, replace: true, keep: false, keepOnError: false, verbose: false });
  expect(code).toBe(0);
});

test("--replace tears down existing state before recreating", async () => {
  const repo = makeRepo();
  // Pre-create a leftover sandbox dir
  const sandboxDir = join(workdir, "sandboxes/foo");
  await Bun.$`mkdir -p ${sandboxDir}/repos`.quiet();

  process.env.AGENTBOX_SBX_BIN = fakeSbxAlwaysOK(join(workdir, "sbx.log"));
  const cfg = join(workdir, "x.yaml");
  writeFileSync(
    cfg,
    `mode: durable\nname: foo\nrepos:\n  - source: local\n    path: ${repo}\nsecrets: [anthropic]\n`,
  );
  const code = await runUp({ configPath: cfg, replace: true, keep: false, keepOnError: false, verbose: false });
  expect(code).toBe(0);
  // The sandbox should now exist with the new state
  const repoBaseName = repo.split("/").pop();
  expect(existsSync(join(workdir, "sandboxes/foo/repos/" + repoBaseName))).toBe(true);
});

test("rollback on injection failure: registry not written, parent dir cleaned", async () => {
  // sbx succeeds for everything except the tar inject step
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(
    p,
    `#!/bin/sh
# Skip optional '-u <user>' so 'exec -u root foo …' matches 'exec foo …'.
sub="$1"; shift || true
if [ "$1" = "-u" ]; then shift 2; fi
case "$sub $1" in
  "secret ls") echo anthropic; exit 0 ;;
  "exec foo")
    # Inject is invoked as: exec [-u root] foo sh -c "<base64-tar pipeline>".
    # Fail when the inner command is sh -c (the inject); allow other execs.
    if [ "$2" = "sh" ]; then exit 1; fi
    cat > /dev/null
    exit 0
    ;;
  *) exit 0 ;;
esac
`,
    { mode: 0o755 },
  );
  process.env.AGENTBOX_SBX_BIN = p;
  const repo = makeRepo();
  const cfg = join(workdir, "x.yaml");
  writeFileSync(
    cfg,
    `mode: durable\nname: foo\nrepos:\n  - source: local\n    path: ${repo}\nsecrets: [anthropic]\n`,
  );
  const code = await runUp({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false });
  expect(code).not.toBe(0);
  expect(await getEntry("foo")).toBeUndefined();
  expect(existsSync(join(workdir, "sandboxes/foo"))).toBe(false);
});
