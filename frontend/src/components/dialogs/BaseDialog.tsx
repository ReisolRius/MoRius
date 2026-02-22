import { Dialog, DialogActions, DialogContent, DialogTitle, type DialogProps, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'

type BaseDialogProps = {
  open: boolean
  onClose: () => void
  header?: ReactNode
  actions?: ReactNode
  children: ReactNode
  maxWidth?: DialogProps['maxWidth']
  fullWidth?: boolean
  transitionComponent?: DialogProps['TransitionComponent']
  backdropSx?: SxProps<Theme>
  rawChildren?: boolean
  paperSx?: SxProps<Theme>
  titleSx?: SxProps<Theme>
  contentSx?: SxProps<Theme>
  actionsSx?: SxProps<Theme>
}

const defaultPaperSx = {
  borderRadius: 'var(--morius-radius)',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  background: 'var(--morius-card-bg)',
  boxShadow: '0 26px 60px rgba(0, 0, 0, 0.52)',
} as const

const defaultTitleSx = {
  px: 'var(--morius-content-gap)',
  pt: 'var(--morius-title-top-gap)',
  pb: 'var(--morius-title-bottom-gap)',
} as const

const defaultContentSxWithHeader = {
  px: 'var(--morius-content-gap)',
  pt: 0,
  pb: 'var(--morius-content-gap)',
} as const

const defaultContentSxWithoutHeader = {
  px: 'var(--morius-content-gap)',
  pt: 'var(--morius-content-gap)',
  pb: 'var(--morius-content-gap)',
} as const

const defaultActionsSx = {
  px: 'var(--morius-content-gap)',
  pb: 'var(--morius-content-gap)',
  pt: 0,
  columnGap: 'var(--morius-content-gap)',
} as const

function BaseDialog({
  open,
  onClose,
  header,
  actions,
  children,
  maxWidth = 'sm',
  fullWidth = true,
  transitionComponent,
  backdropSx,
  rawChildren = false,
  paperSx,
  titleSx,
  contentSx,
  actionsSx,
}: BaseDialogProps) {
  const mergedPaperSx = paperSx ? ([defaultPaperSx, paperSx] as SxProps<Theme>) : defaultPaperSx
  const mergedTitleSx = titleSx ? ([defaultTitleSx, titleSx] as SxProps<Theme>) : defaultTitleSx
  const contentBaseSx = header ? defaultContentSxWithHeader : defaultContentSxWithoutHeader
  const mergedContentSx = contentSx ? ([contentBaseSx, contentSx] as SxProps<Theme>) : contentBaseSx
  const mergedActionsSx = actionsSx ? ([defaultActionsSx, actionsSx] as SxProps<Theme>) : defaultActionsSx

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      TransitionComponent={transitionComponent}
      BackdropProps={backdropSx ? { sx: backdropSx } : undefined}
      PaperProps={{ sx: mergedPaperSx }}
    >
      {rawChildren ? (
        children
      ) : (
        <>
          {header ? <DialogTitle sx={mergedTitleSx}>{header}</DialogTitle> : null}
          <DialogContent sx={mergedContentSx}>{children}</DialogContent>
          {actions ? <DialogActions sx={mergedActionsSx}>{actions}</DialogActions> : null}
        </>
      )}
    </Dialog>
  )
}

export default BaseDialog
