/**
 * Host half of the usage popup.
 *
 * The Web page asks one route for a single JSON summary; everything that needs
 * credentials or the loopback network stays on this side:
 *  - Codex: the OAuth access token from the subscriptions store and its usage
 *    endpoint, which reports the two rolling quota windows.
 *  - Gemini Web: the local proxy's health document (Google exposes no quota API
 *    for the web subscription).
 *  - DeepSeek: the platform balance for the configured API key.
 *  - All three: token and request counts replayed from this Harness home's own
 *    session logs, so "usage" means the same thing for every provider.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';

const ROUTE = '/usage-popup';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
/** Freshness window shared by every visitor of the popup. */
const DEFAULT_CACHE_TTL_MS = 20_000;
/** How far back the local replay reads session logs. */
const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Fixed offset of Asia/Seoul, the account's wall clock; no DST there. */
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Provider registry keys → the popup card each one feeds. Gemini is served by
 * one provider id; only the ones the popup shows are replayed.
 */
const TRACKED = {
  'codex-oauth': 'codex',
  'gemini-web': 'gemini',
  'deepseek-official': 'deepseek',
};

const unzip = promisify(zstdDecompress);

function settingsOf(raw = {}) {
  const home = raw.dshHome || process.env.DSH_HOME || '~/.dsh';
  const positive = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
  return {
    codexCredentialPath: raw.codexCredentialPath || join(home, 'subscriptions', 'codex-oauth.json'),
    sessionsRoot: raw.sessionsRoot || join(home, 'sessions'),
    codexUsageUrl: raw.codexUsageUrl || 'https://chatgpt.com/backend-api/wham/usage',
    deepseekBalanceUrl: raw.deepseekBalanceUrl || 'https://api.deepseek.com/user/balance',
    geminiHealthUrl: raw.geminiHealthUrl || 'http://127.0.0.1:18089/health',
    deepseekKeyRef: raw.deepseekKeyRef || 'DEEPSEEK_API_KEY',
    requestTimeoutMs: positive(raw.requestTimeoutMs, 9_000),
    cacheTtlMs: positive(raw.cacheTtlMs, DEFAULT_CACHE_TTL_MS),
    lookbackMs: positive(raw.lookbackMs, DEFAULT_LOOKBACK_MS),
  };
}

function withTimeout(settings) {
  return AbortSignal.timeout(settings.requestTimeoutMs);
}

async function getJson(url, init, settings) {
  const response = await fetch(url, { ...init, signal: withTimeout(settings) });
  if (!response.ok) {
    const failure = new Error(`http ${response.status}`);
    failure.status = response.status;
    throw failure;
  }
  return response.json();
}

/** Start of "today" on the Asia/Seoul wall clock, expressed as an epoch ms. */
function startOfToday(now) {
  const shifted = new Date(now + SEOUL_OFFSET_MS);
  const midnightUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return midnightUtc - SEOUL_OFFSET_MS;
}

function failureCode(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (Number.isFinite(status)) return `http-${status}`;
  return 'unreachable';
}

async function collectCodex(settings) {
  let credential;
  try {
    credential = JSON.parse(await readFile(settings.codexCredentialPath, 'utf8'))?.credential;
  } catch {
    return { state: 'error', code: 'no-credential' };
  }
  if (!credential?.access || !credential?.accountId) return { state: 'error', code: 'no-credential' };

  const headers = {
    authorization: `Bearer ${credential.access}`,
    'chatgpt-account-id': credential.accountId,
    originator: 'codex_cli_rs',
    'user-agent': 'codex_cli_rs/0.50.0',
    accept: 'application/json',
  };
  const expiresAt = Number(credential.expires) || undefined;
  const identity = { email: credential.email ?? null, expiresAt };

  try {
    const body = await getJson(settings.codexUsageUrl, { headers }, settings);
    const limit = body?.rate_limit ?? {};
    const windows = [limit.primary_window, limit.secondary_window]
      .filter((window) => window && Number.isFinite(Number(window.used_percent)))
      .map((window) => ({
        usedPercent: Math.max(0, Math.min(100, Math.round(Number(window.used_percent)))),
        limitSeconds: Number(window.limit_window_seconds) || null,
        resetAt: Number(window.reset_at) || null,
        resetAfterSeconds: Number(window.reset_after_seconds) || null,
      }));
    return {
      state: 'ok',
      plan: body?.plan_type ?? null,
      limitReached: limit.limit_reached === true,
      windows,
      ...identity,
    };
  } catch (error) {
    return { state: 'error', code: failureCode(error), ...identity };
  }
}

async function collectGemini(settings) {
  try {
    const body = await getJson(settings.geminiHealthUrl, {}, settings);
    return {
      state: body?.status === 'ready' ? 'ok' : 'error',
      status: body?.status ?? 'unknown',
      stage: body?.stage ?? null,
      sessions: Number(body?.sessions) || 0,
      ...(body?.status === 'ready' ? {} : { code: body?.error ? 'proxy-error' : 'initializing' }),
    };
  } catch {
    return { state: 'error', code: 'unreachable' };
  }
}

async function collectDeepSeek(ctx, settings) {
  let key;
  try {
    key = (await ctx.get('credentials')?.resolve?.(settings.deepseekKeyRef))?.value;
  } catch {
    key = undefined;
  }
  if (!key) return { state: 'error', code: 'no-key' };
  try {
    const body = await getJson(
      settings.deepseekBalanceUrl,
      { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } },
      settings,
    );
    const balances = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
    const picked = balances.find((entry) => entry?.currency === 'CNY') ?? balances[0] ?? null;
    return {
      state: 'ok',
      available: body?.is_available !== false,
      currency: picked?.currency ?? null,
      total: picked?.total_balance ?? null,
      granted: picked?.granted_balance ?? null,
      toppedUp: picked?.topped_up_balance ?? null,
    };
  } catch (error) {
    return { state: 'error', code: failureCode(error) };
  }
}

async function listSessionLogs(root, since) {
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
      } else if (entry.isFile() && entry.name.startsWith('session.') && entry.name.endsWith('.jsonl.zstd')) {
        found.push(path);
      }
    }
  };
  await walk(root, 0);
  const recent = [];
  await Promise.all(
    found.map(async (path) => {
      try {
        const info = await stat(path);
        if (info.mtimeMs >= since) recent.push(path);
      } catch {
        /* a log disappearing mid-scan is not an error */
      }
    }),
  );
  return recent;
}

function emptyBucket() {
  return { requests: 0, input: 0, output: 0, total: 0 };
}

/**
 * Replays assistant-message usage out of this home's own session logs. Only
 * messages stamped inside the lookback window are read, and the totals are
 * split into today and the trailing week per provider.
 */
async function collectLocalUsage(settings) {
  const now = Date.now();
  const todayStart = startOfToday(now);
  const weekStart = todayStart - 6 * DAY_MS;
  const local = {};
  for (const provider of Object.keys(TRACKED)) {
    local[provider] = { today: emptyBucket(), week: emptyBucket() };
  }

  const files = await listSessionLogs(settings.sessionsRoot, weekStart);
  for (const file of files) {
    let text;
    try {
      text = (await unzip(await readFile(file))).toString('utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type !== 'assistant/message') continue;
      const provider = event.data?.message?.source?.provider;
      const bucket = local[provider];
      if (bucket === undefined) continue;
      const time = Number(event.time);
      if (!Number.isFinite(time) || time < weekStart) continue;
      const usage = event.data?.usage ?? {};
      const input = Number(usage.inputTokens) || 0;
      const output = Number(usage.outputTokens) || 0;
      const total = Number(usage.totalTokens) || input + output;
      bucket.week.requests += 1;
      bucket.week.input += input;
      bucket.week.output += output;
      bucket.week.total += total;
      if (time >= todayStart) {
        bucket.today.requests += 1;
        bucket.today.input += input;
        bucket.today.output += output;
        bucket.today.total += total;
      }
    }
  }

  const byCard = {};
  for (const [provider, card] of Object.entries(TRACKED)) {
    byCard[card] = local[provider];
  }
  return { todayStart, weekStart, byCard };
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function buildSummary(ctx, settings) {
  const [local, codex, gemini, deepseek] = await Promise.all([
    settle(collectLocalUsage(settings)),
    settle(collectCodex(settings)),
    settle(collectGemini(settings)),
    settle(collectDeepSeek(ctx, settings)),
  ]);

  const replay = local.ok ? local.value.byCard : null;
  const attach = (card, settled) => {
    const body = settled.ok ? settled.value : { state: 'error', code: 'unreachable' };
    return { ...body, local: replay?.[card] ?? null };
  };

  return {
    generatedAt: Date.now(),
    timeZone: 'Asia/Seoul',
    codex: attach('codex', codex),
    gemini: attach('gemini', gemini),
    deepseek: attach('deepseek', deepseek),
  };
}

function createSummarySource(ctx, settings) {
  let cached = null;
  let pending = null;
  return function summary(fresh) {
    if (!fresh && cached !== null && Date.now() - cached.at < settings.cacheTtlMs) {
      return Promise.resolve(cached.value);
    }
    if (pending === null) {
      pending = buildSummary(ctx, settings).then(
        (value) => {
          cached = { at: Date.now(), value };
          pending = null;
          return value;
        },
        (error) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  };
}

function createHandler(summary, connection) {
  return async (request, response) => {
    // A bare Web route sits outside Connection's gate, so apply its Host and
    // signed-cookie checks here: the summary names accounts and balances.
    const rejection = connection?.requestRejection?.({ headers: request.headers });
    if (rejection !== undefined) {
      response.writeHead(rejection, JSON_HEADERS);
      response.end();
      return;
    }
    let url;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      response.writeHead(400, JSON_HEADERS);
      response.end(JSON.stringify({ error: 'bad-request' }));
      return;
    }
    if (url.pathname !== `${ROUTE}/summary`) {
      response.writeHead(404, JSON_HEADERS);
      response.end(JSON.stringify({ error: 'not-found' }));
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...JSON_HEADERS, allow: 'GET, HEAD' });
      response.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }
    try {
      const body = await summary(url.searchParams.get('fresh') === '1');
      response.writeHead(200, JSON_HEADERS);
      response.end(JSON.stringify(body));
    } catch {
      response.writeHead(500, JSON_HEADERS);
      response.end(JSON.stringify({ error: 'summary-failed' }));
    }
  };
}

export const name = 'usage-popup';
export const inject = ['webServer'];

export function apply(ctx, config) {
  const settings = settingsOf(config ?? {});
  const summary = createSummarySource(ctx, settings);
  const connection = ctx.get('connection');
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: createHandler(summary, connection) }),
    'usage-popup: summary route',
  );
}

/** Test seams. */
export const internals = { settingsOf, startOfToday, collectLocalUsage, buildSummary, createHandler };
