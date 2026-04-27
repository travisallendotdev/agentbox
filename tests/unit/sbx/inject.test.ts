import { test, expect, beforeEach } from "bun:test";
import { injectFiles } from "../../../src/sbx/inject.ts";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), "agbx-inj-")); });

// A "fake sbx" — strips the sbx framing and execs the inner command. The
// real call shape now is:
//   sbx exec -u root <name> sh -c "printf '%s' '<b64>' | base64 -d | tar ..."
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
