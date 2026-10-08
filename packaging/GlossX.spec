# PyInstaller recipe for the portable, single-file desktop application.
from pathlib import Path
import sys


project_root = Path(SPECPATH).parent
windows_icon = project_root / "packaging" / "gloss.ico"

a = Analysis(
    [str(project_root / "packaging" / "windows_launcher.py")],
    pathex=[str(project_root / "backend")],
    binaries=[],
    datas=[
        (str(project_root / "frontend" / "dist"), "frontend/dist"),
        (str(project_root / "packaging" / "gloss.ico"), "packaging"),
    ],
    hiddenimports=[
        "webview",
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
        # pywebview loads these platform backends dynamically. Keep them in
        # the frozen bundle so the macOS and Linux release archives start
        # without a Python environment beside them.
        "webview.platforms.cocoa",
        "webview.platforms.gtk",
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Gloss does not use packaging/build APIs at runtime. Excluding these also
    # avoids PyInstaller's pkg_resources hook pulling setuptools' optional
    # ``backports`` namespace into the portable executable.
    excludes=[
        "pkg_resources",
        "setuptools",
        "_distutils_hack",
        # Gloss deliberately uses Edge WebView2. Do not let Qt packages from
        # the Python installation influence the frozen desktop application.
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "webview.platforms.qt",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Gloss",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # PyInstaller expects an .icns file on macOS. The existing .ico is used
    # only for Windows releases; the other platform archives use their native
    # executable icon defaults.
    icon=str(project_root / "packaging" / "gloss.ico") if sys.platform == "win32" else None,
)
