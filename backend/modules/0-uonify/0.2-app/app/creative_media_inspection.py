"""Bounded structural inspection for non-PNG candidate media.

The functions in this module parse exact private-object bytes in-process. They
do not invoke codecs, subprocesses, providers or storage and they compare every
derived measurement with the persisted asset authority.
"""

from io import BytesIO
import warnings
import wave

from PIL import Image, UnidentifiedImageError

from .creative_image_contracts import image_dimensions


MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_AUDIO_BYTES = 128 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_CONTAINER_CHUNKS = 4096


class DecoderUnavailable(ValueError):
    """The medium remains closed until an audited real codec is available."""


def _positive_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f'{label} no es válido.')
    return value


def _same_number(observed: float, expected: object, tolerance: float) -> None:
    if (not isinstance(expected, (int, float)) or isinstance(expected, bool)
            or abs(float(expected) - observed) > tolerance):
        raise ValueError('La medida técnica no coincide con el asset.')


def _same_geometry(media: dict, width: int, height: int) -> None:
    if (media.get('widthPixels'), media.get('heightPixels')) != (width, height):
        raise ValueError('La geometría técnica no coincide con el asset.')


def _jpeg_structure(data: bytes) -> None:
    if len(data) < 6 or not data.startswith(b'\xff\xd8') or not data.endswith(b'\xff\xd9'):
        raise ValueError('JPEG incompleto.')
    offset, saw_scan, saw_sof, markers = 2, False, False, 0
    sof = {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
           0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf}
    while offset < len(data) - 2:
        if data[offset] != 0xff:
            if not saw_scan:
                raise ValueError('JPEG contiene bytes fuera de segmento.')
            offset += 1
            continue
        markers += 1
        if markers > MAX_CONTAINER_CHUNKS:
            raise ValueError('JPEG supera el límite de segmentos.')
        while offset < len(data) and data[offset] == 0xff:
            offset += 1
        if offset >= len(data):
            raise ValueError('Marcador JPEG incompleto.')
        marker = data[offset]
        offset += 1
        if marker == 0xd9:
            if offset != len(data):
                raise ValueError('JPEG contiene datos tras EOI.')
            return
        if saw_scan and marker == 0x00:
            continue
        if saw_scan and marker in range(0xd0, 0xd8):
            continue
        if marker == 0xd8 or marker in range(0xd0, 0xd8) and not saw_scan:
            raise ValueError('Marcador JPEG fuera de posición.')
        if marker == 0x01:
            continue
        if offset + 2 > len(data):
            raise ValueError('Segmento JPEG incompleto.')
        length = int.from_bytes(data[offset:offset + 2], 'big')
        if length < 2 or offset + length > len(data):
            raise ValueError('Longitud JPEG no válida.')
        if marker in sof:
            if saw_sof or saw_scan:
                raise ValueError('JPEG contiene cabeceras de imagen ambiguas.')
            saw_sof = True
        if marker == 0xda:
            if not saw_sof:
                raise ValueError('JPEG inicia scan sin cabecera de imagen.')
            saw_scan = True
        offset += length
    if not saw_scan:
        raise ValueError('JPEG sin scan codificado.')


def _webp_structure(data: bytes) -> bool:
    if (len(data) < 20 or data[:4] != b'RIFF' or data[8:12] != b'WEBP'
            or int.from_bytes(data[4:8], 'little') != len(data) - 8):
        raise ValueError('Contenedor WebP no válido.')
    offset, chunks, chunk_count, extended_alpha = 12, set(), 0, None
    container_geometry = bitstream_geometry = None
    bitstream_alpha = False
    while offset < len(data):
        chunk_count += 1
        if chunk_count > MAX_CONTAINER_CHUNKS:
            raise ValueError('WebP supera el límite de chunks.')
        if offset + 8 > len(data):
            raise ValueError('Chunk WebP incompleto.')
        kind = data[offset:offset + 4]
        size = int.from_bytes(data[offset + 4:offset + 8], 'little')
        start, end = offset + 8, offset + 8 + size
        if end > len(data):
            raise ValueError('Longitud WebP no válida.')
        if kind in chunks:
            raise ValueError('Chunks WebP ambiguos.')
        chunks.add(kind)
        if kind == b'VP8X':
            if size != 10:
                raise ValueError('VP8X no válido.')
            flags = data[start]
            if flags & 0x02:
                raise ValueError('WebP animado no admitido.')
            extended_alpha = bool(flags & 0x10)
            container_geometry = (
                1 + int.from_bytes(data[start + 4:start + 7], 'little'),
                1 + int.from_bytes(data[start + 7:start + 10], 'little'))
        elif kind == b'VP8 ':
            if size < 10 or data[start + 3:start + 6] != b'\x9d\x01\x2a':
                raise ValueError('Bitstream VP8 no válido.')
            bitstream_geometry = (
                int.from_bytes(data[start + 6:start + 8], 'little') & 0x3fff,
                int.from_bytes(data[start + 8:start + 10], 'little') & 0x3fff)
        elif kind == b'VP8L':
            if size < 5 or data[start] != 0x2f:
                raise ValueError('Bitstream VP8L no válido.')
            bits = int.from_bytes(data[start + 1:start + 5], 'little')
            bitstream_geometry = ((bits & 0x3fff) + 1,
                                  ((bits >> 14) & 0x3fff) + 1)
            bitstream_alpha = bool(bits & (1 << 28))
        offset = end + (size & 1)
    if offset != len(data):
        raise ValueError('Padding WebP no válido.')
    streams = sum(kind in chunks for kind in (b'VP8 ', b'VP8L'))
    if streams != 1 or bitstream_geometry is None:
        raise ValueError('WebP sin bitstream de imagen.')
    if container_geometry is not None and container_geometry != bitstream_geometry:
        raise ValueError('La geometría VP8X no coincide con el bitstream.')
    observed_alpha = b'ALPH' in chunks or bitstream_alpha
    if extended_alpha is not None and extended_alpha != observed_alpha:
        raise ValueError('La bandera alfa VP8X no coincide con el bitstream.')
    return observed_alpha


def _inspect_image(item: dict, data: bytes) -> dict:
    mime, media = item['mime_type'], item['media']
    if not 0 < len(data) <= MAX_IMAGE_BYTES:
        raise ValueError('La imagen supera el límite del inspector.')
    width, height = image_dimensions(data, mime)
    if mime == 'image/jpeg':
        _jpeg_structure(data)
        alpha = False
        decoder = 'uonify.pillow-jpeg-decode-v1'
    elif mime == 'image/webp':
        alpha = _webp_structure(data)
        decoder = 'uonify.pillow-webp-decode-v1'
    else:
        raise ValueError('Tipo de imagen no inspeccionable.')
    if width * height > MAX_IMAGE_PIXELS:
        raise ValueError('La imagen supera el límite de píxeles.')
    expected_format = 'JPEG' if mime == 'image/jpeg' else 'WEBP'
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as decoded:
                if (decoded.format != expected_format
                        or getattr(decoded, 'n_frames', 1) != 1
                        or decoded.size != (width, height)):
                    raise ValueError('El codec de imagen no coincide.')
                decoded.load()
                codec_alpha = 'A' in decoded.getbands()
    except (UnidentifiedImageError, OSError, SyntaxError,
            Image.DecompressionBombWarning) as error:
        raise ValueError('La imagen no puede decodificarse completamente.') from error
    if codec_alpha != alpha:
        raise ValueError('El codec y el contenedor discrepan sobre alfa.')
    _same_geometry(media, width, height)
    if bool(media.get('hasAlpha')) != alpha:
        raise ValueError('El canal alfa no coincide con el asset.')
    return {'decoder': decoder, 'widthPixels': width, 'heightPixels': height,
            'hasAlpha': alpha}


def _audio_authority(media: dict, sample_rate: int, channels: int,
                     samples: int, encoding: str) -> float:
    if (media.get('sampleRateHz') != sample_rate
            or media.get('channels') != channels
            or media.get('encoding') != encoding
            or media.get('samplesPerChannel') not in (None, samples)):
        raise ValueError('Los metadatos de audio no coinciden con los bytes.')
    duration = samples / sample_rate
    _same_number(duration, media.get('durationSeconds'), 1 / sample_rate)
    return duration


def _inspect_wav(item: dict, data: bytes) -> dict:
    if not 0 < len(data) <= MAX_AUDIO_BYTES:
        raise ValueError('El audio supera el límite del inspector.')
    if (len(data) < 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE'
            or int.from_bytes(data[4:8], 'little') != len(data) - 8):
        raise ValueError('Contenedor WAV no válido.')
    try:
        with wave.open(BytesIO(data), 'rb') as source:
            channels, rate = source.getnchannels(), source.getframerate()
            samples, width = source.getnframes(), source.getsampwidth()
            if source.getcomptype() != 'NONE' or width not in (1, 2, 3, 4):
                raise ValueError('WAV no contiene PCM admitido.')
            remaining, observed = samples, 0
            while remaining:
                chunk_frames = min(remaining, 65536)
                chunk = source.readframes(chunk_frames)
                if not chunk:
                    break
                if len(chunk) % (channels * width):
                    raise ValueError('WAV contiene una muestra incompleta.')
                read = len(chunk) // (channels * width)
                remaining -= read
                observed += len(chunk)
            if remaining or observed != samples * channels * width:
                raise ValueError('WAV truncado.')
    except (EOFError, wave.Error) as error:
        raise ValueError('WAV no válido.') from error
    duration = _audio_authority(
        item['media'], rate, channels, samples, 'pcm_wav')
    return {'decoder': 'uonify.strict-wave-pcm-v1', 'sampleRateHz': rate,
            'channels': channels, 'samplesPerChannel': samples,
            'sampleWidthBytes': width, 'durationSeconds': duration,
            'encoding': 'pcm_wav'}


def _inspect_pcm(item: dict, data: bytes) -> dict:
    if not 0 < len(data) <= MAX_AUDIO_BYTES:
        raise ValueError('El audio supera el límite del inspector.')
    media = item['media']
    rate, channels = 24000, _positive_int(media.get('channels'), 'Canales')
    if len(data) % (2 * channels):
        raise ValueError('PCM L16 contiene una muestra incompleta.')
    samples = len(data) // (2 * channels)
    _positive_int(samples, 'Muestras')
    duration = _audio_authority(media, rate, channels, samples, 'pcm_l16')
    return {'decoder': 'uonify.strict-pcm-l16-v1', 'sampleRateHz': rate,
            'channels': channels, 'samplesPerChannel': samples,
            'sampleWidthBytes': 2, 'durationSeconds': duration,
            'encoding': 'pcm_l16'}


def inspect_media_payload(item: dict, payload: bytes) -> dict:
    """Derive bounded measurements for every supported non-PNG medium."""
    kind, mime = item.get('kind'), item.get('mime_type')
    if kind == 'image' and mime in ('image/jpeg', 'image/webp'):
        return _inspect_image(item, payload)
    if kind == 'video' and mime == 'video/mp4':
        raise DecoderUnavailable('MP4 requiere un codec sandboxed auditado.')
    if kind == 'audio' and mime == 'audio/wav':
        return _inspect_wav(item, payload)
    if kind == 'audio' and mime == 'audio/L16;codec=pcm;rate=24000':
        return _inspect_pcm(item, payload)
    if kind == 'audio' and mime == 'audio/mpeg':
        raise DecoderUnavailable('MP3 requiere un codec sandboxed auditado.')
    raise ValueError('Tipo de medio sin inspector técnico registrado.')
