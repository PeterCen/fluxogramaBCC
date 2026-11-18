# Fluxograma do Curso — Bacharelado em Ciência da Computação (IFSP Presidente Epitácio)

Página única ([index.html](index.html)), sem dependências: basta abrir no navegador.
Os dados (disciplinas, semestres, carga horária e pré-requisitos) foram extraídos do PPC 2022 (`2022.12.06-PPC-BAC-Ciência-Computação-PEP-Reformulação.pdf`).

## O que foi feito

- **Duas grades**: seletor no topo alterna entre a grade **nova** (PPC 2022) e a **antiga** (PPC 2018, `PPC-CienciadaComputacao-Epitacio-antiga.pdf`), com as mesmas funcionalidades (fluxograma, cursando agora, trabalhos e provas, horários, plano, atividades complementares). Cada grade tem seu progresso salvo separadamente (chave própria no `localStorage`, então trocar de grade não apaga a outra); o JSON exportado guarda o campo `curriculo`, e carregar um JSON de outra grade troca para ela automaticamente.
  - Grade antiga: 55 obrigatórias, 9 eletivas (mínimo 2 = 126,6 h), Libras optativa, TCC de 100 h (2×50 h), 80 h de atividades complementares, total 3251 h. O TCC 1 é liberado quando restam no máx. 2× o limite de disciplinas/semestre (o PPC antigo não fixa %). "FP1 ou FP2 ou FP3" de Projeto Integrado I foi simplificado para FP1. Atividades complementares: apenas o total de horas.

- **Abas**: a página é dividida em Fluxograma, Cursando agora, Trabalhos e Provas, Horários, Plano estimado, Atividades Compl., Configurações e Como funciona. O resumo (KPIs e barra de progresso) fica sempre visível no topo; a última aba usada é lembrada.

- **Fluxograma** com as disciplinas em colunas por semestre (1º ao 8º), eletivas/optativas e TCC, ligadas por setas de pré-requisito.
  - Passar o mouse numa disciplina destaca toda a cadeia de pré-requisitos e das disciplinas que ela libera.
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
- **Salvamento em JSON**:
  - Autosave no `localStorage` do navegador.
  - Botões Salvar/Carregar JSON; no Chrome/Edge o arquivo fica vinculado e é atualizado a cada mudança (File System Access API). Nos demais navegadores, baixa o arquivo.
  - Campos salvos: `passed`, `electivePlan`, `startYear`, `startHalf`, `maxLoad`, `failRate`, `respectParity`, `acDone`, `current`, `tasks`, `cap`, `weekend`, `hor`, `ac`, `savedAt`.

## Estrutura do projeto

- `index.html` — página do Bacharelado em Ciência da Computação (abas, controles e tabelas).
- `assets/js/script.js` — dados das grades, simulação, risco, trabalhos e provas, renderização e salvamento.
- `assets/css/styles.css` e `assets/img/` — estilos e ícone.
- `pedagogia/index.html` — fluxograma da Licenciatura em Pedagogia (página separada).
- PDFs na raiz — PPCs usados como fonte dos dados (Ciência da Computação nova e antiga, e Pedagogia).

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
- Importar a grade de outro PPC/curso a partir de um JSON de configuração.
- Exportar o plano em PDF/imagem; modo claro; versão responsiva para celular.
- Trabalhos e Provas: somar automaticamente os pontos obtidos na nota atual da matéria; arrastar atividades no calendário; dividir provas em blocos de estudo; lembretes de prazo.
- Regra das eletivas "a partir do 5º semestre" e outras restrições do PPC ainda não modeladas.
# petercen.github.io
