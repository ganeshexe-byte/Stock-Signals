# StockLens

Real-time Indian market analysis and **paper trading only**. There is no broker order code anywhere in this project, so it cannot place real orders.

- Sticky top bar on every page: Nifty 50, Bank Nifty, Sensex and India VIX, each with Bullish / Bearish / Sideways chips for intraday, short term and medium term.
- Index pages (click any index in the top bar): full analysis, chart, levels, indicator table, option chain, constituents and breadth, daily analysis (pre-market, live, post-market).
- Charts: TradingView Lightweight Charts with built-in overlays and **your own custom indicators** (JavaScript).
- Scanners for intraday, swing and long-term study.
- Paper trading with realistic charges, then a Journal that shows which market conditions your trades actually worked in.

## Run it

Requires Node.js 18 or newer.

```bash
npm install
cp .env.example .env     # optional for simulated mode, required for live data
npm start
```

Open http://127.0.0.1:3000.

### Simulated vs live mode

| Mode | When | Data |
|---|---|---|
| Simulated | No Angel One credentials in `.env` | Random-walk prices. A red banner says **SIMULATED DATA**. Use it to try the app only. Prices are not realistic. Like the real market, they only move Mon-Fri 09:15-15:30 IST. Add `MOCK_ALWAYS_LIVE=true` to `.env` to keep them moving at any hour. |
| Live | All four `ANGEL_*` values set | Real-time ticks, candles and option chain from Angel One SmartAPI |

### Setting up Angel One SmartAPI

1. Log in at https://smartapi.angelone.in and create an app to get an **API key**.
2. Enable TOTP on your Angel One account. When the QR code appears, copy the **secret text** shown beside it. This is your `ANGEL_TOTP_SECRET`, not the 6-digit code.
3. Fill `.env`:

```
ANGEL_API_KEY=...
ANGEL_CLIENT_CODE=...
ANGEL_PIN=...            # your MPIN
ANGEL_TOTP_SECRET=...
```

4. Restart with `npm start`. The top bar shows the data status.

Keep `.env` private. It is in `.gitignore`.

> **Important:** the live Angel One feed was written against the SDK source and documentation but **has not been tested against a real account**. Expect to fix small things on first run. Check the server console for `[angel]` messages.

## Pages

| Page | What it does |
|---|---|
| Dashboard (`index.html`) | Index cards, Nifty chart, daily analysis, scanner previews, paper summary, sectors, breadth |
| Index detail (`market.html?s=NIFTY`) | Also BANKNIFTY, SENSEX, INDIAVIX. Condition cards, chart, levels, indicators, option chain, constituents |
| Charts | Any NSE stock, 1m to 1W, overlays, custom indicator editor, plus reviews, outlook and data tables for that stock |
| Daily Analysis | All indices side by side, saved snapshots with hit/miss tally |
| Scanners | Intraday (live quotes), Swing and Long term (daily candles) |
| Paper Trading | Order ticket (Market / Limit / SL, Intraday or Delivery), positions, orders, trades |
| Watchlist | Live prices, buy / sell / chart shortcuts |
| Journal | Auto-filled from closed trades; tags, emotion, rating, notes; performance by market condition |

## When the market is closed

Nothing goes blank. Prices, charts and conditions show the **last completed session**, and a banner at the top says so and when the market opens next. In live mode the last prices are also saved to `data/lastquotes.json`, so a restart on a weekend still shows data until the first live tick.

Every index page (and the Charts page, for any stock) has a **Past performance and outlook** section with three tabs:

- **Previous session, week, month:** open, high, low, close, change, range, where it closed in its range, and the bar pattern (inside bar, higher high and higher low, and so on). The current week and month so far are shown too.
- **Next session, week, month:** pivot levels (R1-R3, S1-S3), the central pivot range, a typical range (1 ATR), a rule-based bias with the checks behind it, and if-then scenarios.
- **Data tables:** daily (60), weekly (52) and monthly (24) tables, with CSV download.

The Daily Analysis page also has a **Past and next** table across all four indices. For India VIX the bias reads Rising / Falling / Flat, because a rising VIX is not "Bullish".

The "next" views are **levels and scenarios built from past prices with fixed rules. They are not forecasts.** The code is in `server/periods.js`.

## How market conditions are computed

Each timeframe runs a list of transparent checks (EMA trend, RSI, MACD, VWAP for intraday, Bollinger position, higher highs/lows and so on). Each check votes bullish, bearish or neutral with a weight.

`score = 50 + 50 × Σ(signal × weight) / Σ(weight)`

60 or more is **Bullish**, 40 or less is **Bearish**, otherwise **Sideways**. Intraday uses 5-minute candles; short term and medium term use daily candles. The top-bar chip for each timeframe is the majority across the three indices. Every check is listed on the index page so you can see why. These are rule outputs, not predictions or advice.

Edit the rules in `public/shared/condition.js`.

## Custom indicators

On the Charts page, use the Custom indicator editor. Your code receives `candles` (array of `{t, o, h, l, c, v}`, with `t` in UTC seconds) and `ta` (helpers such as `ema`, `sma`, `rsi`, `macd`, `bollinger`, `atr`, `vwap`). It must return an object with one value per candle (use `null` where undefined):

```js
const closes = candles.map(c => c.c);
return { name: 'EMA 9', color: '#f5a623', pane: 'overlay', values: ta.ema(closes, 9) };
```

- `pane`: `'overlay'` (on the price chart) or `'separate'` (own pane below).
- Several lines: return `lines: [{ name, color, values, style: 'dashed' }, ...]`.
- Bars: add `type: 'hist'`.
- Signals: `markers: [{ index, position: 'above' | 'below', text }]`.

The editor includes three working examples and a test-run before saving. Indicators are stored in your browser (localStorage), not on the server. They run in your browser with full page access, so only paste code you trust.

## Paper trading rules

- Starting capital is configurable on reset (default ₹10,00,000).
- Intraday (MIS): 5x leverage, shorting allowed, auto square-off at 15:20 IST (live mode only).
- Delivery (CNC): no shorting.
- 0.02% slippage on fills.
- Charges are approximate Indian equity charges: brokerage min(₹20, 0.03%), STT, exchange fees, SEBI fee, stamp duty, 18% GST. Check them against your broker before relying on the numbers.
- Each order records the market condition at that moment, which feeds the Journal.

## Customising

- **Stocks and sectors:** `server/universe.js` (about 96 stocks, Nifty 50 first).
- **Index constituents** for breadth and movers: `MEMBERS` in the same file. Index composition changes twice a year, so update these by hand.
- **Scanner rules:** `RULES` in `server/scanners.js`.

## Known limitations

- Live Angel One mode is untested.
- No FII/DII data and no global cues (GIFT Nifty, US markets).
- Long-term scanner is technical only. Fundamentals are not available from SmartAPI.
- Exchange holidays are not handled. The app treats every Monday to Friday as a trading day, so a "next session" may fall on a holiday.
- Option chain shows the nearest expiry, ±10 strikes, with OI, PCR, max pain and support/resistance. No Greeks.
- BSE index candles (Sensex) may be missing from the Angel API; the page shows "No data" instead of failing.
- Simulated prices are random and unrealistic.

## Security

The server binds to `127.0.0.1` by default and rejects requests whose Host or Origin header is not local. This blocks other websites from calling your local API. If you set `HOST=0.0.0.0` to reach it from another device, anyone on your network can read your data and place paper orders. Do not expose it to the internet.

## Project layout

```
server/        Express + WebSocket, feeds (mock, angel), analysis, scanners, paper engine, journal
public/        Static front end (HTML, CSS, vanilla JS)
public/shared/ ta.js and condition.js, used by both server and browser
data/          Saved paper account, journal, watchlist, snapshots (created at runtime)
```
