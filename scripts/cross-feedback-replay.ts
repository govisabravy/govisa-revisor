/**
 * Pra cada marcação incorrect da Flavia, verifica se o finding equivalente
 * ainda existe no resultado do replay (mesmo review, mesmo rule_id, mesmo
 * subject_id). Mostra status: RESOLVIDO (sumiu) | TROCOU (rule_id mudou) |
 * REMANESCENTE (ainda dispara).
 *
 * Uso: npx tsx scripts/cross-feedback-replay.ts <feedback.json> <reviews-dir>
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { applyGovisaRules } from "../lib/reviewer/rules";

const fbPath = process.argv[2];
const reviewsDir = process.argv[3];
const fb = JSON.parse(readFileSync(fbPath, "utf8")) as Array<{
  id: number;
  review_id: string;
  rule_id: string;
  subject_id: string | null;
  error_type: string | null;
  note: string | null;
}>;

const cache = new Map<string, any[]>();
const reviewsAvailable = new Set(
  readdirSync(reviewsDir)
    .filter((f) => f.endsWith("_debug.json"))
    .map((f) => f.replace("_debug.json", ""))
);

function loadAfter(reviewId: string): any[] {
  if (cache.has(reviewId)) return cache.get(reviewId)!;
  const debug = JSON.parse(
    readFileSync(join(reviewsDir, `${reviewId}_debug.json`), "utf8")
  );
  const out = applyGovisaRules({
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
  cache.set(reviewId, out);
  return out;
}

const stats = { resolvido: 0, trocou: 0, remanescente: 0, n_a: 0 };
const remainingByRule = new Map<string, number>();

for (const m of fb) {
  if (!reviewsAvailable.has(m.review_id)) {
    stats.n_a++;
    continue;
  }
  const after = loadAfter(m.review_id);
  // Procura mesmo rule_id + subject_id
  const exact = after.find(
    (f) => f.rule_id === m.rule_id && (f.subject_id ?? null) === (m.subject_id ?? null)
  );
  if (exact) {
    stats.remanescente++;
    remainingByRule.set(m.rule_id, (remainingByRule.get(m.rule_id) ?? 0) + 1);
  } else {
    // Procura outro rule_id pro mesmo subject_id (mudança de label, ex: NEEDS_PROOF → PROOF_MISSING)
    const replaced = after.find(
      (f) => (f.subject_id ?? null) === (m.subject_id ?? null)
        && (f.rule_id?.startsWith(m.rule_id.split("_")[0])
            || f.rule_id?.includes("PHYSICAL_ADDR"))
    );
    if (replaced && m.rule_id.includes("PHYSICAL_ADDR")) {
      stats.trocou++;
    } else {
      stats.resolvido++;
    }
  }
}

console.log(`Total marcações: ${fb.length}`);
console.log(`  ✅ Resolvido (sumiu): ${stats.resolvido}`);
console.log(`  🔄 Trocou rule_id (PHYSICAL_ADDR): ${stats.trocou}`);
console.log(`  ❌ Remanescente: ${stats.remanescente}`);
console.log(`  ⚠ Review não disponível: ${stats.n_a}`);
console.log();
console.log("Remanescentes por regra:");
const sorted = [...remainingByRule.entries()].sort((a, b) => b[1] - a[1]);
for (const [r, c] of sorted) {
  console.log(`  ${c.toString().padStart(3)}  ${r}`);
}
