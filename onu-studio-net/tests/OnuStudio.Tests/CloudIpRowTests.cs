using OnuStudio.Core.Cloud;
using Xunit;

namespace OnuStudio.Tests;

public class CloudIpRowTests
{
    [Theory]
    [InlineData("available", true)] // lo que envia ISP Max
    [InlineData("free", true)]      // modo de prueba
    [InlineData("arp", false)]
    [InlineData("reserved", false)]
    [InlineData(null, false)]
    public void LasLibresDeIspMaxSeOfrecen(string? status, bool free) =>
        Assert.Equal(free, new CloudIpRow { Ip = "192.168.16.6", Status = status }.IsFree);
}
