// Model capabilities for display and filtering. One rule for every page.
//
// Evidence levels (never mixed up in the UI):
//   'catalog' — stated by the catalog entry itself: `modalities` from the provider's model list, or an explicit
//               `capabilities` flag a maintainer recorded from the provider's documentation.
//   'name'    — only the model ID or display name says so ("-thinking", "R1", "coder"). Shown as a name hint,
//               never as a documented capability.
// Family-level tags in model-families.ts are deliberately NOT used: a family name ("Gemini") says nothing about
// what a particular model or provider offering supports.
// A capability with no evidence is simply absent; pages render it as "Not disclosed", never as "No".

export type CapabilityKey = 'vision' | 'reasoning' | 'coding' | 'tools' | 'structured';
export type CapabilityBasis = 'catalog' | 'name';

export interface Capability {
  key: CapabilityKey;
  basis: CapabilityBasis;
}

export interface CapabilityFlags {
  reasoning?: boolean | null;
  tool_calling?: boolean | null;
  structured_output?: boolean | null;
}

export interface CapabilityModel {
  id: string;
  name?: string | null;
  modalities?: readonly string[] | null;
  capabilities?: CapabilityFlags | null;
}

export const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  vision: 'Vision input',
  reasoning: 'Reasoning',
  coding: 'Coding',
  tools: 'Tool calling',
  structured: 'Structured output',
};

/** Short chip text. */
export const CAPABILITY_SHORT: Record<CapabilityKey, string> = {
  vision: 'vision',
  reasoning: 'reasoning',
  coding: 'coding',
  tools: 'tools',
  structured: 'JSON schema',
};

export const BASIS_NOTE: Record<CapabilityBasis, string> = {
  catalog: "Listed in the provider's model catalog.",
  name: 'Suggested by the model name only; the provider does not document it in this catalog.',
};

// Tokens of the model part of an ID (after the last '/'), matched as whole tokens so that vendor names
// ("Thinking Machines") and stray substrings ("-r100") never count. Negated forms ("non-reasoning",
// "non-thinking") never count either.
const REASONING_TOKEN = /(^|[-_.:\s])(?<!non[-_\s])(?<!no[-_\s])(reason(ing|er)?|thinking|think|z1|r1)([-_.:\s)]|$)/i;
export const CODING_TOKENS = ['code', 'coder', 'coding', 'codestral', 'devstral'] as const;
const CODING_TOKEN = new RegExp(`(^|[-_.:\\s])(${CODING_TOKENS.join('|')})([-_.:\\s)]|$)`, 'i');

const modelPart = (id: string) => (String(id ?? '').split('/').pop() ?? '').replace(/:free$/i, '');

/** Capabilities of one model offering, each with the strongest evidence available. */
export function modelCapabilities(m: CapabilityModel): Capability[] {
  const mods = Array.isArray(m.modalities) ? m.modalities : [];
  const flags = m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : {};
  const label = `${modelPart(m.id)} ${typeof m.name === 'string' ? m.name.replace(/^[^:]*:\s*/, '') : ''}`;
  const out: Capability[] = [];
  if (mods.includes('vision')) out.push({ key: 'vision', basis: 'catalog' });
  // A documented flag is final: false is never overridden by a name hint.
  if (flags.reasoning === true) out.push({ key: 'reasoning', basis: 'catalog' });
  else if (flags.reasoning !== false && REASONING_TOKEN.test(label)) out.push({ key: 'reasoning', basis: 'name' });
  if (mods.includes('code')) out.push({ key: 'coding', basis: 'catalog' });
  else if (CODING_TOKEN.test(label)) out.push({ key: 'coding', basis: 'name' });
  if (flags.tool_calling === true) out.push({ key: 'tools', basis: 'catalog' });
  if (flags.structured_output === true) out.push({ key: 'structured', basis: 'catalog' });
  return out;
}

export const hasCapability = (m: CapabilityModel, key: CapabilityKey) => modelCapabilities(m).some(c => c.key === key);

/** Tooltip text for a capability chip. */
export const capabilityNote = (c: Capability) => `${CAPABILITY_LABELS[c.key]}: ${BASIS_NOTE[c.basis]}`;

/** Attributes for a capability chip, rendered as <button type="button">: keyboard and screen readers get the basis too. */
export const capabilityChip = (c: Capability) => ({
  type: 'button' as const,
  class: c.basis === 'name' ? 'tag tag-o tag-hint cap-chip' : 'tag tag-o cap-chip',
  'data-tip': capabilityNote(c),
  'aria-label': `${CAPABILITY_SHORT[c.key]}. ${capabilityNote(c)}`,
});

/**
 * Input modalities as documented, or null when the catalog lists none (render "Not disclosed", never "text").
 * "code" and "embedding" are catalog markers, not input types, so they are left out here.
 */
export function inputModalities(m: { modalities?: readonly string[] | null }): string[] | null {
  const mods = Array.isArray(m.modalities) ? m.modalities.filter(x => x === 'text' || x === 'vision' || x === 'audio' || x === 'video') : [];
  return mods.length ? mods.map(x => (x === 'vision' ? 'image' : x)) : null;
}
