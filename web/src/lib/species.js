// Canonical registry of the 18 Edmonton-area invasive/regulated weeds the
// detector supports. All downstream modules (scanner, gemini prompt builder,
// calendar UI, species picker) read from here.
//
// Bloom windows are from the City of Edmonton "Species Calendar" PDF, stored
// as year-agnostic MM-DD strings. Some species have multiple bloom windows
// (e.g. common barberry: spring flowers, fall berries).
//
// `color_class` points at an entry in colorClasses.js, which defines the
// actual HSV/Lab mask ranges. Individual species can override via
// `hsv_override` if their colour is notably outside the class norm.
//
// `gemini_hint` is a short phrase (~15-25 words) injected into the Gemini
// prompt so the model can discriminate between species of the same colour
// class. It should describe shape/structure/habitat, NOT repeat the colour.
//
// `confusion_species` lists the most common look-alikes a drone operator in
// Edmonton might mistake the species for. Gemini gets these in the prompt
// so it can explicitly rule them out instead of silently confusing them.
//
// `uav_literature` names the strongest published reference for species that
// have proven RGB-drone detection work. `null` = no published HSV thresholds.

export const SPECIES = [
  {
    id: 'black_henbane',
    label: 'Black Henbane',
    scientific: 'Hyoscyamus niger',
    color_class: 'yellow',
    bloom: [{ start: '06-01', end: '09-10' }],
    gemini_hint: 'sticky hairy plant with funnel-shaped pale cream-yellow flowers showing dark purple veins and a near-black throat; the dark throat is the strongest ID cue',
    confusion_species: ['Datura (jimsonweed, but larger and whiter)'],
    canopy_visible: 'partial',
    uav_literature: null,
    notes: 'Edmonton: found in Louise McKinney Park. Flowers are sparse on an otherwise drab plant — throat contrast is the discriminating signal for Gemini, not the pale petal colour.',
  },
  {
    id: 'burdock',
    label: 'Burdocks',
    scientific: 'Arctium minus',
    color_class: 'purple_pink',
    bloom: [{ start: '05-20', end: '10-20' }],
    gemini_hint: 'tall plant with very large heart-shaped basal leaves and round pink-purple disc florets emerging from spherical green hooked burs; after flowering the burs dominate as a brown persistent signal',
    confusion_species: ['Canada thistle', 'spotted knapweed', 'musk thistle'],
    canopy_visible: 'yes',
    uav_literature: null,
    notes: 'Good candidate: widespread; bur frames persist over winter for off-season detection.',
  },
  {
    id: 'canada_thistle',
    label: 'Canada Thistle',
    scientific: 'Cirsium arvense',
    color_class: 'purple_pink',
    bloom: [{ start: '06-20', end: '09-10' }],
    gemini_hint: 'spiny-leaved thistle with small pale lavender-pink composite heads in loose clusters; involucral bracts are spineless-tipped (distinguishes from bull thistle)',
    confusion_species: ['bull thistle (larger heads, spine-tipped bracts)', 'knapweed (Centaurea)', 'burdock'],
    canopy_visible: 'yes',
    uav_literature: 'Cirsium spp. included in some Canadian rangeland UAV classifiers (Rahman et al., Saskatchewan), no species-specific HSV published',
    notes: 'Widespread colonial perennial. Heads open pink, then fade to off-white pappus — the seed-fluff stage is a secondary detectable signal.',
  },
  {
    id: 'babys_breath',
    label: "Common Baby's-breath",
    scientific: 'Gypsophila paniculata',
    color_class: 'white',
    bloom: [{ start: '06-10', end: '08-20' }],
    gemini_hint: 'airy spherical cloud of hundreds of tiny (3-6mm) five-petal white flowers on a dome-shaped branching panicle held above surrounding grass',
    confusion_species: ['yarrow (Achillea)', 'wild carrot (Daucus)', 'flixweed in bloom'],
    canopy_visible: 'yes',
    uav_literature: null,
    notes: 'Hardest colour class to mask — hue channel is effectively noise for whites; relies on low-S high-V gate. Cloud texture is the strongest cue after colour.',
  },
  {
    id: 'common_barberry',
    label: 'Common Barberry',
    scientific: 'Berberis vulgaris',
    color_class: 'red_berry',
    bloom: [
      { start: '04-01', end: '04-30' },
      { start: '06-01', end: '06-30' },
      { start: '09-01', end: '10-30' },
    ],
    gemini_hint: 'spiny shrub with grey bark, three-pronged spines at each node, small yellow six-petal drooping flower clusters in spring and bright scarlet oblong berries in fall',
    confusion_species: ['Japanese barberry (similar red berry, smaller)', 'saskatoon and chokecherry (both purple-black fruit, not red)'],
    canopy_visible: 'partial',
    uav_literature: null,
    notes: 'Three ID windows. Red-berry window (Sep-Oct) is the strongest drone signal; berries darken toward maroon after frost.',
  },
  {
    id: 'common_buckthorn',
    label: 'Common Buckthorn',
    scientific: 'Rhamnus cathartica',
    color_class: 'chartreuse',
    bloom: [{ start: '04-01', end: '10-30' }],
    gemini_hint: 'shrub or small tree with oval finely toothed leaves that stay vivid green-yellow well into fall long after native trees turn; dark purple-black berries on female plants',
    confusion_species: ['glossy buckthorn (Frangula alnus)', 'chokecherry'],
    canopy_visible: 'yes',
    uav_literature: 'Becker & Lauenroth and Great Lakes invasives work: multispectral/UAV phenology studies exploit extended green leaf retention — NOT a pure HSV problem',
    notes: 'Flower colour is a dead end. The proven signal is temporal: late-retained green foliage after native trees turn red/yellow (Sep-Oct window). Chartreuse mask catches the fall signature; summer detection needs the multispectral/temporal approach we do not yet support.',
  },
  {
    id: 'common_mullein',
    label: 'Common Mullein',
    scientific: 'Verbascum thapsus',
    color_class: 'yellow',
    bloom: [{ start: '07-01', end: '09-10' }],
    gemini_hint: 'tall dense single vertical spike with sparse sulphur-yellow five-petal flowers opening a few at a time, held above a large silvery-woolly grey-green basal rosette',
    confusion_species: ['evening primrose', 'dense blazing star', 'goldenrod spikes from above'],
    canopy_visible: 'yes',
    uav_literature: 'Rosette texture used in some rangeland UAV classifiers; flower colour not flower-specific',
    notes: 'Only a few flowers open per day on the spike so the yellow signal is sparse — the woolly grey-green rosette (H 30-60 S 10-60 V 150-220) is actually the more reliable drone cue.',
  },
  {
    id: 'common_tansy',
    label: 'Common Tansy',
    scientific: 'Tanacetum vulgare',
    color_class: 'yellow',
    bloom: [{ start: '05-20', end: '10-20' }],
    gemini_hint: 'flat-topped corymb of many small yellow rayless button disc flowers on a branching stem with dark green fern-like foliage',
    confusion_species: ['tansy ragwort (Jacobaea)', 'goldenrod', 'yarrow yellow variants', "St. John's wort"],
    canopy_visible: 'yes',
    uav_literature: 'Included in general yellow-flower rangeland UAV classifiers; no species-specific ranges',
    notes: 'Dense flat-topped corymb is geometrically distinct — held flat at 0.6-1.5m = ideal top-down target. Brown frames persist over winter.',
  },
  {
    id: 'creeping_bellflower',
    label: 'Creeping Bellflower',
    scientific: 'Campanula rapunculoides',
    color_class: 'purple_pink',
    bloom: [{ start: '06-10', end: '09-01' }],
    gemini_hint: 'one-sided spike of nodding light blue-purple bell-shaped flowers with five pointed lobes along a slender 0.5-1m stem',
    confusion_species: ['native harebell (Campanula rotundifolia, smaller)', 'wild bergamot from distance', 'vetch'],
    canopy_visible: 'partial',
    uav_literature: null,
    notes: 'Nodding habit means flowers point sideways/down — oblique drone angles detect better than pure nadir. Hue drifts significantly with camera white balance (blue in cool light, violet in warm).',
  },
  {
    id: 'dames_rocket',
    label: "Dame's Rocket",
    scientific: 'Hesperis matronalis',
    color_class: 'purple_pink',
    bloom: [{ start: '05-15', end: '07-10' }],
    gemini_hint: 'loose clusters of four-petal cruciform flowers in pink, magenta, lilac, or sometimes white on branched stems 0.6-1.2m tall',
    confusion_species: ['garden phlox (5 petals vs 4)', 'wild sweet william'],
    canopy_visible: 'yes',
    uav_literature: null,
    notes: 'Populations are genuinely polymorphic — expect multi-modal colour distribution (pink + magenta + white forms). Four-petal cross is the hard distinguishing cue from 5-petal phlox.',
  },
  {
    id: 'field_scabious',
    label: 'Field Scabious',
    scientific: 'Knautia arvensis',
    color_class: 'purple_pink',
    bloom: [{ start: '06-10', end: '09-20' }],
    gemini_hint: 'long bare wiry stems holding flat lilac pincushion-shaped composite heads 2-4cm across above the meadow canopy, with dark anthers dotting the surface',
    confusion_species: ['devil\'s-bit scabious', 'small scabious', 'red clover heads from distance'],
    canopy_visible: 'yes',
    uav_literature: null,
    notes: 'Mainly in Terwillegar Park. Long bare peduncles above meadow canopy = excellent drone target geometrically, but colour is subtle and reads grey-lilac in flat overcast.',
  },
  {
    id: 'garlic_mustard',
    label: 'Garlic Mustard',
    scientific: 'Alliaria petiolata',
    color_class: 'white',
    bloom: [{ start: '04-20', end: '09-10' }],
    gemini_hint: 'small (6-8mm) pure white four-petal cruciform flowers in a terminal cluster atop triangular toothed upper leaves and kidney-shaped basal leaves',
    confusion_species: ['toothworts', 'sweet cicely', 'other white-flowered spring ephemerals'],
    canopy_visible: 'no',
    uav_literature: 'Frye et al., Rodgers et al. — UAV hyperspectral in Midwest US forests; detection relies on NDVI/red-edge leaf-on phenology, NOT visible RGB',
    notes: 'Classic forest understorey — typically hidden under tree canopy. Best detected in early spring BEFORE canopy leaf-out. Our RGB-only pipeline will miss most summer populations; phenology-aware scheduling is critical.',
  },
  {
    id: 'himalayan_balsam',
    label: 'Himalayan Balsam',
    scientific: 'Impatiens glandulifera',
    color_class: 'purple_pink',
    bloom: [{ start: '06-20', end: '09-10' }],
    gemini_hint: 'tall (1-2.5m) hollow reddish stems with whorled lanceolate leaves and distinctive hooded/helmet-shaped flowers ranging from pale to deep magenta, occasionally white',
    confusion_species: ['jewelweed (native Impatiens, smaller and orange)'],
    canopy_visible: 'yes',
    uav_literature: 'Müllerová et al. (2017) "Timing is important": UAV RGB along riparian corridors, 2-5cm GSD at peak bloom',
    notes: 'Tallest non-tree pink-flowered species in Edmonton riparian zones; forms dense monocultures so colour signal is strong. Genuinely polymorphic — expect bimodal hue distribution.',
  },
  {
    id: 'leafy_spurge',
    label: 'Leafy Spurge',
    scientific: 'Euphorbia esula',
    color_class: 'chartreuse',
    bloom: [{ start: '05-20', end: '08-30' }],
    gemini_hint: 'dense mat of narrow blue-green leaves topped by flat umbels of vivid chartreuse heart-shaped bracts; the bracts are the visible colour, true flowers are tiny and inconspicuous',
    confusion_species: ['cypress spurge (near-identical)', "wolf's milk spurges", 'some Sedum species'],
    canopy_visible: 'yes',
    uav_literature: 'Anderson (1996) hyperspectral aerial foundational reference; Hunt et al. UAV followup; Kazmi et al. — bract hue H 32-50 is a known discriminator',
    notes: 'One of the strongest colour-only signals of any species — chartreuse is rare outside spurge in the Alberta landscape.',
  },
  {
    id: 'orange_hawkweed',
    label: 'Orange Hawkweed',
    scientific: 'Pilosella aurantiaca',
    color_class: 'orange',
    bloom: [{ start: '06-01', end: '08-10' }],
    gemini_hint: 'tight cluster of small flat vivid red-orange dandelion-like composite heads with dark centres on a leafless hairy scape 20-40cm above a basal rosette',
    confusion_species: ['orange Indian paintbrush (but more red, bract-structured)'],
    canopy_visible: 'yes',
    uav_literature: 'BC Ministry weed programs UAV RGB; Gonzalez-Moreno et al. — vivid orange against green grass = highest single-channel separability of any species on this list',
    notes: 'Formerly Hieracium aurantiacum. One of the most spectrally stable targets — slight shift toward red in evening light is the only variation to account for.',
  },
  {
    id: 'purple_loosestrife',
    label: 'Purple Loosestrife',
    scientific: 'Lythrum salicaria',
    color_class: 'purple_pink',
    bloom: [{ start: '06-20', end: '09-15' }],
    gemini_hint: 'tall (0.8-1.5m) dense vertical spike of many small magenta-pink six-petal flowers on a square stem with opposite lanceolate leaves, in wetlands or pond margins',
    confusion_species: ['fireweed / Chamerion (similar colour but 4-petal, different habit)', 'blazing star', 'dense-flowered lupines from distance'],
    canopy_visible: 'yes',
    uav_literature: 'Laba et al. (NY Great Lakes wetland UAV RGB); Bradley (2014) invasive remote sensing review. UAV RGB detection reported at 2-4cm GSD during peak bloom; H ~150-165 range',
    notes: 'Original target species. Fades toward lilac as flowers age along spike (bottom flowers older). Can photograph more blue-ish in overcast.',
  },
  {
    id: 'yellow_clematis',
    label: 'Yellow Clematis',
    scientific: 'Clematis tangutica',
    color_class: 'yellow',
    bloom: [{ start: '07-01', end: '08-20' }],
    gemini_hint: 'climbing vine draping over shrubs, fences, and trees with nodding lantern-shaped bright yellow flowers formed of four pointed sepals; silvery feathery achene seed heads in late season',
    confusion_species: ['native western virgin\'s bower (white)', 'yellow roses from distance'],
    canopy_visible: 'yes',
    uav_literature: null,
    notes: 'Vine habit = yellow drape over existing structure. Nodding habit means oblique angle detects better than pure nadir. Silver seed heads are a distinct second-season signal.',
  },
  {
    id: 'yellow_toadflax',
    label: 'Yellow Toadflax',
    scientific: 'Linaria vulgaris',
    color_class: 'yellow',
    bloom: [{ start: '06-15', end: '09-10' }],
    gemini_hint: 'dense spike of snapdragon-like two-lipped pale yellow flowers each with a vivid deep orange throat/palate blotch, also called "butter and eggs"',
    confusion_species: ['Dalmatian toadflax (L. dalmatica, same colour but broader leaves)', 'escaped garden snapdragons', "bird's-foot trefoil from distance"],
    canopy_visible: 'yes',
    uav_literature: 'Included in some Montana/Alberta rangeland UAV invasive maps but no HSV-specific thresholds published',
    notes: 'Two-tone yellow+orange is the distinguishing signature from other yellow species. Throat blotch is the key cue and is often visible from above.',
  },
]

/** Lookup a species by id. Returns undefined if unknown. */
export function getSpeciesById(id) {
  return SPECIES.find(s => s.id === id)
}

/** All unique color_class keys referenced by the registry. */
export function getReferencedColorClasses(speciesList = SPECIES) {
  return [...new Set(speciesList.map(s => s.color_class))]
}

/** Return species grouped by their color_class, preserving registry order. */
export function groupByColorClass(speciesList = SPECIES) {
  const groups = {}
  for (const sp of speciesList) {
    if (!groups[sp.color_class]) groups[sp.color_class] = []
    groups[sp.color_class].push(sp)
  }
  return groups
}
