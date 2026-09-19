import unittest
from unittest.mock import patch

import app as onu_app


class CloudWorkerTests(unittest.TestCase):
    def test_worker_reports_pc_identity_and_supported_operations(self):
        worker = onu_app.OnuCloudTaskWorker()
        metadata = worker._metadata()
        capabilities = worker._capabilities()

        self.assertTrue(metadata["hostname"])
        self.assertIn("isAdmin", metadata)
        self.assertEqual(capabilities["actions"], ["discover", "check", "provision"])
        self.assertEqual(
            {device["model"] for device in capabilities["supportedDevices"]},
            {"EG8141A5", "F670L"},
        )
        self.assertNotIn("password", str(capabilities).lower())

    def test_discovery_job_uses_local_discovery_service(self):
        worker = onu_app.OnuCloudTaskWorker()
        expected = {"detected": True, "device": {"model": "EG8141A5", "host": "192.168.100.1"}}
        with patch.object(onu_app.DISCOVERY, "scan", return_value=expected):
            result, local_job_id = worker._execute_local_job({
                "id": "remote-discovery-1", "action": "discover", "payload": {},
            })
        self.assertEqual(result, expected)
        self.assertIsNone(local_job_id)

    def test_unknown_remote_action_is_rejected(self):
        worker = onu_app.OnuCloudTaskWorker()
        with self.assertRaisesRegex(Exception, "no es compatible"):
            worker._execute_local_job({"id": "bad-action", "action": "shell", "payload": {}})

    def test_revocation_clears_all_persisted_cloud_credentials(self):
        original = dict(onu_app.CLOUD)
        onu_app.CLOUD.update({
            "token": "access", "agent_token": "agent", "device_token": "device",
            "user": {"username": "admin"}, "token_fingerprint": "ABC123",
        })
        try:
            with patch.object(onu_app.SECURE_CLOUD_STORE, "save") as saved:
                onu_app.revoke_local_cloud_state("Revocado desde Railway")
            self.assertIsNone(onu_app.CLOUD["token"])
            self.assertIsNone(onu_app.CLOUD["agent_token"])
            self.assertIsNone(onu_app.CLOUD["device_token"])
            self.assertIsNone(onu_app.CLOUD["token_fingerprint"])
            self.assertEqual(onu_app.CLOUD["session_state"], "revoked")
            self.assertEqual(onu_app.CLOUD["revoked_reason"], "Revocado desde Railway")
            payload = saved.call_args.args[0]
            self.assertIsNone(payload["device_token"])
            self.assertIsNone(payload["agent_token"])
            self.assertNotIn("access", str(payload))
        finally:
            onu_app.CLOUD.clear()
            onu_app.CLOUD.update(original)


if __name__ == "__main__":
    unittest.main()
