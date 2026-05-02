import type { Logger } from "../log/logger.ts";
import { runSbx } from "../sbx/client.ts";

export type LifecyclePhaseName = "post_create" | "pre_agent" | "on_stop";

export async function runLifecyclePhase(
  phase: LifecyclePhaseName,
  sandbox: string,
  commands: string[] | undefined,
  log: Logger,
): Promise<void> {
  if (!commands || commands.length === 0) return;
  await log.phase(phase, async () => {
    for (const cmd of commands) {
      log.info(`$ ${cmd}`);
      const r = await runSbx(["exec", sandbox, "bash", "-lc", cmd]);
      log.info(r.stdout);
      if (r.stderr) log.warn(r.stderr);
      if (r.exitCode !== 0) {
        throw new Error(
          `Lifecycle command failed in phase '${phase}' (exit ${r.exitCode}): ${cmd}\n${r.stderr}`,
        );
      }
    }
  });
}
