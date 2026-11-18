import os
from pathlib import Path
from uuid import uuid4

import boto3

ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_BYTES = 5 * 1024 * 1024


class ProductMedia:
    def __init__(self, tenant_id: str):
        self.tenant_id = tenant_id
        self.bucket = os.environ["CATALOG_MEDIA_BUCKET"]
        self.public_base = os.environ["CATALOG_MEDIA_PUBLIC_BASE"].rstrip("/")
        self.s3 = boto3.client("s3")

    def upload_request(self, product_id: str, payload: dict) -> dict:
        content_type = payload.get("content_type")
        size = payload.get("size")
        if content_type not in ALLOWED_TYPES or not isinstance(size, int) or not 1 <= size <= MAX_BYTES:
            raise ValueError("Invalid image")
        image_id = str(uuid4())
        key = f"catalog-media/{self.tenant_id}/{product_id}/{image_id}{ALLOWED_TYPES[content_type]}"
        upload = self.s3.generate_presigned_post(
            Bucket=self.bucket, Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}, ["content-length-range", 1, MAX_BYTES]],
            ExpiresIn=300,
        )
        name = Path(str(payload.get("filename") or "imagen")).name[:200]
        return {"id": image_id, "name": name, "key": key, "url": f"{self.public_base}/{key}", "content_type": content_type, "upload": upload}
