import { test, expect, beforeEach } from "bun:test";
import { start } from "../../src/commands/start.ts";
import { addEntry } from "../../src/registry/registry.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-st-"));
  process.env.AGENTBOX_HOME = workdir;
});

function fakeSbx(logFile: string): string {
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(p, `#!/bin/sh\necho "$@" >> ${logFile}\nexit 0\n`, { mode: 0o755 });
  return p;
}

test("start runs sbx start then sbx run", async () => {
  const log = join(workdir, "sbx.log");
  process.env.AGENTBOX_SBX_BIN = fakeSbx(log);
  const cfg = join(workdir, "c.yaml");
  writeFileSync(cfg, "mode: durable\nname: foo\n");
  await addEntry({
    name: "foo",
    config_path: cfg,
    mode: "durable",
    created_at: "2026-04-25T00:00:00Z",
    sbx_sandbox_id: "foo",
    config_hash: "0",
  });
  const code = await start(["foo"]);
  expect(code).toBe(0);
  const text = await Bun.file(log).text();
  expect(text).toMatch(/start foo/);
  expect(text).toMatch(/run foo/);
});

test("start fails with clear error if name not in registry", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx(join(workdir, "sbx.log"));
  const code = await start(["nope"]);
  expect(code).toBe(1);
});

test("start fails with usage error when name is missing", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx(join(workdir, "sbx.log"));
  const code = await start([]);
  expect(code).toBe(1);
});
