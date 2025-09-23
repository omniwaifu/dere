import React from 'react';
import { motion } from 'framer-motion';
import { ChatInterface } from '../chat/ChatInterface';
import { MemoryBrowser } from '../memory/MemoryBrowser';
import { SettingsPanel } from '../settings/SettingsPanel';
import { EmptyState } from '../ui/EmptyState';
import { WellnessDashboard } from '../wellness/WellnessDashboard';
import { useTabContext } from '../../contexts/TabContext';

export const TabContent: React.FC = () => {
  const { tabs, activeTabId } = useTabContext();

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  if (!activeTab) {
    return (
      <div className="h-full flex-1">
        <EmptyState
          title="No active tab"
          description="Open a chat or tool tab to get started."
          illustration="tabs"
        />
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab.type) {
      case 'chat':
        return (
          <ChatInterface
            tabId={activeTab.id}
            personality={activeTab.personality}
            mode={activeTab.mode}
          />
        );
      case 'wellness':
        return <WellnessDashboard />;
      case 'memory':
        return <MemoryBrowser />;
      case 'settings':
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  return (
    <motion.div
      key={activeTab.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.15 }}
      className="flex-1 overflow-hidden"
    >
      {renderContent()}
    </motion.div>
  );
};