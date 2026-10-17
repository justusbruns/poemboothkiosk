// Spanish translations
export const es = {
  loading: {
    checkingCertificates: 'Comprobando certificados...',
    loadingCertificates: 'Cargando certificados...',
    checkingNetwork: 'Comprobando conexión de red...',
    registeringDevice: 'Registrando dispositivo...',
    fetchingConfiguration: 'Obteniendo configuración...',
    initializingCamera: 'Iniciando cámara...',
    startingKiosk: 'Iniciando kiosco...'
  },
  wifi: {
    setupRequired: 'Conéctame a internet, por favor',
    holdQRCode: 'Sostenga su código QR de WiFi frente a la cámara'
  },
  booth: {
    priceOnly: "solo",
    pressForPoetry: 'Presiona para Poesía',
    turnKnob: 'Gira la perilla para cambiar de estilo',
    turnAndPress: 'Gira la perilla y Pulsa',
    pressForMasterpiece: 'Pulsa para tu Obra Maestra',
    tryingFree: 'Probar siempre es gratis',
    cta1: 'Pulsa<br/>el Botón',
    cta2: 'Probar<br/>es Gratis',
    inputBadge: 'Original',
    ctaPickStyle: 'Gira y elige<br/>un estilo',
    cta3: '¡Consigue tu<br/>Obra Maestra!'
  },
  countdown: {
    // Los números son universales, no se necesita traducción
  },
  processing: {
    sendingToAI: 'Enviando foto a la IA...',
    creatingArtwork: 'Creando obra de arte...',
    uploadingImage: 'Subiendo imagen...',
    complete: '¡Completo!',
    loadingMessages: [
      'Estudiando las obras de los grandes maestros...',
      'Mezclando los colores perfectos...',
      'Las cosas buenas toman tiempo...',
      'Capturando la esencia del momento...',
      'Añadiendo un toque de magia...',
      'Preparando tu lienzo...',
      'Buscando la luz perfecta...',
      'Vale la pena esperar, te lo prometemos...',
      'Creando algo memorable...',
      'Un momento de calma en un mundo acelerado...',
      'Los grandes retratos no se apresuran...',
      'Saboreando este momento creativo...',
      'Dejando que los píxeles se asienten...',
      'Tu paciencia hace esto especial...',
      'Tomando el camino más pintoresco...',
      'Calidad sobre velocidad, siempre...',
      'Lo bueno se hace esperar...',
      'Creando algo que vale la pena guardar...',
      'Un poco más lento, mucho más significativo...',
      'Creando con intención...',
      'Ya casi está, quédate con nosotros...',
      'Preparando tu obra maestra...',
      'Algunos momentos merecen más tiempo...',
      'Tecnología lenta, arte real...',
      'Paciencia, la belleza está en camino...'
    ]
  },
  result: {
    scanReceiptAndMore: "Escanea para tu recibo,<br/>versión digital y más copias",
    upsellTerminalBusy: "El datáfono está ocupado. Escanea el QR para pedir más copias.",
    printingProgress: "Imprimiendo {n} de {total}…",
    printingOne: "Imprimiendo…",
    printsComing: "¡Tu copia está en camino!",
    tryStyleCta: "Pulsa para probar este estilo",
    hintCompare: "O gira para comparar tus retratos",
    portraitN: "Retrato {n}",
    pickCta: "Pulsa para elegir<br/>este retrato",
    retakeCta: "Pulsa para<br/>otro estilo",
    keepCta: "Pulsa para quedarte<br/>con este retrato",
    keepBadge: "Tu retrato",
    scanForDigital: "Escanea para tu<br/>versión digital",
    scanToSave: 'Escanear para guardar',
    scanToPrintAndSave: 'Escanea para Guardar<br/>e Imprimir',
    printForJust: 'Imprime por solo',
    scanQrNow: 'Escanea el código QR ahora',
    holdToPrint: 'Mantén presionado el botón para imprimir',
    // Pay-first (terminal) flow
    pressToPrint: 'Pulsa para imprimir',
    hintPrint: '¿Te gusta? ¡Pulsa el botón grande para imprimir al momento!',
    hintRetake: "O gira para un intento gratis",
    hintPrinting: "Tu copia está en camino",
    hintUpsell: "Gira para copias extra",
    hintDone: '¡Listo! Escanea el código QR para descargar tu obra maestra.',
    retakeTitle: "Nuevo intento gratis",
    retakeSub: "Pulsa para crearlo de nuevo",
    retakeBody: "Gira para otro estilo",
    upsellTitle: 'Copias extra',
    upsellPrints: '+{count} copia(s)',
    upsellTap: "Acerca tu tarjeta",
    upsellScan: "Escanea para pagar",
    upsellUpdating: 'Actualizando el importe…',
    upsellPaid: '¡Pagado! Imprimiendo...',
    upsellFailed: 'Pago rechazado, gira el mando para reintentar',
    upsellCancelled: 'No se recibió el pago'
  },
  retry: {
    retakeFailed: "No ha funcionado, lo sentimos. Tu primer retrato se conserva; pide ayuda al personal si quieres imprimirlo.",
    retrying: "Un momento, lo intentamos de nuevo…",
    blockedTitle: "No hemos podido crear un retrato con esta foto",
    blockedBody: "A veces la IA rechaza una foto, por ejemplo por un gesto, un texto o un logotipo en la ropa, o si tu cara no se ve bien.",
    errorTitle: "Algo ha salido mal",
    errorBody: "Algo ha salido mal al crear tu retrato.",
    cta: "Pulsa el botón para una foto nueva. Ya has pagado."
  },
  outOfService: {
    title: "Fuera de servicio un momento",
    paper: "Estamos cambiando el papel. ¡Volvemos enseguida!",
    printer: "Estamos revisando la impresora. ¡Volvemos enseguida!"
  },
  errorScreen: {
    noStyles: {"title":"Casi listo","text":"Esta booth aún no tiene estilos. El organizador puede configurarlos para el evento o el hub; después la booth arranca sola."},
    notLinked: {"title":"Aún no vinculada","text":"Esta booth no está vinculada a un hub o ubicación. Pide al organizador que la vincule."},
    connection: {"title":"Sin conexión","text":"La booth no llega a internet. Revisa el WiFi o el cable; sigue en cuanto vuelva la conexión."},
    server: {"title":"Un momento","text":"Nuestro servidor no responde ahora mismo. Suele resolverse en un minuto."},
    camera: {"title":"Cámara no encontrada","text":"La booth no ve la cámara. Comprueba que esté conectada y que ningún otro programa la use."},
    generic: {"title":"Una pequeña pausa","text":"Algo salió mal, nada de qué preocuparse. Lo intentamos de nuevo."},
    pressButton: "Pulsa el botón para intentarlo de nuevo",
    autoRetry: "Lo volvemos a intentar en {s} segundos"
  },
  paywall: {
    perPhoto: "por foto",
    total: "total {price}",
    paidTitle: "¡Pagado!",
    paidSub: "Estamos creando tu retrato",
    title: '¿Listo para la transformación?',
    scanToPay: "Escanea para pagar",
    terminalDown: 'El datáfono no está disponible ahora, paga con tu móvil.',
    qrUpdating: "Creando el código QR…",
    tap: '¡Acerca tu tarjeta para desatar la IA!',
    turnForMore: "Gira para más copias",
    onePrint: '1 copia',
    nPrints: '{count} copias',
    waitingTerminal: 'Esperando al terminal…',
    updatingTerminal: 'Actualizando el importe…',
    paid: '¡Pagado! La IA se pone a trabajar…',
    declined: 'Pago rechazado, inténtalo de nuevo',
    declinedFinal: 'El pago no se completó. Pulsa el botón para empezar de nuevo.',
    retrying: 'No se recibió el pago, un intento más…',
    timeout: 'No se recibió el pago. ¡Pulsa el botón para empezar de nuevo!'
  },
  terms: {
    agree: 'Al empezar aceptas nuestros términos y política de privacidad'
  },
  countdown: {
    look: 'Mira aquí',
    ready: '¿Listo?',
    pose: 'Pose',
    smile: 'Sonríe'
  },
  error: {
    somethingWentWrong: 'Algo salió mal',
    pleaseTryAgain: 'Por favor, inténtalo de nuevo',
    buttonTryAgain: 'Botón: Intentar de nuevo',
    generationFailed: '¡Ups! La imagen no se generó correctamente. ¡Intentemos otra foto!',
    processingFailed: 'Esta vez no funcionó. ¡Presiona el botón para intentarlo de nuevo!',
    paymentRequired: "No se ha podido confirmar el pago. Pulsa el botón para empezar de nuevo.",
    terminalUnavailable: "El datáfono no está disponible en este momento. Inténtalo más tarde.",
    paymentFailed: "El pago no se ha completado. Pulsa el botón para empezar de nuevo.",
    generationFailedRefund: "Vaya, esta vez no ha funcionado. Se ha anulado tu pago. ¡Pulsa el botón para intentarlo de nuevo!",
    generationFailedManualRefund: "Vaya, esta vez no ha funcionado. Te devolveremos el pago; puede tardar unos días. Pulsa el botón para empezar de nuevo."
  }
};
