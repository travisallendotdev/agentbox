import { test, expect } from "bun:test";
import { resolveTemplateRef } from "../../../../src/commands/up/create.ts";

test("expands bare variant name to docker/sandbox-templates", () => {
  expect(resolveTemplateRef("claude-code-docker")).toBe("docker.io/docker/sandbox-templates:claude-code-docker");
  expect(resolveTemplateRef("claude-code")).toBe("docker.io/docker/sandbox-templates:claude-code");
});

test("passes through full OCI references unchanged", () => {
  expect(resolveTemplateRef("docker.io/myorg/foo:v1")).toBe("docker.io/myorg/foo:v1");
  expect(resolveTemplateRef("ghcr.io/foo/bar")).toBe("ghcr.io/foo/bar");
  expect(resolveTemplateRef("foo/bar")).toBe("foo/bar");
});

test("preserves names containing colons (treated as already-tagged refs)", () => {
  expect(resolveTemplateRef("foo:tag")).toBe("foo:tag");
});
