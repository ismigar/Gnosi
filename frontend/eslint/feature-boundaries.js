import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function partsWithin(root, target) {
  const path = relative(root, target);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return null;
  return path.split(sep);
}

function importText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return null;
}

/** Enforce public feature entry points without resolving or executing modules. */
export default {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { sourceRoot: { type: 'string' } }, required: ['sourceRoot'], additionalProperties: false }],
    messages: {
      privateFeature: 'Importa només l’entrada pública de la feature {{feature}}, no {{path}}.',
      sharedDependency: 'shared no pot dependre d’app ni de features: {{path}}.',
      appDependency: 'Una feature no pot dependre de la composició app: {{path}}.',
    },
  },
  create(context) {
    const root = context.options[0].sourceRoot;
    const filename = context.filename;
    const owner = partsWithin(root, filename);
    if (!owner) return {};

    function inspect(node) {
      const imported = importText(node);
      if (!imported) return;
      const path = imported.split(/[?#]/u)[0];
      const target = path.startsWith('@/')
        ? resolve(root, path.slice(2))
        : path.startsWith('.') ? resolve(dirname(filename), path) : null;
      if (!target) return;
      const parts = partsWithin(root, target);
      if (!parts) return;
      let messageId;
      if (owner[0] === 'shared' && ['app', 'features'].includes(parts[0])) {
        messageId = 'sharedDependency';
      } else if (owner[0] === 'features' && parts[0] === 'app') {
        messageId = 'appDependency';
      } else if (parts[0] === 'features' && parts.length >= 2) {
        const sameFeature = owner[0] === 'features' && owner[1] === parts[1];
        const publicEntry = parts.length === 2
          || (parts.length === 3 && /^index(?:\.[jt]sx?)?$/u.test(parts[2]));
        if (!sameFeature && !publicEntry) messageId = 'privateFeature';
      }
      if (messageId) context.report({ node, messageId, data: { path: imported, feature: parts[1] } });
    }

    return {
      ImportDeclaration: node => inspect(node.source),
      ExportNamedDeclaration: node => inspect(node.source),
      ExportAllDeclaration: node => inspect(node.source),
      ImportExpression: node => inspect(node.source),
      TSImportType: node => inspect(node.source),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') inspect(node.arguments[0]);
      },
    };
  },
};
