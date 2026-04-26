import { test, expect, beforeEach } from "bun:test";
import { doctor } from "../../../src/commands/doctor.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-doc-"));
  process.env.AGENTBOX_HOME = workdir;
});

function fakeSbx(opts: { version?: string; secrets?: string[]; lsJson?: string }): string {
  const p = join(workdir, "fake-sbx.sh");
  const versionOut = opts.version ?? "sbx 1.0.0";
  const secretsOut = (opts.secrets ?? []).join("\n");
  const lsOut = opts.lsJson ?? "[]";
  writeFileSync(
    p,
    `#!/bin/sh
case "$1" in
  --version) printf '${versionOut}\\n' ;;
  secret) printf '${secretsOut.replace(/\n/g, "\\n")}\\n' ;;
  ls) printf '${lsOut.replace(/'/g, "'\\''")}' ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  return p;
}

test("doctor returns 0 when sbx is healthy and anthropic secret is set", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx({ secrets: ["anthropic", "openai"] });
  const code = await doctor([]);
  expect(code).toBe(0);
});

test("doctor returns 1 when anthropic secret missing", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx({ secrets: ["openai"] });
  const code = await doctor([]);
  expect(code).toBe(1);
});

test("doctor returns 1 when sbx command is missing", async () => {
  process.env.AGENTBOX_SBX_BIN = "/nonexistent/sbx";
  const code = await doctor([]);
  expect(code).toBe(1);
});

test("doctor reports a problem when registry is corrupted", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx({ secrets: ["anthropic"] });
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, "registry.json"), "not valid json {");
  const code = await doctor([]);
  expect(code).toBe(1);
});
