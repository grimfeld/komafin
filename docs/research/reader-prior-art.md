# What prior-art comic readers do well

Research for issue #6. A survey of how established readers handle Reading mode switching,
Spread handling, tap zones and gestures, zoom, Reading direction detection and offline
downloads. Each section ends with the patterns worth adopting and the anti-patterns to avoid.

Sources, checked on 2026-11-09. Code links are permalinks to these commits:

| Reader                          | Source                                                                                                                                                                      | Shortened to |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Mihon (Android, Tachiyomi fork) | [`mihonapp/mihon@7eec566d9c`](https://github.com/mihonapp/mihon/tree/7eec566d9c) and [mihon.app/docs/guides/reader-settings](https://mihon.app/docs/guides/reader-settings) | `mihon:`     |
| Komga web reader                | [`gotson/komga@609e98a145`](https://github.com/gotson/komga/tree/609e98a145), `komga-webui/src/`                                                                            | `komga:`     |
| Kavita web reader               | [`Kareadita/Kavita@6ae5d302d2`](https://github.com/Kareadita/Kavita/tree/6ae5d302d2)                                                                                        | `kavita:`    |
| YACReader (desktop)             | [`YACReader/yacreader@fef64948ce`](https://github.com/YACReader/yacreader/tree/fef64948ce), `YACReader/`                                                                    | `yac:`       |
| jellyfin-web comics player      | [`jellyfin/jellyfin-web@ff0d12bffa`](https://github.com/jellyfin/jellyfin-web/tree/ff0d12bffa), `src/plugins/comicsPlayer/plugin.js`                                        | `jfweb:`     |
| Jellyfin Bookshelf plugin       | [`jellyfin/jellyfin-plugin-bookshelf@a94213af22`](https://github.com/jellyfin/jellyfin-plugin-bookshelf/tree/a94213af22)                                                    | `bookshelf:` |
| Panels (iOS/macOS, closed)      | [panels.app](https://panels.app), [guides.panels.app](https://guides.panels.app)                                                                                            | —            |
| Chunky (iOS, closed)            | [App Store listing](https://apps.apple.com/us/app/chunky-comic-reader/id663567628)                                                                                          | —            |
| ComicInfo schema                | [Anansi Project docs](https://anansi-project.github.io/docs/comicinfo/documentation)                                                                                        | —            |

**Coverage limits.** Panels and Chunky are closed source, so only their own marketing and help
pages count as primary sources. Those pages say nothing about tap zones, cover offset or zoom
details. Chunky looks abandoned: its last App Store update is v2.5.10 from 2020-08-16, and
`chunkyreader.com` now redirects to an unrelated site. Read its row as historical.

## Summary

- **Keep Reading mode and Reading direction as separate settings, resolved per Series.** Mihon
  and Komga each fold both into one enum (`LEFT_TO_RIGHT, RIGHT_TO_LEFT, VERTICAL, WEBTOON`), and
  Kavita needs a separate `DoubleReversed` layout just for manga. The best model is Kavita's
  layering, Series → library → default, with in-reader tweaks saved as an "implicit" profile
  for that Series.
- **Lay out Spreads from Page dimensions, with three rules:** the cover stands alone, a wide Page
  stands alone, and pairing restarts after any lone Page. Komga, Kavita, YACReader and Mihon all
  converge on this. The reader also needs a manual "shift by one Page" control for scans where the
  rules guess wrong (Kavita `pageOffset`, YACReader `offsetDoublePage`).
- **Make two-page layout automatic: on in landscape, off in portrait.** Mihon (`When wide`),
  Panels (`Automatic`) and Chunky all do this.
- **Tap zones flip with Reading direction, are configurable, and are taught on first launch with
  an overlay.** Keyboard arrows must flip with direction too.
- **Don't give double-tap two meanings.** Kavita uses double-click for bookmarking, which rules
  out double-tap zoom. Mihon, jellyfin-web and Panels use double-tap for zoom.
- **Reading direction detection:** the order of evidence is ComicInfo `Manga=YesAndRightToLeft`,
  then the Series override, then the user default. **Jellyfin discards the `Manga` field**, so
  Komafin must read `ComicInfo.xml` from the archive itself. When metadata changes the direction,
  say so in a toast (Komga does this).
- **The jellyfin-web reader is the cautionary tale.** It downloads and unpacks the whole archive
  before showing Page 1, sorts Pages by plain string comparison, pairs Pages in two-up mode with
  no cover or wide-Page handling, and keeps settings per Book.
- **Offline:** "Download the Series" (Panels) and "download ahead while reading", "delete after
  read" and "Wi-Fi only" (Mihon) are the proven controls. On Jellyfin, every read already fetches
  the whole archive, so keeping it is nearly free.

## 1. Reading mode switching

What they do:

- **Mihon** offers five viewers in one enum: `LEFT_TO_RIGHT`, `RIGHT_TO_LEFT`, `VERTICAL` (paged),
  `WEBTOON` (long strip) and `CONTINUOUS_VERTICAL` (long strip with gaps). There is also a `DEFAULT`
  value that resolves to the global preference. Each manga stores its value as a bit flag, so the
  choice is per Series ([mihon:…/setting/ReadingMode.kt](https://github.com/mihonapp/mihon/blob/7eec566d9c/app/src/main/java/eu/kanade/tachiyomi/ui/reader/setting/ReadingMode.kt)).
  The docs say a series override is set in the reader (gear icon, "Viewer for this series"), and
  the global default is right-to-left ([reader-settings](https://mihon.app/docs/guides/reader-settings)).
- **Komga** has `ReadingDirection { LEFT_TO_RIGHT, RIGHT_TO_LEFT, VERTICAL, WEBTOON }`
  ([komga:types/enum-books.ts](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/types/enum-books.ts)).
  The user's choice is stored globally, but the Series' metadata direction is applied for the
  session, "bypass[ing the] setter so setting is not persisted", and a notification says it came
  "from series metadata" ([komga:views/DivinaReader.vue L720-727](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/views/DivinaReader.vue#L720-L727)).
  Single-key shortcuts switch modes: `l`/`r`/`v`/`w` for the modes, `d` to cycle Page layout,
  `c` to cycle scale, `h` for help ([komga:functions/shortcuts/](https://github.com/gotson/komga/tree/609e98a145/komga-webui/src/functions/shortcuts)).
- **Kavita** uses **Reading Profiles**. A profile bundles direction, reader mode, layout, scaling,
  split options and more, and can be bound to Series, libraries and devices. Kinds are `Default`,
  `User` and `Implicit`. An implicit profile records in-reader changes for one Series and can be
  promoted to a saved profile
  ([kavita:UI/Web/…/reading-profiles.ts](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/UI/Web/src/app/_models/preferences/reading-profiles.ts),
  [kavita:Kavita.Services/Reading/ReadingProfileService.cs](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/Kavita.Services/Reading/ReadingProfileService.cs)).
  Kavita also switches to webtoon mode automatically from a Page-dimension heuristic (tall aspect
  ratios, consistent widths), shows a toast when it does, and lets users opt out
  (`allowAutomaticWebtoonReaderDetection`)
  ([kavita:manga-reader.service.ts `shouldBeWebtoonMode`](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/UI/Web/src/app/manga-reader/_service/manga-reader.service.ts#L185-L282)).
- **Panels** uses **presets**: saved bundles of page transition, scroll direction, number of pages
  (`One / Two / Automatic`) and fitting. "Standard" is paged and switches to two pages in landscape.
  Closing the editor with X applies the settings to the current comic without saving a preset
  ([guides.panels.app/read-content/reader-configurations](https://guides.panels.app/read-content/reader-configurations)).
- **jellyfin-web** has two toggle buttons, direction (`ltr`/`rtl`) and pages per view (1/2). Both
  are saved per item, which is per Book, not per Series (`userSettings.getComicsPlayerSettings(mediaSourceId)`,
  [jfweb:plugin.js L43-53, L116-158](https://github.com/jellyfin/jellyfin-web/blob/ff0d12bffa/src/plugins/comicsPlayer/plugin.js#L43-L158)).

Adopt:

- Resolve settings in layers, **Series override → library/global default**, and let the reader's
  quick switch write the Series override (Mihon, Kavita). A Series is the unit people read in.
- Make the first-open choice from evidence (metadata, Page shapes) and **announce the automatic
  choice** with a dismissible toast (Komga, Kavita). An automatic choice must not overwrite the
  user's saved preference.
- Keep a one-key or one-tap switcher between Paged, Spread and Vertical scroll inside the reader
  (Komga's keys, Mihon's quick toggle).

Avoid:

- Fusing Reading mode and Reading direction into one enum (Mihon, Komga). It cannot express
  "Vertical scroll, but this is a manga", and it forces combinatorial variants such as Kavita's
  `Double`, `DoubleReversed` ("used for Manga only") and `DoubleNoCover`
  ([kavita:layout-mode.ts](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/UI/Web/src/app/manga-reader/_models/layout-mode.ts)).
- Saving settings per Book (jellyfin-web). Every new volume starts over.

## 2. Spread handling (cover offset, wide Pages)

What they do:

- **Komga** `buildSpreads`: in `DOUBLE_PAGES` mode the first Page is shown alone (padded with a
  transparent placeholder), and so is the last. A landscape Page (`width > height`) always stands
  alone. If a portrait Page is followed by a landscape one, the portrait Page is padded with a
  blank half so the pairing parity resets. `DOUBLE_NO_COVER` skips the cover rule
  ([komga:functions/book-spreads.ts](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/functions/book-spreads.ts),
  [komga:types/enum-reader.ts](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/types/enum-reader.ts)).
  Page dimensions come from the server's page list, so spreads are known before any image loads.
- **Kavita** computes the pairs on the server (`GetPairs`): Page 0 is alone, wide Pages
  (`Width > Height`) are alone, and the Page after a wide Page or the cover starts a new pair
  ([kavita:ReaderService.cs L723-764](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/Kavita.Services/Reading/ReaderService.cs#L723-L764)).
  The client adds a **`pageOffset` toggle** that ignores the computed pairs and pairs on a fixed
  parity instead, which fixes scans whose spreads are off by one
  ([kavita:manga-reader.service.ts L40-85](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/UI/Web/src/app/manga-reader/_service/manga-reader.service.ts#L40-L85)).
  In single-Page mode, wide Pages can be split into two virtual Pages (`SplitLeftToRight`,
  `SplitRightToLeft`), scaled to fit (`FitSplit`), or left alone (`NoSplit`)
  ([kavita:page-split-option.ts](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/UI/Web/src/app/_models/preferences/page-split-option.ts)).
- **YACReader** pairs two Pages only if both are portrait, and the setting "Show covers as single
  page" (`COVER_IS_SP`, default on) keeps the cover alone. `offsetDoublePage(±1)` "moves the double
  page grouping by one page" (shift-by-one). An optional "book fold shadow" draws the gutter
  ([yac:render.cpp L600-665, L875-890](https://github.com/YACReader/yacreader/blob/fef64948ce/YACReader/render.cpp#L600-L890),
  [yac:options_dialog.cpp L251-259](https://github.com/YACReader/yacreader/blob/fef64948ce/YACReader/options_dialog.cpp#L251-L259)).
- **Mihon** (newer WebGPU viewer) has `Dual page view: Never / Always / When wide`, where "When wide"
  means the viewport is landscape. Its pairing rules:
  - Page 0 is the cover and pairs with nothing.
  - A Page with aspect ratio over 1.2 stands alone, and pairing restarts after it.
  - Two Pages pair only if their aspect ratios differ by at most 0.1.
  - The spread opens on the right half for right-to-left Books and the left half otherwise.
  - Pages that haven't loaded yet pair optimistically, and the pairing is re-decided once the image
    decodes.
  - A TIFF `PageName` tag of `Left`/`Right` overrides the guess.

  ([mihon:…/webgpu/WebGpuViewer.kt L560-716, L1357-1363](https://github.com/mihonapp/mihon/blob/7eec566d9c/app/src/main/java/eu/kanade/tachiyomi/ui/reader/viewer/webgpu/WebGpuViewer.kt#L560-L716)).
  The older pager instead offers "Split wide pages", "Invert split page placement" and "Rotate
  wide pages to fit", each set separately for paged and long-strip modes
  ([mihon:…/setting/ReaderPreferences.kt L120-150](https://github.com/mihonapp/mihon/blob/7eec566d9c/app/src/main/java/eu/kanade/tachiyomi/ui/reader/setting/ReaderPreferences.kt#L120-L150)).

- **Panels** and **Chunky** turn two-page view on in landscape and off in portrait (Panels
  "Automatic … usually two in landscape"; Chunky "A two-page mode that switches on/off based on
  landscape or portrait").
- **ComicInfo** can give the answer up front: `Pages/Page@DoublePage` ("Whether the page is a double
  spread"), `@Type=FrontCover`, `@ImageWidth`/`@ImageHeight` ([Anansi docs](https://anansi-project.github.io/docs/comicinfo/documentation)).
- **jellyfin-web** sets Swiper's `slidesPerView` and `slidesPerGroup` to 2. This pairs Pages 0+1,
  2+3 and so on, with no cover rule, no wide-Page rule and no shift control
  ([jfweb:plugin.js L285-316](https://github.com/jellyfin/jellyfin-web/blob/ff0d12bffa/src/plugins/comicsPlayer/plugin.js#L285-L316)).

Adopt:

- Spread rules: **cover alone, wide Page alone, restart pairing after any lone Page, pad a
  trailing odd Page.** Use ComicInfo `DoublePage`/`FrontCover` when present, otherwise measured
  dimensions.
- A visible **"shift Spread by one Page"** control, scoped to the Book (Kavita, YACReader). The
  rules will sometimes be wrong for a given scan.
- **Automatic Spread on wide viewports** as the default for Spread mode (Mihon, Panels, Chunky).
- Jellyfin has no per-Page metadata endpoint (see `docs/research/jellyfin-books.md` on branch
  `research/jellyfin-books`), so Komafin has to measure Pages as it decodes them. Follow Mihon:
  pair optimistically, then re-decide once a Page decodes, without jumping the Page being read.
  Komga and Kavita can avoid this only because their servers hand out dimensions in advance.
- In single-Page modes, offer splitting wide Pages, with the half order following Reading direction.

Avoid:

- Fixed-parity pairing with no cover or wide-Page logic (jellyfin-web).
- Settings that multiply by mode: Mihon keeps separate split and rotate preferences for paged and
  long-strip, plus an invert for each.

## 3. Tap zones and gestures

What they do:

- **Mihon** offers named tap-zone layouts on a normalised rect grid: `Default`, `L shaped`,
  `Kindle-ish`, `Edge`, `Right and Left` and `Disabled`, plus `Invert tap zones: None / Horizontal /
Vertical / Both`. Regions are typed `NEXT/PREV/LEFT/RIGHT/MENU`. `LEFT/RIGHT` resolve to forward
  or back according to Reading direction, while `NEXT/PREV` mean forward and back whatever the
  direction. A tap outside every region opens the menu
  ([mihon:…/viewer/ViewerNavigation.kt](https://github.com/mihonapp/mihon/blob/7eec566d9c/app/src/main/java/eu/kanade/tachiyomi/ui/reader/viewer/ViewerNavigation.kt),
  [mihon:…/viewer/navigation/](https://github.com/mihonapp/mihon/tree/7eec566d9c/app/src/main/java/eu/kanade/tachiyomi/ui/reader/viewer/navigation)).
  The tap-zone overlay is shown to new users and optionally on every start
  (`showNavigationOverlayNewUser`, `showNavigationOverlayOnStart` in ReaderPreferences.kt).
- **Komga**: the left and right 25% turn Pages, and the middle 50% toggles the menu. In vertical
  mode the zones are the top and bottom 25%. Swipes run through the same `turnLeft()` and
  `turnRight()` functions, which map to next or previous by direction. Arrow keys come in an LTR
  set and an RTL set ([komga:components/readers/PagedReader.vue](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/components/readers/PagedReader.vue),
  [komga:functions/shortcuts/paged-reader.ts](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/functions/shortcuts/paged-reader.ts)).
- **Kavita** has left and right click zones with an optional overlay hint (`showScreenHints`),
  "swipe to paginate" as an opt-in, and double-click to bookmark a Page
  ([kavita:manga-reader.component.html](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/UI/Web/src/app/manga-reader/_components/manga-reader/manga-reader.component.html)).
- **YACReader** (desktop) offers three mouse modes: only Back/Forward buttons turn Pages,
  Left/Right buttons turn Pages, or clicking the left or right half turns Pages. Scroll options
  include "Do not turn page using scroll" and "Use single scroll step to turn page"
  ([yac:options_dialog.cpp L108-130](https://github.com/YACReader/yacreader/blob/fef64948ce/YACReader/options_dialog.cpp#L108-L130)).
- **Chunky** lets users "disable either tap or swipe page-turns entirely" and adds a two-finger
  swipe for brightness ([App Store version history](https://apps.apple.com/us/app/chunky-comic-reader/id663567628)).

Adopt:

- Store tap zones as **normalised rects with semantic actions** (Mihon's model). Spatial regions
  resolve by Reading direction; the centre or a fallback region is the menu.
- A few named presets plus invert, rather than a free-form editor.
- **Teach the zones on first open** with a coloured overlay that can be shown again on demand.
- Keyboard: arrows flip with Reading direction, Home/End go to the first and last Page, plus
  single-key mode switches and a help overlay (Komga). On desktop, decide explicitly whether the
  wheel turns Pages, and make it configurable (YACReader).
- Let users turn off tap paging or swipe paging on their own (Chunky, Kavita).

Avoid:

- Double-tap or double-click for anything except zoom (Kavita's bookmark). It also forces a delay
  on every single tap while the reader waits to rule out a double tap.
- Unequal zone sizes that put the menu in the way: Komga's middle 50% is a big dead zone for
  one-handed phone use.

## 4. Zoom

What they do:

- **Mihon** scale types are `Fit screen`, `Stretch`, `Fit width`, `Fit height`, `Original size` and
  `Smart fit`. It also has `Zoom start position` (`Automatic/Left/Right/Center`, where "Automatic"
  resolves to left for LTR, right for RTL, centre for vertical:
  [mihon:…/pager/PagerViewer.kt L76-81](https://github.com/mihonapp/mihon/blob/7eec566d9c/app/src/main/java/eu/kanade/tachiyomi/ui/reader/viewer/pager/PagerViewer.kt#L76-L81)), double-tap zoom with a configurable animation speed, and "Automatically
  zoom into wide images" (`landscapeZoom`). Long strip has its own double-tap zoom toggle, side
  padding and "Disable zoom out" ([reader-settings](https://mihon.app/docs/guides/reader-settings),
  ReaderPreferences.kt).
- **Komga** scale types are `screen`, `width`, `width (shrink only)`, `height` and `original`,
  cycled with `c`. Continuous mode uses its own pair, `width` and `original`, plus side padding
  percentages ([komga:types/enum-reader.ts](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/types/enum-reader.ts)).
- **Kavita** scaling includes `Automatic`, which is fit-width in portrait windows and fit-height
  in landscape ([kavita:manga-reader.service.ts L139-167](https://github.com/Kareadita/Kavita/blob/6ae5d302d2/UI/Web/src/app/manga-reader/_service/manga-reader.service.ts#L139-L167)).
- **YACReader** has a magnifying-glass loupe (circular option, edge easing), a fit-width slider,
  "Enlarge images to fit width/height" and a choice of scaling algorithm
  ([yac:options_dialog.cpp](https://github.com/YACReader/yacreader/blob/fef64948ce/YACReader/options_dialog.cpp)).
- **Panels** has "one-finger zoom" and **Panels View**, a panel-by-panel mode that uses ML panel
  detection. It is a Premium feature in Labs and documented as experimental
  ([guides.panels.app/read-content/panels-view](https://guides.panels.app/read-content/panels-view)).
- **jellyfin-web** uses Swiper's zoom with `toggle: true` (double-tap) and `minRatio: 1`
  ([jfweb:plugin.js L289-293](https://github.com/jellyfin/jellyfin-web/blob/ff0d12bffa/src/plugins/comicsPlayer/plugin.js#L289-L293)).

Adopt:

- Pinch and double-tap zoom on touch, wheel or trackpad zoom on desktop. A double tap zooms to
  the tapped point, and **the zoom start position follows Reading direction** (Mihon).
- A small set of fit modes (fit screen, fit width, fit height, original), with an **Automatic**
  mode based on viewport orientation (Kavita).
- While zoomed, a swipe pans and does not turn the Page. Turning the Page only after the pan
  reaches the edge is the common resolution (Kavita's "scrolled to far right … then on next swipe,
  will move pages" logic).
- Desktop: consider a loupe (YACReader), since pinch isn't available.

Avoid:

- Letting zoom out go below fit (`minRatio: 1` is right). Mihon's "Disable zoom out" for long
  strip exists because zooming out there just shrinks the strip.
- Panel-by-panel navigation is not a v1 feature anywhere except as a paid, experimental ML mode.
  Treat it as out of scope for v1.

## 5. Reading direction detection

What they do:

- **ComicInfo** is the standard signal: `Manga` = `YesAndRightToLeft` "defines the reading
  direction as right-to-left" ([Anansi docs](https://anansi-project.github.io/docs/comicinfo/documentation)).
- **Jellyfin** reads `ComicInfo/Manga` and drops it: "this value is used internally only, as
  Jellyfin has no field to save it to" ([bookshelf:…/ComicInfoXmlUtilities.cs L25-35](https://github.com/jellyfin/jellyfin-plugin-bookshelf/blob/a94213af22/Jellyfin.Plugin.Bookshelf/Providers/ComicInfo/ComicInfoXmlUtilities.cs#L25-L35)).
- **Komga** stores a Series-level `readingDirection` (from metadata or an admin edit, with a lock
  flag) and applies it non-persistently in the reader with a notification
  ([komga:views/DivinaReader.vue L720-727](https://github.com/gotson/komga/blob/609e98a145/komga-webui/src/views/DivinaReader.vue#L720-L727)).
- **Kavita** takes direction from the Reading Profile that applies (Series → library → default).
  Its Page-shape heuristic detects webtoons, but not right-to-left manga.
- **Mihon** does not detect direction. It uses the global default (RTL), and the user fixes it
  per Series.
- **jellyfin-web** does not detect direction. It defaults to `ltr` and the user toggles it per Book.

Adopt:

- Evidence order: **Series override (user) → ComicInfo `Manga=YesAndRightToLeft` from any Book in
  the Series → library or global default.** Read `ComicInfo.xml` from the archive client-side,
  since Jellyfin won't expose it.
- Show where the direction came from ("Right-to-left · from metadata") and make it one tap to
  override for the Series (Komga's notification).
- Tap zones, swipe sense, arrow keys, Spread half order, split order and zoom start position all
  follow the one resolved Reading direction.

Avoid:

- Guessing direction from Page shapes or language. No surveyed reader does this. Kavita's webtoon
  heuristic (aspect-ratio thresholds such as ≥ 2.2) detects Vertical scroll content, not RTL.

## 6. Offline download UX

What they do:

- **Mihon** download preferences:
  - Wi-Fi only (`downloadOnlyOverWifi`).
  - Save as CBZ (default on).
  - "Auto download while reading" ("Download ahead", N chapters; "Only works if the current
    chapter + the next one are already downloaded").
  - "After reading automatically delete" (`removeAfterReadSlots`, -1 = off) and
    "After manually marked as read".
  - Keep bookmarked chapters (`removeBookmarkedChapters`).
  - "Download new chapters" per category, with "Skip downloading duplicate read chapters".
  - Parallel limits of 5 sources and 5 pages.

  ([mihon:domain/…/DownloadPreferences.kt](https://github.com/mihonapp/mihon/blob/7eec566d9c/domain/src/main/java/tachiyomi/domain/download/service/DownloadPreferences.kt),
  [mihon:i18n strings.xml L562-583](https://github.com/mihonapp/mihon/blob/7eec566d9c/i18n/src/commonMain/moko-resources/base/strings.xml#L562-L583)).

- **Panels**: "Read on demand from your server or download full series for offline". With Komga
  or Kavita over OPDS you "can read comics without downloading the full file", and progress syncs
  across the user's Apple devices ([panels.app](https://panels.app)).
- **Chunky**: downloads "in the background while you read" from PC, Mac or NAS.
- **Komga and Kavita web readers** have no offline mode; they are server UIs.
- **jellyfin-web** has no offline mode, yet always fetches the whole archive into memory
  (`fetch(url) → blob → libarchive extractFiles()`) before rendering, then throws it away on close
  ([jfweb:plugin.js L351-396](https://github.com/jellyfin/jellyfin-web/blob/ff0d12bffa/src/plugins/comicsPlayer/plugin.js#L351-L396)).

Adopt:

- Units: **download a Book, download a Series, and "download next N unread" while reading**
  (Mihon, Panels).
- Policies: **Wi-Fi only**, **delete after read** (keep the last N), and auto-download new Books
  for followed Series.
- Since a Jellyfin read already fetches the whole archive, **cache what was read** and offer
  "keep offline" as an upgrade from that cache, not as a second download.
- Queue progress and storage use in one place. Downloaded state is visible on Book and Series
  covers.

Avoid:

- Blocking the first Page on the full-archive download (jellyfin-web). Jellyfin serves the file
  with HTTP Range (see the jellyfin-books note), so a CBZ (zip) reader can fetch the central
  directory and then individual Pages on demand. Panels' "without downloading the full file" shows
  that users notice the difference. CBR and CB7 can't be read this way and will need a full fetch.
- Sorting Pages by raw string comparison (`a.file.name < b.file.name` in jfweb:plugin.js
  L377-383), which puts `10.jpg` before `2.jpg`. Use natural sort.

## Open questions for later tickets

- Which ComicInfo fields does Komafin read (`Manga`, `Pages/Page@DoublePage`, `@Type`)? Is the
  answer cached per Series locally, given that Jellyfin can't store it?
- Spread mode is a Reading mode in v1, but the prior art treats two-page as automatic by
  orientation. Should "Spread" be a mode the user picks or an automatic behaviour of Paged on wide
  viewports? Most readers do the latter.
- Where does the Series override live: on the device or synced? Jellyfin has no per-user,
  per-Series custom field, and Kavita binds profiles per device on purpose.
