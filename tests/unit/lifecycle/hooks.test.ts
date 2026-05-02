import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLifecyclePhase } from "../../../src/lifecycle/hooks.ts";
import { createLogger } from "../../../src/log/logger.ts";

let workdir: string;
beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "agbx-hook-"));
  process.env.AGENTBOX_HOME = workdir;
});

function makeFakeSbx(): string {
  const path = join(workdir, "fake-sbx.sh");
  // The fake just runs whatever command was passed inside `bash -lc`, ignoring the sbx framing.
  writeFileSync(
    path,
    `#!/bin/sh
# expected: exec <name> bash -lc "<cmd>"
shift; shift; shift; shift  # exec <name> bash -lc
exec /bin/sh -c "$@"
`,
    { mode: 0o755 },
  );
  return path;
}

test("runs each command in sequence", async () => {
  process.env.AGENTBOX_SBX_BIN = makeFakeSbx();
  const log = await createLogger("foo");
  const aFile = join(workdir, "a");
  const bFile = join(workdir, "b");
  await runLifecyclePhase(
    "post_create",
    "foo",
    [`echo a > ${aFile}`, `echo b > ${bFile}`],
    log,
  );
  await log.close();
  expect(readFileSync(aFile, "utf8").trim()).toBe("a");
  expect(readFileSync(bFile, "utf8").trim()).toBe("b");
});

test("aborts on first failing command", async () => {
  process.env.AGENTBOX_SBX_BIN = makeFakeSbx();
  const log = await createLogger("foo");
  const nope = join(workdir, "nope");
  await expect(
    runLifecyclePhase(
      "post_create",
      "foo",
      ["false", `echo should-not-run > ${nope}`],
      log,
    ),
  ).rejects.toThrow();
  await log.close();
});

test("undefined commands list is a no-op", async () => {
  const log = await createLogger("foo");
  await runLifecyclePhase("post_create", "foo", undefined, log);
  await log.close();
});
