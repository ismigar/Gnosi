import { dirname, resolve } from 'node:path';

const staticValue = attribute => {
  const value = attribute?.value;
  if (!value) return true;
  if (value.type === 'Literal') return value.value;
  if (value.type === 'JSXExpressionContainer' && value.expression.type === 'Literal') return value.expression.value;
  return undefined;
};

/** Every blocking declaration owns an explicit, pane-aware body portal. */
export default {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { sourceRoot: { type: 'string' } }, required: ['sourceRoot'], additionalProperties: false }],
    messages: {
      layer: 'Render blocking dialogs inside the shared ModalPortal; inline or generic portals can be clipped or block clicks.',
      modality: 'Declare aria-modal=false for nonblocking panels, or aria-modal=true inside ModalPortal for blocking dialogs.',
    },
  },
  create(context) {
    if (/\.(?:test|spec)\.[jt]sx?$/u.test(context.filename)) return {};
    const root = context.options[0].sourceRoot;
    const canonical = resolve(root, 'shared/ui/ModalPortal');
    const modalNames = new Set();
    const otherPortals = new Set();
    const portalCalls = new Set();
    const target = imported => imported.startsWith('@/')
      ? resolve(root, imported.slice(2)) : resolve(dirname(context.filename), imported);
    function hosted(node) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === 'JSXElement') {
          const name = parent.openingElement.name;
          if (name.type === 'JSXIdentifier' && modalNames.has(name.name)) return true;
          if ((name.type === 'JSXIdentifier' && otherPortals.has(name.name))
              || (name.type === 'JSXMemberExpression' && name.property.name === 'Portal')) return false;
        }
        if (parent.type === 'CallExpression' && parent.callee.type === 'Identifier' && portalCalls.has(parent.callee.name)) return false;
      }
      return false;
    }
    return {
      ImportDeclaration(node) {
        const imported = String(node.source.value);
        const isCanonical = target(imported).replace(/\.[jt]sx?$/u, '') === canonical;
        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const name = specifier.imported.name ?? specifier.imported.value;
          if (isCanonical && name === 'ModalPortal') modalNames.add(specifier.local.name);
          if (name === 'PanePortal') otherPortals.add(specifier.local.name);
          if ((name === 'createPortal' && imported === 'react-dom') || name === 'createPanePortal') portalCalls.add(specifier.local.name);
        }
      },
      JSXOpeningElement(node) {
        const attributes = node.attributes.filter(attribute => attribute.type === 'JSXAttribute');
        const aria = attributes.find(attribute => attribute.name.name === 'aria-modal');
        const role = staticValue(attributes.find(attribute => attribute.name.name === 'role'));
        if (!aria && (role === 'dialog' || role === 'alertdialog' || node.name.name === 'dialog')) {
          context.report({ node, messageId: 'modality' });
        } else if (aria && ![false, 'false'].includes(staticValue(aria)) && !hosted(node)) {
          context.report({ node, messageId: 'layer' });
        }
      },
    };
  },
};
