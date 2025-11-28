import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  Terminal,
  Brain,
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
import type { ChatMessage, ToolUse, ToolResult } from "@/types/api";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
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

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {message.thinking && (
          <ThinkingBlock thinking={message.thinking} />
        )}

        {message.toolUses.map((tool) => (
          <ToolUseBlock
            key={tool.id}
            tool={tool}
            result={message.toolResults.find((r) => r.toolUseId === tool.id)}
          />
        ))}

        {message.content && (
          <div className="rounded-lg bg-muted px-4 py-2">
            <div className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code: CodeBlock,
                  pre: ({ children }) => <>{children}</>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
            {message.isStreaming && (
              <span className="inline-block h-4 w-1 animate-pulse bg-foreground" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300">
        <ChevronRight
          className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")}
        />
        <Brain className="h-4 w-4" />
        <span>Thinking...</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md border border-purple-500/30 bg-purple-500/10 p-3">
          <p className="whitespace-pre-wrap text-sm text-purple-200/80">
            {thinking}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
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
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm"
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
    <div className="group relative">
      <div className="absolute right-2 top-2 flex items-center gap-2">
        {language && (
          <Badge variant="secondary" className="text-xs">
            {language}
          </Badge>
        )}
        <button
          onClick={handleCopy}
          className="rounded p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <pre className="overflow-auto rounded-md bg-muted/50 p-4">
        <code className="font-mono text-sm">{code}</code>
      </pre>
    </div>
  );
}
