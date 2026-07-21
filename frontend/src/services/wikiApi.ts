import { requestJson, requestNoContent } from './httpClient'

const WIKI_NETWORK_ERROR = 'Не удалось связаться с сервером Мориус Вики.'

export type WikiArticleListItem = {
  id: number
  title: string
  category: string
  summary: string
  position: number
  updated_at: string | null
}

export type WikiArticleImage = {
  id: number
  /** Fully-resolved media URL for rendering. */
  url: string
}

export type WikiArticleDetail = {
  id: number
  title: string
  category: string
  summary: string
  body: string
  position: number
  images: WikiArticleImage[]
  created_at: string | null
  updated_at: string | null
}

export type WikiArticleImagePayload = {
  /** Placeholder key referenced inside the body as [[image:<key>]]. */
  key: string
  /** Data URL for a new/replaced image (omit for unchanged images). */
  data_url?: string | null
  /** Id of an already-stored image to reuse as-is. */
  image_id?: number | null
}

export type WikiArticleSavePayload = {
  title: string
  category: string
  summary: string
  body: string
  images: WikiArticleImagePayload[]
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export async function listWikiArticles(query?: string): Promise<WikiArticleListItem[]> {
  const trimmed = (query ?? '').trim()
  const search = trimmed ? `?query=${encodeURIComponent(trimmed)}` : ''
  return requestJson<WikiArticleListItem[]>(
    `/api/auth/wiki/articles${search}`,
    { method: 'GET' },
    WIKI_NETWORK_ERROR,
  )
}

export async function getWikiArticle(articleId: number): Promise<WikiArticleDetail> {
  return requestJson<WikiArticleDetail>(
    `/api/auth/wiki/articles/${articleId}`,
    { method: 'GET' },
    WIKI_NETWORK_ERROR,
  )
}

export async function createWikiArticle(payload: {
  token: string
  article: WikiArticleSavePayload
}): Promise<WikiArticleDetail> {
  return requestJson<WikiArticleDetail>(
    '/api/auth/wiki/articles',
    {
      method: 'POST',
      headers: authHeaders(payload.token),
      body: JSON.stringify(payload.article),
    },
    WIKI_NETWORK_ERROR,
  )
}

export async function updateWikiArticle(payload: {
  token: string
  articleId: number
  article: WikiArticleSavePayload
}): Promise<WikiArticleDetail> {
  return requestJson<WikiArticleDetail>(
    `/api/auth/wiki/articles/${payload.articleId}`,
    {
      method: 'PUT',
      headers: authHeaders(payload.token),
      body: JSON.stringify(payload.article),
    },
    WIKI_NETWORK_ERROR,
  )
}

export async function deleteWikiArticle(payload: { token: string; articleId: number }): Promise<void> {
  return requestNoContent(
    `/api/auth/wiki/articles/${payload.articleId}`,
    {
      method: 'DELETE',
      headers: authHeaders(payload.token),
    },
    WIKI_NETWORK_ERROR,
  )
}

export async function reorderWikiArticles(payload: {
  token: string
  orderedIds: number[]
}): Promise<WikiArticleListItem[]> {
  return requestJson<WikiArticleListItem[]>(
    '/api/auth/wiki/articles/reorder',
    {
      method: 'POST',
      headers: authHeaders(payload.token),
      body: JSON.stringify({ ordered_ids: payload.orderedIds }),
    },
    WIKI_NETWORK_ERROR,
  )
}
