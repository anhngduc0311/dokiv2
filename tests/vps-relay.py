import importlib.util
import io
import os
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

os.environ['RELAY_TOKEN'] = 'test-relay-token-with-at-least-32-characters'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('relay', Path(__file__).parents[1] / 'frontend-next/vps/relay.py')
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)
for path in ['/image?url=http://127.0.0.1/', '/image?url=https://mangadex.org.evil.test/a',
             '/image?url=https://u:p@uploads.mangadex.org/a', '/image?url=https://uploads.mangadex.org:8443/a',
             '/api/auth/login']:
    try:
        relay.target_for(path)
        raise AssertionError('Unsafe target accepted: ' + path)
    except ValueError:
        pass
assert relay.target_for('/api/manga?limit=1')[0] == 'https://api.mangadex.org/manga?limit=1'

class Upstream(io.BytesIO):
    status = 200
    headers = {'Content-Type': 'application/json', 'Content-Length': '2'}

class Opener:
    def open(self, request, timeout):
        assert not request.has_header('Cookie')
        assert not request.has_header('Authorization')
        return Upstream(b'{}')

server = relay.ThreadingHTTPServer(('127.0.0.1', 0), relay.Relay)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
try:
    with patch.object(relay, 'build_opener', return_value=Opener()) as opener:
        try:
            urllib.request.urlopen(base + '/wrong/api/manga')
            raise AssertionError('Missing authorization accepted')
        except urllib.error.HTTPError as error:
            assert error.code == 403
        opener.assert_not_called()
        request = urllib.request.Request(base + '/' + relay.TOKEN + '/api/manga', headers={'Cookie': 'private', 'Authorization': 'private'})
        with urllib.request.urlopen(request) as response:
            assert response.read() == b'{}'
        assert opener.call_count == 1
    assert relay.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://127.0.0.1/') is None
finally:
    server.shutdown()
    server.server_close()
print('VPS relay authorization, fixed upstream routes, credential isolation and redirect rejection passed')
