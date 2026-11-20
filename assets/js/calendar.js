/**
 * Módulo de Calendário, Priorização de Avaliações e Planejador Diário de Estudo (calendar.js)
 *
 * Responsabilidades:
 * - Utilitários de manipulação e formatação de datas (ymd, pd, addDays, dayDiff, dfmt, semAtual).
 * - Calcular totais de pontuação por matéria (subjTotals).
 * - Calcular importância (importance), urgência (urgency) e prioridade combinada (prioOf, prioLbl).
 * - Distribuir as horas de estudo das atividades pendentes ao longo dos dias no calendário (planTasks).
 */

import { S, taskStatus } from "./state.js";
import { risk } from "./risk.js";

/** Formata um objeto Date como string ISO local 'YYYY-MM-DD'. */
export const ymd = d =>
    d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");

/** Converte uma string 'YYYY-MM-DD' em um objeto Date local (meia-noite). */
export const pd = s => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
};

/** Retorna uma nova data adicionando `n` dias à data `d`. */
export const addDays = (d, n) => {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + n);
    return copy;
};

/** Retorna a diferença inteira em dias entre duas datas `(b - a)`. */
export const dayDiff = (a, b) =>
    Math.round((pd(ymd(b)) - pd(ymd(a))) / 864e5);

/** Formata uma string 'YYYY-MM-DD' como 'DD/MM' no padrão brasileiro. */
export const dfmt = s => {
    if (!s) return "—";
    const d = pd(s);
    return isNaN(d)
        ? "—"
        : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

/** Retorna o semestre letivo atual do ano (1 para jan-jun, 2 para jul-dez). */
export const semAtual = () => (new Date().getMonth() >= 6 ? 2 : 1);

/**
 * Calcula o somatório de pontos totais (mínimo 10), pontos obtidos e pontos corrigidos
 * para as tarefas vinculadas à matéria `id`.
 */
export function subjTotals(id) {
    const ts = (S.tasks || []).filter(t => t.subj === id);
    const total = Math.max(
        10,
        ts.reduce((sum, t) => sum + (parseFloat(t.pts) || 0), 0)
    );
    const got = ts.reduce(
        (sum, t) => sum + (t.got != null && t.got !== "" ? parseFloat(t.got) || 0 : 0),
        0
    );
    const graded = ts
        .filter(t => t.got != null && t.got !== "")
        .reduce((sum, t) => sum + (parseFloat(t.pts) || 0), 0);

    return { ts, total, got, graded };
}

/**
 * Calcula a importância (0 a 100) de uma avaliação com base no peso que ela representa
 * na matéria e no risco atual de reprovação naquela matéria.
 */
export function importance(t) {
    const weight = (t.pts || 0) / subjTotals(t.subj).total;
    const curSubj = (S.current || []).find(r => r.id === t.subj);
    const riskProb = curSubj ? risk(curSubj).p : 0;
    return Math.min(100, weight * 100 * (1 + 0.5 * riskProb) * 1.6);
}

/**
 * Calcula a urgência (0 a 100) de uma avaliação com base na folga líquida em dias
 * entre a data de referência `today`, o prazo `t.due` e as horas de esforço restantes `remH`.
 */
export function urgency(t, today, remH) {
    const dailyCap = +S.cap || 3;
    const slack = dayDiff(today, pd(t.due)) - remH / dailyCap;
    return slack <= 0 ? 100 : 100 / (1 + slack / 3);
}

/** Combina importância (55%) e urgência (45%) em um índice de prioridade (0 a 100). */
export const prioOf = (t, today, remH) =>
    0.55 * importance(t) + 0.45 * urgency(t, today, remH);

/** Retorna o rótulo textual e a classe de cor para um índice de prioridade `p`. */
export const prioLbl = p =>
    p >= 70
        ? ["Crítica", "r"]
        : p >= 50
            ? ["Alta", "y"]
            : p >= 30
                ? ["Média", "b"]
                : ["Baixa", "g"];

/**
 * Planejador guloso diário de estudo:
 * Distribui as horas de esforço (`eff`) das atividades pendentes ao longo dos dias disponíveis
 * até a véspera da entrega, respeitando o limite diário (`S.cap`) e a opção de finais de semana (`S.weekend`).
 */
export function planTasks() {
    const today = pd(ymd(new Date()));
    const pend = (S.tasks || [])
        .filter(t => taskStatus(t) === "pendente" && t.due)
        .map(t => ({ t, rem: t.eff || 1, start: null, plan: {} }));

    const cap = +S.cap || 3;
    const res = {};
    let last = today;
    pend.forEach(p => {
        const dueDate = pd(p.t.due);
        if (dueDate > last) last = dueDate;
    });

    for (let d = new Date(today), n = 0; d <= last && n < 400; d = addDays(d, 1), n++) {
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        if (isWeekend && !S.weekend) continue;

        let left = cap;
        const elig = pend.filter(p => {
            if (p.rem <= 0) return false;
            const daysBeforeDue = dayDiff(d, pd(p.t.due));
            const isOverdueToday = dayDiff(today, pd(p.t.due)) <= 0 && dayDiff(d, today) === 0;
            return daysBeforeDue >= 1 || isOverdueToday;
        });

        elig.sort((a, b) => prioOf(b.t, d, b.rem) - prioOf(a.t, d, a.rem));

        for (const p of elig) {
            if (left <= 0) break;
            const alloc = Math.min(left, p.rem);
            p.rem -= alloc;
            left -= alloc;
            const dayKey = ymd(d);
            p.plan[dayKey] = alloc;
            if (!p.start) p.start = dayKey;
        }
    }

    pend.forEach(p => {
        res[p.t.id] = p;
    });
    return res;
}
