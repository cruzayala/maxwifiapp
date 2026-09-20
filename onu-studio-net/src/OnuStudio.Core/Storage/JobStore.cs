using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using OnuStudio.Core.Models;

namespace OnuStudio.Core.Storage;

/// <summary>
/// Historial de trabajos y rangos IP en SQLite. Usa el mismo archivo y el mismo
/// esquema que el agente anterior, para que al actualizar no se pierda nada.
/// </summary>
public sealed class JobStore
{
    private readonly string _path;
    private readonly object _writeLock = new();

    public JobStore(string path)
    {
        _path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        InitializeSchema();
    }

    private SqliteConnection Connect()
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = _path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Default,
            DefaultTimeout = 10,
        }.ToString());
        connection.Open();
        Execute(connection, "PRAGMA journal_mode=WAL");
        Execute(connection, "PRAGMA foreign_keys=ON");
        return connection;
    }

    private static void Execute(SqliteConnection connection, string sql, params (string Name, object? Value)[] parameters)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        command.ExecuteNonQuery();
    }

    private void InitializeSchema()
    {
        lock (_writeLock)
        {
            using var connection = Connect();
            Execute(connection, """
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
                """);
            Execute(connection, "CREATE INDEX IF NOT EXISTS idx_provisioning_jobs_created ON provisioning_jobs(created_at DESC)");

            var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "PRAGMA table_info(provisioning_jobs)";
                using var reader = command.ExecuteReader();
                while (reader.Read()) columns.Add(reader.GetString(1));
            }
            var migrations = new (string Name, string Definition)[]
            {
                ("stage", "TEXT NOT NULL DEFAULT 'queued'"),
                ("stage_label", "TEXT NOT NULL DEFAULT 'Trabajo en cola'"),
                ("progress_percent", "INTEGER NOT NULL DEFAULT 0"),
                ("heartbeat_at", "TEXT"),
                ("last_completed_step", "TEXT"),
                ("retryable", "INTEGER NOT NULL DEFAULT 1"),
            };
            foreach (var (name, definition) in migrations)
                if (!columns.Contains(name))
                    Execute(connection, $"ALTER TABLE provisioning_jobs ADD COLUMN {name} {definition}");

            Execute(connection, """
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
                """);

            using var count = connection.CreateCommand();
            count.CommandText = "SELECT COUNT(*) FROM network_ranges";
            if (Convert.ToInt64(count.ExecuteScalar()) == 0)
            {
                var now = Clock.UtcNow();
                Execute(connection, """
                    INSERT INTO network_ranges
                    (id,name,cidr,vlan,gateway,primary_dns,secondary_dns,priority,allocation_start,allocation_end,exclusions_json,active,created_at,updated_at)
                    VALUES ($id,$name,$cidr,$vlan,$gateway,$dns1,$dns2,$priority,$start,$end,$exclusions,1,$now,$now)
                    """,
                    ("$id", "main-192-168-16"), ("$name", "Clientes fibra"), ("$cidr", "192.168.16.0/24"),
                    ("$vlan", 101), ("$gateway", "192.168.16.1"), ("$dns1", "8.8.8.8"), ("$dns2", ""),
                    ("$priority", 10), ("$start", "192.168.16.2"), ("$end", "192.168.16.254"),
                    ("$exclusions", "[\"192.168.16.1\"]"), ("$now", now));
            }
        }
    }

    public void Create(JobState job, object safeRequest)
    {
        lock (_writeLock)
        {
            using var connection = Connect();
            Execute(connection, """
                INSERT INTO provisioning_jobs
                  (id, kind, status, device_host, wan_ip, ssid, request_json, events_json, created_at,
                   stage, stage_label, progress_percent, heartbeat_at, retryable)
                VALUES ($id,$kind,$status,$host,$wan,$ssid,$request,$events,$created,$stage,$label,$percent,$heartbeat,$retryable)
                """,
                ("$id", job.Id), ("$kind", job.Kind), ("$status", job.Status),
                ("$host", job.DeviceHost), ("$wan", job.WanIp), ("$ssid", job.Ssid),
                ("$request", JsonDefaults.ToJson(safeRequest)),
                ("$events", JsonDefaults.ToJson(job.Events)),
                ("$created", job.CreatedAt), ("$stage", job.Stage), ("$label", job.StageLabel),
                ("$percent", job.ProgressPercent), ("$heartbeat", job.HeartbeatAt),
                ("$retryable", job.Retryable ? 1 : 0));
        }
    }

    public void Update(JobState job)
    {
        lock (_writeLock)
        {
            using var connection = Connect();
            Execute(connection, """
                UPDATE provisioning_jobs
                SET status=$status, events_json=$events, result_json=$result, error=$error,
                    started_at=$started, finished_at=$finished, stage=$stage, stage_label=$label,
                    progress_percent=$percent, heartbeat_at=$heartbeat, last_completed_step=$step, retryable=$retryable
                WHERE id=$id
                """,
                ("$status", job.Status), ("$events", JsonDefaults.ToJson(job.Events)),
                ("$result", job.Result?.ToJsonString(JsonDefaults.Options)), ("$error", job.Error),
                ("$started", job.StartedAt), ("$finished", job.FinishedAt),
                ("$stage", job.Stage), ("$label", job.StageLabel), ("$percent", job.ProgressPercent),
                ("$heartbeat", job.HeartbeatAt), ("$step", job.LastCompletedStep),
                ("$retryable", job.Retryable ? 1 : 0), ("$id", job.Id));
        }
    }

    public List<JobState> Recent(int limit = 20)
    {
        var jobs = new List<JobState>();
        using var connection = Connect();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, kind, status, device_host, wan_ip, ssid, events_json, result_json, error,
                   created_at, started_at, finished_at, stage, stage_label, progress_percent,
                   heartbeat_at, last_completed_step, retryable
            FROM provisioning_jobs ORDER BY created_at DESC LIMIT $limit
            """;
        command.Parameters.AddWithValue("$limit", Math.Max(1, Math.Min(limit, 100)));
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            jobs.Add(new JobState
            {
                Id = reader.GetString(0),
                Kind = reader.GetString(1),
                Status = reader.GetString(2),
                DeviceHost = reader.GetString(3),
                WanIp = reader.IsDBNull(4) ? null : reader.GetString(4),
                Ssid = reader.IsDBNull(5) ? null : reader.GetString(5),
                Events = JsonDefaults.FromJson<List<JobEvent>>(reader.IsDBNull(6) ? "[]" : reader.GetString(6)) ?? new(),
                Result = reader.IsDBNull(7) ? null : JsonNode.Parse(reader.GetString(7))?.AsObject(),
                Error = reader.IsDBNull(8) ? null : reader.GetString(8),
                CreatedAt = reader.GetString(9),
                StartedAt = reader.IsDBNull(10) ? null : reader.GetString(10),
                FinishedAt = reader.IsDBNull(11) ? null : reader.GetString(11),
                Stage = reader.IsDBNull(12) ? "queued" : reader.GetString(12),
                StageLabel = reader.IsDBNull(13) ? "Trabajo en cola" : reader.GetString(13),
                ProgressPercent = reader.IsDBNull(14) ? 0 : reader.GetInt32(14),
                HeartbeatAt = reader.IsDBNull(15) ? null : reader.GetString(15),
                LastCompletedStep = reader.IsDBNull(16) ? null : reader.GetString(16),
                Retryable = reader.IsDBNull(17) || reader.GetInt32(17) != 0,
            });
        }
        return jobs;
    }

    public JobState? Get(string jobId) => Recent(100).FirstOrDefault(job => job.Id == jobId);

    /// <summary>Marca como interrumpidos los trabajos que quedaron a medias tras un cierre.</summary>
    public int InterruptIncomplete()
    {
        var now = Clock.UtcNow();
        var interrupted = JsonDefaults.ToJson(new[]
        {
            new JobEvent
            {
                At = now, Step = "interrupted", Status = "error",
                Message = "El agente se reinicio. Reanuda desde el ultimo checkpoint seguro.",
            },
        });

        lock (_writeLock)
        {
            using var connection = Connect();
            using var command = connection.CreateCommand();
            command.CommandText = """
                UPDATE provisioning_jobs
                SET status='error', stage='interrupted', stage_label='Trabajo interrumpido',
                    heartbeat_at=$now, finished_at=$now, retryable=1,
                    error='El agente se reinicio durante la configuracion',
                    events_json = CASE WHEN events_json='[]' THEN $event
                      ELSE substr(events_json,1,length(events_json)-1) || ',' || substr($event,2) END
                WHERE status IN ('queued','running')
                """;
            command.Parameters.AddWithValue("$now", now);
            command.Parameters.AddWithValue("$event", interrupted);
            return command.ExecuteNonQuery();
        }
    }

    public sealed record RetryTemplate(string Id, string Kind, string Status, string? Error, string CreatedAt, JsonObject Request);

    /// <summary>Datos del intento anterior para volver a llenar el asistente, sin secretos.</summary>
    public RetryTemplate? GetRetryTemplate(string jobId)
    {
        using var connection = Connect();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, kind, status, request_json, error, created_at FROM provisioning_jobs WHERE id=$id";
        command.Parameters.AddWithValue("$id", jobId);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;

        var request = JsonNode.Parse(reader.IsDBNull(3) ? "{}" : reader.GetString(3))?.AsObject() ?? new JsonObject();
        Strip(request, "device", "password");
        Strip(request, "wifi", "password");
        Strip(request, "tr069", "password");
        Strip(request, "tr069", "connection_request_password");
        return new RetryTemplate(
            reader.GetString(0), reader.GetString(1), reader.GetString(2),
            reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetString(5), request);

        static void Strip(JsonObject root, string section, string field)
        {
            if (root[section] is JsonObject child) child.Remove(field);
        }
    }

    public List<NetworkRange> NetworkRanges()
    {
        var ranges = new List<NetworkRange>();
        using var connection = Connect();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM network_ranges ORDER BY priority ASC, cidr ASC";
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            ranges.Add(new NetworkRange
            {
                Id = reader.GetString(reader.GetOrdinal("id")),
                Name = reader.GetString(reader.GetOrdinal("name")),
                Cidr = reader.GetString(reader.GetOrdinal("cidr")),
                Vlan = reader.GetInt32(reader.GetOrdinal("vlan")),
                Gateway = reader.GetString(reader.GetOrdinal("gateway")),
                PrimaryDns = reader.GetString(reader.GetOrdinal("primary_dns")),
                SecondaryDns = Text(reader, "secondary_dns") ?? string.Empty,
                Priority = reader.GetInt32(reader.GetOrdinal("priority")),
                AllocationStart = Text(reader, "allocation_start"),
                AllocationEnd = Text(reader, "allocation_end"),
                Exclusions = JsonDefaults.FromJson<List<string>>(Text(reader, "exclusions_json") ?? "[]") ?? new(),
                Active = reader.GetInt32(reader.GetOrdinal("active")) != 0,
            });
        }
        return ranges;

        static string? Text(SqliteDataReader reader, string column)
        {
            var ordinal = reader.GetOrdinal(column);
            return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
        }
    }

    public List<NetworkRange> ReplaceNetworkRanges(IReadOnlyList<NetworkRange> ranges)
    {
        var now = Clock.UtcNow();
        lock (_writeLock)
        {
            using var connection = Connect();
            using var transaction = connection.BeginTransaction();
            using (var wipe = connection.CreateCommand())
            {
                wipe.Transaction = transaction;
                wipe.CommandText = "DELETE FROM network_ranges";
                wipe.ExecuteNonQuery();
            }
            foreach (var range in ranges)
            {
                using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = """
                    INSERT INTO network_ranges
                    (id,name,cidr,vlan,gateway,primary_dns,secondary_dns,priority,allocation_start,allocation_end,exclusions_json,active,created_at,updated_at)
                    VALUES ($id,$name,$cidr,$vlan,$gateway,$dns1,$dns2,$priority,$start,$end,$exclusions,$active,$now,$now)
                    """;
                insert.Parameters.AddWithValue("$id", range.Id);
                insert.Parameters.AddWithValue("$name", range.Name);
                insert.Parameters.AddWithValue("$cidr", range.Cidr);
                insert.Parameters.AddWithValue("$vlan", range.Vlan);
                insert.Parameters.AddWithValue("$gateway", range.Gateway);
                insert.Parameters.AddWithValue("$dns1", range.PrimaryDns);
                insert.Parameters.AddWithValue("$dns2", range.SecondaryDns ?? string.Empty);
                insert.Parameters.AddWithValue("$priority", range.Priority);
                insert.Parameters.AddWithValue("$start", (object?)range.AllocationStart ?? DBNull.Value);
                insert.Parameters.AddWithValue("$end", (object?)range.AllocationEnd ?? DBNull.Value);
                insert.Parameters.AddWithValue("$exclusions", JsonDefaults.ToJson(range.Exclusions));
                insert.Parameters.AddWithValue("$active", range.Active ? 1 : 0);
                insert.Parameters.AddWithValue("$now", now);
                insert.ExecuteNonQuery();
            }
            transaction.Commit();
        }
        return NetworkRanges();
    }
}

public static class Clock
{
    /// <summary>Marca de tiempo UTC en ISO 8601, igual que la del agente anterior.</summary>
    public static string UtcNow() => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.ffffffK");
}
