import { BlockNoteEditor } from "@blocknote/core";

async function run() {
  const editor = BlockNoteEditor.create();
  const md1 = `- Item 1\n  Child paragraph`;
  const md2 = `- Item 1\n\n  Child paragraph`;
  const md3 = `- Item 1\n  - Child item`;
  const md4 = `- Item 1  \n  Soft break`;
  
  console.log("MD1:", JSON.stringify(await editor.tryParseMarkdownToBlocks(md1), null, 2));
  console.log("MD2:", JSON.stringify(await editor.tryParseMarkdownToBlocks(md2), null, 2));
  console.log("MD3:", JSON.stringify(await editor.tryParseMarkdownToBlocks(md3), null, 2));
  console.log("MD4:", JSON.stringify(await editor.tryParseMarkdownToBlocks(md4), null, 2));
}

run();
