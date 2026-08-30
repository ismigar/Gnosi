import {
    defineStorageKey,
    readStorage,
    stringStorageCodec,
} from '../../../../shared/platform/browser-storage';


export const commentAuthorStorageKey = defineStorageKey(
    'gnosi_user_email',
    stringStorageCodec,
);


export function currentCommentAuthor(storage?: Storage | null): string {
    const email = readStorage(commentAuthorStorageKey, storage) ?? '';
    if (!email) return 'Anònim';
    return email.split('@')[0] ?? 'Anònim';
}
