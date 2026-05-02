import { parseConfigFile } from "../config/parse.ts";
import { AgentboxError, formatError } from "../errors.ts";
import { runLifecyclePhase } from "../lifecycle/hooks.ts";
import { createLogger } from "../log/logger.ts";
import { getEntry } from "../registry/registry.ts";
import { runSbx } from "../sbx/client.ts";

export async function stop(args: string[]): Promise<number> {
  const [name] = args;
  if (!name) {
    process.stderr.write(
      `${formatError(new AgentboxError("usage: agentbox stop <name>"))}\n`,
    );
    return 1;
  }
  const entry = await getEntry(name);
  if (!entry) {
    process.stderr.write(
      `${formatError(
        new AgentboxError(`No sandbox '${name}' in registry`, {
          fix: "Run `agentbox ls` to see registered sandboxes",
        }),
      )}\n`,
    );
    return 1;
  }
  const log = await createLogger(name);
  try {
    const r = await runSbx(["stop", name]);
    if (r.exitCode !== 0) {
      throw new AgentboxError(`sbx stop failed: ${r.stderr.trim()}`, {
        fix: "Run `agentbox doctor` to verify sbx is working",
      });
    }
    const cfg = await parseConfigFile(entry.config_path);
    await runLifecyclePhase("on_stop", name, cfg.lifecycle?.on_stop, log);
    return 0;
  } catch (err) {
    log.error(formatError(err));
    process.stderr.write(`${formatError(err)}\n`);
    return 1;
  } finally {
    await log.close();
  }
}
