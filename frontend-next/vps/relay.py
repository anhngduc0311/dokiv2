"""Bounded, read-only MangaDex relay. TLS and disk caching are handled by Nginx."""
import hmac
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

API_PATH = re.compile(r"^/(?:manga(?:/tag|/[0-9a-f-]{36}(?:/feed)?)?|chapter/[0-9a-f-]{36}|at-home/server/[0-9a-f-]{36}|statistics/manga|author)$", re.I)
TOKEN = os.environ["RELAY_TOKEN"]
SLOTS = threading.BoundedSemaphore(12)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def target_for(path):
    uri = urlsplit(path)
    if len(path) > 4096:
        raise ValueError("Request too long")
    if uri.path.startswith('/api/') and API_PATH.fullmatch(uri.path[4:]):
        return 'https://api.mangadex.org' + uri.path[4:] + ('?' + uri.query if uri.query else ''), False
    if uri.path == '/image':
        image = parse_qs(uri.query).get('url', [''])[0]
        image_uri = urlsplit(image)
        host = image_uri.hostname or ''
        if (image_uri.scheme == 'https' and image_uri.port in (None, 443)
                and not image_uri.username and not image_uri.password
                and not image_uri.fragment
                and (host in ('uploads.mangadex.org', 'mangadex.org') or host.endswith('.mangadex.network'))):
            return image, True
    raise ValueError("Source not allowed")


class Relay(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log the private relay path or visitor requests.

    def reply(self, status, message):
        body = json.dumps({'message': message}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_POST(self):
        self.reply(405, 'Method not allowed')

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, 'ok')
        prefix, _, suffix = self.path.lstrip('/').partition('/')
        if not hmac.compare_digest(prefix, TOKEN):
            return self.reply(403, 'Forbidden')
        try:
            target, image = target_for('/' + suffix)
        except (ValueError, UnicodeError):
            return self.reply(400, 'Source not allowed')
        if not SLOTS.acquire(blocking=False):
            return self.reply(503, 'Relay busy; retry shortly')
        started = False
        try:
            headers = {'User-Agent': 'DokiTruyen/1.0 (+https://dokitruyen.com)',
                       'Accept': 'image/*' if image else 'application/json'}
            if image:
                headers['Referer'] = 'https://mangadex.org/'
            request = Request(target, headers=headers, method=self.command)
            with build_opener(NoRedirect()).open(request, timeout=20) as upstream:
                content_type = upstream.headers.get('Content-Type', '')
                if image and not content_type.lower().startswith('image/'):
                    return self.reply(502, 'Invalid source image')
                maximum = 24 * 1024 * 1024 if image else 8 * 1024 * 1024
                length = upstream.headers.get('Content-Length')
                if length and int(length) > maximum:
                    return self.reply(502, 'Source response too large')
                self.send_response(upstream.status)
                self.send_header('Content-Type', content_type or 'application/json')
                self.send_header('Cache-Control', 'public, max-age=' + ('86400' if image else '30'))
                self.send_header('X-Content-Type-Options', 'nosniff')
                if length:
                    self.send_header('Content-Length', length)
                self.end_headers()
                started = True
                if self.command != 'HEAD':
                    total = 0
                    while chunk := upstream.read(65536):
                        total += len(chunk)
                        if total > maximum:
                            break
                        self.wfile.write(chunk)
        except HTTPError as error:
            if not started:
                self.reply(error.code if error.code in (404, 429) else 502, 'Source temporarily unavailable')
        except Exception:
            if not started:
                self.reply(502, 'Source temporarily unavailable')
        finally:
            SLOTS.release()


if __name__ == '__main__':
    if len(TOKEN) < 32:
        raise RuntimeError('RELAY_TOKEN must have at least 32 characters')
    server = ThreadingHTTPServer(('127.0.0.1', 8787), Relay)
    server.daemon_threads = True
    server.serve_forever()
