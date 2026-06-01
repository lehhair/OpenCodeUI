// ============================================
// Notification Sound Bridge
// ============================================
//
// 连接 notificationStore 和声音播放系统
// 在应用初始化时调用 initNotificationSound() 注册即可
//
// 触发点：
// 1. notificationStore.push → 后台会话通知声音
// 2. 当前会话事件 → 由 useGlobalEvents 回调中调用 playNotificationSound
//
// 不要在其他地方直接调用 playSound，统一走这里

import type { NotificationType } from '../store/notificationStore'
import { notificationStore } from '../store/notificationStore'
import { soundStore } from '../store/soundStore'
import { claimGlobalSideEffect } from './globalEventSideEffects'
import { playSound } from './soundPlayer'

/**
 * 为指定事件类型播放通知提示音
 * 会检查总开关和音量设置
 */
export function playNotificationSound(type: NotificationType): void {
  const settings = soundStore.getSnapshot()

  // 总开关关闭
  if (!settings.enabled) return
  // 音量为 0
  if (settings.volume <= 0) return

  const eventConfig = settings.events[type]
  if (!eventConfig || eventConfig.soundId === 'none') return

  const customBlob = eventConfig.soundId === 'custom' ? soundStore.getCustomAudioBlob(type) : null

  playSound({
    soundId: eventConfig.soundId,
    customAudioData: customBlob,
    volume: settings.volume,
  })
}

// 去重：防止同一事件在短时间内重复播放（后台通知 + 当前会话同时触发）
const recentPlays = new Map<NotificationType, number>()
const DEDUP_INTERVAL = 500 // 500ms 内同类型事件不重复播放

/**
 * 带去重的通知声音播放
 * 用于当前会话播放场景，防止和后台通知重复
 */
export function playNotificationSoundDeduped(type: NotificationType): void {
  const now = Date.now()
  const lastPlay = recentPlays.get(type)
  if (lastPlay && now - lastPlay < DEDUP_INTERVAL) return

  recentPlays.set(type, now)
  playNotificationSound(type)
}

/**
 * 初始化通知声音系统
 * 在 App 层调用一次即可，注册 notificationStore.push 的声音回调
 */
export function initNotificationSound(): () => void {
  const unsubscribe = notificationStore.onPush((type: NotificationType, options) => {
    // notificationStore.push 只在后台会话触发（非当前 session family）
    // 记录播放时间用于去重
    if (options?.soundKey && !claimGlobalSideEffect(options.soundKey)) return
    recentPlays.set(type, Date.now())
    playNotificationSound(type)
  })

  return unsubscribe
}
