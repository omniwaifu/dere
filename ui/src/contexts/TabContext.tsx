import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PersonalityType, MentalHealthMode } from '../types/dere';

export type TabType = 'chat' | 'wellness' | 'memory' | 'settings';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  personality?: PersonalityType;
  mode?: MentalHealthMode;
  hasUnsavedChanges?: boolean;
  status?: 'idle' | 'running' | 'error';
  metadata?: Record<string, any>;
}

interface TabContextType {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, 'id'>) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  reorderTabs: (tabs: Tab[]) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export function TabProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 'welcome',
      type: 'chat',
      title: 'Welcome',
      personality: 'dere',
      status: 'idle',
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('welcome');

  const addTab = (tabData: Omit<Tab, 'id'>): string => {
    const id = `tab-${Date.now()}`;
    const newTab: Tab = { ...tabData, id };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  };

  const removeTab = (id: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(tab => tab.id !== id);
      // If we're removing the active tab, switch to another one
      if (activeTabId === id && newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });
  };

  const setActiveTab = (id: string) => {
    if (tabs.find(tab => tab.id === id)) {
      setActiveTabId(id);
    }
  };

  const updateTab = (id: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(tab =>
      tab.id === id ? { ...tab, ...updates } : tab
    ));
  };

  const reorderTabs = (newTabs: Tab[]) => {
    setTabs(newTabs);
  };

  const contextValue = useMemo(
    () => ({
      tabs,
      activeTabId,
      addTab,
      removeTab,
      setActiveTab,
      updateTab,
      reorderTabs,
    }),
    [tabs, activeTabId],
  );

  return (
    <TabContext.Provider value={contextValue}>
      {children}
    </TabContext.Provider>
  );
}

export function useTabContext() {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error('useTabContext must be used within a TabProvider');
  }
  return context;
}