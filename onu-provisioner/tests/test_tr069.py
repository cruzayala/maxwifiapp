from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from pydantic import SecretStr, ValidationError

from provisioner.huawei_eg8141a5 import HuaweiEg8141A5, OnuProvisioningError
from provisioner.models import LocalNetworkSettings, ProvisionRequest, Tr069Settings
from provisioner.storage import JobStore


class Tr069SettingsTests(unittest.TestCase):
    class FakeOptions:
        def __init__(self, values):
            self.values = values

        def evaluate_all(self, _script):
            return self.values

    class FakeSelect:
        def __init__(self, value, *, enabled=True, visible=True, values=None):
            self.value = value
            self.enabled = enabled
            self.visible = visible
            self.values = values or [value]
            self.selections = []

        def count(self): return 1
        def wait_for(self, **_kwargs): return None
        def input_value(self, **_kwargs): return self.value
        def evaluate(self, _script): return not self.enabled
        def is_visible(self): return self.visible
        def is_enabled(self): return self.enabled
        def locator(self, _selector): return Tr069SettingsTests.FakeOptions(self.values)

        def select_option(self, *, value, **_kwargs):
            self.selections.append(value)
            self.value = value

    class FakeFrame:
        def __init__(self, control): self.control = control
        def locator(self, _selector): return self.control

    class FakeCheckbox:
        def __init__(self, checked=False):
            self.checked = checked

        def count(self): return 1
        def wait_for(self, **_kwargs): return None
        def is_checked(self): return self.checked
        def is_visible(self): return True
        def is_enabled(self): return True
        def set_checked(self, checked, **_kwargs): self.checked = checked

    class FakeButton:
        def __init__(self): self.clicked = False
        def is_visible(self): return True
        def is_enabled(self): return True
        def click(self, **_kwargs): self.clicked = True

    class FakeButtons:
        def __init__(self, buttons): self.buttons = buttons
        def all(self): return self.buttons

    class FakeLanFrame:
        def __init__(self, states):
            self.checkboxes = {
                f"#cb_Lan{port}": Tr069SettingsTests.FakeCheckbox(states.get(port, False))
                for port in range(1, 5)
            }
            self.apply = Tr069SettingsTests.FakeButton()

        def locator(self, selector):
            if selector == "#Apply":
                return Tr069SettingsTests.FakeButtons([self.apply])
            return self.checkboxes[selector]

    def test_disabled_service_list_with_matching_value_is_accepted(self):
        control = self.FakeSelect(
            "TR069_INTERNET", enabled=False, values=["INTERNET", "TR069_INTERNET"]
        )
        changed = HuaweiEg8141A5._select(
            self.FakeFrame(control), "#ServiceList", "TR069_INTERNET", required=True
        )
        self.assertFalse(changed)
        self.assertEqual(control.selections, [])

    def test_disabled_required_field_with_conflicting_value_fails_fast(self):
        control = self.FakeSelect(
            "INTERNET", enabled=False, values=["INTERNET", "TR069_INTERNET"]
        )
        with self.assertRaises(OnuProvisioningError) as context:
            HuaweiEg8141A5._select(
                self.FakeFrame(control), "#ServiceList", "TR069_INTERNET", required=True
            )
        self.assertEqual(context.exception.code, "ONU_IMMUTABLE_FIELD_CONFLICT")
        self.assertFalse(context.exception.retryable)

    def test_acl_inventory_excludes_headers_without_real_rule(self):
        rows = [
            "WAN Name Protocol Source Status HTTP",
            "1_TR069_INTERNET_R_VID_101 HTTP 192.168.16.1/32 Enable",
        ]
        self.assertEqual(
            HuaweiEg8141A5._actual_acl_rows(rows),
            ["1_TR069_INTERNET_R_VID_101 HTTP 192.168.16.1/32 Enable"],
        )

    def test_hidden_select_option_is_not_clicked_as_a_wan_row(self):
        class Candidate:
            def __init__(self, visible: bool):
                self.visible = visible
                self.clicked = False

            def is_visible(self):
                return self.visible

            def is_enabled(self):
                return True

            def click(self):
                self.clicked = True

        class ExactTextLocator:
            def __init__(self, candidates):
                self.candidates = candidates

            def all(self):
                return self.candidates

        class Frame:
            def __init__(self, candidates):
                self.candidates = candidates

            def get_by_text(self, _text, exact=False):
                self.exact = exact
                return ExactTextLocator(self.candidates)

        hidden_option = Candidate(visible=False)
        visible_row = Candidate(visible=True)
        frame = Frame([hidden_option, visible_row])

        clicked = HuaweiEg8141A5._click_visible_exact_text(
            frame, "1_TR069_INTERNET_R_VID_101"
        )

        self.assertTrue(clicked)
        self.assertTrue(frame.exact)
        self.assertFalse(hidden_option.clicked)
        self.assertTrue(visible_row.clicked)

    def test_lan_port_mode_enables_requested_ports_and_preserves_existing_ports(self):
        frame = self.FakeLanFrame({2: True})
        controller = HuaweiEg8141A5.__new__(HuaweiEg8141A5)
        controller.dialogs = []
        controller._open_lan_port_mode = lambda _page: frame
        controller._raise_for_dialog_error = lambda _operation: None

        result = controller._configure_lan_port_mode(object(), [4, 1])

        self.assertTrue(frame.apply.clicked)
        self.assertEqual(result["requested"], ["LAN1", "LAN4"])
        self.assertEqual(result["changed"], ["LAN1", "LAN4"])
        self.assertEqual(result["enabled"], ["LAN1", "LAN2", "LAN4"])

    def test_lan_port_mode_does_not_apply_when_requested_ports_are_already_enabled(self):
        frame = self.FakeLanFrame({1: True, 2: True})
        controller = HuaweiEg8141A5.__new__(HuaweiEg8141A5)
        controller.dialogs = []
        controller._open_lan_port_mode = lambda _page: frame
        controller._raise_for_dialog_error = lambda _operation: None

        result = controller._configure_lan_port_mode(object(), [1, 2])

        self.assertFalse(frame.apply.clicked)
        self.assertEqual(result["changed"], [])
        self.assertEqual(result["enabled"], ["LAN1", "LAN2"])

    def test_lan_port_mode_rejects_ports_outside_the_physical_model(self):
        controller = HuaweiEg8141A5.__new__(HuaweiEg8141A5)

        with self.assertRaises(OnuProvisioningError) as context:
            controller._configure_lan_port_mode(object(), [5])

        self.assertEqual(context.exception.code, "ONU_UNSUPPORTED_LAN_PORT")
        self.assertFalse(context.exception.retryable)

    def test_retry_template_never_returns_password_fields(self):
        with TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.db")
            store.create(
                {
                    "id": "failed-job",
                    "kind": "provision",
                    "status": "error",
                    "created_at": "2026-08-10T00:00:00+00:00",
                    "events": [],
                },
                {
                    "device": {"host": "192.168.100.1", "password": "***"},
                    "wifi": {"ssid": "ISPMax prueba", "password": "***"},
                    "tr069": {
                        "password": "***",
                        "connection_request_password": "***",
                    },
                },
            )

            template = store.retry_template("failed-job")

            self.assertIsNotNone(template)
            self.assertNotIn("password", template["request"]["device"])
            self.assertNotIn("password", template["request"]["wifi"])
            self.assertNotIn("password", template["request"]["tr069"])
            self.assertNotIn("connection_request_password", template["request"]["tr069"])

    def test_recognizes_only_transient_browser_navigation_errors(self):
        self.assertTrue(
            HuaweiEg8141A5._is_transient_navigation_error(
                RuntimeError("Execution context was destroyed, most likely because of a navigation")
            )
        )
        self.assertFalse(
            HuaweiEg8141A5._is_transient_navigation_error(RuntimeError("Connection refused"))
        )

    def test_normalizes_acs_url_and_builds_combined_wan_name(self):
        request = ProvisionRequest(
            local_network=LocalNetworkSettings(adapter_index=6),
            tr069=Tr069Settings(acs_url="http://10.254.250.2:7547"),
        )

        self.assertEqual(request.tr069.acs_url, "http://10.254.250.2:7547/")
        self.assertEqual(HuaweiEg8141A5._wan_service(request), "TR069_INTERNET")
        self.assertEqual(
            HuaweiEg8141A5._wan_connection_name(request),
            "1_TR069_INTERNET_R_VID_101",
        )

    def test_reuses_compatible_internet_wan_on_the_same_vlan(self):
        request = ProvisionRequest(
            local_network=LocalNetworkSettings(adapter_index=6),
            tr069=Tr069Settings(acs_url="http://10.254.250.2:7547"),
        )

        selected = HuaweiEg8141A5._compatible_wan_connection(
            request,
            ["1_INTERNET_R_VID_101", "2_VOIP_R_VID_200"],
        )

        self.assertEqual(selected, "1_INTERNET_R_VID_101")

    def test_does_not_reuse_an_internet_wan_from_another_vlan(self):
        request = ProvisionRequest(local_network=LocalNetworkSettings(adapter_index=6))

        selected = HuaweiEg8141A5._compatible_wan_connection(
            request,
            ["1_INTERNET_R_VID_200"],
        )

        self.assertIsNone(selected)

    def test_rejects_acs_url_with_embedded_credentials(self):
        with self.assertRaises(ValidationError):
            Tr069Settings(acs_url="http://user:secret@10.254.250.2:7547/")

    def test_masks_all_protected_values_in_history_payload(self):
        request = ProvisionRequest(
            local_network=LocalNetworkSettings(adapter_index=6),
            tr069=Tr069Settings(
                password=SecretStr("acs-secret"),
                connection_request_password=SecretStr("request-secret"),
            ),
        )

        payload = request.safe_dump()

        self.assertEqual(payload["device"]["password"], "***")
        self.assertEqual(payload["wifi"]["password"], "***")
        self.assertEqual(payload["tr069"]["password"], "***")
        self.assertEqual(payload["tr069"]["connection_request_password"], "***")


if __name__ == "__main__":
    unittest.main()
