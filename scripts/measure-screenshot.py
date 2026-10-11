"""Find tap landmarks in a device screenshot, so adb taps are measured.

An eyeballed tap on the phone lands ~100 px off (the CSS viewport is 360 wide
at DPR 3, plus the status bar and inset offsets), and a miss on a 20 px chevron
can toggle the wrong control with no visible error until the next screenshot.
This reads the pulled screenshot instead: it averages brightness across a band
and prints the runs that stand out — hairlines, header glyphs, text rows —
which bound the control to tap. The center of a run is the tap coordinate on
that axis; the other axis comes from the band (e.g. x ~60 for the sidebar's
left gutter).

Usage:
  python scripts/measure-screenshot.py shot.png
  python scripts/measure-screenshot.py shot.png --box 0,400,200,1300 --find bright
  python scripts/measure-screenshot.py shot.png --box 0,400,200,1300 --find dark
  python scripts/measure-screenshot.py shot.png --axis cols --box 0,500,1080,700

Options:
  --box LEFT,TOP,RIGHT,BOTTOM  scan window in image pixels. Default
      0,400,200,1300: the left gutter over the sidebar on a 1080x2460 shot,
      where the section chevrons and folder twisties live.
  --find bright|dark  bright glyphs on a dark background (dark theme) or dark
      glyphs on a light one (light theme). Default bright.
  --axis rows|cols|both  rows finds horizontal rules and rows, cols finds
      vertical edges. Default rows.
  --threshold N  brightness cutoff. Defaults 30 for bright, 220 for dark.

Needs Pillow (`pip install pillow`); otherwise stdlib only, so it runs anywhere
with a pulled PNG and needs no device connection. See `docs/11-verification.md`
§3.5b for the surrounding tap → screenshot → measure loop.
"""

import argparse
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is required: pip install pillow')


def parse_box(value: str) -> tuple[int, int, int, int]:
    try:
        left, top, right, bottom = (int(part) for part in value.split(','))
    except ValueError:
        raise argparse.ArgumentTypeError('expected LEFT,TOP,RIGHT,BOTTOM integers')
    if not (0 <= left < right and 0 <= top < bottom):
        raise argparse.ArgumentTypeError('expected 0 <= LEFT < RIGHT and 0 <= TOP < BOTTOM')
    return left, top, right, bottom


def runs(values: list[float], match) -> list[tuple[int, int, float]]:
    """Contiguous index runs where match holds, with each run's peak value."""
    found: list[tuple[int, int, float]] = []
    start: int | None = None
    for index, value in enumerate(values):
        if match(value):
            if start is None:
                start = index
        elif start is not None:
            found.append((start, index - 1, peak(values[start:index])))
            start = None
    if start is not None:
        found.append((start, len(values) - 1, peak(values[start:])))
    return found


def peak(values: list[float]) -> float:
    return max(values) if BRIGHT else min(values)


BRIGHT = True


def main() -> None:
    global BRIGHT
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('shot', help='pulled screenshot PNG (1080x2460 from screencap)')
    parser.add_argument('--box', type=parse_box, default=(0, 400, 200, 1300))
    parser.add_argument('--find', choices=('bright', 'dark'), default='bright')
    parser.add_argument('--axis', choices=('rows', 'cols', 'both'), default='rows')
    parser.add_argument('--threshold', type=float, default=None)
    args = parser.parse_args()

    BRIGHT = args.find == 'bright'
    threshold = args.threshold if args.threshold is not None else (30.0 if BRIGHT else 220.0)
    match = (lambda v: v >= threshold) if BRIGHT else (lambda v: v <= threshold)

    img = Image.open(args.shot).convert('L')
    width, height = img.size
    left, top, right, bottom = args.box
    if right > width or bottom > height:
        sys.exit(f'box {args.box} exceeds image size {width}x{height}')
    px = img.load()
    print(f'size: {width}x{height} box: {args.box} find: {args.find} threshold: {threshold}')

    if args.axis in ('rows', 'both'):
        means = [
            sum(px[x, y] for x in range(left, right)) / (right - left) for y in range(top, bottom)
        ]
        print('--- rows ---')
        for start, end, extreme in runs(means, match):
            print(f'run {top + start}..{top + end} (center {top + (start + end) // 2}) peak={extreme:.1f}')
    if args.axis in ('cols', 'both'):
        means = [
            sum(px[x, y] for y in range(top, bottom)) / (bottom - top) for x in range(left, right)
        ]
        print('--- cols ---')
        for start, end, extreme in runs(means, match):
            print(
                f'run {left + start}..{left + end} (center {left + (start + end) // 2})'
                f' peak={extreme:.1f}'
            )


if __name__ == '__main__':
    main()
