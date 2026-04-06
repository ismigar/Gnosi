import os
import time
import argparse
from pathlib import Path
import glob
import math

def format_size(size_bytes):
    if size_bytes == 0:
        return "0B"
    size_name = ("B", "KB", "MB", "GB", "TB")
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_name[i]}"

def purge_old_files(pattern, days, dry_run=True):
    expanded_pattern = os.path.expanduser(pattern)
    now = time.time()
    seconds = days * 86400
    total_freed = 0
    files_count = 0

    # Expandir el glob
    matched_paths = glob.glob(expanded_pattern, recursive=True)
    
    if not matched_paths:
        return 0, 0

    for path_str in matched_paths:
        p = Path(path_str)
        if p.is_file():
            try:
                if (now - p.stat().st_mtime) > seconds:
                    size = p.stat().st_size
                    if not dry_run:
                        p.unlink()
                    total_freed += size
                    files_count += 1
            except (PermissionError, FileNotFoundError):
                continue
        elif p.is_dir():
            for root, dirs, files in os.walk(path_str):
                for name in files:
                    file_p = Path(root) / name
                    try:
                        if (now - file_p.stat().st_mtime) > seconds:
                            size = file_p.stat().st_size
                            if not dry_run:
                                file_p.unlink()
                            total_freed += size
                            files_count += 1
                    except (PermissionError, FileNotFoundError):
                        continue
    
    return total_freed, files_count

def main():
    parser = argparse.ArgumentParser(description="Purga archivos antiguos de WhatsApp y Telegram.")
    parser.add_argument("--days", type=int, default=7, help="Días de antigüedad (default: 7)")
    parser.add_argument("--dry-run", action="store_true", help="Simular sin borrar")
    args = parser.parse_args()

    # Rutas detectadas de WhatsApp y Telegram
    targets = [
        "~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media",
        "~/Library/Group Containers/6N38VWS5BX.ru.keepcoder.Telegram/appstore/account-*/postbox/media",
        "~/Library/Group Containers/6N38VWS5BX.ru.keepcoder.Telegram/appstore/account-*/postbox/resources"
    ]

    print(f"--- Iniciando purga (Antigüedad > {args.days} días, dry_run={args.dry_run}) ---")
    
    grand_total_freed = 0
    grand_total_files = 0

    for target in targets:
        print(f"\nProcesando: {target}")
        freed, count = purge_old_files(target, args.days, args.dry_run)
        grand_total_freed += freed
        grand_total_files += count
        print(f"  Resultados: {count} archivos identificados, {format_size(freed)} liberados.")

    print("\n" + "="*40)
    print(f"RESUMEN FINAL {'(SIMULADO)' if args.dry_run else ''}")
    print(f"Archivos: {grand_total_files}")
    print(f"Espacio total: {format_size(grand_total_freed)}")
    print("="*40)

if __name__ == "__main__":
    main()
