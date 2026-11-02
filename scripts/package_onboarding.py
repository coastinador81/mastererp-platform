"""Reproducible application overlay on the verified deployed Linux dependency ZIP.

No credentials or business code are copied from the baseline. Public Cognito JWKS
are fetched at packaging; refresh this artefact on key rotation (unknown kid denies).
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile
ROOT=Path(__file__).resolve().parents[1]
BASELINE_SHA="x+gtWZli7bgxQQFIm/atMT2OCw4DPwhhOqNDvZpjiO4="
ISSUER="https://cognito-idp.us-west-1.amazonaws.com/us-west-1_oCn3VipDO"

def package(destination, baseline):
    raw=baseline.read_bytes()
    if base64.b64encode(hashlib.sha256(raw).digest()).decode()!=BASELINE_SHA:
        raise ValueError("Unreviewed dependency baseline")
    allowed={"jwt","cryptography","cryptography.libs","cffi","pycparser","psycopg","psycopg_binary","psycopg_binary.libs","typing_extensions.py"}
    sources={}
    with zipfile.ZipFile(baseline) as z:
        for name in z.namelist():
            top=name.split("/")[0]
            if name.endswith("/") or "__pycache__" in name or name.endswith(".pyc"):
                continue
            if top in allowed or (top.startswith("_cffi_backend.") and top.endswith(".so")):
                if ".." in Path(name).parts or name.endswith((".pyd",".dll")):
                    raise ValueError("Non-Linux dependency")
                sources[name]=z.read(name)
    shared=ROOT/"backend/shared/tenant-security/tenant_security"
    for name in ("__init__.py","auth.py","db.py","http.py","foundation_access.py","rds-us-west-1-bundle.pem"):
        sources["tenant_security/"+name]=(shared/name).read_bytes()
    module=ROOT/"backend/modules/1.0-platform-base/1.1-tenant-onboarding"
    for source in (module/"tenant_onboarding").rglob("*.py"):
        sources[source.relative_to(module).as_posix()]=source.read_bytes()
    for name in ("onboarding-session-manager","onboarding-progress-tracker","onboarding-provisioner"):
        path="lambdas/"+name+"/handler.py"
        sources[path]=(module/path).read_bytes()
    with urllib.request.urlopen(ISSUER+"/.well-known/jwks.json",timeout=20) as response:
        keys=json.load(response)
    if not keys.get("keys") or any(k.get("kty")!="RSA" or k.get("use")!="sig" for k in keys["keys"]):
        raise ValueError("Invalid Cognito public signing keys")
    sources["tenant_security/cognito-jwks.json"]=json.dumps(keys,sort_keys=True).encode()
    with zipfile.ZipFile(destination,"w") as archive:
        for name,data in sorted(sources.items()):
            item=zipfile.ZipInfo(name,date_time=(2020,1,1,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED
            item.create_system=3;item.external_attr=0o100644<<16;archive.writestr(item,data)
    print(json.dumps({"sha256":hashlib.sha256(destination.read_bytes()).hexdigest(),"files":len(sources),"dependency_baseline":BASELINE_SHA}))

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination",type=Path);parser.add_argument("--dependency-zip",type=Path,required=True)
    args=parser.parse_args();package(args.destination,args.dependency_zip)
