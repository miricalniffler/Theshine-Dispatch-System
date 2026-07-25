from pathlib import Path
from PIL import Image, ImageDraw

for folder in sorted(Path('tmp/frames').iterdir()):
    if not folder.is_dir():
        continue
    files = sorted(folder.glob('*.jpg'))
    thumb_w, thumb_h, label_h, cols = 320, 200, 28, 4
    rows = (len(files) + cols - 1) // cols
    canvas = Image.new('RGB', (cols * thumb_w, rows * (thumb_h + label_h)), 'white')
    draw = ImageDraw.Draw(canvas)
    for n, file in enumerate(files):
        image = Image.open(file).convert('RGB')
        image.thumbnail((thumb_w - 8, thumb_h - 8))
        x = (n % cols) * thumb_w + (thumb_w - image.width) // 2
        y = (n // cols) * (thumb_h + label_h) + (thumb_h - image.height) // 2
        canvas.paste(image, (x, y))
        draw.text(((n % cols) * thumb_w + 6, (n // cols) * (thumb_h + label_h) + thumb_h + 4), file.stem, fill='black')
    canvas.save(Path('tmp/frames') / f'{folder.name}-contact.jpg', quality=88)
