import { test, expect } from "bun:test";
import { runSbx } from "../src/sbx/client.ts";
import { spawnSync } from "node:child_process";

const ENABLED = process.env.AGENTBOX_E2E === "1";

test.if(ENABLED)("end-to-end smoke", async () => {
  // 1. Bring up the sandbox via the CLI binary
  const up = spawnSync("./dist/agentbox", ["up", "e2e/fixtures/smoke.yaml", "--keep"], { stdio: "inherit" });
  expect(up.status).toBe(0);

  // 2. Verify the marker skill landed in the sandbox
  const r = await runSbx(["exec", "agentbox-e2e-smoke", "ls", "/home/agent/.claude/skills"]);
  expect(r.stdout).toContain("skill-marker");

  // 3. Tear down
  const down = spawnSync("./dist/agentbox", ["rm", "agentbox-e2e-smoke", "--force"], { stdio: "inherit" });
  expect(down.status).toBe(0);
}, 120000);
