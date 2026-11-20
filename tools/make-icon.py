# Ironleaf's icon (20 Nov 2026, the rename): the leaf mark on the iron tile, drawn by the brand kit
# (ironleaf-brand (the brand kit, kept outside this repository), src/build.py). This copies it into the app and draws the Windows installer's side pictures:
#   resources/icon.png (512 px), resources/icon.ico (16 to 256 px), build-standalone/build/icon.ico,
#   build-standalone/build/installerSidebar.bmp and uninstallerSidebar.bmp (164 x 314: the icon, the name, a line).
# Run with any Python that has Pillow: python tools/make-icon.py [brand folder]
import os, shutil, sys
from PIL import Image, ImageDraw, ImageFont

brand = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('IRONLEAF_BRAND_DIR', 'ironleaf-brand')
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
shutil.copyfile(os.path.join(brand, 'icons', 'icon.png'), os.path.join(root, 'resources', 'icon.png'))
# The ICO: the kit's own small sizes (drawn for 16 to 64 px, where the stem would blur if scaled) and every size Windows
# asks for at its display scales (125%, 150%…), the rest scaled from the 1024 drawing.
SIZES = [16, 20, 24, 28, 30, 32, 36, 40, 48, 56, 60, 64, 72, 80, 96, 128, 256]
kit = Image.open(os.path.join(brand, 'icons', 'icon.ico'))
drawn = {}
for size in kit.info.get('sizes', []):
    kit.size = size
    drawn[size[0]] = kit.copy().convert('RGBA')
big = Image.open(os.path.join(brand, 'icons', 'icon-1024.png')).convert('RGBA')
frames = [drawn.get(n) or big.resize((n, n), Image.LANCZOS) for n in SIZES]
for out in (os.path.join(root, 'resources', 'icon.ico'), os.path.join(root, 'build-standalone', 'build', 'icon.ico')):
    frames[-1].save(out, format='ICO', sizes=[(n, n) for n in SIZES], append_images=frames[:-1])

PAPER, IRON, IRON_500, LEAF = (245, 242, 234), (37, 42, 49), (93, 101, 112), (53, 117, 83)
font = lambda w, size: ImageFont.truetype(os.path.join(brand, 'src', '.cache', f'geist-{w}.ttf'), size)
S = 4  # drawn at 4x, scaled down
img = Image.new('RGB', (164 * S, 314 * S), PAPER)
icon = Image.open(os.path.join(brand, 'icons', 'icon-512.png')).convert('RGBA').resize((76 * S, 76 * S), Image.LANCZOS)
img.paste(icon, ((164 * S - 76 * S) // 2, 60 * S), icon)
d = ImageDraw.Draw(img)
def centred(y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text(((164 * S - w) / 2, y), text, font=f, fill=fill)
centred(150 * S, 'Ironleaf', font(600, 20 * S), IRON)
centred(184 * S, 'Your notes, on', font(450, 11 * S), IRON_500)
centred(200 * S, 'this PC.', font(450, 11 * S), IRON_500)
d.rectangle([68 * S, 272 * S, 96 * S, 273 * S + S], fill=LEAF)
small = img.resize((164, 314), Image.LANCZOS)
for name in ('installerSidebar.bmp', 'uninstallerSidebar.bmp'):
    small.save(os.path.join(root, 'build-standalone', 'build', name))
    print('wrote', os.path.join('build-standalone', 'build', name))
