"""Consistent read-only source dump, empty-target restore, then full table verification."""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit, unquote

config = json.loads(Path(sys.argv[1]).read_text())
source = urlsplit(config['source'])
directory = Path('/var/backups/dokitruyen')
directory.mkdir(mode=0o700, exist_ok=True)
environment = os.environ | {'PGPASSWORD': unquote(source.password), 'PGSSLMODE': 'verify-full',
    'PGSSLROOTCERT': '/etc/ssl/certs/ca-certificates.crt', 'PGCHANNELBINDING': 'require'}
source_args = ['--host', source.hostname, '--port', str(source.port or 5432),
               '--username', unquote(source.username), '--dbname', source.path.lstrip('/')]

def source_query(query):
    return subprocess.run(['psql', *source_args, '-XAt', '-v', 'ON_ERROR_STOP=1'], env=environment,
                          input=query, text=True, capture_output=True, check=True).stdout.strip()

def target_query(query):
    return subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-d', 'dokitruyen'],
                          input=query, text=True, capture_output=True, check=True).stdout.strip()

backup_only = '--backup-only' in sys.argv
if not backup_only and target_query("SELECT count(*) FROM pg_tables WHERE schemaname='public'") != '0':
    raise RuntimeError('Target is not empty; refusing to overwrite data')
snapshot = directory / ('neon-initial.dump' if backup_only else 'neon-final.dump')
subprocess.run(['pg_dump', *source_args, '--format=custom', '--no-owner', '--no-acl', '--file', str(snapshot)],
               env=environment, check=True)
snapshot.chmod(0o600)
print('Consistent source snapshot saved:', snapshot.stat().st_size, 'bytes', flush=True)
if backup_only:
    sys.exit(0)
with snapshot.open('rb') as archive:
    subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl',
                    '--role=dokitruyen_app', '--dbname=dokitruyen'], stdin=archive, check=True)
tables_query = "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
tables = source_query(tables_query).splitlines()
if tables != target_query(tables_query).splitlines():
    raise RuntimeError('Source and target tables differ')
report = []
for table in tables:
    quoted = '"' + table.replace('"', '""') + '"'
    query = "SELECT json_build_object('count',count(*),'checksum',coalesce(sum(('x'||substr(md5(row_to_json(t)::text),1,15))::bit(60)::bigint),0)::text)::text FROM " + quoted + ' t'
    before, after = json.loads(source_query(query)), json.loads(target_query(query))
    if before != after:
        raise RuntimeError('Content verification failed: ' + table)
    report.append({'table': table, **after})
    print('Verified', table, after['count'], flush=True)
(directory / 'migration-verification.json').write_text(json.dumps(report, indent=2))
target_query('ANALYZE')
print('Migration verified:', len(report), 'tables,', sum(item['count'] for item in report), 'rows', flush=True)
