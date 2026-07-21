import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  IconButton,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { brandLogo } from '../assets'
import Footer from '../components/Footer'
import WikiMarkup from '../components/wiki/WikiMarkup'
import WikiEditorDialog from '../components/wiki/WikiEditorDialog'
import {
  deleteWikiArticle,
  getWikiArticle,
  listWikiArticles,
  reorderWikiArticles,
  type WikiArticleDetail,
  type WikiArticleListItem,
} from '../services/wikiApi'
import type { AuthUser } from '../types/auth'

type WikiPageProps = {
  user: AuthUser | null
  authToken: string | null
  onNavigate: (path: string, options?: { replace?: boolean }) => void
}

const PAGE_TITLE = 'MoRius Wiki — Мориус Вики, F.A.Q. и гайды по MoRius'
const PAGE_DESCRIPTION =
  'Мориус Вики (MoRius Wiki) — база знаний и F.A.Q. по платформе MoRius: гайды, ответы на частые вопросы и помощь по текстовым ИИ-приключениям.'
const CANONICAL_URL = 'https://morius-ai.ru/wiki'

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20L16.5 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ transition: 'transform 200ms ease', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function updateMetaTag(name: string, content: string): () => void {
  const selector = `meta[name="${name}"]`
  const existing = document.head.querySelector<HTMLMetaElement>(selector)
  const previous = existing?.getAttribute('content') ?? null
  const element = existing ?? document.createElement('meta')
  if (!existing) {
    element.setAttribute('name', name)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content)
  return () => {
    if (previous === null) {
      element.remove()
    } else {
      element.setAttribute('content', previous)
    }
  }
}

function updateCanonical(url: string): () => void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  const previous = existing?.getAttribute('href') ?? null
  const element = existing ?? document.createElement('link')
  if (!existing) {
    element.setAttribute('rel', 'canonical')
    document.head.appendChild(element)
  }
  element.setAttribute('href', url)
  return () => {
    if (previous === null) {
      element.remove()
    } else {
      element.setAttribute('href', previous)
    }
  }
}

function readInitialArticleId(): number | null {
  const raw = new URLSearchParams(window.location.search).get('article')
  if (!raw) {
    return null
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed
}

function WikiPage({ user, authToken, onNavigate }: WikiPageProps) {
  const isAdmin = Boolean(authToken) && (user?.role.trim().toLowerCase() === 'administrator')

  const [articles, setArticles] = useState<WikiArticleListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(() => readInitialArticleId())
  const [details, setDetails] = useState<Record<number, WikiArticleDetail>>({})
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingInitial, setEditingInitial] = useState<WikiArticleDetail | null>(null)
  const [busyArticleId, setBusyArticleId] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const hasActiveSearch = query.trim().length > 0

  // --- SEO --------------------------------------------------------------
  useEffect(() => {
    const restoreDescription = updateMetaTag('description', PAGE_DESCRIPTION)
    const restoreCanonical = updateCanonical(CANONICAL_URL)
    const previousTitle = document.title
    return () => {
      restoreDescription()
      restoreCanonical()
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const openArticle = openId !== null ? details[openId] : null
    document.title = openArticle ? `${openArticle.title} — MoRius Wiki` : PAGE_TITLE
  }, [openId, details])

  // --- Search debounce --------------------------------------------------
  useEffect(() => {
    const timerId = window.setTimeout(() => setQuery(searchInput), 260)
    return () => window.clearTimeout(timerId)
  }, [searchInput])

  const loadArticles = useCallback(
    async (searchQuery: string) => {
      setIsLoading(true)
      setListError(null)
      try {
        const result = await listWikiArticles(searchQuery)
        setArticles(result)
      } catch (error) {
        setListError(error instanceof Error ? error.message : 'Не удалось загрузить статьи')
      } finally {
        setIsLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void loadArticles(query)
  }, [loadArticles, query])

  // --- URL sync for the currently open article --------------------------
  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search)
    const currentArticle = currentParams.get('article')
    const nextArticle = openId !== null ? String(openId) : null
    if (currentArticle === nextArticle) {
      return
    }
    if (nextArticle) {
      currentParams.set('article', nextArticle)
    } else {
      currentParams.delete('article')
    }
    const nextSearch = currentParams.toString()
    window.history.replaceState({}, '', `/wiki${nextSearch ? `?${nextSearch}` : ''}`)
  }, [openId])

  // --- Load detail for the open article ---------------------------------
  const openIdRef = useRef(openId)
  openIdRef.current = openId
  useEffect(() => {
    if (openId === null || details[openId]) {
      return
    }
    let active = true
    setDetailLoadingId(openId)
    setDetailError(null)
    getWikiArticle(openId)
      .then((detail) => {
        if (active) {
          setDetails((previous) => ({ ...previous, [detail.id]: detail }))
        }
      })
      .catch((error) => {
        if (active) {
          setDetailError(error instanceof Error ? error.message : 'Не удалось загрузить статью')
          if (openIdRef.current === openId) {
            setOpenId(null)
          }
        }
      })
      .finally(() => {
        if (active) {
          setDetailLoadingId((current) => (current === openId ? null : current))
        }
      })
    return () => {
      active = false
    }
  }, [openId, details])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const article of articles) {
      const category = (article.category ?? '').trim()
      if (category && !seen.has(category)) {
        seen.add(category)
        ordered.push(category)
      }
    }
    return ordered
  }, [articles])

  useEffect(() => {
    if (activeCategory && !categories.includes(activeCategory)) {
      setActiveCategory(null)
    }
  }, [activeCategory, categories])

  const displayedArticles = useMemo(() => {
    if (!activeCategory) {
      return articles
    }
    return articles.filter((article) => (article.category ?? '').trim() === activeCategory)
  }, [articles, activeCategory])

  const toggleArticle = (id: number) => {
    setOpenId((current) => (current === id ? null : id))
  }

  const handleCreate = () => {
    setEditingInitial(null)
    setEditorOpen(true)
  }

  const handleEdit = async (id: number) => {
    setBusyArticleId(id)
    try {
      const detail = details[id] ?? (await getWikiArticle(id))
      setDetails((previous) => ({ ...previous, [detail.id]: detail }))
      setEditingInitial(detail)
      setEditorOpen(true)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось открыть статью для редактирования')
    } finally {
      setBusyArticleId(null)
    }
  }

  const handleDelete = async (id: number) => {
    if (!authToken) {
      return
    }
    if (!window.confirm('Удалить эту статью? Действие необратимо.')) {
      return
    }
    setBusyArticleId(id)
    try {
      await deleteWikiArticle({ token: authToken, articleId: id })
      setDetails((previous) => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      if (openId === id) {
        setOpenId(null)
      }
      setNotice('Статья удалена')
      await loadArticles(query)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось удалить статью')
    } finally {
      setBusyArticleId(null)
    }
  }

  const handleReorder = async (id: number, direction: -1 | 1) => {
    if (!authToken) {
      return
    }
    const index = articles.findIndex((article) => article.id === id)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= articles.length) {
      return
    }
    const reordered = [...articles]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    setArticles(reordered)
    setBusyArticleId(id)
    try {
      const result = await reorderWikiArticles({ token: authToken, orderedIds: reordered.map((article) => article.id) })
      setArticles(result)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось изменить порядок')
      await loadArticles(query)
    } finally {
      setBusyArticleId(null)
    }
  }

  const handleSaved = async (detail: WikiArticleDetail) => {
    setDetails((previous) => ({ ...previous, [detail.id]: detail }))
    setEditorOpen(false)
    setEditingInitial(null)
    setOpenId(detail.id)
    setNotice('Статья сохранена')
    await loadArticles(query)
  }

  const controlButtonSx = {
    minWidth: 0,
    p: 0.6,
    color: 'var(--morius-text-secondary)',
    '&:hover': { color: 'var(--morius-title-text)', backgroundColor: 'rgba(255,255,255,0.06)' },
  }

  return (
    <Box
      sx={{
        minHeight: '100svh',
        display: 'flex',
        flexDirection: 'column',
        background:
          'radial-gradient(circle at 68% 8%, rgba(130, 162, 192, 0.18) 0%, rgba(130, 162, 192, 0.05) 34%, transparent 56%), linear-gradient(180deg, #080c14 0%, #05070d 48%, #04060b 100%)',
        color: 'var(--morius-text-primary)',
      }}
    >
      <Box sx={{ flex: 1, py: { xs: 4, md: 5 } }}>
        <Container maxWidth="md">
          <Stack spacing={2.5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ gap: 1 }}>
              <Box
                component="button"
                type="button"
                onClick={() => onNavigate('/')}
                sx={{ p: 0, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 0 }}
                aria-label="На главную"
              >
                <Box component="img" src={brandLogo} alt="MoRius" sx={{ width: { xs: 108, md: 132 }, opacity: 0.92 }} />
              </Box>
              <Button
                onClick={() => onNavigate('/')}
                sx={{
                  minHeight: 40,
                  px: 1.6,
                  borderRadius: '10px',
                  border: 'var(--morius-border-width) solid var(--morius-card-border)',
                  backgroundColor: 'var(--morius-elevated-bg)',
                  color: 'var(--morius-title-text)',
                  textTransform: 'none',
                  '&:hover': {
                    backgroundColor: 'color-mix(in srgb, var(--morius-elevated-bg) 84%, var(--morius-accent) 16%)',
                  },
                }}
              >
                На главную
              </Button>
            </Stack>

            <Box>
              <Typography
                component="h1"
                sx={{
                  fontSize: { xs: '2rem', md: '2.6rem' },
                  fontWeight: 900,
                  lineHeight: 1.1,
                  letterSpacing: '-0.01em',
                  color: 'var(--morius-title-text)',
                }}
              >
                Мориус Вики
              </Typography>
              <Typography sx={{ mt: 1, color: 'var(--morius-text-secondary)', fontSize: { xs: '0.96rem', md: '1.06rem' }, maxWidth: 640 }}>
                База знаний и F.A.Q. по MoRius: гайды, ответы на частые вопросы и подсказки для игроков и креаторов.
              </Typography>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <TextField
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Поиск по вики…"
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start" sx={{ color: 'var(--morius-muted-text)' }}>
                      <IconSearch />
                    </InputAdornment>
                  ),
                  endAdornment:
                    isLoading && hasActiveSearch ? (
                      <InputAdornment position="end">
                        <CircularProgress size={16} color="inherit" />
                      </InputAdornment>
                    ) : searchInput ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearchInput('')} aria-label="Очистить поиск" sx={{ color: 'var(--morius-muted-text)' }}>
                          ✕
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  sx: {
                    borderRadius: '12px',
                    backgroundColor: 'var(--morius-card-bg)',
                  },
                }}
              />
              {isAdmin ? (
                <Button
                  onClick={handleCreate}
                  variant="contained"
                  sx={{
                    minHeight: 48,
                    px: 2.2,
                    whiteSpace: 'nowrap',
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: '12px',
                    backgroundColor: 'var(--morius-accent)',
                    '&:hover': { backgroundColor: 'color-mix(in srgb, var(--morius-accent) 86%, #000 14%)' },
                  }}
                >
                  + Новая статья
                </Button>
              ) : null}
            </Stack>

            {categories.length > 0 ? (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  label="Все"
                  onClick={() => setActiveCategory(null)}
                  variant={activeCategory === null ? 'filled' : 'outlined'}
                  sx={{
                    borderColor: 'var(--morius-card-border)',
                    color: activeCategory === null ? '#fff' : 'var(--morius-text-secondary)',
                    backgroundColor: activeCategory === null ? 'var(--morius-accent)' : 'transparent',
                  }}
                />
                {categories.map((category) => (
                  <Chip
                    key={category}
                    label={category}
                    onClick={() => setActiveCategory(category)}
                    variant={activeCategory === category ? 'filled' : 'outlined'}
                    sx={{
                      borderColor: 'var(--morius-card-border)',
                      color: activeCategory === category ? '#fff' : 'var(--morius-text-secondary)',
                      backgroundColor: activeCategory === category ? 'var(--morius-accent)' : 'transparent',
                    }}
                  />
                ))}
              </Stack>
            ) : null}

            {listError ? <Alert severity="error">{listError}</Alert> : null}
            {detailError ? <Alert severity="error" onClose={() => setDetailError(null)}>{detailError}</Alert> : null}

            {isLoading && articles.length === 0 ? (
              <Stack alignItems="center" sx={{ py: 6 }}>
                <CircularProgress size={30} />
              </Stack>
            ) : displayedArticles.length === 0 ? (
              <Box
                sx={{
                  borderRadius: 'var(--morius-radius)',
                  border: 'var(--morius-border-width) dashed var(--morius-card-border)',
                  background: 'var(--morius-card-bg)',
                  p: { xs: 3, md: 5 },
                  textAlign: 'center',
                }}
              >
                <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--morius-title-text)' }}>
                  {hasActiveSearch ? 'Ничего не найдено' : 'Статей пока нет'}
                </Typography>
                <Typography sx={{ mt: 0.8, color: 'var(--morius-text-secondary)' }}>
                  {hasActiveSearch
                    ? 'Попробуйте изменить запрос.'
                    : isAdmin
                      ? 'Создайте первую статью с помощью кнопки «Новая статья».'
                      : 'Скоро здесь появятся полезные материалы.'}
                </Typography>
              </Box>
            ) : (
              <Stack spacing={1.4}>
                {displayedArticles.map((article, index) => {
                  const isOpen = openId === article.id
                  const detail = details[article.id]
                  const isDetailLoading = detailLoadingId === article.id
                  const isBusy = busyArticleId === article.id
                  const canReorder = isAdmin && !hasActiveSearch && !activeCategory
                  return (
                    <Box
                      key={article.id}
                      sx={{
                        borderRadius: 'var(--morius-radius)',
                        border: 'var(--morius-border-width) solid var(--morius-card-border)',
                        background: 'var(--morius-card-bg)',
                        overflow: 'hidden',
                        transition: 'border-color 160ms ease',
                        ...(isOpen ? { borderColor: 'color-mix(in srgb, var(--morius-accent) 45%, var(--morius-card-border))' } : {}),
                      }}
                    >
                      <Stack direction="row" alignItems="center" sx={{ pr: 1 }}>
                        <Box
                          component="button"
                          type="button"
                          onClick={() => toggleArticle(article.id)}
                          aria-expanded={isOpen}
                          sx={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 1.5,
                            p: { xs: 1.6, md: 2 },
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            textAlign: 'left',
                            color: 'inherit',
                          }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                              <Typography
                                sx={{
                                  fontSize: { xs: '1.02rem', md: '1.14rem' },
                                  fontWeight: 700,
                                  color: 'var(--morius-title-text)',
                                }}
                              >
                                {article.title}
                              </Typography>
                              {article.category ? (
                                <Chip
                                  label={article.category}
                                  size="small"
                                  sx={{
                                    height: 20,
                                    fontSize: '0.68rem',
                                    color: 'var(--morius-text-secondary)',
                                    backgroundColor: 'var(--morius-elevated-bg)',
                                    border: 'var(--morius-border-width) solid var(--morius-card-border)',
                                  }}
                                />
                              ) : null}
                            </Stack>
                            {article.summary ? (
                              <Typography
                                sx={{
                                  mt: 0.4,
                                  fontSize: '0.88rem',
                                  color: 'var(--morius-text-secondary)',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                {article.summary}
                              </Typography>
                            ) : null}
                          </Box>
                          <Box sx={{ color: 'var(--morius-muted-text)', flexShrink: 0 }}>
                            <IconChevron open={isOpen} />
                          </Box>
                        </Box>

                        {isAdmin ? (
                          <Stack direction="row" alignItems="center" sx={{ flexShrink: 0 }}>
                            {canReorder ? (
                              <>
                                <IconButton
                                  size="small"
                                  disabled={index === 0 || isBusy}
                                  onClick={() => void handleReorder(article.id, -1)}
                                  aria-label="Выше"
                                  sx={controlButtonSx}
                                >
                                  ↑
                                </IconButton>
                                <IconButton
                                  size="small"
                                  disabled={index === displayedArticles.length - 1 || isBusy}
                                  onClick={() => void handleReorder(article.id, 1)}
                                  aria-label="Ниже"
                                  sx={controlButtonSx}
                                >
                                  ↓
                                </IconButton>
                              </>
                            ) : null}
                            <Button
                              size="small"
                              disabled={isBusy}
                              onClick={() => void handleEdit(article.id)}
                              sx={{ minWidth: 0, px: 1, textTransform: 'none', color: 'var(--morius-text-secondary)', '&:hover': { color: 'var(--morius-title-text)' } }}
                            >
                              Изм.
                            </Button>
                            <Button
                              size="small"
                              disabled={isBusy}
                              onClick={() => void handleDelete(article.id)}
                              sx={{ minWidth: 0, px: 1, textTransform: 'none', color: '#e0736f', '&:hover': { color: '#ff8a86' } }}
                            >
                              Удал.
                            </Button>
                          </Stack>
                        ) : null}
                      </Stack>

                      <Collapse in={isOpen} unmountOnExit>
                        <Box
                          sx={{
                            px: { xs: 1.6, md: 2.4 },
                            pb: { xs: 2, md: 2.6 },
                            pt: 0.5,
                            borderTop: 'var(--morius-border-width) solid var(--morius-card-border)',
                          }}
                        >
                          {isDetailLoading && !detail ? (
                            <Stack alignItems="center" sx={{ py: 4 }}>
                              <CircularProgress size={24} />
                            </Stack>
                          ) : detail ? (
                            <Box sx={{ pt: 1.6 }}>
                              <WikiMarkup
                                body={detail.body}
                                images={new Map(detail.images.map((image) => [String(image.id), image.url] as [string, string]))}
                              />
                              {!detail.body.trim() ? (
                                <Typography sx={{ color: 'var(--morius-muted-text)', fontStyle: 'italic' }}>
                                  В этой статье пока нет содержимого.
                                </Typography>
                              ) : null}
                            </Box>
                          ) : null}
                        </Box>
                      </Collapse>
                    </Box>
                  )
                })}
              </Stack>
            )}
          </Stack>
        </Container>
      </Box>

      <Footer
        infoLinks={[
          { label: 'Мориус Вики', path: '/wiki' },
          { label: 'Политика конфиденциальности', path: '/privacy-policy' },
          { label: 'Пользовательское соглашение', path: '/terms-of-service' },
          { label: 'Правила публикаций', path: '/publication-rules' },
        ]}
        onNavigate={onNavigate}
      />

      {isAdmin && authToken ? (
        <WikiEditorDialog
          open={editorOpen}
          token={authToken}
          initial={editingInitial}
          onClose={() => {
            setEditorOpen(false)
            setEditingInitial(null)
          }}
          onSaved={(detail) => void handleSaved(detail)}
        />
      ) : null}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3500}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)} sx={{ width: '100%' }}>
          {notice ?? ''}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default WikiPage
