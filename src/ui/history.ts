import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { useCallback, useState } from 'react';

const MAX_HISTORY_ITEMS = 100;

export class PromptHistory {
  private items: string[] = [];
  private cursor = -1;
  private draft = '';
  private readonly filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath ?? path.join(os.homedir(), '.crypto_agent_history');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.items = raw.split('\n').map((l) => l.trim()).filter(Boolean).slice(-MAX_HISTORY_ITEMS);
      }
    } catch {
      this.items = [];
    }
    this.cursor = this.items.length;
  }

  public save(prompt: string): void {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    // Deduplicate consecutive identical submissions
    if (this.items[this.items.length - 1] !== trimmed) {
      this.items.push(trimmed);
      if (this.items.length > MAX_HISTORY_ITEMS) this.items.shift();
      try {
        fs.appendFileSync(this.filePath, `${trimmed}\n`, 'utf-8');
      } catch { /* ignore disk write errors */ }
    }
    this.cursor = this.items.length;
    this.draft = '';
  }

  public navigateUp(currentText: string): string | undefined {
    if (this.items.length === 0) return undefined;
    if (this.cursor === this.items.length) {
      this.draft = currentText;
    }
    if (this.cursor > 0) {
      this.cursor--;
      return this.items[this.cursor];
    }
    return this.items[0];
  }

  public navigateDown(): string | undefined {
    if (this.items.length === 0 || this.cursor >= this.items.length) return undefined;
    this.cursor++;
    if (this.cursor >= this.items.length) {
      this.cursor = this.items.length;
      return this.draft;
    }
    return this.items[this.cursor];
  }
}

export interface PromptHistoryNavigation {
  inputVal: string;
  setInputVal: React.Dispatch<React.SetStateAction<string>>;
  handleUp: () => void;
  handleDown: () => void;
}

export const usePromptHistoryNavigation = (history: PromptHistory): PromptHistoryNavigation => {
  const [inputVal, setInputVal] = useState('');
  const handleUp = useCallback((): void => {
    const prev = history.navigateUp(inputVal);
    if (prev !== undefined) setInputVal(prev);
  }, [history, inputVal]);
  const handleDown = useCallback((): void => {
    const next = history.navigateDown();
    if (next !== undefined) setInputVal(next);
  }, [history]);
  return { inputVal, setInputVal, handleUp, handleDown };
};
