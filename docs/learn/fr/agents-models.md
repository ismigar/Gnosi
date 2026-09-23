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

### Choisir un modèle selon la tâche

Les paramètres de l’assistant proposent trois options :

- **Modèle fixe :** utilise toujours le modèle principal.
- **Modèles de secours :** conserve le modèle principal et autorise des alternatives en cas d’erreur temporaire ou d’indisponibilité.
- **Sélection automatique :** choisit un modèle pour chaque demande selon la tâche, les capacités, la disponibilité et le budget.

Activez explicitement les modèles alternatifs autorisés. Ils doivent être activés et compatibles ; un assistant local ne peut utiliser que des alternatives locales. Les instructions, la mémoire et les compétences restent celles du même assistant.

La sélection automatique peut utiliser le sélecteur interne de Gnosi ou **Jev (TypeSafe)**. Pour activer Jev, enregistrez votre clé TypeSafe dans le champ correspondant. Lorsqu’un choix entre modèles est nécessaire, le texte de la demande actuelle est envoyé à TypeSafe ; la mémoire et les sources jointes ne sont pas ajoutées automatiquement. Les requêtes sont comptabilisées dans les dépenses. En l’absence de clé, en cas d’erreur du service ou de décision incertaine, Gnosi utilise sa sélection interne. Les détails de la réponse indiquent le sélecteur utilisé.

## Résultat attendu {#expected-result}

L’agent répond avec le contexte prévu et indique les capacités disponibles.

## En cas de problème {#troubleshooting}

Un modèle peut converser sans prendre en charge les outils. En cas d’erreur d’authentification, de délai ou d’outil absent, vérifiez séparément fournisseur, modèle et compétences. Vérifiez le résultat d’une action avant de la considérer comme réalisée.

## Guides associés {#related-guides}

- [Interroger les sources sélectionnées](notebooks.md)
- [Questions fréquentes et récupération](troubleshooting.md)
