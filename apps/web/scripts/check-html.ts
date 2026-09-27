/**
 * CI check of the built app shell (PLAN §15.2, pitfall 32). The CSP allows only `script-src 'self'`,
 * so any inline script would be blocked and could leave a blank page. The built `index.html` must:
 * 1. have no inline `<script>`: every script has a `src` and an empty body;
 * 2. have no inline event-handler attribute (`onload="…"`), which the CSP blocks too;
 * 3. carry exactly one `<meta http-equiv="Content-Security-Policy">`, equal to `META_CSP`, inside
 *    `<head>` and before every `<script>` (a meta CSP only covers what comes after it).
 *
 * Usage (from apps/web, after the build): `npm run check:html`
 * (= `node scripts/check-html.ts dist/index.html`). Exits with code 1 and lists the problems.
 */
import { readFileSync } from 'node:fs';
import { META_CSP } from './csp.ts';

/** A start tag: `<name …>`, where quoted attribute values may contain `>`. */
const TAG_ATTRS = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)>`;
const ATTR = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Attribute names (lower case) and decoded values of a start tag; a bare attribute maps to ''. */
function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, double, single, bare] of source.matchAll(ATTR)) {
    if (name === undefined) continue;
    attributes.set(name.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ''));
  }
  return attributes;
}

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

/** Returns one message per problem; an empty list means the file passes. */
export function checkHtml(html: string, expectedCsp: string = META_CSP): string[] {
  const problems: string[] = [];
  // Comments are ignored: they neither run nor apply a policy.
  const doc = html.replace(/<!--[\s\S]*?-->/g, '');

  // 1. Scripts.
  const scripts = [
    ...doc.matchAll(new RegExp(`<script\\b${TAG_ATTRS}([\\s\\S]*?)</script\\s*>`, 'gi')),
  ];
  for (const script of scripts) {
    const src = parseAttributes(script[1] ?? '').get('src') ?? '';
    if (src.trim() === '') problems.push(`inline <script> (no src): ${shorten(script[0])}`);
    else if ((script[2] ?? '').trim() !== '') {
      problems.push(`<script src="${src}"> has an inline body: ${shorten(script[0])}`);
    }
  }
  const openings = doc.match(/<script\b/gi)?.length ?? 0;
  if (openings !== scripts.length) problems.push('a <script> tag is never closed');

  // 2. Inline event handlers on any element.
  for (const tag of doc.matchAll(new RegExp(`<([a-z][a-z0-9-]*)\\b${TAG_ATTRS}`, 'gi'))) {
    for (const name of parseAttributes(tag[2] ?? '').keys()) {
      if (/^on[a-z]/.test(name)) {
        problems.push(`inline event handler ${name}= on <${tag[1]}>: ${shorten(tag[0])}`);
      }
    }
  }

  // 3. The meta CSP.
  const isCsp = (attributes: string) =>
    parseAttributes(attributes).get('http-equiv')?.toLowerCase() === 'content-security-policy';
  const metas = [...doc.matchAll(new RegExp(`<meta\\b${TAG_ATTRS}`, 'gi'))];
  const cspMetas = metas.filter((meta) => isCsp(meta[1] ?? ''));
  const csp = cspMetas[0];
  if (csp === undefined) {
    problems.push('no <meta http-equiv="Content-Security-Policy">');
  } else if (cspMetas.length > 1) {
    problems.push(`${cspMetas.length} CSP meta tags; expected exactly one`);
  } else {
    const content = parseAttributes(csp[1] ?? '').get('content');
    if (content !== expectedCsp) {
      problems.push(`meta CSP is "${content ?? ''}", expected "${expectedCsp}"`);
    }
    const headEnd = doc.search(/<\/head\s*>/i);
    if (headEnd === -1 || csp.index > headEnd) problems.push('the meta CSP is not inside <head>');
    const firstScript = doc.search(/<script\b/i);
    if (firstScript !== -1 && firstScript < csp.index) {
      problems.push('the meta CSP comes after a <script>, so it does not cover that script');
    }
  }

  return problems;
}

if (import.meta.main) {
  const file = process.argv[2] ?? 'dist/index.html';
  let html: string;
  try {
    html = readFileSync(file, 'utf8');
  } catch {
    console.error(`check-html: cannot read ${file}. Run the build first.`);
    process.exit(1);
  }
  const problems = checkHtml(html);
  if (problems.length > 0) {
    console.error(`check-html: ${file} fails:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`check-html: ${file} OK (no inline scripts, meta CSP present)`);
  }
}
