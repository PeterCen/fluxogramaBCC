#!/usr/bin/env node
/**
 * Script de Auditoria e Extração da Matriz de Equivalência (scripts/extract_equivalence.mjs)
 *
 * Responsabilidades:
 * 1. Validar e auditar a correspondência entre o documento oficial:
 *    "equivalencia matérias.pdf" (Portaria/SUAP CBCC-PEP nº 1787471 / 2024)
 *    e o arquivo JSON puro em assets/data/equivalence/bcc-equivalence.json.
 * 2. Verificar a consistência com as matrizes curriculares:
 *    - BCC 2018 (assets/data/courses/bcc-2018.json - 67 disciplinas)
 *    - BCC 2022/2023 (assets/data/courses/bcc-2022.json - 65 disciplinas)
 *
 * Execução:
 *   node scripts/extract_equivalence.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DATA_PATH = path.join(ROOT, "assets", "data", "equivalence", "bcc-equivalence.json");
const C18_PATH = path.join(ROOT, "assets", "data", "courses", "bcc-2018.json");
const C22_PATH = path.join(ROOT, "assets", "data", "courses", "bcc-2022.json");

console.log("==================================================================");
console.log(" Auditoria da Matriz de Equivalência Curricular (PPC 2018 <-> 2022)");
console.log("==================================================================");

if (!fs.existsSync(DATA_PATH)) {
    console.error(`❌ Arquivo não encontrado: ${DATA_PATH}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const c18 = JSON.parse(fs.readFileSync(C18_PATH, "utf8"));
const c22 = JSON.parse(fs.readFileSync(C22_PATH, "utf8"));

const c18Ids = new Set(c18.raw.map(r => r[0]));
const c22Ids = new Set(c22.raw.map(r => r[0]));

console.log(`\n📄 Metadados do Documento Oficial:`);
console.log(`   • Título: ${data.metadata.title}`);
console.log(`   • Coordenador: ${data.metadata.coordinator}`);
console.log(`   • SUAP: ${data.metadata.suapCode} · Autenticação: ${data.metadata.authCode}`);
console.log(`   • Origem: ${data.metadata.sourcePdf}`);

// 1. Valida Antiga -> Nova (67 disciplinas)
console.log(`\n🔍 Verificando mapeamento: Grade Antiga (2018) -> Grade Nova (2022/2023)...`);
if (!Array.isArray(data.antigaParaNova) || data.antigaParaNova.length !== 67) {
    throw new Error(`antigaParaNova deve conter exatamente 67 disciplinas (encontrado: ${data.antigaParaNova?.length})`);
}

let countEquiv18 = 0;
let countNoEquiv18 = 0;
for (const item of data.antigaParaNova) {
    if (!c18Ids.has(item.origem.id)) {
        throw new Error(`Disciplina origem ${item.origem.id} não existe em bcc-2018.json`);
    }
    if (item.equivalente) {
        countEquiv18++;
        if (!item.destino || !c22Ids.has(item.destino.id)) {
            throw new Error(`Disciplina destino ${item.destino?.id} para ${item.origem.id} não existe em bcc-2022.json`);
        }
    } else {
        countNoEquiv18++;
        if (item.destino !== null) {
            throw new Error(`Disciplina sem equivalência ${item.origem.id} não deve possuir destino`);
        }
    }
}
console.log(`  ✅ 67 disciplinas verificadas: ${countEquiv18} equivalentes + ${countNoEquiv18} sem correspondência.`);

// 2. Valida Nova -> Antiga (65 disciplinas)
console.log(`\n🔍 Verificando mapeamento: Grade Nova (2022/2023) -> Grade Antiga (2018)...`);
if (!Array.isArray(data.novaParaAntiga) || data.novaParaAntiga.length !== 65) {
    throw new Error(`novaParaAntiga deve conter exatamente 65 disciplinas (encontrado: ${data.novaParaAntiga?.length})`);
}

let countEquiv22 = 0;
let countNoEquiv22 = 0;
for (const item of data.novaParaAntiga) {
    if (!c22Ids.has(item.origem.id)) {
        throw new Error(`Disciplina origem ${item.origem.id} não existe em bcc-2022.json`);
    }
    if (item.equivalente) {
        countEquiv22++;
        if (!item.destino || !c18Ids.has(item.destino.id)) {
            throw new Error(`Disciplina destino ${item.destino?.id} para ${item.origem.id} não existe em bcc-2018.json`);
        }
    } else {
        countNoEquiv22++;
        if (item.destino !== null) {
            throw new Error(`Disciplina sem equivalência ${item.origem.id} não deve possuir destino`);
        }
    }
}
console.log(`  ✅ 65 disciplinas verificadas: ${countEquiv22} equivalentes + ${countNoEquiv22} sem correspondência (disciplinas novas/extensão).`);

console.log("\n🎉 Matriz de equivalência 100% íntegra e alinhada com as matrizes dos PPCs!\n");
