"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AUTOSAVE_DELAY_MS = 2000;

export function DocumentEditor({
  initialContent = "",
  onSave,
  readOnly = false,
  placeholder = "Start writing...",
}: {
  initialContent?: string;
  onSave?: (markdown: string) => Promise<void>;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialContent);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
    ],
    content: initialContent,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "prose prose-invert max-w-none min-h-96 rounded-lg border border-[#3a342c] bg-[#181612] p-4 text-[#f3efe6] focus:outline-none focus:ring-1 focus:ring-[#c4a574]",
        "data-placeholder": placeholder,
      },
    },
  });

  const performSave = useCallback(async () => {
    if (!editor || !onSave) return;
    const markdown = editor.getText();
    if (markdown === lastSavedRef.current) return;
    setSaveState("saving");
    try {
      await onSave(markdown);
      lastSavedRef.current = markdown;
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  }, [editor, onSave]);

  useEffect(() => {
    if (!editor || readOnly || !onSave) return;
    const handleUpdate = () => {
      setSaveState("idle");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(performSave, AUTOSAVE_DELAY_MS);
    };
    editor.on("update", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [editor, readOnly, onSave, performSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex items-center gap-2">
          <ToolbarButton
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            label="B"
          />
          <ToolbarButton
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            label="I"
          />
          <ToolbarButton
            active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            label="H1"
          />
          <ToolbarButton
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            label="H2"
          />
          <ToolbarButton
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            label="•"
          />
          <ToolbarButton
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            label="1."
          />
          <div className="ml-auto text-xs text-[#a39b8f]">
            {saveState === "saving" && "Saving..."}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && "Save failed"}
          </div>
          <Button
            variant="quiet"
            size="sm"
            onClick={performSave}
            disabled={saveState === "saving"}
          >
            Save
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 w-8 rounded text-sm font-medium transition-colors",
        active
          ? "bg-[#c4a574] text-[#1a140e]"
          : "border border-[#3a342c] text-[#f3efe6] hover:bg-[#2a261f]"
      )}
    >
      {label}
    </button>
  );
}