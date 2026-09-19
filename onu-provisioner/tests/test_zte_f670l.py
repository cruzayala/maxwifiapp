from __future__ import annotations

import unittest
from ipaddress import IPv4Network
from unittest.mock import Mock

from playwright.sync_api import Error as PlaywrightError

from provisioner.controllers import create_controller
from provisioner.models import DeviceSettings
from provisioner.paths import BACKUP_DIR
from provisioner.zte_f670l import ZteF670L, parse_zte_inventory_snapshot


class ZteF670LTests(unittest.TestCase):
    def test_device_model_accepts_scoped_link_local_address(self):
        settings = DeviceSettings(host="fe80::1%6", model="F670L", username="label-user")
        self.assertEqual(str(settings.host), "fe80::1%6")

    def test_factory_selects_zte_controller(self):
        settings = DeviceSettings(host="fe80::1%6", model="F670L", username="label-user")
        controller = create_controller(settings, BACKUP_DIR, True, adapter_index=6)
        self.assertIsInstance(controller, ZteF670L)

    def test_inventory_parser_normalizes_zte_serial(self):
        snapshot = {
            "pairs": {
                "Model Name": "F670L",
                "Serial Number": "ZTEG1234ABCD",
                "Software Version": "V9.0.1",
                "Hardware Version": "V9",
                "RX Optical Power": "-19.5 dBm",
            },
            "text": "PON State O5",
        }
        parsed = parse_zte_inventory_snapshot(snapshot)
        self.assertEqual(parsed["identity"]["serial"], "ZTEG1234ABCD")
        self.assertEqual(parsed["device"]["model"], "F670L")
        self.assertTrue(parsed["optical"]["signal_available"])

    def test_inventory_parser_does_not_invent_serial(self):
        parsed = parse_zte_inventory_snapshot({"pairs": {"Model": "F670L"}, "text": "No fiber"})
        self.assertIsNone(parsed["identity"]["serial"])

    def test_firmware_v7_inventory_is_normalized_without_secrets(self):
        snapshot = {
            "pages": {
                "device": {"pairs": {"Model": "F670L", "PON Serial Number": "ZXICCD4E795C", "Software Version": "V7.1.10P1T1"}, "text": "Model F670L"},
                "pon_status": {"pairs": {"GPON State": "Initial State(o1)", "Optical Module Input Power(dBm)": "--"}, "text": "GPON State Initial State(o1)"},
                "wan_status": {"controls": {
                    "TextWANCName0": {"value": "Yony4"}, "TextIPMode0": {"value": "Static"},
                    "TextIPAddress0": {"value": "192.168.16.166/255.255.255.0"},
                    "TextIPConnStatus0": {"value": "Disconnected"}, "TextIPConnError0": {"value": "NO Carrier"},
                }},
                "wifi24": {"controls": {"Frm_RadioStatus": {"checked": True}, "Frm_Channel": {"value": "1"}}},
                "wifi24_ssid": {"controls": {"Frm_Enable": {"checked": True}, "Frm_ESSID": {"value": "Yonny4"}, "Frm_MaxUserNum": {"value": "32"}}},
                "wifi24_security": {"controls": {"Frm_Authentication": {"selected": ["WPA/WPA2-PSK"]}, "Frm_KeyPassphrase": {"type": "password"}}},
                "wifi5": {"controls": {}}, "wifi5_ssid": {"controls": {}}, "wifi5_security": {"controls": {}},
                "tr069": {"controls": {"Frm_URL": {"value": "http://0.0.0.0:9090/digest/tr069"}, "Frm_PeriodicInformEnable": {"checked": True}}},
                "ip_filter": {"text": "There is no data, please add one first."},
                "mac_filter": {"text": "There is no data, please add one first."},
                "url_filter": {"text": "There is no data, please add one first."},
                "service_control": {"text": "There is no data, please add one first."},
            },
            "errors": {},
        }
        inventory = ZteF670L._build_inventory(snapshot)
        self.assertEqual(inventory["identity"]["serial"], "ZXICCD4E795C")
        self.assertEqual(inventory["wan"][0]["address"], "192.168.16.166/255.255.255.0")
        self.assertEqual(inventory["wifi"]["radios"][0]["ssid"], "Yonny4")
        self.assertFalse(inventory["tr069"]["configured"])
        self.assertFalse(inventory["security"]["remote_access_rules"])
        def keys(value):
            if isinstance(value, dict):
                return set(value) | set().union(*(keys(item) for item in value.values()))
            if isinstance(value, list):
                return set().union(*(keys(item) for item in value), set())
            return set()
        self.assertFalse({"password", "passphrase", "secret"} & {key.lower() for key in keys(inventory)})

    def test_select_does_not_reapply_an_already_matching_value(self):
        class Control:
            def input_value(self): return "3"
            def is_disabled(self): return False
            def select_option(self, **_kwargs): raise AssertionError("No debe disparar el onchange")

        original = ZteF670L._control
        try:
            ZteF670L._control = staticmethod(lambda page, selector: Control())
            ZteF670L._select(object(), "#Frm_ServList", "3")
        finally:
            ZteF670L._control = staticmethod(original)

    def test_locked_matching_field_is_accepted_and_conflict_is_rejected(self):
        class Control:
            def __init__(self, value): self.value = value
            def input_value(self): return self.value
            def is_disabled(self): return True
            def fill(self, *_args, **_kwargs): raise AssertionError("No debe escribir")

        original = ZteF670L._control
        try:
            ZteF670L._control = staticmethod(lambda page, selector: Control("Route"))
            ZteF670L._fill(object(), "#Frm_mode", "Route")
            with self.assertRaisesRegex(Exception, "bloqueado"):
                ZteF670L._fill(object(), "#Frm_mode", "BRIDGE")
        finally:
            ZteF670L._control = staticmethod(original)

    def test_wan_name_is_deterministic_for_idempotent_retry(self):
        from provisioner.models import LocalNetworkSettings, ProvisionRequest, WanSettings
        request = ProvisionRequest(
            local_network=LocalNetworkSettings(adapter_index=6),
            wan=WanSettings(ip_address="192.168.16.166"),
        )
        self.assertEqual(ZteF670L._wan_name(request), "ISPMax-166")

    def test_empty_security_page_does_not_invent_rules_from_headers(self):
        snapshot = {
            "pages": {
                "device": {"pairs": {"Model": "F670L"}, "text": "F670L"},
                "pon_status": {"pairs": {}, "text": "O1"},
                "ip_filter": {"text": "Enable Service Mode Add Modify", "rows": [["Enable", "Service", "Mode"]]},
                "mac_filter": {"text": "There is no data, please add one first.", "rows": []},
                "url_filter": {"text": "There is no data, please add one first.", "rows": []},
                "service_control": {"text": "Enable Service Mode", "rows": [["Enable", "Service", "Mode"]]},
            },
            "errors": {},
        }
        inventory = ZteF670L._build_inventory(snapshot)
        self.assertFalse(inventory["security"]["ip_filter_rules"])
        self.assertFalse(inventory["security"]["remote_access_rules"])

    def test_open_renews_login_before_opening_each_module(self):
        settings = DeviceSettings(host="192.168.1.1", model="F670L", username="admin")
        controller = ZteF670L(settings, BACKUP_DIR)
        controller._base_url = "http://192.168.1.1"
        controller._login = Mock()
        page = Mock()
        page.goto.return_value.status = 200
        page.locator.return_value.count.return_value = 0

        controller._open(page, "net_wlanm_essid1_t.gch")

        controller._login.assert_called_once_with(page, "http://192.168.1.1")
        page.goto.assert_called_once_with(
            "http://192.168.1.1/getpage.gch?pid=1002&nextpage=net_wlanm_essid1_t.gch",
            wait_until="domcontentloaded",
            timeout=7_000,
        )

    def test_submit_accepts_navigation_context_replacement(self):
        page = Mock()
        page.evaluate.side_effect = [
            True,
            PlaywrightError("Execution context was destroyed, most likely because of a navigation"),
        ]
        navigation = Mock()
        navigation.__enter__ = Mock(return_value=navigation)
        navigation.__exit__ = Mock(return_value=False)
        page.expect_navigation.return_value = navigation
        page.locator.return_value.input_value.side_effect = PlaywrightError("frame was detached")

        ZteF670L._submit_function(page, "pageDel")

        page.wait_for_load_state.assert_called_once_with("domcontentloaded", timeout=2_500)

    def test_submit_does_not_hide_non_navigation_errors(self):
        page = Mock()
        page.evaluate.side_effect = [True, PlaywrightError("Connection refused")]
        navigation = Mock()
        navigation.__enter__ = Mock(return_value=navigation)
        navigation.__exit__ = Mock(return_value=False)
        page.expect_navigation.return_value = navigation

        with self.assertRaisesRegex(PlaywrightError, "Connection refused"):
            ZteF670L._submit_function(page, "pageDel")

    def test_delete_all_wans_verifies_each_profile_disappears(self):
        settings = DeviceSettings(host="fe80::1%7", model="F670L", username="admin")
        controller = ZteF670L(settings, BACKUP_DIR)
        profiles = [
            {"id": "wan1", "name": "yonny"},
            {"id": "wan2", "name": "TR069-old"},
        ]

        class Option:
            def __init__(self, item): self.item = item
            def get_attribute(self, name): return self.item["id"] if name == "value" else None
            def inner_text(self): return self.item["name"]

        class Options:
            def count(self): return len(profiles) + 1
            def nth(self, index):
                return Option({"id": "-1", "name": "New"} if index == 0 else profiles[index - 1])

        class Selector:
            def locator(self, selector):
                self.selector = selector
                return Options()

        controller._open = Mock()
        controller._control = Mock(return_value=Selector())
        controller._select_wan_option = Mock()
        controller._submit_function = Mock(side_effect=lambda *_args: profiles.pop(0))

        deleted = controller._delete_all_wans(Mock())

        self.assertEqual(deleted, ["yonny", "TR069-old"])
        self.assertEqual(controller._submit_function.call_count, 2)

    def test_destructive_wan_replacement_requires_backup(self):
        from provisioner.models import LocalNetworkSettings, ProvisionRequest, WanSettings

        request = ProvisionRequest(
            local_network=LocalNetworkSettings(adapter_index=7),
            wan=WanSettings(ip_address="192.168.16.165"),
            replace_conflicting_wan=True,
            create_backups=False,
        )
        self.assertTrue(request.replace_conflicting_wan)
        self.assertFalse(request.create_backups)
        with self.assertRaisesRegex(Exception, "requiere guardar primero un respaldo"):
            ZteF670L._validate_replacement_backup(request, None)

    def test_remote_rule_requires_exact_range_permit_and_http(self):
        source = IPv4Network("10.254.250.0/24")
        text = "ISPMax-16... 10.254.250.0 10.254.250.255 Permit HTTP"
        self.assertTrue(ZteF670L._remote_rule_matches(text, "ISPMax-166", source))
        self.assertFalse(ZteF670L._remote_rule_matches(text.replace("Permit", "Discard"), "ISPMax-166", source))

    def test_remote_rule_can_be_verified_from_frame_table_rows(self):
        source = IPv4Network("10.254.250.0/24")
        snapshot = {
            "text": "Service Control",
            "rows": [["Enabled", "ISPMax-16", "10.254.250.0", "10.254.250.255", "Permit", "HTTP"]],
        }
        self.assertTrue(ZteF670L._remote_snapshot_matches(snapshot, "ISPMax-166", source))

    def test_remote_rule_is_verified_from_zte_hidden_row_controls(self):
        source = IPv4Network("10.254.250.0/24")
        snapshot = {"text": "Service Control", "rows": [], "controls": {
            "Enable0": {"value": "1"},
            "INCName0": {"value": "ISPMax-166"},
            "MinSrcIp0": {"value": "10.254.250.0"},
            "MaxSrcIp0": {"value": "10.254.250.255"},
            "FilterTarget0": {"value": "1"},
            "Servise0": {"value": "1"},
        }}
        self.assertTrue(ZteF670L._remote_snapshot_matches(snapshot, "ISPMax-166", source))
        snapshot["controls"]["MaxSrcIp0"]["value"] = "10.254.250.254"
        self.assertFalse(ZteF670L._remote_snapshot_matches(snapshot, "ISPMax-166", source))


if __name__ == "__main__":
    unittest.main()
