"""Bundle corresponding source; never include installed apps or browser profiles."""
from pathlib import Path
import hashlib
import os
import zipfile

project = Path(__file__).resolve().parent.parent
repository = project.parent
release = project / 'release'
release.mkdir(exist_ok=True)
archive = release / 'SeekDesk-Windows-0.1.0-source.zip'
excluded = {'.git', 'node_modules', '.test-data', 'release', 'dist', 'dist-electron', '__pycache__'}
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for directory, subdirectories, filenames in os.walk(repository):
        subdirectories[:] = [name for name in subdirectories if name not in excluded]
        for filename in filenames:
            source = Path(directory) / filename
            relative = source.relative_to(repository)
            bundle.write(source, str(Path('SeekDesk-Windows') / relative))
hashes = []
for artifact in [release / 'SeekDesk-Windows-0.1.0-x64-Setup.exe', archive]:
    digest = hashlib.file_digest(artifact.open('rb'), 'sha256').hexdigest()
    hashes.append(f'{digest}  {artifact.name}')
    print(f'{artifact.name}: {artifact.stat().st_size:,} bytes')
(release / 'SHA256SUMS.txt').write_text('\n'.join(hashes) + '\n', encoding='utf-8')
