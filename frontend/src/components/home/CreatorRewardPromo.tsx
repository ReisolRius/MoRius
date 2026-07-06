import type { ReactNode } from 'react'
import { Box, Stack, SvgIcon, Typography } from '@mui/material'

import BaseDialog from '../dialogs/BaseDialog'
import SoulIcon from '../currency/SoulIcon'

export const CREATOR_REWARD_PROMO_SEEN_KEY = 'morius.promo.creator-reward.v1.seen'

const VK_CONTACT_URL = 'https://vk.com/optrovert'
const TELEGRAM_CONTACT_URL = 'https://t.me/JustRius'

export function hasSeenCreatorRewardPromo(): boolean {
  try {
    return localStorage.getItem(CREATOR_REWARD_PROMO_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

export function markCreatorRewardPromoSeen() {
  try {
    localStorage.setItem(CREATOR_REWARD_PROMO_SEEN_KEY, '1')
  } catch {
    // localStorage может быть недоступен (private mode) — просто не сохраняем.
  }
}

function ArticleIcon({ size = 20 }: { size?: number }) {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: size, height: size }}>
      <path
        d="M6 3.5h9.3c.4 0 .78.16 1.06.44l2.7 2.7c.28.28.44.66.44 1.06V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Zm1.5 5.6c0-.5.4-.9.9-.9h4.2a.9.9 0 1 1 0 1.8H8.4a.9.9 0 0 1-.9-.9Zm0 3.4c0-.5.4-.9.9-.9h7.2a.9.9 0 1 1 0 1.8H8.4a.9.9 0 0 1-.9-.9Zm0 3.4c0-.5.4-.9.9-.9h7.2a.9.9 0 1 1 0 1.8H8.4a.9.9 0 0 1-.9-.9Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function VideoClipIcon({ size = 20 }: { size?: number }) {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: size, height: size }}>
      <path
        d="M12 2.6a9.4 9.4 0 1 1 0 18.8 9.4 9.4 0 0 1 0-18.8Zm-1.6 6.02c-.6-.36-1.36.07-1.36.77v5.22c0 .7.76 1.13 1.36.77l4.36-2.6a.9.9 0 0 0 0-1.55l-4.36-2.6Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function SendMessageIcon({ size = 20 }: { size?: number }) {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: size, height: size }}>
      <path
        d="M3.68 4.02c-.75-.33-1.52.42-1.2 1.17l2.4 5.63c.13.3.4.5.72.54l6.2.64c.22.02.22.35 0 .38l-6.2.64a.9.9 0 0 0-.72.54l-2.4 5.63c-.32.75.45 1.5 1.2 1.17l16.8-7.53a.9.9 0 0 0 0-1.64L3.68 4.02Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function RewardCoinsIcon({ size = 20 }: { size?: number }) {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: size, height: size }}>
      <path
        d="M12 2.8l1.7 3.44 3.8.55-2.75 2.68.65 3.78L12 11.46l-3.4 1.79.65-3.78L6.5 6.79l3.8-.55L12 2.8ZM5.9 15.4a1 1 0 0 1 1.27-.62L12 16.4l4.83-1.62a1 1 0 0 1 .64 1.9l-5.15 1.72a1 1 0 0 1-.64 0l-5.15-1.72a1 1 0 0 1-.62-1.27Zm0 3.6a1 1 0 0 1 1.27-.62L12 20l4.83-1.62a1 1 0 0 1 .64 1.9l-5.15 1.72a1 1 0 0 1-.64 0l-5.15-1.72A1 1 0 0 1 5.9 19Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

function MegaphoneIcon({ size = 22 }: { size?: number }) {
  return (
    <SvgIcon viewBox="0 0 24 24" sx={{ width: size, height: size }}>
      <path
        d="M18.9 3.3c.66-.3 1.4.18 1.4.9v13.6c0 .72-.74 1.2-1.4.9l-6.13-2.77H8.5v3.32c0 .77-.62 1.4-1.4 1.4h-.9a1.4 1.4 0 0 1-1.4-1.4v-3.4A3.35 3.35 0 0 1 2.5 12.5v-3a3.4 3.4 0 0 1 3.4-3.4h6.87L18.9 3.3ZM22 9.6a1 1 0 0 1 1 1v.8a1 1 0 1 1-2 0v-.8a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
    </SvgIcon>
  )
}

const contactChipSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.55,
  px: 1.05,
  py: 0.5,
  borderRadius: '999px',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 86%, transparent)',
  color: 'var(--morius-title-text)',
  fontSize: '0.84rem',
  fontWeight: 800,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  transition: 'border-color 160ms ease, transform 160ms ease',
  '&:hover': {
    borderColor: 'var(--morius-hover-border, var(--morius-accent))',
    transform: 'translateY(-1px)',
  },
} as const

function ContactChips({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={0.7} flexWrap="wrap" useFlexGap>
      <Box component="a" href={VK_CONTACT_URL} target="_blank" rel="noopener noreferrer" sx={contactChipSx}>
        <Typography component="span" sx={{ color: 'var(--morius-text-secondary)', fontSize: compact ? '0.78rem' : '0.82rem', fontWeight: 800 }}>
          ВК
        </Typography>
        @optrovert
      </Box>
      <Box component="a" href={TELEGRAM_CONTACT_URL} target="_blank" rel="noopener noreferrer" sx={contactChipSx}>
        <Typography component="span" sx={{ color: 'var(--morius-text-secondary)', fontSize: compact ? '0.78rem' : '0.82rem', fontWeight: 800 }}>
          Telegram
        </Typography>
        @JustRius
      </Box>
    </Stack>
  )
}

type PromoStep = {
  icon: ReactNode
  title: string
  description: ReactNode
}

type CreatorRewardPromoDialogProps = {
  open: boolean
  onClose: () => void
}

export function CreatorRewardPromoDialog({ open, onClose }: CreatorRewardPromoDialogProps) {
  const steps: PromoStep[] = [
    {
      icon: <ArticleIcon />,
      title: 'Расскажите о MoRius',
      description: 'Напишите статью про наш сайт или снимите короткое видео — TikTok, YouTube Shorts или VK Клипы.',
    },
    {
      icon: <SendMessageIcon />,
      title: 'Пришлите ссылку',
      description: (
        <>
          Выложили пост или видео — напишите разработчику и приложите ссылку.
          <Box component="span" sx={{ display: 'block', mt: 0.7 }}>
            <ContactChips />
          </Box>
        </>
      ),
    },
    {
      icon: <RewardCoinsIcon />,
      title: 'Получите награду',
      description: 'От 400 до 2000 солов — сумма зависит от качества материала и охвата.',
    },
  ]

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      header={
        <Stack spacing={0.55} sx={{ pr: 4 }}>
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '1.2rem', fontWeight: 900 }}>
            До 2000 солов за пост о MoRius
          </Typography>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.9rem', lineHeight: 1.45 }}>
            Акция для игроков: расскажите о нас — и получите награду.
          </Typography>
        </Stack>
      }
      paperSx={{
        borderRadius: '14px',
        border: 'var(--morius-border-width) solid var(--morius-card-border)',
        background: 'var(--morius-card-bg)',
        animation: 'morius-dialog-pop 320ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      contentSx={{ px: { xs: 1.2, sm: 2 }, pb: { xs: 1.2, sm: 1.8 } }}
      actions={null}
    >
      <Stack spacing={1.25}>
        <Box
          sx={{
            borderRadius: '12px',
            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 70%, var(--morius-gold, #e3b341) 30%)',
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--morius-gold, #e3b341) 14%, var(--morius-elevated-bg)), var(--morius-card-bg))',
            px: 1.4,
            py: 1.25,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.8,
          }}
        >
          <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '1.5rem', sm: '1.7rem' }, fontWeight: 900, lineHeight: 1 }}>
            400–2000
          </Typography>
          <SoulIcon size={26} />
        </Box>

        <Stack spacing={0.8}>
          {steps.map((step, index) => (
            <Stack
              key={step.title}
              direction="row"
              spacing={1.1}
              sx={{
                borderRadius: '10px',
                border: 'var(--morius-border-width) solid var(--morius-card-border)',
                backgroundColor: 'var(--morius-elevated-bg)',
                px: 1.15,
                py: 1,
              }}
            >
              <Box
                sx={{
                  flexShrink: 0,
                  width: 40,
                  height: 40,
                  borderRadius: '12px',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--morius-accent)',
                  border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 78%, var(--morius-accent) 22%)',
                  backgroundColor: 'color-mix(in srgb, var(--morius-accent) 10%, transparent)',
                }}
              >
                {step.icon}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ color: 'var(--morius-title-text)', fontSize: '0.92rem', fontWeight: 800, mb: 0.2 }}>
                  {index + 1}. {step.title}
                </Typography>
                <Typography component="div" sx={{ color: 'var(--morius-text-secondary)', fontSize: '0.86rem', lineHeight: 1.5 }}>
                  {step.description}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>

        <Stack direction="row" justifyContent="flex-end">
          <Box
            component="button"
            type="button"
            onClick={onClose}
            sx={{
              minHeight: 42,
              px: 2.4,
              borderRadius: '10px',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              backgroundColor: 'var(--morius-accent)',
              color: 'var(--morius-on-accent, #091016)',
              font: 'inherit',
              fontWeight: 900,
              cursor: 'pointer',
              transition: 'transform 160ms ease',
              '&:hover': {
                transform: 'translateY(-1px)',
              },
            }}
          >
            Понятно
          </Box>
        </Stack>
      </Stack>
    </BaseDialog>
  )
}

export function CreatorRewardPromoBanner() {
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '14px',
        border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 72%, var(--morius-gold, #e3b341) 28%)',
        background: 'var(--morius-card-gradient)',
        px: { xs: 1.4, sm: 2 },
        py: { xs: 1.4, sm: 1.6 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--morius-gold, #e3b341) 16%, transparent), transparent 46%), radial-gradient(circle at 96% 100%, color-mix(in srgb, var(--morius-accent) 12%, transparent), transparent 42%)',
        }}
      />
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 1.2, md: 1.6 }}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ position: 'relative', zIndex: 1 }}
      >
        <Box
          sx={{
            flexShrink: 0,
            width: { xs: 44, md: 52 },
            height: { xs: 44, md: 52 },
            borderRadius: '14px',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--morius-gold, #e3b341)',
            border: 'var(--morius-border-width) solid color-mix(in srgb, var(--morius-card-border) 66%, var(--morius-gold, #e3b341) 34%)',
            backgroundColor: 'color-mix(in srgb, var(--morius-gold, #e3b341) 12%, transparent)',
          }}
        >
          <MegaphoneIcon />
        </Box>

        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.35 }}>
            <Typography sx={{ color: 'var(--morius-title-text)', fontSize: { xs: '1.02rem', md: '1.1rem' }, fontWeight: 900, lineHeight: 1.2 }}>
              От 400 до 2000 солов за статью или видео о MoRius
            </Typography>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                px: 0.85,
                py: 0.3,
                borderRadius: '999px',
                backgroundColor: 'color-mix(in srgb, var(--morius-gold, #e3b341) 16%, transparent)',
                color: 'var(--morius-gold, #e3b341)',
                fontSize: '0.74rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              Акция
            </Box>
          </Stack>
          <Typography sx={{ color: 'var(--morius-text-secondary)', fontSize: { xs: '0.88rem', md: '0.92rem' }, lineHeight: 1.5 }}>
            Напишите статью про сайт или снимите ролик для TikTok, YouTube Shorts или VK Клипов. Выложили — пришлите
            ссылку разработчику, и он выдаст награду в зависимости от качества и охвата.
          </Typography>
        </Box>

        <Stack
          spacing={0.8}
          alignItems={{ xs: 'flex-start', md: 'flex-end' }}
          sx={{ flexShrink: 0, width: { xs: '100%', md: 'auto' } }}
        >
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'var(--morius-title-text)' }}>
            <VideoClipIcon size={17} />
            <Typography sx={{ color: 'inherit', fontSize: '1.05rem', fontWeight: 900, lineHeight: 1 }}>
              400–2000
            </Typography>
            <SoulIcon size={19} />
          </Stack>
          <ContactChips compact />
        </Stack>
      </Stack>
    </Box>
  )
}
