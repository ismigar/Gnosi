import {
  $e,
  U,
  Xt as Xt2,
  f as f2,
  h
} from "./chunk-IO4LENIE.js";
import {
  $n,
  A,
  Ao,
  Ao2,
  Bo,
  Bt,
  Cn,
  Co,
  D,
  D2,
  F2 as F,
  H2 as H,
  L2 as L,
  Le,
  Lo,
  Nn,
  No,
  No2,
  O,
  Oe,
  Pn,
  Qt,
  R,
  Ro,
  S,
  T,
  To,
  Tt2 as Tt,
  Vn,
  Vo,
  Vt,
  W,
  Wt,
  Xt,
  Yo,
  Zt,
  _o,
  a,
  b,
  b2,
  bo,
  f,
  fo,
  getRelativeSelection,
  kt2 as kt,
  m,
  nn,
  on,
  wt,
  wt2,
  xt,
  ySyncPluginKey,
  yt,
  zo
} from "./chunk-ZCA3YKET.js";
import {
  autoPlacement,
  autoUpdate,
  flip,
  floor,
  getComputedStyle as getComputedStyle2,
  getNodeName,
  getOverflowAncestors,
  getParentNode,
  getWindow,
  isElement,
  isHTMLElement,
  isLastTraversableNode,
  isShadowRoot,
  isWebKit,
  offset,
  require_jsx_runtime,
  shift,
  size,
  useFloating
} from "./chunk-CNM4UREI.js";
import {
  require_client
} from "./chunk-OD724U3G.js";
import {
  require_shim
} from "./chunk-EXDYR63E.js";
import {
  Decoration,
  DecorationSet,
  Mark,
  MarkView,
  Node3,
  NodeView,
  Plugin,
  PluginKey,
  getRenderedAttributes,
  mergeAttributes,
  posToDOMRect
} from "./chunk-V7Y3ZQ2C.js";
import {
  require_react_dom
} from "./chunk-7I2UKMSJ.js";
import {
  require_react
} from "./chunk-P6RTVJOB.js";
import {
  __commonJS,
  __toESM
} from "./chunk-G3PMV62Z.js";

// node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js
var require_with_selector_development = __commonJS({
  "node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js"(exports) {
    "use strict";
    (function() {
      function is(x2, y2) {
        return x2 === y2 && (0 !== x2 || 1 / x2 === 1 / y2) || x2 !== x2 && y2 !== y2;
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React5 = require_react(), shim = require_shim(), objectIs = "function" === typeof Object.is ? Object.is : is, useSyncExternalStore3 = shim.useSyncExternalStore, useRef4 = React5.useRef, useEffect4 = React5.useEffect, useMemo3 = React5.useMemo, useDebugValue3 = React5.useDebugValue;
      exports.useSyncExternalStoreWithSelector = function(subscribe, getSnapshot, getServerSnapshot, selector, isEqual) {
        var instRef = useRef4(null);
        if (null === instRef.current) {
          var inst = { hasValue: false, value: null };
          instRef.current = inst;
        } else inst = instRef.current;
        instRef = useMemo3(
          function() {
            function memoizedSelector(nextSnapshot) {
              if (!hasMemo) {
                hasMemo = true;
                memoizedSnapshot = nextSnapshot;
                nextSnapshot = selector(nextSnapshot);
                if (void 0 !== isEqual && inst.hasValue) {
                  var currentSelection = inst.value;
                  if (isEqual(currentSelection, nextSnapshot))
                    return memoizedSelection = currentSelection;
                }
                return memoizedSelection = nextSnapshot;
              }
              currentSelection = memoizedSelection;
              if (objectIs(memoizedSnapshot, nextSnapshot))
                return currentSelection;
              var nextSelection = selector(nextSnapshot);
              if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
                return memoizedSnapshot = nextSnapshot, currentSelection;
              memoizedSnapshot = nextSnapshot;
              return memoizedSelection = nextSelection;
            }
            var hasMemo = false, memoizedSnapshot, memoizedSelection, maybeGetServerSnapshot = void 0 === getServerSnapshot ? null : getServerSnapshot;
            return [
              function() {
                return memoizedSelector(getSnapshot());
              },
              null === maybeGetServerSnapshot ? void 0 : function() {
                return memoizedSelector(maybeGetServerSnapshot());
              }
            ];
          },
          [getSnapshot, getServerSnapshot, selector, isEqual]
        );
        var value = useSyncExternalStore3(subscribe, instRef[0], instRef[1]);
        useEffect4(
          function() {
            inst.hasValue = true;
            inst.value = value;
          },
          [value]
        );
        useDebugValue3(value);
        return value;
      };
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    })();
  }
});

// node_modules/use-sync-external-store/shim/with-selector.js
var require_with_selector = __commonJS({
  "node_modules/use-sync-external-store/shim/with-selector.js"(exports, module) {
    "use strict";
    if (false) {
      module.exports = null;
    } else {
      module.exports = require_with_selector_development();
    }
  }
});

// node_modules/@blocknote/react/dist/blocknote-react.js
var import_react12 = __toESM(require_react());
var import_jsx_runtime10 = __toESM(require_jsx_runtime());

// node_modules/@blocknote/core/dist/comments.js
var x = Object.defineProperty;
var Y = (r, d, e2) => d in r ? x(r, d, { enumerable: true, configurable: true, writable: true, value: e2 }) : r[d] = e2;
var c = (r, d, e2) => Y(r, typeof d != "symbol" ? d + "" : d, e2);
var M = Mark.create({
  name: "comment",
  excludes: "",
  inclusive: false,
  keepOnSplit: true,
  addAttributes() {
    return {
      // orphans are marks that currently don't have an active thread. It could be
      // that users have resolved the thread. Resolved threads by default are not shown in the document,
      // but we need to keep the mark (positioning) data so we can still "revive" it when the thread is unresolved
      // or we enter a "comments" view that includes resolved threads.
      orphan: {
        parseHTML: (r) => !!r.getAttribute("data-orphan"),
        renderHTML: (r) => r.orphan ? {
          "data-orphan": "true"
        } : {},
        default: false
      },
      threadId: {
        parseHTML: (r) => r.getAttribute("data-bn-thread-id"),
        renderHTML: (r) => ({
          "data-bn-thread-id": r.threadId
        }),
        default: ""
      }
    };
  },
  renderHTML({ HTMLAttributes: r }) {
    return [
      "span",
      mergeAttributes(r, {
        class: "bn-thread-mark"
      })
    ];
  },
  parseHTML() {
    return [{ tag: "span.bn-thread-mark" }];
  },
  extendMarkSchema(r) {
    return r.name === "comment" ? {
      blocknoteIgnore: true
    } : {};
  }
});
var F2 = class extends f2 {
  constructor(e2) {
    super();
    c(this, "userCache", /* @__PURE__ */ new Map());
    c(this, "loadingUsers", /* @__PURE__ */ new Set());
    this.resolveUsers = e2;
  }
  /**
   * Load information about users based on an array of user ids.
   */
  async loadUsers(e2) {
    const t = e2.filter(
      (a2) => !this.userCache.has(a2) && !this.loadingUsers.has(a2)
    );
    if (t.length !== 0) {
      for (const a2 of t)
        this.loadingUsers.add(a2);
      try {
        const a2 = await this.resolveUsers(t);
        for (const s of a2)
          this.userCache.set(s.id, s);
        this.emit("update", this.userCache);
      } finally {
        for (const a2 of t)
          this.loadingUsers.delete(a2);
      }
    }
  }
  /**
   * Retrieve information about a user based on their id, if cached.
   *
   * The user will have to be loaded via `loadUsers` first
   */
  getUser(e2) {
    return this.userCache.get(e2);
  }
  /**
   * Subscribe to changes in the user store.
   *
   * @param cb - The callback to call when the user store changes.
   * @returns A function to unsubscribe from the user store.
   */
  subscribe(e2) {
    return this.on("update", e2);
  }
};
var w = new PluginKey("blocknote-comments");
function K(r, d) {
  const e2 = /* @__PURE__ */ new Map();
  return r.descendants((t, a2) => {
    t.marks.forEach((s) => {
      if (s.type.name === d) {
        const o = s.attrs.threadId;
        if (!o)
          return;
        const m2 = a2, n = m2 + t.nodeSize, i = e2.get(o) ?? {
          from: 1 / 0,
          to: 0
        };
        e2.set(o, {
          from: Math.min(m2, i.from),
          to: Math.max(n, i.to)
        });
      }
    });
  }), e2;
}
var ne = a(
  ({
    editor: r,
    options: { schema: d, threadStore: e2, resolveUsers: t }
  }) => {
    if (!t)
      throw new Error(
        "resolveUsers is required to be defined when using comments"
      );
    if (!e2)
      throw new Error(
        "threadStore is required to be defined when using comments"
      );
    const a2 = M.name, s = new F2(t), o = f(
      {
        pendingComment: false,
        selectedThreadId: void 0,
        threadPositions: /* @__PURE__ */ new Map()
      },
      {
        onUpdate() {
          o.state.selectedThreadId !== o.prevState.selectedThreadId && r.transact((n) => n.setMeta(w, true));
        }
      }
    ), m2 = (n) => {
      r.transact((i) => {
        i.doc.descendants((u, l2) => {
          u.marks.forEach((h2) => {
            if (h2.type.name === a2) {
              const T3 = h2.type, f3 = h2.attrs.threadId, A2 = n.get(f3), v2 = !!(!A2 || A2.resolved || A2.deletedAt);
              if (v2 !== h2.attrs.orphan) {
                const E = Math.max(l2, 0), b3 = Math.min(
                  l2 + u.nodeSize,
                  i.doc.content.size - 1,
                  i.doc.content.size - 1
                );
                i.removeMark(E, b3, h2), i.addMark(
                  E,
                  b3,
                  T3.create({
                    ...h2.attrs,
                    orphan: v2
                  })
                ), v2 && o.state.selectedThreadId === f3 && o.setState((P) => ({
                  ...P,
                  selectedThreadId: void 0
                }));
              }
            }
          });
        });
      });
    };
    return {
      key: "comments",
      store: o,
      prosemirrorPlugins: [
        new Plugin({
          key: w,
          state: {
            init() {
              return {
                decorations: DecorationSet.empty
              };
            },
            apply(n, i) {
              const u = n.getMeta(w);
              if (!n.docChanged && !u)
                return i;
              const l2 = n.docChanged ? K(n.doc, a2) : o.state.threadPositions;
              (l2.size > 0 || o.state.threadPositions.size > 0) && o.setState((T3) => ({
                ...T3,
                threadPositions: l2
              }));
              const h2 = [];
              if (o.state.selectedThreadId) {
                const T3 = l2.get(
                  o.state.selectedThreadId
                );
                T3 && h2.push(
                  Decoration.inline(
                    T3.from,
                    T3.to,
                    {
                      class: "bn-thread-mark-selected"
                    }
                  )
                );
              }
              return {
                decorations: DecorationSet.create(n.doc, h2)
              };
            }
          },
          props: {
            decorations(n) {
              var i;
              return ((i = w.getState(n)) == null ? void 0 : i.decorations) ?? DecorationSet.empty;
            },
            handleClick: (n, i, u) => {
              if (u.button !== 0)
                return;
              const l2 = n.state.doc.nodeAt(i);
              if (!l2) {
                o.setState((f3) => ({
                  ...f3,
                  selectedThreadId: void 0
                }));
                return;
              }
              const h2 = l2.marks.find(
                (f3) => f3.type.name === a2 && f3.attrs.orphan !== true
              ), T3 = h2 == null ? void 0 : h2.attrs.threadId;
              T3 !== o.state.selectedThreadId && o.setState((f3) => ({
                ...f3,
                selectedThreadId: T3
              }));
            }
          }
        })
      ],
      threadStore: e2,
      mount() {
        const n = e2.subscribe(m2);
        m2(e2.getThreads());
        const i = r.onSelectionChange(() => {
          o.state.pendingComment && o.setState((u) => ({
            ...u,
            pendingComment: false
          }));
        });
        return () => {
          n(), i();
        };
      },
      selectThread(n, i = true) {
        var u, l2;
        if (o.state.selectedThreadId !== n && (o.setState((h2) => ({
          ...h2,
          pendingComment: false,
          selectedThreadId: n
        })), n && i)) {
          const h2 = o.state.threadPositions.get(n);
          if (!h2)
            return;
          (l2 = (u = r.prosemirrorView) == null ? void 0 : u.domAtPos(h2.from).node) == null || l2.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
      },
      startPendingComment() {
        var n;
        o.setState((i) => ({
          ...i,
          selectedThreadId: void 0,
          pendingComment: true
        })), (n = r.getExtension(b2)) == null || n.showSelection(true, "comments");
      },
      stopPendingComment() {
        var n;
        o.setState((i) => ({
          ...i,
          selectedThreadId: void 0,
          pendingComment: false
        })), (n = r.getExtension(b2)) == null || n.showSelection(false, "comments");
      },
      async createThread(n) {
        const i = await e2.createThread(n);
        if (e2.addThreadToDocument) {
          const u = r.prosemirrorView, l2 = u.state.selection, h2 = ySyncPluginKey.getState(u.state), T3 = {
            prosemirror: {
              head: l2.head,
              anchor: l2.anchor
            },
            yjs: h2 ? getRelativeSelection(h2.binding, u.state) : void 0
          };
          await e2.addThreadToDocument({
            threadId: i.id,
            selection: T3
          });
        } else
          r._tiptapEditor.commands.setMark(a2, {
            orphan: false,
            threadId: i.id
          });
      },
      userStore: s,
      commentEditorSchema: d,
      tiptapExtensions: [M]
    };
  }
);

// node_modules/@floating-ui/react/dist/floating-ui.react.mjs
var React2 = __toESM(require_react(), 1);

// node_modules/@floating-ui/react/dist/floating-ui.react.utils.mjs
var React = __toESM(require_react(), 1);
var import_react = __toESM(require_react(), 1);

// node_modules/tabbable/dist/index.esm.js
var candidateSelectors = ["input:not([inert]):not([inert] *)", "select:not([inert]):not([inert] *)", "textarea:not([inert]):not([inert] *)", "a[href]:not([inert]):not([inert] *)", "button:not([inert]):not([inert] *)", "[tabindex]:not(slot):not([inert]):not([inert] *)", "audio[controls]:not([inert]):not([inert] *)", "video[controls]:not([inert]):not([inert] *)", '[contenteditable]:not([contenteditable="false"]):not([inert]):not([inert] *)', "details>summary:first-of-type:not([inert]):not([inert] *)", "details:not([inert]):not([inert] *)"];
var candidateSelector = candidateSelectors.join(",");
var NoElement = typeof Element === "undefined";
var matches = NoElement ? function() {
} : Element.prototype.matches || Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
var getRootNode = !NoElement && Element.prototype.getRootNode ? function(element) {
  var _element$getRootNode;
  return element === null || element === void 0 ? void 0 : (_element$getRootNode = element.getRootNode) === null || _element$getRootNode === void 0 ? void 0 : _element$getRootNode.call(element);
} : function(element) {
  return element === null || element === void 0 ? void 0 : element.ownerDocument;
};
var _isInert = function isInert(node, lookUp) {
  var _node$getAttribute;
  if (lookUp === void 0) {
    lookUp = true;
  }
  var inertAtt = node === null || node === void 0 ? void 0 : (_node$getAttribute = node.getAttribute) === null || _node$getAttribute === void 0 ? void 0 : _node$getAttribute.call(node, "inert");
  var inert = inertAtt === "" || inertAtt === "true";
  var result = inert || lookUp && node && // closest does not exist on shadow roots, so we fall back to a manual
  // lookup upward, in case it is not defined.
  (typeof node.closest === "function" ? node.closest("[inert]") : _isInert(node.parentNode));
  return result;
};
var isContentEditable = function isContentEditable2(node) {
  var _node$getAttribute2;
  var attValue = node === null || node === void 0 ? void 0 : (_node$getAttribute2 = node.getAttribute) === null || _node$getAttribute2 === void 0 ? void 0 : _node$getAttribute2.call(node, "contenteditable");
  return attValue === "" || attValue === "true";
};
var getCandidates = function getCandidates2(el2, includeContainer, filter) {
  if (_isInert(el2)) {
    return [];
  }
  var candidates = Array.prototype.slice.apply(el2.querySelectorAll(candidateSelector));
  if (includeContainer && matches.call(el2, candidateSelector)) {
    candidates.unshift(el2);
  }
  candidates = candidates.filter(filter);
  return candidates;
};
var _getCandidatesIteratively = function getCandidatesIteratively(elements, includeContainer, options) {
  var candidates = [];
  var elementsToCheck = Array.from(elements);
  while (elementsToCheck.length) {
    var element = elementsToCheck.shift();
    if (_isInert(element, false)) {
      continue;
    }
    if (element.tagName === "SLOT") {
      var assigned = element.assignedElements();
      var content = assigned.length ? assigned : element.children;
      var nestedCandidates = _getCandidatesIteratively(content, true, options);
      if (options.flatten) {
        candidates.push.apply(candidates, nestedCandidates);
      } else {
        candidates.push({
          scopeParent: element,
          candidates: nestedCandidates
        });
      }
    } else {
      var validCandidate = matches.call(element, candidateSelector);
      if (validCandidate && options.filter(element) && (includeContainer || !elements.includes(element))) {
        candidates.push(element);
      }
      var shadowRoot = element.shadowRoot || // check for an undisclosed shadow
      typeof options.getShadowRoot === "function" && options.getShadowRoot(element);
      var validShadowRoot = !_isInert(shadowRoot, false) && (!options.shadowRootFilter || options.shadowRootFilter(element));
      if (shadowRoot && validShadowRoot) {
        var _nestedCandidates = _getCandidatesIteratively(shadowRoot === true ? element.children : shadowRoot.children, true, options);
        if (options.flatten) {
          candidates.push.apply(candidates, _nestedCandidates);
        } else {
          candidates.push({
            scopeParent: element,
            candidates: _nestedCandidates
          });
        }
      } else {
        elementsToCheck.unshift.apply(elementsToCheck, element.children);
      }
    }
  }
  return candidates;
};
var hasTabIndex = function hasTabIndex2(node) {
  return !isNaN(parseInt(node.getAttribute("tabindex"), 10));
};
var getTabIndex = function getTabIndex2(node) {
  if (!node) {
    throw new Error("No node provided");
  }
  if (node.tabIndex < 0) {
    if ((/^(AUDIO|VIDEO|DETAILS)$/.test(node.tagName) || isContentEditable(node)) && !hasTabIndex(node)) {
      return 0;
    }
  }
  return node.tabIndex;
};
var getSortOrderTabIndex = function getSortOrderTabIndex2(node, isScope) {
  var tabIndex = getTabIndex(node);
  if (tabIndex < 0 && isScope && !hasTabIndex(node)) {
    return 0;
  }
  return tabIndex;
};
var sortOrderedTabbables = function sortOrderedTabbables2(a2, b3) {
  return a2.tabIndex === b3.tabIndex ? a2.documentOrder - b3.documentOrder : a2.tabIndex - b3.tabIndex;
};
var isInput = function isInput2(node) {
  return node.tagName === "INPUT";
};
var isHiddenInput = function isHiddenInput2(node) {
  return isInput(node) && node.type === "hidden";
};
var isDetailsWithSummary = function isDetailsWithSummary2(node) {
  var r = node.tagName === "DETAILS" && Array.prototype.slice.apply(node.children).some(function(child) {
    return child.tagName === "SUMMARY";
  });
  return r;
};
var getCheckedRadio = function getCheckedRadio2(nodes, form) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].checked && nodes[i].form === form) {
      return nodes[i];
    }
  }
};
var isTabbableRadio = function isTabbableRadio2(node) {
  if (!node.name) {
    return true;
  }
  var radioScope = node.form || getRootNode(node);
  var queryRadios = function queryRadios2(name) {
    return radioScope.querySelectorAll('input[type="radio"][name="' + name + '"]');
  };
  var radioSet;
  if (typeof window !== "undefined" && typeof window.CSS !== "undefined" && typeof window.CSS.escape === "function") {
    radioSet = queryRadios(window.CSS.escape(node.name));
  } else {
    try {
      radioSet = queryRadios(node.name);
    } catch (err) {
      console.error("Looks like you have a radio button with a name attribute containing invalid CSS selector characters and need the CSS.escape polyfill: %s", err.message);
      return false;
    }
  }
  var checked = getCheckedRadio(radioSet, node.form);
  return !checked || checked === node;
};
var isRadio = function isRadio2(node) {
  return isInput(node) && node.type === "radio";
};
var isNonTabbableRadio = function isNonTabbableRadio2(node) {
  return isRadio(node) && !isTabbableRadio(node);
};
var isNodeAttached = function isNodeAttached2(node) {
  var _nodeRoot;
  var nodeRoot = node && getRootNode(node);
  var nodeRootHost = (_nodeRoot = nodeRoot) === null || _nodeRoot === void 0 ? void 0 : _nodeRoot.host;
  var attached = false;
  if (nodeRoot && nodeRoot !== node) {
    var _nodeRootHost, _nodeRootHost$ownerDo, _node$ownerDocument;
    attached = !!((_nodeRootHost = nodeRootHost) !== null && _nodeRootHost !== void 0 && (_nodeRootHost$ownerDo = _nodeRootHost.ownerDocument) !== null && _nodeRootHost$ownerDo !== void 0 && _nodeRootHost$ownerDo.contains(nodeRootHost) || node !== null && node !== void 0 && (_node$ownerDocument = node.ownerDocument) !== null && _node$ownerDocument !== void 0 && _node$ownerDocument.contains(node));
    while (!attached && nodeRootHost) {
      var _nodeRoot2, _nodeRootHost2, _nodeRootHost2$ownerD;
      nodeRoot = getRootNode(nodeRootHost);
      nodeRootHost = (_nodeRoot2 = nodeRoot) === null || _nodeRoot2 === void 0 ? void 0 : _nodeRoot2.host;
      attached = !!((_nodeRootHost2 = nodeRootHost) !== null && _nodeRootHost2 !== void 0 && (_nodeRootHost2$ownerD = _nodeRootHost2.ownerDocument) !== null && _nodeRootHost2$ownerD !== void 0 && _nodeRootHost2$ownerD.contains(nodeRootHost));
    }
  }
  return attached;
};
var isZeroArea = function isZeroArea2(node) {
  var _node$getBoundingClie = node.getBoundingClientRect(), width = _node$getBoundingClie.width, height = _node$getBoundingClie.height;
  return width === 0 && height === 0;
};
var isHidden = function isHidden2(node, _ref) {
  var displayCheck = _ref.displayCheck, getShadowRoot = _ref.getShadowRoot;
  if (displayCheck === "full-native") {
    if ("checkVisibility" in node) {
      var visible = node.checkVisibility({
        // Checking opacity might be desirable for some use cases, but natively,
        // opacity zero elements _are_ focusable and tabbable.
        checkOpacity: false,
        opacityProperty: false,
        contentVisibilityAuto: true,
        visibilityProperty: true,
        // This is an alias for `visibilityProperty`. Contemporary browsers
        // support both. However, this alias has wider browser support (Chrome
        // >= 105 and Firefox >= 106, vs. Chrome >= 121 and Firefox >= 122), so
        // we include it anyway.
        checkVisibilityCSS: true
      });
      return !visible;
    }
  }
  if (getComputedStyle(node).visibility === "hidden") {
    return true;
  }
  var isDirectSummary = matches.call(node, "details>summary:first-of-type");
  var nodeUnderDetails = isDirectSummary ? node.parentElement : node;
  if (matches.call(nodeUnderDetails, "details:not([open]) *")) {
    return true;
  }
  if (!displayCheck || displayCheck === "full" || // full-native can run this branch when it falls through in case
  // Element#checkVisibility is unsupported
  displayCheck === "full-native" || displayCheck === "legacy-full") {
    if (typeof getShadowRoot === "function") {
      var originalNode = node;
      while (node) {
        var parentElement = node.parentElement;
        var rootNode = getRootNode(node);
        if (parentElement && !parentElement.shadowRoot && getShadowRoot(parentElement) === true) {
          return isZeroArea(node);
        } else if (node.assignedSlot) {
          node = node.assignedSlot;
        } else if (!parentElement && rootNode !== node.ownerDocument) {
          node = rootNode.host;
        } else {
          node = parentElement;
        }
      }
      node = originalNode;
    }
    if (isNodeAttached(node)) {
      return !node.getClientRects().length;
    }
    if (displayCheck !== "legacy-full") {
      return true;
    }
  } else if (displayCheck === "non-zero-area") {
    return isZeroArea(node);
  }
  return false;
};
var isDisabledFromFieldset = function isDisabledFromFieldset2(node) {
  if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(node.tagName)) {
    var parentNode = node.parentElement;
    while (parentNode) {
      if (parentNode.tagName === "FIELDSET" && parentNode.disabled) {
        for (var i = 0; i < parentNode.children.length; i++) {
          var child = parentNode.children.item(i);
          if (child.tagName === "LEGEND") {
            return matches.call(parentNode, "fieldset[disabled] *") ? true : !child.contains(node);
          }
        }
        return true;
      }
      parentNode = parentNode.parentElement;
    }
  }
  return false;
};
var isNodeMatchingSelectorFocusable = function isNodeMatchingSelectorFocusable2(options, node) {
  if (node.disabled || isHiddenInput(node) || isHidden(node, options) || // For a details element with a summary, the summary element gets the focus
  isDetailsWithSummary(node) || isDisabledFromFieldset(node)) {
    return false;
  }
  return true;
};
var isNodeMatchingSelectorTabbable = function isNodeMatchingSelectorTabbable2(options, node) {
  if (isNonTabbableRadio(node) || getTabIndex(node) < 0 || !isNodeMatchingSelectorFocusable(options, node)) {
    return false;
  }
  return true;
};
var isShadowRootTabbable = function isShadowRootTabbable2(shadowHostNode) {
  var tabIndex = parseInt(shadowHostNode.getAttribute("tabindex"), 10);
  if (isNaN(tabIndex) || tabIndex >= 0) {
    return true;
  }
  return false;
};
var _sortByOrder = function sortByOrder(candidates) {
  var regularTabbables = [];
  var orderedTabbables = [];
  candidates.forEach(function(item, i) {
    var isScope = !!item.scopeParent;
    var element = isScope ? item.scopeParent : item;
    var candidateTabindex = getSortOrderTabIndex(element, isScope);
    var elements = isScope ? _sortByOrder(item.candidates) : element;
    if (candidateTabindex === 0) {
      isScope ? regularTabbables.push.apply(regularTabbables, elements) : regularTabbables.push(element);
    } else {
      orderedTabbables.push({
        documentOrder: i,
        tabIndex: candidateTabindex,
        item,
        isScope,
        content: elements
      });
    }
  });
  return orderedTabbables.sort(sortOrderedTabbables).reduce(function(acc, sortable) {
    sortable.isScope ? acc.push.apply(acc, sortable.content) : acc.push(sortable.content);
    return acc;
  }, []).concat(regularTabbables);
};
var tabbable = function tabbable2(container, options) {
  options = options || {};
  var candidates;
  if (options.getShadowRoot) {
    candidates = _getCandidatesIteratively([container], options.includeContainer, {
      filter: isNodeMatchingSelectorTabbable.bind(null, options),
      flatten: false,
      getShadowRoot: options.getShadowRoot,
      shadowRootFilter: isShadowRootTabbable
    });
  } else {
    candidates = getCandidates(container, options.includeContainer, isNodeMatchingSelectorTabbable.bind(null, options));
  }
  return _sortByOrder(candidates);
};
var focusable = function focusable2(container, options) {
  options = options || {};
  var candidates;
  if (options.getShadowRoot) {
    candidates = _getCandidatesIteratively([container], options.includeContainer, {
      filter: isNodeMatchingSelectorFocusable.bind(null, options),
      flatten: true,
      getShadowRoot: options.getShadowRoot
    });
  } else {
    candidates = getCandidates(container, options.includeContainer, isNodeMatchingSelectorFocusable.bind(null, options));
  }
  return candidates;
};
var isTabbable = function isTabbable2(node, options) {
  options = options || {};
  if (!node) {
    throw new Error("No node provided");
  }
  if (matches.call(node, candidateSelector) === false) {
    return false;
  }
  return isNodeMatchingSelectorTabbable(options, node);
};
var focusableCandidateSelector = candidateSelectors.concat("iframe:not([inert]):not([inert] *)").join(",");

// node_modules/@floating-ui/react/dist/floating-ui.react.utils.mjs
function getPlatform() {
  const uaData = navigator.userAgentData;
  if (uaData != null && uaData.platform) {
    return uaData.platform;
  }
  return navigator.platform;
}
function getUserAgent() {
  const uaData = navigator.userAgentData;
  if (uaData && Array.isArray(uaData.brands)) {
    return uaData.brands.map((_ref) => {
      let {
        brand,
        version
      } = _ref;
      return brand + "/" + version;
    }).join(" ");
  }
  return navigator.userAgent;
}
function isSafari() {
  return /apple/i.test(navigator.vendor);
}
function isAndroid() {
  const re = /android/i;
  return re.test(getPlatform()) || re.test(getUserAgent());
}
function isMac() {
  return getPlatform().toLowerCase().startsWith("mac") && !navigator.maxTouchPoints;
}
function isJSDOM() {
  return getUserAgent().includes("jsdom/");
}
var FOCUSABLE_ATTRIBUTE = "data-floating-ui-focusable";
var TYPEABLE_SELECTOR = "input:not([type='hidden']):not([disabled]),[contenteditable]:not([contenteditable='false']),textarea:not([disabled])";
var ARROW_LEFT = "ArrowLeft";
var ARROW_RIGHT = "ArrowRight";
var ARROW_UP = "ArrowUp";
var ARROW_DOWN = "ArrowDown";
function activeElement(doc) {
  let activeElement2 = doc.activeElement;
  while (((_activeElement = activeElement2) == null || (_activeElement = _activeElement.shadowRoot) == null ? void 0 : _activeElement.activeElement) != null) {
    var _activeElement;
    activeElement2 = activeElement2.shadowRoot.activeElement;
  }
  return activeElement2;
}
function contains(parent, child) {
  if (!parent || !child) {
    return false;
  }
  const rootNode = child.getRootNode == null ? void 0 : child.getRootNode();
  if (parent.contains(child)) {
    return true;
  }
  if (rootNode && isShadowRoot(rootNode)) {
    let next = child;
    while (next) {
      if (parent === next) {
        return true;
      }
      next = next.parentNode || next.host;
    }
  }
  return false;
}
function getTarget(event) {
  if ("composedPath" in event) {
    return event.composedPath()[0];
  }
  return event.target;
}
function isEventTargetWithin(event, node) {
  if (node == null) {
    return false;
  }
  if ("composedPath" in event) {
    return event.composedPath().includes(node);
  }
  const e2 = event;
  return e2.target != null && node.contains(e2.target);
}
function isRootElement(element) {
  return element.matches("html,body");
}
function getDocument(node) {
  return (node == null ? void 0 : node.ownerDocument) || document;
}
function isTypeableElement(element) {
  return isHTMLElement(element) && element.matches(TYPEABLE_SELECTOR);
}
function isTypeableCombobox(element) {
  if (!element) return false;
  return element.getAttribute("role") === "combobox" && isTypeableElement(element);
}
function matchesFocusVisible(element) {
  if (!element || isJSDOM()) return true;
  try {
    return element.matches(":focus-visible");
  } catch (_e2) {
    return true;
  }
}
function getFloatingFocusElement(floatingElement) {
  if (!floatingElement) {
    return null;
  }
  return floatingElement.hasAttribute(FOCUSABLE_ATTRIBUTE) ? floatingElement : floatingElement.querySelector("[" + FOCUSABLE_ATTRIBUTE + "]") || floatingElement;
}
function getNodeChildren(nodes, id, onlyOpenChildren) {
  if (onlyOpenChildren === void 0) {
    onlyOpenChildren = true;
  }
  const directChildren = nodes.filter((node) => {
    var _node$context;
    return node.parentId === id && (!onlyOpenChildren || ((_node$context = node.context) == null ? void 0 : _node$context.open));
  });
  return directChildren.flatMap((child) => [child, ...getNodeChildren(nodes, child.id, onlyOpenChildren)]);
}
function getNodeAncestors(nodes, id) {
  var _nodes$find;
  let allAncestors = [];
  let currentParentId = (_nodes$find = nodes.find((node) => node.id === id)) == null ? void 0 : _nodes$find.parentId;
  while (currentParentId) {
    const currentNode = nodes.find((node) => node.id === currentParentId);
    currentParentId = currentNode == null ? void 0 : currentNode.parentId;
    if (currentNode) {
      allAncestors = allAncestors.concat(currentNode);
    }
  }
  return allAncestors;
}
function stopEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}
function isReactEvent(event) {
  return "nativeEvent" in event;
}
function isVirtualClick(event) {
  if (event.mozInputSource === 0 && event.isTrusted) {
    return true;
  }
  if (isAndroid() && event.pointerType) {
    return event.type === "click" && event.buttons === 1;
  }
  return event.detail === 0 && !event.pointerType;
}
function isVirtualPointerEvent(event) {
  if (isJSDOM()) return false;
  return !isAndroid() && event.width === 0 && event.height === 0 || isAndroid() && event.width === 1 && event.height === 1 && event.pressure === 0 && event.detail === 0 && event.pointerType === "mouse" || // iOS VoiceOver returns 0.333• for width/height.
  event.width < 1 && event.height < 1 && event.pressure === 0 && event.detail === 0 && event.pointerType === "touch";
}
function isMouseLikePointerType(pointerType, strict) {
  const values = ["mouse", "pen"];
  if (!strict) {
    values.push("", void 0);
  }
  return values.includes(pointerType);
}
var isClient = typeof document !== "undefined";
var noop = function noop2() {
};
var index = isClient ? import_react.useLayoutEffect : noop;
var SafeReact = {
  ...React
};
function useLatestRef(value) {
  const ref = React.useRef(value);
  index(() => {
    ref.current = value;
  });
  return ref;
}
var useInsertionEffect = SafeReact.useInsertionEffect;
var useSafeInsertionEffect = useInsertionEffect || ((fn2) => fn2());
function useEffectEvent(callback) {
  const ref = React.useRef(() => {
    if (true) {
      throw new Error("Cannot call an event handler while rendering.");
    }
  });
  useSafeInsertionEffect(() => {
    ref.current = callback;
  });
  return React.useCallback(function() {
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    return ref.current == null ? void 0 : ref.current(...args);
  }, []);
}
function isDifferentGridRow(index2, cols, prevRow) {
  return Math.floor(index2 / cols) !== prevRow;
}
function isIndexOutOfListBounds(listRef, index2) {
  return index2 < 0 || index2 >= listRef.current.length;
}
function getMinListIndex(listRef, disabledIndices) {
  return findNonDisabledListIndex(listRef, {
    disabledIndices
  });
}
function getMaxListIndex(listRef, disabledIndices) {
  return findNonDisabledListIndex(listRef, {
    decrement: true,
    startingIndex: listRef.current.length,
    disabledIndices
  });
}
function findNonDisabledListIndex(listRef, _temp) {
  let {
    startingIndex = -1,
    decrement = false,
    disabledIndices,
    amount = 1
  } = _temp === void 0 ? {} : _temp;
  let index2 = startingIndex;
  do {
    index2 += decrement ? -amount : amount;
  } while (index2 >= 0 && index2 <= listRef.current.length - 1 && isListIndexDisabled(listRef, index2, disabledIndices));
  return index2;
}
function getGridNavigatedIndex(listRef, _ref) {
  let {
    event,
    orientation,
    loop,
    rtl,
    cols,
    disabledIndices,
    minIndex,
    maxIndex,
    prevIndex,
    stopEvent: stop = false
  } = _ref;
  let nextIndex = prevIndex;
  if (event.key === ARROW_UP) {
    stop && stopEvent(event);
    if (prevIndex === -1) {
      nextIndex = maxIndex;
    } else {
      nextIndex = findNonDisabledListIndex(listRef, {
        startingIndex: nextIndex,
        amount: cols,
        decrement: true,
        disabledIndices
      });
      if (loop && (prevIndex - cols < minIndex || nextIndex < 0)) {
        const col = prevIndex % cols;
        const maxCol = maxIndex % cols;
        const offset2 = maxIndex - (maxCol - col);
        if (maxCol === col) {
          nextIndex = maxIndex;
        } else {
          nextIndex = maxCol > col ? offset2 : offset2 - cols;
        }
      }
    }
    if (isIndexOutOfListBounds(listRef, nextIndex)) {
      nextIndex = prevIndex;
    }
  }
  if (event.key === ARROW_DOWN) {
    stop && stopEvent(event);
    if (prevIndex === -1) {
      nextIndex = minIndex;
    } else {
      nextIndex = findNonDisabledListIndex(listRef, {
        startingIndex: prevIndex,
        amount: cols,
        disabledIndices
      });
      if (loop && prevIndex + cols > maxIndex) {
        nextIndex = findNonDisabledListIndex(listRef, {
          startingIndex: prevIndex % cols - cols,
          amount: cols,
          disabledIndices
        });
      }
    }
    if (isIndexOutOfListBounds(listRef, nextIndex)) {
      nextIndex = prevIndex;
    }
  }
  if (orientation === "both") {
    const prevRow = floor(prevIndex / cols);
    if (event.key === (rtl ? ARROW_LEFT : ARROW_RIGHT)) {
      stop && stopEvent(event);
      if (prevIndex % cols !== cols - 1) {
        nextIndex = findNonDisabledListIndex(listRef, {
          startingIndex: prevIndex,
          disabledIndices
        });
        if (loop && isDifferentGridRow(nextIndex, cols, prevRow)) {
          nextIndex = findNonDisabledListIndex(listRef, {
            startingIndex: prevIndex - prevIndex % cols - 1,
            disabledIndices
          });
        }
      } else if (loop) {
        nextIndex = findNonDisabledListIndex(listRef, {
          startingIndex: prevIndex - prevIndex % cols - 1,
          disabledIndices
        });
      }
      if (isDifferentGridRow(nextIndex, cols, prevRow)) {
        nextIndex = prevIndex;
      }
    }
    if (event.key === (rtl ? ARROW_RIGHT : ARROW_LEFT)) {
      stop && stopEvent(event);
      if (prevIndex % cols !== 0) {
        nextIndex = findNonDisabledListIndex(listRef, {
          startingIndex: prevIndex,
          decrement: true,
          disabledIndices
        });
        if (loop && isDifferentGridRow(nextIndex, cols, prevRow)) {
          nextIndex = findNonDisabledListIndex(listRef, {
            startingIndex: prevIndex + (cols - prevIndex % cols),
            decrement: true,
            disabledIndices
          });
        }
      } else if (loop) {
        nextIndex = findNonDisabledListIndex(listRef, {
          startingIndex: prevIndex + (cols - prevIndex % cols),
          decrement: true,
          disabledIndices
        });
      }
      if (isDifferentGridRow(nextIndex, cols, prevRow)) {
        nextIndex = prevIndex;
      }
    }
    const lastRow = floor(maxIndex / cols) === prevRow;
    if (isIndexOutOfListBounds(listRef, nextIndex)) {
      if (loop && lastRow) {
        nextIndex = event.key === (rtl ? ARROW_RIGHT : ARROW_LEFT) ? maxIndex : findNonDisabledListIndex(listRef, {
          startingIndex: prevIndex - prevIndex % cols - 1,
          disabledIndices
        });
      } else {
        nextIndex = prevIndex;
      }
    }
  }
  return nextIndex;
}
function createGridCellMap(sizes, cols, dense) {
  const cellMap = [];
  let startIndex = 0;
  sizes.forEach((_ref2, index2) => {
    let {
      width,
      height
    } = _ref2;
    if (width > cols) {
      if (true) {
        throw new Error("[Floating UI]: Invalid grid - item width at index " + index2 + " is greater than grid columns");
      }
    }
    let itemPlaced = false;
    if (dense) {
      startIndex = 0;
    }
    while (!itemPlaced) {
      const targetCells = [];
      for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
          targetCells.push(startIndex + i + j * cols);
        }
      }
      if (startIndex % cols + width <= cols && targetCells.every((cell) => cellMap[cell] == null)) {
        targetCells.forEach((cell) => {
          cellMap[cell] = index2;
        });
        itemPlaced = true;
      } else {
        startIndex++;
      }
    }
  });
  return [...cellMap];
}
function getGridCellIndexOfCorner(index2, sizes, cellMap, cols, corner) {
  if (index2 === -1) return -1;
  const firstCellIndex = cellMap.indexOf(index2);
  const sizeItem = sizes[index2];
  switch (corner) {
    case "tl":
      return firstCellIndex;
    case "tr":
      if (!sizeItem) {
        return firstCellIndex;
      }
      return firstCellIndex + sizeItem.width - 1;
    case "bl":
      if (!sizeItem) {
        return firstCellIndex;
      }
      return firstCellIndex + (sizeItem.height - 1) * cols;
    case "br":
      return cellMap.lastIndexOf(index2);
  }
}
function getGridCellIndices(indices, cellMap) {
  return cellMap.flatMap((index2, cellIndex) => indices.includes(index2) ? [cellIndex] : []);
}
function isListIndexDisabled(listRef, index2, disabledIndices) {
  if (typeof disabledIndices === "function") {
    return disabledIndices(index2);
  } else if (disabledIndices) {
    return disabledIndices.includes(index2);
  }
  const element = listRef.current[index2];
  return element == null || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}
var getTabbableOptions = () => ({
  getShadowRoot: true,
  displayCheck: (
    // JSDOM does not support the `tabbable` library. To solve this we can
    // check if `ResizeObserver` is a real function (not polyfilled), which
    // determines if the current environment is JSDOM-like.
    typeof ResizeObserver === "function" && ResizeObserver.toString().includes("[native code]") ? "full" : "none"
  )
});
function getTabbableIn(container, dir) {
  const list = tabbable(container, getTabbableOptions());
  const len = list.length;
  if (len === 0) return;
  const active = activeElement(getDocument(container));
  const index2 = list.indexOf(active);
  const nextIndex = index2 === -1 ? dir === 1 ? 0 : len - 1 : index2 + dir;
  return list[nextIndex];
}
function getNextTabbable(referenceElement) {
  return getTabbableIn(getDocument(referenceElement).body, 1) || referenceElement;
}
function getPreviousTabbable(referenceElement) {
  return getTabbableIn(getDocument(referenceElement).body, -1) || referenceElement;
}
function isOutsideEvent(event, container) {
  const containerElement = container || event.currentTarget;
  const relatedTarget = event.relatedTarget;
  return !relatedTarget || !contains(containerElement, relatedTarget);
}

// node_modules/@floating-ui/react/dist/floating-ui.react.mjs
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var ReactDOM = __toESM(require_react_dom(), 1);
function useMergeRefs(refs) {
  const cleanupRef = React2.useRef(void 0);
  const refEffect = React2.useCallback((instance) => {
    const cleanups = refs.map((ref) => {
      if (ref == null) {
        return;
      }
      if (typeof ref === "function") {
        const refCallback = ref;
        const refCleanup = refCallback(instance);
        return typeof refCleanup === "function" ? refCleanup : () => {
          refCallback(null);
        };
      }
      ref.current = instance;
      return () => {
        ref.current = null;
      };
    });
    return () => {
      cleanups.forEach((refCleanup) => refCleanup == null ? void 0 : refCleanup());
    };
  }, refs);
  return React2.useMemo(() => {
    if (refs.every((ref) => ref == null)) {
      return null;
    }
    return (value) => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = void 0;
      }
      if (value != null) {
        cleanupRef.current = refEffect(value);
      }
    };
  }, refs);
}
function sortByDocumentPosition(a2, b3) {
  const position = a2.compareDocumentPosition(b3);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING || position & Node.DOCUMENT_POSITION_CONTAINED_BY) {
    return -1;
  }
  if (position & Node.DOCUMENT_POSITION_PRECEDING || position & Node.DOCUMENT_POSITION_CONTAINS) {
    return 1;
  }
  return 0;
}
var FloatingListContext = React2.createContext({
  register: () => {
  },
  unregister: () => {
  },
  map: /* @__PURE__ */ new Map(),
  elementsRef: {
    current: []
  }
});
function FloatingList(props) {
  const {
    children,
    elementsRef,
    labelsRef
  } = props;
  const [nodes, setNodes] = React2.useState(() => /* @__PURE__ */ new Set());
  const register = React2.useCallback((node) => {
    setNodes((prevSet) => new Set(prevSet).add(node));
  }, []);
  const unregister = React2.useCallback((node) => {
    setNodes((prevSet) => {
      const set = new Set(prevSet);
      set.delete(node);
      return set;
    });
  }, []);
  const map = React2.useMemo(() => {
    const newMap = /* @__PURE__ */ new Map();
    const sortedNodes = Array.from(nodes.keys()).sort(sortByDocumentPosition);
    sortedNodes.forEach((node, index2) => {
      newMap.set(node, index2);
    });
    return newMap;
  }, [nodes]);
  return (0, import_jsx_runtime.jsx)(FloatingListContext.Provider, {
    value: React2.useMemo(() => ({
      register,
      unregister,
      map,
      elementsRef,
      labelsRef
    }), [register, unregister, map, elementsRef, labelsRef]),
    children
  });
}
function useListItem(props) {
  if (props === void 0) {
    props = {};
  }
  const {
    label
  } = props;
  const {
    register,
    unregister,
    map,
    elementsRef,
    labelsRef
  } = React2.useContext(FloatingListContext);
  const [index2, setIndex] = React2.useState(null);
  const componentRef = React2.useRef(null);
  const ref = React2.useCallback((node) => {
    componentRef.current = node;
    if (index2 !== null) {
      elementsRef.current[index2] = node;
      if (labelsRef) {
        var _node$textContent;
        const isLabelDefined = label !== void 0;
        labelsRef.current[index2] = isLabelDefined ? label : (_node$textContent = node == null ? void 0 : node.textContent) != null ? _node$textContent : null;
      }
    }
  }, [index2, elementsRef, labelsRef, label]);
  index(() => {
    const node = componentRef.current;
    if (node) {
      register(node);
      return () => {
        unregister(node);
      };
    }
  }, [register, unregister]);
  index(() => {
    const index3 = componentRef.current ? map.get(componentRef.current) : null;
    if (index3 != null) {
      setIndex(index3);
    }
  }, [map]);
  return React2.useMemo(() => ({
    ref,
    index: index2 == null ? -1 : index2
  }), [index2, ref]);
}
var FOCUSABLE_ATTRIBUTE2 = "data-floating-ui-focusable";
var ACTIVE_KEY = "active";
var SELECTED_KEY = "selected";
var ARROW_LEFT2 = "ArrowLeft";
var ARROW_RIGHT2 = "ArrowRight";
var ARROW_UP2 = "ArrowUp";
var ARROW_DOWN2 = "ArrowDown";
function renderJsx(render, computedProps) {
  if (typeof render === "function") {
    return render(computedProps);
  }
  if (render) {
    return React2.cloneElement(render, computedProps);
  }
  return (0, import_jsx_runtime.jsx)("div", {
    ...computedProps
  });
}
var CompositeContext = React2.createContext({
  activeIndex: 0,
  onNavigate: () => {
  }
});
var horizontalKeys = [ARROW_LEFT2, ARROW_RIGHT2];
var verticalKeys = [ARROW_UP2, ARROW_DOWN2];
var allKeys = [...horizontalKeys, ...verticalKeys];
var Composite = React2.forwardRef(function Composite2(props, forwardedRef) {
  const {
    render,
    orientation = "both",
    loop = true,
    rtl = false,
    cols = 1,
    disabledIndices,
    activeIndex: externalActiveIndex,
    onNavigate: externalSetActiveIndex,
    itemSizes,
    dense = false,
    ...domProps
  } = props;
  const [internalActiveIndex, internalSetActiveIndex] = React2.useState(0);
  const activeIndex = externalActiveIndex != null ? externalActiveIndex : internalActiveIndex;
  const onNavigate = useEffectEvent(externalSetActiveIndex != null ? externalSetActiveIndex : internalSetActiveIndex);
  const elementsRef = React2.useRef([]);
  const renderElementProps = render && typeof render !== "function" ? render.props : {};
  const contextValue = React2.useMemo(() => ({
    activeIndex,
    onNavigate
  }), [activeIndex, onNavigate]);
  const isGrid = cols > 1;
  function handleKeyDown(event) {
    if (!allKeys.includes(event.key)) return;
    let nextIndex = activeIndex;
    const minIndex = getMinListIndex(elementsRef, disabledIndices);
    const maxIndex = getMaxListIndex(elementsRef, disabledIndices);
    const horizontalEndKey = rtl ? ARROW_LEFT2 : ARROW_RIGHT2;
    const horizontalStartKey = rtl ? ARROW_RIGHT2 : ARROW_LEFT2;
    if (isGrid) {
      const sizes = itemSizes || Array.from({
        length: elementsRef.current.length
      }, () => ({
        width: 1,
        height: 1
      }));
      const cellMap = createGridCellMap(sizes, cols, dense);
      const minGridIndex = cellMap.findIndex((index2) => index2 != null && !isListIndexDisabled(elementsRef, index2, disabledIndices));
      const maxGridIndex = cellMap.reduce((foundIndex, index2, cellIndex) => index2 != null && !isListIndexDisabled(elementsRef, index2, disabledIndices) ? cellIndex : foundIndex, -1);
      const maybeNextIndex = cellMap[getGridNavigatedIndex({
        current: cellMap.map((itemIndex) => itemIndex ? elementsRef.current[itemIndex] : null)
      }, {
        event,
        orientation,
        loop,
        rtl,
        cols,
        // treat undefined (empty grid spaces) as disabled indices so we
        // don't end up in them
        disabledIndices: getGridCellIndices([...(typeof disabledIndices !== "function" ? disabledIndices : null) || elementsRef.current.map((_2, index2) => isListIndexDisabled(elementsRef, index2, disabledIndices) ? index2 : void 0), void 0], cellMap),
        minIndex: minGridIndex,
        maxIndex: maxGridIndex,
        prevIndex: getGridCellIndexOfCorner(
          activeIndex > maxIndex ? minIndex : activeIndex,
          sizes,
          cellMap,
          cols,
          // use a corner matching the edge closest to the direction we're
          // moving in so we don't end up in the same item. Prefer
          // top/left over bottom/right.
          event.key === ARROW_DOWN2 ? "bl" : event.key === horizontalEndKey ? "tr" : "tl"
        )
      })];
      if (maybeNextIndex != null) {
        nextIndex = maybeNextIndex;
      }
    }
    const toEndKeys = {
      horizontal: [horizontalEndKey],
      vertical: [ARROW_DOWN2],
      both: [horizontalEndKey, ARROW_DOWN2]
    }[orientation];
    const toStartKeys = {
      horizontal: [horizontalStartKey],
      vertical: [ARROW_UP2],
      both: [horizontalStartKey, ARROW_UP2]
    }[orientation];
    const preventedKeys = isGrid ? allKeys : {
      horizontal: horizontalKeys,
      vertical: verticalKeys,
      both: allKeys
    }[orientation];
    if (nextIndex === activeIndex && [...toEndKeys, ...toStartKeys].includes(event.key)) {
      if (loop && nextIndex === maxIndex && toEndKeys.includes(event.key)) {
        nextIndex = minIndex;
      } else if (loop && nextIndex === minIndex && toStartKeys.includes(event.key)) {
        nextIndex = maxIndex;
      } else {
        nextIndex = findNonDisabledListIndex(elementsRef, {
          startingIndex: nextIndex,
          decrement: toStartKeys.includes(event.key),
          disabledIndices
        });
      }
    }
    if (nextIndex !== activeIndex && !isIndexOutOfListBounds(elementsRef, nextIndex)) {
      var _elementsRef$current$;
      event.stopPropagation();
      if (preventedKeys.includes(event.key)) {
        event.preventDefault();
      }
      onNavigate(nextIndex);
      (_elementsRef$current$ = elementsRef.current[nextIndex]) == null || _elementsRef$current$.focus();
    }
  }
  const computedProps = {
    ...domProps,
    ...renderElementProps,
    ref: forwardedRef,
    "aria-orientation": orientation === "both" ? void 0 : orientation,
    onKeyDown(e2) {
      domProps.onKeyDown == null || domProps.onKeyDown(e2);
      renderElementProps.onKeyDown == null || renderElementProps.onKeyDown(e2);
      handleKeyDown(e2);
    }
  };
  return (0, import_jsx_runtime.jsx)(CompositeContext.Provider, {
    value: contextValue,
    children: (0, import_jsx_runtime.jsx)(FloatingList, {
      elementsRef,
      children: renderJsx(render, computedProps)
    })
  });
});
var CompositeItem = React2.forwardRef(function CompositeItem2(props, forwardedRef) {
  const {
    render,
    ...domProps
  } = props;
  const renderElementProps = render && typeof render !== "function" ? render.props : {};
  const {
    activeIndex,
    onNavigate
  } = React2.useContext(CompositeContext);
  const {
    ref,
    index: index2
  } = useListItem();
  const mergedRef = useMergeRefs([ref, forwardedRef, renderElementProps.ref]);
  const isActive = activeIndex === index2;
  const computedProps = {
    ...domProps,
    ...renderElementProps,
    ref: mergedRef,
    tabIndex: isActive ? 0 : -1,
    "data-active": isActive ? "" : void 0,
    onFocus(e2) {
      domProps.onFocus == null || domProps.onFocus(e2);
      renderElementProps.onFocus == null || renderElementProps.onFocus(e2);
      onNavigate(index2);
    }
  };
  return renderJsx(render, computedProps);
});
var SafeReact2 = {
  ...React2
};
var serverHandoffComplete = false;
var count = 0;
var genId = () => (
  // Ensure the id is unique with multiple independent versions of Floating UI
  // on <React 18
  "floating-ui-" + Math.random().toString(36).slice(2, 6) + count++
);
function useFloatingId() {
  const [id, setId] = React2.useState(() => serverHandoffComplete ? genId() : void 0);
  index(() => {
    if (id == null) {
      setId(genId());
    }
  }, []);
  React2.useEffect(() => {
    serverHandoffComplete = true;
  }, []);
  return id;
}
var useReactId = SafeReact2.useId;
var useId = useReactId || useFloatingId;
var devMessageSet;
if (true) {
  devMessageSet = /* @__PURE__ */ new Set();
}
function warn() {
  var _devMessageSet;
  for (var _len = arguments.length, messages = new Array(_len), _key = 0; _key < _len; _key++) {
    messages[_key] = arguments[_key];
  }
  const message = "Floating UI: " + messages.join(" ");
  if (!((_devMessageSet = devMessageSet) != null && _devMessageSet.has(message))) {
    var _devMessageSet2;
    (_devMessageSet2 = devMessageSet) == null || _devMessageSet2.add(message);
    console.warn(message);
  }
}
function error() {
  var _devMessageSet3;
  for (var _len2 = arguments.length, messages = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
    messages[_key2] = arguments[_key2];
  }
  const message = "Floating UI: " + messages.join(" ");
  if (!((_devMessageSet3 = devMessageSet) != null && _devMessageSet3.has(message))) {
    var _devMessageSet4;
    (_devMessageSet4 = devMessageSet) == null || _devMessageSet4.add(message);
    console.error(message);
  }
}
var FloatingArrow = React2.forwardRef(function FloatingArrow2(props, ref) {
  const {
    context: {
      placement,
      elements: {
        floating
      },
      middlewareData: {
        arrow: arrow2,
        shift: shift2
      }
    },
    width = 14,
    height = 7,
    tipRadius = 0,
    strokeWidth = 0,
    staticOffset,
    stroke,
    d,
    style: {
      transform,
      ...restStyle
    } = {},
    ...rest
  } = props;
  if (true) {
    if (!ref) {
      warn("The `ref` prop is required for `FloatingArrow`.");
    }
  }
  const clipPathId = useId();
  const [isRTL, setIsRTL] = React2.useState(false);
  index(() => {
    if (!floating) return;
    const isRTL2 = getComputedStyle2(floating).direction === "rtl";
    if (isRTL2) {
      setIsRTL(true);
    }
  }, [floating]);
  if (!floating) {
    return null;
  }
  const [side, alignment] = placement.split("-");
  const isVerticalSide = side === "top" || side === "bottom";
  let computedStaticOffset = staticOffset;
  if (isVerticalSide && shift2 != null && shift2.x || !isVerticalSide && shift2 != null && shift2.y) {
    computedStaticOffset = null;
  }
  const computedStrokeWidth = strokeWidth * 2;
  const halfStrokeWidth = computedStrokeWidth / 2;
  const svgX = width / 2 * (tipRadius / -8 + 1);
  const svgY = height / 2 * tipRadius / 4;
  const isCustomShape = !!d;
  const yOffsetProp = computedStaticOffset && alignment === "end" ? "bottom" : "top";
  let xOffsetProp = computedStaticOffset && alignment === "end" ? "right" : "left";
  if (computedStaticOffset && isRTL) {
    xOffsetProp = alignment === "end" ? "left" : "right";
  }
  const arrowX = (arrow2 == null ? void 0 : arrow2.x) != null ? computedStaticOffset || arrow2.x : "";
  const arrowY = (arrow2 == null ? void 0 : arrow2.y) != null ? computedStaticOffset || arrow2.y : "";
  const dValue = d || "M0,0" + (" H" + width) + (" L" + (width - svgX) + "," + (height - svgY)) + (" Q" + width / 2 + "," + height + " " + svgX + "," + (height - svgY)) + " Z";
  const rotation = {
    top: isCustomShape ? "rotate(180deg)" : "",
    left: isCustomShape ? "rotate(90deg)" : "rotate(-90deg)",
    bottom: isCustomShape ? "" : "rotate(180deg)",
    right: isCustomShape ? "rotate(-90deg)" : "rotate(90deg)"
  }[side];
  return (0, import_jsx_runtime.jsxs)("svg", {
    ...rest,
    "aria-hidden": true,
    ref,
    width: isCustomShape ? width : width + computedStrokeWidth,
    height: width,
    viewBox: "0 0 " + width + " " + (height > width ? height : width),
    style: {
      position: "absolute",
      pointerEvents: "none",
      [xOffsetProp]: arrowX,
      [yOffsetProp]: arrowY,
      [side]: isVerticalSide || isCustomShape ? "100%" : "calc(100% - " + computedStrokeWidth / 2 + "px)",
      transform: [rotation, transform].filter((t) => !!t).join(" "),
      ...restStyle
    },
    children: [computedStrokeWidth > 0 && (0, import_jsx_runtime.jsx)("path", {
      clipPath: "url(#" + clipPathId + ")",
      fill: "none",
      stroke,
      strokeWidth: computedStrokeWidth + (d ? 0 : 1),
      d: dValue
    }), (0, import_jsx_runtime.jsx)("path", {
      stroke: computedStrokeWidth && !d ? rest.fill : "none",
      d: dValue
    }), (0, import_jsx_runtime.jsx)("clipPath", {
      id: clipPathId,
      children: (0, import_jsx_runtime.jsx)("rect", {
        x: -halfStrokeWidth,
        y: halfStrokeWidth * (isCustomShape ? -1 : 1),
        width: width + computedStrokeWidth,
        height: width
      })
    })]
  });
});
function createEventEmitter() {
  const map = /* @__PURE__ */ new Map();
  return {
    emit(event, data) {
      var _map$get;
      (_map$get = map.get(event)) == null || _map$get.forEach((listener) => listener(data));
    },
    on(event, listener) {
      if (!map.has(event)) {
        map.set(event, /* @__PURE__ */ new Set());
      }
      map.get(event).add(listener);
    },
    off(event, listener) {
      var _map$get2;
      (_map$get2 = map.get(event)) == null || _map$get2.delete(listener);
    }
  };
}
var FloatingNodeContext = React2.createContext(null);
var FloatingTreeContext = React2.createContext(null);
var useFloatingParentNodeId = () => {
  var _React$useContext;
  return ((_React$useContext = React2.useContext(FloatingNodeContext)) == null ? void 0 : _React$useContext.id) || null;
};
var useFloatingTree = () => React2.useContext(FloatingTreeContext);
function createAttribute(name) {
  return "data-floating-ui-" + name;
}
function clearTimeoutIfSet(timeoutRef) {
  if (timeoutRef.current !== -1) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = -1;
  }
}
var safePolygonIdentifier = createAttribute("safe-polygon");
function getDelay(value, prop, pointerType) {
  if (pointerType && !isMouseLikePointerType(pointerType)) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "function") {
    const result = value();
    if (typeof result === "number") {
      return result;
    }
    return result == null ? void 0 : result[prop];
  }
  return value == null ? void 0 : value[prop];
}
function getRestMs(value) {
  if (typeof value === "function") {
    return value();
  }
  return value;
}
function useHover(context, props) {
  if (props === void 0) {
    props = {};
  }
  const {
    open,
    onOpenChange,
    dataRef,
    events,
    elements
  } = context;
  const {
    enabled = true,
    delay = 0,
    handleClose = null,
    mouseOnly = false,
    restMs = 0,
    move = true
  } = props;
  const tree = useFloatingTree();
  const parentId = useFloatingParentNodeId();
  const handleCloseRef = useLatestRef(handleClose);
  const delayRef = useLatestRef(delay);
  const openRef = useLatestRef(open);
  const restMsRef = useLatestRef(restMs);
  const pointerTypeRef = React2.useRef();
  const timeoutRef = React2.useRef(-1);
  const handlerRef = React2.useRef();
  const restTimeoutRef = React2.useRef(-1);
  const blockMouseMoveRef = React2.useRef(true);
  const performedPointerEventsMutationRef = React2.useRef(false);
  const unbindMouseMoveRef = React2.useRef(() => {
  });
  const restTimeoutPendingRef = React2.useRef(false);
  const isHoverOpen = useEffectEvent(() => {
    var _dataRef$current$open;
    const type = (_dataRef$current$open = dataRef.current.openEvent) == null ? void 0 : _dataRef$current$open.type;
    return (type == null ? void 0 : type.includes("mouse")) && type !== "mousedown";
  });
  React2.useEffect(() => {
    if (!enabled) return;
    function onOpenChange2(_ref) {
      let {
        open: open2
      } = _ref;
      if (!open2) {
        clearTimeoutIfSet(timeoutRef);
        clearTimeoutIfSet(restTimeoutRef);
        blockMouseMoveRef.current = true;
        restTimeoutPendingRef.current = false;
      }
    }
    events.on("openchange", onOpenChange2);
    return () => {
      events.off("openchange", onOpenChange2);
    };
  }, [enabled, events]);
  React2.useEffect(() => {
    if (!enabled) return;
    if (!handleCloseRef.current) return;
    if (!open) return;
    function onLeave(event) {
      if (isHoverOpen()) {
        onOpenChange(false, event, "hover");
      }
    }
    const html = getDocument(elements.floating).documentElement;
    html.addEventListener("mouseleave", onLeave);
    return () => {
      html.removeEventListener("mouseleave", onLeave);
    };
  }, [elements.floating, open, onOpenChange, enabled, handleCloseRef, isHoverOpen]);
  const closeWithDelay = React2.useCallback(function(event, runElseBranch, reason) {
    if (runElseBranch === void 0) {
      runElseBranch = true;
    }
    if (reason === void 0) {
      reason = "hover";
    }
    const closeDelay = getDelay(delayRef.current, "close", pointerTypeRef.current);
    if (closeDelay && !handlerRef.current) {
      clearTimeoutIfSet(timeoutRef);
      timeoutRef.current = window.setTimeout(() => onOpenChange(false, event, reason), closeDelay);
    } else if (runElseBranch) {
      clearTimeoutIfSet(timeoutRef);
      onOpenChange(false, event, reason);
    }
  }, [delayRef, onOpenChange]);
  const cleanupMouseMoveHandler = useEffectEvent(() => {
    unbindMouseMoveRef.current();
    handlerRef.current = void 0;
  });
  const clearPointerEvents = useEffectEvent(() => {
    if (performedPointerEventsMutationRef.current) {
      const body = getDocument(elements.floating).body;
      body.style.pointerEvents = "";
      body.removeAttribute(safePolygonIdentifier);
      performedPointerEventsMutationRef.current = false;
    }
  });
  const isClickLikeOpenEvent = useEffectEvent(() => {
    return dataRef.current.openEvent ? ["click", "mousedown"].includes(dataRef.current.openEvent.type) : false;
  });
  React2.useEffect(() => {
    if (!enabled) return;
    function onReferenceMouseEnter(event) {
      clearTimeoutIfSet(timeoutRef);
      blockMouseMoveRef.current = false;
      if (mouseOnly && !isMouseLikePointerType(pointerTypeRef.current) || getRestMs(restMsRef.current) > 0 && !getDelay(delayRef.current, "open")) {
        return;
      }
      const openDelay = getDelay(delayRef.current, "open", pointerTypeRef.current);
      if (openDelay) {
        timeoutRef.current = window.setTimeout(() => {
          if (!openRef.current) {
            onOpenChange(true, event, "hover");
          }
        }, openDelay);
      } else if (!open) {
        onOpenChange(true, event, "hover");
      }
    }
    function onReferenceMouseLeave(event) {
      if (isClickLikeOpenEvent()) {
        clearPointerEvents();
        return;
      }
      unbindMouseMoveRef.current();
      const doc = getDocument(elements.floating);
      clearTimeoutIfSet(restTimeoutRef);
      restTimeoutPendingRef.current = false;
      if (handleCloseRef.current && dataRef.current.floatingContext) {
        if (!open) {
          clearTimeoutIfSet(timeoutRef);
        }
        handlerRef.current = handleCloseRef.current({
          ...dataRef.current.floatingContext,
          tree,
          x: event.clientX,
          y: event.clientY,
          onClose() {
            clearPointerEvents();
            cleanupMouseMoveHandler();
            if (!isClickLikeOpenEvent()) {
              closeWithDelay(event, true, "safe-polygon");
            }
          }
        });
        const handler = handlerRef.current;
        doc.addEventListener("mousemove", handler);
        unbindMouseMoveRef.current = () => {
          doc.removeEventListener("mousemove", handler);
        };
        return;
      }
      const shouldClose = pointerTypeRef.current === "touch" ? !contains(elements.floating, event.relatedTarget) : true;
      if (shouldClose) {
        closeWithDelay(event);
      }
    }
    function onScrollMouseLeave(event) {
      if (isClickLikeOpenEvent()) return;
      if (!dataRef.current.floatingContext) return;
      handleCloseRef.current == null || handleCloseRef.current({
        ...dataRef.current.floatingContext,
        tree,
        x: event.clientX,
        y: event.clientY,
        onClose() {
          clearPointerEvents();
          cleanupMouseMoveHandler();
          if (!isClickLikeOpenEvent()) {
            closeWithDelay(event);
          }
        }
      })(event);
    }
    function onFloatingMouseEnter() {
      clearTimeoutIfSet(timeoutRef);
    }
    function onFloatingMouseLeave(event) {
      if (!isClickLikeOpenEvent()) {
        closeWithDelay(event, false);
      }
    }
    if (isElement(elements.domReference)) {
      const reference2 = elements.domReference;
      const floating = elements.floating;
      if (open) {
        reference2.addEventListener("mouseleave", onScrollMouseLeave);
      }
      if (move) {
        reference2.addEventListener("mousemove", onReferenceMouseEnter, {
          once: true
        });
      }
      reference2.addEventListener("mouseenter", onReferenceMouseEnter);
      reference2.addEventListener("mouseleave", onReferenceMouseLeave);
      if (floating) {
        floating.addEventListener("mouseleave", onScrollMouseLeave);
        floating.addEventListener("mouseenter", onFloatingMouseEnter);
        floating.addEventListener("mouseleave", onFloatingMouseLeave);
      }
      return () => {
        if (open) {
          reference2.removeEventListener("mouseleave", onScrollMouseLeave);
        }
        if (move) {
          reference2.removeEventListener("mousemove", onReferenceMouseEnter);
        }
        reference2.removeEventListener("mouseenter", onReferenceMouseEnter);
        reference2.removeEventListener("mouseleave", onReferenceMouseLeave);
        if (floating) {
          floating.removeEventListener("mouseleave", onScrollMouseLeave);
          floating.removeEventListener("mouseenter", onFloatingMouseEnter);
          floating.removeEventListener("mouseleave", onFloatingMouseLeave);
        }
      };
    }
  }, [elements, enabled, context, mouseOnly, move, closeWithDelay, cleanupMouseMoveHandler, clearPointerEvents, onOpenChange, open, openRef, tree, delayRef, handleCloseRef, dataRef, isClickLikeOpenEvent, restMsRef]);
  index(() => {
    var _handleCloseRef$curre;
    if (!enabled) return;
    if (open && (_handleCloseRef$curre = handleCloseRef.current) != null && (_handleCloseRef$curre = _handleCloseRef$curre.__options) != null && _handleCloseRef$curre.blockPointerEvents && isHoverOpen()) {
      performedPointerEventsMutationRef.current = true;
      const floatingEl = elements.floating;
      if (isElement(elements.domReference) && floatingEl) {
        var _tree$nodesRef$curren;
        const body = getDocument(elements.floating).body;
        body.setAttribute(safePolygonIdentifier, "");
        const ref = elements.domReference;
        const parentFloating = tree == null || (_tree$nodesRef$curren = tree.nodesRef.current.find((node) => node.id === parentId)) == null || (_tree$nodesRef$curren = _tree$nodesRef$curren.context) == null ? void 0 : _tree$nodesRef$curren.elements.floating;
        if (parentFloating) {
          parentFloating.style.pointerEvents = "";
        }
        body.style.pointerEvents = "none";
        ref.style.pointerEvents = "auto";
        floatingEl.style.pointerEvents = "auto";
        return () => {
          body.style.pointerEvents = "";
          ref.style.pointerEvents = "";
          floatingEl.style.pointerEvents = "";
        };
      }
    }
  }, [enabled, open, parentId, elements, tree, handleCloseRef, isHoverOpen]);
  index(() => {
    if (!open) {
      pointerTypeRef.current = void 0;
      restTimeoutPendingRef.current = false;
      cleanupMouseMoveHandler();
      clearPointerEvents();
    }
  }, [open, cleanupMouseMoveHandler, clearPointerEvents]);
  React2.useEffect(() => {
    return () => {
      cleanupMouseMoveHandler();
      clearTimeoutIfSet(timeoutRef);
      clearTimeoutIfSet(restTimeoutRef);
      clearPointerEvents();
    };
  }, [enabled, elements.domReference, cleanupMouseMoveHandler, clearPointerEvents]);
  const reference = React2.useMemo(() => {
    function setPointerRef(event) {
      pointerTypeRef.current = event.pointerType;
    }
    return {
      onPointerDown: setPointerRef,
      onPointerEnter: setPointerRef,
      onMouseMove(event) {
        const {
          nativeEvent
        } = event;
        function handleMouseMove() {
          if (!blockMouseMoveRef.current && !openRef.current) {
            onOpenChange(true, nativeEvent, "hover");
          }
        }
        if (mouseOnly && !isMouseLikePointerType(pointerTypeRef.current)) {
          return;
        }
        if (open || getRestMs(restMsRef.current) === 0) {
          return;
        }
        if (restTimeoutPendingRef.current && event.movementX ** 2 + event.movementY ** 2 < 2) {
          return;
        }
        clearTimeoutIfSet(restTimeoutRef);
        if (pointerTypeRef.current === "touch") {
          handleMouseMove();
        } else {
          restTimeoutPendingRef.current = true;
          restTimeoutRef.current = window.setTimeout(handleMouseMove, getRestMs(restMsRef.current));
        }
      }
    };
  }, [mouseOnly, onOpenChange, open, openRef, restMsRef]);
  return React2.useMemo(() => enabled ? {
    reference
  } : {}, [enabled, reference]);
}
var NOOP = () => {
};
var FloatingDelayGroupContext = React2.createContext({
  delay: 0,
  initialDelay: 0,
  timeoutMs: 0,
  currentId: null,
  setCurrentId: NOOP,
  setState: NOOP,
  isInstantPhase: false
});
var useDelayGroupContext = () => React2.useContext(FloatingDelayGroupContext);
function FloatingDelayGroup(props) {
  const {
    children,
    delay,
    timeoutMs = 0
  } = props;
  const [state, setState] = React2.useReducer((prev, next) => ({
    ...prev,
    ...next
  }), {
    delay,
    timeoutMs,
    initialDelay: delay,
    currentId: null,
    isInstantPhase: false
  });
  const initialCurrentIdRef = React2.useRef(null);
  const setCurrentId = React2.useCallback((currentId) => {
    setState({
      currentId
    });
  }, []);
  index(() => {
    if (state.currentId) {
      if (initialCurrentIdRef.current === null) {
        initialCurrentIdRef.current = state.currentId;
      } else if (!state.isInstantPhase) {
        setState({
          isInstantPhase: true
        });
      }
    } else {
      if (state.isInstantPhase) {
        setState({
          isInstantPhase: false
        });
      }
      initialCurrentIdRef.current = null;
    }
  }, [state.currentId, state.isInstantPhase]);
  return (0, import_jsx_runtime.jsx)(FloatingDelayGroupContext.Provider, {
    value: React2.useMemo(() => ({
      ...state,
      setState,
      setCurrentId
    }), [state, setCurrentId]),
    children
  });
}
function useDelayGroup(context, options) {
  if (options === void 0) {
    options = {};
  }
  const {
    open,
    onOpenChange,
    floatingId
  } = context;
  const {
    id: optionId,
    enabled = true
  } = options;
  const id = optionId != null ? optionId : floatingId;
  const groupContext = useDelayGroupContext();
  const {
    currentId,
    setCurrentId,
    initialDelay,
    setState,
    timeoutMs
  } = groupContext;
  index(() => {
    if (!enabled) return;
    if (!currentId) return;
    setState({
      delay: {
        open: 1,
        close: getDelay(initialDelay, "close")
      }
    });
    if (currentId !== id) {
      onOpenChange(false);
    }
  }, [enabled, id, onOpenChange, setState, currentId, initialDelay]);
  index(() => {
    function unset() {
      onOpenChange(false);
      setState({
        delay: initialDelay,
        currentId: null
      });
    }
    if (!enabled) return;
    if (!currentId) return;
    if (!open && currentId === id) {
      if (timeoutMs) {
        const timeout = window.setTimeout(unset, timeoutMs);
        return () => {
          clearTimeout(timeout);
        };
      }
      unset();
    }
  }, [enabled, open, setState, currentId, id, onOpenChange, initialDelay, timeoutMs]);
  index(() => {
    if (!enabled) return;
    if (setCurrentId === NOOP || !open) return;
    setCurrentId(id);
  }, [enabled, open, setCurrentId, id]);
  return groupContext;
}
var NextFloatingDelayGroupContext = React2.createContext({
  hasProvider: false,
  timeoutMs: 0,
  delayRef: {
    current: 0
  },
  initialDelayRef: {
    current: 0
  },
  timeoutIdRef: {
    current: -1
  },
  currentIdRef: {
    current: null
  },
  currentContextRef: {
    current: null
  }
});
var rafId = 0;
function enqueueFocus(el2, options) {
  if (options === void 0) {
    options = {};
  }
  const {
    preventScroll = false,
    cancelPrevious = true,
    sync = false
  } = options;
  cancelPrevious && cancelAnimationFrame(rafId);
  const exec = () => el2 == null ? void 0 : el2.focus({
    preventScroll
  });
  if (sync) {
    exec();
  } else {
    rafId = requestAnimationFrame(exec);
  }
}
function contains2(parent, child) {
  if (!parent || !child) {
    return false;
  }
  const rootNode = child.getRootNode == null ? void 0 : child.getRootNode();
  if (parent.contains(child)) {
    return true;
  }
  if (rootNode && isShadowRoot(rootNode)) {
    let next = child;
    while (next) {
      if (parent === next) {
        return true;
      }
      next = next.parentNode || next.host;
    }
  }
  return false;
}
function getTarget2(event) {
  if ("composedPath" in event) {
    return event.composedPath()[0];
  }
  return event.target;
}
function getDocument2(node) {
  return (node == null ? void 0 : node.ownerDocument) || document;
}
var counters = {
  inert: /* @__PURE__ */ new WeakMap(),
  "aria-hidden": /* @__PURE__ */ new WeakMap(),
  none: /* @__PURE__ */ new WeakMap()
};
function getCounterMap(control) {
  if (control === "inert") return counters.inert;
  if (control === "aria-hidden") return counters["aria-hidden"];
  return counters.none;
}
var uncontrolledElementsSet = /* @__PURE__ */ new WeakSet();
var markerMap = {};
var lockCount$1 = 0;
var supportsInert = () => typeof HTMLElement !== "undefined" && "inert" in HTMLElement.prototype;
function unwrapHost(node) {
  if (!node) {
    return null;
  }
  return isShadowRoot(node) ? node.host : unwrapHost(node.parentNode);
}
var correctElements = (parent, targets) => targets.map((target) => {
  if (parent.contains(target)) {
    return target;
  }
  const correctedTarget = unwrapHost(target);
  if (parent.contains(correctedTarget)) {
    return correctedTarget;
  }
  return null;
}).filter((x2) => x2 != null);
function applyAttributeToOthers(uncorrectedAvoidElements, body, ariaHidden, inert) {
  const markerName = "data-floating-ui-inert";
  const controlAttribute = inert ? "inert" : ariaHidden ? "aria-hidden" : null;
  const avoidElements = correctElements(body, uncorrectedAvoidElements);
  const elementsToKeep = /* @__PURE__ */ new Set();
  const elementsToStop = new Set(avoidElements);
  const hiddenElements = [];
  if (!markerMap[markerName]) {
    markerMap[markerName] = /* @__PURE__ */ new WeakMap();
  }
  const markerCounter = markerMap[markerName];
  avoidElements.forEach(keep);
  deep(body);
  elementsToKeep.clear();
  function keep(el2) {
    if (!el2 || elementsToKeep.has(el2)) {
      return;
    }
    elementsToKeep.add(el2);
    el2.parentNode && keep(el2.parentNode);
  }
  function deep(parent) {
    if (!parent || elementsToStop.has(parent)) {
      return;
    }
    [].forEach.call(parent.children, (node) => {
      if (getNodeName(node) === "script") return;
      if (elementsToKeep.has(node)) {
        deep(node);
      } else {
        const attr2 = controlAttribute ? node.getAttribute(controlAttribute) : null;
        const alreadyHidden = attr2 !== null && attr2 !== "false";
        const counterMap = getCounterMap(controlAttribute);
        const counterValue = (counterMap.get(node) || 0) + 1;
        const markerValue = (markerCounter.get(node) || 0) + 1;
        counterMap.set(node, counterValue);
        markerCounter.set(node, markerValue);
        hiddenElements.push(node);
        if (counterValue === 1 && alreadyHidden) {
          uncontrolledElementsSet.add(node);
        }
        if (markerValue === 1) {
          node.setAttribute(markerName, "");
        }
        if (!alreadyHidden && controlAttribute) {
          node.setAttribute(controlAttribute, controlAttribute === "inert" ? "" : "true");
        }
      }
    });
  }
  lockCount$1++;
  return () => {
    hiddenElements.forEach((element) => {
      const counterMap = getCounterMap(controlAttribute);
      const currentCounterValue = counterMap.get(element) || 0;
      const counterValue = currentCounterValue - 1;
      const markerValue = (markerCounter.get(element) || 0) - 1;
      counterMap.set(element, counterValue);
      markerCounter.set(element, markerValue);
      if (!counterValue) {
        if (!uncontrolledElementsSet.has(element) && controlAttribute) {
          element.removeAttribute(controlAttribute);
        }
        uncontrolledElementsSet.delete(element);
      }
      if (!markerValue) {
        element.removeAttribute(markerName);
      }
    });
    lockCount$1--;
    if (!lockCount$1) {
      counters.inert = /* @__PURE__ */ new WeakMap();
      counters["aria-hidden"] = /* @__PURE__ */ new WeakMap();
      counters.none = /* @__PURE__ */ new WeakMap();
      uncontrolledElementsSet = /* @__PURE__ */ new WeakSet();
      markerMap = {};
    }
  };
}
function markOthers(avoidElements, ariaHidden, inert) {
  if (ariaHidden === void 0) {
    ariaHidden = false;
  }
  if (inert === void 0) {
    inert = false;
  }
  const body = getDocument2(avoidElements[0]).body;
  return applyAttributeToOthers(avoidElements.concat(Array.from(body.querySelectorAll('[aria-live],[role="status"],output'))), body, ariaHidden, inert);
}
var HIDDEN_STYLES = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "fixed",
  whiteSpace: "nowrap",
  width: "1px",
  top: 0,
  left: 0
};
var FocusGuard = React2.forwardRef(function FocusGuard2(props, ref) {
  const [role, setRole] = React2.useState();
  index(() => {
    if (isSafari()) {
      setRole("button");
    }
  }, []);
  const restProps = {
    ref,
    tabIndex: 0,
    // Role is only for VoiceOver
    role,
    "aria-hidden": role ? void 0 : true,
    [createAttribute("focus-guard")]: "",
    style: HIDDEN_STYLES
  };
  return (0, import_jsx_runtime.jsx)("span", {
    ...props,
    ...restProps
  });
});
var PortalContext = React2.createContext(null);
var attr = createAttribute("portal");
var usePortalContext = () => React2.useContext(PortalContext);
function useLiteMergeRefs(refs) {
  return React2.useMemo(() => {
    return (value) => {
      refs.forEach((ref) => {
        if (ref) {
          ref.current = value;
        }
      });
    };
  }, refs);
}
var LIST_LIMIT = 20;
var previouslyFocusedElements = [];
function clearDisconnectedPreviouslyFocusedElements() {
  previouslyFocusedElements = previouslyFocusedElements.filter((elementRef) => {
    var _elementRef$deref;
    return (_elementRef$deref = elementRef.deref()) == null ? void 0 : _elementRef$deref.isConnected;
  });
}
function addPreviouslyFocusedElement(element) {
  clearDisconnectedPreviouslyFocusedElements();
  if (element && getNodeName(element) !== "body") {
    previouslyFocusedElements.push(new WeakRef(element));
    if (previouslyFocusedElements.length > LIST_LIMIT) {
      previouslyFocusedElements = previouslyFocusedElements.slice(-LIST_LIMIT);
    }
  }
}
function getPreviouslyFocusedElement() {
  clearDisconnectedPreviouslyFocusedElements();
  const elementRef = previouslyFocusedElements[previouslyFocusedElements.length - 1];
  return elementRef == null ? void 0 : elementRef.deref();
}
function getFirstTabbableElement(container) {
  const tabbableOptions = getTabbableOptions();
  if (isTabbable(container, tabbableOptions)) {
    return container;
  }
  return tabbable(container, tabbableOptions)[0] || container;
}
function handleTabIndex(floatingFocusElement, orderRef) {
  var _floatingFocusElement;
  if (!orderRef.current.includes("floating") && !((_floatingFocusElement = floatingFocusElement.getAttribute("role")) != null && _floatingFocusElement.includes("dialog"))) {
    return;
  }
  const options = getTabbableOptions();
  const focusableElements = focusable(floatingFocusElement, options);
  const tabbableContent = focusableElements.filter((element) => {
    const dataTabIndex = element.getAttribute("data-tabindex") || "";
    return isTabbable(element, options) || element.hasAttribute("data-tabindex") && !dataTabIndex.startsWith("-");
  });
  const tabIndex = floatingFocusElement.getAttribute("tabindex");
  if (orderRef.current.includes("floating") || tabbableContent.length === 0) {
    if (tabIndex !== "0") {
      floatingFocusElement.setAttribute("tabindex", "0");
    }
  } else if (tabIndex !== "-1" || floatingFocusElement.hasAttribute("data-tabindex") && floatingFocusElement.getAttribute("data-tabindex") !== "-1") {
    floatingFocusElement.setAttribute("tabindex", "-1");
    floatingFocusElement.setAttribute("data-tabindex", "-1");
  }
}
var VisuallyHiddenDismiss = React2.forwardRef(function VisuallyHiddenDismiss2(props, ref) {
  return (0, import_jsx_runtime.jsx)("button", {
    ...props,
    type: "button",
    ref,
    tabIndex: -1,
    style: HIDDEN_STYLES
  });
});
function FloatingFocusManager(props) {
  const {
    context,
    children,
    disabled = false,
    order = ["content"],
    guards: _guards = true,
    initialFocus = 0,
    returnFocus = true,
    restoreFocus = false,
    modal = true,
    visuallyHiddenDismiss = false,
    closeOnFocusOut = true,
    outsideElementsInert = false,
    getInsideElements: _getInsideElements = () => []
  } = props;
  const {
    open,
    onOpenChange,
    events,
    dataRef,
    elements: {
      domReference,
      floating
    }
  } = context;
  const getNodeId = useEffectEvent(() => {
    var _dataRef$current$floa;
    return (_dataRef$current$floa = dataRef.current.floatingContext) == null ? void 0 : _dataRef$current$floa.nodeId;
  });
  const getInsideElements = useEffectEvent(_getInsideElements);
  const ignoreInitialFocus = typeof initialFocus === "number" && initialFocus < 0;
  const isUntrappedTypeableCombobox = isTypeableCombobox(domReference) && ignoreInitialFocus;
  const inertSupported = supportsInert();
  const guards = inertSupported ? _guards : true;
  const useInert = !guards || inertSupported && outsideElementsInert;
  const orderRef = useLatestRef(order);
  const initialFocusRef = useLatestRef(initialFocus);
  const returnFocusRef = useLatestRef(returnFocus);
  const tree = useFloatingTree();
  const portalContext = usePortalContext();
  const startDismissButtonRef = React2.useRef(null);
  const endDismissButtonRef = React2.useRef(null);
  const preventReturnFocusRef = React2.useRef(false);
  const isPointerDownRef = React2.useRef(false);
  const tabbableIndexRef = React2.useRef(-1);
  const blurTimeoutRef = React2.useRef(-1);
  const isInsidePortal = portalContext != null;
  const floatingFocusElement = getFloatingFocusElement(floating);
  const getTabbableContent = useEffectEvent(function(container) {
    if (container === void 0) {
      container = floatingFocusElement;
    }
    return container ? tabbable(container, getTabbableOptions()) : [];
  });
  const getTabbableElements = useEffectEvent((container) => {
    const content = getTabbableContent(container);
    return orderRef.current.map((type) => {
      if (domReference && type === "reference") {
        return domReference;
      }
      if (floatingFocusElement && type === "floating") {
        return floatingFocusElement;
      }
      return content;
    }).filter(Boolean).flat();
  });
  React2.useEffect(() => {
    if (disabled) return;
    if (!modal) return;
    function onKeyDown(event) {
      if (event.key === "Tab") {
        if (contains(floatingFocusElement, activeElement(getDocument(floatingFocusElement))) && getTabbableContent().length === 0 && !isUntrappedTypeableCombobox) {
          stopEvent(event);
        }
        const els = getTabbableElements();
        const target = getTarget(event);
        if (orderRef.current[0] === "reference" && target === domReference) {
          stopEvent(event);
          if (event.shiftKey) {
            enqueueFocus(els[els.length - 1]);
          } else {
            enqueueFocus(els[1]);
          }
        }
        if (orderRef.current[1] === "floating" && target === floatingFocusElement && event.shiftKey) {
          stopEvent(event);
          enqueueFocus(els[0]);
        }
      }
    }
    const doc = getDocument(floatingFocusElement);
    doc.addEventListener("keydown", onKeyDown);
    return () => {
      doc.removeEventListener("keydown", onKeyDown);
    };
  }, [disabled, domReference, floatingFocusElement, modal, orderRef, isUntrappedTypeableCombobox, getTabbableContent, getTabbableElements]);
  React2.useEffect(() => {
    if (disabled) return;
    if (!floating) return;
    function handleFocusIn(event) {
      const target = getTarget(event);
      const tabbableContent = getTabbableContent();
      const tabbableIndex = tabbableContent.indexOf(target);
      if (tabbableIndex !== -1) {
        tabbableIndexRef.current = tabbableIndex;
      }
    }
    floating.addEventListener("focusin", handleFocusIn);
    return () => {
      floating.removeEventListener("focusin", handleFocusIn);
    };
  }, [disabled, floating, getTabbableContent]);
  React2.useEffect(() => {
    if (disabled) return;
    if (!closeOnFocusOut) return;
    function handlePointerDown() {
      isPointerDownRef.current = true;
      setTimeout(() => {
        isPointerDownRef.current = false;
      });
    }
    function handleFocusOutside(event) {
      const relatedTarget = event.relatedTarget;
      const currentTarget = event.currentTarget;
      const target = getTarget(event);
      queueMicrotask(() => {
        const nodeId = getNodeId();
        const movedToUnrelatedNode = !(contains(domReference, relatedTarget) || contains(floating, relatedTarget) || contains(relatedTarget, floating) || contains(portalContext == null ? void 0 : portalContext.portalNode, relatedTarget) || relatedTarget != null && relatedTarget.hasAttribute(createAttribute("focus-guard")) || tree && (getNodeChildren(tree.nodesRef.current, nodeId).find((node) => {
          var _node$context, _node$context2;
          return contains((_node$context = node.context) == null ? void 0 : _node$context.elements.floating, relatedTarget) || contains((_node$context2 = node.context) == null ? void 0 : _node$context2.elements.domReference, relatedTarget);
        }) || getNodeAncestors(tree.nodesRef.current, nodeId).find((node) => {
          var _node$context3, _node$context4, _node$context5;
          return [(_node$context3 = node.context) == null ? void 0 : _node$context3.elements.floating, getFloatingFocusElement((_node$context4 = node.context) == null ? void 0 : _node$context4.elements.floating)].includes(relatedTarget) || ((_node$context5 = node.context) == null ? void 0 : _node$context5.elements.domReference) === relatedTarget;
        })));
        if (currentTarget === domReference && floatingFocusElement) {
          handleTabIndex(floatingFocusElement, orderRef);
        }
        if (restoreFocus && currentTarget !== domReference && !(target != null && target.isConnected) && activeElement(getDocument(floatingFocusElement)) === getDocument(floatingFocusElement).body) {
          if (isHTMLElement(floatingFocusElement)) {
            floatingFocusElement.focus();
          }
          const prevTabbableIndex = tabbableIndexRef.current;
          const tabbableContent = getTabbableContent();
          const nodeToFocus = tabbableContent[prevTabbableIndex] || tabbableContent[tabbableContent.length - 1] || floatingFocusElement;
          if (isHTMLElement(nodeToFocus)) {
            nodeToFocus.focus();
          }
        }
        if (dataRef.current.insideReactTree) {
          dataRef.current.insideReactTree = false;
          return;
        }
        if ((isUntrappedTypeableCombobox ? true : !modal) && relatedTarget && movedToUnrelatedNode && !isPointerDownRef.current && // Fix React 18 Strict Mode returnFocus due to double rendering.
        relatedTarget !== getPreviouslyFocusedElement()) {
          preventReturnFocusRef.current = true;
          onOpenChange(false, event, "focus-out");
        }
      });
    }
    const shouldHandleBlurCapture = Boolean(!tree && portalContext);
    function markInsideReactTree() {
      clearTimeoutIfSet(blurTimeoutRef);
      dataRef.current.insideReactTree = true;
      blurTimeoutRef.current = window.setTimeout(() => {
        dataRef.current.insideReactTree = false;
      });
    }
    if (floating && isHTMLElement(domReference)) {
      domReference.addEventListener("focusout", handleFocusOutside);
      domReference.addEventListener("pointerdown", handlePointerDown);
      floating.addEventListener("focusout", handleFocusOutside);
      if (shouldHandleBlurCapture) {
        floating.addEventListener("focusout", markInsideReactTree, true);
      }
      return () => {
        domReference.removeEventListener("focusout", handleFocusOutside);
        domReference.removeEventListener("pointerdown", handlePointerDown);
        floating.removeEventListener("focusout", handleFocusOutside);
        if (shouldHandleBlurCapture) {
          floating.removeEventListener("focusout", markInsideReactTree, true);
        }
      };
    }
  }, [disabled, domReference, floating, floatingFocusElement, modal, tree, portalContext, onOpenChange, closeOnFocusOut, restoreFocus, getTabbableContent, isUntrappedTypeableCombobox, getNodeId, orderRef, dataRef]);
  const beforeGuardRef = React2.useRef(null);
  const afterGuardRef = React2.useRef(null);
  const mergedBeforeGuardRef = useLiteMergeRefs([beforeGuardRef, portalContext == null ? void 0 : portalContext.beforeInsideRef]);
  const mergedAfterGuardRef = useLiteMergeRefs([afterGuardRef, portalContext == null ? void 0 : portalContext.afterInsideRef]);
  React2.useEffect(() => {
    var _portalContext$portal, _ancestors$find;
    if (disabled) return;
    if (!floating) return;
    const portalNodes = Array.from((portalContext == null || (_portalContext$portal = portalContext.portalNode) == null ? void 0 : _portalContext$portal.querySelectorAll("[" + createAttribute("portal") + "]")) || []);
    const ancestors = tree ? getNodeAncestors(tree.nodesRef.current, getNodeId()) : [];
    const rootAncestorComboboxDomReference = (_ancestors$find = ancestors.find((node) => {
      var _node$context6;
      return isTypeableCombobox(((_node$context6 = node.context) == null ? void 0 : _node$context6.elements.domReference) || null);
    })) == null || (_ancestors$find = _ancestors$find.context) == null ? void 0 : _ancestors$find.elements.domReference;
    const insideElements = [floating, rootAncestorComboboxDomReference, ...portalNodes, ...getInsideElements(), startDismissButtonRef.current, endDismissButtonRef.current, beforeGuardRef.current, afterGuardRef.current, portalContext == null ? void 0 : portalContext.beforeOutsideRef.current, portalContext == null ? void 0 : portalContext.afterOutsideRef.current, orderRef.current.includes("reference") || isUntrappedTypeableCombobox ? domReference : null].filter((x2) => x2 != null);
    const cleanup2 = modal || isUntrappedTypeableCombobox ? markOthers(insideElements, !useInert, useInert) : markOthers(insideElements);
    return () => {
      cleanup2();
    };
  }, [disabled, domReference, floating, modal, orderRef, portalContext, isUntrappedTypeableCombobox, guards, useInert, tree, getNodeId, getInsideElements]);
  index(() => {
    if (disabled || !isHTMLElement(floatingFocusElement)) return;
    const doc = getDocument(floatingFocusElement);
    const previouslyFocusedElement = activeElement(doc);
    queueMicrotask(() => {
      const focusableElements = getTabbableElements(floatingFocusElement);
      const initialFocusValue = initialFocusRef.current;
      const elToFocus = (typeof initialFocusValue === "number" ? focusableElements[initialFocusValue] : initialFocusValue.current) || floatingFocusElement;
      const focusAlreadyInsideFloatingEl = contains(floatingFocusElement, previouslyFocusedElement);
      if (!ignoreInitialFocus && !focusAlreadyInsideFloatingEl && open) {
        enqueueFocus(elToFocus, {
          preventScroll: elToFocus === floatingFocusElement
        });
      }
    });
  }, [disabled, open, floatingFocusElement, ignoreInitialFocus, getTabbableElements, initialFocusRef]);
  index(() => {
    if (disabled || !floatingFocusElement) return;
    const doc = getDocument(floatingFocusElement);
    const previouslyFocusedElement = activeElement(doc);
    addPreviouslyFocusedElement(previouslyFocusedElement);
    function onOpenChange2(_ref) {
      let {
        reason,
        event,
        nested
      } = _ref;
      if (["hover", "safe-polygon"].includes(reason) && event.type === "mouseleave") {
        preventReturnFocusRef.current = true;
      }
      if (reason !== "outside-press") return;
      if (nested) {
        preventReturnFocusRef.current = false;
      } else if (isVirtualClick(event) || isVirtualPointerEvent(event)) {
        preventReturnFocusRef.current = false;
      } else {
        let isPreventScrollSupported = false;
        document.createElement("div").focus({
          get preventScroll() {
            isPreventScrollSupported = true;
            return false;
          }
        });
        if (isPreventScrollSupported) {
          preventReturnFocusRef.current = false;
        } else {
          preventReturnFocusRef.current = true;
        }
      }
    }
    events.on("openchange", onOpenChange2);
    const fallbackEl = doc.createElement("span");
    fallbackEl.setAttribute("tabindex", "-1");
    fallbackEl.setAttribute("aria-hidden", "true");
    Object.assign(fallbackEl.style, HIDDEN_STYLES);
    if (isInsidePortal && domReference) {
      domReference.insertAdjacentElement("afterend", fallbackEl);
    }
    function getReturnElement() {
      if (typeof returnFocusRef.current === "boolean") {
        const el2 = domReference || getPreviouslyFocusedElement();
        return el2 && el2.isConnected ? el2 : fallbackEl;
      }
      return returnFocusRef.current.current || fallbackEl;
    }
    return () => {
      events.off("openchange", onOpenChange2);
      const activeEl = activeElement(doc);
      const isFocusInsideFloatingTree = contains(floating, activeEl) || tree && getNodeChildren(tree.nodesRef.current, getNodeId(), false).some((node) => {
        var _node$context7;
        return contains((_node$context7 = node.context) == null ? void 0 : _node$context7.elements.floating, activeEl);
      });
      const returnElement = getReturnElement();
      queueMicrotask(() => {
        const tabbableReturnElement = getFirstTabbableElement(returnElement);
        if (
          // eslint-disable-next-line react-hooks/exhaustive-deps
          returnFocusRef.current && !preventReturnFocusRef.current && isHTMLElement(tabbableReturnElement) && // If the focus moved somewhere else after mount, avoid returning focus
          // since it likely entered a different element which should be
          // respected: https://github.com/floating-ui/floating-ui/issues/2607
          (tabbableReturnElement !== activeEl && activeEl !== doc.body ? isFocusInsideFloatingTree : true)
        ) {
          tabbableReturnElement.focus({
            preventScroll: true
          });
        }
        fallbackEl.remove();
      });
    };
  }, [disabled, floating, floatingFocusElement, returnFocusRef, dataRef, events, tree, isInsidePortal, domReference, getNodeId]);
  React2.useEffect(() => {
    queueMicrotask(() => {
      preventReturnFocusRef.current = false;
    });
    return () => {
      queueMicrotask(clearDisconnectedPreviouslyFocusedElements);
    };
  }, [disabled]);
  index(() => {
    if (disabled) return;
    if (!portalContext) return;
    portalContext.setFocusManagerState({
      modal,
      closeOnFocusOut,
      open,
      onOpenChange,
      domReference
    });
    return () => {
      portalContext.setFocusManagerState(null);
    };
  }, [disabled, portalContext, modal, open, onOpenChange, closeOnFocusOut, domReference]);
  index(() => {
    if (disabled) return;
    if (!floatingFocusElement) return;
    handleTabIndex(floatingFocusElement, orderRef);
  }, [disabled, floatingFocusElement, orderRef]);
  function renderDismissButton(location) {
    if (disabled || !visuallyHiddenDismiss || !modal) {
      return null;
    }
    return (0, import_jsx_runtime.jsx)(VisuallyHiddenDismiss, {
      ref: location === "start" ? startDismissButtonRef : endDismissButtonRef,
      onClick: (event) => onOpenChange(false, event.nativeEvent),
      children: typeof visuallyHiddenDismiss === "string" ? visuallyHiddenDismiss : "Dismiss"
    });
  }
  const shouldRenderGuards = !disabled && guards && (modal ? !isUntrappedTypeableCombobox : true) && (isInsidePortal || modal);
  return (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, {
    children: [shouldRenderGuards && (0, import_jsx_runtime.jsx)(FocusGuard, {
      "data-type": "inside",
      ref: mergedBeforeGuardRef,
      onFocus: (event) => {
        if (modal) {
          const els = getTabbableElements();
          enqueueFocus(order[0] === "reference" ? els[0] : els[els.length - 1]);
        } else if (portalContext != null && portalContext.preserveTabOrder && portalContext.portalNode) {
          preventReturnFocusRef.current = false;
          if (isOutsideEvent(event, portalContext.portalNode)) {
            const nextTabbable = getNextTabbable(domReference);
            nextTabbable == null || nextTabbable.focus();
          } else {
            var _portalContext$before;
            (_portalContext$before = portalContext.beforeOutsideRef.current) == null || _portalContext$before.focus();
          }
        }
      }
    }), !isUntrappedTypeableCombobox && renderDismissButton("start"), children, renderDismissButton("end"), shouldRenderGuards && (0, import_jsx_runtime.jsx)(FocusGuard, {
      "data-type": "inside",
      ref: mergedAfterGuardRef,
      onFocus: (event) => {
        if (modal) {
          enqueueFocus(getTabbableElements()[0]);
        } else if (portalContext != null && portalContext.preserveTabOrder && portalContext.portalNode) {
          if (closeOnFocusOut) {
            preventReturnFocusRef.current = true;
          }
          if (isOutsideEvent(event, portalContext.portalNode)) {
            const prevTabbable = getPreviousTabbable(domReference);
            prevTabbable == null || prevTabbable.focus();
          } else {
            var _portalContext$afterO;
            (_portalContext$afterO = portalContext.afterOutsideRef.current) == null || _portalContext$afterO.focus();
          }
        }
      }
    })]
  });
}
var lockCount = 0;
var scrollbarProperty = "--floating-ui-scrollbar-width";
function enableScrollLock() {
  const platform2 = getPlatform();
  const isIOS = /iP(hone|ad|od)|iOS/.test(platform2) || // iPads can claim to be MacIntel
  platform2 === "MacIntel" && navigator.maxTouchPoints > 1;
  const bodyStyle = document.body.style;
  const scrollbarX = Math.round(document.documentElement.getBoundingClientRect().left) + document.documentElement.scrollLeft;
  const paddingProp = scrollbarX ? "paddingLeft" : "paddingRight";
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  const scrollX = bodyStyle.left ? parseFloat(bodyStyle.left) : window.scrollX;
  const scrollY = bodyStyle.top ? parseFloat(bodyStyle.top) : window.scrollY;
  bodyStyle.overflow = "hidden";
  bodyStyle.setProperty(scrollbarProperty, scrollbarWidth + "px");
  if (scrollbarWidth) {
    bodyStyle[paddingProp] = scrollbarWidth + "px";
  }
  if (isIOS) {
    var _window$visualViewpor, _window$visualViewpor2;
    const offsetLeft = ((_window$visualViewpor = window.visualViewport) == null ? void 0 : _window$visualViewpor.offsetLeft) || 0;
    const offsetTop = ((_window$visualViewpor2 = window.visualViewport) == null ? void 0 : _window$visualViewpor2.offsetTop) || 0;
    Object.assign(bodyStyle, {
      position: "fixed",
      top: -(scrollY - Math.floor(offsetTop)) + "px",
      left: -(scrollX - Math.floor(offsetLeft)) + "px",
      right: "0"
    });
  }
  return () => {
    Object.assign(bodyStyle, {
      overflow: "",
      [paddingProp]: ""
    });
    bodyStyle.removeProperty(scrollbarProperty);
    if (isIOS) {
      Object.assign(bodyStyle, {
        position: "",
        top: "",
        left: "",
        right: ""
      });
      window.scrollTo(scrollX, scrollY);
    }
  };
}
var cleanup = () => {
};
var FloatingOverlay = React2.forwardRef(function FloatingOverlay2(props, ref) {
  const {
    lockScroll = false,
    ...rest
  } = props;
  index(() => {
    if (!lockScroll) return;
    lockCount++;
    if (lockCount === 1) {
      cleanup = enableScrollLock();
    }
    return () => {
      lockCount--;
      if (lockCount === 0) {
        cleanup();
      }
    };
  }, [lockScroll]);
  return (0, import_jsx_runtime.jsx)("div", {
    ref,
    ...rest,
    style: {
      position: "fixed",
      overflow: "auto",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      ...rest.style
    }
  });
});
var bubbleHandlerKeys = {
  pointerdown: "onPointerDown",
  mousedown: "onMouseDown",
  click: "onClick"
};
var captureHandlerKeys = {
  pointerdown: "onPointerDownCapture",
  mousedown: "onMouseDownCapture",
  click: "onClickCapture"
};
var normalizeProp = (normalizable) => {
  var _normalizable$escapeK, _normalizable$outside;
  return {
    escapeKey: typeof normalizable === "boolean" ? normalizable : (_normalizable$escapeK = normalizable == null ? void 0 : normalizable.escapeKey) != null ? _normalizable$escapeK : false,
    outsidePress: typeof normalizable === "boolean" ? normalizable : (_normalizable$outside = normalizable == null ? void 0 : normalizable.outsidePress) != null ? _normalizable$outside : true
  };
};
function useDismiss(context, props) {
  if (props === void 0) {
    props = {};
  }
  const {
    open,
    onOpenChange,
    elements,
    dataRef
  } = context;
  const {
    enabled = true,
    escapeKey = true,
    outsidePress: unstable_outsidePress = true,
    outsidePressEvent = "pointerdown",
    referencePress = false,
    referencePressEvent = "pointerdown",
    ancestorScroll = false,
    bubbles,
    capture
  } = props;
  const tree = useFloatingTree();
  const outsidePressFn = useEffectEvent(typeof unstable_outsidePress === "function" ? unstable_outsidePress : () => false);
  const outsidePress = typeof unstable_outsidePress === "function" ? outsidePressFn : unstable_outsidePress;
  const endedOrStartedInsideRef = React2.useRef(false);
  const {
    escapeKey: escapeKeyBubbles,
    outsidePress: outsidePressBubbles
  } = normalizeProp(bubbles);
  const {
    escapeKey: escapeKeyCapture,
    outsidePress: outsidePressCapture
  } = normalizeProp(capture);
  const isComposingRef = React2.useRef(false);
  const closeOnEscapeKeyDown = useEffectEvent((event) => {
    var _dataRef$current$floa;
    if (!open || !enabled || !escapeKey || event.key !== "Escape") {
      return;
    }
    if (isComposingRef.current) {
      return;
    }
    const nodeId = (_dataRef$current$floa = dataRef.current.floatingContext) == null ? void 0 : _dataRef$current$floa.nodeId;
    const children = tree ? getNodeChildren(tree.nodesRef.current, nodeId) : [];
    if (!escapeKeyBubbles) {
      event.stopPropagation();
      if (children.length > 0) {
        let shouldDismiss = true;
        children.forEach((child) => {
          var _child$context;
          if ((_child$context = child.context) != null && _child$context.open && !child.context.dataRef.current.__escapeKeyBubbles) {
            shouldDismiss = false;
            return;
          }
        });
        if (!shouldDismiss) {
          return;
        }
      }
    }
    onOpenChange(false, isReactEvent(event) ? event.nativeEvent : event, "escape-key");
  });
  const closeOnEscapeKeyDownCapture = useEffectEvent((event) => {
    var _getTarget2;
    const callback = () => {
      var _getTarget;
      closeOnEscapeKeyDown(event);
      (_getTarget = getTarget(event)) == null || _getTarget.removeEventListener("keydown", callback);
    };
    (_getTarget2 = getTarget(event)) == null || _getTarget2.addEventListener("keydown", callback);
  });
  const closeOnPressOutside = useEffectEvent((event) => {
    var _dataRef$current$floa2;
    const insideReactTree = dataRef.current.insideReactTree;
    dataRef.current.insideReactTree = false;
    const endedOrStartedInside = endedOrStartedInsideRef.current;
    endedOrStartedInsideRef.current = false;
    if (outsidePressEvent === "click" && endedOrStartedInside) {
      return;
    }
    if (insideReactTree) {
      return;
    }
    if (typeof outsidePress === "function" && !outsidePress(event)) {
      return;
    }
    const target = getTarget(event);
    const inertSelector = "[" + createAttribute("inert") + "]";
    const markers = getDocument(elements.floating).querySelectorAll(inertSelector);
    let targetRootAncestor = isElement(target) ? target : null;
    while (targetRootAncestor && !isLastTraversableNode(targetRootAncestor)) {
      const nextParent = getParentNode(targetRootAncestor);
      if (isLastTraversableNode(nextParent) || !isElement(nextParent)) {
        break;
      }
      targetRootAncestor = nextParent;
    }
    if (markers.length && isElement(target) && !isRootElement(target) && // Clicked on a direct ancestor (e.g. FloatingOverlay).
    !contains(target, elements.floating) && // If the target root element contains none of the markers, then the
    // element was injected after the floating element rendered.
    Array.from(markers).every((marker) => !contains(targetRootAncestor, marker))) {
      return;
    }
    if (isHTMLElement(target) && floating) {
      const lastTraversableNode = isLastTraversableNode(target);
      const style = getComputedStyle2(target);
      const scrollRe = /auto|scroll/;
      const isScrollableX = lastTraversableNode || scrollRe.test(style.overflowX);
      const isScrollableY = lastTraversableNode || scrollRe.test(style.overflowY);
      const canScrollX = isScrollableX && target.clientWidth > 0 && target.scrollWidth > target.clientWidth;
      const canScrollY = isScrollableY && target.clientHeight > 0 && target.scrollHeight > target.clientHeight;
      const isRTL = style.direction === "rtl";
      const pressedVerticalScrollbar = canScrollY && (isRTL ? event.offsetX <= target.offsetWidth - target.clientWidth : event.offsetX > target.clientWidth);
      const pressedHorizontalScrollbar = canScrollX && event.offsetY > target.clientHeight;
      if (pressedVerticalScrollbar || pressedHorizontalScrollbar) {
        return;
      }
    }
    const nodeId = (_dataRef$current$floa2 = dataRef.current.floatingContext) == null ? void 0 : _dataRef$current$floa2.nodeId;
    const targetIsInsideChildren = tree && getNodeChildren(tree.nodesRef.current, nodeId).some((node) => {
      var _node$context;
      return isEventTargetWithin(event, (_node$context = node.context) == null ? void 0 : _node$context.elements.floating);
    });
    if (isEventTargetWithin(event, elements.floating) || isEventTargetWithin(event, elements.domReference) || targetIsInsideChildren) {
      return;
    }
    const children = tree ? getNodeChildren(tree.nodesRef.current, nodeId) : [];
    if (children.length > 0) {
      let shouldDismiss = true;
      children.forEach((child) => {
        var _child$context2;
        if ((_child$context2 = child.context) != null && _child$context2.open && !child.context.dataRef.current.__outsidePressBubbles) {
          shouldDismiss = false;
          return;
        }
      });
      if (!shouldDismiss) {
        return;
      }
    }
    onOpenChange(false, event, "outside-press");
  });
  const closeOnPressOutsideCapture = useEffectEvent((event) => {
    var _getTarget4;
    const callback = () => {
      var _getTarget3;
      closeOnPressOutside(event);
      (_getTarget3 = getTarget(event)) == null || _getTarget3.removeEventListener(outsidePressEvent, callback);
    };
    (_getTarget4 = getTarget(event)) == null || _getTarget4.addEventListener(outsidePressEvent, callback);
  });
  React2.useEffect(() => {
    if (!open || !enabled) {
      return;
    }
    dataRef.current.__escapeKeyBubbles = escapeKeyBubbles;
    dataRef.current.__outsidePressBubbles = outsidePressBubbles;
    let compositionTimeout = -1;
    function onScroll(event) {
      onOpenChange(false, event, "ancestor-scroll");
    }
    function handleCompositionStart() {
      window.clearTimeout(compositionTimeout);
      isComposingRef.current = true;
    }
    function handleCompositionEnd() {
      compositionTimeout = window.setTimeout(
        () => {
          isComposingRef.current = false;
        },
        // 0ms or 1ms don't work in Safari. 5ms appears to consistently work.
        // Only apply to WebKit for the test to remain 0ms.
        isWebKit() ? 5 : 0
      );
    }
    const doc = getDocument(elements.floating);
    if (escapeKey) {
      doc.addEventListener("keydown", escapeKeyCapture ? closeOnEscapeKeyDownCapture : closeOnEscapeKeyDown, escapeKeyCapture);
      doc.addEventListener("compositionstart", handleCompositionStart);
      doc.addEventListener("compositionend", handleCompositionEnd);
    }
    outsidePress && doc.addEventListener(outsidePressEvent, outsidePressCapture ? closeOnPressOutsideCapture : closeOnPressOutside, outsidePressCapture);
    let ancestors = [];
    if (ancestorScroll) {
      if (isElement(elements.domReference)) {
        ancestors = getOverflowAncestors(elements.domReference);
      }
      if (isElement(elements.floating)) {
        ancestors = ancestors.concat(getOverflowAncestors(elements.floating));
      }
      if (!isElement(elements.reference) && elements.reference && elements.reference.contextElement) {
        ancestors = ancestors.concat(getOverflowAncestors(elements.reference.contextElement));
      }
    }
    ancestors = ancestors.filter((ancestor) => {
      var _doc$defaultView;
      return ancestor !== ((_doc$defaultView = doc.defaultView) == null ? void 0 : _doc$defaultView.visualViewport);
    });
    ancestors.forEach((ancestor) => {
      ancestor.addEventListener("scroll", onScroll, {
        passive: true
      });
    });
    return () => {
      if (escapeKey) {
        doc.removeEventListener("keydown", escapeKeyCapture ? closeOnEscapeKeyDownCapture : closeOnEscapeKeyDown, escapeKeyCapture);
        doc.removeEventListener("compositionstart", handleCompositionStart);
        doc.removeEventListener("compositionend", handleCompositionEnd);
      }
      outsidePress && doc.removeEventListener(outsidePressEvent, outsidePressCapture ? closeOnPressOutsideCapture : closeOnPressOutside, outsidePressCapture);
      ancestors.forEach((ancestor) => {
        ancestor.removeEventListener("scroll", onScroll);
      });
      window.clearTimeout(compositionTimeout);
    };
  }, [dataRef, elements, escapeKey, outsidePress, outsidePressEvent, open, onOpenChange, ancestorScroll, enabled, escapeKeyBubbles, outsidePressBubbles, closeOnEscapeKeyDown, escapeKeyCapture, closeOnEscapeKeyDownCapture, closeOnPressOutside, outsidePressCapture, closeOnPressOutsideCapture]);
  React2.useEffect(() => {
    dataRef.current.insideReactTree = false;
  }, [dataRef, outsidePress, outsidePressEvent]);
  const reference = React2.useMemo(() => ({
    onKeyDown: closeOnEscapeKeyDown,
    ...referencePress && {
      [bubbleHandlerKeys[referencePressEvent]]: (event) => {
        onOpenChange(false, event.nativeEvent, "reference-press");
      },
      ...referencePressEvent !== "click" && {
        onClick(event) {
          onOpenChange(false, event.nativeEvent, "reference-press");
        }
      }
    }
  }), [closeOnEscapeKeyDown, onOpenChange, referencePress, referencePressEvent]);
  const floating = React2.useMemo(() => {
    function setMouseDownOrUpInside(event) {
      if (event.button !== 0) {
        return;
      }
      endedOrStartedInsideRef.current = true;
    }
    return {
      onKeyDown: closeOnEscapeKeyDown,
      onMouseDown: setMouseDownOrUpInside,
      onMouseUp: setMouseDownOrUpInside,
      [captureHandlerKeys[outsidePressEvent]]: () => {
        dataRef.current.insideReactTree = true;
      }
    };
  }, [closeOnEscapeKeyDown, outsidePressEvent, dataRef]);
  return React2.useMemo(() => enabled ? {
    reference,
    floating
  } : {}, [enabled, reference, floating]);
}
function useFloatingRootContext(options) {
  const {
    open = false,
    onOpenChange: onOpenChangeProp,
    elements: elementsProp
  } = options;
  const floatingId = useId();
  const dataRef = React2.useRef({});
  const [events] = React2.useState(() => createEventEmitter());
  const nested = useFloatingParentNodeId() != null;
  if (true) {
    const optionDomReference = elementsProp.reference;
    if (optionDomReference && !isElement(optionDomReference)) {
      error("Cannot pass a virtual element to the `elements.reference` option,", "as it must be a real DOM element. Use `refs.setPositionReference()`", "instead.");
    }
  }
  const [positionReference, setPositionReference] = React2.useState(elementsProp.reference);
  const onOpenChange = useEffectEvent((open2, event, reason) => {
    dataRef.current.openEvent = open2 ? event : void 0;
    events.emit("openchange", {
      open: open2,
      event,
      reason,
      nested
    });
    onOpenChangeProp == null || onOpenChangeProp(open2, event, reason);
  });
  const refs = React2.useMemo(() => ({
    setPositionReference
  }), []);
  const elements = React2.useMemo(() => ({
    reference: positionReference || elementsProp.reference || null,
    floating: elementsProp.floating || null,
    domReference: elementsProp.reference
  }), [positionReference, elementsProp.reference, elementsProp.floating]);
  return React2.useMemo(() => ({
    dataRef,
    open,
    onOpenChange,
    elements,
    events,
    floatingId,
    refs
  }), [open, onOpenChange, elements, events, floatingId, refs]);
}
function useFloating2(options) {
  if (options === void 0) {
    options = {};
  }
  const {
    nodeId
  } = options;
  const internalRootContext = useFloatingRootContext({
    ...options,
    elements: {
      reference: null,
      floating: null,
      ...options.elements
    }
  });
  const rootContext = options.rootContext || internalRootContext;
  const computedElements = rootContext.elements;
  const [_domReference, setDomReference] = React2.useState(null);
  const [positionReference, _setPositionReference] = React2.useState(null);
  const optionDomReference = computedElements == null ? void 0 : computedElements.domReference;
  const domReference = optionDomReference || _domReference;
  const domReferenceRef = React2.useRef(null);
  const tree = useFloatingTree();
  index(() => {
    if (domReference) {
      domReferenceRef.current = domReference;
    }
  }, [domReference]);
  const position = useFloating({
    ...options,
    elements: {
      ...computedElements,
      ...positionReference && {
        reference: positionReference
      }
    }
  });
  const setPositionReference = React2.useCallback((node) => {
    const computedPositionReference = isElement(node) ? {
      getBoundingClientRect: () => node.getBoundingClientRect(),
      getClientRects: () => node.getClientRects(),
      contextElement: node
    } : node;
    _setPositionReference(computedPositionReference);
    position.refs.setReference(computedPositionReference);
  }, [position.refs]);
  const setReference = React2.useCallback((node) => {
    if (isElement(node) || node === null) {
      domReferenceRef.current = node;
      setDomReference(node);
    }
    if (isElement(position.refs.reference.current) || position.refs.reference.current === null || // Don't allow setting virtual elements using the old technique back to
    // `null` to support `positionReference` + an unstable `reference`
    // callback ref.
    node !== null && !isElement(node)) {
      position.refs.setReference(node);
    }
  }, [position.refs]);
  const refs = React2.useMemo(() => ({
    ...position.refs,
    setReference,
    setPositionReference,
    domReference: domReferenceRef
  }), [position.refs, setReference, setPositionReference]);
  const elements = React2.useMemo(() => ({
    ...position.elements,
    domReference
  }), [position.elements, domReference]);
  const context = React2.useMemo(() => ({
    ...position,
    ...rootContext,
    refs,
    elements,
    nodeId
  }), [position, refs, elements, nodeId, rootContext]);
  index(() => {
    rootContext.dataRef.current.floatingContext = context;
    const node = tree == null ? void 0 : tree.nodesRef.current.find((node2) => node2.id === nodeId);
    if (node) {
      node.context = context;
    }
  });
  return React2.useMemo(() => ({
    ...position,
    context,
    refs,
    elements
  }), [position, refs, elements, context]);
}
function isMacSafari() {
  return isMac() && isSafari();
}
function useFocus(context, props) {
  if (props === void 0) {
    props = {};
  }
  const {
    open,
    onOpenChange,
    events,
    dataRef,
    elements
  } = context;
  const {
    enabled = true,
    visibleOnly = true
  } = props;
  const blockFocusRef = React2.useRef(false);
  const timeoutRef = React2.useRef(-1);
  const keyboardModalityRef = React2.useRef(true);
  React2.useEffect(() => {
    if (!enabled) return;
    const win = getWindow(elements.domReference);
    function onBlur() {
      if (!open && isHTMLElement(elements.domReference) && elements.domReference === activeElement(getDocument(elements.domReference))) {
        blockFocusRef.current = true;
      }
    }
    function onKeyDown() {
      keyboardModalityRef.current = true;
    }
    function onPointerDown() {
      keyboardModalityRef.current = false;
    }
    win.addEventListener("blur", onBlur);
    if (isMacSafari()) {
      win.addEventListener("keydown", onKeyDown, true);
      win.addEventListener("pointerdown", onPointerDown, true);
    }
    return () => {
      win.removeEventListener("blur", onBlur);
      if (isMacSafari()) {
        win.removeEventListener("keydown", onKeyDown, true);
        win.removeEventListener("pointerdown", onPointerDown, true);
      }
    };
  }, [elements.domReference, open, enabled]);
  React2.useEffect(() => {
    if (!enabled) return;
    function onOpenChange2(_ref) {
      let {
        reason
      } = _ref;
      if (reason === "reference-press" || reason === "escape-key") {
        blockFocusRef.current = true;
      }
    }
    events.on("openchange", onOpenChange2);
    return () => {
      events.off("openchange", onOpenChange2);
    };
  }, [events, enabled]);
  React2.useEffect(() => {
    return () => {
      clearTimeoutIfSet(timeoutRef);
    };
  }, []);
  const reference = React2.useMemo(() => ({
    onMouseLeave() {
      blockFocusRef.current = false;
    },
    onFocus(event) {
      if (blockFocusRef.current) return;
      const target = getTarget(event.nativeEvent);
      if (visibleOnly && isElement(target)) {
        if (isMacSafari() && !event.relatedTarget) {
          if (!keyboardModalityRef.current && !isTypeableElement(target)) {
            return;
          }
        } else if (!matchesFocusVisible(target)) {
          return;
        }
      }
      onOpenChange(true, event.nativeEvent, "focus");
    },
    onBlur(event) {
      blockFocusRef.current = false;
      const relatedTarget = event.relatedTarget;
      const nativeEvent = event.nativeEvent;
      const movedToFocusGuard = isElement(relatedTarget) && relatedTarget.hasAttribute(createAttribute("focus-guard")) && relatedTarget.getAttribute("data-type") === "outside";
      timeoutRef.current = window.setTimeout(() => {
        var _dataRef$current$floa;
        const activeEl = activeElement(elements.domReference ? elements.domReference.ownerDocument : document);
        if (!relatedTarget && activeEl === elements.domReference) return;
        if (contains((_dataRef$current$floa = dataRef.current.floatingContext) == null ? void 0 : _dataRef$current$floa.refs.floating.current, activeEl) || contains(elements.domReference, activeEl) || movedToFocusGuard) {
          return;
        }
        onOpenChange(false, nativeEvent, "focus");
      });
    }
  }), [dataRef, elements.domReference, onOpenChange, visibleOnly]);
  return React2.useMemo(() => enabled ? {
    reference
  } : {}, [enabled, reference]);
}
function mergeProps(userProps, propsList, elementKey) {
  const map = /* @__PURE__ */ new Map();
  const isItem = elementKey === "item";
  let domUserProps = userProps;
  if (isItem && userProps) {
    const {
      [ACTIVE_KEY]: _2,
      [SELECTED_KEY]: __,
      ...validProps
    } = userProps;
    domUserProps = validProps;
  }
  return {
    ...elementKey === "floating" && {
      tabIndex: -1,
      [FOCUSABLE_ATTRIBUTE2]: ""
    },
    ...domUserProps,
    ...propsList.map((value) => {
      const propsOrGetProps = value ? value[elementKey] : null;
      if (typeof propsOrGetProps === "function") {
        return userProps ? propsOrGetProps(userProps) : null;
      }
      return propsOrGetProps;
    }).concat(userProps).reduce((acc, props) => {
      if (!props) {
        return acc;
      }
      Object.entries(props).forEach((_ref) => {
        let [key, value] = _ref;
        if (isItem && [ACTIVE_KEY, SELECTED_KEY].includes(key)) {
          return;
        }
        if (key.indexOf("on") === 0) {
          if (!map.has(key)) {
            map.set(key, []);
          }
          if (typeof value === "function") {
            var _map$get;
            (_map$get = map.get(key)) == null || _map$get.push(value);
            acc[key] = function() {
              var _map$get2;
              for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
                args[_key] = arguments[_key];
              }
              return (_map$get2 = map.get(key)) == null ? void 0 : _map$get2.map((fn2) => fn2(...args)).find((val) => val !== void 0);
            };
          }
        } else {
          acc[key] = value;
        }
      });
      return acc;
    }, {})
  };
}
function useInteractions(propsList) {
  if (propsList === void 0) {
    propsList = [];
  }
  const referenceDeps = propsList.map((key) => key == null ? void 0 : key.reference);
  const floatingDeps = propsList.map((key) => key == null ? void 0 : key.floating);
  const itemDeps = propsList.map((key) => key == null ? void 0 : key.item);
  const getReferenceProps = React2.useCallback(
    (userProps) => mergeProps(userProps, propsList, "reference"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    referenceDeps
  );
  const getFloatingProps = React2.useCallback(
    (userProps) => mergeProps(userProps, propsList, "floating"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    floatingDeps
  );
  const getItemProps = React2.useCallback(
    (userProps) => mergeProps(userProps, propsList, "item"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    itemDeps
  );
  return React2.useMemo(() => ({
    getReferenceProps,
    getFloatingProps,
    getItemProps
  }), [getReferenceProps, getFloatingProps, getItemProps]);
}
var componentRoleToAriaRoleMap = /* @__PURE__ */ new Map([["select", "listbox"], ["combobox", "listbox"], ["label", false]]);
function useRole(context, props) {
  var _elements$domReferenc, _componentRoleToAriaR;
  if (props === void 0) {
    props = {};
  }
  const {
    open,
    elements,
    floatingId: defaultFloatingId
  } = context;
  const {
    enabled = true,
    role = "dialog"
  } = props;
  const defaultReferenceId = useId();
  const referenceId = ((_elements$domReferenc = elements.domReference) == null ? void 0 : _elements$domReferenc.id) || defaultReferenceId;
  const floatingId = React2.useMemo(() => {
    var _getFloatingFocusElem;
    return ((_getFloatingFocusElem = getFloatingFocusElement(elements.floating)) == null ? void 0 : _getFloatingFocusElem.id) || defaultFloatingId;
  }, [elements.floating, defaultFloatingId]);
  const ariaRole = (_componentRoleToAriaR = componentRoleToAriaRoleMap.get(role)) != null ? _componentRoleToAriaR : role;
  const parentId = useFloatingParentNodeId();
  const isNested = parentId != null;
  const reference = React2.useMemo(() => {
    if (ariaRole === "tooltip" || role === "label") {
      return {
        ["aria-" + (role === "label" ? "labelledby" : "describedby")]: open ? floatingId : void 0
      };
    }
    return {
      "aria-expanded": open ? "true" : "false",
      "aria-haspopup": ariaRole === "alertdialog" ? "dialog" : ariaRole,
      "aria-controls": open ? floatingId : void 0,
      ...ariaRole === "listbox" && {
        role: "combobox"
      },
      ...ariaRole === "menu" && {
        id: referenceId
      },
      ...ariaRole === "menu" && isNested && {
        role: "menuitem"
      },
      ...role === "select" && {
        "aria-autocomplete": "none"
      },
      ...role === "combobox" && {
        "aria-autocomplete": "list"
      }
    };
  }, [ariaRole, floatingId, isNested, open, referenceId, role]);
  const floating = React2.useMemo(() => {
    const floatingProps = {
      id: floatingId,
      ...ariaRole && {
        role: ariaRole
      }
    };
    if (ariaRole === "tooltip" || role === "label") {
      return floatingProps;
    }
    return {
      ...floatingProps,
      ...ariaRole === "menu" && {
        "aria-labelledby": referenceId
      }
    };
  }, [ariaRole, floatingId, referenceId, role]);
  const item = React2.useCallback((_ref) => {
    let {
      active,
      selected
    } = _ref;
    const commonProps = {
      role: "option",
      ...active && {
        id: floatingId + "-fui-option"
      }
    };
    switch (role) {
      case "select":
      case "combobox":
        return {
          ...commonProps,
          "aria-selected": selected
        };
    }
    return {};
  }, [floatingId, role]);
  return React2.useMemo(() => enabled ? {
    reference,
    floating,
    item
  } : {}, [enabled, reference, floating, item]);
}
var camelCaseToKebabCase = (str) => str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($2, ofs) => (ofs ? "-" : "") + $2.toLowerCase());
function execWithArgsOrReturn(valueOrFn, args) {
  return typeof valueOrFn === "function" ? valueOrFn(args) : valueOrFn;
}
function useDelayUnmount(open, durationMs) {
  const [isMounted, setIsMounted] = React2.useState(open);
  if (open && !isMounted) {
    setIsMounted(true);
  }
  React2.useEffect(() => {
    if (!open && isMounted) {
      const timeout = setTimeout(() => setIsMounted(false), durationMs);
      return () => clearTimeout(timeout);
    }
  }, [open, isMounted, durationMs]);
  return isMounted;
}
function useTransitionStatus(context, props) {
  if (props === void 0) {
    props = {};
  }
  const {
    open,
    elements: {
      floating
    }
  } = context;
  const {
    duration = 250
  } = props;
  const isNumberDuration = typeof duration === "number";
  const closeDuration = (isNumberDuration ? duration : duration.close) || 0;
  const [status, setStatus] = React2.useState("unmounted");
  const isMounted = useDelayUnmount(open, closeDuration);
  if (!isMounted && status === "close") {
    setStatus("unmounted");
  }
  index(() => {
    if (!floating) return;
    if (open) {
      setStatus("initial");
      const frame = requestAnimationFrame(() => {
        ReactDOM.flushSync(() => {
          setStatus("open");
        });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    setStatus("close");
  }, [open, floating]);
  return {
    isMounted,
    status
  };
}
function useTransitionStyles(context, props) {
  if (props === void 0) {
    props = {};
  }
  const {
    initial: unstable_initial = {
      opacity: 0
    },
    open: unstable_open,
    close: unstable_close,
    common: unstable_common,
    duration = 250
  } = props;
  const placement = context.placement;
  const side = placement.split("-")[0];
  const fnArgs = React2.useMemo(() => ({
    side,
    placement
  }), [side, placement]);
  const isNumberDuration = typeof duration === "number";
  const openDuration = (isNumberDuration ? duration : duration.open) || 0;
  const closeDuration = (isNumberDuration ? duration : duration.close) || 0;
  const [styles, setStyles] = React2.useState(() => ({
    ...execWithArgsOrReturn(unstable_common, fnArgs),
    ...execWithArgsOrReturn(unstable_initial, fnArgs)
  }));
  const {
    isMounted,
    status
  } = useTransitionStatus(context, {
    duration
  });
  const initialRef = useLatestRef(unstable_initial);
  const openRef = useLatestRef(unstable_open);
  const closeRef = useLatestRef(unstable_close);
  const commonRef = useLatestRef(unstable_common);
  index(() => {
    const initialStyles = execWithArgsOrReturn(initialRef.current, fnArgs);
    const closeStyles = execWithArgsOrReturn(closeRef.current, fnArgs);
    const commonStyles = execWithArgsOrReturn(commonRef.current, fnArgs);
    const openStyles = execWithArgsOrReturn(openRef.current, fnArgs) || Object.keys(initialStyles).reduce((acc, key) => {
      acc[key] = "";
      return acc;
    }, {});
    if (status === "initial") {
      setStyles((styles2) => ({
        transitionProperty: styles2.transitionProperty,
        ...commonStyles,
        ...initialStyles
      }));
    }
    if (status === "open") {
      setStyles({
        transitionProperty: Object.keys(openStyles).map(camelCaseToKebabCase).join(","),
        transitionDuration: openDuration + "ms",
        ...commonStyles,
        ...openStyles
      });
    }
    if (status === "close") {
      const styles2 = closeStyles || initialStyles;
      setStyles({
        transitionProperty: Object.keys(styles2).map(camelCaseToKebabCase).join(","),
        transitionDuration: closeDuration + "ms",
        ...commonStyles,
        ...styles2
      });
    }
  }, [closeDuration, closeRef, initialRef, openRef, commonRef, openDuration, status, fnArgs]);
  return {
    isMounted,
    styles
  };
}
function getNodeChildren2(nodes, id, onlyOpenChildren) {
  if (onlyOpenChildren === void 0) {
    onlyOpenChildren = true;
  }
  const directChildren = nodes.filter((node) => {
    var _node$context;
    return node.parentId === id && (!onlyOpenChildren || ((_node$context = node.context) == null ? void 0 : _node$context.open));
  });
  return directChildren.flatMap((child) => [child, ...getNodeChildren2(nodes, child.id, onlyOpenChildren)]);
}
function isPointInPolygon(point, polygon) {
  const [x2, y2] = point;
  let isInside2 = false;
  const length = polygon.length;
  for (let i = 0, j = length - 1; i < length; j = i++) {
    const [xi2, yi2] = polygon[i] || [0, 0];
    const [xj, yj] = polygon[j] || [0, 0];
    const intersect = yi2 >= y2 !== yj >= y2 && x2 <= (xj - xi2) * (y2 - yi2) / (yj - yi2) + xi2;
    if (intersect) {
      isInside2 = !isInside2;
    }
  }
  return isInside2;
}
function isInside(point, rect) {
  return point[0] >= rect.x && point[0] <= rect.x + rect.width && point[1] >= rect.y && point[1] <= rect.y + rect.height;
}
function safePolygon(options) {
  if (options === void 0) {
    options = {};
  }
  const {
    buffer = 0.5,
    blockPointerEvents = false,
    requireIntent = true
  } = options;
  const timeoutRef = {
    current: -1
  };
  let hasLanded = false;
  let lastX = null;
  let lastY = null;
  let lastCursorTime = typeof performance !== "undefined" ? performance.now() : 0;
  function getCursorSpeed(x2, y2) {
    const currentTime = performance.now();
    const elapsedTime = currentTime - lastCursorTime;
    if (lastX === null || lastY === null || elapsedTime === 0) {
      lastX = x2;
      lastY = y2;
      lastCursorTime = currentTime;
      return null;
    }
    const deltaX = x2 - lastX;
    const deltaY = y2 - lastY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const speed = distance / elapsedTime;
    lastX = x2;
    lastY = y2;
    lastCursorTime = currentTime;
    return speed;
  }
  const fn2 = (_ref) => {
    let {
      x: x2,
      y: y2,
      placement,
      elements,
      onClose,
      nodeId,
      tree
    } = _ref;
    return function onMouseMove(event) {
      function close() {
        clearTimeoutIfSet(timeoutRef);
        onClose();
      }
      clearTimeoutIfSet(timeoutRef);
      if (!elements.domReference || !elements.floating || placement == null || x2 == null || y2 == null) {
        return;
      }
      const {
        clientX,
        clientY
      } = event;
      const clientPoint = [clientX, clientY];
      const target = getTarget2(event);
      const isLeave = event.type === "mouseleave";
      const isOverFloatingEl = contains2(elements.floating, target);
      const isOverReferenceEl = contains2(elements.domReference, target);
      const refRect = elements.domReference.getBoundingClientRect();
      const rect = elements.floating.getBoundingClientRect();
      const side = placement.split("-")[0];
      const cursorLeaveFromRight = x2 > rect.right - rect.width / 2;
      const cursorLeaveFromBottom = y2 > rect.bottom - rect.height / 2;
      const isOverReferenceRect = isInside(clientPoint, refRect);
      const isFloatingWider = rect.width > refRect.width;
      const isFloatingTaller = rect.height > refRect.height;
      const left = (isFloatingWider ? refRect : rect).left;
      const right = (isFloatingWider ? refRect : rect).right;
      const top = (isFloatingTaller ? refRect : rect).top;
      const bottom = (isFloatingTaller ? refRect : rect).bottom;
      if (isOverFloatingEl) {
        hasLanded = true;
        if (!isLeave) {
          return;
        }
      }
      if (isOverReferenceEl) {
        hasLanded = false;
      }
      if (isOverReferenceEl && !isLeave) {
        hasLanded = true;
        return;
      }
      if (isLeave && isElement(event.relatedTarget) && contains2(elements.floating, event.relatedTarget)) {
        return;
      }
      if (tree && getNodeChildren2(tree.nodesRef.current, nodeId).length) {
        return;
      }
      if (side === "top" && y2 >= refRect.bottom - 1 || side === "bottom" && y2 <= refRect.top + 1 || side === "left" && x2 >= refRect.right - 1 || side === "right" && x2 <= refRect.left + 1) {
        return close();
      }
      let rectPoly = [];
      switch (side) {
        case "top":
          rectPoly = [[left, refRect.top + 1], [left, rect.bottom - 1], [right, rect.bottom - 1], [right, refRect.top + 1]];
          break;
        case "bottom":
          rectPoly = [[left, rect.top + 1], [left, refRect.bottom - 1], [right, refRect.bottom - 1], [right, rect.top + 1]];
          break;
        case "left":
          rectPoly = [[rect.right - 1, bottom], [rect.right - 1, top], [refRect.left + 1, top], [refRect.left + 1, bottom]];
          break;
        case "right":
          rectPoly = [[refRect.right - 1, bottom], [refRect.right - 1, top], [rect.left + 1, top], [rect.left + 1, bottom]];
          break;
      }
      function getPolygon(_ref2) {
        let [x3, y3] = _ref2;
        switch (side) {
          case "top": {
            const cursorPointOne = [isFloatingWider ? x3 + buffer / 2 : cursorLeaveFromRight ? x3 + buffer * 4 : x3 - buffer * 4, y3 + buffer + 1];
            const cursorPointTwo = [isFloatingWider ? x3 - buffer / 2 : cursorLeaveFromRight ? x3 + buffer * 4 : x3 - buffer * 4, y3 + buffer + 1];
            const commonPoints = [[rect.left, cursorLeaveFromRight ? rect.bottom - buffer : isFloatingWider ? rect.bottom - buffer : rect.top], [rect.right, cursorLeaveFromRight ? isFloatingWider ? rect.bottom - buffer : rect.top : rect.bottom - buffer]];
            return [cursorPointOne, cursorPointTwo, ...commonPoints];
          }
          case "bottom": {
            const cursorPointOne = [isFloatingWider ? x3 + buffer / 2 : cursorLeaveFromRight ? x3 + buffer * 4 : x3 - buffer * 4, y3 - buffer];
            const cursorPointTwo = [isFloatingWider ? x3 - buffer / 2 : cursorLeaveFromRight ? x3 + buffer * 4 : x3 - buffer * 4, y3 - buffer];
            const commonPoints = [[rect.left, cursorLeaveFromRight ? rect.top + buffer : isFloatingWider ? rect.top + buffer : rect.bottom], [rect.right, cursorLeaveFromRight ? isFloatingWider ? rect.top + buffer : rect.bottom : rect.top + buffer]];
            return [cursorPointOne, cursorPointTwo, ...commonPoints];
          }
          case "left": {
            const cursorPointOne = [x3 + buffer + 1, isFloatingTaller ? y3 + buffer / 2 : cursorLeaveFromBottom ? y3 + buffer * 4 : y3 - buffer * 4];
            const cursorPointTwo = [x3 + buffer + 1, isFloatingTaller ? y3 - buffer / 2 : cursorLeaveFromBottom ? y3 + buffer * 4 : y3 - buffer * 4];
            const commonPoints = [[cursorLeaveFromBottom ? rect.right - buffer : isFloatingTaller ? rect.right - buffer : rect.left, rect.top], [cursorLeaveFromBottom ? isFloatingTaller ? rect.right - buffer : rect.left : rect.right - buffer, rect.bottom]];
            return [...commonPoints, cursorPointOne, cursorPointTwo];
          }
          case "right": {
            const cursorPointOne = [x3 - buffer, isFloatingTaller ? y3 + buffer / 2 : cursorLeaveFromBottom ? y3 + buffer * 4 : y3 - buffer * 4];
            const cursorPointTwo = [x3 - buffer, isFloatingTaller ? y3 - buffer / 2 : cursorLeaveFromBottom ? y3 + buffer * 4 : y3 - buffer * 4];
            const commonPoints = [[cursorLeaveFromBottom ? rect.left + buffer : isFloatingTaller ? rect.left + buffer : rect.right, rect.top], [cursorLeaveFromBottom ? isFloatingTaller ? rect.left + buffer : rect.right : rect.left + buffer, rect.bottom]];
            return [cursorPointOne, cursorPointTwo, ...commonPoints];
          }
        }
      }
      if (isPointInPolygon([clientX, clientY], rectPoly)) {
        return;
      }
      if (hasLanded && !isOverReferenceRect) {
        return close();
      }
      if (!isLeave && requireIntent) {
        const cursorSpeed = getCursorSpeed(event.clientX, event.clientY);
        const cursorSpeedThreshold = 0.1;
        if (cursorSpeed !== null && cursorSpeed < cursorSpeedThreshold) {
          return close();
        }
      }
      if (!isPointInPolygon([clientX, clientY], getPolygon([x2, y2]))) {
        close();
      } else if (!hasLanded && requireIntent) {
        timeoutRef.current = window.setTimeout(close, 40);
      }
    };
  };
  fn2.__options = {
    blockPointerEvents
  };
  return fn2;
}

// node_modules/@tanstack/react-store/dist/esm/index.js
var import_with_selector = __toESM(require_with_selector());
function useStore(store, selector = (d) => d) {
  const slice = (0, import_with_selector.useSyncExternalStoreWithSelector)(
    store.subscribe,
    () => store.state,
    () => store.state,
    selector,
    shallow
  );
  return slice;
}
function shallow(objA, objB) {
  if (Object.is(objA, objB)) {
    return true;
  }
  if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) {
    return false;
  }
  if (objA instanceof Map && objB instanceof Map) {
    if (objA.size !== objB.size) return false;
    for (const [k2, v2] of objA) {
      if (!objB.has(k2) || !Object.is(v2, objB.get(k2))) return false;
    }
    return true;
  }
  if (objA instanceof Set && objB instanceof Set) {
    if (objA.size !== objB.size) return false;
    for (const v2 of objA) {
      if (!objB.has(v2)) return false;
    }
    return true;
  }
  if (objA instanceof Date && objB instanceof Date) {
    if (objA.getTime() !== objB.getTime()) return false;
    return true;
  }
  const keysA = getOwnKeys(objA);
  if (keysA.length !== getOwnKeys(objB).length) {
    return false;
  }
  for (let i = 0; i < keysA.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(objB, keysA[i]) || !Object.is(objA[keysA[i]], objB[keysA[i]])) {
      return false;
    }
  }
  return true;
}
function getOwnKeys(obj) {
  return Object.keys(obj).concat(
    Object.getOwnPropertySymbols(obj)
  );
}

// node_modules/@blocknote/react/dist/blocknote-react.js
var import_react_dom5 = __toESM(require_react_dom());

// node_modules/@tiptap/react/dist/index.js
var import_react2 = __toESM(require_react());
var import_react3 = __toESM(require_react());
var import_react_dom3 = __toESM(require_react_dom());
var import_shim = __toESM(require_shim());
var import_jsx_runtime2 = __toESM(require_jsx_runtime());
var import_react4 = __toESM(require_react());
var import_shim2 = __toESM(require_shim());

// node_modules/fast-equals/dist/es/index.mjs
var { getOwnPropertyNames, getOwnPropertySymbols } = Object;
var { hasOwnProperty } = Object.prototype;
function combineComparators(comparatorA, comparatorB) {
  return function isEqual(a2, b3, state) {
    return comparatorA(a2, b3, state) && comparatorB(a2, b3, state);
  };
}
function createIsCircular(areItemsEqual) {
  return function isCircular(a2, b3, state) {
    if (!a2 || !b3 || typeof a2 !== "object" || typeof b3 !== "object") {
      return areItemsEqual(a2, b3, state);
    }
    const { cache } = state;
    const cachedA = cache.get(a2);
    const cachedB = cache.get(b3);
    if (cachedA && cachedB) {
      return cachedA === b3 && cachedB === a2;
    }
    cache.set(a2, b3);
    cache.set(b3, a2);
    const result = areItemsEqual(a2, b3, state);
    cache.delete(a2);
    cache.delete(b3);
    return result;
  };
}
function getShortTag(value) {
  return value != null ? value[Symbol.toStringTag] : void 0;
}
function getStrictProperties(object) {
  return getOwnPropertyNames(object).concat(getOwnPropertySymbols(object));
}
var hasOwn = (
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  Object.hasOwn || ((object, property) => hasOwnProperty.call(object, property))
);
function sameValueZeroEqual(a2, b3) {
  return a2 === b3 || !a2 && !b3 && a2 !== a2 && b3 !== b3;
}
var PREACT_VNODE = "__v";
var PREACT_OWNER = "__o";
var REACT_OWNER = "_owner";
var { getOwnPropertyDescriptor, keys } = Object;
function areArrayBuffersEqual(a2, b3) {
  return a2.byteLength === b3.byteLength && areTypedArraysEqual(new Uint8Array(a2), new Uint8Array(b3));
}
function areArraysEqual(a2, b3, state) {
  let index2 = a2.length;
  if (b3.length !== index2) {
    return false;
  }
  while (index2-- > 0) {
    if (!state.equals(a2[index2], b3[index2], index2, index2, a2, b3, state)) {
      return false;
    }
  }
  return true;
}
function areDataViewsEqual(a2, b3) {
  return a2.byteLength === b3.byteLength && areTypedArraysEqual(new Uint8Array(a2.buffer, a2.byteOffset, a2.byteLength), new Uint8Array(b3.buffer, b3.byteOffset, b3.byteLength));
}
function areDatesEqual(a2, b3) {
  return sameValueZeroEqual(a2.getTime(), b3.getTime());
}
function areErrorsEqual(a2, b3) {
  return a2.name === b3.name && a2.message === b3.message && a2.cause === b3.cause && a2.stack === b3.stack;
}
function areFunctionsEqual(a2, b3) {
  return a2 === b3;
}
function areMapsEqual(a2, b3, state) {
  const size2 = a2.size;
  if (size2 !== b3.size) {
    return false;
  }
  if (!size2) {
    return true;
  }
  const matchedIndices = new Array(size2);
  const aIterable = a2.entries();
  let aResult;
  let bResult;
  let index2 = 0;
  while (aResult = aIterable.next()) {
    if (aResult.done) {
      break;
    }
    const bIterable = b3.entries();
    let hasMatch = false;
    let matchIndex = 0;
    while (bResult = bIterable.next()) {
      if (bResult.done) {
        break;
      }
      if (matchedIndices[matchIndex]) {
        matchIndex++;
        continue;
      }
      const aEntry = aResult.value;
      const bEntry = bResult.value;
      if (state.equals(aEntry[0], bEntry[0], index2, matchIndex, a2, b3, state) && state.equals(aEntry[1], bEntry[1], aEntry[0], bEntry[0], a2, b3, state)) {
        hasMatch = matchedIndices[matchIndex] = true;
        break;
      }
      matchIndex++;
    }
    if (!hasMatch) {
      return false;
    }
    index2++;
  }
  return true;
}
var areNumbersEqual = sameValueZeroEqual;
function areObjectsEqual(a2, b3, state) {
  const properties = keys(a2);
  let index2 = properties.length;
  if (keys(b3).length !== index2) {
    return false;
  }
  while (index2-- > 0) {
    if (!isPropertyEqual(a2, b3, state, properties[index2])) {
      return false;
    }
  }
  return true;
}
function areObjectsEqualStrict(a2, b3, state) {
  const properties = getStrictProperties(a2);
  let index2 = properties.length;
  if (getStrictProperties(b3).length !== index2) {
    return false;
  }
  let property;
  let descriptorA;
  let descriptorB;
  while (index2-- > 0) {
    property = properties[index2];
    if (!isPropertyEqual(a2, b3, state, property)) {
      return false;
    }
    descriptorA = getOwnPropertyDescriptor(a2, property);
    descriptorB = getOwnPropertyDescriptor(b3, property);
    if ((descriptorA || descriptorB) && (!descriptorA || !descriptorB || descriptorA.configurable !== descriptorB.configurable || descriptorA.enumerable !== descriptorB.enumerable || descriptorA.writable !== descriptorB.writable)) {
      return false;
    }
  }
  return true;
}
function arePrimitiveWrappersEqual(a2, b3) {
  return sameValueZeroEqual(a2.valueOf(), b3.valueOf());
}
function areRegExpsEqual(a2, b3) {
  return a2.source === b3.source && a2.flags === b3.flags;
}
function areSetsEqual(a2, b3, state) {
  const size2 = a2.size;
  if (size2 !== b3.size) {
    return false;
  }
  if (!size2) {
    return true;
  }
  const matchedIndices = new Array(size2);
  const aIterable = a2.values();
  let aResult;
  let bResult;
  while (aResult = aIterable.next()) {
    if (aResult.done) {
      break;
    }
    const bIterable = b3.values();
    let hasMatch = false;
    let matchIndex = 0;
    while (bResult = bIterable.next()) {
      if (bResult.done) {
        break;
      }
      if (!matchedIndices[matchIndex] && state.equals(aResult.value, bResult.value, aResult.value, bResult.value, a2, b3, state)) {
        hasMatch = matchedIndices[matchIndex] = true;
        break;
      }
      matchIndex++;
    }
    if (!hasMatch) {
      return false;
    }
  }
  return true;
}
function areTypedArraysEqual(a2, b3) {
  let index2 = a2.byteLength;
  if (b3.byteLength !== index2 || a2.byteOffset !== b3.byteOffset) {
    return false;
  }
  while (index2-- > 0) {
    if (a2[index2] !== b3[index2]) {
      return false;
    }
  }
  return true;
}
function areUrlsEqual(a2, b3) {
  return a2.hostname === b3.hostname && a2.pathname === b3.pathname && a2.protocol === b3.protocol && a2.port === b3.port && a2.hash === b3.hash && a2.username === b3.username && a2.password === b3.password;
}
function isPropertyEqual(a2, b3, state, property) {
  if ((property === REACT_OWNER || property === PREACT_OWNER || property === PREACT_VNODE) && (a2.$$typeof || b3.$$typeof)) {
    return true;
  }
  return hasOwn(b3, property) && state.equals(a2[property], b3[property], property, property, a2, b3, state);
}
var ARRAY_BUFFER_TAG = "[object ArrayBuffer]";
var ARGUMENTS_TAG = "[object Arguments]";
var BOOLEAN_TAG = "[object Boolean]";
var DATA_VIEW_TAG = "[object DataView]";
var DATE_TAG = "[object Date]";
var ERROR_TAG = "[object Error]";
var MAP_TAG = "[object Map]";
var NUMBER_TAG = "[object Number]";
var OBJECT_TAG = "[object Object]";
var REG_EXP_TAG = "[object RegExp]";
var SET_TAG = "[object Set]";
var STRING_TAG = "[object String]";
var TYPED_ARRAY_TAGS = {
  "[object Int8Array]": true,
  "[object Uint8Array]": true,
  "[object Uint8ClampedArray]": true,
  "[object Int16Array]": true,
  "[object Uint16Array]": true,
  "[object Int32Array]": true,
  "[object Uint32Array]": true,
  "[object Float16Array]": true,
  "[object Float32Array]": true,
  "[object Float64Array]": true,
  "[object BigInt64Array]": true,
  "[object BigUint64Array]": true
};
var URL_TAG = "[object URL]";
var toString = Object.prototype.toString;
function createEqualityComparator({ areArrayBuffersEqual: areArrayBuffersEqual2, areArraysEqual: areArraysEqual2, areDataViewsEqual: areDataViewsEqual2, areDatesEqual: areDatesEqual2, areErrorsEqual: areErrorsEqual2, areFunctionsEqual: areFunctionsEqual2, areMapsEqual: areMapsEqual2, areNumbersEqual: areNumbersEqual2, areObjectsEqual: areObjectsEqual2, arePrimitiveWrappersEqual: arePrimitiveWrappersEqual2, areRegExpsEqual: areRegExpsEqual2, areSetsEqual: areSetsEqual2, areTypedArraysEqual: areTypedArraysEqual2, areUrlsEqual: areUrlsEqual2, unknownTagComparators }) {
  return function comparator(a2, b3, state) {
    if (a2 === b3) {
      return true;
    }
    if (a2 == null || b3 == null) {
      return false;
    }
    const type = typeof a2;
    if (type !== typeof b3) {
      return false;
    }
    if (type !== "object") {
      if (type === "number") {
        return areNumbersEqual2(a2, b3, state);
      }
      if (type === "function") {
        return areFunctionsEqual2(a2, b3, state);
      }
      return false;
    }
    const constructor = a2.constructor;
    if (constructor !== b3.constructor) {
      return false;
    }
    if (constructor === Object) {
      return areObjectsEqual2(a2, b3, state);
    }
    if (Array.isArray(a2)) {
      return areArraysEqual2(a2, b3, state);
    }
    if (constructor === Date) {
      return areDatesEqual2(a2, b3, state);
    }
    if (constructor === RegExp) {
      return areRegExpsEqual2(a2, b3, state);
    }
    if (constructor === Map) {
      return areMapsEqual2(a2, b3, state);
    }
    if (constructor === Set) {
      return areSetsEqual2(a2, b3, state);
    }
    const tag = toString.call(a2);
    if (tag === DATE_TAG) {
      return areDatesEqual2(a2, b3, state);
    }
    if (tag === REG_EXP_TAG) {
      return areRegExpsEqual2(a2, b3, state);
    }
    if (tag === MAP_TAG) {
      return areMapsEqual2(a2, b3, state);
    }
    if (tag === SET_TAG) {
      return areSetsEqual2(a2, b3, state);
    }
    if (tag === OBJECT_TAG) {
      return typeof a2.then !== "function" && typeof b3.then !== "function" && areObjectsEqual2(a2, b3, state);
    }
    if (tag === URL_TAG) {
      return areUrlsEqual2(a2, b3, state);
    }
    if (tag === ERROR_TAG) {
      return areErrorsEqual2(a2, b3, state);
    }
    if (tag === ARGUMENTS_TAG) {
      return areObjectsEqual2(a2, b3, state);
    }
    if (TYPED_ARRAY_TAGS[tag]) {
      return areTypedArraysEqual2(a2, b3, state);
    }
    if (tag === ARRAY_BUFFER_TAG) {
      return areArrayBuffersEqual2(a2, b3, state);
    }
    if (tag === DATA_VIEW_TAG) {
      return areDataViewsEqual2(a2, b3, state);
    }
    if (tag === BOOLEAN_TAG || tag === NUMBER_TAG || tag === STRING_TAG) {
      return arePrimitiveWrappersEqual2(a2, b3, state);
    }
    if (unknownTagComparators) {
      let unknownTagComparator = unknownTagComparators[tag];
      if (!unknownTagComparator) {
        const shortTag = getShortTag(a2);
        if (shortTag) {
          unknownTagComparator = unknownTagComparators[shortTag];
        }
      }
      if (unknownTagComparator) {
        return unknownTagComparator(a2, b3, state);
      }
    }
    return false;
  };
}
function createEqualityComparatorConfig({ circular, createCustomConfig, strict }) {
  let config = {
    areArrayBuffersEqual,
    areArraysEqual: strict ? areObjectsEqualStrict : areArraysEqual,
    areDataViewsEqual,
    areDatesEqual,
    areErrorsEqual,
    areFunctionsEqual,
    areMapsEqual: strict ? combineComparators(areMapsEqual, areObjectsEqualStrict) : areMapsEqual,
    areNumbersEqual,
    areObjectsEqual: strict ? areObjectsEqualStrict : areObjectsEqual,
    arePrimitiveWrappersEqual,
    areRegExpsEqual,
    areSetsEqual: strict ? combineComparators(areSetsEqual, areObjectsEqualStrict) : areSetsEqual,
    areTypedArraysEqual: strict ? combineComparators(areTypedArraysEqual, areObjectsEqualStrict) : areTypedArraysEqual,
    areUrlsEqual,
    unknownTagComparators: void 0
  };
  if (createCustomConfig) {
    config = Object.assign({}, config, createCustomConfig(config));
  }
  if (circular) {
    const areArraysEqual2 = createIsCircular(config.areArraysEqual);
    const areMapsEqual2 = createIsCircular(config.areMapsEqual);
    const areObjectsEqual2 = createIsCircular(config.areObjectsEqual);
    const areSetsEqual2 = createIsCircular(config.areSetsEqual);
    config = Object.assign({}, config, {
      areArraysEqual: areArraysEqual2,
      areMapsEqual: areMapsEqual2,
      areObjectsEqual: areObjectsEqual2,
      areSetsEqual: areSetsEqual2
    });
  }
  return config;
}
function createInternalEqualityComparator(compare) {
  return function(a2, b3, _indexOrKeyA, _indexOrKeyB, _parentA, _parentB, state) {
    return compare(a2, b3, state);
  };
}
function createIsEqual({ circular, comparator, createState, equals, strict }) {
  if (createState) {
    return function isEqual(a2, b3) {
      const { cache = circular ? /* @__PURE__ */ new WeakMap() : void 0, meta } = createState();
      return comparator(a2, b3, {
        cache,
        equals,
        meta,
        strict
      });
    };
  }
  if (circular) {
    return function isEqual(a2, b3) {
      return comparator(a2, b3, {
        cache: /* @__PURE__ */ new WeakMap(),
        equals,
        meta: void 0,
        strict
      });
    };
  }
  const state = {
    cache: void 0,
    equals,
    meta: void 0,
    strict
  };
  return function isEqual(a2, b3) {
    return comparator(a2, b3, state);
  };
}
var deepEqual = createCustomEqual();
var strictDeepEqual = createCustomEqual({ strict: true });
var circularDeepEqual = createCustomEqual({ circular: true });
var strictCircularDeepEqual = createCustomEqual({
  circular: true,
  strict: true
});
var shallowEqual = createCustomEqual({
  createInternalComparator: () => sameValueZeroEqual
});
var strictShallowEqual = createCustomEqual({
  strict: true,
  createInternalComparator: () => sameValueZeroEqual
});
var circularShallowEqual = createCustomEqual({
  circular: true,
  createInternalComparator: () => sameValueZeroEqual
});
var strictCircularShallowEqual = createCustomEqual({
  circular: true,
  createInternalComparator: () => sameValueZeroEqual,
  strict: true
});
function createCustomEqual(options = {}) {
  const { circular = false, createInternalComparator: createCustomInternalComparator, createState, strict = false } = options;
  const config = createEqualityComparatorConfig(options);
  const comparator = createEqualityComparator(config);
  const equals = createCustomInternalComparator ? createCustomInternalComparator(comparator) : createInternalEqualityComparator(comparator);
  return createIsEqual({ circular, comparator, createState, equals, strict });
}

// node_modules/@tiptap/react/dist/index.js
var import_react5 = __toESM(require_react());
var import_with_selector2 = __toESM(require_with_selector());
var import_jsx_runtime3 = __toESM(require_jsx_runtime());
var import_react6 = __toESM(require_react());
var import_jsx_runtime4 = __toESM(require_jsx_runtime());
var import_react7 = __toESM(require_react());
var import_jsx_runtime5 = __toESM(require_jsx_runtime());
var import_react8 = __toESM(require_react());
var import_react9 = __toESM(require_react());
var import_react_dom4 = __toESM(require_react_dom());
var import_jsx_runtime6 = __toESM(require_jsx_runtime());
var import_jsx_runtime7 = __toESM(require_jsx_runtime());
var import_react10 = __toESM(require_react());
var import_jsx_runtime8 = __toESM(require_jsx_runtime());
var import_react11 = __toESM(require_react());
var import_jsx_runtime9 = __toESM(require_jsx_runtime());
var mergeRefs = (...refs) => {
  return (node) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ;
        ref.current = node;
      }
    });
  };
};
var Portals = ({ contentComponent }) => {
  const renderers = (0, import_shim.useSyncExternalStore)(
    contentComponent.subscribe,
    contentComponent.getSnapshot,
    contentComponent.getServerSnapshot
  );
  return (0, import_jsx_runtime2.jsx)(import_jsx_runtime2.Fragment, { children: Object.values(renderers) });
};
function getInstance() {
  const subscribers = /* @__PURE__ */ new Set();
  let renderers = {};
  return {
    /**
     * Subscribe to the editor instance's changes.
     */
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
    getSnapshot() {
      return renderers;
    },
    getServerSnapshot() {
      return renderers;
    },
    /**
     * Adds a new NodeView Renderer to the editor.
     */
    setRenderer(id, renderer) {
      renderers = {
        ...renderers,
        [id]: import_react_dom3.default.createPortal(renderer.reactElement, renderer.element, id)
      };
      subscribers.forEach((subscriber) => subscriber());
    },
    /**
     * Removes a NodeView Renderer from the editor.
     */
    removeRenderer(id) {
      const nextRenderers = { ...renderers };
      delete nextRenderers[id];
      renderers = nextRenderers;
      subscribers.forEach((subscriber) => subscriber());
    }
  };
}
var PureEditorContent = class extends import_react3.default.Component {
  constructor(props) {
    var _a;
    super(props);
    this.editorContentRef = import_react3.default.createRef();
    this.initialized = false;
    this.state = {
      hasContentComponentInitialized: Boolean((_a = props.editor) == null ? void 0 : _a.contentComponent)
    };
  }
  componentDidMount() {
    this.init();
  }
  componentDidUpdate() {
    this.init();
  }
  init() {
    var _a;
    const editor = this.props.editor;
    if (editor && !editor.isDestroyed && ((_a = editor.view.dom) == null ? void 0 : _a.parentNode)) {
      if (editor.contentComponent) {
        return;
      }
      const element = this.editorContentRef.current;
      element.append(...editor.view.dom.parentNode.childNodes);
      editor.setOptions({
        element
      });
      editor.contentComponent = getInstance();
      if (!this.state.hasContentComponentInitialized) {
        this.unsubscribeToContentComponent = editor.contentComponent.subscribe(() => {
          this.setState((prevState) => {
            if (!prevState.hasContentComponentInitialized) {
              return {
                hasContentComponentInitialized: true
              };
            }
            return prevState;
          });
          if (this.unsubscribeToContentComponent) {
            this.unsubscribeToContentComponent();
          }
        });
      }
      editor.createNodeViews();
      this.initialized = true;
    }
  }
  componentWillUnmount() {
    var _a;
    const editor = this.props.editor;
    if (!editor) {
      return;
    }
    this.initialized = false;
    if (!editor.isDestroyed) {
      editor.view.setProps({
        nodeViews: {}
      });
    }
    if (this.unsubscribeToContentComponent) {
      this.unsubscribeToContentComponent();
    }
    editor.contentComponent = null;
    try {
      if (!((_a = editor.view.dom) == null ? void 0 : _a.parentNode)) {
        return;
      }
      const newElement = document.createElement("div");
      newElement.append(...editor.view.dom.parentNode.childNodes);
      editor.setOptions({
        element: newElement
      });
    } catch {
    }
  }
  render() {
    const { editor, innerRef, ...rest } = this.props;
    return (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      (0, import_jsx_runtime2.jsx)("div", { ref: mergeRefs(innerRef, this.editorContentRef), ...rest }),
      (editor == null ? void 0 : editor.contentComponent) && (0, import_jsx_runtime2.jsx)(Portals, { contentComponent: editor.contentComponent })
    ] });
  }
};
var EditorContentWithKey = (0, import_react3.forwardRef)(
  (props, ref) => {
    const key = import_react3.default.useMemo(() => {
      return Math.floor(Math.random() * 4294967295).toString();
    }, [props.editor]);
    return import_react3.default.createElement(PureEditorContent, {
      key,
      innerRef: ref,
      ...props
    });
  }
);
var EditorContent = import_react3.default.memo(EditorContentWithKey);
var isSSR = typeof window === "undefined";
var isNext = isSSR || Boolean(typeof window !== "undefined" && window.next);
var EditorContext = (0, import_react2.createContext)({
  editor: null
});
var EditorConsumer = EditorContext.Consumer;
var ReactNodeViewContext = (0, import_react6.createContext)({
  onDragStart: () => {
  },
  nodeViewContentChildren: void 0,
  nodeViewContentRef: () => {
  }
});
var useReactNodeView = () => (0, import_react6.useContext)(ReactNodeViewContext);
var NodeViewWrapper = import_react7.default.forwardRef((props, ref) => {
  const { onDragStart } = useReactNodeView();
  const Tag = props.as || "div";
  return (
    // @ts-ignore
    (0, import_jsx_runtime5.jsx)(
      Tag,
      {
        ...props,
        ref,
        "data-node-view-wrapper": "",
        onDragStart,
        style: {
          whiteSpace: "normal",
          ...props.style
        }
      }
    )
  );
});
function isClassComponent(Component) {
  return !!(typeof Component === "function" && Component.prototype && Component.prototype.isReactComponent);
}
function isForwardRefComponent(Component) {
  return !!(typeof Component === "object" && Component.$$typeof && (Component.$$typeof.toString() === "Symbol(react.forward_ref)" || Component.$$typeof.description === "react.forward_ref"));
}
function isMemoComponent(Component) {
  return !!(typeof Component === "object" && Component.$$typeof && (Component.$$typeof.toString() === "Symbol(react.memo)" || Component.$$typeof.description === "react.memo"));
}
function canReceiveRef(Component) {
  if (isClassComponent(Component)) {
    return true;
  }
  if (isForwardRefComponent(Component)) {
    return true;
  }
  if (isMemoComponent(Component)) {
    const wrappedComponent = Component.type;
    if (wrappedComponent) {
      return isClassComponent(wrappedComponent) || isForwardRefComponent(wrappedComponent);
    }
  }
  return false;
}
function isReact19Plus() {
  try {
    if (import_react9.version) {
      const majorVersion = parseInt(import_react9.version.split(".")[0], 10);
      return majorVersion >= 19;
    }
  } catch {
  }
  return false;
}
var ReactRenderer = class {
  /**
   * Immediately creates element and renders the provided React component.
   */
  constructor(component, { editor, props = {}, as = "div", className = "" }) {
    this.ref = null;
    this.destroyed = false;
    this.id = Math.floor(Math.random() * 4294967295).toString();
    this.component = component;
    this.editor = editor;
    this.props = props;
    this.element = document.createElement(as);
    this.element.classList.add("react-renderer");
    if (className) {
      this.element.classList.add(...className.split(" "));
    }
    if (this.editor.isInitialized) {
      (0, import_react_dom4.flushSync)(() => {
        this.render();
      });
    } else {
      queueMicrotask(() => {
        if (this.destroyed) {
          return;
        }
        this.render();
      });
    }
  }
  /**
   * Render the React component.
   */
  render() {
    var _a;
    if (this.destroyed) {
      return;
    }
    const Component = this.component;
    const props = this.props;
    const editor = this.editor;
    const isReact19 = isReact19Plus();
    const componentCanReceiveRef = canReceiveRef(Component);
    const elementProps = { ...props };
    if (elementProps.ref && !(isReact19 || componentCanReceiveRef)) {
      delete elementProps.ref;
    }
    if (!elementProps.ref && (isReact19 || componentCanReceiveRef)) {
      elementProps.ref = (ref) => {
        this.ref = ref;
      };
    }
    this.reactElement = (0, import_jsx_runtime6.jsx)(Component, { ...elementProps });
    (_a = editor == null ? void 0 : editor.contentComponent) == null ? void 0 : _a.setRenderer(this.id, this);
  }
  /**
   * Re-renders the React component with new props.
   */
  updateProps(props = {}) {
    if (this.destroyed) {
      return;
    }
    this.props = {
      ...this.props,
      ...props
    };
    this.render();
  }
  /**
   * Destroy the React component.
   */
  destroy() {
    var _a;
    this.destroyed = true;
    const editor = this.editor;
    (_a = editor == null ? void 0 : editor.contentComponent) == null ? void 0 : _a.removeRenderer(this.id);
    try {
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
    } catch {
    }
  }
  /**
   * Update the attributes of the element that holds the React component.
   */
  updateAttributes(attributes) {
    Object.keys(attributes).forEach((key) => {
      this.element.setAttribute(key, attributes[key]);
    });
  }
};
var ReactMarkViewContext = import_react8.default.createContext({
  markViewContentRef: () => {
  }
});
var ReactMarkView = class extends MarkView {
  constructor(component, props, options) {
    super(component, props, options);
    const { as = "span", attrs, className = "" } = options || {};
    const componentProps = { ...props, updateAttributes: this.updateAttributes.bind(this) };
    this.contentDOMElement = document.createElement("span");
    const markViewContentRef = (el2) => {
      if (el2 && !el2.contains(this.contentDOMElement)) {
        el2.appendChild(this.contentDOMElement);
      }
    };
    const context = {
      markViewContentRef
    };
    const ReactMarkViewProvider = import_react8.default.memo((componentProps2) => {
      return (0, import_jsx_runtime7.jsx)(ReactMarkViewContext.Provider, { value: context, children: import_react8.default.createElement(component, componentProps2) });
    });
    ReactMarkViewProvider.displayName = "ReactMarkView";
    this.renderer = new ReactRenderer(ReactMarkViewProvider, {
      editor: props.editor,
      props: componentProps,
      as,
      className: `mark-${props.mark.type.name} ${className}`.trim()
    });
    if (attrs) {
      this.renderer.updateAttributes(attrs);
    }
  }
  get dom() {
    return this.renderer.element;
  }
  get contentDOM() {
    return this.contentDOMElement;
  }
};
function ReactMarkViewRenderer(component, options = {}) {
  return (props) => new ReactMarkView(component, props, options);
}
var ReactNodeView = class extends NodeView {
  constructor(component, props, options) {
    super(component, props, options);
    this.selectionRafId = null;
    this.cachedExtensionWithSyncedStorage = null;
    if (!this.node.isLeaf) {
      if (this.options.contentDOMElementTag) {
        this.contentDOMElement = document.createElement(this.options.contentDOMElementTag);
      } else {
        this.contentDOMElement = document.createElement(this.node.isInline ? "span" : "div");
      }
      this.contentDOMElement.dataset.nodeViewContentReact = "";
      this.contentDOMElement.dataset.nodeViewWrapper = "";
      this.contentDOMElement.style.whiteSpace = "inherit";
      const contentTarget = this.dom.querySelector("[data-node-view-content]");
      if (!contentTarget) {
        return;
      }
      contentTarget.appendChild(this.contentDOMElement);
    }
  }
  /**
   * Returns a proxy of the extension that redirects storage access to the editor's mutable storage.
   * This preserves the original prototype chain (instanceof checks, methods like configure/extend work).
   * Cached to avoid proxy creation on every update.
   */
  get extensionWithSyncedStorage() {
    if (!this.cachedExtensionWithSyncedStorage) {
      const editor = this.editor;
      const extension = this.extension;
      this.cachedExtensionWithSyncedStorage = new Proxy(extension, {
        get(target, prop, receiver) {
          var _a;
          if (prop === "storage") {
            return (_a = editor.storage[extension.name]) != null ? _a : {};
          }
          return Reflect.get(target, prop, receiver);
        }
      });
    }
    return this.cachedExtensionWithSyncedStorage;
  }
  /**
   * Setup the React component.
   * Called on initialization.
   */
  mount() {
    const props = {
      editor: this.editor,
      node: this.node,
      decorations: this.decorations,
      innerDecorations: this.innerDecorations,
      view: this.view,
      selected: false,
      extension: this.extensionWithSyncedStorage,
      HTMLAttributes: this.HTMLAttributes,
      getPos: () => this.getPos(),
      updateAttributes: (attributes = {}) => this.updateAttributes(attributes),
      deleteNode: () => this.deleteNode(),
      ref: (0, import_react10.createRef)()
    };
    if (!this.component.displayName) {
      const capitalizeFirstChar = (string) => {
        return string.charAt(0).toUpperCase() + string.substring(1);
      };
      this.component.displayName = capitalizeFirstChar(this.extension.name);
    }
    const onDragStart = this.onDragStart.bind(this);
    const nodeViewContentRef = (element) => {
      if (element && this.contentDOMElement && element.firstChild !== this.contentDOMElement) {
        if (element.hasAttribute("data-node-view-wrapper")) {
          element.removeAttribute("data-node-view-wrapper");
        }
        element.appendChild(this.contentDOMElement);
      }
    };
    const context = { onDragStart, nodeViewContentRef };
    const Component = this.component;
    const ReactNodeViewProvider = (0, import_react10.memo)((componentProps) => {
      return (0, import_jsx_runtime8.jsx)(ReactNodeViewContext.Provider, { value: context, children: (0, import_react10.createElement)(Component, componentProps) });
    });
    ReactNodeViewProvider.displayName = "ReactNodeView";
    let as = this.node.isInline ? "span" : "div";
    if (this.options.as) {
      as = this.options.as;
    }
    const { className = "" } = this.options;
    this.handleSelectionUpdate = this.handleSelectionUpdate.bind(this);
    this.renderer = new ReactRenderer(ReactNodeViewProvider, {
      editor: this.editor,
      props,
      as,
      className: `node-${this.node.type.name} ${className}`.trim()
    });
    this.editor.on("selectionUpdate", this.handleSelectionUpdate);
    this.updateElementAttributes();
  }
  /**
   * Return the DOM element.
   * This is the element that will be used to display the node view.
   */
  get dom() {
    var _a;
    if (this.renderer.element.firstElementChild && !((_a = this.renderer.element.firstElementChild) == null ? void 0 : _a.hasAttribute("data-node-view-wrapper"))) {
      throw Error("Please use the NodeViewWrapper component for your node view.");
    }
    return this.renderer.element;
  }
  /**
   * Return the content DOM element.
   * This is the element that will be used to display the rich-text content of the node.
   */
  get contentDOM() {
    if (this.node.isLeaf) {
      return null;
    }
    return this.contentDOMElement;
  }
  /**
   * On editor selection update, check if the node is selected.
   * If it is, call `selectNode`, otherwise call `deselectNode`.
   */
  handleSelectionUpdate() {
    if (this.selectionRafId) {
      cancelAnimationFrame(this.selectionRafId);
      this.selectionRafId = null;
    }
    this.selectionRafId = requestAnimationFrame(() => {
      this.selectionRafId = null;
      const { from, to } = this.editor.state.selection;
      const pos = this.getPos();
      if (typeof pos !== "number") {
        return;
      }
      if (from <= pos && to >= pos + this.node.nodeSize) {
        if (this.renderer.props.selected) {
          return;
        }
        this.selectNode();
      } else {
        if (!this.renderer.props.selected) {
          return;
        }
        this.deselectNode();
      }
    });
  }
  /**
   * On update, update the React component.
   * To prevent unnecessary updates, the `update` option can be used.
   */
  update(node, decorations, innerDecorations) {
    const rerenderComponent = (props) => {
      this.renderer.updateProps(props);
      if (typeof this.options.attrs === "function") {
        this.updateElementAttributes();
      }
    };
    if (node.type !== this.node.type) {
      return false;
    }
    if (typeof this.options.update === "function") {
      const oldNode = this.node;
      const oldDecorations = this.decorations;
      const oldInnerDecorations = this.innerDecorations;
      this.node = node;
      this.decorations = decorations;
      this.innerDecorations = innerDecorations;
      return this.options.update({
        oldNode,
        oldDecorations,
        newNode: node,
        newDecorations: decorations,
        oldInnerDecorations,
        innerDecorations,
        updateProps: () => rerenderComponent({ node, decorations, innerDecorations, extension: this.extensionWithSyncedStorage })
      });
    }
    if (node === this.node && this.decorations === decorations && this.innerDecorations === innerDecorations) {
      return true;
    }
    this.node = node;
    this.decorations = decorations;
    this.innerDecorations = innerDecorations;
    rerenderComponent({ node, decorations, innerDecorations, extension: this.extensionWithSyncedStorage });
    return true;
  }
  /**
   * Select the node.
   * Add the `selected` prop and the `ProseMirror-selectednode` class.
   */
  selectNode() {
    this.renderer.updateProps({
      selected: true
    });
    this.renderer.element.classList.add("ProseMirror-selectednode");
  }
  /**
   * Deselect the node.
   * Remove the `selected` prop and the `ProseMirror-selectednode` class.
   */
  deselectNode() {
    this.renderer.updateProps({
      selected: false
    });
    this.renderer.element.classList.remove("ProseMirror-selectednode");
  }
  /**
   * Destroy the React component instance.
   */
  destroy() {
    this.renderer.destroy();
    this.editor.off("selectionUpdate", this.handleSelectionUpdate);
    this.contentDOMElement = null;
    if (this.selectionRafId) {
      cancelAnimationFrame(this.selectionRafId);
      this.selectionRafId = null;
    }
  }
  /**
   * Update the attributes of the top-level element that holds the React component.
   * Applying the attributes defined in the `attrs` option.
   */
  updateElementAttributes() {
    if (this.options.attrs) {
      let attrsObj = {};
      if (typeof this.options.attrs === "function") {
        const extensionAttributes = this.editor.extensionManager.attributes;
        const HTMLAttributes = getRenderedAttributes(this.node, extensionAttributes);
        attrsObj = this.options.attrs({ node: this.node, HTMLAttributes });
      } else {
        attrsObj = this.options.attrs;
      }
      this.renderer.updateAttributes(attrsObj);
    }
  }
};
function ReactNodeViewRenderer(component, options) {
  return (props) => {
    if (!props.editor.contentComponent) {
      return {};
    }
    return new ReactNodeView(component, props, options);
  };
}
var TiptapContext = (0, import_react11.createContext)({
  get editor() {
    throw new Error("useTiptap must be used within a <Tiptap> provider");
  }
});
TiptapContext.displayName = "TiptapContext";
var useTiptap = () => (0, import_react11.useContext)(TiptapContext);
function TiptapWrapper({ editor, instance, children }) {
  const resolvedEditor = editor != null ? editor : instance;
  if (!resolvedEditor) {
    throw new Error("Tiptap: An editor instance is required. Pass a non-null `editor` prop.");
  }
  const tiptapContextValue = (0, import_react11.useMemo)(() => ({ editor: resolvedEditor }), [resolvedEditor]);
  const legacyContextValue = (0, import_react11.useMemo)(() => ({ editor: resolvedEditor }), [resolvedEditor]);
  return (0, import_jsx_runtime9.jsx)(EditorContext.Provider, { value: legacyContextValue, children: (0, import_jsx_runtime9.jsx)(TiptapContext.Provider, { value: tiptapContextValue, children }) });
}
TiptapWrapper.displayName = "Tiptap";
function TiptapContent({ ...rest }) {
  const { editor } = useTiptap();
  return (0, import_jsx_runtime9.jsx)(EditorContent, { editor, ...rest });
}
TiptapContent.displayName = "Tiptap.Content";
var Tiptap = Object.assign(TiptapWrapper, {
  /**
   * The Tiptap Content component that renders the EditorContent with the editor instance from the context.
   * @see TiptapContent
   */
  Content: TiptapContent
});

// node_modules/@blocknote/react/dist/blocknote-react.js
var import_client = __toESM(require_client());
var ln = Object.defineProperty;
var cn = (e2, t, n) => t in e2 ? ln(e2, t, { enumerable: true, configurable: true, writable: true, value: n }) : e2[t] = n;
var ee = (e2, t, n) => cn(e2, typeof t != "symbol" ? t + "" : t, n);
var _t = (0, import_react12.createContext)(void 0);
function q(e2) {
  return (0, import_react12.useContext)(_t);
}
function v(e2) {
  const t = q();
  if (!(t != null && t.editor))
    throw new Error(
      "useBlockNoteEditor was called outside of a BlockNoteContext provider or BlockNoteView component"
    );
  return t.editor;
}
function _(e2, t) {
  const o = ((t == null ? void 0 : t.editor) ?? v()).getExtension(e2);
  if (!o)
    throw new Error("Extension not found", { cause: { plugin: e2 } });
  return o;
}
function B(e2, t) {
  const { store: n } = _(e2, t);
  if (!n)
    throw new Error("Store not found on plugin", { cause: { plugin: e2 } });
  return useStore(n, t == null ? void 0 : t.selector);
}
function co(e2) {
  let t = new DOMRect();
  const n = "getBoundingClientRect" in e2 ? () => e2.getBoundingClientRect() : () => e2.element.getBoundingClientRect();
  return () => e2.element && (e2.cacheMountedBoundingClientRect ?? true) ? (e2.element.isConnected && (t = n()), t) : n();
}
var $ = (e2) => {
  var h2, b3, p, C;
  const { refs: t, floatingStyles: n, context: o } = useFloating2({
    whileElementsMounted: autoUpdate,
    ...e2.useFloatingOptions
  }), { isMounted: r, styles: i } = useTransitionStyles(
    o,
    e2.useTransitionStylesProps
  ), { status: c2 } = useTransitionStatus(
    o,
    e2.useTransitionStatusProps
  ), s = useDismiss(o, e2.useDismissProps), a2 = useHover(o, { enabled: false, ...e2.useHoverProps }), { getFloatingProps: d } = useInteractions([s, a2]), u = (0, import_react12.useRef)(""), m2 = (0, import_react12.useRef)(null), f3 = useMergeRefs([m2, t.setFloating]);
  if ((0, import_react12.useEffect)(() => {
    if (e2.reference) {
      const x2 = "element" in e2.reference ? e2.reference.element : void 0;
      x2 !== void 0 && t.setReference(x2), t.setPositionReference({
        getBoundingClientRect: co(
          e2.reference
        ),
        contextElement: x2
      });
    }
  }, [e2.reference, t]), (0, import_react12.useEffect)(
    () => {
      var x2;
      (c2 === "initial" || c2 === "open") && (x2 = m2.current) != null && x2.innerHTML && (u.current = m2.current.innerHTML);
    },
    // `props.children` is added to the deps, since it's ultimately the HTML of
    // the children that we're storing.
    [c2, e2.reference, e2.children]
  ), !r)
    return false;
  const g = {
    ...e2.elementProps,
    style: {
      display: "flex",
      ...(h2 = e2.elementProps) == null ? void 0 : h2.style,
      zIndex: `calc(var(--bn-ui-base-z-index) + ${((p = (b3 = e2.elementProps) == null ? void 0 : b3.style) == null ? void 0 : p.zIndex) || 0})`,
      ...n,
      ...i
    },
    ...d()
  };
  return c2 === "close" ? (0, import_jsx_runtime10.jsx)(
    "div",
    {
      ref: f3,
      ...g,
      dangerouslySetInnerHTML: { __html: u.current }
    }
  ) : (C = e2.focusManagerProps) != null && C.disabled ? (0, import_jsx_runtime10.jsx)("div", { ref: f3, ...g, children: e2.children }) : (0, import_jsx_runtime10.jsx)(FloatingFocusManager, { ...e2.focusManagerProps, context: o, children: (0, import_jsx_runtime10.jsx)("div", { ref: f3, ...g, children: e2.children }) });
};
var Bt2 = (e2) => {
  const { blockId: t, children: n, ...o } = e2, r = v(), i = (0, import_react12.useMemo)(
    () => r.transact((c2) => {
      if (!t)
        return;
      const s = Bt(t, c2.doc);
      if (!s)
        return;
      const { node: a2 } = r.prosemirrorView.domAtPos(
        s.posBeforeNode + 1
      );
      if (a2 instanceof Element)
        return {
          element: a2
        };
    }),
    [r, t]
  );
  return (0, import_jsx_runtime10.jsx)($, { reference: i, ...o, children: t !== void 0 && n });
};
var ao = (0, import_react12.createContext)(
  void 0
);
function w2() {
  return (0, import_react12.useContext)(ao);
}
function S2() {
  return q().editor.dictionary;
}
var so = (e2) => {
  const t = w2(), n = S2(), o = v(), r = o.getBlock(e2.blockId), [i, c2] = (0, import_react12.useState)(""), s = (0, import_react12.useCallback)(
    (u) => {
      c2(u.currentTarget.value);
    },
    []
  ), a2 = (0, import_react12.useCallback)(
    (u) => {
      u.key === "Enter" && !u.nativeEvent.isComposing && (u.preventDefault(), o.updateBlock(r.id, {
        props: {
          name: fo(i),
          url: i
        }
      }));
    },
    [o, r.id, i]
  ), d = (0, import_react12.useCallback)(() => {
    o.updateBlock(r.id, {
      props: {
        name: fo(i),
        url: i
      }
    });
  }, [o, r.id, i]);
  return (0, import_jsx_runtime10.jsxs)(t.FilePanel.TabPanel, { className: "bn-tab-panel", children: [
    (0, import_jsx_runtime10.jsx)(
      t.FilePanel.TextInput,
      {
        className: "bn-text-input",
        placeholder: n.file_panel.embed.url_placeholder,
        value: i,
        onChange: s,
        onKeyDown: a2,
        "data-test": "embed-input"
      }
    ),
    (0, import_jsx_runtime10.jsx)(
      t.FilePanel.Button,
      {
        className: "bn-button",
        onClick: d,
        "data-test": "embed-input-button",
        children: n.file_panel.embed.embed_button[r.type] || n.file_panel.embed.embed_button.file
      }
    )
  ] });
};
var uo = (e2) => {
  var m2, f3;
  const t = w2(), n = S2(), { setLoading: o } = e2, r = v(), i = r.getBlock(e2.blockId), [c2, s] = (0, import_react12.useState)(false);
  (0, import_react12.useEffect)(() => {
    c2 && setTimeout(() => {
      s(false);
    }, 3e3);
  }, [c2]);
  const a2 = (0, import_react12.useCallback)(
    (g) => {
      if (g === null)
        return;
      async function h2(b3) {
        if (o(true), r.uploadFile !== void 0)
          try {
            let p = await r.uploadFile(b3, e2.blockId);
            typeof p == "string" && (p = {
              props: {
                name: b3.name,
                url: p
              }
            }), r.updateBlock(e2.blockId, p);
          } catch {
            s(true);
          } finally {
            o(false);
          }
      }
      h2(g);
    },
    [e2.blockId, r, o]
  ), d = r.schema.blockSpecs[i.type], u = (f3 = (m2 = d.implementation.meta) == null ? void 0 : m2.fileBlockAccept) != null && f3.length ? d.implementation.meta.fileBlockAccept.join(",") : "*/*";
  return (0, import_jsx_runtime10.jsxs)(t.FilePanel.TabPanel, { className: "bn-tab-panel", children: [
    (0, import_jsx_runtime10.jsx)(
      t.FilePanel.FileInput,
      {
        className: "bn-file-input",
        "data-test": "upload-input",
        accept: u,
        placeholder: n.file_panel.upload.file_placeholder[i.type] || n.file_panel.upload.file_placeholder.file,
        value: null,
        onChange: a2
      }
    ),
    c2 && (0, import_jsx_runtime10.jsx)("div", { className: "bn-error-text", children: n.file_panel.upload.upload_error })
  ] });
};
var Lt = (e2) => {
  const t = w2(), n = S2(), o = v(), [r, i] = (0, import_react12.useState)(false), c2 = e2.tabs ?? [
    ...o.uploadFile !== void 0 ? [
      {
        name: n.file_panel.upload.title,
        tabPanel: (0, import_jsx_runtime10.jsx)(uo, { blockId: e2.blockId, setLoading: i })
      }
    ] : [],
    {
      name: n.file_panel.embed.title,
      tabPanel: (0, import_jsx_runtime10.jsx)(so, { blockId: e2.blockId })
    }
  ], [s, a2] = (0, import_react12.useState)(
    e2.defaultOpenTab || c2[0].name
  );
  return (0, import_jsx_runtime10.jsx)(
    t.FilePanel.Root,
    {
      className: "bn-panel",
      defaultOpenTab: s,
      openTab: s,
      setOpenTab: a2,
      tabs: c2,
      loading: r
    }
  );
};
var mo = (e2) => {
  const t = v(), n = _(H), o = B(H), r = (0, import_react12.useMemo)(
    () => {
      var c2, s, a2;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: !!o,
          // Needed as hooks like `useDismiss` call `onOpenChange` to change the
          // open state.
          onOpenChange: (d, u, m2) => {
            d || n.closeMenu(), m2 === "escape-key" && t.focus();
          },
          middleware: [offset(10), flip()],
          ...(c2 = e2.floatingUIOptions) == null ? void 0 : c2.useFloatingOptions
        },
        focusManagerProps: {
          disabled: true,
          ...(s = e2.floatingUIOptions) == null ? void 0 : s.focusManagerProps
        },
        elementProps: {
          style: {
            zIndex: 90
          },
          ...(a2 = e2.floatingUIOptions) == null ? void 0 : a2.elementProps
        }
      };
    },
    [o, t, n, e2.floatingUIOptions]
  ), i = e2.filePanel || Lt;
  return (0, import_jsx_runtime10.jsx)(Bt2, { blockId: o, ...r, children: o && (0, import_jsx_runtime10.jsx)(i, { blockId: o }) });
};
function fo2(e2) {
  return e2 && e2.__esModule && Object.prototype.hasOwnProperty.call(e2, "default") ? e2.default : e2;
}
var go = function e(t, n) {
  if (t === n) return true;
  if (t && n && typeof t == "object" && typeof n == "object") {
    if (t.constructor !== n.constructor) return false;
    var o, r, i;
    if (Array.isArray(t)) {
      if (o = t.length, o != n.length) return false;
      for (r = o; r-- !== 0; )
        if (!e(t[r], n[r])) return false;
      return true;
    }
    if (t instanceof Map && n instanceof Map) {
      if (t.size !== n.size) return false;
      for (r of t.entries())
        if (!n.has(r[0])) return false;
      for (r of t.entries())
        if (!e(r[1], n.get(r[0]))) return false;
      return true;
    }
    if (t instanceof Set && n instanceof Set) {
      if (t.size !== n.size) return false;
      for (r of t.entries())
        if (!n.has(r[0])) return false;
      return true;
    }
    if (ArrayBuffer.isView(t) && ArrayBuffer.isView(n)) {
      if (o = t.length, o != n.length) return false;
      for (r = o; r-- !== 0; )
        if (t[r] !== n[r]) return false;
      return true;
    }
    if (t.constructor === RegExp) return t.source === n.source && t.flags === n.flags;
    if (t.valueOf !== Object.prototype.valueOf) return t.valueOf() === n.valueOf();
    if (t.toString !== Object.prototype.toString) return t.toString() === n.toString();
    if (i = Object.keys(t), o = i.length, o !== Object.keys(n).length) return false;
    for (r = o; r-- !== 0; )
      if (!Object.prototype.hasOwnProperty.call(n, i[r])) return false;
    for (r = o; r-- !== 0; ) {
      var c2 = i[r];
      if (!(c2 === "_owner" && t.$$typeof) && !e(t[c2], n[c2]))
        return false;
    }
    return true;
  }
  return t !== t && n !== n;
};
var ho = fo2(go);
var Ie = { exports: {} };
var se = { exports: {} };
var _e = {};
var nt;
function po() {
  return nt || (nt = 1, (function() {
    function e2(g, h2) {
      return g === h2 && (g !== 0 || 1 / g === 1 / h2) || g !== g && h2 !== h2;
    }
    function t(g, h2) {
      u || r.startTransition === void 0 || (u = true, console.error(
        "You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."
      ));
      var b3 = h2();
      if (!m2) {
        var p = h2();
        i(b3, p) || (console.error(
          "The result of getSnapshot should be cached to avoid an infinite loop"
        ), m2 = true);
      }
      p = c2({
        inst: { value: b3, getSnapshot: h2 }
      });
      var C = p[0].inst, x2 = p[1];
      return a2(
        function() {
          C.value = b3, C.getSnapshot = h2, n(C) && x2({ inst: C });
        },
        [g, b3, h2]
      ), s(
        function() {
          return n(C) && x2({ inst: C }), g(function() {
            n(C) && x2({ inst: C });
          });
        },
        [g]
      ), d(b3), b3;
    }
    function n(g) {
      var h2 = g.getSnapshot;
      g = g.value;
      try {
        var b3 = h2();
        return !i(g, b3);
      } catch {
        return true;
      }
    }
    function o(g, h2) {
      return h2();
    }
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart == "function" && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
    var r = import_react12.default, i = typeof Object.is == "function" ? Object.is : e2, c2 = r.useState, s = r.useEffect, a2 = r.useLayoutEffect, d = r.useDebugValue, u = false, m2 = false, f3 = typeof window > "u" || typeof window.document > "u" || typeof window.document.createElement > "u" ? o : t;
    _e.useSyncExternalStore = r.useSyncExternalStore !== void 0 ? r.useSyncExternalStore : f3, typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop == "function" && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
  })()), _e;
}
var ot;
function Et() {
  return ot || (ot = 1, false ? se.exports = bo() : se.exports = po()), se.exports;
}
var Be = {};
var it;
function vo() {
  return it || (it = 1, (function() {
    function e2(d, u) {
      return d === u && (d !== 0 || 1 / d === 1 / u) || d !== d && u !== u;
    }
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart == "function" && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
    var t = import_react12.default, n = Et(), o = typeof Object.is == "function" ? Object.is : e2, r = n.useSyncExternalStore, i = t.useRef, c2 = t.useEffect, s = t.useMemo, a2 = t.useDebugValue;
    Be.useSyncExternalStoreWithSelector = function(d, u, m2, f3, g) {
      var h2 = i(null);
      if (h2.current === null) {
        var b3 = { hasValue: false, value: null };
        h2.current = b3;
      } else b3 = h2.current;
      h2 = s(
        function() {
          function C(L2) {
            if (!x2) {
              if (x2 = true, O2 = L2, L2 = f3(L2), g !== void 0 && b3.hasValue) {
                var P = b3.value;
                if (g(P, L2))
                  return I = P;
              }
              return I = L2;
            }
            if (P = I, o(O2, L2))
              return P;
            var K2 = f3(L2);
            return g !== void 0 && g(P, K2) ? (O2 = L2, P) : (O2 = L2, I = K2);
          }
          var x2 = false, O2, I, j = m2 === void 0 ? null : m2;
          return [
            function() {
              return C(u());
            },
            j === null ? void 0 : function() {
              return C(j());
            }
          ];
        },
        [u, m2, f3, g]
      );
      var p = r(d, h2[0], h2[1]);
      return c2(
        function() {
          b3.hasValue = true, b3.value = p;
        },
        [p]
      ), a2(p), p;
    }, typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop == "function" && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
  })()), Be;
}
false ? Ie.exports = Co() : Ie.exports = vo();
var wo = Ie.exports;
var ko = typeof window < "u" ? import_react12.useLayoutEffect : import_react12.useEffect;
var Ho = class {
  constructor(t) {
    ee(this, "transactionNumber", 0);
    ee(this, "lastTransactionNumber", 0);
    ee(this, "lastSnapshot");
    ee(this, "editor");
    ee(this, "subscribers", /* @__PURE__ */ new Set());
    this.editor = t, this.lastSnapshot = { editor: t, transactionNumber: 0 }, this.getSnapshot = this.getSnapshot.bind(this), this.getServerSnapshot = this.getServerSnapshot.bind(this), this.watch = this.watch.bind(this), this.subscribe = this.subscribe.bind(this);
  }
  /**
   * Get the current editor instance.
   */
  getSnapshot() {
    return this.transactionNumber === this.lastTransactionNumber ? this.lastSnapshot : (this.lastTransactionNumber = this.transactionNumber, this.lastSnapshot = {
      editor: this.editor,
      transactionNumber: this.transactionNumber
    }, this.lastSnapshot);
  }
  /**
   * Always disable the editor on the server-side.
   */
  getServerSnapshot() {
    return { editor: null, transactionNumber: 0 };
  }
  /**
   * Subscribe to the editor instance's changes.
   */
  subscribe(t) {
    return this.subscribers.add(t), () => {
      this.subscribers.delete(t);
    };
  }
  /**
   * Watch the editor instance for changes.
   */
  watch(t, n) {
    if (this.editor = t, this.editor) {
      const o = () => {
        this.transactionNumber += 1, this.subscribers.forEach((c2) => c2());
      }, r = this.editor._tiptapEditor, i = {
        all: "transaction",
        selection: "selectionUpdate",
        change: "update"
      };
      return r.on(i[n], o), () => {
        r.off(i[n], o);
      };
    }
  }
};
function R2(e2) {
  const t = q(), n = e2.editor || (t == null ? void 0 : t.editor) || null, o = e2.on || "all", [r] = (0, import_react12.useState)(() => new Ho(n)), i = wo.useSyncExternalStoreWithSelector(
    r.subscribe,
    r.getSnapshot,
    r.getServerSnapshot,
    e2.selector,
    e2.equalityFn ?? ho
  );
  return ko(() => r.watch(n, o), [n, r, o]), (0, import_react12.useDebugValue)(i), i;
}
var Ge = (e2) => {
  const { position: t, children: n, ...o } = e2, { from: r, to: i } = t || {}, c2 = v(), s = (0, import_react12.useMemo)(() => {
    var a2;
    if (!(r === void 0 || i === void 0))
      return {
        // Use first child as the editor DOM element may itself be scrollable.
        // For FloatingUI to auto-update the position during scrolling, the
        // `contextElement` must be a descendant of the scroll container.
        element: ((a2 = c2.domElement) == null ? void 0 : a2.firstElementChild) || void 0,
        getBoundingClientRect: () => posToDOMRect(c2.prosemirrorView, r, i ?? r)
      };
  }, [c2, r, i]);
  return (0, import_jsx_runtime10.jsx)($, { reference: s, ...o, children: t !== void 0 && n });
};
var Rt = {
  color: void 0,
  size: void 0,
  className: void 0,
  style: void 0,
  attr: void 0
};
var lt = import_react12.default.createContext && import_react12.default.createContext(Rt);
var xo = ["attr", "size", "title"];
function yo(e2, t) {
  if (e2 == null) return {};
  var n = Mo(e2, t), o, r;
  if (Object.getOwnPropertySymbols) {
    var i = Object.getOwnPropertySymbols(e2);
    for (r = 0; r < i.length; r++)
      o = i[r], !(t.indexOf(o) >= 0) && Object.prototype.propertyIsEnumerable.call(e2, o) && (n[o] = e2[o]);
  }
  return n;
}
function Mo(e2, t) {
  if (e2 == null) return {};
  var n = {};
  for (var o in e2)
    if (Object.prototype.hasOwnProperty.call(e2, o)) {
      if (t.indexOf(o) >= 0) continue;
      n[o] = e2[o];
    }
  return n;
}
function he() {
  return he = Object.assign ? Object.assign.bind() : function(e2) {
    for (var t = 1; t < arguments.length; t++) {
      var n = arguments[t];
      for (var o in n)
        Object.prototype.hasOwnProperty.call(n, o) && (e2[o] = n[o]);
    }
    return e2;
  }, he.apply(this, arguments);
}
function ct(e2, t) {
  var n = Object.keys(e2);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e2);
    t && (o = o.filter(function(r) {
      return Object.getOwnPropertyDescriptor(e2, r).enumerable;
    })), n.push.apply(n, o);
  }
  return n;
}
function be(e2) {
  for (var t = 1; t < arguments.length; t++) {
    var n = arguments[t] != null ? arguments[t] : {};
    t % 2 ? ct(Object(n), true).forEach(function(o) {
      So(e2, o, n[o]);
    }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e2, Object.getOwnPropertyDescriptors(n)) : ct(Object(n)).forEach(function(o) {
      Object.defineProperty(e2, o, Object.getOwnPropertyDescriptor(n, o));
    });
  }
  return e2;
}
function So(e2, t, n) {
  return t = Vo2(t), t in e2 ? Object.defineProperty(e2, t, { value: n, enumerable: true, configurable: true, writable: true }) : e2[t] = n, e2;
}
function Vo2(e2) {
  var t = To2(e2, "string");
  return typeof t == "symbol" ? t : t + "";
}
function To2(e2, t) {
  if (typeof e2 != "object" || !e2) return e2;
  var n = e2[Symbol.toPrimitive];
  if (n !== void 0) {
    var o = n.call(e2, t);
    if (typeof o != "object") return o;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (t === "string" ? String : Number)(e2);
}
function Ot(e2) {
  return e2 && e2.map((t, n) => import_react12.default.createElement(t.tag, be({
    key: n
  }, t.attr), Ot(t.child)));
}
function k(e2) {
  return (t) => import_react12.default.createElement(_o2, he({
    attr: be({}, e2.attr)
  }, t), Ot(e2.child));
}
function _o2(e2) {
  var t = (n) => {
    var {
      attr: o,
      size: r,
      title: i
    } = e2, c2 = yo(e2, xo), s = r || n.size || "1em", a2;
    return n.className && (a2 = n.className), e2.className && (a2 = (a2 ? a2 + " " : "") + e2.className), import_react12.default.createElement("svg", he({
      stroke: "currentColor",
      fill: "currentColor",
      strokeWidth: "0"
    }, n.attr, o, c2, {
      className: a2,
      style: be(be({
        color: e2.color || n.color
      }, n.style), e2.style),
      height: s,
      width: s,
      xmlns: "http://www.w3.org/2000/svg"
    }), i && import_react12.default.createElement("title", null, i), e2.children);
  };
  return lt !== void 0 ? import_react12.default.createElement(lt.Consumer, null, (n) => t(n)) : t(Rt);
}
function Bo2(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M8 7V11L2 6L8 1V5H13C17.4183 5 21 8.58172 21 13C21 17.4183 17.4183 21 13 21H4V19H13C16.3137 19 19 16.3137 19 13C19 9.68629 16.3137 7 13 7H8Z" }, child: [] }] })(e2);
}
function It(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M7.29117 20.8242L2 22L3.17581 16.7088C2.42544 15.3056 2 13.7025 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C10.2975 22 8.6944 21.5746 7.29117 20.8242ZM7.58075 18.711L8.23428 19.0605C9.38248 19.6745 10.6655 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 13.3345 4.32549 14.6175 4.93949 15.7657L5.28896 16.4192L4.63416 19.3658L7.58075 18.711Z" }, child: [] }] })(e2);
}
function Lo2(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M7.24264 17.9967H3V13.754L14.435 2.319C14.8256 1.92848 15.4587 1.92848 15.8492 2.319L18.6777 5.14743C19.0682 5.53795 19.0682 6.17112 18.6777 6.56164L7.24264 17.9967ZM3 19.9967H21V21.9967H3V19.9967Z" }, child: [] }] })(e2);
}
function Eo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M23 12L15.9289 19.0711L14.5147 17.6569L20.1716 12L14.5147 6.34317L15.9289 4.92896L23 12ZM3.82843 12L9.48528 17.6569L8.07107 19.0711L1 12L8.07107 4.92896L9.48528 6.34317L3.82843 12Z" }, child: [] }] })(e2);
}
function ze(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 8L9.00319 2H19.9978C20.5513 2 21 2.45531 21 2.9918V21.0082C21 21.556 20.5551 22 20.0066 22H3.9934C3.44476 22 3 21.5501 3 20.9932V8ZM10 4V9H5V20H19V4H10Z" }, child: [] }] })(e2);
}
function Ro2(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 4H21V6H3V4ZM5 19H19V21H5V19ZM3 14H21V16H3V14ZM5 9H19V11H5V9Z" }, child: [] }] })(e2);
}
function Oo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 4H21V6H3V4ZM3 19H21V21H3V19ZM3 14H21V16H3V14ZM3 9H21V11H3V9Z" }, child: [] }] })(e2);
}
function Io(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 4H21V6H3V4ZM3 19H17V21H3V19ZM3 14H21V16H3V14ZM3 9H17V11H3V9Z" }, child: [] }] })(e2);
}
function Po(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 4H21V6H3V4ZM7 19H21V21H7V19ZM3 14H21V16H3V14ZM7 9H21V11H7V9Z" }, child: [] }] })(e2);
}
function No3(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M8 11H12.5C13.8807 11 15 9.88071 15 8.5C15 7.11929 13.8807 6 12.5 6H8V11ZM18 15.5C18 17.9853 15.9853 20 13.5 20H6V4H12.5C14.9853 4 17 6.01472 17 8.5C17 9.70431 16.5269 10.7981 15.7564 11.6058C17.0979 12.3847 18 13.837 18 15.5ZM8 13V18H13.5C14.8807 18 16 16.8807 16 15.5C16 14.1193 14.8807 13 13.5 13H8Z" }, child: [] }] })(e2);
}
function Ao3(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3.41436 5.99995L5.70726 3.70706L4.29304 2.29285L0.585938 5.99995L4.29304 9.70706L5.70726 8.29285L3.41436 5.99995ZM9.58594 5.99995L7.29304 3.70706L8.70726 2.29285L12.4144 5.99995L8.70726 9.70706L7.29304 8.29285L9.58594 5.99995ZM14.0002 2.99995H21.0002C21.5524 2.99995 22.0002 3.44767 22.0002 3.99995V20C22.0002 20.5522 21.5524 21 21.0002 21H3.00015C2.44787 21 2.00015 20.5522 2.00015 20V12H4.00015V19H20.0002V4.99995H14.0002V2.99995Z" }, child: [] }] })(e2);
}
function at(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M5.55397 22H3.3999L10.9999 3H12.9999L20.5999 22H18.4458L16.0458 16H7.95397L5.55397 22ZM8.75397 14H15.2458L11.9999 5.88517L8.75397 14Z" }, child: [] }] })(e2);
}
function pe(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M13 20H11V13H4V20H2V4H4V11H11V4H13V20ZM21.0005 8V20H19.0005L19 10.204L17 10.74V8.67L19.5005 8H21.0005Z" }, child: [] }] })(e2);
}
function Ce(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M4 4V11H11V4H13V20H11V13H4V20H2V4H4ZM18.5 8C20.5711 8 22.25 9.67893 22.25 11.75C22.25 12.6074 21.9623 13.3976 21.4781 14.0292L21.3302 14.2102L18.0343 18H22V20H15L14.9993 18.444L19.8207 12.8981C20.0881 12.5908 20.25 12.1893 20.25 11.75C20.25 10.7835 19.4665 10 18.5 10C17.5818 10 16.8288 10.7071 16.7558 11.6065L16.75 11.75H14.75C14.75 9.67893 16.4289 8 18.5 8Z" }, child: [] }] })(e2);
}
function ve(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M22 8L21.9984 10L19.4934 12.883C21.0823 13.3184 22.25 14.7728 22.25 16.5C22.25 18.5711 20.5711 20.25 18.5 20.25C16.674 20.25 15.1528 18.9449 14.8184 17.2166L16.7821 16.8352C16.9384 17.6413 17.6481 18.25 18.5 18.25C19.4665 18.25 20.25 17.4665 20.25 16.5C20.25 15.5335 19.4665 14.75 18.5 14.75C18.214 14.75 17.944 14.8186 17.7056 14.9403L16.3992 13.3932L19.3484 10H15V8H22ZM4 4V11H11V4H13V20H11V13H4V20H2V4H4Z" }, child: [] }] })(e2);
}
function Pt(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M13 20H11V13H4V20H2V4H4V11H11V4H13V20ZM22 8V16H23.5V18H22V20H20V18H14.5V16.66L19.5 8H22ZM20 11.133L17.19 16H20V11.133Z" }, child: [] }] })(e2);
}
function Nt(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M22 8V10H17.6769L17.2126 12.6358C17.5435 12.5472 17.8912 12.5 18.25 12.5C20.4591 12.5 22.25 14.2909 22.25 16.5C22.25 18.7091 20.4591 20.5 18.25 20.5C16.4233 20.5 14.8827 19.2756 14.4039 17.6027L16.3271 17.0519C16.5667 17.8881 17.3369 18.5 18.25 18.5C19.3546 18.5 20.25 17.6046 20.25 16.5C20.25 15.3954 19.3546 14.5 18.25 14.5C17.6194 14.5 17.057 14.7918 16.6904 15.2478L14.8803 14.3439L16 8H22ZM4 4V11H11V4H13V20H11V13H4V20H2V4H4Z" }, child: [] }] })(e2);
}
function At(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M21.097 8L18.499 12.5C20.7091 12.5 22.5 14.2909 22.5 16.5C22.5 18.7091 20.7091 20.5 18.5 20.5C16.2909 20.5 14.5 18.7091 14.5 16.5C14.5 15.7636 14.699 15.0737 15.0461 14.4811L18.788 8H21.097ZM4 4V11H11V4H13V20H11V13H4V20H2V4H4ZM18.5 14.5C17.3954 14.5 16.5 15.3954 16.5 16.5C16.5 17.6046 17.3954 18.5 18.5 18.5C19.6046 18.5 20.5 17.6046 20.5 16.5C20.5 15.3954 19.6046 14.5 18.5 14.5Z" }, child: [] }] })(e2);
}
function Do(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 4H21V6H3V4ZM3 19H21V21H3V19ZM11 14H21V16H11V14ZM11 9H21V11H11V9ZM3 12.5L7 9V16L3 12.5Z" }, child: [] }] })(e2);
}
function Zo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 4H21V6H3V4ZM3 19H21V21H3V19ZM11 14H21V16H11V14ZM11 9H21V11H11V9ZM7 12.5L3 16V9L7 12.5Z" }, child: [] }] })(e2);
}
function st(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M8 5H11V19H8V21H16V19H13V5H16V3H8V5ZM2 7C1.44772 7 1 7.44772 1 8V16C1 16.5523 1.44772 17 2 17H8V15H3V9H8V7H2ZM16 9H21V15H16V17H22C22.5523 17 23 16.5523 23 16V8C23 7.44772 22.5523 7 22 7H16V9Z" }, child: [] }] })(e2);
}
function Fo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M15 20H7V18H9.92661L12.0425 6H9V4H17V6H14.0734L11.9575 18H15V20Z" }, child: [] }] })(e2);
}
function Uo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M17 17H22V19H19V22H17V17ZM7 7H2V5H5V2H7V7ZM18.364 15.5355L16.9497 14.1213L18.364 12.7071C20.3166 10.7545 20.3166 7.58866 18.364 5.63604C16.4113 3.68342 13.2455 3.68342 11.2929 5.63604L9.87868 7.05025L8.46447 5.63604L9.87868 4.22183C12.6123 1.48816 17.0445 1.48816 19.7782 4.22183C22.5118 6.9555 22.5118 11.3877 19.7782 14.1213L18.364 15.5355ZM15.5355 18.364L14.1213 19.7782C11.3877 22.5118 6.9555 22.5118 4.22183 19.7782C1.48816 17.0445 1.48816 12.6123 4.22183 9.87868L5.63604 8.46447L7.05025 9.87868L5.63604 11.2929C3.68342 13.2455 3.68342 16.4113 5.63604 18.364C7.58866 20.3166 10.7545 20.3166 12.7071 18.364L14.1213 16.9497L15.5355 18.364ZM14.8284 7.75736L16.2426 9.17157L9.17157 16.2426L7.75736 14.8284L14.8284 7.75736Z" }, child: [] }] })(e2);
}
function Dt(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M18.3638 15.5355L16.9496 14.1213L18.3638 12.7071C20.3164 10.7545 20.3164 7.58866 18.3638 5.63604C16.4112 3.68341 13.2453 3.68341 11.2927 5.63604L9.87849 7.05025L8.46428 5.63604L9.87849 4.22182C12.6122 1.48815 17.0443 1.48815 19.778 4.22182C22.5117 6.95549 22.5117 11.3876 19.778 14.1213L18.3638 15.5355ZM15.5353 18.364L14.1211 19.7782C11.3875 22.5118 6.95531 22.5118 4.22164 19.7782C1.48797 17.0445 1.48797 12.6123 4.22164 9.87868L5.63585 8.46446L7.05007 9.87868L5.63585 11.2929C3.68323 13.2455 3.68323 16.4113 5.63585 18.364C7.58847 20.3166 10.7543 20.3166 12.7069 18.364L14.1211 16.9497L15.5353 18.364ZM14.8282 7.75736L16.2425 9.17157L9.17139 16.2426L7.75717 14.8284L14.8282 7.75736Z" }, child: [] }] })(e2);
}
function Zt2(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M8.00008 6V9H5.00008V6H8.00008ZM3.00008 4V11H10.0001V4H3.00008ZM13.0001 4H21.0001V6H13.0001V4ZM13.0001 11H21.0001V13H13.0001V11ZM13.0001 18H21.0001V20H13.0001V18ZM10.7072 16.2071L9.29297 14.7929L6.00008 18.0858L4.20718 16.2929L2.79297 17.7071L6.00008 20.9142L10.7072 16.2071Z" }, child: [] }] })(e2);
}
function Ft(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M8 4H21V6H8V4ZM5 3V6H6V7H3V6H4V4H3V3H5ZM3 14V11.5H5V11H3V10H6V12.5H4V13H6V14H3ZM5 19.5H3V18.5H5V18H3V17H6V21H3V20H5V19.5ZM8 11H21V13H8V11ZM8 18H21V20H8V18Z" }, child: [] }] })(e2);
}
function Ut(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M8 4H21V6H8V4ZM4.5 6.5C3.67157 6.5 3 5.82843 3 5C3 4.17157 3.67157 3.5 4.5 3.5C5.32843 3.5 6 4.17157 6 5C6 5.82843 5.32843 6.5 4.5 6.5ZM4.5 13.5C3.67157 13.5 3 12.8284 3 12C3 11.1716 3.67157 10.5 4.5 10.5C5.32843 10.5 6 11.1716 6 12C6 12.8284 5.32843 13.5 4.5 13.5ZM4.5 20.4C3.67157 20.4 3 19.7284 3 18.9C3 18.0716 3.67157 17.4 4.5 17.4C5.32843 17.4 6 18.0716 6 18.9C6 19.7284 5.32843 20.4 4.5 20.4ZM8 11H21V13H8V11ZM8 18H21V20H8V18Z" }, child: [] }] })(e2);
}
function Go(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M20 3C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3H20ZM11 5H5V10.999H7V9L10 12L7 15V13H5V19H11V17H13V19H19V13H17V15L14 12L17 9V10.999H19V5H13V7H11V5ZM13 13V15H11V13H13ZM13 9V11H11V9H13Z" }, child: [] }] })(e2);
}
function zo2(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M21 20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3H20C20.5523 3 21 3.44772 21 4V20ZM19 11V5H13.001V7H15L12 10L9 7H11V5H5V11H7V13H5V19H11V17H9L12 14L15 17H13.001V19H19V13H17V11H19ZM11 13H9V11H11V13ZM15 13H13V11H15V13Z" }, child: [] }] })(e2);
}
function Gt(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M21 4H3V6H21V4ZM21 11H8V13H21V11ZM21 18H8V20H21V18ZM5 11H3V20H5V11Z" }, child: [] }] })(e2);
}
function jo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M17.1538 14C17.3846 14.5161 17.5 15.0893 17.5 15.7196C17.5 17.0625 16.9762 18.1116 15.9286 18.867C14.8809 19.6223 13.4335 20 11.5862 20C9.94674 20 8.32335 19.6185 6.71592 18.8555V16.6009C8.23538 17.4783 9.7908 17.917 11.3822 17.917C13.9333 17.917 15.2128 17.1846 15.2208 15.7196C15.2208 15.0939 15.0049 14.5598 14.5731 14.1173C14.5339 14.0772 14.4939 14.0381 14.4531 14H3V12H21V14H17.1538ZM13.076 11H7.62908C7.4566 10.8433 7.29616 10.6692 7.14776 10.4778C6.71592 9.92084 6.5 9.24559 6.5 8.45207C6.5 7.21602 6.96583 6.165 7.89749 5.299C8.82916 4.43299 10.2706 4 12.2219 4C13.6934 4 15.1009 4.32808 16.4444 4.98426V7.13591C15.2448 6.44921 13.9293 6.10587 12.4978 6.10587C10.0187 6.10587 8.77917 6.88793 8.77917 8.45207C8.77917 8.87172 8.99709 9.23796 9.43293 9.55079C9.86878 9.86362 10.4066 10.1135 11.0463 10.3004C11.6665 10.4816 12.3431 10.7148 13.076 11H13.076Z" }, child: [] }] })(e2);
}
function $o(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M13 10V14H19V10H13ZM11 10H5V14H11V10ZM13 19H19V16H13V19ZM11 19V16H5V19H11ZM13 5V8H19V5H13ZM11 5H5V8H11V5ZM4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3Z" }, child: [] }] })(e2);
}
function je(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M13 6V21H11V6H5V4H19V6H13Z" }, child: [] }] })(e2);
}
function Wo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M8 3V12C8 14.2091 9.79086 16 12 16C14.2091 16 16 14.2091 16 12V3H18V12C18 15.3137 15.3137 18 12 18C8.68629 18 6 15.3137 6 12V3H8ZM4 20H20V22H4V20Z" }, child: [] }] })(e2);
}
function qo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M2 3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V20.0066C22 20.5552 21.5447 21 21.0082 21H2.9918C2.44405 21 2 20.5551 2 20.0066V3.9934ZM8 5V19H16V5H8ZM4 5V7H6V5H4ZM18 5V7H20V5H18ZM4 9V11H6V9H4ZM18 9V11H20V9H18ZM4 13V15H6V13H4ZM18 13V15H20V13H18ZM4 17V19H6V17H4ZM18 17V19H20V17H18Z" }, child: [] }] })(e2);
}
function zt(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M5 11.1005L7 9.1005L12.5 14.6005L16 11.1005L19 14.1005V5H5V11.1005ZM4 3H20C20.5523 3 21 3.44772 21 4V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3ZM15.5 10C14.6716 10 14 9.32843 14 8.5C14 7.67157 14.6716 7 15.5 7C16.3284 7 17 7.67157 17 8.5C17 9.32843 16.3284 10 15.5 10Z" }, child: [] }] })(e2);
}
function Ko(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M21 15V18H24V20H21V23H19V20H16V18H19V15H21ZM21.0082 3C21.556 3 22 3.44495 22 3.9934L22.0007 13.3417C21.3749 13.1204 20.7015 13 20 13V5H4L4.001 19L13.2929 9.70715C13.6528 9.34604 14.22 9.31823 14.6123 9.62322L14.7065 9.70772L18.2521 13.2586C15.791 14.0069 14 16.2943 14 19C14 19.7015 14.1204 20.3749 14.3417 21.0007L2.9918 21C2.44405 21 2 20.5551 2 20.0066V3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082ZM8 7C9.10457 7 10 7.89543 10 9C10 10.1046 9.10457 11 8 11C6.89543 11 6 10.1046 6 9C6 7.89543 6.89543 7 8 7Z" }, child: [] }] })(e2);
}
function Xo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M20 3C20.5523 3 21 3.44772 21 4V5.757L19 7.757V5H5V13.1L9 9.1005L13.328 13.429L12.0012 14.7562L11.995 18.995L16.2414 19.0012L17.571 17.671L18.8995 19H19V16.242L21 14.242V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V4C3 3.44772 3.44772 3 4 3H20ZM21.7782 7.80761L23.1924 9.22183L15.4142 17L13.9979 16.9979L14 15.5858L21.7782 7.80761ZM15.5 7C16.3284 7 17 7.67157 17 8.5C17 9.32843 16.3284 10 15.5 10C14.6716 10 14 9.32843 14 8.5C14 7.67157 14.6716 7 15.5 7Z" }, child: [] }] })(e2);
}
function jt(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M22 18V20H2V18H22ZM2 3.5L10 8.5L2 13.5V3.5ZM22 11V13H12V11H22ZM22 4V6H12V4H22Z" }, child: [] }] })(e2);
}
function Yo2(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M3 3.9934C3 3.44476 3.44495 3 3.9934 3H20.0066C20.5552 3 21 3.44495 21 3.9934V20.0066C21 20.5552 20.5551 21 20.0066 21H3.9934C3.44476 21 3 20.5551 3 20.0066V3.9934ZM10.6219 8.41459C10.5562 8.37078 10.479 8.34741 10.4 8.34741C10.1791 8.34741 10 8.52649 10 8.74741V15.2526C10 15.3316 10.0234 15.4088 10.0672 15.4745C10.1897 15.6583 10.4381 15.708 10.6219 15.5854L15.5008 12.3328C15.5447 12.3035 15.5824 12.2658 15.6117 12.2219C15.7343 12.0381 15.6846 11.7897 15.5008 11.6672L10.6219 8.41459Z" }, child: [] }] })(e2);
}
function $t(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M2 16.0001H5.88889L11.1834 20.3319C11.2727 20.405 11.3846 20.4449 11.5 20.4449C11.7761 20.4449 12 20.2211 12 19.9449V4.05519C12 3.93977 11.9601 3.8279 11.887 3.73857C11.7121 3.52485 11.3971 3.49335 11.1834 3.66821L5.88889 8.00007H2C1.44772 8.00007 1 8.44778 1 9.00007V15.0001C1 15.5524 1.44772 16.0001 2 16.0001ZM23 12C23 15.292 21.5539 18.2463 19.2622 20.2622L17.8445 18.8444C19.7758 17.1937 21 14.7398 21 12C21 9.26016 19.7758 6.80629 17.8445 5.15557L19.2622 3.73779C21.5539 5.75368 23 8.70795 23 12ZM18 12C18 10.0883 17.106 8.38548 15.7133 7.28673L14.2842 8.71584C15.3213 9.43855 16 10.64 16 12C16 13.36 15.3213 14.5614 14.2842 15.2841L15.7133 16.7132C17.106 15.6145 18 13.9116 18 12Z" }, child: [] }] })(e2);
}
function Jo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M11 11V5H13V11H19V13H13V19H11V13H5V11H11Z" }, child: [] }] })(e2);
}
function Qo(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M9.9997 15.1709L19.1921 5.97852L20.6063 7.39273L9.9997 17.9993L3.63574 11.6354L5.04996 10.2212L9.9997 15.1709Z" }, child: [] }] })(e2);
}
function er(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 4V6H15V4H9Z" }, child: [] }] })(e2);
}
function tr(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM9 11V17H11V11H9ZM13 11V17H15V11H13ZM9 4V6H15V4H9Z" }, child: [] }] })(e2);
}
function nr(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19ZM14 9H19L12 16L5 9H10V3H14V9Z" }, child: [] }] })(e2);
}
function or(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M10 6V8H5V19H16V14H18V20C18 20.5523 17.5523 21 17 21H4C3.44772 21 3 20.5523 3 20V7C3 6.44772 3.44772 6 4 6H10ZM21 3V12L17.206 8.207L11.2071 14.2071L9.79289 12.7929L15.792 6.793L12 3H21Z" }, child: [] }] })(e2);
}
function rr(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M5 10C3.9 10 3 10.9 3 12C3 13.1 3.9 14 5 14C6.1 14 7 13.1 7 12C7 10.9 6.1 10 5 10ZM19 10C17.9 10 17 10.9 17 12C17 13.1 17.9 14 19 14C20.1 14 21 13.1 21 12C21 10.9 20.1 10 19 10ZM12 10C10.9 10 10 10.9 10 12C10 13.1 10.9 14 12 14C13.1 14 14 13.1 14 12C14 10.9 13.1 10 12 10Z" }, child: [] }] })(e2);
}
function ir(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M5 11V13H19V11H5Z" }, child: [] }] })(e2);
}
function lr(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM8 13C8 15.2091 9.79086 17 12 17C14.2091 17 16 15.2091 16 13H8ZM8 11C8.82843 11 9.5 10.3284 9.5 9.5C9.5 8.67157 8.82843 8 8 8C7.17157 8 6.5 8.67157 6.5 9.5C6.5 10.3284 7.17157 11 8 11ZM16 11C16.8284 11 17.5 10.3284 17.5 9.5C17.5 8.67157 16.8284 8 16 8C15.1716 8 14.5 8.67157 14.5 9.5C14.5 10.3284 15.1716 11 16 11Z" }, child: [] }] })(e2);
}
function dt(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "currentColor" }, child: [{ tag: "path", attr: { d: "M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM8 13H16C16 15.2091 14.2091 17 12 17C9.79086 17 8 15.2091 8 13ZM8 11C7.17157 11 6.5 10.3284 6.5 9.5C6.5 8.67157 7.17157 8 8 8C8.82843 8 9.5 8.67157 9.5 9.5C9.5 10.3284 8.82843 11 8 11ZM16 11C15.1716 11 14.5 10.3284 14.5 9.5C14.5 8.67157 15.1716 8 16 8C16.8284 8 17.5 8.67157 17.5 9.5C17.5 10.3284 16.8284 11 16 11Z" }, child: [] }] })(e2);
}
var cr = {
  bold: No3,
  italic: Fo,
  underline: Wo,
  strike: jo,
  code: Eo
};
function ar(e2, t) {
  return e2 in t.schema.styleSchema && t.schema.styleSchema[e2].type === e2 && t.schema.styleSchema[e2].propSchema === "boolean";
}
var de = (e2) => {
  const t = S2(), n = w2(), o = v(), r = R2({
    editor: o,
    selector: ({ editor: s }) => {
      var a2;
      if (
        // The editor is read-only.
        !(!s.isEditable || // The style is not in the schema.
        !ar(e2.basicTextStyle, s) || // None of the selected blocks have inline content
        !(((a2 = s.getSelection()) == null ? void 0 : a2.blocks) || [
          s.getTextCursorPosition().block
        ]).find((d) => d.content !== void 0))
      )
        return e2.basicTextStyle in s.getActiveStyles() ? { active: true } : { active: false };
    }
  }), i = (0, import_react12.useCallback)(
    (s) => {
      o.focus(), o.toggleStyles({ [s]: true });
    },
    [o, e2]
  );
  if (r === void 0)
    return null;
  const c2 = cr[e2.basicTextStyle];
  return (0, import_jsx_runtime10.jsx)(
    n.FormattingToolbar.Button,
    {
      className: "bn-button",
      "data-test": e2.basicTextStyle,
      onClick: () => i(e2.basicTextStyle),
      isSelected: r.active,
      label: t.formatting_toolbar[e2.basicTextStyle].tooltip,
      mainTooltip: t.formatting_toolbar[e2.basicTextStyle].tooltip,
      secondaryTooltip: L(
        t.formatting_toolbar[e2.basicTextStyle].secondary_tooltip,
        t.generic.ctrl_shortcut
      ),
      icon: (0, import_jsx_runtime10.jsx)(c2, {})
    }
  );
};
var Pe = (e2) => {
  const t = e2.textColor || "default", n = e2.backgroundColor || "default", o = e2.size || 16, r = (0, import_react12.useMemo)(
    () => ({
      pointerEvents: "none",
      fontSize: (o * 0.75).toString() + "px",
      height: o.toString() + "px",
      lineHeight: o.toString() + "px",
      textAlign: "center",
      width: o.toString() + "px"
    }),
    [o]
  );
  return (0, import_jsx_runtime10.jsx)(
    "div",
    {
      className: "bn-color-icon",
      "data-background-color": n,
      "data-text-color": t,
      style: r,
      children: "A"
    }
  );
};
var ut = [
  "default",
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink"
];
var xe = (e2) => {
  const t = w2(), n = S2();
  return (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    (0, import_jsx_runtime10.jsx)(() => e2.text ? (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Label, { children: n.color_picker.text_title }),
      ut.map((i) => (0, import_jsx_runtime10.jsx)(
        t.Generic.Menu.Item,
        {
          onClick: () => {
            e2.onClick && e2.onClick(), e2.text.setColor(i);
          },
          "data-test": "text-color-" + i,
          icon: (0, import_jsx_runtime10.jsx)(Pe, { textColor: i, size: e2.iconSize }),
          checked: e2.text.color === i,
          children: n.color_picker.colors[i]
        },
        "text-color-" + i
      ))
    ] }) : null, {}),
    (0, import_jsx_runtime10.jsx)(() => e2.background ? (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Label, { children: n.color_picker.background_title }),
      ut.map((i) => (0, import_jsx_runtime10.jsx)(
        t.Generic.Menu.Item,
        {
          onClick: () => {
            e2.onClick && e2.onClick(), e2.background.setColor(i);
          },
          "data-test": "background-color-" + i,
          icon: (0, import_jsx_runtime10.jsx)(Pe, { backgroundColor: i, size: e2.iconSize }),
          checked: e2.background.color === i,
          children: n.color_picker.colors[i]
        },
        "background-color-" + i
      ))
    ] }) : null, {})
  ] });
};
function ue(e2, t) {
  return `${e2}Color` in t.schema.styleSchema && t.schema.styleSchema[`${e2}Color`].type === `${e2}Color` && t.schema.styleSchema[`${e2}Color`].propSchema === "string";
}
var sr = () => {
  const e2 = w2(), t = S2(), n = v(), o = ue("text", n), r = ue("background", n), i = R2({
    editor: n,
    selector: ({ editor: a2 }) => {
      var m2;
      if (
        // The editor is read-only.
        !a2.isEditable || // None of the selected blocks have inline content
        !(((m2 = a2.getSelection()) == null ? void 0 : m2.blocks) || [
          a2.getTextCursorPosition().block
        ]).find((f3) => f3.content !== void 0)
      )
        return;
      const d = ue("text", a2), u = ue("background", a2);
      if (!(!d && !u))
        return {
          textColor: d ? a2.getActiveStyles().textColor || "default" : void 0,
          backgroundColor: u ? a2.getActiveStyles().backgroundColor || "default" : void 0
        };
    }
  }), c2 = (0, import_react12.useCallback)(
    (a2) => {
      if (!o)
        throw Error(
          "Tried to set text color, but style does not exist in editor schema."
        );
      a2 === "default" ? n.removeStyles({ textColor: a2 }) : n.addStyles({ textColor: a2 }), setTimeout(() => {
        n.focus();
      });
    },
    [n, o]
  ), s = (0, import_react12.useCallback)(
    (a2) => {
      if (!r)
        throw Error(
          "Tried to set background color, but style does not exist in editor schema."
        );
      a2 === "default" ? n.removeStyles({ backgroundColor: a2 }) : n.addStyles({ backgroundColor: a2 }), setTimeout(() => {
        n.focus();
      });
    },
    [r, n]
  );
  return i === void 0 ? null : (0, import_jsx_runtime10.jsxs)(e2.Generic.Menu.Root, { children: [
    (0, import_jsx_runtime10.jsx)(e2.Generic.Menu.Trigger, { children: (0, import_jsx_runtime10.jsx)(
      e2.FormattingToolbar.Button,
      {
        className: "bn-button",
        "data-test": "colors",
        label: t.formatting_toolbar.colors.tooltip,
        mainTooltip: t.formatting_toolbar.colors.tooltip,
        icon: (0, import_jsx_runtime10.jsx)(
          Pe,
          {
            textColor: i.textColor,
            backgroundColor: i.backgroundColor,
            size: 20
          }
        )
      }
    ) }),
    (0, import_jsx_runtime10.jsx)(
      e2.Generic.Menu.Dropdown,
      {
        className: "bn-menu-dropdown bn-color-picker-dropdown",
        children: (0, import_jsx_runtime10.jsx)(
          xe,
          {
            text: i.textColor ? {
              color: i.textColor,
              setColor: c2
            } : void 0,
            background: i.backgroundColor ? {
              color: i.backgroundColor,
              setColor: s
            } : void 0
          }
        )
      }
    )
  ] });
};
var mt = (e2) => {
  for (const t of Ro)
    if (e2.startsWith(t))
      return e2;
  return `${Vo}://${e2}`;
};
var Wt2 = (e2) => {
  const t = w2(), n = S2(), { editLink: o } = _(No2), { url: r, text: i, showTextField: c2 } = e2, [s, a2] = (0, import_react12.useState)(r), [d, u] = (0, import_react12.useState)(i);
  (0, import_react12.useEffect)(() => {
    a2(r), u(i);
  }, [i, r]);
  const m2 = (0, import_react12.useCallback)(
    (b3) => {
      var p, C;
      b3.key === "Enter" && !b3.nativeEvent.isComposing && (b3.preventDefault(), o(mt(s), d, e2.range.from), (p = e2.setToolbarOpen) == null || p.call(e2, false), (C = e2.setToolbarPositionFrozen) == null || C.call(e2, false));
    },
    [o, s, d, e2]
  ), f3 = (0, import_react12.useCallback)(
    (b3) => a2(b3.currentTarget.value),
    []
  ), g = (0, import_react12.useCallback)(
    (b3) => u(b3.currentTarget.value),
    []
  ), h2 = (0, import_react12.useCallback)(() => {
    var b3, p;
    o(mt(s), d, e2.range.from), (b3 = e2.setToolbarOpen) == null || b3.call(e2, false), (p = e2.setToolbarPositionFrozen) == null || p.call(e2, false);
  }, [o, s, d, e2]);
  return (0, import_jsx_runtime10.jsxs)(t.Generic.Form.Root, { children: [
    (0, import_jsx_runtime10.jsx)(
      t.Generic.Form.TextInput,
      {
        className: "bn-text-input",
        name: "url",
        icon: (0, import_jsx_runtime10.jsx)(Dt, {}),
        autoFocus: true,
        placeholder: n.link_toolbar.form.url_placeholder,
        value: s,
        onKeyDown: m2,
        onChange: f3,
        onSubmit: h2
      }
    ),
    c2 !== false && (0, import_jsx_runtime10.jsx)(
      t.Generic.Form.TextInput,
      {
        className: "bn-text-input",
        name: "title",
        icon: (0, import_jsx_runtime10.jsx)(je, {}),
        placeholder: n.link_toolbar.form.title_placeholder,
        value: d,
        onKeyDown: m2,
        onChange: g,
        onSubmit: h2
      }
    )
  ] });
};
function dr(e2) {
  return "link" in e2.schema.inlineContentSchema && e2.schema.inlineContentSchema.link === "link";
}
var ur = () => {
  const e2 = v(), t = w2(), n = S2(), o = _(Ao2), { showSelection: r } = _(b2), [i, c2] = (0, import_react12.useState)(false);
  (0, import_react12.useEffect)(() => (r(i, "createLinkButton"), () => r(false, "createLinkButton")), [i, r]);
  const s = R2({
    editor: e2,
    selector: ({ editor: a2 }) => {
      var d;
      if (
        // The editor is read-only.
        !(!a2.isEditable || // Links are not in the schema.
        !dr(a2) || // Table cells are selected.
        Bo(a2.prosemirrorState.selection) || // None of the selected blocks have inline content
        !(((d = a2.getSelection()) == null ? void 0 : d.blocks) || [
          a2.getTextCursorPosition().block
        ]).find((u) => u.content !== void 0))
      )
        return {
          url: a2.getSelectedLinkUrl(),
          text: a2.getSelectedText(),
          range: {
            from: a2.prosemirrorState.selection.from,
            to: a2.prosemirrorState.selection.to
          }
        };
    }
  });
  return (0, import_react12.useEffect)(() => {
    c2(false);
  }, [s]), (0, import_react12.useEffect)(() => {
    const a2 = (u) => {
      (u.ctrlKey || u.metaKey) && u.key === "k" && (c2(true), u.preventDefault());
    }, d = e2.domElement;
    return d == null || d.addEventListener("keydown", a2), () => {
      d == null || d.removeEventListener("keydown", a2);
    };
  }, [e2.domElement]), s === void 0 ? null : (0, import_jsx_runtime10.jsxs)(
    t.Generic.Popover.Root,
    {
      open: i,
      onOpenChange: c2,
      children: [
        (0, import_jsx_runtime10.jsx)(t.Generic.Popover.Trigger, { children: (0, import_jsx_runtime10.jsx)(
          t.FormattingToolbar.Button,
          {
            className: "bn-button",
            "data-test": "createLink",
            label: n.formatting_toolbar.link.tooltip,
            mainTooltip: n.formatting_toolbar.link.tooltip,
            secondaryTooltip: L(
              n.formatting_toolbar.link.secondary_tooltip,
              n.generic.ctrl_shortcut
            ),
            icon: (0, import_jsx_runtime10.jsx)(Dt, {}),
            onClick: () => c2((a2) => !a2)
          }
        ) }),
        (0, import_jsx_runtime10.jsx)(
          t.Generic.Popover.Content,
          {
            className: "bn-popover-content bn-form-popover",
            variant: "form-popover",
            children: (0, import_jsx_runtime10.jsx)(
              Wt2,
              {
                url: s.url || "",
                text: s.text,
                range: s.range,
                showTextField: false,
                setToolbarOpen: (a2) => o.store.setState(a2)
              }
            )
          }
        )
      ]
    }
  );
};
var mr = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: a2 }) => {
      var m2;
      if (!a2.isEditable)
        return;
      const d = ((m2 = a2.getSelection()) == null ? void 0 : m2.blocks) || [
        a2.getTextCursorPosition().block
      ];
      if (d.length !== 1)
        return;
      const u = d[0];
      if (To(u, a2, u.type, {
        url: "string",
        caption: "string"
      }))
        return u;
    }
  }), [r, i] = (0, import_react12.useState)();
  (0, import_react12.useEffect)(() => {
    o !== void 0 && i(o.props.caption);
  }, [o]);
  const c2 = (0, import_react12.useCallback)(
    (a2) => i(a2.currentTarget.value),
    []
  ), s = (0, import_react12.useCallback)(
    (a2) => {
      o !== void 0 && b(n, o.type, {
        caption: "string"
      }) && a2.key === "Enter" && !a2.nativeEvent.isComposing && (a2.preventDefault(), n.updateBlock(o.id, {
        props: {
          caption: r
        }
      }));
    },
    [o, r, n]
  );
  return o === void 0 ? null : (0, import_jsx_runtime10.jsxs)(t.Generic.Popover.Root, { children: [
    (0, import_jsx_runtime10.jsx)(t.Generic.Popover.Trigger, { children: (0, import_jsx_runtime10.jsx)(
      t.FormattingToolbar.Button,
      {
        className: "bn-button",
        label: e2.formatting_toolbar.file_caption.tooltip,
        mainTooltip: e2.formatting_toolbar.file_caption.tooltip,
        icon: (0, import_jsx_runtime10.jsx)(st, {})
      }
    ) }),
    (0, import_jsx_runtime10.jsx)(
      t.Generic.Popover.Content,
      {
        className: "bn-popover-content bn-form-popover",
        variant: "form-popover",
        children: (0, import_jsx_runtime10.jsx)(t.Generic.Form.Root, { children: (0, import_jsx_runtime10.jsx)(
          t.Generic.Form.TextInput,
          {
            name: "file-caption",
            icon: (0, import_jsx_runtime10.jsx)(st, {}),
            value: r || "",
            autoFocus: true,
            placeholder: e2.formatting_toolbar.file_caption.input_placeholder,
            onKeyDown: s,
            onChange: c2
          }
        ) })
      }
    )
  ] });
};
var fr = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: i }) => {
      var a2;
      if (!i.isEditable)
        return;
      const c2 = ((a2 = i.getSelection()) == null ? void 0 : a2.blocks) || [
        i.getTextCursorPosition().block
      ];
      if (c2.length !== 1)
        return;
      const s = c2[0];
      if (To(s, i, s.type, {
        url: "string"
      }))
        return s;
    }
  }), r = (0, import_react12.useCallback)(() => {
    o !== void 0 && (n.focus(), n.removeBlocks([o.id]));
  }, [o, n]);
  return o === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      label: e2.formatting_toolbar.file_delete.tooltip[o.type] || e2.formatting_toolbar.file_delete.tooltip.file,
      mainTooltip: e2.formatting_toolbar.file_delete.tooltip[o.type] || e2.formatting_toolbar.file_delete.tooltip.file,
      icon: (0, import_jsx_runtime10.jsx)(er, {}),
      onClick: r
    }
  );
};
var gr = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: a2 }) => {
      var m2;
      if (!a2.isEditable)
        return;
      const d = ((m2 = a2.getSelection()) == null ? void 0 : m2.blocks) || [
        a2.getTextCursorPosition().block
      ];
      if (d.length !== 1)
        return;
      const u = d[0];
      if (To(u, a2, u.type, {
        url: "string",
        name: "string"
      }))
        return u;
    }
  }), [r, i] = (0, import_react12.useState)();
  (0, import_react12.useEffect)(() => {
    o !== void 0 && i(o.props.name);
  }, [o]);
  const c2 = (0, import_react12.useCallback)(
    (a2) => i(a2.currentTarget.value),
    []
  ), s = (0, import_react12.useCallback)(
    (a2) => {
      o !== void 0 && b(n, o.type, {
        name: "string"
      }) && a2.key === "Enter" && !a2.nativeEvent.isComposing && (a2.preventDefault(), n.updateBlock(o.id, {
        props: {
          name: r
        }
      }));
    },
    [o, r, n]
  );
  return o === void 0 ? null : (0, import_jsx_runtime10.jsxs)(t.Generic.Popover.Root, { children: [
    (0, import_jsx_runtime10.jsx)(t.Generic.Popover.Trigger, { children: (0, import_jsx_runtime10.jsx)(
      t.FormattingToolbar.Button,
      {
        className: "bn-button",
        label: e2.formatting_toolbar.file_rename.tooltip[o.type] || e2.formatting_toolbar.file_rename.tooltip.file,
        mainTooltip: e2.formatting_toolbar.file_rename.tooltip[o.type] || e2.formatting_toolbar.file_rename.tooltip.file,
        icon: (0, import_jsx_runtime10.jsx)(at, {})
      }
    ) }),
    (0, import_jsx_runtime10.jsx)(
      t.Generic.Popover.Content,
      {
        className: "bn-popover-content bn-form-popover",
        variant: "form-popover",
        children: (0, import_jsx_runtime10.jsx)(t.Generic.Form.Root, { children: (0, import_jsx_runtime10.jsx)(
          t.Generic.Form.TextInput,
          {
            name: "file-name",
            icon: (0, import_jsx_runtime10.jsx)(at, {}),
            value: r || "",
            autoFocus: true,
            placeholder: e2.formatting_toolbar.file_rename.input_placeholder[o.type] || e2.formatting_toolbar.file_rename.input_placeholder.file,
            onKeyDown: s,
            onChange: c2
          }
        ) })
      }
    )
  ] });
};
var hr = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: r }) => {
      var s;
      if (!r.isEditable)
        return;
      const i = ((s = r.getSelection()) == null ? void 0 : s.blocks) || [
        r.getTextCursorPosition().block
      ];
      if (i.length !== 1)
        return;
      const c2 = i[0];
      if (To(c2, r, c2.type, {
        url: "string"
      }))
        return c2;
    }
  });
  return o === void 0 ? null : (0, import_jsx_runtime10.jsxs)(t.Generic.Popover.Root, { position: "bottom", children: [
    (0, import_jsx_runtime10.jsx)(t.Generic.Popover.Trigger, { children: (0, import_jsx_runtime10.jsx)(
      t.FormattingToolbar.Button,
      {
        className: "bn-button",
        mainTooltip: e2.formatting_toolbar.file_replace.tooltip[o.type] || e2.formatting_toolbar.file_replace.tooltip.file,
        label: e2.formatting_toolbar.file_replace.tooltip[o.type] || e2.formatting_toolbar.file_replace.tooltip.file,
        icon: (0, import_jsx_runtime10.jsx)(Xo, {})
      }
    ) }),
    (0, import_jsx_runtime10.jsx)(
      t.Generic.Popover.Content,
      {
        className: "bn-popover-content bn-panel-popover",
        variant: "panel-popover",
        children: (0, import_jsx_runtime10.jsx)(Lt, { blockId: o.id })
      }
    )
  ] });
};
var br = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: i }) => {
      var c2;
      if (
        // The editor is read-only.
        !(!i.isEditable || // None of the selected blocks have inline content
        !(((c2 = i.getSelection()) == null ? void 0 : c2.blocks) || [
          i.getTextCursorPosition().block
        ]).find((s) => s.content !== void 0))
      )
        return {
          canNestBlock: i.canNestBlock()
        };
    }
  }), r = (0, import_react12.useCallback)(() => {
    o !== void 0 && o.canNestBlock && (n.focus(), n.nestBlock());
  }, [n, o]);
  return o === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      "data-test": "nestBlock",
      onClick: r,
      isDisabled: !o.canNestBlock,
      label: e2.formatting_toolbar.nest.tooltip,
      mainTooltip: e2.formatting_toolbar.nest.tooltip,
      secondaryTooltip: L(
        e2.formatting_toolbar.nest.secondary_tooltip,
        e2.generic.ctrl_shortcut
      ),
      icon: (0, import_jsx_runtime10.jsx)(Zo, {})
    }
  );
};
var pr = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: i }) => {
      var c2;
      if (
        // The editor is read-only.
        !(!i.isEditable || // None of the selected blocks have inline content
        !(((c2 = i.getSelection()) == null ? void 0 : c2.blocks) || [
          i.getTextCursorPosition().block
        ]).find((s) => s.content !== void 0))
      )
        return {
          canUnnestBlock: i.canUnnestBlock()
        };
    }
  }), r = (0, import_react12.useCallback)(() => {
    o !== void 0 && o.canUnnestBlock && (n.focus(), n.unnestBlock());
  }, [n, o]);
  return o === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      "data-test": "unnestBlock",
      onClick: r,
      isDisabled: !o.canUnnestBlock,
      label: e2.formatting_toolbar.unnest.tooltip,
      mainTooltip: e2.formatting_toolbar.unnest.tooltip,
      secondaryTooltip: L(
        e2.formatting_toolbar.unnest.secondary_tooltip,
        e2.generic.ctrl_shortcut
      ),
      icon: (0, import_jsx_runtime10.jsx)(Do, {})
    }
  );
};
var Cr = (e2) => [
  {
    name: e2.slash_menu.paragraph.title,
    type: "paragraph",
    icon: je
  },
  {
    name: e2.slash_menu.heading.title,
    type: "heading",
    props: { level: 1, isToggleable: false },
    icon: pe
  },
  {
    name: e2.slash_menu.heading_2.title,
    type: "heading",
    props: { level: 2, isToggleable: false },
    icon: Ce
  },
  {
    name: e2.slash_menu.heading_3.title,
    type: "heading",
    props: { level: 3, isToggleable: false },
    icon: ve
  },
  {
    name: e2.slash_menu.heading_4.title,
    type: "heading",
    props: { level: 4, isToggleable: false },
    icon: Pt
  },
  {
    name: e2.slash_menu.heading_5.title,
    type: "heading",
    props: { level: 5, isToggleable: false },
    icon: Nt
  },
  {
    name: e2.slash_menu.heading_6.title,
    type: "heading",
    props: { level: 6, isToggleable: false },
    icon: At
  },
  {
    name: e2.slash_menu.toggle_heading.title,
    type: "heading",
    props: { level: 1, isToggleable: true },
    icon: pe
  },
  {
    name: e2.slash_menu.toggle_heading_2.title,
    type: "heading",
    props: { level: 2, isToggleable: true },
    icon: Ce
  },
  {
    name: e2.slash_menu.toggle_heading_3.title,
    type: "heading",
    props: { level: 3, isToggleable: true },
    icon: ve
  },
  {
    name: e2.slash_menu.quote.title,
    type: "quote",
    icon: Gt
  },
  {
    name: e2.slash_menu.toggle_list.title,
    type: "toggleListItem",
    icon: jt
  },
  {
    name: e2.slash_menu.bullet_list.title,
    type: "bulletListItem",
    icon: Ut
  },
  {
    name: e2.slash_menu.numbered_list.title,
    type: "numberedListItem",
    icon: Ft
  },
  {
    name: e2.slash_menu.check_list.title,
    type: "checkListItem",
    icon: Zt2
  }
];
var vr = (e2) => {
  const t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: a2 }) => {
      var d;
      return ((d = a2.getSelection()) == null ? void 0 : d.blocks) || [a2.getTextCursorPosition().block];
    }
  }), r = o[0], i = (0, import_react12.useMemo)(
    () => (e2.items || Cr(n.dictionary)).filter(
      (a2) => b(
        n,
        a2.type,
        Object.fromEntries(
          Object.entries(a2.props || {}).map(([d, u]) => [
            d,
            typeof u
          ])
        )
      )
    ),
    [n, e2.items]
  ), c2 = (0, import_react12.useMemo)(() => i.map((a2) => {
    const d = a2.icon, u = a2.type === r.type, m2 = Object.entries(a2.props || {}).filter(
      ([f3, g]) => g !== r.props[f3]
    ).length === 0;
    return {
      text: a2.name,
      icon: (0, import_jsx_runtime10.jsx)(d, { size: 16 }),
      onClick: () => {
        n.focus(), n.transact(() => {
          for (const f3 of o)
            n.updateBlock(f3, {
              type: a2.type,
              props: a2.props
            });
        });
      },
      isSelected: u && m2
    };
  }), [
    n,
    i,
    r.props,
    r.type,
    o
  ]);
  return !(0, import_react12.useMemo)(
    () => c2.find((a2) => a2.isSelected) !== void 0,
    [c2]
  ) || !n.isEditable ? null : (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Select,
    {
      className: "bn-select",
      items: c2
    }
  );
};
var wr = () => {
  const e2 = S2(), t = w2(), n = _("comments"), { store: o } = _(Ao2), r = (0, import_react12.useCallback)(() => {
    n.startPendingComment(), o.setState(false);
  }, [n, o]);
  return (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      label: e2.formatting_toolbar.comment.tooltip,
      mainTooltip: e2.formatting_toolbar.comment.tooltip,
      icon: (0, import_jsx_runtime10.jsx)(It, {}),
      onClick: r
    }
  );
};
var kr = () => v().getExtension("comments") ? (0, import_jsx_runtime10.jsx)(wr, {}) : null;
var Hr = () => {
  const e2 = S2(), t = w2(), n = v(), o = (0, import_react12.useCallback)(() => {
    n._tiptapEditor.chain().focus().addPendingComment().run();
  }, [n]);
  return (
    // We manually check if a comment extension (like liveblocks) is installed
    // By adding default support for this, the user doesn't need to customize the formatting toolbar
    !n._tiptapEditor.commands.addPendingComment || !n.isEditable ? null : (0, import_jsx_runtime10.jsx)(
      t.FormattingToolbar.Button,
      {
        className: "bn-button",
        label: e2.formatting_toolbar.comment.tooltip,
        mainTooltip: e2.formatting_toolbar.comment.tooltip,
        icon: (0, import_jsx_runtime10.jsx)(It, {}),
        onClick: o
      }
    )
  );
};
function Ne(e2, t) {
  try {
    const n = new URL(e2, t);
    if (n.protocol !== "javascript:")
      return n.href;
  } catch {
  }
  return "#";
}
var xr = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: i }) => {
      var a2;
      const c2 = ((a2 = i.getSelection()) == null ? void 0 : a2.blocks) || [
        i.getTextCursorPosition().block
      ];
      if (c2.length !== 1)
        return;
      const s = c2[0];
      if (To(s, i, s.type, {
        url: "string"
      }))
        return s;
    }
  }), r = (0, import_react12.useCallback)(() => {
    o !== void 0 && (n.focus(), n.resolveFileUrl ? n.resolveFileUrl(o.props.url).then(
      (i) => window.open(Ne(i, window.location.href))
    ) : window.open(Ne(o.props.url, window.location.href)));
  }, [o, n]);
  return o === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      label: e2.formatting_toolbar.file_download.tooltip[o.type] || e2.formatting_toolbar.file_download.tooltip.file,
      mainTooltip: e2.formatting_toolbar.file_download.tooltip[o.type] || e2.formatting_toolbar.file_download.tooltip.file,
      icon: (0, import_jsx_runtime10.jsx)(nr, {}),
      onClick: r
    }
  );
};
var yr = () => {
  const e2 = S2(), t = w2(), n = v(), o = R2({
    editor: n,
    selector: ({ editor: i }) => {
      var a2;
      if (!i.isEditable)
        return;
      const c2 = ((a2 = i.getSelection()) == null ? void 0 : a2.blocks) || [
        i.getTextCursorPosition().block
      ];
      if (c2.length !== 1)
        return;
      const s = c2[0];
      if (To(s, i, s.type, {
        url: "string",
        showPreview: "boolean"
      }))
        return s;
    }
  }), r = (0, import_react12.useCallback)(() => {
    o !== void 0 && b(n, o.type, {
      showPreview: "boolean"
    }) && n.updateBlock(o.id, {
      props: {
        showPreview: !o.props.showPreview
      }
    });
  }, [o, n]);
  return o === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      label: "Toggle preview",
      mainTooltip: e2.formatting_toolbar.file_preview_toggle.tooltip,
      icon: (0, import_jsx_runtime10.jsx)(Ko, {}),
      isSelected: o.props.showPreview,
      onClick: r
    }
  );
};
var Mr = () => {
  const e2 = S2(), t = w2(), n = v(), o = _(Yo), r = R2({
    editor: n,
    selector: ({ editor: c2 }) => {
      var d;
      if (!c2.isEditable || !c2.settings.tables.splitCells)
        return;
      const s = ((d = c2.getSelection()) == null ? void 0 : d.blocks) || [
        c2.getTextCursorPosition().block
      ];
      if (s.length !== 1)
        return;
      const a2 = s[0];
      if (a2.type === "table")
        return {
          mergeDirection: o.getMergeDirection(a2)
        };
    }
  }), i = (0, import_react12.useCallback)(() => {
    o == null || o.mergeCells();
  }, [o]);
  return r === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      label: e2.formatting_toolbar.table_cell_merge.tooltip,
      mainTooltip: e2.formatting_toolbar.table_cell_merge.tooltip,
      icon: r.mergeDirection === "horizontal" ? (0, import_jsx_runtime10.jsx)(Go, {}) : (0, import_jsx_runtime10.jsx)(zo2, {}),
      onClick: i
    }
  );
};
var Sr = () => v().getExtension(Yo) ? (0, import_jsx_runtime10.jsx)(Mr, {}) : null;
var Vr = {
  left: Io,
  center: Ro2,
  right: Po,
  justify: Oo
};
var Le2 = (e2) => {
  const t = w2(), n = S2(), o = v(), r = R2({
    editor: o,
    selector: ({ editor: s }) => {
      var u, m2;
      if (!s.isEditable)
        return;
      const a2 = ((u = s.getSelection()) == null ? void 0 : u.blocks) || [
        s.getTextCursorPosition().block
      ], d = a2[0];
      if (To(d, s, d.type, {
        textAlignment: m.textAlignment
      }))
        return {
          textAlignment: d.props.textAlignment,
          blocks: a2
        };
      if (a2.length === 1 && To(d, s, "table"))
        return ((m2 = s.getExtension(Yo)) == null ? void 0 : m2.getCellSelection()) ? {
          textAlignment: S(
            d.content.rows[0].cells[0]
          ).props.textAlignment,
          blocks: [d]
        } : void 0;
    }
  }), i = (0, import_react12.useCallback)(
    (s) => {
      var a2;
      if (r !== void 0) {
        o.focus();
        for (const d of r.blocks)
          if (To(d, o, d.type, {
            textAlignment: m.textAlignment
          }) && b(o, d.type, {
            textAlignment: m.textAlignment
          }))
            o.updateBlock(d, {
              props: { textAlignment: s }
            });
          else if (d.type === "table") {
            const u = (a2 = o.getExtension(Yo)) == null ? void 0 : a2.getCellSelection();
            if (!u)
              continue;
            const m2 = d.content.rows.map(
              (f3) => ({
                ...f3,
                cells: f3.cells.map((g) => S(g))
              })
            );
            u.cells.forEach(({ row: f3, col: g }) => {
              m2[f3].cells[g].props.textAlignment = s;
            }), o.updateBlock(d, {
              type: "table",
              content: {
                ...d.content,
                type: "tableContent",
                rows: m2
              }
            }), o.setTextCursorPosition(d);
          }
      }
    },
    [o, r]
  );
  if (r === void 0)
    return null;
  const c2 = Vr[e2.textAlignment];
  return (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Button,
    {
      className: "bn-button",
      "data-test": `alignText${e2.textAlignment.slice(0, 1).toUpperCase() + e2.textAlignment.slice(1)}`,
      onClick: () => i(e2.textAlignment),
      isSelected: r.textAlignment === e2.textAlignment,
      label: n.formatting_toolbar[`align_${e2.textAlignment}`].tooltip,
      mainTooltip: n.formatting_toolbar[`align_${e2.textAlignment}`].tooltip,
      icon: (0, import_jsx_runtime10.jsx)(c2, {})
    }
  );
};
var Tr = (e2) => [
  (0, import_jsx_runtime10.jsx)(vr, { items: e2 }, "blockTypeSelect"),
  (0, import_jsx_runtime10.jsx)(Sr, {}, "tableCellMergeButton"),
  (0, import_jsx_runtime10.jsx)(mr, {}, "fileCaptionButton"),
  (0, import_jsx_runtime10.jsx)(hr, {}, "replaceFileButton"),
  (0, import_jsx_runtime10.jsx)(gr, {}, "fileRenameButton"),
  (0, import_jsx_runtime10.jsx)(fr, {}, "fileDeleteButton"),
  (0, import_jsx_runtime10.jsx)(xr, {}, "fileDownloadButton"),
  (0, import_jsx_runtime10.jsx)(yr, {}, "filePreviewButton"),
  (0, import_jsx_runtime10.jsx)(de, { basicTextStyle: "bold" }, "boldStyleButton"),
  (0, import_jsx_runtime10.jsx)(de, { basicTextStyle: "italic" }, "italicStyleButton"),
  (0, import_jsx_runtime10.jsx)(
    de,
    {
      basicTextStyle: "underline"
    },
    "underlineStyleButton"
  ),
  (0, import_jsx_runtime10.jsx)(de, { basicTextStyle: "strike" }, "strikeStyleButton"),
  (0, import_jsx_runtime10.jsx)(Le2, { textAlignment: "left" }, "textAlignLeftButton"),
  (0, import_jsx_runtime10.jsx)(Le2, { textAlignment: "center" }, "textAlignCenterButton"),
  (0, import_jsx_runtime10.jsx)(Le2, { textAlignment: "right" }, "textAlignRightButton"),
  (0, import_jsx_runtime10.jsx)(sr, {}, "colorStyleButton"),
  (0, import_jsx_runtime10.jsx)(br, {}, "nestBlockButton"),
  (0, import_jsx_runtime10.jsx)(pr, {}, "unnestBlockButton"),
  (0, import_jsx_runtime10.jsx)(ur, {}, "createLinkButton"),
  (0, import_jsx_runtime10.jsx)(kr, {}, "addCommentButton"),
  (0, import_jsx_runtime10.jsx)(Hr, {}, "addTiptapCommentButton")
];
var qt = (e2) => {
  const t = w2();
  return (0, import_jsx_runtime10.jsx)(
    t.FormattingToolbar.Root,
    {
      className: "bn-toolbar bn-formatting-toolbar",
      children: e2.children || Tr(e2.blockTypeSelectItems)
    }
  );
};
var _r = (e2) => {
  switch (e2) {
    case "left":
      return "top-start";
    case "center":
      return "top";
    case "right":
      return "top-end";
    default:
      return "top-start";
  }
};
var Br = (e2) => {
  const t = v(), n = _(Ao2, {
    editor: t
  }), o = B(Ao2, {
    editor: t
  }), r = R2({
    editor: t,
    selector: ({ editor: a2 }) => n.store.state ? {
      from: a2.prosemirrorState.selection.from,
      to: a2.prosemirrorState.selection.to
    } : void 0
  }), i = R2({
    editor: t,
    selector: ({ editor: a2 }) => {
      const d = a2.getTextCursorPosition().block;
      return To(d, a2, d.type, {
        textAlignment: m.textAlignment
      }) ? _r(d.props.textAlignment) : "top-start";
    }
  }), c2 = (0, import_react12.useMemo)(
    () => {
      var a2, d, u;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: o,
          // Needed as hooks like `useDismiss` call `onOpenChange` to change the
          // open state.
          onOpenChange: (m2, f3, g) => {
            n.store.setState(m2), g === "escape-key" && t.focus();
          },
          placement: i,
          middleware: [offset(10), shift(), flip()],
          ...(a2 = e2.floatingUIOptions) == null ? void 0 : a2.useFloatingOptions
        },
        focusManagerProps: {
          disabled: true,
          ...(d = e2.floatingUIOptions) == null ? void 0 : d.focusManagerProps
        },
        elementProps: {
          style: {
            zIndex: 40
          },
          ...(u = e2.floatingUIOptions) == null ? void 0 : u.elementProps
        }
      };
    },
    [o, i, e2.floatingUIOptions, n.store, t]
  ), s = e2.formattingToolbar || qt;
  return (0, import_jsx_runtime10.jsx)(Ge, { position: r, ...c2, children: o && (0, import_jsx_runtime10.jsx)(s, {}) });
};
var Lr = (e2) => {
  const t = w2(), n = S2(), { deleteLink: o } = _(No2);
  return (0, import_jsx_runtime10.jsx)(
    t.LinkToolbar.Button,
    {
      className: "bn-button",
      label: n.link_toolbar.delete.tooltip,
      mainTooltip: n.link_toolbar.delete.tooltip,
      isSelected: false,
      onClick: () => {
        var r;
        o(e2.range.from), (r = e2.setToolbarOpen) == null || r.call(e2, false);
      },
      icon: (0, import_jsx_runtime10.jsx)(Uo, {})
    }
  );
};
var Er = (e2) => {
  const t = w2(), n = S2();
  return (0, import_jsx_runtime10.jsxs)(
    t.Generic.Popover.Root,
    {
      onOpenChange: e2.setToolbarPositionFrozen,
      children: [
        (0, import_jsx_runtime10.jsx)(t.Generic.Popover.Trigger, { children: (0, import_jsx_runtime10.jsx)(
          t.LinkToolbar.Button,
          {
            className: "bn-button",
            mainTooltip: n.link_toolbar.edit.tooltip,
            isSelected: false,
            children: n.link_toolbar.edit.text
          }
        ) }),
        (0, import_jsx_runtime10.jsx)(
          t.Generic.Popover.Content,
          {
            className: "bn-popover-content bn-form-popover",
            variant: "form-popover",
            children: (0, import_jsx_runtime10.jsx)(
              Wt2,
              {
                url: e2.url,
                text: e2.text,
                range: e2.range,
                setToolbarOpen: e2.setToolbarOpen,
                setToolbarPositionFrozen: e2.setToolbarPositionFrozen
              }
            )
          }
        )
      ]
    }
  );
};
var Rr = (e2) => {
  const t = w2(), n = S2();
  return (0, import_jsx_runtime10.jsx)(
    t.LinkToolbar.Button,
    {
      className: "bn-button",
      mainTooltip: n.link_toolbar.open.tooltip,
      label: n.link_toolbar.open.tooltip,
      isSelected: false,
      onClick: () => {
        window.open(Ne(e2.url, window.location.href), "_blank");
      },
      icon: (0, import_jsx_runtime10.jsx)(or, {})
    }
  );
};
var Or = (e2) => {
  const t = w2();
  return (0, import_jsx_runtime10.jsx)(t.LinkToolbar.Root, { className: "bn-toolbar bn-link-toolbar", children: e2.children || (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    (0, import_jsx_runtime10.jsx)(
      Er,
      {
        url: e2.url,
        text: e2.text,
        range: e2.range,
        setToolbarOpen: e2.setToolbarOpen,
        setToolbarPositionFrozen: e2.setToolbarPositionFrozen
      }
    ),
    (0, import_jsx_runtime10.jsx)(Rr, { url: e2.url }),
    (0, import_jsx_runtime10.jsx)(
      Lr,
      {
        range: e2.range,
        setToolbarOpen: e2.setToolbarOpen
      }
    )
  ] }) });
};
var Ir = (e2) => {
  const t = v(), [n, o] = (0, import_react12.useState)(false), [r, i] = (0, import_react12.useState)(false), c2 = _(No2), [s, a2] = (0, import_react12.useState)(void 0);
  (0, import_react12.useEffect)(() => {
    const f3 = () => {
      const C = c2.getLinkAtSelection();
      if (!C) {
        a2(void 0), r || o(false);
        return;
      }
      a2({
        cursorType: "text",
        url: C.mark.attrs.href,
        text: C.text,
        range: C.range,
        element: c2.getLinkElementAtPos(C.range.from)
      }), r || o(true);
    }, g = (C) => {
      if (s !== void 0 && s.cursorType === "text" || !(C.target instanceof HTMLElement))
        return;
      const x2 = c2.getLinkAtElement(C.target);
      x2 && a2({
        cursorType: "mouse",
        url: x2.mark.attrs.href,
        text: x2.text,
        range: x2.range,
        element: c2.getLinkElementAtPos(x2.range.from)
      });
    }, h2 = t.onChange(f3), b3 = t.onSelectionChange(f3), p = t.domElement;
    return p == null || p.addEventListener("mouseover", g), () => {
      h2(), b3(), p == null || p.removeEventListener("mouseover", g);
    };
  }, [t, t.domElement, c2, s, r]);
  const d = (0, import_react12.useMemo)(
    () => {
      var f3, g, h2, b3;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: n,
          onOpenChange: (p, C, x2) => {
            r || s !== void 0 && s.cursorType === "text" && x2 === "hover" || (x2 === "escape-key" && t.focus(), o(p));
          },
          placement: "top-start",
          middleware: [offset(10), flip()],
          ...(f3 = e2.floatingUIOptions) == null ? void 0 : f3.useFloatingOptions
        },
        useHoverProps: {
          // `useHover` hook only enabled when a link is hovered with the
          // mouse.
          enabled: s !== void 0 && s.cursorType === "mouse",
          delay: {
            open: 250,
            close: 250
          },
          handleClose: safePolygon(),
          ...(g = e2.floatingUIOptions) == null ? void 0 : g.useHoverProps
        },
        focusManagerProps: {
          disabled: true,
          ...(h2 = e2.floatingUIOptions) == null ? void 0 : h2.focusManagerProps
        },
        elementProps: {
          style: {
            zIndex: 50
          },
          ...(b3 = e2.floatingUIOptions) == null ? void 0 : b3.elementProps
        }
      };
    },
    [t, s, e2.floatingUIOptions, n, r]
  ), u = (0, import_react12.useMemo)(
    () => s != null && s.element ? { element: s.element } : void 0,
    [s == null ? void 0 : s.element]
  );
  if (!t.isEditable)
    return null;
  const m2 = e2.linkToolbar || Or;
  return (0, import_jsx_runtime10.jsx)($, { reference: u, ...d, children: s && (0, import_jsx_runtime10.jsx)(
    m2,
    {
      url: s.url,
      text: s.text,
      range: s.range,
      setToolbarOpen: o,
      setToolbarPositionFrozen: i
    }
  ) });
};
function Pr(e2) {
  return k({ attr: { viewBox: "0 0 1024 1024" }, child: [{ tag: "path", attr: { d: "M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8Z" }, child: [] }, { tag: "path", attr: { d: "M192 474h672q8 0 8 8v60q0 8-8 8H160q-8 0-8-8v-60q0-8 8-8Z" }, child: [] }] })(e2);
}
var Nr = () => {
  const e2 = w2(), t = S2(), n = v(), o = _(Vn), r = B(_o, {
    editor: n,
    selector: (c2) => c2 == null ? void 0 : c2.block
  }), i = (0, import_react12.useCallback)(() => {
    if (r === void 0)
      return;
    const c2 = r.content;
    if (c2 !== void 0 && Array.isArray(c2) && c2.length === 0)
      n.setTextCursorPosition(r), o.openSuggestionMenu("/");
    else {
      const a2 = n.insertBlocks(
        [{ type: "paragraph" }],
        r,
        "after"
      )[0];
      n.setTextCursorPosition(a2), o.openSuggestionMenu("/");
    }
  }, [r, n, o]);
  return r === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    e2.SideMenu.Button,
    {
      className: "bn-button",
      label: t.side_menu.add_block_label,
      icon: (0, import_jsx_runtime10.jsx)(Pr, { size: 24, onClick: i, "data-test": "dragHandleAdd" })
    }
  );
};
function Kt(e2) {
  return k({ attr: { viewBox: "0 0 24 24" }, child: [{ tag: "path", attr: { fill: "none", d: "M0 0h24v24H0V0z" }, child: [] }, { tag: "path", attr: { d: "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" }, child: [] }] })(e2);
}
function Ar(e2) {
  return k({ attr: { viewBox: "0 0 24 24" }, child: [{ tag: "path", attr: { fill: "none", d: "M0 0h24v24H0z" }, child: [] }, { tag: "path", attr: { d: "m7 10 5 5 5-5z" }, child: [] }] })(e2);
}
var Dr = (e2) => {
  const t = w2(), n = v(), o = B(_o, {
    editor: n,
    selector: (r) => r == null ? void 0 : r.block
  });
  return o === void 0 || !To(o, n, o.type, {
    textColor: "string"
  }) && !To(o, n, o.type, {
    backgroundColor: "string"
  }) ? null : (0, import_jsx_runtime10.jsxs)(t.Generic.Menu.Root, { position: "right", sub: true, children: [
    (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Trigger, { sub: true, children: (0, import_jsx_runtime10.jsx)(
      t.Generic.Menu.Item,
      {
        className: "bn-menu-item",
        subTrigger: true,
        children: e2.children
      }
    ) }),
    (0, import_jsx_runtime10.jsx)(
      t.Generic.Menu.Dropdown,
      {
        sub: true,
        className: "bn-menu-dropdown bn-color-picker-dropdown",
        children: (0, import_jsx_runtime10.jsx)(
          xe,
          {
            iconSize: 18,
            text: To(o, n, o.type, {
              textColor: "string"
            }) && b(n, o.type, {
              textColor: "string"
            }) ? {
              color: o.props.textColor,
              setColor: (r) => n.updateBlock(o, {
                type: o.type,
                props: { textColor: r }
              })
            } : void 0,
            background: To(o, n, o.type, {
              backgroundColor: "string"
            }) && b(n, o.type, {
              backgroundColor: "string"
            }) ? {
              color: o.props.backgroundColor,
              setColor: (r) => n.updateBlock(o, {
                props: { backgroundColor: r }
              })
            } : void 0
          }
        )
      }
    )
  ] });
};
var Zr = (e2) => {
  const t = w2(), n = v(), o = B(_o, {
    editor: n,
    selector: (r) => r == null ? void 0 : r.block
  });
  return o === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Item,
    {
      className: "bn-menu-item",
      onClick: () => n.removeBlocks([o]),
      children: e2.children
    }
  );
};
var Fr = (e2) => {
  const t = w2(), n = v(), o = B(_o, {
    editor: n,
    selector: (i) => i == null ? void 0 : i.block
  });
  if (o === void 0 || o.type !== "table" || !n.settings.tables.headers)
    return null;
  const r = !!o.content.headerRows;
  return (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Item,
    {
      className: "bn-menu-item",
      checked: r,
      onClick: () => {
        n.updateBlock(o, {
          content: {
            ...o.content,
            headerRows: r ? void 0 : 1
          }
        });
      },
      children: e2.children
    }
  );
};
var Ur = (e2) => {
  const t = w2(), n = v(), o = B(_o, {
    editor: n,
    selector: (i) => i == null ? void 0 : i.block
  });
  if (o === void 0 || o.type !== "table" || !n.settings.tables.headers)
    return null;
  const r = !!o.content.headerCols;
  return (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Item,
    {
      className: "bn-menu-item",
      checked: r,
      onClick: () => {
        n.updateBlock(o, {
          content: {
            ...o.content,
            headerCols: r ? void 0 : 1
          }
        });
      },
      children: e2.children
    }
  );
};
var Gr = (e2) => {
  const t = w2(), n = S2();
  return (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Dropdown,
    {
      className: "bn-menu-dropdown bn-drag-handle-menu",
      children: e2.children || (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
        (0, import_jsx_runtime10.jsx)(Zr, { children: n.drag_handle.delete_menuitem }),
        (0, import_jsx_runtime10.jsx)(Dr, { children: n.drag_handle.colors_menuitem }),
        (0, import_jsx_runtime10.jsx)(Fr, { children: n.drag_handle.header_row_menuitem }),
        (0, import_jsx_runtime10.jsx)(Ur, { children: n.drag_handle.header_column_menuitem })
      ] })
    }
  );
};
var zr = (e2) => {
  const t = w2(), n = S2(), o = _(_o), r = B(_o, {
    selector: (c2) => c2 == null ? void 0 : c2.block
  });
  if (r === void 0)
    return null;
  const i = e2.dragHandleMenu || Gr;
  return (0, import_jsx_runtime10.jsxs)(
    t.Generic.Menu.Root,
    {
      onOpenChange: (c2) => {
        c2 ? o.freezeMenu() : o.unfreezeMenu();
      },
      position: "left",
      children: [
        (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Trigger, { children: (0, import_jsx_runtime10.jsx)(
          t.SideMenu.Button,
          {
            label: n.side_menu.drag_handle_label,
            draggable: true,
            onDragStart: (c2) => o.blockDragStart(c2, r),
            onDragEnd: o.blockDragEnd,
            className: "bn-button",
            icon: (0, import_jsx_runtime10.jsx)(Kt, { size: 24, "data-test": "dragHandle" })
          }
        ) }),
        (0, import_jsx_runtime10.jsx)(i, { children: e2.children })
      ]
    }
  );
};
var jr = (e2) => {
  const t = w2(), n = v(), o = B(_o, {
    editor: n,
    selector: (i) => i == null ? void 0 : i.block
  }), r = (0, import_react12.useMemo)(() => {
    var c2;
    if (o === void 0)
      return {};
    const i = {
      "data-block-type": o.type
    };
    return o.type === "heading" && (i["data-level"] = o.props.level.toString()), (c2 = n.schema.blockSpecs[o.type].implementation.meta) != null && c2.fileBlockAccept && (o.props.url ? i["data-url"] = "true" : i["data-url"] = "false"), i;
  }, [o, n.schema.blockSpecs]);
  return (0, import_jsx_runtime10.jsx)(t.SideMenu.Root, { className: "bn-side-menu", ...r, children: e2.children || (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    (0, import_jsx_runtime10.jsx)(Nr, {}),
    (0, import_jsx_runtime10.jsx)(zr, { dragHandleMenu: e2.dragHandleMenu })
  ] }) });
};
var $r = (e2) => {
  const t = B(_o, {
    selector: (c2) => c2 !== void 0 ? {
      show: c2.show,
      block: c2.block
    } : void 0
  }), { show: n, block: o } = t || {}, r = (0, import_react12.useMemo)(
    () => {
      var c2, s, a2, d;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: n,
          placement: "left-start",
          ...(c2 = e2.floatingUIOptions) == null ? void 0 : c2.useFloatingOptions
        },
        useDismissProps: {
          enabled: false,
          ...(s = e2.floatingUIOptions) == null ? void 0 : s.useDismissProps
        },
        focusManagerProps: {
          disabled: true,
          ...(a2 = e2.floatingUIOptions) == null ? void 0 : a2.focusManagerProps
        },
        elementProps: {
          style: {
            zIndex: 20
          },
          ...(d = e2.floatingUIOptions) == null ? void 0 : d.elementProps
        }
      };
    },
    [e2.floatingUIOptions, n]
  ), i = e2.sideMenu || jr;
  return (0, import_jsx_runtime10.jsx)(Bt2, { blockId: n ? o == null ? void 0 : o.id : void 0, ...r, children: (o == null ? void 0 : o.id) && (0, import_jsx_runtime10.jsx)(i, {}) });
};
async function Wr(e2, t) {
  return (await zo(e2, t)).map(
    ({ id: n, onItemClick: o }) => ({
      id: n,
      onItemClick: o,
      icon: n
    })
  );
}
function qr(e2) {
  const t = w2(), n = S2(), { items: o, loadingState: r, selectedIndex: i, onItemClick: c2, columns: s } = e2, a2 = r === "loading-initial" || r === "loading" ? (0, import_jsx_runtime10.jsx)(
    t.GridSuggestionMenu.Loader,
    {
      className: "bn-grid-suggestion-menu-loader",
      columns: s
    }
  ) : null, d = (0, import_react12.useMemo)(() => {
    const u = [];
    for (let m2 = 0; m2 < o.length; m2++) {
      const f3 = o[m2];
      u.push(
        (0, import_jsx_runtime10.jsx)(
          t.GridSuggestionMenu.Item,
          {
            className: "bn-grid-suggestion-menu-item",
            item: f3,
            id: `bn-grid-suggestion-menu-item-${m2}`,
            isSelected: m2 === i,
            onClick: () => c2 == null ? void 0 : c2(f3)
          },
          f3.id
        )
      );
    }
    return u;
  }, [t, o, c2, i]);
  return (0, import_jsx_runtime10.jsxs)(
    t.GridSuggestionMenu.Root,
    {
      id: "bn-grid-suggestion-menu",
      columns: s,
      className: "bn-grid-suggestion-menu",
      children: [
        a2,
        d,
        d.length === 0 && e2.loadingState === "loaded" && (0, import_jsx_runtime10.jsx)(
          t.GridSuggestionMenu.EmptyItem,
          {
            className: "bn-grid-suggestion-menu-empty-item",
            columns: s,
            children: n.suggestion_menu.no_items_title
          }
        )
      ]
    }
  );
}
function Xt3(e2, t, n, o = 3) {
  const r = (0, import_react12.useRef)(0);
  (0, import_react12.useEffect)(() => {
    t !== void 0 && (e2.length > 0 ? r.current = t.length : t.length - r.current > o && n());
  }, [n, o, e2.length, t]);
}
function Yt(e2, t) {
  const [n, o] = (0, import_react12.useState)([]), [r, i] = (0, import_react12.useState)(false), c2 = (0, import_react12.useRef)(void 0), s = (0, import_react12.useRef)(void 0);
  return (0, import_react12.useEffect)(() => {
    const a2 = e2;
    c2.current = e2, i(true), t(e2).then((d) => {
      c2.current === a2 && (o(d), i(false), s.current = a2);
    });
  }, [e2, t]), {
    items: n || [],
    // The query that was used to retrieve the last set of items may not be the
    // same as the current query as the items from the current query may not
    // have been retrieved yet. This is useful when using the returns of this
    // hook in other hooks.
    usedQuery: s.current,
    loadingState: s.current === void 0 ? "loading-initial" : r ? "loading" : "loaded"
  };
}
function Kr(e2, t, n, o, r) {
  const [i, c2] = (0, import_react12.useState)(0), s = o !== void 0 && o > 1;
  return (0, import_react12.useEffect)(() => {
    const a2 = (u) => (u.key === "ArrowLeft" && (u.preventDefault(), n.length && c2((i - 1 + n.length) % n.length)), u.key === "ArrowRight" && (u.preventDefault(), n.length && c2((i + 1 + n.length) % n.length)), u.key === "ArrowUp" ? (u.preventDefault(), n.length && c2(
      (i - o + n.length) % n.length
    ), true) : u.key === "ArrowDown" ? (u.preventDefault(), n.length && c2((i + o) % n.length), true) : u.key === "Enter" && !u.isComposing ? (u.stopPropagation(), u.preventDefault(), n.length && (r == null || r(n[i])), true) : false), d = e2.domElement;
    return d == null || d.addEventListener("keydown", a2, true), () => {
      d == null || d.removeEventListener(
        "keydown",
        a2,
        true
      );
    };
  }, [e2.domElement, n, i, r, o, s]), (0, import_react12.useEffect)(() => {
    c2(0);
  }, [t]), {
    selectedIndex: n.length === 0 ? void 0 : i
  };
}
function Xr(e2) {
  const n = q().setContentEditableProps, o = v(), {
    getItems: r,
    gridSuggestionMenuComponent: i,
    query: c2,
    clearQuery: s,
    closeMenu: a2,
    onItemClick: d,
    columns: u
  } = e2, m2 = (0, import_react12.useCallback)(
    (C) => {
      a2(), s(), d == null || d(C);
    },
    [d, a2, s]
  ), { items: f3, usedQuery: g, loadingState: h2 } = Yt(
    c2,
    r
  );
  Xt3(f3, g, a2);
  const { selectedIndex: b3 } = Kr(
    o,
    c2,
    f3,
    u,
    m2
  );
  return (0, import_react12.useEffect)(() => (n((C) => ({
    ...C,
    "aria-expanded": true,
    "aria-controls": "bn-suggestion-menu"
  })), () => {
    n((C) => ({
      ...C,
      "aria-expanded": false,
      "aria-controls": void 0
    }));
  }), [n]), (0, import_react12.useEffect)(() => (n((C) => ({
    ...C,
    "aria-activedescendant": b3 ? "bn-suggestion-menu-item-" + b3 : void 0
  })), () => {
    n((C) => ({
      ...C,
      "aria-activedescendant": void 0
    }));
  }), [n, b3]), (0, import_jsx_runtime10.jsx)(
    i,
    {
      items: f3,
      onItemClick: m2,
      loadingState: h2,
      selectedIndex: b3,
      columns: u
    }
  );
}
function Yr(e2) {
  const t = v(), {
    triggerCharacter: n,
    gridSuggestionMenuComponent: o,
    columns: r,
    shouldOpen: i,
    minQueryLength: c2,
    onItemClick: s,
    getItems: a2
  } = e2, d = (0, import_react12.useMemo)(() => s || ((b3) => {
    b3.onItemClick(t);
  }), [t, s]), u = (0, import_react12.useMemo)(() => a2 || (async (b3) => await Wr(
    t,
    b3
  )), [t, a2]), m2 = _(Vn);
  (0, import_react12.useEffect)(() => {
    m2.addSuggestionMenu({ triggerCharacter: n, shouldOpen: i });
  }, [m2, n, i]);
  const f3 = B(Vn), g = B(Vn, {
    selector: (b3) => {
      var p;
      return {
        // Use first child as the editor DOM element may itself be scrollable.
        // For FloatingUI to auto-update the position during scrolling, the
        // `contextElement` must be a descendant of the scroll container.
        element: ((p = t.domElement) == null ? void 0 : p.firstChild) || void 0,
        getBoundingClientRect: () => (b3 == null ? void 0 : b3.referencePos) || new DOMRect()
      };
    }
  }), h2 = (0, import_react12.useMemo)(
    () => {
      var b3, p, C;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: (f3 == null ? void 0 : f3.show) && (f3 == null ? void 0 : f3.triggerCharacter) === n,
          onOpenChange: (x2) => {
            x2 || m2.closeMenu();
          },
          placement: "bottom-start",
          middleware: [
            offset(10),
            // Flips the menu placement to maximize the space available, and prevents
            // the menu from being cut off by the confines of the screen.
            autoPlacement({
              allowedPlacements: ["bottom-start", "top-start"],
              padding: 10
            }),
            shift(),
            size({
              apply({ elements: x2, availableHeight: O2 }) {
                x2.floating.style.maxHeight = `${Math.max(0, O2)}px`;
              },
              padding: 10
            })
          ],
          ...(b3 = e2.floatingUIOptions) == null ? void 0 : b3.useFloatingOptions
        },
        focusManagerProps: {
          disabled: true,
          ...(p = e2.floatingUIOptions) == null ? void 0 : p.focusManagerProps
        },
        elementProps: {
          // Prevents editor blurring when clicking the scroll bar.
          onMouseDownCapture: (x2) => x2.preventDefault(),
          style: {
            zIndex: 70
          },
          ...(C = e2.floatingUIOptions) == null ? void 0 : C.elementProps
        }
      };
    },
    [
      e2.floatingUIOptions,
      f3 == null ? void 0 : f3.show,
      f3 == null ? void 0 : f3.triggerCharacter,
      m2,
      n
    ]
  );
  return !f3 || !f3.ignoreQueryLength && c2 && (f3.query.startsWith(" ") || f3.query.length < c2) ? null : (0, import_jsx_runtime10.jsx)($, { reference: g, ...h2, children: n && (0, import_jsx_runtime10.jsx)(
    Xr,
    {
      query: f3.query,
      closeMenu: m2.closeMenu,
      clearQuery: m2.clearQuery,
      getItems: u,
      columns: r,
      gridSuggestionMenuComponent: o || qr,
      onItemClick: d
    }
  ) });
}
function Jr(e2) {
  const t = w2(), n = S2(), { items: o, loadingState: r, selectedIndex: i, onItemClick: c2 } = e2, s = r === "loading-initial" || r === "loading" ? (0, import_jsx_runtime10.jsx)(
    t.SuggestionMenu.Loader,
    {
      className: "bn-suggestion-menu-loader"
    }
  ) : null, a2 = (0, import_react12.useMemo)(() => {
    let d;
    const u = [];
    for (let m2 = 0; m2 < o.length; m2++) {
      const f3 = o[m2];
      f3.group !== d && (d = f3.group, u.push(
        (0, import_jsx_runtime10.jsx)(
          t.SuggestionMenu.Label,
          {
            className: "bn-suggestion-menu-label",
            children: d
          },
          d
        )
      )), u.push(
        (0, import_jsx_runtime10.jsx)(
          t.SuggestionMenu.Item,
          {
            className: D2(
              "bn-suggestion-menu-item",
              f3.size === "small" ? "bn-suggestion-menu-item-small" : ""
            ),
            item: f3,
            id: `bn-suggestion-menu-item-${m2}`,
            isSelected: m2 === i,
            onClick: () => c2 == null ? void 0 : c2(f3)
          },
          f3.title
        )
      );
    }
    return u;
  }, [t, o, c2, i]);
  return (0, import_jsx_runtime10.jsxs)(
    t.SuggestionMenu.Root,
    {
      id: "bn-suggestion-menu",
      className: "bn-suggestion-menu",
      children: [
        a2,
        a2.length === 0 && (e2.loadingState === "loading" || e2.loadingState === "loaded") && (0, import_jsx_runtime10.jsx)(
          t.SuggestionMenu.EmptyItem,
          {
            className: "bn-suggestion-menu-item",
            children: n.suggestion_menu.no_items_title
          }
        ),
        s
      ]
    }
  );
}
function Qr(e2, t) {
  const [n, o] = (0, import_react12.useState)(0);
  return {
    selectedIndex: n,
    setSelectedIndex: o,
    handler: (r) => {
      if (r.key === "ArrowUp")
        return r.preventDefault(), e2.length && o((n - 1 + e2.length) % e2.length), true;
      if (r.key === "ArrowDown")
        return r.preventDefault(), e2.length && o((n + 1) % e2.length), true;
      if (r.key === "PageUp")
        return r.preventDefault(), e2.length && o(0), true;
      if (r.key === "PageDown")
        return r.preventDefault(), e2.length && o(e2.length - 1), true;
      const i = ei(r) ? r.nativeEvent.isComposing : r.isComposing;
      return r.key === "Enter" && !i ? (r.preventDefault(), r.stopPropagation(), e2.length && (t == null || t(e2[n])), true) : false;
    }
  };
}
function ei(e2) {
  return e2.nativeEvent !== void 0;
}
function ti(e2, t, n, o, r) {
  const { selectedIndex: i, setSelectedIndex: c2, handler: s } = Qr(n, o);
  return (0, import_react12.useEffect)(() => {
    const a2 = r || e2.domElement;
    return a2 == null || a2.addEventListener("keydown", s, true), () => {
      a2 == null || a2.removeEventListener("keydown", s, true);
    };
  }, [e2.domElement, n, i, o, r, s]), (0, import_react12.useEffect)(() => {
    c2(0);
  }, [t, c2]), {
    selectedIndex: n.length === 0 ? void 0 : i
  };
}
function ni(e2) {
  const n = q().setContentEditableProps, o = v(), {
    getItems: r,
    suggestionMenuComponent: i,
    query: c2,
    clearQuery: s,
    closeMenu: a2,
    onItemClick: d
  } = e2, u = (0, import_react12.useCallback)(
    (p) => {
      a2(), s(), d == null || d(p);
    },
    [d, a2, s]
  ), { items: m2, usedQuery: f3, loadingState: g } = Yt(
    c2,
    r
  );
  Xt3(m2, f3, a2);
  const { selectedIndex: h2 } = ti(
    o,
    c2,
    m2,
    u
  );
  return (0, import_react12.useEffect)(() => (n((p) => ({
    ...p,
    "aria-expanded": true,
    "aria-controls": "bn-suggestion-menu"
  })), () => {
    n((p) => ({
      ...p,
      "aria-expanded": false,
      "aria-controls": void 0
    }));
  }), [n]), (0, import_react12.useEffect)(() => (n((p) => ({
    ...p,
    "aria-activedescendant": h2 ? "bn-suggestion-menu-item-" + h2 : void 0
  })), () => {
    n((p) => ({
      ...p,
      "aria-activedescendant": void 0
    }));
  }), [n, h2]), (0, import_jsx_runtime10.jsx)(
    i,
    {
      items: m2,
      onItemClick: u,
      loadingState: g,
      selectedIndex: h2
    }
  );
}
var oi = {
  heading: pe,
  heading_2: Ce,
  heading_3: ve,
  heading_4: Pt,
  heading_5: Nt,
  heading_6: At,
  toggle_heading: pe,
  toggle_heading_2: Ce,
  toggle_heading_3: ve,
  quote: Gt,
  toggle_list: jt,
  numbered_list: Ft,
  bullet_list: Ut,
  check_list: Zt2,
  paragraph: je,
  table: $o,
  image: zt,
  video: qo,
  audio: $t,
  file: ze,
  emoji: lr,
  code_block: Ao3,
  divider: ir
};
function ri(e2) {
  return Ao(e2).map((t) => {
    const n = oi[t.key];
    return {
      ...t,
      icon: (0, import_jsx_runtime10.jsx)(n, { size: 18 })
    };
  });
}
function ii(e2) {
  const t = v(), {
    triggerCharacter: n,
    suggestionMenuComponent: o,
    shouldOpen: r,
    minQueryLength: i,
    onItemClick: c2,
    getItems: s
  } = e2, a2 = (0, import_react12.useMemo)(() => c2 || ((h2) => {
    h2.onItemClick(t);
  }), [t, c2]), d = (0, import_react12.useMemo)(() => s || (async (h2) => No(
    ri(t),
    h2
  )), [t, s]), u = _(Vn);
  (0, import_react12.useEffect)(() => {
    u.addSuggestionMenu({ triggerCharacter: n, shouldOpen: r });
  }, [u, n, r]);
  const m2 = B(Vn), f3 = B(Vn, {
    selector: (h2) => {
      var b3;
      return {
        // Use first child as the editor DOM element may itself be scrollable.
        // For FloatingUI to auto-update the position during scrolling, the
        // `contextElement` must be a descendant of the scroll container.
        element: ((b3 = t.domElement) == null ? void 0 : b3.firstChild) || void 0,
        getBoundingClientRect: () => (h2 == null ? void 0 : h2.referencePos) || new DOMRect()
      };
    }
  }), g = (0, import_react12.useMemo)(
    () => {
      var h2, b3, p;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: (m2 == null ? void 0 : m2.show) && (m2 == null ? void 0 : m2.triggerCharacter) === n,
          onOpenChange: (C) => {
            C || u.closeMenu();
          },
          placement: "bottom-start",
          middleware: [
            offset(10),
            // Flips the menu placement to maximize the space available, and prevents
            // the menu from being cut off by the confines of the screen.
            autoPlacement({
              allowedPlacements: ["bottom-start", "top-start"],
              padding: 10
            }),
            shift(),
            size({
              apply({ elements: C, availableHeight: x2 }) {
                C.floating.style.maxHeight = `${Math.max(0, x2)}px`;
              },
              padding: 10
            })
          ],
          ...(h2 = e2.floatingUIOptions) == null ? void 0 : h2.useFloatingOptions
        },
        focusManagerProps: {
          disabled: true,
          ...(b3 = e2.floatingUIOptions) == null ? void 0 : b3.focusManagerProps
        },
        elementProps: {
          // Prevents editor blurring when clicking the scroll bar.
          onMouseDownCapture: (C) => C.preventDefault(),
          style: {
            zIndex: 80
          },
          ...(p = e2.floatingUIOptions) == null ? void 0 : p.elementProps
        }
      };
    },
    [
      e2.floatingUIOptions,
      m2 == null ? void 0 : m2.show,
      m2 == null ? void 0 : m2.triggerCharacter,
      u,
      n
    ]
  );
  return !m2 || !m2.ignoreQueryLength && i && (m2.query.startsWith(" ") || m2.query.length < i) ? null : (0, import_jsx_runtime10.jsx)($, { reference: f3, ...g, children: n && (0, import_jsx_runtime10.jsx)(
    ni,
    {
      query: m2.query,
      closeMenu: u.closeMenu,
      clearQuery: u.clearQuery,
      getItems: d,
      suggestionMenuComponent: o || Jr,
      onItemClick: a2
    }
  ) });
}
var li = (e2, t = 0.3) => {
  const n = Math.floor(e2) + t, o = Math.ceil(e2) - t;
  return e2 >= n && e2 <= o ? Math.round(e2) : e2 < n ? Math.floor(e2) : Math.ceil(e2);
};
var ci = (e2) => {
  const t = w2(), n = v(), o = _(Yo), r = B(Yo, {
    selector: (u) => u == null ? void 0 : u.block
  }), i = (0, import_react12.useRef)(false), [c2, s] = (0, import_react12.useState)(), a2 = (0, import_react12.useCallback)(
    (u) => {
      o.freezeHandles(), e2.hideOtherElements(true), r && (s({
        originalContent: r.content,
        originalCroppedContent: {
          rows: o.cropEmptyRowsOrColumns(
            r,
            e2.orientation === "addOrRemoveColumns" ? "columns" : "rows"
          )
        },
        startPos: e2.orientation === "addOrRemoveColumns" ? u.clientX : u.clientY
      }), i.current = false, u.preventDefault());
    },
    [r, e2, o]
  ), d = (0, import_react12.useCallback)(() => {
    !r || i.current || n.updateBlock(r, {
      type: "table",
      content: {
        ...r.content,
        rows: e2.orientation === "addOrRemoveColumns" ? o.addRowsOrColumns(r, "columns", 1) : o.addRowsOrColumns(r, "rows", 1)
      }
    });
  }, [r, n, e2.orientation, o]);
  return (0, import_react12.useEffect)(() => {
    const u = (m2) => {
      var C, x2;
      if (!r)
        return;
      if (!c2)
        throw new Error("editingState is undefined");
      i.current = true;
      const f3 = (e2.orientation === "addOrRemoveColumns" ? m2.clientX : m2.clientY) - c2.startPos, g = e2.orientation === "addOrRemoveColumns" ? ((C = c2.originalCroppedContent.rows[0]) == null ? void 0 : C.cells.length) ?? 0 : c2.originalCroppedContent.rows.length, h2 = e2.orientation === "addOrRemoveColumns" ? ((x2 = c2.originalContent.rows[0]) == null ? void 0 : x2.cells.length) ?? 0 : c2.originalContent.rows.length, b3 = e2.orientation === "addOrRemoveColumns" ? r.content.rows[0].cells.length : r.content.rows.length, p = h2 + li(
        f3 / (e2.orientation === "addOrRemoveColumns" ? Oe : Lo),
        0.3
      );
      p >= g && p > 0 && p !== b3 && (n.updateBlock(r, {
        type: "table",
        content: {
          ...r.content,
          rows: e2.orientation === "addOrRemoveColumns" ? o.addRowsOrColumns(
            {
              type: "table",
              content: c2.originalCroppedContent
            },
            "columns",
            p - g
          ) : o.addRowsOrColumns(
            {
              type: "table",
              content: c2.originalCroppedContent
            },
            "rows",
            p - g
          )
        }
      }), r.content && n.setTextCursorPosition(r));
    };
    return c2 && window.addEventListener("mousemove", u), () => {
      window.removeEventListener("mousemove", u);
    };
  }, [r, c2, n, e2.orientation, o]), (0, import_react12.useEffect)(() => {
    const u = () => {
      e2.hideOtherElements(false), o.unfreezeHandles(), s(void 0);
    };
    return c2 && window.addEventListener("mouseup", u), () => {
      window.removeEventListener("mouseup", u);
    };
  }, [c2, e2, o]), n.isEditable ? (0, import_jsx_runtime10.jsx)(
    t.TableHandle.ExtendButton,
    {
      className: D2(
        "bn-extend-button",
        e2.orientation === "addOrRemoveColumns" ? "bn-extend-button-add-remove-columns" : "bn-extend-button-add-remove-rows",
        c2 !== null ? "bn-extend-button-editing" : ""
      ),
      onClick: d,
      onMouseDown: a2,
      children: e2.children || (0, import_jsx_runtime10.jsx)(Jo, { size: 18, "data-test": "extendButton" })
    }
  ) : null;
};
var ai = (e2) => {
  var d, u;
  const t = w2(), n = S2(), o = v(), { block: r, colIndex: i, rowIndex: c2 } = B(
    Yo,
    {
      selector: (m2) => ({
        block: m2 == null ? void 0 : m2.block,
        colIndex: m2 == null ? void 0 : m2.colIndex,
        rowIndex: m2 == null ? void 0 : m2.rowIndex
      })
    }
  ), s = (m2, f3) => {
    if (r === void 0 || i === void 0 || c2 === void 0)
      return;
    const g = r.content.rows.map((h2) => ({
      ...h2,
      cells: h2.cells.map((b3) => S(b3))
    }));
    f3 === "text" ? g[c2].cells[i].props.textColor = m2 : g[c2].cells[i].props.backgroundColor = m2, o.updateBlock(r, {
      type: "table",
      content: {
        ...r.content,
        rows: g
      }
    }), o.setTextCursorPosition(r);
  };
  if (r === void 0 || i === void 0 || c2 === void 0)
    return null;
  const a2 = (u = (d = r.content.rows[c2]) == null ? void 0 : d.cells) == null ? void 0 : u[i];
  return !a2 || o.settings.tables.cellTextColor === false && o.settings.tables.cellBackgroundColor === false ? null : (0, import_jsx_runtime10.jsxs)(t.Generic.Menu.Root, { position: "right", sub: true, children: [
    (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Trigger, { sub: true, children: (0, import_jsx_runtime10.jsx)(
      t.Generic.Menu.Item,
      {
        className: "bn-menu-item",
        subTrigger: true,
        children: e2.children || n.drag_handle.colors_menuitem
      }
    ) }),
    (0, import_jsx_runtime10.jsx)(
      t.Generic.Menu.Dropdown,
      {
        sub: true,
        className: "bn-menu-dropdown bn-color-picker-dropdown",
        children: (0, import_jsx_runtime10.jsx)(
          xe,
          {
            iconSize: 18,
            text: o.settings.tables.cellTextColor ? {
              color: R(a2) ? a2.props.textColor : "default",
              setColor: (m2) => s(m2, "text")
            } : void 0,
            background: o.settings.tables.cellBackgroundColor ? {
              color: R(a2) ? a2.props.backgroundColor : "default",
              setColor: (m2) => s(m2, "background")
            } : void 0
          }
        )
      }
    )
  ] });
};
var si = () => {
  var a2, d;
  const e2 = w2(), t = S2(), n = v(), o = _(Yo), { block: r, colIndex: i, rowIndex: c2 } = B(
    Yo,
    {
      selector: (u) => ({
        block: u == null ? void 0 : u.block,
        colIndex: u == null ? void 0 : u.colIndex,
        rowIndex: u == null ? void 0 : u.rowIndex
      })
    }
  );
  if (r === void 0 || i === void 0 || c2 === void 0)
    return null;
  const s = (d = (a2 = r.content.rows[c2]) == null ? void 0 : a2.cells) == null ? void 0 : d[i];
  return !s || !R(s) || D(s) === 1 && A(s) === 1 || !n.settings.tables.splitCells ? null : (0, import_jsx_runtime10.jsx)(
    e2.Generic.Menu.Item,
    {
      onClick: () => {
        o.splitCell({
          row: c2,
          col: i
        });
      },
      children: t.table_handle.split_cell_menuitem
    }
  );
};
var di = (e2) => {
  const t = w2();
  return (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Dropdown,
    {
      className: "bn-menu-dropdown bn-table-handle-menu",
      children: e2.children || (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
        (0, import_jsx_runtime10.jsx)(si, {}),
        (0, import_jsx_runtime10.jsx)(ai, {})
      ] })
    }
  );
};
var ui = (e2) => {
  const t = w2(), n = v(), o = _(Yo), r = e2.tableCellMenu || di;
  return !n.settings.tables.splitCells && !n.settings.tables.cellBackgroundColor && !n.settings.tables.cellTextColor ? null : (0, import_jsx_runtime10.jsxs)(
    t.Generic.Menu.Root,
    {
      onOpenChange: (i) => {
        i ? (o.freezeHandles(), e2.hideOtherElements(true)) : (o.unfreezeHandles(), e2.hideOtherElements(false), n.focus());
      },
      position: "right",
      children: [
        (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Trigger, { children: (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Button, { className: "bn-table-cell-handle", children: e2.children || (0, import_jsx_runtime10.jsx)(Ar, { size: 12, "data-test": "tableCellHandle" }) }) }),
        (0, import_jsx_runtime10.jsx)(r, {})
      ]
    }
  );
};
var ft = (e2) => {
  const t = w2(), n = S2(), o = _(Yo), r = B(Yo, {
    selector: (i) => e2.orientation === "column" ? i == null ? void 0 : i.colIndex : i == null ? void 0 : i.rowIndex
  });
  return o === void 0 || r === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Item,
    {
      onClick: () => {
        o.addRowOrColumn(
          r,
          e2.orientation === "row" ? { orientation: "row", side: e2.side } : { orientation: "column", side: e2.side }
        );
      },
      children: n.table_handle[`add_${e2.side}_menuitem`]
    }
  );
};
var mi = (e2) => {
  const t = w2(), n = S2(), o = _(Yo), r = B(Yo, {
    selector: (i) => e2.orientation === "column" ? i == null ? void 0 : i.colIndex : i == null ? void 0 : i.rowIndex
  });
  return o === void 0 || r === void 0 ? null : (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Item,
    {
      onClick: () => o.removeRowOrColumn(r, e2.orientation),
      children: e2.orientation === "row" ? n.table_handle.delete_row_menuitem : n.table_handle.delete_column_menuitem
    }
  );
};
var fi = (e2) => {
  const t = w2(), n = S2(), o = v(), r = _(Yo), { block: i, index: c2 } = B(Yo, {
    selector: (u) => ({
      block: u == null ? void 0 : u.block,
      index: e2.orientation === "column" ? u == null ? void 0 : u.colIndex : u == null ? void 0 : u.rowIndex
    })
  }), s = (0, import_react12.useMemo)(() => r === void 0 || i === void 0 || c2 === void 0 ? [] : e2.orientation === "row" ? r.getCellsAtRowHandle(i, c2) : r.getCellsAtColumnHandle(i, c2), [i, c2, e2.orientation, r]), a2 = (u, m2) => {
    if (i === void 0)
      return;
    const f3 = i.content.rows.map((g) => ({
      ...g,
      cells: g.cells.map((h2) => S(h2))
    }));
    s.forEach(({ row: g, col: h2 }) => {
      m2 === "text" ? f3[g].cells[h2].props.textColor = u : f3[g].cells[h2].props.backgroundColor = u;
    }), o.updateBlock(i, {
      type: "table",
      content: {
        ...i.content,
        rows: f3
      }
    }), o.setTextCursorPosition(i);
  };
  if (!s || !s[0] || !r || o.settings.tables.cellTextColor === false && o.settings.tables.cellBackgroundColor === false)
    return null;
  const d = S(s[0].cell);
  return (0, import_jsx_runtime10.jsxs)(t.Generic.Menu.Root, { position: "right", sub: true, children: [
    (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Trigger, { sub: true, children: (0, import_jsx_runtime10.jsx)(
      t.Generic.Menu.Item,
      {
        className: "bn-menu-item",
        subTrigger: true,
        children: e2.children || n.drag_handle.colors_menuitem
      }
    ) }),
    (0, import_jsx_runtime10.jsx)(
      t.Generic.Menu.Dropdown,
      {
        sub: true,
        className: "bn-menu-dropdown bn-color-picker-dropdown",
        children: (0, import_jsx_runtime10.jsx)(
          xe,
          {
            iconSize: 18,
            text: o.settings.tables.cellTextColor ? {
              // All cells have the same text color
              color: s.every(
                ({ cell: u }) => R(u) && u.props.textColor === d.props.textColor
              ) ? d.props.textColor : "default",
              setColor: (u) => {
                a2(u, "text");
              }
            } : void 0,
            background: o.settings.tables.cellBackgroundColor ? {
              color: s.every(
                ({ cell: u }) => R(u) && u.props.backgroundColor === d.props.backgroundColor
              ) ? d.props.backgroundColor : "default",
              setColor: (u) => a2(u, "background")
            } : void 0
          }
        )
      }
    )
  ] });
};
var gi = (e2) => {
  const t = w2(), n = S2(), o = v(), r = _(Yo), { block: i, index: c2 } = B(Yo, {
    selector: (a2) => ({
      block: a2 == null ? void 0 : a2.block,
      index: e2.orientation === "column" ? a2 == null ? void 0 : a2.colIndex : a2 == null ? void 0 : a2.rowIndex
    })
  });
  if (r === void 0 || i === void 0 || c2 !== 0 || e2.orientation !== "row" || !o.settings.tables.headers)
    return null;
  const s = !!i.content.headerRows;
  return (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Item,
    {
      className: "bn-menu-item",
      checked: s,
      onClick: () => {
        o.updateBlock(i, {
          ...i,
          content: {
            ...i.content,
            headerRows: s ? void 0 : 1
          }
        });
      },
      children: n.drag_handle.header_row_menuitem
    }
  );
};
var hi = (e2) => {
  const t = w2(), n = S2(), o = v(), r = _(Yo), i = B(Yo, {
    selector: (a2) => a2 == null ? void 0 : a2.block
  }), c2 = B(Yo, {
    selector: (a2) => e2.orientation === "column" ? a2 == null ? void 0 : a2.colIndex : a2 == null ? void 0 : a2.rowIndex
  });
  if (!r || c2 !== 0 || !i || e2.orientation !== "column" || !o.settings.tables.headers)
    return null;
  const s = !!i.content.headerCols;
  return (0, import_jsx_runtime10.jsx)(
    t.Generic.Menu.Item,
    {
      className: "bn-menu-item",
      checked: s,
      onClick: () => {
        o.updateBlock(i, {
          ...i,
          content: {
            ...i.content,
            headerCols: s ? void 0 : 1
          }
        });
      },
      children: n.drag_handle.header_column_menuitem
    }
  );
};
var bi = (e2) => {
  const t = w2();
  return (0, import_jsx_runtime10.jsx)(t.Generic.Menu.Dropdown, { className: "bn-table-handle-menu", children: e2.children || (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    (0, import_jsx_runtime10.jsx)(mi, { orientation: e2.orientation }),
    (0, import_jsx_runtime10.jsx)(
      ft,
      {
        orientation: e2.orientation,
        side: e2.orientation === "row" ? "above" : "left"
      }
    ),
    (0, import_jsx_runtime10.jsx)(
      ft,
      {
        orientation: e2.orientation,
        side: e2.orientation === "row" ? "below" : "right"
      }
    ),
    (0, import_jsx_runtime10.jsx)(gi, { orientation: e2.orientation }),
    (0, import_jsx_runtime10.jsx)(hi, { orientation: e2.orientation }),
    (0, import_jsx_runtime10.jsx)(fi, { orientation: e2.orientation })
  ] }) });
};
var pi = (e2) => {
  const t = v(), n = w2(), [o, r] = (0, import_react12.useState)(false), i = e2.tableHandleMenu || bi, c2 = _(Yo), s = B(Yo), a2 = (0, import_react12.useMemo)(() => !c2 || !s || !s.block || s.block.type !== "table" ? false : e2.orientation === "column" ? c2.getCellsAtColumnHandle(s.block, s.colIndex).every(({ cell: d }) => A(d) === 1) : c2.getCellsAtRowHandle(s.block, s.rowIndex).every(({ cell: d }) => D(d) === 1), [e2.orientation, s, c2]);
  return s ? (0, import_jsx_runtime10.jsxs)(
    n.Generic.Menu.Root,
    {
      onOpenChange: (d) => {
        d ? (c2.freezeHandles(), e2.hideOtherElements(true)) : (c2.unfreezeHandles(), e2.hideOtherElements(false), t.focus());
      },
      position: "right",
      children: [
        (0, import_jsx_runtime10.jsx)(n.Generic.Menu.Trigger, { children: (0, import_jsx_runtime10.jsx)(
          n.TableHandle.Root,
          {
            className: D2(
              "bn-table-handle",
              o ? "bn-table-handle-dragging" : "",
              a2 ? "" : "bn-table-handle-not-draggable"
            ),
            draggable: a2,
            onDragStart: (d) => {
              r(true), e2.hideOtherElements(true), e2.orientation === "column" ? c2.colDragStart(d) : c2.rowDragStart(d);
            },
            onDragEnd: () => {
              c2.dragEnd(), e2.hideOtherElements(false), r(false);
            },
            style: e2.orientation === "column" ? { transform: "rotate(0.25turn)" } : void 0,
            children: e2.children || (0, import_jsx_runtime10.jsx)(Kt, { size: 24, "data-test": "tableHandle" })
          }
        ) }),
        (0, import_jsx_runtime10.jsx)(i, { orientation: e2.orientation })
      ]
    }
  ) : null;
};
var Ci = (e2) => {
  const t = v(), [n, o] = (0, import_react12.useState)(), r = B(Yo), i = (0, import_react12.useMemo)(() => {
    const u = {};
    if (r === void 0)
      return {};
    const m2 = Bt(
      r.block.id,
      t.prosemirrorState.doc
    );
    if (!m2)
      return {};
    const f3 = m2.posBeforeNode + 1, g = t.prosemirrorView.domAtPos(
      f3 + 1
    ).node;
    if (!(g instanceof Element))
      return {};
    if (u.tableReference = { element: g }, r.rowIndex === void 0 || r.colIndex === void 0)
      return u;
    const h2 = t.prosemirrorState.doc.resolve(f3 + 1).posAtIndex(r.rowIndex), b3 = t.prosemirrorState.doc.resolve(h2 + 1).posAtIndex(r.colIndex), p = t.prosemirrorView.domAtPos(b3 + 1).node;
    return p instanceof Element ? (u.cellReference = { element: p }, u.rowReference = {
      element: g,
      getBoundingClientRect: () => {
        const C = g.getBoundingClientRect(), x2 = p.getBoundingClientRect();
        return new DOMRect(
          C.x,
          r.draggingState && r.draggingState.draggedCellOrientation === "row" ? r.draggingState.mousePos - x2.height / 2 : x2.y,
          C.width,
          x2.height
        );
      }
    }, u.columnReference = {
      element: g,
      getBoundingClientRect: () => {
        const C = g.getBoundingClientRect(), x2 = p.getBoundingClientRect();
        return new DOMRect(
          r.draggingState && r.draggingState.draggedCellOrientation === "col" ? r.draggingState.mousePos - x2.width / 2 : x2.x,
          C.y,
          x2.width,
          C.height
        );
      }
    }, u) : {};
  }, [t, r]), c2 = (0, import_react12.useMemo)(
    () => r !== void 0 ? {
      rowTableHandle: {
        useFloatingOptions: {
          open: r.show && r.rowIndex !== void 0 && (!n || n === "rowTableHandle"),
          placement: "left",
          middleware: [offset(-10)]
        },
        focusManagerProps: {
          disabled: true
        },
        elementProps: {
          style: {
            zIndex: 10
          }
        }
      },
      columnTableHandle: {
        useFloatingOptions: {
          open: r.show && r.colIndex !== void 0 && (!n || n === "columnTableHandle"),
          placement: "top",
          middleware: [offset(-12)]
        },
        focusManagerProps: {
          disabled: true
        },
        elementProps: {
          style: {
            zIndex: 10
          }
        }
      },
      tableCellHandle: {
        useFloatingOptions: {
          open: r.show && r.rowIndex !== void 0 && r.colIndex !== void 0 && (!n || n === "tableCellHandle"),
          placement: "top-end",
          middleware: [offset({ mainAxis: -15, crossAxis: -1 })]
        },
        focusManagerProps: {
          disabled: true
        },
        elementProps: {
          style: {
            zIndex: 10
          }
        }
      },
      extendRowsButton: {
        useFloatingOptions: {
          open: r.show && r.showAddOrRemoveRowsButton && (!n || n === "extendRowsButton"),
          placement: "bottom",
          middleware: [
            size({
              apply({ rects: u, elements: m2 }) {
                Object.assign(m2.floating.style, {
                  width: `${u.reference.width}px`
                });
              }
            })
          ]
        },
        focusManagerProps: {
          disabled: true
        },
        elementProps: {
          style: {
            zIndex: 10
          }
        }
      },
      extendColumnsButton: {
        useFloatingOptions: {
          open: r.show && r.showAddOrRemoveColumnsButton && (!n || n === "extendColumnsButton"),
          placement: "right",
          middleware: [
            size({
              apply({ rects: u, elements: m2 }) {
                Object.assign(m2.floating.style, {
                  height: `${u.reference.height}px`
                });
              }
            })
          ]
        },
        focusManagerProps: {
          disabled: true
        },
        elementProps: {
          style: {
            zIndex: 10
          }
        }
      }
    } : void 0,
    [n, r]
  );
  if (!r)
    return null;
  const s = e2.tableHandle || pi, a2 = e2.extendButton || ci, d = e2.tableCellHandle || ui;
  return (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    (0, import_jsx_runtime10.jsx)(
      $,
      {
        reference: i == null ? void 0 : i.rowReference,
        ...c2 == null ? void 0 : c2.rowTableHandle,
        children: r.show && r.rowIndex !== void 0 && (!n || n === "rowTableHandle") && (0, import_jsx_runtime10.jsx)(
          s,
          {
            orientation: "row",
            hideOtherElements: (u) => o(u ? "rowTableHandle" : void 0)
          }
        )
      }
    ),
    (0, import_jsx_runtime10.jsx)(
      $,
      {
        reference: i == null ? void 0 : i.columnReference,
        ...c2 == null ? void 0 : c2.columnTableHandle,
        children: r.show && r.colIndex !== void 0 && (!n || n === "columnTableHandle") && (0, import_jsx_runtime10.jsx)(
          s,
          {
            orientation: "column",
            hideOtherElements: (u) => o(u ? "columnTableHandle" : void 0)
          }
        )
      }
    ),
    (0, import_jsx_runtime10.jsx)(
      $,
      {
        reference: i == null ? void 0 : i.cellReference,
        ...c2 == null ? void 0 : c2.tableCellHandle,
        children: r.show && r.rowIndex !== void 0 && r.colIndex !== void 0 && (!n || n === "tableCellHandle") && (0, import_jsx_runtime10.jsx)(
          d,
          {
            hideOtherElements: (u) => o(u ? "tableCellHandle" : void 0)
          }
        )
      }
    ),
    (0, import_jsx_runtime10.jsx)(
      $,
      {
        reference: i == null ? void 0 : i.tableReference,
        ...c2 == null ? void 0 : c2.extendRowsButton,
        children: r.show && r.showAddOrRemoveRowsButton && (!n || n === "extendRowsButton") && (0, import_jsx_runtime10.jsx)(
          a2,
          {
            orientation: "addOrRemoveRows",
            hideOtherElements: (u) => o(u ? "extendRowsButton" : void 0)
          }
        )
      }
    ),
    (0, import_jsx_runtime10.jsx)(
      $,
      {
        reference: i == null ? void 0 : i.tableReference,
        ...c2 == null ? void 0 : c2.extendColumnsButton,
        children: r.show && r.showAddOrRemoveColumnsButton && (!n || n === "extendColumnsButton") && (0, import_jsx_runtime10.jsx)(
          a2,
          {
            orientation: "addOrRemoveColumns",
            hideOtherElements: (u) => o(u ? "extendColumnsButton" : void 0)
          }
        )
      }
    )
  ] });
};
var vi = (0, import_react12.lazy)(
  () => Promise.resolve().then(() => cl)
);
var wi = (0, import_react12.lazy)(
  () => Promise.resolve().then(() => sl)
);
function ki(e2) {
  const t = v();
  if (!t)
    throw new Error(
      "BlockNoteDefaultUI must be used within a BlockNoteContext.Provider"
    );
  return (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    t.getExtension(Ao2) && e2.formattingToolbar !== false && (0, import_jsx_runtime10.jsx)(Br, {}),
    t.getExtension(No2) && e2.linkToolbar !== false && (0, import_jsx_runtime10.jsx)(Ir, {}),
    t.getExtension(Vn) && e2.slashMenu !== false && (0, import_jsx_runtime10.jsx)(
      ii,
      {
        triggerCharacter: "/",
        shouldOpen: (n) => !n.selection.$from.parent.type.isInGroup("tableContent")
      }
    ),
    t.getExtension(Vn) && e2.emojiPicker !== false && (0, import_jsx_runtime10.jsx)(
      Yr,
      {
        triggerCharacter: ":",
        columns: 10,
        minQueryLength: 2
      }
    ),
    t.getExtension(_o) && e2.sideMenu !== false && (0, import_jsx_runtime10.jsx)($r, {}),
    t.getExtension(H) && e2.filePanel !== false && (0, import_jsx_runtime10.jsx)(mo, {}),
    t.getExtension(Yo) && e2.tableHandles !== false && (0, import_jsx_runtime10.jsx)(Ci, {}),
    t.getExtension(ne) && e2.comments !== false && (0, import_jsx_runtime10.jsxs)(import_react12.Suspense, { children: [
      (0, import_jsx_runtime10.jsx)(vi, {}),
      (0, import_jsx_runtime10.jsx)(wi, {})
    ] })
  ] });
}
function Hi(e2, t) {
  const n = q();
  t || (t = n == null ? void 0 : n.editor), (0, import_react12.useEffect)(() => {
    if (!t)
      throw new Error(
        "'editor' is required, either from BlockNoteContext or as a function argument"
      );
    return t.onChange(e2);
  }, [e2, t]);
}
function xi(e2, t, n) {
  const o = q();
  t || (t = o == null ? void 0 : o.editor), (0, import_react12.useEffect)(() => {
    if (!t)
      throw new Error(
        "'editor' is required, either from BlockNoteContext or as a function argument"
      );
    return t.onSelectionChange(e2, n);
  }, [e2, t, n]);
}
var yi = () => {
  const e2 = (0, import_react12.useMemo)(
    () => {
      var c2;
      return (c2 = window.matchMedia) == null ? void 0 : c2.call(window, "(prefers-color-scheme: dark)");
    },
    []
  ), t = (0, import_react12.useMemo)(
    () => {
      var c2;
      return (c2 = window.matchMedia) == null ? void 0 : c2.call(window, "(prefers-color-scheme: light)");
    },
    []
  ), n = e2 == null ? void 0 : e2.matches, o = t == null ? void 0 : t.matches, [r, i] = (0, import_react12.useState)(n ? "dark" : o ? "light" : "no-preference");
  return (0, import_react12.useEffect)(() => {
    i(n ? "dark" : o ? "light" : "no-preference");
  }, [n, o]), (0, import_react12.useEffect)(() => {
    if (typeof (e2 == null ? void 0 : e2.addEventListener) == "function") {
      const c2 = ({ matches: a2 }) => a2 && i("dark"), s = ({ matches: a2 }) => a2 && i("light");
      return e2 == null || e2.addEventListener("change", c2), t == null || t.addEventListener("change", s), () => {
        e2 == null || e2.removeEventListener("change", c2), t == null || t.removeEventListener("change", s);
      };
    } else {
      const c2 = () => i(
        e2.matches ? "dark" : t.matches ? "light" : "no-preference"
      );
      return e2 == null || e2.addEventListener("change", c2), t == null || t.addEventListener("change", c2), () => {
        e2 == null || e2.removeEventListener("change", c2), t == null || t.removeEventListener("change", c2);
      };
    }
  }, [e2, t]), typeof window.matchMedia != "function", r;
};
var Jt = (0, import_react12.createContext)(void 0);
function Mi() {
  return (0, import_react12.useContext)(Jt);
}
function Si() {
  const e2 = /* @__PURE__ */ new Set();
  let t = {};
  return {
    /**
     * Subscribe to the editor instance's changes.
     */
    subscribe(n) {
      return e2.add(n), () => {
        e2.delete(n);
      };
    },
    getSnapshot() {
      return t;
    },
    getServerSnapshot() {
      return t;
    },
    /**
     * Adds a new NodeView Renderer to the editor.
     */
    setRenderer(n, o) {
      t = {
        ...t,
        [n]: (0, import_react_dom5.createPortal)(o.reactElement, o.element, n)
      }, e2.forEach((r) => r());
    },
    /**
     * Removes a NodeView Renderer from the editor.
     */
    removeRenderer(n) {
      const o = { ...t };
      delete o[n], t = o, e2.forEach((r) => r());
    }
  };
}
var Vi = ({
  contentComponent: e2
}) => {
  const t = (0, import_react12.useSyncExternalStore)(
    e2.subscribe,
    e2.getSnapshot,
    e2.getServerSnapshot
  );
  return (0, import_jsx_runtime10.jsx)(import_jsx_runtime10.Fragment, { children: Object.values(t) });
};
var Ti = (0, import_react12.forwardRef)((e2, t) => {
  const [n, o] = (0, import_react12.useState)();
  return (0, import_react12.useImperativeHandle)(t, () => (r, i) => {
    (0, import_react_dom5.flushSync)(() => {
      o({ node: r, container: i });
    }), o(void 0);
  }, []), (0, import_jsx_runtime10.jsx)(import_jsx_runtime10.Fragment, { children: n && (0, import_react_dom5.createPortal)(n.node, n.container) });
});
var gt = () => {
};
function _i(e2, t) {
  const {
    editor: n,
    className: o,
    theme: r,
    children: i,
    editable: c2,
    onSelectionChange: s,
    onChange: a2,
    formattingToolbar: d,
    linkToolbar: u,
    slashMenu: m2,
    emojiPicker: f3,
    sideMenu: g,
    filePanel: h2,
    tableHandles: b3,
    comments: p,
    autoFocus: C,
    renderEditor: x2 = true,
    ...O2
  } = e2, [I, j] = (0, import_react12.useState)(), L2 = q(), P = yi(), K2 = (L2 == null ? void 0 : L2.colorSchemePreference) || P, ne2 = r || (K2 === "dark" ? "dark" : "light");
  Hi(a2 || gt, n), xi(s || gt, n);
  const G = (0, import_react12.useCallback)(
    (rn) => {
      n.elementRenderer = rn;
    },
    [n]
  ), Q = (0, import_react12.useMemo)(() => ({
    ...L2,
    editor: n,
    setContentEditableProps: j,
    colorSchemePreference: ne2
  }), [L2, n, ne2]), on2 = (0, import_react12.useMemo)(() => ({
    editorProps: {
      autoFocus: C,
      contentEditableProps: I,
      editable: c2
    },
    defaultUIProps: {
      formattingToolbar: d,
      linkToolbar: u,
      slashMenu: m2,
      emojiPicker: f3,
      sideMenu: g,
      filePanel: h2,
      tableHandles: b3,
      comments: p
    }
  }), [
    C,
    I,
    c2,
    d,
    u,
    m2,
    f3,
    g,
    h2,
    b3,
    p
  ]);
  return (0, import_jsx_runtime10.jsx)(_t.Provider, { value: Q, children: (0, import_jsx_runtime10.jsxs)(Jt.Provider, { value: on2, children: [
    (0, import_jsx_runtime10.jsx)(Ti, { ref: G }),
    (0, import_jsx_runtime10.jsx)(
      Bi,
      {
        className: o,
        renderEditor: x2,
        editorColorScheme: ne2,
        ref: t,
        ...O2,
        children: i
      }
    )
  ] }) });
}
var Bi = import_react12.default.forwardRef(({ className: e2, renderEditor: t, editorColorScheme: n, children: o, ...r }, i) => (0, import_jsx_runtime10.jsx)(
  "div",
  {
    className: D2("bn-container", n, e2),
    "data-color-scheme": n,
    ...r,
    ref: i,
    children: t ? (0, import_jsx_runtime10.jsx)(Li, { children: o }) : o
  }
));
var Ml = import_react12.default.forwardRef(_i);
var Li = (e2) => {
  const t = Mi(), n = v(), o = (0, import_react12.useMemo)(() => Si(), []), r = (0, import_react12.useCallback)(
    (i) => {
      n.isEditable = t.editorProps.editable !== false, n._tiptapEditor.contentComponent = o, i ? n.mount(i) : n.unmount();
    },
    [t.editorProps.editable, n, o]
  );
  return (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    (0, import_jsx_runtime10.jsx)(Vi, { contentComponent: o }),
    (0, import_jsx_runtime10.jsx)(Ei, { ...t.editorProps, ...e2, mount: r }),
    (0, import_jsx_runtime10.jsx)(ki, { ...t.defaultUIProps }),
    e2.children
  ] });
};
var Ei = (e2) => {
  const { autoFocus: t, mount: n, contentEditableProps: o } = e2;
  return (0, import_jsx_runtime10.jsx)(
    "div",
    {
      "aria-autocomplete": "list",
      "aria-haspopup": "listbox",
      "data-bn-autofocus": t,
      ref: n,
      ...o
    }
  );
};
function Y2(e2, t) {
  let n;
  const o = document.createElement("div");
  let r;
  if (t != null && t.elementRenderer)
    t.elementRenderer(
      e2((a2) => n = a2 || void 0),
      o
    );
  else {
    if (!(t != null && t.headless))
      throw new Error(
        "elementRenderer not available, expected headless editor"
      );
    r = (0, import_client.createRoot)(o), (0, import_react_dom5.flushSync)(() => {
      r.render(e2((a2) => n = a2 || void 0));
    });
  }
  if (!o.childElementCount)
    return console.warn("ReactInlineContentSpec: renderHTML() failed"), {
      dom: document.createElement("span")
    };
  n == null || n.setAttribute("data-tmp-find", "true");
  const i = o.cloneNode(true), c2 = i.firstElementChild, s = i.querySelector(
    "[data-tmp-find]"
  );
  return s == null || s.removeAttribute("data-tmp-find"), r == null || r.unmount(), {
    dom: c2,
    contentDOM: s || void 0
  };
}
function Ee(e2) {
  var t;
  return (
    // Creates `blockContent` element
    (0, import_jsx_runtime10.jsx)(
      NodeViewWrapper,
      {
        onDragOver: (n) => n.preventDefault(),
        ...Object.fromEntries(
          Object.entries(e2.domAttributes || {}).filter(
            ([n]) => n !== "class"
          )
        ),
        className: D2(
          "bn-block-content",
          ((t = e2.domAttributes) == null ? void 0 : t.class) || ""
        ),
        "data-content-type": e2.blockType,
        ...Object.fromEntries(
          Object.entries(e2.blockProps).filter(([n, o]) => {
            const r = e2.propSchema[n];
            return o !== r.default;
          }).map(([n, o]) => [F(n), o])
        ),
        "data-file-block": e2.isFileBlock === true || void 0,
        children: e2.children
      }
    )
  );
}
function ye(e2, t, n) {
  return (o = {}) => {
    const r = typeof e2 == "function" ? e2(o) : e2, i = typeof t == "function" ? t(o) : t, c2 = n ? typeof n == "function" ? n(o) : n : void 0;
    return {
      config: r,
      implementation: {
        ...i,
        toExternalHTML(s, a2, d) {
          const u = i.toExternalHTML || i.render;
          return Y2((f3) => (0, import_jsx_runtime10.jsx)(
            Ee,
            {
              blockType: s.type,
              blockProps: s.props,
              propSchema: r.propSchema,
              domAttributes: this.blockContentDOMAttributes,
              children: (0, import_jsx_runtime10.jsx)(
                u,
                {
                  block: s,
                  editor: a2,
                  contentRef: (g) => {
                    f3(g), g && (g.className = D2(
                      "bn-inline-content",
                      g.className
                    ));
                  },
                  context: d
                }
              )
            }
          ), a2);
        },
        render(s, a2) {
          if (this.renderType === "nodeView")
            return ReactNodeViewRenderer(
              (d) => {
                var g;
                const u = yt(
                  d.getPos,
                  a2,
                  d.editor,
                  r.type
                ), m2 = useReactNodeView().nodeViewContentRef;
                if (!m2)
                  throw new Error("nodeViewContentRef is not set");
                const f3 = i.render;
                return (0, import_jsx_runtime10.jsx)(
                  Ee,
                  {
                    blockType: u.type,
                    blockProps: u.props,
                    propSchema: r.propSchema,
                    isFileBlock: !!((g = i.meta) != null && g.fileBlockAccept),
                    domAttributes: this.blockContentDOMAttributes,
                    children: (0, import_jsx_runtime10.jsx)(
                      f3,
                      {
                        block: u,
                        editor: a2,
                        contentRef: (h2) => {
                          m2(h2), h2 && (h2.className = D2(
                            "bn-inline-content",
                            h2.className
                          ), h2.dataset.nodeViewContent = "");
                        }
                      }
                    )
                  }
                );
              },
              {
                className: "bn-react-node-view-renderer"
              }
            )(this.props);
          {
            const d = i.render;
            return Y2((m2) => (0, import_jsx_runtime10.jsx)(
              Ee,
              {
                blockType: s.type,
                blockProps: s.props,
                propSchema: r.propSchema,
                domAttributes: this.blockContentDOMAttributes,
                children: (0, import_jsx_runtime10.jsx)(
                  d,
                  {
                    block: s,
                    editor: a2,
                    contentRef: (f3) => {
                      m2(f3), f3 && (f3.className = D2(
                        "bn-inline-content",
                        f3.className
                      ));
                    }
                  }
                )
              }
            ), a2);
          }
        }
      },
      extensions: c2
    };
  };
}
function $e2(e2) {
  const t = v(), [n, o] = (0, import_react12.useState)("loading"), [r, i] = (0, import_react12.useState)();
  if ((0, import_react12.useEffect)(() => {
    let c2 = true;
    return (async () => {
      let s = "";
      o("loading");
      try {
        s = t.resolveFileUrl ? await t.resolveFileUrl(e2) : e2;
      } catch {
        o("error");
        return;
      }
      c2 && (o("loaded"), i(s));
    })(), () => {
      c2 = false;
    };
  }, [t, e2]), n !== "loaded")
    return {
      loadingState: n
    };
  if (!r)
    throw new Error("Finished fetching file but did not get download URL.");
  return {
    loadingState: n,
    downloadUrl: r
  };
}
var We = (e2) => (0, import_jsx_runtime10.jsxs)("figure", { children: [
  e2.children,
  (0, import_jsx_runtime10.jsx)("figcaption", { children: e2.caption })
] });
function Ri(e2) {
  const t = v();
  (0, import_react12.useEffect)(() => t.onUploadEnd(e2), [e2, t]);
}
function Oi(e2) {
  const t = v();
  (0, import_react12.useEffect)(() => t.onUploadStart(e2), [e2, t]);
}
function Qt2(e2) {
  const [t, n] = (0, import_react12.useState)(false);
  return Oi((o) => {
    o === e2 && n(true);
  }), Ri((o) => {
    o === e2 && n(false);
  }), t;
}
var Ii = (e2) => {
  const t = v(), n = S2(), o = _(H), r = (0, import_react12.useCallback)(
    (c2) => {
      c2.preventDefault();
    },
    []
  ), i = (0, import_react12.useCallback)(() => {
    t.isEditable && e2.editor.transact(() => o.showMenu(e2.block.id));
  }, [t.isEditable, o, e2.block.id, e2.editor]);
  return (0, import_jsx_runtime10.jsxs)(
    "div",
    {
      className: "bn-add-file-button",
      onMouseDown: r,
      onClick: i,
      children: [
        (0, import_jsx_runtime10.jsx)("div", { className: "bn-add-file-button-icon", children: e2.buttonIcon || (0, import_jsx_runtime10.jsx)(ze, { size: 24 }) }),
        (0, import_jsx_runtime10.jsx)("div", { className: "bn-add-file-button-text", children: e2.block.type in n.file_blocks.add_button_text ? n.file_blocks.add_button_text[e2.block.type] : n.file_blocks.add_button_text.file })
      ]
    }
  );
};
var Pi = (e2) => (0, import_jsx_runtime10.jsxs)(
  "div",
  {
    className: "bn-file-name-with-icon",
    contentEditable: false,
    draggable: false,
    children: [
      (0, import_jsx_runtime10.jsx)("div", { className: "bn-file-icon", children: (0, import_jsx_runtime10.jsx)(ze, { size: 24 }) }),
      (0, import_jsx_runtime10.jsx)("p", { className: "bn-file-name", children: e2.block.props.name })
    ]
  }
);
var qe = (e2) => {
  const t = Qt2(e2.block.id);
  return (0, import_jsx_runtime10.jsx)(
    "div",
    {
      className: "bn-file-block-content-wrapper",
      onMouseEnter: e2.onMouseEnter,
      onMouseLeave: e2.onMouseLeave,
      style: e2.style,
      children: t ? (
        // Show loader while a file is being uploaded.
        (0, import_jsx_runtime10.jsx)("div", { className: "bn-file-loading-preview", children: "Loading..." })
      ) : e2.block.props.url === "" ? (
        // Show the add file button if the file has not been uploaded yet.
        (0, import_jsx_runtime10.jsx)(Ii, { ...e2 })
      ) : (
        // Show the file preview, or the file name and icon.
        (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
          e2.block.props.showPreview === false || !e2.children ? (
            // Show file name and icon.
            (0, import_jsx_runtime10.jsx)(Pi, { ...e2 })
          ) : (
            // Show preview.
            e2.children
          ),
          e2.block.props.caption && // Show the caption if there is one.
          (0, import_jsx_runtime10.jsx)("p", { className: "bn-file-caption", children: e2.block.props.caption })
        ] })
      )
    }
  );
};
var Me = (e2) => (0, import_jsx_runtime10.jsxs)("div", { children: [
  e2.children,
  (0, import_jsx_runtime10.jsx)("p", { children: e2.caption })
] });
var Ni = (e2) => {
  const t = $e2(e2.block.props.url);
  return (0, import_jsx_runtime10.jsx)(
    "audio",
    {
      className: "bn-audio",
      src: t.loadingState === "loading" ? e2.block.props.url : t.downloadUrl,
      controls: true,
      contentEditable: false,
      draggable: false
    }
  );
};
var Ai = (e2) => {
  if (!e2.block.props.url)
    return (0, import_jsx_runtime10.jsx)("p", { children: "Add audio" });
  const t = e2.block.props.showPreview ? (0, import_jsx_runtime10.jsx)("audio", { src: e2.block.props.url }) : (0, import_jsx_runtime10.jsx)("a", { href: e2.block.props.url, children: e2.block.props.name || e2.block.props.url });
  return e2.block.props.caption ? e2.block.props.showPreview ? (0, import_jsx_runtime10.jsx)(We, { caption: e2.block.props.caption, children: t }) : (0, import_jsx_runtime10.jsx)(Me, { caption: e2.block.props.caption, children: t }) : t;
};
var Di = (e2) => (0, import_jsx_runtime10.jsx)(
  qe,
  {
    ...e2,
    buttonIcon: (0, import_jsx_runtime10.jsx)($t, { size: 24 }),
    children: (0, import_jsx_runtime10.jsx)(Ni, { ...e2 })
  }
);
var Sl = ye(
  Vt,
  (e2) => ({
    render: Di,
    parse: Wt(e2),
    toExternalHTML: Ai,
    runsBefore: ["file"]
  })
);
var Vl = ye(Zt, {
  render: (e2) => (0, import_jsx_runtime10.jsx)(qe, { ...e2 }),
  parse: Xt(),
  toExternalHTML: (e2) => {
    if (!e2.block.props.url)
      return (0, import_jsx_runtime10.jsx)("p", { children: "Add file" });
    const t = (0, import_jsx_runtime10.jsx)("a", { href: e2.block.props.url, children: e2.block.props.name || e2.block.props.url });
    return e2.block.props.caption ? (0, import_jsx_runtime10.jsx)(Me, { caption: e2.block.props.caption, children: t }) : t;
  }
});
var en = (e2) => {
  const [t, n] = (0, import_react12.useState)(void 0), [o, r] = (0, import_react12.useState)(
    e2.block.props.previewWidth
  ), [i, c2] = (0, import_react12.useState)(false), s = (0, import_react12.useRef)(null);
  (0, import_react12.useEffect)(() => {
    const g = (b3) => {
      var O2, I;
      let p;
      const C = "touches" in b3 ? b3.touches[0].clientX : b3.clientX;
      e2.block.props.textAlignment === "center" ? t.handleUsed === "left" ? p = t.initialWidth + (t.initialClientX - C) * 2 : p = t.initialWidth + (C - t.initialClientX) * 2 : t.handleUsed === "left" ? p = t.initialWidth + t.initialClientX - C : p = t.initialWidth + C - t.initialClientX, r(
        Math.min(
          Math.max(p, 64),
          ((I = (O2 = e2.editor.domElement) == null ? void 0 : O2.firstElementChild) == null ? void 0 : I.clientWidth) || Number.MAX_VALUE
        )
      );
    }, h2 = () => {
      n(void 0), e2.editor.updateBlock(e2.block, {
        props: {
          previewWidth: o
        }
      });
    };
    return t && (window.addEventListener("mousemove", g), window.addEventListener("touchmove", g), window.addEventListener("mouseup", h2), window.addEventListener("touchend", h2)), () => {
      window.removeEventListener("mousemove", g), window.removeEventListener("touchmove", g), window.removeEventListener("mouseup", h2), window.removeEventListener("touchend", h2);
    };
  }, [e2, t, o]);
  const a2 = (0, import_react12.useCallback)(() => {
    e2.editor.isEditable && c2(true);
  }, [e2.editor.isEditable]), d = (0, import_react12.useCallback)(() => {
    c2(false);
  }, []), u = (0, import_react12.useCallback)(
    (g) => {
      g.preventDefault();
      const h2 = "touches" in g ? g.touches[0].clientX : g.clientX;
      n({
        handleUsed: "left",
        initialWidth: s.current.clientWidth,
        initialClientX: h2
      });
    },
    []
  ), m2 = (0, import_react12.useCallback)(
    (g) => {
      g.preventDefault();
      const h2 = "touches" in g ? g.touches[0].clientX : g.clientX;
      n({
        handleUsed: "right",
        initialWidth: s.current.clientWidth,
        initialClientX: h2
      });
    },
    []
  ), f3 = Qt2(e2.block.id);
  return (0, import_jsx_runtime10.jsx)(
    qe,
    {
      ...e2,
      onMouseEnter: a2,
      onMouseLeave: d,
      style: e2.block.props.url && !f3 && e2.block.props.showPreview ? {
        width: o ? `${o}px` : "fit-content"
      } : void 0,
      children: (0, import_jsx_runtime10.jsxs)(
        "div",
        {
          className: "bn-visual-media-wrapper",
          style: { position: "relative" },
          ref: s,
          children: [
            e2.children,
            (i || t) && (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
              (0, import_jsx_runtime10.jsx)(
                "div",
                {
                  className: "bn-resize-handle",
                  style: { left: "4px" },
                  onMouseDown: u,
                  onTouchStart: u
                }
              ),
              (0, import_jsx_runtime10.jsx)(
                "div",
                {
                  className: "bn-resize-handle",
                  style: { right: "4px" },
                  onMouseDown: m2,
                  onTouchStart: m2
                }
              )
            ] }),
            t && (0, import_jsx_runtime10.jsx)(
              "div",
              {
                style: {
                  position: "absolute",
                  height: "100%",
                  width: "100%"
                }
              }
            )
          ]
        }
      )
    }
  );
};
var Zi = (e2) => {
  const t = $e2(e2.block.props.url);
  return (0, import_jsx_runtime10.jsx)(
    "img",
    {
      className: "bn-visual-media",
      src: t.loadingState === "loading" ? e2.block.props.url : t.downloadUrl,
      alt: e2.block.props.caption || "BlockNote image",
      contentEditable: false,
      draggable: false
    }
  );
};
var Fi = (e2) => {
  if (!e2.block.props.url)
    return (0, import_jsx_runtime10.jsx)("p", { children: "Add image" });
  const t = e2.block.props.showPreview ? (0, import_jsx_runtime10.jsx)(
    "img",
    {
      src: e2.block.props.url,
      alt: e2.block.props.name || e2.block.props.caption || "BlockNote image",
      width: e2.block.props.previewWidth
    }
  ) : (0, import_jsx_runtime10.jsx)("a", { href: e2.block.props.url, children: e2.block.props.name || e2.block.props.url });
  return e2.block.props.caption ? e2.block.props.showPreview ? (0, import_jsx_runtime10.jsx)(We, { caption: e2.block.props.caption, children: t }) : (0, import_jsx_runtime10.jsx)(Me, { caption: e2.block.props.caption, children: t }) : t;
};
var Ui = (e2) => (0, import_jsx_runtime10.jsx)(
  en,
  {
    ...e2,
    buttonIcon: (0, import_jsx_runtime10.jsx)(zt, { size: 24 }),
    children: (0, import_jsx_runtime10.jsx)(Zi, { ...e2 })
  }
);
var Tl = ye(
  nn,
  (e2) => ({
    render: Ui,
    parse: on(e2),
    toExternalHTML: Fi
  })
);
function Gi(e2) {
  return k({ attr: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, child: [{ tag: "path", attr: { d: "M14 3v4a1 1 0 0 0 1 1h4" }, child: [] }, { tag: "path", attr: { d: "M19 18v1a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-1" }, child: [] }, { tag: "path", attr: { d: "M3 14h3m4.5 0h3m4.5 0h3" }, child: [] }, { tag: "path", attr: { d: "M5 10v-5a2 2 0 0 1 2 -2h7l5 5v2" }, child: [] }] })(e2);
}
var zi = {
  page_break: Gi
};
function _l(e2) {
  return U(e2).map((t) => {
    const n = zi[t.key];
    return {
      ...t,
      icon: (0, import_jsx_runtime10.jsx)(n, { size: 18 })
    };
  });
}
var ji = (e2) => {
  const t = $e2(e2.block.props.url);
  return (0, import_jsx_runtime10.jsx)(
    "video",
    {
      className: "bn-visual-media",
      src: t.loadingState === "loading" ? e2.block.props.url : t.downloadUrl,
      controls: true,
      contentEditable: false,
      draggable: false
    }
  );
};
var $i = (e2) => {
  if (!e2.block.props.url)
    return (0, import_jsx_runtime10.jsx)("p", { children: "Add video" });
  const t = e2.block.props.showPreview ? (0, import_jsx_runtime10.jsx)("video", { src: e2.block.props.url }) : (0, import_jsx_runtime10.jsx)("a", { href: e2.block.props.url, children: e2.block.props.name || e2.block.props.url });
  return e2.block.props.caption ? e2.block.props.showPreview ? (0, import_jsx_runtime10.jsx)(We, { caption: e2.block.props.caption, children: t }) : (0, import_jsx_runtime10.jsx)(Me, { caption: e2.block.props.caption, children: t }) : t;
};
var Wi = (e2) => (0, import_jsx_runtime10.jsx)(
  en,
  {
    ...e2,
    buttonIcon: (0, import_jsx_runtime10.jsx)(Yo2, { size: 24 }),
    children: (0, import_jsx_runtime10.jsx)(ji, { ...e2 })
  }
);
var Bl = ye(
  Nn,
  (e2) => ({
    render: Wi,
    parse: Pn(e2),
    toExternalHTML: $i
  })
);
var qi = (e2, t) => {
  if (t.type === "toggled")
    return !e2;
  if (t.type === "childAdded")
    return true;
  if (t.type === "lastChildRemoved")
    return false;
  throw new O(t);
};
var Ll = (e2) => {
  const { block: t, editor: n, children: o, toggledState: r } = e2, [i, c2] = (0, import_react12.useReducer)(
    qi,
    (r || Qt).get(t)
  ), s = (m2) => {
    (r || Qt).set(
      n.getBlock(m2),
      !i
    ), c2({
      type: "toggled"
    });
  }, a2 = (m2) => {
    (r || Qt).set(m2, true), c2({
      type: "childAdded"
    });
  }, d = (m2) => {
    (r || Qt).set(m2, false), c2({
      type: "lastChildRemoved"
    });
  }, u = R2({
    editor: n,
    selector: ({ editor: m2 }) => {
      if (!To(t, m2, t.type, { isToggleable: "boolean" }) && !t.props.isToggleable)
        return 0;
      const f3 = m2.getBlock(t), g = f3.children.length || 0;
      return g > u ? i || a2(f3) : g === 0 && g < u && i && d(f3), g;
    }
  });
  return "isToggleable" in t.props && !t.props.isToggleable ? o : (0, import_jsx_runtime10.jsxs)("div", { children: [
    (0, import_jsx_runtime10.jsxs)("div", { className: "bn-toggle-wrapper", "data-show-children": i, children: [
      (0, import_jsx_runtime10.jsx)(
        "button",
        {
          className: "bn-toggle-button",
          type: "button",
          onMouseDown: (m2) => m2.preventDefault(),
          onClick: () => s(n.getBlock(t)),
          children: (0, import_jsx_runtime10.jsx)(
            "svg",
            {
              xmlns: "http://www.w3.org/2000/svg",
              height: "1em",
              viewBox: "0 -960 960 960",
              width: "1em",
              fill: "currentcolor",
              children: (0, import_jsx_runtime10.jsx)("path", { d: "M472-480 332-620q-18-18-18-44t18-44q18-18 44-18t44 18l183 183q9 9 14 21t5 24q0 12-5 24t-14 21L420-252q-18 18-44 18t-44-18q-18-18-18-44t18-44l140-140Z" })
            }
          )
        }
      ),
      o
    ] }),
    n.isEditable && i && u === 0 && (0, import_jsx_runtime10.jsx)(
      "button",
      {
        className: "bn-toggle-add-block-button",
        type: "button",
        onClick: () => {
          const m2 = n.updateBlock(t, {
            // Single empty block with default type.
            children: [{}]
          });
          n.setTextCursorPosition(m2.children[0].id, "end"), n.focus();
        },
        children: n.dictionary.toggle_blocks.add_block_button
      }
    )
  ] });
};
var El = (e2) => {
  const [t, n] = (0, import_react12.useState)("none"), o = (0, import_react12.useRef)(null), r = v(), i = B(Ao2, {
    editor: r
  }), c2 = (0, import_react12.useMemo)(() => ({
    display: "flex",
    position: "fixed",
    bottom: 0,
    zIndex: "calc(var(--bn-ui-base-z-index) + 40)",
    transform: t
  }), [t]);
  if ((0, import_react12.useEffect)(() => {
    const a2 = window.visualViewport;
    function d() {
      const u = document.body, m2 = a2.offsetLeft, f3 = a2.height - u.getBoundingClientRect().height + a2.offsetTop;
      n(
        `translate(${m2}px, ${f3}px) scale(${1 / a2.scale})`
      );
    }
    return window.visualViewport.addEventListener("scroll", d), window.visualViewport.addEventListener("resize", d), d(), () => {
      window.visualViewport.removeEventListener("scroll", d), window.visualViewport.removeEventListener("resize", d);
    };
  }, []), !i && o.current)
    return (0, import_jsx_runtime10.jsx)(
      "div",
      {
        ref: o,
        style: c2,
        dangerouslySetInnerHTML: { __html: o.current.innerHTML }
      }
    );
  const s = e2.formattingToolbar || qt;
  return (0, import_jsx_runtime10.jsx)("div", { ref: o, style: c2, children: (0, import_jsx_runtime10.jsx)(s, {}) });
};
function ht(e2, t, n) {
  const { refs: o, update: r, context: i, floatingStyles: c2 } = useFloating2({
    open: t,
    placement: e2 === "addOrRemoveColumns" ? "right" : "bottom",
    middleware: [
      size({
        apply({ rects: d, elements: u }) {
          Object.assign(
            u.floating.style,
            e2 === "addOrRemoveColumns" ? {
              height: `${d.reference.height}px`
            } : {
              width: `${d.reference.width}px`
            }
          );
        }
      })
    ]
  }), { isMounted: s, styles: a2 } = useTransitionStyles(i);
  return (0, import_react12.useEffect)(() => {
    r();
  }, [n, r]), (0, import_react12.useEffect)(() => {
    n !== null && o.setReference({
      getBoundingClientRect: () => n
    });
  }, [e2, n, o]), (0, import_react12.useMemo)(
    () => ({
      isMounted: s,
      ref: o.setFloating,
      style: {
        display: "flex",
        ...a2,
        ...c2
      }
    }),
    [c2, s, o.setFloating, a2]
  );
}
function Rl(e2, t, n) {
  const o = ht(
    "addOrRemoveRows",
    t,
    n
  ), r = ht(
    "addOrRemoveColumns",
    e2,
    n
  );
  return (0, import_react12.useMemo)(
    () => ({
      addOrRemoveRowsButton: o,
      addOrRemoveColumnsButton: r
    }),
    [r, o]
  );
}
function Ki(e2, t, n) {
  return n && n.draggedCellOrientation === "row" ? new DOMRect(
    t.x,
    n.mousePos,
    t.width,
    0
  ) : new DOMRect(
    t.x,
    e2.y,
    t.width,
    e2.height
  );
}
function Xi(e2, t, n) {
  return n && n.draggedCellOrientation === "col" ? new DOMRect(
    n.mousePos,
    t.y,
    0,
    t.height
  ) : new DOMRect(
    e2.x,
    t.y,
    e2.width,
    t.height
  );
}
function Yi(e2) {
  return new DOMRect(
    e2.x,
    e2.y,
    e2.width,
    0
  );
}
function Re(e2, t, n, o, r) {
  const { refs: i, update: c2, context: s, floatingStyles: a2 } = useFloating2({
    open: t,
    placement: e2 === "row" ? "left" : e2 === "col" ? "top" : "bottom-end",
    middleware: [
      offset(
        e2 === "row" ? -10 : e2 === "col" ? -12 : { mainAxis: 1, crossAxis: -1 }
      )
    ]
  }), { isMounted: d, styles: u } = useTransitionStyles(s);
  return (0, import_react12.useEffect)(() => {
    c2();
  }, [n, o, c2]), (0, import_react12.useEffect)(() => {
    n === null || o === null || // Ignore cell handle when dragging
    r && e2 === "cell" || i.setReference({
      getBoundingClientRect: () => (e2 === "row" ? Ki : e2 === "col" ? Xi : Yi)(n, o, r)
    });
  }, [r, e2, n, o, i]), (0, import_react12.useMemo)(
    () => ({
      isMounted: d,
      ref: i.setFloating,
      style: {
        display: "flex",
        ...u,
        ...a2
      }
    }),
    [a2, d, i.setFloating, u]
  );
}
function Ol(e2, t, n, o) {
  const r = Re(
    "row",
    e2,
    t,
    n,
    o
  ), i = Re(
    "col",
    e2,
    t,
    n,
    o
  ), c2 = Re(
    "cell",
    e2,
    t,
    n,
    o
  );
  return (0, import_react12.useMemo)(
    () => ({
      rowHandle: r,
      colHandle: i,
      cellHandle: c2
    }),
    [i, r, c2]
  );
}
var Ke = (e2 = {}, t = []) => (0, import_react12.useMemo)(() => {
  const n = $e.create(e2);
  return window && (window.ProseMirror = n._tiptapEditor), n;
}, t);
var Xe = (e2) => {
  const [t, n] = (0, import_react12.useState)(false), o = R2({
    editor: e2.editor,
    selector: ({ editor: s }) => s.isEmpty
  }), r = w2(), i = (0, import_react12.useCallback)(() => {
    n(true);
  }, []), c2 = (0, import_react12.useCallback)(() => {
    n(false);
  }, []);
  return (0, import_react12.useEffect)(() => {
    e2.editable && e2.autoFocus && e2.editor.focus();
  }, [e2.autoFocus, e2.editable, e2.editor]), (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    (0, import_jsx_runtime10.jsx)(
      r.Comments.Editor,
      {
        autoFocus: e2.autoFocus,
        className: "bn-comment-editor",
        editor: e2.editor,
        onFocus: i,
        onBlur: c2,
        editable: e2.editable
      }
    ),
    e2.actions && (0, import_jsx_runtime10.jsx)("div", { className: "bn-comment-actions-wrapper", children: (0, import_jsx_runtime10.jsx)(e2.actions, { isFocused: t, isEmpty: o }) })
  ] });
};
var me;
async function Ji() {
  return me || (me = (async () => {
    const [e2, t] = await Promise.all([
      import("./module-TKJV5OHA.js"),
      // use a dynamic import to encourage bundle-splitting
      // and a smaller initial client bundle size
      import("./native-2265EJQD.js")
    ]), n = "default" in e2 ? e2.default : e2, o = "default" in t ? t.default : t;
    return await n.init({ data: o }), { emojiMart: n, emojiData: o };
  })(), me);
}
function Qi(e2) {
  const t = (0, import_react12.useRef)(null), n = (0, import_react12.useRef)(null);
  return n.current && n.current.update(e2), (0, import_react12.useEffect)(() => ((async () => {
    const { emojiMart: o } = await Ji();
    n.current = new o.Picker({ ...e2, ref: t });
  })(), () => {
    n.current = null;
  }), []), import_react12.default.createElement("div", { ref: t });
}
var bt = (e2) => {
  var c2;
  const [t, n] = (0, import_react12.useState)(false), o = w2(), r = v(), i = q();
  return (0, import_jsx_runtime10.jsxs)(o.Generic.Popover.Root, { open: t, children: [
    (0, import_jsx_runtime10.jsx)(o.Generic.Popover.Trigger, { children: (0, import_jsx_runtime10.jsx)(
      "div",
      {
        onClick: (s) => {
          var a2;
          s.preventDefault(), s.stopPropagation(), n(!t), (a2 = e2.onOpenChange) == null || a2.call(e2, !t);
        },
        style: {
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        },
        children: e2.children
      }
    ) }),
    ((c2 = r.domElement) == null ? void 0 : c2.parentElement) && (0, import_react_dom5.createPortal)(
      (0, import_jsx_runtime10.jsx)(
        o.Generic.Popover.Content,
        {
          className: "bn-emoji-picker-popover",
          variant: "panel-popover",
          children: (0, import_jsx_runtime10.jsx)(
            Qi,
            {
              perLine: 7,
              onClickOutside: () => {
                var s;
                n(false), (s = e2.onOpenChange) == null || s.call(e2, false);
              },
              onEmojiSelect: (s) => {
                var a2;
                e2.onEmojiSelect(s), n(false), (a2 = e2.onOpenChange) == null || a2.call(e2, false);
              },
              theme: i == null ? void 0 : i.colorSchemePreference
            }
          )
        }
      ),
      r.domElement.parentElement
    )
  ] });
};
function el(e2) {
  return Ye([e2]).get(e2);
}
function Ye(e2) {
  const n = _(ne).userStore, o = (0, import_react12.useCallback)(() => {
    const c2 = /* @__PURE__ */ new Map();
    for (const s of e2) {
      const a2 = n.getUser(s);
      a2 && c2.set(s, a2);
    }
    return c2;
  }, [n, e2]), r = (0, import_react12.useMemo)(() => ({
    current: o()
  }), [o]), i = (0, import_react12.useCallback)(
    (c2) => {
      const s = n.subscribe((a2) => {
        r.current = o(), c2();
      });
      return n.loadUsers(e2), s;
    },
    [n, o, e2, r]
  );
  return (0, import_react12.useSyncExternalStore)(i, () => r.current);
}
var tl = (e2) => {
  const t = w2(), n = S2(), o = _(ne), r = e2.comment.reactions.find(
    (a2) => a2.emoji === e2.emoji
  );
  if (!r)
    throw new Error(
      "Trying to render reaction badge for non-existing reaction"
    );
  const [i, c2] = (0, import_react12.useState)([]), s = Ye(i);
  return (0, import_jsx_runtime10.jsx)(
    t.Generic.Badge.Root,
    {
      className: D2("bn-badge", "bn-comment-reaction"),
      text: r.userIds.length.toString(),
      icon: r.emoji,
      isSelected: o.threadStore.auth.canDeleteReaction(
        e2.comment,
        r.emoji
      ),
      onClick: () => e2.onReactionSelect(r.emoji),
      onMouseEnter: () => c2(r.userIds),
      mainTooltip: n.comments.reactions.reacted_by,
      secondaryTooltip: `${Array.from(s.values()).map((a2) => a2.username).join(`
`)}`
    },
    r.emoji
  );
};
var { textColor: Il, backgroundColor: Pl, ...nl } = $n;
var Je = h.create({
  blockSpecs: {
    paragraph: Cn()
  },
  styleSpecs: nl
});
var ol = ({
  comment: e2,
  thread: t,
  showResolveButton: n
}) => {
  const o = _(ne), r = S2(), i = Ke({
    initialContent: e2.body,
    trailingBlock: false,
    dictionary: {
      ...r,
      placeholders: {
        emptyDocument: r.placeholders.edit_comment
      }
    },
    schema: o.commentEditorSchema || Je
  }), c2 = w2(), [s, a2] = (0, import_react12.useState)(false), [d, u] = (0, import_react12.useState)(false), m2 = o.threadStore, f3 = (0, import_react12.useCallback)(() => {
    a2(true);
  }, []), g = (0, import_react12.useCallback)(() => {
    i.replaceBlocks(i.document, e2.body), a2(false);
  }, [i, e2.body]), h2 = (0, import_react12.useCallback)(
    async (G) => {
      await m2.updateComment({
        commentId: e2.id,
        comment: {
          body: i.document
        },
        threadId: t.id
      }), a2(false);
    },
    [e2, t.id, i, m2]
  ), b3 = (0, import_react12.useCallback)(async () => {
    await m2.deleteComment({
      commentId: e2.id,
      threadId: t.id
    });
  }, [e2, t.id, m2]), p = (0, import_react12.useCallback)(
    async (G) => {
      m2.auth.canAddReaction(e2, G) ? await m2.addReaction({
        threadId: t.id,
        commentId: e2.id,
        emoji: G
      }) : m2.auth.canDeleteReaction(e2, G) && await m2.deleteReaction({
        threadId: t.id,
        commentId: e2.id,
        emoji: G
      });
    },
    [m2, e2, t.id]
  ), C = (0, import_react12.useCallback)(async () => {
    await m2.resolveThread({
      threadId: t.id
    });
  }, [t.id, m2]), x2 = (0, import_react12.useCallback)(async () => {
    await m2.unresolveThread({
      threadId: t.id
    });
  }, [t.id, m2]), O2 = el(e2.userId);
  if (!e2.body)
    return null;
  let I;
  const j = m2.auth.canAddReaction(e2), L2 = m2.auth.canDeleteComment(e2), P = m2.auth.canUpdateComment(e2), K2 = n && (t.resolved ? m2.auth.canUnresolveThread(t) : m2.auth.canResolveThread(t));
  s || (I = (0, import_jsx_runtime10.jsxs)(
    c2.Generic.Toolbar.Root,
    {
      className: D2("bn-action-toolbar", "bn-comment-actions"),
      variant: "action-toolbar",
      children: [
        j && (0, import_jsx_runtime10.jsx)(
          bt,
          {
            onEmojiSelect: (G) => p(G.native),
            onOpenChange: u,
            children: (0, import_jsx_runtime10.jsx)(
              c2.Generic.Toolbar.Button,
              {
                mainTooltip: r.comments.actions.add_reaction,
                variant: "compact",
                children: (0, import_jsx_runtime10.jsx)(dt, { size: 16 })
              },
              "add-reaction"
            )
          }
        ),
        K2 && (t.resolved ? (0, import_jsx_runtime10.jsx)(
          c2.Generic.Toolbar.Button,
          {
            mainTooltip: "Re-open",
            variant: "compact",
            onClick: x2,
            children: (0, import_jsx_runtime10.jsx)(Bo2, { size: 16 })
          },
          "reopen"
        ) : (0, import_jsx_runtime10.jsx)(
          c2.Generic.Toolbar.Button,
          {
            mainTooltip: r.comments.actions.resolve,
            variant: "compact",
            onClick: C,
            children: (0, import_jsx_runtime10.jsx)(Qo, { size: 16 })
          },
          "resolve"
        )),
        (L2 || P) && (0, import_jsx_runtime10.jsxs)(c2.Generic.Menu.Root, { position: "bottom-start", children: [
          (0, import_jsx_runtime10.jsx)(c2.Generic.Menu.Trigger, { children: (0, import_jsx_runtime10.jsx)(
            c2.Generic.Toolbar.Button,
            {
              mainTooltip: r.comments.actions.more_actions,
              variant: "compact",
              children: (0, import_jsx_runtime10.jsx)(rr, { size: 16 })
            },
            "more-actions"
          ) }),
          (0, import_jsx_runtime10.jsxs)(c2.Generic.Menu.Dropdown, { className: "bn-menu-dropdown", children: [
            P && (0, import_jsx_runtime10.jsx)(
              c2.Generic.Menu.Item,
              {
                icon: (0, import_jsx_runtime10.jsx)(Lo2, {}),
                onClick: f3,
                children: r.comments.actions.edit_comment
              },
              "edit-comment"
            ),
            L2 && (0, import_jsx_runtime10.jsx)(
              c2.Generic.Menu.Item,
              {
                icon: (0, import_jsx_runtime10.jsx)(tr, {}),
                onClick: b3,
                children: r.comments.actions.delete_comment
              },
              "delete-comment"
            )
          ] })
        ] })
      ]
    }
  ));
  const ne2 = e2.createdAt.toLocaleDateString(void 0, {
    month: "short",
    day: "numeric"
  });
  if (!e2.body)
    throw new Error("soft deletes are not yet supported");
  return (0, import_jsx_runtime10.jsx)(
    c2.Comments.Comment,
    {
      authorInfo: O2 ?? "loading",
      timeString: ne2,
      edited: e2.updatedAt.getTime() !== e2.createdAt.getTime(),
      showActions: "hover",
      actions: I,
      className: "bn-thread-comment",
      emojiPickerOpen: d,
      children: (0, import_jsx_runtime10.jsx)(
        Xe,
        {
          autoFocus: s,
          editor: i,
          editable: s,
          actions: e2.reactions.length > 0 || s ? ({ isEmpty: G }) => (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
            e2.reactions.length > 0 && !s && (0, import_jsx_runtime10.jsxs)(
              c2.Generic.Badge.Group,
              {
                className: D2(
                  "bn-badge-group",
                  "bn-comment-reactions"
                ),
                children: [
                  e2.reactions.map((Q) => (0, import_jsx_runtime10.jsx)(
                    tl,
                    {
                      comment: e2,
                      emoji: Q.emoji,
                      onReactionSelect: p
                    },
                    Q.emoji
                  )),
                  j && (0, import_jsx_runtime10.jsx)(
                    bt,
                    {
                      onEmojiSelect: (Q) => p(Q.native),
                      onOpenChange: u,
                      children: (0, import_jsx_runtime10.jsx)(
                        c2.Generic.Badge.Root,
                        {
                          className: D2(
                            "bn-badge",
                            "bn-comment-add-reaction"
                          ),
                          text: "+",
                          icon: (0, import_jsx_runtime10.jsx)(dt, { size: 16 }),
                          mainTooltip: r.comments.actions.add_reaction
                        }
                      )
                    }
                  )
                ]
              }
            ),
            s && (0, import_jsx_runtime10.jsxs)(
              c2.Generic.Toolbar.Root,
              {
                variant: "action-toolbar",
                className: D2(
                  "bn-action-toolbar",
                  "bn-comment-actions"
                ),
                children: [
                  (0, import_jsx_runtime10.jsx)(
                    c2.Generic.Toolbar.Button,
                    {
                      mainTooltip: r.comments.save_button_text,
                      variant: "compact",
                      onClick: h2,
                      isDisabled: G,
                      children: r.comments.save_button_text
                    }
                  ),
                  (0, import_jsx_runtime10.jsx)(
                    c2.Generic.Toolbar.Button,
                    {
                      className: "bn-button",
                      mainTooltip: r.comments.cancel_button_text,
                      variant: "compact",
                      onClick: g,
                      children: r.comments.cancel_button_text
                    }
                  )
                ]
              }
            )
          ] }) : void 0
        }
      )
    }
  );
};
var rl = ({
  thread: e2,
  maxCommentsBeforeCollapse: t
}) => {
  const n = w2(), o = S2(), r = Ye(e2.resolvedBy ? [e2.resolvedBy] : []), i = e2.comments.map((c2, s) => (0, import_jsx_runtime10.jsx)(
    ol,
    {
      thread: e2,
      comment: c2,
      showResolveButton: s === 0
    },
    c2.id + JSON.stringify(c2.body || "{}")
  ));
  if (e2.resolved && e2.resolvedUpdatedAt && e2.resolvedBy) {
    if (!r.get(e2.resolvedBy))
      throw new Error(
        `User ${e2.resolvedBy} resolved thread ${e2.id}, but their data could not be found.`
      );
    const s = e2.comments.findLastIndex(
      (a2) => e2.resolvedUpdatedAt.getTime() > a2.createdAt.getTime()
    ) + 1;
    i.splice(
      s,
      0,
      (0, import_jsx_runtime10.jsx)(
        n.Comments.Comment,
        {
          className: "bn-thread-comment",
          authorInfo: e2.resolvedBy && r.get(e2.resolvedBy) || "loading",
          timeString: e2.resolvedUpdatedAt.toLocaleDateString(void 0, {
            month: "short",
            day: "numeric"
          }),
          edited: false,
          showActions: false,
          children: (0, import_jsx_runtime10.jsx)("div", { className: "bn-resolved-text", children: o.comments.sidebar.marked_as_resolved })
        },
        "resolved-comment"
      )
    );
  }
  return t && i.length > t && i.splice(
    1,
    i.length - 2,
    (0, import_jsx_runtime10.jsx)(
      n.Comments.ExpandSectionsPrompt,
      {
        className: "bn-thread-expand-prompt",
        children: o.comments.sidebar.more_replies(e2.comments.length - 2)
      },
      "expand-prompt"
    )
  ), i;
};
function il() {
  const e2 = _(ne), t = w2(), n = S2(), o = Ke({
    trailingBlock: false,
    dictionary: {
      ...n,
      placeholders: {
        emptyDocument: n.placeholders.new_comment
      }
    },
    schema: e2.commentEditorSchema || Je
  });
  return (0, import_jsx_runtime10.jsx)(t.Comments.Card, { className: "bn-thread", children: (0, import_jsx_runtime10.jsx)(
    Xe,
    {
      autoFocus: true,
      editable: true,
      editor: o,
      actions: ({ isEmpty: r }) => (0, import_jsx_runtime10.jsx)(
        t.Generic.Toolbar.Root,
        {
          className: D2(
            "bn-action-toolbar",
            "bn-comment-actions"
          ),
          variant: "action-toolbar",
          children: (0, import_jsx_runtime10.jsx)(
            t.Generic.Toolbar.Button,
            {
              className: "bn-button",
              mainTooltip: "Save",
              variant: "compact",
              isDisabled: r,
              onClick: async () => {
                await e2.createThread({
                  initialComment: {
                    body: o.document
                  }
                }), e2.stopPendingComment();
              },
              children: "Save"
            }
          )
        }
      )
    }
  ) });
}
function ll(e2) {
  const t = v(), n = _(ne), o = B(ne, {
    editor: t,
    selector: (s) => s.pendingComment
  }), r = R2({
    editor: t,
    selector: ({ editor: s }) => o ? {
      from: s.prosemirrorState.selection.from,
      to: s.prosemirrorState.selection.to
    } : void 0
  }), i = (0, import_react12.useMemo)(
    () => {
      var s, a2;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: !!o,
          // Needed as hooks like `useDismiss` call `onOpenChange` to change the
          // open state.
          onOpenChange: (d) => {
            d || (n.stopPendingComment(), t.focus());
          },
          placement: "bottom",
          middleware: [offset(10), shift(), flip()],
          ...(s = e2.floatingUIOptions) == null ? void 0 : s.useFloatingOptions
        },
        focusManagerProps: {
          disabled: false
        },
        elementProps: {
          style: {
            zIndex: 60
          },
          ...(a2 = e2.floatingUIOptions) == null ? void 0 : a2.elementProps
        }
      };
    },
    [n, t, o, e2.floatingUIOptions]
  ), c2 = e2.floatingComposer || il;
  return (0, import_jsx_runtime10.jsx)(Ge, { position: r, ...i, children: (0, import_jsx_runtime10.jsx)(c2, {}) });
}
var cl = Object.freeze(Object.defineProperty({
  __proto__: null,
  default: ll
}, Symbol.toStringTag, { value: "Module" }));
var tn = ({
  thread: e2,
  selected: t,
  referenceText: n,
  maxCommentsBeforeCollapse: o,
  onFocus: r,
  onBlur: i,
  tabIndex: c2
}) => {
  const s = w2(), a2 = S2(), d = _(ne), u = Ke({
    trailingBlock: false,
    dictionary: {
      ...a2,
      placeholders: {
        emptyDocument: a2.placeholders.comment_reply
      }
    },
    schema: d.commentEditorSchema || Je
  }), m2 = (0, import_react12.useCallback)(async () => {
    await d.threadStore.addComment({
      comment: {
        body: u.document
      },
      threadId: e2.id
    }), u.removeBlocks(u.document);
  }, [d, u, e2.id]);
  return (0, import_jsx_runtime10.jsxs)(
    s.Comments.Card,
    {
      className: "bn-thread",
      headerText: n,
      onFocus: r,
      onBlur: i,
      selected: t,
      tabIndex: c2,
      children: [
        (0, import_jsx_runtime10.jsx)(s.Comments.CardSection, { className: "bn-thread-comments", children: (0, import_jsx_runtime10.jsx)(
          rl,
          {
            thread: e2,
            maxCommentsBeforeCollapse: t ? void 0 : o || 5
          }
        ) }),
        t && (0, import_jsx_runtime10.jsx)(s.Comments.CardSection, { className: "bn-thread-composer", children: (0, import_jsx_runtime10.jsx)(
          Xe,
          {
            autoFocus: false,
            editable: true,
            editor: u,
            actions: ({ isEmpty: f3 }) => f3 ? null : (0, import_jsx_runtime10.jsx)(
              s.Generic.Toolbar.Root,
              {
                variant: "action-toolbar",
                className: D2(
                  "bn-action-toolbar",
                  "bn-comment-actions"
                ),
                children: (0, import_jsx_runtime10.jsx)(
                  s.Generic.Toolbar.Button,
                  {
                    mainTooltip: a2.comments.save_button_text,
                    variant: "compact",
                    isDisabled: f3,
                    onClick: m2,
                    children: a2.comments.save_button_text
                  }
                )
              }
            )
          }
        ) })
      ]
    }
  );
};
function nn2() {
  const t = _(ne).threadStore, n = (0, import_react12.useRef)(void 0);
  n.current || (n.current = t.getThreads());
  const o = (0, import_react12.useCallback)(
    (r) => t.subscribe((i) => {
      n.current = i, r();
    }),
    [t]
  );
  return (0, import_react12.useSyncExternalStore)(o, () => n.current);
}
function al(e2) {
  const t = v(), n = _(ne), o = B(ne, {
    editor: t,
    selector: (a2) => a2.selectedThreadId ? {
      id: a2.selectedThreadId,
      position: a2.threadPositions.get(a2.selectedThreadId)
    } : void 0
  }), r = nn2(), i = (0, import_react12.useMemo)(
    () => o ? r.get(o.id) : void 0,
    [o, r]
  ), c2 = (0, import_react12.useMemo)(
    () => {
      var a2, d, u;
      return {
        ...e2.floatingUIOptions,
        useFloatingOptions: {
          open: !!o,
          // Needed as hooks like `useDismiss` call `onOpenChange` to change the
          // open state.
          onOpenChange: (m2, f3, g) => {
            g === "escape-key" && t.focus(), m2 || n.selectThread(void 0);
          },
          placement: "bottom",
          middleware: [offset(10), shift(), flip()],
          ...(a2 = e2.floatingUIOptions) == null ? void 0 : a2.useFloatingOptions
        },
        focusManagerProps: {
          disabled: true,
          ...(d = e2.floatingUIOptions) == null ? void 0 : d.focusManagerProps
        },
        elementProps: {
          style: {
            zIndex: 30
          },
          ...(u = e2.floatingUIOptions) == null ? void 0 : u.elementProps
        }
      };
    },
    [n, t, e2.floatingUIOptions, o]
  ), s = e2.floatingThread || tn;
  return (0, import_jsx_runtime10.jsx)(Ge, { position: o == null ? void 0 : o.position, ...c2, children: i && (0, import_jsx_runtime10.jsx)(s, { thread: i, selected: true }) });
}
var sl = Object.freeze(Object.defineProperty({
  __proto__: null,
  default: al
}, Symbol.toStringTag, { value: "Module" }));
var dl = import_react12.default.memo(
  ({
    thread: e2,
    selectedThreadId: t,
    maxCommentsBeforeCollapse: n,
    referenceText: o
  }) => {
    const r = _(ne), i = (0, import_react12.useCallback)(
      (s) => {
        s.target.closest(".bn-action-toolbar") || r.selectThread(e2.id);
      },
      [r, e2.id]
    ), c2 = (0, import_react12.useCallback)(
      (s) => {
        if (!s.relatedTarget || s.relatedTarget.closest(".bn-action-toolbar"))
          return;
        const a2 = s.target instanceof Node ? s.target : null, d = s.relatedTarget instanceof Node ? s.relatedTarget.closest(".bn-thread") : null;
        (!a2 || !d || !d.contains(a2)) && r.selectThread(void 0);
      },
      [r]
    );
    return (0, import_jsx_runtime10.jsx)(
      tn,
      {
        thread: e2,
        selected: e2.id === t,
        referenceText: o,
        maxCommentsBeforeCollapse: n,
        onFocus: i,
        onBlur: c2,
        tabIndex: 0
      }
    );
  }
);
function ul(e2, t, n) {
  if (t === "recent-activity")
    return e2.sort(
      (o, r) => r.comments[r.comments.length - 1].createdAt.getTime() - o.comments[o.comments.length - 1].createdAt.getTime()
    );
  if (t === "oldest")
    return e2.sort(
      (o, r) => o.createdAt.getTime() - r.createdAt.getTime()
    );
  if (t === "position")
    return e2.sort((o, r) => {
      var s, a2;
      const i = ((s = n == null ? void 0 : n.get(o.id)) == null ? void 0 : s.from) || Number.MAX_VALUE, c2 = ((a2 = n == null ? void 0 : n.get(r.id)) == null ? void 0 : a2.from) || Number.MAX_VALUE;
      return i - c2;
    });
  throw new O(t);
}
function pt(e2, t) {
  return e2.transact((n) => {
    if (!t)
      return "Original content deleted";
    if (n.doc.nodeSize < t.to)
      return "";
    const o = n.doc.textBetween(
      t.from,
      t.to
    );
    return o.length > 15 ? `${o.slice(0, 15)}…` : o;
  });
}
function Nl(e2) {
  const t = v(), { selectedThreadId: n, threadPositions: o } = B(ne), r = nn2(), i = (0, import_react12.useMemo)(() => {
    const c2 = Array.from(r.values()), s = ul(
      c2,
      e2.sort || "position",
      o
    ), a2 = [];
    for (const d of s)
      d.resolved ? (e2.filter === "resolved" || e2.filter === "all") && a2.push({
        thread: d,
        referenceText: pt(
          t,
          o.get(d.id)
        )
      }) : (e2.filter === "open" || e2.filter === "all") && a2.push({
        thread: d,
        referenceText: pt(
          t,
          o.get(d.id)
        )
      });
    return a2;
  }, [r, e2.sort, e2.filter, o, t]);
  return (0, import_jsx_runtime10.jsx)("div", { className: "bn-threads-sidebar", children: i.map((c2) => (0, import_jsx_runtime10.jsx)(
    dl,
    {
      thread: c2.thread,
      selectedThreadId: n,
      editor: t,
      referenceText: c2.referenceText,
      maxCommentsBeforeCollapse: e2.maxCommentsBeforeCollapse
    },
    c2.thread.id
  )) });
}
function Al(e2) {
  const t = q();
  if (e2 || (e2 = t == null ? void 0 : t.editor), !e2)
    throw new Error(
      "'editor' is required, either from BlockNoteContext or as a function argument"
    );
  return R2({
    editor: e2,
    selector: ({ editor: o }) => o.getActiveStyles()
  });
}
function Dl(e2, t) {
  return R2({
    editor: t,
    selector: ({ editor: n }) => e2 ? n.getSelectionBoundingBox() : void 0
  });
}
function ml(e2) {
  return e2.currentTarget instanceof HTMLElement && e2.relatedTarget instanceof HTMLElement ? e2.currentTarget.contains(e2.relatedTarget) : false;
}
function Zl({
  onBlur: e2,
  onFocus: t
} = {}) {
  const n = (0, import_react12.useRef)(null), [o, r] = (0, import_react12.useState)(false), i = (0, import_react12.useRef)(false), c2 = (d) => {
    r(d), i.current = d;
  }, s = (d) => {
    i.current || (c2(true), t == null || t(d));
  }, a2 = (d) => {
    i.current && !ml(d) && (c2(false), e2 == null || e2(d));
  };
  return (0, import_react12.useEffect)(() => {
    const d = n.current;
    if (d)
      return d.addEventListener("focusin", s), d.addEventListener("focusout", a2), () => {
        d == null || d.removeEventListener("focusin", s), d == null || d.removeEventListener("focusout", a2);
      };
  }, [s, a2]), { ref: n, focused: o };
}
function Fl(e2) {
  return R2({
    editor: e2,
    selector: ({ editor: t }) => {
      var n;
      return ((n = t.getSelection()) == null ? void 0 : n.blocks) || [t.getTextCursorPosition().block];
    }
  });
}
function Oe2(e2) {
  return (
    // Creates inline content section element
    (0, import_jsx_runtime10.jsx)(
      NodeViewWrapper,
      {
        as: "span",
        className: "bn-inline-content-section",
        "data-inline-content-type": e2.inlineContentType,
        ...Object.fromEntries(
          Object.entries(e2.inlineContentProps).filter(([t, n]) => {
            const o = e2.propSchema[t];
            return n !== o.default;
          }).map(([t, n]) => [F(t), n])
        ),
        children: e2.children
      }
    )
  );
}
function Ul(e2, t) {
  var o;
  const n = Node3.create({
    name: e2.type,
    inline: true,
    group: "inline",
    selectable: e2.content === "styled",
    atom: e2.content === "none",
    draggable: (o = t.meta) == null ? void 0 : o.draggable,
    content: e2.content === "styled" ? "inline*" : "",
    addAttributes() {
      return kt(e2.propSchema);
    },
    addKeyboardShortcuts() {
      return Co(e2);
    },
    parseHTML() {
      return Xt2(
        e2,
        t.parse
      );
    },
    renderHTML({ node: r }) {
      const i = this.options.editor, c2 = wt(
        r,
        i.schema.inlineContentSchema,
        i.schema.styleSchema
      ), s = t.toExternalHTML || t.render, a2 = Y2(
        (d) => (0, import_jsx_runtime10.jsx)(
          s,
          {
            contentRef: (u) => {
              d(u), u && (u.dataset.editable = "");
            },
            inlineContent: c2,
            updateInlineContent: () => {
            },
            editor: i
          }
        ),
        i
      );
      return bo(
        a2,
        e2.type,
        r.attrs,
        e2.propSchema
      );
    },
    addNodeView() {
      const r = this.options.editor;
      return (i) => ReactNodeViewRenderer(
        (c2) => {
          const s = useReactNodeView().nodeViewContentRef;
          if (!s)
            throw new Error("nodeViewContentRef is not set");
          const a2 = t.render;
          return (0, import_jsx_runtime10.jsx)(
            Oe2,
            {
              inlineContentProps: c2.node.attrs,
              inlineContentType: e2.type,
              propSchema: e2.propSchema,
              children: (0, import_jsx_runtime10.jsx)(
                a2,
                {
                  contentRef: (d) => {
                    s(d), d && (d.dataset.editable = "");
                  },
                  editor: r,
                  inlineContent: wt(
                    c2.node,
                    r.schema.inlineContentSchema,
                    r.schema.styleSchema
                  ),
                  updateInlineContent: (d) => {
                    const u = T(
                      [d],
                      r.pmSchema
                    ), m2 = c2.getPos();
                    m2 !== void 0 && r.transact(
                      (f3) => f3.replaceWith(m2, m2 + c2.node.nodeSize, u)
                    );
                  }
                }
              )
            }
          );
        },
        {
          className: "bn-ic-react-node-view-renderer",
          as: "span"
          // contentDOMElementTag: "span", (requires tt upgrade)
        }
      )(i);
    }
  });
  return xt(
    e2,
    {
      ...t,
      node: n,
      render(r, i, c2) {
        const s = t.render;
        return Y2((d) => (0, import_jsx_runtime10.jsx)(
          Oe2,
          {
            inlineContentProps: r.props,
            inlineContentType: e2.type,
            propSchema: e2.propSchema,
            children: (0, import_jsx_runtime10.jsx)(
              s,
              {
                contentRef: (u) => {
                  d(u), u && (u.dataset.editable = "");
                },
                editor: c2,
                inlineContent: r,
                updateInlineContent: i
              }
            )
          }
        ), c2);
      },
      toExternalHTML(r, i) {
        const c2 = t.toExternalHTML || t.render;
        return Y2((a2) => (0, import_jsx_runtime10.jsx)(
          Oe2,
          {
            inlineContentProps: r.props,
            inlineContentType: e2.type,
            propSchema: e2.propSchema,
            children: (0, import_jsx_runtime10.jsx)(
              c2,
              {
                contentRef: (d) => {
                  a2(d), d && (d.dataset.editable = "");
                },
                editor: i,
                inlineContent: r,
                updateInlineContent: () => {
                }
              }
            )
          }
        ), i);
      }
    }
  );
}
function Gl(e2, t) {
  const n = Mark.create({
    name: e2.type,
    addAttributes() {
      return wt2(e2.propSchema);
    },
    parseHTML() {
      return Tt(e2);
    },
    renderHTML({ mark: o }) {
      const r = t.render, i = Y2(
        (c2) => (0, import_jsx_runtime10.jsx)(
          r,
          {
            editor: this.options.editor,
            value: e2.propSchema === "boolean" ? void 0 : o.attrs.stringValue,
            contentRef: (s) => {
              c2(s), s && (s.dataset.editable = "");
            }
          }
        ),
        this.options.editor
      );
      return W(
        i,
        e2.type,
        o.attrs.stringValue,
        e2.propSchema
      );
    },
    addMarkView() {
      const o = this.options.editor;
      return (r) => {
        const i = ReactMarkViewRenderer((c2) => {
          const s = (0, import_react12.useContext)(ReactMarkViewContext).markViewContentRef;
          if (!s)
            throw new Error("markViewContentRef is not set");
          const a2 = t.render;
          return (0, import_jsx_runtime10.jsx)(
            a2,
            {
              editor: o,
              contentRef: (d) => {
                s(d), d && (d.dataset.markViewContent = "");
              },
              value: e2.propSchema === "boolean" ? void 0 : c2.mark.attrs.stringValue
            }
          );
        })(r);
        return i.didMountContentDomElement = true, i;
      };
    }
  });
  return Le(e2, {
    ...t,
    mark: n,
    render(o, r) {
      const i = t.render, c2 = Y2(
        (s) => (0, import_jsx_runtime10.jsx)(
          i,
          {
            editor: r,
            value: o,
            contentRef: (a2) => {
              s(a2), a2 && (a2.dataset.editable = "");
            }
          }
        ),
        r
      );
      return W(
        c2,
        e2.type,
        o,
        e2.propSchema
      );
    },
    toExternalHTML(o, r) {
      const i = t.render, c2 = Y2(
        (s) => (0, import_jsx_runtime10.jsx)(
          i,
          {
            editor: r,
            value: o,
            contentRef: (a2) => {
              s(a2), a2 && (a2.dataset.editable = "");
            }
          }
        ),
        r
      );
      return W(
        c2,
        e2.type,
        o,
        e2.propSchema
      );
    }
  });
}
function zl(e2, t) {
  const n = e2.getBoundingClientRect(), o = t.getBoundingClientRect(), r = n.top < o.top, i = n.bottom > o.bottom;
  return r && i ? "both" : r ? "top" : i ? "bottom" : "none";
}
function jl(e2) {
  return (t) => {
    e2.forEach((n) => {
      typeof n == "function" ? n(t) : n != null && (n.current = t);
    });
  };
}

export {
  useMergeRefs,
  useHover,
  FloatingDelayGroup,
  useDelayGroup,
  useDismiss,
  useFloating2 as useFloating,
  useFocus,
  useInteractions,
  useRole,
  _t,
  q,
  v,
  _,
  B,
  co,
  $,
  Bt2 as Bt,
  ao,
  w2 as w,
  S2 as S,
  so,
  uo,
  Lt,
  mo,
  R2 as R,
  Ge,
  de,
  sr,
  Wt2 as Wt,
  ur,
  mr,
  fr,
  gr,
  hr,
  br,
  pr,
  Cr,
  vr,
  wr,
  kr,
  Hr,
  xr,
  yr,
  Sr,
  Le2 as Le,
  Tr,
  qt,
  Br,
  Lr,
  Er,
  Rr,
  Or,
  Ir,
  Nr,
  Dr,
  Zr,
  Fr,
  Ur,
  Gr,
  zr,
  jr,
  $r,
  Wr,
  Xt3 as Xt,
  Yt,
  Kr,
  Xr,
  Yr,
  Qr,
  ti,
  ni,
  ri,
  ii,
  ci,
  ai,
  si,
  di,
  ui,
  ft,
  mi,
  bi,
  pi,
  Ci,
  ki,
  Hi,
  xi,
  yi,
  Ml,
  Li,
  Ee,
  ye,
  $e2 as $e,
  We,
  Ri,
  Oi,
  Qt2 as Qt,
  Ii,
  Pi,
  qe,
  Me,
  Ni,
  Ai,
  Di,
  Sl,
  Vl,
  en,
  Zi,
  Fi,
  Ui,
  Tl,
  _l,
  ji,
  $i,
  Wi,
  Bl,
  Ll,
  El,
  Rl,
  Ol,
  Ke,
  el,
  Ye,
  ol,
  rl,
  il,
  ll,
  tn,
  nn2 as nn,
  al,
  pt,
  Nl,
  Al,
  Dl,
  Zl,
  Fl,
  Oe2 as Oe,
  Ul,
  Gl,
  zl,
  jl
};
//# sourceMappingURL=chunk-4TPI7Y5U.js.map
