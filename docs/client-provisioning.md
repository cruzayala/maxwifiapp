# Alta verificada de clientes

La pantalla `/clients/new` usa `POST /client-provisioning`. El navegador no escribe
directamente en WispHub ni en MikroTik.

## Flujo

1. Valida zona, plan, nombre, IP y velocidades.
2. Comprueba que la IP pertenezca a un rango de clientes configurado.
3. Comprueba la conexion con MikroTik antes de crear en WispHub.
4. Busca la IP en WispHub y en Simple Queues para impedir duplicados.
5. Crea el cliente mediante el endpoint oficial de WispHub y espera su tarea.
6. Verifica que el servicio aparezca en el listado de WispHub.
7. Verifica la Simple Queue; si WispHub no la creo, ISP max la crea directamente.
8. Guarda el cliente inmediatamente en SQLite y registra la operacion en la bitacora.

## Reintentos

La operacion es idempotente por IP. Si WispHub creo el cliente pero MikroTik fallo, el
mismo formulario puede reintentarse. El servidor solo acepta el reintento cuando IP,
nombre, zona y plan coinciden exactamente con el cliente existente en WispHub.

Una IP ocupada por otro cliente, por otro plan o por una cola sin cliente se rechaza y no
produce escrituras.

## Rangos permitidos

Los rangos heredados se leen de `MIKROTIK_CLIENT_NETWORKS` y aceptan `MIKROTIK_CLIENT_CIDRS` como alias. ONU Studio envia sus rangos locales en cada consulta. Si no existe ninguna variable, se usan:

```dotenv
MIKROTIK_CLIENT_NETWORKS="192.168.10.0/23,192.168.12.0/22,192.168.16.0/24"
```
