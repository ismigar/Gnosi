import { filterSuggestionItems } from "@blocknote/react";

const customItems = [
    {
        title: "Taula (Database)",
        subtext: "Encasta una taula d'una carpeta del Vault",
        aliases: ["table", "db", "llista"],
        group: "Bases de Dades",
        icon: "icon",
        onItemClick: () => {},
    }
];

try {
    const res = filterSuggestionItems(customItems, "tau");
    console.log("Filtered items:", res.length);
} catch (e) {
    console.error("Error:", e.message);
}
