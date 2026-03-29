export function CrabLogo({ size = 22 }: { size?: number }) {
  const scale = size / 16
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 15 16"
      width={15 * scale}
      height={16 * scale}
      style={{ display: 'block' }}
    >
      <rect x="3" y="15" width="9" height="1" fill="#000000" opacity="0.5" />
      <g fill="#DE886D">
        <rect x="2" y="6" width="11" height="7" />
        <rect x="0" y="9" width="2" height="2" />
        <rect x="13" y="9" width="2" height="2" />
        <rect x="3" y="13" width="1" height="2" />
        <rect x="5" y="13" width="1" height="2" />
        <rect x="9" y="13" width="1" height="2" />
        <rect x="11" y="13" width="1" height="2" />
      </g>
      <g fill="#000000">
        <rect x="4" y="8" width="1" height="2" />
        <rect x="10" y="8" width="1" height="2" />
      </g>
    </svg>
  )
}
