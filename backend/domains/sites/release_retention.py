"""Retain the activated remote website and its predecessor under the publish lock."""
from __future__ import annotations

import json

from .models import SiteConfig, SiteTarget
from .storage import SiteStore, private_json


def begin_upload_program() -> str:
    """Protect an in-flight upload, with $id and the owned private root $p set."""
    return 'gnosi_write($p,"pending-releases/".$id,"uploading");'


def retention_program(*, pangea: bool = False) -> str:
    """Run only after verified activation with $id/$current and the lock held.

    Plan the complete deletion before touching obsolete trees. Pending uploads,
    unknown/incomplete artifacts and private service state are never removed.
    A cleanup error becomes a publication warning because activation succeeded.
    """
    return '$legacyRetention=' + json.dumps(pangea) + ';' + _PHP


def record_result(store: SiteStore, site: SiteConfig, target: SiteTarget, response: str | bytes) -> None:
    """Persist the acknowledged post-activation cleanup outcome for the job."""
    from .private_service import service_root
    result = json.loads(response)
    private_json(service_root(store, site.id, target.id) / "release-retention.json",
                 {"error": result.get("retention_error")})


_PHP = r'''
$retentionError=null;
try {
    $verify=$legacyRetention?"gnosi_pangea_verify":"gnosi_manifest";
    $verify($id);
    if($current!==null&&$current!==$id){$verify($current);}
    foreach(array_unique([$id,$current]) as $published){
        if($published===null){continue;}
        $pending=gnosi_file($p,"pending-releases/".$published);
        if(is_file($pending)&&!unlink($pending)){throw new Exception("Upload receipt could not be completed");}
    }
    $releases=gnosi_directory($r."/releases");$remove=[];$manifests=[];
    foreach(scandir($releases) as $name){
        if($name==="."||$name===".."||$name===$id||$name===$current){continue;}
        gnosi_id($name);
        $release=gnosi_release($name);
        $pending=gnosi_file($p,"pending-releases/".$name);
        if(is_file($pending)){continue;}
        $manifest=$legacyRetention?gnosi_file($release,"checksums.json"):gnosi_file($p,"manifests/".$name.".json");
        if(!is_file($manifest)){continue;}
        $verify($name);
        if($legacyRetention){
            $entries=array_values(array_diff(scandir($release),[".",".."]));sort($entries);
            if($entries!==["checksums.json","public"]){throw new Exception("Unknown retained release data");}
        }else{$manifests[]=$manifest;}
        $tree=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($release,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
        foreach($tree as $entry){
            $path=$entry->getPathname();
            if($entry->isLink()){throw new Exception("Unowned retained release entry");}
            if($entry->isDir()){
                if(gnosi_directory($path)!==$path){throw new Exception("Retained directory escaped namespace");}
                $remove[]=[$path,true];
            }else{gnosi_file(dirname($path),basename($path));$remove[]=[$path,false];}
        }
        $remove[]=[$release,true];
    }
    foreach($remove as [$path,$directory]){
        if($directory?!rmdir($path):!unlink($path)){throw new Exception("Old release cleanup failed");}
    }
    foreach($manifests as $manifest){if(!unlink($manifest)){throw new Exception("Old manifest cleanup failed");}}
}catch(Throwable $error){$retentionError="release_retention_pending";}
'''
