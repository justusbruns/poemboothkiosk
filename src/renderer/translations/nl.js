// Dutch translations
export const nl = {
  loading: {
    checkingCertificates: 'Certificaten controleren...',
    loadingCertificates: 'Certificaten laden...',
    checkingNetwork: 'Netwerkverbinding controleren...',
    registeringDevice: 'Apparaat registreren...',
    fetchingConfiguration: 'Configuratie ophalen...',
    initializingCamera: 'Camera initialiseren...',
    startingKiosk: 'Kiosk starten...'
  },
  wifi: {
    setupRequired: 'Verbind mij met internet',
    holdQRCode: 'Houd je wifi-QR-code voor de camera',
    waiting: 'Wachten op je wifi-QR-code...',
    detected: 'QR-code herkend! Verbinden...',
    connected: 'Verbonden! Setup gaat verder...',
    stillOffline: 'Nog steeds geen internet — houd je wifi-QR-code voor de camera',
    failed: 'Verbinden mislukt'
  },
  update: {
    available: 'Update beschikbaar',
    updating: 'Bijwerken...',
    skip: 'Overslaan',
    install: 'Installeren',
    hint: '← Draai aan de knop om te kiezen, druk om te bevestigen →',
    downloading: 'Downloaden... {percent}%',
    installing: 'Installeren...',
    downloadFailed: 'Download mislukt'
  },
  setup: {
    chooseLanguage: 'Kies je taal',
    languageHint: '← Draai aan de knop om te kiezen, druk om te bevestigen →',
    pairingTitle: 'Koppel deze booth',
    pairingIntro: 'Scan de QR-code met je telefoon, log in op je Poem Booth-account en bevestig de code hieronder.',
    pairingRequesting: 'Code aanvragen…',
    pairingWaiting: 'Wachten op goedkeuring op je telefoon…',
    pairingExpired: 'Code verlopen — nieuwe code ophalen…',
    pairingNoConnection: 'Geen verbinding — opnieuw proberen…',
    pairingHiccup: 'Verbinding hapert — nog even wachten…',
    pairingError: 'Koppelfout: {error}. Opnieuw proberen…',
    pairingConnected: 'Gekoppeld als {name} — starten…'
  },
  booth: {
    pressForPoetry: 'Druk voor Poëzie',
    turnKnob: 'Draai aan de knop om van stijl te veranderen',
    turnAndPress: 'Draai aan de knop & Druk',
    pressForMasterpiece: 'Druk voor je Meesterwerk',
    tryingFree: 'Proberen is altijd gratis',
    cta1: 'Druk op<br/>de Knop',
    cta2: 'Proberen<br/>is Gratis',
    inputBadge: 'Origineel',
    ctaPickStyle: 'Kies<br/>je Stijl',
    cta3: 'Krijg nu je<br/>Meesterwerk!'
  },
  countdown: {
    // Cijfers zijn universeel, geen vertaling nodig
  },
  processing: {
    sendingToAI: 'Foto naar AI sturen...',
    creatingArtwork: 'Kunstwerk maken...',
    uploadingImage: 'Afbeelding uploaden...',
    complete: 'Voltooid!',
    loadingMessages: [
      'De werken van de oude meesters bestuderen...',
      'De juiste kleuren mengen...',
      'Goede dingen kosten tijd...',
      'De essentie van het moment vastleggen...',
      'Een vleugje magie toevoegen...',
      'Je canvas voorbereiden...',
      'Het perfecte licht zoeken...',
      'Het wachten waard, beloofd...',
      'Iets onvergetelijks creëren...',
      'Een moment van rust in een snelle wereld...',
      'Mooie portretten laten zich niet haasten...',
      'Genieten van dit creatieve moment...',
      'De pixels laten bezinken...',
      'Je geduld maakt dit bijzonder...',
      'De schilderachtige route nemen...',
      'Kwaliteit boven snelheid, altijd...',
      'Geduld wordt beloond...',
      'Iets maken dat de moeite waard is om te bewaren...',
      'Iets langzamer, veel betekenisvoller...',
      'Creëren met intentie...',
      'Bijna klaar, blijf bij ons...',
      'Je meesterwerk voorbereiden...',
      'Sommige momenten verdienen meer tijd...',
      'Langzame technologie, echte kunst...',
      'Even geduld, schoonheid is in de maak...'
    ]
  },
  result: {
    scanToSave: 'Scannen om op te slaan',
    scanToPrintAndSave: 'Scan om te Bewaren<br/>& Printen',
    printForJust: 'Print voor maar',
    scanQrNow: 'Scan nu de QR-code',
    holdToPrint: 'Knop lang indrukken om te printen',
    // Pay-first (terminal) flow
    pressToPrint: 'Druk om te printen',
    hintPrint: 'Blij mee? Druk op de grote knop om direct te printen!',
    hintRetake: 'Toch liever iets anders? Draai voor 1 GRATIS herkansing.',
    hintPrinting: 'Jouw meesterwerk wordt nu afgedrukt, kijk onderaan!',
    hintUpsell: 'Nog eentje extra voor thuis? Draai om te kiezen, tap je pas om direct bij te printen.',
    hintDone: 'Klaar! Scan de QR-code om je meesterwerk te downloaden.',
    retakeTitle: 'Kies een andere stijl',
    retakeSub: 'Druk op de grote knop om opnieuw te maken (gratis)',
    upsellTitle: 'Extra prints',
    upsellPrints: '+{count} print(s)',
    upsellTap: 'Tap je pas op de terminal',
    upsellUpdating: 'Bedrag aanpassen…',
    upsellPaid: 'Betaald! Printen...',
    upsellFailed: 'Betaling mislukt, draai om het opnieuw te proberen',
    upsellCancelled: 'Geen betaling ontvangen'
  },
  paywall: {
    title: 'Klaar voor de transformatie?',
    tap: 'Tap je pas om de AI te ontketenen!',
    turnForMore: 'Ben je met een groepje? Draai voor extra prints!',
    onePrint: '1 print',
    nPrints: '{count} prints',
    waitingTerminal: 'Wachten op de terminal…',
    updatingTerminal: 'Bedrag aanpassen…',
    paid: 'Betaald! De AI gaat aan de slag…',
    declined: 'Betaling mislukt, probeer het nog eens',
    declinedFinal: 'De betaling is niet gelukt. Druk op de knop om opnieuw te beginnen.',
    retrying: 'Geen betaling ontvangen, nog een keer…',
    timeout: 'Geen betaling ontvangen. Druk op de knop om opnieuw te beginnen!'
  },
  terms: {
    agree: 'Door te starten ga je akkoord met onze voorwaarden en privacybeleid'
  },
  countdown: {
    look: 'Kijk hier',
    ready: 'Klaar?',
    pose: 'Poseer',
    smile: 'Lach'
  },
  error: {
    somethingWentWrong: 'Er is iets misgegaan',
    pleaseTryAgain: 'Probeer het opnieuw',
    buttonTryAgain: 'Knop: Probeer opnieuw',
    generationFailed: 'Oeps! De afbeelding is niet helemaal goed gegenereerd. Laten we nog een foto proberen!',
    processingFailed: 'Dit keer werkte het niet. Druk op de knop om het opnieuw te proberen!',
    renderFailed: 'Je gedicht is klaar, maar de afbeelding kon niet gemaakt worden. Probeer een nieuwe foto voor een download of print.',
    paymentRequired: 'De betaling kon niet bevestigd worden. Druk op de knop om opnieuw te beginnen.',
    terminalUnavailable: 'De betaalterminal is even niet beschikbaar. Probeer het later opnieuw.',
    paymentFailed: 'De betaling is niet gelukt. Druk op de knop om opnieuw te beginnen.',
    generationFailedRefund: 'Oeps, dit keer werkte het niet, je betaling is teruggedraaid. Druk op de knop om het opnieuw te proberen!'
  }
};
