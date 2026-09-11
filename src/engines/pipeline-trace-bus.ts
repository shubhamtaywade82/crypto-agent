import type { CouncilTrigger } from './council-types.js';
import type { PipelineTrace } from './pipeline.js';

export interface CouncilPipelineEvent {
  readonly symbol: string;
  readonly trace: PipelineTrace;
  readonly trigger: CouncilTrigger;
}

type CouncilPipelineListener = (event: CouncilPipelineEvent) => void;

const listeners = new Set<CouncilPipelineListener>();

export const onCouncilPipelineTrace = (fn: CouncilPipelineListener): (() => void) => {
  listeners.add(fn);
  return (): void => { listeners.delete(fn); };
};

export const emitCouncilPipelineTrace = (event: CouncilPipelineEvent): void => {
  for (const fn of listeners) fn(event);
};
