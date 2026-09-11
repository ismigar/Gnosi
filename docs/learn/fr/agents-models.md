# Configurer un agent et un modèle

Le modèle génère des réponses. L’agent combine modèle, instructions et compétences ; les outils permettent des actions précises.

## Avant de commencer {#before-you-begin}

Activez la fonction IA. Un fournisseur cloud nécessite des identifiants valides et peut facturer l’usage ; un modèle local nécessite un service en cours d’exécution.

## Étapes {#steps}

1. Ouvrez les paramètres des modèles et fournisseurs et configurez un fournisseur compatible ou un service local. Enregistrez les identifiants dans les paramètres et sélectionnez un modèle disponible.

2. Ouvrez les paramètres des agents, choisissez-en un ou créez-le, puis affectez-lui ce modèle. Sélectionnez les compétences nécessaires.

3. Ouvrez la conversation et vérifiez l’agent et le modèle. Posez une question courte pour tester la connexion.

4. Ajoutez la page, la table ou le fichier précis comme contexte. Demandez une tâche limitée, par exemple « Résume les questions de cette page ».

5. Pour agir, le modèle doit prendre en charge les outils et les compétences requises doivent être disponibles. Examinez les demandes de confirmation avant de les accepter.

6. Contrôlez le résultat et ses sources. Enregistrez les conclusions utiles dans une page et distinguez votre interprétation du texte généré.

## Résultat attendu {#expected-result}

L’agent répond avec le contexte prévu et indique les capacités disponibles.

## En cas de problème {#troubleshooting}

Un modèle peut converser sans prendre en charge les outils. En cas d’erreur d’authentification, de délai ou d’outil absent, vérifiez séparément fournisseur, modèle et compétences. Vérifiez le résultat d’une action avant de la considérer comme réalisée.

## Guides associés {#related-guides}

- [Interroger les sources sélectionnées](notebooks.md)
- [Questions fréquentes et récupération](troubleshooting.md)
