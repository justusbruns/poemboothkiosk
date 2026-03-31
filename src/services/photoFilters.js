/**
 * Photo Filter Presets for Branding Templates
 *
 * Port from TypeScript backend (photo-filters.ts)
 * 12 curated filters inspired by classic photo booths and modern aesthetics
 */

const PHOTO_FILTERS = [
  // === CLASSIC PHOTO BOOTH FILTERS ===
  {
    id: 'none',
    name: 'None (Original)',
    description: 'No filter applied - clean, crisp photo',
    category: 'classic',
    preset: {
      brightness: 1.0,
      contrast: 1.0,
      saturation: 1.0
    }
  },
  {
    id: 'berlin',
    name: 'Berlin Classic',
    description: 'Iconic Berlin photo booth look - high contrast, slightly desaturated',
    category: 'classic',
    featured: true,
    preset: {
      brightness: 1.0,
      contrast: 1.5,
      saturation: 0.8,
      temperature: -15,
      grain: 0.3
    }
  },
  {
    id: 'contrast-bw',
    name: 'High Contrast B&W',
    description: 'Crushed blacks, bold monochrome - dramatic look',
    category: 'classic',
    featured: true,
    preset: {
      brightness: 1.05,
      contrast: 1.8,
      saturation: 0,
      blackPoint: 0.1,
      grain: 0.2
    }
  },
  {
    id: 'noir',
    name: 'Black & White Noir',
    description: 'Classic film noir - deep blacks, high contrast',
    category: 'classic',
    preset: {
      brightness: 0.95,
      contrast: 1.4,
      saturation: 0,
      grain: 0.25
    }
  },

  // === VINTAGE & RETRO FILTERS ===
  {
    id: 'vintage',
    name: 'Vintage Fade',
    description: 'Warm, faded retro film - 60s/70s aesthetic',
    category: 'artistic',
    preset: {
      brightness: 1.1,
      contrast: 0.8,
      saturation: 0.9,
      sepia: 0.15,
      vignette: 0.2,
      temperature: 20,
      blackPoint: 0.05
    }
  },
  {
    id: 'sepia',
    name: 'Sepia Memories',
    description: 'Classic sepia tone - timeless memories',
    category: 'artistic',
    preset: {
      brightness: 1.05,
      contrast: 0.9,
      saturation: 1.0,
      sepia: 1.0,
      vignette: 0.15
    }
  },
  {
    id: 'warm-retro',
    name: 'Warm Retro',
    description: '70s warm film aesthetic - orange/yellow tones',
    category: 'artistic',
    preset: {
      brightness: 1.1,
      contrast: 0.85,
      saturation: 1.05,
      temperature: 30,
      colorGrade: 'vintage',
      blackPoint: 0.08
    }
  },
  {
    id: 'polaroid',
    name: 'Polaroid Instant',
    description: 'Faded instant camera look - soft and nostalgic',
    category: 'artistic',
    preset: {
      brightness: 1.08,
      contrast: 0.85,
      saturation: 0.9,
      temperature: 25,
      softFocus: 0.2,
      blackPoint: 0.06
    }
  },

  // === MODERN ARTISTIC FILTERS ===
  {
    id: 'cinematic',
    name: 'Cinematic Teal & Orange',
    description: 'Modern movie grading - Hollywood blockbuster look',
    category: 'modern',
    preset: {
      brightness: 1.0,
      contrast: 1.3,
      saturation: 1.1,
      colorGrade: 'teal-orange'
    }
  },
  {
    id: 'cool-faded',
    name: 'Cool Faded',
    description: 'Modern washed-out indie aesthetic - blue tones',
    category: 'modern',
    preset: {
      brightness: 1.12,
      contrast: 0.65,
      saturation: 0.75,
      temperature: -20,
      blackPoint: 0.1
    }
  },
  {
    id: 'dreamy',
    name: 'Dreamy Soft',
    description: 'Ethereal, soft glow - romantic atmosphere',
    category: 'modern',
    preset: {
      brightness: 1.15,
      contrast: 0.7,
      saturation: 0.85,
      softFocus: 0.3,
      glow: 0.2
    }
  },
  {
    id: 'grainy',
    name: 'Grainy Film',
    description: 'Heavy film grain texture - analog photography',
    category: 'artistic',
    preset: {
      brightness: 1.05,
      contrast: 1.0,
      saturation: 0.95,
      grain: 0.5
    }
  }
];

/**
 * Get filter preset by ID
 */
function getFilterPreset(filterId) {
  const filter = PHOTO_FILTERS.find(f => f.id === filterId);
  if (!filter) {
    console.warn(`Filter "${filterId}" not found, using default`);
    return PHOTO_FILTERS[0].preset; // Default to 'none'
  }
  return filter.preset;
}

/**
 * Get filter by ID
 */
function getFilter(filterId) {
  return PHOTO_FILTERS.find(f => f.id === filterId);
}

/**
 * Validate filter ID
 */
function isValidFilterId(filterId) {
  return PHOTO_FILTERS.some(f => f.id === filterId);
}

/**
 * Get all filter IDs (for validation)
 */
function getAllFilterIds() {
  return PHOTO_FILTERS.map(f => f.id);
}

module.exports = {
  PHOTO_FILTERS,
  getFilterPreset,
  getFilter,
  isValidFilterId,
  getAllFilterIds
};
