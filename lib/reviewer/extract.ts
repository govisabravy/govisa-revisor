import pdf from "pdf-parse";

export interface ExtractedPdf {
  fullText: string;
  numPages: number;
  pages: string[];
  info: Record<string, unknown>;
}

export async function extractPdf(buffer: Buffer): Promise<ExtractedPdf> {
  const pages: string[] = [];

  const result = await pdf(buffer, {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent();
      const text = content.items.map((it: any) => it.str).join(" ");
      pages.push(text);
      return text;
    }
  });

  return {
    fullText: result.text,
    numPages: result.numpages,
    pages,
    info: (result.info as unknown as Record<string, unknown>) ?? {}
  };
}

export function findPageOfSection(
  pages: string[],
  patterns: RegExp[]
): { startPage: number; endPage: number } | null {
  let start = -1;
  for (let i = 0; i < pages.length; i++) {
    if (patterns.some((p) => p.test(pages[i]))) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;

  const nextSectionPatterns = [
    /\bGeneral\s+Country\s+Conditions\b/i,
    /\bWitness\s+Statements?\b/i,
    /\bMedical\s+and\s+Psychological\s+Records\b/i,
    /\bFinal\s+Considerations?\b/i,
    /\bCover\s+Letter\b/i
  ];

  let end = pages.length;
  for (let i = start; i < pages.length; i++) {
    if (nextSectionPatterns.some((p) => p.test(pages[i]))) {
      end = i;
      break;
    }
  }
  return { startPage: start, endPage: end };
}
