/**
 * Módulo de Interface do Usuário, Acessibilidade WAI-ARIA, Renderização e Eventos (ui.js)
 *
 * Responsabilidades:
 * - Gerenciar abas acessíveis (WAI-ARIA tablist + navegação por teclado) via bindTablist e initMainTabs.
 * - Construir e atualizar o Fluxograma (Grafo SVG, modo mobile/toque, navegação por teclado nos cards,
 *   painel de inspeção de pré-requisitos #flowInspect e fallback responsivo #flowFallback).
 * - Renderizar KPIs, Linha do Tempo (#timeline), Cursando Agora (#curBody), Prazos/Tarefas (#trListBody,
 *   #trSubjectsCards, #cal), Horários (#horBody) e Atividades Complementares (#acBody).
 * - Conectar todos os listeners de eventos de formulário, botões e importação/exportação de JSON.
 */

import {
    CURS,
    KEY,
    CUR,
    C,
    ORDER,
    OBR,
    EST,
    TCC_IDS,
    HAS_TCC,
    ELETIVAS,
    AC_REQ,
    AC_SEC,
    AC,
    HEADS,
    colOf,
    anc,
    desc,
    PRIO,
    FASE,
    TAGC,
    VALID_TASK_TYPES,
    VALID_VIEWS_TR,
    TYPE_ICON,
    DIAS,
    HORAS,
    esc,
    hasCourse,
    S,
    setState,
    switchCourse,
    validateStateSchema,
    fixCur,
    taskStatus,
    sanitizeState,
    persist,
    setFileHandle
} from "./state.js";

import {
    risk,
    sortCur,
    syncSubjectGrades,
    acCalc,
    acTotal
} from "./risk.js";

import {
    label,
    electivesPlanned,
    passedSet,
    simulate,
    monte
} from "./planner.js";

import {
    ymd,
    pd,
    addDays,
    dayDiff,
    dfmt,
    semAtual,
    subjTotals,
    prioOf,
    prioLbl,
    planTasks
} from "./calendar.js";

const $ = id => document.getElementById(id);
const fmt = n => String(Math.round(n * 100) / 100).replace(".", ",");
const optList = (arr, v) =>
    arr.map(o => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${esc(o)}</option>`).join("");

// ---------- ABAS (WAI-ARIA + NAVEGAÇÃO POR TECLADO) ----------

/**
 * Conecta navegação por teclado WAI-ARIA (ArrowLeft/Right/Up/Down, Home, End, Enter, Space)
 * e cliques a um conjunto de botões `role="tab"` dentro de um `role="tablist"`.
 */
export function bindTablist(container, btns, getVal, onSelect) {
    btns.forEach((b, idx) => {
        b.onclick = () => onSelect(getVal(b), false);
        b.onkeydown = e => {
            let nextIdx = null;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                nextIdx = (idx + 1) % btns.length;
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                nextIdx = (idx - 1 + btns.length) % btns.length;
            } else if (e.key === "Home") {
                nextIdx = 0;
            } else if (e.key === "End") {
                nextIdx = btns.length - 1;
            } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(getVal(b), true);
                return;
            }
            if (nextIdx !== null) {
                e.preventDefault();
                onSelect(getVal(btns[nextIdx]), true);
            }
        };
    });

    if (container) {
        container.onkeydown = e => {
            if (e.target && btns.includes(e.target)) return;
            const curIdx = Math.max(0, btns.findIndex(b => b.getAttribute("aria-selected") === "true"));
            let nextIdx = null;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                nextIdx = (curIdx + 1) % btns.length;
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                nextIdx = (curIdx - 1 + btns.length) % btns.length;
            } else if (e.key === "Home") {
                nextIdx = 0;
            } else if (e.key === "End") {
                nextIdx = btns.length - 1;
            }
            if (nextIdx !== null) {
                e.preventDefault();
                onSelect(getVal(btns[nextIdx]), true);
            }
        };
    }
}

/** Inicializa a barra de abas principal (#tabs) e restaura a última aba visitada. */
export function initMainTabs() {
    const tablist = $("tabs");
    const btns = [...document.querySelectorAll("#tabs button")];
    function show(id, focusBtn = false) {
        if (!$(id)) id = "t-flow";
        btns.forEach(b => {
            const act = b.dataset.tab === id;
            b.classList.toggle("act", act);
            b.setAttribute("aria-selected", act ? "true" : "false");
            b.setAttribute("tabindex", act ? "0" : "-1");
            if (act && focusBtn && typeof b.focus === "function") b.focus();
        });
        document.querySelectorAll(".tabpane").forEach(p => {
            const act = p.id === id;
            p.classList.toggle("act", act);
            p.hidden = !act;
            p.setAttribute("aria-hidden", act ? "false" : "true");
        });
        try {
            localStorage.setItem("aba-ativa", id);
        } catch (e) { }
    }
    bindTablist(tablist, btns, b => b.dataset.tab, show);
    window.showTab = show;
    let initialTab = "t-flow";
    try {
        initialTab = localStorage.getItem("aba-ativa") || initialTab;
    } catch (e) { }
    show(initialTab, false);
}

let renderEquivFn = null;
/** Registra o renderizador da aba de equivalência para ser invocado no ciclo de update(). */
export function registerEquivalenceRenderer(fn) {
    renderEquivFn = fn;
}

// ---------- LAYOUT E INTERAÇÃO DO FLUXOGRAMA ----------
const CW = 190, CH = 66, GX = 64, GY = 14, X0 = 20, Y0 = 56;
const flow = $("flow");
const svg = $("edges");
const pos = {};
const els = {};
const colItems = {};
let flowMode = "pass"; // "pass" | "cur" | "info"
let pinnedId = null;

const isMobileViewport = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 700px)").matches;

let flowView = "graph";
try {
    const savedView = localStorage.getItem("fluxo-visao");
    if (savedView === "list" || savedView === "graph") {
        flowView = savedView;
    } else {
        flowView = isMobileViewport() ? "list" : "graph";
    }
} catch (e) { }

/** Adiciona ou remove uma disciplina da lista 'Cursando agora'. */
export function toggleCur(id) {
    if (!hasCourse(id) || C[id].kind === "tcc") return;
    const cur = S.current || [];
    if (cur.some(r => r.id === id)) {
        S.current = cur.filter(r => r.id !== id);
    } else if (!passedSet().has(id)) {
        S.current = [...cur, fixCur({ id })];
    }
    update();
}

/** Fixa/desfixa a inspeção da cadeia de pré-requisitos de uma disciplina no fluxograma. */
export function inspectCard(id) {
    pinnedId = (id && hasCourse(id) && pinnedId !== id) ? id : null;
    hover(pinnedId);
    renderFlowInspect();
}

/** Move o foco do teclado entre os cards do fluxograma usando as setas direcionais. */
function navigateCardGrid(currentId, key) {
    const c = C[currentId];
    if (!c) return;
    const col = colOf(c);
    const list = colItems[col] || [];
    const rowIdx = list.indexOf(currentId);
    let targetId = null;

    if (key === "ArrowDown" && rowIdx < list.length - 1) {
        targetId = list[rowIdx + 1];
    } else if (key === "ArrowUp" && rowIdx > 0) {
        targetId = list[rowIdx - 1];
    } else if (key === "ArrowRight" || key === "ArrowLeft") {
        const dir = key === "ArrowRight" ? 1 : -1;
        for (let nc = col + dir; nc >= 0 && nc < HEADS.length; nc += dir) {
            const nList = colItems[nc] || [];
            if (nList.length) {
                targetId = nList[Math.min(Math.max(0, rowIdx), nList.length - 1)];
                break;
            }
        }
    }
    if (targetId && els[targetId] && typeof els[targetId].focus === "function") {
        els[targetId].focus();
    }
}

/** Constrói os cabeçalhos de coluna, cards de disciplinas e arestas SVG do fluxograma. */
export function build() {
    for (const k of Object.keys(pos)) delete pos[k];
    for (const k of Object.keys(els)) delete els[k];
    for (const k of Object.keys(colItems)) delete colItems[k];
    if (svg) svg.innerHTML = "";
    if (flow) {
        flow.querySelectorAll(".colh, .card").forEach(el => el.remove());
    }

    const rows = {};
    ORDER.forEach(id => {
        const c = C[id];
        const col = colOf(c);
        rows[col] = rows[col] || 0;
        (colItems[col] = colItems[col] || []).push(id);
        let r = rows[col]++;
        if (c.kind === "op" && col === 8) r += 0.4;
        pos[id] = { x: X0 + col * (CW + GX), y: Y0 + r * (CH + GY) };
    });

    pos["TCC"] = { x: X0 + 9 * (CW + GX), y: Y0 };

    HEADS.forEach((h, i) => {
        const d = document.createElement("div");
        d.className = "colh";
        d.style.left = (X0 + i * (CW + GX)) + "px";
        const subTxt = i < 8
            ? (i % 2 ? "semestre par" : "semestre ímpar")
            : i === 8
                ? (CUR.eletHeaderSub || "Eletivas")
                : "TCC + Complementares";
        d.innerHTML = `${esc(h)}<small>${esc(subTxt)}</small>`;
        flow.appendChild(d);
    });

    ORDER.forEach(id => {
        const c = C[id];
        const p = pos[id];
        const d = document.createElement("div");
        d.className = "card" + (c.ext ? " ext" : "");
        d.style.left = p.x + "px";
        d.style.top = p.y + "px";
        d.setAttribute("role", "button");
        d.setAttribute("tabindex", "0");
        d.dataset.id = id;

        const curBtnHtml = c.kind !== "tcc"
            ? `<button type="button" class="card-act card-cur" data-card-act="cur" ` +
              `title="Marcar/desmarcar como Cursando agora (atalho: tecla C)" aria-label="Cursando agora">📚</button>`
            : "";
        const infoBtnHtml =
            `<button type="button" class="card-act card-info" data-card-act="info" ` +
            `title="Ver pré-requisitos e disciplinas que libera (atalho: tecla I)" aria-label="Ver pré-requisitos">🔍</button>`;
        const starBtnHtml = c.kind === "el"
            ? `<button type="button" class="star" data-card-act="star" ` +
              `title="Escolher esta eletiva" aria-label="Escolher eletiva">★</button>`
            : "";

        const hFormatted = c.h.toFixed(1).replace(".", ",");
        d.innerHTML =
            `<div class="chk"></div>` +
            `<div class="card-acts">${infoBtnHtml}${curBtnHtml}</div>` +
            `<div class="n">${esc(c.name)}</div>` +
            `<div class="m"><span>${esc(id)} · ${esc(hFormatted)}h</span><span class="plan"></span></div>` +
            starBtnHtml;

        let clickT = null;
        let lastTouch = 0;
        d.ontouchstart = () => { lastTouch = Date.now(); };
        d.onclick = e => {
            const actBtn = e.target.closest && e.target.closest("[data-card-act]");
            const cardAct = actBtn ? actBtn.dataset.cardAct : e.target.dataset?.cardAct;
            if (cardAct === "star" || e.target.classList.contains("star")) {
                togglePlan(id);
                return;
            }
            if (cardAct === "cur") {
                toggleCur(id);
                return;
            }
            if (cardAct === "info") {
                inspectCard(id);
                return;
            }

            if (flowMode === "cur") {
                toggleCur(id);
                return;
            }
            if (flowMode === "info") {
                inspectCard(id);
                return;
            }

            const noHover = typeof window !== "undefined" &&
                typeof window.matchMedia === "function" &&
                window.matchMedia("(hover: none)").matches;
            const isTouch = (Date.now() - lastTouch < 600) || noHover;
            if (isTouch) {
                clearTimeout(clickT);
                toggle(id);
                return;
            }
            if (e.detail > 1) return;
            clearTimeout(clickT);
            clickT = setTimeout(() => toggle(id), 240);
        };

        d.ondblclick = e => {
            if (e.target.classList.contains("star") || e.target.dataset?.cardAct) return;
            clearTimeout(clickT);
            toggleCur(id);
        };

        d.onkeydown = e => {
            if (e.target !== d) return;
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (flowMode === "cur") toggleCur(id);
                else if (flowMode === "info") inspectCard(id);
                else toggle(id);
            } else if (e.key === "c" || e.key === "C") {
                e.preventDefault();
                toggleCur(id);
            } else if (e.key === "i" || e.key === "I") {
                e.preventDefault();
                inspectCard(id);
            } else if ((e.key === "s" || e.key === "S") && c.kind === "el") {
                e.preventDefault();
                togglePlan(id);
            } else if (e.key === "Escape" && pinnedId) {
                e.preventDefault();
                inspectCard(null);
            } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                navigateCardGrid(id, e.key);
            }
        };

        d.onmouseenter = () => hover(id);
        d.onmouseleave = () => hover(pinnedId);
        d.onfocus = () => hover(id);
        d.onblur = () => hover(pinnedId);
        flow.appendChild(d);
        els[id] = d;
    });

    const W = X0 * 2 + HEADS.length * (CW + GX) - GX;
    const maxRow = Math.max(...Object.values(rows));
    flow.style.width = W + "px";
    flow.style.height = (Y0 + (maxRow + 0.6) * (CH + GY) + 20) + "px";
    svg.setAttribute("width", W);
    svg.setAttribute("height", parseFloat(flow.style.height));

    ORDER.forEach(id => {
        C[id].pre.forEach(p => {
            const a = pos[p];
            const b = pos[id];
            const x1 = a.x + CW;
            const y1 = a.y + CH / 2;
            const x2 = b.x;
            const y2 = b.y + CH / 2;
            const dx = Math.max(40, (x2 - x1) / 2);
            const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
            pathEl.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
            pathEl.setAttribute("class", "e");
            pathEl.dataset.f = p;
            pathEl.dataset.t = id;
            svg.appendChild(pathEl);
        });
    });

    if (els.TCC1 && CUR.tccLbl) {
        const tccTitleEl = els.TCC1.querySelector(".n");
        tccTitleEl.innerHTML = `TCC 1 <span style='font-weight:400;color:var(--mut)'>(${esc(CUR.tccLbl)})</span>`;
    }
}

/** Destaca visualmente a cadeia de pré-requisitos e dependentes da disciplina `id`. */
export function hover(id) {
    const activeId = id || pinnedId;
    const cards = Object.values(els);
    const edges = [...svg.children];
    if (!activeId || !C[activeId]) {
        cards.forEach(c => c.classList.remove("dim", "hl", "pinned"));
        edges.forEach(e => e.classList.remove("dim", "hl"));
        return;
    }
    const A = anc(activeId);
    const D = desc(activeId);
    const chainSet = new Set([activeId, ...A, ...D]);

    ORDER.forEach(i => {
        els[i].classList.toggle("dim", !chainSet.has(i));
        els[i].classList.toggle("hl", chainSet.has(i) && i !== activeId);
        els[i].classList.toggle("pinned", i === pinnedId);
    });
    edges.forEach(e => {
        const on = chainSet.has(e.dataset.f) && chainSet.has(e.dataset.t);
        e.classList.toggle("hl", on);
        e.classList.toggle("dim", !on);
    });
}

/** Renderiza o painel de inspeção de pré-requisitos (#flowInspect) para suporte touch/teclado. */
function renderFlowInspect() {
    const box = $("flowInspect");
    if (!box) return;
    if (!pinnedId || !C[pinnedId]) {
        box.hidden = true;
        box.innerHTML = "";
        return;
    }
    const c = C[pinnedId];
    const P = passedSet();
    const isPassed = P.has(pinnedId);
    const isCur = !isPassed && (S.current || []).some(r => r.id === pinnedId);
    const isReady = c.pre.every(p => P.has(p));
    const statusText = isPassed
        ? "✓ Aprovada"
        : isCur
            ? "📚 Cursando agora"
            : isReady
                ? "Disponível"
                : "🔒 Bloqueada";
    const statusCls = isPassed ? "g" : isCur ? "y" : isReady ? "b" : "r";

    const preChips = c.pre.length
        ? c.pre.map(p => {
            const okCls = P.has(p) ? "ok" : "pend";
            const icon = P.has(p) ? "✓" : "🔒";
            return `<button type="button" class="fi-chip ${esc(okCls)}" data-fi-jump="${esc(p)}">` +
                   `${esc(icon)} ${esc(p)} · ${esc(C[p].name)}</button>`;
        }).join("")
        : `<span class="note">Nenhum (liberada desde o início)</span>`;

    const kidChips = c.kids.length
        ? c.kids.map(k =>
            `<button type="button" class="fi-chip" data-fi-jump="${esc(k)}">` +
            `→ ${esc(k)} · ${esc(C[k].name)}</button>`
        ).join("")
        : `<span class="note">Nenhuma diretamente</span>`;

    const passBtnLbl = isPassed ? "✓ Aprovada (desmarcar)" : "✓ Marcar aprovada";
    const curBtnHtml = c.kind !== "tcc"
        ? `<button type="button" class="btn-sm ${isCur ? "pri" : ""}" data-fi-act="cur" data-id="${esc(pinnedId)}">` +
          `${isCur ? "📚 Cursando (remover)" : "📚 Marcar cursando"}</button>`
        : "";
    const isElChosen = S.electivePlan.includes(pinnedId);
    const starBtnHtml = c.kind === "el"
        ? `<button type="button" class="btn-sm ${isElChosen ? "pri" : ""}" data-fi-act="star" data-id="${esc(pinnedId)}">` +
          `★ ${isElChosen ? "Eletiva escolhida" : "Escolher eletiva"}</button>`
        : "";

    const hStr = c.h.toFixed(1).replace(".", ",");
    box.hidden = false;
    box.innerHTML =
        `<div class="fi-head">` +
            `<div>` +
                `<b>${esc(c.name)}</b> ` +
                `<span class="note">(${esc(c.id)} · ${esc(hStr)}h · ${esc(HEADS[colOf(c)])})</span>` +
                `<span class="tag ${esc(statusCls)}" style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;margin-left:6px">` +
                    `${esc(statusText)}` +
                `</span>` +
            `</div>` +
            `<div class="fi-actions">` +
                `<button type="button" class="btn-sm ${isPassed ? "pri" : ""}" data-fi-act="pass" data-id="${esc(pinnedId)}">` +
                    `${esc(passBtnLbl)}` +
                `</button>` +
                `${curBtnHtml}` +
                `${starBtnHtml}` +
                `<button type="button" class="btn-ghost" data-fi-act="close" title="Fechar inspeção" aria-label="Fechar inspeção">✕</button>` +
            `</div>` +
        `</div>` +
        `<div class="fi-chains">` +
            `<div><small>Pré-requisitos diretos (${esc(anc(pinnedId).size)} na cadeia):</small> <div class="fi-chip-list">${preChips}</div></div>` +
            `<div><small>Libera diretamente (${esc(desc(pinnedId).size)} na cadeia):</small> <div class="fi-chip-list">${kidChips}</div></div>` +
        `</div>`;
}

/** Renderiza a visão alternativa/fallback em Lista por Semestre (#flowFallback) para celular e leitores de tela. */
function renderFlowFallback(P, when, chosen) {
    const fb = $("flowFallback");
    if (!fb) return;
    const groups = HEADS.map((title, colIdx) => ({
        title,
        sub: colIdx < 8
            ? (colIdx % 2 ? "semestre par" : "semestre ímpar")
            : colIdx === 8
                ? (CUR.eletHeaderSub || "Eletivas")
                : "TCC + Complementares",
        items: ORDER.filter(id => colOf(C[id]) === colIdx)
    }));

    fb.innerHTML = groups.map(g => {
        const doneCount = g.items.filter(id => P.has(id)).length;
        const cardsHtml = g.items.map(id => {
            const c = C[id];
            const isPassed = P.has(id);
            const isCur = !isPassed && (S.current || []).some(r => r.id === id);
            const isReady = c.pre.every(p => P.has(p));
            const isOff = (c.kind === "el" && !isPassed && !chosen.includes(id)) || (c.kind === "op" && !isPassed);
            const cr = (S.current || []).find(r => r.id === id);
            const rp = cr && !isPassed ? risk(cr).p : 0;
            const planTxt = cr && !isPassed
                ? "⚠ Risco " + Math.round(rp * 100) + "%"
                : ((!isPassed && when[id] !== undefined) ? "Previsto: " + label(when[id]) : "");

            const stBadge = isPassed
                ? `<span class="tag g">✓ Aprovada</span>`
                : isCur
                    ? `<span class="tag y">📚 Cursando</span>`
                    : isReady
                        ? `<span class="tag b">Disponível</span>`
                        : `<span class="tag r">🔒 Bloqueada</span>`;

            const preHtml = c.pre.length
                ? `<div class="fb-card-rel"><b>Pré-requisitos:</b> ` +
                  c.pre.map(p =>
                      `<span class="${P.has(p) ? "rel-ok" : "rel-pend"}">` +
                      `${P.has(p) ? "✓" : "🔒"} ${esc(C[p].name)} (${esc(p)})</span>`
                  ).join(" · ") +
                  `</div>`
                : "";

            const kidsHtml = c.kids.length
                ? `<div class="fb-card-rel"><b>Libera:</b> ` +
                  c.kids.map(k => `<span>${esc(C[k].name)} (${esc(k)})</span>`).join(" · ") +
                  `</div>`
                : "";

            const curBtnHtml = c.kind !== "tcc"
                ? `<button type="button" class="btn-xs ${isCur ? "pri" : ""}" data-fb-act="cur" ` +
                  `data-id="${esc(id)}" aria-pressed="${isCur ? "true" : "false"}">` +
                  `${isCur ? "📚 Cursando" : "+ Cursando"}</button>`
                : "";

            const isElSelected = S.electivePlan.includes(id);
            const isElActive = isElSelected || chosen.includes(id);
            const starBtnHtml = c.kind === "el"
                ? `<button type="button" class="btn-xs ${isElActive ? "pri" : ""}" data-fb-act="star" ` +
                  `data-id="${esc(id)}" aria-pressed="${isElSelected ? "true" : "false"}">★ Eletiva</button>`
                : "";

            const stateCls = isPassed ? "passed" : isCur ? "cur" : isReady ? "avail" : "";
            const hStr = c.h.toFixed(1).replace(".", ",");
            return (
                `<div class="fb-card ${esc(stateCls)} ${isOff ? "off" : ""} ${c.ext ? "ext" : ""}" data-id="${esc(id)}">` +
                    `<div class="fb-card-top">` +
                        `<div>` +
                            `<div class="fb-card-title">${esc(c.name)}</div>` +
                            `<div class="fb-card-meta">${esc(id)} · ${esc(hStr)}h` +
                            `${c.ext ? " · Extensão" : ""}${planTxt ? " · " + esc(planTxt) : ""}</div>` +
                        `</div>` +
                        `<div class="fb-card-badges">${stBadge}</div>` +
                    `</div>` +
                    `${preHtml}` +
                    `${kidsHtml}` +
                    `<div class="fb-card-actions">` +
                        `<button type="button" class="btn-xs ${isPassed ? "pri" : ""}" data-fb-act="pass" ` +
                            `data-id="${esc(id)}" aria-pressed="${isPassed ? "true" : "false"}">` +
                            `${isPassed ? "✓ Aprovada" : "Marcar aprovada"}` +
                        `</button>` +
                        `${curBtnHtml}` +
                        `${starBtnHtml}` +
                    `</div>` +
                `</div>`
            );
        }).join("");

        return (
            `<section class="fb-sem-group">` +
                `<header class="fb-sem-head">` +
                    `<h4>${esc(g.title)} <small>${esc(g.sub)}</small></h4>` +
                    `<span class="note">${esc(doneCount)}/${esc(g.items.length)} concluídas</span>` +
                `</header>` +
                `<div class="fb-sem-list">${cardsHtml}</div>` +
            `</section>`
        );
    }).join("");
}

/** Alterna o estado de aprovação (checkpoint) de uma disciplina em cascata. */
export function toggle(id) {
    const finCur = (S.current || []).find(x => x.id === id);
    if (finCur && finCur.fase === "Finalizada") {
        finCur.fase = "Consumindo";
        update();
        return;
    }
    const P = new Set(S.passed);
    if (P.has(id)) {
        P.delete(id);
        desc(id).forEach(x => P.delete(x));
    } else {
        P.add(id);
        anc(id).forEach(x => P.add(x));
    }
    S.passed = [...P];
    update();
}

/** Alterna a escolha manual de uma disciplina eletiva (★). */
export function togglePlan(id) {
    const set = new Set(S.electivePlan);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    S.electivePlan = [...set];
    update();
}

// ---------- ATUALIZAÇÃO GERAL (KPIs, TIMELINE E SUB-PAINÉIS) ----------
export function update() {
    syncSubjectGrades();
    const P = passedSet();
    const best = simulate(0, 0);
    const plan = +S.scen === 1 ? simulate(0, 1) : best;
    const when = {};
    plan.terms.forEach(t => t.taken.forEach(id => { when[id] = t.k; }));
    const chosen = electivesPlanned(P);

    ORDER.forEach(id => {
        const c = C[id];
        const el = els[id];
        const ready = c.pre.every(p => P.has(p));
        const isPassed = P.has(id);
        const isCur = !isPassed && (S.current || []).some(r => r.id === id);

        el.classList.toggle("passed", isPassed);
        el.classList.toggle("cur", isCur);
        el.classList.toggle("avail", !isPassed && ready && c.kind !== "tcc");
        el.classList.toggle("off", (c.kind === "el" && !isPassed && !chosen.includes(id)) || (c.kind === "op" && !isPassed));
        el.setAttribute("aria-pressed", isPassed ? "true" : "false");

        const stText = isPassed ? "Aprovada" : isCur ? "Cursando agora" : ready ? "Disponível" : "Bloqueada";
        el.setAttribute("aria-label", `${c.name} (${id}), ${c.h.toFixed(1).replace(".", ",")}h, ${stText}`);

        const pl = el.querySelector(".plan");
        const cr = (S.current || []).find(r => r.id === id);
        const rp = cr && !isPassed ? risk(cr).p : 0;
        el.classList.toggle("hi", rp >= 0.6);
        pl.textContent = cr && !isPassed
            ? "⚠ " + Math.round(rp * 100) + "%"
            : ((!isPassed && when[id] !== undefined) ? label(when[id]) : "");

        const st = el.querySelector(".star");
        if (st) st.classList.toggle("on", S.electivePlan.includes(id) || chosen.includes(id));
        const curBtn = el.querySelector(".card-cur");
        if (curBtn) curBtn.classList.toggle("on", isCur);
        const infoBtn = el.querySelector(".card-info");
        if (infoBtn) infoBtn.classList.toggle("on", pinnedId === id);
    });

    svg.querySelectorAll("path.e").forEach(e => e.classList.toggle("pass", P.has(e.dataset.f)));
    hover(pinnedId);
    renderFlowInspect();
    renderFlowFallback(P, when, chosen);

    // Cálculo dos KPIs do topo
    const obrEstDoneH = OBR.concat(EST).filter(i => P.has(i)).reduce((s, i) => s + C[i].h, 0);
    const eletDoneH = ELETIVAS.filter(i => P.has(i)).slice(0, CUR.eletNeed || 2).reduce((s, i) => s + C[i].h, 0);
    const tccDoneH = TCC_IDS.filter(i => P.has(i)).reduce((s, i) => s + C[i].h, 0);
    const acDoneH = S.acDone ? AC_REQ : Math.min(AC_REQ, acTotal());
    const doneH = obrEstDoneH + eletDoneH + tccDoneH + acDoneH;

    const totalH = CUR.totalH;
    const pct = Math.min(100.0, (doneH / totalH) * 100.0);
    const pend = OBR.filter(i => !P.has(i)).length;
    const min = best.n;
    const mc = monte(S.failRate / 100);
    const activeCurList = (S.current || []).filter(r => !P.has(r.id));
    const exp = activeCurList.reduce((s, r) => s + risk(r).p, 0);

    const fin = n => (n === Infinity ? "—" : label(n - 1));
    const f = n => (n === Infinity ? "∞" : n);
    const obrPassedCount = P.size ? [...P].filter(i => C[i].kind === "ob").length : 0;
    const pctStr = pct.toFixed(2).replace(".", ",");
    const doneHStr = doneH.toFixed(2).replace(".", ",");
    const expStr = exp.toFixed(1).replace(".", ",");

    const expKpiHtml = activeCurList.length
        ? `<div class="kpi">` +
              `<b class="${exp >= 3 ? "warn" : ""}">${esc(expStr)}</b>` +
              `<small>reprovações esperadas neste semestre (de ${esc(activeCurList.length)})</small>` +
          `</div>`
        : "";

    $("kpis").innerHTML =
        `<div class="kpi main"><b>${esc(f(min))} sem.</b><small>Mínimo restante · conclui em ${esc(fin(min))}</small></div>` +
        `<div class="kpi"><b>${esc(f(mc.med))} sem.</b><small>Provável (${esc(S.failRate)}% de falha) · ${esc(fin(mc.med))}</small></div>` +
        `<div class="kpi"><b class="${mc.p90 > 16 ? "warn" : ""}">${esc(f(mc.p90))} sem.</b><small>Pessimista (P90) · ${esc(fin(mc.p90))}</small></div>` +
        `<div class="kpi"><b>${esc(pctStr)}%</b><small>${esc(doneHStr)}h de ${esc(totalH)}h</small></div>` +
        `<div class="kpi"><b>${esc(pend)}</b><small>obrigatórias pendentes</small></div>` +
        `<div class="kpi"><b>${esc(obrPassedCount)}/${esc(OBR.length)}</b><small>obrigatórias aprovadas</small></div>` +
        expKpiHtml;

    $("bar").style.width = pct + "%";

    // Linha do tempo (#timeline)
    const T = $("timeline");
    T.innerHTML = "";
    plan.terms.forEach((t, i) => {
        const h = t.taken.reduce((s, id) => s + C[id].h, 0);
        const d = document.createElement("div");
        d.className = "term" + (i === plan.terms.length - 1 ? " last" : "");
        const listHtml = t.taken.length
            ? `<ul>${t.taken.map(id => `<li>${esc(C[id].name)}</li>`).join("")}</ul>`
            : `<div class="note">Nenhuma disciplina disponível neste semestre (espera pela oferta).</div>`;
        d.innerHTML =
            `<h4>${esc(i + 1)}º período · ${esc(label(t.k))}<span>${esc(t.taken.length)} disc. · ${esc(h.toFixed(0))}h</span></h4>` +
            listHtml;
        T.appendChild(d);
    });

    if (plan.n === Infinity) {
        T.innerHTML = "<div class='note warn'>Não foi possível montar o plano (verifique o limite de disciplinas/oferta).</div>";
    } else if (!plan.terms.length) {
        T.innerHTML = "<div class='note'>🎉 Todas as disciplinas obrigatórias, eletivas e o TCC estão marcados como concluídos. Falta apenas confirmar as atividades complementares se não marcou.</div>";
    }

    // Sincronização de controles de formulário
    $("startYear").value = S.startYear;
    $("startHalf").value = S.startHalf;
    $("maxLoad").value = S.maxLoad;
    $("loadV").textContent = S.maxLoad;
    $("failRate").value = S.failRate;
    $("failV").textContent = S.failRate + "%";
    $("parity").checked = S.respectParity;
    $("ac").checked = S.acDone;
    $("tccBase").value = S.tccBase || "total";
    $("expect").value = S.expect;
    $("expV").textContent = S.expect + "%";
    $("scen").value = S.scen || 0;

    renderCurrent();
    renderTasks();
    renderHor();
    renderAC();
    if (renderEquivFn) renderEquivFn();
    persist();
}

// ---------- ABA: CURSANDO AGORA / ESTATÍSTICAS ----------
function resetCursForm() {
    const wrap = $("curFormWrap");
    if (wrap) wrap.style.display = "none";
    if ($("curNota")) $("curNota").value = "";
    if ($("curPts")) $("curPts").value = "";
    if ($("curFalt")) $("curFalt").value = "";
    if ($("curAdd")) $("curAdd").textContent = "Salvar";
}

function renderCurrent() {
    const all = S.current || [];
    const P = new Set(S.passed);
    const used = new Set(all.map(r => r.id));
    const cur = sortCur(all);

    $("curSort").value = S.curSort || "add";
    const sel = $("curSel");
    sel.innerHTML = ORDER
        .filter(i => !used.has(i) && !P.has(i) && C[i].kind !== "tcc")
        .map(i => `<option value="${esc(i)}">${esc(C[i].name)}</option>`)
        .join("");

    $("curBody").innerHTML = cur.map(r => {
        const k = risk(r);
        const pc = Math.round(k.p * 100);
        const st = k.p >= 0.7
            ? "Crítico"
            : k.p >= 0.4
                ? "Moderado"
                : k.p >= 0.15
                    ? "Recuperável"
                    : "Bem viável";
        const pr = !r.prio || r.prio === "Auto"
            ? (k.p >= 0.15 && k.p <= 0.75 ? "Alta" : "Baixa")
            : r.prio;
        const prioKey = PRIO.includes(r.prio) ? r.prio : "Auto";
        const faseKey = FASE.includes(r.fase) ? r.fase : "Consumindo";

        const ts = (S.tasks || []).filter(t => t.subj === r.id);
        const hasTasks = ts.length > 0;
        const isLinked = hasTasks && r.autoGrade !== false;
        const gradedCount = ts.filter(t => taskStatus(t) === "avaliada" && t.got != null && t.got !== "").length;
        const evaluatingCount = ts.filter(t => taskStatus(t) === "avaliando").length;

        const tasksActionBtn = hasTasks
            ? `<button type="button" class="cur-tasks-btn" data-act="view-tasks" data-subj="${esc(r.id)}" ` +
              `title="Ver e gerenciar as avaliações desta matéria">📝 ${esc(ts.length)} avaliação(ões)</button>`
            : `<button type="button" class="cur-tasks-btn add" data-act="add-tasks" data-subj="${esc(r.id)}" ` +
              `title="Cadastrar provas e trabalhos para esta matéria">+ avaliar</button>`;

        let notaColHtml = "";
        const barW = Math.min(100, (Number(r.nota) || 0) * 10);
        if (isLinked) {
            const evalSpan = evaluatingCount
                ? ` · <span style="color:#f59e0b">${esc(evaluatingCount)} avaliando</span>`
                : "";
            notaColHtml =
                `<div class="mini">` +
                    `<input type="number" min="0" max="10" step="0.1" value="${esc(r.nota)}" data-k="nota" class="in-linked" readonly ` +
                        `title="Nota vinculada às avaliações corrigidas. Clique em 🔗 para editar manualmente.">` +
                    `<button type="button" class="btn-link-icon on" data-act="toggle-link" data-subj="${esc(r.id)}" ` +
                        `title="Vinculado às avaliações. Clique para editar manualmente.">🔗</button>` +
                    `<div class="pb"><div style="width:${esc(barW)}%"></div></div>` +
                `</div>` +
                `<div class="note-sync" title="Calculada a partir das avaliações corrigidas">` +
                    `🔗 ${esc(gradedCount)} nota(s) lançada(s)${evalSpan}` +
                `</div>`;
        } else {
            const unlockBtn = hasTasks
                ? `<button type="button" class="btn-link-icon off" data-act="toggle-link" data-subj="${esc(r.id)}" ` +
                  `title="Desvinculado. Clique para vincular às avaliações.">🔓</button>`
                : "";
            notaColHtml =
                `<div class="mini">` +
                    `<input type="number" min="0" max="10" step="0.1" value="${esc(r.nota)}" data-k="nota">` +
                    `${unlockBtn}` +
                    `<div class="pb"><div style="width:${esc(barW)}%"></div></div>` +
                `</div>` +
                `<div class="note">${hasTasks ? "Manual (desvinculada)" : ""}</div>`;
        }

        const maxPossivel = Math.round((r.nota + r.pts) * 10) / 10;
        const needToPass = Math.round((6 - r.nota) * 10) / 10;
        let goalStatus = "";
        if (r.nota >= 6.0) {
            goalStatus = `<span style="color:var(--ok)">✓ Meta 6.0 atingida!</span>`;
        } else if (maxPossivel >= 6.0) {
            goalStatus = `precisa de ${esc(fmt(needToPass))} de ${esc(fmt(r.pts))}`;
        } else {
            goalStatus = `<span style="color:#f87171">máx ${esc(fmt(maxPossivel))} (abaixo de 6)</span>`;
        }

        const ptsColHtml = isLinked
            ? `<div class="mini">` +
                  `<input type="number" min="0" max="10" step="0.1" value="${esc(r.pts)}" data-k="pts" class="in-linked" readonly ` +
                      `title="Pontos a receber das avaliações pendentes">` +
              `</div>` +
              `<div class="note">${goalStatus}</div>`
            : `<div class="mini">` +
                  `<input type="number" min="0" max="10" step="0.1" value="${esc(r.pts)}" data-k="pts">` +
              `</div>` +
              `<div class="note">máx. possível: ${esc(fmt(maxPossivel))}</div>`;

        const folgaNote = k.folga < 0
            ? "passou " + esc(-k.folga) + " do limite"
            : "folga: " + esc(k.folga) + " (limite " + esc(k.limit) + ")";
        const riskCellHtml = faseKey === "Finalizada"
            ? `<span class="rk" style="color:var(--ok)">✓ Aprovada</span>`
            : `<span class="rk">${esc(pc)}%</span> ` +
              `<span class="tag ${esc(TAGC[st])}" style="padding:2px 6px;border-radius:6px;font-size:12px;font-weight:600">${esc(st)}</span>` +
              `<div class="note">${k.pF > k.pN ? "pesa mais: faltas" : "pesa mais: nota"}</div>`;

        return (
            `<tr data-id="${esc(r.id)}" class="${faseKey === "Finalizada" ? "fin" : ""}">` +
                `<td><b>${esc(C[r.id].name)}</b><div class="note">${esc(r.id)}</div>${tasksActionBtn}</td>` +
                `<td>${notaColHtml}</td>` +
                `<td>${ptsColHtml}</td>` +
                `<td>` +
                    `<div class="mini"><input type="number" min="0" value="${esc(r.falt)}" data-k="falt"></div>` +
                    `<div class="note" style="color:${k.folga <= 2 ? "#f87171" : "var(--mut)"}">${folgaNote}</div>` +
                `</td>` +
                `<td>` +
                    `<div class="mini">` +
                        `<input class="sm" type="number" min="0" value="${esc(r.cum)}" data-k="cum"> / ` +
                        `<input class="sm" type="number" min="0" value="${esc(r.prev)}" data-k="prev">` +
                    `</div>` +
                    `<div class="note" style="color:${k.freq < 75 ? "#f87171" : "var(--mut)"}">frequência ${esc(fmt(k.freq))}%</div>` +
                `</td>` +
                `<td>${riskCellHtml}</td>` +
                `<td>` +
                    `<select class="tag ${esc(TAGC[prioKey])}" data-k="prio">${optList(PRIO, prioKey)}</select>` +
                    `<div class="note">${prioKey === "Auto" ? "sugerida: " + esc(pr) : ""}</div>` +
                `</td>` +
                `<td><select class="tag ${esc(TAGC[faseKey])}" data-k="fase">${optList(FASE, faseKey)}</select></td>` +
                `<td><button class="x" data-rm title="Remover">✕</button></td>` +
            `</tr>`
        );
    }).join("");

    $("curEmpty").style.display = cur.length ? "none" : "";
    const n = cur.length;
    if (n) {
        const avgNota = fmt(cur.reduce((s, r) => s + r.nota, 0) / n);
        const avgFreq = fmt(cur.reduce((s, r) => s + risk(r).freq, 0) / n);
        const sumRisk = fmt(cur.reduce((s, r) => s + risk(r).p, 0));
        $("curAvg").textContent = `Média das notas: ${avgNota} · Frequência média: ${avgFreq}%`;
    } else {
        $("curAvg").textContent = "";
    }
}

/** Exibe um alerta temporário (toast) no rodapé da tela. */
export function toast(msg) {
    let t = $("toast");
    if (!t) {
        t = document.createElement("div");
        t.id = "toast";
        t.style.cssText =
            "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);" +
            "background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;z-index:9999";
        document.body.appendChild(t);
    }
    t.textContent = "⚠️ " + msg;
    t.style.display = "block";
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.display = "none"; }, 3500);
}

// ---------- ABA: HORÁRIOS ----------
function renderHor() {
    const H = S.hor.cells;
    const P = passedSet();
    const cur = (S.current || []).map(r => r.id);
    const hoje = new Date().getDay() - 1;
    const curHalf = semAtual();
    const yr = new Date().getFullYear();

    const disp = ORDER.filter(id => {
        const c = C[id];
        if (cur.includes(id) || P.has(id) || c.kind === "tcc" || c.kind === "op") return false;
        if (!c.pre.every(p => P.has(p))) return false;
        return c.kind !== "ob" || ((c.sem % 2) ? 1 : 2) === curHalf;
    });

    const op = (x, sel) =>
        `<option value="${esc(x)}"${x === sel ? " selected" : ""}>${esc(x)} · ${esc(C[x].name)}</option>`;
    const opts = sel =>
        `<option value="">—</option>` +
        (cur.length ? `<optgroup label="Cursando agora">${cur.map(x => op(x, sel)).join("")}</optgroup>` : "") +
        `<optgroup label="Ofertadas em ${esc(yr)}/${esc(curHalf)}">${disp.map(x => op(x, sel)).join("")}</optgroup>` +
        (sel && hasCourse(sel) && !cur.includes(sel) && !disp.includes(sel) ? op(sel, sel) : "");

    $("horNote").textContent =
        `Semestre atual: ${yr}/${curHalf}. A lista traz o que você cursa e o que é ofertado neste semestre ` +
        `(com pré-requisitos cumpridos). Escolher uma matéria aqui também a coloca em "Cursando agora".`;

    document.querySelectorAll("table.hor thead th").forEach((th, j) => {
        th.classList.toggle("today", j - 1 === hoje);
    });

    $("horBody").innerHTML = HORAS.map((h, i) =>
        `<tr><th>${esc(h)}</th>` +
        DIAS.map((_d, j) => {
            const c = H[i + "-" + j] || {};
            return (
                `<td class="${j === hoje ? "today" : ""}">` +
                    `<select data-c="${esc(i)}-${esc(j)}" data-k="id">${opts(c.id)}</select>` +
                    `<input data-c="${esc(i)}-${esc(j)}" data-k="sala" placeholder="sala" value="${esc(c.sala || "")}">` +
                `</td>`
            );
        }).join("") +
        `</tr>`
    ).join("");
}

/** Confirmação em dois cliques no próprio botão (evita bloqueio de window.confirm em iframes). */
export function confirma(btn, txt, fn) {
    if (btn.dataset.arm) {
        clearTimeout(+btn.dataset.arm);
        delete btn.dataset.arm;
        btn.textContent = btn.dataset.t;
        fn();
        return;
    }
    btn.dataset.t = btn.textContent;
    btn.textContent = txt;
    btn.dataset.arm = setTimeout(() => {
        delete btn.dataset.arm;
        btn.textContent = btn.dataset.t;
    }, 4000);
}

// ---------- ABA: ATIVIDADES COMPLEMENTARES ----------
function renderAC() {
    $("acDet").style.display = CUR.acTable ? "" : "none";
    $("acManual").style.display = CUR.acTable ? "none" : "";
    $("acHoras").value = S.acHoras || "";
    const { rows, g, tot } = acCalc();
    const seen = {};
    let sec = "";
    let h = "";

    (CUR.acTable ? AC : []).forEach((a, i) => {
        const r = rows[i];
        const v = +S.ac[i] || 0;
        if (a[0] !== sec) {
            sec = a[0];
            h += `<tr class="sec"><td colspan="6"><b>${esc(sec)} – ${esc(AC_SEC[sec])}</b></td></tr>`;
        }
        const isFirstInGroup = !seen[r.k];
        seen[r.k] = 1;
        const overCapWarn = v > a[5] ? ` <span class="warn">(só ${esc(a[5])} contam)</span>` : "";
        const groupCell = isFirstInGroup
            ? `${esc(fmt(g[r.k].ct))} h`
            : `<span class='note'>no grupo</span>`;
        const maxCell = isFirstInGroup ? `${esc(a[4])} h` : "";

        h +=
            `<tr>` +
                `<td>${esc(a[1])}<div class="note">${esc(a[3])} · máx. ${esc(a[5])} unid.${overCapWarn}</div></td>` +
                `<td>${esc(a[2])} h</td>` +
                `<td><div class="mini"><input type="number" min="0" step="0.5" value="${esc(S.ac[i] || "")}" data-ac="${esc(i)}"></div></td>` +
                `<td>${esc(fmt(r.ob))} h</td>` +
                `<td>${groupCell}</td>` +
                `<td>${maxCell}</td>` +
            `</tr>`;
    });

    $("acBody").innerHTML = h;
    $("acBar").style.width = (AC_REQ ? Math.min(100, (tot / AC_REQ) * 100) : 100) + "%";
    const statusSuffix = tot >= AC_REQ
        ? " · meta atingida ✓"
        : ` · faltam ${fmt(AC_REQ - tot)} h`;
    $("acSum").textContent = `${fmt(tot)} h de ${AC_REQ} h${statusSuffix}`;
}

// ---------- ABA: PRAZOS (TAREFAS, PROVAS, NOTAS E CALENDÁRIO) ----------
let calMonth = new Date();
calMonth.setDate(1);
let editingTaskId = null;

function resetTaskForm() {
    editingTaskId = null;
    const wrap = $("trFormWrap");
    if (wrap) wrap.style.display = "none";
    if ($("trFormLegend")) $("trFormLegend").textContent = "Adicionar nova atividade";
    if ($("trTitle")) $("trTitle").value = "";
    if ($("trGot")) $("trGot").value = "";
    if ($("trStatus")) $("trStatus").value = "pendente";
    if ($("trPts")) $("trPts").value = "2.0";
    if ($("trEff")) $("trEff").value = "3.0";
    if ($("trAdd")) $("trAdd").textContent = "Salvar";
}

function openEditTaskModal(t) {
    editingTaskId = t.id;
    const wrap = $("trFormWrap");
    if (!wrap) return;
    wrap.style.display = "block";
    if ($("trFormLegend")) $("trFormLegend").textContent = "Editar atividade — " + t.title;
    if ($("trSubj")) $("trSubj").value = t.subj;
    if ($("trType")) $("trType").value = t.type;
    if ($("trStatus")) $("trStatus").value = taskStatus(t);
    if ($("trTitle")) $("trTitle").value = t.title;
    if ($("trDue")) $("trDue").value = t.due || "";
    if ($("trPts")) $("trPts").value = t.pts;
    if ($("trGot")) $("trGot").value = t.got != null ? t.got : "";
    if ($("trEff")) $("trEff").value = t.eff;
    if ($("trAdd")) $("trAdd").textContent = "Atualizar Atividade";
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    if ($("trTitle")) $("trTitle").focus();
}

window.openNewTaskModal = function (subjId) {
    if (window.showTab) window.showTab("t-tr");
    resetTaskForm();
    const wrap = $("trFormWrap");
    if (wrap) wrap.style.display = "block";
    if (subjId && $("trSubj")) $("trSubj").value = subjId;
    if (wrap) wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    if ($("trTitle")) $("trTitle").focus();
};

window.openTasksForSubject = function (subjId) {
    if (window.showTab) window.showTab("t-tr");
    S.trFilterSubj = subjId;
    S.trView = "subjects";
    update();
    setTimeout(() => {
        const card = $("subj-card-" + subjId);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
};

function renderTasks() {
    syncSubjectGrades();
    const cur = S.current || [];
    const today = pd(ymd(new Date()));

    const selForm = $("trSubj");
    if (selForm) {
        const prev = selForm.value;
        selForm.innerHTML =
            cur.map(r => `<option value="${esc(r.id)}">${esc(C[r.id].name)}</option>`).join("") ||
            `<option value="">(adicione matérias em "Cursando agora")</option>`;
        if (prev && cur.some(r => r.id === prev)) selForm.value = prev;
    }

    const selFilter = $("trFilterSubj");
    if (selFilter) {
        const prevF = S.trFilterSubj || "";
        selFilter.innerHTML =
            `<option value="">Todas as matérias (${esc(cur.length)})</option>` +
            cur.map(r =>
                `<option value="${esc(r.id)}"${r.id === prevF ? " selected" : ""}>${esc(C[r.id].name)}</option>`
            ).join("");
    }

    if ($("trFilterType")) $("trFilterType").value = S.trFilterType || "";
    if ($("trFilterStatus")) $("trFilterStatus").value = S.trFilterStatus || "unresolved";
    if ($("trSort")) $("trSort").value = S.trSort || "prio";

    if ($("trDue") && !$("trDue").value) $("trDue").value = ymd(addDays(today, 7));
    if ($("trCap")) {
        $("trCap").value = S.cap;
        if ($("capV")) $("capV").textContent = S.cap + " h";
    }
    if ($("trWk")) $("trWk").checked = S.weekend;

    const plan = planTasks();
    const activeView = S.trView || "list";

    document.querySelectorAll(".tr-v-btn").forEach(b => {
        const act = b.dataset.v === activeView;
        b.classList.toggle("act", act);
        b.setAttribute("aria-selected", act ? "true" : "false");
        b.setAttribute("tabindex", act ? "0" : "-1");
    });

    const setPane = (id, show) => {
        const el = $(id);
        if (!el) return;
        el.style.display = show ? "" : "none";
        el.hidden = !show;
        el.setAttribute("aria-hidden", show ? "false" : "true");
    };
    setPane("trPaneList", activeView === "list");
    setPane("trPaneSubjects", activeView === "subjects");
    setPane("trPaneCal", activeView === "cal");

    renderTasksList(plan, today);
    renderTasksSubjects();
    renderCal(plan);
}

function renderTasksList(plan, today) {
    const T = S.tasks || [];
    const fSubj = S.trFilterSubj || "";
    const fType = S.trFilterType || "";
    const fStatus = S.trFilterStatus || "unresolved";
    const sort = S.trSort || "prio";

    const filtered = T.filter(t => {
        const st = taskStatus(t);
        if (fSubj && t.subj !== fSubj) return false;
        if (fType && t.type !== fType) return false;
        if (fStatus === "unresolved" && st === "avaliada") return false;
        if (fStatus === "pendente" && st !== "pendente") return false;
        if (fStatus === "avaliando" && st !== "avaliando") return false;
        if (fStatus === "avaliada" && st !== "avaliada") return false;
        return true;
    });

    filtered.sort((a, b) => {
        if (sort === "due") return (a.due || "9999").localeCompare(b.due || "9999");
        if (sort === "subj") return (C[a.subj]?.name || "").localeCompare(C[b.subj]?.name || "", "pt-BR");
        if (sort === "pts") return b.pts - a.pts;
        return prioOf(b, today, b.eff) - prioOf(a, today, a.eff);
    });

    const body = $("trListBody");
    if (!body) return;

    if (filtered.length === 0) {
        body.innerHTML = "";
        if ($("trListEmpty")) $("trListEmpty").style.display = "";
        return;
    }
    if ($("trListEmpty")) $("trListEmpty").style.display = "none";

    body.innerHTML = filtered.map(t => {
        const st = taskStatus(t);
        const p = plan[t.id];
        const pr = prioOf(t, today, t.eff);
        const [lb, cl] = prioLbl(pr);
        const d = t.due ? dayDiff(today, pd(t.due)) : null;

        let dueBadge = "";
        if (st === "avaliada") {
            dueBadge = `<span class="due-badge tag g">Nota lançada ✓</span>`;
        } else if (st === "avaliando") {
            dueBadge = `<span class="due-badge status-eval">🔍 Em avaliação</span>`;
        } else if (d === null) {
            dueBadge = `<span class="due-badge note">Sem data</span>`;
        } else if (d < 0) {
            dueBadge = `<span class="due-badge tag r">Atrasada ${esc(-d)}d</span>`;
        } else if (d === 0) {
            dueBadge = `<span class="due-badge tag r">Hoje! ⚡</span>`;
        } else if (d === 1) {
            dueBadge = `<span class="due-badge tag y">Amanhã</span>`;
        } else if (d <= 3) {
            dueBadge = `<span class="due-badge tag y">Em ${esc(d)} dias</span>`;
        } else {
            dueBadge = `<span class="due-badge tag b">Em ${esc(d)} dias</span>`;
        }

        const startPlan = p && p.start && st === "pendente" ? dfmt(p.start) : null;
        const safeType = VALID_TASK_TYPES.includes(t.type) ? t.type : "Outro";
        const typeClass = safeType.toLowerCase();
        const rowCls = st === "avaliada" ? "fin" : st === "avaliando" ? "is-evaluating" : "";
        const weightPct = Math.round((t.pts / subjTotals(t.subj).total) * 100);
        const gotPlaceholder = st === "avaliando" ? "aguardando" : "—";
        const gotTitle = st === "avaliando"
            ? "Aguardando professor corrigir (digite para lançar nota)"
            : "Nota obtida";

        return (
            `<tr data-id="${esc(t.id)}" class="${esc(rowCls)}">` +
                `<td style="text-align:center">` +
                    `<select class="tag-status status-${esc(st)}" data-act="set-status" title="Alterar status da avaliação">` +
                        `<option value="pendente"${st === "pendente" ? " selected" : ""}>⏳ A Fazer</option>` +
                        `<option value="avaliando"${st === "avaliando" ? " selected" : ""}>🔍 Avaliando</option>` +
                        `<option value="avaliada"${st === "avaliada" ? " selected" : ""}>✅ Avaliada</option>` +
                    `</select>` +
                `</td>` +
                `<td>` +
                    `<div class="tr-task-title-cell">` +
                        `<span class="tag-type tag-${esc(typeClass)}">${esc(TYPE_ICON[safeType] || "📌")} ${esc(safeType)}</span>` +
                        `<b class="tr-title-text" data-act="edit" title="Clique para editar">${esc(t.title)}</b>` +
                    `</div>` +
                `</td>` +
                `<td>` +
                    `<button type="button" class="tr-subj-tag" data-act="filter-subj" data-subj="${esc(t.subj)}" title="Filtrar por esta matéria">` +
                        `${esc(C[t.subj]?.name || t.subj)}` +
                    `</button>` +
                `</td>` +
                `<td>` +
                    `<div class="tr-due-cell"><span>${esc(dfmt(t.due))}</span>${dueBadge}</div>` +
                    `${startPlan ? `<div class="note">Ideal começar: ${esc(startPlan)}</div>` : ""}` +
                `</td>` +
                `<td>` +
                    `<span class="tag ${esc(cl)}" style="padding:2px 8px;border-radius:6px;font-weight:600">${esc(lb)} · ${esc(Math.round(pr))}</span>` +
                    `<div class="note">${esc(fmt(t.pts))} pts (${esc(weightPct)}% da matéria)</div>` +
                `</td>` +
                `<td>` +
                    `<div class="tr-grade-edit">` +
                        `<input type="number" min="0" max="10" step="0.1" class="tr-in-got" data-act="set-got" ` +
                            `value="${esc(t.got != null ? t.got : "")}" placeholder="${esc(gotPlaceholder)}" title="${esc(gotTitle)}">` +
                        `<span class="note">/ <input type="number" min="0" step="0.5" class="tr-in-pts" data-act="set-pts" ` +
                            `value="${esc(t.pts)}" title="Pontos que vale"> pts</span>` +
                    `</div>` +
                    `${st === "avaliando" ? `<div class="note" style="color:#f59e0b">⏳ Aguardando nota</div>` : ""}` +
                    `${st === "avaliada" && t.got != null ? `<div class="note" style="color:var(--ok)">✓ Nota lançada</div>` : ""}` +
                `</td>` +
                `<td>` +
                    `<div class="tr-eff-cell">` +
                        `<input type="number" min="0.5" step="0.5" class="tr-in-eff" data-act="set-eff" value="${esc(t.eff)}"> h` +
                    `</div>` +
                `</td>` +
                `<td style="text-align:center"><button class="x" data-act="rm" title="Excluir avaliação">✕</button></td>` +
            `</tr>`
        );
    }).join("");
}

function renderTasksSubjects() {
    const cur = S.current || [];
    const container = $("trSubjectsCards");
    if (!container) return;

    const fSubj = S.trFilterSubj || "";
    const subjectsToShow = fSubj ? cur.filter(r => r.id === fSubj) : cur;

    if (subjectsToShow.length === 0) {
        container.innerHTML = "";
        if ($("trSubjEmpty")) $("trSubjEmpty").style.display = "";
        return;
    }
    if ($("trSubjEmpty")) $("trSubjEmpty").style.display = "none";

    container.innerHTML = subjectsToShow.map(r => {
        const id = r.id;
        const ts = (S.tasks || []).filter(t => t.subj === id);
        const gradedTasks = ts.filter(t => taskStatus(t) === "avaliada" && t.got != null && t.got !== "");
        const evaluatingTasks = ts.filter(t => taskStatus(t) === "avaliando");
        const pendingTasks = ts.filter(t => taskStatus(t) === "pendente");

        const nota = r.nota;
        const pts = r.pts;
        const maxPossivel = Math.round((nota + pts) * 10) / 10;

        let statusTag = "";
        let gradeColorClass = "pass";
        if (nota >= 6.0) {
            statusTag = `<span class="tag g" style="font-weight:600">🎉 Aprovado por nota! (≥ 6.0)</span>`;
            gradeColorClass = "pass";
        } else if (maxPossivel >= 6.0) {
            const need = Math.round((6.0 - nota) * 10) / 10;
            statusTag = `<span class="tag y" style="font-weight:600">Falta ${esc(fmt(need))} pts para média 6.0</span>`;
            gradeColorClass = "warn";
        } else {
            statusTag = `<span class="tag r" style="font-weight:600">⚠️ Risco: máx. ${esc(fmt(maxPossivel))} (abaixo de 6.0)</span>`;
            gradeColorClass = "crit";
        }

        const pctObt = Math.min(100, Math.max(0, nota * 10));
        const pctPend = Math.min(100 - pctObt, Math.max(0, pts * 10));

        const sortedTs = ts.slice().sort((a, b) => (a.due || "").localeCompare(b.due || ""));
        const tasksHtml = sortedTs.length
            ? sortedTs.map(t => {
                const st = taskStatus(t);
                const safeType = VALID_TASK_TYPES.includes(t.type) ? t.type : "Outro";
                return (
                    `<div class="tr-subj-task-item status-${esc(st)}" data-id="${esc(t.id)}">` +
                        `<select class="mini-status-sel status-${esc(st)}" data-act="set-status" title="Alterar status da avaliação">` +
                            `<option value="pendente"${st === "pendente" ? " selected" : ""}>⏳ A Fazer</option>` +
                            `<option value="avaliando"${st === "avaliando" ? " selected" : ""}>🔍 Avaliando</option>` +
                            `<option value="avaliada"${st === "avaliada" ? " selected" : ""}>✅ Avaliada</option>` +
                        `</select>` +
                        `<span class="task-type-icon">${esc(TYPE_ICON[safeType] || "📌")}</span>` +
                        `<span class="task-item-title" title="${esc(t.title)}">${esc(t.title)}</span>` +
                        `<div class="tr-task-item-due note">${esc(dfmt(t.due))}</div>` +
                        `<div class="tr-task-item-grade">` +
                            `<input type="number" min="0" max="10" step="0.1" class="mini-grade-in" data-act="set-got" ` +
                                `value="${esc(t.got != null ? t.got : "")}" placeholder="${st === "avaliando" ? "aguardando" : "—"}" title="Nota obtida">` +
                            `<span class="pts-max">/ ${esc(fmt(t.pts))} pts</span>` +
                        `</div>` +
                        `<button class="x btn-xs" data-act="rm" title="Excluir">✕</button>` +
                    `</div>`
                );
            }).join("")
            : `<div class="note" style="padding:10px 0;text-align:center">Nenhuma avaliação cadastrada para esta matéria.</div>`;

        const evalMeta = evaluatingTasks.length
            ? ` · <b style="color:#f59e0b">${esc(evaluatingTasks.length)} avaliando</b>`
            : "";

        return (
            `<div class="tr-subj-card" id="subj-card-${esc(id)}">` +
                `<div class="tr-subj-header">` +
                    `<div>` +
                        `<h4 class="tr-subj-title">${esc(C[id].name)}</h4>` +
                        `<div class="tr-subj-code">${esc(id)} · ${esc(C[id].aulas * 19)}h totais</div>` +
                    `</div>` +
                    `<div class="tr-subj-grade-badge">` +
                        `<span class="grade-val ${esc(gradeColorClass)}">${esc(fmt(nota))}</span>` +
                        `<span class="grade-max">/ 10.0</span>` +
                    `</div>` +
                `</div>` +
                `<div class="tr-subj-meta-row">` +
                    `${statusTag}` +
                    `<span class="note">${esc(gradedTasks.length)} avaliada(s)${evalMeta} · ${esc(pendingTasks.length)} a fazer</span>` +
                `</div>` +
                `<div class="tr-grade-bar-wrap">` +
                    `<div class="tr-grade-bar">` +
                        `<div class="bar-obtained" style="width:${esc(pctObt)}%" title="Nota obtida: ${esc(fmt(nota))}"></div>` +
                        `<div class="bar-pending" style="width:${esc(pctPend)}%" title="Pontos a receber: ${esc(fmt(pts))}"></div>` +
                    `</div>` +
                    `<div class="tr-grade-marker" style="left:60%" title="Meta IFSP: 6.0"><span class="marker-label">6.0</span></div>` +
                `</div>` +
                `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-top:-6px">` +
                    `<span>0.0</span>` +
                    `<span>${esc(fmt(nota))} obtidos + ${esc(fmt(pts))} em disputa = máx. ${esc(fmt(maxPossivel))}</span>` +
                    `<span>10.0</span>` +
                `</div>` +
                `<div class="tr-subj-tasks-header"><b>Avaliações cadastradas</b></div>` +
                `<div class="tr-subj-tasks">${tasksHtml}</div>` +
                `<div class="tr-subj-footer">` +
                    `<button type="button" class="btn-sm pri" data-act="new-for-subj" data-subj="${esc(id)}">+ Adicionar avaliação</button>` +
                `</div>` +
            `</div>`
        );
    }).join("");
}

function renderCal(plan) {
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const todayS = ymd(new Date());
    $("calTitle").textContent = calMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

    const first = new Date(y, m, 1);
    const start = addDays(first, -first.getDay());
    const ev = {};
    const fSubj = S.trFilterSubj || "";
    const fType = S.trFilterType || "";

    (S.tasks || []).forEach(t => {
        if (t.due) {
            if (fSubj && t.subj !== fSubj) return;
            if (fType && t.type !== fType) return;
            (ev[t.due] = ev[t.due] || []).push({ k: "due", t });
        }
    });

    Object.values(plan).forEach(p => {
        if (fSubj && p.t.subj !== fSubj) return;
        if (fType && p.t.type !== fType) return;
        Object.entries(p.plan).forEach(([d, h]) => {
            (ev[d] = ev[d] || []).push({ k: "work", t: p.t, h, p });
        });
    });

    let h = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
        .map(d => `<div class="ch">${esc(d)}</div>`)
        .join("");

    for (let i = 0; i < 42; i++) {
        const d = addDays(start, i);
        const s = ymd(d);
        const items = (ev[s] || []).sort((a, b) => (a.k === "due" ? 0 : 1) - (b.k === "due" ? 0 : 1));
        const dayClasses = "cd" + (d.getMonth() !== m ? " oth" : "") + (s === todayS ? " tdy" : "");

        h += `<div class="${esc(dayClasses)}"><span class="dn">${esc(d.getDate())}</span>` +
            items.map(e => {
                const st = taskStatus(e.t);
                if (e.k === "due") {
                    const cls = st === "avaliada"
                        ? "ev due ok"
                        : st === "avaliando"
                            ? "ev due status-eval"
                            : "ev due";
                    const label = st === "avaliando"
                        ? `🔍 ${esc(e.t.title)} (avaliando)`
                        : `${esc(TYPE_ICON[e.t.type] || "")} ${esc(e.t.title)}`;
                    return `<div class="${esc(cls)}" title="${esc(C[e.t.subj].name)} · vale ${esc(fmt(e.t.pts))} pts">${label}</div>`;
                }
                return `<div class="ev wk" title="${esc(C[e.t.subj].name)}">${esc(fmt(e.h))}h · ${esc(e.t.title)}</div>`;
            }).join("") +
            `</div>`;
    }
    $("cal").innerHTML = h;
}

/** Atualiza os elementos visuais do cabeçalho do curso, metadados e documento. */
export function updateCourseInfo() {
    if ($("courseIcon")) $("courseIcon").textContent = CUR.icon || "🎓";
    if ($("courseTitle")) $("courseTitle").textContent = CUR.title || "Curso";
    if ($("subTxt")) $("subTxt").textContent = CUR.sub;
    if ($("acLbl")) $("acLbl").textContent = `${CUR.acName || "Atividades Complementares"} (${AC_REQ}h) concluídas`;
    if ($("tccBaseLbl")) $("tccBaseLbl").style.display = (!HAS_TCC || CUR.tccRest) ? "none" : "";
    if ($("helpTccAnt")) $("helpTccAnt").style.display = CUR.tccRest ? "" : "none";
    document.title = `Fluxograma — ${CUR.shortTitle || CUR.title}`;
    const curSwEl = $("curSw");
    if (curSwEl && curSwEl.value !== KEY) {
        curSwEl.value = KEY;
    }
}

// ---------- INICIALIZAÇÃO DE EVENTOS E CONTROLES DA INTERFACE ----------
export function initEvents() {
    $("startYear").onchange = e => { S.startYear = +e.target.value; update(); };
    $("startHalf").onchange = e => { S.startHalf = +e.target.value; update(); };
    $("maxLoad").oninput = e => { S.maxLoad = +e.target.value; update(); };
    $("failRate").oninput = e => { S.failRate = +e.target.value; update(); };
    $("parity").onchange = e => { S.respectParity = e.target.checked; update(); };
    $("ac").onchange = e => { S.acDone = e.target.checked; update(); };
    $("tccBase").onchange = e => { S.tccBase = e.target.value; update(); };
    $("expect").oninput = e => { S.expect = +e.target.value; update(); };
    $("scen").onchange = e => { S.scen = +e.target.value; update(); };
    $("curSort").onchange = e => { S.curSort = e.target.value; update(); };
    $("btnClear").onclick = e =>
        confirma(e.currentTarget, "Clique de novo para limpar", () => {
            S.passed = [];
            S.electivePlan = [];
            update();
        });

    for (let i = 1; i <= 8; i++) {
        const o = document.createElement("option");
        o.value = i;
        o.textContent = "…até o " + i + "º semestre";
        $("quick").appendChild(o);
    }

    $("quick").onchange = e => {
        const n = +e.target.value;
        if (!n) return;
        const P = new Set(S.passed);
        OBR.concat(EST).filter(i => C[i].sem <= n).forEach(i => P.add(i));
        S.passed = [...P];
        e.target.value = "";
        update();
    };

    $("btnSave").onclick = async () => {
        const txt = JSON.stringify(S, null, 2);
        if (window.showSaveFilePicker) {
            try {
                const fh = await window.showSaveFilePicker({
                    suggestedName: "estado-curso.json",
                    types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
                });
                setFileHandle(fh);
                const w = await fh.createWritable();
                await w.write(txt);
                await w.close();
                update();
                return;
            } catch (e) {
                if (e.name === "AbortError") return;
            }
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" }));
        a.download = "estado-curso.json";
        a.click();
    };

    $("btnLoad").onclick = () => $("fileIn").click();
    $("fileIn").onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
            const text = await f.text();
            let j;
            try {
                j = JSON.parse(text);
            } catch (parseErr) {
                throw new Error("Sintaxe JSON corrompida ou inválida: " + parseErr.message);
            }
            const validation = validateStateSchema(j);
            if (!validation.valid) {
                throw new Error(validation.errors.join("\n• "));
            }
            const targetCur = validation.targetCur;
            if (targetCur !== KEY) {
                switchCourse(targetCur, j);
                if (typeof history !== "undefined" && typeof history.replaceState === "function" &&
                    typeof location !== "undefined" && location.search) {
                    const url = new URL(location.href);
                    url.searchParams.delete("curso");
                    history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
                }
                inspectCard(null);
                updateCourseInfo();
                build();
                update();
                toast("Curso alternado e backup importado com sucesso!");
            } else {
                setState(j);
                update();
                toast("Backup importado com sucesso!");
            }
        } catch (err) {
            alert("Não foi possível carregar o arquivo JSON:\n• " + err.message);
        }
        e.target.value = "";
    };

    // Eventos da aba Cursando Agora
    $("btnToggleCurForm").onclick = () => {
        const wrap = $("curFormWrap");
        if (!wrap) return;
        if (wrap.style.display === "none" || !wrap.style.display) {
            resetCursForm();
            wrap.style.display = "block";
            $("curSel").focus();
        } else {
            resetCursForm();
        }
    };
    
    $("curCancel").onclick = resetCursForm;
    $("btnCloseCurForm").onclick = resetCursForm;
    
    $("curAdd").onclick = () => {
        const id = $("curSel").value;
        if (!id) return alert("Não há matéria disponível para adicionar.");
    
        const data = { id };
        const nota = $("curNota").value.trim();
        const pts = $("curPts").value.trim();
        const falt = $("curFalt").value.trim();
        if (nota !== "") data.nota = Math.min(10, Math.max(0, parseFloat(nota) || 0));
        if (pts !== "") data.pts = Math.min(10, Math.max(0, parseFloat(pts) || 0));
        if (falt !== "") data.falt = Math.max(0, parseInt(falt) || 0);
    
        S.current = [...(S.current || []), fixCur(data)];
        resetCursForm();
        update();
    };

    const cb = $("curBody");
    cb.onchange = e => {
        const tr = e.target.closest("tr");
        const k = e.target.dataset.k;
        if (!tr || !k) return;
        const r = S.current.find(x => x.id === tr.dataset.id);
        if (k === "nota" || k === "pts") {
            r.autoGrade = false;
        }
        let v = e.target.type === "number"
            ? Math.max(0, parseFloat(e.target.value) || 0)
            : e.target.value;
        if ((k === "nota" || k === "pts") && v > 10) {
            v = 10;
            toast("Valor máximo é 10.");
        }
        r[k] = v;
        if (k === "cum" && r.prev && r.cum > r.prev) {
            toast("Aulas cumpridas não podem passar das aulas previstas.");
        }
        if (k === "falt" && r.prev && r.falt > r.prev) {
            toast("Faltas não podem passar das aulas previstas.");
        }
        update();
    };

    cb.onclick = e => {
        const act = e.target.dataset.act;
        const subjId = e.target.dataset.subj;
        if (act === "view-tasks") {
            window.openTasksForSubject(subjId);
            return;
        }
        if (act === "add-tasks") {
            window.openNewTaskModal(subjId);
            return;
        }
        if (act === "toggle-link") {
            const r = S.current.find(x => x.id === subjId);
            if (r) {
                r.autoGrade = r.autoGrade === false;
                update();
            }
            return;
        }
        if (!e.target.hasAttribute("data-rm")) return;
        const id = e.target.closest("tr").dataset.id;
        S.current = S.current.filter(x => x.id !== id);
        update();
    };

    // Eventos da aba Horários
    $("horBody").onchange = e => {
        const t = e.target;
        const c = t.dataset.c;
        if (!c || !/^[0-4]-[0-4]$/.test(c)) return;
        const k = t.dataset.k;
        if (k !== "id" && k !== "sala") return;
        const val = k === "id"
            ? (hasCourse(t.value.trim()) ? t.value.trim() : "")
            : t.value.trim().slice(0, 60);
        S.hor.cells[c] = { ...(S.hor.cells[c] || {}), [k]: val };
        if (k === "id" && val && !(S.current || []).some(r => r.id === val) && !passedSet().has(val)) {
            S.current = [...(S.current || []), fixCur({ id: val })];
        }
        update();
    };

    $("horClear").onclick = e =>
        confirma(e.currentTarget, "Clique de novo para limpar", () => {
            S.hor.cells = {};
            update();
        });

    // Eventos da aba Atividades Complementares e Cabeçalho de Curso
    $("acHoras").onchange = e => {
        S.acHoras = Math.max(0, parseFloat(e.target.value) || 0);
        update();
    };
    $("acBody").onchange = e => {
        const i = e.target.dataset.ac;
        if (i == null) return;
        S.ac[i] = Math.max(0, parseFloat(e.target.value) || 0);
        update();
    };

    updateCourseInfo();

    const curSwEl = $("curSw");
    if (curSwEl) {
        curSwEl.innerHTML = Object.values(CURS)
            .map(c => `<option value="${esc(c.id)}"${c.id === KEY ? " selected" : ""}>${esc(c.label)}</option>`)
            .join("");
        curSwEl.value = KEY;
        curSwEl.onchange = e => {
            const nextKey = e.target.value;
            if (!Object.prototype.hasOwnProperty.call(CURS, nextKey) || nextKey === KEY) return;
            persist();
            switchCourse(nextKey);
            if (typeof history !== "undefined" && typeof history.replaceState === "function" &&
                typeof location !== "undefined" && location.search) {
                const url = new URL(location.href);
                url.searchParams.delete("curso");
                history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
            }
            inspectCard(null);
            updateCourseInfo();
            build();
            update();
        };
    }

    // Eventos da aba Prazos / Calendário
    $("calPrev").onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderTasks(); };
    $("calNext").onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderTasks(); };
    $("calToday").onclick = () => { calMonth = new Date(); calMonth.setDate(1); renderTasks(); };
    $("trCap").oninput = e => { S.cap = +e.target.value; update(); };
    $("trWk").onchange = e => { S.weekend = e.target.checked; update(); };

    $("btnToggleForm").onclick = () => {
        const wrap = $("trFormWrap");
        if (!wrap) return;
        if (wrap.style.display === "none" || !wrap.style.display) {
            resetTaskForm();
            wrap.style.display = "block";
            $("trTitle").focus();
        } else {
            resetTaskForm();
        }
    };

    $("btnCloseForm").onclick = resetTaskForm;
    $("trCancel").onclick = resetTaskForm;

    const trViewBtns = [...document.querySelectorAll(".tr-v-btn")];
    bindTablist($("trViewSw"), trViewBtns, b => b.dataset.v, (v, focusBtn) => {
        S.trView = VALID_VIEWS_TR.includes(v) ? v : "list";
        update();
        if (focusBtn) {
            const active = trViewBtns.find(b => b.dataset.v === S.trView);
            if (active && typeof active.focus === "function") active.focus();
        }
    });

    // Controles de modo de toque/clique e alternância Grafo vs. Lista (Fallback) no Fluxograma
    const flowModeBtns = [...document.querySelectorAll(".flow-mode-btn")];
    function setFlowMode(mode) {
        flowMode = ["pass", "cur", "info"].includes(mode) ? mode : "pass";
        flowModeBtns.forEach(b => {
            const act = b.dataset.mode === flowMode;
            b.classList.toggle("act", act);
            b.setAttribute("aria-pressed", act ? "true" : "false");
        });
    }
    flowModeBtns.forEach(b => {
        b.onclick = () => setFlowMode(b.dataset.mode);
    });

    const flowViewBtns = [...document.querySelectorAll(".flow-view-btn")];
    function setFlowView(v, focusBtn = false) {
        flowView = v === "list" ? "list" : "graph";
        flowViewBtns.forEach(b => {
            const act = b.dataset.fview === flowView;
            b.classList.toggle("act", act);
            b.setAttribute("aria-selected", act ? "true" : "false");
            b.setAttribute("tabindex", act ? "0" : "-1");
            if (act && focusBtn && typeof b.focus === "function") b.focus();
        });
        const sc = $("flowScroll");
        const fb = $("flowFallback");
        if (sc) {
            sc.style.display = flowView === "graph" ? "" : "none";
            sc.hidden = flowView !== "graph";
        }
        if (fb) {
            fb.style.display = flowView === "list" ? "" : "none";
            fb.hidden = flowView !== "list";
        }
        try {
            localStorage.setItem("fluxo-visao", flowView);
        } catch (e) { }
    }
    bindTablist($("flowViewSw"), flowViewBtns, b => b.dataset.fview, setFlowView);
    setFlowView(flowView, false);

    const fiBox = $("flowInspect");
    if (fiBox) {
        fiBox.onclick = e => {
            const jump = e.target.closest && e.target.closest("[data-fi-jump]");
            const jumpId = jump ? jump.dataset.fiJump : e.target.dataset?.fiJump;
            if (jumpId && hasCourse(jumpId)) {
                pinnedId = jumpId;
                hover(pinnedId);
                renderFlowInspect();
                return;
            }
            const actBtn = e.target.closest && e.target.closest("[data-fi-act]");
            const act = actBtn ? actBtn.dataset.fiAct : e.target.dataset?.fiAct;
            const id = actBtn ? actBtn.dataset.id : e.target.dataset?.id;
            if (act === "close") inspectCard(null);
            else if (act === "pass" && hasCourse(id)) toggle(id);
            else if (act === "cur" && hasCourse(id)) toggleCur(id);
            else if (act === "star" && hasCourse(id)) togglePlan(id);
        };
    }

    const fbBox = $("flowFallback");
    if (fbBox) {
        fbBox.onclick = e => {
            const actBtn = e.target.closest && e.target.closest("[data-fb-act]");
            const act = actBtn ? actBtn.dataset.fbAct : e.target.dataset?.fbAct;
            const id = actBtn ? actBtn.dataset.id : e.target.dataset?.id;
            if (!act || !hasCourse(id)) return;
            if (act === "pass") toggle(id);
            else if (act === "cur") toggleCur(id);
            else if (act === "star") togglePlan(id);
        };
    }

    if ($("trFilterSubj")) $("trFilterSubj").onchange = e => { S.trFilterSubj = e.target.value; update(); };
    if ($("trFilterType")) $("trFilterType").onchange = e => { S.trFilterType = e.target.value; update(); };
    if ($("trFilterStatus")) $("trFilterStatus").onchange = e => { S.trFilterStatus = e.target.value; update(); };
    if ($("trSort")) $("trSort").onchange = e => { S.trSort = e.target.value; update(); };

    $("trAdd").onclick = () => {
        const subj = $("trSubj").value;
        const title = $("trTitle").value.trim();
        const due = $("trDue").value;
        if (!subj) return alert('Adicione primeiro uma matéria em "Cursando agora".');
        if (!title || !due) return alert("Informe título e data da avaliação.");

        const pts = Math.max(0, parseFloat($("trPts").value) || 0);
        const gotVal = $("trGot").value.trim();
        let status = $("trStatus") ? $("trStatus").value : "pendente";
        let got = null;
        if (gotVal !== "") {
            got = Math.max(0, parseFloat(gotVal) || 0);
            status = "avaliada";
        } else if (status === "avaliada") {
            status = "avaliando";
        }
        const eff = Math.max(0.5, parseFloat($("trEff").value) || 1);
        const done = status === "avaliando" || status === "avaliada";

        if (editingTaskId) {
            const t = (S.tasks || []).find(x => x.id === editingTaskId);
            if (t) {
                t.subj = subj;
                t.type = $("trType").value;
                t.status = status;
                t.title = title;
                t.due = due;
                t.pts = pts;
                t.got = got;
                t.eff = eff;
                t.done = done;
            }
        } else {
            S.tasks.push({
                id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                subj,
                type: $("trType").value,
                status,
                title,
                due,
                pts,
                got,
                eff,
                done
            });
        }

        resetTaskForm();
        update();
    };

    const handleTaskEvents = e => {
        const act = e.target.dataset.act;
        if (!act) return;

        if (e.type === "click") {
            if (act === "filter-subj") {
                S.trFilterSubj = e.target.dataset.subj;
                update();
                return;
            }
            if (act === "new-for-subj") {
                window.openNewTaskModal(e.target.dataset.subj);
                return;
            }
            const elem = e.target.closest("[data-id]");
            if (!elem) return;
            const id = elem.dataset.id;
            const t = (S.tasks || []).find(x => x.id === id);
            if (!t) return;

            if (act === "rm") {
                S.tasks = S.tasks.filter(x => x.id !== id);
                update();
            } else if (act === "edit") {
                openEditTaskModal(t);
            }
            return;
        }

        if (e.type === "change") {
            const elem = e.target.closest("[data-id]");
            if (!elem) return;
            const id = elem.dataset.id;
            const t = (S.tasks || []).find(x => x.id === id);
            if (!t) return;

            if (act === "set-status") {
                const newStatus = e.target.value;
                t.status = newStatus;
                if (newStatus === "pendente") {
                    t.done = false;
                    t.got = null;
                } else if (newStatus === "avaliando") {
                    t.done = true;
                    t.got = null;
                } else if (newStatus === "avaliada") {
                    t.done = true;
                }
                update();
            } else if (act === "set-got") {
                const v = e.target.value.trim();
                if (v === "") {
                    t.got = null;
                    if (t.status === "avaliada") t.status = "avaliando";
                } else {
                    t.got = Math.max(0, parseFloat(v) || 0);
                    t.status = "avaliada";
                    t.done = true;
                }
                update();
            } else if (act === "set-pts") {
                t.pts = Math.max(0, parseFloat(e.target.value) || 0);
                update();
            } else if (act === "set-eff") {
                t.eff = Math.max(0.5, parseFloat(e.target.value) || 0.5);
                update();
            }
        }
    };

    const tblList = $("tblTrList");
    if (tblList) {
        tblList.onchange = handleTaskEvents;
        tblList.onclick = handleTaskEvents;
    }

    const subjCards = $("trSubjectsCards");
    if (subjCards) {
        subjCards.onchange = handleTaskEvents;
        subjCards.onclick = handleTaskEvents;
    }

    const helpPane = $("t-help");
    if (helpPane) {
        helpPane.onclick = e => {
            const btn = e.target.closest && e.target.closest("[data-goto-tab]");
            const tabId = btn ? btn.dataset.gotoTab : e.target.dataset?.gotoTab;
            if (tabId && window.showTab) {
                window.showTab(tabId, true);
                window.scrollTo?.({ top: 0, behavior: "smooth" });
            }
        };
    }
}