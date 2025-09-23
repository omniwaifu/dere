import { AvatarPreview } from '@/components/avatar/AvatarPreview'
import { TabManager } from '@/components/tabs/TabManager'
import { TabContent } from '@/components/tabs/TabContent'
import { TabProvider } from '@/contexts/TabContext'

function App() {
  return (
    <TabProvider>
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <header className="border-b border-border bg-card/80 px-4 py-4 sm:px-6 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Dere Web UI</p>
              <h1 className="mt-1 text-lg font-semibold">Companion Console</h1>
            </div>
            <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                Daemon offline
              </span>
              <span className="text-[11px]">
                Launch the Go daemon to enable live responses
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside className="hidden lg:flex lg:w-80 xl:w-96 border-r border-border bg-card/60">
            <AvatarPreview variant="sidebar" />
          </aside>

          <main className="flex-1 flex flex-col overflow-hidden">
            <div className="lg:hidden border-b border-border bg-card/60">
              <AvatarPreview variant="card" />
            </div>

            <TabManager />

            <div className="flex-1 overflow-hidden bg-background">
              <TabContent />
            </div>
          </main>
        </div>
      </div>
    </TabProvider>
  )
}

export default App
