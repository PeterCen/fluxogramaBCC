#!/usr/bin/env node
/**
 * Script de Automação de Cache Busting (scripts/cache_bust.mjs)
 *
 * Responsabilidades:
 * 1. Calcular o hash SHA-256 do conteúdo de assets/css/styles.css.
 * 2. Atualizar automaticamente a query string ?v=<hash> em index.html e pedagogia/index.html.
 * 3. Garantir a remoção de código morto (tags <script> comentadas) em index.html.
 * 4. Fornecer modo de verificação (--check) para integração em CI e hooks de git.
 *
 * Uso:
 *   node scripts/cache_bust.mjs         # Aplica/atualiza a versão calculada
 *   node scripts/cache_bust.mjs --check # Verifica se a versão atual confere com o hash do arquivo
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const CSS_PATH = path.join(ROOT, "assets", "css", "styles.css");
const HTML_FILES = [
    path.join(ROOT, "index.html"),
    path.join(ROOT, "pedagogia", "index.html")
];

export function computeFileHash(filePath, len = 10) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, len);
}

export function updateCacheBusting({ checkOnly = false } = {}) {
    const hash = computeFileHash(CSS_PATH);
    let allUpToDate = true;
    const errors = [];

    for (const htmlPath of HTML_FILES) {
        const original = fs.readFileSync(htmlPath, "utf8");
        const relPath = path.relative(ROOT, htmlPath);

        // 1. Verifica se há tags script comentadas (código morto)
        const hasCommentedScript = /<!--[\s\S]*?<script[\s\S]*?-->/i.test(original);
        if (hasCommentedScript) {
            allUpToDate = false;
            errors.push(`${relPath} contém tag <script> comentada (código morto).`);
        }

        // 2. Substitui qualquer versão manual ?v=... de styles.css pelo hash atual
        const pattern = /(href=["'][^"']*styles\.css)(?:\?v=[a-zA-Z0-9._-]+)?(["'])/g;
        const updated = original
            .replace(pattern, `$1?v=${hash}$2`)
            .replace(/\s*<!--\s*<script[^>]*><\/script>\s*-->/gi, "");

        const isMatch = original.includes(`styles.css?v=${hash}`);
        if (!isMatch) {
            allUpToDate = false;
            errors.push(`${relPath} não está com o hash atualizado (esperado: ?v=${hash}).`);
        }

        if (!checkOnly && (original !== updated)) {
            fs.writeFileSync(htmlPath, updated, "utf8");
            console.log(`  ✏️ Atualizado ${relPath} com ?v=${hash}`);
        }
    }

    return { hash, allUpToDate, errors };
}

const isCheck = process.argv.includes("--check");

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    console.log("==================================================================");
    console.log(" Automação de Cache Busting (styles.css -> SHA-256)");
    console.log("==================================================================");

    const { hash, allUpToDate, errors } = updateCacheBusting({ checkOnly: isCheck });

    if (isCheck) {
        if (!allUpToDate) {
            console.error("❌ Verificação de cache-busting falhou:");
            errors.forEach(e => console.error("   • " + e));
            process.exit(1);
        }
        console.log(`✅ Cache-busting verificado com sucesso (?v=${hash}) e sem código morto.`);
    } else {
        console.log(`🎉 Cache-busting sincronizado com sucesso (?v=${hash})!\n`);
    }
}
