import { test, expect } from "bun:test";
import { AgentboxError, formatError } from "../../src/errors.ts";

test("AgentboxError carries fix hint", () => {
  const e = new AgentboxError("secret not configured: anthropic", {
    fix: "sbx secret set -g anthropic",
    context: { required_by: "secrets[0]" },
  });
  expect(e.fix).toBe("sbx secret set -g anthropic");
});

test("formatError produces a multi-line block", () => {
  const e = new AgentboxError("secret not configured: anthropic", {
    fix: "sbx secret set -g anthropic",
    context: { required_by: "secrets[0]" },
  });
  const s = formatError(e);
  expect(s).toContain("✗ secret not configured: anthropic");
  expect(s).toContain("required_by: secrets[0]");
  expect(s).toContain("Fix: sbx secret set -g anthropic");
});

test("formatError on a plain Error produces a basic message", () => {
  const s = formatError(new Error("bare"));
  expect(s).toContain("bare");
});
