// ---------------------------------------------------------------------------
// Registro de cancelamento de reviews em andamento (fix 10/06).
//
// Bug reportado pelo cliente (caso Anderson, 10/06): o botão "Cancelar" do
// front apenas abortava o fetch — o servidor continuava processando a review
// até o fim e SALVAVA o resultado. Cancelar precisa de fato interromper o
// pipeline no servidor.
//
// Estratégia dupla:
//  1. O front envia um `cancel_token` (uuid) junto com o upload. Ao cancelar,
//     chama POST /api/review/cancel com o token — caminho determinístico.
//  2. O route handler também encadeia `req.signal` (abort do fetch) no mesmo
//     AbortController, como redundância.
//
// O AbortSignal resultante é verificado pelo reviewProcess em cada fronteira
// de fase e antes de cada job LLM, interrompendo o trabalho restante.
// ---------------------------------------------------------------------------

const controllers = new Map<string, AbortController>();

/** Erro lançado quando uma review é cancelada pelo usuário. */
export class ReviewCancelledError extends Error {
  constructor() {
    super("Revisão cancelada pelo usuário.");
    this.name = "ReviewCancelledError";
  }
}

export function isReviewCancelled(err: unknown): boolean {
  return (
    err instanceof ReviewCancelledError ||
    (err as any)?.name === "ReviewCancelledError" ||
    (err as any)?.name === "AbortError"
  );
}

/** Registra um controller para o token. Retorna o controller. */
export function registerCancellable(token: string): AbortController {
  const ctrl = new AbortController();
  controllers.set(token, ctrl);
  return ctrl;
}

/** Remove o token do registro (fim do processamento, com ou sem erro). */
export function unregisterCancellable(token: string): void {
  controllers.delete(token);
}

/** Aborta a review associada ao token. Retorna true se havia review ativa. */
export function cancelByToken(token: string): boolean {
  const ctrl = controllers.get(token);
  if (!ctrl) return false;
  ctrl.abort(new ReviewCancelledError());
  controllers.delete(token);
  return true;
}

/** Lança ReviewCancelledError se o signal já tiver sido abortado. */
export function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new ReviewCancelledError();
}
