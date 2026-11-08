"""Revalidación local acotada de una salida pagada; nunca inventa un dato."""
from copy import deepcopy
import json
from .google_cloud_provider import CloudError
from .product_reasoning_context import digest, MAX_TARGETS
from .product_reasoning_output import decode_wire_response, validate_shape, validate_resolutions

RECOVERY_VERSION = 1
MAX_OUTPUT_CHARACTERS = 262144


def recover_paid_response(stored, usage, context, *, verification=False, proposal=None):
    """Solo restaura el escape JSON de un enum cerrado, antes del mismo validador.

    Una referencia inventada, número corrupto, salida truncada o consumo incierto
    no es recuperable aquí. No se cambia a desconocido ni se llama al proveedor.
    La verificación independiente y la validación documental siguen pendientes.
    """
    diagnostics = stored.get('diagnostics', {})
    if (diagnostics.get('httpStatus') != 200 or diagnostics.get('finishReason') != 'STOP'
        or diagnostics.get('stage') != 'validation' or usage.get('unconfirmedCalls')
        or len(context.get('targets', [])) > MAX_TARGETS):
        return None
    original = stored.get('rejectedResponse')
    if not isinstance(original, (dict, str)):
        return None
    try:
        encoded = original if isinstance(original, str) else json.dumps(original, ensure_ascii=False)
        if len(encoded) > MAX_OUTPUT_CHARACTERS:
            return None
        wire = json.loads(encoded)
        if not isinstance(wire, dict):
            return None
        repaired = deepcopy(wire); changes = []
        if not verification:
            targets = {target['id']: target for target in context['targets']}
            decisions = repaired.get('decisions')
            if not isinstance(decisions, list) or len(decisions) > len(targets):
                return None
            for index, item in enumerate(decisions):
                if not isinstance(item, dict):
                    return None
                value = item.get('valueJson'); target = targets.get(item.get('targetId'), {})
                if not isinstance(value, str):
                    continue
                try:
                    json.loads(value)
                    continue
                except ValueError:
                    pass
                # Exactitud léxica: no trim, conversión de unidades, coerción,
                # etiqueta traducida ni string libre. Solo enum nativo cerrado.
                options = target.get('constraints', {}).get('enum', target.get('schema', {}).get('enum', []))
                if (item.get('state') == 'inferred' and target.get('type') == 'string'
                    and isinstance(options, list) and any(type(option) is str and option == value for option in options)):
                    item['valueJson'] = json.dumps(value, ensure_ascii=False)
                    changes.append({'itemIndex': index, 'code': 'quoted_exact_string_enum'})
        result = validate_shape(decode_wire_response(repaired, verification), context, verification)
        if verification:
            validate_resolutions(result, proposal or {})
            result['proposalFingerprint'] = digest((proposal or {}).get('decisions', []))
        result.update(usage=deepcopy(usage), localRecoveryVersion=RECOVERY_VERSION)
        return {'version': RECOVERY_VERSION, 'origin': 'server_transport_revalidation',
                'responseFingerprint': digest(wire), 'derivedFingerprint': digest(repaired),
                'repairs': changes, 'result': result}
    except (CloudError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
        return None
