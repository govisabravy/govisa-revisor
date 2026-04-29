import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type {
  Finding,
  Subject,
  StoryFacts,
  MedicalAnalysis,
  WitnessStatementsAnalysis,
  CountryConditionsAnalysis,
  TranslationsCheck,
  FormData
} from "../schemas/forms";
import type { I360Form, VawaStoryFacts } from "../schemas/vawa";
import type { I918Form, I918BForm, UVisaStoryFacts } from "../schemas/uvisa";
import type { PassportSignatureCheck } from "./claude";

// =============================================================================
// RFE Prediction Layer
// =============================================================================
//
// Atua APÓS regras determinísticas + senior pass. Prediz quais RFEs (Request
// for Evidence) o adjudicador USCIS provavelmente emitirá com base em padrões
// observados nos findings + contexto extraído.
//
// Diferente dos findings comuns ("X tá errado"), esta camada antecipa a reação
// do USCIS ("eles vão pedir Y porque o caso tem padrão Z").
//
// Abordagem híbrida:
//   Camada 1: padrões TS deterministas hardcoded (RFE_PATTERNS).
//   Camada 2: 1 chamada Opus com tool use forçado que ranqueia/refina os RFEs.
//
// Toggle env: REVIEWER_RFE_PREDICTION=off desabilita totalmente.
//             REVIEWER_RFE_LLM_REFINE=off pula a Camada 2.

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

export interface RFEPrediction {
  rfe_type: string; // ex: "RFE_HARDSHIP_DETAIL", "RFE_HELPFULNESS_CONCRETE"
  likelihood: "alta" | "media" | "baixa";
  trigger_findings: string[]; // rule_ids ou nomes de campos que sugeriram
  request_text: string; // texto provável do RFE em inglês (templates USCIS)
  preemptive_action: string; // o que advogado pode fazer ANTES do filing
  source: string; // qual padrão disparou esta predição
}

export interface RFEPredictionInput {
  caseType: "t_visa" | "u_visa" | "vawa";
  findings: Finding[];
  story?: StoryFacts | null;
  vawaStory?: VawaStoryFacts | null;
  uvisaStory?: UVisaStoryFacts | null;
  i914?: any;
  i360?: I360Form | null;
  i918?: I918Form | null;
  i918b?: I918BForm | null;
  forms: FormData[];
  passportChecks?: Array<{ subject_id: string | null; check: PassportSignatureCheck }>;
  witnessAnalysis?: WitnessStatementsAnalysis | null;
  medicalAnalysis?: MedicalAnalysis | null;
  countryAnalysis?: CountryConditionsAnalysis | null;
  translations?: TranslationsCheck | null;
  subjects?: Subject[];
  mode?: "draft" | "final";
}

// =============================================================================
// Camada 1 — padrões determinísticos
// =============================================================================

interface RFEPattern {
  applies_to: Array<"t_visa" | "u_visa" | "vawa">;
  rfe_type: string;
  trigger: (input: RFEPredictionInput) => boolean;
  trigger_findings: (input: RFEPredictionInput) => string[];
  likelihood: "alta" | "media" | "baixa";
  request_text: string;
  preemptive_action: string;
  source: string;
}

const RFE_PATTERNS: RFEPattern[] = [
  // ===========================================================================
  // T-visa
  // ===========================================================================
  {
    applies_to: ["t_visa"],
    rfe_type: "RFE_HARDSHIP_DETAIL",
    trigger: (i) =>
      i.findings.some(
        (f) => /hardship/i.test(f.field) || /HARDSHIP/.test(f.rule_id ?? "")
      ),
    trigger_findings: (i) =>
      i.findings
        .filter((f) => /HARDSHIP/i.test(f.rule_id ?? ""))
        .map((f) => f.rule_id ?? f.field),
    likelihood: "alta",
    request_text:
      "Provide additional evidence demonstrating that the applicant would suffer extreme hardship involving unusual and severe harm upon removal, including but not limited to: (1) re-trafficking risk in country of origin; (2) lack of mental health care access; (3) retaliation by traffickers; (4) impunity of perpetrators in country of origin.",
    preemptive_action:
      "Anexar relatório psicológico com seção dedicada a hardship + country conditions abordando re-trafficking risk e mental health care access.",
    source: "Story.extreme_hardship_mentioned é fraco ou ausente"
  },
  {
    applies_to: ["t_visa"],
    rfe_type: "RFE_HELPFULNESS_CONCRETE",
    trigger: (i) =>
      i.findings.some((f) =>
        /helpfulness|HELPFULNESS|cooperation/i.test(`${f.rule_id} ${f.field}`)
      ),
    trigger_findings: (i) =>
      i.findings
        .filter((f) =>
          /HELPFULNESS|cooperation/i.test(`${f.rule_id} ${f.field}`)
        )
        .map((f) => f.rule_id ?? f.field),
    likelihood: "alta",
    request_text:
      "Submit additional evidence of the applicant's helpfulness to law enforcement, including specific dates, names of officers contacted, types of assistance provided (interview, identification, court testimony), and outcomes.",
    preemptive_action:
      "Documentar atos investigativos concretos (depoimentos, identificações, testemunhos em court). Solicitar carta complementar ao officer da agência certificadora.",
    source: "Helpfulness alegada sem detalhe operacional"
  },
  {
    applies_to: ["t_visa", "u_visa"],
    rfe_type: "RFE_INDEPENDENT_CORROBORATION",
    trigger: (i) =>
      i.witnessAnalysis !== null &&
      i.witnessAnalysis !== undefined &&
      (i.witnessAnalysis?.statements_found ?? 0) > 0 &&
      (i.witnessAnalysis?.items ?? []).every((w) =>
        /family|familia|mãe|mae|pai|irmã|irma|filho|filha|spouse|esposa|marido/i.test(
          w.relationship_to_applicant ?? ""
        )
      ),
    trigger_findings: () => [],
    likelihood: "media",
    request_text:
      "Submit witness statements from third parties without familial relationship to applicant (employers, neighbors, colleagues, professional contacts) to corroborate the trafficking events.",
    preemptive_action:
      "Coletar declaração de pelo menos 1-2 testemunhas independentes (não-familiares).",
    source: "Witness statements concentradas em familiares próximos"
  },
  {
    applies_to: ["t_visa", "u_visa", "vawa"],
    rfe_type: "RFE_MEDICAL_NEXUS",
    trigger: (i) =>
      i.findings.some((f) =>
        /MEDICAL_NO_NEXUS|MEDICAL_NO_DSM5|MEDICAL_NOT_LICENSED/.test(
          f.rule_id ?? ""
        )
      ),
    trigger_findings: (i) =>
      i.findings
        .filter((f) => /MEDICAL_/.test(f.rule_id ?? ""))
        .map((f) => f.rule_id ?? f.field),
    likelihood: "alta",
    request_text:
      "Submit a forensic psychological evaluation by a licensed mental health professional (PhD, PsyD, MD, LCSW, LMHC) including: (1) DSM-5 diagnosis; (2) explicit causal nexus between diagnosed condition and the abuse/trafficking events; (3) provider's credentials and license.",
    preemptive_action:
      "Substituir avaliação atual por uma forense feita por profissional licenciado, com diagnóstico DSM-5 e nexo causal explícito.",
    source: "Medical sem credencial / sem DSM-5 / sem nexo"
  },
  {
    applies_to: ["t_visa"],
    rfe_type: "RFE_CONTINUOUS_PHYSICAL_PRESENCE",
    trigger: (i) =>
      i.findings.some((f) =>
        /CPP|CONTINUOUS_PHYSICAL/.test(f.rule_id ?? "")
      ) ||
      ((i.i914?.entry?.travel_history ?? []).filter(
        (t: any) => t?.direction === "exit"
      ).length > 0),
    trigger_findings: (i) =>
      i.findings
        .filter((f) => /CPP|CONTINUOUS/.test(f.rule_id ?? ""))
        .map((f) => f.rule_id ?? f.field),
    likelihood: "media",
    request_text:
      "Submit a sworn statement explaining each departure from the United States since the trafficking events, including dates, destinations, purpose, and the connection (if any) to the original trafficking.",
    preemptive_action:
      "Preparar declaração suplementar do cliente justificando cada saída dos EUA documentada no I-914.",
    source: "Travel history com saídas dos EUA"
  },
  {
    applies_to: ["t_visa"],
    rfe_type: "RFE_FILING_DELAY",
    trigger: (i) => {
      // Heurística: se story menciona um crime/key date e o filing (mode-final
      // assumindo agora) é > 6 meses depois sem explicação, dispara.
      const dates = i.story?.key_dates ?? [];
      if (!dates.length) return false;
      // Pega data mais recente do crime/tráfico mencionada na story.
      const parsed = dates
        .map((d) => {
          const t = Date.parse(d.date);
          return isNaN(t) ? null : t;
        })
        .filter((t): t is number => t !== null);
      if (!parsed.length) return false;
      const mostRecent = Math.max(...parsed);
      const daysSince = (Date.now() - mostRecent) / (1000 * 60 * 60 * 24);
      return daysSince > 180;
    },
    trigger_findings: () => [],
    likelihood: "media",
    request_text:
      "Provide an explanation for the delay between the trafficking events described in the personal statement and the filing date, including any reasons why the applicant could not file sooner (trauma, lack of legal representation, fear of retaliation, etc.).",
    preemptive_action:
      "Adicionar parágrafo na declaração pessoal justificando o tempo entre o evento e o filing (medo, trauma, falta de informação jurídica, isolamento).",
    source: "Filing > 6 meses do evento sem explicação na story"
  },
  {
    applies_to: ["t_visa"],
    rfe_type: "RFE_COUNTRY_CONDITIONS_RE_TRAFFICKING",
    trigger: (i) =>
      i.countryAnalysis !== null &&
      i.countryAnalysis !== undefined &&
      i.countryAnalysis.addresses_re_trafficking_risk !== true,
    trigger_findings: () => [],
    likelihood: "media",
    request_text:
      "Submit additional country conditions evidence specifically addressing the risk of re-trafficking, the prevalence of trafficking networks targeting returnees, and the inability or unwillingness of the country of origin to protect victims of trafficking.",
    preemptive_action:
      "Atualizar pacote de country conditions com fontes recentes (TIP Report, relatórios de ONGs como Polaris, IJM) que abordem re-trafficking risk especificamente.",
    source: "Country conditions sem cobertura de re-trafficking risk"
  },
  // ===========================================================================
  // U-visa
  // ===========================================================================
  {
    applies_to: ["u_visa"],
    rfe_type: "RFE_RECERTIFICATION_I918B",
    trigger: (i) => {
      const sd = i.i918b?.signature?.date_signed;
      if (!sd) return false;
      const d = new Date(sd);
      const days = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
      return !isNaN(days) && days > 180;
    },
    trigger_findings: (i) =>
      i.findings
        .filter((f) => /U_SUBST_I918B_OLD/.test(f.rule_id ?? ""))
        .map((f) => f.rule_id ?? f.field),
    likelihood: "alta",
    request_text:
      "Submit an updated I-918 Supplement B certification signed by the certifying agency within 6 months of the request, confirming the applicant's continued helpfulness to the investigation/prosecution.",
    preemptive_action:
      "Solicitar recertificação do I-918B (assinatura nova) ANTES do filing — o documento atual tem >180 dias.",
    source: "I-918B assinada há mais de 180 dias"
  },
  {
    applies_to: ["u_visa", "vawa"],
    rfe_type: "RFE_INADMISSIBILITY_WAIVER",
    trigger: (i) =>
      i.findings.some(
        (f) =>
          /I192_/.test(f.rule_id ?? "") &&
          /missing|GROUND/.test(f.rule_id ?? "")
      ),
    trigger_findings: (i) =>
      i.findings
        .filter((f) => /I192_/.test(f.rule_id ?? ""))
        .map((f) => f.rule_id ?? f.field),
    likelihood: "alta",
    request_text:
      "Submit an I-192 (Application for Advance Permission to Enter as Nonimmigrant) covering all applicable grounds of inadmissibility identified in the case, including INA 212(a) grounds triggered by criminal history, prior removal, EWI, or fraud.",
    preemptive_action:
      "Revisar I-192 e adicionar TODOS os grounds aplicáveis ao perfil do cliente.",
    source: "I-192 não cobre todos os grounds aplicáveis"
  },
  // ===========================================================================
  // VAWA
  // ===========================================================================
  {
    applies_to: ["vawa"],
    rfe_type: "RFE_BONA_FIDE_MARRIAGE",
    trigger: (i) =>
      i.findings.some((f) =>
        /V_SUBST_NO_GOOD_FAITH|V_SUBST_BONA_FIDE_TIMING|V_SUBST_NO_RESIDENCE/.test(
          f.rule_id ?? ""
        )
      ),
    trigger_findings: (i) =>
      i.findings
        .filter((f) =>
          /V_SUBST_(NO_GOOD_FAITH|BONA_FIDE|NO_RESIDENCE)/.test(
            f.rule_id ?? ""
          )
        )
        .map((f) => f.rule_id ?? f.field),
    likelihood: "alta",
    request_text:
      "Submit additional evidence of bona fide marriage, including: (1) joint financial documents (bank statements, leases, insurance policies); (2) photographs spanning multiple years of the relationship; (3) declarations from third-party witnesses with knowledge of the marriage; (4) evidence of cohabitation with dates.",
    preemptive_action:
      "Compilar pacote bona fide marriage com evidências distribuídas no tempo (não concentradas nos últimos 6 meses).",
    source:
      "Indicadores de bona fide marriage fracos ou concentrados em período curto"
  },
  {
    applies_to: ["vawa"],
    rfe_type: "RFE_ABUSER_STATUS",
    trigger: (i) =>
      i.findings.some((f) =>
        /V_SUBST_ABUSER_STATUS/.test(f.rule_id ?? "")
      ),
    trigger_findings: (i) =>
      i.findings
        .filter((f) => /ABUSER_STATUS/.test(f.rule_id ?? ""))
        .map((f) => f.rule_id ?? f.field),
    likelihood: "alta",
    request_text:
      "Submit primary evidence of the abuser's U.S. citizenship or lawful permanent resident status (passport biographic page, naturalization certificate, green card, USCIS records).",
    preemptive_action:
      "Obter cópia do passaporte/certificado de naturalização/green card do abusador (acesso por marriage records, FOIA pra USCIS, ou contato com network do cliente).",
    source: "Status USC/LPR do abusador desconhecido ou não documentado"
  }
];

// =============================================================================
// Camada 2 — refinamento via LLM (Opus + tool use forçado)
// =============================================================================

const LLM_TOOL_NAME = "report_rfe_predictions";

const RFE_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    predictions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rfe_type: { type: "string" },
          likelihood: {
            type: "string",
            enum: ["alta", "media", "baixa"]
          },
          trigger_findings: {
            type: "array",
            items: { type: "string" }
          },
          request_text: { type: "string" },
          preemptive_action: { type: "string" },
          source: { type: "string" }
        },
        required: [
          "rfe_type",
          "likelihood",
          "trigger_findings",
          "request_text",
          "preemptive_action",
          "source"
        ]
      }
    }
  },
  required: ["predictions"]
};

const RFEPredictionSchema = z.object({
  rfe_type: z.string(),
  likelihood: z.enum(["alta", "media", "baixa"]),
  trigger_findings: z.array(z.string()).default([]),
  request_text: z.string(),
  preemptive_action: z.string(),
  source: z.string()
});

const RFEOutputSchema = z.object({
  predictions: z.array(RFEPredictionSchema)
});

const REFINE_SYSTEM = `Você é um advogado USCIS sênior especializado em vistos humanitários (T-visa, U-visa, VAWA), com prática em adjudicação e padrões reais de RFE.

Sua tarefa: receber predições de RFE geradas por análise determinística + contexto do caso, e refinar:
  1. Filtrar falsos positivos (predições que não fazem sentido pro caso real)
  2. Adicionar RFEs que a análise determinística pode ter perdido (com base em padrões USCIS conhecidos)
  3. Ranquear por likelihood real (alta/media/baixa) — likelihood = probabilidade de o adjudicador efetivamente emitir esse RFE

REGRAS:
- Não invente fatos. Use APENAS o que aparece no contexto fornecido.
- Cada predição deve ter rfe_type CONSISTENTE com vocabulário USCIS (RFE_<TIPO>).
- request_text em inglês, no estilo de RFE oficial USCIS (frases imperativas, "Submit additional evidence...", "Provide...").
- preemptive_action em português, prático, ação concreta para o advogado fazer ANTES do filing.
- source curto, citando o padrão que disparou.
- trigger_findings: rule_ids ou nomes de campo que sustentam a predição.
- Cap: máximo 12 predições. Foque nas mais prováveis e impactantes.
- Em modo "draft", IGNORE predições sobre assinaturas faltando (assinaturas vêm no final).

Use a tool ${LLM_TOOL_NAME} para devolver as predições.`;

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

function jsonClip(value: unknown, maxChars: number): string {
  try {
    const s = JSON.stringify(value);
    if (s == null) return "null";
    return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
  } catch {
    return "<unserializable>";
  }
}

function buildContextSummary(input: RFEPredictionInput): string {
  const lines: string[] = [];
  lines.push(`# Tipo de caso: ${input.caseType.toUpperCase()}`);
  lines.push(`# Modo: ${input.mode ?? "draft"}`);
  lines.push("");

  if (input.subjects && input.subjects.length > 0) {
    lines.push("## Sujeitos");
    for (const s of input.subjects) {
      lines.push(
        `- [${s.id}] ${s.role} — ${s.display_name} (DOB: ${
          s.date_of_birth ?? "?"
        })`
      );
    }
    lines.push("");
  }

  // Findings — comprime para evitar estourar contexto.
  lines.push("## Findings já emitidos (ordem livre)");
  const findingsCompact = input.findings.map((f) => ({
    rule_id: f.rule_id ?? null,
    severity: f.severity,
    tier: f.tier,
    field: f.field,
    explanation: (f.explanation ?? "").slice(0, 220)
  }));
  lines.push(jsonClip(findingsCompact, 6000));
  lines.push("");

  if (input.story) {
    lines.push("## Story (T-visa)");
    lines.push(jsonClip(input.story, 2500));
    lines.push("");
  }
  if (input.vawaStory) {
    lines.push("## Story (VAWA)");
    lines.push(jsonClip(input.vawaStory, 2500));
    lines.push("");
  }
  if (input.uvisaStory) {
    lines.push("## Story (U-visa)");
    lines.push(jsonClip(input.uvisaStory, 2500));
    lines.push("");
  }
  if (input.i918b) {
    lines.push("## I-918B (LEA cert)");
    lines.push(jsonClip(input.i918b, 1200));
    lines.push("");
  }
  if (input.i918) {
    lines.push("## I-918");
    lines.push(jsonClip(input.i918, 1200));
    lines.push("");
  }
  if (input.i360) {
    lines.push("## I-360 (VAWA)");
    lines.push(jsonClip(input.i360, 1200));
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
  if (input.translations) {
    lines.push("## Translations check");
    lines.push(jsonClip(input.translations, 800));
    lines.push("");
  }

  return lines.join("\n");
}

async function refineWithLLM(
  deterministic: RFEPrediction[],
  input: RFEPredictionInput
): Promise<RFEPrediction[] | null> {
  let client: Anthropic;
  try {
    client = getClient();
  } catch (err: any) {
    console.error(
      "predictRFEs LLM refine falhou:",
      String(err?.message ?? err).slice(0, 200)
    );
    return null;
  }

  const summary = buildContextSummary(input);

  const userPrompt = `# Predições deterministas (Camada 1)

${jsonClip(deterministic, 4000)}

---

# Contexto do caso

${summary}

---

Devolva via tool ${LLM_TOOL_NAME} a lista REFINADA de RFE predictions:
- Filtre falsos positivos das deterministas
- Adicione novas predições se houver padrão que a Camada 1 perdeu
- Ranqueie por likelihood real
- Máximo 12 predições

Cada predição deve incluir trigger_findings com referência aos rule_ids/campos que a sustentam.`;

  let res: any;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      thinking: { type: "adaptive" } as any,
      system: [
        {
          type: "text",
          text: REFINE_SYSTEM,
          cache_control: { type: "ephemeral" }
        } as any
      ],
      tools: [
        {
          name: LLM_TOOL_NAME,
          description:
            "Devolve a lista refinada de RFE predictions (filtra falsos positivos, adiciona o que faltou, ranqueia por likelihood).",
          input_schema: RFE_TOOL_SCHEMA as any
        }
      ],
      // tool_choice: "auto" porque Anthropic não permite thinking + tool_choice forçado.
      tool_choice: { type: "auto" } as any,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: userPrompt }]
        }
      ]
    });
  } catch (err: any) {
    console.error(
      "predictRFEs LLM refine falhou:",
      String(err?.message ?? err).slice(0, 200)
    );
    return null;
  }

  // Com tool_choice forçado, esperamos um content block do tipo "tool_use".
  const toolBlock = (res?.content ?? []).find(
    (b: any) => b?.type === "tool_use" && b?.name === LLM_TOOL_NAME
  );

  if (!toolBlock || !toolBlock.input || typeof toolBlock.input !== "object") {
    console.error(
      "predictRFEs LLM refine falhou:",
      "Claude não retornou tool_use válido"
    );
    return null;
  }

  const result = RFEOutputSchema.safeParse(toolBlock.input);
  if (!result.success) {
    console.error(
      "predictRFEs LLM refine falhou:",
      `Zod validation: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
        .slice(0, 200)}`
    );
    return null;
  }

  return result.data.predictions as RFEPrediction[];
}

// =============================================================================
// Entrada pública
// =============================================================================

export async function predictRFEs(
  input: RFEPredictionInput
): Promise<RFEPrediction[]> {
  if (process.env.REVIEWER_RFE_PREDICTION === "off") return [];

  // Camada 1 — determinística.
  const deterministic: RFEPrediction[] = [];
  for (const pattern of RFE_PATTERNS) {
    if (!pattern.applies_to.includes(input.caseType)) continue;
    try {
      if (pattern.trigger(input)) {
        deterministic.push({
          rfe_type: pattern.rfe_type,
          likelihood: pattern.likelihood,
          trigger_findings: pattern.trigger_findings(input),
          request_text: pattern.request_text,
          preemptive_action: pattern.preemptive_action,
          source: pattern.source
        });
      }
    } catch {
      // pattern com erro de avaliação não derruba a função.
    }
  }

  // Dedup por rfe_type — primeira ocorrência vence.
  const dedup = new Map<string, RFEPrediction>();
  for (const p of deterministic) {
    if (!dedup.has(p.rfe_type)) dedup.set(p.rfe_type, p);
  }
  let predictions = Array.from(dedup.values());

  // Camada 2 — refinamento opcional (best-effort).
  if (process.env.REVIEWER_RFE_LLM_REFINE !== "off") {
    try {
      const refined = await refineWithLLM(predictions, input);
      if (refined && refined.length > 0) predictions = refined;
    } catch (err) {
      console.error(
        "predictRFEs LLM refine falhou:",
        String((err as any)?.message ?? err).slice(0, 200)
      );
    }
  }

  return predictions;
}
