# Eval Harness — Gabarito de Casos Reais

Esta pasta contém PDFs reais de processos USCIS gabaritados pela Go Visa, usados pra validar regressão do revisor.

## Como criar um novo gabarito

1. Crie pasta `fixtures/NN-nome-tipo/` (ex: `06-maria-uvisa/`)
2. Coloque `case.pdf` (PDF real do processo)
3. Crie `case.json` com metadata
4. Crie `expected.json` listando:
   - `must_emit`: findings que o sistema DEVE encontrar (com `rule_id` e opcionalmente `subject_id`/`severity_min`)
   - `must_not_emit`: findings que NÃO devem aparecer (falsos positivos conhecidos)

### Exemplo `case.json`

```json
{
  "id": "01-cloves-tvisa",
  "title": "Processo Cloves Pereira",
  "case_type": "t_visa",
  "mode": "draft",
  "client_name_expected": "CLOVES DA SILVA",
  "subjects_expected": [
    { "id": "principal", "display_name": "CLOVES DA SILVA", "role": "principal" }
  ],
  "notes": "Caso real reportado pela Flavia em 28/04/2026",
  "drive_link": "https://drive.google.com/..."
}
```

Campos suportados em `case_type`: `t_visa` | `vawa` | `u_visa`.
Campos suportados em `mode`: `draft` | `final`.

### Exemplo `expected.json`

```json
{
  "must_emit": [
    {
      "rule_id": "DOC_WITNESS_NOT_FOUND",
      "subject_id": null,
      "severity_min": "alta",
      "notes": "Sem testemunhas — Flavia confirmou em 28/04"
    },
    {
      "rule_id": "DOC_MEDICAL_NOT_FOUND",
      "severity_min": "alta"
    }
  ],
  "must_not_emit": [
    {
      "rule_id": "T_CONS_NAME_FORMS_DIVERGE",
      "subject_id": "principal",
      "field_contains": "Family Name",
      "notes": "Falso positivo brasileiro — DA SILVA vs PEREIRA DA SILVA"
    }
  ]
}
```

Campos de `ExpectedFinding`:

- `rule_id` (obrigatório): o `rule_id` exato do finding (ver `lib/reviewer/rule_ids.ts`).
- `subject_id` (opcional): id do sujeito (`principal`, `dep_1`, etc). Use `null` para findings globais (sem sujeito). Omita pra ignorar a checagem.
- `severity_min` (opcional): severidade mínima aceita (`baixa` | `media` | `alta` | `critica`).
- `field_contains` (opcional): substring que deve aparecer no campo `field` do finding.
- `notes` (opcional): comentário humano — não afeta a comparação.

## Como rodar

```bash
source scripts/load-env.sh
npx tsx scripts/eval-harness.ts
```

Saída: console com status por caso + sumário agregado. Detalhes completos em `/tmp/govisa-eval/eval-<timestamp>.json`.

**Critério de pass**: `recall >= 85%` E `violations = 0` em TODOS os casos. Exit code 1 se algum caso falhar — usável em CI.

## Lista de rule_ids disponíveis

Ver `lib/reviewer/rule_ids.ts`.

## Casos atuais

| ID | Tipo  | Cliente                       | Notas |
|----|-------|-------------------------------|-------|
| 01 | T-visa| (preencher quando adicionar) |       |
| 02 | U-visa| (preencher)                  |       |
| 03 | U-visa| (preencher)                  |       |
| 04 | VAWA  | (preencher)                  |       |
| 05 | VAWA  | (preencher)                  |       |
