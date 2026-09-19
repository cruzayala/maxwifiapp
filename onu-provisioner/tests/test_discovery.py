from __future__ import annotations

import unittest
from ipaddress import IPv4Address

from provisioner.discovery import adapter_for_host, infer_device


class DiscoveryTests(unittest.TestCase):
    def test_identifies_huawei_product_name(self):
        result = infer_device("<script>var ProductName = 'EG8141A5';</script><input id='txt_Username'><button id='loginbutton'>")
        self.assertEqual(result["model"], "EG8141A5")
        self.assertEqual(result["vendor"], "Huawei / Novatech")
        self.assertEqual(result["fingerprint"], "huawei-webui")

    def test_identifies_zte_f670l_login(self):
        result = infer_device(
            "<title>F670L</title><input id='Frm_Username'><input id='Frm_Password'>",
            {"server": "Mini web server 1.0 ZTE corp 2005."},
        )
        self.assertEqual(result["model"], "F670L")
        self.assertEqual(result["vendor"], "ZTE")
        self.assertEqual(result["fingerprint"], "zte-webui")

    def test_matches_only_up_wired_adapter_on_management_subnet(self):
        adapters = [
            {"index": 4, "name": "Wi-Fi", "status": "Up", "supported": False, "addresses": ["192.168.100.20"]},
            {"index": 6, "name": "Ethernet", "status": "Up", "supported": True, "addresses": ["192.168.100.10"]},
        ]
        match = adapter_for_host(adapters, IPv4Address("192.168.100.1"))
        self.assertIsNotNone(match)
        self.assertEqual(match["index"], 6)


if __name__ == "__main__":
    unittest.main()
