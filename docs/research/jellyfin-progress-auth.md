# Jellyfin: Reading progress and sign-in

Research for [#4](https://github.com/grimfeld/komafin/issues/4). Researched 2026-11-09 against the current stable releases:

- Jellyfin server **v12.4** (`83d0d0e7f76e23e2e085c8ff67d28b772d35967d`), linked below as `S/…`, meaning `https://github.com/jellyfin/jellyfin/blob/v12.4/…`
- jellyfin-web **v12.4** (`0a580ce8df89282dfd120b6d5efb8e106da23bd5`), linked as `W/…`
- jellyfin-sdk-typescript **v1.0.2**, linked as `SDK/…`

Every claim below cites the server or web source that implements it. The OpenAPI spec at <https://api.jellyfin.org> is generated from the same controllers. Line numbers refer to the tagged commits.

## TL;DR

- **Where progress lives.** It is per-user `UserData` on the Book item: `Played` (read/unread) and `PlaybackPositionTicks` (current Page). No other field exists for it.
- **Page encoding.** jellyfin-web stores the **0-based Page index × 10 000** in `PlaybackPositionTicks`. The server sets a CBZ/CBR/CB7/CBT Book's `RunTimeTicks` to _archive entry count × 10 000_ and a PDF's to _page count × 10 000_. If Komafin uses the same encoding, its position shows up in Jellyfin Web and the other way round.
- **Read/unread is never set automatically for Books.** Reaching the last Page does not mark a Book played. A client has to call `POST /UserPlayedItems/{id}` (read) or `DELETE /UserPlayedItems/{id}` (unread), and both reset the position to 0.
- **Sign-in.** Use `POST /Users/AuthenticateByName` with `{Username, Pw}`, or Quick Connect (`/QuickConnect/Initiate` → poll `/QuickConnect/Connect` → `POST /Users/AuthenticateWithQuickConnect`). Both return `AccessToken`, `User`, `SessionInfo` and `ServerId`.
- **Client identification.** Every request carries `Authorization: MediaBrowser Client="…", Device="…", DeviceId="…", Version="…", Token="…"`, with values URL-encoded. The `X-Emby-*` headers are off by default.
- **Token lifecycle.** A token is a random GUID that never expires on its own. There is one token per (user, DeviceId): signing in again from the same DeviceId revokes the previous one. Tokens are revoked by `POST /Sessions/Logout`, by an admin deleting the device, or by a password change, user disable or user delete. A token carries the user's full permissions; it has no narrower scopes.

## 1. Reading progress

### 1.1 Data model

Progress is the user's `UserItemData` for the Book item. The fields that matter are `Played`, `PlaybackPositionTicks`, `PlayCount` and `LastPlayedDate`. The server also derives `PlayedPercentage` as `PlaybackPositionTicks / RunTimeTicks × 100` ([S/MediaBrowser.Controller/Entities/BaseItem.cs#L2787-L2799](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Controller/Entities/BaseItem.cs#L2787-L2799)). The data is stored per user, not per device, so every client signed in as that user sees the same values.

`Book` declares `SupportsPlayedStatus = true` and `SupportsPositionTicksResume = true` ([S/MediaBrowser.Controller/Entities/Book.cs](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Controller/Entities/Book.cs)).

### 1.2 How a Book's "runtime" is defined (the Page convention)

`ProbeProvider.FetchAsync(Book)` ([S/MediaBrowser.Providers/MediaInfo/ProbeProvider.cs#L246-L292](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Providers/MediaInfo/ProbeProvider.cs#L246-L292)) sets `RunTimeTicks` as follows:

| Format                      | `RunTimeTicks`                                                   |
| --------------------------- | ---------------------------------------------------------------- |
| `.cbz` `.cbr` `.cb7` `.cbt` | count of **non-directory archive entries** × 10 000              |
| `.pdf`                      | PDF page count × 10 000                                          |
| `.epub`                     | `TimeSpan.TicksPerSecond` (progress is a fraction of one second) |

The source comments state the convention outright: "book players report page count and the web client multiplies that value by 10000 to convert the expected milliseconds into ticks", and "TODO use page count without modification when multiple progress types are supported". `MetadataService` does not let remote metadata overwrite a Book's runtime ([S/MediaBrowser.Providers/Manager/MetadataService.cs#L1264](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Providers/Manager/MetadataService.cs#L1264)).

> **Caveat:** for archives the count includes every file in the archive, `ComicInfo.xml` and other non-image files among them. So `RunTimeTicks / 10000` can be slightly larger than the real number of Pages, and `PlayedPercentage` can never quite reach 100. Komafin should count Pages itself and use the server value only for display.

### 1.3 What jellyfin-web does (the reference client)

- The comics player reports `currentTime()` as `currentPage`, which is Swiper's 0-based `activeIndex`, and `duration()` as the image count ([W/src/plugins/comicsPlayer/plugin.js#L84-L90](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/plugins/comicsPlayer/plugin.js#L84-L90), [#L281-L282](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/plugins/comicsPlayer/plugin.js#L281-L282), [#L319-L322](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/plugins/comicsPlayer/plugin.js#L319-L322)).
- When it opens a Book it resumes at `startPositionTicks / 10000` ([#L282](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/plugins/comicsPlayer/plugin.js#L282)).
- playbackManager converts that value to ticks as `Math.floor(10000 * player.currentTime())` ([W/src/components/playback/playbackmanager.js#L2272-L2285](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/components/playback/playbackmanager.js#L2272-L2285)). So Page _n_ (0-based) is stored as `n × 10000` ticks.
- It sends that value through the normal Sessions/Playing reports:
  - on every page turn (the player fires `pause` on `slideChange`, which triggers `sendProgressUpdate`; [playbackmanager.js#L3666](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/components/playback/playbackmanager.js#L3666))
  - every 10 s ([#L3343-L3352](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/components/playback/playbackmanager.js#L3343-L3352))
  - on close (`reportPlaybackStopped`, [#L3534-L3572](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/components/playback/playbackmanager.js#L3534-L3572))
- The PDF player follows the same convention: page index, with `startPositionTicks / 10000` ([W/src/plugins/pdfPlayer/plugin.js#L79-L85](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/plugins/pdfPlayer/plugin.js#L79-L85), [#L229](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/plugins/pdfPlayer/plugin.js#L229)). The EPUB player uses a fraction instead ([W/src/plugins/bookPlayer/plugin.js#L111-L117](https://github.com/jellyfin/jellyfin-web/blob/v12.4/src/plugins/bookPlayer/plugin.js#L111-L117)).
- jellyfin-web never marks a comic played when it reaches the end. Nothing in the comics player or playbackManager does so, and the server won't either (see 1.4).

### 1.4 Server behaviour for each write path

**A. Sessions/Playing reports**, the path jellyfin-web uses:

- `POST /Sessions/Playing`, `POST /Sessions/Playing/Progress`, `POST /Sessions/Playing/Stopped`, with body `{ItemId, PositionTicks, …}` ([S/Jellyfin.Api/Controllers/PlaystateController.cs#L201-L260](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/PlaystateController.cs#L201-L260)).
- **Start** increments `PlayCount` and sets `LastPlayedDate`. For Books it does _not_ set `Played`, because they support resume ([S/Emby.Server.Implementations/Session/SessionManager.cs#L846-L863](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L846-L863)).
- **Progress and Stopped** call `UserDataManager.UpdatePlayState` ([S/Emby.Server.Implementations/Library/UserDataManager.cs#L455-L529](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Library/UserDataManager.cs#L455-L529)). For a `Book` that has a runtime, the server skips the MinResumePct/MaxResumePct logic (`item is not Book`) and stores the reported ticks **unchanged**. `Played` is not touched.
- **Pitfall:** if a Book has _no_ `RunTimeTicks`, for example because the probe hasn't run yet or the format is unsupported, the `!hasRuntime` branch runs. Any progress or stop report then sets `Played = true` and resets the position to 0. A Stopped report with no `PositionTicks` does the same ([SessionManager.cs#L1176-L1213](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L1176-L1213)). Komafin must always send `PositionTicks`, and should check `RunTimeTicks > 0` before using this path.
- Progress is saved only for the item the session reports as now playing, and only for non-automated check-ins ([SessionManager.cs#L903-L936](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L903-L936)). So `Start` has to be sent before `Progress`.
- Side effect: the session shows as "now playing" on the admin dashboard and in `GET /Sessions`.

**B. Direct UserData write**:

- `POST /UserItems/{itemId}/UserData` with an `UpdateUserItemDataDto` body ([S/Jellyfin.Api/Controllers/ItemsController.cs#L1128-L1159](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/ItemsController.cs#L1128-L1159)).
- Every non-null field is copied verbatim: `PlaybackPositionTicks`, `Played`, `PlayCount`, `LastPlayedDate`, `IsFavorite`, `Likes`, `Rating`. `PlayedPercentage` and `UnplayedItemCount` in the DTO are **ignored** ([UserDataManager.cs#L112-L156](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Library/UserDataManager.cs#L112-L156), [S/MediaBrowser.Model/Dto/UpdateUserItemDataDto.cs](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Model/Dto/UpdateUserItemDataDto.cs)).
- No thresholds apply, no session is needed, and the `!hasRuntime` pitfall doesn't apply. Komafin has to set `LastPlayedDate` itself, or the Book won't sort correctly in Resume lists.
- Read it back with `GET /UserItems/{itemId}/UserData` ([ItemsController.cs#L1072-L1099](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/ItemsController.cs#L1072-L1099)), or as `UserData` on any item query that sets `enableUserData=true`.

**C. Played / unplayed toggles**:

- `POST /UserPlayedItems/{itemId}` calls `MarkPlayed(resetPosition: true)`. That sets `Played = true`, makes `PlayCount` at least 1 and sets the position to **0** ([PlaystateController.cs#L72-L110](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/PlaystateController.cs#L72-L110), [#L513-L525](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/PlaystateController.cs#L513-L525), [BaseItem.cs#L2240-L2270](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Controller/Entities/BaseItem.cs#L2240-L2270)).
- `DELETE /UserPlayedItems/{itemId}` resets `PlayCount`, the position, `LastPlayedDate` and `Played` ([BaseItem.cs#L2277-L2303](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Controller/Entities/BaseItem.cs#L2277-L2303)).
- These are the same calls that Jellyfin Web's "Mark played" / "Mark unplayed" menu items make.

### 1.5 Visibility to Jellyfin Web and other clients

- **Shared storage:** all three paths write the same per-user `UserData`, so every client sees the result.
- **Resume in Jellyfin Web:** jellyfin-web's comics and PDF players resume at `PlaybackPositionTicks / 10000`. If Komafin writes the 0-based Page index × 10 000, Jellyfin Web opens the Book on the same Page, and Komafin can read what Jellyfin Web wrote in the same way.
- **First Page:** Page 0 is stored as 0 ticks, which can't be told apart from "not started".
- **Continue Reading:** `GET /UserItems/Resume?mediaTypes=Book` lists items with `IsResumable` (position > 0) ([ItemsController.cs#L921-L990](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/ItemsController.cs#L921-L990)). This is the "Continue Reading" row.
- **Live updates:** connected clients get a `UserDataChanged` WebSocket message when user data changes. Progress-driven changes are debounced by 500 ms ([S/Emby.Server.Implementations/EntryPoints/UserDataChangeNotifier.cs#L20](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/EntryPoints/UserDataChangeNotifier.cs#L20), [#L67](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/EntryPoints/UserDataChangeNotifier.cs#L67)).

### 1.6 Recommendation for Komafin

1. **Encoding.** Store the current Page as `PlaybackPositionTicks = pageIndex0 × 10000`, the convention jellyfin-web shares.
2. **Writing the Page.**
   - Prefer path **A** (Sessions/Playing Start → Progress → Stopped) when `RunTimeTicks > 0`, always with `PositionTicks` set. It matches jellyfin-web and shows Komafin as "now reading" on the dashboard.
   - Use path **B** (`POST /UserItems/{id}/UserData` with `PlaybackPositionTicks` and `LastPlayedDate`) for offline sync replay and as the fallback when the runtime is missing. It is a single idempotent call that needs no session state.
3. **Read/unread.** Mark the Book read explicitly with `POST /UserPlayedItems/{id}` when the user finishes it (Komafin decides what "finished" means). Mark it unread with `DELETE`. Both clear the Page position, which suits read/unread semantics.
4. **Page count.** Don't rely on `RunTimeTicks / 10000` as the true Page count (see the caveat in 1.2).

## 2. Sign-in

### 2.1 Client and device identification

The server reads the `Authorization` header, and only when the scheme is `MediaBrowser` ([S/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs#L65-L120](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs#L65-L120), [#L231-L267](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs#L231-L267)):

```
Authorization: MediaBrowser Client="Komafin", Device="<device name>", DeviceId="<stable id>", Version="<app version>", Token="<access token>"
```

- The parser URL-decodes values, and the official SDK URL-encodes them ([SDK/src/utils/authentication.ts#L11-L19](https://github.com/jellyfin/jellyfin-sdk-typescript/blob/v1.0.2/src/utils/authentication.ts#L11-L19)). Komafin should do the same.
- Before sign-in, `Token` is omitted or empty.
- A token can also be passed as the `?ApiKey=` query parameter. That is useful for `<img>` URLs.
- The `X-Emby-Authorization`, `X-Emby-Token` and `X-MediaBrowser-Token` headers, the `Emby` scheme and `?api_key=` only work when the admin enables `EnableLegacyAuthorization`. It defaults to `false` ([S/MediaBrowser.Model/Configuration/ServerConfiguration.cs#L290](https://github.com/jellyfin/jellyfin/blob/v12.4/MediaBrowser.Model/Configuration/ServerConfiguration.cs#L290)).
- Sign-in fails if `Client`, `Version`, `Device` or `DeviceId` is empty ([SessionManager.cs#L1716-L1724](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L1716-L1724)). Quick Connect enforces the same check ([QuickConnectManager.cs#L72-L77](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs#L72-L77)).
- **`DeviceId` must be stable per install and unique per device.** The server keeps one token per (user, DeviceId) (see 2.4). Admins can also restrict users to specific devices (`CanAccessDevice`, [SessionManager.cs#L1748-L1752](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L1748-L1752)).
- When a later request's `Device` or `Version` differs from the stored one, the server updates its device record ([AuthorizationContext.cs#L152-L191](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs#L152-L191)).

### 2.2 Username and password

1. Optionally call `GET /System/Info/Public` to identify the server and `GET /Users/Public` to list visible users for a picker. Both work without a token.
2. Call `POST /Users/AuthenticateByName` with body `{"Username": "...", "Pw": "..."}` and the identification header above ([S/Jellyfin.Api/Controllers/UserController.cs#L209-L234](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/UserController.cs#L209-L234)).
3. The response is an `AuthenticationResult` with `User`, `SessionInfo`, `AccessToken` and `ServerId` ([SessionManager.cs#L1762-L1781](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L1762-L1781)).
4. Persist `AccessToken`, `User.Id` and `ServerId`. Never persist the password.

The call can also fail with a `SecurityException` in two cases: the user is at `MaxActiveSessions`, or the device is not allowed ([SessionManager.cs#L1748-L1760](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L1748-L1760)).

### 2.3 Quick Connect

Endpoints: [S/Jellyfin.Api/Controllers/QuickConnectController.cs](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/QuickConnectController.cs). Logic: [S/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs).

1. `GET /QuickConnect/Enabled` returns `true` or `false`, depending on the admin setting `QuickConnectAvailable`.
2. `POST /QuickConnect/Initiate`, sent with the identification header and no token, returns `{Secret, Code, DeviceId, DeviceName, AppName, AppVersion, DateAdded, Authenticated:false}`. `Code` is 6 digits. `Secret` is 32 random bytes as hex. The call returns 401 when Quick Connect is disabled.
3. Komafin shows `Code` to the user. In an already signed-in client (Jellyfin Web: Profile → Quick Connect), the user enters it, which calls `POST /QuickConnect/Authorize?code=…`.
4. Komafin polls `GET /QuickConnect/Connect?secret=…` until `Authenticated` is `true`. An unknown or expired secret returns 404.
5. `POST /Users/AuthenticateWithQuickConnect` with body `{"Secret": "..."}` returns the same `AuthenticationResult` as password sign-in ([UserController.cs#L245-L259](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/UserController.cs#L245-L259)).

The server issues the token in step 3, under the DeviceId, device name, client name and version captured at Initiate ([QuickConnectManager.cs#L136-L171](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs#L136-L171)).

Timing ([#L26-L31](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs#L26-L31), [#L198-L227](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs#L198-L227)):

- A pending request expires after **10 minutes**.
- Once authorized, a request expires one minute later.
- An authorized secret can be exchanged for the token for up to 10 minutes after authorization.

### 2.4 Access tokens: issuance, scope, revocation

- **Format and lifetime.** A token is `Guid.NewGuid().ToString("N")`, stored as a `Device` row ([S/src/Jellyfin.Database/Jellyfin.Database.Implementations/Entities/Security/Device.cs#L29](https://github.com/jellyfin/jellyfin/blob/v12.4/src/Jellyfin.Database/Jellyfin.Database.Implementations/Entities/Security/Device.cs#L29)). Tokens **do not expire**: no expiry field or check exists, and there is no refresh flow. `DateLastActivity` is only bookkeeping. `InactiveSessionThreshold` closes idle _sessions_ (now-playing state), not tokens.
- **One token per (user, DeviceId).** At each sign-in, `GetAuthorizationToken` first logs out every existing token for that user and DeviceId, then creates a new one ([SessionManager.cs#L1784-L1813](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L1784-L1813)). Signing in again from Komafin therefore invalidates its old token. Two installs that share a DeviceId would log each other out.
- **Scope.** A user token carries the full permissions of that user's policy (admin or not, library access, and so on). There are no narrower scopes. Admin-created API keys (`/Auth/Keys`) are not tied to a user and get the Administrator role ([S/Jellyfin.Api/Auth/CustomAuthenticationHandler.cs#L53-L57](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Auth/CustomAuthenticationHandler.cs#L53-L57)), so they don't suit an end-user client.
- **Revocation:**
  - The user signs out: `POST /Sessions/Logout` deletes the caller's token ([S/Jellyfin.Api/Controllers/SessionController.cs#L427-L435](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/SessionController.cs#L427-L435), [SessionManager.cs#L1816-L1859](https://github.com/jellyfin/jellyfin/blob/v12.4/Emby.Server.Implementations/Session/SessionManager.cs#L1816-L1859)).
  - An admin deletes the device: `DELETE /Devices?id=…` ([S/Jellyfin.Api/Controllers/DevicesController.cs#L125-L147](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/DevicesController.cs#L125-L147)).
  - The password changes: every token except the caller's is revoked ([UserController.cs#L311-L315](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/UserController.cs#L311-L315)).
  - The user is disabled ([#L450-L451](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/UserController.cs#L450-L451)) or deleted ([#L163](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Api/Controllers/UserController.cs#L163)).
  - The device is removed from the user's allowed devices ([S/Jellyfin.Server.Implementations/Users/DeviceAccessHost.cs#L77-L94](https://github.com/jellyfin/jellyfin/blob/v12.4/Jellyfin.Server.Implementations/Users/DeviceAccessHost.cs#L77-L94)).
- **Client handling.** A revoked or unknown token gets **401**. Komafin should treat 401 as "signed out" and send the user back to sign-in, since there is nothing to refresh.

## Open points (not answered by the sources)

- Whether the server ever re-probes a Book's `RunTimeTicks` when the file changes. It happens only on a metadata refresh, and the timing of that wasn't traced.
- How the separate Bookshelf plugin, which provides ComicInfo metadata, interacts with these fields. It is outside the server repo and was not researched here.
