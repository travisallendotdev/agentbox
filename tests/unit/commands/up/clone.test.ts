import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneGitRepos } from "../../../../src/commands/up/clone.ts";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-cln-"));
  process.env.AGENTBOX_HOME = workdir;
});

function fakeSbxRecording(logFile: string): string {
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(p, `#!/bin/sh\necho "$@" >> ${logFile}\nexit 0\n`, {
    mode: 0o755,
  });
  return p;
}

test("clones workspace repos into the parent dir and vm repos into /home/agent/repos", async () => {
  const log = join(workdir, "sbx.log");
  process.env.AGENTBOX_SBX_BIN = fakeSbxRecording(log);
  await cloneGitRepos("foo", [
    { source: "git", url: "https://x/y.git", place: "workspace", name: "y" },
    { source: "git", url: "https://x/z.git", place: "vm", name: "z" },
  ]);
  const lines = await Bun.file(log).text();
  // Workspace repo should mention the parent dir under AGENTBOX_HOME
  expect(lines).toContain(`sandboxes/foo/repos/y`);
  expect(lines).toContain("/home/agent/repos/z");
});

test("includes branch when specified", async () => {
  const log = join(workdir, "sbx.log");
  process.env.AGENTBOX_SBX_BIN = fakeSbxRecording(log);
  await cloneGitRepos("foo", [
    {
      source: "git",
      url: "https://x/y.git",
      place: "workspace",
      branch: "main",
      name: "y",
    },
  ]);
  const lines = await Bun.file(log).text();
  expect(lines).toContain("--branch main");
});

test("no-op when no git repos", async () => {
  const log = join(workdir, "sbx.log");
  process.env.AGENTBOX_SBX_BIN = fakeSbxRecording(log);
  await cloneGitRepos("foo", [
    { source: "local", path: "/x", branch: "agent/x", name: "a" },
  ]);
  // The fake sbx is never invoked, so the log file shouldn't exist.
  const exists = await Bun.file(log).exists();
  if (exists) {
    const lines = await Bun.file(log).text();
    expect(lines).toBe("");
  }
});
