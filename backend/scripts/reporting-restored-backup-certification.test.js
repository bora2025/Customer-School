'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const{configuration}=require('./reporting-restored-backup-certification');
const valid={EXISTING_SCHOOL_REHEARSAL_ALLOW:'reporting-only',SOURCE_DATABASE_URL:'postgresql://user:pass@localhost/source_school',REHEARSAL_DATABASE_URL:'postgresql://user:pass@localhost/restored_school',BACKUP_DIR:path.resolve(__dirname,'.reporting-cert-fixture'),REHEARSAL_SCHOOL_SLUG:'restored-reporting-school'};
test('requires exact Reporting guard',()=>assert.throws(()=>configuration({...valid,EXISTING_SCHOOL_REHEARSAL_ALLOW:'yes'}),/reporting-only/));
test('requires distinct PostgreSQL databases and safe target',()=>{assert.throws(()=>configuration({...valid,REHEARSAL_DATABASE_URL:valid.SOURCE_DATABASE_URL}),/distinct/);assert.throws(()=>configuration({...valid,REHEARSAL_DATABASE_URL:'postgresql://user:pass@localhost/unsafe-name'}),/unsafe/);});
test('returns bounded non-secret coordinates',()=>assert.deepEqual(Object.keys(configuration(valid)).sort(),['backupDir','slug','sourceUrl','targetDatabase','targetUrl']));
