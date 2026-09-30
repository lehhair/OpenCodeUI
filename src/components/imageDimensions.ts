export type ImageDimensions = { width: number; height: number }

const NUMERIC_PATH_DIMENSION_HOSTS = new Set([
  'dummyimage.com',
  'loremflickr.com',
  'picsum.photos',
  'placekitten.com',
  'www.picsum.photos',
])

function validDimension(value: number) {
  return Number.isFinite(value) && value > 0 && value <= 10000
}

function validDimensions(width: number, height: number) {
  if (!validDimension(width) || !validDimension(height)) return false
  return Math.max(width / height, height / width) <= 100
}

function inferFilenameDimensions(filename: string): ImageDimensions | null {
  const match = /(?:^|[-_])(\d{1,5})x(\d{1,5})(?:[._-]|$)/i.exec(filename)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return validDimensions(width, height) ? { width, height } : null
}

export function inferImageDimensions(src: string): ImageDimensions | null {
  try {
    const url = new URL(src, 'https://local.invalid')
    const segments = url.pathname.split('/').filter(Boolean)
    const filename = segments.at(-1) ?? ''

    if (NUMERIC_PATH_DIMENSION_HOSTS.has(url.hostname.toLowerCase())) {
      const pathWidth = Number(segments.at(-2))
      const pathHeight = Number(segments.at(-1))
      if (validDimensions(pathWidth, pathHeight)) return { width: pathWidth, height: pathHeight }
      const filenameDimensions = inferFilenameDimensions(filename)
      if (filenameDimensions) return filenameDimensions
    }

    const queryWidth = Number(url.searchParams.get('width') ?? url.searchParams.get('w'))
    const queryHeight = Number(url.searchParams.get('height') ?? url.searchParams.get('h'))
    if (validDimensions(queryWidth, queryHeight)) return { width: queryWidth, height: queryHeight }

    return inferFilenameDimensions(filename)
  } catch {
    return null
  }
  return null
}
