"""Uonify server tools executed by ADK Live (ADK-FLUJOS §3, §10.3, A1).

The ADK 2.12 dispatcher runs a tool in the background only when the tool
object itself says NON_BLOCKING (`behavior`, an enum member); the declaration
alone is not enough. A routed request returns SILENT: the verified narration
speaks business results, not the conversational model. The read-only work
status returns WHEN_IDLE so the model answers the customer; the router's audio
arbiter still withholds that voice whenever the turn is a business action.
"""
import asyncio
import logging

from google.adk.tools.base_tool import BaseTool
from google.genai import types

logger = logging.getLogger(__name__)
# Real voice, 20-10-2026: «¿Recuerdas todo lo que hemos hablado?» made Gemini
# read the work status, and a SILENT answer left the customer with no reply.
SCHEDULING = {'get_current_work': types.FunctionResponseScheduling.WHEN_IDLE}


class ServerTool(BaseTool):
    """Delegates to the server dispatcher bound to this voice socket."""

    def __init__(self, declaration, owner):
        values = {key: value for key, value in declaration.items() if key != 'behavior'}
        base = types.FunctionDeclaration.model_validate(values)
        super().__init__(name=base.name, description=base.description or '',
                         behavior=types.Behavior.NON_BLOCKING,
                         response_scheduling=SCHEDULING.get(
                             base.name, types.FunctionResponseScheduling.SILENT))
        self._declaration = base.model_copy(update={'behavior': types.Behavior.NON_BLOCKING})
        self._owner = owner

    def _get_declaration(self):
        return self._declaration

    async def run_async(self, *, args, tool_context):
        call_id = tool_context.function_call_id
        if (not isinstance(call_id, str) or not 1 <= len(call_id) <= 128
                or not isinstance(args, dict)):
            return {'status': 'blocked', 'reason': 'invalid_live_tool'}
        try:
            result = await self._owner.run_tool(call_id, self.name, args)
        except asyncio.CancelledError:
            # The observer stops; the durable job, if any, keeps running.
            raise
        except Exception as error:
            # ADK only logs a raised tool error and never answers the model.
            logger.warning('Live ADK tool failed name=%s class=%s', self.name,
                           type(error).__name__)
            return {'status': 'error', 'reason': 'server_tool_failed'}
        if not isinstance(result, dict) or not result:
            return {'status': 'error', 'reason': 'invalid_server_result'}
        return result
