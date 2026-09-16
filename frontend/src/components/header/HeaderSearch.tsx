import { useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react'
import { Box } from '@mui/material'
import searchIconMarkup from '../../assets/icons/search.svg?raw'
import searchCloseIconMarkup from '../../assets/icons/search-close.svg?raw'
import ThemedSvgIcon from '../icons/ThemedSvgIcon'
import { HEADER_CONTROL_SIZE, headerIconButtonSx } from './headerStyles'

export type HeaderSearchProps = {
  /** Controlled value: the page filters its own content as the player types. */
  value?: string
  onChange?: (value: string) => void
  /** Uncontrolled mode: Enter hands the query over (the header opens the community with it). */
  onSubmit?: (value: string) => void
  placeholder: string
  ariaLabel: string
  maxLength?: number
}

const EXPANDED_WIDTH = 'min(340px, calc(100vw - 32px))'

function HeaderSearch({ value, onChange, onSubmit, placeholder, ariaLabel, maxLength = 120 }: HeaderSearchProps) {
  const isControlled = typeof value === 'string' && typeof onChange === 'function'
  const [draft, setDraft] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const currentValue = isControlled ? value : draft
  // A filter that is already applied (e.g. a query carried in from another page) keeps the
  // field open, so the player can always see what the list is narrowed by.
  const isExpanded = isOpen || currentValue.length > 0

  const updateValue = (nextValue: string) => {
    const limitedValue = nextValue.slice(0, maxLength)
    if (isControlled) {
      onChange?.(limitedValue)
      return
    }
    setDraft(limitedValue)
  }

  const handleOpen = () => {
    setIsOpen(true)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }

  const handleClose = () => {
    updateValue('')
    setIsOpen(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
      inputRef.current?.blur()
      return
    }
    if (event.key === 'Enter' && !isControlled) {
      const normalizedQuery = currentValue.replace(/\s+/g, ' ').trim()
      if (!normalizedQuery) {
        return
      }
      event.preventDefault()
      setDraft('')
      setIsOpen(false)
      onSubmit?.(normalizedQuery)
    }
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusTarget = event.relatedTarget
    if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) {
      return
    }
    if (!currentValue.trim()) {
      updateValue('')
      setIsOpen(false)
    }
  }

  return (
    <Box
      onBlur={handleBlur}
      sx={{
        position: 'relative',
        width: HEADER_CONTROL_SIZE,
        height: HEADER_CONTROL_SIZE,
        flex: `0 0 ${HEADER_CONTROL_SIZE}px`,
      }}
    >
      <Box
        component="button"
        type="button"
        aria-label={ariaLabel}
        aria-expanded={isExpanded ? 'true' : 'false'}
        onClick={handleOpen}
        tabIndex={isExpanded ? -1 : 0}
        sx={{
          ...headerIconButtonSx,
          opacity: isExpanded ? 0 : 1,
          pointerEvents: isExpanded ? 'none' : 'auto',
          transition: `${headerIconButtonSx.transition}, opacity 140ms ease`,
        }}
      >
        <ThemedSvgIcon markup={searchIconMarkup} size={17} />
      </Box>

      <Box
        role="search"
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          zIndex: 3,
          height: HEADER_CONTROL_SIZE,
          width: isExpanded ? EXPANDED_WIDTH : `${HEADER_CONTROL_SIZE}px`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          pl: '12px',
          pr: '5px',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.12)',
          backgroundColor: 'rgba(42, 46, 56, 0.97)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: isExpanded ? '0 18px 40px -22px rgba(0,0,0,0.9)' : 'none',
          overflow: 'hidden',
          opacity: isExpanded ? 1 : 0,
          pointerEvents: isExpanded ? 'auto' : 'none',
          transition:
            'width 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, border-color 160ms ease, box-shadow 200ms ease',
          '&:focus-within': {
            borderColor: 'color-mix(in oklab, var(--morius-accent) 62%, transparent)',
          },
        }}
      >
        <ThemedSvgIcon markup={searchIconMarkup} size={16} sx={{ color: 'var(--morius-muted-text)' }} />
        <Box
          component="input"
          ref={inputRef}
          type="text"
          value={currentValue}
          onChange={(event: ChangeEvent<HTMLInputElement>) => updateValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          tabIndex={isExpanded ? 0 : -1}
          sx={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            p: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'var(--morius-title-text)',
            font: 'inherit',
            fontSize: '0.875rem',
            lineHeight: 1,
            '&::placeholder': {
              color: 'var(--morius-muted-text)',
              opacity: 1,
            },
          }}
        />
        <Box
          component="button"
          type="button"
          aria-label="Закрыть поиск"
          onClick={handleClose}
          tabIndex={isExpanded ? 0 : -1}
          sx={{
            width: 28,
            height: 28,
            flex: '0 0 28px',
            display: 'grid',
            placeItems: 'center',
            p: 0,
            border: 'none',
            borderRadius: '8px',
            backgroundColor: 'transparent',
            color: 'var(--morius-muted-text)',
            cursor: 'pointer',
            lineHeight: 0,
            transition: 'background-color 160ms ease, color 160ms ease',
            '&:hover': {
              backgroundColor: 'rgba(255,255,255,0.08)',
              color: 'var(--morius-title-text)',
            },
          }}
        >
          <ThemedSvgIcon markup={searchCloseIconMarkup} size={13} />
        </Box>
      </Box>
    </Box>
  )
}

export default HeaderSearch
