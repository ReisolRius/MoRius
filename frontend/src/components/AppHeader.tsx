import { useState, type ReactNode } from 'react'
import { Box, Button, IconButton, Stack, Typography } from '@mui/material'
import { brandLogo, icons } from '../assets'
import BaseDialog from './dialogs/BaseDialog'
import { moriusThemeTokens, useMoriusThemeController } from '../theme'

export type AppHeaderMenuItem = {
  key: string
  label: string
  onClick: () => void
  isActive?: boolean
}

type ToggleLabels = {
  expanded: string
  collapsed: string
}

type AppHeaderProps = {
  isPageMenuOpen: boolean
  onTogglePageMenu: () => void
  menuItems: AppHeaderMenuItem[]
  pageMenuLabels: ToggleLabels
  isRightPanelOpen: boolean
  onToggleRightPanel: () => void
  rightToggleLabels: ToggleLabels
  rightActions: ReactNode
  rightActionsWidth?: number
  hideRightToggle?: boolean
  onOpenTopUpDialog?: () => void
}

const HEADER_BUTTON_SIZE = moriusThemeTokens.layout.headerButtonSize

const shellButtonSx = {
  width: HEADER_BUTTON_SIZE,
  height: HEADER_BUTTON_SIZE,
  borderRadius: '10px',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: 'var(--morius-elevated-bg)',
  color: 'var(--morius-accent)',
  transition: 'background-color 180ms ease, border-color 180ms ease, color 180ms ease',
  '&:hover': {
    backgroundColor: 'var(--morius-button-hover)',
    borderColor: 'var(--morius-card-border)',
    color: 'var(--morius-accent)',
  },
  '&:active': {
    backgroundColor: 'var(--morius-button-active)',
  },
} as const

const menuItemSx = (isActive: boolean) => ({
  width: '100%',
  justifyContent: 'flex-start',
  borderRadius: '12px',
  minHeight: 48,
  px: 1.6,
  color: 'var(--morius-title-text)',
  textTransform: 'none',
  fontWeight: 700,
  fontSize: '0.95rem',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: isActive ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
  '&:hover': {
    backgroundColor: 'var(--morius-button-hover)',
    color: 'var(--morius-accent)',
  },
  '&:active': {
    backgroundColor: 'var(--morius-button-active)',
  },
})

const menuFooterButtonSx = {
  width: 36,
  height: 36,
  borderRadius: '11px',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: 'var(--morius-elevated-bg)',
  color: 'var(--morius-accent)',
  '&:hover': {
    backgroundColor: 'var(--morius-button-hover)',
    borderColor: 'var(--morius-card-border)',
  },
}

function AppHeader({
  isPageMenuOpen,
  onTogglePageMenu,
  menuItems,
  pageMenuLabels,
  isRightPanelOpen,
  onToggleRightPanel,
  rightToggleLabels,
  rightActions,
  rightActionsWidth = 240,
  hideRightToggle = false,
  onOpenTopUpDialog,
}: AppHeaderProps) {
  const [isThemeDialogOpen, setIsThemeDialogOpen] = useState(false)
  const [isSupportDialogOpen, setIsSupportDialogOpen] = useState(false)
  const { themeId, themes, placeholders, setTheme } = useMoriusThemeController()

  const handleOpenThemeDialog = () => setIsThemeDialogOpen(true)
  const handleCloseThemeDialog = () => setIsThemeDialogOpen(false)
  const handleOpenSupportDialog = () => setIsSupportDialogOpen(true)
  const handleCloseSupportDialog = () => setIsSupportDialogOpen(false)

  const handleOpenTopUpDialog = () => {
    if (!onOpenTopUpDialog) {
      return
    }
    onOpenTopUpDialog()
  }

  return (
    <>
      <Box
        component="header"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 'calc(var(--morius-header-height) + 40px)',
          zIndex: 34,
          pointerEvents: 'none',
          backdropFilter: 'blur(5px)',
          WebkitBackdropFilter: 'blur(5px)',
          maskImage: 'linear-gradient(180deg, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.52) 64%, rgba(0, 0, 0, 0) 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.52) 64%, rgba(0, 0, 0, 0) 100%)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--morius-app-base) 68%, transparent) 0%, color-mix(in srgb, var(--morius-app-base) 32%, transparent) 46%, rgba(0, 0, 0, 0) 100%)',
        }}
      />

      <Box
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-top-offset)',
          left: 'var(--morius-header-side-offset)',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <IconButton
          aria-label={isPageMenuOpen ? pageMenuLabels.expanded : pageMenuLabels.collapsed}
          onClick={onTogglePageMenu}
          sx={shellButtonSx}
        >
          <Box component="img" src={icons.menu} alt="" sx={{ width: 20, height: 20, opacity: 0.9 }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: `calc(var(--morius-header-top-offset) + ${HEADER_BUTTON_SIZE + 10}px)`,
          left: 'var(--morius-header-side-offset)',
          zIndex: 30,
          width: { xs: 236, md: 246 },
          borderRadius: '14px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--morius-card-bg) 96%, transparent) 0%, color-mix(in srgb, var(--morius-elevated-bg) 94%, transparent) 100%)',
          p: 1.2,
          boxShadow: '0 22px 38px rgba(0, 0, 0, 0.42)',
          transform: isPageMenuOpen ? 'translateY(0) scale(1)' : 'translateY(-14px) scale(0.98)',
          opacity: isPageMenuOpen ? 1 : 0,
          pointerEvents: isPageMenuOpen ? 'auto' : 'none',
          transition: 'transform 220ms ease, opacity 180ms ease',
        }}
      >
        <Stack spacing={1.1}>
          <Box
            component="img"
            src={brandLogo}
            alt="Morius"
            sx={{
              width: 86,
              alignSelf: 'center',
              opacity: 0.95,
              mt: 0.2,
            }}
          />
          <Stack sx={{ rowGap: 0.85 }}>
            {menuItems.map((item) => (
              <Button key={item.key} sx={menuItemSx(Boolean(item.isActive))} onClick={item.onClick}>
                {item.label}
              </Button>
            ))}
          </Stack>
          <Stack direction="row" spacing={0.75} justifyContent="center" sx={{ pt: 0.2 }}>
            <IconButton aria-label="Настройки темы" onClick={handleOpenThemeDialog} sx={menuFooterButtonSx}>
              <Box component="img" src={icons.menuSettings} alt="" sx={{ width: 18, height: 18, opacity: 0.92 }} />
            </IconButton>
            <IconButton aria-label="Поддержка" onClick={handleOpenSupportDialog} sx={menuFooterButtonSx}>
              <Box component="img" src={icons.help} alt="" sx={{ width: 18, height: 18, opacity: 0.92 }} />
            </IconButton>
            <IconButton aria-label="Пополнение монет" onClick={handleOpenTopUpDialog} sx={menuFooterButtonSx}>
              <Box component="img" src={icons.menuShop} alt="" sx={{ width: 18, height: 18, opacity: 0.92 }} />
            </IconButton>
          </Stack>
        </Stack>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          top: 'var(--morius-header-top-offset)',
          right: 'var(--morius-header-side-offset)',
          zIndex: 45,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {!hideRightToggle ? (
            <IconButton
              aria-label={isRightPanelOpen ? rightToggleLabels.expanded : rightToggleLabels.collapsed}
              onClick={onToggleRightPanel}
              sx={shellButtonSx}
            >
              <Box
                component="img"
                src={icons.arrowback}
                alt=""
                sx={{
                  width: 20,
                  height: 20,
                  opacity: 0.9,
                  transform: isRightPanelOpen ? 'none' : 'rotate(180deg)',
                  transition: 'transform 220ms ease',
                }}
              />
            </IconButton>
          ) : null}

          <Box
            sx={
              hideRightToggle
                ? {
                    '& .MuiButtonBase-root': {
                      border: 'none !important',
                      backgroundColor: 'transparent !important',
                      boxShadow: 'none !important',
                    },
                  }
                : {
                    ml: isRightPanelOpen ? 'var(--morius-icon-gap)' : 0,
                    maxWidth: isRightPanelOpen ? rightActionsWidth : 0,
                    opacity: isRightPanelOpen ? 1 : 0,
                    transform: isRightPanelOpen ? 'translateX(0)' : 'translateX(14px)',
                    pointerEvents: isRightPanelOpen ? 'auto' : 'none',
                    overflow: 'hidden',
                    '& .MuiButtonBase-root': {
                      border: 'none !important',
                      backgroundColor: 'transparent !important',
                      boxShadow: 'none !important',
                    },
                    '& .MuiButtonBase-root:hover': {
                      backgroundColor: 'var(--morius-button-hover) !important',
                    },
                    '& .MuiButtonBase-root:active': {
                      backgroundColor: 'var(--morius-button-active) !important',
                    },
                    transition: 'max-width 260ms ease, margin-left 260ms ease, opacity 220ms ease, transform 220ms ease',
                  }
            }
          >
            {rightActions}
          </Box>
        </Box>
      </Box>

      <BaseDialog
        open={isThemeDialogOpen}
        onClose={handleCloseThemeDialog}
        maxWidth="md"
        header={<Typography sx={{ fontSize: '1.2rem', fontWeight: 800 }}>Темы оформления</Typography>}
        paperSx={{
          borderRadius: '14px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        contentSx={{ px: { xs: 1.2, sm: 2 }, pb: { xs: 1.2, sm: 1.8 } }}
        actions={
          <Button
            onClick={handleCloseThemeDialog}
            sx={{
              minHeight: 40,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              color: 'var(--morius-title-text)',
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Закрыть
          </Button>
        }
      >
        <Stack spacing={1.2}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem' }}>
            Нажмите на тему, чтобы применить её сразу. Выбор сохраняется после перезапуска и повторного входа.
          </Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            {themes.map((themeOption) => {
              const isActiveTheme = themeId === themeOption.id
              const previewColors = [
                themeOption.colors.appSurface,
                themeOption.colors.appElevated,
                themeOption.colors.buttonHover,
                themeOption.colors.accent,
                themeOption.colors.textPrimary,
              ]

              return (
                <Button
                  key={themeOption.id}
                  onClick={() => setTheme(themeOption.id)}
                  sx={{
                    width: '100%',
                    minHeight: 178,
                    p: 1.1,
                    borderRadius: '12px',
                    border: `var(--morius-border-width) solid ${isActiveTheme ? 'var(--morius-accent)' : 'var(--morius-card-border)'}`,
                    background: isActiveTheme ? 'var(--morius-button-active)' : 'var(--morius-elevated-bg)',
                    color: 'var(--morius-title-text)',
                    textTransform: 'none',
                    alignItems: 'stretch',
                    justifyContent: 'flex-start',
                    '&:hover': {
                      backgroundColor: 'var(--morius-button-hover)',
                    },
                  }}
                >
                  <Stack spacing={0.8} sx={{ width: '100%' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', textAlign: 'left' }}>{themeOption.name}</Typography>
                      <Box
                        sx={{
                          borderRadius: '999px',
                          px: 0.6,
                          py: 0.1,
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          color: isActiveTheme ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
                          border: `var(--morius-border-width) solid ${isActiveTheme ? 'var(--morius-accent)' : 'var(--morius-card-border)'}`,
                          lineHeight: 1.3,
                        }}
                      >
                        {isActiveTheme ? 'Выбрана' : themeOption.subtitle}
                      </Box>
                    </Stack>

                    <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', textAlign: 'left', lineHeight: 1.4 }}>
                      {themeOption.description}
                    </Typography>

                    <Stack direction="row" spacing={0.45} sx={{ pt: 0.4 }}>
                      {previewColors.map((colorChip, index) => (
                        <Box
                          key={`${themeOption.id}-chip-${index}`}
                          sx={{
                            width: 18,
                            height: 18,
                            borderRadius: '6px',
                            border: 'var(--morius-border-width) solid rgba(0, 0, 0, 0.22)',
                            backgroundColor: colorChip,
                          }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Button>
              )
            })}
          </Box>

          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', pt: 0.25 }}>Будущие темы:</Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 0.8,
            }}
          >
            {placeholders.map((placeholderTheme) => (
              <Box
                key={placeholderTheme.id}
                sx={{
                  borderRadius: '10px',
                  border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 70%, transparent)',
                  minHeight: 70,
                  px: 0.85,
                  py: 0.7,
                  display: 'grid',
                  alignContent: 'center',
                  rowGap: 0.2,
                }}
              >
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.82rem', fontWeight: 700 }}>
                  {placeholderTheme.name}
                </Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.72rem' }}>
                  {placeholderTheme.description}
                </Typography>
              </Box>
            ))}
          </Box>
        </Stack>
      </BaseDialog>

      <BaseDialog
        open={isSupportDialogOpen}
        onClose={handleCloseSupportDialog}
        maxWidth="sm"
        header={<Typography sx={{ fontSize: '1.2rem', fontWeight: 800 }}>Нашли баг? Сообщите нам.</Typography>}
        paperSx={{
          borderRadius: '14px',
          border: 'var(--morius-border-width) solid var(--morius-card-border)',
          background: 'var(--morius-card-bg)',
          animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        contentSx={{ px: { xs: 1.2, sm: 2 }, pb: { xs: 1.2, sm: 1.8 } }}
        actions={
          <Button
            onClick={handleCloseSupportDialog}
            sx={{
              minHeight: 40,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              color: 'var(--morius-title-text)',
              '&:hover': {
                backgroundColor: 'var(--morius-button-hover)',
              },
            }}
          >
            Закрыть
          </Button>
        }
      >
        <Stack spacing={1.25}>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.92rem' }}>
            Выберите удобный канал и перейдите в сообщество в один клик.
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 1,
            }}
          >
            <Button
              component="a"
              href="https://t.me/+t2ueY4x_KvE4ZWEy"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                minHeight: 72,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 74%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                color: 'var(--morius-title-text)',
                textTransform: 'none',
                justifyContent: 'flex-start',
                px: 1.2,
                '&:hover': {
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 72%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                },
              }}
            >
              <Stack alignItems="flex-start" spacing={0.1}>
                <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2 }}>Телеграм</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>
                  https://t.me/+t2ueY4x_KvE4ZWEy
                </Typography>
              </Stack>
            </Button>
            <Button
              component="a"
              href="https://vk.com/moriusai"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                minHeight: 72,
                borderRadius: '12px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-active) 74%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                color: 'var(--morius-title-text)',
                textTransform: 'none',
                justifyContent: 'flex-start',
                px: 1.2,
                '&:hover': {
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--morius-button-hover) 72%, transparent) 0%, var(--morius-elevated-bg) 100%)',
                },
              }}
            >
              <Stack alignItems="flex-start" spacing={0.1}>
                <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, lineHeight: 1.2 }}>ВКонтакте</Typography>
                <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.78rem', lineHeight: 1.35 }}>https://vk.com/moriusai</Typography>
              </Stack>
            </Button>
          </Box>
          <Box
            sx={{
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-elevated-bg)',
              px: 1.1,
              py: 0.95,
            }}
          >
            <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--morius-title-text)' }}>Связь со мной:</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>Тг: @JustRius</Typography>
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.82rem', lineHeight: 1.45 }}>Вк: @optrovert</Typography>
          </Box>
        </Stack>
      </BaseDialog>
    </>
  )
}

export default AppHeader
