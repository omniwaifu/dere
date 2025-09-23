import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MessageListProps {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    status?: 'sending' | 'delivered' | 'error';
    annotations?: string[];
  }>;
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn('flex w-full', message.role === 'user' ? 'justify-end' : 'justify-start')}
        >
          <div
            className={cn(
              'max-w-[min(80%,32rem)] rounded-2xl px-5 py-3 text-sm shadow-sm backdrop-blur transition-colors',
              message.role === 'user'
                ? 'bg-gradient-to-br from-primary/20 via-primary/10 to-primary/5 text-primary-foreground'
                : 'bg-card/80 text-foreground border border-border/70',
            )}
          >
            <div className="space-y-3 whitespace-pre-line leading-relaxed">
              {message.content}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <span>
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {message.status === 'sending' && (
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  streaming
                </span>
              )}
              {message.annotations?.map((label) => (
                <span key={label} className="rounded-full border border-border/60 px-2 py-0.5">
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

