<h1 align="center">DeepSeek Status Bar for Copilot</h1>

> **🍴 This is a fork.** It builds on
> [zxzxn3/deepseek-status-bar-for-copilot](https://github.com/zxzxn3/deepseek-status-bar-for-copilot)
> (MIT) — all credit for the original extension goes to [@zxzxn3](https://github.com/zxzxn3).
>
> **What this fork adds**
> - **Peak / off-peak rate badge with a countdown** in the status bar —
>   `💚 2h14m` vs `⚡ 0h45m` — so you know when you're paying double *before* you spend it.
> - **Fixed the Flash price table,** which was still on the pre-2026-09-10 rates
>   (`0.05/1.5/4.5` → `0.02/1/4` CNY). Every Flash cost estimate was ~2.5× too high.
> - **Peak detection rewritten on UTC** as a single source of truth, matching the
>   official `01:00–04:00` and `06:00–10:00 UTC, Mon–Fri` windows instead of a
>   hardcoded Beijing offset.
>
> See [PATCH-NOTES.md](PATCH-NOTES.md) for the complete delta.

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=zxzxo.deepseek-status-bar-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="Install from VS Code Marketplace"></a>
  <br/>
  <img src="https://img.shields.io/github/license/zxzxn3/deepseek-status-bar-for-copilot?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/github/v/release/zxzxn3/deepseek-status-bar-for-copilot?style=for-the-badge&label=Version" alt="Version" />
</p>

<p align="center">
  <strong>See exactly what DeepSeek is costing you — live, in the status bar, without leaving VS Code.</strong>
</p>

This extension puts a lightweight local proxy between Copilot Chat (via the [DeepSeek V4 for Copilot Chat](https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot) extension) and the DeepSeek API. It captures the **real `usage` object from every response** and turns it into today's cost and token totals — Beijing time, peak pricing included.

<p align="center">
  <img src="status-bar.png" alt="Status bar showing today's DeepSeek cost and tokens" width="557"/>
</p>

## Why this extension?

- **Real numbers, not estimates.** It reads the `usage` DeepSeek returns on every request (`prompt_tokens` / `completion_tokens` / cache tokens) and prices it with the official rates. The totals match your DeepSeek bill — no heuristic token counting.
- **Lives in the status bar.** One glance: cost, cache-hit cost, total and cached tokens. Click it to switch between six display formats.
- **A real dashboard when you need it.** A webview panel with `Day / Week / Month / All` ranges, a stacked usage chart, per-model breakdown, recent requests, and CSV export.
- **Your API key never touches this extension.** The proxy forwards the `Authorization` header straight through to DeepSeek; the key stays wherever the Copilot extension stores it.
- **No external services.** Chart.js and dayjs are bundled into the extension itself — no separate service, no Python, no Docker.

## Why this is different

Every other DeepSeek usage tool answers *"how much is left in my account?"* — they poll the [`/user/balance`](https://api.deepseek.com/user/balance) endpoint and show your credit balance. This extension answers a different question: *"what did that request actually cost me?"*

It sits **in the traffic path** — a local proxy that captures the real `usage` object DeepSeek returns on every request and prices it with the official rate card:

- **Ground truth, not estimates.** `usage` is the exact field DeepSeek bills from (`prompt_tokens` / `completion_tokens` / `cache_hit` / `cache_miss`). No heuristic token counting.
- **Three-way pricing.** Cache hit vs miss, input vs output, and Beijing peak vs off-peak (×2) — the same axes as your real bill.
- **Aborted generations still count.** Cancel mid-stream and the proxy keeps reading until it captures the final `usage` — so the numbers match what you're billed.
- **Your API key never touches this extension.** The proxy forwards the `Authorization` header straight through and never stores it.

## Features

### Live status bar

The status bar shows today's totals (Beijing time) and updates automatically:

<p align="center">
  <img src="display-formats.png" alt="Click the status bar to switch display formats" width="749"/>
</p>

- **Cost** — `￥9.8626/4.4522` total / cache-hit cost
- **Tokens** — `91.69M/89.04M` total / cached tokens
- **Balance** — `￥xx.xx` account balance, refreshed by the proxy on each request
- **Peak pricing aware** — costs double during peak hours (Beijing weekdays 09:00–12:00 and 14:00–18:00)
- **Six display formats** — click the status bar to pick: `full` (cost + tokens), `cost`, `tokens`, `totalT` (total tokens only), `totalCost` (total cost only), or `balance`
- **Low-balance warning** — the status bar turns amber when the balance drops below `deepseekStatusBar.lowBalanceWarnCny`

### Detail panel

Click through to a full webview dashboard:

<p align="center">
  <img src="details-view.png" alt="Detail panel with summary, usage chart, per-model breakdown and recent requests" width="760"/>
</p>

- **Range selector** — `Day` / `Week` / `Month` / `All`, with a **date picker** to view any specific day, week, or month
- **Usage-over-time chart** — Chart.js stacked bars (cache hit / cache miss / output) for cost or tokens, bucketed **by hour** for today & week and **by day** for month & all
- **Balance & latency curves** — toggleable overlays for the account balance and the average request latency over time, each on its own axis with a legend
- **Per-model breakdown** — cost & tokens per model (Flash / Pro / Vision), plus average latency per model
- **Recent requests** — timestamp, model, prompt/completion, total/cache, cost, latency, status, error
- **Export CSV** — dump the selected range to a CSV with cost columns

### True streaming proxy

A local OpenAI-compatible proxy that forwards `chat/completions` with real streaming:

- **Chunked streaming passthrough** — responses stream to Copilot as DeepSeek produces them, no buffering
- **SSE-safe** — handles usage chunks split across network boundaries
- **Disconnect-safe** — if the client cancels, the proxy keeps reading upstream to capture the final `usage` (aborted generations still cost money and are still counted)
- **Auto-start** — starts with VS Code (`autoStart`) and takes over `deepseek-copilot.baseUrl`, restoring it when stopped

### Account balance (on-request)

The proxy already holds your API key on every forwarded request, so it also queries [`/user/balance`](https://api.deepseek.com/user/balance) along the way and shows your balance in the status bar and the panel:

- **No extra key setup** — the key is used in-flight and never stored
- **Throttled** — at most once per minute; forced immediately after an HTTP 402
- **402 awareness** — insufficient-balance responses are surfaced in the detail panel, together with a fresh balance query

### Request latency

The proxy timestamps every request, so the panel knows how long each one took:

- **Per-request latency** — shown in the recent-requests table
- **Average latency** — an overall summary card, a per-model column, and an optional curve overlaid on the usage chart
- **No cost to old data** — latency is recorded from new requests onward; historical rows simply show `—`

### Configurable pricing & currency

- **Pricing overrides** — the built-in price table (per model, yuan per million tokens) can be overridden per model in settings
- **CNY or USD display** — switch currency with a single setting; USD uses a live exchange rate fetched from a public API, falling back to a configurable rate when offline
- **Language** — the UI follows your VS Code display language (English / 简体中文)

## How it works

```
Copilot Chat (DeepSeek V4 for Copilot)
        │  baseUrl → http://127.0.0.1:8080
        ▼
  local proxy (Node.js, spawned by this extension)
        │  forwards with your Authorization header
        ▼
  api.deepseek.com
        │  response.usage captured
        ▼
  usage.jsonl  →  status bar + detail panel (cost computed on display)
```

Data is stored as one JSON line per request in VS Code's global storage: raw facts only (UTC timestamp + token counts). Cost is computed at display time, so price or currency changes are reflected immediately — no re-processing of history.

## Getting Started

### Prerequisites

- **VS Code 1.85** or later
- **DeepSeek V4 for Copilot Chat** — installed automatically as a dependency of this extension
- A **DeepSeek API key** configured in that extension (this extension never sees it)

### Installation

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zxzxo.deepseek-status-bar-for-copilot) (or build from source below).
2. Reload VS Code. The proxy starts automatically.

### Usage

1. Open Copilot Chat and pick a DeepSeek V4 model (the companion extension).
2. Chat as usual — the status bar starts showing today's cost and tokens.
3. Click the status bar to switch its format, or run **DeepSeek Status Bar: Today's Details** for the full panel.

## Settings

| Setting | Default | Description |
|---|---|---|
| `deepseekStatusBar.port` | `8080` | Local proxy listen port |
| `deepseekStatusBar.autoStart` | `true` | Start the proxy automatically when VS Code launches |
| `deepseekStatusBar.manageBaseUrl` | `true` | Point `deepseek-copilot.baseUrl` at the proxy while running, and restore it when stopped |
| `deepseekStatusBar.pollIntervalSeconds` | `10` | Status bar refresh interval (seconds, min 2) |
| `deepseekStatusBar.statusBarFormat` | `full` | Status bar format: `full` / `cost` / `tokens` / `totalT` / `totalCost` / `balance` |
| `deepseekStatusBar.pricing` | `{}` | Per-model price overrides (yuan / 1M tokens): `{"deepseek-v4-flash": {"cache_hit": 0.05, "cache_miss": 1.5, "output": 4.5}}` |
| `deepseekStatusBar.currency` | `cny` | Cost currency: `cny` (￥) or `usd` ($) |
| `deepseekStatusBar.cnyPerUsd` | `6.74` | Fallback CNY-per-USD rate, used when the live rate can't be fetched |
| `deepseekStatusBar.lowBalanceWarnCny` | `10` | Account balance (yuan) below which the status bar warns; `0` disables |

**Pricing model** — built-in defaults + your overrides; peak = off-peak × 2 during Beijing weekdays 09:00–12:00 and 14:00–18:00. USD display uses a live rate (fetched from a public API, refreshed every 6 hours) and falls back to `cnyPerUsd` offline.

## Commands

| Command | Description |
|---|---|
| `DeepSeek Status Bar: Today's Details` | Open the detail panel |
| `DeepSeek Status Bar: Start Proxy` / `Stop Proxy` | Toggle the proxy (the palette entry reflects the current state) |
| `DeepSeek Status Bar: Display Format` | Choose the status bar display format |

## Notes & limitations

- **Vision requests are not counted.** The companion extension's vision feature uses a separate `/v1/responses` endpoint configured independently of `baseUrl`, so it doesn't pass through this proxy.
- **`baseUrl` is global.** Taking over `deepseek-copilot.baseUrl` affects all windows. It's restored when the proxy stops, but if VS Code is force-killed the value may be left pointing at the proxy — it recovers on next launch since `autoStart` is on.
- **The official dashboard is authoritative.** Costs are computed from the same pricing model, but always trust `platform.deepseek.com` for billing.

## Build from source

```powershell
npm install
npm run compile      # or npm run watch
npm run typecheck
npm run smoke
npm test

# package into a .vsix
powershell -ExecutionPolicy Bypass -File .\package.ps1

# install / reinstall (--force overwrites the same version)
code --install-extension .\deepseek-status-bar-for-copilot.vsix --force
```

## License

[MIT](LICENSE)
