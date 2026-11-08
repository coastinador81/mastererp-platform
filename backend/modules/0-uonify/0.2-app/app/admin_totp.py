"""TOTP (RFC 6238) con biblioteca estándar: sin dependencias nuevas (requirements está fijado)."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def generate_secret():
    # 20 bytes aleatorios en base32, como esperan las apps de autenticación.
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def _hotp(secret_b32, counter):
    key = base64.b32decode(secret_b32 + '=' * (-len(secret_b32) % 8))
    mac = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code = (struct.unpack('>I', mac[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f'{code:06d}'


def verify_totp(secret_b32, code, window=1, step=30):
    if not secret_b32 or not code or not code.isdigit() or len(code) != 6:
        return False
    counter = int(time.time() // step)
    return any(hmac.compare_digest(_hotp(secret_b32, counter + drift), code)
               for drift in range(-window, window + 1))


def otpauth_uri(secret_b32, email, issuer='Uonify Admin'):
    label = quote(f'{issuer}:{email}')
    return (f'otpauth://totp/{label}?secret={secret_b32}'
            f'&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30')
