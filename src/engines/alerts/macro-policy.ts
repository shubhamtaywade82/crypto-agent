export type MacroEventRisk = 'NONE' | 'HIGH' | 'VERY_HIGH';

/** In-memory event-risk flag consumed by the setup/signal path. */
export class MacroPolicy {
  private current: MacroEventRisk = 'NONE';
  private eventName = '';

  risk(): MacroEventRisk {
    return this.current;
  }

  label(): string {
    return this.eventName;
  }

  set(risk: MacroEventRisk, name = ''): void {
    this.current = risk;
    this.eventName = name;
  }

  note(): string | undefined {
    if (this.current === 'NONE') return undefined;
    return `Macro: ${this.current} (${this.eventName || 'event'})`;
  }
}

export const sharedMacroPolicy = new MacroPolicy();
