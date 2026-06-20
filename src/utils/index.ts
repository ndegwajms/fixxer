export function getUrl(input: string, fallbackUrl: URL): URL {
  const trimmedInput = input.trim();

  try {
    return new URL(trimmedInput);
  } catch (_) {
    if (trimmedInput.startsWith("//")) {
      return new URL(`https:${trimmedInput}`);
    }

    return new URL(trimmedInput, fallbackUrl);
  }
}
