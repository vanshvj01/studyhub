// The page is one big script with no bundler, so nothing catches a call to a
// helper that was never defined — it only surfaces when a user reaches that
// view. These checks do the analysis a bundler would have done.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

/**
 * Strips comments and the literal text of strings, keeping `${...}` expressions
 * from template literals — which is exactly where most of this app's calls live.
 * Without this the scan trips over CSS functions and English prose.
 */
function codeOnly(source) {
  let out = '';
  let i = 0;
  const depth = [];              // template-literal nesting

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }

    if (c === "'" || c === '"') {
      const quote = c; i++;
      while (i < source.length && source[i] !== quote) { if (source[i] === '\\') i++; i++; }
      i++; out += ' "" '; continue;
    }

    if (c === '`') {
      i++;
      let text = '';
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '`') { i++; break; }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2;
          let braces = 1, expr = '';
          while (i < source.length && braces > 0) {
            if (source[i] === '{') braces++;
            else if (source[i] === '}') { braces--; if (!braces) { i++; break; } }
            expr += source[i++];
          }
          out += ' ' + codeOnly(expr) + ' ';   // expressions are real code
          continue;
        }
        text += source[i++];
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const code = codeOnly(script);

const declared = new Set([
  ...[...script.matchAll(/(?:^|\s)(?:async\s+)?function\s+(\w+)/g)].map(m => m[1]),
  ...[...script.matchAll(/(?:^|\s)(?:const|let|var)\s+(\w+)/g)].map(m => m[1]),
]);

// Browser and language globals the page legitimately relies on.
const GLOBALS = new Set([
  'window', 'document', 'location', 'history', 'navigator', 'localStorage', 'fetch', 'io',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'alert', 'confirm', 'prompt',
  'JSON', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Math', 'Date', 'Set', 'Map',
  'Promise', 'Error', 'RegExp', 'URLSearchParams', 'FileReader', 'Image', 'AudioContext',
  'encodeURIComponent', 'decodeURIComponent', 'isNaN', 'parseInt', 'parseFloat', 'console',
  'requestAnimationFrame', 'structuredClone', 'Intl', 'resolve', 'reject', 'require',
]);
// CSS functions that appear inside style values; they are not JavaScript calls.
const CSS_FUNCTIONS = new Set(['var', 'calc', 'color-mix', 'mix', 'clamp', 'minmax', 'url',
  'rgb', 'rgba', 'hsl', 'hsla', 'translate', 'translateY', 'translateX', 'rotate', 'scale',
  'linear-gradient', 'radial-gradient', 'srgb', 'blur', 'brightness']);

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'await', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'yield', 'async', 'case', 'throw']);

test('the whole script parses', () => {
  assert.doesNotThrow(() => new vm.Script(script));
});

test('every function called from the page is defined somewhere', () => {
  const called = new Set([...code.matchAll(/(?<![.\w$'"])([a-zA-Z_]\w*)\s*\(/g)].map(m => m[1]));
  const missing = [...called].filter(name =>
    !declared.has(name) && !GLOBALS.has(name) && !KEYWORDS.has(name) && !CSS_FUNCTIONS.has(name));
  assert.deepEqual(missing, [], `called but never defined: ${missing.join(', ')}`);
});

test('every handler named in an inline onclick exists', () => {
  const handlers = new Set([...html.matchAll(/on(?:click|change|input|keydown)="(\w+)\(/g)].map(m => m[1]));
  const missing = [...handlers].filter(name =>
    !declared.has(name) && !GLOBALS.has(name) && !KEYWORDS.has(name));
  assert.deepEqual(missing, [], `inline handler with no function: ${missing.join(', ')}`);
});

test('no function is declared twice — the later one silently wins', () => {
  const names = [...script.matchAll(/(?:^|\s)(?:async\s+)?function\s+(\w+)/g)].map(m => m[1]);
  const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  assert.deepEqual(duplicates, [], `duplicate definitions: ${duplicates.join(', ')}`);
});

test('no API path points at a route the server does not mount', () => {
  const routes = fs.readdirSync(path.join(__dirname, '..', 'src', 'routes')).map(f => f.replace('.js', ''));
  const called = new Set([...script.matchAll(/api\(\s*[`'"]\/(\w[\w-]*)/g)].map(m => m[1]));
  const unknown = [...called].filter(p => !routes.includes(p));
  assert.deepEqual(unknown, [], `frontend calls /api/${unknown.join(', /api/')} with no matching route file`);
});
