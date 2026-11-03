# dsh-usage-popup

A DSH Web plugin that shows the remaining provider limits plus this Harness's own usage, on the **Settings → Models** page.

![panel](docs/panel.txt)

One panel, three cards:

| Card | Source of the limit | What it shows |
| --- | --- | --- |
| **Codex** | `https://chatgpt.com/backend-api/wham/usage` with the OAuth access token from the subscriptions store | remaining % of the 5-hour and weekly windows, reset countdown, plan, limit-reached badge, account |
| **Gemini Web** | the local proxy's `/health` document | proxy status, open browser sessions, a note that Google exposes no quota API for the web subscription |
| **DeepSeek API** | `https://api.deepseek.com/user/balance` with the configured API key | balance, topped-up / granted split, out-of-balance badge |

Each card also carries **this Harness's own** request and token counts for today and the trailing week, replayed from `$DSH_HOME/sessions/**/session.*.jsonl.zstd` (`assistant/message` usage events), so provider quota and local consumption sit side by side.

The browser never sees tokens or API keys: it fetches one JSON summary from a Host route.

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
- Session replay runs on the Host side over zstd logs, so the numbers mean the same thing for every provider.

## Options

`host.js` reads these optional config keys (all have defaults):

| Key | Default | Meaning |
| --- | --- | --- |
| `codexCredentialPath` | `$DSH_HOME/subscriptions/codex-oauth.json` | Codex OAuth credential written by `dsh-subscriptions` |
| `codexUsageUrl` | `https://chatgpt.com/backend-api/wham/usage` | Codex quota endpoint |
| `deepseekBalanceUrl` | `https://api.deepseek.com/user/balance` | DeepSeek balance endpoint |
| `deepseekKeyRef` | `DEEPSEEK_API_KEY` | credential reference resolved through the server; the key is read with the Host permission model, never shipped |
| `geminiHealthUrl` | `http://127.0.0.1:18089/health` | Gemini Web proxy health document |
| `sessionsRoot` | `$DSH_HOME/sessions` | window for the local replay |
| `lookbackMs` | 604800000 (7 days) | replay window |
| `cacheTtlMs` | 20000 | summary cache |
| `requestTimeoutMs` | 9000 | upstream timeout |

## Requirements

- DSH with the Web profile (`dsh web`) and the `@deepseek-ai/dsh-client-ui-settings-models` package (the Models page).
- `dsh-subscriptions` for the Codex card (optional: without it the card reports "no sign-in").
- `gemini-web-proxy` on port 18089 for the Gemini card (optional).
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
