// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import { NotificationState, NotificationOptions } from '../types/notifications';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Styles injected as a <style> tag into the captured page's <head>.
// These are intentionally scoped under the #cg-notifier id to avoid any CSS
// collision with the host application. pointer-events: none ensures the
// overlay never intercepts user clicks.
// ---------------------------------------------------------------------------
const NOTIFIER_CSS = `
#cg-notifier {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18), 0 1px 4px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.35s ease;
  color: #ffffff;
  user-select: none;
  -webkit-user-select: none;
}
#cg-notifier[data-cg-state="processing"] { background: #1e1e3f; border-left: 3px solid #6366f1; }
#cg-notifier[data-cg-state="success"]    { background: #14532d; border-left: 3px solid #22c55e; }
#cg-notifier[data-cg-state="error"]      { background: #450a0a; border-left: 3px solid #ef4444; }
#cg-notifier[data-cg-state="warning"]    { background: #451a03; border-left: 3px solid #f97316; }
#cg-notifier .cg-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  opacity: 0.65;
  text-transform: uppercase;
  flex-shrink: 0;
}
#cg-notifier .cg-text { flex: 1; }
.cg-spinner {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: cg-spin 0.75s linear infinite;
  flex-shrink: 0;
}
@keyframes cg-spin { to { transform: rotate(360deg); } }
`.trim();

// ---------------------------------------------------------------------------
// Default messages for each state
// ---------------------------------------------------------------------------
const DEFAULT_MESSAGES: Record<NotificationState, string> = {
  processing: 'ContextGraph capturing…',
  success: '✓ Capture complete',
  error: '⚠ Capture failed',
  warning: 'ContextGraph still processing…',
};

/**
 * PageNotifier
 *
 * Injects and manages a lightweight, non-blocking notification overlay directly
 * on the captured web page so users can see at a glance whether ContextGraph is
 * actively processing a page.
 *
 * Design guarantees:
 *  - All page.evaluate() calls are wrapped in try-catch; a failure in the
 *    notifier never aborts or affects the capture pipeline.
 *  - pointer-events: none means the overlay never intercepts user interactions.
 *  - When notifications.enabled is false every method is a no-op.
 *  - The overlay self-cleans when the page navigates (the DOM is reset).
 */
export class PageNotifier {
  private readonly enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Injects the notification stylesheet into the page.
   * Called once during setupPage() as an optimistic preload.
   * show() also calls this internally, so injectStyles() is never required
   * before show() — it is purely an optimization.
   */
  async injectStyles(page: Page): Promise<void> {
    if (!this.enabled) return;
    try {
      await page.evaluate((css: string) => {
        if (document.getElementById('cg-notifier-styles')) return;
        const style = document.createElement('style');
        style.id = 'cg-notifier-styles';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      }, NOTIFIER_CSS);
    } catch (error) {
      logger.debug(`PageNotifier.injectStyles failed (non-fatal): ${(error as Error).message}`);
    }
  }

  /**
   * Shows the overlay in the given state.
   * Creates the overlay element if it does not yet exist (e.g. after navigation).
   * Also ensures the stylesheet is injected in the same evaluate() call so the
   * method is fully self-contained.
   */
  async show(
    page: Page,
    state: NotificationState,
    options?: NotificationOptions,
  ): Promise<void> {
    if (!this.enabled) return;

    const message = options?.message ?? DEFAULT_MESSAGES[state];
    const autoDismissMs = options?.autoDismissMs ?? (state === 'success' ? 4000 : 0);

    try {
      await page.evaluate(
        ({ css, state, message, autoDismissMs }: {
          css: string;
          state: NotificationState;
          message: string;
          autoDismissMs: number;
        }) => {
          // Ensure stylesheet is present
          if (!document.getElementById('cg-notifier-styles')) {
            const style = document.createElement('style');
            style.id = 'cg-notifier-styles';
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
          }

          // Create or reuse overlay element
          let el = document.getElementById('cg-notifier') as HTMLElement | null;
          if (!el) {
            el = document.createElement('div');
            el.id = 'cg-notifier';
            (document.body || document.documentElement).appendChild(el);
          }

          // Update state attribute and content
          el.setAttribute('data-cg-state', state);
          el.style.opacity = '1';

          const spinnerHtml =
            state === 'processing'
              ? '<div class="cg-spinner"></div>'
              : '';

          el.innerHTML = `
            ${spinnerHtml}
            <span class="cg-badge">ContextGraph</span>
            <span class="cg-text">${message}</span>
          `.trim();

          // Clear any pending auto-dismiss timer
          const w = window as any;
          if (w.__cgDismissTimer) {
            clearTimeout(w.__cgDismissTimer);
            w.__cgDismissTimer = null;
          }

          // Set new auto-dismiss timer if requested
          if (autoDismissMs > 0) {
            w.__cgDismissTimer = setTimeout(() => {
              const overlay = document.getElementById('cg-notifier') as HTMLElement | null;
              if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 350);
              }
            }, autoDismissMs);
          }
        },
        { css: NOTIFIER_CSS, state, message, autoDismissMs },
      );
    } catch (error) {
      // Non-fatal: the page may be navigating or already closed.
      logger.debug(`PageNotifier.show(${state}) failed (non-fatal): ${(error as Error).message}`);
    }
  }

  /**
   * Immediately removes the overlay from the page.
   * Safe to call even if the overlay has already been dismissed.
   */
  async hide(page: Page): Promise<void> {
    if (!this.enabled) return;
    try {
      await page.evaluate(() => {
        const w = window as any;
        if (w.__cgDismissTimer) {
          clearTimeout(w.__cgDismissTimer);
          w.__cgDismissTimer = null;
        }
        const el = document.getElementById('cg-notifier');
        if (el) el.remove();
      });
    } catch (error) {
      logger.debug(`PageNotifier.hide failed (non-fatal): ${(error as Error).message}`);
    }
  }
}
