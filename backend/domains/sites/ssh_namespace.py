"""One filesystem policy for every SSH release operation.

The generated PHP runs on the administrator-selected server. All production
callers pass the scoped owner; the optional owner supports isolated tests of the
pointer primitive without constructing a configured site.
"""
from __future__ import annotations

import json


def program(root: str, private_root: str, owner: str | None, document_root: str = "") -> str:
    return ("$r=" + json.dumps(root) + ";$p=" + json.dumps(private_root)
            + ";$owner=" + json.dumps(owner) + ";$documentRoot=" + json.dumps(document_root) + ";" + _PHP)


def worker_start_program() -> str:
    """Run after the transport namespace guard with its owned service root in $p.

    $owner is either the scoped JSON owner or None when the transport has already
    verified its own equivalent ownership marker. No shell receives these paths.
    """
    return r'''
    $config=gnosi_service_config();$daemon=gnosi_service_script("daemon.php");
    umask(0077);$logPath=gnosi_file($p,"worker.log");$log=fopen($logPath,"ab");
    if($log===false){throw new Exception("Worker log unavailable");}
    clearstatcache(true,$logPath);$handleStat=fstat($log);$pathStat=lstat($logPath);
    if(is_link($logPath)||$handleStat===false||$pathStat===false||$handleStat["dev"]!==$pathStat["dev"]||$handleStat["ino"]!==$pathStat["ino"]||$handleStat["nlink"]!==1){throw new Exception("Worker log ownership changed");}
    if(!putenv("GNOSI_SITES_SERVICE_CONFIG=".$config)){throw new Exception("Worker configuration unavailable");}
    $process=proc_open(["nohup",PHP_BINARY,$daemon],[0=>["file","/dev/null","r"],1=>$log,2=>$log],$pipes);
    if(!is_resource($process)){throw new Exception("Worker startup failed");}
    if(!fclose($log)){throw new Exception("Worker log could not be closed");}
    echo json_encode(["started"=>true]);
    '''


_PHP = r'''
set_error_handler(function($errno,$errstr){throw new ErrorException($errstr,0,$errno);});
function gnosi_exists($path){return file_exists($path)||is_link($path);}
function gnosi_directory($path,$create=false,$mode=0755){
    if(is_link($path)||gnosi_exists($path)&&!is_dir($path)){throw new Exception("Unowned directory: ".$path);}
    if(!is_dir($path)){
        if(!$create){throw new Exception("Missing owned directory: ".$path);}
        gnosi_directory(dirname($path),true,$mode);
        if(!mkdir($path,$mode)){throw new Exception("Could not create owned directory");}
    }
    $canonical=realpath($path);
    if($canonical===false){throw new Exception("Could not resolve owned directory");}
    return $canonical;
}
function gnosi_file($base,$relative,$parents=false){
    if(!is_string($relative)||$relative===""||str_contains($relative,"\\")||str_contains($relative,"\0")){throw new Exception("Invalid owned filename");}
    $parts=explode("/",$relative);
    foreach($parts as $part){if($part===""||$part==="."||$part===".."){throw new Exception("Invalid owned filename");}}
    $directory=gnosi_directory($base);
    $name=array_pop($parts);
    foreach($parts as $part){
        $expected=$directory."/".$part;
        if(gnosi_directory($expected,$parents)!==$expected){throw new Exception("File parent escaped the owned directory");}
        $directory=$expected;
    }
    $path=$directory."/".$name;
    if(is_link($path)||gnosi_exists($path)&&!is_file($path)){throw new Exception("Unowned file: ".$path);}
    if(is_file($path)&&realpath($path)!==$path){throw new Exception("File escaped the owned directory");}
    if(is_file($path)&&lstat($path)["nlink"]!==1){throw new Exception("File has an unowned hard-link alias");}
    return $path;
}
function gnosi_write($base,$relative,$data,$mode=0600){
    $path=gnosi_file($base,$relative,true);
    $temporary=tempnam(dirname($path),".gnosi-write-");
    if($temporary===false){throw new Exception("Could not create owned temporary file");}
    try{
        if(file_put_contents($temporary,$data)!==strlen($data)||!chmod($temporary,$mode)){throw new Exception("Could not write owned file");}
        gnosi_file($base,$relative);
        if(!rename($temporary,$path)){throw new Exception("Could not replace owned file");}
    }finally{if(file_exists($temporary)&&!unlink($temporary)){throw new Exception("Could not remove owned temporary file");}}
}
function gnosi_namespace($provision=false){
    global $r,$p,$owner,$documentRoot;
    clearstatcache(true);
    // Check both existing namespaces before creating or writing either one.
    foreach([$r,$p] as $directory){
        if(is_link($directory)||gnosi_exists($directory)&&!is_dir($directory)){throw new Exception("Unowned namespace");}
        if(is_dir($directory)&&$owner!==null){
            $marker=gnosi_file($directory,".gnosi-sites-owner");
            if(!is_file($marker)||file_get_contents($marker)!==$owner){throw new Exception("Namespace ownership mismatch");}
        }
    }
    foreach([[$r,0755],[$p,0700]] as [$directory,$mode]){
        $new=!is_dir($directory);
        gnosi_directory($directory,$provision,$mode);
        if($new&&$owner!==null){gnosi_write($directory,".gnosi-sites-owner",$owner);}
    }
    $r=gnosi_directory($r);$p=gnosi_directory($p);
    if($documentRoot!==""){
        $doc=gnosi_directory($documentRoot);
        if(!str_starts_with($r,$doc."/")||$p===$doc||str_starts_with($p,$doc."/")){throw new Exception("Namespace escaped its configured boundary");}
    }
    foreach([[$r,"releases",0755],[$p,"manifests",0700]] as [$base,$name,$mode]){
        $path=$base."/".$name;
        if($provision||gnosi_exists($path)){
            if(gnosi_directory($path,$provision,$mode)!==$path){throw new Exception("Unowned release namespace");}
        }
    }
}
function gnosi_id($id){
    if(!is_string($id)||!preg_match("~^[a-zA-Z0-9_-]{1,100}$~D",$id)){throw new Exception("Unknown release identity");}
}
function gnosi_release($id){
    global $r;
    gnosi_id($id);
    $expected=$r."/releases/".$id;
    if(gnosi_directory($r."/releases")!==$r."/releases"||gnosi_directory($expected)!==$expected){throw new Exception("Unowned release directory");}
    return $expected;
}
function gnosi_current(){
    global $r;
    $link=$r."/current";
    if(!gnosi_exists($link)){return null;}
    if(!is_link($link)||!preg_match("~^releases/([a-zA-Z0-9_-]{1,100})$~D",readlink($link),$match)){throw new Exception("Unknown active pointer");}
    if(realpath($link)!==gnosi_release($match[1])){throw new Exception("Active pointer escaped the owned release tree");}
    return $match[1];
}
function gnosi_manifest($id){
    global $p;
    gnosi_id($id);
    $file=gnosi_file($p,"manifests/".$id.".json");
    $manifest=json_decode(file_get_contents($file),true,64,JSON_THROW_ON_ERROR);
    gnosi_verify($id,$manifest);
    return $manifest;
}
function gnosi_verify($id,$manifest){
    $release=gnosi_release($id);
    if(!is_array($manifest)||!$manifest){throw new Exception("Invalid release manifest");}
    foreach($manifest as $relative=>$digest){
        if(!is_string($digest)||!preg_match("~^[a-f0-9]{64}$~D",$digest)){throw new Exception("Invalid release digest");}
        $file=gnosi_file($release,$relative);
        if(!is_file($file)||hash_file("sha256",$file)!==$digest){throw new Exception("Release integrity failure");}
    }
    $tree=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($release,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::SELF_FIRST);
    foreach($tree as $entry){
        $relative=substr($entry->getPathname(),strlen($release)+1);
        if($entry->isLink()||!$entry->isDir()&&(!$entry->isFile()||!array_key_exists($relative,$manifest))){throw new Exception("Unreviewed release entry");}
    }
}
function gnosi_lock(){
    global $p;
    $file=gnosi_file($p,"publish.lock");
    $lock=fopen($file,"c");
    if($lock===false||!flock($lock,LOCK_EX)){throw new Exception("Publication lock unavailable");}
    return $lock;
}
function gnosi_service_state($includeLog=true){
    global $p;
    foreach(["config.json","config.pending.json","cli.php","library.php","daemon.php","state.sqlite","state.sqlite-wal","state.sqlite-shm","state.sqlite-journal"] as $name){gnosi_file($p,$name);}
    if($includeLog){gnosi_file($p,"worker.log");}
    foreach(glob($p."/*.php") as $script){gnosi_file($p,basename($script));}
    $captures=$p."/captures";
    if(gnosi_exists($captures)){
        gnosi_directory($captures);
        $tree=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($captures,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::SELF_FIRST);
        foreach($tree as $entry){
            if($entry->isLink()||!$entry->isDir()&&!$entry->isFile()){throw new Exception("Unowned private service entry");}
        }
    }
}
function gnosi_install_config($raw){
    global $p,$owner;
    gnosi_service_state(false);
    $config=json_decode($raw,true,64,JSON_THROW_ON_ERROR);
    $identity=$owner===null?null:json_decode($owner,true,64,JSON_THROW_ON_ERROR);
    if(!is_array($config)||($config["test_mode"]??null)!==true||($config["allow_delivery"]??false)!==false||$identity!==null&&($config["site_id"]??null)!==$identity["site_id"]){throw new Exception("Unreviewed service configuration");}
    $config["db_path"]=$p."/state.sqlite";$config["spool_path"]=$p."/captures";$config["library_path"]=$p."/library.php";
    gnosi_write($p,"config.json",json_encode($config,JSON_THROW_ON_ERROR));
}
function gnosi_service_config(){
    global $p,$owner;
    gnosi_service_state();
    $file=gnosi_file($p,"config.json");
    $config=json_decode(file_get_contents($file),true,64,JSON_THROW_ON_ERROR);
    $identity=$owner===null?null:json_decode($owner,true,64,JSON_THROW_ON_ERROR);
    if(!is_array($config)||($config["test_mode"]??null)!==true||($config["allow_delivery"]??false)!==false||$identity!==null&&($config["site_id"]??null)!==$identity["site_id"]){throw new Exception("Unreviewed service configuration");}
    foreach(["db_path"=>"state.sqlite","spool_path"=>"captures","library_path"=>"library.php"] as $key=>$name){if(($config[$key]??null)!==$p."/".$name){throw new Exception("Service path escaped its owned namespace");}}
    return $file;
}
function gnosi_service_script($name){
    global $p;
    $script=gnosi_file($p,$name);
    $library=gnosi_file($p,"library.php");
    if(!is_file($script)||!is_file($library)){throw new Exception("Missing owned service runtime");}
    return $script;
}
'''
