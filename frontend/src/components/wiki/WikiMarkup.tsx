import { Fragment, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'

/**
 * Lightweight, safe renderer for the forum-style wiki markup.
 *
 * Supported syntax:
 *   ## Heading / ### Subheading
 *   **bold**  *italic*
 *   - bullet list item
 *   > quote
 *   [[image:<key>]]  (own line = block image, inline = inline image)
 *
 * We never inject raw HTML — every node is built from parsed tokens, so admin
 * content cannot smuggle scripts or markup into the page.
 */

type WikiBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'image'; key: string }
  | { type: 'list'; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'paragraph'; lines: string[] }

const INLINE_TOKEN_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[\[image:[^\]\n]+\]\])/g
const IMAGE_LINE_RE = /^\[\[image:([^\]\n]+)\]\]$/
const HEADING_RE = /^(#{1,6})\s+(.*)$/
const LIST_ITEM_RE = /^[-•]\s+(.*)$/
const QUOTE_RE = /^>\s+(.*)$/

function parseBlocks(body: string): WikiBlock[] {
  const lines = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')

  const blocks: WikiBlock[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let quote: string[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraph })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list })
      list = []
    }
  }
  const flushQuote = () => {
    if (quote.length > 0) {
      blocks.push({ type: 'quote', lines: quote })
      quote = []
    }
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim()

    if (!trimmed) {
      flushAll()
      continue
    }

    const imageMatch = IMAGE_LINE_RE.exec(trimmed)
    if (imageMatch) {
      flushAll()
      blocks.push({ type: 'image', key: imageMatch[1].trim() })
      continue
    }

    const headingMatch = HEADING_RE.exec(trimmed)
    if (headingMatch) {
      flushAll()
      blocks.push({ type: 'heading', level: headingMatch[1].length >= 3 ? 3 : 2, text: headingMatch[2].trim() })
      continue
    }

    const listMatch = LIST_ITEM_RE.exec(trimmed)
    if (listMatch) {
      flushParagraph()
      flushQuote()
      list.push(listMatch[1])
      continue
    }

    const quoteMatch = QUOTE_RE.exec(trimmed)
    if (quoteMatch) {
      flushParagraph()
      flushList()
      quote.push(quoteMatch[1])
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(rawLine)
  }

  flushAll()
  return blocks
}

function renderInline(text: string, images: Map<string, string>, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const parts = text.split(INLINE_TOKEN_RE)
  parts.forEach((part, index) => {
    if (!part) {
      return
    }
    const key = `${keyPrefix}-${index}`
    if (part.length >= 4 && part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>)
      return
    }
    if (part.length >= 2 && part.startsWith('*') && part.endsWith('*')) {
      nodes.push(<em key={key}>{part.slice(1, -1)}</em>)
      return
    }
    if (part.startsWith('[[image:')) {
      const imageKey = part.slice('[[image:'.length, -2).trim()
      const src = images.get(imageKey)
      if (src) {
        nodes.push(
          <Box
            key={key}
            component="img"
            src={src}
            alt=""
            loading="lazy"
            sx={{
              display: 'inline-block',
              verticalAlign: 'middle',
              maxHeight: '1.6em',
              borderRadius: '4px',
              mx: 0.4,
            }}
          />,
        )
      }
      return
    }
    nodes.push(<Fragment key={key}>{part}</Fragment>)
  })
  return nodes
}

function renderBlock(block: WikiBlock, index: number, images: Map<string, string>): ReactNode {
  const blockKey = `block-${index}`
  switch (block.type) {
    case 'heading':
      return (
        <Typography
          key={blockKey}
          component={block.level === 2 ? 'h2' : 'h3'}
          sx={{
            mt: index === 0 ? 0 : block.level === 2 ? 2.6 : 2,
            mb: 1,
            fontWeight: 800,
            lineHeight: 1.25,
            color: 'var(--morius-title-text)',
            fontSize: block.level === 2 ? { xs: '1.24rem', md: '1.42rem' } : { xs: '1.08rem', md: '1.18rem' },
          }}
        >
          {renderInline(block.text, images, blockKey)}
        </Typography>
      )
    case 'image': {
      const src = images.get(block.key)
      if (!src) {
        return null
      }
      return (
        <Box
          key={blockKey}
          component="img"
          src={src}
          alt=""
          loading="lazy"
          sx={{
            display: 'block',
            width: '100%',
            maxWidth: 720,
            height: 'auto',
            my: 2,
            mx: 'auto',
            borderRadius: '14px',
            border: 'var(--morius-border-width) solid var(--morius-card-border)',
            boxShadow: '0 18px 44px rgba(0,0,0,0.34)',
          }}
        />
      )
    }
    case 'list':
      return (
        <Box
          key={blockKey}
          component="ul"
          sx={{
            my: 1.2,
            pl: 3,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.6,
            color: 'var(--morius-text-primary)',
            fontSize: { xs: '0.96rem', md: '1.02rem' },
            lineHeight: 1.6,
          }}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`${blockKey}-li-${itemIndex}`}>{renderInline(item, images, `${blockKey}-li-${itemIndex}`)}</li>
          ))}
        </Box>
      )
    case 'quote':
      return (
        <Box
          key={blockKey}
          sx={{
            my: 1.6,
            pl: 2,
            py: 0.6,
            borderLeft: '3px solid var(--morius-accent)',
            color: 'var(--morius-text-secondary)',
            fontStyle: 'italic',
            fontSize: { xs: '0.96rem', md: '1.02rem' },
            lineHeight: 1.6,
          }}
        >
          {block.lines.map((line, lineIndex) => (
            <Fragment key={`${blockKey}-q-${lineIndex}`}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(line, images, `${blockKey}-q-${lineIndex}`)}
            </Fragment>
          ))}
        </Box>
      )
    case 'paragraph':
    default:
      return (
        <Typography
          key={blockKey}
          component="p"
          sx={{
            my: 1.1,
            color: 'var(--morius-text-primary)',
            fontSize: { xs: '0.96rem', md: '1.02rem' },
            lineHeight: 1.68,
            wordBreak: 'break-word',
          }}
        >
          {block.lines.map((line, lineIndex) => (
            <Fragment key={`${blockKey}-p-${lineIndex}`}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(line, images, `${blockKey}-p-${lineIndex}`)}
            </Fragment>
          ))}
        </Typography>
      )
  }
}

type WikiMarkupProps = {
  body: string
  images: Map<string, string>
}

export function WikiMarkup({ body, images }: WikiMarkupProps) {
  const blocks = useMemo(() => parseBlocks(body), [body])
  if (blocks.length === 0) {
    return null
  }
  return <Box>{blocks.map((block, index) => renderBlock(block, index, images))}</Box>
}

export default WikiMarkup
