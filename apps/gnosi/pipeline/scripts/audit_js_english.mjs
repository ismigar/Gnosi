#!/usr/bin/env node
/**
 * Report likely Catalan/Spanish comments and developer logs in JS/JSX sources.
 *
 * Espree supplies parser-accurate comment and string locations, avoiding the
 * regex/template/JSX failures of the historical character scanner.
 * Pass `--strings` to also inspect runtime string literals. Translation
 * catalogs are excluded from that mode because their non-English values are
 * intentional.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const espree = require('espree');

const EXCLUDED_DIRS = new Set([
    '.git', '.vite', 'build', 'coverage', 'dist', 'node_modules',
    'playwright-report', 'test-results', 'vendor', 'zotero-reader',
]);
const GENERATED_DATA_FILES = new Set([
    'frontend/src/components/Vault/zoteroSchema.js',
]);
// These values are language endonyms, legacy schema keys, or multilingual
// search aliases. They are data compatibility surfaces, not English defaults.
const INTENTIONAL_RUNTIME_STRINGS = new Set([
    'Español',
    'Fitxers',
    'Núm. pàgines',
    'Pàgines',
    "Ruta de l'arxiu",
    'Taula Principal',
    'estado',
    'estat',
    'fitxer',
    'taula de continguts',
    'view.cal_day',
    'view.cal_month',
    'view.cal_week',
    'view.cal_year',
]);
const EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs']);
const CATALAN_WORDS = new Set([
    'abans', 'això', 'aquesta', 'aquest', 'aquestes', 'aquests', 'arrel',
    'arrencar', 'assegurar', 'avís', 'cal', 'canvi', 'canvis', 'carrega',
    'causa', 'comprovar', 'dades', 'desar', 'després', 'directiva', 'dins',
    'esborrar', 'estat', 'executar', 'fet', 'feta', 'fitxer', 'fitxers',
    'fora', 'idioma', 'llegir', 'màquina', 'mai', 'mateix', 'mateixa',
    'només', 'objectiu', 'pàgina', 'pàgines', 'pendent', 'perquè', 'però',
    'problema', 'qualsevol', 'quan', 'queda', 'queden', 'regla', 'següent',
    'sempre', 'solució', 'també', 'taula', 'taules', 'usuari', 'usuaris',
    'verificació', 'vistes',
]);
const SPANISH_WORDS = new Set([
    'antes', 'archivo', 'archivos', 'aviso', 'cambio', 'cambios', 'cargar',
    'causa', 'comprobar', 'datos', 'después', 'directiva', 'dentro',
    'ejecutar', 'eliminar', 'escribir', 'estado', 'fuera', 'hecho', 'idioma',
    'leer', 'máquina', 'nunca', 'objetivo', 'página', 'páginas', 'pendiente',
    'pero', 'porque', 'problema', 'regla', 'siguiente', 'siempre', 'sin',
    'solución', 'también', 'tabla', 'tablas', 'usuario', 'usuarios',
    'verificación',
]);

function stripIntentionalExamples(text) {
    return String(text || '')
        .replace(/`[^`\n]+`/gu, ' ')
        .replace(/"[^"\n]+"/gu, ' ')
        .replace(/«[^»\n]+»/gu, ' ');
}

function languageSignal(text) {
    const lower = String(text || '').toLocaleLowerCase();
    const tokens = lower.match(/[a-zà-ÿ]+/giu) || [];
    const caHits = tokens.filter((token) => CATALAN_WORDS.has(token)).length;
    const esHits = tokens.filter((token) => SPANISH_WORDS.has(token)).length;
    const catalanElision = /(?<![a-zà-ÿ])[ldsnm]'[a-zà-ÿ]/iu.test(lower);
    const catalanChars = /[àèòïüç·]/iu.test(lower);
    const spanishChars = /[ñ¿¡]/u.test(lower);
    if (catalanElision || caHits >= 2 || (caHits >= 1 && catalanChars)) return 'ca';
    if (spanishChars || esHits >= 2) return 'es';
    if (caHits >= 1 && esHits === 0) return 'ca';
    if (esHits >= 1 && caHits === 0) return 'es';
    return null;
}

function* walkFiles(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            yield* walkFiles(fullPath);
        } else if (EXTENSIONS.has(path.extname(entry.name))) {
            yield fullPath;
        }
    }
}

function staticString(node) {
    if (!node) return '';
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'TemplateLiteral') {
        return node.quasis.map((part) => part.value.cooked || part.value.raw || '').join(' ');
    }
    return '';
}

function developerLogKind(node) {
    if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null;
    const objectName = node.callee.object?.name;
    const propertyName = node.callee.property?.name || node.callee.property?.value;
    if (objectName === 'console' && ['debug', 'error', 'info', 'log', 'warn'].includes(propertyName)) {
        return `console.${propertyName}`;
    }
    if (['log', 'logger'].includes(objectName) && ['debug', 'error', 'exception', 'info', 'warning'].includes(propertyName)) {
        return `${objectName}.${propertyName}`;
    }
    return null;
}

function walkAst(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (['comments', 'loc', 'range', 'tokens'].includes(key)) continue;
        if (Array.isArray(value)) {
            value.forEach((child) => walkAst(child, visit));
        } else if (value && typeof value.type === 'string') {
            walkAst(value, visit);
        }
    }
}

function report(filePath, line, kind, text, language) {
    const compact = text.replace(/\s+/g, ' ').trim();
    process.stdout.write(`${filePath}:${line}:${kind}:${language}:${compact}\n`);
}

let findings = 0;
const inspectStrings = process.argv.includes('--strings');
const roots = process.argv.slice(2).filter((item) => item !== '--strings');
if (roots.length === 0) roots.push(path.resolve(import.meta.dirname, '../..'));

for (const root of roots.map((item) => path.resolve(item))) {
    const files = fs.statSync(root).isDirectory() ? walkFiles(root) : [root];
    for (const filePath of files) {
        const pathParts = filePath.split(path.sep);
        if (inspectStrings && pathParts.includes('locales')) continue;
        const relativePath = path.relative(path.resolve(import.meta.dirname, '../..'), filePath);
        if (inspectStrings && GENERATED_DATA_FILES.has(relativePath)) continue;
        if (inspectStrings && filePath === path.resolve(import.meta.filename)) continue;
        const source = fs.readFileSync(filePath, 'utf8');
        let ast;
        try {
            ast = espree.parse(source, {
                comment: true,
                ecmaFeatures: { jsx: true },
                ecmaVersion: 'latest',
                loc: true,
                range: true,
                sourceType: 'module',
            });
        } catch (error) {
            process.stderr.write(`SKIP ${filePath}: ${error.message}\n`);
            continue;
        }

        for (const comment of ast.comments || []) {
            if (comment.value.includes('@language-example')) continue;
            const language = languageSignal(stripIntentionalExamples(comment.value));
            if (!language) continue;
            report(filePath, comment.loc.start.line, 'comment', comment.value, language);
            findings += 1;
        }

        const reportedRanges = new Set();
        walkAst(ast, (node) => {
            const kind = developerLogKind(node);
            if (kind) {
                for (const argument of node.arguments || []) {
                    const text = staticString(argument);
                    const language = languageSignal(text);
                    if (!language) continue;
                    report(filePath, argument.loc.start.line, kind, text, language);
                    reportedRanges.add(argument.range?.join(':'));
                    findings += 1;
                }
            }
            if (inspectStrings && ['Literal', 'TemplateLiteral'].includes(node.type)) {
                const rangeKey = node.range?.join(':');
                if (reportedRanges.has(rangeKey)) return;
                const text = staticString(node);
                if (INTENTIONAL_RUNTIME_STRINGS.has(text)) return;
                const language = languageSignal(text);
                if (!language) return;
                report(filePath, node.loc.start.line, 'runtime-string', text, language);
                findings += 1;
            }
        });
    }
}

const auditLabel = inspectStrings ? 'documentation/log/runtime-string' : 'documentation/log';
process.stderr.write(`Likely non-English JS/JSX ${auditLabel} findings: ${findings}\n`);
process.exitCode = findings > 0 ? 1 : 0;
