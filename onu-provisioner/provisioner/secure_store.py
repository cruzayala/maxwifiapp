from __future__ import annotations

import base64
import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _blob(data: bytes) -> tuple[_DataBlob, ctypes.Array]:
    buffer = ctypes.create_string_buffer(data)
    return _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))), buffer


def _protect_windows(data: bytes) -> bytes:
    source, source_buffer = _blob(data)
    output = _DataBlob()
    ok = ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), "ISP Max ONU Studio", None, None, None, 0x1, ctypes.byref(output)
    )
    del source_buffer
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)


def _unprotect_windows(data: bytes) -> bytes:
    source, source_buffer = _blob(data)
    output = _DataBlob()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0x1, ctypes.byref(output)
    )
    del source_buffer
    if not ok:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output.pbData)


class SecureJsonStore:
    """Small CurrentUser secret store backed by Windows DPAPI."""

    def __init__(self, path: Path):
        self.path = path

    def save(self, value: dict) -> None:
        payload = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        if os.name == "nt":
            envelope = b"DPAPI1\0" + _protect_windows(payload)
        else:
            envelope = b"DEV1\0" + base64.b64encode(payload)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(envelope)
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        temporary.replace(self.path)

    def load(self) -> dict | None:
        if not self.path.exists():
            return None
        envelope = self.path.read_bytes()
        if envelope.startswith(b"DPAPI1\0"):
            payload = _unprotect_windows(envelope[7:])
        elif envelope.startswith(b"DEV1\0") and os.name != "nt":
            payload = base64.b64decode(envelope[5:], validate=True)
        else:
            raise ValueError("Formato de sesion cifrada desconocido")
        value = json.loads(payload.decode("utf-8"))
        return value if isinstance(value, dict) else None

    def delete(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
