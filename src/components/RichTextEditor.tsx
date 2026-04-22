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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert markdown link syntax `[text](url)` (already HTML-escaped) to real
 * <a> tags. Only http(s) URLs are accepted, so this can't introduce
 * javascript: hrefs even if input is messy.
 */
function convertMarkdownLinks(escapedLine: string): string {
  return escapedLine.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, text, url) => `<a href="${url}">${text}</a>`
  );
}

/** Normalize plain-text or markdown-flavoured notes to HTML for Tiptap */
function normalizeContent(raw: string): string {
  if (!raw) return "";
  if (raw.trimStart().startsWith("<")) return raw;
  // Plain text — escape, convert any markdown links, wrap paragraphs
  return raw
    .split("\n")
    .map((line) => {
      const linked = convertMarkdownLinks(escapeHtml(line));
      return `<p>${linked || "<br>"}</p>`;
    })
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
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
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
    <div
      className={`cursor-text ${className}`}
      onClick={(e) => {
        // Make the entire visible box act as a click target for the editor.
        // If the click landed on padding / empty space below the text — i.e.
        // anywhere that *isn't* the contenteditable itself — redirect focus
        // to the end of the document. Clicks inside the editor are left
        // alone so Tiptap can place the cursor at the click position.
        const editorEl = editor.view.dom;
        if (!editorEl.contains(e.target as Node)) {
          editor.commands.focus("end");
        }
      }}
    >
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute top-0 left-0 pointer-events-none text-black/25 select-none">
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
