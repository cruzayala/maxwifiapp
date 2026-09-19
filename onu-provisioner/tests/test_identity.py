import unittest

from provisioner.identity import normalize_gpon_serial


class GponIdentityTests(unittest.TestCase):
    def test_converts_huawei_hex_serial_to_olt_format(self):
        self.assertEqual(normalize_gpon_serial("485754439EC8CEAF"), "HWTC9EC8CEAF")

    def test_keeps_the_canonical_olt_format(self):
        self.assertEqual(normalize_gpon_serial("hwtc9ec8ceaf"), "HWTC9EC8CEAF")

    def test_rejects_invalid_serials(self):
        with self.assertRaises(ValueError):
            normalize_gpon_serial("1234")


if __name__ == "__main__":
    unittest.main()
