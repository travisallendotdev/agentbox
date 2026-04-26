import { test, expect, beforeEach } from "bun:test";
import { rm } from "../../src/commands/rm.ts";
import { addEntry, getEntry } from "../../src/registry/registry.ts";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-rm-"));
  process.env.AGENTBOX_HOME = workdir;
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(p, `#!/bin/sh\nexit 0\n`, { mode: 0o755 });
  process.env.AGENTBOX_SBX_BIN = p;
});

test("rm removes registry entry", async () => {
  const cfg = join(workdir, "c.yaml");
  writeFileSync(cfg, "mode: durable\nname: foo\n");
  await addEntry({
    name: "foo", config_path: cfg, mode: "durable",
    created_at: "x", sbx_sandbox_id: "foo", config_hash: "0",
  });
  const code = await rm(["foo", "--force"]);
  expect(code).toBe(0);
  expect(await getEntry("foo")).toBeUndefined();
});

test("rm errors when name not in registry", async () => {
  const code = await rm(["nope"]);
  expect(code).toBe(1);
});

test("rm errors when name is missing", async () => {
  const code = await rm([]);
  expect(code).toBe(1);
});

test("rm errors on unknown flag", async () => {
  const code = await rm(["foo", "--bogus"]);
  expect(code).toBe(1);
});

function makeRepoWithWorktree(
  workdir: string,
  sandboxName: string,
  repoName: string,
  branch: string,
): { repoPath: string; worktreePath: string } {
  // Create a host repo
  const repoPath = join(workdir, "src", repoName);
  spawnSync("mkdir", ["-p", repoPath]);
  spawnSync("git", ["init", "-q", repoPath]);
  spawnSync("git", ["-C", repoPath, "commit", "-q", "--allow-empty", "-m", "init"]);
  spawnSync("git", ["-C", repoPath, "branch", branch]);
  // Create the worktree under <workdir>/sandboxes/<name>/repos/<repoName>
  const worktreePath = join(workdir, "sandboxes", sandboxName, "repos", repoName);
  spawnSync("mkdir", ["-p", join(workdir, "sandboxes", sandboxName, "repos")]);
  spawnSync("git", ["-C", repoPath, "worktree", "add", worktreePath, branch]);
  return { repoPath, worktreePath };
}

test("rm refuses on dirty worktree without --force, preserving registry entry and sbx VM", async () => {
  const { repoPath, worktreePath } = makeRepoWithWorktree(workdir, "dirty", "myrepo", "agentbox/dirty");
  // Make it dirty
  writeFileSync(join(worktreePath, "x.txt"), "uncommitted");
  const cfg = join(workdir, "c.yaml");
  writeFileSync(cfg, `mode: durable\nname: dirty\nrepos:\n  - source: local\n    path: ${repoPath}\n`);
  await addEntry({
    name: "dirty", config_path: cfg, mode: "durable",
    created_at: "x", sbx_sandbox_id: "dirty", config_hash: "0",
  });
  const code = await rm(["dirty"]);
  expect(code).toBe(1);
  // CRITICAL: registry entry must still exist
  expect(await getEntry("dirty")).toBeDefined();
  // Worktree dir must still exist (not destroyed)
  expect(existsSync(worktreePath)).toBe(true);
});

test("rm with --force removes a dirty worktree", async () => {
  const { repoPath, worktreePath } = makeRepoWithWorktree(workdir, "dforce", "myrepo", "agentbox/dforce");
  writeFileSync(join(worktreePath, "x.txt"), "uncommitted");
  const cfg = join(workdir, "c.yaml");
  writeFileSync(cfg, `mode: durable\nname: dforce\nrepos:\n  - source: local\n    path: ${repoPath}\n`);
  await addEntry({
    name: "dforce", config_path: cfg, mode: "durable",
    created_at: "x", sbx_sandbox_id: "dforce", config_hash: "0",
  });
  const code = await rm(["dforce", "--force"]);
  expect(code).toBe(0);
  expect(await getEntry("dforce")).toBeUndefined();
  expect(existsSync(worktreePath)).toBe(false);
});

test("rm with unreadable config still completes via fallback", async () => {
  await addEntry({
    name: "noconfig", config_path: join(workdir, "missing.yaml"), mode: "durable",
    created_at: "x", sbx_sandbox_id: "noconfig", config_hash: "0",
  });
  const code = await rm(["noconfig"]);
  expect(code).toBe(0);
  expect(await getEntry("noconfig")).toBeUndefined();
});

test("rm cleans up orphan sandbox dir even without registry entry", async () => {
  const sandboxDir = join(workdir, "sandboxes/orphan/repos");
  await Bun.$`mkdir -p ${sandboxDir}`.quiet();
  // No registry entry created
  // fakeSbx is already set in beforeEach to exit 0 with no output (hasSbx will be false)
  const code = await rm(["orphan", "--force"]);
  expect(code).toBe(0);
  expect(existsSync(join(workdir, "sandboxes/orphan"))).toBe(false);
});

test("rm errors only when there's truly nothing to clean", async () => {
  // Override fakeSbx to return empty ls --json output
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(p, `#!/bin/sh\ncase "$1 $2" in "ls --json") echo "[]" ;; *) exit 0 ;; esac\n`, { mode: 0o755 });
  process.env.AGENTBOX_SBX_BIN = p;
  const code = await rm(["nope"]);
  expect(code).toBe(1);
});
