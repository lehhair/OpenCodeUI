const OMO_INTERNAL_INITIATOR_MARKER_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/

export function hasOmoInternalInitiatorMarker(rawText: string): boolean {
  return OMO_INTERNAL_INITIATOR_MARKER_PATTERN.test(rawText.normalize('NFC'))
}
