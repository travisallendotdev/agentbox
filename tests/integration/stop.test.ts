import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stop } from "../../src/commands/stop.ts";
import { addEntry } from "../../src/registry/registry.ts";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-stp-"));
  process.env.AGENTBOX_HOME = workdir;
});

function fakeSbx(logFile: string): string {
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(p, `#!/bin/sh\necho "$@" >> ${logFile}\nexit 0\n`, {
    mode: 0o755,
  });
  return p;
}

test("stop calls sbx stop and runs on_stop", async () => {
  const log = join(workdir, "sbx.log");
  process.env.AGENTBOX_SBX_BIN = fakeSbx(log);
  const cfg = join(workdir, "c.yaml");
  writeFileSync(
    cfg,
    'mode: durable\nname: foo\nlifecycle:\n  on_stop: ["echo bye"]\n',
  );
  await addEntry({
    name: "foo",
    config_path: cfg,
    mode: "durable",
    created_at: "2026-04-25T00:00:00Z",
    sbx_sandbox_id: "foo",
    config_hash: "0",
  });
  const code = await stop(["foo"]);
  expect(code).toBe(0);
  const text = await Bun.file(log).text();
  expect(text).toMatch(/stop foo/);
});

test("stop returns 1 when name not in registry", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx(join(workdir, "sbx.log"));
  const code = await stop(["nope"]);
  expect(code).toBe(1);
});

test("stop returns 1 when name is missing", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx(join(workdir, "sbx.log"));
  const code = await stop([]);
  expect(code).toBe(1);
});
