// Shared display helpers for catalog pages.

// Convert a context-window label like "128K" / "1M" / "131,072" (or a plain
// number) into tokens so columns can sort numerically. Returns -1 when the
// value is missing or unparseable; catalog data may carry numbers or strings.
export function contextToNumber(label: unknown): number {
  if (label == null) return -1;
  if (typeof label === 'number') return Number.isFinite(label) && label >= 0 ? label : -1;
  const m = String(label).trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KM])?$/i);
  if (!m) return -1;
  const n = parseFloat(m[1]);
  const unit = m[2]?.toUpperCase();
  if (unit === 'M') return n * 1_000_000;
  if (unit === 'K') return n * 1_000;
  return n;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', CNY: '¥' };

// Format a per-1M-token price. USD and CNY use their symbol; any other
// currency is shown with its ISO code as a suffix so it is never mistaken
// for dollars.
export function formatPrice(n: number, currency: string): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const code = String(currency || 'USD').trim().toUpperCase();
  const amount = n === 0 ? '0' : n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${amount}` : `${amount} ${code}`;
}

// Quote a value for POSIX shells: wrap in single quotes and escape embedded
// single quotes, so catalog URLs/ids can never break out of a snippet.
export function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Emit a YAML scalar as a double-quoted string. JSON strings are valid YAML
// double-quoted scalars, so colons, '#' and quotes stay literal.
export function yamlString(value: unknown): string {
  return JSON.stringify(String(value));
}
