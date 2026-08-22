---
status: implemented
last_verified: 2026-08-02
source_paths:
  - sh/run_native_dev.sh
  - sh/run_native_frontend.sh
  - sh/native_watchdog.sh
  - docker-compose.yml
  - backend/config/paths_config.py
tests:
  - e2e/tests/anon/smoke.spec.ts
---

# Série d'opérations

## Niveau de référence du développement autochtone

Avant de lancer un autre processus, déterminez quel processus possède chaque port et inspectez les journaux natifs. Ne laissez pas Vite sélectionner un port de retour.

Objectifs attendus:

| Service | Adresse | Vérification significative |
| --- | --- | --- |
| Frontière | `https://localhost:5173` | Application shell rend et peut naviguer. |
| Infrastructure | `http://127.0.0.1:5002` | `/api/health`, `/api/config`, `/api/vault/pages`. |
| Aide à la récupération OneDrive | `http://127.0.0.1:5009` | Ne sont nécessaires que pour les chemins d'hydratation/de récupération. |

Les changements de source de l'arrière-pays rechargent automatiquement. Les changements de dépendance nécessitent un redémarrage de l'arrière-pays LaunchAgent. Vite hot recharges source; les valeurs injectées par démarrage, comme la version de l'application, nécessitent un redémarrage frontal.

## Première séquence diagnostique

1. Confirmez qu'il y a exactement un auditeur sur chaque port d'application.
2. Lisez les journaux d'erreurs natifs de backend et de frontend.
3. Demande `/api/health`; enregistrement du mode efficace et du statut du coffre.
4. Demande `/api/config`; vérifier la voûte sélectionnée sans révéler les secrets.
5. Demande `/api/vault/pages`; distinguer le contenu vide d'une erreur d'E/S.
6. Reproduire l'action frontale affectée en regardant la console du navigateur et
Les registres de l'arrière-pays.
7. Exécutez le test automatisé le plus étroit avant de redémarrer les services généraux.

## OneDrive et les symptômes du fichier nuageux

`EDEADLK` ou `EAGAIN` sur une demande page/index indique un problème de disponibilité du fournisseur de fichiers, pas une défaillance de l'analyseur de marquage. Vérifiez les drapeaux de fichiers et la matérialisation des blocs. Hydratez le plus petit répertoire pertinent par le mécanisme de réchauffement. Essayez les défaillances transitoires séquentielles; ne martez pas un marqueur de place orphelin en parallèle.

Le moteur doit continuer avec des résultats partiels lorsque le contrat le permet. Ne jamais enregistrer un scan partiel comme un index complet. L'atténuation durable par appareil est de garder les répertoires critiques téléchargés localement.

## Données et secrets locaux

L'État autochtone est sous `local_data`; l'état de Docker est dans le `gnosi_local_data` Avant la migration ou la réinstallation, conservez la gestion SQLite, les secrets, le registre des outils, les points de contrôle au besoin et l'état du système.

Ne copiez pas SQLite en direct dans une voûte synchronisée ou ne démarrez pas deux auteurs contre la même base de données. La reconnexion d'OAuth sur une autre machine est attendue parce que les secrets sont intentionnellement par appareil.

## Auto-hébergement des dockers

Docker n'est utilisé que lorsque sélectionné délibérément. Valider la configuration de composition, construire les deux images et exécuter le test de fumée sanitaire de l'arrière-plan avec un fournisseur de fichiers local. Source de l'arrière-plan relie les supports recharger Python; les changements de dépendance ou de fichier Docker reconstituent l'image de l'arrière-plan.

La fenêtre utilise un anonyme `node_modules` volume. Un changement de fichier de verrouillage peut être caché par l'ancien volume; recréer seulement le service frontal et son volume anonyme. `docker compose down -v` comme une réparation de routine parce qu'il peut supprimer les données locales nommées.

## Carte commune des symptômes

| Symptôme | Limites probables | Procès-verbal |
| --- | --- | --- |
| Ecran blanc avant | JS runtime, bloc échoué, auth bootstrap échoué | Console de navigateur, journal de Vite, construction de production. |
| Travaux de santé, Vault échoue | Configuration du chemin, contexte, hydratation du fournisseur | `/api/config`, registres de vault, disponibilité des fichiers. |
| Paramètres redressés | Mauvaises cibles de params, écriture atomique échouée, migration de l'héritage | Contexte de voûte actif et source de params. |
| L'intégration apparaît déconnectée | Sécret local manquant ou pointeur par défaut stal | État d'intégration masqué et répertoire secret local. |
| L'agent n'a pas d'outils | Connexion MCP, validation du catalogue, affectation des compétences | Les journaux de découverte de démarrage et les paramètres de compétence en IA. |
| Le courrier arrête la mise à jour | Erreur de travail/compte IDLE ou authenticité du fournisseur | État du travailleur par compte et synchronisation incrémentale. |
| Le bureau affiche l'ancienne version | Rendeur/serveur non redémarré ou manifestes différents | Versions de paquets Frontend et Electron. |

## Opérations de documentation

Exécutez le générateur, le validateur et la construction stricte de MkDocs à partir de la racine d'application. Les différences générées sont examinées et commitées. `site/engineering` est une production de construction jetable et ne devrait pas être engagé.

Après un changement de documentation atteint le dépôt public `main` branch, le flux de travail Pages publie le portail à `https://gnosi.temenosismael.org/engineering/`. Si le déploiement échoue, vérifiez les étapes de référence générées et de validateur avant l'artefact Pages. Confirmez que le dépôt Pages utilise GitHub Actions comme source de publication et que `github-pages` environnement permet les déploiements de `main`.

## Apprentissage des incidents

Après avoir diagnostiqué un nouveau défaut, corriger la mise en œuvre, ajouter un test de régression, enregistrer la restriction dans la directive pertinente, et promouvoir des connaissances stables dans ce portail. Une récupération sans papiers effectuée seulement dans un terminal n'est pas une correction opérationnelle complète.
