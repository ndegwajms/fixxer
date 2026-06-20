import { getUrl } from "../utils";

const M3U8_CONTENT_TYPES = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "video/x-mpegurl",
  "application/vnd.apple.mpegurl.audio",
  "application/vnd.apple.mpegurl.video",
  "application/vnd.",
];

const HLS_URI_ATTRIBUTES = new Set(["URI", "URL"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range, Authorization",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

type ScrapeHeaders = Record<string, string>;

export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export function createUsageResponse(origin: string): Response {
  const exampleUrl = "https://example.com/path/master.m3u8";
  const proxiedUrl = `${origin}/v2?url=${encodeURIComponent(exampleUrl)}`;

  return jsonResponse({
    name: "m3u8 Cloudflare Worker Proxy",
    usage: {
      endpoint: `${origin}/v2`,
      requiredQueryParameter: "url",
      optionalQueryParameter: "headers - JSON object of request headers to forward upstream",
      example: proxiedUrl,
      curl: `curl '${proxiedUrl}'`,
      javascript: `const proxiedUrl = '${origin}/v2?url=' + encodeURIComponent('${exampleUrl}');`,
    },
  });
}

export const M3u8ProxyV2 = async (request: Request): Promise<Response> => {
  const requestUrl = new URL(request.url);
  const targetUrlString = requestUrl.searchParams.get("url");
  const forwardedHeadersString = requestUrl.searchParams.get("headers");

  if (!targetUrlString) {
    return jsonResponse(
      {
        success: false,
        message: "Missing required query parameter: url",
        example: `${requestUrl.origin}/v2?url=${encodeURIComponent("https://example.com/path/master.m3u8")}`,
      },
      400
    );
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetUrlString);
  } catch (_) {
    return jsonResponse(
      {
        success: false,
        message: "The url query parameter must be an absolute HTTP or HTTPS URL.",
      },
      400
    );
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return jsonResponse(
      {
        success: false,
        message: "Only HTTP and HTTPS URLs are supported.",
      },
      400
    );
  }

  const forwardedHeaders = parseForwardedHeaders(forwardedHeadersString);
  if (forwardedHeadersString && !forwardedHeaders) {
    return jsonResponse(
      {
        success: false,
        message: "The headers query parameter must be a JSON object with string values.",
      },
      400
    );
  }

  const upstreamHeaders = buildUpstreamHeaders(request, forwardedHeaders ?? {});
  const upstreamResponse = await fetch(targetUrl.toString(), {
    headers: upstreamHeaders,
    method: request.method === "HEAD" ? "HEAD" : "GET",
  });

  const responseHeaders = buildResponseHeaders(upstreamResponse.headers);
  const contentType = upstreamResponse.headers.get("Content-Type")?.toLowerCase() ?? "";
  const isM3u8 = targetUrl.pathname.toLowerCase().endsWith(".m3u8") || M3U8_CONTENT_TYPES.some((name) => contentType.includes(name));

  if (!isM3u8 || request.method === "HEAD") {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  const playlist = await upstreamResponse.text();
  responseHeaders.set("Content-Type", upstreamResponse.headers.get("Content-Type") ?? "application/vnd.apple.mpegurl; charset=utf-8");

  return new Response(rewritePlaylist(playlist, targetUrl, forwardedHeadersString, requestUrl.origin), {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
};

function parseForwardedHeaders(headersString: string | null): ScrapeHeaders | null {
  if (!headersString) return {};

  try {
    const parsed = JSON.parse(headersString) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch (_) {
    return null;
  }
}

function buildUpstreamHeaders(request: Request, forwardedHeaders: ScrapeHeaders): Headers {
  const headers = new Headers(forwardedHeaders);
  const rangeHeader = request.headers.get("Range");

  if (rangeHeader && !headers.has("Range")) {
    headers.set("Range", rangeHeader);
  }

  return headers;
}

function buildResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers(upstreamHeaders);

  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }

  return headers;
}

function rewritePlaylist(playlist: string, baseUrl: URL, forwardedHeadersString: string | null, proxyOrigin: string): string {
  return playlist
    .split("\n")
    .map((line) => rewritePlaylistLine(line, baseUrl, forwardedHeadersString, proxyOrigin))
    .join("\n");
}

function rewritePlaylistLine(line: string, baseUrl: URL, forwardedHeadersString: string | null, proxyOrigin: string): string {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith("#") === false) {
    return trimmedLine ? createProxyPath(getUrl(trimmedLine, baseUrl), forwardedHeadersString, proxyOrigin) : line;
  }

  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return line;

  const tag = line.slice(0, colonIndex);
  const attributes = line.slice(colonIndex + 1);

  if (!attributes.includes("URI=") && !attributes.includes("URL=")) {
    return line;
  }

  return `${tag}:${rewriteAttributeList(attributes, baseUrl, forwardedHeadersString, proxyOrigin)}`;
}

function rewriteAttributeList(attributes: string, baseUrl: URL, forwardedHeadersString: string | null, proxyOrigin: string): string {
  return attributes.replace(/\b(URI|URL)=("[^"]*"|[^,]*)/g, (_match, key: string, rawValue: string) => {
    if (!HLS_URI_ATTRIBUTES.has(key)) return _match;

    const unquotedValue = rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;
    const rewrittenValue = createProxyPath(getUrl(unquotedValue, baseUrl), forwardedHeadersString, proxyOrigin);

    return `${key}="${rewrittenValue}"`;
  });
}

function createProxyPath(targetUrl: URL, forwardedHeadersString: string | null, proxyOrigin: string): string {
  const searchParams = new URLSearchParams();
  searchParams.set("url", targetUrl.toString());
  if (forwardedHeadersString) searchParams.set("headers", forwardedHeadersString);

  return `${proxyOrigin}/v2?${searchParams.toString()}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
