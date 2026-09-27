/** A personal alias replaces all route and recommendation text in model choices. */
export function modelDisplayName(model: {
    readonly alias?: string | null;
    readonly name?: string;
    readonly model_id?: string;
} | undefined): string {
    return model?.alias?.trim() || model?.name || model?.model_id || '';
}
