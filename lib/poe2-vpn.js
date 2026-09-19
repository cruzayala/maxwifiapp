const net = require('node:net');

const INSTANCE_PATTERN = /Connecting to instance server at\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})/g;
const LOGIN_HOST_PATTERN = /(?:Async connecting to|Connected to)\s+([a-z0-9.-]*pathofexile(?:2)?\.com)(?::|\s)/gi;

function isPublicIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const octets = address.split('.').map(Number);
  return !(
    octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224
  );
}

function extractInstanceServers(text) {
  const servers = [];
  const seen = new Set();
  for (const match of text.matchAll(INSTANCE_PATTERN)) {
    const address = match[1];
    const port = Number(match[2]);
    const key = `${address}:${port}`;
    if (!isPublicIpv4(address) || port < 1 || port > 65535 || seen.has(key)) continue;
    seen.add(key);
    servers.push({ address, port });
  }
  return servers;
}

function buildAddressSet(logTexts, extraAddresses = []) {
  const addresses = new Set();
  for (const text of logTexts) {
    for (const server of extractInstanceServers(text)) addresses.add(`${server.address}/32`);
  }
  for (const address of extraAddresses) {
    if (isPublicIpv4(address)) addresses.add(`${address}/32`);
  }
  return addresses;
}

function extractLoginHosts(text) {
  const hosts = new Set();
  for (const match of text.matchAll(LOGIN_HOST_PATTERN)) hosts.add(match[1].toLowerCase());
  return [...hosts];
}

module.exports = {
  buildAddressSet,
  extractLoginHosts,
  extractInstanceServers,
  isPublicIpv4,
};
