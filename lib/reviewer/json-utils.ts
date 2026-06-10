// =============================================================================
// Utilitários de parsing de respostas LLM
// =============================================================================
//
// Problema observado em produção (reviews de 05/06): o modelo às vezes devolve
// o JSON embrulhado em code fence ```json ... ``` e, quando a resposta é
// truncada (stop_reason=max_tokens), a fence de fechamento nem chega a ser
// emitida. O strip antigo só tratava fence completa, então o JSON.parse
// recebia "```json {..." e falhava.

/**
 * Remove code fences (completas OU abertas/truncadas) e prosa em volta do
 * JSON. Idempotente para strings que já são JSON puro.
 */
export function stripJsonFences(txt: string): string {
  let t = (txt ?? "").trim();

  // 1. Fence completa: ```json ... ```
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    t = fenced[1].trim();
  } else {
    // 2. Fence aberta sem fechamento (resposta truncada por max_tokens)
    const open = t.match(/```(?:json)?\s*([\s\S]*)$/);
    if (open) t = open[1].trim();
  }

  // 3. Prosa antes do JSON ("Aqui está o resultado: {...}")
  if (!t.startsWith("{") && !t.startsWith("[")) {
    const iObj = t.indexOf("{");
    const iArr = t.indexOf("[");
    const start =
      iObj === -1 ? iArr : iArr === -1 ? iObj : Math.min(iObj, iArr);
    if (start > 0) t = t.slice(start);
  }

  // 4. Prosa depois do JSON ("{...} Espero ter ajudado")
  const lastClose = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (lastClose !== -1 && lastClose < t.length - 1) {
    t = t.slice(0, lastClose + 1);
  }

  return t.trim();
}
