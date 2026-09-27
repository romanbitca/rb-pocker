/**
 * CI check of the built app shell (PLAN §15.2, pitfall 32). The CSP allows only
 * `script-src 'self'`, so an inline script would be blocked and could leave a blank page.
 * The built `index.html` must:
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
import { ATTRIBUTES, parseAttributes, startTags, stripComments } from './html.ts';

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
}

/** Returns one message per problem; an empty list means the file passes. */
export function checkHtml(html: string, expectedCsp: string = META_CSP): string[] {
  const problems: string[] = [];
  // Comments are ignored: they neither run nor apply a policy.
  const doc = stripComments(html);

  // 1. Scripts.
  const scripts = [
    ...doc.matchAll(new RegExp(`<script\\b${ATTRIBUTES}([\\s\\S]*?)</script\\s*>`, 'gi')),
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
  for (const tag of startTags(doc)) {
    for (const name of tag.attributes.keys()) {
      if (/^on[a-z]/.test(name)) {
        problems.push(`inline event handler ${name}= on <${tag.name}>: ${shorten(tag.source)}`);
      }
    }
  }

  // 3. The meta CSP.
  const cspMetas = startTags(doc, 'meta').filter(
    (meta) => meta.attributes.get('http-equiv')?.toLowerCase() === 'content-security-policy',
  );
  const csp = cspMetas[0];
  if (csp === undefined) {
    problems.push('no <meta http-equiv="Content-Security-Policy">');
  } else if (cspMetas.length > 1) {
    problems.push(`${cspMetas.length} CSP meta tags; expected exactly one`);
  } else {
    const content = csp.attributes.get('content');
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
