export type AmbientState =
  | "idle"
  | "monitoring"
  | "engaged"
  | "cooldown"
  | "escalating"
  | "suppressed"
  | "exploring";

export interface StateIntervals {
  idle: [number, number];
  monitoring: [number, number];
  engaged: number;
  cooldown: [number, number];
  escalating: [number, number];
  suppressed: [number, number];
  exploring: [number, number];
}

export interface SignalWeights {
  activity: number;
  emotion: number;
  responsiveness: number;
  temporal: number;
  task: number;
  bond: number;
}

export interface AmbientSignalInputs {
  activity: Record<string, unknown>;
  emotion: Record<string, unknown>;
  notificationHistory: Record<string, unknown>[];
  task: Record<string, unknown>;
  currentHour: number;
  bond?: Record<string, unknown> | null;
}

export class AmbientFSM {
  state: AmbientState = "monitoring";
  intervals: StateIntervals;
  weights: SignalWeights;

  lastNotificationTime: number | null = null;
  notificationAttempts = 0;
  lastAcknowledgmentTime: number | null = null;

  constructor(intervals: StateIntervals, weights: SignalWeights) {
    this.intervals = intervals;
    this.weights = weights;
  }

  calculateNextIntervalSeconds(): number {
    let minMinutes: number;
    let maxMinutes: number;

    switch (this.state) {
      case "idle":
        [minMinutes, maxMinutes] = this.intervals.idle;
        break;
      case "monitoring":
        [minMinutes, maxMinutes] = this.intervals.monitoring;
        break;
      case "engaged":
        return this.intervals.engaged * 60;
      case "cooldown":
        [minMinutes, maxMinutes] = this.intervals.cooldown;
        break;
      case "escalating":
        [minMinutes, maxMinutes] = this.intervals.escalating;
        break;
      case "suppressed":
        [minMinutes, maxMinutes] = this.intervals.suppressed;
        break;
      case "exploring":
        [minMinutes, maxMinutes] = this.intervals.exploring;
        break;
      default:
        [minMinutes, maxMinutes] = this.intervals.monitoring;
        break;
    }

    const intervalMinutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
    return intervalMinutes * 60;
  }

  transitionTo(newState: AmbientState, reason?: string): void {
    const oldState = this.state;
    this.state = newState;
    const note = reason ? ` (${reason})` : "";
    console.log(`[AmbientFSM] State transition: ${oldState} -> ${newState}${note}`);
  }

  private evaluateActivitySignal(activity: Record<string, unknown>): number {
    const appName = String(activity.app_name ?? "").toLowerCase();
    const durationSeconds = Number(activity.duration_seconds ?? 0);
    const durationMinutes = durationSeconds / 60;

    if (
      ["code", "vim", "nvim", "intellij", "pycharm", "vscode"].some((keyword) =>
        appName.includes(keyword),
      )
    ) {
      return durationMinutes > 30 ? -0.8 : -0.4;
    }

    if (["zoom", "teams", "meet", "slack"].some((keyword) => appName.includes(keyword))) {
      return -0.6;
    }

    if (["mail", "thunderbird", "outlook"].some((keyword) => appName.includes(keyword))) {
      return 0.3;
    }

    if (["firefox", "chrome", "browser"].some((keyword) => appName.includes(keyword))) {
      return 0.1;
    }

    if (["terminal", "ghostty", "alacritty"].some((keyword) => appName.includes(keyword))) {
      return durationMinutes > 20 ? -0.3 : 0.0;
    }

    return 0.0;
  }

  private evaluateEmotionSignal(emotion: Record<string, unknown>): number {
    const emotionType = String(emotion.emotion_type ?? "neutral");
    const intensity = Number(emotion.intensity ?? 0);

    if (["distress", "anger", "fear", "disappointment"].includes(emotionType)) {
      return intensity > 60 ? -0.7 : -0.3;
    }

    if (["interest", "joy", "satisfaction", "gratification"].includes(emotionType)) {
      return intensity > 50 ? 0.6 : 0.3;
    }

    return 0.0;
  }

  private evaluateResponsivenessSignal(notifications: Record<string, unknown>[]): number {
    if (notifications.length === 0) {
      return 0.0;
    }

    const acknowledged = notifications.filter((n) => Boolean(n.acknowledged)).length;
    const ackRate = acknowledged / notifications.length;

    if (ackRate > 0.7) {
      return 0.5;
    }
    if (ackRate < 0.3) {
      return -0.5;
    }
    return 0.0;
  }

  private evaluateTemporalSignal(currentHour: number): number {
    if (currentHour < 8 || currentHour >= 23) {
      return -0.8;
    }
    if (currentHour >= 9 && currentHour < 17) {
      return 0.3;
    }
    if (currentHour >= 17 && currentHour < 22) {
      return 0.2;
    }
    return 0.0;
  }

  private evaluateTaskSignal(task: Record<string, unknown>): number {
    const overdueCount = Number(task.overdue_count ?? 0);
    const dueSoonCount = Number(task.due_soon_count ?? 0);

    if (overdueCount > 5) {
      return 0.9;
    }
    if (overdueCount > 2) {
      return 0.6;
    }
    if (dueSoonCount > 3) {
      return 0.4;
    }
    return 0.0;
  }

  private evaluateBondSignal(bond: Record<string, unknown>): number {
    const affection = Number(bond.affection_level ?? 50);
    const trend = String(bond.trend ?? "stable");
    const streak = Number(bond.streak_days ?? 0);

    let baseSignal = 0.0;
    if (affection >= 80) {
      baseSignal = 0.7;
    } else if (affection >= 65) {
      baseSignal = 0.4;
    } else if (affection >= 50) {
      baseSignal = 0.1;
    } else if (affection >= 35) {
      baseSignal = -0.2;
    } else if (affection >= 20) {
      baseSignal = -0.5;
    } else {
      baseSignal = -0.8;
    }

    if (trend === "rising") {
      baseSignal += 0.15;
    } else if (trend === "falling") {
      baseSignal -= 0.1;
    } else if (trend === "distant") {
      baseSignal -= 0.2;
    }

    if (streak >= 7) {
      baseSignal += 0.1;
    } else if (streak >= 3) {
      baseSignal += 0.05;
    }

    return Math.max(-1, Math.min(1, baseSignal));
  }

  shouldTransition(inputs: AmbientSignalInputs): AmbientState | null {
    const bondSignal = this.evaluateBondSignal(inputs.bond ?? {});
    const transitionScore =
      this.weights.activity * this.evaluateActivitySignal(inputs.activity) +
      this.weights.emotion * this.evaluateEmotionSignal(inputs.emotion) +
      this.weights.responsiveness * this.evaluateResponsivenessSignal(inputs.notificationHistory) +
      this.weights.temporal * this.evaluateTemporalSignal(inputs.currentHour) +
      this.weights.task * this.evaluateTaskSignal(inputs.task) +
      this.weights.bond * bondSignal;

    switch (this.state) {
      case "monitoring":
        if (transitionScore < -0.5) {
          return "suppressed";
        }
        return null;
      case "engaged":
        return null;
      case "cooldown":
        if (transitionScore > 0.3) {
          return "monitoring";
        }
        if (this.evaluateTaskSignal(inputs.task) > 0.7) {
          return "escalating";
        }
        return null;
      case "suppressed":
        if (transitionScore > 0.0) {
          return "monitoring";
        }
        return null;
      case "escalating":
        if (this.notificationAttempts > 3) {
          return "suppressed";
        }
        return null;
      case "idle":
      case "exploring":
      default:
        return null;
    }
  }
}
