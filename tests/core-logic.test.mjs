#!/usr/bin/env node
/**
 * Suíte de Testes Unitários da Lógica Pura de Domínio:
 * - Grafo Curricular e Caminho Crítico (depth, anc, desc)
 * - Cálculo de Risco de Reprovação (risk, riskMap, effPrio, syncSubjectGrades)
 * - Planejador Guloso de Semestres (simulate, electivesPlanned, toPlan, tccOpen, gateH, gateNeed)
 * - Simulação Monte Carlo (monte, seed)
 * - Planejador Guloso de Tarefas/Estudo e Atividades Complementares (planTasks, importance, urgency, prioOf, acCalc)
 */

import test from "node:test";
import assert from "node:assert/strict";

// Mock mínimo de DOM/Browser para importar o módulo script.js em Node.js
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

const script = await import("../assets/js/script.js");
const {
    CURS,
    validateCourseConfig,
    C,
    ORDER,
    OBR,
    OBR_H,
    ELETIVAS,
    depth,
    anc,
    desc,
    defaultState,
    sanitizeState,
    validateStateSchema,
    switchCourse,
    setState,
    getState,
    fixCur,
    syncSubjectGrades,
    half,
    label,
    electivesPlanned,
    toPlan,
    risk,
    seed,
    gateH,
    gateNeed,
    tccOpen,
    passedSet,
    simulate,
    monte,
    effPrio,
    acCalc,
    importance,
    urgency,
    prioOf,
    prioLbl,
    planTasks,
    EQUIVALENCE_DATA,
    migratePassedDisciplines,
    filterEquivalence,
    calcEquivalenceStats,
    formatSlotLabel,
    getDefaultCourseSlots,
    calcGraduationImpact,
    calcCourseDecisionScore,
    analyzeConflicts,
    buildOptimalSchedule,
    populateDefaultOfferings,
    getOfferedSemesters,
    populateDefaultSemesterOffers,
    findMaxCoursesSchedule,
    ENROLL_STATE
} = await import("../assets/js/script.js");

function resetState(overrides = {}) {
    return setState({
        ...defaultState("nova"),
        startYear: 2026,
        startHalf: 1,
        maxLoad: 9,
        failRate: 20,
        respectParity: true,
        acDone: false,
        expect: 70,
        ...overrides
    });
}

// ============================================================================
// 1. GRAFO CURRICULAR E CAMINHO CRÍTICO (anc, desc, depth)
// ============================================================================
test("Grafo curricular: ascendentes (anc), descendentes (desc) e profundidade de cadeia (depth)", () => {
    // ALP1 -> ALP2 -> EDA1 -> EDA2 -> IART -> APRM (cadeia de 6 níveis)
    const ancEda2 = anc("EDA2");
    assert.ok(ancEda2.has("EDA1"));
    assert.ok(ancEda2.has("ALP2"));
    assert.ok(ancEda2.has("ALP1"));
    assert.equal(ancEda2.size, 3);

    const descAlp1 = desc("ALP1");
    for (const id of ["ALP2", "POOB", "EDA1", "SOP1", "SOP2", "EDA2", "IART", "APRM"]) {
        assert.ok(descAlp1.has(id), `ALP1 deve ter ${id} como descendente`);
    }

    // Disciplina folha (sem dependentes) tem depth === 1
    assert.equal(depth["APRM"], 1);
    assert.equal(depth["TCC2"], 1);
    assert.equal(depth["TCC1"], 2);
    // ALP1 libera uma cadeia mais longa que disciplinas folha do 1º semestre (ex: COEX)
    assert.ok(depth["ALP1"] > depth["COEX"]);
    assert.equal(depth["COEX"], 1);
});

// ============================================================================
// 2. CÁLCULO DE RISCO DE REPROVAÇÃO (risk, effPrio, syncSubjectGrades)
// ============================================================================
test("Cálculo de risco (risk): reprovação imediata quando faltas ultrapassam 25% das aulas previstas", () => {
    resetState({ expect: 70 });
    // 76 aulas previstas => limite de 25% = 19 faltas
    const okFaltas = risk({ id: "ALP1", nota: 7, pts: 0, prev: 76, cum: 40, falt: 19 });
    assert.equal(okFaltas.limit, 19);
    assert.equal(okFaltas.folga, 0);
    assert.ok(okFaltas.pF < 1);

    // 20 faltas => folga = -1 => pF = 1 e risco total p = 1 (100%)
    const estourado = risk({ id: "ALP1", nota: 10, pts: 0, prev: 76, cum: 40, falt: 20 });
    assert.equal(estourado.folga, -1);
    assert.equal(estourado.pF, 1);
    assert.equal(estourado.p, 1);
});

test("Cálculo de risco (risk): meta de nota atingida (>= 6) vs. impossível atingir 6 sem pontos restantes", () => {
    resetState({ expect: 70 });
    // Nota >= 6 e sem faltas => pN = 0.02 e risco baixo
    const aprovadoNota = risk({ id: "ALP1", nota: 6.5, pts: 3, prev: 76, cum: 38, falt: 0 });
    assert.equal(aprovadoNota.pN, 0.02);
    assert.ok(aprovadoNota.p < 0.05);

    // Nota < 6 (mas >= 4) e pts = 0 => depende exclusivamente da NAF (pN = 1 * 0.75 = 0.75)
    const emNafSemPontos = risk({ id: "ALP1", nota: 5.5, pts: 0, prev: 76, cum: 76, falt: 0 });
    assert.equal(emNafSemPontos.pN, 0.75);

    // Nota < 4 e pts = 0 => nem atinge mínimo de 4.0 para NAF => pN = 1 e risco total p = 1
    const reprovadoNota = risk({ id: "ALP1", nota: 3.5, pts: 0, prev: 76, cum: 76, falt: 0 });
    assert.equal(reprovadoNota.pN, 1);
    assert.equal(reprovadoNota.p, 1);
});

test("Cálculo de risco (risk): redução de 25% pela NAF quando nota máxima possível >= 4 e sensibilidade a expect", () => {
    resetState({ expect: 70 });
    // Caso 1: nota = 2.0, pts = 2.5 => soma = 4.5 >= 4.0 (elegível à NAF, aplica * 0.75)
    // need = 4.0, need/pts = 1.6
    // Caso 2: nota = 1.0, pts = 1.875 => soma = 2.875 < 4.0 (inelegível à NAF), mesmo need/pts = 5.0 / 3.125 = 1.6
    const comNaf = risk({ id: "ALP1", nota: 2.0, pts: 2.5, prev: 76, cum: 38, falt: 0 });
    const semNaf = risk({ id: "ALP1", nota: 0.8, pts: 3.0, prev: 76, cum: 38, falt: 0 }); // soma = 3.8 < 4, need/pts = 5.2/3 = 1.73
    assert.ok(comNaf.pN <= 0.75, "Quando nota + pts >= 4, a NAF limita pN em no máximo 0.75");
    assert.ok(semNaf.pN > 0.75, "Quando nota + pts < 4, não há desconto de NAF");

    // Aumentar a expectativa de aproveitamento do aluno reduz o risco por nota
    resetState({ expect: 40 });
    const rBaixaExp = risk({ id: "ALP1", nota: 3.0, pts: 5.0, prev: 76, cum: 38, falt: 0 });
    resetState({ expect: 90 });
    const rAltaExp = risk({ id: "ALP1", nota: 3.0, pts: 5.0, prev: 76, cum: 38, falt: 0 });
    assert.ok(rAltaExp.pN < rBaixaExp.pN, "Maior expectativa de aproveitamento deve resultar em menor risco por nota");
});

test("Prioridade efetiva (effPrio) e sincronização de notas de avaliações (syncSubjectGrades)", () => {
    resetState({
        expect: 70,
        current: [
            fixCur({ id: "ALP1", nota: 7, pts: 3, prev: 76, cum: 38, falt: 0, prio: "Auto" }), // seguro (< 15%) -> Baixa
            fixCur({ id: "CLC1", nota: 2.5, pts: 5, prev: 76, cum: 38, falt: 6, prio: "Auto" }), // intermediário (15%..75%) -> Alta
            fixCur({ id: "BDD1", nota: 1, pts: 0, prev: 76, cum: 76, falt: 0, prio: "Auto" }) // perdido (100%) -> Baixa
        ]
    });
    const cur = getState().current;
    assert.equal(effPrio(cur[0]), "Baixa");
    assert.equal(effPrio(cur[1]), "Alta");
    assert.equal(effPrio(cur[2]), "Baixa");

    // Teste de syncSubjectGrades: só atividades 'avaliada' entram em r.nota; 'avaliando' e 'pendente' ficam em r.pts
    resetState({
        current: [fixCur({ id: "ALP1", nota: 0, pts: 10, autoGrade: true })],
        tasks: [
            { id: "t1", subj: "ALP1", type: "Prova", status: "avaliada", title: "P1", due: "2026-04-10", pts: 4, got: 3.2, eff: 4, done: true },
            { id: "t2", subj: "ALP1", type: "Trabalho", status: "avaliando", title: "T1", due: "2026-05-10", pts: 3, got: null, eff: 3, done: true },
            { id: "t3", subj: "ALP1", type: "Prova", status: "pendente", title: "P2", due: "2026-06-10", pts: 3, got: null, eff: 5, done: false }
        ]
    });
    syncSubjectGrades();
    const alp1 = getState().current[0];
    assert.equal(alp1.nota, 3.2);
    assert.equal(alp1.pts, 6.0); // 3 pts avaliando + 3 pts pendente
});

// ============================================================================
// 3. PLANEJADOR GULOSO DE SEMESTRES (simulate, electivesPlanned, tccOpen)
// ============================================================================
test("Planejador guloso (simulate): curso do zero respeita pré-requisitos, paridade par/ímpar, maxLoad e regra do TCC", () => {
    resetState({
        startYear: 2026,
        startHalf: 1,
        maxLoad: 8,
        respectParity: true,
        passed: [],
        electivePlan: ["TPRO", "INFR"]
    });

    const res = simulate(0, 0);
    assert.ok(Number.isFinite(res.n) && res.n >= 8, `Curso completo deve levar ao menos 8 semestres (calculado: ${res.n})`);

    const seenPassed = new Set();
    let tcc1Term = null;
    let tcc2Term = null;

    res.terms.forEach((term, idx) => {
        const semParity = half(term.k); // 1 (ímpar) ou 2 (par)
        assert.ok(term.taken.length <= 8, `Semestre ${idx} excedeu maxLoad=8 (${term.taken.length})`);

        // Verifica que todas as matérias agendadas neste período já tinham seus pré-requisitos concluídos ANTES deste período
        for (const id of term.taken) {
            const c = C[id];
            for (const pre of c.pre) {
                assert.ok(
                    seenPassed.has(pre),
                    `Disciplina ${id} foi alocada no período ${idx + 1} (${label(term.k)}) antes de seu pré-requisito ${pre}`
                );
            }
            if (c.kind === "ob" || c.kind === "tcc") {
                const expectedParity = (c.sem % 2) ? 1 : 2;
                assert.equal(
                    semParity,
                    expectedParity,
                    `Disciplina ${id} (sem ${c.sem}) foi alocada em semestre com paridade incorreta (${semParity})`
                );
            }
            if (id === "TCC1") tcc1Term = idx;
            if (id === "TCC2") tcc2Term = idx;
        }

        // Após o término do semestre, registra aprovações
        term.taken.forEach(id => seenPassed.add(id));
    });

    assert.ok(tcc1Term !== null && tcc2Term !== null, "TCC1 e TCC2 devem ser alocados no plano");
    assert.ok(tcc2Term > tcc1Term, "TCC2 só pode ser cursado após a conclusão do TCC1");
});

test("Planejador guloso: escolha de eletivas (electivesPlanned) e liberação de TCC (tccOpen)", () => {
    resetState({ electivePlan: ["TCOM"] });
    // Nenhuma eletiva aprovada: usa TCOM (escolhida) + 1ª eletiva padrão (TPRO)
    const plan0 = electivesPlanned(new Set());
    assert.deepEqual(plan0, ["TCOM", "TPRO"]);

    // 1 eletiva já aprovada (TPRO): precisa de apenas mais 1 (TCOM)
    const plan1 = electivesPlanned(new Set(["TPRO"]));
    assert.deepEqual(plan1, ["TCOM"]);

    // 2 eletivas já aprovadas: não planeja mais nenhuma
    const plan2 = electivesPlanned(new Set(["TPRO", "INFR"]));
    assert.deepEqual(plan2, []);

    // Regra dos 75% do TCC: com 0 matérias aprovadas, TCC está bloqueado
    assert.equal(tccOpen(new Set()), false);
    // Com todas as obrigatórias aprovadas, gateH >= gateNeed (75%) => TCC liberado
    assert.equal(tccOpen(new Set(OBR)), true);
});

test("Planejador guloso: diferença entre mode=0 (otimista) e mode=1 (reprova risco >= 50%) para matérias em curso", () => {
    // Quase formando: falta apenas APRM (8º sem, ímpar=0 -> par) e TCC2, e APRM está sendo cursada agora
    const allExceptAprmAndTcc2 = ORDER.filter(id => id !== "APRM" && id !== "TCC2" && C[id].kind !== "op");
    resetState({
        startYear: 2026,
        startHalf: 2, // próximo semestre é 2026/2 (par, onde APRM e TCC2 são ofertados)
        passed: allExceptAprmAndTcc2,
        acDone: true,
        current: [
            // APRM em curso, mas com 25 faltas (estourou limite => risco = 100% >= 50%)
            fixCur({ id: "APRM", nota: 8, pts: 2, prev: 76, cum: 50, falt: 25 })
        ]
    });

    // No mode 0, assume que passa em APRM agora => no próximo semestre (2026/2) só falta TCC2
    const simMode0 = simulate(0, 0);
    assert.deepEqual(simMode0.terms[0].taken, ["TCC2"]);

    // No mode 1, como APRM tem risco >= 50%, considera que reprova em APRM => precisa refazer APRM junto com TCC2
    const simMode1 = simulate(0, 1);
    assert.ok(simMode1.terms[0].taken.includes("APRM"), "No mode 1, matéria em curso com risco >= 50% deve voltar ao plano");
    assert.ok(simMode1.terms[0].taken.includes("TCC2"));
});

test("Planejador guloso: curso 100% concluído retorna 0 semestres restantes", () => {
    const allRequired = [...OBR, "TPRO", "INFR", "TCC1", "TCC2"];
    resetState({ passed: allRequired, acDone: true });
    const sim = simulate(0, 0);
    assert.equal(sim.n, 0);
    assert.equal(sim.terms.length, 0);
});

// ============================================================================
// 4. SIMULAÇÃO MONTE CARLO (monte, seed)
// ============================================================================
test("Monte Carlo (monte): determinismo do PRNG (seed) e monotonicidade com a taxa de falha", () => {
    resetState({
        startYear: 2026,
        startHalf: 1,
        maxLoad: 8,
        respectParity: true,
        passed: ["ALP1", "COEX", "EDG1", "FADM", "FMAT", "ICCO", "MDIS"]
    });

    // Determinismo: duas execuções seguidas com a mesma taxa devem retornar valores idênticos
    const mc1 = monte(0.2);
    const mc2 = monte(0.2);
    assert.deepEqual(mc1, mc2, "Monte Carlo deve ser 100% determinístico para o mesmo estado");

    // Com taxa de falha 0% e sem matérias em curso com risco, med e p90 coincidem com o plano mínimo
    const minPlan = simulate(0, 0).n;
    const mcZero = monte(0);
    assert.equal(mcZero.med, minPlan);
    assert.equal(mcZero.p90, minPlan);

    // Monotonicidade: 0% <= 20% <= 45% de falha, e sempre p90 >= med >= minPlan
    const mcHigh = monte(0.45);
    assert.ok(mc1.med >= minPlan, `Mediana (${mc1.med}) deve ser >= mínimo (${minPlan})`);
    assert.ok(mc1.p90 >= mc1.med, `P90 (${mc1.p90}) deve ser >= mediana (${mc1.med})`);
    assert.ok(mcHigh.med >= mc1.med, `Mediana com 45% de falha (${mcHigh.med}) deve ser >= mediana com 20% (${mc1.med})`);
    assert.ok(mcHigh.p90 >= mc1.p90, `P90 com 45% de falha (${mcHigh.p90}) deve ser >= P90 com 20% (${mc1.p90})`);
});

// ============================================================================
// 5. PLANEJADOR DE ESTUDO / TAREFAS E ATIVIDADES COMPLEMENTARES
// ============================================================================
test("Planejador de tarefas (importance, urgency, prioOf, planTasks) e Atividades Complementares (acCalc)", () => {
    resetState({
        cap: 3,
        weekend: false,
        current: [fixCur({ id: "ALP1", nota: 4, pts: 6, prev: 76, cum: 38, falt: 2 })],
        tasks: [
            { id: "t_urg", subj: "ALP1", type: "Prova", status: "pendente", title: "Prova Urgente", due: "2099-12-10", pts: 5, got: null, eff: 6, done: false },
            { id: "t_leve", subj: "ALP1", type: "Trabalho", status: "pendente", title: "Lista Leve", due: "2099-12-20", pts: 1, got: null, eff: 2, done: false }
        ]
    });

    const [tUrg, tLeve] = getState().tasks;
    const refDate = new Date(2099, 11, 8); // 2 dias antes de t_urg
    assert.ok(importance(tUrg) > importance(tLeve), "Tarefa valendo 5 pts deve ter maior importância que tarefa de 1 pt");
    assert.ok(urgency(tUrg, refDate, tUrg.eff) > urgency(tLeve, refDate, tLeve.eff), "Tarefa com prazo mais próximo e maior esforço deve ser mais urgente");
    assert.ok(prioOf(tUrg, refDate, tUrg.eff) > prioOf(tLeve, refDate, tLeve.eff));
    assert.deepEqual(prioLbl(75), ["Crítica", "r"]);
    assert.deepEqual(prioLbl(55), ["Alta", "y"]);
    assert.deepEqual(prioLbl(35), ["Média", "b"]);
    assert.deepEqual(prioLbl(15), ["Baixa", "g"]);

    // Verifica que planTasks aloca todas as horas das tarefas pendentes respeitando cap=3h/dia e sem finais de semana (weekend=false)
    const plan = planTasks();
    assert.ok(plan.t_urg && plan.t_leve);
    for (const p of [plan.t_urg, plan.t_leve]) {
        let sumH = 0;
        for (const [ymdStr, h] of Object.entries(p.plan)) {
            assert.ok(h <= 3, `Horas no dia ${ymdStr} (${h}) não podem exceder cap=3`);
            const [y, m, d] = ymdStr.split("-").map(Number);
            const dow = new Date(y, m - 1, d).getDay();
            assert.ok(dow !== 0 && dow !== 6, `Com weekend=false, não deve alocar estudo em fim de semana (${ymdStr})`);
            sumH += h;
        }
        assert.equal(sumH, p.t.eff, `Todas as ${p.t.eff}h da tarefa ${p.t.id} devem ser alocadas`);
    }

    // Verifica cálculo de Atividades Complementares (Anexo III): Grupo A compartilha teto de 40h
    resetState({
        ac: {
            0: 1, // Artigo internacional: 40h (Grupo A)
            1: 1, // Artigo nacional: 30h (Grupo A) -> somaria 70h no Grupo A, mas teto do grupo é 40h!
            5: 2  // Iniciação científica: 2 * 25h = 50h (fora do Grupo A, teto próprio de 50h)
        }
    });
    const acRes = acCalc();
    assert.equal(acRes.g.A.ob, 70);
    assert.equal(acRes.g.A.ct, 40, "Grupo A deve limitar as horas contabilizadas em 40h");
    assert.equal(acRes.tot, 90, "Total contabilizado deve ser 40h (Grupo A) + 50h (IC) = 90h");
});

// ============================================================================
// 6. ARQUITETURA ORIENTADA A DADOS (1 JSON POR CURSO: BCC NOVA, ANTIGA, PEDAGOGIA)
// ============================================================================
test("Catálogo de cursos orientado a dados (CURS, validateCourseConfig e sanitizeState multi-curso)", () => {
    assert.ok(CURS.nova && CURS.antiga && CURS.pedagogia, "Catálogo deve carregar os JSONs de nova, antiga e pedagogia");
    assert.equal(CURS.nova.unit, "aulas");
    assert.equal(CURS.pedagogia.unit, "horas");
    assert.equal(CURS.pedagogia.totalH, 3200.3);
    assert.equal(CURS.pedagogia.estMinPct, 0.35);

    // Sanitização de estado para o curso de Pedagogia (usando disciplinas do JSON de Pedagogia)
    const pedState = sanitizeState({
        curriculo: "pedagogia",
        passed: ["HED1", "LIB1", "DISCIPLINA_INEXISTENTE"],
        electivePlan: ["REIE", "INVALIDA"],
        current: [{ id: "LIB2", nota: 7.5 }]
    }, "pedagogia");
    assert.equal(pedState.curriculo, "pedagogia");
    assert.deepEqual(pedState.passed, ["HED1", "LIB1"]);
    assert.deepEqual(pedState.electivePlan, ["REIE"]);
    assert.equal(pedState.current.length, 1);
    assert.equal(pedState.current[0].id, "LIB2");
    assert.equal(pedState.current[0].prev, 38); // LIB2 = 33.3h -> 2 aulas/sem * 19 sem = 38 aulas

    // Validação de schema para adição de novos cursos via JSON
    const novoCurso = validateCourseConfig({
        id: "ads-2026",
        title: "Tecnologia em Análise e Desenvolvimento de Sistemas",
        totalH: 2000,
        unit: "horas",
        raw: [
            ["ALG1", "Algoritmos", 1, 66.7, 0, []],
            ["WEB1", "Desenvolvimento Web", 2, 66.7, 0, ["ALG1"]]
        ]
    });
    assert.equal(novoCurso.id, "ads-2026");
    assert.equal(novoCurso.raw.length, 2);
    assert.throws(() => validateCourseConfig({ id: "invalido sem raw", raw: [] }));
});

test("Validação de esquema de estado JSON (validateStateSchema)", () => {
    // 1. JSON válido padrão
    const validState = {
        version: 1,
        curriculo: "nova",
        passed: ["ALP1", "CAL1"],
        current: [{ id: "ED1", nota: 7 }],
        tasks: [{ id: "t1", subj: "ED1", title: "Lista 1" }]
    };
    const resValid = validateStateSchema(validState);
    assert.equal(resValid.valid, true);
    assert.equal(resValid.errors.length, 0);
    assert.equal(resValid.targetCur, "nova");

    // 2. Não-objeto ou array
    assert.equal(validateStateSchema(null).valid, false);
    assert.equal(validateStateSchema("string").valid, false);
    assert.equal(validateStateSchema([1, 2, 3]).valid, false);

    // 3. Currículo desconhecido
    const resBadCur = validateStateSchema({ curriculo: "eng-aeroespacial", passed: [] });
    assert.equal(resBadCur.valid, false);
    assert.ok(resBadCur.errors.some(e => e.includes("Currículo 'eng-aeroespacial' desconhecido")));

    // 4. Versão inválida
    const resBadVer = validateStateSchema({ curriculo: "nova", version: -5 });
    assert.equal(resBadVer.valid, false);
    assert.ok(resBadVer.errors.some(e => e.includes("Campo 'version' inválido")));

    // 5. JSON aleatório sem relação com a aplicação
    const resRandom = validateStateSchema({ foo: "bar", baz: 123 });
    assert.equal(resRandom.valid, false);
    assert.ok(resRandom.errors.some(e => e.includes("campos essenciais não encontrados")));

    // 6. Coleções com tipos incorretos
    const resBadTypes = validateStateSchema({
        curriculo: "nova",
        passed: "ALP1",
        current: "ED1",
        tasks: { id: "t1" },
        electivePlan: 42
    });
    assert.equal(resBadTypes.valid, false);
    assert.equal(resBadTypes.errors.length, 4);

    // 7. Elementos internos malformados
    const resBadItems = validateStateSchema({
        curriculo: "nova",
        current: ["ALP1", { nota: 8 }],
        tasks: [{ title: "Sem matéria" }]
    });
    assert.equal(resBadItems.valid, false);
    assert.ok(resBadItems.errors.some(e => e.includes("current[0]")));
    assert.ok(resBadItems.errors.some(e => e.includes("current[1]")));
    assert.ok(resBadItems.errors.some(e => e.includes("tasks[0]")));
});

test("Alternância reativa de curso em tempo de execução sem reload (switchCourse)", () => {
    // Alterna para Pedagogia dinamicamente
    const pedState = switchCourse("pedagogia");
    assert.equal(pedState.curriculo, "pedagogia");
    assert.equal(script.KEY, "pedagogia");
    assert.equal(script.CUR.id, "pedagogia");
    assert.equal(C.HED1.name, "História da Educação 1");
    assert.equal(ORDER.includes("HED1"), true);
    assert.equal(ORDER.includes("ALP1"), false);
    assert.equal(script.HAS_TCC, false); // Pedagogia não tem TCC no grafo

    // Alterna de volta para Ciência da Computação (nova)
    const novaState = switchCourse("nova");
    assert.equal(novaState.curriculo, "nova");
    assert.equal(script.KEY, "nova");
    assert.equal(script.CUR.id, "nova");
    assert.equal(C.ALP1.name, "Algoritmos e Programação 1");
    assert.equal(ORDER.includes("ALP1"), true);
    assert.equal(ORDER.includes("HED1"), false);
    assert.equal(script.HAS_TCC, true);

    // Lança erro caso receba curso inexistente
    assert.throws(() => switchCourse("curso-inexistente"), /Curso desconhecido/);
});

test("Paridade entre matrizes de extração (scripts/raw_*.js) e JSON puro (assets/data/courses/*.json)", async () => {
    const { RAW_NOVA } = await import("../scripts/raw_new.js");
    const { RAW_ANTIGA } = await import("../scripts/raw_old.js");

    // BCC 2022
    assert.equal(RAW_NOVA.length, CURS.nova.raw.length);
    RAW_NOVA.forEach((expected, idx) => {
        const actual = CURS.nova.raw[idx];
        assert.deepEqual(actual, expected, `Disciplina ${expected[0]} deve ser idêntica no JSON puro`);
    });

    // BCC 2018
    assert.equal(RAW_ANTIGA.length, CURS.antiga.raw.length);
    RAW_ANTIGA.forEach((expected, idx) => {
        const actual = CURS.antiga.raw[idx];
        assert.deepEqual(actual, expected, `Disciplina ${expected[0]} deve ser idêntica no JSON puro`);
    });
});

// ============================================================================
// 10. MATRIZ OFICIAL DE EQUIVALÊNCIA E MIGRAÇÃO DE DISCIPLINAS
// ============================================================================
test("Integridade e consistência da matriz oficial de equivalência (bcc-equivalence.json)", () => {
    // 1. Metadados oficiais
    assert.equal(EQUIVALENCE_DATA.metadata.suapCode, "1787471");
    assert.equal(EQUIVALENCE_DATA.metadata.authCode, "406de5f92c");
    assert.ok(EQUIVALENCE_DATA.metadata.coordinator.includes("André Luis Olivete"));

    // 2. Contagens de disciplinas
    const { antigaParaNova, novaParaAntiga } = EQUIVALENCE_DATA;
    assert.equal(antigaParaNova.length, 67, "PPC 2018 deve conter 67 disciplinas mapeadas");
    assert.equal(novaParaAntiga.length, 65, "PPC 2022/2023 deve conter 65 disciplinas mapeadas");

    // 3. Disciplinas equivalentes vs sem correspondência
    const equivAntiga = antigaParaNova.filter(x => x.equivalente);
    const noEquivAntiga = antigaParaNova.filter(x => !x.equivalente);
    assert.equal(equivAntiga.length, 57, "57 disciplinas do PPC 2018 devem ter equivalência no PPC 2023");
    assert.equal(noEquivAntiga.length, 10, "10 disciplinas do PPC 2018 não têm correspondência");

    const expectedNoEquivAntiga = [
        "EL1C1", "LACC1", "LOGC1", "FDSC2", "FNCC4", "TBDC5", "CEMC6", "TESC0", "TEPC0", "TPWC0"
    ];
    assert.deepEqual(noEquivAntiga.map(x => x.origem.id), expectedNoEquivAntiga);

    const equivNova = novaParaAntiga.filter(x => x.equivalente);
    const noEquivNova = novaParaAntiga.filter(x => !x.equivalente);
    assert.equal(equivNova.length, 57, "57 disciplinas do PPC 2023 devem ter equivalência no PPC 2018");
    assert.equal(noEquivNova.length, 8, "8 disciplinas do PPC 2023 não têm correspondência");

    const expectedNoEquivNova = [
        "EDG1", "EXT1", "EXT2", "ACAL", "EXT3", "EXT4", "TCOM", "SMIC"
    ];
    assert.deepEqual(noEquivNova.map(x => x.origem.id), expectedNoEquivNova);

    // 4. Paridade com os catálogos dos cursos (todos os IDs devem existir em raw)
    const antigaIds = new Set(CURS.antiga.raw.map(r => r[0]));
    const novaIds = new Set(CURS.nova.raw.map(r => r[0]));

    antigaParaNova.forEach(item => {
        assert.ok(antigaIds.has(item.origem.id), `ID origem ${item.origem.id} deve existir em CURS.antiga`);
        if (item.equivalente) {
            assert.ok(item.destino, `Item com equivalência deve conter objeto destino: ${item.origem.id}`);
            assert.ok(novaIds.has(item.destino.id), `ID destino ${item.destino.id} deve existir em CURS.nova`);
        }
    });

    novaParaAntiga.forEach(item => {
        assert.ok(novaIds.has(item.origem.id), `ID origem ${item.origem.id} deve existir em CURS.nova`);
        if (item.equivalente) {
            assert.ok(item.destino, `Item com equivalência deve conter objeto destino: ${item.origem.id}`);
            assert.ok(antigaIds.has(item.destino.id), `ID destino ${item.destino.id} deve existir em CURS.antiga`);
        }
    });
});

test("Simulação e migração de disciplinas aprovadas entre PPCs (migratePassedDisciplines)", () => {
    // 1. Migração Antiga -> Nova
    const antigaPassed = ["AP1C1", "CL1C2", "EL1C1", "TCC1", "TCC2"];
    const novaMigrated = migratePassedDisciplines(antigaPassed, "antiga", "nova");

    // AP1C1 -> ALP1, CL1C2 -> CLC1, TCC1 -> TCC1, TCC2 -> TCC2, EL1C1 (sem correspondência) é descartada
    assert.ok(novaMigrated.includes("ALP1"), "AP1C1 deve migrar para ALP1");
    assert.ok(novaMigrated.includes("CLC1"), "CL1C2 deve migrar para CLC1");
    assert.ok(novaMigrated.includes("TCC1"), "TCC1 deve migrar para TCC1");
    assert.ok(novaMigrated.includes("TCC2"), "TCC2 deve migrar para TCC2");
    assert.equal(novaMigrated.includes("EL1C1"), false, "EL1C1 não deve migrar pois não tem correspondência");
    assert.equal(novaMigrated.length, 4);

    // 2. Migração Nova -> Antiga
    const novaPassed = ["ALP1", "CLC1", "EDG1", "TCC1", "TCC2"];
    const antigaMigrated = migratePassedDisciplines(novaPassed, "nova", "antiga");

    assert.ok(antigaMigrated.includes("AP1C1"), "ALP1 deve migrar para AP1C1");
    assert.ok(antigaMigrated.includes("CL1C2"), "CLC1 deve migrar para CL1C2");
    assert.ok(antigaMigrated.includes("TCC1"), "TCC1 deve migrar para TCC1");
    assert.ok(antigaMigrated.includes("TCC2"), "TCC2 deve migrar para TCC2");
    assert.equal(antigaMigrated.includes("EDG1"), false, "EDG1 não deve migrar pois não tem correspondência");
    assert.equal(antigaMigrated.length, 4);

    // 3. Idempotência quando mesma grade
    assert.deepEqual(migratePassedDisciplines(["ALP1", "ED1"], "nova", "nova"), ["ALP1", "ED1"]);

    // 4. Resiliência com valores nulos/vazios
    assert.deepEqual(migratePassedDisciplines([], "antiga", "nova"), []);
    assert.deepEqual(migratePassedDisciplines(null, "antiga", "nova"), []);
});

test("Filtros de busca, semestre e status na matriz de equivalência (filterEquivalence)", () => {
    const list = EQUIVALENCE_DATA.antigaParaNova;

    // 1. Busca textual por sigla
    const resSigla = filterEquivalence(list, { search: "CL1C2" });
    assert.equal(resSigla.length, 1);
    assert.equal(resSigla[0].origem.id, "CL1C2");

    // 2. Busca textual por nome
    const resNome = filterEquivalence(list, { search: "estruturas de dados" });
    assert.ok(resNome.some(x => x.origem.id === "ED1C3"));

    // 3. Filtro por semestre
    const sem1 = filterEquivalence(list, { sem: 1 });
    assert.ok(sem1.length >= 6);
    assert.ok(sem1.every(x => x.origem.sem === 1));

    // 4. Filtro por status
    const onlyEquiv = filterEquivalence(list, { status: "equiv" });
    assert.equal(onlyEquiv.length, 57);

    const onlyNoEquiv = filterEquivalence(list, { status: "no_equiv" });
    assert.equal(onlyNoEquiv.length, 10);

    // 5. Filtro por disciplinas concluídas
    const passed = new Set(["CL1C2", "AP1C1", "EL1C1"]);
    const onlyPassed = filterEquivalence(list, { status: "passed", passed });
    assert.equal(onlyPassed.length, 3);
});

test("Estatísticas e KPIs de aproveitamento (calcEquivalenceStats)", () => {
    const list = EQUIVALENCE_DATA.antigaParaNova;

    // Sem disciplinas feitas
    const s0 = calcEquivalenceStats(list, new Set());
    assert.equal(s0.total, 67);
    assert.equal(s0.equivalentes, 57);
    assert.equal(s0.semCorrespondencia, 10);
    assert.equal(s0.aproveitadasCount, 0);
    assert.equal(s0.aproveitadasHoras, 0);
    assert.equal(s0.perdidasCount, 0);
    assert.equal(s0.perdidasHoras, 0);

    // Com 1 equivalente (AP1C1 = 63.3h) e 1 sem correspondência (EL1C1 = 63.3h)
    const passed = new Set(["AP1C1", "EL1C1"]);
    const s1 = calcEquivalenceStats(list, passed);
    assert.equal(s1.aproveitadasCount, 1);
    assert.equal(s1.aproveitadasHoras, 63.3);
    assert.equal(s1.perdidasCount, 1);
    assert.equal(s1.perdidasHoras, 63.3);
});

// ============================================================================
// TESTES DO MÓDULO DE TOMADA DE DECISÃO E INSCRIÇÃO (enrollment.js)
// ============================================================================

test("Identificação e filtragem de ofertas por paridade semestral (populateDefaultOfferings)", () => {
    resetState({ passed: ["ALP1", "EDG1"] });

    // 1. Semestre Ímpar: deve conter matérias ímpares pendentes e inibir as aprovadas
    populateDefaultOfferings("odd");
    assert.ok(ENROLL_STATE.offered.has("BDD1"), "BDD1 (3º sem, ímpar) deve estar ofertada");
    assert.ok(ENROLL_STATE.offered.has("FMAT"), "FMAT (1º sem, ímpar) pendente deve estar ofertada");
    assert.equal(ENROLL_STATE.offered.has("ALP1"), false, "ALP1 já concluída DEVE ser inibida");
    assert.equal(ENROLL_STATE.offered.has("EDG1"), false, "EDG1 já concluída DEVE ser inibida");
    assert.equal(ENROLL_STATE.offered.has("ALP2"), false, "ALP2 (2º sem, par) não deve estar na oferta ímpar");

    // 2. Semestre Par: deve conter matérias pares pendentes
    populateDefaultOfferings("even");
    assert.ok(ENROLL_STATE.offered.has("ALP2"), "ALP2 (2º sem, par) deve estar ofertada no par");
    assert.equal(ENROLL_STATE.offered.has("BDD1"), false, "BDD1 (3º sem, ímpar) não deve estar no par");

    // 3. Todos os Semestres: contém ambas, mas inibe as aprovadas
    populateDefaultOfferings("all");
    assert.ok(ENROLL_STATE.offered.has("ALP2"));
    assert.ok(ENROLL_STATE.offered.has("BDD1"));
    assert.equal(ENROLL_STATE.offered.has("ALP1"), false, "Matéria aprovada segue inibida em 'all'");
});

test("Avaliação de scores de decisão, impacto na formatura e pré-requisitos (calcCourseDecisionScore)", () => {
    // Cenário: aluno novo (sem aprovações)
    const passedEmpty = new Set();

    // 1. Matéria com pré-requisito pendente deve ser bloqueada
    const scoreAlp2 = calcCourseDecisionScore("ALP2", passedEmpty);
    assert.equal(scoreAlp2.isEligible, false, "ALP2 deve estar bloqueada sem ALP1");
    assert.deepEqual(scoreAlp2.missingPre, ["ALP1"]);
    assert.equal(scoreAlp2.score, 0);

    // 2. Matéria já concluída deve ter pontuação zerada e status aprovado
    const scorePassed = calcCourseDecisionScore("ALP1", new Set(["ALP1"]));
    assert.equal(scorePassed.isPassed, true);
    assert.equal(scorePassed.isEligible, false);
    assert.equal(scorePassed.score, 0);

    // 3. Matéria elegível crítica (ALP1) vs folha sem dependentes (COEX)
    const scoreAlp1 = calcCourseDecisionScore("ALP1", passedEmpty);
    const scoreCoex = calcCourseDecisionScore("COEX", passedEmpty);

    assert.equal(scoreAlp1.isEligible, true);
    assert.equal(scoreCoex.isEligible, true);
    assert.ok(scoreAlp1.score > scoreCoex.score, "ALP1 deve ter score superior a COEX");
    assert.ok(scoreAlp1.depthVal > scoreCoex.depthVal, "ALP1 possui profundidade maior no caminho crítico");
    assert.ok(scoreAlp1.directUnlocks.includes("ALP2"), "ALP1 destrava ALP2 diretamente");
});

test("Detecção e resolução inteligente de choques de horário (analyzeConflicts)", () => {
    const passed = new Set();
    const candAlp1 = calcCourseDecisionScore("ALP1", passed);
    const candCoex = calcCourseDecisionScore("COEX", passed);

    // Força choque no slot '0-0' (Segunda 07:10)
    const mockSlots = {
        ALP1: ["0-0", "0-2"],
        COEX: ["0-0"]
    };

    const { conflicts } = analyzeConflicts([candAlp1, candCoex], mockSlots);
    assert.equal(conflicts.length, 1, "Deve identificar exatamente 1 choque de horário");

    const conf = conflicts[0];
    assert.equal(conf.slotKey, "0-0");
    assert.equal(conf.winner.id, "ALP1", "ALP1 deve vencer o conflito contra COEX");
    assert.equal(conf.loser.id, "COEX", "COEX deve ser a preterida no conflito");
    assert.ok(conf.reason.length > 0, "Deve fornecer justificativa explicativa");
});

test("Construção de grade semanal ótima sem choques e dentro do limite maxLoad (buildOptimalSchedule)", () => {
    resetState({ passed: [] });

    // Pool de matérias ofertadas do 1º semestre
    const candidates = ["ALP1", "COEX", "EDG1", "FADM", "FMAT", "ICCO", "MDIS"];

    // 1. Grade regular sem conflitos manuais forçados
    const plan = buildOptimalSchedule(candidates, {}, 9);
    assert.ok(plan.recommended.length >= 6, "Deve recomendar as matérias elegíveis do semestre");

    // Verifica que na grade gerada NÃO há choques
    const usedSlots = new Set();
    plan.recommended.forEach(item => {
        const sls = getDefaultCourseSlots(item.id);
        sls.forEach(s => {
            assert.equal(usedSlots.has(s), false, `Slot ${s} não pode ter sobreposição na grade ótima`);
            usedSlots.add(s);
        });
    });

    // 2. Respeita rigorosamente o limite de carga (maxLoad = 3)
    const restrictedPlan = buildOptimalSchedule(candidates, {}, 3);
    assert.equal(restrictedPlan.recommended.length, 3, "Não deve ultrapassar maxLoad = 3");
    assert.equal(restrictedPlan.deferred.length, candidates.length - 3);
    assert.ok(restrictedPlan.deferred.some(d => d.deferReason.includes("Limite máximo")));
});

test("Estrutura das 4 semanas de oferta, inibição de cursadas e maximização de matérias", () => {
    // 1. Semestre configurado como Ímpar (startHalf = 1) -> 1º, 3º, 5º e 7º semestres
    resetState({ startHalf: 1, passed: ["ALP1", "COEX", "EDG1"] });
    const semsOdd = getOfferedSemesters(1);
    assert.deepEqual(semsOdd, [1, 3, 5, 7]);

    // Semestre configurado como Par (startHalf = 2) -> 2º, 4º, 6º e 8º semestres
    const semsEven = getOfferedSemesters(2);
    assert.deepEqual(semsEven, [2, 4, 6, 8]);

    // 2. Preenchimento e cadastro nas 4 semanas de oferta (sem inibição prévia durante a montagem das turmas)
    populateDefaultSemesterOffers(semsOdd);
    const state = getState();
    assert.ok(state.enrollOffers[1] && Object.keys(state.enrollOffers[1]).length > 0, "1º semestre deve ter aulas cadastradas");
    assert.ok(state.enrollOffers[3] && Object.keys(state.enrollOffers[3]).length > 0, "3º semestre deve ter aulas cadastradas");
    assert.ok(state.enrollOffers[5] && Object.keys(state.enrollOffers[5]).length > 0, "5º semestre deve ter aulas cadastradas");
    assert.ok(state.enrollOffers[7] && Object.keys(state.enrollOffers[7]).length > 0, "7º semestre deve ter aulas cadastradas");

    // 3. Simula colisão manual entre matéria de 1º semestre e matéria de 3º semestre
    // FMAT (1º sem, pendente) colocada no slot 0-0
    // BDD1 (3º sem, pendente e pré-requisito ALP1 já cumprido) colocada também no slot 0-0
    state.enrollOffers[1]["0-0"] = "FMAT";
    state.enrollOffers[3]["0-0"] = "BDD1";

    const decision = buildOptimalSchedule(null, {}, 9);

    // 4. Validação da análise:
    // a) Disciplinas já aprovadas (ALP1, COEX, EDG1) devem ser desconsideradas da recomendação
    const recIds = decision.recommended.map(r => r.id);
    assert.equal(recIds.includes("ALP1"), false, "ALP1 já concluída NÃO deve ser recomendada");
    assert.equal(recIds.includes("COEX"), false, "COEX já concluída NÃO deve ser recomendada");
    assert.equal(recIds.includes("EDG1"), false, "EDG1 já concluída NÃO deve ser recomendada");

    // b) Conflito entre FMAT e BDD1 no slot 0-0 deve ser detectado e apenas UMA deve ser recomendada
    assert.ok(decision.conflicts.some(c => c.slotKey === "0-0"), "Deve detectar choque de horário em 0-0");
    const hasFmat = recIds.includes("FMAT");
    const hasBdd1 = recIds.includes("BDD1");
    assert.ok((hasFmat || hasBdd1) && !(hasFmat && hasBdd1), "Apenas uma das conflitantes em 0-0 pode ser escolhida");

    // c) Maximização: algoritmo deve escolher a maior quantidade possível de matérias elegíveis sem choques
    assert.ok(decision.recommended.length >= 4, "Deve recomendar o máximo de matérias possíveis sem choques");
});



