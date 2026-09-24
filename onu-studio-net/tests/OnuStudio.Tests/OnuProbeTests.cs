using OnuStudio.Core.Jobs;
using OnuStudio.Core.Models;
using OnuStudio.Core.Net;
using Xunit;

namespace OnuStudio.Tests;

public class OnuProbeTests
{
    private static readonly HttpProbe Open = new(true, 3, 80, null);
    private static readonly HttpProbe Refused = new(false, null, 80, "refused");

    [Fact]
    public void SiLaOnuRechazaIpv4SeUsaSuIpv6Local()
    {
        var device = new DeviceSettings { Host = "192.168.100.1", Model = "HS8545M5" };
        var events = new List<string>();
        var probe = ProvisioningService.ProbeOnu(device, 7, (step, status, _) => events.Add($"{step}:{status}"),
            (host, _) => host == "fe80::1%7" ? Open : Refused);

        Assert.True(probe.Reachable);
        Assert.Equal("fe80::1%7", device.Host);
        Assert.Contains("reachability:warning", events);
    }

    [Fact]
    public void SiIpv4RespondeNoSeCambiaLaDireccion()
    {
        var device = new DeviceSettings { Host = "192.168.100.1", Model = "HS8545M5" };
        var probe = ProvisioningService.ProbeOnu(device, 7, (_, _, _) => { }, (_, _) => Open);
        Assert.True(probe.Reachable);
        Assert.Equal("192.168.100.1", device.Host);
    }

    [Fact]
    public void SiNingunaRespondeSeConservaElError()
    {
        var device = new DeviceSettings { Host = "192.168.100.1", Model = "HS8545M5" };
        var probe = ProvisioningService.ProbeOnu(device, 7, (_, _, _) => { }, (_, _) => Refused);
        Assert.False(probe.Reachable);
        Assert.Equal("192.168.100.1", device.Host);
    }
}
