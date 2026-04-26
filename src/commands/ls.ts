import { listEntries } from "../registry/registry.ts";
import { runSbx } from "../sbx/client.ts";
import { formatError } from "../errors.ts";

interface SbxListEntry { name: string; state: string }

export async function ls(_args: string[]): Promise<number> {
  try {
    const entries = await listEntries();
    const r = await runSbx(["ls", "--json"]);
    let sbxList: SbxListEntry[] = [];
    if (r.exitCode === 0 && r.stdout.trim()) {
      try { sbxList = JSON.parse(r.stdout); } catch {}
    }
    const sbxByName = new Map(sbxList.map((e) => [e.name, e.state]));
    const known = new Set(entries.map((e) => e.name));

    const rows: Array<{ name: string; mode: string; status: string; config: string }> = [];
    for (const e of entries) {
      const state = sbxByName.get(e.name);
      const status = state ? state : "orphaned";
      rows.push({ name: e.name, mode: e.mode, status, config: e.config_path });
    }
    for (const s of sbxList) {
      if (!known.has(s.name)) rows.push({ name: s.name, mode: "-", status: `${s.state} (unmanaged)`, config: "-" });
    }
    if (rows.length === 0) {
      process.stdout.write("No sandboxes.\n");
      return 0;
    }
    const w = (s: string, n: number) => s.padEnd(n);
    process.stdout.write(`${w("NAME", 24)} ${w("MODE", 10)} ${w("STATUS", 22)} CONFIG\n`);
    for (const row of rows) {
      process.stdout.write(`${w(row.name, 24)} ${w(row.mode, 10)} ${w(row.status, 22)} ${row.config}\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(formatError(err) + "\n");
    return 1;
  }
}
