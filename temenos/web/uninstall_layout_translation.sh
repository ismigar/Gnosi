#!/usr/bin/env bash
# uninstall_layout_translation.sh — Drupal 10
# Elimina el camp layout_builder__translation i desinstal·la layout_builder_st
# fent servir Drush via PHP (evita noexec/perm. denegats).

set -euo pipefail

# === Config ===
DR="php ./vendor/bin/drush.php"             # Drush via PHP
MODULE="layout_builder_st"
ENTITY="node"
FIELD="layout_builder__translation"
SITE_URI="https://www.temenosdeismael.org"  # ajusta si cal

echo "==> Playbook per ${MODULE} (camp ${FIELD})"

# 0) Sanity check
$DR --uri="$SITE_URI" status >/dev/null

# 1) Desbloquejar field storage si cal
echo "==> Desbloquejant field storage (si cal)..."
$DR --uri="$SITE_URI" php:eval '
use Drupal\field\Entity\FieldStorageConfig;
$f = FieldStorageConfig::loadByName("'${ENTITY}'","'${FIELD}'");
if ($f) {
  if ($f->isLocked()) { $f->setLocked(FALSE)->save(); echo "Field storage desbloquejat\n"; }
  else { echo "Field storage ja NO està bloquejat\n"; }
} else { echo "Field storage no trobat (potser ja esborrat)\n"; }
'

# 2) Esborrar instàncies del camp a tots els bundles
echo "==> Esborrant instàncies del camp..."
$DR --uri="$SITE_URI" php:eval '
use Drupal\field\Entity\FieldConfig;
$storage = \Drupal::entityTypeManager()->getStorage("field_config");
$configs = $storage->loadByProperties(["field_name"=>"'${FIELD}'","entity_type"=>"'${ENTITY}'"]);
if (!$configs) { echo "No hi ha instàncies (potser ja esborrades)\n"; }
foreach ($configs as $cfg) { echo " - ".$cfg->id()."\n"; $cfg->delete(); }
echo "Instàncies esborrades.\n";
'

# 3) Netejar referències en displays (form i view) que encara continguin el camp
echo "==> Netejant referències en displays..."
$DR --uri="$SITE_URI" php:eval '
$factory = \Drupal::service("config.factory");
$active  = \Drupal::service("config.storage");
$names   = $active->listAll();
$needle  = "'${FIELD}'";
$cnt=0;
foreach ($names as $name) {
  if (preg_match("@^core\.entity_(view|form)_display\.node\..+@", $name)) {
    $cfg = $factory->getEditable($name);
    $data = $cfg->getRawData();
    $ser = serialize($data);
    if (strpos($ser, $needle) !== FALSE) {
      $changed = FALSE;
      if (isset($data["content"]["'${FIELD}'"])) { unset($data["content"]["'${FIELD}'"]); $changed = TRUE; }
      $walk = function (&$a) use (&$walk, $needle, &$changed) {
        if (!is_array($a)) return;
        foreach (array_keys($a) as $k) {
          if ($k === "'${FIELD}'") { unset($a[$k]); $changed = TRUE; }
          else { $walk($a[$k]); }
        }
      };
      $walk($data);
      if ($changed) { $cfg->setData($data)->save(); echo " - Net: $name\n"; $cnt++; }
    }
  }
}
echo "Displays nets ($cnt modificats).\n";
'

# 4) Esborrar field storage
echo "==> Esborrant field storage..."
$DR --uri="$SITE_URI" php:eval '
use Drupal\field\Entity\FieldStorageConfig;
if ($f = FieldStorageConfig::loadByName("'${ENTITY}'",""'${FIELD}'"")) { $f->delete(); echo "Field storage esborrat.\n"; }
else { echo "Field storage no trobat (potser ja esborrat abans)\n"; }
'

# 5) Updates i caché
echo "==> updatedb i cr..."
$DR --uri="$SITE_URI" updatedb -y || true   # no és crític si no hi ha updates
$DR --uri="$SITE_URI" cr

# 6) Desinstal·lar el mòdul
echo "==> Desinstal·lant ${MODULE}..."
if $DR --uri="$SITE_URI" pm:uninstall ${MODULE} -y; then
  echo "==> ${MODULE} desinstal·lat correctament."
else
  echo "!! Primer intent fallit. Buscant configs que encara referencien '${FIELD}'..."
  $DR --uri="$SITE_URI" php:eval '
  $names = \Drupal::service("config.storage")->listAll();
  $needle = "'${FIELD}'"; $hits=[];
  foreach ($names as $name) {
    $data = \Drupal::service("config.factory")->get($name)->getRawData();
    if ($data && strpos(serialize($data), $needle) !== FALSE) $hits[]=$name;
  }
  if ($hits) { echo "   Encara referencien el camp:\n"; foreach ($hits as $h) echo "   - $h\n"; }
  else { echo "   Cap referència de config pendent.\n"; }
  '
  # segon intent
  $DR --uri="$SITE_URI" pm:uninstall ${MODULE} -y
fi

echo "==> Tot fet."
