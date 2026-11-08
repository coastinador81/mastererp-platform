"""Version-pinned tap on ADK's Gemini Live connection (ADK-FLUJOS §2, A2).

ADK 2.12 normalizes Gemini 3.x input transcription (every chunk becomes
finished=True) and drops VAD signals, interim transcripts and tool-call
cancellations. The tap hands each original provider message to Uonify before
ADK reads it, so turn finality and provenance come from the provider, never
from ADK's normalized events. Any other SDK version disables the tap.
"""
import contextlib

from google.adk import version as adk_version
from google.adk.models.gemini_llm_connection import GeminiLlmConnection
from google.adk.models.google_llm import Gemini
from google.genai import version as genai_version
from pydantic import PrivateAttr

VALIDATED_SDK = ('2.12.0', '2.31.0')


class _RawTap:
    """Transparent proxy of one genai Live session; only receive() is observed."""

    def __init__(self, inner, sink):
        self._inner = inner
        self._sink = sink

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def receive(self):
        async with contextlib.aclosing(self._inner.receive()) as messages:
            async for message in messages:
                # The sink is synchronous and must never raise or mutate it.
                self._sink(message)
                yield message


class TappedGemini(Gemini):
    """One instance per voice socket: its sink belongs to that session only."""

    _raw_sink = PrivateAttr(default=None)
    _raw_session = PrivateAttr(default=None)

    def tap(self, sink):
        self._raw_sink = sink

    @property
    def raw_session(self):
        """The provider session, for client content ADK cannot send safely (A3)."""
        return self._raw_session

    @contextlib.asynccontextmanager
    async def connect(self, llm_request):
        if (adk_version.__version__, genai_version.__version__) != VALIDATED_SDK:
            raise RuntimeError('unvalidated ADK/GenAI version: Live tap disabled')
        if self._raw_sink is None:
            raise RuntimeError('Live tap sink required')
        async with super().connect(llm_request) as connection:
            if type(connection) is not GeminiLlmConnection:
                raise RuntimeError('unexpected ADK Live connection')
            inner = connection._gemini_session
            connection._gemini_session = _RawTap(inner, self._raw_sink)
            self._raw_session = inner
            try:
                yield connection
            finally:
                if self._raw_session is inner:
                    self._raw_session = None
