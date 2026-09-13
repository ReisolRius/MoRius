import { Box, ButtonBase, Stack, Typography } from '@mui/material'

/**
 * The "what should the clone carry over" picker, shared by every clone dialog.
 *
 * It used to be a wrapping row of MUI buttons whose selected and unselected states rendered
 * different glyphs -- U+25CB is noticeably wider than U+2713 -- so unticking a single item
 * grew the row enough to wrap one chip onto a second line. The layout is a fixed grid now:
 * two columns on phones, three from `sm` up. Six items divide evenly into both, so every row
 * is full and the block never reflows when a tile is toggled. The tick sits in a fixed-size
 * box for the same reason.
 */

export type CloneSectionKey = 'instructions' | 'plot' | 'world' | 'main_hero' | 'history' | 'nodes'
export type CloneSelectionState = Record<CloneSectionKey, boolean>

// Hints are kept short on purpose: the tile is one line of `noWrap` text at the narrowest
// phone width, so anything longer than ~16 characters would ellipsise there.
export const CLONE_SECTION_ITEMS: Array<{ key: CloneSectionKey; label: string; hint: string }> = [
  { key: 'instructions', label: 'Инструкции', hint: 'Карточки правил' },
  { key: 'plot', label: 'Сюжет', hint: 'Карточки сюжета' },
  { key: 'world', label: 'Мир', hint: 'Мир и NPC' },
  { key: 'main_hero', label: 'ГГ', hint: 'Главный герой' },
  { key: 'history', label: 'История', hint: 'Ходы и память' },
  { key: 'nodes', label: 'Ноды', hint: 'Схема связей' },
]

export const CLONE_SECTION_DEFAULTS: CloneSelectionState = {
  instructions: true,
  plot: true,
  world: true,
  main_hero: true,
  history: true,
  nodes: true,
}

type CloneSectionPickerProps = {
  selection: CloneSelectionState
  onToggle: (key: CloneSectionKey) => void
  disabled?: boolean
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 18,
        height: 18,
        flex: '0 0 18px',
        borderRadius: '6px',
        display: 'grid',
        placeItems: 'center',
        transition: 'background-color 140ms ease, border-color 140ms ease',
        border: checked
          ? '1px solid color-mix(in srgb, var(--morius-accent) 80%, transparent)'
          : '1px solid var(--morius-chip-border)',
        backgroundColor: checked
          ? 'color-mix(in srgb, var(--morius-accent) 78%, transparent)'
          : 'transparent',
      }}
    >
      <Box
        component="svg"
        viewBox="0 0 16 16"
        sx={{
          width: 12,
          height: 12,
          opacity: checked ? 1 : 0,
          transition: 'opacity 140ms ease',
        }}
      >
        <path
          d="M3.5 8.4l3 3 6-6.8"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Box>
    </Box>
  )
}

export default function CloneSectionPicker({ selection, onToggle, disabled = false }: CloneSectionPickerProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
        gap: 1,
      }}
    >
      {CLONE_SECTION_ITEMS.map((item) => {
        const isSelected = Boolean(selection[item.key])
        return (
          <ButtonBase
            key={item.key}
            onClick={() => onToggle(item.key)}
            disabled={disabled}
            aria-pressed={isSelected}
            focusRipple
            sx={{
              width: '100%',
              justifyContent: 'flex-start',
              textAlign: 'left',
              px: 1.25,
              py: 1,
              borderRadius: '12px',
              transition: 'background-color 140ms ease, border-color 140ms ease',
              border: isSelected
                ? 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-accent) 52%, var(--morius-card-border))'
                : 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: isSelected
                ? 'color-mix(in srgb, var(--morius-accent) 13%, transparent)'
                : 'var(--morius-chip-bg)',
              '&:hover': {
                backgroundColor: isSelected
                  ? 'color-mix(in srgb, var(--morius-accent) 20%, transparent)'
                  : 'var(--morius-button-hover)',
                borderColor: isSelected
                  ? 'color-mix(in srgb, var(--morius-accent) 66%, var(--morius-card-border))'
                  : 'var(--morius-hover-border)',
              },
              '&.Mui-disabled': { opacity: 0.55 },
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
              <CheckMark checked={isSelected} />
              <Stack spacing={0.1} sx={{ minWidth: 0 }}>
                <Typography
                  noWrap
                  sx={{
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    lineHeight: 1.25,
                    color: isSelected ? 'var(--morius-text-primary)' : 'var(--morius-text-secondary)',
                  }}
                >
                  {item.label}
                </Typography>
                <Typography
                  noWrap
                  sx={{
                    fontSize: '0.72rem',
                    lineHeight: 1.3,
                    color: 'var(--morius-muted-text)',
                  }}
                >
                  {item.hint}
                </Typography>
              </Stack>
            </Stack>
          </ButtonBase>
        )
      })}
    </Box>
  )
}
