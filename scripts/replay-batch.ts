/**
 * Roda replay em N reviews e mostra agregado de diffs por rule_id.
 * Uso: npx tsx scripts/replay-batch.ts <dir-com-pares-{id}_debug.json e {id}_report.json>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { applyGovisaRules } from "../lib/reviewer/rules";

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: npx tsx scripts/replay-batch.ts <dir>");
  process.exit(1);
}

const files = readdirSync(dir);
const ids = new Set<string>();
for (const f of files) {
  const m = f.match(/^(.+)_debug\.json$/);
  if (m) ids.add(m[1]);
}

const allBefore = new Map<string, number>();
const allAfter = new Map<string, number>();
const perReview: Array<{
  id: string;
  before_total: number;
  after_total: number;
  rules: Array<[string, number, number]>;
}> = [];

for (const id of ids) {
  const debug = JSON.parse(readFileSync(join(dir, `${id}_debug.json`), "utf8"));
  const report = JSON.parse(readFileSync(join(dir, `${id}_report.json`), "utf8"));
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
  const before = report.findings ?? [];
  const cb = new Map<string, number>();
  const ca = new Map<string, number>();
  for (const f of before) cb.set(f.rule_id, (cb.get(f.rule_id) ?? 0) + 1);
  for (const f of after) ca.set(f.rule_id, (ca.get(f.rule_id) ?? 0) + 1);
  for (const [k, v] of cb) allBefore.set(k, (allBefore.get(k) ?? 0) + v);
  for (const [k, v] of ca) allAfter.set(k, (allAfter.get(k) ?? 0) + v);

  const rules: Array<[string, number, number]> = [];
  const ks = new Set([...cb.keys(), ...ca.keys()]);
  for (const k of ks) {
    const b = cb.get(k) ?? 0;
    const a = ca.get(k) ?? 0;
    if (b !== a) rules.push([k, b, a]);
  }
  perReview.push({
    id,
    before_total: before.length,
    after_total: after.length,
    rules
  });
}

console.log("============ AGREGADO ============");
const allIds = new Set([...allBefore.keys(), ...allAfter.keys()]);
const agg: Array<[string, number, number, number]> = [];
for (const r of allIds) {
  const b = allBefore.get(r) ?? 0;
  const a = allAfter.get(r) ?? 0;
  if (b !== a) agg.push([r, b, a, a - b]);
}
agg.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]));
for (const [r, b, a, d] of agg) {
  const arrow = d < 0 ? "↓" : "↑";
  console.log(`  ${arrow} ${r.padEnd(50)} ${b} → ${a}  (Δ ${d > 0 ? "+" + d : d})`);
}

console.log("\n============ POR REVIEW ============");
for (const pr of perReview) {
  console.log(`\n## ${pr.id}: ${pr.before_total} → ${pr.after_total}`);
  for (const [r, b, a] of pr.rules) {
    const d = a - b;
    const arrow = d < 0 ? "↓" : "↑";
    console.log(`   ${arrow} ${r.padEnd(50)} ${b} → ${a}`);
  }
}
