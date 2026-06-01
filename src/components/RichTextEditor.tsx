import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
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
  const [isFocused, setIsFocused] = useState(false);
  // Tracks the last HTML this editor itself emitted via onChange, so we can
  // tell external value updates (cross-surface sync, task switch) apart from
  // our own echoes — only externals trigger setContent.
  const lastEmittedRef = useRef(value);

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
        const html = e.getHTML();
        lastEmittedRef.current = html;
        onChange(html);
      }, 300);
    },
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
  });

  // Sync editor doc when value changes from outside (cross-surface broadcast,
  // task switch in FocusMode). Skip echoes of our own onChange via the ref
  // compare so typing doesn't loop or drop the cursor.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    editor.commands.setContent(normalizeContent(value), { emitUpdate: false });
    lastEmittedRef.current = value;
    setIsEmpty(editor.isEmpty);
  }, [value, editor]);

  // #7 — flush a PENDING edit on unmount only. Read editor/onChange through
  // refs so the effect deps are [] (true mount/unmount), NOT [editor, onChange]:
  // callers pass inline onChange closures, so the old deps re-ran this effect
  // every parent render and its cleanup could fire an EARLY flush mid-edit,
  // re-emitting and risking a stale clobber across surfaces. With no pending
  // debounce, the cleanup writes nothing (idle close is silent); a real pending
  // edit still flushes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        const ed = editorRef.current;
        if (ed) {
          const html = ed.getHTML();
          lastEmittedRef.current = html;
          onChangeRef.current(html);
        }
      }
    };
  }, []);

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
      <FormattingBubbleMenu editor={editor} />
      <div className="relative">
        {isEmpty && !isFocused && placeholder && (
          <div className="absolute inset-0 pointer-events-none text-fg-faded select-none">
            {placeholder}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function FormattingBubbleMenu({ editor }: { editor: Editor }) {
  const btnBase =
    "h-7 px-2 text-[12px] rounded cursor-pointer transition-colors flex items-center justify-center font-medium";
  const inactive = "text-fg-secondary hover:bg-overlay-hover";
  const active = "text-fg bg-overlay-pressed";
  const cls = (on: boolean) => `${btnBase} ${on ? active : inactive}`;

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top" }}
      className="flex items-center gap-0.5 p-1 rounded-lg bg-elevated border border-line-soft"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={cls(editor.isActive("heading", { level: 1 }))}
        title="Heading 1"
      >
        H1
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={cls(editor.isActive("heading", { level: 2 }))}
        title="Heading 2"
      >
        H2
      </button>
      <span className="w-px h-4 bg-line-hairline mx-0.5" aria-hidden />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={cls(editor.isActive("bold"))}
        title="Bold (⌘B)"
      >
        <span className="font-bold">B</span>
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={cls(editor.isActive("italic"))}
        title="Italic (⌘I)"
      >
        <span className="italic">I</span>
      </button>
      <span className="w-px h-4 bg-line-hairline mx-0.5" aria-hidden />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={cls(editor.isActive("bulletList"))}
        title="Bulleted list"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="3" cy="4" r="0.8" fill="currentColor" />
          <line x1="6" y1="4" x2="14" y2="4" />
          <circle cx="3" cy="8" r="0.8" fill="currentColor" />
          <line x1="6" y1="8" x2="14" y2="8" />
          <circle cx="3" cy="12" r="0.8" fill="currentColor" />
          <line x1="6" y1="12" x2="14" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={cls(editor.isActive("orderedList"))}
        title="Numbered list"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <text x="1" y="6" fontSize="5" fill="currentColor" stroke="none" fontWeight="600">1</text>
          <line x1="6" y1="4" x2="14" y2="4" />
          <text x="1" y="10" fontSize="5" fill="currentColor" stroke="none" fontWeight="600">2</text>
          <line x1="6" y1="8" x2="14" y2="8" />
          <text x="1" y="14" fontSize="5" fill="currentColor" stroke="none" fontWeight="600">3</text>
          <line x1="6" y1="12" x2="14" y2="12" />
        </svg>
      </button>
    </BubbleMenu>
  );
}
