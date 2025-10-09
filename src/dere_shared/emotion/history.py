from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from loguru import logger


@dataclass
class StimulusRecord:
    """Record of a stimulus for history tracking"""

    type: str
    valence: float  # -10 to +10
    intensity: float  # 0-100
    timestamp: int  # Unix timestamp ms
    context: dict


@dataclass
class StimulusBufferConfig:
    """Configuration for stimulus buffer"""

    max_size: int = 100  # Maximum number of stimuli to keep
    max_age_ms: int = 60 * 60 * 1000  # 1 hour in milliseconds


DEFAULT_STIMULUS_BUFFER_CONFIG = StimulusBufferConfig()


class StimulusBuffer:
    """Buffer for tracking recent stimuli for diminishing returns calculations"""

    def __init__(self, config: StimulusBufferConfig = DEFAULT_STIMULUS_BUFFER_CONFIG):
        self.config = config
        self.buffer: deque[StimulusRecord] = deque(maxlen=config.max_size)

    def add_stimulus(self, stimulus: StimulusRecord) -> None:
        """Add a stimulus to the buffer"""
        self.buffer.append(stimulus)
        self._cleanup_old_stimuli()

        logger.debug(
            f"[StimulusBuffer] Added stimulus: type={stimulus.type}, "
            f"valence={stimulus.valence:.1f}, intensity={stimulus.intensity:.1f}, "
            f"buffer_size={len(self.buffer)}"
        )

    def get_recent_stimuli(self, time_window_ms: int) -> list[StimulusRecord]:
        """Get stimuli within a time window"""
        import time

        current_time = int(time.time() * 1000)
        cutoff_time = current_time - time_window_ms

        recent = [s for s in self.buffer if s.timestamp >= cutoff_time]

        logger.debug(
            f"[StimulusBuffer] Retrieved {len(recent)} stimuli from last {time_window_ms / 1000:.0f}s"
        )

        return recent

    def get_similar_stimuli_count(
        self, stimulus_type: str, valence_sign: str, time_window_ms: int
    ) -> int:
        """Count similar stimuli in recent history"""
        recent = self.get_recent_stimuli(time_window_ms)

        count = 0
        for stimulus in recent:
            if stimulus.type == stimulus_type:
                stimulus_valence_sign = (
                    "positive"
                    if stimulus.valence > 0
                    else "negative"
                    if stimulus.valence < 0
                    else "neutral"
                )
                if stimulus_valence_sign == valence_sign:
                    count += 1

        return count

    def get_stats(self) -> dict:
        """Get buffer statistics"""
        if not self.buffer:
            return {
                "total_count": 0,
                "oldest_timestamp": None,
                "newest_timestamp": None,
                "age_range_seconds": 0,
                "positive_count": 0,
                "negative_count": 0,
                "neutral_count": 0,
            }

        oldest = min(s.timestamp for s in self.buffer)
        newest = max(s.timestamp for s in self.buffer)

        positive_count = sum(1 for s in self.buffer if s.valence > 0)
        negative_count = sum(1 for s in self.buffer if s.valence < 0)
        neutral_count = len(self.buffer) - positive_count - negative_count

        return {
            "total_count": len(self.buffer),
            "oldest_timestamp": oldest,
            "newest_timestamp": newest,
            "age_range_seconds": (newest - oldest) / 1000,
            "positive_count": positive_count,
            "negative_count": negative_count,
            "neutral_count": neutral_count,
        }

    def clear(self) -> None:
        """Clear the buffer"""
        self.buffer.clear()
        logger.info("[StimulusBuffer] Buffer cleared")

    def _cleanup_old_stimuli(self) -> None:
        """Remove stimuli older than max_age_ms"""
        import time

        current_time = int(time.time() * 1000)
        cutoff_time = current_time - self.config.max_age_ms

        original_size = len(self.buffer)

        # Deque doesn't support filtering in place, so we need to rebuild
        self.buffer = deque(
            (s for s in self.buffer if s.timestamp >= cutoff_time), maxlen=self.config.max_size
        )

        removed_count = original_size - len(self.buffer)
        if removed_count > 0:
            logger.debug(
                f"[StimulusBuffer] Removed {removed_count} old stimuli (age > {self.config.max_age_ms / 1000:.0f}s)"
            )
