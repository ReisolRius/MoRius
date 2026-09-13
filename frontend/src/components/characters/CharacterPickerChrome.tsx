import { Box, ButtonBase, LinearProgress, Skeleton, Stack, Typography } from '@mui/material'

/**
 * Shared chrome for the character pickers (in-game "Из шаблона" and world creation).
 *
 * Both dialogs used filled pill buttons for their source tabs, which gave no sense of where
 * you were and had no hover state, and announced loading with a bare line of text. These are
 * the two pieces that fixes, kept in one place so the two pickers cannot drift apart again.
 */

/** Text tab: accent type when active, no filled pill, and a real hover state. */
export function CharacterPickerTab({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      role="tab"
      aria-selected={active}
      focusRipple
      sx={{
        px: 0.4,
        pb: 0.7,
        borderRadius: '6px',
        fontSize: '0.92rem',
        fontWeight: active ? 700 : 600,
        letterSpacing: '0.01em',
        color: active ? 'var(--morius-accent)' : 'var(--morius-text-secondary)',
        transition: 'color 150ms ease',
        position: 'relative',
        '&:hover': { color: active ? 'var(--morius-accent)' : 'var(--morius-title-text)' },
        '&:hover::after': { transform: 'scaleX(1)' },
        '&::after': {
          content: '""',
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          borderRadius: 999,
          backgroundColor: active
            ? 'var(--morius-accent)'
            : 'color-mix(in srgb, var(--morius-text-secondary) 48%, transparent)',
          transform: active ? 'scaleX(1)' : 'scaleX(0)',
          transformOrigin: 'center',
          transition: 'transform 170ms ease',
        },
        '&.Mui-disabled': { opacity: 0.5 },
      }}
    >
      {label}
    </ButtonBase>
  )
}

export function CharacterPickerTabRow({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      role="tablist"
      sx={{ borderBottom: '1px solid color-mix(in srgb, var(--morius-card-border) 70%, transparent)' }}
    >
      {children}
    </Stack>
  )
}

/** Placeholder rows shaped like the real character cards, so the wait reads as loading. */
export function CharacterPickerLoadingList({ rows = 5 }: { rows?: number }) {
  return (
    <Stack spacing={0.75} aria-busy aria-label="Загружаем персонажей">
      <LinearProgress
        sx={{
          height: 3,
          borderRadius: 999,
          backgroundColor: 'color-mix(in srgb, var(--morius-accent) 16%, transparent)',
          '& .MuiLinearProgress-bar': { backgroundColor: 'var(--morius-accent)' },
        }}
      />
      {Array.from({ length: rows }).map((_, index) => (
        <Stack
          key={index}
          direction="row"
          spacing={0.9}
          alignItems="center"
          sx={{
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            backgroundColor: 'var(--morius-card-bg)',
            px: 0.9,
            py: 0.75,
            // Fades out down the list so it reads as "more is coming" rather than as content.
            opacity: Math.max(0.32, 1 - index * 0.16),
          }}
        >
          <Skeleton
            variant="circular"
            width={34}
            height={34}
            sx={{ bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 20%, transparent)', flexShrink: 0 }}
          />
          <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton
              variant="rounded"
              height={11}
              sx={{
                width: `${52 + ((index * 13) % 28)}%`,
                borderRadius: '6px',
                bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 20%, transparent)',
              }}
            />
            <Skeleton
              variant="rounded"
              height={9}
              sx={{
                width: `${74 - ((index * 9) % 22)}%`,
                borderRadius: '6px',
                bgcolor: 'color-mix(in srgb, var(--morius-text-secondary) 13%, transparent)',
              }}
            />
          </Stack>
        </Stack>
      ))}
    </Stack>
  )
}

/**
 * "Create a character" row. Shaped like the character rows under it, with the plus standing
 * in for the avatar, so it reads as a new character rather than a stray icon button floating
 * above the list.
 */
export function CharacterPickerCreateTile({
  onClick,
  disabled,
  label = 'Создать персонажа',
  hint = 'Новый, с нуля',
}: {
  onClick: () => void
  disabled?: boolean
  label?: string
  hint?: string
}) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      focusRipple
      sx={{
        width: '100%',
        borderRadius: '12px',
        border: 'var(--morius-border-width) dashed color-mix(in srgb, var(--morius-accent) 46%, var(--morius-card-border))',
        backgroundColor: 'color-mix(in srgb, var(--morius-accent) 9%, transparent)',
        px: 0.9,
        py: 0.75,
        justifyContent: 'flex-start',
        textAlign: 'left',
        transition: 'background-color 150ms ease, border-color 150ms ease',
        '&:hover': {
          backgroundColor: 'color-mix(in srgb, var(--morius-accent) 15%, transparent)',
          borderColor: 'color-mix(in srgb, var(--morius-accent) 68%, transparent)',
        },
        '&.Mui-disabled': { opacity: 0.55 },
      }}
    >
      <Stack direction="row" spacing={0.7} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
        <Box
          aria-hidden
          sx={{
            width: 34,
            height: 34,
            flex: '0 0 34px',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--morius-accent)',
            border: '1px dashed color-mix(in srgb, var(--morius-accent) 62%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--morius-accent) 12%, transparent)',
            fontSize: '1.2rem',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          +
        </Box>
        <Stack spacing={0.2} sx={{ minWidth: 0, alignItems: 'flex-start' }}>
          <Typography sx={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--morius-title-text)' }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'var(--morius-muted-text)' }}>{hint}</Typography>
        </Stack>
      </Stack>
    </ButtonBase>
  )
}
