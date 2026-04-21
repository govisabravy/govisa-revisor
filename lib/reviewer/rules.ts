import type {
  Address,
  CountryConditionsAnalysis,
  Finding,
  FormData,
  LeaQualification,
  MedicalAnalysis,
  Signature,
  StoryFacts,
  TranslationsCheck,
  WitnessStatementsAnalysis
} from "../schemas/forms";
import type { PassportSignatureCheck } from "./claude";

export const GOVISA_ADDRESS = {
  in_care_of: "GO VISA LAW FIRM",
  street: "429 SOUTH KELLER ROAD",
  apt_ste_flr: "Ste" as const,
  apt_number: "200A",
  city: "ORLANDO",
  state: "FL",
  zip: "32810"
};

function norm(v?: string | null): string {
  return (v ?? "").toString().trim().toUpperCase().replace(/\s+/g, " ");
}

function sameAddress(a: Address | undefined | null, ref = GOVISA_ADDRESS): boolean {
  if (!a) return false;
  return (
    norm(a.street) === norm(ref.street) &&
    norm(a.apt_number) === norm(ref.apt_number) &&
    norm(a.city) === norm(ref.city) &&
    norm(a.state) === norm(ref.state) &&
    norm(a.zip) === norm(ref.zip)
  );
}

function addrToStr(a?: Address | null | typeof GOVISA_ADDRESS): string {
  if (!a) return "(vazio)";
  const any = a as any;
  return [
    any.in_care_of ? `c/o ${any.in_care_of}` : "",
    any.street,
    any.apt_ste_flr && any.apt_number ? `${any.apt_ste_flr} ${any.apt_number}` : "",
    [any.city, any.state, any.zip].filter(Boolean).join(", ")
  ]
    .filter(Boolean)
    .join(" — ");
}

function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const br = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function ageAtDate(dob?: string | null, at: Date = new Date()): number | null {
  const d = parseDate(dob);
  if (!d) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age--;
  return age;
}

function normalizeMarital(v?: string | null): string | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s.includes("single") || s.includes("solteir")) return "solteiro";
  if (s.includes("married") || s.includes("casad")) return "casado";
  if (s.includes("divorc")) return "divorciado";
  if (s.includes("widow") || s.includes("viuv")) return "viuvo";
  if (s.includes("common") || s.includes("uniao") || s.includes("união")) return "uniao_estavel";
  return s;
}

function isUnmarried(v?: string | null): boolean {
  const n = normalizeMarital(v);
  return n === "solteiro" || n === "divorciado" || n === "viuvo";
}

function pushIf(condition: boolean, finding: Finding, out: Finding[]): void {
  if (condition) out.push(finding);
}

function sigIncomplete(sig: Signature | undefined): string[] {
  const missing: string[] = [];
  if (!sig) return ["bloco de assinatura não encontrado"];
  if (sig.signed !== true) missing.push("assinatura");
  if (!sig.date_signed) missing.push("data da assinatura");
  return missing;
}

export interface RulesInput {
  forms: FormData[];
  story: StoryFacts | null;
  passportCheck?: PassportSignatureCheck | null;
  witnessAnalysis?: WitnessStatementsAnalysis | null;
  medicalAnalysis?: MedicalAnalysis | null;
  countryAnalysis?: CountryConditionsAnalysis | null;
  leaQualification?: LeaQualification | null;
  translations?: TranslationsCheck | null;
  mode?: "draft" | "final";
}

export function applyGovisaRules(args: RulesInput): Finding[] {
  const out: Finding[] = [];
  const {
    forms,
    story,
    passportCheck,
    witnessAnalysis,
    medicalAnalysis,
    countryAnalysis,
    leaQualification,
    translations,
    mode = "draft"
  } = args;
  const isDraft = mode === "draft";

  for (const f of forms) {
    const formName = f.form;

    if ("physical_address" in f && f.physical_address !== undefined) {
      pushIf(
        !sameAddress(f.physical_address),
        {
          severity: "critica",
          tier: "tier1_filing",
          category: "regra_govisa",
          field: "Physical Address",
          form: formName,
          expected: addrToStr(GOVISA_ADDRESS),
          found: addrToStr(f.physical_address),
          source: formName,
          explanation:
            "Physical Address deve ser o endereço da Go Visa (429 S Keller Rd, Ste 200A, Orlando, FL 32810).",
          recommendation: "Atualizar Physical Address para o endereço da firma."
        },
        out
      );
    }

    if ("safe_mailing_address" in f && f.safe_mailing_address !== undefined) {
      const sma = f.safe_mailing_address;
      pushIf(
        !sameAddress(sma),
        {
          severity: "critica",
          tier: "tier1_filing",
          category: "regra_govisa",
          field: "Safe Mailing Address",
          form: formName,
          expected: addrToStr(GOVISA_ADDRESS),
          found: addrToStr(sma),
          source: formName,
          explanation: "Safe Mailing Address deve apontar para a Go Visa.",
          recommendation: "Preencher Safe Mailing Address com endereço da firma + c/o GO VISA LAW FIRM."
        },
        out
      );
      if (sma && norm(sma.in_care_of) !== norm(GOVISA_ADDRESS.in_care_of)) {
        out.push({
          severity: "alta",
          tier: "tier1_filing",
          category: "regra_govisa",
          field: "In Care Of Name",
          form: formName,
          expected: GOVISA_ADDRESS.in_care_of,
          found: sma?.in_care_of ?? "(vazio)",
          source: formName,
          explanation: "In Care Of Name deve ser GO VISA LAW FIRM."
        });
      }
    }

    if ("mailing_address" in f && f.mailing_address !== undefined && f.mailing_address) {
      pushIf(
        !sameAddress(f.mailing_address),
        {
          severity: "alta",
          tier: "tier1_filing",
          category: "regra_govisa",
          field: "Mailing Address",
          form: formName,
          expected: addrToStr(GOVISA_ADDRESS),
          found: addrToStr(f.mailing_address),
          source: formName,
          explanation: "Mailing Address deve apontar para a Go Visa."
        },
        out
      );
    }

    if ("person" in f && f.person) {
      const p = f.person;
      const checks: Array<[string, string | null | undefined, "alta" | "media"]> = [
        ["Family Name", p.family_name, "alta"],
        ["Given Name", p.given_name, "alta"],
        ["Date of Birth", p.date_of_birth, "alta"],
        ["Country of Birth", p.country_of_birth, "media"],
        ["Passport Number", p.passport_number, "media"]
      ];
      for (const [label, value, sev] of checks) {
        if (!value) {
          out.push({
            severity: sev,
            tier: "tier1_filing",
            category: "campo_vazio",
            field: label,
            form: formName,
            explanation: `${label} não preenchido.`
          });
        }
      }
      if (p.ssn === null || p.ssn === undefined || p.ssn === "") {
        out.push({
          severity: "baixa",
          tier: "tier1_filing",
          category: "campo_vazio",
          field: "SSN",
          form: formName,
          explanation: "SSN em branco. Se o cliente não tem SSN, marcar explicitamente 'None' ao invés de deixar em branco."
        });
      }
    }

    if ("meta" in f && f.meta && !isDraft) {
      const m = f.meta;
      const appMissing = sigIncomplete(m.applicant_signature);
      if (appMissing.length > 0 && f.form !== "I-914B") {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "assinatura",
          field: "Applicant Signature",
          form: formName,
          found: `Faltando: ${appMissing.join(", ")}`,
          explanation: "Assinatura do requerente ausente ou incompleta. Sem isso, USCIS rejeita o form.",
          recommendation: "Coletar assinatura + data do requerente antes do protocolo."
        });
      }
      if (m.interpreter_used === true) {
        const im = sigIncomplete(m.interpreter_signature);
        if (im.length > 0) {
          out.push({
            severity: "critica",
            tier: "tier1_filing",
            category: "assinatura",
            field: "Interpreter Signature",
            form: formName,
            found: `Faltando: ${im.join(", ")}`,
            explanation:
              "Formulário indica uso de intérprete, mas a declaração do intérprete não está completa."
          });
        }
      }
      if (m.preparer_used === true) {
        const pm = sigIncomplete(m.preparer_signature);
        if (pm.length > 0) {
          out.push({
            severity: "alta",
            tier: "tier1_filing",
            category: "assinatura",
            field: "Preparer Signature",
            form: formName,
            found: `Faltando: ${pm.join(", ")}`,
            explanation: "Declaração do preparer incompleta."
          });
        }
      }
    }
  }

  const g28s = forms.filter((f): f is Extract<FormData, { form: "G-28" }> => f.form === "G-28");
  if (!isDraft) {
    for (const g of g28s) {
      const clientSig = sigIncomplete(g.client_signature);
      if (clientSig.length > 0) {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "assinatura",
          field: "G-28 — Assinatura do Cliente",
          form: "G-28",
          found: `Faltando: ${clientSig.join(", ")}`,
          explanation: "G-28 exige assinatura do cliente (Parte 4). Sem isso o G-28 é inválido."
        });
      }
      const attySig = sigIncomplete(g.attorney_signature);
      if (attySig.length > 0) {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "assinatura",
          field: "G-28 — Assinatura do Advogado",
          form: "G-28",
          found: `Faltando: ${attySig.join(", ")}`,
          explanation: "G-28 exige assinatura do advogado (Parte 5)."
        });
      }
    }
  } else {
    out.push({
      severity: "baixa",
      tier: "tier3_estrategico",
      category: "estrategia",
      field: "Assinaturas (modo draft)",
      explanation:
        "Modo DRAFT ativo: a verificação de assinaturas foi suprimida. Antes do protocolo na USCIS, coletar assinaturas do cliente em todos os formulários, G-28, intérprete e preparer quando aplicável."
    });
  }

  const i914 = forms.find((f): f is Extract<FormData, { form: "I-914" }> => f.form === "I-914");
  const i914a = forms.filter((f): f is Extract<FormData, { form: "I-914A" }> => f.form === "I-914A");
  const i914b = forms.find((f): f is Extract<FormData, { form: "I-914B" }> => f.form === "I-914B");
  const i192 = forms.find((f): f is Extract<FormData, { form: "I-192" }> => f.form === "I-192");
  const i765s = forms.filter((f): f is Extract<FormData, { form: "I-765" }> => f.form === "I-765");

  if (i914b) {
    if (i914b.part2_filled === true) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "regra_govisa",
        field: "I-914B — Part 2 (Law Enforcement)",
        form: "I-914B",
        expected: "Parte 2 em branco (a ser preenchida pela agência)",
        found:
          (i914b.part2_fields_filled ?? []).length > 0
            ? `Preenchido: ${(i914b.part2_fields_filled ?? []).join("; ")}`
            : "Preenchido",
        source: "I-914B",
        explanation:
          "Parte 2 do I-914B deve estar em branco no envio pela Go Visa. Ela é preenchida pelo órgão de law enforcement (agente certificador). O advogado não preenche.",
        recommendation: "Apagar conteúdo da Parte 2 antes de enviar o I-914B à agência para certificação."
      });
    }
    if (leaQualification?.is_qualifying_agency === false) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "I-914B — Agência Qualificada",
        form: "I-914B",
        found: leaQualification.agency_name ?? "(não identificada)",
        explanation:
          "Agência indicada no I-914B não é uma qualifying law enforcement agency segundo 8 CFR 214.11(h). T-visa exige certificação por agência federal/estadual/local de law enforcement, DOJ, DOL, EEOC, ou similar.",
        recommendation:
          "Substituir certificação por agência qualificada OU documentar cooperation por secondary evidence com justificativa."
      });
    }
    if (leaQualification?.officer_signed === false && !isDraft) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "assinatura",
        field: "I-914B — Assinatura do Officer",
        form: "I-914B",
        explanation: "I-914B precisa da assinatura do Law Enforcement Officer certificador."
      });
    }
  } else {
    if (story?.cooperation_with_lea_mentioned === true && !story.cooperation_exempt_reason) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Cooperation with LEA",
        form: null,
        explanation:
          "História menciona cooperação com LEA mas não há I-914B no processo e não há justificativa de isenção.",
        recommendation: "Obter I-914B assinado pela agência OU declaração alternativa com secondary evidence."
      });
    }
    if (story?.cooperation_exempt_reason) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Cooperation exemption",
        form: null,
        explanation: `Cliente alega isenção de cooperation (${story.cooperation_exempt_reason}). Garantir que a isenção está documentada na história e suportada por evidências (idade, laudo de trauma severo).`
      });
    }
  }

  if (i192) {
    if (story?.entry_method?.toLowerCase().includes("ewi") || i914?.entry?.entered_ewi === true) {
      const grounds = i192.grounds_of_inadmissibility ?? [];
      const hasEwi = grounds.some((g) => /6\s*\(a\)|EWI|without inspection/i.test(g));
      if (!hasEwi) {
        out.push({
          severity: "alta",
          tier: "tier2_substantivo",
          category: "elegibilidade",
          field: "I-192 — Ground INA 212(a)(6)(A)",
          form: "I-192",
          explanation:
            "História/I-914 indica entrada sem inspeção (EWI), mas I-192 não lista INA 212(a)(6)(A)(i) como ground of inadmissibility a ser renunciado."
        });
      }
    }
    if (!i192.waiver_justification_summary) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "I-192 — Justificativa do Waiver",
        form: "I-192",
        explanation: "I-192 não apresenta justificativa narrativa do waiver (national interest / humanitarian / public interest)."
      });
    }
  }

  const principalName = `${i914?.person?.given_name ?? ""} ${i914?.person?.family_name ?? ""}`.trim();
  for (const i765 of i765s) {
    if (i765.eligibility_category) {
      const cat = i765.eligibility_category.replace(/\s+/g, "").toLowerCase();
      const validPrincipal = /\(?c\)?\(?25\)?|\(?a\)?\(?16\)?/.test(cat);
      if (!validPrincipal && i765.is_for_principal === true) {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "regra_govisa",
          field: "I-765 — Eligibility Category",
          form: "I-765",
          found: i765.eligibility_category,
          expected: "(c)(25) para T-1 principal",
          explanation:
            "Categoria de elegibilidade parece inválida para T-1 principal. T-1 usa (c)(25).",
          recommendation: "Revisar categoria conforme instruções do I-765 para T-visa."
        });
      }
    } else {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "campo_vazio",
        field: "I-765 — Eligibility Category",
        form: "I-765",
        explanation: "Eligibility category em branco. USCIS rejeita I-765 sem categoria."
      });
    }

    if (i765.person && principalName) {
      const i765Name = `${i765.person.given_name ?? ""} ${i765.person.family_name ?? ""}`.trim();
      const forPrincipal = norm(i765Name) === norm(principalName);
      if (i765.is_for_principal === true && !forPrincipal) {
        out.push({
          severity: "alta",
          tier: "tier3_estrategico",
          category: "estrategia",
          field: "I-765 — Destinatário",
          form: "I-765",
          explanation: `I-765 marcado como do principal mas o nome (${i765Name}) não bate com I-914 (${principalName}). Verificar se é I-765 de um derivativo.`
        });
      }
    }
  }

  const personForms = forms.filter(
    (f): f is Extract<FormData, { person: any }> =>
      "person" in f && !!(f as any).person && typeof (f as any).person === "object"
  );
  const reference = personForms[0]?.person;
  if (reference) {
    for (const f of personForms.slice(1)) {
      const p = f.person;
      if (!p) continue;
      const pairs: Array<[string, string | null | undefined, string | null | undefined]> = [
        ["Family Name", reference.family_name, p.family_name],
        ["Given Name", reference.given_name, p.given_name],
        ["Date of Birth", reference.date_of_birth, p.date_of_birth],
        ["Country of Birth", reference.country_of_birth, p.country_of_birth],
        ["Passport Number", reference.passport_number, p.passport_number],
        ["A-Number", reference.a_number, p.a_number],
        [
          "Marital Status",
          normalizeMarital(reference.marital_status),
          normalizeMarital(p.marital_status)
        ]
      ];
      for (const [label, a, b] of pairs) {
        if (a && b && norm(a) !== norm(b)) {
          out.push({
            severity: "critica",
            tier: "tier1_filing",
            category: "divergencia",
            field: label,
            form: f.form,
            expected: `${a} (em ${personForms[0].form})`,
            found: `${b} (em ${f.form})`,
            source: `${personForms[0].form} vs ${f.form}`,
            explanation: `${label} divergente entre formulários. USCIS cruza dados e isso dá RFE.`,
            recommendation: "Padronizar o valor usando documento oficial (passaporte/certidão) como fonte da verdade."
          });
        }
      }
    }
  }

  if (story && reference) {
    if (story.marital_status && reference.marital_status) {
      const s = normalizeMarital(story.marital_status);
      const r = normalizeMarital(reference.marital_status);
      if (s && r && s !== r) {
        out.push({
          severity: "critica",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: "Marital Status",
          form: personForms[0].form,
          expected: `${s} (história)`,
          found: `${r} (formulário)`,
          source: "história vs formulário",
          explanation: "Estado civil na história não bate com o formulário."
        });
      }
    }

    if (story.date_of_birth && reference.date_of_birth) {
      if (norm(story.date_of_birth) !== norm(reference.date_of_birth)) {
        out.push({
          severity: "critica",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: "Date of Birth",
          form: personForms[0].form,
          expected: `${story.date_of_birth} (história)`,
          found: `${reference.date_of_birth} (formulário)`,
          source: "história vs formulário",
          explanation: "Data de nascimento divergente entre história e formulário."
        });
      }
    }

    if (story.passport_number_mentioned && reference.passport_number) {
      if (norm(story.passport_number_mentioned) !== norm(reference.passport_number)) {
        out.push({
          severity: "alta",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: "Passport Number",
          form: personForms[0].form,
          expected: `${story.passport_number_mentioned} (história)`,
          found: `${reference.passport_number} (formulário)`,
          source: "história vs formulário",
          explanation: "Número do passaporte divergente entre história e formulário."
        });
      }
    }

    if (i914?.entry?.last_entry_date && story.year_entered_us) {
      const formYear = (i914.entry.last_entry_date.match(/\d{4}/) ?? [""])[0];
      if (formYear && formYear !== story.year_entered_us) {
        out.push({
          severity: "alta",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: "Last Entry Date",
          form: "I-914",
          expected: `${story.year_entered_us} (história)`,
          found: `${i914.entry.last_entry_date} (I-914)`,
          source: "história vs I-914",
          explanation: "Ano de entrada nos EUA na história não bate com o formulário."
        });
      }
    }

    if (i914?.entry?.last_entry_place && story.port_of_entry) {
      if (norm(i914.entry.last_entry_place) !== norm(story.port_of_entry)) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: "Port of Entry",
          form: "I-914",
          expected: `${story.port_of_entry} (história)`,
          found: `${i914.entry.last_entry_place} (I-914)`,
          source: "história vs I-914",
          explanation: "Local de entrada nos EUA diverge entre história e formulário."
        });
      }
    }

    const storyHasSpouse =
      !!story.spouse_name || normalizeMarital(story.marital_status) === "casado";
    const formHasSpouse = normalizeMarital(reference.marital_status) === "casado";
    if (storyHasSpouse !== formHasSpouse) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "credibilidade",
        field: "Marital Status (cônjuge)",
        form: personForms[0].form,
        expected: storyHasSpouse ? "casado (história menciona cônjuge)" : "sem cônjuge na história",
        found: formHasSpouse ? "casado (formulário)" : "não casado (formulário)",
        source: "história vs formulário",
        explanation:
          "Inconsistência entre cônjuge mencionado na história e estado civil no formulário."
      });
    }

    if (story.children.length > 0) {
      const filingDate = parseDate(i914?.meta?.applicant_signature?.date_signed) ?? new Date();
      const qualifyingChildren = story.children.filter((c) => {
        const age = ageAtDate(c.date_of_birth, filingDate);
        if (age === null) return false;
        if (age >= 21) return false;
        if (c.marital_status && !isUnmarried(c.marital_status)) return false;
        return true;
      });

      if (qualifyingChildren.length > i914a.length) {
        out.push({
          severity: "alta",
          tier: "tier2_substantivo",
          category: "elegibilidade",
          field: "Dependentes (I-914A)",
          form: "I-914A",
          expected: `${qualifyingChildren.length} filho(s) qualificado(s) (solteiro, < 21 anos no filing) na história`,
          found: `${i914a.length} I-914A no processo`,
          source: "história vs I-914A",
          explanation:
            "Principal adulto pode incluir como derivativos apenas filhos SOLTEIROS MENORES DE 21 NO FILING (CSPA age-out protection). Há filhos qualificados na história sem I-914A correspondente."
        });
      }

      const nonQualifyingKids = story.children.filter((c) => {
        const age = ageAtDate(c.date_of_birth, filingDate);
        if (age === null) return false;
        const tooOld = age >= 21;
        const married = c.marital_status && !isUnmarried(c.marital_status);
        return tooOld || !!married;
      });
      if (nonQualifyingKids.length > 0) {
        const reasons = nonQualifyingKids.map((c) => {
          const age = ageAtDate(c.date_of_birth, filingDate);
          const reasons: string[] = [];
          if (age !== null && age >= 21) reasons.push(`${age} anos`);
          if (c.marital_status && !isUnmarried(c.marital_status))
            reasons.push(`casado(a)`);
          return `${c.name ?? "filho(a)"} (${reasons.join(", ")})`;
        });
        out.push({
          severity: "baixa",
          tier: "tier3_estrategico",
          category: "estrategia",
          field: "Filhos não qualificados como derivativos",
          explanation:
            `Não qualifica(m) como T-derivativo, correto não incluir I-914A: ${reasons.join("; ")}.`
        });
      }

      const childrenUnknownAge = story.children.filter(
        (c) => ageAtDate(c.date_of_birth, filingDate) === null
      );
      if (childrenUnknownAge.length > 0) {
        out.push({
          severity: "baixa",
          tier: "tier2_substantivo",
          category: "elegibilidade",
          field: "Dependentes sem data de nascimento",
          explanation: `${childrenUnknownAge.length} filho(s) na história sem DOB. Confirmar idade no filing.`
        });
      }
    }

    if (story.force_mentioned === false && story.fraud_mentioned === false && story.coercion_mentioned === false) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Severe form of trafficking (force/fraud/coercion)",
        form: null,
        explanation:
          "História não caracteriza force, fraud ou coercion. T-visa exige pelo menos um dos três elementos.",
        recommendation: "Revisar declaração para caracterizar explicitamente ameaças, violência, engano ou coerção psicológica."
      });
    }

    if (!story.trafficking_type || story.trafficking_type === "unclear") {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Tipo de tráfico",
        form: null,
        explanation:
          "Não está claro na história se o trafficking foi sexual, laboral ou ambos. USCIS precisa caracterização precisa."
      });
    }

    if (story.physical_presence_on_account_of_trafficking === false) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Physical presence on account of trafficking",
        form: null,
        explanation:
          "Cliente precisa estar nos EUA em razão do tráfico. Se saiu dos EUA e voltou após, é necessário argumentar o nexo.",
        recommendation: "Revisar e reforçar o nexo entre presença nos EUA e os eventos de tráfico."
      });
    }

    if (story.extreme_hardship_mentioned === false) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Extreme hardship (unusual and severe harm)",
        form: null,
        explanation:
          "História não aborda extreme hardship em caso de remoção — requisito do T-visa (INA 101(a)(15)(T)(i)(IV)).",
        recommendation:
          "Desenvolver seção sobre hardship: re-trafficking risk, falta de mental health care, retaliação, impunidade no país de origem."
      });
    }

    if (story.trauma_described === false) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "credibilidade",
        field: "Trauma descrito",
        form: null,
        explanation:
          "História pouco descritiva sobre impacto emocional/psicológico do tráfico. Descrição detalhada fortalece credibilidade e dialoga com medical evaluation."
      });
    }
  }

  if (i914?.family_members_included && i914.family_members_included.length > 0) {
    const filingDate = parseDate(i914?.meta?.applicant_signature?.date_signed) ?? new Date();
    for (const fm of i914.family_members_included) {
      const age = ageAtDate(fm.date_of_birth, filingDate);
      const rel = (fm.relationship ?? "").toLowerCase();
      const isSpouse = /spouse|c[ôo]njuge|wife|husband|esposa|marido/.test(rel);
      const isChild = /child|son|daughter|filho|filha/.test(rel);
      const isParent = /parent|pai|m[ãa]e/.test(rel);
      const isSibling = /sibling|brother|sister|irm[ãa]o|irm[ãa]/.test(rel);

      const principalAge = ageAtDate(i914?.person?.date_of_birth, filingDate);
      const principalIsMinor = principalAge !== null && principalAge < 21;
      const unmarried = fm.marital_status ? isUnmarried(fm.marital_status) : null;

      let qualifies = false;
      let nonQualifyingReason: string | null = null;

      if (isSpouse) {
        qualifies = true;
      } else if (isChild) {
        if (age === null) nonQualifyingReason = "idade desconhecida";
        else if (age >= 21) nonQualifyingReason = `${age} anos (limite: < 21 no filing)`;
        else if (unmarried === false) nonQualifyingReason = "casado(a) (requer solteiro)";
        else qualifies = true;
      } else if (principalIsMinor && isParent) {
        qualifies = true;
      } else if (principalIsMinor && isSibling) {
        if (age === null) nonQualifyingReason = "idade desconhecida";
        else if (age >= 18) nonQualifyingReason = `${age} anos (limite: < 18 no filing)`;
        else if (unmarried === false) nonQualifyingReason = "casado(a) (requer solteiro)";
        else qualifies = true;
      } else if (!principalIsMinor && (isParent || isSibling)) {
        nonQualifyingReason = `${rel} só qualifica se principal < 21 no filing`;
      }

      if (qualifies) {
        const matchingA = i914a.find(
          (a) =>
            norm(a.family_member?.family_name ?? "") + norm(a.family_member?.given_name ?? "") ===
            norm((fm.name ?? "").split(" ").slice(-1)[0]) + norm((fm.name ?? "").split(" ")[0])
        );
        if (!matchingA) {
          out.push({
            severity: "alta",
            tier: "tier2_substantivo",
            category: "elegibilidade",
            field: `I-914A faltando — ${fm.name ?? "familiar"}`,
            form: "I-914A",
            explanation: `${fm.name ?? "Familiar"} (${rel || "relação"}, ${age !== null ? age + " anos no filing" : "idade desconhecida"}${fm.marital_status ? ", " + normalizeMarital(fm.marital_status) : ""}) qualifica como T-derivativo mas não tem I-914A no processo.`
          });
        }
      } else if (fm.name) {
        out.push({
          severity: "baixa",
          tier: "tier3_estrategico",
          category: "estrategia",
          field: `${fm.name} — não qualifica`,
          explanation: `${fm.name} (${rel || "relação"}) listado no I-914 mas não qualifica como T-derivativo: ${nonQualifyingReason ?? "não atende requisitos"}. Correto não incluir I-914A.`
        });
      }
    }
  }

  if (i914a.length > 0) {
    for (const a of i914a) {
      if (a.family_member?.date_of_birth) {
        const dob = a.family_member.date_of_birth;
        const year = dob.match(/\d{4}/)?.[0];
        const principalDob = i914?.person?.date_of_birth ?? "";
        const principalYear = principalDob.match(/\d{4}/)?.[0];
        if (year && principalYear) {
          const ageDiff = Number(principalYear) - Number(year);
          if (a.relationship_to_principal && /child/i.test(a.relationship_to_principal) && ageDiff < 10) {
            out.push({
              severity: "media",
              tier: "tier2_substantivo",
              category: "elegibilidade",
              field: "I-914A — Qualifying relationship (idade)",
              form: "I-914A",
              explanation: `I-914A marcado como filho mas diferença de idade com o principal é pequena (${ageDiff} anos). Verificar relacionamento.`
            });
          }
        }
      }
      if (!a.relationship_evidence_mentioned || a.relationship_evidence_mentioned.length === 0) {
        out.push({
          severity: "alta",
          tier: "tier1_filing",
          category: "suporte_documental",
          field: "I-914A — Evidência da relação",
          form: "I-914A",
          explanation:
            "I-914A deve ser acompanhado de evidência do qualifying relationship (certidão de nascimento/casamento)."
        });
      }
      if (a.location === "abroad") {
        out.push({
          severity: "baixa",
          tier: "tier3_estrategico",
          category: "estrategia",
          field: "I-914A — Dependente no exterior",
          form: "I-914A",
          explanation:
            "Dependente marcado como estando no exterior — será necessário consular processing após aprovação (adiciona tempo)."
        });
      }
    }
  }

  if (passportCheck) {
    if (passportCheck.has_passport_image && passportCheck.signed === false && !isDraft) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "suporte_documental",
        field: "Assinatura do passaporte",
        form: "Identification Documents",
        expected: "Passaporte assinado pelo titular",
        found: "Passaporte sem assinatura no campo do titular",
        explanation: "USCIS pode rejeitar passaporte não assinado."
      });
    } else if (passportCheck.has_passport_image && passportCheck.signed === null) {
      out.push({
        severity: "media",
        tier: "tier1_filing",
        category: "suporte_documental",
        field: "Assinatura do passaporte",
        form: "Identification Documents",
        explanation: "Revisar manualmente se o passaporte está assinado (qualidade da imagem ambígua).",
        source: passportCheck.notes ?? undefined
      });
    }

    if (passportCheck.passport_number_seen && reference?.passport_number) {
      if (norm(passportCheck.passport_number_seen) !== norm(reference.passport_number)) {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "divergencia",
          field: "Passport Number (imagem vs formulário)",
          form: "I-914",
          expected: `${passportCheck.passport_number_seen} (passaporte físico)`,
          found: `${reference.passport_number} (formulário)`,
          explanation: "Número do passaporte no formulário não bate com o lido na imagem do documento."
        });
      }
    }
  }

  if (witnessAnalysis) {
    if (witnessAnalysis.statements_found === 0) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Witness Statements",
        explanation: "Nenhuma witness statement identificada. Witness statements fortalecem credibilidade."
      });
    }
    for (let i = 0; i < (witnessAnalysis.items ?? []).length; i++) {
      const w = witnessAnalysis.items[i];
      if (w.signed === false && !isDraft) {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "assinatura",
          field: `Witness Statement #${i + 1} — Assinatura`,
          form: "Witness Statements",
          explanation: `Declaração de ${w.witness_name ?? "testemunha"} não está assinada.`
        });
      }
      if (w.has_perjury_clause === false) {
        out.push({
          severity: "alta",
          tier: "tier1_filing",
          category: "suporte_documental",
          field: `Witness Statement #${i + 1} — Cláusula de perjury`,
          form: "Witness Statements",
          explanation:
            "Declaração sem cláusula 'under penalty of perjury' (28 U.S.C. §1746). USCIS pode descartar.",
          recommendation: "Adicionar cláusula de penalty of perjury antes da assinatura."
        });
      }
      if (w.attests_specific_facts === false) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: `Witness Statement #${i + 1} — Conteúdo`,
          form: "Witness Statements",
          explanation:
            `Declaração de ${w.witness_name ?? "testemunha"} é vaga/genérica. Declarações eficazes atestam fatos concretos (datas, eventos, observações diretas).`
        });
      }
      if (w.concerns && w.concerns.length > 0) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "suporte_documental",
          field: `Witness Statement #${i + 1} — Outros`,
          form: "Witness Statements",
          explanation: w.concerns.join("; ")
        });
      }
    }
  }

  if (medicalAnalysis) {
    if (medicalAnalysis.evaluations_found === 0) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Medical/Psychological Records",
        explanation:
          "Nenhuma avaliação médica/psicológica encontrada. Ajuda a comprovar trauma e hardship."
      });
    }
    for (let i = 0; i < (medicalAnalysis.items ?? []).length; i++) {
      const m = medicalAnalysis.items[i];
      if (m.licensed_professional === false) {
        out.push({
          severity: "alta",
          tier: "tier2_substantivo",
          category: "suporte_documental",
          field: `Medical #${i + 1} — Profissional Licenciado`,
          form: "Medical Records",
          explanation: `Avaliação feita por profissional sem credencial licenciada. USCIS dá menos peso.`
        });
      }
      if (!m.dsm5_diagnosis || m.dsm5_diagnosis.length === 0) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "suporte_documental",
          field: `Medical #${i + 1} — Diagnóstico DSM-5`,
          form: "Medical Records",
          explanation:
            "Avaliação sem diagnóstico formal em termos DSM-5 (PTSD, MDD, GAD, etc.). Reduz valor probatório."
        });
      }
      if (m.nexus_to_trafficking === false) {
        out.push({
          severity: "alta",
          tier: "tier2_substantivo",
          category: "suporte_documental",
          field: `Medical #${i + 1} — Nexo com trafficking`,
          form: "Medical Records",
          explanation:
            "Avaliação não conecta explicitamente o diagnóstico aos eventos de tráfico. Sem nexo, pouca força probatória."
        });
      }
    }
  }

  if (countryAnalysis) {
    if (countryAnalysis.relevant_to_hardship === false) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Relevância",
        explanation:
          "Material de country conditions não está claramente conectado ao hardship do cliente."
      });
    }
    if (countryAnalysis.addresses_re_trafficking_risk === false) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Re-trafficking",
        explanation: "Country conditions não aborda risco de re-trafficking se retornar."
      });
    }
    if (countryAnalysis.addresses_mental_health_care_access === false) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Mental health",
        explanation:
          "Country conditions não aborda falta de acesso a mental health care no país de origem (importante pro hardship)."
      });
    }
    if (countryAnalysis.concerns && countryAnalysis.concerns.length > 0) {
      out.push({
        severity: "baixa",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Observações",
        explanation: countryAnalysis.concerns.join("; ")
      });
    }
  }

  if (translations) {
    const filtered = (translations.documents_without_translation ?? []).filter((d) => {
      const s = d.toLowerCase();
      if (/passport|passaporte/.test(s)) return false;
      if (/\bnational\s+id\b|\bcédula\b|\bcedula\b|\brg\b/.test(s)) return false;
      return true;
    });
    if (filtered.length > 0) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "suporte_documental",
        field: "Certified Translations",
        explanation:
          "Documentos estrangeiros sem certified translation: " + filtered.join("; "),
        recommendation: "Anexar tradução completa em inglês + Certificate of Translation do tradutor."
      });
    }
    if (translations.concerns && translations.concerns.length > 0) {
      const relevantConcerns = translations.concerns.filter(
        (c) => !/passport|passaporte/i.test(c)
      );
      if (relevantConcerns.length > 0) {
        out.push({
          severity: "media",
          tier: "tier1_filing",
          category: "suporte_documental",
          field: "Certified Translations — Observações",
          explanation: relevantConcerns.join("; ")
        });
      }
    }
  }

  if (i914?.removal_proceedings === true) {
    out.push({
      severity: "alta",
      tier: "tier3_estrategico",
      category: "estrategia",
      field: "Removal proceedings em curso",
      explanation:
        "Cliente em processo de remoção. Avaliar motion to terminate ou administrative closure junto com filing do T-visa."
    });
  }

  if ((i914?.prior_applications ?? []).length > 0) {
    out.push({
      severity: "baixa",
      tier: "tier3_estrategico",
      category: "estrategia",
      field: "Aplicações anteriores (asylum, U, VAWA)",
      explanation:
        "Cliente tem histórico de aplicações imigratórias. Revisar consistência das narrativas anteriores com esta (USCIS tem acesso a todas)."
    });
  }

  return out;
}

export function summarize(findings: Finding[]) {
  return {
    total: findings.length,
    critical: findings.filter((f) => f.severity === "critica").length,
    high: findings.filter((f) => f.severity === "alta").length,
    medium: findings.filter((f) => f.severity === "media").length,
    low: findings.filter((f) => f.severity === "baixa").length,
    by_tier: {
      tier1_filing: findings.filter((f) => f.tier === "tier1_filing").length,
      tier2_substantivo: findings.filter((f) => f.tier === "tier2_substantivo").length,
      tier3_estrategico: findings.filter((f) => f.tier === "tier3_estrategico").length
    }
  };
}
