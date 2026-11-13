from pathlib import Path
import tarfile,time,os,shutil,hashlib
r=Path.cwd();link=r/'node_modules/@oxy.so/bloom-editor';backup=link.with_name('bloom-editor-published-434');target=r/'bloom-editor-local/node_modules/@oxy.so/bloom-editor'
archive=Path('/tmp/bloom-editor-434-pack/oxy.so-bloom-editor-0.7.2.tgz')
stage=target.with_name('editor-stage-'+str(time.time_ns()));stage.mkdir(parents=True)
with tarfile.open(archive) as tar:
 for member in tar.getmembers():
  if not member.name.startswith('package/'):continue
  member.name=member.name[len('package/'):]
  if member.name:tar.extract(member,stage,filter='data')
assert 'controller.ownsControlFocus' in (stage/'lib/module/react/TextBlock.js').read_text()
if link.is_symlink():
 assert backup.exists()
 link.unlink();backup.rename(link)
old=Path('/home/nate/.cache/oxy-editor-candidate-snapshots')/str(time.time_ns());old.parent.mkdir(parents=True,exist_ok=True)
if target.exists():shutil.move(str(target),old)
stage.rename(target);link.rename(backup);link.symlink_to(os.path.relpath(target,link.parent))
print('Packed candidate SHA256',hashlib.sha256(archive.read_bytes()).hexdigest())
