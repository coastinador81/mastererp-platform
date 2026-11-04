"""Deterministic existing Uonify Lambda package; pure Python dependency baseline only."""
import argparse,base64,hashlib,json,zipfile,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--baseline-sha',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    raw=a.baseline.read_bytes();assert base64.b64encode(hashlib.sha256(raw).digest()).decode()==a.baseline_sha
    allowed={'pg8000','scramp','asn1crypto','dateutil','six.py'};metadata=('pg8000-','scramp-','asn1crypto-','python_dateutil-','six-');files={}
    with zipfile.ZipFile(a.baseline) as z:
        for name in z.namelist():
            if (name.split('/')[0] in allowed or (name.split('/')[0].endswith('.dist-info') and name.split('/')[0].startswith(metadata))) and not name.endswith('/') and '__pycache__' not in name and not name.endswith('.pyc'):
                assert '..' not in Path(name).parts and not name.endswith(('.so','.pyd','.dll'))
                files[name]=z.read(name)
    assert any(n.startswith('pg8000/') for n in files)
    shared=ROOT/'backend/shared/tenant-security/tenant_security'
    for name in ['__init__.py','identity_access.py','foundation_access.py','rds-us-west-1-bundle.pem']:
        files['tenant_security/'+name]=(shared/name).read_bytes()
    files['handler.py']=(ROOT/'backend/modules/0-uonify/lambdas/uonify-google-connection-handler/handler.py').read_bytes()
    a.output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(a.output,'w') as z:
        for name,data in sorted(files.items()):
            if name.endswith('.py'):data=data.replace(b'\r\n',b'\n');compile(data,name,'exec')
            assert '.env' not in name
            info=zipfile.ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,data)
    probe="import sys;sys.path="+repr([str(a.output.resolve())])+"+[p for p in sys.path if 'site-packages' not in p];import pg8000.native,handler"
    subprocess.run([sys.executable,'-I','-c',probe],check=True,capture_output=True)
    print(json.dumps({'files':len(files),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'baseline':a.baseline_sha}))
if __name__=='__main__':main()
