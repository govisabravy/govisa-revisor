import Anthropic from "@anthropic-ai/sdk";
import type { FormData, StoryFacts } from "../schemas/forms";

export type DocKind =
  | "cover_letter"
  | "I-914"
  | "I-914A"
  | "I-914B"
  | "I-192"
  | "I-765"
  | "G-28"
  | "identification"
  | "country_conditions"
  | "witness_statements"
  | "medical_records"
  | "story"
  | "final"
  | "other";

export interface StructureDocument {
  kind: DocKind;
  label: string;
  startPage: number;
  endPage: number;
}

export interface DocumentStructure {
  documents: StructureDocument[];
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey && !authToken) {
    throw new Error(
      "Falta ANTHROPIC_API_KEY (ou ANTHROPIC_AUTH_TOKEN) no ambiente."
    );
  }
  return new Anthropic({
    apiKey: apiKey ?? "placeholder",
    authToken
  });
}

function stripJsonFences(txt: string): string {
  const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : txt).trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callWithRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      if (status === 429 || status === 529 || status === 503) {
        const retryAfter = Number(err?.headers?.["retry-after"]) || 0;
        const wait = Math.max(retryAfter * 1000, 1500 * Math.pow(2, i));
        console.warn(
          `Rate limit ${status}. Aguardando ${wait}ms (tentativa ${i + 1}/${attempts})`
        );
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export interface UsageEvent {
  operation: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  duration_ms: number;
  attempts: number;
  had_pdf: boolean;
  ok: boolean;
  error?: string;
}

const usageListeners = new Set<(e: UsageEvent) => void>();
export function onUsage(listener: (e: UsageEvent) => void) {
  usageListeners.add(listener);
  return () => usageListeners.delete(listener);
}

async function callJsonWithDocument<T>(opts: {
  systemBlocks: Array<{ type: "text"; text: string; cacheControl?: boolean }>;
  pdfBase64?: string;
  userText: string;
  maxTokens?: number;
  operation?: string;
}): Promise<T> {
  const client = getClient();

  const system = opts.systemBlocks.map((b) => {
    const block: any = { type: "text", text: b.text };
    if (b.cacheControl) block.cache_control = { type: "ephemeral" };
    return block;
  });

  const content: any[] = [];
  if (opts.pdfBase64) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: opts.pdfBase64 }
    });
  }
  content.push({ type: "text", text: opts.userText });

  const started = Date.now();
  let attempts = 0;
  let res: any;
  let caughtErr: any;
  try {
    res = await callWithRetry(() => {
      attempts++;
      return client.messages.create({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 4096,
        system,
        messages: [{ role: "user", content }]
      });
    });
  } catch (err) {
    caughtErr = err;
  }

  const event: UsageEvent = {
    operation: opts.operation ?? "unknown",
    model: MODEL,
    input_tokens: res?.usage?.input_tokens ?? 0,
    output_tokens: res?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: res?.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: res?.usage?.cache_read_input_tokens ?? 0,
    duration_ms: Date.now() - started,
    attempts,
    had_pdf: !!opts.pdfBase64,
    ok: !caughtErr,
    error: caughtErr ? String(caughtErr?.message ?? caughtErr) : undefined
  };
  for (const l of usageListeners) {
    try {
      l(event);
    } catch {}
  }
  if (caughtErr) throw caughtErr;

  const textBlock = res.content.find((b: any) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude não retornou texto");
  }
  const raw = stripJsonFences(textBlock.text);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Resposta do Claude não é JSON válido: ${raw.slice(0, 300)}`);
  }
}

const STRUCTURE_SYSTEM = `Você é um especialista em processos USCIS de visto T (vítima de tráfico humano) montados pela Go Visa Law Firm.

Sua tarefa: dado um índice numerado com o início de cada página de um processo compilado, determinar o RANGE DE PÁGINAS de cada documento interno.

Documentos esperados (os que estiverem presentes):
- cover_letter: carta de apresentação do advogado
- I-914: formulário principal (Application for T Nonimmigrant Status)
- I-914A: Supplement A — Application for Family Member of T-1 Recipient (um por familiar)
- I-914B: Supplement B — Declaration of Law Enforcement Officer
- I-192: Application for Advance Permission to Enter as Nonimmigrant
- I-765: Application for Employment Authorization
- G-28: Notice of Entry of Appearance as Attorney (pode haver múltiplos, um por requerente)
- identification: cópias de passaporte, documentos de ID
- country_conditions: material sobre condições do país de origem
- witness_statements: declarações de testemunhas, declarações juramentadas
- medical_records: registros médicos e psicológicos
- story: Declaration of <nome> / Personal Statement / Applicant's Statement (história escrita do cliente em primeira pessoa)
- final: final considerations
- other: qualquer coisa que não se encaixe

REGRAS CRÍTICAS:
- Ignore a Table of Contents (primeiras páginas); mapeie somente os documentos reais.
- O I-914A tem no rodapé "Form I-914 Supplement A" e começa com "Application for Family Member of T-1 Recipient". NÃO o confunda com I-914.
- O I-914B tem no rodapé "Form I-914 Supplement B" e começa com "Declaration of Law Enforcement Officer". NÃO o confunda com I-914.
- Cada form USCIS tem rodapé "Page N of M" — use isso pra saber quando um form termina.
- A "story" (Declaration of <nome>) é uma narrativa em primeira pessoa do cliente, geralmente 2-20 páginas, NÃO é um formulário USCIS.
- Devolva SOMENTE JSON válido.`;

export async function mapDocumentStructure(pageHeads: string[]): Promise<DocumentStructure | null> {
  const index = pageHeads
    .map((head, i) => `PG ${i + 1}: ${head.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  try {
    return await callJsonWithDocument<DocumentStructure>({
      systemBlocks: [{ type: "text", text: STRUCTURE_SYSTEM, cacheControl: true }],
      userText: `Abaixo o índice do processo (início de cada página). Devolva SOMENTE JSON:

{
  "documents": [
    { "kind": "<tipo>", "label": "<breve descrição ex: I-914 do Kaique>", "startPage": <n>, "endPage": <n> }
  ]
}

Liste os documentos em ordem de aparição. Se houver múltiplos I-914A (um por familiar) ou múltiplos G-28, liste cada um separado.

ÍNDICE:
${index.slice(0, 180000)}`,
      maxTokens: 4000,
      operation: "mapDocumentStructure"
    });
  } catch (err) {
    console.error("Falha mapeando estrutura:", err);
    return null;
  }
}

const FORM_EXTRACTOR_SYSTEM = `Você é um extrator de dados de formulários USCIS (imigração EUA) do tipo visto T (tráfico humano).

Você recebe o PDF de UM formulário específico de um processo jurídico e devolve JSON com os campos extraídos.

REGRAS:
- Devolva SOMENTE JSON válido, sem comentários nem texto antes ou depois.
- Se um campo não aparecer, use null (não invente).
- Datas no formato YYYY-MM-DD quando possível; caso contrário, devolva como aparece no documento.
- Não traduza nomes próprios ou endereços.
- Endereços devem preservar abreviações (Ste, Apt, Flr) e formatação original.
- "In Care Of Name" é campo específico de Safe Mailing Address — não confunda com nome da pessoa.
- Use a visão quando a extração de texto falhar (campos manuscritos, caixas de seleção, assinaturas).`;

const META_SHAPE = `"meta": {
    "edition_date": string|null,
    "applicant_signature": { "signed": boolean|null, "name_printed": string|null, "date_signed": string|null },
    "interpreter_used": boolean|null,
    "interpreter_signature": { "signed": boolean|null, "name_printed": string|null, "date_signed": string|null },
    "preparer_used": boolean|null,
    "preparer_signature": { "signed": boolean|null, "name_printed": string|null, "date_signed": string|null }
  }`;

const FORM_SHAPES: Record<string, string> = {
  "I-914": `{
  "form": "I-914",
  ${META_SHAPE},
  "person": {
    "family_name": string|null, "given_name": string|null, "middle_name": string|null,
    "other_names": string[], "date_of_birth": string|null,
    "country_of_birth": string|null, "country_of_citizenship": string|null,
    "gender": string|null, "marital_status": string|null,
    "a_number": string|null, "uscis_online_account": string|null, "ssn": string|null,
    "passport_number": string|null, "passport_country": string|null,
    "passport_issue_date": string|null, "passport_expiration_date": string|null,
    "passport_signed": boolean|null
  },
  "physical_address": { "in_care_of": null, "street": string|null, "apt_ste_flr": "Apt|Ste|Flr"|null, "apt_number": string|null, "city": string|null, "state": string|null, "zip": string|null, "country": string|null },
  "mailing_address": {...} | null,
  "safe_mailing_address": { "in_care_of": string|null, ...} | null,
  "entry": {
    "last_entry_date": string|null, "last_entry_place": string|null, "last_entry_status": string|null,
    "i94_number": string|null, "status_at_entry": string|null, "visa_used": string|null,
    "expiration_of_authorized_stay": string|null,
    "entered_ewi": boolean|null,
    "travel_history": [{"date": string|null, "direction": "entry|exit"|null, "port": string|null}]
  } | null,
  "family_members_included": [{ "relationship": string|null, "name": string|null, "date_of_birth": string|null, "marital_status": "single|married|divorced|widowed"|null }],
  "inadmissibilities_checked": string[],
  "prior_applications": [{"type": string|null, "outcome": string|null, "date": string|null}],
  "removal_proceedings": boolean|null,
  "criminal_history_disclosed": boolean|null
}

Dicas pro I-914:
- "entered_ewi" = true se a pessoa entrou sem inspeção (EWI) nos EUA.
- "inadmissibilities_checked" = grounds marcados/mencionados nas perguntas de admissibilidade.
- "removal_proceedings" = true se indicou estar em processo de remoção.`,
  "I-914A": `{
  "form": "I-914A",
  ${META_SHAPE},
  "principal_applicant": { "family_name": string|null, "given_name": string|null, "a_number": string|null, "date_of_birth": string|null },
  "family_member": {
    "family_name": string|null, "given_name": string|null, "middle_name": string|null,
    "date_of_birth": string|null, "country_of_birth": string|null,
    "country_of_citizenship": string|null, "gender": string|null, "marital_status": string|null,
    "passport_number": string|null, "passport_issue_date": string|null, "passport_expiration_date": string|null
  },
  "relationship_to_principal": string|null,
  "relationship_start_date": string|null,
  "relationship_evidence_mentioned": string[],
  "location": "US|abroad"|null,
  "physical_address": {...},
  "safe_mailing_address": {...}|null
}

"location" = "US" se a pessoa está nos EUA, "abroad" se está no exterior.`,
  "I-914B": `{
  "form": "I-914B",
  ${META_SHAPE},
  "law_enforcement_agency": string|null,
  "agency_type": string|null,
  "is_qualifying_agency": boolean|null,
  "officer_name": string|null,
  "officer_title": string|null,
  "officer_signature": { "signed": boolean|null, "name_printed": string|null, "date_signed": string|null },
  "victim_name": string|null,
  "signed_date": string|null,
  "part2_filled": boolean|null,
  "part2_fields_filled": string[]
}

IMPORTANTE para I-914B:
- Part 1 é sobre a VÍTIMA (nome, A-Number, etc).
- Part 2 é sobre o AGENTE DA LEI (Law Enforcement Officer) que assina — tipicamente preenchido pelo órgão, NUNCA deve ser pré-preenchido pelo advogado.
- "part2_filled" = true se QUALQUER campo de Part 2 (Officer Name, Agency, Title, Signature, etc.) estiver preenchido; false se estiver totalmente em branco; null se ambíguo.
- "part2_fields_filled" = lista de campos de Part 2 que você viu preenchidos (ex: ["Officer Full Name", "Agency Name"]).`,
  "I-192": `{
  "form": "I-192",
  ${META_SHAPE},
  "person": { ...mesmo shape do I-914.person... },
  "physical_address": {...},
  "safe_mailing_address": {...}|null,
  "grounds_of_inadmissibility": string[],
  "waiver_justification_summary": string|null
}

Para "grounds_of_inadmissibility" liste os motivos marcados no form (ex: "INA 212(a)(6)(A) - entered without inspection", "INA 212(a)(9)(B) - unlawful presence", etc.).`,
  "I-765": `{
  "form": "I-765",
  ${META_SHAPE},
  "person": { ...mesmo shape do I-914.person... },
  "physical_address": {...},
  "mailing_address": {...}|null,
  "eligibility_category": string|null,
  "last_employer": string|null,
  "is_for_principal": boolean|null,
  "category_valid_for_t_visa": boolean|null
}

Categorias válidas em T-visa:
- (c)(25) = T-1 principal; (a)(16) = T-1 ajustando; (c)(25) também cobre alguns; para T-2/3/4/5 derivativos os códigos variam.
- "is_for_principal" = true se o I-765 é do aplicante principal (T-1), false se é de derivativo.
- "category_valid_for_t_visa" = true se a categoria informada faz sentido para T-visa; false se é categoria errada (ex: c(8) asylum).`,
  "G-28": `{
  "form": "G-28",
  ${META_SHAPE},
  "attorney_name": string|null,
  "attorney_firm": string|null,
  "attorney_address": {...},
  "attorney_signature": { "signed": boolean|null, "name_printed": string|null, "date_signed": string|null },
  "client_name": string|null,
  "client_a_number": string|null,
  "client_signature": { "signed": boolean|null, "name_printed": string|null, "date_signed": string|null },
  "signed_date": string|null
}

ATENÇÃO G-28: precisa assinatura TANTO do advogado QUANTO do cliente. Verifique ambas.`
};

export async function extractFormFromPdf(args: {
  formKind: string;
  pdfBase64: string;
}): Promise<FormData | null> {
  const shape = FORM_SHAPES[args.formKind] ?? FORM_SHAPES["I-914"];
  try {
    return await callJsonWithDocument<FormData>({
      systemBlocks: [{ type: "text", text: FORM_EXTRACTOR_SYSTEM, cacheControl: true }],
      pdfBase64: args.pdfBase64,
      userText: `Formulário: ${args.formKind}

Devolva SOMENTE JSON seguindo este shape (campos ausentes viram null):

${shape}`,
      maxTokens: 4096,
      operation: `extractFormFromPdf:${args.formKind}`
    });
  } catch (err) {
    console.error(`Falha extraindo ${args.formKind}:`, err);
    return null;
  }
}

export async function extractFormFromText(args: {
  formKind: string;
  text: string;
  pdfBase64?: string;
}): Promise<FormData | null> {
  const shape = FORM_SHAPES[args.formKind] ?? FORM_SHAPES["I-914"];
  try {
    return await callJsonWithDocument<FormData>({
      systemBlocks: [{ type: "text", text: FORM_EXTRACTOR_SYSTEM, cacheControl: true }],
      pdfBase64: args.pdfBase64,
      userText: `Formulário: ${args.formKind}

Shape do JSON (campos ausentes viram null):
${shape}

${args.pdfBase64 ? "Use a visão no PDF anexo para verificar campos preenchidos, marcações e assinaturas." : ""}

TEXTO DO FORMULÁRIO (extraído do PDF):
"""
${args.text.slice(0, 14000)}
"""

Devolva SOMENTE JSON.`,
      maxTokens: 4096,
      operation: `extractFormFromText:${args.formKind}`
    });
  } catch (err) {
    console.error(`Falha extraindo ${args.formKind} (texto):`, err);
    return null;
  }
}

const STORY_EXTRACTOR_SYSTEM = `Você é um extrator de fatos narrativos de histórias de clientes de imigração (visto T).
Leia a narrativa do cliente (Declaration/Personal Statement) e extraia fatos que o cliente AFIRMOU sobre si.
Devolva SOMENTE JSON válido. Use null para fatos não mencionados. Não invente nada.`;

export async function extractStoryFromText(args: {
  text: string;
  pdfBase64?: string;
}): Promise<StoryFacts | null> {
  const { text, pdfBase64 } = args;
  try {
    return await callJsonWithDocument<StoryFacts>({
      systemBlocks: [{ type: "text", text: STORY_EXTRACTOR_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `HISTÓRIA DO CLIENTE (texto extraído do PDF, pode estar incompleto se for imagem escaneada — use também a visão no PDF anexo):
"""
${text.slice(0, 20000)}
"""

Devolva SOMENTE JSON:
{
  "full_name": string|null,
  "date_of_birth": string|null,
  "country_of_origin": string|null,
  "marital_status": "solteiro|casado|divorciado|viuvo|uniao_estavel"|null,
  "spouse_name": string|null,
  "children": [{"name": string|null, "date_of_birth": string|null, "marital_status": "single|married|divorced|widowed"|null}],
  "year_entered_us": string|null,
  "port_of_entry": string|null,
  "entry_method": string|null,
  "employers_mentioned": string[],
  "cities_lived_in_us": string[],
  "passport_number_mentioned": string|null,
  "key_dates": [{"event": string, "date": string}],

  "trafficking_type": "sex|labor|both|unclear"|null,
  "force_mentioned": boolean|null,
  "force_examples": string[],
  "fraud_mentioned": boolean|null,
  "fraud_examples": string[],
  "coercion_mentioned": boolean|null,
  "coercion_examples": string[],
  "traffickers_identified": string[],
  "trafficking_locations": string[],
  "physical_presence_on_account_of_trafficking": boolean|null,
  "cooperation_with_lea_mentioned": boolean|null,
  "cooperation_details": string|null,
  "cooperation_exempt_reason": string|null,
  "extreme_hardship_mentioned": boolean|null,
  "hardship_reasons": string[],
  "fears_returning": boolean|null,
  "prior_immigration_history": string|null,
  "trauma_described": boolean|null,
  "document_confiscation_mentioned": boolean|null,
  "debt_bondage_mentioned": boolean|null,
  "isolation_mentioned": boolean|null
}

Analise a narrativa como um advogado de imigração sênior verificando elegibilidade ao T-visa:
- "trafficking_type": sexo / trabalho / ambos / unclear.
- "force_mentioned" / "fraud_mentioned" / "coercion_mentioned": um dos três é obrigatório pra caracterizar severe form of trafficking. Retorne true se há exemplos concretos.
- "physical_presence_on_account_of_trafficking": o cliente está nos EUA por causa do tráfico?
- "cooperation_with_lea_mentioned": cooperou com law enforcement? Se exempt (menor de idade ou trauma severo), marcar "cooperation_exempt_reason".
- "extreme_hardship_mentioned": se retornar ao país de origem, sofreria unusual and severe harm? Liste motivos.
- "document_confiscation" / "debt_bondage" / "isolation": indicadores clássicos de tráfico.`,
      maxTokens: 4000,
      operation: "extractStoryFromText"
    });
  } catch (err) {
    console.error("Falha extraindo história:", err);
    return null;
  }
}

const WITNESS_SYSTEM = `Você é um advogado de imigração analisando Witness Statements em um processo T-visa.
Cada declaração deve: ter nome e assinatura da testemunha, data, cláusula "under penalty of perjury" (28 U.S.C. §1746 ou similar), e atestar fatos específicos relevantes (não apenas "é boa pessoa").
Devolva SOMENTE JSON válido.`;

export async function analyzeWitnessStatements(pdfBase64: string): Promise<import("../schemas/forms").WitnessStatementsAnalysis | null> {
  try {
    return await callJsonWithDocument({
      systemBlocks: [{ type: "text", text: WITNESS_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise as witness statements no PDF anexo. Devolva JSON:

{
  "statements_found": number,
  "items": [{
    "witness_name": string|null,
    "relationship_to_applicant": string|null,
    "signed": boolean|null,
    "dated": boolean|null,
    "has_perjury_clause": boolean|null,
    "attests_specific_facts": boolean|null,
    "topics_covered": string[],
    "concerns": string[]
  }]
}

Para "attests_specific_facts", true se a declaração contém fatos concretos (datas, eventos, diálogos, observações diretas). Se for apenas uma carta de caráter ("é boa pessoa"), false.
Para "concerns", liste problemas: falta de assinatura, falta de perjury clause, declaração vaga, testemunha identificada apenas por apelido, etc.`,
      maxTokens: 3000,
      operation: "analyzeWitnessStatements"
    });
  } catch (err) {
    console.error("Falha analisando witness statements:", err);
    return null;
  }
}

const MEDICAL_SYSTEM = `Você é um advogado de imigração analisando Medical and Psychological Records em um processo T-visa.
Bom suporte: avaliação por profissional LICENCIADO (psicólogo, psiquiatra, MD), diagnóstico em termos DSM-5 (ex: PTSD, MDD, GAD), nexo explícito com o trafficking event, assinada, datada.
Devolva SOMENTE JSON válido.`;

export async function analyzeMedicalRecords(pdfBase64: string): Promise<import("../schemas/forms").MedicalAnalysis | null> {
  try {
    return await callJsonWithDocument({
      systemBlocks: [{ type: "text", text: MEDICAL_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise os registros médicos/psicológicos. Devolva JSON:

{
  "evaluations_found": number,
  "items": [{
    "provider_name": string|null,
    "provider_credential": string|null,
    "licensed_professional": boolean|null,
    "dsm5_diagnosis": string[],
    "nexus_to_trafficking": boolean|null,
    "dated": boolean|null,
    "signed": boolean|null,
    "concerns": string[]
  }]
}

"licensed_professional" = true se profissional tem credencial licenciada (PhD, PsyD, LCSW, MD, LMHC, etc.). Social workers sem licensing não servem pra hardship.
"nexus_to_trafficking" = true se a avaliação conecta o diagnóstico aos eventos de tráfico (não apenas "apresenta sintomas de ansiedade").`,
      maxTokens: 3000,
      operation: "analyzeMedicalRecords"
    });
  } catch (err) {
    console.error("Falha analisando medical:", err);
    return null;
  }
}

const COUNTRY_SYSTEM = `Você é um advogado de imigração analisando o material de General Country Conditions em um processo T-visa.
Boa evidência: fontes respeitáveis (DOS Country Reports, Human Rights Watch, Amnesty, UNODC, GAO), recentes (últimos 2-3 anos), cobrindo tópicos relevantes ao hardship do cliente (re-trafficking risk, falta de mental health care, retaliação, impunidade de traficantes).
Devolva SOMENTE JSON válido.`;

export async function analyzeCountryConditions(pdfBase64: string): Promise<import("../schemas/forms").CountryConditionsAnalysis | null> {
  try {
    return await callJsonWithDocument({
      systemBlocks: [{ type: "text", text: COUNTRY_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise o Country Conditions. Devolva JSON:

{
  "country": string|null,
  "sources_cited": string[],
  "topics_covered": string[],
  "relevant_to_hardship": boolean|null,
  "addresses_re_trafficking_risk": boolean|null,
  "addresses_mental_health_care_access": boolean|null,
  "date_range": string|null,
  "concerns": string[]
}

"concerns" pode incluir: fontes obsoletas (> 3 anos), fontes não respeitáveis, falta de conexão explícita com hardship do cliente, tópicos faltantes.`,
      maxTokens: 2500,
      operation: "analyzeCountryConditions"
    });
  } catch (err) {
    console.error("Falha analisando country conditions:", err);
    return null;
  }
}

const LEA_QUAL_SYSTEM = `Você é um advogado de imigração analisando o I-914B (Declaration of Law Enforcement Officer).
Agências qualificadas: federal (ICE/HSI, FBI, DOJ, DOL, EEOC), state/local police, state AG, prosecutors, state Labor agencies, child protective services.
NÃO qualificadas: social workers, advogados, ONGs, agências religiosas.
Parte 2 é do oficial — deve ser preenchida PELA AGÊNCIA, não pelo advogado.
Devolva SOMENTE JSON válido.`;

export async function analyzeI914BQualification(pdfBase64: string): Promise<import("../schemas/forms").LeaQualification | null> {
  try {
    return await callJsonWithDocument({
      systemBlocks: [{ type: "text", text: LEA_QUAL_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise o I-914B. Devolva JSON:

{
  "agency_name": string|null,
  "is_federal_law_enforcement": boolean|null,
  "is_state_or_local_law_enforcement": boolean|null,
  "is_qualifying_agency": boolean|null,
  "officer_name": string|null,
  "officer_title": string|null,
  "officer_signed": boolean|null,
  "signed_date": string|null,
  "part2_filled": boolean|null,
  "part2_fields_filled": string[]
}

Se nome da agência for um nome de PESSOA FÍSICA (ex: "João da Silva"), isso é erro — provavelmente o advogado preencheu com nome do cliente. is_qualifying_agency=false.`,
      maxTokens: 2000,
      operation: "analyzeI914BQualification"
    });
  } catch (err) {
    console.error("Falha qualificando LEA:", err);
    return null;
  }
}

const TRANSLATION_SYSTEM = `Você verifica se documentos estrangeiros em um processo USCIS têm certified translation anexada.

Regra USCIS (8 CFR 103.2(b)(3)): documentos em língua estrangeira exigem tradução completa em inglês + Certificate of Translation assinado pelo tradutor.

EXCEÇÕES (NÃO precisam de tradução certificada):
- Passaportes estrangeiros (biometric page): USCIS aceita passaportes na língua original; não precisam ser traduzidos.
- Carteiras de identidade oficiais (RG, cédula de identidade, national ID card): quando apenas a foto é usada como evidência de identidade, tradução é dispensada.
- Documentos já emitidos em inglês.

DEVEM ser traduzidos:
- Certidões de nascimento, casamento, divórcio, óbito
- Boletins de ocorrência, police reports
- Registros escolares, diplomas, históricos
- Documentos trabalhistas, carteira de trabalho
- Atestados médicos em outra língua
- Contratos e correspondências
- Qualquer documento substantivo em língua estrangeira

Devolva SOMENTE JSON válido. Considere a exceção de passaporte ao listar concerns.`;

export async function checkCertifiedTranslations(pdfBase64: string): Promise<import("../schemas/forms").TranslationsCheck | null> {
  try {
    return await callJsonWithDocument({
      systemBlocks: [{ type: "text", text: TRANSLATION_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise este sub-PDF em busca de documentos que REQUEREM certified translation.

EXCLUA da análise:
- Passaportes (qualquer página)
- Carteiras de identidade oficiais (RG, cédula, national ID) quando usadas só pra identificação
- Documentos já em inglês

INCLUA:
- Certidões (nascimento, casamento, divórcio, óbito)
- Boletins de ocorrência / police reports
- Registros médicos/escolares/trabalhistas em língua estrangeira
- Contratos, cartas, declarações em outra língua

Para cada documento INCLUÍDO, verifique se tem:
1. Tradução completa em inglês
2. Certificate of Translation (declaração do tradutor)

Devolva JSON:
{
  "foreign_documents_count": number,
  "documents_with_certified_translation": number,
  "documents_without_translation": string[],
  "concerns": string[]
}

IMPORTANTE: "documents_without_translation" NÃO deve incluir passaportes nem IDs. Se você só viu passaporte, "foreign_documents_count" = 0.`,
      maxTokens: 1500,
      operation: "checkCertifiedTranslations"
    });
  } catch (err) {
    console.error("Falha checando traduções:", err);
    return null;
  }
}

const PASSPORT_CHECKER_SYSTEM = `Você analisa a seção "Identification Documents" de um processo USCIS.
Sua tarefa: verificar se o passaporte do cliente tem a ASSINATURA DO TITULAR preenchida.
O passaporte tem um campo específico ("Assinatura do titular / Signature of bearer / Signature du titulaire").
Use a visão para olhar a página de dados do passaporte.
Seja estrito: só afirme que está assinado se CONSEGUIR VER traço/rubrica manuscrita.
Devolva SOMENTE JSON válido.`;

export interface PassportSignatureCheck {
  has_passport_image: boolean;
  signed: boolean | null;
  passport_number_seen: string | null;
  holder_name_seen: string | null;
  notes: string | null;
}

export async function checkPassportSignatureFromPdf(
  pdfBase64: string
): Promise<PassportSignatureCheck | null> {
  try {
    return await callJsonWithDocument<PassportSignatureCheck>({
      systemBlocks: [
        { type: "text", text: PASSPORT_CHECKER_SYSTEM, cacheControl: true }
      ],
      pdfBase64,
      userText: `Procure a página de dados do passaporte nas páginas deste sub-PDF. Devolva SOMENTE JSON:

{
  "has_passport_image": boolean,
  "signed": boolean | null,
  "passport_number_seen": string | null,
  "holder_name_seen": string | null,
  "notes": string | null
}

Regras:
- has_passport_image = true se você vê uma cópia do passaporte.
- signed = true apenas se você VÊ um traço/rubrica no campo de assinatura do titular. false se o campo está visivelmente em branco. null se ilegível/ambíguo.
- passport_number_seen = número lido da imagem.
- holder_name_seen = nome lido na página de dados.
- notes = observação curta.`,
      maxTokens: 800,
      operation: "checkPassportSignature"
    });
  } catch (err) {
    console.error("Falha na checagem visual do passaporte:", err);
    return null;
  }
}
