"""Petición y salida de imagen de los tres modelos auditados, sin transporte HTTP."""

from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from dataclasses import dataclass
from hashlib import sha256
import re

from .creative_google_capabilities import image_model_ids


IMAGE_MODELS = image_model_ids()
_PROJECT = re.compile(r'[a-z][a-z0-9-]{4,61}[a-z0-9]\Z')

# §G (veredicto 20261022 + vertex-imagen-gemini-image.md §5.2/matriz): los 3 modelos de imagen del
# Estudio (nano-banana-2.1, 3.1-flash-image, 3-pro-image) admiten las MISMAS 14 proporciones. La
# resolución se cablea a 1K (lo verificado hoy); 2K/4K son capacidad del modelo sin cablear → no se
# ofrecen hasta cablearlas y re-probar. Validar ANTES evita el 400 rejected_final por ratio/tamaño
# fuera de matriz (vertex-imagen-gemini-image.md §D5).
VERIFIED_IMAGE_ASPECTS = ('1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
                          '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1')
VERIFIED_IMAGE_SIZE = '1K'


@dataclass(frozen=True)
class ImageRequest:
    endpoint: str
    model: str
    body: dict
    input_manifest: tuple[dict, ...]


@dataclass(frozen=True)
class ImageMedia:
    mime_type: str
    data: bytes


@dataclass(frozen=True)
class ImageOutput:
    mime_type: str
    data: bytes
    sha256: str
    width_pixels: int
    height_pixels: int


def image_request(project: str, model: str, prompt: str,
                  reference: ImageMedia | None = None, *,
                  aspect_ratio: str = '1:1') -> ImageRequest:
    """Texto→imagen auditado; imagen→edición documentada, todavía sin prueba real.

    §G: `aspect_ratio` del envelope VERIFICADO de imagen (14 proporciones). Por defecto 1:1 para no
    alterar a quien ya lo llama. La resolución sigue cableada a 1K (lo verificado), no se parametriza.
    """
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError('Proyecto Google no válido.')
    if model not in IMAGE_MODELS:
        raise ValueError('Modelo de imagen no comprobado.')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
        raise ValueError('Instrucción de imagen no válida.')
    if aspect_ratio not in VERIFIED_IMAGE_ASPECTS:
        raise ValueError('Proporción de imagen no verificada.')
    parts = [{'text': prompt.strip()}]
    manifest = ()
    if reference is not None:
        if (not isinstance(reference, ImageMedia) or not isinstance(reference.data, bytes)
                or not reference.data or len(reference.data) > 7_000_000
                or not _has_signature(reference.data, reference.mime_type)):
            raise ValueError('Referencia de imagen inline no válida o superior a 7 MB.')
        parts.append({'inlineData': {'mimeType': reference.mime_type,
                                     'data': b64encode(reference.data).decode('ascii')}})
        manifest = ({'kind': 'image', 'mimeType': reference.mime_type,
                     'bytes': len(reference.data),
                     'sha256': sha256(reference.data).hexdigest()},)
    endpoint = (f'https://aiplatform.googleapis.com/v1/projects/{project}'
                f'/locations/global/publishers/google/models/{model}:generateContent')
    return ImageRequest(endpoint, model, {
        'contents': [{'role': 'user', 'parts': parts}],
        'generationConfig': {'maxOutputTokens': 4096,
                             'responseModalities': ['TEXT', 'IMAGE'],
                             'imageConfig': {'aspectRatio': aspect_ratio,
                                             'imageSize': VERIFIED_IMAGE_SIZE}},
    }, manifest)


def _has_signature(data: bytes, mime_type: str) -> bool:
    if mime_type == 'image/png':
        return data.startswith(b'\x89PNG\r\n\x1a\n')
    if mime_type == 'image/jpeg':
        return data.startswith(b'\xff\xd8\xff')
    if mime_type == 'image/webp':
        return data.startswith(b'RIFF') and data[8:12] == b'WEBP'
    return False


def image_dimensions(data: bytes, mime_type: str) -> tuple[int, int]:
    """Lee dimensiones declaradas sin decodificar píxeles ni confiar en cliente."""
    if not isinstance(data, bytes) or not _has_signature(data, mime_type):
        raise ValueError('Imagen o tipo MIME no admitidos.')
    width = height = 0
    if mime_type == 'image/png':
        if (len(data) < 33 or data[8:12] != b'\x00\x00\x00\r'
                or data[12:16] != b'IHDR'):
            raise ValueError('Cabecera PNG incompleta.')
        width = int.from_bytes(data[16:20], 'big')
        height = int.from_bytes(data[20:24], 'big')
    elif mime_type == 'image/jpeg':
        offset = 2
        sof = {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
               0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf}
        while offset + 4 <= len(data):
            if data[offset] != 0xff:
                raise ValueError('Marcador JPEG no válido.')
            while offset < len(data) and data[offset] == 0xff:
                offset += 1
            if offset >= len(data):
                break
            marker, offset = data[offset], offset - 1
            if marker in sof:
                if offset + 9 > len(data):
                    break
                height = int.from_bytes(data[offset + 5:offset + 7], 'big')
                width = int.from_bytes(data[offset + 7:offset + 9], 'big')
                break
            if marker in {0x01, *range(0xd0, 0xda)}:
                offset += 2
                continue
            length = int.from_bytes(data[offset + 2:offset + 4], 'big')
            if length < 2 or offset + 2 + length > len(data):
                break
            offset += 2 + length
    else:
        offset = 12
        while offset + 8 <= len(data):
            kind = data[offset:offset + 4]
            length = int.from_bytes(data[offset + 4:offset + 8], 'little')
            start, end = offset + 8, offset + 8 + length
            if end > len(data):
                break
            if kind == b'VP8X' and length >= 10:
                width = 1 + int.from_bytes(data[start + 4:start + 7], 'little')
                height = 1 + int.from_bytes(data[start + 7:start + 10], 'little')
                break
            if kind == b'VP8L' and length >= 5 and data[start] == 0x2f:
                bits = int.from_bytes(data[start + 1:start + 5], 'little')
                width, height = (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1
                break
            if (kind == b'VP8 ' and length >= 10
                    and data[start + 3:start + 6] == b'\x9d\x01\x2a'):
                width = int.from_bytes(data[start + 6:start + 8], 'little') & 0x3fff
                height = int.from_bytes(data[start + 8:start + 10], 'little') & 0x3fff
                break
            offset = end + (length & 1)
    if not 1 <= width <= 32768 or not 1 <= height <= 32768:
        raise ValueError('Dimensiones de imagen indeterminadas o fuera de límites.')
    return width, height


def image_completed(response: dict, model: str) -> tuple[ImageOutput, ...]:
    """Entrega solo inlineData final; los parts thought de Gemini no son resultado."""
    if (model not in IMAGE_MODELS or not isinstance(response, dict)
            or response.get('modelVersion') != model):
        raise ValueError('Respuesta de un modelo distinto o no comprobado.')
    candidates = response.get('candidates')
    if not isinstance(candidates, list) or len(candidates) != 1:
        raise ValueError('La respuesta no contiene una candidata de imagen única.')
    candidate = candidates[0]
    if not isinstance(candidate, dict) or candidate.get('finishReason') != 'STOP':
        raise ValueError('La generación de imagen no terminó correctamente.')
    parts = candidate.get('content', {}).get('parts')
    if not isinstance(parts, list):
        raise ValueError('No hay partes de imagen.')
    images = []
    for part in parts:
        if not isinstance(part, dict) or part.get('thought') is True:
            continue
        inline = part.get('inlineData')
        if not isinstance(inline, dict):
            continue
        mime_type, encoded = inline.get('mimeType'), inline.get('data')
        if not isinstance(encoded, str):
            raise ValueError('Faltan datos de imagen.')
        try:
            data = b64decode(encoded, validate=True)
        except (Base64Error, ValueError) as error:
            raise ValueError('Imagen codificada incorrectamente.') from error
        if not _has_signature(data, mime_type):
            raise ValueError('Formato de imagen no admitido o incorrecto.')
        width, height = image_dimensions(data, mime_type)
        images.append(ImageOutput(mime_type, data, sha256(data).hexdigest(),
                                  width, height))
    if len(images) != 1:
        raise ValueError('Google no devolvió exactamente una imagen final utilizable.')
    return tuple(images)
