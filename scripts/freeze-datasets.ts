import { writeFrozen } from "../src/server/eval/freeze";
const m = writeFrozen();
for (const d of m.datasets) console.log(`${d.name.padEnd(22)} rows=${String(d.rows).padEnd(4)} sha256=${d.sha256.slice(0, 16)}… labels=${JSON.stringify(d.labels)}${d.splits ? " splits=" + JSON.stringify(d.splits) : ""}`);
