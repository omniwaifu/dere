// Core dere types

export type PersonalityType = 'tsun' | 'kuu' | 'yan' | 'dere' | 'ero'

export type MentalHealthMode = 'therapy' | 'cbt' | 'mindfulness' | 'checkin' | 'goals'

export interface ChatMessage {
  id: string
  sessionId: string
  type: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  personality?: PersonalityType[]
  mode?: MentalHealthMode
  metadata?: {
    mood?: number
    energy?: number
    stress?: number
    entities?: string[]
    embedding?: number[]
  }
}

export interface ChatSession {
  id: string
  projectPath: string
  personality: PersonalityType[]
  mode?: MentalHealthMode
  startTime: Date
  lastActivity: Date
  messageCount: number
  wellnessData?: WellnessMetrics
}

export interface WellnessMetrics {
  mood: number // 1-10 scale
  energy: number // 1-10 scale
  stress: number // 1-10 scale
  keyThemes: string[]
  insights: string[]
  homework: string[]
  nextSessionNotes?: string
}

export interface PersonalityConfig {
  name: PersonalityType
  displayName: string
  description: string
  color: string
  defaultExpression: string
  traits: string[]
}

export interface DereSession {
  id: string
  personality: PersonalityType[]
  mode?: MentalHealthMode
  projectPath?: string
  messages: ChatMessage[]
  wellnessData?: WellnessMetrics
  startTime: Date
  lastActivity: Date
}

export interface DaemonStatus {
  running: boolean
  pid?: number
  uptime: number
  queueSize: number
  lastError?: string
}