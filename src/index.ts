import { M3u8ProxyV1 } from "./logic/v1";
import { M3u8ProxyV2, createUsageResponse, handleOptions } from "./logic/v2";

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (url.pathname === "/" || url.pathname === "") {
    return url.searchParams.has("url") ? M3u8ProxyV1(request) : createUsageResponse(url.origin);
  }

  if (url.pathname === "/v2") {
    return M3u8ProxyV2(request);
  }

  return new Response("Not Found", {
    status: 404,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
