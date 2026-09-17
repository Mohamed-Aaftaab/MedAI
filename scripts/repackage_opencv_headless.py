"""Rebuild vendor/opencv_python-*.whl for a version bump.

rapidocr hard-requires `opencv_python` (the GUI build), which links
libxcb/X11 and fails to import on headless hosts like Vercel's Python
runtime. `opencv-python-headless` is API-compatible and has no such
dependency, but a plain PyPI requirement under that name doesn't satisfy
rapidocr's differently-named dependency, and uv rejects a `name @ url`
alias when the wheel's own declared name doesn't match what it's meant to
satisfy (this is intentional strictness on uv's part, not a bug).

This script downloads the real opencv-python-headless wheel for a given
version and repackages it - renamed dist-info folder, corrected METADATA
`Name:` field, recomputed RECORD hash for the one changed file, renamed
.whl filename - so it legitimately declares itself as opencv-python. After
that there is no name mismatch left for uv (or anything else) to catch;
it's simply a wheel named opencv-python whose actual compiled contents are
the headless build.

Usage: python scripts/repackage_opencv_headless.py [version]
Then update requirements.txt's local wheel reference to match the new
filename if the version changed.
"""
import base64
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
VENDOR_DIR = REPO_ROOT / "vendor"
PLATFORM_SUFFIX = "cp37-abi3-manylinux2014_x86_64.manylinux_2_17_x86_64.whl"


def record_hash(data: bytes) -> str:
    digest = hashlib.sha256(data).digest()
    return "sha256=" + base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def find_wheel_url(version: str) -> str:
    data = json.loads(
        urllib.request.urlopen(
            f"https://pypi.org/pypi/opencv-python-headless/{version}/json"
        ).read()
    )
    for f in data["urls"]:
        if f["filename"].endswith(PLATFORM_SUFFIX):
            return f["url"], f["filename"]
    raise SystemExit(f"No {PLATFORM_SUFFIX} wheel found for version {version}")


def main():
    version = sys.argv[1] if len(sys.argv) > 1 else "5.0.0.93"
    url, headless_filename = find_wheel_url(version)
    old_dist_info = f"opencv_python_headless-{version}.dist-info"
    new_dist_info = f"opencv_python-{version}.dist-info"
    new_wheel_name = f"opencv_python-{version}-{PLATFORM_SUFFIX}"

    work = VENDOR_DIR / "_repackage_tmp"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    src = work / "headless.whl"
    print(f"Downloading {headless_filename}...")
    urllib.request.urlretrieve(url, src)

    extracted = work / "extracted"
    with zipfile.ZipFile(src) as z:
        z.extractall(extracted)

    old_dir = extracted / old_dist_info
    new_dir = extracted / new_dist_info
    old_dir.rename(new_dir)

    metadata_path = new_dir / "METADATA"
    metadata = metadata_path.read_text(encoding="utf-8")
    metadata = metadata.replace(
        "Name: opencv-python-headless", "Name: opencv-python", 1
    )
    assert "Name: opencv-python\n" in metadata, "METADATA Name field not rewritten"
    metadata_bytes = metadata.encode("utf-8")
    metadata_path.write_bytes(metadata_bytes)

    record_path = new_dir / "RECORD"
    lines = record_path.read_text(encoding="utf-8").splitlines()
    new_lines = []
    for line in lines:
        parts = line.split(",")
        rel_path = parts[0].replace(old_dist_info, new_dist_info)
        if rel_path.endswith(f"{new_dist_info}/METADATA"):
            new_lines.append(f"{rel_path},{record_hash(metadata_bytes)},{len(metadata_bytes)}")
        elif rel_path.endswith(f"{new_dist_info}/RECORD"):
            new_lines.append(f"{rel_path},,")
        else:
            new_lines.append(",".join([rel_path] + parts[1:]))
    record_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    VENDOR_DIR.mkdir(exist_ok=True)
    out = VENDOR_DIR / new_wheel_name
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(extracted.rglob("*")):
            if path.is_file():
                z.write(path, path.relative_to(extracted).as_posix())

    shutil.rmtree(work)
    print(f"Wrote {out} ({out.stat().st_size} bytes)")
    print("Update requirements.txt's local wheel reference if the filename changed.")


if __name__ == "__main__":
    main()
