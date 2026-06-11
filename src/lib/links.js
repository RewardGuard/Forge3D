// Build an Amazon search URL for a component by name. We use a search link
// (always valid) rather than a specific ASIN so it survives listing changes,
// and so users see current live pricing on Amazon.
export function amazonUrl(name) {
  const q = encodeURIComponent(`${name} electronics`);
  return `https://www.amazon.com/s?k=${q}`;
}

// Open a URL in the system browser (Electron) with a web fallback.
export function openExternal(url) {
  if (window.forge?.openExternal) window.forge.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}
