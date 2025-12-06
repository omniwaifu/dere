import { useDashboardStore } from "@/stores/dashboard";
import { cn } from "@/lib/utils";

interface PresenceOrbProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  showTooltip?: boolean;
}

const SIZE_CLASSES = {
  sm: "h-4 w-4",
  md: "h-8 w-8",
  lg: "h-12 w-12",
};

const GLOW_SIZES = {
  sm: "shadow-[0_0_8px_var(--mood-glow)]",
  md: "shadow-[0_0_16px_var(--mood-glow)]",
  lg: "shadow-[0_0_24px_var(--mood-glow)]",
};

export function PresenceOrb({
  size = "md",
  className,
  showTooltip = true,
}: PresenceOrbProps) {
  const emotion = useDashboardStore((s) => s.emotion);
  const bond = useDashboardStore((s) => s.bond);
  const moodHue = useDashboardStore((s) => s.moodHue);
  const ambient = useDashboardStore((s) => s.ambient);

  const intensity = emotion?.intensity ?? 0;
  const affection = bond?.affection_level ?? 50;

  // Animation speed based on engagement state
  const isEngaged = ambient?.fsm_state === "engaged";
  const isMonitoring = ambient?.fsm_state === "monitoring";

  // Pulse animation class based on state
  const pulseClass = isEngaged
    ? "animate-pulse-fast"
    : isMonitoring
      ? "animate-pulse-slow"
      : "";

  // Opacity based on bond level (higher bond = more vibrant)
  const baseOpacity = 0.4 + (affection / 100) * 0.6;

  // Glow intensity based on emotion intensity
  const glowOpacity = Math.min(0.8, 0.2 + (intensity / 100) * 0.6);

  // Tooltip content
  const tooltipContent = bond
    ? `${bond.trend === "rising" ? "Growing closer" : bond.trend === "falling" ? "Drifting" : bond.trend === "distant" ? "Distant" : "Connected"} (${affection.toFixed(0)}%)`
    : "Connecting...";

  return (
    <div
      className={cn(
        "relative rounded-full transition-all duration-1000",
        SIZE_CLASSES[size],
        pulseClass,
        className
      )}
      title={showTooltip ? tooltipContent : undefined}
    >
      {/* Core orb */}
      <div
        className={cn(
          "absolute inset-0 rounded-full transition-all duration-1000",
          GLOW_SIZES[size]
        )}
        style={{
          background: `radial-gradient(circle at 30% 30%,
            hsl(${moodHue}, 80%, 70%) 0%,
            hsl(${moodHue}, 70%, 50%) 50%,
            hsl(${moodHue}, 60%, 35%) 100%)`,
          opacity: baseOpacity,
          boxShadow: `0 0 ${size === "lg" ? 24 : size === "md" ? 16 : 8}px hsl(${moodHue}, 80%, 60% / ${glowOpacity})`,
        }}
      />

      {/* Inner highlight for depth */}
      <div
        className="absolute inset-[15%] rounded-full transition-all duration-1000"
        style={{
          background: `radial-gradient(circle at 40% 40%,
            hsl(${moodHue}, 90%, 85%) 0%,
            transparent 60%)`,
          opacity: 0.4 + (affection / 100) * 0.3,
        }}
      />

      {/* Pulse ring when engaged */}
      {isEngaged && (
        <div
          className="absolute inset-[-25%] rounded-full animate-ping-slow"
          style={{
            border: `2px solid hsl(${moodHue}, 70%, 60% / 0.4)`,
          }}
        />
      )}
    </div>
  );
}

// Add to tailwind config: custom animations
// animate-pulse-slow: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite
// animate-pulse-fast: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite
// animate-ping-slow: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite
