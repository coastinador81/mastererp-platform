"""Local output deadline ends before another process may reclaim the session."""
import time

HEARTBEAT_INTERVAL_SECONDS = 5
OUTPUT_GRACE_SECONDS = 20
RECLAIM_AFTER_SECONDS = 30


class SessionOutputGuard:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.confirmed_at = clock()
        self.stopped = False

    def check(self):
        if self.stopped or self.clock() - self.confirmed_at >= OUTPUT_GRACE_SECONDS:
            raise ValueError('live_session_heartbeat_expired')

    def confirm(self, validated_at):
        self.confirmed_at = validated_at

    def stop(self):
        self.stopped = True
