#!/usr/bin/env python3
"""Pin the Gnosi Cite task pane into a Word document.

Word on macOS never persists the ribbon button of a sideloaded add-in, so the
pane has to be re-inserted from "Developer Add-ins" on every launch. Office's
autoopen feature can reopen a designated pane by itself, but only if the
document carries the right Open XML parts *and* the task pane is marked
``visibility="1"``.

That value matters: with ``visibility="0"`` -- the only thing Office.js can
write, via ``document.settings`` -- autoopen is conditional on the add-in
already being installed on the device, which is exactly what macOS refuses to
do for a sideloaded add-in. With ``visibility="1"`` Word ships the add-in
reference with the document and asks for trust once instead.

``visibility="1"`` can only be set through Open XML, which is what this script
does. Run it once per document; it is idempotent.

Usage:
    python pin_taskpane.py DOCUMENT.docx [...]
    python pin_taskpane.py DOCUMENT.docx --dry-run
    python pin_taskpane.py DOCUMENT.docx --undo
"""

import argparse
import logging
import os
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

logger = logging.getLogger(__name__)

# Package-relative part names. Word writes exactly these when the add-in is
# inserted by hand, so injecting them by hand produces an identical package.
TASKPANES_PART = "word/webextensions/taskpanes.xml"
TASKPANES_RELS_PART = "word/webextensions/_rels/taskpanes.xml.rels"
WEBEXTENSION_PART = "word/webextensions/webextension1.xml"
ROOT_RELS_PART = "_rels/.rels"
CONTENT_TYPES_PART = "[Content_Types].xml"

RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
TASKPANES_REL_TYPE = (
    "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes"
)

# Default manifest location, relative to this file, so the id and version are
# read from the single source of truth rather than duplicated here. The version
# ends up inside the document's webextension reference; if the manifest is
# bumped, re-run this script over the document to refresh it.
DEFAULT_MANIFEST = os.path.normpath(
    os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..",
        "..",
        "frontend",
        "public",
        "word-addin",
        "manifest.xml",
    )
)

TASKPANES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane dockstate="right" visibility="1" width="350" row="0"><wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></wetp:taskpane></wetp:taskpanes>"""

TASKPANES_RELS_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>"""

# store="developer" / storeType="Registry" is the documented pairing for a
# sideloaded add-in; anything else makes Word look in a catalog it has no
# entry for.
WEBEXTENSION_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11" id="{{{ext_id}}}"><we:reference id="{addin_id}" version="{version}" store="developer" storeType="Registry"/><we:alternateReferences/><we:properties><we:property name="Office.AutoShowTaskpaneWithDocument" value="true"/></we:properties><we:bindings/><we:snapshot xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></we:webextension>"""

CONTENT_TYPE_OVERRIDES = (
    ("/" + TASKPANES_PART, "application/vnd.ms-office.webextensiontaskpanes+xml"),
    ("/" + WEBEXTENSION_PART, "application/vnd.ms-office.webextension+xml"),
)


def read_manifest_identity(manifest_path):
    """Read the add-in id and version from the Office manifest.

    Args:
        manifest_path: Path to the add-in's manifest.xml.

    Returns:
        A tuple of (addin_id, version) as strings.

    Raises:
        SystemExit: If the manifest is missing or lacks either element.
    """
    if not os.path.isfile(manifest_path):
        sys.exit("Manifest not found: %s" % manifest_path)
    tree = ET.parse(manifest_path)
    ns = {"o": "http://schemas.microsoft.com/office/appforoffice/1.1"}
    addin_id = tree.find("o:Id", ns)
    version = tree.find("o:Version", ns)
    if addin_id is None or version is None:
        sys.exit("Manifest has no <Id>/<Version>: %s" % manifest_path)
    return addin_id.text.strip(), version.text.strip()


def derive_extension_id(addin_id):
    """Derive the stable per-document webextension id from the add-in id.

    Word generates a random GUID here. Deriving it instead keeps the script
    idempotent: re-running it rewrites the same part rather than accumulating
    a second webextension with a fresh id.

    Args:
        addin_id: The add-in GUID from the manifest.

    Returns:
        An uppercase GUID string, without surrounding braces.
    """
    return addin_id.upper()


def next_relationship_id(rels_xml):
    """Pick a relationship id that is free in the given .rels part.

    Args:
        rels_xml: Raw bytes of a .rels part.

    Returns:
        An unused relationship id such as "rId7".
    """
    used = {int(m) for m in re.findall(rb'Id="rId(\d+)"', rels_xml)}
    candidate = 1
    while candidate in used:
        candidate += 1
    return "rId%d" % candidate


def add_taskpanes_relationship(rels_xml):
    """Ensure the package root relates to the task panes part.

    Args:
        rels_xml: Raw bytes of _rels/.rels.

    Returns:
        Raw bytes of the updated part; unchanged if the relationship existed.
    """
    if TASKPANES_REL_TYPE.encode() in rels_xml:
        return rels_xml
    ET.register_namespace("", RELS_NS)
    root = ET.fromstring(rels_xml)
    ET.SubElement(
        root,
        "{%s}Relationship" % RELS_NS,
        {
            "Id": next_relationship_id(rels_xml),
            "Type": TASKPANES_REL_TYPE,
            "Target": TASKPANES_PART,
        },
    )
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True)


def remove_taskpanes_relationship(rels_xml):
    """Drop the task panes relationship from the package root.

    Args:
        rels_xml: Raw bytes of _rels/.rels.

    Returns:
        Raw bytes of the updated part.
    """
    ET.register_namespace("", RELS_NS)
    root = ET.fromstring(rels_xml)
    for rel in list(root):
        if rel.get("Type") == TASKPANES_REL_TYPE:
            root.remove(rel)
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True)


def add_content_type_overrides(content_types_xml):
    """Ensure both webextension parts are declared in [Content_Types].xml.

    Args:
        content_types_xml: Raw bytes of the content types part.

    Returns:
        Raw bytes of the updated part; unchanged if both were declared.
    """
    ET.register_namespace("", CONTENT_TYPES_NS)
    root = ET.fromstring(content_types_xml)
    declared = {
        el.get("PartName")
        for el in root.findall("{%s}Override" % CONTENT_TYPES_NS)
    }
    changed = False
    for part_name, content_type in CONTENT_TYPE_OVERRIDES:
        if part_name in declared:
            continue
        ET.SubElement(
            root,
            "{%s}Override" % CONTENT_TYPES_NS,
            {"PartName": part_name, "ContentType": content_type},
        )
        changed = True
    if not changed:
        return content_types_xml
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True)


def remove_content_type_overrides(content_types_xml):
    """Drop the webextension overrides from [Content_Types].xml.

    Args:
        content_types_xml: Raw bytes of the content types part.

    Returns:
        Raw bytes of the updated part.
    """
    ET.register_namespace("", CONTENT_TYPES_NS)
    root = ET.fromstring(content_types_xml)
    targets = {part_name for part_name, _ in CONTENT_TYPE_OVERRIDES}
    for el in root.findall("{%s}Override" % CONTENT_TYPES_NS):
        if el.get("PartName") in targets:
            root.remove(el)
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True)


def build_pinned_package(source, destination, addin_id, version):
    """Write a copy of the document with the task pane pinned.

    Args:
        source: Path to the input .docx.
        destination: Path to write the rewritten .docx to.
        addin_id: The add-in GUID from the manifest.
        version: The add-in version from the manifest.

    Returns:
        True if the resulting package differs from the input.
    """
    replacements = {
        TASKPANES_PART: TASKPANES_XML.encode("utf-8"),
        TASKPANES_RELS_PART: TASKPANES_RELS_XML.encode("utf-8"),
        WEBEXTENSION_PART: WEBEXTENSION_XML.format(
            ext_id=derive_extension_id(addin_id),
            addin_id=addin_id,
            version=version,
        ).encode("utf-8"),
    }
    changed = False
    with zipfile.ZipFile(source) as zin:
        names = zin.namelist()
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                # Directory entries are absent from a Word-written package;
                # re-adding them makes Word complain the file is damaged.
                if item.is_dir():
                    continue
                data = zin.read(item.filename)
                if item.filename in replacements:
                    new_data = replacements.pop(item.filename)
                elif item.filename == ROOT_RELS_PART:
                    new_data = add_taskpanes_relationship(data)
                elif item.filename == CONTENT_TYPES_PART:
                    new_data = add_content_type_overrides(data)
                else:
                    new_data = data
                if new_data != data:
                    changed = True
                zout.writestr(item, new_data)
            # Parts the document never had: append them after the originals.
            for name, data in replacements.items():
                zout.writestr(name, data)
                changed = True
        if replacements:
            logger.info("Injected %d missing part(s)", len(replacements))
        elif changed:
            logger.info("Updated existing webextension parts")
    del names
    return changed


def build_unpinned_package(source, destination):
    """Write a copy of the document with the task pane parts removed.

    Args:
        source: Path to the input .docx.
        destination: Path to write the rewritten .docx to.

    Returns:
        True if the resulting package differs from the input.
    """
    dropped = {TASKPANES_PART, TASKPANES_RELS_PART, WEBEXTENSION_PART}
    changed = False
    with zipfile.ZipFile(source) as zin:
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.is_dir():
                    continue
                if item.filename in dropped:
                    changed = True
                    continue
                data = zin.read(item.filename)
                if item.filename == ROOT_RELS_PART:
                    new_data = remove_taskpanes_relationship(data)
                elif item.filename == CONTENT_TYPES_PART:
                    new_data = remove_content_type_overrides(data)
                else:
                    new_data = data
                if new_data != data:
                    changed = True
                zout.writestr(item, new_data)
    return changed


def process(path, addin_id, version, undo=False, dry_run=False, backup=True):
    """Pin or unpin one document, in place.

    Args:
        path: Path to the .docx to rewrite.
        addin_id: The add-in GUID from the manifest.
        version: The add-in version from the manifest.
        undo: Remove the parts instead of adding them.
        dry_run: Report what would change without writing.
        backup: Keep the original alongside as <name>.bak.

    Returns:
        True if the document was changed (or would be, under dry_run).
    """
    if not zipfile.is_zipfile(path):
        logger.error("Not a .docx (or not a zip): %s", path)
        return False

    handle, tmp = tempfile.mkstemp(suffix=".docx")
    os.close(handle)
    try:
        if undo:
            changed = build_unpinned_package(path, tmp)
        else:
            changed = build_pinned_package(path, tmp, addin_id, version)

        if not changed:
            logger.info("Already up to date: %s", path)
            return False
        if dry_run:
            logger.info("Would rewrite: %s", path)
            return True
        if backup:
            shutil.copy2(path, path + ".bak")
        shutil.move(tmp, path)
        tmp = None
        logger.info("%s: %s", "Unpinned" if undo else "Pinned", path)
        return True
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


def main(argv=None):
    """Entry point.

    Args:
        argv: Argument list; defaults to sys.argv[1:].

    Returns:
        Process exit code.
    """
    parser = argparse.ArgumentParser(
        description="Pin the Gnosi Cite task pane into Word documents so it "
        "reopens by itself."
    )
    parser.add_argument("documents", nargs="+", metavar="DOCUMENT.docx")
    parser.add_argument(
        "--manifest",
        default=DEFAULT_MANIFEST,
        help="Add-in manifest to read the id and version from.",
    )
    parser.add_argument(
        "--undo",
        action="store_true",
        help="Remove the task pane parts instead of adding them.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing anything.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Overwrite without keeping a .bak copy.",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    addin_id, version = read_manifest_identity(args.manifest)
    logger.info("Add-in %s version %s", addin_id, version)

    missing = [p for p in args.documents if not os.path.isfile(p)]
    for path in missing:
        logger.error("No such file: %s", path)

    for path in args.documents:
        if os.path.isfile(path):
            process(
                path,
                addin_id,
                version,
                undo=args.undo,
                dry_run=args.dry_run,
                backup=not args.no_backup,
            )
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
