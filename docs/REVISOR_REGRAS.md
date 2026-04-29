# Revisor Go Visa — Regras de Análise

Este documento lista **todas as verificações** que o sistema faz em um processo enviado para revisão. Leia cada regra e, no campo **Comentário do cliente**, escreva o que achar:

- **Concorda?** Deixa sem comentário.
- **Quer ajustar?** Escreve o que mudar (severidade, texto, situação em que dispara).
- **Quer remover?** Escreve "remover" e o porquê.
- **Sente falta de checagem?** Há um espaço no final do documento ("Regras que faltam").

---

## Como o revisor funciona

1. O advogado manda um PDF com o processo compilado.
2. O sistema identifica o tipo de petição (**T-visa, U-visa ou VAWA**) e quais formulários/documentos estão dentro.
3. Aplica as regras abaixo e gera um relatório com os problemas encontrados.
4. Cada problema vem com **severidade** (peso do alerta) e **explicação**.

**Severidade:**
- **Crítica** — sem resolver, USCIS rejeita ou não aprova.
- **Alta** — problema sério de elegibilidade ou evidência.
- **Média** — atenção, pode virar RFE.
- **Baixa** — observação estratégica.

**Modo de análise:** o revisor roda em **Rascunho** (padrão) ou **Final**.
- No **Rascunho**, assinaturas não são cobradas — é só um lembrete no final.
- No **Final**, todas as regras de assinatura passam a valer.

---

# PARTE 1 — T-VISA (Vítima de Tráfico Humano)

## 1. Endereço da firma

### 1.1 Physical Address tem que ser o da Go Visa
- **Severidade:** Crítica
- **O que checa:** Se o "Physical Address" do formulário é o endereço da Go Visa (429 S Keller Rd, Ste 200A, Orlando, FL 32810).
- **Dispara quando:** O endereço no formulário não é o da Go Visa.
- **Comentário do cliente:**

### 1.2 Safe Mailing Address tem que ser o da Go Visa
- **Severidade:** Crítica
- **O que checa:** Se o Safe Mailing Address aponta pra Go Visa.
- **Dispara quando:** Não aponta.
- **Comentário do cliente:**

### 1.3 In Care Of tem que ser "GO VISA LAW FIRM"
- **Severidade:** Alta
- **O que checa:** Se o campo "In Care Of Name" do Safe Mailing está escrito como GO VISA LAW FIRM.
- **Dispara quando:** Está em branco ou diferente.
- **Comentário do cliente:**

### 1.4 Mailing Address tem que ser o da Go Visa
- **Severidade:** Alta
- **O que checa:** Quando existe Mailing Address, se aponta pra Go Visa.
- **Dispara quando:** Aponta pra outro endereço.
- **Comentário do cliente:**

---

## 2. Dados pessoais do cliente

### 2.1 Campos obrigatórios (Sobrenome, Nome, DOB, País de Nascimento, Passaporte)
- **Severidade:** Alta para Sobrenome / Nome / DOB. Média para País de Nascimento e Passaporte.
- **O que checa:** Se esses campos estão preenchidos em cada formulário.
- **Dispara quando:** O campo está em branco.
- **Comentário do cliente:**

### 2.2 SSN em branco
- **Severidade:** Baixa
- **O que checa:** Se o SSN está em branco.
- **Dispara quando:** Está em branco (o ideal é marcar "None" ao invés de deixar vazio).
- **Comentário do cliente:**

---

## 3. Assinaturas (modo Final)

### 3.1 Assinatura do requerente
- **Severidade:** Crítica
- **O que checa:** Cada formulário assinado pelo cliente, com data.
- **Dispara quando:** Falta assinatura ou data.
- **Comentário do cliente:**

### 3.2 Assinatura do intérprete
- **Severidade:** Crítica
- **O que checa:** Se o formulário indica uso de intérprete, o bloco tem que estar completo.
- **Dispara quando:** Marcou uso de intérprete mas não assinou.
- **Comentário do cliente:**

### 3.3 Assinatura do preparer
- **Severidade:** Alta
- **O que checa:** Se marcou uso de preparer, bloco completo.
- **Dispara quando:** Marcou mas não assinou.
- **Comentário do cliente:**

### 3.4 G-28 — Assinatura do cliente (Parte 4)
- **Severidade:** Crítica
- **O que checa:** Cliente precisa assinar o G-28.
- **Dispara quando:** Sem assinatura ou data.
- **Comentário do cliente:**

### 3.5 G-28 — Assinatura do advogado (Parte 5)
- **Severidade:** Crítica
- **O que checa:** Advogado precisa assinar o G-28.
- **Dispara quando:** Sem assinatura ou data.
- **Comentário do cliente:**

---

## 4. I-914B (Certificação de Law Enforcement)

### 4.1 Parte 2 não pode vir preenchida
- **Severidade:** Crítica
- **O que checa:** A Parte 2 é da agência certificadora. O advogado não preenche.
- **Dispara quando:** Qualquer campo da Parte 2 está preenchido antes do envio.
- **Comentário do cliente:**

### 4.2 Agência tem que ser qualificada (8 CFR 214.11(h))
- **Severidade:** Crítica
- **Qualificadas:** Federal (ICE/HSI, FBI, DOJ, DOL, EEOC), polícia estadual/local, promotoria, CPS.
- **NÃO qualificadas:** Advogados, ONGs, médicos, social workers.
- **Dispara quando:** Agência listada não é qualificada.
- **Comentário do cliente:**

### 4.3 Officer sem assinatura (modo Final)
- **Severidade:** Crítica
- **O que checa:** Law Enforcement Officer precisa assinar.
- **Dispara quando:** Falta assinatura.
- **Comentário do cliente:**

### 4.4 Cooperation mencionada sem I-914B nem exemption
- **Severidade:** Crítica
- **O que checa:** Se a história diz que cooperou com LEA mas não há I-914B e não há justificativa de isenção.
- **Dispara quando:** Falta I-914B e não há motivo de isenção.
- **Comentário do cliente:**

### 4.5 Isenção de cooperation alegada
- **Severidade:** Média
- **O que checa:** Cliente alega exemption (idade, trauma severo).
- **Dispara quando:** Exemption mencionada — lembrete para documentar.
- **Comentário do cliente:**

---

## 5. I-192 (Waiver)

### 5.1 EWI sem ground 212(a)(6)(A) no I-192
- **Severidade:** Alta
- **O que checa:** Se entrou sem inspeção (EWI), o I-192 tem que listar 212(a)(6)(A).
- **Dispara quando:** É EWI mas I-192 não lista.
- **Comentário do cliente:**

### 5.2 Waiver sem justificativa escrita
- **Severidade:** Média
- **O que checa:** I-192 com justificativa narrativa (national interest / humanitarian / public interest).
- **Dispara quando:** Não traz justificativa.
- **Comentário do cliente:**

---

## 6. I-765 (EAD)

### 6.1 Categoria vazia
- **Severidade:** Crítica
- **O que checa:** Eligibility Category preenchida.
- **Dispara quando:** Em branco.
- **Comentário do cliente:**

### 6.2 Categoria errada para T-1 principal
- **Severidade:** Crítica
- **O que checa:** T-1 principal usa (c)(25) ou (a)(16).
- **Dispara quando:** Marcado como principal mas outra categoria.
- **Comentário do cliente:**

### 6.3 Nome do I-765 não bate com o do I-914
- **Severidade:** Alta
- **O que checa:** Se o I-765 marcado como "do principal" tem o mesmo nome do I-914.
- **Dispara quando:** Nomes diferentes.
- **Comentário do cliente:**

---

## 7. Consistência entre formulários

### 7.1 Sobrenome, Nome, DOB, País de Nascimento, Passaporte, A-Number, Estado Civil
- **Severidade:** Crítica
- **O que checa:** Esses campos iguais em todos os formulários.
- **Dispara quando:** Qualquer divergência entre formulários.
- **Comentário do cliente:**

---

## 8. História × formulário (T-visa)

### 8.1 Estado civil diverge entre história e formulário
- **Severidade:** Crítica
- **Comentário do cliente:**

### 8.2 DOB diverge entre história e formulário
- **Severidade:** Crítica
- **Comentário do cliente:**

### 8.3 Passaporte diverge entre história e formulário
- **Severidade:** Alta
- **Comentário do cliente:**

### 8.4 Ano de entrada nos EUA diverge entre história e I-914
- **Severidade:** Alta
- **Comentário do cliente:**

### 8.5 Porto de entrada diverge entre história e I-914
- **Severidade:** Média
- **Comentário do cliente:**

### 8.6 Cônjuge na história não bate com estado civil do formulário
- **Severidade:** Crítica
- **O que checa:** História menciona cônjuge mas formulário não marca "casado" (ou vice-versa).
- **Comentário do cliente:**

---

## 9. Elegibilidade do T-visa (análise da história)

### 9.1 Sem force / fraud / coercion
- **Severidade:** Crítica
- **O que checa:** T-visa exige pelo menos um dos três elementos.
- **Dispara quando:** Nenhum aparece na história.
- **Comentário do cliente:**

### 9.2 Tipo de tráfico não definido
- **Severidade:** Alta
- **O que checa:** História esclarece se foi sexual, laboral ou ambos.
- **Dispara quando:** Não dá pra saber.
- **Comentário do cliente:**

### 9.3 Presença nos EUA não ligada ao tráfico
- **Severidade:** Crítica
- **O que checa:** Cliente nos EUA em razão do tráfico.
- **Dispara quando:** História indica que não.
- **Comentário do cliente:**

### 9.4 Extreme hardship ausente
- **Severidade:** Alta
- **O que checa:** História aborda hardship em caso de remoção (re-trafficking, falta de mental health, retaliação, impunidade).
- **Dispara quando:** Não aborda.
- **Comentário do cliente:**

### 9.5 Trauma pouco descrito
- **Severidade:** Média
- **Comentário do cliente:**

---

## 10. Dependentes (I-914A e CSPA)

### 10.1 Filhos qualificados na história sem I-914A correspondente
- **Severidade:** Alta
- **O que checa:** Filhos solteiros e menores de 21 anos no filing qualificam como derivativos.
- **Dispara quando:** Há filho qualificado na história sem I-914A.
- **Comentário do cliente:**

### 10.2 Filhos não qualificados (≥ 21 ou casados)
- **Severidade:** Baixa
- **Comentário do cliente:**

### 10.3 Filho sem data de nascimento na história
- **Severidade:** Baixa
- **Comentário do cliente:**

### 10.4 Familiar no I-914 que qualifica mas não tem I-914A
- **Severidade:** Alta
- **Regras de qualificação:**
  - Cônjuge: sempre qualifica.
  - Filho: < 21 e solteiro.
  - Pai/mãe: só qualifica se principal < 21.
  - Irmão/irmã: só se principal < 21 E irmão < 18 E solteiro.
- **Comentário do cliente:**

### 10.5 I-914A sem evidência do relacionamento
- **Severidade:** Alta
- **O que checa:** I-914A tem que vir com certidão de nascimento/casamento.
- **Dispara quando:** Nenhuma evidência mencionada.
- **Comentário do cliente:**

### 10.6 I-914A com diferença de idade suspeita (child < 10 anos do principal)
- **Severidade:** Média
- **Comentário do cliente:**

### 10.7 I-914A de dependente no exterior
- **Severidade:** Baixa
- **O que checa:** Consular processing necessário, adiciona tempo.
- **Comentário do cliente:**

---

## 11. Outros (T-visa)

### 11.1 Cliente em removal proceedings
- **Severidade:** Alta
- **O que checa:** Avaliar motion to terminate ou administrative closure.
- **Comentário do cliente:**

### 11.2 Aplicações imigratórias anteriores
- **Severidade:** Baixa
- **O que checa:** Asylum, U, VAWA anteriores — revisar consistência narrativa.
- **Comentário do cliente:**

---

---

# PARTE 2 — U-VISA (Vítima de Crime que Ajuda LEA)

## 12. Formulários essenciais

### 12.1 I-918 ausente
- **Severidade:** Crítica
- **O que checa:** Processo U-visa tem que ter I-918 principal.
- **Comentário do cliente:**

### 12.2 Qualifying criminal activity vazia no I-918
- **Severidade:** Crítica
- **O que checa:** Part 3 do I-918 listando o crime.
- **Comentário do cliente:**

---

## 13. I-918B (Certificação obrigatória)

### 13.1 I-918B ausente
- **Severidade:** Crítica
- **O que checa:** U-visa EXIGE I-918B assinado por agência qualificada.
- **Comentário do cliente:**

### 13.2 Agência certificadora não qualificada
- **Severidade:** Crítica
- **Qualificadas:** Federal (ICE/HSI, FBI, USAO, DOJ, DOL, EEOC), polícia estadual/local, promotoria, juízes, CPS, EEOC, Labor.
- **NÃO qualificadas:** Advogados, ONGs, médicos, social workers.
- **Comentário do cliente:**

### 13.3 I-918B sem assinatura do certifying official
- **Severidade:** Crítica
- **Comentário do cliente:**

### 13.4 Título do oficial ausente
- **Severidade:** Alta
- **Comentário do cliente:**

### 13.5 Helpfulness não confirmada
- **Severidade:** Crítica
- **O que checa:** I-918B confirma que o peticionário foi/é/será helpful ao LEA.
- **Comentário do cliente:**

### 13.6 I-918B assinada há mais de 6 meses
- **Severidade:** Média
- **O que checa:** Certificação mais velha que 180 dias pode gerar RFE.
- **Comentário do cliente:**

---

## 14. Elegibilidade U-visa (história)

### 14.1 Sem substantial physical OR mental abuse
- **Severidade:** Crítica
- **O que checa:** U-visa exige abuso físico ou mental substancial.
- **Comentário do cliente:**

### 14.2 Menos de 2 exemplos concretos de abuso
- **Severidade:** Alta
- **Comentário do cliente:**

### 14.3 Nenhuma cooperação com LEA
- **Severidade:** Crítica
- **O que checa:** História menciona cooperação passada, atual ou futura.
- **Comentário do cliente:**

### 14.4 Crime mencionado fora da lista qualifying
- **Severidade:** Alta
- **Lista qualifying (8 CFR 214.14(a)(9)):** domestic violence, sexual assault, rape, felonious assault, kidnapping, abduction, extortion, blackmail, false imprisonment, witness tampering, obstruction of justice, perjury, murder, manslaughter, torture, trafficking, peonage, involuntary servitude, slave trade, abusive sexual contact, prostitution, sexual exploitation, female genital mutilation, being held hostage, stalking, fraud in foreign labor contracting.
- **Comentário do cliente:**

---

## 15. Consistência I-918 × I-918B

### 15.1 Crime listado no I-918 não bate com o do I-918B
- **Severidade:** Crítica
- **Comentário do cliente:**

### 15.2 Nome da vítima no I-918B ≠ nome do I-918
- **Severidade:** Alta
- **Comentário do cliente:**

---

---

# PARTE 3 — VAWA (Self-Petition por Violência Familiar)

## 16. Formulário principal

### 16.1 I-360 ausente
- **Severidade:** Crítica
- **O que checa:** VAWA exige I-360 como formulário principal.
- **Comentário do cliente:**

---

## 17. Relacionamento com abusador

### 17.1 Campo relacionamento não indicado
- **Severidade:** Alta
- **O que checa:** I-360 precisa dizer se é spouse, former_spouse, parent ou child.
- **Comentário do cliente:**

### 17.2 Status do abusador (USC ou LPR) desconhecido
- **Severidade:** Crítica
- **O que checa:** VAWA exige abusador USC ou LPR.
- **Comentário do cliente:**

### 17.3 Divórcio há mais de 2 anos
- **Severidade:** Crítica
- **O que checa:** Ex-cônjuge tem janela de 2 anos do divórcio pra protocolar I-360 (INA 204(a)(1)(A)(iii)(II)(aa)(CC)).
- **Comentário do cliente:**

---

## 18. Residência conjunta

### 18.1 Residência com abusador ausente
- **Severidade:** Crítica
- **O que checa:** VAWA exige residência com o abusador em algum momento.
- **Comentário do cliente:**

---

## 19. Abuso caracterizado (história)

### 19.1 Battery or extreme cruelty ausente
- **Severidade:** Crítica
- **O que checa:** História caracteriza violência física OU crueldade extrema (emocional, psicológica).
- **Comentário do cliente:**

### 19.2 Menos de 2 exemplos concretos
- **Severidade:** Alta
- **Comentário do cliente:**

---

## 20. Good faith marriage (quando spouse/former_spouse)

### 20.1 Sem indicadores de casamento de boa-fé
- **Severidade:** Alta
- **O que checa:** História menciona certidão, fotos, contas conjuntas, declarações, filhos em comum, residência.
- **Comentário do cliente:**

---

## 21. Good Moral Character (GMC)

### 21.1 Pontos de atenção em GMC
- **Severidade:** Alta
- **O que checa:** História menciona algo que pode afetar GMC (prisão, dívidas fiscais etc.).
- **Comentário do cliente:**

### 21.2 Declaração de GMC ausente no I-360
- **Severidade:** Alta
- **O que checa:** I-360 precisa afirmar good moral character nos últimos 3 anos.
- **Comentário do cliente:**

---

## 22. Consistência história × I-360

### 22.1 Data de casamento divergente
- **Severidade:** Alta
- **Comentário do cliente:**

### 22.2 Nome do abusador divergente
- **Severidade:** Crítica
- **Comentário do cliente:**

---

---

# PARTE 4 — REGRAS COMUNS (rodam em T-visa, U-visa e VAWA)

## 23. Passaporte (análise da imagem)

### 23.1 Passaporte sem assinatura do titular (modo Final)
- **Severidade:** Crítica
- **O que checa:** Sistema olha a imagem da página de dados do passaporte pra ver se tem rubrica.
- **Comentário do cliente:**

### 23.2 Assinatura do passaporte ambígua
- **Severidade:** Média
- **O que checa:** Qualidade da imagem não permite afirmar com certeza.
- **Comentário do cliente:**

### 23.3 Número do passaporte na imagem ≠ número no formulário
- **Severidade:** Crítica
- **Comentário do cliente:**

---

## 24. Witness Statements

### 24.1 Nenhuma witness statement encontrada
- **Severidade:** Alta
- **Comentário do cliente:**

### 24.2 Declaração sem assinatura (modo Final)
- **Severidade:** Crítica
- **Comentário do cliente:**

### 24.3 Declaração sem cláusula de penalty of perjury (28 U.S.C. §1746)
- **Severidade:** Alta
- **Comentário do cliente:**

### 24.4 Declaração vaga (carta de caráter, sem fatos concretos)
- **Severidade:** Média
- **Comentário do cliente:**

---

## 25. Registros médicos / psicológicos

### 25.1 Nenhuma avaliação encontrada
- **Severidade:** Alta
- **Comentário do cliente:**

### 25.2 Profissional sem credencial licenciada
- **Severidade:** Alta
- **O que checa:** PhD, PsyD, LCSW, MD, LMHC.
- **Comentário do cliente:**

### 25.3 Sem diagnóstico formal em termos DSM-5
- **Severidade:** Média
- **O que checa:** PTSD, MDD, GAD etc.
- **Comentário do cliente:**

### 25.4 Sem nexo entre o diagnóstico e o abuso/tráfico
- **Severidade:** Alta
- **Comentário do cliente:**

---

## 26. Country Conditions

### 26.1 Material não relevante ao hardship do cliente
- **Severidade:** Alta
- **Comentário do cliente:**

### 26.2 Não aborda risco de re-trafficking
- **Severidade:** Média
- **Comentário do cliente:**

### 26.3 Não aborda acesso a mental health no país de origem
- **Severidade:** Média
- **Comentário do cliente:**

---

## 27. Traduções certificadas (8 CFR 103.2(b)(3))

### 27.1 Documento estrangeiro sem tradução certificada
- **Severidade:** Crítica
- **NÃO precisa de tradução:** passaportes, RG/cédula/national ID, documentos já em inglês.
- **PRECISA de tradução:** certidões (nascimento, casamento, divórcio, óbito), boletins de ocorrência, registros médicos/escolares/trabalhistas em outra língua, contratos, cartas.
- **Comentário do cliente:**

---

---

# PARTE 5 — Regras que faltam

Liste checagens que o sistema deveria fazer e hoje não faz. Pode ser específica de T, U, VAWA ou genérica.

1.
2.
3.
4.
5.

---

# PARTE 6 — Observações gerais

Comentário livre sobre o revisor como um todo (o que funciona bem, o que incomoda, o que mudaria no formato do relatório etc.):



---

**Quando terminar, nos devolva o documento com seus comentários em cada regra.**
