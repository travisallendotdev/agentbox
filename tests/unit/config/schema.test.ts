import { expect, test } from "bun:test";
import { AgentboxConfigSchema } from "../../../src/config/schema.ts";

test("minimal valid config requires only mode", () => {
  const r = AgentboxConfigSchema.safeParse({ mode: "ephemeral" });
  expect(r.success).toBe(true);
});

test("rejects missing mode", () => {
  const r = AgentboxConfigSchema.safeParse({});
  expect(r.success).toBe(false);
});

test("rejects invalid mode", () => {
  const r = AgentboxConfigSchema.safeParse({ mode: "weird" });
  expect(r.success).toBe(false);
});

test("accepts a fully populated config", () => {
  const r = AgentboxConfigSchema.safeParse({
    name: "foo",
    mode: "durable",
    base_template: "claude-code-docker",
    repos: [
      { source: "local", path: "~/dev/a", branch: "agent/x" },
      {
        source: "git",
        url: "git@github.com:o/r.git",
        branch: "main",
        place: "workspace",
      },
    ],
    skills: ["coding-standards", "superpowers:brainstorming", "~/p/skill-x"],
    hooks: { PostToolUse: [{ matcher: "Bash", command: "echo hi" }] },
    lifecycle: {
      post_create: ["echo a"],
      pre_agent: ["echo b"],
      on_stop: ["echo c"],
    },
    network: { allow: ["github.com:443"] },
    env: { FOO: "bar" },
    secrets: ["anthropic"],
    prompt: "go forth",
  });
  expect(r.success).toBe(true);
});

test("local repo requires path", () => {
  const r = AgentboxConfigSchema.safeParse({
    mode: "ephemeral",
    repos: [{ source: "local" }],
  });
  expect(r.success).toBe(false);
});

test("git repo requires url", () => {
  const r = AgentboxConfigSchema.safeParse({
    mode: "ephemeral",
    repos: [{ source: "git" }],
  });
  expect(r.success).toBe(false);
});

test("rejects unknown top-level field", () => {
  const r = AgentboxConfigSchema.safeParse({ mode: "ephemeral", garbage: 1 });
  expect(r.success).toBe(false);
});

test("accepts auth: session", () => {
  const r = AgentboxConfigSchema.safeParse({
    mode: "ephemeral",
    auth: "session",
  });
  expect(r.success).toBe(true);
});

test("accepts auth: api_key", () => {
  const r = AgentboxConfigSchema.safeParse({
    mode: "ephemeral",
    auth: "api_key",
  });
  expect(r.success).toBe(true);
});

test("rejects invalid auth mode", () => {
  const r = AgentboxConfigSchema.safeParse({
    mode: "ephemeral",
    auth: "weird",
  });
  expect(r.success).toBe(false);
});
