/**
 * Replay completo: roda regras com dados antigos e mostra diff por rule_id.
 * Uso: npx tsx scripts/replay-all.ts <debug.json> <report.json> [<focus_rule_id>]
 */
import { readFileSync } from "node:fs";
import { applyGovisaRules } from "../lib/reviewer/rules";

const debugPath = process.argv[2];
const reportPath = process.argv[3];
const focus = process.argv[4];

const debug = JSON.parse(readFileSync(debugPath, "utf8"));
const report = JSON.parse(readFileSync(reportPath, "utf8"));

const after = applyGovisaRules({
  forms: debug.extracted_forms ?? [],
  story: debug.story_facts ?? null,
  passportChecks: (debug.passport_checks ?? []).map((p: any) => ({
    subject_id: p.subject_id ?? null,
    check: p.check
  })),
  witnessAnalysis: debug.witness_analysis ?? null,
  medicalAnalysis: debug.medical_analysis ?? null,
  countryAnalysis: debug.country_analysis ?? null,
  leaQualification: debug.lea_qualification ?? null,
  translations: debug.translations_check ?? null,
  proofOfAddress: debug.proof_of_address ?? null,
  subjects: debug.subjects ?? [],
  mode: "draft"
});

const before = (report.findings ?? []) as any[];

const countByRule = (arr: any[]) => {
  const m = new Map<string, number>();
  for (const f of arr) m.set(f.rule_id, (m.get(f.rule_id) ?? 0) + 1);
  return m;
};
const cb = countByRule(before);
const ca = countByRule(after);
const allIds = new Set([...cb.keys(), ...ca.keys()]);

console.log("============ DIFF POR RULE_ID ============");
console.log(`Total: ${before.length} → ${after.length} (Δ ${after.length - before.length})\n`);
const rows: Array<[string, number, number, number]> = [];
for (const r of allIds) {
  const b = cb.get(r) ?? 0;
  const a = ca.get(r) ?? 0;
  if (b !== a) rows.push([r, b, a, a - b]);
}
rows.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]));
for (const [r, b, a, d] of rows) {
  const arrow = d < 0 ? "↓" : "↑";
  console.log(`  ${arrow} ${r.padEnd(50)} ${b} → ${a}  (Δ ${d > 0 ? "+" + d : d})`);
}

if (focus) {
  console.log(`\n============ FOCO: ${focus} ============`);
  console.log("ANTES:");
  for (const f of before.filter((f) => f.rule_id === focus)) {
    console.log(`  ${f.subject_id} | ${f.form} | ${f.field} | ${(f.explanation ?? "").slice(0, 200)}`);
  }
  console.log("\nDEPOIS:");
  for (const f of after.filter((f) => f.rule_id === focus)) {
    console.log(`  ${f.subject_id} | ${f.form} | ${f.field} | ${(f.explanation ?? "").slice(0, 200)}`);
  }
}
