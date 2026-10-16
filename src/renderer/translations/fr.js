// French translations
export const fr = {
  loading: {
    checkingCertificates: 'Vérification des certificats...',
    loadingCertificates: 'Chargement des certificats...',
    checkingNetwork: 'Vérification de la connexion réseau...',
    registeringDevice: 'Enregistrement de l\'appareil...',
    fetchingConfiguration: 'Récupération de la configuration...',
    initializingCamera: 'Initialisation de la caméra...',
    startingKiosk: 'Démarrage du kiosque...'
  },
  wifi: {
    setupRequired: 'Connectez-moi à Internet',
    holdQRCode: 'Tenez votre code QR WiFi devant la caméra'
  },
  booth: {
    priceOnly: "seulement",
    pressForPoetry: 'Appuyez pour Poésie',
    turnKnob: 'Tournez le bouton pour changer de style',
    turnAndPress: 'Tourne le bouton & Appuie',
    pressForMasterpiece: 'Appuie pour ton Chef-d’œuvre',
    tryingFree: 'Essayer est toujours gratuit',
    cta1: 'Appuie sur<br/>le Bouton',
    cta2: 'Essayer<br/>est Gratuit',
    inputBadge: 'Original',
    ctaPickStyle: 'Choisis<br/>ton Style',
    cta3: 'Obtiens ton<br/>Chef-d’œuvre !'
  },
  countdown: {
    // Les nombres sont universels, pas de traduction nécessaire
  },
  processing: {
    sendingToAI: 'Envoi de la photo à l\'IA...',
    creatingArtwork: 'Création de l\'œuvre...',
    uploadingImage: 'Téléchargement de l\'image...',
    complete: 'Terminé!',
    loadingMessages: [
      'Étude des œuvres des grands maîtres...',
      'Mélange des couleurs parfaites...',
      'Les bonnes choses prennent du temps...',
      'Capture de l\'essence du moment...',
      'Ajout d\'une touche de magie...',
      'Préparation de votre toile...',
      'Recherche de la lumière parfaite...',
      'L\'attente en vaut la peine, promis...',
      'Création de quelque chose de mémorable...',
      'Un moment de lenteur dans un monde rapide...',
      'Les grands portraits ne se pressent pas...',
      'Savourer ce moment créatif...',
      'Laisser les pixels se poser...',
      'Votre patience rend ceci spécial...',
      'Prendre le chemin des écoliers...',
      'La qualité avant la vitesse, toujours...',
      'Tout vient à point à qui sait attendre...',
      'Créer quelque chose qui vaut la peine...',
      'Un peu plus lent, beaucoup plus significatif...',
      'Créer avec intention...',
      'Presque terminé, restez avec nous...',
      'Préparation de votre chef-d\'œuvre...',
      'Certains moments méritent plus de temps...',
      'Technologie lente, art véritable...',
      'Patience, la beauté se prépare...'
    ]
  },
  result: {
    scanReceiptAndMore: "Scanne pour ton reçu,<br/>la version numérique et plus de tirages",
    upsellTerminalBusy: "Le terminal est occupé. Scanne le QR pour commander des tirages.",
    printingProgress: "Impression {n} sur {total}…",
    printingOne: "Impression…",
    printsComing: "Ton tirage arrive !",
    tryStyleCta: "Appuie pour essayer ce style",
    hintCompare: "Ou tournez pour comparer vos portraits",
    portraitN: "Portrait {n}",
    pickCta: "Appuyez pour choisir<br/>ce portrait",
    retakeCta: "Appuyez pour<br/>un autre style",
    keepCta: "Appuyez pour garder<br/>ce portrait",
    keepBadge: "Votre portrait",
    scanForDigital: "Scannez pour votre<br/>version numérique",
    scanToSave: 'Scannez pour sauvegarder',
    scanToPrintAndSave: 'Scannez pour Sauver<br/>et Imprimer',
    printForJust: 'Imprime pour seulement',
    scanQrNow: 'Scanne le QR code maintenant',
    holdToPrint: 'Maintenez le bouton pour imprimer',
    // Pay-first (terminal) flow
    pressToPrint: 'Appuyez pour imprimer',
    hintPrint: 'Ça vous plaît ? Appuyez sur le grand bouton pour imprimer tout de suite !',
    hintRetake: "Ou tournez pour un essai gratuit",
    hintPrinting: "Votre tirage arrive",
    hintUpsell: "Tournez pour des tirages en plus",
    hintDone: 'Terminé ! Scannez le QR code pour télécharger votre chef-d\'œuvre.',
    retakeTitle: "Nouvel essai gratuit",
    retakeSub: "Appuyez pour recommencer",
    retakeBody: "Tournez pour un autre style",
    upsellTitle: 'Tirages supplémentaires',
    upsellPrints: '+{count} tirage(s)',
    upsellTap: "Tapez votre carte",
    upsellScan: "Scannez pour payer",
    upsellUpdating: 'Mise à jour du montant…',
    upsellPaid: 'Payé ! Impression...',
    upsellFailed: 'Paiement refusé, tournez le bouton pour réessayer',
    upsellCancelled: 'Aucun paiement reçu'
  },
  retry: {
    retakeFailed: "Cela n'a malheureusement pas fonctionné. Votre premier portrait est conservé ; demandez à un membre du personnel si vous souhaitez l'imprimer.",
    retrying: "Un instant, nous réessayons…",
    blockedTitle: "Nous n'avons pas pu créer de portrait avec cette photo",
    blockedBody: "L'IA refuse parfois une photo, par exemple à cause d'un geste, d'un texte ou d'un logo sur un vêtement, ou si votre visage n'est pas bien visible.",
    errorTitle: "Un problème est survenu",
    errorBody: "Un problème est survenu lors de la création de votre portrait.",
    cta: "Appuyez sur le bouton pour une nouvelle photo. Vous avez déjà payé."
  },
  outOfService: {
    title: "Momentanément hors service",
    paper: "Le papier est en cours de remplacement. On revient tout de suite !",
    printer: "L’imprimante est en cours de vérification. On revient tout de suite !"
  },
  errorScreen: {
    noStyles: {"title":"Presque prêt","text":"Cette booth n'a pas encore de styles. L'organisateur peut définir des styles pour l'événement ou le hub ; la booth démarre ensuite toute seule."},
    notLinked: {"title":"Pas encore reliée","text":"Cette booth n'est reliée à aucun hub ni lieu. Demande à l'organisateur de la relier."},
    connection: {"title":"Pas de connexion","text":"La booth n'atteint pas Internet. Vérifie le WiFi ou le câble ; elle reprend dès que la connexion revient."},
    server: {"title":"Un instant","text":"Notre serveur ne répond pas pour le moment. Cela se règle généralement en une minute."},
    camera: {"title":"Caméra introuvable","text":"La booth ne voit pas la caméra. Vérifie qu'elle est branchée et qu'aucun autre programme ne l'utilise."},
    generic: {"title":"Petite pause","text":"Quelque chose n'a pas marché, rien d'inquiétant. On réessaie tout simplement."},
    pressButton: "Appuie sur le bouton pour réessayer",
    autoRetry: "Nouvel essai automatique dans {s} secondes"
  },
  paywall: {
    perPhoto: "par photo",
    total: "total {price}",
    paidTitle: "Payé !",
    paidSub: "Ton portrait est en cours de création",
    title: 'Prêt pour la transformation ?',
    scanToPay: "Scannez pour payer",
    terminalDown: 'Le terminal de paiement est indisponible, payez avec votre téléphone.',
    qrUpdating: "Création du QR code…",
    tap: 'Tapez votre carte pour libérer l\'IA !',
    turnForMore: "Tournez pour plus de tirages",
    onePrint: '1 tirage',
    nPrints: '{count} tirages',
    waitingTerminal: 'En attente du terminal…',
    updatingTerminal: 'Mise à jour du montant…',
    paid: 'Payé ! L\'IA se met au travail…',
    declined: 'Paiement refusé, veuillez réessayer',
    declinedFinal: 'Le paiement n\'a pas abouti. Appuyez sur le bouton pour recommencer.',
    retrying: 'Aucun paiement reçu, nouvel essai…',
    timeout: 'Aucun paiement reçu. Appuyez sur le bouton pour recommencer !'
  },
  terms: {
    agree: 'En commençant, vous acceptez nos conditions et notre politique de confidentialité'
  },
  countdown: {
    look: 'Regarde ici',
    ready: 'Prêt ?',
    pose: 'Pose',
    smile: 'Souris'
  },
  error: {
    somethingWentWrong: 'Quelque chose s\'est mal passé',
    pleaseTryAgain: 'Veuillez réessayer',
    buttonTryAgain: 'Bouton: Réessayer',
    generationFailed: 'Oups! L\'image ne s\'est pas générée correctement. Essayons une autre photo!',
    processingFailed: 'Cela n\'a pas fonctionné cette fois. Appuyez sur le bouton pour réessayer!',
    paymentRequired: "Le paiement n'a pas pu être confirmé. Appuyez sur le bouton pour recommencer.",
    terminalUnavailable: "Le terminal de paiement est indisponible pour le moment. Réessayez plus tard.",
    paymentFailed: "Le paiement n'a pas abouti. Appuyez sur le bouton pour recommencer.",
    generationFailedRefund: "Oups, cela n'a pas fonctionné cette fois. Votre paiement a été annulé. Appuyez sur le bouton pour réessayer !",
    generationFailedManualRefund: "Oups, cela n'a pas fonctionné cette fois. Votre paiement sera remboursé ; cela peut prendre quelques jours. Appuyez sur le bouton pour recommencer."
  }
};
