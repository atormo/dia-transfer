#!/usr/bin/env python3
"""Native messaging host for Dia Transfer.

The browser starts this script when the extension asks for data. It only READS
the browser's "User Data" folder (profiles, bookmarks, installed extensions)
and never writes to it. Writing is done by the extension through the official
chrome.bookmarks API, inside the profile where it runs.

Usage (set up by install.sh):  host.py <path to the browser's "User Data" folder>
"""
import json
import os
import struct
import sys
from pathlib import Path

import re
import subprocess

SUPPORT = Path.home() / "Library" / "Application Support"
# Name of the browser's .app bundle -> its "User Data" folder
BROWSERS = {
    "Dia": SUPPORT / "Dia" / "User Data",
    "Arc": SUPPORT / "Arc" / "User Data",
    "Google Chrome": SUPPORT / "Google" / "Chrome",
    "Google Chrome Beta": SUPPORT / "Google" / "Chrome Beta",
    "Brave Browser": SUPPORT / "BraveSoftware" / "Brave-Browser",
    "Microsoft Edge": SUPPORT / "Microsoft Edge",
    "Chromium": SUPPORT / "Chromium",
    "Vivaldi": SUPPORT / "Vivaldi",
}


def app_of(command: str):
    """'/Applications/Dia.app/Contents/Frameworks/ArcCore.framework/…' -> 'Dia' (first .app wins)."""
    m = re.search(r"/([^/]+)\.app/", command)
    return m.group(1) if m else None


def browser_from_parents():
    """Some browsers (Dia) also read Chrome's host folder, so the configured path
    can be the wrong browser. Ask the OS which app actually started us."""
    pid = os.getppid()
    for _ in range(6):
        try:
            out = subprocess.run(["ps", "-o", "ppid=,comm=", "-p", str(pid)],
                                 capture_output=True, text=True, timeout=2).stdout.strip()
        except Exception:
            return None
        if not out:
            return None
        ppid, _, comm = out.partition(" ")
        app = app_of(comm.strip())
        if app in BROWSERS:
            return BROWSERS[app] if (BROWSERS[app] / "Local State").exists() else None
        pid = int(ppid)
        if pid <= 1:
            return None
    return None


_configured = next((Path(a) for a in sys.argv[1:] if not a.startswith("chrome-extension://")), None)
USER_DATA = browser_from_parents() or _configured


# ---------- native messaging protocol: 4-byte length + JSON ----------

def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    size = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(size).decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


# ---------- reading profiles ----------

def profiles():
    state = json.loads((USER_DATA / "Local State").read_text(encoding="utf-8"))
    info = state.get("profile", {}).get("info_cache", {})
    out = []
    for folder, meta in info.items():
        if (USER_DATA / folder).is_dir():
            out.append({"folder": folder, "name": meta.get("name") or folder})
    return out


def profile_dir(folder):
    # Only accept folder names that really are profiles (no path tricks).
    if folder not in {p["folder"] for p in profiles()}:
        raise ValueError(f"Unknown profile: {folder}")
    return USER_DATA / folder


def strip(node):
    out = {"title": node.get("name", "")}
    if node.get("type") == "url":
        out["url"] = node.get("url", "")
    else:
        out["children"] = [strip(c) for c in node.get("children", [])]
    return out


def bookmarks(folder):
    f = profile_dir(folder) / "Bookmarks"
    if not f.exists():
        return []
    roots = json.loads(f.read_text(encoding="utf-8")).get("roots", {})
    result = []
    for key in ("bookmark_bar", "other", "synced"):
        r = roots.get(key)
        if isinstance(r, dict):
            node = strip(r)
            node["root"] = key
            result.append(node)
    return result


def ext_name(version_dir: Path, manifest: dict):
    name = manifest.get("name", "")
    if name.startswith("__MSG_") and name.endswith("__"):
        key = name[6:-2].lower()
        for loc in (manifest.get("default_locale"), "en", "en_US", "es"):
            if not loc:
                continue
            msgs = version_dir / "_locales" / loc / "messages.json"
            if msgs.exists():
                data = {k.lower(): v for k, v in json.loads(msgs.read_text(encoding="utf-8-sig")).items()}
                if key in data:
                    return data[key].get("message", name)
    return name


def extensions(folder):
    root = profile_dir(folder) / "Extensions"
    out = []
    if not root.exists():
        return out
    for d in sorted(root.iterdir()):
        if not (d.is_dir() and len(d.name) == 32):
            continue
        for v in sorted(d.iterdir(), reverse=True):
            mf = v / "manifest.json"
            if mf.exists():
                try:
                    m = json.loads(mf.read_text(encoding="utf-8-sig"))
                    name = ext_name(v, m)
                except Exception:
                    name = d.name
                out.append({"id": d.name, "name": name or d.name})
                break
    return out


def extension_id():
    # The browser passes the caller's origin, e.g. chrome-extension://<id>/
    for a in sys.argv[1:]:
        if a.startswith("chrome-extension://"):
            return a[len("chrome-extension://"):].strip("/")
    return None


def whoami(token):
    """Find the profile whose extension storage contains `token`.

    The extension writes a random token to chrome.storage.local, which the
    browser stores in <profile>/Local Extension Settings/<extension id>/.
    That tells us, without guessing, which profile the extension runs in.
    """
    ext = extension_id()
    if not ext or not token:
        return None
    needle = token.encode()
    for p in profiles():
        store = USER_DATA / p["folder"] / "Local Extension Settings" / ext
        if not store.is_dir():
            continue
        for f in store.iterdir():
            if f.suffix in (".log", ".ldb") and f.is_file():
                try:
                    if needle in f.read_bytes():
                        return p["folder"]
                except OSError:
                    pass
    return None


def handle(msg):
    cmd = msg.get("cmd")
    if USER_DATA is None or not USER_DATA.exists():
        return {"ok": False, "error": "Host not configured. Run install.sh again."}
    if cmd == "profiles":
        return {"ok": True, "profiles": profiles(), "current": whoami(msg.get("token"))}
    if cmd == "bookmarks":
        return {"ok": True, "roots": bookmarks(msg["folder"])}
    if cmd == "extensions":
        return {"ok": True, "extensions": extensions(msg["folder"])}
    return {"ok": False, "error": f"Unknown command: {cmd}"}


def main():
    msg = read_message()
    if msg is None:
        return
    try:
        send_message(handle(msg))
    except Exception as e:  # report errors to the extension instead of crashing
        send_message({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
