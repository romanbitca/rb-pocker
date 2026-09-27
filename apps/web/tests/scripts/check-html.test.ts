import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkHtml } from '../../scripts/check-html.ts';
import { META_CSP } from '../../scripts/csp.ts';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-html.ts', import.meta.url));
const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${META_CSP}" />`;
const ENTRY = '<script type="module" crossorigin src="./assets/index-Zysmdf9j.js"></script>';

/** A built index.html shaped like Vite's output. Each bad fixture changes one part of it. */
function page({ head = `${CSP_META}\n    ${ENTRY}`, body = '' } = {}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    ${head}
    <link rel="stylesheet" crossorigin href="./assets/index-DEr91b74.css">
  <link rel="manifest" href="./manifest.webmanifest"></head>
  <body>
    <noscript>This browser is too old for RB Poker Coach. Please update Safari or Chrome.</noscript>
    <div id="root"></div>
    ${body}
  </body>
</html>
`;
}

const GOOD = page();

describe('checkHtml: good fixtures', () => {
  it('accepts a Vite-built index.html with the meta CSP and only external scripts', () => {
    expect(checkHtml(GOOD)).toEqual([]);
  });

  it('reads entity-encoded attributes and quoted ">" correctly', () => {
    const encoded = CSP_META.replaceAll("'", '&#39;');
    const html = page({
      head: `${encoded}\n<script src="./a.js" data-note="a>b"></script>`,
    });
    expect(checkHtml(html)).toEqual([]);
  });

  it('ignores scripts inside HTML comments (they never run)', () => {
    expect(checkHtml(page({ body: '<!-- <script>alert(1)</script> -->' }))).toEqual([]);
  });
});

describe('checkHtml: bad fixtures', () => {
  const bad: ReadonlyArray<[string, string, RegExp]> = [
    [
      'an inline registration script (what injectRegister: "inline" would add)',
      page({
        head: `${CSP_META}\n${ENTRY}\n<script id="vite-plugin-pwa:inline-sw">if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js')</script>`,
      }),
      /inline <script> \(no src\)/,
    ],
    [
      'an inline module script',
      page({ body: '<script type="module">import("./x.js")</script>' }),
      /inline <script> \(no src\)/,
    ],
    [
      'an upper-case inline script',
      page({ body: '<SCRIPT>alert(1)</SCRIPT>' }),
      /inline <script> \(no src\)/,
    ],
    [
      'a script with an empty src',
      page({ body: '<script src="">alert(1)</script>' }),
      /inline <script> \(no src\)/,
    ],
    [
      'a script with a src and an inline body',
      page({ body: '<script src="./a.js">alert(1)</script>' }),
      /has an inline body/,
    ],
    ['a script that is never closed', page({ body: '<script src="./a.js">' }), /never closed/],
    [
      'an inline event handler',
      page({ body: '<img src="x.png" onerror="alert(1)">' }),
      /inline event handler onerror=/,
    ],
    ['no meta CSP', page({ head: ENTRY }), /no <meta http-equiv="Content-Security-Policy">/],
    [
      'a different meta CSP (script-src allows inline scripts)',
      page({
        head: `${CSP_META.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")}\n${ENTRY}`,
      }),
      /meta CSP is ".*unsafe-inline.*", expected/,
    ],
    [
      'the meta CSP after the entry script',
      page({ head: `${ENTRY}\n${CSP_META}` }),
      /comes after a <script>/,
    ],
    [
      'the meta CSP in <body>',
      page({ head: '<title>RB Poker Coach</title>', body: CSP_META }),
      /not inside <head>/,
    ],
    [
      'two meta CSPs',
      page({ head: `${CSP_META}\n${CSP_META}\n${ENTRY}` }),
      /2 CSP meta tags; expected exactly one/,
    ],
  ];

  it.each(bad)('rejects %s', (_name, html, problem) => {
    const problems = checkHtml(html);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(problem);
  });
});

describe('check-html CLI', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-html-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(html: string | undefined) {
    const file = join(dir, 'index.html');
    if (html !== undefined) writeFileSync(file, html);
    return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
  }

  it('exits 0 on a good file', () => {
    const result = run(GOOD);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK');
  });

  it('exits 1 and lists the problems on a bad file', () => {
    const result = run(page({ head: `${ENTRY}\n<script>alert(1)</script>` }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('inline <script> (no src)');
    expect(result.stderr).toContain('no <meta http-equiv="Content-Security-Policy">');
  });

  it('exits 1 when the file is missing (build not run)', () => {
    const result = run(undefined);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('cannot read');
  });
});
