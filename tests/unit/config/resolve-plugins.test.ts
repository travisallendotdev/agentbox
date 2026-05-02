import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  resolveAllPlugins,
  resolvePlugin,
} from "../../../src/config/resolve-plugins.ts";

const SKILLS_HOME = join(import.meta.dir, "../../fixtures/skills-home");
const orig = process.env.CLAUDE_HOME;
beforeEach(() => {
  process.env.CLAUDE_HOME = SKILLS_HOME;
});
afterEach(() => {
  process.env.CLAUDE_HOME = orig;
});

test("resolves a marketplace-qualified plugin", async () => {
  const r = await resolvePlugin("foo-marketplace:superpowers");
  expect(r.marketplace).toBe("foo-marketplace");
  expect(r.name).toBe("superpowers");
  expect(r.version).toBe("5.0.0");
  expect(r.path).toBe(
    join(SKILLS_HOME, "plugins/cache/foo-marketplace/superpowers/5.0.0"),
  );
});

test("resolves a bare plugin name across marketplaces", async () => {
  const r = await resolvePlugin("superpowers");
  expect(r.marketplace).toBe("foo-marketplace");
  expect(r.name).toBe("superpowers");
  expect(r.version).toBe("5.0.0");
});

test("resolves an absolute path as a local plugin", async () => {
  const explicit = join(
    SKILLS_HOME,
    "plugins/cache/foo-marketplace/superpowers/5.0.0",
  );
  const r = await resolvePlugin(explicit);
  expect(r.marketplace).toBe("local");
  expect(r.name).toBe("5.0.0"); // basename of the path
  expect(r.version).toBe("local");
  expect(r.path).toBe(explicit);
});

test("missing marketplace-qualified plugin errors", async () => {
  await expect(resolvePlugin("foo-marketplace:nope")).rejects.toThrow(/nope/);
});

test("missing bare plugin errors", async () => {
  await expect(resolvePlugin("does-not-exist")).rejects.toThrow(
    /does-not-exist/,
  );
});

test("picks the lexically-greatest version when multiple are present", async () => {
  const dir = join(
    SKILLS_HOME,
    "plugins/cache/foo-marketplace/superpowers/5.0.1",
  );
  mkdirSync(dir, { recursive: true });
  try {
    const r = await resolvePlugin("foo-marketplace:superpowers");
    expect(r.version).toBe("5.0.1");
  } finally {
    // best-effort cleanup; fixture dir is otherwise stable
    try {
      (await import("node:fs")).rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

test("resolveAllPlugins returns array preserving order", async () => {
  const r = await resolveAllPlugins([
    "foo-marketplace:superpowers",
    "superpowers",
  ]);
  expect(r).toHaveLength(2);
  expect(r[0]?.marketplace).toBe("foo-marketplace");
  expect(r[1]?.marketplace).toBe("foo-marketplace");
});
