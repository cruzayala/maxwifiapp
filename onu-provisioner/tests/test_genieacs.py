from __future__ import annotations

import unittest
from datetime import datetime, timezone

from provisioner.genieacs import GenieAcsClient, GenieAcsError, serial_candidates


def leaf(value, value_type="xsd:string", writable=True):
    return {"_value": value, "_type": value_type, "_writable": writable, "_object": False}


class FakeGenieAcsClient(GenieAcsClient):
    def __init__(self):
        super().__init__("http://local.test")
        self.tasks = []
        self.device = {
            "_id": "00259E-EG8141A5-4857544326D9D8AF",
            "_deviceId": {"_Manufacturer": "Huawei", "_ProductClass": "EG8141A5", "_SerialNumber": "4857544326D9D8AF"},
            "_lastInform": datetime.now(timezone.utc).isoformat(),
            "InternetGatewayDevice": {
                "DeviceInfo": {"SoftwareVersion": leaf("V5R019")},
                "LANDevice": {"1": {"WLANConfiguration": {"1": {
                    "SSID": leaf("ISPMax"), "Enable": leaf(True, "xsd:boolean"),
                    "SSIDAdvertisementEnabled": leaf(True, "xsd:boolean"),
                    "BeaconAdvertisementEnabled": leaf(True, "xsd:boolean"),
                    "RadioEnabled": leaf(True, "xsd:boolean"),
                    "Channel": leaf(11, "xsd:unsignedInt"), "AutoChannelEnable": leaf(False, "xsd:boolean"),
                    "TransmitPower": leaf(100, "xsd:unsignedInt"), "X_HW_Standard": leaf("11bgn"),
                    "X_HW_AssociateNum": leaf(32, "xsd:unsignedInt"), "WMMEnable": leaf(True, "xsd:boolean"),
                    "WPS": {"Enable": leaf(False, "xsd:boolean")}, "KeyPassphrase": leaf("secret"),
                    "PreSharedKey": {"1": {"KeyPassphrase": leaf("")}},
                    "AssociatedDevice": {"1": {"AssociatedDeviceMACAddress": leaf("00:11:22:33:44:55")}},
                }}}},
                "WANDevice": {"1": {"WANConnectionDevice": {"1": {"WANIPConnection": {"1": {
                    "ConnectionStatus": leaf("Connected"), "ExternalIPAddress": leaf("192.168.16.77"),
                    "X_HW_VLAN": leaf(101, "xsd:unsignedInt"),
                }}}}}},
            },
        }

    def _request(self, path, method="GET", body=None):
        if path.startswith("/devices/?"):
            return [self.device]
        if "/tasks?" in path:
            self.tasks.append(body)
            if body["name"] == "setParameterValues":
                for parameter, value, _value_type in body["parameterValues"]:
                    current = self.device
                    for part in parameter.split("."):
                        current = current[part]
                    current["_value"] = value
            return {"status": 200, "_httpStatus": 200}
        raise AssertionError(path)


class SlowRefreshGenieAcsClient(FakeGenieAcsClient):
    def __init__(self, confirms_inform=True):
        super().__init__()
        self.refresh_confirm_timeout = 0.05
        self.confirms_inform = confirms_inform

    def _request(self, path, method="GET", body=None):
        if "/tasks?" in path and body["name"] == "refreshObject":
            if self.confirms_inform:
                self.device["_lastInform"] = "2099-01-01T00:00:00+00:00"
            raise GenieAcsError("GenieACS local no responde: timed out")
        return super()._request(path, method, body)


class RollbackGenieAcsClient(FakeGenieAcsClient):
    def __init__(self):
        super().__init__()
        self.waits = 0

    def _wait_for_values(self, serial, expected, timeout=20.0, progress=None):
        self.waits += 1
        if self.waits == 1:
            return {}, {"expected": expected, "actual": {path: "wrong" for path in expected}, "verified": False}
        return self.snapshot(serial), {"expected": expected, "actual": expected, "verified": True}


class RebootGenieAcsClient(FakeGenieAcsClient):
    def __init__(self):
        super().__init__()
        self.device["InternetGatewayDevice"]["DeviceInfo"]["UpTime"] = leaf(5000, "xsd:unsignedInt", False)

    def _request(self, path, method="GET", body=None):
        if "/tasks?" in path and body["name"] == "reboot":
            self.tasks.append(body)
            self.device["_lastInform"] = "2099-01-01T00:00:00+00:00"
            self.device["InternetGatewayDevice"]["DeviceInfo"]["UpTime"]["_value"] = 8
            return {"_httpStatus": 200}
        return super()._request(path, method, body)


class GenieAcsTests(unittest.TestCase):
    def test_matches_olt_and_raw_tr069_serials(self):
        self.assertIn("4857544326D9D8AF", serial_candidates("HWTC26D9D8AF"))
        self.assertIn("HWTC26D9D8AF", serial_candidates("4857544326D9D8AF"))

    def test_links_different_cwmp_serial_by_unique_expected_wan_ip(self):
        client = FakeGenieAcsClient()
        client.device["_id"] = "D8A000-F670L-ZXXPQN0S3E85208"
        client.device["_deviceId"] = {"_Manufacturer": "ZTE", "_ProductClass": "F670L", "_SerialNumber": "ZXXPQN0S3E85208"}
        client.set_identity_hints("ZXICCD4E795C", {"ip": "192.168.16.77", "model": "F670L"})
        self.assertEqual(client.find_device("ZXICCD4E795C")["_id"], "D8A000-F670L-ZXXPQN0S3E85208")

    def test_builds_a_safe_normalized_snapshot(self):
        snapshot = FakeGenieAcsClient().snapshot("HWTC26D9D8AF")
        self.assertEqual(snapshot["deviceId"], "00259E-EG8141A5-4857544326D9D8AF")
        self.assertEqual(snapshot["wifi"]["ssid"], "ISPMax")
        self.assertEqual(snapshot["wifi"]["channel"], 11)
        self.assertEqual(snapshot["wifi"]["clients"], 1)
        self.assertEqual(snapshot["wifi"]["transmitPower"], 100)
        self.assertEqual(snapshot["wan"]["ip"], "192.168.16.77")
        self.assertNotIn("password", str(snapshot).lower())

    def test_applies_and_verifies_only_allowed_wifi_parameters(self):
        client = FakeGenieAcsClient()
        snapshot = client.set_wifi("HWTC26D9D8AF", {"ssid": "Casa Maximo", "channel": 6})["snapshot"]
        self.assertEqual(snapshot["wifi"]["ssid"], "Casa Maximo")
        self.assertEqual(client.tasks[0]["name"], "setParameterValues")
        self.assertEqual(len(client.tasks[0]["parameterValues"]), 3)

    def test_uses_model_supported_pre_shared_key_path_for_password(self):
        client = FakeGenieAcsClient()
        result = client.set_wifi("HWTC26D9D8AF", {"password": "valid-password"})
        parameter = client.tasks[0]["parameterValues"][0]
        self.assertEqual(
            parameter[0],
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase",
        )
        self.assertNotIn("valid-password", str(result))

    def test_exposes_safe_capabilities_and_parameter_inventory(self):
        client = FakeGenieAcsClient()
        device = client.find_device("HWTC26D9D8AF")
        capabilities = client.capabilities(device)
        snapshot = client.snapshot("HWTC26D9D8AF")
        self.assertEqual(capabilities["actions"]["set_wifi"]["status"], "verified")
        self.assertGreater(capabilities["parameterCount"], 0)
        self.assertNotIn("KeyPassphrase", str(snapshot["parameters"]))

    def test_attempts_rollback_when_readback_does_not_match(self):
        client = RollbackGenieAcsClient()
        with self.assertRaises(GenieAcsError) as context:
            client.set_wifi("HWTC26D9D8AF", {"ssid": "No confirmado"})
        self.assertEqual(context.exception.code, "READBACK_MISMATCH")
        self.assertTrue(context.exception.rollback["attempted"])
        self.assertTrue(context.exception.rollback["succeeded"])

    def test_applies_and_verifies_ssid_broadcast(self):
        client = FakeGenieAcsClient()
        snapshot = client.set_wifi("HWTC26D9D8AF", {"broadcast": False})["snapshot"]
        self.assertFalse(snapshot["wifi"]["broadcast"])
        parameters = client.tasks[0]["parameterValues"]
        self.assertEqual(parameters[0][0], "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSIDAdvertisementEnabled")
        self.assertEqual(parameters[1], [
            "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconAdvertisementEnabled",
            True,
            "xsd:boolean",
        ])

    def test_enabling_wifi_activates_service_and_radio(self):
        client = FakeGenieAcsClient()
        client.set_wifi("HWTC26D9D8AF", {"enabled": True})
        paths = [value[0] for value in client.tasks[0]["parameterValues"]]
        self.assertIn("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable", paths)
        self.assertIn("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.RadioEnabled", paths)

    def test_uses_zte_wifi_paths_without_huawei_only_fields(self):
        client = FakeGenieAcsClient()
        wifi = client.device["InternetGatewayDevice"]["LANDevice"]["1"]["WLANConfiguration"]["1"]
        wifi.pop("BeaconAdvertisementEnabled")
        wifi.pop("X_HW_Standard")
        wifi.pop("X_HW_AssociateNum")
        wifi["Standard"] = leaf("b,g,n", writable=False)
        wifi["X_ZTE-COM_MaxUserNum"] = leaf(32, "xsd:unsignedInt")
        client.set_wifi("HWTC26D9D8AF", {"standard": "b,g,n", "maxClients": 24, "broadcast": True})
        paths = [value[0] for value in client.tasks[0]["parameterValues"]]
        self.assertIn("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_ZTE-COM_MaxUserNum", paths)
        self.assertNotIn("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconAdvertisementEnabled", paths)

    def test_rejects_unknown_actions(self):
        with self.assertRaises(GenieAcsError):
            FakeGenieAcsClient().execute("HWTC26D9D8AF", "unknown_action", {})

    def test_accepts_slow_refresh_when_a_new_inform_confirms_it(self):
        snapshot = SlowRefreshGenieAcsClient().refresh("HWTC26D9D8AF")
        self.assertEqual(snapshot["lastInformAt"], "2099-01-01T00:00:00+00:00")

    def test_rejects_slow_refresh_without_a_new_inform(self):
        with self.assertRaisesRegex(GenieAcsError, "no confirmo"):
            SlowRefreshGenieAcsClient(confirms_inform=False).refresh("HWTC26D9D8AF")

    def test_reboot_requires_new_inform_and_lower_uptime(self):
        result = RebootGenieAcsClient().reboot("HWTC26D9D8AF")
        self.assertTrue(result["verification"]["verified"])
        self.assertTrue(result["verification"]["informChanged"])
        self.assertTrue(result["verification"]["uptimeRestarted"])

    def test_agent_blocks_destructive_actions_before_calling_genieacs(self):
        with self.assertRaises(GenieAcsError) as context:
            FakeGenieAcsClient().execute("HWTC26D9D8AF", "factory_reset", {})
        self.assertEqual(context.exception.code, "ACTION_BLOCKED")


if __name__ == "__main__":
    unittest.main()
