/**
 * One source of truth for the shape of a game cover.
 *
 * The card, the skeleton that stands in for it, the upload preview and the crop editor all
 * have to agree: whatever the player frames in the cropper is exactly what the card shows.
 * They used to disagree — the card rendered 1.82:1, the cropper framed 3:2, and the upload
 * preview was a fixed-height box with no ratio at all — so the visible crop was never quite
 * what had been chosen. Change the ratio here and every one of them follows.
 */
export const GAME_COVER_ASPECT = 1.46

/** Ready for `aspectRatio` in sx / CSS. */
export const GAME_COVER_ASPECT_CSS = `${GAME_COVER_ASPECT} / 1`
