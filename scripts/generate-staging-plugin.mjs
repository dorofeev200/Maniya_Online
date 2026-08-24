#!/usr/bin/env node
/**
 * MANIYA-STAGING (TASK-032 Phase 17): сборка тестового плагина.
 * Читает прод-сборку public/maniya-online.js и делает СТАДЖИНГ-вариант:
 *   - MANIYA_API_BASE  → база САМОГО staging (ни одного запроса на PROD-домен)
 *   - COMPONENT        → maniya_online_staging (не конфликтует с прод-плагином)
 *   - PLUGIN_FLAG      → maniya_online_staging_plugin_started
 *   - window.MANIYA_STAGING_BUILD → <build-id> (MANIYA_STAGING_BUILD)
 *   - имя/identity     → 'Maniya Online — STAGING' (отличимо в Lampa)
 *   - название источников/бренд источников НЕ меняются (Maniya · …, KinoPub …)
 * Результат пишется в server/staging-public/maniya-online-staging.js — ВНЕ
 * publicDir, поэтому sendStatic этот файл не раздаёт; отдаёт только роут
 * /staging/<short>.js (index.js), и то лишь при MANIYA_STAGING_ENABLED=true.
 *
 * Usage:
 *   node scripts/generate-staging-plugin.mjs [buildId] [pluginBase]
 *   MANIYA_STAGING_BUILD / MANIYA_STAGING_PLUGIN_BASE из env — фолбэк.
 *   buildId по умолчанию: 8-hex fingerprint-хэша tree (node fingerprint).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const sourceFile = path.join(rootDir, 'public', 'maniya-online.js');
const outDir = path.join(rootDir, 'server', 'staging-public');
const outFile = path.join(outDir, 'maniya-online-staging.js');

const buildId = String(process.argv[2] || process.env.MANIYA_STAGING_BUILD || '').trim() || 'dev';
const pluginBase = String(process.argv[3] || process.env.MANIYA_STAGING_PLUGIN_BASE || '').trim().replace(/\/+$/, '') || 'http://95.85.241.121';

const source = readFileSync(sourceFile, 'utf8');

const REPLACEMENTS = [
  [
    "var MANIYA_API_BASE = 'https://plugin.maniya-kvn.online/api/lampa';",
    `var MANIYA_API_BASE = '${pluginBase}/api/lampa';`
  ],
  [
    "var COMPONENT = 'maniya_online';",
    "var COMPONENT = 'maniya_online_staging';"
  ],
  [
    "var PLUGIN_FLAG = 'maniya_online_plugin_started';",
    "var PLUGIN_FLAG = 'maniya_online_staging_plugin_started';"
  ],
  [
    '  window[PLUGIN_FLAG] = true;',
    `  window[PLUGIN_FLAG] = true;\n\n  // MANIYA-STAGING (TASK-032 Phase 17): id сборки тестового плагина.\n  // Сверка в Web Lampa: window.MANIYA_STAGING_BUILD === server /version.build.\n  window.MANIYA_STAGING_BUILD = '${buildId}';`
  ],
  [
    "      title_maniya: { ru: 'Maniya Online', en: 'Maniya Online' },",
    "      title_maniya: { ru: 'Maniya Online — STAGING', en: 'Maniya Online — STAGING' },"
  ],
  [
    "      name: 'Maniya Online',",
    "      name: 'Maniya Online — STAGING',"
  ],
  [
    "      description: 'Плагин Maniya Online для просмотра доступных источников по подписке',",
    "      description: 'Плагин Maniya Online для просмотра доступных источников по подписке — STAGING (Тест, сборка ' + window.MANIYA_STAGING_BUILD + ')',"
  ],
  // MANIYA-STAGING (TASK-034 M1): staging НЕ читает общий window.MANIYA_ONLINE_TOKEN
  // (его пишет прод-плагин; при двух плагинах в одном WebView — кросс-плагинная
  // утечка токена, T033). Только СВОЙ глобал MANIYA_ONLINE_TOKEN_STAGING, который
  // вшивает сервер в /staging/<short>.js (tokenGlobal=MANIYA_ONLINE_TOKEN_STAGING).
  // Источник public/maniya-online.js в CRLF — многострочный from/to пишем с \r\n.
  [
    "  function getTokenFromRuntime() {\r\n    if (window.MANIYA_ONLINE_TOKEN) return window.MANIYA_ONLINE_TOKEN;\r\n    if (window.maniya_online_token) return window.maniya_online_token;\r\n    if (window.maniyaOnlineToken) return window.maniyaOnlineToken;\r\n    return '';\r\n  }",
    "  function getTokenFromRuntime() {\r\n    if (window.MANIYA_ONLINE_TOKEN_STAGING) return window.MANIYA_ONLINE_TOKEN_STAGING;\r\n    return '';\r\n  }"
  ],
  // MANIYA-STAGING (TASK-034 M2): component-scoped Storage-ключи. Без этого прод и
  // staging плагины в одном WebView делят Lampa.Storage 'maniya_token'/'maniya_unic_id'
  // (второй установленный перетирает первый). PROD-ключи не трогаются — замена
  // только на выходе сборки (исходник public/maniya-online.js не меняется).
  [
    "'maniya_token'",
    "'maniya_token_staging'"
  ],
  [
    "'maniya_unic_id'",
    "'maniya_unic_id_staging'"
  ]
];

let output = source;
const applied = [];
for (const [from, to] of REPLACEMENTS) {
  if (!output.includes(from)) {
    console.error(`[staging-build] NOT FOUND in source: ${from.slice(0, 80)}`);
    process.exit(1);
  }
  output = output.split(from).join(to);
  applied.push(from.slice(0, 60));
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, output, 'utf8');

const sourceLen = Buffer.byteLength(source);
const outLen = Buffer.byteLength(output);
console.log(`[staging-build] ${path.relative(rootDir, outFile)}`);
console.log(`[staging-build] source ${sourceLen} B → ${outLen} B`);
console.log(`[staging-build] buildId=${buildId} pluginBase=${pluginBase}`);
console.log(`[staging-build] replacements applied: ${applied.length}/${REPLACEMENTS.length}`);
for (const a of applied) console.log(`  - ${a}`);