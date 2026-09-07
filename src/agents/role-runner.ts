import type { ZodType } from 'zod';
import type { OllamaClient } from '@nemesis-oss/ollama-sdk';

export interface RoleRunnerOptions<T> {
  readonly ollama: OllamaClient;
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly schema: ZodType<T>;
  readonly maxRetries?: number;
}

/** Strip markdown fences and pull the outermost JSON object. */
export const extractJson = (content: string): unknown => {
  const cleaned = content.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found in model output');
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
};

const chatOnce = async (opts: RoleRunnerOptions<unknown>): Promise<string> => {
  const res = await opts.ollama.chat({
    model: opts.model,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    stream: false,
    think: false,
    options: { temperature: 0.2, num_ctx: 16384, num_predict: 2048 },
  });
  const content = (res as { message?: { content?: string } }).message?.content;
  return content ?? '';
};

/**
 * Runs one LLM role turn with schema-validated structured output.
 * On parse failure the validation error is fed back and the model gets
 * exactly one retry — after that the role fails fast (fail-closed).
 */
export const runJsonRole = async <T>(opts: RoleRunnerOptions<T>): Promise<T> => {
  const maxRetries = opts.maxRetries ?? 1;
  let feedback = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const user = attempt === 0
      ? opts.user
      : `${opts.user}\n\nYour previous reply was invalid: ${feedback}\nReply again with ONLY the JSON object.`;
    const content = await chatOnce({ ...opts, user });
    try {
      return opts.schema.parse(extractJson(content));
    } catch (err) {
      feedback = err instanceof Error ? err.message.slice(0, 400) : String(err);
    }
  }
  throw new Error(`role output failed schema validation: ${feedback}`);
};
