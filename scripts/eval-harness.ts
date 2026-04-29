import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { reviewProcess, type CaseType } from "../lib/reviewer";
import type { Finding } from "../lib/schemas/forms";

interface CaseMeta {
  id: string;
  title: string;
  case_type: CaseType;
  mode: "draft" | "final";
  client_name_expected?: string;
  subjects_expected?: Array<{ id: string; display_name: string; role: string }>;
  notes?: string;
  drive_link?: string;
}

interface ExpectedFinding {
  rule_id: string;
  subject_id?: string | null;
  severity_min?: "baixa" | "media" | "alta" | "critica";
  field_contains?: string;
  notes?: string;
}

interface ExpectedJson {
  must_emit: ExpectedFinding[];
  must_not_emit: ExpectedFinding[];
}

const SEVERITY_RANK: Record<string, number> = {
  baixa: 0,
  media: 1,
  alta: 2,
  critica: 3
};

function severityMeets(actual: string, min: string): boolean {
  return (SEVERITY_RANK[actual] ?? -1) >= (SEVERITY_RANK[min] ?? 0);
}

function findingMatches(emitted: Finding, expected: ExpectedFinding): boolean {
  if (emitted.rule_id !== expected.rule_id) return false;
  if (
    expected.subject_id !== undefined &&
    expected.subject_id !== null &&
    emitted.subject_id !== expected.subject_id
  )
    return false;
  if (
    expected.subject_id === null &&
    emitted.subject_id !== null &&
    emitted.subject_id !== undefined
  )
    return false;
  if (
    expected.severity_min &&
    !severityMeets(emitted.severity, expected.severity_min)
  )
    return false;
  if (
    expected.field_contains &&
    !String(emitted.field ?? "").includes(expected.field_contains)
  )
    return false;
  return true;
}

interface CaseResult {
  case_id: string;
  emitted_count: number;
  must_emit_total: number;
  must_emit_hit: number;
  must_not_emit_total: number;
  must_not_emit_violated: number;
  precision: number;
  recall: number;
  f1: number;
  missing: ExpectedFinding[];
  violated: Array<{ expected: ExpectedFinding; emitted: Finding }>;
  elapsed_ms: number;
  error?: string;
}

async function evalCase(dir: string): Promise<CaseResult> {
  const meta: CaseMeta = JSON.parse(
    readFileSync(path.join(dir, "case.json"), "utf-8")
  );
  const expected: ExpectedJson = JSON.parse(
    readFileSync(path.join(dir, "expected.json"), "utf-8")
  );
  const pdf = readFileSync(path.join(dir, "case.pdf"));

  const t0 = Date.now();
  const result = await reviewProcess({
    buffer: pdf,
    caseType: meta.case_type,
    mode: meta.mode
  });
  const elapsed = Date.now() - t0;

  const emitted: Finding[] = result.report.findings ?? [];

  // must_emit: quantos esperados foram emitidos
  const missing: ExpectedFinding[] = [];
  let mustEmitHit = 0;
  for (const exp of expected.must_emit) {
    const found = emitted.some((f) => findingMatches(f, exp));
    if (found) mustEmitHit++;
    else missing.push(exp);
  }

  // must_not_emit: quantos NAO deviam ser emitidos mas foram
  const violated: Array<{ expected: ExpectedFinding; emitted: Finding }> = [];
  for (const exp of expected.must_not_emit) {
    for (const emit of emitted) {
      if (findingMatches(emit, exp)) {
        violated.push({ expected: exp, emitted: emit });
      }
    }
  }

  // Metricas:
  // - recall = must_emit_hit / must_emit_total
  // - precision aproximada = 1 - violated/total_emitted (proxy: gabarito nao e exaustivo)
  const recall =
    expected.must_emit.length > 0
      ? mustEmitHit / expected.must_emit.length
      : 1;
  const precisionProxy =
    emitted.length > 0 ? 1 - violated.length / emitted.length : 1;
  const f1 =
    recall + precisionProxy > 0
      ? (2 * recall * precisionProxy) / (recall + precisionProxy)
      : 0;

  return {
    case_id: meta.id,
    emitted_count: emitted.length,
    must_emit_total: expected.must_emit.length,
    must_emit_hit: mustEmitHit,
    must_not_emit_total: expected.must_not_emit.length,
    must_not_emit_violated: violated.length,
    precision: precisionProxy,
    recall,
    f1,
    missing,
    violated,
    elapsed_ms: elapsed
  };
}

async function main(): Promise<void> {
  const fixturesDir = path.join(process.cwd(), "fixtures");
  const cases = readdirSync(fixturesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d/.test(d.name))
    .map((d) => path.join(fixturesDir, d.name));

  if (cases.length === 0) {
    console.error(
      "Nenhum fixture encontrado em fixtures/. Crie pelo menos 1 caso."
    );
    process.exit(1);
  }

  console.log(`[eval] rodando ${cases.length} casos...`);
  const results: CaseResult[] = [];
  for (const dir of cases) {
    try {
      const r = await evalCase(dir);
      results.push(r);
      const status =
        r.recall >= 0.85 && r.must_not_emit_violated === 0 ? "OK" : "FAIL";
      console.log(
        `[${status}] ${r.case_id}: recall=${(r.recall * 100).toFixed(0)}% (${r.must_emit_hit}/${r.must_emit_total}) | violations=${r.must_not_emit_violated} | F1=${r.f1.toFixed(2)} | ${(r.elapsed_ms / 1000).toFixed(0)}s`
      );
      if (r.missing.length > 0) {
        console.log(
          `   missing: ${r.missing.map((m) => m.rule_id).join(", ")}`
        );
      }
      if (r.violated.length > 0) {
        for (const v of r.violated) {
          console.log(
            `   violated: ${v.emitted.rule_id} (${v.emitted.field}) - esperava-se NAO emitir`
          );
        }
      }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err).slice(0, 200);
      console.error(`[eval] FAIL ${dir}: ${msg}`);
      results.push({
        case_id: path.basename(dir),
        emitted_count: 0,
        must_emit_total: 0,
        must_emit_hit: 0,
        must_not_emit_total: 0,
        must_not_emit_violated: 0,
        precision: 0,
        recall: 0,
        f1: 0,
        missing: [],
        violated: [],
        elapsed_ms: 0,
        error: String(err)
      });
    }
  }

  // Sumario agregado
  const successful = results.filter((r) => !r.error);
  if (successful.length > 0) {
    const avgRecall =
      successful.reduce((s, r) => s + r.recall, 0) / successful.length;
    const avgPrecision =
      successful.reduce((s, r) => s + r.precision, 0) / successful.length;
    const avgF1 = successful.reduce((s, r) => s + r.f1, 0) / successful.length;
    const totalViolations = successful.reduce(
      (s, r) => s + r.must_not_emit_violated,
      0
    );
    console.log("\n=== SUMARIO ===");
    console.log(`Casos: ${successful.length}/${results.length}`);
    console.log(`Recall medio: ${(avgRecall * 100).toFixed(1)}%`);
    console.log(`Precision medio (proxy): ${(avgPrecision * 100).toFixed(1)}%`);
    console.log(`F1 medio: ${avgF1.toFixed(2)}`);
    console.log(`Violations totais: ${totalViolations}`);
  }

  // Salvar JSON detalhado
  const outDir = "/tmp/govisa-eval";
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `eval-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\nDetalhes em ${outFile}`);

  // Exit code: 1 se algum caso falhou criterio (recall < 85% OU violations > 0)
  const failed = successful.some(
    (r) => r.recall < 0.85 || r.must_not_emit_violated > 0
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("[eval] erro fatal:", err);
  process.exit(1);
});
