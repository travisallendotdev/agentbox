import { AgentboxError, formatError } from "../errors.ts";
import { runSbxInherit } from "../sbx/client.ts";

export async function shell(args: string[]): Promise<number> {
  const [name] = args;
  if (!name) {
    process.stderr.write(
      `${formatError(new AgentboxError("usage: agentbox shell <name>"))}\n`,
    );
    return 1;
  }
  return await runSbxInherit(["exec", "-it", name, "bash"]);
}
