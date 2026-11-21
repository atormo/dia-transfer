"""Tests for the native host. Run:  python3 -m unittest discover tests"""
import json, struct, subprocess, sys, tempfile, unittest
from pathlib import Path

HOST = Path(__file__).resolve().parent.parent / "host" / "host.py"
EXT = "chrome-extension://igninmfomapgemelieneadccdejgifkl/"


def call(user_data, msg):
    data = json.dumps(msg).encode()
    out = subprocess.run([sys.executable, str(HOST), str(user_data), EXT],
                         input=struct.pack("<I", len(data)) + data, capture_output=True, check=True).stdout
    size = struct.unpack("<I", out[:4])[0]
    return json.loads(out[4:4 + size])


class HostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        ud = self.ud = Path(self.tmp.name)
        (ud / "Local State").write_text(json.dumps({"profile": {"info_cache": {
            "Default": {"name": "Personal"}, "Profile 1": {"name": "Dev"}}}}))
        (ud / "Default").mkdir()
        (ud / "Profile 1").mkdir()
        (ud / "Default" / "Bookmarks").write_text(json.dumps({"roots": {
            "bookmark_bar": {"type": "folder", "name": "Bar", "children": [
                {"type": "url", "name": "Example", "url": "https://example.com/"}]},
            "other": {"type": "folder", "name": "Other", "children": []}}}))
        ext = ud / "Default" / "Extensions" / ("a" * 32) / "1.0_0"
        (ext / "_locales" / "en").mkdir(parents=True)
        (ext / "manifest.json").write_text(json.dumps({"name": "__MSG_appName__", "default_locale": "en"}))
        (ext / "_locales" / "en" / "messages.json").write_text(json.dumps({"appName": {"message": "Fake Ext"}}))
        store = ud / "Profile 1" / "Local Extension Settings" / "igninmfomapgemelieneadccdejgifkl"
        store.mkdir(parents=True)
        (store / "000003.log").write_bytes(b'\x00token)"dt-123"')

    def tearDown(self):
        self.tmp.cleanup()

    def test_profiles_and_current(self):
        r = call(self.ud, {"cmd": "profiles", "token": "dt-123"})
        self.assertEqual([p["name"] for p in r["profiles"]], ["Personal", "Dev"])
        self.assertEqual(r["current"], "Profile 1")

    def test_bookmarks(self):
        r = call(self.ud, {"cmd": "bookmarks", "folder": "Default"})
        bar = r["roots"][0]
        self.assertEqual(bar["root"], "bookmark_bar")
        self.assertEqual(bar["children"][0], {"title": "Example", "url": "https://example.com/"})

    def test_extension_names_are_localized(self):
        r = call(self.ud, {"cmd": "extensions", "folder": "Default"})
        self.assertEqual(r["extensions"], [{"id": "a" * 32, "name": "Fake Ext"}])

    def test_rejects_paths_outside_profiles(self):
        r = call(self.ud, {"cmd": "bookmarks", "folder": "../../etc"})
        self.assertFalse(r["ok"])


class AppOfTest(unittest.TestCase):
    def test_first_app_bundle_wins(self):
        sys.path.insert(0, str(HOST.parent))
        import host
        self.assertEqual(host.app_of("/Applications/Dia.app/Contents/Frameworks/ArcCore.framework/Helpers/X.app/Contents/MacOS/X"), "Dia")
        self.assertEqual(host.app_of("/Applications/Arc.app/Contents/MacOS/Arc"), "Arc")
        self.assertEqual(host.app_of("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "Google Chrome")
        self.assertIsNone(host.app_of("/bin/zsh"))


if __name__ == "__main__":
    unittest.main()
