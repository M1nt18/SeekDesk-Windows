from pathlib import Path
from PIL import Image
import colorsys

root = Path(__file__).resolve().parent.parent
source = Image.open(root / 'public/assets/app-icon.png').convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS)
out = root / 'public/brands'
out.mkdir(exist_ok=True)
for brand, hue in {'blue': 218, 'teal': 173, 'green': 136, 'purple': 264, 'orange': 34, 'red': 6}.items():
    result = source.copy()
    pixels = []
    for r, g, b, a in source.getdata():
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s > 0.12:
            r, g, b = [round(c * 255) for c in colorsys.hsv_to_rgb(((h * 360 + hue - 218) % 360) / 360, s, v)]
        pixels.append((r, g, b, a))
    result.putdata(pixels)
    result.save(out / (brand + '.png'))
print('Generated six running application icons')
