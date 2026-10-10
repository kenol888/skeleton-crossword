"""Tiny development server: serves this folder with caching switched off, so edits show up
on reload. Usage: python tools/serve.py [port]   (default 8080)"""
import functools
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
handler = functools.partial(NoCacheHandler, directory=ROOT)
with http.server.ThreadingHTTPServer(('', port), handler) as httpd:
    print(f'Serving {os.path.abspath(ROOT)} at http://localhost:{port}/ (no caching)')
    httpd.serve_forever()
