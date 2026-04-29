/**
 * Smoke test do revisor reformado — roda 1 PDF e cospe report estruturado.
 * Uso: source scripts/load-env.sh && npx tsx scripts/test-review.ts <pdf> <case_type> [mode]
 *   case_type: t_visa | u_visa | vawa
 *   mode: draft | final (default: draft)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { reviewProcess, type CaseType } from "../lib/reviewer";

async function main() {
  const [, , pdfPath, caseTypeRaw, modeRaw] = process.argv;
  if (!pdfPath || !caseTypeRaw) {
    console.error("Uso: tsx scripts/test-review.ts <pdf> <case_type> [mode]");
    process.exit(1);
  }
  const caseType: CaseType =
    caseTypeRaw === "vawa" ? "vawa" : caseTypeRaw === "u_visa" ? "u_visa" : "t_visa";
  const mode: "draft" | "final" = modeRaw === "final" ? "final" : "draft";

  console.log(`[test] PDF: ${pdfPath}`);
  console.log(`[test] caseType: ${caseType}, mode: ${mode}`);
  console.log(`[test] iniciando...`);
  const t0 = Date.now();

  const buffer = readFileSync(pdfPath);
  console.log(`[test] PDF carregado: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  const result = await reviewProcess({ buffer, caseType, mode });
  const elapsed = Date.now() - t0;

  const outDir = "/tmp/revisor-test";
  mkdirSync(outDir, { recursive: true });
  const baseName = basename(pdfPath, ".pdf").replace(/[^a-z0-9]/gi, "_");

  writeFileSync(
    `${outDir}/${baseName}.report.json`,
    JSON.stringify(result.report, null, 2)
  );
  writeFileSync(
    `${outDir}/${baseName}.debug.json`,
    JSON.stringify({ ...result.debug, extracted_forms: undefined, story_facts: undefined }, null, 2)
  );
  writeFileSync(
    `${outDir}/${baseName}.usage.json`,
    JSON.stringify(result.usage_events, null, 2)
  );

  // Resumo console
  console.log("\n========== RESULTADO ==========");
  console.log(`Cliente: ${result.report.client_name ?? "(não detectado)"}`);
  console.log(`Forms: ${result.report.forms_detected.join(", ")}`);
  console.log(`Subjects:`);
  for (const s of result.report.subjects ?? []) {
    console.log(`  - [${s.id}] ${s.role}: ${s.display_name} (DOB: ${s.date_of_birth ?? "?"})`);
  }
  console.log(`Total findings: ${result.report.summary.total}`);
  console.log(`  crítica: ${result.report.summary.critical}`);
  console.log(`  alta: ${result.report.summary.high}`);
  console.log(`  média: ${result.report.summary.medium}`);
  console.log(`  baixa: ${result.report.summary.low}`);
  console.log(`Findings por sujeito: ${JSON.stringify(result.report.summary.by_subject ?? {})}`);
  console.log(`Senior pass findings: ${result.debug.senior_findings_count}`);
  console.log(`Passport checks: ${result.debug.passport_checks.length}`);
  console.log(`Proof of address: ${result.debug.proof_of_address ? "DETECTADO" : "ausente"}`);
  console.log(`Elapsed: ${(elapsed / 1000).toFixed(1)}s`);

  console.log("\n========== FINDINGS ==========");
  const grouped: Record<string, typeof result.report.findings> = {};
  for (const f of result.report.findings) {
    const key = f.subject_id ?? "_global";
    (grouped[key] = grouped[key] ?? []).push(f);
  }
  for (const [sid, fs] of Object.entries(grouped)) {
    console.log(`\n--- ${sid} (${fs.length}) ---`);
    for (const f of fs) {
      const tag = f.rule_id ?? "(sem rule_id)";
      console.log(
        `  [${f.severity.padEnd(7)}] ${tag}  ${f.field}${f.form ? ` [${f.form}]` : ""}`
      );
      if (f.expected || f.found) {
        console.log(`     esperado: ${f.expected ?? "-"} | encontrado: ${f.found ?? "-"}`);
      }
      console.log(`     ${f.explanation.slice(0, 200)}`);
    }
  }

  console.log(`\n[test] Saída completa em ${outDir}/${baseName}.*`);
}

main().catch((err) => {
  console.error("[test] FAIL:", err);
  process.exit(1);
});
