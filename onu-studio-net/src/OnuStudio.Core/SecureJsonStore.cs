using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace OnuStudio.Core;

/// <summary>
/// Guarda la sesion con ISP Max cifrada con DPAPI del usuario actual: solo esta
/// cuenta de Windows y solo en esta PC pueden volver a leerla.
/// Mantiene el formato del agente anterior (cabecera "DPAPI1\0") para no perder la sesion.
/// </summary>
public sealed class SecureJsonStore
{
    private static readonly byte[] Header = Encoding.ASCII.GetBytes("DPAPI1\0");
    private static readonly byte[] Entropy = Encoding.Unicode.GetBytes("ISP Max ONU Studio");

    private readonly string _path;

    public SecureJsonStore(string path) => _path = path;

    public void Save<T>(T value)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(value, JsonDefaults.Options);
        var sealedBytes = ProtectedData.Protect(payload, Entropy, DataProtectionScope.CurrentUser);
        var envelope = new byte[Header.Length + sealedBytes.Length];
        Buffer.BlockCopy(Header, 0, envelope, 0, Header.Length);
        Buffer.BlockCopy(sealedBytes, 0, envelope, Header.Length, sealedBytes.Length);

        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporary = _path + ".tmp";
        File.WriteAllBytes(temporary, envelope);
        File.Move(temporary, _path, overwrite: true);
    }

    public T? Load<T>() where T : class
    {
        if (!File.Exists(_path)) return null;
        var envelope = File.ReadAllBytes(_path);
        if (envelope.Length <= Header.Length || !envelope.Take(Header.Length).SequenceEqual(Header))
            throw new InvalidDataException("Formato de sesion cifrada desconocido");

        var payload = ProtectedData.Unprotect(envelope[Header.Length..], Entropy, DataProtectionScope.CurrentUser);
        return JsonSerializer.Deserialize<T>(payload, JsonDefaults.Options);
    }

    public void Delete()
    {
        try
        {
            File.Delete(_path);
        }
        catch (FileNotFoundException)
        {
            // Ya no existe: nada que borrar.
        }
        catch (DirectoryNotFoundException)
        {
            // Ya no existe: nada que borrar.
        }
    }
}
