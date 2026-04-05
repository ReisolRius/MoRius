import { Box, Button, Stack } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { getCurrentUserNotificationUnreadCount } from '../services/authApi'
import type { AuthUser } from '../types/auth'
import { NOTIFICATIONS_CHANGED_EVENT, type NotificationsChangedDetail } from '../utils/notifications'
import DailyRewardsButton from './DailyRewardsButton'
import UserAvatar from './profile/UserAvatar'

type HeaderAccountActionsProps = {
  user: AuthUser
  authToken: string
  avatarSize: number
  onOpenProfile: () => void
  showDailyRewards?: boolean
}

function HeaderAccountActions({
  user,
  authToken,
  avatarSize,
  onOpenProfile,
  showDailyRewards = true,
}: HeaderAccountActionsProps) {
  const [unreadCount, setUnreadCount] = useState(0)

  const refreshUnreadCount = useCallback(async () => {
    try {
      const response = await getCurrentUserNotificationUnreadCount({ token: authToken })
      setUnreadCount(Math.max(0, response.unread_count))
    } catch {
      // Keep the previous value when polling fails.
    }
  }, [authToken])

  useEffect(() => {
    void refreshUnreadCount()

    const intervalId = window.setInterval(() => {
      void refreshUnreadCount()
    }, 60_000)

    const handleNotificationsChanged = (event: Event) => {
      const detail = (event as CustomEvent<NotificationsChangedDetail>).detail
      if (typeof detail?.unreadCount === 'number' && Number.isFinite(detail.unreadCount)) {
        setUnreadCount(Math.max(0, Math.trunc(detail.unreadCount)))
        return
      }
      void refreshUnreadCount()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshUnreadCount()
      }
    }

    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleNotificationsChanged as EventListener)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleNotificationsChanged as EventListener)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshUnreadCount])

  const unreadCountLabel = unreadCount > 99 ? '99+' : String(unreadCount)

  return (
    <Stack direction="row" spacing={0.6} alignItems="center">
      {showDailyRewards ? <DailyRewardsButton authToken={authToken} size={avatarSize} /> : null}
      <Box
        sx={{
          width: avatarSize,
          height: avatarSize,
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <Button
          variant="text"
          onClick={onOpenProfile}
          aria-label="Открыть профиль"
          data-tour-id="header-profile-button"
          sx={{
            minWidth: 0,
            width: '100%',
            height: '100%',
            p: 0,
            borderRadius: '50%',
            overflow: 'hidden',
            backgroundColor: 'transparent',
            '&:hover': {
              backgroundColor: 'transparent',
            },
          }}
        >
          <UserAvatar user={user} size={avatarSize} />
        </Button>
        {unreadCount > 0 ? (
          <Box
            sx={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              px: 0.5,
              borderRadius: '999px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid var(--morius-app-bg)',
              backgroundColor: 'var(--morius-accent)',
              color: '#fff7f2',
              fontSize: '0.68rem',
              fontWeight: 800,
              lineHeight: 1,
              pointerEvents: 'none',
              boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
            }}
          >
            {unreadCountLabel}
          </Box>
        ) : null}
      </Box>
    </Stack>
  )
}

export default HeaderAccountActions
