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
| Pacifico | Script | `Pacifico-Regular.ttf` | Google Fonts (`ofl/pacifico`) |
| Alex Brush | Script | `AlexBrush-Regular.ttf` | Google Fonts (`ofl/alexbrush`) |
| Allura | Script | `Allura-Regular.ttf` | Google Fonts (`ofl/allura`) |
| Satisfy | Script | `Satisfy-Regular.ttf` | Google Fonts (`apache/satisfy`) |
| Kaushan Script | Script | `KaushanScript-Regular.ttf` | Google Fonts (`ofl/kaushanscript`) |
| Yellowtail | Script | `Yellowtail-Regular.ttf` | Google Fonts (`apache/yellowtail`) |
| Cookie | Script | `Cookie-Regular.ttf` | Google Fonts (`ofl/cookie`) |
| Parisienne | Script | `Parisienne-Regular.ttf` | Google Fonts (`ofl/parisienne`) |
| Mr Dafoe | Script | `MrDafoe-Regular.ttf` | Google Fonts (`ofl/mrdafoe`) |
| Bebas Neue | Block | `BebasNeue-Regular.ttf` | Google Fonts (`ofl/bebasneue`) |
| Righteous | Display | `Righteous-Regular.ttf` | Google Fonts (`ofl/righteous`) |
| Lilita One | Display | `LilitaOne-Regular.ttf` | Google Fonts (`ofl/lilitaone`) |
| Abril Fatface | Display | `AbrilFatface-Regular.ttf` | Google Fonts (`ofl/abrilfatface`) |
| Poppins | Sans Serif | `Poppins-Regular.ttf` | Google Fonts (`ofl/poppins`) |
| Poppins SemiBold | Sans Serif | `Poppins-SemiBold.ttf` | Google Fonts (`ofl/poppins`) |
| Poppins Bold | Sans Serif | `Poppins-Bold.ttf` | Google Fonts (`ofl/poppins`) |
| Lobster Two Bold | Decorative | `LobsterTwo-Bold.ttf` | Google Fonts (`ofl/lobstertwo`) |

The first nine are licensed under the SIL Open Font License (OFL) -- free for commercial rhinestone
production use, with no attribution requirement in the finished product. Regular/static instances
were used throughout; where upstream only ships a variable font (Montserrat, Playfair Display,
Cinzel, Caveat), the default-weight master was taken as-is (`opentype.js` reads a variable font's
`glyf` table directly, which already holds the default-instance outlines).

### FONT-LIB-002 additions

The 17 rows below "Caveat" were added by FONT-LIB-002 to open the font library. All are **static
instances** (opentype.js reads a `[wght]` variable file only at its default master, so a variable
file cannot supply a real Bold). Every family is SIL OFL except **Satisfy** and **Yellowtail**,
which upstream ships under **Apache-2.0** (`apache/` rather than `ofl/` in `google/fonts`); both
licenses permit unrestricted commercial rhinestone production with no attribution in the finished
product. The requested new weights for already-bundled families (Montserrat, Playfair Display,
Baloo 2, Cinzel, Dancing Script) and the Oswald / Fredoka Bold instances were **skipped** -- those
families are variable-only in `google/fonts` with no `static/` folder. See
`docs/specifications/FONT-LIB-002-OpenFontLibrary.md`.

`RobotoMono-Regular.ttf` is a deliberate exception: a 14-byte placeholder stub, not a real font
file. It stays registered (`"enabled": false`) and untouched -- `tools/test-opentype-provider.mjs`
depends on it to exercise the "font is registered but its file cannot be parsed" error path.
