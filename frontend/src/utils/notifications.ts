export const NOTIFICATIONS_CHANGED_EVENT = 'morius:notifications-changed'

export type NotificationsChangedDetail = {
  unreadCount?: number | null
}

export function dispatchNotificationsChanged(unreadCount?: number | null): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(
    new CustomEvent<NotificationsChangedDetail>(NOTIFICATIONS_CHANGED_EVENT, {
      detail: { unreadCount },
    }),
  )
}
