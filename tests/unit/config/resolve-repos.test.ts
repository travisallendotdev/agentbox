import { test, expect, beforeEach } from "bun:test";
import { resolveRepos } from "../../../src/config/resolve-repos.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "agbx-repo-"));
  spawnSync("git", ["init", "-q", dir]);
  spawnSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
}

test("local repo: defaults branch to agentbox/<name>", async () => {
  const dir = makeRepo();
  const r = await resolveRepos(
    [{ source: "local", path: dir }],
    "my-sandbox",
  );
  expect(r[0]).toMatchObject({
    source: "local",
    path: dir,
    branch: "agentbox/my-sandbox",
  });
});

test("local repo: keeps explicit branch", async () => {
  const dir = makeRepo();
  const r = await resolveRepos(
    [{ source: "local", path: dir, branch: "agent/x" }],
    "my-sandbox",
  );
  expect(r[0] && r[0].source === "local" ? r[0].branch : undefined).toBe("agent/x");
});

test("local repo: rejects non-git path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agbx-nogit-"));
  await expect(
    resolveRepos([{ source: "local", path: dir }], "n"),
  ).rejects.toThrow(/not a git repo/i);
});

test("local repo: rejects nonexistent path", async () => {
  await expect(
    resolveRepos([{ source: "local", path: "/nonexistent-path-xyz" }], "n"),
  ).rejects.toThrow(/does not exist/i);
});

test("git repo: defaults place to workspace", async () => {
  const r = await resolveRepos(
    [{ source: "git", url: "https://x/y.git" }],
    "n",
  );
  expect(r[0]).toMatchObject({ source: "git", url: "https://x/y.git", place: "workspace" });
});

test("repo name is computed from path/url basename", async () => {
  const dir = makeRepo();
  const r = await resolveRepos(
    [
      { source: "local", path: dir },
      { source: "git", url: "https://example.com/foo-bar.git" },
    ],
    "n",
  );
  expect(r[0]?.name).toBe(dir.split("/").pop());
  expect(r[1]?.name).toBe("foo-bar");
});

test("rejects duplicate repo names", async () => {
  const dir1 = makeRepo();
  // Force same basename collision via .git URL
  await expect(
    resolveRepos(
      [
        { source: "local", path: dir1 },
        { source: "git", url: `https://x/${dir1.split("/").pop()}.git` },
      ],
      "n",
    ),
  ).rejects.toThrow(/duplicate/i);
});
