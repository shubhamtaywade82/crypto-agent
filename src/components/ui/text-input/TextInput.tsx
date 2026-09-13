import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { darkTheme } from '../_core.js';
import type { InkUITheme } from '../_core.js';

export interface TextInputProps {
  /** Controlled value */
  readonly value: string;
  /** Called on every keystroke with the new value */
  readonly onChange: (value: string) => void;
  /** Called when Enter is pressed */
  readonly onSubmit?: (value: string) => void;
  /** Shown when value is empty */
  readonly placeholder?: string;
  /** Mask input characters as * */
  readonly password?: boolean;
  /** Whether this input captures keyboard input */
  readonly focus?: boolean;
  /** Optional label rendered to the left */
  readonly label?: string;
  /** Theme override — defaults to darkTheme */
  readonly theme?: InkUITheme;
  /** Optional callback when Up Arrow is pressed */
  readonly onUpArrow?: () => void;
  /** Optional callback when Down Arrow is pressed */
  readonly onDownArrow?: () => void;
  /** Optional callback when Escape is pressed */
  readonly onEscape?: () => void;
}

interface KeyHandlerContext {
  readonly value: string;
  readonly cursor: number;
  readonly setCursor: React.Dispatch<React.SetStateAction<number>>;
  readonly onChange: (v: string) => void;
  readonly onSubmit?: (v: string) => void;
  readonly onUpArrow?: () => void;
  readonly onDownArrow?: () => void;
  readonly onEscape?: () => void;
  readonly lastInternalValue: React.MutableRefObject<string>;
  readonly exit: () => void;
}

interface RenderContentOpts {
  readonly display: string;
  readonly cursorPos: number;
  readonly isFocused: boolean;
  readonly placeholder: string;
  readonly theme: InkUITheme;
}

const renderCursorChar = (char: string | undefined, theme: InkUITheme): React.JSX.Element => {
  if (char === undefined || char === ' ') {
    return <Text key="cursor" color={theme.colors.focus}>█</Text>;
  }
  return <Text key="cursor" color={theme.colors.focus} inverse>{char}</Text>;
};

const renderInputContent = (opts: RenderContentOpts): React.JSX.Element => {
  const { display, cursorPos, isFocused, placeholder, theme } = opts;
  if (!isFocused) {
    if (display.length === 0) return <Text color={theme.colors.muted}>{placeholder}</Text>;
    return <Text color={theme.colors.text}>{display}</Text>;
  }
  if (display.length === 0) {
    return (
      <Box>
        <Text color={theme.colors.focus}>█</Text>
        {placeholder ? <Text color={theme.colors.muted}>{placeholder}</Text> : null}
      </Box>
    );
  }
  const safeCursor = Math.min(Math.max(0, cursorPos), display.length);
  const before = display.slice(0, safeCursor);
  const at = display[safeCursor];
  const after = display.slice(safeCursor + 1);
  return (
    <Box>
      {before ? <Text color={theme.colors.text}>{before}</Text> : null}
      {renderCursorChar(at, theme)}
      {after ? <Text color={theme.colors.text}>{after}</Text> : null}
    </Box>
  );
};

const applyTextChange = (ctx: KeyHandlerContext, nextVal: string, nextCursor?: number): void => {
  ctx.lastInternalValue.current = nextVal;
  if (nextCursor !== undefined) ctx.setCursor(nextCursor);
  ctx.onChange(nextVal);
};

const handleNavKeys = (
  input: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
  ctx: KeyHandlerContext
): boolean => {
  if (key.leftArrow) {
    ctx.setCursor((c) => Math.max(0, Math.min(c, ctx.value.length) - 1));
    return true;
  }
  if (key.rightArrow) {
    ctx.setCursor((c) => Math.min(ctx.value.length, Math.max(0, c) + 1));
    return true;
  }
  if (key.ctrl && input === 'a') {
    ctx.setCursor(0);
    return true;
  }
  if (key.ctrl && input === 'e') {
    ctx.setCursor(ctx.value.length);
    return true;
  }
  if (key.upArrow) { ctx.onUpArrow?.(); return true; }
  if (key.downArrow) { ctx.onDownArrow?.(); return true; }
  return false;
};

const handleEditKeys = (
  input: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
  ctx: KeyHandlerContext
): boolean => {
  if (key.ctrl && (input === 'c' || input === '\u0003')) { ctx.exit(); return true; }
  if (key.escape) { ctx.onEscape?.(); return true; }
  if (key.return) { ctx.onSubmit?.(ctx.value); return true; }
  const c = Math.min(Math.max(0, ctx.cursor), ctx.value.length);
  if (key.delete && c < ctx.value.length) {
    applyTextChange(ctx, ctx.value.slice(0, c) + ctx.value.slice(c + 1));
    return true;
  }
  if (key.backspace && c > 0) {
    applyTextChange(ctx, ctx.value.slice(0, c - 1) + ctx.value.slice(c), c - 1);
    return true;
  }
  return false;
};

const handleCharInput = (
  input: string,
  key: Parameters<Parameters<typeof useInput>[0]>[1],
  ctx: KeyHandlerContext
): void => {
  if (key.ctrl || key.meta || key.tab || key.pageUp || key.pageDown || !input) return;
  const c = Math.min(Math.max(0, ctx.cursor), ctx.value.length);
  applyTextChange(ctx, ctx.value.slice(0, c) + input + ctx.value.slice(c), c + input.length);
};

export const TextInput: React.FC<TextInputProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  password = false,
  focus = true,
  label,
  theme = darkTheme,
  onUpArrow,
  onDownArrow,
  onEscape,
}) => {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [cursor, setCursor] = useState(value.length);
  const lastInternalValue = useRef(value);

  // Sync cursor when value is modified externally (e.g. form reset, history navigation)
  useEffect(() => {
    if (value !== lastInternalValue.current) {
      lastInternalValue.current = value;
      setCursor(value.length);
    }
  }, [value]);

  const ctx: KeyHandlerContext = {
    value, cursor, setCursor, onChange, onSubmit,
    onUpArrow, onDownArrow, onEscape, lastInternalValue, exit,
  };

  useInput(
    (input, key) => {
      const handled = handleNavKeys(input, key, ctx) || handleEditKeys(input, key, ctx);
      if (!handled) handleCharInput(input, key, ctx);
    },
    { isActive: focus && Boolean(isRawModeSupported) }
  );

  const display = password ? '*'.repeat(value.length) : value;

  return (
    <Box>
      {label ? <Text color={theme.colors.muted}>{label} </Text> : null}
      <Text color={theme.colors.primary} bold>{'❯ '}</Text>
      {renderInputContent({ display, cursorPos: cursor, isFocused: focus, placeholder, theme })}
    </Box>
  );
};
