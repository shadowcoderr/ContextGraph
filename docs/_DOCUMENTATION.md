# ContextGraph — Complete Technical Documentation

**Version:** 0.3 (Current) → 0.4 (Proposed)
**Author:** Shadow Coderr
**Last Updated:** 2026-03-03

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Deep-Dive](#2-architecture-deep-dive)
3. [Module Reference](#3-module-reference)
4. [Existing Logic — Issues and Improvements](#4-existing-logic--issues-and-improvements)
5. [Proposed New Features](#5-proposed-new-features)
6. [Output Schema Reference](#6-output-schema-reference)
7. [Security Model](#7-security-model)
8. [Extending ContextGraph](#8-extending-contextgraph)
9. [STLC Integration Patterns](#9-stlc-integration-patterns)

---

## 1. Project Overview

ContextGraph is a 100% offline, Playwright-native CLI tool that observes a tester's browser session and crystallises that session into structured, AI-consumable data. It bridges the gap between manual exploration and AI-assisted test generation in enterprise environments where:

- MCP (Model Context Protocol) is blocked by security policy
- Cloud-based browser recording tools are forbidden
- AI agents have no visibility into the live running application

The tool operates as a deterministic data pre-processor — it captures facts (DOM state, accessibility structure, element locators, network calls) without making any inferences, interpretations, or AI calls of its own.

### Core Design Principles

**Deterministic over Probabilistic** — The same page always produces the same output. No randomness, no model-dependent interpretation.

**Least Privilege Capture** — Only what the user navigates to is captured. No autonomous link-following, no crawling, no background scanning.

**Security by Architecture** — Sensitive data redaction is not configurable to "off". It runs in every code path before any persistence.

**AI-Context Optimised Output** — Every output file is structured to minimise token waste when fed to an LLM. Scripts, metadata noise, and irrelevant DOM are stripped.

---

## 2. Architecture Deep-Dive

### 2.1 System Flow

```
User launches CLI
       |
       v
ConfigLoader --> validates schema, merges defaults
       |
       v
RuntimeController.initialize()
  |-- StorageEngine.initialize()      creates output directory tree
  +-- ComponentsRegistryManager()     loads or creates components_registry.json
       |
       v
BrowserAdapter.launch()              spawns Edge via Playwright CDP
       |
       v
Page lifecycle events wired:
  page.on('load')          triggers captureCurrentPage()
  page.on('console')       buffers console messages
  page.on('pageerror')     buffers JS errors
  page.on('request')       NetworkLogger records outgoing
  page.on('response')      NetworkLogger records incoming
       |
       v
User navigates browser manually
       |
       v  (on each new unique URL)
CaptureEngine.capturePageSnapshot(page, config)
  |-- DOMAnalyzer.analyze()              sanitised HTML
  |-- A11yExtractor.extract()            ARIA tree JSON
  |-- LocatorGenerator.generateLocators() ranked selectors
  |-- getPerformanceMetrics()            DOM node counts
  +-- capturePageState()                 focused element, form state
       |
       v
SecurityRedactor.redact()            strips PII from all fields
       |
       v
DataValidator.validatePageSnapshot() schema integrity check
       |
       v
StorageEngine.savePageSnapshot()     writes all files to disk
ComponentsRegistryManager.processPage() updates cross-page registry
       |
       v
User presses Ctrl+C
       |
       v
RuntimeController.shutdown()
  |-- waits for pending captures (20s timeout)
  |-- saves ComponentsRegistry to disk
  +-- BrowserAdapter.close()
```

### 2.2 Component Responsibilities

| Component | File | Primary Responsibility |
|---|---|---|
| CLI Entry | src/cli/index.ts | Argument parsing, interactive wizard, shutdown signal handling |
| ConfigLoader | src/config/loader.ts | Load JSON config, merge with defaults, validate schema |
| RuntimeController | src/core/runtime.ts | Session orchestration, browser lifecycle, page deduplication |
| BrowserAdapter | src/core/browser-adapter.ts | Playwright API abstraction, event hook wiring |
| CaptureEngine | src/core/capture-engine.ts | Parallel extraction coordination, content hashing |
| DOMAnalyzer | src/analyzers/dom-analyzer.ts | HTML sanitisation, performance metrics |
| A11yExtractor | src/analyzers/a11y-extractor.ts | ARIA tree via page.accessibility.snapshot() |
| LocatorGenerator | src/analyzers/locator-generator.ts | Multi-strategy selector generation and ranking |
| NetworkLogger | src/analyzers/network-logger.ts | HTTP request/response interception |
| SecurityRedactor | src/security/redactor.ts | PII/credential redaction pipeline |
| DataValidator | src/security/validator.ts | PageSnapshot schema validation |
| ComponentsRegistry | src/registry/components-registry.ts | Cross-page UI component pattern tracking |
| StorageEngine | src/storage/engine.ts | File system persistence, manifest management |

---

## 3. Module Reference

### 3.1 DOMAnalyzer

**What it does:** Fetches the full serialised HTML of the page via `page.content()` and strips noise before saving.

Stripping pipeline:
1. All `<script>` tags and their content removed
2. Inline event handler attributes (onclick, onload, onerror, etc.) removed
3. `data-cc-captured` timestamp attribute injected on `<html>` root
4. HTML formatted/beautified for human and LLM readability

**Key output:** `dom_snapshot.html` — clean semantic HTML, no JavaScript, preserving all class, id, data-*, and aria-* attributes.

### 3.2 AccessibilityExtractor

**What it does:** Calls Playwright's `page.accessibility.snapshot()` to retrieve the browser's internal accessibility tree, then recursively normalises it into a clean JSON hierarchy.

**Why this matters for AI:** The A11y tree is the most semantically dense representation of a page. It tells an AI what the page *does* (a "Submit" button, a "Username" text field) without the visual noise of surrounding HTML.

**Key output:** `a11y_tree.json` — hierarchical JSON with role, name, value, required, disabled, checked, focused, multiline, protected per node.

**Configuration flag:** `capture.accessibility.includeHidden` — when false (default), aria-hidden elements are excluded.

### 3.3 LocatorGenerator

**What it does:** For every interactive element on the page, generates multiple selector strategies ranked by resilience.

Strategy ranking (highest to lowest):

| Rank | Strategy | Resilience | Playwright Method |
|---|---|---|---|
| 1 | Role + Name | 95 | getByRole('button', { name: 'Submit' }) |
| 2 | TestID | 90 | getByTestId('login-button') |
| 3 | Label | 85 | getByLabel('Username') |
| 4 | Placeholder | 70 | getByPlaceholder('Enter email') |
| 5 | Text | 60 | getByText('Sign In') |
| 6 | CSS | 30 | .login-form button.primary |

**Key output:** `locators.json` — array of ElementLocator objects with full locator list, computed state (visible, enabled, editable, checked), bounding box, and form field details.

### 3.4 NetworkLogger

**What it does:** Attaches to `page.on('request')` and `page.on('response')` to capture all HTTP traffic during the session. Every event is passed through SecurityRedactor before being stored.

**Key output:** `network/traffic_log.jsonl` — one JSON object per line.

### 3.5 SecurityRedactor

**What it does:** Applies regex-based redaction rules to any arbitrary data structure before it is written to disk. This is the single enforcement point for the security model.

Built-in patterns:

| Pattern | Detects | Replacement |
|---|---|---|
| jwt_token | JSON Web Tokens (eyJ...) | [REDACTED:JWT] |
| bearer_token | Bearer auth values | [REDACTED:BEARER] |
| credit_card | 16-digit card numbers | [REDACTED:CC] |
| ssn | US Social Security Numbers | [REDACTED:SSN] |
| email | Email addresses | [REDACTED:EMAIL] |
| phone_number | US/international phone | [REDACTED:PHONE] |
| api_key | Generic 20+ char keys | [REDACTED:API_KEY] |
| aws_key | AWS access keys (AKIA...) | [REDACTED:AWS_KEY] |

Always-redacted headers: authorization, cookie, set-cookie, x-api-key, x-auth-token, x-csrf-token, x-access-token, x-refresh-token, proxy-authorization.

**Audit trail:** Every redaction event is written to `logs/redaction_audit.jsonl`.

### 3.6 ComponentsRegistry

**What it does:** Tracks which UI elements appear across multiple captured pages, identifying reusable components (navigation bars, footers, modals, form patterns).

**Key output:** `components_registry.json` at the domain level.

**Value for AI:** Tells the AI "these 6 elements always appear on every page — they are navigation. Focus on the unique elements for page-specific tests."

---

## 4. Existing Logic — Issues and Improvements

### Issue 1: NetworkLogger — Request Map Collision Bug

**File:** `src/analyzers/network-logger.ts`

**Problem:** The requestMap uses `url` as its key to correlate requests with responses:

```typescript
this.requestMap.set(url, startTime);
const startTime = this.requestMap.get(url) || endTime;
```

If the same URL is requested concurrently (analytics pings, polling endpoints, parallel asset loads), later requests overwrite earlier ones. Duration calculations will be wrong or missing.

**Fix — Use WeakMap keyed on the request object itself:**

```typescript
private requestTimes = new WeakMap<object, number>();

page.on('request', (request) => {
  this.requestTimes.set(request, Date.now());
  // ...
});

page.on('response', (response) => {
  const startTime = this.requestTimes.get(response.request()) ?? Date.now();
  const duration = Date.now() - startTime;
  // ...
});
```

This is O(1), collision-free, and automatically GC'd when the request object is released.

---

### Issue 2: NetworkLogger — Missing requestfailed Handler

**File:** `src/analyzers/network-logger.ts`

**Problem:** Failed network requests (DNS errors, CORS blocks, connection refused) are silently ignored. These are valuable signals — they indicate broken endpoints or auth failures the AI needs to know about.

**Fix — Add event handler:**

```typescript
page.on('requestfailed', (request) => {
  const event: NetworkEvent = {
    timestamp: new Date().toISOString(),
    type: 'failed',
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
    failureReason: request.failure()?.errorText ?? 'Unknown failure',
    timing: { startTime: this.requestTimes.get(request) ?? Date.now() },
  };
  this.events.push(event);
});
```

---

### Issue 3: NetworkLogger — captureBody Flag Never Implemented

**File:** `src/analyzers/network-logger.ts`

**Problem:** The config flag `capture.network.captureBody` is documented, wired into the Config type, but NetworkLogger never reads it. Response bodies are never captured regardless of flag value.

**Fix:**

```typescript
if (this.config.network.captureBody) {
  const contentType = response.headers()['content-type'] ?? '';
  if (contentType.includes('json') || contentType.includes('text')) {
    const body = await response.text().catch(() => null);
    if (body) {
      const safeBody = await this.redactor.redactString(body, 'response_body', url);
      event.body = safeBody.substring(0, 2000); // Cap at 2KB to control storage size
    }
  }
}
```

---

### Issue 4: LocatorGenerator — Performance: 300+ Sequential Browser Round-Trips

**File:** `src/analyzers/locator-generator.ts`

**Problem:** For each element, `getMatchCount` is called once per locator strategy (up to 6 calls). Each call does a `page.locator(...).count()` round-trip. On a page with 50 interactive elements x 6 strategies = 300 sequential browser evaluations. On complex enterprise SPAs this causes timeouts and takes 15-30 seconds.

**Fix — Build a match-count cache using a single batched evaluate:**

```typescript
// Before iterating elements, build a cache of counts for common selectors
private matchCountCache = new Map<string, number>();

private async primeMatchCountCache(page: Page): Promise<void> {
  // Batch all CSS queries into one page.evaluate() call
  const selectors = ['button', 'a', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="textbox"]'];

  const counts = await page.evaluate((sels) => {
    return sels.map(s => {
      try { return document.querySelectorAll(s).length; }
      catch { return 0; }
    });
  }, selectors);

  selectors.forEach((s, i) => this.matchCountCache.set(s, counts[i]));
}
```

---

### Issue 5: LocatorGenerator — Fragile CSS Selector Generation

**File:** `src/analyzers/locator-generator.ts`

**Problem:** CSS fallback builds selectors by joining all class names. For Tailwind/Bootstrap utility classes this produces extremely long, fragile selectors like `a.nav-link.active.text-sm.font-medium.hover:text-primary.dark:text-white`.

**Fix — Smarter class filtering:**

```typescript
private buildCssSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;

  // Prefer meaningful semantic classes over utility classes
  const meaningfulClass = Array.from(el.classList).find(c =>
    !c.match(/^(text-|bg-|p-|m-|px-|py-|flex|grid|block|inline|hover:|focus:|dark:|sm:|md:|lg:|xl:|w-|h-|border-|rounded-)/)
  );
  if (meaningfulClass) return `${el.tagName.toLowerCase()}.${meaningfulClass}`;

  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;

  // Structural fallback as last resort
  const idx = Array.from(el.parentElement?.children ?? []).indexOf(el) + 1;
  return `${el.tagName.toLowerCase()}:nth-child(${idx})`;
}
```

---

### Issue 6: CaptureEngine — Shadow DOM Not Captured

**File:** `src/core/capture-engine.ts` / `src/analyzers/dom-analyzer.ts`

**Problem:** `page.content()` returns the light DOM only. Shadow DOM (used in Web Components, Angular Elements, Lit) is completely omitted. On modern enterprise SPAs, critical form fields and navigation often live inside shadow roots.

**Fix — Inject serialisation script before DOM capture:**

```typescript
const domWithShadow: string = await page.evaluate(() => {
  function serializeWithShadow(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes).map(a => `${a.name}="${a.value}"`).join(' ');
    let inner = Array.from(el.childNodes).map(serializeWithShadow).join('');

    if ((el as any).shadowRoot) {
      inner += `<template shadowrootmode="open">${
        Array.from((el as any).shadowRoot.childNodes).map(serializeWithShadow).join('')
      }</template>`;
    }

    return `<${tag}${attrs ? ' ' + attrs : ''}>${inner}</${tag}>`;
  }
  return `<!DOCTYPE html><html>${serializeWithShadow(document.documentElement)}</html>`;
});
```

---

### Issue 7: StorageEngine — Statistics Object Never Updated

**File:** `src/storage/engine.ts`

**Problem:** `totalNetworkRequests`, `totalScreenshots`, and `storageSize` are initialised to 0/"0 MB" and are never updated anywhere in the codebase.

**Fix:**

```typescript
// In updateGlobalManifest(), accept additional counts
async updateGlobalManifest(
  entry: ManifestEntry,
  extras: { networkRequests?: number; screenshots?: number } = {}
): Promise<void> {
  // ...existing manifest loading...
  manifest.statistics.totalPages = manifest.domains.reduce((s, d) => s + d.pages.length, 0);
  manifest.statistics.totalDomains = manifest.domains.length;
  manifest.statistics.totalNetworkRequests += (extras.networkRequests ?? 0);
  manifest.statistics.totalScreenshots += (extras.screenshots ?? 0);
  manifest.statistics.storageSize = await this.computeStorageSize();
  // ...
}

private async computeStorageSize(): Promise<string> {
  const bytes = await this.getDirectorySizeBytes(this.outputDir);
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

---

### Issue 8: CaptureEngine — Content Hash Truncation

**File:** `src/core/capture-engine.ts`

**Problem:** `normalizeDomForHash` truncates DOM to only 5000 characters. For SPAs where the first 5000 chars are boilerplate `<head>` content, two structurally different page states may hash identically, causing the second visit to be silently skipped.

**Fix — Hash a structural fingerprint instead of a text substring:**

```typescript
private normalizeDomForHash(dom: string): string {
  // Extract tag+id/role tokens only — pure structure, no text
  const tagPattern = /<([a-z][a-z0-9]*)[^>]*(?:id="([^"]+)"|role="([^"]+)")?/gi;
  const tokens: string[] = [];
  let match;
  let count = 0;

  while ((match = tagPattern.exec(dom)) !== null && count++ < 300) {
    tokens.push(`${match[1]}${match[2] ? '#' + match[2] : ''}${match[3] ? '@' + match[3] : ''}`);
  }

  return tokens.join('|');
}
```

---

### Issue 9: SecurityRedactor — URL Query Params Not Redacted

**File:** `src/security/redactor.ts`

**Problem:** Sensitive values in URL query parameters (?token=xxx, ?api_key=yyy, ?auth=zzz) are not redacted. These values appear in network log URL fields.

**Fix — Add URL sanitisation step called on every stored URL:**

```typescript
sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const sensitiveParams = ['token', 'api_key', 'auth', 'key', 'secret', 'password', 'pwd', 'apikey', 'access_token'];
    let redacted = false;

    sensitiveParams.forEach(param => {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
        redacted = true;
      }
    });

    return parsed.toString();
  } catch {
    return url;
  }
}
```

---

### Issue 10: LocatorGenerator — Missing Interactive Element Types

**File:** `src/analyzers/locator-generator.ts`

**Problem:** The selectorStrategies list misses common modern interactive patterns: contenteditable rich text editors, custom tabindex components, details/summary disclosure elements, and native dialog elements.

**Fix — Extend selectorStrategies:**

```typescript
{ selector: '[contenteditable="true"]', name: 'contenteditable' },
{ selector: 'details > summary', name: 'summary' },
{ selector: 'dialog:not([hidden])', name: 'dialog' },
{ selector: '[tabindex]:not([tabindex="-1"]):not(a):not(button):not(input):not(select):not(textarea)', name: 'custom-interactive' },
```

---

## 5. Proposed New Features

### Feature 1: AIContextBundler (HIGHEST PRIORITY)

**Purpose:** The most critical missing piece. Currently, using the output with an AI requires manually copy-pasting many files. The AIContextBundler packages an entire session into a single optimised Markdown or JSON file for direct LLM injection.

**File:** `src/exporters/ai-context-bundler.ts`

**Generated output structure (`session_context.md`):**

```markdown
# Application Context: app.example.com
## Session: session_20251213_103045  |  Pages: 4  |  Duration: 12m

---

## Page 1 of 4: Login Page
URL: https://app.example.com/login

### Interactive Elements
| Element | Best Locator | State |
|---|---|---|
| Username | getByLabel('Username') | enabled |
| Password | getByLabel('Password') | enabled |
| Sign In  | getByRole('button', { name: 'Sign In' }) | enabled |

### Page Structure (Accessibility)
main > form[Login Form]
  textbox[Username] (required)
  textbox[Password] (protected)
  button[Sign In]

### API Calls on This Page
POST /api/auth/login -> 200 (245ms)
GET  /api/user/profile -> 200 (89ms)
```

**Usage:**

```bash
context-graph --export-bundle
# Writes: context-graph-output/bundles/latest_context.md
```

**Why this closes the loop:** An AI agent can receive a single file, understand the entire captured journey, and generate tests without requiring the user to manually compose context from 6+ files per page.

---

### Feature 2: TestScaffoldGenerator

**Purpose:** Generate a compilable, runnable skeleton Playwright `.spec.ts` test file from captured locators and navigation patterns. Pure template-based — no AI required. Gives testers a starting point that already imports correctly and references real locators.

**File:** `src/generators/test-scaffold.ts`

**Generated output example:**

```typescript
// AUTO-GENERATED by ContextGraph v0.3
// Session: session_20251213_103045  |  2025-12-13
// Review all TODO comments before running

import { test, expect } from '@playwright/test';

test.describe('Login Flow — app.example.com', () => {

  test('should display the login page correctly', async ({ page }) => {
    await page.goto('https://app.example.com/login');
    await expect(page.getByRole('heading')).toBeVisible();
    // TODO: Add specific heading text assertion
  });

  test('should allow a user to sign in', async ({ page }) => {
    await page.goto('https://app.example.com/login');

    await page.getByLabel('Username').fill('TODO: valid username');
    await page.getByLabel('Password').fill('TODO: valid password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Observed post-login navigation in captured session
    await expect(page).toHaveURL(/dashboard/);
    // TODO: Assert dashboard-specific elements
  });

});
```

**Usage:**

```bash
context-graph --generate-scaffold --output ./tests/generated/
```

---

### Feature 3: PageDiffAnalyzer

**Purpose:** Compare two captures of the same URL (from different sessions or releases) to detect changes in DOM structure, locators, and API behaviour. Feeds structured diff reports to AI for regression analysis.

**File:** `src/analyzers/page-diff.ts`

**Key analysis dimensions:**

- Locator drift — elements whose best locator strategy changed (high test breakage risk)
- New elements — interactive elements in current capture not present in baseline
- Removed elements — locators from baseline that no longer exist
- Network changes — new API endpoints, changed status codes, new/removed parameters
- A11y regressions — role or accessible name changes (WCAG impact)

**Output:** `diff_report.json` per compared page pair.

**Usage:**

```bash
context-graph --diff \
  --baseline ./context-graph-output/domains/app.com/pages/session_A/20251213_103045/ \
  --current  ./context-graph-output/domains/app.com/pages/session_B/20260103_091200/ \
  --output   ./diffs/login-page-diff.json
```

---

### Feature 4: NetworkPatternAnalyzer

**Purpose:** Post-processes `traffic_log.jsonl` to produce a structured API inventory — all unique endpoints, HTTP methods, parameter patterns, and status codes. Critical for AI to understand the backend surface area without needing Swagger/OpenAPI docs.

**File:** `src/analyzers/network-patterns.ts`

**Output — `api_inventory.json`:**

```json
{
  "baseUrl": "https://api.example.com",
  "capturedDuration": "00:12:34",
  "endpoints": [
    {
      "method": "POST",
      "path": "/auth/login",
      "parameterPattern": null,
      "observedCount": 1,
      "statusCodes": [200],
      "avgDurationMs": 245,
      "hasRequestBody": true,
      "contentType": "application/json"
    },
    {
      "method": "GET",
      "path": "/user/{id}/profile",
      "parameterPattern": "/user/[0-9]+/profile",
      "observedCount": 3,
      "statusCodes": [200, 404],
      "avgDurationMs": 89
    }
  ]
}
```

URL parameter extraction uses a heuristic to detect path segments that look like IDs (/user/12345/ becomes /user/{id}/) for cleaner endpoint grouping.

---

### Feature 5: Manual Capture Trigger (CaptureTriggerManager)

**Purpose:** The current tool auto-captures only on page navigation. SPAs that do not change the URL (modal opens, tab switches, accordion expand, wizard steps within a single route) are completely missed. This is a major gap for enterprise CRUD applications.

**Trigger modes:**

1. **Keyboard shortcut (F9)** — user presses F9 in the captured browser → immediate snapshot of current DOM state
2. **Time-based interval** — capture every N seconds (useful for dynamic dashboards)
3. **DOM mutation threshold** — capture when a significant subtree change is detected (MutationObserver)

**Implementation for F9 trigger:**

```typescript
// Injected into every page via page.addInitScript()
await page.addInitScript(() => {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F9') {
      (window as any).__cc_trigger_capture?.();
    }
  });
});

await page.exposeFunction('__cc_trigger_capture', async () => {
  logger.info('Manual capture triggered via F9');
  await this.captureCurrentPage(page);
});
```

**Config addition:**

```json
{
  "capture": {
    "triggers": {
      "onNavigation": true,
      "manualKey": "F9",
      "intervalSeconds": 0,
      "domMutationThreshold": 50
    }
  }
}
```

---

### Feature 6: LocalStorageCapture

**Purpose:** Modern SPAs store critical application state in localStorage and sessionStorage — feature flags, user preferences, routing state, cached API responses. This context is entirely invisible to the current capture pipeline, creating a gap in the context fed to AI.

**File:** `src/analyzers/storage-capture.ts`

**Output — `storage_state.json`:**

```json
{
  "capturedAt": "2025-12-13T10:30:45.123Z",
  "localStorage": {
    "user_preferences": "{\"theme\":\"dark\",\"language\":\"en\"}",
    "feature_flags": "{\"newDashboard\":true,\"betaReports\":false}",
    "auth_token": "[REDACTED]"
  },
  "sessionStorage": {
    "current_form_step": "3",
    "wizard_answers": "{\"step1\":\"option_b\"}"
  },
  "cookieCount": 4
}
```

Token-shaped values (starting with eyJ, or keys containing "token", "auth", "secret") are automatically redacted. Cookie values are never captured — only the count.

---

### Feature 7: PageHealthChecker

**Purpose:** Automatically audit each captured page for quality issues that AI-generated tests should be aware of: broken images, missing ARIA labels, console errors, form accessibility gaps.

**File:** `src/analyzers/page-health.ts`

**Output — `health_report.json`:**

```json
{
  "score": 82,
  "capturedAt": "2025-12-13T10:30:45.123Z",
  "issues": [
    {
      "severity": "warning",
      "category": "accessibility",
      "message": "3 images are missing alt text",
      "affectedSelectors": ["img.hero-banner", "img:nth-child(3)"]
    },
    {
      "severity": "error",
      "category": "javascript",
      "message": "Uncaught TypeError: Cannot read properties of null (reading 'value')",
      "location": "app.bundle.js:4521"
    },
    {
      "severity": "info",
      "category": "forms",
      "message": "2 form inputs have no associated label element",
      "affectedSelectors": ["input[name='phone']", "input[name='ext']"]
    }
  ]
}
```

---

### Feature 8: UserFlowAnnotator

**Purpose:** Allows testers to assign meaningful step names to captured pages, mapping them to business requirements and test cases. Turns a raw session into a named, structured test flow.

**Usage — during session (interactive prompt when F9 is pressed):**

```
[F9 pressed]
> Capture triggered. Enter a step name (or press Enter to skip):
  "Step 2: User enters login credentials"
> Saved.
```

**Output — `flow_annotations.json` at session level:**

```json
{
  "flowName": "User Registration Flow",
  "businessRequirement": "REQ-AUTH-001",
  "steps": [
    {
      "stepNumber": 1,
      "name": "Navigate to Registration Page",
      "pageId": "20251213_103045_a4b8c2d",
      "url": "https://app.example.com/register",
      "notes": "Entry point from landing page CTA"
    },
    {
      "stepNumber": 2,
      "name": "Complete Registration Form",
      "pageId": "20251213_103112_b5c9d3e",
      "url": "https://app.example.com/register/details"
    }
  ]
}
```

**Post-session annotation via CLI:**

```bash
context-graph --annotate --session session_20251213_103045
```

---

## 6. Output Schema Reference

### metadata.json

```json
{
  "captureId": "20251213_103045_a4b8c2d",
  "sessionId": "session_20251213_103045",
  "url": "https://app.example.com/login",
  "domain": "app.example.com",
  "title": "Sign In — Example App",
  "mode": "browser",
  "timestamp": "2025-12-13T10:30:45.123Z",
  "viewport": { "width": 1920, "height": 1080 },
  "timing": {
    "navigationStart": 1702467044000,
    "domContentLoaded": 1702467044500,
    "loadComplete": 1702467045000
  },
  "performance": {
    "domNodes": 342,
    "scripts": 8,
    "stylesheets": 3,
    "images": 12,
    "totalRequests": 24
  },
  "contentHash": "a4b8c2d1e5f63g72"
}
```

### locators.json (per element shape)

```json
{
  "elementId": "elem_001",
  "tagName": "button",
  "text": "Sign In",
  "locators": [
    {
      "strategy": "role",
      "value": "getByRole('button', { name: 'Sign In' })",
      "confidence": "high",
      "resilience": 95,
      "matchCount": 1,
      "isUnique": true
    },
    {
      "strategy": "testid",
      "value": "getByTestId('login-submit-btn')",
      "confidence": "high",
      "resilience": 90,
      "matchCount": 1,
      "isUnique": true
    },
    {
      "strategy": "css",
      "value": "button.btn-primary",
      "confidence": "low",
      "resilience": 30,
      "matchCount": 2,
      "isUnique": false
    }
  ],
  "attributes": {
    "type": "submit",
    "data-testid": "login-submit-btn",
    "class": "btn btn-primary"
  },
  "computedState": {
    "isVisible": true,
    "isEnabled": true,
    "isChecked": false,
    "isEditable": false,
    "isFocusable": true
  },
  "position": { "x": 480, "y": 320, "width": 120, "height": 40 },
  "styles": {
    "backgroundColor": "rgb(0, 120, 212)",
    "color": "rgb(255, 255, 255)",
    "fontSize": "16px",
    "fontWeight": "600"
  }
}
```

### global_manifest.json (top-level)

```json
{
  "version": "0.3.0",
  "createdAt": "2025-12-13T10:00:00.000Z",
  "lastUpdated": "2025-12-13T11:30:00.000Z",
  "sessions": [
    {
      "sessionId": "session_20251213_103045",
      "mode": "browser",
      "startTime": "2025-12-13T10:30:45.000Z",
      "endTime": "2025-12-13T10:43:12.000Z",
      "domains": ["app.example.com"],
      "totalPages": 4
    }
  ],
  "domains": [
    {
      "domain": "app.example.com",
      "firstVisited": "2025-12-13T10:30:45.000Z",
      "lastVisited": "2025-12-13T10:43:12.000Z",
      "totalVisits": 4,
      "pages": [ ]
    }
  ],
  "statistics": {
    "totalSessions": 1,
    "totalDomains": 1,
    "totalPages": 4,
    "totalNetworkRequests": 96,
    "totalScreenshots": 4,
    "storageSize": "14.2 MB"
  }
}
```

---

## 7. Security Model

### Threat Model

| Threat | Attack Vector | Mitigation |
|---|---|---|
| Credential leakage | Login forms in DOM/network | Password fields never serialised; JWT/Bearer redacted |
| Session hijacking | Cookie values in network headers | cookie and set-cookie always stripped |
| PII exposure | Names, emails, SSNs in page content | 8 built-in patterns + custom rule support |
| API key disclosure | Keys in query params or response headers | URL param sanitisation + header blacklist |
| Insider data leak | Captured files shared externally | 100% local — zero outbound connections ever made |
| Storage-based secrets | localStorage tokens | StorageCapture (proposed) redacts token-shaped values |

### Security Invariants (Hardcoded, Cannot Be Disabled)

1. `<script>` tag content is ALWAYS stripped from DOM snapshots
2. `type="password"` input values are ALWAYS replaced with [REDACTED]
3. The `authorization`, `cookie`, and `set-cookie` headers are ALWAYS removed
4. No network call is ever made to any external service — zero telemetry, zero update checks, zero analytics
5. Redaction runs BEFORE any disk write — there is no "raw then redact" staging

### Redaction Data Flow

```
Raw Data
  |
  v
[1] Header Stripping        (exact match against header name blacklist)
  |
  v
[2] URL Sanitisation        (query param sensitive key detection)
  |
  v
[3] Pattern Matching        (recursive regex over all string values)
  |
  v
[4] Custom Rules            (user-defined patterns from config file)
  |
  v
Redacted Data --> Audit Log Entry --> File System Write
```

---

## 8. Extending ContextGraph

### Adding a New Analyzer

1. Create `src/analyzers/your-analyzer.ts`:

```typescript
import { Page } from '@playwright/test';
import { logger } from '../utils/logger';

export class YourAnalyzer {
  async analyze(page: Page): Promise<YourOutputType> {
    logger.info('Starting YourAnalyzer');
    // Your extraction logic here
    return result;
  }
}
```

2. Add output type to `src/types/capture.ts` in the PageSnapshot interface:

```typescript
export interface PageSnapshot {
  // existing fields...
  yourData?: YourOutputType;
}
```

3. Integrate in `CaptureEngine.capturePageSnapshot()`:

```typescript
const yourResult = await captureWithTimeout(
  this.yourAnalyzer.analyze(page),
  'YourAnalyzer'
);
```

4. Persist in `StorageEngine.savePageSnapshot()`:

```typescript
if (snapshot.yourData) {
  await fs.writeJson(path.join(pageDir, 'your_output.json'), snapshot.yourData);
}
```

### Adding a New Security Redaction Pattern

Add to `src/security/patterns.ts`:

```typescript
{
  name: 'your_pattern_name',
  pattern: /YOUR_REGEX_HERE/g,
  replacement: '[REDACTED:YOUR_LABEL]',
  severity: 'high'  // 'critical' | 'high' | 'medium' | 'low'
}
```

### Adding a New CLI Command

Add to `src/cli/commands.ts`:

```typescript
program
  .command('your-command')
  .description('What your command does')
  .option('--your-flag <value>', 'Flag description', 'default-value')
  .action(async (options) => {
    const config = await loadConfig(options.config);
    // Command implementation
  });
```

---

## 9. STLC Integration Patterns

### Pattern A: AI-Assisted Test Generation (Primary Use Case)

```
1. Tester runs happy-path walkthrough
   context-graph --mode browser --url https://app.example.com

2. Export AI context bundle (proposed Feature 1)
   context-graph --export-bundle

3. Paste session_context.md into AI IDE agent
   Prompt: "Here is my application context: [paste]
            Generate Playwright tests for the login flow."

4. Review AI-generated tests, fill in test data TODOs

5. Run tests
   npx playwright test --headed

6. Commit passing tests
```

### Pattern B: Regression Detection Between Releases

```
1. Capture baseline before release
   context-graph --mode browser --url https://staging.example.com
   mv context-graph-output context-graph-baseline

2. Deploy release candidate to staging

3. Capture current state
   context-graph --mode browser --url https://staging.example.com

4. Diff the two sessions (proposed Feature 3)
   context-graph --diff \
     --baseline ./context-graph-baseline/domains/staging.example.com/ \
     --current  ./context-graph-output/domains/staging.example.com/

5. Review diff_report.json — locator drift = tests likely to break
```

### Pattern C: Enterprise App Onboarding (No Dev Access)

When QA receives an undocumented application:

```
1. Capture entire app navigation over 1-2 hours
   context-graph --mode browser --url https://internal-erp.corp.com

2. Generate API inventory (proposed Feature 4)
   context-graph --analyze-network

3. Feed to AI in IDE:
   "I need to write integration tests for this application.
    Here is the complete API surface: [paste api_inventory.json]
    Here is the UI structure: [paste session_context.md]
    Generate a test plan covering the main user flows."

4. Use AI output as test specification, refine with test team
```

### Pattern D: Manual Test Script Conversion (Recorder Mode)

```
1. Open existing manual test document

2. Start recorder mode
   context-graph --mode recorder \
     --url https://app.example.com \
     --capture-artifacts

3. Follow the manual test script step by step in the browser

4. Close recorder — auto-generates app.example.com.spec.ts
   with all your steps as Playwright actions

5. Add assertions (or ask AI to add them given the a11y tree context)

6. Run and verify
   npx playwright test app.example.com.spec.ts
```

---

## Document Metadata

| Field | Value |
|---|---|
| Version | 0.3 Current + 0.4 Proposed |
| Author | Shadow Coderr |
| Document type | Technical Reference + Improvement Specification |
| Target audience | Senior QA Engineers, TypeScript Developers |
| Status | Active development reference |
| Last reviewed | 2026-03-03 |

---

*End of ContextGraph Technical Documentation*
