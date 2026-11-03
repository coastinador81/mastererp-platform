import argparse,pathlib,zipfile
def package(d):
 f=pathlib.Path(__file__).parent;m=f.parents[1];s=f.parents[4]/'shared/tenant-security/tenant_security';files={'handler.py':f/'handler.py'}
 for x in sorted((m/'brands_api').glob('*.py')):files[f'brands_api/{x.name}']=x
 for n in('__init__.py','auth.py','db.py','http.py','rds-us-west-1-bundle.pem'):files[f'tenant_security/{n}']=s/n
 with zipfile.ZipFile(d,'w')as z:
  for n,x in sorted(files.items()):i=zipfile.ZipInfo(n,date_time=(2020,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,x.read_bytes())
if __name__=='__main__':p=argparse.ArgumentParser();p.add_argument('destination',type=pathlib.Path);a=p.parse_args();package(a.destination)
