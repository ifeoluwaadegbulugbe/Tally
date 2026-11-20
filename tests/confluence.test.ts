import { describe, expect, it } from 'vitest';
import { ConfluenceClient, normaliseForMatch, pageSentences, storageToText } from '../src/confluence/client';
import type { HttpResponse } from '../src/jira/client';

function res(status: number, body: unknown = {}): HttpResponse {
  return { status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

const STORAGE =
  '<h1>Acme account plan</h1><p>We met Acme on Tuesday.&nbsp;We will deliver SSO for Acme before their 5 Dec rollout.</p>' +
  '<ac:structured-macro ac:name="info"><ac:parameter ac:name="title">ignored</ac:parameter><ac:rich-text-body><p>Maybe we could offer a custom integration.</p></ac:rich-text-body></ac:structured-macro>' +
  '<ul><li>Contact dana@acme.example &amp; Lee</li></ul><p>&lt;script&gt;alert(1)&lt;/script&gt; is shown as text.</p>';

describe('storageToText', () => {
  it('keeps text and block breaks, drops tags and macro parameters, decodes entities', () => {
    const t = storageToText(STORAGE);
    expect(t).toContain('Acme account plan\nWe met Acme on Tuesday. We will deliver SSO');
    expect(t).not.toContain('ignored');
    expect(t).toContain('Maybe we could offer a custom integration.');
    expect(t).toContain('dana@acme.example & Lee');
    expect(t).toContain('<script>alert(1)</script> is shown as text.'); // O33: rendered as text by the UI
  });
});

describe('pageSentences', () => {
  it('splits into sentences, masks emails and hints likely promises', () => {
    const s = pageSentences(storageToText(STORAGE), ['Acme']);
    const sso = s.find((x) => x.text.startsWith('We will deliver SSO'));
    expect(sso?.likelyPromise).toBe(true);
    expect(s.find((x) => x.text.startsWith('We met Acme'))?.likelyPromise).toBe(false);
    expect(s.some((x) => x.text.includes('d***@acme.example'))).toBe(true);
    expect(s.every((x) => x.text.length <= 300)).toBe(true);
  });
});

describe('normaliseForMatch', () => {
  it('ignores whitespace, curly quotes and case', () => {
    expect(normaliseForMatch('We’ll  ship\nSSO')).toBe(normaliseForMatch("we'll ship sso"));
  });
});

describe('ConfluenceClient', () => {
  it('searches pages with CQL and builds absolute links', async () => {
    let cql = '';
    const c = new ConfluenceClient(async (path) => {
      cql = new URLSearchParams(path.split('?')[1]).get('cql')!;
      return res(200, {
        _links: { base: 'https://x.atlassian.net/wiki' },
        results: [
          { content: { id: '123', title: 'Acme plan', _links: { webui: '/spaces/CS/pages/123' } }, excerpt: '@@@hl@@@SSO@@@endhl@@@ before rollout', resultGlobalContainer: { title: 'Customer Success' } },
          { title: 'not a page' },
        ],
      });
    });
    const r = await c.searchPages('sso "x"', 'CS');
    expect(cql).toBe('type = page AND space = "CS" AND (title ~ "sso  x *" OR text ~ "sso  x ") ORDER BY lastmodified DESC');
    expect(r.ok && r.data).toEqual([
      { id: '123', title: 'Acme plan', spaceName: 'Customer Success', excerpt: 'SSO before rollout', url: 'https://x.atlassian.net/wiki/spaces/CS/pages/123', lastModified: null },
    ]);
  });
  it('reads a page as sentences with its link', async () => {
    const c = new ConfluenceClient(async () =>
      res(200, { id: '123', title: 'Acme plan', body: { storage: { value: STORAGE } }, _links: { base: 'https://x.atlassian.net/wiki', webui: '/spaces/CS/pages/123' } }),
    );
    const r = await c.pageText('123', ['Acme']);
    expect(r.ok && r.data.url).toBe('https://x.atlassian.net/wiki/spaces/CS/pages/123');
    expect(r.ok && r.data.sentences.length).toBeGreaterThan(3);
  });
  it('O20: a restricted page is a clean not_found / forbidden, and ids are validated', async () => {
    expect((await new ConfluenceClient(async () => res(404)).pageText('9')).ok).toBe(false);
    const forbidden = await new ConfluenceClient(async () => res(403)).pageText('9');
    expect(!forbidden.ok && forbidden.code).toBe('forbidden');
    const bad = await new ConfluenceClient(async () => res(200)).pageText('../9');
    expect(!bad.ok && bad.code).toBe('validation');
  });
});

describe('Confluence route guard', () => {
  it('allows only the Confluence REST APIs', async () => {
    const { toRoute } = await import('../src/jira/forge-http');
    const allowed = ['/wiki/rest/api/', '/wiki/api/v2/'];
    expect(toRoute('/wiki/api/v2/pages/123?body-format=storage', allowed).value).toBe('/wiki/api/v2/pages/123?body-format=storage');
    expect(() => toRoute('/rest/api/3/issue/AB-1', allowed)).toThrow();
    expect(() => toRoute('/wiki/api/v2/../../admin', allowed)).toThrow();
  });
});
