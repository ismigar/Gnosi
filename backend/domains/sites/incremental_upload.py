"""Stream candidate hashes and reuse verified remote release bytes."""
from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path


def output_manifest(output: Path) -> dict[str, str]:
    """Reject aliases and special files before opening any candidate payload."""
    if output.is_symlink() or not output.is_dir():
        raise ValueError("Invalid release output directory")
    manifest = {}
    for directory, dirs, files in os.walk(output, followlinks=False):
        for name in dirs + files:
            path = Path(directory) / name
            relative = path.relative_to(output).as_posix()
            if "\\" in relative or "\0" in relative:
                raise ValueError("Invalid release filename")
            metadata = path.lstat()
            if stat.S_ISDIR(metadata.st_mode):
                continue
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise ValueError("Release output contains an aliased or nonregular file")
            with path.open("rb") as stream:
                opened = os.fstat(stream.fileno())
                if (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino):
                    raise ValueError("Release output changed during hashing")
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            manifest[relative] = digest
    return dict(sorted(manifest.items()))


def reuse_program(*, pangea: bool = False, manifest_expression: str | None = None) -> str:
    """Copy matching candidate entries under the existing publication lock.

    Both transports retain a complete independent tree. Only the Pangea layout
    and manifest input differ; canonical path and byte-copy checks are shared.
    """
    expression = manifest_expression or 'json_decode(file_get_contents("php://stdin"),true,64,JSON_THROW_ON_ERROR)'
    code = '$manifest=' + expression + ';'
    if pangea:
        code += '$parentRoot=$parent===null?null:gnosi_pangea_verify($parent);$parentManifest=$parent===null?[]:json_decode(file_get_contents(gnosi_file(gnosi_release($parent),"checksums.json")),true,512,JSON_THROW_ON_ERROR);$release=gnosi_release($id)."/public";gnosi_directory($release,true);'
    else:
        code += '$parentManifest=$parent===null?[]:gnosi_manifest($parent);$parentRoot=$parent===null?null:gnosi_release($parent);$release=gnosi_release($id);'
    current = 'gnosi_pangea_current()' if pangea else 'gnosi_current()'
    return code + _COPY + 'if(' + current + '!==$parent){throw new Exception("Parent changed during release copy");}echo json_encode($missing,JSON_THROW_ON_ERROR);'


_COPY = r'''
    if(!is_array($manifest)||!$manifest){throw new Exception("Invalid release manifest");}
    $missing=[];
    foreach($manifest as $relative=>$digest){
        if(!is_string($digest)||!preg_match("~^[a-f0-9]{64}$~D",$digest)){throw new Exception("Invalid release digest");}
        $destination=gnosi_file($release,$relative,true);
        if(!array_key_exists($relative,$parentManifest)||$parentManifest[$relative]!==$digest){$missing[]=$relative;continue;}
        $source=gnosi_file($parentRoot,$relative);
        if(!is_file($source)||hash_file("sha256",$source)!==$digest){throw new Exception("Parent release integrity failure");}
        $temporary=tempnam(dirname($destination),".gnosi-copy-");
        if($temporary===false){throw new Exception("Could not create release copy");}
        try{
            if(!copy($source,$temporary)||!chmod($temporary,0644)||hash_file("sha256",$temporary)!==$digest){throw new Exception("Release copy integrity failure");}
            gnosi_file($parentRoot,$relative);
            gnosi_file($release,$relative);
            if(!rename($temporary,$destination)){throw new Exception("Could not install release copy");}
        }finally{if(file_exists($temporary)&&!unlink($temporary)){throw new Exception("Could not remove release copy");}}
    }
    '''
