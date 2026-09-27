/**
 * Tiny HTML readers for the build checks (`check-html.ts`, `size-budget.ts`). No dependency: they
 * only read the `index.html` that Vite writes.
 */

/** The attributes part of a start tag, up to its `>`: quoted values may contain `>`. */
export const ATTRIBUTES = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)>`;
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export interface StartTag {
  /** Tag name in lower case. */
  readonly name: string;
  /** Offset of the `<` in the searched text. */
  readonly index: number;
  /** The whole tag, `<` to `>`. */
  readonly source: string;
  /** Names in lower case; values decoded; a bare attribute maps to ''. */
  readonly attributes: ReadonlyMap<string, string>;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const [, name, double, single, bare] of source.matchAll(ATTRIBUTE)) {
    if (name === undefined) continue;
    attributes.set(name.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ''));
  }
  return attributes;
}

/** The HTML without comments: commented-out tags neither run nor load anything. */
export function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Every start tag called `name` (any case), or every start tag when no name is given. */
export function startTags(html: string, name?: string): StartTag[] {
  const pattern = new RegExp(`<(${name ?? '[a-z][a-z0-9-]*'})\\b${ATTRIBUTES}`, 'gi');
  return [...html.matchAll(pattern)].map((match) => ({
    name: (match[1] ?? '').toLowerCase(),
    index: match.index,
    source: match[0],
    attributes: parseAttributes(match[2] ?? ''),
  }));
}
