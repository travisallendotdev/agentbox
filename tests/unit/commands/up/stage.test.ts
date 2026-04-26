import { test, expect, beforeEach } from "bun:test";
import { stageInjection } from "../../../../src/commands/up/stage.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "agbx-stg-")); });

test("stages skills, settings.json, and env file under correct subpaths", async () => {
  const skillSrc = join(workdir, "skill-src");
  mkdirSync(skillSrc, { recursive: true });
  writeFileSync(join(skillSrc, "skill.md"), "hello");

  const stage = await stageInjection({
    skillSources: { "coding-standards": skillSrc },
    hooks: { PostToolUse: [{ matcher: "Bash", command: "echo hi" }] },
    env: { FOO: "bar", BAZ: "qux" },
  });

  // skills land at home/agent/.claude/skills/<name>
  expect(existsSync(join(stage.dir, "home/agent/.claude/skills/coding-standards/skill.md"))).toBe(true);
  // settings.json
  const settings = JSON.parse(readFileSync(join(stage.dir, "home/agent/.claude/settings.json"), "utf8"));
  expect(settings.hooks.PostToolUse[0].command).toBe("echo hi");
  // env file
  const env = readFileSync(join(stage.dir, "etc/sandbox-persistent.sh"), "utf8");
  expect(env).toContain("export FOO='bar'");
  expect(env).toContain("export BAZ='qux'");
});

test("env values are single-quoted with embedded quotes escaped", async () => {
  const stage = await stageInjection({
    skillSources: {},
    hooks: undefined,
    env: { TRICKY: "it's tricky" },
  });
  const env = readFileSync(join(stage.dir, "etc/sandbox-persistent.sh"), "utf8");
  expect(env).toContain(`export TRICKY='it'\\''s tricky'`);
});

test("empty inputs produce empty (but valid) settings.json and env file", async () => {
  const stage = await stageInjection({
    skillSources: {},
    hooks: undefined,
    env: undefined,
  });
  const settings = JSON.parse(readFileSync(join(stage.dir, "home/agent/.claude/settings.json"), "utf8"));
  expect(settings).toEqual({});
  const env = readFileSync(join(stage.dir, "etc/sandbox-persistent.sh"), "utf8");
  expect(env).toBe("\n"); // empty entries → just a newline
});
