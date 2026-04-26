import { getEntry } from "../registry/registry.ts";
import { runSbx, runSbxInherit } from "../sbx/client.ts";
import { runLifecyclePhase } from "../lifecycle/hooks.ts";
import { createLogger } from "../log/logger.ts";
import { parseConfigFile } from "../config/parse.ts";
import { resolvePrompt } from "../config/resolve-prompt.ts";
import { AgentboxError, formatError } from "../errors.ts";

export async function start(args: string[]): Promise<number> {
  const [name] = args;
  if (!name) {
    process.stderr.write(formatError(new AgentboxError("usage: agentbox start <name>")) + "\n");
    return 1;
  }
  const entry = await getEntry(name);
  if (!entry) {
    process.stderr.write(formatError(new AgentboxError(`No sandbox '${name}' in registry`, {
      fix: "Run `agentbox ls` to see registered sandboxes",
    })) + "\n");
    return 1;
  }
  const log = await createLogger(name);
  try {
    const cfg = await parseConfigFile(entry.config_path);
    const r1 = await runSbx(["start", name]);
    if (r1.exitCode !== 0) {
      throw new AgentboxError(`sbx start failed: ${r1.stderr.trim()}`, {
        fix: "Run `agentbox doctor` to verify sbx is working",
      });
    }
    log.info(`started ${name}`);
    await runLifecyclePhase("pre_agent", name, cfg.lifecycle?.pre_agent, log);
    const prompt = await resolvePrompt(cfg.prompt);
    const promptArgs = prompt ? ["--", prompt] : [];
    await log.close();
    return await runSbxInherit(["run", name, ...promptArgs]);
  } catch (err) {
    log.error(formatError(err));
    await log.close();
    process.stderr.write(formatError(err) + "\n");
    return 1;
  }
}
