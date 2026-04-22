import Anthropic from "@anthropic-ai/sdk";
import type { UVisaStoryFacts, I918Form, I918AForm, I918BForm } from "../schemas/uvisa";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
function client() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "placeholder",
    authToken: process.env.ANTHROPIC_AUTH_TOKEN
  });
}

function stripJson(t: string) {
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : t).trim();
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
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.pdfBase64 } });
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
    return JSON.parse(stripJson(textBlock.text));
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
  "family_members_included": [{"relationship": string|null, "name": string|null, "date_of_birth": string|null}]
}

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
}

export function applyUVisaRules(args: UVisaRulesInput): any[] {
  const out: any[] = [];
  const { i918, i918as, i918b, story } = args;

  if (!i918) {
    out.push({
      severity: "critica", tier: "tier1_filing", category: "campo_vazio",
      field: "I-918 não encontrado", explanation: "Processo U-visa requer I-918 principal. Não foi detectado."
    });
    return out;
  }

  // I-918B (certification by LEA) é OBRIGATÓRIO pra U-visa
  if (!i918b) {
    out.push({
      severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
      field: "I-918B (Certification)", form: "I-918B",
      explanation: "U-visa EXIGE I-918 Supplement B assinado por agência certificadora qualificada. Sem isso, a petição não pode ser aprovada.",
      recommendation: "Obter certificação de LEA qualificada (polícia, promotoria, juiz, EEOC, DOL, CPS)."
    });
  } else {
    if (i918b.is_qualifying_agency === false) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "I-918B — Agência qualificada", form: "I-918B",
        found: i918b.certifying_agency ?? "(não identificada)",
        explanation: "Agência certificadora não é qualificada para U-visa conforme 8 CFR 214.14(a)(2)."
      });
    }
    if (!i918b.signature?.signed) {
      out.push({
        severity: "critica", tier: "tier1_filing", category: "assinatura",
        field: "I-918B — Assinatura do Certifying Official", form: "I-918B",
        explanation: "I-918B precisa estar assinado pelo oficial certificador."
      });
    }
    if (!i918b.certifying_official_title) {
      out.push({
        severity: "alta", tier: "tier1_filing", category: "campo_vazio",
        field: "I-918B — Título do oficial", form: "I-918B",
        explanation: "Título/cargo do certifying official ausente."
      });
    }
    if (i918b.helpfulness_confirmed === false) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "I-918B — Helpfulness", form: "I-918B",
        explanation: "I-918B não confirma que o peticionário foi/é/será helpful ao LEA."
      });
    }
    // Data da I-918B não pode ser muito antiga — 6 meses window (boa prática)
    if (i918b.signature?.date_signed) {
      const d = new Date(i918b.signature.date_signed);
      const days = (Date.now() - d.getTime()) / (1000*60*60*24);
      if (!isNaN(days) && days > 180) {
        out.push({
          severity: "media", tier: "tier3_estrategico", category: "estrategia",
          field: "I-918B — assinada há mais de 6 meses", form: "I-918B",
          explanation: `Assinada em ${i918b.signature.date_signed}. Acima de 6 meses pode gerar RFE pedindo atualização.`
        });
      }
    }
  }

  // Qualifying criminal activity
  if ((i918.qualifying_criminal_activity ?? []).length === 0) {
    out.push({
      severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
      field: "Qualifying Criminal Activity", form: "I-918",
      explanation: "I-918 não lista qualifying criminal activity na Part 3."
    });
  }

  // Substantial abuse
  if (story) {
    if (story.substantial_physical_abuse_mentioned === false && story.substantial_mental_abuse_mentioned === false) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Substantial physical or mental abuse", form: null,
        explanation: "U-visa exige substantial physical OR mental abuse. Não caracterizado na história.",
        recommendation: "Revisar declaração para descrever lesões físicas, PTSD, ansiedade, depressão, impacto na vida diária."
      });
    }
    if ((story.abuse_examples ?? []).length < 2) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "credibilidade",
        field: "Exemplos concretos do crime/abuso", form: null,
        explanation: "Poucos exemplos específicos do crime. Adjudicador prefere fatos, episódios, datas."
      });
    }
    if (story.cooperation_with_lea_status === "none") {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Cooperation com LEA", form: null,
        explanation: "História não menciona cooperação passada, atual ou futura com law enforcement."
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
        explanation: "Crime mencionado na história pode não estar na lista de qualifying criminal activity do U-visa. Verificar 8 CFR 214.14(a)(9)."
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
          explanation: "Crime listado no I-918 não bate com o listado no I-918B pela agência certificadora."
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
        explanation: "Nome da vítima no I-918B diverge do peticionário no I-918."
      });
    }
  }

  return out;
}
