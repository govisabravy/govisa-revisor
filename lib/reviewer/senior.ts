import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  Finding,
  Subject,
  ProofOfAddressAnalysis,
  StoryFacts,
  WitnessStatementsAnalysis,
  MedicalAnalysis,
  CountryConditionsAnalysis,
  FormData,
  TranslationsCheck,
  LeaQualification
} from "../schemas/forms";
import type { VawaStoryFacts, I360Form } from "../schemas/vawa";
import type {
  I918Form,
  I918AForm,
  I918BForm,
  UVisaStoryFacts
} from "../schemas/uvisa";
import type { PassportSignatureCheck, UsageEvent } from "./claude";
import { onUsage, emitUsage } from "./claude";
import { stripJsonFences } from "./json-utils";

// Senior pass é best-effort. Pode ser desabilitado por env.
const SENIOR_PASS_ENABLED = process.env.REVIEWER_SENIOR_PASS !== "off";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

// Compat: alguns consumidores legados podem usar onSeniorUsage. Mantemos a API
// pública, mas agora ela apenas delega ao canal unificado em claude.ts. Todos
// os eventos do senior pass agora são emitidos via emitUsage() do claude.ts,
// garantindo que cheguem ao listener central registrado em reviewProcess e,
// portanto, sejam persistidos em usage_events.
export function onSeniorUsage(listener: (e: UsageEvent) => void) {
  return onUsage(listener);
}

// =============================================================================
// Helpers de diagnóstico de response Opus
// =============================================================================
//
// Quando o Opus 4.7 roda com `thinking: { type: "adaptive" }`, ocasionalmente
// devolve um content array contendo APENAS bloco `thinking` (sem `text` nem
// `tool_use`). Antes esse caso virava `[]` silencioso. Agora distinguimos:
// se tinha bloco de thinking, registramos como falha real com diagnóstico
// rico, e o caller pode optar por retentar sem thinking.

interface ResponseDiagnostic {
  has_text: boolean;
  has_tool_use: boolean;
  has_thinking: boolean;
  content_types: string[];
  stop_reason: string | null;
  output_tokens: number;
  text_preview: string | null;
}

function diagnoseResponse(res: any, toolName?: string): ResponseDiagnostic {
  const content: any[] = res?.content ?? [];
  const types: string[] = content.map((b: any) => b?.type ?? "unknown");
  const textBlock = content.find((b: any) => b?.type === "text");
  const toolBlock = toolName
    ? content.find((b: any) => b?.type === "tool_use" && b?.name === toolName)
    : content.find((b: any) => b?.type === "tool_use");
  const text =
    textBlock && typeof textBlock.text === "string" ? textBlock.text : null;
  return {
    has_text: !!textBlock && typeof textBlock?.text === "string",
    has_tool_use: !!toolBlock,
    has_thinking: types.includes("thinking"),
    content_types: types,
    stop_reason: res?.stop_reason ?? null,
    output_tokens: res?.usage?.output_tokens ?? 0,
    text_preview: text ? text.slice(0, 500) : null
  };
}

function diagnosticToErrorMsg(d: ResponseDiagnostic, prefix: string): string {
  const parts = [
    prefix,
    `stop_reason=${d.stop_reason ?? "unknown"}`,
    `content_types=[${d.content_types.join(",")}]`,
    `output_tokens=${d.output_tokens}`,
    `has_text=${d.has_text}`,
    `has_tool_use=${d.has_tool_use}`,
    `has_thinking=${d.has_thinking}`
  ];
  if (d.text_preview) {
    parts.push(`text_preview=${JSON.stringify(d.text_preview)}`);
  }
  return parts.join(" | ").slice(0, 1500);
}

function buildSeniorUsageEvent(args: {
  res: any;
  startedAt: number;
  attempts: number;
  caughtErr: any;
  errorOverride?: string;
}): UsageEvent {
  const { res, startedAt, attempts, caughtErr, errorOverride } = args;
  const errStr = errorOverride
    ? errorOverride
    : caughtErr
      ? String(caughtErr?.message ?? caughtErr).slice(0, 1500)
      : undefined;
  return {
    operation: "seniorCrossCheck",
    model: MODEL,
    input_tokens: res?.usage?.input_tokens ?? 0,
    output_tokens: res?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: res?.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: res?.usage?.cache_read_input_tokens ?? 0,
    duration_ms: Date.now() - startedAt,
    attempts,
    had_pdf: false,
    ok: !caughtErr && !errorOverride,
    error: errStr
  };
}

function buildAdversarialUsageEvent(args: {
  res: any;
  startedAt: number;
  attempts: number;
  caughtErr: any;
  errorOverride?: string;
}): UsageEvent {
  const { res, startedAt, attempts, caughtErr, errorOverride } = args;
  const errStr = errorOverride
    ? errorOverride
    : caughtErr
      ? String(caughtErr?.message ?? caughtErr).slice(0, 1500)
      : undefined;
  return {
    operation: "adversarialReview",
    model: MODEL,
    input_tokens: res?.usage?.input_tokens ?? 0,
    output_tokens: res?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: res?.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: res?.usage?.cache_read_input_tokens ?? 0,
    duration_ms: Date.now() - startedAt,
    attempts,
    had_pdf: false,
    ok: !caughtErr && !errorOverride,
    error: errStr
  };
}

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
    authToken,
    // timeout no construtor: o guard "Streaming is strongly recommended" do SDK
    // so e suprimido por _options.timeout do client; timeout per-request nao evita o throw
    timeout: 600_000
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callWithRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
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
          `[seniorCrossCheck] Rate limit ${status}. Aguardando ${wait}ms (tentativa ${i + 1}/${attempts})`
        );
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export interface SeniorInput {
  caseType: "t_visa" | "u_visa" | "vawa";
  subjects: Subject[];
  formsBySubject: Record<string, FormData[]>;
  i360?: I360Form | null;
  vawaStory?: VawaStoryFacts | null;
  i918?: I918Form | null;
  i918as?: I918AForm[];
  i918b?: I918BForm | null;
  uvisaStory?: UVisaStoryFacts | null;
  tStory?: StoryFacts | null;
  passportChecks?: Array<{ subject_id: string | null; check: PassportSignatureCheck }>;
  witnessAnalysis?: WitnessStatementsAnalysis | null;
  medicalAnalysis?: MedicalAnalysis | null;
  countryAnalysis?: CountryConditionsAnalysis | null;
  leaQualification?: LeaQualification | null;
  translations?: TranslationsCheck | null;
  proofOfAddress?: ProofOfAddressAnalysis | null;
  mode?: "draft" | "final";
}

// Normalizador: LLM frequentemente devolve "média"/"crítica" com acento.
// Converte pra forma canônica antes do enum check.
function stripDiacritics(s: unknown): unknown {
  if (typeof s !== "string") return s;
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const SeniorOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        severity: z.preprocess(stripDiacritics, z.enum(["critica", "alta", "media", "baixa"])),
        tier: z.enum(["tier1_filing", "tier2_substantivo", "tier3_estrategico"]),
        // category opcional na entrada — forçamos "cross_narrative" no output
        category: z.literal("cross_narrative").optional().default("cross_narrative"),
        field: z.string(),
        form: z.string().nullable().optional(),
        expected: z.string().nullable().optional(),
        found: z.string().nullable().optional(),
        source: z.string(),
        explanation: z.string(),
        recommendation: z.string().nullable().optional(),
        rule_id: z.string().regex(/^SENIOR_/),
        subject_id: z.string().nullable().optional()
      })
    )
});

const SENIOR_SYSTEM = `Você é um advogado de imigração SÊNIOR especializado em T-visa, U-visa e VAWA, revisando um filing montado pela Go Visa Law Firm. Você revisa milhares de casos por ano e tem padrão de raciocínio próximo de adjudicador USCIS.

Você recebe o caso JÁ EXTRAÍDO em formato estruturado:
- subjects: lista de pessoas (principal + dependentes)
- forms_by_subject: forms agrupados por sujeito
- story_facts: extração da declaração do cliente
- witness_analysis, medical_analysis, country_analysis, passport_checks: análises

REGRAS CRÍTICAS:
0. **MODO DRAFT**: se a tag "# Modo: draft" aparecer no caso, NÃO emita findings sobre:
   - Assinaturas faltando (applicant_signature, attorney_signature, interpreter, preparer, officer)
   - Datas de assinatura faltando
   - G-28 sem assinatura
   - I-914B/I-918B sem assinatura do officer
   Em draft, todos os campos signed:null/false são esperados (assinaturas são coletadas no final). Só emit findings de assinatura se o modo for "final".
1. Você NÃO está fazendo extração — os dados já estão extraídos. Sua tarefa é ENCONTRAR INCONSISTÊNCIAS SUTIS entre os blocos.
2. CADA finding DEVE citar a peça específica onde está ancorado (campo "source"). Ex: "story.traffickers_identified vs witness_analysis.items[0].topics_covered".
3. NÃO invente fatos. Se não há evidência clara nos dados, NÃO emita finding.
4. Foque em coisas que regras determinísticas não pegam:
   - Testemunha menciona traficante diferente da história (se a story diz X é traficante e witness fala de Y como agressor, é red flag)
   - Diagnóstico médico incompatível com tipo de tráfico (PTSD esperado em sex trafficking; só MDD/anxiety é fraco para esse tipo; labor pode ter padrão diferente)
   - Travel history do I-914 inconsistente com cronologia da story (cliente diz que ficou nos EUA contínuo desde 2015 mas I-914 mostra saída em 2018)
   - Cover letter desatualizada com dados que não batem com forms
   - Hardship genérico sem detalhe sobre re-trafficking risk, mental health gap no país, retaliação
   - Helpfulness alegada sem ato investigativo concreto (depoimento, identificação, testemunho em court)
   - CSPA age-out risk: filho dependente com idade próxima de 21 no filing date — risco de envelhecer durante processamento USCIS
   - VAWA: bona fide marriage com timing suspeito (todas evidências concentradas nos últimos 6 meses do filing — sinal de fraude)
   - TRIG / material support bar: traficantes mencionados na história podem caracterizar material support — cliente precisa narrativa de coerção sólida
   - Witness statements concentradas em familiares próximos (mãe/irmã/filhos) sem corroboração independente — fraqueza probatória
   - Documentos de identificação de família ausentes (filho dependente sem certidão de nascimento mencionada)
5. Cap: máximo 8 findings. Foque nos mais impactantes e estratégicos.
6. Cada finding deve ter rule_id começando com "SENIOR_" (ex: SENIOR_WITNESS_MENTIONS_DIFFERENT_TRAFFICKER, SENIOR_MEDICAL_INCOMPATIBLE_TRAFFICKING_TYPE, SENIOR_HARDSHIP_GENERIC, SENIOR_HELPFULNESS_LACKS_CONCRETE_ACTION, SENIOR_CSPA_AGE_OUT_RISK, SENIOR_BONA_FIDE_TIMING_SUSPECT, SENIOR_TRIG_RISK, SENIOR_TRAVEL_HISTORY_INCONSISTENT, SENIOR_COVER_LETTER_OUTDATED, SENIOR_WITNESS_FAMILY_ONLY).
7. Severidade: use seu julgamento de advogado sênior — crítica para problemas que matam o caso, alta para RFE provável, média para fragilidade probatória, baixa para sugestão estratégica.
8. Tier: tier1_filing (rejeição imediata), tier2_substantivo (afeta mérito), tier3_estrategico (estratégia/RFE).
9. Output: SOMENTE JSON válido conforme schema indicado.

ARMADILHAS DE FALSO POSITIVO (calibração rodada 5, baseada em feedback do time):

A. **A-Number vs USCIS Number do advogado**: na PRIMEIRA PÁGINA de CADA formulário USCIS (I-914, I-914A, I-192, I-765, G-28), aparecem os dados do ADVOGADO (nome, USCIS Number, Bar License). Esses dados pertencem ao advogado Jeffrey Weingrad, NÃO ao cliente. O A-Number do cliente fica em outra seção do form (geralmente página 2+). Se você vir um número USCIS que difere entre forms, verifique se um deles é o número do advogado antes de emitir finding sobre inconsistência. NÃO emita findings de A-Number/SSN/USCIS Number inconsistente quando a divergência for entre o número do advogado (página 1) e o número do cliente (páginas internas).

B. **Estrutura do I-914A**: o formulário I-914A tem uma peculiaridade: a PRIMEIRA PÁGINA traz os dados do APLICANTE PRINCIPAL (nome, DOB, A-Number do principal), e somente a PÁGINA 3 traz os dados do DEPENDENTE (family member). NÃO compare dados da página 1 do I-914A com o passaporte do dependente. A data de nascimento na pág. 1 do I-914A é do principal, não do dep.

C. **Cross-subject**: quando o caso tem múltiplos dependentes (dep_1, dep_2, dep_3...), cada um tem seu PRÓPRIO I-914A, I-765 e G-28. NÃO cruze dados de um dependente com formulários de OUTRO dependente. Compare cada dependente apenas com seus próprios formulários. Se um passaporte pertence a dep_2, não o cruze com o I-914A de dep_1.

D. **Relação familiar**: dependentes podem ser filhos (child) OU cônjuge (spouse). Verifique o campo "relationship_to_principal" antes de emitir CSPA age-out risk. CSPA só se aplica a filhos, NUNCA a cônjuges. Se o dependente é marcado como "spouse", não emita CSPA.

E. **Ausência de dados**: quando um campo extraído é null, isso pode significar que o extrator falhou (não que o dado está ausente no PDF original). NÃO emita findings sobre "dados faltando" baseado apenas em campos null. Só emita se houver evidência positiva de inconsistência.

F. **Comprovante de residência**: um único comprovante de residência cobre toda a família (principal + dependentes moram juntos). NÃO sinalize ausência de comprovante para dependentes individualmente.

G. **Relationship × idade — NÃO reclassifique a relação (caso Anderson Ricardo, Flavia 05/06)**: confie no campo "relationship_to_principal" como está extraído de cada I-914A. NÃO conclua que a relação está errada com base na idade/DOB. Quando há MAIS DE UM dependente (ex: um cônjuge e um filho) e a relação parece incompatível com a idade (ex: alguém marcado "child" que é mais velho que o principal), isso quase sempre significa que os dependentes foram TROCADOS na associação dos formulários (o I-914A de um dep foi associado ao outro) — NÃO que o filing esteja errado. Nesse caso NÃO emita finding crítico afirmando que a relação está classificada errada. No máximo, um aviso leve (severidade baixa) para "conferir qual I-914A pertence a qual dependente". O PDF normalmente está correto; o erro, quando existe, é de associação interna, não do filing.

Use o raciocínio passo a passo (extended thinking) antes de produzir o JSON final.`;

function redactForSummary(form: any): any {
  if (!form || typeof form !== "object") return form;
  const copy: any = { ...form };
  delete copy._subject_id;
  return copy;
}

function jsonClip(value: unknown, maxChars: number): string {
  try {
    const s = JSON.stringify(value);
    if (s == null) return "null";
    return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
  } catch {
    return "<unserializable>";
  }
}

function buildCaseSummary(input: SeniorInput): string {
  const lines: string[] = [];

  lines.push(`# Tipo de caso: ${input.caseType.toUpperCase()}`);
  lines.push(`# Modo: ${input.mode ?? "draft"}`);
  lines.push("");

  lines.push("## Sujeitos");
  for (const s of input.subjects) {
    const rel = s.relationship_to_principal
      ? `, rel: ${s.relationship_to_principal}`
      : "";
    lines.push(
      `- [${s.id}] ${s.role} — ${s.display_name} (DOB: ${s.date_of_birth ?? "?"}, citizenship: ${s.country_of_citizenship ?? "?"}${rel})`
    );
  }
  lines.push("");

  lines.push("## Forms por sujeito");
  for (const [subjectId, forms] of Object.entries(input.formsBySubject ?? {})) {
    lines.push(`### ${subjectId}`);
    for (const f of forms ?? []) {
      const formName = (f as any)?.form ?? "?";
      lines.push(`- ${formName}: ${jsonClip(redactForSummary(f), 800)}`);
    }
  }
  lines.push("");

  if (input.tStory) {
    lines.push("## Story (T-visa)");
    lines.push(jsonClip(input.tStory, 3000));
    lines.push("");
  }

  if (input.vawaStory) {
    lines.push("## Story (VAWA)");
    lines.push(jsonClip(input.vawaStory, 3000));
    lines.push("");
  }

  if (input.uvisaStory) {
    lines.push("## Story (U-visa)");
    lines.push(jsonClip(input.uvisaStory, 3000));
    lines.push("");
  }

  if (input.i360) {
    lines.push("## I-360 (VAWA)");
    lines.push(jsonClip(redactForSummary(input.i360), 1500));
    lines.push("");
  }

  if (input.i918) {
    lines.push("## I-918 (U-visa)");
    lines.push(jsonClip(redactForSummary(input.i918), 1500));
    lines.push("");
  }

  if (input.i918as && input.i918as.length > 0) {
    lines.push("## I-918A (U-visa derivativos)");
    for (const a of input.i918as) {
      lines.push(`- ${jsonClip(redactForSummary(a), 800)}`);
    }
    lines.push("");
  }

  if (input.i918b) {
    lines.push("## I-918B (LEA cert U-visa)");
    lines.push(jsonClip(redactForSummary(input.i918b), 1500));
    lines.push("");
  }

  if (input.witnessAnalysis) {
    lines.push("## Witness analysis");
    lines.push(jsonClip(input.witnessAnalysis, 1500));
    lines.push("");
  }

  if (input.medicalAnalysis) {
    lines.push("## Medical analysis");
    lines.push(jsonClip(input.medicalAnalysis, 1500));
    lines.push("");
  }

  if (input.countryAnalysis) {
    lines.push("## Country conditions analysis");
    lines.push(jsonClip(input.countryAnalysis, 1500));
    lines.push("");
  }

  if (input.passportChecks && input.passportChecks.length > 0) {
    lines.push("## Passport checks");
    for (const p of input.passportChecks) {
      lines.push(`- subject_id=${p.subject_id ?? "?"}: ${jsonClip(p.check, 500)}`);
    }
    lines.push("");
  }

  if (input.leaQualification) {
    lines.push("## LEA qualification");
    lines.push(jsonClip(input.leaQualification, 1000));
    lines.push("");
  }

  if (input.translations) {
    lines.push("## Translations check");
    lines.push(jsonClip(input.translations, 1000));
    lines.push("");
  }

  if (input.proofOfAddress) {
    lines.push("## Proof of address");
    lines.push(jsonClip(input.proofOfAddress, 1000));
    lines.push("");
  }

  return lines.join("\n");
}

export async function seniorCrossCheck(input: SeniorInput): Promise<Finding[]> {
  if (!SENIOR_PASS_ENABLED) {
    console.log("[seniorCrossCheck] disabled via REVIEWER_SENIOR_PASS=off");
    return [];
  }

  const startedTotal = Date.now();
  let client: Anthropic;
  try {
    client = getClient();
  } catch (err: any) {
    const errMsg = String(err?.message ?? err).slice(0, 200);
    console.error("seniorCrossCheck failed:", errMsg);
    emitUsage({
      operation: "seniorCrossCheck",
      model: MODEL,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      duration_ms: Date.now() - startedTotal,
      attempts: 0,
      had_pdf: false,
      ok: false,
      error: `getClient: ${errMsg}`
    });
    return [];
  }

  const summary = buildCaseSummary(input);

  const userPrompt = `Caso a revisar (já extraído pela Go Visa):

${summary}

Devolva SOMENTE JSON válido no formato:
{
  "findings": [
    {
      "severity": "critica|alta|media|baixa",
      "tier": "tier1_filing|tier2_substantivo|tier3_estrategico",
      "category": "cross_narrative",
      "field": "<campo afetado>",
      "form": "<form|null>",
      "expected": "<o que era esperado|null>",
      "found": "<o que foi encontrado|null>",
      "source": "<ANCHOR explícito, ex: story.traffickers_identified vs witness_analysis.items[0].topics_covered>",
      "explanation": "<explicação curta e objetiva>",
      "recommendation": "<sugestão de correção|null>",
      "rule_id": "SENIOR_<ID>",
      "subject_id": "<id do sujeito|null>"
    }
  ]
}

Máximo 8 findings. Não emita findings se não houver evidência clara nos dados acima.`;

  // Tentativa 1: extended thinking adaptive (raciocínio melhor para cross-check sutil).
  // Se vier response sem text/tool_use (só thinking), retentamos 1x sem thinking.
  async function callOnce(useThinking: boolean): Promise<{
    res: any;
    attempts: number;
    startedAt: number;
    caughtErr: any;
  }> {
    const startedAt = Date.now();
    let attempts = 0;
    let res: any;
    let caughtErr: any;
    try {
      res = await callWithRetry(() => {
        attempts++;
        const params: any = {
          model: MODEL,
          // Fix 10/06: com adaptive thinking os tokens de raciocínio CONTAM no
          // max_tokens. 32000 truncou em pacote grande (review 58a7d912); com
          // streaming o sonnet-4-6 suporta 64k de output, então usamos o teto
          // nas DUAS passadas (o retry sem thinking com 12k também truncava).
          max_tokens: 64000,
          system: [
            {
              type: "text",
              text: SENIOR_SYSTEM,
              cache_control: { type: "ephemeral" }
            } as any
          ],
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: userPrompt }]
            }
          ]
        };
        if (useThinking) {
          // claude-opus-4-7 só aceita adaptive thinking; "enabled"+budget_tokens dá 400.
          // A profundidade do raciocínio passa a ser controlada por output_config.effort.
          params.thinking = { type: "adaptive" } as any;
          params.output_config = { effort: "high" } as any;
        }
        // Fix 10/06: streaming + finalMessage() elimina o guard de 10 min do
        // SDK e o risco de timeout HTTP em respostas longas (create já chegou
        // a 474s; com 64k de output o create estouraria o teto de 600s).
        return client.messages.stream(params).finalMessage();
      });
    } catch (err) {
      caughtErr = err;
    }
    return { res, attempts, startedAt, caughtErr };
  }

  // Fluxo com retry (fix 05/06): a 1ª tentativa usa adaptive thinking. Se a
  // resposta vier truncada (stop_reason=max_tokens), sem bloco de texto
  // (thinking-only) ou com JSON inválido/Zod fail, retentamos UMA vez sem
  // thinking — aí todo o max_tokens fica disponível pro JSON de saída.
  let findings: Finding[] | null = null;

  for (let pass = 0; pass < 2 && findings === null; pass++) {
    const useThinking = pass === 0;
    const { res, attempts, startedAt, caughtErr } = await callOnce(useThinking);

    if (caughtErr) {
      const ev = buildSeniorUsageEvent({ res, startedAt, attempts, caughtErr });
      emitUsage(ev);
      console.error("seniorCrossCheck failed:", ev.error);
      return [];
    }

    const diag = diagnoseResponse(res);
    if (!diag.has_text || diag.stop_reason === "max_tokens") {
      const errMsg = diagnosticToErrorMsg(
        diag,
        !diag.has_text
          ? "thinking-only response (no text/tool_use)"
          : "response truncada (stop_reason=max_tokens)"
      );
      emitUsage(
        buildSeniorUsageEvent({
          res,
          startedAt,
          attempts,
          caughtErr: null,
          errorOverride: errMsg
        })
      );
      if (pass === 0) {
        console.warn("[seniorCrossCheck] retry sem thinking:", errMsg.slice(0, 250));
        continue;
      }
      console.error("seniorCrossCheck failed:", errMsg);
      return [];
    }

    const textBlock = (res.content ?? []).find((b: any) => b?.type === "text");
    const raw = stripJsonFences(textBlock.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      const errMsg = `JSON parse error: ${String(err?.message ?? err).slice(
        0,
        150
      )} | stop_reason=${diag.stop_reason} | text_preview=${JSON.stringify(raw.slice(0, 500))}`;
      emitUsage(
        buildSeniorUsageEvent({
          res,
          startedAt,
          attempts,
          caughtErr: null,
          errorOverride: errMsg
        })
      );
      if (pass === 0) {
        console.warn("[seniorCrossCheck] retry sem thinking após JSON parse error");
        continue;
      }
      console.error("seniorCrossCheck failed:", errMsg);
      return [];
    }

    const result = SeniorOutputSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
        .slice(0, 300);
      const errMsg = `Zod validation: ${issues} | text_preview=${JSON.stringify(
        raw.slice(0, 500)
      )}`;
      emitUsage(
        buildSeniorUsageEvent({
          res,
          startedAt,
          attempts,
          caughtErr: null,
          errorOverride: errMsg
        })
      );
      if (pass === 0) {
        console.warn("[seniorCrossCheck] retry sem thinking após Zod fail");
        continue;
      }
      console.error("seniorCrossCheck failed:", errMsg);
      return [];
    }

    // Sucesso: emite evento final com ok=true.
    emitUsage(buildSeniorUsageEvent({ res, startedAt, attempts, caughtErr: null }));

    // Cap de 8 aplicado pós-parse (antes era .max(8) no Zod, que derrubava a
    // resposta INTEIRA quando o modelo passava do cap).
    findings = (result.data.findings as Finding[]).slice(0, 8);
  }

  if (findings === null) return [];

  // Rede de segurança: se modo draft, suprimir findings de assinatura mesmo
  // que o LLM tenha ignorado a regra 0 do system prompt.
  if ((input.mode ?? "draft") === "draft") {
    const SIG_REGEX = /signature|assinatura|signed|date_signed|name_printed/i;
    findings = findings.filter((f) => {
      const haystack = `${f.field} ${f.explanation} ${f.source ?? ""} ${f.expected ?? ""} ${f.found ?? ""}`;
      return !SIG_REGEX.test(haystack);
    });
  }

  return findings;
}

// =============================================================================
// Adversarial Senior Pass
// =============================================================================
//
// Segunda passada que CONTESTA findings já emitidos (determinísticos + senior +
// cluster validator). Não cria findings novos — apenas decide keep/drop/weaken.
// Objetivo: reduzir falso positivo qualitativo (alucinações do LLM, regras
// determinísticas disparadas em edge cases).

const ADVERSARIAL_ENABLED = process.env.REVIEWER_ADVERSARIAL !== "off";

const ADVERSARIAL_SEVERITIES = ["critica", "alta", "media", "baixa"] as const;
type AdversarialSeverity = (typeof ADVERSARIAL_SEVERITIES)[number];

export interface AdversarialReviewInput {
  caseType: "t_visa" | "u_visa" | "vawa";
  // findings já emitidos no caso, ordem livre
  findings: Finding[];
  // Contexto compactado (mesmo formato do buildCaseSummary, pode reaproveitar a função)
  caseSummary: string;
  mode?: "draft" | "final";
}

export interface AdversarialDecision {
  finding_index: number; // índice no array original
  rule_id: string;
  verdict: "keep" | "drop" | "weaken";
  // weaken: manter mas rebaixar severidade
  weakened_severity?: AdversarialSeverity;
  reason: string; // por que decidiu assim (curto, objetivo)
}

export interface AdversarialReviewOutput {
  decisions: AdversarialDecision[];
}

const ADVERSARIAL_SYSTEM = `Você é um advogado-revisor adversarial em um filing USCIS de imigração humanitária.
O caso já foi analisado por uma primeira camada (regras determinísticas + análise sênior LLM).
Sua tarefa é CONTESTAR cada finding emitido com olhar crítico, eliminando alucinações e
findings fracos. Não está procurando NOVOS problemas — só validando os existentes.

Para cada finding, decida:

1. **keep** — finding é defensível: há evidência clara nos dados extraídos que sustenta o problema apontado, a explicação é precisa, e o adjudicador USCIS provavelmente faria a mesma observação.

2. **drop** — finding é falso positivo ou alucinação:
   - Cita campo/peça que não existe nos dados extraídos
   - Inventa nome/data/fato não presente no caso
   - É redundante com outro finding já emitido (mesma raiz)
   - Não faz sentido pro tipo de caso (regra T disparou em VAWA, etc.)
   - Convenção brasileira/hispânica de sobrenomes interpretada como divergência (ex: "DA SILVA" vs "PEREIRA DA SILVA" não é erro)
   - Modo draft mas finding é sobre assinatura/data faltando (assinaturas são coletadas por último em draft)
   - "Concern" demasiadamente especulativa sem ancoragem em dado concreto

3. **weaken** — finding tem mérito mas severidade exagerada:
   - Crítica → alta/média (USCIS pode dar RFE mas não rejeita)
   - Alta → média (atenção mas não bloqueante)
   - Devolva nova severidade em weakened_severity

REGRAS CRÍTICAS:
- NÃO emita findings novos — só decide sobre os existentes
- Cada decisão deve citar reason curto e objetivo (max 200 chars)
- Quando em dúvida real, prefira keep (errar do lado conservador)
- Use o caseSummary fornecido como única fonte de verdade — não invente fatos novos
- Para findings com rule_id começando com SENIOR_, seja MAIS rigoroso — esses vieram de LLM e têm maior risco de alucinação
- Para findings determinísticos (regras TS), seja menos agressivo no drop — eles têm evidência matemática

Use a tool report_adversarial_decisions para devolver suas decisões — uma decisão por finding.`;

const ADVERSARIAL_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          finding_index: { type: "integer" },
          rule_id: { type: "string" },
          verdict: { type: "string", enum: ["keep", "drop", "weaken"] },
          weakened_severity: {
            type: ["string", "null"],
            enum: ["critica", "alta", "media", "baixa", null]
          },
          reason: { type: "string", maxLength: 300 }
        },
        required: ["finding_index", "rule_id", "verdict", "reason"]
      }
    }
  },
  required: ["decisions"]
};

const AdversarialDecisionSchema = z.object({
  finding_index: z.number().int(),
  rule_id: z.string(),
  verdict: z.enum(["keep", "drop", "weaken"]),
  weakened_severity: z
    .preprocess(
      (v) => (typeof v === "string" ? stripDiacritics(v) : v),
      z.enum(ADVERSARIAL_SEVERITIES)
    )
    .nullable()
    .optional(),
  reason: z.string().max(300)
});

const AdversarialOutputSchema = z.object({
  decisions: z.array(AdversarialDecisionSchema)
});

function buildFindingsBlock(
  findings: Finding[],
  offset: number
): string {
  // Renderiza findings como bloco enumerado com finding_index absoluto.
  const lines: string[] = [];
  findings.forEach((f, i) => {
    const idx = offset + i;
    const obj = {
      finding_index: idx,
      rule_id: f.rule_id ?? null,
      severity: f.severity,
      tier: f.tier,
      category: f.category,
      field: f.field,
      form: f.form ?? null,
      expected: f.expected ?? null,
      found: f.found ?? null,
      source: f.source ?? null,
      explanation: f.explanation,
      recommendation: f.recommendation ?? null,
      subject_id: f.subject_id ?? null
    };
    lines.push(jsonClip(obj, 1200));
  });
  return lines.join("\n");
}

async function runAdversarialBatch(
  client: Anthropic,
  caseSummary: string,
  caseType: AdversarialReviewInput["caseType"],
  mode: "draft" | "final",
  batch: Finding[],
  offset: number
): Promise<AdversarialDecision[]> {
  const findingsBlock = buildFindingsBlock(batch, offset);

  const userPrompt = `# Tipo de caso: ${caseType.toUpperCase()}
# Modo: ${mode}

## Resumo do caso (única fonte de verdade)

${caseSummary}

## Findings a contestar (uma decisão por finding)

${findingsBlock}

Use a tool report_adversarial_decisions e devolva exatamente uma decisão por finding listado acima (mesmo finding_index).`;

  // Mesma estratégia do senior: tenta com thinking, se vier só thinking sem
  // tool_use/text, retenta sem thinking (forçando tool_choice).
  async function callOnce(useThinking: boolean): Promise<{
    res: any;
    attempts: number;
    startedAt: number;
    caughtErr: any;
  }> {
    const startedAt = Date.now();
    let attempts = 0;
    let res: any;
    let caughtErr: any;
    try {
      res = await callWithRetry(() => {
        attempts++;
        const params: any = {
          model: MODEL,
          // Fix 10/06: 32000 truncava em pacote grande; com streaming o
          // sonnet-4-6 suporta 64k de output. Teto nas duas passadas.
          max_tokens: 64000,
          system: [
            {
              type: "text",
              text: ADVERSARIAL_SYSTEM,
              cache_control: { type: "ephemeral" }
            } as any
          ],
          tools: [
            {
              name: "report_adversarial_decisions",
              description:
                "Devolve as decisões adversariais (keep/drop/weaken) para cada finding listado.",
              input_schema: ADVERSARIAL_TOOL_SCHEMA as any
            }
          ],
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: userPrompt }]
            }
          ]
        };
        if (useThinking) {
          // tool_choice: "auto" porque Anthropic não permite thinking + tool_choice forçado.
          // claude-opus-4-7 só aceita adaptive thinking; "enabled"+budget_tokens dá 400.
          // A profundidade do raciocínio passa a ser controlada por output_config.effort.
          params.thinking = { type: "adaptive" } as any;
          params.output_config = { effort: "high" } as any;
          params.tool_choice = { type: "auto" } as any;
        } else {
          // Sem thinking podemos forçar tool_use.
          params.tool_choice = {
            type: "tool",
            name: "report_adversarial_decisions"
          } as any;
        }
        // Fix 10/06: streaming + finalMessage() elimina o guard de 10 min do
        // SDK e o risco de timeout HTTP em respostas longas com 64k de output.
        return client.messages.stream(params).finalMessage();
      });
    } catch (err) {
      caughtErr = err;
    }
    return { res, attempts, startedAt, caughtErr };
  }

  // Fluxo com retry (fix 05/06): 1ª tentativa com adaptive thinking. Se a
  // resposta vier truncada (stop_reason=max_tokens), só com thinking, ou com
  // JSON/Zod inválido, retenta UMA vez sem thinking (tool_choice forçado).
  for (let pass = 0; pass < 2; pass++) {
    const useThinking = pass === 0;
    const { res, attempts, startedAt, caughtErr } = await callOnce(useThinking);

    if (caughtErr) {
      const ev = buildAdversarialUsageEvent({ res, startedAt, attempts, caughtErr });
      emitUsage(ev);
      console.error("adversarialReview failed:", ev.error);
      return [];
    }

    const diag = diagnoseResponse(res, "report_adversarial_decisions");
    if ((!diag.has_tool_use && !diag.has_text) || diag.stop_reason === "max_tokens") {
      const errMsg = diagnosticToErrorMsg(
        diag,
        !diag.has_tool_use && !diag.has_text
          ? "thinking-only response (no tool_use/text)"
          : "response truncada (stop_reason=max_tokens)"
      );
      emitUsage(
        buildAdversarialUsageEvent({
          res,
          startedAt,
          attempts,
          caughtErr: null,
          errorOverride: errMsg
        })
      );
      if (pass === 0) {
        console.warn("[adversarialReview] retry sem thinking:", errMsg.slice(0, 250));
        continue;
      }
      console.error("adversarialReview failed:", errMsg);
      return [];
    }

    const toolBlock = (res.content ?? []).find(
      (b: any) => b?.type === "tool_use" && b?.name === "report_adversarial_decisions"
    );

    let parsed: unknown;
    if (toolBlock && toolBlock.input && typeof toolBlock.input === "object") {
      parsed = toolBlock.input;
    } else {
      // Fallback: tenta extrair texto se por algum motivo não vier tool_use.
      const textBlock = (res.content ?? []).find((b: any) => b?.type === "text");
      if (!textBlock || typeof textBlock.text !== "string") {
        const errMsg = diagnosticToErrorMsg(diag, "no tool_use, no text");
        emitUsage(
          buildAdversarialUsageEvent({
            res,
            startedAt,
            attempts,
            caughtErr: null,
            errorOverride: errMsg
          })
        );
        if (pass === 0) continue;
        console.error("adversarialReview failed:", errMsg);
        return [];
      }
      try {
        parsed = JSON.parse(stripJsonFences(textBlock.text));
      } catch (err: any) {
        const errMsg = `JSON parse error: ${String(err?.message ?? err).slice(
          0,
          150
        )} | text_preview=${JSON.stringify(textBlock.text.slice(0, 500))}`;
        emitUsage(
          buildAdversarialUsageEvent({
            res,
            startedAt,
            attempts,
            caughtErr: null,
            errorOverride: errMsg
          })
        );
        if (pass === 0) {
          console.warn("[adversarialReview] retry sem thinking após JSON parse error");
          continue;
        }
        console.error("adversarialReview failed:", errMsg);
        return [];
      }
    }

    const result = AdversarialOutputSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
        .slice(0, 300);
      const errMsg = `Zod validation: ${issues} | parsed_preview=${jsonClip(parsed, 500)}`;
      emitUsage(
        buildAdversarialUsageEvent({
          res,
          startedAt,
          attempts,
          caughtErr: null,
          errorOverride: errMsg
        })
      );
      if (pass === 0) {
        console.warn("[adversarialReview] retry sem thinking após Zod fail");
        continue;
      }
      console.error("adversarialReview failed:", errMsg);
      return [];
    }

    // Sucesso.
    emitUsage(
      buildAdversarialUsageEvent({ res, startedAt, attempts, caughtErr: null })
    );

    // Normaliza: weakened_severity null vira undefined; só mantém se verdict === "weaken".
    const decisions: AdversarialDecision[] = result.data.decisions.map((d) => {
      const out: AdversarialDecision = {
        finding_index: d.finding_index,
        rule_id: d.rule_id,
        verdict: d.verdict,
        reason: d.reason
      };
      if (d.verdict === "weaken" && d.weakened_severity) {
        out.weakened_severity = d.weakened_severity;
      }
      return out;
    });

    return decisions;
  }

  return [];
}

export async function adversarialReview(
  input: AdversarialReviewInput
): Promise<AdversarialReviewOutput> {
  if (!ADVERSARIAL_ENABLED) {
    console.log("[adversarialReview] disabled via REVIEWER_ADVERSARIAL=off");
    return { decisions: [] };
  }

  if (!input.findings || input.findings.length === 0) {
    return { decisions: [] };
  }

  const startedTotal = Date.now();
  let client: Anthropic;
  try {
    client = getClient();
  } catch (err: any) {
    const errMsg = String(err?.message ?? err).slice(0, 200);
    console.error("adversarialReview failed:", errMsg);
    emitUsage({
      operation: "adversarialReview",
      model: MODEL,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      duration_ms: Date.now() - startedTotal,
      attempts: 0,
      had_pdf: false,
      ok: false,
      error: `getClient: ${errMsg}`
    });
    return { decisions: [] };
  }

  const mode = input.mode ?? "draft";
  const total = input.findings.length;

  // Cap: se mais de 60 findings, processa em batches de 30 (paralelo).
  // Caso contrário, chamada única.
  const BATCH_THRESHOLD = 60;
  const BATCH_SIZE = 30;

  try {
    if (total <= BATCH_THRESHOLD) {
      const decisions = await runAdversarialBatch(
        client,
        input.caseSummary,
        input.caseType,
        mode,
        input.findings,
        0
      );
      return { decisions };
    }

    const batches: Array<Promise<AdversarialDecision[]>> = [];
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const slice = input.findings.slice(i, i + BATCH_SIZE);
      batches.push(
        runAdversarialBatch(
          client,
          input.caseSummary,
          input.caseType,
          mode,
          slice,
          i
        )
      );
    }

    const results = await Promise.all(batches);
    const merged: AdversarialDecision[] = [];
    for (const r of results) merged.push(...r);
    return { decisions: merged };
  } catch (err: any) {
    // Best-effort: nunca propaga.
    const errMsg = String(err?.message ?? err).slice(0, 200);
    console.error("adversarialReview failed:", errMsg);
    emitUsage({
      operation: "adversarialReview",
      model: MODEL,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      duration_ms: Date.now() - startedTotal,
      attempts: 0,
      had_pdf: false,
      ok: false,
      error: `outer catch: ${errMsg}`
    });
    return { decisions: [] };
  }
}

// Aplica decisões adversariais sobre o array original de findings, devolvendo
// um array filtrado (drop removido, weaken com severidade rebaixada, keep e
// findings sem decisão mantidos como estão).
/**
 * Findings determinísticos que NÃO podem ser dropados/enfraquecidos pelo
 * adversarial pass. São divergências matemáticas que o cliente exige ver.
 * T_CONS_ANUMBER_DIVERGE: divergência de A-Number entre páginas/forms (Flavia,
 * 03/06 — reclamou que essa revisão "sumia"). Mantém a versão crítica imune; a
 * variante rebaixada (T_CONS_ANUMBER_SSN_EXTRACTOR_SWAP) continua sujeita ao
 * adversarial, pois é justamente o caso ambíguo (advogado/swap).
 */
const ADVERSARIAL_IMMUNE_RULE_IDS = new Set<string>(["T_CONS_ANUMBER_DIVERGE"]);

export function applyAdversarialDecisions(
  originalFindings: Finding[],
  decisions: AdversarialDecision[]
): Finding[] {
  if (!originalFindings || originalFindings.length === 0) return [];

  // Indexa decisão por finding_index (última vence em caso de duplicata).
  const byIndex = new Map<number, AdversarialDecision>();
  for (const d of decisions ?? []) {
    if (
      typeof d?.finding_index === "number" &&
      d.finding_index >= 0 &&
      d.finding_index < originalFindings.length
    ) {
      byIndex.set(d.finding_index, d);
    }
  }

  const out: Finding[] = [];
  originalFindings.forEach((f, i) => {
    const decision = byIndex.get(i);
    if (!decision) {
      out.push(f);
      return;
    }
    // Findings determinísticos imunes: ignora drop/weaken do adversarial.
    if (f.rule_id && ADVERSARIAL_IMMUNE_RULE_IDS.has(f.rule_id)) {
      out.push(f);
      return;
    }
    if (decision.verdict === "drop") {
      return;
    }
    if (decision.verdict === "weaken" && decision.weakened_severity) {
      out.push({ ...f, severity: decision.weakened_severity });
      return;
    }
    // keep (ou weaken sem nova severidade)
    out.push(f);
  });

  return out;
}
