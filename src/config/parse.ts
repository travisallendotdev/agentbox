import { parse as parseYaml } from "yaml";
import { AgentboxConfigSchema, type AgentboxConfig } from "./schema.ts";

const VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

function interpolate(value: string): string {
  return value.replace(VAR_RE, (_, name) => {
    const v = process.env[name];
    if (v === undefined) {
      throw new Error(`Environment variable not set: ${name}`);
    }
    return v;
  });
}

function applyInterpolation(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  // Only interpolate the explicit allowlist fields.
  const out = raw as Record<string, unknown>;

  if (out.env && typeof out.env === "object") {
    const env = out.env as Record<string, unknown>;
    for (const k of Object.keys(env)) {
      if (typeof env[k] === "string") env[k] = interpolate(env[k] as string);
    }
  }
  if (typeof out.prompt === "string") out.prompt = interpolate(out.prompt);
  if (Array.isArray(out.repos)) {
    for (const repo of out.repos) {
      if (repo && typeof repo === "object" && typeof (repo as any).path === "string") {
        (repo as any).path = interpolate((repo as any).path);
      }
    }
  }
  return out;
}

export async function parseConfigFile(path: string): Promise<AgentboxConfig> {
  const text = await Bun.file(path).text();
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const e = err as Error;
    throw new Error(`YAML parse error in ${path}: ${e.message}`);
  }
  raw = applyInterpolation(raw);
  const result = AgentboxConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Config validation failed for ${path}:\n${issues}`);
  }
  return result.data;
}
