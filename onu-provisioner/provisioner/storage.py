from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class JobStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS provisioning_jobs (
                  id TEXT PRIMARY KEY,
                  kind TEXT NOT NULL,
                  status TEXT NOT NULL,
                  device_host TEXT NOT NULL,
                  wan_ip TEXT,
                  ssid TEXT,
                  request_json TEXT NOT NULL,
                  events_json TEXT NOT NULL DEFAULT '[]',
                  result_json TEXT,
                  error TEXT,
                  created_at TEXT NOT NULL,
                  started_at TEXT,
                  finished_at TEXT
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_created ON provisioning_jobs(created_at DESC)"
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(provisioning_jobs)").fetchall()}
            migrations = {
                "stage": "TEXT NOT NULL DEFAULT 'queued'",
                "stage_label": "TEXT NOT NULL DEFAULT 'Trabajo en cola'",
                "progress_percent": "INTEGER NOT NULL DEFAULT 0",
                "heartbeat_at": "TEXT",
                "last_completed_step": "TEXT",
                "retryable": "INTEGER NOT NULL DEFAULT 1",
            }
            for name, definition in migrations.items():
                if name not in columns:
                    connection.execute(f"ALTER TABLE provisioning_jobs ADD COLUMN {name} {definition}")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS network_ranges (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  cidr TEXT NOT NULL UNIQUE,
                  vlan INTEGER NOT NULL,
                  gateway TEXT NOT NULL,
                  primary_dns TEXT NOT NULL,
                  secondary_dns TEXT,
                  priority INTEGER NOT NULL DEFAULT 100,
                  allocation_start TEXT,
                  allocation_end TEXT,
                  exclusions_json TEXT NOT NULL DEFAULT '[]',
                  active INTEGER NOT NULL DEFAULT 1,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                )
                """
            )
            existing = connection.execute("SELECT COUNT(*) FROM network_ranges").fetchone()[0]
            if not existing:
                now = datetime.now(timezone.utc).isoformat()
                connection.execute(
                    """INSERT INTO network_ranges
                    (id,name,cidr,vlan,gateway,primary_dns,secondary_dns,priority,allocation_start,allocation_end,exclusions_json,active,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    ("main-192-168-16", "Clientes fibra", "192.168.16.0/24", 101, "192.168.16.1", "8.8.8.8", "", 10,
                     "192.168.16.2", "192.168.16.254", '["192.168.16.1"]', 1, now, now),
                )

    def create(self, job: dict, request: dict) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO provisioning_jobs
                  (id, kind, status, device_host, wan_ip, ssid, request_json, events_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job["id"], job["kind"], job["status"],
                    request.get("device", {}).get("host", ""),
                    request.get("wan", {}).get("ip_address"),
                    request.get("wifi", {}).get("ssid"),
                    json.dumps(request, ensure_ascii=True),
                    json.dumps(job.get("events", []), ensure_ascii=True),
                    job["created_at"],
                ),
            )

    def update(self, job: dict) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE provisioning_jobs
                SET status=?, events_json=?, result_json=?, error=?, started_at=?, finished_at=?,
                    stage=?, stage_label=?, progress_percent=?, heartbeat_at=?, last_completed_step=?, retryable=?
                WHERE id=?
                """,
                (
                    job["status"],
                    json.dumps(job.get("events", []), ensure_ascii=True),
                    json.dumps(job.get("result"), ensure_ascii=True) if job.get("result") is not None else None,
                    job.get("error"), job.get("started_at"), job.get("finished_at"),
                    job.get("stage", "queued"), job.get("stage_label", "Trabajo en cola"),
                    job.get("progress_percent", 0), job.get("heartbeat_at"), job.get("last_completed_step"),
                    1 if job.get("retryable", True) else 0, job["id"],
                ),
            )

    def recent(self, limit: int = 20) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, kind, status, device_host, wan_ip, ssid, events_json,
                       result_json, error, created_at, started_at, finished_at,
                       stage, stage_label, progress_percent, heartbeat_at, last_completed_step, retryable
                FROM provisioning_jobs ORDER BY created_at DESC LIMIT ?
                """,
                (max(1, min(limit, 100)),),
            ).fetchall()
        return [
            {
                **dict(row),
                "events": json.loads(row["events_json"] or "[]"),
                "result": json.loads(row["result_json"]) if row["result_json"] else None,
                "retryable": bool(row["retryable"]),
            }
            for row in rows
        ]

    def get(self, job_id: str) -> dict | None:
        rows = [row for row in self.recent(100) if row["id"] == job_id]
        return rows[0] if rows else None

    def interrupt_incomplete(self) -> int:
        now = datetime.now(timezone.utc).isoformat()
        event = json.dumps([{
            "at": now, "step": "interrupted", "status": "error",
            "message": "El agente se reinicio. Reanuda desde el ultimo checkpoint seguro.",
        }], ensure_ascii=True)
        with self._connect() as connection:
            cursor = connection.execute(
                """UPDATE provisioning_jobs
                SET status='error', stage='interrupted', stage_label='Trabajo interrumpido',
                    heartbeat_at=?, finished_at=?, retryable=1,
                    error='El agente se reinicio durante la configuracion',
                    events_json=CASE WHEN events_json='[]' THEN ? ELSE substr(events_json,1,length(events_json)-1) || ',' || substr(?,2) END
                WHERE status IN ('queued','running')""",
                (now, now, event, event),
            )
        return cursor.rowcount

    def retry_template(self, job_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, kind, status, request_json, error, created_at
                FROM provisioning_jobs WHERE id=?
                """,
                (job_id,),
            ).fetchone()
        if not row:
            return None
        request = json.loads(row["request_json"] or "{}")
        request.get("device", {}).pop("password", None)
        request.get("wifi", {}).pop("password", None)
        request.get("tr069", {}).pop("password", None)
        request.get("tr069", {}).pop("connection_request_password", None)
        return {
            "id": row["id"],
            "kind": row["kind"],
            "status": row["status"],
            "error": row["error"],
            "created_at": row["created_at"],
            "request": request,
        }

    def network_ranges(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM network_ranges ORDER BY priority ASC, cidr ASC"
            ).fetchall()
        return [{
            "id": row["id"], "name": row["name"], "cidr": row["cidr"], "vlan": row["vlan"],
            "gateway": row["gateway"], "primary_dns": row["primary_dns"],
            "secondary_dns": row["secondary_dns"] or "", "priority": row["priority"],
            "allocation_start": row["allocation_start"], "allocation_end": row["allocation_end"],
            "exclusions": json.loads(row["exclusions_json"] or "[]"), "active": bool(row["active"]),
        } for row in rows]

    def replace_network_ranges(self, ranges: list[dict]) -> list[dict]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("DELETE FROM network_ranges")
            connection.executemany(
                """INSERT INTO network_ranges
                (id,name,cidr,vlan,gateway,primary_dns,secondary_dns,priority,allocation_start,allocation_end,exclusions_json,active,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                [(
                    item["id"], item["name"], item["cidr"], item["vlan"], item["gateway"], item["primary_dns"],
                    item.get("secondary_dns") or "", item["priority"], item.get("allocation_start"), item.get("allocation_end"),
                    json.dumps(item.get("exclusions") or [], ensure_ascii=True), 1 if item.get("active", True) else 0, now, now,
                ) for item in ranges],
            )
        return self.network_ranges()
