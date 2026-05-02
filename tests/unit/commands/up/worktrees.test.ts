import { beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHostWorktrees,
  removeHostWorktrees,
} from "../../../../src/commands/up/worktrees.ts";

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
      {
        source: "local",
        path: "/nonexistent/path",
        branch: "agent/x",
        name: "b",
      },
    ]),
  ).rejects.toThrow();
  expect(existsSync(join(workdir, "sandboxes/bar/repos/a"))).toBe(false);
  expect(existsSync(join(workdir, "sandboxes/bar/repos"))).toBe(false);
});

test("removeHostWorktrees deletes worktrees", async () => {
  const r1 = makeRepo();
  await createHostWorktrees("baz", [
    { source: "local", path: r1, branch: "agentbox/baz", name: "a" },
  ]);
  await removeHostWorktrees(
    "baz",
    [{ source: "local", path: r1, branch: "agentbox/baz", name: "a" }],
    { force: false },
  );
  expect(existsSync(join(workdir, "sandboxes/baz/repos/a"))).toBe(false);
  expect(existsSync(join(workdir, "sandboxes/baz/repos"))).toBe(false);
});

test("removeHostWorktrees handles a deleted source repo gracefully", async () => {
  const r1 = makeRepo();
  await createHostWorktrees("gone", [
    { source: "local", path: r1, branch: "agentbox/gone", name: "a" },
  ]);
  // Delete the source repo before tearing down
  const { rmSync } = await import("node:fs");
  rmSync(r1, { recursive: true, force: true });
  // removeHostWorktrees should still clean up the worktree dir
  await removeHostWorktrees(
    "gone",
    [{ source: "local", path: r1, branch: "agentbox/gone", name: "a" }],
    { force: false },
  );
  expect(existsSync(join(workdir, "sandboxes/gone/repos/a"))).toBe(false);
  expect(existsSync(join(workdir, "sandboxes/gone/repos"))).toBe(false);
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
