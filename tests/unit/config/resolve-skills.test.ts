import { test, expect, beforeEach, afterEach } from "bun:test";
import { resolveSkill, resolveAllSkills } from "../../../src/config/resolve-skills.ts";
import { join } from "node:path";

const SKILLS_HOME = join(import.meta.dir, "../../fixtures/skills-home");
const orig = process.env.CLAUDE_HOME;
beforeEach(() => { process.env.CLAUDE_HOME = SKILLS_HOME; });
afterEach(() => { process.env.CLAUDE_HOME = orig; });

test("resolves a bare skill name from ~/.claude/skills", async () => {
  const r = await resolveSkill("coding-standards");
  expect(r).toBe(join(SKILLS_HOME, "skills/coding-standards"));
});

test("resolves a plugin-namespaced skill from plugin cache", async () => {
  const r = await resolveSkill("superpowers:brainstorming");
  expect(r).toContain("superpowers");
  expect(r).toContain("skills/brainstorming");
});

test("resolves an absolute path", async () => {
  const explicit = join(SKILLS_HOME, "skills/coding-standards");
  const r = await resolveSkill(explicit);
  expect(r).toBe(explicit);
});

test("resolves a ~-prefixed path", async () => {
  process.env.HOME = SKILLS_HOME;
  const r = await resolveSkill("~/skills/coding-standards");
  expect(r).toBe(join(SKILLS_HOME, "skills/coding-standards"));
});

test("missing skill produces a clear error", async () => {
  await expect(resolveSkill("does-not-exist")).rejects.toThrow(/does-not-exist/);
});

test("resolveAllSkills returns map name → path", async () => {
  const r = await resolveAllSkills(["coding-standards", "superpowers:brainstorming"]);
  expect(r["coding-standards"]).toContain("coding-standards");
  expect(r["superpowers:brainstorming"]).toContain("brainstorming");
});
