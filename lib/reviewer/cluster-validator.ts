import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Subject, FormData, ProofOfAddressAnalysis } from "../schemas/forms";
import type { I918AForm } from "../schemas/uvisa";
import type { PassportSignatureCheck, UsageEvent } from "./claude";
import { onUsage } from "./claude";

// ============================================================================
// Tipos públicos
// ============================================================================

export interface ClusterValidatorInput {
  caseType: "t_visa" | "u_visa" | "vawa";
  subjects: Subject[];
  forms: FormData[]; // com _subject_id anexado
  passportChecks: Array<{
    subject_id: string | null;
    holder_name: string | null;
    check: PassportSignatureCheck;
  }>;
  proofOfAddress?: ProofOfAddressAnalysis | null;
  i918as?: I918AForm[];
}

export interface ClusterCorrection {
  form_index: number;
  form_kind: string;
  old_subject_id: string | null;
  new_subject_id: string;
  reason: string;
}

export interface NewSubjectProposal {
  display_name: string;
  family_name: string | null;
  given_name: string | null;
  date_of_birth: string | null;
  country_of_citizenship: string | null;
  relationship_to_principal: string | null;
  source: string;
  is_us_citizen: boolean | null;
}

export interface OrphanSubject {
  subject_id: string;
  display_name: string;
  reason: string;
}

export interface ClusterAmbiguity {
  description: string;
  affected_form_index?: number;
  affected_subject_id?: string;
  suggested_action: string;
}

export interface ClusterValidatorOutput {
  corrections: ClusterCorrection[];
  new_subjects: NewSubjectProposal[];
  orphans: OrphanSubject[];
  ambiguities: ClusterAmbiguity[];
}

// ============================================================================
// Configuração interna
// ============================================================================

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
const ENABLED = process.env.REVIEWER_CLUSTER_VALIDATOR !== "off";

const EMPTY_OUTPUT: ClusterValidatorOutput = {
  corrections: [],
  new_subjects: [],
  orphans: [],
  ambiguities: []
};

// Reusa o set de listeners de claude.ts via re-emit local — emite no mesmo
// canal que `onUsage` registra, encaminhando eventos. Como o Set em claude.ts
// é privado, nós exportamos um listener via onUsage do próprio módulo: quem
// quiser telemetria de cluster validator escuta `onUsage` (mesmo canal já
// usado para o restante do pipeline). Para emitir, precisamos de um alvo —
// resolução simples: registramos um listener a partir do nosso próprio Set
// e usamos `onUsage` apenas como referência tipada.
const usageListeners = new Set<(e: UsageEvent) => void>();

// Encaminha eventos do nosso emitter local para qualquer listener que tenha
// se registrado via onUsage do claude.ts NÃO funciona diretamente (Set
// privado). Para manter compatibilidade com o pipeline atual (que escuta
// `onUsage` exportado em claude.ts), expomos `onClusterValidatorUsage` aqui
// e registramos um listener no próprio claude.ts NÃO é viável.
//
// Convenção do projeto (vide senior.ts): cada módulo expõe seu próprio
// `onXxxUsage`. Mantemos a mesma estratégia.
export function onClusterValidatorUsage(listener: (e: UsageEvent) => void) {
  usageListeners.add(listener);
  return () => usageListeners.delete(listener);
}

// Mantém a referência ao onUsage importado pra evitar warning de unused.
void onUsage;

function emitUsage(event: UsageEvent) {
  for (const l of usageListeners) {
    try {
      l(event);
    } catch {
      // best-effort
    }
  }
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
    authToken
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
          `[clusterValidator] Rate limit ${status}. Aguardando ${wait}ms (tentativa ${i + 1}/${attempts})`
        );
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ============================================================================
// Compactação dos inputs (limite ~300 chars por form)
// ============================================================================

interface CompactForm {
  index: number;
  form: string;
  _subject_id: string | null | undefined;
  given_name?: string | null;
  family_name?: string | null;
  date_of_birth?: string | null;
  passport_number?: string | null;
  // Para I-914A / I-918A (têm principal_applicant + family_member)
  principal_given_name?: string | null;
  principal_family_name?: string | null;
  family_member_given_name?: string | null;
  family_member_family_name?: string | null;
  family_member_dob?: string | null;
  relationship_to_principal?: string | null;
}

function compactForm(form: FormData, index: number): CompactForm {
  const f: any = form;
  const out: CompactForm = {
    index,
    form: f.form,
    _subject_id: f._subject_id ?? null
  };

  // I-914A: tem principal_applicant + family_member
  if (f.form === "I-914A") {
    out.principal_given_name = f.principal_applicant?.given_name ?? null;
    out.principal_family_name = f.principal_applicant?.family_name ?? null;
    out.family_member_given_name = f.family_member?.given_name ?? null;
    out.family_member_family_name = f.family_member?.family_name ?? null;
    out.family_member_dob = f.family_member?.date_of_birth ?? null;
    out.relationship_to_principal = f.relationship_to_principal ?? null;
    return out;
  }

  // G-28: tem client_name (string única)
  if (f.form === "G-28") {
    const name: string | null = f.client_name ?? null;
    if (name) {
      // Heurística simples — separar último token como family
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        out.given_name = parts.slice(0, -1).join(" ");
        out.family_name = parts[parts.length - 1];
      } else {
        out.given_name = name;
      }
    }
    return out;
  }

  // Forms com person: I-914, I-192, I-765
  if (f.person) {
    out.given_name = f.person.given_name ?? null;
    out.family_name = f.person.family_name ?? null;
    out.date_of_birth = f.person.date_of_birth ?? null;
    out.passport_number = f.person.passport_number ?? null;
  }

  return out;
}

interface CompactI918A {
  index: number;
  form: "I-918A";
  principal_given_name: string | null;
  principal_family_name: string | null;
  family_member_given_name: string | null;
  family_member_family_name: string | null;
  family_member_dob: string | null;
  relationship_to_principal: string | null;
  _subject_id: string | null;
}

function compactI918A(form: I918AForm, index: number): CompactI918A {
  const f: any = form;
  return {
    index,
    form: "I-918A",
    principal_given_name: f.principal_applicant?.given_name ?? null,
    principal_family_name: f.principal_applicant?.family_name ?? null,
    family_member_given_name: f.family_member?.given_name ?? null,
    family_member_family_name: f.family_member?.family_name ?? null,
    family_member_dob: f.family_member?.date_of_birth ?? null,
    relationship_to_principal: f.relationship_to_principal ?? null,
    _subject_id: f._subject_id ?? null
  };
}

interface CompactPassportCheck {
  subject_id: string | null;
  holder_name_seen: string | null;
  passport_number_seen: string | null;
}

interface CompactProofOfAddress {
  found: boolean;
  holder_name: string | null;
  matched_subject_id: string | null;
  document_type: string | null;
}

// ============================================================================
// Tool schema (forçado via tool_choice)
// ============================================================================

const TOOL_NAME = "report_cluster_validation";

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    corrections: {
      type: "array",
      description:
        "Lista de correções de _subject_id em forms onde a pessoa do form não bate com o subject atribuído pelo mapper.",
      items: {
        type: "object",
        properties: {
          form_index: { type: "number", description: "Índice do form no array forms[] de input." },
          form_kind: { type: "string", description: "Kind do form (I-914, I-765, etc) — ajuda debug." },
          old_subject_id: {
            type: ["string", "null"],
            description: "subject_id atualmente atribuído pelo mapper (pode ser null)."
          },
          new_subject_id: { type: "string", description: "subject_id correto após validação." },
          reason: { type: "string", description: "Justificativa curta e explícita da correção." }
        },
        required: ["form_index", "form_kind", "old_subject_id", "new_subject_id", "reason"],
        additionalProperties: false
      }
    },
    new_subjects: {
      type: "array",
      description:
        "Pessoas detectadas em IDs/passaportes/certidões que NÃO existem na lista de subjects e devem ser criadas.",
      items: {
        type: "object",
        properties: {
          display_name: { type: "string" },
          family_name: { type: ["string", "null"] },
          given_name: { type: ["string", "null"] },
          date_of_birth: { type: ["string", "null"] },
          country_of_citizenship: { type: ["string", "null"] },
          relationship_to_principal: { type: ["string", "null"] },
          source: {
            type: "string",
            description: "Onde a pessoa foi vista (ex: 'I-765 página 12', 'certidão de nascimento Nicolle página 47')."
          },
          is_us_citizen: { type: ["boolean", "null"] }
        },
        required: [
          "display_name",
          "family_name",
          "given_name",
          "date_of_birth",
          "country_of_citizenship",
          "relationship_to_principal",
          "source",
          "is_us_citizen"
        ],
        additionalProperties: false
      }
    },
    orphans: {
      type: "array",
      description:
        "Subjects criados pelo mapper mas que não têm nenhum form apontando pra eles — possível alucinação do mapper.",
      items: {
        type: "object",
        properties: {
          subject_id: { type: "string" },
          display_name: { type: "string" },
          reason: { type: "string" }
        },
        required: ["subject_id", "display_name", "reason"],
        additionalProperties: false
      }
    },
    ambiguities: {
      type: "array",
      description:
        "Casos ambíguos (2 forms do mesmo kind disputando o mesmo subject, nomes muito similares, etc) — escalar humano.",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          affected_form_index: { type: "number" },
          affected_subject_id: { type: "string" },
          suggested_action: { type: "string" }
        },
        required: ["description", "suggested_action"],
        additionalProperties: false
      }
    }
  },
  required: ["corrections", "new_subjects", "orphans", "ambiguities"],
  additionalProperties: false
};

// ============================================================================
// Validação Zod do output do tool_use
// ============================================================================

const CorrectionSchema = z.object({
  form_index: z.number().int().nonnegative(),
  form_kind: z.string(),
  old_subject_id: z.string().nullable(),
  new_subject_id: z.string(),
  reason: z.string()
});

const NewSubjectSchema = z.object({
  display_name: z.string(),
  family_name: z.string().nullable(),
  given_name: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  country_of_citizenship: z.string().nullable(),
  relationship_to_principal: z.string().nullable(),
  source: z.string(),
  is_us_citizen: z.boolean().nullable()
});

const OrphanSchema = z.object({
  subject_id: z.string(),
  display_name: z.string(),
  reason: z.string()
});

const AmbiguitySchema = z.object({
  description: z.string(),
  affected_form_index: z.number().int().nonnegative().optional(),
  affected_subject_id: z.string().optional(),
  suggested_action: z.string()
});

const ClusterValidatorOutputSchema = z.object({
  corrections: z.array(CorrectionSchema).default([]),
  new_subjects: z.array(NewSubjectSchema).default([]),
  orphans: z.array(OrphanSchema).default([]),
  ambiguities: z.array(AmbiguitySchema).default([])
});

// ============================================================================
// System prompt
// ============================================================================

const SYSTEM_PROMPT = `Você é um auditor de cluster por sujeito em filings USCIS de imigração humanitária (T-visa, U-visa, VAWA).

Recebe um caso JÁ EXTRAÍDO pelo pipeline anterior:
- subjects: lista de sujeitos propostos pelo mapper (principal + dependentes)
- forms: cada form tem _subject_id atribuído pelo mapper
- passport_checks: lista de checks de passaporte (com subject_id + holder_name detectado na imagem)
- proof_of_address: comprovante de residência (se houver)

Sua tarefa é VALIDAR coerência:

1. **Coerência forms × subject**: cada form tem _subject_id. O person.given_name+family_name (ou family_member.given_name+family_name no I-914A/I-918A) deve bater com o sujeito atribuído. Se não bate, propor correção.

2. **Pessoas órfãs em IDs**: se passport_check tem holder_name detectado que não existe em nenhum subject, OU certidão de nascimento aparece com pessoa não-cadastrada, propor new_subject (especialmente importante: filhos americanos não precisam de I-914A mas devem ser cadastrados como subject pra rastreabilidade).

3. **Subjects órfãos**: se um subject foi criado pelo mapper mas nenhum form aponta pra ele, marcar como orphan.

4. **Ambiguidades**: 2 forms do mesmo kind disputando o mesmo subject (ex: 2 I-765 marcados como "principal"), nomes muito similares, etc.

REGRAS CRÍTICAS:
- NÃO altere extração — só valide subject_id atribuído
- Use convenção brasileira/hispânica de sobrenomes: "DA SILVA" e "PEREIRA DA SILVA" PODEM ser a mesma pessoa (subset de tokens)
- Se ambíguo, marque como ambiguidade — não chute
- Devolva APENAS via a tool report_cluster_validation (será forçado por tool use schema)
- Se a data dos forms claramente bate com sujeito existente, NÃO crie correção redundante
- Cada correção deve citar reason curta mas explícita (ex: "I-765 person é Maria Silva mas _subject_id=principal aponta pra Cloves Pereira")`;

// ============================================================================
// Função pública
// ============================================================================

export async function validateClusters(
  input: ClusterValidatorInput
): Promise<ClusterValidatorOutput> {
  if (!ENABLED) {
    return EMPTY_OUTPUT;
  }

  // Compactação
  const compactForms = input.forms.map((f, i) => compactForm(f, i));

  const compactI918As: CompactI918A[] = (input.i918as ?? []).map((f, i) =>
    compactI918A(f, i)
  );

  const compactPassportChecks: CompactPassportCheck[] = (
    input.passportChecks ?? []
  ).map((p) => ({
    subject_id: p.subject_id ?? null,
    holder_name_seen: p.check?.holder_name_seen ?? p.holder_name ?? null,
    passport_number_seen: p.check?.passport_number_seen ?? null
  }));

  const compactPoa: CompactProofOfAddress | null = input.proofOfAddress
    ? {
        found: !!input.proofOfAddress.found,
        holder_name: input.proofOfAddress.holder_name ?? null,
        matched_subject_id: input.proofOfAddress.matched_subject_id ?? null,
        document_type: input.proofOfAddress.document_type ?? null
      }
    : null;

  const userPayload = {
    case_type: input.caseType,
    subjects: input.subjects.map((s) => ({
      id: s.id,
      role: s.role,
      display_name: s.display_name,
      family_name: s.family_name ?? null,
      given_name: s.given_name ?? null,
      date_of_birth: s.date_of_birth ?? null,
      country_of_citizenship: s.country_of_citizenship ?? null,
      relationship_to_principal: s.relationship_to_principal ?? null
    })),
    forms: compactForms,
    i918as: compactI918As,
    passport_checks: compactPassportChecks,
    proof_of_address: compactPoa
  };

  const userText = `Caso para validação (JSON):

${JSON.stringify(userPayload, null, 2)}

Use a tool ${TOOL_NAME} para reportar correções, novos sujeitos, órfãos e ambiguidades.`;

  let client: Anthropic;
  try {
    client = getClient();
  } catch (err) {
    console.error(
      "[clusterValidator] getClient falhou:",
      String((err as any)?.message ?? err).slice(0, 200)
    );
    return EMPTY_OUTPUT;
  }

  const started = Date.now();
  let attempts = 0;
  let res: any;
  let caughtErr: any;

  try {
    res = await callWithRetry(() => {
      attempts++;
      const params: any = {
        model: MODEL,
        // Fix 05/06: thinking tokens contam no max_tokens; folga maior.
        max_tokens: 32000,
        // claude-opus-4-7 só aceita adaptive thinking; "enabled"+budget_tokens dá 400.
        thinking: { type: "adaptive" } as any,
        output_config: { effort: "high" } as any,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" }
          } as any
        ],
        tools: [
          {
            name: TOOL_NAME,
            description:
              "Reporta o resultado da validação de cluster por sujeito: correções de subject_id, novos sujeitos detectados, sujeitos órfãos e ambiguidades.",
            input_schema: TOOL_SCHEMA as any
          }
        ],
        // tool_choice: "auto" porque Anthropic não permite thinking + tool_choice forçado.
        // Modelo geralmente usa a tool quando é a única disponível.
        tool_choice: { type: "auto" },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: userText }]
          }
        ]
      };
      // timeout explícito: sem ele o SDK lança "Streaming is strongly
      // recommended" client-side quando max_tokens > ~21k (fix 05/06 r2).
      return client.messages.create(params, { timeout: 600_000 });
    });
  } catch (err) {
    caughtErr = err;
  }

  const event: UsageEvent = {
    operation: "clusterValidator",
    model: MODEL,
    input_tokens: res?.usage?.input_tokens ?? 0,
    output_tokens: res?.usage?.output_tokens ?? 0,
    cache_creation_input_tokens: res?.usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: res?.usage?.cache_read_input_tokens ?? 0,
    duration_ms: Date.now() - started,
    attempts,
    had_pdf: false,
    ok: !caughtErr,
    error: caughtErr ? String((caughtErr as any)?.message ?? caughtErr).slice(0, 200) : undefined
  };
  emitUsage(event);

  if (caughtErr) {
    console.error(
      "[clusterValidator] chamada falhou:",
      String((caughtErr as any)?.message ?? caughtErr).slice(0, 200)
    );
    return EMPTY_OUTPUT;
  }

  // Extrair tool_use block (com thinking ativo, content tem thinking + tool_use)
  const toolUseBlock = (res?.content ?? []).find(
    (b: any) => b?.type === "tool_use" && b?.name === TOOL_NAME
  );
  if (!toolUseBlock || !toolUseBlock.input) {
    console.error(
      "[clusterValidator] resposta sem tool_use:",
      String(JSON.stringify(res?.content ?? [])).slice(0, 200)
    );
    return EMPTY_OUTPUT;
  }

  const parsed = ClusterValidatorOutputSchema.safeParse(toolUseBlock.input);
  if (!parsed.success) {
    console.error(
      "[clusterValidator] zod validation falhou:",
      String(parsed.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ")).slice(0, 200)
    );
    return EMPTY_OUTPUT;
  }

  return parsed.data;
}
