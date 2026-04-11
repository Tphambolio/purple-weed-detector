// HSV / Lab colour-mask definitions for the 6 consolidated colour classes
// that collectively cover all 18 supported species.
//
// OpenCV conventions used here:
//   HSV — Hue: 0–179, Saturation: 0–255, Value: 0–255
//   Lab — L: 0–255, a: 0–255 (128 = neutral), b: 0–255 (128 = neutral)
//
// Ranges are STARTING POINTS grounded in published UAV weed-detection work
// and botanical colour descriptions. Five species on our list have proven
// RGB-drone literature to draw from:
//
//   - purple_loosestrife — Laba et al. (Great Lakes wetland UAV RGB),
//     Bradley (2014) invasive remote-sensing review; reported H ~150-165
//   - leafy_spurge       — Anderson (1996) hyperspectral aerial, Hunt et al.
//     followup UAV, Kazmi et al. — chartreuse bract hue is a known discriminator
//   - himalayan_balsam   — Müllerová et al. (2017) "Timing is important",
//     UAV RGB along riparian corridors, 2-5cm GSD at peak bloom
//   - orange_hawkweed    — BC Ministry weed program UAV RGB; vivid orange
//     against green grass = highest single-channel separability of any species
//   - garlic_mustard     — Frye/Rodgers UAV hyperspectral (forest, multispectral
//     not RGB — cue is NDVI/red-edge leaf-on phenology, NOT visible colour)
//
// The other 13 species have no species-specific published HSV thresholds;
// values are derived from botanical colour descriptions widened ~15% for
// lighting variation, per the research pass.
//
// All ranges will drift with lighting, camera sensor, and drone altitude and
// should be re-tuned against real field data. The debug panel (planned)
// exposes live sliders to tune them in-session without a redeploy.
//
// Each class declares:
//   hsv:        [{h:[lo,hi], s:[lo,hi], v:[lo,hi]}, ...]  — OR'd together
//   lab:        [{l:[lo,hi], a:[lo,hi], b:[lo,hi]}, ...]  — alternative for whites
//   min_blob_px: smallest blob to keep at native resolution (noise floor)
//   max_blob_px: largest blob to keep (filters out whole-sky masks etc.)
//   bbox_color: HTML colour used to render bboxes of this class in the UI
//   vegetation_gate: if true, require ExG > 0 (suppresses concrete/rooftop)
//                    — white and red_berry skip this since white rocks and
//                    red brick would otherwise be stripped along with them
//
// Multi-range classes (purple/pink wraparound, red wraparound) OR all their
// sub-ranges before morphological close.

export const COLOR_CLASSES = {
  purple_pink: {
    label: 'Purple / Pink',
    description: 'Burdock, thistle, creeping bellflower, dame\'s rocket, field scabious, Himalayan balsam, purple loosestrife',
    // Research-derived: H 125-178, S 25-245, V 120-245 consolidated.
    // Loosestrife/balsam cluster around H 150-170; scabious/bellflower around
    // H 125-145 (paler, lower S). Range is wide because the class spans
    // saturated magenta (loosestrife) to pale lilac (scabious).
    hsv: [
      { h: [125, 170], s: [25, 245], v: [120, 245] },   // violet → magenta (main body)
      { h: [170, 179], s: [90, 255], v: [120, 245] },   // deep magenta wrap → 180
      { h: [0, 8],     s: [90, 255], v: [120, 245] },   // magenta wrap ← 0
    ],
    min_blob_px: 200,
    max_blob_px: 100_000,
    bbox_color: '#c084fc',      // tailwind purple-400
    vegetation_gate: true,
  },

  yellow: {
    label: 'Yellow',
    description: 'Black henbane, barberry flowers, mullein, tansy, yellow clematis, yellow toadflax',
    // Research-derived: H 18-38, S 120-255, V 190-255. Tansy and mullein are
    // the most saturated; henbane pale cream flowers need the lower S bound.
    hsv: [
      { h: [18, 38], s: [120, 255], v: [190, 255] },
    ],
    min_blob_px: 250,
    max_blob_px: 100_000,
    bbox_color: '#facc15',      // tailwind yellow-400
    vegetation_gate: true,
  },

  orange: {
    label: 'Orange',
    description: 'Orange hawkweed (+ secondary signal from yellow toadflax throat)',
    // Research: Pilosella aurantiaca measured around H 5-15 in BC UAV work.
    // Vivid and spectrally stable — one of the easiest targets on the list.
    hsv: [
      { h: [3, 18], s: [160, 255], v: [170, 250] },
    ],
    min_blob_px: 200,
    max_blob_px: 100_000,
    bbox_color: '#fb923c',      // tailwind orange-400
    vegetation_gate: true,
  },

  chartreuse: {
    label: 'Chartreuse',
    description: 'Leafy spurge bracts, common buckthorn late-season foliage',
    // Research: Anderson/Hunt/Kazmi leafy spurge work maps the bract hue
    // around H 32-50. Buckthorn's late-retained green is in the same band
    // but lower in saturation — widening the lower S bound accommodates it.
    // NOTE: buckthorn detection really wants temporal phenology (late-green
    // retention after natives turn), not a pure HSV mask. This class will
    // catch it reliably only in the Sep-Oct window once natives drop.
    hsv: [
      { h: [30, 52], s: [100, 230], v: [170, 250] },
    ],
    min_blob_px: 300,            // narrower; avoid noise from healthy foliage
    max_blob_px: 200_000,        // buckthorn canopies can be huge
    bbox_color: '#a3e635',      // tailwind lime-400
    vegetation_gate: false,     // chartreuse IS vegetation; gate would cancel
  },

  white: {
    label: 'White',
    description: 'Baby\'s-breath, garlic mustard, white forms of dame\'s rocket / balsam',
    // Research is explicit: for whites the H channel is effectively noise.
    // Gate on low S + high V. Lab backup is provided for cases where the
    // camera's HSV is wonky, but the primary mask is HSV S<40 V>215.
    hsv: [
      { h: [0, 179], s: [0, 40], v: [215, 255] },
    ],
    lab: [
      { l: [220, 255], a: [118, 138], b: [118, 138] },
    ],
    min_blob_px: 400,            // aggressive; whites produce the most noise
    max_blob_px: 60_000,
    bbox_color: '#f5f5f4',      // tailwind stone-100
    vegetation_gate: false,     // white petals don't show as green in ExG
  },

  red_berry: {
    label: 'Red berry',
    description: 'Common barberry fall berries',
    // Research: H 0-10 AND H 168-179, S 140-255, V 90-230. Narrower V range
    // than the other classes — barberry berries are glossy saturated red, not
    // bright red, so the upper V cap filters out red-painted surfaces.
    hsv: [
      { h: [0, 10],    s: [140, 255], v: [90, 230] },
      { h: [168, 179], s: [140, 255], v: [90, 230] },
    ],
    min_blob_px: 150,            // berries are small
    max_blob_px: 50_000,
    bbox_color: '#ef4444',      // tailwind red-500
    vegetation_gate: false,     // red berries aren't ExG-positive
  },
}

/** Return all colour class ids that need to be masked for a given list of species. */
export function colorClassesForSpecies(speciesList) {
  return [...new Set(speciesList.map(s => s.color_class).filter(Boolean))]
}

/** Look up a colour class definition by id. Returns undefined if unknown. */
export function getColorClass(id) {
  return COLOR_CLASSES[id]
}

/** All class ids in display order. */
export const COLOR_CLASS_ORDER = [
  'purple_pink',
  'yellow',
  'orange',
  'chartreuse',
  'white',
  'red_berry',
]
