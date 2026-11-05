# dsh-usage-popup

A DSH Web plugin that shows the remaining provider limits plus this Harness's own usage, on the **Settings → Models** page, and a one-line remaining-budget bar in the left sidebar for the Session you have open.

One panel, five cards:

| Card | Source of the limit | What it shows |
| --- | --- | --- |
| **Codex** | `https://chatgpt.com/backend-api/wham/usage` with the OAuth access token from the subscriptions store | remaining % of the 5-hour and weekly windows, reset countdown, plan, limit-reached badge, account |
| **Gemini Web** | the signed-in browser's own `https://gemini.google.com/usage` page, read through the local proxy's `/v1/usage` | daily and weekly limit meters, reset times, plan and account |
| **DeepSeek API** | `https://api.deepseek.com/user/balance` with the configured API key | balance, topped-up / granted split, out-of-balance badge |
| **OpenRouter** | `https://openrouter.ai/api/v1/key` with the configured key | remaining key limit, reset countdown, spend today / this week, account credits, free-tier badge |
| **OpenGateway** | `https://apis.opengateway.ai/v1/models` (public price list) × this home's own token counts | spend today / this week / this month per used model, the current discount window, and a remaining figure only against a configured budget |

Each card also carries **this Harness's own** request and token counts for today and the trailing week, replayed from `$DSH_HOME/sessions/**/session.*.jsonl.zstd` (`assistant/message` usage events), so provider quota and local consumption sit side by side.

The browser never sees tokens or API keys: it fetches one JSON summary from a Host route.

## Sidebar bar

The sidebar widget registers on `sidebar.footer.action`, so it sits at the foot of the sidebar beside Settings. It reads the open Session's model from the `modelSelection` projection and draws the **remaining** share of that provider's budget — the same figure the matching card shows, so the bar and the panel can never disagree. The bar turns amber at 30% left and red at 10%.

The widget fetches the summary itself instead of waiting for the panel: the panel lives on the Settings page, so on the sidebar nothing would ever trigger the first read.

Three providers need a note:

- **OpenRouter** has two ceilings — the key limit and the account credits behind it. The bar shows whichever is lower, because that is what stops the next request; when the credits bind, the card says so.
- **DeepSeek** reports a balance rather than a quota, so its bar stays empty (idle tone, not red) and the label carries the amount.
- **OpenGateway** publishes no balance or quota endpoint to an inference key (its console reads team quota through a Clerk-authenticated control plane), so without a budget the bar stays empty and the label carries today's spend, tooltip included. Set `opengatewayBudget` and the bar becomes a real remaining share of that budget.

## Install

```bash
# from a DSH session, or with any tool that can reach the profile:
plugin_manager install_bundle --target github:shortstories/dsh-usage-popup
```

The bundle is added to the active Web profile's `package.json` and its `cordis.patch.yml` row is inserted automatically (`usage-popup`). To update after a push:

```bash
plugin_manager remove_bundle   --target dsh-usage-popup
plugin_manager install_bundle  --target github:shortstories/dsh-usage-popup
```

For local development, install the directory instead (`--target /path/to/dsh-usage-popup`) and edit in place; the client bundle is re-read on the next page load.

A page refresh is required after install or update: the boot manifest of the already-open page does not know the new module.

## How it works

- `host.js` (Node, Cordis plugin) registers the Web route `/usage-popup/summary`. It builds one cached summary (20 s TTL, `?fresh=1` bypasses it) and never forwards credentials to the browser.
- The route is gated with `ctx.connection.requestRejection()`: without a valid DSH browser cookie it answers `401`, so a public deployment does not leak account names or balances.
- `client.js` (browser module, `window.__ModuleLoader__`) registers a single slot entry on `settings.models.footer` and renders the panel with the shell's React. Copy is registered in the `usage-popup` locale namespace (`ko`, `en`) and falls back to `en`.
- Session replay runs on the Host side over zstd logs, so the numbers mean the same thing for every provider. The replay also keeps a per-model split, which is what lets the OpenGateway card price tokens: the three counters DSH records (`inputTokens`, `cacheReadTokens`, `outputTokens`) do not overlap, so each maps to its own rate column.
- Refresh policy: the panel reads once when it mounts, re-reads when the window regains focus or the tab becomes visible again (only if the last read is older than 15 s), and the header button forces `?fresh=1` through every cache. There is no background polling, because the Gemini card drives a real browser page.
- The sidebar bar adds one trigger: it re-reads when the open Session's turn ends, since a turn is what spends the budget. That read bypasses the 15 s staleness window but still lands on the Host's 20 s cache, so a burst of short turns costs round trips, not provider calls. An idle Session costs nothing.

## Options

`host.js` reads these optional config keys (all have defaults):

| Key | Default | Meaning |
| --- | --- | --- |
| `codexCredentialPath` | `$DSH_HOME/subscriptions/codex-oauth.json` | Codex OAuth credential written by `dsh-subscriptions` |
| `codexUsageUrl` | `https://chatgpt.com/backend-api/wham/usage` | Codex quota endpoint |
| `deepseekBalanceUrl` | `https://api.deepseek.com/user/balance` | DeepSeek balance endpoint |
| `deepseekKeyRef` | `DEEPSEEK_API_KEY` | credential reference resolved through the server; the key is read with the Host permission model, never shipped |
| `openrouterKeyRef` | `OPENROUTER_PRESET_API_KEY` | credential reference for the OpenRouter key, resolved through the server like `deepseekKeyRef` |
| `openrouterKeyUrl` | `https://openrouter.ai/api/v1/key` | key limit endpoint; the limit is read on every fetch, never cached in config |
| `openrouterCreditsUrl` | `https://openrouter.ai/api/v1/credits` | account credits endpoint, read best-effort alongside the key limit |
| `opengatewayModelsUrl` | `https://apis.opengateway.ai/v1/models` | public model catalogue; its per-token prices are what turn local token counts into money. No key is sent |
| `opengatewayBudget` | unset | a budget in dollars to measure spend against. Unset means the card reports spend only, because OpenGateway has no balance to read |
| `opengatewayBudgetPeriod` | `monthly` | which window that budget covers: `daily`, `weekly` or `monthly`. A monthly budget widens the replay to 31 days |
| `geminiHealthUrl` | `http://127.0.0.1:18089/health` | Gemini Web proxy health document |
| `geminiUsageUrl` | `http://127.0.0.1:18089/v1/usage` | usage page text read through the proxy |
| `geminiTokenPath` | `$DSH_HOME/integrations/gemini-web/proxy.token` | bearer token for that loopback route |
| `geminiTimeoutMs` | 30000 | the usage read drives a browser page, so it is slower than the JSON APIs |
| `sessionsRoot` | `$DSH_HOME/sessions` | window for the local replay |
| `lookbackMs` | 604800000 (7 days) | replay window; widened automatically to 31 days when a monthly `opengatewayBudget` is set |
| `cacheTtlMs` | 20000 | summary cache |
| `requestTimeoutMs` | 9000 | upstream timeout |

## Why OpenGateway has no balance

OpenGateway's console shows a remaining quota, but that number is behind a separate control plane: every route on it answers `401 Authentication required` to an inference key, because it expects a Clerk session token. The data plane has no balance, credit or usage endpoint either — `/v1/key`, `/v1/credits`, `/v1/usage` and their neighbours all `404`. The only quota signal an API client ever sees is the `X-OG-Budget-Warn` response header near a limit, and a `429 budget_exceeded` when one is hit.

So the card does the honest thing instead: it replays this home's own token counts and prices them against the catalogue, which is public. That gives money spent, not money left. A remaining figure appears only once you tell it what the budget is.

## Requirements

- DSH with the Web profile (`dsh web`) and the `@deepseek-ai/dsh-client-ui-settings-models` package (the Models page).
- `dsh-subscriptions` for the Codex card (optional: without it the card reports "no sign-in").
- `gemini-web-proxy` on port 18089 with `GET /v1/usage` for the Gemini card (optional). The card reads the plan's daily and weekly limits from the signed-in browser's usage page; a signed-out profile shows a sign-in hint instead.
- A `DEEPSEEK_API_KEY` credential for the DeepSeek card (optional).

Missing pieces degrade to a per-card error message; the rest of the panel keeps working.

## Layout

```
host.js              Host route + collectors + session replay
client.js            Browser module: slot registration, panel, styles, copy
cordis.patch.yml     Bundle row inserted into the profile
locale/{ko,en}.json  Plugin-manager metadata
```

## License

MIT
