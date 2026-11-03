"""Run once as root with a private JSON configuration; never prints credentials."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import urlsplit, unquote

config = json.loads(Path(sys.argv[1]).read_text())
assert os.geteuid() == 0
password = config['password']
assert len(password) >= 48 and all(c in '0123456789abcdef' for c in password)

def sql(statement):
    return subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-d', 'postgres'],
                          input=statement, text=True, capture_output=True, check=True).stdout.strip()

if sql("SELECT count(*) FROM pg_roles WHERE rolname='dokitruyen_app'") != '0':
    raise RuntimeError('Target application role already exists; inspect before proceeding')
if sql("SELECT count(*) FROM pg_database WHERE datname='dokitruyen'") != '0':
    raise RuntimeError('Target database already exists; refusing to overwrite')

tls = Path('/var/lib/postgresql/dokitruyen-tls')
tls.mkdir(mode=0o750, exist_ok=True)
for original, target in [('fullchain.pem', 'server.crt'), ('privkey.pem', 'server.key')]:
    shutil.copyfile('/etc/letsencrypt/live/source.dokitruyen.com/' + original, tls / target)
    shutil.chown(tls / target, user='postgres', group='postgres')
    (tls / target).chmod(0o600)
shutil.chown(tls, user='postgres', group='postgres')

settings = """listen_addresses = '*'
max_connections = 40
shared_buffers = '64MB'
effective_cache_size = '256MB'
work_mem = '2MB'
maintenance_work_mem = '32MB'
max_wal_size = '512MB'
min_wal_size = '80MB'
password_encryption = 'scram-sha-256'
ssl = on
ssl_cert_file = '/var/lib/postgresql/dokitruyen-tls/server.crt'
ssl_key_file = '/var/lib/postgresql/dokitruyen-tls/server.key'
ssl_min_protocol_version = 'TLSv1.2'
"""
Path('/etc/postgresql/18/main/conf.d/dokitruyen.conf').write_text(settings)
hba = Path('/etc/postgresql/18/main/pg_hba.conf')
shutil.copyfile(hba, str(hba) + '.before-dokitruyen')
hba.write_text("hostssl dokitruyen dokitruyen_app 160.30.20.248/32 scram-sha-256\n" + hba.read_text())
sql("CREATE ROLE dokitruyen_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30 PASSWORD '" + password + "';")
sql('CREATE DATABASE dokitruyen OWNER dokitruyen_app;')
subprocess.run(['systemctl', 'restart', 'postgresql'], check=True)

hook = Path('/etc/letsencrypt/renewal-hooks/deploy/dokitruyen-postgres')
hook.write_text('''#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/source.dokitruyen.com ] || exit 0
install -o postgres -g postgres -m 600 "$RENEWED_LINEAGE/fullchain.pem" /var/lib/postgresql/dokitruyen-tls/server.crt
install -o postgres -g postgres -m 600 "$RENEWED_LINEAGE/privkey.pem" /var/lib/postgresql/dokitruyen-tls/server.key
systemctl reload postgresql
''')
hook.chmod(0o750)

backup = Path('/var/backups/dokitruyen')
backup.mkdir(mode=0o700, exist_ok=True)
source = urlsplit(config['source'])
environment = os.environ | {'PGPASSWORD': unquote(source.password), 'PGSSLMODE': 'verify-full',
                           'PGSSLROOTCERT': '/etc/ssl/certs/ca-certificates.crt', 'PGCHANNELBINDING': 'require'}
subprocess.run(['pg_dump', '--host', source.hostname, '--port', str(source.port or 5432),
                '--username', unquote(source.username), '--dbname', source.path.lstrip('/'),
                '--format=custom', '--no-owner', '--no-acl', '--file', str(backup / 'neon-initial.dump')],
               env=environment, check=True)
(backup / 'neon-initial.dump').chmod(0o600)
print('PostgreSQL configured; initial Neon snapshot saved. No credentials printed.')
