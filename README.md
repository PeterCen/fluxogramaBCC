# Fluxograma do Curso — Bacharelado em Ciência da Computação (IFSP Presidente Epitácio)

Página única ([index.html](index.html)), sem dependências: basta abrir no navegador.
Os dados (disciplinas, semestres, carga horária e pré-requisitos) foram extraídos do PPC 2022 (`2022.12.06-PPC-BAC-Ciência-Computação-PEP-Reformulação.pdf`).

## O que foi feito

- **Duas grades**: seletor no topo alterna entre a grade **nova** (PPC 2022) e a **antiga** (PPC 2018, `PPC-CienciadaComputacao-Epitacio-antiga.pdf`), com as mesmas funcionalidades (fluxograma, cursando agora, horários, plano, atividades complementares). Cada grade tem seu progresso salvo separadamente; o JSON exportado guarda o campo `curriculo`.
  - Grade antiga: 55 obrigatórias, 9 eletivas (mínimo 2 = 126,6 h), Libras optativa, TCC de 100 h (2×50 h), 80 h de atividades complementares, total 3251 h. O TCC 1 é liberado quando restam no máx. 2× o limite de disciplinas/semestre (o PPC antigo não fixa %). "FP1 ou FP2 ou FP3" de Projeto Integrado I foi simplificado para FP1. Atividades complementares: apenas o total de horas.

- **Abas**: a página é dividida em Fluxograma, Cursando agora, Horários, Plano estimado, Atividades Compl., Configurações e Como funciona. O resumo (KPIs e barra de progresso) fica sempre visível no topo; a última aba usada é lembrada.

- **Fluxograma** com as disciplinas em colunas por semestre (1º ao 8º), eletivas/optativas e TCC, ligadas por setas de pré-requisito.
  - Passar o mouse numa disciplina destaca toda a cadeia de pré-requisitos e das disciplinas que ela libera.
  - Cores: aprovada (verde), disponível (azul), bloqueada (cinza); disciplinas de extensão com faixa rosa.
- **Checkpoint de aprovação**: clicar numa disciplina marca "aprovada" e também todos os seus pré-requisitos. Desmarcar remove as dependentes. Há atalho "marcar tudo até o semestre N".
- **Estimativa de tempo para concluir**:
  - Oferta par/ímpar: 1º semestre do ano oferece semestres 1, 3, 5 e 7; o 2º oferece 2, 4, 6 e 8 (pode ser desligado).
  - Planejador guloso que prioriza disciplinas que liberam a maior cadeia (caminho crítico), com limite de disciplinas por semestre.
  - Três cenários: **mínimo** (sem imprevistos), **provável** (mediana) e **pessimista** (percentil 90) de uma simulação Monte Carlo (1000 rodadas) com chance configurável de falha (não oferta, choque, reprovação).
  - Cada disciplina pendente mostra o semestre previsto; há uma linha do tempo com o plano.
- **Salvamento em JSON**:
  - Autosave no `localStorage` do navegador.
  - Botões Salvar/Carregar JSON; no Chrome/Edge o arquivo fica vinculado e é atualizado a cada mudança (File System Access API). Nos demais navegadores, baixa o arquivo.
  - Campos salvos: `passed`, `electivePlan`, `startYear`, `startHalf`, `maxLoad`, `failRate`, `respectParity`, `acDone`, `savedAt`.

## Premissas e simplificações

- Eletivas: 2 disciplinas (126,6h); escolhidas com ★, o restante é sugerido automaticamente. Optativas (Libras, Sist. Microcontrolados) não contam.
- TCC: bloco único de 60h (TCC1+TCC2), liberado com 75% da carga obrigatória concluída em semestres anteriores.
- Atividades complementares (65h): apenas uma caixa de marcação, sem impacto no tempo.
- Eletivas e TCC são consideradas ofertadas todo semestre.
- Disciplinas sem pré-requisito no PPC ficam soltas no fluxo.
- Prazo mínimo de 8 e máximo de 16 semestres, conforme o PPC.

## Possíveis melhorias

- Registrar o semestre em que cada disciplina foi cursada (histórico real) e usar isso na estimativa.
- Bloquear disciplinas que não serão ofertadas em determinado semestre ou que tenham choque de horário.
- Separar TCC1 e TCC2; alerta quando passar de 16 semestres.
- Modelar carga horária máxima por semestre (aulas/semana) em vez de número de disciplinas.
- Contar horas de extensão e eletivas por categoria; controlar horas de atividades complementares.
- Mostrar o caminho crítico no fluxo e permitir ajuste manual do plano (arrastar disciplinas entre semestres).
- Importar a grade de outro PPC/curso a partir de um JSON de configuração.
- Exportar o plano em PDF/imagem; modo claro; versão responsiva para celular.
- Regra das eletivas "a partir do 5º semestre" e outras restrições do PPC ainda não modeladas.
# petercen.github.io
