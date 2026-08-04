/**
 * CFI — enrollment-request seed (spec §23, §9.2).
 *
 * The §17.3 queue and the §13.3 timeline, populated the way a real Tuesday
 * morning would look: 4 demandes `UNDER_REVIEW` with test receipt images
 * (one of them a deliberate duplicate, so the « Justificatif déjà utilisé »
 * flag has something to flag), 1 `INFO_REQUESTED`, 1 `EXPIRED`, and
 * 6 `APPROVED` complete with payments, enrollments and real invoice PDFs
 * rendered by the production `renderInvoicePdf`.
 *
 * ## Idempotency
 * Every request is upserted on its `reference` (the natural key); payments and
 * enrollments on their unique `requestId`; timeline events are re-derived
 * (delete + insert) because they are a pure function of the data below. The
 * touched courses' `enrollmentCount` / `seatsTaken` are recomputed from the
 * enrollment table, so a second run converges instead of double-counting.
 *
 * ## Storage
 * Receipts are generated at seed time (an SVG rasterised to WebP by sharp,
 * clearly stamped « JUSTIFICATIF DE TEST »), invoices by the real PDF
 * renderer, both written through the configured storage driver under
 * deterministic `…/seed/…` keys — a re-run overwrites, never accumulates.
 * The storage and PDF modules are imported *dynamically*: they read the
 * validated environment, which only exists after `loadEnvFiles()` has run in
 * `seed.ts`'s `main()`.
 */

import { createHash } from 'node:crypto';
import type { Prisma, RequestStatus, TransferType } from '@prisma/client';

/** Structurally the `GroupResult` of `prisma/seed.ts`. */
export interface RequestsGroupResult {
  readonly label: string;
  readonly created: number;
  readonly updated: number;
  readonly preserved: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date();

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

const YEAR = NOW.getFullYear();

/* ──────────────────────────────────────────────────────────────────────────
 * The demandes (§23) — natural key: `reference`
 * ────────────────────────────────────────────────────────────────────────── */

type ReceiptVariant = 'A' | 'B' | 'C' | null;

interface SeedRequest {
  readonly seq: number;
  readonly studentEmail: string;
  readonly courseSlug: string;
  readonly status: RequestStatus;
  readonly transferType: TransferType;
  readonly createdAt: Date;
  /** Which generated test image this request carries. `null` = no receipt yet. */
  readonly receipt: ReceiptVariant;
  /**
   * Reuse another request's receipt bytes verbatim, so its SHA-256 collides and
   * the §17.3 « justificatif déjà utilisé » signal fires.
   *
   * Every other receipt is stamped with its own reference and is therefore
   * byte-unique. That matters: the three shared variants used to make all
   * twelve rows collide, so the queue flagged 100 % of requests as duplicates
   * and the one signal meant to catch a real fraud attempt was pure noise — an
   * admin learns in a day to ignore a badge that is always lit.
   */
  readonly duplicateOfSeq?: number;
  readonly receiptUploadedAt?: Date;
  readonly transferDate?: Date;
  readonly transferBankRef?: string;
  readonly studentMessage?: string;
  readonly infoRequestedMessage?: string;
  /** For APPROVED rows. */
  readonly approval?: {
    readonly reviewedAt: Date;
    readonly invoiceSeq: number;
  };
  readonly couponDiscountCentimes?: number;
}

const REQUESTS: readonly SeedRequest[] = [
  // ── 6 APPROVED, with payments and invoices ────────────────────────────────
  {
    seq: 101,
    studentEmail: 'imane.chraibi@gmail.com',
    courseSlug: 'marketing-digital-fondations',
    status: 'APPROVED',
    transferType: 'INSTANT',
    createdAt: daysAgo(45),
    receipt: 'A',
    receiptUploadedAt: daysAgo(45),
    transferDate: daysAgo(45),
    transferBankRef: 'VIR-88231245',
    approval: { reviewedAt: daysAgo(44), invoiceSeq: 901 },
  },
  {
    seq: 102,
    studentEmail: 'mehdi.berrada@gmail.com',
    courseSlug: 'developpement-web-html-css-javascript',
    status: 'APPROVED',
    transferType: 'STANDARD_48H',
    createdAt: daysAgo(38),
    receipt: 'B',
    receiptUploadedAt: daysAgo(38),
    transferDate: daysAgo(39),
    approval: { reviewedAt: daysAgo(36), invoiceSeq: 902 },
  },
  {
    seq: 103,
    studentEmail: 'sara.elfassi@outlook.com',
    courseSlug: 'excel-de-zero-a-l-analyse',
    status: 'APPROVED',
    transferType: 'INSTANT',
    createdAt: daysAgo(30),
    receipt: 'C',
    receiptUploadedAt: daysAgo(30),
    transferDate: daysAgo(30),
    approval: { reviewedAt: daysAgo(30), invoiceSeq: 903 },
  },
  {
    seq: 104,
    studentEmail: 'anas.idrissi@gmail.com',
    courseSlug: 'creer-son-entreprise-au-maroc',
    status: 'APPROVED',
    transferType: 'CASH_AT_CENTER',
    createdAt: daysAgo(21),
    receipt: null,
    approval: { reviewedAt: daysAgo(20), invoiceSeq: 904 },
  },
  {
    seq: 105,
    studentEmail: 'hajar.naciri@gmail.com',
    courseSlug: 'ui-ux-concevoir-des-interfaces-utilisables',
    status: 'APPROVED',
    transferType: 'INSTANT',
    createdAt: daysAgo(12),
    receipt: 'A',
    receiptUploadedAt: daysAgo(12),
    transferDate: daysAgo(13),
    transferBankRef: 'VIR-90417702',
    approval: { reviewedAt: daysAgo(11), invoiceSeq: 905 },
  },
  {
    seq: 106,
    studentEmail: 'othmane.sbai@gmail.com',
    courseSlug: 'publicite-en-ligne-meta-et-google-ads',
    status: 'APPROVED',
    transferType: 'STANDARD_48H',
    createdAt: daysAgo(5),
    receipt: 'B',
    receiptUploadedAt: daysAgo(5),
    transferDate: daysAgo(6),
    approval: { reviewedAt: daysAgo(3), invoiceSeq: 906 },
  },

  // ── 4 UNDER_REVIEW, sample receipts, one duplicate ───────────────────────
  {
    seq: 107,
    studentEmail: 'imane.chraibi@gmail.com',
    courseSlug: 'react-et-next-js-applications-web',
    status: 'UNDER_REVIEW',
    transferType: 'INSTANT',
    createdAt: daysAgo(2),
    receipt: 'A',
    receiptUploadedAt: daysAgo(2),
    transferDate: daysAgo(2),
    transferBankRef: 'VIR-91556010',
    studentMessage: 'Virement effectué depuis mon compte CIH, merci de vérifier.',
  },
  {
    seq: 108,
    studentEmail: 'mehdi.berrada@gmail.com',
    courseSlug: 'ia-generative-au-quotidien',
    status: 'UNDER_REVIEW',
    transferType: 'STANDARD_48H',
    createdAt: daysAgo(1),
    receipt: 'B',
    receiptUploadedAt: daysAgo(1),
    transferDate: daysAgo(2),
  },
  {
    seq: 109,
    studentEmail: 'sara.elfassi@outlook.com',
    courseSlug: 'francais-professionnel-ecrire-au-travail',
    status: 'UNDER_REVIEW',
    transferType: 'INSTANT',
    createdAt: hoursAgo(7),
    receipt: 'C',
    receiptUploadedAt: hoursAgo(7),
    transferDate: hoursAgo(9),
  },
  {
    // The same bytes as request 108 — §9.2 rule 6's « Justificatif déjà
    // utilisé » badge needs a real duplicate to point at. This is now the ONLY
    // one: sharing three variants across twelve rows made every row a
    // duplicate, so the badge was lit on the whole queue and pointed at
    // nothing.
    seq: 110,
    duplicateOfSeq: 108,
    studentEmail: 'hajar.naciri@gmail.com',
    courseSlug: 'montage-video-formats-courts',
    status: 'UNDER_REVIEW',
    transferType: 'INSTANT',
    createdAt: hoursAgo(3),
    receipt: 'B',
    receiptUploadedAt: hoursAgo(3),
    transferDate: hoursAgo(5),
  },

  // ── 1 INFO_REQUESTED ──────────────────────────────────────────────────────
  {
    seq: 111,
    studentEmail: 'othmane.sbai@gmail.com',
    courseSlug: 'comptabilite-et-gestion-d-une-tpe',
    status: 'INFO_REQUESTED',
    transferType: 'INSTANT',
    createdAt: daysAgo(3),
    receipt: 'C',
    receiptUploadedAt: daysAgo(3),
    transferDate: daysAgo(4),
    infoRequestedMessage:
      'Le montant est illisible sur votre capture. Pouvez-vous renvoyer une photo où le montant, la date et le bénéficiaire apparaissent clairement ?',
  },

  // ── 1 EXPIRED (never got its receipt) ─────────────────────────────────────
  {
    seq: 112,
    studentEmail: 'anas.idrissi@gmail.com',
    courseSlug: 'anglais-professionnel-prendre-la-parole',
    status: 'EXPIRED',
    transferType: 'STANDARD_48H',
    createdAt: daysAgo(10),
    receipt: null,
  },
];

/* ──────────────────────────────────────────────────────────────────────────
 * Test receipt images
 * ────────────────────────────────────────────────────────────────────────── */

const RECEIPT_VARIANTS: Record<Exclude<ReceiptVariant, null>, { tint: string }> = {
  A: { tint: '#e6f2f0' },
  B: { tint: '#f7efe1' },
  C: { tint: '#eef0f7' },
};

/**
 * An unmistakably fake bank receipt (§23: "clearly marked as test images").
 *
 * Stamped with the request's OWN reference and amount, for two reasons. It is
 * what the drawer asks an admin to check — a receipt whose motif reads
 * `CFI-0000-000000` cannot be reconciled against anything, so the verification
 * screen could not be exercised honestly. And it makes each image byte-unique,
 * which is what stops the duplicate-receipt signal firing on every row.
 */
function receiptSvg(
  variant: Exclude<ReceiptVariant, null>,
  reference: string,
  amount: string,
): Buffer {
  const { tint } = RECEIPT_VARIANTS[variant];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700">
      <rect width="1000" height="700" fill="${tint}"/>
      <rect x="40" y="40" width="920" height="620" fill="#ffffff" stroke="#dfdad0" stroke-width="2"/>
      <text x="500" y="130" text-anchor="middle" font-family="Arial" font-size="44" font-weight="bold" fill="#c0283c">JUSTIFICATIF DE TEST — ${variant}</text>
      <text x="500" y="185" text-anchor="middle" font-family="Arial" font-size="26" fill="#5a6472">Document fictif généré par le seed CFI — aucune valeur</text>
      <text x="120" y="300" font-family="Arial" font-size="30" fill="#0b1220">Ordre de virement</text>
      <text x="120" y="360" font-family="Arial" font-size="26" fill="#5a6472">Bénéficiaire : Centre de Formation Immersive</text>
      <text x="120" y="410" font-family="Arial" font-size="26" fill="#5a6472">Montant : ${amount}</text>
      <text x="120" y="460" font-family="Arial" font-size="26" fill="#5a6472">Motif : ${reference}</text>
      <text x="500" y="600" text-anchor="middle" font-family="Arial" font-size="22" fill="#c0283c">NE PAS UTILISER — DONNÉES DE DÉMONSTRATION</text>
    </svg>`,
    'utf8',
  );
}

/**
 * `120000` → `1 200,00 MAD`. Written out rather than taken from `Intl`, whose
 * fr-FR grouping separator is a narrow no-break space that renders as a blank
 * box in the SVG rasteriser.
 */
function receiptAmount(centimes: number): string {
  const whole = Math.floor(centimes / 100);
  const cents = String(centimes % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
  return `${grouped},${cents} MAD`;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/* ──────────────────────────────────────────────────────────────────────────
 * Deterministic storage keys — a re-run overwrites, never accumulates
 * ────────────────────────────────────────────────────────────────────────── */

function receiptKeyFor(seq: number): string {
  return `private/receipts/seed/justificatif-${seq}.webp`;
}

function invoiceKeyFor(invoiceSeq: number): string {
  return `private/invoices/seed/fac-${YEAR}-${String(invoiceSeq).padStart(4, '0')}.pdf`;
}

function referenceFor(seq: number): string {
  return `CFI-${YEAR}-${String(seq).padStart(6, '0')}`;
}

function invoiceNumberFor(invoiceSeq: number): string {
  return `FAC-${YEAR}-${String(invoiceSeq).padStart(4, '0')}`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * The group
 * ────────────────────────────────────────────────────────────────────────── */

export async function seedRequests(tx: Prisma.TransactionClient): Promise<RequestsGroupResult> {
  // Imported here, after `loadEnvFiles()` has populated `process.env` — these
  // modules validate the environment at import time.
  const [{ getStorage }, { renderInvoicePdf }, sharpModule] = await Promise.all([
    import('../../src/server/storage/index'),
    import('../../src/server/pdf/invoice'),
    import('sharp'),
  ]);
  const sharp = sharpModule.default;
  const storage = await getStorage();

  /**
   * Rasterise one request's receipt, memoised by seq.
   *
   * Per request rather than per variant, because each image now carries its own
   * reference — which is the point: it is what makes the bytes unique, and what
   * gives the verification drawer something real to reconcile. A request with
   * `duplicateOfSeq` asks for the SOURCE's bytes, which is exactly what reusing
   * someone else's transfer slip looks like.
   */
  const receiptBytes = new Map<number, Buffer>();
  const bytesForSeq = async (seq: number): Promise<Buffer> => {
    const cached = receiptBytes.get(seq);
    if (cached !== undefined) return cached;

    const row = REQUESTS.find((r) => r.seq === seq);
    if (row === undefined || row.receipt === null) {
      throw new Error(`Seed §23 : la demande ${seq} n'a pas de justificatif à rendre.`);
    }
    const priced = await tx.course.findUnique({
      where: { slug: row.courseSlug },
      select: { priceCentimes: true },
    });
    if (priced === null) {
      throw new Error(`Seed §23 : formation « ${row.courseSlug} » introuvable pour la demande ${seq}.`);
    }

    const due = Math.max(0, priced.priceCentimes - (row.couponDiscountCentimes ?? 0));
    const webp = await sharp(receiptSvg(row.receipt, referenceFor(seq), receiptAmount(due)))
      .webp({ quality: 82 })
      .toBuffer();
    receiptBytes.set(seq, webp);
    return webp;
  };

  let created = 0;
  let updated = 0;

  for (const seed of REQUESTS) {
    const student = await tx.user.findUnique({
      where: { email: seed.studentEmail },
      select: { id: true, fullName: true },
    });
    const course = await tx.course.findUnique({
      where: { slug: seed.courseSlug },
      select: {
        id: true,
        priceCentimes: true,
        accessDurationDays: true,
        translations: { where: { locale: 'fr' }, select: { title: true } },
      },
    });
    if (student === null || course === null) {
      throw new Error(
        `Seed §23 : demande ${seed.seq} — étudiant « ${seed.studentEmail} » ou formation « ${seed.courseSlug} » introuvable. Lancez les groupes personnes et catalogue d'abord.`,
      );
    }

    const reference = referenceFor(seed.seq);
    const discount = seed.couponDiscountCentimes ?? 0;
    const amountDue = Math.max(0, course.priceCentimes - discount);

    // ── Receipt object ──────────────────────────────────────────────────────
    let receiptFields: {
      receiptKey: string | null;
      receiptMime: string | null;
      receiptSizeBytes: number | null;
      receiptSha256: string | null;
      receiptUploadedAt: Date | null;
    };
    if (seed.receipt !== null) {
      // A duplicate carries the other request's bytes verbatim — same SHA-256,
      // same visible reference, which is what makes it detectable.
      const bytes = await bytesForSeq(seed.duplicateOfSeq ?? seed.seq);
      const key = receiptKeyFor(seed.seq);
      await storage.put(key, bytes, { contentType: 'image/webp' });
      receiptFields = {
        receiptKey: key,
        receiptMime: 'image/webp',
        receiptSizeBytes: bytes.byteLength,
        receiptSha256: sha256Hex(bytes),
        receiptUploadedAt: seed.receiptUploadedAt ?? seed.createdAt,
      };
    } else {
      receiptFields = {
        receiptKey: null,
        receiptMime: null,
        receiptSizeBytes: null,
        receiptSha256: null,
        receiptUploadedAt: null,
      };
    }

    const expiresAt =
      seed.status === 'EXPIRED'
        ? new Date(seed.createdAt.getTime() + 7 * DAY_MS)
        : new Date(
            Math.max(NOW.getTime() + 5 * DAY_MS, seed.createdAt.getTime() + 7 * DAY_MS),
          );

    const shared = {
      userId: student.id,
      courseId: course.id,
      status: seed.status,
      priceCentimes: course.priceCentimes,
      discountCentimes: discount,
      amountDueCentimes: amountDue,
      transferType: seed.transferType,
      ...receiptFields,
      transferDate: seed.transferDate ?? null,
      transferBankRef: seed.transferBankRef ?? null,
      studentMessage: seed.studentMessage ?? null,
      infoRequestedMessage: seed.infoRequestedMessage ?? null,
      expiresAt,
      createdAt: seed.createdAt,
    };

    const existing = await tx.enrollmentRequest.findUnique({
      where: { reference },
      select: { id: true },
    });

    const request = await tx.enrollmentRequest.upsert({
      where: { reference },
      create: { reference, ...shared },
      update: shared,
      select: { id: true },
    });
    if (existing === null) created += 1;
    else updated += 1;

    // ── Timeline — re-derived, not accumulated ─────────────────────────────
    await tx.requestEvent.deleteMany({ where: { requestId: request.id } });
    const events: Prisma.RequestEventCreateManyInput[] = [
      { requestId: request.id, type: 'CREATED', actorId: student.id, createdAt: seed.createdAt },
    ];
    if (seed.receipt !== null) {
      const at = seed.receiptUploadedAt ?? seed.createdAt;
      events.push(
        { requestId: request.id, type: 'RECEIPT_UPLOADED', actorId: student.id, createdAt: at },
        { requestId: request.id, type: 'UNDER_REVIEW', actorId: student.id, createdAt: at },
      );
    }
    if (seed.status === 'INFO_REQUESTED') {
      events.push({
        requestId: request.id,
        type: 'INFO_REQUESTED',
        message: seed.infoRequestedMessage ?? null,
        createdAt: new Date(seed.createdAt.getTime() + 6 * HOUR_MS),
      });
    }
    if (seed.status === 'EXPIRED') {
      events.push({ requestId: request.id, type: 'EXPIRED', createdAt: expiresAt });
    }
    if (seed.approval !== undefined) {
      events.push({
        requestId: request.id,
        type: 'APPROVED',
        createdAt: seed.approval.reviewedAt,
      });
    }
    await tx.requestEvent.createMany({ data: events });

    // ── Approval side: payment, invoice PDF, enrollment ────────────────────
    if (seed.approval !== undefined) {
      const admin = await tx.user.findUnique({
        where: { email: 'admin@cfi.ma' },
        select: { id: true },
      });

      await tx.enrollmentRequest.update({
        where: { id: request.id },
        data: { reviewedById: admin?.id ?? null, reviewedAt: seed.approval.reviewedAt },
      });

      const invoiceNumber = invoiceNumberFor(seed.approval.invoiceSeq);
      const invoiceKey = invoiceKeyFor(seed.approval.invoiceSeq);
      const courseTitle = course.translations[0]?.title ?? seed.courseSlug;

      const paymentShared = {
        method:
          seed.transferType === 'CASH_AT_CENTER'
            ? ('CASH_AT_CENTER' as const)
            : ('BANK_TRANSFER' as const),
        amountCentimes: amountDue,
        receivedAt: seed.approval.reviewedAt,
        confirmedById: admin?.id ?? null,
        invoiceNumber,
        invoiceKey,
        bankReference: seed.transferBankRef ?? null,
        createdAt: seed.approval.reviewedAt,
      };
      await tx.payment.upsert({
        where: { requestId: request.id },
        create: { requestId: request.id, ...paymentShared },
        update: paymentShared,
      });

      // The real renderer, so the demo invoice IS the production invoice.
      const pdf = await renderInvoicePdf({
        invoiceNumber,
        dateLabel: frDate(seed.approval.reviewedAt),
        reference,
        issuer: {
          brandName: 'CFI',
          fullName: 'Centre de Formation Immersive',
          address: 'Tanger, Maroc — À COMPLÉTER',
          email: 'contact@cfi.ma',
          phone: '+212600000000',
          legalLines: [],
        },
        customer: {
          fullName: student.fullName,
          email: seed.studentEmail,
          city: null,
        },
        line: {
          label: `Formation — ${courseTitle}`,
          priceCentimes: course.priceCentimes,
          discountCentimes: discount,
          totalCentimes: amountDue,
        },
        paymentMethodLabel:
          seed.transferType === 'CASH_AT_CENTER' ? 'Espèces au centre' : 'Virement bancaire',
      });
      await storage.put(invoiceKey, pdf, { contentType: 'application/pdf' });

      const enrollmentShared = {
        userId: student.id,
        courseId: course.id,
        source: 'PAID_REQUEST' as const,
        status: 'ACTIVE' as const,
        activatedAt: seed.approval.reviewedAt,
        activatedById: admin?.id ?? null,
        expiresAt:
          course.accessDurationDays === null
            ? null
            : new Date(
                seed.approval.reviewedAt.getTime() + course.accessDurationDays * DAY_MS,
              ),
      };
      await tx.enrollment.upsert({
        where: { requestId: request.id },
        create: { requestId: request.id, ...enrollmentShared },
        update: enrollmentShared,
      });
    }
  }

  // ── Recompute derived counters for every course this file touched ─────────
  const slugs = [...new Set(REQUESTS.map((r) => r.courseSlug))];
  for (const slug of slugs) {
    const course = await tx.course.findUnique({ where: { slug }, select: { id: true } });
    if (course === null) continue;
    const activeEnrollments = await tx.enrollment.count({
      where: { courseId: course.id, status: 'ACTIVE' },
    });
    await tx.course.update({
      where: { id: course.id },
      data: { enrollmentCount: activeEnrollments, seatsTaken: activeEnrollments },
    });
  }

  return {
    label: "Demandes d'inscription, paiements, factures (§9.2)",
    created,
    updated,
    preserved: 0,
  };
}

function frDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}
