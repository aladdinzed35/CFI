import type { Locale } from '@/i18n/routing';

/**
 * The serialisable contract between the server screens (§12.4 course page,
 * §13.3 « Mes demandes ») and the client components of the §9.2 flow.
 *
 * It lives in its own module rather than in `request-modal.tsx` so a server
 * component can name these types without pulling the modal — and everything it
 * carries crosses the RSC boundary, so there are no functions, no class
 * instances and no Prisma rows in it.
 */

/** The centre's coordinates as printed in the modal — every field may be absent. */
export interface BankDetailsView {
  readonly holder: string | null;
  readonly bankName: string | null;
  readonly rib: string | null;
  readonly iban: string | null;
  readonly swift: string | null;
  /** `false` disables the transfer instructions: no RIB and no IBAN are set. */
  readonly usable: boolean;
}

/** What step 1 shows about the formation being bought. */
export interface EnrollmentCourseView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly priceCentimes: number;
  readonly comparePriceCentimes: number | null;
  readonly moduleCount: number;
  readonly durationMinutes: number;
  readonly resourceCount: number;
  readonly certificateEnabled: boolean;
}

/** The ceilings the server enforces, read from the server so they cannot drift. */
export interface ReceiptConstraints {
  /** Hard size limit of one receipt, in bytes (§9.2 — 5 MB). */
  readonly maxBytes: number;
  /** How far back the declared transfer date may go, in days (§9.2 — 30). */
  readonly maxAgeDays: number;
}

/** Everything `RequestModal` needs, resolved once on the server. */
export interface EnrollmentModalData {
  readonly locale: Locale;
  readonly course: EnrollmentCourseView;
  readonly bank: BankDetailsView;
  /** `https://wa.me/…`, or `null` when no number is configured. */
  readonly whatsappUrl: string | null;
  readonly constraints: ReceiptConstraints;
}

/** MIME types the §9.2 pipeline accepts. Mirrors `sniffFileKind` server-side. */
export const RECEIPT_ACCEPT: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
