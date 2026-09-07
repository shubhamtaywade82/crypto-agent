import type { MarketState } from '../domain/market/types.js';
import type { SetupCandidate } from '../engines/setup-engine.js';
import type { PortfolioState } from '../domain/portfolio/portfolio-state.js';
import type { TradeProposal } from '../domain/orders/trade-proposal.js';
import type { MarketAnalysis } from './schemas.js';

const JSON_ONLY = 'Respond with ONLY a single JSON object. No prose, no markdown.';

const tfLine = (state: MarketState, tf: '5m' | '15m' | '1h' | '4h'): string => {
  const t = state.timeframes[tf];
  return `${tf}: trend=${t.structure.trend} bos=${t.structure.bos} choch=${t.structure.choch} ` +
    `rsi=${t.momentum.rsi.toFixed(1)} atr%=${t.volatility.atrPercent.toFixed(2)} ` +
    `swHigh=${t.structure.swingHigh} swLow=${t.structure.swingLow}`;
};

export const stateBlock = (state: MarketState): string =>
  [
    `SYMBOL ${state.symbol} last=${state.price.last} mark=${state.price.mark}`,
    `regime=${state.regime} btcRegime=${state.btcRegime}`,
    `liquidity: nearestHigh=${state.liquidity.nearestHigh} nearestLow=${state.liquidity.nearestLow} ` +
      `sweep=${state.liquidity.sweepDetected}(${state.liquidity.sweepSide})`,
    `futures: funding=${(state.futures.fundingRate * 100).toFixed(4)}% oiChange%=${state.futures.openInterestChange}`,
    tfLine(state, '4h'), tfLine(state, '1h'), tfLine(state, '15m'), tfLine(state, '5m'),
  ].join('\n');

export const ANALYST_SYSTEM =
  'You are a disciplined crypto market analyst. You receive a deterministic multi-timeframe ' +
  'market snapshot (structure, momentum, volatility, liquidity, futures context). ' +
  'Produce a concise, evidence-based analysis. Never invent numbers not present in the snapshot. ' +
  `Schema: {"symbol":string,"bias":"BULLISH"|"BEARISH"|"NEUTRAL","summary":string,` +
  `"keyLevels":{"support":number,"resistance":number},"catalysts":string[],"risks":string[]}. ${JSON_ONLY}`;

export const analystPrompt = (state: MarketState): string =>
  `Analyze this market snapshot for ${state.symbol}:\n${stateBlock(state)}`;

export const STRATEGIST_SYSTEM =
  'You are a crypto trade strategist. You receive a market snapshot, an analyst read, and ' +
  'RANKED, already-validated candidate setups (each has id, direction, entry, stopLoss, ' +
  'takeProfit, rr, confidence). Choose AT MOST one candidate to execute, or WAIT. ' +
  'Rules: (1) never trade against the BTC regime; (2) to execute, reference the candidate id — ' +
  'the kernel resolves levels server-side from the canonical candidate and IGNORES any levels ' +
  'you output; (3) stand down when alignment is poor; ' +
  '(4) EXIT only if an open position thesis is invalidated. ' +
  `Schema: {"action":"EXECUTE"|"WAIT"|"EXIT","candidateId"?:string,` +
  `"confidence":number,"thesis":string,"invalidation":string,"setupType":string}. ${JSON_ONLY}`;

export interface StrategistContext {
  readonly state: MarketState;
  readonly analysis: MarketAnalysis;
  readonly setups: readonly SetupCandidate[];
  readonly portfolio: PortfolioState;
  readonly lessons: readonly string[];
}

export const strategistPrompt = (ctx: StrategistContext): string => {
  const setups = ctx.setups.length > 0
    ? ctx.setups.map((s, i) =>
      `#${i + 1} id=${s.id} ${s.type} ${s.direction} entry=${s.entry} sl=${s.stopLoss} ` +
      `tp=${s.takeProfit} rr=${s.rr.toFixed(2)} conf=${s.confidence.toFixed(2)} ` +
      `htf=${s.htfAlignment}/3`
    ).join('\n')
    : 'none';
  const lessons = ctx.lessons.length > 0 ? ctx.lessons.join(' | ') : 'none';
  return [
    `PORTFOLIO: equity=${ctx.portfolio.equity.toFixed(2)} openPositions=${ctx.portfolio.openPositions} ` +
    `dailyLoss%=${ctx.portfolio.dailyLossPercent.toFixed(2)} lossStreak=${ctx.portfolio.lossStreak}`,
    `ANALYST: ${ctx.analysis.bias} — ${ctx.analysis.summary}`,
    `CANDIDATE SETUPS:\n${setups}`,
    `LESSONS FROM PAST TRADES: ${lessons}`,
    'Choose one candidate by id, or WAIT. Output the JSON object.',
  ].join('\n');
};

export const CHALLENGER_SYSTEM =
  'You are an adversarial risk challenger. A trade proposal is about to be executed. ' +
  'Your job is to find flaws: weak structure, poor location, adverse funding, regime conflict, ' +
  'overextension. You are ADVISORY — you cannot approve or reject, but high-severity findings ' +
  'are recorded in the audit trail. ' +
  'Schema: {"verdict":"SUPPORT"|"OPPOSE"|"ABSTAIN","objections":[],"summary":string} where ' +
  'objections is [{"claim":string,"evidence":string,"severity":"LOW"|"MEDIUM"|"HIGH"}]. ' +
  `${JSON_ONLY}`;

export const challengerPrompt = (proposal: TradeProposal, state: MarketState): string =>
  [
    'CHALLENGE THIS PROPOSAL:',
    `${proposal.direction} ${proposal.symbol} ${proposal.setupType} entry=${proposal.entry} ` +
    `sl=${proposal.stopLoss} tp=${proposal.takeProfit}`,
    `thesis: ${proposal.thesis}`,
    'MARKET SNAPSHOT:',
    stateBlock(state),
  ].join('\n');
