// Confluence client (blueprint H7, T09). Runs as the viewing user, so page restrictions
// apply: a page the viewer cannot read returns forbidden/not_found and nothing is cached.
// Whole page bodies are never stored: page text is returned transiently for the user to
// pick a quote, and only that quote (max 300 chars) plus the page link becomes Evidence.
import { cleanQuote, isCandidate, splitSentences } from '../core/discovery';
import { fail, ok } from '../core/types';
import type { Result } from '../core/types';
import type { HttpResponse } from '../jira/client';

export type ConfluenceHttp = (path: string, init?: { method?: string; body?: string }) => Promise<HttpResponse>;

export interface PageHit {
  id: string;
  title: string;
  spaceName: string | null;
  excerpt: string;
  url: string;
  lastModified: string | null;
}

export interface PageText {
  id: string;
  title: string;
  url: string;
  /** Sentences of the page in order, each at most 300 chars, with a commitment-cue hint. */
  sentences: Array<{ text: string; likelyPromise: boolean }>;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

/** Confluence storage format (XHTML) to plain text: blocks become line breaks, macros' bodies kept. */
export function storageToText(storage: string): string {
  return storage
    .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, ' ') // macro settings, not content
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

/** Sentences for the quote picker: each paragraph line split into sentences. */
export function pageSentences(text: string, accountNames: string[] = [], limit = 150): PageText['sentences'] {
  const out: PageText['sentences'] = [];
  for (const line of text.split('\n')) {
    for (const s of splitSentences(line)) {
      if (out.length >= limit) return out;
      out.push({ text: s, likelyPromise: isCandidate(s, accountNames, true) });
    }
  }
  return out;
}

/** Normalise for the "quote must be in the page" check: whitespace, quotes, case. */
export function normaliseForMatch(s: string): string {
  return s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

export class ConfluenceClient {
  constructor(private readonly http: ConfluenceHttp) {}

  private async call<T>(name: string, path: string): Promise<Result<T>> {
    let res = await this.http(path, { method: 'GET' });
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get('Retry-After') ?? '1'), 3) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      res = await this.http(path, { method: 'GET' });
    }
    if (res.status === 401 || res.status === 403) return fail('forbidden', `Confluence ${name}: no access.`);
    if (res.status === 404) return fail('not_found', `Confluence ${name}: not found or restricted.`);
    if (res.status >= 400) return fail('upstream', `Confluence ${name} failed (${res.status}).`);
    return ok((await res.json()) as T);
  }

  /** CQL page search by title or text, optionally in one space (up to 10). */
  async searchPages(text: string, spaceKey?: string): Promise<Result<PageHit[]>> {
    const q = text.trim().replace(/["\\]/g, ' ');
    const clauses = ['type = page'];
    if (spaceKey) clauses.push(`space = "${spaceKey.replace(/"/g, '')}"`);
    if (q) clauses.push(`(title ~ "${q}*" OR text ~ "${q}")`);
    const params = new URLSearchParams({ cql: `${clauses.join(' AND ')} ORDER BY lastmodified DESC`, limit: '10' });
    const res = await this.call<{
      _links?: { base?: string };
      results: Array<{
        content?: { id?: string; title?: string; _links?: { webui?: string } };
        title?: string;
        excerpt?: string;
        url?: string;
        lastModified?: string;
        resultGlobalContainer?: { title?: string };
      }>;
    }>('search', `/wiki/rest/api/search?${params}`);
    if (!res.ok) return res;
    const base = res.data._links?.base ?? '';
    return ok(
      res.data.results
        .filter((r) => r.content?.id)
        .map((r) => ({
          id: r.content!.id!,
          title: r.content!.title ?? r.title ?? 'Untitled',
          spaceName: r.resultGlobalContainer?.title ?? null,
          // Excerpts carry @@@hl@@@ markers and HTML; plain text only.
          excerpt: cleanQuote(storageToText((r.excerpt ?? '').replace(/@@@(end)?hl@@@/g, '')), 160),
          url: `${base}${r.content!._links?.webui ?? r.url ?? ''}`,
          lastModified: r.lastModified ?? null,
        })),
    );
  }

  /** Space id for a space key (v2 API), or not_found. */
  async spaceId(spaceKey: string): Promise<Result<string>> {
    const params = new URLSearchParams({ keys: spaceKey, limit: '1' });
    const res = await this.call<{ results: Array<{ id: string }> }>('space', `/wiki/api/v2/spaces?${params}`);
    if (!res.ok) return res;
    const id = res.data.results[0]?.id;
    return id ? ok(id) : fail('not_found', `Confluence space ${spaceKey} not found or not visible.`);
  }

  /** One page of a space's pages with bodies (10 per call) for the discovery scan. */
  async scanSpacePage(
    spaceId: string,
    cursor?: string,
  ): Promise<Result<{ pages: Array<{ id: string; title: string; text: string; url: string }>; cursor: string | null }>> {
    const params = new URLSearchParams({ 'body-format': 'storage', limit: '10' });
    if (cursor) params.set('cursor', cursor);
    const res = await this.call<{
      results: Array<{ id: string; title: string; body?: { storage?: { value?: string } }; _links?: { webui?: string } }>;
      _links?: { next?: string; base?: string };
    }>('scan', `/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}/pages?${params}`);
    if (!res.ok) return res;
    const base = res.data._links?.base ?? '';
    const next = res.data._links?.next ? new URLSearchParams(res.data._links.next.split('?')[1] ?? '').get('cursor') : null;
    return ok({
      pages: res.data.results.map((p) => ({
        id: p.id,
        title: p.title,
        text: storageToText(p.body?.storage?.value ?? ''),
        url: `${base}${p._links?.webui ?? ''}`,
      })),
      cursor: next,
    });
  }

  /** Read one page as sentences for quote picking. Nothing here is persisted. */
  async pageText(pageId: string, accountNames: string[] = []): Promise<Result<PageText>> {
    if (!/^\d+$/.test(pageId)) return fail('validation', 'pageId must be numeric.');
    const res = await this.call<{
      id: string;
      title: string;
      body?: { storage?: { value?: string } };
      _links?: { base?: string; webui?: string };
    }>('page', `/wiki/api/v2/pages/${pageId}?body-format=storage`);
    if (!res.ok) return res;
    const text = storageToText(res.data.body?.storage?.value ?? '');
    return ok({
      id: res.data.id,
      title: res.data.title,
      url: `${res.data._links?.base ?? ''}${res.data._links?.webui ?? ''}`,
      sentences: pageSentences(text, accountNames),
    });
  }
}
