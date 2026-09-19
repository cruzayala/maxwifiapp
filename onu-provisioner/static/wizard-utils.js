(function exposeWizardUtils(root) {
  function ipv4ToInt(ip) {
    const parts = String(ip).split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      throw new Error('Direccion IPv4 invalida');
    }
    return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
  }

  function intToIpv4(value) {
    const unsigned = value >>> 0;
    return [24, 16, 8, 0].map((shift) => (unsigned >>> shift) & 255).join('.');
  }

  function prefixToMask(prefix) {
    const bits = Number(prefix);
    if (!Number.isInteger(bits) || bits < 1 || bits > 30) throw new Error('Prefijo IPv4 invalido');
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return intToIpv4(mask);
  }

  function deriveNetworkProfile(cidr) {
    const [rawNetwork, rawPrefix] = String(cidr || '').split('/');
    const prefix = Number(rawPrefix);
    const subnetMask = prefixToMask(prefix);
    const maskInt = (0xffffffff << (32 - prefix)) >>> 0;
    const networkInt = (ipv4ToInt(rawNetwork) & maskInt) >>> 0;
    return {
      cidr: `${intToIpv4(networkInt)}/${prefix}`,
      subnetMask,
      gateway: intToIpv4(networkInt + 1),
      prefix,
    };
  }

  function buildSsid(clientName, ip) {
    const cleanName = String(clientName || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const suffix = cleanName || String(ip || '').split('.').pop() || 'Cliente';
    return `ISPMax ${suffix}`.slice(0, 32).trim();
  }

  function generateWifiPassword(randomValues) {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const values = randomValues || root.crypto.getRandomValues(new Uint8Array(12));
    if (values.length < 12) throw new Error('Se requieren 12 valores aleatorios');
    const password = Array.from(values.slice(0, 12), (value) => alphabet[value % alphabet.length]);
    password[0] = upper[values[0] % upper.length];
    password[1] = lower[values[1] % lower.length];
    password[2] = digits[values[2] % digits.length];
    return password.join('');
  }

  function isRecoverableCloudJobStatus(status) {
    return ['in_progress', 'waiting_optical', 'partial', 'failed'].includes(
      String(status || '').trim().toLowerCase()
    );
  }

  function shouldResetForAbsence(status, consecutiveScans, busy) {
    const physicallyAbsent = ['cable_disconnected', 'not_detected'].includes(
      String(status || '').trim().toLowerCase()
    );
    return !busy && physicallyAbsent && Number(consecutiveScans) >= 2;
  }

  const api = {
    deriveNetworkProfile,
    buildSsid,
    generateWifiPassword,
    isRecoverableCloudJobStatus,
    shouldResetForAbsence,
    prefixToMask,
  };
  root.OnuWizard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
