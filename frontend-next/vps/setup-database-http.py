"""Install the IP-restricted gateway after explicit approval of the HTTPS access path."""
import json
from pathlib import Path
import subprocess
import sys

config = json.loads(Path(sys.argv[1]).read_text())
base = Path(sys.argv[2])

def run(*args):
    subprocess.run(args, check=True)

if subprocess.run(['id', 'dokitruyen-db'], capture_output=True).returncode:
    run('useradd', '--system', '--no-create-home', '--shell', '/usr/sbin/nologin', 'dokitruyen-db')
run('install', '-d', '-o', 'root', '-g', 'root', '-m', '0755', '/opt/dokitruyen-database')
run('install', '-o', 'root', '-g', 'root', '-m', '0644', str(base / 'database-http.cjs'), '/opt/dokitruyen-database/database-http.cjs')
private = Path('/etc/dokitruyen-database.env')
private.write_text('DATABASE_HTTP_TOKEN=' + config['http_token'] + '\nDATABASE_PASSWORD=' + config['password'] + '\n')
private.chmod(0o600)
run('install', '-o', 'root', '-g', 'root', '-m', '0644', str(base / 'dokitruyen-database.service'), '/etc/systemd/system/dokitruyen-database.service')
run('install', '-o', 'root', '-g', 'root', '-m', '0644', str(base / 'database-location.conf'), '/etc/nginx/dokitruyen-database-location.conf')
nginx = Path('/etc/nginx/conf.d/dokitruyen-relay.conf')
text = nginx.read_text()
include = '    include /etc/nginx/dokitruyen-database-location.conf;\n'
if include not in text:
    # The first server is the Certbot HTTPS block; ensure it contains listen 443.
    start = text.index('server {')
    end = text.index('\n}', start)
    if 'listen 443' not in text[start:end]:
        raise RuntimeError('Review HTTPS server block before inserting database location')
    before = nginx.with_suffix('.conf.before-database-http')
    if not before.exists():
        before.write_text(text)
    text = text[:start + len('server {')] + '\n' + include + text[start + len('server {'):]
    nginx.write_text(text)
run('nginx', '-t')
run('systemctl', 'daemon-reload')
run('systemctl', 'enable', '--now', 'dokitruyen-database')
run('systemctl', 'reload', 'nginx')
print('Private gateway installed; hosting-IP restriction and bearer authentication enabled.')
