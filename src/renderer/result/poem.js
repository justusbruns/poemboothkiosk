import { destroyLottieAnimation } from '../lottie.js';
import { updatePrintContainerVisibility } from './print.js';
import { hideResultCameraBackground, updateResultActionLabel, updateResultPaymentUI } from './ui.js';
import { showScreen } from '../screens.js';
import { elements, state } from '../state.js';

// =============================================================================
// Result Display
// =============================================================================

/**
 * Calculate optimal font size that fits text within container
 * Uses container dimensions and iteratively finds the largest font size that fits
 * Ensures text never overflows by measuring actual available space
 *
 * @param {string} poemText - The poem text to analyze
 * @returns {string} - Font size in px (e.g., "24px")
 */
export function calculatePoemFontSize(poemText) {
  // Get container dimensions
  const container = document.querySelector('.poem-overlay');
  if (!container) {
    console.warn('[RENDERER] Poem container not found, using fallback size');
    return '20px';
  }

  // Get available space (subtract padding)
  const containerHeight = container.clientHeight;
  const containerWidth = container.clientWidth;
  const computedStyle = window.getComputedStyle(container);
  const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
  const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
  const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
  const paddingRight = parseFloat(computedStyle.paddingRight) || 0;

  const availableHeight = containerHeight - paddingTop - paddingBottom;
  const availableWidth = containerWidth - paddingLeft - paddingRight;

  console.log(`[RENDERER] Container dimensions: ${containerWidth}x${containerHeight}px`);
  console.log(`[RENDERER] Available space: ${availableWidth}x${availableHeight}px`);

  // Constants
  const LINE_HEIGHT = 1.6; // Match CSS line-height
  const START_FONT_SIZE = 40; // Start at 40px and work down (increased for better visibility)
  const MIN_FONT_SIZE = 18; // Minimum readable size (increased)
  const AVG_CHAR_WIDTH_RATIO = 0.6; // Approximate character width

  // Try different font sizes, starting large and working down
  let fontSize = START_FONT_SIZE;
  let bestFit = MIN_FONT_SIZE;

  while (fontSize >= MIN_FONT_SIZE) {
    // Calculate approximate characters per line at this font size
    const charWidth = fontSize * AVG_CHAR_WIDTH_RATIO;
    const maxCharsPerLine = Math.floor(availableWidth / charWidth);

    // Word-wrap the text
    const lines = poemText.split('\n');
    const wrappedLines = [];

    for (const line of lines) {
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

    // Calculate total height needed
    const lineSpacing = fontSize * LINE_HEIGHT;
    const totalHeight = wrappedLines.length * lineSpacing;

    console.log(`[RENDERER] Testing ${fontSize}px: ${wrappedLines.length} lines, ${totalHeight.toFixed(0)}px height (available: ${availableHeight}px)`);

    // Check if it fits
    if (totalHeight <= availableHeight) {
      bestFit = fontSize;
      console.log(`[RENDERER] ✓ Font size ${fontSize}px fits!`);
      break; // Found the largest size that fits
    }

    // Try smaller
    fontSize -= 1;
  }

  console.log(`[RENDERER] Final font size: ${bestFit}px`);
  return `${bestFit}px`;
}

// Cancel any in-progress typing animation
export function cancelTypingAnimation() {
  if (state.typingTimeoutId) {
    clearTimeout(state.typingTimeoutId);
    state.typingTimeoutId = null;
  }
  state.typingSessionId = null;
}

/**
 * Convert minimal markdown (`# heading`, `**bold**`, `*italic*`) into safe HTML so the
 * on-screen poem matches the rendered image styling.
 */
export function parseMarkdownPoem(text) {
  if (!text) return '';
  // Escape HTML first to neutralize anything in AI-generated text
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.split('\n').map(line => {
    if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
    if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
    if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
    return line;
  }).join('\n');

  // Bold before italic so ** wins over *
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  return html;
}

/**
 * Strip markdown markers so the typing animation can run on plain text.
 * Per-char `<span>` wrapping breaks browser word-wrap (line break can occur between
 * any two spans, making the poem look shrunk). Typing plain text via textContent
 * keeps natural word wrap; we swap in formatted HTML once typing completes.
 */
export function stripMarkdownMarkers(text) {
  if (!text) return '';
  return text
    .split('\n').map(line => {
      if (line.startsWith('### ')) return line.slice(4);
      if (line.startsWith('## ')) return line.slice(3);
      if (line.startsWith('# ')) return line.slice(2);
      return line;
    }).join('\n')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1');
}

// Accepts either the full poem text or a live stream object
// { text, done } that the generation events keep appending to: typing runs
// as far as the text goes, waits while more tokens arrive, and finishes
// once done is set.
export function showPoemWithTypingEffect(poemTextOrStream) {
  const stream = (poemTextOrStream && typeof poemTextOrStream === 'object')
    ? poemTextOrStream
    : { text: String(poemTextOrStream || ''), done: true };
  const poemText = stream.text;

  // Cancel any existing typing animation to prevent race conditions
  cancelTypingAnimation();

  // Generate unique session ID for this typing animation
  const sessionId = Date.now() + Math.random();
  state.typingSessionId = sessionId;

  // Destroy loading animation
  destroyLottieAnimation();

  // Show result screen
  showScreen('result');

  // Display blurred photo background (ensure visible in case hidden from image generation)
  hideResultCameraBackground();
  elements.resultPhoto.style.display = '';
  elements.resultPhoto.src = state.currentPhoto;
  elements.resultPhoto.classList.add('blurred');

  // Type the plain (markers-stripped) version of the poem character by character so
  // browser word wrap stays natural. After typing completes we swap in the formatted
  // markdown HTML so headings/bold/italic appear. Markers are never visible.
  const plainPoem = stripMarkdownMarkers(poemText);
  elements.poemText.textContent = '';
  elements.poemText.classList.remove('typing-complete');

  // Remove image-display class when showing poem text (restores poem layout)
  const poemOverlay = elements.poemText.parentElement;
  if (poemOverlay) {
    poemOverlay.classList.remove('image-display');
  }
  // Make sure the paid watermark from a previous image result isn't shown over a poem
  updateResultPaymentUI();

  // Calculate and apply optimal font size based on the plain text (what's actually displayed).
  // For a live stream the final length is unknown: start from a typical poem length and
  // settle on the real size once the full text is in.
  let fontSizeSettled = stream.done;
  const fontSize = calculatePoemFontSize(stream.done ? plainPoem : 'x'.repeat(320));
  elements.poemText.style.fontSize = fontSize;
  console.log(`[RENDERER] Applied font size: ${fontSize}${stream.done ? '' : ' (provisional, streaming)'}`);

  // Adapt the QR label to the printer state (print & save vs save)
  updateResultActionLabel();

  // Show/hide the hold-to-print circle (free mode + printer)
  updatePrintContainerVisibility();

  // Add typing effect with human-like timing
  let charIndex = 0;
  const baseSpeed = 30; // base milliseconds per character

  function typeNextChar() {
    // Guard: only proceed if this is still the active typing session
    if (state.typingSessionId !== sessionId) {
      return; // Abort - a new typing session has started
    }

    // Streaming: re-read the (possibly grown) text every tick. Leave an unfinished
    // trailing markdown marker untyped until the stream closes it or finishes.
    let plain = plainPoem;
    if (!stream.done || plain.length !== stripMarkdownMarkers(stream.text).length) {
      plain = stripMarkdownMarkers(stream.text);
      if (!stream.done) {
        const tail = stream.text.slice(-2);
        if (tail.endsWith('*')) plain = plain.slice(0, Math.max(0, plain.length - 1));
      }
    }

    if (charIndex >= plain.length && !stream.done) {
      // Caught up with the stream: wait for more tokens
      state.typingTimeoutId = setTimeout(typeNextChar, 120);
      return;
    }

    if (stream.done && !fontSizeSettled) {
      fontSizeSettled = true;
      const finalSize = calculatePoemFontSize(stripMarkdownMarkers(stream.text));
      if (finalSize !== elements.poemText.style.fontSize) {
        elements.poemText.style.fontSize = finalSize;
        console.log(`[RENDERER] Final font size: ${finalSize}`);
      }
    }

    if (charIndex < plain.length) {
      elements.poemText.textContent += plain.charAt(charIndex);
      const lastChar = plain.charAt(charIndex);
      charIndex++;

      // Calculate delay with human-like variation
      let delay = baseSpeed;

      // Add random "thinking" pauses (about 8% chance) to simulate natural typing
      if (Math.random() < 0.08) {
        delay += Math.random() * 250 + 100; // Add 100-350ms pause
      }
      if (['.', '!', '?'].includes(lastChar)) {
        delay += 120; // Longer pause after sentence endings
      } else if ([',', ';', ':'].includes(lastChar)) {
        delay += 60; // Medium pause after commas
      } else if (lastChar === '\n') {
        delay += 150; // Pause at line breaks
      }

      // Store timeout ID in state so it can be cancelled
      state.typingTimeoutId = setTimeout(typeNextChar, delay);
    } else {
      // Typing complete — swap plain text for markdown-formatted HTML so headings/bold/italic appear
      elements.poemText.innerHTML = parseMarkdownPoem(stream.text);
      elements.poemText.classList.add('typing-complete');
      state.typingTimeoutId = null;
    }
  }

  typeNextChar();
}
