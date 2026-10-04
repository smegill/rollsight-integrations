# Dés physiques RollSight

Dans Foundry, ouvrez les paramètres de RollSight et copiez votre code de joueur. Dans Paramètres du jeu → Général → Dés, choisissez les dés physiques RollSight comme méthode par défaut et enregistrez. Vérifiez les réglages propres à chaque dé. Lancez le jet dans Foundry et attendez l’invite RollSight avant de lancer vos dés physiques.

## Lier ce monde (MJ)

Le MJ doit lier ce monde avant que vous puissiez actualiser votre code joueur.

Copiez ce code personnel dans l’application de bureau. Choisissez RollSight ou Manuel dans la configuration des dés de Foundry, puis lancez un jet dans Foundry.

Lancez votre jet dans Foundry, puis envoyez les dés physiques depuis l’application de bureau. Les demandes distantes de jet vers le bureau ne sont pas prises en charge.

## Accepter les dés pour les jets manuels

Remplit aussi les demandes manuelles natives. Foundry conserve ses commandes et calcule les modificateurs.

Les nouvelles demandes reçoivent automatiquement les dés. Si plusieurs sont ouvertes, la plus récente est prioritaire ; les précédentes reprennent à sa fermeture.

## Recevoir les dés RollSight

Désactivez pour quitter cette session. Les jets en attente restent disponibles dans Foundry pour une saisie manuelle.

## Utiliser l’extension du navigateur

Recevez les résultats locaux via l’extension RollSight. La réception cloud est désactivée dans ce mode.

Ce navigateur ne peut pas coordonner les onglets. Utilisez un seul onglet Foundry par joueur RollSight.

## Publier les dés si aucun jet n’attend

Publie les dés physiques simples selon la visibilité actuelle du chat. Lancez d’abord l’initiative, les attaques et l’avantage dans Foundry.

## Ralenti RollSight

Ouvrez le ralenti ; sélectionnez l’image pour l’afficher en taille réelle.

## Actualiser la connexion

RollSight n’a pas pu se connecter. Vérifiez le lien du monde et actualisez votre code joueur dans les paramètres du module.

Un autre onglet reçoit les dés RollSight pour ce joueur. Fermez-le, puis actualisez cette connexion.

Les dés ont été refusés. Envoyez des entiers dans la plage de chaque dé.

RollSight n’a pas pu appliquer cet envoi. Vérifiez le jet en attente avant de renvoyer.

## Scènes OBS automatiques aux tours de combat

Utilisez le module Foundry RollSight 1.1.91 ou ultérieur et activez OBS Utils dans le même monde. Ces commandes sont distinctes des incrustations de replays.

Dans OBS, créez vos sources navigateur Foundry avec l’adresse du serveur fournie par le MJ : /game pour la vue de jeu et /stream pour l’utilisateur Stream. Connectez la source /stream avec l’utilisateur que vous choisirez comme opérateur OBS.

Pour chaque source navigateur Foundry, ouvrez Propriétés et réglez les permissions de la page sur accès avancé ou complet. Les permissions de /game et /stream sont séparées. Actualisez chaque source après modification. Les liens de replay seuls n’ont pas besoin de contrôler les scènes.

Gardez le contrôleur /stream chargé lors des changements de scène. Désactivez l’arrêt de la source lorsqu’elle n’est pas visible et réutilisez la même source dans vos scènes. Cette connexion par source navigateur ne nécessite ni WebSocket ni accès API d’OBS Utils.

En tant que MJ, ouvrez Paramètres du jeu → RollSight → Configurer les scènes OBS par tour. Choisissez l’utilisateur Stream comme opérateur OBS, puis actualisez les scènes OBS. Choisissez chaque acteur et sa scène OBS dans les listes. Vous pouvez aussi choisir des scènes pour les PNJ sans association et la fin du combat.

Enregistrez les scènes OBS, activez le changement de scène OBS aux tours de combat et laissez la pause du changement automatique décochée. Les tours de joueurs sans association conservent la scène actuelle.

Les associations, l’opérateur et les réglages d’activation et de pause restent enregistrés dans ce monde Foundry. Stream peut se connecter après le démarrage du serveur. À la connexion, le tour actuel est vérifié. La source doit rester connectée pour le changement automatique.

Avant de diffuser, avancez d’un tour dans un combat de test et vérifiez la scène, puis testez la pause et la reprise. Si des scènes manquent, vérifiez les permissions de /stream, actualisez son cache navigateur puis la liste. Après avoir renommé des scènes OBS, sélectionnez les nouveaux noms et enregistrez.

Le chat Foundry /stream masque les commandes et animations de replay RollSight, quel que soit le réglage d’ouverture automatique enregistré. Les résultats restent visibles. Les URL séparées d’incrustation OBS affichent toujours les replays, et les joueurs Foundry conservent leur préférence.
