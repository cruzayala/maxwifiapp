from __future__ import annotations

from ipaddress import IPv4Address, IPv4Interface, IPv4Network
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, IPvAnyAddress, SecretStr, field_validator, model_validator


class DeviceSettings(BaseModel):
    host: IPvAnyAddress = IPv4Address("192.168.100.1")
    model: Literal["EG8141A5", "F670L"] = "EG8141A5"
    username: str = "telecomadmin"
    password: SecretStr | None = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 64:
            raise ValueError("El usuario de la ONU no es valido")
        return value


class LocalNetworkSettings(BaseModel):
    adapter_index: int = Field(gt=0)
    address: IPv4Address = IPv4Address("192.168.100.10")
    prefix_length: int = Field(default=24, ge=8, le=30)

    @model_validator(mode="after")
    def validate_device_network(self) -> "LocalNetworkSettings":
        interface = IPv4Interface(f"{self.address}/{self.prefix_length}")
        if IPv4Address("192.168.100.1") not in interface.network:
            raise ValueError("La IP local debe alcanzar la red de administracion 192.168.100.0")
        return self


class WanSettings(BaseModel):
    vlan_id: int = Field(default=101, ge=1, le=4094)
    priority: int = Field(default=0, ge=0, le=7)
    ip_address: IPv4Address = IPv4Address("192.168.16.245")
    subnet_mask: IPv4Address = IPv4Address("255.255.255.0")
    gateway: IPv4Address = IPv4Address("192.168.16.1")
    primary_dns: IPv4Address = IPv4Address("8.8.8.8")
    secondary_dns: IPv4Address | None = None
    mtu: int = Field(default=1500, ge=576, le=1540)
    nat_enabled: bool = True
    bind_lan_ports: list[int] = Field(default_factory=lambda: [1, 2, 3, 4])
    bind_ssid1: bool = True

    @field_validator("bind_lan_ports")
    @classmethod
    def validate_lan_ports(cls, value: list[int]) -> list[int]:
        ports = sorted(set(value))
        if any(port < 1 or port > 4 for port in ports):
            raise ValueError("Solo se admiten los puertos LAN1 a LAN4")
        if not ports:
            raise ValueError("Debe vincular al menos un puerto LAN")
        return ports

    @model_validator(mode="after")
    def validate_wan_network(self) -> "WanSettings":
        try:
            network = IPv4Network(f"{self.ip_address}/{self.subnet_mask}", strict=False)
        except ValueError as exc:
            raise ValueError("La mascara WAN no es valida") from exc
        if self.gateway not in network:
            raise ValueError("La puerta de enlace debe pertenecer a la misma red WAN")
        if self.ip_address in {network.network_address, network.broadcast_address}:
            raise ValueError("La IP WAN no puede ser la direccion de red o broadcast")
        return self


class WifiSettings(BaseModel):
    enabled: bool = True
    ssid: str = Field(default="test", min_length=1, max_length=32)
    password: SecretStr = SecretStr("12345678")
    broadcast: bool = True
    wmm_enabled: bool = True
    wps_enabled: bool = False
    max_clients: int = Field(default=32, ge=1, le=32)

    @field_validator("ssid")
    @classmethod
    def validate_ssid(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre WiFi es obligatorio")
        return value

    @field_validator("password")
    @classmethod
    def validate_wifi_password(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        is_hex64 = len(raw) == 64 and all(char in "0123456789abcdefABCDEF" for char in raw)
        if not is_hex64 and not 8 <= len(raw) <= 63:
            raise ValueError("La clave WiFi debe tener entre 8 y 63 caracteres")
        return value


class Tr069Settings(BaseModel):
    enabled: bool = True
    acs_url: str = "http://10.254.250.2:7547/"
    username: str = "ispmax-cpe"
    password: SecretStr | None = None
    connection_request_username: str = "ispmax-connection-request"
    connection_request_password: SecretStr | None = None
    periodic_inform_interval: int = Field(default=900, ge=60, le=86400)

    @field_validator("acs_url")
    @classmethod
    def validate_acs_url(cls, value: str) -> str:
        value = value.strip()
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("La URL del ACS debe usar HTTP o HTTPS")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("La URL del ACS no puede contener credenciales, consulta ni fragmento")
        return value if value.endswith("/") else f"{value}/"

    @field_validator("username", "connection_request_username")
    @classmethod
    def validate_auth_username(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 64:
            raise ValueError("El usuario TR-069 no es valido")
        return value


class RemoteAccessSettings(BaseModel):
    enabled: bool = True
    source: str = "192.168.16.1/32"
    http: bool = True
    telnet: bool = False
    ssh: bool = False
    ftp: bool = False
    icmp: bool = False

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        try:
            network = IPv4Network(value.strip(), strict=False)
        except ValueError as exc:
            raise ValueError("El origen remoto debe tener formato IP/mask, por ejemplo 192.168.16.1/32") from exc
        return str(network)

    @model_validator(mode="after")
    def require_restricted_http(self) -> "RemoteAccessSettings":
        if self.enabled and not self.http:
            raise ValueError("El acceso remoto requiere HTTP habilitado")
        if self.telnet or self.ssh or self.ftp:
            raise ValueError("Este perfil seguro no habilita Telnet, SSH ni FTP")
        return self


class ProvisionRequest(BaseModel):
    device: DeviceSettings = Field(default_factory=DeviceSettings)
    local_network: LocalNetworkSettings
    wan: WanSettings = Field(default_factory=WanSettings)
    wifi: WifiSettings = Field(default_factory=WifiSettings)
    tr069: Tr069Settings = Field(default_factory=Tr069Settings)
    remote_access: RemoteAccessSettings = Field(default_factory=RemoteAccessSettings)
    save_configuration: bool = True
    create_backups: bool = True
    replace_conflicting_wan: bool = False
    cloud_job_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{20,50}$")
    service_operation: Literal["new_client", "restore_same_onu", "replace_onu", "migrate_pon"] = "new_client"
    service_mode: Literal["router", "bridge"] = "router"

    def safe_dump(self) -> dict:
        payload = self.model_dump(mode="json")
        payload["device"]["password"] = "***"
        payload["wifi"]["password"] = "***"
        payload["tr069"]["password"] = "***"
        payload["tr069"]["connection_request_password"] = "***"
        return payload


class ConnectionCheckRequest(BaseModel):
    device: DeviceSettings = Field(default_factory=DeviceSettings)
    local_network: LocalNetworkSettings
    prepare_adapter: bool = True


class JobEvent(BaseModel):
    at: str
    step: str
    status: Literal["pending", "running", "success", "warning", "error"]
    message: str


class JobState(BaseModel):
    id: str
    kind: Literal["check", "provision"]
    status: Literal["queued", "running", "success", "error"]
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    events: list[JobEvent] = Field(default_factory=list)
    result: dict | None = None
    error: str | None = None
    stage: str = "queued"
    stage_label: str = "Trabajo en cola"
    progress_percent: int = Field(default=0, ge=0, le=100)
    heartbeat_at: str | None = None
    last_completed_step: str | None = None
    retryable: bool = True
