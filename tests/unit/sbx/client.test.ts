import { expect, test } from "bun:test";
import { runSbx, type SbxResult } from "../../../src/sbx/client.ts";

test("runSbx echoes argv and captures stdout", async () => {
  // Use the host `echo` as a stand-in by passing AGENTBOX_SBX_BIN
  process.env.AGENTBOX_SBX_BIN = "/bin/echo";
  const r: SbxResult = await runSbx(["hello", "world"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout.trim()).toBe("hello world");
  expect(r.stderr).toBe("");
});

test("runSbx surfaces non-zero exit codes", async () => {
  process.env.AGENTBOX_SBX_BIN = "/bin/sh";
  const r = await runSbx(["-c", "exit 7"]);
  expect(r.exitCode).toBe(7);
});

test("runSbx throws when binary not found", async () => {
  process.env.AGENTBOX_SBX_BIN = "/this/does/not/exist";
  await expect(runSbx(["x"])).rejects.toThrow();
});
