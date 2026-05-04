/**
 * Gera findings completos antes/depois pra um review id, em JSON, pra
 * uso em geração de PDF/HTML.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { applyGovisaRules } from "../lib/reviewer/rules";

const debugPath = process.argv[2];
const reportPath = process.argv[3];
const outPath = process.argv[4];

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

const focus = (rid: string) => rid.startsWith("T_FILING_PHYSICAL_ADDR");
const before = (report.findings ?? []) as any[];

writeFileSync(
  outPath,
  JSON.stringify(
    {
      review_id: process.argv[5] ?? "",
      proof_of_address_detected: !!debug.proof_of_address,
      before: before.filter((f) => focus(f.rule_id)),
      after: after.filter((f) => focus(f.rule_id)),
      before_total: before.length,
      after_total: after.length
    },
    null,
    2
  )
);
console.log("Wrote:", outPath);
