import { Dialog, DialogActions, DialogContent, DialogTitle, IconButton, SvgIcon, type DialogProps, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'
import useMobileDialogSheet from './useMobileDialogSheet'

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
  showCloseButton?: boolean
}

const defaultPaperSx = {
  borderRadius: 'var(--morius-radius)',
  border: 'var(--morius-border-width) solid var(--morius-card-border)',
  background: 'var(--morius-dialog-bg)',
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
  showCloseButton = true,
}: BaseDialogProps) {
  const mobileSheet = useMobileDialogSheet({ onClose })
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
      sx={{
        ...mobileSheet.dialogSx,
        '& .MuiButton-root': {
          border: 'none !important',
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
        '& .MuiButton-root:hover, & .MuiButton-root:active, & .MuiButton-root.Mui-focusVisible': {
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
        '& .MuiIconButton-root': {
          border: 'none !important',
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
        '& .MuiIconButton-root:hover, & .MuiIconButton-root:active, & .MuiIconButton-root.Mui-focusVisible': {
          backgroundColor: 'transparent !important',
          boxShadow: 'none !important',
        },
      }}
      BackdropProps={{
        sx: backdropSx ? ([mobileSheet.backdropSx, backdropSx] as SxProps<Theme>) : mobileSheet.backdropSx,
      }}
      PaperProps={{
        ...mobileSheet.paperTouchHandlers,
        sx: [mergedPaperSx, mobileSheet.paperSx] as SxProps<Theme>,
      }}
    >
      {showCloseButton && !mobileSheet.isMobileSheet ? (
        <IconButton
          aria-label="Закрыть"
          onClick={onClose}
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 2,
            width: 34,
            height: 34,
            borderRadius: '999px',
            color: 'var(--morius-text-secondary)',
            '&:hover': {
              color: 'var(--morius-text-primary)',
            },
          }}
        >
          <SvgIcon viewBox="0 0 24 24" sx={{ width: 18, height: 18 }}>
            <path d="M6.7 6.7a1 1 0 0 1 1.4 0L12 10.6l3.9-3.9a1 1 0 1 1 1.4 1.4L13.4 12l3.9 3.9a1 1 0 0 1-1.4 1.4L12 13.4l-3.9 3.9a1 1 0 0 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4" fill="currentColor" />
          </SvgIcon>
        </IconButton>
      ) : null}
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
