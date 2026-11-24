# Surveillance des sites DE'KLIK

Un seul robot vérifie **tous** les sites en ligne, toutes les 20 minutes :

1. le site répond (3 essais avant de parler de panne) ;
2. le certificat HTTPS est valable encore au moins 14 jours ;
3. le nom de domaine est valable encore au moins 30 jours.

En cas de problème, le robot ouvre une **issue** « Panne : nom du site » : tu reçois **un** e-mail.
Quand tout revient, il la ferme tout seul : **un** e-mail de fin. Pas d'e-mail à chaque vérification.

## Ajouter ou retirer un site

La liste est publiée depuis le DE'KLIK Cockpit (Réglages › Intégrations › Surveillance des sites). Elle ne contient que des adresses, jamais de nom de client. On peut aussi modifier `sites.json` à la main (une ligne par site : `url`).
Pour un domaine différent de l'adresse, ajouter `"domaine": "exemple.fr"`.

## Vérifier à la main

Sur GitHub : onglet **Actions** › « Surveillance des sites » › **Run workflow**. Le tableau du résultat
s'affiche dans la page de l'exécution. En local : `node verifier.mjs` (aucune alerte créée).

## Pourquoi un dépôt public

Les minutes GitHub Actions sont gratuites et illimitées pour un dépôt public. Ce dépôt ne contient que des
adresses de sites déjà publics, aucun mot de passe, aucun code client. Les alertes (issues) sont visibles
publiquement : elles ne disent que « le site ne répond pas » ou « le certificat expire ».
