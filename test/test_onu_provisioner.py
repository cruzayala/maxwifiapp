from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "onu-provisioner"))

from provisioner.models import LocalNetworkSettings, ProvisionRequest, RemoteAccessSettings, WanSettings  # noqa: E402
from provisioner.network import is_wired_adapter  # noqa: E402
from provisioner.storage import JobStore  # noqa: E402


class ProvisionRequestTests(unittest.TestCase):
    def test_accepts_known_good_profile(self):
        request = ProvisionRequest(local_network={"adapter_index": 6})
        self.assertEqual(str(request.wan.ip_address), "192.168.16.245")
        self.assertEqual(request.remote_access.source, "192.168.16.1/32")
        self.assertEqual(request.wan.bind_lan_ports, [1, 2, 3, 4])

    def test_rejects_gateway_outside_wan(self):
        with self.assertRaises(ValueError):
            WanSettings(ip_address="192.168.16.245", subnet_mask="255.255.255.0", gateway="192.168.17.1")

    def test_rejects_unsafe_management_protocols(self):
        with self.assertRaises(ValueError):
            RemoteAccessSettings(source="192.168.16.1/32", ssh=True)

    def test_normalizes_remote_source_to_cidr(self):
        settings = RemoteAccessSettings(source="192.168.16.1/255.255.255.255")
        self.assertEqual(settings.source, "192.168.16.1/32")

    def test_requires_local_management_network(self):
        with self.assertRaises(ValueError):
            LocalNetworkSettings(adapter_index=6, address="10.10.10.10", prefix_length=24)

    def test_safe_dump_removes_both_passwords(self):
        request = ProvisionRequest(
            local_network={"adapter_index": 6},
            device={"password": "admin-secret"},
            wifi={"ssid": "Cliente", "password": "wifi-secret"},
        )
        safe = request.safe_dump()
        self.assertEqual(safe["device"]["password"], "***")
        self.assertEqual(safe["wifi"]["password"], "***")
        self.assertNotIn("admin-secret", str(safe))
        self.assertNotIn("wifi-secret", str(safe))


class JobStoreTests(unittest.TestCase):
    def test_persists_sanitized_audit_record(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "jobs.db")
            job = {
                "id": "job-1", "kind": "provision", "status": "queued",
                "created_at": "2026-08-06T00:00:00+00:00", "events": [],
                "result": None, "error": None, "started_at": None, "finished_at": None,
            }
            request = {
                "device": {"host": "192.168.100.1", "password": "***"},
                "wan": {"ip_address": "192.168.16.245"},
                "wifi": {"ssid": "Cliente", "password": "***"},
            }
            store.create(job, request)
            rows = store.recent()
            self.assertEqual(rows[0]["wan_ip"], "192.168.16.245")
            self.assertEqual(rows[0]["ssid"], "Cliente")
            self.assertEqual(rows[0]["status"], "queued")


class NetworkSafetyTests(unittest.TestCase):
    def test_accepts_physical_ethernet(self):
        self.assertTrue(is_wired_adapter({"name": "Ethernet", "description": "Realtek PCIe GbE Family Controller"}))

    def test_blocks_wireless_and_virtual_interfaces(self):
        self.assertFalse(is_wired_adapter({"name": "Wi-Fi", "description": "MediaTek Wireless LAN"}))
        self.assertFalse(is_wired_adapter({"name": "vEthernet (WSL)", "description": "Hyper-V Virtual Ethernet Adapter"}))


if __name__ == "__main__":
    unittest.main()
