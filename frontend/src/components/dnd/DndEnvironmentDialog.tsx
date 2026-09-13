// Season, time of day and weather.
//
// Editable before the first turn (that is the party setting the scene) and afterwards only in
// sandbox mode. The weather list is filtered by the season, because "гроза в январе" is the
// kind of detail that quietly breaks immersion — and the server filters it again on save.

import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import type { DndCatalog, DndState } from '../../types/story'
import BaseDialog from '../dialogs/BaseDialog'
import DndSurfaceButton from './DndSurfaceButton'
import { DND_SEASON_LABELS, DND_TIME_LABELS, DND_WEATHER_LABELS, isDarkTimeOfDay, timeGradient } from './dndDisplay'
import { DndTimeIcon, DndWeatherIcon } from './DndIcons'

export type DndEnvironmentDialogProps = {
  open: boolean
  state: DndState | null
  catalog: DndCatalog | null
  saving: boolean
  error: string
  onClose: () => void
  onSave: (payload: { season: string; timeOfDay: string; weather: string; weatherNote: string; day: number }) => void
}

function OptionTile({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <DndSurfaceButton
      onClick={onClick}
      disabled={disabled}
      active={selected}
      sx={{
        flex: '1 1 88px',
        minWidth: 88,
        minHeight: 62,
        px: 0.6,
        borderRadius: '13px',
        flexDirection: 'column',
        gap: 0.3,
        // A picked tile is tinted rather than filled: these sit in a row of eight, and eight
        // solid accent blocks would fight the sky preview above them.
        ...(selected
          ? {
              color: 'var(--morius-title-text)',
              borderColor: 'var(--morius-accent)',
              backgroundColor: 'color-mix(in srgb, var(--morius-accent) 18%, var(--morius-elevated-bg))',
              '&:hover:not(:disabled)': {
                color: 'var(--morius-title-text)',
                borderColor: 'var(--morius-accent)',
                backgroundColor: 'color-mix(in srgb, var(--morius-accent) 26%, var(--morius-elevated-bg))',
              },
            }
          : {}),
      }}
    >
      {children}
    </DndSurfaceButton>
  )
}

export default function DndEnvironmentDialog({
  open,
  state,
  catalog,
  saving,
  error,
  onClose,
  onSave,
}: DndEnvironmentDialogProps) {
  const [season, setSeason] = useState('summer')
  const [timeOfDay, setTimeOfDay] = useState('morning')
  const [weather, setWeather] = useState('clear')
  const [weatherNote, setWeatherNote] = useState('')
  const [day, setDay] = useState(1)

  useEffect(() => {
    if (!open || !state) {
      return
    }
    setSeason(state.environment.season)
    setTimeOfDay(state.environment.time_of_day)
    setWeather(state.environment.weather)
    setWeatherNote(state.environment.weather_note)
    setDay(state.environment.day)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const allowedWeathers = useMemo(() => {
    const allowed = catalog?.season_weather?.[season]
    const all = catalog?.weathers ?? []
    if (!allowed) {
      return all
    }
    return all.filter((item) => allowed.includes(item.id))
  }, [catalog, season])

  // Picking a season can invalidate the chosen weather; fall back rather than submitting
  // something the server will silently replace.
  useEffect(() => {
    if (allowedWeathers.length && !allowedWeathers.some((item) => item.id === weather)) {
      setWeather(allowedWeathers[0].id)
    }
  }, [allowedWeathers, weather])

  const [skyFrom, skyTo] = timeGradient(timeOfDay)
  const skyText = isDarkTimeOfDay(timeOfDay) ? '#eef2fb' : '#0e1420'
  const isSandbox = state?.play_mode === 'sandbox'

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      header={
        <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.1rem', fontWeight: 950, pr: 4 }}>
          Время и погода
        </Typography>
      }
      actions={
        <>
          <Button
            onClick={onClose}
            disabled={saving}
            sx={{ textTransform: 'none', color: 'var(--morius-text-secondary) !important', fontWeight: 800 }}
          >
            Отмена
          </Button>
          <Button
            onClick={() => onSave({ season, timeOfDay, weather, weatherNote, day })}
            disabled={saving}
            sx={{
              minHeight: 42,
              px: 2,
              borderRadius: '12px',
              textTransform: 'none',
              fontWeight: 950,
              color: '#11070A !important',
              background:
                'linear-gradient(135deg, color-mix(in srgb, var(--morius-accent) 92%, #fff 8%), var(--morius-accent)) !important',
            }}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <Stack spacing={1.35}>
        <Box
          sx={{
            position: 'relative',
            borderRadius: '15px',
            overflow: 'hidden',
            minHeight: 78,
            display: 'flex',
            alignItems: 'center',
            px: 1.4,
            background: `linear-gradient(160deg, ${skyFrom} 0%, ${skyTo} 100%)`,
            transition: 'background 700ms ease',
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1.1} sx={{ width: '100%' }}>
            <DndTimeIcon timeOfDay={timeOfDay} size={30} sx={{ color: skyText }} />
            <Stack spacing={0} sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: skyText, fontSize: '1.05rem', fontWeight: 950, lineHeight: 1.15 }}>
                {DND_TIME_LABELS[timeOfDay]} · {DND_WEATHER_LABELS[weather]}
              </Typography>
              <Typography sx={{ color: skyText, opacity: 0.78, fontSize: '0.76rem', fontWeight: 800 }}>
                {DND_SEASON_LABELS[season]} · день {day}
              </Typography>
            </Stack>
            <DndWeatherIcon weather={weather} size={30} sx={{ color: skyText }} />
          </Stack>
        </Box>

        <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.8rem', lineHeight: 1.45 }}>
          {isSandbox
            ? 'В песочнице время и погоду можно менять в любой момент.'
            : 'Это стартовые условия. После первого хода временем управляет мастер: сезон меняется по календарю, погода — только когда прошло достаточно игрового времени.'}
        </Typography>

        <Stack spacing={0.55}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.72rem', fontWeight: 950, letterSpacing: '0.08em' }}>
            СЕЗОН
          </Typography>
          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
            {(catalog?.seasons ?? []).map((item) => (
              <OptionTile key={item.id} selected={season === item.id} disabled={saving} onClick={() => setSeason(item.id)}>
                <Typography sx={{ color: 'inherit', fontSize: '0.8rem', fontWeight: 900 }}>{item.label}</Typography>
              </OptionTile>
            ))}
          </Stack>
        </Stack>

        <Stack spacing={0.55}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.72rem', fontWeight: 950, letterSpacing: '0.08em' }}>
            ВРЕМЯ СУТОК
          </Typography>
          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
            {(catalog?.times_of_day ?? []).map((item) => (
              <OptionTile
                key={item.id}
                selected={timeOfDay === item.id}
                disabled={saving}
                onClick={() => setTimeOfDay(item.id)}
              >
                <DndTimeIcon timeOfDay={item.id} size={18} sx={{ color: 'inherit' }} />
                <Typography sx={{ color: 'inherit', fontSize: '0.72rem', fontWeight: 900 }}>{item.label}</Typography>
              </OptionTile>
            ))}
          </Stack>
        </Stack>

        <Stack spacing={0.55}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.72rem', fontWeight: 950, letterSpacing: '0.08em' }}>
            ПОГОДА
          </Typography>
          <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
            {allowedWeathers.map((item) => (
              <OptionTile key={item.id} selected={weather === item.id} disabled={saving} onClick={() => setWeather(item.id)}>
                <DndWeatherIcon weather={item.id} size={18} sx={{ color: 'inherit' }} />
                <Typography sx={{ color: 'inherit', fontSize: '0.72rem', fontWeight: 900 }}>{item.label}</Typography>
              </OptionTile>
            ))}
          </Stack>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            label="Заметка о погоде"
            value={weatherNote}
            onChange={(event) => setWeatherNote(event.target.value)}
            fullWidth
            inputProps={{ maxLength: 80 }}
            placeholder="Мелкий дождь с востока"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
          />
          <TextField
            label="День"
            type="number"
            value={day}
            onChange={(event) => setDay(Math.max(1, Number(event.target.value) || 1))}
            sx={{ width: { xs: '100%', sm: 120 }, '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
          />
        </Stack>

        {error ? (
          <Typography sx={{ color: '#e07a7a', fontSize: '0.82rem', fontWeight: 800 }}>{error}</Typography>
        ) : null}
      </Stack>
    </BaseDialog>
  )
}
