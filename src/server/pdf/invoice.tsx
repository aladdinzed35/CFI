/* @jsxRuntime automatic @jsxImportSource react */
/**
 * The invoice PDF (§19.4) — A4 portrait, brand header, legal footer.
 *
 * The pragma above is for esbuild (`tsx prisma/seed.ts` renders demo invoices
 * through this file): with `"jsx": "preserve"` in tsconfig, esbuild would
 * otherwise fall back to the classic `React.createElement` transform and crash
 * with "React is not defined". Next's SWC uses the automatic runtime anyway.
 *
 * ## Why the colours are literals
 * Like the e-mail layer, a PDF cannot read CSS custom properties. The values
 * below are the light "Le Détroit" palette from `src/styles/globals.css`,
 * frozen by hand; brass appears exactly once, on the amount due — money and
 * achievement only. **If `globals.css` changes its light palette, change this
 * object too.**
 *
 * ## Data in, bytes out
 * `renderInvoicePdf` is a pure function of {@link InvoiceData}: no database, no
 * storage, no clock. The loading and storing live in `pdf/index.ts`, which the
 * `GENERATE_INVOICE` job calls — §19.4: "generated in a job, stored privately,
 * regenerable".
 *
 * Amounts are integer centimes rendered by `formatMoney` (rule 6); the layout
 * is LTR French — the accounting document of record — whatever the student's
 * interface locale.
 */

import type { ReactElement } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

import { formatMoney } from '@/lib/money';

/* -------------------------------------------------------------------------- */
/* Palette — frozen from the light theme                                       */
/* -------------------------------------------------------------------------- */

const palette = {
  ink: '#0b1220',
  inkMuted: '#5a6472',
  hairline: '#dfdad0',
  raised: '#f0ede6',
  headerBg: '#060a12',
  headerInk: '#e8f0f4',
  headerAccent: '#2fe3be',
  strait: '#097468',
  /** Money only. */
  brass: '#98621e',
} as const;

/* -------------------------------------------------------------------------- */
/* Data                                                                        */
/* -------------------------------------------------------------------------- */

/** The centre's identity block, resolved from `SiteSetting` by `pdf/index.ts`. */
export interface InvoiceIssuer {
  readonly brandName: string;
  readonly fullName: string;
  readonly address: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  /**
   * Legal registration lines, already labelled (`ICE : …`, `RC : …`). Only the
   * keys the owner filled in appear; an empty array prints nothing invented.
   */
  readonly legalLines: readonly string[];
}

export interface InvoiceData {
  /** `FAC-2026-0042`. */
  readonly invoiceNumber: string;
  /** Payment date, already formatted (`12/03/2026`). */
  readonly dateLabel: string;
  /** `CFI-2026-000123` — the transfer reference. */
  readonly reference: string;
  readonly issuer: InvoiceIssuer;
  readonly customer: {
    readonly fullName: string;
    readonly email: string;
    readonly city: string | null;
  };
  readonly line: {
    /** « Formation — Marketing Digital … » */
    readonly label: string;
    readonly priceCentimes: number;
    readonly discountCentimes: number;
    readonly totalCentimes: number;
  };
  /** « Virement bancaire » / « Espèces au centre ». */
  readonly paymentMethodLabel: string;
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                      */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: 40,
    paddingHorizontal: 0,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: palette.ink,
  },
  header: {
    backgroundColor: palette.headerBg,
    paddingVertical: 28,
    paddingHorizontal: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  brand: { color: palette.headerAccent, fontSize: 20, letterSpacing: 3, fontFamily: 'Helvetica-Bold' },
  brandSub: { color: palette.headerInk, fontSize: 9, marginTop: 4, opacity: 0.85 },
  invoiceTitle: { color: palette.headerInk, fontSize: 12, fontFamily: 'Helvetica-Bold' },
  invoiceNumber: { color: palette.headerAccent, fontSize: 11, marginTop: 2, fontFamily: 'Courier-Bold' },
  body: { paddingHorizontal: 48, paddingTop: 28 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  metaBlock: { maxWidth: '46%' },
  metaTitle: {
    fontSize: 8,
    color: palette.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    fontFamily: 'Helvetica-Bold',
  },
  metaLine: { fontSize: 10, marginBottom: 2 },
  metaMuted: { fontSize: 9, color: palette.inkMuted, marginBottom: 2 },
  table: { borderWidth: 1, borderColor: palette.hairline, borderRadius: 6, overflow: 'hidden' },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: palette.raised,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tableRow: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12 },
  colLabel: { flexGrow: 1, fontSize: 10 },
  colAmount: { width: 110, textAlign: 'right', fontSize: 10 },
  headCell: { fontSize: 8, color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 1 },
  totals: { marginTop: 16, alignItems: 'flex-end' },
  totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  totalsLabel: { width: 160, textAlign: 'right', color: palette.inkMuted, fontSize: 10, paddingRight: 12 },
  totalsValue: { width: 110, textAlign: 'right', fontSize: 10 },
  totalDue: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: palette.brass,
  },
  paidBadge: {
    marginTop: 18,
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderColor: palette.strait,
    color: palette.strait,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 1,
  },
  methodLine: { marginTop: 10, fontSize: 9, color: palette.inkMuted, textAlign: 'right' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
    backgroundColor: palette.raised,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  footerLine: { fontSize: 8, color: palette.inkMuted, marginBottom: 2, textAlign: 'center' },
});

/* -------------------------------------------------------------------------- */
/* Document                                                                    */
/* -------------------------------------------------------------------------- */

function money(centimes: number): string {
  return formatMoney(centimes, 'fr');
}

export function InvoiceDocument({ data }: { readonly data: InvoiceData }): ReactElement {
  const { issuer, customer, line } = data;

  return (
    <Document
      title={`Facture ${data.invoiceNumber}`}
      author={issuer.fullName}
      language="fr"
    >
      <Page size="A4" style={styles.page}>
        {/* Brand header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{issuer.brandName}</Text>
            <Text style={styles.brandSub}>{issuer.fullName}</Text>
          </View>
          <View>
            <Text style={styles.invoiceTitle}>FACTURE</Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* Issuer / customer */}
          <View style={styles.metaRow}>
            <View style={styles.metaBlock}>
              <Text style={styles.metaTitle}>Émetteur</Text>
              <Text style={styles.metaLine}>{issuer.fullName}</Text>
              {issuer.address !== null ? <Text style={styles.metaMuted}>{issuer.address}</Text> : null}
              {issuer.email !== null ? <Text style={styles.metaMuted}>{issuer.email}</Text> : null}
              {issuer.phone !== null ? <Text style={styles.metaMuted}>{issuer.phone}</Text> : null}
            </View>
            <View style={styles.metaBlock}>
              <Text style={styles.metaTitle}>Facturé à</Text>
              <Text style={styles.metaLine}>{customer.fullName}</Text>
              <Text style={styles.metaMuted}>{customer.email}</Text>
              {customer.city !== null ? <Text style={styles.metaMuted}>{customer.city}</Text> : null}
              <Text style={[styles.metaMuted, { marginTop: 6 }]}>Date : {data.dateLabel}</Text>
              <Text style={styles.metaMuted}>Référence : {data.reference}</Text>
            </View>
          </View>

          {/* Line items */}
          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={[styles.colLabel, styles.headCell]}>Désignation</Text>
              <Text style={[styles.colAmount, styles.headCell]}>Montant</Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={styles.colLabel}>{line.label}</Text>
              <Text style={styles.colAmount}>{money(line.priceCentimes)}</Text>
            </View>
          </View>

          {/* Totals */}
          <View style={styles.totals}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Sous-total</Text>
              <Text style={styles.totalsValue}>{money(line.priceCentimes)}</Text>
            </View>
            {line.discountCentimes > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Remise</Text>
                <Text style={styles.totalsValue}>-{money(line.discountCentimes)}</Text>
              </View>
            ) : null}
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, { color: palette.ink, fontFamily: 'Helvetica-Bold' }]}>
                Total réglé
              </Text>
              <Text style={[styles.totalsValue, styles.totalDue]}>{money(line.totalCentimes)}</Text>
            </View>
            <Text style={styles.paidBadge}>PAYÉE</Text>
            <Text style={styles.methodLine}>Mode de règlement : {data.paymentMethodLabel}</Text>
          </View>
        </View>

        {/* Legal footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerLine}>
            {issuer.fullName}
            {issuer.address === null ? '' : ` — ${issuer.address}`}
          </Text>
          {issuer.legalLines.length > 0 ? (
            <Text style={styles.footerLine}>{issuer.legalLines.join(' · ')}</Text>
          ) : null}
          <Text style={styles.footerLine}>
            Facture générée électroniquement — valable sans signature.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/** Render the invoice to bytes. Pure; storage happens in `pdf/index.ts`. */
export function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
