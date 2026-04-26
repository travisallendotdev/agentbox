import { test, expect, beforeEach } from "bun:test";
import { createLogger } from "../../../src/log/logger.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeEach(() => {
  process.env.AGENTBOX_HOME = mkdtempSync(join(tmpdir(), "agbx-log-"));
});

test("writes lines to the per-invocation log file", async () => {
  const log = await createLogger("foo");
  log.info("hello");
  log.warn("careful");
  log.error("boom");
  await log.close();
  const text = readFileSync(log.path, "utf8");
  expect(text).toContain("hello");
  expect(text).toContain("careful");
  expect(text).toContain("boom");
});

test("phase grouping prefixes lines", async () => {
  const log = await createLogger("foo");
  await log.phase("post_create", () => {
    log.info("running cmd");
  });
  await log.close();
  const text = readFileSync(log.path, "utf8");
  expect(text).toMatch(/\[post_create\] running cmd/);
});

test("verbose mode also writes to stderr", async () => {
  // We don't capture stderr in unit tests; just verify it doesn't throw.
  const log = await createLogger("foo", { verbose: true });
  log.info("v");
  await log.close();
});
