import { TabProvider } from '@/contexts/TabContext'
import { TabManager } from '@/components/tabs/TabManager'
import { TabContent } from '@/components/tabs/TabContent'

function App() {
  return (
    <TabProvider>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <TabManager />
        <div className="flex-1 overflow-hidden">
          <TabContent />
        </div>
      </div>
    </TabProvider>
  )
}

export default App