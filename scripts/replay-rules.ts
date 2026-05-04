/**
 * Replay rules harness — carrega debug_json de uma review já rodada e
 * re-aplica applyGovisaRules com o código atual (rules.ts modificado),
 * comparando findings antes/depois.
 *
 * Uso: npx tsx scripts/replay-rules.ts <path-to-debug.json> <path-to-report.json>
 */

import { readFileSync } from "node:fs";
import { applyGovisaRules } from "../lib/reviewer/rules";

const debugPath = process.argv[2];
const reportPath = process.argv[3];

if (!debugPath || !reportPath) {
  console.error("Uso: npx tsx scripts/replay-rules.ts <debug.json> <report.json>");
  process.exit(1);
}

const debug = JSON.parse(readFileSync(debugPath, "utf8"));
const report = JSON.parse(readFileSync(reportPath, "utf8"));

const newFindings = applyGovisaRules({
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

const oldFindings = (report.findings ?? []) as any[];

const focus = (rid: string) =>
  rid.startsWith("T_FILING_PHYSICAL_ADDR") || rid === "T_FILING_PHYSICAL_ADDR_NEEDS_PROOF";

const oldPhys = oldFindings.filter((f) => focus(f.rule_id));
const newPhys = newFindings.filter((f) => focus(f.rule_id));

console.log("============ ANTES ============");
console.log(`Total findings: ${oldFindings.length}`);
console.log(`Physical Address: ${oldPhys.length}`);
for (const f of oldPhys) {
  console.log(
    `  [${f.severity}] ${f.rule_id} | ${f.subject_id} | ${f.form} | ${f.found?.slice(0, 80) ?? ""}`
  );
}

console.log("\n============ DEPOIS ============");
console.log(`Total findings: ${newFindings.length}`);
console.log(`Physical Address: ${newPhys.length}`);
for (const f of newPhys) {
  console.log(
    `  [${f.severity}] ${f.rule_id} | ${f.subject_id} | ${f.form} | ${(f.found ?? "").slice(0, 80)}`
  );
}

console.log("\n============ DIFF ============");
console.log(`Total: ${oldFindings.length} → ${newFindings.length} (Δ ${newFindings.length - oldFindings.length})`);
console.log(`Physical Address: ${oldPhys.length} → ${newPhys.length} (Δ ${newPhys.length - oldPhys.length})`);

const oldByRule = new Map<string, number>();
const newByRule = new Map<string, number>();
for (const f of oldPhys) oldByRule.set(f.rule_id, (oldByRule.get(f.rule_id) ?? 0) + 1);
for (const f of newPhys) newByRule.set(f.rule_id, (newByRule.get(f.rule_id) ?? 0) + 1);

const allRules = new Set([...oldByRule.keys(), ...newByRule.keys()]);
for (const r of allRules) {
  console.log(`  ${r}: ${oldByRule.get(r) ?? 0} → ${newByRule.get(r) ?? 0}`);
}
