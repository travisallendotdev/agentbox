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
});

test("rollback on injection failure: registry not written, parent dir cleaned", async () => {
  // sbx succeeds for everything except the tar inject step
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(
    p,
    `#!/bin/sh
case "$1 $2" in
  "secret ls") echo anthropic; exit 0 ;;
  "exec foo")
    case "$3" in
      tar) cat > /dev/null; exit 1 ;;
      bash) cat > /dev/null; exit 0 ;;
      *) cat > /dev/null; exit 0 ;;
    esac
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
