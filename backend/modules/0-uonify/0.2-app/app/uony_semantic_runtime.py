"""Bound synchronous semantic I/O without asyncio.run waiting for stale threads."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from functools import partial
from threading import BoundedSemaphore
from .uony_semantic_failure import bounded, SemanticDeadlineExceeded

# The pool survives an individual asyncio.run loop. A timed-out I/O occupies its
# slot until it actually returns; no unlimited threads or pending work are made.
_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix='uony-semantic-io')
_SLOTS = BoundedSemaphore(4)


async def blocking(function, *args, seconds, budget=None):
    if seconds <= 0 or not _SLOTS.acquire(blocking=False):
        raise SemanticDeadlineExceeded('semantic I/O deadline or capacity exhausted')
    try:
        future = _POOL.submit(copy_context().run, partial(function, *args))
    except BaseException:
        _SLOTS.release()
        raise
    future.add_done_callback(lambda _: _SLOTS.release())

    async def result():
        return await asyncio.wrap_future(future)

    return await bounded(result(), seconds, budget=budget)
