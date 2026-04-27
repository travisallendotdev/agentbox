import { test, expect, beforeEach } from "bun:test";
import { injectFiles } from "../../../src/sbx/inject.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "agbx-inj-")); });

// A "fake sbx" — strips the sbx framing and execs the inner command. The
// real call shape now is:
//   sbx exec -u root <name> sh -c "cp -r '<staging>/.' '<dest>' && chown… && chmod…"
// so the fake skips 'exec', any '-u <user>' option, and the sandbox name.
function makeFakeSbx(): string {
  const script = join(workdir, "fake-sbx.sh");
  writeFileSync(
    script,
    `#!/bin/sh
# Drop the 'exec' subcommand
shift
# Drop the optional '-u <user>' pair
if [ "$1" = "-u" ]; then shift 2; fi
# Drop the sandbox name
shift
exec "$@"
`,
    { mode: 0o755 },
  );
  return script;
}

test("injectFiles delivers files to the destination directory", async () => {
  const captureDir = join(workdir, "vm");
  mkdirSync(captureDir, { recursive: true });
  process.env.AGENTBOX_SBX_BIN = makeFakeSbx();

  const stagingDir = join(workdir, "stage");
  mkdirSync(join(stagingDir, "skills/coding-standards"), { recursive: true });
  writeFileSync(join(stagingDir, "skills/coding-standards/skill.md"), "hi");
  writeFileSync(join(stagingDir, "settings.json"), `{"hooks":{}}`);

  await injectFiles("my-sandbox", stagingDir, captureDir);
  expect(existsSync(join(captureDir, "skills/coding-standards/skill.md"))).toBe(true);
  expect(readFileSync(join(captureDir, "settings.json"), "utf8")).toBe(`{"hooks":{}}`);
});

test("injectFiles handles payloads beyond the old base64-in-shell ARG_MAX cap", async () => {
  // Old transport capped at ~96 KB base64. Bind-mount transport has no cap.
  // Verify we can move several MB without issue.
  const captureDir = join(workdir, "vm-large");
  mkdirSync(captureDir, { recursive: true });
  process.env.AGENTBOX_SBX_BIN = makeFakeSbx();

  const stagingDir = join(workdir, "stage-large");
  mkdirSync(stagingDir, { recursive: true });
  // 2 MB blob — well past the previous 96 KB cap
  const blob = "x".repeat(2 * 1024 * 1024);
  writeFileSync(join(stagingDir, "big.bin"), blob);

  await injectFiles("my-sandbox", stagingDir, captureDir);
  expect(readFileSync(join(captureDir, "big.bin"), "utf8").length).toBe(blob.length);
});
