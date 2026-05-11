/**
 * Branded Image Rendering Engine for Kiosk
 *
 * 1:1 port of poem-booth-renderer (fly.io dashboard renderer) so the kiosk
 * produces identical output to the dashboard preview.
 * Upstream: github.com/justusbruns/poem-booth-renderer src/renderer.ts + src/text-renderer.ts
 */

const sharp = require('sharp');
const { chromium } = require('playwright');
const { applyPhotoFilter } = require('./applyFilter');
const { getFilterPreset } = require('./photoFilters');

class RenderingService {
  constructor(brandingConfig = {}) {
    this.branding = brandingConfig;
    this.browser = null;
  }

  async initializeBrowser() {
    if (!this.browser) {
      console.log('[RENDER] Initializing Playwright browser...');
      this.browser = await chromium.launch({
        headless: true,
        args: ['--font-render-hinting=none']
      });
      console.log('[RENDER] Browser initialized');
    }
    return this.browser;
  }

  /**
   * Rotate image while maintaining exact dimensions (pad-rotate-extract).
   */
  async rotateImageWithPadding(imageBuffer, angleDegrees, targetWidth, targetHeight) {
    const diagonal = Math.ceil(Math.sqrt(targetWidth * targetWidth + targetHeight * targetHeight));
    const paddedSize = diagonal + 100;

    const transparentCanvas = await sharp({
      create: {
        width: paddedSize,
        height: paddedSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).png().toBuffer();

    const photoLeft = Math.round((paddedSize - targetWidth) / 2);
    const photoTop = Math.round((paddedSize - targetHeight) / 2);

    const centeredImage = await sharp(transparentCanvas)
      .composite([{ input: imageBuffer, top: photoTop, left: photoLeft }])
      .png()
      .toBuffer();

    const rotatedImage = await sharp(centeredImage)
      .rotate(angleDegrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const rotatedMeta = await sharp(rotatedImage).metadata();
    if (!rotatedMeta.width || !rotatedMeta.height) {
      throw new Error('Failed to get rotated image dimensions');
    }

    const extractLeft = Math.round((rotatedMeta.width - targetWidth) / 2);
    const extractTop = Math.round((rotatedMeta.height - targetHeight) / 2);

    return sharp(rotatedImage)
      .extract({
        left: Math.max(0, extractLeft),
        top: Math.max(0, extractTop),
        width: targetWidth,
        height: targetHeight
      })
      .png()
      .toBuffer();
  }

  /**
   * Render branded poem image - MAIN ENTRY POINT
   *
   * @param {string} photoDataUrl - Photo as data URL
   * @param {object} poem - Poem object with .text
   * @param {object} branding - Branding template (overrides constructor template)
   * @param {object} options
   * @param {'standard'|'hd'} options.quality - 'hd' overrides DPI to 300, else uses template.output_dpi
   */
  async renderPoemImage(photoDataUrl, poem, branding = null, options = {}) {
    try {
      console.log('[RENDER] Starting branded image render...');

      if (!photoDataUrl) {
        throw new Error('Photo data URL is required but was null or undefined');
      }
      if (!poem || !poem.text) {
        throw new Error('Poem text is required but was null or undefined');
      }

      const template = branding || this.branding;
      const quality = options.quality === 'hd' ? 'hd' : 'standard';
      const outputDpi = quality === 'hd' ? 300 : (template.output_dpi || 72);

      console.log('[RENDER] Poem text length:', poem.text.length);
      console.log('[RENDER] Quality:', quality, '| DPI:', outputDpi);
      console.log('[RENDER] Output:', template.output_width, 'x', template.output_height);
      console.log('[RENDER] Template diagnostics:');
      console.log('  font_family:', template.font_family, '| weight:', template.font_weight, '| size:', template.font_size);
      console.log('  text_align:', template.text_align, '| vertical:', template.text_vertical_align);
      console.log('  text pos:', template.text_position_x, template.text_position_y, '| size:', template.text_width, 'x', template.text_height);
      console.log('  photo pos:', template.photo_position_x, template.photo_position_y, '| size:', template.photo_width, 'x', template.photo_height);
      console.log('  photo border:', template.photo_border_width, 'px', template.photo_border_color, '| radius:', template.photo_border_radius);

      // === STEP 1: Create Base Canvas ===
      const baseCanvas = await this.createBaseCanvas(template);

      // === STEP 2: Process Photo with Filter ===
      console.log('[RENDER] Photo filter:', template.photo_filter);

      const base64Data = photoDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const photoBuffer = Buffer.from(base64Data, 'base64');

      if (!photoBuffer || photoBuffer.length === 0) {
        throw new Error('Invalid photo buffer: empty or null');
      }

      let processedPhoto = photoBuffer;

      if (template.photo_filter && template.photo_filter !== 'none') {
        const filterPreset = getFilterPreset(template.photo_filter);
        processedPhoto = await applyPhotoFilter(photoBuffer, filterPreset);
        // Break pipeline (filter may include vignette + grain composites)
        processedPhoto = await sharp(processedPhoto).toBuffer();
      }

      // === STEP 3: Resize Photo ===
      // Inset-border approach: when border > 0, photo content fits inside (w - 2bw, h - 2bw)
      // so the final bordered photo exactly fills the template bounds (w, h) at position (x, y).
      // Border is then drawn entirely in the outer ring — fully visible, doesn't cover photo content.
      const photoBorderWidth = template.photo_border_width || 0;
      const photoContentWidth = Math.max(1, template.photo_width - 2 * photoBorderWidth);
      const photoContentHeight = Math.max(1, template.photo_height - 2 * photoBorderWidth);

      processedPhoto = await sharp(processedPhoto)
        .resize(photoContentWidth, photoContentHeight, {
          fit: 'cover',
          position: 'center'
        })
        .png()
        .toBuffer();

      // === STEP 4: Border / Border Radius ===
      if (template.photo_border_width > 0) {
        processedPhoto = await this.addPhotoBorder(
          processedPhoto,
          template.photo_border_width,
          template.photo_border_color,
          template.photo_border_radius,
          template.photo_width,
          template.photo_height
        );
        processedPhoto = await sharp(processedPhoto).toBuffer();
      } else if (template.photo_border_radius > 0) {
        processedPhoto = await this.applyBorderRadius(
          processedPhoto,
          template.photo_border_radius
        );
        processedPhoto = await sharp(processedPhoto).toBuffer();
      }

      // === STEP 4.5: Photo Rotation ===
      if (template.photo_rotation && template.photo_rotation !== 0) {
        console.log('[RENDER] Photo rotation:', template.photo_rotation, 'deg');
        processedPhoto = await this.rotateImageWithPadding(
          processedPhoto,
          template.photo_rotation,
          template.photo_width,
          template.photo_height
        );
      }

      // === STEP 5: Composite Photo onto Canvas ===
      // Bordered photo exactly fills the template bounds (photo_width × photo_height) — composite directly at (x, y).
      processedPhoto = await sharp(processedPhoto).ensureAlpha().toBuffer();

      let pipeline = sharp(baseCanvas).composite([
        {
          input: processedPhoto,
          top: template.photo_position_y,
          left: template.photo_position_x
        }
      ]);

      const canvasWithPhoto = await pipeline.toBuffer();
      pipeline = sharp(canvasWithPhoto);

      // === STEP 6: Text Overlay ===
      const textOverlay = await this.renderTextWithPlaywright(poem.text, template);

      pipeline = pipeline.composite([
        {
          input: textOverlay,
          top: template.text_position_y,
          left: template.text_position_x
        }
      ]);

      // === STEP 7: Output Format & DPI ===
      // For web upload (quality: 'standard'), force JPEG to stay under backend's body size limit.
      // For print (quality: 'hd'), respect template's output_format (PNG keeps crisp print quality).
      const templateFormat = template.output_format || 'jpeg';
      const outputFormat = quality === 'hd' ? templateFormat : 'jpeg';
      console.log('[RENDER] Output format:', outputFormat, '(template wanted:', templateFormat + ')');

      if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
        pipeline = pipeline.jpeg({
          quality: quality === 'hd' ? 95 : 85,
          mozjpeg: true
        });
      } else {
        pipeline = pipeline.png({
          compressionLevel: 9
        });
      }

      pipeline = pipeline.withMetadata({ density: outputDpi });

      const result = await pipeline.toBuffer();

      const fileSizeMB = (result.length / (1024 * 1024)).toFixed(2);
      console.log('[RENDER] Branded image rendered:', fileSizeMB, 'MB');

      return result;
    } catch (error) {
      console.error('[RENDER] Render error:', error);
      throw error;
    }
  }

  /**
   * Create the base canvas (background layer).
   * Kiosk-specific: falls back to color background if image fetch fails (offline-friendly).
   */
  async createBaseCanvas(template) {
    const { output_width, output_height } = template;

    if (template.background_type === 'color' || !template.background_image_url) {
      const color = template.background_color || '#ffffff';
      console.log('[RENDER] Solid color background:', color);

      return sharp({
        create: {
          width: output_width,
          height: output_height,
          channels: 4,
          background: color
        }
      })
        .ensureAlpha()
        .png()
        .toBuffer();
    }

    console.log('[RENDER] Fetching background image:', template.background_image_url);

    try {
      const https = require('https');
      const http = require('http');
      const url = new URL(template.background_image_url);
      const protocol = url.protocol === 'https:' ? https : http;

      const imageBuffer = await new Promise((resolve, reject) => {
        protocol.get(template.background_image_url, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }).on('error', reject);
      });

      return sharp(imageBuffer)
        .resize(output_width, output_height, {
          fit: 'cover',
          position: 'center'
        })
        .toBuffer();
    } catch (error) {
      console.error('[RENDER] Background image fetch failed:', error.message);
      console.warn('[RENDER] Falling back to color background');

      const color = template.background_color || '#ffffff';
      return sharp({
        create: {
          width: output_width,
          height: output_height,
          channels: 4,
          background: color
        }
      })
        .ensureAlpha()
        .png()
        .toBuffer();
    }
  }

  /**
   * Inset-border approach: draws the border entirely inside the template bounds (photo_width × photo_height).
   * Caller has already resized photo content to (outerW - 2bw, outerH - 2bw) so we can drop it into a
   * (outerW × outerH) frame with `bw` thick border ring around it.
   *
   * Result: total bounds match `photo_width × photo_height` at the configured position — no overflow,
   * no border covering the photo. Border thickness equals `borderWidth` exactly.
   */
  async addPhotoBorder(photoBuffer, borderWidth, borderColor, borderRadius, outerW, outerH) {
    const photoMeta = await sharp(photoBuffer).metadata();
    if (!photoMeta.width || !photoMeta.height) {
      throw new Error('Invalid photo dimensions');
    }

    // Apply rounded corners to the photo content (inner radius = outer radius - border width)
    let maskedPhoto = photoBuffer;
    if (borderRadius > 0) {
      const innerRadius = Math.max(0, borderRadius - borderWidth);
      maskedPhoto = await this.applyBorderRadius(photoBuffer, innerRadius);
    }

    // Outer frame: filled rectangle in border color with rounded corners — same size as template bounds.
    const borderSvg = `
      <svg width="${outerW}" height="${outerH}">
        <rect
          x="0"
          y="0"
          width="${outerW}"
          height="${outerH}"
          rx="${borderRadius}"
          ry="${borderRadius}"
          fill="${borderColor}"
        />
      </svg>
    `;

    return sharp(Buffer.from(borderSvg))
      .composite([
        { input: maskedPhoto, top: borderWidth, left: borderWidth }
      ])
      .png()
      .toBuffer();
  }

  async applyBorderRadius(imageBuffer, radius) {
    const meta = await sharp(imageBuffer).metadata();
    if (!meta.width || !meta.height) {
      throw new Error('Invalid image dimensions');
    }

    const mask = Buffer.from(
      `<svg width="${meta.width}" height="${meta.height}">
        <rect
          x="0"
          y="0"
          width="${meta.width}"
          height="${meta.height}"
          rx="${radius}"
          ry="${radius}"
          fill="white"
        />
      </svg>`
    );

    return sharp(imageBuffer)
      .ensureAlpha()
      .composite([
        {
          input: mask,
          blend: 'dest-in'
        }
      ])
      .png()
      .toBuffer();
  }

  /**
   * Render text overlay using Playwright.
   * CSS handles wrapping; we measure scrollHeight and reduce font size if it overflows.
   */
  async renderTextWithPlaywright(text, template) {
    try {
      await this.initializeBrowser();

      const page = await this.browser.newPage({
        viewport: {
          width: template.text_width,
          height: template.text_height
        }
      });

      try {
        let fontSize = template.font_size;
        const targetFont = template.font_family || 'Georgia';
        const targetWeight = template.font_weight || 400;
        let html = this.generateHTML(text, template, fontSize);

        // Available height accounts for 20px body padding (matches Konva's text padding={20})
        const availableHeight = template.text_height - 40;

        // Use domcontentloaded so we never hang on slow CDN — we explicitly wait for the
        // font afterwards with our own timeout. networkidle can stall on kiosks with
        // intermittent connections.
        await page.setContent(html, {
          waitUntil: 'domcontentloaded',
          timeout: 10000
        });

        // Explicit font load: triggers download of the unicode subset containing the poem text.
        // Wrapped in Promise.race so we never block longer than 6s — display=swap then renders
        // text in fallback font if the web font is unavailable (offline kiosk, blocked CDN).
        try {
          await Promise.race([
            page.evaluate(({ weight, size, family, sampleText }) => {
              return document.fonts.load(`${weight} ${size}px "${family}"`, sampleText)
                .then(() => document.fonts.ready);
            }, { weight: targetWeight, size: fontSize, family: targetFont, sampleText: text.substring(0, 200) }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Font load timeout')), 6000))
          ]);
        } catch (fontError) {
          console.warn('[RENDER] Font load error (will use system fallback):', fontError.message);
        }

        // Verify the specific font is now loaded
        const fontProbe = `${targetWeight} ${fontSize}px "${targetFont}"`;
        const fontDiag = await page.evaluate((probe) => {
          const fonts = Array.from(document.fonts).map(f => ({
            family: f.family.replace(/['"]/g, ''),
            status: f.status,
            weight: f.weight
          }));
          const anyLoaded = fonts.some(f => f.status === 'loaded');
          return { fonts: fonts.slice(0, 3), totalDeclared: fonts.length, anyLoaded, available: document.fonts.check(probe) };
        }, fontProbe);
        console.log('[RENDER] Font diagnostics:', JSON.stringify(fontDiag));
        if (!fontDiag.anyLoaded) {
          console.warn(`[RENDER] ⚠️  Font "${targetFont}" NOT loaded — falling back to system font!`);
        }

        // Auto-size: measure scrollHeight, reduce font size if overflowing
        const maxAttempts = 10;
        for (let i = 0; i < maxAttempts && fontSize > 12; i++) {
          const textHeight = await page.evaluate(`
            (function() {
              var el = document.getElementById('text-container');
              return el ? el.scrollHeight : 0;
            })()
          `);

          if (textHeight <= availableHeight) break;

          fontSize -= 2;
          console.log(`[RENDER] Text overflows (${textHeight}px > ${availableHeight}px), reducing to ${fontSize}px`);
          html = this.generateHTML(text, template, fontSize);
          await page.setContent(html, {
            waitUntil: 'domcontentloaded',
            timeout: 10000
          });
          try {
            await Promise.race([
              page.evaluate('document.fonts.ready'),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Font loading timeout')), 2000)
              )
            ]);
          } catch { /* continue with fallback */ }
        }

        console.log(`[RENDER] Text rendered at ${fontSize}px`);

        const screenshot = await page.screenshot({
          type: 'png',
          omitBackground: true,
          animations: 'disabled',
          timeout: 10000
        });

        return screenshot;
      } finally {
        await page.close();
      }
    } catch (error) {
      console.error('[RENDER] Text rendering error:', error);
      throw error;
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Convert minimal markdown into safe HTML so poems with `# heading`, `**bold**`, and `*italic*`
   * render with proper typography in the final image.
   * HTML special chars are escaped first to prevent injection from AI-generated poem text.
   */
  parseMarkdownPoem(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);

    // Headings (line must start with #)
    html = html.split('\n').map(line => {
      if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
      return line;
    }).join('\n');

    // Inline emphasis — ** before * so bold wins over italic
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

    return html;
  }

  /**
   * Generate HTML for text rendering.
   * CSS does wrapping (no JS pre-wrapping); flexbox handles vertical/horizontal alignment.
   */
  generateHTML(text, template, fontSize) {
    const safeText = this.parseMarkdownPoem(text);

    const textShadowCSS = template.text_shadow_enabled
      ? `text-shadow: 0px 2px ${template.text_shadow_blur || 4}px ${template.text_shadow_color || '#000000'}80;`
      : '';

    // Background fills the padded inner area when enabled (the 20px padding is from the text box, not the background).
    const backgroundCSS = template.text_background_enabled
      ? `background: ${template.text_background_color || '#ffffff99'}; border-radius: 8px;`
      : '';

    const alignItems = template.text_vertical_align === 'center' ? 'center'
      : template.text_vertical_align === 'bottom' ? 'flex-end'
      : 'flex-start';

    const justifyContent = template.text_align === 'center' ? 'center'
      : template.text_align === 'right' ? 'flex-end'
      : 'flex-start';

    const fontFamily = template.font_family || 'Georgia';
    const fontWeight = template.font_weight || 400;

    // Konva's TextContainer uses padding={20} → text content area is (w-40) × (h-40).
    // Match that so kiosk render matches the dashboard editor preview.
    const TEXT_BOX_PADDING = 20;

    // display=swap: render with fallback immediately while the web font loads.
    // We explicitly wait for document.fonts.load() to resolve before screenshot,
    // so the web font WILL be active in the screenshot. swap is the safety net —
    // if the font request fails (offline kiosk), text is still visible in fallback
    // instead of invisible during display=block's block period.
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=${fontFamily.replace(/\s+/g, '+')}:wght@${fontWeight}&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      width: ${template.text_width}px;
      height: ${template.text_height}px;
      padding: ${TEXT_BOX_PADDING}px;
      overflow: hidden;
      background: transparent;
      display: flex;
      align-items: ${alignItems};
      justify-content: ${justifyContent};
    }
    #text-container {
      font-family: '${fontFamily}', serif;
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      color: ${template.font_color};
      text-align: ${template.text_align};
      line-height: ${template.line_height};
      letter-spacing: ${template.letter_spacing}px;
      white-space: pre-line;
      word-wrap: break-word;
      overflow-wrap: break-word;
      ${textShadowCSS}
      ${backgroundCSS}
      width: 100%;
    }
    /* Markdown styling — headings inherit body font-size, just bold + tiny breathing room below */
    #text-container h1,
    #text-container h2,
    #text-container h3 {
      font-size: 1em;
      font-weight: 700;
      line-height: inherit;
      margin: 0 0 0.15em 0;
    }
    #text-container strong { font-weight: 700; }
    #text-container em { font-style: italic; }
  </style>
</head>
<body>
  <div id="text-container">${safeText}</div>
</body>
</html>
    `.trim();
  }

  async destroy() {
    if (this.browser) {
      console.log('[RENDER] Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = RenderingService;
