/**
 * §22: "request state machine (every legal and illegal transition)".
 *
 * The 7 × 6 grid is walked cell by cell against the transition table §1666
 * transcribed below — a second, independent spelling of the same table, so a
 * machine edit that silently changes an edge fails here rather than in
 * production.
 */

import { describe, expect, it } from 'vitest';
import type { RequestStatus } from '@prisma/client';

import {
  allowedEvents,
  applyTransition,
  auditAction,
  canTransition,
  emailEffects,
  FINAL_REQUEST_STATUSES,
  INITIAL_REQUEST_STATUS,
  isFinalRequestStatus,
  notificationEffects,
  REQUEST_EVENTS,
  REQUEST_STATUSES,
  REQUEST_TRANSITIONS,
  sourceStatuses,
  timelineEffects,
  type RequestEvent,
} from '@/server/services/enrollment/state-machine';

/** §1666, transcribed by hand. `null` = illegal edge. */
const EXPECTED: Record<RequestStatus, Record<RequestEvent, RequestStatus | null>> = {
  AWAITING_RECEIPT: {
    RECEIPT_SUBMITTED: 'UNDER_REVIEW',
    ADMIN_INFO_REQUESTED: null,
    ADMIN_APPROVED: null,
    ADMIN_REJECTED: null,
    EXPIRY_PASSED: 'EXPIRED',
    STUDENT_CANCELLED: 'CANCELLED',
  },
  UNDER_REVIEW: {
    RECEIPT_SUBMITTED: null,
    ADMIN_INFO_REQUESTED: 'INFO_REQUESTED',
    ADMIN_APPROVED: 'APPROVED',
    ADMIN_REJECTED: 'REJECTED',
    EXPIRY_PASSED: null,
    STUDENT_CANCELLED: 'CANCELLED',
  },
  INFO_REQUESTED: {
    RECEIPT_SUBMITTED: 'UNDER_REVIEW',
    ADMIN_INFO_REQUESTED: null,
    ADMIN_APPROVED: 'APPROVED',
    ADMIN_REJECTED: 'REJECTED',
    EXPIRY_PASSED: 'EXPIRED',
    STUDENT_CANCELLED: 'CANCELLED',
  },
  APPROVED: {
    RECEIPT_SUBMITTED: null,
    ADMIN_INFO_REQUESTED: null,
    ADMIN_APPROVED: null,
    ADMIN_REJECTED: null,
    EXPIRY_PASSED: null,
    STUDENT_CANCELLED: null,
  },
  REJECTED: {
    RECEIPT_SUBMITTED: null,
    ADMIN_INFO_REQUESTED: null,
    ADMIN_APPROVED: null,
    ADMIN_REJECTED: null,
    EXPIRY_PASSED: null,
    STUDENT_CANCELLED: null,
  },
  EXPIRED: {
    RECEIPT_SUBMITTED: null,
    ADMIN_INFO_REQUESTED: null,
    ADMIN_APPROVED: null,
    ADMIN_REJECTED: null,
    EXPIRY_PASSED: null,
    STUDENT_CANCELLED: null,
  },
  CANCELLED: {
    RECEIPT_SUBMITTED: null,
    ADMIN_INFO_REQUESTED: null,
    ADMIN_APPROVED: null,
    ADMIN_REJECTED: null,
    EXPIRY_PASSED: null,
    STUDENT_CANCELLED: null,
  },
};

describe('la machine à états des demandes (§9.2, table §1666)', () => {
  it('couvre exactement les statuts et les événements déclarés', () => {
    expect([...REQUEST_STATUSES].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(REQUEST_EVENTS).toHaveLength(6);
  });

  // Every one of the 42 cells, legal and illegal.
  for (const from of Object.keys(EXPECTED) as RequestStatus[]) {
    for (const event of REQUEST_EVENTS) {
      const to = EXPECTED[from][event];
      it(`${from} × ${event} → ${to ?? 'illégal'}`, () => {
        const result = applyTransition(from, event);

        if (to === null) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe('ILLEGAL_TRANSITION');
            expect(result.allowed).toEqual(allowedEvents(from));
          }
          expect(canTransition(from, event)).toBe(false);
          expect(REQUEST_TRANSITIONS[from][event]).toBeNull();
        } else {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.to).toBe(to);
            // §20: every state change carries exactly one audit action.
            expect(auditAction(result.effects)).not.toBeNull();
            // Every transition leaves a visible trace on the §9.2 timeline.
            expect(timelineEffects(result.effects).length).toBeGreaterThan(0);
          }
          expect(REQUEST_TRANSITIONS[from][event]).toBe(to);
        }
      });
    }
  }

  it('ne mute jamais : deux applications du même événement donnent le même résultat', () => {
    const first = applyTransition('UNDER_REVIEW', 'ADMIN_APPROVED');
    const second = applyTransition('UNDER_REVIEW', 'ADMIN_APPROVED');
    expect(first).toEqual(second);
  });

  it('les états finaux ne sortent jamais (§9.2 : une re-soumission est une NOUVELLE demande)', () => {
    for (const status of FINAL_REQUEST_STATUSES) {
      expect(isFinalRequestStatus(status)).toBe(true);
      expect(allowedEvents(status)).toHaveLength(0);
    }
  });

  it("l'état initial est AWAITING_RECEIPT (§1666 ligne 2)", () => {
    expect(INITIAL_REQUEST_STATUS).toBe('AWAITING_RECEIPT');
    expect(isFinalRequestStatus(INITIAL_REQUEST_STATUS)).toBe(false);
  });

  it('sourceStatuses alimente le compare-and-set de la double approbation (§9.2 règle 2)', () => {
    expect([...sourceStatuses('ADMIN_APPROVED')].sort()).toEqual([
      'INFO_REQUESTED',
      'UNDER_REVIEW',
    ]);
    // APPROVED n'est PAS une source : c'est ce qui absorbe le double-clic.
    expect(sourceStatuses('ADMIN_APPROVED')).not.toContain('APPROVED');
  });

  it('la première soumission déclenche les e-mails 6 + 7, la re-soumission aucun e-mail étudiant', () => {
    const first = applyTransition('AWAITING_RECEIPT', 'RECEIPT_SUBMITTED');
    expect(first.ok).toBe(true);
    if (first.ok) {
      const emails = emailEffects(first.effects);
      expect(emails.map((e) => e.template).sort()).toEqual([
        'admin-new-payment',
        'request-received',
      ]);
    }

    const again = applyTransition('INFO_REQUESTED', 'RECEIPT_SUBMITTED');
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(emailEffects(again.effects)).toHaveLength(0);
      // ... mais les administrateurs sont bien re-notifiés dans l'application.
      const notifications = notificationEffects(again.effects);
      expect(notifications.some((n) => n.audience === 'ADMINS')).toBe(true);
    }
  });

  it("l'approbation déclenche exactement l'e-mail 9 et une notification étudiant", () => {
    const result = applyTransition('UNDER_REVIEW', 'ADMIN_APPROVED');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(emailEffects(result.effects).map((e) => e.template)).toEqual(['request-approved']);
      expect(notificationEffects(result.effects).map((n) => n.type)).toEqual(['REQUEST_APPROVED']);
    }
  });

  it("l'annulation n'envoie rien : l'étudiant vient de la faire lui-même", () => {
    const result = applyTransition('UNDER_REVIEW', 'STUDENT_CANCELLED');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(emailEffects(result.effects)).toHaveLength(0);
      expect(notificationEffects(result.effects)).toHaveLength(0);
      expect(auditAction(result.effects)).toBe('REQUEST_CANCELLED');
    }
  });
});
