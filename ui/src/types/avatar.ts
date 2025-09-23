// VRoid avatar types
import type { PersonalityType } from './dere'

export interface VRMExpression {
  name: string
  preset: string
  weight: number
}

export interface VRMAnimation {
  name: string
  duration: number
  loop: boolean
  file: string
}

export interface PersonalityAvatar {
  personality: PersonalityType
  modelPath: string
  displayName: string
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

export interface AvatarState {
  currentExpression: string
  currentAnimation: string
  isAnimating: boolean
  mood: number
  energy: number
  isVisible: boolean
}

export interface ExpressionMapping {
  personality: PersonalityType
  mappings: {
    [key: string]: string // situation -> expression
  }
}