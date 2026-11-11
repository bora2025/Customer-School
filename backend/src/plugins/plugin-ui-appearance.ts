import { BadRequestException } from '@nestjs/common';

// Plugins style their pages through a small allow-listed vocabulary, never through raw CSS or
// Tailwind class names. The school core maps each value to classes compiled into its own build
// (frontend/lib/plugin-ui-appearance.ts), so a plugin upgrade can change how a page looks without
// shipping code into the browser, and an unknown value is refused instead of silently ignored.

export const PLUGIN_UI_TONES = ['neutral', 'brand', 'info', 'success', 'warning', 'danger'] as const;
export type PluginUiTone = (typeof PLUGIN_UI_TONES)[number];

const PAGE_APPEARANCE = {
  theme: ['standard', 'company'],
  layout: ['stack', 'grid'],
  accent: PLUGIN_UI_TONES,
} as const;

const COMPONENT_APPEARANCE = {
  width: ['full', 'half', 'third', 'two-thirds'],
  tone: PLUGIN_UI_TONES,
  surface: ['default', 'plain', 'card', 'tinted'],
} as const;

export type PluginUiPageAppearance = { theme?: 'standard' | 'company'; layout?: 'stack' | 'grid'; accent?: PluginUiTone };
export type PluginUiComponentAppearance = { width?: 'full' | 'half' | 'third' | 'two-thirds'; tone?: PluginUiTone; surface?: 'default' | 'plain' | 'card' | 'tinted' };

function parse<T>(value: unknown, vocabulary: Record<string, readonly string[]>, label: string): T | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${label} must be an object`);
  const result: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    const allowed = vocabulary[key];
    if (!allowed) throw new BadRequestException(`${label}.${key} is not supported (allowed: ${Object.keys(vocabulary).join(', ')})`);
    if (typeof candidate !== 'string' || !allowed.includes(candidate)) throw new BadRequestException(`${label}.${key} must be one of: ${allowed.join(', ')}`);
    result[key] = candidate;
  }
  return Object.keys(result).length ? (result as T) : undefined;
}

export function parsePageAppearance(value: unknown, label: string): PluginUiPageAppearance | undefined {
  return parse<PluginUiPageAppearance>(value, PAGE_APPEARANCE, label);
}

export function parseComponentAppearance(value: unknown, label: string): PluginUiComponentAppearance | undefined {
  return parse<PluginUiComponentAppearance>(value, COMPONENT_APPEARANCE, label);
}
