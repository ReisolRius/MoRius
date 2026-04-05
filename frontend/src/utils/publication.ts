import type { StoryGameVisibility, StoryPublicationState, StoryPublicationStatus } from '../types/story'

export function normalizeStoryPublicationStatus(
  publication: StoryPublicationState | null | undefined,
  visibility: StoryGameVisibility,
): StoryPublicationStatus {
  const status = publication?.status
  if (status === 'pending' || status === 'approved' || status === 'rejected') {
    return status
  }
  return visibility === 'public' ? 'approved' : 'none'
}

export function resolvePublicationDraftVisibility(
  publication: StoryPublicationState | null | undefined,
  visibility: StoryGameVisibility,
): StoryGameVisibility {
  return normalizeStoryPublicationStatus(publication, visibility) === 'none' ? 'private' : 'public'
}
