/**
 * Módulo de Cálculo de Risco, Prioridade, Sincronização de Notas e Atividades Complementares (risk.js)
 *
 * Responsabilidades:
 * - Calcular o risco de reprovação por matéria (risk, riskMap) combinando faltas (pF) e nota/NAF (pN).
 * - Determinar a prioridade sugerida de estudo por matéria (effPrio) e ordenar a lista (sortCur).
 * - Sincronizar automaticamente a nota atual e os pontos a receber a partir das avaliações (syncSubjectGrades).
 * - Contabilizar as horas de Atividades Complementares / Anexo III (acCalc, acTotal, acH).
 */

import { S, C, CUR, AC, AC_REQ, taskStatus } from "./state.js";

/** Função logística (sigmoide) usada para suavizar transições de probabilidade. */
export const sig = x => 1 / (1 + Math.exp(-x));

/**
 * Calcula métricas de frequência, limite de faltas e probabilidade estimada de reprovação.
 *
 * - Faltas (pF): limite de 25% das aulas previstas, projetando 60% do ritmo atual nas aulas restantes.
 * - Nota (pN): compara a proporção de pontos necessária para atingir média 6.0 com a expectativa S.expect.
 *   Se a nota máxima possível (nota + pts) for >= 4.0, a elegibilidade à NAF reduz pN em 25%.
 * - Risco combinado (p): 1 - (1 - pF) * (1 - pN).
 */
export function risk(r) {
    const cum = r.cum;
    const prev = Math.max(r.prev, r.cum);
    const limit = Math.floor(prev * 0.25);
    const folga = limit - r.falt;
    const freq = cum ? ((cum - r.falt) / cum) * 100 : 100;
    const esp = cum ? (r.falt / cum) * Math.max(0, prev - cum) * 0.6 : 0;

    const pF = folga < 0
        ? 1
        : sig((esp - folga - 0.5) / Math.max(1.2, 0.5 * Math.sqrt(esp + 1)));

    const need = 6 - r.nota;
    let pN = need <= 0
        ? 0.02
        : r.pts <= 0
            ? 1
            : sig((need / r.pts - S.expect / 100) / 0.1);

    if (need > 0 && r.nota + r.pts >= 4) {
        pN *= 0.75;
    }

    return {
        freq,
        limit,
        folga,
        pF,
        pN,
        p: 1 - (1 - pF) * (1 - pN)
    };
}

/**
 * Determina a situação acadêmica final de uma disciplina com fase 'Finalizada':
 * - Aprovada (verde): frequência >= 75% (faltas <= 25%) e nota >= 6.0
 * - IFA (amarelo): frequência >= 75% e nota >= 4.0 e nota < 6.0
 * - Reprovada (vermelho): nota < 4.0 ou frequência < 75% (faltas > 25%)
 */
export function getFinStatus(r) {
    if (!r) return null;
    const k = risk(r);
    const hasFreq = k.freq >= 75 && k.folga >= 0;
    if (hasFreq && r.nota >= 6.0) {
        return { status: "pass", label: "Aprovada", cls: "g", text: "✓ Aprovada", k };
    }
    if (hasFreq && r.nota >= 4.0 && r.nota < 6.0) {
        return { status: "ifa", label: "IFA", cls: "y", text: "⚠️ Em IFA", k };
    }
    const reason = !hasFreq ? "Faltas > 25%" : `Nota ${String(Math.round(r.nota * 10) / 10).replace(".", ",")} < 4.0`;
    return { status: "fail", label: "Reprovada", cls: "r", text: "✕ Reprovada", reason, k };
}

/** Retorna um mapa `{ [idDisciplina]: probabilidadeDeReprovar }` para todas as disciplinas em curso. */
export const riskMap = () => {
    const map = {};
    (S.current || []).forEach(r => {
        map[r.id] = risk(r).p;
    });
    return map;
};

/**
 * Determina a prioridade efetiva da matéria:
 * Quando configurada como 'Auto', atribui 'Alta' se o risco estiver entre 15% e 75% (zona reversível).
 */
export const effPrio = r => {
    const p = risk(r).p;
    if (!r.prio || r.prio === "Auto") {
        return (p >= 0.15 && p <= 0.75) ? "Alta" : "Baixa";
    }
    return r.prio;
};

/** Ordena a lista de matérias em curso segundo o critério escolhido em `S.curSort`. */
export function sortCur(list) {
    const order = S.curSort;
    const rank = { "Alta": 0, "Média": 1, "Baixa": 2 };
    const byName = (x, y) => C[x.id].name.localeCompare(C[y.id].name, "pt-BR");
    const copy = [...list];
    if (order === "nome") {
        copy.sort(byName);
    } else if (order === "prio") {
        copy.sort((x, y) => rank[effPrio(x)] - rank[effPrio(y)] || risk(y).p - risk(x).p || byName(x, y));
    } else if (order === "risco") {
        copy.sort((x, y) => risk(y).p - risk(x).p || byName(x, y));
    }
    return copy;
}

/**
 * Sincroniza automaticamente `r.nota` e `r.pts` das matérias em curso (quando `r.autoGrade !== false`)
 * a partir das avaliações cadastradas na aba Prazos (`S.tasks`).
 */
export function syncSubjectGrades() {
    (S.current || []).forEach(r => {
        if (r.autoGrade === false) return;
        const ts = (S.tasks || []).filter(t => t.subj === r.id);
        if (ts.length === 0) return;

        // Apenas atividades com status 'avaliada' (nota já lançada) entram na nota atual
        const graded = ts.filter(t => taskStatus(t) === "avaliada" && t.got != null && t.got !== "");
        // Atividades 'pendente' ou 'avaliando' permanecem como pontos em disputa
        const pendingOrEvaluating = ts.filter(t => taskStatus(t) !== "avaliada");

        const sumGot = graded.reduce((acc, t) => acc + (parseFloat(t.got) || 0), 0);
        const sumGradedPts = graded.reduce((acc, t) => acc + (parseFloat(t.pts) || 0), 0);
        const sumPendingPts = pendingOrEvaluating.reduce((acc, t) => acc + (parseFloat(t.pts) || 0), 0);

        r.nota = Math.round(sumGot * 100) / 100;

        if (pendingOrEvaluating.length > 0) {
            r.pts = Math.round(Math.max(sumPendingPts, 10 - sumGradedPts) * 100) / 100;
        } else {
            r.pts = Math.round(Math.max(0, 10 - sumGradedPts) * 100) / 100;
        }
    });
}

/**
 * Calcula as horas obtidas e contabilizadas de Atividades Complementares,
 * aplicando limites de unidades por item e tetos compartilhados por grupo (ex.: Grupo A do Anexo III).
 */
export function acCalc() {
    if (!CUR.acTable) {
        return { rows: [], g: {}, tot: +S.acHoras || 0 };
    }
    const groups = {};
    const rows = AC.map((item, i) => {
        const units = Math.min(+S.ac[i] || 0, item[5]);
        const obtained = units * item[2];
        const groupKey = item[6] || ("i" + i);
        if (!groups[groupKey]) {
            groups[groupKey] = { ob: 0, max: item[4] };
        }
        groups[groupKey].ob += obtained;
        return { u: units, ob: obtained, k: groupKey };
    });

    let tot = 0;
    Object.values(groups).forEach(grp => {
        grp.ct = Math.min(grp.ob, grp.max);
        tot += grp.ct;
    });

    return { rows, g: groups, tot };
}

export const acTotal = () => acCalc().tot;
export const acH = () => S.acDone ? AC_REQ : Math.min(AC_REQ, acTotal());
