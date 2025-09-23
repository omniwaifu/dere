import React, { useMemo } from 'react';
import { Reorder } from 'framer-motion';
import { X, Plus, MessageSquare, Brain, Clock, Settings, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getPersonalityMeta } from '../../data/personalities';
import { useTabContext, type Tab } from '../../contexts/TabContext';

const TabItem: React.FC<{
  tab: Tab;
  isActive: boolean;
  onClose: (id: string) => void;
  onClick: (id: string) => void;
}> = ({ tab, isActive, onClose, onClick }) => {
  const meta = useMemo(() => (tab.personality ? getPersonalityMeta(tab.personality) : null), [tab.personality]);

  const getIcon = () => {
    switch (tab.type) {
      case 'chat':
        return MessageSquare;
      case 'wellness':
        return Brain;
      case 'memory':
        return Clock;
      case 'settings':
        return Settings;
      default:
        return MessageSquare;
    }
  };

  const Icon = getIcon();

  return (
    <Reorder.Item
      value={tab}
      id={tab.id}
      dragListener={true}
      transition={{ duration: 0.15 }}
      className={cn(
        'relative mx-1 flex h-10 min-w-[140px] max-w-[220px] cursor-pointer select-none items-center gap-3 overflow-hidden rounded-xl border border-border/40 bg-card/40 px-3 text-sm backdrop-blur transition-all duration-200',
        isActive
          ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
          : 'text-muted-foreground hover:border-border/70 hover:bg-card/70 hover:text-foreground',
      )}
      onClick={() => onClick(tab.id)}
    >
      <div className="flex-shrink-0">
        <Icon className="w-4 h-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-foreground">
          {tab.title}
        </span>
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{tab.type}</span>
          {meta && (
            <span className="inline-flex items-center gap-1 text-[9px] lowercase">
              <Sparkles className="h-3 w-3 text-amber-300" />
              {meta.displayName}
            </span>
          )}
        </div>
      </div>

      {tab.hasUnsavedChanges && (
        <span
          className="w-1.5 h-1.5 bg-primary rounded-full"
          title="Unsaved changes"
        />
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        className={cn(
          'flex h-4 w-4 items-center justify-center rounded-sm transition-all duration-200',
          'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
          isActive ? 'opacity-100' : 'opacity-70'
        )}
      >
        <X className="w-3 h-3" />
      </button>
    </Reorder.Item>
  );
};

export const TabManager: React.FC = () => {
  const {
    tabs,
    activeTabId,
    addTab,
    removeTab,
    setActiveTab,
    reorderTabs
  } = useTabContext();

  const handleAddTab = () => {
    addTab({
      type: 'chat',
      title: 'New Chat',
      personality: 'dere',
      status: 'idle',
    });
  };

  return (
    <div className="flex h-14 items-center border-b border-border/60 bg-card/50 px-3 backdrop-blur">
      <Reorder.Group
        axis="x"
        values={tabs}
        onReorder={reorderTabs}
        className="scrollbar-hide flex flex-1 items-center overflow-x-auto"
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onClose={removeTab}
            onClick={setActiveTab}
          />
        ))}
      </Reorder.Group>

      <button
        onClick={handleAddTab}
        className="ml-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        title="New tab (⌘T)"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};