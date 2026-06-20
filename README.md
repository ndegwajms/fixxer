# Fixxer: HLS / m3u8 Cloudflare Worker Proxy

Fixxer is a small Cloudflare Worker that proxies HLS playlists (`.m3u8`) and media segments. When it fetches a playlist, it rewrites every segment, key, map, and rendition URL so the video player keeps calling back through the worker instead of calling the upstream host directly.

## How do I call it?

Use the `/v2` endpoint with the upstream playlist or segment URL in the `url` query parameter:

```txt
https://YOUR-WORKER.example.workers.dev/v2?url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8
```

### JavaScript

```js
const workerOrigin = "https://YOUR-WORKER.example.workers.dev";
const playlistUrl = "https://example.com/video/master.m3u8";

const proxiedPlaylistUrl = `${workerOrigin}/v2?url=${encodeURIComponent(playlistUrl)}`;
```

If the upstream host needs headers, pass them as JSON in the optional `headers` parameter:

```js
const workerOrigin = "https://YOUR-WORKER.example.workers.dev";
const playlistUrl = "https://example.com/video/master.m3u8";
const headers = {
  Referer: "https://example.com/",
  Origin: "https://example.com",
};

const params = new URLSearchParams({
  url: playlistUrl,
  headers: JSON.stringify(headers),
});

const proxiedPlaylistUrl = `${workerOrigin}/v2?${params.toString()}`;
```

### cURL

```bash
curl 'https://YOUR-WORKER.example.workers.dev/v2?url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8'
```

With custom upstream headers:

```bash
curl 'https://YOUR-WORKER.example.workers.dev/v2?url=https%3A%2F%2Fexample.com%2Fvideo%2Fmaster.m3u8&headers=%7B%22Referer%22%3A%22https%3A%2F%2Fexample.com%2F%22%7D'
```

### Video player example

```html
<video id="player" controls></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
  const workerOrigin = "https://YOUR-WORKER.example.workers.dev";
  const playlistUrl = "https://example.com/video/master.m3u8";
  const proxiedPlaylistUrl = `${workerOrigin}/v2?url=${encodeURIComponent(playlistUrl)}`;
  const video = document.getElementById("player");

  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(proxiedPlaylistUrl);
    hls.attachMedia(video);
  } else {
    video.src = proxiedPlaylistUrl;
  }
</script>
```

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `/` | Shows a JSON usage guide when no `url` is supplied. For backwards compatibility, `/?url=...` still uses the deprecated v1 proxy. |
| `/v2?url=...` | Recommended proxy endpoint for playlists and media files. |

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:8787` to see the usage guide.

## Deploy

```bash
npm install
npx wrangler login
npm run deploy
```

## Notes

- Only absolute `http://` and `https://` URLs are accepted in the public `url` parameter.
- Range requests are forwarded, which helps players seek through media files.
- CORS headers are added to worker responses so browsers can play proxied content.
- The `/v2` playlist rewriter handles segment lines plus common HLS attributes such as `URI="..."` and `URL="..."`.
