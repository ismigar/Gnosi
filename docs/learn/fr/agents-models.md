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
