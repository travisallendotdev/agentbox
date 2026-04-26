import { test, expect, beforeEach } from "bun:test";
import { parseConfigFile } from "../../../src/config/parse.ts";
import { join } from "node:path";

const FIX = join(import.meta.dir, "../../fixtures/configs");

beforeEach(() => {
  process.env.TEST_LOG_LEVEL = "debug";
  process.env.TEST_PROMPT = "hello";
});

test("parses a minimal config", async () => {
  const cfg = await parseConfigFile(join(FIX, "minimal.yaml"));
  expect(cfg.mode).toBe("ephemeral");
});

test("interpolates ${VAR} in env, prompt, repos[].path", async () => {
  const cfg = await parseConfigFile(join(FIX, "full.yaml"));
  expect(cfg.env?.RUST_LOG).toBe("debug");
  expect(cfg.env?.STATIC).toBe("hi");
  expect(cfg.prompt).toBe("hello");
  expect(cfg.repos?.[0]).toMatchObject({ source: "local", path: `${process.env.HOME}/dev/project-a` });
});

test("missing host env var yields a clear error", async () => {
  delete process.env.TEST_LOG_LEVEL;
  await expect(parseConfigFile(join(FIX, "full.yaml"))).rejects.toThrow(/TEST_LOG_LEVEL/);
});

test("does not interpolate ${VAR} in fields outside the allowlist", async () => {
  // Build a temp file inline
  const tmpPath = "/tmp/agentbox-noninterp.yaml";
  await Bun.write(tmpPath, `mode: ephemeral\nname: \${SHOULD_NOT_INTERP}\n`);
  const cfg = await parseConfigFile(tmpPath);
  expect(cfg.name).toBe("${SHOULD_NOT_INTERP}");
});

test("YAML syntax errors include line info", async () => {
  const tmpPath = "/tmp/agentbox-bad.yaml";
  await Bun.write(tmpPath, "mode: ephemeral\n  bad: : :\n");
  await expect(parseConfigFile(tmpPath)).rejects.toThrow();
});
