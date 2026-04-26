import { test, expect, beforeEach } from "bun:test";
import { doctor } from "../../../src/commands/doctor.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-doc-"));
  process.env.AGENTBOX_HOME = workdir;
});

function fakeSbx(stdout: string, code = 0): string {
  const p = join(workdir, "fake-sbx.sh");
  writeFileSync(p, `#!/bin/sh\nprintf '${stdout.replace(/'/g, "'\\''")}'\nexit ${code}\n`, { mode: 0o755 });
  return p;
}

test("doctor returns 0 when sbx is healthy and anthropic secret is set", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx("anthropic\nopenai\n");
  const code = await doctor([]);
  expect(code).toBe(0);
});

test("doctor returns 1 when anthropic secret missing", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx("openai\n");
  const code = await doctor([]);
  expect(code).toBe(1);
});

test("doctor returns 1 when sbx command is missing", async () => {
  process.env.AGENTBOX_SBX_BIN = "/nonexistent/sbx";
  const code = await doctor([]);
  expect(code).toBe(1);
});
