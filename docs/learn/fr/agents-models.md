# Configurer les bots et profils

Tous les bots et profils apparaissent dans une seule liste. Un seul est principal : il est utilisé par défaut pour les nouvelles conversations et coordonne l’équipe. Les actions des plugins continuent d’utiliser leurs propres profils.

## Avant de commencer {#before-you-begin}

Activez la fonction IA. Un fournisseur cloud nécessite des identifiants valides et peut facturer l’usage ; un modèle local nécessite un service en cours d’exécution.

## Étapes {#steps}

1. Ouvrez les paramètres des modèles et fournisseurs et configurez un fournisseur compatible ou un service local. Enregistrez les identifiants dans les paramètres et sélectionnez un modèle disponible.

2. Ouvrez Paramètres → Plugins → IA → Assistants. Choisissez **Créer le premier assistant** si la liste est vide, ou **Créer un profil** pour en ajouter un. Sélectionnez le modèle, nommez le profil et attribuez les compétences nécessaires.

3. Ouvrez la conversation et vérifiez l’agent et le modèle. Posez une question courte pour tester la connexion.

4. Ajoutez la page, la table ou le fichier précis comme contexte. Demandez une tâche limitée, par exemple « Résume les questions de cette page ».

5. Pour agir, le modèle doit prendre en charge les outils et les compétences requises doivent être disponibles. Examinez les demandes de confirmation avant de les accepter.

6. Contrôlez le résultat et ses sources. Enregistrez les conclusions utiles dans une page et distinguez votre interprétation du texte généré.

### Profils et conversations

Chaque fiche possède une icône de configuration et, si elle n’est pas principale, **Définir comme principal**. Choisir un autre bot conserve les bots et leurs configurations ; le nouveau principal reprend la coordination de l’équipe. Les conversations existantes conservent leur profil. Dans le chat, **Profil de la conversation** permet de le changer pour les demandes suivantes sans perdre l’historique ni affecter les autres conversations.

### Un seul modèle par profil

Chaque profil possède un seul LLM. Pour utiliser un autre modèle, choisissez un autre profil ou modifiez son modèle. Il n’y a ni sélection automatique ni modèle de remplacement en cas d’échec. Si un profil est supprimé ou son modèle indisponible, choisissez un autre profil dans le chat. Pour supprimer le profil par défaut, choisissez-en d’abord un autre. Désactivez le plugin IA pour désactiver l’IA.

### Modifier les instructions en Markdown

Les instructions des agents et des compétences partagent un éditeur de blocs actif par défaut, avec des commandes **/**. La barre de mise en forme apparaît lorsque vous sélectionnez du texte, comme dans l’éditeur de pages. Comme dans l’éditeur de pages, un seul bouton **</>** alterne entre la vue normale modifiable et le code Markdown. Changer de vue ne modifie pas le texte. Agrandissez l’éditeur pour une vue plus grande ; appuyez sur **Échap** ou réduisez l’éditeur pour revenir au formulaire. Dans le code Markdown, **Ctrl/Cmd + ]** indente les lignes sélectionnées et **Ctrl/Cmd + [** retire l’indentation. Les modifications sont enregistrées automatiquement après une courte pause. **Fermer** enregistre les modifications en attente avant de quitter. Si un champ obligatoire est incomplet ou si l’enregistrement échoue, le formulaire reste ouvert et affiche le problème. Les brouillons de compétences suivent le même fonctionnement ; les enregistrements successifs mettent à jour la même compétence.

Les affectations d’une compétence sont enregistrées automatiquement lorsqu’un sélecteur change. À l’ouverture du formulaire, les agents et les automatisations qui utilisent déjà cette compétence ou sa version originale sont sélectionnés. Les compétences obligatoires et celles encore nécessaires à d’autres automatisations sont conservées. Le formulaire d’affectation s’ouvre dans la fiche de la compétence sélectionnée, avec son nom et sa version visibles. Un seul formulaire d’affectation est ouvert à la fois ; Fermer le referme. La configuration affiche une seule personnalisation actuelle par compétence originale, choisie selon la modification la plus récente du paquet. Les modifications sont enregistrées dans le même paquet ; créer une seconde personnalisation de la même source renvoie un conflit au lieu de la dupliquer. Restaurer l’original demande confirmation avant de remplacer instructions, outils et activation ; la même compétence personnelle est mise à jour et ses affectations sont conservées.

## Résultat attendu {#expected-result}

L’agent répond avec le contexte prévu et indique les capacités disponibles.

## En cas de problème {#troubleshooting}

Un modèle peut converser sans prendre en charge les outils. En cas d’erreur d’authentification, de délai ou d’outil absent, vérifiez séparément fournisseur, modèle et compétences. Vérifiez le résultat d’une action avant de la considérer comme réalisée.

## Guides associés {#related-guides}

- [Interroger les sources sélectionnées](notebooks.md)
- [Questions fréquentes et récupération](troubleshooting.md)

## Profils des plugins

Chaque plugin d’IA possède un profil modifiable dans la même liste que les profils personnels, avec le nom du plugin qui l’utilise. Vous pouvez modifier son modèle, ses instructions, ses sources et ses compétences, et le choisir explicitement comme principal. Cela ne change pas le profil utilisé par les actions du plugin. Désactiver le plugin suspend son bot et conserve la configuration. Si le modèle ou une compétence manque, l’action le signale sans remplacer le profil. Les exécutions en cours gardent la configuration avec laquelle elles ont commencé.

## Assistant principal et participation à l’équipe

Tous les bots, y compris les membres de l’équipe, continuent à effectuer leurs tâches avec leur propre modèle, leurs instructions et leurs compétences. Demander de l’aide est facultatif : l’assistant le choisit seulement si une autre spécialité ou un travail coordonné est nécessaire. Il décide avant d’exécuter des outils ; les missions reçues ne peuvent pas être déléguées à nouveau.

L’assistant principal appartient à la même liste et coordonne l’équipe lorsque d’autres bots reçoivent des tâches. Sur la fiche de chaque autre bot, **Participation à l’équipe** propose :

- **Travaille de façon autonome** : Effectue ses tâches avec son propre modèle et ses compétences. Il ne reçoit pas de missions de l’équipe et ne lui demande pas d’aide.
- **Reçoit des tâches de l’équipe** : Continue à effectuer ses tâches avec son propre modèle. Il peut aussi recevoir des missions du principal, mais ne demande pas d’aide à l’équipe.
- **Demande de l’aide à l’équipe** : Effectue ses tâches avec son propre modèle et ne demande de l’aide que si une autre spécialité est nécessaire. Il ne reçoit pas de missions du principal.
- **Reçoit des tâches et demande de l’aide** : Effectue ses tâches avec son propre modèle. Il reçoit aussi des missions du principal et peut demander de l’aide si une autre spécialité est nécessaire ; il ne délègue pas automatiquement tout le travail.

L’icône de configuration de chaque fiche ouvre le modèle, les instructions, les sources et les compétences. Les spécialités se choisissent dans la même fiche. Les attributions par tâche et les spécialistes temporaires sont facultatifs, dans une section avancée repliée.

Les sélections complètes sont enregistrées automatiquement. Si des destinataires ou des permissions temporaires manquent, le formulaire indique ce qui reste en attente ; sa fermeture conserve la dernière configuration complète. Retirer le dernier destinataire désactive la collaboration. Il n’est pas nécessaire d’activer les mêmes bots ailleurs. Seule la compétence de coordination est ajoutée au principal lorsque la collaboration est active.

Ouvrez un type de tâche et sélectionnez un ou plusieurs bots. Sans sélection, le principal la coordonne ; sans destinataires, des indications expliquent comment en ajouter. Les modèles et compétences temporaires permettent également plusieurs sélections, avec un interrupteur par option. Ce sont des permissions disponibles, et non des tâches exécutées toutes à la fois.

Lorsque le texte ou un interrupteur a le focus, les flèches haut/bas et les touches de page font défiler le formulaire. Les champs de texte et les listes conservent leurs touches d’édition et de sélection.



Les attributions avancées et les routes directes ne s’appliquent qu’après une demande d’aide. Les routes directes associent des opérations connues à des listes d’exécutants. Le serveur vérifie disponibilité, compétences, contexte et limites avant de comparer le coût estimé de la mission. Un coût inconnu reste inconnu. Une route directe évite l’appel à l’assistant principal ; une demande ambiguë nécessite un plan. Un résultat valide est livré sans révision automatique de l’assistant principal.

Les limites sont quatre missions, deux spécialistes temporaires et deux tâches de lecture simultanées. Les modifications s’exécutent successivement. Les opérations structurées disposent de huit appels au total dans le budget initial. Une seule correction de format est permise, sans répétition des actions. Seul le travail de lecture peut être replanifié automatiquement ; les effets incertains exigent une vérification.

Autorisez explicitement les modèles et compétences des agents temporaires. Leur création n’installe aucun outil et n’élargit aucun droit. Ils appartiennent à une exécution et ne figurent pas dans le sélecteur général. Dans **Activité**, examinez la proposition, modifiez les instructions réutilisables, puis acceptez ou refusez. L’acceptation crée un profil personnel sans historique ni mémoires, que vous pourrez ajouter à l’équipe. Le refus empêche la répétition de la même proposition.

Les confirmations identifient l’exécutant sans autoriser d’autres actions. La reprise réutilise le plan enregistré et les missions terminées. Les actions échouées ou aux effets incertains ne sont jamais répétées automatiquement. L’annulation empêche les descendants de continuer. Les données privées suivent la rétention des exécutions.

Le catalogue présente des évaluations indépendantes pour Directeur, Polyvalent, Documentaliste, Expert, Administratif et Ouvrier, avec éléments probants et tests manquants. La compatibilité déclarée ne certifie ni le catalan, ni les citations, ni l’économie de délégation. Les anciennes étiquettes restent compatibles mais ne choisissent pas les exécutants. Les tests automatiques utilisent des fournisseurs simulés, sans évaluation payante. Comparez qualité et coût total sur les mêmes cas avant d’élargir les routes.

Le champ facultatif **Commande** de chaque agent permet de définir une commande unique, comme `/traductor`. Écrivez `/traductor Traduis ce texte…` dans le chat pour envoyer ce tour directement à cet agent, avec son modèle, ses instructions et ses compétences, sans consulter l’assistant principal. La sélection habituelle de la conversation reste inchangée. Les commandes ne modifient pas les permissions et ne permettent pas d’appeler un agent désactivé. Après `/`, utilisez de 1 à 32 lettres sans accent, chiffres, tirets ou traits de soulignement, en commençant par une lettre ; la casse est ignorée.

## Évaluation des rôles et données manquantes

Orientation, pas certification : au moins 60/100 et 60 % de données, avec des exigences par rôle. Intelligence, code et capacités agentiques sont classés dans le catalogue actuel ; contexte et vitesse saturent à 200 000 tokens et 100 tokens/s. Latence et prix utilisent 1/(1+x/2). Le prix suppose 4 tokens d’entrée pour 1 de sortie ; ce n’est pas le coût réel d’une tâche. Le contexte ne prouve ni la fidélité des citations, ni le catalan, ni la fiabilité.

Utilisez Actualiser pour consulter les données disponibles (le cache du fournisseur reste applicable). Si une valeur manque, la source doit la publier ; elle ne se déduit ni du nom ni de la taille du modèle.


Comment vérifier : exécuter les mêmes cas synthétiques avec un généraliste, un directeur toujours actif et un directeur avec routage direct ; vérifier plans, exécutants, appels évitables et coût total.

Comment vérifier : tester des instructions en catalan et des outils simulés ; évaluer langue, respect des instructions et résultat de chaque action.

Comment vérifier : interroger des documents synthétiques avec passages et réponses connus ; vérifier récupération, citations exactes et couverture des sources.

Comment vérifier : résoudre des problèmes à réponse connue et des cas insuffisamment documentés ; mesurer exactitude, recoupement et reconnaissance de l’incertitude.

Comment vérifier : extraire des données synthétiques avec résultats attendus, valider contenu et schéma, puis exécuter des procédures aux étapes vérifiables.

Comment vérifier : répéter des transformations à résultat connu, relever exactitude, durée et tokens ; calculer le coût par tâche correcte, tentatives incluses.

La colonne Usage affiche uniquement le rôle sélectionné et son pourcentage ; le tri compare ce score, avec les valeurs inconnues à la fin. Coût estimé et Fournisseur suivent. Sans filtre de rôle, Usage trie selon le meilleur score disponible de chaque modèle.

Le panneau Tests des rôles et stratégies de la comparaison permet de choisir des agents activés et d’autoriser chaque exécution avec consommation réelle. Les tests par rôle utilisent 2–3 cas synthétiques avec des validateurs déterministes. La comparaison applique les trois mêmes cas à Polyvalent, Directeur toujours actif et Directeur avec routage direct ; elle inclut deux routes connues et une résolution de sources contradictoires avec dépendances. Elle compare réussite, appels, interventions évitables et coût ; les données absentes ne deviennent pas zéro. Ce laboratoire isolé réutilise la sélection économique sans outils métier. Il ne certifie pas entièrement la langue, la récupération en contexte long ni l’utilisation réelle d’outils.

Chaque résultat conserve version, date, modèle, fournisseur et contrôles par cas dans le périmètre de l’utilisateur et du Vault d’origine. Les évaluations disposant de données suffisantes combinent 50% catalogue et 50% tests synthétiques ; les limites générales restent visibles. Actualisez la comparaison après consultation des résultats. La limite globale est de 24 appels, chacun limité à 512 tokens de sortie ; la comparaison des trois stratégies effectue 17 appels. Ces tests conservent uniquement des traces de métadonnées. Annulez depuis Activité. Les modèles attribués ne changent pas.

Les propositions de conservation affichent les compétences réutilisables, les différences de couverture et de modèle avec les agents existants et les exécutions terminées. Terminer ne certifie pas tous les critères particuliers. Les instructions permanentes proviennent d’un modèle de compétences enregistrées sans copier la mission ; l’utilisateur peut les réviser. L’acceptation permet aussi d’ajouter le profil personnel à l’équipe. Une configuration équivalente existante évite une proposition en double. Le rejet empêche de répéter la même proposition.

Pour résoudre une taille inconnue, sélectionnez **À vérifier** dans la colonne Paramètres. **Consulter la source officielle** recherche une correspondance de version exacte dans les fiches des fabricants pris en charge. Si la source est indisponible ou sans correspondance, la donnée reste à vérifier. Vous pouvez aussi enregistrer les milliards totaux et actifs, ou une absence de publication vérifiée, avec une source HTTPS et la confirmation explicite du modèle exact. Les données vérifiées manuellement conservent leur provenance et leur date ; ne pas trouver de chiffre ne prouve pas son absence de publication. Le serveur ne consulte pas les liens saisis.

## Profil LLM recommandé et plugins désactivés

Chaque fiche affiche un profil LLM recommandé et sa raison. Le principal recommande Directeur ; les autres bots tiennent compte des tâches du plugin, des compétences attribuées —y compris les copies personnalisées—, des spécialités et des affectations de l’équipe. Si plusieurs exigences s’appliquent, la plus élevée est affichée. Par exemple, la recherche bibliographique recommande Documentaliste, le courrier Administratif et les analyses complexes Expert. Pour les tâches inconnues, l’orientation est Polyvalent. Consultez les preuves de ce profil dans le comparatif avant de choisir un modèle. La recommandation ne change pas le modèle attribué et ne certifie pas sa qualité.

Désactiver un plugin rend son bot inactif et le masque dans la liste et les sélecteurs. Son modèle, ses instructions, ses sources et ses compétences sont conservés pour sa réactivation. Le bot est retiré des destinataires et affectations actifs de l’équipe ; la collaboration est désactivée s’il était le dernier destinataire ou le principal. S’il était le principal, choisissez-en un autre ou réactivez le plugin. Les conversations existantes conservent leur profil et signalent son indisponibilité au lieu d’en changer automatiquement.

## Niveau de raisonnement

Si le modèle OpenRouter permet de choisir l’effort de raisonnement, ses réglages affichent **Niveau de raisonnement** avec les choix compatibles. **Valeur par défaut du modèle** conserve le comportement du fournisseur ; **Moyen** demande explicitement ce niveau. Un effort accru peut augmenter le délai et la consommation de tokens. Le réglage est enregistré automatiquement, concerne uniquement cet assistant et s’applique aussi aux outils. Changer de modèle rétablit la valeur par défaut du nouveau modèle.
