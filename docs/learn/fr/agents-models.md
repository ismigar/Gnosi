# Configurer l’assistant et ses profils

Le profil par défaut est utilisé pour les nouvelles conversations et les actions de l’application. Chaque conversation peut choisir un autre profil sans modifier les autres.

## Avant de commencer {#before-you-begin}

Activez la fonction IA. Un fournisseur cloud nécessite des identifiants valides et peut facturer l’usage ; un modèle local nécessite un service en cours d’exécution.

## Étapes {#steps}

1. Ouvrez les paramètres des modèles et fournisseurs et configurez un fournisseur compatible ou un service local. Enregistrez les identifiants dans les paramètres et sélectionnez un modèle disponible.

2. Ouvrez Paramètres → Plugins → IA → Assistant et choisissez **Configurer l’assistant**. Sélectionnez le modèle, nommez le profil et attribuez les compétences nécessaires.

3. Ouvrez la conversation et vérifiez l’agent et le modèle. Posez une question courte pour tester la connexion.

4. Ajoutez la page, la table ou le fichier précis comme contexte. Demandez une tâche limitée, par exemple « Résume les questions de cette page ».

5. Pour agir, le modèle doit prendre en charge les outils et les compétences requises doivent être disponibles. Examinez les demandes de confirmation avant de les accepter.

6. Contrôlez le résultat et ses sources. Enregistrez les conclusions utiles dans une page et distinguez votre interprétation du texte généré.

### Profils et conversations

Créez des profils dans **Profils supplémentaires (avancé)**. Dans le chat, ouvrez le sélecteur du nom de l’assistant et choisissez le **Profil de la conversation**. Ce changement s’applique aux demandes suivantes et conserve l’historique. Chaque conversation mémorise son profil. **Utiliser par défaut**, dans les paramètres, choisit le profil des nouvelles conversations, sans modifier les conversations existantes.

### Un seul modèle par profil

Chaque profil possède un seul LLM. Pour utiliser un autre modèle, choisissez un autre profil ou modifiez son modèle. Il n’y a ni sélection automatique ni modèle de remplacement en cas d’échec. Si un profil est supprimé ou son modèle indisponible, choisissez un autre profil dans le chat. Pour supprimer le profil par défaut, choisissez-en d’abord un autre. Désactivez le plugin IA pour désactiver l’IA.

## Résultat attendu {#expected-result}

L’agent répond avec le contexte prévu et indique les capacités disponibles.

## En cas de problème {#troubleshooting}

Un modèle peut converser sans prendre en charge les outils. En cas d’erreur d’authentification, de délai ou d’outil absent, vérifiez séparément fournisseur, modèle et compétences. Vérifiez le résultat d’une action avant de la considérer comme réalisée.

## Guides associés {#related-guides}

- [Interroger les sources sélectionnées](notebooks.md)
- [Questions fréquentes et récupération](troubleshooting.md)

## Profils des plugins

Chaque plugin d’IA déclare un profil modifiable et les compétences utilisées par ses actions. Paramètres → IA → Assistant présente les profils des plugins séparément des profils personnels. Vous pouvez modifier le modèle unique, les instructions, les sources et les compétences affectées. Les profils initiaux copient uniquement le modèle par défaut actuel ; les mises à jour préservent les modifications. Désactiver un plugin suspend son profil sans supprimer la configuration. Si le modèle ou une compétence nécessaire manque, l’action échoue explicitement sans utiliser le profil personnel. Les nouvelles actions autonomes et les compétences planifiées utilisent le profil du plugin ; les travaux commencés conservent leur instantané. Le profil choisi manuellement dans une conversation continue de gouverner cette conversation.

## Directeur et équipe de spécialistes

Dans **Configurer l’équipe**, choisissez le Directeur, les membres et leurs rôles. Un agent peut avoir plusieurs rôles. Indiquez quels profils de plugins peuvent déléguer ; leurs actions restent la propriété du plugin. La coordination prend effet après enregistrement. Seule la compétence de coordination est ajoutée au Directeur ; les modèles, instructions et autres compétences sont conservés.

Les routes directes associent des opérations connues à des listes d’exécutants. Le serveur vérifie disponibilité, compétences, contexte et limites avant de comparer le coût estimé de la mission. Un coût inconnu reste inconnu. Une route directe évite l’appel au Directeur ; une demande ambiguë nécessite un plan. Un résultat valide est livré sans révision automatique du Directeur.

Les limites sont quatre missions, deux spécialistes temporaires et deux tâches de lecture simultanées. Les modifications s’exécutent successivement. Les opérations structurées disposent de huit appels au total dans le budget initial. Une seule correction de format est permise, sans répétition des actions. Seul le travail de lecture peut être replanifié automatiquement ; les effets incertains exigent une vérification.

Autorisez explicitement les modèles et compétences des agents temporaires. Leur création n’installe aucun outil et n’élargit aucun droit. Ils appartiennent à une exécution et ne figurent pas dans le sélecteur général. Dans **Activité**, examinez la proposition, modifiez les instructions réutilisables, puis acceptez ou refusez. L’acceptation crée un profil personnel sans historique ni mémoires, que vous pourrez ajouter à l’équipe. Le refus empêche la répétition de la même proposition.

Les confirmations identifient l’exécutant sans autoriser d’autres actions. La reprise réutilise le plan enregistré et les missions terminées. Les actions échouées ou aux effets incertains ne sont jamais répétées automatiquement. L’annulation empêche les descendants de continuer. Les données privées suivent la rétention des exécutions.

Le catalogue présente des évaluations indépendantes pour Directeur, Polyvalent, Documentaliste, Expert, Administratif et Ouvrier, avec éléments probants et tests manquants. La compatibilité déclarée ne certifie ni le catalan, ni les citations, ni l’économie de délégation. Les anciennes étiquettes restent compatibles mais ne choisissent pas les exécutants. Les tests automatiques utilisent des fournisseurs simulés, sans évaluation payante. Comparez qualité et coût total sur les mêmes cas avant d’élargir les routes.

Le champ facultatif **Commande** de chaque agent permet de définir une commande unique, comme `/traductor`. Écrivez `/traductor Traduis ce texte…` dans le chat pour envoyer ce tour directement à cet agent, avec son modèle, ses instructions et ses compétences, sans consulter le Directeur. La sélection habituelle de la conversation reste inchangée. Les commandes ne modifient pas les permissions et ne permettent pas d’appeler un agent désactivé. Après `/`, utilisez de 1 à 32 lettres sans accent, chiffres, tirets ou traits de soulignement, en commençant par une lettre ; la casse est ignorée.

## Évaluation des rôles et données manquantes

Orientation, pas certification : au moins 60/100 et 60 % de données, avec des exigences par rôle. Intelligence, code et capacités agentiques sont classés dans le catalogue actuel ; contexte et vitesse saturent à 200 000 tokens et 100 tokens/s. Latence et prix utilisent 1/(1+x/2). Le prix suppose 4 tokens d’entrée pour 1 de sortie ; ce n’est pas le coût réel d’une tâche. Le contexte ne prouve ni la fidélité des citations, ni le catalan, ni la fiabilité.

Utilisez Actualiser pour consulter les données disponibles (le cache du fournisseur reste applicable). Si une valeur manque, la source doit la publier ; elle ne se déduit ni du nom ni de la taille du modèle.

Ce protocole spécifique n’est pas encore automatisé ni lié à l’évaluation. Les tests génériques ne le remplacent pas. Tout test avec consommation réelle nécessite une autorisation.

Comment vérifier : exécuter les mêmes cas synthétiques avec un généraliste, un directeur toujours actif et un directeur avec routage direct ; vérifier plans, exécutants, appels évitables et coût total.

Comment vérifier : tester des instructions en catalan et des outils simulés ; évaluer langue, respect des instructions et résultat de chaque action.

Comment vérifier : interroger des documents synthétiques avec passages et réponses connus ; vérifier récupération, citations exactes et couverture des sources.

Comment vérifier : résoudre des problèmes à réponse connue et des cas insuffisamment documentés ; mesurer exactitude, recoupement et reconnaissance de l’incertitude.

Comment vérifier : extraire des données synthétiques avec résultats attendus, valider contenu et schéma, puis exécuter des procédures aux étapes vérifiables.

Comment vérifier : répéter des transformations à résultat connu, relever exactitude, durée et tokens ; calculer le coût par tâche correcte, tentatives incluses.
