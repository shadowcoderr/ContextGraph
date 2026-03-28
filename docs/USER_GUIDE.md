# ContextGraph User Guide

> **Complete documentation for ContextGraph** - Advanced configuration, features, and troubleshooting.

---

## Table of Contents

- [Operating Modes](#operating-modes)
- [Configuration](#configuration)
- [CLI Reference](#cli-reference)
- [Output Structure](#output-structure)
- [Architecture Overview](#architecture-overview)
- [Security Model](#security-model)
- [Advanced Features](#advanced-features)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

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

## Security Model

ContextGraph enforces a strict security pipeline:

1. **Headers** — `authorization`, `cookie`, `set-cookie`, `x-api-key` and 5 others are stripped before any persistence.
2. **Body patterns** — JWT, Bearer tokens, credit cards, SSNs, emails, phone numbers, AWS keys, and generic API keys are redacted via regex.
3. **DOM** — Password field values are never captured; `<script>` content is removed entirely.
4. **Audit log** — Every redaction event is logged to `logs/redaction_audit.jsonl` for compliance review.
5. **No outbound connections** — Zero telemetry, zero cloud calls. All data stays on disk.

---

## Advanced Features

### Component Registry

Tracks reusable UI patterns across captured pages:

```json
{
  "components": {
    "login-form": {
      "occurrences": 3,
      "pages": ["login", "signup", "reset-password"],
      "selectors": ["[data-testid='login-form']", "form.auth-form"],
      "confidence": 0.95
    }
  }
}
```

### Smart Locator Ranking

ContextGraph generates 6+ selector strategies per element, ranked by resilience:

1. **Role** (most stable) - `button[name="submit"]`
2. **TestID** - `[data-testid="submit-btn"]`
3. **Label** - `button >> text=Submit`
4. **Placeholder** - `input[placeholder="Enter email"]`
5. **Text** - `text=Submit`
6. **CSS** (fallback) - `.btn.btn-primary`

### Network Traffic Analysis

Captures all HTTP traffic with automatic PII redaction:

```json
{
  "request": {
    "url": "https://api.example.com/users",
    "method": "POST",
    "headers": {
      "content-type": "application/json"
    },
    "body": "[REDACTED:JSON_PAYLOAD]"
  },
  "response": {
    "status": 200,
    "headers": {
      "content-type": "application/json"
    },
    "body": "[REDACTED:RESPONSE_DATA]"
  }
}
```

---

## Troubleshooting

### Common Issues

**Browser fails to launch:**
```bash
# Install Playwright browsers
npx playwright install msedge
```

**Permission denied on output directory:**
```bash
# Ensure write permissions
chmod 755 ./context-graph-output
```

**Memory usage high on large sites:**
```bash
# Limit capture scope
context-graph --no-screenshots --no-network --url https://example.com
```

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
context-graph --verbose --mode browser --url https://example.com
```

Check logs in:
- `./context-graph-output/logs/system.log`
- Console output with debug information

### Performance Optimization

For large applications, consider these optimizations:

1. **Disable unnecessary captures:**
   ```bash
   context-graph --no-screenshots --no-network --url https://example.com
   ```

2. **Use headless mode:**
   ```bash
   context-graph --headless --url https://example.com
   ```

3. **Limit viewport size:**
   ```bash
   context-graph --viewport 1280x720 --url https://example.com
   ```

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

### Project Status

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

## License

MIT — © Shadow Coderr

For quick start guide, installation, and basic usage, see the main [README.md](../README.md).
