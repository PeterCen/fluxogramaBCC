import { CURS, DEFAULT_COURSE_KEY, validateCourseConfig } from "./courses.js";
export { CURS, validateCourseConfig };

// ---------- ABAS (WAI-ARIA + NAVEGAÇÃO POR TECLADO) ----------
export function bindTablist(container, btns, getVal, onSelect) {
    btns.forEach((b, idx) => {
        b.onclick = () => onSelect(getVal(b), false);
        b.onkeydown = e => {
            let nextIdx = null;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % btns.length;
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (idx - 1 + btns.length) % btns.length;
            else if (e.key === "Home") nextIdx = 0;
            else if (e.key === "End") nextIdx = btns.length - 1;
            else if (e.key === "Enter" || e.key === " ") {
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
            if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (curIdx + 1) % btns.length;
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (curIdx - 1 + btns.length) % btns.length;
            else if (e.key === "Home") nextIdx = 0;
            else if (e.key === "End") nextIdx = btns.length - 1;
            if (nextIdx !== null) {
                e.preventDefault();
                onSelect(getVal(btns[nextIdx]), true);
            }
        };
    }
}

(function () {
    const tablist = document.getElementById("tabs");
    const btns = [...document.querySelectorAll("#tabs button")];
    function show(id, focusBtn = false) {
        if (!document.getElementById(id)) id = "t-flow";
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
        try { localStorage.setItem("aba-ativa", id) } catch (e) { }
    }
    bindTablist(tablist, btns, b => b.dataset.tab, show);
    window.showTab = show;
    let a = "t-flow"; try { a = localStorage.getItem("aba-ativa") || a } catch (e) { }
    show(a, false);
})();

let KEY = DEFAULT_COURSE_KEY;
try {
    const params = typeof location !== "undefined" && location.search ? new URLSearchParams(location.search) : null;
    const urlCurso = params ? params.get("curso") : null;
    if (urlCurso && Object.prototype.hasOwnProperty.call(CURS, urlCurso)) {
        KEY = urlCurso;
        localStorage.setItem("curriculo-ativo", KEY);
    } else {
        KEY = localStorage.getItem("curriculo-ativo") || DEFAULT_COURSE_KEY;
    }
} catch (e) { }
if (!Object.prototype.hasOwnProperty.call(CURS, KEY)) KEY = DEFAULT_COURSE_KEY;
export const CUR = CURS[KEY], RAW = CUR.raw;
export const HRS = a => a * 19 * 50 / 60;

function entryFromRaw(cur, [id, name, sem, val, ext, pre]) {
    const isHours = cur.unit === "horas";
    const kind = sem === 9 ? "el" : sem === 10 ? "op" : id.startsWith("TCC") ? "tcc" : id.startsWith("ES") ? "es" : "ob";
    const h = kind === "tcc" ? cur.tccH : (isHours ? val : HRS(val));
    const aulas = isHours ? Math.max(1, Math.round(h * 60 / (19 * 50))) : val;
    return { id, name, sem, aulas, ext: !!ext, pre, h, kind, kids: [] };
}

export const C = {}; export const ORDER = [];
RAW.forEach(row => { const item = entryFromRaw(CUR, row); C[item.id] = item; ORDER.push(item.id); });
ORDER.forEach(id => C[id].pre.forEach(p => { if (C[p]) C[p].kids.push(id); }));
export const OBR = ORDER.filter(i => C[i].kind === "ob");
export const EST = ORDER.filter(i => C[i].kind === "es");
export const TCC_IDS = ORDER.filter(i => C[i].kind === "tcc");
export const OBR_H = OBR.reduce((s, i) => s + C[i].h, 0);
export const EL_DEFAULT = CUR.eletDef;
export const ELETIVAS = CUR.eletivas;
// prioridade = maior cadeia a jusante
export const depth = {}; (function d() { const f = id => depth[id] ?? (depth[id] = 1 + Math.max(0, ...C[id].kids.map(f))); ORDER.forEach(f) })();
// ascendentes / descendentes
export const anc = id => { const s = new Set(); const f = x => C[x].pre.forEach(p => { if (!s.has(p)) { s.add(p); f(p) } }); f(id); return s };
export const desc = id => { const s = new Set(); const f = x => C[x].kids.forEach(p => { if (!s.has(p)) { s.add(p); f(p) } }); f(id); return s };

// ---------- SEGURANÇA / ESCAPE E VALIDAÇÃO ----------
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const PRIO = ["Auto", "Alta", "Média", "Baixa"], STAT = ["Crítico", "Moderado", "Recuperável", "Bem viável"], FASE = ["Consumindo", "Revisando", "Finalizada"];
const VALID_TASK_TYPES = ["Trabalho", "Prova", "Seminário", "Outro"];
const VALID_TASK_STATUS = ["pendente", "avaliando", "avaliada"];
const VALID_SORTS_CUR = ["add", "nome", "prio", "risco"];
const VALID_VIEWS_TR = ["list", "subjects", "cal"];
const VALID_SORTS_TR = ["prio", "due", "subj", "pts"];
const AC_COUNT = 26;

const clampNum = (v, min, max, def) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const clampInt = (v, min, max, def) => Math.round(clampNum(v, min, max, def));
const hasCourse = (id, cMap = C) => typeof id === "string" && Object.prototype.hasOwnProperty.call(cMap, id);

function buildCourseMap(curKey) {
    if (curKey === KEY) return C;
    const cur = CURS[curKey] || CURS[DEFAULT_COURSE_KEY];
    const map = {};
    cur.raw.forEach(row => {
        const item = entryFromRaw(cur, row);
        map[item.id] = item;
    });
    return map;
}

// ---------- ESTADO ----------
const now = new Date();
export const defaultState = (curKey = KEY) => ({
    version: 1, curriculo: curKey, passed: [], electivePlan: [], startYear: now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear(),
    startHalf: now.getMonth() >= 6 ? 1 : 2, maxLoad: 9, failRate: 20, respectParity: true, acDone: false, expect: 70, scen: 0, hor: { cells: {} }, ac: {}, acHoras: 0, tccBase: "total", curSort: "add", current: [], tasks: [], cap: 3, weekend: true, trView: "list", trSort: "prio", trFilterSubj: "", trFilterType: "", trFilterStatus: "unresolved", savedAt: null
});
let S = defaultState();
export const getState = () => S;
export const setState = next => { S = sanitizeState(next, KEY); return S; };
const LS = CUR.ls;
export const fixCur = (r, cMap = C) => {
    const defPrev = cMap[r.id].aulas * 19;
    const prev = clampInt(r.prev, 0, 1000, defPrev);
    const cum = clampInt(r.cum, 0, 1000, prev);
    const nota = Math.round(clampNum(r.nota, 0, 10, 0) * 100) / 100;
    const pts = Math.round(clampNum(r.pts, 0, 10, Math.max(0, 10 - nota)) * 100) / 100;
    const defFalt = Math.round((1 - clampNum(r.freq, 0, 100, 100) / 100) * cum);
    const falt = clampInt(r.falt, 0, 1000, defFalt);
    const prio = PRIO.includes(r.prio) && r.prio !== "Média" ? r.prio : "Auto";
    const fase = FASE.includes(r.fase) ? r.fase : "Consumindo";
    const autoGrade = typeof r.autoGrade === "boolean" ? r.autoGrade : true;
    return {
        id: r.id,
        nota,
        pts,
        prev,
        cum,
        falt,
        prio,
        fase,
        autoGrade
    };
};

const taskStatus = t => {
    if (t && VALID_TASK_STATUS.includes(t.status)) return t.status;
    if (t && t.got != null && t.got !== "" && Number.isFinite(Number(t.got))) return "avaliada";
    if (t && t.done) return "avaliando";
    return "pendente";
};

const fixTask = t => {
    const id = typeof t.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(t.id)
        ? t.id
        : "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const subj = t.subj;
    const type = VALID_TASK_TYPES.includes(t.type) ? t.type : "Outro";
    const title = String(t.title ?? "").trim().slice(0, 200) || "Atividade";
    const due = typeof t.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.due) ? t.due : "";
    const pts = Math.round(clampNum(t.pts, 0, 100, 2) * 100) / 100;
    const hasGot = t.got != null && t.got !== "" && Number.isFinite(Number(t.got));
    const got = hasGot ? Math.round(clampNum(t.got, 0, 10, 0) * 100) / 100 : null;
    const eff = Math.round(clampNum(t.eff, 0.5, 500, 1) * 10) / 10;
    let status = taskStatus(t);
    if (hasGot) status = "avaliada";
    else if (status === "avaliada") status = "avaliando";
    const done = status === "avaliando" || status === "avaliada";
    return { id, subj, type, status, title, due, pts, got, eff, done };
};

export function sanitizeState(raw, curKey = KEY) {
    const validCur = Object.prototype.hasOwnProperty.call(CURS, curKey) ? curKey : KEY;
    const def = defaultState(validCur);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return def;
    const cMap = buildCourseMap(validCur);

    const passed = [...new Set(
        (Array.isArray(raw.passed) ? raw.passed : [])
            .filter(i => typeof i === "string")
            .flatMap(i => i === "TCC" ? ["TCC1", "TCC2"] : [i])
            .filter(i => hasCourse(i, cMap))
    )];
    const electivePlan = [...new Set(
        (Array.isArray(raw.electivePlan) ? raw.electivePlan : [])
            .filter(i => hasCourse(i, cMap))
    )];
    const seenCur = new Set();
    const current = (Array.isArray(raw.current) ? raw.current : [])
        .filter(r => r && typeof r === "object" && hasCourse(r.id, cMap) && !seenCur.has(r.id) && seenCur.add(r.id))
        .map(r => fixCur(r, cMap));
    const tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
        .filter(t => t && typeof t === "object" && hasCourse(t.subj, cMap))
        .map(fixTask);

    const cells = {};
    if (raw.hor && typeof raw.hor === "object" && raw.hor.cells && typeof raw.hor.cells === "object" && !Array.isArray(raw.hor.cells)) {
        for (const [k, v] of Object.entries(raw.hor.cells)) {
            if (/^[0-4]-[0-4]$/.test(k) && v && typeof v === "object" && !Array.isArray(v)) {
                const cid = hasCourse(v.id, cMap) ? v.id : "";
                const sala = typeof v.sala === "string" ? v.sala.trim().slice(0, 60) : "";
                if (cid || sala) cells[k] = { id: cid, sala };
            }
        }
    }

    const ac = {};
    if (raw.ac && typeof raw.ac === "object" && !Array.isArray(raw.ac)) {
        for (let i = 0; i < AC_COUNT; i++) {
            if (raw.ac[i] != null && raw.ac[i] !== "") {
                const val = clampNum(raw.ac[i], 0, 100, 0);
                if (val > 0) ac[i] = val;
            }
        }
    }

    return {
        version: 1,
        curriculo: validCur,
        passed,
        electivePlan,
        startYear: clampInt(raw.startYear, 2020, 2060, def.startYear),
        startHalf: +raw.startHalf === 1 || +raw.startHalf === 2 ? +raw.startHalf : def.startHalf,
        maxLoad: clampInt(raw.maxLoad, 3, 12, def.maxLoad),
        failRate: clampNum(raw.failRate, 0, 60, def.failRate),
        respectParity: typeof raw.respectParity === "boolean" ? raw.respectParity : def.respectParity,
        acDone: typeof raw.acDone === "boolean" ? raw.acDone : def.acDone,
        expect: clampNum(raw.expect, 30, 95, def.expect),
        scen: +raw.scen === 1 ? 1 : 0,
        hor: { cells },
        ac,
        acHoras: clampNum(raw.acHoras, 0, 1000, 0),
        tccBase: raw.tccBase === "obr" ? "obr" : "total",
        curSort: VALID_SORTS_CUR.includes(raw.curSort) ? raw.curSort : def.curSort,
        current,
        tasks,
        cap: clampNum(raw.cap, 1, 10, def.cap),
        weekend: typeof raw.weekend === "boolean" ? raw.weekend : def.weekend,
        trView: VALID_VIEWS_TR.includes(raw.trView) ? raw.trView : def.trView,
        trSort: VALID_SORTS_TR.includes(raw.trSort) ? raw.trSort : def.trSort,
        trFilterSubj: hasCourse(raw.trFilterSubj, cMap) ? raw.trFilterSubj : "",
        trFilterType: ["", ...VALID_TASK_TYPES].includes(raw.trFilterType) ? raw.trFilterType : "",
        trFilterStatus: ["all", "unresolved", ...VALID_TASK_STATUS].includes(raw.trFilterStatus) ? raw.trFilterStatus : "unresolved",
        savedAt: typeof raw.savedAt === "string" ? raw.savedAt.slice(0, 40) : null
    };
}

export function syncSubjectGrades() {
    (S.current || []).forEach(r => {
        if (r.autoGrade === false) return;
        const ts = (S.tasks || []).filter(t => t.subj === r.id);
        if (ts.length === 0) return;

        // Apenas atividades com status 'avaliada' (com nota lançada) entram em nota atual!
        const graded = ts.filter(t => taskStatus(t) === "avaliada" && t.got != null && t.got !== "");
        // Atividades 'pendente' ou 'avaliando' continuam sendo pontos a receber/disputar
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
try { const t = localStorage.getItem(LS); if (t) S = sanitizeState(JSON.parse(t), KEY) } catch (e) { S = defaultState() }
let fileHandle = null;

// ---------- SIMULAÇÃO ----------
export const half = k => ((S.startHalf - 1 + k) % 2) + 1;
export const label = k => { const y = S.startYear + Math.floor((S.startHalf - 1 + k) / 2); return y + "/" + half(k) };
export function electivesPlanned(passedSet) {
    const passedEl = ELETIVAS.filter(e => passedSet.has(e)).length;
    let need = Math.max(0, (CUR.eletNeed || 2) - passedEl);
    const chosen = [];
    S.electivePlan.filter(e => !passedSet.has(e)).forEach(e => { if (chosen.length < need) chosen.push(e) });
    EL_DEFAULT.forEach(e => { if (chosen.length < need && !passedSet.has(e) && !chosen.includes(e)) chosen.push(e) });
    return chosen;
}
export function toPlan(passedSet) {
    const pl = OBR.filter(i => !passedSet.has(i)).concat(electivesPlanned(passedSet));
    EST.forEach(i => { if (!passedSet.has(i)) pl.push(i) });
    TCC_IDS.forEach(t => { if (!passedSet.has(t)) pl.push(t) });
    return pl;
}
const sig = x => 1 / (1 + Math.exp(-x));
export function risk(r) {
    const cum = r.cum, prev = Math.max(r.prev, r.cum), limit = Math.floor(prev * .25), folga = limit - r.falt;
    const freq = cum ? (cum - r.falt) / cum * 100 : 100, esp = cum ? r.falt / cum * Math.max(0, prev - cum) * .6 : 0;
    const pF = folga < 0 ? 1 : sig((esp - folga - .5) / Math.max(1.2, .5 * Math.sqrt(esp + 1)));
    const need = 6 - r.nota; let pN = need <= 0 ? .02 : r.pts <= 0 ? 1 : sig((need / r.pts - S.expect / 100) / .1);
    if (need > 0 && r.nota + r.pts >= 4) pN *= .75;
    return { freq, limit, folga, pF, pN, p: 1 - (1 - pF) * (1 - pN) };
}
export const riskMap = () => { const m = {}; (S.current || []).forEach(r => m[r.id] = risk(r).p); return m };
let rng = Math.random;
export const seed = () => { let a = 12345; rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } };
// mode 0: passa em tudo que cursa · 1: reprova com risco ≥ 50% · 2: sorteia pelo risco
export const acH = () => S.acDone ? AC_REQ : Math.min(AC_REQ, acTotal());
export const gateH = P => OBR.concat(EST).filter(i => P.has(i)).reduce((a, i) => a + C[i].h, 0) + (S.tccBase === "obr" ? 0 : ELETIVAS.filter(i => P.has(i)).slice(0, CUR.eletNeed || 2).reduce((a, i) => a + C[i].h, 0) + acH());
export const gateNeed = () => (CUR.tccPct || 0.75) * (S.tccBase === "obr" ? OBR_H : CUR.totalH);
export const tccOpen = P => CUR.tccRest ? OBR.filter(i => !P.has(i)).length + electivesPlanned(P).length <= 2 * S.maxLoad : gateH(P) >= gateNeed();
export function passedSet() { const P = new Set(S.passed); (S.current || []).forEach(r => { if (r.fase === "Finalizada") { P.add(r.id); anc(r.id).forEach(x => P.add(x)) } }); return P }
export function simulate(fail, mode = 0, rm = riskMap()) {
    const passed = passedSet();
    (S.current || []).forEach(r => { const p = rm[r.id] ?? 0; if (mode === 0 || (mode === 1 && p < .5) || (mode === 2 && rng() >= p)) passed.add(r.id) });
    const pending = new Set(toPlan(passed)), terms = [];
    let done = OBR.concat(EST).filter(i => passed.has(i)).reduce((s, i) => s + C[i].h, 0);
    const estMinH = (CUR.estMinPct || 0) * CUR.totalH;
    let k = 0;
    while (pending.size && k < 60) {
        const par = half(k);
        const cand = [...pending].filter(id => {
            const c = C[id];
            if (!c.pre.every(p => passed.has(p))) return false;
            if (c.kind === "tcc" && !tccOpen(passed)) return false;
            if (c.kind === "es" && estMinH > 0 && done < estMinH) return false;
            if (S.respectParity && (c.kind === "ob" || c.kind === "tcc" || c.kind === "es") && ((c.sem % 2) ? 1 : 2) !== par) return false;
            return true;
        }).sort((a, b) => depth[b] - depth[a] || C[a].sem - C[b].sem);
        const take = cand.slice(0, S.maxLoad), got = [];
        take.forEach(id => { if (fail > 0 && rng() < fail) return; got.push(id) });
        got.forEach(id => { pending.delete(id) });
        terms.push({ k, taken: got });
        got.forEach(id => { passed.add(id); if (C[id].kind === "ob" || C[id].kind === "es") done += C[id].h });
        k++;
    }
    return { terms, n: pending.size ? Infinity : terms.length };
}
export function monte(fail) {
    seed(); const rm = riskMap(), arr = []; for (let i = 0; i < 1000; i++)arr.push(simulate(fail, 2, rm).n);
    arr.sort((a, b) => a - b); return { med: arr[500], p90: arr[899] };
}

// ---------- LAYOUT / RENDER ----------
const CW = 190, CH = 66, GX = 64, GY = 14, X0 = 20, Y0 = 56;
const HAS_TCC = TCC_IDS.length > 0;
const colOf = c => (c.kind === "ob" || c.kind === "es") ? c.sem - 1 : (c.kind === "el" || c.kind === "op") ? 8 : 9;
const HEADS = HAS_TCC
    ? ["1º sem", "2º sem", "3º sem", "4º sem", "5º sem", "6º sem", "7º sem", "8º sem", "Eletivas / Optativas", "Conclusão"]
    : ["1º sem", "2º sem", "3º sem", "4º sem", "5º sem", "6º sem", "7º sem", "8º sem", "Eletivas"];
const flow = document.getElementById("flow"), svg = document.getElementById("edges");
const pos = {}; const els = {}; const colItems = {};
let flowMode = "pass"; // "pass" | "cur" | "info"
let pinnedId = null;
const isMobileViewport = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;
let flowView = "graph";
try {
    const savedView = localStorage.getItem("fluxo-visao");
    flowView = (savedView === "list" || savedView === "graph") ? savedView : (isMobileViewport() ? "list" : "graph");
} catch (e) { }

function toggleCur(id) {
    if (!hasCourse(id) || C[id].kind === "tcc") return;
    const cur = S.current || [];
    if (cur.some(r => r.id === id)) {
        S.current = cur.filter(r => r.id !== id);
    } else if (!passedSet().has(id)) {
        S.current = [...cur, fixCur({ id })];
    }
    update();
}

function inspectCard(id) {
    pinnedId = (id && hasCourse(id) && pinnedId !== id) ? id : null;
    hover(pinnedId);
    renderFlowInspect();
}

function navigateCardGrid(currentId, key) {
    const c = C[currentId];
    if (!c) return;
    const col = colOf(c);
    const list = colItems[col] || [];
    const rowIdx = list.indexOf(currentId);
    let targetId = null;
    if (key === "ArrowDown" && rowIdx < list.length - 1) targetId = list[rowIdx + 1];
    else if (key === "ArrowUp" && rowIdx > 0) targetId = list[rowIdx - 1];
    else if (key === "ArrowRight" || key === "ArrowLeft") {
        const dir = key === "ArrowRight" ? 1 : -1;
        for (let nc = col + dir; nc >= 0 && nc <= 9; nc += dir) {
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

function build() {
    const rows = {};
    ORDER.forEach(id => {
        const c = C[id]; const col = colOf(c); rows[col] = (rows[col] || 0);
        (colItems[col] = colItems[col] || []).push(id);
        let r = rows[col]++; if (c.kind === "op" && col === 8) r += 0.4;
        pos[id] = { x: X0 + col * (CW + GX), y: Y0 + r * (CH + GY) }
    });
    // TCC e AC na última coluna
    pos["TCC"] = { x: X0 + 9 * (CW + GX), y: Y0 };
    HEADS.forEach((h, i) => {
        const d = document.createElement("div"); d.className = "colh"; d.style.left = (X0 + i * (CW + GX)) + "px";
        const subTxt = i < 8 ? (i % 2 ? "semestre par" : "semestre ímpar") : i === 8 ? (CUR.eletHeaderSub || "Eletivas") : "TCC + Complementares";
        d.innerHTML = `${esc(h)}<small>${esc(subTxt)}</small>`; flow.appendChild(d)
    });
    ORDER.forEach(id => {
        const c = C[id], p = pos[id], d = document.createElement("div");
        d.className = "card" + (c.ext ? " ext" : ""); d.style.left = p.x + "px"; d.style.top = p.y + "px";
        d.setAttribute("role", "button");
        d.setAttribute("tabindex", "0");
        d.dataset.id = id;
        const curBtnHtml = c.kind !== "tcc" ? `<button type="button" class="card-act card-cur" data-card-act="cur" title="Marcar/desmarcar como Cursando agora (atalho: tecla C)" aria-label="Cursando agora">📚</button>` : "";
        const infoBtnHtml = `<button type="button" class="card-act card-info" data-card-act="info" title="Ver pré-requisitos e disciplinas que libera (atalho: tecla I)" aria-label="Ver pré-requisitos">🔍</button>`;
        const starBtnHtml = c.kind === "el" ? `<button type="button" class="star" data-card-act="star" title="Escolher esta eletiva" aria-label="Escolher eletiva">★</button>` : "";
        d.innerHTML = `<div class="chk"></div><div class="card-acts">${infoBtnHtml}${curBtnHtml}</div><div class="n">${esc(c.name)}</div><div class="m"><span>${esc(id)} · ${esc(c.h.toFixed(1).replace(".", ","))}h</span><span class="plan"></span></div>` + starBtnHtml;
        let clickT = null;
        let lastTouch = 0;
        d.ontouchstart = () => { lastTouch = Date.now(); };
        d.onclick = e => {
            const actBtn = e.target.closest && e.target.closest("[data-card-act]");
            const cardAct = actBtn ? actBtn.dataset.cardAct : e.target.dataset?.cardAct;
            if (cardAct === "star" || e.target.classList.contains("star")) { togglePlan(id); return; }
            if (cardAct === "cur") { toggleCur(id); return; }
            if (cardAct === "info") { inspectCard(id); return; }

            if (flowMode === "cur") { toggleCur(id); return; }
            if (flowMode === "info") { inspectCard(id); return; }

            // Em toque/mobile, não espera 260ms por duplo clique
            const isTouch = (Date.now() - lastTouch < 600) || (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches);
            if (isTouch) {
                clearTimeout(clickT);
                toggle(id);
                return;
            }
            if (e.detail > 1) return;               // 2º clique do duplo clique: tratado em ondblclick
            clearTimeout(clickT); clickT = setTimeout(() => toggle(id), 240);
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
        flow.appendChild(d); els[id] = d
    });
    const W = X0 * 2 + HEADS.length * (CW + GX) - GX; flow.style.width = W + "px"; flow.style.height = (Y0 + (Math.max(...Object.values(rows)) + 0.6) * (CH + GY) + 20) + "px";
    svg.setAttribute("width", W); svg.setAttribute("height", parseFloat(flow.style.height));
    // arestas
    ORDER.forEach(id => C[id].pre.forEach(p => {
        const a = pos[p], b = pos[id]; const x1 = a.x + CW, y1 = a.y + CH / 2, x2 = b.x, y2 = b.y + CH / 2; const dx = Math.max(40, (x2 - x1) / 2);
        const e = document.createElementNS("http://www.w3.org/2000/svg", "path");
        e.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`); e.setAttribute("class", "e"); e.dataset.f = p; e.dataset.t = id; svg.appendChild(e)
    }));
    // TCC: seta de todas obrigatórias do 7º/8º semestre seria poluição; deixado como regra textual
    if (els.TCC1 && CUR.tccLbl) {
        els.TCC1.querySelector(".n").innerHTML = `TCC 1 <span style='font-weight:400;color:var(--mut)'>(${esc(CUR.tccLbl)})</span>`;
    }
}
function hover(id) {
    const activeId = id || pinnedId;
    const cards = Object.values(els), edges = [...svg.children];
    if (!activeId || !C[activeId]) { cards.forEach(c => c.classList.remove("dim", "hl", "pinned")); edges.forEach(e => e.classList.remove("dim", "hl")); return }
    const A = anc(activeId), D = desc(activeId); const set = new Set([activeId, ...A, ...D]);
    ORDER.forEach(i => {
        els[i].classList.toggle("dim", !set.has(i));
        els[i].classList.toggle("hl", set.has(i) && i !== activeId);
        els[i].classList.toggle("pinned", i === pinnedId);
    });
    edges.forEach(e => { const on = set.has(e.dataset.f) && set.has(e.dataset.t); e.classList.toggle("hl", on); e.classList.toggle("dim", !on) });
}

function renderFlowInspect() {
    const box = document.getElementById("flowInspect");
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
    const statusText = isPassed ? "✓ Aprovada" : isCur ? "📚 Cursando agora" : isReady ? "Disponível" : "🔒 Bloqueada";
    const statusCls = isPassed ? "g" : isCur ? "y" : isReady ? "b" : "r";

    const preChips = c.pre.length
        ? c.pre.map(p => `<button type="button" class="fi-chip ${P.has(p) ? 'ok' : 'pend'}" data-fi-jump="${esc(p)}">${P.has(p) ? "✓" : "🔒"} ${esc(p)} · ${esc(C[p].name)}</button>`).join("")
        : `<span class="note">Nenhum (liberada desde o início)</span>`;
    const kidChips = c.kids.length
        ? c.kids.map(k => `<button type="button" class="fi-chip" data-fi-jump="${esc(k)}">→ ${esc(k)} · ${esc(C[k].name)}</button>`).join("")
        : `<span class="note">Nenhuma diretamente</span>`;

    const passBtnLbl = isPassed ? "✓ Aprovada (desmarcar)" : "✓ Marcar aprovada";
    const curBtnHtml = c.kind !== "tcc"
        ? `<button type="button" class="btn-sm ${isCur ? 'pri' : ''}" data-fi-act="cur" data-id="${esc(pinnedId)}">${isCur ? "📚 Cursando (remover)" : "📚 Marcar cursando"}</button>`
        : "";
    const starBtnHtml = c.kind === "el"
        ? `<button type="button" class="btn-sm ${S.electivePlan.includes(pinnedId) ? 'pri' : ''}" data-fi-act="star" data-id="${esc(pinnedId)}">★ ${S.electivePlan.includes(pinnedId) ? "Eletiva escolhida" : "Escolher eletiva"}</button>`
        : "";

    box.hidden = false;
    box.innerHTML = `<div class="fi-head">
        <div>
            <b>${esc(c.name)}</b> <span class="note">(${esc(c.id)} · ${esc(c.h.toFixed(1).replace(".", ","))}h · ${esc(HEADS[colOf(c)])})</span>
            <span class="tag ${esc(statusCls)}" style="padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;margin-left:6px">${esc(statusText)}</span>
        </div>
        <div class="fi-actions">
            <button type="button" class="btn-sm ${isPassed ? 'pri' : ''}" data-fi-act="pass" data-id="${esc(pinnedId)}">${esc(passBtnLbl)}</button>
            ${curBtnHtml}
            ${starBtnHtml}
            <button type="button" class="btn-ghost" data-fi-act="close" title="Fechar inspeção" aria-label="Fechar inspeção">✕</button>
        </div>
    </div>
    <div class="fi-chains">
        <div><small>Pré-requisitos diretos (${esc(anc(pinnedId).size)} na cadeia):</small> <div class="fi-chip-list">${preChips}</div></div>
        <div><small>Libera diretamente (${esc(desc(pinnedId).size)} na cadeia):</small> <div class="fi-chip-list">${kidChips}</div></div>
    </div>`;
}

function renderFlowFallback(P, when, chosen) {
    const fb = document.getElementById("flowFallback");
    if (!fb) return;
    const groups = HEADS.map((title, colIdx) => ({
        title,
        sub: colIdx < 8 ? (colIdx % 2 ? "semestre par" : "semestre ímpar") : colIdx === 8 ? (CUR.eletHeaderSub || "Eletivas") : "TCC + Complementares",
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
            const planTxt = cr && !isPassed ? "⚠ Risco " + Math.round(rp * 100) + "%" : ((!isPassed && when[id] !== undefined) ? "Previsto: " + label(when[id]) : "");

            const stBadge = isPassed
                ? `<span class="tag g">✓ Aprovada</span>`
                : isCur
                    ? `<span class="tag y">📚 Cursando</span>`
                    : isReady
                        ? `<span class="tag b">Disponível</span>`
                        : `<span class="tag r">🔒 Bloqueada</span>`;

            const preHtml = c.pre.length
                ? `<div class="fb-card-rel"><b>Pré-requisitos:</b> ${c.pre.map(p => `<span class="${P.has(p) ? 'rel-ok' : 'rel-pend'}">${P.has(p) ? "✓" : "🔒"} ${esc(C[p].name)} (${esc(p)})</span>`).join(" · ")}</div>`
                : "";
            const kidsHtml = c.kids.length
                ? `<div class="fb-card-rel"><b>Libera:</b> ${c.kids.map(k => `<span>${esc(C[k].name)} (${esc(k)})</span>`).join(" · ")}</div>`
                : "";
            const curBtnHtml = c.kind !== "tcc"
                ? `<button type="button" class="btn-xs ${isCur ? 'pri' : ''}" data-fb-act="cur" data-id="${esc(id)}" aria-pressed="${isCur ? 'true' : 'false'}">${isCur ? "📚 Cursando" : "+ Cursando"}</button>`
                : "";
            const starBtnHtml = c.kind === "el"
                ? `<button type="button" class="btn-xs ${S.electivePlan.includes(id) || chosen.includes(id) ? 'pri' : ''}" data-fb-act="star" data-id="${esc(id)}" aria-pressed="${S.electivePlan.includes(id) ? 'true' : 'false'}">★ Eletiva</button>`
                : "";

            return `<div class="fb-card ${isPassed ? 'passed' : isCur ? 'cur' : isReady ? 'avail' : ''} ${isOff ? 'off' : ''} ${c.ext ? 'ext' : ''}" data-id="${esc(id)}">
                <div class="fb-card-top">
                    <div>
                        <div class="fb-card-title">${esc(c.name)}</div>
                        <div class="fb-card-meta">${esc(id)} · ${esc(c.h.toFixed(1).replace(".", ","))}h${c.ext ? " · Extensão" : ""}${planTxt ? " · " + esc(planTxt) : ""}</div>
                    </div>
                    <div class="fb-card-badges">${stBadge}</div>
                </div>
                ${preHtml}
                ${kidsHtml}
                <div class="fb-card-actions">
                    <button type="button" class="btn-xs ${isPassed ? 'pri' : ''}" data-fb-act="pass" data-id="${esc(id)}" aria-pressed="${isPassed ? 'true' : 'false'}">${isPassed ? "✓ Aprovada" : "Marcar aprovada"}</button>
                    ${curBtnHtml}
                    ${starBtnHtml}
                </div>
            </div>`;
        }).join("");

        return `<section class="fb-sem-group">
            <header class="fb-sem-head">
                <h4>${esc(g.title)} <small>${esc(g.sub)}</small></h4>
                <span class="note">${esc(doneCount)}/${esc(g.items.length)} concluídas</span>
            </header>
            <div class="fb-sem-list">${cardsHtml}</div>
        </section>`;
    }).join("");
}
function toggle(id) {
    const fr = (S.current || []).find(x => x.id === id);
    if (fr && fr.fase === "Finalizada") {
        fr.fase = "Consumindo";
        update();
        return
    }
    const P = new Set(S.passed);
    if (P.has(id)) {
        P.delete(id);
        desc(id).forEach(x => P.delete(x))
    }
    else {
        P.add(id);
        anc(id).forEach(x => P.add(x)) 
    }   // checkpoint: passou nela ⇒ passou nos pré-requisitos
    S.passed = [...P]; update()
}
function togglePlan(id) {
    const s = new Set(S.electivePlan); s.has(id) ? s.delete(id) : s.add(id); S.electivePlan = [...s]; update()
}

let lastPlan = null;
function update() {
    syncSubjectGrades();
    const P = passedSet();
    const best = simulate(0, 0), plan = +S.scen === 1 ? simulate(0, 1) : best; lastPlan = plan;
    const when = {}; plan.terms.forEach(t => t.taken.forEach(id => when[id] = t.k));
    const chosen = electivesPlanned(P);
    ORDER.forEach(id => {
        const c = C[id], el = els[id];
        const ready = c.pre.every(p => P.has(p));
        const isPassed = P.has(id);
        const isCur = !isPassed && (S.current || []).some(r => r.id === id);
        el.classList.toggle("passed", isPassed);
        el.classList.toggle("cur", isCur);
        el.classList.toggle("avail", !isPassed && ready && c.kind !== "tcc");
        el.classList.toggle("off", (c.kind === "el" && !isPassed && !chosen.includes(id)) || c.kind === "op" && !isPassed);
        el.setAttribute("aria-pressed", isPassed ? "true" : "false");
        const stText = isPassed ? "Aprovada" : isCur ? "Cursando agora" : ready ? "Disponível" : "Bloqueada";
        el.setAttribute("aria-label", `${c.name} (${id}), ${c.h.toFixed(1).replace(".", ",")}h, ${stText}`);
        const pl = el.querySelector(".plan");
        const cr = (S.current || []).find(r => r.id === id), rp = cr && !isPassed ? risk(cr).p : 0;
        el.classList.toggle("hi", rp >= .6);
        pl.textContent = cr && !isPassed ? "⚠ " + Math.round(rp * 100) + "%" : ((!isPassed && when[id] !== undefined) ? label(when[id]) : "");
        const st = el.querySelector(".star"); if (st) st.classList.toggle("on", S.electivePlan.includes(id) || (chosen.includes(id)));
        const curBtn = el.querySelector(".card-cur"); if (curBtn) curBtn.classList.toggle("on", isCur);
        const infoBtn = el.querySelector(".card-info"); if (infoBtn) infoBtn.classList.toggle("on", pinnedId === id);
    });
    svg.querySelectorAll("path.e").forEach(e => e.classList.toggle("pass", P.has(e.dataset.f)));
    hover(pinnedId);
    renderFlowInspect();
    renderFlowFallback(P, when, chosen);
    // KPIs
    const doneH = OBR.concat(EST).filter(i => P.has(i)).reduce((s, i) => s + C[i].h, 0) + ELETIVAS.filter(i => P.has(i)).slice(0, CUR.eletNeed || 2).reduce((s, i) => s + C[i].h, 0) + TCC_IDS.filter(i => P.has(i)).reduce((s, i) => s + C[i].h, 0) + (S.acDone ? AC_REQ : Math.min(AC_REQ, acTotal()));
    const totalH = CUR.totalH, pct = Math.min(100.0, doneH / totalH * 100.0);
    const pend = OBR.filter(i => !P.has(i)).length;
    const min = best.n, mc = monte(S.failRate / 100), exp = (S.current || []).filter(r => !P.has(r.id)).reduce((s, r) => s + risk(r).p, 0);
    const fin = n => n === Infinity ? "—" : label(n - 1);
    const f = n => n === Infinity ? "∞" : n;
    document.getElementById("kpis").innerHTML = `
<div class="kpi main"><b>${esc(f(min))} sem.</b><small>Mínimo restante · conclui em ${esc(fin(min))}</small></div>
<div class="kpi"><b>${esc(f(mc.med))} sem.</b><small>Provável (${esc(S.failRate)}% de falha) · ${esc(fin(mc.med))}</small></div>
<div class="kpi"><b class="${mc.p90 > 16 ? 'warn' : ''}">${esc(f(mc.p90))} sem.</b><small>Pessimista (P90) · ${esc(fin(mc.p90))}</small></div>
<div class="kpi"><b>${esc(pct.toFixed(2).replace(".", ","))}%</b><small>${esc(doneH.toFixed(2).replace(".", ","))}h de ${esc(totalH)}h</small></div>
<div class="kpi"><b>${esc(pend)}</b><small>obrigatórias pendentes</small></div>
<div class="kpi"><b>${esc(P.size ? [...P].filter(i => C[i].kind === "ob").length : 0)}/${esc(OBR.length)}</b><small>obrigatórias aprovadas</small></div>` + ((S.current || []).some(r => !P.has(r.id)) ? `<div class="kpi"><b class="${exp >= 3 ? 'warn' : ''}">${esc(exp.toFixed(1).replace(".", ","))}</b><small>reprovações esperadas neste semestre (de ${esc(S.current.filter(r => !P.has(r.id)).length)})</small></div>` : "");
    document.getElementById("bar").style.width = pct + "%";
    // timeline
    const T = document.getElementById("timeline"); T.innerHTML = "";
    plan.terms.forEach((t, i) => {
        if (!t.taken.length && i < plan.terms.length - 1 && false) return;
        const h = t.taken.reduce((s, id) => s + C[id].h, 0);
        const d = document.createElement("div"); d.className = "term" + (i == plan.terms.length - 1 ? " last" : "");
        d.innerHTML = `<h4>${esc(i + 1)}º período · ${esc(label(t.k))}<span>${esc(t.taken.length)} disc. · ${esc(h.toFixed(0))}h</span></h4>` +
            (t.taken.length ? `<ul>${t.taken.map(id => `<li>${esc(C[id].name)}</li>`).join("")}</ul>` : `<div class="note">Nenhuma disciplina disponível neste semestre (espera pela oferta).</div>`);
        T.appendChild(d)
    });
    if (plan.n === Infinity) T.innerHTML = "<div class='note warn'>Não foi possível montar o plano (verifique o limite de disciplinas/oferta).</div>";
    if (!plan.terms.length) T.innerHTML = "<div class='note'>🎉 Todas as disciplinas obrigatórias, eletivas e o TCC estão marcados como concluídos. Falta apenas confirmar as atividades complementares se não marcou.</div>";
    // controles
    document.getElementById("startYear").value = S.startYear;
    document.getElementById("startHalf").value = S.startHalf;
    document.getElementById("maxLoad").value = S.maxLoad; document.getElementById("loadV").textContent = S.maxLoad;
    document.getElementById("failRate").value = S.failRate; document.getElementById("failV").textContent = S.failRate + "%";
    document.getElementById("parity").checked = S.respectParity;
    document.getElementById("ac").checked = S.acDone;
    document.getElementById("tccBase").value = S.tccBase || "total"; document.getElementById("expect").value = S.expect; document.getElementById("expV").textContent = S.expect + "%";
    document.getElementById("scen").value = S.scen || 0;
    renderCurrent(); renderTasks(); renderHor(); renderAC();
    persist();
}
function persist() {
    S.savedAt = new Date().toISOString();
    try { localStorage.setItem(LS, JSON.stringify(S)) } catch (e) { }
    document.getElementById("saveInfo").textContent = "Autosave no navegador: " + new Date().toLocaleTimeString() + (fileHandle ? " · arquivo vinculado: " + fileHandle.name : "");
    if (fileHandle && !persist.busy) { persist.busy = true; fileHandle.createWritable().then(w => w.write(JSON.stringify(S, null, 2)).then(() => w.close())).catch(() => { }).finally(() => persist.busy = false) }
}

// ---------- EVENTOS ----------
const $ = id => document.getElementById(id);
$("startYear").onchange = e => { S.startYear = +e.target.value; update() };
$("startHalf").onchange = e => { S.startHalf = +e.target.value; update() };
$("maxLoad").oninput = e => { S.maxLoad = +e.target.value; update() };
$("failRate").oninput = e => { S.failRate = +e.target.value; update() };
$("parity").onchange = e => { S.respectParity = e.target.checked; update() };
$("ac").onchange = e => { S.acDone = e.target.checked; update() };
$("tccBase").onchange = e => { S.tccBase = e.target.value; update() };
$("expect").oninput = e => { S.expect = +e.target.value; update() };
$("scen").onchange = e => { S.scen = +e.target.value; update() };
$("curSort").onchange = e => { S.curSort = e.target.value; update() };
$("btnClear").onclick = e => confirma(e.currentTarget, "Clique de novo para limpar", () => { S.passed = []; S.electivePlan = []; update() });
for (let i = 1; i <= 8; i++) { const o = document.createElement("option"); o.value = i; o.textContent = "…até o " + i + "º semestre"; $("quick").appendChild(o) }
$("quick").onchange = e => {
    const n = +e.target.value; if (!n) return;
    const P = new Set(S.passed); OBR.concat(EST).filter(i => C[i].sem <= n).forEach(i => P.add(i)); S.passed = [...P]; e.target.value = ""; update()
};
$("btnSave").onclick = async () => {
    const txt = JSON.stringify(S, null, 2);
    if (window.showSaveFilePicker) {
        try {
            fileHandle = await showSaveFilePicker({ suggestedName: "estado-curso.json", types: [{ description: "JSON", accept: { "application/json": [".json"] } }] });
            const w = await fileHandle.createWritable(); await w.write(txt); await w.close(); update(); return
        } catch (e) { if (e.name === "AbortError") return }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" })); a.download = "estado-curso.json"; a.click();
};
$("btnLoad").onclick = () => $("fileIn").click();
$("fileIn").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
        const j = JSON.parse(await f.text());
        if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("Estrutura JSON inválida.");
        const targetCur = Object.prototype.hasOwnProperty.call(CURS, j.curriculo) ? j.curriculo : "nova";
        if (targetCur !== KEY) {
            const cleanOther = sanitizeState(j, targetCur);
            localStorage.setItem(CURS[targetCur].ls, JSON.stringify(cleanOther));
            localStorage.setItem("curriculo-ativo", targetCur);
            location.reload();
            return;
        }
        S = sanitizeState(j, KEY);
        update();
    }
    catch (err) { alert("JSON inválido: " + err.message) }
    e.target.value = ""
};

// ---------- CURSANDO / ESTATÍSTICAS ----------
const TAGC = { "Auto": "b", "Alta": "r", "Média": "y", "Baixa": "g", "Crítico": "r", "Moderado": "y", "Recuperável": "g", "Bem viável": "b", "Consumindo": "b", "Revisando": "y", "Finalizada": "g" };
const fmt = n => String(Math.round(n * 100) / 100).replace(".", ",");
const optList = (arr, v) => arr.map(o => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${esc(o)}</option>`).join("");
export const effPrio = r => { const p = risk(r).p; return !r.prio || r.prio === "Auto" ? (p >= .15 && p <= .75 ? "Alta" : "Baixa") : r.prio };
function sortCur(a) {
    const o = S.curSort, rk = { "Alta": 0, "Média": 1, "Baixa": 2 }, nm = (x, y) => C[x.id].name.localeCompare(C[y.id].name, "pt-BR"), b = [...a];
    if (o === "nome") b.sort(nm);
    else if (o === "prio") b.sort((x, y) => rk[effPrio(x)] - rk[effPrio(y)] || risk(y).p - risk(x).p || nm(x, y));
    else if (o === "risco") b.sort((x, y) => risk(y).p - risk(x).p || nm(x, y));
    return b;
}
function renderCurrent() {
    const all = S.current || [], P = new Set(S.passed), used = new Set(all.map(r => r.id)), cur = sortCur(all);
    document.getElementById("curSort").value = S.curSort || "add";
    const sel = document.getElementById("curSel");
    sel.innerHTML = ORDER.filter(i => !used.has(i) && !P.has(i) && C[i].kind !== "tcc").map(i => `<option value="${esc(i)}">${esc(C[i].name)}</option>`).join("");
    document.getElementById("curBody").innerHTML = cur.map(r => {
        const k = risk(r), pc = Math.round(k.p * 100), st = k.p >= .7 ? "Crítico" : k.p >= .4 ? "Moderado" : k.p >= .15 ? "Recuperável" : "Bem viável", pr = !r.prio || r.prio === "Auto" ? (k.p >= .15 && k.p <= .75 ? "Alta" : "Baixa") : r.prio;
        const prioKey = PRIO.includes(r.prio) ? r.prio : "Auto";
        const faseKey = FASE.includes(r.fase) ? r.fase : "Consumindo";
        const ts = (S.tasks || []).filter(t => t.subj === r.id);
        const hasTasks = ts.length > 0;
        const isLinked = hasTasks && r.autoGrade !== false;
        const gradedCount = ts.filter(t => taskStatus(t) === "avaliada" && t.got != null && t.got !== "").length;
        const evaluatingCount = ts.filter(t => taskStatus(t) === "avaliando").length;

        // Botão para ver ou adicionar avaliações
        const tasksActionBtn = hasTasks
            ? `<button type="button" class="cur-tasks-btn" data-act="view-tasks" data-subj="${esc(r.id)}" title="Ver e gerenciar as avaliações desta matéria">📝 ${esc(ts.length)} avaliação(ões)</button>`
            : `<button type="button" class="cur-tasks-btn add" data-act="add-tasks" data-subj="${esc(r.id)}" title="Cadastrar provas e trabalhos para esta matéria">+ avaliar</button>`;

        // Coluna Nota Atual
        let notaColHtml = "";
        if (isLinked) {
            notaColHtml = `<div class="mini">
                <input type="number" min="0" max="10" step="0.1" value="${esc(r.nota)}" data-k="nota" class="in-linked" readonly title="Nota vinculada às avaliações corrigidas. Clique em 🔗 para editar manualmente.">
                <button type="button" class="btn-link-icon on" data-act="toggle-link" data-subj="${esc(r.id)}" title="Vinculado às avaliações. Clique para editar manualmente.">🔗</button>
                <div class="pb"><div style="width:${esc(Math.min(100, (Number(r.nota) || 0) * 10))}%"></div></div>
            </div>
            <div class="note-sync" title="Calculada a partir das avaliações corrigidas (atividades em avaliação aguardam nota)">🔗 ${esc(gradedCount)} nota(s) lançada(s)${evaluatingCount ? ` · <span style="color:#f59e0b">${esc(evaluatingCount)} avaliando</span>` : ''}</div>`;
        } else {
            notaColHtml = `<div class="mini">
                <input type="number" min="0" max="10" step="0.1" value="${esc(r.nota)}" data-k="nota">
                ${hasTasks ? `<button type="button" class="btn-link-icon off" data-act="toggle-link" data-subj="${esc(r.id)}" title="Desvinculado. Clique para vincular às avaliações.">🔓</button>` : ''}
                <div class="pb"><div style="width:${esc(Math.min(100, (Number(r.nota) || 0) * 10))}%"></div></div>
            </div>
            <div class="note">${hasTasks ? 'Manual (desvinculada)' : ''}</div>`;
        }

        // Coluna Pontos a Receber
        let ptsColHtml = "";
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

        if (isLinked) {
            ptsColHtml = `<div class="mini">
                <input type="number" min="0" max="10" step="0.1" value="${esc(r.pts)}" data-k="pts" class="in-linked" readonly title="Pontos a receber das avaliações pendentes">
            </div>
            <div class="note">${goalStatus}</div>`;
        } else {
            ptsColHtml = `<div class="mini">
                <input type="number" min="0" max="10" step="0.1" value="${esc(r.pts)}" data-k="pts">
            </div>
            <div class="note">máx. possível: ${esc(fmt(maxPossivel))}</div>`;
        }

        return `<tr data-id="${esc(r.id)}" class="${faseKey === "Finalizada" ? "fin" : ""}">
<td><b>${esc(C[r.id].name)}</b><div class="note">${esc(r.id)}</div>${tasksActionBtn}</td>
<td>${notaColHtml}</td>
<td>${ptsColHtml}</td>
<td><div class="mini"><input type="number" min="0" value="${esc(r.falt)}" data-k="falt"></div><div class="note" style="color:${k.folga <= 2 ? "#f87171" : "var(--mut)"}">${k.folga < 0 ? "passou " + esc(-k.folga) + " do limite" : "folga: " + esc(k.folga) + " (limite " + esc(k.limit) + ")"}</div></td>
<td><div class="mini"><input class="sm" type="number" min="0" value="${esc(r.cum)}" data-k="cum"> / <input class="sm" type="number" min="0" value="${esc(r.prev)}" data-k="prev"></div><div class="note" style="color:${k.freq < 75 ? "#f87171" : "var(--mut)"}">frequência ${esc(fmt(k.freq))}%</div></td>
<td>${faseKey === "Finalizada" ? `<span class="rk" style="color:var(--ok)">✓ Aprovada</span>` : `<span class="rk">${esc(pc)}%</span> <span class="tag ${esc(TAGC[st])}" style="padding:2px 6px;border-radius:6px;font-size:12px;font-weight:600">${esc(st)}</span><div class="note">${k.pF > k.pN ? "pesa mais: faltas" : "pesa mais: nota"}</div>`}</td>
<td><select class="tag ${esc(TAGC[prioKey])}" data-k="prio">${optList(PRIO, prioKey)}</select><div class="note">${prioKey === "Auto" ? "sugerida: " + esc(pr) : ""}</div></td>
<td><select class="tag ${esc(TAGC[faseKey])}" data-k="fase">${optList(FASE, faseKey)}</select></td>
<td><button class="x" data-rm title="Remover">✕</button></td></tr>`;
    }).join("");
    document.getElementById("curEmpty").style.display = cur.length ? "none" : "";
    const n = cur.length;
    document.getElementById("curAvg").textContent = n ? `Média das notas: ${fmt(cur.reduce((s, r) => s + r.nota, 0) / n)} · Frequência média: ${fmt(cur.reduce((s, r) => s + risk(r).freq, 0) / n)}% · Reprovações esperadas: ${fmt(cur.reduce((s, r) => s + risk(r).p, 0))} de ${n}` : "";
}
document.getElementById("curAdd").onclick = () => {
    const id = document.getElementById("curSel").value; if (!id) return;
    S.current = [...(S.current || []), fixCur({ id })]; update()
};
function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#7f1d1d;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;z-index:9999"; document.body.appendChild(t) }
    t.textContent = "⚠️ " + msg; t.style.display = "block";
    clearTimeout(t._t); t._t = setTimeout(() => t.style.display = "none", 3500);
}
const cb = document.getElementById("curBody");
cb.onchange = e => {
    const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
    const r = S.current.find(x => x.id === tr.dataset.id);
    if (k === "nota" || k === "pts") {
        r.autoGrade = false;
    }
    let v = e.target.type === "number" ? Math.max(0, parseFloat(e.target.value) || 0) : e.target.value;
    if ((k === "nota" || k === "pts") && v > 10) { v = 10; toast("Valor máximo é 10."); }
    r[k] = v;
    if (k === "cum" && r.prev && r.cum > r.prev) toast("Aulas cumpridas não podem passar das aulas previstas.");
    if (k === "falt" && r.prev && r.falt > r.prev) toast("Faltas não podem passar das aulas previstas.");
    update()
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
            r.autoGrade = r.autoGrade === false ? true : false;
            update();
        }
        return;
    }
    if (!e.target.hasAttribute("data-rm")) return;
    const id = e.target.closest("tr").dataset.id; S.current = S.current.filter(x => x.id !== id); update()
};

// ---------- HORÁRIOS ----------
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex"], HORAS = ["07:10/08:50", "09:05/10:45", "11:00/12:40", "14:00/15:40", "16:00/17:40"];
const semAtual = () => new Date().getMonth() >= 6 ? 2 : 1;
function renderHor() {
    const H = S.hor.cells, P = passedSet(), cur = (S.current || []).map(r => r.id), hoje = new Date().getDay() - 1, half = semAtual(), yr = new Date().getFullYear();
    // oferta do semestre atual: não aprovadas, pré-requisitos cumpridos e semestre par/ímpar compatível (eletivas valem sempre)
    const disp = ORDER.filter(id => { const c = C[id]; return !cur.includes(id) && !P.has(id) && c.kind !== "tcc" && c.kind !== "op" && c.pre.every(p => P.has(p)) && (c.kind !== "ob" || ((c.sem % 2) ? 1 : 2) === half) });
    const op = (x, sel) => `<option value="${esc(x)}"${x === sel ? " selected" : ""}>${esc(x)} · ${esc(C[x].name)}</option>`;
    const opts = sel => `<option value="">—</option>` + (cur.length ? `<optgroup label="Cursando agora">${cur.map(x => op(x, sel)).join("")}</optgroup>` : "")
        + `<optgroup label="Ofertadas em ${esc(yr)}/${esc(half)}">${disp.map(x => op(x, sel)).join("")}</optgroup>`
        + (sel && hasCourse(sel) && !cur.includes(sel) && !disp.includes(sel) ? op(sel, sel) : "");
    document.getElementById("horNote").textContent = `Semestre atual: ${yr}/${half}. A lista traz o que você cursa e o que é ofertado neste semestre (com pré-requisitos cumpridos). Escolher uma matéria aqui também a coloca em "Cursando agora".`;
    document.querySelectorAll("table.hor thead th").forEach((th, j) => th.classList.toggle("today", j - 1 === hoje));
    document.getElementById("horBody").innerHTML = HORAS.map((h, i) => `<tr><th>${esc(h)}</th>` + DIAS.map((d, j) => {
        const c = H[i + "-" + j] || {};
        return `<td class="${j === hoje ? "today" : ""}"><select data-c="${esc(i)}-${esc(j)}" data-k="id">${opts(c.id)}</select><input data-c="${esc(i)}-${esc(j)}" data-k="sala" placeholder="sala" value="${esc(c.sala || "")}"></td>`
    }).join("") + "</tr>").join("");
}
document.getElementById("horBody").onchange = e => {
    const t = e.target, c = t.dataset.c; if (!c || !/^[0-4]-[0-4]$/.test(c)) return;
    const k = t.dataset.k;
    if (k !== "id" && k !== "sala") return;
    const val = k === "id" ? (hasCourse(t.value.trim()) ? t.value.trim() : "") : t.value.trim().slice(0, 60);
    S.hor.cells[c] = { ...(S.hor.cells[c] || {}), [k]: val };
    if (k === "id" && val && !(S.current || []).some(r => r.id === val) && !passedSet().has(val)) S.current = [...(S.current || []), fixCur({ id: val })];
    update()
};
// confirm() é bloqueado em páginas dentro de iframe/pré-visualização; por isso a confirmação é feita no próprio botão
function confirma(btn, txt, fn) {
    if (btn.dataset.arm) { clearTimeout(+btn.dataset.arm); delete btn.dataset.arm; btn.textContent = btn.dataset.t; fn(); return }
    btn.dataset.t = btn.textContent; btn.textContent = txt;
    btn.dataset.arm = setTimeout(() => { delete btn.dataset.arm; btn.textContent = btn.dataset.t }, 4000);
}
document.getElementById("horClear").onclick = e => confirma(e.currentTarget, "Clique de novo para limpar", () => { S.hor.cells = {}; update() });

// ---------- ATIVIDADES COMPLEMENTARES (Orientado a Dados pelo JSON do Curso) ----------
const AC_REQ = CUR.acReq, AC_SEC = CUR.acSections || {}, AC = CUR.acItems || [];
export function acCalc() {
    if (!CUR.acTable) return { rows: [], g: {}, tot: +S.acHoras || 0 };
    const g = {}, rows = AC.map((a, i) => { const u = Math.min(+S.ac[i] || 0, a[5]), ob = u * a[2], k = a[6] || "i" + i; (g[k] = g[k] || { ob: 0, max: a[4] }).ob += ob; return { u, ob, k } });
    let tot = 0; Object.values(g).forEach(x => { x.ct = Math.min(x.ob, x.max); tot += x.ct });
    return { rows, g, tot };
}
const acTotal = () => acCalc().tot;
function renderAC() {
    document.getElementById("acDet").style.display = CUR.acTable ? "" : "none";
    document.getElementById("acManual").style.display = CUR.acTable ? "none" : "";
    document.getElementById("acHoras").value = S.acHoras || "";
    const { rows, g, tot } = acCalc(), seen = {}; let sec = "", h = "";
    (CUR.acTable ? AC : []).forEach((a, i) => {
        const r = rows[i], v = +S.ac[i] || 0;
        if (a[0] !== sec) { sec = a[0]; h += `<tr class="sec"><td colspan="6"><b>${esc(sec)} – ${esc(AC_SEC[sec])}</b></td></tr>` }
        const f = !seen[r.k]; seen[r.k] = 1;
        h += `<tr><td>${esc(a[1])}<div class="note">${esc(a[3])} · máx. ${esc(a[5])} unid.${v > a[5] ? ` <span class="warn">(só ${esc(a[5])} contam)</span>` : ""}</div></td><td>${esc(a[2])} h</td><td><div class="mini"><input type="number" min="0" step="0.5" value="${esc(S.ac[i] || "")}" data-ac="${esc(i)}"></div></td><td>${esc(fmt(r.ob))} h</td><td>${f ? esc(fmt(g[r.k].ct)) + " h" : "<span class='note'>no grupo</span>"}</td><td>${f ? esc(a[4]) + " h" : ""}</td></tr>`
    });
    document.getElementById("acBody").innerHTML = h;
    document.getElementById("acBar").style.width = (AC_REQ ? Math.min(100, tot / AC_REQ * 100) : 100) + "%";
    document.getElementById("acSum").textContent = `${fmt(tot)} h de ${AC_REQ} h` + (tot >= AC_REQ ? " · meta atingida ✓" : ` · faltam ${fmt(AC_REQ - tot)} h`);
}
document.getElementById("acHoras").onchange = e => { S.acHoras = Math.max(0, parseFloat(e.target.value) || 0); update() };
document.getElementById("acBody").onchange = e => { const i = e.target.dataset.ac; if (i == null) return; S.ac[i] = Math.max(0, parseFloat(e.target.value) || 0); update() };

if ($("courseIcon")) $("courseIcon").textContent = CUR.icon || "🎓";
if ($("courseTitle")) $("courseTitle").textContent = CUR.title || "Curso";
$("subTxt").textContent = CUR.sub;
$("acLbl").textContent = `${CUR.acName || "Atividades Complementares"} (${AC_REQ}h) concluídas`;
$("tccBaseLbl").style.display = (!HAS_TCC || CUR.tccRest) ? "none" : "";
$("helpTccAnt").style.display = CUR.tccRest ? "" : "none";
const curSwEl = $("curSw");
if (curSwEl) {
    curSwEl.innerHTML = Object.values(CURS).map(c => `<option value="${esc(c.id)}"${c.id === KEY ? " selected" : ""}>${esc(c.label)}</option>`).join("");
    curSwEl.value = KEY;
    curSwEl.onchange = e => {
        const nextKey = e.target.value;
        if (!Object.prototype.hasOwnProperty.call(CURS, nextKey)) return;
        persist();
        try { localStorage.setItem("curriculo-ativo", nextKey) } catch (x) { }
        if (typeof history !== "undefined" && typeof history.replaceState === "function" && typeof location !== "undefined" && location.search) {
            const url = new URL(location.href);
            url.searchParams.delete("curso");
            history.replaceState(null, "", url.pathname + url.search);
        }
        location.reload();
    };
}
document.title = `Fluxograma — ${CUR.shortTitle || CUR.title}`;

// ---------- TRABALHOS E PROVAS ----------
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const pd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x };
const dayDiff = (a, b) => Math.round((pd(ymd(b)) - pd(ymd(a))) / 864e5);
const dfmt = s => {
    if (!s) return "—";
    const d = pd(s);
    return isNaN(d) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};
const TYPE_ICON = { "Trabalho": "📄", "Prova": "📝", "Seminário": "🎤", "Outro": "📌" };
let calMonth = new Date(); calMonth.setDate(1);

export function subjTotals(id) {
    const ts = (S.tasks || []).filter(t => t.subj === id);
    const total = Math.max(10, ts.reduce((s, t) => s + (parseFloat(t.pts) || 0), 0));
    return {
        ts,
        total,
        got: ts.reduce((s, t) => s + (t.got != null && t.got !== "" ? parseFloat(t.got) || 0 : 0), 0),
        graded: ts.filter(t => t.got != null && t.got !== "").reduce((s, t) => s + (parseFloat(t.pts) || 0), 0)
    };
}

export function importance(t) {
    const w = (t.pts || 0) / subjTotals(t.subj).total;
    const cr = (S.current || []).find(r => r.id === t.subj);
    const rp = cr ? risk(cr).p : 0;
    return Math.min(100, w * 100 * (1 + .5 * rp) * 1.6);
}

export function urgency(t, today, remH) {
    const slack = dayDiff(today, pd(t.due)) - remH / (+S.cap || 3);
    return slack <= 0 ? 100 : 100 / (1 + slack / 3);
}

export const prioOf = (t, today, remH) => .55 * importance(t) + .45 * urgency(t, today, remH);
export const prioLbl = p => p >= 70 ? ["Crítica", "r"] : p >= 50 ? ["Alta", "y"] : p >= 30 ? ["Média", "b"] : ["Baixa", "g"];

export function planTasks() {
    const today = pd(ymd(new Date())), pend = (S.tasks || []).filter(t => taskStatus(t) === "pendente" && t.due).map(t => ({ t, rem: t.eff || 1, start: null, plan: {} }));
    const cap = +S.cap || 3, res = {};
    let last = today; pend.forEach(p => { const d = pd(p.t.due); if (d > last) last = d });
    for (let d = new Date(today), n = 0; d <= last && n < 400; d = addDays(d, 1), n++) {
        const wk = d.getDay() === 0 || d.getDay() === 6;
        if (wk && !S.weekend) continue;
        let left = cap;
        const elig = pend.filter(p => p.rem > 0 && (dayDiff(d, pd(p.t.due)) >= 1 || (dayDiff(today, pd(p.t.due)) <= 0 && dayDiff(d, today) === 0)));
        elig.sort((a, b) => prioOf(b.t, d, b.rem) - prioOf(a.t, d, a.rem));
        for (const p of elig) {
            if (left <= 0) break;
            const h = Math.min(left, p.rem); p.rem -= h; left -= h;
            p.plan[ymd(d)] = h; if (!p.start) p.start = ymd(d);
        }
    }
    pend.forEach(p => res[p.t.id] = p);
    return res;
}

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
    if ($("trFormLegend")) $("trFormLegend").textContent = "Editar Avaliação — " + t.title;
    if ($("trSubj")) $("trSubj").value = t.subj;
    if ($("trType")) $("trType").value = t.type;
    if ($("trStatus")) $("trStatus").value = taskStatus(t);
    if ($("trTitle")) $("trTitle").value = t.title;
    if ($("trDue")) $("trDue").value = t.due || "";
    if ($("trPts")) $("trPts").value = t.pts;
    if ($("trGot")) $("trGot").value = t.got != null ? t.got : "";
    if ($("trEff")) $("trEff").value = t.eff;
    if ($("trAdd")) $("trAdd").textContent = "Atualizar Avaliação";
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    if ($("trTitle")) $("trTitle").focus();
}

window.openNewTaskModal = function (subjId) {
    if (window.showTab) window.showTab("t-tr");
    resetTaskForm();
    const wrap = $("trFormWrap");
    if (wrap) wrap.style.display = "block";
    if (subjId && $("trSubj")) $("trSubj").value = subjId;
    wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    if ($("trTitle")) $("trTitle").focus();
};

window.openTasksForSubject = function (subjId) {
    if (window.showTab) window.showTab("t-tr");
    S.trFilterSubj = subjId;
    S.trView = "subjects";
    update();
    setTimeout(() => {
        const card = document.getElementById("subj-card-" + subjId);
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
};

function renderTasks() {
    syncSubjectGrades();
    const cur = S.current || [], T = S.tasks || [], today = pd(ymd(new Date()));

    const selForm = $("trSubj");
    if (selForm) {
        const prev = selForm.value;
        selForm.innerHTML = cur.map(r => `<option value="${esc(r.id)}">${esc(C[r.id].name)}</option>`).join("") || `<option value="">(adicione matérias em "Cursando agora")</option>`;
        if (prev && cur.some(r => r.id === prev)) selForm.value = prev;
    }

    const selFilter = $("trFilterSubj");
    if (selFilter) {
        const prevF = S.trFilterSubj || "";
        selFilter.innerHTML = `<option value="">Todas as matérias (${esc(cur.length)})</option>` +
            cur.map(r => `<option value="${esc(r.id)}"${r.id === prevF ? " selected" : ""}>${esc(C[r.id].name)}</option>`).join("");
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

    let filtered = T.filter(t => {
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
        if (sort === "due") {
            return (a.due || "9999").localeCompare(b.due || "9999");
        } else if (sort === "subj") {
            return (C[a.subj]?.name || "").localeCompare(C[b.subj]?.name || "", "pt-BR");
        } else if (sort === "pts") {
            return b.pts - a.pts;
        } else {
            return prioOf(b, today, b.eff) - prioOf(a, today, a.eff);
        }
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

        return `<tr data-id="${esc(t.id)}" class="${st === 'avaliada' ? 'fin' : st === 'avaliando' ? 'is-evaluating' : ''}">
            <td style="text-align:center">
                <select class="tag-status status-${esc(st)}" data-act="set-status" title="Alterar status da avaliação">
                    <option value="pendente"${st === "pendente" ? " selected" : ""}>⏳ A Fazer</option>
                    <option value="avaliando"${st === "avaliando" ? " selected" : ""}>🔍 Avaliando</option>
                    <option value="avaliada"${st === "avaliada" ? " selected" : ""}>✅ Avaliada</option>
                </select>
            </td>
            <td>
                <div class="tr-task-title-cell">
                    <span class="tag-type tag-${esc(typeClass)}">${esc(TYPE_ICON[safeType] || "📌")} ${esc(safeType)}</span>
                    <b class="tr-title-text" data-act="edit" title="Clique para editar">${esc(t.title)}</b>
                </div>
            </td>
            <td>
                <button type="button" class="tr-subj-tag" data-act="filter-subj" data-subj="${esc(t.subj)}" title="Filtrar por esta matéria">
                    ${esc(C[t.subj]?.name || t.subj)}
                </button>
            </td>
            <td>
                <div class="tr-due-cell">
                    <span>${esc(dfmt(t.due))}</span>
                    ${dueBadge}
                </div>
                ${startPlan ? `<div class="note">Ideal começar: ${esc(startPlan)}</div>` : ""}
            </td>
            <td>
                <span class="tag ${esc(cl)}" style="padding:2px 8px;border-radius:6px;font-weight:600">${esc(lb)} · ${esc(Math.round(pr))}</span>
                <div class="note">${esc(fmt(t.pts))} pts (${esc(Math.round(t.pts / subjTotals(t.subj).total * 100))}% da matéria)</div>
            </td>
            <td>
                <div class="tr-grade-edit">
                    <input type="number" min="0" max="10" step="0.1" class="tr-in-got" data-act="set-got" value="${esc(t.got != null ? t.got : '')}" placeholder="${st === 'avaliando' ? 'aguardando' : '—'}" title="${st === 'avaliando' ? 'Aguardando professor corrigir (digite para lançar nota)' : 'Nota obtida'}">
                    <span class="note">/ <input type="number" min="0" step="0.5" class="tr-in-pts" data-act="set-pts" value="${esc(t.pts)}" title="Pontos que vale"> pts</span>
                </div>
                ${st === 'avaliando' ? `<div class="note" style="color:#f59e0b">⏳ Aguardando nota</div>` : ''}
                ${st === 'avaliada' && t.got != null ? `<div class="note" style="color:var(--ok)">✓ Nota lançada</div>` : ''}
            </td>
            <td>
                <div class="tr-eff-cell">
                    <input type="number" min="0.5" step="0.5" class="tr-in-eff" data-act="set-eff" value="${esc(t.eff)}"> h
                </div>
            </td>
            <td style="text-align:center">
                <button class="x" data-act="rm" title="Excluir avaliação">✕</button>
            </td>
        </tr>`;
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
        const tasksHtml = sortedTs.length ? sortedTs.map(t => {
            const st = taskStatus(t);
            const safeType = VALID_TASK_TYPES.includes(t.type) ? t.type : "Outro";
            return `<div class="tr-subj-task-item status-${esc(st)}" data-id="${esc(t.id)}">
                <select class="mini-status-sel status-${esc(st)}" data-act="set-status" title="Alterar status da avaliação">
                    <option value="pendente"${st === "pendente" ? " selected" : ""}>⏳ A Fazer</option>
                    <option value="avaliando"${st === "avaliando" ? " selected" : ""}>🔍 Avaliando</option>
                    <option value="avaliada"${st === "avaliada" ? " selected" : ""}>✅ Avaliada</option>
                </select>
                <span class="task-type-icon">${esc(TYPE_ICON[safeType] || "📌")}</span>
                <span class="task-item-title" title="${esc(t.title)}">${esc(t.title)}</span>
                <div class="tr-task-item-due note">${esc(dfmt(t.due))}</div>
                <div class="tr-task-item-grade">
                    <input type="number" min="0" max="10" step="0.1" class="mini-grade-in" data-act="set-got" value="${esc(t.got != null ? t.got : '')}" placeholder="${st === 'avaliando' ? 'aguardando' : '—'}" title="Nota obtida">
                    <span class="pts-max">/ ${esc(fmt(t.pts))} pts</span>
                </div>
                <button class="x btn-xs" data-act="rm" title="Excluir">✕</button>
            </div>`;
        }).join("") : `<div class="note" style="padding:10px 0;text-align:center">Nenhuma avaliação cadastrada para esta matéria.</div>`;

        return `<div class="tr-subj-card" id="subj-card-${esc(id)}">
            <div class="tr-subj-header">
                <div>
                    <h4 class="tr-subj-title">${esc(C[id].name)}</h4>
                    <div class="tr-subj-code">${esc(id)} · ${esc(C[id].aulas * 19)}h totais</div>
                </div>
                <div class="tr-subj-grade-badge">
                    <span class="grade-val ${esc(gradeColorClass)}">${esc(fmt(nota))}</span>
                    <span class="grade-max">/ 10.0</span>
                </div>
            </div>

            <div class="tr-subj-meta-row">
                ${statusTag}
                <span class="note">${esc(gradedTasks.length)} avaliada(s)${evaluatingTasks.length ? ` · <b style="color:#f59e0b">${esc(evaluatingTasks.length)} avaliando</b>` : ""} · ${esc(pendingTasks.length)} a fazer</span>
            </div>

            <div class="tr-grade-bar-wrap">
                <div class="tr-grade-bar">
                    <div class="bar-obtained" style="width:${esc(pctObt)}%" title="Nota obtida: ${esc(fmt(nota))}"></div>
                    <div class="bar-pending" style="width:${esc(pctPend)}%" title="Pontos a receber: ${esc(fmt(pts))}"></div>
                </div>
                <div class="tr-grade-marker" style="left:60%" title="Meta IFSP: 6.0">
                    <span class="marker-label">6.0</span>
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--mut);margin-top:-6px">
                <span>0.0</span>
                <span>${esc(fmt(nota))} obtidos + ${esc(fmt(pts))} em disputa = máx. ${esc(fmt(maxPossivel))}</span>
                <span>10.0</span>
            </div>

            <div class="tr-subj-tasks-header">
                <b>Avaliações cadastradas</b>
            </div>
            <div class="tr-subj-tasks">
                ${tasksHtml}
            </div>

            <div class="tr-subj-footer">
                <button type="button" class="btn-sm pri" data-act="new-for-subj" data-subj="${esc(id)}">+ Adicionar avaliação</button>
            </div>
        </div>`;
    }).join("");
}

function renderCal(plan) {
    const y = calMonth.getFullYear(), m = calMonth.getMonth(), todayS = ymd(new Date());
    $("calTitle").textContent = calMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const first = new Date(y, m, 1), start = addDays(first, -first.getDay()), ev = {};
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
        Object.entries(p.plan).forEach(([d, h]) => (ev[d] = ev[d] || []).push({ k: "work", t: p.t, h, p }));
    });

    let h = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(d => `<div class="ch">${esc(d)}</div>`).join("");
    for (let i = 0; i < 42; i++) {
        const d = addDays(start, i), s = ymd(d), items = (ev[s] || []).sort((a, b) => (a.k === "due" ? 0 : 1) - (b.k === "due" ? 0 : 1));
        h += `<div class="cd${d.getMonth() !== m ? " oth" : ""}${s === todayS ? " tdy" : ""}"><span class="dn">${esc(d.getDate())}</span>` + items.map(e => {
            const st = taskStatus(e.t);
            if (e.k === "due") {
                const cls = st === "avaliada" ? "ev due ok" : st === "avaliando" ? "ev due status-eval" : "ev due";
                const label = st === "avaliando" ? `🔍 ${esc(e.t.title)} (avaliando)` : `${esc(TYPE_ICON[e.t.type] || "")} ${esc(e.t.title)}`;
                return `<div class="${esc(cls)}" title="${esc(C[e.t.subj].name)} · vale ${esc(fmt(e.t.pts))} pts">${label}</div>`;
            } else {
                return `<div class="ev wk" title="${esc(C[e.t.subj].name)}">${esc(fmt(e.h))}h · ${esc(e.t.title)}</div>`;
            }
        }).join("") + "</div>";
    }
    $("cal").innerHTML = h;
}

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
    const sc = $("flowScroll"), fb = $("flowFallback");
    if (sc) {
        sc.style.display = flowView === "graph" ? "" : "none";
        sc.hidden = flowView !== "graph";
    }
    if (fb) {
        fb.style.display = flowView === "list" ? "" : "none";
        fb.hidden = flowView !== "list";
    }
    try { localStorage.setItem("fluxo-visao", flowView) } catch (e) { }
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
    const subj = $("trSubj").value, title = $("trTitle").value.trim(), due = $("trDue").value;
    if (!subj) return alert("Adicione primeiro uma matéria em \"Cursando agora\".");
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

    // Ações acionadas exclusivamente por clique (botões e links)
    if (e.type === "click") {
        if (act === "filter-subj") {
            const s = e.target.dataset.subj;
            S.trFilterSubj = s;
            update();
            return;
        }

        if (act === "new-for-subj") {
            const s = e.target.dataset.subj;
            window.openNewTaskModal(s);
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

    // Ações acionadas por alteração de campos (selects e inputs)
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
                t.got = null; // garante que não conta na nota atual!
            } else if (newStatus === "avaliada") {
                t.done = true;
            }
            update();
        } else if (act === "set-got") {
            const v = e.target.value.trim();
            if (v === "") {
                t.got = null;
                if (t.status === "avaliada") {
                    t.status = "avaliando";
                }
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

// ---------- FEEDBACK (Formspree) ----------


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

build(); update();
