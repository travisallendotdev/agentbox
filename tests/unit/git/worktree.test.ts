import { test, expect, beforeEach } from "bun:test";
import {
  ensureBranch, addWorktree, removeWorktree, listWorktrees, pruneWorktrees,
} from "../../../src/git/worktree.ts";
import { mkdtempSync, realpathSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agbx-gw-"));
  spawnSync("git", ["init", "-q", dir]);
  spawnSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
}

test("ensureBranch creates a new branch off HEAD when missing", async () => {
  const r = makeRepo();
  await ensureBranch(r, "agentbox/foo");
  const out = spawnSync("git", ["-C", r, "branch", "--list", "agentbox/foo"]);
  expect(out.stdout.toString()).toContain("agentbox/foo");
});

test("ensureBranch is idempotent if branch already exists", async () => {
  const r = makeRepo();
  await ensureBranch(r, "agentbox/foo");
  await ensureBranch(r, "agentbox/foo"); // no throw
});

test("addWorktree creates a working tree at the given path on the given branch", async () => {
  const r = makeRepo();
  const wtDir = mkdtempSync(join(tmpdir(), "agbx-wt-"));
  const wt = join(wtDir, "work");
  const wtReal = realpathSync(wtDir) + "/work"; // resolve symlinks like /tmp -> /private/tmp
  await ensureBranch(r, "agentbox/foo");
  await addWorktree(r, wt, "agentbox/foo");
  const list = await listWorktrees(r);
  expect(list.some((w) => w.path === wtReal)).toBe(true);
});

test("removeWorktree removes a worktree", async () => {
  const r = makeRepo();
  const wtDir = mkdtempSync(join(tmpdir(), "agbx-wt-"));
  const wt = join(wtDir, "work");
  const wtReal = realpathSync(wtDir) + "/work";
  await ensureBranch(r, "agentbox/foo");
  await addWorktree(r, wt, "agentbox/foo");
  await removeWorktree(r, wt);
  const list = await listWorktrees(r);
  expect(list.some((w) => w.path === wtReal)).toBe(false);
});

test("removeWorktree --force removes a dirty worktree", async () => {
  const r = makeRepo();
  const wtDir = mkdtempSync(join(tmpdir(), "agbx-wt-"));
  const wt = join(wtDir, "work");
  const wtReal = realpathSync(wtDir) + "/work";
  await ensureBranch(r, "agentbox/foo");
  await addWorktree(r, wt, "agentbox/foo");
  spawnSync("sh", ["-c", `echo dirty > ${wt}/x.txt`]);
  await expect(removeWorktree(r, wt)).rejects.toThrow();
  await removeWorktree(r, wt, { force: true });
  const list = await listWorktrees(r);
  expect(list.some((w) => w.path === wtReal)).toBe(false);
});

test("pruneWorktrees removes worktrees whose disk path is gone", async () => {
  const r = makeRepo();
  const wtBase = mkdtempSync(join(tmpdir(), "agbx-prune-"));
  const wt = join(wtBase, "work");
  const wtReal = realpathSync(wtBase) + "/work"; // resolve symlinks like /tmp -> /private/tmp
  mkdirSync(wt, { recursive: true }); // create dir so addWorktree can place it
  await ensureBranch(r, "agentbox/p");
  await addWorktree(r, wt, "agentbox/p");
  // Forcibly remove the worktree dir from disk WITHOUT git worktree remove
  await Bun.$`rm -rf ${wt}`.quiet();
  // listWorktrees should still show it (via its real path)
  const before = await listWorktrees(r);
  expect(before.some((w) => w.path === wtReal)).toBe(true);
  // After prune, it should be gone
  await pruneWorktrees(r);
  const after = await listWorktrees(r);
  expect(after.some((w) => w.path === wtReal)).toBe(false);
});

test("pruneWorktrees is idempotent on a clean repo", async () => {
  const r = makeRepo();
  await pruneWorktrees(r); // no-op, no throw
  await pruneWorktrees(r); // still no-op
});
