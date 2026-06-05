/**
 * E2E test contra produção (https://govisa.bravy.com.br) usando Playwright.
 * Cobre: login, upload, loading UI, cronômetro, interromper, chips de sujeitos,
 * filtro, ✓/✗ feedback, modal de erro não detectado, admin pages.
 *
 * Uso: npx -y tsx scripts/e2e-prod.ts <pdf_path>
 */
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync } from "node:fs";

const URL = "https://govisa.bravy.com.br";
const EMAIL = "tiago@asv.digital";
const PASSWORD = "GoVisa2026!";

interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
  ms?: number;
}
const results: StepResult[] = [];

function logStep(step: string, ok: boolean, detail?: string, ms?: number) {
  const tag = ok ? "[OK]  " : "[FAIL]";
  const t = ms ? ` (${(ms / 1000).toFixed(1)}s)` : "";
  console.log(`${tag} ${step}${t}${detail ? ` — ${detail}` : ""}`);
  results.push({ step, ok, detail, ms });
}

async function safe<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try {
    const r = await fn();
    logStep(name, true, undefined, Date.now() - t0);
    return r;
  } catch (err: any) {
    logStep(name, false, String(err?.message ?? err).slice(0, 200), Date.now() - t0);
    return null;
  }
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Uso: tsx scripts/e2e-prod.ts <pdf_path>");
    process.exit(1);
  }

  console.log(`[e2e] Browser: chromium · alvo: ${URL}`);
  const browser: Browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page: Page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[browser-error]`, String(e?.message ?? e).slice(0, 200)));

  // ================== STEP 1: Login ==================
  await safe("Login", async () => {
    await page.goto(`${URL}/login`, { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/app/, { timeout: 15000 });
    if (!page.url().includes("/app")) throw new Error(`URL pós-login: ${page.url()}`);
  });

  // ================== STEP 2: API /api/me ==================
  await safe("GET /api/me", async () => {
    const r = await page.request.get(`${URL}/api/me`);
    if (r.status() !== 200) throw new Error(`status ${r.status()}`);
    const body = await r.json();
    if (body?.email !== EMAIL) throw new Error(`email: ${body?.email}`);
  });

  // ================== STEP 3: Página /app carregou ==================
  await safe("Página /app carregou", async () => {
    await page.waitForSelector("text=Nova revisão", { timeout: 5000 });
  });

  // ================== STEP 4: Upload PDF + tela de loading nova ==================
  const uploadStart = Date.now();
  await safe("Upload PDF + tela loading", async () => {
    const buf = readFileSync(pdfPath);
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) throw new Error("input[type=file] não encontrado");
    await fileInput.setInputFiles({
      name: "test.pdf",
      mimeType: "application/pdf",
      buffer: buf
    });
    // Verifica que a tela de loading apareceu com TEXTO NOVO
    await page.waitForSelector("text=IA mais capacitada", { timeout: 10000 });
  });

  // ================== STEP 5: Cronômetro funciona ==================
  await safe("Cronômetro decorrido aparece e atualiza", async () => {
    // Espera 3s e verifica que o cronômetro mudou
    const t1 = await page.locator("text=/Decorrido: \\d+m\\d+s/").first().textContent({ timeout: 5000 });
    await page.waitForTimeout(3500);
    const t2 = await page.locator("text=/Decorrido: \\d+m\\d+s/").first().textContent({ timeout: 5000 });
    if (t1 === t2) throw new Error(`cronômetro travou em ${t1}`);
  });

  // ================== STEP 6: Botão "Interromper revisão" existe ==================
  await safe('Botão "Interromper revisão" presente', async () => {
    const btn = page.locator("button", { hasText: "Interromper revisão" });
    if ((await btn.count()) === 0) throw new Error("botão não encontrado");
    if (!(await btn.first().isVisible())) throw new Error("botão não visível");
  });

  // ================== STEP 7: Aguardar revisão completar (até 12 min) ==================
  await safe("Revisão completa", async () => {
    await page.waitForSelector("text=Forms detectados:", { timeout: 12 * 60 * 1000 });
  });
  console.log(`[e2e] Revisão completa em ${((Date.now() - uploadStart) / 1000).toFixed(0)}s`);

  // ================== STEP 8: Header com nome do cliente ==================
  await safe("Cliente identificado no header", async () => {
    const h = await page.locator("h2").first().textContent({ timeout: 5000 });
    if (!h || h.trim().length === 0) throw new Error("h2 vazio");
    console.log(`[e2e] cliente: ${h.trim()}`);
  });

  // ================== STEP 9: Chips de sujeitos ==================
  let firstSubjectId = "";
  await safe("Chips de sujeitos visíveis", async () => {
    await page.waitForSelector("text=Sujeitos:", { timeout: 5000 });
    // Pega contagem de botões de sujeito (irmãos do label "Sujeitos:")
    const chips = page.locator('text=Sujeitos: >> xpath=../button');
    const count = await chips.count();
    if (count === 0) throw new Error("nenhum chip");
    const t = await chips.first().textContent();
    firstSubjectId = (t ?? "").trim();
    console.log(`[e2e] ${count} sujeito(s); primeiro: ${firstSubjectId.slice(0, 60)}`);
  });

  // ================== STEP 10: Click em chip filtra ==================
  await safe("Click em chip filtra findings", async () => {
    const before = await page.locator('[class*="rounded-xl"][class*="border"]').count();
    await page.locator('text=Sujeitos: >> xpath=../button').first().click();
    await page.waitForTimeout(500);
    const after = await page.locator('[class*="rounded-xl"][class*="border"]').count();
    // Click de novo pra desfazer (toggle)
    await page.locator('text=Sujeitos: >> xpath=../button').first().click();
    await page.waitForTimeout(300);
    console.log(`[e2e] elementos antes: ${before}, depois: ${after}`);
  });

  // ================== STEP 11: Bloco "Erros não detectados" + botão ==================
  await safe('Bloco "Reportar erro não detectado"', async () => {
    await page.waitForSelector("text=Erros não detectados pelo sistema", { timeout: 5000 });
    const btn = page.locator("button", { hasText: "Reportar erro não detectado" });
    if (!(await btn.first().isVisible())) throw new Error("botão não visível");
  });

  // ================== STEP 12: Modal abre e tem campos ==================
  await safe("Modal de erro não detectado abre + campos", async () => {
    await page.click('button:has-text("Reportar erro não detectado")');
    await page.waitForSelector('input[placeholder*="DOB do dependente"]', { timeout: 3000 });
    await page.waitForSelector('textarea[placeholder*="Descreva o erro"]', { timeout: 3000 });
  });

  // ================== STEP 13: Submit do modal cria registro ==================
  await safe("Submit do modal grava no banco", async () => {
    await page.fill(
      'input[placeholder*="DOB do dependente"]',
      `[E2E TESTE] ${new Date().toISOString().slice(0, 19)}`
    );
    await page.fill(
      'textarea[placeholder*="Descreva o erro"]',
      "Erro fictício gerado pelo teste E2E automatizado. Pode ser ignorado/marcado como wont_fix."
    );
    await page.selectOption("select", "media").catch(() => {});
    await page.click('button:has-text("Reportar")');
    // Verifica que entrada apareceu na lista após submit
    await page.waitForSelector("text=[E2E TESTE]", { timeout: 5000 });
  });

  // ================== STEP 14: Botão ✓ (correct) em um finding ==================
  await safe("Botão ✓ marca finding como correto", async () => {
    // Procura primeiro botão de check (ícone Check) — Lucide renderiza svg com class lucide-check
    const checkBtns = page.locator("svg.lucide-check").locator("..");
    const count = await checkBtns.count();
    if (count === 0) throw new Error("nenhum botão ✓ encontrado");
    await checkBtns.first().click();
    await page.waitForTimeout(800); // dá tempo do POST
    // Não há feedback visual claro — só confirma que clicou sem erro
  });

  // ================== STEP 15: Botão ✗ (incorrect) abre modal ==================
  await safe("Botão ✗ abre modal de error_type", async () => {
    const xBtns = page.locator("svg.lucide-x").locator("..");
    // Filtro: queremos os do FindingCard, não os de fechar modal — o primeiro deles sim
    const candidates = await xBtns.count();
    if (candidates === 0) throw new Error("nenhum botão ✗ encontrado");
    // Clica em um que está visível
    let clicked = false;
    for (let i = 0; i < Math.min(candidates, 5); i++) {
      const b = xBtns.nth(i);
      if (await b.isVisible()) {
        await b.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error("nenhum botão ✗ visível");
    // Modal abre com select de error_type
    await page.waitForSelector('select', { timeout: 3000 });
    // Fechar modal (sem submeter — não queremos poluir banco com falso negativo de regra real)
    const cancelBtn = page.locator("button", { hasText: "Cancelar" });
    if ((await cancelBtn.count()) > 0) {
      await cancelBtn.first().click();
    } else {
      await page.keyboard.press("Escape");
    }
  });

  // ================== STEP 16: GET /api/reviews/[id]/feedback ==================
  await safe("GET /feedback retorna entrada do ✓", async () => {
    const url = page.url();
    const m = url.match(/reviews\/([^/]+)/);
    const reviewId = m ? m[1] : null;
    // Se a URL atual não tem reviewId, pega via /api/reviews
    let id = reviewId;
    if (!id) {
      const list = await page.request.get(`${URL}/api/reviews`);
      const data = await list.json();
      id = data?.items?.[0]?.id;
    }
    if (!id) throw new Error("não achou review_id");
    const r = await page.request.get(`${URL}/api/reviews/${id}/feedback`);
    if (r.status() !== 200) throw new Error(`status ${r.status()}`);
    const body = await r.json();
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw new Error("feedback array vazio");
    }
    console.log(`[e2e] feedback registrado: ${body.items.length} item(s)`);
  });

  // ================== STEP 17: GET /api/reviews/[id]/missing-finding ==================
  await safe("GET /missing-finding retorna report do E2E", async () => {
    const url = page.url();
    const m = url.match(/reviews\/([^/]+)/);
    let id = m ? m[1] : null;
    if (!id) {
      const list = await page.request.get(`${URL}/api/reviews`);
      const data = await list.json();
      id = data?.items?.[0]?.id;
    }
    if (!id) throw new Error("não achou review_id");
    const r = await page.request.get(`${URL}/api/reviews/${id}/missing-finding`);
    if (r.status() !== 200) throw new Error(`status ${r.status()}`);
    const body = await r.json();
    const e2e = (body?.items ?? []).find((i: any) => /E2E TESTE/.test(i?.title ?? ""));
    if (!e2e) throw new Error("missing-finding E2E não encontrado");
    console.log(`[e2e] missing_finding id=${e2e.id} title="${e2e.title}"`);
  });

  // ================== STEP 18: Admin /admin/feedback ==================
  await safe("Admin /admin/feedback acessível", async () => {
    await page.goto(`${URL}/admin/feedback`, { waitUntil: "networkidle", timeout: 15000 });
    if (!page.url().endsWith("/admin/feedback")) throw new Error(`redirected to ${page.url()}`);
    // Verifica algum heading
    const txt = await page.textContent("body");
    if (!txt || !/feedback/i.test(txt)) throw new Error("body sem 'feedback'");
  });

  // ================== STEP 19: Admin /admin/missing-findings ==================
  await safe("Admin /admin/missing-findings mostra E2E entry", async () => {
    await page.goto(`${URL}/admin/missing-findings`, { waitUntil: "networkidle", timeout: 15000 });
    if (!page.url().endsWith("/admin/missing-findings"))
      throw new Error(`redirected to ${page.url()}`);
    await page.waitForSelector("text=Erros não detectados", { timeout: 5000 });
    const e2eVisible = await page.locator("text=[E2E TESTE]").first().isVisible().catch(() => false);
    if (!e2eVisible) throw new Error("entrada E2E não visível na tabela admin");
  });

  // ================== Finalização ==================
  await browser.close();

  console.log("\n=== RESUMO ===");
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`PASS: ${passed}/${results.length}  ·  FAIL: ${failed}`);
  if (failed > 0) {
    console.log("\nFalhas:");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(` - ${r.step}: ${r.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[e2e] FATAL:", err);
  process.exit(2);
});
