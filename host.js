/**
 * Host half of the usage popup.
 *
 * The Web page asks one route for a single JSON summary; everything that needs
 * credentials or the loopback network stays on this side:
 *  - Codex: the OAuth access token from the subscriptions store and its usage
 *    endpoint, which reports the two rolling quota windows.
 *  - Gemini Web: the proxy's health document for liveness and the signed-in
 *    browser's own https://gemini.google.com/usage page for the two limits.
 *  - DeepSeek: the platform balance for the configured API key.
 *  - OpenRouter: the key's own budget document plus the account credits behind it.
 *  - OpenGateway: the public model catalogue, whose per-token prices turn this
 *    home's own token counts into money. OpenGateway publishes no balance
 *    endpoint, so a remaining figure needs a configured budget (see below).
 *  - All of them: token and request counts replayed from this Harness home's own
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
/** The window a monthly budget needs; only requested when one is configured. */
const MONTH_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1000;
/** Fixed offset of Asia/Seoul, the account's wall clock; no DST there. */
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A request that carries more than its model's long-context threshold of total
 * input tokens is billed from that model's band price, and the band price
 * replaces the running price for the whole request — in, out and cached alike.
 * The threshold and the band rates are per model and only the price table
 * (https://opengateway.ai/api/model-prices) publishes them, so the replay counts
 * crossing tokens against every threshold the catalogue is known to use and
 * `bucketCost` picks the model's own one when the price table arrives.
 */
const BAND_THRESHOLDS = [100_000, 200_000, 256_000, 272_000, 512_000];

/**
 * Provider registry keys → the popup card each one feeds. Gemini is served by
 * one provider id; only the ones the popup shows are replayed.
 */
const TRACKED = {
  'codex-oauth': 'codex',
  'gemini-web': 'gemini',
  'deepseek-official': 'deepseek',
  'openrouter-preset': 'openrouter',
  opengateway: 'opengateway',
};

const unzip = promisify(zstdDecompress);

function settingsOf(raw = {}) {
  const home = raw.dshHome || process.env.DSH_HOME || '~/.dsh';
  const positive = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
  const period = raw.opengatewayBudgetPeriod;
  // A monthly budget needs a month of history to be meaningful, and the replay
  // is the expensive half of this route, so widen the window only when asked.
  const budgetPeriod = ['daily', 'weekly', 'monthly'].includes(period) ? period : 'monthly';
  const budget = positive(raw.opengatewayBudget, null);
  const baseLookback = positive(raw.lookbackMs, DEFAULT_LOOKBACK_MS);
  const lookbackMs = budget !== null && budgetPeriod === 'monthly'
    ? Math.max(baseLookback, MONTH_LOOKBACK_MS)
    : baseLookback;
  return {
    codexCredentialPath: raw.codexCredentialPath || join(home, 'subscriptions', 'codex-oauth.json'),
    sessionsRoot: raw.sessionsRoot || join(home, 'sessions'),
    codexUsageUrl: raw.codexUsageUrl || 'https://chatgpt.com/backend-api/wham/usage',
    deepseekBalanceUrl: raw.deepseekBalanceUrl || 'https://api.deepseek.com/user/balance',
    geminiHealthUrl: raw.geminiHealthUrl || 'http://127.0.0.1:18089/health',
    geminiUsageUrl: raw.geminiUsageUrl || 'http://127.0.0.1:18089/v1/usage',
    geminiTokenPath: raw.geminiTokenPath || join(home, 'integrations', 'gemini-web', 'proxy.token'),
    deepseekKeyRef: raw.deepseekKeyRef || 'DEEPSEEK_API_KEY',
    openrouterKeyRef: raw.openrouterKeyRef || 'OPENROUTER_PRESET_API_KEY',
    openrouterKeyUrl: raw.openrouterKeyUrl || 'https://openrouter.ai/api/v1/key',
    openrouterCreditsUrl: raw.openrouterCreditsUrl || 'https://openrouter.ai/api/v1/credits',
    opengatewayModelsUrl: raw.opengatewayModelsUrl || 'https://apis.opengateway.ai/v1/models',
    opengatewayPricesUrl: raw.opengatewayPricesUrl || 'https://opengateway.ai/api/model-prices',
    // That table is a megabyte of unscheduled JSON with `cache-control: no-store`,
    // and the prices it carries move at the top of an hour, so it is refetched far
    // less often than the summary around it.
    opengatewayPricesTtlMs: positive(raw.opengatewayPricesTtlMs, 30 * 60 * 1000),
    opengatewayBudget: budget,
    opengatewayBudgetPeriod: budgetPeriod,
    geminiTimeoutMs: positive(raw.geminiTimeoutMs, 30_000),
    requestTimeoutMs: positive(raw.requestTimeoutMs, 9_000),
    cacheTtlMs: positive(raw.cacheTtlMs, DEFAULT_CACHE_TTL_MS),
    lookbackMs,
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

/** Percent glyph lines on the usage page: "27% 사용됨", "1% used". */
const PERCENT_LINE = /^(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:사용됨|사용|used)?$/i;
/** Reset sentence: "오전 12:04에 초기화", "Resets at 12:04 AM". */
const RESET_LINE = /(초기화|resets?\b|reset at)/i;
const RESET_TAIL = /\s*(?:에\s*)?(?:초기화|resets?|reset at)\s*$/i;
/** Plan badges printed above the limits. */
const PLAN_LABELS = ['AI Ultra', 'AI Pro', 'AI Premium', 'Ultra', 'Pro', 'Plus', 'Business', 'Enterprise', 'Free'];
/** Lines that are page chrome rather than a window label. */
const LABEL_NOISE = new Set(['info', 'i']);

/** Strip the "resets at" tail so the value reads as a wall-clock time. */
function resetOf(line) {
  return String(line ?? '').replace(RESET_TAIL, '').trim() || null;
}

/**
 * Read the two limits out of https://gemini.google.com/usage text. The page is
 * localized and its markup is Google's, so parse by text shape: a percent line
 * borrows the nearest preceding label and the following reset sentence.
 */
function parseGeminiUsage(lines) {
  const text = (Array.isArray(lines) ? lines : []).map((line) => String(line ?? '').trim()).filter(Boolean);
  const windows = [];
  for (const [index, line] of text.entries()) {
    const match = PERCENT_LINE.exec(line);
    if (!match) continue;
    let label = null;
    for (let back = index - 1; back >= 0 && back >= index - 4; back -= 1) {
      const candidate = text[back];
      if (LABEL_NOISE.has(candidate.toLowerCase())) continue;
      // A reset sentence and another percent line sit between the label and
      // its number, so neither can name this window.
      if (RESET_LINE.test(candidate) || PERCENT_LINE.test(candidate)) continue;
      label = candidate;
      break;
    }
    // Weekly limits print the reset sentence above the number; daily ones below.
    let resetText = null;
    for (let ahead = index + 1; ahead < Math.min(text.length, index + 4); ahead += 1) {
      if (RESET_LINE.test(text[ahead])) {
        resetText = resetOf(text[ahead]);
        break;
      }
    }
    if (resetText === null) {
      for (let back = index - 1; back >= 0 && back >= index - 4; back -= 1) {
        if (RESET_LINE.test(text[back])) {
          resetText = resetOf(text[back]);
          break;
        }
      }
    }
    windows.push({
      label,
      usedPercent: Math.max(0, Math.min(100, Number(match[1].replace(',', '.')))),
      resetText,
    });
  }

  const planIndex = text.findIndex((line) => PLAN_LABELS.includes(line));
  const plan = planIndex === -1 ? null : text[planIndex];
  const account = planIndex > 0 && text[planIndex - 1].length <= 60 && !/[:%]/.test(text[planIndex - 1])
    ? text[planIndex - 1]
    : null;
  const updatedText = text.find((line) => /(업데이트됨|updated)/i.test(line) && line.length <= 40) ?? null;
  const upsell = text.find((line) => /^(AI Ultra|AI Pro).*(늘리기|upgrade)|^(AI Ultra|AI Pro).*(배로|5x)/i.test(line)) ?? null;

  return {
    plan,
    account,
    updatedText,
    upsell,
    windows,
    raw: windows.length === 0 ? text.slice(0, 20) : undefined,
  };
}

async function readProxyToken(settings) {
  try {
    const token = (await readFile(settings.geminiTokenPath, 'utf8')).trim();
    return token || null;
  } catch {
    return null;
  }
}

async function collectGemini(settings, fresh = false) {
  let health = null;
  try {
    health = await getJson(settings.geminiHealthUrl, {}, settings);
  } catch {
    health = null;
  }
  const proxy = {
    status: health?.status ?? 'unknown',
    stage: health?.stage ?? null,
    sessions: Number(health?.sessions) || 0,
  };
  if (health === null) return { state: 'error', code: 'unreachable', ...proxy };
  if (health.status !== 'ready') {
    return { state: 'error', code: health.error ? 'proxy-error' : 'initializing', ...proxy };
  }

  // The usage page needs the proxy's bearer token; it is loopback-only.
  const token = await readProxyToken(settings);
  if (token === null) return { state: 'error', code: 'no-token', ...proxy };
  try {
    const body = await getJson(
      fresh ? `${settings.geminiUsageUrl}?fresh=1` : settings.geminiUsageUrl,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      { ...settings, requestTimeoutMs: settings.geminiTimeoutMs },
    );
    if (body?.signedIn !== true) return { state: 'error', code: 'no-login', ...proxy };
    const parsed = parseGeminiUsage(body?.lines);
    if (parsed.windows.length === 0) return { state: 'error', code: 'no-limits', ...proxy, ...parsed };
    return { state: 'ok', ...proxy, ...parsed };
  } catch (error) {
    return { state: 'error', code: failureCode(error), ...proxy };
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

/**
 * OpenRouter reports the key's own budget on every call, so the limit is read
 * from the response rather than configured: a key can be re-capped or reset
 * between two refreshes and the card must follow it.
 */
async function collectOpenRouter(ctx, settings) {
  let key;
  try {
    key = (await ctx.get('credentials')?.resolve?.(settings.openrouterKeyRef))?.value;
  } catch {
    key = undefined;
  }
  if (!key) return { state: 'error', code: 'no-key' };
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' };
  try {
    const body = await getJson(settings.openrouterKeyUrl, { headers }, settings);
    const data = body?.data ?? {};
    const budget = Array.isArray(data.budgets) ? data.budgets[0] : null;
    const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const limit = number(data.limit) ?? number(budget?.limit_usd);
    const remaining = number(data.limit_remaining) ?? number(budget?.remaining_usd);
    let credits = null;
    try {
      const creditBody = await getJson(settings.openrouterCreditsUrl, { headers }, settings);
      credits = {
        total: number(creditBody?.data?.total_credits),
        used: number(creditBody?.data?.total_usage),
      };
    } catch {
      // Account credits are a secondary figure; a failure here must not hide
      // the key budget the card is really about.
      credits = null;
    }
    return {
      state: 'ok',
      limit,
      remaining,
      resetsAt: budget?.resets_at ?? null,
      limitReset: data.limit_reset ?? budget?.reset_interval ?? null,
      usage: number(data.usage),
      usageDaily: number(data.usage_daily),
      usageWeekly: number(data.usage_weekly),
      isFreeTier: data.is_free_tier === true,
      credits,
    };
  } catch (error) {
    return { state: 'error', code: failureCode(error) };
  }
}

/**
 * Per-token prices from the public model catalogue.
 *
 * `GET /v1/models` needs no credentials, and its `pricing` block is quoted per
 * token after the time-based discount that is currently running, so it is the
 * only honest way to price this home's own token counts. The catalogue also
 * carries the scheduled change, which the card shows as a countdown when it is
 * close enough to matter.
 */
async function collectOpenGatewayPricing(settings) {
  try {
    const [body, table] = await Promise.all([
      getJson(settings.opengatewayModelsUrl, { headers: { accept: 'application/json' } }, settings),
      collectOpenGatewayPriceTable(settings),
    ]);
    const models = Array.isArray(body?.data) ? body.data : [];
    const price = {};
    const listed = [];
    for (const model of models) {
      const entry = model?.pricing;
      if (!model?.id || !entry) continue;
      const prompt = Number(entry.prompt);
      const completion = Number(entry.completion);
      if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue;
      const cacheRead = Number(entry.input_cache_read);
      // The catalogue prices the running window; the price table adds the band
      // that replaces those rates above its threshold, and the forward schedule.
      const enriched = table?.[model.id] ?? null;
      price[model.id] = {
        prompt,
        completion,
        cacheRead: Number.isFinite(cacheRead) ? cacheRead : null,
        band: enriched?.band ?? null,
      };
      listed.push({
        id: model.id,
        prompt,
        completion,
        cacheRead: price[model.id].cacheRead,
        discountPercent: Number.isFinite(Number(entry.discount_percent)) ? Number(entry.discount_percent) : null,
        // When the running discount ends; the card counts down to it because the
        // same tokens cost more afterwards.
        until: typeof entry.until === 'string' ? entry.until : null,
        // The next scheduled slot, when the catalogue publishes one. UltraFast
        // prices move in fixed windows, so the next rate says what the same work
        // will cost a few hours from now.
        nextAt: typeof entry.next?.at === 'string' ? entry.next.at : null,
        nextPrompt: Number.isFinite(Number(entry.next?.prompt)) ? Number(entry.next.prompt) : null,
        nextCompletion: Number.isFinite(Number(entry.next?.completion)) ? Number(entry.next.completion) : null,
        nextDiscountPercent: Number.isFinite(Number(entry.next?.discount_percent))
          ? Number(entry.next.discount_percent)
          : null,
        band: price[model.id].band,
        // Every published window ahead of now, oldest first, so the card can list
        // the day's tariffs instead of only the next change.
        timeline: enriched?.timeline ?? [],
      });
    }
    return { state: 'ok', price, listed };
  } catch (error) {
    return { state: 'error', code: failureCode(error), price: {}, listed: [] };
  }
}

/**
 * The band table and forward schedule, indexed by both ids a model answers to.
 *
 * `/api/model-prices` is the table the console and the promo page read. It is a
 * megabyte that the server neither compresses nor caches, so it lives behind a
 * module-level cache measured in tens of minutes; a failed read falls back to no
 * enrichment rather than losing the card, and backs off for a minute so a broken
 * network is not hammered once per summary.
 */
let priceTableCache = { at: 0, value: null };

async function collectOpenGatewayPriceTable(settings) {
  const now = Date.now();
  const age = now - priceTableCache.at;
  const fresh = priceTableCache.value === null ? age < 60_000 : age < settings.opengatewayPricesTtlMs;
  if (fresh) return priceTableCache.value;
  try {
    const body = await getJson(settings.opengatewayPricesUrl, { headers: { accept: 'application/json' } }, settings);
    const index = {};
    for (const entry of Object.values(body?.entries ?? {})) {
      const band = bandOfPriceEntry(entry);
      const timeline = timelineOfPriceEntry(entry);
      if (band === null && timeline.length === 0) continue;
      const value = { band, timeline };
      if (typeof entry?.modelOwner === 'string' && typeof entry?.modelName === 'string') {
        // The chat catalogue names a model owner-first; this table is keyed by the
        // serving provider, so both spellings have to resolve.
        index[`${entry.modelOwner}/${entry.modelName}`] ??= value;
      }
      if (typeof entry?.provider === 'string' && typeof entry?.modelName === 'string') {
        index[`${entry.provider}/${entry.modelName}`] ??= value;
      }
    }
    priceTableCache = { at: now, value: index };
    return index;
  } catch {
    priceTableCache = { at: now, value: null };
    return null;
  }
}

/** The per-model long-context band, or null when the model has none. */
function bandOfPriceEntry(entry) {
  // The band is published twice: once at list price and again inside the running
  // window at the price actually being charged. The running one is the rate these
  // tokens are billed at, so it is preferred and the list band is the fallback.
  return bandFromAxes(entry?.pricing?.current?.effectivePrice?.axisPrices)
    ?? bandFromAxes(entry?.pricing?.current?.axisPrices)
    ?? bandFromAxes(entry?.axisPrices);
}

function bandFromAxes(axes) {
  if (!axes || typeof axes !== 'object') return null;
  for (const [key, axis] of Object.entries(axes)) {
    const threshold = Number(/threshold=(\d+)/.exec(key)?.[1]);
    const prompt = Number(axis?.input);
    if (!Number.isFinite(threshold) || !Number.isFinite(prompt)) continue;
    const completion = Number(axis?.output);
    const cacheRead = Number(axis?.cacheRead);
    return {
      threshold,
      // The band replaces the running price for the whole request, so a missing
      // component means "bill it at the running rate" rather than "free".
      prompt,
      completion: Number.isFinite(completion) ? completion : null,
      cacheRead: Number.isFinite(cacheRead) ? cacheRead : null,
    };
  }
  return null;
}

/** The published windows ahead of now, oldest first. */
function timelineOfPriceEntry(entry) {
  const timeline = entry?.pricing?.timeline;
  if (!Array.isArray(timeline)) return [];
  const slots = [];
  for (const slot of timeline) {
    const rates = slot?.effectivePrice;
    const prompt = Number(rates?.inputCostPerToken);
    const until = typeof slot?.until === 'string' ? slot.until : null;
    if (until === null || !Number.isFinite(prompt)) continue;
    const completion = Number(rates?.outputCostPerToken);
    const cacheRead = Number(rates?.cacheReadInputTokenCost);
    slots.push({
      until,
      prompt,
      completion: Number.isFinite(completion) ? completion : null,
      cacheRead: Number.isFinite(cacheRead) ? cacheRead : null,
    });
  }
  return slots;
}

/**
 * Dollars for one replay bucket.
 *
 * DSH's `inputTokens` already excludes cached input (total = input + cacheRead
 * + output), so the three counters map one-to-one onto the three price columns
 * rather than overlapping. Requests that crossed their model's long-context
 * threshold were counted into that threshold's band while replaying; here they
 * are lifted out of the running rate and billed at the band rate instead, for
 * all three counters, because the band price covers the whole request.
 */
function bucketCost(bucket, price) {
  if (!bucket) return null;
  let usd = 0;
  let priced = false;
  for (const [model, counts] of Object.entries(bucket.byModel)) {
    const rates = price?.[model];
    if (!rates) continue;
    const band = rates.band === null ? null : counts.bands?.[rates.band.threshold] ?? null;
    const running = band === null
      ? counts
      : {
          input: counts.input - band.input,
          output: counts.output - band.output,
          cache: counts.cache - band.cache,
        };
    usd += running.input * rates.prompt
      + running.output * rates.completion
      + running.cache * (rates.cacheRead ?? 0);
    if (band !== null) {
      usd += band.input * (rates.band.prompt ?? rates.prompt)
        + band.output * (rates.band.completion ?? rates.completion)
        + band.cache * (rates.band.cacheRead ?? rates.cacheRead ?? 0);
    }
    priced = true;
  }
  return priced ? usd : null;
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
  // `byModel` is what makes a dollar figure possible: the three counters are
  // priced at rates that differ per model, so the totals alone cannot be
  // multiplied by one price without lying.
  return { requests: 0, input: 0, output: 0, total: 0, cache: 0, byModel: {} };
}

/**
 * Replays assistant-message usage out of this home's own session logs. Only
 * messages stamped inside the lookback window are read, and the totals are
 * split into today, the trailing week, and (when the window reaches back far
 * enough) the trailing month, per provider and per model.
 */
async function collectLocalUsage(settings) {
  const now = Date.now();
  const todayStart = startOfToday(now);
  const weekStart = todayStart - 6 * DAY_MS;
  const monthStart = todayStart - 29 * DAY_MS;
  // The replay window follows the configured lookback, so a monthly budget sees
  // a month while the common case still reads only a week of logs.
  const windowStart = Math.min(weekStart, todayStart - (settings.lookbackMs - DAY_MS));
  const withMonth = windowStart <= monthStart;
  const local = {};
  for (const provider of Object.keys(TRACKED)) {
    const buckets = { today: emptyBucket(), week: emptyBucket() };
    if (withMonth) buckets.month = emptyBucket();
    local[provider] = buckets;
  }

  const files = await listSessionLogs(settings.sessionsRoot, windowStart);
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
      const source = event.data?.message?.source;
      const provider = source?.provider;
      const bucket = local[provider];
      if (bucket === undefined) continue;
      const time = Number(event.time);
      if (!Number.isFinite(time) || time < windowStart) continue;
      const usage = event.data?.usage ?? {};
      const input = Number(usage.inputTokens) || 0;
      const output = Number(usage.outputTokens) || 0;
      const cache = Number(usage.cacheReadTokens) || 0;
      const total = Number(usage.totalTokens) || input + output + cache;
      const model = typeof source?.model === 'string' ? source.model : 'unknown';
      const span = input + cache;
      const add = (target) => {
        target.requests += 1;
        target.input += input;
        target.output += output;
        target.cache += cache;
        target.total += total;
        const entry = (target.byModel[model] ??= { requests: 0, input: 0, output: 0, cache: 0, bands: {} });
        entry.requests += 1;
        entry.input += input;
        entry.output += output;
        entry.cache += cache;
        // Count the request into every band it crosses. Which one actually prices
        // it depends on its model, and that is only known once the price table
        // lands, so the whole ladder is kept.
        for (const threshold of BAND_THRESHOLDS) {
          if (span <= threshold) break;
          const band = (entry.bands[threshold] ??= { input: 0, output: 0, cache: 0 });
          band.input += input;
          band.output += output;
          band.cache += cache;
        }
      };
      add(bucket.week);
      if (time >= todayStart) add(bucket.today);
      if (bucket.month !== undefined && time >= monthStart) add(bucket.month);
    }
  }

  const byCard = {};
  for (const [provider, card] of Object.entries(TRACKED)) {
    byCard[card] = local[provider];
  }
  return { todayStart, weekStart, monthStart, withMonth, byCard };
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The OpenGateway card.
 *
 * OpenGateway exposes no balance or quota endpoint to an inference key — its
 * console reads the team quota through a control-plane route that requires a
 * Clerk session, so the number simply is not available here. What IS available
 * is the price list (public) and this home's own token counts, so the card
 * reports money spent, and reports a remaining figure only when a budget was
 * configured to measure it against.
 */
function openGatewayCard(pricing, replay, settings) {
  const bucketOf = (name) => replay?.['opengateway']?.[name] ?? null;
  const decorate = (bucket) => {
    if (bucket === null) return null;
    return { ...bucket, usd: bucketCost(bucket, pricing.price) };
  };
  const today = decorate(bucketOf('today'));
  const week = decorate(bucketOf('week'));
  const month = decorate(bucketOf('month'));

  let budget = null;
  if (settings.opengatewayBudget !== null) {
    const period = settings.opengatewayBudgetPeriod;
    const spent = (period === 'daily' ? today : period === 'weekly' ? week : month)?.usd;
    if (typeof spent === 'number') {
      budget = {
        amount: settings.opengatewayBudget,
        period,
        spent,
        remaining: Math.max(0, settings.opengatewayBudget - spent),
        // The replay prices past requests at today's rates, so the figure drifts
        // when a scheduled discount changes; the card says so rather than
        // pretending the dollars are exact.
        approximate: true,
      };
    }
  }

  // Only the models this home actually used: the public catalogue lists a
  // hundred more, and shipping them all would dwarf the rest of the summary.
  const used = new Set();
  for (const bucket of [today, week, month]) {
    for (const model of Object.keys(bucket?.byModel ?? {})) used.add(model);
  }
  const models = pricing.listed.filter((entry) => used.has(entry.id));

  const state = pricing.state === 'ok' ? 'ok' : pricing.state;
  return {
    state,
    code: pricing.code ?? null,
    today,
    week,
    month,
    budget,
    models,
    // Same shape the other cards carry: the replay buckets, so the card can show
    // request and token counts beside the money they cost.
    local: replay?.['opengateway'] ?? null,
  };
}

async function buildSummary(ctx, settings, fresh = false) {
  const [pricing, local, codex, gemini, deepseek, openrouter] = await Promise.all([
    settle(collectOpenGatewayPricing(settings)),
    settle(collectLocalUsage(settings)),
    settle(collectCodex(settings)),
    settle(collectGemini(settings, fresh)),
    settle(collectDeepSeek(ctx, settings)),
    settle(collectOpenRouter(ctx, settings)),
  ]);

  const replay = local.ok ? local.value.byCard : null;
  const attach = (card, settled) => {
    const body = settled.ok ? settled.value : { state: 'error', code: 'unreachable' };
    return { ...body, local: replay?.[card] ?? null };
  };

  const priceBody = pricing.ok ? pricing.value : { state: 'error', code: 'unreachable', price: {}, listed: [] };

  return {
    generatedAt: Date.now(),
    timeZone: 'Asia/Seoul',
    codex: attach('codex', codex),
    gemini: attach('gemini', gemini),
    deepseek: attach('deepseek', deepseek),
    openrouter: attach('openrouter', openrouter),
    opengateway: openGatewayCard(priceBody, replay, settings),
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
      pending = buildSummary(ctx, settings, fresh).then(
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
export const internals = {
  settingsOf,
  startOfToday,
  collectLocalUsage,
  collectGemini,
  collectOpenRouter,
  collectOpenGatewayPricing,
  collectOpenGatewayPriceTable,
  bandOfPriceEntry,
  timelineOfPriceEntry,
  openGatewayCard,
  bucketCost,
  parseGeminiUsage,
  buildSummary,
  createHandler,
};
