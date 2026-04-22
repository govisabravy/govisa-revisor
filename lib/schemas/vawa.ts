import { z } from "zod";
import { AddressSchema, FormMetaSchema, PersonSchema, SignatureSchema } from "./forms";

export const I360Schema = z.object({
  form: z.literal("I-360"),
  meta: FormMetaSchema.optional(),
  person: PersonSchema,
  physical_address: AddressSchema.optional(),
  safe_mailing_address: AddressSchema.optional(),
  classification: z.string().nullable().optional(),
  abuser_name: z.string().nullable().optional(),
  abuser_immigration_status: z.enum(["USC", "LPR", "unknown"]).nullable().optional(),
  relationship_to_abuser: z.enum(["spouse", "former_spouse", "parent", "child"]).nullable().optional(),
  marriage_date: z.string().nullable().optional(),
  divorce_date: z.string().nullable().optional(),
  resided_with_abuser: z.boolean().nullable().optional(),
  good_moral_character_declared: z.boolean().nullable().optional(),
  children_included: z.array(z.object({
    name: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional()
  })).default([])
});

export const VawaStoryFactsSchema = z.object({
  full_name: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  country_of_origin: z.string().nullable().optional(),
  year_entered_us: z.string().nullable().optional(),
  current_marital_status: z.string().nullable().optional(),
  abuser_name: z.string().nullable().optional(),
  abuser_is_usc_or_lpr: z.boolean().nullable().optional(),
  marriage_date: z.string().nullable().optional(),
  marriage_location: z.string().nullable().optional(),
  divorce_date: z.string().nullable().optional(),
  good_faith_marriage_indicators: z.array(z.string()).default([]),
  battery_or_extreme_cruelty_mentioned: z.boolean().nullable().optional(),
  abuse_types_mentioned: z.array(z.string()).default([]),
  abuse_examples: z.array(z.string()).default([]),
  resided_with_abuser_at_any_point: z.boolean().nullable().optional(),
  cohabitation_evidence: z.array(z.string()).default([]),
  good_moral_character_concerns: z.array(z.string()).default([]),
  extreme_hardship_mentioned: z.boolean().nullable().optional(),
  hardship_reasons: z.array(z.string()).default([]),
  children: z.array(z.object({
    name: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
    marital_status: z.string().nullable().optional()
  })).default([]),
  key_dates: z.array(z.object({ event: z.string(), date: z.string() })).default([])
});
export type VawaStoryFacts = z.infer<typeof VawaStoryFactsSchema>;
export type I360Form = z.infer<typeof I360Schema>;
