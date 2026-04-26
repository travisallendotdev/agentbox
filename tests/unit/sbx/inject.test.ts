import { test, expect, beforeEach } from "bun:test";
import { injectFiles } from "../../../src/sbx/inject.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "agbx-inj-")); });

// A "fake sbx" — when AGENTBOX_SBX_BIN points at this script, it ignores
// the framing arguments entirely and pipes the tar stream into captureDir.
// Real call shape: sbx exec <name> tar -xf - -C <dest>
function makeFakeSbx(captureDir: string): string {
  const script = join(workdir, "fake-sbx.sh");
  writeFileSync(
    script,
    `#!/bin/sh
# Discard all args; just extract the tar stream from stdin into captureDir.
exec tar -xf - -C ${captureDir}
`,
    { mode: 0o755 },
  );
  return script;
}

test("injectFiles delivers files to the destination directory", async () => {
  const captureDir = join(workdir, "vm");
  mkdirSync(captureDir, { recursive: true });
  process.env.AGENTBOX_SBX_BIN = makeFakeSbx(captureDir);

  const stagingDir = join(workdir, "stage");
  mkdirSync(join(stagingDir, "skills/coding-standards"), { recursive: true });
  writeFileSync(join(stagingDir, "skills/coding-standards/skill.md"), "hi");
  writeFileSync(join(stagingDir, "settings.json"), `{"hooks":{}}`);

  await injectFiles("my-sandbox", stagingDir, "/");
  expect(existsSync(join(captureDir, "skills/coding-standards/skill.md"))).toBe(true);
  expect(readFileSync(join(captureDir, "settings.json"), "utf8")).toBe(`{"hooks":{}}`);
});
