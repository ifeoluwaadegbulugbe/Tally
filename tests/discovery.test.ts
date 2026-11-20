import { describe, expect, it } from 'vitest';
import { candidateKey, cleanQuote, extractDate, findDuplicates, isCandidate, maskEmails, scanText, suggestClass } from '../src/core';
import { NOW } from './helpers';

const ACCOUNTS = ['Acme', 'Acme Retail', 'Northwind'];

describe('class suggestion (section D examples)', () => {
  it('confirmed: firm verb, party and date', () => {
    expect(suggestClass('We will deliver SSO for Acme before their 5 Dec rollout.', ACCOUNTS).class).toBe('confirmed');
  });
  it('possible: tentative, vague date', () => {
    expect(suggestClass('We should get the migration plan to them soon.', ACCOUNTS).class).toBe('possible');
  });
  it('O11: suggestion ("maybe we could") is classed as discussion', () => {
    expect(suggestClass('Maybe we could offer a custom integration.', ACCOUNTS, true).class).toBe('suggestion');
  });
  it('ambiguous: no speaker', () => {
    expect(suggestClass('SSO before rollout.', ACCOUNTS, true).class).toBe('ambiguous');
  });
  it('firm without a date is only possible', () => {
    expect(suggestClass('We will add audit logs for Acme.', ACCOUNTS).class).toBe('possible');
  });
});

describe('pre-filter', () => {
  it('needs a commitment cue and a customer reference', () => {
    expect(isCandidate('We will ship the export for Northwind by Friday.', ACCOUNTS)).toBe(true);
    expect(isCandidate('We will refactor the build pipeline.', ACCOUNTS)).toBe(false);
    expect(isCandidate('Northwind uses the reporting module.', ACCOUNTS)).toBe(false);
  });
  it('account context satisfies the customer reference', () => {
    expect(isCandidate('SSO before rollout.', [], true)).toBe(true);
    expect(isCandidate('SSO before rollout.', [], false)).toBe(false);
  });
  it('scanText returns snippets with class and explicit dates only', () => {
    const text =
      'Notes from the call. Priya said we will have the audit log ready for Acme by 12 Dec. ' +
      'The weather was nice. We will send the migration plan to Acme by Friday.';
    const hits = scanText(text, NOW, { accountNames: ACCOUNTS });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ suggestedClass: 'confirmed', dueDate: '2026-12-12' });
    expect(hits[1]!.dueDate).toBeNull(); // "by Friday" is relative: never invented
  });
  it('caps the number of candidates per run', () => {
    const text = Array.from({ length: 80 }, (_, i) => `We will deliver item ${i} to the customer by 1 Dec.`).join(' ');
    expect(scanText(text, NOW, { limit: 50 })).toHaveLength(50);
  });
});

describe('extractDate', () => {
  it('reads explicit dates in several forms', () => {
    expect(extractDate('by 5 Dec', NOW)).toBe('2026-12-05');
    expect(extractDate('by December 12th', NOW)).toBe('2026-12-12');
    expect(extractDate('on 2027-01-15', NOW)).toBe('2027-01-15');
    expect(extractDate('by 3 March 2027', NOW)).toBe('2027-03-03');
  });
  it('rolls a long-past day-month into next year', () => {
    expect(extractDate('by 15 Jan', NOW)).toBe('2027-01-15');
    expect(extractDate('by 1 Nov', NOW)).toBe('2026-11-01'); // recent past stays (likely overdue)
  });
  it('returns null when no explicit date is present or the date is invalid', () => {
    expect(extractDate('by Friday', NOW)).toBeNull();
    expect(extractDate('soon', NOW)).toBeNull();
    expect(extractDate('by 31 Feb', NOW)).toBeNull();
  });
});

describe('duplicates', () => {
  const existing = [
    { id: 'C-12', accountId: 'a1', title: 'Support SSO before Acme rollout' },
    { id: 'C-13', accountId: 'a1', title: 'Send migration plan' },
    { id: 'C-14', accountId: 'a2', title: 'Support SSO before Acme rollout' },
  ];
  it('O12: same promise logged twice is flagged with a score, same account only', () => {
    const d = findDuplicates('We will support SSO before the Acme rollout', 'a1', existing);
    expect(d.map((x) => x.id)).toEqual(['C-12']);
    expect(d[0]!.score).toBeGreaterThanOrEqual(0.6);
  });
  it('unrelated text is not a duplicate', () => {
    expect(findDuplicates('Provide onboarding for 20 users', 'a1', existing)).toEqual([]);
  });
});

describe('quote hygiene', () => {
  it('masks email addresses', () => {
    expect(maskEmails('Email dana@acme.com for access')).toBe('Email d***@acme.com for access');
  });
  it('truncates at a sentence boundary within 300 characters', () => {
    const long = `${'We will deliver the thing. '.repeat(15)}`;
    const q = cleanQuote(long);
    expect(q.length).toBeLessThanOrEqual(300);
    expect(q.endsWith('.')).toBe(true);
  });
  it('O33: quotes are stored as plain text, unchanged apart from whitespace', () => {
    expect(cleanQuote('<script>alert(1)</script> we will ship')).toBe('<script>alert(1)</script> we will ship');
  });
  it('candidate keys are stable and distinguish sources', () => {
    expect(candidateKey('u1', 'q')).toBe(candidateKey('u1', 'q'));
    expect(candidateKey('u1', 'q')).not.toBe(candidateKey('u2', 'q'));
  });
});
