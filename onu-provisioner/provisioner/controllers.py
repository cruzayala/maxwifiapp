from __future__ import annotations

from pathlib import Path

from .huawei_eg8141a5 import HuaweiEg8141A5, OnuProvisioningError
from .models import DeviceSettings
from .zte_f670l import ZteF670L


def create_controller(
    device: DeviceSettings,
    backup_dir: Path,
    headless: bool,
    *,
    adapter_index: int | None = None,
):
    if device.model == "EG8141A5":
        return HuaweiEg8141A5(device, backup_dir, headless)
    if device.model == "F670L":
        return ZteF670L(device, backup_dir, headless, adapter_index=adapter_index)
    raise OnuProvisioningError(
        f"Modelo no compatible: {device.model}",
        code="ONU_MODEL_UNSUPPORTED",
        retryable=False,
    )

