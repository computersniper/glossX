"""Render the Gloss SVG mark as a multi-resolution Windows icon.

This maintenance helper requires Pillow. The generated ``packaging/gloss.ico``
is checked into the project, so Pillow is not needed to build or run Gloss.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "packaging" / "gloss.ico"
CANVAS = 1024
VIEWBOX = 96
SCALE = CANVAS / VIEWBOX


def _point(value: float) -> int:
    return round(value * SCALE)


def _round_line(
    draw: ImageDraw.ImageDraw,
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    fill: str,
    width: float,
) -> None:
    xy = tuple(_point(value) for point in (start, end) for value in point)
    line_width = _point(width)
    radius = line_width // 2
    draw.line(xy, fill=fill, width=line_width)
    for x, y in (xy[:2], xy[2:]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def render() -> Image.Image:
    """Render the shapes from docs/logo.svg onto a transparent canvas."""
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    page = (
        _point(20),
        _point(27),
        _point(63),
        _point(82),
    )
    draw.rounded_rectangle(
        page,
        radius=_point(6),
        fill=(167, 139, 250, 41),
        outline="#7aa2f7",
        width=_point(3),
    )
    for start, end in (
        ((30, 45), (53, 45)),
        ((30, 56), (53, 56)),
        ((30, 67), (45, 67)),
    ):
        _round_line(draw, start, end, fill="#7aa2f7", width=3)

    draw.ellipse(
        (_point(58), _point(17), _point(78), _point(37)),
        fill="#a78bfa",
    )
    for start, end in (
        ((68, 7), (68, 12)),
        ((84, 13), (80, 17)),
        ((88, 27), (83, 27)),
        ((53, 11), (57, 16)),
    ):
        _round_line(draw, start, end, fill="#a78bfa", width=3)

    return image


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    render().save(
        OUTPUT,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Gloss icon: {OUTPUT}")


if __name__ == "__main__":
    main()
