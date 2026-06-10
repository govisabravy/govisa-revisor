import Anthropic from "@anthropic-ai/sdk";
import type { Finding, FormData } from "../schemas/forms";
import type { UVisaStoryFacts, I918Form, I918AForm, I918BForm } from "../schemas/uvisa";
import { stripJsonFences } from "./json-utils";
import { fitPdfForClaude } from "./pdf-fit";
import { parseDate } from "./rules";
import { RULE_IDS } from "./rule_ids";

// Helper local: idade em uma data de referência a partir de DOB string
function ageAtDateLocalU(dob?: string | null, at: Date = new Date()): number | null {
  const d = parseDate(dob);
  if (!d) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age--;
  return age;
}

// I-192 type extracted from FormData union (same shape as in T-visa)
type I192Form = Extract<FormData, { form: "I-192" }>;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
function client() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "placeholder",
    authToken: process.env.ANTHROPIC_AUTH_TOKEN,
    // timeout no construtor: o guard "Streaming is strongly recommended" do SDK
    // so e suprimido por _options.timeout do client; timeout per-request nao evita o throw
    timeout: 600_000
  });
}

async function callJsonWithPdf<T>(opts: {
  system: string;
  pdfBase64?: string;
  userText: string;
  maxTokens?: number;
  operation: string;
}): Promise<T | null> {
  try {
    const c = client();
    const content: any[] = [];
    if (opts.pdfBase64) {
      // Fix 413 (05/06): garante que o PDF caiba no limite de request da API.
      const fitted = await fitPdfForClaude(opts.pdfBase64, { label: opts.operation });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: fitted } });
    }
    content.push({ type: "text", text: opts.userText });
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } } as any],
      messages: [{ role: "user", content }]
    });
    const textBlock = res.content.find((b: any) => b.type === "text") as any;
    if (!textBlock) return null;
    return JSON.parse(stripJsonFences(textBlock.text));
  } catch (err) {
    console.error(`[${opts.operation}]`, err);
    return null;
  }
}

export const QUALIFYING_U_CRIMES = [
  "domestic violence","sexual assault","rape","felonious assault","kidnapping","abduction",
  "extortion","blackmail","false imprisonment","witness tampering","obstruction of justice",
  "perjury","murder","manslaughter","torture","trafficking","peonage","involuntary servitude",
  "slave trade","abusive sexual contact","prostitution","sexual exploitation","female genital mutilation",
  "being held hostage","stalking","fraud in foreign labor contracting"
];

export async function extractI918FromText(args: { text: string; pdfBase64?: string }): Promise<I918Form | null> {
  return callJsonWithPdf({
    system: "Você extrai dados do Form I-918 (U Nonimmigrant Status). Devolva SOMENTE JSON válido.",
    pdfBase64: args.pdfBase64,
    userText: `Extraia I-918. Shape:
{
  "form": "I-918",
  "meta": { "edition_date": string|null, "applicant_signature": {"signed": boolean|null, "name_printed": string|null, "date_signed": string|null}, "interpreter_used": boolean|null, "interpreter_signature": {...}, "preparer_used": boolean|null, "preparer_signature": {...} },
  "person": { shape padrão PersonSchema },
  "physical_address": {...}, "safe_mailing_address": {...}|null,
  "qualifying_criminal_activity": string[],
  "inadmissibility_requires_waiver": boolean|null,
  "family_members_included": [{
    "relationship": string|null, "name": string|null, "date_of_birth": string|null,
    "country_of_citizenship": string|null,
    "country_of_residence": string|null,
    "is_us_citizen": boolean|null
  }]
}

Dicas:
- "is_us_citizen" = true se o family member é declarado como cidadão americano (USC). Filhos americanos não precisam de I-918A.
- "country_of_residence" = país onde o family member reside. Familiares fora dos EUA podem aparecer em consular processing.

TEXTO:
"""${args.text.slice(0, 14000)}"""`,
    maxTokens: 3500, operation: "extractI918"
  });
}

export async function extractI918AFromText(args: { text: string; pdfBase64?: string }): Promise<I918AForm | null> {
  return callJsonWithPdf({
    system: "Você extrai Form I-918 Supplement A (Qualifying Family Member). SOMENTE JSON válido.",
    pdfBase64: args.pdfBase64,
    userText: `Shape:
{
  "form": "I-918A",
  "meta": {...},
  "principal_applicant": { shape partial PersonSchema },
  "family_member": { shape PersonSchema },
  "relationship_to_principal": string|null,
  "relationship_evidence_mentioned": string[],
  "physical_address": {...}, "safe_mailing_address": {...}
}

TEXTO:
"""${args.text.slice(0, 14000)}"""`,
    maxTokens: 3000, operation: "extractI918A"
  });
}

export async function extractI918BFromText(args: { text: string; pdfBase64?: string }): Promise<I918BForm | null> {
  return callJsonWithPdf({
    system: `Você extrai Form I-918 Supplement B (U Nonimmigrant Status Certification).
Agências certificadoras qualificadas: federal (ICE/HSI, FBI, USAO, DOJ, DOL, EEOC), state/local police, prosecutors, judges, CPS, EEOC, Labor.
Não qualificadas: advogados, ONGs, médicos, social workers.`,
    pdfBase64: args.pdfBase64,
    userText: `Extraia I-918B. Shape:
{
  "form": "I-918B",
  "meta": {...},
  "certifying_agency": string|null,
  "is_qualifying_agency": boolean|null,
  "certifying_official_name": string|null,
  "certifying_official_title": string|null,
  "signature": { "signed": boolean|null, "date_signed": string|null },
  "helpfulness_confirmed": boolean|null,
  "criminal_activity_listed": string[],
  "case_status": string|null,
  "victim_name": string|null
}

TEXTO:
"""${args.text.slice(0, 14000)}"""`,
    maxTokens: 2500, operation: "extractI918B"
  });
}

const U_STORY_SYSTEM = `Você é um advogado de imigração sênior analisando a declaração de vítima para U-visa.

Elegibilidade U-visa:
1) Vítima de qualifying criminal activity (lista: DV, sexual assault, rape, felonious assault, kidnapping, extortion, witness tampering, trafficking, stalking, etc.)
2) Sofreu substantial physical OR mental abuse como resultado do crime.
3) Possui informação sobre o crime.
4) É/foi/provavelmente será helpful to law enforcement (certificada via I-918B).
5) Crime ocorreu nos EUA ou violou leis americanas.

SOMENTE JSON válido.`;

export async function extractUVisaStoryFromText(args: { text: string; pdfBase64?: string }): Promise<UVisaStoryFacts | null> {
  return callJsonWithPdf({
    system: U_STORY_SYSTEM,
    pdfBase64: args.pdfBase64,
    userText: `Devolva JSON:
{
  "full_name": string|null, "date_of_birth": string|null, "country_of_origin": string|null,
  "current_marital_status": "solteiro|casado|divorciado|viuvo"|null,
  "year_entered_us": string|null,
  "qualifying_criminal_activity_mentioned": string[],
  "substantial_physical_abuse_mentioned": boolean|null,
  "substantial_mental_abuse_mentioned": boolean|null,
  "abuse_examples": string[],
  "cooperation_with_lea_status": "past|ongoing|likely_future|none"|null,
  "cooperation_details": string|null,
  "reported_to_lea_date": string|null,
  "lea_agency_mentioned": string|null,
  "case_number_mentioned": string|null,
  "injuries_mentioned": string[],
  "psychological_impact": string[],
  "children": [{"name": string|null, "date_of_birth": string|null, "marital_status": "single|married|divorced|widowed"|null}],
  "key_dates": [{"event": string, "date": string}]
}

TEXTO:
"""${args.text.slice(0, 20000)}"""`,
    maxTokens: 3500, operation: "extractUVisaStory"
  });
}

export interface UVisaRulesInput {
  i918: I918Form | null;
  i918as: I918AForm[];
  i918b: I918BForm | null;
  story: UVisaStoryFacts | null;
  /** Opcional — quando presente, regras de waiver podem rebaixar severidade. */
  i192?: I192Form | null;
  /**
   * Texto bruto agregado dos documentos do processo (subdocs.text concatenado).
   * Usado para deteccao heuristica de waiver petition e cartas de imigracao
   * (NTA, I-220A, I-862, EOIR) — Parte 6 do feedback Flavia 29/04.
   */
  fullText?: string | null;
}

function norm(v?: string | null): string {
  return (v ?? "").toString().trim().toUpperCase().replace(/\s+/g, " ");
}

// Heuristica de waiver petition I-918 Supplement B: procura mencao explicita a
// waiver/exception no texto agregado. Util quando o I-918B nao vem assinado pelo
// certifying officer (~90% dos casos, segundo Flavia) mas ha justificativa.
function detectsI918BWaiverPetition(fullText: string | null | undefined, i918: I918Form | null): boolean {
  if (i918?.inadmissibility_requires_waiver === true) return true;
  if (!fullText) return false;
  const t = fullText.toLowerCase();
  // Mencao explicita a "I-918 Supplement B Waiver" / waiver da certificacao /
  // exception request / certifying agency declined / unable to obtain certification.
  const PATTERNS = [
    /i[-\s]?918\s*(?:supplement\s*)?b\s*(?:certification\s*)?waiver/i,
    /supplement\s*b\s*waiver/i,
    /waiver\s*(?:of|for)\s*(?:the\s*)?(?:i[-\s]?918\s*b|certification)/i,
    /(?:certification|certifying)\s*(?:agency|official)\s*(?:declined|refused|unable|did\s*not\s*respond)/i,
    /unable\s*to\s*obtain\s*(?:the\s*)?(?:i[-\s]?918\s*b|certification|supplement\s*b)/i,
    /exception\s*request/i,
    /non[-\s]?cooperation\s*waiver/i
  ];
  return PATTERNS.some((rx) => rx.test(t));
}

// Heuristica: detecta presenca de carta de imigracao oficial (NTA, I-220A,
// I-862, ordem de remocao) no texto agregado do processo.
function hasImmigrationLetter(fullText: string | null | undefined): boolean {
  if (!fullText) return false;
  const t = fullText.toLowerCase();
  const PATTERNS = [
    /\bnotice\s*to\s*appear\b/i,
    /\bnta\b/i,
    /\bi[-\s]?220\s*a\b/i,
    /\bi[-\s]?862\b/i,
    /\border\s*of\s*removal\b/i,
    /\border\s*to\s*show\s*cause\b/i,
    /\bimmigration\s*court\b/i,
    /\beoir\b/i,
    /\bexecutive\s*office\s*for\s*immigration\s*review\b/i,
    /\bdepartment\s*of\s*homeland\s*security\b/i,
    /\bice\s*(?:detainer|hold|notice|custody|enforcement)\b/i,
    /\bimmigration\s*(?:judge|hearing|proceeding)\b/i,
    /\bremoval\s*proceeding/i,
    /\bcustody\s*notice\b/i
  ];
  return PATTERNS.some((rx) => rx.test(t));
}

function ageAtDateLocalU2(dob?: string | null, at: Date = new Date()): number | null {
  return ageAtDateLocalU(dob, at);
}

export function applyUVisaRules(args: UVisaRulesInput): Finding[] {
  const out: Finding[] = [];
  const { i918, i918as, i918b, story, i192, fullText } = args;
  const waiverPresent = detectsI918BWaiverPetition(fullText, i918);

  if (!i918) {
    out.push({
      severity: "critica", tier: "tier1_filing", category: "campo_vazio",
      field: "I-918 não encontrado", form: null,
      explanation: "Processo U-visa requer I-918 principal. Não foi detectado.",
      rule_id: RULE_IDS.U_FILING_I918_MISSING,
      subject_id: null
    });
    return out;
  }

  // I-918B (certification by LEA) é OBRIGATÓRIO pra U-visa
  if (!i918b) {
    // Ajuste obs 4 (Flavia): se há I-192 com waiver/exemption mencionando "non-cooperation",
    // rebaixa de critica para alta + nota.
    const i192Text =
      `${(i192?.grounds_of_inadmissibility ?? []).join(" | ")} ${i192?.waiver_justification_summary ?? ""}`.toLowerCase();
    const hasWaiverHint =
      /non[-\s]?cooperation|nao[-\s]?coopera|não[-\s]?coopera|exemption/.test(i192Text);
    if (hasWaiverHint) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "elegibilidade",
        field: "I-918B (Certification) — waiver de não cooperação detectado", form: "I-918B",
        explanation:
          "I-918B ausente. No entanto, foi identificada menção a 'non-cooperation' / waiver / exemption no I-192. Confirmar elegibilidade da exemption antes do filing.",
        recommendation:
          "Confirmar fundamentos da exemption de cooperação. Se aplicável, anexar declaração explicando a impossibilidade de obter I-918B + secondary evidence.",
        rule_id: RULE_IDS.U_SUBST_I918B_MISSING_WITH_WAIVER,
        subject_id: null
      });
    } else {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "I-918B (Certification)", form: "I-918B",
        explanation: "U-visa EXIGE I-918 Supplement B assinado por agência certificadora qualificada. Sem isso, a petição não pode ser aprovada.",
        recommendation: "Obter certificação de LEA qualificada (polícia, promotoria, juiz, EEOC, DOL, CPS).",
        rule_id: RULE_IDS.U_SUBST_I918B_MISSING_NO_WAIVER,
        subject_id: null
      });
    }
  } else {
    if (i918b.is_qualifying_agency === false) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "I-918B — Agência qualificada", form: "I-918B",
        found: i918b.certifying_agency ?? "(não identificada)",
        explanation: "Agência certificadora não é qualificada para U-visa conforme 8 CFR 214.14(a)(2).",
        rule_id: RULE_IDS.U_SUBST_I918B_AGENCY_NOT_QUALIFYING,
        subject_id: null
      });
    }
    if (!i918b.signature?.signed) {
      // Ajuste Parte 6 Flavia (29/04): cerca de 90% dos casos vem com I-918B
      // sem assinatura, e na pratica o filing inclui waiver petition justificando
      // a ausencia. Se detectarmos waiver explicito (no I-918 ou texto agregado),
      // rebaixamos pra media e reformulamos a mensagem; senao, mantemos critica.
      if (waiverPresent) {
        out.push({
          severity: "media", tier: "tier1_filing", category: "assinatura",
          field: "I-918B — Assinatura do Certifying Official (com waiver detectado)", form: "I-918B",
          explanation:
            "I-918B nao esta assinado pelo certifying official, porem foi identificada mencao a waiver petition / exception request (I-918 Supplement B Waiver) no processo. Confirmar que a waiver petition esta completa, que ha justificativa robusta de impossibilidade de obter a certificacao e que ha secondary evidence de helpfulness.",
          recommendation:
            "Validar manualmente: (1) waiver petition foi anexada e assinada pelo cliente; (2) ha narrativa explicando porque o LEA nao certificou; (3) helpfulness substituida por declaracoes de testemunhas, BO, registros policiais, news reports.",
          rule_id: RULE_IDS.U_FILING_I918B_NOT_SIGNED,
          subject_id: null
        });
      } else {
        out.push({
          severity: "critica", tier: "tier1_filing", category: "assinatura",
          field: "I-918B — Assinatura do Certifying Official", form: "I-918B",
          explanation:
            "I-918B precisa estar assinado pelo oficial certificador. Nao foi detectada waiver petition / I-918 Supplement B Waiver no processo. Cerca de 90% dos casos vem sem assinatura — antes de fechar como critica, confirmar manualmente se ha waiver/exception request anexada que o sistema nao conseguiu identificar.",
          recommendation:
            "Obter assinatura do certifying official. Caso a agencia nao certifique, anexar waiver petition (I-918 Supplement B Waiver) com narrativa de impossibilidade + secondary evidence de helpfulness.",
          rule_id: RULE_IDS.U_FILING_I918B_NOT_SIGNED,
          subject_id: null
        });
      }
    }
    if (!i918b.certifying_official_title) {
      out.push({
        severity: "alta", tier: "tier1_filing", category: "campo_vazio",
        field: "I-918B — Título do oficial", form: "I-918B",
        explanation: "Título/cargo do certifying official ausente.",
        rule_id: RULE_IDS.U_FILING_I918B_OFFICER_TITLE_EMPTY,
        subject_id: null
      });
    }
    if (i918b.helpfulness_confirmed === false) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "I-918B — Helpfulness", form: "I-918B",
        explanation: "I-918B não confirma que o peticionário foi/é/será helpful ao LEA.",
        rule_id: RULE_IDS.U_SUBST_I918B_HELPFULNESS_MISSING,
        subject_id: null
      });
    }
    // Data da I-918B não pode ser muito antiga — 6 meses window (boa prática)
    if (i918b.signature?.date_signed) {
      const d = new Date(i918b.signature.date_signed);
      const days = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      if (!isNaN(days) && days > 180) {
        out.push({
          severity: "media", tier: "tier3_estrategico", category: "estrategia",
          field: "I-918B — assinada há mais de 6 meses", form: "I-918B",
          explanation: `Assinada em ${i918b.signature.date_signed}. Acima de 6 meses pode gerar RFE pedindo atualização.`,
          rule_id: RULE_IDS.U_SUBST_I918B_OLD,
          subject_id: null
        });
      }
    }
  }

  // Qualifying criminal activity
  if ((i918.qualifying_criminal_activity ?? []).length === 0) {
    out.push({
      severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
      field: "Qualifying Criminal Activity", form: "I-918",
      explanation: "I-918 não lista qualifying criminal activity na Part 3.",
      rule_id: RULE_IDS.U_SUBST_NO_QUALIFYING_CRIME,
      subject_id: null
    });
  }

  // Substantial abuse
  if (story) {
    if (story.substantial_physical_abuse_mentioned === false && story.substantial_mental_abuse_mentioned === false) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Substantial physical or mental abuse", form: null,
        explanation: "U-visa exige substantial physical OR mental abuse. Não caracterizado na história.",
        recommendation: "Revisar declaração para descrever lesões físicas, PTSD, ansiedade, depressão, impacto na vida diária.",
        rule_id: RULE_IDS.U_SUBST_NO_SUBSTANTIAL_ABUSE,
        subject_id: null
      });
    }
    if ((story.abuse_examples ?? []).length < 2) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "credibilidade",
        field: "Exemplos concretos do crime/abuso", form: null,
        explanation: "Poucos exemplos específicos do crime. Adjudicador prefere fatos, episódios, datas.",
        rule_id: RULE_IDS.U_SUBST_LOW_ABUSE_EXAMPLES,
        subject_id: null
      });
    }
    if (story.cooperation_with_lea_status === "none") {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Cooperation com LEA", form: null,
        explanation: "História não menciona cooperação passada, atual ou futura com law enforcement.",
        rule_id: RULE_IDS.U_SUBST_NO_COOPERATION,
        subject_id: null
      });
    }
    // Bate crime mencionado na história com lista
    const mentioned = (story.qualifying_criminal_activity_mentioned ?? []).map(s => s.toLowerCase());
    const hasQualifying = mentioned.some(m => QUALIFYING_U_CRIMES.some(q => m.includes(q)));
    if (!hasQualifying && mentioned.length > 0) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Crime mencionado fora da lista qualifying", form: null,
        found: mentioned.join(", "),
        explanation: "Crime mencionado na história pode não estar na lista de qualifying criminal activity do U-visa. Verificar 8 CFR 214.14(a)(9).",
        rule_id: RULE_IDS.U_SUBST_CRIME_NOT_QUALIFYING,
        subject_id: null
      });
    }
  }

  // Concordância nome crime I-918 x I-918B
  if (i918 && i918b) {
    const i918Crimes = (i918.qualifying_criminal_activity ?? []).map(s => s.toLowerCase());
    const i918bCrimes = (i918b.criminal_activity_listed ?? []).map(s => s.toLowerCase());
    if (i918Crimes.length > 0 && i918bCrimes.length > 0) {
      const overlap = i918Crimes.some(c => i918bCrimes.some(c2 => c2.includes(c) || c.includes(c2)));
      if (!overlap) {
        out.push({
          severity: "critica", tier: "tier2_substantivo", category: "divergencia",
          field: "Crime divergente I-918 vs I-918B", form: "I-918B",
          expected: `${i918Crimes.join(", ")} (I-918)`,
          found: `${i918bCrimes.join(", ")} (I-918B)`,
          explanation: "Crime listado no I-918 não bate com o listado no I-918B pela agência certificadora.",
          rule_id: RULE_IDS.U_CONS_CRIME_I918_VS_I918B,
          subject_id: null
        });
      }
    }
  }

  // Victim name I-918B bate com peticionário I-918
  if (i918 && i918b?.victim_name) {
    const p = i918.person;
    const fullName = `${p.given_name ?? ""} ${p.family_name ?? ""}`.trim().toLowerCase();
    if (fullName && i918b.victim_name.toLowerCase().trim() !== fullName) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "divergencia",
        field: "Nome da vítima I-918B x nome I-918", form: "I-918B",
        expected: fullName, found: i918b.victim_name,
        explanation: "Nome da vítima no I-918B diverge do peticionário no I-918.",
        rule_id: RULE_IDS.U_CONS_VICTIM_NAME_DIVERGE,
        subject_id: null
      });
    }
  }

  // Regras de I-918A (dependentes da U-visa) — análogas a T-visa
  if (i918 && i918as.length > 0) {
    const principal = i918.person;
    for (const a of i918as) {
      const sid = (a as any)._subject_id ?? null;
      // Nome do principal no I-918A diverge?
      if (a.principal_applicant) {
        const pa = a.principal_applicant;
        if (
          norm(pa.family_name) &&
          norm(principal.family_name) &&
          norm(pa.family_name) !== norm(principal.family_name)
        ) {
          out.push({
            severity: "critica", tier: "tier1_filing", category: "divergencia",
            field: "I-918A — Principal Applicant Family Name", form: "I-918A",
            expected: `${principal.family_name} (I-918)`,
            found: `${pa.family_name} (I-918A)`,
            explanation:
              "Family Name do Principal Applicant no I-918A não bate com o Family Name do principal no I-918.",
            rule_id: RULE_IDS.U_DEP_I918A_PRINCIPAL_NAME_DIVERGE,
            subject_id: sid
          });
        }
        if (
          norm(pa.given_name) &&
          norm(principal.given_name) &&
          norm(pa.given_name) !== norm(principal.given_name)
        ) {
          out.push({
            severity: "critica", tier: "tier1_filing", category: "divergencia",
            field: "I-918A — Principal Applicant Given Name", form: "I-918A",
            expected: `${principal.given_name} (I-918)`,
            found: `${pa.given_name} (I-918A)`,
            explanation:
              "Given Name do Principal Applicant no I-918A não bate com o Given Name do principal no I-918.",
            rule_id: RULE_IDS.U_DEP_I918A_PRINCIPAL_NAME_DIVERGE,
            subject_id: sid
          });
        }
      }
      if (!a.relationship_to_principal) {
        out.push({
          severity: "alta", tier: "tier2_substantivo", category: "elegibilidade",
          field: "I-918A — Relationship to Principal", form: "I-918A",
          explanation: "I-918A não indica o qualifying relationship com o principal.",
          rule_id: RULE_IDS.U_DEP_I918A_NO_QUALIFYING_REL,
          subject_id: sid
        });
      }
      if (!a.relationship_evidence_mentioned || a.relationship_evidence_mentioned.length === 0) {
        // Ajuste Parte 6 Flavia (29/04): a evidencia (certidao de nascimento/
        // casamento) costuma estar em Identification Documents do processo,
        // nao vinculada explicitamente ao I-918A. Rebaixado para media com
        // mensagem pedindo verificacao manual — espelha T-visa.
        out.push({
          severity: "media", tier: "tier1_filing", category: "suporte_documental",
          field: "I-918A — Evidência da relação", form: "I-918A",
          explanation:
            "Nao foi possivel identificar evidencia do qualifying relationship vinculada a este I-918A. Confirmar se a certidao de nascimento ou casamento esta em Identification Documents do processo.",
          rule_id: RULE_IDS.U_DEP_I918A_NO_EVIDENCE,
          subject_id: sid
        });
      }
    }
  }

  // Parte 6 (Flavia) — qualifying relatives mencionados no I-918 / story sem I-918A
  // Espelha o padrao do T-visa: tolerancia para USC e familiares fora dos EUA.
  if (i918) {
    const filingDateForDeps = parseDate(i918.meta?.applicant_signature?.date_signed) ?? new Date();
    const principalAge = ageAtDateLocalU2(i918.person?.date_of_birth, filingDateForDeps);
    const principalIsMinor = principalAge !== null && principalAge < 21;

    const matchesAnyI918A = (name?: string | null, dob?: string | null): boolean => {
      if (!name && !dob) return false;
      const targetFirst = norm((name ?? "").split(" ")[0]);
      const targetLast = norm((name ?? "").split(" ").slice(-1)[0]);
      return i918as.some((a) => {
        const fm = a.family_member;
        if (!fm) return false;
        const aFirst = norm(fm.given_name ?? "");
        const aLast = norm(fm.family_name ?? "");
        const aDob = (fm.date_of_birth ?? "").slice(0, 10);
        const dobMatch = !!dob && !!aDob && aDob === (dob ?? "").slice(0, 10);
        const nameMatch =
          (!!targetFirst && (aFirst === targetFirst || aLast === targetFirst)) ||
          (!!targetLast && (aFirst === targetLast || aLast === targetLast));
        return nameMatch || dobMatch;
      });
    };

    for (const fm of i918.family_members_included ?? []) {
      const rel = (fm.relationship ?? "").toLowerCase();
      const isSpouse = /spouse|c[ôo]njuge|wife|husband|esposa|marido/.test(rel);
      const isChild = /child|son|daughter|filho|filha/.test(rel);
      const isParent = /parent|pai|m[ãa]e|mother|father/.test(rel);
      const isSibling = /sibling|brother|sister|irm[ãa]o|irm[ãa]/.test(rel);
      const fmAge = ageAtDateLocalU2(fm.date_of_birth, filingDateForDeps);

      // U-visa qualifying derivatives:
      // - Spouse (T-2) sempre qualifica
      // - Child (T-3) < 21 e nao casado
      // - Se principal < 21: parent (T-4) e unmarried sibling < 18 (T-5)
      let qualifies = false;
      if (isSpouse) qualifies = true;
      else if (isChild && fmAge !== null && fmAge < 21) qualifies = true;
      else if (principalIsMinor && isParent) qualifies = true;
      else if (principalIsMinor && isSibling && fmAge !== null && fmAge < 18) qualifies = true;

      if (!qualifies) continue;

      const isUsCitizen = fm.is_us_citizen === true;
      const residesAbroad =
        !!fm.country_of_residence &&
        norm(fm.country_of_residence) !== "US" &&
        norm(fm.country_of_residence) !== "USA" &&
        norm(fm.country_of_residence) !== "UNITED STATES";

      if (matchesAnyI918A(fm.name, fm.date_of_birth)) continue;

      if (isUsCitizen) {
        out.push({
          severity: "baixa", tier: "tier3_estrategico", category: "estrategia",
          field: `${fm.name ?? "Familiar"} — USC, sem I-918A`, form: null,
          explanation:
            "Familiar marcado como cidadao americano — nao precisa de I-918A. Correto nao incluir.",
          rule_id: RULE_IDS.U_DEP_USC_NO_I918A_OK,
          subject_id: null
        });
      } else if (residesAbroad) {
        out.push({
          severity: "baixa", tier: "tier3_estrategico", category: "estrategia",
          field: `${fm.name ?? "Familiar"} — reside fora dos EUA, sem I-918A`, form: null,
          explanation: `Familiar reside em ${fm.country_of_residence}. I-918A pode ser apresentado para consular processing posterior — nao bloqueia o filing do principal.`,
          rule_id: RULE_IDS.U_DEP_ABROAD_CONSULAR_OK,
          subject_id: null
        });
      } else {
        out.push({
          severity: "alta", tier: "tier2_substantivo", category: "elegibilidade",
          field: `I-918A faltando — ${fm.name ?? "familiar"}`, form: "I-918A",
          explanation: `${fm.name ?? "Familiar"} (${rel || "relacao"}, ${fmAge !== null ? fmAge + " anos no filing" : "idade desconhecida"}) qualifica como U-derivativo mas nao tem I-918A no processo.`,
          recommendation:
            "Anexar I-918A para o derivativo (com evidencia do qualifying relationship). Se for USC ou residir fora dos EUA, declarar explicitamente para evitar este flag.",
          rule_id: RULE_IDS.U_DEP_QUALIFYING_RELATIVE_NO_I918A,
          subject_id: null
        });
      }
    }
  }

  // Q9 — CSPA age-out risk para derivativos U-visa (filhos com 20-21 anos no filing)
  const filingDateU = parseDate(i918?.meta?.applicant_signature?.date_signed) ?? new Date();
  const cspaPoolU: Array<{ name?: string | null; date_of_birth?: string | null; relationship?: string | null }> = [];
  if (i918?.family_members_included) {
    for (const fm of i918.family_members_included) {
      const rel = (fm.relationship ?? "").toLowerCase();
      if (/child|son|daughter|filho|filha/.test(rel)) {
        cspaPoolU.push({ name: fm.name, date_of_birth: fm.date_of_birth, relationship: rel });
      } else if (!fm.relationship) {
        // Sem relationship explícito, só inclui se o DOB sugerir criança/jovem
        cspaPoolU.push({ name: fm.name, date_of_birth: fm.date_of_birth, relationship: null });
      }
    }
  }
  if (story?.children) {
    for (const c of story.children) {
      cspaPoolU.push({ name: c.name, date_of_birth: c.date_of_birth, relationship: "child" });
    }
  }
  const seenU = new Set<string>();
  for (const c of cspaPoolU) {
    const age = ageAtDateLocalU(c.date_of_birth, filingDateU);
    if (age === null) continue;
    if (age >= 20 && age < 21) {
      const key = `${(c.name ?? "").toLowerCase().trim()}|${c.date_of_birth ?? ""}`;
      if (seenU.has(key)) continue;
      seenU.add(key);
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "elegibilidade",
        field: `CSPA age-out risk — ${c.name ?? "filho(a)"}`, form: "I-918",
        explanation: `${c.name ?? "Filho(a)"} tem ${age} anos no filing date — aproximando-se de 21 anos. Risco de envelhecer durante processamento USCIS antes da aprovação. CSPA INA 203(h) protege parcialmente derivativos U-visa.`,
        recommendation:
          "Acelerar I-918A. Documentar filing date com clareza. Avaliar request expedite junto ao VSC.",
        rule_id: RULE_IDS.U_DEP_CSPA_AGE_OUT_RISK,
        subject_id: null
      });
    }
  }

  // Q14 — Prior false claim to U.S. citizenship (versão simplificada)
  if (story) {
    const FALSE_CLAIM_RX_U =
      /claim(?:ed)?[\s\w]*citizenship|alega[çc][ãa]o de cidadania|claimed?\s+(?:to be\s+)?(?:u\.?s\.?|usc|american)|\bvoted\b|\bvoto\b|i-?9[\s,]*citizen|passport application|social security[\s\w]*citizen/i;
    const haystackU = [
      (story.cooperation_details ?? ""),
      (story.abuse_examples ?? []).join(" | "),
      (story.psychological_impact ?? []).join(" | ")
    ].join(" | ");
    if (FALSE_CLAIM_RX_U.test(haystackU)) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Prior false claim to U.S. citizenship (INA 212(a)(6)(C)(ii))", form: null,
        explanation:
          "Possível false claim to U.S. citizenship detectada na história. INA 212(a)(6)(C)(ii) NÃO tem waiver — pode matar o U-visa. Verificar com cliente urgentemente.",
        recommendation:
          "Confirmar com cliente registro como votante, declaração de cidadania em I-9, social security ou passport application. Avaliar timely retraction ou idade < 18 ao fazer a declaração.",
        rule_id: RULE_IDS.U_SUBST_FALSE_CLAIM_RISK,
        subject_id: null
      });
    }
  }

  // Parte 6 (Flavia) — A-number presente sem carta de imigracao detectada
  // Quando o cliente tem A-number em algum form mas o processo nao traz
  // NTA / I-220A / I-862 / Order of Removal / mencao a EOIR/ICE, pode
  // significar que existe historico junto a EOIR nao trazido pelo cliente.
  // Acao: cruzar com sistema EOIR antes do filing.
  {
    const aNumber = i918?.person?.a_number ?? null;
    const hasANumber = !!(aNumber && aNumber.replace(/\D/g, "").length >= 7);
    if (hasANumber && !hasImmigrationLetter(fullText)) {
      out.push({
        severity: "media", tier: "tier2_substantivo", category: "suporte_documental",
        field: "A-number presente sem carta de imigração no processo", form: "I-918",
        found: aNumber,
        explanation:
          "Cliente possui A-number preenchido no I-918 mas nao foi detectada carta de imigracao oficial (Notice to Appear, I-220A, I-862, Order of Removal, ou referencia a Immigration Court / EOIR / ICE) entre os documentos do processo.",
        recommendation:
          "Consultar se esta presente carta de imigracao na parte dos documentos para cruzamento de dados. Nao havendo, consultar o sistema EOIR (https://acis.eoir.justice.gov/en/) para verificar processos abertos antes do filing.",
        rule_id: RULE_IDS.IMM_EWI_A_NUMBER_NO_IMMIGRATION_DOC,
        subject_id: null
      });
    }
  }

  return out;
}
