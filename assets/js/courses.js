/**
 * Carregador Orientado a Dados de Cursos e Grades Curriculares (1 JSON por curso)
 *
 * Para adicionar um novo curso ao sistema:
 * 1. Crie um arquivo JSON em `assets/data/courses/<novo-curso>.json` seguindo o schema padrão.
 * 2. Registre-o em `assets/data/courses/index.json`.
 * O aplicativo carregará automaticamente o novo curso no seletor do topo, com todas as abas e funcionalidades.
 */

export function validateCourseConfig(cfg) {
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
        throw new Error("Configuração de curso inválida: esperado um objeto JSON.");
    }
    const id = String(cfg.id || "").trim();
    if (!id || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
        throw new Error(`ID de curso inválido: "${id}".`);
    }
    if (!Array.isArray(cfg.raw) || cfg.raw.length === 0) {
        throw new Error(`Curso "${id}" não possui lista de disciplinas ("raw").`);
    }
    const raw = cfg.raw.map((row, idx) => {
        if (!Array.isArray(row) || row.length < 6) {
            throw new Error(`Curso "${id}": disciplina na posição ${idx} inválida.`);
        }
        const [cid, name, sem, val, ext, pre] = row;
        return [
            String(cid).trim(),
            String(name).trim(),
            Number(sem) || 1,
            Number(val) || 0,
            ext ? 1 : 0,
            Array.isArray(pre) ? pre.map(p => String(p).trim()) : []
        ];
    });

    return {
        id,
        title: String(cfg.title || "Curso").trim(),
        shortTitle: String(cfg.shortTitle || cfg.title || id).trim(),
        label: String(cfg.label || cfg.title || id).trim(),
        icon: String(cfg.icon || "🎓").trim(),
        sub: String(cfg.sub || "").trim(),
        ls: String(cfg.ls || `fluxo-${id}-v1`).trim(),
        unit: cfg.unit === "horas" ? "horas" : "aulas",
        tccH: Number(cfg.tccH) || 0,
        acReq: Number(cfg.acReq) || 0,
        acName: String(cfg.acName || "Atividades Complementares").trim(),
        totalH: Number(cfg.totalH) || 3000,
        acTable: Boolean(cfg.acTable),
        tccRest: Boolean(cfg.tccRest),
        tccPct: cfg.tccPct !== undefined ? Number(cfg.tccPct) : 0.75,
        estMinPct: Number(cfg.estMinPct) || 0,
        eletNeed: cfg.eletNeed !== undefined ? Number(cfg.eletNeed) : 2,
        eletHeaderSub: String(cfg.eletHeaderSub || "Eletivas").trim(),
        eletDef: Array.isArray(cfg.eletDef) ? cfg.eletDef.map(String) : [],
        eletivas: Array.isArray(cfg.eletivas) ? cfg.eletivas.map(String) : [],
        tccLbl: String(cfg.tccLbl || "libera com 75% da carga").trim(),
        acSections: (cfg.acSections && typeof cfg.acSections === "object") ? cfg.acSections : {},
        acItems: Array.isArray(cfg.acItems) ? cfg.acItems : [],
        raw
    };
}

async function loadCoursesCatalog() {
    const isNode = typeof process !== "undefined" && Boolean(process.versions?.node) && (typeof window === "undefined" || window === globalThis);
    if (isNode && typeof fetch !== "function" || (isNode && !globalThis.__BROWSER_FETCH__)) {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/courses");
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
        const map = {};
        for (const entry of manifest.courses) {
            const rawJson = JSON.parse(fs.readFileSync(path.join(dir, entry.file), "utf8"));
            map[entry.id] = validateCourseConfig(rawJson);
        }
        return { defaultCourse: manifest.defaultCourse || "nova", courses: map };
    }

    const baseUrl = new URL("../data/courses/", import.meta.url);
    const manifestResp = await fetch(new URL("index.json", baseUrl));
    if (!manifestResp.ok) throw new Error("Falha ao carregar catálogo de cursos (index.json).");
    const manifest = await manifestResp.json();
    const entries = await Promise.all(
        manifest.courses.map(async entry => {
            const resp = await fetch(new URL(entry.file, baseUrl));
            if (!resp.ok) throw new Error(`Falha ao carregar JSON do curso: ${entry.file}`);
            const data = await resp.json();
            return [entry.id, validateCourseConfig(data)];
        })
    );
    return {
        defaultCourse: manifest.defaultCourse || "nova",
        courses: Object.fromEntries(entries)
    };
}

const catalog = await loadCoursesCatalog();
export const DEFAULT_COURSE_KEY = catalog.defaultCourse;
export const CURS = catalog.courses;
