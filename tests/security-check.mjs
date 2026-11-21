#!/usr/bin/env node
/**
 * Verificador Automatizado de Segurança e Qualidade (Anti-XSS / innerHTML / JSON Import)
 *
 * Executa 4 camadas de verificação:
 * 1. Análise Estática: verifica todos os templates HTML e usos de innerHTML em script.js e pedagogia/index.html,
 *    garantindo que toda interpolação ${...} passe por esc() ou seja expressão estática/sub-template seguro.
 * 2. Teste Unitário de esc(): garante escape de &, <, >, ", ' e tratamento seguro de null/undefined/números.
 * 3. Teste de Sanitização de JSON Malicioso (Fuzzing XSS & Prototype Pollution): testa sanitizeState() contra
 *    payloads maliciosos em todos os campos do JSON importado.
 * 4. Teste de Renderização DOM Completa + Verificação de CSP: executa o script real contra um DOM simulado
 *    com dados maliciosos (títulos de tarefas, salas, notas, etc.) e verifica que nenhum HTML/atributo injetado
 *    escapa para os elementos renderizados via innerHTML.
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passedChecks = 0;
function ok(msg) {
    passedChecks++;
    console.log(`  ✅ ${msg}`);
}

// ============================================================================
// 1. ANÁLISE ESTÁTICA DE innerHTML E INTERPOLAÇÕES ${...}
// ============================================================================
console.log("\n🔍 [1/4] Análise estática de innerHTML e chamadas a esc()...");

// Sub-templates internos cujo conteúdo já é montado com esc() e verificado pelo próprio scanner
const SAFE_HTML_FRAGMENTS = new Set([
    "tasksActionBtn",
    "notaColHtml",
    "ptsColHtml",
    "goalStatus",
    "dueBadge",
    "statusTag",
    "tasksHtml",
    "label",
    "opts(c.id)",
    "optList(PRIO, prioKey)",
    "optList(FASE, faseKey)",
    'cur.map(x => op(x, sel)).join("")',
    'disp.map(x => op(x, sel)).join("")',
    "curBtnHtml",
    "infoBtnHtml",
    "starBtnHtml",
    "preChips",
    "kidChips",
    "stBadge",
    "preHtml",
    "kidsHtml",
    "cardsHtml",
    "expKpiHtml",
    "listHtml",
    "folgaNote",
    "riskCellHtml",
    "evalSpan",
    "unlockBtn",
    "overCapWarn",
    "groupCell",
    "maxCell",
    "evalMeta",
    "passBadge",
    "statusBadge",
    "destHtml",
    "destSemHtml",
    "destHHtml",
    "outrosHtml",
    "aproveitadasHtml",
    "perdidasHtml"
]);

/**
 * Extrai todos os template literals de um código JS (incluindo aninhados),
 * retornando [{ content, line }] onde expressões internas com sub-templates
 * são preservadas integralmente.
 */
function extractAllTemplates(code) {
    const templates = [];
    const len = code.length;

    function scanCode(start, stopOnCloseBrace) {
        let i = start;
        let depth = 1;
        while (i < len) {
            const ch = code[i];
            if (ch === "\\") { i += 2; continue; }
            // Ignora comentários de linha e bloco
            if (ch === "/" && code[i + 1] === "/") {
                while (i < len && code[i] !== "\n") i++;
                continue;
            }
            if (ch === "/" && code[i + 1] === "*") {
                i += 2;
                while (i < len && !(code[i] === "*" && code[i + 1] === "/")) i++;
                i += 2;
                continue;
            }
            if (ch === '"' || ch === "'") {
                const q = ch; i++;
                while (i < len && code[i] !== q) {
                    if (code[i] === "\\") i++;
                    i++;
                }
                i++;
                continue;
            }
            if (ch === "`") {
                i = scanTemplate(i);
                continue;
            }
            if (stopOnCloseBrace) {
                if (ch === "{") depth++;
                else if (ch === "}") {
                    depth--;
                    if (depth === 0) return i + 1;
                }
            }
            i++;
        }
        return i;
    }

    function scanTemplate(backtickIdx) {
        const startLine = code.slice(0, backtickIdx).split(/\r?\n/).length;
        let i = backtickIdx + 1;
        const exprs = [];
        let rawContent = "";
        while (i < len && code[i] !== "`") {
            if (code[i] === "\\") {
                rawContent += code.slice(i, i + 2);
                i += 2;
                continue;
            }
            if (code[i] === "$" && code[i + 1] === "{") {
                const exprStart = i + 2;
                const exprEnd = scanCode(exprStart, true);
                const expr = code.slice(exprStart, exprEnd - 1).trim();
                exprs.push(expr);
                rawContent += "${" + expr + "}";
                i = exprEnd;
                continue;
            }
            rawContent += code[i];
            i++;
        }
        templates.push({ content: rawContent, exprs, line: startLine });
        return i + 1;
    }

    scanCode(0, false);
    return templates;
}

/**
 * Verifica se uma expressão interpolada dentro de um template HTML é segura:
 * - Chamada direta a esc(...)
 * - Sub-fragmento HTML conhecido (cujas próprias interpolações também são verificadas)
 * - Expressão ternária onde os resultados finais são literais estáticos ou usam esc()
 */
function isSafeInterpolation(expr) {
    const clean = expr.trim();
    if (clean.startsWith("esc(") && clean.endsWith(")")) return true;
    if (SAFE_HTML_FRAGMENTS.has(clean)) return true;

    // Sub-listas mapeadas cujo template interno já é auditado por extractAllTemplates
    if (/\.map\(/.test(clean) && clean.includes("`")) {
        return true;
    }

    // Ternários: verifica os valores resultantes (após '?' e ':')
    if (clean.includes("?") && clean.includes(":")) {
        // Primeiro remove chamadas esc(...), sub-templates e literais de string (que podem conter ':')
        const stripped = clean
            .replace(/esc\([^)]*\)/g, "__SAFE__")
            .replace(/`[\s\S]*?`/g, "__SAFE__")
            .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, "__SAFE__")
            .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "__SAFE__");
        // Divide por ':' e pega a parte de valor (após o último '?' de cada segmento)
        const parts = stripped.split(":").map(part => {
            const q = part.lastIndexOf("?");
            return (q >= 0 ? part.slice(q + 1) : part).trim();
        });
        const allResultsStatic = parts.every(p => {
            const noSafe = p.replace(/__SAFE__/g, "").replace(/[+\s()]/g, "");
            return noSafe === "";
        });
        if (allResultsStatic) return true;
    }

    return false;
}

function auditFileForUnescapedHtml(relPath) {
    const fullPath = path.join(ROOT, relPath);
    const code = fs.readFileSync(fullPath, "utf8");
    const lines = code.split(/\r?\n/);

    const innerHtmlCount = (code.match(/\.innerHTML\b/g) || []).length;
    const escCallCount = (code.match(/\besc\(/g) || []).length;

    const templates = extractAllTemplates(code);
    const violations = [];
    for (const tpl of templates) {
        const looksLikeHtml = /<[a-zA-Z/]|class=|value=|data-|style=|title=|<\/|placeholder=/.test(tpl.content);
        if (!looksLikeHtml) continue;

        for (const expr of tpl.exprs) {
            if (!isSafeInterpolation(expr)) {
                violations.push({ file: relPath, line: tpl.line, expr });
            }
        }
    }

    if (violations.length > 0) {
        console.error(`\n❌ Violação de segurança encontrada em ${relPath}:`);
        for (const v of violations) {
            console.error(`   Linha ~${v.line}: interpolação HTML sem esc() -> \${${v.expr}}`);
        }
        process.exit(1);
    }

    return { innerHtmlCount, escCallCount, lines: lines.length };
}

const JS_MODULES = [
    "assets/js/courses.js",
    "assets/js/state.js",
    "assets/js/risk.js",
    "assets/js/planner.js",
    "assets/js/calendar.js",
    "assets/js/equivalence.js",
    "assets/js/ui.js",
    "assets/js/script.js",
    "assets/js/feedback.js"
];

let totalInnerHtml = 0;
let totalEscCalls = 0;
for (const modPath of JS_MODULES) {
    const stats = auditFileForUnescapedHtml(modPath);
    totalInnerHtml += stats.innerHtmlCount;
    totalEscCalls += stats.escCallCount;
    // Verifica limite de tamanho do módulo e comprimento máximo de linha (<= 300 caracteres)
    const rawLines = fs.readFileSync(path.join(ROOT, modPath), "utf8").split(/\r?\n/);
    const longLines = rawLines
        .map((l, idx) => ({ line: idx + 1, len: l.length }))
        .filter(x => x.len > 300);
    assert.equal(
        longLines.length,
        0,
        `Módulo ${modPath} possui linha(s) com mais de 300 caracteres: ${JSON.stringify(longLines)}`
    );
}
ok(`Modularização verificada (${JS_MODULES.length} módulos JS): ${totalInnerHtml} usos de innerHTML, ${totalEscCalls} chamadas a esc(), 0 interpolações sem escape e 0 linhas > 300 caracteres.`);
assert.ok(
    totalEscCalls >= totalInnerHtml,
    `Esperado número de chamadas a esc() (${totalEscCalls}) >= usos de innerHTML (${totalInnerHtml})`
);

// Verifica catálogo de cursos orientado a dados (1 JSON por curso em assets/data/courses/)
const coursesDir = path.join(ROOT, "assets/data/courses");
const manifest = JSON.parse(fs.readFileSync(path.join(coursesDir, "index.json"), "utf8"));
assert.ok(Array.isArray(manifest.courses) && manifest.courses.length >= 3, "index.json deve listar os cursos disponíveis");
for (const entry of manifest.courses) {
    const coursePath = path.join(coursesDir, entry.file);
    assert.ok(fs.existsSync(coursePath), `Arquivo JSON do curso "${entry.id}" deve existir: ${entry.file}`);
    const data = JSON.parse(fs.readFileSync(coursePath, "utf8"));
    assert.equal(data.id, entry.id);
    assert.ok(Array.isArray(data.raw) && data.raw.length > 0, `Curso "${entry.id}" deve ter disciplinas em "raw"`);
}
ok(`Arquitetura orientada a dados verificada: ${manifest.courses.length} cursos carregados de arquivos JSON independentes em assets/data/courses/.`);

// ============================================================================
// 2. AMBIENTE DOM SIMULADO + TESTE UNITÁRIO DE esc()
// ============================================================================
console.log("\n🧪 [2/4] Testando função esc() contra vetores de XSS...");

function createMockElement(tag = "div") {
    const el = {
        tagName: tag.toUpperCase(),
        id: "",
        className: "",
        value: "",
        checked: false,
        disabled: false,
        textContent: "",
        _innerHTML: "",
        style: {},
        dataset: {},
        attributes: {},
        children: [],
        classList: {
            _set: new Set(),
            add(...cls) { cls.forEach(c => this._set.add(c)); },
            remove(...cls) { cls.forEach(c => this._set.delete(c)); },
            toggle(c, force) {
                const on = force !== undefined ? !!force : !this._set.has(c);
                if (on) this._set.add(c); else this._set.delete(c);
                return on;
            },
            contains(c) { return this._set.has(c); }
        },
        appendChild(child) { this.children.push(child); return child; },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k]; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
        querySelector() { return createMockElement(); },
        querySelectorAll() { return []; },
        scrollIntoView() {},
        focus() {},
        click() {},
        reset() {}
    };
    Object.defineProperty(el, "innerHTML", {
        get() { return this._innerHTML; },
        set(v) { this._innerHTML = String(v); }
    });
    return el;
}

const elementsById = new Map();
function getMockEl(id) {
    if (!elementsById.has(id)) {
        const el = createMockElement();
        el.id = id;
        elementsById.set(id, el);
    }
    return elementsById.get(id);
}

const storageMap = new Map();
globalThis.localStorage = {
    getItem(k) { return storageMap.has(k) ? storageMap.get(k) : null; },
    setItem(k, v) { storageMap.set(k, String(v)); },
    removeItem(k) { storageMap.delete(k); },
    clear() { storageMap.clear(); }
};
globalThis.window = globalThis;
globalThis.location = { reload() {} };
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.document = {
    title: "",
    body: createMockElement("body"),
    getElementById(id) { return getMockEl(id); },
    createElement(tag) { return createMockElement(tag); },
    createElementNS(_ns, tag) { return createMockElement(tag); },
    querySelector() { return createMockElement(); },
    querySelectorAll() { return []; }
};

const { esc, sanitizeState, validateStateSchema, bindTablist } = await import("../assets/js/script.js");

assert.equal(esc('<script>alert("xss")</script>'), "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
assert.equal(esc(`' onload='alert(1)`), "&#39; onload=&#39;alert(1)");
assert.equal(esc("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
assert.equal(esc(null), "");
assert.equal(esc(undefined), "");
assert.equal(esc(10), "10");
ok("esc() neutraliza &, <, >, \", ' e lida com null/undefined/números corretamente.");

// ============================================================================
// 3. TESTE DE SANITIZAÇÃO DE JSON MALICIOSO (XSS & PROTOTYPE POLLUTION)
// ============================================================================
console.log("\n🛡️ [3/4] Testando sanitizeState() contra JSON malicioso importado...");

const maliciousJson = JSON.parse(`{
    "version": "<script>alert(1)</script>",
    "curriculo": "__proto__",
    "passed": ["ALP1", "<img src=x onerror=alert(1)>", "toString", "constructor", "__proto__", "TCC"],
    "electivePlan": ["TPRO", "<svg onload=alert(1)>", "valueOf"],
    "startYear": "\\"><script>alert(1)</script>",
    "startHalf": "<img src=x onerror=alert(1)>",
    "maxLoad": "999999",
    "failRate": "\\"><img src=x onerror=alert(1)>",
    "respectParity": "yes",
    "acDone": "<script>",
    "expect": "-500",
    "scen": "99",
    "tccBase": "\\"><script>",
    "curSort": "\\"><script>",
    "current": [
        {
            "id": "ALP1",
            "nota": "\\"><img src=x onerror=alert('nota')>",
            "pts": "\\"><img src=x onerror=alert('pts')>",
            "prev": "\\"><img src=x onerror=alert('prev')>",
            "cum": "\\"><img src=x onerror=alert('cum')>",
            "falt": "\\"><img src=x onerror=alert('falt')>",
            "prio": "\\"><script>alert('prio')</script>",
            "fase": "\\"><script>alert('fase')</script>",
            "autoGrade": "false"
        },
        {
            "id": "<script>alert('id')</script>",
            "nota": 5
        },
        {
            "id": "toString",
            "nota": 5
        }
    ],
    "tasks": [
        {
            "id": "\\"><img src=x onerror=alert('task_id')>",
            "subj": "ALP1",
            "type": "<img src=x onerror=alert('type')>",
            "status": "\\"><img src=x onerror=alert('status')>",
            "title": "\\"><img src=x onerror=alert('title')><script>evil()</script>",
            "due": "\\"><script>alert('due')</script>",
            "pts": "\\"><img src=x onerror=alert('tpts')>",
            "got": "\\"><img src=x onerror=alert('tgot')>",
            "eff": "\\"><img src=x onerror=alert('teff')>"
        },
        {
            "id": "bad_subj",
            "subj": "constructor",
            "title": "Tentativa de Prototype Lookup"
        }
    ],
    "hor": {
        "cells": {
            "0-0": {
                "id": "ALP1",
                "sala": "\\"><img src=x onerror=alert('sala')>"
            },
            "0-1": {
                "id": "toString",
                "sala": "Lab 1"
            },
            "<script>": {
                "id": "ALP1",
                "sala": "Invalida"
            }
        }
    },
    "ac": {
        "0": "\\"><img src=x onerror=alert('ac')>",
        "999": 50,
        "evil": "<script>"
    },
    "acHoras": "\\"><script>alert('acHoras')</script>",
    "cap": "\\"><script>",
    "trView": "\\"><script>",
    "trSort": "\\"><script>",
    "trFilterSubj": "\\"><script>",
    "trFilterType": "\\"><script>",
    "trFilterStatus": "\\"><script>"
}`);

const clean = sanitizeState(maliciousJson, "nova");

assert.equal(clean.curriculo, "nova");
assert.deepEqual(clean.passed, ["ALP1", "TCC1", "TCC2"]);
assert.deepEqual(clean.electivePlan, ["TPRO"]);
assert.equal(typeof clean.startYear, "number");
assert.ok(clean.startYear >= 2020 && clean.startYear <= 2060);
assert.ok(clean.startHalf === 1 || clean.startHalf === 2);
assert.equal(clean.maxLoad, 12);
assert.equal(typeof clean.failRate, "number");
assert.equal(typeof clean.respectParity, "boolean");
assert.equal(typeof clean.acDone, "boolean");
assert.equal(clean.expect, 30);
assert.equal(clean.scen, 0);
assert.equal(clean.tccBase, "total");
assert.equal(clean.curSort, "add");

// Verifica matéria em curso sanitizada
assert.equal(clean.current.length, 1);
const c0 = clean.current[0];
assert.equal(c0.id, "ALP1");
assert.equal(typeof c0.nota, "number");
assert.equal(typeof c0.pts, "number");
assert.equal(typeof c0.prev, "number");
assert.equal(typeof c0.cum, "number");
assert.equal(typeof c0.falt, "number");
assert.equal(c0.prio, "Auto");
assert.equal(c0.fase, "Consumindo");
assert.equal(c0.autoGrade, true);

// Verifica tarefa sanitizada
assert.equal(clean.tasks.length, 1);
const t0 = clean.tasks[0];
assert.match(t0.id, /^[a-zA-Z0-9_-]{1,40}$/);
assert.equal(t0.subj, "ALP1");
assert.equal(t0.type, "Outro");
assert.equal(t0.status, "pendente");
assert.equal(t0.due, "");
assert.equal(typeof t0.pts, "number");
assert.equal(t0.got, null);
assert.equal(typeof t0.eff, "number");

// Verifica horários e atividades complementares sanitizadas
assert.deepEqual(Object.keys(clean.hor.cells), ["0-0", "0-1"]);
assert.equal(clean.hor.cells["0-1"].id, "");
assert.deepEqual(clean.ac, {});
assert.equal(clean.acHoras, 0);
ok("sanitizeState() bloqueou prototype pollution, tipos inválidos e payloads XSS em todos os campos do JSON.");

const valMalicious = validateStateSchema(maliciousJson);
assert.equal(valMalicious.valid, false, "validateStateSchema() deve reprovar JSON com schema adulterado");
assert.ok(valMalicious.errors.length >= 2, "validateStateSchema() deve reportar múltiplos erros estruturais");
ok("validateStateSchema() detectou e rejeitou schema adulterado com mensagens claras.");

// ============================================================================
// 4. TESTE DE RENDERIZAÇÃO DOM COMPLETA E VERIFICAÇÃO DE CSP
// ============================================================================
console.log("\n🌐 [4/4] Testando renderização DOM completa com entradas maliciosas e CSP...");

const xssPayloadJson = {
    version: 1,
    curriculo: "nova",
    passed: ["ALP1"],
    current: [{ id: "ALP1", nota: 5, pts: 5, prev: 76, cum: 76, falt: 0 }],
    tasks: [{
        id: "t1",
        subj: "ALP1",
        type: "Outro",
        status: "pendente",
        title: "\"><img src=x onerror=alert('title')><script>evil()</script>",
        due: "",
        pts: 2,
        got: null,
        eff: 1
    }],
    hor: {
        cells: {
            "0-0": {
                id: "ALP1",
                sala: "\"><img src=x onerror=alert('sala')>"
            }
        }
    }
};

// Simula carregamento do JSON com payloads maliciosos via input de arquivo (#fileIn)
const fileIn = getMockEl("fileIn");
await fileIn.onchange({
    target: {
        files: [{
            async text() {
                return JSON.stringify(xssPayloadJson);
            }
        }],
        value: "malicious.json"
    }
});

// Verifica o innerHTML de todos os containers renderizados
const containersToVerify = [
    "flow",
    "flowFallback",
    "kpis",
    "timeline",
    "curSel",
    "curBody",
    "horBody",
    "acBody",
    "trSubj",
    "trFilterSubj",
    "trListBody",
    "trSubjectsCards",
    "cal",
    "equivKpis",
    "equivBody"
];

for (const id of containersToVerify) {
    const html = getMockEl(id).innerHTML;
    assert.ok(
        !/<script\b/i.test(html),
        `Tag <script> não escapada detectada em #${id}`
    );
    assert.ok(
        !/<img\b/i.test(html),
        `Tag <img> não escapada detectada em #${id}`
    );
    assert.ok(
        !/<svg\b/i.test(html),
        `Tag <svg> não escapada detectada em #${id}`
    );
    // Verifica em todas as tags HTML reais (<...>) que nenhum atributo de evento (on*=) foi injetado
    const realTags = html.match(/<[a-zA-Z][^>]*>/g) || [];
    for (const tag of realTags) {
        // Remove valores de atributos entre aspas ("..." ou '...') para verificar os nomes de atributos da tag
        const attrNamesOnly = tag.replace(/="[^"]*"/g, '=""').replace(/='[^']*'/g, "=''");
        assert.ok(
            !/\bon[a-z]+\s*=/i.test(attrNamesOnly),
            `Atributo de evento malicioso injetado em tag real de #${id}: ${tag}`
        );
    }
}

// Verifica que o título malicioso da tarefa e a sala maliciosa foram devidamente escapados no HTML
assert.ok(
    getMockEl("trListBody").innerHTML.includes("&quot;&gt;&lt;img src=x onerror=alert(&#39;title&#39;)&gt;&lt;script&gt;evil()&lt;/script&gt;"),
    "Título da tarefa com tentativa de XSS deve aparecer 100% escapado em #trListBody"
);
assert.ok(
    getMockEl("horBody").innerHTML.includes("value=\"&quot;&gt;&lt;img src=x onerror=alert(&#39;sala&#39;)&gt;\""),
    "Campo sala com tentativa de XSS deve aparecer 100% escapado em #horBody"
);
ok(`Todos os ${containersToVerify.length} containers de innerHTML renderizaram payloads maliciosos de forma 100% escapada e segura.`);

// Verifica CSP em index.html
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
assert.ok(
    indexHtml.includes('http-equiv="Content-Security-Policy"') && indexHtml.includes("script-src 'self'"),
    "index.html deve possuir meta tag Content-Security-Policy com script-src 'self'"
);
ok("index.html possui Content-Security-Policy ativa bloqueando scripts inline/injetados.");

// Verifica cache-busting automatizado e ausência de código morto (<script> comentado)
const { computeFileHash } = await import("../scripts/cache_bust.mjs");
const expectedCssHash = computeFileHash(path.join(ROOT, "assets/css/styles.css"));
const pedHtml = fs.readFileSync(path.join(ROOT, "pedagogia/index.html"), "utf8");
assert.ok(
    !/<!--[\s\S]*?<script[\s\S]*?-->/i.test(indexHtml),
    "index.html não deve conter tags <script> comentadas (código morto)"
);
assert.ok(
    indexHtml.includes(`styles.css?v=${expectedCssHash}`),
    `index.html deve conter styles.css com hash SHA-256 automatizado (?v=${expectedCssHash})`
);
assert.ok(
    !indexHtml.includes("styles.css?v=1.1") && !indexHtml.includes("styles.css?v=1.0"),
    "index.html não deve utilizar versões manuais (?v=1.1) em styles.css"
);
assert.ok(
    pedHtml.includes(`styles.css?v=${expectedCssHash}`),
    `pedagogia/index.html deve conter styles.css com hash SHA-256 automatizado (?v=${expectedCssHash})`
);
ok(`Cache-busting automatizado verificado (?v=${expectedCssHash}) e código morto (<script> comentado) removido.`);

// ============================================================================
// 5. TESTE DE ACESSIBILIDADE (WAI-ARIA TABLIST, TECLADO, MOBILE & FALLBACK)
// ============================================================================
console.log("\n♿ [5/5] Verificando WAI-ARIA tablist, navegação por teclado, mobile e fallback...");

// 5.1 Verifica atributos WAI-ARIA e <noscript> no HTML
assert.ok(indexHtml.includes('role="tablist"'), 'index.html deve conter role="tablist" nas abas');
assert.ok(indexHtml.includes('role="tab"'), 'index.html deve conter role="tab" nos botões de aba');
assert.ok(indexHtml.includes('role="tabpanel"'), 'index.html deve conter role="tabpanel" nos painéis');
assert.ok(indexHtml.includes('aria-selected="true"'), 'index.html deve conter aria-selected nos botões de aba');
assert.ok(indexHtml.includes("<noscript>"), "index.html deve possuir bloco <noscript> de fallback");
assert.ok(indexHtml.includes('id="flowFallback"'), "index.html deve possuir container #flowFallback para visão em lista");
assert.ok(indexHtml.includes('id="flowInspect"'), "index.html deve possuir painel #flowInspect para inspeção sem hover");
assert.ok(indexHtml.includes('id="tab-t-equiv"'), 'index.html deve conter botão da aba #tab-t-equiv');
assert.ok(indexHtml.includes('id="t-equiv"'), 'index.html deve conter painel de equivalência #t-equiv');

assert.ok(
    pedHtml.includes("../?curso=pedagogia") && pedHtml.includes('http-equiv="Content-Security-Policy"'),
    "pedagogia/index.html deve redirecionar para o app unificado (../?curso=pedagogia) com CSP ativa"
);
ok("Atributos WAI-ARIA (tablist/tab/tabpanel/aria-selected), fallbacks (<noscript> + #flowFallback) e redirecionamento unificado de Pedagogia presentes.");

// 5.2 Testa navegação por teclado (ArrowRight, ArrowLeft, Home, End) em bindTablist
let selectedTabVal = "a";
let focusedTabVal = null;
const mockTabs = ["a", "b", "c"].map(v => {
    const b = createMockElement("button");
    b.dataset.tab = v;
    b.focus = () => { focusedTabVal = v; };
    return b;
});
const mockTablist = createMockElement("div");
bindTablist(mockTablist, mockTabs, b => b.dataset.tab, (val, focus) => {
    selectedTabVal = val;
    if (focus) {
        const target = mockTabs.find(x => x.dataset.tab === val);
        if (target) target.focus();
    }
});

// ArrowRight de 'a' (0) -> 'b' (1)
mockTabs[0].onkeydown({ key: "ArrowRight", preventDefault() {} });
assert.equal(selectedTabVal, "b");
assert.equal(focusedTabVal, "b");

// ArrowLeft de 'a' (0) -> 'c' (2) (wrap-around)
mockTabs[0].onkeydown({ key: "ArrowLeft", preventDefault() {} });
assert.equal(selectedTabVal, "c");
assert.equal(focusedTabVal, "c");

// Home de 'c' (2) -> 'a' (0)
mockTabs[2].onkeydown({ key: "Home", preventDefault() {} });
assert.equal(selectedTabVal, "a");

// End de 'a' (0) -> 'c' (2)
mockTabs[0].onkeydown({ key: "End", preventDefault() {} });
assert.equal(selectedTabVal, "c");
ok("Navegação por teclado nas abas (ArrowRight, ArrowLeft, Home, End) funcionando conforme padrão WAI-ARIA.");

// 5.3 Verifica que o fallback em lista (#flowFallback) renderizou os semestres e botões de 1 toque
const fallbackHtml = getMockEl("flowFallback").innerHTML;
assert.ok(fallbackHtml.includes("fb-sem-group") && fallbackHtml.includes("data-fb-act=\"pass\"") && fallbackHtml.includes("data-fb-act=\"cur\""),
    "#flowFallback deve renderizar os grupos de semestre com botões diretos de Aprovada e Cursando");
ok("Fallback responsivo em lista (#flowFallback) e controles de toque renderizados com sucesso.");

console.log(`\n🎉 Todas as ${passedChecks} verificações de segurança e acessibilidade passaram com sucesso!\n`);
