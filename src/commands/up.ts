import { parseUpFlags } from "./up/flags.ts";
import { runUp } from "./up/run.ts";

export async function up(args: string[]): Promise<number> {
  const flags = parseUpFlags(args);
  return runUp(flags);
}
