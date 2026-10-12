import { Notice, PluginSettingTab, Setting } from 'obsidian'
import type AutocompletePlugin from '../main'
import { t, type MessageKey } from '../i18n'
import { selectedModel, tokenLimit } from './schema/setting.types'
import { requestCompletion } from '../completion/request'
export class AutocompleteSettingsTab extends PluginSettingTab {
  constructor(private readonly owner: AutocompletePlugin) {
    super(owner.app, owner)
  }
  display() {
    const { containerEl } = this
    containerEl.empty()
    const s = this.owner.settings,
      c = s.continuationOptions
    new Setting(containerEl).setName(t('title')).setHeading()
    new Setting(containerEl)
      .setName(t('enabled'))
      .setDesc(t('enabledDesc'))
      .addToggle((input) =>
        input.setValue(c.enableTabCompletion).onChange(async (value) => {
          c.enableTabCompletion = value
          await this.owner.saveSettings()
        }),
      )
    if (s.chatModels.length > 1)
      new Setting(containerEl)
        .setName(t('modelProfile'))
        .addDropdown((input) => {
          for (const m of s.chatModels)
            if (s.providers.some((p) => p.id === m.providerId))
              input.addOption(m.id, m.name || m.model)
          input.setValue(c.tabCompletionModelId).onChange(async (value) => {
            c.tabCompletionModelId = value
            await this.owner.saveSettings()
            this.display()
          })
        })
    const { model, provider } = selectedModel(s)
    if (!model || !provider) {
      new Setting(containerEl).setDesc(t('configure'))
      return
    }
    const text = (
      key: MessageKey,
      value: string,
      save: (value: string) => void,
      secret = false,
    ) =>
      new Setting(containerEl).setName(t(key)).addText((input) => {
        input.inputEl.type = secret ? 'password' : 'text'
        input.setValue(value).onChange(async (value) => {
          save(value)
          await this.owner.saveSettings()
        })
      })
    new Setting(containerEl).setName(t('protocol')).addDropdown((input) =>
      input
        .addOption('mercury-fim', t('fim'))
        .addOption('chat', t('chat'))
        .setValue(
          model.completionProtocol ??
            (model.model === 'mercury-edit-2' ? 'mercury-fim' : 'chat'),
        )
        .onChange(async (value) => {
          model.completionProtocol = value as 'chat' | 'mercury-fim'
          await this.owner.saveSettings()
        }),
    )
    text('endpoint', provider.baseUrl, (value) => {
      provider.baseUrl = value.trim()
    }).setDesc(t('endpointDesc'))
    text(
      'apiKey',
      provider.apiKey,
      (value) => {
        provider.apiKey = value.trim()
      },
      true,
    )
    text('model', model.model, (value) => {
      model.model = value.trim()
      model.name = value.trim()
    })
    const number = (
      key: MessageKey,
      value: number,
      min: number,
      max: number,
      save: (value: number) => void,
    ) =>
      new Setting(containerEl).setName(t(key)).addText((input) => {
        input.inputEl.type = 'number'
        input.inputEl.min = String(min)
        input.inputEl.max = String(max)
        input.setValue(String(value)).onChange(async (value) => {
          const n = Number(value)
          if (value.trim() && Number.isFinite(n) && n >= min && n <= max) {
            save(n)
            await this.owner.saveSettings()
          }
        })
      })
    number(
      'delay',
      c.tabCompletionOptions.autoTriggerDelayMs,
      0,
      5000,
      (value) => {
        c.tabCompletionOptions.autoTriggerDelayMs = value
        c.tabCompletionOptions.triggerDelayMs = value
      },
    )
    number(
      'boundaryDelay',
      c.tabCompletionOptions.boundaryDelayMs,
      0,
      5000,
      (value) => {
        c.tabCompletionOptions.boundaryDelayMs = value
      },
    )
    number(
      'cooldown',
      c.tabCompletionOptions.autoTriggerCooldownMs,
      0,
      5000,
      (value) => {
        c.tabCompletionOptions.autoTriggerCooldownMs = value
      },
    )
    new Setting(containerEl).setName(t('cache')).addToggle((input) =>
      input
        .setValue(c.tabCompletionOptions.cacheEnabled)
        .onChange(async (value) => {
          c.tabCompletionOptions.cacheEnabled = value
          await this.owner.saveSettings()
        }),
    )
    new Setting(containerEl)
      .setName(t('contextEnabled'))
      .setDesc(t('contextDesc'))
      .addToggle((input) =>
        input
          .setValue(c.tabCompletionOptions.contextEnabled)
          .onChange(async (value) => {
            c.tabCompletionOptions.contextEnabled = value
            await this.owner.saveSettings()
          }),
      )
    number(
      'contextBudget',
      c.tabCompletionOptions.contextBudget,
      0,
      4000,
      (value) => {
        c.tabCompletionOptions.contextBudget = Math.floor(value)
      },
    )
    number('tokens', tokenLimit(model), 1, 4096, (value) => {
      model.customParameters = [
        ...(model.customParameters ?? []).filter((p) => p.key !== 'max_tokens'),
        { key: 'max_tokens', type: 'number', value: String(Math.floor(value)) },
      ]
    })
    number(
      'timeout',
      c.tabCompletionOptions.requestTimeoutMs,
      250,
      60000,
      (value) => {
        c.tabCompletionOptions.requestTimeoutMs = value
      },
    )
    number(
      'context',
      c.tabCompletionOptions.contextRange,
      100,
      32000,
      (value) => {
        c.tabCompletionOptions.contextRange = Math.floor(value)
      },
    )
    number('temperature', c.tabCompletionOptions.temperature, 0, 2, (value) => {
      c.tabCompletionOptions.temperature = value
    })
    new Setting(containerEl).setName(t('prompt')).addTextArea((input) => {
      input.inputEl.rows = 4
      input.setValue(c.tabCompletionSystemPrompt).onChange(async (value) => {
        c.tabCompletionSystemPrompt = value
        await this.owner.saveSettings()
      })
    })
    new Setting(containerEl)
      .setName(t('rules'))
      .setDesc(t('rulesDesc'))
      .addButton((button) =>
        button.setButtonText(t('addRule')).onClick(async () => {
          c.contextRules.push({ path: '', instructions: '' })
          await this.owner.saveSettings()
          this.display()
        }),
      )
    for (const [index, rule] of c.contextRules.entries()) {
      new Setting(containerEl)
        .setName(t('rulePath'))
        .addText((input) =>
          input.setValue(rule.path).onChange(async (value) => {
            rule.path = value
            await this.owner.saveSettings()
          }),
        )
        .addButton((button) =>
          button.setButtonText(t('removeRule')).onClick(async () => {
            c.contextRules.splice(index, 1)
            await this.owner.saveSettings()
            this.display()
          }),
        )
      new Setting(containerEl).setName(t('prompt')).addTextArea((input) =>
        input.setValue(rule.instructions).onChange(async (value) => {
          rule.instructions = value
          await this.owner.saveSettings()
        }),
      )
    }
    new Setting(containerEl)
      .setName(t('multiple'))
      .setDesc(t('multipleDesc'))
      .addToggle((input) =>
        input
          .setValue(c.tabCompletionOptions.multipleCandidatesEnabled)
          .onChange(async (value) => {
            c.tabCompletionOptions.multipleCandidatesEnabled = value
            await this.owner.saveSettings()
          }),
      )
    new Setting(containerEl)
      .setName(t('test'))
      .setDesc(t('testDesc'))
      .addButton((button) =>
        button.setButtonText(t('test')).onClick(async () => {
          const controller = new AbortController()
          this.owner.connectionChecks.add(controller)
          button.setDisabled(true)
          const timer = setTimeout(
            () => controller.abort(),
            c.tabCompletionOptions.requestTimeoutMs,
          )
          let output = ''
          try {
            await requestCompletion({
              provider,
              model,
              prefix: 'A clear note helps us ',
              suffix: '',
              system: c.tabCompletionSystemPrompt,
              temperature: c.tabCompletionOptions.temperature,
              signal: controller.signal,
              onDelta: (delta) => {
                output += delta
              },
            })
            new Notice(output.trim() ? t('success') : t('error'))
          } catch {
            new Notice(t('error'))
          } finally {
            clearTimeout(timer)
            this.owner.connectionChecks.delete(controller)
            button.setDisabled(false)
          }
        }),
      )
  }
}
