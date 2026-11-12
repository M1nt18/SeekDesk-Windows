"""Archive committed source only; untracked profiles, secrets and build logs never enter it."""
from pathlib import Path
import argparse
import json
import subprocess

project = Path(__file__).resolve().parent.parent
repository = project.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=project / 'release')
args = parser.parse_args()
release = args.output.resolve()
if not release.is_relative_to(project):
    raise SystemExit('Source output must remain inside the Windows project directory')
version = json.loads((project / 'package.json').read_text(encoding='utf-8'))['version']
dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=repository, text=True)
if dirty.strip():
    raise SystemExit('Commit source changes before creating the corresponding source archive')
release.mkdir(parents=True, exist_ok=True)
archive = release / f'SeekDesk-Windows-{version}-source.zip'
subprocess.run([
    'git', 'archive', '--format=zip', f'--prefix=SeekDesk-Windows-{version}/',
    '--output', str(archive), 'HEAD',
], cwd=repository, check=True)
print(f'{archive.name}: {archive.stat().st_size:,} bytes')
