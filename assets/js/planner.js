/**
 * Módulo de Planejamento de Semestres e Simulação Monte Carlo (planner.js)
 *
 * Responsabilidades:
 * - Determinar paridade de semestres futuros (half, label) e disciplinas pendentes (electivesPlanned, toPlan).
 * - Verificar condições de liberação do TCC (gateH, gateNeed, tccOpen) e conjunto de aprovadas (passedSet).
 * - Executar o planejador guloso por caminho crítico (simulate).
 * - Executar a simulação estocástica de Monte Carlo com 1000 rodadas determinísticas (monte, seed).
 */

import {
    S,
    C,
    CUR,
    OBR,
    EST,
    TCC_IDS,
    OBR_H,
    EL_DEFAULT,
    ELETIVAS,
    depth,
    anc
} from "./state.js";
import { riskMap, acH, risk, getFinStatus } from "./risk.js";

/** Retorna a paridade (1 = ímpar/1º sem, 2 = par/2º sem) do k-ésimo semestre futuro. */
export const half = k => ((S.startHalf - 1 + k) % 2) + 1;

/** Retorna o rótulo 'ANO/SEM' (ex.: '2026/1') para o k-ésimo semestre planejado. */
export const label = k => {
    const year = S.startYear + Math.floor((S.startHalf - 1 + k) / 2);
    return year + "/" + half(k);
};

/**
 * Seleciona as disciplinas eletivas que ainda faltam cursar para atingir o mínimo exigido pelo curso,
 * priorizando as marcadas pelo usuário em `S.electivePlan` e completando com `EL_DEFAULT`.
 */
export function electivesPlanned(passed) {
    const passedElCount = ELETIVAS.filter(e => passed.has(e)).length;
    const need = Math.max(0, (CUR.eletNeed || 2) - passedElCount);
    const chosen = [];

    S.electivePlan
        .filter(e => !passed.has(e))
        .forEach(e => {
            if (chosen.length < need) chosen.push(e);
        });

    EL_DEFAULT.forEach(e => {
        if (chosen.length < need && !passed.has(e) && !chosen.includes(e)) {
            chosen.push(e);
        }
    });

    return chosen;
}

/** Retorna a lista completa de disciplinas pendentes para conclusão do curso. */
export function toPlan(passed) {
    const plan = OBR.filter(i => !passed.has(i)).concat(electivesPlanned(passed));
    EST.forEach(i => {
        if (!passed.has(i)) plan.push(i);
    });
    TCC_IDS.forEach(t => {
        if (!passed.has(t)) plan.push(t);
    });
    return plan;
}

/** Calcula a carga horária acumulada que conta para o gatilho de liberação do TCC. */
export const gateH = P => {
    const obrEstH = OBR.concat(EST)
        .filter(i => P.has(i))
        .reduce((acc, i) => acc + C[i].h, 0);
    if (S.tccBase === "obr") return obrEstH;

    const eletH = ELETIVAS
        .filter(i => P.has(i))
        .slice(0, CUR.eletNeed || 2)
        .reduce((acc, i) => acc + C[i].h, 0);
    return obrEstH + eletH + acH();
};

/** Calcula a carga horária mínima exigida para liberar o TCC 1 (padrão 75%). */
export const gateNeed = () =>
    (CUR.tccPct || 0.75) * (S.tccBase === "obr" ? OBR_H : CUR.totalH);

/** Verifica se o TCC está liberado dado o conjunto `P` de disciplinas já aprovadas. */
export const tccOpen = P => {
    if (CUR.tccRest) {
        const remaining = OBR.filter(i => !P.has(i)).length + electivesPlanned(P).length;
        return remaining <= 2 * S.maxLoad;
    }
    return gateH(P) >= gateNeed();
};

/**
 * Retorna o conjunto consolidado de disciplinas aprovadas, incluindo aquelas
 * marcadas como 'Finalizada' na aba 'Cursando agora' (e seus respectivos pré-requisitos).
 */
export function passedSet() {
    const P = new Set(S.passed);
    (S.current || []).forEach(r => {
        if (r.fase === "Finalizada") {
            const fin = getFinStatus(r);
            if (fin && fin.status === "pass") {
                P.add(r.id);
                anc(r.id).forEach(x => P.add(x));
            }
        }
    });
    return P;
}

// Gerador pseudoaleatório determinístico (Mulberry32) para reprodutibilidade do Monte Carlo
let rng = Math.random;
export const seed = () => {
    let a = 12345;
    rng = () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * Simula a conclusão do curso semestre a semestre usando um algoritmo guloso por caminho crítico.
 *
 * @param {number} fail Probabilidade (0 a 1) de uma disciplina planejada não ser concluída no semestre.
 * @param {number} mode Tratamento das matérias em curso:
 *   0 = assume aprovação em todas;
 *   1 = reprova matérias com risco >= 50%;
 *   2 = sorteia aprovação pelo risco individual usando `rng()`.
 * @param {Object} rm Mapa de risco das matérias em curso.
 */
export function simulate(fail, mode = 0, rm = riskMap()) {
    const passed = passedSet();
    (S.current || []).forEach(r => {
        const p = rm[r.id] ?? 0;
        if (mode === 0 || (mode === 1 && p < 0.5) || (mode === 2 && rng() >= p)) {
            passed.add(r.id);
        }
    });

    const pending = new Set(toPlan(passed));
    const terms = [];
    let done = OBR.concat(EST)
        .filter(i => passed.has(i))
        .reduce((sum, i) => sum + C[i].h, 0);
    const estMinH = (CUR.estMinPct || 0) * CUR.totalH;
    let k = 0;

    while (pending.size && k < 60) {
        const par = half(k);
        const candidates = [...pending].filter(id => {
            const c = C[id];
            if (!c.pre.every(p => passed.has(p))) return false;
            if (c.kind === "tcc" && !tccOpen(passed)) return false;
            if (c.kind === "es" && estMinH > 0 && done < estMinH) return false;
            if (S.respectParity && (c.kind === "ob" || c.kind === "tcc" || c.kind === "es")) {
                const expectedPar = (c.sem % 2) ? 1 : 2;
                if (expectedPar !== par) return false;
            }
            return true;
        }).sort((a, b) => depth[b] - depth[a] || C[a].sem - C[b].sem);

        const take = candidates.slice(0, S.maxLoad);
        const got = [];
        take.forEach(id => {
            if (fail > 0 && rng() < fail) return;
            got.push(id);
        });

        got.forEach(id => pending.delete(id));
        terms.push({ k, taken: got });
        got.forEach(id => {
            passed.add(id);
            if (C[id].kind === "ob" || C[id].kind === "es") {
                done += C[id].h;
            }
        });
        k++;
    }

    return {
        terms,
        n: pending.size ? Infinity : terms.length
    };
}

/**
 * Executa 1000 rodadas de simulação Monte Carlo e retorna a mediana (`med`, cenário provável)
 * e o percentil 90 (`p90`, cenário pessimista).
 */
export function monte(fail) {
    seed();
    const rm = riskMap();
    const results = [];
    for (let i = 0; i < 1000; i++) {
        results.push(simulate(fail, 2, rm).n);
    }
    results.sort((a, b) => a - b);
    return {
        med: results[500],
        p90: results[899]
    };
}
