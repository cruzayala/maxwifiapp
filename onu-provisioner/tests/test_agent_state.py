import tempfile
import unittest
from pathlib import Path

from provisioner.secure_store import SecureJsonStore
from provisioner.storage import JobStore


class AgentStateTests(unittest.TestCase):
    def test_secure_store_roundtrip_never_writes_plain_token(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cloud-session.dat"
            store = SecureJsonStore(path)
            store.save({"device_token": "very-secret-device-token", "user": {"username": "admin"}})
            self.assertNotIn(b"very-secret-device-token", path.read_bytes())
            self.assertEqual(store.load()["device_token"], "very-secret-device-token")
            store.delete()
            self.assertFalse(path.exists())

    def test_network_ranges_are_seeded_and_replaceable(self):
        with tempfile.TemporaryDirectory() as directory:
            store = JobStore(Path(directory) / "agent.db")
            self.assertEqual(store.network_ranges()[0]["cidr"], "192.168.16.0/24")
            rows = store.replace_network_ranges([{
                "id": "fiber-main", "name": "Fibra", "cidr": "192.168.20.0/24", "vlan": 101,
                "gateway": "192.168.20.1", "primary_dns": "8.8.8.8", "secondary_dns": "",
                "priority": 10, "allocation_start": "192.168.20.2", "allocation_end": "192.168.20.254",
                "exclusions": ["192.168.20.1"], "active": True,
            }])
            self.assertEqual(rows[0]["cidr"], "192.168.20.0/24")
            self.assertEqual(rows[0]["exclusions"], ["192.168.20.1"])


if __name__ == "__main__":
    unittest.main()
