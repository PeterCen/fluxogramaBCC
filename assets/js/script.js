/**
 * Ponto de Entrada Principal da Aplicação (script.js)
 *
 * Orquestra e reexporta os módulos de domínio e interface:
 * - courses.js    : Carregamento e validação dos JSONs de cursos (assets/data/courses/*.json)
 * - state.js      : Grafo curricular, estado global (S), escape HTML (esc), sanitização e persistência
 * - risk.js       : Cálculo de risco (faltas + nota + NAF), prioridade, sincronização de notas e Anexo III
 * - planner.js    : Planejador guloso por caminho crítico e simulação Monte Carlo (1000 rodadas)
 * - calendar.js   : Importância, urgência, prioridade e planejador diário de estudo no calendário
 * - ui.js         : Abas WAI-ARIA, renderização do fluxograma/fallback, tabelas e eventos da interface
 * - equivalence.js: Matriz oficial de equivalência curricular entre PPC 2018 e 2022/2023
 */

export * from "./state.js";
export * from "./risk.js";
export * from "./planner.js";
export * from "./calendar.js";
export * from "./ui.js";
export * from "./equivalence.js";

import { initMainTabs, initEvents, build, update, registerEquivalenceRenderer } from "./ui.js";
import { initEquivalenceUI, renderEquivalence } from "./equivalence.js";

registerEquivalenceRenderer(renderEquivalence);
initMainTabs();
initEvents();
initEquivalenceUI();
build();
update();
