import { Box, Container, Link, Stack, Typography } from '@mui/material'

type GameLegalPageProps = {
  title: string
  content: string
  /** Куда увести за вторым документом: подпись и путь. Больше отсюда идти некуда. */
  other: { label: string; path: string }
  onNavigate: (path: string, options?: { replace?: boolean }) => void
}

/**
 * Юридический документ игрового направления.
 *
 * Отдельная страница, а не LegalDocumentPage с другим текстом, и разница ровно в одном: отсюда
 * <b>некуда уйти</b>. Игрок попал сюда из мобильной игры по ссылке под кнопками входа; логотип,
 * название сайта, кнопка «На главную» и футер со списком разделов — это четыре приглашения
 * оказаться в совершенно другом продукте, и ни одно из них не отвечает на вопрос, с которым
 * сюда пришли. Единственная ссылка на странице ведёт на второй документ того же комплекта.
 *
 * Оформление берётся у сайта переменными темы, а не копированием цветов: страница обязана
 * выглядеть частью того же хозяйства, а тема здесь одна и меняется в одном месте.
 */
function GameLegalPage({ title, content, other, onNavigate }: GameLegalPageProps) {
  return (
    <Box
      sx={{
        minHeight: '100svh',
        background:
          'radial-gradient(120% 85% at 18% -6%, #0d0e0f 0%, #070708 45%, #010102 75%, #000000 100%)',
        color: 'var(--morius-text-primary)',
        py: { xs: 3, md: 5 },
      }}
    >
      <Container maxWidth="md">
        <Stack spacing={2}>
          <Box
            sx={{
              borderRadius: 'var(--morius-radius)',
              border: 'var(--morius-border-width) solid var(--morius-card-border)',
              background: 'var(--morius-card-bg)',
              p: { xs: 1.6, md: 2.4 },
            }}
          >
            <Typography
              component="h1"
              sx={{ fontSize: { xs: '1.45rem', md: '1.9rem' }, fontWeight: 800, mb: 0.6 }}
            >
              {title}
            </Typography>

            <Typography
              sx={{
                fontSize: { xs: '0.86rem', md: '0.92rem' },
                color: 'var(--morius-text-secondary)',
                mb: 2,
              }}
            >
              Rius Games
            </Typography>

            <Box
              component="pre"
              sx={{
                m: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'inherit',
                fontSize: { xs: '0.92rem', md: '1rem' },
                lineHeight: 1.62,
                color: 'var(--morius-text-primary)',
              }}
            >
              {content}
            </Box>
          </Box>

          <Box sx={{ textAlign: 'center', pb: 2 }}>
            <Link
              component="button"
              type="button"
              onClick={() => onNavigate(other.path)}
              sx={{
                fontSize: { xs: '0.92rem', md: '0.98rem' },
                color: 'var(--morius-accent)',
                textDecorationColor: 'color-mix(in srgb, var(--morius-accent) 60%, transparent)',
                background: 'none',
                border: 0,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              {other.label}
            </Link>
          </Box>
        </Stack>
      </Container>
    </Box>
  )
}

export default GameLegalPage
