import Anthropic from "@anthropic-ai/sdk";
import type { VawaStoryFacts, I360Form } from "../schemas/vawa";

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

const I360_SYSTEM = `Você extrai dados do formulário USCIS Form I-360 (VAWA Self-Petition).
Responda apenas JSON válido. Campos ausentes como null.`;

export async function extractI360FromText(args: { text: string; pdfBase64?: string }): Promise<I360Form | null> {
  return callJsonWithPdf({
    system: I360_SYSTEM,
    pdfBase64: args.pdfBase64,
    userText: `Extraia o I-360 (VAWA) abaixo. Devolva JSON:
{
  "form": "I-360",
  "meta": { "edition_date": string|null, "applicant_signature": {"signed": boolean|null, "name_printed": string|null, "date_signed": string|null}, "interpreter_used": boolean|null, "interpreter_signature": {...}, "preparer_used": boolean|null, "preparer_signature": {...} },
  "person": {
    "family_name": string|null, "given_name": string|null, "middle_name": string|null, "other_names": [],
    "date_of_birth": string|null, "country_of_birth": string|null, "country_of_citizenship": string|null,
    "gender": string|null, "marital_status": string|null, "a_number": string|null, "uscis_online_account": string|null,
    "ssn": string|null, "passport_number": string|null, "passport_country": string|null,
    "passport_issue_date": string|null, "passport_expiration_date": string|null, "passport_signed": null
  },
  "physical_address": {...},
  "safe_mailing_address": {...}|null,
  "classification": string|null,
  "abuser_name": string|null,
  "abuser_immigration_status": "USC|LPR|unknown"|null,
  "relationship_to_abuser": "spouse|former_spouse|parent|child"|null,
  "marriage_date": string|null,
  "divorce_date": string|null,
  "resided_with_abuser": boolean|null,
  "good_moral_character_declared": boolean|null,
  "children_included": [{"name": string|null, "date_of_birth": string|null}]
}

TEXTO:
"""
${args.text.slice(0, 14000)}
"""`,
    maxTokens: 3500,
    operation: "extractI360"
  });
}

const VAWA_STORY_SYSTEM = `Você é um advogado de imigração sênior analisando a declaração pessoal de um self-petitioner VAWA.

Elegibilidade VAWA:
1) Relacionamento qualificado: cônjuge, ex-cônjuge (divórcio < 2 anos), pai/filho de um USC ou LPR abusador.
2) Good faith marriage (se cônjuge): casamento foi de boa-fé.
3) Battery or extreme cruelty: física OU psicológica/emocional. Exemplos: violência, coerção, ameaças, controle financeiro, isolamento, manipulação, traição sistemática.
4) Residência com o abusador em algum momento.
5) Good moral character (últimos 3 anos).

Devolva SOMENTE JSON válido.`;

export async function extractVawaStoryFromText(args: { text: string; pdfBase64?: string }): Promise<VawaStoryFacts | null> {
  return callJsonWithPdf({
    system: VAWA_STORY_SYSTEM,
    pdfBase64: args.pdfBase64,
    userText: `Extraia fatos da declaração VAWA. Devolva JSON:
{
  "full_name": string|null,
  "date_of_birth": string|null,
  "country_of_origin": string|null,
  "year_entered_us": string|null,
  "current_marital_status": "solteiro|casado|divorciado|viuvo|separado"|null,
  "abuser_name": string|null,
  "abuser_is_usc_or_lpr": boolean|null,
  "marriage_date": string|null,
  "marriage_location": string|null,
  "divorce_date": string|null,
  "good_faith_marriage_indicators": string[],
  "battery_or_extreme_cruelty_mentioned": boolean|null,
  "abuse_types_mentioned": string[],
  "abuse_examples": string[],
  "resided_with_abuser_at_any_point": boolean|null,
  "cohabitation_evidence": string[],
  "good_moral_character_concerns": string[],
  "extreme_hardship_mentioned": boolean|null,
  "hardship_reasons": string[],
  "children": [{"name": string|null, "date_of_birth": string|null, "marital_status": "single|married|divorced|widowed"|null}],
  "key_dates": [{"event": string, "date": string}]
}

"abuse_types_mentioned": ex ["physical violence", "emotional abuse", "financial coercion", "isolation", "threats", "infidelity pattern"].

TEXTO:
"""
${args.text.slice(0, 20000)}
"""`,
    maxTokens: 3500,
    operation: "extractVawaStory"
  });
}

export interface VawaRulesInput {
  i360: I360Form | null;
  story: VawaStoryFacts | null;
}

export function applyVawaRules(args: VawaRulesInput): any[] {
  const out: any[] = [];
  const { i360, story } = args;

  if (!i360) {
    out.push({
      severity: "critica", tier: "tier1_filing", category: "campo_vazio",
      field: "I-360 não encontrado", form: null,
      explanation: "Processo VAWA requer I-360 como formulário principal. Não foi detectado."
    });
    return out;
  }

  // Relacionamento qualificado
  if (!i360.relationship_to_abuser) {
    out.push({
      severity: "alta", tier: "tier2_substantivo", category: "elegibilidade",
      field: "Relacionamento com abusador", form: "I-360",
      explanation: "I-360 não indica qual é o relacionamento com o abusador (spouse, former_spouse, parent, child)."
    });
  }

  // Abusador USC ou LPR (obrigatório)
  if (i360.abuser_immigration_status === "unknown" || !i360.abuser_immigration_status) {
    out.push({
      severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
      field: "Status do abusador (USC/LPR)", form: "I-360",
      explanation: "VAWA exige que o abusador seja USC ou LPR. Este status não está documentado/claro."
    });
  }

  // Divórcio recente: 2 anos window
  if (i360.relationship_to_abuser === "former_spouse" && i360.divorce_date) {
    const d = new Date(i360.divorce_date);
    const diffYears = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (!isNaN(diffYears) && diffYears > 2) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Janela de 2 anos após divórcio (I-360)", form: "I-360",
        explanation: `Divórcio em ${i360.divorce_date} — passou de 2 anos. Self-petitioner ex-cônjuge tem janela de 2 anos do divórcio para protocolar I-360 (INA 204(a)(1)(A)(iii)(II)(aa)(CC)).`
      });
    }
  }

  // Residência conjunta
  if (i360.resided_with_abuser === false || (story && story.resided_with_abuser_at_any_point === false)) {
    out.push({
      severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
      field: "Residência conjunta com abusador", form: null,
      explanation: "VAWA exige residência com o abusador em algum momento. Não evidenciado."
    });
  }

  // Abuso caracterizado
  if (story) {
    if (story.battery_or_extreme_cruelty_mentioned === false) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "elegibilidade",
        field: "Battery or extreme cruelty", form: null,
        explanation: "História não caracteriza battery ou extreme cruelty. VAWA exige pelo menos um.",
        recommendation: "Reforçar declaração: violência física, ameaças, coerção, controle financeiro, isolamento ou manipulação emocional."
      });
    }
    if ((story.abuse_examples ?? []).length < 2) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "credibilidade",
        field: "Exemplos concretos de abuso", form: null,
        explanation: "Poucos exemplos específicos de abuso. Adjudicador valoriza fatos, datas, episódios concretos."
      });
    }
  }

  // Good faith marriage
  if (i360.relationship_to_abuser === "spouse" || i360.relationship_to_abuser === "former_spouse") {
    if (story && (story.good_faith_marriage_indicators ?? []).length === 0) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "suporte_documental",
        field: "Good faith marriage", form: null,
        explanation: "VAWA exige prova de casamento de boa-fé. Nenhum indicador narrado (certidão, fotos, contas conjuntas, declaração de testemunhas, residência, filhos em comum).",
        recommendation: "Adicionar: certidão de casamento, fotos juntos, conta bancária conjunta, contratos de aluguel/cartões, declarações de amigos."
      });
    }
  }

  // Good moral character
  if (story && (story.good_moral_character_concerns ?? []).length > 0) {
    out.push({
      severity: "alta", tier: "tier2_substantivo", category: "elegibilidade",
      field: "Good moral character — pontos de atenção", form: null,
      explanation: "Pontos de atenção em good moral character: " + story.good_moral_character_concerns.join("; ")
    });
  }
  if (i360.good_moral_character_declared === false) {
    out.push({
      severity: "alta", tier: "tier1_filing", category: "campo_vazio",
      field: "Good Moral Character declaration", form: "I-360",
      explanation: "I-360 não contém declaração afirmativa de good moral character (últimos 3 anos)."
    });
  }

  // Concordância história × form
  if (story && i360.marriage_date && story.marriage_date) {
    if (story.marriage_date !== i360.marriage_date) {
      out.push({
        severity: "alta", tier: "tier2_substantivo", category: "divergencia",
        field: "Data de casamento", form: "I-360",
        expected: `${story.marriage_date} (história)`,
        found: `${i360.marriage_date} (I-360)`,
        explanation: "Data de casamento diverge entre história e I-360."
      });
    }
  }
  if (story && i360.abuser_name && story.abuser_name) {
    if (story.abuser_name.toLowerCase().trim() !== i360.abuser_name.toLowerCase().trim()) {
      out.push({
        severity: "critica", tier: "tier2_substantivo", category: "divergencia",
        field: "Nome do abusador", form: "I-360",
        expected: `${story.abuser_name} (história)`,
        found: `${i360.abuser_name} (I-360)`,
        explanation: "Nome do abusador diverge entre história e I-360."
      });
    }
  }

  return out;
}
