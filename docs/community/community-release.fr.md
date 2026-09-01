# Kit de publication communautaire de Gnosi

[English](community-release.md) · [Català](community-release.ca.md) · [Español](community-release.es.md) · [Français](community-release.fr.md)

Ces textes sont prêts à être adaptés ou publiés. Remplacez uniquement le
contexte facultatif entre crochets et conservez l’avertissement concernant la
version bêta et les paquets non signés.

## Annonce principale

### Gnosi : de la source au manuscrit, en gardant la maîtrise de vos connaissances

J’ai créé Gnosi parce que mon flux de recherche était réparti entre Notion,
Obsidian et Mendeley. Notion m’apportait des bases de données et des vues de
projet, Obsidian des fichiers Markdown et un graphe de connaissances, et
Mendeley gérait les références. Les mêmes sources et idées devaient exister à
plusieurs endroits, tandis que des années de travail dépendaient de produits
fermés et de politiques que je ne contrôlais pas.

Gnosi est ma réponse open source : un espace de recherche local-first qui relie
les références, les preuves issues de PDF, EPUB et du Web, les notes, les vues
structurées, un graphe de connaissances et des citations vérifiables. Les
connaissances sous-jacentes restent dans des fichiers Markdown et YAML
ordinaires.

Le flux principal est volontairement simple :

1. Capturer ou importer une source.
2. Lire et conserver la preuve exacte ainsi que sa provenance.
3. Relier les notes de lecture pour construire sa propre synthèse.
4. Citer le résultat dans Gnosi, Word ou LibreOffice.

L’application de bureau est disponible pour macOS, Windows et Linux. Elle est
encore en bêta et les paquets actuels ne sont pas signés ; consultez la note
d’installation sur la page de la version. Gnosi peut aussi être exécuté
nativement ou au moyen du déploiement Docker pris en charge.

Téléchargement : https://github.com/ismigar/Gnosi/releases/latest

Code source et documentation : https://github.com/ismigar/Gnosi

Si vous l’essayez, je souhaite surtout savoir où cette chaîne se rompt :
installation, importation des sources, traçabilité des preuves, synthèse ou
citation.

## Publication courte pour les réseaux sociaux

J’ai créé Gnosi pour ne plus dupliquer mes recherches entre Notion, Obsidian et
Mendeley. Il relie sources → preuves → notes → citations tout en conservant les
connaissances dans des fichiers Markdown/YAML locaux. Open source, local-first,
application de bureau et auto-hébergement. Les paquets bêta ne sont pas encore
signés.

https://gnosi.temenosismael.org/index.fr.html

## Publication pour les communautés de recherche

### Un espace open source et local-first pour aller de la source au manuscrit

Gnosi peut être utile si votre flux réel traverse un gestionnaire de
références, un carnet Markdown, des tableaux de projet et Word ou LibreOffice.

Il combine l’importation DOI, ISBN, arXiv, PMID, BibTeX et RIS, un lecteur
PDF/EPUB, des annotations qui préservent les preuves, des notes Markdown
reliées, des vues de base de données typées, un graphe de connaissances, des
citations CSL et des compléments Word/LibreOffice. L’IA est facultative et peut
utiliser des fournisseurs locaux ou cloud ; la provenance reste visible.

Le projet est sous licence AGPL-3.0-or-later et le Vault reste un ensemble de
fichiers ordinaires. Un modèle officiel signé présente le flux en anglais,
catalan et espagnol sans exiger de fournisseur d’IA.

Il s’agit d’un outil personnel partagé avec la communauté, et non de la
prétention de remplacer tous les systèmes de recherche. Les retours fondés sur
une source et un texte réels sont particulièrement utiles.

Projet : https://github.com/ismigar/Gnosi

## Demande de retour

Merci d’essayer Gnosi. Quatre réponses concrètes sont plus utiles qu’une note
générale :

1. Avez-vous pu l’installer et l’ouvrir ?
2. Avez-vous pu importer une source réelle ?
3. Avez-vous pu remonter d’une note de lecture ou de synthèse jusqu’à la preuve ?
4. Avez-vous pu insérer ou exporter la citation ?

Indiquez votre système d’exploitation, l’étape qui vous a bloqué et le résultat
attendu. Ne joignez jamais de contenu de recherche privé à un ticket public.

Ticket de retour : https://github.com/ismigar/Gnosi/issues/new?labels=feedback&title=%5BFeedback%5D%20Mon%20premier%20flux%20Gnosi

## Questions fréquentes

### Gnosi est-il un autre clone de Notion ou d’Obsidian ?

Non. Leurs idées d’éditeur, de bases de données et de graphe font partie du
contexte, mais le parcours principal de Gnosi est la chaîne de recherche qui va
d’une source et d’une preuve exacte à une synthèse reliée et une citation
vérifiable.

### Remplace-t-il Zotero ou Mendeley ?

Gnosi possède un gestionnaire de références natif et une capture Web compatible
avec Zotero, mais prend aussi en charge les échanges ouverts en BibTeX et RIS.
L’objectif est de supprimer les doublons et de préserver l’interopérabilité,
pas de rendre les bibliothèques existantes captives d’un nouveau format.

### L’IA est-elle obligatoire ?

Non. Le modèle de recherche et le flux principal de la source à la citation
fonctionnent sans fournisseur d’IA. Lorsqu’elle est activée, l’IA peut utiliser
des modèles locaux ou cloud.

### Où les données sont-elles stockées ?

Le Vault est un dossier contenant des fichiers Markdown, YAML et des ressources
ordinaires. Les index locaux reconstruisibles améliorent les performances, mais
ne sont pas la source de vérité.

### Est-il prêt pour une équipe de recherche ?

Le mode personnel est le parcours principal le plus mature. Le mode
organisation, les rôles et la présence en direct existent, mais l’édition
collaborative en temps réel reste précoce. Testez l’usage en groupe avant de lui
confier un travail partagé critique.

### Pourquoi macOS affiche-t-il un avertissement à l’ouverture ?

Les paquets bêta actuels ne sont pas signés. Utilisez clic droit → Ouvrir lors
du premier lancement et vérifiez que le téléchargement provient de la page
GitHub Releases officielle. La signature et la notarisation restent à finaliser.
