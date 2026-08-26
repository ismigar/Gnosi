---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/models/management.py
  - backend/config/app_config.py
  - backend/services/context_vars.py
  - backend/services/workspace_service.py
tests: []
---

# Terminologie

| Durée | Signification technique |
| --- | --- |
| Vault | Un répertoire dont les fichiers et les actifs Markdown forment un espace de connaissance. |
| Page | Un document de marquage avec la matière avant YAML et une stable `id`. |
| Base de données ou tableau | Une vue structurée sur les pages, normalement portée à un dossier et à un schéma plutôt qu'à une table SQL séparée. |
| Vue | Une projection enregistrée d'une base de données : type, filtres, tri, regroupement, champs et état de mise en page. |
| Greffe | Les métadonnées gérées par Gnosi décrivant les bases de données, les vues, les schémas ou les catalogues. |
| Métadonnées de Sidecar | Interne `.gnosi` données associées au contenu mais délibérément séparées des champs Markdown autorisés par l'utilisateur. |
| Base de données sur la gestion | État SQLite uniquement local pour les identités, les espaces de travail, les abonnements, l'accès au coffre, les jetons et les liens partagés. |
| Données locales | Bases de données, caches, index, secrets, journaux, sorties et points de contrôle par instance. Il ne doit pas être synchronisé par le cloud. |
| Mode personnel | Mode par défaut à un seul utilisateur avec authentification contournée sauf si cela est explicitement requis. |
| Mode organisation | Mode authentifié avec l'adhésion à l'espace de travail et les rôles ordonnés. |
| Espace de travail | Limites administratives qui regroupent les membres et les coffres-forts enregistrés. |
| Compétence en cours d'exécution | Une capacité d'application documentée en vertu de `pipeline/skills/`; pas un plugin de développement-agent. |
| Outil | Opération téléphonable disponible à un agent, éventuellement découverte par le MCP ou générée localement. |
| PCM | Modèle de protocole de contexte, utilisé pour découvrir et invoquer des outils d'agents externes. |
| Directive | Mémoire technique décrivant une procédure, une décision, un incident, une restriction ou un plan de mise en oeuvre. |
| Référence générée | Documentation déterministe dérivée de la source actuelle sans importer le temps d'exécution. |
| Source de vérité | Données dont la perte ne peut être réparée à partir d'une autre représentation faisant autorité. |
| Données dérivées | Cache ou index qui peut être reconstruit à partir d'une source de vérité. |
| Fournisseur de fichiers | Adaptateur pour un comportement local ou en nuage de système de fichiers comme des contrôles d'hydratation et de disponibilité. |
| Serveur de traduction | Zotero sidecar qui traduit les pages Web et les identifiants en métadonnées de référence normalisées. |
| PAT | Token d'accès personnel; la base de données de gestion ne stocke que son hachage et son préfixe d'affichage. |

## Délimitation des noms

Identificateurs historiques tels que `vault`, `DIGITAL_BRAIN_VAULT_PATH`, et certaines clés d'intégration préfixées par Temenos restent des contrats de compatibilité. Le langage public des produits utilise Gnosi et des connaissances où les migrations ont été complétées.
