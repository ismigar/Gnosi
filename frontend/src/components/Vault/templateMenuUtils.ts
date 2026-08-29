const RESOURCE_TEMPLATE_ICONS: Readonly<Record<string, string>> =
  Object.freeze({
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

interface TemplateMenuMetadata {
  'Item Type'?: string | null;
  Icon?: string | null;
  Icona?: string | null;
  icon?: string | null;
  itemType?: string | null;
  item_type?: string | null;
}

interface TemplateMenuItem {
  icon?: string | null;
  metadata?: TemplateMenuMetadata | null;
  title?: string | null;
}

/** Resolves the icon displayed in a template menu. */
export function getTemplateMenuIcon(
  template?: TemplateMenuItem | null,
): string {
  const metadata = template?.metadata || {};
  const explicitIcon =
    metadata.icon || metadata.Icon || metadata.Icona || template?.icon;
  if (explicitIcon) return explicitIcon;

  const itemType =
    metadata['Item Type'] ||
    metadata.item_type ||
    metadata.itemType ||
    template?.title;
  return (itemType ? RESOURCE_TEMPLATE_ICONS[itemType] : undefined) || '📄';
}
