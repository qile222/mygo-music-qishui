# 汽水音乐 (Qishui Music) for MyGo Music

A macOS-only [MyGo Music](https://github.com/egoist/mygo-music) plugin for [汽水音乐 / Qishui Music](https://qishui.douyin.com/): sign in with a QR code, then browse, search, like, manage playlists and play tracks in full quality — from a single plain JavaScript file, with no Node.js, Electron or native helper to install.

[中文说明](./README.zh-CN.md)

## Features

- **Home**: recommended playlists, Hot / New / Western charts, recent plays once signed in
- **Discover, charts, liked songs, saved albums, recently played**
- **Search** tracks, albums, artists and playlists
- **Artist, album and playlist pages**
- **Lyrics**: word-by-word KRC plus LRC fallback in the Now Playing panel
- **Likes**: like / unlike in MyGo stays in sync with Qishui's "Liked Songs"
- **Playlists**: create, rename, delete, add / remove tracks, reorder; save or unsave other people's playlists
- **Saved albums and followed artists**
- **Comments**: read, like, post (top-level comments only)
- **Playback reporting**: start playing a track and it shows up in Qishui's recently played
- **Full-track playback** without ffmpeg: fetches the official PC playback stream, decrypts CENC (AES-128-CTR) in pure JavaScript, then hands a local file to MyGo
- **Lossless**: official FLAC-in-MP4 when your account has it
- **Cache**: the last 8 decrypted tracks are kept, so replays and auto-prefetch start almost instantly

## Platform support

**macOS only.** Windows and Linux are not supported in this release.

All features require macOS; full-track playback and write actions additionally require the official **汽水音乐 / Soda Music** macOS client installed on the same machine.

## Requirements

- MyGo Music **0.1.22** or newer
- macOS (the only supported platform), with the official **汽水音乐 / Soda Music** macOS client installed for full playback and write features
- A Qishui account (a free account can browse; full playback is limited to tracks your account can play)

## Install

1. MyGo Music → **Settings → Plugins → + → Install from GitHub**, enter `qile222/mygo-music-qishui`
2. Open the plugin menu → **Sign in**, then scan the QR code with the Qishui app
3. Pick an audio quality in MyGo's playback settings (default: High)

Deep link:

```
mygo-music://install-plugin?repo=qile222/mygo-music-qishui
```

Or copy this folder into MyGo's plugins folder (Settings → Plugins → `+` → Show Plugins Folder) and restart the app.

The plugin is also listed on the [MyGo plugin market](https://mygo-music.egoist.dev/plugins) once GitHub indexes the `mygo-music-plugin` topic — search for `qishui`.

## Why does it need the desktop app?

Qishui validates an official client signature on its playback API. The plugin does not ship a signer. When the official macOS app is installed, the plugin reuses that app's bundled Electron runtime to call the app's own signing module (read-only; the app UI is not launched). Without the app you can still browse, search and play unencrypted tracks; VIP tracks stay unavailable.

External programs the plugin may start (macOS only):

- `/usr/bin/base64` — system binary used to write decrypted audio into the plugin data folder
- `/usr/bin/env` — runs the signing script inside the official app's Electron runtime

You need to allow programs for this plugin in MyGo Settings (**Allow Programs**).

## Audio quality

| MyGo | Qishui tier | Typical |
| --- | --- | --- |
| Standard | medium (AAC) | ~64 kbps, 1–2 MB per track |
| High (default) | higher (AAC) | ~128 kbps, 3–5 MB per track |
| Lossless | lossless (FLAC) | ~0.8–1.6 Mbps, 20–30 MB per track |

If the requested tier is missing, the plugin falls back automatically (lossless → hi_res → highest → higher → medium, and similarly for the other tiers). Qishui's spatial-audio and "极高" tiers are not exposed separately.

## Permissions and privacy

`plugin.json` requests:

- Network: `api.qishui.com`, `*.qishui.com`, `beta-luna.douyin.com`, `*.douyin.com`, `*.douyinpic.com`, `*.douyinvod.com`, `*.douyincdn.com`
- Programs (macOS only): `/usr/bin/base64`, `/usr/bin/env`

Login cookies are stored only in MyGo's private plugin storage on your machine. The plugin never logs cookies, device ids, signature headers or signed audio URLs, and nothing is sent anywhere except Qishui endpoints.

## Known limitations

- Only tracks your account can play are played in full; previews are never bypassed.
- Comments are top-level only — Qishui and the MyGo plugin runtime have no reply / nested-comment API.
- Saved and followed lists can take 1–3 seconds to reflect a change.
- Qishui's APIs are unofficial and may change with client updates; the plugin degrades to whatever the API returns.
- This release supports macOS only; Windows and Linux are not supported.

## Disclaimer

This plugin is not affiliated with Qishui, Douyin or MyGo Music. Use it with your own account and follow Qishui's terms of service. Do not use it for scraping, redistribution or any other activity that infringes copyright or platform rights.

## License

[MIT](./LICENSE)

Thanks to [MyGo Music](https://github.com/egoist/mygo-music) for the plugin runtime and documentation.
