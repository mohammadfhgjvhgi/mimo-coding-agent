"use client"

import * as React from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import { CodeBlock } from "./code-block"

interface MarkdownRendererProps {
  content: string
}

const components: Components = {
  code(props) {
    const { className, children, ...rest } = props as {
      className?: string
      children?: React.ReactNode
      [key: string]: unknown
    }
    const inline = !className
    const match = /language-(\w+)/.exec(className || "")
    const codeStr = String(children ?? "").replace(/\n$/, "")

    if (inline) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    }
    return <CodeBlock language={match ? match[1] : "text"} code={codeStr} />
  },
  pre({ children }) {
    // react-markdown wraps our CodeBlock in <pre>; we already render the
    // full container, so just pass through.
    return <>{children}</>
  },
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  )
}
