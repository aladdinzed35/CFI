# Seed — `prisma/seed.ts`

Jeu de données de démonstration du CFI (spécification §23). Il est **idempotent** :
chaque ligne est écrite par `upsert` sur sa clé naturelle, donc le script peut être
relancé autant de fois que nécessaire sans créer de doublon.

```bash
npm run db:seed                  # écrit / met à jour
npx tsx prisma/seed.ts --reset   # vide toutes les tables, puis écrit
npx tsx prisma/seed.ts --help
```

Le script lit `DATABASE_URL` dans l'environnement, ou à défaut dans `.env` puis
`.env.local`. Il s'arrête immédiatement si la variable est absente.

---

## ⚠️ Ne jamais pointer ce script vers la production

Ce seed écrit des comptes dont **les mots de passe sont publiés ci-dessous** et les
affiche en clair dans le terminal à la fin de chaque exécution. Un seed lancé par
erreur sur la base de production y créerait des comptes administrateurs dont le mot
de passe est connu de tout le monde.

Deux garde-fous existent, et aucun des deux ne remplace la vigilance :

- `--reset` **refuse de s'exécuter** quand `NODE_ENV=production` ;
- les lignes `SiteSetting` et `FeatureFlag` déjà présentes ne sont **jamais**
  écrasées (voir « Ce qui est préservé » plus bas), pour qu'un second passage ne
  puisse pas remettre le RIB fictif par-dessus le vrai.

Avant chaque exécution, vérifiez la valeur de `DATABASE_URL`.

---

## Ce que le seed crée

| Groupe | Contenu | Clé naturelle |
|---|---|---|
| **Réglages du site** | Toutes les entrées `SiteSetting` du §3 : identité de marque, taglines dans les quatre langues, contact, **coordonnées bancaires fictives**, paramètres de paiement, `locales = ["fr","ar","en","es"]`, devise, assistant IA, réseaux sociaux, domaine SEO | `key` |
| **Feature flags** | 8 bascules du §17.12 : avis, assistant IA, parcours, blog, sessions live, flashcards, classement, parrainage | `key` |
| **Catégories** | Les 6 catégories du §23, chacune traduite en `fr`, `ar`, `en`, `es`, avec une icône lucide et une couleur prise dans les tokens du design system | `slug` |
| **Comptes** | 1 `SUPER_ADMIN`, 1 `ADMIN`, 2 `INSTRUCTOR`, 12 étudiants — noms marocains, numéros `+212` normalisés par `parsePhone`, empreintes **argon2id** calculées à l'exécution, `referralCode` unique | `email` |
| **Badges** | 12 badges avec un critère lisible par machine (`{ metric, comparator, threshold }`), traduits en quatre langues | `code` |
| **FAQ** | 10 questions réparties en inscription, paiement, formations, certificat et technique, traduites en quatre langues | `id` |
| **Témoignages** | 6 témoignages traduits en quatre langues | `id` |
| **Pages légales** | `cgu`, `confidentialite`, `cookies` — contenu Markdown complet en `fr`, `ar`, `en`, `es` | `slug` |

`FaqItem` et `Testimonial` n'ont pas de colonne unique en dehors de la clé primaire :
leurs `id` sont donc écrits à la main (`faq-…`, `testimonial-…`) et servent de clé
naturelle. Ne les renommez pas, sous peine de créer des doublons au prochain passage.

### Répartition des comptes étudiants

Exactement celle demandée par le §23, plus le seul statut restant du modèle :

| Statut | Nombre |
|---|---|
| `ACTIVE` | 6 |
| `PENDING_APPROVAL` | 3 (la file de validation du §17.2 n'est jamais vide) |
| `PENDING_EMAIL` | 1 |
| `REJECTED` | 1 (avec un motif de refus rédigé) |
| `SUSPENDED` | 1 (avec une date de fin de suspension) |

---

## Ce que le seed ne crée pas — et pourquoi

Le §23 décrit aussi des cours, des demandes d'inscription, des discussions, des quiz
et un corpus IA indexé. Ces données dépendent de code qui n'existe pas encore ; les
insérer maintenant reviendrait à publier un catalogue mensonger.

Chaque groupe a donc dans `seed.ts` une fonction dédiée qui n'écrit rien et annonce
son jalon (§25) :

| Fonction | Contenu | Jalon |
|---|---|---|
| `seedCatalog` | Cours, modules, leçons, ressources, parcours | M2 |
| `seedEditorialContent` | Blog, annonces, sessions live | M2 / M8 |
| `seedEnrollmentRequests` | Demandes d'inscription, paiements, factures | M3 |
| `seedLearningActivity` | Inscriptions, progression, notes, signets | M4 |
| `seedCommunity` | Discussions, réponses, avis | M4 |
| `seedAssessments` | Quiz, devoirs, certificats | M5 |
| `seedAiCorpus` | Conversations, réponses curées, base de connaissance | M7 |
| `seedGamificationActivity` | XP, badges attribués, séries, flashcards | M8 |

Le catalogue **de référence** des badges, lui, est écrit dès maintenant : c'est une
donnée de configuration, pas une trace d'activité.

---

## Comptes de démonstration

Le script réaffiche ce tableau à la fin de chaque exécution.

| E-mail | Mot de passe | Rôle | Statut |
|---|---|---|---|
| `admin@cfi.ma` | `Cfi!SuperAdmin2026` | SUPER_ADMIN | ACTIVE |
| `gestion@cfi.ma` | `Cfi!Gestion2026` | ADMIN | ACTIVE |
| `karim.tazi@cfi.ma` | `Cfi!Formateur2026` | INSTRUCTOR | ACTIVE |
| `nadia.ouazzani@cfi.ma` | `Cfi!Formateur2026` | INSTRUCTOR | ACTIVE |
| `imane.chraibi@gmail.com` | `Cfi!Etudiant2026` | STUDENT | ACTIVE |
| `mehdi.berrada@gmail.com` | `Cfi!Etudiant2026` | STUDENT | ACTIVE |
| `sara.elfassi@outlook.com` | `Cfi!Etudiant2026` | STUDENT | ACTIVE (locale `ar`) |
| `anas.idrissi@gmail.com` | `Cfi!Etudiant2026` | STUDENT | ACTIVE (locale `es`) |
| `hajar.naciri@gmail.com` | `Cfi!Etudiant2026` | STUDENT | ACTIVE (locale `ar`) |
| `othmane.sbai@gmail.com` | `Cfi!Etudiant2026` | STUDENT | ACTIVE |
| `yasmine.kadiri@gmail.com` | `Cfi!Etudiant2026` | STUDENT | PENDING_APPROVAL (locale `en`) |
| `reda.alaoui@gmail.com` | `Cfi!Etudiant2026` | STUDENT | PENDING_APPROVAL |
| `fatimazahra.belkacem@gmail.com` | `Cfi!Etudiant2026` | STUDENT | PENDING_APPROVAL (locale `ar`) |
| `bilal.moutaouakil@gmail.com` | `Cfi!Etudiant2026` | STUDENT | PENDING_EMAIL |
| `soukaina.rhalmi@gmail.com` | `Cfi!Etudiant2026` | STUDENT | REJECTED |
| `hamza.lemseffer@gmail.com` | `Cfi!Etudiant2026` | STUDENT | SUSPENDED |

Les quatre locales sont représentées parmi les étudiants, de façon à pouvoir tester
le RTL et les e-mails localisés sans créer de compte à la main.

Les empreintes sont calculées à l'exécution avec `@node-rs/argon2` en **argon2id**
(`memoryCost` 19 456 Kio, `timeCost` 2, `parallelism` 1, conformément au §20). Aucune
empreinte n'est écrite en dur dans le dépôt. Le script vérifie que le condensat
commence bien par `$argon2id$` et s'interrompt sinon.

> Relancer le seed **réinitialise le mot de passe** des comptes de démonstration à la
> valeur ci-dessus : le tableau affiché à la fin doit toujours dire la vérité.

---

## Coordonnées bancaires

Les cinq réglages `bank.*` sont des **valeurs fictives**, telles que l'exige le §23 :

```
RIB: 000 000 0000000000000000 00 — À REMPLACER
```

`bank.holder`, `bank.name`, `bank.iban` et `bank.swift` portent la même mention
`À REMPLACER`. Elles doivent être remplacées par le propriétaire depuis
`/admin/reglages` → *Coordonnées bancaires* avant la première demande d'inscription
réelle : ce sont ces valeurs qui s'affichent dans la fenêtre de virement.

---

## Ce qui est préservé lors d'un second passage

| Donnée | Comportement |
|---|---|
| `SiteSetting.value` | **Jamais écrasé** si la ligne existe. Seuls `group` et `isSecret` sont rafraîchis. |
| `FeatureFlag.isEnabled`, `rollout` | **Jamais écrasés** si la ligne existe — ce sont des bascules d'exploitation. Seule la note explicative est rafraîchie. |
| `User.createdAt`, `User.referralCode` | Jamais modifiés : un compte déjà vu dans la file de validation ne change pas de place ni de code de parrainage. |
| `User.passwordHash` | Réécrit à chaque passage (voir ci-dessus). |
| Tout le reste | Rafraîchi à partir du contenu de `seed.ts`, qui fait autorité. |

Pour repartir vraiment de zéro — y compris sur les réglages — utilisez `--reset`.

---

## `--reset`

`--reset` vide **toutes** les tables, enfants avant parents, puis relance l'écriture.

- Refuse de s'exécuter quand `NODE_ENV=production`.
- Utilise un `deleteMany` par modèle plutôt qu'un `TRUNCATE` : MySQL refuse de
  tronquer une table référencée par une clé étrangère, et désactiver
  `FOREIGN_KEY_CHECKS` masquerait une erreur d'ordre. Une erreur dans la liste se
  manifeste donc par une violation de contrainte, jamais par des lignes orphelines.
- Affiche le nombre de lignes supprimées par modèle, puis le total.

---

## Sortie du script

Chaque exécution affiche, dans l'ordre : les suppressions éventuelles, le nombre
d'empreintes calculées, une ligne par groupe écrit (créés / mis à jour / préservés),
la liste des groupes reportés avec leur jalon, un tableau récapitulatif, puis le
tableau des comptes de démonstration.

En cas d'échec, la trace est écrite sur `stderr` et le code de sortie passe à `1`.

---

## Ajouter des données

1. Ajoutez l'entrée dans le tableau de données correspondant, en haut de sa section.
2. Vérifiez que la clé naturelle est unique — c'est elle qui garantit l'idempotence.
3. Rédigez les quatre traductions. Le `fr` est la langue source (§10.2) ; une chaîne
   `ar`, `en` ou `es` manquante n'est pas acceptable dans ce jeu de données, il sert
   précisément à tester les quatre locales.
4. `npx tsc --noEmit` puis `npx eslint prisma/seed.ts` doivent rester verts.
5. Relancez le seed deux fois de suite : la seconde exécution ne doit rien créer.
