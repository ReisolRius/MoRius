import { Box } from '@mui/material'
import { keyframes } from '@mui/system'

type FantasyRouteTransitionProps = {
  active: boolean
}

const overlayFade = keyframes`
  0% { opacity: 0; }
  18% { opacity: 1; }
  76% { opacity: 1; }
  100% { opacity: 0; }
`

const shadowVeil = keyframes`
  0% { opacity: 0; }
  20% { opacity: 0.88; }
  74% { opacity: 0.86; }
  100% { opacity: 0; }
`

const portalPulse = keyframes`
  0% { transform: scale(0.68); opacity: 0; }
  20% { transform: scale(1); opacity: 1; }
  72% { transform: scale(1.08); opacity: 0.92; }
  100% { transform: scale(1.22); opacity: 0; }
`

const haloSpin = keyframes`
  0% { transform: rotate(0deg) scale(0.92); opacity: 0.18; }
  35% { transform: rotate(110deg) scale(1); opacity: 0.56; }
  100% { transform: rotate(240deg) scale(1.16); opacity: 0; }
`

const runeGlow = keyframes`
  0% { transform: scale(0.84); opacity: 0; filter: blur(6px); }
  25% { transform: scale(1); opacity: 0.95; filter: blur(0px); }
  80% { transform: scale(1.04); opacity: 0.72; filter: blur(0px); }
  100% { transform: scale(1.12); opacity: 0; filter: blur(2px); }
`

const sparkDrift = keyframes`
  0% { transform: translate3d(0, 18px, 0) scale(0.5); opacity: 0; }
  20% { opacity: 0.9; }
  100% { transform: translate3d(0, -72px, 0) scale(1.18); opacity: 0; }
`

const waveSweep = keyframes`
  0% { transform: scaleX(0.24); opacity: 0; }
  28% { transform: scaleX(1); opacity: 0.34; }
  100% { transform: scaleX(1.28); opacity: 0; }
`

function FantasyRouteTransition({ active }: FantasyRouteTransitionProps) {
  if (!active) {
    return null
  }

  return (
    <Box
      aria-hidden
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1800,
        pointerEvents: 'none',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        animation: `${overlayFade} 640ms ease-out forwards`,
        background:
          'radial-gradient(circle at center, rgba(122, 188, 255, 0.18) 0%, rgba(44, 72, 104, 0.14) 22%, rgba(10, 16, 26, 0.08) 44%, transparent 72%)',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(4, 8, 14, 0.78) 0%, rgba(6, 10, 18, 0.84) 42%, rgba(5, 8, 14, 0.76) 100%)',
          animation: `${shadowVeil} 640ms ease-out forwards`,
        }}
      />
      <Box
        sx={{
          position: 'relative',
          width: { xs: 156, md: 204 },
          height: { xs: 156, md: 204 },
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 50% 50%, rgba(255, 244, 208, 0.92) 0%, rgba(255, 174, 120, 0.84) 20%, rgba(90, 170, 255, 0.72) 48%, rgba(48, 84, 154, 0.34) 70%, transparent 100%)',
            boxShadow:
              '0 0 28px rgba(130, 189, 255, 0.5), 0 0 62px rgba(255, 184, 126, 0.34), inset 0 0 30px rgba(255, 248, 235, 0.42)',
            animation: `${portalPulse} 560ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: { xs: -12, md: -16 },
            borderRadius: '50%',
            border: '1px solid rgba(207, 231, 255, 0.58)',
            boxShadow: '0 0 24px rgba(146, 196, 255, 0.26)',
            animation: `${haloSpin} 560ms ease-out forwards`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: { xs: 24, md: 34 },
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(255, 247, 229, 0.92)',
            fontSize: { xs: '2rem', md: '2.6rem' },
            fontWeight: 800,
            letterSpacing: '0.12em',
            textShadow: '0 0 22px rgba(255, 212, 145, 0.72)',
            animation: `${runeGlow} 560ms ease-out forwards`,
          }}
        >
          ✦
        </Box>
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: { xs: 220, md: 300 },
            height: 2,
            transform: 'translate(-50%, -50%)',
            background:
              'linear-gradient(90deg, transparent 0%, rgba(133, 193, 255, 0.16) 16%, rgba(255, 223, 173, 0.9) 50%, rgba(133, 193, 255, 0.16) 84%, transparent 100%)',
            boxShadow: '0 0 14px rgba(255, 216, 157, 0.34)',
            animation: `${waveSweep} 560ms ease-out forwards`,
          }}
        />
        {[
          { left: '16%', top: '62%', delay: '20ms' },
          { left: '32%', top: '74%', delay: '60ms' },
          { left: '49%', top: '68%', delay: '0ms' },
          { left: '67%', top: '76%', delay: '90ms' },
          { left: '82%', top: '60%', delay: '35ms' },
        ].map((spark, index) => (
          <Box
            key={`fantasy-spark-${index}`}
            sx={{
              position: 'absolute',
              left: spark.left,
              top: spark.top,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at center, rgba(255, 245, 214, 0.98) 0%, rgba(255, 190, 132, 0.86) 46%, rgba(128, 194, 255, 0.1) 100%)',
              boxShadow: '0 0 14px rgba(255, 214, 153, 0.6)',
              animation: `${sparkDrift} 560ms ease-out forwards`,
              animationDelay: spark.delay,
            }}
          />
        ))}
      </Box>
    </Box>
  )
}

export default FantasyRouteTransition
