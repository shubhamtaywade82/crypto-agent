import type { PipelineTrace } from '../engines/pipeline.js';

export type TranscriptActor =
  | 'SYSTEM' | 'USER' | 'AGENT' | 'MARKET' | 'ANALYST' | 'STRATEGIST'
  | 'RISK' | 'POLICY' | 'EXECUTION' | 'LEARNING';

export interface TranscriptEntry {
  readonly id: string;
  readonly at: string;
  readonly actor: TranscriptActor;
  readonly title: string;
  readonly lines: readonly string[];
  readonly detail?: string;
}

export const timeLabel = (): string =>
  new Date().toLocaleTimeString('en-IN', { hour12: false });

export const actorColor = (a: TranscriptActor): string => {
  if (a === 'USER') return 'blue';
  if (a === 'AGENT') return 'cyan';
  if (a === 'RISK' || a === 'POLICY') return 'yellow';
  if (a === 'EXECUTION') return 'green';
  if (a === 'MARKET') return 'magenta';
  return 'gray';
};

interface PushOpts {
  readonly actor: TranscriptActor;
  readonly title: string;
  readonly lines: string[];
  readonly detail?: string;
}

const push = (out: TranscriptEntry[], p: PushOpts): void => {
  out.push({
    id: `${Date.now()}-${out.length}`, at: timeLabel(),
    actor: p.actor, title: p.title, lines: p.lines, detail: p.detail,
  });
};

const pushAnalystEntries = (out: TranscriptEntry[], symbol: string, trace: PipelineTrace): void => {
  if (trace.state) {
    const s = trace.state;
    push(out, {
      actor: 'ANALYST', title: `${symbol} market state`,
      lines: [
        `regime=${s.regime} btc=${s.btcRegime}`,
        `price=${s.price.last} sweep=${s.liquidity.sweepDetected}`,
        `4h ${s.timeframes['4h'].structure.trend} 1h ${s.timeframes['1h'].structure.trend}`,
      ],
    });
  }
  if (trace.analysis) {
    push(out, {
      actor: 'ANALYST', title: `${symbol} read`,
      lines: [`bias=${trace.analysis.bias}`, trace.analysis.summary, `support=${trace.analysis.keyLevels.support} resistance=${trace.analysis.keyLevels.resistance}`],
    });
  }
};

const pushDecisionEntries = (out: TranscriptEntry[], symbol: string, trace: PipelineTrace): void => {
  if (trace.outcome) {
    push(out, {
      actor: 'STRATEGIST', title: `${symbol} decision`,
      lines: [`action=${trace.outcome.action} conf=${(trace.outcome.confidence * 100).toFixed(0)}%`, `thesis=${trace.outcome.thesis}`, `invalidation=${trace.outcome.invalidation}`],
    });
  }
  if (trace.challenge) {
    push(out, {
      actor: 'RISK', title: `${symbol} challenger`,
      lines: [`verdict=${trace.challenge.verdict}`, trace.challenge.summary, ...trace.challenge.objections.map((o) => `[${o.severity}] ${o.claim}`)],
    });
  }
  if (trace.risk) {
    push(out, {
      actor: 'POLICY', title: `${symbol} risk gate`,
      lines: [trace.risk.approved ? 'APPROVED' : 'REJECTED', `circuit=${trace.risk.circuitState}`, trace.risk.reasons.length ? `reasons=${trace.risk.reasons.join(', ')}` : 'checks passed'],
    });
  }
  if (trace.order) {
    push(out, {
      actor: 'EXECUTION', title: `${symbol} order`,
      lines: [`status=${trace.order.status}`, `intent=${trace.order.intentId}`, trace.order.orderId ? `orderId=${trace.order.orderId}` : 'pending id'],
    });
  }
};

/** Expand a pipeline trace into structured transcript blocks (not chain-of-thought). */
export const pipelineToEntries = (symbol: string, trace: PipelineTrace): TranscriptEntry[] => {
  const out: TranscriptEntry[] = [];
  const setups = trace.setups.length
    ? trace.setups.map((s) => `${s.type} ${s.direction} RR${s.rr.toFixed(1)}`).join(', ')
    : 'none';
  const micro = trace.state?.microstructure;
  const flow = micro ? `flow=${micro.flowBias} imb=${(micro.imbalance * 100).toFixed(0)}%` : '';
  push(out, {
    actor: 'SYSTEM', title: `Pipeline ${symbol}`,
    lines: [`status=${trace.status} regime=${trace.regime}`, `setups=[${setups}]${flow ? ` ${flow}` : ''}`],
  });
  pushAnalystEntries(out, symbol, trace);
  pushDecisionEntries(out, symbol, trace);
  return out;
};

export const systemEntry = (title: string, lines: string[]): TranscriptEntry => ({
  id: `${Date.now()}-${Math.random()}`, at: timeLabel(), actor: 'SYSTEM', title, lines,
});

export const userEntry = (text: string): TranscriptEntry => ({
  id: `${Date.now()}-u`, at: timeLabel(), actor: 'USER', title: 'You', lines: [text],
});

export const agentEntry = (text: string, detail?: string): TranscriptEntry => ({
  id: `${Date.now()}-a`, at: timeLabel(), actor: 'AGENT', title: 'Agent', lines: text.split('\n').slice(0, 8), detail,
});
