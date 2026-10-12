import { getLanguage } from 'obsidian'
const strings = {
  title: ['YOLO Autocomplete', 'YOLO 自动补全'],
  enabled: ['Automatic completion', '自动补全'],
  enabledDesc: [
    'Suggest text after a pause. Tab accepts; Escape or Shift+Tab dismisses.',
    '停顿后显示建议。Tab 接受，Esc 或 Shift+Tab 取消。',
  ],
  modelProfile: ['Completion profile', '补全配置'],
  protocol: ['API protocol', '接口类型'],
  fim: ['Mercury Edit 2 (FIM)', 'Mercury Edit 2（FIM）'],
  chat: ['OpenAI-compatible chat completion', 'OpenAI 兼容聊天式补全'],
  endpoint: ['API base URL', 'API 基础地址'],
  endpointDesc: [
    'Include /v1 when required. Only cursor context is sent to this endpoint.',
    '按服务要求包含 /v1。仅向此地址发送光标附近文本。',
  ],
  apiKey: ['API key', 'API 密钥'],
  model: ['Model ID', '模型 ID'],
  delay: ['Pause before suggesting (ms)', '停顿多久后补全（毫秒）'],
  boundaryDelay: [
    'Pause at word or punctuation boundaries (ms)',
    '词尾或标点后的等待（毫秒）',
  ],
  cooldown: [
    'Minimum interval between requests (ms)',
    '请求之间的最小间隔（毫秒）',
  ],
  cache: ['Reuse recent suggestions', '复用近期建议'],
  contextEnabled: ['Include document structure', '加入文档结构上下文'],
  contextDesc: [
    'Send bounded excerpts of this document’s headings, nearby statements and notation. No vault scan.',
    '发送本文件的标题、附近命题与记号的有限片段；不扫描整个库。',
  ],
  contextBudget: ['Additional context characters', '附加上下文字符数'],
  rules: ['Folder writing instructions', '目录写作约定'],
  rulesDesc: [
    'The most specific matching folder applies. Adds instructions without reading other files.',
    '使用匹配最具体的目录约定；只附加指令，不读取其他文件。',
  ],
  rulePath: ['Folder or file path', '目录或文件路径'],
  addRule: ['Add folder rule', '添加目录约定'],
  removeRule: ['Remove rule', '移除约定'],
  tokens: ['Maximum output tokens', '最大输出 token 数'],
  timeout: ['Request timeout (ms)', '请求超时（毫秒）'],
  context: ['Context characters', '上下文字符数'],
  temperature: ['Temperature', '温度'],
  prompt: ['Writing instructions', '写作要求'],
  multiple: ['Multiple chat suggestions', '聊天式补全生成多个候选'],
  multipleDesc: [
    'Use Up/Down to switch. Mercury FIM always returns one suggestion.',
    '用上下方向键切换。Mercury FIM 始终生成一个建议。',
  ],
  trigger: ['Trigger completion', '触发补全'],
  accept: ['Accept completion', '接受补全'],
  cancel: ['Cancel completion', '取消补全'],
  toggle: ['Toggle automatic completion', '切换自动补全'],
  on: ['Autocomplete enabled', '自动补全已开启'],
  off: ['Autocomplete disabled', '自动补全已关闭'],
  switchHint: ['↑↓ switch', '↑↓ 切换'],
  test: ['Test connection', '测试连接'],
  testDesc: [
    'Send one short synthetic sentence using this profile.',
    '使用当前配置发送一句简短的合成测试文本。',
  ],
  success: ['Connection succeeded', '连接成功'],
  error: ['Completion unavailable', '补全不可用'],
  configure: [
    'Configure an API endpoint, key, and model first.',
    '请先配置 API 地址、密钥和模型。',
  ],
} satisfies Record<string, [string, string]>
export type MessageKey = keyof typeof strings
export function t(key: MessageKey): string {
  return strings[key][getLanguage().startsWith('zh') ? 1 : 0]
}
