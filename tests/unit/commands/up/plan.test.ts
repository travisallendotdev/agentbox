import { test, expect, beforeEach } from "bun:test";
import { buildUpPlan } from "../../../../src/commands/up/plan.ts";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-plan-"));
  process.env.AGENTBOX_HOME = workdir;
  // Seed a fake CLAUDE_HOME with one skill
  const ch = join(workdir, "claude-home/skills/coding-standards");
  mkdirSync(ch, { recursive: true });
  writeFileSync(join(ch, "skill.md"), "");
  process.env.CLAUDE_HOME = join(workdir, "claude-home");
  // Fake sbx that dispatches by subcommand. For plan tests we only need
  // `secret ls -g` to return a list of secrets.
  const sbx = join(workdir, "fake-sbx.sh");
  writeFileSync(
    sbx,
    `#!/bin/sh
case "$1" in
  secret) printf 'anthropic\\n' ;;
  *) exit 0 ;;
esac
`,
    { mode: 0o755 },
  );
  process.env.AGENTBOX_SBX_BIN = sbx;
});

function makeRepo(name: string): string {
  const d = join(workdir, name);
  spawnSync("git", ["init", "-q", d]);
  spawnSync("git", ["-C", d, "commit", "-q", "--allow-empty", "-m", "init"]);
  return d;
}

test("derives sandbox name from filename when not in YAML or flag", async () => {
  const cfg = join(workdir, "project-x.yaml");
  writeFileSync(cfg, "mode: ephemeral\n");
  const plan = await buildUpPlan({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false });
  expect(plan.name).toMatch(/^project-x-[a-z0-9]+$/); // ephemeral suffix
});

test("--name flag overrides YAML name and filename", async () => {
  const cfg = join(workdir, "from-file.yaml");
  writeFileSync(cfg, "mode: durable\nname: in-yaml\n");
  const plan = await buildUpPlan({ configPath: cfg, name: "from-flag", replace: false, keep: false, keepOnError: false, verbose: false });
  expect(plan.name).toBe("from-flag");
});

test("ephemeral mode appends a suffix to avoid collisions", async () => {
  const cfg = join(workdir, "e.yaml");
  writeFileSync(cfg, "mode: ephemeral\nname: x\n");
  const plan = await buildUpPlan({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false });
  expect(plan.name).toMatch(/^x-[a-z0-9]+$/);
});

test("validation fails when a required secret is missing", async () => {
  const cfg = join(workdir, "s.yaml");
  writeFileSync(cfg, "mode: durable\nname: s\nsecrets: [anthropic, openai]\n");
  await expect(buildUpPlan({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false })).rejects.toThrow(/openai/);
});

test("plan resolves repos and skills", async () => {
  const repo = makeRepo("repo-a");
  const cfg = join(workdir, "x.yaml");
  writeFileSync(
    cfg,
    `mode: durable\nname: foo\nrepos:\n  - source: local\n    path: ${repo}\nskills: [coding-standards]\n`,
  );
  const plan = await buildUpPlan({ configPath: cfg, replace: false, keep: false, keepOnError: false, verbose: false });
  const r0 = plan.repos[0]!;
  expect(r0.source).toBe("local");
  expect(r0.name).toBe("repo-a");
  expect(plan.skillSources["coding-standards"]).toContain("coding-standards");
});
