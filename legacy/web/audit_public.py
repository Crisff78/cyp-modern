"""Reproduce the read-only, unauthenticated CyP public surface audit.

Python 3.10+, standard library only. Fetches only the supplied landing page,
its declared meta-refresh target, and same-origin JS/CSS linked by that target.
Never submits forms, invokes HandleEvent, guesses routes, or sends credentials.
Raw cookies and embedded API keys are redacted before persistence.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

TARGET = "http://gdemos.ddns.net/cypdemo/"
OUT = Path(__file__).resolve().parent
MAX_BYTES = 2_000_000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Prevent an HTTP redirect from extending the audit to another service.
        return None


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refresh = None
        self.assets = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "meta" and values.get("http-equiv", "").lower() == "refresh":
            match = re.search(r"url=(.+)$", values.get("content", ""), re.I)
            if match:
                self.refresh = match.group(1).strip()
        if tag == "script" and values.get("src"):
            self.assets.append(values["src"])
        if tag == "link" and values.get("href") and values.get("rel", "").lower() == "stylesheet":
            self.assets.append(values["href"])


def redact(value: str) -> str:
    value = re.sub(r"AIza[\w-]+", "[REDACTED_PUBLIC_API_KEY]", value)
    value = re.sub(r"(_S_ID=)[A-Za-z0-9_-]+", r"\1[REDACTED_SESSION]", value)
    value = re.sub(r"(/cache/cyp10_front/)[A-Za-z0-9_-]+(/favicon\.ico)", r"\1[REDACTED_SESSION]\2", value)
    value = re.sub(r"(UNI_GUI_SESSION_ID=)[^;\s]+", r"\1[REDACTED_SESSION]", value)
    return value


def fetch(url: str):
    request = Request(url, headers={"User-Agent": "CyP-Public-Audit/1.0 (read-only)"})
    try:
        with build_opener(NoRedirect).open(request, timeout=20) as response:
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError("Response exceeds audit size limit")
            charset = response.headers.get_content_charset()
            source = data.decode(charset or "windows-1252", errors="replace")
            cookies = response.headers.get_all("Set-Cookie", [])
            record = {
                "url": redact(url), "status": response.status,
                "bytes": len(data), "sha256_received_bytes": hashlib.sha256(data).hexdigest(),
                "content_type": response.headers.get("Content-Type"),
                "server": response.headers.get("Server"),
                "last_modified": response.headers.get("Last-Modified"),
                "set_cookie_redacted": [redact(c) for c in cookies],
                "security_headers": {key: response.headers.get(key) for key in (
                    "Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options",
                    "X-Content-Type-Options", "Referrer-Policy")},
            }
            return record, source
    except (HTTPError, URLError, TimeoutError, ValueError) as error:
        return {"url": redact(url), "error": str(error)}, ""


def write_text(name: str, value: str):
    (OUT / name).write_text(redact(value), encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "target": TARGET, "scope": "Unauthenticated public GET requests only",
        "requests": [], "external_references_not_fetched": [],
        "dynamic_endpoints_referenced_not_invoked": [],
        "redactions": ["Public embedded API key", "Anonymous session identifier"],
    }
    landing, source = fetch(TARGET)
    manifest["requests"].append(landing)
    write_text("landing.redacted.html", source)
    landing_links = Links()
    landing_links.feed(source)
    if landing_links.refresh:
        app_url = urljoin(TARGET, landing_links.refresh)
        if urlsplit(app_url).netloc != urlsplit(TARGET).netloc:
            raise RuntimeError("Meta refresh leaves the audited origin")
        app, source = fetch(app_url)
        manifest["requests"].append(app)
        write_text("login.redacted.html", source)
        app_links = Links()
        app_links.feed(source)
        manifest["dynamic_endpoints_referenced_not_invoked"] = sorted(set(
            re.findall(r'url:"([^\"]+/HandleEvent)"', source)))
        for asset in dict.fromkeys(app_links.assets):
            asset_url = urljoin(app_url, asset)
            if urlsplit(asset_url).netloc != urlsplit(TARGET).netloc:
                manifest["external_references_not_fetched"].append(redact(asset_url))
                continue
            if not urlsplit(asset_url).path.endswith((".js", ".css")):
                continue
            metadata, asset_source = fetch(asset_url)
            # Store metadata and version evidence rather than vendoring libraries.
            versions = re.findall(r'(?:Ext\.version\s*=\s*[\"\']([^\"\']+)|Ext JS Library\s+([^\r\n]+))', asset_source)
            if versions:
                metadata["version_evidence"] = [a or b for a, b in versions]
            manifest["requests"].append(metadata)
    write_text("audit-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"requests": len(manifest["requests"]), "output": str(OUT),
                      "errors": sum("error" in item for item in manifest["requests"])}))


if __name__ == "__main__":
    main()
