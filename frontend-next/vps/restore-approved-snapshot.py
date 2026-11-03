"""Restore the user-approved snapshot and verify every COPY row against its archive."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

archive = Path('/var/backups/dokitruyen/neon-initial.dump')

def query(statement):
    return subprocess.check_output(['runuser','-u','postgres','--','psql','-XqAt','-v','ON_ERROR_STOP=1','-d','dokitruyen','-c',statement],text=True).strip()

if query("SELECT count(*) FROM pg_tables WHERE schemaname='public'") != '0':
    raise RuntimeError('Target is not empty; refusing overwrite')
with archive.open('rb') as data:
    subprocess.run(['runuser','-u','postgres','--','pg_restore','--exit-on-error','--no-owner','--no-acl','--role=dokitruyen_app','--dbname=dokitruyen'],stdin=data,check=True)
print('Approved snapshot restored',flush=True)
process = subprocess.Popen(['pg_restore','--data-only','--file=-',str(archive)],stdout=subprocess.PIPE,text=True,encoding='utf-8')
expected = []
current = None
for line in process.stdout:
    if current is None:
        if line.startswith('COPY public.') and line.rstrip().endswith('FROM stdin;'):
            current = {'copy':line.strip(),'count':0,'checksum':0}
    elif line.rstrip('\n') == '\\.':
        expected.append(current)
        current = None
    else:
        current['count'] += 1
        current['checksum'] += int(hashlib.sha256(line.encode()).hexdigest(),16)
if process.wait() != 0 or current is not None:
    raise RuntimeError('Snapshot COPY inspection failed')
report=[]
for item in expected:
    statement = item['copy'].replace(' FROM stdin;', ' TO STDOUT;')
    command = "SET extra_float_digits=3; SET DateStyle='ISO'; SET TimeZone='UTC'; " + statement
    process=subprocess.Popen(['runuser','-u','postgres','--','psql','-XqAt','-v','ON_ERROR_STOP=1','-d','dokitruyen','-c',command],stdout=subprocess.PIPE,text=True,encoding='utf-8')
    count=0
    checksum=0
    for line in process.stdout:
        count += 1
        checksum += int(hashlib.sha256(line.encode()).hexdigest(),16)
    if process.wait()!=0 or count!=item['count'] or checksum!=item['checksum']:
        raise RuntimeError('Archive comparison failed: '+item['copy'].split(' (')[0])
    table=item['copy'].split(' (')[0].removeprefix('COPY public.').strip('"')
    report.append({'table':table,'count':count,'checksum':str(checksum)})
    print('Verified archive rows:',table,count,flush=True)
if len(report) != int(query("SELECT count(*) FROM pg_tables WHERE schemaname='public'")):
    raise RuntimeError('Public table count differs from snapshot')
manifest={'snapshot':'neon-initial.dump','sourceTime':'2026-11-03T05:13:00Z','verifiedAgainst':'snapshot COPY rows','tables':report,'rows':sum(t['count'] for t in report)}
Path('/var/backups/dokitruyen/migration-verification.json').write_text(json.dumps(manifest,indent=2))
query('ANALYZE')
print('Snapshot verified:',len(report),'tables,',manifest['rows'],'rows',flush=True)
