import { db } from '@/server/db';
import { formatPhoneDisplay, parsePhone, toWhatsAppNumber } from '@/lib/phone';
import type { Locale } from '@/i18n/routing';

/**
 * Everything the public chrome (§12.1) needs to render: the brand identity, the
 * contact block, the social accounts and the real course categories.
 *
 * ## Why this file exists at all
 * `src/app/**` and `src/components/**` are forbidden from importing
 * `@/server/db` (§5, enforced by `eslint.config.mjs`), and §12.1 forbids
 * hardcoding the address, the hours, the phone number or the social links —
 * they live in `SiteSetting` and are edited from the admin (§17.12). The header,
 * the footer and the WhatsApp button therefore need a read model, and this is
 * it: one indexed `SiteSetting` read plus one `Category` read, resolved once per
 * locale and reused.
 *
 * ## Nothing here throws
 * A public page must render even if MySQL is briefly unreachable. Every failure
 * degrades to the §3 defaults, and a missing value degrades to `null` — which
 * the footer reads as "do not render that line" rather than "render an empty
 * one". A wrong WhatsApp number is worse than no button, so an unparseable
 * number removes the button entirely (the same rule `server/mail/send.ts`
 * applies to the WhatsApp call to action in e-mails).
 *
 * ## Caching
 * Settings and categories change a few times a year and are read on every
 * public request, so the resolved value is memoised per locale for one minute —
 * the same trade-off, and the same duration, as the brand context in
 * `server/mail/send.ts`. An edit in the admin is visible on the public site
 * within a minute.
 */

/* -------------------------------------------------------------------------- */
/* Shape                                                                       */
/* -------------------------------------------------------------------------- */

export interface ChromeContact {
  /** E.164, for `tel:`. `null` when no number is configured. */
  readonly phoneE164: string | null;
  /** Grouped for reading — always rendered inside `.force-ltr` (§10.3). */
  readonly phoneDisplay: string | null;
  readonly email: string | null;
  /** Digits only, ready for `https://wa.me/<number>`. `null` disables the FAB. */
  readonly whatsappNumber: string | null;
  readonly address: string | null;
  readonly hours: string | null;
}

/** The five networks §3 provisions under `social.*`. */
export const SOCIAL_NETWORKS = ['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube'] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export interface ChromeSocial {
  readonly network: SocialNetwork;
  /** Absolute `http(s)` URL. Anything else is dropped rather than rendered. */
  readonly href: string;
}

/** A real, active category, named in the active locale (fr is the fallback). */
export interface ChromeCategory {
  readonly slug: string;
  readonly name: string;
}

export interface PublicChrome {
  readonly brandName: string;
  readonly brandFullName: string;
  readonly tagline: string | null;
  readonly contact: ChromeContact;
  readonly socials: readonly ChromeSocial[];
  readonly categories: readonly ChromeCategory[];
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

const SETTING_KEYS = [
  'brand.name',
  'brand.fullName',
  'brand.tagline.fr',
  'brand.tagline.ar',
  'brand.tagline.en',
  'brand.tagline.es',
  'contact.phone',
  'contact.email',
  'contact.whatsapp',
  'contact.address',
  'contact.hours',
  'social.facebook',
  'social.instagram',
  'social.linkedin',
  'social.tiktok',
  'social.youtube',
] as const;

/** §3 defaults — they exist so a fresh database still renders a coherent site. */
const BRAND_NAME_DEFAULT = 'CFI';
const BRAND_FULL_NAME_DEFAULT = 'Centre de Formation Immersive';

/** How many categories the footer column lists before « Tout voir » takes over. */
const FOOTER_CATEGORY_LIMIT = 6;

/** One minute. Long enough to matter under load, short enough that an edit lands. */
const CACHE_TTL_MS = 60_000;

/** `SiteSetting.value` is JSON; only a non-empty string is usable as a label. */
function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A social link is rendered as an `<a href>`, so an operator typo must not turn
 * into a `javascript:` URL. Only absolute http(s) survives.
 */
function asHttpUrl(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;

  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const EMPTY_CONTACT: ChromeContact = {
  phoneE164: null,
  phoneDisplay: null,
  email: null,
  whatsappNumber: null,
  address: null,
  hours: null,
};

const FALLBACK: PublicChrome = {
  brandName: BRAND_NAME_DEFAULT,
  brandFullName: BRAND_FULL_NAME_DEFAULT,
  tagline: null,
  contact: EMPTY_CONTACT,
  socials: [],
  categories: [],
};

/* -------------------------------------------------------------------------- */
/* Cache                                                                       */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
  readonly value: PublicChrome;
  readonly expiresAt: number;
}

const cache = new Map<Locale, CacheEntry>();

/**
 * Drop the memo. Called by the admin settings screen after a save so the change
 * is visible immediately instead of within the minute (§17.12).
 */
export function invalidatePublicChrome(): void {
  cache.clear();
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

export async function getPublicChrome(locale: Locale): Promise<PublicChrome> {
  const now = Date.now();
  const cached = cache.get(locale);
  if (cached !== undefined && cached.expiresAt > now) return cached.value;

  let value: PublicChrome;
  try {
    value = await readPublicChrome(locale);
  } catch (cause) {
    // A settings table that cannot be read must not take the marketing site
    // down. Say so once, serve the defaults, and retry on the next request.
    console.warn('[public-chrome] lecture impossible, repli sur les valeurs par défaut :', cause);
    return FALLBACK;
  }

  cache.set(locale, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

async function readPublicChrome(locale: Locale): Promise<PublicChrome> {
  const [settingRows, categoryRows] = await Promise.all([
    db.siteSetting.findMany({
      where: { key: { in: [...SETTING_KEYS] } },
      select: { key: true, value: true },
    }),
    db.category.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { slug: 'asc' }],
      take: FOOTER_CATEGORY_LIMIT,
      select: {
        slug: true,
        translations: {
          where: { locale: { in: [locale, 'fr'] } },
          select: { locale: true, name: true },
        },
      },
    }),
  ]);

  const settings = new Map<string, unknown>();
  for (const row of settingRows) settings.set(row.key, row.value);

  const phone = asString(settings.get('contact.phone'));
  const parsedPhone = phone === null ? null : parsePhone(phone);

  const whatsapp = asString(settings.get('contact.whatsapp'));
  const whatsappNumber = whatsapp === null ? '' : toWhatsAppNumber(whatsapp);

  const socials: ChromeSocial[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const href = asHttpUrl(settings.get(`social.${network}`));
    if (href !== null) socials.push({ network, href });
  }

  const categories: ChromeCategory[] = [];
  for (const row of categoryRows) {
    const exact = row.translations.find((translation) => translation.locale === locale);
    const french = row.translations.find((translation) => translation.locale === 'fr');
    const name = asString(exact?.name) ?? asString(french?.name);
    // A category with no usable name in any locale is a content bug, not
    // something to render as an empty link.
    if (name !== null) categories.push({ slug: row.slug, name });
  }

  return {
    brandName: asString(settings.get('brand.name')) ?? BRAND_NAME_DEFAULT,
    brandFullName: asString(settings.get('brand.fullName')) ?? BRAND_FULL_NAME_DEFAULT,
    tagline:
      asString(settings.get(`brand.tagline.${locale}`)) ?? asString(settings.get('brand.tagline.fr')),
    contact: {
      phoneE164: parsedPhone?.e164 ?? null,
      phoneDisplay: parsedPhone === null ? null : formatPhoneDisplay(parsedPhone.e164),
      email: asString(settings.get('contact.email')),
      whatsappNumber: whatsappNumber === '' ? null : whatsappNumber,
      address: asString(settings.get('contact.address')),
      hours: asString(settings.get('contact.hours')),
    },
    socials,
    categories,
  };
}
