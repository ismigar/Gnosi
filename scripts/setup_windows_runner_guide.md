# Guia de Configuració: VM de Windows a UTM per a Self-Hosted Runner

Aquesta guia explica com preparar la màquina virtual de Windows a **UTM** i configurar-hi el runner de GitHub Actions per compilar l'aplicació d'Electron i la release de Windows (`*.exe`).

---

## Pas 1: Descarregar i Iniciar Windows 11 a UTM

1. **Obtenir la imatge de Windows**:
   * Obre UTM i fes clic a **Create a New Virtual Machine**.
   * Selecciona **Virtualize** > **Windows**.
   * UTM inclou una opció directa de descarregar i instal·lar Windows 11 ARM64 automàticament ("Install Windows 11"). Utilitza aquesta opció.
2. **Assignació de recursos recomanada**:
   * **CPU**: 4 nuclis.
   * **RAM**: 4096 MB (4 GB) o superior.
   * **Disc**: 30 GB o superior.
3. **Instal·lació de Guest Tools**:
   * Quan finalitzi la instal·lació de Windows 11, munta la imatge de `spice-guest-tools` des del menú d'UTM i instal·la els controladors de xarxa i pantalles.

---

## Pas 2: Instal·lar Requeriments de Compilació a Windows

Dins de la VM de Windows:

1. Obre **PowerShell** com a Administrador.
2. Instal·lar **Node.js 20** i **Python 3.11**:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Python.Python.3.11
   winget install Git.Git
   ```
3. Reiniciar el terminal de PowerShell per refrescar les variables d'entorn (`PATH`).

---

## Pas 3: Executar el Runner de GitHub Actions

1. Copia el fitxer `setup_windows_runner.ps1` a la teva VM de Windows (o clona el repositori).
2. Obre PowerShell com a Administrador i executa:
   ```powershell
   Set-ExecutionPolicy Unrestricted -Scope Process -Force
   .\scripts\setup_windows_runner.ps1 -RunnerToken "EL_TEU_TOKEN_DE_GITHUB"
   ```
3. El script s'encarregarà de:
   * Descarregar i extreure l'agent de GitHub Actions a `C:\actions-runner`.
   * Registrar-lo amb les etiquetes `self-hosted,Windows,X64`.
   * Instal·lar-lo i iniciar-lo com a Servei de Windows de fons (`svc.cmd start`).

---

## Verificació a GitHub

Ves a **GitHub > Settings > Actions > Runners** al repositori:
Veuràs el runner **Windows-Local-Runner** en estat `Idle` (Online).
