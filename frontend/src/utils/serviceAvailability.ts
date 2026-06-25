export const SERVICE_UNAVAILABLE_EVENT = 'morius:service-unavailable'

export function dispatchServiceUnavailable(): void {
  window.dispatchEvent(new CustomEvent(SERVICE_UNAVAILABLE_EVENT))
}
