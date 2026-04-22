import { z } from "zod";
import { AddressSchema, FormMetaSchema, PersonSchema, SignatureSchema } from "./forms";

export const I918Schema = z.object({
  form: z.literal("I-918"),
  meta: FormMetaSchema.optional(),
  person: PersonSchema,
  physical_address: AddressSchema.optional(),
  safe_mailing_address: AddressSchema.optional(),
  qualifying_criminal_activity: z.array(z.string()).default([]),
  inadmissibility_requires_waiver: z.boolean().nullable().optional(),
  family_members_included: z.array(z.object({
    relationship: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional()
  })).default([])
});

export const I918ASchema = z.object({
  form: z.literal("I-918A"),
  meta: FormMetaSchema.optional(),
  principal_applicant: PersonSchema.partial(),
  family_member: PersonSchema,
  relationship_to_principal: z.string().nullable().optional(),
  relationship_evidence_mentioned: z.array(z.string()).default([]),
  physical_address: AddressSchema.optional(),
  safe_mailing_address: AddressSchema.optional()
});

export const I918BSchema = z.object({
  form: z.literal("I-918B"),
  meta: FormMetaSchema.optional(),
  certifying_agency: z.string().nullable().optional(),
  is_qualifying_agency: z.boolean().nullable().optional(),
  certifying_official_name: z.string().nullable().optional(),
  certifying_official_title: z.string().nullable().optional(),
  signature: z.object({
    signed: z.boolean().nullable().optional(),
    date_signed: z.string().nullable().optional()
  }).optional(),
  helpfulness_confirmed: z.boolean().nullable().optional(),
  criminal_activity_listed: z.array(z.string()).default([]),
  case_status: z.string().nullable().optional(),
  victim_name: z.string().nullable().optional()
});

export const UVisaStoryFactsSchema = z.object({
  full_name: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  country_of_origin: z.string().nullable().optional(),
  current_marital_status: z.string().nullable().optional(),
  year_entered_us: z.string().nullable().optional(),
  qualifying_criminal_activity_mentioned: z.array(z.string()).default([]),
  substantial_physical_abuse_mentioned: z.boolean().nullable().optional(),
  substantial_mental_abuse_mentioned: z.boolean().nullable().optional(),
  abuse_examples: z.array(z.string()).default([]),
  cooperation_with_lea_status: z.enum(["past", "ongoing", "likely_future", "none"]).nullable().optional(),
  cooperation_details: z.string().nullable().optional(),
  reported_to_lea_date: z.string().nullable().optional(),
  lea_agency_mentioned: z.string().nullable().optional(),
  case_number_mentioned: z.string().nullable().optional(),
  injuries_mentioned: z.array(z.string()).default([]),
  psychological_impact: z.array(z.string()).default([]),
  children: z.array(z.object({
    name: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
    marital_status: z.string().nullable().optional()
  })).default([]),
  key_dates: z.array(z.object({ event: z.string(), date: z.string() })).default([])
});
export type UVisaStoryFacts = z.infer<typeof UVisaStoryFactsSchema>;
export type I918Form = z.infer<typeof I918Schema>;
export type I918AForm = z.infer<typeof I918ASchema>;
export type I918BForm = z.infer<typeof I918BSchema>;
