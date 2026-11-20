# Ironleaf's tray icons (20 Nov 2026, the rename): the leaf mark alone, in one colour so it sits in a tray like the
# system's own icons: white for a dark taskbar, iron for a light one (src/main/tray.ts follows the system theme).
# They are drawn by the brand kit (ironleaf-brand (the brand kit, kept outside this repository), src/build.py: icons/tray/); this copies them into
# resources/tray/:
#   ironleaf-tray-white.ico, ironleaf-tray-dark.ico          16, 20, 24 and 32 px (Windows picks by its scale)
#   ironleaf-tray-white.png (+@2x), ironleaf-tray-dark.png (+@2x)   24 px and 48 px (Linux panels, macOS)
# Run with any Python: python tools/make-tray-icons.py [brand folder]
import os, shutil, sys

brand = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('IRONLEAF_BRAND_DIR', 'ironleaf-brand')
src = os.path.join(brand, 'icons', 'tray')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources', 'tray')
os.makedirs(out, exist_ok=True)
for tone in ('white', 'dark'):
    for name in (f'ironleaf-tray-{tone}.ico', f'ironleaf-tray-{tone}.png', f'ironleaf-tray-{tone}@2x.png'):
        shutil.copyfile(os.path.join(src, name), os.path.join(out, name))
        print('wrote', os.path.join('resources', 'tray', name))
