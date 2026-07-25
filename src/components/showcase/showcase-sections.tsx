'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Award,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Command as CommandIcon,
  Download,
  Inbox,
  Landmark,
  LayoutGrid,
  LogOut,
  Mail,
  Minus,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  ColumnDef,
  PaginationState,
  Row,
  RowSelectionState,
  SortingState,
} from '@tanstack/react-table';

import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { defaultLocale, isLocale, type Locale } from '@/i18n/routing';
import { useDirection } from '@/hooks/use-direction';
import { useIsMobile } from '@/hooks/use-media-query';
import { useReducedMotionSafe } from '@/hooks/use-reduced-motion-safe';
import { useTheme } from '@/hooks/use-theme';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, Callout } from '@/components/ui/alert';
import { Avatar, type AvatarSize } from '@/components/ui/avatar';
import { Badge, type BadgeTone, type BadgeVariant } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Checkbox, CheckboxField } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  CommandPalette,
  CommandPaletteKey,
  type CommandPaletteItem,
} from '@/components/ui/command-palette';
import { CopyButton } from '@/components/ui/copy-button';
import { CourseCard } from '@/components/ui/course-card';
import { DataTable } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { FileDropzone, type FileDropzoneItem } from '@/components/ui/file-dropzone';
import { FormError, FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { LatticeGrid, type LatticeTile } from '@/components/ui/lattice-grid';
import { LocaleSwitcher } from '@/components/ui/locale-switcher';
import {
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@/components/ui/modal';
import { OtpInput } from '@/components/ui/otp-input';
import { Pagination } from '@/components/ui/pagination';
import { PasswordInput } from '@/components/ui/password-input';
import { PhoneInput } from '@/components/ui/phone-input';
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from '@/components/ui/popover';
import { PriceTag } from '@/components/ui/price-tag';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ProgressRing } from '@/components/ui/progress-ring';
import { RadioCard, RadioCardGroup } from '@/components/ui/radio-card';
import { Rating } from '@/components/ui/rating';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton, SkeletonCard, SkeletonTable, SkeletonText } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { StatCard } from '@/components/ui/stat-card';
import {
  StatusPill,
  type AccountStatus,
  type CourseStatus,
  type EnrollmentStatus,
  type JobStatus,
  type RequestStatus,
  type SubmissionStatus,
} from '@/components/ui/status-pill';
import { Stepper } from '@/components/ui/stepper';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Timeline } from '@/components/ui/timeline';
import { Toaster } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import { WhatsAppFab } from '@/components/ui/whatsapp-fab';

import { ShowcaseNav, type ShowcaseNavItem, type ShowcaseSectionId } from './showcase-nav';

/* ═══════════════════════════════════════════════════════════════════════════
   Copy with no key in the message catalogue yet
   ═══════════════════════════════════════════════════════════════════════════

   The catalogue in src/i18n/messages is owned elsewhere and must not be edited
   from this route, so every string the `showcase` and `common` namespaces do
   not already carry lives in this one clearly-named constant instead of being
   scattered as inline literals. It is written in French — the source language
   (§10.2) — and is listed in this milestone's manifest so a translator can lift
   the whole object into the `showcase` namespace in a single pass.            */

const SHOWCASE_COPY = {
  navLabel: 'Sections de la bibliothèque',
  applicationSection: 'Application',

  rules: {
    colors:
      '§11.2 — les couleurs sont des jetons, jamais des valeurs brutes ; §21 — 4,5:1 pour le texte, 3:1 pour les limites d’interface.',
    typography:
      '§11.2 — une seule échelle fluide ; §10.3 — l’arabe reçoit sa police et son interlignage propres.',
    buttons:
      '§21 — cible tactile ≥ 44 px, focus jamais supprimé, largeur stable pendant le chargement.',
    inputs: '§21 — chaque champ a un label lié, chaque erreur est annoncée et porte une icône.',
    feedback: '§11.5 — dire ce qui s’est passé, dire quoi faire ensuite ; la couleur n’est jamais seule.',
    overlays:
      '§11.4 — modale centrée dès 768 px, feuille de bas d’écran en dessous ; côtés logiques en RTL.',
    data: '§11.4 — un tableau devient une liste de cartes sur téléphone ; §9.2 — un statut, une couleur.',
    application: '§12.1 — bouton WhatsApp flottant ; §11.3 — la carte formation et le Lattice.',
    motion: '§11.2 — rien au-delà de 300 ms, aucune boucle infinie, mouvement réduit respecté.',
    rtl: '§10.3 — propriétés logiques uniquement ; les nombres et les codes restent en LTR.',
  },

  colors: {
    intro:
      'Chaque pastille peint le jeton sur son fond d’usage réel. Le rapport de contraste est mesuré dans le navigateur à partir des valeurs calculées du thème actif — changez de thème et les chiffres se recalculent.',
    measuring: 'Mesure en cours…',
    unavailable: 'Non mesurable ici',
    sample: 'Aa 123',
    passText: 'Conforme AA · 4,5:1',
    failText: 'Sous 4,5:1',
    passUi: 'Conforme AA · 3:1',
    failUi: 'Sous 3:1',
    decorative: 'Décoratif · hors 1.4.11',
    legend:
      'Seuils WCAG 2.2 AA : 4,5:1 pour le texte courant, 3:1 pour la limite d’un composant. Un séparateur purement décoratif n’a pas de seuil.',
    roles: {
      abyss: 'Fond de page, encre principale posée dessus',
      surface: 'Fond de carte, encre principale posée dessus',
      raised: 'Fond surélevé, encre principale posée dessus',
      hairline: 'Filet de séparation sur une carte',
      ink: 'Texte principal sur le fond de page',
      inkMuted: 'Texte secondaire sur une carte',
      strait: 'Action principale, progression, direct',
      deep: 'Fond de badge profond, encre principale dessus',
      brass: 'Argent et réussite, uniquement',
      danger: 'Erreur et action destructrice',
      warn: 'Avertissement',
      success: 'Succès',
      onAccent: 'Encre posée sur un aplat strait',
      onBrass: 'Encre posée sur un aplat brass',
      onDanger: 'Encre posée sur un aplat danger',
      straitWash: 'Fond d’état strait, posé sur une carte',
      brassWash: 'Fond d’état brass, posé sur une carte',
      dangerWash: 'Fond d’état danger, posé sur une carte',
      warnWash: 'Fond d’état warn, posé sur une carte',
      straitBorder: 'Bordure active et anneau de focus sur une carte',
      dangerBorder: 'Bordure d’un champ en erreur sur une carte',
    },
  },

  typography: {
    scaleTitle: 'Échelle typographique',
    scaleNote:
      'La même échelle fluide en latin et en arabe. La colonne arabe porte lang="ar" : elle hérite de la police arabe et de --leading-ar.',
    latinColumn: 'Latin',
    arabicColumn: 'العربية',
    latinSample: 'Le détroit relie deux mers.',
    arabicSample: 'المضيق يصل بين بحرين.',
    leadingTitle: 'Différence d’interlignage',
    leadingNote:
      'Mesuré sur le corps de texte, dans le navigateur : à taille de police identique, l’arabe respire davantage.',
    leadingLatin: 'Interlignage latin',
    leadingArabic: 'Interlignage arabe',
    familiesTitle: 'Familles et chiffres',
    familyDisplay: 'font-display — titres',
    familySans: 'font-sans — texte courant',
    familyMono: 'font-mono — chiffres, codes, références',
    familyArabic: 'font-arabic — arabe',
    numericNote:
      'L’attribut data-numeric passe en mono à chasse fixe : une colonne de montants s’aligne au pixel.',
  },

  buttons: {
    matrixTitle: 'Variantes × tailles',
    matrixNote:
      'Survolez, tabulez et maintenez pour voir les états vivants. Les deux interrupteurs appliquent « désactivé » et « chargement » à toute la matrice — la largeur ne bouge pas.',
    disabledSwitch: 'Désactivé',
    loadingSwitch: 'Chargement',
    sizeSm: 'sm · 44 px',
    sizeMd: 'md · 48 px',
    sizeLg: 'lg · 56 px',
    withIcons: 'Icônes et pleine largeur',
    iconStartLabel: 'Ajouter un module',
    iconEndLabel: 'Continuer',
    fullWidthLabel: 'Envoyer la demande',
    iconButtonsTitle: 'Boutons-icônes',
    iconButtonsNote:
      'La taille sm ne peint que 36 px mais reste tactile sur 44 px grâce à un ::after débordant. Le nom accessible est obligatoire.',
    search: 'Rechercher',
    settings: 'Préférences',
    remove: 'Supprimer la ligne',
    download: 'Télécharger le reçu',
    more: 'Plus d’actions',
  },

  inputs: {
    textTitle: 'Texte, zone de texte et sélection',
    textNote:
      'Trois colonnes : valide, en erreur, désactivé. Le message d’erreur porte une icône et role="alert" — jamais la couleur seule.',
    stateValid: 'Valide',
    stateInvalid: 'En erreur',
    stateDisabled: 'Désactivé',
    email: 'Adresse e-mail',
    emailHint: 'Utilisée uniquement pour votre compte.',
    emailError: 'Cette adresse ne contient pas d’arobase.',
    message: 'Votre message',
    messageError: 'Le message doit faire au moins vingt caractères.',
    remaining: (remaining: number): string => `${remaining} caractères restants`,
    scoreValue: (value: number): string => `${value} %`,
    otpDigit: (position: number, total: number): string => `Chiffre ${position} sur ${total}`,
    strengthLabels: ['Très faible', 'Faible', 'Moyen', 'Solide', 'Excellent'] as [
      string,
      string,
      string,
      string,
      string,
    ],
    dropzoneRemove: (name: string): string => `Retirer ${name}`,
    dropzoneProgress: (name: string): string => `Envoi de ${name}`,
    city: 'Ville',
    cityPlaceholder: 'Choisir une ville',
    cityError: 'Choisissez une ville pour continuer.',
    cityTanger: 'Tanger',
    cityCasablanca: 'Casablanca',
    cityRabat: 'Rabat',
    cityMarrakech: 'Marrakech',
    choiceTitle: 'Cases, interrupteurs et curseur',
    terms: 'J’accepte les conditions générales',
    termsHint: 'Consultables à tout moment depuis votre espace.',
    termsError: 'Vous devez accepter les conditions pour continuer.',
    newsletter: 'Recevoir les nouveautés',
    notifications: 'Notifications par e-mail',
    passingScore: 'Score de réussite',
    radioTitle: 'Cartes de choix',
    radioBank: 'Virement bancaire',
    radioBankDescription: 'Depuis votre banque, vers le compte du centre.',
    radioBankWarning: 'L’accès est activé sous 48 h ouvrées après vérification du justificatif.',
    radioCash: 'Versement en espèces',
    radioCashDescription: 'Au guichet, avec le reçu remis par la banque.',
    radioBadge: 'recommandé',
    specialTitle: 'Champs spécialisés',
    password: 'Mot de passe',
    showPassword: 'Afficher le mot de passe',
    hidePassword: 'Masquer le mot de passe',
    phone: 'Téléphone',
    phonePrefix: 'Indicatif du Maroc',
    otp: 'Code de vérification',
    otpHint: 'Les six chiffres reçus par SMS.',
    date: 'Date du virement',
    datePlaceholder: 'Choisir une date',
    previousMonth: 'Mois précédent',
    nextMonth: 'Mois suivant',
    clearDate: 'Effacer la date',
    category: 'Catégorie',
    categoryPlaceholder: 'Toutes les catégories',
    categorySearch: 'Rechercher une catégorie…',
    categoryEmpty: 'Aucune catégorie ne correspond.',
    categoryClear: 'Effacer la sélection',
    categoryMarketing: 'Marketing digital',
    categoryManagement: 'Management',
    categoryFinance: 'Finance d’entreprise',
    categoryLanguages: 'Langues professionnelles',
    dropzoneTitle: 'Dépôt de fichier',
    dropzoneHeadline: 'Déposez votre justificatif',
    dropzoneHint: 'JPG, PNG, WEBP ou PDF · 5 Mo maximum',
    dropzoneBrowse: 'Parcourir mes fichiers',
    dropzoneCamera: 'Prendre une photo',
    dropzoneInvalid: 'Un justificatif est obligatoire.',
    copyTitle: 'Copier une référence',
    ribLabel: 'RIB du centre',
    copyRib: 'Copier le RIB',
    copyFailed: 'Copie impossible',
  },

  feedback: {
    toastsTitle: 'Notifications transitoires',
    toastsNote:
      'Trois au maximum à l’écran ; la quatrième ferme la plus ancienne. Chaque notification porte une icône et une barre d’accent.',
    toastSuccess: 'Succès',
    toastError: 'Erreur',
    toastWarning: 'Avertissement',
    toastInfo: 'Information',
    toastSuccessTitle: 'Demande envoyée',
    toastSuccessBody: 'Vous recevrez une réponse sous 48 h ouvrées.',
    toastErrorTitle: 'Envoi impossible',
    toastErrorBody: 'Le justificatif dépasse 5 Mo. Compressez-le et réessayez.',
    toastWarningTitle: 'Session bientôt expirée',
    toastWarningBody: 'Enregistrez votre travail dans les cinq minutes.',
    toastInfoTitle: 'Nouvelle version disponible',
    toastInfoBody: 'Rechargez la page pour en profiter.',
    toastActionLabel: 'Annuler',
    toastActionAlt: 'Annuler depuis la liste des demandes',
    alertsTitle: 'Alertes et encarts',
    alertSuccessTitle: 'Paiement vérifié',
    alertSuccessBody: 'Votre accès à la formation est actif.',
    alertErrorTitle: 'Justificatif refusé',
    alertErrorBody: 'Le montant du virement ne correspond pas au prix de la formation.',
    alertWarningTitle: 'Délai de traitement',
    alertWarningBody: 'Les virements sont vérifiés sous 48 h ouvrées.',
    alertInfoTitle: 'Interface en bêta',
    alertInfoBody: 'La traduction arabe est en cours de relecture.',
    alertAction: 'Nous écrire',
    calloutTitle: 'Encart discret',
    calloutBody: 'Un filet d’accent et un fond teinté, pour du contexte à l’intérieur d’un texte.',
    skeletonsTitle: 'Squelettes de chargement',
    skeletonsNote:
      'Jamais un rond qui tourne : un squelette occupe exactement la boîte du contenu à venir, donc rien ne saute à l’arrivée des données.',
    skeletonLoading: 'Chargement des formations',
    emptyTitle: 'États vides',
    emptyHeadline: 'Aucune demande pour le moment',
    emptyBody: 'Vos demandes d’inscription apparaîtront ici dès la première envoyée.',
    emptyAction: 'Parcourir les formations',
  },

  overlays: {
    modalTitle: 'Modale et feuille de bas d’écran',
    modalShapeMobile: 'Largeur actuelle : sous 768 px — la modale s’affiche en feuille de bas d’écran.',
    modalShapeDesktop: 'Largeur actuelle : 768 px ou plus — la modale s’affiche centrée.',
    modalOpen: 'Ouvrir la modale',
    modalHeading: 'Confirmer votre demande',
    modalBody:
      'Le centre vérifie le justificatif de virement puis active votre accès. Le délai est de 48 h ouvrées.',
    modalConfirm: 'Envoyer la demande',
    drawerTitle: 'Tiroirs',
    drawerNote:
      'Les côtés sont logiques : « début » s’ouvre à gauche en français et à droite en arabe, sans une seule propriété physique.',
    drawerStart: 'Tiroir côté début',
    drawerEnd: 'Tiroir côté fin',
    drawerBottom: 'Tiroir bas',
    drawerHeading: 'Vérification du paiement',
    drawerBody: 'Le justificatif, le contexte de la demande et la décision, dans un seul panneau.',
    smallTitle: 'Popover, infobulle et menu',
    popoverTrigger: 'Ouvrir le popover',
    popoverHeading: 'Coordonnées bancaires',
    popoverBody: 'Le RIB complet du centre, copiable en un geste.',
    tooltipTrigger: 'Survolez-moi',
    tooltipBody: 'Une infobulle n’est jamais le seul endroit où vit une information.',
    menuTrigger: 'Menu du compte',
    menuAccount: 'Mon compte',
    menuSettings: 'Préférences',
    menuInvoices: 'Mes factures',
    menuLogout: 'Se déconnecter',
    menuGroup: 'Compte',
    paletteTitle: 'Palette de commandes',
    paletteNote: 'Ouvrable au clavier partout dans la page.',
    paletteOpen: 'Ouvrir la palette',
    paletteLabel: 'Rechercher une commande',
    palettePlaceholder: 'Aller à une section…',
    paletteEmpty: 'Aucune commande ne correspond.',
    paletteEmptyHint: 'Essayez « couleurs », « boutons » ou « données ».',
    paletteGroup: 'Sections',
    paletteFooterHint: 'pour ouvrir · ',
    paletteFooterEnter: 'pour aller à la section',
  },

  data: {
    badgesTitle: 'Badges',
    badgesNote: 'Trois variantes, sept tons. Le ton brass est réservé à l’argent et à la réussite.',
    statusTitle: 'Pastilles de statut',
    statusNote:
      'Une valeur d’énumération, un ton et une icône verrouillés ensemble : une demande refusée ne peut pas être peinte en vert.',
    statusAccount: 'Compte',
    statusRequest: 'Demande',
    statusEnrollment: 'Inscription',
    statusCourse: 'Formation',
    statusSubmission: 'Devoir',
    statusJob: 'Tâche',
    avatarsTitle: 'Avatars',
    progressTitle: 'Progression',
    progressBarLabel: 'Progression dans la formation',
    progressRingLabel: 'Formation terminée',
    stepperTitle: 'Étapes et chronologie',
    stepperLabel: 'Étapes de la demande',
    stepPrice: 'Prix et conditions',
    stepReceipt: 'Justificatif',
    stepConfirm: 'Confirmation',
    stepPriceHint: 'Le tarif et le délai',
    stepReceiptHint: 'Photo ou PDF',
    stepConfirmHint: 'Récapitulatif',
    stepDone: 'Terminé',
    stepCurrent: 'En cours',
    stepUpcoming: 'À venir',
    timelineLabel: 'Suivi de la demande',
    timelineSent: 'Demande envoyée',
    timelineReceived: 'Justificatif reçu',
    timelineReview: 'Vérification en cours',
    timelineInfo: 'Information demandée',
    timelineRejected: 'Demande refusée',
    timelineInfoBody: 'Le montant est illisible sur la photo. Renvoyez un cliché net.',
    timelineRejectedBody: 'Le virement ne correspond à aucune demande en attente.',
    timelineStateDone: 'Terminé',
    timelineStateCurrent: 'En cours',
    timelineStatePending: 'À venir',
    timelineStateWarning: 'Action requise',
    timelineStateError: 'Échec',
    statsTitle: 'Cartes de mesure',
    statStudents: 'Apprenants actifs',
    statRevenue: 'Encaissements du mois',
    statCompletion: 'Taux de complétion',
    statTrendUp: '+12 % sur un mois',
    statTrendDown: '−3 % sur un mois',
    statHint: 'Comparé au mois précédent',
    ratingTitle: 'Notes et prix',
    ratingLabel: 'Note de la formation',
    ratingReadonly: 'Lecture seule, remplissage fractionnaire',
    ratingInteractive: 'Interactif, opérable au clavier',
    ratingValueText: (value: string, max: number): string => `${value} sur ${max}`,
    priceCompareLabel: 'Prix initial',
    priceDiscountLabel: 'Réduction',
    priceFree: 'Gratuit',
    priceNote: 'paiement en deux fois possible',
    navigationTitle: 'Pagination, fil d’Ariane, onglets et accordéon',
    breadcrumbHome: 'Accueil',
    breadcrumbShowcase: 'Système de design',
    breadcrumbCurrent: 'Affichage des données',
    paginationNav: 'Pagination',
    paginationEllipsis: 'Pages omises',
    tabsLine: 'Souligné',
    tabsPill: 'Segmenté',
    tabsStrip: 'Bande défilante',
    tabContent: 'Contenu',
    tabProgram: 'Programme',
    tabNotes: 'Notes',
    tabTranscript: 'Transcription',
    tabDiscussion: 'Discussion',
    tabBodyContent: 'La leçon en cours, sa vidéo et ses ressources.',
    tabBodyProgram: 'Les modules de la formation, dans l’ordre.',
    tabBodyNotes: 'Vos notes personnelles, horodatées sur la vidéo.',
    accordionModule: (index: number): string => `Module ${index}`,
    accordionMeta: '4 leçons · 1 h 20',
    accordionBody: 'Le détail des leçons du module, avec leur durée et leur type.',
    tableTitle: 'Tableau de données',
    tableNote:
      'Sous 768 px le tableau est remplacé par la même liste de lignes en cartes : un administrateur valide un paiement depuis son téléphone.',
    tableCaption: 'Demandes d’inscription',
    tableColumns: 'Colonnes',
    tableSelectAll: 'Tout sélectionner sur cette page',
    tableSelectRow: 'Sélectionner la ligne',
    tableSelection: (count: number): string => `${count} ligne(s) sélectionnée(s)`,
    tableClearSelection: 'Effacer la sélection',
    tablePrevious: 'Page précédente',
    tableNext: 'Page suivante',
    tableSummary: (from: number, to: number, total: number): string => `${from}–${to} sur ${total}`,
    tableLoading: 'Chargement des résultats',
    tableEmpty: 'Aucune demande',
    tableEmptyHint: 'Les demandes envoyées apparaîtront ici.',
    tableError: 'Chargement impossible',
    tableRetry: 'Réessayer',
    tableApprove: 'Approuver',
    colStudent: 'Apprenant',
    colCourse: 'Formation',
    colAmount: 'Montant',
    colStatus: 'Statut',
    colDate: 'Reçue le',
  },

  application: {
    controlsTitle: 'Contrôles de la coque',
    controlsNote:
      'Le sélecteur de langue conserve le chemin et la requête ; le bouton de thème est nommé pour l’action qu’il effectue, pas pour l’état affiché.',
    localeLabel: 'Changer de langue',
    betaLabel: 'bêta',
    switchToLight: 'Passer au thème clair',
    switchToDark: 'Passer au thème sombre',
    lightEnabled: 'Thème clair activé',
    darkEnabled: 'Thème sombre activé',
    whatsappTitle: 'Bouton WhatsApp flottant',
    whatsappNote:
      'Apparaît après 400 px de défilement ou quatre secondes, pulse trois fois puis se tait, et s’efface dès qu’une modale s’ouvre. Le numéro ci-dessous est un numéro de démonstration.',
    whatsappLabel: 'Nous écrire sur WhatsApp',
    whatsappBubble: 'Une question ? Écrivez-nous',
    whatsappDismiss: 'Fermer',
    whatsappMessage: 'Bonjour CFI, je souhaite des renseignements sur vos formations.',
    coursesTitle: 'Carte formation',
    coursesNote: 'Trois variantes : grille, liste et compacte.',
    courseTitleOne: 'Marketing digital pour PME',
    courseTitleTwo: 'Management d’équipe à distance',
    courseTitleThree: 'Comptabilité analytique',
    courseCategory: 'Marketing',
    courseCategoryTwo: 'Management',
    courseAlt: 'Illustration géométrique de la formation',
    courseLevel: 'Intermédiaire',
    courseLevelLabel: 'Niveau : intermédiaire',
    courseDuration: '4 h 25',
    courseDurationLabel: 'Durée : 4 heures 25 minutes',
    courseLessons: '18 leçons',
    courseLessonsLabel: 'Contenu : 18 leçons',
    courseRatingLabel: 'Note : 4,8 sur 5, 126 avis',
    courseBadge: 'Nouveau',
    courseProgressLabel: 'Progression dans la formation',
    latticeTitle: 'Le Lattice',
    latticeNote:
      'Une tuile par formation, l’intensité portant la popularité. La géométrie ne se retourne jamais ; c’est l’ordre de lecture qui se retourne.',
    latticeLabel: 'Nos formations',
  },

  motion: {
    sequenceTitle: 'Séquence d’apparition',
    sequenceNote:
      'Décalage de 60 ms entre les éléments, 280 ms par élément, une seule fois. Rejouez-la pour l’observer.',
    replay: 'Rejouer la séquence',
    hoverTitle: 'Micro-interactions',
    hoverNote:
      'Survol à 120 ms, translation d’un demi-pixel, couleur de bordure. Rien ne se redistribue : une grille de cartes ne bouge pas.',
    hoverCard: 'Survolez cette carte',
    hoverCardBody: 'Elle se soulève et sa bordure passe au strait, sans décaler ses voisines.',
    reducedTitle: 'Mouvement réduit',
    reducedOn: 'Le mouvement réduit est actif : les animations sont neutralisées.',
    reducedOff:
      'Le mouvement réduit est inactif. Activez-le dans votre système pour voir cette page se figer.',
    stepOne: 'Le titre arrive en premier',
    stepTwo: 'Puis le sous-titre',
    stepThree: 'Puis la rangée d’actions',
    stepFour: 'Puis le contenu',
  },

  rtl: {
    paragraphTitle: 'Un paragraphe dans les deux sens',
    paragraphNote:
      'Le même balisage, la même feuille de style : seule la direction change. Les marges, les icônes et l’alignement suivent, car rien n’est écrit en gauche/droite.',
    forceRtl: 'Forcer l’aperçu en arabe',
    paragraphFr:
      'Le détroit de Gibraltar sépare deux continents de quatorze kilomètres. Le centre forme, à Tanger, celles et ceux qui travaillent des deux côtés.',
    paragraphAr:
      'يفصل مضيق جبل طارق بين قارتين على مسافة أربعة عشر كيلومترًا. يكوّن المركز في طنجة من يعملون على ضفتيه.',
    controlsTitle: 'Une rangée de contrôles',
    controlsNote:
      'Icône directionnelle retournée, coche jamais retournée, filet logique, chiffres isolés en LTR.',
    back: 'Retour',
    next: 'Suivant',
    reference: 'Référence',
    referenceValue: 'CFI-2026-000123',
    amount: 'Montant',
    iban: 'RIB',
    ibanValue: '007 780 0001234567890123 45',
  },
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   Layout shells
   ═══════════════════════════════════════════════════════════════════════════ */

interface SectionShellProps {
  id: ShowcaseSectionId;
  title: string;
  /** The one quiet line naming the spec rule this section demonstrates. */
  rule: string;
  children: React.ReactNode;
}

function SectionShell({ id, title, rule, children }: SectionShellProps): React.JSX.Element {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 scroll-mt-28 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h2 id={`${id}-title`} className="text-title">
          {title}
        </h2>
        <p className="max-w-3xl font-mono text-xs text-ink-muted">{rule}</p>
      </header>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

interface PanelProps {
  title: string;
  note?: string;
  children: React.ReactNode;
  className?: string;
}

function Panel({ title, note, children, className }: PanelProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-md border border-hairline bg-surface p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-heading font-medium text-ink">{title}</h3>
        {note === undefined ? null : <p className="max-w-3xl text-sm text-ink-muted">{note}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </div>
  );
}

/** A labelled row inside a panel — the state name, then the specimens. */
function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <p className="font-mono text-xs tracking-wide text-ink-muted uppercase">{label}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Colour — swatches with a contrast ratio measured in the browser
   ═══════════════════════════════════════════════════════════════════════════

   The tokens are `var()` chains, and two of them resolve to `color-mix()`, so
   the ratio cannot be computed from the source values. It is measured instead:
   a single off-screen probe is painted with each token, the browser hands back
   its *computed* colour, a 1×1 canvas turns that string into RGBA bytes,
   translucent layers are composited over their opaque base, and the WCAG 2.2
   relative-luminance formula does the rest.

   Everything re-runs when the theme changes, because the tokens do.            */

interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

type ContrastRequirement = 'text' | 'ui' | 'decorative';

interface Swatch {
  readonly id: string;
  /** The token this swatch is about. */
  readonly token: string;
  /** Colour of the sample glyphs. */
  readonly fg: string;
  /** Colour painted directly behind them. */
  readonly bg: string;
  /** Opaque colour under `bg`, when `bg` is a translucent wash. */
  readonly base?: string;
  readonly requirement: ContrastRequirement;
  readonly role: string;
}

const SWATCHES: readonly Swatch[] = [
  {
    id: 'abyss',
    token: '--color-abyss',
    fg: '--color-ink',
    bg: '--color-abyss',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.abyss,
  },
  {
    id: 'surface',
    token: '--color-surface',
    fg: '--color-ink',
    bg: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.surface,
  },
  {
    id: 'raised',
    token: '--color-raised',
    fg: '--color-ink',
    bg: '--color-raised',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.raised,
  },
  {
    id: 'hairline',
    token: '--color-hairline',
    fg: '--color-hairline',
    bg: '--color-surface',
    requirement: 'decorative',
    role: SHOWCASE_COPY.colors.roles.hairline,
  },
  {
    id: 'ink',
    token: '--color-ink',
    fg: '--color-ink',
    bg: '--color-abyss',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.ink,
  },
  {
    id: 'ink-muted',
    token: '--color-ink-muted',
    fg: '--color-ink-muted',
    bg: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.inkMuted,
  },
  {
    id: 'strait',
    token: '--color-strait',
    fg: '--color-strait',
    bg: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.strait,
  },
  {
    id: 'deep',
    token: '--color-deep',
    fg: '--color-ink',
    bg: '--color-deep',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.deep,
  },
  {
    id: 'brass',
    token: '--color-brass',
    fg: '--color-brass',
    bg: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.brass,
  },
  {
    id: 'danger',
    token: '--color-danger',
    fg: '--color-danger',
    bg: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.danger,
  },
  {
    id: 'warn',
    token: '--color-warn',
    fg: '--color-warn',
    bg: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.warn,
  },
  {
    id: 'success',
    token: '--color-success',
    fg: '--color-success',
    bg: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.success,
  },
  {
    id: 'on-accent',
    token: '--color-on-accent',
    fg: '--color-on-accent',
    bg: '--color-strait',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.onAccent,
  },
  {
    id: 'on-brass',
    token: '--color-on-brass',
    fg: '--color-on-brass',
    bg: '--color-brass',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.onBrass,
  },
  {
    id: 'on-danger',
    token: '--color-on-danger',
    fg: '--color-on-danger',
    bg: '--color-danger',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.onDanger,
  },
  {
    id: 'strait-wash',
    token: '--color-strait-wash',
    fg: '--color-strait',
    bg: '--color-strait-wash',
    base: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.straitWash,
  },
  {
    id: 'brass-wash',
    token: '--color-brass-wash',
    fg: '--color-brass',
    bg: '--color-brass-wash',
    base: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.brassWash,
  },
  {
    id: 'danger-wash',
    token: '--color-danger-wash',
    fg: '--color-danger',
    bg: '--color-danger-wash',
    base: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.dangerWash,
  },
  {
    id: 'warn-wash',
    token: '--color-warn-wash',
    fg: '--color-warn',
    bg: '--color-warn-wash',
    base: '--color-surface',
    requirement: 'text',
    role: SHOWCASE_COPY.colors.roles.warnWash,
  },
  {
    id: 'strait-border',
    token: '--color-strait',
    fg: '--color-strait',
    bg: '--color-surface',
    requirement: 'ui',
    role: SHOWCASE_COPY.colors.roles.straitBorder,
  },
  {
    id: 'danger-border',
    token: '--color-danger',
    fg: '--color-danger',
    bg: '--color-surface',
    requirement: 'ui',
    role: SHOWCASE_COPY.colors.roles.dangerBorder,
  },
];

const MINIMUM_RATIO: Record<ContrastRequirement, number | null> = {
  text: 4.5,
  ui: 3,
  decorative: null,
};

/** Parses the `rgb()` / `rgba()` form every engine emits for plain colours. */
function parseRgbFunction(input: string): Rgba | null {
  const match = /^rgba?\(([^)]+)\)$/i.exec(input.trim());
  if (match === null) return null;

  const parts = (match[1] ?? '')
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0)
    .map((part) => Number.parseFloat(part));

  const r = parts[0];
  const g = parts[1];
  const b = parts[2];
  if (r === undefined || g === undefined || b === undefined) return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;

  const alpha = parts[3];
  return { r, g, b, a: alpha === undefined || !Number.isFinite(alpha) ? 1 : alpha };
}

/**
 * Last resort for `color-mix()` / `oklab()` / `color(srgb …)`: hand the string to
 * a 1×1 canvas and read the bytes back. `copy` composition keeps the alpha
 * channel instead of blending it into the previous fill.
 */
function sampleWithCanvas(ctx: CanvasRenderingContext2D, input: string): Rgba | null {
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.fillStyle = '#000000';
  const sentinel = ctx.fillStyle;
  ctx.fillStyle = input;
  if (ctx.fillStyle === sentinel && input.trim().toLowerCase() !== '#000000') {
    ctx.restore();
    return null;
  }
  ctx.fillRect(0, 0, 1, 1);
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, 1, 1);
  return {
    r: data[0] ?? 0,
    g: data[1] ?? 0,
    b: data[2] ?? 0,
    a: (data[3] ?? 0) / 255,
  };
}

/** Source-over composite of a translucent colour on an opaque one. */
function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top.a;
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  };
}

function linearise(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(colour: Rgba): number {
  return (
    0.2126 * linearise(colour.r) + 0.7152 * linearise(colour.g) + 0.0722 * linearise(colour.b)
  );
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Measures every swatch once per theme. Returns `null` for a swatch the engine
 * refused to resolve rather than inventing a number.
 */
function useContrastReport(): ReadonlyMap<string, number | null> {
  const { resolvedTheme } = useTheme();
  const [report, setReport] = useState<ReadonlyMap<string, number | null>>(() => new Map());

  useEffect(() => {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:absolute;inset-block-start:0;inline-size:0;block-size:0;opacity:0;pointer-events:none;';
    document.body.appendChild(probe);

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const cache = new Map<string, Rgba | null>();

    const resolve = (token: string): Rgba | null => {
      const cached = cache.get(token);
      if (cached !== undefined) return cached;

      probe.style.backgroundColor = '';
      probe.style.backgroundColor = `var(${token})`;
      const computed = window.getComputedStyle(probe).backgroundColor;

      const parsed = parseRgbFunction(computed) ?? (ctx === null ? null : sampleWithCanvas(ctx, computed));
      cache.set(token, parsed);
      return parsed;
    };

    const next = new Map<string, number | null>();

    for (const swatch of SWATCHES) {
      const foreground = resolve(swatch.fg);
      const painted = resolve(swatch.bg);

      if (foreground === null || painted === null) {
        next.set(swatch.id, null);
        continue;
      }

      const base = swatch.base === undefined ? null : resolve(swatch.base);
      const background =
        painted.a >= 1 ? painted : base === null ? null : composite(painted, base);

      if (background === null) {
        next.set(swatch.id, null);
        continue;
      }

      const solidForeground = foreground.a >= 1 ? foreground : composite(foreground, background);
      next.set(swatch.id, contrastRatio(solidForeground, background));
    }

    setReport(next);
    document.body.removeChild(probe);
  }, [resolvedTheme]);

  return report;
}

/** `4.53` → `4,53:1`, kept LTR so Arabic never re-orders it (§10.3). */
function formatRatio(ratio: number, locale: Locale): string {
  const rounded = Math.round(ratio * 100) / 100;
  const text = rounded.toFixed(2);
  return `${locale === 'en' ? text : text.replace('.', ',')}:1`;
}

function ColourSection({ title }: { title: string }): React.JSX.Element {
  const report = useContrastReport();
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;

  return (
    <SectionShell id="colors" title={title} rule={SHOWCASE_COPY.rules.colors}>
      <p className="max-w-3xl text-sm text-ink-muted">{SHOWCASE_COPY.colors.intro}</p>

      <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SWATCHES.map((swatch) => {
          const ratio = report.get(swatch.id);
          const minimum = MINIMUM_RATIO[swatch.requirement];
          const measured = typeof ratio === 'number';
          const passes = measured && (minimum === null || ratio >= minimum);

          return (
            <li
              key={swatch.id}
              className="flex min-w-0 flex-col gap-3 rounded-md border border-hairline bg-surface p-3"
            >
              <div
                className="grid min-h-16 place-items-center rounded-sm"
                style={{ backgroundColor: swatch.base === undefined ? undefined : `var(${swatch.base})` }}
              >
                <div
                  className="grid min-h-16 w-full place-items-center rounded-sm border border-hairline"
                  style={{ backgroundColor: `var(${swatch.bg})` }}
                >
                  <span
                    data-numeric
                    dir="ltr"
                    className="force-ltr text-lead font-medium"
                    style={{ color: `var(${swatch.fg})` }}
                  >
                    {SHOWCASE_COPY.colors.sample}
                  </span>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-1">
                <code dir="ltr" className="force-ltr font-mono text-xs break-all text-ink">
                  {swatch.token}
                </code>
                <p className="text-xs text-ink-muted">{swatch.role}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span data-numeric dir="ltr" className="force-ltr text-sm text-ink">
                  {measured ? formatRatio(ratio, locale) : '—'}
                </span>
                {swatch.requirement === 'decorative' ? (
                  <Badge tone="neutral" variant="outline" icon={<Minus aria-hidden="true" />}>
                    {SHOWCASE_COPY.colors.decorative}
                  </Badge>
                ) : !measured ? (
                  <Badge tone="neutral" variant="outline" icon={<CircleHelp aria-hidden="true" />}>
                    {report.size === 0
                      ? SHOWCASE_COPY.colors.measuring
                      : SHOWCASE_COPY.colors.unavailable}
                  </Badge>
                ) : (
                  <Badge
                    tone={passes ? 'success' : 'danger'}
                    icon={passes ? <Check aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
                  >
                    {swatch.requirement === 'text'
                      ? passes
                        ? SHOWCASE_COPY.colors.passText
                        : SHOWCASE_COPY.colors.failText
                      : passes
                        ? SHOWCASE_COPY.colors.passUi
                        : SHOWCASE_COPY.colors.failUi}
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="max-w-3xl text-xs text-ink-muted">{SHOWCASE_COPY.colors.legend}</p>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Typography
   ═══════════════════════════════════════════════════════════════════════════ */

interface TypeStep {
  readonly id: string;
  readonly token: string;
  readonly className: string;
}

const TYPE_SCALE: readonly TypeStep[] = [
  { id: 'hero', token: 'text-hero', className: 'text-hero' },
  { id: 'display', token: 'text-display', className: 'text-display' },
  { id: 'title', token: 'text-title', className: 'text-title' },
  { id: 'heading', token: 'text-heading', className: 'text-heading' },
  { id: 'lead', token: 'text-lead', className: 'text-lead' },
  { id: 'body', token: 'text-body', className: 'text-body' },
  { id: 'sm', token: 'text-sm', className: 'text-sm' },
  { id: 'xs', token: 'text-xs', className: 'text-xs' },
];

/** Reads the resolved line-height of a node, in whole pixels. */
function useMeasuredLeading(): {
  latinRef: React.RefObject<HTMLParagraphElement | null>;
  arabicRef: React.RefObject<HTMLParagraphElement | null>;
  latin: string | null;
  arabic: string | null;
} {
  const latinRef = useRef<HTMLParagraphElement>(null);
  const arabicRef = useRef<HTMLParagraphElement>(null);
  const [latin, setLatin] = useState<string | null>(null);
  const [arabic, setArabic] = useState<string | null>(null);

  useEffect(() => {
    const read = (node: HTMLElement | null): string | null => {
      if (node === null) return null;
      const style = window.getComputedStyle(node);
      const height = Number.parseFloat(style.lineHeight);
      const size = Number.parseFloat(style.fontSize);
      if (!Number.isFinite(height) || !Number.isFinite(size) || size === 0) return null;
      return `${Math.round(height)} px · ${(Math.round((height / size) * 100) / 100)
        .toFixed(2)
        .replace('.', ',')}`;
    };

    setLatin(read(latinRef.current));
    setArabic(read(arabicRef.current));
  }, []);

  return { latinRef, arabicRef, latin, arabic };
}

function TypographySection({ title }: { title: string }): React.JSX.Element {
  const { latinRef, arabicRef, latin, arabic } = useMeasuredLeading();

  return (
    <SectionShell id="typography" title={title} rule={SHOWCASE_COPY.rules.typography}>
      <Panel title={SHOWCASE_COPY.typography.scaleTitle} note={SHOWCASE_COPY.typography.scaleNote}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          <p className="font-mono text-xs tracking-wide text-ink-muted uppercase">
            {SHOWCASE_COPY.typography.latinColumn}
          </p>
          <p className="hidden font-mono text-xs tracking-wide text-ink-muted uppercase md:block">
            {SHOWCASE_COPY.typography.arabicColumn}
          </p>

          {TYPE_SCALE.map((step) => (
            <div key={step.id} className="contents">
              <div className="hairline-t flex min-w-0 flex-col gap-1 pt-3">
                <code dir="ltr" className="force-ltr font-mono text-xs text-ink-muted">
                  {step.token}
                </code>
                <p className={cn('text-balance text-ink', step.className)}>
                  {SHOWCASE_COPY.typography.latinSample}
                </p>
              </div>
              <div className="hairline-t flex min-w-0 flex-col gap-1 pt-3" lang="ar" dir="rtl">
                <code dir="ltr" className="force-ltr font-mono text-xs text-ink-muted">
                  {step.token}
                </code>
                <p className={cn('text-balance text-ink', step.className)}>
                  {SHOWCASE_COPY.typography.arabicSample}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title={SHOWCASE_COPY.typography.leadingTitle}
        note={SHOWCASE_COPY.typography.leadingNote}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            lang="fr"
            dir="ltr"
            className="flex min-w-0 flex-col gap-2 rounded-sm border border-hairline bg-raised p-3"
          >
            {/* No `text-body` here: that utility would pin the line-height and
                hide the very difference this panel exists to show. The Latin
                block asks for the scale's own leading; the Arabic block inherits
                `--leading-ar` from the `:lang(ar)` rule in globals.css. */}
            <p ref={latinRef} className="leading-[var(--text-body--line-height)] text-ink">
              {SHOWCASE_COPY.rtl.paragraphFr}
            </p>
            <p className="text-xs text-ink-muted">
              <span className="me-2">{SHOWCASE_COPY.typography.leadingLatin}</span>
              <span data-numeric dir="ltr" className="force-ltr text-ink">
                {latin ?? '—'}
              </span>
            </p>
          </div>
          <div
            lang="ar"
            dir="rtl"
            className="flex min-w-0 flex-col gap-2 rounded-sm border border-hairline bg-raised p-3"
          >
            <p ref={arabicRef} className="text-ink">
              {SHOWCASE_COPY.rtl.paragraphAr}
            </p>
            <p className="text-xs text-ink-muted">
              <span className="me-2">{SHOWCASE_COPY.typography.leadingArabic}</span>
              <span data-numeric dir="ltr" className="force-ltr text-ink">
                {arabic ?? '—'}
              </span>
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title={SHOWCASE_COPY.typography.familiesTitle}
        note={SHOWCASE_COPY.typography.numericNote}
      >
        <div className="flex flex-col gap-3">
          <p className="font-display text-heading text-ink">{SHOWCASE_COPY.typography.familyDisplay}</p>
          <p className="font-sans text-body text-ink">{SHOWCASE_COPY.typography.familySans}</p>
          <p dir="ltr" className="force-ltr font-mono text-body text-ink">
            {SHOWCASE_COPY.typography.familyMono}
          </p>
          <p lang="ar" dir="rtl" className="font-arabic text-body text-ink">
            {SHOWCASE_COPY.typography.arabicSample}
          </p>
          <ul role="list" className="flex flex-col gap-1">
            {[1200, 45, 128000, 7].map((value) => (
              <li key={value} data-numeric dir="ltr" className="force-ltr text-body text-ink">
                {value.toString().padStart(7, '0')}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Buttons
   ═══════════════════════════════════════════════════════════════════════════ */

const BUTTON_VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'ghost',
  'danger',
  'brass',
];

const BUTTON_SIZES: readonly { readonly size: ButtonSize; readonly label: string }[] = [
  { size: 'sm', label: SHOWCASE_COPY.buttons.sizeSm },
  { size: 'md', label: SHOWCASE_COPY.buttons.sizeMd },
  { size: 'lg', label: SHOWCASE_COPY.buttons.sizeLg },
];

function ButtonsSection({ title, actionLabel }: { title: string; actionLabel: string }): React.JSX.Element {
  const disabledId = useId();
  const loadingId = useId();
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <SectionShell id="buttons" title={title} rule={SHOWCASE_COPY.rules.buttons}>
      <Panel title={SHOWCASE_COPY.buttons.matrixTitle} note={SHOWCASE_COPY.buttons.matrixNote}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <Switch id={disabledId} checked={disabled} onCheckedChange={setDisabled} />
            <label htmlFor={disabledId} className="cursor-pointer text-sm text-ink">
              {SHOWCASE_COPY.buttons.disabledSwitch}
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Switch id={loadingId} checked={loading} onCheckedChange={setLoading} />
            <label htmlFor={loadingId} className="cursor-pointer text-sm text-ink">
              {SHOWCASE_COPY.buttons.loadingSwitch}
            </label>
          </div>
        </div>

        {BUTTON_SIZES.map((entry) => (
          <Row key={entry.size} label={entry.label}>
            {BUTTON_VARIANTS.map((variant) => (
              <Button
                key={variant}
                variant={variant}
                size={entry.size}
                disabled={disabled}
                loading={loading}
              >
                {actionLabel}
              </Button>
            ))}
          </Row>
        ))}
      </Panel>

      <Panel title={SHOWCASE_COPY.buttons.withIcons}>
        <div className="flex flex-wrap items-center gap-3">
          <Button iconStart={<Plus className="size-4" />}>
            {SHOWCASE_COPY.buttons.iconStartLabel}
          </Button>
          <Button
            variant="secondary"
            /* Direction-carrying glyph: mirrored in Arabic. */
            iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}
          >
            {SHOWCASE_COPY.buttons.iconEndLabel}
          </Button>
          <Button variant="brass" iconStart={<Wallet className="size-4" />}>
            {SHOWCASE_COPY.buttons.fullWidthLabel}
          </Button>
        </div>
        <div className="max-w-sm">
          <Button fullWidth variant="primary" size="lg">
            {SHOWCASE_COPY.buttons.fullWidthLabel}
          </Button>
        </div>
      </Panel>

      <Panel
        title={SHOWCASE_COPY.buttons.iconButtonsTitle}
        note={SHOWCASE_COPY.buttons.iconButtonsNote}
      >
        <Row label={SHOWCASE_COPY.buttons.sizeSm}>
          <IconButton size="sm" aria-label={SHOWCASE_COPY.buttons.search} icon={<Search />} />
          <IconButton
            size="sm"
            variant="secondary"
            aria-label={SHOWCASE_COPY.buttons.settings}
            icon={<Settings />}
          />
          <IconButton
            size="sm"
            variant="danger"
            aria-label={SHOWCASE_COPY.buttons.remove}
            icon={<Trash2 />}
          />
        </Row>
        <Row label={SHOWCASE_COPY.buttons.sizeMd}>
          <IconButton aria-label={SHOWCASE_COPY.buttons.search} icon={<Search />} />
          <IconButton
            variant="primary"
            shape="round"
            aria-label={SHOWCASE_COPY.buttons.download}
            icon={<Download />}
          />
          <IconButton
            variant="secondary"
            aria-label={SHOWCASE_COPY.buttons.more}
            icon={<MoreHorizontal />}
          />
          <IconButton
            variant="secondary"
            loading
            aria-label={SHOWCASE_COPY.buttons.download}
            icon={<Download />}
          />
          <IconButton
            variant="secondary"
            disabled
            aria-label={SHOWCASE_COPY.buttons.remove}
            icon={<Trash2 />}
          />
        </Row>
        <Row label={SHOWCASE_COPY.buttons.sizeLg}>
          <IconButton size="lg" variant="brass" aria-label={SHOWCASE_COPY.buttons.download} icon={<Award />} />
          <IconButton size="lg" variant="ghost" aria-label={SHOWCASE_COPY.buttons.settings} icon={<Settings />} />
        </Row>
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Inputs
   ═══════════════════════════════════════════════════════════════════════════ */

const CITY_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'tanger', label: SHOWCASE_COPY.inputs.cityTanger },
  { value: 'casablanca', label: SHOWCASE_COPY.inputs.cityCasablanca },
  { value: 'rabat', label: SHOWCASE_COPY.inputs.cityRabat },
  { value: 'marrakech', label: SHOWCASE_COPY.inputs.cityMarrakech },
];

const CATEGORY_OPTIONS: readonly ComboboxOption[] = [
  { value: 'marketing', label: SHOWCASE_COPY.inputs.categoryMarketing },
  { value: 'management', label: SHOWCASE_COPY.inputs.categoryManagement },
  { value: 'finance', label: SHOWCASE_COPY.inputs.categoryFinance },
  { value: 'languages', label: SHOWCASE_COPY.inputs.categoryLanguages, disabled: true },
];

const ACCEPTED_UPLOAD_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** One column of the valid / invalid / disabled matrix. */
function FieldColumn({
  state,
  error,
  disabled,
  requiredHint,
  optionalHint,
}: {
  state: string;
  error?: string;
  disabled: boolean;
  requiredHint: string;
  optionalHint: string;
}): React.JSX.Element {
  const { dir } = useDirection();

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="font-mono text-xs tracking-wide text-ink-muted uppercase">{state}</p>

      <FormField
        label={SHOWCASE_COPY.inputs.email}
        description={SHOWCASE_COPY.inputs.emailHint}
        error={error}
        required
        requiredHint={requiredHint}
      >
        {(field) => (
          <Input
            id={field.id}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            invalid={error !== undefined}
            disabled={disabled}
            required={field.required}
            type="email"
            inputMode="email"
            autoComplete="email"
            defaultValue={error === undefined ? 'amine@exemple.ma' : 'amine.exemple.ma'}
            iconStart={<Mail className="size-4" />}
          />
        )}
      </FormField>

      <FormField
        label={SHOWCASE_COPY.inputs.message}
        error={error === undefined ? undefined : SHOWCASE_COPY.inputs.messageError}
        optionalHint={optionalHint}
      >
        {(field) => (
          <Textarea
            id={field.id}
            aria-describedby={field['aria-describedby']}
            aria-invalid={field['aria-invalid']}
            invalid={error !== undefined}
            disabled={disabled}
            maxLength={240}
            counterAnnouncement={SHOWCASE_COPY.inputs.remaining}
            defaultValue={error === undefined ? SHOWCASE_COPY.rtl.paragraphFr : 'Trop court.'}
          />
        )}
      </FormField>

      <FormField
        label={SHOWCASE_COPY.inputs.city}
        error={error === undefined ? undefined : SHOWCASE_COPY.inputs.cityError}
      >
        {(field) => (
          <Select dir={dir} disabled={disabled} defaultValue={error === undefined ? 'tanger' : undefined}>
            <SelectTrigger
              id={field.id}
              aria-describedby={field['aria-describedby']}
              invalid={error !== undefined}
            >
              <SelectValue placeholder={SHOWCASE_COPY.inputs.cityPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {CITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
    </div>
  );
}

function InputsSection({
  title,
  optionalHint,
  requiredHint,
}: {
  title: string;
  optionalHint: string;
  requiredHint: string;
}): React.JSX.Element {
  const common = useTranslations('common');
  const { dir } = useDirection();
  const newsletterId = useId();
  const notificationsId = useId();
  const scoreId = useId();

  const [newsletter, setNewsletter] = useState(true);
  const [notifications, setNotifications] = useState(false);
  const [score, setScore] = useState<number[]>([70]);
  const [indeterminate, setIndeterminate] = useState<boolean | 'indeterminate'>('indeterminate');
  const [payment, setPayment] = useState('bank');
  const [otp, setOtp] = useState('4271');
  const [shortOtp, setShortOtp] = useState('12');
  const [transferDate, setTransferDate] = useState<Date | null>(null);
  const [category, setCategory] = useState<string | null>('marketing');
  const [files, setFiles] = useState<readonly FileDropzoneItem[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<readonly FileDropzoneItem[]>([]);
  const fileSequence = useRef(0);

  const toItems = useCallback(
    (incoming: File[]): FileDropzoneItem[] =>
      incoming.map((file): FileDropzoneItem => {
        fileSequence.current += 1;
        return { id: `showcase-file-${fileSequence.current}`, file, status: 'done' };
      }),
    [],
  );

  const addFiles = useCallback(
    (incoming: File[]): void => {
      setFiles((current) => [...current, ...toItems(incoming)]);
    },
    [toItems],
  );

  const removeFile = useCallback((id: string): void => {
    setFiles((current) => current.filter((item) => item.id !== id));
  }, []);

  const addRejectedFiles = useCallback(
    (incoming: File[]): void => {
      setRejectedFiles((current) => [...current, ...toItems(incoming)]);
    },
    [toItems],
  );

  const removeRejectedFile = useCallback((id: string): void => {
    setRejectedFiles((current) => current.filter((item) => item.id !== id));
  }, []);

  const scoreValue = score[0] ?? 0;

  return (
    <SectionShell id="inputs" title={title} rule={SHOWCASE_COPY.rules.inputs}>
      <Panel title={SHOWCASE_COPY.inputs.textTitle} note={SHOWCASE_COPY.inputs.textNote}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <FieldColumn
            state={SHOWCASE_COPY.inputs.stateValid}
            disabled={false}
            requiredHint={requiredHint}
            optionalHint={optionalHint}
          />
          <FieldColumn
            state={SHOWCASE_COPY.inputs.stateInvalid}
            error={SHOWCASE_COPY.inputs.emailError}
            disabled={false}
            requiredHint={requiredHint}
            optionalHint={optionalHint}
          />
          <FieldColumn
            state={SHOWCASE_COPY.inputs.stateDisabled}
            disabled
            requiredHint={requiredHint}
            optionalHint={optionalHint}
          />
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.inputs.choiceTitle}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4">
            <p className="font-mono text-xs tracking-wide text-ink-muted uppercase">
              {SHOWCASE_COPY.inputs.stateValid}
            </p>
            <CheckboxField
              defaultChecked
              label={SHOWCASE_COPY.inputs.terms}
              description={SHOWCASE_COPY.inputs.termsHint}
            />
            <div className="flex items-center gap-3">
              <Switch id={newsletterId} checked={newsletter} onCheckedChange={setNewsletter} />
              <label htmlFor={newsletterId} className="cursor-pointer text-sm text-ink">
                {SHOWCASE_COPY.inputs.newsletter}
              </label>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <p className="font-mono text-xs tracking-wide text-ink-muted uppercase">
              {SHOWCASE_COPY.inputs.stateInvalid}
            </p>
            <CheckboxField
              label={SHOWCASE_COPY.inputs.terms}
              error={SHOWCASE_COPY.inputs.termsError}
            />
            <div className="flex items-center gap-3">
              <Checkbox
                checked={indeterminate}
                onCheckedChange={setIndeterminate}
                aria-label={SHOWCASE_COPY.inputs.notifications}
              />
              <span className="text-sm text-ink-muted">{SHOWCASE_COPY.inputs.notifications}</span>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <p className="font-mono text-xs tracking-wide text-ink-muted uppercase">
              {SHOWCASE_COPY.inputs.stateDisabled}
            </p>
            <CheckboxField disabled defaultChecked label={SHOWCASE_COPY.inputs.terms} />
            <div className="flex items-center gap-3">
              <Switch id={notificationsId} disabled checked={notifications} onCheckedChange={setNotifications} />
              <label htmlFor={notificationsId} className="cursor-not-allowed text-sm text-ink-muted">
                {SHOWCASE_COPY.inputs.notifications}
              </label>
            </div>
          </div>
        </div>

        <div className="flex max-w-md flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={scoreId} className="text-sm font-medium text-ink">
              {SHOWCASE_COPY.inputs.passingScore}
            </label>
            <span data-numeric dir="ltr" className="force-ltr text-sm text-ink">
              {SHOWCASE_COPY.inputs.scoreValue(scoreValue)}
            </span>
          </div>
          <Slider
            id={scoreId}
            dir={dir}
            value={score}
            onValueChange={setScore}
            min={0}
            max={100}
            step={5}
            aria-label={SHOWCASE_COPY.inputs.passingScore}
            aria-valuetext={SHOWCASE_COPY.inputs.scoreValue(scoreValue)}
          />
          <Slider
            dir={dir}
            disabled
            defaultValue={[30]}
            aria-label={SHOWCASE_COPY.inputs.passingScore}
          />
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.inputs.radioTitle}>
        <RadioCardGroup
          dir={dir}
          value={payment}
          onValueChange={setPayment}
          aria-label={SHOWCASE_COPY.inputs.radioTitle}
          className="sm:grid-cols-2"
        >
          <RadioCard
            value="bank"
            title={SHOWCASE_COPY.inputs.radioBank}
            description={SHOWCASE_COPY.inputs.radioBankDescription}
            badge={SHOWCASE_COPY.inputs.radioBadge}
            warning={SHOWCASE_COPY.inputs.radioBankWarning}
            icon={<Wallet className="size-5" aria-hidden="true" />}
          />
          <RadioCard
            value="cash"
            disabled
            title={SHOWCASE_COPY.inputs.radioCash}
            description={SHOWCASE_COPY.inputs.radioCashDescription}
            icon={<Landmark className="size-5" aria-hidden="true" />}
          />
        </RadioCardGroup>
      </Panel>

      <Panel title={SHOWCASE_COPY.inputs.specialTitle}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <FormField label={SHOWCASE_COPY.inputs.password} required requiredHint={requiredHint}>
            {(field) => (
              <PasswordInput
                id={field.id}
                aria-describedby={field['aria-describedby']}
                required={field.required}
                autoComplete="new-password"
                defaultValue="detroit-2026"
                showPasswordLabel={SHOWCASE_COPY.inputs.showPassword}
                hidePasswordLabel={SHOWCASE_COPY.inputs.hidePassword}
                strengthLabels={SHOWCASE_COPY.inputs.strengthLabels}
              />
            )}
          </FormField>

          <FormField label={SHOWCASE_COPY.inputs.phone} optionalHint={optionalHint}>
            {(field) => (
              <PhoneInput
                id={field.id}
                aria-describedby={field['aria-describedby']}
                defaultValue="612345678"
                countryPrefixLabel={SHOWCASE_COPY.inputs.phonePrefix}
              />
            )}
          </FormField>

          {/* Six 44 px boxes are wider than a 360 px column, so the group — not
              the page — owns the overflow (§11.4). */}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="min-w-0 overflow-x-auto py-0.5">
              <OtpInput
                value={otp}
                onValueChange={setOtp}
                label={SHOWCASE_COPY.inputs.otp}
                digitLabel={SHOWCASE_COPY.inputs.otpDigit}
              />
            </div>
            <p className="text-sm text-ink-muted">{SHOWCASE_COPY.inputs.otpHint}</p>
            <div className="min-w-0 overflow-x-auto py-0.5">
              <OtpInput
                value={shortOtp}
                invalid
                onValueChange={setShortOtp}
                label={SHOWCASE_COPY.inputs.otp}
                digitLabel={SHOWCASE_COPY.inputs.otpDigit}
              />
            </div>
            <div className="min-w-0 overflow-x-auto py-0.5">
              <OtpInput
                value="000000"
                disabled
                label={SHOWCASE_COPY.inputs.otp}
                digitLabel={SHOWCASE_COPY.inputs.otpDigit}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <DatePicker
              value={transferDate}
              onValueChange={setTransferDate}
              label={SHOWCASE_COPY.inputs.date}
              placeholder={SHOWCASE_COPY.inputs.datePlaceholder}
              previousMonthLabel={SHOWCASE_COPY.inputs.previousMonth}
              nextMonthLabel={SHOWCASE_COPY.inputs.nextMonth}
              clearLabel={SHOWCASE_COPY.inputs.clearDate}
            />
            <Combobox
              options={CATEGORY_OPTIONS}
              value={category}
              onValueChange={setCategory}
              label={SHOWCASE_COPY.inputs.category}
              placeholder={SHOWCASE_COPY.inputs.categoryPlaceholder}
              searchPlaceholder={SHOWCASE_COPY.inputs.categorySearch}
              emptyText={SHOWCASE_COPY.inputs.categoryEmpty}
              clearLabel={SHOWCASE_COPY.inputs.categoryClear}
            />
          </div>
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.inputs.dropzoneTitle}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <FileDropzone
            items={files}
            onSelect={addFiles}
            onRemove={removeFile}
            accept={ACCEPTED_UPLOAD_TYPES}
            maxSizeBytes={MAX_UPLOAD_BYTES}
            maxFiles={3}
            title={SHOWCASE_COPY.inputs.dropzoneHeadline}
            hint={SHOWCASE_COPY.inputs.dropzoneHint}
            browseLabel={SHOWCASE_COPY.inputs.dropzoneBrowse}
            cameraLabel={SHOWCASE_COPY.inputs.dropzoneCamera}
            removeLabel={SHOWCASE_COPY.inputs.dropzoneRemove}
            progressLabel={SHOWCASE_COPY.inputs.dropzoneProgress}
          />
          <div className="flex flex-col gap-2">
            <FileDropzone
              items={rejectedFiles}
              invalid
              onSelect={addRejectedFiles}
              onRemove={removeRejectedFile}
              accept={ACCEPTED_UPLOAD_TYPES}
              maxSizeBytes={MAX_UPLOAD_BYTES}
              title={SHOWCASE_COPY.inputs.dropzoneHeadline}
              hint={SHOWCASE_COPY.inputs.dropzoneHint}
              browseLabel={SHOWCASE_COPY.inputs.dropzoneBrowse}
              removeLabel={SHOWCASE_COPY.inputs.dropzoneRemove}
            />
            <FormError>{SHOWCASE_COPY.inputs.dropzoneInvalid}</FormError>
          </div>
          <FileDropzone
            items={[]}
            disabled
            onSelect={() => undefined}
            onRemove={() => undefined}
            accept={ACCEPTED_UPLOAD_TYPES}
            maxSizeBytes={MAX_UPLOAD_BYTES}
            title={SHOWCASE_COPY.inputs.dropzoneHeadline}
            hint={SHOWCASE_COPY.inputs.dropzoneHint}
            browseLabel={SHOWCASE_COPY.inputs.dropzoneBrowse}
            removeLabel={SHOWCASE_COPY.inputs.dropzoneRemove}
          />
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.inputs.copyTitle}>
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-hairline bg-raised p-3">
          <span className="text-sm text-ink-muted">{SHOWCASE_COPY.inputs.ribLabel}</span>
          <span data-numeric dir="ltr" className="force-ltr text-sm text-ink">
            {SHOWCASE_COPY.rtl.ibanValue}
          </span>
          <CopyButton
            value={SHOWCASE_COPY.rtl.ibanValue}
            label={SHOWCASE_COPY.inputs.copyRib}
            copiedLabel={common('copied')}
            errorLabel={SHOWCASE_COPY.inputs.copyFailed}
            variant="outline"
            showLabel
          />
        </div>
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Feedback
   ═══════════════════════════════════════════════════════════════════════════ */

function FeedbackSection({ title }: { title: string }): React.JSX.Element {
  const common = useTranslations('common');
  const dismissLabel = common('close');

  return (
    <SectionShell id="feedback" title={title} rule={SHOWCASE_COPY.rules.feedback}>
      {/* The Radix toast region itself is mounted app-wide by Providers; this is
          the renderer that portals the queue into it. */}
      <Toaster />

      <Panel
        title={SHOWCASE_COPY.feedback.toastsTitle}
        note={SHOWCASE_COPY.feedback.toastsNote}
      >
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              toast.success({
                title: SHOWCASE_COPY.feedback.toastSuccessTitle,
                description: SHOWCASE_COPY.feedback.toastSuccessBody,
                dismissLabel,
              });
            }}
          >
            {SHOWCASE_COPY.feedback.toastSuccess}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast.error({
                title: SHOWCASE_COPY.feedback.toastErrorTitle,
                description: SHOWCASE_COPY.feedback.toastErrorBody,
                dismissLabel,
                action: {
                  label: common('retry'),
                  altText: SHOWCASE_COPY.feedback.toastActionAlt,
                  onSelect: () => undefined,
                },
              });
            }}
          >
            {SHOWCASE_COPY.feedback.toastError}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast.warning({
                title: SHOWCASE_COPY.feedback.toastWarningTitle,
                description: SHOWCASE_COPY.feedback.toastWarningBody,
                dismissLabel,
              });
            }}
          >
            {SHOWCASE_COPY.feedback.toastWarning}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast.info({
                title: SHOWCASE_COPY.feedback.toastInfoTitle,
                description: SHOWCASE_COPY.feedback.toastInfoBody,
                dismissLabel,
              });
            }}
          >
            {SHOWCASE_COPY.feedback.toastInfo}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              toast.dismissAll();
            }}
          >
            {common('reset')}
          </Button>
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.feedback.alertsTitle}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Alert variant="success" title={SHOWCASE_COPY.feedback.alertSuccessTitle}>
            {SHOWCASE_COPY.feedback.alertSuccessBody}
          </Alert>
          <Alert
            variant="error"
            title={SHOWCASE_COPY.feedback.alertErrorTitle}
            action={
              <Button size="sm" variant="secondary">
                {SHOWCASE_COPY.feedback.alertAction}
              </Button>
            }
          >
            {SHOWCASE_COPY.feedback.alertErrorBody}
          </Alert>
          <Alert variant="warning" title={SHOWCASE_COPY.feedback.alertWarningTitle}>
            {SHOWCASE_COPY.feedback.alertWarningBody}
          </Alert>
          <Alert variant="info" title={SHOWCASE_COPY.feedback.alertInfoTitle}>
            {SHOWCASE_COPY.feedback.alertInfoBody}
          </Alert>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Callout variant="info" title={SHOWCASE_COPY.feedback.calloutTitle}>
            {SHOWCASE_COPY.feedback.calloutBody}
          </Callout>
          <Callout variant="warning" hideIcon>
            {SHOWCASE_COPY.feedback.alertWarningBody}
          </Callout>
        </div>
      </Panel>

      <Panel
        title={SHOWCASE_COPY.feedback.skeletonsTitle}
        note={SHOWCASE_COPY.feedback.skeletonsNote}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard label={SHOWCASE_COPY.feedback.skeletonLoading} />
          <div className="flex flex-col gap-4">
            <SkeletonText lines={4} />
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-pill" />
              <div className="flex-1">
                <SkeletonText lines={2} />
              </div>
            </div>
          </div>
        </div>
        <SkeletonTable rows={3} columns={4} />
      </Panel>

      <Panel title={SHOWCASE_COPY.feedback.emptyTitle}>
        <div className="rounded-md border border-hairline bg-raised">
          <EmptyState
            illustration={<Inbox />}
            title={SHOWCASE_COPY.feedback.emptyHeadline}
            description={SHOWCASE_COPY.feedback.emptyBody}
            action={<Button variant="primary">{SHOWCASE_COPY.feedback.emptyAction}</Button>}
          />
        </div>
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Overlays
   ═══════════════════════════════════════════════════════════════════════════ */

function OverlaysSection({
  title,
  sections,
}: {
  title: string;
  sections: readonly ShowcaseNavItem[];
}): React.JSX.Element {
  const common = useTranslations('common');
  const closeLabel = common('close');
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const paletteItems = useMemo<readonly CommandPaletteItem[]>(
    () =>
      sections.map((section) => ({
        id: section.id,
        group: SHOWCASE_COPY.overlays.paletteGroup,
        label: section.label,
        icon: LayoutGrid,
        action: () => {
          document.getElementById(section.id)?.scrollIntoView({ block: 'start' });
        },
      })),
    [sections],
  );

  return (
    <SectionShell id="overlays" title={title} rule={SHOWCASE_COPY.rules.overlays}>
      <Panel
        title={SHOWCASE_COPY.overlays.modalTitle}
        note={
          isMobile
            ? SHOWCASE_COPY.overlays.modalShapeMobile
            : SHOWCASE_COPY.overlays.modalShapeDesktop
        }
      >
        <Modal>
          <ModalTrigger asChild>
            <Button variant="primary">{SHOWCASE_COPY.overlays.modalOpen}</Button>
          </ModalTrigger>
          <ModalContent closeLabel={closeLabel} size="md">
            <ModalHeader>
              <ModalTitle>{SHOWCASE_COPY.overlays.modalHeading}</ModalTitle>
              <ModalDescription>{SHOWCASE_COPY.overlays.modalBody}</ModalDescription>
            </ModalHeader>
            <ModalBody>
              <Callout variant="warning">{SHOWCASE_COPY.inputs.radioBankWarning}</Callout>
            </ModalBody>
            <ModalFooter>
              <ModalClose asChild>
                <Button variant="ghost">{common('cancel')}</Button>
              </ModalClose>
              <ModalClose asChild>
                <Button variant="primary">{SHOWCASE_COPY.overlays.modalConfirm}</Button>
              </ModalClose>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Panel>

      <Panel title={SHOWCASE_COPY.overlays.drawerTitle} note={SHOWCASE_COPY.overlays.drawerNote}>
        <div className="flex flex-wrap gap-3">
          {(
            [
              { side: 'start', label: SHOWCASE_COPY.overlays.drawerStart },
              { side: 'end', label: SHOWCASE_COPY.overlays.drawerEnd },
              { side: 'bottom', label: SHOWCASE_COPY.overlays.drawerBottom },
            ] as const
          ).map((entry) => (
            <Drawer key={entry.side}>
              <DrawerTrigger asChild>
                <Button variant="secondary">{entry.label}</Button>
              </DrawerTrigger>
              <DrawerContent side={entry.side} size="lg" closeLabel={closeLabel}>
                <DrawerHeader>
                  <DrawerTitle>{SHOWCASE_COPY.overlays.drawerHeading}</DrawerTitle>
                  <DrawerDescription>{SHOWCASE_COPY.overlays.drawerBody}</DrawerDescription>
                </DrawerHeader>
                <DrawerBody>
                  <p className="text-sm text-ink-muted">{SHOWCASE_COPY.rtl.paragraphFr}</p>
                </DrawerBody>
                <DrawerFooter>
                  <DrawerClose asChild>
                    <Button variant="ghost">{common('close')}</Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          ))}
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.overlays.smallTitle}>
        <div className="flex flex-wrap items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">{SHOWCASE_COPY.overlays.popoverTrigger}</Button>
            </PopoverTrigger>
            <PopoverContent withArrow>
              <PopoverHeader>
                <p className="text-sm font-medium text-ink">
                  {SHOWCASE_COPY.overlays.popoverHeading}
                </p>
              </PopoverHeader>
              <p className="text-sm text-ink-muted">{SHOWCASE_COPY.overlays.popoverBody}</p>
              <p data-numeric dir="ltr" className="force-ltr mt-2 text-sm text-ink">
                {SHOWCASE_COPY.rtl.ibanValue}
              </p>
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">{SHOWCASE_COPY.overlays.tooltipTrigger}</Button>
            </TooltipTrigger>
            <TooltipContent>
              {SHOWCASE_COPY.overlays.tooltipBody}
              <TooltipShortcut>⌘K</TooltipShortcut>
            </TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" iconEnd={<ChevronDown className="size-4" />}>
                {SHOWCASE_COPY.overlays.menuTrigger}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{SHOWCASE_COPY.overlays.menuGroup}</DropdownMenuLabel>
              <DropdownMenuItem>{SHOWCASE_COPY.overlays.menuAccount}</DropdownMenuItem>
              <DropdownMenuItem>{SHOWCASE_COPY.overlays.menuSettings}</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{SHOWCASE_COPY.overlays.menuInvoices}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>2026</DropdownMenuItem>
                  <DropdownMenuItem>2025</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger">
                <LogOut className="size-4" aria-hidden="true" />
                {SHOWCASE_COPY.overlays.menuLogout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.overlays.paletteTitle} note={SHOWCASE_COPY.overlays.paletteNote}>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            iconStart={<CommandIcon className="size-4" />}
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            {SHOWCASE_COPY.overlays.paletteOpen}
          </Button>
          <CommandPaletteKey>⌘K</CommandPaletteKey>
        </div>
        <CommandPalette
          items={paletteItems}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          label={SHOWCASE_COPY.overlays.paletteLabel}
          placeholder={SHOWCASE_COPY.overlays.palettePlaceholder}
          emptyTitle={SHOWCASE_COPY.overlays.paletteEmpty}
          emptyDescription={SHOWCASE_COPY.overlays.paletteEmptyHint}
          closeLabel={closeLabel}
          footer={
            <>
              <CommandPaletteKey>↵</CommandPaletteKey>
              <span>{SHOWCASE_COPY.overlays.paletteFooterEnter}</span>
            </>
          }
        />
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Data display
   ═══════════════════════════════════════════════════════════════════════════ */

const BADGE_TONES: readonly BadgeTone[] = [
  'neutral',
  'strait',
  'deep',
  'brass',
  'success',
  'warn',
  'danger',
];

const BADGE_VARIANTS: readonly BadgeVariant[] = ['soft', 'solid', 'outline'];

const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  PENDING_EMAIL: 'E-mail à confirmer',
  PENDING_APPROVAL: 'En attente de validation',
  ACTIVE: 'Actif',
  REJECTED: 'Refusé',
  SUSPENDED: 'Suspendu',
};

const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  AWAITING_RECEIPT: 'Justificatif attendu',
  UNDER_REVIEW: 'En vérification',
  INFO_REQUESTED: 'Information demandée',
  APPROVED: 'Approuvée',
  REJECTED: 'Refusée',
  EXPIRED: 'Expirée',
  CANCELLED: 'Annulée',
};

const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  ACTIVE: 'En cours',
  COMPLETED: 'Terminée',
  EXPIRED: 'Expirée',
  REVOKED: 'Révoquée',
};

const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  DRAFT: 'Brouillon',
  REVIEW: 'En relecture',
  PUBLISHED: 'Publiée',
  SCHEDULED: 'Programmée',
  ARCHIVED: 'Archivée',
};

const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  SUBMITTED: 'Rendu',
  GRADED: 'Noté',
  RETURNED: 'À reprendre',
};

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: 'En file',
  RUNNING: 'En cours',
  DONE: 'Terminée',
  FAILED: 'Échouée',
};

const AVATAR_SIZES: readonly AvatarSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

interface DemoRequestRow {
  readonly id: string;
  readonly student: string;
  readonly course: string;
  readonly amountCentimes: number;
  readonly status: RequestStatus;
  readonly submittedAt: string;
}

/**
 * Demo rows for the table. This route is a design surface, not a product path:
 * nothing here is read by, or written to, the application.
 */
const DEMO_ROWS: readonly DemoRequestRow[] = [
  {
    id: 'req-1',
    student: 'Amina El Fassi',
    course: SHOWCASE_COPY.application.courseTitleOne,
    amountCentimes: 120_000,
    status: 'UNDER_REVIEW',
    submittedAt: '2026-05-04T09:12:00.000Z',
  },
  {
    id: 'req-2',
    student: 'Youssef Berrada',
    course: SHOWCASE_COPY.application.courseTitleTwo,
    amountCentimes: 240_000,
    status: 'APPROVED',
    submittedAt: '2026-05-03T14:41:00.000Z',
  },
  {
    id: 'req-3',
    student: 'Salma Ouazzani',
    course: SHOWCASE_COPY.application.courseTitleThree,
    amountCentimes: 90_000,
    status: 'INFO_REQUESTED',
    submittedAt: '2026-05-02T08:05:00.000Z',
  },
  {
    id: 'req-4',
    student: 'Karim Bennani',
    course: SHOWCASE_COPY.application.courseTitleOne,
    amountCentimes: 120_000,
    status: 'AWAITING_RECEIPT',
    submittedAt: '2026-04-29T16:30:00.000Z',
  },
  {
    id: 'req-5',
    student: 'Nadia Cherkaoui',
    course: SHOWCASE_COPY.application.courseTitleTwo,
    amountCentimes: 240_000,
    status: 'REJECTED',
    submittedAt: '2026-04-28T11:02:00.000Z',
  },
  {
    id: 'req-6',
    student: 'Omar Tazi',
    course: SHOWCASE_COPY.application.courseTitleThree,
    amountCentimes: 0,
    status: 'CANCELLED',
    submittedAt: '2026-04-27T18:20:00.000Z',
  },
];

function DataSection({ title, demoPage }: { title: string; demoPage: number }): React.JSX.Element {
  const common = useTranslations('common');
  const a11y = useTranslations('a11y');
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;

  const [rating, setRating] = useState(4);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'submittedAt', desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 3 });
  const [selection, setSelection] = useState<RowSelectionState>({});

  /** The showcase owns the "server": it really sorts and really paginates. */
  const sortedRows = useMemo<readonly DemoRequestRow[]>(() => {
    const entry = sorting[0];
    if (entry === undefined) return DEMO_ROWS;

    const compare = (a: DemoRequestRow, b: DemoRequestRow): number => {
      switch (entry.id) {
        case 'student':
          return a.student.localeCompare(b.student, locale);
        case 'course':
          return a.course.localeCompare(b.course, locale);
        case 'amountCentimes':
          return a.amountCentimes - b.amountCentimes;
        case 'status':
          return a.status.localeCompare(b.status);
        default:
          return a.submittedAt.localeCompare(b.submittedAt);
      }
    };

    return [...DEMO_ROWS].sort((a, b) => (entry.desc ? compare(b, a) : compare(a, b)));
  }, [locale, sorting]);

  const pageRows = useMemo<DemoRequestRow[]>(() => {
    const start = pagination.pageIndex * pagination.pageSize;
    return sortedRows.slice(start, start + pagination.pageSize);
  }, [pagination.pageIndex, pagination.pageSize, sortedRows]);

  const columns = useMemo<ColumnDef<DemoRequestRow>[]>(
    () => [
      {
        accessorKey: 'student',
        header: SHOWCASE_COPY.data.colStudent,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Avatar name={row.original.student} size="sm" />
            <span className="min-w-0 truncate">{row.original.student}</span>
          </span>
        ),
      },
      { accessorKey: 'course', header: SHOWCASE_COPY.data.colCourse },
      {
        accessorKey: 'amountCentimes',
        header: SHOWCASE_COPY.data.colAmount,
        cell: ({ row }) => (
          <span data-numeric dir="ltr" className="force-ltr">
            {formatMoney(row.original.amountCentimes, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: SHOWCASE_COPY.data.colStatus,
        enableSorting: false,
        cell: ({ row }) => (
          <StatusPill
            domain="request"
            status={row.original.status}
            label={REQUEST_STATUS_LABELS[row.original.status]}
          />
        ),
      },
      {
        accessorKey: 'submittedAt',
        header: SHOWCASE_COPY.data.colDate,
        cell: ({ row }) => (
          <span data-numeric dir="ltr" className="force-ltr">
            {formatDate(row.original.submittedAt, locale)}
          </span>
        ),
      },
    ],
    [locale],
  );

  const renderCard = useCallback(
    (row: Row<DemoRequestRow>): React.ReactNode => (
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.original.student} size="sm" />
            <span className="min-w-0 truncate font-medium text-ink">{row.original.student}</span>
          </span>
          <StatusPill
            domain="request"
            status={row.original.status}
            label={REQUEST_STATUS_LABELS[row.original.status]}
          />
        </div>
        <p className="text-sm text-ink-muted">{row.original.course}</p>
        <p className="flex flex-wrap items-baseline gap-3 text-sm">
          <span data-numeric dir="ltr" className="force-ltr font-medium text-brass">
            {formatMoney(row.original.amountCentimes, locale)}
          </span>
          <span data-numeric dir="ltr" className="force-ltr text-ink-muted">
            {formatDate(row.original.submittedAt, locale)}
          </span>
        </p>
      </div>
    ),
    [locale],
  );

  const firstRow = pagination.pageIndex * pagination.pageSize + 1;
  const lastRow = Math.min(firstRow + pageRows.length - 1, sortedRows.length);

  return (
    <SectionShell id="data" title={title} rule={SHOWCASE_COPY.rules.data}>
      <Panel title={SHOWCASE_COPY.data.badgesTitle} note={SHOWCASE_COPY.data.badgesNote}>
        {BADGE_VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            {BADGE_TONES.map((tone) => (
              <Badge key={tone} tone={tone} variant={variant} size="md">
                {tone}
              </Badge>
            ))}
          </Row>
        ))}
      </Panel>

      <Panel title={SHOWCASE_COPY.data.statusTitle} note={SHOWCASE_COPY.data.statusNote}>
        <Row label={SHOWCASE_COPY.data.statusAccount}>
          {(Object.keys(ACCOUNT_STATUS_LABELS) as AccountStatus[]).map((status) => (
            <StatusPill
              key={status}
              domain="account"
              status={status}
              label={ACCOUNT_STATUS_LABELS[status]}
            />
          ))}
        </Row>
        <Row label={SHOWCASE_COPY.data.statusRequest}>
          {(Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[]).map((status) => (
            <StatusPill
              key={status}
              domain="request"
              status={status}
              label={REQUEST_STATUS_LABELS[status]}
            />
          ))}
        </Row>
        <Row label={SHOWCASE_COPY.data.statusEnrollment}>
          {(Object.keys(ENROLLMENT_STATUS_LABELS) as EnrollmentStatus[]).map((status) => (
            <StatusPill
              key={status}
              domain="enrollment"
              status={status}
              label={ENROLLMENT_STATUS_LABELS[status]}
            />
          ))}
        </Row>
        <Row label={SHOWCASE_COPY.data.statusCourse}>
          {(Object.keys(COURSE_STATUS_LABELS) as CourseStatus[]).map((status) => (
            <StatusPill
              key={status}
              domain="course"
              status={status}
              label={COURSE_STATUS_LABELS[status]}
            />
          ))}
        </Row>
        <Row label={SHOWCASE_COPY.data.statusSubmission}>
          {(Object.keys(SUBMISSION_STATUS_LABELS) as SubmissionStatus[]).map((status) => (
            <StatusPill
              key={status}
              domain="submission"
              status={status}
              label={SUBMISSION_STATUS_LABELS[status]}
            />
          ))}
        </Row>
        <Row label={SHOWCASE_COPY.data.statusJob}>
          {(Object.keys(JOB_STATUS_LABELS) as JobStatus[]).map((status) => (
            <StatusPill key={status} domain="job" status={status} label={JOB_STATUS_LABELS[status]} />
          ))}
        </Row>
      </Panel>

      <Panel title={SHOWCASE_COPY.data.avatarsTitle}>
        <div className="flex flex-wrap items-end gap-3">
          {AVATAR_SIZES.map((size) => (
            <Avatar key={size} name="Amina El Fassi" size={size} ring />
          ))}
          <Avatar name="Youssef Berrada" size="lg" shape="square" />
          <Avatar name="" size="lg" />
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.data.progressTitle}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <ProgressBar
              value={45}
              size="md"
              showLabel
              label={SHOWCASE_COPY.data.progressBarLabel}
              valueText="45 %"
            />
            <ProgressBar value={82} tone="success" label={SHOWCASE_COPY.data.progressBarLabel} valueText="82 %" />
            <ProgressBar value={12} tone="warn" label={SHOWCASE_COPY.data.progressBarLabel} valueText="12 %" />
            <ProgressBar value={100} tone="brass" label={SHOWCASE_COPY.data.progressBarLabel} valueText="100 %" />
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <ProgressRing value={72} size="md" label={SHOWCASE_COPY.data.progressRingLabel} valueText="72 %">
              <span data-numeric dir="ltr" className="force-ltr text-sm text-ink">
                72 %
              </span>
            </ProgressRing>
            <ProgressRing
              value={100}
              size="lg"
              tone="brass"
              label={SHOWCASE_COPY.data.progressRingLabel}
              valueText="100 %"
            >
              <Award className="size-6 text-brass" aria-hidden="true" />
            </ProgressRing>
            <ProgressRing value={28} size="sm" tone="warn" label={SHOWCASE_COPY.data.progressRingLabel} />
          </div>
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.data.stepperTitle}>
        <Stepper
          current={2}
          label={SHOWCASE_COPY.data.stepperLabel}
          stepStatusLabels={{
            done: SHOWCASE_COPY.data.stepDone,
            current: SHOWCASE_COPY.data.stepCurrent,
            upcoming: SHOWCASE_COPY.data.stepUpcoming,
          }}
          steps={[
            { id: 'price', label: SHOWCASE_COPY.data.stepPrice, description: SHOWCASE_COPY.data.stepPriceHint },
            { id: 'receipt', label: SHOWCASE_COPY.data.stepReceipt, description: SHOWCASE_COPY.data.stepReceiptHint },
            { id: 'confirm', label: SHOWCASE_COPY.data.stepConfirm, description: SHOWCASE_COPY.data.stepConfirmHint },
          ]}
        />

        <Timeline
          label={SHOWCASE_COPY.data.timelineLabel}
          stateLabels={{
            done: SHOWCASE_COPY.data.timelineStateDone,
            current: SHOWCASE_COPY.data.timelineStateCurrent,
            pending: SHOWCASE_COPY.data.timelineStatePending,
            warning: SHOWCASE_COPY.data.timelineStateWarning,
            error: SHOWCASE_COPY.data.timelineStateError,
          }}
          nodes={[
            {
              id: 'sent',
              label: SHOWCASE_COPY.data.timelineSent,
              state: 'done',
              timestamp: formatDate('2026-05-02T08:05:00.000Z', locale),
            },
            {
              id: 'received',
              label: SHOWCASE_COPY.data.timelineReceived,
              state: 'current',
              timestamp: formatDate('2026-05-03T14:41:00.000Z', locale),
            },
            { id: 'review', label: SHOWCASE_COPY.data.timelineReview, state: 'pending' },
            {
              id: 'info',
              label: SHOWCASE_COPY.data.timelineInfo,
              state: 'warning',
              description: SHOWCASE_COPY.data.timelineInfoBody,
              content: (
                <Button size="sm" variant="secondary">
                  {SHOWCASE_COPY.inputs.dropzoneBrowse}
                </Button>
              ),
            },
            {
              id: 'rejected',
              label: SHOWCASE_COPY.data.timelineRejected,
              state: 'error',
              description: SHOWCASE_COPY.data.timelineRejectedBody,
            },
          ]}
        />
      </Panel>

      <Panel title={SHOWCASE_COPY.data.statsTitle}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={SHOWCASE_COPY.data.statStudents}
            value="1 284"
            icon={<Users />}
            trend={{ direction: 'up', label: SHOWCASE_COPY.data.statTrendUp, intent: 'positive' }}
          />
          <StatCard
            label={SHOWCASE_COPY.data.statRevenue}
            value={formatMoney(4_820_000, locale)}
            tone="brass"
            icon={<Wallet />}
            hint={SHOWCASE_COPY.data.statHint}
          />
          <StatCard
            label={SHOWCASE_COPY.data.statCompletion}
            value="68 %"
            icon={<BookOpen />}
            trend={{ direction: 'down', label: SHOWCASE_COPY.data.statTrendDown, intent: 'negative' }}
            footer={<ProgressBar value={68} label={SHOWCASE_COPY.data.statCompletion} valueText="68 %" />}
          />
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.data.ratingTitle}>
        <Row label={SHOWCASE_COPY.data.ratingReadonly}>
          <Rating
            value={4.3}
            label={SHOWCASE_COPY.data.ratingLabel}
            valueText={SHOWCASE_COPY.data.ratingValueText('4,3', 5)}
            caption="4,3 (126)"
          />
        </Row>
        <Row label={SHOWCASE_COPY.data.ratingInteractive}>
          <Rating
            value={rating}
            onValueChange={setRating}
            size="lg"
            label={SHOWCASE_COPY.data.ratingLabel}
            valueText={SHOWCASE_COPY.data.ratingValueText(String(rating), 5)}
          />
          <Rating value={3} disabled onValueChange={() => undefined} label={SHOWCASE_COPY.data.ratingLabel} />
        </Row>

        <div className="flex flex-wrap items-start gap-8">
          <PriceTag centimes={120_000} locale={locale} size="lg" note={SHOWCASE_COPY.data.priceNote} />
          <PriceTag
            centimes={90_000}
            compareAtCentimes={150_000}
            locale={locale}
            size="lg"
            compareAtSrLabel={SHOWCASE_COPY.data.priceCompareLabel}
            discountSrLabel={SHOWCASE_COPY.data.priceDiscountLabel}
          />
          <PriceTag centimes={0} locale={locale} size="lg" freeLabel={SHOWCASE_COPY.data.priceFree} />
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.data.navigationTitle}>
        <Breadcrumbs
          label={a11y('breadcrumb')}
          items={[
            { label: SHOWCASE_COPY.data.breadcrumbHome, href: '/' },
            { label: SHOWCASE_COPY.data.breadcrumbShowcase, href: '/showcase' },
            { label: SHOWCASE_COPY.data.breadcrumbCurrent },
          ]}
        />

        <Pagination
          page={demoPage}
          totalPages={12}
          hrefForPage={(value) => `/showcase?page=${value}#data`}
          labels={{
            nav: SHOWCASE_COPY.data.paginationNav,
            previous: common('previous'),
            next: common('next'),
            page: (value) => a11y('page', { number: value }),
            ellipsis: SHOWCASE_COPY.data.paginationEllipsis,
          }}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <Tabs defaultValue="content" variant="line">
              <TabsList>
                <TabsTrigger value="content">{SHOWCASE_COPY.data.tabContent}</TabsTrigger>
                <TabsTrigger value="program">{SHOWCASE_COPY.data.tabProgram}</TabsTrigger>
                <TabsTrigger value="notes" disabled>
                  {SHOWCASE_COPY.data.tabNotes}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="content">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyContent}</p>
              </TabsContent>
              <TabsContent value="program">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyProgram}</p>
              </TabsContent>
              <TabsContent value="notes">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyNotes}</p>
              </TabsContent>
            </Tabs>

            <Tabs defaultValue="content" variant="pill">
              <TabsList>
                <TabsTrigger value="content">{SHOWCASE_COPY.data.tabContent}</TabsTrigger>
                <TabsTrigger value="program">{SHOWCASE_COPY.data.tabProgram}</TabsTrigger>
              </TabsList>
              <TabsContent value="content">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyContent}</p>
              </TabsContent>
              <TabsContent value="program">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyProgram}</p>
              </TabsContent>
            </Tabs>

            <Tabs defaultValue="content" variant="strip">
              <TabsList>
                <TabsTrigger value="content">{SHOWCASE_COPY.data.tabContent}</TabsTrigger>
                <TabsTrigger value="program">{SHOWCASE_COPY.data.tabProgram}</TabsTrigger>
                <TabsTrigger value="notes">{SHOWCASE_COPY.data.tabNotes}</TabsTrigger>
                <TabsTrigger value="transcript">{SHOWCASE_COPY.data.tabTranscript}</TabsTrigger>
                <TabsTrigger value="discussion">{SHOWCASE_COPY.data.tabDiscussion}</TabsTrigger>
              </TabsList>
              <TabsContent value="content">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyContent}</p>
              </TabsContent>
              <TabsContent value="program">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyProgram}</p>
              </TabsContent>
              <TabsContent value="notes">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyNotes}</p>
              </TabsContent>
              <TabsContent value="transcript">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyContent}</p>
              </TabsContent>
              <TabsContent value="discussion">
                <p className="text-sm text-ink-muted">{SHOWCASE_COPY.data.tabBodyContent}</p>
              </TabsContent>
            </Tabs>
          </div>

          <Accordion type="single" collapsible defaultValue="module-1">
            {[1, 2, 3].map((index) => (
              <AccordionItem key={index} value={`module-${index}`}>
                <AccordionTrigger meta={SHOWCASE_COPY.data.accordionMeta}>
                  {SHOWCASE_COPY.data.accordionModule(index)}
                </AccordionTrigger>
                <AccordionContent>{SHOWCASE_COPY.data.accordionBody}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.data.tableTitle} note={SHOWCASE_COPY.data.tableNote}>
        <DataTable
          data={pageRows}
          columns={columns}
          getRowId={(row) => row.id}
          pagination={pagination}
          onPaginationChange={setPagination}
          pageCount={Math.max(1, Math.ceil(sortedRows.length / pagination.pageSize))}
          sorting={sorting}
          onSortingChange={setSorting}
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          bulkActions={(ids) => (
            <Button size="sm" variant="secondary" onClick={() => setSelection({})}>
              {`${SHOWCASE_COPY.data.tableApprove} (${ids.length})`}
            </Button>
          )}
          renderCard={renderCard}
          labels={{
            caption: SHOWCASE_COPY.data.tableCaption,
            columnsMenu: SHOWCASE_COPY.data.tableColumns,
            selectAll: SHOWCASE_COPY.data.tableSelectAll,
            selectRow: SHOWCASE_COPY.data.tableSelectRow,
            selectionSummary: SHOWCASE_COPY.data.tableSelection(
              Object.values(selection).filter(Boolean).length,
            ),
            clearSelection: SHOWCASE_COPY.data.tableClearSelection,
            previousPage: SHOWCASE_COPY.data.tablePrevious,
            nextPage: SHOWCASE_COPY.data.tableNext,
            pageSummary: SHOWCASE_COPY.data.tableSummary(firstRow, lastRow, sortedRows.length),
            loading: SHOWCASE_COPY.data.tableLoading,
            emptyTitle: SHOWCASE_COPY.data.tableEmpty,
            emptyDescription: SHOWCASE_COPY.data.tableEmptyHint,
            errorTitle: SHOWCASE_COPY.data.tableError,
            retry: SHOWCASE_COPY.data.tableRetry,
          }}
        />
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Application
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Demonstration course covers.
 *
 * A `data:` image is an asset, not a styled element: it is decoded outside the
 * document and cannot read a CSS custom property, so its colours have to be
 * literal. This is the same, documented exception `whatsapp-fab.tsx` takes for
 * the WhatsApp green — the values are written once, here, and they mirror
 * `--raw-accent-deep` and `--raw-accent-strait` so the covers stay on-palette.
 */
const COVER_INK = '#0e4c6b';
const COVER_ACCENT = '#2fe3be';
const COVER_BACKDROP = '#0d1522';

function coverDataUrl(seed: number): string {
  const rotation = seed * 37;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="presentation">',
    `<rect width="640" height="360" fill="${COVER_BACKDROP}"/>`,
    `<g fill="none" stroke="${COVER_INK}" stroke-width="2" opacity="0.85">`,
    `<circle cx="${140 + seed * 40}" cy="180" r="150"/>`,
    `<circle cx="${140 + seed * 40}" cy="180" r="104"/>`,
    '</g>',
    `<g transform="translate(430 180) rotate(${rotation})" fill="none" stroke="${COVER_ACCENT}" stroke-width="3" opacity="0.9">`,
    '<rect x="-70" y="-70" width="140" height="140" rx="6"/>',
    '<rect x="-70" y="-70" width="140" height="140" rx="6" transform="rotate(45)"/>',
    '</g>',
    '</svg>',
  ].join('');

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A demonstration number, never a real one. */
const DEMO_WHATSAPP_NUMBER = '+212600000000';

function ApplicationSection({ title }: { title: string }): React.JSX.Element {
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : defaultLocale;

  const latticeTiles = useMemo<readonly LatticeTile[]>(
    () =>
      [
        SHOWCASE_COPY.application.courseTitleOne,
        SHOWCASE_COPY.application.courseTitleTwo,
        SHOWCASE_COPY.application.courseTitleThree,
        SHOWCASE_COPY.inputs.categoryFinance,
        SHOWCASE_COPY.inputs.categoryLanguages,
        SHOWCASE_COPY.inputs.categoryManagement,
      ].map((label, index) => ({
        id: `lattice-${index}`,
        label,
        intensity: 0.2 + index * 0.15,
        href: '/showcase',
        state: index === 2 ? ('active' as const) : undefined,
      })),
    [],
  );

  return (
    <SectionShell id="application" title={title} rule={SHOWCASE_COPY.rules.application}>
      <Panel
        title={SHOWCASE_COPY.application.controlsTitle}
        note={SHOWCASE_COPY.application.controlsNote}
      >
        <div className="flex flex-wrap items-center gap-3">
          <LocaleSwitcher
            label={SHOWCASE_COPY.application.localeLabel}
            variant="full"
            beta={{ locales: ['ar'], label: SHOWCASE_COPY.application.betaLabel }}
          />
          <ThemeToggle
            switchToLightLabel={SHOWCASE_COPY.application.switchToLight}
            switchToDarkLabel={SHOWCASE_COPY.application.switchToDark}
            lightEnabledMessage={SHOWCASE_COPY.application.lightEnabled}
            darkEnabledMessage={SHOWCASE_COPY.application.darkEnabled}
          />
          <ThemeToggle
            showLabel
            switchToLightLabel={SHOWCASE_COPY.application.switchToLight}
            switchToDarkLabel={SHOWCASE_COPY.application.switchToDark}
            lightEnabledMessage={SHOWCASE_COPY.application.lightEnabled}
            darkEnabledMessage={SHOWCASE_COPY.application.darkEnabled}
          />
        </div>
      </Panel>

      <Panel
        title={SHOWCASE_COPY.application.whatsappTitle}
        note={SHOWCASE_COPY.application.whatsappNote}
      >
        <p data-numeric dir="ltr" className="force-ltr text-sm text-ink-muted">
          {DEMO_WHATSAPP_NUMBER}
        </p>
        <WhatsAppFab
          phone={DEMO_WHATSAPP_NUMBER}
          message={SHOWCASE_COPY.application.whatsappMessage}
          label={SHOWCASE_COPY.application.whatsappLabel}
          bubble={{
            text: SHOWCASE_COPY.application.whatsappBubble,
            dismissLabel: SHOWCASE_COPY.application.whatsappDismiss,
          }}
        />
      </Panel>

      <Panel title={SHOWCASE_COPY.application.coursesTitle} note={SHOWCASE_COPY.application.coursesNote}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CourseCard
            href="/showcase"
            variant="grid"
            title={SHOWCASE_COPY.application.courseTitleOne}
            category={SHOWCASE_COPY.application.courseCategory}
            image={{ src: coverDataUrl(1), alt: SHOWCASE_COPY.application.courseAlt }}
            badge={{ text: SHOWCASE_COPY.application.courseBadge, tone: 'strait' }}
            level={{
              value: SHOWCASE_COPY.application.courseLevel,
              label: SHOWCASE_COPY.application.courseLevelLabel,
            }}
            duration={{
              value: SHOWCASE_COPY.application.courseDuration,
              label: SHOWCASE_COPY.application.courseDurationLabel,
            }}
            lessons={{
              value: SHOWCASE_COPY.application.courseLessons,
              label: SHOWCASE_COPY.application.courseLessonsLabel,
            }}
            rating={{ value: '4,8', count: '126', label: SHOWCASE_COPY.application.courseRatingLabel }}
            priceSlot={
              <PriceTag
                centimes={120_000}
                compareAtCentimes={150_000}
                locale={locale}
                compareAtSrLabel={SHOWCASE_COPY.data.priceCompareLabel}
                discountSrLabel={SHOWCASE_COPY.data.priceDiscountLabel}
              />
            }
          />

          <div className="flex flex-col gap-4">
            <CourseCard
              href="/showcase"
              variant="list"
              title={SHOWCASE_COPY.application.courseTitleTwo}
              category={SHOWCASE_COPY.application.courseCategoryTwo}
              image={{ src: coverDataUrl(2), alt: SHOWCASE_COPY.application.courseAlt }}
              duration={{
                value: SHOWCASE_COPY.application.courseDuration,
                label: SHOWCASE_COPY.application.courseDurationLabel,
              }}
              progress={{
                ratio: 0.45,
                label: SHOWCASE_COPY.application.courseProgressLabel,
                valueLabel: '45 %',
              }}
              priceSlot={<PriceTag centimes={240_000} locale={locale} />}
            />

            <CourseCard
              href="/showcase"
              variant="compact"
              title={SHOWCASE_COPY.application.courseTitleThree}
              image={{ src: coverDataUrl(3), alt: SHOWCASE_COPY.application.courseAlt }}
              lessons={{
                value: SHOWCASE_COPY.application.courseLessons,
                label: SHOWCASE_COPY.application.courseLessonsLabel,
              }}
              priceSlot={
                <PriceTag centimes={0} locale={locale} size="sm" freeLabel={SHOWCASE_COPY.data.priceFree} />
              }
            />
          </div>
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.application.latticeTitle} note={SHOWCASE_COPY.application.latticeNote}>
        <LatticeGrid
          tiles={latticeTiles}
          label={SHOWCASE_COPY.application.latticeLabel}
          density={6}
          rows={2}
          seed="cfi-showcase"
          className="max-w-3xl"
        />
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Motion
   ═══════════════════════════════════════════════════════════════════════════ */

function MotionSection({ title }: { title: string }): React.JSX.Element {
  const { reduced, variants } = useReducedMotionSafe();
  const { sign } = useDirection();
  const [run, setRun] = useState(0);

  const container = variants({
    hidden: {},
    shown: { transition: { staggerChildren: 0.06 } },
  });

  const item = variants({
    hidden: { opacity: 0, y: 12 },
    shown: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
  });

  const inline = variants({
    hidden: { opacity: 0, x: 24 * sign },
    shown: { opacity: 1, x: 0, transition: { duration: 0.28, ease: 'easeOut' } },
  });

  return (
    <SectionShell id="motion" title={title} rule={SHOWCASE_COPY.rules.motion}>
      <Panel title={SHOWCASE_COPY.motion.sequenceTitle} note={SHOWCASE_COPY.motion.sequenceNote}>
        <Button variant="secondary" onClick={() => setRun((value) => value + 1)}>
          {SHOWCASE_COPY.motion.replay}
        </Button>

        <motion.ul
          key={run}
          role="list"
          variants={container}
          initial="hidden"
          animate="shown"
          className="flex flex-col gap-2"
        >
          {[
            SHOWCASE_COPY.motion.stepOne,
            SHOWCASE_COPY.motion.stepTwo,
            SHOWCASE_COPY.motion.stepThree,
            SHOWCASE_COPY.motion.stepFour,
          ].map((label, index) => (
            <motion.li
              key={label}
              variants={index === 2 ? inline : item}
              className="rounded-sm border border-hairline bg-raised px-3 py-2 text-sm text-ink"
            >
              {label}
            </motion.li>
          ))}
        </motion.ul>
      </Panel>

      <Panel title={SHOWCASE_COPY.motion.hoverTitle} note={SHOWCASE_COPY.motion.hoverNote}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Card key={index} interactive padding="md" className="flex flex-col gap-2">
              <CardTitle as="h4" className="text-body">
                {SHOWCASE_COPY.motion.hoverCard}
              </CardTitle>
              <CardDescription>{SHOWCASE_COPY.motion.hoverCardBody}</CardDescription>
            </Card>
          ))}
        </div>
      </Panel>

      <Panel title={SHOWCASE_COPY.motion.reducedTitle}>
        <Alert variant={reduced ? 'success' : 'info'} title={SHOWCASE_COPY.motion.reducedTitle}>
          {reduced ? SHOWCASE_COPY.motion.reducedOn : SHOWCASE_COPY.motion.reducedOff}
        </Alert>
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Reading direction
   ═══════════════════════════════════════════════════════════════════════════ */

function DirectionDemo({ forced }: { forced: 'ltr' | 'rtl' }): React.JSX.Element {
  const isArabic = forced === 'rtl';

  return (
    <div
      dir={forced}
      lang={isArabic ? 'ar' : 'fr'}
      className="flex min-w-0 flex-col gap-4 rounded-sm border border-hairline bg-raised p-4"
    >
      <p className="font-mono text-xs tracking-wide text-ink-muted uppercase" dir="ltr">
        dir=&quot;{forced}&quot;
      </p>

      <p className="text-body text-ink">
        {isArabic ? SHOWCASE_COPY.rtl.paragraphAr : SHOWCASE_COPY.rtl.paragraphFr}
      </p>

      <div className="hairline-t flex flex-wrap items-center gap-3 pt-3">
        <Button
          size="sm"
          variant="secondary"
          /* Direction-carrying icon: mirrored. */
          iconStart={<ArrowRight className="size-4 rotate-180 rtl:-scale-x-100" />}
        >
          {SHOWCASE_COPY.rtl.back}
        </Button>
        <Button size="sm" iconEnd={<ArrowRight className="size-4 rtl:-scale-x-100" />}>
          {SHOWCASE_COPY.rtl.next}
        </Button>
        {/* A checkmark reads the same in both directions and is never mirrored. */}
        <Badge tone="success" icon={<Check aria-hidden="true" />}>
          {SHOWCASE_COPY.data.timelineStateDone}
        </Badge>
      </div>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <dt className="text-ink-muted">{SHOWCASE_COPY.rtl.reference}</dt>
          <dd data-numeric dir="ltr" className="force-ltr text-ink">
            {SHOWCASE_COPY.rtl.referenceValue}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <dt className="text-ink-muted">{SHOWCASE_COPY.rtl.iban}</dt>
          <dd data-numeric dir="ltr" className="force-ltr text-ink">
            {SHOWCASE_COPY.rtl.ibanValue}
          </dd>
        </div>
      </dl>

      {/* ps-/border-s follow the reading direction: the rule swaps sides with no
          extra class. */}
      <p className="hairline-s ps-3 text-sm text-ink-muted">
        {SHOWCASE_COPY.rtl.controlsNote}
      </p>
    </div>
  );
}

function RtlSection({ title }: { title: string }): React.JSX.Element {
  const { dir } = useDirection();
  const switchId = useId();
  const [forced, setForced] = useState(false);
  const preview: 'ltr' | 'rtl' = forced ? 'rtl' : dir;

  return (
    <SectionShell id="rtl" title={title} rule={SHOWCASE_COPY.rules.rtl}>
      <Panel title={SHOWCASE_COPY.rtl.paragraphTitle} note={SHOWCASE_COPY.rtl.paragraphNote}>
        <div className="flex items-center gap-3">
          <Switch id={switchId} checked={forced} onCheckedChange={setForced} />
          <label htmlFor={switchId} className="cursor-pointer text-sm text-ink">
            {SHOWCASE_COPY.rtl.forceRtl}
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DirectionDemo forced={preview} />
          <DirectionDemo forced={preview === 'rtl' ? 'ltr' : 'rtl'} />
        </div>
      </Panel>
    </SectionShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Root
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ShowcaseSectionsProps {
  /** Current page of the pagination demo, read from `?page=` by the server. */
  demoPage: number;
}

export function ShowcaseSections({ demoPage }: ShowcaseSectionsProps): React.JSX.Element {
  const t = useTranslations('showcase');
  const common = useTranslations('common');

  const sections = useMemo<readonly ShowcaseNavItem[]>(
    () => [
      { id: 'colors', label: t('sections.colors') },
      { id: 'typography', label: t('sections.typography') },
      { id: 'buttons', label: t('sections.buttons') },
      { id: 'inputs', label: t('sections.inputs') },
      { id: 'feedback', label: t('sections.feedback') },
      { id: 'overlays', label: t('sections.overlays') },
      { id: 'data', label: t('sections.dataDisplay') },
      { id: 'application', label: SHOWCASE_COPY.applicationSection },
      { id: 'motion', label: t('sections.motion') },
      { id: 'rtl', label: t('sections.rtl') },
    ],
    [t],
  );

  const labelFor = useCallback(
    (id: ShowcaseSectionId): string =>
      sections.find((section) => section.id === id)?.label ?? id,
    [sections],
  );

  return (
    <>
      <ShowcaseNav items={sections} label={SHOWCASE_COPY.navLabel} />

      <div className="flex min-w-0 flex-col gap-14 py-10">
        <ColourSection title={labelFor('colors')} />
        <TypographySection title={labelFor('typography')} />
        <ButtonsSection title={labelFor('buttons')} actionLabel={common('continue')} />
        <InputsSection
          title={labelFor('inputs')}
          optionalHint={common('optional')}
          requiredHint={common('required')}
        />
        <FeedbackSection title={labelFor('feedback')} />
        <OverlaysSection title={labelFor('overlays')} sections={sections} />
        <DataSection title={labelFor('data')} demoPage={demoPage} />
        <ApplicationSection title={labelFor('application')} />
        <MotionSection title={labelFor('motion')} />
        <RtlSection title={labelFor('rtl')} />
      </div>
    </>
  );
}
