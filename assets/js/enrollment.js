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
    lastStartHalf: null,
    analysisRun: false
};

export const ELECTIVES_SEM = 9;

/**
 * Retorna a lista dos semestres regulares ofertados com base no semestre letivo (1 = ímpar, 2 = par).
 * includeElectives: se true, anexa também a semana 9 dedicada a disciplinas eletivas/optativas.
 */
export function getOfferedSemesters(startHalf = S.startHalf, includeElectives = false) {
    const regular = +startHalf === 2 ? [2, 4, 6, 8] : [1, 3, 5, 7];
    return includeElectives ? [...regular, ELECTIVES_SEM] : regular;
}

/**
 * Retorna todos os semestres/turmas de inscrição a serem renderizados (4 regulares + 1 eletivas).
 */
export function getAllEnrollmentSemesters(startHalf = S.startHalf) {
    return getOfferedSemesters(startHalf, true);
}

/**
 * Retorna a lista de semanas ativas cadastradas pelo usuário.
 */
export function getEnrollWeeks() {
    if (Array.isArray(S.enrollWeeks) && S.enrollWeeks.length > 0) {
        return S.enrollWeeks;
    }
    S.enrollWeeks = [1];
    return S.enrollWeeks;
}

/**
 * Adiciona uma nova semana de oferta à lista.
 */
export function addEnrollWeek() {
    if (!Array.isArray(S.enrollWeeks)) S.enrollWeeks = [1];
    const maxId = S.enrollWeeks.reduce((m, w) => Math.max(m, parseInt(w, 10) || 0), 0);
    const newId = maxId + 1;
    S.enrollWeeks.push(newId);
    if (!S.enrollOffers) S.enrollOffers = {};
    S.enrollOffers[newId] = {};
    persist();
    renderEnrollment();
    toast(`✓ Semana ${S.enrollWeeks.length} adicionada!`);
}

/**
 * Exclui uma semana de oferta cadastrada.
 */
export function deleteEnrollWeek(weekId) {
    const wid = parseInt(weekId, 10);
    if (!Array.isArray(S.enrollWeeks)) S.enrollWeeks = [1];
    S.enrollWeeks = S.enrollWeeks.filter(w => parseInt(w, 10) !== wid);
    if (S.enrollOffers) delete S.enrollOffers[wid];
    if (S.enrollWeeks.length === 0) {
        S.enrollWeeks = [1];
        if (!S.enrollOffers) S.enrollOffers = {};
        S.enrollOffers[1] = {};
    }
    persist();
    renderEnrollment();
    if (ENROLL_STATE.analysisRun) renderEnrollmentResults();
    toast("Semana excluída.");
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
 * Retorna o mapa de matérias e seus respectivos slots cadastrados nas semanas de oferta.
 */
export function getAllOfferedCoursesFromOffers(offers = S.enrollOffers, targetSemesters = null) {
    const slotsByCourse = {};
    if (!offers || typeof offers !== "object") return slotsByCourse;

    const keys = Array.isArray(targetSemesters) && targetSemesters.length > 0
        ? targetSemesters
        : [...new Set([...getEnrollWeeks(), ...Object.keys(offers).map(Number)])];

    keys.forEach(sem => {
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

    // Prioridade para matérias de semestres anteriores (mais básicas)
    const semRank = Math.max(0, 10 - Math.min(10, c.sem || 1));
    if (semRank > 0) {
        const semBonus = semRank * 3;
        score += semBonus;
        reasons.push(`Semestre anterior/básico: ${c.sem}º sem (+${semBonus} pts)`);
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
    const sorted = [...eligibleCids].sort((a, b) =>
        (scoreMap[b] || 0) - (scoreMap[a] || 0) ||
        ((C[a] && C[a].sem) || 99) - ((C[b] && C[b].sem) || 99) ||
        a.localeCompare(b)
    );
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
            const sorted = [...list].sort((a, b) =>
                (b.score - a.score) ||
                ((a.c && a.c.sem) || 99) - ((b.c && b.c.sem) || 99) ||
                a.id.localeCompare(b.id)
            );
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
                } else if (winner.c && loser.c && winner.c.sem < loser.c.sem) {
                    reason = `${winner.id} é de um semestre anterior mais básico (${winner.c.sem}º sem vs ${loser.c.sem}º sem de ${loser.id}).`;
                } else if (diffPts > 0) {
                    reason = `${winner.id} possui pontuação acadêmica superior (+${diffPts} pts).`;
                } else {
                    reason = `${winner.id} foi priorizada pelo algoritmo para viabilizar a melhor combinação da grade.`;
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
    const offersSlots = getAllOfferedCoursesFromOffers(S.enrollOffers);

    let courseIds = [];
    const isCustomCandidates = candidateCourses && Array.isArray(candidateCourses) && candidateCourses.length > 0;
    if (isCustomCandidates) {
        courseIds = [...new Set(candidateCourses)];
    } else {
        const fromOffers = Object.keys(offersSlots);
        if (fromOffers.length > 0) {
            courseIds = fromOffers;
        } else {
            courseIds = ORDER.filter(id => !passed.has(id));
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
            const conflictingWithRec = [];
            const conflictingSlots = [];

            for (const s of slots) {
                if (occupiedSlots.has(s)) {
                    const recId = occupiedSlots.get(s);
                    if (!conflictingWithRec.includes(recId)) {
                        conflictingWithRec.push(recId);
                    }
                    conflictingSlots.push(s);
                    if (!conflictSlot) conflictSlot = s;
                }
            }

            let deferReason = "";
            if (conflictingWithRec.length > 1) {
                deferReason = `Otimização 1 vs ${conflictingWithRec.length}: sua exclusão viabilizou alocar ${conflictingWithRec.length} matérias recomendadas (${conflictingWithRec.join(", ")}), aumentando a quantidade total cursada`;
            } else if (conflictingWithRec.length === 1) {
                deferReason = `Choque de horário no slot ${formatSlotLabel(conflictSlot)} com a disciplina selecionada ${conflictingWithRec[0]}`;
            } else if (recommended.length >= maxLoad) {
                deferReason = `Limite máximo de matérias por semestre atingido (${maxLoad} disciplinas)`;
            } else {
                deferReason = "Não incluída na combinação ótima de horários";
            }

            deferred.push({
                ...item,
                deferReason,
                conflictWith: conflictingWithRec[0] || null,
                conflictingWithRec,
                conflictingSlots,
                conflictSlot
            });
        }
    });

    // Avaliação de trocas multi-matérias (1 vs N): quando cancelar 1 matéria permitiu alocar 2 ou mais matérias
    const tradeoffs = [];
    deferred.forEach(item => {
        if (item.conflictingWithRec && item.conflictingWithRec.length > 1) {
            const gain = item.conflictingWithRec.length - 1;
            tradeoffs.push({
                deferredId: item.id,
                deferredSem: item.c.sem,
                replacedBy: item.conflictingWithRec,
                gainCount: gain,
                slots: item.conflictingSlots.map(formatSlotLabel),
                explanation: `Ao não cursar ${item.id}, foi possível alocar ${item.conflictingWithRec.length} matérias na grade (${item.conflictingWithRec.join(", ")}), gerando um ganho líquido de +${gain} disciplina(s) na semana.`
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
        tradeoffs,
        weeklyGrid,
        effectiveSlotsMap,
        metrics: {
            recommendedCount: recommended.length,
            maxLoad,
            totalAulas,
            totalHoras: Math.round(totalHoras * 10) / 10,
            avoidedDelays,
            conflictsCount: conflicts.length,
            tradeoffsCount: tradeoffs.length,
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
export function applyEnrollmentToCurrent(recommendedList, notify = true) {
    if (!Array.isArray(recommendedList) || recommendedList.length === 0) {
        if (notify) toast("Nenhuma matéria recomendada para aplicar.");
        return 0;
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
    if (notify) {
        persist();
        update();
        toast(`✓ ${added} matéria(s) adicionada(s) a "Cursando agora"!`);
    }
    return added;
}

/**
 * Preenche e organiza a grade semanal da aba "Horários" (S.hor.cells) com a recomendação da semana.
 */
export function applyEnrollmentToSchedule(weeklyGrid, notify = true, cleanOld = true) {
    const keys = Object.keys(weeklyGrid || {});
    if (keys.length === 0) {
        if (notify) toast("Nenhuma grade gerada para aplicar aos Horários.");
        return 0;
    }

    if (!S.hor) S.hor = { cells: {} };
    const oldCells = S.hor.cells || {};
    const newCells = cleanOld ? {} : { ...oldCells };

    keys.forEach(slotKey => {
        const cid = weeklyGrid[slotKey];
        if (cid && hasCourse(cid)) {
            newCells[slotKey] = {
                id: cid,
                sala: (oldCells[slotKey] && oldCells[slotKey].sala) || ""
            };
        }
    });

    S.hor.cells = newCells;
    if (notify) {
        persist();
        update();
        toast(`✓ ${keys.length} horário(s) organizados na aba Horários!`);
    }
    return keys.length;
}

/**
 * Aplica a decisão completa: inscreve em "Cursando agora" e organiza os horários semanais.
 */
export function applyEnrollment(decision) {
    if (!decision || !decision.recommended || decision.recommended.length === 0) {
        toast("Nenhuma matéria recomendada para aplicar.");
        return;
    }

    const added = applyEnrollmentToCurrent(decision.recommended, false);
    const slots = applyEnrollmentToSchedule(decision.weeklyGrid, false, true);

    persist();
    update();
    toast(`✓ Aplicado com sucesso: ${decision.recommended.length} matéria(s) em curso e ${slots} horário(s) organizados!`);
}

/**
 * Renderiza os resultados da análise e otimização da grade recomendada.
 */
export function renderEnrollmentResults() {
    const resSec = $("enrollResultsSection");
    if (!resSec) return;

    if (!ENROLL_STATE.analysisRun) {
        resSec.style.display = "none";
        return;
    }

    resSec.style.display = "block";
    const decision = buildOptimalSchedule(null, ENROLL_STATE.slots, S.maxLoad || 9);
    const recMap = new Map(decision.recommended.map(r => [r.id, r]));
    const defMap = new Map(decision.deferred.map(d => [d.id, d]));
    const passed = passedSet();

    // 1. Renderiza KPIs da Decisão
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
                    `<div class="note" style="margin-top:2px">Distribuídas nas turmas</div>` +
                `</div>` +
            `</div>`;
        kpisEl.innerHTML = kpisHtml;
    }

    // 2. Renderiza Conflitos e Justificativas
    const confWrap = $("enrollConflictsWrap");
    if (confWrap) {
        let tradeoffsHtml = "";
        if (decision.tradeoffs && decision.tradeoffs.length > 0) {
            tradeoffsHtml =
                `<div class="panel" style="margin-bottom:14px;padding:12px;background:var(--panel2,#1a2340);border-left:4px solid var(--av,#2563eb)">` +
                    `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">` +
                        `<h4 style="margin:0;color:var(--av,#2563eb)">🔄 Otimização de Quantidade de Matérias (Trocas 1 vs N)</h4>` +
                    `</div>` +
                    `<div class="note" style="margin-bottom:8px">` +
                        `O algoritmo priorizou a quantidade total de disciplinas: ao não alocar 1 matéria concorrente, foi possível incluir 2 ou mais disciplinas na grade.` +
                    `</div>` +
                    decision.tradeoffs.map(t =>
                        `<div style="margin-top:6px;padding:8px 12px;background:rgba(37,99,235,0.08);border-radius:6px">` +
                            `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">` +
                                `<b>Exclusão de ${esc(t.deferredId)} (${esc(t.deferredSem)}º sem):</b> ` +
                                `<span>Permitiu cursar ${esc(t.replacedBy.length)} matérias (${esc(t.replacedBy.join(", "))})</span> ` +
                                `<span class="tag g" style="font-weight:700;font-size:11px">+${esc(t.gainCount)} matéria líquida</span>` +
                            `</div>` +
                            `<div class="note" style="margin-top:4px;color:var(--txt)">` +
                                `${esc(t.explanation)}` +
                            `</div>` +
                        `</div>`
                    ).join("") +
                `</div>`;
        }

        if (decision.conflicts.length === 0) {
            confWrap.innerHTML =
                tradeoffsHtml +
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
                tradeoffsHtml +
                `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">` +
                    `<h4 style="margin:0;color:var(--warn)">⚠️ Conflitos de Horário Identificados e Resolvidos (${esc(decision.conflicts.length)})</h4>` +
                `</div>` +
                conflictCardsHtml;
        }
    }

    // 3. Renderiza Grade Semanal Sugerida (Sem Conflitos)
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

    // 4. Renderiza Tabela Detalhada com Filtros e Busca
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
 * Renderiza todo o conteúdo da aba "🎯 Inscrição".
 * As semanas dinâmicas permanecem abertas e empilhadas verticalmente.
 */
export function renderEnrollment() {
    const panel = $("t-enroll");
    if (!panel) return;

    const weeks = getEnrollWeeks();
    if (!S.enrollOffers) S.enrollOffers = {};

    weeks.forEach(w => {
        if (!S.enrollOffers[w]) S.enrollOffers[w] = {};
    });

    const passed = passedSet();

    if (ENROLL_STATE.lastCurKey !== KEY) {
        ENROLL_STATE.lastCurKey = KEY;
        ENROLL_STATE.analysisRun = false;
    }

    // 1. Atualiza Tag do Contador de Semanas
    const countTag = $("enrollWeeksCountTag");
    if (countTag) {
        countTag.textContent = `${weeks.length} Semana(s)`;
    }

    // 2. Filtra matérias elegíveis: não concluídas e com TODOS os pré-requisitos cumpridos
    const eligibleCourses = ORDER.filter(id => {
        if (!C[id]) return false;
        if (passed.has(id)) return false;
        const pre = C[id].pre || [];
        return pre.every(p => passed.has(p));
    });

    const semsWithCourses = [...new Set(eligibleCourses.map(id => C[id].sem))].sort((a, b) => a - b);

    // 3. Renderiza as Semanas Empilhadas
    const container = $("enrollSemestersContainer");
    if (container) {
        container.innerHTML = weeks.map((weekId, idx) => {
            const curWeekOffers = S.enrollOffers[weekId] || {};
            const semCount = Object.keys(curWeekOffers).length;

            const rowsHtml = HORAS.map((h, i) =>
                `<tr><th>${esc(h)}</th>` +
                DIAS.map((_d, j) => {
                    const slotKey = `${i}-${j}`;
                    let selId = curWeekOffers[slotKey] || "";
                    if (selId && (!hasCourse(selId) || passed.has(selId) || !(C[selId].pre || []).every(p => passed.has(p)))) {
                        delete curWeekOffers[slotKey];
                        selId = "";
                    }

                    const optSemHtml = semsWithCourses.map(s => {
                        const label = (s === 9 || s === 10)
                            ? "Disciplinas Eletivas / Optativas"
                            : `${s}º Semestre`;
                        const courses = eligibleCourses.filter(id => C[id].sem === s);
                        return (
                            `<optgroup label="${esc(label)}">` +
                            courses.map(id => {
                                const isSel = id === selId;
                                return isSel
                                    ? `<option value="${esc(id)}" selected>${esc(id)} · ${esc(C[id].name)}</option>`
                                    : `<option value="${esc(id)}">${esc(id)} · ${esc(C[id].name)}</option>`;
                            }).join("") +
                            `</optgroup>`
                        );
                    }).join("");

                    return (
                        `<td>` +
                            `<select class="enroll-slot-select" data-week-id="${esc(weekId)}" data-slot="${esc(slotKey)}" style="width:100%;font-size:12px;padding:3px 4px;border-radius:4px;border:1px solid var(--border,#2b3758);background:var(--bg,#0b1020);color:var(--txt,#e2e8f0)">` +
                                `<option value="">— (Livre)</option>` +
                                `${optSemHtml}` +
                            `</select>` +
                        `</td>`
                    );
                }).join("") +
                `</tr>`
            ).join("");

            return (
                `<div class="panel" style="margin-top:0;background:var(--panel2,#1a2340);padding:14px;border:1px solid var(--border,#2b3758);border-radius:10px">` +
                    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">` +
                        `<div style="display:flex;align-items:center;gap:10px">` +
                            `<span class="tag b" style="font-weight:700;font-size:13px;padding:4px 10px">Semana ${esc(idx + 1)}</span>` +
                        `</div>` +
                        `<div style="display:flex;align-items:center;gap:12px">` +
                            `<span class="note enroll-sem-count" data-week-id="${esc(weekId)}" style="color:var(--txt)">${esc(semCount)} horário(s) cadastrado(s)</span>` +
                            `<button type="button" class="btn-sm btn-ghost btn-del-week" data-week-id="${esc(weekId)}" title="Excluir Semana ${esc(idx + 1)}" style="color:var(--danger,#ef4444);border-color:rgba(239,68,68,0.3)">` +
                                `🗑️ Excluir Semana` +
                            `</button>` +
                        `</div>` +
                    `</div>` +
                    `<div class="tblwrap">` +
                        `<table class="st hor" style="min-width:1000px">` +
                            `<thead>` +
                                `<tr>` +
                                    `<th>Horas</th>` +
                                    `<th>Seg</th>` +
                                    `<th>Ter</th>` +
                                    `<th>Qua</th>` +
                                    `<th>Qui</th>` +
                                    `<th>Sex</th>` +
                                `</tr>` +
                            `</thead>` +
                            `<tbody>${rowsHtml}</tbody>` +
                        `</table>` +
                    `</div>` +
                `</div>`
            );
        }).join("");
    }

    // 4. Renderiza a seção de resultados se a análise já tiver sido solicitada
    renderEnrollmentResults();
}

/**
 * Inicializa os botões, listeners e eventos da aba "🎯 Inscrição".
 */
export function initEnrollmentUI() {
    const container = $("enrollSemestersContainer");
    if (container) {
        container.onchange = e => {
            const sel = e.target.closest("select.enroll-slot-select");
            if (sel && sel.dataset.weekId && sel.dataset.slot) {
                const wid = sel.dataset.weekId;
                const slotKey = sel.dataset.slot;
                const cid = sel.value;

                if (!S.enrollOffers) S.enrollOffers = {};
                if (!S.enrollOffers[wid]) S.enrollOffers[wid] = {};

                if (cid) {
                    S.enrollOffers[wid][slotKey] = cid;
                } else {
                    delete S.enrollOffers[wid][slotKey];
                }

                const countBadge = document.querySelector(`.enroll-sem-count[data-week-id="${esc(wid)}"]`);
                if (countBadge) {
                    const cnt = Object.keys(S.enrollOffers[wid]).length;
                    countBadge.textContent = `${cnt} horário(s) cadastrado(s)`;
                }

                persist();

                if (ENROLL_STATE.analysisRun) {
                    renderEnrollmentResults();
                }
            }
        };

        container.onclick = e => {
            const btnDel = e.target.closest("button.btn-del-week");
            if (btnDel && btnDel.dataset.weekId) {
                const wid = btnDel.dataset.weekId;
                confirma(btnDel, "Confirmar exclusão?", () => {
                    deleteEnrollWeek(wid);
                });
            }
        };
    }

    const btnAdd = $("btnAddWeek");
    if (btnAdd) {
        btnAdd.onclick = () => {
            addEnrollWeek();
        };
    }

    const btnClearOffers = $("btnClearOffers");
    if (btnClearOffers) {
        btnClearOffers.onclick = () => {
            confirma(btnClearOffers, "Tem certeza? Clique para limpar", () => {
                const weeks = getEnrollWeeks();
                if (!S.enrollOffers) S.enrollOffers = {};
                weeks.forEach(w => { S.enrollOffers[w] = {}; });
                ENROLL_STATE.analysisRun = false;
                persist();
                renderEnrollment();
                toast("Todas as semanas de oferta foram limpas.");
            });
        };
    }

    const btnRun = $("btnRunAnalysis");
    if (btnRun) {
        btnRun.onclick = () => {
            ENROLL_STATE.analysisRun = true;
            renderEnrollmentResults();
            const resSec = $("enrollResultsSection");
            if (resSec) {
                resSec.style.display = "block";
                resSec.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            toast("✓ Análise de inscrição e otimização concluídas!");
        };
    }

    const searchInput = $("enrollSearch");
    if (searchInput) {
        searchInput.oninput = e => {
            ENROLL_STATE.search = e.target.value || "";
            if (ENROLL_STATE.analysisRun) renderEnrollmentResults();
        };
    }

    const filterSel = $("enrollFilterStatus");
    if (filterSel) {
        filterSel.onchange = e => {
            ENROLL_STATE.filterStatus = e.target.value || "all";
            if (ENROLL_STATE.analysisRun) renderEnrollmentResults();
        };
    }

    const btnApply = $("btnApplyEnroll") || $("btnApplyEnrollCurrent");
    if (btnApply) {
        btnApply.onclick = () => {
            const decision = buildOptimalSchedule(null, ENROLL_STATE.slots, S.maxLoad || 9);
            confirma(btnApply, "Confirmar e aplicar?", () => {
                applyEnrollment(decision);
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
}
