import { z } from "zod";

export const AddressSchema = z.object({
  in_care_of: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  apt_ste_flr: z.enum(["Apt", "Ste", "Flr"]).nullable().optional(),
  apt_number: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  country: z.string().nullable().optional()
});
export type Address = z.infer<typeof AddressSchema>;

export const SignatureSchema = z.object({
  signed: z.boolean().nullable().optional(),
  name_printed: z.string().nullable().optional(),
  date_signed: z.string().nullable().optional()
});
export type Signature = z.infer<typeof SignatureSchema>;

export const PersonSchema = z.object({
  family_name: z.string().nullable().optional(),
  given_name: z.string().nullable().optional(),
  middle_name: z.string().nullable().optional(),
  other_names: z.array(z.string()).default([]),
  date_of_birth: z.string().nullable().optional(),
  country_of_birth: z.string().nullable().optional(),
  country_of_citizenship: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  marital_status: z.string().nullable().optional(),
  a_number: z.string().nullable().optional(),
  // Todas as ocorrências de A-Number vistas neste formulário (uma por página
  // onde o número aparece). Permite detectar divergência DENTRO do mesmo form
  // (ex: I-192 pág.2 != pág.9) e ENTRE forms do mesmo sujeito. NÃO inclui o
  // USCIS Number do advogado (cabeçalho da pág.1). Vide regra applyANumberConsistency.
  a_numbers_seen: z
    .array(
      z.object({
        value: z.string(),
        page: z.union([z.string(), z.number()]).nullable().optional()
      })
    )
    .default([]),
  uscis_online_account: z.string().nullable().optional(),
  ssn: z.string().nullable().optional(),
  passport_number: z.string().nullable().optional(),
  passport_country: z.string().nullable().optional(),
  passport_issue_date: z.string().nullable().optional(),
  passport_expiration_date: z.string().nullable().optional(),
  passport_signed: z.boolean().nullable().optional()
});
export type Person = z.infer<typeof PersonSchema>;

export const EntrySchema = z.object({
  last_entry_date: z.string().nullable().optional(),
  last_entry_place: z.string().nullable().optional(),
  last_entry_status: z.string().nullable().optional(),
  i94_number: z.string().nullable().optional(),
  status_at_entry: z.string().nullable().optional(),
  visa_used: z.string().nullable().optional(),
  expiration_of_authorized_stay: z.string().nullable().optional(),
  entered_ewi: z.boolean().nullable().optional(),
  travel_history: z
    .array(
      z.object({
        date: z.string().nullable().optional(),
        direction: z.enum(["entry", "exit"]).nullable().optional(),
        port: z.string().nullable().optional()
      })
    )
    .default([])
});

export const FormMetaSchema = z.object({
  edition_date: z.string().nullable().optional(),
  applicant_signature: SignatureSchema.optional(),
  interpreter_used: z.boolean().nullable().optional(),
  interpreter_signature: SignatureSchema.optional(),
  preparer_used: z.boolean().nullable().optional(),
  preparer_signature: SignatureSchema.optional()
});

export const I914Schema = z.object({
  form: z.literal("I-914"),
  meta: FormMetaSchema.optional(),
  person: PersonSchema,
  physical_address: AddressSchema.optional(),
  mailing_address: AddressSchema.optional(),
  safe_mailing_address: AddressSchema.optional(),
  entry: EntrySchema.optional(),
  family_members_included: z
    .array(
      z.object({
        relationship: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        date_of_birth: z.string().nullable().optional(),
        marital_status: z.string().nullable().optional(),
        country_of_citizenship: z.string().nullable().optional(),
        country_of_residence: z.string().nullable().optional(),
        is_us_citizen: z.boolean().nullable().optional()
      })
    )
    .default([]),
  inadmissibilities_checked: z.array(z.string()).default([]),
  prior_applications: z
    .array(
      z.object({
        type: z.string().nullable().optional(),
        outcome: z.string().nullable().optional(),
        date: z.string().nullable().optional()
      })
    )
    .default([]),
  removal_proceedings: z.boolean().nullable().optional(),
  criminal_history_disclosed: z.boolean().nullable().optional()
});

export const I914ASchema = z.object({
  form: z.literal("I-914A"),
  meta: FormMetaSchema.optional(),
  principal_applicant: PersonSchema.partial(),
  family_member: PersonSchema,
  relationship_to_principal: z.string().nullable().optional(),
  relationship_start_date: z.string().nullable().optional(),
  relationship_evidence_mentioned: z.array(z.string()).default([]),
  location: z.enum(["US", "abroad"]).nullable().optional(),
  physical_address: AddressSchema.optional(),
  safe_mailing_address: AddressSchema.optional()
});

export const I914BSchema = z.object({
  form: z.literal("I-914B"),
  meta: FormMetaSchema.optional(),
  law_enforcement_agency: z.string().nullable().optional(),
  agency_type: z.string().nullable().optional(),
  is_qualifying_agency: z.boolean().nullable().optional(),
  officer_name: z.string().nullable().optional(),
  officer_title: z.string().nullable().optional(),
  officer_signature: SignatureSchema.optional(),
  victim_name: z.string().nullable().optional(),
  signed_date: z.string().nullable().optional(),
  part2_filled: z.boolean().nullable().optional(),
  part2_fields_filled: z.array(z.string()).default([])
});

export const I192Schema = z.object({
  form: z.literal("I-192"),
  meta: FormMetaSchema.optional(),
  person: PersonSchema,
  physical_address: AddressSchema.optional(),
  safe_mailing_address: AddressSchema.optional(),
  grounds_of_inadmissibility: z.array(z.string()).default([]),
  waiver_justification_summary: z.string().nullable().optional()
});

export const I765Schema = z.object({
  form: z.literal("I-765"),
  meta: FormMetaSchema.optional(),
  person: PersonSchema,
  physical_address: AddressSchema.optional(),
  mailing_address: AddressSchema.optional(),
  eligibility_category: z.string().nullable().optional(),
  last_employer: z.string().nullable().optional(),
  is_for_principal: z.boolean().nullable().optional(),
  category_valid_for_t_visa: z.boolean().nullable().optional(),
  // Bar Number do advogado/representante (rodapé da pág.1: "Attorney State Bar Number").
  attorney_bar_number: z.string().nullable().optional()
});

export const G28Schema = z.object({
  form: z.literal("G-28"),
  meta: FormMetaSchema.optional(),
  attorney_name: z.string().nullable().optional(),
  attorney_firm: z.string().nullable().optional(),
  attorney_bar_number: z.string().nullable().optional(),
  attorney_address: AddressSchema.optional(),
  attorney_signature: SignatureSchema.optional(),
  client_name: z.string().nullable().optional(),
  client_a_number: z.string().nullable().optional(),
  client_signature: SignatureSchema.optional(),
  signed_date: z.string().nullable().optional()
});

export const FormDataSchema = z.discriminatedUnion("form", [
  I914Schema,
  I914ASchema,
  I914BSchema,
  I192Schema,
  I765Schema,
  G28Schema
]);
export type FormData = z.infer<typeof FormDataSchema>;

export const StoryFactsSchema = z.object({
  full_name: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  country_of_origin: z.string().nullable().optional(),
  marital_status: z.string().nullable().optional(),
  spouse_name: z.string().nullable().optional(),
  children: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
        date_of_birth: z.string().nullable().optional(),
        marital_status: z.string().nullable().optional()
      })
    )
    .default([]),
  year_entered_us: z.string().nullable().optional(),
  port_of_entry: z.string().nullable().optional(),
  entry_method: z.string().nullable().optional(),
  employers_mentioned: z.array(z.string()).default([]),
  cities_lived_in_us: z.array(z.string()).default([]),
  passport_number_mentioned: z.string().nullable().optional(),
  key_dates: z.array(z.object({ event: z.string(), date: z.string() })).default([]),
  trafficking_type: z.enum(["sex", "labor", "both", "unclear"]).nullable().optional(),
  force_mentioned: z.boolean().nullable().optional(),
  force_examples: z.array(z.string()).default([]),
  fraud_mentioned: z.boolean().nullable().optional(),
  fraud_examples: z.array(z.string()).default([]),
  coercion_mentioned: z.boolean().nullable().optional(),
  coercion_examples: z.array(z.string()).default([]),
  traffickers_identified: z.array(z.string()).default([]),
  trafficking_locations: z.array(z.string()).default([]),
  physical_presence_on_account_of_trafficking: z.boolean().nullable().optional(),
  cooperation_with_lea_mentioned: z.boolean().nullable().optional(),
  cooperation_details: z.string().nullable().optional(),
  cooperation_exempt_reason: z.string().nullable().optional(),
  extreme_hardship_mentioned: z.boolean().nullable().optional(),
  hardship_reasons: z.array(z.string()).default([]),
  fears_returning: z.boolean().nullable().optional(),
  prior_immigration_history: z.string().nullable().optional(),
  trauma_described: z.boolean().nullable().optional(),
  document_confiscation_mentioned: z.boolean().nullable().optional(),
  debt_bondage_mentioned: z.boolean().nullable().optional(),
  isolation_mentioned: z.boolean().nullable().optional()
});
export type StoryFacts = z.infer<typeof StoryFactsSchema>;

export const WitnessStatementsAnalysisSchema = z.object({
  statements_found: z.number(),
  items: z
    .array(
      z.object({
        witness_name: z.string().nullable().optional(),
        relationship_to_applicant: z.string().nullable().optional(),
        signed: z.boolean().nullable().optional(),
        dated: z.boolean().nullable().optional(),
        has_perjury_clause: z.boolean().nullable().optional(),
        attests_specific_facts: z.boolean().nullable().optional(),
        topics_covered: z.array(z.string()).default([]),
        concerns: z.array(z.string()).default([])
      })
    )
    .default([])
});
export type WitnessStatementsAnalysis = z.infer<typeof WitnessStatementsAnalysisSchema>;

export const MedicalAnalysisSchema = z.object({
  evaluations_found: z.number(),
  items: z
    .array(
      z.object({
        provider_name: z.string().nullable().optional(),
        provider_credential: z.string().nullable().optional(),
        licensed_professional: z.boolean().nullable().optional(),
        dsm5_diagnosis: z.array(z.string()).default([]),
        nexus_to_trafficking: z.boolean().nullable().optional(),
        dated: z.boolean().nullable().optional(),
        signed: z.boolean().nullable().optional(),
        concerns: z.array(z.string()).default([])
      })
    )
    .default([])
});
export type MedicalAnalysis = z.infer<typeof MedicalAnalysisSchema>;

export const CountryConditionsAnalysisSchema = z.object({
  country: z.string().nullable().optional(),
  sources_cited: z.array(z.string()).default([]),
  topics_covered: z.array(z.string()).default([]),
  relevant_to_hardship: z.boolean().nullable().optional(),
  addresses_re_trafficking_risk: z.boolean().nullable().optional(),
  addresses_mental_health_care_access: z.boolean().nullable().optional(),
  date_range: z.string().nullable().optional(),
  concerns: z.array(z.string()).default([])
});
export type CountryConditionsAnalysis = z.infer<typeof CountryConditionsAnalysisSchema>;

export const LeaQualificationSchema = z.object({
  agency_name: z.string().nullable().optional(),
  is_federal_law_enforcement: z.boolean().nullable().optional(),
  is_state_or_local_law_enforcement: z.boolean().nullable().optional(),
  is_qualifying_agency: z.boolean().nullable().optional(),
  officer_name: z.string().nullable().optional(),
  officer_title: z.string().nullable().optional(),
  officer_signed: z.boolean().nullable().optional(),
  signed_date: z.string().nullable().optional(),
  part2_filled: z.boolean().nullable().optional(),
  part2_fields_filled: z.array(z.string()).default([])
});
export type LeaQualification = z.infer<typeof LeaQualificationSchema>;

export const TranslationsCheckSchema = z.object({
  foreign_documents_count: z.number(),
  documents_with_certified_translation: z.number(),
  documents_without_translation: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([])
});
export type TranslationsCheck = z.infer<typeof TranslationsCheckSchema>;

export const SubjectSchema = z.object({
  id: z.string(),
  role: z.enum(["principal", "dependent"]),
  display_name: z.string(),
  family_name: z.string().nullable().optional(),
  given_name: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  country_of_citizenship: z.string().nullable().optional(),
  relationship_to_principal: z.string().nullable().optional(),
  /** A-Number da PESSOA (item 4, 10/06): cada sujeito carrega o próprio A#. */
  a_number: z.string().nullable().optional(),
  /** Cidadania americana detectada (cluster validator / I-914 family members). */
  is_us_citizen: z.boolean().nullable().optional()
});
export type Subject = z.infer<typeof SubjectSchema>;

export const ProofOfAddressAnalysisSchema = z.object({
  found: z.boolean(),
  holder_name: z.string().nullable().optional(),
  holder_match: z.enum(["principal", "dependent", "no_match", "unknown"]).nullable().optional(),
  matched_subject_id: z.string().nullable().optional(),
  address: AddressSchema.optional(),
  document_type: z.string().nullable().optional(),
  document_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional()
});
export type ProofOfAddressAnalysis = z.infer<typeof ProofOfAddressAnalysisSchema>;

export type FindingSeverity = "critica" | "alta" | "media" | "baixa";
export type FindingTier = "tier1_filing" | "tier2_substantivo" | "tier3_estrategico";
export type FindingCategory =
  | "divergencia"
  | "campo_suspeito"
  | "campo_vazio"
  | "regra_govisa"
  | "elegibilidade"
  | "credibilidade"
  | "suporte_documental"
  | "assinatura"
  | "estrategia"
  | "cross_narrative";

export const FindingSchema = z.object({
  severity: z.enum(["critica", "alta", "media", "baixa"]),
  tier: z.enum(["tier1_filing", "tier2_substantivo", "tier3_estrategico"]),
  category: z.enum([
    "divergencia",
    "campo_suspeito",
    "campo_vazio",
    "regra_govisa",
    "elegibilidade",
    "credibilidade",
    "suporte_documental",
    "assinatura",
    "estrategia",
    "cross_narrative"
  ]),
  field: z.string(),
  form: z.string().nullable().optional(),
  expected: z.string().nullable().optional(),
  found: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  explanation: z.string(),
  recommendation: z.string().nullable().optional(),
  rule_id: z.string().optional(),
  subject_id: z.string().nullable().optional(),
  prompt_version: z.string().optional()
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewReportSchema = z.object({
  client_name: z.string().nullable().optional(),
  forms_detected: z.array(z.string()),
  subjects: z.array(SubjectSchema).default([]),
  findings: z.array(FindingSchema),
  summary: z.object({
    total: z.number(),
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    by_tier: z.object({
      tier1_filing: z.number(),
      tier2_substantivo: z.number(),
      tier3_estrategico: z.number()
    }),
    by_subject: z.record(z.string(), z.number()).optional()
  }),
  proof_of_address: ProofOfAddressAnalysisSchema.nullable().optional()
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

export type FeedbackErrorType =
  | "falso_positivo"
  | "categoria_errada"
  | "severidade_errada"
  | "explicacao_imprecisa"
  | "recomendacao_errada"
  | "outro";

export const FeedbackErrorTypeValues: FeedbackErrorType[] = [
  "falso_positivo",
  "categoria_errada",
  "severidade_errada",
  "explicacao_imprecisa",
  "recomendacao_errada",
  "outro"
];
