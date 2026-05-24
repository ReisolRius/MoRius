import { Box, IconButton, Menu, MenuItem } from '@mui/material'
import type { MouseEvent, ReactNode } from 'react'
import type { SxProps } from '@mui/system'
import type { Theme } from '@mui/material/styles'

export type CommunityModerationTargetKind = 'world' | 'character' | 'instruction_template'

export type CommunityModerationTarget = {
  kind: CommunityModerationTargetKind
  id: number
  title: string
}

type CommunityModerationCardFrameProps = {
  canModerate: boolean
  children: ReactNode
  disabled?: boolean
  actionOffsetRight?: number | string
  sx?: SxProps<Theme>
  onOpenMenu: (event: MouseEvent<HTMLElement>) => void
}

type CommunityModerationMenuProps = {
  anchorEl: HTMLElement | null
  target: CommunityModerationTarget | null
  isSaving?: boolean
  onClose: () => void
  onReturnToModeration: (target: CommunityModerationTarget) => void
}

export function canModerateCommunityContent(role: string | null | undefined): boolean {
  const normalizedRole = String(role || '').trim().toLowerCase()
  return normalizedRole === 'administrator' || normalizedRole === 'moderator'
}

export function CommunityModerationCardFrame({
  canModerate,
  children,
  disabled = false,
  actionOffsetRight = 10,
  sx,
  onOpenMenu,
}: CommunityModerationCardFrameProps) {
  return (
    <Box
      className="community-moderation-card-frame"
      sx={[
        {
          position: 'relative',
          minWidth: 0,
          height: '100%',
          '& .community-moderation-card-action': {
            opacity: { xs: 1, md: 0 },
            pointerEvents: { xs: 'auto', md: 'none' },
            transform: { xs: 'translateY(0)', md: 'translateY(-4px)' },
            transition: 'opacity 180ms ease, transform 180ms ease, background-color 180ms ease',
          },
          '&:hover .community-moderation-card-action, &:focus-within .community-moderation-card-action': {
            opacity: 1,
            pointerEvents: 'auto',
            transform: 'translateY(0)',
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
      {canModerate ? (
        <IconButton
          className="community-moderation-card-action"
          aria-label="Действия модерации"
          disabled={disabled}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onOpenMenu(event)
          }}
          sx={{
            position: 'absolute',
            top: 10,
            right: actionOffsetRight,
            zIndex: 6,
            width: 32,
            height: 32,
            borderRadius: '999px',
            color: 'rgba(228, 236, 248, 0.94)',
            border: 'var(--morius-border-width) solid rgba(214, 226, 242, 0.18)',
            backgroundColor: 'rgba(6, 10, 16, 0.72)',
            backdropFilter: 'blur(10px)',
            '&:hover': {
              backgroundColor: 'rgba(20, 30, 44, 0.84)',
            },
            '&:disabled': {
              opacity: 0.5,
            },
          }}
        >
          <Box component="span" sx={{ fontSize: 20, fontWeight: 900, lineHeight: 1, transform: 'translateY(-2px)' }}>
            {'\u22EF'}
          </Box>
        </IconButton>
      ) : null}
    </Box>
  )
}

export function CommunityModerationMenu({
  anchorEl,
  target,
  isSaving = false,
  onClose,
  onReturnToModeration,
}: CommunityModerationMenuProps) {
  const isOpen = Boolean(anchorEl && target)

  return (
    <Menu
      anchorEl={anchorEl}
      open={isOpen}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      PaperProps={{
        sx: {
          mt: 0.6,
          minWidth: 220,
          borderRadius: '12px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          backgroundColor: 'var(--morius-card-bg)',
          color: 'var(--morius-text-primary)',
          boxShadow: '0 18px 40px rgba(0, 0, 0, 0.52)',
        },
      }}
    >
      <MenuItem
        disabled={!target || isSaving}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (target && !isSaving) {
            onReturnToModeration(target)
          }
        }}
        sx={{
          fontSize: '0.92rem',
          fontWeight: 800,
          color: 'var(--morius-text-primary)',
          '&:hover': {
            backgroundColor: 'var(--morius-button-hover)',
          },
        }}
      >
        Вернуть на модерацию
      </MenuItem>
    </Menu>
  )
}
