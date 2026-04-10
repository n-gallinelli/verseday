import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Typography from "@tiptap/extension-typography";
import { useRef, useEffect, useState } from "react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

/** Normalize plain-text notes to HTML for Tiptap */
function normalizeContent(raw: string): string {
  if (!raw) return "";
  if (raw.trimStart().startsWith("<")) return raw;
  // Plain text — wrap paragraphs
  return raw
    .split("\n")
    .map((line) => `<p>${line || "<br>"}</p>`)
    .join("");
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "",
  className = "",
}: RichTextEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEmpty, setIsEmpty] = useState(() => !value || value.trim() === "");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Typography,
      Link.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
      }),
    ],
    content: normalizeContent(value),
    editorProps: {
      attributes: {
        class: "tiptap",
      },
    },
    onCreate: ({ editor: e }) => {
      setIsEmpty(e.isEmpty);
    },
    onUpdate: ({ editor: e }) => {
      setIsEmpty(e.isEmpty);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(e.getHTML());
      }, 300);
    },
  });

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        if (editor) {
          onChange(editor.getHTML());
        }
      }
    };
  }, [editor, onChange]);

  if (!editor) return null;

  return (
    <div className={`relative ${className}`}>
      {isEmpty && placeholder && (
        <div className="absolute top-0 left-0 pointer-events-none text-black/25 select-none">
          {placeholder}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
