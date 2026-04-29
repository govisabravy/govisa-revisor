import { PDFDocument } from "pdf-lib";

export interface SubDocument {
  kind: string;
  title: string;
  startPage: number;
  endPage: number;
  base64: string;
  text: string;
  pageCount: number;
  subject_id?: string | null;
  holder_name?: string | null;
}

export interface PageRange {
  kind: string;
  title: string;
  startPage: number;
  endPage: number;
  subject_id?: string | null;
  holder_name?: string | null;
}

function isTocPage(pageText: string): boolean {
  if (/\bTable\s+of\s+Contents\b/i.test(pageText)) return true;
  const tocItems = (pageText.match(/^\s*\d+\.\s+(Form|Cover|Identification|General|Witness|Medical|Final)/gim) ?? []).length;
  return tocItems >= 4;
}

function isDividerPage(pageText: string): boolean {
  const trimmed = pageText.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 && trimmed.length < 120 && /[A-Z]/.test(trimmed);
}

function hasUscisFooterFor(pageText: string, formCode: string): boolean {
  const safe = formCode.replace("-", "-?");
  const re = new RegExp(
    `Form\\s+${safe}\\s+\\([^)]+\\)(?:\\s*\\n|\\s+)?.{0,200}Page\\s*\\d+\\s*of\\s*\\d+`,
    "is"
  );
  if (re.test(pageText)) return true;
  const re2 = new RegExp(`Form\\s+${safe}\\s+Edition|Form\\s+${safe}\\s+\\(Rev|${safe}\\s+OMB`, "i");
  if (re2.test(pageText) && /Page\s*\d+\s*of\s*\d+/i.test(pageText)) return true;
  return false;
}

function detectKindForPage(pageText: string): string | null {
  if (isTocPage(pageText)) return null;

  const isSupplementA =
    /Supplement\s*A\s+for\s+Family\s+Member/i.test(pageText) ||
    /Application\s+for\s+Family\s+Member\s+of\s+T-1/i.test(pageText) ||
    hasUscisFooterFor(pageText, "I-914A");
  const isSupplementB =
    /Supplement\s*B\s+Declaration\s+of\s+Law\s+Enforcement/i.test(pageText) ||
    /Declaration\s+of\s+Law\s+Enforcement\s+Officer/i.test(pageText) ||
    hasUscisFooterFor(pageText, "I-914B");
  const isI914Main =
    !isSupplementA && !isSupplementB && hasUscisFooterFor(pageText, "I-914");

  if (isSupplementA) return "I-914A";
  if (isSupplementB) return "I-914B";
  if (isI914Main) return "I-914";

  if (hasUscisFooterFor(pageText, "I-192")) return "I-192";
  if (hasUscisFooterFor(pageText, "I-765")) return "I-765";
  if (hasUscisFooterFor(pageText, "G-28")) return "G-28";

  if (/\bIdentification\s+Documents\b/i.test(pageText) && isDividerPage(pageText))
    return "identification";
  if (/\bGeneral\s+Country\s+Conditions\b/i.test(pageText) && isDividerPage(pageText))
    return "country_conditions";
  if (/\bWitness\s+Statements?\b/i.test(pageText) && isDividerPage(pageText))
    return "witness_statements";
  if (/\bMedical\s+and\s+Psychological\s+Records\b/i.test(pageText) && isDividerPage(pageText))
    return "medical_records";
  if (
    /\b(Declaration\s+of|Personal\s+Statement|Applicant\'?s?\s+Statement|My\s+name\s+is|Minha\s+história)\b/i.test(
      pageText
    )
  ) {
    return "story";
  }
  if (/\bFinal\s+Considerations?\b/i.test(pageText) && isDividerPage(pageText)) return "final";
  if (/\bcover\s+letter\b/i.test(pageText) && isDividerPage(pageText)) return "cover_letter";
  return null;
}

function looksLikeFormStart(pageText: string): boolean {
  return /Page\s*1\s*of\s*\d+/i.test(pageText) && /Form\s+[IG]-\d+/i.test(pageText);
}

export function detectSectionRanges(pages: string[]): PageRange[] {
  const FORM_KINDS = new Set(["I-914", "I-914A", "I-914B", "I-192", "I-765", "G-28"]);
  const perPage: Array<{ page: number; kind: string | null; isFormStart: boolean }> = [];

  for (let i = 0; i < pages.length; i++) {
    perPage.push({
      page: i + 1,
      kind: detectKindForPage(pages[i]),
      isFormStart: looksLikeFormStart(pages[i])
    });
  }

  const ranges: PageRange[] = [];
  let i = 0;
  while (i < perPage.length) {
    const cur = perPage[i];
    if (!cur.kind) {
      i++;
      continue;
    }
    const kind = cur.kind;
    let end = i;

    while (end + 1 < perPage.length) {
      const next = perPage[end + 1];
      if (next.kind === null) {
        end++;
        continue;
      }
      if (next.kind === kind && !(FORM_KINDS.has(kind) && next.isFormStart)) {
        end++;
        continue;
      }
      break;
    }

    while (end > i && perPage[end].kind === null) end--;

    ranges.push({
      kind,
      title: kind,
      startPage: cur.page,
      endPage: perPage[end].page
    });
    i = end + 1;
  }

  const merged: PageRange[] = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === r.kind && r.startPage - prev.endPage <= 2) {
      prev.endPage = r.endPage;
    } else {
      merged.push({ ...r });
    }
  }

  const DIVIDER_KINDS = new Set([
    "identification",
    "country_conditions",
    "witness_statements",
    "medical_records",
    "final",
    "cover_letter"
  ]);
  for (let idx = 0; idx < merged.length; idx++) {
    const cur = merged[idx];
    if (!DIVIDER_KINDS.has(cur.kind)) continue;
    const next = merged[idx + 1];
    const limit = next ? next.startPage - 1 : pages.length;
    cur.endPage = limit;
  }

  return merged;
}

export async function splitPdfByRange(
  buffer: Buffer,
  startPage: number,
  endPage: number
): Promise<string> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  const indexes: number[] = [];
  for (let p = startPage; p <= endPage; p++) indexes.push(p - 1);
  const copied = await doc.copyPages(src, indexes);
  copied.forEach((p) => doc.addPage(p));
  const bytes = await doc.save();
  return Buffer.from(bytes).toString("base64");
}

export async function splitPdfByRanges(
  buffer: Buffer,
  ranges: PageRange[],
  pageTexts: string[]
): Promise<SubDocument[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const results: SubDocument[] = [];

  for (const range of ranges) {
    const doc = await PDFDocument.create();
    const indexes: number[] = [];
    for (let p = range.startPage; p <= range.endPage; p++) {
      indexes.push(p - 1);
    }
    const copied = await doc.copyPages(src, indexes);
    copied.forEach((p) => doc.addPage(p));
    const bytes = await doc.save();
    const text = pageTexts
      .slice(range.startPage - 1, range.endPage)
      .join("\n\n")
      .trim();
    results.push({
      kind: range.kind,
      title: range.title,
      startPage: range.startPage,
      endPage: range.endPage,
      base64: Buffer.from(bytes).toString("base64"),
      text,
      pageCount: indexes.length,
      subject_id: range.subject_id ?? null,
      holder_name: range.holder_name ?? null
    });
  }

  return results;
}
