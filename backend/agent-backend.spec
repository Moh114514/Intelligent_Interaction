from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPEC).resolve().parent.parent
hidden = []
for package in ("uvicorn", "websockets", "pypdf", "docx", "openpyxl", "pptx", "PIL"):
    hidden.extend(collect_submodules(package))

a = Analysis(
    [str(ROOT / "backend" / "sidecar_entry.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[],
    hiddenimports=sorted(set(hidden)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "tkinter"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="agent-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    version=str(ROOT / "backend" / "windows-version.txt"),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="backend-sidecar",
)