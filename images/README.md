# Product images

Drop files in `products/`, named by **IQ stock code**, then rebuild the
manifest. The code is the key because it is the one identifier that is stable
and unique — display names change with every price import, codes do not.

```
products/BU035.png       Black Label 750ML single
products/CB034.png       Black Label 12X750ML case
products/600149604008.png
```

Then, from `web/`:

```bash
python3 ../scripts/build_image_manifest.py
```

That writes `manifest.json` (`{"BU035": "BU035.png"}`), which the site reads
once. A product with no entry gets a drawn silhouette — no broken images.

## Where images may come from

**Supplier and brand assets — use these.** Distell, Heineken, SAB/AB InBev and
Diageo issue packshots to trade customers, usually as transparent PNGs, which is
exactly the cut-out look wanted here. They are free, correct, high resolution,
and the brand owner wants their product shown. Ask your rep for the trade asset
pack or brand portal login.

**Sam's own photographs — also fine.** Slower, but unambiguously yours.

**Competitor retail sites — no.** Pick n Pay, Makro, Takealot and the rest own
their packshot photography or hold it under a licence that covers only them.
Reusing it to sell the same products to the same market is the version most
likely to be noticed, by the party most motivated to act on it. It is also
against their terms of use.

## Format

- **PNG with a transparent background**, or WebP. Transparency is what makes a
  catalogue grid look consistent.
- Around **600×800**, product centred with a little breathing room.
- Keep them under ~150KB each; the grid loads many at once and they are lazy
  loaded, but the total still matters on a phone.
