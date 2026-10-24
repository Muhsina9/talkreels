# Generates the three illustrated sample characters used by "Try the sample cast".
from PIL import Image, ImageDraw, ImageFilter
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples')
W, H = 768, 1024

def gradient(c1, c2):
    img = Image.new('RGB', (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        row = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = row
    return img

def person(name, bg, skin, hair, shirt, hair_style, accent):
    img = gradient(*bg)
    d = ImageDraw.Draw(img)
    cx = W // 2
    # shoulders / shirt
    d.rounded_rectangle((cx - 270, 760, cx + 270, 1100), radius=140, fill=shirt)
    d.rectangle((cx - 45, 640, cx + 45, 800), fill=skin)
    # hair back
    if hair_style == 'long':
        d.rounded_rectangle((cx - 215, 250, cx + 215, 760), radius=150, fill=hair)
    # face
    d.ellipse((cx - 175, 290, cx + 175, 700), fill=skin)
    # hair front
    if hair_style == 'long':
        d.pieslice((cx - 195, 250, cx + 195, 560), 180, 360, fill=hair)
        d.polygon([(cx - 195, 405), (cx - 20, 300), (cx - 60, 420)], fill=hair)
    elif hair_style == 'short':
        d.pieslice((cx - 185, 255, cx + 185, 580), 180, 360, fill=hair)
        d.rectangle((cx - 185, 405, cx - 150, 470), fill=hair)
        d.rectangle((cx + 150, 405, cx + 185, 470), fill=hair)
    # eyes
    for ex in (-70, 70):
        d.ellipse((cx + ex - 30, 455, cx + ex + 30, 505), fill='white')
        d.ellipse((cx + ex - 14, 462, cx + ex + 14, 498), fill=(40, 30, 30))
        d.ellipse((cx + ex - 5, 468, cx + ex + 3, 476), fill='white')
        d.arc((cx + ex - 38, 420, cx + ex + 38, 460), 200, 340, fill=hair, width=9)
    # nose + mouth
    d.arc((cx - 24, 520, cx + 24, 570), 20, 160, fill=tuple(max(0, c - 60) for c in skin), width=5)
    d.chord((cx - 62, 585, cx + 62, 655), 0, 180, fill=(150, 50, 60))
    d.chord((cx - 48, 585, cx + 48, 612), 0, 180, fill='white')
    # cheeks + accent
    for ex in (-110, 110):
        d.ellipse((cx + ex - 24, 540, cx + ex + 24, 580), fill=accent + (70,)) if False else None
    img = img.filter(ImageFilter.SMOOTH)
    img.save(os.path.join(OUT, name + '.jpg'), quality=90)

person('maya', ((255, 190, 150), (140, 90, 190)), (236, 188, 150), (45, 30, 40), (47, 43, 232), 'long', (255, 120, 120))
person('leo', ((120, 200, 230), (30, 70, 140)), (160, 108, 78), (25, 20, 20), (255, 201, 60), 'short', (255, 140, 100))
person('juno', ((170, 230, 190), (30, 110, 100)), (250, 214, 184), (200, 80, 60), (30, 35, 60), 'long', (255, 150, 150))
print('ok')
