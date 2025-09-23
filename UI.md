# Dere Web UI Architecture & Implementation Notes

## Project Overview

Creating a modern TypeScript/React web application that mirrors the Tauri opcode/claudia functionality but for the sophisticated dere personality-layered Claude CLI wrapper, including VRoid avatar integration.

## Current Dere Analysis

The existing dere system is significantly more advanced than the Tauri app:

### Core Architecture
- **Go-based CLI wrapper** with sophisticated personality system
- **Mental health therapy modes** (CBT, therapy, mindfulness, wellness tracking)
- **Conversation persistence** with embeddings and vector search (libSQL)
- **Background daemon** with RPC communication via Unix sockets
- **ActivityWatch integration** for comprehensive wellness monitoring
- **Python hooks** for seamless Claude CLI integration
- **Dynamic command generation** per personality/session

### Key Differentiators
- **Therapeutic focus**: Specialized mental health modes with structured data extraction
- **Personality layers**: Composable tsundere, kuudere, yandere, deredere personalities
- **Memory system**: Vector embeddings for semantic conversation continuity
- **Wellness tracking**: Automatic mood/energy/stress monitoring with trend analysis

## Web UI Architecture Plan

### Frontend Technology Stack

```typescript
// Core Framework
React 18 + TypeScript 5+ + Vite 6

// Styling & UI
Tailwind CSS 4 + shadcn/ui components

// 3D Avatar System
Three.js + @pixiv/three-vrm (VRoid loading)
React Three Fiber for React integration

// State Management
Zustand (simple, performant)
React Query (server state)

// Real-time Communication
WebSocket for chat streaming
Socket.io for reliability

// Data Visualization
Recharts (wellness dashboards)
D3.js (entity relationship graphs)

// Additional Libraries
Framer Motion (animations)
date-fns (time handling)
react-markdown (message rendering)
```

### Backend Integration Options

#### Option A: Extend Existing Go Daemon (Recommended)
```go
// Add HTTP/WebSocket server to existing daemon
type WebServer struct {
    daemon *daemon.Server
    router *gin.Engine
    wsHub  *WebSocketHub
}

// New endpoints to add:
// GET  /api/personalities
// GET  /api/sessions
// POST /api/chat/send
// WS   /ws/chat/{sessionId}
// GET  /api/wellness/dashboard
// GET  /api/entities/graph
// GET  /api/daemon/status
```

**Pros:**
- Keeps all existing functionality intact
- Leverages sophisticated embedding/database system
- Maintains conversation continuity
- No data migration needed

**Cons:**
- Requires Go backend modifications
- Mixed technology stack

#### Option B: TypeScript Backend Rewrite
```typescript
// Node.js + Express + TypeScript
class DereServer {
  private claudeProcess: ChildProcess
  private database: LibSQLDatabase
  private embeddings: OllamaClient
  private personalities: PersonalityManager
}
```

**Pros:**
- Unified TypeScript codebase
- Easier frontend development
- Better type sharing

**Cons:**
- Massive rewrite effort
- Need to port sophisticated Go logic
- Data migration complexity

**Decision: Go with Option A initially, Option B for future consideration**

## Core Feature Implementation

### 1. Chat Interface Architecture

```typescript
interface ChatMessage {
  id: string
  sessionId: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  personality?: PersonalityType
  mode?: MentalHealthMode
  metadata?: {
    mood?: number
    energy?: number
    stress?: number
    entities?: string[]
    embedding?: number[]
  }
}

interface ChatSession {
  id: string
  projectPath: string
  personality: PersonalityType[]
  mode?: MentalHealthMode
  startTime: Date
  lastActivity: Date
  messageCount: number
  wellnessData?: WellnessMetrics
}
```

### 2. VRoid Avatar Integration

#### Avatar System Design
```typescript
interface PersonalityAvatar {
  personality: 'tsun' | 'kuu' | 'yan' | 'dere' | 'ero'
  modelPath: string
  expressions: {
    neutral: VRMExpression
    happy: VRMExpression
    angry: VRMExpression
    flustered: VRMExpression
    caring: VRMExpression
    sad: VRMExpression
    thinking: VRMExpression
  }
  animations: {
    idle: VRMAnimation
    speaking: VRMAnimation
    listening: VRMAnimation
    thinking: VRMAnimation
    therapy: VRMAnimation
  }
  voiceSettings?: {
    pitch: number
    speed: number
    emotion: number
  }
}
```

#### Expression Mapping
```typescript
// Map personality traits to avatar expressions
const expressionMappings = {
  tsun: {
    default: 'angry',
    caring: 'flustered',
    helpful: 'angry', // "It's not like I want to help!"
    therapy: 'caring'
  },
  kuu: {
    default: 'neutral',
    analytical: 'thinking',
    caring: 'neutral', // Subtle warmth
    therapy: 'caring'
  },
  yan: {
    default: 'happy',
    protective: 'caring',
    intense: 'happy', // Overly bright
    therapy: 'caring'
  },
  dere: {
    default: 'happy',
    caring: 'caring',
    supportive: 'happy',
    therapy: 'caring'
  }
}
```

#### Avatar Animation System
```typescript
class AvatarController {
  private vrm: VRM
  private currentExpression: string
  private isAnimating: boolean

  async transitionExpression(newExpression: string, duration: number = 500) {
    // Smooth transition between expressions
  }

  async playAnimation(animationName: string, loop: boolean = false) {
    // Play body animations
  }

  updateMoodBasedExpression(mood: number, energy: number, stress: number) {
    // Dynamic expression based on wellness metrics
  }

  syncWithAudioPlayback(audioData: AudioBuffer) {
    // Lip sync during Claude responses
  }
}
```

### 3. Mental Health Interface Design

#### Therapy Mode UI Components
```typescript
interface TherapySession {
  mode: 'therapy' | 'cbt' | 'mindfulness' | 'checkin' | 'goals'
  personality: PersonalityType
  startTime: Date
  currentPhase: 'opening' | 'exploration' | 'processing' | 'integration' | 'closing'
  wellnessMetrics: {
    moodBefore: number
    moodAfter: number
    energyLevel: number
    stressLevel: number
    keyThemes: string[]
    insights: string[]
    homework: string[]
  }
}

// Specialized UI for each therapy mode
const TherapyModeComponents = {
  therapy: GeneralTherapyInterface,
  cbt: CBTWorksheetInterface,
  mindfulness: MindfulnessGuidedInterface,
  checkin: DailyCheckinInterface,
  goals: GoalTrackingInterface
}
```

#### Wellness Dashboard
```typescript
interface WellnessDashboard {
  timeRange: '7d' | '30d' | '90d' | '1y'
  metrics: {
    moodTrend: Array<{date: Date, value: number}>
    energyTrend: Array<{date: Date, value: number}>
    stressTrend: Array<{date: Date, value: number}>
    sessionFrequency: Array<{date: Date, count: number}>
    personalityUsage: Record<PersonalityType, number>
    modeEffectiveness: Record<MentalHealthMode, number>
  }
  insights: {
    patterns: string[]
    recommendations: string[]
    progress: string[]
  }
}
```

### 4. Conversation Memory System

#### Memory Browser Interface
```typescript
interface ConversationMemory {
  searchQuery: string
  filters: {
    personality: PersonalityType[]
    mode: MentalHealthMode[]
    dateRange: [Date, Date]
    projects: string[]
    minSimilarity: number
  }
  results: Array<{
    conversation: ChatMessage
    similarity: number
    context: ChatMessage[]
    entities: string[]
    summary: string
  }>
}

// Vector search integration
class MemorySearchEngine {
  async semanticSearch(query: string, limit: number = 10): Promise<SearchResult[]> {
    // Call dere daemon's embedding search endpoint
  }

  async findRelatedConversations(sessionId: string): Promise<RelatedSession[]> {
    // Find contextually similar past sessions
  }

  async extractEntities(sessionId: string): Promise<EntityGraph> {
    // Get entity relationships for visualization
  }
}
```

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
**Goal:** Basic functional chat interface

#### Tasks:
1. **Project Setup**
   ```bash
   # Create React + TypeScript + Vite project
   npm create vite@latest dere-web -- --template react-ts
   cd dere-web
   npm install

   # Add core dependencies
   npm install @tanstack/react-query zustand
   npm install tailwindcss @tailwindcss/typography
   npm install socket.io-client
   npm install framer-motion
   npm install lucide-react
   ```

2. **Basic Chat UI**
   - Message list with infinite scroll
   - Input field with send button
   - Basic personality selector
   - Session management (new/continue/resume)

3. **WebSocket Integration**
   - Connect to dere daemon (modify daemon to add WS endpoint)
   - Real-time message streaming
   - Session state synchronization

4. **Go Daemon Extensions**
   ```go
   // Add to existing daemon/server.go
   func (s *Server) setupWebSocketRoutes() {
       s.server.HandleFunc("/ws/chat/{sessionId}", s.handleChatWebSocket)
       s.server.HandleFunc("/api/personalities", s.handleGetPersonalities)
       s.server.HandleFunc("/api/sessions", s.handleGetSessions)
   }
   ```

### Phase 2: Avatar Integration (Week 2-3)
**Goal:** Working VRoid avatars with personality expressions

#### Tasks:
1. **VRoid Model Loading**
   ```typescript
   // Install VRM dependencies
   npm install three @types/three
   npm install @react-three/fiber @react-three/drei
   npm install @pixiv/three-vrm
   ```

2. **Avatar Component**
   ```typescript
   const PersonalityAvatar: React.FC<{
     personality: PersonalityType
     expression: string
     isAnimating: boolean
   }> = ({ personality, expression, isAnimating }) => {
     // VRoid model rendering logic
   }
   ```

3. **Expression System**
   - Map personality traits to facial expressions
   - Mood-based expression changes
   - Smooth transitions between expressions

4. **Avatar-Chat Integration**
   - Avatar reacts to conversation sentiment
   - Different poses for different mental health modes
   - Visual feedback during Claude responses

### Phase 3: Advanced Features (Week 3-4)
**Goal:** Memory browser and wellness tracking

#### Tasks:
1. **Conversation Memory Browser**
   - Search interface with filters
   - Similarity-based results
   - Context expansion for messages
   - Entity highlighting

2. **Wellness Dashboard**
   - Mood/energy/stress trend charts
   - Personality usage analytics
   - Therapy mode effectiveness metrics
   - Insight generation

3. **Entity Graph Visualization**
   - D3.js network graph of extracted entities
   - Interactive exploration
   - Timeline-based entity evolution

### Phase 4: Mental Health UI (Week 4-5)
**Goal:** Specialized therapy interfaces

#### Tasks:
1. **Therapy Mode Interfaces**
   - CBT worksheet components
   - Mindfulness guided sessions
   - Daily check-in forms
   - Goal tracking dashboards

2. **Progress Tracking**
   - Session continuity visualization
   - Homework assignment tracking
   - Therapeutic goal progress
   - Crisis resource integration

3. **Avatar Therapy Adaptations**
   - Therapeutic expressions and poses
   - Calming animations for mindfulness
   - Encouraging gestures for goal tracking

### Phase 5: Polish & Deploy (Week 5-6)
**Goal:** Production-ready application

#### Tasks:
1. **Performance Optimization**
   - Avatar model optimization
   - Conversation data virtualization
   - WebSocket connection management
   - Memory leak prevention

2. **Mobile Responsiveness**
   - Touch-friendly chat interface
   - Responsive avatar display
   - Mobile wellness dashboard

3. **Deployment Options**
   - Web app (Nginx + reverse proxy)
   - Electron desktop app
   - Docker containerization

## File Structure

```
dere-web/
├── src/
│   ├── components/
│   │   ├── Avatar/
│   │   │   ├── PersonalityAvatar.tsx
│   │   │   ├── AvatarController.ts
│   │   │   ├── ExpressionMapper.ts
│   │   │   └── VRoidLoader.ts
│   │   ├── Chat/
│   │   │   ├── ChatInterface.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageInput.tsx
│   │   │   ├── PersonalitySelector.tsx
│   │   │   └── SessionManager.tsx
│   │   ├── Wellness/
│   │   │   ├── WellnessDashboard.tsx
│   │   │   ├── MoodChart.tsx
│   │   │   ├── TherapyModeSelector.tsx
│   │   │   └── ProgressTracker.tsx
│   │   ├── Memory/
│   │   │   ├── ConversationBrowser.tsx
│   │   │   ├── MemorySearch.tsx
│   │   │   ├── EntityGraph.tsx
│   │   │   └── SimilarityResults.tsx
│   │   ├── Therapy/
│   │   │   ├── CBTWorksheet.tsx
│   │   │   ├── MindfulnessGuide.tsx
│   │   │   ├── DailyCheckin.tsx
│   │   │   └── GoalTracker.tsx
│   │   └── Settings/
│   │       ├── PersonalityConfig.tsx
│   │       ├── AvatarSettings.tsx
│   │       └── DaemonStatus.tsx
│   ├── lib/
│   │   ├── api.ts              # HTTP API client
│   │   ├── websocket.ts        # WebSocket management
│   │   ├── avatar.ts           # VRoid avatar management
│   │   ├── personalities.ts    # Personality system
│   │   ├── wellness.ts         # Mental health utilities
│   │   └── memory.ts           # Conversation memory
│   ├── hooks/
│   │   ├── useChat.ts          # Chat state management
│   │   ├── useAvatar.ts        # Avatar control
│   │   ├── useWellness.ts      # Wellness data
│   │   └── useMemory.ts        # Memory search
│   ├── stores/
│   │   ├── chatStore.ts        # Zustand chat store
│   │   ├── avatarStore.ts      # Avatar state
│   │   └── sessionStore.ts     # Session management
│   ├── types/
│   │   ├── dere.ts             # Core dere types
│   │   ├── avatar.ts           # Avatar/VRoid types
│   │   ├── wellness.ts         # Mental health types
│   │   ├── memory.ts           # Memory/embedding types
│   │   └── api.ts              # API types
│   └── utils/
│       ├── personality.ts      # Personality utilities
│       ├── wellness.ts         # Wellness calculations
│       └── formatting.ts       # Message formatting
├── public/
│   ├── avatars/               # VRoid model files
│   │   ├── tsun.vrm
│   │   ├── kuu.vrm
│   │   ├── yan.vrm
│   │   ├── dere.vrm
│   │   └── ero.vrm
│   └── sounds/                # Audio files
├── docs/
│   ├── API.md                 # API documentation
│   ├── Avatar.md              # Avatar system guide
│   └── Therapy.md             # Mental health features
└── backend-extensions/         # Go daemon modifications
    ├── websocket.go
    ├── api_handlers.go
    └── avatar_sync.go
```

## API Design

### WebSocket Events
```typescript
// Client -> Server
interface ClientEvents {
  'chat:send': { message: string, personality: PersonalityType[], mode?: MentalHealthMode }
  'session:new': { personality: PersonalityType[], mode?: MentalHealthMode }
  'session:continue': { sessionId: string }
  'avatar:expression': { expression: string }
  'wellness:update': { mood: number, energy: number, stress: number }
}

// Server -> Client
interface ServerEvents {
  'chat:message': ChatMessage
  'chat:typing': { isTyping: boolean }
  'session:created': { sessionId: string }
  'avatar:update': { expression: string, animation: string }
  'wellness:extracted': WellnessMetrics
  'error': { message: string, code: string }
}
```

### REST API Endpoints
```typescript
// Session Management
GET    /api/sessions                    # List all sessions
GET    /api/sessions/{id}              # Get session details
POST   /api/sessions                   # Create new session
DELETE /api/sessions/{id}              # Delete session

// Personalities
GET    /api/personalities              # List available personalities
GET    /api/personalities/{name}       # Get personality details

// Mental Health
GET    /api/wellness/dashboard         # Wellness overview
GET    /api/wellness/trends            # Trend analysis
POST   /api/wellness/checkin           # Submit wellness checkin

// Memory & Search
GET    /api/memory/search              # Search conversations
GET    /api/memory/similar/{sessionId} # Find similar sessions
GET    /api/entities/graph             # Entity relationship graph

// Avatar
GET    /api/avatar/models              # Available VRoid models
POST   /api/avatar/expression          # Update avatar expression
GET    /api/avatar/settings            # Avatar configuration

// Daemon
GET    /api/daemon/status              # Daemon health check
GET    /api/daemon/stats               # Queue statistics
POST   /api/daemon/reload              # Reload configuration
```

## Technical Considerations

### Performance Optimization
1. **Avatar Rendering**
   - Use instanced rendering for multiple avatars
   - LOD (Level of Detail) for distant avatars
   - Texture compression and caching
   - Animation culling when not visible

2. **Chat Interface**
   - Virtual scrolling for long conversations
   - Message content memoization
   - Lazy loading of conversation history
   - WebSocket message batching

3. **Memory Management**
   - Conversation data pagination
   - Embedding vector compression
   - Avatar model sharing between personalities
   - Cleanup of unused WebSocket connections

### Security Considerations
1. **API Security**
   - Rate limiting on chat endpoints
   - Input sanitization for all user content
   - WebSocket connection authentication
   - File upload restrictions for avatar models

2. **Data Privacy**
   - Local-only conversation storage
   - Optional conversation encryption
   - Clear data retention policies
   - Secure wellness data handling

### Accessibility
1. **Avatar Accessibility**
   - Alt text for avatar expressions
   - High contrast mode support
   - Screen reader compatibility
   - Keyboard navigation

2. **Chat Accessibility**
   - ARIA labels for message threads
   - Keyboard shortcuts for common actions
   - Focus management for new messages
   - Voice control integration

## Deployment Architecture

### Development Environment
```bash
# Terminal 1: Go daemon
cd /mnt/data/Code/omni/dere
just dev

# Terminal 2: React dev server
cd dere-web
npm run dev

# Terminal 3: WebSocket proxy (if needed)
cd dere-web
npm run proxy
```

### Production Deployment

#### Option 1: Web App
```nginx
server {
    listen 80;
    server_name dere.local;

    location / {
        root /var/www/dere-web/dist;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:8080;
        proxy_websocket;
    }

    location /ws/ {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

#### Option 2: Electron App
```typescript
// main.ts
import { app, BrowserWindow } from 'electron'
import { spawn } from 'child_process'

class DereElectronApp {
  private daemonProcess: ChildProcess

  async createWindow() {
    // Start Go daemon
    this.daemonProcess = spawn('./bin/dere', ['daemon', 'start'])

    // Create Electron window
    const mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    await mainWindow.loadFile('dist/index.html')
  }
}
```

## Future Enhancements

### Phase 6+: Advanced Features
1. **Voice Integration**
   - Speech-to-text input
   - Text-to-speech responses with personality voices
   - Real-time voice emotion analysis

2. **AR/VR Support**
   - WebXR integration for immersive therapy sessions
   - Hand tracking for natural avatar interaction
   - Spatial audio for realistic conversations

3. **Advanced AI Features**
   - Custom fine-tuned personality models
   - Predictive wellness recommendations
   - Automatic crisis intervention

4. **Collaboration Features**
   - Shared therapy sessions (with permission)
   - Family/couples therapy modes
   - Therapist integration dashboard

## Success Metrics

### Technical Metrics
- Chat message latency < 100ms
- Avatar expression changes < 50ms
- Memory search results < 500ms
- WebSocket connection uptime > 99.9%
- Mobile responsiveness score > 95

### User Experience Metrics
- Session completion rate > 80%
- Average session duration increase
- Personality engagement variety
- Wellness metric improvement trends
- User retention rate

### Mental Health Outcomes
- Mood improvement over time
- Stress reduction measurements
- Goal achievement rates
- Crisis intervention effectiveness
- User-reported therapeutic value

---

## Notes for Implementation

### Immediate Next Steps
1. **Set up React project** with proper TypeScript configuration
2. **Extend Go daemon** with WebSocket endpoint
3. **Create basic chat interface** with personality selection
4. **Implement VRoid avatar loading** with basic expressions
5. **Connect WebSocket** for real-time communication

### Key Architecture Decisions
- **Extend existing Go backend** rather than rewrite in TypeScript
- **Use VRoid models** for authentic anime-style avatars
- **WebSocket for real-time** chat communication
- **Keep mental health focus** as core differentiator
- **Mobile-first responsive** design

### Development Principles
- **Incremental development** with working prototypes at each phase
- **User testing** with each major feature addition
- **Performance monitoring** throughout development
- **Accessibility compliance** from the start
- **Clear separation** between UI and business logic

This comprehensive plan provides a roadmap for creating a sophisticated web UI that leverages dere's advanced personality and mental health features while adding engaging avatar visualization and modern web interface patterns.