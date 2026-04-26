import { test, expect, beforeEach, afterEach } from "bun:test";
import { readHostClaudeCredentials, hasHostClaudeCredentials } from "../../../src/auth/host-credentials.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
const origOverride = process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "agbx-cred-")); });
afterEach(() => {
  if (origOverride === undefined) delete process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE;
  else process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE = origOverride;
});

test("reads from override file when AGENTBOX_CLAUDE_CREDENTIALS_FILE is set", async () => {
  const path = join(workdir, "creds.json");
  writeFileSync(path, '{"oauth_token":"fake"}');
  process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE = path;
  const out = await readHostClaudeCredentials();
  expect(out).toBe('{"oauth_token":"fake"}');
});

test("throws AgentboxError with fix hint when override file is missing", async () => {
  process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE = join(workdir, "missing.json");
  await expect(readHostClaudeCredentials()).rejects.toThrow(/missing file/i);
});

test("hasHostClaudeCredentials returns false when missing", async () => {
  process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE = join(workdir, "missing.json");
  expect(await hasHostClaudeCredentials()).toBe(false);
});

test("hasHostClaudeCredentials returns true when override present", async () => {
  const path = join(workdir, "creds.json");
  writeFileSync(path, '{"x":1}');
  process.env.AGENTBOX_CLAUDE_CREDENTIALS_FILE = path;
  expect(await hasHostClaudeCredentials()).toBe(true);
});
