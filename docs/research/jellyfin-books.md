# How Jellyfin models and serves Books

Research for issue #3. Checked against **Jellyfin server v12.4** (tag `v12.4`, commit
`83d0d0e`, released 2026-10-26) and **jellyfin-web v12.4** (commit `0a580ce`), the current
stable releases, plus the published stable OpenAPI spec (`info.version` 12.4.0).

Source links below are permalinks to those commits:

- Server: `https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/<path>` (shortened to `server:<path>`)
- Web: `https://github.com/jellyfin/jellyfin-web/blob/0a580ce8df89282dfd120b6d5efb8e106da23bd5/<path>` (shortened to `web:<path>`)
- OpenAPI: <https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json>

## Summary

- A Book is a `Book` item (`BaseItemKind.Book`, `MediaType: "Book"`) in a library whose
  collection type is `books`. CBZ, CBR, CB7, CBT and PDF all resolve to `Book`.
- **There is no Series item for books.** A Book carries only a `SeriesName` string. Its
  `SeriesId` is never set. The browsable grouping is the plain folder tree (`Folder` items).
- Exposed metadata: `Name`, `SeriesName`, `IndexNumber` (issue/chapter), `ParentIndexNumber`
  (volume, filename only), `ProductionYear`, `PremiereDate`, `Overview`, genres, studio
  (publisher), people, language. **Page count** is encoded as `RunTimeTicks = pages × 10000`.
- **No Reading-direction or manga field exists.** The server reads `ComicInfo/Manga` and
  discards it ("Jellyfin has no manga flag").
- Bytes: `GET /Items/{id}/Download` (needs the download permission) or `GET /Items/{id}/File`.
  Both serve the original file with **HTTP Range enabled**. Cover: `GET /Items/{id}/Images/Primary`,
  extracted by the server from the archive.
- **There is no per-Page endpoint.** jellyfin-web downloads the whole archive, unpacks it in
  the browser with libarchive.js, and reports progress as the page index in ticks.

## 1. Library type and item types

- The `BookResolver` only acts in libraries with `CollectionType.books`. Its extension list
  is `.azw .azw3 .cb7 .cbr .cbt .cbz .epub .mobi .pdf`; each matching file becomes a `Book`
  ([server:Emby.Server.Implementations/Library/Resolvers/Books/BookResolver.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/Emby.Server.Implementations/Library/Resolvers/Books/BookResolver.cs)).
- A directory resolves as a single `Book` only when it holds **exactly one** supported file.
  Otherwise the directory is an ordinary folder and each file inside becomes its own `Book`
  (same file, `GetBook`).
- `Book.MediaType` is `MediaType.Book`. It supports played status and position-ticks resume,
  and `CanDownload()` is true for file-backed items
  ([server:MediaBrowser.Controller/Entities/Book.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Controller/Entities/Book.cs)).
- A books library view queries `IncludeItemTypes = [Book, AudioBook]` recursively
  ([server:MediaBrowser.Controller/Entities/UserViewBuilder.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Controller/Entities/UserViewBuilder.cs) `GetBooks`;
  [server:Jellyfin.Api/Extensions/DtoExtensions.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/Jellyfin.Api/Extensions/DtoExtensions.cs)).
  So a client that wants comics only should filter on extension/`Path` or container, because
  audiobooks share the library type.

## 2. Series grouping

- `Book` implements `IHasSeries` with `SeriesName`, `SeriesId` and
  `SeriesPresentationUniqueKey`, but nothing in the server assigns a Book's `SeriesId`.
  The only `SeriesId =` assignments are in the TV providers. The DTO mapper for books copies
  only `SeriesName` (`SetBookProperties` in
  [server:Emby.Server.Implementations/Dto/DtoService.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/Emby.Server.Implementations/Dto/DtoService.cs)).
  **Consequence: no Series entity, no Series cover or metadata, no "list Books of Series" query
  by id.** A client must group Books itself, by `SeriesName` or by parent folder.
- Where `SeriesName` comes from, in order:
  1. **Filename** ([server:Emby.Naming/Book/BookFileNameParser.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/Emby.Naming/Book/BookFileNameParser.cs)).
     Recognised patterns: `Series (1999) #12 (of 50) (2001)`, `Name (Series, #12)`,
     `12 - Name`, `Name (2001)`. A name like `Foo v03 c012` also yields
     `ParentIndexNumber = 3` (volume) and `IndexNumber = 12` (chapter).
  2. **Fallback for loose files:** the parent directory name
     (`SeriesName = result.SeriesName ?? Path.GetFileName(Path.GetDirectoryName(path))` in `BookResolver`).
  3. **Embedded metadata overrides it** after the metadata refresh: `ComicInfo/Series` or
     ComicBookInfo `series` (see section 3). `BookMetadataService.MergeData` fills
     `SeriesName` from providers
     ([server:MediaBrowser.Providers/Books/BookMetadataService.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/Books/BookMetadataService.cs)).
- Folders inside the library are plain `Folder` items and can be browsed with
  `GET /Items?ParentId=…`. That is the closest thing to a navigable Series.

## 3. Metadata

Comic metadata providers are now part of the core server under `MediaBrowser.Providers/Books/`
(earlier releases needed the Bookshelf plugin). `ComicProvider` asks each `IComicProvider` in
turn and keeps the first one that returns metadata
([server:MediaBrowser.Providers/Books/ComicProvider.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/Books/ComicProvider.cs)):

- **ComicInfo.xml inside the archive**, read for **`.cbz` only** because it is opened with
  `ZipFile`
  ([server:…/Books/ComicInfo/InternalComicInfoProvider.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/Books/ComicInfo/InternalComicInfoProvider.cs)).
- **Sidecar `<filename>.xml`** in ComicInfo format next to the file, for any extension
  ([server:…/Books/ComicInfo/ExternalComicInfoProvider.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/Books/ComicInfo/ExternalComicInfoProvider.cs)).
- **ComicBookInfo JSON in the zip comment**, `.cbz` only
  ([server:…/Books/ComicBookInfo/ComicBookInfoProvider.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/Books/ComicBookInfo/ComicBookInfoProvider.cs)).

CBR and CB7 files therefore get no embedded metadata, only filename parsing or a sidecar XML.

ComicInfo field mapping
([server:…/Books/ComicInfo/ComicInfoReader.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/Books/ComicInfo/ComicInfoReader.cs)):

| ComicInfo                                                              | BaseItemDto field                 |
| ---------------------------------------------------------------------- | --------------------------------- |
| `Title`                                                                | `Name`                            |
| `Series`                                                               | `SeriesName`                      |
| `Number` (integer only)                                                | `IndexNumber`                     |
| `Summary`                                                              | `Overview`                        |
| `Year` / `Month` / `Day`                                               | `ProductionYear`, `PremiereDate`  |
| `Genre` (comma-separated)                                              | `Genres`                          |
| `Publisher`                                                            | `Studios`                         |
| `AlternateSeries` (only when `Manga=Yes`)                              | `OriginalTitle`                   |
| `Writer`, `Penciller`, `Inker`, `Letterer`, `CoverArtist`, `Colourist` | `People` with those `PersonKind`s |
| `LanguageISO`                                                          | metadata language                 |

Not mapped: `Volume`, `Count`, `PageCount`, `Pages` (including the `DoublePage` page type),
`Format`, `AgeRating`, `StoryArc`, and the `Manga` value itself.

**Reading direction:** the reader keeps `Manga` in a local variable only, with the comment
`// this value is only used internally since Jellyfin has no manga flag`. Nothing on the item
or in the API says right-to-left. Komafin has to find the Reading direction on its own:
read `ComicInfo.xml` from the archive, use a per-Book or per-Series user setting, or both.

**Page count:** `ProbeProvider.FetchAsync(Book)` sets
`RunTimeTicks = pageCount * 10000`. The code comment says this is a stopgap: "book players
report page count and the web client multiplies that value by 10000"
([server:MediaBrowser.Providers/MediaInfo/ProbeProvider.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/MediaInfo/ProbeProvider.cs)).

- For `.cb7/.cbr/.cbt/.cbz`, `pageCount` is the number of **non-directory archive entries**.
  That count includes `ComicInfo.xml` and any other non-image files, so it can be higher than
  the real number of Pages.
- For `.pdf` it is the PDF page count (via PDFtoImage).
- For `.epub` it is a fixed one-second value that stands for a percentage.

## 4. Bytes, Range and covers

| Purpose       | Endpoint                                           | Notes                                                                                                                                                                                             |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original file | `GET /Items/{itemId}/Download`                     | Policy `Download`: the user needs `EnableContentDownloading`, and the item must have `CanDownload()` (true for file-backed Books). Logs a download activity. Adds `Content-Disposition` filename. |
| Original file | `GET /Items/{itemId}/File`                         | Any authenticated user, no download-permission check, no activity log.                                                                                                                            |
| Cover         | `GET /Items/{itemId}/Images/Primary` (also `HEAD`) | Supports `maxWidth`, `maxHeight`, `fillWidth`, `fillHeight`, `quality`, `format`, `tag` (send `ImageTags.Primary` to get strong caching).                                                         |

- Both file endpoints end in `PhysicalFile(path, mimeType, [filename,] enableRangeProcessing: true)`,
  so ASP.NET Core serves `Accept-Ranges: bytes` and handles `Range` / `206 Partial Content`
  ([server:Jellyfin.Api/Controllers/LibraryController.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/Jellyfin.Api/Controllers/LibraryController.cs)
  `GetFile`, `GetDownload`). Both are in the 12.4.0 OpenAPI spec.
- MIME types: `.cbz` → `application/vnd.comicbook+zip`, `.cbr` → `application/vnd.comicbook-rar`,
  `.cb7` → `application/x-cb7`, `.cbt` → `application/x-cbt`
  ([server:MediaBrowser.Model/Net/MimeTypes.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Model/Net/MimeTypes.cs)).
- Cover extraction: `ComicImageProvider` opens `.cb7/.cbr/.cbt/.cbz` with SharpCompress and
  uses the entry named exactly `cover.{png,jpeg,jpg,webp,bmp,gif}`. Otherwise it uses the
  first image by sorted entry name
  ([server:MediaBrowser.Providers/Books/ComicImageProvider.cs](https://github.com/jellyfin/jellyfin/blob/83d0d0e7f76e23e2e085c8ff67d28b772d35967d/MediaBrowser.Providers/Books/ComicImageProvider.cs)).
  PDFs get no cover from this provider.

## 5. Per-Page access

**None.** No controller in `Jellyfin.Api` opens archives (no `ArchiveFactory` or page route),
and the 12.4.0 OpenAPI spec has no path containing "page" apart from the two dashboard
`/web/ConfigurationPage(s)` routes. A client either downloads the whole archive, or uses
**HTTP Range** on `/Items/{id}/File` (or `/Download`) to read a ZIP's central directory and then
fetch single entries. That works for CBZ (uncompressed or deflate entries). RAR and 7z archives
are not usefully random-access (solid compression), so CBR and CB7 effectively need the whole
file. This is an inference from the formats, not something Jellyfin documents.

## 6. How jellyfin-web's comic reader does it

`ComicsPlayer`
([web:src/plugins/comicsPlayer/plugin.js](https://github.com/jellyfin/jellyfin-web/blob/0a580ce8df89282dfd120b6d5efb8e106da23bd5/src/plugins/comicsPlayer/plugin.js)):

- Handles `MediaType` `book` whose `Path` ends in `.cbr/.cbt/.cbz/.cb7`. PDFs go to a separate
  `pdfPlayer` that uses pdf.js on the same download URL
  ([web:src/plugins/pdfPlayer/plugin.js](https://github.com/jellyfin/jellyfin-web/blob/0a580ce8df89282dfd120b6d5efb8e106da23bd5/src/plugins/pdfPlayer/plugin.js)).
- Fetches `getLibraryApi(api).getDownloadUrl({ itemId })` (that is, `/Items/{id}/Download`)
  **in full** as a Blob. It opens the Blob with **libarchive.js 2.0.2** (WASM, in a worker) and
  extracts every file.
- Pages = the archive entries with an image extension, **sorted by file name** with plain string
  comparison (not natural sort). Each one becomes an object URL. A Swiper carousel shows them,
  with virtual slides (±1 preloaded), zoom, and 1 or 2 pages per view.
- Reading direction and pages per view are **per-item local settings**
  (`comicsPlayerSettings[itemId] = { langDir: 'ltr'|'rtl', pagesPerView: 1|2 }`). They are saved
  with `enableOnServer = false`, so they never reach the server
  ([web:src/scripts/settings/userSettings.js](https://github.com/jellyfin/jellyfin-web/blob/0a580ce8df89282dfd120b6d5efb8e106da23bd5/src/scripts/settings/userSettings.js)).
  Nothing is pre-filled from ComicInfo.
- Progress: `currentTime()` returns the 0-based page index. `playbackManager` turns it into
  `PositionTicks = page * 10000` and reports it through the normal playback start, progress
  and stop session calls. On open, it resumes at `startPositionTicks / 10000`
  ([web:src/components/playback/playbackmanager.js](https://github.com/jellyfin/jellyfin-web/blob/0a580ce8df89282dfd120b6d5efb8e106da23bd5/src/components/playback/playbackmanager.js)
  `getCurrentTicks`). With the server's `RunTimeTicks = entries × 10000`, the played percentage
  is approximately page ÷ entries.

## Implications for Komafin (for the downstream decisions)

- Series is a client-side concept: group by `SeriesName`, with parent `Folder` as a fallback.
  There is no Series id, cover or summary to fetch.
- Reading direction has to come from Komafin, either by parsing `ComicInfo.xml` (`Manga=YesAndRightToLeft`)
  from the archive or from a user setting.
- To stay compatible with jellyfin-web, store Reading progress as `PositionTicks = pageIndex × 10000`.
  Do not trust `RunTimeTicks / 10000` as an exact Page count.
- Page extraction happens on the client. `/Items/{id}/File` with Range makes lazy CBZ reads
  possible. CBR and CB7 need a full download.
- Use `/Items/{id}/File` rather than `/Download` if users without the download permission should
  still be able to read. This is a policy choice, so check it against the server admin's intent.
