# File Storage

What file storage is for, why it isn't wired yet, and the locked-in path
to add it without rewriting anything.

## Current state

**Not wired.** The template has zero `MEDIA_ROOT`, zero `DEFAULT_FILE_STORAGE`,
zero models with `FileField` / `ImageField`. There are no avatars, no
uploads, no exports.

This is deliberate — adding storage without a real use case means picking
a vendor before knowing the requirements. We've locked in the *design*
(env-driven, `django-storages`-based, S3-compatible) so wiring it later
is a settings change, not a rewrite.

## What you get when you wire it

| Capability | Example |
|---|---|
| User avatars | Real images, not just DiceBear-generated SVGs |
| File uploads | Notes with attachments, profile docs |
| Generated exports | CSV/PDF downloads users request |
| Static asset overflow | If WhiteNoise can't keep up at scale |

## The design: provider-agnostic via `django-storages`

`django-storages` is the standard pluggable backend for Django file
storage. One interface, many providers:

```
Django code:                request.user.avatar.save(...)
                                       ↓
DEFAULT_FILE_STORAGE = "storages.backends.s3.S3Storage"
                                       ↓
S3-compatible HTTP API:     Cloudflare R2 / AWS S3 / Backblaze B2 / MinIO

# OR, by changing one setting:
DEFAULT_FILE_STORAGE = "storages.backends.gcloud.GoogleCloudStorage"
                                       ↓
GCS HTTP API:               Google Cloud Storage
```

`request.user.avatar.save(...)` is identical regardless of provider. The
bytes land in a different bucket. That's the whole win.

## Recommended free-tier path: Cloudflare R2

Pick R2 for first wiring. Reasons:

| Feature | R2 | Why it matters |
|---|---|---|
| Storage tier | **10 GB free forever** | Hobby app will never exceed |
| Egress | **$0 forever** | The classic AWS gotcha doesn't apply |
| API | S3-compatible | `django-storages[s3]` works as-is |
| Setup | ~5 min (account + bucket + key) | No DNS, no DKIM, no IAM policy maze |
| Custom domain / CDN | Built-in via Cloudflare DNS | When you want `cdn.yourdomain.com` |

Alternatives if R2 doesn't fit:

| Provider | Free tier | When to consider |
|---|---|---|
| Backblaze B2 | 10 GB + 1 GB/day egress free | If R2 ever changes terms |
| AWS S3 | 5 GB for first year only | Already in AWS ecosystem |
| MinIO self-hosted | Free on your VPS | Air-gapped or full control |
| Render Disk | $0.25/GB/mo — *not free* | Quick prototype, but vendor lock |

## How to wire R2 (when you're ready)

About 2 hours of work. Steps:

### 1. Add the dep

```toml
# pyproject.toml
"django-storages[s3]>=1.14",
```

### 2. Create the R2 bucket + API token

1. [Cloudflare dashboard](https://dash.cloudflare.com) → R2 → Create bucket
2. Name it (e.g. `react-django-template-uploads`)
3. R2 → Manage R2 API Tokens → Create API token
4. Permission: **Object Read & Write** for the bucket
5. Copy the Access Key ID + Secret Access Key

### 3. Update settings

```python
# backend/config/settings/prod.py (and dev.py if you want real storage locally)

STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": env("S3_BUCKET_NAME"),
            "endpoint_url": env("S3_ENDPOINT_URL"),     # R2 endpoint
            "access_key": env("S3_ACCESS_KEY"),
            "secret_key": env("S3_SECRET_KEY"),
            "region_name": env("S3_REGION", default="auto"),
            # R2 uses "auto"; AWS uses "us-east-1" etc.
            "custom_domain": env("S3_CUSTOM_DOMAIN", default=None),
            "file_overwrite": False,
            "default_acl": None,        # R2 doesn't do ACLs
        },
    },
    "staticfiles": {
        # Keep WhiteNoise for static files — different concern.
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
```

### 4. Set env vars in Render dashboard (or your `.env`)

```
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET_NAME=react-django-template-uploads
S3_ACCESS_KEY=<from dashboard>
S3_SECRET_KEY=<from dashboard>
S3_CUSTOM_DOMAIN=cdn.yourdomain.com   # optional, when you set up a custom domain
```

R2's endpoint URL format: `https://<account-id>.r2.cloudflarestorage.com`.
Find your account ID in the R2 dashboard sidebar.

### 5. Add a model field that uses it

```python
# apps/users/models.py — example
class User(AbstractUser):
    ...
    avatar = models.ImageField(upload_to="avatars/", blank=True)

# Run: make mm && make migrate
```

Done. Uploads land in the R2 bucket. URLs returned by `user.avatar.url`
point at `S3_CUSTOM_DOMAIN` (or the bucket's R2 URL).

## Migrating R2 → GCS later

When you decide to run on GCP and want to consolidate storage:

### 1. Swap the dep

```toml
"django-storages[google]>=1.14",
```

### 2. Swap the backend

```python
STORAGES = {
    "default": {
        "BACKEND": "storages.backends.gcloud.GoogleCloudStorage",
        "OPTIONS": {
            "bucket_name": env("GCS_BUCKET_NAME"),
            "project_id": env("GCS_PROJECT_ID"),
            # Auth: GOOGLE_APPLICATION_CREDENTIALS env, or service-account JSON
        },
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
```

### 3. Migrate the bytes

Use `gsutil cp` or `rclone` to copy the bucket contents (R2 supports
both via its S3-compatible API). One-time operation.

### 4. Update env vars

```
GCS_BUCKET_NAME=...
GCS_PROJECT_ID=...
# Remove S3_* env vars
```

**Code stays unchanged.** Same `ImageField`, same `user.avatar.url`,
same Django API. URLs in templates etc. resolve through the new backend.

## Cost calibration

| Scale | R2 cost/mo | GCS cost/mo |
|---|---|---|
| Hobby (< 10 GB stored, modest egress) | **$0** | ~$0.20 (5 GB after free year) |
| 100 GB stored + 50 GB egress | $1.50 | $4.50 + $6 egress = $10.50 |
| 1 TB stored + 500 GB egress | $15 | $20 + $60 egress = $80 |
| 10 TB stored + 5 TB egress | $150 | $200 + $600 egress = $800 |

R2's zero-egress pricing is the moat — at any meaningful scale, it stays
cheaper than GCS or S3 for data that actually gets served to users.

## Footguns

| Issue | Cause | Fix |
|---|---|---|
| Uploads succeed but URLs 403 | R2 bucket isn't publicly accessible | Either make the bucket public, or use Cloudflare Workers + custom domain to serve |
| Old uploads disappear on rename | `file_overwrite=True` (the default in older django-storages) | We set `False` — keeps unique filenames |
| Big files time out | Default chunk size / no multipart | Set `AWS_S3_MAX_MEMORY_SIZE` to push larger uploads to multipart |
| `region_name` errors on R2 | Tried to use AWS region | R2 uses `"auto"` |
| Local dev needs storage too | dev.py still uses default filesystem | Either configure R2 in dev with a separate bucket, or use `django-minio-storage` for an in-network S3 |

## When to actually wire it

Triggers:
- A user-facing feature that uploads files (avatars, attachments, etc.)
- A backend job that writes generated files (exports, PDFs)
- Migrating from DB-stored binary data to file storage

Until one of those, the design is locked in but no code change is needed.

## See also

- [django-storages docs](https://django-storages.readthedocs.io/)
- [Cloudflare R2 docs](https://developers.cloudflare.com/r2/)
- [ops/deploy-render.md](deploy-render.md) — how Render env vars work
