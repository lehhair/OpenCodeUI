#!/usr/bin/env python3
"""Docker regressions: python3 scripts/test-docker.py [--integration]

Default: Compose, jq and sha256sum required; no daemon or network used.
Integration: build opencodeui-{backend,gateway}:auth-test from docker/Dockerfile.*
first. Uses disposable containers/networks and synthetic credentials, no host volumes.
"""

import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import time
import unittest
import urllib.error
import urllib.request
import uuid


ROOT = Path(__file__).resolve().parents[1]
BACKEND = "opencodeui-backend:auth-test"
GATEWAY = "opencodeui-gateway:auth-test"
PASSWORD_CASES = [
    ("new only", {"OPENCODE_PASSWORD": "new-test:colon"}, "new-test:colon"),
    ("legacy only", {"OPENCODE_SERVER_PASSWORD": "legacy-test"}, "legacy-test"),
    ("both", {"OPENCODE_PASSWORD": "new-test", "OPENCODE_SERVER_PASSWORD": "legacy-test"}, "new-test"),
    ("empty new", {"OPENCODE_PASSWORD": "", "OPENCODE_SERVER_PASSWORD": "legacy-test"}, "legacy-test"),
]
EMPTY_PASSWORD_CASES = [
    {}, {"OPENCODE_PASSWORD": ""}, {"OPENCODE_SERVER_PASSWORD": ""},
    {"OPENCODE_PASSWORD": "", "OPENCODE_SERVER_PASSWORD": ""},
]


def run(*args, env=None, check=True, timeout=60):
    try:
        return subprocess.run(
            args, cwd=ROOT, env=env, check=check, timeout=timeout, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as error:
        # unittest otherwise hides the captured diagnostic (e.g. Compose interpolation errors).
        print(error.stderr, file=sys.stderr)
        raise


def docker(*args, **kwargs):
    return run("docker", *args, **kwargs)


def compose(values, build=False):
    # Never load developer credentials from the environment or .env.
    args = ["compose", "--env-file", "/dev/null", "-f", "docker-compose.yml"]
    if build:
        args += ["-f", "docker-compose.build.yml"]
    result = docker(*args, "config", "--format", "json", env={
        "PATH": os.environ["PATH"], "OPENCODE_SERVER_USERNAME": "old-user", **values,
    })
    return json.loads(result.stdout)["services"]


class ComposePasswordTests(unittest.TestCase):
    def test_gateway_and_backend_use_same_password(self):
        for build in [False, True]:
            for name, values, expected in PASSWORD_CASES:
                with self.subTest(build=build, case=name):
                    services = compose({**values, "OPENCODE_MANIFEST_BASE64": "e30="}, build)
                    self.assertEqual(services["gateway"]["environment"]["ROUTER_PASSWORD"], expected)
                    self.assertEqual(services["backend"]["environment"]["OPENCODE_PASSWORD"], expected)
                    self.assertEqual(services["gateway"]["environment"]["ROUTER_USERNAME"], "opencode")
                    self.assertNotIn("OPENCODE_SERVER_USERNAME", services["backend"]["environment"])
                    if build:
                        self.assertEqual(services["backend"]["build"]["args"]["OPENCODE_MANIFEST_BASE64"], "e30=")

    def test_empty_passwords_are_passed_to_startup_checks(self):
        # Compose v2 eagerly expands nested :? expressions, even when the new password is set.
        # Expand defaults here; DockerAuthTests verifies both containers fail closed at startup.
        for build in [False, True]:
            for values in EMPTY_PASSWORD_CASES:
                with self.subTest(build=build, values=values):
                    services = compose(values, build)
                    self.assertEqual(services["gateway"]["environment"]["ROUTER_PASSWORD"], "")
                    self.assertEqual(services["backend"]["environment"]["OPENCODE_PASSWORD"], "")


class ReleaseSnapshotTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        (self.root / "bin").mkdir()
        (self.root / "install").mkdir()
        self.binary = self.root / "install/opencode"
        archive_path = self.root / "release.tar.gz"
        binary = b"#!/bin/sh\necho 'opencode v2.1.0'\n"
        with tarfile.open(archive_path, "w:gz") as archive:
            entry = tarfile.TarInfo("opencode")
            entry.mode, entry.size = 0o755, len(binary)
            archive.addfile(entry, io.BytesIO(binary))
        sha = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        self.manifest = {"version": "2.1.0", "metadata": {"files": {
            f"opencode-linux-{arch}.tar.gz": {
                "url": f"https://releases.example/2.1.0/{arch}.tar.gz", "sha256": sha,
            } for arch in ["x64", "arm64"]
        }}}
        self.latest = self.root / "latest.json"
        self.latest.write_text(json.dumps(self.manifest))
        self.requests = self.root / "requests"
        # Stub network I/O only; jq, hashing, extraction and version checks are real.
        curl = self.root / "bin/curl"
        curl.write_text(textwrap.dedent("""\
            #!/bin/sh
            output=
            while [ "$#" -gt 0 ]; do
              case "$1" in
                -o) output="$2"; shift ;;
                https://*) url="$1" ;;
              esac
              shift
            done
            printf '%s\\n' "$url" >> "$TEST_REQUESTS"
            case "$url" in
              https://opencode.ai/update/api/latest/cli/opencode) file="$TEST_LATEST" ;;
              https://releases.example/2.1.0/*.tar.gz) file="$TEST_ARCHIVE" ;;
              *) exit 22 ;;
            esac
            if [ -n "$output" ]; then cp "$file" "$output"; else cat "$file"; fi
            """))
        curl.chmod(0o755)
        mise = self.root / "bin/mise"
        mise.write_text("#!/bin/sh\nexit 0\n")
        mise.chmod(0o755)
        self.env = {
            "PATH": f"{self.root}/bin:{self.root}/install:{os.environ['PATH']}",
            "TEST_REQUESTS": str(self.requests), "TEST_LATEST": str(self.latest),
            "TEST_ARCHIVE": str(archive_path), "OPENCODE_VERSION": "", "OPENCODE_MANIFEST_BASE64": "",
            "OPENCODE_MANIFEST_URL": "https://opencode.ai/update/api/latest/cli/opencode",
        }

    def shell(self, script, *args, **values):
        # Execute production shell scripts in a temporary prefix on the host.
        for source, target in {
            "/usr/local/bin": str(self.root / "install"),
            "/usr/local/share/opencode": str(self.root / "metadata"),
            "/usr/local/lib/opencode-release.sh": str(ROOT / "docker/opencode-release.sh"),
            "/root/": f"{self.root}/home/",
        }.items():
            script = script.replace(source, target)
        return run("bash", "-o", "pipefail", "-c", script, "entrypoint", *args,
                   env={**self.env, **values}, check=False)

    def install(self, arch="amd64", **values):
        dockerfile = (ROOT / "docker/Dockerfile.backend").read_text()
        block = re.search(r"RUN set -eu;.*?(?=\n\n)", dockerfile.split("COPY docker/opencode-release.sh", 1)[1], re.S)
        return self.shell(block.group(0)[4:], TARGETARCH=arch, **values)

    def runtime(self, *args, **values):
        return self.shell((ROOT / "docker/backend-entrypoint.sh").read_text(), *args, **values)

    def encoded_manifest(self, manifest=None):
        return base64.b64encode(json.dumps(self.manifest if manifest is None else manifest).encode()).decode()

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_latest_change_does_not_change_either_architecture(self):
        result = run("bash", "docker/resolve-opencode-release.sh", env=self.env)
        resolved = dict(line.split("=", 1) for line in result.stdout.splitlines())
        self.latest.write_text('{"version":"2.9.0"}')
        for arch in ["amd64", "arm64"]:
            with self.subTest(arch=arch):
                self.assert_success(self.install(arch, OPENCODE_VERSION=resolved["version"], OPENCODE_MANIFEST_BASE64=resolved["manifest"]))
        self.assertEqual(self.requests.read_text().splitlines(), [
            self.env["OPENCODE_MANIFEST_URL"],
            "https://releases.example/2.1.0/x64.tar.gz", "https://releases.example/2.1.0/arm64.tar.gz",
        ])

    def test_local_build_can_fetch_manifest(self):
        self.assert_success(self.install())
        self.assertEqual(len(self.requests.read_text().splitlines()), 2)

    def test_invalid_releases_are_not_installed(self):
        bad_checksum = copy.deepcopy(self.manifest)
        bad_checksum["metadata"]["files"]["opencode-linux-x64.tar.gz"]["sha256"] = "0" * 64
        for name, manifest, requested, message, downloaded in [
            ("invalid snapshot", {}, "", "", False),
            ("v1", {**self.manifest, "version": "1.19.0"}, "", "v2 or newer", False),
            ("requested mismatch", self.manifest, "2.9.0", "does not match requested", False),
            ("binary mismatch", {**self.manifest, "version": "2.9.0"}, "", "binary version does not match", True),
            ("checksum mismatch", bad_checksum, "", "", True),
        ]:
            with self.subTest(case=name):
                self.requests.unlink(missing_ok=True)
                result = self.install(OPENCODE_VERSION=requested, OPENCODE_MANIFEST_BASE64=self.encoded_manifest(manifest))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)
                self.assertFalse(self.binary.exists())
                self.assertEqual(self.requests.exists(), downloaded)

    def test_v_prefix_is_normalized(self):
        self.manifest["version"] = "v2.1.0"
        self.assert_success(self.install(OPENCODE_VERSION="v2.1.0", OPENCODE_MANIFEST_BASE64=self.encoded_manifest()))

    def test_runtime_uses_saved_release_despite_path_or_latest_changes(self):
        self.assert_success(self.install(OPENCODE_MANIFEST_BASE64=self.encoded_manifest()))
        shadow = self.root / "bin/opencode"
        shadow.write_text("#!/bin/sh\necho 1.19.0\n")
        shadow.chmod(0o755)
        self.requests.unlink()
        self.latest.write_text('{"version":"2.9.0"}')
        result = self.runtime("opencode", "--version")
        self.assert_success(result)
        self.assertEqual(result.stdout.strip(), "opencode v2.1.0")
        self.assertFalse(self.requests.exists())
        for installed in [None, "1.19.0", "2.0.0"]:
            with self.subTest(installed=installed):
                if installed is None:
                    self.binary.unlink()
                else:
                    self.binary.write_text(f"#!/bin/sh\necho {installed}\n")
                result = self.runtime("opencode", "--version")
                self.assert_success(result)
                self.assertTrue(result.stdout.strip().endswith("opencode v2.1.0"))
        self.assertEqual(len(self.requests.read_text().splitlines()), 3)
        self.assertNotIn(self.env["OPENCODE_MANIFEST_URL"], self.requests.read_text())

    def test_runtime_rejects_missing_manifest_or_password_without_network(self):
        for args in [("opencode", "--version"), ()]:
            with self.subTest(args=args):
                result = self.runtime(*args)
                self.assertNotEqual(result.returncode, 0)
                if not args:
                    self.assertIn("non-empty password", result.stderr)
                self.assertFalse(self.requests.exists())

    def test_runtime_normalizes_password_for_direct_container_use(self):
        self.assert_success(self.install(OPENCODE_MANIFEST_BASE64=self.encoded_manifest()))
        self.binary.write_text('#!/bin/sh\nif [ "$1" = --version ]; then echo 2.1.0; else printf "%s" "$OPENCODE_PASSWORD"; fi\n')
        for name, values, expected in PASSWORD_CASES:
            with self.subTest(case=name):
                result = self.runtime("opencode", "serve", **values)
                self.assert_success(result)
                self.assertEqual(result.stdout, expected)


class DockerAuthTests(unittest.TestCase):
    def request(self, base, path, credentials=None, port=None):
        headers = {}
        if credentials is not None:
            headers["Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode()
        data = None
        if port is not None:
            data = json.dumps({"port": port}).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(base + path, data=data, headers=headers)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=3) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def test_containers_reject_empty_password_at_startup(self):
        for values in EMPTY_PASSWORD_CASES:
            services = compose(values)
            for service, image, entrypoint in [
                ("backend", BACKEND, None), ("gateway", GATEWAY, None),
                ("gateway", GATEWAY, "opencodeui-router"),
            ]:
                with self.subTest(values=values, image=image, entrypoint=entrypoint):
                    args = ["run", "--rm", "--network", "none"]
                    if entrypoint:
                        args += ["--entrypoint", entrypoint]
                    for key, value in services[service]["environment"].items():
                        args += ["-e", f"{key}={value}"]
                    result = docker(*args, image, check=False, timeout=30)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("non-empty password", result.stderr)

    def test_gateway_rejects_missing_or_empty_username_at_startup(self):
        for username in [None, ""]:
            for entrypoint in [None, "opencodeui-router"]:
                with self.subTest(username=username, entrypoint=entrypoint):
                    args = ["run", "--rm", "--network", "none", "-e", "ROUTER_PASSWORD=username-test"]
                    if username is not None:
                        args += ["-e", f"ROUTER_USERNAME={username}"]
                    if entrypoint:
                        args += ["--entrypoint", entrypoint]
                    result = docker(*args, GATEWAY, check=False, timeout=30)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("non-empty username", result.stderr)

    def test_real_backend_and_preview_api_share_credentials(self):
        for name, values, password in PASSWORD_CASES:
            with self.subTest(case=name):
                self.check_credentials(values, password)

    def check_credentials(self, values, password):
        services = compose(values)
        prefix = "opencodeui-auth-" + uuid.uuid4().hex[:12]
        backend, gateway = prefix + "-backend", prefix + "-gateway"
        docker("network", "create", prefix)
        try:
            for service, image, container in [("backend", BACKEND, backend), ("gateway", GATEWAY, gateway)]:
                args = ["run", "-d", "--name", container, "--network", prefix]
                if service == "backend":
                    args += ["--network-alias", "opencode-backend", "-e", "OPENCODE_DISABLE_MODELS_FETCH=true"]
                else:
                    args += ["-p", "127.0.0.1::6658"]
                for key, value in services[service]["environment"].items():
                    args += ["-e", f"{key}={value}"]
                # No Docker socket is mounted: auth/preview selection do not require scanning.
                docker(*args, image)
            published = docker("port", gateway, "6658/tcp").stdout.strip()
            base = "http://" + published
            credentials = f"opencode:{password}"
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                try:
                    if self.request(base, "/api/api/info", credentials)[0] == 200:
                        break
                except OSError:
                    pass
                time.sleep(0.25)
            else:
                self.fail("Backend did not become ready\n" + docker("logs", backend).stdout + docker("logs", gateway).stderr)

            for path in ["/api/api/info", "/routes?format=json", "/preview/status", "/preview/set"]:
                port = 8080 if path == "/preview/set" else None
                rejected = [None, "opencode:wrong", f"old-user:{password}", f":{password}"]
                if values.get("OPENCODE_SERVER_PASSWORD") and values["OPENCODE_SERVER_PASSWORD"] != password:
                    rejected.append("opencode:" + values["OPENCODE_SERVER_PASSWORD"])
                for auth in rejected:
                    self.assertEqual(self.request(base, path, auth, port)[0], 401, path)
                self.assertEqual(self.request(base, path, credentials, port)[0], 200, path)

            # A rejected mutation must leave the previously selected port intact.
            self.assertEqual(self.request(base, "/preview/set", "opencode:wrong", 8081)[0], 401)
            status, body = self.request(base, "/preview/status", credentials)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["previewPort"], 8080)

            # The running server, installed binary and saved manifest must identify one release.
            manifest = json.loads(docker("exec", backend, "cat", "/usr/local/share/opencode/release.json").stdout)
            version = docker("exec", backend, "/usr/local/bin/opencode", "--version").stdout.strip()
            version = version.removeprefix("opencode ").removeprefix("v")
            self.assertEqual(version, manifest["version"].removeprefix("v"))
            info = json.loads(self.request(base, "/api/api/info", credentials)[1])
            self.assertEqual(info["version"].removeprefix("v"), version)
        finally:
            docker("rm", "-f", "-v", gateway, backend, check=False)
            docker("network", "rm", prefix, check=False)



if __name__ == "__main__":
    integration = "--integration" in sys.argv
    if integration:
        sys.argv.remove("--integration")
    unittest.main(
        defaultTest=["DockerAuthTests"] if integration else ["ComposePasswordTests", "ReleaseSnapshotTests"],
        verbosity=2, failfast=True,
    )
