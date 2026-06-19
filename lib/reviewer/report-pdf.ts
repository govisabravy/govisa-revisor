import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import type { ReviewReport, Finding } from "@/lib/schemas/forms";

// ---------------------------------------------------------------------------
// Mapas de label/cor (hardcode aqui pra evitar refatorar ReviewReport.tsx).
// ---------------------------------------------------------------------------

const categoryLabel: Record<Finding["category"], string> = {
  divergencia: "Divergência",
  campo_suspeito: "Campo suspeito",
  campo_vazio: "Campo vazio",
  regra_govisa: "Regra Go Visa",
  elegibilidade: "Elegibilidade",
  credibilidade: "Credibilidade",
  suporte_documental: "Suporte documental",
  assinatura: "Assinatura",
  estrategia: "Estratégia",
  cross_narrative: "Análise sênior"
};

type SeverityKey = Finding["severity"];

const severityOrder: SeverityKey[] = ["critica", "alta", "media", "baixa"];

const severityLabel: Record<SeverityKey, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa"
};

// Cores conforme o brief: crítica #b91c1c, alta #c2410c, média #a16207, baixa #1d4ed8.
const severityColor: Record<SeverityKey, RGB> = {
  critica: hex("#b91c1c"),
  alta: hex("#c2410c"),
  media: hex("#a16207"),
  baixa: hex("#1d4ed8")
};

type TierKey = Finding["tier"];

const tierOrder: TierKey[] = ["tier1_filing", "tier2_substantivo", "tier3_estrategico"];

const tierLabel: Record<TierKey, { label: string; desc: string }> = {
  tier1_filing: {
    label: "Tier 1 — Filing",
    desc: "Bloqueia protocolo ou gera RFE imediato"
  },
  tier2_substantivo: {
    label: "Tier 2 — Substantivo",
    desc: "Afeta mérito e elegibilidade"
  },
  tier3_estrategico: {
    label: "Tier 3 — Estratégico",
    desc: "Revisão humana e estratégia"
  }
};

const NAVY = hex("#1e3a5f");
const SLATE_900 = hex("#0f172a");
const SLATE_700 = hex("#334155");
const SLATE_500 = hex("#64748b");
const SLATE_300 = hex("#cbd5e1");
const SLATE_50 = hex("#f8fafc");
const WHITE = rgb(1, 1, 1);

function hex(h: string): RGB {
  const s = h.replace("#", "");
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

// Versão clara (fundo de card) de uma cor de severidade.
function tint(c: RGB, amount = 0.92): RGB {
  return rgb(
    c.red + (1 - c.red) * amount,
    c.green + (1 - c.green) * amount,
    c.blue + (1 - c.blue) * amount
  );
}

// ---------------------------------------------------------------------------
// safeText — pdf-lib drawText estoura em char fora de WinAnsi/Latin-1.
// Acentos PT (á ã ç é ê í ó ô õ ú ...) já são Latin-1 → ok.
// ---------------------------------------------------------------------------

const REPLACEMENTS: Record<string, string> = {
  "—": "-", // — em dash
  "–": "-", // – en dash
  "‒": "-",
  "―": "-",
  "‘": "'", // ' aspas curva esq
  "’": "'", // ' aspas curva dir
  "‚": "'",
  "‛": "'",
  "“": '"', // " aspas dupla esq
  "”": '"', // " aspas dupla dir
  "„": '"',
  "«": '"',
  "»": '"',
  "…": "...", // … reticências
  "•": "-", // • bullet
  " ": " ", // nbsp
  " ": " ",
  "​": "", // zero-width space
  "−": "-", // − minus
  "­": "" // soft hyphen
};

export function safeText(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input);
  let out = "";
  for (const ch of s) {
    const repl = REPLACEMENTS[ch];
    if (repl !== undefined) {
      out += repl;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    // Latin-1 (WinAnsi cobre 0x20-0xFF, exceto alguns controles) → mantém.
    if (code >= 0x20 && code <= 0xff) {
      out += ch;
    } else if (code === 0x0a || code === 0x09) {
      out += " ";
    } else {
      out += "?";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

interface DrawCtx {
  doc: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  page: PDFPage;
  y: number;
  pageNum: number;
  clientName: string;
}

function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  font: PDFFont
): string[] {
  const safe = safeText(text);
  const rawLines = safe.split("\n");
  const lines: string[] = [];
  for (const raw of rawLines) {
    const words = raw.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // Palavra única maior que a largura: quebra por char.
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          current = chunk;
        } else {
          current = word;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawCompactHeader(ctx: DrawCtx) {
  const h = 26;
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_H - h,
    width: PAGE_W,
    height: h,
    color: NAVY
  });
  ctx.page.drawText(
    safeText(`${ctx.clientName} - pág. ${ctx.pageNum}`),
    {
      x: MARGIN,
      y: PAGE_H - h + 8,
      size: 9,
      font: ctx.fontBold,
      color: WHITE
    }
  );
  ctx.y = PAGE_H - h - 24;
}

function newPage(ctx: DrawCtx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pageNum += 1;
  ctx.y = PAGE_H - MARGIN;
  drawCompactHeader(ctx);
}

function ensureSpace(ctx: DrawCtx, h: number) {
  if (ctx.y - h < MARGIN) {
    newPage(ctx);
  }
}

function drawParagraph(
  ctx: DrawCtx,
  text: string,
  opts: {
    size?: number;
    font?: PDFFont;
    color?: RGB;
    indent?: number;
    maxWidth?: number;
    lineGap?: number;
  } = {}
) {
  const size = opts.size ?? 10;
  const font = opts.font ?? ctx.font;
  const color = opts.color ?? SLATE_700;
  const indent = opts.indent ?? 0;
  const lineGap = opts.lineGap ?? 3;
  const maxWidth = opts.maxWidth ?? CONTENT_W - indent;
  const lines = wrapText(text, maxWidth, size, font);
  const lineH = size + lineGap;
  for (const line of lines) {
    ensureSpace(ctx, lineH);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y - size,
      size,
      font,
      color
    });
    ctx.y -= lineH;
  }
}

function drawBadge(
  ctx: DrawCtx,
  x: number,
  text: string,
  bg: RGB,
  fg: RGB
): number {
  const size = 8;
  const padX = 5;
  const padY = 3;
  const label = safeText(text);
  const w = ctx.fontBold.widthOfTextAtSize(label, size) + padX * 2;
  const h = size + padY * 2;
  ctx.page.drawRectangle({
    x,
    y: ctx.y - h,
    width: w,
    height: h,
    color: bg,
    borderColor: bg,
    borderWidth: 0
  });
  ctx.page.drawText(label, {
    x: x + padX,
    y: ctx.y - h + padY + 1,
    size,
    font: ctx.fontBold,
    color: fg
  });
  return w;
}

// ---------------------------------------------------------------------------
// Slug / filename
// ---------------------------------------------------------------------------

export function slug(input: string): string {
  return String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function reportPdfFileName(report: ReviewReport, meta: any): string {
  const base = report?.client_name || String(meta?.id ?? "").slice(0, 8) || "revisao";
  const date = String(meta?.created_at ?? "").slice(0, 10) || "data";
  return `revisao-${slug(base) || "revisao"}-${date}.pdf`;
}

// ---------------------------------------------------------------------------
// Renderização principal
// ---------------------------------------------------------------------------

export async function renderReportPdf(
  report: ReviewReport,
  meta: any
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const clientName = report?.client_name || "Cliente não identificado";

  const ctx: DrawCtx = {
    doc,
    font,
    fontBold,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN,
    pageNum: 1,
    clientName
  };

  // --- Faixa navy de topo (página 1) ---
  const bandH = 60;
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_H - bandH,
    width: PAGE_W,
    height: bandH,
    color: NAVY
  });
  ctx.page.drawText(safeText("Go Visa Revisor"), {
    x: MARGIN,
    y: PAGE_H - 28,
    size: 18,
    font: fontBold,
    color: WHITE
  });
  ctx.page.drawText(safeText("Relatório de Revisão"), {
    x: MARGIN,
    y: PAGE_H - 48,
    size: 11,
    font,
    color: hex("#cbd5e1")
  });
  ctx.y = PAGE_H - bandH - 24;

  // --- Cabeçalho do cliente ---
  drawParagraph(ctx, clientName, { size: 16, font: fontBold, color: SLATE_900, lineGap: 4 });
  ctx.y -= 2;

  let dateStr = "";
  try {
    dateStr = new Date(meta?.created_at).toLocaleString("pt-BR");
  } catch {
    dateStr = String(meta?.created_at ?? "");
  }
  drawParagraph(ctx, dateStr, { size: 9, color: SLATE_500 });

  const formsList = Array.isArray(report?.forms_detected) ? report.forms_detected : [];
  drawParagraph(
    ctx,
    `Forms detectados: ${formsList.length ? formsList.join(", ") : "nenhum"}`,
    { size: 9, color: SLATE_500 }
  );
  ctx.y -= 8;

  // --- Sujeitos ---
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const subjects = Array.isArray(report?.subjects) ? report.subjects : [];
  if (subjects.length > 0) {
    drawParagraph(ctx, "Sujeitos", { size: 11, font: fontBold, color: SLATE_900 });
    ctx.y -= 2;
    for (const s of subjects) {
      const count = findings.filter((f) => f.subject_id === s.id).length;
      const roleLabel = s.role === "principal" ? "principal" : "dep";
      const rel = (s as any).relationship_to_principal
        ? ` (${(s as any).relationship_to_principal})`
        : "";
      const anum = (s as any).a_number ? ` · A# ${(s as any).a_number}` : "";
      const line = `${s.display_name} · ${roleLabel}${rel}${anum} · ${count} achado(s)`;
      drawParagraph(ctx, line, { size: 9, color: SLATE_700, indent: 8 });
    }
    ctx.y -= 8;
  }

  // --- Cards de contagem ---
  const summary = report?.summary ?? {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    by_tier: { tier1_filing: 0, tier2_substantivo: 0, tier3_estrategico: 0 }
  };

  // Linha 1: severidades
  drawCountCards(ctx, [
    { label: "Crítica", value: summary.critical ?? 0, color: severityColor.critica },
    { label: "Alta", value: summary.high ?? 0, color: severityColor.alta },
    { label: "Média", value: summary.medium ?? 0, color: severityColor.media },
    { label: "Baixa", value: summary.low ?? 0, color: severityColor.baixa }
  ]);
  ctx.y -= 8;
  // Linha 2: tiers
  drawCountCards(ctx, [
    {
      label: "Tier 1",
      value: summary.by_tier?.tier1_filing ?? 0,
      color: severityColor.critica
    },
    {
      label: "Tier 2",
      value: summary.by_tier?.tier2_substantivo ?? 0,
      color: severityColor.alta
    },
    {
      label: "Tier 3",
      value: summary.by_tier?.tier3_estrategico ?? 0,
      color: severityColor.baixa
    }
  ]);
  ctx.y -= 16;

  // --- Sem achados ---
  if ((summary.total ?? 0) === 0) {
    ensureSpace(ctx, 40);
    const h = 36;
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - h,
      width: CONTENT_W,
      height: h,
      color: hex("#f0fdf4"),
      borderColor: hex("#86efac"),
      borderWidth: 1
    });
    ctx.page.drawText(safeText("Sem achados"), {
      x: MARGIN + 12,
      y: ctx.y - 23,
      size: 12,
      font: fontBold,
      color: hex("#15803d")
    });
    ctx.y -= h + 8;
    return Buffer.from(await doc.save());
  }

  // --- Seções por tier ---
  for (const tier of tierOrder) {
    const tierFindings = findings.filter((f) => f.tier === tier);
    if (tierFindings.length === 0) continue;
    const info = tierLabel[tier];

    ctx.y -= 6;
    ensureSpace(ctx, 40);
    // Título do tier
    drawParagraph(ctx, info.label, { size: 14, font: fontBold, color: SLATE_900 });
    drawParagraph(ctx, `${info.desc} · ${tierFindings.length} achado(s)`, {
      size: 9,
      color: SLATE_500
    });
    ctx.y -= 4;

    for (const sev of severityOrder) {
      const group = tierFindings.filter((f) => f.severity === sev);
      if (group.length === 0) continue;
      ensureSpace(ctx, 18);
      drawParagraph(ctx, `${severityLabel[sev]} (${group.length})`, {
        size: 10,
        font: fontBold,
        color: SLATE_700
      });
      ctx.y -= 2;
      for (const f of group) {
        drawFindingCard(ctx, f);
        ctx.y -= 6;
      }
    }
  }

  return Buffer.from(await doc.save());
}

function drawCountCards(
  ctx: DrawCtx,
  cards: Array<{ label: string; value: number; color: RGB }>
) {
  const n = cards.length;
  const gap = 8;
  const cardW = (CONTENT_W - gap * (n - 1)) / n;
  const cardH = 44;
  ensureSpace(ctx, cardH);
  const top = ctx.y;
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + gap);
    ctx.page.drawRectangle({
      x,
      y: top - cardH,
      width: cardW,
      height: cardH,
      color: SLATE_50,
      borderColor: SLATE_300,
      borderWidth: 1
    });
    const valStr = String(c.value);
    const valW = ctx.fontBold.widthOfTextAtSize(valStr, 18);
    ctx.page.drawText(valStr, {
      x: x + (cardW - valW) / 2,
      y: top - 24,
      size: 18,
      font: ctx.fontBold,
      color: c.color
    });
    const lbl = safeText(c.label);
    const lblW = ctx.font.widthOfTextAtSize(lbl, 8);
    ctx.page.drawText(lbl, {
      x: x + (cardW - lblW) / 2,
      y: top - cardH + 8,
      size: 8,
      font: ctx.font,
      color: SLATE_500
    });
  });
  ctx.y = top - cardH;
}

function drawFindingCard(ctx: DrawCtx, f: Finding) {
  const accent = severityColor[f.severity];
  const bg = tint(accent, 0.92);
  const innerW = CONTENT_W - 24; // padding 12 cada lado

  // Pré-calcula a altura do card pra desenhar o fundo de uma vez.
  // Usamos uma estimativa via wrap; depois desenhamos o conteúdo dentro.
  const lines: Array<{ text: string; size: number; font: PDFFont; color: RGB; gap?: number }> = [];

  const fieldText = safeText(f.field || "");
  for (const l of wrapText(fieldText, innerW, 11, ctx.fontBold)) {
    lines.push({ text: l, size: 11, font: ctx.fontBold, color: SLATE_900, gap: 3 });
  }
  if (f.explanation) {
    for (const l of wrapText(f.explanation, innerW, 9, ctx.font)) {
      lines.push({ text: l, size: 9, font: ctx.font, color: SLATE_700, gap: 3 });
    }
  }
  if (f.expected) {
    lines.push({ text: "Esperado:", size: 8, font: ctx.fontBold, color: SLATE_500, gap: 2 });
    for (const l of wrapText(f.expected, innerW, 9, ctx.font)) {
      lines.push({ text: l, size: 9, font: ctx.font, color: SLATE_700, gap: 2 });
    }
  }
  if (f.found) {
    lines.push({ text: "Encontrado:", size: 8, font: ctx.fontBold, color: SLATE_500, gap: 2 });
    for (const l of wrapText(f.found, innerW, 9, ctx.font)) {
      lines.push({ text: l, size: 9, font: ctx.font, color: SLATE_700, gap: 2 });
    }
  }
  if (f.recommendation) {
    for (const l of wrapText(`Ação sugerida: ${f.recommendation}`, innerW, 9, ctx.font)) {
      lines.push({ text: l, size: 9, font: ctx.font, color: SLATE_700, gap: 2 });
    }
  }
  if (f.source) {
    for (const l of wrapText(`Fonte: ${f.source}`, innerW, 8, ctx.font)) {
      lines.push({ text: l, size: 8, font: ctx.font, color: SLATE_500, gap: 2 });
    }
  }

  const badgeRowH = 16;
  const padTop = 10;
  const padBottom = 10;
  const linesH = lines.reduce((acc, l) => acc + l.size + (l.gap ?? 3), 0);
  const cardH = padTop + badgeRowH + linesH + padBottom;

  const usableH = PAGE_H - MARGIN * 2 - 26; // -26 = faixa compacta de páginas 2+

  if (cardH <= usableH) {
    // Card cabe em uma página: garante que comece numa página com espaço.
    ensureSpace(ctx, cardH);
    drawFindingCardBody(ctx, f, lines, cardH, badgeRowH, padTop, accent, bg);
    return;
  }

  // Card maior que a página: quebra em fatias por página, cada fatia com seu
  // próprio fundo (evita conteúdo "flutuando" sem card).
  let idx = 0;
  let isFirst = true;
  while (idx < lines.length || isFirst) {
    ensureSpace(ctx, padTop + badgeRowH + 30);
    const top = ctx.y;
    const sliceLines: typeof lines = [];
    let sliceContentH = isFirst ? badgeRowH : 0;
    while (idx < lines.length) {
      const l = lines[idx];
      const lh = l.size + (l.gap ?? 3);
      if (padTop + sliceContentH + lh + padBottom > top - MARGIN) break;
      sliceLines.push(l);
      sliceContentH += lh;
      idx += 1;
    }
    const sliceH = padTop + sliceContentH + padBottom;
    drawFindingCardBody(
      ctx,
      f,
      sliceLines,
      sliceH,
      badgeRowH,
      padTop,
      accent,
      bg,
      isFirst
    );
    isFirst = false;
    if (idx >= lines.length) break;
  }
}

function drawFindingCardBody(
  ctx: DrawCtx,
  f: Finding,
  lines: Array<{ text: string; size: number; font: PDFFont; color: RGB; gap?: number }>,
  cardH: number,
  badgeRowH: number,
  padTop: number,
  accent: RGB,
  bg: RGB,
  withBadges = true
) {
  const top = ctx.y;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: top - cardH,
    width: CONTENT_W,
    height: cardH,
    color: bg,
    borderColor: tint(accent, 0.7),
    borderWidth: 1
  });
  ctx.page.drawRectangle({
    x: MARGIN,
    y: top - cardH,
    width: 4,
    height: cardH,
    color: accent
  });

  let cy = top - padTop;

  if (withBadges) {
    let bx = MARGIN + 12;
    const savedY = ctx.y;
    ctx.y = top - padTop;
    const catLabel = categoryLabel[f.category] ?? f.category;
    const wCat = drawBadge(ctx, bx, catLabel, accent, WHITE);
    bx += wCat + 6;
    if (f.form) {
      drawBadge(ctx, bx, f.form, WHITE, SLATE_700);
    }
    ctx.y = savedY;
    cy = top - padTop - badgeRowH;
  }

  for (const l of lines) {
    const lineH = l.size + (l.gap ?? 3);
    ctx.page.drawText(l.text, {
      x: MARGIN + 12,
      y: cy - l.size,
      size: l.size,
      font: l.font,
      color: l.color
    });
    cy -= lineH;
  }

  ctx.y = top - cardH;
}
