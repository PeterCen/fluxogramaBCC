import { RAW_NOVA } from "./raw_new.js"
import { RAW_ANTIGA } from "./raw_old.js";

// ---------- ABAS ----------
(function () {
    const btns = [...document.querySelectorAll('#tabs button')];
    function show(id) {
        if (!document.getElementById(id)) id = 't-flow';
        btns.forEach(b => b.classList.toggle('act', b.dataset.tab === id));
        document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('act', p.id === id));
        try { localStorage.setItem('aba-ativa', id) } catch (e) { }
    }
    btns.forEach(b => b.onclick = () => show(b.dataset.tab));
    let a = 't-flow'; try { a = localStorage.getItem('aba-ativa') || a } catch (e) { }
    show(a);
})();

console.log(RAW_NOVA)

const CURS = {
    nova: {
        raw: RAW_NOVA, sub: "IFSP Câmpus Presidente Epitácio · PPC 2022 (vigência 1º/2023) · Dados extraídos do PDF do PPC", ls: "fluxo-ccomp-v1", tccH: 30, acReq: 65, totalH: 3354.2, acTable: true, tccRest: false,
        eletDef: ["TPRO", "INFR", "TCOM"], eletivas: ["TPRO", "INFR", "TCOM"], tccLbl: "libera com 75% da carga"
    },
    antiga: {
        raw: RAW_ANTIGA, sub: "IFSP Câmpus Presidente Epitácio · PPC 2018 (grade antiga, 3251 h) · Dados extraídos do PDF do PPC antigo", ls: "fluxo-ccomp-v1-antiga", tccH: 50, acReq: 80, totalH: 3251, acTable: false, tccRest: true,
        eletDef: ["TEPC0", "TPRC0", "TPWC0", "TSOC0", "TESC0", "IDSC0", "VCOC0", "RENC0", "CIDC0"], eletivas: ["TEPC0", "TPRC0", "TPWC0", "TSOC0", "IDSC0", "TESC0", "VCOC0", "RENC0", "CIDC0"], tccLbl: "libera nos 2 últimos semestres"
    }
};
let KEY = "nova"; try { KEY = localStorage.getItem("curriculo-ativo") || "nova" } catch (e) { }
if (!CURS[KEY]) KEY = "nova";
const CUR = CURS[KEY], RAW = CUR.raw;
const HRS = a => a * 19 * 50 / 60;
const C = {}; const ORDER = [];
RAW.forEach(([id, name, sem, aulas, ext, pre]) => { C[id] = { id, name, sem, aulas, ext: !!ext, pre, h: id.startsWith("TCC") ? CUR.tccH : HRS(aulas), kind: sem === 9 ? "el" : sem === 10 ? "op" : id.startsWith("TCC") ? "tcc" : "ob", kids: [] }; ORDER.push(id) });
ORDER.forEach(id => C[id].pre.forEach(p => C[p].kids.push(id)));
const OBR = ORDER.filter(i => C[i].kind === "ob");
const OBR_H = OBR.reduce((s, i) => s + C[i].h, 0);         // ~3102,6h
const EL_DEFAULT = CUR.eletDef;
const ELETIVAS = CUR.eletivas;
// prioridade = maior cadeia a jusante
const depth = {}; (function d() { const f = id => depth[id] ?? (depth[id] = 1 + Math.max(0, ...C[id].kids.map(f))); ORDER.forEach(f) })();
// ascendentes / descendentes
const anc = id => { const s = new Set(); const f = x => C[x].pre.forEach(p => { if (!s.has(p)) { s.add(p); f(p) } }); f(id); return s };
const desc = id => { const s = new Set(); const f = x => C[x].kids.forEach(p => { if (!s.has(p)) { s.add(p); f(p) } }); f(id); return s };

// ---------- ESTADO ----------
const now = new Date();
const defaultState = () => ({
    version: 1, curriculo: KEY, passed: [], electivePlan: [], startYear: now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear(),
    startHalf: now.getMonth() >= 6 ? 1 : 2, maxLoad: 9, failRate: 20, respectParity: true, acDone: false, expect: 70, scen: 0, hor: { cells: {} }, ac: {}, tccBase: "total", curSort: "add", current: [], tasks: [], cap: 3, weekend: true, savedAt: null
});
let S = defaultState();
const LS = CUR.ls;
const fixCur = r => {
    const prev = r.prev ?? C[r.id].aulas * 19, cum = r.cum ?? prev, nota = r.nota ?? 0;
    return { id: r.id, nota, pts: r.pts ?? Math.max(0, 10 - nota), prev, cum, falt: r.falt ?? Math.round((1 - (r.freq ?? 100) / 100) * cum), prio: r.prio && r.prio !== "Média" ? r.prio : "Auto", fase: r.fase || "Consumindo" }
};
try { const t = localStorage.getItem(LS); if (t) S = { ...S, ...JSON.parse(t) } } catch (e) { }
S.current = (S.current || []).filter(r => C[r.id]).map(fixCur);
S.tasks = (S.tasks || []).filter(t => C[t.subj]);
S.passed = (S.passed || []).flatMap(i => i === "TCC" ? ["TCC1", "TCC2"] : [i]).filter(i => C[i]);
S.electivePlan = (S.electivePlan || []).filter(i => C[i]);
let fileHandle = null;

// ---------- SIMULAÇÃO ----------
const half = k => ((S.startHalf - 1 + k) % 2) + 1;
const label = k => { const y = S.startYear + Math.floor((S.startHalf - 1 + k) / 2); return y + "/" + half(k) };
function electivesPlanned(passedSet) {
    const passedEl = ELETIVAS.filter(e => passedSet.has(e)).length;
    let need = Math.max(0, 2 - passedEl);
    const chosen = [];
    S.electivePlan.filter(e => !passedSet.has(e)).forEach(e => { if (chosen.length < need) chosen.push(e) });
    EL_DEFAULT.forEach(e => { if (chosen.length < need && !passedSet.has(e) && !chosen.includes(e)) chosen.push(e) });
    return chosen;
}
function toPlan(passedSet) {
    const pl = OBR.filter(i => !passedSet.has(i)).concat(electivesPlanned(passedSet));
    ["TCC1", "TCC2"].forEach(t => { if (!passedSet.has(t)) pl.push(t) });
    return pl;
}
const sig = x => 1 / (1 + Math.exp(-x));
function risk(r) {
    const cum = r.cum, prev = Math.max(r.prev, r.cum), limit = Math.floor(prev * .25), folga = limit - r.falt;
    const freq = cum ? (cum - r.falt) / cum * 100 : 100, esp = cum ? r.falt / cum * Math.max(0, prev - cum) * .6 : 0;
    const pF = folga < 0 ? 1 : sig((esp - folga - .5) / Math.max(1.2, .5 * Math.sqrt(esp + 1)));
    const need = 6 - r.nota; let pN = need <= 0 ? .02 : r.pts <= 0 ? 1 : sig((need / r.pts - S.expect / 100) / .1);
    if (need > 0 && r.nota + r.pts >= 4) pN *= .75;
    return { freq, limit, folga, pF, pN, p: 1 - (1 - pF) * (1 - pN) };
}
const riskMap = () => { const m = {}; (S.current || []).forEach(r => m[r.id] = risk(r).p); return m };
let rng = Math.random;
const seed = () => { let a = 12345; rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } };
// mode 0: passa em tudo que cursa · 1: reprova com risco ≥ 50% · 2: sorteia pelo risco
const acH = () => S.acDone ? AC_REQ : Math.min(AC_REQ, acTotal());
const gateH = P => OBR.filter(i => P.has(i)).reduce((a, i) => a + C[i].h, 0) + (S.tccBase === "obr" ? 0 : ELETIVAS.filter(i => P.has(i)).slice(0, 2).reduce((a, i) => a + C[i].h, 0) + acH());
const gateNeed = () => 0.75 * (S.tccBase === "obr" ? OBR_H : CUR.totalH);
const tccOpen = P => CUR.tccRest ? OBR.filter(i => !P.has(i)).length + electivesPlanned(P).length <= 2 * S.maxLoad : gateH(P) >= gateNeed();
function passedSet() { const P = new Set(S.passed); (S.current || []).forEach(r => { if (r.fase === "Finalizada") { P.add(r.id); anc(r.id).forEach(x => P.add(x)) } }); return P }
function simulate(fail, mode = 0, rm = riskMap()) {
    const passed = passedSet();
    (S.current || []).forEach(r => { const p = rm[r.id] ?? 0; if (mode === 0 || (mode === 1 && p < .5) || (mode === 2 && rng() >= p)) passed.add(r.id) });
    const pending = new Set(toPlan(passed)), terms = [];
    let done = OBR.filter(i => passed.has(i)).reduce((s, i) => s + C[i].h, 0);
    let k = 0;
    while (pending.size && k < 60) {
        const par = half(k);
        const cand = [...pending].filter(id => {
            const c = C[id];
            if (!c.pre.every(p => passed.has(p))) return false;
            if (c.kind === "tcc" && !tccOpen(passed)) return false;
            if (S.respectParity && (c.kind === "ob" || c.kind === "tcc") && ((c.sem % 2) ? 1 : 2) !== par) return false;
            return true;
        }).sort((a, b) => depth[b] - depth[a] || C[a].sem - C[b].sem);
        const take = cand.slice(0, S.maxLoad), got = [];
        take.forEach(id => { if (fail > 0 && rng() < fail) return; got.push(id) });
        got.forEach(id => { pending.delete(id) });
        terms.push({ k, taken: got });
        got.forEach(id => { passed.add(id); if (C[id].kind === "ob") done += C[id].h });
        k++;
    }
    return { terms, n: pending.size ? Infinity : terms.length };
}
function monte(fail) {
    seed(); const rm = riskMap(), arr = []; for (let i = 0; i < 1000; i++)arr.push(simulate(fail, 2, rm).n);
    arr.sort((a, b) => a - b); return { med: arr[500], p90: arr[899] };
}

// ---------- LAYOUT / RENDER ----------
const CW = 190, CH = 66, GX = 64, GY = 14, X0 = 20, Y0 = 56;
const colOf = c => c.kind === "ob" ? c.sem - 1 : c.kind === "el" ? 8 : c.kind === "op" ? 8 : 9;
const flow = document.getElementById("flow"), svg = document.getElementById("edges");
const pos = {}; const els = {};
function build() {
    const rows = {};
    ORDER.forEach(id => {
        const c = C[id]; const col = colOf(c); rows[col] = (rows[col] || 0);
        let r = rows[col]++; if (c.kind === "op" && col === 8) r += 0.4;
        pos[id] = { x: X0 + col * (CW + GX), y: Y0 + r * (CH + GY) }
    });
    // TCC e AC na última coluna
    pos["TCC"] = { x: X0 + 9 * (CW + GX), y: Y0 };
    const heads = ["1º sem", "2º sem", "3º sem", "4º sem", "5º sem", "6º sem", "7º sem", "8º sem", "Eletivas / Optativas", "Conclusão"];
    heads.forEach((h, i) => {
        const d = document.createElement("div"); d.className = "colh"; d.style.left = (X0 + i * (CW + GX)) + "px";
        d.innerHTML = h + (i < 8 ? `<small>${i % 2 ? "semestre par" : "semestre ímpar"}</small>` : i == 8 ? "<small>126,6h de eletivas</small>" : "<small>TCC + Complementares</small>"); flow.appendChild(d)
    });
    ORDER.forEach(id => {
        const c = C[id], p = pos[id], d = document.createElement("div");
        d.className = "card" + (c.ext ? " ext" : ""); d.style.left = p.x + "px"; d.style.top = p.y + "px";
        d.innerHTML = `<div class="chk"></div><div class="n">${c.name}</div><div class="m"><span>${id} · ${c.h.toFixed(1).replace(".", ",")}h</span><span class="plan"></span></div>` + (c.kind === "el" ? `<button class="star" title="Escolher esta eletiva">★</button>` : "");
        let clickT = null;
        d.onclick = e => {
            if (e.target.classList.contains("star")) { togglePlan(id); return }
            if (e.detail > 1) return;               // 2º clique do duplo clique: tratado em ondblclick
            clearTimeout(clickT); clickT = setTimeout(() => toggle(id), 260);
        };
        d.ondblclick = e => {
            if (e.target.classList.contains("star")) return;
            clearTimeout(clickT);
            const cur = S.current || [];
            if (cur.some(r => r.id === id)) S.current = cur.filter(r => r.id !== id);        // 2 cliques de novo = remove de "cursando"
            else if (!passedSet().has(id) && C[id].kind !== "tcc") S.current = [...cur, fixCur({ id })];
            update();
        };
        d.onmouseenter = () => hover(id); d.onmouseleave = () => hover(null);
        flow.appendChild(d); els[id] = d
    });
    const W = X0 * 2 + 10 * (CW + GX) - GX; flow.style.width = W + "px"; flow.style.height = (Y0 + (Math.max(...Object.values(rows)) + 0.6) * (CH + GY) + 20) + "px";
    svg.setAttribute("width", W); svg.setAttribute("height", parseFloat(flow.style.height));
    // arestas
    ORDER.forEach(id => C[id].pre.forEach(p => {
        const a = pos[p], b = pos[id]; const x1 = a.x + CW, y1 = a.y + CH / 2, x2 = b.x, y2 = b.y + CH / 2; const dx = Math.max(40, (x2 - x1) / 2);
        const e = document.createElementNS("http://www.w3.org/2000/svg", "path");
        e.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`); e.setAttribute("class", "e"); e.dataset.f = p; e.dataset.t = id; svg.appendChild(e)
    }));
    // TCC: seta de todas obrigatórias do 7º/8º semestre seria poluição; deixado como regra textual
    els.TCC1.querySelector(".n").innerHTML = `TCC 1 <span style='font-weight:400;color:var(--mut)'>(${CUR.tccLbl})</span>`;
}
function hover(id) {
    const cards = Object.values(els), edges = [...svg.children];
    if (!id) { cards.forEach(c => c.classList.remove("dim", "hl")); edges.forEach(e => e.classList.remove("dim", "hl")); return }
    const A = anc(id), D = desc(id); const set = new Set([id, ...A, ...D]);
    ORDER.forEach(i => { els[i].classList.toggle("dim", !set.has(i)); els[i].classList.toggle("hl", set.has(i) && i !== id) });
    edges.forEach(e => { const on = set.has(e.dataset.f) && set.has(e.dataset.t); e.classList.toggle("hl", on); e.classList.toggle("dim", !on) });
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
        //anc(id).forEach(x => P.add(x)) 
    }   // checkpoint: passou nela ⇒ passou nos pré-requisitos
    S.passed = [...P]; update()
}
function togglePlan(id) {
    const s = new Set(S.electivePlan); s.has(id) ? s.delete(id) : s.add(id); S.electivePlan = [...s]; update()
}

let lastPlan = null;
function update() {
    const P = passedSet();
    const best = simulate(0, 0), plan = +S.scen === 1 ? simulate(0, 1) : best; lastPlan = plan;
    const when = {}; plan.terms.forEach(t => t.taken.forEach(id => when[id] = t.k));
    const chosen = electivesPlanned(P);
    ORDER.forEach(id => {
        const c = C[id], el = els[id];
        const ready = c.pre.every(p => P.has(p));
        el.classList.toggle("passed", P.has(id));
        el.classList.toggle("cur", !P.has(id) && (S.current || []).some(r => r.id === id));
        el.classList.toggle("avail", !P.has(id) && ready && c.kind !== "tcc");
        el.classList.toggle("off", (c.kind === "el" && !P.has(id) && !chosen.includes(id)) || c.kind === "op" && !P.has(id));
        const pl = el.querySelector(".plan");
        const cr = (S.current || []).find(r => r.id === id), rp = cr && !P.has(id) ? risk(cr).p : 0;
        el.classList.toggle("hi", rp >= .6);
        pl.textContent = cr && !P.has(id) ? "⚠ " + Math.round(rp * 100) + "%" : ((!P.has(id) && when[id] !== undefined) ? label(when[id]) : "");
        const st = el.querySelector(".star"); if (st) st.classList.toggle("on", S.electivePlan.includes(id) || (chosen.includes(id)));
    });
    svg.querySelectorAll("path.e").forEach(e => e.classList.toggle("pass", P.has(e.dataset.f)));
    // KPIs
    const doneH = OBR.filter(i => P.has(i)).reduce((s, i) => s + C[i].h, 0) + ELETIVAS.filter(i => P.has(i)).slice(0, 2).reduce((s, i) => s + C[i].h, 0) + (P.has("TCC1") ? CUR.tccH : 0) + (P.has("TCC2") ? CUR.tccH : 0) + (S.acDone ? AC_REQ : Math.min(AC_REQ, acTotal()));
    const totalH = CUR.totalH, pct = Math.min(100.0, doneH / totalH * 100.0);
    const pend = OBR.filter(i => !P.has(i)).length;
    const min = best.n, mc = monte(S.failRate / 100), exp = (S.current || []).filter(r => !P.has(r.id)).reduce((s, r) => s + risk(r).p, 0);
    const fin = n => n === Infinity ? "—" : label(n - 1);
    const f = n => n === Infinity ? "∞" : n;
    document.getElementById("kpis").innerHTML = `
<div class="kpi main"><b>${f(min)} sem.</b><small>Mínimo restante · conclui em ${fin(min)}</small></div>
<div class="kpi"><b>${f(mc.med)} sem.</b><small>Provável (${S.failRate}% de falha) · ${fin(mc.med)}</small></div>
<div class="kpi"><b class="${mc.p90 > 16 ? 'warn' : ''}">${f(mc.p90)} sem.</b><small>Pessimista (P90) · ${fin(mc.p90)}</small></div>
<div class="kpi"><b>${pct.toFixed(2).replace(".", ",")}%</b><small>${doneH.toFixed(2).replace(".", ",")}h de ${totalH}h</small></div>
<div class="kpi"><b>${pend}</b><small>obrigatórias pendentes</small></div>
<div class="kpi"><b>${P.size ? [...P].filter(i => C[i].kind === "ob").length : 0}/${OBR.length}</b><small>obrigatórias aprovadas</small></div>` + ((S.current || []).some(r => !P.has(r.id)) ? `<div class="kpi"><b class="${exp >= 3 ? 'warn' : ''}">${exp.toFixed(1).replace(".", ",")}</b><small>reprovações esperadas neste semestre (de ${S.current.filter(r => !P.has(r.id)).length})</small></div>` : "");
    document.getElementById("bar").style.width = pct + "%";
    // timeline
    const T = document.getElementById("timeline"); T.innerHTML = "";
    plan.terms.forEach((t, i) => {
        if (!t.taken.length && i < plan.terms.length - 1 && false) return;
        const h = t.taken.reduce((s, id) => s + C[id].h, 0);
        const d = document.createElement("div"); d.className = "term" + (i == plan.terms.length - 1 ? " last" : "");
        d.innerHTML = `<h4>${i + 1}º período · ${label(t.k)}<span>${t.taken.length} disc. · ${h.toFixed(0)}h</span></h4>` +
            (t.taken.length ? `<ul>${t.taken.map(id => `<li>${C[id].name}</li>`).join("")}</ul>` : `<div class="note">Nenhuma disciplina disponível neste semestre (espera pela oferta).</div>`);
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
    const P = new Set(S.passed); OBR.filter(i => C[i].sem <= n).forEach(i => P.add(i)); S.passed = [...P]; e.target.value = ""; update()
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
        if ((j.curriculo || "nova") !== KEY) { localStorage.setItem(CURS[j.curriculo || "nova"].ls, JSON.stringify(j)); localStorage.setItem("curriculo-ativo", j.curriculo || "nova"); location.reload(); return }
        S = { ...defaultState(), ...j, passed: (j.passed || []).filter(i => C[i]), electivePlan: (j.electivePlan || []).filter(i => C[i]), current: (j.current || []).filter(r => C[r.id]).map(fixCur) }; update()
    }
    catch (err) { alert("JSON inválido: " + err.message) }
    e.target.value = ""
};

// ---------- CURSANDO / ESTATÍSTICAS ----------
const PRIO = ["Auto", "Alta", "Média", "Baixa"], STAT = ["Crítico", "Moderado", "Recuperável", "Bem viável"], FASE = ["Consumindo", "Revisando", "Finalizada"];
const TAGC = { "Auto": "b", "Alta": "r", "Média": "y", "Baixa": "g", "Crítico": "r", "Moderado": "y", "Recuperável": "g", "Bem viável": "b", "Consumindo": "b", "Revisando": "y", "Finalizada": "g" };
const fmt = n => String(Math.round(n * 100) / 100).replace(".", ",");
const optList = (arr, v) => arr.map(o => `<option${o === v ? " selected" : ""}>${o}</option>`).join("");
const effPrio = r => { const p = risk(r).p; return !r.prio || r.prio === "Auto" ? (p >= .15 && p <= .75 ? "Alta" : "Baixa") : r.prio };
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
    sel.innerHTML = ORDER.filter(i => !used.has(i) && !P.has(i) && C[i].kind !== "tcc").map(i => `<option value="${i}">${C[i].name}</option>`).join("");
    document.getElementById("curBody").innerHTML = cur.map(r => {
        const k = risk(r), pc = Math.round(k.p * 100), st = k.p >= .7 ? "Crítico" : k.p >= .4 ? "Moderado" : k.p >= .15 ? "Recuperável" : "Bem viável", pr = !r.prio || r.prio === "Auto" ? (k.p >= .15 && k.p <= .75 ? "Alta" : "Baixa") : r.prio;
        return `<tr data-id="${r.id}" class="${r.fase === "Finalizada" ? "fin" : ""}">
<td><b>${C[r.id].name}</b><div class="note">${r.id}</div></td>
<td><div class="mini"><input type="number" min="0" max="10" step="0.1" value="${r.nota}" data-k="nota"><div class="pb"><div style="width:${Math.min(100, r.nota * 10)}%"></div></div></div></td>
<td><div class="mini"><input type="number" min="0" max="10" step="0.1" value="${r.pts}" data-k="pts"></div><div class="note">máximo possível: ${fmt(r.nota + r.pts)}</div></td>
<td><div class="mini"><input type="number" min="0" value="${r.falt}" data-k="falt"></div><div class="note" style="color:${k.folga <= 2 ? "#f87171" : "var(--mut)"}">${k.folga < 0 ? "passou " + (-k.folga) + " do limite" : "folga: " + k.folga + " (limite " + k.limit + ")"}</div></td>
<td><div class="mini"><input class="sm" type="number" min="0" value="${r.cum}" data-k="cum"> / <input class="sm" type="number" min="0" value="${r.prev}" data-k="prev"></div><div class="note" style="color:${k.freq < 75 ? "#f87171" : "var(--mut)"}">frequência ${fmt(k.freq)}%</div></td>
<td>${r.fase === "Finalizada" ? `<span class="rk" style="color:var(--ok)">✓ Aprovada</span>` : `<span class="rk">${pc}%</span> <span class="tag ${TAGC[st]}" style="padding:2px 6px;border-radius:6px;font-size:12px;font-weight:600">${st}</span><div class="note">${k.pF > k.pN ? "pesa mais: faltas" : "pesa mais: nota"}</div>`}</td>
<td><select class="tag ${TAGC[r.prio || "Auto"]}" data-k="prio">${optList(PRIO, r.prio || "Auto")}</select><div class="note">${!r.prio || r.prio === "Auto" ? "sugerida: " + pr : ""}</div></td>
<td><select class="tag ${TAGC[r.fase]}" data-k="fase">${optList(FASE, r.fase)}</select></td>
<td><button class="x" data-rm title="Remover">✕</button></td></tr>`}).join("");
    document.getElementById("curEmpty").style.display = cur.length ? "none" : "";
    const n = cur.length;
    document.getElementById("curAvg").textContent = n ? `Média das notas: ${fmt(cur.reduce((s, r) => s + r.nota, 0) / n)} · Frequência média: ${fmt(cur.reduce((s, r) => s + risk(r).freq, 0) / n)}% · Reprovações esperadas: ${fmt(cur.reduce((s, r) => s + risk(r).p, 0))} de ${n}` : "";
}
document.getElementById("curAdd").onclick = () => {
    const id = document.getElementById("curSel").value; if (!id) return;
    S.current = [...(S.current || []), fixCur({ id })]; update()
};
const cb = document.getElementById("curBody");
cb.onchange = e => {
    const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
    const r = S.current.find(x => x.id === tr.dataset.id);
    r[k] = e.target.type === "number" ? Math.max(0, parseFloat(e.target.value) || 0) : e.target.value; update()
};
cb.onclick = e => {
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
    const op = (x, sel) => `<option value="${x}"${x === sel ? " selected" : ""}>${x} · ${C[x].name}</option>`;
    const opts = sel => `<option value="">—</option>` + (cur.length ? `<optgroup label="Cursando agora">${cur.map(x => op(x, sel)).join("")}</optgroup>` : "")
        + `<optgroup label="Ofertadas em ${yr}/${half}">${disp.map(x => op(x, sel)).join("")}</optgroup>`
        + (sel && !cur.includes(sel) && !disp.includes(sel) ? op(sel, sel) : "");
    document.getElementById("horNote").textContent = `Semestre atual: ${yr}/${half}. A lista traz o que você cursa e o que é ofertado neste semestre (com pré-requisitos cumpridos). Escolher uma matéria aqui também a coloca em "Cursando agora".`;
    document.querySelectorAll("table.hor thead th").forEach((th, j) => th.classList.toggle("today", j - 1 === hoje));
    document.getElementById("horBody").innerHTML = HORAS.map((h, i) => `<tr><th>${h}</th>` + DIAS.map((d, j) => {
        const c = H[i + "-" + j] || {};
        return `<td class="${j === hoje ? "today" : ""}"><select data-c="${i}-${j}" data-k="id">${opts(c.id)}</select><input data-c="${i}-${j}" data-k="sala" placeholder="sala" value="${c.sala || ""}"></td>`
    }).join("") + "</tr>").join("");
}
document.getElementById("horBody").onchange = e => {
    const t = e.target, c = t.dataset.c; if (!c) return;
    S.hor.cells[c] = { ...(S.hor.cells[c] || {}), [t.dataset.k]: t.value.trim() };
    if (t.dataset.k === "id" && t.value && !(S.current || []).some(r => r.id === t.value) && !passedSet().has(t.value)) S.current = [...(S.current || []), fixCur({ id: t.value })];
    update()
};
// confirm() é bloqueado em páginas dentro de iframe/pré-visualização; por isso a confirmação é feita no próprio botão
function confirma(btn, txt, fn) {
    if (btn.dataset.arm) { clearTimeout(+btn.dataset.arm); delete btn.dataset.arm; btn.textContent = btn.dataset.t; fn(); return }
    btn.dataset.t = btn.textContent; btn.textContent = txt;
    btn.dataset.arm = setTimeout(() => { delete btn.dataset.arm; btn.textContent = btn.dataset.t }, 4000);
}
document.getElementById("horClear").onclick = e => confirma(e.currentTarget, "Clique de novo para limpar", () => { S.hor.cells = {}; update() });

// ---------- ATIVIDADES COMPLEMENTARES (Anexo III) ----------
// [seção, atividade, h por unidade, unidade, máx. de horas, máx. de unidades, grupo (máx. compartilhado)]
const AC_REQ = CUR.acReq, AC_SEC = { I: "Pesquisa e inovação tecnológica", II: "Extensão", III: "Ensino", IV: "Outras atividades" };
const AC = [
    ["I", "Artigo completo em revista internacional", 40, "artigo", 40, 1, "A"], ["I", "Artigo completo em revista nacional", 30, "artigo", 40, 1, "A"],
    ["I", "Artigo completo em anais de evento internacional", 40, "artigo", 40, 1, "A"], ["I", "Artigo completo em anais de evento nacional", 30, "artigo", 40, 1, "A"],
    ["I", "Resumo em anais de evento", 5, "resumo", 40, 8, "A"], ["I", "Iniciação científica (bolsista ou voluntário)", 25, "projeto", 50, 2],
    ["II", "Projeto de extensão (bolsista ou voluntário)", 25, "projeto", 50, 2], ["II", "Maratona SBC – classificação para a final nacional", 40, "evento", 40, 1],
    ["II", "Maratona SBC – fase regional", 5, "evento", 10, 2], ["II", "Maratona IFSP – participação", 5, "evento", 10, 2],
    ["II", "Semana de Computação – participação (mín. 12 h)", 5, "evento", 20, 4], ["II", "Semana de Computação – organização/equipe", 5, "evento", 20, 4],
    ["II", "Semana Nac. de Ciência e Tecnologia – participação (mín. 12 h)", 5, "evento", 20, 4], ["II", "Semana Nac. de Ciência e Tecnologia – organização/equipe", 5, "evento", 20, 4],
    ["II", "Visitas técnicas", 2, "evento", 6, 3], ["II", "Atividades culturais e/ou esportivas", 1, "hora", 10, 10], ["II", "Proficiência em língua estrangeira", 20, "certificado", 20, 1],
    ["III", "Projeto de ensino (bolsista ou voluntário)", 25, "projeto", 50, 2], ["III", "Certificação tecnológica concluída", 20, "certificado", 20, 1],
    ["III", "ENADE – preparação (mais de 80% dos encontros)", 20, "participação", 20, 1], ["III", "Ministrante de curso ou palestra da área", 5, "curso", 10, 2],
    ["III", "Curso ou palestra da área (fora das semanas)", 1, "hora", 10, 10], ["III", "Treinamento de maratona (mais de 80% dos encontros)", 10, "participação", 10, 1],
    ["IV", "Aplicação desenvolvida e implantada", 10, "aplicação", 10, 1], ["IV", "ENADE – realização da prova", 10, "prova", 10, 1], ["IV", "POSCOMP – realização da prova", 5, "prova", 5, 1]];
function acCalc() {
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
        if (a[0] !== sec) { sec = a[0]; h += `<tr class="sec"><td colspan="6"><b>${sec} – ${AC_SEC[sec]}</b></td></tr>` }
        const f = !seen[r.k]; seen[r.k] = 1;
        h += `<tr><td>${a[1]}<div class="note">${a[3]} · máx. ${a[5]} unid.${v > a[5] ? ` <span class="warn">(só ${a[5]} contam)</span>` : ""}</div></td><td>${a[2]} h</td><td><div class="mini"><input type="number" min="0" step="0.5" value="${S.ac[i] || ""}" data-ac="${i}"></div></td><td>${fmt(r.ob)} h</td><td>${f ? fmt(g[r.k].ct) + " h" : "<span class='note'>no grupo</span>"}</td><td>${f ? a[4] + " h" : ""}</td></tr>`
    });
    document.getElementById("acBody").innerHTML = h;
    document.getElementById("acBar").style.width = Math.min(100, tot / AC_REQ * 100) + "%";
    document.getElementById("acSum").textContent = `${fmt(tot)} h de ${AC_REQ} h` + (tot >= AC_REQ ? " · meta atingida ✓" : ` · faltam ${fmt(AC_REQ - tot)} h`);
}
document.getElementById("acHoras").onchange = e => { S.acHoras = Math.max(0, parseFloat(e.target.value) || 0); update() };
document.getElementById("acBody").onchange = e => { const i = e.target.dataset.ac; if (i == null) return; S.ac[i] = Math.max(0, parseFloat(e.target.value) || 0); update() };

$("subTxt").textContent = CUR.sub;
$("acLbl").textContent = `Atividades Complementares (${AC_REQ}h) concluídas`;
$("tccBaseLbl").style.display = CUR.tccRest ? "none" : "";
$("helpTccAnt").style.display = CUR.tccRest ? "" : "none";
$("curSw").value = KEY;
$("curSw").onchange = e => { persist(); try { localStorage.setItem("curriculo-ativo", e.target.value) } catch (x) { } location.reload() };
document.title = "Fluxograma — Ciência da Computação (" + (KEY === "nova" ? "grade nova" : "grade antiga") + ")";

// ---------- TRABALHOS E PROVAS ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const pd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x };
const dayDiff = (a, b) => Math.round((pd(ymd(b)) - pd(ymd(a))) / 864e5);
const dfmt = s => pd(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const TYPE_ICON = { "Trabalho": "📄", "Prova": "📝", "Seminário": "🎤", "Outro": "📌" };
let calMonth = new Date(); calMonth.setDate(1);

function subjTotals(id) {
    const ts = S.tasks.filter(t => t.subj === id);
    const total = Math.max(10, ts.reduce((s, t) => s + t.pts, 0));
    return { ts, total, got: ts.reduce((s, t) => s + (t.got != null ? t.got : 0), 0), graded: ts.filter(t => t.got != null).reduce((s, t) => s + t.pts, 0) };
}
function importance(t) {
    const w = t.pts / subjTotals(t.subj).total, cr = (S.current || []).find(r => r.id === t.subj), rp = cr ? risk(cr).p : 0;
    return Math.min(100, w * 100 * (1 + .5 * rp) * 1.6);   // 1.6: uma prova de 6/10 já ≈ 100
}
function urgency(t, today, remH) {
    const slack = dayDiff(today, pd(t.due)) - remH / (+S.cap || 3);
    return slack <= 0 ? 100 : 100 / (1 + slack / 3);
}
const prioOf = (t, today, remH) => .55 * importance(t) + .45 * urgency(t, today, remH);
const prioLbl = p => p >= 70 ? ["Crítica", "r"] : p >= 50 ? ["Alta", "y"] : p >= 30 ? ["Média", "b"] : ["Baixa", "g"];

function planTasks() {
    const today = pd(ymd(new Date())), pend = S.tasks.filter(t => !t.done && t.due).map(t => ({ t, rem: t.eff, start: null, plan: {} }));
    const cap = +S.cap || 3, pending = [], res = {};
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
function renderTasks() {
    const cur = S.current || [], T = S.tasks, today = pd(ymd(new Date()));
    const sel = $("trSubj"), prev = sel.value;
    sel.innerHTML = cur.map(r => `<option value="${r.id}">${esc(C[r.id].name)}</option>`).join("") || `<option value="">(adicione matérias em "Cursando agora")</option>`;
    if (prev) sel.value = prev;
    if (!$("trDue").value) $("trDue").value = ymd(addDays(today, 7));
    $("trCap").value = S.cap; $("capV").textContent = S.cap + " h"; $("trWk").checked = S.weekend;
    const plan = planTasks(), pend = T.filter(t => !t.done && t.due);
    // resumo por matéria
    const subs = [...new Set(T.map(t => t.subj))];
    $("trSubjects").innerHTML = subs.length ? subs.map(id => {
        const s = subjTotals(id), cr = cur.find(r => r.id === id), np = s.ts.filter(t => !t.done).length;
        const items = s.ts.slice().sort((a, b) => (a.due || "").localeCompare(b.due || "")).map(t => `<li class="${t.done ? "dn" : ""}">${TYPE_ICON[t.type] || "📌"} ${esc(t.title)} · ${t.due ? dfmt(t.due) : "s/ data"} · ${t.got != null ? fmt(t.got) + "/" : ""}${fmt(t.pts)} pts</li>`).join("");
        return `<div class="kpi"><b style="font-size:15px">${esc(C[id].name)}</b><small>${cr ? "nota atual " + fmt(cr.nota) + " · " : ""}${np} pendente(s)</small>
<div class="bar" title="pontos obtidos / avaliados / total"><div style="width:${s.got / s.total * 100}%"></div></div>
<small>${fmt(s.got)} obtidos de ${fmt(s.graded)} corrigidos · ${fmt(s.total)} pts totais</small><ul class="tl">${items}</ul></div>`;
    }).join("") : `<div class="note">Sem atividades cadastradas.</div>`;
    // ranking
    const rows = pend.map(t => { const p = plan[t.id], rem = p ? p.rem : 0, pr = prioOf(t, today, t.eff); return { t, p, rem, pr, im: importance(t), ur: urgency(t, today, t.eff) } }).sort((a, b) => b.pr - a.pr);
    $("trRank").innerHTML = rows.map((r, i) => {
        const t = r.t, d = dayDiff(today, pd(t.due)), [lb, cl] = prioLbl(r.pr);
        const sit = d < 0 ? `<span class="warn">atrasada ${-d}d</span>` : r.rem > .01 ? `<span style="color:#f87171">não cabe (faltam ${fmt(r.rem)} h)</span>` : `<span style="color:var(--ok)">cabe no plano</span>`;
        return `<tr><td><b>${i + 1}</b></td><td><b>${TYPE_ICON[t.type] || ""} ${esc(t.title)}</b><div class="note">${esc(C[t.subj].name)}</div></td><td>${dfmt(t.due)}<div class="note">${d < 0 ? "vencida" : d === 0 ? "hoje" : "em " + d + " dia(s)"}</div></td><td>${fmt(t.pts)} <span class="note">(${Math.round(t.pts / subjTotals(t.subj).total * 100)}% da matéria)</span></td><td>${Math.round(r.im)}</td><td>${Math.round(r.ur)}</td><td><span class="tag ${cl}" style="padding:2px 8px;border-radius:6px;font-weight:600">${lb} · ${Math.round(r.pr)}</span></td><td>${r.p && r.p.start ? dfmt(r.p.start) : "—"}</td><td>${sit}</td></tr>`;
    }).join("");
    $("trEmpty").style.display = rows.length ? "none" : "";
    // lista completa
    $("trAll").innerHTML = T.slice().sort((a, b) => (a.due || "").localeCompare(b.due || "")).map(t => `<tr data-id="${t.id}" class="${t.done ? "fin" : ""}"><td>${esc(C[t.subj].name)}</td><td><select data-k="type">${optList(["Trabalho", "Prova", "Seminário", "Outro"], t.type)}</select></td><td><input data-k="title" value="${esc(t.title)}" style="width:150px"></td><td><input type="date" data-k="due" value="${t.due || ""}"></td><td><div class="mini"><input type="number" min="0" step="0.5" data-k="pts" value="${t.pts}"></div></td><td><div class="mini"><input type="number" min="0" step="0.1" data-k="got" value="${t.got ?? ""}" placeholder="—"></div></td><td><div class="mini"><input type="number" min="0.5" step="0.5" data-k="eff" value="${t.eff}"></div></td><td><input type="checkbox" data-k="done" ${t.done ? "checked" : ""}></td><td><button class="x" data-rm title="Remover">✕</button></td></tr>`).join("");
    renderCal(plan);
}
function renderCal(plan) {
    const y = calMonth.getFullYear(), m = calMonth.getMonth(), todayS = ymd(new Date());
    $("calTitle").textContent = calMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const first = new Date(y, m, 1), start = addDays(first, -first.getDay()), ev = {};
    S.tasks.forEach(t => { if (t.due) (ev[t.due] = ev[t.due] || []).push({ k: "due", t }) });
    Object.values(plan).forEach(p => Object.entries(p.plan).forEach(([d, h]) => (ev[d] = ev[d] || []).push({ k: "work", t: p.t, h, p })));
    let h = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map(d => `<div class="ch">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
        const d = addDays(start, i), s = ymd(d), items = (ev[s] || []).sort((a, b) => (a.k === "due" ? 0 : 1) - (b.k === "due" ? 0 : 1));
        h += `<div class="cd${d.getMonth() !== m ? " oth" : ""}${s === todayS ? " tdy" : ""}"><span class="dn">${d.getDate()}</span>` + items.map(e => e.k === "due"
            ? `<div class="ev due${e.t.done ? " ok" : ""}" title="${esc(C[e.t.subj].name)} · vale ${fmt(e.t.pts)} pts">${TYPE_ICON[e.t.type] || ""} ${esc(e.t.title)}</div>`
            : `<div class="ev wk" title="${esc(C[e.t.subj].name)}">${fmt(e.h)}h · ${esc(e.t.title)}</div>`).join("") + "</div>";
    }
    $("cal").innerHTML = h;
}
$("calPrev").onclick = () => { calMonth.setMonth(calMonth.getMonth() - 1); renderTasks() };
$("calNext").onclick = () => { calMonth.setMonth(calMonth.getMonth() + 1); renderTasks() };
$("calToday").onclick = () => { calMonth = new Date(); calMonth.setDate(1); renderTasks() };
$("trCap").oninput = e => { S.cap = +e.target.value; update() };
$("trWk").onchange = e => { S.weekend = e.target.checked; update() };
$("trAdd").onclick = () => {
    const subj = $("trSubj").value, title = $("trTitle").value.trim(), due = $("trDue").value;
    if (!subj) return alert("Adicione primeiro uma matéria em \"Cursando agora\".");
    if (!title || !due) return alert("Informe título e data.");
    S.tasks.push({ id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), subj, type: $("trType").value, title, due, pts: Math.max(0, +$("trPts").value || 0), got: null, eff: Math.max(.5, +$("trEff").value || 1), done: false });
    $("trTitle").value = ""; update();
};
$("trAll").onchange = e => {
    const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
    const t = S.tasks.find(x => x.id === tr.dataset.id), v = e.target;
    t[k] = k === "done" ? v.checked : k === "got" ? (v.value === "" ? null : Math.max(0, +v.value)) : ["pts", "eff"].includes(k) ? Math.max(k === "eff" ? .5 : 0, +v.value || 0) : v.value;
    if (k === "got" && t.got != null) t.done = true;
    update();
};
$("trAll").onclick = e => { if (!e.target.hasAttribute("data-rm")) return; const id = e.target.closest("tr").dataset.id; S.tasks = S.tasks.filter(x => x.id !== id); update() };
build(); update();
