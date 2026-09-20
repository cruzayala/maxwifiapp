using System.Text;
using System.Text.RegularExpressions;

namespace OnuStudio.Core;

/// <summary>
/// Serial GPON en el formato de 12 caracteres que usa la OLT.
/// Huawei publica el serial en hexadecimal (16 caracteres); los primeros 8 son el
/// fabricante en ASCII, por ejemplo 48575443 -> HWTC.
/// </summary>
public static class GponSerial
{
    public static string Normalize(string? value)
    {
        var serial = Regex.Replace(value ?? string.Empty, "[^A-Za-z0-9]", string.Empty).ToUpperInvariant();

        if (Regex.IsMatch(serial, "^[0-9A-F]{16}$"))
        {
            var vendor = DecodeVendor(serial[..8]);
            if (Regex.IsMatch(vendor, "^[A-Z0-9]{4}$")) serial = vendor + serial[8..];
        }

        if (!Regex.IsMatch(serial, "^[A-Z0-9]{12}$"))
            throw new FormatException("Serial GPON invalido");
        return serial;
    }

    public static bool TryNormalize(string? value, out string serial)
    {
        try
        {
            serial = Normalize(value);
            return true;
        }
        catch (FormatException)
        {
            serial = string.Empty;
            return false;
        }
    }

    private static string DecodeVendor(string hex)
    {
        try
        {
            var bytes = new byte[hex.Length / 2];
            for (var index = 0; index < bytes.Length; index++)
                bytes[index] = Convert.ToByte(hex.Substring(index * 2, 2), 16);
            return Encoding.ASCII.GetString(bytes).ToUpperInvariant();
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }
}
