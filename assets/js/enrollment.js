/**
 * Módulo de Avaliação e Tomada de Decisão para Inscrição no Semestre (enrollment.js)
 *
 * Responsabilidades:
 * - Identificar matérias ofertadas por tipo de semestre (par, ímpar ou todos).
 * - Inibir a seleção de matérias já concluídas (S.passed) e sinalizar pré-requisitos pendentes.
 * - Detectar choques e conflitos de horários nos respectivos dias da semana.
 * - Avaliar qual matéria é melhor em caso de conflito com base em:
 *   1. Impacto direto no tempo de conclusão do curso (delta em semestres de formatura).
 *   2. Pré-requisitos (profundidade depth, dependentes desc e destravamento imediato).
 * - Montar grade semanal sugerida sem conflitos respeitando o limite maxLoad.
 * - Aplicar decisão diretamente em S.current ("Cursando agora") e S.hor.cells ("Horários").
 */

import {
    S,
    C,
    CUR,
    KEY,
    ORDER,
    DIAS,
    HORAS,
    depth,
    desc,
    esc,
    hasCourse,
    persist
} from "./state.js";
import { passedSet } from "./planner.js";
import { toast, confirma, update } from "./ui.js";

const $ = id => document.getElementById(id);

/**
 * Estado interno da tela de tomada de decisão de inscrição.
 */
export const ENROLL_STATE = {
    parity: "odd",
    offered: new Set(),
    slots: {},
    search: "",
    filterStatus: "all",
    lastCurKey: null
};

/**
 * Converte índice de período (0..4) e dia (0..4) em rótulo amigável (ex.: "Seg 07:10").
 */
export function formatSlotLabel(slotKey) {
    if (!slotKey || typeof slotKey !== "string") return "—";
    const [pStr, dStr] = slotKey.split("-");
    const p = parseInt(pStr, 10);
    const d = parseInt(dStr, 10);
    const dia = DIAS[d] || `Dia ${d}`;
    const hora = (HORAS[p] || "").split("/")[0] || `Horário ${p}`;
    return `${dia} ${hora}`;
}

/**
 * Gera deterministicamente horários padrão sem conflitos internos para um semestre,
 * simulando sobreposições realistas entre semestres diferentes.
 */
export function getDefaultCourseSlots(courseId, cur = CUR) {
    const raw = cur.raw || [];
    const item = raw.find(r => r[0] === courseId);
    if (!item) return ["0-0"];

    const sem = Number(item[2]) || 1;
    const aulas = Number(item[3]) || 2;
    const neededSlots = Math.max(1, Math.min(3, Math.round(aulas / 2)));

    // Agrupa disciplinas do mesmo semestre para ordenar seus horários
    const sameSem = raw.filter(r => Number(r[2]) === sem);
    const posInSem = sameSem.findIndex(r => r[0] === courseId);
    const idx = posInSem >= 0 ? posInSem : 0;

    const slots = [];
    const baseDay = (idx * 2) % 5;
    const basePeriod = (Math.floor((idx * 2) / 5) + (sem > 4 ? 2 : 0)) % 4;

    for (let s = 0; s < neededSlots; s++) {
        const d = (baseDay + s * 2) % 5;
        const p = (basePeriod + Math.floor((baseDay + s * 2) / 5)) % 5;
        slots.push(`${p}-${d}`);
    }

    return [...new Set(slots)];
}

/**
 * Retorna os slots de horário configurados para uma matéria, com fallback para o default.
 */
export function getCourseSlots(courseId) {
    if (ENROLL_STATE.slots[courseId] && ENROLL_STATE.slots[courseId].length > 0) {
        return ENROLL_STATE.slots[courseId];
    }
    return getDefaultCourseSlots(courseId);
}

/**
 * Simula de forma determinística a conclusão do curso com ou sem adiamento de uma disciplina,
 * medindo o impacto direto no número de semestres até a formatura (deltaTerms).
 */
export function calcGraduationImpact(courseId, passed = passedSet(), options = {}) {
    const maxLoad = options.maxLoad || S.maxLoad || 9;
    const respectParity = options.respectParity !== undefined ? options.respectParity : S.respectParity;

    function runSim(deferId = null) {
        const pSet = new Set(passed);
        const pending = new Set(
            ORDER.filter(id => {
                const c = C[id];
                if (pSet.has(id)) return false;
                return c.kind === "ob" || c.kind === "tcc" || c.kind === "es";
            })
        );

        let k = 0;
        while (pending.size > 0 && k < 40) {
            const par = ((k % 2) === 0 ? 1 : 2);
            const cands = [];

            for (const cid of pending) {
                if (k === 0 && cid === deferId) continue;
                const c = C[cid];
                if (!c.pre.every(p => pSet.has(p))) continue;
                if (respectParity && (c.kind === "ob" || c.kind === "tcc" || c.kind === "es")) {
                    const expectedPar = (c.sem % 2 !== 0) ? 1 : 2;
                    if (expectedPar !== par) continue;
                }
                cands.push(cid);
            }

            cands.sort((a, b) => (depth[b] || 0) - (depth[a] || 0) || C[a].sem - C[b].sem);
            const take = cands.slice(0, maxLoad);

            if (take.length === 0 && pending.size > 0) {
                // Avança semestre sem ofertas elegíveis
                k++;
                continue;
            }

            take.forEach(cid => {
                pending.delete(cid);
                pSet.add(cid);
            });
            k++;
        }
        return k;
    }

    const normalTerms = runSim(null);
    const deferredTerms = runSim(courseId);
    const deltaTerms = Math.max(0, deferredTerms - normalTerms);

    return { deltaTerms, normalTerms, deferredTerms };
}

/**
 * Calcula a pontuação e os critérios de decisão de inscrição para uma matéria.
 */
export function calcCourseDecisionScore(courseId, passed = passedSet(), options = {}) {
    const c = C[courseId];
    if (!c) {
        return {
            id: courseId,
            score: 0,
            isPassed: false,
            isEligible: false,
            missingPre: [],
            deltaTerms: 0,
            depthVal: 0,
            descCount: 0,
            directUnlocks: [],
            reasons: ["Disciplina inexistente no catálogo"]
        };
    }

    const isPassed = passed.has(courseId);
    const missingPre = c.pre.filter(p => !passed.has(p));
    const isEligible = !isPassed && missingPre.length === 0;

    if (isPassed) {
        return {
            id: courseId,
            c,
            score: 0,
            isPassed: true,
            isEligible: false,
            missingPre: [],
            deltaTerms: 0,
            depthVal: depth[courseId] || 1,
            descCount: desc(courseId).size,
            directUnlocks: [],
            reasons: ["Matéria já concluída com aproveitamento"]
        };
    }

    if (!isEligible) {
        return {
            id: courseId,
            c,
            score: 0,
            isPassed: false,
            isEligible: false,
            missingPre,
            deltaTerms: 0,
            depthVal: depth[courseId] || 1,
            descCount: desc(courseId).size,
            directUnlocks: [],
            reasons: [`Pré-requisitos pendentes: ${missingPre.join(", ")}`]
        };
    }

    const depthVal = depth[courseId] || 1;
    const descSet = desc(courseId);
    const descCount = descSet.size;
    const directKids = c.kids || [];
    const directUnlocks = directKids.filter(k =>
        C[k] && C[k].pre.every(p => p === courseId || passed.has(p))
    );

    const { deltaTerms } = calcGraduationImpact(courseId, passed, options);

    let score = 0;
    const reasons = [];

    // 1. Impacto no tempo de formatura (peso máximo)
    if (deltaTerms > 0) {
        score += deltaTerms * 160;
        reasons.push(
            `Impacto no prazo: atrasa a formatura em +${deltaTerms} semestre(s) se adiada (+${deltaTerms * 160} pts)`
        );
    } else {
        reasons.push("Sem impacto direto na data final de formatura");
    }

    // 2. Profundidade no caminho crítico
    score += depthVal * 20;
    reasons.push(`Caminho crítico: profundidade ${depthVal} até a formatura (+${depthVal * 20} pts)`);

    // 3. Destravamento imediato de matérias no semestre seguinte
    if (directUnlocks.length > 0) {
        const unlockBonus = directUnlocks.length * 35;
        score += unlockBonus;
        reasons.push(
            `Destrava no próximo semestre: ${directUnlocks.join(", ")} (+${unlockBonus} pts)`
        );
    }

    // 4. Volume total de disciplinas dependentes a jusante
    if (descCount > 0) {
        const descBonus = descCount * 8;
        score += descBonus;
        reasons.push(`Cadeia de dependentes: ${descCount} matéria(s) a jusante (+${descBonus} pts)`);
    }

    // 5. Tipo de disciplina e regularização de atraso
    if (c.kind === "ob") {
        score += 40;
        reasons.push("Disciplina obrigatória (+40 pts)");
    } else if (c.kind === "tcc" || c.kind === "es") {
        score += 60;
        reasons.push("Marco de conclusão / TCC / Estágio (+60 pts)");
    } else {
        score += 15;
        reasons.push("Eletiva ou optativa (+15 pts)");
    }

    return {
        id: courseId,
        c,
        score,
        isPassed: false,
        isEligible: true,
        missingPre: [],
        deltaTerms,
        depthVal,
        descCount,
        directKids,
        directUnlocks,
        reasons
    };
}

/**
 * Detecta conflitos de horário entre as matérias candidatas e resolve cada choque
 * apontando a matéria vencedora e a justificativa comparativa.
 */
export function analyzeConflicts(candidates, slotsMap = {}) {
    const slotToCourses = {};
    candidates.forEach(cand => {
        const slots = slotsMap[cand.id] || getCourseSlots(cand.id);
        slots.forEach(slotKey => {
            if (!slotToCourses[slotKey]) slotToCourses[slotKey] = [];
            slotToCourses[slotKey].push(cand);
        });
    });

    const conflicts = [];
    for (const [slotKey, list] of Object.entries(slotToCourses)) {
        if (list.length > 1) {
            // Ordena os conflitantes pelo score decrescente
            const sorted = [...list].sort((a, b) => b.score - a.score);
            const winner = sorted[0];
            const losers = sorted.slice(1);

            losers.forEach(loser => {
                const diffPts = winner.score - loser.score;
                let reason = "";

                if (winner.deltaTerms > loser.deltaTerms) {
                    reason = `${winner.id} evita atraso de +${winner.deltaTerms} semestre(s) na formatura, enquanto ${loser.id} não impacta o prazo.`;
                } else if (winner.depthVal > loser.depthVal) {
                    reason = `${winner.id} está mais profunda no caminho crítico (prof. ${winner.depthVal} vs ${loser.depthVal}).`;
                } else if (winner.directUnlocks.length > loser.directUnlocks.length) {
                    reason = `${winner.id} destrava ${winner.directUnlocks.length} matéria(s) imediatamente, contra ${loser.directUnlocks.length} de ${loser.id}.`;
                } else if (winner.descCount > loser.descCount) {
                    reason = `${winner.id} possui mais dependentes no curso (${winner.descCount} vs ${loser.descCount}).`;
                } else {
                    reason = `${winner.id} possui pontuação acadêmica superior (+${diffPts} pts).`;
                }

                conflicts.push({
                    slotKey,
                    slotLabel: formatSlotLabel(slotKey),
                    winner,
                    loser,
                    diffPts,
                    reason
                });
            });
        }
    }

    return { slotToCourses, conflicts };
}

/**
 * Constrói a recomendação da melhor grade possível sem conflitos de horário
 * e respeitando a carga máxima do semestre (maxLoad).
 */
export function buildOptimalSchedule(candidateCourses, slotsMap = {}, maxLoad = S.maxLoad || 9) {
    const passed = passedSet();
    const scoredList = candidateCourses
        .map(cid => calcCourseDecisionScore(cid, passed))
        .filter(cand => cand.isEligible && !cand.isPassed)
        .sort((a, b) => b.score - a.score || a.c.sem - b.c.sem);

    const { conflicts } = analyzeConflicts(scoredList, slotsMap);

    const recommended = [];
    const deferred = [];
    const occupiedSlots = new Map(); // slotKey -> courseId
    const weeklyGrid = {};

    for (const cand of scoredList) {
        const slots = slotsMap[cand.id] || getCourseSlots(cand.id);

        if (recommended.length >= maxLoad) {
            deferred.push({
                ...cand,
                deferReason: `Limite máximo de matérias por semestre atingido (${maxLoad} disciplinas)`
            });
            continue;
        }

        // Verifica choque com as matérias já recomendadas
        let hasConflict = false;
        let conflictWith = null;
        let conflictingSlot = null;

        for (const slotKey of slots) {
            if (occupiedSlots.has(slotKey)) {
                hasConflict = true;
                conflictWith = occupiedSlots.get(slotKey);
                conflictingSlot = slotKey;
                break;
            }
        }

        if (hasConflict) {
            deferred.push({
                ...cand,
                deferReason: `Choque de horário no slot ${formatSlotLabel(conflictingSlot)} com a disciplina prioritária ${conflictWith}`
            });
        } else {
            recommended.push(cand);
            slots.forEach(slotKey => {
                occupiedSlots.set(slotKey, cand.id);
                weeklyGrid[slotKey] = cand.id;
            });
        }
    }

    const totalAulas = recommended.reduce((sum, item) => sum + (item.c.aulas || 0), 0);
    const totalHoras = recommended.reduce((sum, item) => sum + (item.c.h || 0), 0);
    const avoidedDelays = recommended.reduce((sum, item) => sum + (item.deltaTerms || 0), 0);

    return {
        recommended,
        deferred,
        conflicts,
        weeklyGrid,
        metrics: {
            recommendedCount: recommended.length,
            maxLoad,
            totalAulas,
            totalHoras: Math.round(totalHoras * 10) / 10,
            avoidedDelays,
            conflictsCount: conflicts.length
        }
    };
}

/**
 * Inicializa e sincroniza as ofertas do curso atual de acordo com a paridade selecionada.
 */
export function populateDefaultOfferings(parity = ENROLL_STATE.parity) {
    ENROLL_STATE.parity = parity;
    ENROLL_STATE.offered.clear();
    const passed = passedSet();

    ORDER.forEach(id => {
        const c = C[id];
        if (passed.has(id)) return; // Inibe seleção de matérias já concluídas

        if (parity === "all") {
            ENROLL_STATE.offered.add(id);
        } else if (parity === "odd") {
            if (c.kind === "ob" && c.sem % 2 !== 0) {
                ENROLL_STATE.offered.add(id);
            } else if (c.kind === "el" || c.kind === "op" || c.kind === "tcc" || c.kind === "es") {
                ENROLL_STATE.offered.add(id);
            }
        } else if (parity === "even") {
            if (c.kind === "ob" && c.sem % 2 === 0) {
                ENROLL_STATE.offered.add(id);
            } else if (c.kind === "el" || c.kind === "op" || c.kind === "tcc" || c.kind === "es") {
                ENROLL_STATE.offered.add(id);
            }
        }
    });
}

/**
 * Sincroniza os horários das matérias a partir da grade cadastrada em S.hor.cells.
 */
export function syncSlotsFromHor() {
    const H = S.hor.cells || {};
    const map = {};

    for (const [slotKey, cell] of Object.entries(H)) {
        if (cell && cell.id && hasCourse(cell.id)) {
            if (!map[cell.id]) map[cell.id] = [];
            map[cell.id].push(slotKey);
        }
    }

    let count = 0;
    for (const [cid, slots] of Object.entries(map)) {
        ENROLL_STATE.slots[cid] = [...new Set(slots)];
        count++;
    }

    return count;
}

/**
 * Aplica as matérias recomendadas diretamente à aba "Cursando agora" (S.current).
 */
export function applyEnrollmentToCurrent(recommendedList) {
    if (!Array.isArray(recommendedList) || recommendedList.length === 0) {
        toast("Nenhuma matéria recomendada para aplicar.");
        return;
    }

    const cur = S.current || [];
    const curIds = new Set(cur.map(r => r.id));
    let added = 0;

    recommendedList.forEach(item => {
        if (!curIds.has(item.id)) {
            const defPrev = (C[item.id].aulas || 4) * 19;
            cur.push({
                id: item.id,
                nota: 0,
                pts: 10,
                prev: defPrev,
                cum: 0,
                falt: 0,
                prio: "Auto",
                fase: "Consumindo",
                autoGrade: true
            });
            curIds.add(item.id);
            added++;
        }
    });

    S.current = cur;
    persist();
    update();
    toast(`✓ ${added} matéria(s) adicionada(s) a "Cursando agora"!`);
}

/**
 * Preenche a grade semanal da aba "Horários" (S.hor.cells) com a recomendação da semana.
 */
export function applyEnrollmentToSchedule(weeklyGrid) {
    const keys = Object.keys(weeklyGrid || {});
    if (keys.length === 0) {
        toast("Nenhuma grade gerada para aplicar aos Horários.");
        return;
    }

    if (!S.hor) S.hor = { cells: {} };
    if (!S.hor.cells) S.hor.cells = {};

    keys.forEach(slotKey => {
        const cid = weeklyGrid[slotKey];
        if (cid && hasCourse(cid)) {
            S.hor.cells[slotKey] = {
                id: cid,
                sala: (S.hor.cells[slotKey] && S.hor.cells[slotKey].sala) || ""
            };
        }
    });

    persist();
    update();
    toast(`✓ ${keys.length} horário(s) aplicados à aba Horários!`);
}

/**
 * Renderiza todo o conteúdo da aba "🎯 Inscrição".
 */
export function renderEnrollment() {
    const panel = $("t-enroll");
    if (!panel) return;

    if (ENROLL_STATE.lastCurKey !== KEY) {
        ENROLL_STATE.lastCurKey = KEY;
        populateDefaultOfferings(ENROLL_STATE.parity);
    }

    const passed = passedSet();
    const offeredIds = [...ENROLL_STATE.offered];
    const decision = buildOptimalSchedule(offeredIds, ENROLL_STATE.slots, S.maxLoad || 9);
    const recMap = new Map(decision.recommended.map(r => [r.id, r]));
    const defMap = new Map(decision.deferred.map(d => [d.id, d]));

    // 1. Renderiza KPIs
    const kpisEl = $("enrollKpis");
    if (kpisEl) {
        const kpisHtml =
            `<div class="kpis" style="margin-bottom:14px">` +
                `<div class="kpi">` +
                    `<b style="color:var(--ok)">${esc(decision.metrics.recommendedCount)} / ${esc(decision.metrics.maxLoad)}</b>` +
                    `<small>Matérias Recomendadas</small>` +
                    `<div class="note" style="margin-top:2px">${esc(decision.metrics.totalAulas)} aulas · ${esc(decision.metrics.totalHoras)} h</div>` +
                `</div>` +
                `<div class="kpi">` +
                    `<b style="color:var(--av)">${esc(decision.metrics.avoidedDelays > 0 ? "+" + decision.metrics.avoidedDelays + " sem." : "No Prazo")}</b>` +
                    `<small>Atrasos de Formatura Evitados</small>` +
                    `<div class="note" style="margin-top:2px">Priorização do caminho crítico</div>` +
                `</div>` +
                `<div class="kpi">` +
                    `<b style="color:${decision.metrics.conflictsCount > 0 ? "var(--warn)" : "var(--ok)"}">` +
                        `${esc(decision.metrics.conflictsCount)}` +
                    `</b>` +
                    `<small>Conflitos de Horário</small>` +
                    `<div class="note" style="margin-top:2px">${decision.metrics.conflictsCount > 0 ? "Choques analisados e resolvidos" : "Grade 100% livre de choques"}</div>` +
                `</div>` +
                `<div class="kpi">` +
                    `<b style="color:var(--acc)">${esc(ENROLL_STATE.offered.size)}</b>` +
                    `<small>Matérias no Pool de Oferta</small>` +
                    `<div class="note" style="margin-top:2px">Semestre ${esc(ENROLL_STATE.parity === "odd" ? "Ímpar" : ENROLL_STATE.parity === "even" ? "Par" : "Geral")}</div>` +
                `</div>` +
            `</div>`;
        kpisEl.innerHTML = kpisHtml;
    }

    // 2. Renderiza Painel de Conflitos e Justificativas
    const confWrap = $("enrollConflictsWrap");
    if (confWrap) {
        if (decision.conflicts.length === 0) {
            confWrap.innerHTML =
                `<div class="note" style="padding:10px 14px;background:rgba(34,197,94,0.1);border-left:3px solid var(--ok);border-radius:6px;display:flex;align-items:center;gap:8px">` +
                    `<span style="font-size:16px">✅</span>` +
                    `<div><b>Nenhum conflito de horário detectado:</b> Todas as disciplinas recomendadas possuem horários livres e compatíveis na semana.</div>` +
                `</div>`;
        } else {
            const conflictCardsHtml = decision.conflicts.map(conf =>
                `<div class="panel" style="margin-top:8px;padding:12px;background:var(--panel2,#1a2340);border-left:4px solid var(--warn)">` +
                    `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">` +
                        `<div>` +
                            `<span class="tag y" style="font-weight:700">⚠️ Choque de Horário: ${esc(conf.slotLabel)}</span> ` +
                            `<b>${esc(conf.winner.id)}</b> vs <b>${esc(conf.loser.id)}</b>` +
                        `</div>` +
                        `<span class="tag g" style="font-weight:700">🏆 Escolha do Sistema: ${esc(conf.winner.id)}</span>` +
                    `</div>` +
                    `<div class="note" style="margin-top:8px;color:var(--txt);line-height:1.45">` +
                        `💡 <b>Justificativa da decisão:</b> ${esc(conf.reason)} ` +
                        `(Score: <b>${esc(conf.winner.id)} = ${esc(conf.winner.score)} pts</b> vs <b>${esc(conf.loser.id)} = ${esc(conf.loser.score)} pts</b>).` +
                    `</div>` +
                `</div>`
            ).join("");

            confWrap.innerHTML =
                `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` +
                    `<h4 style="margin:0;color:var(--warn)">⚠️ Conflitos de Horário Identificados e Resolvidos (${esc(decision.conflicts.length)})</h4>` +
                `</div>` +
                conflictCardsHtml;
        }
    }

    // 3. Renderiza Grade Semanal Recomendada
    const schedBody = $("enrollScheduleBody");
    const schedNote = $("enrollScheduleNote");
    if (schedNote) {
        schedNote.textContent = `${decision.recommended.length} disciplina(s) alocadas sem conflito`;
    }
    if (schedBody) {
        schedBody.innerHTML = HORAS.map((h, i) =>
            `<tr><th>${esc(h)}</th>` +
            DIAS.map((_d, j) => {
                const slotKey = `${i}-${j}`;
                const cid = decision.weeklyGrid[slotKey];
                if (cid && C[cid]) {
                    const c = C[cid];
                    return (
                        `<td style="background:rgba(37,99,235,0.15);border:1px solid var(--av)">` +
                            `<div style="font-weight:700;color:var(--av)">${esc(cid)}</div>` +
                            `<div style="font-size:11px;color:var(--txt)">${esc(c.name)}</div>` +
                        `</td>`
                    );
                }
                return `<td style="opacity:0.4;text-align:center;color:var(--mut)">—</td>`;
            }).join("") +
            `</tr>`
        ).join("");
    }

    // 4. Renderiza Tabela Detalhada de Matérias Ofertadas
    const tableBody = $("enrollTableBody");
    if (tableBody) {
        const q = ENROLL_STATE.search.trim().toLowerCase();
        const fStatus = ENROLL_STATE.filterStatus;

        const rowsHtml = ORDER.map(cid => {
            const c = C[cid];
            const isPassed = passed.has(cid);
            const isOffered = ENROLL_STATE.offered.has(cid);
            const missingPre = c.pre.filter(p => !passed.has(p));
            const isEligible = !isPassed && missingPre.length === 0;

            const isRec = recMap.has(cid);
            const isDef = defMap.has(cid);
            const defItem = defMap.get(cid);

            // Filtro por texto
            if (q) {
                const match = cid.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                if (!match) return "";
            }

            // Filtro por status
            if (fStatus === "recommended" && !isRec) return "";
            if (fStatus === "conflict" && (!isDef || !defItem.deferReason.includes("Choque"))) return "";
            if (fStatus === "blocked" && (isPassed || isEligible)) return "";
            if (fStatus === "passed" && !isPassed) return "";

            // Monta slots
            const slots = getCourseSlots(cid);
            const slotChipsHtml = slots.map(s =>
                `<span class="tag b" style="font-size:11px">${esc(formatSlotLabel(s))}</span>`
            ).join(" ");

            // Badge de decisão
            let decisionBadgeHtml = "";
            if (isPassed) {
                decisionBadgeHtml = `<span class="tag g">✓ Já Concluída</span>`;
            } else if (!isEligible) {
                decisionBadgeHtml = `<span class="tag r">🔒 Bloqueada</span>`;
            } else if (isRec) {
                decisionBadgeHtml = `<span class="tag g" style="font-weight:700">🏆 Recomendada</span>`;
            } else if (isDef && defItem.deferReason.includes("Choque")) {
                decisionBadgeHtml = `<span class="tag y" title="${esc(defItem.deferReason)}">⚠️ Preterida (Choque)</span>`;
            } else if (isDef) {
                decisionBadgeHtml = `<span class="tag b" title="${esc(defItem.deferReason)}">⏸️ Carga Máxima</span>`;
            } else if (isOffered) {
                decisionBadgeHtml = `<span class="tag b">Disponível</span>`;
            } else {
                decisionBadgeHtml = `<span class="note">Não ofertada</span>`;
            }

            // Análise explicativa
            let analysisHtml = "";
            if (isPassed) {
                analysisHtml = `<span class="note">Disciplina concluída com aprovação no histórico.</span>`;
            } else if (!isEligible) {
                analysisHtml = `<span style="color:var(--warn)">Requisitos pendentes: <b>${esc(missingPre.join(", "))}</b></span>`;
            } else {
                const scoreObj = recMap.get(cid) || defMap.get(cid) || calcCourseDecisionScore(cid, passed);
                const delayTag = scoreObj.deltaTerms > 0
                    ? `<span class="tag r" style="font-size:11px">Atraso: +${esc(scoreObj.deltaTerms)} sem.</span> `
                    : "";
                const depthTag = `<span class="tag b" style="font-size:11px">Prof. ${esc(scoreObj.depthVal)}</span> `;
                const unlockTag = scoreObj.directUnlocks.length > 0
                    ? `<span class="tag g" style="font-size:11px">Destrava ${esc(scoreObj.directUnlocks.length)}</span> `
                    : "";
                const scoreTag = `<b style="color:var(--txt)">Score: ${esc(scoreObj.score)}</b>`;
                analysisHtml = `<div>${delayTag}${depthTag}${unlockTag}${scoreTag}</div>`;
                if (isDef && defItem.deferReason) {
                    analysisHtml += `<div class="note" style="margin-top:3px;color:var(--warn)">${esc(defItem.deferReason)}</div>`;
                }
            }

            // Checkbox: inibido/desabilitado se já foi concluída
            const chkDisabled = isPassed ? "disabled" : "";
            const chkChecked = (isOffered && !isPassed) ? "checked" : "";
            const rowClass = isPassed ? "style='opacity:0.55;background:rgba(255,255,255,0.02)'" : "";

            return (
                `<tr ${rowClass}>` +
                    `<td style="text-align:center">` +
                        `<input type="checkbox" data-enroll-cid="${esc(cid)}" ${chkChecked} ${chkDisabled} title="${isPassed ? "Matéria já concluída — inibida da análise" : "Marcar/desmarcar oferta da matéria"}">` +
                    `</td>` +
                    `<td><b>${esc(cid)}</b></td>` +
                    `<td>` +
                        `<div style="${isPassed ? "text-decoration:line-through" : ""}">${esc(c.name)}</div>` +
                    `</td>` +
                    `<td>${esc(c.sem)}º sem · ${esc(c.aulas)} a</td>` +
                    `<td>` +
                        `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">` +
                            `${slotChipsHtml}` +
                        `</div>` +
                    `</td>` +
                    `<td>${analysisHtml}</td>` +
                    `<td>${decisionBadgeHtml}</td>` +
                `</tr>`
            );
        }).join("");

        tableBody.innerHTML = rowsHtml;
    }
}

/**
 * Inicializa os botões, listeners e eventos da aba "🎯 Inscrição".
 */
export function initEnrollmentUI() {
    const btnParityOdd = $("btnParityOdd");
    const btnParityEven = $("btnParityEven");
    const btnParityAll = $("btnParityAll");

    function updateParityButtons() {
        if (btnParityOdd) btnParityOdd.classList.toggle("act", ENROLL_STATE.parity === "odd");
        if (btnParityEven) btnParityEven.classList.toggle("act", ENROLL_STATE.parity === "even");
        if (btnParityAll) btnParityAll.classList.toggle("act", ENROLL_STATE.parity === "all");
    }

    if (btnParityOdd) {
        btnParityOdd.onclick = () => {
            populateDefaultOfferings("odd");
            updateParityButtons();
            renderEnrollment();
        };
    }
    if (btnParityEven) {
        btnParityEven.onclick = () => {
            populateDefaultOfferings("even");
            updateParityButtons();
            renderEnrollment();
        };
    }
    if (btnParityAll) {
        btnParityAll.onclick = () => {
            populateDefaultOfferings("all");
            updateParityButtons();
            renderEnrollment();
        };
    }

    const btnLoad = $("btnLoadParityOfferings");
    if (btnLoad) {
        btnLoad.onclick = () => {
            populateDefaultOfferings(ENROLL_STATE.parity);
            renderEnrollment();
            toast(`✓ Ofertas de semestres ${ENROLL_STATE.parity === "odd" ? "ímpares" : ENROLL_STATE.parity === "even" ? "pares" : "gerais"} carregadas!`);
        };
    }

    const btnSyncSlots = $("btnSyncScheduleSlots");
    if (btnSyncSlots) {
        btnSyncSlots.onclick = () => {
            const count = syncSlotsFromHor();
            renderEnrollment();
            toast(`✓ ${count} matéria(s) sincronizadas da aba Horários!`);
        };
    }

    const btnClear = $("btnClearOfferings");
    if (btnClear) {
        btnClear.onclick = () => {
            ENROLL_STATE.offered.clear();
            renderEnrollment();
            toast("Seleção de ofertas limpa.");
        };
    }

    const searchInput = $("enrollSearch");
    if (searchInput) {
        searchInput.oninput = e => {
            ENROLL_STATE.search = e.target.value || "";
            renderEnrollment();
        };
    }

    const filterSel = $("enrollFilterStatus");
    if (filterSel) {
        filterSel.onchange = e => {
            ENROLL_STATE.filterStatus = e.target.value || "all";
            renderEnrollment();
        };
    }

    // Listener delegado para checkboxes na tabela
    const tableBody = $("enrollTableBody");
    if (tableBody) {
        tableBody.onchange = e => {
            const chk = e.target.closest("input[data-enroll-cid]");
            if (chk) {
                const cid = chk.dataset.enrollCid;
                if (chk.checked) {
                    ENROLL_STATE.offered.add(cid);
                } else {
                    ENROLL_STATE.offered.delete(cid);
                }
                renderEnrollment();
            }
        };
    }

    // Botões de aplicação
    const btnCur = $("btnApplyEnrollCurrent");
    if (btnCur) {
        btnCur.onclick = () => {
            const decision = buildOptimalSchedule([...ENROLL_STATE.offered], ENROLL_STATE.slots, S.maxLoad || 9);
            confirma(btnCur, "Confirmar inscrição?", () => {
                applyEnrollmentToCurrent(decision.recommended);
            });
        };
    }

    const btnSched = $("btnApplyEnrollSchedule");
    if (btnSched) {
        btnSched.onclick = () => {
            const decision = buildOptimalSchedule([...ENROLL_STATE.offered], ENROLL_STATE.slots, S.maxLoad || 9);
            confirma(btnSched, "Preencher grade semanal?", () => {
                applyEnrollmentToSchedule(decision.weeklyGrid);
            });
        };
    }

    populateDefaultOfferings(ENROLL_STATE.parity);
    updateParityButtons();
}
