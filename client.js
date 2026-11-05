/**
 * Client half of the provider usage panel.
 *
 * The panel lives on the Models settings page (`settings.models.footer`), so the
 * remaining Codex window, the Gemini proxy state and the DeepSeek balance sit
 * where models are picked instead of adding another composer button. The browser
 * asks the Host for one JSON summary; tokens and credentials never reach it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-popup',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'usage-popup';
    const ENDPOINT = '/usage-popup/summary';
    const STALE_MS = 15000;
    /** Provider id → summary card key, mirroring the Host's TRACKED table. */
    const TRACKED = {
      'codex-oauth': 'codex',
      'gemini-web': 'gemini',
      'deepseek-official': 'deepseek',
      'openrouter-preset': 'openrouter',
      opengateway: 'opengateway',
    };

    //#region texts
    const ko = {
      'panel.title': '사용량 · 남은 한도',
      'panel.subtitle': 'Codex·Gemini·DeepSeek·OpenRouter·OpenGateway의 남은 한도와 이 Harness의 사용량',
      'panel.loading': '불러오는 중…',
      'panel.retry': '다시 시도',
      'panel.refresh': '새로고침',
      'panel.error': '사용량을 불러오지 못했습니다',
      'panel.updated': '갱신 {when}',
      'panel.now': '방금',
      'panel.seconds': '{seconds}초 전',
      'panel.minutes': '{minutes}분 전',
      'panel.source': '한도는 공급자에서, 사용량은 이 Harness의 세션 기록에서 읽습니다.',
      'common.today': '오늘 {requests}회 · {tokens} 토큰',
      'common.week': '7일 {requests}회 · {tokens} 토큰',
      'codex.name': 'Codex',
      'codex.remaining': '남음 {percent}%',
      'codex.reset': '{when} 후 초기화',
      'codex.window.5h': '5시간',
      'codex.window.week': '주간',
      'codex.window.hours': '{hours}시간',
      'codex.plan': '플랜 {plan}',
      'codex.limitReached': '한도 소진',
      'gemini.name': 'Gemini Web',
      'gemini.connected': '연결됨',
      'gemini.starting': '시작 중',
      'gemini.offline': '연결 안 됨',
      'gemini.status': '프록시 상태',
      'gemini.sessions': '열린 브라우저 세션',
      'gemini.plan': '플랜 {plan}',
      'gemini.account': '계정',
      'gemini.remaining': '남음 {percent}%',
      'gemini.resetAt': '{when} 초기화',
      'gemini.limit': '한도',
      'gemini.updated': 'Google 집계 {text}',
      'gemini.upsell': '{text}',
      'gemini.raw': '한도 문구를 해석하지 못했습니다',
      'deepseek.name': 'DeepSeek API',
      'deepseek.available': '사용 가능',
      'deepseek.unavailable': '잔액 부족',
      'deepseek.balance': '잔액',
      'deepseek.credit': '충전 {amount}',
      'deepseek.granted': '보너스 {amount}',
      'openrouter.name': 'OpenRouter',
      'openrouter.remaining': '남음 {amount}',
      'openrouter.used': '사용 {amount}',
      'openrouter.reset': '{when} 후 초기화',
      'openrouter.credits': '계정 크레딧 {amount}',
      'openrouter.creditBound': '크레딧 {amount}이 먼저 소진됩니다',
      'openrouter.noLimit': '한도 없음',
      'openrouter.freeTier': '무료 티어',
      'openrouter.weekly': '주간',
      'openrouter.daily': '오늘',
      'opengateway.name': 'OpenGateway',
      'opengateway.spent': '오늘 {amount}',
      'opengateway.spentWeek': '이번 주 {amount}',
      'opengateway.spentMonth': '이번 달 {amount}',
      'opengateway.remaining': '남음 {amount}',
      'opengateway.budgetNotice': '설정된 예산 {amount} 기준 (근사치)',
      'opengateway.noBudget': '잔액 API가 없어 지출만 표시합니다',
      'opengateway.price': '{prompt} / {completion} (1M 토큰)',
      'opengateway.discount': '{percent}% 할인, {when} 종료',
      'opengateway.discountEnded': '할인이 종료되어 정가 적용 중',
      'opengateway.daily': '오늘',
      'opengateway.weekly': '이번 주',
      'opengateway.monthly': '이번 달',
      'session.model': '모델',
      'session.remaining': '남은 한도',
      'session.spent': '오늘 지출',
      'session.noBudget': '한도 정보 없음',
      'session.none': '세션 없음',
      'error.no-credential': 'Codex 로그인 정보가 없습니다',
      'error.unauthorized': '로그인이 만료되었습니다. 다시 로그인해 주세요',
      'error.rate-limited': '공급자가 요청을 제한하고 있습니다',
      'error.unreachable': '공급자에 연결하지 못했습니다',
      'error.no-key': 'DeepSeek API 키가 없습니다',
      'error.initializing': '프록시가 준비 중입니다',
      'error.proxy-error': '프록시에 오류가 있습니다',
      'error.no-login': 'Google 로그인이 필요합니다. 구독 로그인 화면에서 다시 로그인해 주세요',
      'error.no-token': 'Gemini 프록시 토큰을 읽지 못했습니다',
      'error.no-limits': '사용량 한도를 찾지 못했습니다',
      'error.generic': '상태를 확인하지 못했습니다 ({code})',
    };
    const en = {
      'panel.title': 'Usage and remaining limits',
      'panel.subtitle': 'Remaining Codex, Gemini, DeepSeek, OpenRouter and OpenGateway limits plus this Harness’s own usage',
      'panel.loading': 'Loading…',
      'panel.retry': 'Retry',
      'panel.refresh': 'Refresh',
      'panel.error': 'Could not load usage',
      'panel.updated': 'Updated {when}',
      'panel.now': 'just now',
      'panel.seconds': '{seconds}s ago',
      'panel.minutes': '{minutes}m ago',
      'panel.source': 'Limits come from each provider; usage is replayed from this Harness’s session logs.',
      'common.today': 'Today {requests} req · {tokens} tokens',
      'common.week': '7 days {requests} req · {tokens} tokens',
      'codex.name': 'Codex',
      'codex.remaining': '{percent}% left',
      'codex.reset': 'resets in {when}',
      'codex.window.5h': '5 hours',
      'codex.window.week': 'Weekly',
      'codex.window.hours': '{hours} hours',
      'codex.plan': '{plan} plan',
      'codex.limitReached': 'Limit reached',
      'gemini.name': 'Gemini Web',
      'gemini.connected': 'Connected',
      'gemini.starting': 'Starting',
      'gemini.offline': 'Disconnected',
      'gemini.status': 'Proxy status',
      'gemini.sessions': 'Open browser sessions',
      'gemini.plan': '{plan} plan',
      'gemini.account': 'Account',
      'gemini.remaining': '{percent}% left',
      'gemini.resetAt': 'resets {when}',
      'gemini.limit': 'Limit',
      'gemini.updated': 'Google counted {text}',
      'gemini.upsell': '{text}',
      'gemini.raw': 'Could not read the limit wording',
      'deepseek.name': 'DeepSeek API',
      'deepseek.available': 'Available',
      'deepseek.unavailable': 'Out of balance',
      'deepseek.balance': 'Balance',
      'deepseek.credit': '{amount} topped up',
      'deepseek.granted': '{amount} granted',
      'openrouter.name': 'OpenRouter',
      'openrouter.remaining': '{amount} left',
      'openrouter.used': '{amount} used',
      'openrouter.reset': 'resets in {when}',
      'openrouter.credits': 'Account credits {amount}',
      'openrouter.creditBound': 'Credits {amount} run out first',
      'openrouter.noLimit': 'No limit',
      'openrouter.freeTier': 'Free tier',
      'openrouter.weekly': 'Weekly',
      'openrouter.daily': 'Today',
      'opengateway.name': 'OpenGateway',
      'opengateway.spent': '{amount} today',
      'opengateway.spentWeek': '{amount} this week',
      'opengateway.spentMonth': '{amount} this month',
      'opengateway.remaining': '{amount} left',
      'opengateway.budgetNotice': 'Against a configured budget of {amount} (approximate)',
      'opengateway.noBudget': 'OpenGateway publishes no balance API, so this shows spend only',
      'opengateway.price': '{prompt} / {completion} per 1M tokens',
      'opengateway.discount': '{percent}% off, ends in {when}',
      'opengateway.discountEnded': 'Discount ended; list prices apply',
      'opengateway.daily': 'Today',
      'opengateway.weekly': 'This week',
      'opengateway.monthly': 'This month',
      'session.model': 'Model',
      'session.remaining': 'remaining',
      'session.spent': 'spent today',
      'session.noBudget': 'no budget data',
      'session.none': 'No session',
      'error.no-credential': 'No Codex sign-in was found',
      'error.unauthorized': 'The sign-in expired; sign in again',
      'error.rate-limited': 'The provider is rate limiting requests',
      'error.unreachable': 'The provider could not be reached',
      'error.no-key': 'No DeepSeek API key is configured',
      'error.initializing': 'The proxy is still starting',
      'error.proxy-error': 'The proxy reported an error',
      'error.no-login': 'Google sign-in is required; sign in again from the subscription login screen',
      'error.no-token': 'The Gemini proxy token could not be read',
      'error.no-limits': 'The usage limits were not found',
      'error.generic': 'Could not read the status ({code})',
    };
    //#endregion

    const CSS = `
.dsh-usage-block{display:flex;flex-direction:column;gap:10px;margin-top:24px}
.dsh-usage-block-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsh-usage-block-titles{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-usage-block-title{margin:0;font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.dsh-usage-block-sub{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-usage-refresh{display:inline-flex;align-items:center;gap:5px;flex:none;height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer}
.dsh-usage-refresh:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-usage-refresh:disabled{cursor:default;opacity:.55}
.dsh-usage-refresh svg{width:13px;height:13px}
.dsh-usage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px}
.dsh-usage-item{display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1)}
.dsh-usage-item-head{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-usage-name{font-size:12px;font-weight:600;line-height:16px;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dsh-usage-badge{padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:600;line-height:16px;letter-spacing:.2px;white-space:nowrap}
.dsh-usage-badge[data-tone=good]{color:var(--dsw-alias-state-success-primary)}
.dsh-usage-badge[data-tone=bad]{color:var(--dsw-alias-state-error-primary)}
.dsh-usage-meter{display:grid;grid-template-columns:56px 1fr auto;align-items:center;gap:8px;min-width:0}
.dsh-usage-meter-label{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-usage-meter-value{font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-usage-bar{height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);overflow:hidden}
.dsh-usage-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-button-primary-fill)}
.dsh-usage-fill[data-tone=warn]{background:var(--dsw-alias-state-success-primary)}
.dsh-usage-fill[data-tone=bad]{background:var(--dsw-alias-state-error-primary)}
.dsh-usage-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0;font-size:11px;line-height:16px}
.dsh-usage-row-label{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-usage-row-value{color:var(--dsw-alias-label-primary);text-align:right;font-variant-numeric:tabular-nums}
.dsh-usage-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dsh-usage-meter-note{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary)}
.dsh-usage-foot{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dsh-usage-note{margin:0;font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
.dsh-usage-state{display:flex;align-items:center;gap:8px;padding:18px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-usage-spinner{width:14px;height:14px;flex:none;border-radius:999px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);animation:dsh-usage-spin .8s linear infinite}
@keyframes dsh-usage-spin{to{transform:rotate(360deg)}}
.dsh-usage-side{display:flex;flex-direction:column;gap:2px;width:calc(100% + 4px);margin:0 -2px 4px;padding:6px 10px 6px 8px;border-radius:var(--dsw-radius-md);min-width:0;overflow:hidden}
.dsh-usage-side-head{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-usage-side-dot{width:6px;height:6px;flex:none;border-radius:999px;background:var(--dsw-alias-state-success-primary)}
.dsh-usage-side-dot[data-tone=idle]{background:var(--dsw-alias-label-tertiary)}
.dsh-usage-side-model{font-size:12px;font-weight:600;line-height:16px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dsh-usage-side-meta{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.dsh-usage-side-bar{position:relative;height:4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover-solid);overflow:hidden;margin-top:3px}
.dsh-usage-side-fill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-button-primary-fill);transition:width .3s ease}
.dsh-usage-side-fill[data-tone=warn]{background:var(--dsw-alias-state-warn-primary)}
.dsh-usage-side-fill[data-tone=bad]{background:var(--dsw-alias-state-error-primary)}
.dsh-usage-side-fill[data-tone=idle]{background:var(--dsw-alias-label-tertiary)}
`;

    //#region formatting
    const TOKEN_UNITS = [
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ];

    function formatTokens(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      for (const [scale, suffix] of TOKEN_UNITS) {
        if (n >= scale) return `${(n / scale).toFixed(n >= scale * 10 ? 0 : 1).replace(/\.0$/, '')}${suffix}`;
      }
      return String(Math.round(n));
    }

    /** Human duration for a quota reset countdown (ko/en agnostic units). */
    function formatWhen(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return t('panel.now');
      const minutes = Math.floor(ms / 60000);
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const rest = minutes % 60;
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${rest}m`;
      return `${Math.max(1, rest)}m`;
    }

    function formatAgo(ms, t) {
      if (!Number.isFinite(ms) || ms < 5000) return t('panel.now');
      const seconds = Math.floor(ms / 1000);
      if (seconds < 60) return t('panel.seconds', { seconds });
      return t('panel.minutes', { minutes: Math.floor(seconds / 60) });
    }

    function currencySymbol(currency) {
      if (currency === 'CNY') return '¥';
      if (currency === 'USD') return '$';
      return currency ? `${currency} ` : '';
    }

    function windowLabel(seconds, t) {
      if (!Number.isFinite(seconds) || seconds <= 0) return t('codex.window.week');
      if (seconds >= 518400) return t('codex.window.week');
      if (seconds === 18000) return t('codex.window.5h');
      return t('codex.window.hours', { hours: Math.round(seconds / 3600) });
    }
    //#endregion

    //#region store
    function createStore() {
      let snapshot = { loading: false, error: null, data: null, loadedAt: 0 };
      let request = 0;
      const listeners = new Set();
      const publish = (patch) => {
        snapshot = { ...snapshot, ...patch };
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.error('usage-popup: listener crashed', error);
          }
        }
      };
      const load = async (fresh) => {
        const ticket = ++request;
        publish({ loading: true, error: null });
        try {
          const response = await fetch(`${ENDPOINT}${fresh ? '?fresh=1' : ''}`, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (!response.ok) throw new Error(`http ${response.status}`);
          const data = await response.json();
          if (ticket !== request) return;
          publish({ loading: false, error: null, data, loadedAt: Date.now() });
        } catch (error) {
          if (ticket !== request) return;
          publish({ loading: false, error: error instanceof Error ? error.message : 'failed' });
        }
      };
      return {
        get: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        /**
         * Read the summary if the held copy is older than `maxAgeMs`.
         *
         * The default is the focus/visibility staleness window. A caller that
         * knows the figure just changed (a turn ended) passes 0 to re-read
         * immediately; that still lands on the Host's own cache, so it costs a
         * round trip rather than a provider call.
         */
        ensure(maxAgeMs = STALE_MS) {
          const stale = snapshot.data === null || Date.now() - snapshot.loadedAt > maxAgeMs;
          if (!snapshot.loading && (stale || snapshot.error !== null)) load(false);
        },
        refresh() {
          return load(true);
        },
      };
    }
    //#endregion

    //#region icons
    function RefreshIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.7-3.8M13 2.6V5.6h-3',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }
    //#endregion

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale');
        const t = locale ? locale.bind(NS) : (key) => key;

        if (locale) {
          ctx.effect(() => locale.register(NS, 'ko', ko), 'usage-popup: ko dictionary');
          ctx.effect(() => locale.register(NS, 'en', en), 'usage-popup: en dictionary');
        }

        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-usage-popup';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }, 'usage-popup: styles');

        const store = createStore();

        /** Re-render on store and locale changes. */
        function useSnapshot() {
          const [snapshot, setSnapshot] = React.useState(store.get);
          const [, setRevision] = React.useState(0);
          React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), []);
          React.useEffect(() => {
            if (!locale) return undefined;
            return locale.subscribe(() => setRevision((value) => value + 1));
          }, []);
          return snapshot;
        }

        function errorText(code) {
          const key = `error.${code}`;
          const text = t(key);
          return text === key ? t('error.generic', { code }) : text;
        }

        function localLine(local) {
          if (!local || !local.today || !local.week) return null;
          return h(
            'div',
            { className: 'dsh-usage-foot' },
            h('span', { className: 'dsh-usage-meta' }, t('common.today', {
              requests: local.today.requests,
              tokens: formatTokens(local.today.total),
            })),
            h('span', { className: 'dsh-usage-meta' }, t('common.week', {
              requests: local.week.requests,
              tokens: formatTokens(local.week.total),
            })),
          );
        }

        function WindowMeter({ window, now }) {
          const used = Math.max(0, Math.min(100, Number(window.usedPercent)));
          const remaining = Math.max(0, 100 - used);
          const tone = used >= 90 ? 'bad' : used >= 70 ? 'warn' : 'ok';
          const reset = Number.isFinite(window.resetAt)
            ? window.resetAt * 1000
            : Number.isFinite(window.resetAfterSeconds)
              ? now + window.resetAfterSeconds * 1000
              : null;
          return h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'dsh-usage-meter' },
              h('span', { className: 'dsh-usage-meter-label' }, windowLabel(window.limitSeconds, t)),
              h('div', { className: 'dsh-usage-bar' }, h('span', {
                className: 'dsh-usage-fill',
                'data-tone': tone,
                style: { width: `${used}%` },
              })),
              h('span', { className: 'dsh-usage-meter-value' }, t('codex.remaining', { percent: remaining })),
            ),
            reset === null
              ? null
              : h('div', { className: 'dsh-usage-meter-note' }, t('codex.reset', { when: formatWhen(reset - now, t) })),
          );
        }

        function CodexCard({ codex, now }) {
          const badges = [];
          if (codex.plan) {
            badges.push(h('span', { className: 'dsh-usage-badge', key: 'plan' }, t('codex.plan', { plan: codex.plan })));
          }
          if (codex.limitReached) {
            badges.push(h('span', { className: 'dsh-usage-badge', key: 'limit', 'data-tone': 'bad' }, t('codex.limitReached')));
          }
          const meters = [];
          if (codex.state === 'ok') {
            for (const [index, window] of (codex.windows ?? []).entries()) {
              meters.push(h(WindowMeter, { window, now, key: `window-${index}` }));
            }
          } else {
            meters.push(h('div', { className: 'dsh-usage-meta', key: 'error' }, errorText(codex.code)));
          }
          return h(
            'article',
            { className: 'dsh-usage-item' },
            h('div', { className: 'dsh-usage-item-head' },
              h('span', { className: 'dsh-usage-name' }, t('codex.name')),
              ...badges),
            ...meters,
            codex.email ? h('div', { className: 'dsh-usage-meta' }, codex.email) : null,
            localLine(codex.local),
          );
        }

        function GeminiMeter({ window }) {
          const used = Math.max(0, Math.min(100, Number(window.usedPercent)));
          const remaining = Math.max(0, 100 - used);
          const tone = used >= 90 ? 'bad' : used >= 70 ? 'warn' : 'ok';
          return h(
            React.Fragment,
            null,
            h(
              'div',
              { className: 'dsh-usage-meter' },
              h('span', { className: 'dsh-usage-meter-label' }, window.label ?? t('gemini.limit')),
              h('div', { className: 'dsh-usage-bar' }, h('span', {
                className: 'dsh-usage-fill',
                'data-tone': tone,
                style: { width: `${used}%` },
              })),
              h('span', { className: 'dsh-usage-meter-value' }, t('gemini.remaining', { percent: remaining })),
            ),
            window.resetText === null || window.resetText === undefined
              ? null
              : h('div', { className: 'dsh-usage-meter-note' }, t('gemini.resetAt', { when: window.resetText })),
          );
        }

        function GeminiCard({ gemini }) {
          const ready = gemini.state === 'ok';
          const label = ready
            ? t('gemini.connected')
            : gemini.code === 'initializing'
              ? t('gemini.starting')
              : t('gemini.offline');
          const badges = [
            h('span', { className: 'dsh-usage-badge', key: 'state', 'data-tone': ready ? 'good' : 'bad' }, label),
          ];
          if (gemini.plan) {
            badges.push(h('span', { className: 'dsh-usage-badge', key: 'plan' }, t('gemini.plan', { plan: gemini.plan })));
          }
          const body = [];
          if (ready) {
            for (const [index, window] of (gemini.windows ?? []).entries()) {
              body.push(h(GeminiMeter, { window, key: `window-${index}` }));
            }
            if (gemini.updatedText) {
              body.push(h('div', { className: 'dsh-usage-meta', key: 'updated' }, t('gemini.updated', { text: gemini.updatedText })));
            }
          } else {
            body.push(h('div', { className: 'dsh-usage-meta', key: 'error' }, errorText(gemini.code ?? 'unreachable')));
          }
          return h(
            'article',
            { className: 'dsh-usage-item' },
            h('div', { className: 'dsh-usage-item-head' },
              h('span', { className: 'dsh-usage-name' }, t('gemini.name')),
              ...badges),
            ...body,
            gemini.account
              ? h('div', { className: 'dsh-usage-row' },
                h('span', { className: 'dsh-usage-row-label' }, t('gemini.account')),
                h('span', { className: 'dsh-usage-row-value' }, gemini.account))
              : null,
            gemini.upsell ? h('div', { className: 'dsh-usage-meta' }, t('gemini.upsell', { text: gemini.upsell })) : null,
            localLine(gemini.local),
          );
        }

        function DeepSeekCard({ deepseek }) {
          const ok = deepseek.state === 'ok';
          const symbol = currencySymbol(deepseek.currency);
          const split = [];
          if (ok && deepseek.toppedUp !== null && deepseek.toppedUp !== undefined) {
            split.push(t('deepseek.credit', { amount: `${symbol}${deepseek.toppedUp}` }));
          }
          if (ok && deepseek.granted !== null && deepseek.granted !== undefined) {
            split.push(t('deepseek.granted', { amount: `${symbol}${deepseek.granted}` }));
          }
          return h(
            'article',
            { className: 'dsh-usage-item' },
            h('div', { className: 'dsh-usage-item-head' },
              h('span', { className: 'dsh-usage-name' }, t('deepseek.name')),
              ok
                ? h('span', { className: 'dsh-usage-badge', 'data-tone': deepseek.available ? 'good' : 'bad' },
                  deepseek.available ? t('deepseek.available') : t('deepseek.unavailable'))
                : null),
            ok
              ? h('div', { className: 'dsh-usage-row' },
                h('span', { className: 'dsh-usage-row-label' }, t('deepseek.balance')),
                h('span', { className: 'dsh-usage-row-value' }, `${symbol}${deepseek.total ?? '—'}`))
              : h('div', { className: 'dsh-usage-meta' }, errorText(deepseek.code)),
            split.length > 0 ? h('div', { className: 'dsh-usage-meta' }, split.join(' · ')) : null,
            localLine(deepseek.local),
          );
        }

        function money(value) {
          const n = Number(value);
          if (!Number.isFinite(n)) return '—';
          return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
        }

        /**
         * Remaining budget of the card that serves a provider, as a percentage
         * plus a ready label. Each provider reports its budget differently —
         * Codex and Gemini as a used share of a rolling window, DeepSeek as a
         * balance, OpenRouter as a key limit — so this normalises them all to
         * "how much is left", which is what the sidebar bar draws.
         */
        /**
         * The OpenRouter ceiling that actually binds, in dollars.
         *
         * A key limit and the account credits behind it are two separate ceilings,
         * and whichever is lower is what stops the next request: a $10 key limit is
         * worth nothing once the $5 of credits is spent. The card and the sidebar
         * bar both read this, so they cannot disagree.
         */
        function openRouterBudget(card) {
          const limit = Number(card.limit);
          const keyRemaining = Number(card.remaining);
          if (!Number.isFinite(limit) || !Number.isFinite(keyRemaining) || limit <= 0) return null;
          const creditTotal = Number(card.credits?.total);
          const creditUsed = Number(card.credits?.used);
          const creditRemaining = Number.isFinite(creditTotal) && Number.isFinite(creditUsed)
            ? Math.max(0, creditTotal - creditUsed)
            : null;
          const remaining = creditRemaining === null ? keyRemaining : Math.min(keyRemaining, creditRemaining);
          return { limit, keyRemaining, creditRemaining, remaining };
        }

        function remainingOf(provider, card) {
          if (!card || card.state !== 'ok') return null;
          if (provider === 'codex-oauth' || provider === 'gemini-web') {
            const window = Array.isArray(card.windows) ? card.windows[0] : null;
            if (!window || typeof window.usedPercent !== 'number') return null;
            const percent = Math.max(0, 100 - window.usedPercent);
            return { percent, label: `${Math.round(percent)}%` };
          }
          if (provider === 'deepseek-official') {
            // DeepSeek reports a balance, not a quota: there is no denominator to
            // draw a share against, so the bar stays empty and the label carries
            // the figure. A negative balance means the account is in arrears.
            const balance = Number(card.total);
            if (!Number.isFinite(balance)) return null;
            // `percent: null` keeps the bar in its idle tone: a balance has no
            // ceiling to draw a share against, and a zero-width red bar would read
            // as "exhausted" rather than "not a quota".
            return { percent: null, label: `${balance.toFixed(2)} ${card.currency ?? ''}`.trim() };
          }
          if (provider === 'openrouter-preset') {
            const budget = openRouterBudget(card);
            if (budget === null) return null;
            return { percent: (budget.remaining / budget.limit) * 100, label: money(budget.remaining) };
          }
          if (provider === 'opengateway') {
            // OpenGateway reports nothing to draw a ceiling against, so without a
            // configured budget the bar stays idle and the label carries today's
            // spend — the one number the API makes knowable.
            const budget = card.budget ?? null;
            const spent = Number(card.today?.usd);
            if (budget !== null && Number(budget.amount) > 0) {
              const amount = Number(budget.amount);
              const remaining = Math.max(0, Number(budget.remaining));
              return { percent: (remaining / amount) * 100, label: spendMoney(remaining) };
            }
            if (!Number.isFinite(spent)) return null;
            // Nothing to draw a share against, and the label is spend rather than
            // a remainder, so `kind` keeps the tooltip from calling it "remaining".
            return { percent: null, kind: 'spend', label: spendMoney(spent) };
          }
          return null;
        }

        function OpenRouterCard({ openrouter, now }) {
          const ok = openrouter.state === 'ok';
          const badges = [];
          if (ok && openrouter.isFreeTier) {
            badges.push(h('span', { className: 'dsh-usage-badge', key: 'tier' }, t('openrouter.freeTier')));
          }
          const body = [];
          if (ok) {
            const budget = openRouterBudget(openrouter);
            if (budget !== null) {
              const used = Math.max(0, Math.min(100, ((budget.limit - budget.remaining) / budget.limit) * 100));
              const tone = used >= 90 ? 'bad' : used >= 70 ? 'warn' : 'ok';
              const resetAt = openrouter.resetsAt ? Date.parse(openrouter.resetsAt) : NaN;
              body.push(h(
                'div',
                { className: 'dsh-usage-meter', key: 'meter' },
                h('span', { className: 'dsh-usage-meter-label' },
                  openrouter.limitReset === 'weekly' ? t('openrouter.weekly') : (openrouter.limitReset ?? t('openrouter.weekly'))),
                h('div', { className: 'dsh-usage-bar' }, h('span', {
                  className: 'dsh-usage-fill',
                  'data-tone': tone,
                  style: { width: `${used}%` },
                })),
                h('span', { className: 'dsh-usage-meter-value' }, t('openrouter.remaining', { amount: money(budget.remaining) })),
              ));
              if (Number.isFinite(resetAt)) {
                body.push(h('div', { className: 'dsh-usage-meter-note', key: 'reset' },
                  t('openrouter.reset', { when: formatWhen(resetAt - now, t) })));
              }
              // Name the binding ceiling when the credits, not the key limit, are
              // what runs out first — otherwise the bar looks wrong against the
              // key limit the provider reports.
              if (budget.creditRemaining !== null && budget.creditRemaining < budget.keyRemaining) {
                body.push(h('div', { className: 'dsh-usage-meter-note', key: 'binding' },
                  t('openrouter.creditBound', { amount: money(budget.creditRemaining) })));
              }
            } else {
              body.push(h('div', { className: 'dsh-usage-meta', key: 'nolimit' }, t('openrouter.noLimit')));
            }
            if (Number.isFinite(Number(openrouter.usage))) {
              body.push(h('div', { className: 'dsh-usage-row', key: 'used' },
                h('span', { className: 'dsh-usage-row-label' }, t('openrouter.used', { amount: money(openrouter.usage) })),
                Number.isFinite(Number(openrouter.usageDaily))
                  ? h('span', { className: 'dsh-usage-row-value' },
                    `${t('openrouter.daily')} ${money(openrouter.usageDaily)}`)
                  : null));
            }
            if (openrouter.credits && Number.isFinite(Number(openrouter.credits.total))) {
              body.push(h('div', { className: 'dsh-usage-meta', key: 'credits' },
                t('openrouter.credits', { amount: money(openrouter.credits.total) })));
            }
          } else {
            body.push(h('div', { className: 'dsh-usage-meta', key: 'error' }, errorText(openrouter.code ?? 'unreachable')));
          }
          return h(
            'article',
            { className: 'dsh-usage-item' },
            h('div', { className: 'dsh-usage-item-head' },
              h('span', { className: 'dsh-usage-name' }, t('openrouter.name')),
              ...badges),
            ...body,
            localLine(openrouter.local),
          );
        }

        /** A per-token rate as a per-million price, which is how prices are read. */
        function perMillion(rate) {
          const n = Number(rate);
          if (!Number.isFinite(n)) return '—';
          const per = n * 1e6;
          return `$${per >= 1 ? per.toFixed(2) : per.toFixed(3)}`;
        }

        /** Dollars at a scale where a cent of spend is still visible. */
        function spendMoney(value) {
          const n = Number(value);
          if (!Number.isFinite(n)) return '—';
          if (n === 0) return '$0.00';
          return `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
        }

        /**
         * The OpenGateway card.
         *
         * OpenGateway has no balance endpoint for an inference key, so unlike
         * OpenRouter there is no provider-reported remainder to draw. The Host
         * prices this home's own token counts against the public catalogue
         * instead, which is why the card leads with spend and only shows a bar
         * when a budget was configured to measure the spend against.
         */
        function OpenGatewayCard({ opengateway, now }) {
          const ok = opengateway.state === 'ok';
          const body = [];
          const badges = [];
          const models = Array.isArray(opengateway.models) ? opengateway.models : [];

          // The discount window is the one part of this card that is not derived
          // from local logs, so surface it: prices change when it ends.
          const discounted = models.find((model) => {
            const until = model.until ? Date.parse(model.until) : NaN;
            return Number.isFinite(Number(model.discountPercent)) && Number(until) > now;
          });
          if (discounted) {
            badges.push(h('span', { className: 'dsh-usage-badge', 'data-tone': 'good', key: 'discount' },
              `−${discounted.discountPercent}%`));
          }

          if (ok) {
            const budget = opengateway.budget ?? null;
            if (budget !== null && Number(budget.amount) > 0) {
              const amount = Number(budget.amount);
              const remaining = Math.max(0, Number(budget.remaining));
              const percent = Math.max(0, Math.min(100, (remaining / amount) * 100));
              const tone = percent <= 10 ? 'bad' : percent <= 30 ? 'warn' : 'ok';
              const period = budget.period === 'daily'
                ? t('opengateway.daily')
                : budget.period === 'weekly' ? t('opengateway.weekly') : t('opengateway.monthly');
              body.push(h(
                'div',
                { className: 'dsh-usage-meter', key: 'meter' },
                h('span', { className: 'dsh-usage-meter-label' }, period),
                h('div', { className: 'dsh-usage-bar' }, h('span', {
                  className: 'dsh-usage-fill',
                  'data-tone': tone,
                  style: { width: `${percent}%` },
                })),
                h('span', { className: 'dsh-usage-meter-value' },
                  t('opengateway.remaining', { amount: spendMoney(remaining) })),
              ));
              body.push(h('div', { className: 'dsh-usage-meter-note', key: 'budget' },
                t('opengateway.budgetNotice', { amount: spendMoney(amount) })));
            }

            const todayUsd = Number(opengateway.today?.usd);
            const weekUsd = Number(opengateway.week?.usd);
            const monthUsd = Number(opengateway.month?.usd);
            if (Number.isFinite(todayUsd)) {
              body.push(h('div', { className: 'dsh-usage-row', key: 'spend' },
                h('span', { className: 'dsh-usage-row-label' },
                  t('opengateway.spent', { amount: spendMoney(todayUsd) })),
                Number.isFinite(weekUsd) && weekUsd !== todayUsd
                  ? h('span', { className: 'dsh-usage-row-value' },
                    t('opengateway.spentWeek', { amount: spendMoney(weekUsd) }))
                  : null));
            }
            if (Number.isFinite(monthUsd) && monthUsd !== weekUsd) {
              body.push(h('div', { className: 'dsh-usage-meta', key: 'month' },
                t('opengateway.spentMonth', { amount: spendMoney(monthUsd) })));
            }
            if (budget === null) {
              body.push(h('div', { className: 'dsh-usage-meta', key: 'nobudget' }, t('opengateway.noBudget')));
            }

            for (const model of models) {
              body.push(h('div', { className: 'dsh-usage-meta', key: `price-${model.id}` },
                `${model.id} · ${t('opengateway.price', {
                  prompt: perMillion(model.prompt),
                  completion: perMillion(model.completion),
                })}`));
              const until = model.until ? Date.parse(model.until) : NaN;
              if (Number.isFinite(Number(model.discountPercent))) {
                body.push(h('div', { className: 'dsh-usage-meta', key: `discount-${model.id}` },
                  Number(until) > now
                    ? t('opengateway.discount', {
                      percent: model.discountPercent,
                      when: formatWhen(until - now, t),
                    })
                    : t('opengateway.discountEnded')));
              }
            }
          } else {
            body.push(h('div', { className: 'dsh-usage-meta', key: 'error' },
              errorText(opengateway.code ?? 'unreachable')));
          }

          return h(
            'article',
            { className: 'dsh-usage-item' },
            h('div', { className: 'dsh-usage-item-head' },
              h('span', { className: 'dsh-usage-name' }, t('opengateway.name')),
              ...badges),
            ...body,
            localLine(opengateway.local),
          );
        }

        function UsagePanel() {
          const snapshot = useSnapshot();

          React.useEffect(() => {
            store.ensure();
            // Usage moves while the panel sits open, but the browser page behind
            // the Gemini card is expensive: re-read only when the user comes back.
            const onVisible = () => {
              if (document.visibilityState === 'visible') store.ensure();
            };
            window.addEventListener('focus', onVisible);
            document.addEventListener('visibilitychange', onVisible);
            return () => {
              window.removeEventListener('focus', onVisible);
              document.removeEventListener('visibilitychange', onVisible);
            };
          }, []);

          const now = Date.now();
          const data = snapshot.data;
          let content;
          if (data === null) {
            if (snapshot.error !== null) {
              content = h('div', { className: 'dsh-usage-state' },
                h('span', null, `${t('panel.error')} (${snapshot.error})`),
                h('button', { type: 'button', className: 'dsh-usage-refresh', onClick: () => store.refresh() }, t('panel.retry')));
            } else {
              content = h('div', { className: 'dsh-usage-state' },
                h('span', { className: 'dsh-usage-spinner' }),
                h('span', null, t('panel.loading')));
            }
          } else {
            content = h('div', { className: 'dsh-usage-grid' },
              h(CodexCard, { codex: data.codex ?? {}, now }),
              h(GeminiCard, { gemini: data.gemini ?? {} }),
              h(DeepSeekCard, { deepseek: data.deepseek ?? {} }),
              h(OpenRouterCard, { openrouter: data.openrouter ?? {}, now }),
              h(OpenGatewayCard, { opengateway: data.opengateway ?? {}, now }));
          }

          return h(
            'section',
            { className: 'dsh-usage-block', 'aria-label': t('panel.title') },
            h('header', { className: 'dsh-usage-block-head' },
              h('div', { className: 'dsh-usage-block-titles' },
                h('h3', { className: 'dsh-usage-block-title' }, t('panel.title')),
                h('p', { className: 'dsh-usage-block-sub' },
                  data === null
                    ? t('panel.subtitle')
                    : t('panel.updated', { when: formatAgo(now - snapshot.loadedAt, t) }))),
              h('button', {
                type: 'button',
                className: 'dsh-usage-refresh',
                title: t('panel.refresh'),
                'aria-label': t('panel.refresh'),
                disabled: snapshot.loading,
                onClick: () => store.refresh(),
              },
              h(RefreshIcon),
              h('span', null, t('panel.refresh')))),
            content,
            data === null ? null : h('p', { className: 'dsh-usage-note' }, t('panel.source')),
          );
        }

        /**
         * The open Session is the one the main view retains; the framework's own
         * session store and DocumentTitle resolve it the same way, because no
         * public "current session" accessor exists for a root-scope slot.
         */
        /**
         * A model id trimmed for a narrow sidebar row. `deepseek/deepseek-v4.1-
         * flash-ultrafast` spends half its width repeating the vendor, so drop the
         * prefix when the name already starts with it.
         */
        function shortModel(id) {
          if (typeof id !== 'string' || id === '') return null;
          const slash = id.lastIndexOf('/');
          if (slash <= 0 || slash === id.length - 1) return id;
          const head = id.slice(0, slash);
          const tail = id.slice(slash + 1);
          return tail.startsWith(head) ? tail : id;
        }

        function useCurrentSessionId(useSessions) {
          return useSessions((state) => {
            for (const id of state.ids) {
              const row = state.byId[id];
              if (row && (row.retainedBy?.mainView ?? 0) > 0) return id;
            }
            return null;
          });
        }

        /**
         * One-line remaining-budget graph for the open Session.
         *
         * The bar shows how much of the current provider's budget is LEFT, not
         * how much is spent, because "how much can I still use" is the question
         * the sidebar answers at a glance. The figure comes from the same
         * summary the panel reads: the provider card that matches the Session's
         * model, so the bar and the card can never disagree.
         */
        function SessionUsage({ wide, useSessions }) {
          const sessionId = useCurrentSessionId(useSessions);
          const model = useSessions((state) => {
            const values = sessionId === null ? undefined : state.byId[sessionId]?.projectionValues;
            return values?.modelSelection?.next ?? values?.modelSelection?.lastUsed ?? null;
          });
          const running = useSessions((state) => (sessionId === null ? false : state.byId[sessionId]?.running === true));
          const snapshot = useSnapshot();

          // The panel is the only other reader of this store, and it lives on the
          // Settings page: without this the sidebar would render before anything
          // ever fetched, and sit on the empty state forever.
          React.useEffect(() => {
            store.ensure();
            const onVisible = () => {
              if (document.visibilityState === 'visible') store.ensure();
            };
            window.addEventListener('focus', onVisible);
            document.addEventListener('visibilitychange', onVisible);
            return () => {
              window.removeEventListener('focus', onVisible);
              document.removeEventListener('visibilitychange', onVisible);
            };
          }, []);

          // A turn is what spends the budget, so the moment one ends is the moment
          // the figure is worth re-reading. This is an event, not a poll: a Session
          // that sits idle costs nothing. The read is forced past the staleness
          // window, but it still lands on the Host's 20 s cache, so a burst of
          // short turns costs round trips rather than provider calls.
          const wasRunning = React.useRef(false);
          React.useEffect(() => {
            if (wasRunning.current && !running) store.ensure(0);
            wasRunning.current = running;
          }, [running]);

          if (!wide || sessionId === null) return null;

          const provider = model?.provider ?? null;
          const card = provider === null ? null : snapshot.data?.[TRACKED[provider]] ?? null;
          const budget = remainingOf(provider, card);
          const percent = typeof budget?.percent === 'number'
            ? Math.max(0, Math.min(100, budget.percent))
            : null;
          const tone = percent === null ? 'idle' : percent <= 10 ? 'bad' : percent <= 30 ? 'warn' : 'ok';
          const label = budget === null ? t('session.noBudget') : budget.label;

          return h(
            'div',
            {
              className: 'dsh-usage-side',
              title: budget === null
                ? label
                : `${label} · ${budget.kind === 'spend' ? t('session.spent') : t('session.remaining')}`,
            },
            h('div', { className: 'dsh-usage-side-head' },
              h('span', { className: 'dsh-usage-side-dot', 'data-tone': running ? 'live' : 'idle' }),
              h('span', { className: 'dsh-usage-side-model' }, shortModel(model?.model) ?? t('session.none')),
              h('span', { className: 'dsh-usage-side-meta' }, label)),
            h('div', { className: 'dsh-usage-side-bar' },
              h('span', {
                className: 'dsh-usage-side-fill',
                'data-tone': tone,
                style: { width: `${percent ?? 0}%` },
              })),
          );
        }

        ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
          name: 'settings.models.footer',
          id: 'usage-limits',
          order: 40,
        }, UsagePanel));

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'usage-session',
          order: 10,
        }, SessionUsage));
      },
    };
  },
});
