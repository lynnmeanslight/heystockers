export function allowedOrigin(origin: string | undefined, configured: string | undefined) {
  if (!origin) return true
  const allowed = new Set((configured ?? '').split(',').map((value) => value.trim()).filter(Boolean))
  return allowed.has(origin)
}
