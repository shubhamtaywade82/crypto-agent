import React from 'react';
import { Box, Text } from 'ink';
import { getKernel } from '../../kernel.js';
import type { PipelineTrace } from '../../engines/pipeline.js';
import { mtfTrendLine, pipelineAge, topSetup, traceForSymbol, type PipelineSnapshots } from '../pipeline-view.js';
import { TranscriptStrip } from '../components/TranscriptStrip.js';
import type { TranscriptEntry } from '../transcript.js';
import type { useAgentChat } from '../app-hooks.js';
import type { PromptHistory } from '../history.js';
import { formatThoughtPreview, formatToolArgs, renderMarkdown, type AgentStep, type ChatMessage } from '../chat-shared.js';

export interface AgentViewProps {
  readonly focusSymbol: string;
  readonly snapshots: PipelineSnapshots;
  readonly transcript: readonly TranscriptEntry[];
  readonly selectedIndex?: number;
  readonly chat?: ReturnType<typeof useAgentChat>;
  readonly history?: PromptHistory;
}

const EmptyPipeline = ({ symbol }: { readonly symbol: string }): React.JSX.Element => (
  <Box flexDirection="column" marginY={1}>
    <Text color="gray" italic>No pipeline run for {symbol} yet.</Text>
    <Text color="gray">Run <Text color="cyan">/pipeline {symbol}</Text> or wait for EventCouncil / auto-scan.</Text>
  </Box>
);

const AnalystSection = ({ trace }: { readonly trace: PipelineTrace }): React.JSX.Element => {
  const s = trace.state;
  const micro = s?.microstructure;
  const analysis = trace.analysis;
  return (
    <Box flexDirection="column">
      <Text bold color="green">1. ANALYST EVIDENCE</Text>
      <Text color="gray">  ├─ Regime:       <Text color="white">{trace.regime}{s ? ` (btc=${s.btcRegime})` : ''}</Text></Text>
      <Text color="gray">  ├─ Structure:    <Text color="white">{s ? `${s.timeframes['1h'].structure.trend} on 1h` : '—'}</Text></Text>
      <Text color="gray">  ├─ MTF Trend:    <Text color="white">{mtfTrendLine(s)}</Text></Text>
      <Text color="gray">  ├─ Microflow:    <Text color="white">
        {micro
          ? `Spread: ${micro.spreadBps.toFixed(1)} bps │ Imb: ${(micro.imbalance * 100).toFixed(0)}% │ Bias: ${micro.flowBias}`
          : 'awaiting depth stream'}
      </Text></Text>
      <Text color="gray">  └─ Read:         <Text color="white">{analysis ? `${analysis.bias} — ${analysis.summary.slice(0, 72)}` : 'no LLM read this run'}</Text></Text>
      {analysis ? (
        <Text color="gray">     Levels: S=${analysis.keyLevels.support} R=${analysis.keyLevels.resistance}</Text>
      ) : null}
      <Text color="gray">     Setups: [{trace.setups.length ? trace.setups.map((x) => x.type).join(', ') : 'none'}] · {pipelineAge(trace.ranAt)}</Text>
    </Box>
  );
};

const StrategistSection = ({ trace }: { readonly trace: PipelineTrace }): React.JSX.Element => {
  const o = trace.outcome;
  const setup = topSetup(trace);
  return (
    <Box flexDirection="column">
      <Text bold color="yellow">2. STRATEGIST THESIS</Text>
      {o ? (
        <>
          <Text color="gray">  ├─ Action:       <Text color="white">{o.action} · {setup?.type ?? o.setupType}</Text></Text>
          <Text color="gray">  ├─ Confidence:   <Text color="white">{(o.confidence * 100).toFixed(0)}%</Text></Text>
          <Text color="gray">  ├─ Thesis:       <Text color="white">"{o.thesis}"</Text></Text>
          <Text color="gray">  └─ Invalidation: <Text color="white">{o.invalidation}</Text></Text>
          {setup ? (
            <Text color="gray">     Geometry: entry=${setup.entry} SL=${setup.stopLoss} TP=${setup.takeProfit} RR={setup.rr.toFixed(2)}</Text>
          ) : null}
        </>
      ) : (
        <Text color="gray">  └─ <Text color="white">No strategist outcome — status={trace.status}</Text></Text>
      )}
    </Box>
  );
};

const RiskSection = ({ trace }: { readonly trace: PipelineTrace }): React.JSX.Element => {
  const c = trace.challenge;
  return (
    <Box flexDirection="column">
      <Text bold color="magenta">3. RISK CHALLENGER</Text>
      {c ? (
        <>
          <Text color="gray">  ├─ Verdict:      <Text color={c.verdict === 'OPPOSE' ? 'red' : 'green'}>{c.verdict}</Text></Text>
          <Text color="gray">  ├─ Summary:      <Text color="white">{c.summary}</Text></Text>
          <Text color="gray">  └─ Objections:   <Text color="white">{c.objections.length ? c.objections.map((o) => `[${o.severity}] ${o.claim}`).join(' · ') : 'none'}</Text></Text>
        </>
      ) : (
        <Text color="gray">  └─ <Text color="white">Challenger not invoked this run</Text></Text>
      )}
    </Box>
  );
};

const PolicySection = ({ trace }: { readonly trace: PipelineTrace }): React.JSX.Element => {
  const k = getKernel();
  const r = trace.risk;
  const sz = trace.sizing;
  const statusColor = trace.status === 'EXECUTED' ? 'green' : trace.status === 'REJECTED' ? 'red' : 'yellow';
  return (
    <Box flexDirection="column">
      <Text bold color="blue">4. POLICY GATEWAY &amp; EXECUTION</Text>
      {r ? (
        <>
          <Text color="gray">  ├─ Risk gate:    <Text color={r.approved ? 'green' : 'red'}>{r.approved ? 'APPROVED' : 'REJECTED'}</Text> · circuit={r.circuitState}</Text>
          <Text color="gray">  ├─ Reasons:      <Text color="white">{r.reasons.length ? r.reasons.join(', ') : 'checks passed'}</Text></Text>
          {sz ? <Text color="gray">  ├─ Sizing:       <Text color="white">qty={sz.quantity} risk=${sz.riskAmount.toFixed(2)}</Text></Text> : null}
        </>
      ) : (
        <Text color="gray">  ├─ Risk gate:    <Text color="white">pending</Text></Text>
      )}
      <Text color="gray">  ├─ Reservations: <Text color="white">{k.reservations.active().length} active</Text></Text>
      <Text color="gray">  └─ Decision:     <Text bold color={statusColor}>{trace.status}</Text>{trace.order ? ` · ${trace.order.status}` : ''}</Text>
      {trace.error ? <Text color="red">  error: {trace.error}</Text> : null}
    </Box>
  );
};

const PipelineBar = ({ trace, symbol }: { readonly trace?: PipelineTrace; readonly symbol: string }): React.JSX.Element => {
  if (!trace) return <Text color="gray">Pipeline [{symbol}]: idle · /pipeline {symbol} to run</Text>;
  const bias = trace.analysis?.bias ?? trace.regime;
  const outcome = trace.outcome?.action ?? 'HOLD';
  const c = trace.challenge?.verdict ?? 'PASS';
  const r = trace.risk?.approved ? 'APPROVED' : 'REJECTED';
  return (
    <Text color="gray">
      [{symbol}] Regime: <Text color="white">{trace.regime}</Text> │ Bias: <Text color="white">{bias}</Text> │ Action: <Text color="white">{outcome}</Text> │ Risk: <Text color={r === 'APPROVED' ? 'green' : 'red'}>{r}</Text> │ Challenger: <Text color={c === 'OPPOSE' ? 'red' : 'green'}>{c}</Text>
    </Text>
  );
};

const ChatMessageItem = ({ msg }: { readonly msg: ChatMessage }): React.JSX.Element => (
  <Box flexDirection="column" marginY={0}>
    {msg.role === 'user' && (
      <Text bold color="cyan">👤 USER: <Text color="white">{msg.content}</Text></Text>
    )}
    {msg.steps?.map((s, idx) => s.type === 'tool' ? (
      <Text key={`${msg.id}-t-${idx}`} color="green">  ↳ 🛠️ {s.tool.name}({formatToolArgs(s.tool.args)})</Text>
    ) : (
      <Text key={`${msg.id}-th-${idx}`} color="gray" italic>  ↳ {formatThoughtPreview(s.content)}</Text>
    ))}
    {msg.role === 'agent' && msg.content ? (
      <Box flexDirection="column">
        <Text bold color="yellow">🤖 AGENT:</Text>
        <Text color="white">{renderMarkdown(msg.content)}</Text>
      </Box>
    ) : null}
    {msg.role === 'system' && (
      <Text color="gray">⚙️ SYSTEM: {msg.content}</Text>
    )}
  </Box>
);

const EmptyChatGuide = ({ historyItems }: { readonly historyItems: readonly string[] }): React.JSX.Element => (
  <Box flexDirection="column" marginY={1}>
    <Text color="gray" italic>No chat turns in current session. Type below to chat with the agent or run commands.</Text>
    {historyItems.length > 0 && (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="gray">SAVED PROMPT HISTORY (press ↑ in input area to recall):</Text>
        {historyItems.slice(-4).reverse().map((item, idx) => (
          <Text key={idx} color="gray">  {idx + 1}. <Text color="white">{item}</Text></Text>
        ))}
      </Box>
    )}
  </Box>
);

const ChatThread = (p: {
  readonly messages: readonly ChatMessage[];
  readonly selectedIndex?: number;
  readonly isBusy?: boolean;
  readonly status?: string;
  readonly steps?: readonly AgentStep[];
  readonly response?: string;
}): React.JSX.Element => {
  const maxVisible = 4;
  const total = p.messages.length;
  // selectedIndex allows scrolling back into older conversation turns
  const offset = Math.min(p.selectedIndex ?? 0, Math.max(0, total - maxVisible));
  const startIdx = Math.max(0, total - maxVisible - offset);
  const visible = p.messages.slice(startIdx, total - offset);

  return (
    <Box flexDirection="column" gap={1}>
      {total > maxVisible && (
        <Text color="gray">
          Viewing {startIdx + 1}-{startIdx + visible.length} of {total} │ PgUp/Dn Scroll chat │ Type below to chat
        </Text>
      )}
      {visible.map((m) => <ChatMessageItem key={m.id} msg={m} />)}
      {p.isBusy && (
        <Box flexDirection="column">
          <Text color="yellow">⏳ {p.status || 'Thinking...'} █</Text>
          {p.steps?.map((s, idx) => (
            <Text key={`live-${idx}`} color="green">  ↳ 🛠️ {s.type === 'tool' ? s.tool.name : 'thinking'}</Text>
          ))}
          {p.response ? <Text color="white">{renderMarkdown(p.response)}</Text> : null}
        </Box>
      )}
    </Box>
  );
};

export const AgentView = (p: AgentViewProps): React.JSX.Element => {
  const trace = traceForSymbol(p.snapshots, p.focusSymbol);
  const msgs = p.chat?.messages ?? [];
  const historyItems = p.history?.getItems() ?? [];

  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      <Text bold color="cyan">AGENT INTELLIGENCE &amp; CHAT: <Text color="yellow">{p.focusSymbol}</Text></Text>
      <PipelineBar trace={trace} symbol={p.focusSymbol} />
      {msgs.length > 0 ? (
        <ChatThread
          messages={msgs} selectedIndex={p.selectedIndex}
          isBusy={p.chat?.isBusy} status={p.chat?.status} steps={p.chat?.steps} response={p.chat?.response}
        />
      ) : (
        <>
          {trace ? (
            <>
              <AnalystSection trace={trace} />
              <StrategistSection trace={trace} />
              <RiskSection trace={trace} />
              <PolicySection trace={trace} />
            </>
          ) : (
            <EmptyPipeline symbol={p.focusSymbol} />
          )}
          <EmptyChatGuide historyItems={historyItems} />
        </>
      )}
      <TranscriptStrip entries={p.transcript} limit={3} />
    </Box>
  );
};
