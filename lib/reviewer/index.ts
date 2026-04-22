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
import type {
  CountryConditionsAnalysis,
  Finding,
  FormData,
  LeaQualification,
  MedicalAnalysis,
  ReviewReport,
  StoryFacts,
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

export interface ReviewDebug {
  case_type: CaseType;
  forms_detected: string[];
  story_detected: boolean;
  extracted_forms: any[];
  story_facts: any;
  passport_check: PassportSignatureCheck | null;
  witness_analysis: WitnessStatementsAnalysis | null;
  medical_analysis: MedicalAnalysis | null;
  country_analysis: CountryConditionsAnalysis | null;
  lea_qualification: LeaQualification | null;
  translations_check: TranslationsCheck | null;
  subdocs: Array<{ kind: string; startPage: number; endPage: number; pageCount: number }>;
  num_pages: number;
  elapsed_ms: number;
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
  | { type: "passport"; pdfBase64: string }
  | { type: "witnesses"; pdfBase64: string }
  | { type: "medical"; pdfBase64: string }
  | { type: "country"; pdfBase64: string }
  | { type: "lea"; pdfBase64: string }
  | { type: "translations"; pdfBase64: string };

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

  const ranges: PageRange[] = docs
    .filter((d) => d.startPage >= 1 && d.endPage >= d.startPage && d.endPage <= pdf.numPages)
    .map((d) => ({
      kind: d.kind,
      title: d.label || d.kind,
      startPage: d.startPage,
      endPage: d.endPage
    }));

  const subdocs = await splitPdfByRanges(input.buffer, ranges, pdf.pages);

  const FORM_KINDS = FORM_KINDS_BY_CASE[caseType];
  const formSubdocs = subdocs.filter((s) => FORM_KINDS.has(s.kind));
  let storySubdocs = subdocs.filter((s) => s.kind === "story");
  const idSubdoc = subdocs.find((s) => s.kind === "identification");
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
        pageCount: fallbackPages
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

  const jobs: Job[] = [];
  for (const doc of formSubdocs) jobs.push({ type: "form", doc });
  if (storySubdocs.length > 0) jobs.push({ type: "story", doc: storySubdocs[0] });

  if (idSubdoc) {
    const pdfB64 = await capped(input.buffer, idSubdoc.startPage, idSubdoc.endPage, 8);
    jobs.push({ type: "passport", pdfBase64: pdfB64 });
    jobs.push({
      type: "translations",
      pdfBase64: await capped(input.buffer, idSubdoc.startPage, idSubdoc.endPage, 15)
    });
  }
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
      if (caseType === "vawa" && k === "I-360") {
        const data = await extractI360FromText({ text: job.doc.text, pdfBase64: job.doc.base64 });
        return { type: "form_vawa_i360", data } as const;
      }
      if (caseType === "u_visa") {
        if (k === "I-918") {
          const data = await extractI918FromText({ text: job.doc.text, pdfBase64: job.doc.base64 });
          return { type: "form_u_i918", data } as const;
        }
        if (k === "I-918A") {
          const data = await extractI918AFromText({ text: job.doc.text, pdfBase64: job.doc.base64 });
          return { type: "form_u_i918a", data } as const;
        }
        if (k === "I-918B") {
          const data = await extractI918BFromText({ text: job.doc.text, pdfBase64: job.doc.base64 });
          return { type: "form_u_i918b", data } as const;
        }
      }
      const usesVision = job.doc.kind === "I-914B";
      const data = await extractFormFromText({
        formKind: job.doc.kind,
        text: job.doc.text,
        pdfBase64: usesVision ? job.doc.base64 : undefined
      });
      return { type: "form_generic", data } as const;
    }
    if (job.type === "story") {
      if (caseType === "vawa") {
        const data = await extractVawaStoryFromText({ text: job.doc.text, pdfBase64: job.doc.base64 });
        return { type: "story_vawa", data } as const;
      }
      if (caseType === "u_visa") {
        const data = await extractUVisaStoryFromText({ text: job.doc.text, pdfBase64: job.doc.base64 });
        return { type: "story_u", data } as const;
      }
      const data = await extractStoryFromText({ text: job.doc.text, pdfBase64: job.doc.base64 });
      return { type: "story_t", data } as const;
    }
    if (job.type === "passport") {
      const data = await checkPassportSignatureFromPdf(job.pdfBase64);
      return { type: "passport", data } as const;
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
    const data = await analyzeI914BQualification(job.pdfBase64);
    return { type: "lea", data } as const;
  });

  const formsT: FormData[] = [];
  let storyT: StoryFacts | null = null;
  let i360: I360Form | null = null;
  let storyVawa: VawaStoryFacts | null = null;
  let i918: I918Form | null = null;
  const i918as: I918AForm[] = [];
  let i918b: I918BForm | null = null;
  let storyU: UVisaStoryFacts | null = null;
  let passportCheck: PassportSignatureCheck | null = null;
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
    if (r.type === "passport" && r.data) passportCheck = r.data;
    if (r.type === "witnesses" && r.data) witnessAnalysis = r.data;
    if (r.type === "medical" && r.data) medicalAnalysis = r.data;
    if (r.type === "country" && r.data) countryAnalysis = r.data;
    if (r.type === "lea" && r.data) leaQualification = r.data;
    if (r.type === "translations" && r.data) translations = r.data;
  }

  let findings: Finding[] = [];
  let extractedForms: any[] = [];
  let storyFacts: any = null;
  let clientName: string | null = null;

  if (caseType === "t_visa") {
    findings = applyGovisaRules({
      forms: formsT,
      story: storyT,
      passportCheck,
      witnessAnalysis,
      medicalAnalysis,
      countryAnalysis,
      leaQualification,
      translations,
      mode: input.mode ?? "draft"
    });
    extractedForms = formsT;
    storyFacts = storyT;
    const i914 = formsT.find((f) => f.form === "I-914") as any;
    const g = i914?.person?.given_name ?? storyT?.full_name ?? null;
    clientName = g ? `${g} ${i914?.person?.family_name ?? ""}`.trim() : null;
  } else if (caseType === "vawa") {
    findings = applyVawaRules({ i360, story: storyVawa }) as Finding[];
    extractedForms = [i360, ...formsT].filter(Boolean);
    storyFacts = storyVawa;
    const g = i360?.person?.given_name ?? storyVawa?.full_name ?? null;
    clientName = g ? `${g} ${i360?.person?.family_name ?? ""}`.trim() : null;
  } else {
    findings = applyUVisaRules({ i918, i918as, i918b, story: storyU }) as Finding[];
    extractedForms = [i918, ...i918as, i918b, ...formsT].filter(Boolean);
    storyFacts = storyU;
    const g = i918?.person?.given_name ?? storyU?.full_name ?? null;
    clientName = g ? `${g} ${i918?.person?.family_name ?? ""}`.trim() : null;
  }

  // Enriquecer com findings comuns (passaporte, traduções, witnesses, medical, country) pra VAWA e U também
  if (caseType !== "t_visa") {
    const commonFindings = applyGovisaRules({
      forms: [],
      story: null,
      passportCheck,
      witnessAnalysis,
      medicalAnalysis,
      countryAnalysis,
      leaQualification: null,
      translations,
      mode: input.mode ?? "draft"
    });
    findings = findings.concat(commonFindings);
  }

  const report: ReviewReport = {
    client_name: clientName,
    forms_detected: extractedForms.map((f: any) => f.form ?? "?"),
    findings,
    summary: summarize(findings)
  };

  unregister();

  return {
    report,
    debug: {
      case_type: caseType,
      forms_detected: extractedForms.map((f: any) => f.form ?? "?"),
      story_detected: !!storyFacts,
      extracted_forms: extractedForms,
      story_facts: storyFacts,
      passport_check: passportCheck,
      witness_analysis: witnessAnalysis,
      medical_analysis: medicalAnalysis,
      country_analysis: countryAnalysis,
      lea_qualification: leaQualification,
      translations_check: translations,
      subdocs: subdocs.map(({ base64, ...rest }) => rest),
      num_pages: pdf.numPages,
      elapsed_ms: Date.now() - started
    },
    usage_events: usageEvents
  };
}
