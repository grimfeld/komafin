# Archives, PDFs, networking and storage in a Tauri 2 app on every platform

Research for issue #5. Targets: macOS, Windows, Linux, iOS, Android (phones included).
This note lists options and trade-offs. It does not decide.

Checked on 2026-11-09 against:

- Tauri `dev` branch at [`f0d8197`](https://github.com/tauri-apps/tauri/tree/f0d81979d6a18bd75b4d5d4dbf1f3d7ab719c07e) (crate version 2.12.5), shortened to `tauri:<path>`
- tauri-apps/plugins-workspace `v2` at [`b4a6ed0`](https://github.com/tauri-apps/plugins-workspace/tree/b4a6ed08d1578d7651dd69635f2ebd093051d4ee), shortened to `plugins:<path>`
- pdf.js `master` at [`6619bf0`](https://github.com/mozilla/pdf.js/tree/6619bf0c6fa6f7797e6b109cb6d431b0ab1ed00d) (latest release v6.5.438)
- unrar.rs at [`0628d12`](https://github.com/muja/unrar.rs/tree/0628d12b4f2f79d80e6c6c0707ce611e8952b052), libarchive at [`eb57ffe`](https://github.com/libarchive/libarchive/tree/eb57ffefe20e98eb7ba05829ee1c23b90e589a71), libarchivejs at [`0989c1a`](https://github.com/nika-begiashvili/libarchivejs/tree/0989c1a6db20d030d793b1763e20d880068091bd), Jellyfin server at [`797999f`](https://github.com/jellyfin/jellyfin/tree/797999fc9bd49a9f0853916e2933e3ad06173503)
- Crate versions and licenses from the crates.io API on the same day.

Related: `docs/research/jellyfin-books.md` (issue #3, branch `research/jellyfin-books`) found
that Jellyfin has no per-Page endpoint, serves the whole Book via `/Items/{id}/Download` or
`/Items/{id}/File` **with HTTP Range enabled**, and that jellyfin-web unpacks Books in the
browser with libarchive.js.

## Summary

- **ZIP (CBZ)** is easy everywhere. Rust: `zip` 9.5.0 (MIT), random access by index over any
  `Read + Seek`. JS: zip.js (BSD-3-Clause) can read entries over HTTP Range, fflate (MIT).
- **RAR (CBR) incl. RAR5** has exactly two mature decoders: RARLAB's **UnRAR** source (freeware
  licence, not OSI; wrapped by the `unrar` crate) and **libarchive** (BSD-2, RAR5 reader since
  2018, documented as "with some limitations"). Both are C/C++; neither is pure Rust. In the
  webview, **libarchive.js** (MIT, libarchive 3.7.2 in WASM) is what jellyfin-web uses.
- **7z (CB7)**: `sevenz-rust2` 0.25.0 (Apache-2.0, pure Rust, WASM-capable) or libarchive.
  Solid 7z archives force decoding everything before the wanted Page.
- **UnRAR licence** allows free use and redistribution in any software, closed or open, but
  forbids using the code to build a RAR-compatible _archiver_ or re-create the RAR compression
  algorithm, and requires keeping its licence paragraph. It is not GPL-compatible in the FSF's
  sense (not checked here; flagged as a question for licensing).
- **PDF**: pdf.js (Apache-2.0) runs in every webview but targets Safari ≥ 18 in its modern
  build and caps canvases at 5 MP on mobile. Native: PDFium via `pdfium-render` (MIT/Apache;
  PDFium binaries exist for all five OSes), MuPDF (`mupdf` crate, **AGPL-3.0**), pure-Rust
  `hayro` (Apache/MIT, young), or each OS's own renderer (PDFKit, Android `PdfRenderer`).
- **Memory**: anything that loads the whole Book into one buffer (libarchive.js does; UnRAR's
  API needs a file path) scales with Book size. Random-access readers (`zip`, zip.js over
  Range, PDFium/`PdfRenderer` on a seekable file) only hold the Pages being shown.
- **Networking**: Jellyfin's default CORS policy is `AllowAnyOrigin`, so webview `fetch` works
  from Tauri's origins (`tauri://localhost` on macOS/iOS/Linux, `http://tauri.localhost` on
  Windows/Android) unless a reverse proxy or a custom `CorsHosts` list interferes. Plain-HTTP
  LAN servers need ATS / Android cleartext opt-ins either way. **Self-signed certificates** can
  only be accepted through the HTTP plugin (`dangerous-settings` feature) or by trusting the CA
  at OS level; Tauri exposes no certificate-override hook for the webview.
- **Offline storage**: Tauri's `app_data_dir` / `app_local_data_dir` / `app_cache_dir` map to
  per-OS app folders. iOS backs up `Application Support` unless files are marked
  `NSURLIsExcludedFromBackupKey`; iOS `Caches` and Android `cacheDir` can be purged by the OS.
- **Token storage**: Tauri has no official keychain plugin. Stronghold (official) is "no longer
  recommended and will be deprecated and therefore removed in v3" per a Tauri maintainer.
  The `keyring` 4.x family (`keyring-core` + per-OS stores, incl. Android and iOS) is the
  OS-keystore route; community Tauri wrappers exist.

## 1. Where the work can run

Every format question has the same two homes:

|                          | Rust (Tauri command or custom protocol)                        | Webview (JS / WASM)                                                                   |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Engines                  | Native code, any C/C++ library the toolchain can cross-compile | WKWebView (macOS, iOS), WebView2 (Windows), WebKitGTK (Linux), Android System WebView |
| Memory ceiling           | Process memory, can stream from disk                           | JS heap + wasm32 linear memory (≤ 4 GiB address space); engine-specific limits        |
| File access              | Direct, by path                                                | Only through Tauri plugins or IPC                                                     |
| Mobile build cost        | Must cross-compile C/C++ for iOS/Android ABIs                  | None beyond the bundle                                                                |
| Getting Pages to `<img>` | Custom URI scheme or IPC bytes                                 | Blob/object URLs                                                                      |

Moving Page bytes from Rust to the webview: Tauri lets the app register a custom protocol
(`register_asynchronous_uri_scheme_protocol`) that answers `http::Request`s with arbitrary
bytes, so an `<img src>` can point straight at a Page served by Rust
([tauri:crates/tauri/src/app.rs#L2324-L2333](https://github.com/tauri-apps/tauri/blob/f0d81979d6a18bd75b4d5d4dbf1f3d7ab719c07e/crates/tauri/src/app.rs#L2324-L2333)).
Its origin differs per platform, same as the app's own (see §5).

## 2. Archives

### 2.1 ZIP (CBZ)

| Option                                                     | Where  | Licence      | Notes                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`zip`](https://docs.rs/zip/9.5.0/zip/) 9.5.0              | Rust   | MIT          | `ZipArchive<R: Read + Seek>`; `new` "uses the central directory record … and ignores local file headers", then `by_index`/`by_name` per entry. Default features pull `zstd`, `bzip2`, `xz`, `aes-crypto`; docs say to disable the non-Rust ones for WASM. Comics are normally Stored or Deflate, so a minimal feature set suffices. |
| [zip.js](https://github.com/gildas-lormeau/zip.js) v2.24.0 | JS     | BSD-3-Clause | Has an HTTP Range reader, which matches Jellyfin's Range-enabled download endpoints: a CBZ can be listed and single Pages read without downloading the Book.                                                                                                                                                                        |
| [fflate](https://github.com/101arrowz/fflate)              | JS     | MIT          | Small, fast; works on in-memory buffers.                                                                                                                                                                                                                                                                                            |
| libarchive / libarchive.js                                 | either | BSD-2 / MIT  | Also reads ZIP (see 2.2).                                                                                                                                                                                                                                                                                                           |

### 2.2 RAR (CBR), including RAR5

| Option                                                                                                  | Where                                                                                                            | Licence                                                    | RAR5                                                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`unrar`](https://crates.io/crates/unrar) 0.5.8 (2025-02-19)                                            | Rust → C++                                                                                                       | crate MIT/Apache-2.0; bundled UnRAR under RARLAB's licence | Yes (vendors UnRAR **7.1**; `VER_UNPACK5` handling in `headers.hpp`)                                                                                            | Built from vendored C++ with `cc`, C++14, links `pthread` (and `powrprof`/`shell32` on Windows) ([build.rs](https://github.com/muja/unrar.rs/blob/0628d12b4f2f79d80e6c6c0707ce611e8952b052/unrar_sys/build.rs)). README/docs say nothing about iOS/Android; cross-compiling is unverified. Can read an entry into a `Vec<u8>`. UnRAR's DLL API opens archives **by file name** (`ArcName`/`ArcNameW` in [dll.hpp](https://github.com/muja/unrar.rs/blob/0628d12b4f2f79d80e6c6c0707ce611e8952b052/unrar_sys/vendor/unrar/dll.hpp#L147-L149)), so the Book must be on disk first. |
| [libarchive](https://github.com/libarchive/libarchive) 3.8.x                                            | C (Rust via [`compress-tools`](https://crates.io/crates/compress-tools) 0.16.1, which links a system libarchive) | BSD-2 (some files CC0/OpenSSL/Apache)                      | Yes, "RAR 5.0 reader" since Oct 2018 ([NEWS#L75](https://github.com/libarchive/libarchive/blob/eb57ffefe20e98eb7ba05829ee1c23b90e589a71/NEWS#L75))              | README: "RAR and RAR 5.0 archives (with some limitations due to RAR's proprietary status)" ([README#L97](https://github.com/libarchive/libarchive/blob/eb57ffefe20e98eb7ba05829ee1c23b90e589a71/README.md#L97)). Encrypted entries are flagged, not decrypted. Mobile needs libarchive cross-built per ABI.                                                                                                                                                                                                                                                                     |
| [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) v2.0.2 (Jan 2024; last push Apr 2024) | WASM in a Web Worker                                                                                             | MIT (+ libarchive BSD-2)                                   | Yes, README lists "RAR v4, RAR v5" ([README#L16](https://github.com/nika-begiashvili/libarchivejs/blob/0989c1a6db20d030d793b1763e20d880068091bd/README.md#L16)) | Built from libarchive **3.7.2** with `ALLOW_MEMORY_GROWTH=1`. Copies the **whole archive** into the WASM heap (`file.arrayBuffer()` then `HEAPU8.set`, [archive-reader.js#L135-L138](https://github.com/nika-begiashvili/libarchivejs/blob/0989c1a6db20d030d793b1763e20d880068091bd/src/webworker/archive-reader.js#L135-L138); `archive_read_open_memory` in `main.c`). This is what jellyfin-web uses.                                                                                                                                                                        |

No pure-Rust RAR5 decoder was found on crates.io. A `rar-stream` project claiming browser RAR5
appeared in search results but the crate does not exist on crates.io as of this date; not
evaluated.

**UnRAR licence** ([vendored license.txt](https://github.com/muja/unrar.rs/blob/0628d12b4f2f79d80e6c6c0707ce611e8952b052/unrar_sys/vendor/unrar/license.txt)), clause 2, verbatim:

> UnRAR source code may be used in any software to handle RAR archives without limitations
> free of charge, but cannot be used to develop RAR (WinRAR) compatible archiver and to
> re-create RAR compression algorithm, which is proprietary. Distribution of modified UnRAR
> source code in separate form or as a part of other software is permitted, provided that
> full text of this paragraph, starting from "UnRAR source code" words, is included in
> license, or in documentation if license is not available, and in source code comments of
> resulting package.

Implications (reading, not legal advice): fine for a reader app, including in app stores; the
paragraph must ship in the app's licence/notices; the field-of-use restriction means the
combined work is not under an OSI licence, which matters if Komafin is ever GPL-licensed or
packaged by distros that reject non-free code (Debian, for example, keeps UnRAR in its `non-free` archive area; not re-checked here).

### 2.3 7z (CB7)

| Option                                                                     | Where      | Licence     | Notes                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`sevenz-rust2`](https://docs.rs/sevenz-rust2/0.25.0/) 0.25.0 (2026-11-06) | Rust, pure | Apache-2.0  | LZMA, LZMA2, BZIP2, PPMd, BCJ filters, BCJ2 (decode only); Deflate/Zstd/LZ4/Brotli behind features. WASM supported with `default_wasm` and `getrandom_backend="wasm_js"`. Docs: in solid archives "decompressing a file needs all previous data to also be decompressed". |
| libarchive / libarchive.js                                                 | C / WASM   | BSD-2 / MIT | "7-Zip archives (including archives that use zstandard compression)" ([README#L94](https://github.com/libarchive/libarchive/blob/eb57ffefe20e98eb7ba05829ee1c23b90e589a71/README.md#L94)).                                                                                |

### 2.4 Trade-off summary

- **One engine for all three formats**: libarchive (native via `compress-tools`, or WASM via
  libarchive.js). Native means cross-building a C library for iOS and four Android ABIs; WASM
  means whole-Book-in-memory and an unmaintained-looking wrapper pinned to libarchive 3.7.2.
- **Per-format Rust crates**: `zip` + `sevenz-rust2` are pure Rust (simple cross-compile);
  RAR still needs UnRAR or libarchive C/C++.
- **Webview-only**: zero native build work, matches jellyfin-web, but the Book lives in JS/WASM
  memory and reading downloaded files needs the fs plugin or IPC to hand bytes over.

## 3. PDF page rendering

| Option                                                        | Where                        | Licence                                                  | Platforms                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [pdf.js](https://github.com/mozilla/pdf.js) v6.5.438          | Webview (worker + canvas)    | Apache-2.0                                               | All webviews, with caveats                       | Modern build targets `Safari >= 18`, `Chrome >= 125` ([gulpfile.mjs#L87-L96](https://github.com/mozilla/pdf.js/blob/6619bf0c6fa6f7797e6b109cb6d431b0ab1ed00d/gulpfile.mjs#L87-L96)): WKWebView on iOS/macOS < 18 and older WebKitGTK need the `legacy` build. On iOS/Android the viewer limits canvases to 5 MP: "Limit canvas size to 5 mega-pixels on mobile" (`maxCanvasPixels` 5242880 vs 2^25 on desktop, [app_options.js#L24-L28](https://github.com/mozilla/pdf.js/blob/6619bf0c6fa6f7797e6b109cb6d431b0ab1ed00d/web/app_options.js#L24-L28)). Supports range loading: `rangeChunkSize` default 65536, `disableRange`/`disableStream` default false ([api.js#L119-L187](https://github.com/mozilla/pdf.js/blob/6619bf0c6fa6f7797e6b109cb6d431b0ab1ed00d/src/display/api.js#L119-L187)). |
| [`pdfium-render`](https://docs.rs/pdfium-render/0.9.5/) 0.9.5 | Rust → PDFium (C++)          | MIT OR Apache-2.0 (PDFium itself BSD-style)              | Desktop, Android, iOS, WASM                      | Binds PDFium dynamically at runtime by default, or statically with the `static` feature. Prebuilt PDFium: [bblanchon/pdfium-binaries](https://github.com/bblanchon/pdfium-binaries) (MIT packaging; release `chromium/8138` has mac, linux, win, android arm/arm64/x86/x64, ios device/simulator/catalyst), and paulocoutinhox/pdfium-lib. Docs: PDFium is not thread-safe, so the default `thread_safe` feature serialises every call behind a mutex; recent Android no longer lets apps use the system `libpdfium.so`; bblanchon's WASM build has a non-growable heap. iOS packaging of a dynamic PDFium needs checking against App Store rules (static linking avoids the question).                                                                                                        |
| [`mupdf`](https://docs.rs/mupdf/0.8.0/) 0.8.0                 | Rust → MuPDF (C)             | **AGPL-3.0** (commercial licence from Artifex otherwise) | Desktop; Android/WASM mentioned in feature notes | Needs libclang/bindgen and a C toolchain. AGPL obliges source release of the whole app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| [`hayro`](https://github.com/LaurenzV/hayro) 0.9.0            | Rust, pure                   | Apache-2.0 OR MIT                                        | Anywhere Rust compiles                           | README: renders "almost any PDF that renders in … Chrome (PDFium) or Firefox (pdf.js)", but robustness ("many ways to trigger timeouts and OOM errors"), performance and API are still in progress.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| OS renderers                                                  | Native plugin (Swift/Kotlin) | OS                                                       | Per OS                                           | Android [`PdfRenderer`](https://developer.android.com/reference/android/graphics/pdf/PdfRenderer) (API 21+): needs a **seekable** file descriptor, one page open at a time, recommends an isolated process for untrusted files. Apple [PDFKit](https://developer.apple.com/documentation/pdfkit) on iOS/macOS. Windows has `Windows.Data.Pdf`. Linux has none built in. Means three or four separate implementations behind a Tauri mobile/desktop plugin.                                                                                                                                                                                                                                                                                                                                     |

Not covered: EPUB (out of scope for Book per GLOSSARY).

## 4. Memory on large Books

Comic Books are often 50–500 MB and occasionally multi-GB (omnibus volumes); phones are the
tight case.

- **Whole-file-in-memory designs**: libarchive.js (copies the Book into the WASM heap, so
  ≥ 2× its size briefly: the `ArrayBuffer` plus the heap copy), any design that `fetch`es the
  Book into a `Blob`/`ArrayBuffer` before unpacking. wasm32 linear memory is capped at 4 GiB,
  and browsers may refuse growth well before that.
- **Random-access designs**: `zip` over a `File`, zip.js over HTTP Range, PDFium or
  `PdfRenderer` on a file descriptor, pdf.js with range requests. Memory is dominated by
  decoded Page bitmaps, not the Book.
- **Unavoidable sequential cases**: solid RAR and solid 7z archives must be decoded from the
  start of the solid block to reach a Page; options are decoding once to a cache directory
  (disk instead of RAM) or accepting slow random seeks.
- **Decoded bitmaps** dominate in every design: a 2000×3000 Page is ~24 MB as RGBA. pdf.js's
  5 MP mobile cap exists for this reason. Keeping only the visible ±N Pages decoded is the
  lever regardless of where decoding runs.
- UnRAR's API needs a path, so a CBR read natively must be on disk (offline cache or a temp
  file) before reading.

## 5. Networking: webview `fetch` vs Tauri HTTP plugin

### Origins of a Tauri page

Tauri's own docs on custom protocols
([tauri:crates/tauri/src/app.rs#L2326-L2333](https://github.com/tauri-apps/tauri/blob/f0d81979d6a18bd75b4d5d4dbf1f3d7ab719c07e/crates/tauri/src/app.rs#L2326-L2333)):

> - macOS, iOS and Linux: `<scheme_name>://localhost/<path>`
> - Windows and Android: `http://<scheme_name>.localhost/<path>` by default

So the app runs at `tauri://localhost` (macOS, iOS, Linux) or `http://tauri.localhost`
(Windows, Android). `app.windows[].useHttpsScheme` switches Windows/Android to `https://`, but
"will NOT allow mixed content when trying to fetch `http` endpoints", and changing it later
moves IndexedDB/localStorage/cookies, so old data is lost
([tauri:crates/tauri-utils/src/config.rs#L2213-L2223](https://github.com/tauri-apps/tauri/blob/f0d81979d6a18bd75b4d5d4dbf1f3d7ab719c07e/crates/tauri-utils/src/config.rs#L2213-L2223)).

### CORS on Jellyfin

Jellyfin builds its CORS policy with `AllowAnyMethod().AllowAnyHeader()` and, when
`CorsHosts` is empty or `["*"]` (the default is `{ "*" }`), `AllowAnyOrigin()`. With a custom
host list it switches to `WithOrigins(corsHosts).AllowCredentials()`
([server:Jellyfin.Server/Configuration/CorsPolicyProvider.cs](https://github.com/jellyfin/jellyfin/blob/797999fc9bd49a9f0853916e2933e3ad06173503/Jellyfin.Server/Configuration/CorsPolicyProvider.cs#L28-L43),
[ServerConfiguration.cs#L236](https://github.com/jellyfin/jellyfin/blob/797999fc9bd49a9f0853916e2933e3ad06173503/MediaBrowser.Model/Configuration/ServerConfiguration.cs#L236)).
So webview `fetch` works on a default server; it breaks if an admin restricts `CorsHosts`
without adding the Tauri origins, or a reverse proxy strips/overrides CORS headers.

### Tauri HTTP plugin

[`tauri-plugin-http`](https://v2.tauri.app/plugin/http-client/) 2.8.3 exposes a `fetch`
from JS that runs in Rust on `reqwest`. Requests are not subject to webview CORS because
they don't leave from the webview. Scope: URLs must be allowed in a capability (`http:default`
allows none until `allow` URL patterns are added). That means **widening Tauri capabilities**,
which CLAUDE.md says to ask about first, and because the server URL is user-entered, the scope
has to be broad (e.g. any `http(s)://*`) or set at runtime.

- TLS: default features are `rustls-tls`, `http2`, `charset`, `system-proxy`, `cookies`;
  `native-tls` and `rustls-tls-native-roots` are alternatives
  ([plugins:plugins/http/Cargo.toml#L53-L81](https://github.com/tauri-apps/plugins-workspace/blob/b4a6ed08d1578d7651dd69635f2ebd093051d4ee/plugins/http/Cargo.toml#L53-L81)).
- Self-signed certs: the `dangerous-settings` Cargo feature "Allows dangerous client settings
  such as accepting invalid certificates or hostnames"
  ([plugins:plugins/http/src/lib.rs#L45](https://github.com/tauri-apps/plugins-workspace/blob/b4a6ed08d1578d7651dd69635f2ebd093051d4ee/plugins/http/src/lib.rs#L45)),
  driven from JS by `danger: { acceptInvalidCerts, acceptInvalidHostnames }`
  ([guest-js/index.ts#L103-L121](https://github.com/tauri-apps/plugins-workspace/blob/b4a6ed08d1578d7651dd69635f2ebd093051d4ee/plugins/http/guest-js/index.ts#L103-L121)).
  This is all-or-nothing per request, not cert pinning; pinning would need custom Rust.
- Responses arrive over IPC, so large Book downloads should stream (the `stream` feature, or
  a Rust command that writes straight to disk) rather than buffer in JS.
- `unsafe-headers` feature unlocks forbidden headers.

### Webview `fetch`

- Uses the engine's own TLS and trust store. Code search of wry found no handler for
  WebView2's `ServerCertificateErrorDetected` or WKWebView's authentication challenge, so a
  self-signed Jellyfin works in the webview only if the user trusts its CA in the OS (on
  Android, only if the app's network security config trusts `user` CAs or a bundled CA; apps
  targeting API 24+ don't trust user CAs by default,
  [Android network security config](https://developer.android.com/privacy-and-security/security-config)).
- `<img src>` pointing at Jellyfin (covers, Pages) works without CORS, but authentication must
  go in the URL (`api_key`) or cookies, since `<img>` can't set headers. The HTTP plugin route
  has the opposite problem: images must be turned into blob URLs or served via a custom protocol.

### Plain HTTP (common on home LANs)

Applies to both routes:

- **Android** apps targeting API 28+ block cleartext by default (`cleartextTrafficPermitted="false"`);
  opt in per domain or in `base-config`
  ([security-config](https://developer.android.com/privacy-and-security/security-config)).
  Since the server host is user-entered, per-domain rules don't fit; it's `base-config` or nothing.
- **iOS/macOS** App Transport Security: `NSAllowsArbitraryLoadsInWebContent` exempts web views
  only, and "You must supply a justification during App Store review if you set the key's
  value to YES"
  ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloadsinwebcontent)).
  `NSAllowsLocalNetworking` covers `.local` and unqualified hosts
  ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking)).
  Rust `reqwest` on iOS uses its own sockets, not `NSURLSession`; whether ATS applies to it was
  not verified.
- On Windows/Android the page is `http://tauri.localhost`, so fetching `http://` is not mixed
  content; with `useHttpsScheme` it would be. On macOS/iOS/Linux the `tauri://` origin's mixed
  content treatment was not verified here.

## 6. Where to store downloaded Books

Tauri's path API (also exposed to JS via `@tauri-apps/api/path`):

| API                  | macOS                                | Windows                          | Linux                  | iOS                                                                    | Android                      |
| -------------------- | ------------------------------------ | -------------------------------- | ---------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| `app_data_dir`       | `~/Library/Application Support/<id>` | `{FOLDERID_RoamingAppData}\<id>` | `$XDG_DATA_HOME/<id>`  | `Library/Application Support/<id>` in the sandbox (expected, see note) | `context.dataDir` (internal) |
| `app_local_data_dir` | same as above                        | `{FOLDERID_LocalAppData}\<id>`   | same as above          | same as above                                                          | `context.dataDir`            |
| `app_cache_dir`      | `~/Library/Caches/<id>`              | `{FOLDERID_LocalAppData}\<id>`   | `$XDG_CACHE_HOME/<id>` | `Library/Caches/<id>` (expected, see note)                             | `context.cacheDir`           |

Sources: [tauri:crates/tauri/src/path/desktop.rs](https://github.com/tauri-apps/tauri/blob/f0d81979d6a18bd75b4d5d4dbf1f3d7ab719c07e/crates/tauri/src/path/desktop.rs) (desktop and iOS),
[android.rs#L148-L171](https://github.com/tauri-apps/tauri/blob/f0d81979d6a18bd75b4d5d4dbf1f3d7ab719c07e/crates/tauri/src/path/android.rs#L148-L171) and
[PathPlugin.kt](https://github.com/tauri-apps/tauri/blob/f0d81979d6a18bd75b4d5d4dbf1f3d7ab719c07e/crates/tauri/mobile/android/src/main/java/app/tauri/PathPlugin.kt). `<id>` is `com.grimfeld.komafin`.
Note: iOS has no separate resolver; it uses `desktop.rs`, which calls the `dirs` crate (v7) and
documents no iOS mapping for these functions. The iOS column is the expected sandbox location,
not verified on a device.
Roaming AppData on Windows syncs in domain profiles; multi-GB Books there is a poor fit, so
`app_local_data_dir` is the natural Windows choice.

Platform rules that matter for Books:

- **iOS** ([File System Programming Guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/FileSystemOverview/FileSystemOverview.html)):
  `Documents/` and `Application Support/` "are backed up by default … Any file that can be
  re-created or downloaded must be excluded from the backup" via `NSURLIsExcludedFromBackupKey`
  (needs a native call; no Tauri API for it was found). `Caches/` is not backed up and "the
  system may delete the Caches directory on rare occasions when the system is very low on disk
  space". `Documents/` is user-visible if file sharing is enabled.
- **Android** ([app-specific storage](https://developer.android.com/training/data-storage/app-specific)):
  internal `filesDir`/`dataDir` needs no permission, is private and encrypted on Android 10+,
  but "these directories tend to be small". `cacheDir` may be cleared "when the device is low
  on internal storage space". App-specific external storage (`getExternalFilesDir`) needs no
  permission since API 19 and suits large media, but may be unavailable (removable SD).
  Both are deleted on uninstall. Tauri's `app_data_dir` maps to internal `dataDir`; Tauri's
  Android path plugin also resolves external app-specific dirs for its `document_dir`,
  `download_dir` etc. (`getExternalFilesDir(DIRECTORY_DOCUMENTS)` and similar).
- **Desktop**: no OS purging of data dirs; `Caches` on macOS may be cleaned by user tools.

Options: keep downloaded Books in a data dir (survives pressure, needs explicit eviction and,
on iOS, backup exclusion) or in a cache dir (OS may evict; fine for "recently read" but not for
user-chosen offline Books).

## 7. Secure token storage

| Option                                                                                                                                                | Platforms                           | Licence    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`tauri-plugin-stronghold`](https://v2.tauri.app/plugin/stronghold/) 2.4.0 (official)                                                                 | All five                            | Apache/MIT | Encrypted snapshot file keyed by a password hash (argon2 by default, salt file in app local data dir). Not the OS keychain. Tauri maintainer: "stronghold is no longer recommended and will be deprecated and therefore removed in v3" ([discussion #7846](https://github.com/tauri-apps/tauri/discussions/7846#discussioncomment-7030870)); upstream iotaledger/stronghold.rs last pushed 2025-04.                                                                                                                                                                                                                                                                   |
| [`keyring`](https://docs.rs/keyring/4.2.0/keyring/) 4.2.0 / `keyring-core` 1.0.1 + store crates                                                       | macOS, iOS, Windows, Linux, Android | MIT/Apache | v4 splits stores out: `apple-native-keyring-store` (macOS legacy keychain or the protected store; "If you are writing an iOS app, then you have no choice but to use the protected store", which needs a provisioning-profile-signed app), `windows-native-keyring-store`, `dbus-`/`zbus-secret-service-keyring-store` and `linux-keyutils-keyring-store`, `android-native-keyring-store` (SharedPreferences encrypted with an Android Keystore key; needs `ndk-context`, which the crate says Tauri Mobile already initialises). Apps are told to depend on `keyring-core` + chosen stores, not `keyring`. Would need a small Tauri command, or a community wrapper. |
| Community Tauri wrappers: [`tauri-plugin-keyring`](https://github.com/HuakunShen/tauri-plugin-keyring) 0.1.0 (Dec 2024), `tauri-plugin-keyring-store` | Varies                              | MIT        | Unofficial, small; maintenance and mobile coverage need checking before use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tauri-plugin-store` 2.5.0                                                                                                                            | All                                 | Apache/MIT | Plain JSON on disk. Not secret storage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Webview `localStorage`                                                                                                                                | All                                 | —          | Readable by any script in the webview; no OS protection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Linux caveat: Secret Service requires a running keyring daemon (GNOME Keyring, KWallet);
headless or minimal desktops may have none, so a fallback path is needed whichever crate is used.

## Open questions (not answered here)

- Does UnRAR (via `unrar` or libarchive) cross-compile cleanly for `aarch64-apple-ios` and the
  Android ABIs with Tauri's toolchain? Needs a spike.
- Does ATS apply to Rust `reqwest` traffic on iOS, and how does WKWebView treat `http://`
  fetches from a `tauri://` origin?
- App Store acceptance of a dynamically loaded PDFium on iOS.
- Licence compatibility of UnRAR with whatever licence Komafin adopts.
