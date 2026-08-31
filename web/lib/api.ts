const configuredApiOrigin = process.env.NEXT_PUBLIC_HEYSTOCKERS_API_URL?.trim().replace(/\/$/, '') ?? '';

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return configuredApiOrigin ? `${configuredApiOrigin}${normalizedPath}` : normalizedPath;
}
