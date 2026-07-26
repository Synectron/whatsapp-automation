/**
 * Minimal, dependency-free `{{placeholder}}` renderer for message templates.
 * Unknown placeholders are left untouched so authors notice typos.
 */
export type TemplateVars = Record<string, string | number | undefined | null>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function renderTemplate(template: string, vars: TemplateVars = {}): string {
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Lists the placeholders referenced by a template. */
export function extractPlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Picks a random element; returns undefined for empty arrays. */
export function pickRandom<T>(items: readonly T[]): T | undefined {
  if (!items.length) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}
