"""Strict, bounded validation for mounted Craft PNG frames."""

import struct
from pathlib import Path
import zlib


def _decoded_rows(data: bytes, state: dict) -> None:
    stride, start = state['stride'], state['decoded']
    for position in range((-start) % stride, len(data), stride):
        if data[position] > 4:
            raise ValueError('Un frame PNG contiene un filtro de fila inválido.')
    state['decoded'] += len(data)
    if state['decoded'] > state['expected']:
        raise ValueError('Un frame PNG decodifica más píxeles de los declarados.')


def _decode_bounded(decoder, piece: bytes, state: dict,
                    chunk_bytes: int) -> None:
    pending = piece
    while pending:
        remaining = state['expected'] - state['decoded']
        limit = max(1, min(chunk_bytes, remaining + 1))
        prior = pending
        decoded = decoder.decompress(pending, limit)
        _decoded_rows(decoded, state)
        pending = decoder.unconsumed_tail
        if pending == prior and not decoded:
            raise ValueError('Un frame PNG no progresa al decodificar.')


def validate_png(path: Path, width: int, height: int,
                 has_alpha: bool, chunk_bytes: int) -> None:
    """Decode one canonical RGB/RGBA PNG without unbounded zlib output."""
    expected_type, channels = (6, 4) if has_alpha else (2, 3)
    state = {'stride': 1 + width * channels,
             'expected': height * (1 + width * channels), 'decoded': 0}
    decoder = zlib.decompressobj()
    seen_ihdr = seen_plte = seen_idat = seen_iend = idat_closed = False
    with path.open('rb') as source:
        if source.read(8) != b'\x89PNG\r\n\x1a\n':
            raise ValueError('Un frame no es PNG.')
        ordinal = 0
        while not seen_iend:
            header = source.read(8)
            if len(header) != 8:
                raise ValueError('Un frame PNG está truncado.')
            length, kind = struct.unpack('>I4s', header)
            if (length > 128 * 1024**2 or len(kind) != 4
                    or any(not (65 <= char <= 90 or 97 <= char <= 122)
                           for char in kind)):
                raise ValueError('Un chunk PNG no es válido.')
            if ordinal == 0 and kind != b'IHDR':
                raise ValueError('IHDR debe ser el primer chunk PNG.')
            if seen_idat and kind != b'IDAT':
                idat_closed = True
            if kind == b'IDAT' and idat_closed:
                raise ValueError('Los chunks IDAT deben ser contiguos.')
            if kind not in (b'IHDR', b'PLTE', b'IDAT', b'IEND') and not kind[0] & 32:
                raise ValueError('Un frame PNG contiene un chunk crítico desconocido.')
            remaining, crc, payload = length, zlib.crc32(kind), bytearray()
            while remaining:
                piece = source.read(min(chunk_bytes, remaining))
                if not piece:
                    raise ValueError('Un frame PNG está truncado.')
                remaining -= len(piece)
                crc = zlib.crc32(piece, crc)
                if kind in (b'IHDR', b'PLTE'):
                    payload.extend(piece)
                elif kind == b'IDAT':
                    _decode_bounded(decoder, piece, state, chunk_bytes)
            stored = source.read(4)
            if len(stored) != 4 or struct.unpack('>I', stored)[0] != crc & 0xffffffff:
                raise ValueError('Un frame PNG no supera CRC.')
            if kind == b'IHDR':
                if seen_ihdr or length != 13:
                    raise ValueError('La cabecera PNG no es canónica.')
                observed = struct.unpack('>IIBBBBB', payload)
                if observed != (width, height, 8, expected_type, 0, 0, 0):
                    raise ValueError('Un frame PNG no coincide con canvas y alfa.')
                seen_ihdr = True
            elif kind == b'PLTE':
                if (not seen_ihdr or seen_plte or seen_idat or not length
                        or length > 768 or length % 3):
                    raise ValueError('La paleta PNG no está ordenada.')
                seen_plte = True
            elif kind == b'IDAT':
                if not seen_ihdr:
                    raise ValueError('El flujo PNG no está ordenado.')
                seen_idat = True
            elif kind == b'IEND':
                if length or not seen_idat or seen_iend:
                    raise ValueError('El cierre PNG no es válido.')
                _decoded_rows(decoder.flush(), state)
                seen_iend = True
            ordinal += 1
        if (source.read(1) or not decoder.eof or decoder.unused_data
                or state['decoded'] != state['expected']):
            raise ValueError('Un frame PNG no decodifica el canvas completo.')
