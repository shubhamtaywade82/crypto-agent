# 🤖 Crypto Agent (Gemma 4 31B) 📈

![CI/CD](https://github.com/shubhamtaywade82/crypto-agent/actions/workflows/docker-publish.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)

Autonomous ReAct crypto trading agent powered by `gemma4:31b` via `@nemesis-oss/ollama-sdk`, real-time public Binance market data via `@nemesis-oss/binance-sdk`, precision sizing via `decimal.js`, and seamless HTTP integration with `paper-broker`.

---

## 🏗️ Architecture

```mermaid
graph TD
    Client["Browser / TradingView UI"] <-->|REST / SSE| Hono["Hono Web Server (:3001)"]
    Hono <-->|Agent Loop| Agent["ReAct Agent (gemma4:31b)"]
    Agent <-->|Tool Execution| Registry["Tool Registry"]
    
    subgraph Tools
        Registry -->|Public Market Data| Binance["Binance SDK (Public Spot)"]
        Registry -->|Lot Sizing| Sizing["Position Sizer (decimal.js)"]
        Registry -->|Non-invasive HTTP| Paper["Paper Broker (:3000)"]
    end

    Agent <-->|Inference| Ollama["Ollama Engine (:11434)"]
```

---

## ✨ Features

- **ReAct Decision Loop:** Native tool calling with `think: 'high'` reasoning traces powered by Gemma 4.
- **Precision Lot Sizing:** Quantitative risk management (`ROUND_DOWN`, zero-division guards) with `decimal.js`.
- **Public Market Tools:** Zero-API-key market intelligence (`ticker24hr`, `depth`, `klines`, `trades`, `avgPrice`) adapted from `@nemesis-oss/binance-sdk`.
- **Non-Invasive Paper Trading:** Safe HTTP bridge to `paper-broker` (`POST /orders`, `GET /positions`) with automatic mock fallback when offline.
- **Streaming SSE & Dashboard:** Real-time token and thought streaming over Server-Sent Events, complete with an embedded dark-mode TradingView Lightweight Charts dashboard.
- **Dockerized GPU Pipeline:** Multi-stage Alpine container, automatic model catalogue verification and pull, NVIDIA GPU passthrough, and persistent model caching.

---

## 🚀 Quickstart

### 1. Docker Compose (Recommended)

Start the entire stack (Ollama + Crypto Agent) with a single command:

```bash
docker compose up --build -d
```

Access the TradingView dashboard and agent chat at `http://localhost:3001`.

### 2. Local Development

Ensure Ollama is running locally on port `11434`:

```bash
# Install dependencies
npm install

# Run test suite (10/10 tests)
npm test

# Run linter and typecheck
npm run lint
npm run typecheck

# Start development server
npm run dev
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Embedded TradingView candlestick chart & streaming chat UI |
| `/api/chat` | `POST` | Execute ReAct agent turn (`{ "prompt": "..." }`) |
| `/api/chat/stream` | `GET` | SSE stream for real-time agent thoughts and response tokens (`?prompt=...`) |
| `/api/klines` | `GET` | Lightweight-charts formatted candlestick data (`?symbol=BTCUSDT`) |
| `/metrics` | `GET` | Uptime and heap memory statistics |
| `/health` | `GET` | Service health status |

---

## 🛡️ Paper Broker Safety

This agent operates with strict safety boundaries:
1. **Public Market Data Only:** No live Binance private API keys required.
2. **Zero Paper-Broker Mutations:** The flagship `paper-broker` repository remains 100% untouched. All interactions happen over standard HTTP REST endpoints with graceful offline mocks.