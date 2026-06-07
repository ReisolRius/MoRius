import { Box } from '@mui/material'
import { keyframes } from '@mui/system'
import soulMoriusIcon from '../../assets/icons/soul-moirus.svg'

type FantasyRouteTransitionProps = {
  active: boolean
}

function isStaticPublicPathname(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '').toLowerCase() || '/'
  return normalized === '/' || normalized === '/auth' || normalized === '/privacy-policy' || normalized === '/terms-of-service' || normalized === '/publication-rules'
}

const overlayFade = keyframes`
  0% { opacity: 0; }
  14% { opacity: 1; }
  74% { opacity: 1; }
  100% { opacity: 0; }
`

const shadowVeil = keyframes`
  0% { opacity: 0; }
  16% { opacity: 0.94; }
  78% { opacity: 0.92; }
  100% { opacity: 0; }
`

const flameEnter = keyframes`
  0% { transform: translate3d(0, 10px, 0) scale(0.72); opacity: 0; filter: blur(10px); }
  18% { transform: translate3d(0, 0, 0) scale(1); opacity: 1; filter: blur(0); }
  78% { transform: translate3d(0, -2px, 0) scale(1.03); opacity: 1; filter: blur(0); }
  100% { transform: translate3d(0, -12px, 0) scale(0.9); opacity: 0; filter: blur(5px); }
`

const flameBreath = keyframes`
  0% { transform: translate3d(0, 0, 0) rotate(-1.4deg) scaleX(0.98) scaleY(1); }
  30% { transform: translate3d(1px, -4px, 0) rotate(1.8deg) scaleX(1.04) scaleY(1.05); }
  58% { transform: translate3d(-1px, -1px, 0) rotate(-0.8deg) scaleX(1.01) scaleY(0.98); }
  100% { transform: translate3d(0, 0, 0) rotate(-1.4deg) scaleX(0.98) scaleY(1); }
`

const auraPulse = keyframes`
  0% { transform: scale(0.82); opacity: 0; }
  18% { transform: scale(1); opacity: 0.68; }
  54% { transform: scale(1.08); opacity: 0.48; }
  100% { transform: scale(1.26); opacity: 0; }
`

const sparkDrift = keyframes`
  0% { transform: translate3d(0, 18px, 0) scale(0.48); opacity: 0; }
  22% { opacity: 0.88; }
  100% { transform: translate3d(var(--spark-x), -88px, 0) scale(1.08); opacity: 0; }
`

const groundGlow = keyframes`
  0% { transform: translateX(-50%) scaleX(0.48); opacity: 0; }
  24% { transform: translateX(-50%) scaleX(1); opacity: 0.5; }
  100% { transform: translateX(-50%) scaleX(1.22); opacity: 0; }
`

const soulMaskSx = {
  WebkitMaskImage: `url(${soulMoriusIcon})`,
  maskImage: `url(${soulMoriusIcon})`,
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
}

function FantasyRouteTransition({ active }: FantasyRouteTransitionProps) {
  if (!active || (typeof window !== 'undefined' && isStaticPublicPathname(window.location.pathname))) {
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
        background: 'rgba(2, 4, 8, 0.86)',
        animation: `${overlayFade} 760ms ease-out forwards`,
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at center, rgba(255, 132, 91, 0.16) 0%, rgba(20, 14, 17, 0.72) 35%, rgba(2, 4, 8, 0.94) 78%), linear-gradient(180deg, rgba(2, 4, 8, 0.88) 0%, rgba(4, 6, 11, 0.96) 100%)',
          animation: `${shadowVeil} 760ms ease-out forwards`,
        }}
      />
      <Box
        sx={{
          position: 'relative',
          width: { xs: 150, md: 190 },
          height: { xs: 190, md: 240 },
          display: 'grid',
          placeItems: 'center',
          animation: `${flameEnter} 760ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: { xs: 6, md: 10 },
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 50% 46%, rgba(255, 229, 168, 0.5) 0%, rgba(255, 136, 88, 0.25) 34%, rgba(92, 118, 255, 0.12) 58%, transparent 72%)',
            boxShadow:
              '0 0 36px rgba(255, 155, 93, 0.34), 0 0 84px rgba(123, 103, 255, 0.16), inset 0 0 32px rgba(255, 232, 186, 0.18)',
            animation: `${auraPulse} 760ms ease-out forwards`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            width: { xs: 84, md: 106 },
            height: { xs: 132, md: 168 },
            background:
              'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 228, 158, 0.96) 26%, rgba(255, 124, 83, 0.94) 64%, rgba(138, 93, 255, 0.42) 100%)',
            ...soulMaskSx,
            transformOrigin: '50% 74%',
            filter:
              'drop-shadow(0 0 14px rgba(255, 237, 190, 0.68)) drop-shadow(0 0 32px rgba(255, 108, 76, 0.46)) drop-shadow(0 0 54px rgba(112, 103, 255, 0.25))',
            animation: `${flameBreath} 1180ms ease-in-out infinite`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            width: { xs: 44, md: 56 },
            height: { xs: 74, md: 94 },
            mt: { xs: -0.7, md: -1 },
            background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255, 237, 177, 0.94) 78%, transparent 100%)',
            ...soulMaskSx,
            transformOrigin: '50% 74%',
            opacity: 0.74,
            filter: 'blur(0.3px) drop-shadow(0 0 18px rgba(255,255,255,0.42))',
            animation: `${flameBreath} 960ms ease-in-out infinite reverse`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            bottom: { xs: 20, md: 26 },
            width: { xs: 132, md: 172 },
            height: { xs: 26, md: 34 },
            transform: 'translateX(-50%)',
            borderRadius: '50%',
            background:
              'radial-gradient(ellipse at center, rgba(255, 164, 91, 0.58) 0%, rgba(255, 112, 80, 0.18) 44%, transparent 72%)',
            filter: 'blur(3px)',
            animation: `${groundGlow} 760ms ease-out forwards`,
          }}
        />
        {[
          { left: '20%', top: '72%', delay: '20ms', x: '-18px' },
          { left: '34%', top: '78%', delay: '70ms', x: '-8px' },
          { left: '50%', top: '75%', delay: '0ms', x: '3px' },
          { left: '66%', top: '79%', delay: '110ms', x: '12px' },
          { left: '82%', top: '70%', delay: '45ms', x: '19px' },
        ].map((spark, index) => (
          <Box
            key={`soul-loader-spark-${index}`}
            sx={{
              position: 'absolute',
              left: spark.left,
              top: spark.top,
              width: { xs: 5, md: 7 },
              height: { xs: 5, md: 7 },
              borderRadius: '50%',
              background: 'radial-gradient(circle at center, rgba(255, 247, 214, 0.98) 0%, rgba(255, 152, 91, 0.86) 58%, transparent 100%)',
              boxShadow: '0 0 12px rgba(255, 170, 102, 0.62)',
              '--spark-x': spark.x,
              animation: `${sparkDrift} 760ms ease-out forwards`,
              animationDelay: spark.delay,
            }}
          />
        ))}
      </Box>
    </Box>
  )
}

export default FantasyRouteTransition
