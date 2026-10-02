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

## Scènes de combat OBS facultatives

Dans Paramètres du jeu → RollSight, choisissez **Configurer les scènes OBS par tour**. Sélectionnez l’utilisateur Foundry connecté à la source navigateur OBS Utils `/stream`. Associez les acteurs aux noms exacts de scènes OBS existantes et, si vous le souhaitez, choisissez des scènes pour les tours de PNJ sans association et la fin du combat. Les tours de joueurs sans association conservent la scène actuelle. Enregistrez, puis activez **Changer de scène OBS à chaque tour de combat**. Utilisez **Mettre en pause le changement automatique de scène OBS** pour reprendre la main ; enregistrez pour reprendre au tour actuel.

Cette fonction utilise la connexion OBS Utils existante ou l’autorisation de contrôle des scènes de la source navigateur OBS. Aucun second mot de passe OBS ni mise à jour de l’application de bureau n’est nécessaire. Utilisez une seule source de contrôle et une URL Foundry sécurisée (HTTPS ou localhost). Laissez cette source chargée lorsque vous changez de scène OBS afin qu’elle continue à recevoir les tours. Si OBS Utils ne fournit pas l’API requise, mettez-le à jour avant d’activer cette fonction. Si une scène manque ou si la connexion OBS est interrompue, la scène actuelle reste affichée ; vérifiez l’orthographe du nom de scène et la connexion OBS Utils. Faites un essai dans votre collection de scènes avant toute diffusion en direct.
