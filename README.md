<div align="center">

<br />

# ContextGraph

**The deterministic "Flight Data Recorder" for web applications**

*Transform manual browser sessions into structured, AI-ready intelligence — 100% offline, zero telemetry, enterprise-safe*

<br />

[![npm version](https://img.shields.io/npm/v/@shadowcoderr/context-graph?style=flat-square&color=0066cc&label=npm)](https://www.npmjs.com/package/@shadowcoderr/context-graph)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Playwright](https://img.shields.io/badge/Playwright-1.40%2B-2ead33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)
[![Zero Telemetry](https://img.shields.io/badge/telemetry-none-red?style=flat-square)](README.md#security-model)


[**Quick Start**](#-quick-start) • [**Features**](#-key-features) • [**Output**](#-what-you-get) • [**AI Integration**](#-ai-integration) • [**Config**](#-configuration) • [**Docs**](docs/USER_GUIDE.md)

<br />

</div>

---

## Why ContextGraph?

IDE-based AI agents (GitHub Copilot, Cursor, Claude) are **blind to your running browser**. Without MCP, they cannot see the live DOM, accessibility tree, or real API traffic of the application you're testing.

In enterprise environments, MCP and cloud-based recording tools are frequently blocked by security policy.

**ContextGraph solves this** by acting as a pre-processor — bridging the gap between manual exploration and AI-powered test generation using only Playwright, which is already whitelisted on most QA teams' machines.

```
Your Browser Session  →  ContextGraph  →  Structured Output  →  AI Agent  →  Generated Tests

```

**How to use the output:** Add the `context-graph-output/` folder to your IDE workspace. Once indexed, you can reference any captured page, locator, API endpoint, or accessibility tree directly in your AI prompts — treating the output as an offline knowledge base. Your AI agent can now "see" your application's UI/UX structure without needing live browser access or MCP integration.

> **Zero cloud. Zero telemetry. Zero MCP required.** Everything stays inside your enterprise perimeter.

---

## ✨ Key Features

<table>
<tr>
<td width="50%">

**🎯 Guided Capture**
Captures only what you navigate — no autonomous crawling, no surprises.

**🧹 Clean DOM Output**
Scripts, event handlers, and noise stripped before saving. Shadow DOM included.

**🔑 Smart Locators**
5+ selector strategies per element, ranked by resilience (TestID → Role → Label → Text → CSS).

**♿ Accessibility Tree**
Three-strategy extraction: Playwright API → CDP → DOM fallback. Full ARIA/role hierarchy.

</td>
<td width="50%">

**🌐 Network Intelligence**
All HTTP traffic captured. Concurrent request timing fixed via WeakMap. Failed requests tracked.

**🔒 Security by Design**
JWT, Bearer tokens, credit cards, SSNs, API keys, URL query params — all redacted before any disk write.

**🤖 AI Context Bundle**
Export entire session as a single Markdown file, ready to paste into any AI agent.

**📊 API Inventory**
Auto-generates structured API surface documentation with path-parameter normalisation.

</td>
</tr>
</table>

| Feature | Description |
|---|---|
| 📸 **Full Page Screenshots** | Automatic per-page + optional per-element captures |
| 🧩 **Component Registry** | Tracks reusable UI patterns across all captured pages |
| 🔄 **Change Detection** | Structural content hashing — skips unchanged pages automatically |
| 📦 **100% Offline** | Zero cloud dependencies, zero telemetry, runs inside enterprise perimeter |
| 🎭 **Recorder Mode** | Playwright Codegen integration — convert manual walkthroughs to `.spec.ts` |
| 🩺 **Console Logging** | JS errors, warnings, and uncaught exceptions captured per page |

---

## ⚡ Quick Start

### Install

```bash
npm install -g @shadowcoderr/context-graph
```

Verify:

```bash
context-graph --version
```

### Capture Your First Page

```bash
# Start a capture session (browser will open)
context-graph --mode browser --url https://your-app.com

# Navigate freely — every page you visit is captured automatically
# Press Ctrl+C when done
```

### Use the AI Context Bundle

```bash
# The bundle is automatically generated when you close the browser!
# Find it at:
# → context-graph-output/bundles/ai_context_bundle.md
```

Paste `ai_context_bundle.md` into Copilot Chat, Cursor, or Claude to immediately generate tests.

---

## 🗺️ Architecture

```
CLI (Commander.js + Inquirer.js)
  └── RuntimeController
        ├── BrowserAdapter          Playwright lifecycle, event hooks
        ├── CaptureEngine
        │     ├── DOMAnalyzer       Sanitise + Shadow DOM serialisation
        │     ├── A11yExtractor     3-strategy: Playwright → CDP → DOM
        │     ├── LocatorGenerator  Multi-strategy selector ranking
        │     ├── NetworkLogger     HTTP interception (WeakMap timing)
        │     ├── ScreenshotCapturer Full-page + element screenshots
        │     └── SecurityRedactor  PII / credential / URL param redaction
        ├── NetworkPatternAnalyzer  API surface documentation
        ├── AIContextBundler        Single-file LLM export
        ├── ComponentsRegistry      Cross-page UI pattern tracking
        └── StorageEngine           Filesystem persistence + statistics
```

---

## 📁 What You Get

For each captured page, ContextGraph saves a self-contained directory:

```
context-graph-output/
├── global_manifest.json                ← Master index of all captures
├── bundles/
│   └── ai_context_bundle.md            ← Ready-to-paste LLM context
├── <domain>/
│   ├── api_inventory.json              ← Structured API surface docs
│   ├── components_registry.json        ← Cross-page UI patterns
│   ├── network/
│   │   └── traffic_log.jsonl           ← HTTP traffic (redacted)
│   ├── user_interactions.json          ← Recorder mode interactions
│   └── pages/
│       └── <page-name>/
│           ├── metadata.json           ← URL, title, timing, viewport
│           ├── DOM                     ← Beautified, sanitised HTML
│           ├── a11y_tree.json          ← Full ARIA hierarchy
│           ├── locators.json           ← Ranked Playwright selectors ⭐
│           ├── frames.json             ← iframe + Shadow DOM structure
│           ├── console_errors.json     ← JS errors & warnings
│           ├── screenshot_manifest.json← Screenshot paths + metadata
│           └── screenshots/
│               └── screenshot.png      ← Full-page capture
└── scripts/
    └── <domain>.spec.ts                ← Recorder mode output
```

### File Reference

| File | Purpose |
|---|---|
| `metadata.json` | URL, page title, timing metrics, performance counters |
| `DOM` | Sanitised HTML — scripts removed, Shadow DOM inlined |
| `a11y_tree.json` | Full ARIA tree — the most semantically dense representation |
| `locators.json` | 5+ selector strategies per element, ranked by resilience |
| `api_inventory.json` | All observed API endpoints with normalised path params |
| `ai_context_bundle.md` | Single-file LLM export of the entire session |

---

## 🤖 AI Integration

### The 2-Step Workflow

```bash
# 1. Capture your application (you drive, ContextGraph records)
context-graph --mode browser --url https://app.example.com
# Close the browser when done — bundle auto-generates!

# 2. Open your AI IDE, paste the bundle, and ask for tests
# Bundle location: context-graph-output/bundles/ai_context_bundle.md
```

### Example Prompt (after pasting the bundle)

```
I am testing the app shown in this session context.

Using ONLY the locators from the "Interactive Elements" tables above,
generate Playwright TypeScript tests that:
  1. Navigate to the login page and log in with valid credentials
  2. Assert the dashboard renders correctly
  3. Test the shopping cart add/remove flow
  4. Cover the checkout form submission

Use test.describe() groups per page. Include assertions for
visible elements and navigation outcomes.
```

### What to Feed Your AI Agent

| File | When to Include |
|---|---|
| `ai_context_bundle.md` | **Always** — the complete single-file export |
| `locators.json` | When you need precise selector details |
| `api_inventory.json` | When generating API integration tests |
| `a11y_tree.json` | When generating accessibility tests |

---

## 🚀 Operating Modes

### Browser Mode — Passive Observer

Best for: understanding app structure, feeding AI with full UI context.

```bash
context-graph --mode browser --url https://app.example.com
```

Automatically captures on every page navigation: DOM, A11y tree, smart locators, network traffic, screenshots, and console errors.

### Recorder Mode — Action Capture

Best for: converting manual test walkthroughs into replayable scripts.

```bash
context-graph --mode recorder --url https://app.example.com

# Optionally replay the recording to capture full artifacts too:
context-graph --mode recorder --url https://app.example.com --recorder-capture
```

---

## ⚙️ Configuration

Create a `context-graph.config.json` file in your project root:

```json
{
  "browser": {
    "channel": "msedge",
    "headless": false,
    "viewport": { "width": 1920, "height": 1080 },
    "slowMo": 0
  },
  "capture": {
    "screenshots": {
      "enabled": true,
      "fullPage": true,
      "elementTargeting": false
    },
    "network": {
      "enabled": true,
      "captureHeaders": true,
      "captureBody": false
    },
    "accessibility": {
      "enabled": true,
      "includeHidden": false
    },
    "components": {
      "enabled": true,
      "minOccurrences": 1
    },
    "forceCapture": false
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

### Configuration Reference

<details>
<summary><strong>Browser options</strong></summary>

| Option | Type | Default | Description |
|---|---|---|---|
| `channel` | `msedge \| chromium \| firefox` | `msedge` | Browser engine |
| `headless` | `boolean` | `false` | Run without visible UI |
| `viewport.width` | `number` | `1920` | Browser width |
| `viewport.height` | `number` | `1080` | Browser height |
| `slowMo` | `number` | `0` | Slow motion delay (ms) |

</details>

<details>
<summary><strong>Capture options</strong></summary>

| Option | Type | Default | Description |
|---|---|---|---|
| `screenshots.enabled` | `boolean` | `true` | Capture full-page screenshots |
| `screenshots.fullPage` | `boolean` | `true` | Include off-viewport content |
| `screenshots.elementTargeting` | `boolean` | `false` | Also capture key element screenshots |
| `network.captureBody` | `boolean` | `false` | Include response body (JSON/text only) |
| `accessibility.includeHidden` | `boolean` | `false` | Include aria-hidden elements |
| `forceCapture` | `boolean` | `false` | Re-capture even if content hash matches |

</details>

<details>
<summary><strong>Security options</strong></summary>

**Built-in redaction patterns:** `jwt`, `bearer`, `creditcard`, `ssn`, `email`, `phone_number`, `api_key`, `aws_key`

**Always-redacted headers:** `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token`, `x-csrf-token`, `x-access-token`, `x-refresh-token`, `proxy-authorization`

**URL query parameters:** `token`, `api_key`, `auth`, `secret`, `password`, `session`, `code`, `client_secret`, and more — values are redacted before any disk write.

</details>

---

## 🖥️ CLI Reference

```
context-graph [startUrl] [options]

Options:
  -m, --mode <type>         browser | recorder            (required)
  -u, --url <url>           Starting URL
  -o, --output <path>       Output directory               [default: ./context-graph-output]
  -c, --config <path>       Config file path
  -v, --viewport <WxH>      Viewport size                  [default: 1920x1080]
  --headless                Run headless (no visible browser)
  --slow-mo <ms>            Slow motion delay in ms
  --no-screenshots          Disable screenshot capture
  --no-network              Disable network logging
  --recorder-capture        (Recorder) Replay script to capture full artifacts
  --verbose                 Enable debug logging
  --verbose                 Enable debug logging
  --version                 Show version
  --help                    Show help
```

---

## 🔒 Security Model

ContextGraph enforces a multi-layer redaction pipeline — **all redaction happens before any disk write**. There is no "raw then redact" staging.

```
Raw Data
  ↓ 1. Header stripping     (authorization, cookie, x-api-key, etc.)
  ↓ 2. URL sanitisation     (sensitive query params: ?token=, ?api_key=)
  ↓ 3. Pattern matching     (JWT, Bearer, credit cards, SSNs, emails, AWS keys)
  ↓ 4. Key-based redaction  (object properties with sensitive names)
  ↓ 5. Custom rules         (user-defined patterns from config)
  ↓
Redacted Data → Audit Log → Filesystem Write
```

**Security invariants (hardcoded, cannot be disabled):**
- `<script>` content is always stripped from DOM snapshots
- `type="password"` input values are always replaced with `[REDACTED]`
- `authorization`, `cookie`, and `set-cookie` headers are always removed
- Zero outbound connections, zero telemetry, zero update checks

Every redaction event is logged to `logs/redaction_audit.jsonl` for compliance review.

---

## 🏢 Enterprise STLC Patterns

### Pattern A — AI-Assisted Test Generation

```bash
context-graph --mode browser --url https://app.example.com
# Close browser when done — bundle auto-generates at:
# context-graph-output/bundles/ai_context_bundle.md
# → Paste into Copilot Chat → get .spec.ts tests
```

### Pattern B — Regression Detection Between Releases

```bash
# Capture baseline before release
context-graph --mode browser --url https://staging.example.com
mv context-graph-output context-graph-baseline

# Deploy release candidate, then capture again
context-graph --mode browser --url https://staging.example.com

# Compare the two captures to find locator drift
# Elements whose best locator strategy changed = tests likely to break
```

### Pattern C — Undocumented App Onboarding

```bash
# Capture 1–2 hours of navigation through an unfamiliar enterprise app
context-graph --mode browser --url https://internal-erp.corp.com

# Generate API inventory — no Swagger/OpenAPI docs needed
# api_inventory.json shows every endpoint, method, and status code observed
```

### Pattern D — Manual Test Script Conversion

```bash
# Follow your manual test script step-by-step
context-graph --mode recorder --url https://app.example.com --recorder-capture

# Output: <domain>.spec.ts with your steps as Playwright actions
# Add assertions, or ask AI to add them given the a11y tree context
```

---

## 🛠️ Development

```bash
# Clone and install
git clone https://github.com/shadowcoderr/ContextGraph
cd ContextGraph
npm install

# Build
npm run build

# Run in dev mode
npm run dev -- --mode browser --url https://example.com

# Unit tests (Jest)
npm test

# Integration tests (Playwright)
npm run test:playwright

# Lint
npm run lint
```

### Module Status

| Module | Status | Notes |
|---|---|---|
| CLI | ✅ Stable | Interactive wizard + full CLI flags |
| Browser Mode | ✅ Stable | Auto-capture on navigation + SPA history API |
| Recorder Mode | ✅ Stable | Codegen integration + artifact replay |
| DOM Analyzer | ✅ Stable | Script removal + Shadow DOM serialisation |
| A11y Extractor | ✅ Stable | 3-strategy: Playwright → CDP → DOM |
| Locator Generator | ✅ Stable | 6-strategy ranking + uniqueness checks |
| Network Logger | ✅ Stable | WeakMap timing, requestfailed, captureBody |
| Screenshot Capturer | ✅ Stable | Full-page + element-level screenshots |
| Security Redactor | ✅ Stable | 8 patterns + URL query param redaction |
| AI Context Bundler | ✅ Stable | Single-file Markdown/JSON LLM export |
| Network Pattern Analyzer | ✅ Stable | API inventory with path normalisation |
| Components Registry | ✅ Stable | Cross-page pattern indexing |
| Shadow DOM Support | 🔄 Partial | Top-level serialisation included |
| Multi-browser | 🔜 Planned | Edge + Chromium; Firefox beta |

---

## 📖 Documentation

Full technical documentation including architecture deep-dive, module reference, all identified issues and their fixes, proposed features, output schema reference, security model, and STLC integration patterns:

📄 **[Complete Technical Documentation](docs/_DOCUMENTATION.md)**

📖 **[User Guide](docs/USER_GUIDE.md)** — Advanced configuration, CLI reference, troubleshooting

---

## 🤝 Contributing & Support

🐛 **[Report Issues](https://github.com/shadowcoderr/ContextGraph/issues)**

💬 **[Discussions](https://github.com/shadowcoderr/ContextGraph/discussions)**

📦 **[npm Package](https://www.npmjs.com/package/@shadowcoderr/context-graph)**

---

## 📄 License

MIT © [Shadow Coderr](https://github.com/shadowcoderr)

---

<div align="center">

**Built for QA engineers who believe AI should work smarter, not just faster.**

*ContextGraph gives your AI the eyes it was missing.*

</div>
