#!/usr/bin/env python3
"""Packs a folder into a Fallout 2 archive (.dat).

    pack-dat.py <folder> <archive>

The Fallout 2 engine comes with a folder of its own data: the pictures and
words of what it adds to the game. Upstream builds a tool from the engine's
source to pack it, which the browser target cannot run; the format is simple
enough to write here instead.

The files back to back, then a directory (count; for each file the length of
its name, the name, one byte "packed", size, size as stored, offset), then the
size of that directory and of the whole archive. Nothing is packed. The
engine finds a file by bisecting the directory with a comparison that ignores
case, so the directory is in the order of the lower-cased names.
"""
import os
import struct
import sys


def lower(name):
    # As the C library does it: the letters A to Z and nothing else.
    return ''.join(chr(ord(char) + 32) if 'A' <= char <= 'Z' else char for char in name)


def main(folder, archive):
    files = []
    for root, _dirs, names in os.walk(folder):
        for name in names:
            path = os.path.join(root, name)
            files.append((os.path.relpath(path, folder).replace(os.sep, '\\'), path))
    files.sort(key=lambda file: lower(file[0]).encode('latin-1'))

    data = bytearray()
    tree = bytearray(struct.pack('<I', len(files)))
    for name, path in files:
        with open(path, 'rb') as source:
            body = source.read()
        encoded = name.encode('latin-1')
        tree += struct.pack('<I', len(encoded)) + encoded + struct.pack('<BIII', 0, len(body), len(body), len(data))
        data += body

    with open(archive, 'wb') as out:
        out.write(data)
        out.write(tree)
        out.write(struct.pack('<II', len(tree), len(data) + len(tree) + 8))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
