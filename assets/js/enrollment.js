/**
 * Módulo de Avaliação e Tomada de Decisão para Inscrição no Semestre (enrollment.js)
 *
 * Responsabilidades:
 * - Renderizar 4 semanas de oferta de acordo com o próximo semestre letivo configurado (startHalf):
 *   - Ímpar (startHalf = 1): 1º, 3º, 5º e 7º Semestres.
 *   - Par (startHalf = 2): 2º, 4º, 6º e 8º Semestres.
 * - Permitir cadastro interativo das aulas ofertadas pelo campus em cada semana de semestre.
 * - Desconsiderar disciplinas já concluídas (S.passed) e verificar pré-requisitos pendentes.
 * - Detectar conflitos reais de horário entre matérias de diferentes semestres.
 * - Otimizar a grade priorizando a MAIOR QUANTIDADE de matérias possíveis sem conflitos.
 * - Desempatar por impacto na formatura (deltaTerms), caminho crítico (depth) e dependentes.
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
 * Estado reativo da interface de tomada de decisão de inscrição.
 */
export const ENROLL_STATE = {
    activeSem: 1,
    search: "",
    filterStatus: "all",
    parity: "odd",
    offered: new Set(),
    slots: {},
    lastCurKey: null,
    lastStartHalf: null
};

/**
 * Retorna a lista dos 4 semestres ofertados com base no semestre letivo (1 = ímpar, 2 = par).
 */
export function getOfferedSemesters(startHalf = S.startHalf) {
    return +startHalf === 2 ? [2, 4, 6, 8] : [1, 3, 5, 7];
}

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
 * Gera deterministicamente horários padrão sem conflitos internos para um semestre.
 */
export function getDefaultCourseSlots(courseId, cur = CUR) {
    const raw = cur.raw || [];
    const item = raw.find(r => r[0] === courseId);
    if (!item) return ["0-0"];

    const sem = Number(item[2]) || 1;
    const aulas = Number(item[3]) || 2;
    const neededSlots = Math.max(1, Math.min(3, Math.round(aulas / 2)));

    const sameSem = raw.filter(r => Number(r[2]) === sem);
    const posInSem = sameSem.findIndex(r => r[0] === courseId);
    const idx = posInSem >= 0 ? posInSem : 0;

    let offset = 0;
    for (let i = 0; i < idx; i++) {
        const a = Number(sameSem[i][3]) || 2;
        offset += Math.max(1, Math.min(3, Math.round(a / 2)));
    }

    const semBasePeriod = (sem > 4 ? 2 : 0);
    const slots = [];
    for (let s = 0; s < neededSlots; s++) {
        const k = offset + s;
        const d = k % 5;
        const p = (semBasePeriod + Math.floor(k / 5)) % 5;
        slots.push(`${p}-${d}`);
    }

    return [...new Set(slots)];
}

/**
 * Preenche deterministicamente as grades de horários das 4 semanas de oferta.
 */
export function populateDefaultSemesterOffers(semesters = getOfferedSemesters(), cur = CUR) {
    if (!S.enrollOffers) S.enrollOffers = {};
    semesters.forEach(sem => {
        S.enrollOffers[sem] = {};
        const sameSem = (cur.raw || []).filter(r => Number(r[2]) === sem);
        sameSem.forEach(r => {
            const cid = r[0];
            const sls = getDefaultCourseSlots(cid, cur);
            sls.forEach(s => {
                S.enrollOffers[sem][s] = cid;
            });
        });
    });
}

/**
 * Retorna o mapa de matérias e seus respectivos slots cadastrados nas 4 semanas de oferta.
 */
export function getAllOfferedCoursesFromOffers(offers = S.enrollOffers, targetSemesters = getOfferedSemesters()) {
    const slotsByCourse = {};
    if (!offers || typeof offers !== "object") return slotsByCourse;

    targetSemesters.forEach(sem => {
        const semGrid = offers[sem] || {};
        for (const [slotKey, cid] of Object.entries(semGrid)) {
            if (cid && hasCourse(cid)) {
                if (!slotsByCourse[cid]) slotsByCourse[cid] = [];
                if (!slotsByCourse[cid].includes(slotKey)) {
                    slotsByCourse[cid].push(slotKey);
                }
            }
        }
    });

    return slotsByCourse;
}

/**
 * Retorna os slots de horário configurados para uma matéria.
 */
export function getCourseSlots(courseId) {
    if (ENROLL_STATE.slots[courseId] && ENROLL_STATE.slots[courseId].length > 0) {
        return ENROLL_STATE.slots[courseId];
    }
    const fromOffers = getAllOfferedCoursesFromOffers();
    if (fromOffers[courseId] && fromOffers[courseId].length > 0) {
        return fromOffers[courseId];
    }
    return getDefaultCourseSlots(courseId);
}

/**
 * Simula determinística de conclusão do curso com ou sem adiamento de uma disciplina.
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
            reasons: ["Matéria já concluída no histórico escolar"]
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

    if (deltaTerms > 0) {
        score += deltaTerms * 160;
        reasons.push(`Atrasa a formatura em +${deltaTerms} sem. se adiada (+${deltaTerms * 160} pts)`);
    } else {
        reasons.push("Sem impacto direto na data final de formatura");
    }

    score += depthVal * 20;
    reasons.push(`Caminho crítico: profundidade ${depthVal} (+${depthVal * 20} pts)`);

    if (directUnlocks.length > 0) {
        const unlockBonus = directUnlocks.length * 35;
        score += unlockBonus;
        reasons.push(`Destrava no próximo semestre: ${directUnlocks.join(", ")} (+${unlockBonus} pts)`);
    }

    if (descCount > 0) {
        const descBonus = descCount * 8;
        score += descBonus;
        reasons.push(`Cadeia a jusante: ${descCount} matéria(s) (+${descBonus} pts)`);
    }

    if (c.kind === "ob") {
        score += 40;
        reasons.push("Disciplina obrigatória (+40 pts)");
    } else if (c.kind === "tcc" || c.kind === "es") {
        score += 60;
        reasons.push("TCC ou Estágio (+60 pts)");
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
 * Algoritmo exato de busca e otimização para encontrar a combinação de matérias sem choques:
 * 1. Prioriza ESTRITAMENTE a MAIOR QUANTIDADE de matérias possíveis (|M|).
 * 2. Em caso de empate na quantidade, desempata pela maior soma de pontuação acadêmica.
 */
export function findMaxCoursesSchedule(eligibleCids, slotsByCourse, maxLoad, scoreMap) {
    const sorted = [...eligibleCids].sort((a, b) => (scoreMap[b] || 0) - (scoreMap[a] || 0));
    let bestSubset = [];
    let bestCount = 0;
    let bestScore = -1;

    function search(index, currentSubset, occupiedSlots, currentScore) {
        const remaining = sorted.length - index;
        if (currentSubset.length + remaining < bestCount) return;

        if (currentSubset.length >= maxLoad || index === sorted.length) {
            if (
                currentSubset.length > bestCount ||
                (currentSubset.length === bestCount && currentScore > bestScore)
            ) {
                bestCount = currentSubset.length;
                bestScore = currentScore;
                bestSubset = [...currentSubset];
            }
            return;
        }

        const cand = sorted[index];
        const cSlots = slotsByCourse[cand] || [];
        const hasConflict = cSlots.some(s => occupiedSlots.has(s));

        if (!hasConflict && currentSubset.length < maxLoad) {
            cSlots.forEach(s => occupiedSlots.add(s));
            currentSubset.push(cand);
            search(index + 1, currentSubset, occupiedSlots, currentScore + (scoreMap[cand] || 0));
            currentSubset.pop();
            cSlots.forEach(s => occupiedSlots.delete(s));
        }

        search(index + 1, currentSubset, occupiedSlots, currentScore);
    }

    search(0, [], new Set(), 0);
    return bestSubset;
}

/**
 * Detecta conflitos de horário entre as matérias candidatas.
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
            const sorted = [...list].sort((a, b) => b.score - a.score);
            const winner = sorted[0];
            const losers = sorted.slice(1);

            losers.forEach(loser => {
                const diffPts = winner.score - loser.score;
                let reason = "";

                if (winner.deltaTerms > loser.deltaTerms) {
                    reason = `${winner.id} evita atraso de +${winner.deltaTerms} sem. na formatura, enquanto ${loser.id} não impacta o prazo.`;
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
 * Constrói a recomendação da melhor grade possível sem conflitos de horário,
 * maximizando a quantidade de matérias cursáveis e respeitando maxLoad.
 */
export function buildOptimalSchedule(candidateCourses = null, slotsMap = {}, maxLoad = S.maxLoad || 9) {
    const passed = passedSet();
    const offeredSemesters = getOfferedSemesters();
    const offersSlots = getAllOfferedCoursesFromOffers(S.enrollOffers, offeredSemesters);

    let courseIds = [];
    const isCustomCandidates = candidateCourses && Array.isArray(candidateCourses) && candidateCourses.length > 0;
    if (isCustomCandidates) {
        courseIds = [...new Set(candidateCourses)];
    } else {
        const fromOffers = Object.keys(offersSlots);
        if (fromOffers.length > 0) {
            courseIds = fromOffers;
        } else {
            courseIds = ORDER.filter(id => {
                const c = C[id];
                return offeredSemesters.includes(c.sem) || c.kind === "el" || c.kind === "op";
            });
        }
    }

    const effectiveSlotsMap = {};
    courseIds.forEach(cid => {
        if (slotsMap && slotsMap[cid] && slotsMap[cid].length > 0) {
            effectiveSlotsMap[cid] = slotsMap[cid];
        } else if (!isCustomCandidates && offersSlots[cid] && offersSlots[cid].length > 0) {
            effectiveSlotsMap[cid] = offersSlots[cid];
        } else {
            effectiveSlotsMap[cid] = getDefaultCourseSlots(cid);
        }
    });

    const evaluatedList = courseIds.map(cid => calcCourseDecisionScore(cid, passed));
    const scoreMap = {};
    evaluatedList.forEach(item => { scoreMap[item.id] = item.score; });

    const eligibleList = evaluatedList.filter(cand => cand.isEligible && !cand.isPassed);
    const eligibleCids = eligibleList.map(item => item.id);

    const optimalCids = findMaxCoursesSchedule(
        eligibleCids,
        effectiveSlotsMap,
        maxLoad,
        scoreMap
    );

    const optimalSet = new Set(optimalCids);
    const recommended = eligibleList.filter(item => optimalSet.has(item.id));
    const weeklyGrid = {};
    const occupiedSlots = new Map();

    recommended.forEach(item => {
        const slots = effectiveSlotsMap[item.id] || [];
        slots.forEach(slotKey => {
            occupiedSlots.set(slotKey, item.id);
            weeklyGrid[slotKey] = item.id;
        });
    });

    const deferred = [];
    eligibleList.forEach(item => {
        if (!optimalSet.has(item.id)) {
            const slots = effectiveSlotsMap[item.id] || [];
            let conflictSlot = null;
            let conflictWith = null;

            for (const s of slots) {
                if (occupiedSlots.has(s)) {
                    conflictSlot = s;
                    conflictWith = occupiedSlots.get(s);
                    break;
                }
            }

            let deferReason = "";
            if (conflictWith) {
                deferReason = `Choque de horário no slot ${formatSlotLabel(conflictSlot)} com a disciplina selecionada ${conflictWith}`;
            } else if (recommended.length >= maxLoad) {
                deferReason = `Limite máximo de matérias por semestre atingido (${maxLoad} disciplinas)`;
            } else {
                deferReason = "Não incluída na combinação ótima de horários";
            }

            deferred.push({
                ...item,
                deferReason,
                conflictWith,
                conflictSlot
            });
        }
    });

    const { conflicts } = analyzeConflicts(eligibleList, effectiveSlotsMap);

    const totalAulas = recommended.reduce((sum, item) => sum + (item.c.aulas || 0), 0);
    const totalHoras = recommended.reduce((sum, item) => sum + (item.c.h || 0), 0);
    const avoidedDelays = recommended.reduce((sum, item) => sum + (item.deltaTerms || 0), 0);

    return {
        recommended,
        deferred,
        conflicts,
        weeklyGrid,
        effectiveSlotsMap,
        metrics: {
            recommendedCount: recommended.length,
            maxLoad,
            totalAulas,
            totalHoras: Math.round(totalHoras * 10) / 10,
            avoidedDelays,
            conflictsCount: conflicts.length,
            totalOfferedCount: courseIds.length
        }
    };
}

/**
 * Inicializa e sincroniza as ofertas do curso atual de acordo com a paridade selecionada.
 * Mantido para paridade com suítes de testes automatizados e seleções rápidas.
 */
export function populateDefaultOfferings(parity = ENROLL_STATE.parity) {
    ENROLL_STATE.parity = parity;
    ENROLL_STATE.offered.clear();
    const passed = passedSet();

    if (parity === "odd") {
        S.startHalf = 1;
    } else if (parity === "even") {
        S.startHalf = 2;
    }

    const sems = parity === "odd" ? [1, 3, 5, 7] : parity === "even" ? [2, 4, 6, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
    populateDefaultSemesterOffers(sems);

    ORDER.forEach(id => {
        const c = C[id];
        if (passed.has(id)) return;

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

    const offeredSemesters = getOfferedSemesters();
    if (!S.enrollOffers) S.enrollOffers = {};

    // Inicializa ofertas padrão se o curso foi alternado ou se o startHalf mudou
    const needDefaultOffers = ENROLL_STATE.lastCurKey !== KEY ||
        ENROLL_STATE.lastStartHalf !== S.startHalf ||
        offeredSemesters.every(sem => !S.enrollOffers[sem] || Object.keys(S.enrollOffers[sem]).length === 0);

    if (needDefaultOffers) {
        ENROLL_STATE.lastCurKey = KEY;
        ENROLL_STATE.lastStartHalf = S.startHalf;
        populateDefaultSemesterOffers(offeredSemesters);
    }

    if (!offeredSemesters.includes(ENROLL_STATE.activeSem)) {
        ENROLL_STATE.activeSem = offeredSemesters[0];
    }

    // 1. Atualiza Tag do Semestre Alvo
    const halfTag = $("enrollCurrentHalfTag");
    if (halfTag) {
        const isOdd = +S.startHalf === 1;
        halfTag.textContent = isOdd
            ? "Ímpar (1º, 3º, 5º, 7º Semestres)"
            : "Par (2º, 4º, 6º, 8º Semestres)";
    }

    // 2. Renderiza Abas das 4 Semanas de Oferta
    const semTabsEl = $("enrollSemesterTabs");
    if (semTabsEl) {
        semTabsEl.innerHTML = offeredSemesters.map(sem => {
            const count = Object.keys(S.enrollOffers[sem] || {}).length;
            const isAct = sem === ENROLL_STATE.activeSem;
            return (
                `<button type="button" class="btn-sm enroll-sem-tab ${isAct ? "act" : ""}" data-sem="${esc(sem)}">` +
                    `<b>${esc(sem)}º Semestre</b> <span class="note" style="color:inherit">(${esc(count)} aulas)</span>` +
                `</button>`
            );
        }).join("");
    }

    // 3. Renderiza Título e Grade Interativa da Semana Selecionada
    const activeSemTitle = $("enrollActiveSemTitle");
    if (activeSemTitle) {
        activeSemTitle.textContent = `Grade de Horários Ofertados — ${ENROLL_STATE.activeSem}º Semestre`;
    }

    const inputTableBody = $("enrollInputScheduleBody");
    if (inputTableBody) {
        const curSemOffers = S.enrollOffers[ENROLL_STATE.activeSem] || {};
        const semCourses = ORDER.filter(id => C[id].sem === ENROLL_STATE.activeSem);
        const otherCourses = ORDER.filter(id => C[id].sem !== ENROLL_STATE.activeSem);

        const makeCourseOpt = (id, selId, showSem = false) => {
            const isSel = id === selId;
            if (isSel && showSem) {
                return `<option value="${esc(id)}" selected>${esc(id)} · ${esc(C[id].name)} (${esc(C[id].sem)}º sem)</option>`;
            }
            if (isSel) {
                return `<option value="${esc(id)}" selected>${esc(id)} · ${esc(C[id].name)}</option>`;
            }
            if (showSem) {
                return `<option value="${esc(id)}">${esc(id)} · ${esc(C[id].name)} (${esc(C[id].sem)}º sem)</option>`;
            }
            return `<option value="${esc(id)}">${esc(id)} · ${esc(C[id].name)}</option>`;
        };

        inputTableBody.innerHTML = HORAS.map((h, i) =>
            `<tr><th>${esc(h)}</th>` +
            DIAS.map((_d, j) => {
                const slotKey = `${i}-${j}`;
                const selId = curSemOffers[slotKey] || "";
                const optSemHtml = semCourses.map(id => makeCourseOpt(id, selId, false)).join("");
                const optOtherHtml = otherCourses.map(id => makeCourseOpt(id, selId, true)).join("");

                return (
                    `<td>` +
                        `<select class="enroll-slot-select" data-sem="${esc(ENROLL_STATE.activeSem)}" data-slot="${esc(slotKey)}" style="width:100%;font-size:12px">` +
                            `<option value="">— (Livre)</option>` +
                            `<optgroup label="Matérias do ${esc(ENROLL_STATE.activeSem)}º Semestre">` +
                                `${optSemHtml}` +
                            `</optgroup>` +
                            `<optgroup label="Outras Matérias / Eletivas">` +
                                `${optOtherHtml}` +
                            `</optgroup>` +
                        `</select>` +
                    `</td>`
                );
            }).join("") +
            `</tr>`
        ).join("");
    }

    // 4. Executa Análise Otimizada
    const decision = buildOptimalSchedule(null, ENROLL_STATE.slots, S.maxLoad || 9);
    const recMap = new Map(decision.recommended.map(r => [r.id, r]));
    const defMap = new Map(decision.deferred.map(d => [d.id, d]));
    const passed = passedSet();

    // 5. Renderiza KPIs da Decisão
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
                    `<small>Atrasos Evitados</small>` +
                    `<div class="note" style="margin-top:2px">Priorização do caminho crítico</div>` +
                `</div>` +
                `<div class="kpi">` +
                    `<b style="color:${decision.metrics.conflictsCount > 0 ? "var(--warn)" : "var(--ok)"}">` +
                        `${esc(decision.metrics.conflictsCount)}` +
                    `</b>` +
                    `<small>Conflitos Analisados</small>` +
                    `<div class="note" style="margin-top:2px">${decision.metrics.conflictsCount > 0 ? "Choques resolvidos sem sobreposição" : "Nenhum choque de horário"}</div>` +
                `</div>` +
                `<div class="kpi">` +
                    `<b style="color:var(--acc)">${esc(decision.metrics.totalOfferedCount)}</b>` +
                    `<small>Matérias Cadastradas</small>` +
                    `<div class="note" style="margin-top:2px">Distribuídas nas 4 semanas</div>` +
                `</div>` +
            `</div>`;
        kpisEl.innerHTML = kpisHtml;
    }

    // 6. Renderiza Conflitos e Justificativas
    const confWrap = $("enrollConflictsWrap");
    if (confWrap) {
        if (decision.conflicts.length === 0) {
            confWrap.innerHTML =
                `<div class="note" style="padding:10px 14px;background:rgba(34,197,94,0.1);border-left:3px solid var(--ok);border-radius:6px;display:flex;align-items:center;gap:8px">` +
                    `<span style="font-size:16px">✅</span>` +
                    `<div><b>Grade 100% Livre de Choques:</b> Todas as disciplinas recomendadas possuem horários compatíveis na semana.</div>` +
                `</div>`;
        } else {
            const conflictCardsHtml = decision.conflicts.map(conf =>
                `<div class="panel" style="margin-top:8px;padding:12px;background:var(--panel2,#1a2340);border-left:4px solid var(--warn)">` +
                    `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">` +
                        `<div>` +
                            `<span class="tag y" style="font-weight:700">⚠️ Choque: ${esc(conf.slotLabel)}</span> ` +
                            `<b>${esc(conf.winner.id)}</b> vs <b>${esc(conf.loser.id)}</b>` +
                        `</div>` +
                        `<span class="tag g" style="font-weight:700">🏆 Escolha do Sistema: ${esc(conf.winner.id)}</span>` +
                    `</div>` +
                    `<div class="note" style="margin-top:8px;color:var(--txt);line-height:1.45">` +
                        `💡 <b>Motivo:</b> ${esc(conf.reason)} ` +
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

    // 7. Renderiza Grade Semanal Sugerida (Sem Conflitos)
    const schedBody = $("enrollScheduleBody");
    const schedNote = $("enrollScheduleNote");
    if (schedNote) {
        schedNote.textContent = `${decision.recommended.length} disciplina(s) alocadas sem choque de horário`;
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

    // 8. Renderiza Tabela Detalhada com Filtros e Busca
    const tableBody = $("enrollTableBody");
    if (tableBody) {
        const q = ENROLL_STATE.search.trim().toLowerCase();
        const fStatus = ENROLL_STATE.filterStatus;
        const allOfferedMap = decision.effectiveSlotsMap || {};
        const allCids = Object.keys(allOfferedMap);

        const rowsHtml = allCids.map(cid => {
            const c = C[cid];
            if (!c) return "";
            const isPassed = passed.has(cid);
            const missingPre = c.pre.filter(p => !passed.has(p));
            const isEligible = !isPassed && missingPre.length === 0;

            const isRec = recMap.has(cid);
            const isDef = defMap.has(cid);
            const defItem = defMap.get(cid);

            if (q) {
                const match = cid.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                if (!match) return "";
            }

            if (fStatus === "recommended" && !isRec) return "";
            if (fStatus === "conflict" && (!isDef || !defItem.deferReason.includes("Choque"))) return "";
            if (fStatus === "blocked" && (isPassed || isEligible)) return "";
            if (fStatus === "passed" && !isPassed) return "";

            const slots = allOfferedMap[cid] || [];
            const slotChipsHtml = slots.length > 0
                ? slots.map(s => `<span class="tag b" style="font-size:11px">${esc(formatSlotLabel(s))}</span>`).join(" ")
                : "<span class='note'>Nenhum slot</span>";

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
            } else {
                decisionBadgeHtml = `<span class="tag b">Disponível</span>`;
            }

            let analysisHtml = "";
            if (isPassed) {
                analysisHtml = `<span class="note">Disciplina concluída com aprovação no histórico escolar (dispensada).</span>`;
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

            const rowClass = isPassed ? "style='opacity:0.6;background:rgba(255,255,255,0.02)'" : "";

            return (
                `<tr ${rowClass}>` +
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
    const semTabsEl = $("enrollSemesterTabs");
    if (semTabsEl) {
        semTabsEl.onclick = e => {
            const btn = e.target.closest("button.enroll-sem-tab");
            if (btn && btn.dataset.sem) {
                ENROLL_STATE.activeSem = parseInt(btn.dataset.sem, 10);
                renderEnrollment();
            }
        };
    }

    const inputTableBody = $("enrollInputScheduleBody");
    if (inputTableBody) {
        inputTableBody.onchange = e => {
            const sel = e.target.closest("select.enroll-slot-select");
            if (sel && sel.dataset.sem && sel.dataset.slot) {
                const sem = parseInt(sel.dataset.sem, 10);
                const slotKey = sel.dataset.slot;
                const cid = sel.value;

                if (!S.enrollOffers) S.enrollOffers = {};
                if (!S.enrollOffers[sem]) S.enrollOffers[sem] = {};

                if (cid) {
                    S.enrollOffers[sem][slotKey] = cid;
                } else {
                    delete S.enrollOffers[sem][slotKey];
                }

                persist();
                renderEnrollment();
            }
        };
    }

    const btnFillDefault = $("btnFillDefaultOffers");
    if (btnFillDefault) {
        btnFillDefault.onclick = () => {
            populateDefaultSemesterOffers();
            persist();
            renderEnrollment();
            toast("✓ Horários padrão preenchidos nas 4 semanas de oferta!");
        };
    }

    const btnClearOffers = $("btnClearOffers");
    if (btnClearOffers) {
        btnClearOffers.onclick = () => {
            const sems = getOfferedSemesters();
            if (!S.enrollOffers) S.enrollOffers = {};
            sems.forEach(s => { S.enrollOffers[s] = {}; });
            persist();
            renderEnrollment();
            toast("Semanas de oferta limpas.");
        };
    }

    const btnFillActive = $("btnFillActiveSemDefault");
    if (btnFillActive) {
        btnFillActive.onclick = () => {
            populateDefaultSemesterOffers([ENROLL_STATE.activeSem]);
            persist();
            renderEnrollment();
            toast(`✓ Horários do ${ENROLL_STATE.activeSem}º semestre preenchidos!`);
        };
    }

    const btnClearActive = $("btnClearActiveSem");
    if (btnClearActive) {
        btnClearActive.onclick = () => {
            if (S.enrollOffers && S.enrollOffers[ENROLL_STATE.activeSem]) {
                S.enrollOffers[ENROLL_STATE.activeSem] = {};
                persist();
                renderEnrollment();
                toast(`Horários do ${ENROLL_STATE.activeSem}º semestre limpos.`);
            }
        };
    }

    const btnRun = $("btnRunAnalysis");
    if (btnRun) {
        btnRun.onclick = () => {
            renderEnrollment();
            toast("✓ Análise de inscrição atualizada!");
        };
    }

    const btnGoCfg = $("btnGoToConfig");
    if (btnGoCfg) {
        btnGoCfg.onclick = () => {
            const cfgTab = $("tab-t-cfg");
            if (cfgTab) cfgTab.click();
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

    const btnCur = $("btnApplyEnrollCurrent");
    if (btnCur) {
        btnCur.onclick = () => {
            const decision = buildOptimalSchedule(null, ENROLL_STATE.slots, S.maxLoad || 9);
            confirma(btnCur, "Confirmar inscrição?", () => {
                applyEnrollmentToCurrent(decision.recommended);
            });
        };
    }

    const btnSched = $("btnApplyEnrollSchedule");
    if (btnSched) {
        btnSched.onclick = () => {
            const decision = buildOptimalSchedule(null, ENROLL_STATE.slots, S.maxLoad || 9);
            confirma(btnSched, "Preencher grade semanal?", () => {
                applyEnrollmentToSchedule(decision.weeklyGrid);
            });
        };
    }

    ENROLL_STATE.activeSem = getOfferedSemesters()[0];
}
