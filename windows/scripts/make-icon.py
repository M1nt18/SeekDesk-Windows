from pathlib import Path
from PIL import Image

project = Path(__file__).resolve().parent.parent
target = project / 'build'
target.mkdir(exist_ok=True)
image = Image.open(project.parent / 'assets' / 'app-icon.png').convert('RGBA')
image.save(target / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.resize((256,256)).save(target / 'icon.png')
print(target / 'icon.ico')
