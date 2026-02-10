// ============================================
// Notification Service Worker
// ============================================
// 专门用于显示通知（Android Chrome 不支持 new Notification()）
// 不做缓存、不拦截 fetch，只处理通知相关事件

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data
  if (!data) return

  // 构建跳转 URL
  let url = '/'
  if (data.sessionId) {
    const dir = data.directory ? `?dir=${data.directory}` : ''
    url = `/#/session/${data.sessionId}${dir}`
  }

  // 聚焦已有窗口或打开新窗口
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 找到同源的已有窗口
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          // 导航到目标 session
          client.postMessage({
            type: 'notification-click',
            sessionId: data.sessionId,
            directory: data.directory,
          })
          return client.focus()
        }
      }
      // 没有已有窗口，打开新的
      return clients.openWindow(url)
    })
  )
})
