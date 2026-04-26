import { test, expect, beforeEach } from "bun:test";
import { createHostWorktrees, removeHostWorktrees } from "../../../../src/commands/up/worktrees.ts";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-uw-"));
  process.env.AGENTBOX_HOME = workdir;
});

function makeRepo(): string {
  const d = mkdtempSync(join(tmpdir(), "agbx-uwr-"));
  spawnSync("git", ["init", "-q", d]);
  spawnSync("git", ["-C", d, "commit", "-q", "--allow-empty", "-m", "init"]);
  return d;
}

test("creates worktrees under sandboxes/<name>/repos/", async () => {
  const r1 = makeRepo();
  const r2 = makeRepo();
  await createHostWorktrees("foo", [
    { source: "local", path: r1, branch: "agentbox/foo", name: "a" },
    { source: "local", path: r2, branch: "agent/x", name: "b" },
  ]);
  expect(existsSync(join(workdir, "sandboxes/foo/repos/a"))).toBe(true);
  expect(existsSync(join(workdir, "sandboxes/foo/repos/b"))).toBe(true);
});

test("rolls back partial worktrees on later failure", async () => {
  const r1 = makeRepo();
  await expect(
    createHostWorktrees("bar", [
      { source: "local", path: r1, branch: "agentbox/bar", name: "a" },
      { source: "local", path: "/nonexistent/path", branch: "agent/x", name: "b" },
    ]),
  ).rejects.toThrow();
  expect(existsSync(join(workdir, "sandboxes/bar/repos/a"))).toBe(false);
});

test("removeHostWorktrees deletes worktrees", async () => {
  const r1 = makeRepo();
  await createHostWorktrees("baz", [
    { source: "local", path: r1, branch: "agentbox/baz", name: "a" },
  ]);
  await removeHostWorktrees("baz", [{ source: "local", path: r1, branch: "agentbox/baz", name: "a" }], { force: false });
  expect(existsSync(join(workdir, "sandboxes/baz/repos/a"))).toBe(false);
});

test("git repos in the list are skipped (no worktree action)", async () => {
  const r1 = makeRepo();
  await createHostWorktrees("only-git", [
    { source: "local", path: r1, branch: "agentbox/only-git", name: "a" },
    { source: "git", url: "https://x/y.git", place: "workspace", name: "y" },
  ]);
  // Local one is created
  expect(existsSync(join(workdir, "sandboxes/only-git/repos/a"))).toBe(true);
  // Git one is NOT created on the host (it'll be cloned inside the sandbox later)
  expect(existsSync(join(workdir, "sandboxes/only-git/repos/y"))).toBe(false);
});
