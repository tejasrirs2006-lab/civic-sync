import type { Notification } from '../types'

export function createNotification(userId: string, message: string, type: Notification['type'] = 'info'): Notification {
  return {
    id: `n-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userId,
    message,
    type,
    read: false,
    createdAt: new Date().toISOString(),
  }
}

export function markNotificationRead(notifications: Notification[], id: string) {
  return notifications.map((notification) =>
    notification.id === id ? { ...notification, read: true } : notification,
  )
}
