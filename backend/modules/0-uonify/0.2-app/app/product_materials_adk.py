"""Disabled-by-default ADK document analyzer for an isolated materials pilot.

This uses ADK's pinned Gemini transport for exactly one bounded model response.
It exposes no tools, creates no product, and never selects itself as a worker.
ProductMaterials requires an explicit injected instance plus an account allowlist.
"""
import asyncio
import json

from .google_cloud_provider import CloudError
from .product_materials_analyzer import (
    ANALYSIS_EFFORT, ANALYSIS_MODEL, SYSTEM, analysis_parts, recorded_usage,
    response_schema, safe_diagnostics, validate_output,
)
from .uony_adk_provider import _model_for_request, _provider_error


def pilot_adapter(settings):
    """Composition-root opt-in; an empty allowlist never constructs an ADK arm."""
    return AdkMaterialsAnalyzer() if settings.material_adk_pilot_user_ids else None


class AdkMaterialsAnalyzer:
    def analyze(self, token, project, product, sources):
        if not isinstance(token, str) or not token or not isinstance(project, str) or not project:
            raise CloudError('google_unavailable')
        return asyncio.run(self._analyze(token, project, product, sources))

    async def _analyze(self, token, project, product, sources):
        from google.adk.models.llm_request import LlmRequest
        from google.genai import types

        usage = {'calls': 1, 'totalTokenCount': 0}
        confirmed = False
        diagnostics = {'stage': 'request'}
        model = None
        try:
            model = _model_for_request(token, project, ANALYSIS_MODEL, types)
            request = LlmRequest(
                model=ANALYSIS_MODEL,
                contents=[types.Content(role='user', parts=[
                    types.Part.model_validate(part) for part in analysis_parts(product, sources)])],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM,
                    response_mime_type='application/json',
                    response_schema=response_schema(sources),
                    max_output_tokens=8192,
                    automatic_continuation=False,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                    thinking_config=types.ThinkingConfig(thinking_level=ANALYSIS_EFFORT),
                ),
                tools_dict={},
            )
            response = None
            async for item in model.generate_content_async(request, stream=False):
                if response is not None:
                    raise CloudError('invalid_response')
                response = item
            diagnostics['stage'] = 'response_json'
            if response is None or response.error_code or not response.content or not response.content.parts:
                raise CloudError('invalid_response')
            count = getattr(getattr(response, 'usage_metadata', None), 'total_token_count', None)
            confirmed = type(count) is int and count >= 0
            usage['totalTokenCount'] = count if confirmed else 0
            diagnostics['stage'] = 'finish_reason'
            finish_reason = getattr(response.finish_reason, 'name', str(response.finish_reason))
            diagnostics['finishReason'] = finish_reason
            if finish_reason != 'STOP' or any(part.function_call for part in response.content.parts):
                raise CloudError('invalid_response')
            text = ''.join(part.text for part in response.content.parts
                           if isinstance(part.text, str) and not part.thought)
            if not text:
                raise CloudError('invalid_response')
            diagnostics['stage'] = 'output_json'
            decoded = json.loads(text)
            diagnostics['stage'] = 'validation'
            output = validate_output(decoded, sources)
            output['usage'] = recorded_usage(usage, confirmed)
            return output
        except CloudError as error:
            error.usage = recorded_usage(usage, confirmed)
            error.diagnostics = safe_diagnostics(diagnostics)
            raise
        except json.JSONDecodeError:
            error = CloudError('invalid_response')
            error.usage = recorded_usage(usage, confirmed)
            error.diagnostics = safe_diagnostics({**diagnostics, 'reason': 'invalid_json'})
            raise error from None
        except Exception as error:
            safe = _provider_error(error)
            safe.usage = recorded_usage(usage, confirmed)
            safe.diagnostics = safe_diagnostics(diagnostics)
            raise safe from None
        finally:
            if model is not None:
                try:
                    await model.api_client.aio.aclose()
                except Exception:
                    pass
