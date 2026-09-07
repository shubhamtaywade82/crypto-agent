import type { TradeDirection } from '../primitives.js';

/** A structured trade proposal — produced by deterministic engines or the LLM. */
export interface TradeProposal {
  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly orderType: 'MARKET' | 'LIMIT';
  readonly leverage: number;
  readonly setupType: string;
  readonly confidence: number;
  readonly thesis: string;
  readonly invalidation: string;
  /** LLM/agent that produced the proposal. */
  readonly source: 'SETUP_ENGINE' | 'LLM_STRATEGIST' | 'MANUAL';
}

export interface RrBreakdown {
  readonly risk: number;
  readonly reward: number;
  readonly rr: number;
}

/** R:R is computed with hard direction-dependent arithmetic. */
export const computeRr = (p: TradeProposal): RrBreakdown => {
  const risk = p.direction === 'LONG' ? p.entry - p.stopLoss : p.stopLoss - p.entry;
  const reward = p.direction === 'LONG' ? p.takeProfit - p.entry : p.entry - p.takeProfit;
  const rr = risk > 0 ? reward / risk : 0;
  return { risk, reward, rr };
};

export interface ValidationResult {
  readonly valid: boolean;
  readonly reasons: string[];
  readonly rr: number;
}

/**
 * Structural validator. These checks are invariants, not opinions:
 *   LONG : SL < entry < TP
 *   SHORT: TP < entry < SL
 *   RR   >= configured minimum (prop-firm default 2.5)
 */
export const validateProposal = (
  p: TradeProposal,
  minRr: number,
  maxLeverage: number
): ValidationResult => {
  const reasons: string[] = [];
  const { risk, reward, rr } = computeRr(p);

  if (!Number.isFinite(p.entry) || !Number.isFinite(p.stopLoss) || !Number.isFinite(p.takeProfit)) {
    reasons.push('entry/stopLoss/takeProfit must be finite numbers');
  }
  if (risk <= 0) {
    reasons.push(
      p.direction === 'LONG' ? 'LONG requires SL < entry' : 'SHORT requires SL > entry'
    );
  }
  if (reward <= 0) {
    reasons.push(
      p.direction === 'LONG' ? 'LONG requires TP > entry' : 'SHORT requires TP < entry'
    );
  }
  if (risk > 0 && rr < minRr) {
    reasons.push(`RR ${rr.toFixed(2)} below minimum ${minRr.toFixed(2)}`);
  }
  if (p.leverage < 1 || p.leverage > maxLeverage) {
    reasons.push(`leverage ${p.leverage} outside [1, ${maxLeverage}]`);
  }
  if (p.confidence < 0 || p.confidence > 1) {
    reasons.push('confidence must be within [0, 1]');
  }
  if (p.symbol.trim() === '') reasons.push('symbol is required');
  return { valid: reasons.length === 0, reasons, rr };
};

/** The LLM-facing contract: whatever Gemma returns must survive this schema. */
export interface TradeDecision {
  readonly action: 'LONG' | 'SHORT' | 'WAIT' | 'EXIT';
  readonly symbol: string;
  readonly confidence: number;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly thesis: string;
  readonly invalidation: string;
  readonly setupType: string;
}
