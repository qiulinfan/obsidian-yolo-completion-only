export type TabCompletionLengthPreset = 'short' | 'medium' | 'long'
export type TabCompletionTrigger = {
  id: string
  type: 'string' | 'regex'
  pattern: string
  enabled: boolean
  acceptMode: 'insert' | 'replace'
}
export type Provider = {
  id: string
  name?: string
  baseUrl: string
  apiKey: string
  [key: string]: unknown
}
export type Model = {
  id: string
  providerId: string
  model: string
  name: string
  enable: boolean
  completionProtocol?: 'chat' | 'mercury-fim'
  customParameters?: { key: string; type: string; value: string }[]
  [key: string]: unknown
}
export const DEFAULT_TAB_COMPLETION_OPTIONS = {
  multipleCandidatesEnabled: false,
  idleTriggerEnabled: true,
  autoTriggerDelayMs: 180,
  autoTriggerCooldownMs: 150,
  triggerDelayMs: 180,
  boundaryDelayMs: 120,
  cacheEnabled: true,
  contextEnabled: true,
  contextBudget: 1400,
  minContextLength: 5,
  contextRange: 4000,
  maxSuggestionLength: 2000,
  temperature: 0.1,
  requestTimeoutMs: 12000,
  reasoningLevel: 'off',
}
export const DEFAULT_TAB_COMPLETION_LENGTH_PRESET: TabCompletionLengthPreset =
  'short'
export const TAB_COMPLETION_CONSTRAINTS_PLACEHOLDER = '{{constraints}}'
export const DEFAULT_TAB_COMPLETION_SYSTEM_PROMPT =
  'Suggest the shortest meaningful continuation, preserving the document language and existing notation. Return actual content only, without placeholders or explanations.'
export const DEFAULT_TAB_COMPLETION_TRIGGERS: TabCompletionTrigger[] = []
export const splitContextRange = (range: number) => ({
  maxBeforeChars: Math.floor(range * 0.8),
  maxAfterChars: Math.ceil(range * 0.2),
})
export type ContextRule = { path: string; instructions: string }
export type YoloSettings = {
  providers: Provider[]
  chatModels: Model[]
  continuationOptions: {
    enableTabCompletion: boolean
    tabCompletionModelId: string
    tabCompletionOptions: typeof DEFAULT_TAB_COMPLETION_OPTIONS
    tabCompletionTriggers: TabCompletionTrigger[]
    tabCompletionSystemPrompt: string
    tabCompletionConstraints: string
    tabCompletionLengthPreset: TabCompletionLengthPreset
    contextRules: ContextRule[]
    [key: string]: unknown
  }
  [key: string]: unknown
}
function normalizedOptions(
  value: Partial<typeof DEFAULT_TAB_COMPLETION_OPTIONS> | undefined,
) {
  const options = { ...DEFAULT_TAB_COMPLETION_OPTIONS, ...value }
  const bounds: Record<string, [number, number]> = {
    autoTriggerDelayMs: [0, 5000],
    autoTriggerCooldownMs: [0, 5000],
    triggerDelayMs: [0, 5000],
    boundaryDelayMs: [0, 5000],
    minContextLength: [1, 200],
    contextRange: [100, 32000],
    contextBudget: [0, 4000],
    maxSuggestionLength: [1, 4096],
    temperature: [0, 2],
    requestTimeoutMs: [250, 60000],
  }
  for (const [key, fallback] of Object.entries(
    DEFAULT_TAB_COMPLETION_OPTIONS,
  )) {
    const current = (options as Record<string, unknown>)[key]
    if (typeof fallback === 'number') {
      const [min, max] = bounds[key] ?? [0, 60000]
      ;(options as Record<string, unknown>)[key] =
        typeof current === 'number' && Number.isFinite(current)
          ? Math.max(min, Math.min(max, current))
          : fallback
    } else if (typeof current !== typeof fallback)
      (options as Record<string, unknown>)[key] = fallback
  }
  return options
}
export function loadSettings(raw: unknown): YoloSettings {
  const data = (
    raw && typeof raw === 'object' ? raw : {}
  ) as Partial<YoloSettings>
  const c = data.continuationOptions
  // Keep unrelated persisted values for rollback to upstream; none are activated.
  return {
    ...data,
    providers: Array.isArray(data.providers) ? data.providers : [],
    chatModels: Array.isArray(data.chatModels) ? data.chatModels : [],
    continuationOptions: {
      ...c,
      enableTabCompletion: c?.enableTabCompletion ?? true,
      tabCompletionModelId: c?.tabCompletionModelId ?? '',
      tabCompletionOptions: normalizedOptions(c?.tabCompletionOptions),
      tabCompletionTriggers: c?.tabCompletionTriggers ?? [],
      tabCompletionSystemPrompt:
        c?.tabCompletionSystemPrompt ?? DEFAULT_TAB_COMPLETION_SYSTEM_PROMPT,
      tabCompletionConstraints: c?.tabCompletionConstraints ?? '',
      tabCompletionLengthPreset: c?.tabCompletionLengthPreset ?? 'short',
      contextRules: Array.isArray(c?.contextRules) ? c.contextRules : [],
    },
  }
}
export function selectedModel(settings: YoloSettings) {
  const model = settings.chatModels.find(
    (m) =>
      m.id === settings.continuationOptions.tabCompletionModelId &&
      m.enable !== false,
  )
  const provider = settings.providers.find((p) => p.id === model?.providerId)
  return { model, provider }
}
export function tokenLimit(model: Model) {
  const n = Number(
    model.customParameters?.find((p) => p.key === 'max_tokens')?.value,
  )
  return Number.isFinite(n) && n > 0 ? Math.min(4096, Math.floor(n)) : 32
}
