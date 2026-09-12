import type { MarketAnalysis, ChallengerVerdict, StrategyOutcome } from '../agents/schemas.js';
import type { PipelineTrace } from '../engines/pipeline.js';
import type { CouncilTrigger } from '../engines/council-types.js';
import { escapeHtml, sendTelegramHtml } from './telegram.js';

const triggerLabel = (trigger: CouncilTrigger): string => {
  if (trigger.type === 'PRICE_WATCH') {
    const { condition, currentPrice } = trigger.event;
    const dir = condition.type === 'price_above' ? 'above' : 'below';
    return `Price watch: ${condition.symbol} ${dir} $${condition.targetPrice} (now $${currentPrice})`;
  }
  if (trigger.type === 'CANDLE_CLOSE') return `${trigger.symbol} ${trigger.timeframe} candle closed`;
  if (trigger.type === 'REGIME_CHANGE') {
    return `${trigger.symbol} regime ${trigger.from} → ${trigger.to}`;
  }
  if (trigger.type === 'MARKET_EVENT') {
    return `${trigger.symbol} ${trigger.timeframe} ${trigger.label}`;
  }
  return `${trigger.symbol} setups detected (${trigger.count})`;
};

const section = (title: string, body: string): string[] =>
  body ? ['', `<b>${title}</b>`, body] : [];

const formatAnalysis = (a: MarketAnalysis): string =>
  [
    `Bias: ${a.bias}`,
    a.summary,
    `Support: $${a.keyLevels.support} · Resistance: $${a.keyLevels.resistance}`,
    a.catalysts.length ? `Catalysts: ${a.catalysts.join('; ')}` : '',
    a.risks.length ? `Risks: ${a.risks.join('; ')}` : '',
  ].filter(Boolean).join('\n');

const formatStrategist = (o: StrategyOutcome, trace: PipelineTrace): string => {
  const setup = trace.setups.find((s) => s.id === o.candidateId);
  const levels = setup
    ? `Entry $${setup.entry} · SL $${setup.stopLoss} · TP $${setup.takeProfit} · RR ${setup.rr.toFixed(2)}`
    : '';
  return [
    `Action: ${o.action} · Confidence: ${(o.confidence * 100).toFixed(0)}%`,
    `Thesis: ${o.thesis}`,
    `Invalidation: ${o.invalidation}`,
    levels,
  ].filter(Boolean).join('\n');
};

const formatChallenger = (c: ChallengerVerdict): string => {
  const objections = c.objections.length
    ? c.objections.map((o) => `[${o.severity}] ${o.claim} — ${o.evidence}`).join('\n')
    : 'No objections';
  return `Verdict: ${c.verdict}\n${c.summary}\n${objections}`;
};

const formatRisk = (trace: PipelineTrace): string => {
  if (!trace.risk) return '';
  const lines = [
    trace.risk.approved ? 'Approved' : 'Rejected',
    trace.risk.circuitState,
    trace.risk.reasons.length ? `Reasons: ${trace.risk.reasons.join(', ')}` : '',
  ];
  if (trace.sizing) {
    lines.push(`Qty ${trace.sizing.quantity} · Notional $${trace.sizing.notional} · Risk $${trace.sizing.riskAmount}`);
  }
  if (trace.order) lines.push(`Order ${trace.order.status} (${trace.order.orderId ?? trace.order.intentId})`);
  return lines.filter(Boolean).join('\n');
};

/** HTML card for Analyst → Strategist → Challenger council output. */
export const formatCouncilTelegram = (
  trigger: CouncilTrigger,
  trace: PipelineTrace,
  analysis?: MarketAnalysis,
  evidence?: string
): string => {
  const a = analysis ?? trace.analysis;
  const time = new Date(trace.ranAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  const micro = trace.state?.microstructure;
  const flow = micro ? ` · flow ${micro.flowBias} imb ${(micro.imbalance * 100).toFixed(0)}%` : '';
  const setups = trace.setups.length
    ? trace.setups.map((s) => `${s.type} ${s.direction} RR${s.rr.toFixed(1)}`).join(', ')
    : 'none';

  const parts = [
    `<b>🧠 Council — ${escapeHtml(trace.symbol)}</b>`,
    `⚡ ${escapeHtml(triggerLabel(trigger))}`,
    `📊 ${trace.status} · ${trace.regime}${flow}`,
    `Setups: ${escapeHtml(setups)}`,
    `🕒 ${time} IST`,
    ...section('📊 Evidence', evidence ? escapeHtml(evidence) : ''),
    ...section('📈 Analyst', a ? escapeHtml(formatAnalysis(a)) : '—'),
    ...section('🎯 Strategist', trace.outcome ? escapeHtml(formatStrategist(trace.outcome, trace)) : '—'),
    ...section('🛡️ Risk Challenger', trace.challenge ? escapeHtml(formatChallenger(trace.challenge)) : '—'),
    ...section('⚖️ Risk Gate', trace.risk ? escapeHtml(formatRisk(trace)) : ''),
  ];
  const text = parts.join('\n');
  return text.length > 4000 ? `${text.slice(0, 3997)}…` : text;
};

export const sendCouncilTelegram = async (
  trigger: CouncilTrigger,
  trace: PipelineTrace,
  analysis?: MarketAnalysis,
  evidence?: string
): Promise<boolean> => {
  const urgent = ['EXECUTED', 'APPROVED', 'EXIT_SIGNALLED', 'REJECTED'].includes(trace.status);
  const tradeSignal = ['EXECUTED', 'APPROVED', 'EXIT_SIGNALLED'].includes(trace.status);
  return sendTelegramHtml(formatCouncilTelegram(trigger, trace, analysis, evidence), {
    channel: tradeSignal ? 'trading' : 'alert',
    silent: !urgent,
  });
};
