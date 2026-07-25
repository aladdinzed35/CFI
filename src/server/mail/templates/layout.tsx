/**
 * Shared email shell (§18).
 *
 * ## Why the design tokens are hard-coded here
 * Every rule elsewhere in the codebase says "tokens only, never a raw hex".
 * Email is the one place that cannot obey it: mail clients strip `<style>`,
 * ignore custom properties, and Outlook's Word renderer understands neither
 * `var()` nor `color-mix()`. So the token *values* are frozen into
 * {@link emailPalette} — the light palette from `src/styles/globals.css`,
 * copied by hand — and every element is styled inline. Light, not dark: a
 * hosted email is read on a white canvas in most clients, and dark-mode email
 * support is too inconsistent to design against.
 * **If `globals.css` changes its light palette, change this object too.**
 *
 * ## Right-to-left
 * `dir` is set on `<html>`, the container and every content section, and text
 * alignment is resolved per locale instead of inherited — Outlook drops `dir`
 * on nested tables often enough that inheritance cannot be trusted. Latin runs
 * that must stay left-to-right inside an Arabic paragraph (a reference code, an
 * email address, a phone number, a URL) go through {@link Ltr}, which isolates
 * them with `unicode-bidi: isolate` so the bidi algorithm cannot reorder the
 * surrounding sentence around them.
 *
 * ## Structure
 * Dark brand header · white content card · muted footer with contact, WhatsApp
 * and — for marketing sends only — an unsubscribe link. Exactly one call to
 * action per email, rendered by {@link EmailCta}, which always prints the raw
 * URL underneath so a client that swallows the button still leaves a usable link.
 */

import type { ReactNode } from 'react';
import type { ZodType } from 'zod';
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import { dirFor, htmlLangFor, isRtl, type Locale } from '@/i18n/routing';

/* ────────────────────────────────────────────────────────────────────────────
 * Palette — the light theme of `src/styles/globals.css`, frozen as literals
 * ────────────────────────────────────────────────────────────────────────── */

export const emailPalette = {
  /** `--raw-bg-abyss` (light) — the canvas behind the card. */
  page: '#f6f4ef',
  /** `--raw-bg-surface` (light) — the card itself. */
  surface: '#ffffff',
  /** `--raw-bg-raised` (light) — footer and detail rows. */
  raised: '#f0ede6',
  /** `--raw-stroke-hairline` (light). */
  hairline: '#dfdad0',
  /** `--raw-ink-primary` (light). */
  ink: '#0b1220',
  /** `--raw-ink-muted` (light). */
  inkMuted: '#5a6472',
  /** `--raw-accent-strait` (light) — the primary action colour. */
  strait: '#097468',
  /** `--raw-on-accent` (light) — text on a filled strait surface. */
  onAccent: '#ffffff',
  /** `--raw-accent-brass` (light) — money and achievement only. */
  brass: '#98621e',
  /** `--raw-signal-danger` (light). */
  danger: '#c0283c',
  /** `--raw-signal-warn` (light). */
  warn: '#8a5a16',
  /** `--raw-signal-success` (light). */
  success: '#1d7a4c',
  /** `--raw-bg-abyss` (dark) — the brand header band. */
  headerBg: '#060a12',
  /** `--raw-ink-primary` (dark) — text on the header band. */
  headerInk: '#e8f0f4',
  /** `--raw-accent-strait` (dark) — the wordmark on the header band. */
  headerAccent: '#2fe3be',
  /** Wash backgrounds, flattened from `color-mix()` onto the white card. */
  straitWash: '#e6f2f0',
  warnWash: '#f7efe1',
  dangerWash: '#f9e9eb',
  successWash: '#e7f4ec',
} as const;

const LATIN_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const ARABIC_FONT =
  "'Noto Naskh Arabic', 'Geeza Pro', 'Segoe UI', Tahoma, Arial, sans-serif";

/* ────────────────────────────────────────────────────────────────────────────
 * Context
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Everything a template needs about the centre itself. Resolved once per send
 * from `SiteSetting` (§3) and passed down, so no template ever reaches for the
 * database or hard-codes a phone number.
 */
export interface BrandContext {
  /** `brand.name` — « CFI ». */
  readonly name: string;
  /** `brand.fullName` — « Centre de Formation Immersive ». */
  readonly fullName: string;
  /** Canonical site origin, no trailing slash. */
  readonly appUrl: string;
  /** `contact.email`. */
  readonly contactEmail: string;
  /** `contact.phone` in E.164, or `null` when the owner has not provided one. */
  readonly contactPhoneE164: string | null;
  /** The same number, grouped for reading. */
  readonly contactPhoneDisplay: string | null;
  /** `contact.whatsapp` in E.164, or `null`. */
  readonly whatsappE164: string | null;
  /** `https://wa.me/…`, or `null` when no WhatsApp number is configured. */
  readonly whatsappUrl: string | null;
  /** `contact.address`. */
  readonly address: string | null;
  /** `contact.hours`. */
  readonly hours: string | null;
}

/** Rendering context handed to every template. */
export interface EmailContext {
  readonly locale: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly brand: BrandContext;
}

export function emailContext(locale: Locale, brand: BrandContext): EmailContext {
  return { locale, dir: dirFor(locale), brand };
}

/** `'left'` or `'right'` — email clients do not understand `start` / `end`. */
export function textAlignFor(locale: Locale): 'left' | 'right' {
  return isRtl(locale) ? 'right' : 'left';
}

function fontFor(locale: Locale): string {
  return isRtl(locale) ? ARABIC_FONT : LATIN_FONT;
}

function lineHeightFor(locale: Locale): string {
  return isRtl(locale) ? '1.8' : '1.6';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared chrome copy — French is the source, the other three are translations
 * ────────────────────────────────────────────────────────────────────────── */

interface ChromeCopy {
  readonly buttonFallback: string;
  readonly needHelp: string;
  readonly whatsapp: string;
  readonly writeUs: string;
  readonly phone: string;
  readonly address: string;
  readonly hours: string;
  readonly sentBecause: string;
  readonly unsubscribe: string;
  readonly unsubscribeNote: string;
}

const CHROME: Record<Locale, ChromeCopy> = {
  fr: {
    buttonFallback: 'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
    needHelp: 'Besoin d’aide ?',
    whatsapp: 'WhatsApp',
    writeUs: 'Écrivez-nous sur WhatsApp',
    phone: 'Téléphone',
    address: 'Adresse',
    hours: 'Horaires',
    sentBecause: 'Vous recevez cet e-mail parce que vous avez un compte sur',
    unsubscribe: 'Se désabonner',
    unsubscribeNote: 'Se désabonner des e-mails d’information',
  },
  ar: {
    buttonFallback: 'إذا لم يعمل الزر، انسخوا هذا الرابط في المتصفح:',
    needHelp: 'هل تحتاجون إلى مساعدة؟',
    whatsapp: 'واتساب',
    writeUs: 'راسلونا عبر واتساب',
    phone: 'الهاتف',
    address: 'العنوان',
    hours: 'أوقات العمل',
    sentBecause: 'تصلكم هذه الرسالة لأن لديكم حسابًا على',
    unsubscribe: 'إلغاء الاشتراك',
    unsubscribeNote: 'إلغاء الاشتراك في الرسائل الإخبارية',
  },
  en: {
    buttonFallback: 'If the button does not work, copy this link into your browser:',
    needHelp: 'Need help?',
    whatsapp: 'WhatsApp',
    writeUs: 'Message us on WhatsApp',
    phone: 'Phone',
    address: 'Address',
    hours: 'Opening hours',
    sentBecause: 'You are receiving this email because you have an account on',
    unsubscribe: 'Unsubscribe',
    unsubscribeNote: 'Unsubscribe from our newsletters',
  },
  es: {
    buttonFallback: 'Si el botón no funciona, copie este enlace en su navegador:',
    needHelp: '¿Necesita ayuda?',
    whatsapp: 'WhatsApp',
    writeUs: 'Escríbanos por WhatsApp',
    phone: 'Teléfono',
    address: 'Dirección',
    hours: 'Horarios',
    sentBecause: 'Recibe este correo porque tiene una cuenta en',
    unsubscribe: 'Cancelar la suscripción',
    unsubscribeNote: 'Cancelar la suscripción a los correos informativos',
  },
};

export function chromeCopy(locale: Locale): ChromeCopy {
  return CHROME[locale];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Template contract
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * What every template file exports.
 *
 * `schema` is not decoration. A template's props reach it two ways: directly
 * from a typed `sendMail` call, and — after a round trip through the `Job`
 * table — as anonymous JSON. The schema is what makes the second path safe, and
 * `.strict()` is what makes a renamed prop fail loudly instead of rendering an
 * email with a blank name in it.
 *
 * Because props travel as JSON, they must be JSON-shaped: dates are ISO
 * strings, never `Date` instances.
 */
export interface EmailTemplate<TProps> {
  /** Stable id. Written to `EmailLog.template` and used as the idempotency prefix. */
  readonly id: string;
  readonly schema: ZodType<TProps>;
  /** Subject line. Sentence case, no exclamation-mark inflation (§28.1). */
  subject(props: TProps, ctx: EmailContext): string;
  /** The HTML tree. Wrapped in {@link EmailLayout} by the template itself. */
  body(props: TProps, ctx: EmailContext): ReactNode;
  /** A real plain-text alternative — written, not stripped from the HTML. */
  text(props: TProps, ctx: EmailContext): string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Building blocks
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Isolates a left-to-right run inside a right-to-left paragraph.
 *
 * Reference codes, emails, phone numbers, prices and URLs are Latin in every
 * locale. Without isolation the bidi algorithm reorders the Arabic text around
 * them and a phone number ends up reading backwards.
 */
export function Ltr({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <span dir="ltr" style={{ unicodeBidi: 'isolate', direction: 'ltr', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export interface EmailTextProps {
  readonly ctx: EmailContext;
  readonly children: ReactNode;
  /** Muted, smaller — for legal notes and security reminders. */
  readonly muted?: boolean;
}

export function EmailParagraph({ ctx, children, muted = false }: EmailTextProps): ReactNode {
  return (
    <Text
      dir={ctx.dir}
      style={{
        margin: '0 0 14px',
        fontFamily: fontFor(ctx.locale),
        fontSize: muted ? '13px' : '15px',
        lineHeight: lineHeightFor(ctx.locale),
        color: muted ? emailPalette.inkMuted : emailPalette.ink,
        textAlign: textAlignFor(ctx.locale),
        direction: ctx.dir,
      }}
    >
      {children}
    </Text>
  );
}

export function EmailHeading({ ctx, children }: EmailTextProps): ReactNode {
  return (
    <Heading
      as="h1"
      dir={ctx.dir}
      style={{
        margin: '0 0 16px',
        fontFamily: fontFor(ctx.locale),
        fontSize: '22px',
        lineHeight: '1.3',
        fontWeight: 700,
        color: emailPalette.ink,
        textAlign: textAlignFor(ctx.locale),
        direction: ctx.dir,
      }}
    >
      {children}
    </Heading>
  );
}

export interface EmailCtaProps {
  readonly ctx: EmailContext;
  readonly href: string;
  readonly label: string;
  /**
   * `false` hides the "if the button does not work" line — used for a `wa.me`
   * or `mailto:` action, where a raw URL underneath is noise rather than help.
   */
  readonly showFallback?: boolean;
}

/** The single call to action. One per email — never two. */
export function EmailCta({ ctx, href, label, showFallback = true }: EmailCtaProps): ReactNode {
  return (
    <Section style={{ margin: '24px 0 8px', direction: ctx.dir }}>
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ borderCollapse: 'collapse' }}
      >
        <tbody>
          <tr>
            <td align="center" style={{ borderRadius: '10px', backgroundColor: emailPalette.strait }}>
              <Button
                href={href}
                style={{
                  display: 'inline-block',
                  padding: '14px 26px',
                  fontFamily: fontFor(ctx.locale),
                  fontSize: '15px',
                  fontWeight: 600,
                  lineHeight: '20px',
                  color: emailPalette.onAccent,
                  textDecoration: 'none',
                  borderRadius: '10px',
                  backgroundColor: emailPalette.strait,
                }}
              >
                {label}
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
      {showFallback ? (
        <Text
          dir={ctx.dir}
          style={{
            margin: '16px 0 0',
            fontFamily: fontFor(ctx.locale),
            fontSize: '12px',
            lineHeight: '1.6',
            color: emailPalette.inkMuted,
            textAlign: textAlignFor(ctx.locale),
            direction: ctx.dir,
            wordBreak: 'break-all',
          }}
        >
          {chromeCopy(ctx.locale).buttonFallback}
          <br />
          <Ltr>
            <Link href={href} style={{ color: emailPalette.strait, textDecoration: 'underline' }}>
              {href}
            </Link>
          </Ltr>
        </Text>
      ) : null}
    </Section>
  );
}

/** An inline link inside a paragraph. Always underlined — colour alone is not a signal. */
export function EmailLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Link href={href} style={{ color: emailPalette.strait, textDecoration: 'underline' }}>
      {children}
    </Link>
  );
}

export type CalloutTone = 'info' | 'warn' | 'danger' | 'success';

const CALLOUT_STYLE: Record<CalloutTone, { readonly bg: string; readonly border: string }> = {
  info: { bg: emailPalette.straitWash, border: emailPalette.strait },
  warn: { bg: emailPalette.warnWash, border: emailPalette.warn },
  danger: { bg: emailPalette.dangerWash, border: emailPalette.danger },
  success: { bg: emailPalette.successWash, border: emailPalette.success },
};

export interface EmailCalloutProps {
  readonly ctx: EmailContext;
  readonly tone: CalloutTone;
  /** Always present: colour alone never carries meaning (§21 / a11y). */
  readonly title: string;
  readonly children: ReactNode;
}

export function EmailCallout({ ctx, tone, title, children }: EmailCalloutProps): ReactNode {
  const style = CALLOUT_STYLE[tone];
  const align = textAlignFor(ctx.locale);
  return (
    <Section
      style={{
        margin: '20px 0',
        padding: '14px 16px',
        backgroundColor: style.bg,
        borderRadius: '10px',
        // A full box border rather than a single side: Outlook drops
        // `border-inline-start`, and a physical side would break in Arabic.
        border: `1px solid ${style.border}`,
        direction: ctx.dir,
      }}
    >
      <Text
        dir={ctx.dir}
        style={{
          margin: '0 0 6px',
          fontFamily: fontFor(ctx.locale),
          fontSize: '13px',
          fontWeight: 700,
          lineHeight: '1.5',
          color: style.border,
          textAlign: align,
          direction: ctx.dir,
        }}
      >
        {title}
      </Text>
      <Text
        dir={ctx.dir}
        style={{
          margin: 0,
          fontFamily: fontFor(ctx.locale),
          fontSize: '14px',
          lineHeight: lineHeightFor(ctx.locale),
          color: emailPalette.ink,
          textAlign: align,
          direction: ctx.dir,
        }}
      >
        {children}
      </Text>
    </Section>
  );
}

export interface DetailRow {
  readonly label: string;
  readonly value: ReactNode;
}

/**
 * A label/value block — the profile summary in the admin notification, the
 * device and IP in a security notice. Rendered as rows rather than a two-column
 * table so it survives a 320 px viewport without horizontal scrolling.
 */
export function EmailDetails({
  ctx,
  rows,
}: {
  readonly ctx: EmailContext;
  readonly rows: readonly DetailRow[];
}): ReactNode {
  const align = textAlignFor(ctx.locale);
  return (
    <Section
      style={{
        margin: '20px 0',
        padding: '6px 16px',
        backgroundColor: emailPalette.raised,
        border: `1px solid ${emailPalette.hairline}`,
        borderRadius: '10px',
        direction: ctx.dir,
      }}
    >
      {rows.map((row) => (
        <Row key={row.label} style={{ direction: ctx.dir }}>
          <Column style={{ padding: '10px 0' }}>
            <Text
              dir={ctx.dir}
              style={{
                margin: '0 0 2px',
                fontFamily: fontFor(ctx.locale),
                fontSize: '12px',
                lineHeight: '1.4',
                color: emailPalette.inkMuted,
                textAlign: align,
                direction: ctx.dir,
              }}
            >
              {row.label}
            </Text>
            <Text
              dir={ctx.dir}
              style={{
                margin: 0,
                fontFamily: fontFor(ctx.locale),
                fontSize: '15px',
                lineHeight: '1.5',
                color: emailPalette.ink,
                textAlign: align,
                direction: ctx.dir,
              }}
            >
              {row.value}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}

/** An ordered "what happens next" list. */
export function EmailSteps({
  ctx,
  steps,
}: {
  readonly ctx: EmailContext;
  readonly steps: readonly string[];
}): ReactNode {
  const align = textAlignFor(ctx.locale);
  return (
    <Section style={{ margin: '4px 0 8px', direction: ctx.dir }}>
      {steps.map((step, index) => (
        <Row key={step} style={{ direction: ctx.dir }}>
          <Column style={{ padding: '6px 0', verticalAlign: 'top' }}>
            <Text
              dir={ctx.dir}
              style={{
                margin: 0,
                fontFamily: fontFor(ctx.locale),
                fontSize: '15px',
                lineHeight: lineHeightFor(ctx.locale),
                color: emailPalette.ink,
                textAlign: align,
                direction: ctx.dir,
              }}
            >
              <span style={{ color: emailPalette.strait, fontWeight: 700 }}>
                <Ltr>{index + 1}.</Ltr>
              </span>{' '}
              {step}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shell
 * ────────────────────────────────────────────────────────────────────────── */

export interface EmailLayoutProps {
  readonly ctx: EmailContext;
  /** Inbox preview line. Never repeat the subject verbatim. */
  readonly preview: string;
  readonly children: ReactNode;
  /**
   * Marketing sends (digests, new-course announcements) must offer a one-click
   * unsubscribe. Transactional sends must not — there is nothing to opt out of.
   */
  readonly unsubscribeUrl?: string | undefined;
}

export function EmailLayout({
  ctx,
  preview,
  children,
  unsubscribeUrl,
}: EmailLayoutProps): ReactNode {
  const { locale, dir, brand } = ctx;
  const copy = chromeCopy(locale);
  const align = textAlignFor(locale);
  const font = fontFor(locale);

  return (
    <Html lang={htmlLangFor(locale)} dir={dir}>
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: '24px 12px',
          backgroundColor: emailPalette.page,
          fontFamily: font,
          color: emailPalette.ink,
          direction: dir,
          WebkitTextSizeAdjust: '100%',
        }}
      >
        <Container
          style={{
            width: '100%',
            maxWidth: '600px',
            margin: '0 auto',
            backgroundColor: emailPalette.surface,
            border: `1px solid ${emailPalette.hairline}`,
            borderRadius: '14px',
            overflow: 'hidden',
            direction: dir,
          }}
        >
          {/* Brand header */}
          <Section
            style={{
              padding: '22px 28px',
              backgroundColor: emailPalette.headerBg,
              direction: dir,
            }}
          >
            <Text
              dir="ltr"
              style={{
                margin: 0,
                fontFamily: LATIN_FONT,
                fontSize: '20px',
                fontWeight: 700,
                letterSpacing: '0.14em',
                lineHeight: '1.2',
                color: emailPalette.headerAccent,
                textAlign: align,
                direction: 'ltr',
              }}
            >
              {brand.name}
            </Text>
            <Text
              dir={dir}
              style={{
                margin: '4px 0 0',
                fontFamily: font,
                fontSize: '12px',
                lineHeight: '1.5',
                color: emailPalette.headerInk,
                opacity: 0.75,
                textAlign: align,
                direction: dir,
              }}
            >
              {brand.fullName}
            </Text>
          </Section>

          {/* Body */}
          <Section style={{ padding: '28px', direction: dir }}>{children}</Section>

          <Hr style={{ margin: 0, border: 'none', borderTop: `1px solid ${emailPalette.hairline}` }} />

          {/* Footer */}
          <Section
            style={{
              padding: '20px 28px 24px',
              backgroundColor: emailPalette.raised,
              direction: dir,
            }}
          >
            <Text
              dir={dir}
              style={{
                margin: '0 0 8px',
                fontFamily: font,
                fontSize: '13px',
                fontWeight: 700,
                lineHeight: '1.5',
                color: emailPalette.ink,
                textAlign: align,
                direction: dir,
              }}
            >
              {copy.needHelp}
            </Text>

            <Text
              dir={dir}
              style={{
                margin: '0 0 4px',
                fontFamily: font,
                fontSize: '13px',
                lineHeight: '1.7',
                color: emailPalette.inkMuted,
                textAlign: align,
                direction: dir,
              }}
            >
              <Ltr>
                <Link
                  href={`mailto:${brand.contactEmail}`}
                  style={{ color: emailPalette.strait, textDecoration: 'underline' }}
                >
                  {brand.contactEmail}
                </Link>
              </Ltr>
              {brand.contactPhoneDisplay !== null && brand.contactPhoneE164 !== null ? (
                <>
                  {' · '}
                  {copy.phone}
                  {' '}
                  <Ltr>
                    <Link
                      href={`tel:${brand.contactPhoneE164}`}
                      style={{ color: emailPalette.strait, textDecoration: 'underline' }}
                    >
                      {brand.contactPhoneDisplay}
                    </Link>
                  </Ltr>
                </>
              ) : null}
            </Text>

            {brand.whatsappUrl !== null ? (
              <Text
                dir={dir}
                style={{
                  margin: '0 0 8px',
                  fontFamily: font,
                  fontSize: '13px',
                  lineHeight: '1.7',
                  color: emailPalette.inkMuted,
                  textAlign: align,
                  direction: dir,
                }}
              >
                <Link
                  href={brand.whatsappUrl}
                  style={{ color: emailPalette.strait, textDecoration: 'underline' }}
                >
                  {copy.writeUs}
                </Link>
              </Text>
            ) : null}

            {brand.address !== null || brand.hours !== null ? (
              <Text
                dir={dir}
                style={{
                  margin: '0 0 10px',
                  fontFamily: font,
                  fontSize: '12px',
                  lineHeight: '1.7',
                  color: emailPalette.inkMuted,
                  textAlign: align,
                  direction: dir,
                }}
              >
                {brand.address ?? ''}
                {brand.address !== null && brand.hours !== null ? ' · ' : ''}
                {brand.hours ?? ''}
              </Text>
            ) : null}

            <Text
              dir={dir}
              style={{
                margin: 0,
                fontFamily: font,
                fontSize: '11px',
                lineHeight: '1.7',
                color: emailPalette.inkMuted,
                textAlign: align,
                direction: dir,
              }}
            >
              {copy.sentBecause}{' '}
              <Ltr>
                <Link
                  href={brand.appUrl}
                  style={{ color: emailPalette.inkMuted, textDecoration: 'underline' }}
                >
                  {hostOf(brand.appUrl)}
                </Link>
              </Ltr>
              {'.'}
              {unsubscribeUrl !== undefined ? (
                <>
                  {' · '}
                  <Link
                    href={unsubscribeUrl}
                    style={{ color: emailPalette.inkMuted, textDecoration: 'underline' }}
                    title={copy.unsubscribeNote}
                  >
                    {copy.unsubscribe}
                  </Link>
                </>
              ) : null}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Plain-text side
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Assembles a plain-text body: a real alternative written for a text reader,
 * not an HTML-to-text approximation. Blank entries are dropped, so a template
 * can pass a conditional line without building an array first.
 */
export function textBody(ctx: EmailContext, blocks: readonly (string | null)[]): string {
  const kept = blocks.filter((block): block is string => block !== null && block.trim().length > 0);
  return `${kept.map((block) => block.trim()).join('\n\n')}\n\n${textFooter(ctx)}\n`;
}

/** The footer, in text form. Mirrors what {@link EmailLayout} renders. */
export function textFooter(ctx: EmailContext, unsubscribeUrl?: string): string {
  const copy = chromeCopy(ctx.locale);
  const { brand } = ctx;
  const lines: string[] = ['—', `${brand.name} · ${brand.fullName}`, copy.needHelp];

  lines.push(brand.contactEmail);
  if (brand.contactPhoneDisplay !== null) {
    lines.push(`${copy.phone} : ${brand.contactPhoneDisplay}`);
  }
  if (brand.whatsappUrl !== null) {
    lines.push(`${copy.whatsapp} : ${brand.whatsappUrl}`);
  }
  if (brand.address !== null) lines.push(`${copy.address} : ${brand.address}`);
  if (brand.hours !== null) lines.push(`${copy.hours} : ${brand.hours}`);
  lines.push(`${copy.sentBecause} ${hostOf(brand.appUrl)}.`);
  if (unsubscribeUrl !== undefined) {
    lines.push(`${copy.unsubscribe} : ${unsubscribeUrl}`);
  }

  return lines.join('\n');
}

/**
 * The name to greet someone by.
 *
 * `fullName` is validated at registration as at least two words (§9.1), so the
 * first token is a given name in the overwhelming majority of cases. A
 * single-word value is returned whole rather than replaced by a placeholder —
 * greeting a real person by the only name they gave is better than greeting
 * them generically.
 */
export function firstNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/u)[0];
  return first !== undefined && first.length > 0 ? first : fullName.trim();
}

/** `https://cfi.ma/fr` → `cfi.ma`. Falls back to the raw value if unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
