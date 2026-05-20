// Model family catalog used by the /models page.
// Add a new family by appending an entry here — no page edits needed.
// Models that don't match any family fall into the "Other" bucket on the page.

export interface ModelFamily {
  id: string;
  name: string;
  category: string;
  description: string;
  tags?: string[];
  match: (modelId: string) => boolean;
}

export const MODEL_FAMILIES: ModelFamily[] = [
  {
    id: 'gpt4',
    name: 'GPT-4o / GPT-4.1',
    category: 'OpenAI',
    description: 'OpenAI flagship series',
    tags: ['vision', 'function-call'],
    match: id => /gpt-4/i.test(id) && !/oss/i.test(id),
  },
  {
    id: 'gpt5',
    name: 'GPT-5',
    category: 'OpenAI',
    description: 'OpenAI GPT-5 series',
    tags: ['vision', 'function-call'],
    match: id => /\bgpt-5\b/i.test(id),
  },
  {
    id: 'o-series',
    name: 'o-series',
    category: 'OpenAI',
    description: 'OpenAI reasoning models',
    tags: ['thinking'],
    match: id => /^o[1-9](-|$)/i.test(id),
  },
  {
    id: 'gpt-oss',
    name: 'GPT-OSS',
    category: 'OpenAI',
    description: 'OpenAI open-weight models',
    match: id => /gpt.?oss/i.test(id),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    category: 'Google',
    description: 'Gemini 2.5 / 3 series',
    tags: ['vision', 'thinking'],
    match: id => /gemini/i.test(id),
  },
  {
    id: 'gemma',
    name: 'Gemma 3',
    category: 'Google',
    description: 'Google open Gemma models',
    match: id => /gemma/i.test(id),
  },
  {
    id: 'llama3',
    name: 'Llama 3.x',
    category: 'Meta',
    description: 'Meta Llama 3 series',
    match: id => /llama.?3\.[0-3]/i.test(id) || /llama3\.[0-3]/i.test(id),
  },
  {
    id: 'llama4',
    name: 'Llama 4',
    category: 'Meta',
    description: 'Meta Llama 4 series',
    tags: ['vision'],
    match: id => /llama.?4/i.test(id),
  },
  {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    category: 'DeepSeek',
    description: 'DeepSeek V3 chat / code',
    match: id => /deepseek.?v3/i.test(id) || /deepseek-v3/i.test(id),
  },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    category: 'DeepSeek',
    description: 'DeepSeek R1 reasoning',
    tags: ['thinking'],
    match: id => /deepseek.?r1/i.test(id),
  },
  {
    id: 'qwen3',
    name: 'Qwen 3',
    category: 'Alibaba',
    description: 'Alibaba Qwen 3 family',
    match: id => /qwen.?3/i.test(id),
  },
  {
    id: 'kimi',
    name: 'Kimi K2',
    category: 'Moonshot',
    description: 'Moonshot Kimi K2',
    match: id => /kimi/i.test(id) || /^k2[.\-]/i.test(id),
  },
  {
    id: 'glm',
    name: 'GLM',
    category: 'Zhipu',
    description: 'Zhipu GLM series',
    match: id => /\bglm\b/i.test(id),
  },
  {
    id: 'minimax',
    name: 'MiniMax M2',
    category: 'MiniMax',
    description: 'MiniMax M2 series',
    match: id => /minimax/i.test(id),
  },
  {
    id: 'mistral',
    name: 'Mistral / Magistral / Pixtral',
    category: 'Mistral',
    description: 'Mistral conversational + vision',
    tags: ['vision'],
    match: id => /mistral|magistral|mixtral|pixtral/i.test(id) && !/codestral/i.test(id),
  },
  {
    id: 'codestral',
    name: 'Codestral',
    category: 'Mistral',
    description: 'Mistral coding model',
    tags: ['code'],
    match: id => /codestral/i.test(id),
  },
  {
    id: 'phi',
    name: 'Phi-4',
    category: 'Microsoft',
    description: 'Microsoft Phi models',
    match: id => /\bphi\b/i.test(id),
  },
  {
    id: 'command',
    name: 'Command',
    category: 'Cohere',
    description: 'Cohere Command family',
    match: id => /command/i.test(id),
  },
  {
    id: 'aya',
    name: 'Aya',
    category: 'Cohere',
    description: 'Cohere multilingual Aya',
    match: id => /\baya\b/i.test(id),
  },
  {
    id: 'nemotron',
    name: 'Nemotron',
    category: 'NVIDIA',
    description: 'NVIDIA Nemotron series',
    match: id => /nemotron/i.test(id),
  },
  {
    id: 'step',
    name: 'Step',
    category: 'StepFun',
    description: 'StepFun Step series',
    match: id => /^step-/i.test(id),
  },
  {
    id: 'mimo',
    name: 'MiMo',
    category: 'Xiaomi',
    description: 'Xiaomi MiMo series',
    match: id => /\bmimo\b/i.test(id),
  },
  {
    id: 'ling',
    name: 'Ling',
    category: 'Ant',
    description: 'Ant Group Ling series',
    match: id => /^ling-/i.test(id),
  },
  {
    id: 'allam',
    name: 'ALLaM',
    category: 'SDAIA',
    description: 'Arabic ALLaM',
    match: id => /^allam/i.test(id),
  },
  {
    id: 'groq-compound',
    name: 'Groq Compound',
    category: 'Groq',
    description: 'Groq Compound system',
    match: id => /^groq\/compound/i.test(id),
  },
];

export const CATEGORY_COLORS: Record<string, string> = {
  OpenAI:    'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  Google:    'bg-blue-500/15 text-blue-400 border-blue-500/25',
  Meta:      'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
  DeepSeek:  'bg-violet-500/15 text-violet-400 border-violet-500/25',
  Alibaba:   'bg-orange-500/15 text-orange-400 border-orange-500/25',
  Moonshot:  'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  Zhipu:     'bg-sky-500/15 text-sky-400 border-sky-500/25',
  Mistral:   'bg-amber-500/15 text-amber-400 border-amber-500/25',
  MiniMax:   'bg-pink-500/15 text-pink-400 border-pink-500/25',
  Microsoft: 'bg-teal-500/15 text-teal-400 border-teal-500/25',
  Cohere:    'bg-rose-500/15 text-rose-400 border-rose-500/25',
  NVIDIA:    'bg-lime-500/15 text-lime-400 border-lime-500/25',
  StepFun:   'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/25',
  Xiaomi:    'bg-red-500/15 text-red-400 border-red-500/25',
  Ant:       'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  SDAIA:     'bg-stone-500/15 text-stone-400 border-stone-500/25',
  Groq:      'bg-zinc-500/15 text-zinc-300 border-zinc-500/25',
};

export const TAG_LABELS: Record<string, string> = {
  vision: 'Vision input',
  thinking: 'Reasoning / thinking',
  code: 'Code-tuned',
  'function-call': 'Function calling',
};

export const TAG_ICONS: Record<string, string> = {
  vision: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  thinking: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  'function-call': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
};
