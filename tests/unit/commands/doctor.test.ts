import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "../../../src/commands/doctor.ts";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-doc-"));
  process.env.AGENTBOX_HOME = workdir;
  delete process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE;
});

afterEach(() => {
  delete process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE;
});

function fakeSbx(opts: {
  version?: string;
  secrets?: string[];
  lsJson?: string;
}): string {
  const p = join(workdir, "fake-sbx.sh");
  const versionOut = opts.version ?? "sbx 1.0.0";
  const secretsOut = (opts.secrets ?? []).join("\n");
  const lsOut = opts.lsJson ?? "[]";
  writeFileSync(
    p,
    `#!/bin/sh
case "$1" in
  version) printf '${versionOut}\\n' ;;
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

test("doctor returns 1 when both anthropic secret AND session credentials are missing", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx({ secrets: ["openai"] });
  process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE = join(workdir, "missing.json");
  const code = await doctor([]);
  expect(code).toBe(1);
});

test("doctor returns 0 when only session credentials are available (no API key)", async () => {
  process.env.AGENTBOX_SBX_BIN = fakeSbx({ secrets: [] });
  // Provide a valid session creds file
  const credsFile = join(workdir, "creds.json");
  writeFileSync(credsFile, '{"oauth_token":"fake"}');
  process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE = credsFile;
  const code = await doctor([]);
  expect(code).toBe(0);
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
