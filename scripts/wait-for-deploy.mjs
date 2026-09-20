/**
 * Wait until a given commit is the build actually running in production.
 *
 *   node scripts/wait-for-deploy.mjs https://cfi.ma <sha> [--since <iso>] [--timeout <seconds>]
 *
 * CI promotes a green commit to the `production` branch; Hostinger deploys it
 * on its own schedule. Verifying the site before the new build is live would
 * verify the OLD build and report success for the wrong thing — so this polls
 * until the new one answers.
 *
 * Two signals, because which one exists depends on how Hostinger builds:
 *   - `/api/health` → `commit`, stamped by next.config.ts from `git rev-parse`.
 *     Present when the build keeps the checkout's .git.
 *   - `/api/health?diagnose=1` → `builtAt`, stamped from the build clock, which
 *     needs CRON_SECRET. Used when `commit` is not reported: any build newer
 *     than `--since` (the moment CI promoted) is this deploy.
 *
 * Exits 0 when the build is live, 1 on timeout. On timeout it says the likely
 * reason, because "Hostinger never deployed" and "the Hostinger build failed"
 * look identical from outside.
 */

const args = process.argv.slice(2);
const base = (args[0] ?? '').replace(/\/+$/u, '');
const sha = (args[1] ?? '').trim();
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const since = flag('since') ? Date.parse(flag('since')) : Date.now();
const timeoutSec = Number(flag('timeout') ?? 1500);
const key = process.env.CRON_SECRET ?? '';
const INTERVAL_MS = 20_000;

if (!base.startsWith('http') || sha.length < 7) {
  console.error('Usage: node scripts/wait-for-deploy.mjs https://your-domain <sha> [--since iso] [--timeout seconds]');
  process.exit(2);
}

async function json(path) {
  try {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(25_000), cache: 'no-store' });
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

const deadline = Date.now() + timeoutSec * 1000;
let lastSeen = '(nothing yet)';

console.log(`Waiting for ${sha.slice(0, 12)} to be live at ${base} (timeout ${timeoutSec}s)…`);

while (Date.now() < deadline) {
  const health = await json('/api/health');
  const commit = health?.commit ?? null;

  if (commit !== null) {
    lastSeen = `commit ${commit}`;
    if (sha.startsWith(commit) || commit.startsWith(sha.slice(0, commit.length))) {
      console.log(`Live: commit ${commit}.`);
      process.exit(0);
    }
  } else if (key !== '') {
    const diagnosis = await json(`/api/health?diagnose=1&key=${encodeURIComponent(key)}`);
    const builtAt = diagnosis?.builtAt ? Date.parse(diagnosis.builtAt) : NaN;
    lastSeen = diagnosis?.builtAt ? `a build from ${diagnosis.builtAt} (no commit reported)` : 'no build identity';
    if (!Number.isNaN(builtAt) && builtAt >= since) {
      console.log(`Live: a build made at ${diagnosis.builtAt}, after this commit was promoted.`);
      process.exit(0);
    }
  } else {
    lastSeen = 'no commit reported, and no CRON_SECRET to read the build time';
  }

  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}

console.error(
  `Timed out: ${sha.slice(0, 12)} is not live after ${timeoutSec}s. Last seen: ${lastSeen}.\n` +
    'Either Hostinger is not deploying the `production` branch automatically (hPanel → ' +
    'Deployments → Settings: branch `production`, auto-deploy on), or its build failed — ' +
    'the build log in hPanel says which.',
);
process.exit(1);
