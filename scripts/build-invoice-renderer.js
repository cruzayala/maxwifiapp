'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'shared/invoice-renderer.ts'), 'utf8');
const output = '// Generated from shared/invoice-renderer.ts; run npm run build:documents.\n' + ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, removeComments: false },
}).outputText;
const target = path.join(root, 'lib/invoice-renderer.js');
// Se comparan ignorando CRLF/LF: en Windows, Git (core.autocrlf) reescribe los saltos de línea
// al cambiar de rama y el chequeo fallaba aunque el contenido fuera idéntico.
const normalizeNewlines = (text) => text.replace(/\r\n/g, '\n');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || normalizeNewlines(fs.readFileSync(target, 'utf8')) !== normalizeNewlines(output)) throw new Error('Invoice renderer is out of date: npm run build:documents');
} else fs.writeFileSync(target, output);
