import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SEARCH_DEFINITIONS,
  filterSettingsSearchItems,
  type SettingsSearchItem,
} from './settingsSearchCatalog'

const items: SettingsSearchItem[] = [
  { id: 'appearance:mode', tab: 'appearance', label: 'Color Mode', tabLabel: 'Appearance', targetLabel: 'Color Mode' },
  { id: 'workspace:wide', tab: 'workspace', label: 'Wide Mode', tabLabel: 'Workspace', targetLabel: 'Wide Mode' },
  { id: 'chat:model', tab: 'chat', label: 'Model', tabLabel: 'Chat', targetLabel: 'Model' },
]

describe('settings search catalog', () => {
  it('ranks exact and prefix label matches before substring matches', () => {
    expect(filterSettingsSearchItems(items, 'mode').map(item => item.id)).toEqual([
      'chat:model',
      'appearance:mode',
      'workspace:wide',
    ])
  })

  it('matches menu labels and ignores blank queries', () => {
    expect(filterSettingsSearchItems(items, 'workspace').map(item => item.id)).toEqual(['workspace:wide'])
    expect(filterSettingsSearchItems(items, '   ')).toEqual([])
  })

  it('includes stable section and action targets across settings menus', () => {
    const keys = new Set(SETTINGS_SEARCH_DEFINITIONS.map(item => item.labelKey))
    expect(
      [
        'agent.behavior',
        'chat.conversationExperience',
        'workspace.sidebar',
        'appearance.display',
        'notifications.testNotification',
        'notifications.inAppAlerts',
        'service.serviceStatus',
      ].every(key => keys.has(key)),
    ).toBe(true)
  })

  it('gives duplicate notification events distinct search targets', () => {
    const completed = SETTINGS_SEARCH_DEFINITIONS.filter(item => item.labelKey === 'notifications.eventCompleted')
    expect(completed.map(item => item.contextKey)).toEqual([
      'notifications.notificationTypes',
      'notifications.eventSounds',
    ])
  })
})
