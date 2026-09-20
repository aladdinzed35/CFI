/**
 * Prove a deployment actually works, from the outside.
 *
 *   node scripts/verify-deployment.mjs https://cfi.ma [--key <CRON_SECRET>] [--commit <sha>]
 *
 * The first production deployment of this app answered 200 on its homepage
 * while its database was unreachable, every catalogue section was empty and
 * `/fr/formations` returned 500. "The build went green" proves nothing; this
 * asks the running site the questions that actually matter, and exits non-zero
 * when one of them is answered wrong.
 *
 * Checks, in order of what breaks first in practice:
 *   1. Health      — db and storage reachable; reports the deployed commit.
 *   2. Diagnosis   — with --key: the connection target, whether migrations ran
 *                    and whether anything is published (a connected but empty
 *                    database renders exactly like a broken one).
 *   3. Routes      — every public page, in all four locales, answers 200.
 *   4. Assets      — the favicon, app icons and the social preview exist.
 *                    They did not on the first deployment: shared links had no
 *                    preview and the tab had no icon.
 *   5. Security    — cron refuses without its key and hides unknown jobs; the
 *                    file gateway gives no existence oracle; the headers from
 *                    next.config are actually present; no x-powered-by.
 *   6. Rendering   — the right language per locale, no untranslated keys on
 *                    screen, and the homepage still statically cacheable.
 *
 * No dependencies, no credentials beyond the optional cron key, and safe to run
 * against production at any time: every request is a GET, nothing is written.
 */

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith('http')) ?? '').replace(/\/+$/u, '');
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const key = flag('key') ?? process.env.CRON_SECRET ?? null;
const expectedCommit = flag('commit');

if (base === '') {
  console.error('Usage: node scripts/verify-deployment.mjs https://your-domain [--key CRON_SECRET] [--commit sha]');
  process.exit(2);
}

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const RESET = '[0m';

const results = [];
const record = (level, name, detail) => {
  results.push({ level, name, detail });
  const mark = level === 'pass' ? `${GREEN}✔${RESET}` : level === 'warn' ? `${YELLOW}!${RESET}` : `${RED}✖${RESET}`;
  console.log(`  ${mark} ${name}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
};
const pass = (n, d) => record('pass', n, d);
const warn = (n, d) => record('warn', n, d);
const fail = (n, d) => record('fail', n, d);

const TIMEOUT_MS = 30_000;
async function get(path, init = {}) {
  try {
    const response = await fetch(base + path, {
      redirect: 'follow',
      headers: { 'user-agent': 'cfi-verify-deployment', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
    });
    return { ok: true, status: response.status, headers: response.headers, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, headers: new Headers(), text: '', error: String(error).split('\n')[0] };
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/* ── 1. Health ───────────────────────────────────────────────────────────── */

section('Health');
const health = await get('/api/health');
let healthJson = null;
try {
  healthJson = JSON.parse(health.text);
} catch {
  /* reported below */
}

if (!health.ok) fail('/api/health reachable', health.error);
else if (healthJson === null) fail('/api/health returns JSON', `HTTP ${health.status}`);
else {
  if (healthJson.db === 'ok') pass('database reachable');
  else fail('database reachable', 'db: fail — run with --key to see why');

  if (healthJson.storage === 'ok') pass('storage reachable');
  else fail('storage reachable', 'storage: fail');

  const commit = healthJson.commit ?? '(not reported)';
  if (expectedCommit === null) pass('deployed build', `commit ${commit}, version ${healthJson.version}`);
  else if (commit.startsWith(expectedCommit.slice(0, 7))) pass('deployed build is the expected commit', commit);
  // No `.git` in the host's build: the commit cannot be stamped. wait-for-deploy
  // already established liveness from the build time, so this is not a miss.
  else if (healthJson.commit == null) warn('deployed build is the expected commit', 'the host build reports no commit');
  else fail('deployed build is the expected commit', `live ${commit}, expected ${expectedCommit.slice(0, 12)}`);
}

/* ── 2. Diagnosis ────────────────────────────────────────────────────────── */

if (key !== null) {
  section('Diagnosis (authenticated)');
  const diag = await get(`/api/health?diagnose=1&key=${encodeURIComponent(key)}`);
  let d = null;
  try {
    d = JSON.parse(diag.text);
  } catch {
    /* reported below */
  }

  if (d === null || d.database === undefined) {
    warn('diagnostics available', 'the key was refused, or this build predates them');
  } else {
    const db = d.database;
    const t = db.target ?? {};
    pass('connection target', `${t.user ?? '?'}@${t.host ?? '?'}:${t.port ?? '?'}/${t.database ?? '?'}`);
    if (t.passwordIsTemplatePlaceholder) fail('database password', 'still the template placeholder');
    if (t.passwordBreaksTheUrl) fail('database password', 'contains a character that breaks the URL — percent-encode it');

    if (db.reachable !== true) fail('database connects', `${db.kind ?? ''} ${db.message ?? ''}`.trim());
    else {
      pass('database connects', `${db.tables} tables`);
      if (db.tables === 0) fail('migrations ran', 'schema is empty — build command must run `npm run db:deploy`');
      else if ((db.rows?.publishedCourses ?? 0) === 0)
        warn('content published', 'connected and migrated, but no published course — every catalogue section will be empty');
      else pass('content published', `${db.rows.publishedCourses} published of ${db.rows.courses} courses, ${db.rows.users} users`);
    }

    const s = d.storage ?? {};
    if (s.driver === 'local' && s.pathIsTemplatePlaceholder) fail('storage path', 'still contains uXXXXXXX');
    else if (s.driver === 'local' && s.target?.writable !== true && s.parent?.writable !== true)
      fail('storage path writable', `${s.path} is not writable by the app`);
    else pass('storage configured', s.driver === 'local' ? `local: ${s.path}` : `s3`);
  }
}

/* ── 3. Routes ───────────────────────────────────────────────────────────── */

section('Routes');
const ROUTES = [
  '/', '/fr', '/ar', '/en', '/es',
  '/fr/formations', '/fr/parcours', '/fr/tarifs', '/fr/notre-methode', '/fr/a-propos',
  '/fr/formateurs', '/fr/faq', '/fr/contact', '/fr/blog', '/fr/certificat',
  '/fr/legal/cgu', '/fr/legal/confidentialite', '/fr/connexion', '/fr/inscription',
  '/robots.txt', '/sitemap.xml', '/manifest.webmanifest',
];
const routeFailures = [];
for (const path of ROUTES) {
  const res = await get(path);
  if (!res.ok || res.status >= 400) routeFailures.push(`${path} → ${res.ok ? res.status : res.error}`);
}
if (routeFailures.length === 0) pass(`every public route answers`, `${ROUTES.length} routes`);
else fail('every public route answers', routeFailures.join(' · '));

/* ── 4. Assets ───────────────────────────────────────────────────────────── */

section('Brand assets');
const ASSETS = [
  '/brand/favicon.ico', '/brand/apple-touch-icon.png', '/brand/icon-192.png',
  '/brand/icon-512.png', '/brand/og-default.png',
];
const assetFailures = [];
for (const path of ASSETS) {
  const res = await get(path);
  if (!res.ok || res.status >= 400) assetFailures.push(`${path} → ${res.ok ? res.status : res.error}`);
}
if (assetFailures.length === 0) pass('icons and social preview present', `${ASSETS.length} files`);
else fail('icons and social preview present', assetFailures.join(' · '));

/* ── 5. Security ─────────────────────────────────────────────────────────── */

section('Security');
const cronNoKey = await get('/api/cron/drain');
if (cronNoKey.status === 401) pass('cron refuses without a key');
else fail('cron refuses without a key', `HTTP ${cronNoKey.status}`);

const cronWrongKey = await get('/api/cron/drain', { headers: { authorization: 'Bearer wrong-key-for-verification' } });
if (cronWrongKey.status === 401) pass('cron refuses a wrong key');
else fail('cron refuses a wrong key', `HTTP ${cronWrongKey.status}`);

if (key !== null) {
  const unknownJob = await get('/api/cron/__does_not_exist__', { headers: { authorization: `Bearer ${key}` } });
  if (unknownJob.status === 404) pass('cron hides which jobs exist', 'unknown job → 404, not 400');
  else warn('cron hides which jobs exist', `HTTP ${unknownJob.status}`);
}

const forgedFile = await get('/api/files/private/receipts/2026/01/forged-does-not-exist.webp');
if (forgedFile.status === 404) pass('file gateway gives no existence oracle', 'forged key → 404');
else fail('file gateway gives no existence oracle', `HTTP ${forgedFile.status}`);

const home = await get('/fr');
const expectHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};
const headerProblems = Object.entries(expectHeaders)
  .filter(([name, value]) => (home.headers.get(name) ?? '').toLowerCase() !== value.toLowerCase())
  .map(([name, value]) => `${name} should be ${value}, got ${home.headers.get(name) ?? '(absent)'}`);
if (headerProblems.length === 0) pass('security headers present');
else fail('security headers present', headerProblems.join(' · '));

if (base.startsWith('https://')) {
  const hsts = home.headers.get('strict-transport-security');
  if (hsts) pass('HSTS set', hsts);
  else warn('HSTS set', 'absent — expected on an https deployment');
}
if (home.headers.get('x-powered-by')) fail('x-powered-by hidden', home.headers.get('x-powered-by'));
else pass('x-powered-by hidden');

/* ── 6. Rendering ────────────────────────────────────────────────────────── */

section('Rendering');
const LOCALES = { fr: 'ltr', ar: 'rtl', en: 'ltr', es: 'ltr' };
const langProblems = [];
for (const [locale, dir] of Object.entries(LOCALES)) {
  const res = await get(`/${locale}`);
  const html = res.text.slice(0, 2000);
  // A region subtag is correct, not a miss: fr and ar are served as fr-MA and
  // ar-MA, which is what a Moroccan centre should declare.
  if (!new RegExp(`lang=["']${locale}(?:-[A-Za-z]{2})?["']`, 'u').test(html)) langProblems.push(`/${locale} missing lang="${locale}"`);
  if (!new RegExp(`dir=["']${dir}["']`, 'u').test(html)) langProblems.push(`/${locale} missing dir="${dir}"`);
}
if (langProblems.length === 0) pass('each locale declares its language and direction');
else fail('each locale declares its language and direction', langProblems.join(' · '));

const RAW_KEY = /\b(?:common|nav|footer|home|auth|student|admin|catalog|course|pages|legal|enrollment|errors)\.[a-z][\w]*(?:\.[\w]+)+/gu;
const visible = home.text.replace(/<script[\s\S]*?<\/script>/gu, ' ').replace(/<[^>]+>/gu, ' ');
const rawKeys = [...new Set([...visible.matchAll(RAW_KEY)].map((m) => m[0]))]
  .filter((k) => !/\.(ma|com|fr|org|net|io|png|jpg|webp|svg|ico|json)$/iu.test(k));
if (rawKeys.length === 0) pass('no untranslated keys on the homepage');
else fail('no untranslated keys on the homepage', rawKeys.slice(0, 6).join(', '));

const cacheControl = home.headers.get('cache-control') ?? '';
if (cacheControl.includes('no-store'))
  warn('homepage is cacheable', `Cache-Control: ${cacheControl} — the page is rendering per request`);
else pass('homepage is cacheable', cacheControl || '(none)');

/* ── Verdict ─────────────────────────────────────────────────────────────── */

const failures = results.filter((r) => r.level === 'fail');
const warnings = results.filter((r) => r.level === 'warn');
console.log(
  `\n${failures.length === 0 ? GREEN : RED}${results.filter((r) => r.level === 'pass').length} passed, ` +
    `${warnings.length} warning(s), ${failures.length} failure(s)${RESET}  ${DIM}${base}${RESET}`,
);
if (failures.length > 0) {
  console.log(`\n${RED}Deployment is NOT healthy:${RESET}`);
  for (const f of failures) console.log(`  · ${f.name} — ${f.detail ?? ''}`);
}
process.exit(failures.length === 0 ? 0 : 1);
