import { createReactBlockSpec } from "@blocknote/react";

const db = createReactBlockSpec(
    {
        type: "database",
        propSchema: { folder: { default: "Notes" } },
        content: "none"
    },
    { render: () => null }
);
console.log(typeof db, Object.keys(db));
