using System.IO;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using OnuStudio.Core;
using OnuStudio.Core.Acs;
using OnuStudio.Core.Models;
using OnuStudio.Core.Onu;
using OnuStudio.Core.Storage;
using Xunit;

namespace OnuStudio.Tests;

public class GponSerialTests
{
    [Fact]
    public void ConvierteElSerialHexadecimalDeHuaweiAlFormatoDeLaOlt() =>
        Assert.Equal("HWTC9EC8CEAF", GponSerial.Normalize("485754439EC8CEAF"));

    [Fact]
    public void ConservaElFormatoCanonicoDeLaOlt() =>
        Assert.Equal("HWTC9EC8CEAF", GponSerial.Normalize("hwtc9ec8ceaf"));

    [Fact]
    public void RechazaSerialesInvalidos() =>
        Assert.Throws<FormatException>(() => GponSerial.Normalize("1234"));
}

public class SecureStoreTests
{
    private sealed class SavedSession
    {
        public string? DeviceToken { get; set; }
        public string? Username { get; set; }
    }

    [Fact]
    public void LaSesionSeGuardaCifradaYNuncaEnTextoPlano()
    {
        var directory = Directory.CreateTempSubdirectory();
        try
        {
            var path = Path.Combine(directory.FullName, "cloud-session.dat");
            var store = new SecureJsonStore(path);
            store.Save(new SavedSession { DeviceToken = "very-secret-device-token", Username = "admin" });

            var bytes = File.ReadAllBytes(path);
            var text = System.Text.Encoding.UTF8.GetString(bytes);
            Assert.DoesNotContain("very-secret-device-token", text, StringComparison.Ordinal);

            var loaded = store.Load<SavedSession>();
            Assert.Equal("very-secret-device-token", loaded?.DeviceToken);

            store.Delete();
            Assert.False(File.Exists(path));
        }
        finally
        {
            directory.Delete(true);
        }
    }
}

public class JobStoreTests
{
    [Fact]
    public void LosRangosTraenUnValorInicialYSePuedenReemplazar()
    {
        var directory = Directory.CreateTempSubdirectory();
        try
        {
            var store = new JobStore(Path.Combine(directory.FullName, "agent.db"));
            Assert.Equal("192.168.16.0/24", store.NetworkRanges()[0].Cidr);

            var rows = store.ReplaceNetworkRanges(new[]
            {
                new NetworkRange
                {
                    Id = "fiber-main", Name = "Fibra", Cidr = "192.168.20.0/24", Vlan = 101,
                    Gateway = "192.168.20.1", PrimaryDns = "8.8.8.8", SecondaryDns = string.Empty,
                    Priority = 10, AllocationStart = "192.168.20.2", AllocationEnd = "192.168.20.254",
                    Exclusions = new List<string> { "192.168.20.1" }, Active = true,
                },
            });

            Assert.Equal("192.168.20.0/24", rows[0].Cidr);
            Assert.Equal(new[] { "192.168.20.1" }, rows[0].Exclusions);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            directory.Delete(true);
        }
    }

    [Fact]
    public void LosTrabajosIncompletosQuedanMarcadosAlReiniciar()
    {
        var directory = Directory.CreateTempSubdirectory();
        try
        {
            var store = new JobStore(Path.Combine(directory.FullName, "agent.db"));
            var job = new JobState
            {
                Id = Guid.NewGuid().ToString("N"), Kind = "provision", Status = "running",
                CreatedAt = Clock.UtcNow(), DeviceHost = "192.168.100.1",
            };
            store.Create(job, new { device = new { host = "192.168.100.1" } });

            Assert.Equal(1, store.InterruptIncomplete());
            var reloaded = store.Get(job.Id);
            Assert.Equal("error", reloaded?.Status);
            Assert.True(reloaded?.Retryable);
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            directory.Delete(true);
        }
    }
}

public class ProvisionValidationTests
{
    private static ProvisionRequest ValidRequest() => new()
    {
        Device = new DeviceSettings { Host = "192.168.100.1", Model = "EG8141A5", Username = "telecomadmin", Password = "x" },
        LocalNetwork = new LocalNetworkSettings { AdapterIndex = 12, Address = "192.168.100.10", PrefixLength = 24 },
        Wan = new WanSettings
        {
            VlanId = 101, IpAddress = "192.168.16.245", SubnetMask = "255.255.255.0",
            Gateway = "192.168.16.1", PrimaryDns = "8.8.8.8",
        },
        Wifi = new WifiSettings { Ssid = "Cliente", Password = "clave-segura" },
        Tr069 = new Tr069Settings { Enabled = false },
        RemoteAccess = new RemoteAccessSettings { Source = "192.168.16.1/32" },
    };

    [Fact]
    public void UnPerfilCompletoEsValido() => Assert.True(ValidRequest().Validate().IsValid);

    [Fact]
    public void LaPuertaDeEnlaceDebeEstarEnLaMismaRed()
    {
        var request = ValidRequest();
        request.Wan.Gateway = "10.0.0.1";
        Assert.Contains("puerta de enlace", request.Validate().Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void LaIpLocalDebeAlcanzarLaRedDeAdministracion()
    {
        var request = ValidRequest();
        request.LocalNetwork.Address = "10.10.10.10";
        Assert.Contains("192.168.100", request.Validate().Message, StringComparison.Ordinal);
    }

    [Fact]
    public void LaClaveWifiCortaSeRechaza()
    {
        var request = ValidRequest();
        request.Wifi.Password = "corta";
        Assert.Contains("clave WiFi", request.Validate().Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ElPerfilSeguroNoPermiteTelnetNiSsh()
    {
        var request = ValidRequest();
        request.RemoteAccess.Telnet = true;
        Assert.Contains("Telnet", request.Validate().Message, StringComparison.Ordinal);
    }

    [Fact]
    public void LaCopiaSeguraNoLlevaClaves()
    {
        var safe = ValidRequest().SafeCopy();
        Assert.Equal("***", safe.Device.Password);
        Assert.Equal("***", safe.Wifi.Password);
    }
}

public class Ipv4Tests
{
    [Fact]
    public void DerivaElPrefijoDesdeLaMascara() =>
        Assert.Equal(24, Ipv4.PrefixFromMask(Ipv4.Parse("255.255.255.0")));

    [Fact]
    public void CalculaRedYBroadcast()
    {
        Assert.Equal("192.168.16.0", Ipv4.NetworkAddress(Ipv4.Parse("192.168.16.245"), 24).ToString());
        Assert.Equal("192.168.16.255", Ipv4.BroadcastAddress(Ipv4.Parse("192.168.16.245"), 24).ToString());
    }

    [Fact]
    public void NormalizaUnCidr() => Assert.Equal("192.168.16.0/24", Ipv4.FormatCidr("192.168.16.45/24"));
}

public class ZteInventoryTests
{
    [Fact]
    public void ElInventarioNormalizaElSerialDeLaZte()
    {
        var pairs = new Dictionary<string, string>
        {
            ["Model Name"] = "F670L",
            ["Serial Number"] = "ZTEG1234ABCD",
            ["Software Version"] = "V9.0.1",
            ["Hardware Version"] = "V9",
            ["RX Optical Power"] = "-19.5 dBm",
        };

        var parsed = ZteF670L.ParseInventorySnapshot(pairs, "PON State O5");
        Assert.Equal("ZTEG1234ABCD", parsed["identity"]!["serial"]!.ToString());
        Assert.Equal("F670L", parsed["device"]!["model"]!.ToString());
        Assert.True(parsed["optical"]!["signal_available"]!.GetValue<bool>());
    }

    [Fact]
    public void ElNombreDeLaWanSaleDeLaIpDelCliente()
    {
        var request = new ProvisionRequest
        {
            ServiceMode = "router",
            Wan = new WanSettings { IpAddress = "192.168.16.166", VlanId = 101 },
        };
        Assert.Equal("ISPMax-166", ZteF670L.WanName(request));
    }

    [Fact]
    public void EnModoBridgeElNombreLlevaLaVlan()
    {
        var request = new ProvisionRequest { ServiceMode = "bridge", Wan = new WanSettings { VlanId = 120 } };
        Assert.Equal("ISPMax-Bridge-120", ZteF670L.WanName(request));
    }

    [Fact]
    public void LaReglaRemotaSeReconocePorRangoModoYServicio()
    {
        var text = "1 ISPMax-16... Permit 192.168.16.1 192.168.16.1 HTTP Enable";
        Assert.True(ZteF670L.RemoteRuleMatches(text, "192.168.16.1", "192.168.16.1"));
        Assert.False(ZteF670L.RemoteRuleMatches(text, "10.0.0.1", "10.0.0.1"));
    }
}

public class HuaweiWanTests
{
    [Fact]
    public void ElNombreDeLaWanIncluyeServicioModoYVlan()
    {
        var request = new ProvisionRequest
        {
            ServiceMode = "router",
            Tr069 = new Tr069Settings { Enabled = true },
            Wan = new WanSettings { VlanId = 101 },
        };
        Assert.Equal("1_TR069_INTERNET_R_VID_101", HuaweiEg8141A5.WanConnectionName(request));
    }

    [Fact]
    public void ReconoceUnaWanCompatibleAunqueCambieElNombre()
    {
        var request = new ProvisionRequest
        {
            ServiceMode = "router",
            Tr069 = new Tr069Settings { Enabled = true },
            Wan = new WanSettings { VlanId = 101 },
        };
        var names = new[] { "2_INTERNET_R_VID_101", "3_VOIP_R_VID_200" };
        Assert.Equal("2_INTERNET_R_VID_101", HuaweiEg8141A5.CompatibleWanConnection(request, names));
    }

    [Fact]
    public void LasFilasDeAclSoloCuentanSiTraenHttpYUnaIp()
    {
        var rows = new[]
        {
            "1_TR069_INTERNET_R_VID_101 HTTP 192.168.16.1/32 Enable",
            "Encabezado sin datos",
        };
        Assert.Single(HuaweiEg8141A5.ActualAclRows(rows));
    }
}

public class GenieAcsTests
{
    [Fact]
    public void ElSerialSeBuscaEnAsciiYEnHexadecimal()
    {
        var candidates = GenieAcsClient.SerialCandidates("HWTC9EC8CEAF");
        Assert.Contains("HWTC9EC8CEAF", candidates);
        Assert.Contains("485754439EC8CEAF", candidates);
    }

    [Fact]
    public void LosParametrosSegurosNuncaIncluyenClaves()
    {
        var device = new JsonObject
        {
            [GenieAcsClient.Root] = new JsonObject
            {
                ["DeviceInfo"] = new JsonObject
                {
                    ["SoftwareVersion"] = new JsonObject { ["_value"] = "V5", ["_writable"] = false },
                },
                ["LANDevice"] = new JsonObject
                {
                    ["1"] = new JsonObject
                    {
                        ["WLANConfiguration"] = new JsonObject
                        {
                            ["1"] = new JsonObject
                            {
                                ["KeyPassphrase"] = new JsonObject { ["_value"] = "secreto", ["_writable"] = true },
                                ["SSID"] = new JsonObject { ["_value"] = "Casa", ["_writable"] = true },
                            },
                        },
                    },
                },
            },
        };

        var parameters = GenieAcsClient.SafeParameters(device);
        var paths = parameters.Select(node => node!["path"]!.ToString()).ToList();
        Assert.Contains(paths, path => path.EndsWith("SSID", StringComparison.Ordinal));
        Assert.DoesNotContain(paths, path => path.Contains("Passphrase", StringComparison.Ordinal));
    }

    [Fact]
    public void LeeValoresAnidadosDelDocumento()
    {
        var device = new JsonObject
        {
            ["InternetGatewayDevice"] = new JsonObject
            {
                ["DeviceInfo"] = new JsonObject
                {
                    ["UpTime"] = new JsonObject { ["_value"] = 1200 },
                },
            },
        };
        Assert.Equal("1200", GenieAcsClient.LeafValue(device, "InternetGatewayDevice.DeviceInfo.UpTime")?.ToString());
    }
}

public class ErrorSanitizerTests
{
    [Fact]
    public void LosErroresNuncaMuestranLaClave()
    {
        var exception = new Exception("fallo con password=SuperSecreta y clave SuperSecreta");
        var message = OnuStudio.Core.Jobs.ProvisioningService.SanitizeError(exception, "SuperSecreta");
        Assert.DoesNotContain("SuperSecreta", message, StringComparison.Ordinal);
    }

    [Fact]
    public void ElCodigoDeErrorViajaConLaMetadata()
    {
        var exception = new OnuProvisioningException("bloqueado", "ONU_FIELD_LOCKED", retryable: false);
        var (code, retryable) = OnuStudio.Core.Jobs.ProvisioningService.ErrorMetadata(exception);
        Assert.Equal("ONU_FIELD_LOCKED", code);
        Assert.False(retryable);
    }
}
