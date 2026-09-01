import type { Dictionary } from '@blocknote/core';

export const blocknoteCa: Dictionary = {
  slash_menu: {
    heading: {
      title: "Encapçalament 1",
      subtext: "Encapçalament de primer nivell",
      aliases: ["h", "encapcalament1", "h1"],
      group: "Encapçalaments",
    },
    heading_2: {
      title: "Encapçalament 2",
      subtext: "Encapçalament de secció principal",
      aliases: ["h2", "encapcalament2", "subencapcalament"],
      group: "Encapçalaments",
    },
    heading_3: {
      title: "Encapçalament 3",
      subtext: "Encapçalament de subsecció i grup",
      aliases: ["h3", "encapcalament3", "subencapcalament"],
      group: "Encapçalaments",
    },
    heading_4: {
      title: "Encapçalament 4",
      subtext: "Encapçalament de subsecció menor",
      aliases: ["h4", "encapcalament4", "subencapcalament4"],
      group: "Subencapçalaments",
    },
    heading_5: {
      title: "Encapçalament 5",
      subtext: "Encapçalament de subsecció petita",
      aliases: ["h5", "encapcalament5", "subencapcalament5"],
      group: "Subencapçalaments",
    },
    heading_6: {
      title: "Encapçalament 6",
      subtext: "Encapçalament de nivell més baix",
      aliases: ["h6", "encapcalament6", "subencapcalament6"],
      group: "Subencapçalaments",
    },
    toggle_heading: {
      title: "Encapçalament Plegable 1",
      subtext: "Encapçalament de primer nivell que es pot plegar",
      aliases: ["h", "encapcalament1", "h1", "plegable", "collapsable"],
      group: "Subencapçalaments",
    },
    toggle_heading_2: {
      title: "Encapçalament Plegable 2",
      subtext: "Encapçalament de secció principal que es pot plegar",
      aliases: ["h2", "encapcalament2", "subencapcalament", "plegable"],
      group: "Subencapçalaments",
    },
    toggle_heading_3: {
      title: "Encapçalament Plegable 3",
      subtext: "Encapçalament de subsecció i grup que es pot plegar",
      aliases: ["h3", "encapcalament3", "subencapcalament", "plegable"],
      group: "Subencapçalaments",
    },
    quote: {
      title: "Citació",
      subtext: "Citació o extracte",
      aliases: ["quotation", "blockquote", "bq", "citacio"],
      group: "Blocs bàsics",
    },
    numbered_list: {
      title: "Llista Numerada",
      subtext: "Llista amb elements ordenats",
      aliases: ["ol", "li", "llista", "llista numerada"],
      group: "Blocs bàsics",
    },
    bullet_list: {
      title: "Llista amb Vinyetes",
      subtext: "Llista amb elements no ordenats",
      aliases: ["ul", "li", "llista", "llista amb vinyetes"],
      group: "Blocs bàsics",
    },
    check_list: {
      title: "Llista de Verificació",
      subtext: "Llista amb caselles de verificació",
      aliases: [
        "ul",
        "li",
        "llista",
        "llista de verificacio",
        "checklist",
        "checkbox",
      ],
      group: "Blocs bàsics",
    },
    toggle_list: {
      title: "Llista Plegable",
      subtext: "Llista amb subelements ocultables",
      aliases: ["li", "llista", "llista plegable", "llista col·lapsable"],
      group: "Blocs bàsics",
    },
    paragraph: {
      title: "Paràgraf",
      subtext: "El cos del teu document",
      aliases: ["p", "paragraf"],
      group: "Blocs bàsics",
    },
    code_block: {
      title: "Bloc de Codi",
      subtext: "Bloc de codi amb ressaltat de sintaxi",
      aliases: ["code", "pre", "codi"],
      group: "Blocs bàsics",
    },
    page_break: {
      title: "Salt de pàgina",
      subtext: "Separador de pàgina",
      aliases: ["page", "break", "separator", "salt", "separador"],
      group: "Blocs bàsics",
    },
    table: {
      title: "Taula",
      subtext: "Taula amb cel·les editables",
      aliases: ["table", "taula"],
      group: "Avançat",
    },
    image: {
      title: "Imatge",
      subtext: "Imatge redimensionable amb peu",
      aliases: [
        "imatge",
        "pujar imatge",
        "carregar",
        "img",
        "foto",
        "media",
        "url",
      ],
      group: "Multimèdia",
    },
    video: {
      title: "Vídeo",
      subtext: "Vídeo redimensionable amb peu",
      aliases: [
        "video",
        "pujar video",
        "carregar",
        "mp4",
        "pel·lícula",
        "media",
        "url",
      ],
      group: "Multimèdia",
    },
    audio: {
      title: "Àudio",
      subtext: "Àudio incrustat amb peu",
      aliases: [
        "audio",
        "pujar audio",
        "carregar",
        "mp3",
        "so",
        "media",
        "url",
      ],
      group: "Multimèdia",
    },
    file: {
      title: "Fitxer",
      subtext: "Fitxer incrustat",
      aliases: ["fitxer", "carregar", "incrustar", "media", "url"],
      group: "Multimèdia",
    },
    emoji: {
      title: "Emoji",
      subtext: "Cerca i insereix un emoji",
      aliases: ["emoji", "emoticona", "emoció", "cara"],
      group: "Altres",
    },
    divider: {
      title: "Divisor",
      subtext: "Separador visual de blocs",
      aliases: ["divisor", "hr", "horizontal rule", "linia"],
      group: "Blocs bàsics",
    },
  },
  placeholders: {
    default: "Escriu o tecleja '/' per a comandes",
    heading: "Encapçalament",
    toggleListItem: "Plegable",
    bulletListItem: "Llista",
    numberedListItem: "Llista",
    checkListItem: "Llista",
    new_comment: "Escriu un comentari...",
    edit_comment: "Edita el comentari...",
    comment_reply: "Afegeix un comentari...",
  },
  file_blocks: {
    add_button_text: {
      image: "Afegir imatge",
      video: "Afegir vídeo",
      audio: "Afegir àudio",
      file: "Afegir fitxer",
    },
  },
  toggle_blocks: {
    add_block_button: "Plegable buit. Fes clic per afegir un bloc.",
  },
  code_block: {
    add_source_button_text: "Afegeix codi font",
    ok_button_text: "D'acord",
  },
  side_menu: {
    add_block_label: "Afegir bloc",
    drag_handle_label: "Obrir menú del bloc",
  },
  drag_handle: {
    delete_menuitem: "Elimina",
    colors_menuitem: "Colors",
    header_row_menuitem: "Fila d'encapçalament",
    header_column_menuitem: "Columna d'encapçalament",
  },
  table_handle: {
    delete_column_menuitem: "Elimina columna",
    delete_row_menuitem: "Elimina fila",
    add_left_menuitem: "Afegir columna a l'esquerra",
    add_right_menuitem: "Afegir columna a la dreta",
    add_above_menuitem: "Afegir fila a sobre",
    add_below_menuitem: "Afegir fila a sota",
    split_cell_menuitem: "Divideix cel·la",
    merge_cells_menuitem: "Fusiona cel·les",
    background_color_menuitem: "Color de fons",
  },
  suggestion_menu: {
    no_items_title: "No s'han trobat elements",
  },
  color_picker: {
    text_title: "Text",
    background_title: "Fons",
    colors: {
      default: "Per defecte",
      gray: "Gris",
      brown: "Marró",
      red: "Vermell",
      orange: "Taronja",
      yellow: "Groc",
      green: "Verd",
      blue: "Blau",
      purple: "Lila",
      pink: "Rosa",
    },
  },
  formatting_toolbar: {
    bold: {
      tooltip: "Negreta",
      secondary_tooltip: "Mod+B",
    },
    italic: {
      tooltip: "Cursiva",
      secondary_tooltip: "Mod+I",
    },
    underline: {
      tooltip: "Subratllat",
      secondary_tooltip: "Mod+U",
    },
    strike: {
      tooltip: "Barrat",
      secondary_tooltip: "Mod+Shift+S",
    },
    code: {
      tooltip: "Codi",
      secondary_tooltip: "",
    },
    colors: {
      tooltip: "Colors",
    },
    link: {
      tooltip: "Crear enllaç",
      secondary_tooltip: "Mod+K",
    },
    file_caption: {
      tooltip: "Edita el peu",
      input_placeholder: "Edita el peu",
    },
    file_replace: {
      tooltip: {
        image: "Reemplaça la imatge",
        video: "Reemplaça el vídeo",
        audio: "Reemplaça l'àudio",
        file: "Reemplaça el fitxer",
      },
    },
    file_rename: {
      tooltip: {
        image: "Reanomena la imatge",
        video: "Reanomena el vídeo",
        audio: "Reanomena l'àudio",
        file: "Reanomena el fitxer",
      },
      input_placeholder: {
        image: "Reanomena la imatge",
        video: "Reanomena el vídeo",
        audio: "Reanomena l'àudio",
        file: "Reanomena el fitxer",
      },
    },
    file_download: {
      tooltip: {
        image: "Baixa la imatge",
        video: "Baixa el vídeo",
        audio: "Baixa l'àudio",
        file: "Baixa el fitxer",
      },
    },
    file_delete: {
      tooltip: {
        image: "Elimina la imatge",
        video: "Elimina el vídeo",
        audio: "Elimina l'àudio",
        file: "Elimina el fitxer",
      },
    },
    file_preview_toggle: {
      tooltip: "Alterna la vista prèvia",
    },
    nest: {
      tooltip: "Imbrica el bloc",
      secondary_tooltip: "Tab",
    },
    unnest: {
      tooltip: "Desimbrica el bloc",
      secondary_tooltip: "Shift+Tab",
    },
    align_left: {
      tooltip: "Alinea el text a l'esquerra",
    },
    align_center: {
      tooltip: "Alinea el text al centre",
    },
    align_right: {
      tooltip: "Alinea el text a la dreta",
    },
    align_justify: {
      tooltip: "Justifica el text",
    },
    table_cell_merge: {
      tooltip: "Fusiona cel·les",
    },
    comment: {
      tooltip: "Afegeix un comentari",
    },
  },
  file_panel: {
    upload: {
      title: "Pujar",
      file_placeholder: {
        image: "Puja la imatge",
        video: "Puja el vídeo",
        audio: "Puja l'àudio",
        file: "Puja el fitxer",
      },
      upload_error: "Error: la pujada ha fallat",
    },
    embed: {
      title: "Incrustar",
      embed_button: {
        image: "Incrusta la imatge",
        video: "Incrusta el vídeo",
        audio: "Incrusta l'àudio",
        file: "Incrusta el fitxer",
      },
      url_placeholder: "Introdueix la URL",
    },
  },
  link_toolbar: {
    delete: {
      tooltip: "Elimina l'enllaç",
    },
    edit: {
      text: "Edita l'enllaç",
      tooltip: "Edita",
    },
    open: {
      tooltip: "Obre en una pestanya nova",
    },
    form: {
      title_placeholder: "Edita el títol",
      url_placeholder: "Edita la URL",
    },
  },
  comments: {
    edited: "editat",
    save_button_text: "Desa",
    cancel_button_text: "Cancel·la",
    deleted_reference_text: "S'ha suprimit el contingut original",
    discard_pending_comment: "Segur que vols descartar aquest comentari?",
    actions: {
      add_reaction: "Afegeix una reacció",
      resolve: "Resol",
      reopen: "Torna a obrir",
      edit_comment: "Edita el comentari",
      delete_comment: "Elimina el comentari",
      more_actions: "Més accions",
    },
    reactions: {
      reacted_by: "Reaccionat per",
    },
    sidebar: {
      marked_as_resolved: "Marcat com a resolt",
      more_replies: (count) => `${String(count)} respostes més`,
    },
  },
  suggestion_changes: {
    formatting_change: "Canvi de format",
    deleted: "Suprimit",
    inserted_by: (users) => `Inserit per: ${users}`,
    deleted_by: (users) => `Suprimit per: ${users}`,
    formatting_change_by: (formats, users) =>
      `Canvi de format (${formats}) fet per: ${users}`,
  },
  exporter: {
    open_file: "Obre el fitxer",
    open_video_file: "Obre el vídeo",
    open_audio_file: "Obre l'àudio",
  },
  generic: {
    ctrl_shortcut: "Ctrl",
  },
};
