#!/usr/bin/env python3
"""Uploads a file to a SharePoint document library via the Microsoft Graph
API, authenticating as an Azure AD app registration (client-credentials /
app-only flow -- no signed-in user, suitable for CI).

Why this exists: Power Automate's SharePoint "Create file" action requires
a premium connector license this org's Power Automate plan doesn't include.
Calling Microsoft Graph directly sidesteps that entirely -- Graph API access
itself isn't gated by Power Automate licensing, only Power Automate's own
connector wrapper around it is.

Files over 4MB have to go through Graph's upload-session (chunked) flow
rather than a single PUT -- our built app zips are routinely ~18MB, so this
always takes that path rather than trying the simple upload first.

Required environment variables:
  AZURE_TENANT_ID     -- Directory (tenant) ID from the app registration
  AZURE_CLIENT_ID     -- Application (client) ID from the app registration
  AZURE_CLIENT_SECRET -- Client secret value (not the secret ID)
  SP_SITE_HOSTNAME     -- e.g. atoc.sharepoint.com
  SP_SITE_PATH        -- e.g. /sites/RDGQualityAssurance
  SP_FOLDER_PATH       -- e.g. Shared Documents/Timesheet Updates

Usage:
  python3 upload_to_sharepoint.py <local-file-path> [<remote-filename>]

Prints the uploaded item's webUrl on success (last line of stdout), so the
calling workflow step can capture it for a notification message.
"""
import json
import os
import sys
import urllib.error
import urllib.request

GRAPH = "https://graph.microsoft.com/v1.0"
CHUNK_SIZE = 8 * 327680  # ~2.5MB; must be a multiple of 320 KiB per Graph's rules


def env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Missing required environment variable: {name}")
    return value


def http_json(url, data=None, headers=None, method=None):
    headers = headers or {}
    body = None
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode("utf-8")
            headers.setdefault("Content-Type", "application/json")
        else:
            body = data
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        sys.exit(f"HTTP {e.code} calling {url}:\n{detail}")


def get_token(tenant_id, client_id, client_secret):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    body = (
        f"client_id={client_id}"
        f"&scope=https://graph.microsoft.com/.default"
        f"&client_secret={client_secret}"
        f"&grant_type=client_credentials"
    ).encode("utf-8")
    result = http_json(
        url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    return result["access_token"]


def get_site_id(token, hostname, site_path):
    url = f"{GRAPH}/sites/{hostname}:{site_path}"
    result = http_json(url, headers={"Authorization": f"Bearer {token}"})
    return result["id"]


def create_upload_session(token, site_id, folder_path, filename):
    encoded_path = "/".join(
        urllib.request.quote(part) for part in f"{folder_path}/{filename}".split("/")
    )
    url = f"{GRAPH}/sites/{site_id}/drive/root:/{encoded_path}:/createUploadSession"
    result = http_json(
        url,
        data={"item": {"@microsoft.graph.conflictBehavior": "replace"}},
        headers={"Authorization": f"Bearer {token}"},
        method="POST",
    )
    return result["uploadUrl"]


def upload_file(upload_url, file_path):
    size = os.path.getsize(file_path)
    with open(file_path, "rb") as f:
        start = 0
        result = None
        while start < size:
            chunk = f.read(CHUNK_SIZE)
            end = start + len(chunk) - 1
            req = urllib.request.Request(
                upload_url,
                data=chunk,
                headers={
                    "Content-Length": str(len(chunk)),
                    "Content-Range": f"bytes {start}-{end}/{size}",
                },
                method="PUT",
            )
            try:
                with urllib.request.urlopen(req) as resp:
                    raw = resp.read()
                    result = json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")
                sys.exit(f"HTTP {e.code} uploading chunk {start}-{end}:\n{detail}")
            start += len(chunk)
            print(f"Uploaded {min(start, size)}/{size} bytes", file=sys.stderr)
    return result


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: upload_to_sharepoint.py <local-file-path> [<remote-filename>]")
    local_path = sys.argv[1]
    remote_name = sys.argv[2] if len(sys.argv) > 2 else os.path.basename(local_path)

    tenant_id = env("AZURE_TENANT_ID")
    client_id = env("AZURE_CLIENT_ID")
    client_secret = env("AZURE_CLIENT_SECRET")
    hostname = env("SP_SITE_HOSTNAME")
    site_path = env("SP_SITE_PATH")
    folder_path = env("SP_FOLDER_PATH")

    token = get_token(tenant_id, client_id, client_secret)
    site_id = get_site_id(token, hostname, site_path)
    upload_url = create_upload_session(token, site_id, folder_path, remote_name)
    item = upload_file(upload_url, local_path)

    web_url = item.get("webUrl", "") if item else ""
    print(web_url)


if __name__ == "__main__":
    main()
