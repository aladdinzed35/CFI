/**
 * PDF generation entry points (§19.4).
 *
 * `generateInvoiceForPayment` is what the `GENERATE_INVOICE` job runs: load
 * the payment with its request, student and course, resolve the centre's
 * identity from `SiteSetting`, render, store under `private/invoices`, record
 * the key. Idempotent by construction — a payment whose `invoiceKey` already
 * points at a stored object is skipped, so a retried job (or a reclaimed
 * stale lock) never writes a second invoice.
 */

import { db } from '@/server/db';
import { buildStorageKey, getStorage } from '@/server/storage';
import { renderInvoicePdf, type InvoiceData, type InvoiceIssuer } from './invoice';

export { renderInvoicePdf, type InvoiceData, type InvoiceIssuer } from './invoice';

/* -------------------------------------------------------------------------- */
/* Issuer resolution                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The optional legal-registration settings (§17.12 « Réglages »). Only keys
 * the owner actually filled in are printed — an invoice must not invent an
 * ICE number (rule 8: no placeholders).
 */
const LEGAL_SETTING_LABELS: readonly (readonly [key: string, label: string])[] = [
  ['legal.ice', 'ICE'],
  ['legal.rc', 'RC'],
  ['legal.if', 'IF'],
  ['legal.patente', 'Patente'],
  ['legal.cnss', 'CNSS'],
];

async function resolveIssuer(): Promise<InvoiceIssuer> {
  const keys = [
    'brand.name',
    'brand.fullName',
    'contact.address',
    'contact.email',
    'contact.phone',
    ...LEGAL_SETTING_LABELS.map(([key]) => key),
  ];
  const rows = await db.siteSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const settings = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.value === 'string' && row.value.trim() !== '') {
      settings.set(row.key, row.value.trim());
    }
  }

  const legalLines: string[] = [];
  for (const [key, label] of LEGAL_SETTING_LABELS) {
    const value = settings.get(key);
    if (value !== undefined) legalLines.push(`${label} : ${value}`);
  }

  return {
    brandName: settings.get('brand.name') ?? 'CFI',
    fullName: settings.get('brand.fullName') ?? 'Centre de Formation Immersive',
    address: settings.get('contact.address') ?? null,
    email: settings.get('contact.email') ?? null,
    phone: settings.get('contact.phone') ?? null,
    legalLines,
  };
}

/* -------------------------------------------------------------------------- */
/* Invoice generation                                                          */
/* -------------------------------------------------------------------------- */

export interface GenerateInvoiceResult {
  readonly paymentId: string;
  readonly invoiceNumber: string;
  readonly invoiceKey: string;
  /** `true` when the invoice already existed and nothing was regenerated. */
  readonly skipped: boolean;
  readonly sizeBytes: number;
}

/**
 * Generate (or confirm) the invoice PDF for a payment.
 *
 * @throws when the payment does not exist or carries no invoice number — a
 *   defect in the approval transaction, not a retryable condition, but the job
 *   layer's max-attempts turns it into a visible `FAILED` row either way.
 */
export async function generateInvoiceForPayment(paymentId: string): Promise<GenerateInvoiceResult> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amountCentimes: true,
      method: true,
      receivedAt: true,
      invoiceNumber: true,
      invoiceKey: true,
      createdAt: true,
      request: {
        select: {
          reference: true,
          priceCentimes: true,
          discountCentimes: true,
          amountDueCentimes: true,
          user: { select: { fullName: true, email: true, city: true } },
          course: {
            select: {
              slug: true,
              translations: { where: { locale: 'fr' }, select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (payment === null) {
    throw new Error(`Paiement introuvable pour la génération de facture : ${paymentId}`);
  }
  if (payment.invoiceNumber === null) {
    throw new Error(
      `Le paiement ${paymentId} n'a pas de numéro de facture — la transaction d'approbation doit l'allouer.`,
    );
  }

  const storage = await getStorage();

  // Idempotency: key recorded AND object present ⇒ done. A recorded key whose
  // object vanished (wiped dev storage) falls through and regenerates — §19.4
  // says invoices are "regenerable".
  if (payment.invoiceKey !== null) {
    const head = await storage.head(payment.invoiceKey);
    if (head !== null) {
      return {
        paymentId: payment.id,
        invoiceNumber: payment.invoiceNumber,
        invoiceKey: payment.invoiceKey,
        skipped: true,
        sizeBytes: head.size,
      };
    }
  }

  const issuer = await resolveIssuer();
  const request = payment.request;
  const courseTitle = request.course?.translations[0]?.title ?? request.course?.slug ?? 'Formation';
  const date = payment.receivedAt ?? payment.createdAt;

  const data: InvoiceData = {
    invoiceNumber: payment.invoiceNumber,
    dateLabel: formatFrDate(date),
    reference: request.reference,
    issuer,
    customer: {
      fullName: request.user.fullName,
      email: request.user.email,
      city: request.user.city,
    },
    line: {
      label: `Formation — ${courseTitle}`,
      priceCentimes: request.priceCentimes,
      discountCentimes: request.discountCentimes,
      totalCentimes: payment.amountCentimes,
    },
    paymentMethodLabel:
      payment.method === 'CASH_AT_CENTER' ? 'Espèces au centre' : 'Virement bancaire',
  };

  const bytes = await renderInvoicePdf(data);

  // Reuse the recorded key when only the object was missing, so a regenerated
  // invoice keeps the URL every e-mail and page already linked.
  const invoiceKey =
    payment.invoiceKey ??
    buildStorageKey('private/invoices', payment.invoiceNumber.toLowerCase(), 'pdf', date);
  await storage.put(invoiceKey, bytes, { contentType: 'application/pdf' });

  await db.payment.update({
    where: { id: payment.id },
    data: { invoiceKey },
  });

  return {
    paymentId: payment.id,
    invoiceNumber: payment.invoiceNumber,
    invoiceKey,
    skipped: false,
    sizeBytes: bytes.byteLength,
  };
}

/** `12/03/2026` — §28.1's dense format; the accounting document is French. */
function formatFrDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}
