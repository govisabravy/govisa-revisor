// =============================================================================
// pdf-fit — garante que sub-PDFs enviados à API Anthropic caibam no request
// =============================================================================
//
// Problema observado em produção (pacote da Sulamita, 130MB / 233 páginas,
// reviews de 05/06): sub-PDFs de seções escaneadas (identification, witness)
// estouram o limite de request da API (~32MB) e as etapas
// checkCertifiedTranslations / checkPassportSignature falham sistematicamente
// com 413 request_too_large.
//
// Solução: antes de anexar o PDF ao request, se ele passa do limite,
// rasterizamos as páginas via pdftoppm (poppler-utils, presente na imagem
// Docker) em JPEG com resolução decrescente e remontamos um PDF compacto com
// pdf-lib. Isso preserva 100% do conteúdo visual (a checagem é feita por
// visão), só reduz a resolução de scans desnecessariamente pesados.
//
// Fallback (sem pdftoppm no host, ex: dev local sem poppler): truncagem
// progressiva de páginas até caber — degradado, mas nunca 413.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

// Limite de bytes BRUTOS do PDF. A API rejeita requests > ~32MB e o base64
// infla ~33%: 12MB brutos → ~16MB base64, com folga pro resto do request.
const DEFAULT_MAX_PDF_BYTES =
  Number(process.env.REVIEWER_MAX_PDF_MB ?? "12") * 1024 * 1024;

export function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

function mb(n: number): string {
  return (n / (1024 * 1024)).toFixed(1);
}

function runCmd(cmd: string, args: string[], timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timeout após ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

/**
 * Rasteriza todas as páginas do PDF em JPEG (via pdftoppm) e remonta um PDF
 * compacto com pdf-lib. Preserva o conteúdo visual; descarta camada de texto.
 *
 * scaleTo limita o MAIOR lado de cada página em pixels (independente do
 * tamanho da página em points) — saída previsível mesmo com scans atípicos.
 * 1600px num papel carta equivale a ~145dpi, suficiente pra ler passaporte,
 * MRZ, certidões e traduções por visão.
 */
export async function rasterizePdfBase64(
  base64: string,
  opts: { scaleTo: number; quality?: number }
): Promise<string> {
  const quality = opts.quality ?? 70;
  const dir = await mkdtemp(path.join(tmpdir(), "govisa-pdf-fit-"));
  try {
    const inPath = path.join(dir, "in.pdf");
    await writeFile(inPath, Buffer.from(base64, "base64"));
    await runCmd("pdftoppm", [
      "-jpeg",
      "-jpegopt",
      `quality=${quality}`,
      "-scale-to",
      String(opts.scaleTo),
      inPath,
      path.join(dir, "pg")
    ]);

    const files = (await readdir(dir))
      .filter((f) => /^pg-\d+\.jpg$/.test(f))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)\.jpg$/)?.[1] ?? 0);
        const nb = Number(b.match(/(\d+)\.jpg$/)?.[1] ?? 0);
        return na - nb;
      });
    if (files.length === 0) {
      throw new Error("pdftoppm não gerou nenhuma página");
    }

    const doc = await PDFDocument.create();
    for (const f of files) {
      const jpg = await doc.embedJpg(await readFile(path.join(dir, f)));
      const page = doc.addPage([jpg.width, jpg.height]);
      page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    }
    const bytes = await doc.save();
    return Buffer.from(bytes).toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Fallback sem poppler: corta páginas do fim até caber no limite.
 */
async function truncatePdfBase64(base64: string, maxBytes: number): Promise<string> {
  const srcBytes = Buffer.from(base64, "base64");
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (total <= 1) return base64;

  const ratio = maxBytes / srcBytes.byteLength;
  let n = Math.max(1, Math.floor(total * ratio * 0.9));

  while (n >= 1) {
    const doc = await PDFDocument.create();
    const idx = Array.from({ length: n }, (_, i) => i);
    const copied = await doc.copyPages(src, idx);
    copied.forEach((p) => doc.addPage(p));
    const out = Buffer.from(await doc.save()).toString("base64");
    if (base64Bytes(out) <= maxBytes || n === 1) {
      console.warn(
        `[pdf-fit] truncagem aplicada: ${total} → ${n} páginas (poppler indisponível?)`
      );
      return out;
    }
    n = Math.max(1, Math.floor(n / 2));
  }
  return base64;
}

/**
 * Garante que o PDF (base64) caiba no limite de request da Anthropic.
 * Se já cabe, devolve inalterado. Caso contrário rasteriza com resolução
 * decrescente; em último caso, trunca páginas.
 */
export async function fitPdfForClaude(
  base64: string,
  opts?: { maxBytes?: number; label?: string }
): Promise<string> {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_PDF_BYTES;
  const label = opts?.label ?? "pdf";
  const size = base64Bytes(base64);
  if (size <= maxBytes) return base64;

  let best = base64;
  let bestSize = size;
  let rasterOk = true;

  for (const scaleTo of [1600, 1200, 900]) {
    try {
      const out = await rasterizePdfBase64(base64, {
        scaleTo,
        quality: scaleTo <= 900 ? 60 : 70
      });
      const outSize = base64Bytes(out);
      console.log(
        `[pdf-fit] ${label}: rasterizado (scale-to ${scaleTo}px) — ${mb(size)}MB → ${mb(outSize)}MB`
      );
      if (outSize < bestSize) {
        best = out;
        bestSize = outSize;
      }
      if (outSize <= maxBytes) return out;
    } catch (err) {
      console.warn(
        `[pdf-fit] ${label}: rasterização scale-to ${scaleTo} falhou:`,
        String((err as any)?.message ?? err).slice(0, 200)
      );
      rasterOk = false;
      break;
    }
  }

  // Ainda acima do limite (ou poppler indisponível): trunca páginas do melhor
  // candidato que temos.
  try {
    const out = await truncatePdfBase64(best, maxBytes);
    if (!rasterOk) {
      console.warn(`[pdf-fit] ${label}: usando fallback de truncagem de páginas`);
    }
    return out;
  } catch (err) {
    console.error(
      `[pdf-fit] ${label}: fallback de truncagem falhou:`,
      String((err as any)?.message ?? err).slice(0, 200)
    );
    return best;
  }
}
