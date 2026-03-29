import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import { Check, Copy } from 'lucide-react'

// ── Copy button ───────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { /* ignore */ }
  }, [text])
  return (
    <button onClick={handleCopy} title="Copy"
      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-[var(--crab-border-strong)] bg-[var(--crab-bg-secondary)] transition-colors hover:bg-[var(--crab-bg-hover)]"
      style={{ color: copied ? '#8fba7a' : 'var(--crab-text-muted)', fontFamily: 'inherit' }}>
      {copied ? <><Check size={10} strokeWidth={2.5} />Copied</> : <><Copy size={10} strokeWidth={2} />Copy</>}
    </button>
  )
}

// ── Extract plain text from React children ────────────────────────────
function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (children !== null && typeof children === 'object' && 'props' in children) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>
    return extractText(el.props.children)
  }
  return ''
}

function extractLang(className?: string): string | null {
  const m = className?.match(/language-(\w+)/)
  return m ? m[1] : null
}

type CodeProps = { className?: string; children?: React.ReactNode }

// ── Markdown components adapted to crab dark theme ─────────────
const COMPONENTS: Components = {
  pre({ children }) {
    const codeEl = Array.isArray(children) ? children[0] : children
    const codeProps: CodeProps = (codeEl as React.ReactElement<CodeProps>)?.props ?? {}
    const lang = extractLang(codeProps.className)
    const rawText = extractText(codeProps.children ?? children)
    return (
      <div className="my-2 rounded-xl overflow-hidden border border-[var(--crab-border)]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--crab-bg-secondary)] border-b border-[var(--crab-border)]">
          <span className="text-[10px] font-mono text-[var(--crab-text-muted)] uppercase tracking-wider">{lang ?? 'code'}</span>
          <CopyButton text={rawText} />
        </div>
        {/* Body */}
        <pre className="m-0 px-4 py-3 bg-[var(--crab-bg-tertiary)] overflow-x-auto text-[12.5px] leading-relaxed">
          {children}
        </pre>
      </div>
    )
  },

  code({ children, className }) {
    const isBlock = !!extractLang(className)
    if (isBlock) return <code className={className} style={{ fontFamily: 'monospace', whiteSpace: 'pre', wordBreak: 'normal' }}>{children}</code>
    return (
      <code className="font-mono text-[0.875em] px-1.5 py-0.5 rounded bg-[var(--crab-bg-tertiary)] border border-[var(--crab-border)] text-[var(--crab-accent)]"
        style={{ wordBreak: 'break-all' }}>
        {children}
      </code>
    )
  },

  h1: ({ children }) => <h1 className="text-base font-semibold text-[var(--crab-text)] mt-4 mb-2 pb-1.5 border-b border-[var(--crab-border)] tracking-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="text-[0.95em] font-semibold text-[var(--crab-text)] mt-3 mb-1.5">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[0.9em] font-semibold text-[var(--crab-text)] mt-2 mb-1">{children}</h3>,

  p: ({ children }) => <p className="my-1.5 leading-relaxed" style={{ wordBreak: 'break-word' }}>{children}</p>,

  ul: ({ children }) => <ul className="my-1.5 pl-5 leading-relaxed text-[var(--crab-text)] list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 pl-5 leading-relaxed text-[var(--crab-text)] list-decimal">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,

  blockquote: ({ children }) => (
    <blockquote className="border-l-[3px] border-[var(--crab-accent)] bg-[var(--crab-accent-light)] px-3.5 py-2 my-2 rounded-r-lg italic text-[var(--crab-text-secondary)]">
      {children}
    </blockquote>
  ),

  table: ({ children }) => (
    <div className="overflow-x-auto my-2.5">
      <table className="w-full border-collapse text-[0.9em] border border-[var(--crab-border)] rounded-lg overflow-hidden">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--crab-bg-secondary)]">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--crab-text-secondary)] border-b border-[var(--crab-border)]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-[var(--crab-text)] border-b border-[var(--crab-border-subtle)] align-top">{children}</td>
  ),

  hr: () => <hr className="my-3 border-none border-t border-[var(--crab-border)]" />,

  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="text-[var(--crab-accent)] underline decoration-[var(--crab-accent-medium)] hover:decoration-[var(--crab-accent)]">
      {children}
    </a>
  ),

  strong: ({ children }) => <strong className="font-semibold text-[var(--crab-text)]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[var(--crab-text-secondary)]">{children}</em>,
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeHighlight]

interface MarkdownRendererProps {
  content: string
  className?: string
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={`text-[13px] text-[var(--crab-text)]${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
