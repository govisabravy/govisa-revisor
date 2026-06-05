import type {
  Address,
  CountryConditionsAnalysis,
  Finding,
  FindingSeverity,
  FormData,
  LeaQualification,
  MedicalAnalysis,
  Person,
  ProofOfAddressAnalysis,
  Signature,
  StoryFacts,
  Subject,
  TranslationsCheck,
  WitnessStatementsAnalysis
} from "../schemas/forms";
import type { PassportSignatureCheck } from "./claude";
import { RULE_IDS } from "./rule_ids";

// ---------------------------------------------------------------------------
// Constantes e helpers
// ---------------------------------------------------------------------------

export const GOVISA_ADDRESS = {
  in_care_of: "GO VISA LAW FIRM",
  street: "429 SOUTH KELLER ROAD",
  apt_ste_flr: "Ste" as const,
  apt_number: "200A",
  city: "ORLANDO",
  state: "FL",
  zip: "32810"
};

/**
 * Calibração rodada 5 (11/05): USCIS Numbers conhecidos dos advogados da Go Visa.
 * Na primeira página de cada formulário USCIS, aparecem os dados do advogado
 * (nome, USCIS Number, Bar License). O extractor frequentemente confunde esses
 * números com o A-Number do aplicante, gerando falsos positivos nos checks de
 * consistência. Qualquer A-Number que bata com um desses é silenciado.
 */
// Valores já normalizados por canonANumber (só dígitos, sem zeros à esquerda).
const ATTORNEY_USCIS_NUMBERS = new Set<string>([
  // Advogado da Go Visa — USCIS Online Account Number que aparece no rodapé da
  // pág.1 dos forms (ex: I-765 "Attorney USCIS Online Account Number 047574393981").
  // O extractor já confundiu isso com o A-Number do cliente; trava determinística.
  "47574393981", // 047574393981 normalizado
  "47574393", // 047574393 — variante truncada que o extractor capturou na rodada 1
  // Adicionar novos advogados aqui conforme necessário
]);

/**
 * Requisição 05/06: o Bar Number do advogado da Go Visa (Jeffrey Weingrad) deve
 * ser SEMPRE 5794276 em todos os documentos. Atualizar se trocar de advogado.
 */
const EXPECTED_ATTORNEY_BAR = "5794276";

/** Só dígitos, sem zeros à esquerda — pra comparar bar numbers de forma tolerante. */
function digitsOnly(raw?: string | null): string {
  if (!raw) return "";
  return String(raw).replace(/[^0-9]/g, "").replace(/^0+/, "");
}

/**
 * Q6 — Edições atuais aceitas pelo USCIS por formulário.
 * Atualizar conforme USCIS publica novas edições (vide instructions PDF).
 * Formato: MM/DD/YY (ou MM/DD/YYYY) — comparado normalizado.
 */
export const CURRENT_USCIS_EDITIONS: Record<string, string[]> = {
  "I-914":  ["01/20/25", "09/30/24", "01/19/24"],
  "I-914A": ["01/20/25", "09/30/24", "01/19/24"],
  "I-914B": ["01/20/25", "09/30/24", "01/19/24"],
  "I-918":  ["01/20/25", "12/16/24", "06/12/24"],
  "I-918A": ["01/20/25", "12/16/24", "06/12/24"],
  "I-918B": ["01/20/25", "12/16/24", "06/12/24"],
  "I-192":  ["01/20/25", "10/15/24"],
  "I-765":  ["08/21/25", "04/01/24", "01/19/24"],
  // Calibração Flavia 04/05: 09/17/18 ainda é aceita pela USCIS, foi marcada
  // como falso positivo em 11 ocorrências em 4 reviews diferentes.
  "G-28":   ["01/19/24", "05/05/22", "09/17/18"],
  "I-360":  ["01/20/25", "07/24/24", "01/19/24"]
};

/**
 * Edições com data igual ou posterior a este threshold são consideradas
 * potencialmente vigentes mesmo se NÃO estiverem na lista exata acima.
 * Isso evita falso positivo quando o USCIS publica uma edição nova e a
 * lista hardcoded ainda não foi atualizada. Atualizar este threshold
 * conforme o tempo passa.
 */
const EDITION_MIN_ACCEPT_YEAR = 24; // YY: edições >= 01/01/24 não geram alerta forte

/** Normaliza edição USCIS para MM/DD/YY (descartando século caso venha 4 dígitos). */
function normEdition(s?: string | null): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return s.trim();
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  let yy = m[3];
  if (yy.length === 4) yy = yy.slice(2);
  return `${mm}/${dd}/${yy}`;
}

/** Extrai YY (ano em 2 dígitos) de uma edição normalizada MM/DD/YY. Retorna null se inválido. */
function editionYear(normed: string): number | null {
  const m = normed.match(/^\d{2}\/\d{2}\/(\d{2})$/);
  if (!m) return null;
  const yy = parseInt(m[1], 10);
  return isNaN(yy) ? null : yy;
}

/**
 * Veredito da edição:
 * - "current" → está na lista exata do USCIS (sem alerta)
 * - "likely_current" → ano >= threshold mas não está na lista (sem alerta forte;
 *   pode ser edição nova publicada recentemente)
 * - "outdated" → ano antes do threshold (alerta de edição obsoleta)
 * - null → sem dado pra avaliar
 */
function editionStatus(
  formName: string,
  edition?: string | null
): "current" | "likely_current" | "outdated" | null {
  const accepted = CURRENT_USCIS_EDITIONS[formName];
  if (!edition) return null;
  const normed = normEdition(edition);
  if (!normed) return null;
  if (accepted && accepted.length > 0) {
    const set = new Set(accepted.map((e) => normEdition(e)).filter(Boolean) as string[]);
    if (set.has(normed)) return "current";
  }
  const yy = editionYear(normed);
  if (yy === null) return null;
  // 2-digit year window: 00-50 vira 2000-2050; 51-99 vira 1951-1999
  // (USCIS forms nunca terão edição 1900s relevante)
  const fullYear = yy < 51 ? 2000 + yy : 1900 + yy;
  if (fullYear >= 2000 + EDITION_MIN_ACCEPT_YEAR) {
    return "likely_current";
  }
  return "outdated";
}

/** Compat: mantém a função original retornando boolean|null pra eventual uso externo. */
function isCurrentEdition(formName: string, edition?: string | null): boolean | null {
  const s = editionStatus(formName, edition);
  if (s === null) return null;
  return s === "current" || s === "likely_current";
}

function norm(v?: string | null): string {
  return (v ?? "").toString().trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Comparação de nome de pessoa tolerante a convenções brasileiras/hispânicas:
 * cliente pode ter 2-4 sobrenomes e usar combinações diferentes em cada form.
 *
 * Regras:
 * - Tokeniza por espaço (após normalização).
 * - Se um set de tokens é subconjunto do outro → considera EQUIVALENTE
 *   (ex: "DA SILVA" ⊂ "PEREIRA DA SILVA" → ok, não é erro).
 * - Se houver tokens completamente disjuntos sem nenhuma sobreposição → DIVERGENTE.
 *
 * Devolve true quando os nomes podem se referir à mesma pessoa.
 */
function namesPlausiblyEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return true; // se um lado está vazio, não dispara aqui (campo_vazio cuida)
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return na === nb;
  // subset bidirecional → mesma pessoa, apenas com mais/menos tokens
  const aSubB = [...ta].every((t) => tb.has(t));
  const bSubA = [...tb].every((t) => ta.has(t));
  if (aSubB || bSubA) return true;
  return false;
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

/**
 * Compara dois endereços tolerante a variações comuns:
 * - sufixos de unidade (Ste/Suite/Apt/Apartment/#) ignorados
 * - zip+4 vs zip5: compara só os 5 primeiros dígitos
 * - city/state/street tokenizados (ordem/abreviação tolerada)
 *
 * Usado pra cruzar Physical Address de form com endereço de comprovante de
 * residência, que costumam ter pequenas variações textuais ("Ste 200" vs
 * "Suite 200A", "32810" vs "32810-1234").
 */
function addressLooselyEqual(
  a: Address | undefined | null,
  b: Address | undefined | null
): boolean {
  if (!a || !b) return false;
  const stripUnit = (s?: string | null) =>
    norm(s)
      .replace(/\b(STE|SUITE|APT|APARTMENT|UNIT|#)\b\.?/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const zip5 = (s?: string | null) => norm(s).replace(/\D/g, "").slice(0, 5);
  if (stripUnit(a.street) !== stripUnit(b.street)) return false;
  if (norm(a.city) !== norm(b.city)) return false;
  if (norm(a.state) !== norm(b.state)) return false;
  const za = zip5(a.zip);
  const zb = zip5(b.zip);
  if (za && zb && za !== zb) return false;
  return true;
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

export function parseDate(s?: string | null): Date | null {
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

function nameKey(p: { given_name?: string | null; family_name?: string | null } | null | undefined): string {
  if (!p) return "";
  return `${norm(p.given_name)}|${norm(p.family_name)}`;
}

// Type alias para forms que carregam o sujeito anexado pelos extractors
type FormWithSubject = FormData & { _subject_id?: string | null };

function getSubjectId(f: FormData): string | null {
  return (f as any)._subject_id ?? null;
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** @deprecated Use RulesInputV2 — mantido para retro-compat */
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

export interface RulesInputV2 {
  forms: FormData[];
  story: StoryFacts | null;
  /** Lista consolidada de checks de passaporte (1 por sujeito). */
  passportChecks?: Array<{ subject_id: string | null; check: PassportSignatureCheck }>;
  /** @deprecated fallback retro-compat — preferir `passportChecks`. */
  passportCheck?: PassportSignatureCheck | null;
  witnessAnalysis?: WitnessStatementsAnalysis | null;
  medicalAnalysis?: MedicalAnalysis | null;
  countryAnalysis?: CountryConditionsAnalysis | null;
  leaQualification?: LeaQualification | null;
  translations?: TranslationsCheck | null;
  proofOfAddress?: ProofOfAddressAnalysis | null;
  /** Lista consolidada de sujeitos (principal + dependentes). */
  subjects?: Subject[];
  mode?: "draft" | "final";
}

// ---------------------------------------------------------------------------
// Subject inference (fallback p/ retro-compat)
// ---------------------------------------------------------------------------

const PRINCIPAL_SYNTHETIC_ID = "principal";

function inferSubjects(forms: FormData[], story: StoryFacts | null): Subject[] {
  // Se nada foi passado, tratamos todos os forms como pertencentes ao principal.
  const subjects: Subject[] = [];
  // Principal — derivar do I-914 (T-visa). Para U-visa/VAWA o caller deve passar `subjects`.
  let p: Person | undefined;
  for (const f of forms) {
    if (f.form === "I-914" && "person" in f && f.person) {
      p = f.person;
      break;
    }
  }
  // fallback: primeiro form com person
  if (!p) {
    for (const f of forms) {
      if ("person" in f && (f as any).person) {
        p = (f as any).person;
        break;
      }
    }
  }
  const principalName =
    `${p?.given_name ?? story?.full_name ?? ""} ${p?.family_name ?? ""}`.trim() || "Principal";
  subjects.push({
    id: PRINCIPAL_SYNTHETIC_ID,
    role: "principal",
    display_name: principalName,
    family_name: p?.family_name ?? null,
    given_name: p?.given_name ?? null,
    date_of_birth: p?.date_of_birth ?? null,
    country_of_citizenship: p?.country_of_citizenship ?? null,
    relationship_to_principal: null
  });
  return subjects;
}

function clusterFormsBySubject(
  forms: FormData[],
  subjects: Subject[]
): Map<string, FormData[]> {
  const map = new Map<string, FormData[]>();
  for (const s of subjects) map.set(s.id, []);
  for (const f of forms) {
    const sid = getSubjectId(f) ?? PRINCIPAL_SYNTHETIC_ID;
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid)!.push(f);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Nível 1 — Per-form (intra-form)
// ---------------------------------------------------------------------------

function applyLevel1PerForm(
  f: FormData,
  subject: Subject | null,
  ctx: { isDraft: boolean; proofOfAddress?: ProofOfAddressAnalysis | null }
): Finding[] {
  const out: Finding[] = [];
  const formName = f.form;
  const sid = subject?.id ?? null;

  // Q6 — Edição USCIS desatualizada (DOC_EDITION_OUTDATED, genérico p/ T/U/VAWA)
  // Só dispara pra "outdated" (ano < 2024). "likely_current" (edição recente
  // não listada explicitamente) NÃO gera alerta — minha lista hardcoded fica
  // desatualizada e geraria falso positivo.
  const editionDate = (f as any)?.meta?.edition_date as string | null | undefined;
  const editionState = editionStatus(formName, editionDate);
  if (editionState === "outdated") {
    const accepted = CURRENT_USCIS_EDITIONS[formName] ?? [];
    out.push({
      // Ajuste (Flavia 29/04): rebaixado de alta para media. Casos reais
      // mostraram extração da edition_date com ruído ou edições antigas
      // ainda aceitas pela USCIS. Time confere antes de tratar como bloqueante.
      severity: "baixa",
      tier: "tier1_filing",
      category: "regra_govisa",
      field: `${formName} — Edition Date`,
      form: formName,
      expected: `Edição USCIS conhecida (${accepted.join(" ou ")})`,
      found: editionDate ?? "(vazio)",
      explanation: `Edição do ${formName} (${editionDate}) não está na lista de edições conhecidas — verificar se ainda é aceita pela USCIS antes de substituir.`,
      recommendation: `Apenas conferir em uscis.gov/${formName.toLowerCase()} se a edição (${editionDate}) ainda é aceita. Edições anteriores costumam continuar válidas por meses.`,
      rule_id: RULE_IDS.DOC_EDITION_OUTDATED,
      subject_id: sid
    });
  }

  // Physical address
  // Calibração rodada 4 (Flavia 04/05): a premissa correta da Go Visa é que
  // Physical Address é o endereço PESSOAL do cliente (não o da firma). Pode
  // vir em branco em casos onde o cliente prefere não expor o próprio
  // endereço — usa-se o da Go Visa apenas como exceção.
  //
  // Calibração rodada 5 (11/05): PROOF_MISSING gerou 12 falsos positivos em
  // 100% dos casos pos-calibracao 4. O comprovante de residencia e anexado
  // UMA VEZ para o principal e vale para toda a familia (dependentes moram no
  // mesmo endereco). Alem disso, driver's license com endereco tambem valida.
  //
  // Lógica revisada:
  // - vazio → silêncio
  // - bate com Go Visa → silêncio
  // - endereço pessoal + comprovante do principal bate (loose match) → silêncio
  //   (para deps, comprovante do principal tambem vale)
  // - endereço pessoal + comprovante diverge → MISMATCH (alta)
  // - sem comprovante detectado → emitir APENAS 1x no principal (nao em cada dep)
  if ("physical_address" in f && f.physical_address !== undefined) {
    const addr = f.physical_address;
    const isEmpty =
      !addr || (!addr.street && !addr.city && !addr.state && !addr.zip);

    if (!isEmpty && !sameAddress(addr)) {
      const proof = ctx.proofOfAddress;
      // Comprovante encontrado para QUALQUER sujeito da familia vale para todos:
      // dependentes moram no mesmo endereco que o principal.
      const proofFoundAnywhere = !!proof && proof.found === true;
      const proofForThisSubject =
        proofFoundAnywhere &&
        (proof.matched_subject_id === sid ||
          (sid === "principal" && proof.holder_match === "principal"));
      // Dependentes: se o comprovante foi encontrado para o principal, aceitar
      const proofCoversDep =
        proofFoundAnywhere &&
        subject?.role === "dependent" &&
        (proof.holder_match === "principal" ||
          proof.matched_subject_id === "principal");

      if (proofForThisSubject || proofCoversDep) {
        const proofAddr = (proof as any).address as Address | undefined;
        if (proofAddr && addressLooselyEqual(addr, proofAddr)) {
          // OK silencioso: endereço pessoal validado pelo comprovante.
        } else if (proofCoversDep) {
          // Dependente com endereço diferente do comprovante do principal:
          // não e necessariamente erro (dep pode morar junto mas o form
          // preenche endereco levemente diferente). Silenciar.
        } else {
          out.push({
            severity: "alta",
            tier: "tier1_filing",
            category: "regra_govisa",
            field: "Physical Address",
            form: formName,
            expected: addrToStr(proofAddr ?? null),
            found: addrToStr(addr),
            source: formName,
            explanation:
              "Physical Address informado no formulário não bate com o endereço do comprovante de residência anexo.",
            recommendation:
              "Conferir o comprovante de residência: ajustar o Physical Address pra refletir o endereço do comprovante OU substituir o comprovante por um que valide o endereço informado.",
            rule_id: RULE_IDS.T_FILING_PHYSICAL_ADDR_MISMATCH_PROOF,
            subject_id: sid
          });
        }
      } else if (subject?.role === "principal") {
        // Calibração rodada 5: emitir PROOF_MISSING APENAS para o principal.
        // Dependentes compartilham o comprovante do principal.
        out.push({
          severity: "baixa",
          tier: "tier1_filing",
          category: "regra_govisa",
          field: "Physical Address",
          form: formName,
          expected: "—",
          found: addrToStr(addr),
          source: formName,
          explanation:
            "Physical Address pessoal informado, mas o sistema não localizou comprovante de residência anexo confirmando este endereço.",
          recommendation:
            "Apenas verificar se há comprovante de residência (utility bill, contrato de aluguel, bank statement, IRS letter, driver's license com endereço) anexo ao processo. Se houver e o sistema não detectou, reportar pra calibração; se não houver, anexar.",
          rule_id: RULE_IDS.T_FILING_PHYSICAL_ADDR_PROOF_MISSING,
          subject_id: sid
        });
      }
      // Dependentes sem comprovante: silêncio (comprovante do principal cobre)
    }
  }

  // Safe Mailing Address
  if ("safe_mailing_address" in f && f.safe_mailing_address !== undefined) {
    const sma = f.safe_mailing_address;
    // Calibração rodada 4 (Flavia 04/05): aceitar match tolerante (Ste/Suite,
    // zip+4) — extractor frequentemente perde apt_number. Também: se o
    // physical_address parece ser Go Visa e o safe_mailing parece pessoal,
    // suspeitar de swap do extractor — não cobrar como erro.
    const physicalAddr = (f as any).physical_address as Address | undefined;
    const physicalIsGoVisa =
      physicalAddr &&
      (sameAddress(physicalAddr) || addressLooselyEqual(physicalAddr, GOVISA_ADDRESS));
    const smaIsGoVisa = sameAddress(sma) || addressLooselyEqual(sma, GOVISA_ADDRESS);
    pushIf(
      !smaIsGoVisa && !physicalIsGoVisa,
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
        recommendation: "Preencher Safe Mailing Address com endereço da firma + c/o GO VISA LAW FIRM.",
        rule_id: RULE_IDS.T_FILING_SAFE_MAILING_NOT_GOVISA,
        subject_id: sid
      },
      out
    );
    if (
      sma &&
      norm(sma.in_care_of) !== norm(GOVISA_ADDRESS.in_care_of) &&
      !physicalIsGoVisa
    ) {
      out.push({
        severity: "alta",
        tier: "tier1_filing",
        category: "regra_govisa",
        field: "In Care Of Name",
        form: formName,
        expected: GOVISA_ADDRESS.in_care_of,
        found: sma?.in_care_of ?? "(vazio)",
        source: formName,
        explanation: "In Care Of Name deve ser GO VISA LAW FIRM.",
        rule_id: RULE_IDS.T_FILING_IN_CARE_OF_MISSING,
        subject_id: sid
      });
    }
  }

  // Mailing address
  // Calibração rodada 4 (Flavia 04/05): aceitar match tolerante (Suite/Ste, zip+4).
  if ("mailing_address" in f && f.mailing_address !== undefined && f.mailing_address) {
    const ma = f.mailing_address;
    const maIsGoVisa = sameAddress(ma) || addressLooselyEqual(ma, GOVISA_ADDRESS);
    pushIf(
      !maIsGoVisa,
      {
        severity: "alta",
        tier: "tier1_filing",
        category: "regra_govisa",
        field: "Mailing Address",
        form: formName,
        expected: addrToStr(GOVISA_ADDRESS),
        found: addrToStr(ma),
        source: formName,
        explanation: "Mailing Address deve apontar para a Go Visa.",
        rule_id: RULE_IDS.T_FILING_MAILING_NOT_GOVISA,
        subject_id: sid
      },
      out
    );
  }

  // Person — campos vazios
  // Ajuste (Flavia 29/04): nem todo form tem campo de Passport ou SSN.
  // Só rodamos esses checks nos forms que de fato exibem o campo no PDF do USCIS.
  // Calibração rodada 4 (Flavia 04/05): I-192 tem campo de passaporte mas é
  // opcional pela USCIS — Go Visa não preenche por padrão e cobrar gera
  // falso positivo recorrente. Removido.
  const FORMS_WITH_PASSPORT_FIELD = new Set(["I-914", "I-914A", "I-918", "I-918A", "I-360"]);
  const FORMS_WITH_SSN_FIELD = new Set(["I-914", "I-914A", "I-765", "I-918", "I-918A", "I-360"]);
  if ("person" in f && f.person) {
    const p = f.person;
    const checks: Array<[string, string | null | undefined, "alta" | "media", string]> = [
      ["Family Name", p.family_name, "alta", RULE_IDS.T_FILING_PERSON_FAMILY_NAME_EMPTY],
      ["Given Name", p.given_name, "alta", RULE_IDS.T_FILING_PERSON_GIVEN_NAME_EMPTY],
      ["Date of Birth", p.date_of_birth, "alta", RULE_IDS.T_FILING_PERSON_DOB_EMPTY],
      ["Country of Birth", p.country_of_birth, "media", RULE_IDS.T_FILING_PERSON_BIRTH_COUNTRY_EMPTY]
    ];
    if (FORMS_WITH_PASSPORT_FIELD.has(f.form)) {
      checks.push(["Passport Number", p.passport_number, "media", RULE_IDS.T_FILING_PERSON_PASSPORT_EMPTY]);
    }
    for (const [label, value, sev, rid] of checks) {
      if (!value) {
        out.push({
          severity: sev,
          tier: "tier1_filing",
          category: "campo_vazio",
          field: label,
          form: formName,
          explanation: `${label} não preenchido.`,
          rule_id: rid,
          subject_id: sid
        });
      }
    }
    // Calibração rodada 4 (Flavia 04/05): SSN em branco é o estado natural
    // pra vítima de tráfico/abuso recém-chegada. Mesmo com A-number, dependentes
    // tipicamente vieram com o principal e não tiveram emprego legal anterior.
    // Suprimir o finding em dependentes; manter informativo no principal apenas
    // quando há A-number (sinal de histórico imigratório prévio).
    const isPrincipalSubject = subject?.role === "principal";
    if (
      FORMS_WITH_SSN_FIELD.has(f.form) &&
      f.form === "I-765" &&
      isPrincipalSubject &&
      (p.ssn === null || p.ssn === undefined || p.ssn === "") &&
      !!p.a_number
    ) {
      out.push({
        severity: "baixa",
        tier: "tier3_estrategico",
        category: "campo_vazio",
        field: "SSN",
        form: formName,
        explanation:
          "SSN em branco no I-765 do principal, com A-number prévio. Apenas verificar se o cliente já teve SSN emitido.",
        rule_id: RULE_IDS.T_FILING_SSN_EMPTY,
        subject_id: sid
      });
    }
  }

  // Assinaturas
  if ("meta" in f && f.meta && !ctx.isDraft) {
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
        recommendation: "Coletar assinatura + data do requerente antes do protocolo.",
        rule_id: RULE_IDS.T_FILING_APPLICANT_SIG_MISSING,
        subject_id: sid
      });
    }
    if (m.interpreter_used === true) {
      const im = sigIncomplete(m.interpreter_signature);
      if (im.length > 0) {
        out.push({
          // Ajuste 3.2 (Flavia): rebaixado de critica -> baixa
          severity: "baixa",
          tier: "tier1_filing",
          category: "assinatura",
          field: "Interpreter Signature",
          form: formName,
          found: `Faltando: ${im.join(", ")}`,
          explanation:
            "Formulário indica uso de intérprete, mas a declaração do intérprete não está completa.",
          rule_id: RULE_IDS.T_FILING_INTERPRETER_SIG_MISSING,
          subject_id: sid
        });
      }
    }
    if (m.preparer_used === true) {
      const pm = sigIncomplete(m.preparer_signature);
      if (pm.length > 0) {
        out.push({
          // Ajuste 3.3 (Flavia): rebaixado de alta -> baixa
          severity: "baixa",
          tier: "tier1_filing",
          category: "assinatura",
          field: "Preparer Signature",
          form: formName,
          found: `Faltando: ${pm.join(", ")}`,
          explanation: "Declaração do preparer incompleta.",
          rule_id: RULE_IDS.T_FILING_PREPARER_SIG_MISSING,
          subject_id: sid
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Nível 2 — Intra-cluster (forms do MESMO sujeito)
// ---------------------------------------------------------------------------

function applyLevel2IntraCluster(
  subject: Subject,
  clusterForms: FormData[]
): Finding[] {
  const out: Finding[] = [];

  const personForms = clusterForms.filter(
    (f): f is FormData & { person: Person } =>
      "person" in f && !!(f as any).person && typeof (f as any).person === "object"
  );
  if (personForms.length < 2) return out;

  const reference = personForms[0].person;
  for (const f of personForms.slice(1)) {
    const p = f.person;
    if (!p) continue;
    const pairs: Array<[string, string | null | undefined, string | null | undefined, string]> = [
      ["Family Name", reference.family_name, p.family_name, RULE_IDS.T_CONS_NAME_FORMS_DIVERGE],
      ["Given Name", reference.given_name, p.given_name, RULE_IDS.T_CONS_NAME_FORMS_DIVERGE],
      ["Date of Birth", reference.date_of_birth, p.date_of_birth, RULE_IDS.T_CONS_DOB_FORMS_DIVERGE],
      ["Country of Birth", reference.country_of_birth, p.country_of_birth, RULE_IDS.T_CONS_BIRTH_COUNTRY_DIVERGE],
      ["Passport Number", reference.passport_number, p.passport_number, RULE_IDS.T_CONS_PASSPORT_NUMBER_DIVERGE],
      // A-Number: tratado por applyANumberConsistency (cobre divergência DENTRO
      // do mesmo form e ENTRE forms, com captura por página). Removido daqui pra
      // não duplicar e pra usar a captura por-ocorrência.
      [
        "Marital Status",
        normalizeMarital(reference.marital_status),
        normalizeMarital(p.marital_status),
        RULE_IDS.T_CONS_MARITAL_DIVERGE
      ]
    ];
    for (const [label, a, b, rid] of pairs) {
      if (!a || !b) continue;
      // Para Family Name e Given Name, aplicamos lógica tolerante a convenção
      // brasileira/hispânica (subset de sobrenomes não é erro).
      const isNameField = label === "Family Name" || label === "Given Name";
      const equivalent = isNameField
        ? namesPlausiblyEqual(a, b)
        : norm(a) === norm(b);
      if (!equivalent) {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "divergencia",
          field: label,
          form: f.form,
          expected: `${a} (em ${personForms[0].form})`,
          found: `${b} (em ${f.form})`,
          source: `${personForms[0].form} vs ${f.form} (sujeito ${subject.display_name})`,
          explanation: `${label} divergente entre formulários do mesmo sujeito. USCIS cruza dados e isso dá RFE.`,
          recommendation:
            "Padronizar o valor usando documento oficial (passaporte/certidão) como fonte da verdade.",
          rule_id: rid,
          subject_id: subject.id
        });
      }
    }
  }

  // G-28 do dependente: verificar se client_name bate com sujeito (ajuste 3.4)
  const g28s = clusterForms.filter((f): f is Extract<FormData, { form: "G-28" }> => f.form === "G-28");
  for (const g of g28s) {
    if (!g.client_name) continue;
    const subjectFull = `${subject.given_name ?? ""} ${subject.family_name ?? ""}`.trim();
    if (subjectFull && !namesPlausiblyEqual(g.client_name, subjectFull)) {
      out.push({
        severity: "alta",
        tier: "tier1_filing",
        category: "divergencia",
        field: "G-28 — Client Name",
        form: "G-28",
        expected: subject.display_name,
        found: g.client_name,
        explanation:
          "Client Name no G-28 não bate com o sujeito esperado deste cluster (verificar se o G-28 corresponde ao dependente correto).",
        rule_id: RULE_IDS.T_CONS_NAME_FORMS_DIVERGE,
        subject_id: subject.id
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// A-Number — consistência por sujeito (intra-form + entre-forms)
// ---------------------------------------------------------------------------
//
// Requisito do cliente (Flavia, 03/06): o A-Number tem sempre 9 dígitos e
// aparece repetido em VÁRIAS páginas de cada form. O revisor TEM que pegar
// divergência (a) entre páginas do MESMO form e (b) entre forms do mesmo
// sujeito. Antes, o schema guardava só 1 A-Number por form, o que tornava (a)
// impossível e (b) frágil. Agora cada form traz person.a_numbers_seen com todas
// as ocorrências por página; esta regra agrega tudo por sujeito e compara.
//
// Salvaguardas contra os falsos positivos calibrados nas rodadas 4/5:
//  - número do advogado (USCIS Number do header da pág.1) é excluído na extração
//    e também pela allowlist ATTORNEY_USCIS_NUMBERS;
//  - se um valor minoritário aparece UMA vez e só na pág.1, é tratado como
//    provável vazamento do número do advogado (rebaixa pra "alta"/extractor_swap);
//  - se um valor divergente bate com o SSN do sujeito, é swap do extrator (alta).
// Divergências reais (incl. intra-form) ficam "critica" e são imunes ao
// adversarial pass (vide applyAdversarialDecisions em senior.ts).

/** Normaliza um A-Number para comparação: só dígitos, sem zeros à esquerda. */
function canonANumber(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (!digits) return null;
  return digits.replace(/^0+/, "") || "0";
}

interface ANumberOcc {
  canon: string;
  raw: string;
  form: string;
  page: string | number | null;
}

function applyANumberConsistency(
  subjects: Subject[],
  clusters: Map<string, FormData[]>
): Finding[] {
  const out: Finding[] = [];

  for (const subject of subjects) {
    const forms = clusters.get(subject.id) ?? [];
    if (forms.length === 0) continue;

    const occ: ANumberOcc[] = [];
    const ssnSet = new Set<string>();

    for (const f of forms) {
      // I-914 / I-192 / I-765 usam `person`; I-914A (dependente) usa `family_member`.
      const person = (f as any).person ?? (f as any).family_member;
      if (!person || typeof person !== "object") continue;

      if (person.ssn) {
        const s = String(person.ssn).replace(/[^0-9]/g, "");
        if (s) ssnSet.add(s);
      }

      const seen: Array<{ value?: string; page?: string | number | null }> =
        Array.isArray(person.a_numbers_seen) ? person.a_numbers_seen : [];

      if (seen.length > 0) {
        for (const s of seen) {
          const canon = canonANumber(s?.value);
          if (!canon) continue;
          occ.push({ canon, raw: String(s.value), form: f.form, page: s.page ?? null });
        }
      } else if (person.a_number) {
        // Fallback (debug antigo sem a_numbers_seen): usa o valor único do form.
        const canon = canonANumber(person.a_number);
        if (canon) occ.push({ canon, raw: String(person.a_number), form: f.form, page: null });
      }
    }

    if (occ.length === 0) continue;

    // Exclui números do advogado (allowlist por canon normalizado).
    const filtered = occ.filter((o) => !ATTORNEY_USCIS_NUMBERS.has(o.canon));
    if (filtered.length === 0) continue;

    // Agrupa por valor canônico.
    const byCanon = new Map<string, ANumberOcc[]>();
    for (const o of filtered) {
      if (!byCanon.has(o.canon)) byCanon.set(o.canon, []);
      byCanon.get(o.canon)!.push(o);
    }
    if (byCanon.size < 2) continue; // sem divergência

    const canons = Array.from(byCanon.keys());

    // Divergência DENTRO de um mesmo form (ex: I-192 pág.2 != pág.9) — inequívoca.
    const formToCanons = new Map<string, Set<string>>();
    for (const o of filtered) {
      if (!formToCanons.has(o.form)) formToCanons.set(o.form, new Set());
      formToCanons.get(o.form)!.add(o.canon);
    }
    const intraFormDivergence = Array.from(formToCanons.values()).some((s) => s.size >= 2);

    // Heurística do advogado: valor que aparece 1x e só na pág.1 (header do
    // representante). Só aplica quando NÃO há divergência intra-form.
    const attorneyLeakCanon = (() => {
      if (intraFormDivergence) return null;
      for (const [canon, list] of byCanon) {
        if (list.length !== 1) continue;
        const pg = list[0].page;
        const pageNum = typeof pg === "number" ? pg : parseInt(String(pg ?? ""), 10);
        if (pageNum === 1) return canon;
      }
      return null;
    })();

    // Swap A-Number/SSN do extrator: algum valor divergente bate com o SSN.
    const swapCanon = canons.find((c) => ssnSet.has(c)) ?? null;

    // Descrição das fontes: "12345 (I-914 p.2)  ≠  67890 (I-192 p.2, I-192 p.9)".
    const sourcesDesc = canons
      .map((c) => {
        const list = byCanon.get(c)!;
        const where = list
          .map((o) => `${o.form}${o.page != null ? ` p.${o.page}` : ""}`)
          .join(", ");
        return `${list[0].raw} (${where})`;
      })
      .join("  ≠  ");

    const formsInvolved = Array.from(new Set(filtered.map((o) => o.form))).join(", ");

    // Nota de formato: A-Number válido tem 9 dígitos.
    const badFormat = canons.filter((c) => c.replace(/^0+/, "").length !== 9 && c.length !== 9);
    const formatNote =
      badFormat.length > 0
        ? " Obs.: A-Number válido tem 9 dígitos — verificar também o formato dos números acima."
        : "";

    let severity: FindingSeverity = "critica";
    let useRuleId: string = RULE_IDS.T_CONS_ANUMBER_DIVERGE;
    let explanation: string;
    let recommendation: string;

    if (intraFormDivergence) {
      explanation =
        `A-Number divergente DENTRO de um mesmo formulário (números diferentes em páginas distintas) para ${subject.display_name}. ` +
        `O A-Number deve ser idêntico em todas as páginas do form. USCIS cruza esses dados e isso gera RFE/NOID.` +
        formatNote;
      recommendation =
        "Corrigir o formulário para que o A-Number seja o mesmo em todas as páginas, conforme o documento de identificação oficial em anexo.";
    } else if (swapCanon) {
      severity = "alta";
      useRuleId = RULE_IDS.T_CONS_ANUMBER_SSN_EXTRACTOR_SWAP;
      explanation =
        "A-Number e SSN aparecem trocados entre formulários do mesmo sujeito — provável falha do extrator de dados. Conferir nos PDFs originais." +
        formatNote;
      recommendation =
        "Verificar diretamente nos PDFs se A-Number e SSN estão na ordem correta. Se OK no impresso, ignorar — é falha do extractor.";
    } else if (attorneyLeakCanon) {
      severity = "alta";
      useRuleId = RULE_IDS.T_CONS_ANUMBER_SSN_EXTRACTOR_SWAP;
      explanation =
        "A-Number divergente entre formulários, mas um dos valores aparece só na primeira página (onde fica o USCIS Number do advogado). Provável captura do número do representante, não do aplicante. Conferir nos PDFs originais antes de tratar como erro." +
        formatNote;
      recommendation =
        "Verificar se o número divergente é do aplicante e não do advogado (topo da pág.1 traz dados do representante).";
    } else {
      explanation =
        `A-Number divergente entre formulários do mesmo sujeito (${subject.display_name}). ` +
        `O A-Number deve ser idêntico em todos os forms. USCIS cruza esses dados e a divergência gera RFE/NOID.` +
        formatNote;
      recommendation =
        "Padronizar o A-Number em todos os formulários usando o documento de identificação oficial (carta de imigração / I-797) como fonte da verdade.";
    }

    out.push({
      severity,
      tier: "tier1_filing",
      category: "divergencia",
      field: "A-Number divergente",
      form: formsInvolved || null,
      expected: "Mesmo A-Number (9 dígitos) em todas as páginas e formulários",
      found: sourcesDesc,
      source: `sujeito ${subject.display_name}`,
      explanation,
      recommendation,
      rule_id: useRuleId,
      subject_id: subject.id
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Nível 3 — Cross-cluster (principal × cada dependente)
// ---------------------------------------------------------------------------

function applyLevel3CrossCluster(
  principalSubject: Subject,
  principalForms: FormData[],
  depSubject: Subject,
  depForms: FormData[],
  allForms: FormData[]
): Finding[] {
  const out: Finding[] = [];

  const principalI914 = principalForms.find(
    (f): f is Extract<FormData, { form: "I-914" }> => f.form === "I-914"
  );
  // Para U-visa pode haver I-918 no principal (escapa do union T-visa via cast)
  const principalI918 = principalForms.find((f) => (f as any).form === "I-918") as any;
  const principalPerson: Person | undefined =
    principalI914?.person ?? principalI918?.person;
  if (!principalPerson) return out;

  // I-914A correspondente ao dep
  const i914aOfDep = depForms.find(
    (f): f is Extract<FormData, { form: "I-914A" }> => f.form === "I-914A"
  );
  if (i914aOfDep && i914aOfDep.principal_applicant) {
    const pa = i914aOfDep.principal_applicant;
    if (
      norm(pa.family_name) &&
      norm(principalPerson.family_name) &&
      !namesPlausiblyEqual(pa.family_name, principalPerson.family_name)
    ) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "divergencia",
        field: "I-914A — Principal Applicant Family Name",
        form: "I-914A",
        expected: `${principalPerson.family_name} (I-914)`,
        found: `${pa.family_name} (I-914A do dep)`,
        source: `I-914 (principal) vs I-914A (dep ${depSubject.display_name})`,
        explanation:
          "Family Name do Principal Applicant no I-914A não bate com o Family Name do principal no I-914.",
        rule_id: RULE_IDS.T_CONS_NAME_FORMS_DIVERGE,
        subject_id: depSubject.id
      });
    }
    if (
      norm(pa.given_name) &&
      norm(principalPerson.given_name) &&
      !namesPlausiblyEqual(pa.given_name, principalPerson.given_name)
    ) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "divergencia",
        field: "I-914A — Principal Applicant Given Name",
        form: "I-914A",
        expected: `${principalPerson.given_name} (I-914)`,
        found: `${pa.given_name} (I-914A do dep)`,
        source: `I-914 (principal) vs I-914A (dep ${depSubject.display_name})`,
        explanation:
          "Given Name do Principal Applicant no I-914A não bate com o Given Name do principal no I-914.",
        rule_id: RULE_IDS.T_CONS_NAME_FORMS_DIVERGE,
        subject_id: depSubject.id
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Nível 4 — Globais (elegibilidade narrativa, cruzamentos)
// ---------------------------------------------------------------------------

function applyLevel4Global(args: {
  forms: FormData[];
  story: StoryFacts | null;
  passportChecks: Array<{ subject_id: string | null; check: PassportSignatureCheck }>;
  witnessAnalysis?: WitnessStatementsAnalysis | null;
  medicalAnalysis?: MedicalAnalysis | null;
  countryAnalysis?: CountryConditionsAnalysis | null;
  leaQualification?: LeaQualification | null;
  translations?: TranslationsCheck | null;
  proofOfAddress?: ProofOfAddressAnalysis | null;
  subjects: Subject[];
  isDraft: boolean;
}): Finding[] {
  const out: Finding[] = [];
  const {
    forms,
    story,
    passportChecks,
    witnessAnalysis,
    medicalAnalysis,
    countryAnalysis,
    leaQualification,
    translations,
    proofOfAddress,
    subjects,
    isDraft
  } = args;

  const i914 = forms.find((f): f is Extract<FormData, { form: "I-914" }> => f.form === "I-914");
  const i914a = forms.filter((f): f is Extract<FormData, { form: "I-914A" }> => f.form === "I-914A");
  const i914b = forms.find((f): f is Extract<FormData, { form: "I-914B" }> => f.form === "I-914B");
  const i192 = forms.find((f): f is Extract<FormData, { form: "I-192" }> => f.form === "I-192");
  const i765s = forms.filter((f): f is Extract<FormData, { form: "I-765" }> => f.form === "I-765");
  const g28s = forms.filter((f): f is Extract<FormData, { form: "G-28" }> => f.form === "G-28");

  const principalSubject = subjects.find((s) => s.role === "principal") ?? null;

  // Reference person para usar em comparações com a story (ainda olhamos o I-914 do principal)
  const reference: Person | undefined = i914?.person;

  // ---- Bar Number do advogado (Requisição 05/06) ----
  // Deve ser 5794276 em todos os documentos. Coleta de G-28 e I-765.
  {
    const barOccurrences: Array<{ form: string; value: string }> = [];
    for (const g of g28s) {
      const v = digitsOnly((g as any).attorney_bar_number);
      if (v) barOccurrences.push({ form: "G-28", value: v });
    }
    for (const f of i765s) {
      const v = digitsOnly((f as any).attorney_bar_number);
      if (v) barOccurrences.push({ form: "I-765", value: v });
    }
    const expected = digitsOnly(EXPECTED_ATTORNEY_BAR);
    const divergent = barOccurrences.filter((o) => o.value !== expected);
    if (divergent.length > 0) {
      const found = divergent.map((o) => `${o.value} (${o.form})`).join(", ");
      out.push({
        severity: "alta",
        tier: "tier1_filing",
        category: "divergencia",
        field: "Bar Number do advogado",
        form: Array.from(new Set(divergent.map((o) => o.form))).join(", "),
        expected: `${EXPECTED_ATTORNEY_BAR} (Jeffrey Weingrad)`,
        found,
        explanation:
          `O Bar Number do advogado deve ser ${EXPECTED_ATTORNEY_BAR} em todos os documentos, mas foi encontrado valor divergente. Conferir se o número está correto no(s) formulário(s).`,
        recommendation: `Corrigir o Bar Number do advogado para ${EXPECTED_ATTORNEY_BAR} nos documentos divergentes.`,
        rule_id: RULE_IDS.T_FILING_ATTORNEY_BAR_DIVERGE,
        subject_id: principalSubject?.id ?? null
      });
    }
  }

  // ---- Draft mode notice (assinaturas) ----
  if (isDraft) {
    out.push({
      severity: "baixa",
      tier: "tier3_estrategico",
      category: "estrategia",
      field: "Assinaturas (modo draft)",
      explanation:
        "Modo DRAFT ativo: a verificação de assinaturas foi suprimida. Antes do protocolo na USCIS, coletar assinaturas do cliente em todos os formulários, G-28, intérprete e preparer quando aplicável.",
      rule_id: RULE_IDS.T_FILING_DRAFT_MODE_NOTICE,
      subject_id: null
    });
  } else {
    // G-28 signatures (final)
    for (const g of g28s) {
      const sid = getSubjectId(g) ?? principalSubject?.id ?? null;
      const clientSig = sigIncomplete(g.client_signature);
      if (clientSig.length > 0) {
        out.push({
          severity: "critica",
          tier: "tier1_filing",
          category: "assinatura",
          field: "G-28 — Assinatura do Cliente",
          form: "G-28",
          found: `Faltando: ${clientSig.join(", ")}`,
          explanation: "G-28 exige assinatura do cliente (Parte 4). Sem isso o G-28 é inválido.",
          rule_id: RULE_IDS.T_FILING_G28_CLIENT_SIG_MISSING,
          subject_id: sid
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
          explanation: "G-28 exige assinatura do advogado (Parte 5).",
          rule_id: RULE_IDS.T_FILING_G28_ATTORNEY_SIG_MISSING,
          subject_id: sid
        });
      }
    }
  }

  // ---- I-914B ----
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
        recommendation: "Apagar conteúdo da Parte 2 antes de enviar o I-914B à agência para certificação.",
        rule_id: RULE_IDS.T_FILING_I914B_PART2_PREFILLED,
        subject_id: principalSubject?.id ?? null
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
          "Substituir certificação por agência qualificada OU documentar cooperation por secondary evidence com justificativa.",
        rule_id: RULE_IDS.T_SUBST_I914B_AGENCY_NOT_QUALIFYING,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (leaQualification?.officer_signed === false && !isDraft) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "assinatura",
        field: "I-914B — Assinatura do Officer",
        form: "I-914B",
        explanation: "I-914B precisa da assinatura do Law Enforcement Officer certificador.",
        rule_id: RULE_IDS.T_FILING_I914B_OFFICER_SIG_MISSING,
        subject_id: principalSubject?.id ?? null
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
        recommendation: "Obter I-914B assinado pela agência OU declaração alternativa com secondary evidence.",
        rule_id: RULE_IDS.T_SUBST_COOPERATION_NO_I914B_NO_EXEMPTION,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (story?.cooperation_exempt_reason) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Cooperation exemption",
        form: null,
        explanation: `Cliente alega isenção de cooperation (${story.cooperation_exempt_reason}). Garantir que a isenção está documentada na história e suportada por evidências (idade, laudo de trauma severo).`,
        rule_id: RULE_IDS.T_SUBST_COOPERATION_EXEMPTION_DOCS_NEEDED,
        subject_id: principalSubject?.id ?? null
      });
    }
  }

  // ---- I-192 ----
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
            "História/I-914 indica entrada sem inspeção (EWI), mas I-192 não lista INA 212(a)(6)(A)(i) como ground of inadmissibility a ser renunciado.",
          rule_id: RULE_IDS.T_SUBST_I192_EWI_GROUND_MISSING,
          subject_id: principalSubject?.id ?? null
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
        explanation:
          "I-192 não apresenta justificativa narrativa do waiver (national interest / humanitarian / public interest).",
        rule_id: RULE_IDS.T_SUBST_I192_NO_WAIVER_JUSTIFICATION,
        subject_id: principalSubject?.id ?? null
      });
    }

    // Q10 — Inadmissibility checklist completo (criminal / prior removal / fraud)
    const groundsText = (i192.grounds_of_inadmissibility ?? []).join(" | ").toLowerCase();
    if (i914?.criminal_history_disclosed === true && !/\(2\)|criminal|212\(a\)\(2\)/.test(groundsText)) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "I-192 — Ground INA 212(a)(2) (criminal)",
        form: "I-192",
        explanation:
          "Cliente declarou criminal history (I-914) mas I-192 não inclui INA 212(a)(2) como ground a ser waivered.",
        recommendation:
          "Adicionar INA 212(a)(2) — criminal grounds — à lista de inadmissibilidades do I-192 e justificar waiver.",
        rule_id: RULE_IDS.T_SUBST_I192_CRIMINAL_GROUND_MISSING,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (
      i914?.removal_proceedings === true &&
      !/9\(a\)|prior removal|prior deportation|212\(a\)\(9\)/.test(groundsText)
    ) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "I-192 — Ground INA 212(a)(9)(A) (prior removal)",
        form: "I-192",
        explanation:
          "Cliente em removal proceedings (I-914) mas I-192 não cobre INA 212(a)(9)(A) — prior removal/deportation.",
        recommendation:
          "Incluir INA 212(a)(9)(A) caso haja ordem prévia de remoção/deportação.",
        rule_id: RULE_IDS.T_SUBST_I192_PRIOR_REMOVAL_GROUND_MISSING,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (
      Array.isArray(i914?.prior_applications) &&
      (i914?.prior_applications ?? []).length > 0 &&
      !/6\(c\)|fraud|misrepresentation|212\(a\)\(6\)\(c\)/.test(groundsText)
    ) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "I-192 — Ground INA 212(a)(6)(C) (fraud/misrepresentation)",
        form: "I-192",
        explanation:
          "Cliente tem aplicações imigratórias prévias — verificar se houve misrepresentation. I-192 atual não cobre INA 212(a)(6)(C).",
        recommendation:
          "Revisar histórico das aplicações anteriores. Se houver indício de misrepresentation, incluir INA 212(a)(6)(C) no I-192.",
        rule_id: RULE_IDS.T_SUBST_I192_FRAUD_GROUND_PROBABLY_NEEDED,
        subject_id: principalSubject?.id ?? null
      });
    }
  }

  // ---- I-765 categoria + nome ----
  const principalName = `${i914?.person?.given_name ?? ""} ${i914?.person?.family_name ?? ""}`.trim();
  for (const i765 of i765s) {
    const sid = getSubjectId(i765) ?? principalSubject?.id ?? null;
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
          explanation: "Categoria de elegibilidade parece inválida para T-1 principal. T-1 usa (c)(25).",
          recommendation: "Revisar categoria conforme instruções do I-765 para T-visa.",
          rule_id: RULE_IDS.T_FILING_I765_CATEGORY_INVALID_FOR_T1,
          subject_id: sid
        });
      }
    } else {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "campo_vazio",
        field: "I-765 — Eligibility Category",
        form: "I-765",
        explanation: "Eligibility category em branco. USCIS rejeita I-765 sem categoria.",
        rule_id: RULE_IDS.T_FILING_I765_CATEGORY_EMPTY,
        subject_id: sid
      });
    }

    if (i765.person && principalName) {
      const i765Name = `${i765.person.given_name ?? ""} ${i765.person.family_name ?? ""}`.trim();
      // Convenção brasileira: subset de tokens de nome conta como mesma pessoa.
      const forPrincipal = namesPlausiblyEqual(i765Name, principalName);
      // Ajuste (Flavia 29/04): dependentes têm I-765 próprio. Se o I-765 está marcado
      // como do principal mas o nome bate com algum I-914A, é mais provável que seja
      // o I-765 do dependente etiquetado errado pelo extractor — não tratar como
      // alta severidade. Só dispara quando o nome não bate com NINGUÉM do caso.
      if (i765.is_for_principal === true && !forPrincipal) {
        const matchesAnyDependent = i914a.some((dep) => {
          const depName = `${dep.family_member?.given_name ?? ""} ${dep.family_member?.family_name ?? ""}`.trim();
          return depName ? namesPlausiblyEqual(i765Name, depName) : false;
        });
        if (!matchesAnyDependent) {
          // Calibração rodada 5 (11/05): rebaixar para "baixa" e tier3.
          // Em casos com múltiplos I-765 (um por sujeito), o cluster-validator
          // nem sempre atribui corretamente o I-765 ao sujeito certo, e o
          // extractor marca is_for_principal=true por padrão. 4 de 6 feedbacks
          // sobre esta regra foram marcados como incorretos pela Flavia.
          out.push({
            severity: "baixa",
            tier: "tier3_estrategico",
            category: "estrategia",
            field: "I-765 — Destinatário",
            form: "I-765",
            explanation: `I-765 atribuído ao principal mas o nome (${i765Name}) não bate com I-914 (${principalName}) nem com nenhum I-914A do caso. Pode ser falha de agrupamento do sistema.`,
            recommendation: `Apenas verificar se este I-765 pertence ao sujeito correto. Em filings com múltiplos dependentes, cada um tem seu próprio I-765.`,
            rule_id: RULE_IDS.T_FILING_I765_NAME_DIVERGES,
            subject_id: sid
          });
        }
      }
    }
  }

  // ---- Story × principal (DOB, marital, passport, entry, port) ----
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
          form: "I-914",
          expected: `${s} (história)`,
          found: `${r} (formulário)`,
          source: "história vs formulário",
          explanation: "Estado civil na história não bate com o formulário.",
          rule_id: RULE_IDS.T_CONS_MARITAL_STORY_FORM_DIVERGE,
          subject_id: principalSubject?.id ?? null
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
          form: "I-914",
          expected: `${story.date_of_birth} (história)`,
          found: `${reference.date_of_birth} (formulário)`,
          source: "história vs formulário",
          explanation: "Data de nascimento divergente entre história e formulário.",
          rule_id: RULE_IDS.T_CONS_DOB_STORY_FORM_DIVERGE,
          subject_id: principalSubject?.id ?? null
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
          form: "I-914",
          expected: `${story.passport_number_mentioned} (história)`,
          found: `${reference.passport_number} (formulário)`,
          source: "história vs formulário",
          explanation: "Número do passaporte divergente entre história e formulário.",
          rule_id: RULE_IDS.T_CONS_PASSPORT_STORY_FORM_DIVERGE,
          subject_id: principalSubject?.id ?? null
        });
      }
    }

    if (i914?.entry?.last_entry_date && story.year_entered_us) {
      const formYear = (i914.entry.last_entry_date.match(/\d{4}/) ?? [""])[0];
      // Calibração rodada 4 (Flavia 04/05): "ano da história" frequentemente
      // refere à PRIMEIRA entrada, mas last_entry_date é a ÚLTIMA. Quando o
      // form é mais recente que a história, é provável múltipla entrada e
      // não acusamos divergência. Quando só temos year, a comparação é
      // pobre demais — rebaixar pra baixa e contextualizar.
      const travelHistory = ((i914.entry as any)?.travel_history ?? []) as any[];
      const hasMultipleEntries = Array.isArray(travelHistory) && travelHistory.length > 0;
      const formYearN = parseInt(formYear || "0", 10);
      const storyYearN = parseInt(story.year_entered_us, 10);
      const formIsLater = formYearN > storyYearN;
      if (
        formYear &&
        formYear !== story.year_entered_us &&
        !hasMultipleEntries &&
        !formIsLater
      ) {
        out.push({
          severity: "baixa",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: "Last Entry Date",
          form: "I-914",
          expected: `${story.year_entered_us} (história)`,
          found: `${i914.entry.last_entry_date} (I-914)`,
          source: "história vs I-914",
          explanation: "Ano de entrada na história anterior ao last_entry_date do I-914 — confirmar se cliente teve múltiplas entradas (caso comum, history descreve a primeira e o form pede a última).",
          rule_id: RULE_IDS.T_CONS_ENTRY_YEAR_DIVERGE,
          subject_id: principalSubject?.id ?? null
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
          explanation: "Local de entrada nos EUA diverge entre história e formulário.",
          rule_id: RULE_IDS.T_CONS_PORT_OF_ENTRY_DIVERGE,
          subject_id: principalSubject?.id ?? null
        });
      }
    }

    // Ajuste rodada 4 (Flavia 04/05): só dispara quando a história afirma cônjuge
    // E o formulário marca EXPLICITAMENTE solteiro/divorciado. Quando o
    // marital_status do form vem null (extractor não conseguiu ler) NÃO acusar —
    // os 3 reviews onde isso disparou tinham form.marital_status=null mas a
    // Flavia confirmou no PDF físico que estava marcado "Married".
    const storyHasSpouse =
      !!story.spouse_name || normalizeMarital(story.marital_status) === "casado";
    const formMarital = normalizeMarital(reference.marital_status);
    const formExplicitlyNotMarried =
      !!formMarital && formMarital !== "casado" && formMarital !== "uniao_estavel";
    if (storyHasSpouse && formExplicitlyNotMarried) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "credibilidade",
        field: "Marital Status (cônjuge)",
        form: "I-914",
        expected: "casado (história menciona cônjuge)",
        found: "não casado (formulário)",
        source: "história vs formulário",
        explanation:
          "História menciona cônjuge mas o formulário marca o cliente como não casado.",
        rule_id: RULE_IDS.T_CONS_SPOUSE_FLAG_DIVERGE,
        subject_id: principalSubject?.id ?? null
      });
    }

    // ---- story.children × i914a + family_members ----
    const storyChildren = story.children ?? [];
    if (storyChildren.length > 0) {
      const filingDate = parseDate(i914?.meta?.applicant_signature?.date_signed) ?? new Date();
      const qualifyingChildren = storyChildren.filter((c) => {
        const age = ageAtDate(c.date_of_birth, filingDate);
        if (age === null) return false;
        if (age >= 21) return false;
        if (c.marital_status && !isUnmarried(c.marital_status)) return false;
        return true;
      });

      // Ajuste (Flavia 29/04): filhos cidadãos americanos não precisam de I-914A
      // (eles já têm status próprio). Descontamos os filhos marcados como USC
      // em family_members_included antes de comparar.
      const usCitizenChildNames = new Set(
        (i914?.family_members_included ?? [])
          .filter((fm) => fm.is_us_citizen === true)
          .map((fm) => (fm.name ?? "").trim().toLowerCase())
          .filter((n) => n.length > 0)
      );
      const qualifyingNonUsc = qualifyingChildren.filter((c) => {
        const name = (c.name ?? "").trim().toLowerCase();
        if (!name) return true;
        for (const usc of usCitizenChildNames) {
          if (namesPlausiblyEqual(name, usc)) return false;
        }
        return true;
      });

      if (qualifyingNonUsc.length > i914a.length) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "elegibilidade",
          field: "Dependentes (I-914A)",
          form: "I-914A",
          expected: `${qualifyingNonUsc.length} filho(s) qualificado(s) (solteiro, < 21 anos no filing, não cidadão americano) na história`,
          found: `${i914a.length} I-914A no processo`,
          source: "história vs I-914A",
          explanation:
            "Principal adulto pode incluir como derivativos apenas filhos SOLTEIROS MENORES DE 21 NO FILING (CSPA age-out protection). Há filhos qualificados na história sem I-914A correspondente. Se algum desses filhos for cidadão americano ou não estiver em solo americano, não precisa de I-914A: marcar este finding como falso positivo.",
          rule_id: RULE_IDS.T_DEP_QUALIFYING_CHILD_NO_I914A,
          subject_id: principalSubject?.id ?? null
        });
      }

      const nonQualifyingKids = (story.children ?? []).filter((c) => {
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
          if (c.marital_status && !isUnmarried(c.marital_status)) reasons.push(`casado(a)`);
          return `${c.name ?? "filho(a)"} (${reasons.join(", ")})`;
        });
        out.push({
          severity: "baixa",
          tier: "tier3_estrategico",
          category: "estrategia",
          field: "Filhos não qualificados como derivativos",
          explanation: `Não qualifica(m) como T-derivativo, correto não incluir I-914A: ${reasons.join("; ")}.`,
          rule_id: RULE_IDS.T_DEP_NON_QUALIFYING_KIDS_OK,
          subject_id: principalSubject?.id ?? null
        });
      }

      const childrenUnknownAge = (story.children ?? []).filter(
        (c) => ageAtDate(c.date_of_birth, filingDate) === null
      );
      if (childrenUnknownAge.length > 0) {
        out.push({
          severity: "baixa",
          tier: "tier2_substantivo",
          category: "elegibilidade",
          field: "Dependentes sem data de nascimento",
          explanation: `${childrenUnknownAge.length} filho(s) na história sem DOB. Confirmar idade no filing.`,
          rule_id: RULE_IDS.T_DEP_CHILDREN_UNKNOWN_AGE,
          subject_id: principalSubject?.id ?? null
        });
      }

      // Q9 — CSPA age-out risk: filhos com idade entre 20 e 21 anos no filing
      for (const c of (story.children ?? [])) {
        const age = ageAtDate(c.date_of_birth, filingDate);
        if (age === null) continue;
        if (age >= 20 && age < 21) {
          out.push({
            severity: "alta",
            tier: "tier2_substantivo",
            category: "elegibilidade",
            field: `CSPA age-out risk — ${c.name ?? "filho(a)"}`,
            form: null,
            explanation: `${c.name ?? "Filho(a)"} tem ${age} anos no filing date — aproximando-se de 21 anos. Risco de envelhecer durante processamento USCIS antes da aprovação (CSPA INA 203(h) protege parcialmente, mas não há garantia de cobertura completa para T-derivativos).`,
            recommendation:
              "Acelerar I-914A. Documentar o filing date com clareza para invocar proteção CSPA. Avaliar request expedite junto ao USCIS.",
            rule_id: RULE_IDS.T_DEP_CSPA_AGE_OUT_RISK,
            subject_id: principalSubject?.id ?? null
          });
        }
      }

      // ---- Cruzamento NOVO: filho da história × family_members_included × I-914A ----
      const fmIncluded = i914?.family_members_included ?? [];
      for (const child of (story.children ?? [])) {
        if (!child.name) continue;
        const childNameNorm = norm(child.name);
        const inFm = fmIncluded.some(
          (fm) => fm.name && norm(fm.name).includes(childNameNorm.split(" ")[0])
        );
        const inI914A = i914a.some((a) => {
          const fn = a.family_member?.given_name;
          const ln = a.family_member?.family_name;
          const full = `${fn ?? ""} ${ln ?? ""}`.trim();
          return full && norm(full).includes(childNameNorm.split(" ")[0]);
        });
        if (!inFm && !inI914A) {
          out.push({
            // Ajuste (Flavia 29/04): filhos cidadãos americanos ou que não
            // estejam em solo americano podem ser citados na história sem
            // constar nos formulários (não precisam de I-914A). Rebaixado
            // para media e mensagem orienta a equipe a confirmar.
            severity: "media",
            tier: "tier2_substantivo",
            category: "credibilidade",
            field: `Filho na história sem entrada no I-914 — ${child.name}`,
            form: null,
            explanation: `${child.name} aparece na história mas não tem entrada correspondente em family_members_included nem I-914A. Se for cidadão americano ou não estiver em solo americano, o I-914A não é necessário: marcar como falso positivo.`,
            rule_id: RULE_IDS.T_CONS_CHILD_NAME_VS_I914A,
            subject_id: principalSubject?.id ?? null
          });
        }
        // DOB diverge?
        if (child.date_of_birth) {
          const matchingA = i914a.find((a) => {
            const fn = a.family_member?.given_name;
            const full = norm(fn ?? "");
            return full && full.includes(norm(child.name?.split(" ")[0] ?? ""));
          });
          if (matchingA?.family_member?.date_of_birth) {
            if (norm(matchingA.family_member.date_of_birth) !== norm(child.date_of_birth)) {
              out.push({
                severity: "alta",
                tier: "tier2_substantivo",
                category: "credibilidade",
                field: `DOB do filho — ${child.name}`,
                form: "I-914A",
                expected: `${child.date_of_birth} (história)`,
                found: `${matchingA.family_member.date_of_birth} (I-914A)`,
                source: "história vs I-914A",
                explanation: "Data de nascimento do filho diverge entre história e I-914A.",
                rule_id: RULE_IDS.T_CONS_CHILD_DOB_VS_I914A,
                subject_id: principalSubject?.id ?? null
              });
            }
          }
        }
      }
    }

    // ---- Story × witness: trafficker name aparece como witness? ----
    if ((story.traffickers_identified ?? []).length > 0 && witnessAnalysis) {
      const traffickers = (story.traffickers_identified ?? []).map((t) => norm(t));
      for (const w of witnessAnalysis.items ?? []) {
        if (!w.witness_name) continue;
        const wn = norm(w.witness_name);
        const match = traffickers.some((t) => t && (t.includes(wn) || wn.includes(t)));
        if (match) {
          out.push({
            severity: "critica",
            tier: "tier2_substantivo",
            category: "credibilidade",
            field: `Testemunha aparece como traficante — ${w.witness_name}`,
            form: "Witness Statements",
            explanation:
              "Uma das testemunhas tem o mesmo nome de uma pessoa identificada como traficante na história. Problema sério de credibilidade — verificar.",
            rule_id: RULE_IDS.T_CONS_TRAFFICKER_NAME_VS_WITNESS,
            subject_id: principalSubject?.id ?? null
          });
        }
      }
    }

    // ---- Elegibilidade narrativa ----
    if (
      story.force_mentioned === false &&
      story.fraud_mentioned === false &&
      story.coercion_mentioned === false
    ) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Severe form of trafficking (force/fraud/coercion)",
        form: null,
        explanation:
          "História não caracteriza force, fraud ou coercion. T-visa exige pelo menos um dos três elementos.",
        recommendation:
          "Revisar declaração para caracterizar explicitamente ameaças, violência, engano ou coerção psicológica.",
        rule_id: RULE_IDS.T_SUBST_NO_FORCE_FRAUD_COERCION,
        subject_id: principalSubject?.id ?? null
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
          "Não está claro na história se o trafficking foi sexual, laboral ou ambos. USCIS precisa caracterização precisa.",
        rule_id: RULE_IDS.T_SUBST_TRAFFICKING_TYPE_UNCLEAR,
        subject_id: principalSubject?.id ?? null
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
        recommendation: "Revisar e reforçar o nexo entre presença nos EUA e os eventos de tráfico.",
        rule_id: RULE_IDS.T_SUBST_NO_PHYSICAL_PRESENCE_NEXUS,
        subject_id: principalSubject?.id ?? null
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
          "Desenvolver seção sobre hardship: re-trafficking risk, falta de mental health care, retaliação, impunidade no país de origem.",
        rule_id: RULE_IDS.T_SUBST_HARDSHIP_ABSENT,
        subject_id: principalSubject?.id ?? null
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
          "História pouco descritiva sobre impacto emocional/psicológico do tráfico. Descrição detalhada fortalece credibilidade e dialoga com medical evaluation.",
        rule_id: RULE_IDS.T_SUBST_TRAUMA_UNDERDESCRIBED,
        subject_id: principalSubject?.id ?? null
      });
    }
  }

  // ---- family_members_included no I-914 (qualificação como derivative) ----
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

      // Q9 — CSPA age-out risk para filho qualificado entre 20 e 21 anos no filing
      if (isChild && age !== null && age >= 20 && age < 21) {
        out.push({
          severity: "alta",
          tier: "tier2_substantivo",
          category: "elegibilidade",
          field: `CSPA age-out risk — ${fm.name ?? "filho(a)"}`,
          form: "I-914",
          explanation: `${fm.name ?? "Filho(a)"} tem ${age} anos no filing date — aproximando-se de 21 anos. Risco de envelhecer durante processamento USCIS antes da aprovação (proteção CSPA INA 203(h) é parcial para T-derivativos).`,
          recommendation:
            "Acelerar I-914A. Documentar filing date com clareza para invocar CSPA. Avaliar request expedite.",
          rule_id: RULE_IDS.T_DEP_CSPA_AGE_OUT_RISK,
          subject_id: principalSubject?.id ?? null
        });
      }

      if (qualifies) {
        const matchingA = i914a.find(
          (a) =>
            norm(a.family_member?.family_name ?? "") + norm(a.family_member?.given_name ?? "") ===
            norm((fm.name ?? "").split(" ").slice(-1)[0]) + norm((fm.name ?? "").split(" ")[0])
        );
        if (!matchingA) {
          // Ajuste 10.4 (Flavia): filho americano OU residente fora dos EUA não dispara crítica
          const isUsCitizen = fm.is_us_citizen === true;
          const residesAbroad =
            !!fm.country_of_residence &&
            norm(fm.country_of_residence) !== "US" &&
            norm(fm.country_of_residence) !== "USA" &&
            norm(fm.country_of_residence) !== "UNITED STATES";

          if (isChild && isUsCitizen) {
            out.push({
              severity: "baixa",
              tier: "tier3_estrategico",
              category: "estrategia",
              field: `${fm.name ?? "Filho"} — USC, sem I-914A`,
              form: null,
              explanation:
                "Filho marcado como cidadão americano — não precisa de I-914A (já é USC). Correto não incluir.",
              rule_id: RULE_IDS.T_DEP_USC_CHILD_NO_I914A_OK,
              subject_id: principalSubject?.id ?? null
            });
          } else if (isChild && residesAbroad) {
            out.push({
              severity: "baixa",
              tier: "tier3_estrategico",
              category: "estrategia",
              field: `${fm.name ?? "Filho"} — reside fora dos EUA, sem I-914A`,
              form: null,
              explanation: `Filho reside em ${fm.country_of_residence}. I-914A pode ser apresentado para consular processing posterior — não bloqueia o filing do principal.`,
              rule_id: RULE_IDS.T_DEP_NON_US_CHILD_NO_I914A_OK,
              subject_id: principalSubject?.id ?? null
            });
          } else {
            out.push({
              severity: "alta",
              tier: "tier2_substantivo",
              category: "elegibilidade",
              field: `I-914A faltando — ${fm.name ?? "familiar"}`,
              form: "I-914A",
              explanation: `${fm.name ?? "Familiar"} (${rel || "relação"}, ${age !== null ? age + " anos no filing" : "idade desconhecida"}${fm.marital_status ? ", " + normalizeMarital(fm.marital_status) : ""}) qualifica como T-derivativo mas não tem I-914A no processo.`,
              rule_id: RULE_IDS.T_DEP_QUALIFYING_CHILD_NO_I914A,
              subject_id: principalSubject?.id ?? null
            });
          }
        }
      } else if (fm.name) {
        out.push({
          severity: "baixa",
          tier: "tier3_estrategico",
          category: "estrategia",
          field: `${fm.name} — não qualifica`,
          explanation: `${fm.name} (${rel || "relação"}) listado no I-914 mas não qualifica como T-derivativo: ${nonQualifyingReason ?? "não atende requisitos"}. Correto não incluir I-914A.`,
          rule_id: RULE_IDS.T_DEP_NON_QUALIFYING_FAMILY_MEMBER_OK,
          subject_id: principalSubject?.id ?? null
        });
      }
    }
  }

  // ---- I-914A checks ----
  if (i914a.length > 0) {
    for (const a of i914a) {
      const sid = getSubjectId(a) ?? null;
      if (a.family_member?.date_of_birth) {
        const dob = a.family_member.date_of_birth;
        const year = dob.match(/\d{4}/)?.[0];
        const principalDob = i914?.person?.date_of_birth ?? "";
        const principalYear = principalDob.match(/\d{4}/)?.[0];
        if (year && principalYear) {
          const ageDiff = Number(principalYear) - Number(year);
          // Ajuste (Flavia 29/04): mães jovens são comuns; threshold mais
          // conservador (< 7 anos) e severidade rebaixada para baixa pra
          // funcionar como observação, não bloqueio.
          if (a.relationship_to_principal && /child/i.test(a.relationship_to_principal) && ageDiff < 7) {
            out.push({
              severity: "baixa",
              tier: "tier2_substantivo",
              category: "elegibilidade",
              field: "I-914A — Qualifying relationship (idade)",
              form: "I-914A",
              explanation: `I-914A marcado como filho mas diferença de idade com o principal é pequena (${ageDiff} anos). Confirmar relacionamento.`,
              rule_id: RULE_IDS.T_DEP_FAMILY_MEMBER_REL_DIFF_AGE_SUSPICIOUS,
              subject_id: sid
            });
          }
        }
      }
      if (!a.relationship_evidence_mentioned || a.relationship_evidence_mentioned.length === 0) {
        // Calibração rodada 4 (Flavia 04/05):
        // - Aceitar passaporte do dependente como evidência da relação (Flavia: "tem passaporte").
        // - Aceitar certidão de casamento do principal como evidência quando o dep é cônjuge.
        // - Aceitar passport_check do dependente (passaporte detectado na imagem).
        // - Aceitar a_number ou ssn no family_member como sinal de que houve documentação USCIS prévia.
        const depHasPassportNumber = !!a.family_member?.passport_number;
        const depHasPassportImage = passportChecks.some(
          (pc) => pc.subject_id === sid && pc.check?.has_passport_image === true
        );
        const depHasUscisIds = !!a.family_member?.a_number || !!a.family_member?.ssn;
        const rel = (a.relationship_to_principal ?? "").toLowerCase();
        const isSpouse = /spouse|cônjuge|conjuge|wife|husband|esposa|esposo|marido/.test(rel);
        const principalMaritalSays = /married|casado|casada|spouse/.test(
          norm(i914?.person?.marital_status ?? "").toLowerCase()
        );
        const marriageIsImplicit = isSpouse && principalMaritalSays;

        const hasAnyEvidence =
          depHasPassportNumber ||
          depHasPassportImage ||
          depHasUscisIds ||
          marriageIsImplicit;

        if (!hasAnyEvidence) {
          out.push({
            severity: "baixa",
            tier: "tier3_estrategico",
            category: "estrategia",
            field: "I-914A — Evidência da relação",
            form: "I-914A",
            explanation:
              "O sistema não localizou evidência do relacionamento (sem passaporte, sem A-number/SSN do dependente, sem indicação de cônjuge no marital status do principal). Apenas confirmar se há certidão de nascimento/casamento em Identification Documents.",
            rule_id: RULE_IDS.T_DEP_I914A_NO_EVIDENCE,
            subject_id: sid
          });
        }
      }
      if (a.location === "abroad") {
        out.push({
          severity: "baixa",
          tier: "tier3_estrategico",
          category: "estrategia",
          field: "I-914A — Dependente no exterior",
          form: "I-914A",
          explanation:
            "Dependente marcado como estando no exterior — será necessário consular processing após aprovação (adiciona tempo).",
          rule_id: RULE_IDS.T_DEP_I914A_ABROAD_CONSULAR,
          subject_id: sid
        });
      }
    }
  }

  // ---- Passport checks (loop) — Ajuste 23.1: critica em qualquer modo ----
  // Calibração rodada 4 (Flavia 04/05): se subject_id vier null, NÃO assumir
  // principal — tentar inferir pelo holder_name cruzando com sujeitos. Se nem
  // assim resolver, deixar sid=null e NÃO emitir findings VS_FORM (evita o
  // bug onde passaporte da esposa virava finding contra o I-914 do principal).
  for (const pc of passportChecks) {
    const check = pc.check;
    let sid = pc.subject_id ?? null;
    if (!sid && (pc as any).holder_name) {
      const holderName = (pc as any).holder_name as string;
      const matchedSubject = subjects.find((s) => {
        const subjFull = `${s.given_name ?? ""} ${s.family_name ?? ""}`.trim();
        return subjFull && namesPlausiblyEqual(holderName, subjFull);
      });
      if (matchedSubject) sid = matchedSubject.id;
    }
    if (check.has_passport_image && check.signed === false) {
      out.push({
        severity: "critica",
        tier: "tier1_filing",
        category: "suporte_documental",
        field: "Assinatura do passaporte",
        form: "Identification Documents",
        expected: "Passaporte assinado pelo titular",
        found: "Passaporte sem assinatura no campo do titular",
        explanation: "USCIS pode rejeitar passaporte não assinado.",
        rule_id: RULE_IDS.DOC_PASSPORT_SIG_MISSING,
        subject_id: sid
      });
    } else if (check.has_passport_image && check.signed === null) {
      out.push({
        severity: "media",
        tier: "tier1_filing",
        category: "suporte_documental",
        field: "Assinatura do passaporte",
        form: "Identification Documents",
        explanation: "Revisar manualmente se o passaporte está assinado (qualidade da imagem ambígua).",
        source: check.notes ?? undefined,
        rule_id: RULE_IDS.DOC_PASSPORT_SIG_AMBIGUOUS,
        subject_id: sid
      });
    }
    // Cross-check completo passport ↔ form (TODOS os campos extraídos)
    // Resolver "person" do sujeito apropriado:
    //  - principal → reference (já é I-914.person ou I-918.person)
    //  - dep_N → family_member do I-914A/I-918A com mesmo subject_id
    let personOfSubject: Person | null = null;
    let personFormName = "I-914";
    if (sid && sid !== "principal") {
      const depForm = forms.find(
        (f) => (f as any)._subject_id === sid && (f.form === "I-914A" || (f as any).form === "I-918A")
      ) as any;
      personOfSubject = depForm?.family_member ?? null;
      personFormName = depForm?.form ?? "I-914A";
    } else if (sid === "principal" && reference) {
      personOfSubject = reference;
      const principalForm = forms.find(
        (f) => f.form === "I-914" || (f as any).form === "I-918"
      ) as any;
      personFormName = principalForm?.form ?? "I-914";
    }
    // sid=null: passaporte solto, dono não identificado. Não cruza com forms
    // pra evitar falsos positivos (passaporte da esposa virando finding do
    // principal). O DOC_PASSPORT_SIG_MISSING acima já cobriu o necessário.

    // Helpers de comparação tolerante
    const fieldDiverges = (
      seen: string | null | undefined,
      formValue: string | null | undefined,
      label: string,
      ruleId: string,
      severity: "critica" | "alta" | "media" = "alta",
      useNamePlausible = false
    ) => {
      if (!seen || !formValue) return;
      const equivalent = useNamePlausible
        ? namesPlausiblyEqual(seen, formValue)
        : norm(seen) === norm(formValue);
      if (!equivalent) {
        out.push({
          severity,
          tier: "tier1_filing",
          category: "divergencia",
          field: `${label} (passaporte vs formulário)`,
          form: personFormName,
          expected: `${seen} (passaporte físico)`,
          found: `${formValue} (formulário)`,
          source: `passport_check vs ${personFormName}.person`,
          explanation: `${label} no formulário não bate com o lido no passaporte físico. USCIS cruza dados — divergência gera RFE.`,
          recommendation:
            "Padronizar o valor usando o passaporte como fonte da verdade.",
          rule_id: ruleId,
          subject_id: sid
        });
      }
    };

    if (personOfSubject) {
      // Passport number — semântica histórica: crítica
      fieldDiverges(
        check.passport_number_seen,
        personOfSubject.passport_number,
        "Passport Number",
        RULE_IDS.DOC_PASSPORT_NUMBER_IMG_VS_FORM,
        "critica"
      );
      // Date of birth — DOB é fatal pra USCIS
      fieldDiverges(
        check.date_of_birth_seen,
        personOfSubject.date_of_birth,
        "Date of Birth",
        RULE_IDS.DOC_PASSPORT_DOB_VS_FORM,
        "critica"
      );
      // Family name — usa subset (convenção brasileira)
      fieldDiverges(
        check.holder_family_name_seen,
        personOfSubject.family_name,
        "Family Name",
        RULE_IDS.DOC_PASSPORT_FAMILY_NAME_VS_FORM,
        "alta",
        true
      );
      // Given name — usa subset
      fieldDiverges(
        check.holder_given_names_seen,
        personOfSubject.given_name,
        "Given Name",
        RULE_IDS.DOC_PASSPORT_GIVEN_NAME_VS_FORM,
        "alta",
        true
      );
      // Country of birth — passaporte traz "Place of Birth" que pode incluir cidade,
      // estado e país numa string só (em PT-BR ou EN). O formulário separa em
      // campos distintos. Calibração rodada 4 (Flavia 04/05): "BRASIL" vs "BRAZIL"
      // estavam disparando como divergência. Solução: tokenizar com nomes
      // canônicos por país (BRASIL ≡ BRAZIL ≡ BRAZILIAN ≡ BR) antes de comparar.
      if (check.place_of_birth_seen && personOfSubject.country_of_birth) {
        const placeNorm = norm(check.place_of_birth_seen);
        const countryNorm = norm(personOfSubject.country_of_birth);
        const COUNTRY_ALIASES: Record<string, string[]> = {
          BRASIL: ["BRAZIL", "BRA", "BR", "BRAZILIAN", "BRASILEIRO", "BRASILEIRA"],
          BRAZIL: ["BRASIL", "BRA", "BR", "BRAZILIAN", "BRASILEIRO", "BRASILEIRA"]
        };
        const BRAZILIAN_STATES = new Set([
          "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
          "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
        ]);
        const tokenize = (s: string) =>
          s
            .split(/[\s,;./-]+/)
            .map((t) => t.trim())
            .filter((t) => t.length >= 2);
        const placeTokens = new Set(tokenize(placeNorm));
        const formTokens = tokenize(countryNorm);
        // Expande tokens com aliases conhecidos
        const placeExpanded = new Set<string>(placeTokens);
        for (const t of placeTokens) {
          for (const alias of COUNTRY_ALIASES[t] ?? []) placeExpanded.add(alias);
        }
        const formExpanded = new Set<string>(formTokens);
        for (const t of formTokens) {
          for (const alias of COUNTRY_ALIASES[t] ?? []) formExpanded.add(alias);
        }
        // Calibração rodada 4 (Flavia 04/05): passaporte brasileiro frequentemente
        // só traz cidade/UF (ex: "VEREDA/BA", "ITAMBACURI/MG") sem repetir "Brasil".
        // Quando o form diz "Brazil/Brasil" e o passaporte tem alguma UF brasileira,
        // tratar como coerente.
        const formIsBrazil = formTokens.some(
          (t) => t === "BRAZIL" || t === "BRASIL" || t === "BR" || t === "BRA"
        );
        const placeHasBrazilianState = [...placeTokens].some((t) => BRAZILIAN_STATES.has(t));
        const overlap =
          placeNorm.includes(countryNorm) ||
          countryNorm.includes(placeNorm) ||
          formTokens.some((t) => placeExpanded.has(t)) ||
          [...placeTokens].some((t) => formExpanded.has(t)) ||
          (formIsBrazil && placeHasBrazilianState);
        if (!overlap) {
          out.push({
            severity: "media",
            tier: "tier1_filing",
            category: "divergencia",
            field: "Country of Birth (passaporte vs formulário)",
            form: personFormName,
            expected: `${check.place_of_birth_seen} (passaporte)`,
            found: `${personOfSubject.country_of_birth} (formulário)`,
            source: `passport_check vs ${personFormName}.person.country_of_birth`,
            explanation:
              "Local de nascimento no passaporte não é coerente com country_of_birth no formulário.",
            rule_id: RULE_IDS.DOC_PASSPORT_BIRTH_PLACE_VS_FORM,
            subject_id: sid
          });
        }
      }
      // Nationality — passaporte usa códigos (BRA, USA), gentílico (BRASILEIRO,
      // AMERICAN), ou nome (Brasil, Brazil); forms também variam.
      // Resolve cada lado pra um "país canônico" (ISO3) e compara.
      if (check.nationality_seen && personOfSubject.country_of_citizenship) {
        const natNorm = norm(check.nationality_seen);
        const formNorm = norm(personOfSubject.country_of_citizenship);
        // Catálogo: ISO3 → todos os tokens reconhecidos (ISO2, nome PT/EN,
        // gentílico PT m/f, gentílico EN). Em caixa alta + sem acentos
        // (norm já uppercase + trim, mas estes literais devem estar normalizados).
        const COUNTRY_TOKENS: Record<string, string[]> = {
          BRA: ["BR", "BRAZIL", "BRASIL", "BRAZILIAN", "BRASILEIRO", "BRASILEIRA"],
          USA: [
            "US",
            "U.S.",
            "U.S.A.",
            "UNITED STATES",
            "UNITED STATES OF AMERICA",
            "AMERICAN",
            "AMERICANO",
            "AMERICANA",
            "ESTADOUNIDENSE"
          ],
          MEX: ["MX", "MEXICO", "MÉXICO", "MEXICAN", "MEXICANO", "MEXICANA"],
          COL: [
            "CO",
            "COLOMBIA",
            "COLÔMBIA",
            "COLOMBIAN",
            "COLOMBIANO",
            "COLOMBIANA"
          ],
          VEN: [
            "VE",
            "VENEZUELA",
            "VENEZUELAN",
            "VENEZUELANO",
            "VENEZUELANA"
          ],
          ARG: [
            "AR",
            "ARGENTINA",
            "ARGENTINIAN",
            "ARGENTINE",
            "ARGENTINO"
          ],
          PER: ["PE", "PERU", "PERÚ", "PERUVIAN", "PERUANO", "PERUANA"],
          CHL: ["CL", "CHILE", "CHILEAN", "CHILENO", "CHILENA"],
          ECU: [
            "EC",
            "ECUADOR",
            "EQUADOR",
            "ECUADORIAN",
            "EQUATORIANO",
            "ECUATORIANO"
          ],
          BOL: ["BO", "BOLIVIA", "BOLIVIAN", "BOLIVIANO", "BOLIVIANA"],
          URY: ["UY", "URUGUAY", "URUGUAI", "URUGUAYAN", "URUGUAIO"],
          PRY: [
            "PY",
            "PARAGUAY",
            "PARAGUAI",
            "PARAGUAYAN",
            "PARAGUAIO"
          ],
          HND: [
            "HN",
            "HONDURAS",
            "HONDURAN",
            "HONDURENHO",
            "HONDUREÑO"
          ],
          GTM: [
            "GT",
            "GUATEMALA",
            "GUATEMALAN",
            "GUATEMALTECO"
          ],
          SLV: [
            "SV",
            "EL SALVADOR",
            "SALVADOREAN",
            "SALVADORENHO",
            "SALVADOREÑO"
          ],
          NIC: [
            "NI",
            "NICARAGUA",
            "NICARAGUAN",
            "NICARAGUENSE",
            "NICARAGÜENSE"
          ],
          CRI: [
            "CR",
            "COSTA RICA",
            "COSTA RICAN",
            "COSTARRIQUENHO",
            "COSTARRICENSE"
          ],
          DOM: [
            "DO",
            "DOMINICAN REPUBLIC",
            "REPÚBLICA DOMINICANA",
            "DOMINICAN",
            "DOMINICANO"
          ],
          CUB: ["CU", "CUBA", "CUBAN", "CUBANO", "CUBANA"],
          HTI: ["HT", "HAITI", "HAITIAN", "HAITIANO", "HAITIANA"],
          PRT: [
            "PT",
            "PORTUGAL",
            "PORTUGUESE",
            "PORTUGUÊS",
            "PORTUGUESA"
          ]
        };

        // Resolve um valor (já norm()-ed) para o ISO3 canônico, ou null.
        const resolveCountry = (value: string): string | null => {
          if (!value) return null;
          // Match exato pelo código ISO3 (chave do mapa)
          if (COUNTRY_TOKENS[value]) return value;
          for (const [iso, tokens] of Object.entries(COUNTRY_TOKENS)) {
            for (const tok of tokens) {
              const tokN = norm(tok);
              if (value === tokN) return iso;
              // tolerância: token contido no value (ex: "BRAZILIAN" em
              // "BRAZILIAN CITIZEN") ou vice-versa
              if (
                tokN.length >= 3 &&
                (value.includes(tokN) || tokN.includes(value))
              ) {
                return iso;
              }
            }
          }
          return null;
        };

        const isoFromPassport = resolveCountry(natNorm);
        const isoFromForm = resolveCountry(formNorm);

        // Se ambos resolveram pro MESMO país → equivalente
        const sameCountry =
          isoFromPassport !== null &&
          isoFromForm !== null &&
          isoFromPassport === isoFromForm;

        // Fallback: se um dos lados não resolveu, tenta substring match
        const substringMatch =
          natNorm === formNorm ||
          (natNorm.length >= 3 && formNorm.includes(natNorm)) ||
          (formNorm.length >= 3 && natNorm.includes(formNorm));

        const matches = sameCountry || substringMatch;

        if (!matches) {
          out.push({
            severity: "alta",
            tier: "tier1_filing",
            category: "divergencia",
            field: "Nationality (passaporte vs formulário)",
            form: personFormName,
            expected: `${check.nationality_seen} (passaporte)`,
            found: `${personOfSubject.country_of_citizenship} (formulário)`,
            source: `passport_check vs ${personFormName}.person.country_of_citizenship`,
            explanation:
              "Nacionalidade no passaporte não bate com country_of_citizenship no formulário.",
            rule_id: RULE_IDS.DOC_PASSPORT_NATIONALITY_VS_FORM,
            subject_id: sid
          });
        }
      }
      // Sex
      if (check.sex_seen && personOfSubject.gender) {
        const sexN = norm(check.sex_seen);
        const formGender = norm(personOfSubject.gender);
        const maleMatch = ["M", "MALE", "MASCULINO"].includes(formGender);
        const femaleMatch = ["F", "FEMALE", "FEMININO"].includes(formGender);
        const passportMale = sexN === "M";
        const passportFemale = sexN === "F";
        if ((passportMale && femaleMatch) || (passportFemale && maleMatch)) {
          out.push({
            severity: "critica",
            tier: "tier1_filing",
            category: "divergencia",
            field: "Sex (passaporte vs formulário)",
            form: personFormName,
            expected: `${check.sex_seen} (passaporte)`,
            found: `${personOfSubject.gender} (formulário)`,
            source: `passport_check vs ${personFormName}.person.gender`,
            explanation:
              "Sexo no passaporte diverge do formulário. Erro grosseiro — USCIS rejeita.",
            rule_id: RULE_IDS.DOC_PASSPORT_SEX_VS_FORM,
            subject_id: sid
          });
        }
      }
      // Issuing country (passport_country no form)
      if (check.issuing_country_seen && personOfSubject.passport_country) {
        const issN = norm(check.issuing_country_seen);
        const formN = norm(personOfSubject.passport_country);
        if (!issN.includes(formN) && !formN.includes(issN)) {
          out.push({
            severity: "alta",
            tier: "tier1_filing",
            category: "divergencia",
            field: "Passport Issuing Country (passaporte vs formulário)",
            form: personFormName,
            expected: `${check.issuing_country_seen} (passaporte)`,
            found: `${personOfSubject.passport_country} (formulário)`,
            source: `passport_check vs ${personFormName}.person.passport_country`,
            explanation:
              "País emissor do passaporte não bate com passport_country no formulário.",
            rule_id: RULE_IDS.DOC_PASSPORT_ISSUING_COUNTRY_VS_FORM,
            subject_id: sid
          });
        }
      }
      // Expiration date
      if (
        check.expiration_date_seen &&
        personOfSubject.passport_expiration_date
      ) {
        const expSeen = parseDate(check.expiration_date_seen);
        const expForm = parseDate(personOfSubject.passport_expiration_date);
        if (
          expSeen &&
          expForm &&
          Math.abs(expSeen.getTime() - expForm.getTime()) >
            1000 * 60 * 60 * 24 * 2
        ) {
          out.push({
            severity: "alta",
            tier: "tier1_filing",
            category: "divergencia",
            field: "Passport Expiration Date (passaporte vs formulário)",
            form: personFormName,
            expected: `${check.expiration_date_seen} (passaporte)`,
            found: `${personOfSubject.passport_expiration_date} (formulário)`,
            source: `passport_check vs ${personFormName}.person.passport_expiration_date`,
            explanation:
              "Data de expiração do passaporte no formulário não bate com a lida na imagem do documento.",
            rule_id: RULE_IDS.DOC_PASSPORT_EXPIRATION_VS_FORM,
            subject_id: sid
          });
        }
        // Passport expirado?
        if (expSeen && expSeen.getTime() < Date.now()) {
          out.push({
            severity: "alta",
            tier: "tier2_substantivo",
            category: "suporte_documental",
            field: "Passport — Expirado",
            form: "Identification Documents",
            found: `Expira em ${check.expiration_date_seen}`,
            explanation:
              "Passaporte expirado anexo. USCIS exige documento de identificação vigente.",
            recommendation:
              "Renovar passaporte (consulado brasileiro nos EUA) e anexar cópia atualizada.",
            rule_id: RULE_IDS.DOC_PASSPORT_EXPIRED,
            subject_id: sid
          });
        }
      }
    }

    // Quality issues reportados pelo extractor de visão.
    // Ajuste calibração rodada 3 (Flavia 30/04): só emitir quando o sistema
    // efetivamente identificou imagem de passaporte. Em casos onde o
    // splitter classifica páginas como "Identification Documents" mas elas
    // contêm só certidões/traduções (e não passaporte), as "quality_issues"
    // viram falso positivo ("tem passaporte" segundo o time, mas o passport
    // está em outro sub-PDF não detectado).
    if (
      check.has_passport_image &&
      check.quality_issues &&
      check.quality_issues.length > 0
    ) {
      out.push({
        severity: "media",
        tier: "tier1_filing",
        category: "suporte_documental",
        field: "Passport — Quality issues",
        form: "Identification Documents",
        explanation: check.quality_issues.join("; "),
        rule_id: RULE_IDS.DOC_PASSPORT_QUALITY_ISSUES,
        subject_id: sid
      });
    }
  }

  // ---- Proof of address holder mismatch ----
  if (proofOfAddress && proofOfAddress.found) {
    if (proofOfAddress.holder_match === "no_match") {
      out.push({
        severity: "alta",
        tier: "tier1_filing",
        category: "suporte_documental",
        field: "Comprovante de residência — Titular",
        form: "Proof of Address",
        found: proofOfAddress.holder_name ?? "(não identificado)",
        explanation:
          "Comprovante de residência não está no nome do principal nem de um dependente. Pode ser rejeitado pela USCIS.",
        recommendation:
          "Anexar comprovante em nome do principal ou de um dependente listado no I-914A.",
        rule_id: RULE_IDS.DOC_PROOF_OF_ADDRESS_HOLDER_MISMATCH,
        subject_id: principalSubject?.id ?? null
      });
    }
  }

  // ---- Witness analysis ----
  if (witnessAnalysis) {
    if (witnessAnalysis.statements_found === 0) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Witness Statements",
        explanation: "Nenhuma witness statement identificada. Witness statements fortalecem credibilidade.",
        rule_id: RULE_IDS.DOC_WITNESS_NOT_FOUND,
        subject_id: principalSubject?.id ?? null
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
          explanation: `Declaração de ${w.witness_name ?? "testemunha"} não está assinada.`,
          rule_id: RULE_IDS.DOC_WITNESS_NO_SIG,
          subject_id: principalSubject?.id ?? null
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
          recommendation: "Adicionar cláusula de penalty of perjury antes da assinatura.",
          rule_id: RULE_IDS.DOC_WITNESS_NO_PERJURY,
          subject_id: principalSubject?.id ?? null
        });
      }
      if (w.attests_specific_facts === false) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "credibilidade",
          field: `Witness Statement #${i + 1} — Conteúdo`,
          form: "Witness Statements",
          explanation: `Declaração de ${w.witness_name ?? "testemunha"} é vaga/genérica. Declarações eficazes atestam fatos concretos (datas, eventos, observações diretas).`,
          rule_id: RULE_IDS.DOC_WITNESS_VAGUE,
          subject_id: principalSubject?.id ?? null
        });
      }
      if (w.concerns && w.concerns.length > 0) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "suporte_documental",
          field: `Witness Statement #${i + 1} — Outros`,
          form: "Witness Statements",
          explanation: w.concerns.join("; "),
          rule_id: RULE_IDS.DOC_WITNESS_OTHER_CONCERN,
          subject_id: principalSubject?.id ?? null
        });
      }
    }
  }

  // ---- Medical analysis ----
  if (medicalAnalysis) {
    if (medicalAnalysis.evaluations_found === 0) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Medical/Psychological Records",
        explanation:
          "Nenhuma avaliação médica/psicológica encontrada. Ajuda a comprovar trauma e hardship.",
        rule_id: RULE_IDS.DOC_MEDICAL_NOT_FOUND,
        subject_id: principalSubject?.id ?? null
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
          explanation: `Avaliação feita por profissional sem credencial licenciada. USCIS dá menos peso.`,
          rule_id: RULE_IDS.DOC_MEDICAL_NOT_LICENSED,
          subject_id: principalSubject?.id ?? null
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
            "Avaliação sem diagnóstico formal em termos DSM-5 (PTSD, MDD, GAD, etc.). Reduz valor probatório.",
          rule_id: RULE_IDS.DOC_MEDICAL_NO_DSM5,
          subject_id: principalSubject?.id ?? null
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
            "Avaliação não conecta explicitamente o diagnóstico aos eventos de tráfico. Sem nexo, pouca força probatória.",
          rule_id: RULE_IDS.DOC_MEDICAL_NO_NEXUS,
          subject_id: principalSubject?.id ?? null
        });
      }
    }

    // Cruzamento NOVO: trafficking_type x DSM-5 fit
    if (story?.trafficking_type) {
      const allDx = (medicalAnalysis.items ?? [])
        .flatMap((m) => m.dsm5_diagnosis ?? [])
        .map((d) => d.toLowerCase())
        .join(" | ");
      const hasTraumaFit =
        /ptsd|acute stress|anxiety|gad|panic/i.test(allDx) ||
        (story.trafficking_type === "labor" && /mdd|depress/i.test(allDx) && /ptsd|anxiety|gad/i.test(allDx));
      // Heurística: sex => espera PTSD/Acute Stress; labor => sem PTSD/anxiety mas só MDD
      const sexNeedsPtsd =
        story.trafficking_type === "sex" && allDx && !/ptsd|acute stress/i.test(allDx);
      const laborOnlyMdd =
        story.trafficking_type === "labor" &&
        /mdd|depress/i.test(allDx) &&
        !/ptsd|anxiety|gad/i.test(allDx);
      if (sexNeedsPtsd || laborOnlyMdd) {
        out.push({
          severity: "media",
          tier: "tier2_substantivo",
          category: "suporte_documental",
          field: "Medical — diagnóstico DSM-5 não casa com tipo de tráfico",
          form: "Medical Records",
          explanation:
            (sexNeedsPtsd
              ? "Tipo de tráfico relatado como 'sex' mas avaliação médica não menciona PTSD ou Acute Stress — incomum."
              : "") +
            (laborOnlyMdd
              ? "Tipo de tráfico relatado como 'labor' mas avaliação médica menciona apenas MDD sem PTSD/anxiety — incomum."
              : ""),
          rule_id: RULE_IDS.DOC_MEDICAL_NO_TRAUMA_FIT,
          subject_id: principalSubject?.id ?? null
        });
      }
      // referência declarada para evitar lint warning
      void hasTraumaFit;
    }
  }

  // ---- Country analysis ----
  if (countryAnalysis) {
    if (countryAnalysis.relevant_to_hardship === false) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Relevância",
        explanation: "Material de country conditions não está claramente conectado ao hardship do cliente.",
        rule_id: RULE_IDS.DOC_COUNTRY_NOT_RELEVANT,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (countryAnalysis.addresses_re_trafficking_risk === false) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Re-trafficking",
        explanation: "Country conditions não aborda risco de re-trafficking se retornar.",
        rule_id: RULE_IDS.DOC_COUNTRY_NO_RETRAFFICKING,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (countryAnalysis.addresses_mental_health_care_access === false) {
      out.push({
        severity: "media",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Mental health",
        explanation:
          "Country conditions não aborda falta de acesso a mental health care no país de origem (importante pro hardship).",
        rule_id: RULE_IDS.DOC_COUNTRY_NO_MENTAL_HEALTH,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (countryAnalysis.concerns && countryAnalysis.concerns.length > 0) {
      out.push({
        severity: "baixa",
        tier: "tier2_substantivo",
        category: "suporte_documental",
        field: "Country Conditions — Observações",
        explanation: countryAnalysis.concerns.join("; "),
        rule_id: RULE_IDS.DOC_COUNTRY_OBSERVATIONS,
        subject_id: principalSubject?.id ?? null
      });
    }
    // Cruzamento NOVO: country errado
    if (countryAnalysis.country && story?.country_of_origin) {
      if (norm(countryAnalysis.country) !== norm(story.country_of_origin)) {
        out.push({
          severity: "critica",
          tier: "tier2_substantivo",
          category: "suporte_documental",
          field: "Country Conditions — País errado",
          expected: story.country_of_origin,
          found: countryAnalysis.country,
          explanation:
            "Análise de country conditions é sobre país diferente do declarado pelo cliente. Sinal forte de erro de filing.",
          rule_id: RULE_IDS.DOC_COUNTRY_WRONG_COUNTRY,
          subject_id: principalSubject?.id ?? null
        });
      }
    }
  }

  // ---- Translations ----
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
        explanation: "Documentos estrangeiros sem certified translation: " + filtered.join("; "),
        recommendation: "Anexar tradução completa em inglês + Certificate of Translation do tradutor.",
        rule_id: RULE_IDS.DOC_TRANSLATION_MISSING,
        subject_id: principalSubject?.id ?? null
      });
    }
    if (translations.concerns && translations.concerns.length > 0) {
      const relevantConcerns = translations.concerns.filter((c) => !/passport|passaporte/i.test(c));
      if (relevantConcerns.length > 0) {
        out.push({
          severity: "media",
          tier: "tier1_filing",
          category: "suporte_documental",
          field: "Certified Translations — Observações",
          explanation: relevantConcerns.join("; "),
          rule_id: RULE_IDS.DOC_TRANSLATION_OBSERVATIONS,
          subject_id: principalSubject?.id ?? null
        });
      }
    }
  }

  // ---- Q11 — Continuous Physical Presence (T-visa) ----
  if (i914?.entry?.travel_history && i914.entry.travel_history.length > 0) {
    const filingDate = parseDate(i914?.meta?.applicant_signature?.date_signed) ?? new Date();
    const events = i914.entry.travel_history
      .map((e) => ({
        date: parseDate(e.date),
        direction: e.direction ?? null,
        port: e.port ?? null
      }))
      .filter((e): e is { date: Date; direction: "entry" | "exit" | null; port: string | null } =>
        e.date !== null
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const exitsInWindow = events.filter(
      (e) => e.direction === "exit" && e.date.getTime() <= filingDate.getTime()
    );

    if (exitsInWindow.length > 0) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Continuous physical presence — saídas dos EUA",
        form: "I-914",
        explanation: `${exitsInWindow.length} saída(s) dos EUA detectada(s) em travel_history durante período de presença física requerida. T-visa exige que o nexo com tráfico esteja documentado em cada saída/retorno.`,
        recommendation:
          "Para cada saída, documentar motivo e como o nexo com o tráfico é mantido (ex: retorno forçado pelo traficante, viagem para depor em investigação).",
        rule_id: RULE_IDS.T_SUBST_CPP_BROKEN_RISK,
        subject_id: principalSubject?.id ?? null
      });
    }

    // Gap > 90 dias entre exit e próxima entry
    for (let i = 0; i < events.length - 1; i++) {
      const cur = events[i];
      const next = events[i + 1];
      if (cur.direction === "exit" && next.direction === "entry") {
        const gapDays = (next.date.getTime() - cur.date.getTime()) / (1000 * 60 * 60 * 24);
        if (gapDays > 90) {
          out.push({
            severity: "critica",
            tier: "tier2_substantivo",
            category: "elegibilidade",
            field: `CPP — gap de ${Math.round(gapDays)} dias fora dos EUA`,
            form: "I-914",
            explanation: `Saída em ${cur.date.toISOString().slice(0, 10)} e próxima entrada em ${next.date.toISOString().slice(0, 10)} — ${Math.round(gapDays)} dias fora dos EUA. Gap > 90 dias pode quebrar continuous physical presence (8 CFR 214.11(g)(2)).`,
            recommendation:
              "Documentar ausência. Considerar exception por humanitarian/public interest se nexo com trafficking estiver claro.",
            rule_id: RULE_IDS.T_SUBST_CPP_LONG_GAP,
            subject_id: principalSubject?.id ?? null
          });
        }
      }
    }
  }

  // ---- Q13 — TRIG / material support bar (T-visa) ----
  if (story && (story.traffickers_identified ?? []).length > 0) {
    const TRIG_INDICATORS_KEYWORDS = [
      "transport",
      "transporte",
      "drug",
      "weapons",
      "armas",
      "money",
      "dinheiro",
      "recruit",
      "recrut"
    ];
    const examplesText = [
      ...(story.cooperation_details ? [story.cooperation_details] : []),
      ...(story.force_examples ?? []),
      ...(story.fraud_examples ?? []),
      ...(story.coercion_examples ?? [])
    ]
      .join(" | ")
      .toLowerCase();
    const hasTrigIndicator = TRIG_INDICATORS_KEYWORDS.some((kw) => examplesText.includes(kw));
    const coercionAbsent = (story.coercion_examples ?? []).length === 0;

    if (coercionAbsent || hasTrigIndicator) {
      out.push({
        severity: "alta",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "TRIG / material support bar (8 USC 1182(a)(3)(B))",
        form: null,
        explanation: coercionAbsent
          ? "Caso menciona traficantes mas não documenta coerção (coercion_examples vazio) — risco de barra TRIG/material support, que se aplica quando a vítima foi forçada a apoiar grupo criminoso/terrorista. Reforçar narrativa de coerção forçada."
          : "Indicadores de TRIG (transporte, drogas, armas, dinheiro, recrutamento) presentes nos exemplos. Verificar se há documentação clara de coerção — sem ela, há risco de barra material support.",
        recommendation:
          "Documentar coerção (ameaças, violência, threats to family) que levou a qualquer ato que possa ser caracterizado como material support. Considerar duress waiver INA 212(d)(13).",
        rule_id: RULE_IDS.T_SUBST_TRIG_RISK,
        subject_id: principalSubject?.id ?? null
      });
    }
  }

  // ---- Q14 — Prior false claim to U.S. citizenship (INA 212(a)(6)(C)(ii)) ----
  if (story) {
    const prior = (story.prior_immigration_history ?? "").toLowerCase();
    const FALSE_CLAIM_RX =
      /claim(?:ed)?[\s\w]*citizenship|alega[çc][ãa]o de cidadania|claimed?\s+(?:to be\s+)?(?:u\.?s\.?|usc|american)|\bvoted\b|\bvoto\b|i-?9[\s,]*citizen|passport application|social security[\s\w]*citizen/i;
    const triggered =
      FALSE_CLAIM_RX.test(prior) ||
      (i914?.criminal_history_disclosed === true && /passport application|i-?9/.test(prior));
    if (triggered) {
      out.push({
        severity: "critica",
        tier: "tier2_substantivo",
        category: "elegibilidade",
        field: "Prior false claim to U.S. citizenship (INA 212(a)(6)(C)(ii))",
        form: null,
        explanation:
          "Possível false claim to U.S. citizenship detectada na história. INA 212(a)(6)(C)(ii) NÃO tem waiver — pode matar T/U/VAWA. Verificar com cliente urgentemente.",
        recommendation:
          "Confirmar com cliente se houve registro como votante, declaração de cidadania em I-9, social security ou passport application. Avaliar argumento de timely retraction ou idade < 18 ao fazer a declaração.",
        rule_id: RULE_IDS.T_SUBST_FALSE_CLAIM_RISK,
        subject_id: principalSubject?.id ?? null
      });
    }
  }

  // ---- Removal proceedings / prior applications ----
  if (i914?.removal_proceedings === true) {
    out.push({
      severity: "alta",
      tier: "tier3_estrategico",
      category: "estrategia",
      field: "Removal proceedings em curso",
      explanation:
        "Cliente em processo de remoção. Avaliar motion to terminate ou administrative closure junto com filing do T-visa.",
      rule_id: RULE_IDS.T_SUBST_REMOVAL_PROCEEDINGS,
      subject_id: principalSubject?.id ?? null
    });
  }

  if ((i914?.prior_applications ?? []).length > 0) {
    out.push({
      severity: "baixa",
      tier: "tier3_estrategico",
      category: "estrategia",
      field: "Aplicações anteriores (asylum, U, VAWA)",
      explanation:
        "Cliente tem histórico de aplicações imigratórias. Revisar consistência das narrativas anteriores com esta (USCIS tem acesso a todas).",
      rule_id: RULE_IDS.T_SUBST_PRIOR_APPLICATIONS,
      subject_id: principalSubject?.id ?? null
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Função pública — orquestração 4 níveis (com retro-compat)
// ---------------------------------------------------------------------------

export function applyGovisaRules(args: RulesInput | RulesInputV2): Finding[] {
  const out: Finding[] = [];

  const v2 = args as RulesInputV2;
  const {
    forms,
    story,
    witnessAnalysis,
    medicalAnalysis,
    countryAnalysis,
    leaQualification,
    translations,
    mode = "draft"
  } = v2;
  const isDraft = mode === "draft";

  // Subjects: passar explícito ou inferir do principal
  const subjects: Subject[] =
    v2.subjects && v2.subjects.length > 0 ? v2.subjects : inferSubjects(forms, story);

  // Passport checks: array novo ou fallback do antigo passportCheck
  const passportChecks: Array<{ subject_id: string | null; check: PassportSignatureCheck }> = [];
  if (v2.passportChecks && v2.passportChecks.length > 0) {
    passportChecks.push(...v2.passportChecks);
  } else if (v2.passportCheck) {
    const principalId = subjects.find((s) => s.role === "principal")?.id ?? null;
    passportChecks.push({ subject_id: principalId, check: v2.passportCheck });
  }

  // Cluster forms por sujeito
  const clusters = clusterFormsBySubject(forms, subjects);

  // Nível 1 — Per-form
  for (const f of forms) {
    const sid = getSubjectId(f);
    const subject =
      subjects.find((s) => s.id === sid) ??
      subjects.find((s) => s.role === "principal") ??
      null;
    out.push(...applyLevel1PerForm(f, subject, { isDraft, proofOfAddress: v2.proofOfAddress }));
  }

  // Nível 2 — Intra-cluster (cada cluster)
  for (const subject of subjects) {
    const cluster = clusters.get(subject.id) ?? [];
    if (cluster.length === 0) continue;
    out.push(...applyLevel2IntraCluster(subject, cluster));
  }

  // A-Number — consistência por sujeito (intra-form + entre-forms)
  out.push(...applyANumberConsistency(subjects, clusters));

  // Nível 3 — Cross-cluster (principal × cada dep)
  const principal = subjects.find((s) => s.role === "principal");
  if (principal) {
    const principalCluster = clusters.get(principal.id) ?? [];
    for (const dep of subjects.filter((s) => s.role === "dependent")) {
      const depCluster = clusters.get(dep.id) ?? [];
      if (depCluster.length === 0) continue;
      out.push(...applyLevel3CrossCluster(principal, principalCluster, dep, depCluster, forms));
    }
  }

  // Nível 4 — Globais
  out.push(
    ...applyLevel4Global({
      forms,
      story,
      passportChecks,
      witnessAnalysis,
      medicalAnalysis,
      countryAnalysis,
      leaQualification,
      translations,
      proofOfAddress: v2.proofOfAddress,
      subjects,
      isDraft
    })
  );

  // Dedup de findings repetidos pelo mesmo subject (calibração rodada 3,
  // Flavia 30/04). Se o mesmo subject_id recebe a MESMA rule_id em N forms
  // (ex: PHYSICAL_ADDR disparado em 5 forms do principal), agrupamos em um
  // único finding informando os forms onde a regra disparou. Reduz ruído
  // visual sem perder a informação.
  const DEDUP_RULES = new Set<string>([
    RULE_IDS.T_FILING_PHYSICAL_ADDR_OK_BY_PROOF,
    RULE_IDS.T_FILING_PHYSICAL_ADDR_NEEDS_PROOF,
    RULE_IDS.T_FILING_PHYSICAL_ADDR_MISMATCH_PROOF,
    RULE_IDS.T_FILING_PHYSICAL_ADDR_PROOF_MISSING,
    RULE_IDS.T_FILING_PHYSICAL_ADDR_NOT_GOVISA,
    RULE_IDS.T_FILING_SAFE_MAILING_NOT_GOVISA,
    RULE_IDS.T_FILING_IN_CARE_OF_MISSING,
    RULE_IDS.T_FILING_MAILING_NOT_GOVISA,
    RULE_IDS.T_FILING_INTERPRETER_SIG_MISSING,
    RULE_IDS.T_FILING_PREPARER_SIG_MISSING,
    RULE_IDS.T_FILING_PERSON_FAMILY_NAME_EMPTY,
    RULE_IDS.T_FILING_PERSON_GIVEN_NAME_EMPTY,
    RULE_IDS.T_FILING_PERSON_DOB_EMPTY,
    RULE_IDS.T_FILING_PERSON_BIRTH_COUNTRY_EMPTY,
    RULE_IDS.T_FILING_PERSON_PASSPORT_EMPTY,
    RULE_IDS.T_FILING_SSN_EMPTY
  ]);
  const seen = new Map<string, Finding>();
  const deduped: Finding[] = [];
  for (const f of out) {
    if (!f.rule_id || !DEDUP_RULES.has(f.rule_id) || !f.subject_id) {
      deduped.push(f);
      continue;
    }
    const key = `${f.rule_id}::${f.subject_id}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, f);
      deduped.push(f);
    } else {
      const prevForm = prev.form ?? "";
      const newForm = f.form ?? "";
      if (newForm && !prevForm.includes(newForm)) {
        prev.form = prevForm
          ? Array.from(new Set([...prevForm.split(", ").filter(Boolean), newForm])).join(", ")
          : newForm;
      }
    }
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Summarize (com by_subject opcional)
// ---------------------------------------------------------------------------

export function summarize(findings: Finding[]) {
  const by_subject: Record<string, number> = {};
  for (const f of findings) {
    const k = f.subject_id ?? "_unassigned";
    by_subject[k] = (by_subject[k] ?? 0) + 1;
  }
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
    },
    by_subject
  };
}
