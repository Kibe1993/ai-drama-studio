"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ImportDialog({
  open,
  onClose,
  onImport,
  title = "Import Content",
}: {
  open: boolean;
  onClose: () => void;
  onImport: (content: string, format: "markdown" | "json" | "text") => Promise<void>;
  title?: string;
}) {
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<"markdown" | "json" | "text">("markdown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    setContent(text);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "json") setFormat("json");
    else if (ext === "md") setFormat("markdown");
    else setFormat("text");
  }, []);

  const handleImport = useCallback(async () => {
    if (!content.trim()) {
      setError("Content is empty");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onImport(content, format);
      onClose();
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [content, format, onImport, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-4 rounded-lg border border-[#3a342c] bg-[#1a140e] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-[#f3efe6]">{title}</h2>

        <div className="mt-4 flex gap-2">
          <Button
            variant={mode === "paste" ? "primary" : "quiet"}
            size="sm"
            onClick={() => setMode("paste")}
          >
            Paste Content
          </Button>
          <Button
            variant={mode === "file" ? "primary" : "quiet"}
            size="sm"
            onClick={() => setMode("file")}
          >
            Upload File
          </Button>
        </div>

        <div className="mt-4 flex gap-2">
          {(["markdown", "json", "text"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFormat(f)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium",
                format === f
                  ? "bg-[#c4a574] text-[#1a140e]"
                  : "border border-[#3a342c] text-[#a39b8f]"
              )}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        {mode === "file" && (
          <input
            type="file"
            accept=".md,.json,.txt,.text"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="mt-4 block w-full text-sm text-[#a39b8f]"
          />
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste content here..."
          className="studio-field mt-4 min-h-48 w-full resize-y"
        />

        {error && <p className="mt-2 text-sm text-[#e7b2a8]">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleImport} disabled={busy}>
            {busy ? "Importing..." : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}