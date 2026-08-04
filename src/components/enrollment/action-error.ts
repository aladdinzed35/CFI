'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import type { ActionErrorCode } from '@/server/auth/guards';

/**
 * One place that turns a failed {@link ActionResult} into a sentence a student
 * can act on (§9 rule: errors say what happened *and* what to do).
 *
 * Server actions never compose user-facing prose — they return a code plus an
 * i18n **key**. Two of those keys (`errors.fileTooLarge`, `errors.fileWrongType`)
 * are ICU messages with required placeholders, and rendering them without their
 * arguments throws `FORMATTING_ERROR` at runtime, which would replace a
 * readable upload error with a blank screen. They are therefore re-pointed at
 * the parameter-free copy of the `enrollment.modal.errors` namespace, which
 * says the same thing in the same words.
 *
 * Anything the server sends that is not on the allow-list falls back to the
 * generic sentence rather than being printed raw: a key on screen is the defect
 * this project has already shipped twice.
 */

/** The failure branch of `ActionResult`, without importing the generic. */
export interface ActionFailure {
  readonly error: ActionErrorCode;
  readonly message?: string;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly retryAfterSec?: number;
}

/** Message keys the enrollment services throw, all parameter-free sentences. */
const PASSTHROUGH_KEYS: readonly string[] = [
  'course.request.couponInvalid',
  'course.request.courseUnavailable',
  'course.request.courseIsFree',
  'course.request.courseNotFree',
  'course.request.courseFull',
  'course.request.alreadyEnrolled',
  'course.request.notFound',
  'course.request.receiptNotExpected',
  'course.request.transferDateOutOfRange',
];

/** Keys whose ICU arguments the client does not have — same copy, no arguments. */
const REMAPPED_KEYS: Readonly<Record<string, string>> = {
  'errors.fileTooLarge': 'enrollment.modal.errors.fileTooLarge',
  'errors.fileWrongType': 'enrollment.modal.errors.fileWrongType',
  'errors.required': 'enrollment.modal.errors.receiptRequired',
};

export type TranslateActionError = (failure: ActionFailure) => string;

/**
 * `const describe = useActionErrorMessage(); describe(result)` → a translated,
 * actionable sentence, whatever came back.
 */
export function useActionErrorMessage(): TranslateActionError {
  const t = useTranslations();

  return useCallback(
    (failure: ActionFailure): string => {
      const key = failure.message;

      if (key !== undefined) {
        const remapped = REMAPPED_KEYS[key];
        if (remapped !== undefined) return t(remapped);
        if (PASSTHROUGH_KEYS.includes(key)) return t(key);
      }

      switch (failure.error) {
        case 'rate_limited':
          return t('errors.rateLimited', {
            minutes: Math.max(1, Math.ceil((failure.retryAfterSec ?? 60) / 60)),
          });
        case 'unauthenticated':
          return t('errors.sessionExpired');
        case 'forbidden':
          return t('errors.forbidden.body');
        case 'csrf':
          return t('errors.botDetected');
        case 'not_found':
          return t('course.request.notFound');
        case 'conflict':
          return t('enrollment.modal.errors.duplicateRequest');
        case 'validation':
        case 'server_error':
          return t('enrollment.modal.errors.generic');
      }
    },
    [t],
  );
}
