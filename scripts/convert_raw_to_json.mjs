#!/usr/bin/env node
/**
 * Script de Validação e Conversão de Dados Curriculares (scripts/convert_raw_to_json.mjs)
 *
 * Responsabilidades:
 * 1. Estabelecer a ponte entre as matrizes de extração históricas (raw_new.js, raw_old.js)
 *    e os arquivos JSON puros utilizados em produção (assets/data/courses/*.json).
 * 2. Validar a integridade, contagem e paridade dos dados entre os scripts e os JSONs puros.
 * 3. Garantir conformidade com validateCourseConfig() do motor da aplicação.
 *
 * Execução:
 *   node scripts/convert_raw_to_json.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RAW_NOVA } from "./raw_new.js";
import { RAW_ANTIGA } from "./raw_old.js";
import { validateCourseConfig } from "../assets/js/courses.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const COURSES_DIR = path.join(ROOT, "assets", "data", "courses");

function checkEquivalence(name, rawArray, jsonPath) {
    console.log(`\n🔍 Verificando paridade para ${name}...`);
    if (!fs.existsSync(jsonPath)) {
        throw new Error(`Arquivo JSON não encontrado: ${jsonPath}`);
    }

    const content = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const validated = validateCourseConfig(content);

    if (rawArray.length !== validated.raw.length) {
        throw new Error(
            `${name}: quantidade de disciplinas diverge (raw: ${rawArray.length}, json: ${validated.raw.length})`
        );
    }

    rawArray.forEach((expected, idx) => {
        const actual = validated.raw[idx];
        const [eId, eName, eSem, eVal, eExt, ePre] = expected;
        const [aId, aName, aSem, aVal, aExt, aPre] = actual;

        if (eId !== aId || eName !== aName || eSem !== aSem || eVal !== aVal || eExt !== aExt) {
            throw new Error(
                `${name} [${idx}]: divergência nos campos básicos da disciplina ${eId} vs ${aId}`
            );
        }
        if (JSON.stringify(ePre) !== JSON.stringify(aPre)) {
            throw new Error(
                `${name} [${eId}]: pré-requisitos divergem (esperado: ${JSON.stringify(ePre)}, obtido: ${JSON.stringify(aPre)})`
            );
        }
    });

    console.log(`  ✅ ${name}: ${validated.raw.length} disciplinas validadas com 100% de paridade entre raw e JSON puro!`);
    return validated;
}

console.log("==================================================================");
console.log(" Conversão e Auditoria de Dados Curriculares (scripts -> JSON puro)");
console.log("==================================================================");

// 1. BCC 2022 (Nova)
checkEquivalence("BCC - PPC 2022", RAW_NOVA, path.join(COURSES_DIR, "bcc-2022.json"));

// 2. BCC 2018 (Antiga)
checkEquivalence("BCC - PPC 2018", RAW_ANTIGA, path.join(COURSES_DIR, "bcc-2018.json"));

// 3. Pedagogia 2023
const pedPath = path.join(COURSES_DIR, "pedagogia-2023.json");
const pedJson = JSON.parse(fs.readFileSync(pedPath, "utf8"));
const pedVal = validateCourseConfig(pedJson);
console.log(`\n🔍 Verificando integridade de Pedagogia PPC 2023...`);
console.log(`  ✅ Licenciatura em Pedagogia: ${pedVal.raw.length} disciplinas validadas com sucesso no schema de JSON puro!`);

// 4. Catálogo manifesto
const manifestPath = path.join(COURSES_DIR, "index.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest.courses) || manifest.courses.length < 3) {
    throw new Error("Catálogo manifesto index.json deve conter pelo menos 3 cursos registrados.");
}
console.log(`\n📚 Catálogo manifesto (index.json): ${manifest.courses.length} cursos registrados.`);
console.log("🎉 Todos os dados curriculares estão desacoplados em JSON puro e perfeitamente íntegros!\n");
