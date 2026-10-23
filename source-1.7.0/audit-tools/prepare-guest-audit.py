"""Host data-only input preparation. Never imports or runs product code."""
from pathlib import Path
import hashlib, json, os, stat, subprocess, re

ROOT=Path(__file__).resolve().parent.parent
EXPECTED=Path('E:/codex/2026-10-15/work/xjy-v16-deep-audit')
BASE=Path('E:/codex/2026-10-13/work/xjy-web-stage1/sandbox/input/package-v10')
OLD=BASE.parent/'guest-bootstrap-review-v11.ps1'
INPUT=ROOT/'sandbox/input'

def ordinary(p):
    for part in (p,*p.parents):
        if not part.exists(): continue
        s=part.lstat()
        if stat.S_ISLNK(s.st_mode) or os.path.isjunction(part) or getattr(s,'st_file_attributes',0)&0x400:
            raise RuntimeError('linked path refused: '+str(part))
        if stat.S_ISREG(s.st_mode) and s.st_nlink!=1: raise RuntimeError('hardlink refused')
    return p

def sha(b): return hashlib.sha256(b).hexdigest()
def write_new(p,b):
    ordinary(p);p.parent.mkdir(parents=True,exist_ok=True);ordinary(p.parent)
    with p.open('xb') as f:f.write(b)
    if p.read_bytes()!=b:raise RuntimeError('write mismatch')

def main():
    if ROOT!=EXPECTED:raise RuntimeError('fixed isolated root required')
    ordinary(ROOT);ordinary(BASE)
    if sha((BASE/'package-manifest.json').read_bytes())!='832328a00d26c4e905eb49a1ead21b9b9f1db677d4959cdbcbc8c6d5166dc8a8':raise RuntimeError('base manifest changed')
    INPUT.mkdir(parents=True,exist_ok=True)
    overlay=INPUT/'overlay-a2'
    if overlay.exists():raise RuntimeError('fresh overlay required')
    tracked=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    paths={p for p in tracked if p and p.split('/')[0] in {'project','stage1','tests','delivery-tools','delivery-installer','delivery-approval','audit-tools'}}
    for top in ['tests','audit-tools']:
        for p in (ROOT/top).rglob('*'):
            if p.is_file() and p.suffix in {'.cjs','.js','.py','.ts','.tsx','.json'} and not any(x in p.parts for x in ['generated','__pycache__','finance-guards-generated']):paths.add(p.relative_to(ROOT).as_posix())
    rows=[]
    for rel in sorted(paths):
        p=ordinary(ROOT/rel);b=p.read_bytes()
        if p.suffix.lower() in {'.db','.sqlite','.key','.pem'} or b.startswith(b'SQLite format 3') or re.search(rb'(?m)^-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]+',b):raise RuntimeError('non-code input refused')
        write_new(overlay/rel,b);rows.append({'path':rel,'size':len(b),'sha256':sha(b)})
    # Public TypeScript compiler files only. Dependency code is not executed here.
    ts=Path('E:/珠宝销售软件/node_modules/typescript');ordinary(ts)
    for p in sorted(ts.rglob('*')):
        ordinary(p)
        if not p.is_file():continue
        rel='audit-tools/dependencies/node_modules/typescript/'+p.relative_to(ts).as_posix();b=p.read_bytes()
        if p.suffix.lower() in {'.db','.sqlite','.key','.pem'} or p.name.startswith('.env'):raise RuntimeError('non-public dependency refused')
        write_new(overlay/rel,b);rows.append({'path':rel,'size':len(b),'sha256':sha(b)})
    baseline=[p for p in tracked if p.startswith('tests/') and p.endswith('.test.cjs')]
    b=(json.dumps(baseline,indent=2)+'\n').encode();rel='audit-tools/baseline-node-tests.json';write_new(overlay/rel,b);rows.append({'path':rel,'size':len(b),'sha256':sha(b)})
    manifest={'version':1,'purpose':'data-free V1.6 audit overlay','files':rows}
    mb=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode();write_new(overlay/'overlay-manifest.json',mb)
    marker=(BASE.parent/'synthetic-marker.json').read_bytes();write_new(INPUT/'synthetic-marker.json',marker)
    prefix=OLD.read_text('utf-8-sig').split(" $guestProof.stage='runtime-preflight'")[0]
    prefix=prefix.replace("$guestOutput='C:\\xjy-results\\desktop-review-v11'","$guestOutput='C:\\xjy-results\\bootstrap-a2'")
    prefix=prefix.replace("$guestPackage='C:\\xjy-input\\package-v10'","$guestPackage='C:\\xjy-base'")
    prefix=prefix.replace("Assert-GuestOrdinaryPath $guestPackage 'C:\\xjy-input'","Assert-GuestOrdinaryPath $guestPackage 'C:\\xjy-base'")
    prefix=prefix.replace("Assert-GuestOrdinaryPath $guestManifestFile 'C:\\xjy-input'","Assert-GuestOrdinaryPath $guestManifestFile 'C:\\xjy-base'")
    suffix=r'''
 $overlay='C:\xjy-input\overlay-a2'
 $overlayManifest=Join-Path $overlay 'overlay-manifest.json'
 Assert-GuestOrdinaryPath $overlayManifest 'C:\xjy-input'
 if((Get-FileHash -LiteralPath $overlayManifest -Algorithm SHA256).Hash.ToLowerInvariant() -cne '__OVERLAY_SHA__'){throw 'Audit overlay seal mismatch'}
 $overlayRows=(Get-Content -LiteralPath $overlayManifest -Raw -Encoding UTF8 | ConvertFrom-Json).files
 $seenOverlay=@{}
 foreach($row in $overlayRows){
  $rel=[string]$row.path
  if($rel -notmatch '^(project|stage1|tests|audit-tools|delivery-tools|delivery-installer|delivery-approval)/' -or $rel -match '[\\:\x00-\x1f]' -or ($rel.Split('/') | Where-Object {$_ -in @('','..','.')})){throw 'Overlay path rejected'}
  if($seenOverlay.ContainsKey($rel.ToLowerInvariant())){throw 'Duplicate overlay path'}
  $seenOverlay[$rel.ToLowerInvariant()]=$true
  $src=Join-Path $overlay $rel.Replace('/','\');Assert-GuestOrdinaryPath $src $overlay
  if((Get-Item -LiteralPath $src).Length -ne $row.size -or (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLowerInvariant() -cne $row.sha256){throw 'Overlay input mismatch'}
 }
 foreach($row in $overlayRows){
  $rel=[string]$row.path;$dst=Join-Path $guestWork $rel.Replace('/','\')
  [void](New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force)
  Assert-GuestOrdinaryPath (Split-Path -Parent $dst) $guestWork
  if(Test-Path -LiteralPath $dst){Assert-GuestOrdinaryPath $dst $guestWork}
  Copy-Item -LiteralPath (Join-Path $overlay $rel.Replace('/','\')) -Destination $dst -Force
  Assert-GuestOrdinaryPath $dst $guestWork
  if((Get-Item -LiteralPath $dst).Length -ne $row.size -or (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash.ToLowerInvariant() -cne $row.sha256){throw 'Overlay copy mismatch'}
 }
 $guestProof.overlayFiles=$overlayRows.Count;$guestProof.overlaySha256='__OVERLAY_SHA__'
 $guestProof.stage='runtime-preflight'
 Set-Location -LiteralPath $guestWork
 $preflight=Invoke-GuestCapturedProcess 'guest-preflight' (Join-Path $guestPython 'python.exe') '-I -B -X utf8 stage1\run-restricted.py --sandbox-guest --check-only' 60000
 $guestProof.preflightProcess=$preflight
 if($preflight.captureError -or $preflight.timedOut -or $preflight.exitCode -ne 0){throw 'Actual Sandbox runtime preflight failed'}
 $guestProof.passed=$true;$guestProof.stage='ready-for-audit'
}catch{$guestProof.error=$_.Exception.Message;$guestProof.scriptStack=$_.ScriptStackTrace}
finally{
 if($guestOutputAdmitted){$guestProof.finishedAt=[DateTime]::UtcNow.ToString('o');Write-GuestFreshJson (Join-Path $guestOutput 'guest-bootstrap-result.json') $guestProof}
}
'''.replace('__OVERLAY_SHA__',sha(mb))
    script=prefix+suffix;write_new(INPUT/'guest-audit-bootstrap-a2.ps1',b'\xef\xbb\xbf'+script.encode('utf-8'))
    output=ROOT/'sandbox/results';(output/'bootstrap-a2').mkdir(parents=True,exist_ok=False)
    command="powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\xjy-input\\guest-audit-bootstrap-a2.ps1"
    xml=f'''<Configuration><VGpu>Disable</VGpu><Networking>Disable</Networking><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><ProtectedClient>Enable</ProtectedClient><MemoryInMB>8192</MemoryInMB><MappedFolders><MappedFolder><HostFolder>{BASE}</HostFolder><SandboxFolder>C:\\xjy-base</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder><MappedFolder><HostFolder>{INPUT}</HostFolder><SandboxFolder>C:\\xjy-input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder><MappedFolder><HostFolder>{output}</HostFolder><SandboxFolder>C:\\xjy-results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder></MappedFolders><LogonCommand><Command>{command}</Command></LogonCommand></Configuration>'''
    write_new(ROOT/'sandbox/audit-a2.wsb',xml.encode('utf-8'))
    print(json.dumps({'overlayFiles':len(rows),'baselineNodeFiles':len(baseline),'overlaySha256':sha(mb),'config':str(ROOT/'sandbox/audit-a2.wsb')}))

if __name__=='__main__':main()
