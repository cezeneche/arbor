"""
Simple 3-state circuit breaker: CLOSED → OPEN → HALF_OPEN.

CLOSED:    calls pass through; consecutive failures tracked.
OPEN:      after `failure_threshold` consecutive failures; calls rejected for `recovery_timeout` s.
HALF_OPEN: one probe call allowed after recovery_timeout; success → CLOSED, failure → OPEN.
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable


class CircuitOpenError(RuntimeError):
    """Raised when a call is rejected because the circuit is OPEN."""


class CircuitBreaker:
    _CLOSED = "closed"
    _OPEN = "open"
    _HALF_OPEN = "half_open"

    def __init__(
        self,
        name: str,
        failure_threshold: int | None = None,
        recovery_timeout: int | None = None,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold or int(
            os.getenv("CIRCUIT_BREAKER_THRESHOLD", "5")
        )
        self.recovery_timeout = recovery_timeout or int(
            os.getenv("CIRCUIT_BREAKER_RECOVERY_S", "60")
        )
        self._state = self._CLOSED
        self._failures = 0
        self._opened_at: float = 0.0
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        return self._state

    def _trip(self) -> None:
        self._state = self._OPEN
        self._opened_at = time.monotonic()

    def _reset(self) -> None:
        self._state = self._CLOSED
        self._failures = 0

    def call(self, func: Callable, *args: Any, **kwargs: Any) -> Any:
        with self._lock:
            if self._state == self._OPEN:
                elapsed = time.monotonic() - self._opened_at
                if elapsed >= self.recovery_timeout:
                    self._state = self._HALF_OPEN
                else:
                    raise CircuitOpenError(
                        f"Circuit '{self.name}' is OPEN — retry in "
                        f"{int(self.recovery_timeout - elapsed)}s"
                    )

        # CLOSED or HALF_OPEN — attempt call
        try:
            result = func(*args, **kwargs)
        except Exception as exc:
            with self._lock:
                self._failures += 1
                if self._failures >= self.failure_threshold or self._state == self._HALF_OPEN:
                    self._trip()
            raise exc

        with self._lock:
            self._reset()

        return result


# Per-provider singletons
_openai_breaker = CircuitBreaker("openai")
_claude_breaker = CircuitBreaker("claude")
_gemini_breaker = CircuitBreaker("gemini")
