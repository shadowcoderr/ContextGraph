// Developer: Shadow Coderr, Architect

/**
 * The visual state of the in-page notification overlay.
 *
 * - processing : spinner shown; capture is in progress
 * - success    : capture completed successfully; auto-dismisses after a delay
 * - error      : all capture attempts failed; persists until next navigation
 * - warning    : capture is taking longer than expected
 */
export type NotificationState = 'processing' | 'success' | 'error' | 'warning';

/**
 * Per-call options that override the defaults for a single show() invocation.
 */
export interface NotificationOptions {
  /**
   * Override the default message for this state.
   * If omitted, the built-in default for the state is used.
   */
  message?: string;

  /**
   * Milliseconds after which the overlay automatically dismisses itself.
   * Set to 0 to disable auto-dismiss (the overlay persists until explicitly
   * hidden or until the next show() call).
   * Defaults: success → 4 000 ms, all other states → 0.
   */
  autoDismissMs?: number;
}

/**
 * Audit record of a single notification event.
 * Populated internally by PageNotifier; may be used for debugging.
 */
export interface NotificationEvent {
  state: NotificationState;
  message: string;
  timestamp: string;
  pageUrl: string;
}
