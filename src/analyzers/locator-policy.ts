import { Locator } from '../types/capture';

export const LOCATOR_STRATEGY_PRIORITY: Record<Locator['strategy'], number> = {
  role: 100,
  testid: 90,
  label: 80,
  placeholder: 70,
  text: 65,
  css: 10,
};

export function volatilityForLocator(value: string): 'low' | 'medium' | 'high' {
  const len = value.length;
  if (/getByText\('.{45,}'\)/.test(value) || /\s{2,}/.test(value)) return 'high';
  if (/getByText\(/.test(value) || /getByPlaceholder\(/.test(value)) return 'medium';
  if (/\.[a-zA-Z0-9_-]{12,}/.test(value) || /nth-child\(/.test(value)) return 'high';
  if (len > 120) return 'high';
  return 'low';
}

export function scoreLocator(locator: Locator): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = LOCATOR_STRATEGY_PRIORITY[locator.strategy] ?? 0;
  reasons.push(`base:${locator.strategy}=${score}`);

  if (locator.isUnique) {
    score += 25;
    reasons.push('unique:+25');
  }

  if (locator.strategy === 'role' && /\{\s*name:/.test(locator.value)) {
    score += 10;
    reasons.push('role+name:+10');
  }

  if (locator.strategy === 'css') {
    score -= 20;
    reasons.push('css-penalty:-20');
  }

  const volatility = volatilityForLocator(locator.value);
  if (volatility === 'medium') {
    score -= 8;
    reasons.push('volatility:medium:-8');
  } else if (volatility === 'high') {
    score -= 15;
    reasons.push('volatility:high:-15');
  }

  return { score, reasons };
}

export function pickBestLocator(locators: Locator[]): Locator | undefined {
  return [...locators].sort((a, b) => {
    const sa = scoreLocator(a).score;
    const sb = scoreLocator(b).score;
    if (sb !== sa) return sb - sa;
    return (b.resilience ?? 0) - (a.resilience ?? 0);
  })[0];
}
