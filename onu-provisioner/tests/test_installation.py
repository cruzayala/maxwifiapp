import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from provisioner import __version__
from provisioner import installation


class InstallationTests(unittest.TestCase):
    def test_status_identifies_versioned_persistent_installation(self):
        with tempfile.TemporaryDirectory() as directory:
            expected = Path(directory) / "ISP Max" / "ONU Studio" / "bin" / f"ONU-Studio-ISP-Max-v{__version__}.exe"
            expected.parent.mkdir(parents=True)
            expected.write_bytes(b"exe")
            task = subprocess.CompletedProcess([], 0, "ready", "")
            with (
                patch.dict(os.environ, {"LOCALAPPDATA": directory}),
                patch.object(installation.platform, "system", return_value="Windows"),
                patch.object(sys, "frozen", True, create=True),
                patch.object(sys, "executable", str(expected)),
                patch.object(installation, "_schtasks", return_value=task),
            ):
                status = installation.installation_status()
            self.assertTrue(status["installed"])
            self.assertTrue(status["startupEnabled"])
            self.assertEqual(status["credentialProtection"], "Windows DPAPI CurrentUser")

    def test_portable_executable_is_copied_and_registered(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "download" / "ONU-Studio.exe"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"portable")
            task = subprocess.CompletedProcess([], 0, "ok", "")
            with (
                patch.dict(os.environ, {"LOCALAPPDATA": directory}),
                patch.object(installation.platform, "system", return_value="Windows"),
                patch.object(sys, "frozen", True, create=True),
                patch.object(sys, "executable", str(source)),
                patch.object(installation, "_schtasks", return_value=task) as scheduled,
                patch.object(installation.time, "sleep"),
                patch.object(installation.subprocess, "Popen") as launched,
            ):
                target = installation.install_current_executable()
            self.assertIsNotNone(target)
            self.assertEqual(target.read_bytes(), b"portable")
            self.assertTrue(any("/Create" in call.args[0] for call in scheduled.call_args_list))
            launched.assert_called_once()

    def test_legacy_background_agent_hands_off_to_installed_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "legacy" / "ONU-Studio.exe"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"legacy")
            task = subprocess.CompletedProcess([], 0, "ok", "")
            with (
                patch.dict(os.environ, {"LOCALAPPDATA": directory}),
                patch.object(installation.platform, "system", return_value="Windows"),
                patch.object(sys, "frozen", True, create=True),
                patch.object(sys, "executable", str(source)),
                patch.object(installation, "_schtasks", return_value=task) as scheduled,
                patch.object(installation.subprocess, "Popen") as launched,
                patch.object(installation.os, "getpid", return_value=4321),
            ):
                target = installation.install_current_executable(background=True)
            self.assertEqual(target.read_bytes(), b"legacy")
            self.assertFalse(any("/End" in call.args[0] for call in scheduled.call_args_list))
            self.assertEqual(launched.call_args.args[0], [str(target), "--background", "--replace-pid", "4321"])


if __name__ == "__main__":
    unittest.main()
