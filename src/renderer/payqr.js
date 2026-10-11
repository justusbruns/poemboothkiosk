// QR code for paying by phone (Mollie checkout) when the booth's card terminal
// is unavailable. Same qr-code-styling look as the result screen's QR.

export function renderPayQr(container, url, size = 220) {
  if (!container) return;
  container.innerHTML = '';
  if (!url) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  if (typeof QRCodeStyling === 'undefined') {
    console.error('[PAYQR] QR Code Styling library not loaded');
    return;
  }
  try {
    const qr = new QRCodeStyling({
      type: 'canvas',
      width: size,
      height: size,
      data: url,
      margin: 0,
      qrOptions: { typeNumber: '0', mode: 'Byte', errorCorrectionLevel: 'M' },
      dotsOptions: { type: 'rounded', color: '#000000', roundSize: true },
      backgroundOptions: { color: '#ffffff' },
      cornersSquareOptions: { type: 'extra-rounded', color: '#000000' },
      cornersDotOptions: { type: 'dot', color: '#000000' }
    });
    qr.append(container);
  } catch (e) {
    console.error('[PAYQR] QR render failed:', e);
  }
}

// Keep the QR tile in place while a new QR for a changed amount is being made:
// same white tile, a small spinner and a line of text.
export function showPayQrLoading(container, size = 220, text = '') {
  if (!container) return;
  container.innerHTML = '';
  container.style.display = 'flex';
  const box = document.createElement('div');
  box.className = 'pay-qr-loading';
  box.style.width = size + 'px';
  box.style.height = size + 'px';
  const spinner = document.createElement('div');
  spinner.className = 'pay-qr-spinner';
  box.appendChild(spinner);
  if (text) {
    const label = document.createElement('p');
    label.className = 'pay-qr-loading-text';
    label.textContent = text;
    box.appendChild(label);
  }
  container.appendChild(box);
}

export function hidePayQr(container) {
  renderPayQr(container, null);
}
