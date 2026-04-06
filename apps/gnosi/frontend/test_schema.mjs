import { createReactBlockSpec } from "@blocknote/react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";

const DatabaseBlock = createReactBlockSpec(
    {
        type: "database",
        propSchema: { folder: { default: "Notes" } },
        content: "none"
    },
    { render: () => null }
);

try {
    const schema1 = BlockNoteSchema.create({
        blockSpecs: {
            ...defaultBlockSpecs,
            database: DatabaseBlock,
        }
    });
    console.log("schema1 created successfully");
} catch (e) {
    console.error("schema1 failed:", e.message);
}

try {
    const schema2 = BlockNoteSchema.create({
        blockSpecs: {
            ...defaultBlockSpecs,
            database: DatabaseBlock(),
        }
    });
    console.log("schema2 created successfully");
} catch (e) {
    console.error("schema2 failed:", e.message);
}
