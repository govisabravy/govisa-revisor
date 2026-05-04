import { extractPdf } from "./extract";
import { onUsage, type UsageEvent } from "./claude";
import {
  splitPdfByRanges,
  splitPdfByRange,
  type SubDocument,
  type PageRange
} from "./splitter";
import {
  extractFormFromText,
  extractStoryFromText,
  checkPassportSignatureFromPdf,
  mapDocumentStructure,
  analyzeWitnessStatements,
  analyzeMedicalRecords,
  analyzeCountryConditions,
  analyzeI914BQualification,
  checkCertifiedTranslations,
  analyzeProofOfAddress,
  type PassportSignatureCheck,
  type StructureDocument
} from "./claude";
import { applyGovisaRules, summarize } from "./rules";
import { extractI360FromText, extractVawaStoryFromText, applyVawaRules } from "./vawa";
import {
  extractI918FromText,
  extractI918AFromText,
  extractI918BFromText,
  extractUVisaStoryFromText,
  applyUVisaRules
} from "./uvisa";
import {
  seniorCrossCheck,
  adversarialReview,
  applyAdversarialDecisions
} from "./senior";
import { validateClusters } from "./cluster-validator";
import { predictRFEs, type RFEPrediction } from "./rfe-prediction";
import type {
  CountryConditionsAnalysis,
  Finding,
  FormData,
  LeaQualification,
  MedicalAnalysis,
  ProofOfAddressAnalysis,
  ReviewReport,
  StoryFacts,
  Subject,
  TranslationsCheck,
  WitnessStatementsAnalysis
} from "../schemas/forms";
import type { I360Form, VawaStoryFacts } from "../schemas/vawa";
import type {
  I918AForm,
  I918BForm,
  I918Form,
  UVisaStoryFacts
} from "../schemas/uvisa";

export type CaseType = "t_visa" | "vawa" | "u_visa";

export interface ReviewInput {
  buffer: Buffer;
  mode?: "draft" | "final";
  caseType?: CaseType;
}

export interface PassportCheckEntry {
  subject_id: string | null;
  holder_name?: string | null;
  startPage: number;
  endPage: number;
  check: PassportSignatureCheck;
}

export interface ReviewDebug {
  case_type: CaseType;
  forms_detected: string[];
  story_detected: boolean;
  extracted_forms: any[];
  story_facts: any;
  subjects: Subject[];
  passport_checks: PassportCheckEntry[];
  /** @deprecated mantido para retro-compat — ver passport_checks */
  passport_check: PassportSignatureCheck | null;
  proof_of_address: ProofOfAddressAnalysis | null;
  witness_analysis: WitnessStatementsAnalysis | null;
  medical_analysis: MedicalAnalysis | null;
  country_analysis: CountryConditionsAnalysis | null;
  lea_qualification: LeaQualification | null;
  translations_check: TranslationsCheck | null;
  subdocs: Array<{
    kind: string;
    startPage: number;
    endPage: number;
    pageCount: number;
    subject_id?: string | null;
    holder_name?: string | null;
  }>;
  num_pages: number;
  elapsed_ms: number;
  senior_findings_count: number;
  cluster_corrections_applied: number;
  cluster_new_subjects_applied: number;
  adversarial_dropped: number;
  adversarial_weakened: number;
  findings_before_adversarial: number;
  rfe_predictions_count: number;
}

export interface ReviewOutput {
  report: ReviewReport;
  debug: ReviewDebug;
  usage_events: UsageEvent[];
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const n = Math.min(limit, items.length);
  for (let w = 0; w < n; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) return;
          results[i] = await fn(items[i], i);
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

const FORM_KINDS_BY_CASE: Record<CaseType, Set<string>> = {
  t_visa: new Set(["I-914", "I-914A", "I-914B", "I-192", "I-765", "G-28"]),
  vawa: new Set(["I-360", "I-485", "I-765", "G-28"]),
  u_visa: new Set(["I-918", "I-918A", "I-918B", "I-192", "I-765", "G-28"])
};

type Job =
  | { type: "form"; doc: SubDocument }
  | { type: "story"; doc: SubDocument }
  | {
      type: "passport";
      pdfBase64: string;
      subject_id: string | null;
      holder_name: string | null;
      startPage: number;
      endPage: number;
    }
  | { type: "witnesses"; pdfBase64: string }
  | { type: "medical"; pdfBase64: string }
  | { type: "country"; pdfBase64: string }
  | { type: "lea"; pdfBase64: string }
  | { type: "translations"; pdfBase64: string }
  | {
      type: "proof_of_address";
      pdfBase64: string;
      expectedHolderNames: Array<{ subject_id: string; display_name: string }>;
    };

// ---------------------------------------------------------------------------
// Construção de Subjects a partir dos forms extraídos
// ---------------------------------------------------------------------------

function personFullName(p?: {
  given_name?: string | null;
  family_name?: string | null;
}): string {
  return `${p?.given_name ?? ""} ${p?.family_name ?? ""}`.trim();
}

function buildTSubjects(formsT: FormData[]): Subject[] {
  const subjects: Subject[] = [];
  const i914 = formsT.find((f) => f.form === "I-914") as any;
  const i914as = formsT.filter((f): f is Extract<FormData, { form: "I-914A" }> => f.form === "I-914A");

  if (i914?.person) {
    subjects.push({
      id: "principal",
      role: "principal",
      display_name: personFullName(i914.person) || "Principal",
      family_name: i914.person.family_name ?? null,
      given_name: i914.person.given_name ?? null,
      date_of_birth: i914.person.date_of_birth ?? null,
      country_of_citizenship: i914.person.country_of_citizenship ?? null,
      relationship_to_principal: null
    });
  }

  i914as.forEach((a, idx) => {
    const fm = a.family_member;
    const id = (a as any)._subject_id ?? `dep_${idx + 1}`;
    subjects.push({
      id,
      role: "dependent",
      display_name: personFullName(fm) || `Dependente ${idx + 1}`,
      family_name: fm?.family_name ?? null,
      given_name: fm?.given_name ?? null,
      date_of_birth: fm?.date_of_birth ?? null,
      country_of_citizenship: fm?.country_of_citizenship ?? null,
      relationship_to_principal: a.relationship_to_principal ?? null
    });
  });

  return subjects;
}

function buildUSubjects(i918: I918Form | null, i918as: I918AForm[]): Subject[] {
  const subjects: Subject[] = [];
  if (i918?.person) {
    subjects.push({
      id: "principal",
      role: "principal",
      display_name: personFullName(i918.person) || "Principal",
      family_name: i918.person.family_name ?? null,
      given_name: i918.person.given_name ?? null,
      date_of_birth: i918.person.date_of_birth ?? null,
      country_of_citizenship: i918.person.country_of_citizenship ?? null,
      relationship_to_principal: null
    });
  }
  i918as.forEach((a, idx) => {
    const fm = a.family_member;
    const id = (a as any)._subject_id ?? `dep_${idx + 1}`;
    subjects.push({
      id,
      role: "dependent",
      display_name: personFullName(fm) || `Dependente ${idx + 1}`,
      family_name: fm?.family_name ?? null,
      given_name: fm?.given_name ?? null,
      date_of_birth: fm?.date_of_birth ?? null,
      country_of_citizenship: fm?.country_of_citizenship ?? null,
      relationship_to_principal: a.relationship_to_principal ?? null
    });
  });
  return subjects;
}

function buildVawaSubjects(i360: I360Form | null): Subject[] {
  const subjects: Subject[] = [];
  if (i360?.person) {
    subjects.push({
      id: "principal",
      role: "principal",
      display_name: personFullName(i360.person) || "Principal",
      family_name: i360.person.family_name ?? null,
      given_name: i360.person.given_name ?? null,
      date_of_birth: i360.person.date_of_birth ?? null,
      country_of_citizenship: i360.person.country_of_citizenship ?? null,
      relationship_to_principal: null
    });
  }
  return subjects;
}

function groupFormsBySubject(forms: FormData[]): Record<string, FormData[]> {
  const out: Record<string, FormData[]> = {};
  for (const f of forms) {
    const sid = (f as any)._subject_id ?? "principal";
    if (!out[sid]) out[sid] = [];
    out[sid].push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// reviewProcess
// ---------------------------------------------------------------------------

export async function reviewProcess(input: ReviewInput): Promise<ReviewOutput> {
  const started = Date.now();
  const caseType: CaseType = input.caseType ?? "t_visa";

  const usageEvents: UsageEvent[] = [];
  const unregister = onUsage((e) => {
    usageEvents.push(e);
  });

  const pdf = await extractPdf(input.buffer);

  const structure = await mapDocumentStructure(pdf.pages);
  const docs: StructureDocument[] = structure?.documents ?? [];

  // Ranges agora carregam subject_id/holder_name (vindos do mapper).
  const ranges: PageRange[] = docs
    .filter((d) => d.startPage >= 1 && d.endPage >= d.startPage && d.endPage <= pdf.numPages)
    .map((d) => ({
      kind: d.kind,
      title: d.label || d.kind,
      startPage: d.startPage,
      endPage: d.endPage,
      subject_id: d.subject_id ?? null,
      holder_name: d.holder_name ?? null
    }));

  const subdocs = await splitPdfByRanges(input.buffer, ranges, pdf.pages);

  const FORM_KINDS = FORM_KINDS_BY_CASE[caseType];
  const formSubdocs = subdocs.filter((s) => FORM_KINDS.has(s.kind));
  let storySubdocs = subdocs.filter((s) => s.kind === "story");
  // identification PODE aparecer múltiplas vezes (1 por sujeito) graças ao mapper novo
  const idSubdocs = subdocs.filter((s) => s.kind === "identification");
  const proofSubdocs = subdocs.filter((s) => s.kind === "proof_of_address");
  const witnessSubdoc = subdocs.find((s) => s.kind === "witness_statements");
  const coverSubdoc = subdocs.find((s) => s.kind === "cover_letter");

  if (storySubdocs.length === 0 && witnessSubdoc) {
    const fallbackPages = Math.min(10, witnessSubdoc.pageCount);
    const base64 = await splitPdfByRange(
      input.buffer,
      witnessSubdoc.startPage,
      witnessSubdoc.startPage + fallbackPages - 1
    );
    const text = pdf.pages
      .slice(witnessSubdoc.startPage - 1, witnessSubdoc.startPage - 1 + fallbackPages)
      .join("\n\n");
    storySubdocs = [
      {
        kind: "story",
        title: "Story (fallback from witness_statements)",
        startPage: witnessSubdoc.startPage,
        endPage: witnessSubdoc.startPage + fallbackPages - 1,
        base64,
        text,
        pageCount: fallbackPages,
        subject_id: "principal",
        holder_name: null
      }
    ];
  }
  if (storySubdocs.length === 0 && coverSubdoc) {
    storySubdocs = [{ ...coverSubdoc, kind: "story" }];
  }

  const medicalSubdoc = subdocs.find((s) => s.kind === "medical_records");
  const countrySubdoc = subdocs.find((s) => s.kind === "country_conditions");
  const i914bSubdoc = formSubdocs.find((s) => s.kind === "I-914B");
  const i918bSubdoc = formSubdocs.find((s) => s.kind === "I-918B");

  async function capped(buf: Buffer, startPage: number, endPage: number, maxPages: number) {
    const lastPage = Math.min(endPage, startPage + maxPages - 1);
    return splitPdfByRange(buf, startPage, lastPage);
  }

  // Cap de sujeitos pra controlar custo/latência (CTO concern do plano)
  const MAX_SUBJECTS_FOR_PASSPORT = 5;
  const passportIdSubdocs = idSubdocs.slice(0, MAX_SUBJECTS_FOR_PASSPORT);

  const jobs: Job[] = [];
  for (const doc of formSubdocs) jobs.push({ type: "form", doc });
  if (storySubdocs.length > 0) jobs.push({ type: "story", doc: storySubdocs[0] });

  // 1 passport check por sujeito identificado pelo mapper
  for (const idDoc of passportIdSubdocs) {
    const pdfB64 = await capped(input.buffer, idDoc.startPage, idDoc.endPage, 8);
    jobs.push({
      type: "passport",
      pdfBase64: pdfB64,
      subject_id: idDoc.subject_id ?? null,
      holder_name: idDoc.holder_name ?? null,
      startPage: idDoc.startPage,
      endPage: idDoc.endPage
    });
  }

  // Fallback: se mapper não identificou nenhum identification subdoc
  // mas existem páginas suficientes pra ter passaporte, mantém comportamento antigo
  // (1 chamada genérica) usando o primeiro subdoc de qualquer "identification" se houver.
  if (passportIdSubdocs.length === 0 && idSubdocs.length === 0) {
    // sem identification — sem passport check (esperado em alguns casos)
  }

  // Translations roda no primeiro idSubdoc se houver (cap 15 páginas)
  const firstId = idSubdocs[0];
  if (firstId) {
    jobs.push({
      type: "translations",
      pdfBase64: await capped(input.buffer, firstId.startPage, firstId.endPage, 15)
    });
  }

  // Proof of address: 1 por subdoc detectado
  // Os expectedHolderNames serão preenchidos APÓS extração dos forms (pra ter os subjects).
  // Por enquanto, agendamos os jobs com lista vazia — vamos rodar o analyze depois das extrações.
  // Decisão: separar em 2 fases pra ter expected_holder_names contextualizados. Implementado abaixo.

  if (witnessSubdoc) {
    const pdfB64 = await capped(input.buffer, witnessSubdoc.startPage, witnessSubdoc.endPage, 25);
    jobs.push({ type: "witnesses", pdfBase64: pdfB64 });
  }
  if (medicalSubdoc) {
    const pdfB64 = await capped(input.buffer, medicalSubdoc.startPage, medicalSubdoc.endPage, 15);
    jobs.push({ type: "medical", pdfBase64: pdfB64 });
  }
  if (countrySubdoc) {
    const pdfB64 = await capped(input.buffer, countrySubdoc.startPage, countrySubdoc.endPage, 12);
    jobs.push({ type: "country", pdfBase64: pdfB64 });
  }
  if (caseType === "t_visa" && i914bSubdoc) {
    jobs.push({ type: "lea", pdfBase64: i914bSubdoc.base64 });
  }
  if (caseType === "u_visa" && i918bSubdoc) {
    jobs.push({ type: "lea", pdfBase64: i918bSubdoc.base64 });
  }

  const concurrency = Number(process.env.REVIEWER_CONCURRENCY ?? "4");
  const results = await runWithConcurrency(jobs, concurrency, async (job) => {
    if (job.type === "form") {
      const k = job.doc.kind;
      const sid = job.doc.subject_id ?? null;
      if (caseType === "vawa" && k === "I-360") {
        const data = await extractI360FromText({
          text: job.doc.text,
          pdfBase64: job.doc.base64
        });
        if (data) (data as any)._subject_id = sid ?? "principal";
        return { type: "form_vawa_i360", data } as const;
      }
      if (caseType === "u_visa") {
        if (k === "I-918") {
          const data = await extractI918FromText({
            text: job.doc.text,
            pdfBase64: job.doc.base64
          });
          if (data) (data as any)._subject_id = sid ?? "principal";
          return { type: "form_u_i918", data } as const;
        }
        if (k === "I-918A") {
          const data = await extractI918AFromText({
            text: job.doc.text,
            pdfBase64: job.doc.base64
          });
          if (data) (data as any)._subject_id = sid;
          return { type: "form_u_i918a", data } as const;
        }
        if (k === "I-918B") {
          const data = await extractI918BFromText({
            text: job.doc.text,
            pdfBase64: job.doc.base64
          });
          if (data) (data as any)._subject_id = sid ?? "principal";
          return { type: "form_u_i918b", data } as const;
        }
      }
      const usesVision = job.doc.kind === "I-914B";
      const data = await extractFormFromText({
        formKind: job.doc.kind,
        text: job.doc.text,
        pdfBase64: usesVision ? job.doc.base64 : undefined,
        subject_id: sid
      });
      return { type: "form_generic", data } as const;
    }
    if (job.type === "story") {
      if (caseType === "vawa") {
        const data = await extractVawaStoryFromText({
          text: job.doc.text,
          pdfBase64: job.doc.base64
        });
        return { type: "story_vawa", data } as const;
      }
      if (caseType === "u_visa") {
        const data = await extractUVisaStoryFromText({
          text: job.doc.text,
          pdfBase64: job.doc.base64
        });
        return { type: "story_u", data } as const;
      }
      const data = await extractStoryFromText({
        text: job.doc.text,
        pdfBase64: job.doc.base64,
        subject_id: "principal"
      });
      return { type: "story_t", data } as const;
    }
    if (job.type === "passport") {
      const data = await checkPassportSignatureFromPdf(job.pdfBase64, {
        expectedHolderName: job.holder_name ?? undefined
      });
      return {
        type: "passport",
        data,
        subject_id: job.subject_id,
        holder_name: job.holder_name,
        startPage: job.startPage,
        endPage: job.endPage
      } as const;
    }
    if (job.type === "witnesses") {
      const data = await analyzeWitnessStatements(job.pdfBase64);
      return { type: "witnesses", data } as const;
    }
    if (job.type === "medical") {
      const data = await analyzeMedicalRecords(job.pdfBase64);
      return { type: "medical", data } as const;
    }
    if (job.type === "country") {
      const data = await analyzeCountryConditions(job.pdfBase64);
      return { type: "country", data } as const;
    }
    if (job.type === "translations") {
      const data = await checkCertifiedTranslations(job.pdfBase64);
      return { type: "translations", data } as const;
    }
    if (job.type === "lea") {
      const data = await analyzeI914BQualification(job.pdfBase64);
      return { type: "lea", data } as const;
    }
    if (job.type === "proof_of_address") {
      const data = await analyzeProofOfAddress({
        pdfBase64: job.pdfBase64,
        expectedHolderNames: job.expectedHolderNames
      });
      return { type: "proof_of_address", data } as const;
    }
    return { type: "noop" } as const;
  });

  const formsT: FormData[] = [];
  let storyT: StoryFacts | null = null;
  let i360: I360Form | null = null;
  let storyVawa: VawaStoryFacts | null = null;
  let i918: I918Form | null = null;
  const i918as: I918AForm[] = [];
  let i918b: I918BForm | null = null;
  let storyU: UVisaStoryFacts | null = null;
  const passportChecks: PassportCheckEntry[] = [];
  let witnessAnalysis: WitnessStatementsAnalysis | null = null;
  let medicalAnalysis: MedicalAnalysis | null = null;
  let countryAnalysis: CountryConditionsAnalysis | null = null;
  let leaQualification: LeaQualification | null = null;
  let translations: TranslationsCheck | null = null;

  for (const r of results as any[]) {
    if (r.type === "form_generic" && r.data) formsT.push(r.data);
    if (r.type === "form_vawa_i360" && r.data) i360 = r.data;
    if (r.type === "form_u_i918" && r.data) i918 = r.data;
    if (r.type === "form_u_i918a" && r.data) i918as.push(r.data);
    if (r.type === "form_u_i918b" && r.data) i918b = r.data;
    if (r.type === "story_t" && r.data) storyT = r.data;
    if (r.type === "story_vawa" && r.data) storyVawa = r.data;
    if (r.type === "story_u" && r.data) storyU = r.data;
    if (r.type === "passport" && r.data) {
      passportChecks.push({
        subject_id: r.subject_id ?? null,
        holder_name: r.holder_name ?? null,
        startPage: r.startPage,
        endPage: r.endPage,
        check: r.data
      });
    }
    if (r.type === "witnesses" && r.data) witnessAnalysis = r.data;
    if (r.type === "medical" && r.data) medicalAnalysis = r.data;
    if (r.type === "country" && r.data) countryAnalysis = r.data;
    if (r.type === "lea" && r.data) leaQualification = r.data;
    if (r.type === "translations" && r.data) translations = r.data;
  }

  // ---------------------------------------------------------------------------
  // Construir Subjects consolidados (a partir das extrações)
  // ---------------------------------------------------------------------------
  let subjects: Subject[] = [];
  if (caseType === "t_visa") subjects = buildTSubjects(formsT);
  else if (caseType === "u_visa") subjects = buildUSubjects(i918, i918as);
  else subjects = buildVawaSubjects(i360);

  // ---------------------------------------------------------------------------
  // Proof of address (rodada APÓS extrações pra ter expected_holder_names)
  // ---------------------------------------------------------------------------
  let proofOfAddress: ProofOfAddressAnalysis | null = null;
  if (proofSubdocs.length > 0) {
    const expectedHolders = subjects.map((s) => ({
      subject_id: s.id,
      display_name: s.display_name
    }));
    const proofDoc = proofSubdocs[0];
    const proofB64 = await capped(input.buffer, proofDoc.startPage, proofDoc.endPage, 6);
    proofOfAddress = await analyzeProofOfAddress({
      pdfBase64: proofB64,
      expectedHolderNames: expectedHolders
    });
  }

  // ---------------------------------------------------------------------------
  // FASE 3.5 — Cluster Validator (corrige subject_id antes das regras)
  // ---------------------------------------------------------------------------
  let clusterCorrectionsApplied = 0;
  let clusterNewSubjectsApplied = 0;
  try {
    const allFormsForCluster: FormData[] =
      caseType === "t_visa"
        ? formsT
        : caseType === "u_visa"
        ? ([i918, ...i918as, i918b, ...formsT].filter(Boolean) as FormData[])
        : ([i360, ...formsT].filter(Boolean) as FormData[]);

    const clusterValidation = await validateClusters({
      caseType,
      subjects,
      forms: allFormsForCluster,
      passportChecks: passportChecks.map((p) => ({
        subject_id: p.subject_id,
        holder_name: p.holder_name ?? null,
        check: p.check
      })),
      proofOfAddress,
      i918as: caseType === "u_visa" ? i918as : undefined
    });

    // Aplicar correções de subject_id
    for (const corr of clusterValidation.corrections) {
      const target = allFormsForCluster[corr.form_index];
      if (target) {
        (target as any)._subject_id = corr.new_subject_id;
        clusterCorrectionsApplied++;
      }
    }

    // Adicionar sujeitos novos detectados
    for (const ns of clusterValidation.new_subjects) {
      const newId = `dep_${subjects.length + 1}`;
      // Evita duplicar se já existe alguém com mesmo display_name
      if (
        subjects.some(
          (s) =>
            s.display_name.trim().toLowerCase() ===
            ns.display_name.trim().toLowerCase()
        )
      ) {
        continue;
      }
      subjects.push({
        id: newId,
        role: "dependent",
        display_name: ns.display_name,
        family_name: ns.family_name,
        given_name: ns.given_name,
        date_of_birth: ns.date_of_birth,
        country_of_citizenship: ns.country_of_citizenship,
        relationship_to_principal: ns.relationship_to_principal
      });
      clusterNewSubjectsApplied++;
    }
  } catch (err) {
    console.error(
      "Cluster Validator falhou (degradando):",
      String((err as any)?.message ?? err).slice(0, 200)
    );
  }

  // ---------------------------------------------------------------------------
  // Regras determinísticas (4 níveis)
  // ---------------------------------------------------------------------------
  let findings: Finding[] = [];
  let extractedForms: any[] = [];
  let storyFacts: any = null;
  let clientName: string | null = null;

  if (caseType === "t_visa") {
    findings = applyGovisaRules({
      forms: formsT,
      story: storyT,
      passportChecks: passportChecks.map((p) => ({
        subject_id: p.subject_id,
        check: p.check
      })),
      witnessAnalysis,
      medicalAnalysis,
      countryAnalysis,
      leaQualification,
      translations,
      proofOfAddress,
      subjects,
      mode: input.mode ?? "draft"
    });
    extractedForms = formsT;
    storyFacts = storyT;
    const i914 = formsT.find((f) => f.form === "I-914") as any;
    const g = i914?.person?.given_name ?? storyT?.full_name ?? null;
    clientName = g ? `${g} ${i914?.person?.family_name ?? ""}`.trim() : null;
  } else if (caseType === "vawa") {
    // Parte 6 (Flavia): texto agregado para deteccao heuristica de cartas de imigracao.
    const fullText = pdf.pages.join("\n\n");
    findings = applyVawaRules({ i360, story: storyVawa, fullText });
    extractedForms = [i360, ...formsT].filter(Boolean);
    storyFacts = storyVawa;
    const g = i360?.person?.given_name ?? storyVawa?.full_name ?? null;
    clientName = g ? `${g} ${i360?.person?.family_name ?? ""}`.trim() : null;
  } else {
    // U-visa: passar i192 pra regra de waiver de não-cooperação (obs 4 da Flavia)
    const i192 = (formsT.find((f) => f.form === "I-192") as any) ?? null;
    // Parte 6 (Flavia): texto agregado para deteccao heuristica de waiver
    // petition (I-918B) e cartas de imigracao (NTA, I-220A, EOIR, ICE).
    const fullText = pdf.pages.join("\n\n");
    findings = applyUVisaRules({ i918, i918as, i918b, story: storyU, i192, fullText });
    extractedForms = [i918, ...i918as, i918b, ...formsT].filter(Boolean);
    storyFacts = storyU;
    const g = i918?.person?.given_name ?? storyU?.full_name ?? null;
    clientName = g ? `${g} ${i918?.person?.family_name ?? ""}`.trim() : null;
  }

  // Common findings (passaporte, traduções, witnesses, medical, country, proof,
  // E TAMBÉM regras genéricas de Physical Address / Mailing / In Care Of / SSN /
  // campos vazios / assinaturas) pra VAWA e U-visa.
  // Bug detectado em produção (Jacy/VAWA): suite errada nos forms não era pega
  // porque commonFindings rodava com forms=[]. Agora passamos os forms próprios
  // de cada caseType pra aplicar regras genéricas de endereço/Go Visa.
  if (caseType !== "t_visa") {
    const formsForCommon: FormData[] =
      caseType === "vawa"
        ? ([i360, ...formsT].filter(Boolean) as FormData[])
        : ([i918, ...i918as, i918b, ...formsT].filter(Boolean) as FormData[]);

    const commonFindings = applyGovisaRules({
      forms: formsForCommon,
      story: null,
      passportChecks: passportChecks.map((p) => ({
        subject_id: p.subject_id,
        check: p.check
      })),
      witnessAnalysis,
      medicalAnalysis,
      countryAnalysis,
      leaQualification: null,
      translations,
      proofOfAddress,
      subjects,
      mode: input.mode ?? "draft"
    });
    // Filtra regras puramente T-specific que disparam falso positivo em VAWA/U
    const nonTSpecific = commonFindings.filter((f) => {
      const rid = f.rule_id ?? "";
      // Regras T-only que não devem rodar em VAWA/U-visa
      if (rid === "T_FILING_I765_CATEGORY_INVALID_FOR_T1") return false;
      if (rid === "T_FILING_I914B_PART2_PREFILLED") return false;
      if (rid === "T_FILING_I914B_OFFICER_SIG_MISSING") return false;
      if (rid.startsWith("T_SUBST_I914B_")) return false;
      if (rid.startsWith("T_SUBST_I192_")) return false;
      if (rid.startsWith("T_SUBST_COOPERATION_")) return false;
      if (rid.startsWith("T_DEP_")) return false;
      if (rid.startsWith("T_CONS_")) return false;
      return true;
    });
    findings = findings.concat(nonTSpecific);
  }

  // ---------------------------------------------------------------------------
  // Senior Cross-Check (Claude pass narrativo)
  // ---------------------------------------------------------------------------
  let seniorFindings: Finding[] = [];
  try {
    const formsBySubject = groupFormsBySubject(formsT);
    seniorFindings = await seniorCrossCheck({
      caseType,
      subjects,
      formsBySubject,
      i360,
      vawaStory: storyVawa,
      i918,
      i918as,
      i918b,
      uvisaStory: storyU,
      tStory: storyT,
      passportChecks: passportChecks.map((p) => ({
        subject_id: p.subject_id,
        check: p.check
      })),
      witnessAnalysis,
      medicalAnalysis,
      countryAnalysis,
      leaQualification,
      translations,
      proofOfAddress,
      mode: input.mode ?? "draft"
    });
  } catch (err) {
    const errMsg = String((err as any)?.message ?? err).slice(0, 200);
    console.error("Senior cross-check falhou (degradando):", errMsg);
    // Garante que a falha externa fique gravada em usage_events para alerta.
    usageEvents.push({
      operation: "seniorCrossCheck",
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      duration_ms: 0,
      attempts: 0,
      had_pdf: false,
      ok: false,
      error: `outer catch: ${errMsg}`
    });
    seniorFindings = [];
  }

  // Calibração rodada 4 (Flavia 04/05): o LLM senior tem usado SENIOR_COVER_LETTER_OUTDATED
  // pra findings que nada têm a ver com cover letter (inversão A-Number/SSN, family_name
  // incompleto, edition_date G-28, fragmentação de address etc). Reclassificar pós-LLM
  // pra rule_ids mais coerentes com o conteúdo do field/explanation, evitando que a
  // Flavia veja o rótulo "COVER_LETTER_OUTDATED" em achados sobre passaporte.
  for (const f of seniorFindings) {
    if (f.rule_id !== "SENIOR_COVER_LETTER_OUTDATED") continue;
    const haystack = `${f.field ?? ""} ${f.explanation ?? ""}`.toLowerCase();
    const looksLikeCover = /cover[\s_-]?letter|carta\s+do\s+advogado|opening\s+letter/.test(haystack);
    if (looksLikeCover) continue;
    if (/a-?number|a_number|anumber|ssn/.test(haystack)) {
      f.rule_id = "SENIOR_ANUMBER_SSN_INCONSISTENCY";
    } else if (/passport/.test(haystack)) {
      f.rule_id = "SENIOR_PASSPORT_INCONSISTENCY";
    } else if (/(family|given|middle)\s*name|sobrenome|nome\s+(de|do)\s+(família|familia)/.test(haystack)) {
      f.rule_id = "SENIOR_NAME_INCONSISTENCY";
    } else if (/edition|edição|edicao|version/.test(haystack)) {
      f.rule_id = "SENIOR_FORM_EDITION_QUESTION";
    } else if (/address|endereço|endereco|mailing/.test(haystack)) {
      f.rule_id = "SENIOR_ADDRESS_INCONSISTENCY";
    } else {
      f.rule_id = "SENIOR_DATA_INCONSISTENCY";
    }
  }

  findings = findings.concat(seniorFindings);
  const findingsBeforeAdversarial = findings.length;

  // ---------------------------------------------------------------------------
  // FASE 5.5 — Adversarial Pass (contesta cada finding, filtra alucinações)
  // ---------------------------------------------------------------------------
  let adversarialDropped = 0;
  let adversarialWeakened = 0;
  try {
    // Reaproveita o mesmo case summary que o senior pass usa internamente.
    // Como buildCaseSummary é privado em senior.ts, replicamos um summary mínimo.
    const minimalSummary = JSON.stringify({
      caseType,
      mode: input.mode ?? "draft",
      subjects: subjects.map((s) => ({
        id: s.id,
        role: s.role,
        display_name: s.display_name,
        dob: s.date_of_birth
      })),
      forms_detected: extractedForms.map((f: any) => f.form ?? "?"),
      story: storyFacts,
      passport_checks: passportChecks.map((p) => ({
        subject_id: p.subject_id,
        holder: p.holder_name,
        signed: p.check?.signed,
        number: p.check?.passport_number_seen
      })),
      witness_analysis: witnessAnalysis,
      medical_analysis: medicalAnalysis,
      country_analysis: countryAnalysis,
      proof_of_address: proofOfAddress
    }).slice(0, 30000);

    const adversarial = await adversarialReview({
      caseType,
      findings,
      caseSummary: minimalSummary,
      mode: input.mode ?? "draft"
    });

    if (adversarial.decisions.length > 0) {
      adversarialDropped = adversarial.decisions.filter(
        (d) => d.verdict === "drop"
      ).length;
      adversarialWeakened = adversarial.decisions.filter(
        (d) => d.verdict === "weaken"
      ).length;
      findings = applyAdversarialDecisions(findings, adversarial.decisions);
    }
  } catch (err) {
    const errMsg = String((err as any)?.message ?? err).slice(0, 200);
    console.error("Adversarial Pass falhou (degradando):", errMsg);
    usageEvents.push({
      operation: "adversarialReview",
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      duration_ms: 0,
      attempts: 0,
      had_pdf: false,
      ok: false,
      error: `outer catch: ${errMsg}`
    });
  }

  // ---------------------------------------------------------------------------
  // FASE 6 — RFE Prediction (camada determinística + refine LLM opcional)
  // ---------------------------------------------------------------------------
  let rfePredictions: RFEPrediction[] = [];
  try {
    const i914Form = formsT.find((f) => f.form === "I-914") as any;
    rfePredictions = await predictRFEs({
      caseType,
      findings,
      story: storyT,
      vawaStory: storyVawa,
      uvisaStory: storyU,
      i914: i914Form,
      i360,
      i918,
      i918b,
      forms: formsT,
      passportChecks: passportChecks.map((p) => ({
        subject_id: p.subject_id,
        check: p.check
      })),
      witnessAnalysis,
      medicalAnalysis,
      countryAnalysis,
      translations,
      subjects,
      mode: input.mode ?? "draft"
    });
  } catch (err) {
    console.error(
      "RFE Prediction falhou (degradando):",
      String((err as any)?.message ?? err).slice(0, 200)
    );
    rfePredictions = [];
  }

  // ---------------------------------------------------------------------------
  // Relatório final
  // ---------------------------------------------------------------------------
  const baseSummary = summarize(findings);
  const bySubject: Record<string, number> = {};
  for (const f of findings) {
    const key = f.subject_id ?? "_global";
    bySubject[key] = (bySubject[key] ?? 0) + 1;
  }

  const report: ReviewReport = {
    client_name: clientName,
    forms_detected: extractedForms.map((f: any) => f.form ?? "?"),
    subjects,
    findings,
    summary: { ...baseSummary, by_subject: bySubject },
    proof_of_address: proofOfAddress
  };
  // RFE predictions vão como campo passthrough no objeto (não está no schema oficial
  // ainda, mas a UI/admin podem ler via debug ou expandir o schema depois).
  (report as any).rfe_predictions = rfePredictions;

  unregister();

  return {
    report,
    debug: {
      case_type: caseType,
      forms_detected: extractedForms.map((f: any) => f.form ?? "?"),
      story_detected: !!storyFacts,
      extracted_forms: extractedForms,
      story_facts: storyFacts,
      subjects,
      passport_checks: passportChecks,
      passport_check: passportChecks[0]?.check ?? null,
      proof_of_address: proofOfAddress,
      witness_analysis: witnessAnalysis,
      medical_analysis: medicalAnalysis,
      country_analysis: countryAnalysis,
      lea_qualification: leaQualification,
      translations_check: translations,
      subdocs: subdocs.map(({ base64, ...rest }) => rest),
      num_pages: pdf.numPages,
      elapsed_ms: Date.now() - started,
      senior_findings_count: seniorFindings.length,
      cluster_corrections_applied: clusterCorrectionsApplied,
      cluster_new_subjects_applied: clusterNewSubjectsApplied,
      adversarial_dropped: adversarialDropped,
      adversarial_weakened: adversarialWeakened,
      findings_before_adversarial: findingsBeforeAdversarial,
      rfe_predictions_count: rfePredictions.length
    },
    usage_events: usageEvents
  };
}
