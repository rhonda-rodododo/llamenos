export function normalizeSignalIdentifier(input: string, type: 'phone' | 'username'): string {
  if (type === 'phone') {
    const stripped = input.replace(/[^\d+]/g, '')
    return stripped.startsWith('+') ? stripped : `+${stripped}`
  }
  const lowered = input.toLowerCase().trim()
  return lowered.startsWith('@') ? lowered : `@${lowered}`
}
