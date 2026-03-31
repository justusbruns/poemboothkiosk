/**
 * Branded Image Rendering Engine for Kiosk
 *
 * Port from TypeScript backend (render-branded-image.ts)
 * Composites photos with branding templates, applying filters and text
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

  /**
   * Initialize Playwright browser (reusable for multiple renders)
   */
  async initializeBrowser() {
    if (!this.browser) {
      console.log('[RENDER] Initializing Playwright browser...');
      // SECURITY: Removed --no-sandbox for proper isolation
      this.browser = await chromium.launch({
        headless: true,
        args: ['--font-render-hinting=none']
      });
      console.log('[RENDER] Browser initialized with sandbox enabled');
    }
    return this.browser;
  }

  /**
   * Rotate image while maintaining exact dimensions
   * Uses pad-rotate-extract algorithm from server renderer
   *
   * @param {Buffer} imageBuffer - Image buffer to rotate
   * @param {number} angleDegrees - Rotation angle in degrees (0-360)
   * @param {number} targetWidth - Original/target width to maintain
   * @param {number} targetHeight - Original/target height to maintain
   * @returns {Promise<Buffer>} Rotated image with same dimensions
   */
  async rotateImageWithPadding(imageBuffer, angleDegrees, targetWidth, targetHeight) {
    // 1. Calculate diagonal (how much space we need for rotation)
    const diagonal = Math.ceil(Math.sqrt(targetWidth * targetWidth + targetHeight * targetHeight));
    const paddedSize = diagonal + 100; // Extra padding for safety

    // 2. Create large transparent canvas
    const transparentCanvas = await sharp({
      create: {
        width: paddedSize,
        height: paddedSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).png().toBuffer();

    // 3. Center the photo on the large canvas
    const photoLeft = Math.round((paddedSize - targetWidth) / 2);
    const photoTop = Math.round((paddedSize - targetHeight) / 2);

    const centeredImage = await sharp(transparentCanvas)
      .composite([{ input: imageBuffer, top: photoTop, left: photoLeft }])
      .png()
      .toBuffer();

    // 4. Rotate the entire canvas around center
    const rotatedImage = await sharp(centeredImage)
      .rotate(angleDegrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    // 5. Get new dimensions after rotation (Sharp expands canvas)
    const rotatedMeta = await sharp(rotatedImage).metadata();
    if (!rotatedMeta.width || !rotatedMeta.height) {
      throw new Error('Failed to get rotated image dimensions');
    }

    // 6. Extract center portion matching original dimensions
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
   * Port of backend renderBrandedImage()
   *
   * @param {string} photoDataUrl - Photo as data URL
   * @param {object} poem - Poem object with text property
   * @param {object} branding - Branding template config
   * @param {object} options - Optional rendering options
   * @param {number} options.outputWidth - Override output width (for print quality)
   * @param {number} options.outputHeight - Override output height (for print quality)
   * @param {number} options.quality - JPEG quality (0-100, default 85 for web, 95 for print)
   * @param {number} options.dpi - Output DPI (default from template, 300 for print)
   */
  async renderPoemImage(photoDataUrl, poem, branding = null, options = {}) {
    try {
      console.log('[RENDER] Starting branded image render...');

      // Validate inputs
      if (!photoDataUrl) {
        throw new Error('Photo data URL is required but was null or undefined');
      }
      if (!poem || !poem.text) {
        throw new Error('Poem text is required but was null or undefined');
      }

      console.log('[RENDER] Poem text length:', poem.text?.length || 0);
      if (options.outputWidth || options.outputHeight) {
        console.log('[RENDER] Custom output dimensions:', options.outputWidth, 'x', options.outputHeight);
      }
      if (options.quality) {
        console.log('[RENDER] Custom JPEG quality:', options.quality);
      }

      const template = branding || this.branding;

      // Override template dimensions if options provided (for print quality)
      const outputWidth = options.outputWidth || template.output_width;
      const outputHeight = options.outputHeight || template.output_height;
      const outputQuality = options.quality !== undefined ? options.quality : 85;
      const outputDPI = options.dpi || template.output_dpi || 72;

      // Calculate scale factor if output dimensions differ from template
      const scaleX = outputWidth / template.output_width;
      const scaleY = outputHeight / template.output_height;
      const scale = Math.min(scaleX, scaleY); // Use uniform scale to maintain aspect ratio

      // Create scaled template for rendering
      const scaledTemplate = {
        ...template,
        output_width: outputWidth,
        output_height: outputHeight,
        photo_width: Math.round(template.photo_width * scale),
        photo_height: Math.round(template.photo_height * scale),
        photo_position_x: Math.round(template.photo_position_x * scale),
        photo_position_y: Math.round(template.photo_position_y * scale),
        photo_border_width: Math.round(template.photo_border_width * scale),
        photo_border_radius: Math.round(template.photo_border_radius * scale),
        text_width: Math.round(template.text_width * scale),
        text_height: Math.round(template.text_height * scale),
        text_position_x: Math.round(template.text_position_x * scale),
        text_position_y: Math.round(template.text_position_y * scale),
        font_size: Math.round(template.font_size * scale)
      };

      console.log('[RENDER] Scale factor:', scale.toFixed(3));
      if (scale !== 1) {
        console.log('[RENDER] Scaled dimensions:', {
          photo: `${scaledTemplate.photo_width}x${scaledTemplate.photo_height}`,
          text: `${scaledTemplate.text_width}x${scaledTemplate.text_height}`
        });
      }

      // === STEP 1: Create Base Canvas ===
      console.log('[RENDER] Creating base canvas:', {
        width: outputWidth,
        height: outputHeight,
        background: scaledTemplate.background_color
      });

      const baseCanvas = await this.createBaseCanvas(scaledTemplate, outputWidth, outputHeight);

      // === STEP 2: Process Photo with Filter ===
      console.log('[RENDER] Processing photo with filter:', scaledTemplate.photo_filter);

      // Convert data URL to buffer
      const base64Data = photoDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const photoBuffer = Buffer.from(base64Data, 'base64');
      console.log('[RENDER] Photo buffer size:', photoBuffer.length, 'bytes');

      let processedPhoto = photoBuffer;

      // Apply filter if not 'none'
      if (scaledTemplate.photo_filter && scaledTemplate.photo_filter !== 'none') {
        console.log('[RENDER] Applying filter:', scaledTemplate.photo_filter);
        const filterPreset = getFilterPreset(scaledTemplate.photo_filter);
        processedPhoto = await applyPhotoFilter(photoBuffer, filterPreset);
        console.log('[RENDER] Filter applied, buffer size:', processedPhoto.length, 'bytes');

        // CRITICAL: Convert to buffer after filter (breaks pipeline to prevent Sharp bug)
        processedPhoto = await sharp(processedPhoto).toBuffer();
      }

      // === STEP 3: Resize Photo to Template Dimensions ===
      console.log(`[RENDER] Resizing photo to ${scaledTemplate.photo_width}x${scaledTemplate.photo_height}`);
      processedPhoto = await sharp(processedPhoto)
        .resize(scaledTemplate.photo_width, scaledTemplate.photo_height, {
          fit: 'cover',
          position: 'center'
        })
        .png() // Ensure PNG format for compositing
        .toBuffer();

      console.log('[RENDER] Photo resized, buffer size:', processedPhoto.length, 'bytes');

      // === STEP 4: Apply Photo Border (if specified) ===
      if (scaledTemplate.photo_border_width > 0) {
        console.log('[RENDER] Adding photo border');
        processedPhoto = await this.addPhotoBorder(
          processedPhoto,
          scaledTemplate.photo_border_width,
          scaledTemplate.photo_border_color,
          scaledTemplate.photo_border_radius
        );

        // CRITICAL: Convert to buffer after border
        processedPhoto = await sharp(processedPhoto).toBuffer();
      } else if (scaledTemplate.photo_border_radius > 0) {
        // Apply border radius without border
        console.log('[RENDER] Applying border radius');
        processedPhoto = await this.applyBorderRadius(
          processedPhoto,
          scaledTemplate.photo_border_radius
        );

        // CRITICAL: Convert to buffer after border radius
        processedPhoto = await sharp(processedPhoto).toBuffer();
      }

      // === STEP 4.5: Apply Photo Rotation (if specified) ===
      if (scaledTemplate.photo_rotation && scaledTemplate.photo_rotation !== 0) {
        console.log('[RENDER] Applying photo rotation:', scaledTemplate.photo_rotation, 'degrees');
        processedPhoto = await this.rotateImageWithPadding(
          processedPhoto,
          scaledTemplate.photo_rotation,
          scaledTemplate.photo_width,
          scaledTemplate.photo_height
        );
        console.log('[RENDER] Photo rotated, buffer size:', processedPhoto.length, 'bytes');
      }

      // === STEP 5: Composite Photo onto Canvas ===
      console.log('[RENDER] Compositing photo at position:', {
        x: scaledTemplate.photo_position_x,
        y: scaledTemplate.photo_position_y
      });

      // CRITICAL: Ensure photo has alpha channel before composite
      processedPhoto = await sharp(processedPhoto).ensureAlpha().toBuffer();

      let pipeline = sharp(baseCanvas).composite([
        {
          input: processedPhoto,
          top: scaledTemplate.photo_position_y,
          left: scaledTemplate.photo_position_x
        }
      ]);

      console.log('[RENDER] Photo composited onto canvas');

      // CRITICAL: Convert to buffer after photo composite
      const canvasWithPhoto = await pipeline.toBuffer();
      pipeline = sharp(canvasWithPhoto);

      // === STEP 6: Render Text Overlay ===
      console.log('[RENDER] Rendering text overlay with Playwright');

      const textOverlay = await this.renderTextWithPlaywright(poem.text, scaledTemplate);

      pipeline = pipeline.composite([
        {
          input: textOverlay,
          top: scaledTemplate.text_position_y,
          left: scaledTemplate.text_position_x
        }
      ]);

      // === STEP 7: Apply Output Settings ===
      console.log('[RENDER] Applying output settings:', {
        format: 'jpeg',
        quality: outputQuality,
        dpi: outputDPI,
        dimensions: `${outputWidth}x${outputHeight}`
      });

      // Always use JPEG format (PNG creates oversized files)
      // Quality: 85 for web (2MB), 95 for print (professional quality)
      pipeline = pipeline.jpeg({
        quality: outputQuality,
        mozjpeg: true,  // Better compression algorithm
        progressive: true  // Progressive loading for web
      });

      console.log(`[RENDER] Using JPEG format with quality ${outputQuality}`);

      // Set DPI metadata
      pipeline = pipeline.withMetadata({
        density: outputDPI
      });

      const result = await pipeline.toBuffer();

      // Log file size
      const fileSizeMB = (result.length / (1024 * 1024)).toFixed(2);
      console.log('[RENDER] Branded image rendered successfully');
      console.log('[RENDER] Final size:', fileSizeMB, 'MB');

      return result;
    } catch (error) {
      console.error('[RENDER] Render error:', error);
      throw error;
    }
  }

  /**
   * Create the base canvas (background layer)
   */
  async createBaseCanvas(template, width = null, height = null) {
    const canvasWidth = width || template.output_width;
    const canvasHeight = height || template.output_height;

    console.log('[RENDER] Background type:', template.background_type);
    console.log('[RENDER] Background image URL:', template.background_image_url || 'NONE');
    console.log('[RENDER] Background color:', template.background_color);
    console.log('[RENDER] Canvas dimensions:', canvasWidth, 'x', canvasHeight);

    if (template.background_type === 'color' || !template.background_image_url) {
      // Solid color background
      const color = template.background_color || '#ffffff';
      console.log('[RENDER] Using solid color background:', color);

      return sharp({
        create: {
          width: canvasWidth,
          height: canvasHeight,
          channels: 4,
          background: color
        }
      })
        .ensureAlpha()  // Ensure canvas has proper alpha channel
        .png()
        .toBuffer();
    } else {
      // Image background - FETCH AND USE IT
      console.log('[RENDER] Fetching background image from:', template.background_image_url);

      try {
        // Fetch the background image
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

        console.log('[RENDER] Background image fetched, size:', imageBuffer.length, 'bytes');

        // Resize and fit background image to canvas dimensions
        return sharp(imageBuffer)
          .resize(canvasWidth, canvasHeight, {
            fit: 'cover',
            position: 'center'
          })
          .ensureAlpha()
          .png()
          .toBuffer();
      } catch (error) {
        console.error('[RENDER] Failed to fetch background image:', error);
        console.warn('[RENDER] Falling back to color background');

        const color = template.background_color || '#ffffff';
        return sharp({
          create: {
            width: canvasWidth,
            height: canvasHeight,
            channels: 4,
            background: color
          }
        })
          .ensureAlpha()
          .png()
          .toBuffer();
      }
    }
  }

  /**
   * Add border to photo with rounded corners
   */
  async addPhotoBorder(photoBuffer, borderWidth, borderColor, borderRadius) {
    const photoMeta = await sharp(photoBuffer).metadata();
    if (!photoMeta.width || !photoMeta.height) {
      throw new Error('Invalid photo dimensions');
    }

    const totalWidth = photoMeta.width + borderWidth * 2;
    const totalHeight = photoMeta.height + borderWidth * 2;

    // Create border background with rounded corners
    const borderSvg = `
      <svg width="${totalWidth}" height="${totalHeight}">
        <rect
          x="0"
          y="0"
          width="${totalWidth}"
          height="${totalHeight}"
          rx="${borderRadius}"
          ry="${borderRadius}"
          fill="${borderColor}"
        />
      </svg>
    `;

    // Apply border radius to photo if specified
    let maskedPhoto = photoBuffer;
    if (borderRadius > 0) {
      const innerRadius = Math.max(0, borderRadius - borderWidth);
      maskedPhoto = await this.applyBorderRadius(photoBuffer, innerRadius);
    }

    // Composite photo on top of border
    return sharp(Buffer.from(borderSvg))
      .composite([
        {
          input: maskedPhoto,
          top: borderWidth,
          left: borderWidth
        }
      ])
      .png()
      .toBuffer();
  }

  /**
   * Apply rounded corners to an image
   */
  async applyBorderRadius(imageBuffer, radius) {
    const meta = await sharp(imageBuffer).metadata();
    if (!meta.width || !meta.height) {
      throw new Error('Invalid image dimensions');
    }

    // Create rounded rectangle mask
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
      .ensureAlpha() // Ensure alpha channel exists before applying mask
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
   * Render text overlay as PNG buffer using Playwright
   *
   * Port of backend renderTextWithPlaywright()
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

      // Generate HTML with text and fonts
      const { html, fontSize, lines } = this.generateHTML(text, template);

      console.log(`[RENDER] Text auto-sized to ${fontSize}px (${lines.length} lines)`);

      // Load HTML content
      await page.setContent(html, { waitUntil: 'networkidle' });

      // Wait for fonts to load
      await page.evaluate(() => document.fonts.ready);

      console.log(`[RENDER] Fonts loaded: ${template.font_family}`);

      // Take screenshot of the page
      const screenshot = await page.screenshot({
        type: 'png',
        omitBackground: true, // Transparent background
        animations: 'disabled'
      });

      await page.close();

      console.log(`[RENDER] Text rendered: ${screenshot.length} bytes`);

      return screenshot;
    } catch (error) {
      console.error('[RENDER] Text rendering error:', error);
      throw error;
    }
  }

  /**
   * SECURITY: HTML-escape text to prevent injection
   */
  escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generate HTML for text rendering with Playwright
   *
   * Port of backend generateHTML()
   */
  generateHTML(text, template) {
    // SECURITY: Escape HTML to prevent injection attacks
    const safeText = this.escapeHtml(text);

    // Auto-size text to fit
    const { lines, fontSize } = this.autoSizeAndWrapText(
      safeText,
      template.text_width,
      template.text_height,
      template.font_size,
      template.line_height
    );

    // Calculate vertical alignment offset
    const lineSpacing = fontSize * template.line_height;
    const totalTextHeight = lines.length * lineSpacing;

    // Default to center alignment if not specified by backend
    const verticalAlign = template.text_vertical_align || 'center';
    let topOffset = 0;

    console.log('[RENDER] Text vertical align from template:', template.text_vertical_align);
    console.log('[RENDER] Text vertical align (resolved):', verticalAlign);
    console.log('[RENDER] Text horizontal align:', template.text_align);
    console.log('[RENDER] Text area height:', template.text_height);
    console.log('[RENDER] Total text height:', totalTextHeight);

    if (verticalAlign === 'center') {
      topOffset = (template.text_height - totalTextHeight) / 2;
    } else if (verticalAlign === 'bottom') {
      topOffset = template.text_height - totalTextHeight;
    }
    // 'top' alignment: topOffset remains 0

    console.log('[RENDER] Vertical offset (topOffset):', topOffset);

    // Build text shadow CSS if enabled
    const textShadowCSS = template.text_shadow_enabled
      ? `text-shadow: 0px 2px ${template.text_shadow_blur || 4}px ${template.text_shadow_color || '#000000'}80;`
      : '';

    // Build background CSS if enabled
    const backgroundCSS = template.text_background_enabled
      ? `background: ${template.text_background_color || '#ffffff99'}; padding: 20px; border-radius: 8px;`
      : '';

    // Use default font if font_family is null/undefined
    const fontFamily = template.font_family || 'Georgia';
    const fontWeight = template.font_weight || 400;

    const html = `
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
      overflow: hidden;
      background: transparent;
      display: flex;
      align-items: flex-start;
      justify-content: ${template.text_align};
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
      ${textShadowCSS}
      ${backgroundCSS}
      padding-top: ${topOffset}px;
      width: 100%;
    }
  </style>
</head>
<body>
  <div id="text-container">${lines.join('\n')}</div>
</body>
</html>
    `.trim();

    return { html, lines, fontSize };
  }

  /**
   * Auto-size text to fit within bounds
   *
   * Port of backend autoSizeAndWrapText()
   */
  autoSizeAndWrapText(text, maxWidth, maxHeight, startFontSize, lineHeight) {
    // Rough estimate: average character width is ~0.6 of font size
    const avgCharWidth = startFontSize * 0.6;
    const maxCharsPerLine = Math.floor(maxWidth / avgCharWidth);

    // Split on explicit newlines to preserve poem structure
    const explicitLines = text.split('\n');
    const wrappedLines = [];

    // Wrap each explicit line
    for (const line of explicitLines) {
      if (line.trim() === '') {
        wrappedLines.push('');
        continue;
      }

      const words = line.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        if (testLine.length > maxCharsPerLine && currentLine) {
          wrappedLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        wrappedLines.push(currentLine);
      }
    }

    // Calculate total height and reduce font size if needed
    let fontSize = startFontSize;
    const MIN_FONT_SIZE = 20;

    while (fontSize >= MIN_FONT_SIZE) {
      const lineSpacing = fontSize * lineHeight;
      const totalHeight = wrappedLines.length * lineSpacing;

      if (totalHeight <= maxHeight) {
        return { lines: wrappedLines, fontSize };
      }

      fontSize -= 2;
    }

    // Force fit at minimum size
    console.warn(`[RENDER] Text too long - forcing minimum ${MIN_FONT_SIZE}px`);
    return { lines: wrappedLines, fontSize: MIN_FONT_SIZE };
  }

  /**
   * Cleanup
   */
  async destroy() {
    if (this.browser) {
      console.log('[RENDER] Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = RenderingService;
