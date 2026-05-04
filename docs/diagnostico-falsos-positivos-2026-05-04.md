# Diagnóstico falsos positivos — Revisor jurídico

Data: 2026-05-04
Base: 110 marcações `verdict='incorrect'` da Flávia (govisa-data/_data/auth.db, tabela `finding_feedback`).
Cobertura deste documento: ~80 das 110 marcações (regras com 3+ ocorrências).

---

## #1 — T_FILING_PHYSICAL_ADDR_NEEDS_PROOF (29 marcações, 26%)

**Notas da Flávia:**
- "Physical Address não é no endereço da Go Visa, é no endereço do cliente. Salvo exceções, fica em branco."
- "tem comprovante de residencia"

**Causa raiz dupla:**

1. **Premissa invertida** em `rules.ts:370-428`: a regra parte de "Physical Address deve ser Go Visa, com fallback se houver comprovante". A premissa correta da Go Visa é o oposto: Physical Address é o do cliente; só vai pra Go Visa em exceções.
2. **Mapper de subdocs falhando**: em 4 dos 5 reviews afetados, `proof_of_address = null`. O `mapDocumentStructure` (claude.ts) classificou comprovantes de residência como `identification – Additional ID documents` ou `other`, nunca como `proof_of_address`.

**Ação:**
- Reescrever regra: validar que `physical_address` bate com `proof_of_address` quando houver. Não cobrar Go Visa.
- Reforçar prompt do mapper com exemplos explícitos de comprovante (utility bill, lease, bank statement, IRS letter, voter card).
- Severidade do finding: baixar de "baixa" pra "informativa" enquanto detecção do comprovante não estiver estável.

---

## #2 — SENIOR_COVER_LETTER_OUTDATED (7 marcações)

**Notas:** apenas "errado" / "Tem os dois passaportes no dossie".

**Diagnóstico:** o LLM "sênior" (`senior.ts:278`) aplica esse `rule_id` a achados que não têm relação com cover letter — inversão A-Number/SSN, family_name incompleto, edition date G-28 obsoleta, 4 endereços diferentes. Findings em si são reais, mas o **rótulo está errado**.

**Ação:**
- Adicionar `SENIOR_*` ids específicos: NAME_INCONSISTENCY, ANUMBER_SSN_SWAPPED, ADDRESS_FRAGMENTED, EDITION_OBSOLETE.
- Validação pós-LLM: se `rule_id = SENIOR_COVER_LETTER_OUTDATED` mas o `field` não menciona cover_letter, reclassificar.
- Mostrar conteúdo do finding (não rótulo) na UI da Flávia.

---

## #3 — DOC_EDITION_OUTDATED (11 marcações, todas G-28)

**Notas:** "A Edition date está correta conforme o site da USCIS." (5x diferentes reviews)

**Diagnóstico:** lista hardcoded `CURRENT_USCIS_EDITIONS` em `rules.ts:38-49` aceita só `01/19/24` e `05/05/22` para G-28. Threshold `EDITION_MIN_ACCEPT_YEAR = 24` joga tudo anterior a 2024 como outdated. Edição **09/17/18** continua aceita pela USCIS segundo a Flávia.

**Ação:**
- Validar com a Flávia/USCIS as edições G-28 efetivamente aceitas hoje e expandir a lista.
- Reduzir severidade pra "informativa" enquanto a lista não estiver auditada.

---

## #4 — T_DEP_I914A_NO_EVIDENCE (11 marcações)

**Notas:**
- "Tem certidão" / "Tem evidência" (sistema não detectou docs anexos)
- "Não tem certidão de nascimento mas tem passaporte" (passaporte basta como evidência)
- "Não é obrigatório certidão de nascimento dos filhos. Consta certidão de Casamento"

**Diagnóstico:** mesma causa raiz do #1 — mapper de subdocs absorve certidões/passaportes em `identification` sem decompor por dependente. A regra exige certidão de nascimento mesmo quando o dossier traz passaporte ou certidão de casamento (que segundo a Flávia substituem).

**Ação:**
- Aceitar passaporte do dependente como evidência válida (cruzar com `subjects[i].passport_number` extraído).
- Aceitar certidão de casamento do principal+dep como evidência da relação familiar.
- Refinar mapper pra emitir múltiplos subdocs `identification` separados por subject_id (já tem suporte parcial em claude.ts:807-810).

---

## #5 — T_FILING_SSN_EMPTY (6 marcações)

**Nota crítica:** "Esse campo não existe nesse form."

**Diagnóstico:** regra rodando em forms onde não há campo SSN (provável: I-914A do dependente). Bug de aplicabilidade.

**Ação:**
- Restringir regra a forms que têm SSN: I-914 (principal), I-765, I-918, I-360. Excluir I-914A/I-918A.

---

## #6 — DOC_PASSPORT_BIRTH_PLACE_VS_FORM (4 marcações)

**Nota:** "Está correto, no form os campos são separados. Cidade, Estado e país."

**Diagnóstico:** regra compara `birth_place` do passaporte (string única tipo "RIO DE JANEIRO, RJ, BRAZIL") com campos separados do form (cidade + estado + país) usando comparação textual.

**Ação:**
- Concatenar cidade+estado+país do form antes de comparar, normalizando ordem e separadores.
- Tolerar omissão de UF/state (passaporte brasileiro às vezes só traz cidade+país).

---

## #7 — DOC_PASSPORT_QUALITY_ISSUES (4 marcações)

**Nota:** "tem passaporte"

**Diagnóstico:** mesma raiz do #1/#4 — mapper não está identificando o subdoc do passaporte do sujeito apropriado, regra dispara como se faltasse ou estivesse ilegível.

**Ação:** ver #1.

---

## #8 — T_CONS_NAME_FORMS_DIVERGE (4 marcações, sem notas)

**Diagnóstico:** divergência de nomes entre forms. `namesPlausiblyEqual` (rules.ts:134-147) trata subset, mas falha em ordem trocada de nomes compostos brasileiros (ex: "PEREIRA DA SILVA" vs "DA SILVA PEREIRA") ou separação de partícula ("DA"/"DE"/"DOS").

**Ação:**
- Tokenizar e comparar como conjuntos (já faz), mas ignorar partículas conectoras na comparação.
- Adicionar telemetria: registrar exatamente quais tokens divergiram pra calibrar.

---

## #9 — T_FILING_PERSON_PASSPORT_EMPTY (4 marcações)

**Nota:** "Nao tem campo."

**Diagnóstico:** mesmo bug do #5 — regra rodando em form que não tem campo de passaporte.

**Ação:** restringir a forms que têm campo passport_number: I-914, I-918, I-360, I-192, I-765, I-914A, I-918A.

---

## #10 — T_FILING_I765_NAME_DIVERGES (3 marcações)

**Nota:** "O I-914 do principal está confrontando com o I-765 de dependente. Os dependentes têm I-765 e G-28 próprios."

**Diagnóstico crítico:** regra compara I-914 do principal contra I-765 dos dependentes. O correto é: cada I-765 deve ser comparado com o I-914A do dependente correspondente (ou com I-914 só se for I-765 do principal). Bug de mapeamento de cluster — `subject_id` do I-765 não está sendo usado pra escolher a referência.

**Ação:**
- No cluster validator, garantir que cada I-765 cruza com o form do MESMO subject_id (I-914 se principal, I-914A se dep).

---

## Resumo executivo

| # | Regra | Marcações | Causa raiz | Esforço |
|---|---|---|---|---|
| 1 | T_FILING_PHYSICAL_ADDR_NEEDS_PROOF | 29 | Premissa invertida + mapper | Alto |
| 4 | T_DEP_I914A_NO_EVIDENCE | 11 | Mapper + critério | Médio |
| 3 | DOC_EDITION_OUTDATED | 11 | Lista hardcoded desatualizada | Baixo |
| 2 | SENIOR_COVER_LETTER_OUTDATED | 7 | Rotulagem do LLM | Médio |
| 5 | T_FILING_SSN_EMPTY | 6 | Regra aplicada em form errado | Baixo |
| 6 | DOC_PASSPORT_BIRTH_PLACE_VS_FORM | 4 | Comparação textual | Baixo |
| 7 | DOC_PASSPORT_QUALITY_ISSUES | 4 | Mapper | Médio |
| 8 | T_CONS_NAME_FORMS_DIVERGE | 4 | Tokenização nomes BR | Baixo |
| 9 | T_FILING_PERSON_PASSPORT_EMPTY | 4 | Regra aplicada em form errado | Baixo |
| 10 | T_FILING_I765_NAME_DIVERGES | 3 | Subject_id no cluster | Baixo |
| — | Outros | ~27 | Casos isolados | — |

**Quick wins (esforço baixo, impacto alto):**
- #3, #5, #9: restringir aplicabilidade ou atualizar lista — ~21 marcações resolvidas em horas
- #6, #10: ajustes pontuais de comparação — ~7 marcações

**Causa raiz comum (alto retorno):** **mapper de subdocs** (`mapDocumentStructure` em claude.ts) está sub-classificando comprovantes de residência e certidões de dependentes. Resolver isso ataca #1, #4, #7 simultaneamente (~44 marcações).

**Causa raiz comum #2:** **rotulagem dos achados SENIOR_*** pelo LLM — 7 marcações + provavelmente parte das 27 "outras".
