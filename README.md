# ContextGraph

> **A deterministic "Flight Data Recorder" for web applications** — captures rich, AI-ready context from browser sessions in restricted enterprise environments where MCP is unavailable.

[![Version](https://img.shields.io/badge/version-0.3.0-blue)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](tsconfig.json)
[![Playwright](https://img.shields.io/badge/Playwright-1.40%2B-orange)](package.json)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

---

## Why ContextGraph?

IDE-based AI agents (Copilot, Cursor, etc.) are blind to your running browser. Without MCP, they cannot see the live DOM, accessibility tree, or real API traffic of the app you are testing. In enterprise environments, MCP and cloud-based recording tools are often blocked by security policy.

ContextGraph solves this by acting as a **pre-processor** — it bridges the gap between manual exploration and AI-powered test generation using only Playwright, which is already whitelisted on most QA teams' machines.

```
Your Browser Session
        │
        ▼
  ContextGraph          ← You are here
  (Playwright-native)
        │
        ▼
  Structured Output       ← DOM, Locators, A11y Tree, Network
  (Local Filesystem)
        │
        ▼
  AI Agent / LLM          ← Receives clean, noise-free context
  (Copilot / Cursor / Claude)
        │
        ▼
  Generated Tests         ← Playwright .spec.ts files
```

---

## Key Features

| Feature | Description |
|---|---|
| 🎯 **Guided Capture** | Captures only what you navigate — no autonomous crawling |
| 🧹 **Clean DOM Output** | Scripts, event handlers, and noise stripped before saving |
| 🔑 **Smart Locators** | 5+ selector strategies per element, ranked by resilience |
| ♿ **Accessibility Tree** | Full ARIA/role hierarchy for semantic understanding |
| 🌐 **Network Logging** | All HTTP traffic captured with automatic PII redaction |
| 🔒 **Security by Design** | Credentials, tokens, PII never touch the filesystem |
| 🧩 **Component Registry** | Tracks reusable UI patterns across captured pages |
| 📦 **100% Offline** | Zero cloud dependencies, zero telemetry, runs inside enterprise perimeter |

---

## Quick Start

### Prerequisites

- **Node.js** 18.0.0 or higher
- **Microsoft Edge** (installed — used as the capture browser)
- **Windows 10/11** (primary support; Linux/macOS in beta)

### Install

```bash
npm install -g context-graph
```

Verify:

```bash
context-graph --version
# Context Graph v0.3.0
```

### Capture Your First Page (2 minutes)

```bash
# 1. Start a capture session
context-graph --mode browser --url https://your-app.com

# 2. Navigate through the app — every page you visit is captured
# 3. Press Ctrl+C when done

# 4. Inspect results
cat context-graph-output/global_manifest.json
```

---

## Operating Modes

### Browser Mode — Passive Observer

Best for: understanding app structure, feeding AI with full UI context.

```bash
context-graph --mode browser --url https://app.example.com
```

Automatically captures on every page navigation:
- Sanitized DOM snapshot
- Accessibility tree (ARIA roles, names, states)
- Smart locators (Role → TestID → Label → Placeholder → Text → CSS)
- Network traffic log
- Full-page screenshot
- Console messages and JS errors

### Recorder Mode — Action Capture

Best for: converting manual test walkthroughs into replayable scripts.

```bash
context-graph --mode recorder --url https://app.example.com
```

Launches Playwright Codegen; every action you perform is recorded. On close, the session is merged into a clean Playwright `.spec.ts` file.

Optionally replay the recording with artifact capture enabled:

```bash
context-graph --mode recorder --url https://app.example.com --capture-artifacts
```

---

## Output Structure

```
context-graph-output/
├── global_manifest.json              ← Master index of all captures
├── sessions/
│   └── session_20251213_103045/
├── domains/
│   └── app.example.com/
│       ├── pages/
│       │   └── 20251213_103045_a4b8c2d/
│       │       ├── metadata.json         ← URL, title, timing, viewport
│       │       ├── dom_snapshot.html     ← Sanitized HTML (no scripts)
│       │       ├── a11y_tree.json        ← ARIA hierarchy
│       │       ├── locators.json         ← Smart selectors ⭐
│       │       ├── frames.json           ← iframe structure
│       │       └── console_log.jsonl     ← JS errors & logs
│       ├── network/
│       │   └── traffic_log.jsonl         ← All HTTP traffic (redacted)
│       └── assets/
│           └── screenshots/
├── scripts/                              ← Recorder mode output
│   └── app.example.com.spec.ts
└── logs/
    └── system.log
```

---

## Feeding Output to an AI Agent

### What to Give the AI

For test generation, provide the AI these files from a single captured page:

| File | Why it Matters |
|---|---|
| `metadata.json` | URL, page title, timing context |
| `a11y_tree.json` | Semantic structure — what the page *means* |
| `locators.json` | Ready-to-use, ranked Playwright selectors |
| `dom_snapshot.html` | Full structural HTML if deep context is needed |
| `network/traffic_log.jsonl` | What API calls the page makes |

### Example Prompt Structure

```
I am testing the following web page:
URL: https://app.example.com/login

Here is the accessibility tree:
[paste a11y_tree.json]

Here are the available locators:
[paste locators.json]

Here is the API traffic observed:
[paste relevant entries from traffic_log.jsonl]

Generate a Playwright test that:
1. Navigates to the login page
2. Enters valid credentials
3. Asserts the dashboard is shown
```

---

## Configuration

Create a `context-graph.config.json` file to customize behaviour:

```json
{
  "browser": {
    "channel": "msedge",
    "headless": false,
    "viewport": { "width": 1920, "height": 1080 },
    "slowMo": 0
  },
  "capture": {
    "screenshots": { "enabled": true, "fullPage": true },
    "network": { "enabled": true, "captureHeaders": true, "captureBody": false },
    "accessibility": { "enabled": true, "includeHidden": false },
    "components": { "enabled": true, "minOccurrences": 2 }
  },
  "security": {
    "redactPatterns": ["jwt", "bearer", "creditcard", "ssn", "email", "api_key"],
    "redactHeaders": ["authorization", "cookie", "set-cookie", "x-api-key"],
    "customPatterns": [
      {
        "name": "employee_id",
        "pattern": "EMP-\\d{6}",
        "replacement": "[REDACTED:EMP_ID]",
        "severity": "high"
      }
    ]
  },
  "storage": {
    "outputDir": "./context-graph-output",
    "prettyJson": true
  }
}
```

Run with config:

```bash
context-graph --config ./context-graph.config.json --mode browser
```

---

## CLI Reference

```
context-graph [options]

Options:
  -m, --mode <type>           browser | recorder  (required)
  -u, --url <url>             Starting URL
  -o, --output <path>         Output directory  [default: ./context-graph-output]
  -c, --config <path>         Config file path
  -v, --viewport <WxH>        Viewport size      [default: 1920x1080]
  --headless                  Run headless (no visible browser)
  --slow-mo <ms>              Slow motion delay in ms
  --no-screenshots            Disable screenshot capture
  --no-network                Disable network logging
  --capture-artifacts         (Recorder mode) Replay script to capture DOM/A11y artifacts
  --force-capture             Re-capture already-visited pages
  --verbose                   Enable debug logging
  --version                   Show version
  --help                      Show help
```

---

## Architecture Overview

```
CLI (Commander.js / Inquirer.js)
  └── RuntimeController
        ├── BrowserAdapter          ← Playwright lifecycle + event hooks
        ├── CaptureEngine
        │     ├── DOMAnalyzer       ← Sanitize & serialize HTML
        │     ├── A11yExtractor     ← ARIA/role tree extraction
        │     ├── LocatorGenerator  ← Multi-strategy selector ranking
        │     ├── NetworkLogger     ← HTTP traffic interception
        │     └── SecurityRedactor  ← PII / credential removal
        ├── DataValidator           ← Schema integrity checks
        ├── ComponentsRegistry      ← Cross-page pattern tracking
        └── StorageEngine           ← File system persistence
```

---

## Project Status

| Module | Status | Notes |
|---|---|---|
| CLI | ✅ Stable | Interactive wizard + full CLI flags |
| Browser Mode | ✅ Stable | Auto-capture on navigation |
| Recorder Mode | ✅ Stable | Codegen integration + artifact replay |
| DOM Analyzer | ✅ Stable | Script removal, semantic preservation |
| Locator Generator | ✅ Stable | 6-strategy ranking |
| A11y Extractor | ✅ Stable | Full ARIA tree |
| Network Logger | ✅ Stable | Request/response with redaction |
| Security Redactor | ✅ Stable | 8 built-in patterns + custom rules |
| Components Registry | ✅ Stable | Cross-page pattern indexing |
| Shadow DOM Support | 🔄 Partial | Top-level only |
| Multi-browser | 🔜 Planned | Edge only in v0.3 |

---

## Development

```bash
# Clone and install
git clone https://github.com/shadowcoderr/ContextGraph
cd ContextGraph
npm install

# Build
npm run build

# Run in dev mode
npm run dev -- --mode browser --url https://example.com

# Run tests
npm test

# Lint
npm run lint
```

---

## Security Model

ContextGraph enforces a strict security pipeline:

1. **Headers** — `authorization`, `cookie`, `set-cookie`, `x-api-key` and 5 others are stripped before any persistence.
2. **Body patterns** — JWT, Bearer tokens, credit cards, SSNs, emails, phone numbers, AWS keys, and generic API keys are redacted via regex.
3. **DOM** — Password field values are never captured; `<script>` content is removed entirely.
4. **Audit log** — Every redaction event is logged to `logs/redaction_audit.jsonl` for compliance review.
5. **No outbound connections** — Zero telemetry, zero cloud calls. All data stays on disk.

---

## License

MIT — © Shadow Coderr
