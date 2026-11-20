/**
 * Frozen datasets: the generators are deterministic; `npm run datasets:freeze` writes them to
 * datasets/*.json with a sha256 manifest. manifest() recomputes the hashes and reports whether the
 * committed files still match (so nobody can quietly change the benchmark under a published number).
 */
import fs from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../lib/crypto";
import { genD1, genD2, genD3, genD4, genD5 } from "./datasets";
import { BREAK_IT } from "../services/breakit";

export function datasets() {
  return {
    "D1-decision-cases": genD1(),
    "D2-identity-pairs": genD2(),
    "D3-scam-messages": genD3(),
    "D4-document-specs": genD4(),
    "D5-policy-questions": genD5(),
    "D6-attacks": BREAK_IT.map((a) => ({ id: a.id, kind: a.kind, name: a.name, expect: a.expect })),
  } as const;
}

function labelCounts(name: string, rows: unknown[]): Record<string, number> {
  const key = name.startsWith("D1") ? "truth" : name.startsWith("D2") ? "same" : name.startsWith("D3") ? "label" : name.startsWith("D4") ? "scenario" : name.startsWith("D5") ? "gold" : "kind";
  const out: Record<string, number> = {};
  for (const r of rows as Record<string, unknown>[]) {
    const v = key === "gold" ? (r.gold ? "answerable" : "unanswerable") : String(r[key]);
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

export function manifest() {
  const dir = path.join(process.cwd(), "datasets");
  const entries = Object.entries(datasets()).map(([name, rows]) => {
    const hash = sha256Hex(canonicalJson(rows));
    const file = path.join(dir, `${name}.json`);
    let committed: "match" | "differs" | "missing" = "missing";
    try {
      committed = sha256Hex(canonicalJson(JSON.parse(fs.readFileSync(file, "utf8")))) === hash ? "match" : "differs";
    } catch {
      committed = "missing";
    }
    const splits = name.startsWith("D1") ? Object.fromEntries(["train", "calibration", "test"].map((s) => [s, (rows as { split: string }[]).filter((r) => r.split === s).length])) : undefined;
    return { name, rows: (rows as unknown[]).length, labels: labelCounts(name, rows as unknown[]), splits, sha256: hash, committedFile: committed };
  });
  return { note: "Synthetic, fictional data. Generated from fixed seeds; see datasets/SPEC.md.", datasets: entries };
}

export function writeFrozen() {
  const dir = path.join(process.cwd(), "datasets");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, rows] of Object.entries(datasets())) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows, null, 1) + "\n");
  const m = manifest();
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  return m;
}
