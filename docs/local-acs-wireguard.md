# ACS local por WireGuard

## Estado validado

- MikroTik: CCR1036-12G-4S con RouterOS 7.9.2.
- OLT: `172.16.30.1` por `vlan99Admin`; no comparte rutas con WireGuard.
- Red ONU: `192.168.16.0/24` por VLAN 101.
- WireGuard MikroTik: `wg-ispmax-acs`, `10.254.250.1/30`, UDP 51820.
- Origen local actual: `192.168.13.20` por `bridge1`, permitido por una regla especifica `ISPMax ACS - WireGuard desde MAX`.
- WireGuard Windows: servicio automatico `WireGuardTunnel$ispmax-acs`, IP `10.254.250.2/32`.
- ACS CWMP: `http://10.254.250.2:7547/`.
- GenieACS NBI: `http://127.0.0.1:7557/`, solamente local.
- MongoDB: red interna de Docker, sin puerto publicado en Windows.

El tunel solo instala rutas hacia `10.254.250.1/32` y `192.168.16.0/24`. La ruta predeterminada de Windows sigue usando Wi-Fi, por lo que el trafico general y la conexion existente con la OLT no pasan por WireGuard.

## Respaldos

- MikroTik binario: `ispmax-pre-wireguard-20260810-015258.backup`.
- MikroTik export sin secretos: `ispmax-pre-wireguard-20260810-015258.rsc`.
- ONU piloto: `onu-provisioner/data/tr069-backups/HWTC26D9D8AF-20260810T022340Z.json`.
- Docker Desktop: `%APPDATA%/Docker/settings-store.json.ispmax-pre-autostart.bak`.

## Operacion local

Desde la raiz del proyecto:

```powershell
docker compose -f tr069-acs\docker-compose.local.yml --env-file tr069-acs\.env.local ps
docker compose -f tr069-acs\docker-compose.local.yml --env-file tr069-acs\.env.local logs --tail 100 genieacs
```

La configuracion usa volumen persistente para MongoDB y politica `unless-stopped`. Docker Desktop y WireGuard inician con Windows.

## Reversion segura

Primero detener el ACS, sin borrar la base de datos:

```powershell
docker compose -f tr069-acs\docker-compose.local.yml --env-file tr069-acs\.env.local stop
```

En MikroTik, deshabilitar solamente los elementos identificados:

```routeros
/ip firewall filter disable [find where comment~"ISPMax ACS"]
/interface wireguard peers disable [find where comment="ISPMax ACS - PC local"]
/ip address disable [find where comment="ISPMax ACS - IP WireGuard"]
/interface wireguard disable [find where name="wg-ispmax-acs"]
```

No modificar `vlan99Admin`, `vlan101`, las reglas `adminolt` ni la ruta predeterminada.

## Piloto ONU

La ONU `HWTC26D9D8AF` tiene CWMP habilitado, Inform cada 900 segundos y credenciales protegidas. Todavia se encuentra en estado O1, sin señal optica y sin WAN. El primer Inform solo debe esperarse despues de autorizarla en la OLT y crear una WAN `TR069_INTERNET` con conectividad hacia `10.254.250.2:7547`.
