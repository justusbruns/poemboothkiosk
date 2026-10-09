// English translations
export const en = {
  loading: {
    checkingCertificates: 'Checking certificates...',
    loadingCertificates: 'Loading certificates...',
    checkingNetwork: 'Checking network connection...',
    registeringDevice: 'Registering device...',
    fetchingConfiguration: 'Fetching configuration...',
    initializingCamera: 'Initializing camera...',
    startingKiosk: 'Starting kiosk...'
  },
  wifi: {
    setupRequired: 'Please connect me to the internet',
    holdQRCode: 'Hold your WiFi QR code in front of the camera',
    waiting: 'Waiting for your WiFi QR code...',
    detected: 'QR code detected! Connecting...',
    connected: 'Connected! Continuing setup...',
    stillOffline: 'Still no internet — hold your WiFi QR code in front of the camera',
    failed: 'Connection failed'
  },
  update: {
    available: 'Update available',
    updating: 'Updating...',
    skip: 'Skip',
    install: 'Install',
    hint: '← Turn the knob to choose, press to confirm →',
    downloading: 'Downloading... {percent}%',
    installing: 'Installing...',
    downloadFailed: 'Download failed'
  },
  setup: {
    chooseLanguage: 'Choose your language',
    languageHint: '← Turn the knob to choose, press to confirm →',
    pairingTitle: 'Connect this booth',
    pairingIntro: 'Scan the QR code with your phone, log in to your Poem Booth account and confirm the code below.',
    pairingRequesting: 'Requesting code…',
    pairingWaiting: 'Waiting for approval on your phone…',
    pairingExpired: 'Code expired — getting a new one…',
    pairingNoConnection: 'No connection — retrying…',
    pairingHiccup: 'Connection hiccup — still waiting…',
    pairingError: 'Pairing error: {error}. Retrying…',
    pairingConnected: 'Connected as {name} — starting…'
  },
  booth: {
    pressForPoetry: 'Press for Poetry',
    turnKnob: 'Turn knob to change style',
    turnAndPress: 'Turn the knob & Press',
    pressForMasterpiece: 'Press for your Masterpiece',
    tryingFree: 'Trying is always free',
    cta1: 'Press<br/>the Button',
    cta2: 'Trying<br/>is Free',
    inputBadge: 'Original',
    ctaPickStyle: 'Pick<br/>your Style',
    cta3: 'Get your<br/>Masterpiece now!'
  },
  countdown: {
    // Numbers are universal, no translation needed
  },
  processing: {
    sendingToAI: 'Sending photo to AI...',
    creatingArtwork: 'Creating artwork...',
    uploadingImage: 'Uploading image...',
    complete: 'Complete!',
    loadingMessages: [
      'Studying the works of the old masters...',
      'Mixing just the right colors...',
      'Good things take time...',
      'Capturing the essence of the moment...',
      'Adding a touch of magic...',
      'Preparing your canvas...',
      'Finding the perfect light...',
      'Worth the wait, we promise...',
      'Crafting something memorable...',
      'A moment of slowness in a fast world...',
      'Great portraits can\'t be rushed...',
      'Savoring this creative moment...',
      'Letting the pixels settle...',
      'Your patience makes this special...',
      'Taking the scenic route...',
      'Quality over speed, always...',
      'The best things come to those who wait...',
      'Making something worth keeping...',
      'A little slower, a lot more meaningful...',
      'Creating with intention...',
      'Almost there, stay with us...',
      'Preparing your masterpiece...',
      'Some moments deserve more time...',
      'Slow tech, real art...',
      'Hang tight, beauty is brewing...'
    ]
  },
  result: {
    scanToSave: 'Scan to save',
    scanToPrintAndSave: 'Scan to Save<br/>& Print',
    printForJust: 'Print for just',
    scanQrNow: 'Scan the QR code now',
    holdToPrint: 'Hold button to print',
    // Pay-first (terminal) flow
    pressToPrint: 'Press to print',
    hintPrint: 'Happy with it? Press the big button to print right away!',
    hintRetake: 'Rather something else? Turn the knob for 1 FREE retake.',
    hintPrinting: 'Your masterpiece is printing, look below!',
    hintUpsell: 'One more for home? Turn to choose, tap your card to print extra copies.',
    hintDone: 'Done! Scan the QR code to download your masterpiece.',
    retakeTitle: 'Pick another style',
    retakeSub: 'Press the big button to create it again (free)',
    upsellTitle: 'Extra prints',
    upsellPrints: '+{count} print(s)',
    upsellTap: 'Tap your card on the terminal',
    upsellUpdating: 'Updating the amount…',
    upsellPaid: 'Paid! Printing...',
    upsellFailed: 'Payment failed, turn the knob to try again',
    upsellCancelled: 'No payment received'
  },
  paywall: {
    title: 'Ready for the transformation?',
    tap: 'Tap your card to unleash the AI!',
    turnForMore: 'With a group? Turn the knob for extra prints!',
    onePrint: '1 print',
    nPrints: '{count} prints',
    waitingTerminal: 'Waiting for the terminal…',
    updatingTerminal: 'Updating the amount…',
    paid: 'Paid! The AI is getting to work…',
    declined: 'Payment failed, please try again',
    declinedFinal: 'The payment did not go through. Press the button to start over.',
    retrying: 'No payment received, one more try…',
    timeout: 'No payment received. Press the button to start over!'
  },
  terms: {
    agree: 'By starting you agree to our Terms & Privacy Policy'
  },
  countdown: {
    look: 'Look here',
    ready: 'Ready?',
    pose: 'Pose',
    smile: 'Smile'
  },
  error: {
    somethingWentWrong: 'Something Went Wrong',
    pleaseTryAgain: 'Please try again',
    buttonTryAgain: 'Button: Try again',
    generationFailed: 'Oops! The image didn\'t generate quite right. Let\'s try another photo!',
    processingFailed: 'Something didn\'t work this time. Press the button to try again!',
    renderFailed: 'Your poem is ready, but the picture could not be made. Try another photo for a download or print.',
    paymentRequired: 'The payment could not be confirmed. Press the button to start over.',
    terminalUnavailable: 'The card terminal is unavailable right now. Please try again later.',
    paymentFailed: 'The payment did not go through. Press the button to start over.',
    generationFailedRefund: 'Oops, it didn\'t work this time, your payment has been reversed. Press the button to try again!'
  }
};
