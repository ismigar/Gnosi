const RESOURCE_TEMPLATE_ICONS = Object.freeze({
    'Article de revista acadèmica': '📄',
    'Article divulgatiu': '📢',
    'Article enciclopèdic': '📚',
    "Capítol d'un llibre": '📑',
    Curs: '👨‍🏫',
    Document: '📄',
    Eines: '🛠️',
    'Entrevista/testimoni': '🎙️',
    'Extracte llibre': '📑',
    Fragment: '🔖',
    Genèric: '📄',
    Infografia: '🖼️',
    Llibre: '📖',
    Manual: '📘',
    Manifest: '✊',
    "Objecte d'anàlisi simbòlica": '🧜🏼‍♂️',
    'Pàgina web': '🌐',
    Ponència: '🎤',
    Relat: '✍️',
    Revista: '📰',
    'Ruta en bici': '🚴',
    Tesi: '📜',
    Vídeo: '🎬',
});

/**
 * Resolves the icon displayed in a template menu.
 *
 * Older table responses can expose a page icon under a translated property
 * name, or omit it during the first cache refresh. The item-type fallback
 * preserves a distinct icon for every Resource template in either case.
 */
export function getTemplateMenuIcon(template) {
    const metadata = template?.metadata || {};
    const explicitIcon = metadata.icon || metadata.Icon || metadata.Icona || template?.icon;
    if (explicitIcon) return explicitIcon;

    const itemType = metadata['Item Type'] || metadata.item_type || metadata.itemType || template?.title;
    return RESOURCE_TEMPLATE_ICONS[itemType] || '📄';
}
