// Developer: Shadow Coderr, Architect
import { Page } from '@playwright/test';
import { NotificationState, NotificationOptions } from '../types/notifications';
import { logger } from '../utils/logger';

const NOTIFIER_CSS = `
#cg-notifier {
  position: fixed !important;
  top: 16px !important;
  right: 16px !important;
  left: auto !important;
  z-index: 2147483647 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 10px 14px !important;
  border-radius: 8px !important;
  font: 500 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  box-shadow: 0 4px 16px rgba(0,0,0,.18), 0 1px 4px rgba(0,0,0,.12) !important;
  color: #fff !important;
  pointer-events: none !important;
  max-width: min(calc(100vw - 32px), 440px) !important;
  min-width: 200px !important;
  box-sizing: border-box !important;
  opacity: 1 !important;
  transition: opacity .35s ease !important;
  transform: translateZ(0) !important;
}
#cg-notifier[data-cg-state="processing"] { background: #1e1e3f !important; border-left: 3px solid #6366f1 !important; }
#cg-notifier[data-cg-state="success"]    { background: #14532d !important; border-left: 3px solid #22c55e !important; }
#cg-notifier[data-cg-state="error"]      { background: #450a0a !important; border-left: 3px solid #ef4444 !important; }
#cg-notifier[data-cg-state="warning"]    { background: #451a03 !important; border-left: 3px solid #f97316 !important; }
#cg-notifier .cg-badge {
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: .05em !important;
  opacity: .7 !important;
  text-transform: uppercase !important;
  flex-shrink: 0 !important;
}
#cg-notifier .cg-text {
  min-width: 0 !important;
  overflow-wrap: anywhere !important;
}
#cg-notifier .cg-spinner {
  width: 13px !important;
  height: 13px !important;
  border: 2px solid rgba(255,255,255,.25) !important;
  border-top-color: #fff !important;
  border-radius: 50% !important;
  animation: cg-spin .75s linear infinite !important;
  flex-shrink: 0 !important;
}
@media (max-width: 767px) {
  #cg-notifier {
    top: 12px !important;
    right: 12px !important;
    min-width: calc(100vw - 48px) !important;
    max-width: calc(100vw - 24px) !important;
    font-size: 12px !important;
  }
}
@keyframes cg-spin { to { transform: rotate(360deg); } }
`.trim();

const DEFAULT_MESSAGES: Record<NotificationState, string> = {
  processing: 'ContextGraph capturing…',
  success: '✓ Capture complete',
  error: '⚠ Capture failed',
  warning: 'ContextGraph still processing…',
};

export class PageNotifier {
  private readonly enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

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

  async show(page: Page, state: NotificationState, options?: NotificationOptions): Promise<void> {
    if (!this.enabled) return;

    const message = options?.message ?? DEFAULT_MESSAGES[state];
    const autoDismissMs = options?.autoDismissMs ?? (state === 'success' ? 4000 : 0);
    
    try {
      await page.evaluate(({ css, state, message, autoDismissMs }) => {
        if (!document.getElementById('cg-notifier-styles')) {
          const style = document.createElement('style');
          style.id = 'cg-notifier-styles';
          style.textContent = css;
          (document.head || document.documentElement).appendChild(style);
        }

        let el = document.getElementById('cg-notifier') as HTMLElement | null;
        if (!el) {
          el = document.createElement('div');
          el.id = 'cg-notifier';
          (document.body || document.documentElement).appendChild(el);
        }

        el.setAttribute('data-cg-state', state);
        el.style.opacity = '1';

        const spinner = state === 'processing' ? '<span class="cg-spinner"></span>' : '';
        el.innerHTML = `${spinner}<span class="cg-badge">ContextGraph</span><span class="cg-text">${message}</span>`;
        
        const w = window as any;
        if (w.__cgDismissTimer) {
          clearTimeout(w.__cgDismissTimer);
          w.__cgDismissTimer = null;
        }

        if (autoDismissMs > 0) {
          w.__cgDismissTimer = window.setTimeout(() => {
            const current = document.getElementById('cg-notifier') as HTMLElement | null;
            if (!current) return;
            current.style.opacity = '0';
            window.setTimeout(() => current.remove(), 350);
          }, autoDismissMs);
        }
      }, { css: NOTIFIER_CSS, state, message, autoDismissMs });
    } catch (error) {
      logger.debug(`PageNotifier.show(${state}) failed (non-fatal): ${(error as Error).message}`);
    }
  }

  async hide(page: Page): Promise<void> {
    if (!this.enabled) return;
    try {
      await page.evaluate(() => {
        const w = window as any;
        if (w.__cgDismissTimer) {
          clearTimeout(w.__cgDismissTimer);
          w.__cgDismissTimer = null;
        }
        const el = document.getElementById('cg-notifier') as HTMLElement | null;
        if (!el) return;
        el.style.opacity = '0';
        window.setTimeout(() => el.remove(), 350);
      });
    } catch (error) {
      logger.debug(`PageNotifier.hide failed (non-fatal): ${(error as Error).message}`);
    }
  }
}
