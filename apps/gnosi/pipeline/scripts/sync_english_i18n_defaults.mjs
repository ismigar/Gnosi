#!/usr/bin/env node
/**
 * Synchronize static `t(key, defaultValue)` fallbacks with the English catalog.
 *
 * The script is read-only unless `--write` is passed. It parses JS/JSX with
 * Espree, resolves each static key in `locales/en/translation.json`, and updates
 * only string fallbacks. Dynamic keys and non-string catalog values are left
 * untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const espree = require('espree');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '../..');
const sourceRoot = path.join(appRoot, 'frontend/src');
const catalogPath = path.join(sourceRoot, 'locales/en/translation.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const writeChanges = process.argv.includes('--write');
const excludedDirs = new Set(['locales', 'node_modules', 'vendor']);
const extensions = new Set(['.js', '.jsx', '.mjs']);

function* walkFiles(root) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && excludedDirs.has(entry.name)) continue;
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            yield* walkFiles(fullPath);
        } else if (extensions.has(path.extname(entry.name))) {
            yield fullPath;
        }
    }
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

function staticString(node) {
    return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
}

function isDirectTranslateCall(node) {
    if (node?.type !== 'CallExpression') return false;
    if (node.callee?.type === 'Identifier') return node.callee.name === 't';
    return node.callee?.type === 'MemberExpression'
        && (node.callee.property?.name || node.callee.property?.value) === 't';
}

function unwrapAliasFunction(node) {
    if (node?.type === 'ArrowFunctionExpression') return node;
    if (
        node?.type === 'CallExpression'
        && node.callee?.type === 'Identifier'
        && node.callee.name === 'useCallback'
        && node.arguments?.[0]?.type === 'ArrowFunctionExpression'
    ) {
        return node.arguments[0];
    }
    return null;
}

function aliasPrefix(keyExpression) {
    if (
        keyExpression?.type === 'BinaryExpression'
        && keyExpression.operator === '+'
        && staticString(keyExpression.left) !== null
        && keyExpression.right?.type === 'Identifier'
    ) {
        return staticString(keyExpression.left);
    }
    if (
        keyExpression?.type === 'TemplateLiteral'
        && keyExpression.expressions?.length === 1
        && keyExpression.expressions[0]?.type === 'Identifier'
        && keyExpression.quasis?.length === 2
        && keyExpression.quasis[1]?.value?.cooked === ''
    ) {
        return keyExpression.quasis[0]?.value?.cooked ?? null;
    }
    return null;
}

function collectTranslationAliases(ast) {
    const aliases = new Map();
    walkAst(ast, (node) => {
        if (node?.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier') return;
        const fn = unwrapAliasFunction(node.init);
        if (!fn || fn.body?.type !== 'CallExpression' || !isDirectTranslateCall(fn.body)) return;
        const prefix = aliasPrefix(fn.body.arguments?.[0]);
        if (prefix === null) return;
        aliases.set(node.id.name, prefix);
    });
    return aliases;
}

function translateCallPrefix(node, aliases) {
    if (isDirectTranslateCall(node)) return '';
    if (node?.type !== 'CallExpression' || node.callee?.type !== 'Identifier') return null;
    return aliases.get(node.callee.name) ?? null;
}

function resolveCatalogValue(rawKey) {
    const key = rawKey.includes(':') ? rawKey.split(':').slice(1).join(':') : rawKey;
    const resolve = (candidate) => {
        let value = catalog;
        for (const part of candidate.split('.')) {
            value = value?.[part];
            if (value === undefined) return null;
        }
        return typeof value === 'string' ? value : null;
    };
    const direct = resolve(key);
    if (direct !== null) return direct;
    for (const suffix of ['_other', '_one', '_many']) {
        const plural = resolve(`${key}${suffix}`);
        if (plural !== null) return plural;
    }
    return null;
}

function defaultValueNodes(argument) {
    if (staticString(argument) !== null) return [{ node: argument, suffix: '' }];
    if (argument?.type !== 'ObjectExpression') return [];
    const values = [];
    for (const property of argument.properties || []) {
        const key = property.key?.name || property.key?.value;
        if (staticString(property.value) === null) continue;
        if (key === 'defaultValue') {
            values.push({ node: property.value, suffix: '' });
        } else if (['defaultValue_one', 'defaultValue_other', 'defaultValue_many'].includes(key)) {
            values.push({ node: property.value, suffix: key.slice('defaultValue'.length) });
        }
    }
    return values;
}

let filesChanged = 0;
let fallbacksChanged = 0;
let missingKeys = 0;
const missingKeyDetails = new Set();

for (const filePath of walkFiles(sourceRoot)) {
    const source = fs.readFileSync(filePath, 'utf8');
    let ast;
    try {
        ast = espree.parse(source, {
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

    const replacements = [];
    const aliases = collectTranslationAliases(ast);
    walkAst(ast, (node) => {
        const prefix = translateCallPrefix(node, aliases);
        if (prefix === null) return;
        const rawKey = staticString(node.arguments?.[0]);
        const fallbacks = defaultValueNodes(node.arguments?.[1]);
        if (!rawKey || fallbacks.length === 0) return;
        const key = `${prefix}${rawKey}`;
        for (const fallback of fallbacks) {
            const englishValue = fallback.suffix
                ? resolveCatalogValue(`${key}${fallback.suffix}`) ?? resolveCatalogValue(key)
                : resolveCatalogValue(key);
            if (englishValue === null) {
                missingKeys += 1;
                missingKeyDetails.add(`${path.relative(appRoot, filePath)}:${node.loc.start.line}:${key}${fallback.suffix}`);
                continue;
            }
            if (fallback.node.value === englishValue) continue;
            replacements.push({
                start: fallback.node.range[0],
                end: fallback.node.range[1],
                text: JSON.stringify(englishValue),
            });
        }
    });

    if (replacements.length === 0) continue;
    filesChanged += 1;
    fallbacksChanged += replacements.length;
    process.stdout.write(`${path.relative(appRoot, filePath)}: ${replacements.length}\n`);
    if (!writeChanges) continue;

    let updated = source;
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        updated = updated.slice(0, replacement.start)
            + replacement.text
            + updated.slice(replacement.end);
    }
    fs.writeFileSync(filePath, updated);
}

process.stderr.write(
    `${writeChanges ? 'Updated' : 'Would update'} ${fallbacksChanged} fallbacks `
    + `across ${filesChanged} files; ${missingKeys} static keys had no scalar English value.\n`,
);
for (const detail of [...missingKeyDetails].sort()) {
    process.stderr.write(`MISSING ${detail}\n`);
}
process.exitCode = !writeChanges && fallbacksChanged > 0 ? 1 : 0;
