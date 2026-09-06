#!/bin/sh
set -eu

mkdir -p /config

cat > /config/app-bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$S3_BUCKET"]
    }
  ]
}
EOF

cat > /config/cors.json <<'EOF'
[
  {
    "AllowedOrigins": ["https://petcare.localhost"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 300
  }
]
EOF

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"
mc version enable "local/$S3_BUCKET"
mc cors set "local/$S3_BUCKET" /config/cors.json

mc admin policy create local app-bucket-policy /config/app-bucket-policy.json

if mc admin user svcacct info local "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  mc admin user svcacct edit local "$S3_ACCESS_KEY_ID" \
    --secret-key "$S3_SECRET_ACCESS_KEY" \
    --policy /config/app-bucket-policy.json
else
  mc admin user svcacct add local "$MINIO_ROOT_USER" \
    --access-key "$S3_ACCESS_KEY_ID" \
    --secret-key "$S3_SECRET_ACCESS_KEY" \
    --policy /config/app-bucket-policy.json
fi

mc anonymous get "local/$S3_BUCKET" | grep -Eq '(private|none)'
