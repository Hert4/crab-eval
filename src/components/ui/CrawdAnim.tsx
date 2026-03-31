/**
 * CrawdAnim — pixel-art crab mascot animations
 * Uses SVG files from /public/animations/
 *
 * Usage:
 *   <CrawdAnim type="thinking" size={80} />
 *   <CrawdAnim type="happy"    size={64} />
 *   <CrawdAnim type="sleeping" size={80} />
 *   <CrawdAnim type="typing"   size={80} />
 *   <CrawdAnim type="static"   size={48} />
 */

export type CrawdAnimType =
  | 'static'
  | 'thinking'
  | 'happy'
  | 'sleeping'
  | 'typing'
  | 'disconnected'
  | 'notification'

const FILE_MAP: Record<CrawdAnimType, string> = {
  static:       '/animations/clawd-static-base.svg',
  thinking:     '/animations/clawd-working-thinking.svg',
  happy:        '/animations/clawd-happy.svg',
  sleeping:     '/animations/clawd-sleeping.svg',
  typing:       '/animations/clawd-working-typing.svg',
  disconnected: '/animations/clawd-disconnected.svg',
  notification: '/animations/clawd-notification.svg',
}

export function CrawdAnim({
  type = 'static',
  size = 80,
  className = '',
}: {
  type?: CrawdAnimType
  size?: number
  className?: string
}) {
  return (
    <img
      src={FILE_MAP[type]}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={`mx-auto select-none ${className}`}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
