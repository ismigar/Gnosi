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

| Terme | Signification technique |
| --- | --- |
| Vault | Répertoire dont les fichiers Markdown et les ressources forment un espace de connaissances. |
| Page | Document Markdown avec un frontmatter YAML et un `id` stable. |
| Base de données ou table | Vue structurée des pages, généralement limitée à un dossier et à un schéma plutôt qu'à une table SQL distincte. |
| Vue | Une projection enregistrée d'une base de données : type, filtres, tri, regroupement, champs et état de mise en page. |
| Registre | Métadonnées gérées par Gnosi décrivant les bases de données, vues, schémas ou catalogues. |
| Métadonnées auxiliaires | Données internes `.gnosi` associées au contenu mais délibérément séparées des champs Markdown rédigés par l'utilisateur. |
| Base de données de gestion | État SQLite strictement local pour les identités, espaces de travail, appartenances, accès aux vaults, jetons et liens de partage. |
| Données locales | Bases de données, caches, index, secrets, journaux, sorties et points de contrôle propres à chaque instance. Elles ne doivent pas être synchronisées dans le cloud. |
| Mode personnel | Mode par défaut à un seul utilisateur avec authentification contournée sauf si cela est explicitement requis. |
| Mode organisation | Mode authentifié avec appartenance à un espace de travail et rôles hiérarchisés. |
| Espace de travail | Périmètre administratif regroupant les membres et les vaults enregistrés. |
| Compétence d'exécution | Capacité applicative documentée dans `pipeline/skills/`, distincte d'un plugin pour agent de développement. |
| Outil | Opération appelable par un agent, éventuellement découverte via MCP ou générée localement. |
| MCP | Model Context Protocol, utilisé pour découvrir et invoquer des outils externes pour agents. |
| Directive | Mémoire technique décrivant une procédure, une décision, un incident, une restriction ou un plan de mise en oeuvre. |
| Référence générée | Documentation déterministe dérivée du code source actuel sans importer l'environnement d'exécution. |
| Source de vérité | Données dont la perte ne peut être réparée à partir d'une autre représentation faisant autorité. |
| Données dérivées | Cache ou index qui peut être reconstruit à partir d'une source de vérité. |
| Fournisseur de fichiers | Adaptateur du système de fichiers local ou cloud, notamment pour l'hydratation et les contrôles de disponibilité. |
| Serveur de traduction | Service auxiliaire de Zotero qui convertit les pages web et les identifiants en métadonnées bibliographiques normalisées. |
| PAT | Personal Access Token, ou jeton d'accès personnel ; la base de gestion ne stocke que son hachage et son préfixe d'affichage. |

## Délimitation des noms

Les identifiants historiques tels que `vault`, `DIGITAL_BRAIN_VAULT_PATH` et certaines anciennes clés d'intégration préfixées par Temenos restent des contrats de compatibilité. Le vocabulaire public du produit utilise Gnosi et Knowledge lorsque les migrations sont terminées. Les identifiants ne sont pas renommés simplement pour uniformiser la terminologie de la documentation.
