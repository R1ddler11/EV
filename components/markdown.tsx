/* PROJECT E.V. — minimal chat-markdown renderer (frontend-owned).
   Renders fenced code blocks, inline code, bold/italic, headings,
   lists and links without pulling a full markdown dependency.
   Raw HTML in model output is escaped — never injected. */
"use client";

import { memo, useState } from "react";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code class=\"ev-inline-code\">$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    "<a href=\"$2\" target=\"_blank\" rel=\"noreferrer noopener\">$1</a>",
  );
  return out;
}

interface Block {
  kind: "code" | "html";
  language?: string;
  code?: string;
  html?: string;
}

function toBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(source)) !== null) {
    if (match.index > last) {
      blocks.push({ kind: "html", html: flow(source.slice(last, match.index)) });
    }
    blocks.push({
      kind: "code",
      language: match[1] || "text",
      code: (match[2] ?? "").replace(/\n$/, ""),
    });
    last = match.index + match[0].length;
  }
  if (last < source.length) {
    blocks.push({ kind: "html", html: flow(source.slice(last)) });
  }
  return blocks;
}

function flow(chunk: string): string {
  const lines = chunk.split("\n");
  let html = "";
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      html += "</ul>";
      listOpen = false;
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading && heading[1] && heading[2] !== undefined) {
      closeList();
      const level = heading[1].length;
      html += `<h${level + 2} class="ev-md-h">${inline(heading[2])}</h${level + 2}>`;
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item && item[1] !== undefined) {
      if (!listOpen) {
        html += "<ul class=\"ev-md-list\">";
        listOpen = true;
      }
      html += `<li>${inline(item[1])}</li>`;
      continue;
    }
    if (line.trim() === "") {
      closeList();
      continue;
    }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="ev-codeblock">
      <div className="ev-codeblock-bar">
        <span>{language}</span>
        <button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownView({ text }: { text: string }) {
  const blocks = toBlocks(text);
  return (
    <div className="ev-markdown">
      {blocks.map((block, i) =>
        block.kind === "code" ? (
          <CodeBlock
            key={i}
            language={block.language ?? "text"}
            code={block.code ?? ""}
          />
        ) : (
          <div key={i} dangerouslySetInnerHTML={{ __html: block.html ?? "" }} />
        ),
      )}
    </div>
  );
}

export default memo(MarkdownView);
