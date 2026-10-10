"""Writes the app icons (a 3x3 skeleton grid) using only the standard library."""
import struct, zlib, os, sys

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
PAPER = (233, 237, 242)
INK = (20, 24, 30)
ACCENT = (61, 90, 128)
LAYOUT = ['..#', '.#.', '#..']  # symmetric under 180 degree rotation

def png(path, size):
    pad = round(size * 0.16)
    inner = size - 2 * pad
    cell = inner // 3
    inner = cell * 3
    pad = (size - inner) // 2
    line = max(2, size // 90)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            c = PAPER
            gx, gy = x - pad, y - pad
            if 0 <= gx < inner and 0 <= gy < inner:
                col, rw = gx // cell, gy // cell
                c = INK if LAYOUT[rw][col] == '#' else (255, 255, 255)
                if LAYOUT[rw][col] != '#' and rw == 1 and col == 0:
                    c = (255, 255, 255)
                lx, ly = gx % cell, gy % cell
                if lx < line or ly < line or lx >= cell - line or ly >= cell - line:
                    c = INK if LAYOUT[rw][col] == '#' else (255, 255, 255)
                    if LAYOUT[rw][col] != '#' and (lx < line or ly < line or lx >= cell - line or ly >= cell - line):
                        c = ACCENT
            elif -line <= gx < inner + line and -line <= gy < inner + line:
                c = ACCENT
            row += bytes(c)
        rows.append(b'\x00' + bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        body = t + d
        return struct.pack('>I', len(d)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)

for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    png(os.path.join(OUT, name), size)
print('icons written')
