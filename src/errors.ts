export interface AgentboxErrorOptions {
  fix?: string;
  context?: Record<string, string>;
  cause?: unknown;
}

export class AgentboxError extends Error {
  fix?: string;
  context?: Record<string, string>;
  constructor(message: string, opts: AgentboxErrorOptions = {}) {
    super(message);
    this.name = "AgentboxError";
    this.fix = opts.fix;
    this.context = opts.context;
    if (opts.cause) (this as unknown as { cause: unknown }).cause = opts.cause;
  }
}

export function formatError(e: unknown): string {
  if (e instanceof AgentboxError) {
    const lines = [`✗ ${e.message}`];
    if (e.context) {
      for (const [k, v] of Object.entries(e.context))
        lines.push(`  ${k}: ${v}`);
    }
    if (e.fix) lines.push(`  Fix: ${e.fix}`);
    return lines.join("\n");
  }
  if (e instanceof Error) return `✗ ${e.message}`;
  return `✗ ${String(e)}`;
}
