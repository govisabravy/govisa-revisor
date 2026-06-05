/**
 * Teste focado da correção de A-Number (Flavia 03/06).
 * Roda o pipeline 1x, salva report + debug COMPLETO (com extracted_forms pra
 * replay barato) e imprime: a_numbers_seen extraídos por form e os findings de
 * A-Number.
 *
 * Uso: source scripts/load-env.sh && npx tsx scripts/test-anumber.ts <pdf> [case_type]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { reviewProcess, type CaseType } from "../lib/reviewer";

async function main() {
  const [, , pdfPath, caseTypeRaw] = process.argv;
  if (!pdfPath) {
    console.error("Uso: tsx scripts/test-anumber.ts <pdf> [case_type]");
    process.exit(1);
  }
  const caseType: CaseType =
    caseTypeRaw === "vawa" ? "vawa" : caseTypeRaw === "u_visa" ? "u_visa" : "t_visa";

  const buffer = readFileSync(pdfPath);
  console.log(`[test] PDF: ${pdfPath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB) · ${caseType}`);
  const t0 = Date.now();
  const result = await reviewProcess({ buffer, caseType, mode: "draft" });
  console.log(`[test] concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const outDir = "/tmp/revisor-test";
  mkdirSync(outDir, { recursive: true });
  const base = basename(pdfPath, ".pdf").replace(/[^a-z0-9]/gi, "_");
  writeFileSync(`${outDir}/${base}.report.json`, JSON.stringify(result.report, null, 2));
  // debug COMPLETO (inclui extracted_forms — necessário pro replay-rules)
  writeFileSync(`${outDir}/${base}.debug.full.json`, JSON.stringify(result.debug, null, 2));
  console.log(`[test] salvo em ${outDir}/${base}.{report,debug.full}.json`);

  // ---- A-Numbers extraídos por form ----
  console.log("\n===== A-NUMBERS EXTRAÍDOS POR FORM =====");
  for (const f of (result.debug.extracted_forms ?? []) as any[]) {
    const person = f?.person ?? f?.family_member;
    if (!person) continue;
    const seen = Array.isArray(person.a_numbers_seen) ? person.a_numbers_seen : [];
    const seenStr = seen.length
      ? seen.map((s: any) => `${s.value}${s.page != null ? `@p${s.page}` : ""}`).join(", ")
      : "(vazio)";
    console.log(
      `  ${f.form ?? "?"} [subj ${(f as any)._subject_id ?? "?"}]: a_number=${person.a_number ?? "null"} | seen=[${seenStr}]`
    );
  }

  // ---- Findings de A-Number ----
  console.log("\n===== FINDINGS DE A-NUMBER =====");
  const anFindings = (result.report.findings ?? []).filter(
    (x: any) =>
      /a-?number/i.test(x.field ?? "") ||
      /ANUMBER/.test(x.rule_id ?? "") ||
      /a-?number/i.test(x.explanation ?? "")
  );
  if (anFindings.length === 0) {
    console.log("  ⚠️  NENHUM finding de A-Number encontrado!");
  } else {
    for (const x of anFindings as any[]) {
      console.log(`  [${x.severity}] ${x.rule_id} — ${x.field}`);
      console.log(`     found: ${x.found ?? ""}`);
      console.log(`     ${x.explanation}`);
    }
  }

  // ---- Novos checks (Requisição 05/06) ----
  console.log("\n===== BAR NUMBER EXTRAÍDO ===== (esperado 5794276)");
  for (const f of (result.debug.extracted_forms ?? []) as any[]) {
    if (f.form === "G-28" || f.form === "I-765") {
      console.log(`  ${f.form}: attorney_bar_number=${f.attorney_bar_number ?? "null"}`);
    }
  }
  console.log("\n===== FINDINGS NOVOS (bar/final/toc/address) =====");
  const newOnes = (result.report.findings ?? []).filter((x: any) =>
    /ATTORNEY_BAR|FINAL_ATTORNEY_SIG|TOC_SECTION|PHYSICAL_ADDR/.test(x.rule_id ?? "")
  );
  if (newOnes.length === 0) console.log("  (nenhum — esperado se o processo está completo/correto)");
  for (const x of newOnes as any[]) {
    console.log(`  [${x.severity}] ${x.rule_id} — ${x.field}`);
    if (x.found) console.log(`     found: ${x.found}`);
  }

  console.log("\n===== RESUMO =====");
  console.log(`Forms: ${result.report.forms_detected.join(", ")}`);
  console.log(`Subjects: ${(result.report.subjects ?? []).map((s: any) => `${s.role}:${s.display_name}`).join(" | ")}`);
  console.log(`Total findings: ${result.report.summary.total} (crít ${result.report.summary.critical}, alta ${result.report.summary.high})`);
  console.log(`Adversarial dropped: ${result.debug.adversarial_dropped} | weakened: ${result.debug.adversarial_weakened}`);
}

main().catch((e) => {
  console.error("ERRO:", e);
  process.exit(1);
});
