import { describe, expect, it } from 'vitest';
import { canTransition, deriveSystemStatus } from '../src/core';
import { cmt, issue } from './helpers';

describe('canTransition', () => {
  it('O8: cancel without reason is refused', () => {
    expect(canTransition('assigned', 'cancelled', cmt())).toEqual({ ok: false, reason: 'A reason is required to cancel.' });
    expect(canTransition('assigned', 'cancelled', cmt(), { reason: 'Customer dropped it' }).ok).toBe(true);
  });
  it('O9: delivered -> communicated needs a sent update', () => {
    expect(canTransition('delivered', 'communicated', cmt()).ok).toBe(false);
    expect(canTransition('delivered', 'communicated', cmt(), { hasSentUpdate: true }).ok).toBe(true);
  });
  it('renegotiation needs a reason and a new date', () => {
    expect(canTransition('in_delivery', 'renegotiated', cmt(), { reason: 'Scope grew' }).ok).toBe(false);
    expect(canTransition('in_delivery', 'renegotiated', cmt(), { reason: 'Scope grew', newDueDate: '2027-01-10' }).ok).toBe(true);
  });
  it('closed commitments cannot be cancelled or renegotiated', () => {
    expect(canTransition('delivered', 'cancelled', cmt(), { reason: 'x' }).ok).toBe(false);
    expect(canTransition('cancelled', 'renegotiated', cmt(), { reason: 'x', newDueDate: '2027-01-01' }).ok).toBe(false);
  });
  it('assignment needs an owner', () => {
    expect(canTransition('confirmed', 'assigned', cmt({ ownerAccountId: null })).ok).toBe(false);
    expect(canTransition('confirmed', 'assigned', cmt()).ok).toBe(true);
  });
  it('in_delivery needs a linked issue past To Do', () => {
    const c = cmt({ issueKeys: ['A-1'] });
    expect(canTransition('assigned', 'in_delivery', c, { issues: [issue({ key: 'A-1', statusCategory: 'todo' })] }).ok).toBe(false);
    expect(canTransition('assigned', 'in_delivery', c, { issues: [issue({ key: 'A-1' })] }).ok).toBe(true);
  });
  it('delivered needs every linked issue Done (F-25)', () => {
    const c = cmt({ status: 'in_delivery', issueKeys: ['A-1', 'A-2'] });
    const one = [issue({ key: 'A-1', statusCategory: 'done' }), issue({ key: 'A-2' })];
    const both = [issue({ key: 'A-1', statusCategory: 'done' }), issue({ key: 'A-2', statusCategory: 'done' })];
    expect(canTransition('in_delivery', 'delivered', c, { issues: one }).ok).toBe(false);
    expect(canTransition('in_delivery', 'delivered', c, { issues: both }).ok).toBe(true);
    expect(canTransition('in_delivery', 'delivered', c, { issues: [both[0]!] }).ok).toBe(false);
  });
  it('nothing transitions into confirmed', () => {
    expect(canTransition('assigned', 'confirmed', cmt()).ok).toBe(false);
  });
});

describe('deriveSystemStatus', () => {
  it('moves an owned confirmed commitment to assigned', () => {
    expect(deriveSystemStatus(cmt({ status: 'confirmed' }), [])).toBe('assigned');
  });
  it('moves to in_delivery once work starts, and to delivered when all Done', () => {
    const c = cmt({ issueKeys: ['A-1'] });
    expect(deriveSystemStatus(c, [issue({ key: 'A-1', statusCategory: 'todo' })])).toBeNull();
    expect(deriveSystemStatus(c, [issue({ key: 'A-1' })])).toBe('in_delivery');
    expect(deriveSystemStatus(c, [issue({ key: 'A-1', statusCategory: 'done' })])).toBe('delivered');
  });
  it('reopens a delivered commitment if a linked issue reopens', () => {
    expect(deriveSystemStatus(cmt({ status: 'delivered', issueKeys: ['A-1'] }), [issue({ key: 'A-1' })])).toBe('in_delivery');
  });
  it('does not deliver when a linked issue cannot be read', () => {
    const c = cmt({ status: 'in_delivery', issueKeys: ['A-1', 'A-2'] });
    expect(deriveSystemStatus(c, [issue({ key: 'A-1', statusCategory: 'done' }), issue({ key: 'A-2', statusCategory: 'done', accessible: false })])).toBeNull();
  });
  it('never touches cancelled, communicated or unowned commitments', () => {
    const done = [issue({ key: 'A-1', statusCategory: 'done' })];
    expect(deriveSystemStatus(cmt({ status: 'cancelled', issueKeys: ['A-1'] }), done)).toBeNull();
    expect(deriveSystemStatus(cmt({ status: 'communicated', issueKeys: ['A-1'] }), done)).toBeNull();
    expect(deriveSystemStatus(cmt({ status: 'confirmed', ownerAccountId: null, issueKeys: ['A-1'] }), done)).toBeNull();
  });
});
