export const TOGGLE_BOOKMARK_DIALOG_MESSAGE = "bookmarkGallery.toggleDialog";
export const OPEN_BOOKMARK_GALLERY_COMMAND = "open-bookmark-gallery";

export interface ToggleBookmarkDialogMessage {
  type: typeof TOGGLE_BOOKMARK_DIALOG_MESSAGE;
}

export function isToggleBookmarkDialogMessage(
  message: unknown,
): message is ToggleBookmarkDialogMessage {
  return (
    !!message &&
    typeof message === "object" &&
    (message as { type?: unknown }).type === TOGGLE_BOOKMARK_DIALOG_MESSAGE
  );
}
