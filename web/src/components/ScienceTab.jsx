import { SPECIES, groupByColorClass } from '../lib/species.js'
import { COLOR_CLASSES, COLOR_CLASS_ORDER } from '../lib/colorClasses.js'

// Honest, end-to-end explainer of how the detector works.
// Audience: City of Edmonton ops + technical reviewers.
// Goal: anyone reading this should understand exactly what runs where,
// what data is sent off-device, and what the limits of the system are.

export default function ScienceTab() {
  const groups = groupByColorClass(SPECIES)
  const speciesWithLit = SPECIES.filter(s => s.uav_literature)
  const speciesWithoutLit = SPECIES.filter(s => !s.uav_literature)

  return (
    <div className="science-panel">
      <header className="science-header">
        <h2>How this works</h2>
        <p className="muted">
          A complete technical walkthrough of the Edmonton Weed Detector — what the app does, where
          your data goes, what models we call, and where the limits are. Updated as the code changes.
        </p>
      </header>

      <Section title="At a glance">
        <ul>
          <li><strong>What it does:</strong> finds 18 regulated invasive weed species in drone aerial photos.</li>
          <li><strong>Where it runs:</strong> entirely in your browser. The full-resolution photos never leave your machine.</li>
          <li><strong>What gets sent off-device:</strong> only small ~256×256 px JPEG crops centred on candidate blobs, sent to Google Gemini Vision for species identification.</li>
          <li><strong>How it's smart:</strong> a colour mask first finds candidate regions, then Gemini classifies each crop, with the species candidate list narrowed by the bloom calendar so the model only has to discriminate between species that could plausibly be in flower on the photo date.</li>
          <li><strong>How it gets smarter:</strong> your "Correct / Wrong species / Not a weed" verdicts are stored locally; near-duplicate crops in future scans skip Gemini entirely and inherit your judgment.</li>
        </ul>
      </Section>

      <Section title="The detection pipeline (per photo)">
        <ol className="numbered-list">
          <li>
            <strong>EXIF date extraction.</strong> The browser reads the photo's <code>DateTimeOriginal</code>
            tag using <code>exifr</code>. If absent, falls back to file modification time, then today.
            The date drives the bloom-window filter in step 3.
          </li>
          <li>
            <strong>Decode + downscale.</strong> The photo is decoded to an OffscreenCanvas inside a
            Web Worker (so the UI never freezes), then downscaled to a max width of 1500 px for the
            CV pass. Native-resolution coordinates are recovered at the end.
          </li>
          <li>
            <strong>Multi-class colour masking.</strong> For each colour class spanned by your selected
            species, the worker builds a binary mask in either HSV or CIELAB space (whichever is
            cleaner for that colour — more on this below). White is the only class where Lab outperforms
            HSV; for everything else HSV is used.
          </li>
          <li>
            <strong>Vegetation gating.</strong> Coloured masks (purple, yellow, orange) are
            <code>AND</code>ed with an <strong>Excess Green</strong> mask
            (<code>2G − R − B &gt; 0</code>) so red rooftops, sun glare on concrete, and white
            tarps don't sneak through. Chartreuse and white skip this gate (chartreuse <em>is</em>
            vegetation; white petals don't show as green).
          </li>
          <li>
            <strong>Morphological close + connected components.</strong> A 9×9 close kernel merges
            adjacent pixels into coherent blobs. Each connected component becomes a candidate
            bbox. Blobs are filtered by min/max area (per class) and capped (20 per class, 60 total)
            so a dense field can't generate hundreds of Gemini calls.
          </li>
          <li>
            <strong>Crop + perceptual hash.</strong> For each surviving blob the original
            full-resolution photo is cropped with a 1.5× context pad and exported as a JPEG. A
            64-bit dHash is computed on the crop.
          </li>
          <li>
            <strong>Verdict cache lookup.</strong> The dHash is compared against every previously
            human-verified blob in your local database via Hamming distance. If a near-duplicate
            (≤6 bits different out of 64) is found, the crop <em>skips Gemini entirely</em> and
            inherits the human verdict from the cached blob — saving an API call and using
            the most authoritative answer available (yours).
          </li>
          <li>
            <strong>Gemini Vision call.</strong> If no cache hit, the JPEG is base64-encoded and
            POSTed to a server-side proxy holding the Gemini API key (you never see the key).
            The prompt is built dynamically — see the next section.
          </li>
          <li>
            <strong>Result rendering.</strong> The detection is added to the photo's bbox overlay,
            colour-coded by which mask class flagged it. You can click any bbox to zoom in,
            confirm or correct the species, or mark it not-a-weed.
          </li>
        </ol>
      </Section>

      <Section title="The Gemini prompt (and why phenology matters)">
        <p>
          The Gemini prompt is the most important piece of accuracy engineering in the whole app.
          Instead of asking <em>"what is this plant?"</em> we ask a much narrower question, dynamically
          assembled at the moment of the call:
        </p>
        <pre className="science-pre">{`This is a tight crop from a drone aerial photo (~50–150 m
altitude) of an Edmonton-area natural area, taken on
{photo_date}. The upstream HSV mask flagged this crop as
colour class "{colour_class}".

Identify which species (if any) is shown. Candidates currently
in season for this colour class:

- {species_id_1} → {label} ({scientific}). {description}.
  Not to be confused with: {confusion_species}.
- {species_id_2} → ...

If the crop shows none of these and is some other plant or a
non-plant object (tarp, jacket, vehicle, paint, sign), say so.
Be especially careful to distinguish each candidate from its
listed confusion species.

Respond ONLY with a JSON object — no markdown, no extra text:
{ "is_plant": ..., "species_id": ..., "species": ...,
  "confidence": ..., "description": ... }`}</pre>
        <p>
          Why this works: instead of asking Gemini to discriminate between all 18 species at every
          call, we filter to species that <strong>(a)</strong> match the colour class the upstream
          mask detected, and <strong>(b)</strong> are in flower on the photo's EXIF date. On a
          typical July photo this drops the candidate set from 18 to ~6, and on an April photo it
          can drop to a single candidate per colour class. The model then only has to confirm or
          deny — a much easier task than open-ended identification.
        </p>
        <p>
          The <code>confusion_species</code> list is also injected so the model can explicitly
          rule out the common look-alikes (e.g. fireweed for Purple Loosestrife, Bull Thistle for
          Canada Thistle, Garden Phlox for Dame's Rocket).
        </p>
      </Section>

      <Section title="The model: Gemini 2.5 Flash">
        <p>
          We use <strong>Google Gemini 2.5 Flash</strong> via the official Generative Language API.
          The choice was driven by three factors:
        </p>
        <ul>
          <li><strong>Multimodal:</strong> takes JPEG + text in one call, returns structured JSON.</li>
          <li><strong>Cheap:</strong> roughly 1/30th the cost of Gemini Pro; ~$0.0001 per crop at
          our prompt size.</li>
          <li><strong>Fast:</strong> p50 ~1.2 sec per call, which keeps the field workflow responsive.</li>
        </ul>
        <p>
          We pass <code>thinkingConfig: {`{thinkingBudget: 0}`}</code> to disable the model's
          chain-of-thought tokens — Flash with thinking enabled spends most of its output budget
          on reasoning text the user never sees, leaving too few tokens for the actual JSON. With
          thinking disabled the model emits the answer directly in &lt;512 tokens.
        </p>
        <p>
          We also use the <code>responseMimeType: "application/json"</code> mode, which constrains
          the model's output to valid JSON via Google's structured-output decoder. This eliminates
          the markdown-fence stripping and parse-loose fallback we needed in earlier prototypes.
        </p>
        <p className="muted small">
          What Gemini does <em>not</em> see: the original full-resolution photo, EXIF metadata
          beyond the date, your location, your name, or any other crops from the same photo.
          Each crop is sent in isolation.
        </p>
      </Section>

      <Section title="Colour classes (and why six)">
        <p>
          All 18 species map to one of 6 consolidated colour classes. Running one mask per class
          (instead of one per species) is ~6× cheaper, and species disambiguation happens
          downstream in Gemini anyway.
        </p>
        <table className="science-table">
          <thead>
            <tr>
              <th></th>
              <th>Class</th>
              <th>Species</th>
              <th>Mask space</th>
              <th>Veg gate</th>
            </tr>
          </thead>
          <tbody>
            {COLOR_CLASS_ORDER.map(clsId => {
              const cls = COLOR_CLASSES[clsId]
              const list = groups[clsId] || []
              return (
                <tr key={clsId}>
                  <td><span className="color-dot" style={{ backgroundColor: cls.bbox_color }} /></td>
                  <td><strong>{cls.label}</strong></td>
                  <td className="muted small">{list.map(s => s.label).join(', ')}</td>
                  <td className="muted small">{cls.lab ? 'Lab + HSV' : 'HSV'}</td>
                  <td className="muted small">{cls.vegetation_gate ? 'yes (ExG)' : 'no'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p>
          <strong>Why Lab for white:</strong> white flowers have essentially no hue, so the HSV
          H channel becomes meaningless noise. CIELAB isolates them via <code>L* &gt; 220</code>
          and <code>|a*| &lt; 10, |b*| &lt; 10</code>, which is dramatically cleaner. We also keep
          an HSV <code>S &lt; 40, V &gt; 215</code> backup mask in case the camera's white balance
          throws off Lab.
        </p>
        <p>
          <strong>Why no veg gate for chartreuse and white:</strong> chartreuse <em>is</em>
          vegetation, so the gate would zero it out. White petals don't show as ExG-positive
          either (their green channel isn't dominant).
        </p>
      </Section>

      <Section title="Sources of grounding">
        <p>
          Where the numbers in this app actually come from:
        </p>
        <ul>
          <li>
            <strong>Bloom windows:</strong> City of Edmonton Species Calendar PDF
            (drone mapping reference). All 18 species, 10-day granularity, year-agnostic.
          </li>
          <li>
            <strong>Colour ranges:</strong> a mix of published UAV detection literature and
            botanical reference colour descriptions. {speciesWithLit.length} of 18 species have
            grounded literature; the other {speciesWithoutLit.length} use conservative starting
            values that will be refined as you log verdicts.
          </li>
          <li>
            <strong>UAV-published species:</strong>
            <ul className="science-sub-list">
              {speciesWithLit.map(sp => (
                <li key={sp.id}>
                  <strong>{sp.label}</strong> — {sp.uav_literature}
                </li>
              ))}
            </ul>
          </li>
          <li>
            <strong>Confusion species (per registry entry):</strong> compiled from Alberta Invasive
            Species Council and provincial weed fact sheets, then injected into the Gemini prompt
            so the model rules them out explicitly.
          </li>
        </ul>
      </Section>

      <Section title="The HITL learning loop">
        <p>
          Every detection in the verdict panel can be marked <strong>Correct</strong>,
          <strong>Wrong species</strong>, or <strong>Not a weed</strong>. These verdicts power
          two learning mechanisms:
        </p>
        <ol className="numbered-list">
          <li>
            <strong>Perceptual-hash inheritance (always on).</strong> When you verify a crop,
            its 64-bit dHash + thumbnail are stored locally. Every future scan computes the dHash
            of each new crop and looks for the nearest verified neighbour by Hamming distance.
            If one is within 6 bits, the new crop inherits the human verdict and Gemini is never
            called. Effectively zero cost, unbounded improvement.
          </li>
          <li>
            <strong>Few-shot prompt augmentation (opt-in).</strong> The "Use my verdicts to
            improve accuracy" toggle pulls 2 confirmed-positive and 2 confirmed-negative thumbnails
            and prepends them to the Gemini call as in-context calibration. Costs ~3× more tokens
            per call, but materially improves precision for species that look like other things
            (e.g. ruling out purple jackets from purple loosestrife scans).
          </li>
        </ol>
        <p>
          Both mechanisms are local to your browser. Your verdicts never leave your machine and
          do not contribute to anyone else's instance of the app.
        </p>
      </Section>

      <Section title="Storage and privacy">
        <ul>
          <li>
            <strong>Photos:</strong> never uploaded. Decoded into a Web Worker, processed
            client-side, displayed via blob URLs that are revoked on session reset.
          </li>
          <li>
            <strong>Crops sent to Gemini:</strong> ~256×256 JPEGs at quality 0.88, base64-encoded.
            Each is sent in isolation with no metadata other than the prompt itself. Google's
            Gemini API does not retain prompts or images by default for paid Cloud accounts.
          </li>
          <li>
            <strong>Local cache:</strong> Dexie 4 (an IndexedDB wrapper). Two tables — <code>results</code>
            (one row per photo, with bbox list and Gemini outputs) and <code>verdicts</code>
            (one row per human verdict, with the AI snapshot, dHash, thumbnail, and bbox geometry).
            Schema is at version 2; the version bump from v1 added the verdicts table and was
            tested for in-flight migration.
          </li>
          <li>
            <strong>Access control:</strong> the GCP Cloud Function proxy requires a shared
            password sent in the <code>X-Access-Password</code> header. Stored in
            <code>localStorage</code> on first entry. The Reset dialog can wipe it.
          </li>
        </ul>
      </Section>

      <Section title="Tech stack">
        <table className="science-table">
          <tbody>
            <tr><td><strong>Frontend</strong></td><td>React 18, Vite 5, vanilla CSS</td></tr>
            <tr><td><strong>Computer vision</strong></td><td>opencv.js 4.10 (WebAssembly) in a Web Worker</td></tr>
            <tr><td><strong>Local storage</strong></td><td>Dexie 4 (IndexedDB wrapper), v2 schema</td></tr>
            <tr><td><strong>EXIF parsing</strong></td><td>exifr 7</td></tr>
            <tr><td><strong>Vision model</strong></td><td>Google Gemini 2.5 Flash via Generative Language API</td></tr>
            <tr><td><strong>API proxy</strong></td><td>Google Cloud Function (gen2), Python 3.12, functions-framework</td></tr>
            <tr><td><strong>Secret management</strong></td><td>GCP Secret Manager (gemini-api-key)</td></tr>
            <tr><td><strong>Static hosting</strong></td><td>Google Cloud Storage public bucket</td></tr>
            <tr><td><strong>Build / CI</strong></td><td>Local <code>bash gcp/deploy.sh</code> via gcloud SDK</td></tr>
            <tr><td><strong>Source control</strong></td><td>GitHub (origin) + GitLab (Edmonton internal mirror)</td></tr>
          </tbody>
        </table>
      </Section>

      <Section title="Known limitations">
        <ul>
          <li>
            <strong>White flowers</strong> (baby's-breath, garlic mustard, white-form Dame's
            rocket / balsam) are the hardest case. Even with the Lab mask, sun-bleached grass and
            white concrete still slip through. Expect lower precision until enough verdicts have
            accumulated for the few-shot learner to take over.
          </li>
          <li>
            <strong>Garlic mustard</strong> is a forest-understorey species. The published UAV
            detection work for it relies on multispectral red-edge phenology in early spring
            <em>before</em> tree canopy leaf-out — not a problem RGB drone photography can solve
            in summer. Time your surveys for late April / early May.
          </li>
          <li>
            <strong>Common buckthorn</strong>'s flower colour is genuinely uninformative. The
            proven detection signal is the late-retained green foliage in September / October
            after native trees have turned. The chartreuse mask catches this fall signature, but
            summer detection of buckthorn from RGB photos alone is unreliable.
          </li>
          <li>
            <strong>Dame's rocket and Himalayan balsam</strong> are genuinely polymorphic
            (pink + magenta + white forms in the same population). The mask is widened to cover
            the range, and the prompt warns the model to expect multi-modal colour distribution.
          </li>
          <li>
            <strong>Out-of-season species</strong> won't be detected by default — the in-season
            filter excludes them from both the colour mask set <em>and</em> the Gemini prompt.
            Disable the filter or manually re-enable a species if you suspect off-season
            identifiability (e.g. winter-persistent burdock burs).
          </li>
          <li>
            <strong>Lighting drift.</strong> All HSV ranges are starting points calibrated against
            literature and botanical references, not your specific drone + sensor + altitude. Some
            tuning will be needed once you have field photos to test against. The HITL verdict
            loop converts this into a one-time investment instead of an ongoing annoyance.
          </li>
        </ul>
      </Section>

      <footer className="science-footer muted small">
        Built for the City of Edmonton OPM team. Source code on
        {' '}<a href="https://github.com/Tphambolio/purple-weed-detector" target="_blank" rel="noopener noreferrer">GitHub</a>{' '}
        and the
        {' '}<a href="https://git.edmonton.ca/opm-operation-performance-and-analytics/purple-weed-detector" target="_blank" rel="noopener noreferrer">Edmonton GitLab</a>.
      </footer>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="science-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}
