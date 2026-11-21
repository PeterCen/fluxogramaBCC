/**
 * Módulo de Equivalência Curricular entre PPCs (equivalence.js)
 *
 * Responsabilidades:
 * - Carregar a matriz oficial de equivalência (assets/data/equivalence/bcc-equivalence.json).
 * - Permitir visualização bidirecional:
 *     Grade Antiga (2018) -> Grade Nova (2022/2023) e vice-versa.
 * - Filtrar por busca (nome/código), semestre, status de equivalência e disciplinas já concluídas.
 * - Cruzar em tempo real com o estado acadêmico do aluno (S.passed).
 * - Fornecer migração/simulação de aprovações entre PPCs via migratePassedDisciplines().
 * - Renderizar a tabela e os KPIs de equivalência com segurança anti-XSS e WAI-ARIA.
 */

import { esc, S, KEY, switchCourse, persist } from "./state.js";
import { passedSet } from "./planner.js";
import { toast, updateCourseInfo, build, update } from "./ui.js";

const $ = id => document.getElementById(id);

async function loadEquivalence() {
    const isNode = typeof process !== "undefined" &&
        Boolean(process.versions?.node) &&
        (typeof window === "undefined" || window === globalThis);

    if (isNode && typeof fetch !== "function" || (isNode && !globalThis.__BROWSER_FETCH__)) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/equivalence");
        return JSON.parse(fs.readFileSync(path.join(dir, "bcc-equivalence.json"), "utf8"));
    }

    const jsonUrl = new URL("../data/equivalence/bcc-equivalence.json", import.meta.url);
    const resp = await fetch(jsonUrl);
    if (!resp.ok) {
        throw new Error("Falha ao carregar matriz de equivalência (bcc-equivalence.json).");
    }
    return await resp.json();
}

export const EQUIVALENCE_DATA = await loadEquivalence();

/**
 * Converte um conjunto de disciplinas aprovadas de uma grade para outra com base na matriz oficial.
 *
 * @param {string[]} passedList - Lista de códigos de disciplinas aprovadas na grade de origem.
 * @param {string} fromCur - 'antiga' ou 'nova'.
 * @param {string} toCur - 'nova' ou 'antiga'.
 * @returns {string[]} Lista de disciplinas equivalentes aprovadas na grade de destino.
 */
export function migratePassedDisciplines(passedList, fromCur, toCur) {
    if (!Array.isArray(passedList) || fromCur === toCur) {
        return [...new Set(passedList || [])];
    }
    const mappings = fromCur === "antiga"
        ? EQUIVALENCE_DATA.antigaParaNova
        : EQUIVALENCE_DATA.novaParaAntiga;

    const mapDict = new Map();
    mappings.forEach(m => {
        if (m.equivalente && m.destino?.id) {
            mapDict.set(m.origem.id, m.destino.id);
        }
    });

    const targetPassed = new Set();
    passedList.forEach(id => {
        const targetId = mapDict.get(id);
        if (targetId) targetPassed.add(targetId);
    });

    return [...targetPassed];
}

/**
 * Filtra a lista de equivalência com base nos critérios de busca e status.
 */
export function filterEquivalence(list, { search = "", status = "all", sem = "all", passed = new Set() } = {}) {
    const q = search.trim().toLowerCase();
    return list.filter(item => {
        // Filtro de texto
        if (q) {
            const oId = (item.origem?.id || "").toLowerCase();
            const oName = (item.origem?.name || "").toLowerCase();
            const dId = (item.destino?.id || "").toLowerCase();
            const dName = (item.destino?.name || "").toLowerCase();
            const matchText = oId.includes(q) || oName.includes(q) || dId.includes(q) || dName.includes(q);
            if (!matchText) return false;
        }

        // Filtro de semestre
        if (sem !== "all") {
            if (sem === "el") {
                if (item.origem.sem < 9) return false;
            } else {
                if (String(item.origem.sem) !== String(sem)) return false;
            }
        }

        // Filtro de status
        const isPassed = passed.has(item.origem.id);
        if (status === "equiv" && !item.equivalente) return false;
        if (status === "no_equiv" && item.equivalente) return false;
        if (status === "passed" && !isPassed) return false;

        return true;
    });
}

/**
 * Calcula estatísticas de aproveitamento com base na lista e no conjunto de aprovadas.
 */
export function calcEquivalenceStats(list, passed) {
    const total = list.length;
    const equivalentes = list.filter(i => i.equivalente).length;
    const semCorrespondencia = total - equivalentes;

    let aproveitadasCount = 0;
    let aproveitadasHoras = 0;
    let perdidasCount = 0;
    let perdidasHoras = 0;

    list.forEach(i => {
        if (passed.has(i.origem.id)) {
            if (i.equivalente && i.destino) {
                aproveitadasCount++;
                aproveitadasHoras += i.destino.h || 0;
            } else {
                perdidasCount++;
                perdidasHoras += i.origem.h || 0;
            }
        }
    });

    return {
        total,
        equivalentes,
        semCorrespondencia,
        aproveitadasCount,
        aproveitadasHoras: Math.round(aproveitadasHoras * 10) / 10,
        perdidasCount,
        perdidasHoras: Math.round(perdidasHoras * 10) / 10
    };
}

/**
 * Renderiza a aba de equivalência curricular (tabela, KPIs, notas informativas).
 */
export function renderEquivalence() {
    const body = $("equivBody");
    const kpisEl = $("equivKpis");
    if (!body || !kpisEl) return;

    const dirEl = $("equivDir");
    const searchEl = $("equivSearch");
    const statusEl = $("equivFilterStatus");
    const semEl = $("equivFilterSem");
    const pedNote = $("equivPedNote");
    const thOrigem = $("thOrigem");
    const thDestino = $("thDestino");

    const direction = dirEl ? dirEl.value : "antiga_para_nova";
    const isAntigaParaNova = direction === "antiga_para_nova";

    if (thOrigem) thOrigem.textContent = isAntigaParaNova ? "Disciplina Origem (PPC 2018)" : "Disciplina Origem (PPC 2022/2023)";
    if (thDestino) thDestino.textContent = isAntigaParaNova ? "Disciplina Equivalente (PPC 2023)" : "Disciplina Equivalente (PPC 2018)";

    if (pedNote) {
        pedNote.style.display = KEY === "pedagogia" ? "block" : "none";
    }

    const fullList = isAntigaParaNova
        ? EQUIVALENCE_DATA.antigaParaNova
        : EQUIVALENCE_DATA.novaParaAntiga;

    const P = passedSet();
    const stats = calcEquivalenceStats(fullList, P);

    // Renderiza KPIs
    const aproveitadasHtml = stats.aproveitadasCount > 0
        ? `<div class="kpi" style="border-left:3px solid var(--acc)"><div class="v" style="color:var(--acc)">${esc(stats.aproveitadasCount)}</div><div class="k">Aproveitadas por você (${esc(stats.aproveitadasHoras)}h)</div></div>`
        : "";

    const perdidasHtml = stats.perdidasCount > 0
        ? `<div class="kpi" style="border-left:3px solid #ef4444"><div class="v" style="color:#ef4444">${esc(stats.perdidasCount)}</div><div class="k">Sem equivalência feitas (${esc(stats.perdidasHoras)}h)</div></div>`
        : "";

    kpisEl.innerHTML =
        `<div class="kpi"><div class="v">${esc(stats.total)}</div><div class="k">Disciplinas da Grade</div></div>` +
        `<div class="kpi" style="border-left:3px solid #10b981"><div class="v" style="color:#10b981">${esc(stats.equivalentes)}</div><div class="k">Com Equivalência Direta</div></div>` +
        `<div class="kpi" style="border-left:3px solid #f59e0b"><div class="v" style="color:#f59e0b">${esc(stats.semCorrespondencia)}</div><div class="k">Sem Correspondência</div></div>` +
        aproveitadasHtml +
        perdidasHtml;

    // Filtra itens para a tabela
    const filtered = filterEquivalence(fullList, {
        search: searchEl ? searchEl.value : "",
        status: statusEl ? statusEl.value : "all",
        sem: semEl ? semEl.value : "all",
        passed: P
    });

    if (filtered.length === 0) {
        body.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--mut)">Nenhuma disciplina encontrada para os filtros selecionados.</td></tr>`;
        return;
    }

    body.innerHTML = filtered.map(item => {
        const isPassed = P.has(item.origem.id);
        const passBadge = isPassed
            ? ` <span class="tag g" title="Disciplina já concluída no seu planejamento">✓ Concluída</span>`
            : "";

        const semLabel = item.origem.sem <= 8
            ? `${esc(item.origem.sem)}º sem`
            : (item.origem.sem === 9 ? "Eletiva" : (item.origem.sem === 10 ? "Optativa" : "TCC"));

        let statusBadge;
        if (item.equivalente && item.destino) {
            const hDiff = Math.abs(item.origem.h - item.destino.h);
            if (hDiff > 5) {
                statusBadge = `<span class="tag y" title="Equivalente com carga horária ajustada">ℹ️ C.H. Ajustada</span>`;
            } else {
                statusBadge = `<span class="tag g" title="Equivalência direta aceita pelo IFSP">✓ Equivalente</span>`;
            }
        } else {
            statusBadge = `<span class="tag r" title="Componente sem equivalência. Deve ser cursado caso migre de grade.">⚠️ Sem Equivalência</span>`;
        }

        let destHtml;
        let destSemHtml = "—";
        let destHHtml = "—";
        if (item.destino) {
            const destSem = item.destino.sem <= 8
                ? `${esc(item.destino.sem)}º sem`
                : (item.destino.sem === 9 ? "Eletiva" : (item.destino.sem === 10 ? "Optativa" : "TCC"));
            destHtml = `<b>${esc(item.destino.name)}</b> <span class="note">(${esc(item.destino.id)})</span>`;
            destSemHtml = esc(destSem);
            destHHtml = `${esc(item.destino.h)}h`;
        } else {
            destHtml = `<span style="color:var(--mut)">Sem correspondência no PPC</span>`;
        }

        // Outros cursos
        const outrosArr = (item.outrosCursos || []).map(o =>
            `<span class="tag b" title="${esc(o.name)} · ${esc(o.code)}">${esc(o.curso)}: ${esc(o.code)} (${esc(o.h)}h)</span>`
        );
        if (item.obs) {
            outrosArr.push(`<div class="note" style="margin-top:2px">${esc(item.obs)}</div>`);
        }
        const outrosHtml = outrosArr.join(" ") || "<span style=\"color:var(--mut)\">—</span>";

        return (
            `<tr>` +
                `<td><b>${esc(item.origem.name)}</b> <span class="note">(${esc(item.origem.id)})</span>${passBadge}</td>` +
                `<td style="text-align:center">${esc(semLabel)}</td>` +
                `<td style="text-align:center">${esc(item.origem.h)}h</td>` +
                `<td style="text-align:center">${statusBadge}</td>` +
                `<td>${destHtml}</td>` +
                `<td style="text-align:center">${destSemHtml}</td>` +
                `<td style="text-align:center">${destHHtml}</td>` +
                `<td>${outrosHtml}</td>` +
            `</tr>`
        );
    }).join("");
}

/**
 * Inicializa os controles de eventos da aba de equivalência.
 */
export function initEquivalenceUI() {
    const dirEl = $("equivDir");
    const searchEl = $("equivSearch");
    const statusEl = $("equivFilterStatus");
    const semEl = $("equivFilterSem");
    const btnApply = $("btnApplyEquiv");

    if (dirEl) {
        // Define a direção inicial coerente com o curso atual
        if (KEY === "antiga") dirEl.value = "antiga_para_nova";
        else if (KEY === "nova") dirEl.value = "nova_para_antiga";
        dirEl.onchange = () => renderEquivalence();
    }
    if (searchEl) searchEl.oninput = () => renderEquivalence();
    if (statusEl) statusEl.onchange = () => renderEquivalence();
    if (semEl) semEl.onchange = () => renderEquivalence();

    if (btnApply) {
        btnApply.onclick = () => {
            const isAntiga = KEY === "antiga";
            const targetCur = isAntiga ? "nova" : "antiga";
            const curName = isAntiga ? "PPC 2018 (Antiga)" : "PPC 2022/2023 (Nova)";
            const targetName = isAntiga ? "PPC 2022/2023 (Nova)" : "PPC 2018 (Antiga)";

            if (KEY === "pedagogia") {
                alert("A matriz de equivalência é exclusiva entre as grades de Ciência da Computação (PPC 2018 e PPC 2022/2023).");
                return;
            }

            const currentPassed = S.passed || [];
            const migratedPassed = migratePassedDisciplines(currentPassed, KEY, targetCur);

            const msg = `Simulação de Migração Curricular:\n\n` +
                `Grade Atual: ${curName} (${currentPassed.length} matérias concluídas)\n` +
                `Grade Destino: ${targetName} (${migratedPassed.length} matérias aproveitadas)\n\n` +
                `Deseja alternar para ${targetName} e aplicar as disciplinas equivalentes no seu planejamento?`;

            if (window.confirm(msg)) {
                persist();
                switchCourse(targetCur, { passed: migratedPassed });
                if (typeof history !== "undefined" && typeof history.replaceState === "function" &&
                    typeof location !== "undefined" && location.search) {
                    const url = new URL(location.href);
                    url.searchParams.delete("curso");
                    history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
                }
                updateCourseInfo();
                build();
                update();
                if (typeof window.showTab === "function") {
                    window.showTab("t-flow");
                }
                toast(`Grade alterada para ${targetName}! ${migratedPassed.length} disciplinas aproveitadas.`);
            }
        };
    }

    renderEquivalence();
}
