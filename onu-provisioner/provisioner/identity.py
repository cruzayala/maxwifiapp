from __future__ import annotations

import re


def normalize_gpon_serial(value: str) -> str:
    """Return the 12-character serial representation used by GPON OLT CLIs."""
    serial = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    if re.fullmatch(r"[0-9A-F]{16}", serial):
        try:
            vendor = bytes.fromhex(serial[:8]).decode("ascii").upper()
        except (UnicodeDecodeError, ValueError):
            vendor = ""
        if re.fullmatch(r"[A-Z0-9]{4}", vendor):
            serial = f"{vendor}{serial[8:]}"
    if not re.fullmatch(r"[A-Z0-9]{12}", serial):
        raise ValueError("Serial GPON invalido")
    return serial
