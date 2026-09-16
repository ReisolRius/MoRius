import { Box, Button, Stack, useMediaQuery } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { getCurrentUserNotificationUnreadCount } from '../services/authApi'
import type { AuthUser } from '../types/auth'
import { NOTIFICATIONS_CHANGED_EVENT, type NotificationsChangedDetail } from '../utils/notifications'
import DailyRewardsButton from './DailyRewardsButton'
import { useAppHeaderSlots } from './header/appHeaderSlots'
import HeaderPlayButton from './header/HeaderPlayButton'
import { HEADER_CONTROL_SIZE } from './header/headerStyles'
import UserAvatar from './profile/UserAvatar'

type HeaderAccountActionsProps = {
  user: AuthUser
  authToken: string
  avatarSize: number
  onOpenProfile: () => void
  showDailyRewards?: boolean
  hideAvatarBelowQuery?: string
}

function HeaderAccountActions({
  user,
  authToken,
  avatarSize,
  onOpenProfile,
  showDailyRewards = true,
  hideAvatarBelowQuery,
}: HeaderAccountActionsProps) {
  const [unreadCount, setUnreadCount] = useState(0)
  const shouldHideAvatar = useMediaQuery(hideAvatarBelowQuery ?? '(max-width:0px)')
  const headerSlots = useAppHeaderSlots()
  const registerAccountActions = headerSlots?.registerAccountActions
  // Inside the redesigned header every control shares one height; standalone uses keep the size they ask for.
  const resolvedAvatarSize = headerSlots ? HEADER_CONTROL_SIZE : avatarSize

  useEffect(() => registerAccountActions?.(), [registerAccountActions])

  const refreshUnreadCount = useCallback(async () => {
    try {
      const response = await getCurrentUserNotificationUnreadCount({ token: authToken })
      setUnreadCount(Math.max(0, response.unread_count))
      return true
    } catch {
      // Keep the previous value when polling fails.
      return false
    }
  }, [authToken])

  useEffect(() => {
    let active = true
    let timeoutId: number | null = null

    const scheduleRefresh = (delayMs: number) => {
      if (!active) {
        return
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      timeoutId = window.setTimeout(() => {
        void runRefresh()
      }, delayMs)
    }

    const runRefresh = async () => {
      const isSuccess = await refreshUnreadCount()
      if (!active) {
        return
      }
      scheduleRefresh(isSuccess ? 60_000 : 300_000)
    }

    void runRefresh()

    const handleNotificationsChanged = (event: Event) => {
      const detail = (event as CustomEvent<NotificationsChangedDetail>).detail
      if (typeof detail?.unreadCount === 'number' && Number.isFinite(detail.unreadCount)) {
        setUnreadCount(Math.max(0, Math.trunc(detail.unreadCount)))
        return
      }
      void runRefresh()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runRefresh()
      }
    }

    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleNotificationsChanged as EventListener)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      active = false
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleNotificationsChanged as EventListener)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshUnreadCount])

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {headerSlots?.search}
      {showDailyRewards ? <DailyRewardsButton authToken={authToken} size={resolvedAvatarSize} /> : null}
      {headerSlots?.aiAssistant}
      {headerSlots?.showPlay ? <HeaderPlayButton authToken={authToken} /> : null}
      {shouldHideAvatar ? null : (
        <Box
          sx={{
            width: resolvedAvatarSize,
            height: resolvedAvatarSize,
            position: 'relative',
            flexShrink: 0,
            overflow: 'visible',
          }}
        >
          <Button
            variant="text"
            onClick={onOpenProfile}
            aria-label="Открыть профиль"
            data-tour-id="header-profile-button"
            sx={{
              minWidth: 0,
              width: resolvedAvatarSize,
              height: resolvedAvatarSize,
              p: 0,
              borderRadius: '50%',
              overflow: 'visible',
              backgroundColor: 'transparent',
              position: 'absolute',
              top: 0,
              left: 0,
              '&:hover': {
                backgroundColor: 'transparent',
              },
            }}
          >
            <UserAvatar user={user} size={resolvedAvatarSize} />
          </Button>
          {unreadCount > 0 ? (
            <Box
              sx={{
                position: 'absolute',
                top: 1,
                right: 1,
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '2px solid var(--morius-app-base)',
                backgroundColor: 'var(--morius-accent)',
                pointerEvents: 'none',
                boxShadow: '0 8px 18px rgba(0, 0, 0, 0.22)',
                zIndex: 2,
              }}
            />
          ) : null}
        </Box>
      )}
    </Stack>
  )
}

export default HeaderAccountActions
