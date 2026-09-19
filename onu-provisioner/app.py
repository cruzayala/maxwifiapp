from __future__ import annotations

import asyncio
import hmac
import os
import re
import threading
import time
import uuid
import json
import logging
import platform
import socket
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from ipaddress import IPv4Address, IPv4Network
from typing import Literal
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator

from provisioner import __version__
from provisioner.controllers import create_controller
from provisioner.discovery import DiscoveryService
from provisioner.genieacs import GenieAcsClient, GenieAcsError
from provisioner.huawei_eg8141a5 import OnuProvisioningError
from provisioner.models import ConnectionCheckRequest, JobState, ProvisionRequest
from provisioner.network import NetworkError, ensure_ipv4_address, is_windows_admin, list_adapters, probe_http
from provisioner.paths import BACKUP_DIR, CLOUD_SESSION_PATH, DATABASE_PATH, ENV_PATH, STATIC_DIR, ensure_runtime_directories
from provisioner.secure_store import SecureJsonStore
from provisioner.startup import set_startup, startup_status
from provisioner.installation import installation_status
from provisioner.storage import JobStore


LOGGER = logging.getLogger("onu-studio")


ensure_runtime_directories()
load_dotenv(ENV_PATH)

PORT = int(os.getenv("ONU_PORT", "8765"))
HEADLESS = os.getenv("ONU_HEADLESS", "true").lower() not in {"0", "false", "no"}
DEFAULT_USERNAME = os.getenv("ONU_DEFAULT_USERNAME", "telecomadmin")
DEFAULT_PASSWORD = os.getenv("ONU_DEFAULT_PASSWORD", "")
DEFAULT_ZTE_USERNAME = os.getenv("ONU_ZTE_DEFAULT_USERNAME", "admin")
DEFAULT_ZTE_PASSWORD = os.getenv("ONU_ZTE_DEFAULT_PASSWORD", "")
DEFAULT_TR069_ENABLED = os.getenv("ONU_TR069_ENABLED", "true").lower() not in {"0", "false", "no"}
DEFAULT_TR069_ACS_URL = os.getenv("ONU_TR069_ACS_URL", "http://10.254.250.2:7547/")
DEFAULT_TR069_USERNAME = os.getenv("ONU_TR069_USERNAME", "ispmax-cpe")
DEFAULT_TR069_PASSWORD = os.getenv("ONU_TR069_PASSWORD", "")
DEFAULT_TR069_CONNECTION_REQUEST_USERNAME = os.getenv(
    "ONU_TR069_CONNECTION_REQUEST_USERNAME", "ispmax-connection-request"
)
DEFAULT_TR069_CONNECTION_REQUEST_PASSWORD = os.getenv("ONU_TR069_CONNECTION_REQUEST_PASSWORD", "")
DEFAULT_TR069_PERIODIC_INFORM_INTERVAL = int(os.getenv("ONU_TR069_PERIODIC_INFORM_INTERVAL", "900"))
STORE = JobStore(DATABASE_PATH)
STORE.interrupt_incomplete()
SECURE_CLOUD_STORE = SecureJsonStore(CLOUD_SESSION_PATH)
DISCOVERY = DiscoveryService(interval_seconds=5.0)
TR069_WORKER = None
ONU_CLOUD_WORKER = None
DEVICE_ID = os.getenv("ONU_AGENT_ID", f"onu-studio-{uuid.getnode():012x}")[:100]
CLOUD = {
    "base_url": os.getenv("ISP_MAX_CLOUD_URL", "http://127.0.0.1:7401").rstrip("/"),
    "token": None,
    "agent_token": os.getenv("ISP_MAX_AGENT_TOKEN", "").strip() or None,
    "device_token": None,
    "user": None,
    "session_state": "disconnected",
    "last_verified_at": None,
    "token_fingerprint": None,
    "revoked_reason": None,
}


def load_secure_cloud_state() -> None:
    try:
        saved = SECURE_CLOUD_STORE.load() or {}
    except Exception as exc:
        LOGGER.warning("No se pudo abrir la sesion DPAPI: %s", exc)
        CLOUD["session_state"] = "revoked"
        return
    if saved.get("base_url"):
        CLOUD["base_url"] = str(saved["base_url"]).rstrip("/")
    CLOUD["device_token"] = saved.get("device_token") or None
    CLOUD["agent_token"] = saved.get("agent_token") or CLOUD["agent_token"]
    CLOUD["user"] = saved.get("user") if isinstance(saved.get("user"), dict) else None
    CLOUD["token_fingerprint"] = saved.get("token_fingerprint") or None
    CLOUD["revoked_reason"] = saved.get("revoked_reason") or None
    if CLOUD["device_token"]:
        CLOUD["session_state"] = "connecting"
    elif saved.get("session_state") == "revoked":
        CLOUD["session_state"] = "revoked"


def save_secure_cloud_state() -> None:
    SECURE_CLOUD_STORE.save({
        "base_url": CLOUD["base_url"], "device_id": DEVICE_ID,
        "device_token": CLOUD["device_token"], "agent_token": CLOUD["agent_token"],
        "user": CLOUD["user"], "last_verified_at": CLOUD["last_verified_at"],
        "token_fingerprint": CLOUD["token_fingerprint"],
        "session_state": CLOUD["session_state"], "revoked_reason": CLOUD["revoked_reason"],
    })


load_secure_cloud_state()
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.getenv(
        "ONU_ALLOWED_ORIGINS",
        "http://localhost:4200,http://127.0.0.1:4200,http://localhost:7400,http://127.0.0.1:7400",
    ).split(",")
    if origin.strip()
}
ALLOWED_ORIGINS.update({f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"})

app = FastAPI(title="ISP Max ONU Provisioner", version=__version__, docs_url="/api/docs", redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def maintenance_token() -> str:
    return os.getenv("ONU_MAINTENANCE_TOKEN", "").strip()


@app.middleware("http")
async def protect_local_agent(request: Request, call_next):
    host = request.headers.get("host", "").split(":", 1)[0].lower()
    if host not in {"127.0.0.1", "localhost"}:
        return JSONResponse({"detail": "El agente solo acepta conexiones locales"}, status_code=400)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin not in ALLOWED_ORIGINS:
            return JSONResponse({"detail": "Origen web no autorizado"}, status_code=403)
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network", "").lower() == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Permissions-Policy"] = (
        "local-network=(self), loopback-network=(self), local-network-access=(self)"
    )
    return response


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobManager:
    STAGES = {
        "network": (4, 10), "reachability": (12, 12), "login": (15, 22), "identity": (24, 24),
        "backup_before": (26, 30), "lan_ports": (32, 40), "wan": (42, 55), "bridge": (42, 55),
        "tr069": (57, 67), "wifi": (69, 79), "time": (80, 82), "remote": (83, 88),
        "save": (89, 92), "verify": (93, 98), "backup_after": (98, 99),
        "cloud": (99, 100), "cloud_inventory": (99, 100), "rollback": (90, 98),
    }

    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()

    def create(self, kind: str, safe_request: dict) -> dict:
        job = JobState(
            id=uuid.uuid4().hex,
            kind=kind,
            status="queued",
            created_at=utc_now(),
            heartbeat_at=utc_now(),
        ).model_dump(mode="json")
        with self._lock:
            self._jobs[job["id"]] = job
        STORE.create(job, safe_request)
        return job

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else STORE.get(job_id)

    def mutate(self, job_id: str, **changes) -> dict:
        with self._lock:
            job = self._jobs[job_id]
            if changes.get("status") == "running":
                changes.setdefault("heartbeat_at", utc_now())
            elif changes.get("status") == "success":
                changes.update({"progress_percent": 100, "stage": "complete", "stage_label": "Configuracion verificada", "retryable": False, "heartbeat_at": utc_now()})
            elif changes.get("status") == "error":
                changes.setdefault("retryable", True)
                changes.setdefault("heartbeat_at", utc_now())
            job.update(changes)
            snapshot = dict(job)
        STORE.update(snapshot)
        return snapshot

    def event(self, job_id: str, step: str, status: str, message: str) -> None:
        event = {"at": utc_now(), "step": step, "status": status, "message": message}
        with self._lock:
            job = self._jobs[job_id]
            job["events"].append(event)
            bounds = self.STAGES.get(step)
            if bounds:
                candidate = bounds[1] if status in {"success", "warning"} else bounds[0]
                job["progress_percent"] = max(int(job.get("progress_percent") or 0), candidate)
            job["stage"] = step
            job["stage_label"] = message
            job["heartbeat_at"] = event["at"]
            if status == "success":
                job["last_completed_step"] = step
            snapshot = dict(job)
        STORE.update(snapshot)


JOBS = JobManager()


@app.on_event("startup")
def start_discovery_service():
    if CLOUD.get("agent_token") and not CLOUD_SESSION_PATH.exists():
        persist_agent_token(str(CLOUD["agent_token"]))
    restore_cloud_session()
    DISCOVERY.start()
    if TR069_WORKER:
        TR069_WORKER.start()
    if ONU_CLOUD_WORKER:
        ONU_CLOUD_WORKER.start()


@app.on_event("shutdown")
def stop_discovery_service():
    DISCOVERY.stop()
    if TR069_WORKER:
        TR069_WORKER.stop()
    if ONU_CLOUD_WORKER:
        ONU_CLOUD_WORKER.stop()


@app.post("/api/maintenance/shutdown", include_in_schema=False)
def maintenance_shutdown(request: Request):
    expected = maintenance_token()
    supplied = request.headers.get("x-onu-maintenance-token", "")
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="Mantenimiento no autorizado")
    # The launcher and scheduled task own the restart. This only provides a clean,
    # authenticated handoff so an elevated instance can update itself.
    threading.Timer(0.5, lambda: os._exit(0)).start()
    return {"ok": True, "status": "stopping"}


class CloudLoginRequest(BaseModel):
    base_url: str = Field(min_length=8, max_length=300)
    username: str = Field(min_length=1, max_length=80)
    password: SecretStr


class CloudReservationRequest(BaseModel):
    ip: str
    client_name: str | None = Field(default=None, max_length=160)
    serial: str | None = Field(default=None, max_length=32)


class CloudJobRequest(BaseModel):
    reservation_token: str | None = None
    mode: Literal["new_client", "restore_same_onu", "replace_onu", "migrate_pon"] = "new_client"
    client_id: int | None = Field(default=None, gt=0)
    ip: str | None = None
    service_mode: Literal["router", "bridge"] = "router"
    client_name: str | None = Field(default=None, max_length=160)
    serial: str | None = Field(default=None, max_length=32)
    model: str | None = Field(default=None, max_length=80)
    mac_address: str | None = Field(default=None, max_length=32)
    zone_id: int | None = None
    plan_id: int | None = None
    upload_mbps: float | None = Field(default=None, gt=0, le=10000)
    download_mbps: float | None = Field(default=None, gt=0, le=10000)
    vlan: int = Field(default=101, ge=1, le=4094)
    inventory: dict | None = None
    host: str = Field(default="192.168.100.1", max_length=64)
    target_pon_index: str | None = Field(default=None, max_length=40)
    operation_reason: str | None = Field(default=None, max_length=300)
    configuration_manifest: dict | None = None


class CloudClientProvisionRequest(BaseModel):
    job_id: str = Field(pattern=r"^[a-f0-9-]{20,50}$")
    ip: str
    service_name: str = Field(min_length=1, max_length=160)
    zone_id: int = Field(gt=0)
    plan_id: int = Field(gt=0)
    upload_mbps: float = Field(gt=0, le=10000)
    download_mbps: float = Field(gt=0, le=10000)


class StartupRequest(BaseModel):
    enabled: bool


class NetworkRangeInput(BaseModel):
    id: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str = Field(min_length=1, max_length=80)
    cidr: str
    vlan: int = Field(default=101, ge=1, le=4094)
    gateway: IPv4Address
    primary_dns: IPv4Address = IPv4Address("8.8.8.8")
    secondary_dns: IPv4Address | None = None
    priority: int = Field(default=100, ge=1, le=9999)
    allocation_start: IPv4Address | None = None
    allocation_end: IPv4Address | None = None
    exclusions: list[IPv4Address] = Field(default_factory=list, max_length=1024)
    active: bool = True

    @field_validator("cidr")
    @classmethod
    def validate_cidr(cls, value: str) -> str:
        network = IPv4Network(value.strip(), strict=True)
        if network.prefixlen < 16 or network.prefixlen > 30:
            raise ValueError("El rango debe estar entre /16 y /30")
        return str(network)

    @model_validator(mode="after")
    def validate_members(self):
        network = IPv4Network(self.cidr)
        for label, address in (("gateway", self.gateway), ("inicio", self.allocation_start), ("fin", self.allocation_end)):
            if address is not None and address not in network:
                raise ValueError(f"{label} debe pertenecer al rango")
        if self.allocation_start and self.allocation_end and self.allocation_start > self.allocation_end:
            raise ValueError("El inicio no puede ser mayor que el final")
        if any(address not in network for address in self.exclusions):
            raise ValueError("Todas las exclusiones deben pertenecer al rango")
        return self


class NetworkRangesRequest(BaseModel):
    ranges: list[NetworkRangeInput] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def validate_capacity(self):
        active = [IPv4Network(item.cidr) for item in self.ranges if item.active]
        if sum(max(0, network.num_addresses - 2) for network in active) > 65_536:
            raise ValueError("Los rangos activos superan 65,536 direcciones")
        if len({item.cidr for item in self.ranges}) != len(self.ranges):
            raise ValueError("No se permiten rangos duplicados")
        return self


def cloud_request(
    path: str, method: str = "GET", body: dict | None = None,
    authenticated: bool = True, timeout_seconds: float = 75,
    agent_authenticated: bool = False, agent_token_override: str | None = None,
):
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if authenticated:
        if agent_authenticated:
            agent_token = agent_token_override or CLOUD["agent_token"]
            if not agent_token:
                raise HTTPException(status_code=401, detail="Empareja ONU Studio con ISP Max")
            headers["x-agent-token"] = str(agent_token)
        else:
            if not CLOUD["token"]:
                raise HTTPException(status_code=401, detail="Conecta ONU Studio con ISP Max")
            headers["x-auth-token"] = str(CLOUD["token"])
    request = urllib.request.Request(
        f'{CLOUD["base_url"]}{path}',
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            detail = payload.get("error") or payload.get("detail") or str(payload)
        except Exception:
            detail = f"ISP Max respondio HTTP {exc.code}"
        raise HTTPException(status_code=exc.code, detail=str(detail)[:600]) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo conectar con ISP Max: {exc}") from exc


def restore_cloud_session() -> bool:
    device_token = CLOUD.get("device_token")
    if not device_token:
        CLOUD["session_state"] = "disconnected"
        return False
    CLOUD["session_state"] = "connecting"
    try:
        result = cloud_request(
            "/auth/device-sessions/refresh", method="POST",
            body={"deviceToken": device_token, "deviceId": DEVICE_ID},
            authenticated=False, timeout_seconds=15,
        )
        if not result.get("token"):
            raise HTTPException(status_code=502, detail="ISP Max no devolvio una sesion valida")
        CLOUD["token"] = result["token"]
        CLOUD["user"] = result.get("user") or CLOUD.get("user")
        CLOUD["last_verified_at"] = utc_now()
        CLOUD["session_state"] = "connected"
        CLOUD["revoked_reason"] = None
        save_secure_cloud_state()
        return True
    except HTTPException as exc:
        CLOUD["token"] = None
        if exc.status_code == 401:
            revoke_local_cloud_state(str(exc.detail))
        else:
            CLOUD["session_state"] = "offline"
        return False


def revoke_local_cloud_state(reason: str = "Credencial revocada desde ISP Max") -> None:
    CLOUD.update({
        "token": None, "agent_token": None, "device_token": None, "user": None,
        "session_state": "revoked", "last_verified_at": utc_now(),
        "token_fingerprint": None, "revoked_reason": str(reason)[:240],
    })
    save_secure_cloud_state()


class Tr069TaskWorker:
    def __init__(self):
        self.agent_id = DEVICE_ID
        self.acs = GenieAcsClient(os.getenv("GENIEACS_NBI_URL", "http://127.0.0.1:7557"))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._state = {
            "running": False,
            "agent_id": self.agent_id,
            "last_poll_at": None,
            "last_task_at": None,
            "last_error": None,
            "completed": 0,
            "failed": 0,
        }

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="tr069-cloud-worker", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def status(self):
        with self._lock:
            return dict(self._state)

    def _update(self, **changes):
        with self._lock:
            self._state.update(changes)

    @staticmethod
    def _error_text(exc: Exception) -> str:
        detail = getattr(exc, "detail", None) or str(exc)
        return re.sub(r"\s+", " ", str(detail)).strip()[:600]

    def _report(self, task_id: str, status: str, *, result=None, error=None, error_code=None, rollback=None, verification=None):
        cloud_request(
            f"/tr069-api/agent/tasks/{task_id}/report",
            method="POST",
            body={
                "agentId": self.agent_id,
                "status": status,
                "result": result,
                "errorMessage": error,
                "errorCode": error_code,
                "rollback": rollback,
                "verification": verification,
            },
            timeout_seconds=20,
            agent_authenticated=True,
        )

    def _run(self):
        self._update(running=True)
        try:
            while not self._stop.is_set():
                if not CLOUD["agent_token"]:
                    self._stop.wait(2.0)
                    continue
                poll_token = str(CLOUD["agent_token"])
                try:
                    response = cloud_request(
                        "/tr069-api/agent/poll",
                        method="POST",
                        body={"agentId": self.agent_id, "agentVersion": __version__},
                        timeout_seconds=12,
                        agent_authenticated=True,
                        agent_token_override=poll_token,
                    )
                    self._update(last_poll_at=utc_now(), last_error=None)
                    task = response.get("task") if isinstance(response, dict) else None
                    if not task:
                        telemetry = response.get("telemetry") if isinstance(response, dict) else None
                        if telemetry and telemetry.get("serial"):
                            try:
                                serial = str(telemetry["serial"])
                                self.acs.set_identity_hints(serial, telemetry.get("identityHints"))
                                snapshot = self.acs.snapshot(serial)
                                device = self.acs.find_device(serial)
                                cloud_request(
                                    f"/tr069-api/agent/devices/{urllib.parse.quote(serial)}/snapshot",
                                    method="POST",
                                    body={
                                        "snapshot": snapshot,
                                        "capabilities": self.acs.capabilities(device),
                                        "diagnosticMode": bool(telemetry.get("diagnosticMode")),
                                    },
                                    timeout_seconds=30,
                                    agent_authenticated=True,
                                )
                                self._update(last_task_at=utc_now(), last_error=None)
                            except Exception as exc:
                                self._update(last_error=self._error_text(exc))
                        self._stop.wait(max(1.0, min(10.0, float(response.get("pollAfterSeconds", 5)))))
                        continue
                    self._update(last_task_at=utc_now())
                    try:
                        self.acs.set_identity_hints(str(task.get("serial") or ""), task.get("identityHints"))
                        last_progress_at = 0.0

                        def progress(stage: str, percent: int):
                            nonlocal last_progress_at
                            now = time.monotonic()
                            if now - last_progress_at < 8 and percent < 90:
                                return
                            last_progress_at = now
                            cloud_request(
                                f"/tr069-api/agent/tasks/{task['id']}/progress",
                                method="POST",
                                body={"stage": stage, "progress": percent},
                                timeout_seconds=15,
                                agent_authenticated=True,
                            )

                        result = self.acs.execute(
                            str(task.get("serial") or ""),
                            str(task.get("action") or ""),
                            task.get("payload") or {},
                            progress=progress,
                        )
                        self._report(
                            task["id"], "success", result=result,
                            rollback=result.get("rollback"), verification=result.get("verification"),
                        )
                        self._update(completed=self.status()["completed"] + 1)
                    except Exception as exc:
                        error = self._error_text(exc)
                        try:
                            self._report(
                                task["id"], "failed", error=error,
                                error_code=getattr(exc, "code", "TR069_AGENT_ERROR"),
                                rollback=getattr(exc, "rollback", None),
                                verification=getattr(exc, "verification", None),
                            )
                        finally:
                            self._update(failed=self.status()["failed"] + 1, last_error=error)
                except HTTPException as exc:
                    error = self._error_text(exc)
                    self._update(last_error=error)
                    if exc.status_code == 401 and CLOUD["agent_token"] == poll_token:
                        revoke_local_cloud_state(error)
                    self._stop.wait(5.0)
                except (GenieAcsError, Exception) as exc:
                    self._update(last_error=self._error_text(exc))
                    self._stop.wait(5.0)
        finally:
            self._update(running=False)


TR069_WORKER = Tr069TaskWorker()


class OnuCloudTaskWorker:
    """Runs Railway-assigned LAN operations through the existing local engine."""

    def __init__(self):
        self.agent_id = DEVICE_ID
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._state = {
            "running": False,
            "agent_id": self.agent_id,
            "last_poll_at": None,
            "last_task_at": None,
            "last_error": None,
            "current_task_id": None,
            "completed": 0,
            "failed": 0,
        }

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="onu-cloud-worker", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def status(self):
        with self._lock:
            return dict(self._state)

    def _update(self, **changes):
        with self._lock:
            self._state.update(changes)

    @staticmethod
    def _error_text(exc: Exception) -> str:
        detail = getattr(exc, "detail", None) or str(exc)
        return re.sub(r"\s+", " ", str(detail)).strip()[:900]

    @staticmethod
    def _metadata() -> dict:
        hostname = socket.gethostname()
        windows_user = os.getenv("USERNAME") or os.getenv("USER") or ""
        return {
            "displayName": os.getenv("ONU_AGENT_DISPLAY_NAME", "").strip() or hostname,
            "hostname": hostname,
            "windowsUser": windows_user,
            "osName": f"{platform.system()} {platform.release()}",
            "architecture": platform.machine(),
            "isAdmin": is_windows_admin(),
        }

    @staticmethod
    def _capabilities() -> dict:
        adapters = list_adapters()
        preferred = next(
            (item for item in adapters if item.get("status") == "Up" and item.get("supported") and "ethernet" in item.get("name", "").lower()),
            next((item for item in adapters if item.get("supported")), adapters[0] if adapters else None),
        )
        return {
            "actions": ["discover", "check", "provision"],
            "supportedDevices": [
                {"model": "EG8141A5", "vendor": "Huawei / Novatech", "writeCertified": True},
                {"model": "F670L", "vendor": "ZTE", "writeCertified": True},
            ],
            "adapters": adapters,
            "networkRanges": STORE.network_ranges(),
            "recommendedLocalNetwork": {
                "adapter_index": preferred.get("index") if preferred else None,
                "address": "192.168.100.10",
                "prefix_length": 24,
            },
            "tr069Worker": TR069_WORKER.status() if TR069_WORKER else None,
        }

    def _report(self, task_id: str, status: str, *, result=None, error=None, error_code=None, local_job_id=None):
        cloud_request(
            f"/agent-api/agent/tasks/{task_id}/report",
            method="POST",
            body={
                "status": status,
                "result": result,
                "errorMessage": error,
                "errorCode": error_code,
                "localJobId": local_job_id,
            },
            timeout_seconds=30,
            agent_authenticated=True,
        )

    def _progress(self, task_id: str, job: dict, last_signature: tuple | None) -> tuple:
        signature = (
            job.get("stage"), job.get("stage_label"), job.get("progress_percent"),
            job.get("status"), job.get("heartbeat_at"),
        )
        if signature == last_signature:
            return signature
        cloud_request(
            f"/agent-api/agent/tasks/{task_id}/progress",
            method="POST",
            body={
                "stage": job.get("stage") or "running",
                "stageLabel": job.get("stage_label") or "Ejecutando en ONU Studio",
                "progress": int(job.get("progress_percent") or 1),
                "localJobId": job.get("id"),
            },
            timeout_seconds=15,
            agent_authenticated=True,
        )
        return signature

    def _execute_local_job(self, task: dict) -> tuple[dict, str | None]:
        action = str(task.get("action") or "")
        payload = task.get("payload") or {}
        if action == "discover":
            result = DISCOVERY.scan()
            return result, None
        if action == "check":
            request = ConnectionCheckRequest.model_validate(payload)
            safe_request = request.model_dump(mode="json")
            if safe_request.get("device"):
                safe_request["device"]["password"] = "***"
            local_job = JOBS.create("check", safe_request)
            runner = threading.Thread(target=run_check, args=(local_job["id"], request), daemon=True)
        elif action == "provision":
            request = ProvisionRequest.model_validate(payload)
            local_job = JOBS.create("provision", request.safe_dump())
            runner = threading.Thread(target=run_provision, args=(local_job["id"], request), daemon=True)
        else:
            raise OnuProvisioningError("La accion remota no es compatible", code="REMOTE_ACTION_UNSUPPORTED", retryable=False)

        runner.start()
        last_signature = None
        while runner.is_alive() and not self._stop.is_set():
            current = JOBS.get(local_job["id"]) or local_job
            try:
                last_signature = self._progress(task["id"], current, last_signature)
            except Exception as exc:
                self._update(last_error=f"No se reporto progreso: {self._error_text(exc)}")
            runner.join(timeout=2.0)
        runner.join()
        current = JOBS.get(local_job["id"]) or local_job
        try:
            self._progress(task["id"], current, last_signature)
        except Exception:
            pass
        if current.get("status") != "success":
            error = current.get("error") or "ONU Studio no pudo completar el trabajo"
            exc = OnuProvisioningError(error, code="LOCAL_JOB_FAILED", retryable=bool(current.get("retryable", True)))
            setattr(exc, "local_job_id", local_job["id"])
            raise exc
        return {
            "localJobId": local_job["id"],
            "events": current.get("events") or [],
            "result": current.get("result") or {},
            "stage": current.get("stage"),
        }, local_job["id"]

    def _run(self):
        self._update(running=True)
        try:
            while not self._stop.is_set():
                if not CLOUD.get("agent_token"):
                    self._stop.wait(2.0)
                    continue
                poll_token = str(CLOUD["agent_token"])
                try:
                    response = cloud_request(
                        "/agent-api/agent/poll",
                        method="POST",
                        body={
                            "agentId": self.agent_id,
                            "agentVersion": __version__,
                            "metadata": self._metadata(),
                            "capabilities": self._capabilities(),
                            "discovery": DISCOVERY.get(),
                        },
                        timeout_seconds=15,
                        agent_authenticated=True,
                        agent_token_override=poll_token,
                    )
                    self._update(last_poll_at=utc_now(), last_error=None)
                    task = response.get("task") if isinstance(response, dict) else None
                    if not task:
                        self._stop.wait(max(1.0, min(10.0, float(response.get("pollAfterSeconds", 3)))))
                        continue
                    task_id = str(task.get("id") or "")
                    self._update(last_task_at=utc_now(), current_task_id=task_id)
                    local_job_id = None
                    try:
                        result, local_job_id = self._execute_local_job(task)
                        self._report(task_id, "success", result=result, local_job_id=local_job_id)
                        self._update(completed=self.status()["completed"] + 1, current_task_id=None, last_error=None)
                    except Exception as exc:
                        error = self._error_text(exc)
                        local_job_id = getattr(exc, "local_job_id", local_job_id)
                        try:
                            self._report(
                                task_id, "failed", error=error,
                                error_code=getattr(exc, "code", "ONU_AGENT_ERROR"),
                                local_job_id=local_job_id,
                            )
                        finally:
                            self._update(failed=self.status()["failed"] + 1, current_task_id=None, last_error=error)
                except HTTPException as exc:
                    error = self._error_text(exc)
                    self._update(last_error=error)
                    if exc.status_code == 401 and CLOUD.get("agent_token") == poll_token:
                        revoke_local_cloud_state(error)
                    self._stop.wait(5.0)
                except Exception as exc:
                    self._update(last_error=self._error_text(exc))
                    self._stop.wait(5.0)
        finally:
            self._update(running=False, current_task_id=None)


ONU_CLOUD_WORKER = OnuCloudTaskWorker()


def persist_agent_token(token: str) -> None:
    CLOUD["agent_token"] = token
    save_secure_cloud_state()
    if ENV_PATH.exists():
        text = ENV_PATH.read_text(encoding="utf-8")
        cleaned = re.sub(r"(?m)^ISP_MAX_AGENT_TOKEN=.*(?:\r?\n)?", "", text)
        if cleaned != text:
            temporary = ENV_PATH.with_suffix(".env.tmp")
            temporary.write_text(cleaned, encoding="utf-8")
            temporary.replace(ENV_PATH)


def resolve_device_credentials(request):
    stored_username = DEFAULT_ZTE_USERNAME if request.device.model == "F670L" else DEFAULT_USERNAME
    stored_password = DEFAULT_ZTE_PASSWORD if request.device.model == "F670L" else DEFAULT_PASSWORD
    password = request.device.password.get_secret_value() if request.device.password else stored_password
    username = request.device.username or stored_username
    if not username:
        raise OnuProvisioningError(
            "Ingresa el usuario tecnico de la ONU",
            code="ONU_USERNAME_REQUIRED",
            retryable=False,
        )
    if not password:
        variable = "ONU_ZTE_DEFAULT_PASSWORD" if request.device.model == "F670L" else "ONU_DEFAULT_PASSWORD"
        raise OnuProvisioningError(f"Ingresa la contrasena tecnica o configura {variable} en el agente")
    updates = {
        "device": request.device.model_copy(
            update={"username": username, "password": SecretStr(password)}
        )
    }
    if isinstance(request, ProvisionRequest) and request.tr069.enabled:
        tr069_password = (
            request.tr069.password.get_secret_value()
            if request.tr069.password else DEFAULT_TR069_PASSWORD
        )
        connection_request_password = (
            request.tr069.connection_request_password.get_secret_value()
            if request.tr069.connection_request_password else DEFAULT_TR069_CONNECTION_REQUEST_PASSWORD
        )
        if not tr069_password or not connection_request_password:
            raise OnuProvisioningError(
                "Configura las credenciales TR-069 protegidas en el agente local"
            )
        updates["tr069"] = request.tr069.model_copy(
            update={
                "password": SecretStr(tr069_password),
                "connection_request_password": SecretStr(connection_request_password),
            }
        )
    return request.model_copy(update=updates)


def prepare_network(job_id: str, request, emit=None) -> dict:
    report = emit or (lambda step, status, message: JOBS.event(job_id, step, status, message))
    report("network", "running", "Preparando la tarjeta Ethernet")
    network = ensure_ipv4_address(
        request.local_network.adapter_index,
        request.local_network.address,
        request.local_network.prefix_length,
    )
    change_label = "agregada" if network["changed"] else "ya configurada"
    report(
        "network", "success",
        f"IP {network['address']}/{network['prefix_length']} {change_label} en {network['adapter']['name']}",
    )
    probe = probe_http(request.device.host, adapter_index=request.local_network.adapter_index)
    if not probe["reachable"]:
        raise NetworkError(f"La ONU {request.device.host} no responde por HTTP")
    report("reachability", "success", f"ONU accesible en {request.device.host} ({probe['latency_ms']} ms)")
    return {"adapter": network, "probe": probe}


def sanitize_local_error(exc: Exception, request: ProvisionRequest) -> str:
    message = str(exc)
    protected = [
        request.device.password.get_secret_value() if request.device.password else "",
        request.wifi.password.get_secret_value(),
        request.tr069.password.get_secret_value() if request.tr069.password else "",
        request.tr069.connection_request_password.get_secret_value()
        if request.tr069.connection_request_password else "",
    ]
    for secret in protected:
        if secret:
            message = message.replace(secret, "***")
    message = re.sub(
        r"(password|passwd|contrasena|clave|secret)\s*[:=]\s*[^\s,;]+",
        r"\1=***", message, flags=re.I,
    )
    return re.sub(r"\s+", " ", message).strip()[:1000]


def build_configuration_manifest(request: ProvisionRequest, result: dict | None = None) -> dict:
    inventory = (result or {}).get("inventory") or {}
    identity = inventory.get("identity") or {}
    device = inventory.get("device") or {}
    return {
        "schemaVersion": 1, "serviceMode": request.service_mode,
        "serial": identity.get("serial") or (result or {}).get("serial"),
        "model": device.get("model") or request.device.model,
        "firmware": device.get("software_version"),
        "vlan": request.wan.vlan_id,
        "wan": {
            "mode": "static" if request.service_mode == "router" else "bridge",
            "ip": str(request.wan.ip_address) if request.service_mode == "router" else None,
            "gateway": str(request.wan.gateway) if request.service_mode == "router" else None,
            "nat": request.wan.nat_enabled if request.service_mode == "router" else False,
        },
        "lanPorts": request.wan.bind_lan_ports,
        "ssidBinding": request.wan.bind_ssid1 if request.service_mode == "router" else False,
        "wifi": {"enabled": request.wifi.enabled, "ssid": request.wifi.ssid} if request.service_mode == "router" else None,
        "channels": {
            "tr069": request.service_mode == "router" and request.tr069.enabled,
            "omci": True, "webLocal": True,
        },
        "verified": bool(result and result.get("verification")),
        "verifiedAt": utc_now() if result and result.get("verification") else None,
    }


def local_error_metadata(exc: Exception) -> tuple[str, bool]:
    code = getattr(exc, "code", None)
    if not code:
        code = re.sub(r"[^A-Z0-9]+", "_", exc.__class__.__name__.upper()).strip("_")
    return code[:80] or "LOCAL_PROVISIONING_ERROR", bool(getattr(exc, "retryable", True))


def update_cloud_checkpoint(
    request: ProvisionRequest, *, stage: str, local_status: str,
    last_completed_step: str | None, message: str, status: str = "in_progress",
    error_code: str | None = None, retryable: bool | None = None,
) -> str | None:
    if not request.cloud_job_id or not CLOUD["token"]:
        return None
    step_key = stage.removeprefix("local_")
    bounds = JobManager.STAGES.get(step_key, (0, 0))
    body = {
        "status": status,
        "stage": stage,
        "agentVersion": __version__,
        "agentHeartbeat": True,
        "localStatus": local_status,
        "lastCompletedStep": last_completed_step,
        "errorMessage": message if local_status == "error" else None,
        "errorCode": error_code,
        "retryable": retryable,
        "progressPercent": bounds[1] if local_status != "error" else bounds[0],
        "stageLabel": message,
        "step": {
            "status": "error" if local_status == "error" else "complete",
            "message": message[:500],
            "source": "onu_studio",
        },
    }
    try:
        cloud_request(
            f"/provisioning/jobs/{request.cloud_job_id}", method="PATCH", body=body,
            timeout_seconds=8,
        )
        return None
    except Exception as cloud_error:
        detail = getattr(cloud_error, "detail", None) or str(cloud_error)
        return str(detail)[:500]


def run_check(job_id: str, raw_request: ConnectionCheckRequest) -> None:
    JOBS.mutate(job_id, status="running", started_at=utc_now())
    try:
        request = resolve_device_credentials(raw_request)
        network = prepare_network(job_id, request) if request.prepare_adapter else {
            "probe": probe_http(request.device.host, adapter_index=request.local_network.adapter_index)
        }
        if not network["probe"]["reachable"]:
            raise NetworkError(f"La ONU {request.device.host} no responde por HTTP")
        controller = create_controller(
            request.device,
            BACKUP_DIR,
            HEADLESS,
            adapter_index=request.local_network.adapter_index,
        )
        result = controller.check(lambda step, status, message: JOBS.event(job_id, step, status, message))
        result["network"] = network
        JOBS.mutate(job_id, status="success", result=result, finished_at=utc_now())
    except Exception as exc:
        LOGGER.exception("Fallo la comprobacion local de la ONU")
        JOBS.event(job_id, "failed", "error", str(exc))
        JOBS.mutate(job_id, status="error", error=str(exc), finished_at=utc_now())


def run_provision(job_id: str, raw_request: ProvisionRequest) -> None:
    JOBS.mutate(job_id, status="running", started_at=utc_now())
    request = raw_request
    last_completed_step: str | None = None
    cloud_warning_reported = False
    try:
        request = resolve_device_credentials(raw_request)

        def emit(step: str, status: str, message: str) -> None:
            nonlocal last_completed_step, cloud_warning_reported
            JOBS.event(job_id, step, status, message)
            if status == "success":
                last_completed_step = step
                warning = update_cloud_checkpoint(
                    request, stage=f"local_{step}", local_status="running",
                    last_completed_step=last_completed_step, message=message,
                )
                if warning and not cloud_warning_reported:
                    JOBS.event(job_id, "cloud", "warning", f"Railway no recibio el checkpoint: {warning}")
                    cloud_warning_reported = True

        network = prepare_network(job_id, request, emit)
        controller = create_controller(
            request.device,
            BACKUP_DIR,
            HEADLESS,
            adapter_index=request.local_network.adapter_index,
        )
        result = controller.provision(request, emit)
        result["network"] = network
        if request.cloud_job_id:
            try:
                restored_service = request.service_operation == "restore_same_onu"
                cloud_request(
                    f"/provisioning/jobs/{request.cloud_job_id}",
                    method="PATCH",
                    body={
                        "status": "complete" if restored_service else "waiting_optical",
                        "stage": "service_restored" if restored_service else "onu_configured",
                        "cutoverStatus": "not_required" if restored_service else "waiting_new_onu",
                        "agentVersion": __version__, "agentHeartbeat": True,
                        "localStatus": "success", "lastCompletedStep": "verify",
                        "retryable": False, "errorCode": None, "errorMessage": None,
                        "configurationManifest": build_configuration_manifest(request, result),
                        "step": {"status": "complete", "message": "Servicio existente restaurado sin modificar WispHub, facturas, IP ni MikroTik" if restored_service else "WAN, WiFi y acceso remoto configurados por ONU Studio", "source": "onu_studio"},
                    },
                )
                JOBS.event(job_id, "cloud", "success", "Expediente actualizado en ISP Max")
            except Exception as cloud_error:
                JOBS.event(job_id, "cloud", "warning", f"Configurada localmente; no se actualizo Railway: {cloud_error}")
            try:
                cloud_request(
                    f"/provisioning/jobs/{request.cloud_job_id}/onu-inventory",
                    method="POST",
                    body={
                        "phase": "post_provision", "agentVersion": __version__,
                        "host": str(request.device.host), "inventory": result["inventory"],
                    },
                )
                JOBS.event(job_id, "cloud_inventory", "success", "Inventario final sincronizado con OLT e ISP Max")
            except Exception as cloud_error:
                JOBS.event(job_id, "cloud_inventory", "warning", f"Inventario local guardado; sincronizacion pendiente: {cloud_error}")
        JOBS.mutate(job_id, status="success", result=result, finished_at=utc_now())
    except Exception as exc:
        LOGGER.exception("Fallo el aprovisionamiento local de la ONU")
        safe_error = sanitize_local_error(exc, request)
        error_code, retryable = local_error_metadata(exc)
        JOBS.event(job_id, "failed", "error", safe_error)
        cloud_warning = update_cloud_checkpoint(
            request, stage="local_failed", local_status="error",
            last_completed_step=last_completed_step, message=safe_error,
            status="partial", error_code=error_code, retryable=retryable,
        )
        if cloud_warning:
            JOBS.event(job_id, "cloud", "warning", f"El error local no se pudo reportar a Railway: {cloud_warning}")
        JOBS.mutate(job_id, status="error", error=safe_error, finished_at=utc_now())


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "ISP Max ONU Provisioner",
        "version": __version__,
        "admin": is_windows_admin(),
        "headless": HEADLESS,
        "port": PORT,
        "mode": os.getenv("ONU_LAUNCH_MODE", "development"),
        "tr069_worker": TR069_WORKER.status(),
        "cloud_worker": ONU_CLOUD_WORKER.status(),
    }


@app.get("/api/discovery")
def discovery():
    return DISCOVERY.get()


@app.post("/api/discovery/scan")
async def scan_discovery():
    return await asyncio.to_thread(DISCOVERY.scan)


@app.get("/api/startup")
def get_startup():
    return startup_status()


@app.get("/api/installation")
def get_installation():
    return installation_status()


@app.post("/api/startup")
def configure_startup(payload: StartupRequest):
    try:
        return set_startup(payload.enabled)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/settings/network-ranges")
def get_network_ranges():
    return {"ranges": STORE.network_ranges()}


@app.put("/api/settings/network-ranges")
def put_network_ranges(payload: NetworkRangesRequest):
    ranges = [item.model_dump(mode="json") for item in payload.ranges]
    return {"ranges": STORE.replace_network_ranges(ranges)}


@app.get("/api/defaults")
def defaults():
    adapters = list_adapters()
    preferred = next(
        (item for item in adapters if item.get("status") == "Up" and item.get("supported") and "ethernet" in item.get("name", "").lower()),
        next((item for item in adapters if item.get("supported")), adapters[0] if adapters else None),
    )
    return {
        "device": {"host": "192.168.100.1", "model": "EG8141A5", "username": DEFAULT_USERNAME, "has_password": bool(DEFAULT_PASSWORD)},
        "supported_devices": [
            {"model": "EG8141A5", "vendor": "Huawei / Novatech", "username": DEFAULT_USERNAME, "has_password": bool(DEFAULT_PASSWORD), "write_certified": True},
            {"model": "F670L", "vendor": "ZTE", "username": DEFAULT_ZTE_USERNAME, "has_password": bool(DEFAULT_ZTE_PASSWORD), "write_certified": True},
        ],
        "local_network": {"adapter_index": preferred.get("index") if preferred else None, "address": "192.168.100.10", "prefix_length": 24},
        "wan": {"vlan_id": 101, "priority": 0, "ip_address": "192.168.16.245", "subnet_mask": "255.255.255.0", "gateway": "192.168.16.1", "primary_dns": "8.8.8.8", "secondary_dns": "", "mtu": 1500},
        "wifi": {"ssid": "test", "password": "", "max_clients": 32},
        "tr069": {
            "enabled": DEFAULT_TR069_ENABLED,
            "acs_url": DEFAULT_TR069_ACS_URL,
            "username": DEFAULT_TR069_USERNAME,
            "has_password": bool(DEFAULT_TR069_PASSWORD),
            "connection_request_username": DEFAULT_TR069_CONNECTION_REQUEST_USERNAME,
            "has_connection_request_password": bool(DEFAULT_TR069_CONNECTION_REQUEST_PASSWORD),
            "periodic_inform_interval": DEFAULT_TR069_PERIODIC_INFORM_INTERVAL,
        },
        "remote_access": {"source": "192.168.16.1/32", "http": True},
        "adapters": adapters,
        "cloud": {
            "base_url": CLOUD["base_url"], "connected": bool(CLOUD["token"]),
            "agent_paired": bool(CLOUD["agent_token"]), "user": CLOUD["user"],
            "session_state": CLOUD["session_state"], "last_verified_at": CLOUD["last_verified_at"],
            "token_fingerprint": CLOUD["token_fingerprint"], "revoked_reason": CLOUD["revoked_reason"],
            "credential_protection": "Windows DPAPI CurrentUser",
            "tr069_worker": TR069_WORKER.status(), "cloud_worker": ONU_CLOUD_WORKER.status(),
        },
    }


@app.get("/api/cloud/status")
def cloud_status():
    return {
        "connected": bool(CLOUD["token"]), "agent_paired": bool(CLOUD["agent_token"]),
        "base_url": CLOUD["base_url"], "user": CLOUD["user"],
        "session_state": CLOUD["session_state"], "last_verified_at": CLOUD["last_verified_at"],
        "remembered": bool(CLOUD["device_token"]), "token_fingerprint": CLOUD["token_fingerprint"],
        "revoked_reason": CLOUD["revoked_reason"], "credential_protection": "Windows DPAPI CurrentUser",
        "tr069_worker": TR069_WORKER.status(), "cloud_worker": ONU_CLOUD_WORKER.status(),
    }


@app.post("/api/cloud/login")
def cloud_login(payload: CloudLoginRequest):
    parsed = urllib.parse.urlparse(payload.base_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL de ISP Max invalida")
    CLOUD["base_url"] = payload.base_url.strip().rstrip("/")
    result = cloud_request(
        "/auth/login",
        method="POST",
        body={"username": payload.username.strip(), "password": payload.password.get_secret_value()},
        authenticated=False,
    )
    CLOUD["token"] = result.get("token")
    CLOUD["user"] = result.get("user")
    if not CLOUD["token"]:
        raise HTTPException(status_code=502, detail="ISP Max no devolvio una sesion valida")
    if str((CLOUD["user"] or {}).get("role") or "") not in {"admin", "super_admin"}:
        CLOUD.update({"token": None, "user": None, "session_state": "disconnected"})
        raise HTTPException(status_code=403, detail="ONU Studio requiere una cuenta admin o super_admin")
    trusted = cloud_request(
        "/auth/device-sessions", method="POST",
        body={"deviceId": DEVICE_ID, "deviceName": "ONU Studio ISP Max"}, timeout_seconds=15,
    )
    CLOUD["device_token"] = trusted.get("deviceToken")
    if not CLOUD["device_token"]:
        raise HTTPException(status_code=502, detail="ISP Max no devolvio una sesion recordable")
    paired = cloud_request(
        "/agent-api/agents/pair",
        method="POST",
        body={
            "agentId": ONU_CLOUD_WORKER.agent_id,
            "agentVersion": __version__,
            "displayName": OnuCloudTaskWorker._metadata()["displayName"],
        },
        timeout_seconds=15,
    )
    agent_token = str(paired.get("token") or "")
    if len(agent_token) < 32:
        raise HTTPException(status_code=502, detail="ISP Max no devolvio una credencial de agente valida")
    CLOUD["agent_token"] = agent_token
    CLOUD["token_fingerprint"] = str(paired.get("tokenFingerprint") or "") or None
    CLOUD["last_verified_at"] = utc_now()
    CLOUD["session_state"] = "connected"
    CLOUD["revoked_reason"] = None
    persist_agent_token(agent_token)
    return {
        "connected": True, "agent_paired": True, "remembered": True,
        "base_url": CLOUD["base_url"], "user": CLOUD["user"],
        "session_state": CLOUD["session_state"], "last_verified_at": CLOUD["last_verified_at"],
        "token_fingerprint": CLOUD["token_fingerprint"],
        "credential_protection": "Windows DPAPI CurrentUser",
    }


@app.post("/api/cloud/logout")
def cloud_logout():
    device_token = CLOUD.get("device_token")
    access_token = CLOUD.get("token")
    if device_token:
        try:
            cloud_request(
                "/auth/device-sessions/revoke", method="POST",
                body={"deviceToken": device_token}, authenticated=False, timeout_seconds=10,
            )
        except HTTPException:
            pass
    if access_token:
        try:
            cloud_request("/auth/logout", method="POST", timeout_seconds=10)
        except HTTPException:
            pass
    CLOUD.update({"token": None, "agent_token": None, "device_token": None, "user": None,
                  "session_state": "disconnected", "last_verified_at": None,
                  "token_fingerprint": None, "revoked_reason": None})
    SECURE_CLOUD_STORE.delete()
    return {"connected": False, "session_state": "disconnected"}


@app.get("/api/cloud/ip-catalog")
def cloud_ip_catalog(cidr: str = ""):
    configured = [item for item in STORE.network_ranges() if item["active"]]
    if cidr:
        configured = [item for item in configured if item["cidr"] == cidr]
    if not configured:
        return {"timestamp": None, "source": "local", "stale": False, "networks": [], "reservations": [], "rows": [], "recommended": None}
    result = cloud_request(
        "/provisioning/ip-catalog/query", method="POST",
        body={"cidrs": [item["cidr"] for item in configured]},
    )
    policies = {item["cidr"]: item for item in configured}
    filtered = []
    for row in result.get("rows", []):
        policy = policies.get(row.get("cidr"))
        if not policy:
            continue
        address = IPv4Address(row["ip"])
        if policy.get("allocation_start") and address < IPv4Address(policy["allocation_start"]):
            continue
        if policy.get("allocation_end") and address > IPv4Address(policy["allocation_end"]):
            continue
        if row["ip"] in set(policy.get("exclusions") or []) or row["ip"] == policy["gateway"]:
            continue
        filtered.append({**row, "rangeName": policy["name"], "rangePriority": policy["priority"], "recommended": False})
    filtered.sort(key=lambda row: (row["rangePriority"], IPv4Address(row["ip"])))
    if filtered:
        filtered[0]["recommended"] = True
    result["rows"] = filtered
    result["recommended"] = filtered[0] if filtered else None
    result["networks"] = [{
        **network,
        "name": policies.get(network.get("cidr"), {}).get("name", network.get("cidr")),
        "available": sum(1 for row in filtered if row.get("cidr") == network.get("cidr")),
    } for network in result.get("networks", []) if network.get("cidr") in policies]
    return result


@app.get("/api/cloud/commercial-catalog")
def cloud_commercial_catalog():
    return cloud_request("/provisioning/commercial-catalog")


@app.get("/api/cloud/clients")
def cloud_existing_clients(q: str = ""):
    if len(q.strip()) < 2:
        return []
    return cloud_request(f"/provisioning/clients?q={urllib.parse.quote(q.strip())}")


@app.get("/api/cloud/jobs/{job_id}")
def cloud_provisioning_job(job_id: str):
    return cloud_request(f"/provisioning/jobs/{job_id}")


@app.post("/api/cloud/reservations", status_code=201)
def cloud_reservation(payload: CloudReservationRequest):
    cidrs = [item["cidr"] for item in STORE.network_ranges() if item["active"]]
    return cloud_request(
        "/provisioning/reservations",
        method="POST",
        body={"ip": payload.ip, "clientName": payload.client_name, "serial": payload.serial, "cidrs": cidrs},
    )


@app.post("/api/cloud/jobs", status_code=201)
def cloud_job(payload: CloudJobRequest):
    if payload.mode == "new_client" and payload.service_mode == "router" and not payload.reservation_token:
        raise HTTPException(status_code=400, detail="El cliente nuevo requiere una reserva de IP")
    operation_key = payload.reservation_token or str(payload.client_id or f"{payload.service_mode}-pending")
    if payload.mode == "migrate_pon":
        operation_key = f"{operation_key}:{payload.target_pon_index or 'missing-pon'}"
    job = cloud_request(
        "/provisioning/jobs",
        method="POST",
        body={
            "source": "onu_studio", "mode": payload.mode,
            "serviceMode": payload.service_mode,
            "idempotencyKey": f"onu-studio:{payload.mode}:{operation_key}:{payload.serial or 'pending'}",
            "reservationToken": payload.reservation_token,
            "clientIdServicio": payload.client_id,
            "ip": payload.ip, "clientName": payload.client_name, "serial": payload.serial,
            "model": payload.model, "macAddress": payload.mac_address,
            "zoneId": payload.zone_id, "planId": payload.plan_id,
            "uploadMbps": payload.upload_mbps, "downloadMbps": payload.download_mbps, "vlan": payload.vlan,
            "targetPonIndex": payload.target_pon_index, "operationReason": payload.operation_reason,
            "configurationManifest": payload.configuration_manifest,
        },
    )
    if payload.inventory and job.get("id"):
        try:
            cloud_request(
                f'/provisioning/jobs/{job["id"]}/onu-inventory',
                method="POST",
                body={
                    "phase": "pre_provision", "agentVersion": __version__,
                    "host": payload.host, "inventory": payload.inventory,
                },
            )
            job["agentInventoryAvailable"] = True
        except HTTPException as exc:
            job["agentInventoryWarning"] = str(exc.detail)
    return job


@app.post("/api/cloud/provision-client")
def cloud_provision_client(payload: CloudClientProvisionRequest):
    return cloud_request(
        "/client-provisioning",
        method="POST",
        body={
            "jobId": payload.job_id, "ip": payload.ip, "serviceName": payload.service_name,
            "zoneId": payload.zone_id, "planId": payload.plan_id,
            "uploadMbps": payload.upload_mbps, "downloadMbps": payload.download_mbps,
        },
    )


@app.post("/api/check", status_code=202)
async def check_connection(payload: ConnectionCheckRequest):
    safe_request = payload.model_dump(mode="json")
    safe_request["device"]["password"] = "***"
    job = JOBS.create("check", safe_request)
    asyncio.create_task(asyncio.to_thread(run_check, job["id"], payload))
    return {"job_id": job["id"], "status": job["status"]}


@app.post("/api/provision", status_code=202)
async def provision(payload: ProvisionRequest):
    job = JOBS.create("provision", payload.safe_dump())
    asyncio.create_task(asyncio.to_thread(run_provision, job["id"], payload))
    return {"job_id": job["id"], "status": job["status"]}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado")
    return job


@app.get("/api/jobs/{job_id}/retry-template")
def get_retry_template(job_id: str):
    template = STORE.retry_template(job_id)
    if not template:
        raise HTTPException(status_code=404, detail="Trabajo no encontrado")
    if template["kind"] != "provision" or template["status"] != "error":
        raise HTTPException(status_code=409, detail="Este trabajo no requiere recuperacion")
    return template


@app.get("/api/history")
def history(limit: int = 20):
    return STORE.recent(limit)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=PORT, reload=False)
