import React, { useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, ArrowUpLeft, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/EmptyState';
import { ScrollShadow } from '../ui/ScrollShadow';
import { MessageList } from './MessageList';
import { getPersonalityMeta } from '../../data/personalities';
import type { PersonalityType, MentalHealthMode } from '../../types/dere';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'delivered' | 'error';
  annotations?: string[];
}

interface ChatInterfaceProps {
  tabId: string;
  personality?: PersonalityType;
  mode?: MentalHealthMode;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  personality = 'dere',
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const meta = getPersonalityMeta(personality);
    return [
      {
        id: 'welcome',
        role: 'assistant',
        content: `Hey there, I’m ${meta.displayName}. I’m dialed in and ready to help you plan, reflect, or just talk through what’s on your mind.`,
        timestamp: new Date(),
        annotations: ['warm', 'grounding'],
      },
      {
        id: 'guidance',
        role: 'assistant',
        content: 'Try opening the sidebar to tweak your personality blend, or start by outlining what you’d like to accomplish today.',
        timestamp: new Date(),
      },
    ];
  });
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollAnchor, setShowScrollAnchor] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const meta = useMemo(() => getPersonalityMeta(personality), [personality]);

  const handleScroll = () => {
    if (!scrollRef.current || !bottomRef.current) return;
    const container = scrollRef.current;
    const bottomPosition = bottomRef.current.offsetTop;
    const visibleBottom = container.scrollTop + container.clientHeight;
    setShowScrollAnchor(visibleBottom + 80 < bottomPosition);
  };

  const streamAssistantReply = (prompt: string) => {
    setIsStreaming(true);
    const id = `draft-${Date.now()}`;
    const lines = [
      `Let me reflect that back: ${prompt}`,
      meta.affirmations[Math.floor(Math.random() * meta.affirmations.length)],
      'What would feel like meaningful progress in the next hour?',
    ];

    let index = 0;
    const interval = setInterval(() => {
      setMessages((prev) => {
        const draft = prev.find((m) => m.id === id);
        if (!draft) {
          return [
            ...prev,
            {
              id,
              role: 'assistant',
              content: lines[index],
              timestamp: new Date(),
              status: 'sending',
            },
          ];
        }

        if (index < lines.length) {
          const nextContent = draft.content + `\n\n${lines[index]}`;
          return prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  content: nextContent,
                  timestamp: new Date(),
                }
              : m,
          );
        }

        clearInterval(interval);
        setIsStreaming(false);
        return prev.map((m) =>
          m.id === id
            ? {
                ...m,
                status: 'delivered',
                timestamp: new Date(),
              }
            : m,
        );
      });

      index += 1;
      if (index > lines.length) {
        clearInterval(interval);
        setIsStreaming(false);
      }
    }, 900);
  };

  const sendMessage = (value = inputValue) => {
    const payload = value.trim();
    if (!payload) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: payload,
      timestamp: new Date(),
      status: 'delivered',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    streamAssistantReply(payload);

    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    sendMessage();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border/80 bg-card/40 px-4 py-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full border border-border/60 bg-gradient-to-br from-background to-card shadow-inner" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {meta.displayName} channel
              </h2>
              <p className="text-xs text-muted-foreground">
                Persona blend tuned for thoughtful planning sessions.
              </p>
            </div>
          </div>
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground sm:mt-0">
            <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              Offline simulation
            </span>
            <span>Streaming once daemon online</span>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <ScrollShadow ref={scrollRef} onScroll={handleScroll}>
          <div className="space-y-4 px-4 py-6 sm:px-6">
            {messages.length === 0 ? (
              <EmptyState
                title="No messages yet"
                description="Start the conversation to see your assistant respond in real time."
                illustration="chat"
              />
            ) : (
              <MessageList messages={messages} />
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollShadow>

        {showScrollAnchor && (
          <button
            type="button"
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="absolute bottom-28 right-6 inline-flex items-center gap-1 rounded-full border border-border/70 bg-card/80 px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground shadow-md backdrop-blur"
          >
            <ChevronDown className="h-3 w-3" />
            New activity
          </button>
        )}
      </div>

      <div className="border-t border-border/60 bg-card/40 px-4 py-4 sm:px-6">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-3xl flex-col gap-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <ArrowUpLeft className="h-3.5 w-3.5" />
            Shift+Enter for new line · Enter to send
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1 rounded-2xl border border-border/70 bg-background/70 backdrop-blur">
              <textarea
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${meta.displayName} for a plan, reflection, or check-in…`}
                rows={3}
                className="w-full resize-none rounded-2xl bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <Button
              type="submit"
              variant="default"
              disabled={!inputValue.trim() || isStreaming}
              className="h-12 w-12 rounded-2xl bg-primary text-primary-foreground shadow-lg hover:brightness-110"
            >
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};