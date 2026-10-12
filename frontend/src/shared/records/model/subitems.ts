interface SubitemView {
    readonly id?: unknown;
    readonly table_id?: unknown;
    readonly source_table_id?: unknown;
    readonly is_main?: unknown;
    readonly is_default?: unknown;
    readonly enableSubitems?: unknown;
    readonly enable_subitems?: unknown;
}

function configuredSubitems(view: SubitemView | null | undefined): boolean | undefined {
    if (typeof view?.enableSubitems === 'boolean') return view.enableSubitems;
    if (typeof view?.enable_subitems === 'boolean') return view.enable_subitems;
    return undefined;
}

/** Table settings are stored on its main view; other views inherit unless explicitly overridden. */
export function resolveSubitemsEnabled(view: SubitemView | null | undefined, views: readonly SubitemView[], tableId?: unknown): boolean {
    const configured = configuredSubitems(view);
    if (configured !== undefined) return configured;
    const sourceTableId = tableId ?? view?.source_table_id ?? view?.table_id;
    if (typeof sourceTableId !== 'string' || !sourceTableId) return false;
    const main = views.find(candidate => candidate.table_id === sourceTableId
        && (candidate.is_main === true || candidate.is_default === true || candidate.id === 'default'));
    return configuredSubitems(main) ?? false;
}
