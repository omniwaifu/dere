import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  Terminal,
  CheckCircle,
  AlertCircle,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolUse, ToolResult, ConversationBlock } from "@/types/api";
import { ThinkingIndicator } from "./ThinkingIndicator";

function formatTiming(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms).toString().padStart(3, " ")}ms`;
  }
  return `${(ms / 1000).toFixed(3)}s`;
}

interface MessageBubbleProps {
  message: ChatMessage;
  isLatest?: boolean;
  avatarUrl?: string;
  fallbackColor?: string;
  fallbackIcon?: string;
}

export function MessageBubble({ message, isLatest, avatarUrl, fallbackColor, fallbackIcon }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  if (message.role === "user") {
    if (!message.content?.trim()) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-primary px-4 py-2 text-primary-foreground">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    const textToCopy = message.content || "";
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const blocks = message.blocks;
  const blockText = blocks
    ? blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .filter(Boolean)
        .join("\n\n")
    : "";
  const hasText = blocks ? !!blockText.trim() : !!message.content?.trim();

    const renderBlocks = (blocksToRender: ConversationBlock[]) => {
      const resultsByToolUseId = new Map<string, ToolResult>();
      for (const b of blocksToRender) {
        if (b.type === "tool_result") {
          resultsByToolUseId.set(b.tool_use_id, {
            toolUseId: b.tool_use_id,
            name: b.name,
            output: b.output,
            isError: b.is_error,
          });
        }
      }

    const parts: React.ReactNode[] = [];
    let textBuffer: string[] = [];
    const flushText = () => {
      const t = textBuffer.join("");
      if (t.trim()) {
        parts.push(
          <div key={`text-${parts.length}`} className="rounded-lg bg-muted px-4 py-2">
            <div className="prose prose-sm prose-invert max-w-none [&>p]:mb-4 [&>p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code: CodeBlock,
                  pre: ({ children }) => <>{children}</>,
                  em: ({ children }) => <em className="italic text-purple-300">{children}</em>,
                  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 underline hover:text-blue-300"
                    >
                      {children}
                    </a>
                  ),
                  p: ({ children }) => (
                    <p>
                      {children}
                      {message.isStreaming && (
                        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-foreground align-middle" />
                      )}
                    </p>
                  ),
                }}
              >
                {t}
              </ReactMarkdown>
            </div>
          </div>
        );
      }
      textBuffer = [];
    };

      for (const b of blocksToRender) {
      if (b.type === "thinking") {
        flushText();
        parts.push(
          <ThinkingIndicator
            key={`thinking-${parts.length}`}
            thinking={b.text}
            thinkingDuration={message.thinkingDuration}
            isStreaming={message.isStreaming}
          />
        );
      } else if (b.type === "text") {
        // Separate text blocks with paragraph breaks so post-tool text doesn't glue onto pre-tool text.
        if (textBuffer.length) textBuffer.push("\n\n");
        textBuffer.push(b.text);
      } else if (b.type === "tool_use") {
        flushText();
        const result = resultsByToolUseId.get(b.id);
        const tool: ToolUse = {
          id: b.id,
          name: b.name,
          input: b.input,
          status: result ? (result.isError ? "error" : "success") : "pending",
        };
        parts.push(
          <ToolUseBlock
            key={`tool-${b.id}-${parts.length}`}
            tool={tool}
            result={result}
          />
        );
      } else if (b.type === "tool_result") {
        // Rendered alongside tool_use
        continue;
      }
    }
    flushText();
    return parts;
  };

  // For assistant messages that are only thinking/tool-use (no final text yet),
  // avoid showing the avatar to reduce visual noise.
  if (!hasText) {
    return (
      <div className="group/message flex justify-start">
        <div className="max-w-[85%] space-y-2">
          {blocks ? (
            renderBlocks(blocks)
          ) : (
            <>
              <ThinkingIndicator
                thinking={message.thinking}
                thinkingDuration={message.thinkingDuration}
                isStreaming={message.isStreaming}
              />

              {message.toolUses.map((tool) => (
                <ToolUseBlock
                  key={tool.id}
                  tool={tool}
                  result={message.toolResults.find((r) => r.toolUseId === tool.id)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group/message flex items-start justify-start gap-2">
      <div className="mt-1 h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-muted/30">
        {!avatarUrl || avatarFailed ? (
          <div
            className="flex h-full w-full items-center justify-center text-xs font-semibold text-foreground"
            style={fallbackColor ? { backgroundColor: fallbackColor + "20", color: fallbackColor } : undefined}
            title="Personality"
          >
            {fallbackIcon || "●"}
          </div>
        ) : (
          <img
            src={avatarUrl}
            alt="avatar"
            className="h-full w-full object-cover"
            onError={() => setAvatarFailed(true)}
          />
        )}
      </div>
      <div className="max-w-[85%] space-y-2">
        {blocks ? (
          renderBlocks(blocks)
        ) : (
          <>
            <ThinkingIndicator
              thinking={message.thinking}
              thinkingDuration={message.thinkingDuration}
              isStreaming={message.isStreaming}
            />

            {message.toolUses.map((tool) => (
              <ToolUseBlock
                key={tool.id}
                tool={tool}
                result={message.toolResults.find((r) => r.toolUseId === tool.id)}
              />
            ))}

            {message.content && (
              <div className="rounded-lg bg-muted px-4 py-2">
                <div className="prose prose-sm prose-invert max-w-none [&>p]:mb-4 [&>p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code: CodeBlock,
                      pre: ({ children }) => <>{children}</>,
                      em: ({ children }) => <em className="italic text-purple-300">{children}</em>,
                      strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 underline hover:text-blue-300"
                        >
                          {children}
                        </a>
                      ),
                      p: ({ children }) => (
                        <p>
                          {children}
                          {message.isStreaming && (
                            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-foreground align-middle" />
                          )}
                        </p>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer with copy button and timing */}
        {message.content && !message.isStreaming && (
          <div className="flex items-center justify-between">
            <div
              className={cn(
                "transition-opacity",
                isLatest ? "opacity-100" : "opacity-0 group-hover/message:opacity-100"
              )}
            >
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Copy message"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>

            {message.timings && (
              <div className="group/timing relative">
                <span className="font-mono text-xs text-muted-foreground">
                  {formatTiming(message.timings.time_to_first_token)}
                </span>
                <div className="absolute bottom-0 left-full ml-2 hidden whitespace-nowrap rounded bg-popover px-2 py-1 font-mono text-xs text-popover-foreground shadow-md group-hover/timing:block">
                  <div>TTFT: {formatTiming(message.timings.time_to_first_token)}</div>
                  {message.timings.response_time !== undefined && (
                    <div>Total: {formatTiming(message.timings.response_time)}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolUseBlock({
  tool,
  result,
}: {
  tool: ToolUse;
  result?: ToolResult;
}) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 className="h-4 w-4 animate-spin text-blue-400" />,
    success: <CheckCircle className="h-4 w-4 text-green-400" />,
    error: <AlertCircle className="h-4 w-4 text-red-400" />,
  }[tool.status];

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300">
        <ChevronRight
          className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
        />
        <Terminal className="h-4 w-4" />
        <span>{tool.name}</span>
        {statusIcon}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2">
          <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3">
            <p className="mb-1 text-xs font-medium text-blue-300">Input</p>
            <pre className="overflow-auto text-xs text-blue-200/80">
              {JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>

          {result && (
            <div
              className={cn(
                "rounded-md border p-3",
                result.isError
                  ? "border-red-500/30 bg-red-500/10"
                  : "border-green-500/30 bg-green-500/10"
              )}
            >
              <p
                className={cn(
                  "mb-1 text-xs font-medium",
                  result.isError ? "text-red-300" : "text-green-300"
                )}
              >
                {result.isError ? "Error" : "Output"}
              </p>
              <pre
                className={cn(
                  "max-h-48 overflow-auto text-xs",
                  result.isError ? "text-red-200/80" : "text-green-200/80"
                )}
              >
                {result.output}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CodeBlock({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");

  const isInline = !className;

  if (isInline) {
    return (
      <code
        className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-sm text-orange-300"
        {...props}
      >
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-3">
      <div className="absolute right-2 top-2 flex items-center gap-2">
        {language && (
          <Badge variant="secondary" className="text-xs">
            {language}
          </Badge>
        )}
        <button
          onClick={handleCopy}
          className="rounded p-1 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <pre className="overflow-auto rounded-md border border-white/10 bg-black/40 p-4">
        <code className="font-mono text-sm">{code}</code>
      </pre>
    </div>
  );
}
