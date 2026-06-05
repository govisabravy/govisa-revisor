import Anthropic from "@anthropic-ai/sdk";
import type { FormData, StoryFacts, ProofOfAddressAnalysis } from "../schemas/forms";

export type DocKind =
  | "cover_letter"
  | "I-914"
  | "I-914A"
  | "I-914B"
  | "I-192"
  | "I-765"
  | "G-28"
  | "I-360"
  | "I-485"
  | "I-918"
  | "I-918A"
  | "I-918B"
  | "identification"
  | "country_conditions"
  | "witness_statements"
  | "medical_records"
  | "proof_of_address"
  | "story"
  | "final"
  | "other";

export interface StructureDocument {
  kind: DocKind;
  label: string;
  startPage: number;
  endPage: number;
  subject_id?: string | null;
  holder_name?: string | null;
}

export interface DocumentStructure {
  documents: StructureDocument[];
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

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

// Canal publico de emissao. Usado por modulos como senior.ts e cluster-validator.ts
// que fazem chamadas diretas ao SDK (sem passar por callJsonWithDocument /
// callToolWithDocument) e precisam reportar telemetria no MESMO set de listeners
// que reviewProcess assina, garantindo que cada evento chegue em usage_events.
export function emitUsage(event: UsageEvent) {
  for (const l of usageListeners) {
    try {
      l(event);
    } catch {}
  }
}

export async function callJsonWithDocument<T>(opts: {
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

async function callToolWithDocument<T>(opts: {
  systemBlocks: Array<{ type: "text"; text: string; cacheControl?: boolean }>;
  pdfBase64?: string;
  userText: string;
  toolName: string;
  toolDescription: string;
  inputSchema: any;
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
        messages: [{ role: "user", content }],
        tools: [
          {
            name: opts.toolName,
            description: opts.toolDescription,
            input_schema: opts.inputSchema
          }
        ],
        tool_choice: { type: "tool", name: opts.toolName }
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

  const toolBlock = res.content.find(
    (b: any) => b.type === "tool_use" && b.name === opts.toolName
  );
  if (!toolBlock) {
    throw new Error(`Claude não retornou tool_use para ${opts.toolName}`);
  }
  return toolBlock.input as T;
}

// =====================================================================
// JSON Schemas (draft-07 style — formato aceito pela Anthropic Tool API)
// =====================================================================

const ADDRESS_SCHEMA = {
  type: "object",
  properties: {
    in_care_of: { type: ["string", "null"] },
    street: { type: ["string", "null"] },
    apt_ste_flr: { type: ["string", "null"], enum: ["Apt", "Ste", "Flr", null] },
    apt_number: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    zip: { type: ["string", "null"] },
    country: { type: ["string", "null"] }
  }
};

const SIGNATURE_SCHEMA = {
  type: "object",
  properties: {
    signed: { type: ["boolean", "null"] },
    name_printed: { type: ["string", "null"] },
    date_signed: { type: ["string", "null"] }
  }
};

const META_SCHEMA = {
  type: "object",
  properties: {
    edition_date: { type: ["string", "null"] },
    applicant_signature: SIGNATURE_SCHEMA,
    interpreter_used: { type: ["boolean", "null"] },
    interpreter_signature: SIGNATURE_SCHEMA,
    preparer_used: { type: ["boolean", "null"] },
    preparer_signature: SIGNATURE_SCHEMA
  }
};

const PERSON_SCHEMA = {
  type: "object",
  properties: {
    family_name: { type: ["string", "null"] },
    given_name: { type: ["string", "null"] },
    middle_name: { type: ["string", "null"] },
    other_names: { type: "array", items: { type: "string" } },
    date_of_birth: { type: ["string", "null"] },
    country_of_birth: { type: ["string", "null"] },
    country_of_citizenship: { type: ["string", "null"] },
    gender: { type: ["string", "null"] },
    marital_status: { type: ["string", "null"] },
    a_number: { type: ["string", "null"] },
    a_numbers_seen: {
      type: "array",
      items: {
        type: "object",
        properties: {
          value: { type: "string" },
          page: { type: ["string", "number", "null"] }
        },
        required: ["value"]
      }
    },
    uscis_online_account: { type: ["string", "null"] },
    ssn: { type: ["string", "null"] },
    passport_number: { type: ["string", "null"] },
    passport_country: { type: ["string", "null"] },
    passport_issue_date: { type: ["string", "null"] },
    passport_expiration_date: { type: ["string", "null"] },
    passport_signed: { type: ["boolean", "null"] }
  }
};

const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    last_entry_date: { type: ["string", "null"] },
    last_entry_place: { type: ["string", "null"] },
    last_entry_status: { type: ["string", "null"] },
    i94_number: { type: ["string", "null"] },
    status_at_entry: { type: ["string", "null"] },
    visa_used: { type: ["string", "null"] },
    expiration_of_authorized_stay: { type: ["string", "null"] },
    entered_ewi: { type: ["boolean", "null"] },
    travel_history: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: ["string", "null"] },
          direction: { type: ["string", "null"], enum: ["entry", "exit", null] },
          port: { type: ["string", "null"] }
        }
      }
    }
  }
};

const FORM_INPUT_SCHEMAS: Record<string, any> = {
  "I-914": {
    type: "object",
    properties: {
      form: { type: "string", enum: ["I-914"] },
      meta: META_SCHEMA,
      person: PERSON_SCHEMA,
      physical_address: ADDRESS_SCHEMA,
      mailing_address: { ...ADDRESS_SCHEMA, type: ["object", "null"] },
      safe_mailing_address: { ...ADDRESS_SCHEMA, type: ["object", "null"] },
      entry: { ...ENTRY_SCHEMA, type: ["object", "null"] },
      family_members_included: {
        type: "array",
        items: {
          type: "object",
          properties: {
            relationship: { type: ["string", "null"] },
            name: { type: ["string", "null"] },
            date_of_birth: { type: ["string", "null"] },
            marital_status: {
              type: ["string", "null"],
              enum: ["single", "married", "divorced", "widowed", null]
            },
            country_of_citizenship: { type: ["string", "null"] },
            country_of_residence: { type: ["string", "null"] },
            is_us_citizen: { type: ["boolean", "null"] }
          }
        }
      },
      inadmissibilities_checked: { type: "array", items: { type: "string" } },
      prior_applications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: ["string", "null"] },
            outcome: { type: ["string", "null"] },
            date: { type: ["string", "null"] }
          }
        }
      },
      removal_proceedings: { type: ["boolean", "null"] },
      criminal_history_disclosed: { type: ["boolean", "null"] }
    },
    required: ["form", "person"]
  },
  "I-914A": {
    type: "object",
    properties: {
      form: { type: "string", enum: ["I-914A"] },
      meta: META_SCHEMA,
      principal_applicant: {
        type: "object",
        properties: {
          family_name: { type: ["string", "null"] },
          given_name: { type: ["string", "null"] },
          a_number: { type: ["string", "null"] },
          date_of_birth: { type: ["string", "null"] }
        }
      },
      family_member: PERSON_SCHEMA,
      relationship_to_principal: { type: ["string", "null"] },
      relationship_start_date: { type: ["string", "null"] },
      relationship_evidence_mentioned: { type: "array", items: { type: "string" } },
      location: { type: ["string", "null"], enum: ["US", "abroad", null] },
      physical_address: ADDRESS_SCHEMA,
      safe_mailing_address: { ...ADDRESS_SCHEMA, type: ["object", "null"] }
    },
    required: ["form", "family_member"]
  },
  "I-914B": {
    type: "object",
    properties: {
      form: { type: "string", enum: ["I-914B"] },
      meta: META_SCHEMA,
      law_enforcement_agency: { type: ["string", "null"] },
      agency_type: { type: ["string", "null"] },
      is_qualifying_agency: { type: ["boolean", "null"] },
      officer_name: { type: ["string", "null"] },
      officer_title: { type: ["string", "null"] },
      officer_signature: SIGNATURE_SCHEMA,
      victim_name: { type: ["string", "null"] },
      signed_date: { type: ["string", "null"] },
      part2_filled: { type: ["boolean", "null"] },
      part2_fields_filled: { type: "array", items: { type: "string" } }
    },
    required: ["form"]
  },
  "I-192": {
    type: "object",
    properties: {
      form: { type: "string", enum: ["I-192"] },
      meta: META_SCHEMA,
      person: PERSON_SCHEMA,
      physical_address: ADDRESS_SCHEMA,
      safe_mailing_address: { ...ADDRESS_SCHEMA, type: ["object", "null"] },
      grounds_of_inadmissibility: { type: "array", items: { type: "string" } },
      waiver_justification_summary: { type: ["string", "null"] }
    },
    required: ["form", "person"]
  },
  "I-765": {
    type: "object",
    properties: {
      form: { type: "string", enum: ["I-765"] },
      meta: META_SCHEMA,
      person: PERSON_SCHEMA,
      physical_address: ADDRESS_SCHEMA,
      mailing_address: { ...ADDRESS_SCHEMA, type: ["object", "null"] },
      eligibility_category: { type: ["string", "null"] },
      last_employer: { type: ["string", "null"] },
      is_for_principal: { type: ["boolean", "null"] },
      category_valid_for_t_visa: { type: ["boolean", "null"] },
      attorney_bar_number: { type: ["string", "null"] }
    },
    required: ["form", "person"]
  },
  "G-28": {
    type: "object",
    properties: {
      form: { type: "string", enum: ["G-28"] },
      meta: META_SCHEMA,
      attorney_name: { type: ["string", "null"] },
      attorney_firm: { type: ["string", "null"] },
      attorney_bar_number: { type: ["string", "null"] },
      attorney_address: ADDRESS_SCHEMA,
      attorney_signature: SIGNATURE_SCHEMA,
      client_name: { type: ["string", "null"] },
      client_a_number: { type: ["string", "null"] },
      client_signature: SIGNATURE_SCHEMA,
      signed_date: { type: ["string", "null"] }
    },
    required: ["form"]
  }
};

function buildFormInputSchema(formKind: string): any {
  return FORM_INPUT_SCHEMAS[formKind] ?? FORM_INPUT_SCHEMAS["I-914"];
}

const STRUCTURE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    documents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "cover_letter",
              "I-914",
              "I-914A",
              "I-914B",
              "I-192",
              "I-765",
              "G-28",
              "I-360",
              "I-485",
              "I-918",
              "I-918A",
              "I-918B",
              "identification",
              "country_conditions",
              "witness_statements",
              "medical_records",
              "proof_of_address",
              "story",
              "final",
              "other"
            ]
          },
          label: { type: "string" },
          startPage: { type: "number" },
          endPage: { type: "number" },
          subject_id: { type: ["string", "null"] },
          holder_name: { type: ["string", "null"] }
        },
        required: ["kind", "label", "startPage", "endPage"]
      }
    }
  },
  required: ["documents"]
};

const STORY_FACTS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    full_name: { type: ["string", "null"] },
    date_of_birth: { type: ["string", "null"] },
    country_of_origin: { type: ["string", "null"] },
    marital_status: {
      type: ["string", "null"],
      enum: ["solteiro", "casado", "divorciado", "viuvo", "uniao_estavel", null]
    },
    spouse_name: { type: ["string", "null"] },
    children: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          date_of_birth: { type: ["string", "null"] },
          marital_status: {
            type: ["string", "null"],
            enum: ["single", "married", "divorced", "widowed", null]
          }
        }
      }
    },
    year_entered_us: { type: ["string", "null"] },
    port_of_entry: { type: ["string", "null"] },
    entry_method: { type: ["string", "null"] },
    employers_mentioned: { type: "array", items: { type: "string" } },
    cities_lived_in_us: { type: "array", items: { type: "string" } },
    passport_number_mentioned: { type: ["string", "null"] },
    key_dates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event: { type: "string" },
          date: { type: "string" }
        },
        required: ["event", "date"]
      }
    },
    trafficking_type: {
      type: ["string", "null"],
      enum: ["sex", "labor", "both", "unclear", null]
    },
    force_mentioned: { type: ["boolean", "null"] },
    force_examples: { type: "array", items: { type: "string" } },
    fraud_mentioned: { type: ["boolean", "null"] },
    fraud_examples: { type: "array", items: { type: "string" } },
    coercion_mentioned: { type: ["boolean", "null"] },
    coercion_examples: { type: "array", items: { type: "string" } },
    traffickers_identified: { type: "array", items: { type: "string" } },
    trafficking_locations: { type: "array", items: { type: "string" } },
    physical_presence_on_account_of_trafficking: { type: ["boolean", "null"] },
    cooperation_with_lea_mentioned: { type: ["boolean", "null"] },
    cooperation_details: { type: ["string", "null"] },
    cooperation_exempt_reason: { type: ["string", "null"] },
    extreme_hardship_mentioned: { type: ["boolean", "null"] },
    hardship_reasons: { type: "array", items: { type: "string" } },
    fears_returning: { type: ["boolean", "null"] },
    prior_immigration_history: { type: ["string", "null"] },
    trauma_described: { type: ["boolean", "null"] },
    document_confiscation_mentioned: { type: ["boolean", "null"] },
    debt_bondage_mentioned: { type: ["boolean", "null"] },
    isolation_mentioned: { type: ["boolean", "null"] }
  }
};

const WITNESS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    statements_found: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          witness_name: { type: ["string", "null"] },
          relationship_to_applicant: { type: ["string", "null"] },
          signed: { type: ["boolean", "null"] },
          dated: { type: ["boolean", "null"] },
          has_perjury_clause: { type: ["boolean", "null"] },
          attests_specific_facts: { type: ["boolean", "null"] },
          topics_covered: { type: "array", items: { type: "string" } },
          concerns: { type: "array", items: { type: "string" } }
        }
      }
    }
  },
  required: ["statements_found", "items"]
};

const MEDICAL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    evaluations_found: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          provider_name: { type: ["string", "null"] },
          provider_credential: { type: ["string", "null"] },
          licensed_professional: { type: ["boolean", "null"] },
          dsm5_diagnosis: { type: "array", items: { type: "string" } },
          nexus_to_trafficking: { type: ["boolean", "null"] },
          dated: { type: ["boolean", "null"] },
          signed: { type: ["boolean", "null"] },
          concerns: { type: "array", items: { type: "string" } }
        }
      }
    }
  },
  required: ["evaluations_found", "items"]
};

const COUNTRY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    country: { type: ["string", "null"] },
    sources_cited: { type: "array", items: { type: "string" } },
    topics_covered: { type: "array", items: { type: "string" } },
    relevant_to_hardship: { type: ["boolean", "null"] },
    addresses_re_trafficking_risk: { type: ["boolean", "null"] },
    addresses_mental_health_care_access: { type: ["boolean", "null"] },
    date_range: { type: ["string", "null"] },
    concerns: { type: "array", items: { type: "string" } }
  }
};

const LEA_INPUT_SCHEMA = {
  type: "object",
  properties: {
    agency_name: { type: ["string", "null"] },
    is_federal_law_enforcement: { type: ["boolean", "null"] },
    is_state_or_local_law_enforcement: { type: ["boolean", "null"] },
    is_qualifying_agency: { type: ["boolean", "null"] },
    officer_name: { type: ["string", "null"] },
    officer_title: { type: ["string", "null"] },
    officer_signed: { type: ["boolean", "null"] },
    signed_date: { type: ["string", "null"] },
    part2_filled: { type: ["boolean", "null"] },
    part2_fields_filled: { type: "array", items: { type: "string" } }
  }
};

const TRANSLATIONS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    foreign_documents_count: { type: "number" },
    documents_with_certified_translation: { type: "number" },
    documents_without_translation: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } }
  },
  required: [
    "foreign_documents_count",
    "documents_with_certified_translation",
    "documents_without_translation",
    "concerns"
  ]
};

const PASSPORT_SIGNATURE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    has_passport_image: { type: "boolean" },
    signed: { type: ["boolean", "null"] },
    // Identidade do titular (página de dados)
    holder_name_seen: { type: ["string", "null"] },
    holder_family_name_seen: { type: ["string", "null"] },
    holder_given_names_seen: { type: ["string", "null"] },
    date_of_birth_seen: { type: ["string", "null"] },
    place_of_birth_seen: { type: ["string", "null"] },
    sex_seen: { type: ["string", "null"], enum: ["M", "F", "X", null] },
    nationality_seen: { type: ["string", "null"] },
    // Documento em si
    passport_number_seen: { type: ["string", "null"] },
    passport_type_seen: { type: ["string", "null"] },
    issuing_country_seen: { type: ["string", "null"] },
    issuing_authority_seen: { type: ["string", "null"] },
    issue_date_seen: { type: ["string", "null"] },
    expiration_date_seen: { type: ["string", "null"] },
    // MRZ (machine readable zone) — útil pra cross-check com checksum
    mrz_line1_seen: { type: ["string", "null"] },
    mrz_line2_seen: { type: ["string", "null"] },
    // Diagnóstico
    quality_issues: { type: "array", items: { type: "string" } },
    notes: { type: ["string", "null"] }
  },
  required: ["has_passport_image"]
};

const PROOF_OF_ADDRESS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    holder_name: { type: ["string", "null"] },
    holder_match: {
      type: ["string", "null"],
      enum: ["principal", "dependent", "no_match", "unknown", null]
    },
    matched_subject_id: { type: ["string", "null"] },
    address: ADDRESS_SCHEMA,
    document_type: {
      type: ["string", "null"],
      enum: ["utility", "lease", "bank_statement", "irs", "government", "other", null]
    },
    document_date: { type: ["string", "null"] },
    notes: { type: ["string", "null"] }
  },
  required: ["found"]
};

// =====================================================================
// System prompts
// =====================================================================

const STRUCTURE_SYSTEM = `Você é um especialista em processos USCIS de imigração humanitária (T-visa, U-visa, VAWA) montados pela Go Visa Law Firm.

Sua tarefa: dado um índice numerado com o início de cada página de um processo compilado, determinar o RANGE DE PÁGINAS de cada documento interno.

Documentos esperados (liste só os presentes):
T-visa:
- I-914: principal (Application for T Nonimmigrant Status)
- I-914A: Supplement A (Family Member of T-1)
- I-914B: Supplement B (Declaration of Law Enforcement Officer)
VAWA:
- I-360: Self-Petition (VAWA Self-Petition)
- I-485: Application to Register Permanent Residence (quando vem junto)
U-visa:
- I-918: principal (Petition for U Nonimmigrant Status)
- I-918A: Supplement A (Qualifying Family Member)
- I-918B: Supplement B (U Nonimmigrant Status Certification, assinado por LEA)
Comuns:
- cover_letter: carta do advogado
- I-192: Advance Permission to Enter as Nonimmigrant (waiver de inadmissibilidade)
- I-765: Employment Authorization
- G-28: Notice of Entry of Appearance as Attorney
- identification: passaporte, RG, docs de ID
- country_conditions: material sobre condições do país de origem (pode não existir em VAWA/U)
- witness_statements: declarações de testemunhas
- medical_records: registros médicos e psicológicos
- proof_of_address: comprovantes de RESIDÊNCIA (endereço onde a pessoa mora). Exemplos:
  * utility bill / fatura de serviço público (luz, água, gás, internet, telefone fixo)
  * lease agreement / contrato de aluguel ou rental agreement
  * bank statement (extrato bancário com endereço)
  * IRS letter / 1040 / W-2 / 1099 (com endereço residencial)
  * voter registration card / cartão de eleitor
  * vehicle registration / DMV correspondence
  * paystub / holerite com endereço
  * school records / matrícula escolar com endereço
  * government correspondence (Social Security letter, USPS COA, etc.)
  IMPORTANTE: comprovante de residência NÃO é documento de identidade. Não confunda com identification.
- story: Declaration of <nome> / Personal Statement (narrativa em primeira pessoa)
- final: final considerations
- other: não se encaixa

REGRAS CRÍTICAS:
- Ignore a Table of Contents (primeiras páginas com índice numerado de itens); mapeie somente os documentos reais.
- I-914A rodapé "Form I-914 Supplement A" — NÃO confunda com I-914.
- I-914B rodapé "Form I-914 Supplement B" — NÃO confunda com I-914.
- I-918A rodapé "Form I-918 Supplement A" — NÃO confunda com I-918.
- I-918B rodapé "Form I-918 Supplement B" — NÃO confunda com I-918.
- Cada form USCIS tem "Page N of M" no rodapé — use pra saber onde um form termina.
- A "story" é narrativa do peticionário (em T-visa é declaração de vítima de tráfico, em VAWA é declaração sobre casamento/abuso, em U-visa é declaração sobre o crime e abuso). Não confunda com witness_statements.
- Cover letter no início do processo frequentemente traz narrativa do caso — se houver Personal Statement / Declaration separada, essa é a story; caso contrário, o cover_letter pode servir como story.

REGRAS PARA AGRUPAMENTO POR SUJEITO (subject_id):
- O peticionário do form principal (I-914 em T-visa, I-918 em U-visa, I-360 em VAWA) recebe subject_id = "principal".
- Cada I-914A representa um dependente — numere "dep_1", "dep_2"... pela ordem de aparição no PDF. Cada I-918A análogo.
- Para I-765, G-28, identification (passaporte), proof_of_address: infira o subject_id pelo nome da pessoa no form. Se for o mesmo nome do principal → "principal". Se bater com nome de algum I-914A/I-918A já mapeado → usar o subject_id daquele dep.
- Se for impossível inferir (nome ilegível ou form genérico), deixar subject_id = null.
- Para identification (passaportes): o subdoc pode conter MÚLTIPLOS passaportes. Liste CADA UM como entrada separada com subject_id apropriado e seu range de páginas próprio. Se houver 3 passaportes (principal + 2 deps), gere 3 entradas com kind="identification".
- Para proof_of_address: holder_name = pessoa identificada → mapear pra subject_id correspondente.
- DECOMPOSIÇÃO DE SEÇÕES MISTAS: seções rotuladas como "Additional ID Documents", "Supporting Documents", "Identification", "Anexos" frequentemente CONTÊM comprovantes de residência grudados com docs de identidade. Quando isso acontecer, gere ENTRADAS SEPARADAS por kind. Exemplo: páginas 169-181 com Birth Certificate (pgs 169-171), Marriage Certificate (172-174) e Utility Bill (175-181) → 2 entradas kind="identification" + 1 entrada kind="proof_of_address".
- Não rotule um subdoc inteiro como "identification" só porque o título genérico sugere isso — olhe o conteúdo página a página e divida pelo tipo real.

Use a tool map_document_structure para reportar o resultado.`;

export async function mapDocumentStructure(pageHeads: string[]): Promise<DocumentStructure | null> {
  const index = pageHeads
    .map((head, i) => `PG ${i + 1}: ${head.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");

  try {
    return await callToolWithDocument<DocumentStructure>({
      systemBlocks: [{ type: "text", text: STRUCTURE_SYSTEM, cacheControl: true }],
      userText: `Abaixo o índice do processo (início de cada página). Use a tool map_document_structure.

Liste os documentos em ordem de aparição. Se houver múltiplos I-914A (um por familiar) ou múltiplos G-28, liste cada um separado.

Para identification (passaportes): se o subdoc contém múltiplos passaportes, gere uma entrada SEPARADA por passaporte (cada um com seu subject_id e seu range próprio).

Para proof_of_address: preencha "holder_name" com o nome do titular identificado no documento; mapeie subject_id pra "principal" ou ao dep correspondente.

ÍNDICE:
${index.slice(0, 180000)}`,
      toolName: "map_document_structure",
      toolDescription:
        "Reporta o range de páginas de cada documento interno presente no processo USCIS, agrupados por sujeito.",
      inputSchema: STRUCTURE_INPUT_SCHEMA,
      maxTokens: 4000,
      operation: "mapDocumentStructure"
    });
  } catch (err) {
    console.error("Falha mapeando estrutura:", String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}

const FORM_EXTRACTOR_SYSTEM = `Você é um extrator de dados de formulários USCIS (imigração EUA) do tipo visto T (tráfico humano).

Você recebe o PDF de UM formulário específico de um processo jurídico e devolve os campos extraídos via tool.

REGRAS:
- Se um campo não aparecer, use null (não invente).
- Datas no formato YYYY-MM-DD quando possível; caso contrário, devolva como aparece no documento.
- Não traduza nomes próprios ou endereços.
- Endereços devem preservar abreviações (Ste, Apt, Flr) e formatação original.
- "In Care Of Name" é campo específico de Safe Mailing Address — não confunda com nome da pessoa.
- Use a visão quando a extração de texto falhar (campos manuscritos, caixas de seleção, assinaturas).

A-NUMBER (Alien Registration Number) — REGRA CRÍTICA:
- O A-Number do APLICANTE aparece repetido em VÁRIAS páginas do formulário (geralmente no cabeçalho/topo de cada página, nos campos de identificação e nas folhas de continuação "Additional Information"). É um número de até 9 dígitos (formato "A-XXXXXXXXX" ou "AXXXXXXXXX").
- ATENÇÃO AO FORMATO EM CAIXAS: nos formulários USCIS os dígitos do A-Number (e do SSN/USCIS Number) costumam aparecer em CAIXAS SEPARADAS, um dígito por caixa, ex: "A- 1 1 1 1 1 1 1" ou "► A- 3 3 3 3 3 3". CONCATENE os dígitos removendo os espaços → "1111111" / "333333". Use a VISÃO do PDF anexo para ler essas caixas — o texto extraído frequentemente não as captura.
- SEMPRE reporte o valor que estiver escrito no campo, MESMO que pareça repetido, sequencial ou "de teste" (ex: 1111111, 2222222, 123456789). NÃO retorne null se houver QUALQUER dígito visível no campo de A-Number. null é APENAS para campo genuinamente em branco.
- Em "a_number" coloque o A-Number do aplicante (o valor que mais se repete ao longo do form). Use null só se o campo estiver realmente vazio em todas as páginas.
- Em "a_numbers_seen" liste TODAS as ocorrências de A-Number que você encontrar NESTE formulário, UMA ENTRADA POR PÁGINA onde o número aparecer, com {value: "<dígitos concatenados>", page: <número da página: 1 para a 1ª página do form, 2 para a 2ª, etc.>}. Se o número aparece em páginas diferentes COM VALORES DIFERENTES, liste cada um com sua página — isso é exatamente o que precisamos detectar (divergência interna do form).
- NÃO inclua em "a_number" nem em "a_numbers_seen" o USCIS Number / A-Number do ADVOGADO/REPRESENTANTE. Na PRIMEIRA PÁGINA de cada formulário aparecem os dados do advogado (nome, USCIS Online Account / USCIS Number, Bar License) — esses números pertencem ao representante legal, NÃO ao aplicante. Ignore-os.`;

const FORM_HINTS: Record<string, string> = {
  "I-914": `Dicas pro I-914:
- "entered_ewi" = true se a pessoa entrou sem inspeção (EWI) nos EUA.
- "inadmissibilities_checked" = grounds marcados/mencionados nas perguntas de admissibilidade.
- "removal_proceedings" = true se indicou estar em processo de remoção.
- "is_us_citizen" = true se o family member é declarado como cidadão americano (USC). Filhos americanos não precisam de I-914A.
- "country_of_residence" = país onde o family member reside. Familiares fora dos EUA aparecem em consular processing.`,
  "I-914A": `"location" = "US" se a pessoa está nos EUA, "abroad" se está no exterior.`,
  "I-914B": `IMPORTANTE para I-914B:
- Part 1 é sobre a VÍTIMA (nome, A-Number, etc).
- Part 2 é sobre o AGENTE DA LEI (Law Enforcement Officer) que assina — tipicamente preenchido pelo órgão, NUNCA deve ser pré-preenchido pelo advogado.
- "part2_filled" = true se QUALQUER campo de Part 2 (Officer Name, Agency, Title, Signature, etc.) estiver preenchido; false se estiver totalmente em branco; null se ambíguo.
- "part2_fields_filled" = lista de campos de Part 2 que você viu preenchidos (ex: ["Officer Full Name", "Agency Name"]).`,
  "I-192": `Para "grounds_of_inadmissibility" liste os motivos marcados no form (ex: "INA 212(a)(6)(A) - entered without inspection", "INA 212(a)(9)(B) - unlawful presence", etc.).`,
  "I-765": `"attorney_bar_number" = Bar Number do advogado no rodapé da pág.1 ("Attorney State Bar Number (if applicable)"). Apenas dígitos. NÃO confundir com o A-Number do cliente.
Categorias válidas em T-visa:
- (c)(25) = T-1 principal; (a)(16) = T-1 ajustando; (c)(25) também cobre alguns; para T-2/3/4/5 derivativos os códigos variam.
- "is_for_principal" = true se o I-765 é do aplicante principal (T-1), false se é de derivativo.
- "category_valid_for_t_visa" = true se a categoria informada faz sentido para T-visa; false se é categoria errada (ex: c(8) asylum).`,
  "G-28": `ATENÇÃO G-28: precisa assinatura TANTO do advogado QUANTO do cliente. Verifique ambas.
- "attorney_bar_number" = o Bar Number / State Bar Number do advogado (campo "Bar Number (if applicable)" ou "State Bar Number"). Apenas os dígitos.`
};

export async function extractFormFromPdf(args: {
  formKind: string;
  pdfBase64: string;
  subject_id?: string | null;
}): Promise<FormData | null> {
  const inputSchema = buildFormInputSchema(args.formKind);
  const hint = FORM_HINTS[args.formKind] ?? "";
  try {
    const data = await callToolWithDocument<FormData>({
      systemBlocks: [{ type: "text", text: FORM_EXTRACTOR_SYSTEM, cacheControl: true }],
      pdfBase64: args.pdfBase64,
      userText: `Formulário: ${args.formKind}

Use a tool extract_form_data para reportar os campos extraídos. Campos ausentes viram null.

${hint}`,
      toolName: "extract_form_data",
      toolDescription: `Reporta os dados extraídos do formulário USCIS ${args.formKind}.`,
      inputSchema,
      maxTokens: 4096,
      operation: `extractFormFromPdf:${args.formKind}`
    });
    if (data && args.subject_id) {
      (data as any)._subject_id = args.subject_id;
    }
    return data;
  } catch (err) {
    console.error(`Falha extraindo ${args.formKind}:`, String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}

export async function extractFormFromText(args: {
  formKind: string;
  text: string;
  pdfBase64?: string;
  subject_id?: string | null;
}): Promise<FormData | null> {
  const inputSchema = buildFormInputSchema(args.formKind);
  const hint = FORM_HINTS[args.formKind] ?? "";
  try {
    const data = await callToolWithDocument<FormData>({
      systemBlocks: [{ type: "text", text: FORM_EXTRACTOR_SYSTEM, cacheControl: true }],
      pdfBase64: args.pdfBase64,
      userText: `Formulário: ${args.formKind}

Use a tool extract_form_data para reportar os campos extraídos. Campos ausentes viram null.

${args.pdfBase64 ? "Use a visão no PDF anexo para verificar campos preenchidos, marcações e assinaturas." : ""}

${hint}

TEXTO DO FORMULÁRIO (extraído do PDF):
"""
${args.text.slice(0, 14000)}
"""`,
      toolName: "extract_form_data",
      toolDescription: `Reporta os dados extraídos do formulário USCIS ${args.formKind}.`,
      inputSchema,
      maxTokens: 4096,
      operation: `extractFormFromText:${args.formKind}`
    });
    if (data && args.subject_id) {
      (data as any)._subject_id = args.subject_id;
    }
    return data;
  } catch (err) {
    console.error(`Falha extraindo ${args.formKind} (texto):`, String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}

const STORY_EXTRACTOR_SYSTEM = `Você é um extrator de fatos narrativos de histórias de clientes de imigração (visto T).
Leia a narrativa do cliente (Declaration/Personal Statement) e extraia fatos que o cliente AFIRMOU sobre si.
Use null para fatos não mencionados. Não invente nada.`;

export async function extractStoryFromText(args: {
  text: string;
  pdfBase64?: string;
  subject_id?: string | null;
}): Promise<StoryFacts | null> {
  const { text, pdfBase64 } = args;
  try {
    const data = await callToolWithDocument<StoryFacts>({
      systemBlocks: [{ type: "text", text: STORY_EXTRACTOR_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `HISTÓRIA DO CLIENTE (texto extraído do PDF, pode estar incompleto se for imagem escaneada — use também a visão no PDF anexo):
"""
${text.slice(0, 20000)}
"""

Use a tool extract_story_facts pra reportar os fatos.

Analise a narrativa como um advogado de imigração sênior verificando elegibilidade ao T-visa:
- "trafficking_type": sexo / trabalho / ambos / unclear.
- "force_mentioned" / "fraud_mentioned" / "coercion_mentioned": um dos três é obrigatório pra caracterizar severe form of trafficking. Retorne true se há exemplos concretos.
- "physical_presence_on_account_of_trafficking": o cliente está nos EUA por causa do tráfico?
- "cooperation_with_lea_mentioned": cooperou com law enforcement? Se exempt (menor de idade ou trauma severo), marcar "cooperation_exempt_reason".
- "extreme_hardship_mentioned": se retornar ao país de origem, sofreria unusual and severe harm? Liste motivos.
- "document_confiscation" / "debt_bondage" / "isolation": indicadores clássicos de tráfico.`,
      toolName: "extract_story_facts",
      toolDescription:
        "Reporta os fatos narrativos extraídos da Declaration/Personal Statement do cliente de T-visa.",
      inputSchema: STORY_FACTS_INPUT_SCHEMA,
      maxTokens: 4000,
      operation: "extractStoryFromText"
    });
    if (data && args.subject_id) {
      (data as any)._subject_id = args.subject_id;
    }
    return data;
  } catch (err) {
    console.error("Falha extraindo história:", String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}

const WITNESS_SYSTEM = `Você é um advogado de imigração analisando Witness Statements em um processo T-visa.
Cada declaração deve: ter nome e assinatura da testemunha, data, cláusula "under penalty of perjury" (28 U.S.C. §1746 ou similar), e atestar fatos específicos relevantes (não apenas "é boa pessoa").`;

export async function analyzeWitnessStatements(pdfBase64: string): Promise<import("../schemas/forms").WitnessStatementsAnalysis | null> {
  try {
    return await callToolWithDocument({
      systemBlocks: [{ type: "text", text: WITNESS_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise as witness statements no PDF anexo. Use a tool report_witness_analysis.

Para "attests_specific_facts", true se a declaração contém fatos concretos (datas, eventos, diálogos, observações diretas). Se for apenas uma carta de caráter ("é boa pessoa"), false.
Para "concerns", liste problemas: falta de assinatura, falta de perjury clause, declaração vaga, testemunha identificada apenas por apelido, etc.

IMPORTANTE: mantenha "topics_covered" e "concerns" curtos (máx 5 items por declaração, cada item ≤ 80 caracteres). Não escreva parágrafos longos — apenas tópicos sintéticos.`,
      toolName: "report_witness_analysis",
      toolDescription: "Reporta a análise das witness statements do processo T-visa.",
      inputSchema: WITNESS_INPUT_SCHEMA,
      maxTokens: 8000,
      operation: "analyzeWitnessStatements"
    });
  } catch (err) {
    console.error("Falha analisando witness statements:", String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}

const MEDICAL_SYSTEM = `Você é um advogado de imigração analisando Medical and Psychological Records em um processo T-visa.
Bom suporte: avaliação por profissional LICENCIADO (psicólogo, psiquiatra, MD), diagnóstico em termos DSM-5 (ex: PTSD, MDD, GAD), nexo explícito com o trafficking event, assinada, datada.`;

export async function analyzeMedicalRecords(pdfBase64: string): Promise<import("../schemas/forms").MedicalAnalysis | null> {
  try {
    return await callToolWithDocument({
      systemBlocks: [{ type: "text", text: MEDICAL_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise os registros médicos/psicológicos. Use a tool report_medical_analysis.

"licensed_professional" = true se profissional tem credencial licenciada (PhD, PsyD, LCSW, MD, LMHC, etc.). Social workers sem licensing não servem pra hardship.
"nexus_to_trafficking" = true se a avaliação conecta o diagnóstico aos eventos de tráfico (não apenas "apresenta sintomas de ansiedade").`,
      toolName: "report_medical_analysis",
      toolDescription: "Reporta a análise dos medical/psychological records do processo T-visa.",
      inputSchema: MEDICAL_INPUT_SCHEMA,
      maxTokens: 3000,
      operation: "analyzeMedicalRecords"
    });
  } catch (err) {
    console.error("Falha analisando medical:", err);
    return null;
  }
}

const COUNTRY_SYSTEM = `Você é um advogado de imigração analisando o material de General Country Conditions em um processo T-visa.
Boa evidência: fontes respeitáveis (DOS Country Reports, Human Rights Watch, Amnesty, UNODC, GAO), recentes (últimos 2-3 anos), cobrindo tópicos relevantes ao hardship do cliente (re-trafficking risk, falta de mental health care, retaliação, impunidade de traficantes).`;

export async function analyzeCountryConditions(pdfBase64: string): Promise<import("../schemas/forms").CountryConditionsAnalysis | null> {
  try {
    return await callToolWithDocument({
      systemBlocks: [{ type: "text", text: COUNTRY_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise o Country Conditions. Use a tool report_country_conditions_analysis.

"concerns" pode incluir: fontes obsoletas (> 3 anos), fontes não respeitáveis, falta de conexão explícita com hardship do cliente, tópicos faltantes.`,
      toolName: "report_country_conditions_analysis",
      toolDescription: "Reporta a análise do material de Country Conditions do processo T-visa.",
      inputSchema: COUNTRY_INPUT_SCHEMA,
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
Parte 2 é do oficial — deve ser preenchida PELA AGÊNCIA, não pelo advogado.`;

export async function analyzeI914BQualification(pdfBase64: string): Promise<import("../schemas/forms").LeaQualification | null> {
  try {
    return await callToolWithDocument({
      systemBlocks: [{ type: "text", text: LEA_QUAL_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise o I-914B. Use a tool report_lea_qualification.

Se nome da agência for um nome de PESSOA FÍSICA (ex: "João da Silva"), isso é erro — provavelmente o advogado preencheu com nome do cliente. is_qualifying_agency=false.`,
      toolName: "report_lea_qualification",
      toolDescription:
        "Reporta a qualificação da Law Enforcement Agency do I-914B (Declaration of Law Enforcement Officer).",
      inputSchema: LEA_INPUT_SCHEMA,
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

Considere a exceção de passaporte ao listar concerns.`;

export async function checkCertifiedTranslations(pdfBase64: string): Promise<import("../schemas/forms").TranslationsCheck | null> {
  try {
    return await callToolWithDocument({
      systemBlocks: [{ type: "text", text: TRANSLATION_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText: `Analise este sub-PDF em busca de documentos que REQUEREM certified translation. Use a tool report_translations_check.

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

IMPORTANTE: "documents_without_translation" NÃO deve incluir passaportes nem IDs. Se você só viu passaporte, "foreign_documents_count" = 0.`,
      toolName: "report_translations_check",
      toolDescription:
        "Reporta o resultado da checagem de certified translations dos documentos estrangeiros do processo.",
      inputSchema: TRANSLATIONS_INPUT_SCHEMA,
      maxTokens: 1500,
      operation: "checkCertifiedTranslations"
    });
  } catch (err) {
    console.error("Falha checando traduções:", err);
    return null;
  }
}

const PASSPORT_CHECKER_SYSTEM = `Você é um analista de documentos de identificação trabalhando na seção "Identification Documents" de um processo USCIS.

Sua tarefa: extrair TODOS os campos visíveis na página de dados do passaporte (e na MRZ) e reportar via tool report_passport_signature_check.

CAMPOS QUE VOCÊ DEVE EXTRAIR (cada um é potencialmente cruzado contra os formulários USCIS — ground truth do passaporte físico):

1. has_passport_image — boolean: você consegue ver a cópia do passaporte?
2. signed — boolean|null: traço/rubrica visível no campo "Assinatura do titular / Signature of bearer / Signature du titulaire". Estrito: só afirme true se VER manuscrita; false se em branco; null se ambíguo.
3. holder_name_seen — string|null: nome COMPLETO como lido na página de dados (geralmente "SOBRENOME, NOMES").
4. holder_family_name_seen — string|null: SOBRENOME (Surname / Apelido / Primer apellido + segundo apellido se hispânico).
5. holder_given_names_seen — string|null: NOMES DE BATISMO (Given names / Nombres / Prénoms). Pode ser composto ("MARIA DAS GRACAS").
6. date_of_birth_seen — string|null: data de nascimento. FORMATO YYYY-MM-DD se possível, senão como aparece (ex: "31 OCT 1960" ou "31/10/1960"). Atenção a formatos: passaportes brasileiros usam DD/MM/YYYY; americanos MM/DD/YYYY; europeus DD MMM YYYY.
7. place_of_birth_seen — string|null: local de nascimento (cidade, estado/província, país). Como aparece.
8. sex_seen — "M"|"F"|"X"|null.
9. nationality_seen — string|null: cidadania declarada no passaporte (ex: "BRA", "BRAZILIAN", "BRASIL").
10. passport_number_seen — string|null: número do documento (geralmente alfanumérico).
11. passport_type_seen — string|null: tipo (P, PD, PS, etc.). "P" é passaporte comum.
12. issuing_country_seen — string|null: código ou nome do país emissor.
13. issuing_authority_seen — string|null: autoridade emissora (ex: "Polícia Federal", "U.S. Department of State").
14. issue_date_seen — string|null: data de emissão (YYYY-MM-DD se possível).
15. expiration_date_seen — string|null: data de expiração (YYYY-MM-DD se possível).
16. mrz_line1_seen / mrz_line2_seen — string|null: as DUAS linhas da MRZ (machine readable zone — sequência de letras/números/<<< no rodapé do passaporte). Útil pra validação por checksum.
17. quality_issues — array de strings: problemas observados (ex: "página parcialmente cortada", "MRZ ilegível", "foto do titular ausente", "passaporte expirado em [data]").
18. notes — string|null: observação curta de contexto.

REGRAS CRÍTICAS:
- NÃO confunda data de nascimento com data de emissão ou expiração.
- NÃO confunda nome do titular com nome do pai/mãe (passaportes brasileiros listam pais).
- Se o sub-PDF tem múltiplos passaportes, foque APENAS no titular esperado (vai ser indicado no userText).
- Em caso de dúvida visual, retorne null em vez de inventar.`;

export interface PassportSignatureCheck {
  has_passport_image: boolean;
  signed: boolean | null;
  // Identidade
  holder_name_seen: string | null;
  holder_family_name_seen?: string | null;
  holder_given_names_seen?: string | null;
  date_of_birth_seen?: string | null;
  place_of_birth_seen?: string | null;
  sex_seen?: "M" | "F" | "X" | null;
  nationality_seen?: string | null;
  // Documento
  passport_number_seen: string | null;
  passport_type_seen?: string | null;
  issuing_country_seen?: string | null;
  issuing_authority_seen?: string | null;
  issue_date_seen?: string | null;
  expiration_date_seen?: string | null;
  // MRZ
  mrz_line1_seen?: string | null;
  mrz_line2_seen?: string | null;
  // Diagnóstico
  quality_issues?: string[];
  notes: string | null;
}

export async function checkPassportSignatureFromPdf(
  pdfBase64: string,
  opts?: { expectedHolderName?: string }
): Promise<PassportSignatureCheck | null> {
  const hint = opts?.expectedHolderName
    ? `\n\nDICA: este sub-PDF pode conter múltiplos passaportes. Extraia APENAS os dados do passaporte cujo titular se chama "${opts.expectedHolderName}". Se houver outros passaportes na mesma seção, ignore-os.`
    : "";
  try {
    return await callToolWithDocument<PassportSignatureCheck>({
      systemBlocks: [
        { type: "text", text: PASSPORT_CHECKER_SYSTEM, cacheControl: true }
      ],
      pdfBase64,
      userText: `Procure a página de dados do passaporte nas páginas deste sub-PDF e EXTRAIA TODOS OS CAMPOS VISÍVEIS via tool report_passport_signature_check.

O passaporte é a fonte da verdade — esses dados serão CRUZADOS com os formulários USCIS pra detectar inconsistências.${hint}`,
      toolName: "report_passport_signature_check",
      toolDescription:
        "Reporta TODOS os dados visíveis na página de dados do passaporte do titular esperado, incluindo identidade, documento e MRZ.",
      inputSchema: PASSPORT_SIGNATURE_INPUT_SCHEMA,
      maxTokens: 1500,
      operation: "checkPassportSignature"
    });
  } catch (err) {
    console.error("Falha na checagem visual do passaporte:", String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}

const PROOF_OF_ADDRESS_SYSTEM = `Você analisa comprovantes de residência (utility bill, lease agreement, bank statement, government correspondence, IRS letter, etc.) anexos a processos de imigração USCIS.

Extraia: nome do titular (holder_name), endereço completo, tipo de documento, data do documento.

REGRAS:
- holder_name é o nome da PESSOA cujo nome aparece no documento como titular/contratante/destinatário.
- document_type: tipo (utility, lease, bank_statement, irs, government, other).
- document_date: data emissão (YYYY-MM-DD).
- Se receber lista de expected_holder_names, indicar holder_match: "principal" | "dependent" | "no_match" | "unknown".`;

export async function analyzeProofOfAddress(args: {
  pdfBase64: string;
  expectedHolderNames?: Array<{ subject_id: string; display_name: string }>;
}): Promise<ProofOfAddressAnalysis | null> {
  const expected = args.expectedHolderNames ?? [];
  try {
    return await callToolWithDocument<ProofOfAddressAnalysis>({
      systemBlocks: [{ type: "text", text: PROOF_OF_ADDRESS_SYSTEM, cacheControl: true }],
      pdfBase64: args.pdfBase64,
      userText: `Analise o comprovante de residência anexo. Use a tool report_proof_of_address_analysis.

${expected.length > 0 ? `Pessoas esperadas no caso (cruze holder_name com elas):\n${expected.map(e => `- ${e.subject_id}: ${e.display_name}`).join("\n")}\n` : ""}`,
      toolName: "report_proof_of_address_analysis",
      toolDescription:
        "Reporta a análise do comprovante de residência (proof of address) anexo ao processo USCIS.",
      inputSchema: PROOF_OF_ADDRESS_INPUT_SCHEMA,
      maxTokens: 1500,
      operation: "analyzeProofOfAddress"
    });
  } catch (err) {
    console.error("Falha analisando proof_of_address:", String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}

export interface FinalSignatureCheck {
  signed: boolean | null;
  signer_name: string | null;
  bar_number_seen: string | null;
}

const FINAL_SIG_INPUT_SCHEMA = {
  type: "object",
  properties: {
    signed: { type: ["boolean", "null"] },
    signer_name: { type: ["string", "null"] },
    bar_number_seen: { type: ["string", "null"] }
  },
  required: ["signed"]
};

const FINAL_SIG_SYSTEM = `Você analisa a página de "Final Considerations" (carta de encerramento do advogado) de um processo USCIS montado pela Go Visa Law Firm.

Essa página é assinada PELO ADVOGADO (ex: Jeffrey Weingrad). Sua tarefa: verificar se há ASSINATURA do advogado na página.

REGRAS:
- signed = true se houver uma assinatura manuscrita/imagem de assinatura do advogado no rodapé; false se o espaço de assinatura estiver em branco; null se não der pra avaliar.
- signer_name = nome impresso do signatário (ex: "Jeffrey Weingrad"), se visível.
- bar_number_seen = o Bar Number do advogado que aparecer na página (apenas dígitos), se houver.
- Use a VISÃO no PDF anexo para enxergar a assinatura.`;

export async function checkFinalConsiderationsSignature(
  pdfBase64: string
): Promise<FinalSignatureCheck | null> {
  try {
    return await callToolWithDocument<FinalSignatureCheck>({
      systemBlocks: [{ type: "text", text: FINAL_SIG_SYSTEM, cacheControl: true }],
      pdfBase64,
      userText:
        "Verifique se a página de Final Considerations tem a assinatura do advogado. Use a tool report_final_signature.",
      toolName: "report_final_signature",
      toolDescription:
        "Reporta se a página de Final Considerations tem assinatura do advogado, o nome do signatário e o bar number visível.",
      inputSchema: FINAL_SIG_INPUT_SCHEMA,
      maxTokens: 800,
      operation: "checkFinalConsiderationsSignature"
    });
  } catch (err) {
    console.error("Falha checando assinatura final:", String((err as any)?.message ?? err).slice(0, 200));
    return null;
  }
}
