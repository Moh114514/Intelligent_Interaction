from __future__ import annotations

import gc
import json
import sys
import tempfile
from pathlib import Path


def self_test() -> int:
    import certifi
    import docx
    import openpyxl
    import PIL.Image
    import pptx
    import pypdf

    from backend.app.memory import SQLiteStore

    with tempfile.TemporaryDirectory(prefix="garfield-sidecar-self-test-", ignore_cleanup_errors=True) as directory:
        store = SQLiteStore(Path(directory))
        store.initialize()
        payload = {
            "status": "ok",
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "schema_version": store.schema_version,
            "certificate_bundle": Path(certifi.where()).is_file(),
            "document_modules": [pypdf.__name__, docx.__name__, openpyxl.__name__, pptx.__name__, PIL.Image.__name__],
        }
        print(json.dumps(payload, ensure_ascii=True), flush=True)
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    from backend.app.main import run
    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())