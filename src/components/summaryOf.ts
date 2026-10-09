import type { Note, NoteSummary } from '../types/ipc';

/* The list-facing half of a `Note`: exactly the fields `notes_list` returns.

   A projection rather than a spread, so a document cannot reach the note list by
   accident. `02-architecture.md` §8 requires the list never to carry a body, and the
   cheapest way to keep that true is to make it impossible to write one rather than
   to remember not to.

   Its own module because two components patch the list from a save response and both
   must patch it the same way. A projection that existed twice would let one of them
   quietly stop covering a field — which is exactly what happened when the pin was
   added: the editor's patch did not carry `isPinned`, so a card kept showing a pin
   the note no longer had until the next refetch. `NoteCard.pin.test.tsx` asserts the
   pin survives a plain document save for that reason. */
export function summaryOf(note: Note): NoteSummary {
  const { id, title, excerpt, folderId, folderName, isPinned, wordCount, updatedAt, tags } = note;
  return { id, title, excerpt, folderId, folderName, isPinned, wordCount, updatedAt, tags };
}