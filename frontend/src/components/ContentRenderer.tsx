"use client";

import { useState, useMemo } from "react";
import { Copy, Check, ExternalLink, Image as ImageIcon, FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentType, MCPContent } from "@/types/content";

interface ContentRendererProps {
  content: unknown;
  contentType?: ContentType;
  className?: string;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-slate-800 text-slate-100 rounded-lg p-3 my-2 overflow-x-auto"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-200 text-slate-800 px-1 rounded">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 hover:underline" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br />');
}

export function ContentRenderer({ content, contentType, className }: ContentRendererProps) {
  const [copied, setCopied] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Check if content is MCP format (array of {type, ...} items)
  // Also handle wrapped format: { success: true, content: [...] }
  const unwrappedContent = useMemo(() => {
    if (Array.isArray(content)) return content;
    if (content && typeof content === "object" && "content" in content) {
      const wrapped = content as { content?: unknown };
      if (Array.isArray(wrapped.content)) return wrapped.content;
    }
    return content;
  }, [content]);

  const isMCPContent = Array.isArray(unwrappedContent) &&
    unwrappedContent.every(item => item && typeof item === "object" && "type" in item);

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const detectedType = useMemo(() => {
    if (contentType) return contentType;
    if (typeof content === "string") {
      if (content.startsWith("#") || content.includes("**") || content.includes("```")) {
        return "text/markdown";
      }
      try {
        JSON.parse(content);
        return "application/json";
      } catch {
        return "text/plain";
      }
    }
    return "application/json";
  }, [content, contentType]);

  if (!isMCPContent) {
    const textContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);

    if (detectedType === "text/markdown") {
      return (
        <div className={cn("relative group", className)}>
          <button
            onClick={() => copyToClipboard(textContent)}
            className="absolute top-2 right-2 p-2 rounded-lg bg-slate-200 hover:bg-slate-300 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-600" />}
          </button>
          <div className="flex items-center gap-2 mb-2 text-xs text-slate-500">
            <FileText className="w-3 h-3" />
            <span>Markdown</span>
          </div>
          <div
            className="prose prose-sm max-w-none bg-white rounded-xl p-4 border border-slate-200"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(textContent) }}
          />
        </div>
      );
    }

    return (
      <div className={cn("relative group", className)}>
        <button
          onClick={() => copyToClipboard(textContent)}
          className="absolute top-2 right-2 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title="Copy to clipboard"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
        </button>
        <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-xs overflow-x-auto max-h-96 whitespace-pre-wrap break-words">
          {textContent}
        </pre>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {(unwrappedContent as MCPContent[]).map((item, index) => {
        if (item.type === "text") {
          let displayContent = item.text || "";
          const isMarkdown = item.mimeType === "text/markdown" ||
            displayContent.startsWith("#") ||
            displayContent.includes("**");

          if (isMarkdown) {
            return (
              <div key={index} className="relative group">
                <button
                  onClick={() => copyToClipboard(item.text || "")}
                  className="absolute top-2 right-2 p-2 rounded-lg bg-slate-200 hover:bg-slate-300 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                  title="Copy"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-600" />}
                </button>
                <div
                  className="prose prose-sm max-w-none bg-white rounded-xl p-4 border border-slate-200"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(displayContent) }}
                />
              </div>
            );
          }

          try {
            const parsed = JSON.parse(displayContent);
            displayContent = JSON.stringify(parsed, null, 2);
          } catch {
            // Not JSON
          }

          return (
            <div key={index} className="relative group">
              <button
                onClick={() => copyToClipboard(item.text || "")}
                className="absolute top-2 right-2 p-2 rounded-lg bg-slate-700 hover:bg-slate-600 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                title="Copy"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
              </button>
              <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-xs overflow-x-auto max-h-96 whitespace-pre-wrap break-words">
                {displayContent}
              </pre>
            </div>
          );
        }

        if (item.type === "image") {
          const imageUrl = item.data || "";
          const isBase64 = imageUrl.startsWith("data:");
          const displayUrl = isBase64
            ? imageUrl
            : imageUrl.startsWith("http")
              ? imageUrl
              : `data:${item.mimeType || "image/png"};base64,${imageUrl}`;

          return (
            <div key={index} className="rounded-xl overflow-hidden bg-slate-100 border-2 border-slate-200">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <ImageIcon className="w-4 h-4" />
                  <span>Image ({item.mimeType || "image/png"})</span>
                </div>
                <div className="flex items-center gap-2">
                  {!isBase64 && imageUrl.startsWith("http") && (
                    <a
                      href={imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <a
                    href={displayUrl}
                    download="image.png"
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800"
                  >
                    <Download className="w-3 h-3" />
                  </a>
                </div>
              </div>
              {imageError ? (
                <div className="p-8 text-center text-slate-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Failed to load image</p>
                </div>
              ) : (
                <img
                  src={displayUrl}
                  alt="Generated content"
                  className="w-full max-h-[500px] object-contain"
                  onError={() => setImageError(true)}
                />
              )}
            </div>
          );
        }

        if (item.type === "resource") {
          return (
            <div key={index} className="rounded-xl bg-slate-50 border-2 border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                <ExternalLink className="w-4 h-4" />
                <span>Resource</span>
              </div>
              <a
                href={item.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 break-all"
              >
                {item.uri}
              </a>
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
