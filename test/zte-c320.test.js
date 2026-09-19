'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ZteC320Client,
  assertOnuIndex,
  assertPonIndex,
  assertOnuName,
  buildOnuOperationCommands,
  buildOnuRenameCommands,
  extractOnuManagementBlock,
  buildOnuTypeProfileCommands,
  buildInternetProfileCommands,
  buildProvisioningCommands,
  firstDbm,
  findInternetSpeedProfile,
  normalizeGponSerial,
  parseAlarms,
  parseOnuBaseInfo,
  parseOnuInterfaceStats,
  parseOnuMacTable,
  parseOnuStates,
  parseOnuTypeCatalog,
  parseUnconfiguredOnus,
  parseConfiguredOnuIds,
  parseProvisioningCatalog,
  parseTemperatures,
  summarizePons,
  parseAttenuation,
  resolveClientMapping,
  classifyOnuServiceMode,
} = require('../lib/zte-c320');

test('F670L ONU type profile matches the safe generic GPON limits', () => {
  assert.deepEqual(buildOnuTypeProfileCommands('F670L'), [
    'configure terminal', 'pon', 'onu-type F670L gpon',
    'onu-type F670L gpon max-tcont 8', 'onu-type F670L gpon max-gemport 32',
    'onu-type F670L gpon max-switch-perslot 8', 'onu-type F670L gpon max-flow-perswitch 8',
    'onu-type F670L gpon max-iphost 5', 'exit', 'end',
  ]);
  assert.throws(() => buildOnuTypeProfileCommands('F670L;reload'), /no admitido/);
});

test('ONU type catalog parses C320 GPON capabilities', () => {
  const rows = parseOnuTypeCatalog(`ONU type name: F670L\nPON type: gpon\nMax T-CONT: 8\nMax GEM port: 32\nMax switch per slot: 8\nMax flow per switch: 8\nMax IP host: 5\nOMCI send mode: async\nExtended OMCI: disable`);
  assert.deepEqual(rows[0], {
    name: 'F670L', ponType: 'gpon', description: null, maxTcont: 8, maxGemport: 32,
    maxSwitchPerSlot: 8, maxFlowPerSwitch: 8, maxIpHost: 5, omciSendMode: 'async', extendedOmci: 'disable',
  });
});

test('GPON serial normalization matches Huawei hexadecimal and ZTE canonical formats', () => {
  assert.equal(normalizeGponSerial('485754439EC8CEAF'), 'HWTC9EC8CEAF');
  assert.equal(normalizeGponSerial('SN:HWTC9EC8CEAF'), 'HWTC9EC8CEAF');
});

test('ZTE ONU state parser normalizes interfaces and online state', () => {
  const onus = parseOnuStates(`
1/1/1:1  enable  enable  working  1(GPON)
1/1/1:24 enable  enable  LOS      1(GPON)
1/1/10:9 enable  enable  DyingGasp 1(GPON)
ONU Number: 1/3
  `);
  assert.equal(onus.length, 3);
  assert.deepEqual(onus[0], {
    onuIndex: '1/1/1:1', interfaceName: 'gpon-onu_1/1/1:1', rack: 1, shelf: 1,
    pon: 1, onuId: 1, adminState: 'enable', omccState: 'enable', phaseState: 'working',
    channel: '1(GPON)', online: true,
  });
  assert.equal(onus[1].online, false);
});

test('ZTE base info parser extracts model and serial', () => {
  const rows = parseOnuBaseInfo('gpon-onu_1/1/1:1 HG8546M sn SN:HWTC12345678 ready');
  assert.deepEqual(rows[0], {
    onuIndex: '1/1/1:1', model: 'HG8546M', authMode: 'sn', serial: 'HWTC12345678', phaseState: 'ready',
  });
});

test('ZTE unconfigured parser accepts the temporary ONU index returned by the C320', () => {
  const rows = parseUnconfiguredOnus(`
OnuIndex                 Sn                  State
---------------------------------------------------------------------
gpon-onu_1/1/13:1        HWTC60C98CAF        unknown
  `);
  assert.deepEqual(rows, [{ ponIndex: '1/1/13', serial: 'HWTC60C98CAF' }]);
});

test('ZTE provisioning catalog reads actual ONU types, profiles and free IDs', () => {
  const catalog = parseProvisioningCatalog(`
gpon
 profile tcont ADMINOLT-100-MEGAS-UP type 5 fixed 64 assured 64 maximum 102400
 profile traffic ADMINOLT-100-MEGAS-DOWN sir 102400 pir 102400
interface gpon-olt_1/1/13
 onu 1 type V2804RGT sn HSDO39023895
 onu 3 type HG8546M sn HWTC60621A7C
  `);
  assert.deepEqual(catalog.onuTypes, [{ name: 'HG8546M', usage: 1 }, { name: 'V2804RGT', usage: 1 }]);
  assert.equal(catalog.tcontProfiles[0].name, 'ADMINOLT-100-MEGAS-UP');
  assert.equal(catalog.trafficProfiles[0].name, 'ADMINOLT-100-MEGAS-DOWN');
  assert.deepEqual(parseConfiguredOnuIds('onu 1 type V2804RGT sn HSDO39023895\nonu 3 type HG8546M sn HWTC60621A7C'), [1, 3]);
});

test('ZTE speed profile creation reuses semantic matches and creates only missing pairs', () => {
  const catalog = parseProvisioningCatalog(`
gpon
 profile tcont ADMINOLT-100-MEGAS-UP type 5 fixed 64 assured 64 maximum 102400
 profile traffic ADMINOLT-100-MEGAS-DOWN sir 102400 pir 102400
  `);
  assert.equal(findInternetSpeedProfile(catalog.tcontProfiles, 100, 'up').name, 'ADMINOLT-100-MEGAS-UP');
  const plan = buildInternetProfileCommands([5, 100], catalog);
  assert.equal(plan.plans[1].createTcont, false);
  assert.ok(plan.commands.includes('profile tcont ISPMAX-5M-UP type 5 fixed 64 assured 64 maximum 5120'));
  assert.ok(plan.commands.includes('profile traffic ISPMAX-5M-DOWN sir 5120 pir 5120'));
  assert.ok(!plan.commands.some((command) => command.includes('ISPMAX-100M')));
});

test('ZTE provisioning builds the approved VLAN 101 command sequence only', () => {
  const plan = buildProvisioningCommands({
    ponIndex: '1/1/13', onuId: 2, serial: 'HWTC60C98CAF', onuType: 'HG8546M', name: 'Cliente_Prueba',
    vlan: 101, tcontProfile: 'ADMINOLT-100-MEGAS-UP', trafficProfile: 'ADMINOLT-100-MEGAS-DOWN',
    managementIp: '192.168.16.245', mask: '255.255.255.0', gateway: '192.168.16.1',
    primaryDns: '8.8.8.8', secondaryDns: '8.8.4.4',
  });
  assert.equal(plan.onuIndex, '1/1/13:2');
  assert.ok(plan.groups.flatMap((group) => group.commands).includes('onu 2 type HG8546M sn HWTC60C98CAF'));
  assert.ok(plan.groups.flatMap((group) => group.commands).includes('service-port 1 vport 1 user-vlan 101 vlan 101'));
  assert.throws(() => buildProvisioningCommands({
    ponIndex: '1/1/13', onuId: 2, serial: 'HWTC60C98CAF;reload', onuType: 'HG8546M', name: 'x', vlan: 101,
    tcontProfile: 'UP', trafficProfile: 'DOWN', managementIp: '192.168.16.2', mask: '255.255.255.0',
    gateway: '192.168.16.1', primaryDns: '8.8.8.8', secondaryDns: '8.8.4.4',
  }), /Serial invalido/);
  assert.equal(assertPonIndex('1/1/13'), '1/1/13');
});

test('ZTE bridge provisioning delivers VLAN to Ethernet without ip-host', () => {
  const plan = buildProvisioningCommands({
    ponIndex: '1/1/13', onuId: 9, serial: 'ZXIC12345678', onuType: 'F670L', name: 'Bridge_Prueba',
    serviceMode: 'bridge', lanPorts: [1, 2], vlan: 101,
    tcontProfile: 'ISPMAX-100M-UP', trafficProfile: 'ISPMAX-100M-DOWN',
  });
  const commands = plan.groups.flatMap((group) => group.commands);
  assert.equal(plan.serviceMode, 'bridge');
  assert.ok(commands.includes('vlan port eth_0/1 mode tag vlan 101'));
  assert.ok(commands.includes('vlan port eth_0/2 mode tag vlan 101'));
  assert.ok(!commands.some((command) => command.startsWith('ip-host ')));
  assert.ok(!commands.some((command) => command.includes('veip')));
});

test('PON summary counts online and offline ONUs', () => {
  const rows = parseOnuStates('1/1/2:1 enable enable working 1(GPON)\n1/1/2:2 enable enable LOS 1(GPON)');
  assert.deepEqual(summarizePons(rows), [{ ponIndex: '1/1/2', rack: 1, shelf: 1, pon: 2, total: 2, online: 1, offline: 1 }]);
});

test('ONU interface statistics expose live upstream and downstream traffic in bits per second', () => {
  const traffic = parseOnuInterfaceStats(`ONU statistic:
   Input rate :               27176 Bps               91 pps
   Output rate:              696633 Bps              550 pps
Interface peak rate:
   Input peak rate :         1008469 Bps             1279 pps
   Output peak rate:         1901727 Bps             3022 pps
Total statistic:
  Input:
    Bytes:95877378520          Packets:517349600
  Output:
    Bytes:1024296053995        Packets:863915000`);
  assert.equal(traffic.upstreamBps, 217408);
  assert.equal(traffic.downstreamBps, 5573064);
  assert.equal(traffic.peakDownstreamBps, 15213816);
  assert.equal(traffic.totalUpstreamBytes, 95877378520);
  assert.equal(traffic.totalDownstreamBytes, 1024296053995);
});

test('ONU MAC table parser normalizes ZTE dotted addresses', () => {
  const rows = parseOnuMacTable(`Total mac address : 2
Mac address      Vlan  Type      Port                       Vc
-------------------------------------------------------------------------------
00eb.d83e.3dd1   101   Dynamic   gpon-onu_1/1/10:9        vport 1
386b.1c8b.93b5   101   Dynamic   gpon-onu_1/1/10:9        vport 1`);
  assert.deepEqual(rows, [
    { macAddress: '00:EB:D8:3E:3D:D1', vlan: 101, type: 'Dynamic', interfaceName: 'gpon-onu_1/1/10:9', vport: 'vport 1' },
    { macAddress: '38:6B:1C:8B:93:B5', vlan: 101, type: 'Dynamic', interfaceName: 'gpon-onu_1/1/10:9', vport: 'vport 1' },
  ]);
});

test('ONU access mode identifies bridge service from VLAN delivery and learned MACs', () => {
  const result = classifyOnuServiceMode({
    model: 'HG8310M',
    interfaceConfig: 'service-port 1 vport 1 user-vlan 101 vlan 101',
    managementConfig: 'flow 1 pri 0 vlan 101\ngemport 1 flow 1\nvlan port eth_0/1 mode tag vlan 101',
    macCount: 4,
  });
  assert.equal(result.mode, 'bridge');
  assert.equal(result.confidence, 'high');
  assert.match(result.evidence.join(' '), /4 MAC/);
});

test('ONU access mode prioritizes routed WAN evidence over bridge-compatible flows', () => {
  const result = classifyOnuServiceMode({
    model: 'HG8546M',
    managementConfig: 'flow 1 pri 0 vlan 101\ngemport 1 flow 1\nswitchport-bind switch_0/1 veip 1\nip-host 1 ip 192.168.16.36 mask 255.255.255.0 gateway 192.168.16.1',
    macCount: 1,
  });
  assert.equal(result.mode, 'router');
  assert.equal(result.confidence, 'high');
  assert.match(result.limitation, /TR-069/);
});

test('ONU identifiers reject command injection', () => {
  assert.equal(assertOnuIndex('1/1/10:9'), '1/1/10:9');
  assert.throws(() => assertOnuIndex('1/1/1:1; reload'), /invalido/);
});

test('reboot remains an isolated direct ONU operation', () => {
  assert.deepEqual(buildOnuOperationCommands('1/1/13:2', 'reboot'), [
    'configure terminal', 'pon-onu-mng gpon-onu_1/1/13:2', 'reboot', 'exit', 'end',
  ]);
  assert.throws(() => buildOnuOperationCommands('1/1/13:2;reload', 'reboot'), /invalido/);
  assert.throws(() => buildOnuOperationCommands('1/1/13:2', 'factory-reset'), /no soportada/);
});

test('ONU rename validates the CLI name and uses the interface context', () => {
  assert.equal(assertOnuName('Francis_Valerio_fibra'), 'Francis_Valerio_fibra');
  assert.deepEqual(buildOnuRenameCommands('1/1/1:18', 'Francis_Valerio_fibra'), [
    'configure terminal', 'interface gpon-onu_1/1/1:18', 'name Francis_Valerio_fibra', 'exit', 'end', 'write',
  ]);
  assert.throws(() => assertOnuName('Francis Valerio'), /invalido/);
  assert.throws(() => buildOnuRenameCommands('1/1/1:18', 'Francis;reload'), /invalido/);
});

test('ONU rename reads the name back before reporting success', async () => {
  const client = new ZteC320Client({ host: '127.0.0.1', username: 'test', password: 'test' });
  const calls = [];
  const details = [{ name: 'Damaris' }, { name: 'Francis_Valerio_fibra' }];
  client.connect = async () => { calls.push('connect'); };
  client.command = async (command) => { calls.push(command); return ''; };
  client.fetchOnuDetail = async () => details.shift();
  const result = await client.renameOnu('1/1/1:18', 'Francis_Valerio_fibra');
  assert.equal(result.verified, true);
  assert.equal(result.oldName, 'Damaris');
  assert.ok(calls.includes('name Francis_Valerio_fibra'));
  assert.equal(calls.at(-1), 'write');
});

test('OLT rollback establishes a connection before removing the ONU', async () => {
  const client = new ZteC320Client({ host: '127.0.0.1', username: 'test', password: 'test' });
  const calls = [];
  client.connect = async () => { calls.push('connect'); };
  client.command = async (command) => { calls.push(command); return ''; };
  await client.rollbackProvisioning('1/1/1', 18);
  assert.deepEqual(calls, [
    'connect', 'end', 'configure terminal', 'interface gpon-olt_1/1/1',
    'no onu 18', 'exit', 'end', 'write',
  ]);
});

test('ONU configuration backup extracts only the requested management block', () => {
  const config = `pon-onu-mng gpon-onu_1/1/1:18
  flow 1 pri 0 vlan 101
  ip-host 1 ip 192.168.16.36 mask 255.255.255.0 gateway 192.168.16.1
pon-onu-mng gpon-onu_1/1/1:19
  flow 1 pri 0 vlan 101`;
  assert.equal(extractOnuManagementBlock(config, '1/1/1:18'), `pon-onu-mng gpon-onu_1/1/1:18
  flow 1 pri 0 vlan 101
  ip-host 1 ip 192.168.16.36 mask 255.255.255.0 gateway 192.168.16.1`);
});

test('ZTE optical parser accepts parenthesized firmware units', () => {
  assert.deepEqual(parseAttenuation('up Rx :-21.375(dbm) Tx:2.310(dbm) 23.685(dB)\ndown Tx:6.630(dbm) Rx:-19.958(dbm) 26.588(dB)'), {
    attenuationUpDb: 23.685,
    attenuationDownDb: 26.588,
  });
  assert.equal(firstDbm('gpon-onu_1/1/1:1 -19.914(dbm)'), -19.914);
});

test('ZTE card temperatures and labeled alarms match C320 output', () => {
  const temperatures = parseTemperatures('1    1     1    45          45          45          N/A.');
  assert.equal(temperatures.get('1/1/1'), 45);
  const alarms = parseAlarms(`Alarm ID : 9599\nAlarm Code : 43066\nAlarm Level : critical\nAlarm Time : 18:19 UTC\nAlarmDesInfo : GPON alarm olt los\nProbable Cause : LastOnuLos`);
  assert.equal(alarms.length, 1);
  assert.equal(alarms[0].level, 'critical');
  assert.match(alarms[0].description, /LastOnuLos/);
});

test('OLT client mappings survive state-only syncs and manual links take precedence', () => {
  const manual = { clientIdServicio: 10, mappingSource: 'manual' };
  const automatic = { clientIdServicio: 20, mappingSource: 'serial' };
  assert.deepEqual(resolveClientMapping(manual, 30, true), {});
  assert.deepEqual(resolveClientMapping(automatic, null, false), {});
  assert.equal(resolveClientMapping(automatic, 30, true).clientIdServicio, 30);
  assert.equal(resolveClientMapping(automatic, null, true).clientIdServicio, null);
});
