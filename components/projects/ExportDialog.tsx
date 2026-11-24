"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toMarkdown } from "@/lib/utils/documentExport";

export function ExportDialog({
  open,
  onClose,
  data,
  title = "Export Content",
  filename,
  markdownContent,
}: {
  open: boolean;
  onClose: () => void;
  data: unknown;
  title?: string;
  filename?: string;
  markdownContent?: string;
}) {
  const [format, setFormat] = useState<"json" | "markdown">("json");

  const exportContent = useCallback(() => {
    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === "json") {
      content = JSON.stringify(data, null, 2);
      mimeType = "application/json";
      ext = "json";
    } else {
      content = markdownContent ?? toMarkdown(data);
      mimeType = "text/markdown";
      ext = "md";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename ?? `export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, format, filename, markdownContent]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-4 rounded-lg border border-[#3a342c] bg-[#1a140e] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg text-[#f3efe6]">{title}</h2>

        <div className="mt-4 flex gap-2">
          {(["json", "markdown"] as const).map((f) => (
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
              {f === "json" ? "JSON" : "Markdown"}
            </button>
          ))}
        </div>

        <pre className="studio-field mt-4 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-[#cfc6b8]">
          {format === "json" ? JSON.stringify(data, null, 2) : (markdownContent ?? toMarkdown(data))}
        </pre>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" size="sm" onClick={exportContent}>
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
