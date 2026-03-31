/**
 * Photo Filter Application with Sharp
 *
 * Port from TypeScript backend (apply-filter.ts)
 * Server-side image processing to apply professional-grade filters
 */

const sharp = require('sharp');

/**
 * Apply a filter preset to an image buffer
 *
 * @param {Buffer} imageBuffer - Input image as Buffer
 * @param {Object} preset - Filter configuration from photoFilters.js
 * @returns {Promise<Buffer>} Processed image as Buffer
 */
async function applyPhotoFilter(imageBuffer, preset) {
  try {
    let pipeline = sharp(imageBuffer);

    // Get image metadata for overlay generation
    const metadata = await pipeline.metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      throw new Error('Invalid image dimensions');
    }

    // === STEP 1: Basic Adjustments ===

    // Brightness & Saturation (modulate)
    if (preset.brightness !== 1.0 || preset.saturation !== 1.0) {
      pipeline = pipeline.modulate({
        brightness: preset.brightness,
        saturation: preset.saturation
      });
    }

    // Contrast (linear transformation)
    if (preset.contrast !== 1.0) {
      // Linear contrast adjustment: a * pixel + b
      // where a = contrast, b = offset to maintain midpoint
      const a = preset.contrast;
      const b = -(128 * (a - 1));
      pipeline = pipeline.linear(a, b);
    }

    // === STEP 2: Color Temperature ===

    if (preset.temperature && preset.temperature !== 0) {
      // Temperature shift: warm (positive) or cool (negative)
      // Achieved by adjusting red and blue channels
      const tempFactor = preset.temperature / 100; // Normalize to 0-0.5 range

      if (preset.temperature > 0) {
        // Warmer: boost red, reduce blue
        pipeline = pipeline.recomb([
          [1 + tempFactor, 0, 0],
          [0, 1, 0],
          [0, 0, 1 - tempFactor * 0.5]
        ]);
      } else {
        // Cooler: boost blue, reduce red
        const coolFactor = Math.abs(tempFactor);
        pipeline = pipeline.recomb([
          [1 - coolFactor * 0.5, 0, 0],
          [0, 1, 0],
          [0, 0, 1 + coolFactor]
        ]);
      }
    }

    // === STEP 3: Sepia Tone ===

    if (preset.sepia && preset.sepia > 0) {
      // Sepia matrix transformation
      const s = preset.sepia;
      pipeline = pipeline.recomb([
        [0.393 * s + (1 - s), 0.769 * s, 0.189 * s],
        [0.349 * s, 0.686 * s + (1 - s), 0.168 * s],
        [0.272 * s, 0.534 * s, 0.131 * s + (1 - s)]
      ]);
    }

    // === STEP 4: Black Point Lift (Faded Blacks) ===

    if (preset.blackPoint && preset.blackPoint > 0) {
      // Lift shadows to create faded look
      const lift = Math.round(preset.blackPoint * 255);
      pipeline = pipeline.linear(1, lift);
    }

    // === STEP 5: Color Grading Presets ===

    if (preset.colorGrade === 'teal-orange') {
      // Cinematic teal and orange look
      // Orange in highlights, teal in shadows
      pipeline = pipeline.recomb([
        [1.1, -0.05, -0.05],  // Boost red slightly
        [-0.05, 1.0, -0.05],
        [0.1, 0.1, 1.2]       // Boost blue in shadows
      ]);
    } else if (preset.colorGrade === 'vintage') {
      // Warm vintage cast
      pipeline = pipeline.tint({ r: 255, g: 210, b: 180 });
    }

    // === STEP 6: Soft Focus / Blur ===

    if (preset.softFocus && preset.softFocus > 0) {
      const blurAmount = preset.softFocus * 10; // 0-5 sigma
      pipeline = pipeline.blur(blurAmount);
    }

    // === STEP 7: Vignette (Darken Edges) ===

    if (preset.vignette && preset.vignette > 0) {
      const vignetteOverlay = await createVignetteOverlay(width, height, preset.vignette);

      pipeline = pipeline.composite([
        {
          input: vignetteOverlay,
          blend: 'multiply'
        }
      ]);
    }

    // === STEP 8: Film Grain Texture ===

    if (preset.grain && preset.grain > 0) {
      const grainOverlay = await createGrainTexture(width, height, preset.grain);

      pipeline = pipeline.composite([
        {
          input: grainOverlay,
          blend: 'overlay'
        }
      ]);
    }

    // === STEP 9: Glow Effect (Highlight Bloom) ===

    if (preset.glow && preset.glow > 0) {
      // Create soft glowing highlights
      const glowLayer = await sharp(imageBuffer)
        .blur(25)
        .modulate({ brightness: 1.8 })
        .toBuffer();

      pipeline = pipeline.composite([
        {
          input: glowLayer,
          blend: 'screen'
        }
      ]);
    }

    // Convert to buffer
    return await pipeline.toBuffer();
  } catch (error) {
    console.error('[FILTER] Error applying photo filter:', error);
    throw new Error(`Failed to apply photo filter: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Create a radial gradient vignette overlay
 */
async function createVignetteOverlay(width, height, intensity) {
  // Create SVG with radial gradient from center
  const svg = `
    <svg width="${width}" height="${height}">
      <defs>
        <radialGradient id="vignette" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stop-color="white" stop-opacity="1"/>
          <stop offset="60%" stop-color="white" stop-opacity="1"/>
          <stop offset="100%" stop-color="black" stop-opacity="${intensity * 2}"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#vignette)"/>
    </svg>
  `;

  return Buffer.from(svg);
}

/**
 * Generate random noise grain texture
 */
async function createGrainTexture(width, height, intensity) {
  // Generate random noise pattern
  const pixels = width * height;
  const channels = 4;
  const grainData = Buffer.alloc(pixels * channels);

  // Create monochromatic noise
  for (let i = 0; i < pixels * channels; i += channels) {
    // Random noise value (0-255)
    const noise = Math.floor(Math.random() * 255);

    // Apply intensity scaling
    const scaledNoise = Math.floor(noise * intensity * 0.5); // Scale down for subtlety

    grainData[i] = scaledNoise;     // R
    grainData[i + 1] = scaledNoise; // G
    grainData[i + 2] = scaledNoise; // B
    grainData[i + 3] = Math.floor(255 * intensity); // Alpha (controls overall opacity)
  }

  return sharp(grainData, {
    raw: {
      width,
      height,
      channels
    }
  })
    .png()
    .toBuffer();
}

module.exports = {
  applyPhotoFilter,
  createVignetteOverlay,
  createGrainTexture
};
