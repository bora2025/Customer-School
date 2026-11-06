# Encrypted off-site backups

The worker writes a recovery set (database dump + plugin code + plugin data + journal) to its own
volume every night at 02:00. A copy that lives only on that volume is lost with the volume or the
hosting project, so each set is also uploaded to an S3-compatible bucket, encrypted client-side
with AES-256-GCM. The bucket never holds readable school data.

## Configure (api and worker)

| Variable | Value |
|---|---|
| `BACKUP_OFFSITE_S3_BUCKET` | Bucket name. Setting it turns the feature on. |
| `BACKUP_OFFSITE_S3_REGION` | e.g. `auto` (R2) or the provider's region |
| `BACKUP_OFFSITE_S3_ENDPOINT` | HTTPS endpoint for non-AWS providers |
| `BACKUP_OFFSITE_S3_ACCESS_KEY_ID` / `..._SECRET_ACCESS_KEY` | Credentials limited to that bucket |
| `BACKUP_OFFSITE_S3_PREFIX` | Optional, default `school-backups` |
| `BACKUP_OFFSITE_RETENTION_DAYS` | Optional, default `35`. The newest set is never pruned. |
| `BACKUP_ENCRYPTION_KEY` | 32 random bytes, base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

Use a bucket at a **different provider** from the school host: a bucket inside the same hosting
project dies with the project. Invalid configuration fails at boot.

**Store `BACKUP_ENCRYPTION_KEY` outside the hosting provider too**, for example in a password
manager. Without it, the off-site copies cannot be decrypted.

## Monitor

The API exposes `offsite_backup_configured` and `offsite_backup_age_seconds` on `/metrics`
(bearer `METRICS_TOKEN`). They are read from the bucket, so the API reports the worker's
backups correctly. The `Backup freshness` workflow fails when no set is younger than 26 hours.
It needs repository variable `SCHOOL_GATEWAY_URL` and secret `SCHOOL_METRICS_TOKEN`.

A successful upload logs a warning line, `Off-site backup uploaded: <set> ...`, and a failure
logs an error, `Off-site backup upload failed: ...`. The local backup is unaffected by an
off-site failure.

## Restore from off-site

```sh
# with the BACKUP_OFFSITE_* variables and BACKUP_ENCRYPTION_KEY set:
node scripts/fetch-offsite-backup.js --out /restore/offsite            # newest set
node scripts/fetch-offsite-backup.js --out /restore/offsite --set <id> # a specific set
node scripts/restore-recovery-set.js --from /restore/offsite/<journalFile> ...
```

`fetch-offsite-backup.js` verifies the GCM authentication tag and each file's SHA-256 before
writing anything. A wrong key, a corrupted object or a missing object stops the restore.
