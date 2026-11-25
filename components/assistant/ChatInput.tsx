"use client";

import { useState, useRef, useEffect } from "react";
import styles from "@/app/(studio)/assistant/assistant.module.css";

type Props = {
  onSend: (message: string) => void;
  onCancel: () => void;
  disabled: boolean;
  streaming: boolean;
};

export function ChatInput({ onSend, onCancel, disabled, streaming }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <div className={styles.inputArea}>
      <div className={styles.inputRow}>
        <textarea
          ref={ref}
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your projects, story bibles, characters…"
          rows={1}
          disabled={streaming}
        />
        {streaming ? (
          <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        ) : (
          <button className={styles.sendBtn} onClick={handleSend} disabled={disabled || !text.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}