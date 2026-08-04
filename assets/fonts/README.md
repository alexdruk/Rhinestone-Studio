# Font Assets

Bundled fonts live here. Every entry in `manifest.json` with `"enabled": true` ships a real
`.ttf` file in this directory; `FontManager`/`OpenTypeProvider` (see `src/fonts/`, `src/text/`)
are the only code that reads them. Do not rely on user-installed system fonts for production
output -- Rhinestone layouts must be deterministic across machines.

## Bundled fonts (RS-2002 Typography & Font Library)

| Family | Category | File | Source |
|---|---|---|---|
| Courier Prime | Monospace | `CourierPrime-Regular.ttf` | Google Fonts (`ofl/courierprime`) |
| Great Vibes | Script | `GreatVibes-Regular.ttf` | Google Fonts (`ofl/greatvibes`) |
| PT Serif | Serif | `PTSerif-Regular.ttf` | Google Fonts (`ofl/ptserif`) |
| Montserrat | Sans Serif | `Montserrat-Regular.ttf` | Google Fonts (`ofl/montserrat`) |
| Playfair Display | Display | `PlayfairDisplay-Regular.ttf` | Google Fonts (`ofl/playfairdisplay`) |
| Cinzel | Monogram | `Cinzel-Regular.ttf` | Google Fonts (`ofl/cinzel`) |
| Lobster | Decorative | `Lobster-Regular.ttf` | Google Fonts (`ofl/lobster`) |
| Anton | Block | `Anton-Regular.ttf` | Google Fonts (`ofl/anton`) |
| Caveat | Handwritten | `Caveat-Regular.ttf` | Google Fonts (`ofl/caveat`) |

All nine are licensed under the SIL Open Font License (OFL) -- free for commercial rhinestone
production use, with no attribution requirement in the finished product. Regular/static instances
were used throughout; where upstream only ships a variable font (Montserrat, Playfair Display,
Cinzel, Caveat), the default-weight master was taken as-is (`opentype.js` reads a variable font's
`glyf` table directly, which already holds the default-instance outlines).

`RobotoMono-Regular.ttf` is a deliberate exception: a 14-byte placeholder stub, not a real font
file. It stays registered (`"enabled": false`) and untouched -- `tools/test-opentype-provider.mjs`
depends on it to exercise the "font is registered but its file cannot be parsed" error path.
