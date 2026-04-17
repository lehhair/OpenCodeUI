export interface SseTextParser {
  push(chunk: string): string[]
}

export function createSseTextParser(): SseTextParser {
  let buffer = ''

  return {
    push(chunk: string) {
      if (!chunk) return []

      buffer += chunk
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''

      const events: string[] = []

      for (const block of blocks) {
        const dataLines: string[] = []

        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue
          dataLines.push(line[5] === ' ' ? line.slice(6) : line.slice(5))
        }

        if (dataLines.length > 0) {
          events.push(dataLines.join('\n'))
        }
      }

      return events
    },
  }
}
