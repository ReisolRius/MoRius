import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { formatCheckoutPrice } from '../../utils/paymentPricing'


function formatBasePrice(value: number): string {
  return `${Math.max(0, Math.trunc(value)).toLocaleString('ru-RU')} ₽`
}

export function CheckoutPriceSummary({
  priceRub,
  coverCommission,
  suffix,
}: {
  priceRub: number
  coverCommission: boolean
  suffix?: string
}) {
  return (
    <Box
      sx={{
        borderRadius: '14px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        backgroundColor: 'var(--morius-elevated-bg)',
        p: 1.4,
      }}
    >
      <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.76rem', fontWeight: 800, mb: 0.6 }}>
        Итого к оплате
      </Typography>
      <Stack direction="row" alignItems="baseline" flexWrap="wrap" gap={0.8}>
        {coverCommission ? (
          <Typography
            sx={{
              color: 'var(--morius-text-secondary)',
              fontSize: '1rem',
              fontWeight: 800,
              textDecoration: 'line-through',
              textDecorationThickness: '2px',
            }}
          >
            {formatBasePrice(priceRub)}
          </Typography>
        ) : null}
        <Typography
          sx={{
            color: coverCommission ? 'var(--morius-accent)' : 'var(--morius-title-text)',
            fontSize: '1.8rem',
            fontWeight: 950,
            lineHeight: 1,
          }}
        >
          {formatCheckoutPrice(priceRub, coverCommission)}
        </Typography>
        {suffix ? (
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', fontWeight: 700 }}>
            {suffix}
          </Typography>
        ) : null}
        {coverCommission ? (
          <Chip
            size="small"
            label="+3,5%"
            sx={{ color: 'var(--morius-accent)', borderColor: 'var(--morius-accent)', fontWeight: 900 }}
            variant="outlined"
          />
        ) : null}
      </Stack>
    </Box>
  )
}

export function CheckoutContents({ title, items }: { title: string; items: string[] }) {
  return (
    <Box sx={{ borderRadius: '14px', border: 'var(--morius-border-width) solid var(--morius-card-border)', p: 1.4 }}>
      <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.9rem', fontWeight: 900, mb: 0.8 }}>
        {title}
      </Typography>
      <Stack spacing={0.7}>
        {items.filter(Boolean).map((item, index) => (
          <Stack key={`${index}-${item}`} direction="row" spacing={0.9} alignItems="flex-start">
            <Box sx={{ width: 6, height: 6, mt: '7px', flex: '0 0 6px', borderRadius: '50%', backgroundColor: 'var(--morius-accent)' }} />
            <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.84rem', lineHeight: 1.45 }}>
              {item}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

export function VoluntaryCommissionControl({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Box
      sx={{
        borderRadius: '14px',
        border: `var(--morius-border-width) solid ${checked ? 'color-mix(in srgb, var(--morius-accent) 55%, var(--morius-card-border))' : 'var(--morius-card-border)'}`,
        backgroundColor: checked ? 'color-mix(in srgb, var(--morius-accent) 8%, var(--morius-elevated-bg))' : 'var(--morius-elevated-bg)',
        px: 1.2,
        py: 0.8,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.25}>
        <FormControlLabel
          control={
            <Checkbox
              checked={checked}
              onChange={(event) => onChange(event.target.checked)}
              sx={{ color: 'var(--morius-text-secondary)', '&.Mui-checked': { color: 'var(--morius-accent)' } }}
            />
          }
          label={
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.86rem', fontWeight: 850 }}>
              Добровольно покрыть комиссию
            </Typography>
          }
          sx={{ m: 0 }}
        />
        <Tooltip
          arrow
          title="Если включить, к цене добавятся 3,5%: так вы добровольно компенсируете разработчику комиссию ЮKassa. Это необязательно."
        >
          <IconButton
            size="small"
            aria-label="Что значит добровольно покрыть комиссию"
            sx={{
              width: 22,
              height: 22,
              color: 'var(--morius-accent)',
              border: '1px solid color-mix(in srgb, var(--morius-accent) 50%, transparent)',
              fontSize: '0.72rem',
              fontWeight: 950,
            }}
          >
            ?
          </IconButton>
        </Tooltip>
      </Stack>
      <Typography sx={{ pl: 4.1, color: 'var(--morius-text-secondary)', fontSize: '0.74rem', lineHeight: 1.35 }}>
        Необязательная доплата 3,5% только к текущему платежу.
      </Typography>
    </Box>
  )
}
