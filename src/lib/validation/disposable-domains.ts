/**
 * Bundled blocklist of disposable / throw-away e-mail providers (spec §9.1).
 *
 * ## Why a bundled list and not an API
 * Registration must work when the network is unhappy, must cost nothing per
 * signup, and must be auditable in code review. A remote lookup would fail open
 * (accepting every address) exactly when it is most likely to be abused.
 *
 * ## Admin-editable later
 * §17.12 (`/admin/reglages` → `Inscriptions` → « liste des domaines jetables »)
 * lets an administrator extend or shrink this list at runtime. That override is
 * stored in `SiteSetting` under the key `signup.disposableDomains` and is passed
 * to {@link isDisposableDomain} as the `extra` / `allow` arguments — this module
 * stays the immutable floor, the setting is the delta. Nothing here reads the
 * database, so the list is safe to import from a client component.
 *
 * ## Curation rules for this list
 * - Only providers whose *entire* business is temporary mailboxes. Never a real
 *   consumer provider (gmail, outlook, yahoo, menara.ma, …) — a false positive
 *   here costs the center a paying student.
 * - Registrable domains only, no host prefixes: sub-domains are caught by the
 *   suffix walk in {@link isDisposableDomain}, so `mailinator.com` also blocks
 *   `smtp.mailinator.com` and `nowhere.mailinator.com`.
 * - Sorted and deduplicated (asserted by the unit tests), so a reviewer can scan
 *   it and a future edit produces a readable diff.
 */

/** Sorted, deduplicated registrable domains. 166 entries. */
const DISPOSABLE_DOMAIN_LIST: readonly string[] = [
  '0-mail.com', '10minutemail.com', '10minutemail.net',
  '1secmail.com', '1secmail.net', '1secmail.org',
  '20minutemail.com', '33mail.com', 'anonbox.net',
  'anonymbox.com', 'armyspy.com', 'bearsarefuzzy.com',
  'binkmail.com', 'bugmenot.com', 'bumpymail.com',
  'burnermail.io', 'byom.de', 'cuvox.de',
  'dayrep.com', 'deadaddress.com', 'despam.it',
  'discard.email', 'discardmail.com', 'disposableinbox.com',
  'dispostable.com', 'dodgeit.com', 'dodgit.com',
  'dropmail.me', 'e4ward.com', 'easytrashmail.com',
  'emailfake.com', 'emailias.com', 'emailondeck.com',
  'emailtemporanea.net', 'emailtemporario.com.br', 'emltmp.com',
  'ephemail.net', 'explodemail.com', 'fakeinbox.com',
  'fakemail.net', 'fakemailgenerator.com', 'filzmail.com',
  'fleckens.hu', 'getairmail.com', 'getnada.com',
  'gishpuppy.com', 'grr.la', 'guerrillamail.biz',
  'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'harakirimail.com', 'hidemail.de', 'hmamail.com',
  'inboxalias.com', 'inboxbear.com', 'inboxkitten.com',
  'incognitomail.com', 'jetable.org', 'jourrapide.com',
  'kasmail.com', 'killmail.com', 'klzlk.com',
  'koszmail.pl', 'linshiyouxiang.net', 'luxusmail.org',
  'mail-temp.com', 'mail-temporaire.fr', 'mail.tm',
  'mail7.io', 'mailcatch.com', 'maildrop.cc',
  'maildu.de', 'mailexpire.com', 'mailforspam.com',
  'mailinator.com', 'mailinator.net', 'mailmetrash.com',
  'mailnesia.com', 'mailnull.com', 'mailpoof.com',
  'mailsac.com', 'mailtemp.info', 'mailtothis.com',
  'meltmail.com', 'mintemail.com', 'minuteinbox.com',
  'moakt.com', 'mohmal.com', 'monumentmail.com',
  'mt2015.com', 'mytemp.email', 'mytrashmail.com',
  'nada.email', 'no-spam.ws', 'nomail.xl.cx',
  'nowmymail.com', 'objectmail.com', 'onewaymail.com',
  'owlpic.com', 'pokemail.net', 'pookmail.com',
  'poopmail.com', 'proxymail.eu', 'punkass.com',
  'quickinbox.com', 'rcpt.at', 'rhyta.com',
  'rmqkr.net', 'safetymail.info', 'sharklasers.com',
  'shieldedmail.com', 'shortmail.net', 'sneakemail.com',
  'sofort-mail.de', 'spam4.me', 'spambog.com',
  'spambox.us', 'spamcowboy.com', 'spamdecoy.net',
  'spamfree24.org', 'spamgourmet.com', 'spamherelots.com',
  'spamhole.com', 'spaml.de', 'spamspot.com',
  'superrito.com', 'tafmail.com', 'teleworm.us',
  'temp-mail.io', 'temp-mail.org', 'tempail.com',
  'tempemail.net', 'tempinbox.com', 'tempmail.net',
  'tempmail.plus', 'tempmailaddress.com', 'tempmailer.com',
  'tempomail.fr', 'temporaryemail.net', 'temporaryinbox.com',
  'tempr.email', 'throwawaymail.com', 'tmail.ws',
  'tmailinator.com', 'trash-mail.at', 'trash-mail.com',
  'trashmail.com', 'trashmail.de', 'trashmail.me',
  'trashmail.net', 'trbvm.com', 'trialmail.de',
  'tyldd.com', 'uroid.com', 'veryrealemail.com',
  'wegwerfmail.de', 'wh4f.org', 'willselfdestruct.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'zoemail.com',
];

/**
 * The blocklist as a `Set` — membership is the only operation callers need, and
 * the suffix walk below does up to four lookups per address.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set(
  DISPOSABLE_DOMAIN_LIST,
);

/**
 * Lower-cased registrable-looking domain of an e-mail address, or `null` when
 * the input has no usable `@domain` part.
 *
 * Deliberately lenient: this is a *classifier* input, not a validator. Address
 * shape is the job of `emailSchema` in `./auth`.
 */
export function domainOfEmail(email: string): string | null {
  if (typeof email !== 'string') return null;

  const at = email.lastIndexOf('@');
  if (at < 0) return null;

  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    // A trailing dot is a legal fully-qualified name (`example.com.`) that must
    // not read as a different domain from `example.com`.
    .replace(/\.+$/u, '');

  if (domain === '' || domain.includes('@') || domain.includes(' ')) return null;
  return domain;
}

/**
 * `true` when the address belongs to a known disposable provider.
 *
 * Catches sub-domain variants by walking the label suffixes: `inbox.grr.la`
 * tests `inbox.grr.la`, then `grr.la` (hit). The walk stops before the
 * public-suffix level would be reached in practice because no bare TLD is in
 * the list, so `student.com` can never be blocked by `com`.
 *
 * @param extra  Runtime additions from `SiteSetting` (§17.12). Case-insensitive.
 * @param allow  Runtime exceptions from `SiteSetting`, checked first, so an
 *               administrator can un-block a domain without a deployment.
 */
export function isDisposableDomain(
  email: string,
  extra?: Iterable<string>,
  allow?: Iterable<string>,
): boolean {
  const domain = domainOfEmail(email);
  if (domain === null) return false;

  const allowed = normalizeDomainSet(allow);
  const blocked = normalizeDomainSet(extra);

  const labels = domain.split('.');
  // Walk from the most specific name to the least: `a.b.mailinator.com`,
  // `b.mailinator.com`, `mailinator.com`, `com`.
  for (let i = 0; i < labels.length; i += 1) {
    const candidate = labels.slice(i).join('.');
    if (allowed.has(candidate)) return false;
    if (DISPOSABLE_EMAIL_DOMAINS.has(candidate) || blocked.has(candidate)) return true;
  }

  return false;
}

function normalizeDomainSet(source: Iterable<string> | undefined): ReadonlySet<string> {
  if (source === undefined) return EMPTY_DOMAIN_SET;

  const out = new Set<string>();
  for (const entry of source) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().toLowerCase().replace(/^@/u, '').replace(/\.+$/u, '');
    if (normalized !== '') out.add(normalized);
  }
  return out;
}

const EMPTY_DOMAIN_SET: ReadonlySet<string> = new Set<string>();
