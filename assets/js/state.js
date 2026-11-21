/**
 * Módulo de Estado, Grafo Curricular, Sanitização e Persistência (state.js)
 *
 * Responsabilidades:
 * - Construir o grafo de disciplinas (C, ORDER, OBR, EST, TCC_IDS) a partir do curso ativo em courses.js.
 * - Calcular ascendentes (anc), descendentes (desc) e profundidade da cadeia crítica (depth).
 * - Escapar strings para HTML seguro (esc) e validar/sanitizar o estado (sanitizeState, fixCur, fixTask).
 * - Gerenciar o estado global reativo (S) e sua persistência no localStorage e File System Access API.
 */

import { CURS, DEFAULT_COURSE_KEY, validateCourseConfig } from "./courses.js";
export { CURS, DEFAULT_COURSE_KEY, validateCourseConfig };

// ---------- CONSTANTES DE DOMÍNIO ----------
export const PRIO = ["Auto", "Alta", "Média", "Baixa"];
export const STAT = ["Crítico", "Moderado", "Recuperável", "Bem viável"];
export const FASE = ["Consumindo", "Revisando", "Finalizada"];
export const TAGC = {
    "Auto": "b",
    "Alta": "r",
    "Média": "y",
    "Baixa": "g",
    "Crítico": "r",
    "Moderado": "y",
    "Recuperável": "g",
    "Bem viável": "b",
    "Consumindo": "b",
    "Revisando": "y",
    "Finalizada": "g"
};

export const VALID_TASK_TYPES = ["Trabalho", "Prova", "Seminário", "Outro"];
export const VALID_TASK_STATUS = ["pendente", "avaliando", "avaliada"];
export const VALID_SORTS_CUR = ["add", "nome", "prio", "risco"];
export const VALID_VIEWS_TR = ["list", "subjects", "cal"];
export const VALID_SORTS_TR = ["prio", "due", "subj", "pts"];
export const TYPE_ICON = {
    "Trabalho": "📄",
    "Prova": "📝",
    "Seminário": "🎤",
    "Outro": "📌"
};
export const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex"];
export const HORAS = [
    "07:10/08:50",
    "09:05/10:45",
    "11:00/12:40",
    "14:00/15:40",
    "16:00/17:40"
];
const AC_MAX_ITEMS = 40;

// ---------- SELEÇÃO DO CURSO ATIVO E CONSTRUÇÃO DO GRAFO ----------
let activeKey = DEFAULT_COURSE_KEY;
try {
    const hasSearch = typeof location !== "undefined" && Boolean(location.search);
    const params = hasSearch ? new URLSearchParams(location.search) : null;
    const urlCurso = params ? params.get("curso") : null;
    if (urlCurso && Object.prototype.hasOwnProperty.call(CURS, urlCurso)) {
        activeKey = urlCurso;
        localStorage.setItem("curriculo-ativo", activeKey);
    } else {
        activeKey = localStorage.getItem("curriculo-ativo") || DEFAULT_COURSE_KEY;
    }
} catch (e) { }

if (!Object.prototype.hasOwnProperty.call(CURS, activeKey)) {
    activeKey = DEFAULT_COURSE_KEY;
}

export let KEY = activeKey;
export let CUR = CURS[KEY];
export let RAW = CUR.raw;
export let LS = CUR.ls;

/** Converte aulas semanais em horas relógio (19 semanas de 50 minutos). */
export const HRS = aulas => aulas * 19 * 50 / 60;

/**
 * Converte uma tupla bruta do JSON do curso em um objeto de disciplina normalizado.
 */
export function entryFromRaw(cur, [id, name, sem, val, ext, pre]) {
    const isHours = cur.unit === "horas";
    const kind = sem === 9
        ? "el"
        : sem === 10
            ? "op"
            : id.startsWith("TCC")
                ? "tcc"
                : id.startsWith("ES")
                    ? "es"
                    : "ob";
    const h = kind === "tcc" ? cur.tccH : (isHours ? val : HRS(val));
    const aulas = isHours ? Math.max(1, Math.round(h * 60 / (19 * 50))) : val;
    return { id, name, sem, aulas, ext: Boolean(ext), pre, h, kind, kids: [] };
}

export const C = {};
export const ORDER = [];
export const OBR = [];
export const EST = [];
export const TCC_IDS = [];
export let HAS_TCC = false;
export let OBR_H = 0;
export const EL_DEFAULT = [];
export const ELETIVAS = [];
export let AC_REQ = CUR.acReq;
export let AC_SEC = CUR.acSections || {};
export let AC = CUR.acItems || [];
export const HEADS = [];
export const depth = {};

const HEADS_WITH_TCC = [
    "1º sem", "2º sem", "3º sem", "4º sem", "5º sem",
    "6º sem", "7º sem", "8º sem", "Eletivas / Optativas", "Conclusão"
];
const HEADS_NO_TCC = [
    "1º sem", "2º sem", "3º sem", "4º sem", "5º sem",
    "6º sem", "7º sem", "8º sem", "Eletivas"
];

/** Reconstrói todas as estruturas do grafo curricular em memória para o curso ativo `CUR`. */
export function rebuildCourseGraph() {
    for (const k of Object.keys(C)) delete C[k];
    ORDER.length = 0;

    RAW.forEach(row => {
        const item = entryFromRaw(CUR, row);
        C[item.id] = item;
        ORDER.push(item.id);
    });
    ORDER.forEach(id => {
        C[id].pre.forEach(p => {
            if (C[p]) C[p].kids.push(id);
        });
    });

    OBR.length = 0;
    OBR.push(...ORDER.filter(i => C[i].kind === "ob"));
    EST.length = 0;
    EST.push(...ORDER.filter(i => C[i].kind === "es"));
    TCC_IDS.length = 0;
    TCC_IDS.push(...ORDER.filter(i => C[i].kind === "tcc"));
    HAS_TCC = TCC_IDS.length > 0;
    OBR_H = OBR.reduce((sum, i) => sum + C[i].h, 0);

    EL_DEFAULT.length = 0;
    EL_DEFAULT.push(...(CUR.eletDef || []));
    ELETIVAS.length = 0;
    ELETIVAS.push(...(CUR.eletivas || []));

    AC_REQ = CUR.acReq;
    AC_SEC = CUR.acSections || {};
    AC = CUR.acItems || [];

    HEADS.length = 0;
    HEADS.push(...(HAS_TCC ? HEADS_WITH_TCC : HEADS_NO_TCC));

    for (const k of Object.keys(depth)) delete depth[k];
    const visit = id => depth[id] ?? (depth[id] = 1 + Math.max(0, ...C[id].kids.map(visit)));
    ORDER.forEach(visit);
}

rebuildCourseGraph();

/** Retorna o índice da coluna visual no fluxograma para uma disciplina. */
export const colOf = c => {
    if (c.kind === "ob" || c.kind === "es") return c.sem - 1;
    if (c.kind === "el" || c.kind === "op") return 8;
    return 9;
};

/** Retorna o conjunto de todos os pré-requisitos diretos e indiretos (ascendentes) de `id`. */
export const anc = id => {
    const visited = new Set();
    const walk = x => C[x].pre.forEach(p => {
        if (!visited.has(p)) {
            visited.add(p);
            walk(p);
        }
    });
    walk(id);
    return visited;
};

/** Retorna o conjunto de todas as disciplinas dependentes diretas e indiretas (descendentes) de `id`. */
export const desc = id => {
    const visited = new Set();
    const walk = x => C[x].kids.forEach(k => {
        if (!visited.has(k)) {
            visited.add(k);
            walk(k);
        }
    });
    walk(id);
    return visited;
};

// ---------- SEGURANÇA, ESCAPE HTML E VALIDAÇÃO DE SCHEMA ----------
const ESC_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
};

/** Escapa caracteres especiais HTML (&, <, >, ", ') para prevenir XSS em innerHTML. */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ESC_MAP[ch]);

export const clampNum = (v, min, max, def) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export const clampInt = (v, min, max, def) => Math.round(clampNum(v, min, max, def));

export const hasCourse = (id, cMap = C) =>
    typeof id === "string" && Object.prototype.hasOwnProperty.call(cMap, id);

export function buildCourseMap(curKey) {
    if (curKey === KEY) return C;
    const cur = CURS[curKey] || CURS[DEFAULT_COURSE_KEY];
    const map = {};
    cur.raw.forEach(row => {
        const item = entryFromRaw(cur, row);
        map[item.id] = item;
    });
    return map;
}

const now = new Date();

/** Cria um objeto de estado padrão limpo para o curso informado. */
export const defaultState = (curKey = KEY) => ({
    version: 1,
    curriculo: curKey,
    passed: [],
    electivePlan: [],
    startYear: now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear(),
    startHalf: now.getMonth() >= 6 ? 1 : 2,
    maxLoad: 9,
    failRate: 20,
    respectParity: true,
    acDone: false,
    expect: 70,
    scen: 0,
    hor: { cells: {} },
    ac: {},
    acHoras: 0,
    tccBase: "total",
    curSort: "add",
    current: [],
    tasks: [],
    cap: 3,
    weekend: true,
    trView: "list",
    trSort: "prio",
    trFilterSubj: "",
    trFilterType: "",
    trFilterStatus: "unresolved",
    savedAt: null
});

/** Normaliza e limita os valores de uma disciplina em curso ("Cursando agora"). */
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
    return { id: r.id, nota, pts, prev, cum, falt, prio, fase, autoGrade };
};

/** Determina o status normalizado de uma tarefa/avaliação ('pendente' | 'avaliando' | 'avaliada'). */
export const taskStatus = t => {
    if (t && VALID_TASK_STATUS.includes(t.status)) return t.status;
    if (t && t.got != null && t.got !== "" && Number.isFinite(Number(t.got))) return "avaliada";
    if (t && t.done) return "avaliando";
    return "pendente";
};

/** Normaliza e valida todos os campos de uma tarefa/avaliação. */
export const fixTask = t => {
    const isSafeId = typeof t.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(t.id);
    const id = isSafeId
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

/**
 * Sanitiza um objeto bruto de estado (vindo do localStorage ou de arquivo JSON importado),
 * garantindo tipos seguros, limites numéricos, allowlists e proteção contra Prototype Pollution.
 */
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
    const rawCells = raw.hor && typeof raw.hor === "object" ? raw.hor.cells : null;
    if (rawCells && typeof rawCells === "object" && !Array.isArray(rawCells)) {
        for (const [k, v] of Object.entries(rawCells)) {
            if (/^[0-4]-[0-4]$/.test(k) && v && typeof v === "object" && !Array.isArray(v)) {
                const cid = hasCourse(v.id, cMap) ? v.id : "";
                const sala = typeof v.sala === "string" ? v.sala.trim().slice(0, 60) : "";
                if (cid || sala) cells[k] = { id: cid, sala };
            }
        }
    }

    const ac = {};
    if (raw.ac && typeof raw.ac === "object" && !Array.isArray(raw.ac)) {
        for (let i = 0; i < AC_MAX_ITEMS; i++) {
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
        trFilterStatus: ["all", "unresolved", ...VALID_TASK_STATUS].includes(raw.trFilterStatus)
            ? raw.trFilterStatus
            : "unresolved",
        savedAt: typeof raw.savedAt === "string" ? raw.savedAt.slice(0, 40) : null
    };
}

/**
 * Valida o esquema formal de um objeto JSON antes de ser aplicado ao estado da aplicação.
 * Verifica a presença de campos estruturais, integridade dos tipos e compatibilidade de currículo.
 *
 * @param {unknown} raw - Dado bruto a validar (tipicamente retornado por JSON.parse).
 * @returns {{ valid: boolean, errors: string[], targetCur: string }}
 */
export function validateStateSchema(raw) {
    const errors = [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {
            valid: false,
            errors: ["O arquivo não contém um objeto JSON válido."],
            targetCur: KEY
        };
    }

    if (raw.version !== undefined && (typeof raw.version !== "number" || !Number.isFinite(raw.version) || raw.version < 1)) {
        errors.push("Campo 'version' inválido: deve ser um número positivo.");
    }

    let targetCur = KEY;
    if (raw.curriculo !== undefined) {
        if (typeof raw.curriculo !== "string" || !raw.curriculo.trim()) {
            errors.push("Campo 'curriculo' inválido: deve ser uma string identificadora do curso.");
        } else if (!Object.prototype.hasOwnProperty.call(CURS, raw.curriculo)) {
            const validCurs = Object.keys(CURS).join(", ");
            errors.push(`Currículo '${raw.curriculo}' desconhecido. Currículos disponíveis: ${validCurs}.`);
        } else {
            targetCur = raw.curriculo;
        }
    }

    const appKeys = [
        "curriculo", "passed", "current", "tasks", "electivePlan",
        "hor", "ac", "acHoras", "startYear", "startHalf", "maxLoad"
    ];
    const hasAnyAppKey = appKeys.some(k => Object.prototype.hasOwnProperty.call(raw, k));
    if (!hasAnyAppKey) {
        errors.push("O arquivo JSON não é um backup reconhecido do Fluxograma (campos essenciais não encontrados).");
    }

    if (raw.passed !== undefined && !Array.isArray(raw.passed)) {
        errors.push("Campo 'passed' inválido: deve ser uma lista de códigos de disciplinas.");
    }
    if (raw.electivePlan !== undefined && !Array.isArray(raw.electivePlan)) {
        errors.push("Campo 'electivePlan' inválido: deve ser uma lista de códigos de disciplinas.");
    }

    if (raw.current !== undefined) {
        if (!Array.isArray(raw.current)) {
            errors.push("Campo 'current' inválido: deve ser uma lista de disciplinas em andamento.");
        } else {
            raw.current.forEach((item, idx) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                    errors.push(`Item em 'current[${idx}]' deve ser um objeto com dados da disciplina.`);
                } else if (!item.id || typeof item.id !== "string") {
                    errors.push(`Item em 'current[${idx}]' não possui o identificador 'id' da disciplina.`);
                }
            });
        }
    }

    if (raw.tasks !== undefined) {
        if (!Array.isArray(raw.tasks)) {
            errors.push("Campo 'tasks' inválido: deve ser uma lista de tarefas.");
        } else {
            raw.tasks.forEach((item, idx) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                    errors.push(`Item em 'tasks[${idx}]' deve ser um objeto com dados da tarefa.`);
                } else if (!item.subj || typeof item.subj !== "string") {
                    errors.push(`Item em 'tasks[${idx}]' não possui a matéria 'subj' associada.`);
                }
            });
        }
    }

    if (raw.hor !== undefined) {
        if (typeof raw.hor !== "object" || raw.hor === null || Array.isArray(raw.hor)) {
            errors.push("Campo 'hor' inválido: deve ser um objeto de grade horária.");
        } else if (raw.hor.cells !== undefined && (typeof raw.hor.cells !== "object" || raw.hor.cells === null || Array.isArray(raw.hor.cells))) {
            errors.push("Campo 'hor.cells' inválido: deve ser um mapeamento de horários.");
        }
    }

    if (raw.ac !== undefined && (typeof raw.ac !== "object" || raw.ac === null || Array.isArray(raw.ac))) {
        errors.push("Campo 'ac' inválido: deve ser um objeto de atividades complementares.");
    }

    return {
        valid: errors.length === 0,
        errors,
        targetCur
    };
}

// ---------- INSTÂNCIA DE ESTADO GLOBAL E PERSISTÊNCIA ----------
export let S = defaultState();
try {
    const saved = localStorage.getItem(LS);
    if (saved) S = sanitizeState(JSON.parse(saved), KEY);
} catch (e) {
    S = defaultState();
}

export const getState = () => S;
export const setState = next => {
    S = sanitizeState(next, KEY);
    return S;
};

/**
 * Alterna dinamicamente o curso ativo em tempo de execução sem recarregar a página (sem location.reload).
 * Reconstrói o grafo curricular, carrega ou aplica o estado e sincroniza a persistência.
 *
 * @param {string} newKey - Identificador do curso (chave em CURS).
 * @param {Object} [stateToApply=null] - Estado opcional a ser aplicado (por exemplo, ao importar JSON).
 * @returns {Object} O estado S atualizado e sanitizado do novo curso.
 */
export function switchCourse(newKey, stateToApply = null) {
    if (!Object.prototype.hasOwnProperty.call(CURS, newKey)) {
        throw new Error(`Curso desconhecido: ${newKey}`);
    }
    KEY = newKey;
    CUR = CURS[KEY];
    RAW = CUR.raw;
    LS = CUR.ls;
    rebuildCourseGraph();

    if (stateToApply) {
        S = sanitizeState(stateToApply, KEY);
    } else {
        try {
            const saved = localStorage.getItem(LS);
            S = saved ? sanitizeState(JSON.parse(saved), KEY) : defaultState(KEY);
        } catch (e) {
            S = defaultState(KEY);
        }
    }

    try {
        localStorage.setItem("curriculo-ativo", KEY);
        localStorage.setItem(LS, JSON.stringify(S));
    } catch (e) { }

    return S;
}

let fileHandle = null;
export const getFileHandle = () => fileHandle;
export const setFileHandle = fh => { fileHandle = fh; };

/** Salva o estado atual no localStorage e sincroniza com o arquivo JSON vinculado (se houver). */
export function persist() {
    S.savedAt = new Date().toISOString();
    try {
        localStorage.setItem(LS, JSON.stringify(S));
    } catch (e) { }
    const infoEl = document.getElementById("saveInfo");
    if (infoEl) {
        const linked = fileHandle ? " · arquivo vinculado: " + fileHandle.name : "";
        infoEl.textContent = "Autosave no navegador: " + new Date().toLocaleTimeString() + linked;
    }
    if (fileHandle && !persist.busy) {
        persist.busy = true;
        fileHandle.createWritable()
            .then(w => w.write(JSON.stringify(S, null, 2)).then(() => w.close()))
            .catch(() => { })
            .finally(() => { persist.busy = false; });
    }
}
