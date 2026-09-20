using System.Net;
using System.Net.Sockets;

namespace OnuStudio.Core;

/// <summary>Operaciones de red IPv4 que el asistente necesita para validar y derivar datos.</summary>
public static class Ipv4
{
    public static bool TryParse(string? value, out IPAddress address)
    {
        address = IPAddress.None;
        if (string.IsNullOrWhiteSpace(value)) return false;
        if (!IPAddress.TryParse(value.Trim(), out var parsed) || parsed.AddressFamily != AddressFamily.InterNetwork) return false;
        address = parsed;
        return true;
    }

    public static IPAddress Parse(string value) =>
        TryParse(value, out var address) ? address : throw new FormatException($"Direccion IPv4 invalida: {value}");

    public static uint ToUInt32(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        return ((uint)bytes[0] << 24) | ((uint)bytes[1] << 16) | ((uint)bytes[2] << 8) | bytes[3];
    }

    public static IPAddress FromUInt32(uint value) => new(new[]
    {
        (byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value,
    });

    public static int PrefixFromMask(IPAddress mask)
    {
        var bits = ToUInt32(mask);
        var prefix = 0;
        var seenZero = false;
        for (var index = 31; index >= 0; index--)
        {
            var isOne = (bits & (1u << index)) != 0;
            if (isOne)
            {
                if (seenZero) throw new FormatException("La mascara no es contigua");
                prefix++;
            }
            else seenZero = true;
        }
        return prefix;
    }

    public static IPAddress MaskFromPrefix(int prefix)
    {
        if (prefix is < 0 or > 32) throw new ArgumentOutOfRangeException(nameof(prefix));
        var value = prefix == 0 ? 0u : uint.MaxValue << (32 - prefix);
        return FromUInt32(value);
    }

    public static IPAddress NetworkAddress(IPAddress address, int prefix) =>
        FromUInt32(ToUInt32(address) & ToUInt32(MaskFromPrefix(prefix)));

    public static IPAddress BroadcastAddress(IPAddress address, int prefix) =>
        FromUInt32(ToUInt32(NetworkAddress(address, prefix)) | (prefix == 32 ? 0u : uint.MaxValue >> prefix));

    public static bool SameNetwork(IPAddress left, IPAddress right, int prefix) =>
        ToUInt32(NetworkAddress(left, prefix)) == ToUInt32(NetworkAddress(right, prefix));

    /// <summary>Analiza "192.168.16.0/24" y devuelve red y prefijo.</summary>
    public static (IPAddress Network, int Prefix) ParseCidr(string value)
    {
        var parts = (value ?? string.Empty).Trim().Split('/');
        if (parts.Length != 2 || !TryParse(parts[0], out var address) || !int.TryParse(parts[1], out var prefix) || prefix is < 0 or > 32)
            throw new FormatException("El origen remoto debe tener formato IP/mask, por ejemplo 192.168.16.1/32");
        return (NetworkAddress(address, prefix), prefix);
    }

    public static string FormatCidr(string value)
    {
        var (network, prefix) = ParseCidr(value);
        return $"{network}/{prefix}";
    }

    public static bool CidrContains(string cidr, IPAddress address)
    {
        var (network, prefix) = ParseCidr(cidr);
        return SameNetwork(network, address, prefix);
    }

    public static long UsableAddresses(int prefix) => prefix >= 31 ? 0 : (1L << (32 - prefix)) - 2;
}
