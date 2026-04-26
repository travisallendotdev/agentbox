import { test, expect, beforeEach } from "bun:test";
import { rm } from "../../src/commands/rm.ts";
import { addEntry, getEntry } from "../../src/registry/registry.ts";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-rm-"));
  process.env.AGENTBOX_HOME = workdir;
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(p, `#!/bin/sh\nexit 0\n`, { mode: 0o755 });
  process.env.AGENTBOX_SBX_BIN = p;
});

test("rm removes registry entry", async () => {
  const cfg = join(workdir, "c.yaml");
  writeFileSync(cfg, "mode: durable\nname: foo\n");
  await addEntry({
    name: "foo", config_path: cfg, mode: "durable",
    created_at: "x", sbx_sandbox_id: "foo", config_hash: "0",
  });
  const code = await rm(["foo", "--force"]);
  expect(code).toBe(0);
  expect(await getEntry("foo")).toBeUndefined();
});

test("rm errors when name not in registry", async () => {
  const code = await rm(["nope"]);
  expect(code).toBe(1);
});

test("rm errors when name is missing", async () => {
  const code = await rm([]);
  expect(code).toBe(1);
});

test("rm errors on unknown flag", async () => {
  const code = await rm(["foo", "--bogus"]);
  expect(code).toBe(1);
});
