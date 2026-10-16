"""Deterministic editable sample archive; never includes generated caches."""
import pathlib, sys, zipfile
root, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(root.rglob('*')):
        if not file.is_file() or any(p in ('Library', 'bin', 'obj', 'node_modules') or p.startswith('.') for p in file.relative_to(root).parts):
            continue
        info = zipfile.ZipInfo('Return/' + file.relative_to(root).as_posix(), (2026, 10, 17, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, file.read_bytes())
