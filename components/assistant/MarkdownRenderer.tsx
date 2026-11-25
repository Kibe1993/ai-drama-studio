"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "@/app/(studio)/assistant/assistant.module.css";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}