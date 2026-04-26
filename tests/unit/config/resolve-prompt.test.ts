import { test, expect } from "bun:test";
import { resolvePrompt } from "../../../src/config/resolve-prompt.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("returns inline string unchanged when not a file path", async () => {
  const r = await resolvePrompt("just text here");
  expect(r).toBe("just text here");
});

test("reads file contents when path resolves to a file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agbx-prompt-"));
  const file = join(dir, "p.md");
  writeFileSync(file, "from-file");
  const r = await resolvePrompt(file);
  expect(r).toBe("from-file");
});

test("undefined → undefined (no prompt)", async () => {
  const r = await resolvePrompt(undefined);
  expect(r).toBeUndefined();
});

test("path-looking string that isn't a file is treated as inline", async () => {
  const r = await resolvePrompt("./does-not-exist.md");
  expect(r).toBe("./does-not-exist.md");
});
