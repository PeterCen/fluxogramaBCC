# Fluxograma do Curso — Bacharelado em Ciência da Computação (IFSP Presidente Epitácio)

Página única ([index.html](index.html)), sem dependências: basta abrir no navegador.
Os dados (disciplinas, semestres, carga horária e pré-requisitos) foram extraídos do PPC 2022 (`2022.12.06-PPC-BAC-Ciência-Computação-PEP-Reformulação.pdf`).

## O que foi feito

- **Aplicativo Único Orientado a Dados (1 JSON por Curso)**: o seletor no topo (`#curSw`) e o parâmetro de URL `?curso=<id>` alternam dinamicamente entre qualquer curso cadastrado em `assets/data/courses/index.json` — atualmente **Ciência da Computação — PPC 2022** (`bcc-2022.json`), **Ciência da Computação — PPC 2018** (`bcc-2018.json`) e **Licenciatura em Pedagogia — PPC 2023** (`pedagogia-2023.json`). Todos os cursos compartilham o mesmo motor completo (fluxograma, cursando agora, trabalhos e provas, horários, plano estimado, atividades complementares e feedback), eliminando cópias de código por pasta. Cada curso salva seu progresso separadamente em sua própria chave do `localStorage`, e o JSON exportado guarda o campo `curriculo` para trocar automaticamente de curso ao ser importado.
  - **Como adicionar um novo curso**: basta criar um novo arquivo JSON em `assets/data/courses/<novo-curso>.json` e registrá-lo em `assets/data/courses/index.json`.
  - Grade antiga BCC (PPC 2018): 55 obrigatórias, 9 eletivas (mínimo 2 = 126,6 h), Libras optativa, TCC de 100 h (2×50 h), 80 h de atividades complementares, total 3251 h.
  - Licenciatura em Pedagogia (PPC 2023): 47 obrigatórias, 4 estágios supervisionados (`ES5` a `ES8`, total 400 h, liberados após 35% da carga horária mínima), 4 eletivas (escolher 2 = 66,6 h) e 200 h de Atividades Teórico-Práticas de Aprofundamento, total 3200,3 h. O endereço `/pedagogia/` redireciona automaticamente para `/?curso=pedagogia`.

- **Desacoplamento de Dados e Lógica (Scripts em `scripts/` vs. JSON Puro em `assets/data/courses/`)**: as matrizes curriculares foram completamente desacopladas do código JavaScript de execução e transformadas em arquivos JSON puros (`assets/data/courses/*.json`). Os scripts e matrizes históricas de extração dos PDFs (`raw_new.js`, `raw_old.js`) foram movidos para a pasta [`scripts/`](scripts/), acompanhados de documentação detalhada ([`scripts/README.md`](scripts/README.md)) e de um script utilitário de auditoria e paridade (`scripts/convert_raw_to_json.mjs`).

- **Abas Acessíveis (WAI-ARIA & Teclado)**: a página é dividida em Fluxograma, Cursando agora, Trabalhos e Provas, Horários, Plano estimado, Atividades Compl., Configurações, Como funciona e Feedback, utilizando `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls` e *roving tabindex* (`0`/`-1`), com navegação completa por teclado (`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`, `Space`). O resumo (KPIs e barra de progresso) fica sempre visível no topo; a última aba usada é lembrada.

- **Fluxograma (Desktop, Mobile/Touch, Teclado e Fallback em Lista)**:
  - **Grafo Visual**: disciplinas em colunas por semestre (1º ao 8º), eletivas/optativas e TCC, ligadas por setas de pré-requisito.
  - **Suporte Mobile / Touch (sem depender de hover ou duplo clique)**: barra de modo de toque (`✓ Aprovar`, `📚 Cursando`, `🔍 Pré-requisitos`), botões diretos de 1 toque (`📚` e `🔍`) em cada card e painel interativo de inspeção (`#flowInspect`) com chips dos pré-requisitos e matérias liberadas.
  - **Navegação por Teclado nos Cards**: cada card possui `tabindex="0"`, `role="button"`, `aria-pressed`, navegação espacial entre colunas/linhas com as setas direcionais e atalhos (`Enter`/`Espaço` para ação principal, `C` para cursando, `I` para inspecionar pré-requisitos, `S` para eletiva, `Esc` para fechar inspeção).
  - **Fallback em Lista Responsiva por Semestre (`#flowFallback`) e `<noscript>`**: visão alternativa em lista por semestre (ativada automaticamente em telas pequenas `<= 700px` ou alternável a qualquer momento na barra do fluxograma) com pré-requisitos e dependentes explícitos em texto e botões de 1 toque, além de fallback `<noscript>` com links diretos para os PDFs dos PPCs.
  - Cores: aprovada (verde), disponível (azul), bloqueada (cinza); disciplinas de extensão com faixa rosa.
- **Checkpoint de aprovação**: clicar numa disciplina marca/desmarca "aprovada"; desmarcar remove as dependentes. Duplo clique marca como "cursando agora". Há atalho "marcar tudo até o semestre N".
- **Estimativa de tempo para concluir**:
  - Oferta par/ímpar: 1º semestre do ano oferece semestres 1, 3, 5 e 7; o 2º oferece 2, 4, 6 e 8 (pode ser desligado).
  - Planejador guloso que prioriza disciplinas que liberam a maior cadeia (caminho crítico), com limite de disciplinas por semestre.
  - Três cenários: **mínimo** (sem imprevistos), **provável** (mediana) e **pessimista** (percentil 90) de uma simulação Monte Carlo (1000 rodadas) com chance configurável de falha (não oferta, choque, reprovação).
  - Cada disciplina pendente mostra o semestre previsto; há uma linha do tempo com o plano.
- **Cursando agora**: por matéria, nota atual, pontos a receber, faltas e aulas; calcula o risco de reprovar (faltas + nota), prioridade automática e fase.
- **Trabalhos e Provas**: junta as avaliações por matéria (data, pontos que vale, pontos obtidos, esforço em horas).
  - **Importância** = peso na matéria (pontos ÷ total da matéria, mín. 10) ajustado pelo risco de reprovar; **urgência** = folga entre o prazo e o esforço necessário (horas/dia configurável); **prioridade** = 55% importância + 45% urgência.
  - Ranking com a ordem sugerida de execução e calendário mensal que mostra entregas/provas e as horas planejadas de cada dia (o plano é recalculado dia a dia; avisa quando uma atividade não cabe).
- **Horários**: grade semanal de aulas e salas, integrada ao "Cursando agora".
- **Atividades complementares**: tabela do Anexo III (grade nova) com limites por atividade/grupo, ou total de horas manual (grade antiga).
- **Configurações**: próximo semestre letivo a cursar, máximo de disciplinas por semestre, chance de não cursar uma disciplina (usada no cenário provável/pessimista), aproveitamento esperado nas avaliações que faltam, base dos 75% que liberam o TCC 1, oferta par/ímpar e atividades complementares concluídas. Também ficam aqui salvar/carregar JSON, checkpoint rápido e limpar progresso.
- **Risco de reprovar (por matéria)**: combina faltas e nota. Faltas: limite de 25% das aulas previstas, projetando 60% do ritmo atual nas aulas restantes. Nota: compara o % dos pontos a receber necessário para chegar a 6 com o aproveitamento esperado; se a nota máxima possível for ≥ 4, a NAF reduz esse risco em 25%. É uma estimativa, não uma previsão. A prioridade "Auto" é Alta quando o risco está entre 15% e 75%, e Baixa fora disso.
- **Como funciona**: aba dentro da página com as regras e simplificações do modelo.
- **Salvamento e Importação em JSON com Validação de Esquema**:
  - Autosave no `localStorage` do navegador e troca reativa em tempo de execução (`switchCourse()`) sem recarregar a página (`location.reload()`), reconstruindo o grafo curricular e a interface instantaneamente.
  - Validação estrita de esquema (`validateStateSchema()`): antes de carregar qualquer arquivo JSON, o sistema valida a integridade estrutural, a compatibilidade de currículo e a presença dos campos essenciais, rejeitando arquivos corrompidos ou incompatíveis com mensagens detalhadas de erro.
  - Botões Salvar/Carregar JSON; no Chrome/Edge o arquivo fica vinculado e é atualizado a cada mudança (File System Access API). Nos demais navegadores, baixa o arquivo.
  - Campos salvos: `passed`, `electivePlan`, `startYear`, `startHalf`, `maxLoad`, `failRate`, `respectParity`, `acDone`, `current`, `tasks`, `cap`, `weekend`, `hor`, `ac`, `savedAt`.

## Estrutura do projeto

- `index.html` — aplicação única orientada a dados (abas, controles, tabelas e Content Security Policy).
- `assets/data/courses/index.json` — catálogo manifesto dos cursos disponíveis no sistema.
- `assets/data/courses/bcc-2022.json`, `bcc-2018.json`, `pedagogia-2023.json` — arquivos JSON independentes por curso (metadados, regras de TCC/estágio, atividades complementares e matriz curricular).
- `assets/js/courses.js` — carregador e validador de schema (`validateCourseConfig()`) dos arquivos JSON de cursos.
- `assets/js/state.js` — grafo curricular (`C`, `ORDER`, `anc`, `desc`, `depth`, `rebuildCourseGraph()`), estado global (`S`), alternância reativa sem reload (`switchCourse()`), validação formal de JSON (`validateStateSchema()`), escape HTML (`esc()`), sanitização (`sanitizeState()`) e persistência (`persist()`).
- `assets/js/risk.js` — cálculo de risco de reprovação (`risk()`, `riskMap()`), prioridade automática (`effPrio()`), sincronização de notas de avaliações (`syncSubjectGrades()`) e calculadora do Anexo III (`acCalc()`).
- `assets/js/planner.js` — planejador guloso de semestres por caminho crítico (`simulate()`), seleção de eletivas (`electivesPlanned()`), regras de TCC/estágio (`tccOpen()`) e simulação Monte Carlo (`monte()`, `seed()`).
- `assets/js/calendar.js` — utilitários de datas, fórmulas de importância/urgência/prioridade (`importance()`, `urgency()`, `prioOf()`) e planejador diário de estudo no calendário (`planTasks()`).
- `assets/js/ui.js` — abas acessíveis WAI-ARIA (`bindTablist()`), renderização do fluxograma, modo mobile/toque, fallback em lista, tabelas e listeners de eventos.
- `assets/js/script.js` — ponto de entrada principal que inicializa e reexporta os módulos da aplicação.
- `assets/js/feedback.js` e `assets/js/config.js` — chamada para envio de feedback via Formspree.
- `assets/css/styles.css` e `assets/img/` — estilos e ícone.
- `pedagogia/index.html` e `assets/js/redirect-pedagogia.js` — redirecionamento compatível de `/pedagogia/` para `/?curso=pedagogia`.
- `scripts/` — scripts e matrizes históricas de extração dos PDFs (`raw_new.js`, `raw_old.js`), script de auditoria/conversão (`convert_raw_to_json.mjs`) e documentação do pipeline (`scripts/README.md`), mantendo o ferramental separado dos dados em JSON puro.
- `tests/security-check.mjs` — suíte automatizada de análise estática (`innerHTML` vs `esc()`), validação dos JSONs de cursos, testes de acessibilidade WAI-ARIA/fallbacks e fuzzing anti-XSS.
- `tests/core-logic.test.mjs` — testes unitários da lógica pura de domínio (grafo de pré-requisitos, cálculo de risco, planejador guloso de semestres, simulação Monte Carlo, planejador diário de tarefas, atividades complementares e catálogo multi-curso).
- `.githooks/pre-commit` — hook de pré-commit que executa a verificação de segurança e os testes unitários antes de permitir novos commits.
- `.github/workflows/security.yml` — workflow de CI (GitHub Actions) que valida pushes e pull requests automaticamente.
- PDFs na raiz — PPCs usados como fonte dos dados (Ciência da Computação nova e antiga, e Pedagogia).

## Como Adicionar um Novo Curso (JSON)

Para adicionar um novo curso ou uma nova reformulação de PPC sem duplicar código ou criar pastas:

1. Crie o arquivo `assets/data/courses/<id-do-curso>.json` com o seguinte formato:
   ```json
   {
     "id": "ads-2026",
     "title": "Tecnologia em Análise e Desenvolvimento de Sistemas",
     "shortTitle": "ADS (PPC 2026)",
     "label": "ADS — PPC 2026 (Noturno)",
     "icon": "💻",
     "sub": "IFSP Câmpus Presidente Epitácio · PPC 2026",
     "ls": "fluxo-ads-v1",
     "unit": "aulas",
     "tccH": 30,
     "acReq": 40,
     "acName": "Atividades Complementares",
     "totalH": 2000,
     "acTable": false,
     "tccRest": false,
     "tccPct": 0.75,
     "estMinPct": 0,
     "eletNeed": 2,
     "eletHeaderSub": "126,6h de eletivas",
     "eletDef": ["EL01", "EL02"],
     "eletivas": ["EL01", "EL02"],
     "tccLbl": "libera com 75% da carga",
     "raw": [
       ["ALG1", "Algoritmos e Programação", 1, 4, 0, []],
       ["WEB1", "Desenvolvimento Web", 2, 4, 0, ["ALG1"]]
     ]
   }
   ```
   - Use `"unit": "aulas"` quando o 4º valor de cada item em `"raw"` for o número de aulas semanais (convertido por `aulas * 19 * 50 / 60`), ou `"unit": "horas"` quando o 4º valor já for a carga horária em horas (como em `pedagogia-2023.json`).
   - Semestres `1..8` são obrigatórias (`ob`, ou `es` se o código começar com `"ES"`), `9` são eletivas (`el`), `10` são optativas (`op`) e `11..12` com código `"TCC*"` são etapas de TCC (`tcc`).
2. Registre o novo arquivo em `assets/data/courses/index.json`:
   ```json
   {
     "id": "ads-2026",
     "file": "ads-2026.json",
     "label": "ADS — PPC 2026 (Noturno)"
   }
   ```

## Segurança, Acessibilidade e Testes Automatizados

Para garantir qualidade, acessibilidade e impedir regressões ou vulnerabilidades de Cross-Site Scripting (XSS), o projeto conta com defesa em profundidade e testes automatizados:

1. **Escape Sistemático de HTML (`esc()`)**: todas as interpolações dinâmicas nos templates atribuídos a `innerHTML` (em `assets/js/script.js` e `pedagogia/index.html`) passam por `esc()`, que escapa `&`, `<`, `>`, `"` e `'`.
2. **Sanitização Estrita de Estado e JSON (`sanitizeState()`)**: todo estado lido do `localStorage` ou importado via arquivo `.json` é validado por schema antes de uso — bloqueando *Prototype Pollution* (`Object.prototype.hasOwnProperty.call`), forçando conversão e limites (*clamping*) para campos numéricos (`nota`, `pts`, `got`, `falt`, `cum`, `prev`, `eff`, `failRate`, `startYear`, etc.) e validando campos enumerados contra *allowlists*.
3. **Content Security Policy (CSP)**: `index.html` define `script-src 'self'`, bloqueando execução de scripts inline, `eval()` e atributos de evento injetados (`onerror=`, `onload=`) diretamente no navegador.
4. **Testes Unitários da Lógica Pura (`tests/core-logic.test.mjs`)**:
   - **Grafo e Caminho Crítico**: valida fecho transitivo de pré-requisitos (`anc`), dependentes (`desc`) e profundidade da cadeia (`depth`).
   - **Cálculo de Risco (`risk`, `effPrio`, `syncSubjectGrades`)**: valida limite de 25% de faltas, projeção de 60% do ritmo, desconto de 25% da NAF quando `nota + pts >= 4`, prioridade automática na faixa `15%–75%` e sincronização automática de notas a partir das atividades avaliadas.
   - **Planejador Guloso (`simulate`, `electivesPlanned`, `tccOpen`)**: valida invariantes de pré-requisitos, oferta par/ímpar, limite `maxLoad`, seleção de eletivas, desbloqueio de `TCC1`/`TCC2` com 75% da carga e diferença entre `mode = 0` e `mode = 1`.
   - **Simulação Monte Carlo (`monte`, `seed`)**: valida determinismo do PRNG (1000 rodadas), caso base sem falha (`failRate = 0`), invariante `p90 >= med >= min` e monotonicidade com a taxa de falha.
   - **Planejador de Estudo e Atividades Complementares (`planTasks`, `acCalc`)**: valida importância, urgência, distribuição diária de horas (`cap`, `weekend`) e teto compartilhado de 40h do Grupo A (Anexo III).
5. **Como Executar Localmente e no CI**:
   - Para rodar a auditoria estática de `innerHTML`/`esc()`, acessibilidade WAI-ARIA e fuzzing anti-XSS:
     ```bash
     node tests/security-check.mjs
     ```
   - Para rodar os testes unitários do planejador guloso, simulação Monte Carlo e cálculo de risco:
     ```bash
     node --test tests/core-logic.test.mjs
     ```
   - Para ativar o hook de pré-commit (que roda ambas as suítes automaticamente antes de cada `git commit`):
     ```bash
     git config core.hooksPath .githooks
     ```

## Premissas e simplificações

- Eletivas: 2 disciplinas (126,6h); escolhidas com ★, o restante é sugerido automaticamente. Optativas (Libras, Sist. Microcontrolados) não contam.
- TCC: duas etapas (TCC 1 no 1º semestre, TCC 2 no 2º, exige o TCC 1), liberadas com 75% da carga concluída (base configurável).
- Atividades complementares (65h na grade nova, 80h na antiga): contam no progresso e na liberação do TCC.
- Trabalhos e Provas: pesos 55/45 da prioridade e o mínimo de 10 pontos por matéria são escolhas do app, não do PPC.
- Eletivas e TCC são consideradas ofertadas todo semestre.
- Disciplinas sem pré-requisito no PPC ficam soltas no fluxo.
- Prazo mínimo de 8 e máximo de 16 semestres, conforme o PPC.

## Possíveis melhorias

- Registrar o semestre em que cada disciplina foi cursada (histórico real) e usar isso na estimativa.
- Bloquear disciplinas que não serão ofertadas em determinado semestre ou que tenham choque de horário.
- Alerta explícito quando a estimativa passar de 16 semestres (hoje só o KPI muda de cor).
- Modelar carga horária máxima por semestre (aulas/semana) em vez de número de disciplinas.
- Contar horas de extensão e eletivas por categoria.
- Mostrar o caminho crítico no fluxo e permitir ajuste manual do plano (arrastar disciplinas entre semestres).
- Exportar o plano em PDF/imagem; modo claro.
- Trabalhos e Provas: somar automaticamente os pontos obtidos na nota atual da matéria; arrastar atividades no calendário; dividir provas em blocos de estudo; lembretes de prazo.
- Regra das eletivas "a partir do 5º semestre" e outras restrições do PPC ainda não modeladas.
# petercen.github.io
