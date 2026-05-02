import { formatError } from "../errors.ts";
import { listEntries } from "../registry/registry.ts";
import { runSbx } from "../sbx/client.ts";

interface SbxListEntry {
  name: string;
  status: string;
}

function parseSbxList(stdout: string): SbxListEntry[] {
  try {
    const parsed = JSON.parse(stdout);
    // sbx 0.27 wraps the array as { sandboxes: [...] }; older versions return
    // a top-level array. Accept either.
    const arr = Array.isArray(parsed) ? parsed : parsed?.sandboxes;
    if (!Array.isArray(arr)) return [];
    return arr.map((e) => ({
      name: e.name,
      status: e.status ?? e.state ?? "unknown",
    }));
  } catch {
    return [];
  }
}

export async function ls(_args: string[]): Promise<number> {
  try {
    const entries = await listEntries();
    const r = await runSbx(["ls", "--json"]);
    const sbxList =
      r.exitCode === 0 && r.stdout.trim() ? parseSbxList(r.stdout) : [];
    const sbxByName = new Map(sbxList.map((e) => [e.name, e.status]));
    const known = new Set(entries.map((e) => e.name));

    const rows: Array<{
      name: string;
      mode: string;
      status: string;
      config: string;
    }> = [];
    for (const e of entries) {
      const status = sbxByName.get(e.name) ?? "orphaned";
      rows.push({ name: e.name, mode: e.mode, status, config: e.config_path });
    }
    for (const s of sbxList) {
      if (!known.has(s.name))
        rows.push({
          name: s.name,
          mode: "-",
          status: `${s.status} (unmanaged)`,
          config: "-",
        });
    }
    if (rows.length === 0) {
      process.stdout.write("No sandboxes.\n");
      return 0;
    }
    const w = (s: string, n: number) => s.padEnd(n);
    process.stdout.write(
      `${w("NAME", 24)} ${w("MODE", 10)} ${w("STATUS", 22)} CONFIG\n`,
    );
    for (const row of rows) {
      process.stdout.write(
        `${w(row.name, 24)} ${w(row.mode, 10)} ${w(row.status, 22)} ${row.config}\n`,
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(`${formatError(err)}\n`);
    return 1;
  }
}
