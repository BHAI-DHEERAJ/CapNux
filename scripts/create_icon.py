#!/usr/bin/env python3
"""Create the small CapNux Linux app icon without a graphics runtime."""
from __future__ import annotations

import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src-tauri", "icons")


def distance_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if not length2 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def build_icon(size: int, scale: int = 4) -> bytes:
    high = size * scale
    radius = size * 0.23
    strokes = [
        (size * 0.335, size * 0.68, size * 0.335, size * 0.32),
        (size * 0.335, size * 0.32, size * 0.665, size * 0.68),
        (size * 0.665, size * 0.68, size * 0.665, size * 0.32),
    ]
    stroke_radius = max(1.4, size * 0.047)
    high_pixels = bytearray(high * high * 4)
    for y in range(high):
        for x in range(high):
            px = (x + 0.5) / scale
            py = (y + 0.5) / scale
            dx = max(size * 0.08 - px, 0.0, px - size * 0.92)
            dy = max(size * 0.08 - py, 0.0, py - size * 0.92)
            inside = dx * dx + dy * dy <= radius * radius or (dx == 0 and dy == 0)
            offset = (y * high + x) * 4
            if not inside:
                continue
            mix = max(0.0, min(1.0, (px + py) / (size * 1.8)))
            start = (43, 232, 217)
            end = (8, 112, 151)
            color = tuple(round(start[i] + (end[i] - start[i]) * mix) for i in range(3))
            for ax, ay, bx, by in strokes:
                if distance_to_segment(px, py, ax, ay, bx, by) <= stroke_radius:
                    color = (5, 25, 30)
                    break
            high_pixels[offset:offset + 4] = bytes((*color, 255))

    # Box-filter the supersampled RGBA image for a clean antialiased edge.
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            sums = [0, 0, 0, 0]
            for sy in range(scale):
                for sx in range(scale):
                    offset = (((y * scale + sy) * high) + (x * scale + sx)) * 4
                    for channel in range(4):
                        sums[channel] += high_pixels[offset + channel]
            samples = scale * scale
            rows.extend(round(value / samples) for value in sums)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + png_chunk(b"IEND", b"")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for size, name in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png")]:
        with open(os.path.join(OUT, name), "wb") as icon:
            icon.write(build_icon(size))


if __name__ == "__main__":
    main()
