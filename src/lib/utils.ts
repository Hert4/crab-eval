import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function randomUUID(): string {
  const c = (typeof globalThis !== 'undefined' ? (globalThis as { crypto?: Crypto }).crypto : undefined)
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex: string[] = []
    for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  }
  const rand = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  const a = rand(), b = rand(), c2 = rand(), d = rand()
  const y = ((parseInt(c2.slice(0, 1), 16) & 0x3) | 0x8).toString(16)
  return `${a}-${b.slice(0, 4)}-4${b.slice(4, 7)}-${y}${c2.slice(1, 4)}-${c2.slice(4)}${d}`
}
