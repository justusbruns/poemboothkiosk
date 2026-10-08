import { elements, state } from '../state.js';

// =============================================================================
// Camera Service (Inline - uses browser APIs)
// =============================================================================

// Apply camera rotation - size for POST-rotation dimensions
// extraScale (optional) zooms the feed slightly, e.g. to hide blurred edges on the result background
export function applyCameraRotation(videoElement, extraScale = 1) {
  const rotation = state.cameraRotation || 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  videoElement.style.position = 'absolute';
  videoElement.style.top = '50%';
  videoElement.style.left = '50%';
  videoElement.style.objectFit = 'cover';
  videoElement.style.objectPosition = 'center';
  videoElement.style.transformOrigin = 'center center';

  // KEY INSIGHT: For 90°/270°, the video element needs to be TALLER than the viewport
  // so that after rotation, its WIDTH fills the viewport height
  if (rotation === 90 || rotation === 270) {
    // Video needs to be rotated, so pre-size it for post-rotation fit
    // After 90° rotation: video width becomes visual height, video height becomes visual width
    // To fill portrait viewport (vw × vh), pre-rotation video needs:
    // - width = vh (will become height after rotation)
    // - height = vw (will become width after rotation)
    videoElement.style.width = vh + 'px';
    videoElement.style.height = vw + 'px';
    console.log(`[CAMERA] Portrait pre-rotation sizing: ${vh}×${vw}px (swapped for rotation)`);
  } else {
    // No rotation, normal viewport fill
    videoElement.style.width = vw + 'px';
    videoElement.style.height = vh + 'px';
    console.log(`[CAMERA] Landscape sizing: ${vw}×${vh}px`);
  }

  const scalePart = (extraScale && extraScale !== 1) ? ` scale(${extraScale})` : '';
  videoElement.style.transform = `translate(-50%, -50%) scaleX(-1) rotate(${rotation}deg)${scalePart}`;
}

// Push the camera track to the largest frame size it reports it can deliver.
// Best-effort: if the driver refuses, we keep whatever getUserMedia gave us.
export async function maximizeCameraResolution(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') return;

  let caps;
  try { caps = track.getCapabilities(); } catch (e) { return; }
  const maxW = caps.width && caps.width.max;
  const maxH = caps.height && caps.height.max;
  if (!maxW || !maxH) return;
  state.cameraMaxResolution = { width: maxW, height: maxH };

  const current = track.getSettings ? track.getSettings() : {};
  console.log(`[CAMERA] Track capabilities: up to ${maxW}x${maxH} (currently ${current.width}x${current.height})`);
  if (current.width >= maxW && current.height >= maxH) return;

  try {
    await track.applyConstraints({ width: { ideal: maxW }, height: { ideal: maxH } });
    const after = track.getSettings ? track.getSettings() : {};
    console.log(`[CAMERA] Resolution after applyConstraints: ${after.width}x${after.height}`);
  } catch (e) {
    console.warn('[CAMERA] Could not raise camera resolution:', e.message);
  }
}

export async function initializeCamera(videoElement) {
  try {
    console.log('[CAMERA] Initializing camera...');

    // Always request landscape resolution (camera hardware is landscape)
    const constraints = {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: 'user'
      },
      audio: false
    };

    state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

    // `ideal` is only a wish — the driver may hand us 720p or worse. Ask the track for
    // its real maximum and insist on that, so every kiosk captures at the best the
    // camera can do.
    await maximizeCameraResolution(state.cameraStream);

    videoElement.srcObject = state.cameraStream;

    await new Promise((resolve) => {
      videoElement.onloadedmetadata = () => resolve();
    });

    // Apply camera rotation from backend config
    applyCameraRotation(videoElement);

    const settings = state.cameraStream.getVideoTracks()[0]?.getSettings?.() || {};
    state.cameraResolution = {
      width: videoElement.videoWidth,
      height: videoElement.videoHeight,
      fps: settings.frameRate ? Math.round(settings.frameRate) : null,
      label: state.cameraStream.getVideoTracks()[0]?.label || ''
    };

    console.log('[CAMERA] Camera initialized:',
      videoElement.videoWidth, 'x', videoElement.videoHeight,
      '@', state.cameraResolution.fps, 'fps',
      'rotation:', state.cameraRotation + '°',
      '| max:', state.cameraMaxResolution ? `${state.cameraMaxResolution.width}x${state.cameraMaxResolution.height}` : 'unknown',
      '|', state.cameraResolution.label);

    if (videoElement.videoWidth < 1920 || videoElement.videoHeight < 1080) {
      console.warn(`[CAMERA] ⚠️ Camera is delivering ${videoElement.videoWidth}x${videoElement.videoHeight} — below 1080p. Photo quality will suffer.`);
    }

    return true;
  } catch (error) {
    console.error('[CAMERA] Initialization error:', error);
    throw new Error(`Camera initialization failed: ${error.message}`);
  }
}

// Long edge of the captured photo. The backend renders both the web and the
// print asset from this upload (2048 px is plenty for a 4x6 at 300 dpi), and a
// smaller canvas keeps the JPEG encode well under 200 ms so the photo is on
// screen right after the flash.
export const CAPTURE_MAX_EDGE = 2048;
export const CAPTURE_JPEG_QUALITY = 0.88;

// Resume the live camera preview (paused at capture) when the booth is back
export function resumeCameraPreview() {
  const v = elements.cameraVideo;
  if (v && v.srcObject && v.paused) {
    v.play().catch(() => { /* autoplay normally covers this */ });
  }
}

export async function capturePhoto(videoElement, canvasElement) {
  try {
    console.log('[CAMERA] Capturing photo...');

    if (!state.cameraStream) {
      throw new Error('Camera not initialized');
    }

    const srcWidth = videoElement.videoWidth;
    const srcHeight = videoElement.videoHeight;
    const rotation = state.cameraRotation || 0;

    // Capture at the size we actually use (≤ CAPTURE_MAX_EDGE on the long side).
    // The backend renders web + print assets from this upload, so a full 4K frame
    // only made the JPEG encode take seconds — during which the flash had faded
    // and the guest saw the live camera again instead of their photo.
    const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(srcWidth, srcHeight));
    const width = Math.round(srcWidth * scale);
    const height = Math.round(srcHeight * scale);

    // Adjust canvas size based on rotation
    if (rotation === 90 || rotation === 270) {
      // Swap width/height for 90° or 270° rotation
      canvasElement.width = height;
      canvasElement.height = width;
    } else {
      canvasElement.width = width;
      canvasElement.height = height;
    }

    const ctx = canvasElement.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.save();

    // Apply transformations in CORRECT order
    // 1. Move to center
    ctx.translate(canvasElement.width / 2, canvasElement.height / 2);

    // 2. Un-mirror FIRST (before rotation, so X axis is still horizontal)
    ctx.scale(-1, 1);

    // 3. THEN rotate (maintains correct mirror axis)
    ctx.rotate((rotation * Math.PI) / 180);

    // 4. Draw image centered (scaled)
    ctx.drawImage(videoElement, -width / 2, -height / 2, width, height);

    ctx.restore();

    // Freeze the live preview on exactly this frame: the guest should see the
    // photo they just took (not themselves moving) until the processing screen
    // takes over. The preview is resumed when the booth screen comes back.
    try { videoElement.pause(); } catch (e) { /* ignore */ }

    // Encode asynchronously (toBlob) instead of toDataURL: a synchronous JPEG encode
    // freezes the renderer — and the flash — mid-animation.
    const dataURL = await new Promise((resolve, reject) => {
      canvasElement.toBlob((blob) => {
        if (!blob) { reject(new Error('Canvas toBlob returned null')); return; }
        console.log(`[CAMERA] Photo captured: ${srcWidth}x${srcHeight} → ${canvasElement.width}x${canvasElement.height}, ${(blob.size / 1024).toFixed(0)} KB, rotation ${rotation}°`);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', CAPTURE_JPEG_QUALITY);
    });

    return dataURL;
  } catch (error) {
    console.error('[CAMERA] Capture error:', error);
    throw error;
  }
}
