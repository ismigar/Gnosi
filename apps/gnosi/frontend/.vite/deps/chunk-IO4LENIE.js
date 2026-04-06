import {
  $n,
  $o,
  Ao2 as Ao,
  Be2 as Be,
  Bt,
  CellSelection,
  Co,
  D2 as D,
  Do,
  Dt,
  F,
  Fo,
  H2 as H,
  Ho2 as Ho,
  It,
  J,
  K2 as K,
  L,
  Lo2 as Lo,
  Lt,
  Mo2 as Mo,
  Mt,
  Mt2,
  No2 as No,
  O,
  Oe,
  Oe2,
  Oo,
  Ot,
  Po,
  Po2,
  Q,
  Q2,
  Ro,
  So,
  St,
  T,
  TableMap,
  Tt,
  Un,
  Uo,
  Vn,
  Vo,
  Wt2 as Wt,
  X2 as X,
  Y,
  Yo,
  Z,
  _o,
  a,
  ae,
  attention,
  autolink,
  b2 as b,
  blankLine,
  blockQuote,
  bo,
  bt,
  ccount,
  characterEscape,
  characterReference,
  codeFenced,
  codeIndented,
  codeText,
  codes,
  combineExtensions,
  constants,
  content,
  decodeNamedCharacterReference,
  decodeNumericCharacterReference,
  decodeString,
  definition,
  esm_default,
  factorySpace,
  find,
  go,
  gt,
  hardBreakEscape,
  headingAtx,
  ho,
  ht,
  html,
  htmlFlow,
  htmlText,
  jo,
  k,
  ko,
  kt,
  kt2,
  labelEnd,
  labelStartImage,
  labelStartLink,
  lineEnding,
  list,
  markdownLineEnding,
  mo,
  normalizeIdentifier,
  normalizeUri,
  ok,
  pointEnd,
  pointStart,
  position,
  push,
  r,
  remarkGfm,
  resolveAll,
  setextUnderline,
  splice,
  stringify,
  stringify2,
  stringifyPosition,
  subtokenize,
  svg,
  thematicBreak,
  toString,
  types,
  unified,
  v2 as v,
  values,
  visit,
  vo,
  whitespace,
  wo,
  wt,
  xo,
  yo,
  zwitch
} from "./chunk-ZCA3YKET.js";
import {
  find as find2,
  gapCursor,
  registerCustomProtocol,
  reset,
  tokenize
} from "./chunk-SV5GUQD3.js";
import {
  DOMParser,
  DOMSerializer,
  Editor,
  Extension,
  Fragment,
  Mark,
  Node,
  Node3,
  NodeSelection,
  Plugin,
  PluginKey,
  ReplaceAroundStep,
  ReplaceStep,
  Slice,
  TextSelection,
  callOrReturn,
  closeHistory,
  combineTransactionSteps,
  createDocument,
  extensions_exports,
  findChildrenInRange,
  findParentNodeClosestToPos,
  getAttributes,
  getChangedRanges,
  getExtensionField,
  getMarksBetween,
  getSchema,
  isNodeSelection,
  keymap,
  markPasteRule,
  mergeAttributes,
  posToDOMRect,
  selectionToInsertionEnd
} from "./chunk-V7Y3ZQ2C.js";
import {
  __commonJS,
  __export,
  __toESM
} from "./chunk-G3PMV62Z.js";

// node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/ms/index.js"(exports, module) {
    var s = 1e3;
    var m3 = s * 60;
    var h3 = m3 * 60;
    var d = h3 * 24;
    var w = d * 7;
    var y = d * 365.25;
    module.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse2(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse2(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n * y;
        case "weeks":
        case "week":
        case "w":
          return n * w;
        case "days":
        case "day":
        case "d":
          return n * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n * h3;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n * m3;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n;
        default:
          return void 0;
      }
    }
    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + "d";
      }
      if (msAbs >= h3) {
        return Math.round(ms / h3) + "h";
      }
      if (msAbs >= m3) {
        return Math.round(ms / m3) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + "s";
      }
      return ms + "ms";
    }
    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, "day");
      }
      if (msAbs >= h3) {
        return plural(ms, msAbs, h3, "hour");
      }
      if (msAbs >= m3) {
        return plural(ms, msAbs, m3, "minute");
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, "second");
      }
      return ms + " ms";
    }
    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS({
  "node_modules/debug/src/common.js"(exports, module) {
    function setup(env) {
      createDebug2.debug = createDebug2;
      createDebug2.default = createDebug2;
      createDebug2.coerce = coerce;
      createDebug2.disable = disable2;
      createDebug2.enable = enable;
      createDebug2.enabled = enabled;
      createDebug2.humanize = require_ms();
      createDebug2.destroy = destroy;
      Object.keys(env).forEach((key2) => {
        createDebug2[key2] = env[key2];
      });
      createDebug2.names = [];
      createDebug2.skips = [];
      createDebug2.formatters = {};
      function selectColor(namespace) {
        let hash = 0;
        for (let i3 = 0; i3 < namespace.length; i3++) {
          hash = (hash << 5) - hash + namespace.charCodeAt(i3);
          hash |= 0;
        }
        return createDebug2.colors[Math.abs(hash) % createDebug2.colors.length];
      }
      createDebug2.selectColor = selectColor;
      function createDebug2(namespace) {
        let prevTime;
        let enableOverride = null;
        let namespacesCache;
        let enabledCache;
        function debug2(...args) {
          if (!debug2.enabled) {
            return;
          }
          const self = debug2;
          const curr = Number(/* @__PURE__ */ new Date());
          const ms = curr - (prevTime || curr);
          self.diff = ms;
          self.prev = prevTime;
          self.curr = curr;
          prevTime = curr;
          args[0] = createDebug2.coerce(args[0]);
          if (typeof args[0] !== "string") {
            args.unshift("%O");
          }
          let index = 0;
          args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
            if (match === "%%") {
              return "%";
            }
            index++;
            const formatter = createDebug2.formatters[format];
            if (typeof formatter === "function") {
              const val = args[index];
              match = formatter.call(self, val);
              args.splice(index, 1);
              index--;
            }
            return match;
          });
          createDebug2.formatArgs.call(self, args);
          const logFn = self.log || createDebug2.log;
          logFn.apply(self, args);
        }
        debug2.namespace = namespace;
        debug2.useColors = createDebug2.useColors();
        debug2.color = createDebug2.selectColor(namespace);
        debug2.extend = extend;
        debug2.destroy = createDebug2.destroy;
        Object.defineProperty(debug2, "enabled", {
          enumerable: true,
          configurable: false,
          get: () => {
            if (enableOverride !== null) {
              return enableOverride;
            }
            if (namespacesCache !== createDebug2.namespaces) {
              namespacesCache = createDebug2.namespaces;
              enabledCache = createDebug2.enabled(namespace);
            }
            return enabledCache;
          },
          set: (v4) => {
            enableOverride = v4;
          }
        });
        if (typeof createDebug2.init === "function") {
          createDebug2.init(debug2);
        }
        return debug2;
      }
      function extend(namespace, delimiter) {
        const newDebug = createDebug2(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
        newDebug.log = this.log;
        return newDebug;
      }
      function enable(namespaces) {
        createDebug2.save(namespaces);
        createDebug2.namespaces = namespaces;
        createDebug2.names = [];
        createDebug2.skips = [];
        const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns of split) {
          if (ns[0] === "-") {
            createDebug2.skips.push(ns.slice(1));
          } else {
            createDebug2.names.push(ns);
          }
        }
      }
      function matchesTemplate(search2, template) {
        let searchIndex = 0;
        let templateIndex = 0;
        let starIndex = -1;
        let matchIndex = 0;
        while (searchIndex < search2.length) {
          if (templateIndex < template.length && (template[templateIndex] === search2[searchIndex] || template[templateIndex] === "*")) {
            if (template[templateIndex] === "*") {
              starIndex = templateIndex;
              matchIndex = searchIndex;
              templateIndex++;
            } else {
              searchIndex++;
              templateIndex++;
            }
          } else if (starIndex !== -1) {
            templateIndex = starIndex + 1;
            matchIndex++;
            searchIndex = matchIndex;
          } else {
            return false;
          }
        }
        while (templateIndex < template.length && template[templateIndex] === "*") {
          templateIndex++;
        }
        return templateIndex === template.length;
      }
      function disable2() {
        const namespaces = [
          ...createDebug2.names,
          ...createDebug2.skips.map((namespace) => "-" + namespace)
        ].join(",");
        createDebug2.enable("");
        return namespaces;
      }
      function enabled(name) {
        for (const skip of createDebug2.skips) {
          if (matchesTemplate(name, skip)) {
            return false;
          }
        }
        for (const ns of createDebug2.names) {
          if (matchesTemplate(name, ns)) {
            return true;
          }
        }
        return false;
      }
      function coerce(val) {
        if (val instanceof Error) {
          return val.stack || val.message;
        }
        return val;
      }
      function destroy() {
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
      createDebug2.enable(createDebug2.load());
      return createDebug2;
    }
    module.exports = setup;
  }
});

// node_modules/debug/src/browser.js
var require_browser = __commonJS({
  "node_modules/debug/src/browser.js"(exports, module) {
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m3;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m3 = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m3[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r2;
      try {
        r2 = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error) {
      }
      if (!r2 && typeof process !== "undefined" && "env" in process) {
        r2 = process.env.DEBUG;
      }
      return r2;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error) {
      }
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.j = function(v4) {
      try {
        return JSON.stringify(v4);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  }
});

// node_modules/@blocknote/core/dist/BlockNoteSchema-ooiKsd5B.js
var u = Object.defineProperty;
var k2 = (t2, e, n) => e in t2 ? u(t2, e, { enumerable: true, configurable: true, writable: true, value: n }) : t2[e] = n;
var i = (t2, e, n) => k2(t2, typeof e != "symbol" ? e + "" : e, n);
function E(t2) {
  const e = v2(t2);
  let { roots: n, nonRoots: r2 } = f(e);
  const s = [];
  for (; n.size; ) {
    s.push(n);
    const o = /* @__PURE__ */ new Set();
    for (const c of n) {
      const a2 = t2.get(c);
      if (a2)
        for (const l of a2) {
          const p2 = e.get(l);
          if (p2 === void 0)
            continue;
          const d = p2 - 1;
          e.set(l, d), d === 0 && o.add(l);
        }
    }
    n = o;
  }
  if (r2 = f(e).nonRoots, r2.size)
    throw new Error(
      `Cycle(s) detected; toposort only works on acyclic graphs. Cyclic nodes: ${Array.from(r2).join(", ")}`
    );
  return s;
}
function D2(t2) {
  const e = I(t2);
  return E(e);
}
function v2(t2) {
  const e = /* @__PURE__ */ new Map();
  for (const [n, r2] of t2.entries()) {
    e.has(n) || e.set(n, 0);
    for (const s of r2) {
      const o = e.get(s) ?? 0;
      e.set(s, o + 1);
    }
  }
  return e;
}
function f(t2) {
  const e = /* @__PURE__ */ new Set(), n = /* @__PURE__ */ new Set();
  for (const [r2, s] of t2.entries())
    s === 0 ? e.add(r2) : n.add(r2);
  return { roots: e, nonRoots: n };
}
function I(t2) {
  const e = /* @__PURE__ */ new Map();
  for (const [n, r2] of t2.entries()) {
    e.has(n) || e.set(n, /* @__PURE__ */ new Set());
    for (const s of r2)
      e.has(s) || e.set(s, /* @__PURE__ */ new Set()), e.get(s).add(n);
  }
  return e;
}
function A() {
  return /* @__PURE__ */ new Map();
}
function m(t2, e, n) {
  return t2.has(e) || t2.set(e, /* @__PURE__ */ new Set()), t2.get(e).add(n), t2;
}
function P(t2) {
  const e = A();
  for (const s of t2)
    Array.isArray(s.runsBefore) && s.runsBefore.length > 0 ? s.runsBefore.forEach((o) => {
      m(e, s.key, o);
    }) : m(e, "default", s.key);
  const n = D2(e), r2 = n.findIndex((s) => s.has("default"));
  return (s) => 91 + (n.findIndex((c) => c.has(s)) + r2) * 10;
}
function S(t2) {
  return t2 && Object.fromEntries(
    Object.entries(t2).filter(([, e]) => e !== void 0)
  );
}
var N = class {
  constructor(e) {
    i(this, "BlockNoteEditor", "only for types");
    i(this, "Block", "only for types");
    i(this, "PartialBlock", "only for types");
    i(this, "inlineContentSpecs");
    i(this, "styleSpecs");
    i(this, "blockSpecs");
    i(this, "blockSchema");
    i(this, "inlineContentSchema");
    i(this, "styleSchema");
    this.opts = e;
    const {
      blockSpecs: n,
      inlineContentSpecs: r2,
      styleSpecs: s,
      blockSchema: o,
      inlineContentSchema: c,
      styleSchema: a2
    } = this.init();
    this.blockSpecs = n, this.styleSpecs = s, this.styleSchema = a2, this.inlineContentSpecs = r2, this.blockSchema = o, this.inlineContentSchema = c;
  }
  init() {
    const e = P(
      Object.entries({
        ...this.opts.blockSpecs,
        ...this.opts.inlineContentSpecs,
        ...this.opts.styleSpecs
      }).map(([o, c]) => {
        var a2;
        return {
          key: o,
          runsBefore: ((a2 = c.implementation) == null ? void 0 : a2.runsBefore) ?? []
        };
      })
    ), n = Object.fromEntries(
      Object.entries(this.opts.blockSpecs).map(([o, c]) => [
        o,
        ho(
          c.config,
          c.implementation,
          c.extensions,
          e(o)
        )
      ])
    ), r2 = Object.fromEntries(
      Object.entries(this.opts.inlineContentSpecs).map(
        ([o, c]) => {
          var a2;
          return typeof c.config != "object" ? [o, c] : [
            o,
            {
              ...c,
              implementation: {
                ...c.implementation,
                node: (a2 = c.implementation) == null ? void 0 : a2.node.extend({
                  priority: e(o)
                })
              }
            }
          ];
        }
      )
    ), s = Object.fromEntries(
      Object.entries(this.opts.styleSpecs).map(([o, c]) => {
        var a2;
        return [
          o,
          {
            ...c,
            implementation: {
              ...c.implementation,
              mark: (a2 = c.implementation) == null ? void 0 : a2.mark.extend({
                priority: e(o)
              })
            }
          }
        ];
      })
    );
    return {
      blockSpecs: n,
      blockSchema: Object.fromEntries(
        Object.entries(n).map(([o, c]) => [o, c.config])
      ),
      inlineContentSpecs: S(r2),
      styleSpecs: S(s),
      inlineContentSchema: Mt(
        r2
      ),
      styleSchema: Lt(s)
    };
  }
  /**
   * Adds additional block specs to the current schema in a builder pattern.
   * This method allows extending the schema after it has been created.
   *
   * @param additionalBlockSpecs - Additional block specs to add to the schema
   * @returns The current schema instance for chaining
   */
  extend(e) {
    Object.assign(this.opts.blockSpecs, e.blockSpecs), Object.assign(this.opts.inlineContentSpecs, e.inlineContentSpecs), Object.assign(this.opts.styleSpecs, e.styleSpecs);
    const {
      blockSpecs: n,
      inlineContentSpecs: r2,
      styleSpecs: s,
      blockSchema: o,
      inlineContentSchema: c,
      styleSchema: a2
    } = this.init();
    return this.blockSpecs = n, this.styleSpecs = s, this.styleSchema = a2, this.inlineContentSpecs = r2, this.blockSchema = o, this.inlineContentSchema = c, this;
  }
};
var R = go(
  () => ({
    type: "pageBreak",
    propSchema: {},
    content: "none"
  })
);
var M = v(
  R,
  {
    parse(t2) {
      if (t2.tagName === "DIV" && t2.hasAttribute("data-page-break"))
        return {};
    },
    render() {
      const t2 = document.createElement("div");
      return t2.setAttribute("data-page-break", ""), {
        dom: t2
      };
    },
    toExternalHTML() {
      const t2 = document.createElement("div");
      return t2.setAttribute("data-page-break", ""), {
        dom: t2
      };
    }
  }
);
var z = (t2) => t2.extend({
  blockSpecs: {
    pageBreak: M()
  }
});
var L2 = async (t2) => {
  const e = new FormData();
  return e.append("file", t2), (await (await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: e
  })).json()).data.url.replace(
    "tmpfiles.org/",
    "tmpfiles.org/dl/"
  );
};
function F2(t2) {
  return "pageBreak" in t2.schema.blockSchema;
}
function U(t2) {
  const e = [];
  return F2(t2) && e.push({
    ...t2.dictionary.slash_menu.page_break,
    onItemClick: () => {
      k(t2, {
        type: "pageBreak"
      });
    },
    key: "page_break"
  }), e;
}
var h = class _h extends N {
  static create(e) {
    return new _h({
      blockSpecs: (e == null ? void 0 : e.blockSpecs) ?? Po,
      inlineContentSpecs: (e == null ? void 0 : e.inlineContentSpecs) ?? Un,
      styleSpecs: (e == null ? void 0 : e.styleSpecs) ?? $n
    });
  }
};

// node_modules/@blocknote/core/dist/EventEmitter-CjSwpTbz.js
var h2 = Object.defineProperty;
var b2 = (a2, s, l) => s in a2 ? h2(a2, s, { enumerable: true, configurable: true, writable: true, value: l }) : a2[s] = l;
var t = (a2, s, l) => b2(a2, typeof s != "symbol" ? s + "" : s, l);
var f2 = class {
  constructor() {
    t(this, "callbacks", {});
  }
  on(s, l) {
    return this.callbacks[s] || (this.callbacks[s] = []), this.callbacks[s].push(l), () => this.off(s, l);
  }
  emit(s, ...l) {
    const c = this.callbacks[s];
    c && c.forEach((i3) => i3.apply(this, l));
  }
  off(s, l) {
    const c = this.callbacks[s];
    c && (l ? this.callbacks[s] = c.filter((i3) => i3 !== l) : delete this.callbacks[s]);
  }
  removeAllListeners() {
    this.callbacks = {};
  }
};

// node_modules/@blocknote/core/dist/en-njEqD7AG.js
var i2 = {
  slash_menu: {
    heading: {
      title: "Heading 1",
      subtext: "Top-level heading",
      aliases: ["h", "heading1", "h1"],
      group: "Headings"
    },
    heading_2: {
      title: "Heading 2",
      subtext: "Key section heading",
      aliases: ["h2", "heading2", "subheading"],
      group: "Headings"
    },
    heading_3: {
      title: "Heading 3",
      subtext: "Subsection and group heading",
      aliases: ["h3", "heading3", "subheading"],
      group: "Headings"
    },
    heading_4: {
      title: "Heading 4",
      subtext: "Minor subsection heading",
      aliases: ["h4", "heading4", "subheading4"],
      group: "Subheadings"
    },
    heading_5: {
      title: "Heading 5",
      subtext: "Small subsection heading",
      aliases: ["h5", "heading5", "subheading5"],
      group: "Subheadings"
    },
    heading_6: {
      title: "Heading 6",
      subtext: "Lowest-level heading",
      aliases: ["h6", "heading6", "subheading6"],
      group: "Subheadings"
    },
    toggle_heading: {
      title: "Toggle Heading 1",
      subtext: "Toggleable top-level heading",
      aliases: ["h", "heading1", "h1", "collapsable"],
      group: "Subheadings"
    },
    toggle_heading_2: {
      title: "Toggle Heading 2",
      subtext: "Toggleable key section heading",
      aliases: ["h2", "heading2", "subheading", "collapsable"],
      group: "Subheadings"
    },
    toggle_heading_3: {
      title: "Toggle Heading 3",
      subtext: "Toggleable subsection and group heading",
      aliases: ["h3", "heading3", "subheading", "collapsable"],
      group: "Subheadings"
    },
    quote: {
      title: "Quote",
      subtext: "Quote or excerpt",
      aliases: ["quotation", "blockquote", "bq"],
      group: "Basic blocks"
    },
    toggle_list: {
      title: "Toggle List",
      subtext: "List with hideable sub-items",
      aliases: ["li", "list", "toggleList", "toggle list", "collapsable list"],
      group: "Basic blocks"
    },
    numbered_list: {
      title: "Numbered List",
      subtext: "List with ordered items",
      aliases: ["ol", "li", "list", "numberedlist", "numbered list"],
      group: "Basic blocks"
    },
    bullet_list: {
      title: "Bullet List",
      subtext: "List with unordered items",
      aliases: ["ul", "li", "list", "bulletlist", "bullet list"],
      group: "Basic blocks"
    },
    check_list: {
      title: "Check List",
      subtext: "List with checkboxes",
      aliases: [
        "ul",
        "li",
        "list",
        "checklist",
        "check list",
        "checked list",
        "checkbox"
      ],
      group: "Basic blocks"
    },
    paragraph: {
      title: "Paragraph",
      subtext: "The body of your document",
      aliases: ["p", "paragraph"],
      group: "Basic blocks"
    },
    code_block: {
      title: "Code Block",
      subtext: "Code block with syntax highlighting",
      aliases: ["code", "pre"],
      group: "Basic blocks"
    },
    page_break: {
      title: "Page Break",
      subtext: "Page separator",
      aliases: ["page", "break", "separator"],
      group: "Basic blocks"
    },
    table: {
      title: "Table",
      subtext: "Table with editable cells",
      aliases: ["table"],
      group: "Advanced"
    },
    image: {
      title: "Image",
      subtext: "Resizable image with caption",
      aliases: [
        "image",
        "imageUpload",
        "upload",
        "img",
        "picture",
        "media",
        "url"
      ],
      group: "Media"
    },
    video: {
      title: "Video",
      subtext: "Resizable video with caption",
      aliases: [
        "video",
        "videoUpload",
        "upload",
        "mp4",
        "film",
        "media",
        "url"
      ],
      group: "Media"
    },
    audio: {
      title: "Audio",
      subtext: "Embedded audio with caption",
      aliases: [
        "audio",
        "audioUpload",
        "upload",
        "mp3",
        "sound",
        "media",
        "url"
      ],
      group: "Media"
    },
    file: {
      title: "File",
      subtext: "Embedded file",
      aliases: ["file", "upload", "embed", "media", "url"],
      group: "Media"
    },
    emoji: {
      title: "Emoji",
      subtext: "Search for and insert an emoji",
      aliases: ["emoji", "emote", "emotion", "face"],
      group: "Others"
    },
    divider: {
      title: "Divider",
      subtext: "Visually divide blocks",
      aliases: ["divider", "hr", "line", "horizontal rule"],
      group: "Basic blocks"
    }
  },
  placeholders: {
    default: "Enter text or type '/' for commands",
    heading: "Heading",
    toggleListItem: "Toggle",
    bulletListItem: "List",
    numberedListItem: "List",
    checkListItem: "List",
    emptyDocument: void 0,
    new_comment: "Write a comment...",
    edit_comment: "Edit comment...",
    comment_reply: "Add comment..."
  },
  file_blocks: {
    add_button_text: {
      image: "Add image",
      video: "Add video",
      audio: "Add audio",
      file: "Add file"
    }
  },
  toggle_blocks: {
    add_block_button: "Empty toggle. Click to add a block."
  },
  // from react package:
  side_menu: {
    add_block_label: "Add block",
    drag_handle_label: "Open block menu"
  },
  drag_handle: {
    delete_menuitem: "Delete",
    colors_menuitem: "Colors",
    header_row_menuitem: "Header row",
    header_column_menuitem: "Header column"
  },
  table_handle: {
    delete_column_menuitem: "Delete column",
    delete_row_menuitem: "Delete row",
    add_left_menuitem: "Add column left",
    add_right_menuitem: "Add column right",
    add_above_menuitem: "Add row above",
    add_below_menuitem: "Add row below",
    split_cell_menuitem: "Split cell",
    merge_cells_menuitem: "Merge cells",
    background_color_menuitem: "Background color"
  },
  suggestion_menu: {
    no_items_title: "No items found"
  },
  color_picker: {
    text_title: "Text",
    background_title: "Background",
    colors: {
      default: "Default",
      gray: "Gray",
      brown: "Brown",
      red: "Red",
      orange: "Orange",
      yellow: "Yellow",
      green: "Green",
      blue: "Blue",
      purple: "Purple",
      pink: "Pink"
    }
  },
  formatting_toolbar: {
    bold: {
      tooltip: "Bold",
      secondary_tooltip: "Mod+B"
    },
    italic: {
      tooltip: "Italic",
      secondary_tooltip: "Mod+I"
    },
    underline: {
      tooltip: "Underline",
      secondary_tooltip: "Mod+U"
    },
    strike: {
      tooltip: "Strike",
      secondary_tooltip: "Mod+Shift+S"
    },
    code: {
      tooltip: "Code",
      secondary_tooltip: ""
    },
    colors: {
      tooltip: "Colors"
    },
    link: {
      tooltip: "Create link",
      secondary_tooltip: "Mod+K"
    },
    file_caption: {
      tooltip: "Edit caption",
      input_placeholder: "Edit caption"
    },
    file_replace: {
      tooltip: {
        image: "Replace image",
        video: "Replace video",
        audio: "Replace audio",
        file: "Replace file"
      }
    },
    file_rename: {
      tooltip: {
        image: "Rename image",
        video: "Rename video",
        audio: "Rename audio",
        file: "Rename file"
      },
      input_placeholder: {
        image: "Rename image",
        video: "Rename video",
        audio: "Rename audio",
        file: "Rename file"
      }
    },
    file_download: {
      tooltip: {
        image: "Download image",
        video: "Download video",
        audio: "Download audio",
        file: "Download file"
      }
    },
    file_delete: {
      tooltip: {
        image: "Delete image",
        video: "Delete video",
        audio: "Delete audio",
        file: "Delete file"
      }
    },
    file_preview_toggle: {
      tooltip: "Toggle preview"
    },
    nest: {
      tooltip: "Nest block",
      secondary_tooltip: "Tab"
    },
    unnest: {
      tooltip: "Unnest block",
      secondary_tooltip: "Shift+Tab"
    },
    align_left: {
      tooltip: "Align text left"
    },
    align_center: {
      tooltip: "Align text center"
    },
    align_right: {
      tooltip: "Align text right"
    },
    align_justify: {
      tooltip: "Justify text"
    },
    table_cell_merge: {
      tooltip: "Merge cells"
    },
    comment: {
      tooltip: "Add comment"
    }
  },
  file_panel: {
    upload: {
      title: "Upload",
      file_placeholder: {
        image: "Upload image",
        video: "Upload video",
        audio: "Upload audio",
        file: "Upload file"
      },
      upload_error: "Error: Upload failed"
    },
    embed: {
      title: "Embed",
      embed_button: {
        image: "Embed image",
        video: "Embed video",
        audio: "Embed audio",
        file: "Embed file"
      },
      url_placeholder: "Enter URL"
    }
  },
  link_toolbar: {
    delete: {
      tooltip: "Remove link"
    },
    edit: {
      text: "Edit link",
      tooltip: "Edit"
    },
    open: {
      tooltip: "Open in new tab"
    },
    form: {
      title_placeholder: "Edit title",
      url_placeholder: "Edit URL"
    }
  },
  comments: {
    edited: "edited",
    save_button_text: "Save",
    cancel_button_text: "Cancel",
    actions: {
      add_reaction: "Add reaction",
      resolve: "Resolve",
      edit_comment: "Edit comment",
      delete_comment: "Delete comment",
      more_actions: "More actions"
    },
    reactions: {
      reacted_by: "Reacted by"
    },
    sidebar: {
      marked_as_resolved: "Marked as resolved",
      more_replies: (e) => `${e} more replies`
    }
  },
  generic: {
    ctrl_shortcut: "Ctrl"
  }
};

// node_modules/@handlewithcare/prosemirror-inputrules/dist/inputrules.js
var InputRule = class {
  match;
  /// @internal
  handler;
  /// @internal
  undoable;
  inCode;
  inCodeMark;
  /// Create an input rule. The rule applies when the user typed
  /// something and the text directly in front of the cursor matches
  /// `match`, which should end with `$`.
  ///
  /// The `handler` can be a string, in which case the matched text, or
  /// the first matched group in the regexp, is replaced by that
  /// string.
  ///
  /// Or a it can be a function, which will be called with the match
  /// array produced by
  /// [`RegExp.exec`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/exec),
  /// as well as the start and end of the matched range, and which can
  /// return a [transaction](#state.Transaction) that describes the
  /// rule's effect, or null to indicate the input was not handled.
  constructor(match, handler, options = {}) {
    this.match = match;
    this.match = match;
    this.handler = typeof handler == "string" ? stringHandler(handler) : handler;
    this.undoable = options.undoable !== false;
    this.inCode = options.inCode || false;
    this.inCodeMark = options.inCodeMark !== false;
  }
};
function stringHandler(string3) {
  return function(state, match, start, end) {
    let insert = string3;
    if (match[1]) {
      let offset = match[0].lastIndexOf(match[1]);
      insert += match[0].slice(offset + match[1].length);
      start += offset;
      let cutOff = start - end;
      if (cutOff > 0) {
        insert = match[0].slice(offset - cutOff, offset) + insert;
        start = end;
      }
    }
    return state.tr.insertText(insert, start, end);
  };
}
var MAX_MATCH = 500;
function inputRules({ rules }) {
  let plugin = new Plugin({
    state: {
      init() {
        return null;
      },
      apply(tr2, prev) {
        let stored = tr2.getMeta(this);
        if (stored)
          return stored;
        return tr2.selectionSet || tr2.docChanged ? null : prev;
      }
    },
    props: {
      handleTextInput(view, from, to2, text5) {
        return run(view, from, to2, text5, rules, plugin);
      },
      handleDOMEvents: {
        compositionend: (view) => {
          setTimeout(() => {
            let { $cursor } = view.state.selection;
            if ($cursor)
              run(view, $cursor.pos, $cursor.pos, "", rules, plugin);
          });
        }
      }
    },
    isInputRules: true
  });
  return plugin;
}
function run(view, from, to2, text5, rules, plugin) {
  if (view.composing)
    return false;
  const insertTr = view.state.tr.insertText(text5, from, to2);
  const mappedFrom = insertTr.mapping.map(from);
  const mappedTo = insertTr.mapping.map(to2);
  let state = null, $from = insertTr.doc.resolve(mappedFrom);
  let textBefore = $from.parent.textBetween(Math.max(0, $from.parentOffset - MAX_MATCH), $from.parentOffset, null, "￼");
  for (let i3 = 0; i3 < rules.length; i3++) {
    let rule = rules[i3];
    if (!rule.inCodeMark && $from.marks().some((m3) => m3.type.spec.code))
      continue;
    if ($from.parent.type.spec.code) {
      if (!rule.inCode)
        continue;
    } else if (rule.inCode === "only") {
      continue;
    }
    let match = rule.match.exec(textBefore);
    if (!match || match[0].length < text5.length)
      continue;
    state ??= view.state.apply(insertTr);
    let tr2 = rule.handler(state, match, mappedFrom - match[0].length, mappedTo);
    if (!tr2)
      continue;
    view.dispatch(insertTr);
    view.dispatch(closeHistory(view.state.tr));
    if (rule.undoable)
      tr2.setMeta(plugin, {
        transform: tr2,
        from: mappedFrom,
        to: mappedTo,
        text: text5
      });
    view.dispatch(tr2);
    return true;
  }
  return false;
}

// node_modules/@handlewithcare/prosemirror-inputrules/dist/rules.js
var emDash = new InputRule(/--$/, "—", { inCodeMark: false });
var ellipsis = new InputRule(/\.\.\.$/, "…", { inCodeMark: false });
var openDoubleQuote = new InputRule(/(?:^|[\s\{\[\(\<'"\u2018\u201C])(")$/, "“", { inCodeMark: false });
var closeDoubleQuote = new InputRule(/"$/, "”", { inCodeMark: false });
var openSingleQuote = new InputRule(/(?:^|[\s\{\[\(\<'"\u2018\u201C])(')$/, "‘", { inCodeMark: false });
var closeSingleQuote = new InputRule(/'$/, "’", { inCodeMark: false });

// node_modules/@tiptap/extensions/dist/gap-cursor/index.js
var Gapcursor = Extension.create({
  name: "gapCursor",
  addProseMirrorPlugins() {
    return [gapCursor()];
  },
  extendNodeSchema(extension2) {
    var _a;
    const context = {
      name: extension2.name,
      options: extension2.options,
      storage: extension2.storage
    };
    return {
      allowGapCursor: (_a = callOrReturn(getExtensionField(extension2, "allowGapCursor", context))) != null ? _a : null
    };
  }
});

// node_modules/@blocknote/core/node_modules/@tiptap/extension-link/dist/index.js
var UNICODE_WHITESPACE_PATTERN = "[\0-   ᠎ -\u2029 　]";
var UNICODE_WHITESPACE_REGEX = new RegExp(UNICODE_WHITESPACE_PATTERN);
var UNICODE_WHITESPACE_REGEX_END = new RegExp(`${UNICODE_WHITESPACE_PATTERN}$`);
var UNICODE_WHITESPACE_REGEX_GLOBAL = new RegExp(UNICODE_WHITESPACE_PATTERN, "g");
function isValidLinkStructure(tokens) {
  if (tokens.length === 1) {
    return tokens[0].isLink;
  }
  if (tokens.length === 3 && tokens[1].isLink) {
    return ["()", "[]"].includes(tokens[0].value + tokens[2].value);
  }
  return false;
}
function autolink2(options) {
  return new Plugin({
    key: new PluginKey("autolink"),
    appendTransaction: (transactions, oldState, newState) => {
      const docChanges = transactions.some((transaction) => transaction.docChanged) && !oldState.doc.eq(newState.doc);
      const preventAutolink = transactions.some((transaction) => transaction.getMeta("preventAutolink"));
      if (!docChanges || preventAutolink) {
        return;
      }
      const { tr: tr2 } = newState;
      const transform = combineTransactionSteps(oldState.doc, [...transactions]);
      const changes = getChangedRanges(transform);
      changes.forEach(({ newRange }) => {
        const nodesInChangedRanges = findChildrenInRange(newState.doc, newRange, (node) => node.isTextblock);
        let textBlock;
        let textBeforeWhitespace;
        if (nodesInChangedRanges.length > 1) {
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(
            textBlock.pos,
            textBlock.pos + textBlock.node.nodeSize,
            void 0,
            " "
          );
        } else if (nodesInChangedRanges.length) {
          const endText = newState.doc.textBetween(newRange.from, newRange.to, " ", " ");
          if (!UNICODE_WHITESPACE_REGEX_END.test(endText)) {
            return;
          }
          textBlock = nodesInChangedRanges[0];
          textBeforeWhitespace = newState.doc.textBetween(textBlock.pos, newRange.to, void 0, " ");
        }
        if (textBlock && textBeforeWhitespace) {
          const wordsBeforeWhitespace = textBeforeWhitespace.split(UNICODE_WHITESPACE_REGEX).filter(Boolean);
          if (wordsBeforeWhitespace.length <= 0) {
            return false;
          }
          const lastWordBeforeSpace = wordsBeforeWhitespace[wordsBeforeWhitespace.length - 1];
          const lastWordAndBlockOffset = textBlock.pos + textBeforeWhitespace.lastIndexOf(lastWordBeforeSpace);
          if (!lastWordBeforeSpace) {
            return false;
          }
          const linksBeforeSpace = tokenize(lastWordBeforeSpace).map((t2) => t2.toObject(options.defaultProtocol));
          if (!isValidLinkStructure(linksBeforeSpace)) {
            return false;
          }
          linksBeforeSpace.filter((link2) => link2.isLink).map((link2) => ({
            ...link2,
            from: lastWordAndBlockOffset + link2.start + 1,
            to: lastWordAndBlockOffset + link2.end + 1
          })).filter((link2) => {
            if (!newState.schema.marks.code) {
              return true;
            }
            return !newState.doc.rangeHasMark(link2.from, link2.to, newState.schema.marks.code);
          }).filter((link2) => options.validate(link2.value)).filter((link2) => options.shouldAutoLink(link2.value)).forEach((link2) => {
            if (getMarksBetween(link2.from, link2.to, newState.doc).some((item) => item.mark.type === options.type)) {
              return;
            }
            tr2.addMark(
              link2.from,
              link2.to,
              options.type.create({
                href: link2.href
              })
            );
          });
        }
      });
      if (!tr2.steps.length) {
        return;
      }
      return tr2;
    }
  });
}
function clickHandler(options) {
  return new Plugin({
    key: new PluginKey("handleClickLink"),
    props: {
      handleClick: (view, pos, event) => {
        var _a, _b;
        if (event.button !== 0) {
          return false;
        }
        if (!view.editable) {
          return false;
        }
        let link2 = null;
        if (event.target instanceof HTMLAnchorElement) {
          link2 = event.target;
        } else {
          const target = event.target;
          if (!target) {
            return false;
          }
          const root3 = options.editor.view.dom;
          link2 = target.closest("a");
          if (link2 && !root3.contains(link2)) {
            link2 = null;
          }
        }
        if (!link2) {
          return false;
        }
        let handled = false;
        if (options.enableClickSelection) {
          const commandResult = options.editor.commands.extendMarkRange(options.type.name);
          handled = commandResult;
        }
        if (options.openOnClick) {
          const attrs = getAttributes(view.state, options.type.name);
          const href = (_a = link2.href) != null ? _a : attrs.href;
          const target = (_b = link2.target) != null ? _b : attrs.target;
          if (href) {
            window.open(href, target);
            handled = true;
          }
        }
        return handled;
      }
    }
  });
}
function pasteHandler(options) {
  return new Plugin({
    key: new PluginKey("handlePasteLink"),
    props: {
      handlePaste: (view, _event, slice) => {
        const { shouldAutoLink } = options;
        const { state } = view;
        const { selection } = state;
        const { empty } = selection;
        if (empty) {
          return false;
        }
        let textContent = "";
        slice.content.forEach((node) => {
          textContent += node.textContent;
        });
        const link2 = find2(textContent, { defaultProtocol: options.defaultProtocol }).find(
          (item) => item.isLink && item.value === textContent
        );
        if (!textContent || !link2 || shouldAutoLink !== void 0 && !shouldAutoLink(link2.value)) {
          return false;
        }
        return options.editor.commands.setMark(options.type, {
          href: link2.href
        });
      }
    }
  });
}
function isAllowedUri(uri, protocols) {
  const allowedProtocols = ["http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp"];
  if (protocols) {
    protocols.forEach((protocol) => {
      const nextProtocol = typeof protocol === "string" ? protocol : protocol.scheme;
      if (nextProtocol) {
        allowedProtocols.push(nextProtocol);
      }
    });
  }
  return !uri || uri.replace(UNICODE_WHITESPACE_REGEX_GLOBAL, "").match(
    new RegExp(
      // eslint-disable-next-line no-useless-escape
      `^(?:(?:${allowedProtocols.join("|")}):|[^a-z]|[a-z0-9+.-]+(?:[^a-z+.-:]|$))`,
      "i"
    )
  );
}
var Link = Mark.create({
  name: "link",
  priority: 1e3,
  keepOnSplit: false,
  exitable: true,
  onCreate() {
    if (this.options.validate && !this.options.shouldAutoLink) {
      this.options.shouldAutoLink = this.options.validate;
      console.warn("The `validate` option is deprecated. Rename to the `shouldAutoLink` option instead.");
    }
    this.options.protocols.forEach((protocol) => {
      if (typeof protocol === "string") {
        registerCustomProtocol(protocol);
        return;
      }
      registerCustomProtocol(protocol.scheme, protocol.optionalSlashes);
    });
  },
  onDestroy() {
    reset();
  },
  inclusive() {
    return this.options.autolink;
  },
  addOptions() {
    return {
      openOnClick: true,
      enableClickSelection: false,
      linkOnPaste: true,
      autolink: true,
      protocols: [],
      defaultProtocol: "http",
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
        class: null
      },
      isAllowedUri: (url, ctx) => !!isAllowedUri(url, ctx.protocols),
      validate: (url) => !!url,
      shouldAutoLink: (url) => {
        const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
        const hasMaybeProtocol = /^[a-z][a-z0-9+.-]*:/i.test(url);
        if (hasProtocol || hasMaybeProtocol && !url.includes("@")) {
          return true;
        }
        const urlWithoutUserinfo = url.includes("@") ? url.split("@").pop() : url;
        const hostname = urlWithoutUserinfo.split(/[/?#:]/)[0];
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
          return false;
        }
        if (!/\./.test(hostname)) {
          return false;
        }
        return true;
      }
    };
  },
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML(element2) {
          return element2.getAttribute("href");
        }
      },
      target: {
        default: this.options.HTMLAttributes.target
      },
      rel: {
        default: this.options.HTMLAttributes.rel
      },
      class: {
        default: this.options.HTMLAttributes.class
      },
      title: {
        default: null
      }
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (dom) => {
          const href = dom.getAttribute("href");
          if (!href || !this.options.isAllowedUri(href, {
            defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
            protocols: this.options.protocols,
            defaultProtocol: this.options.defaultProtocol
          })) {
            return false;
          }
          return null;
        }
      }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    if (!this.options.isAllowedUri(HTMLAttributes.href, {
      defaultValidate: (href) => !!isAllowedUri(href, this.options.protocols),
      protocols: this.options.protocols,
      defaultProtocol: this.options.defaultProtocol
    })) {
      return ["a", mergeAttributes(this.options.HTMLAttributes, { ...HTMLAttributes, href: "" }), 0];
    }
    return ["a", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
  markdownTokenName: "link",
  parseMarkdown: (token, helpers) => {
    return helpers.applyMark("link", helpers.parseInline(token.tokens || []), {
      href: token.href,
      title: token.title || null
    });
  },
  renderMarkdown: (node, h3) => {
    var _a, _b, _c, _d;
    const href = (_b = (_a = node.attrs) == null ? void 0 : _a.href) != null ? _b : "";
    const title = (_d = (_c = node.attrs) == null ? void 0 : _c.title) != null ? _d : "";
    const text5 = h3.renderChildren(node);
    return title ? `[${text5}](${href} "${title}")` : `[${text5}](${href})`;
  },
  addCommands() {
    return {
      setLink: (attributes) => ({ chain }) => {
        const { href } = attributes;
        if (!this.options.isAllowedUri(href, {
          defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
          protocols: this.options.protocols,
          defaultProtocol: this.options.defaultProtocol
        })) {
          return false;
        }
        return chain().setMark(this.name, attributes).setMeta("preventAutolink", true).run();
      },
      toggleLink: (attributes) => ({ chain }) => {
        const { href } = attributes || {};
        if (href && !this.options.isAllowedUri(href, {
          defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
          protocols: this.options.protocols,
          defaultProtocol: this.options.defaultProtocol
        })) {
          return false;
        }
        return chain().toggleMark(this.name, attributes, { extendEmptyMarkRange: true }).setMeta("preventAutolink", true).run();
      },
      unsetLink: () => ({ chain }) => {
        return chain().unsetMark(this.name, { extendEmptyMarkRange: true }).setMeta("preventAutolink", true).run();
      }
    };
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: (text5) => {
          const foundLinks = [];
          if (text5) {
            const { protocols, defaultProtocol } = this.options;
            const links = find2(text5).filter(
              (item) => item.isLink && this.options.isAllowedUri(item.value, {
                defaultValidate: (href) => !!isAllowedUri(href, protocols),
                protocols,
                defaultProtocol
              })
            );
            if (links.length) {
              links.forEach((link2) => {
                if (!this.options.shouldAutoLink(link2.value)) {
                  return;
                }
                foundLinks.push({
                  text: link2.value,
                  data: {
                    href: link2.href
                  },
                  index: link2.start
                });
              });
            }
          }
          return foundLinks;
        },
        type: this.type,
        getAttributes: (match) => {
          var _a;
          return {
            href: (_a = match.data) == null ? void 0 : _a.href
          };
        }
      })
    ];
  },
  addProseMirrorPlugins() {
    const plugins = [];
    const { protocols, defaultProtocol } = this.options;
    if (this.options.autolink) {
      plugins.push(
        autolink2({
          type: this.type,
          defaultProtocol: this.options.defaultProtocol,
          validate: (url) => this.options.isAllowedUri(url, {
            defaultValidate: (href) => !!isAllowedUri(href, protocols),
            protocols,
            defaultProtocol
          }),
          shouldAutoLink: this.options.shouldAutoLink
        })
      );
    }
    plugins.push(
      clickHandler({
        type: this.type,
        editor: this.editor,
        openOnClick: this.options.openOnClick === "whenNotEditable" ? true : this.options.openOnClick,
        enableClickSelection: this.options.enableClickSelection
      })
    );
    if (this.options.linkOnPaste) {
      plugins.push(
        pasteHandler({
          editor: this.editor,
          defaultProtocol: this.options.defaultProtocol,
          type: this.type,
          shouldAutoLink: this.options.shouldAutoLink
        })
      );
    }
    return plugins;
  }
});

// node_modules/@blocknote/core/node_modules/@tiptap/extension-text/dist/index.js
var Text = Node3.create({
  name: "text",
  group: "inline",
  parseMarkdown: (token) => {
    return {
      type: "text",
      text: token.text || ""
    };
  },
  renderMarkdown: (node) => node.text || ""
});

// node_modules/micromark/dev/lib/compile.js
var hasOwnProperty = {}.hasOwnProperty;

// node_modules/micromark/dev/lib/initialize/content.js
var content2 = { tokenize: initializeContent };
function initializeContent(effects) {
  const contentStart = effects.attempt(
    this.parser.constructs.contentInitial,
    afterContentStartConstruct,
    paragraphInitial
  );
  let previous;
  return contentStart;
  function afterContentStartConstruct(code2) {
    ok(
      code2 === codes.eof || markdownLineEnding(code2),
      "expected eol or eof"
    );
    if (code2 === codes.eof) {
      effects.consume(code2);
      return;
    }
    effects.enter(types.lineEnding);
    effects.consume(code2);
    effects.exit(types.lineEnding);
    return factorySpace(effects, contentStart, types.linePrefix);
  }
  function paragraphInitial(code2) {
    ok(
      code2 !== codes.eof && !markdownLineEnding(code2),
      "expected anything other than a line ending or EOF"
    );
    effects.enter(types.paragraph);
    return lineStart(code2);
  }
  function lineStart(code2) {
    const token = effects.enter(types.chunkText, {
      contentType: constants.contentTypeText,
      previous
    });
    if (previous) {
      previous.next = token;
    }
    previous = token;
    return data(code2);
  }
  function data(code2) {
    if (code2 === codes.eof) {
      effects.exit(types.chunkText);
      effects.exit(types.paragraph);
      effects.consume(code2);
      return;
    }
    if (markdownLineEnding(code2)) {
      effects.consume(code2);
      effects.exit(types.chunkText);
      return lineStart;
    }
    effects.consume(code2);
    return data;
  }
}

// node_modules/micromark/dev/lib/initialize/document.js
var document2 = { tokenize: initializeDocument };
var containerConstruct = { tokenize: tokenizeContainer };
function initializeDocument(effects) {
  const self = this;
  const stack = [];
  let continued = 0;
  let childFlow;
  let childToken;
  let lineStartOffset;
  return start;
  function start(code2) {
    if (continued < stack.length) {
      const item = stack[continued];
      self.containerState = item[1];
      ok(
        item[0].continuation,
        "expected `continuation` to be defined on container construct"
      );
      return effects.attempt(
        item[0].continuation,
        documentContinue,
        checkNewContainers
      )(code2);
    }
    return checkNewContainers(code2);
  }
  function documentContinue(code2) {
    ok(
      self.containerState,
      "expected `containerState` to be defined after continuation"
    );
    continued++;
    if (self.containerState._closeFlow) {
      self.containerState._closeFlow = void 0;
      if (childFlow) {
        closeFlow();
      }
      const indexBeforeExits = self.events.length;
      let indexBeforeFlow = indexBeforeExits;
      let point2;
      while (indexBeforeFlow--) {
        if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === types.chunkFlow) {
          point2 = self.events[indexBeforeFlow][1].end;
          break;
        }
      }
      ok(point2, "could not find previous flow chunk");
      exitContainers(continued);
      let index = indexBeforeExits;
      while (index < self.events.length) {
        self.events[index][1].end = { ...point2 };
        index++;
      }
      splice(
        self.events,
        indexBeforeFlow + 1,
        0,
        self.events.slice(indexBeforeExits)
      );
      self.events.length = index;
      return checkNewContainers(code2);
    }
    return start(code2);
  }
  function checkNewContainers(code2) {
    if (continued === stack.length) {
      if (!childFlow) {
        return documentContinued(code2);
      }
      if (childFlow.currentConstruct && childFlow.currentConstruct.concrete) {
        return flowStart(code2);
      }
      self.interrupt = Boolean(
        childFlow.currentConstruct && !childFlow._gfmTableDynamicInterruptHack
      );
    }
    self.containerState = {};
    return effects.check(
      containerConstruct,
      thereIsANewContainer,
      thereIsNoNewContainer
    )(code2);
  }
  function thereIsANewContainer(code2) {
    if (childFlow) closeFlow();
    exitContainers(continued);
    return documentContinued(code2);
  }
  function thereIsNoNewContainer(code2) {
    self.parser.lazy[self.now().line] = continued !== stack.length;
    lineStartOffset = self.now().offset;
    return flowStart(code2);
  }
  function documentContinued(code2) {
    self.containerState = {};
    return effects.attempt(
      containerConstruct,
      containerContinue,
      flowStart
    )(code2);
  }
  function containerContinue(code2) {
    ok(
      self.currentConstruct,
      "expected `currentConstruct` to be defined on tokenizer"
    );
    ok(
      self.containerState,
      "expected `containerState` to be defined on tokenizer"
    );
    continued++;
    stack.push([self.currentConstruct, self.containerState]);
    return documentContinued(code2);
  }
  function flowStart(code2) {
    if (code2 === codes.eof) {
      if (childFlow) closeFlow();
      exitContainers(0);
      effects.consume(code2);
      return;
    }
    childFlow = childFlow || self.parser.flow(self.now());
    effects.enter(types.chunkFlow, {
      _tokenizer: childFlow,
      contentType: constants.contentTypeFlow,
      previous: childToken
    });
    return flowContinue(code2);
  }
  function flowContinue(code2) {
    if (code2 === codes.eof) {
      writeToChild(effects.exit(types.chunkFlow), true);
      exitContainers(0);
      effects.consume(code2);
      return;
    }
    if (markdownLineEnding(code2)) {
      effects.consume(code2);
      writeToChild(effects.exit(types.chunkFlow));
      continued = 0;
      self.interrupt = void 0;
      return start;
    }
    effects.consume(code2);
    return flowContinue;
  }
  function writeToChild(token, endOfFile) {
    ok(childFlow, "expected `childFlow` to be defined when continuing");
    const stream = self.sliceStream(token);
    if (endOfFile) stream.push(null);
    token.previous = childToken;
    if (childToken) childToken.next = token;
    childToken = token;
    childFlow.defineSkip(token.start);
    childFlow.write(stream);
    if (self.parser.lazy[token.start.line]) {
      let index = childFlow.events.length;
      while (index--) {
        if (
          // The token starts before the line ending…
          childFlow.events[index][1].start.offset < lineStartOffset && // …and either is not ended yet…
          (!childFlow.events[index][1].end || // …or ends after it.
          childFlow.events[index][1].end.offset > lineStartOffset)
        ) {
          return;
        }
      }
      const indexBeforeExits = self.events.length;
      let indexBeforeFlow = indexBeforeExits;
      let seen;
      let point2;
      while (indexBeforeFlow--) {
        if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === types.chunkFlow) {
          if (seen) {
            point2 = self.events[indexBeforeFlow][1].end;
            break;
          }
          seen = true;
        }
      }
      ok(point2, "could not find previous flow chunk");
      exitContainers(continued);
      index = indexBeforeExits;
      while (index < self.events.length) {
        self.events[index][1].end = { ...point2 };
        index++;
      }
      splice(
        self.events,
        indexBeforeFlow + 1,
        0,
        self.events.slice(indexBeforeExits)
      );
      self.events.length = index;
    }
  }
  function exitContainers(size) {
    let index = stack.length;
    while (index-- > size) {
      const entry = stack[index];
      self.containerState = entry[1];
      ok(
        entry[0].exit,
        "expected `exit` to be defined on container construct"
      );
      entry[0].exit.call(self, effects);
    }
    stack.length = size;
  }
  function closeFlow() {
    ok(
      self.containerState,
      "expected `containerState` to be defined when closing flow"
    );
    ok(childFlow, "expected `childFlow` to be defined when closing it");
    childFlow.write([codes.eof]);
    childToken = void 0;
    childFlow = void 0;
    self.containerState._closeFlow = void 0;
  }
}
function tokenizeContainer(effects, ok2, nok) {
  ok(
    this.parser.constructs.disable.null,
    "expected `disable.null` to be populated"
  );
  return factorySpace(
    effects,
    effects.attempt(this.parser.constructs.document, ok2, nok),
    types.linePrefix,
    this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : constants.tabSize
  );
}

// node_modules/micromark/dev/lib/initialize/flow.js
var flow = { tokenize: initializeFlow };
function initializeFlow(effects) {
  const self = this;
  const initial = effects.attempt(
    // Try to parse a blank line.
    blankLine,
    atBlankEnding,
    // Try to parse initial flow (essentially, only code).
    effects.attempt(
      this.parser.constructs.flowInitial,
      afterConstruct,
      factorySpace(
        effects,
        effects.attempt(
          this.parser.constructs.flow,
          afterConstruct,
          effects.attempt(content, afterConstruct)
        ),
        types.linePrefix
      )
    )
  );
  return initial;
  function atBlankEnding(code2) {
    ok(
      code2 === codes.eof || markdownLineEnding(code2),
      "expected eol or eof"
    );
    if (code2 === codes.eof) {
      effects.consume(code2);
      return;
    }
    effects.enter(types.lineEndingBlank);
    effects.consume(code2);
    effects.exit(types.lineEndingBlank);
    self.currentConstruct = void 0;
    return initial;
  }
  function afterConstruct(code2) {
    ok(
      code2 === codes.eof || markdownLineEnding(code2),
      "expected eol or eof"
    );
    if (code2 === codes.eof) {
      effects.consume(code2);
      return;
    }
    effects.enter(types.lineEnding);
    effects.consume(code2);
    effects.exit(types.lineEnding);
    self.currentConstruct = void 0;
    return initial;
  }
}

// node_modules/micromark/dev/lib/initialize/text.js
var resolver = { resolveAll: createResolver() };
var string = initializeFactory("string");
var text = initializeFactory("text");
function initializeFactory(field) {
  return {
    resolveAll: createResolver(
      field === "text" ? resolveAllLineSuffixes : void 0
    ),
    tokenize: initializeText
  };
  function initializeText(effects) {
    const self = this;
    const constructs = this.parser.constructs[field];
    const text5 = effects.attempt(constructs, start, notText);
    return start;
    function start(code2) {
      return atBreak(code2) ? text5(code2) : notText(code2);
    }
    function notText(code2) {
      if (code2 === codes.eof) {
        effects.consume(code2);
        return;
      }
      effects.enter(types.data);
      effects.consume(code2);
      return data;
    }
    function data(code2) {
      if (atBreak(code2)) {
        effects.exit(types.data);
        return text5(code2);
      }
      effects.consume(code2);
      return data;
    }
    function atBreak(code2) {
      if (code2 === codes.eof) {
        return true;
      }
      const list3 = constructs[code2];
      let index = -1;
      if (list3) {
        ok(Array.isArray(list3), "expected `disable.null` to be populated");
        while (++index < list3.length) {
          const item = list3[index];
          if (!item.previous || item.previous.call(self, self.previous)) {
            return true;
          }
        }
      }
      return false;
    }
  }
}
function createResolver(extraResolver) {
  return resolveAllText;
  function resolveAllText(events, context) {
    let index = -1;
    let enter;
    while (++index <= events.length) {
      if (enter === void 0) {
        if (events[index] && events[index][1].type === types.data) {
          enter = index;
          index++;
        }
      } else if (!events[index] || events[index][1].type !== types.data) {
        if (index !== enter + 2) {
          events[enter][1].end = events[index - 1][1].end;
          events.splice(enter + 2, index - enter - 2);
          index = enter + 2;
        }
        enter = void 0;
      }
    }
    return extraResolver ? extraResolver(events, context) : events;
  }
}
function resolveAllLineSuffixes(events, context) {
  let eventIndex = 0;
  while (++eventIndex <= events.length) {
    if ((eventIndex === events.length || events[eventIndex][1].type === types.lineEnding) && events[eventIndex - 1][1].type === types.data) {
      const data = events[eventIndex - 1][1];
      const chunks = context.sliceStream(data);
      let index = chunks.length;
      let bufferIndex = -1;
      let size = 0;
      let tabs;
      while (index--) {
        const chunk = chunks[index];
        if (typeof chunk === "string") {
          bufferIndex = chunk.length;
          while (chunk.charCodeAt(bufferIndex - 1) === codes.space) {
            size++;
            bufferIndex--;
          }
          if (bufferIndex) break;
          bufferIndex = -1;
        } else if (chunk === codes.horizontalTab) {
          tabs = true;
          size++;
        } else if (chunk === codes.virtualSpace) {
        } else {
          index++;
          break;
        }
      }
      if (context._contentTypeTextTrailing && eventIndex === events.length) {
        size = 0;
      }
      if (size) {
        const token = {
          type: eventIndex === events.length || tabs || size < constants.hardBreakPrefixSizeMin ? types.lineSuffix : types.hardBreakTrailing,
          start: {
            _bufferIndex: index ? bufferIndex : data.start._bufferIndex + bufferIndex,
            _index: data.start._index + index,
            line: data.end.line,
            column: data.end.column - size,
            offset: data.end.offset - size
          },
          end: { ...data.end }
        };
        data.end = { ...token.start };
        if (data.start.offset === data.end.offset) {
          Object.assign(data, token);
        } else {
          events.splice(
            eventIndex,
            0,
            ["enter", token, context],
            ["exit", token, context]
          );
          eventIndex += 2;
        }
      }
      eventIndex++;
    }
  }
  return events;
}

// node_modules/micromark/dev/lib/constructs.js
var constructs_exports = {};
__export(constructs_exports, {
  attentionMarkers: () => attentionMarkers,
  contentInitial: () => contentInitial,
  disable: () => disable,
  document: () => document3,
  flow: () => flow2,
  flowInitial: () => flowInitial,
  insideSpan: () => insideSpan,
  string: () => string2,
  text: () => text2
});
var document3 = {
  [codes.asterisk]: list,
  [codes.plusSign]: list,
  [codes.dash]: list,
  [codes.digit0]: list,
  [codes.digit1]: list,
  [codes.digit2]: list,
  [codes.digit3]: list,
  [codes.digit4]: list,
  [codes.digit5]: list,
  [codes.digit6]: list,
  [codes.digit7]: list,
  [codes.digit8]: list,
  [codes.digit9]: list,
  [codes.greaterThan]: blockQuote
};
var contentInitial = {
  [codes.leftSquareBracket]: definition
};
var flowInitial = {
  [codes.horizontalTab]: codeIndented,
  [codes.virtualSpace]: codeIndented,
  [codes.space]: codeIndented
};
var flow2 = {
  [codes.numberSign]: headingAtx,
  [codes.asterisk]: thematicBreak,
  [codes.dash]: [setextUnderline, thematicBreak],
  [codes.lessThan]: htmlFlow,
  [codes.equalsTo]: setextUnderline,
  [codes.underscore]: thematicBreak,
  [codes.graveAccent]: codeFenced,
  [codes.tilde]: codeFenced
};
var string2 = {
  [codes.ampersand]: characterReference,
  [codes.backslash]: characterEscape
};
var text2 = {
  [codes.carriageReturn]: lineEnding,
  [codes.lineFeed]: lineEnding,
  [codes.carriageReturnLineFeed]: lineEnding,
  [codes.exclamationMark]: labelStartImage,
  [codes.ampersand]: characterReference,
  [codes.asterisk]: attention,
  [codes.lessThan]: [autolink, htmlText],
  [codes.leftSquareBracket]: labelStartLink,
  [codes.backslash]: [hardBreakEscape, characterEscape],
  [codes.rightSquareBracket]: labelEnd,
  [codes.underscore]: attention,
  [codes.graveAccent]: codeText
};
var insideSpan = { null: [attention, resolver] };
var attentionMarkers = { null: [codes.asterisk, codes.underscore] };
var disable = { null: [] };

// node_modules/micromark/dev/lib/create-tokenizer.js
var import_debug = __toESM(require_browser(), 1);
var debug = (0, import_debug.default)("micromark");
function createTokenizer(parser, initialize, from) {
  let point2 = {
    _bufferIndex: -1,
    _index: 0,
    line: from && from.line || 1,
    column: from && from.column || 1,
    offset: from && from.offset || 0
  };
  const columnStart = {};
  const resolveAllConstructs = [];
  let chunks = [];
  let stack = [];
  let consumed = true;
  const effects = {
    attempt: constructFactory(onsuccessfulconstruct),
    check: constructFactory(onsuccessfulcheck),
    consume,
    enter,
    exit,
    interrupt: constructFactory(onsuccessfulcheck, { interrupt: true })
  };
  const context = {
    code: codes.eof,
    containerState: {},
    defineSkip,
    events: [],
    now,
    parser,
    previous: codes.eof,
    sliceSerialize,
    sliceStream,
    write
  };
  let state = initialize.tokenize.call(context, effects);
  let expectedCode;
  if (initialize.resolveAll) {
    resolveAllConstructs.push(initialize);
  }
  return context;
  function write(slice) {
    chunks = push(chunks, slice);
    main();
    if (chunks[chunks.length - 1] !== codes.eof) {
      return [];
    }
    addResult(initialize, 0);
    context.events = resolveAll(resolveAllConstructs, context.events, context);
    return context.events;
  }
  function sliceSerialize(token, expandTabs) {
    return serializeChunks(sliceStream(token), expandTabs);
  }
  function sliceStream(token) {
    return sliceChunks(chunks, token);
  }
  function now() {
    const { _bufferIndex, _index, line, column, offset } = point2;
    return { _bufferIndex, _index, line, column, offset };
  }
  function defineSkip(value) {
    columnStart[value.line] = value.column;
    accountForPotentialSkip();
    debug("position: define skip: `%j`", point2);
  }
  function main() {
    let chunkIndex;
    while (point2._index < chunks.length) {
      const chunk = chunks[point2._index];
      if (typeof chunk === "string") {
        chunkIndex = point2._index;
        if (point2._bufferIndex < 0) {
          point2._bufferIndex = 0;
        }
        while (point2._index === chunkIndex && point2._bufferIndex < chunk.length) {
          go3(chunk.charCodeAt(point2._bufferIndex));
        }
      } else {
        go3(chunk);
      }
    }
  }
  function go3(code2) {
    ok(consumed === true, "expected character to be consumed");
    consumed = void 0;
    debug("main: passing `%s` to %s", code2, state && state.name);
    expectedCode = code2;
    ok(typeof state === "function", "expected state");
    state = state(code2);
  }
  function consume(code2) {
    ok(code2 === expectedCode, "expected given code to equal expected code");
    debug("consume: `%s`", code2);
    ok(
      consumed === void 0,
      "expected code to not have been consumed: this might be because `return x(code)` instead of `return x` was used"
    );
    ok(
      code2 === null ? context.events.length === 0 || context.events[context.events.length - 1][0] === "exit" : context.events[context.events.length - 1][0] === "enter",
      "expected last token to be open"
    );
    if (markdownLineEnding(code2)) {
      point2.line++;
      point2.column = 1;
      point2.offset += code2 === codes.carriageReturnLineFeed ? 2 : 1;
      accountForPotentialSkip();
      debug("position: after eol: `%j`", point2);
    } else if (code2 !== codes.virtualSpace) {
      point2.column++;
      point2.offset++;
    }
    if (point2._bufferIndex < 0) {
      point2._index++;
    } else {
      point2._bufferIndex++;
      if (point2._bufferIndex === // Points w/ non-negative `_bufferIndex` reference
      // strings.
      /** @type {string} */
      chunks[point2._index].length) {
        point2._bufferIndex = -1;
        point2._index++;
      }
    }
    context.previous = code2;
    consumed = true;
  }
  function enter(type, fields) {
    const token = fields || {};
    token.type = type;
    token.start = now();
    ok(typeof type === "string", "expected string type");
    ok(type.length > 0, "expected non-empty string");
    debug("enter: `%s`", type);
    context.events.push(["enter", token, context]);
    stack.push(token);
    return token;
  }
  function exit(type) {
    ok(typeof type === "string", "expected string type");
    ok(type.length > 0, "expected non-empty string");
    const token = stack.pop();
    ok(token, "cannot close w/o open tokens");
    token.end = now();
    ok(type === token.type, "expected exit token to match current token");
    ok(
      !(token.start._index === token.end._index && token.start._bufferIndex === token.end._bufferIndex),
      "expected non-empty token (`" + type + "`)"
    );
    debug("exit: `%s`", token.type);
    context.events.push(["exit", token, context]);
    return token;
  }
  function onsuccessfulconstruct(construct, info) {
    addResult(construct, info.from);
  }
  function onsuccessfulcheck(_3, info) {
    info.restore();
  }
  function constructFactory(onreturn, fields) {
    return hook;
    function hook(constructs, returnState, bogusState) {
      let listOfConstructs;
      let constructIndex;
      let currentConstruct;
      let info;
      return Array.isArray(constructs) ? (
        /* c8 ignore next 1 */
        handleListOfConstructs(constructs)
      ) : "tokenize" in constructs ? (
        // Looks like a construct.
        handleListOfConstructs([
          /** @type {Construct} */
          constructs
        ])
      ) : handleMapOfConstructs(constructs);
      function handleMapOfConstructs(map) {
        return start;
        function start(code2) {
          const left = code2 !== null && map[code2];
          const all2 = code2 !== null && map.null;
          const list3 = [
            // To do: add more extension tests.
            /* c8 ignore next 2 */
            ...Array.isArray(left) ? left : left ? [left] : [],
            ...Array.isArray(all2) ? all2 : all2 ? [all2] : []
          ];
          return handleListOfConstructs(list3)(code2);
        }
      }
      function handleListOfConstructs(list3) {
        listOfConstructs = list3;
        constructIndex = 0;
        if (list3.length === 0) {
          ok(bogusState, "expected `bogusState` to be given");
          return bogusState;
        }
        return handleConstruct(list3[constructIndex]);
      }
      function handleConstruct(construct) {
        return start;
        function start(code2) {
          info = store();
          currentConstruct = construct;
          if (!construct.partial) {
            context.currentConstruct = construct;
          }
          ok(
            context.parser.constructs.disable.null,
            "expected `disable.null` to be populated"
          );
          if (construct.name && context.parser.constructs.disable.null.includes(construct.name)) {
            return nok(code2);
          }
          return construct.tokenize.call(
            // If we do have fields, create an object w/ `context` as its
            // prototype.
            // This allows a “live binding”, which is needed for `interrupt`.
            fields ? Object.assign(Object.create(context), fields) : context,
            effects,
            ok2,
            nok
          )(code2);
        }
      }
      function ok2(code2) {
        ok(code2 === expectedCode, "expected code");
        consumed = true;
        onreturn(currentConstruct, info);
        return returnState;
      }
      function nok(code2) {
        ok(code2 === expectedCode, "expected code");
        consumed = true;
        info.restore();
        if (++constructIndex < listOfConstructs.length) {
          return handleConstruct(listOfConstructs[constructIndex]);
        }
        return bogusState;
      }
    }
  }
  function addResult(construct, from2) {
    if (construct.resolveAll && !resolveAllConstructs.includes(construct)) {
      resolveAllConstructs.push(construct);
    }
    if (construct.resolve) {
      splice(
        context.events,
        from2,
        context.events.length - from2,
        construct.resolve(context.events.slice(from2), context)
      );
    }
    if (construct.resolveTo) {
      context.events = construct.resolveTo(context.events, context);
    }
    ok(
      construct.partial || context.events.length === 0 || context.events[context.events.length - 1][0] === "exit",
      "expected last token to end"
    );
  }
  function store() {
    const startPoint = now();
    const startPrevious = context.previous;
    const startCurrentConstruct = context.currentConstruct;
    const startEventsIndex = context.events.length;
    const startStack = Array.from(stack);
    return { from: startEventsIndex, restore };
    function restore() {
      point2 = startPoint;
      context.previous = startPrevious;
      context.currentConstruct = startCurrentConstruct;
      context.events.length = startEventsIndex;
      stack = startStack;
      accountForPotentialSkip();
      debug("position: restore: `%j`", point2);
    }
  }
  function accountForPotentialSkip() {
    if (point2.line in columnStart && point2.column < 2) {
      point2.column = columnStart[point2.line];
      point2.offset += columnStart[point2.line] - 1;
    }
  }
}
function sliceChunks(chunks, token) {
  const startIndex = token.start._index;
  const startBufferIndex = token.start._bufferIndex;
  const endIndex = token.end._index;
  const endBufferIndex = token.end._bufferIndex;
  let view;
  if (startIndex === endIndex) {
    ok(endBufferIndex > -1, "expected non-negative end buffer index");
    ok(startBufferIndex > -1, "expected non-negative start buffer index");
    view = [chunks[startIndex].slice(startBufferIndex, endBufferIndex)];
  } else {
    view = chunks.slice(startIndex, endIndex);
    if (startBufferIndex > -1) {
      const head2 = view[0];
      if (typeof head2 === "string") {
        view[0] = head2.slice(startBufferIndex);
      } else {
        ok(startBufferIndex === 0, "expected `startBufferIndex` to be `0`");
        view.shift();
      }
    }
    if (endBufferIndex > 0) {
      view.push(chunks[endIndex].slice(0, endBufferIndex));
    }
  }
  return view;
}
function serializeChunks(chunks, expandTabs) {
  let index = -1;
  const result = [];
  let atTab;
  while (++index < chunks.length) {
    const chunk = chunks[index];
    let value;
    if (typeof chunk === "string") {
      value = chunk;
    } else
      switch (chunk) {
        case codes.carriageReturn: {
          value = values.cr;
          break;
        }
        case codes.lineFeed: {
          value = values.lf;
          break;
        }
        case codes.carriageReturnLineFeed: {
          value = values.cr + values.lf;
          break;
        }
        case codes.horizontalTab: {
          value = expandTabs ? values.space : values.ht;
          break;
        }
        case codes.virtualSpace: {
          if (!expandTabs && atTab) continue;
          value = values.space;
          break;
        }
        default: {
          ok(typeof chunk === "number", "expected number");
          value = String.fromCharCode(chunk);
        }
      }
    atTab = chunk === codes.horizontalTab;
    result.push(value);
  }
  return result.join("");
}

// node_modules/micromark/dev/lib/parse.js
function parse(options) {
  const settings = options || {};
  const constructs = (
    /** @type {FullNormalizedExtension} */
    combineExtensions([constructs_exports, ...settings.extensions || []])
  );
  const parser = {
    constructs,
    content: create(content2),
    defined: [],
    document: create(document2),
    flow: create(flow),
    lazy: {},
    string: create(string),
    text: create(text)
  };
  return parser;
  function create(initial) {
    return creator;
    function creator(from) {
      return createTokenizer(parser, initial, from);
    }
  }
}

// node_modules/micromark/dev/lib/postprocess.js
function postprocess(events) {
  while (!subtokenize(events)) {
  }
  return events;
}

// node_modules/micromark/dev/lib/preprocess.js
var search = /[\0\t\n\r]/g;
function preprocess() {
  let column = 1;
  let buffer = "";
  let start = true;
  let atCarriageReturn;
  return preprocessor;
  function preprocessor(value, encoding, end) {
    const chunks = [];
    let match;
    let next;
    let startPosition;
    let endPosition;
    let code2;
    value = buffer + (typeof value === "string" ? value.toString() : new TextDecoder(encoding || void 0).decode(value));
    startPosition = 0;
    buffer = "";
    if (start) {
      if (value.charCodeAt(0) === codes.byteOrderMarker) {
        startPosition++;
      }
      start = void 0;
    }
    while (startPosition < value.length) {
      search.lastIndex = startPosition;
      match = search.exec(value);
      endPosition = match && match.index !== void 0 ? match.index : value.length;
      code2 = value.charCodeAt(endPosition);
      if (!match) {
        buffer = value.slice(startPosition);
        break;
      }
      if (code2 === codes.lf && startPosition === endPosition && atCarriageReturn) {
        chunks.push(codes.carriageReturnLineFeed);
        atCarriageReturn = void 0;
      } else {
        if (atCarriageReturn) {
          chunks.push(codes.carriageReturn);
          atCarriageReturn = void 0;
        }
        if (startPosition < endPosition) {
          chunks.push(value.slice(startPosition, endPosition));
          column += endPosition - startPosition;
        }
        switch (code2) {
          case codes.nul: {
            chunks.push(codes.replacementCharacter);
            column++;
            break;
          }
          case codes.ht: {
            next = Math.ceil(column / constants.tabSize) * constants.tabSize;
            chunks.push(codes.horizontalTab);
            while (column++ < next) chunks.push(codes.virtualSpace);
            break;
          }
          case codes.lf: {
            chunks.push(codes.lineFeed);
            column = 1;
            break;
          }
          default: {
            atCarriageReturn = true;
            column = 1;
          }
        }
      }
      startPosition = endPosition + 1;
    }
    if (end) {
      if (atCarriageReturn) chunks.push(codes.carriageReturn);
      if (buffer) chunks.push(buffer);
      chunks.push(codes.eof);
    }
    return chunks;
  }
}

// node_modules/mdast-util-from-markdown/dev/lib/index.js
var own = {}.hasOwnProperty;
function fromMarkdown(value, encoding, options) {
  if (encoding && typeof encoding === "object") {
    options = encoding;
    encoding = void 0;
  }
  return compiler(options)(
    postprocess(
      parse(options).document().write(preprocess()(value, encoding, true))
    )
  );
}
function compiler(options) {
  const config = {
    transforms: [],
    canContainEols: ["emphasis", "fragment", "heading", "paragraph", "strong"],
    enter: {
      autolink: opener(link2),
      autolinkProtocol: onenterdata,
      autolinkEmail: onenterdata,
      atxHeading: opener(heading2),
      blockQuote: opener(blockQuote2),
      characterEscape: onenterdata,
      characterReference: onenterdata,
      codeFenced: opener(codeFlow),
      codeFencedFenceInfo: buffer,
      codeFencedFenceMeta: buffer,
      codeIndented: opener(codeFlow, buffer),
      codeText: opener(codeText2, buffer),
      codeTextData: onenterdata,
      data: onenterdata,
      codeFlowValue: onenterdata,
      definition: opener(definition2),
      definitionDestinationString: buffer,
      definitionLabelString: buffer,
      definitionTitleString: buffer,
      emphasis: opener(emphasis2),
      hardBreakEscape: opener(hardBreak2),
      hardBreakTrailing: opener(hardBreak2),
      htmlFlow: opener(html5, buffer),
      htmlFlowData: onenterdata,
      htmlText: opener(html5, buffer),
      htmlTextData: onenterdata,
      image: opener(image2),
      label: buffer,
      link: opener(link2),
      listItem: opener(listItem2),
      listItemValue: onenterlistitemvalue,
      listOrdered: opener(list3, onenterlistordered),
      listUnordered: opener(list3),
      paragraph: opener(paragraph2),
      reference: onenterreference,
      referenceString: buffer,
      resourceDestinationString: buffer,
      resourceTitleString: buffer,
      setextHeading: opener(heading2),
      strong: opener(strong2),
      thematicBreak: opener(thematicBreak3)
    },
    exit: {
      atxHeading: closer(),
      atxHeadingSequence: onexitatxheadingsequence,
      autolink: closer(),
      autolinkEmail: onexitautolinkemail,
      autolinkProtocol: onexitautolinkprotocol,
      blockQuote: closer(),
      characterEscapeValue: onexitdata,
      characterReferenceMarkerHexadecimal: onexitcharacterreferencemarker,
      characterReferenceMarkerNumeric: onexitcharacterreferencemarker,
      characterReferenceValue: onexitcharacterreferencevalue,
      characterReference: onexitcharacterreference,
      codeFenced: closer(onexitcodefenced),
      codeFencedFence: onexitcodefencedfence,
      codeFencedFenceInfo: onexitcodefencedfenceinfo,
      codeFencedFenceMeta: onexitcodefencedfencemeta,
      codeFlowValue: onexitdata,
      codeIndented: closer(onexitcodeindented),
      codeText: closer(onexitcodetext),
      codeTextData: onexitdata,
      data: onexitdata,
      definition: closer(),
      definitionDestinationString: onexitdefinitiondestinationstring,
      definitionLabelString: onexitdefinitionlabelstring,
      definitionTitleString: onexitdefinitiontitlestring,
      emphasis: closer(),
      hardBreakEscape: closer(onexithardbreak),
      hardBreakTrailing: closer(onexithardbreak),
      htmlFlow: closer(onexithtmlflow),
      htmlFlowData: onexitdata,
      htmlText: closer(onexithtmltext),
      htmlTextData: onexitdata,
      image: closer(onexitimage),
      label: onexitlabel,
      labelText: onexitlabeltext,
      lineEnding: onexitlineending,
      link: closer(onexitlink),
      listItem: closer(),
      listOrdered: closer(),
      listUnordered: closer(),
      paragraph: closer(),
      referenceString: onexitreferencestring,
      resourceDestinationString: onexitresourcedestinationstring,
      resourceTitleString: onexitresourcetitlestring,
      resource: onexitresource,
      setextHeading: closer(onexitsetextheading),
      setextHeadingLineSequence: onexitsetextheadinglinesequence,
      setextHeadingText: onexitsetextheadingtext,
      strong: closer(),
      thematicBreak: closer()
    }
  };
  configure(config, (options || {}).mdastExtensions || []);
  const data = {};
  return compile2;
  function compile2(events) {
    let tree = { type: "root", children: [] };
    const context = {
      stack: [tree],
      tokenStack: [],
      config,
      enter,
      exit,
      buffer,
      resume,
      data
    };
    const listStack = [];
    let index = -1;
    while (++index < events.length) {
      if (events[index][1].type === types.listOrdered || events[index][1].type === types.listUnordered) {
        if (events[index][0] === "enter") {
          listStack.push(index);
        } else {
          const tail = listStack.pop();
          ok(typeof tail === "number", "expected list to be open");
          index = prepareList(events, tail, index);
        }
      }
    }
    index = -1;
    while (++index < events.length) {
      const handler = config[events[index][0]];
      if (own.call(handler, events[index][1].type)) {
        handler[events[index][1].type].call(
          Object.assign(
            { sliceSerialize: events[index][2].sliceSerialize },
            context
          ),
          events[index][1]
        );
      }
    }
    if (context.tokenStack.length > 0) {
      const tail = context.tokenStack[context.tokenStack.length - 1];
      const handler = tail[1] || defaultOnError;
      handler.call(context, void 0, tail[0]);
    }
    tree.position = {
      start: point(
        events.length > 0 ? events[0][1].start : { line: 1, column: 1, offset: 0 }
      ),
      end: point(
        events.length > 0 ? events[events.length - 2][1].end : { line: 1, column: 1, offset: 0 }
      )
    };
    index = -1;
    while (++index < config.transforms.length) {
      tree = config.transforms[index](tree) || tree;
    }
    return tree;
  }
  function prepareList(events, start, length) {
    let index = start - 1;
    let containerBalance = -1;
    let listSpread = false;
    let listItem3;
    let lineIndex;
    let firstBlankLineIndex;
    let atMarker;
    while (++index <= length) {
      const event = events[index];
      switch (event[1].type) {
        case types.listUnordered:
        case types.listOrdered:
        case types.blockQuote: {
          if (event[0] === "enter") {
            containerBalance++;
          } else {
            containerBalance--;
          }
          atMarker = void 0;
          break;
        }
        case types.lineEndingBlank: {
          if (event[0] === "enter") {
            if (listItem3 && !atMarker && !containerBalance && !firstBlankLineIndex) {
              firstBlankLineIndex = index;
            }
            atMarker = void 0;
          }
          break;
        }
        case types.linePrefix:
        case types.listItemValue:
        case types.listItemMarker:
        case types.listItemPrefix:
        case types.listItemPrefixWhitespace: {
          break;
        }
        default: {
          atMarker = void 0;
        }
      }
      if (!containerBalance && event[0] === "enter" && event[1].type === types.listItemPrefix || containerBalance === -1 && event[0] === "exit" && (event[1].type === types.listUnordered || event[1].type === types.listOrdered)) {
        if (listItem3) {
          let tailIndex = index;
          lineIndex = void 0;
          while (tailIndex--) {
            const tailEvent = events[tailIndex];
            if (tailEvent[1].type === types.lineEnding || tailEvent[1].type === types.lineEndingBlank) {
              if (tailEvent[0] === "exit") continue;
              if (lineIndex) {
                events[lineIndex][1].type = types.lineEndingBlank;
                listSpread = true;
              }
              tailEvent[1].type = types.lineEnding;
              lineIndex = tailIndex;
            } else if (tailEvent[1].type === types.linePrefix || tailEvent[1].type === types.blockQuotePrefix || tailEvent[1].type === types.blockQuotePrefixWhitespace || tailEvent[1].type === types.blockQuoteMarker || tailEvent[1].type === types.listItemIndent) {
            } else {
              break;
            }
          }
          if (firstBlankLineIndex && (!lineIndex || firstBlankLineIndex < lineIndex)) {
            listItem3._spread = true;
          }
          listItem3.end = Object.assign(
            {},
            lineIndex ? events[lineIndex][1].start : event[1].end
          );
          events.splice(lineIndex || index, 0, ["exit", listItem3, event[2]]);
          index++;
          length++;
        }
        if (event[1].type === types.listItemPrefix) {
          const item = {
            type: "listItem",
            _spread: false,
            start: Object.assign({}, event[1].start),
            // @ts-expect-error: we’ll add `end` in a second.
            end: void 0
          };
          listItem3 = item;
          events.splice(index, 0, ["enter", item, event[2]]);
          index++;
          length++;
          firstBlankLineIndex = void 0;
          atMarker = true;
        }
      }
    }
    events[start][1]._spread = listSpread;
    return length;
  }
  function opener(create, and) {
    return open;
    function open(token) {
      enter.call(this, create(token), token);
      if (and) and.call(this, token);
    }
  }
  function buffer() {
    this.stack.push({ type: "fragment", children: [] });
  }
  function enter(node, token, errorHandler) {
    const parent = this.stack[this.stack.length - 1];
    ok(parent, "expected `parent`");
    ok("children" in parent, "expected `parent`");
    const siblings2 = parent.children;
    siblings2.push(node);
    this.stack.push(node);
    this.tokenStack.push([token, errorHandler || void 0]);
    node.position = {
      start: point(token.start),
      // @ts-expect-error: `end` will be patched later.
      end: void 0
    };
  }
  function closer(and) {
    return close;
    function close(token) {
      if (and) and.call(this, token);
      exit.call(this, token);
    }
  }
  function exit(token, onExitError) {
    const node = this.stack.pop();
    ok(node, "expected `node`");
    const open = this.tokenStack.pop();
    if (!open) {
      throw new Error(
        "Cannot close `" + token.type + "` (" + stringifyPosition({ start: token.start, end: token.end }) + "): it’s not open"
      );
    } else if (open[0].type !== token.type) {
      if (onExitError) {
        onExitError.call(this, token, open[0]);
      } else {
        const handler = open[1] || defaultOnError;
        handler.call(this, token, open[0]);
      }
    }
    ok(node.type !== "fragment", "unexpected fragment `exit`ed");
    ok(node.position, "expected `position` to be defined");
    node.position.end = point(token.end);
  }
  function resume() {
    return toString(this.stack.pop());
  }
  function onenterlistordered() {
    this.data.expectingFirstListItemValue = true;
  }
  function onenterlistitemvalue(token) {
    if (this.data.expectingFirstListItemValue) {
      const ancestor = this.stack[this.stack.length - 2];
      ok(ancestor, "expected nodes on stack");
      ok(ancestor.type === "list", "expected list on stack");
      ancestor.start = Number.parseInt(
        this.sliceSerialize(token),
        constants.numericBaseDecimal
      );
      this.data.expectingFirstListItemValue = void 0;
    }
  }
  function onexitcodefencedfenceinfo() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "code", "expected code on stack");
    node.lang = data2;
  }
  function onexitcodefencedfencemeta() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "code", "expected code on stack");
    node.meta = data2;
  }
  function onexitcodefencedfence() {
    if (this.data.flowCodeInside) return;
    this.buffer();
    this.data.flowCodeInside = true;
  }
  function onexitcodefenced() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "code", "expected code on stack");
    node.value = data2.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
    this.data.flowCodeInside = void 0;
  }
  function onexitcodeindented() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "code", "expected code on stack");
    node.value = data2.replace(/(\r?\n|\r)$/g, "");
  }
  function onexitdefinitionlabelstring(token) {
    const label = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "definition", "expected definition on stack");
    node.label = label;
    node.identifier = normalizeIdentifier(
      this.sliceSerialize(token)
    ).toLowerCase();
  }
  function onexitdefinitiontitlestring() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "definition", "expected definition on stack");
    node.title = data2;
  }
  function onexitdefinitiondestinationstring() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "definition", "expected definition on stack");
    node.url = data2;
  }
  function onexitatxheadingsequence(token) {
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "heading", "expected heading on stack");
    if (!node.depth) {
      const depth = this.sliceSerialize(token).length;
      ok(
        depth === 1 || depth === 2 || depth === 3 || depth === 4 || depth === 5 || depth === 6,
        "expected `depth` between `1` and `6`"
      );
      node.depth = depth;
    }
  }
  function onexitsetextheadingtext() {
    this.data.setextHeadingSlurpLineEnding = true;
  }
  function onexitsetextheadinglinesequence(token) {
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "heading", "expected heading on stack");
    node.depth = this.sliceSerialize(token).codePointAt(0) === codes.equalsTo ? 1 : 2;
  }
  function onexitsetextheading() {
    this.data.setextHeadingSlurpLineEnding = void 0;
  }
  function onenterdata(token) {
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok("children" in node, "expected parent on stack");
    const siblings2 = node.children;
    let tail = siblings2[siblings2.length - 1];
    if (!tail || tail.type !== "text") {
      tail = text5();
      tail.position = {
        start: point(token.start),
        // @ts-expect-error: we’ll add `end` later.
        end: void 0
      };
      siblings2.push(tail);
    }
    this.stack.push(tail);
  }
  function onexitdata(token) {
    const tail = this.stack.pop();
    ok(tail, "expected a `node` to be on the stack");
    ok("value" in tail, "expected a `literal` to be on the stack");
    ok(tail.position, "expected `node` to have an open position");
    tail.value += this.sliceSerialize(token);
    tail.position.end = point(token.end);
  }
  function onexitlineending(token) {
    const context = this.stack[this.stack.length - 1];
    ok(context, "expected `node`");
    if (this.data.atHardBreak) {
      ok("children" in context, "expected `parent`");
      const tail = context.children[context.children.length - 1];
      ok(tail.position, "expected tail to have a starting position");
      tail.position.end = point(token.end);
      this.data.atHardBreak = void 0;
      return;
    }
    if (!this.data.setextHeadingSlurpLineEnding && config.canContainEols.includes(context.type)) {
      onenterdata.call(this, token);
      onexitdata.call(this, token);
    }
  }
  function onexithardbreak() {
    this.data.atHardBreak = true;
  }
  function onexithtmlflow() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "html", "expected html on stack");
    node.value = data2;
  }
  function onexithtmltext() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "html", "expected html on stack");
    node.value = data2;
  }
  function onexitcodetext() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "inlineCode", "expected inline code on stack");
    node.value = data2;
  }
  function onexitlink() {
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "link", "expected link on stack");
    if (this.data.inReference) {
      const referenceType = this.data.referenceType || "shortcut";
      node.type += "Reference";
      node.referenceType = referenceType;
      delete node.url;
      delete node.title;
    } else {
      delete node.identifier;
      delete node.label;
    }
    this.data.referenceType = void 0;
  }
  function onexitimage() {
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "image", "expected image on stack");
    if (this.data.inReference) {
      const referenceType = this.data.referenceType || "shortcut";
      node.type += "Reference";
      node.referenceType = referenceType;
      delete node.url;
      delete node.title;
    } else {
      delete node.identifier;
      delete node.label;
    }
    this.data.referenceType = void 0;
  }
  function onexitlabeltext(token) {
    const string3 = this.sliceSerialize(token);
    const ancestor = this.stack[this.stack.length - 2];
    ok(ancestor, "expected ancestor on stack");
    ok(
      ancestor.type === "image" || ancestor.type === "link",
      "expected image or link on stack"
    );
    ancestor.label = decodeString(string3);
    ancestor.identifier = normalizeIdentifier(string3).toLowerCase();
  }
  function onexitlabel() {
    const fragment = this.stack[this.stack.length - 1];
    ok(fragment, "expected node on stack");
    ok(fragment.type === "fragment", "expected fragment on stack");
    const value = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(
      node.type === "image" || node.type === "link",
      "expected image or link on stack"
    );
    this.data.inReference = true;
    if (node.type === "link") {
      const children = fragment.children;
      node.children = children;
    } else {
      node.alt = value;
    }
  }
  function onexitresourcedestinationstring() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(
      node.type === "image" || node.type === "link",
      "expected image or link on stack"
    );
    node.url = data2;
  }
  function onexitresourcetitlestring() {
    const data2 = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(
      node.type === "image" || node.type === "link",
      "expected image or link on stack"
    );
    node.title = data2;
  }
  function onexitresource() {
    this.data.inReference = void 0;
  }
  function onenterreference() {
    this.data.referenceType = "collapsed";
  }
  function onexitreferencestring(token) {
    const label = this.resume();
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(
      node.type === "image" || node.type === "link",
      "expected image reference or link reference on stack"
    );
    node.label = label;
    node.identifier = normalizeIdentifier(
      this.sliceSerialize(token)
    ).toLowerCase();
    this.data.referenceType = "full";
  }
  function onexitcharacterreferencemarker(token) {
    ok(
      token.type === "characterReferenceMarkerNumeric" || token.type === "characterReferenceMarkerHexadecimal"
    );
    this.data.characterReferenceType = token.type;
  }
  function onexitcharacterreferencevalue(token) {
    const data2 = this.sliceSerialize(token);
    const type = this.data.characterReferenceType;
    let value;
    if (type) {
      value = decodeNumericCharacterReference(
        data2,
        type === types.characterReferenceMarkerNumeric ? constants.numericBaseDecimal : constants.numericBaseHexadecimal
      );
      this.data.characterReferenceType = void 0;
    } else {
      const result = decodeNamedCharacterReference(data2);
      ok(result !== false, "expected reference to decode");
      value = result;
    }
    const tail = this.stack[this.stack.length - 1];
    ok(tail, "expected `node`");
    ok("value" in tail, "expected `node.value`");
    tail.value += value;
  }
  function onexitcharacterreference(token) {
    const tail = this.stack.pop();
    ok(tail, "expected `node`");
    ok(tail.position, "expected `node.position`");
    tail.position.end = point(token.end);
  }
  function onexitautolinkprotocol(token) {
    onexitdata.call(this, token);
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "link", "expected link on stack");
    node.url = this.sliceSerialize(token);
  }
  function onexitautolinkemail(token) {
    onexitdata.call(this, token);
    const node = this.stack[this.stack.length - 1];
    ok(node, "expected node on stack");
    ok(node.type === "link", "expected link on stack");
    node.url = "mailto:" + this.sliceSerialize(token);
  }
  function blockQuote2() {
    return { type: "blockquote", children: [] };
  }
  function codeFlow() {
    return { type: "code", lang: null, meta: null, value: "" };
  }
  function codeText2() {
    return { type: "inlineCode", value: "" };
  }
  function definition2() {
    return {
      type: "definition",
      identifier: "",
      label: null,
      title: null,
      url: ""
    };
  }
  function emphasis2() {
    return { type: "emphasis", children: [] };
  }
  function heading2() {
    return {
      type: "heading",
      // @ts-expect-error `depth` will be set later.
      depth: 0,
      children: []
    };
  }
  function hardBreak2() {
    return { type: "break" };
  }
  function html5() {
    return { type: "html", value: "" };
  }
  function image2() {
    return { type: "image", title: null, url: "", alt: null };
  }
  function link2() {
    return { type: "link", title: null, url: "", children: [] };
  }
  function list3(token) {
    return {
      type: "list",
      ordered: token.type === "listOrdered",
      start: null,
      spread: token._spread,
      children: []
    };
  }
  function listItem2(token) {
    return {
      type: "listItem",
      spread: token._spread,
      checked: null,
      children: []
    };
  }
  function paragraph2() {
    return { type: "paragraph", children: [] };
  }
  function strong2() {
    return { type: "strong", children: [] };
  }
  function text5() {
    return { type: "text", value: "" };
  }
  function thematicBreak3() {
    return { type: "thematicBreak" };
  }
}
function point(d) {
  return { line: d.line, column: d.column, offset: d.offset };
}
function configure(combined, extensions) {
  let index = -1;
  while (++index < extensions.length) {
    const value = extensions[index];
    if (Array.isArray(value)) {
      configure(combined, value);
    } else {
      extension(combined, value);
    }
  }
}
function extension(combined, extension2) {
  let key2;
  for (key2 in extension2) {
    if (own.call(extension2, key2)) {
      switch (key2) {
        case "canContainEols": {
          const right = extension2[key2];
          if (right) {
            combined[key2].push(...right);
          }
          break;
        }
        case "transforms": {
          const right = extension2[key2];
          if (right) {
            combined[key2].push(...right);
          }
          break;
        }
        case "enter":
        case "exit": {
          const right = extension2[key2];
          if (right) {
            Object.assign(combined[key2], right);
          }
          break;
        }
      }
    }
  }
}
function defaultOnError(left, right) {
  if (left) {
    throw new Error(
      "Cannot close `" + left.type + "` (" + stringifyPosition({ start: left.start, end: left.end }) + "): a different token (`" + right.type + "`, " + stringifyPosition({ start: right.start, end: right.end }) + ") is open"
    );
  } else {
    throw new Error(
      "Cannot close document, a token (`" + right.type + "`, " + stringifyPosition({ start: right.start, end: right.end }) + ") is still open"
    );
  }
}

// node_modules/remark-parse/lib/index.js
function remarkParse(options) {
  const self = this;
  self.parser = parser;
  function parser(doc) {
    return fromMarkdown(doc, {
      ...self.data("settings"),
      ...options,
      // Note: these options are not in the readme.
      // The goal is for them to be set by plugins on `data` instead of being
      // passed by users.
      extensions: self.data("micromarkExtensions") || [],
      mdastExtensions: self.data("fromMarkdownExtensions") || []
    });
  }
}

// node_modules/mdast-util-to-hast/lib/handlers/blockquote.js
function blockquote(state, node) {
  const result = {
    type: "element",
    tagName: "blockquote",
    properties: {},
    children: state.wrap(state.all(node), true)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/break.js
function hardBreak(state, node) {
  const result = { type: "element", tagName: "br", properties: {}, children: [] };
  state.patch(node, result);
  return [state.applyData(node, result), { type: "text", value: "\n" }];
}

// node_modules/mdast-util-to-hast/lib/handlers/code.js
function code(state, node) {
  const value = node.value ? node.value + "\n" : "";
  const properties = {};
  const language = node.lang ? node.lang.split(/\s+/) : [];
  if (language.length > 0) {
    properties.className = ["language-" + language[0]];
  }
  let result = {
    type: "element",
    tagName: "code",
    properties,
    children: [{ type: "text", value }]
  };
  if (node.meta) {
    result.data = { meta: node.meta };
  }
  state.patch(node, result);
  result = state.applyData(node, result);
  result = { type: "element", tagName: "pre", properties: {}, children: [result] };
  state.patch(node, result);
  return result;
}

// node_modules/mdast-util-to-hast/lib/handlers/delete.js
function strikethrough(state, node) {
  const result = {
    type: "element",
    tagName: "del",
    properties: {},
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/emphasis.js
function emphasis(state, node) {
  const result = {
    type: "element",
    tagName: "em",
    properties: {},
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/footnote-reference.js
function footnoteReference(state, node) {
  const clobberPrefix = typeof state.options.clobberPrefix === "string" ? state.options.clobberPrefix : "user-content-";
  const id = String(node.identifier).toUpperCase();
  const safeId = normalizeUri(id.toLowerCase());
  const index = state.footnoteOrder.indexOf(id);
  let counter;
  let reuseCounter = state.footnoteCounts.get(id);
  if (reuseCounter === void 0) {
    reuseCounter = 0;
    state.footnoteOrder.push(id);
    counter = state.footnoteOrder.length;
  } else {
    counter = index + 1;
  }
  reuseCounter += 1;
  state.footnoteCounts.set(id, reuseCounter);
  const link2 = {
    type: "element",
    tagName: "a",
    properties: {
      href: "#" + clobberPrefix + "fn-" + safeId,
      id: clobberPrefix + "fnref-" + safeId + (reuseCounter > 1 ? "-" + reuseCounter : ""),
      dataFootnoteRef: true,
      ariaDescribedBy: ["footnote-label"]
    },
    children: [{ type: "text", value: String(counter) }]
  };
  state.patch(node, link2);
  const sup = {
    type: "element",
    tagName: "sup",
    properties: {},
    children: [link2]
  };
  state.patch(node, sup);
  return state.applyData(node, sup);
}

// node_modules/mdast-util-to-hast/lib/handlers/heading.js
function heading(state, node) {
  const result = {
    type: "element",
    tagName: "h" + node.depth,
    properties: {},
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/html.js
function html2(state, node) {
  if (state.options.allowDangerousHtml) {
    const result = { type: "raw", value: node.value };
    state.patch(node, result);
    return state.applyData(node, result);
  }
  return void 0;
}

// node_modules/mdast-util-to-hast/lib/revert.js
function revert(state, node) {
  const subtype = node.referenceType;
  let suffix = "]";
  if (subtype === "collapsed") {
    suffix += "[]";
  } else if (subtype === "full") {
    suffix += "[" + (node.label || node.identifier) + "]";
  }
  if (node.type === "imageReference") {
    return [{ type: "text", value: "![" + node.alt + suffix }];
  }
  const contents = state.all(node);
  const head2 = contents[0];
  if (head2 && head2.type === "text") {
    head2.value = "[" + head2.value;
  } else {
    contents.unshift({ type: "text", value: "[" });
  }
  const tail = contents[contents.length - 1];
  if (tail && tail.type === "text") {
    tail.value += suffix;
  } else {
    contents.push({ type: "text", value: suffix });
  }
  return contents;
}

// node_modules/mdast-util-to-hast/lib/handlers/image-reference.js
function imageReference(state, node) {
  const id = String(node.identifier).toUpperCase();
  const definition2 = state.definitionById.get(id);
  if (!definition2) {
    return revert(state, node);
  }
  const properties = { src: normalizeUri(definition2.url || ""), alt: node.alt };
  if (definition2.title !== null && definition2.title !== void 0) {
    properties.title = definition2.title;
  }
  const result = { type: "element", tagName: "img", properties, children: [] };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/image.js
function image(state, node) {
  const properties = { src: normalizeUri(node.url) };
  if (node.alt !== null && node.alt !== void 0) {
    properties.alt = node.alt;
  }
  if (node.title !== null && node.title !== void 0) {
    properties.title = node.title;
  }
  const result = { type: "element", tagName: "img", properties, children: [] };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/inline-code.js
function inlineCode(state, node) {
  const text5 = { type: "text", value: node.value.replace(/\r?\n|\r/g, " ") };
  state.patch(node, text5);
  const result = {
    type: "element",
    tagName: "code",
    properties: {},
    children: [text5]
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/link-reference.js
function linkReference(state, node) {
  const id = String(node.identifier).toUpperCase();
  const definition2 = state.definitionById.get(id);
  if (!definition2) {
    return revert(state, node);
  }
  const properties = { href: normalizeUri(definition2.url || "") };
  if (definition2.title !== null && definition2.title !== void 0) {
    properties.title = definition2.title;
  }
  const result = {
    type: "element",
    tagName: "a",
    properties,
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/link.js
function link(state, node) {
  const properties = { href: normalizeUri(node.url) };
  if (node.title !== null && node.title !== void 0) {
    properties.title = node.title;
  }
  const result = {
    type: "element",
    tagName: "a",
    properties,
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/list-item.js
function listItem(state, node, parent) {
  const results = state.all(node);
  const loose = parent ? listLoose(parent) : listItemLoose(node);
  const properties = {};
  const children = [];
  if (typeof node.checked === "boolean") {
    const head2 = results[0];
    let paragraph2;
    if (head2 && head2.type === "element" && head2.tagName === "p") {
      paragraph2 = head2;
    } else {
      paragraph2 = { type: "element", tagName: "p", properties: {}, children: [] };
      results.unshift(paragraph2);
    }
    if (paragraph2.children.length > 0) {
      paragraph2.children.unshift({ type: "text", value: " " });
    }
    paragraph2.children.unshift({
      type: "element",
      tagName: "input",
      properties: { type: "checkbox", checked: node.checked, disabled: true },
      children: []
    });
    properties.className = ["task-list-item"];
  }
  let index = -1;
  while (++index < results.length) {
    const child = results[index];
    if (loose || index !== 0 || child.type !== "element" || child.tagName !== "p") {
      children.push({ type: "text", value: "\n" });
    }
    if (child.type === "element" && child.tagName === "p" && !loose) {
      children.push(...child.children);
    } else {
      children.push(child);
    }
  }
  const tail = results[results.length - 1];
  if (tail && (loose || tail.type !== "element" || tail.tagName !== "p")) {
    children.push({ type: "text", value: "\n" });
  }
  const result = { type: "element", tagName: "li", properties, children };
  state.patch(node, result);
  return state.applyData(node, result);
}
function listLoose(node) {
  let loose = false;
  if (node.type === "list") {
    loose = node.spread || false;
    const children = node.children;
    let index = -1;
    while (!loose && ++index < children.length) {
      loose = listItemLoose(children[index]);
    }
  }
  return loose;
}
function listItemLoose(node) {
  const spread = node.spread;
  return spread === null || spread === void 0 ? node.children.length > 1 : spread;
}

// node_modules/mdast-util-to-hast/lib/handlers/list.js
function list2(state, node) {
  const properties = {};
  const results = state.all(node);
  let index = -1;
  if (typeof node.start === "number" && node.start !== 1) {
    properties.start = node.start;
  }
  while (++index < results.length) {
    const child = results[index];
    if (child.type === "element" && child.tagName === "li" && child.properties && Array.isArray(child.properties.className) && child.properties.className.includes("task-list-item")) {
      properties.className = ["contains-task-list"];
      break;
    }
  }
  const result = {
    type: "element",
    tagName: node.ordered ? "ol" : "ul",
    properties,
    children: state.wrap(results, true)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/paragraph.js
function paragraph(state, node) {
  const result = {
    type: "element",
    tagName: "p",
    properties: {},
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/root.js
function root(state, node) {
  const result = { type: "root", children: state.wrap(state.all(node)) };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/strong.js
function strong(state, node) {
  const result = {
    type: "element",
    tagName: "strong",
    properties: {},
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/table.js
function table(state, node) {
  const rows = state.all(node);
  const firstRow = rows.shift();
  const tableContent = [];
  if (firstRow) {
    const head2 = {
      type: "element",
      tagName: "thead",
      properties: {},
      children: state.wrap([firstRow], true)
    };
    state.patch(node.children[0], head2);
    tableContent.push(head2);
  }
  if (rows.length > 0) {
    const body3 = {
      type: "element",
      tagName: "tbody",
      properties: {},
      children: state.wrap(rows, true)
    };
    const start = pointStart(node.children[1]);
    const end = pointEnd(node.children[node.children.length - 1]);
    if (start && end) body3.position = { start, end };
    tableContent.push(body3);
  }
  const result = {
    type: "element",
    tagName: "table",
    properties: {},
    children: state.wrap(tableContent, true)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/table-row.js
function tableRow(state, node, parent) {
  const siblings2 = parent ? parent.children : void 0;
  const rowIndex = siblings2 ? siblings2.indexOf(node) : 1;
  const tagName = rowIndex === 0 ? "th" : "td";
  const align = parent && parent.type === "table" ? parent.align : void 0;
  const length = align ? align.length : node.children.length;
  let cellIndex = -1;
  const cells2 = [];
  while (++cellIndex < length) {
    const cell = node.children[cellIndex];
    const properties = {};
    const alignValue = align ? align[cellIndex] : void 0;
    if (alignValue) {
      properties.align = alignValue;
    }
    let result2 = { type: "element", tagName, properties, children: [] };
    if (cell) {
      result2.children = state.all(cell);
      state.patch(cell, result2);
      result2 = state.applyData(cell, result2);
    }
    cells2.push(result2);
  }
  const result = {
    type: "element",
    tagName: "tr",
    properties: {},
    children: state.wrap(cells2, true)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/table-cell.js
function tableCell(state, node) {
  const result = {
    type: "element",
    tagName: "td",
    // Assume body cell.
    properties: {},
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/trim-lines/index.js
var tab = 9;
var space = 32;
function trimLines(value) {
  const source = String(value);
  const search2 = /\r?\n|\r/g;
  let match = search2.exec(source);
  let last = 0;
  const lines = [];
  while (match) {
    lines.push(
      trimLine(source.slice(last, match.index), last > 0, true),
      match[0]
    );
    last = match.index + match[0].length;
    match = search2.exec(source);
  }
  lines.push(trimLine(source.slice(last), last > 0, false));
  return lines.join("");
}
function trimLine(value, start, end) {
  let startIndex = 0;
  let endIndex = value.length;
  if (start) {
    let code2 = value.codePointAt(startIndex);
    while (code2 === tab || code2 === space) {
      startIndex++;
      code2 = value.codePointAt(startIndex);
    }
  }
  if (end) {
    let code2 = value.codePointAt(endIndex - 1);
    while (code2 === tab || code2 === space) {
      endIndex--;
      code2 = value.codePointAt(endIndex - 1);
    }
  }
  return endIndex > startIndex ? value.slice(startIndex, endIndex) : "";
}

// node_modules/mdast-util-to-hast/lib/handlers/text.js
function text3(state, node) {
  const result = { type: "text", value: trimLines(String(node.value)) };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/thematic-break.js
function thematicBreak2(state, node) {
  const result = {
    type: "element",
    tagName: "hr",
    properties: {},
    children: []
  };
  state.patch(node, result);
  return state.applyData(node, result);
}

// node_modules/mdast-util-to-hast/lib/handlers/index.js
var handlers = {
  blockquote,
  break: hardBreak,
  code,
  delete: strikethrough,
  emphasis,
  footnoteReference,
  heading,
  html: html2,
  imageReference,
  image,
  inlineCode,
  linkReference,
  link,
  listItem,
  list: list2,
  paragraph,
  // @ts-expect-error: root is different, but hard to type.
  root,
  strong,
  table,
  tableCell,
  tableRow,
  text: text3,
  thematicBreak: thematicBreak2,
  toml: ignore,
  yaml: ignore,
  definition: ignore,
  footnoteDefinition: ignore
};
function ignore() {
  return void 0;
}

// node_modules/mdast-util-to-hast/lib/footer.js
function defaultFootnoteBackContent(_3, rereferenceIndex) {
  const result = [{ type: "text", value: "↩" }];
  if (rereferenceIndex > 1) {
    result.push({
      type: "element",
      tagName: "sup",
      properties: {},
      children: [{ type: "text", value: String(rereferenceIndex) }]
    });
  }
  return result;
}
function defaultFootnoteBackLabel(referenceIndex, rereferenceIndex) {
  return "Back to reference " + (referenceIndex + 1) + (rereferenceIndex > 1 ? "-" + rereferenceIndex : "");
}
function footer(state) {
  const clobberPrefix = typeof state.options.clobberPrefix === "string" ? state.options.clobberPrefix : "user-content-";
  const footnoteBackContent = state.options.footnoteBackContent || defaultFootnoteBackContent;
  const footnoteBackLabel = state.options.footnoteBackLabel || defaultFootnoteBackLabel;
  const footnoteLabel = state.options.footnoteLabel || "Footnotes";
  const footnoteLabelTagName = state.options.footnoteLabelTagName || "h2";
  const footnoteLabelProperties = state.options.footnoteLabelProperties || {
    className: ["sr-only"]
  };
  const listItems = [];
  let referenceIndex = -1;
  while (++referenceIndex < state.footnoteOrder.length) {
    const definition2 = state.footnoteById.get(
      state.footnoteOrder[referenceIndex]
    );
    if (!definition2) {
      continue;
    }
    const content3 = state.all(definition2);
    const id = String(definition2.identifier).toUpperCase();
    const safeId = normalizeUri(id.toLowerCase());
    let rereferenceIndex = 0;
    const backReferences = [];
    const counts = state.footnoteCounts.get(id);
    while (counts !== void 0 && ++rereferenceIndex <= counts) {
      if (backReferences.length > 0) {
        backReferences.push({ type: "text", value: " " });
      }
      let children = typeof footnoteBackContent === "string" ? footnoteBackContent : footnoteBackContent(referenceIndex, rereferenceIndex);
      if (typeof children === "string") {
        children = { type: "text", value: children };
      }
      backReferences.push({
        type: "element",
        tagName: "a",
        properties: {
          href: "#" + clobberPrefix + "fnref-" + safeId + (rereferenceIndex > 1 ? "-" + rereferenceIndex : ""),
          dataFootnoteBackref: "",
          ariaLabel: typeof footnoteBackLabel === "string" ? footnoteBackLabel : footnoteBackLabel(referenceIndex, rereferenceIndex),
          className: ["data-footnote-backref"]
        },
        children: Array.isArray(children) ? children : [children]
      });
    }
    const tail = content3[content3.length - 1];
    if (tail && tail.type === "element" && tail.tagName === "p") {
      const tailTail = tail.children[tail.children.length - 1];
      if (tailTail && tailTail.type === "text") {
        tailTail.value += " ";
      } else {
        tail.children.push({ type: "text", value: " " });
      }
      tail.children.push(...backReferences);
    } else {
      content3.push(...backReferences);
    }
    const listItem2 = {
      type: "element",
      tagName: "li",
      properties: { id: clobberPrefix + "fn-" + safeId },
      children: state.wrap(content3, true)
    };
    state.patch(definition2, listItem2);
    listItems.push(listItem2);
  }
  if (listItems.length === 0) {
    return;
  }
  return {
    type: "element",
    tagName: "section",
    properties: { dataFootnotes: true, className: ["footnotes"] },
    children: [
      {
        type: "element",
        tagName: footnoteLabelTagName,
        properties: {
          ...esm_default(footnoteLabelProperties),
          id: "footnote-label"
        },
        children: [{ type: "text", value: footnoteLabel }]
      },
      { type: "text", value: "\n" },
      {
        type: "element",
        tagName: "ol",
        properties: {},
        children: state.wrap(listItems, true)
      },
      { type: "text", value: "\n" }
    ]
  };
}

// node_modules/mdast-util-to-hast/lib/state.js
var own2 = {}.hasOwnProperty;
var emptyOptions = {};
function createState(tree, options) {
  const settings = options || emptyOptions;
  const definitionById = /* @__PURE__ */ new Map();
  const footnoteById = /* @__PURE__ */ new Map();
  const footnoteCounts = /* @__PURE__ */ new Map();
  const handlers2 = { ...handlers, ...settings.handlers };
  const state = {
    all: all2,
    applyData,
    definitionById,
    footnoteById,
    footnoteCounts,
    footnoteOrder: [],
    handlers: handlers2,
    one: one2,
    options: settings,
    patch,
    wrap
  };
  visit(tree, function(node) {
    if (node.type === "definition" || node.type === "footnoteDefinition") {
      const map = node.type === "definition" ? definitionById : footnoteById;
      const id = String(node.identifier).toUpperCase();
      if (!map.has(id)) {
        map.set(id, node);
      }
    }
  });
  return state;
  function one2(node, parent) {
    const type = node.type;
    const handle2 = state.handlers[type];
    if (own2.call(state.handlers, type) && handle2) {
      return handle2(state, node, parent);
    }
    if (state.options.passThrough && state.options.passThrough.includes(type)) {
      if ("children" in node) {
        const { children, ...shallow } = node;
        const result = esm_default(shallow);
        result.children = state.all(node);
        return result;
      }
      return esm_default(node);
    }
    const unknown2 = state.options.unknownHandler || defaultUnknownHandler;
    return unknown2(state, node, parent);
  }
  function all2(parent) {
    const values2 = [];
    if ("children" in parent) {
      const nodes = parent.children;
      let index = -1;
      while (++index < nodes.length) {
        const result = state.one(nodes[index], parent);
        if (result) {
          if (index && nodes[index - 1].type === "break") {
            if (!Array.isArray(result) && result.type === "text") {
              result.value = trimMarkdownSpaceStart(result.value);
            }
            if (!Array.isArray(result) && result.type === "element") {
              const head2 = result.children[0];
              if (head2 && head2.type === "text") {
                head2.value = trimMarkdownSpaceStart(head2.value);
              }
            }
          }
          if (Array.isArray(result)) {
            values2.push(...result);
          } else {
            values2.push(result);
          }
        }
      }
    }
    return values2;
  }
}
function patch(from, to2) {
  if (from.position) to2.position = position(from);
}
function applyData(from, to2) {
  let result = to2;
  if (from && from.data) {
    const hName = from.data.hName;
    const hChildren = from.data.hChildren;
    const hProperties = from.data.hProperties;
    if (typeof hName === "string") {
      if (result.type === "element") {
        result.tagName = hName;
      } else {
        const children = "children" in result ? result.children : [result];
        result = { type: "element", tagName: hName, properties: {}, children };
      }
    }
    if (result.type === "element" && hProperties) {
      Object.assign(result.properties, esm_default(hProperties));
    }
    if ("children" in result && result.children && hChildren !== null && hChildren !== void 0) {
      result.children = hChildren;
    }
  }
  return result;
}
function defaultUnknownHandler(state, node) {
  const data = node.data || {};
  const result = "value" in node && !(own2.call(data, "hProperties") || own2.call(data, "hChildren")) ? { type: "text", value: node.value } : {
    type: "element",
    tagName: "div",
    properties: {},
    children: state.all(node)
  };
  state.patch(node, result);
  return state.applyData(node, result);
}
function wrap(nodes, loose) {
  const result = [];
  let index = -1;
  if (loose) {
    result.push({ type: "text", value: "\n" });
  }
  while (++index < nodes.length) {
    if (index) result.push({ type: "text", value: "\n" });
    result.push(nodes[index]);
  }
  if (loose && nodes.length > 0) {
    result.push({ type: "text", value: "\n" });
  }
  return result;
}
function trimMarkdownSpaceStart(value) {
  let index = 0;
  let code2 = value.charCodeAt(index);
  while (code2 === 9 || code2 === 32) {
    index++;
    code2 = value.charCodeAt(index);
  }
  return value.slice(index);
}

// node_modules/mdast-util-to-hast/lib/index.js
function toHast(tree, options) {
  const state = createState(tree, options);
  const node = state.one(tree, void 0);
  const foot = footer(state);
  const result = Array.isArray(node) ? { type: "root", children: node } : node || { type: "root", children: [] };
  if (foot) {
    ok("children" in result);
    result.children.push({ type: "text", value: "\n" }, foot);
  }
  return result;
}

// node_modules/remark-rehype/lib/index.js
function remarkRehype(destination, options) {
  if (destination && "run" in destination) {
    return async function(tree, file) {
      const hastTree = (
        /** @type {HastRoot} */
        toHast(tree, { file, ...options })
      );
      await destination.run(hastTree, file);
    };
  }
  return function(tree, file) {
    return (
      /** @type {HastRoot} */
      toHast(tree, { file, ...destination || options })
    );
  };
}

// node_modules/html-void-elements/index.js
var htmlVoidElements = [
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "image",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
];

// node_modules/stringify-entities/lib/core.js
var defaultSubsetRegex = /["&'<>`]/g;
var surrogatePairsRegex = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
var controlCharactersRegex = (
  // eslint-disable-next-line no-control-regex, unicorn/no-hex-escape
  /[\x01-\t\v\f\x0E-\x1F\x7F\x81\x8D\x8F\x90\x9D\xA0-\uFFFF]/g
);
var regexEscapeRegex = /[|\\{}()[\]^$+*?.]/g;
var subsetToRegexCache = /* @__PURE__ */ new WeakMap();
function core(value, options) {
  value = value.replace(
    options.subset ? charactersToExpressionCached(options.subset) : defaultSubsetRegex,
    basic
  );
  if (options.subset || options.escapeOnly) {
    return value;
  }
  return value.replace(surrogatePairsRegex, surrogate).replace(controlCharactersRegex, basic);
  function surrogate(pair, index, all2) {
    return options.format(
      (pair.charCodeAt(0) - 55296) * 1024 + pair.charCodeAt(1) - 56320 + 65536,
      all2.charCodeAt(index + 2),
      options
    );
  }
  function basic(character, index, all2) {
    return options.format(
      character.charCodeAt(0),
      all2.charCodeAt(index + 1),
      options
    );
  }
}
function charactersToExpressionCached(subset) {
  let cached = subsetToRegexCache.get(subset);
  if (!cached) {
    cached = charactersToExpression(subset);
    subsetToRegexCache.set(subset, cached);
  }
  return cached;
}
function charactersToExpression(subset) {
  const groups = [];
  let index = -1;
  while (++index < subset.length) {
    groups.push(subset[index].replace(regexEscapeRegex, "\\$&"));
  }
  return new RegExp("(?:" + groups.join("|") + ")", "g");
}

// node_modules/stringify-entities/lib/util/to-hexadecimal.js
var hexadecimalRegex = /[\dA-Fa-f]/;
function toHexadecimal(code2, next, omit) {
  const value = "&#x" + code2.toString(16).toUpperCase();
  return omit && next && !hexadecimalRegex.test(String.fromCharCode(next)) ? value : value + ";";
}

// node_modules/stringify-entities/lib/util/to-decimal.js
var decimalRegex = /\d/;
function toDecimal(code2, next, omit) {
  const value = "&#" + String(code2);
  return omit && next && !decimalRegex.test(String.fromCharCode(next)) ? value : value + ";";
}

// node_modules/character-entities-legacy/index.js
var characterEntitiesLegacy = [
  "AElig",
  "AMP",
  "Aacute",
  "Acirc",
  "Agrave",
  "Aring",
  "Atilde",
  "Auml",
  "COPY",
  "Ccedil",
  "ETH",
  "Eacute",
  "Ecirc",
  "Egrave",
  "Euml",
  "GT",
  "Iacute",
  "Icirc",
  "Igrave",
  "Iuml",
  "LT",
  "Ntilde",
  "Oacute",
  "Ocirc",
  "Ograve",
  "Oslash",
  "Otilde",
  "Ouml",
  "QUOT",
  "REG",
  "THORN",
  "Uacute",
  "Ucirc",
  "Ugrave",
  "Uuml",
  "Yacute",
  "aacute",
  "acirc",
  "acute",
  "aelig",
  "agrave",
  "amp",
  "aring",
  "atilde",
  "auml",
  "brvbar",
  "ccedil",
  "cedil",
  "cent",
  "copy",
  "curren",
  "deg",
  "divide",
  "eacute",
  "ecirc",
  "egrave",
  "eth",
  "euml",
  "frac12",
  "frac14",
  "frac34",
  "gt",
  "iacute",
  "icirc",
  "iexcl",
  "igrave",
  "iquest",
  "iuml",
  "laquo",
  "lt",
  "macr",
  "micro",
  "middot",
  "nbsp",
  "not",
  "ntilde",
  "oacute",
  "ocirc",
  "ograve",
  "ordf",
  "ordm",
  "oslash",
  "otilde",
  "ouml",
  "para",
  "plusmn",
  "pound",
  "quot",
  "raquo",
  "reg",
  "sect",
  "shy",
  "sup1",
  "sup2",
  "sup3",
  "szlig",
  "thorn",
  "times",
  "uacute",
  "ucirc",
  "ugrave",
  "uml",
  "uuml",
  "yacute",
  "yen",
  "yuml"
];

// node_modules/character-entities-html4/index.js
var characterEntitiesHtml4 = {
  nbsp: " ",
  iexcl: "¡",
  cent: "¢",
  pound: "£",
  curren: "¤",
  yen: "¥",
  brvbar: "¦",
  sect: "§",
  uml: "¨",
  copy: "©",
  ordf: "ª",
  laquo: "«",
  not: "¬",
  shy: "­",
  reg: "®",
  macr: "¯",
  deg: "°",
  plusmn: "±",
  sup2: "²",
  sup3: "³",
  acute: "´",
  micro: "µ",
  para: "¶",
  middot: "·",
  cedil: "¸",
  sup1: "¹",
  ordm: "º",
  raquo: "»",
  frac14: "¼",
  frac12: "½",
  frac34: "¾",
  iquest: "¿",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Auml: "Ä",
  Aring: "Å",
  AElig: "Æ",
  Ccedil: "Ç",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Euml: "Ë",
  Igrave: "Ì",
  Iacute: "Í",
  Icirc: "Î",
  Iuml: "Ï",
  ETH: "Ð",
  Ntilde: "Ñ",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Ouml: "Ö",
  times: "×",
  Oslash: "Ø",
  Ugrave: "Ù",
  Uacute: "Ú",
  Ucirc: "Û",
  Uuml: "Ü",
  Yacute: "Ý",
  THORN: "Þ",
  szlig: "ß",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  eth: "ð",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  divide: "÷",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  thorn: "þ",
  yuml: "ÿ",
  fnof: "ƒ",
  Alpha: "Α",
  Beta: "Β",
  Gamma: "Γ",
  Delta: "Δ",
  Epsilon: "Ε",
  Zeta: "Ζ",
  Eta: "Η",
  Theta: "Θ",
  Iota: "Ι",
  Kappa: "Κ",
  Lambda: "Λ",
  Mu: "Μ",
  Nu: "Ν",
  Xi: "Ξ",
  Omicron: "Ο",
  Pi: "Π",
  Rho: "Ρ",
  Sigma: "Σ",
  Tau: "Τ",
  Upsilon: "Υ",
  Phi: "Φ",
  Chi: "Χ",
  Psi: "Ψ",
  Omega: "Ω",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  rho: "ρ",
  sigmaf: "ς",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  thetasym: "ϑ",
  upsih: "ϒ",
  piv: "ϖ",
  bull: "•",
  hellip: "…",
  prime: "′",
  Prime: "″",
  oline: "‾",
  frasl: "⁄",
  weierp: "℘",
  image: "ℑ",
  real: "ℜ",
  trade: "™",
  alefsym: "ℵ",
  larr: "←",
  uarr: "↑",
  rarr: "→",
  darr: "↓",
  harr: "↔",
  crarr: "↵",
  lArr: "⇐",
  uArr: "⇑",
  rArr: "⇒",
  dArr: "⇓",
  hArr: "⇔",
  forall: "∀",
  part: "∂",
  exist: "∃",
  empty: "∅",
  nabla: "∇",
  isin: "∈",
  notin: "∉",
  ni: "∋",
  prod: "∏",
  sum: "∑",
  minus: "−",
  lowast: "∗",
  radic: "√",
  prop: "∝",
  infin: "∞",
  ang: "∠",
  and: "∧",
  or: "∨",
  cap: "∩",
  cup: "∪",
  int: "∫",
  there4: "∴",
  sim: "∼",
  cong: "≅",
  asymp: "≈",
  ne: "≠",
  equiv: "≡",
  le: "≤",
  ge: "≥",
  sub: "⊂",
  sup: "⊃",
  nsub: "⊄",
  sube: "⊆",
  supe: "⊇",
  oplus: "⊕",
  otimes: "⊗",
  perp: "⊥",
  sdot: "⋅",
  lceil: "⌈",
  rceil: "⌉",
  lfloor: "⌊",
  rfloor: "⌋",
  lang: "〈",
  rang: "〉",
  loz: "◊",
  spades: "♠",
  clubs: "♣",
  hearts: "♥",
  diams: "♦",
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  OElig: "Œ",
  oelig: "œ",
  Scaron: "Š",
  scaron: "š",
  Yuml: "Ÿ",
  circ: "ˆ",
  tilde: "˜",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "‌",
  zwj: "‍",
  lrm: "‎",
  rlm: "‏",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  dagger: "†",
  Dagger: "‡",
  permil: "‰",
  lsaquo: "‹",
  rsaquo: "›",
  euro: "€"
};

// node_modules/stringify-entities/lib/constant/dangerous.js
var dangerous = [
  "cent",
  "copy",
  "divide",
  "gt",
  "lt",
  "not",
  "para",
  "times"
];

// node_modules/stringify-entities/lib/util/to-named.js
var own3 = {}.hasOwnProperty;
var characters = {};
var key;
for (key in characterEntitiesHtml4) {
  if (own3.call(characterEntitiesHtml4, key)) {
    characters[characterEntitiesHtml4[key]] = key;
  }
}
var notAlphanumericRegex = /[^\dA-Za-z]/;
function toNamed(code2, next, omit, attribute) {
  const character = String.fromCharCode(code2);
  if (own3.call(characters, character)) {
    const name = characters[character];
    const value = "&" + name;
    if (omit && characterEntitiesLegacy.includes(name) && !dangerous.includes(name) && (!attribute || next && next !== 61 && notAlphanumericRegex.test(String.fromCharCode(next)))) {
      return value;
    }
    return value + ";";
  }
  return "";
}

// node_modules/stringify-entities/lib/util/format-smart.js
function formatSmart(code2, next, options) {
  let numeric = toHexadecimal(code2, next, options.omitOptionalSemicolons);
  let named;
  if (options.useNamedReferences || options.useShortestReferences) {
    named = toNamed(
      code2,
      next,
      options.omitOptionalSemicolons,
      options.attribute
    );
  }
  if ((options.useShortestReferences || !named) && options.useShortestReferences) {
    const decimal = toDecimal(code2, next, options.omitOptionalSemicolons);
    if (decimal.length < numeric.length) {
      numeric = decimal;
    }
  }
  return named && (!options.useShortestReferences || named.length < numeric.length) ? named : numeric;
}

// node_modules/stringify-entities/lib/index.js
function stringifyEntities(value, options) {
  return core(value, Object.assign({ format: formatSmart }, options));
}

// node_modules/hast-util-to-html/lib/handle/comment.js
var htmlCommentRegex = /^>|^->|<!--|-->|--!>|<!-$/g;
var bogusCommentEntitySubset = [">"];
var commentEntitySubset = ["<", ">"];
function comment(node, _1, _22, state) {
  return state.settings.bogusComments ? "<?" + stringifyEntities(
    node.value,
    Object.assign({}, state.settings.characterReferences, {
      subset: bogusCommentEntitySubset
    })
  ) + ">" : "<!--" + node.value.replace(htmlCommentRegex, encode2) + "-->";
  function encode2($0) {
    return stringifyEntities(
      $0,
      Object.assign({}, state.settings.characterReferences, {
        subset: commentEntitySubset
      })
    );
  }
}

// node_modules/hast-util-to-html/lib/handle/doctype.js
function doctype(_1, _22, _3, state) {
  return "<!" + (state.settings.upperDoctype ? "DOCTYPE" : "doctype") + (state.settings.tightDoctype ? "" : " ") + "html>";
}

// node_modules/hast-util-to-html/lib/omission/util/siblings.js
var siblingAfter = siblings(1);
var siblingBefore = siblings(-1);
var emptyChildren = [];
function siblings(increment) {
  return sibling;
  function sibling(parent, index, includeWhitespace) {
    const siblings2 = parent ? parent.children : emptyChildren;
    let offset = (index || 0) + increment;
    let next = siblings2[offset];
    if (!includeWhitespace) {
      while (next && whitespace(next)) {
        offset += increment;
        next = siblings2[offset];
      }
    }
    return next;
  }
}

// node_modules/hast-util-to-html/lib/omission/omission.js
var own4 = {}.hasOwnProperty;
function omission(handlers2) {
  return omit;
  function omit(node, index, parent) {
    return own4.call(handlers2, node.tagName) && handlers2[node.tagName](node, index, parent);
  }
}

// node_modules/hast-util-to-html/lib/omission/closing.js
var closing = omission({
  body,
  caption: headOrColgroupOrCaption,
  colgroup: headOrColgroupOrCaption,
  dd,
  dt,
  head: headOrColgroupOrCaption,
  html: html3,
  li,
  optgroup,
  option,
  p,
  rp: rubyElement,
  rt: rubyElement,
  tbody,
  td: cells,
  tfoot,
  th: cells,
  thead,
  tr
});
function headOrColgroupOrCaption(_3, index, parent) {
  const next = siblingAfter(parent, index, true);
  return !next || next.type !== "comment" && !(next.type === "text" && whitespace(next.value.charAt(0)));
}
function html3(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type !== "comment";
}
function body(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type !== "comment";
}
function p(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return next ? next.type === "element" && (next.tagName === "address" || next.tagName === "article" || next.tagName === "aside" || next.tagName === "blockquote" || next.tagName === "details" || next.tagName === "div" || next.tagName === "dl" || next.tagName === "fieldset" || next.tagName === "figcaption" || next.tagName === "figure" || next.tagName === "footer" || next.tagName === "form" || next.tagName === "h1" || next.tagName === "h2" || next.tagName === "h3" || next.tagName === "h4" || next.tagName === "h5" || next.tagName === "h6" || next.tagName === "header" || next.tagName === "hgroup" || next.tagName === "hr" || next.tagName === "main" || next.tagName === "menu" || next.tagName === "nav" || next.tagName === "ol" || next.tagName === "p" || next.tagName === "pre" || next.tagName === "section" || next.tagName === "table" || next.tagName === "ul") : !parent || // Confusing parent.
  !(parent.type === "element" && (parent.tagName === "a" || parent.tagName === "audio" || parent.tagName === "del" || parent.tagName === "ins" || parent.tagName === "map" || parent.tagName === "noscript" || parent.tagName === "video"));
}
function li(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && next.tagName === "li";
}
function dt(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return Boolean(
    next && next.type === "element" && (next.tagName === "dt" || next.tagName === "dd")
  );
}
function dd(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && (next.tagName === "dt" || next.tagName === "dd");
}
function rubyElement(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && (next.tagName === "rp" || next.tagName === "rt");
}
function optgroup(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && next.tagName === "optgroup";
}
function option(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && (next.tagName === "option" || next.tagName === "optgroup");
}
function thead(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return Boolean(
    next && next.type === "element" && (next.tagName === "tbody" || next.tagName === "tfoot")
  );
}
function tbody(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && (next.tagName === "tbody" || next.tagName === "tfoot");
}
function tfoot(_3, index, parent) {
  return !siblingAfter(parent, index);
}
function tr(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && next.tagName === "tr";
}
function cells(_3, index, parent) {
  const next = siblingAfter(parent, index);
  return !next || next.type === "element" && (next.tagName === "td" || next.tagName === "th");
}

// node_modules/hast-util-to-html/lib/omission/opening.js
var opening = omission({
  body: body2,
  colgroup,
  head,
  html: html4,
  tbody: tbody2
});
function html4(node) {
  const head2 = siblingAfter(node, -1);
  return !head2 || head2.type !== "comment";
}
function head(node) {
  const seen = /* @__PURE__ */ new Set();
  for (const child2 of node.children) {
    if (child2.type === "element" && (child2.tagName === "base" || child2.tagName === "title")) {
      if (seen.has(child2.tagName)) return false;
      seen.add(child2.tagName);
    }
  }
  const child = node.children[0];
  return !child || child.type === "element";
}
function body2(node) {
  const head2 = siblingAfter(node, -1, true);
  return !head2 || head2.type !== "comment" && !(head2.type === "text" && whitespace(head2.value.charAt(0))) && !(head2.type === "element" && (head2.tagName === "meta" || head2.tagName === "link" || head2.tagName === "script" || head2.tagName === "style" || head2.tagName === "template"));
}
function colgroup(node, index, parent) {
  const previous = siblingBefore(parent, index);
  const head2 = siblingAfter(node, -1, true);
  if (parent && previous && previous.type === "element" && previous.tagName === "colgroup" && closing(previous, parent.children.indexOf(previous), parent)) {
    return false;
  }
  return Boolean(head2 && head2.type === "element" && head2.tagName === "col");
}
function tbody2(node, index, parent) {
  const previous = siblingBefore(parent, index);
  const head2 = siblingAfter(node, -1);
  if (parent && previous && previous.type === "element" && (previous.tagName === "thead" || previous.tagName === "tbody") && closing(previous, parent.children.indexOf(previous), parent)) {
    return false;
  }
  return Boolean(head2 && head2.type === "element" && head2.tagName === "tr");
}

// node_modules/hast-util-to-html/lib/handle/element.js
var constants2 = {
  // See: <https://html.spec.whatwg.org/#attribute-name-state>.
  name: [
    ["	\n\f\r &/=>".split(""), "	\n\f\r \"&'/=>`".split("")],
    [`\0	
\f\r "&'/<=>`.split(""), "\0	\n\f\r \"&'/<=>`".split("")]
  ],
  // See: <https://html.spec.whatwg.org/#attribute-value-(unquoted)-state>.
  unquoted: [
    ["	\n\f\r &>".split(""), "\0	\n\f\r \"&'<=>`".split("")],
    ["\0	\n\f\r \"&'<=>`".split(""), "\0	\n\f\r \"&'<=>`".split("")]
  ],
  // See: <https://html.spec.whatwg.org/#attribute-value-(single-quoted)-state>.
  single: [
    ["&'".split(""), "\"&'`".split("")],
    ["\0&'".split(""), "\0\"&'`".split("")]
  ],
  // See: <https://html.spec.whatwg.org/#attribute-value-(double-quoted)-state>.
  double: [
    ['"&'.split(""), "\"&'`".split("")],
    ['\0"&'.split(""), "\0\"&'`".split("")]
  ]
};
function element(node, index, parent, state) {
  const schema = state.schema;
  const omit = schema.space === "svg" ? false : state.settings.omitOptionalTags;
  let selfClosing = schema.space === "svg" ? state.settings.closeEmptyElements : state.settings.voids.includes(node.tagName.toLowerCase());
  const parts = [];
  let last;
  if (schema.space === "html" && node.tagName === "svg") {
    state.schema = svg;
  }
  const attributes = serializeAttributes(state, node.properties);
  const content3 = state.all(
    schema.space === "html" && node.tagName === "template" ? node.content : node
  );
  state.schema = schema;
  if (content3) selfClosing = false;
  if (attributes || !omit || !opening(node, index, parent)) {
    parts.push("<", node.tagName, attributes ? " " + attributes : "");
    if (selfClosing && (schema.space === "svg" || state.settings.closeSelfClosing)) {
      last = attributes.charAt(attributes.length - 1);
      if (!state.settings.tightSelfClosing || last === "/" || last && last !== '"' && last !== "'") {
        parts.push(" ");
      }
      parts.push("/");
    }
    parts.push(">");
  }
  parts.push(content3);
  if (!selfClosing && (!omit || !closing(node, index, parent))) {
    parts.push("</" + node.tagName + ">");
  }
  return parts.join("");
}
function serializeAttributes(state, properties) {
  const values2 = [];
  let index = -1;
  let key2;
  if (properties) {
    for (key2 in properties) {
      if (properties[key2] !== null && properties[key2] !== void 0) {
        const value = serializeAttribute(state, key2, properties[key2]);
        if (value) values2.push(value);
      }
    }
  }
  while (++index < values2.length) {
    const last = state.settings.tightAttributes ? values2[index].charAt(values2[index].length - 1) : void 0;
    if (index !== values2.length - 1 && last !== '"' && last !== "'") {
      values2[index] += " ";
    }
  }
  return values2.join("");
}
function serializeAttribute(state, key2, value) {
  const info = find(state.schema, key2);
  const x = state.settings.allowParseErrors && state.schema.space === "html" ? 0 : 1;
  const y = state.settings.allowDangerousCharacters ? 0 : 1;
  let quote = state.quote;
  let result;
  if (info.overloadedBoolean && (value === info.attribute || value === "")) {
    value = true;
  } else if ((info.boolean || info.overloadedBoolean) && (typeof value !== "string" || value === info.attribute || value === "")) {
    value = Boolean(value);
  }
  if (value === null || value === void 0 || value === false || typeof value === "number" && Number.isNaN(value)) {
    return "";
  }
  const name = stringifyEntities(
    info.attribute,
    Object.assign({}, state.settings.characterReferences, {
      // Always encode without parse errors in non-HTML.
      subset: constants2.name[x][y]
    })
  );
  if (value === true) return name;
  value = Array.isArray(value) ? (info.commaSeparated ? stringify : stringify2)(value, {
    padLeft: !state.settings.tightCommaSeparatedLists
  }) : String(value);
  if (state.settings.collapseEmptyAttributes && !value) return name;
  if (state.settings.preferUnquoted) {
    result = stringifyEntities(
      value,
      Object.assign({}, state.settings.characterReferences, {
        attribute: true,
        subset: constants2.unquoted[x][y]
      })
    );
  }
  if (result !== value) {
    if (state.settings.quoteSmart && ccount(value, quote) > ccount(value, state.alternative)) {
      quote = state.alternative;
    }
    result = quote + stringifyEntities(
      value,
      Object.assign({}, state.settings.characterReferences, {
        // Always encode without parse errors in non-HTML.
        subset: (quote === "'" ? constants2.single : constants2.double)[x][y],
        attribute: true
      })
    ) + quote;
  }
  return name + (result ? "=" + result : result);
}

// node_modules/hast-util-to-html/lib/handle/text.js
var textEntitySubset = ["<", "&"];
function text4(node, _3, parent, state) {
  return parent && parent.type === "element" && (parent.tagName === "script" || parent.tagName === "style") ? node.value : stringifyEntities(
    node.value,
    Object.assign({}, state.settings.characterReferences, {
      subset: textEntitySubset
    })
  );
}

// node_modules/hast-util-to-html/lib/handle/raw.js
function raw(node, index, parent, state) {
  return state.settings.allowDangerousHtml ? node.value : text4(node, index, parent, state);
}

// node_modules/hast-util-to-html/lib/handle/root.js
function root2(node, _1, _22, state) {
  return state.all(node);
}

// node_modules/hast-util-to-html/lib/handle/index.js
var handle = zwitch("type", {
  invalid,
  unknown,
  handlers: { comment, doctype, element, raw, root: root2, text: text4 }
});
function invalid(node) {
  throw new Error("Expected node, not `" + node + "`");
}
function unknown(node_) {
  const node = (
    /** @type {Nodes} */
    node_
  );
  throw new Error("Cannot compile unknown node `" + node.type + "`");
}

// node_modules/hast-util-to-html/lib/index.js
var emptyOptions2 = {};
var emptyCharacterReferences = {};
var emptyChildren2 = [];
function toHtml(tree, options) {
  const options_ = options || emptyOptions2;
  const quote = options_.quote || '"';
  const alternative = quote === '"' ? "'" : '"';
  if (quote !== '"' && quote !== "'") {
    throw new Error("Invalid quote `" + quote + "`, expected `'` or `\"`");
  }
  const state = {
    one,
    all,
    settings: {
      omitOptionalTags: options_.omitOptionalTags || false,
      allowParseErrors: options_.allowParseErrors || false,
      allowDangerousCharacters: options_.allowDangerousCharacters || false,
      quoteSmart: options_.quoteSmart || false,
      preferUnquoted: options_.preferUnquoted || false,
      tightAttributes: options_.tightAttributes || false,
      upperDoctype: options_.upperDoctype || false,
      tightDoctype: options_.tightDoctype || false,
      bogusComments: options_.bogusComments || false,
      tightCommaSeparatedLists: options_.tightCommaSeparatedLists || false,
      tightSelfClosing: options_.tightSelfClosing || false,
      collapseEmptyAttributes: options_.collapseEmptyAttributes || false,
      allowDangerousHtml: options_.allowDangerousHtml || false,
      voids: options_.voids || htmlVoidElements,
      characterReferences: options_.characterReferences || emptyCharacterReferences,
      closeSelfClosing: options_.closeSelfClosing || false,
      closeEmptyElements: options_.closeEmptyElements || false
    },
    schema: options_.space === "svg" ? svg : html,
    quote,
    alternative
  };
  return state.one(
    Array.isArray(tree) ? { type: "root", children: tree } : tree,
    void 0,
    void 0
  );
}
function one(node, index, parent) {
  return handle(node, index, parent, this);
}
function all(parent) {
  const results = [];
  const children = parent && parent.children || emptyChildren2;
  let index = -1;
  while (++index < children.length) {
    results[index] = this.one(children[index], index, parent);
  }
  return results.join("");
}

// node_modules/rehype-stringify/lib/index.js
function rehypeStringify(options) {
  const self = this;
  const settings = { ...self.data("settings"), ...options };
  self.compiler = compiler2;
  function compiler2(tree) {
    return toHtml(tree, settings);
  }
}

// node_modules/@blocknote/core/dist/blocknote.js
var Fe = Object.defineProperty;
var Ve = (n, e, t2) => e in n ? Fe(n, e, { enumerable: true, configurable: true, writable: true, value: t2 }) : n[e] = t2;
var k3 = (n, e, t2) => Ve(n, typeof e != "symbol" ? e + "" : e, t2);
function Xt2(n, e) {
  const t2 = [
    {
      tag: `[data-inline-content-type="${n.type}"]`,
      contentElement: (o) => {
        const s = o;
        return s.matches("[data-editable]") ? s : s.querySelector("[data-editable]") || s;
      }
    }
  ];
  return e && t2.push({
    tag: "*",
    getAttrs(o) {
      if (typeof o == "string")
        return false;
      const s = e == null ? void 0 : e(o);
      return s === void 0 ? false : s;
    }
  }), t2;
}
function ls(n, e) {
  var o;
  const t2 = Node3.create({
    name: n.type,
    inline: true,
    group: "inline",
    draggable: (o = e.meta) == null ? void 0 : o.draggable,
    selectable: n.content === "styled",
    atom: n.content === "none",
    content: n.content === "styled" ? "inline*" : "",
    addAttributes() {
      return kt2(n.propSchema);
    },
    addKeyboardShortcuts() {
      return Co(n);
    },
    parseHTML() {
      return Xt2(
        n,
        e.parse
      );
    },
    renderHTML({ node: s }) {
      const r2 = this.options.editor, i3 = e.render.call(
        { renderType: "dom", props: void 0 },
        wt(
          s,
          r2.schema.inlineContentSchema,
          r2.schema.styleSchema
        ),
        // TODO: fix cast
        () => {
        },
        r2
      );
      return bo(
        i3,
        n.type,
        s.attrs,
        n.propSchema
      );
    },
    addNodeView() {
      return (s) => {
        const { node: r2, getPos: i3 } = s, l = this.options.editor, a2 = e.render.call(
          { renderType: "nodeView", props: s },
          wt(
            r2,
            l.schema.inlineContentSchema,
            l.schema.styleSchema
          ),
          // TODO: fix cast
          (c) => {
            const d = T([c], l.pmSchema), u2 = i3();
            u2 && l.transact(
              (p2) => p2.replaceWith(u2, u2 + r2.nodeSize, d)
            );
          },
          l
        );
        return bo(
          a2,
          n.type,
          r2.attrs,
          n.propSchema
        );
      };
    }
  });
  return ko(
    t2,
    n.propSchema,
    {
      ...e,
      toExternalHTML: e.toExternalHTML,
      render(s, r2, i3) {
        const l = e.render(
          s,
          r2,
          i3
        );
        return bo(
          l,
          n.type,
          s.props,
          n.propSchema
        );
      }
    }
  );
}
function Zt3(n, e, t2, o = "before") {
  const s = typeof t2 == "string" ? t2 : t2.id, r2 = ht(n), i3 = e.map(
    (d) => bt(d, r2)
  ), l = Bt(s, n.doc);
  if (!l)
    throw new Error(`Block with ID ${s} not found`);
  let a2 = l.posBeforeNode;
  return o === "after" && (a2 += l.node.nodeSize), n.step(
    new ReplaceStep(a2, a2, new Slice(Fragment.from(i3), 0, 0))
  ), i3.map(
    (d) => L(d, r2)
  );
}
function Q3(n) {
  if (!n || n.type.name !== "column")
    throw new Error("Invalid columnPos: does not point to column node.");
  const e = n.firstChild;
  if (!e)
    throw new Error("Invalid column: does not have child node.");
  const t2 = e.firstChild;
  if (!t2)
    throw new Error("Invalid blockContainer: does not have child node.");
  return n.childCount === 1 && e.childCount === 1 && t2.type.name === "paragraph" && t2.content.content.length === 0;
}
function eo(n, e) {
  const t2 = n.doc.resolve(e), o = t2.nodeAfter;
  if (!o || o.type.name !== "columnList")
    throw new Error(
      "Invalid columnListPos: does not point to columnList node."
    );
  for (let s = o.childCount - 1; s >= 0; s--) {
    const r2 = n.doc.resolve(t2.pos + 1).posAtIndex(s), l = n.doc.resolve(r2).nodeAfter;
    if (!l || l.type.name !== "column")
      throw new Error("Invalid columnPos: does not point to column node.");
    Q3(l) && n.delete(r2, r2 + l.nodeSize);
  }
}
function H3(n, e) {
  eo(n, e);
  const o = n.doc.resolve(e).nodeAfter;
  if (!o || o.type.name !== "columnList")
    throw new Error(
      "Invalid columnListPos: does not point to columnList node."
    );
  if (o.childCount > 2)
    return;
  if (o.childCount < 2)
    throw new Error("Invalid columnList: contains fewer than two children.");
  const s = e + 1, i3 = n.doc.resolve(s).nodeAfter, l = e + o.nodeSize - 1, c = n.doc.resolve(l).nodeBefore;
  if (!i3 || !c)
    throw new Error("Invalid columnList: does not contain children.");
  const d = Q3(i3), u2 = Q3(c);
  if (d && u2) {
    n.delete(e, e + o.nodeSize);
    return;
  }
  if (d) {
    n.step(
      new ReplaceAroundStep(
        // Replaces `columnList`.
        e,
        e + o.nodeSize,
        // Replaces with content of last `column`.
        l - c.nodeSize + 1,
        l - 1,
        // Doesn't append anything.
        Slice.empty,
        0,
        false
      )
    );
    return;
  }
  if (u2) {
    n.step(
      new ReplaceAroundStep(
        // Replaces `columnList`.
        e,
        e + o.nodeSize,
        // Replaces with content of first `column`.
        s + 1,
        s + i3.nodeSize - 1,
        // Doesn't append anything.
        Slice.empty,
        0,
        false
      )
    );
    return;
  }
}
function ae2(n, e, t2) {
  const o = ht(n), s = t2.map(
    (u2) => bt(u2, o)
  ), r2 = new Set(
    e.map(
      (u2) => typeof u2 == "string" ? u2 : u2.id
    )
  ), i3 = [], l = /* @__PURE__ */ new Set(), a2 = typeof e[0] == "string" ? e[0] : e[0].id;
  let c = 0;
  if (n.doc.descendants((u2, p2) => {
    if (r2.size === 0)
      return false;
    if (!u2.type.isInGroup("bnBlock") || !r2.has(u2.attrs.id))
      return true;
    if (i3.push(L(u2, o)), r2.delete(u2.attrs.id), t2.length > 0 && u2.attrs.id === a2) {
      const b4 = n.doc.nodeSize;
      n.insert(p2, s);
      const g = n.doc.nodeSize;
      c += b4 - g;
    }
    const h3 = n.doc.nodeSize, f4 = n.doc.resolve(p2 - c);
    f4.node().type.name === "column" ? l.add(f4.before(-1)) : f4.node().type.name === "columnList" && l.add(f4.before()), f4.node().type.name === "blockGroup" && f4.node(f4.depth - 1).type.name !== "doc" && f4.node().childCount === 1 ? n.delete(f4.before(), f4.after()) : n.delete(p2 - c, p2 - c + u2.nodeSize);
    const m3 = n.doc.nodeSize;
    return c += h3 - m3, false;
  }), r2.size > 0) {
    const u2 = [...r2].join(`
`);
    throw Error(
      "Blocks with the following IDs could not be found in the editor: " + u2
    );
  }
  return l.forEach((u2) => H3(n, u2)), { insertedBlocks: s.map(
    (u2) => L(u2, o)
  ), removedBlocks: i3 };
}
function to(n, e, t2, o, s) {
  let r2;
  if (e)
    if (typeof e == "string")
      r2 = T([e], n.pmSchema, o);
    else if (Array.isArray(e))
      r2 = T(e, n.pmSchema, o);
    else if (e.type === "tableContent")
      r2 = kt(e, n.pmSchema);
    else
      throw new O(e.type);
  else throw new Error("blockContent is required");
  const l = ((s == null ? void 0 : s.document) ?? document).createDocumentFragment();
  for (const a2 of r2)
    if (a2.type.name !== "text" && n.schema.inlineContentSchema[a2.type.name]) {
      const c = n.schema.inlineContentSpecs[a2.type.name].implementation;
      if (c) {
        const d = wt(
          a2,
          n.schema.inlineContentSchema,
          n.schema.styleSchema
        ), u2 = c.render.call(
          {
            renderType: "dom",
            props: void 0
          },
          d,
          () => {
          },
          n
        );
        if (u2) {
          if (l.appendChild(u2.dom), u2.contentDOM) {
            const p2 = t2.serializeFragment(
              a2.content,
              s
            );
            u2.contentDOM.dataset.editable = "", u2.contentDOM.appendChild(p2);
          }
          continue;
        }
      }
    } else if (a2.type.name === "text") {
      let c = document.createTextNode(
        a2.textContent
      );
      for (const d of a2.marks.toReversed())
        if (d.type.name in n.schema.styleSpecs) {
          const u2 = n.schema.styleSpecs[d.type.name].implementation.render(d.attrs.stringValue, n);
          u2.contentDOM.appendChild(c), c = u2.dom;
        } else {
          const u2 = d.type.spec.toDOM(d, true), p2 = DOMSerializer.renderSpec(document, u2);
          p2.contentDOM.appendChild(c), c = p2.dom;
        }
      l.appendChild(c);
    } else {
      const c = t2.serializeFragment(
        Fragment.from([a2]),
        s
      );
      l.appendChild(c);
    }
  return l;
}
function oo(n, e, t2, o) {
  var u2, p2, h3, f4, m3;
  const s = n.pmSchema.nodes.blockContainer, r2 = e.props || {};
  for (const [b4, g] of Object.entries(
    n.schema.blockSchema[e.type].propSchema
  ))
    !(b4 in r2) && g.default !== void 0 && (r2[b4] = g.default);
  const i3 = e.children || [], a2 = n.blockImplementations[e.type].implementation.render.call(
    {
      renderType: "dom",
      props: void 0
    },
    { ...e, props: r2, children: i3 },
    n
  );
  if (a2.contentDOM && e.content) {
    const b4 = to(
      n,
      e.content,
      // TODO
      t2,
      e.type,
      o
    );
    a2.contentDOM.appendChild(b4);
  }
  if (n.pmSchema.nodes[e.type].isInGroup("bnBlock")) {
    if (e.children && e.children.length > 0) {
      const b4 = Se(
        n,
        e.children,
        t2,
        o
      );
      (u2 = a2.contentDOM) == null || u2.append(b4);
    }
    return a2.dom;
  }
  const d = (h3 = (p2 = s.spec) == null ? void 0 : p2.toDOM) == null ? void 0 : h3.call(
    p2,
    s.create({
      id: e.id,
      ...r2
    })
  );
  return (f4 = d.contentDOM) == null || f4.appendChild(a2.dom), e.children && e.children.length > 0 && ((m3 = d.contentDOM) == null || m3.appendChild(
    xe(n, e.children, t2, o)
  )), d.dom;
}
function Se(n, e, t2, o) {
  const r2 = ((o == null ? void 0 : o.document) ?? document).createDocumentFragment();
  for (const i3 of e) {
    const l = oo(n, i3, t2, o);
    r2.appendChild(l);
  }
  return r2;
}
var xe = (n, e, t2, o) => {
  var l;
  const s = n.pmSchema.nodes.blockGroup, r2 = s.spec.toDOM(s.create({})), i3 = Se(n, e, t2, o);
  return (l = r2.contentDOM) == null || l.appendChild(i3), r2.dom;
};
var no = (n) => (n.querySelectorAll(
  '[data-content-type="numberedListItem"]'
).forEach((t2) => {
  var s, r2;
  const o = (r2 = (s = t2.closest(".bn-block-outer")) == null ? void 0 : s.previousElementSibling) == null ? void 0 : r2.querySelector(
    '[data-content-type="numberedListItem"]'
  );
  if (!o)
    t2.setAttribute(
      "data-index",
      t2.getAttribute("data-start") || "1"
    );
  else {
    const i3 = o.getAttribute("data-index");
    t2.setAttribute(
      "data-index",
      (parseInt(i3 || "0") + 1).toString()
    );
  }
}), n);
var so = (n) => (n.querySelectorAll(
  '[data-content-type="checkListItem"] input'
).forEach((t2) => {
  t2.disabled = true;
}), n);
var ro2 = (n) => (n.querySelectorAll(
  '.bn-toggle-wrapper[data-show-children="false"]'
).forEach((t2) => {
  t2.setAttribute("data-show-children", "true");
}), n);
var io = (n) => (n.querySelectorAll('[data-content-type="table"] table').forEach((t2) => {
  t2.setAttribute(
    "style",
    `--default-cell-min-width: ${Oe}px;`
  ), t2.setAttribute("data-show-children", "true");
}), n);
var ao = (n) => (n.querySelectorAll('[data-content-type="table"] table').forEach((t2) => {
  var r2;
  const o = document.createElement("div");
  o.className = "tableWrapper";
  const s = document.createElement("div");
  s.className = "tableWrapper-inner", o.appendChild(s), (r2 = t2.parentElement) == null || r2.appendChild(o), o.appendChild(t2);
}), n);
var co = (n) => (n.querySelectorAll(
  ".bn-inline-content:empty"
).forEach((t2) => {
  const o = document.createElement("span");
  o.className = "ProseMirror-trailingBreak", o.setAttribute("style", "display: inline-block;"), t2.appendChild(o);
}), n);
var lo = (n, e) => {
  const t2 = DOMSerializer.fromSchema(n), o = [
    no,
    so,
    ro2,
    io,
    ao,
    co
  ];
  return {
    serializeBlocks: (s, r2) => {
      let i3 = xe(
        e,
        s,
        t2,
        r2
      );
      for (const l of o)
        i3 = l(i3);
      return i3.outerHTML;
    }
  };
};
function uo(n) {
  return n.transact((e) => {
    const t2 = Y(e.doc, e.selection.anchor);
    if (e.selection instanceof CellSelection)
      return {
        type: "cell",
        anchorBlockId: t2.node.attrs.id,
        anchorCellOffset: e.selection.$anchorCell.pos - t2.posBeforeNode,
        headCellOffset: e.selection.$headCell.pos - t2.posBeforeNode
      };
    if (e.selection instanceof NodeSelection)
      return {
        type: "node",
        anchorBlockId: t2.node.attrs.id
      };
    {
      const o = Y(e.doc, e.selection.head);
      return {
        type: "text",
        anchorBlockId: t2.node.attrs.id,
        headBlockId: o.node.attrs.id,
        anchorOffset: e.selection.anchor - t2.posBeforeNode,
        headOffset: e.selection.head - o.posBeforeNode
      };
    }
  });
}
function po2(n, e) {
  var s, r2;
  const t2 = (s = Bt(e.anchorBlockId, n.doc)) == null ? void 0 : s.posBeforeNode;
  if (t2 === void 0)
    throw new Error(
      `Could not find block with ID ${e.anchorBlockId} to update selection`
    );
  let o;
  if (e.type === "cell")
    o = CellSelection.create(
      n.doc,
      t2 + e.anchorCellOffset,
      t2 + e.headCellOffset
    );
  else if (e.type === "node")
    o = NodeSelection.create(n.doc, t2 + 1);
  else {
    const i3 = (r2 = Bt(e.headBlockId, n.doc)) == null ? void 0 : r2.posBeforeNode;
    if (i3 === void 0)
      throw new Error(
        `Could not find block with ID ${e.headBlockId} to update selection`
      );
    o = TextSelection.create(
      n.doc,
      t2 + e.anchorOffset,
      i3 + e.headOffset
    );
  }
  n.setSelection(o);
}
function X3(n) {
  return n.map((e) => e.type === "columnList" ? e.children.map((t2) => X3(t2.children)).flat() : {
    ...e,
    children: X3(e.children)
  }).flat();
}
function Ee(n, e, t2) {
  n.transact((o) => {
    var i3;
    const s = ((i3 = n.getSelection()) == null ? void 0 : i3.blocks) || [
      n.getTextCursorPosition().block
    ], r2 = uo(n);
    n.removeBlocks(s), n.insertBlocks(X3(s), e, t2), po2(o, r2);
  });
}
function Pe(n) {
  return !n || n.type !== "columnList";
}
function Te2(n, e, t2) {
  let o, s;
  if (e ? e.children.length > 0 ? (o = e.children[e.children.length - 1], s = "after") : (o = e, s = "before") : t2 && (o = t2, s = "before"), !o || !s)
    return;
  const r2 = n.getParentBlock(o);
  return Pe(r2) ? { referenceBlock: o, placement: s } : Te2(
    n,
    s === "after" ? o : n.getPrevBlock(o),
    r2
  );
}
function Me(n, e, t2) {
  let o, s;
  if (e ? e.children.length > 0 ? (o = e.children[0], s = "before") : (o = e, s = "after") : t2 && (o = t2, s = "after"), !o || !s)
    return;
  const r2 = n.getParentBlock(o);
  return Pe(r2) ? { referenceBlock: o, placement: s } : Me(
    n,
    s === "before" ? o : n.getNextBlock(o),
    r2
  );
}
function fo2(n) {
  n.transact(() => {
    const e = n.getSelection(), t2 = (e == null ? void 0 : e.blocks[0]) || n.getTextCursorPosition().block, o = Te2(
      n,
      n.getPrevBlock(t2),
      n.getParentBlock(t2)
    );
    o && Ee(
      n,
      o.referenceBlock,
      o.placement
    );
  });
}
function ho2(n) {
  n.transact(() => {
    const e = n.getSelection(), t2 = (e == null ? void 0 : e.blocks[(e == null ? void 0 : e.blocks.length) - 1]) || n.getTextCursorPosition().block, o = Me(
      n,
      n.getNextBlock(t2),
      n.getParentBlock(t2)
    );
    o && Ee(
      n,
      o.referenceBlock,
      o.placement
    );
  });
}
function mo2(n, e, t2) {
  const { $from: o, $to: s } = n.selection, r2 = o.blockRange(
    s,
    (f4) => f4.childCount > 0 && (f4.type.name === "blockGroup" || f4.type.name === "column")
    // change necessary to not look at first item child type
  );
  if (!r2)
    return false;
  const i3 = r2.startIndex;
  if (i3 === 0)
    return false;
  const a2 = r2.parent.child(i3 - 1);
  if (a2.type !== e)
    return false;
  const c = a2.lastChild && a2.lastChild.type === t2, d = Fragment.from(c ? e.create() : null), u2 = new Slice(
    Fragment.from(
      e.create(null, Fragment.from(t2.create(null, d)))
      // change necessary to create "groupType" instead of parent.type
    ),
    c ? 3 : 1,
    0
  ), p2 = r2.start, h3 = r2.end;
  return n.step(
    new ReplaceAroundStep(
      p2 - (c ? 3 : 1),
      h3,
      p2,
      h3,
      u2,
      1,
      true
    )
  ).scrollIntoView(), true;
}
function we2(n) {
  return n.transact((e) => mo2(
    e,
    n.pmSchema.nodes.blockContainer,
    n.pmSchema.nodes.blockGroup
  ));
}
function ko2(n) {
  n._tiptapEditor.commands.liftListItem("blockContainer");
}
function bo2(n) {
  return n.transact((e) => {
    const { bnBlock: t2 } = Ot(e);
    return e.doc.resolve(t2.beforePos).nodeBefore !== null;
  });
}
function go2(n) {
  return n.transact((e) => {
    const { bnBlock: t2 } = Ot(e);
    return e.doc.resolve(t2.beforePos).depth > 1;
  });
}
function Bo2(n, e) {
  const t2 = typeof e == "string" ? e : e.id, o = ht(n), s = Bt(t2, n);
  if (s)
    return L(s.node, o);
}
function yo2(n, e) {
  const t2 = typeof e == "string" ? e : e.id, o = Bt(t2, n), s = ht(n);
  if (!o)
    return;
  const i3 = n.resolve(o.posBeforeNode).nodeBefore;
  if (i3)
    return L(i3, s);
}
function Co2(n, e) {
  const t2 = typeof e == "string" ? e : e.id, o = Bt(t2, n), s = ht(n);
  if (!o)
    return;
  const i3 = n.resolve(
    o.posBeforeNode + o.node.nodeSize
  ).nodeAfter;
  if (i3)
    return L(i3, s);
}
function So2(n, e) {
  const t2 = typeof e == "string" ? e : e.id, o = ht(n), s = Bt(t2, n);
  if (!s)
    return;
  const r2 = n.resolve(s.posBeforeNode), i3 = r2.node(), l = r2.node(-1), a2 = l.type.name !== "doc" ? i3.type.name === "blockGroup" ? l : i3 : void 0;
  if (a2)
    return L(a2, o);
}
var xo2 = class {
  constructor(e) {
    this.editor = e;
  }
  /**
   * Gets a snapshot of all top-level (non-nested) blocks in the editor.
   * @returns A snapshot of all top-level (non-nested) blocks in the editor.
   */
  get document() {
    return this.editor.transact((e) => St(e.doc, this.editor.pmSchema));
  }
  /**
   * Gets a snapshot of an existing block from the editor.
   * @param blockIdentifier The identifier of an existing block that should be
   * retrieved.
   * @returns The block that matches the identifier, or `undefined` if no
   * matching block was found.
   */
  getBlock(e) {
    return this.editor.transact((t2) => Bo2(t2.doc, e));
  }
  /**
   * Gets a snapshot of the previous sibling of an existing block from the
   * editor.
   * @param blockIdentifier The identifier of an existing block for which the
   * previous sibling should be retrieved.
   * @returns The previous sibling of the block that matches the identifier.
   * `undefined` if no matching block was found, or it's the first child/block
   * in the document.
   */
  getPrevBlock(e) {
    return this.editor.transact((t2) => yo2(t2.doc, e));
  }
  /**
   * Gets a snapshot of the next sibling of an existing block from the editor.
   * @param blockIdentifier The identifier of an existing block for which the
   * next sibling should be retrieved.
   * @returns The next sibling of the block that matches the identifier.
   * `undefined` if no matching block was found, or it's the last child/block in
   * the document.
   */
  getNextBlock(e) {
    return this.editor.transact((t2) => Co2(t2.doc, e));
  }
  /**
   * Gets a snapshot of the parent of an existing block from the editor.
   * @param blockIdentifier The identifier of an existing block for which the
   * parent should be retrieved.
   * @returns The parent of the block that matches the identifier. `undefined`
   * if no matching block was found, or the block isn't nested.
   */
  getParentBlock(e) {
    return this.editor.transact(
      (t2) => So2(t2.doc, e)
    );
  }
  /**
   * Traverses all blocks in the editor depth-first, and executes a callback for each.
   * @param callback The callback to execute for each block. Returning `false` stops the traversal.
   * @param reverse Whether the blocks should be traversed in reverse order.
   */
  forEachBlock(e, t2 = false) {
    const o = this.document.slice();
    t2 && o.reverse();
    function s(r2) {
      for (const i3 of r2) {
        if (e(i3) === false)
          return false;
        const l = t2 ? i3.children.slice().reverse() : i3.children;
        if (!s(l))
          return false;
      }
      return true;
    }
    s(o);
  }
  /**
   * Inserts new blocks into the editor. If a block's `id` is undefined, BlockNote generates one automatically. Throws an
   * error if the reference block could not be found.
   * @param blocksToInsert An array of partial blocks that should be inserted.
   * @param referenceBlock An identifier for an existing block, at which the new blocks should be inserted.
   * @param placement Whether the blocks should be inserted just before, just after, or nested inside the
   * `referenceBlock`.
   */
  insertBlocks(e, t2, o = "before") {
    return this.editor.transact(
      (s) => Zt3(s, e, t2, o)
    );
  }
  /**
   * Updates an existing block in the editor. Since updatedBlock is a PartialBlock object, some fields might not be
   * defined. These undefined fields are kept as-is from the existing block. Throws an error if the block to update could
   * not be found.
   * @param blockToUpdate The block that should be updated.
   * @param update A partial block which defines how the existing block should be changed.
   */
  updateBlock(e, t2) {
    return this.editor.transact((o) => vo(o, e, t2));
  }
  /**
   * Removes existing blocks from the editor. Throws an error if any of the blocks could not be found.
   * @param blocksToRemove An array of identifiers for existing blocks that should be removed.
   */
  removeBlocks(e) {
    return this.editor.transact(
      (t2) => ae2(t2, e, []).removedBlocks
    );
  }
  /**
   * Replaces existing blocks in the editor with new blocks. If the blocks that should be removed are not adjacent or
   * are at different nesting levels, `blocksToInsert` will be inserted at the position of the first block in
   * `blocksToRemove`. Throws an error if any of the blocks to remove could not be found.
   * @param blocksToRemove An array of blocks that should be replaced.
   * @param blocksToInsert An array of partial blocks to replace the old ones with.
   */
  replaceBlocks(e, t2) {
    return this.editor.transact(
      (o) => ae2(o, e, t2)
    );
  }
  /**
   * Checks if the block containing the text cursor can be nested.
   */
  canNestBlock() {
    return bo2(this.editor);
  }
  /**
   * Nests the block containing the text cursor into the block above it.
   */
  nestBlock() {
    we2(this.editor);
  }
  /**
   * Checks if the block containing the text cursor is nested.
   */
  canUnnestBlock() {
    return go2(this.editor);
  }
  /**
   * Lifts the block containing the text cursor out of its parent.
   */
  unnestBlock() {
    ko2(this.editor);
  }
  /**
   * Moves the selected blocks up. If the previous block has children, moves
   * them to the end of its children. If there is no previous block, but the
   * current blocks share a common parent, moves them out of & before it.
   */
  moveBlocksUp() {
    return fo2(this.editor);
  }
  /**
   * Moves the selected blocks down. If the next block has children, moves
   * them to the start of its children. If there is no next block, but the
   * current blocks share a common parent, moves them out of & after it.
   */
  moveBlocksDown() {
    return ho2(this.editor);
  }
};
var Eo2 = class extends f2 {
  constructor(e) {
    super(), this.editor = e, e.on("create", () => {
      e._tiptapEditor.on(
        "update",
        ({ transaction: t2, appendedTransactions: o }) => {
          this.emit("onChange", { editor: e, transaction: t2, appendedTransactions: o });
        }
      ), e._tiptapEditor.on("selectionUpdate", ({ transaction: t2 }) => {
        this.emit("onSelectionChange", { editor: e, transaction: t2 });
      }), e._tiptapEditor.on("mount", () => {
        this.emit("onMount", { editor: e });
      }), e._tiptapEditor.on("unmount", () => {
        this.emit("onUnmount", { editor: e });
      });
    });
  }
  /**
   * Register a callback that will be called when the editor changes.
   */
  onChange(e, t2 = true) {
    const o = ({
      transaction: s,
      appendedTransactions: r2
    }) => {
      !t2 && ce(s) || e(this.editor, {
        getChanges() {
          return Mt2(
            s,
            r2
          );
        }
      });
    };
    return this.on("onChange", o), () => {
      this.off("onChange", o);
    };
  }
  /**
   * Register a callback that will be called when the selection changes.
   */
  onSelectionChange(e, t2 = false) {
    const o = (s) => {
      !t2 && ce(s.transaction) || e(this.editor);
    };
    return this.on("onSelectionChange", o), () => {
      this.off("onSelectionChange", o);
    };
  }
  /**
   * Register a callback that will be called when the editor is mounted.
   */
  onMount(e) {
    return this.on("onMount", e), () => {
      this.off("onMount", e);
    };
  }
  /**
   * Register a callback that will be called when the editor is unmounted.
   */
  onUnmount(e) {
    return this.on("onUnmount", e), () => {
      this.off("onUnmount", e);
    };
  }
};
function ce(n) {
  return !!n.getMeta("y-sync$");
}
function Po3(n) {
  return Array.prototype.indexOf.call(n.parentElement.childNodes, n);
}
function To2(n) {
  return n.nodeType === 3 && !/\S/.test(n.nodeValue || "");
}
function Mo3(n) {
  n.querySelectorAll("li > ul, li > ol").forEach((e) => {
    const t2 = Po3(e), o = e.parentElement, s = Array.from(o.childNodes).slice(
      t2 + 1
    );
    e.remove(), s.forEach((r2) => {
      r2.remove();
    }), o.insertAdjacentElement("afterend", e), s.reverse().forEach((r2) => {
      if (To2(r2))
        return;
      const i3 = document.createElement("li");
      i3.append(r2), e.insertAdjacentElement("afterend", i3);
    }), o.childNodes.length === 0 && o.remove();
  });
}
function wo2(n) {
  n.querySelectorAll("li + ul, li + ol").forEach((e) => {
    var r2, i3;
    const t2 = e.previousElementSibling, o = document.createElement("div");
    t2.insertAdjacentElement("afterend", o), o.append(t2);
    const s = document.createElement("div");
    for (s.setAttribute("data-node-type", "blockGroup"), o.append(s); ((r2 = o.nextElementSibling) == null ? void 0 : r2.nodeName) === "UL" || ((i3 = o.nextElementSibling) == null ? void 0 : i3.nodeName) === "OL"; )
      s.append(o.nextElementSibling);
  });
}
var le = null;
function vo2() {
  return le || (le = document.implementation.createHTMLDocument("title"));
}
function Io2(n) {
  if (typeof n == "string") {
    const e = vo2().createElement("div");
    e.innerHTML = n, n = e;
  }
  return Mo3(n), wo2(n), n;
}
function ve(n, e) {
  const t2 = Io2(n), s = DOMParser.fromSchema(e).parse(t2, {
    topNode: e.nodes.blockGroup.create()
  }), r2 = [];
  for (let i3 = 0; i3 < s.childCount; i3++)
    r2.push(L(s.child(i3), e));
  return r2;
}
function Ao3(n, e) {
  const t2 = e.value ? e.value : "", o = {};
  e.lang && (o["data-language"] = e.lang);
  let s = {
    type: "element",
    tagName: "code",
    properties: o,
    children: [{ type: "text", value: t2 }]
  };
  return e.meta && (s.data = { meta: e.meta }), n.patch(e, s), s = n.applyData(e, s), s = {
    type: "element",
    tagName: "pre",
    properties: {},
    children: [s]
  }, n.patch(e, s), s;
}
function No3(n, e) {
  var r2;
  const t2 = String((e == null ? void 0 : e.url) || ""), o = e != null && e.title ? String(e.title) : void 0;
  let s = {
    type: "element",
    tagName: "video",
    properties: {
      src: t2,
      "data-name": o,
      "data-url": t2,
      controls: true
    },
    children: []
  };
  return (r2 = n.patch) == null || r2.call(n, e, s), s = n.applyData ? n.applyData(e, s) : s, s;
}
function Ie(n) {
  return unified().use(remarkParse).use(remarkGfm).use(remarkRehype, {
    handlers: {
      ...handlers,
      image: (t2, o) => {
        const s = String((o == null ? void 0 : o.url) || "");
        return mo(s) ? No3(t2, o) : handlers.image(t2, o);
      },
      code: Ao3,
      blockquote: (t2, o) => {
        const s = {
          type: "element",
          tagName: "blockquote",
          properties: {},
          // The only difference from the original is that we don't wrap the children with line endings
          children: t2.wrap(t2.all(o), false)
        };
        return t2.patch(o, s), t2.applyData(o, s);
      }
    }
  }).use(rehypeStringify).processSync(n).value;
}
function _o2(n, e) {
  const t2 = Ie(n);
  return ve(t2, e);
}
var Lo3 = class {
  constructor(e) {
    this.editor = e;
  }
  /**
   * Exports blocks into a simplified HTML string. To better conform to HTML standards, children of blocks which aren't list
   * items are un-nested in the output HTML.
   *
   * @param blocks An array of blocks that should be serialized into HTML.
   * @returns The blocks, serialized as an HTML string.
   */
  blocksToHTMLLossy(e = this.editor.document) {
    return Be(
      this.editor.pmSchema,
      this.editor
    ).exportBlocks(e, {});
  }
  /**
   * Serializes blocks into an HTML string in the format that would normally be rendered by the editor.
   *
   * Use this method if you want to server-side render HTML (for example, a blog post that has been edited in BlockNote)
   * and serve it to users without loading the editor on the client (i.e.: displaying the blog post)
   *
   * @param blocks An array of blocks that should be serialized into HTML.
   * @returns The blocks, serialized as an HTML string.
   */
  blocksToFullHTML(e = this.editor.document) {
    return lo(
      this.editor.pmSchema,
      this.editor
    ).serializeBlocks(e, {});
  }
  /**
   * Parses blocks from an HTML string. Tries to create `Block` objects out of any HTML block-level elements, and
   * `InlineNode` objects from any HTML inline elements, though not all element types are recognized. If BlockNote
   * doesn't recognize an HTML element's tag, it will parse it as a paragraph or plain text.
   * @param html The HTML string to parse blocks from.
   * @returns The blocks parsed from the HTML string.
   */
  tryParseHTMLToBlocks(e) {
    return ve(e, this.editor.pmSchema);
  }
  /**
   * Serializes blocks into a Markdown string. The output is simplified as Markdown does not support all features of
   * BlockNote - children of blocks which aren't list items are un-nested and certain styles are removed.
   * @param blocks An array of blocks that should be serialized into Markdown.
   * @returns The blocks, serialized as a Markdown string.
   */
  blocksToMarkdownLossy(e = this.editor.document) {
    return Uo(e, this.editor.pmSchema, this.editor, {});
  }
  /**
   * Creates a list of blocks from a Markdown string. Tries to create `Block` and `InlineNode` objects based on
   * Markdown syntax, though not all symbols are recognized. If BlockNote doesn't recognize a symbol, it will parse it
   * as text.
   * @param markdown The Markdown string to parse blocks from.
   * @returns The blocks parsed from the Markdown string.
   */
  tryParseMarkdownToBlocks(e) {
    return _o2(e, this.editor.pmSchema);
  }
  /**
   * Paste HTML into the editor. Defaults to converting HTML to BlockNote HTML.
   * @param html The HTML to paste.
   * @param raw Whether to paste the HTML as is, or to convert it to BlockNote HTML.
   */
  pasteHTML(e, t2 = false) {
    var s;
    let o = e;
    if (!t2) {
      const r2 = this.tryParseHTMLToBlocks(e);
      o = this.blocksToFullHTML(r2);
    }
    o && ((s = this.editor.prosemirrorView) == null || s.pasteHTML(o));
  }
  /**
   * Paste text into the editor. Defaults to interpreting text as markdown.
   * @param text The text to paste.
   */
  pasteText(e) {
    var t2;
    return (t2 = this.editor.prosemirrorView) == null ? void 0 : t2.pasteText(e);
  }
  /**
   * Paste markdown into the editor.
   * @param markdown The markdown to paste.
   */
  pasteMarkdown(e) {
    const t2 = Ie(e);
    return this.pasteHTML(t2);
  }
};
var se = [
  "vscode-editor-data",
  "blocknote/html",
  "text/markdown",
  "text/html",
  "text/plain",
  "Files"
];
function Do2(n, e) {
  if (!n.startsWith(".") || !e.startsWith("."))
    throw new Error("The strings provided are not valid file extensions.");
  return n === e;
}
function Oo2(n, e) {
  const t2 = n.split("/"), o = e.split("/");
  if (t2.length !== 2)
    throw new Error(`The string ${n} is not a valid MIME type.`);
  if (o.length !== 2)
    throw new Error(`The string ${e} is not a valid MIME type.`);
  return t2[1] === "*" || o[1] === "*" ? t2[0] === o[0] : (t2[0] === "*" || o[0] === "*" || t2[0] === o[0]) && t2[1] === o[1];
}
function de2(n, e, t2, o = "after") {
  let s;
  return Array.isArray(e.content) && e.content.length === 0 ? s = n.updateBlock(e, t2).id : s = n.insertBlocks(
    [t2],
    e,
    o
  )[0].id, s;
}
async function Ae(n, e) {
  var r2;
  if (!e.uploadFile) {
    console.warn(
      "Attempted ot insert file, but uploadFile is not set in the BlockNote editor options"
    );
    return;
  }
  const t2 = "dataTransfer" in n ? n.dataTransfer : n.clipboardData;
  if (t2 === null)
    return;
  let o = null;
  for (const i3 of se)
    if (t2.types.includes(i3)) {
      o = i3;
      break;
    }
  if (o !== "Files")
    return;
  const s = t2.items;
  if (s) {
    n.preventDefault();
    for (let i3 = 0; i3 < s.length; i3++) {
      let l = "file";
      for (const c of Object.values(e.schema.blockSpecs))
        for (const d of ((r2 = c.implementation.meta) == null ? void 0 : r2.fileBlockAccept) || []) {
          const u2 = d.startsWith("."), p2 = s[i3].getAsFile();
          if (p2 && (!u2 && p2.type && Oo2(s[i3].type, d) || u2 && Do2(
            "." + p2.name.split(".").pop(),
            d
          ))) {
            l = c.config.type;
            break;
          }
        }
      const a2 = s[i3].getAsFile();
      if (a2) {
        const c = {
          type: l,
          props: {
            name: a2.name
          }
        };
        let d;
        if (n.type === "paste") {
          const h3 = e.getTextCursorPosition().block;
          d = de2(e, h3, c);
        } else if (n.type === "drop") {
          const h3 = {
            left: n.clientX,
            top: n.clientY
          }, f4 = e.prosemirrorView.posAtCoords(h3);
          if (!f4)
            return;
          d = e.transact((m3) => {
            var y;
            const b4 = Y(m3.doc, f4.pos), g = (y = e.domElement) == null ? void 0 : y.querySelector(
              `[data-id="${b4.node.attrs.id}"]`
            ), x = g == null ? void 0 : g.getBoundingClientRect();
            return de2(
              e,
              e.getBlock(b4.node.attrs.id),
              c,
              x && (x.top + x.bottom) / 2 > h3.top ? "before" : "after"
            );
          });
        } else
          return;
        const u2 = await e.uploadFile(a2, d), p2 = typeof u2 == "string" ? {
          props: {
            url: u2
          }
        } : { ...u2 };
        e.updateBlock(d, p2);
      }
    }
  }
}
var $o2 = (n) => Extension.create({
  name: "dropFile",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            drop(e, t2) {
              if (!n.isEditable)
                return;
              let o = null;
              for (const s of se)
                if (t2.dataTransfer.types.includes(s)) {
                  o = s;
                  break;
                }
              return o === null ? true : o === "Files" ? (Ae(t2, n), true) : false;
            }
          }
        }
      })
    ];
  }
});
var Ho3 = /(^|\n) {0,3}#{1,6} {1,8}[^\n]{1,64}\r?\n\r?\n\s{0,32}\S/;
var Fo2 = /(_|__|\*|\*\*|~~|==|\+\+)(?!\s)(?:[^\s](?:.{0,62}[^\s])?|\S)(?=\1)/;
var Vo2 = /\[[^\]]{1,128}\]\(https?:\/\/\S{1,999}\)/;
var Uo2 = /(?:\s|^)`(?!\s)(?:[^\s`](?:[^`]{0,46}[^\s`])?|[^\s`])`([^\w]|$)/;
var zo2 = /(?:^|\n)\s{0,5}-\s{1}[^\n]+\n\s{0,15}-\s/;
var Ro2 = /(?:^|\n)\s{0,5}\d+\.\s{1}[^\n]+\n\s{0,15}\d+\.\s/;
var Go = /\n{2} {0,3}-{2,48}\n{2}/;
var jo2 = /(?:\n|^)(```|~~~|\$\$)(?!`|~)[^\s]{0,64} {0,64}[^\n]{0,64}\n[\s\S]{0,9999}?\s*\1 {0,64}(?:\n+|$)/;
var Wo = /(?:\n|^)(?!\s)\w[^\n]{0,64}\r?\n(-|=)\1{0,64}\n\n\s{0,64}(\w|$)/;
var qo = /(?:^|(\r?\n\r?\n))( {0,3}>[^\n]{1,333}\n){1,999}($|(\r?\n))/;
var Ko = /^\s*\|(.+\|)+\s*$/m;
var Jo = /^\s*\|(\s*[-:]+[-:]\s*\|)+\s*$/m;
var Yo2 = /^\s*\|(.+\|)+\s*$/m;
var Qo = (n) => Ho3.test(n) || Fo2.test(n) || Vo2.test(n) || Uo2.test(n) || zo2.test(n) || Ro2.test(n) || Go.test(n) || jo2.test(n) || Wo.test(n) || qo.test(n) || Ko.test(n) || Jo.test(n) || Yo2.test(n);
async function Xo(n, e) {
  const { schema: t2 } = e.state;
  if (!n.clipboardData)
    return false;
  const o = n.clipboardData.getData("text/plain");
  if (!o)
    return false;
  if (!t2.nodes.codeBlock)
    return e.pasteText(o), true;
  const s = n.clipboardData.getData("vscode-editor-data"), r2 = s ? JSON.parse(s) : void 0, i3 = r2 == null ? void 0 : r2.mode;
  return i3 ? (e.pasteHTML(
    `<pre><code class="language-${i3}">${o.replace(
      /\r\n?/g,
      `
`
    )}</code></pre>`
  ), true) : false;
}
function Zo({
  event: n,
  editor: e,
  prioritizeMarkdownOverHTML: t2,
  plainTextAsMarkdown: o
}) {
  var l;
  if (e.transact(
    (a2) => a2.selection.$from.parent.type.spec.code && a2.selection.$to.parent.type.spec.code
  )) {
    const a2 = (l = n.clipboardData) == null ? void 0 : l.getData("text/plain");
    if (a2)
      return e.pasteText(a2), true;
  }
  let r2;
  for (const a2 of se)
    if (n.clipboardData.types.includes(a2)) {
      r2 = a2;
      break;
    }
  if (!r2)
    return true;
  if (r2 === "vscode-editor-data")
    return Xo(n, e.prosemirrorView), true;
  if (r2 === "Files")
    return Ae(n, e), true;
  const i3 = n.clipboardData.getData(r2);
  if (r2 === "blocknote/html")
    return e.pasteHTML(i3, true), true;
  if (r2 === "text/markdown")
    return e.pasteMarkdown(i3), true;
  if (t2) {
    const a2 = n.clipboardData.getData("text/plain");
    if (Qo(a2))
      return e.pasteMarkdown(a2), true;
  }
  return r2 === "text/html" ? (e.pasteHTML(i3), true) : o ? (e.pasteMarkdown(i3), true) : (e.pasteText(i3), true);
}
var en2 = (n, e) => Extension.create({
  name: "pasteFromClipboard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            paste(t2, o) {
              if (o.preventDefault(), !!n.isEditable)
                return e({
                  event: o,
                  editor: n,
                  defaultPasteHandler: ({
                    prioritizeMarkdownOverHTML: s = true,
                    plainTextAsMarkdown: r2 = true
                  } = {}) => Zo({
                    event: o,
                    editor: n,
                    prioritizeMarkdownOverHTML: s,
                    plainTextAsMarkdown: r2
                  })
                });
            }
          }
        }
      })
    ];
  }
});
function tn2(n, e, t2) {
  var l;
  let o = false;
  const s = n.state.selection instanceof CellSelection;
  if (!s) {
    const a2 = n.state.doc.slice(
      n.state.selection.from,
      n.state.selection.to,
      false
    ).content, c = [];
    for (let d = 0; d < a2.childCount; d++)
      c.push(a2.child(d));
    o = c.find(
      (d) => d.type.isInGroup("bnBlock") || d.type.name === "blockGroup" || d.type.spec.group === "blockContent"
    ) === void 0, o && (e = a2);
  }
  let r2;
  const i3 = Be(
    n.state.schema,
    t2
  );
  if (s) {
    ((l = e.firstChild) == null ? void 0 : l.type.name) === "table" && (e = e.firstChild.content);
    const a2 = gt(
      e,
      t2.schema.inlineContentSchema,
      t2.schema.styleSchema
    );
    r2 = `<table>${i3.exportInlineContent(
      a2,
      {}
    )}</table>`;
  } else if (o) {
    const a2 = F(
      e,
      t2.schema.inlineContentSchema,
      t2.schema.styleSchema
    );
    r2 = i3.exportInlineContent(a2, {});
  } else {
    const a2 = Wt(e);
    r2 = i3.exportBlocks(a2, {});
  }
  return r2;
}
function Ne2(n, e) {
  "node" in n.state.selection && n.state.selection.node.type.spec.group === "blockContent" && e.transact(
    (i3) => i3.setSelection(
      new NodeSelection(i3.doc.resolve(n.state.selection.from - 1))
    )
  );
  const t2 = n.serializeForClipboard(
    n.state.selection.content()
  ).dom.innerHTML, o = n.state.selection.content().content, s = tn2(
    n,
    o,
    e
  ), r2 = Oe2(s);
  return { clipboardHTML: t2, externalHTML: s, markdown: r2 };
}
var ue = () => {
  const n = window.getSelection();
  if (!n || n.isCollapsed)
    return true;
  let e = n.focusNode;
  for (; e; ) {
    if (e instanceof HTMLElement && e.getAttribute("contenteditable") === "false")
      return true;
    e = e.parentElement;
  }
  return false;
};
var pe2 = (n, e, t2) => {
  t2.preventDefault(), t2.clipboardData.clearData();
  const { clipboardHTML: o, externalHTML: s, markdown: r2 } = Ne2(
    e,
    n
  );
  t2.clipboardData.setData("blocknote/html", o), t2.clipboardData.setData("text/html", s), t2.clipboardData.setData("text/plain", r2);
};
var on2 = (n) => Extension.create({
  name: "copyToClipboard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            copy(e, t2) {
              return ue() || pe2(n, e, t2), true;
            },
            cut(e, t2) {
              return ue() || (pe2(n, e, t2), e.editable && e.dispatch(e.state.tr.deleteSelection())), true;
            },
            // This is for the use-case in which only a block without content
            // is selected, e.g. an image block, and dragged (not using the
            // drag handle).
            dragstart(e, t2) {
              if (!("node" in e.state.selection) || e.state.selection.node.type.spec.group !== "blockContent")
                return;
              n.transact(
                (i3) => i3.setSelection(
                  new NodeSelection(
                    i3.doc.resolve(e.state.selection.from - 1)
                  )
                )
              ), t2.preventDefault(), t2.dataTransfer.clearData();
              const { clipboardHTML: o, externalHTML: s, markdown: r2 } = Ne2(e, n);
              return t2.dataTransfer.setData("blocknote/html", o), t2.dataTransfer.setData("text/html", s), t2.dataTransfer.setData("text/plain", r2), true;
            }
          }
        }
      })
    ];
  }
});
var nn2 = Extension.create({
  name: "blockBackgroundColor",
  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          backgroundColor: So()
        }
      }
    ];
  }
});
var sn2 = Node3.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  linebreakReplacement: true,
  priority: 10,
  parseHTML() {
    return [{ tag: "br" }];
  },
  renderHTML({ HTMLAttributes: n }) {
    return ["br", mergeAttributes(this.options.HTMLAttributes, n)];
  },
  renderText() {
    return `
`;
  }
});
var _e = (n, e) => {
  var l;
  const t2 = n.resolve(e), o = t2.depth - 1, s = t2.before(o), r2 = n.resolve(s).nodeAfter;
  return r2 ? (l = r2.type.spec.group) != null && l.includes("bnBlock") ? It(
    n.resolve(s)
  ) : _e(n, s) : void 0;
};
var L4 = (n, e) => {
  const t2 = n.resolve(e), o = t2.index();
  if (o === 0)
    return;
  const s = t2.posAtIndex(o - 1);
  return It(
    n.resolve(s)
  );
};
var _2 = (n, e) => {
  const t2 = n.resolve(e), o = t2.index();
  if (o === t2.node().childCount - 1)
    return;
  const s = t2.posAtIndex(o + 1);
  return It(
    n.resolve(s)
  );
};
var Le2 = (n, e) => {
  for (; e.childContainer; ) {
    const t2 = e.childContainer.node, o = n.resolve(e.childContainer.beforePos + 1).posAtIndex(t2.childCount - 1);
    e = It(n.resolve(o));
  }
  return e;
};
var rn2 = (n, e) => n.isBlockContainer && n.blockContent.node.type.spec.content === "inline*" && n.blockContent.node.childCount > 0 && e.isBlockContainer && e.blockContent.node.type.spec.content === "inline*";
var an2 = (n, e, t2, o) => {
  if (!o.isBlockContainer)
    throw new Error(
      `Attempted to merge block at position ${o.bnBlock.beforePos} into previous block at position ${t2.bnBlock.beforePos}, but next block is not a block container`
    );
  if (o.childContainer) {
    const s = n.doc.resolve(
      o.childContainer.beforePos + 1
    ), r2 = n.doc.resolve(
      o.childContainer.afterPos - 1
    ), i3 = s.blockRange(r2);
    if (e) {
      const l = n.doc.resolve(o.bnBlock.beforePos);
      n.tr.lift(i3, l.depth);
    }
  }
  if (e) {
    if (!t2.isBlockContainer)
      throw new Error(
        `Attempted to merge block at position ${o.bnBlock.beforePos} into previous block at position ${t2.bnBlock.beforePos}, but previous block is not a block container`
      );
    e(
      n.tr.delete(
        t2.blockContent.afterPos - 1,
        o.blockContent.beforePos + 1
      )
    );
  }
  return true;
};
var fe = (n) => ({
  state: e,
  dispatch: t2
}) => {
  const o = e.doc.resolve(n), s = It(o), r2 = L4(
    e.doc,
    s.bnBlock.beforePos
  );
  if (!r2)
    return false;
  const i3 = Le2(
    e.doc,
    r2
  );
  return rn2(i3, s) ? an2(e, t2, i3, s) : false;
};
var cn2 = Extension.create({
  priority: 50,
  // TODO: The shortcuts need a refactor. Do we want to use a command priority
  //  design as there is now, or clump the logic into a single function?
  addKeyboardShortcuts() {
    const n = () => this.editor.commands.first(({ chain: o, commands: s }) => [
      // Deletes the selection if it's not empty.
      () => s.deleteSelection(),
      // Undoes an input rule if one was triggered in the last editor state change.
      () => s.undoInputRule(),
      // Reverts block content type to a paragraph if the selection is at the start of the block.
      () => s.command(({ state: r2 }) => {
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        const l = r2.selection.from === i3.blockContent.beforePos + 1, a2 = i3.blockContent.node.type.name === "paragraph";
        return l && !a2 ? s.command(
          yo(i3.bnBlock.beforePos, {
            type: "paragraph",
            props: {}
          })
        ) : false;
      }),
      // Removes a level of nesting if the block is indented if the selection is at the start of the block.
      () => s.command(({ state: r2 }) => {
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        const { blockContent: l } = i3;
        return r2.selection.from === l.beforePos + 1 ? s.liftListItem("blockContainer") : false;
      }),
      // Merges block with the previous one if it isn't indented, and the selection is at the start of the
      // block. The target block for merging must contain inline content.
      () => s.command(({ state: r2 }) => {
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        const { bnBlock: l, blockContent: a2 } = i3, c = L4(
          r2.doc,
          i3.bnBlock.beforePos
        );
        if (!c || !c.isBlockContainer || c.blockContent.node.type.spec.content !== "inline*")
          return false;
        const d = r2.selection.from === a2.beforePos + 1, u2 = r2.selection.empty, p2 = l.beforePos;
        return d && u2 ? o().command(fe(p2)).scrollIntoView().run() : false;
      }),
      // If the previous block is a columnList, moves the current block to
      // the end of the last column in it.
      () => s.command(({ state: r2, tr: i3, dispatch: l }) => {
        const a2 = Tt(r2);
        if (!a2.isBlockContainer)
          return false;
        const c = L4(
          r2.doc,
          a2.bnBlock.beforePos
        );
        if (!c || c.isBlockContainer)
          return false;
        if (l) {
          const d = c.bnBlock.afterPos - 1, u2 = i3.doc.resolve(d - 1);
          return i3.delete(
            a2.bnBlock.beforePos,
            a2.bnBlock.afterPos
          ), i3.insert(u2.pos, a2.bnBlock.node), i3.setSelection(
            TextSelection.near(i3.doc.resolve(u2.pos + 1))
          ), true;
        }
        return false;
      }),
      // If the block is the first in a column, moves it to the end of the
      // previous column. If there is no previous column, moves it above the
      // columnList.
      () => s.command(({ state: r2, tr: i3, dispatch: l }) => {
        const a2 = Tt(r2);
        if (!a2.isBlockContainer || !(i3.selection.from === a2.blockContent.beforePos + 1))
          return false;
        const d = i3.doc.resolve(a2.bnBlock.beforePos);
        if (d.nodeBefore || d.node().type.name !== "column")
          return false;
        const h3 = i3.doc.resolve(a2.bnBlock.beforePos), f4 = i3.doc.resolve(h3.before()), m3 = f4.before();
        return l && (i3.delete(
          a2.bnBlock.beforePos,
          a2.bnBlock.afterPos
        ), H3(i3, m3), f4.pos === m3 + 1 ? (i3.insert(m3, a2.bnBlock.node), i3.setSelection(
          TextSelection.near(i3.doc.resolve(m3))
        )) : (i3.insert(f4.pos - 1, a2.bnBlock.node), i3.setSelection(
          TextSelection.near(i3.doc.resolve(f4.pos))
        ))), true;
      }),
      // Deletes the current block if it's an empty block with inline content,
      // and moves the selection to the previous block.
      () => s.command(({ state: r2 }) => {
        var a2;
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        if (i3.blockContent.node.childCount === 0 && i3.blockContent.node.type.spec.content === "inline*") {
          const c = L4(
            r2.doc,
            i3.bnBlock.beforePos
          );
          if (!c || !c.isBlockContainer)
            return false;
          let d = o();
          if (i3.childContainer && d.insertContentAt(
            i3.bnBlock.afterPos,
            (a2 = i3.childContainer) == null ? void 0 : a2.node.content
          ), c.blockContent.node.type.spec.content === "tableRow+") {
            const m3 = i3.bnBlock.beforePos - 1 - 1 - 1 - 1 - 1;
            d = d.setTextSelection(
              m3
            );
          } else if (c.blockContent.node.type.spec.content === "")
            d = d.setNodeSelection(
              c.blockContent.beforePos
            );
          else {
            const u2 = c.blockContent.afterPos - 1;
            d = d.setTextSelection(u2);
          }
          return d.deleteRange({
            from: i3.bnBlock.beforePos,
            to: i3.bnBlock.afterPos
          }).scrollIntoView().run();
        }
        return false;
      }),
      // Deletes previous block if it contains no content and isn't a table,
      // when the selection is empty and at the start of the block. Moves the
      // current block into the deleted block's place.
      () => s.command(({ state: r2 }) => {
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        const l = r2.selection.from === i3.blockContent.beforePos + 1, a2 = r2.selection.empty, c = L4(
          r2.doc,
          i3.bnBlock.beforePos
        );
        if (c && l && a2) {
          const d = Le2(
            r2.doc,
            c
          );
          if (!d.isBlockContainer)
            return false;
          if (d.blockContent.node.type.spec.content === "" || d.blockContent.node.type.spec.content === "inline*" && d.blockContent.node.childCount === 0)
            return o().cut(
              {
                from: i3.bnBlock.beforePos,
                to: i3.bnBlock.afterPos
              },
              d.bnBlock.afterPos
            ).deleteRange({
              from: d.bnBlock.beforePos,
              to: d.bnBlock.afterPos
            }).run();
        }
        return false;
      })
    ]), e = () => this.editor.commands.first(({ chain: o, commands: s }) => [
      // Deletes the selection if it's not empty.
      () => s.deleteSelection(),
      // Deletes the first child block and un-nests its children, if the
      // selection is empty and at the end of the current block. If both the
      // parent and child blocks have inline content, the child block's
      // content is appended to the parent's. The child block's own children
      // are unindented before it's deleted.
      () => s.command(({ state: r2 }) => {
        var p2;
        const i3 = Tt(r2);
        if (!i3.isBlockContainer || !i3.childContainer)
          return false;
        const { blockContent: l, childContainer: a2 } = i3, c = r2.selection.from === l.afterPos - 1, d = r2.selection.empty, u2 = It(
          r2.doc.resolve(a2.beforePos + 1)
        );
        if (!u2.isBlockContainer)
          return false;
        if (c && d) {
          const h3 = u2.blockContent.node, f4 = h3.type.spec.content === "inline*", m3 = l.node.type.spec.content === "inline*";
          return o().insertContentAt(
            u2.bnBlock.afterPos,
            ((p2 = u2.childContainer) == null ? void 0 : p2.node.content) || Fragment.empty
          ).deleteRange(
            // Deletes whole child container if there's only one child.
            a2.node.childCount === 1 ? {
              from: a2.beforePos,
              to: a2.afterPos
            } : {
              from: u2.bnBlock.beforePos,
              to: u2.bnBlock.afterPos
            }
          ).insertContentAt(
            r2.selection.from,
            f4 && m3 ? h3.content : null
          ).setTextSelection(r2.selection.from).scrollIntoView().run();
        }
        return false;
      }),
      // Merges block with the next one (at the same nesting level or lower),
      // if one exists, the block has no children, and the selection is at the
      // end of the block.
      () => s.command(({ state: r2 }) => {
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        const { bnBlock: l, blockContent: a2 } = i3, c = _2(
          r2.doc,
          i3.bnBlock.beforePos
        );
        if (!c || !c.isBlockContainer)
          return false;
        const d = r2.selection.from === a2.afterPos - 1, u2 = r2.selection.empty, p2 = l.afterPos;
        return d && u2 ? o().command(fe(p2)).scrollIntoView().run() : false;
      }),
      // If the previous block is a columnList, moves the current block to
      // the end of the last column in it.
      () => s.command(({ state: r2, tr: i3, dispatch: l }) => {
        const a2 = Tt(r2);
        if (!a2.isBlockContainer)
          return false;
        const c = _2(
          r2.doc,
          a2.bnBlock.beforePos
        );
        if (!c || c.isBlockContainer)
          return false;
        if (l) {
          const d = c.bnBlock.beforePos + 1, u2 = i3.doc.resolve(d + 1);
          return i3.delete(
            u2.pos,
            u2.pos + u2.nodeAfter.nodeSize
          ), H3(i3, c.bnBlock.beforePos), i3.insert(a2.bnBlock.afterPos, u2.nodeAfter), i3.setSelection(
            TextSelection.near(i3.doc.resolve(u2.pos))
          ), true;
        }
        return false;
      }),
      // If the block is the last in a column, moves it to the start of the
      // next column. If there is no next column, moves it below the
      // columnList.
      () => s.command(({ state: r2, tr: i3, dispatch: l }) => {
        const a2 = Tt(r2);
        if (!a2.isBlockContainer || !(i3.selection.from === a2.blockContent.afterPos - 1))
          return false;
        const d = i3.doc.resolve(a2.bnBlock.afterPos);
        if (d.nodeAfter || d.node().type.name !== "column")
          return false;
        const h3 = i3.doc.resolve(a2.bnBlock.afterPos), f4 = i3.doc.resolve(h3.after()), m3 = f4.after();
        if (l) {
          const b4 = f4.pos === m3 - 1 ? m3 : f4.pos + 1, g = It(
            i3.doc.resolve(b4)
          );
          i3.delete(
            g.bnBlock.beforePos,
            g.bnBlock.afterPos
          ), H3(
            i3,
            m3 - f4.node().nodeSize
          ), i3.insert(h3.pos, g.bnBlock.node), i3.setSelection(
            TextSelection.near(i3.doc.resolve(b4))
          );
        }
        return true;
      }),
      // Deletes the next block at either the same or lower nesting level, if
      // the selection is empty and at the end of the block. If both the
      // current and next blocks have inline content, the next block's
      // content is appended to the current block's. The next block's own
      // children are unindented before it's deleted.
      () => s.command(({ state: r2 }) => {
        var d;
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        const { blockContent: l } = i3, a2 = r2.selection.from === l.afterPos - 1, c = r2.selection.empty;
        if (a2 && c) {
          const u2 = (b4, g) => {
            const x = _2(b4, g);
            if (x)
              return x;
            const y = _e(b4, g);
            if (y)
              return u2(
                b4,
                y.bnBlock.beforePos
              );
          }, p2 = u2(
            r2.doc,
            i3.bnBlock.beforePos
          );
          if (!p2 || !p2.isBlockContainer)
            return false;
          const h3 = p2.blockContent.node, f4 = h3.type.spec.content === "inline*", m3 = l.node.type.spec.content === "inline*";
          return o().insertContentAt(
            p2.bnBlock.afterPos,
            ((d = p2.childContainer) == null ? void 0 : d.node.content) || Fragment.empty
          ).deleteRange({
            from: p2.bnBlock.beforePos,
            to: p2.bnBlock.afterPos
          }).insertContentAt(
            r2.selection.from,
            f4 && m3 ? h3.content : null
          ).setTextSelection(r2.selection.from).scrollIntoView().run();
        }
        return false;
      }),
      // Deletes the current block if it's an empty block with inline content,
      // and moves the selection to the next block.
      () => s.command(({ state: r2 }) => {
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        if (i3.blockContent.node.childCount === 0 && i3.blockContent.node.type.spec.content === "inline*") {
          const a2 = _2(
            r2.doc,
            i3.bnBlock.beforePos
          );
          if (!a2 || !a2.isBlockContainer)
            return false;
          let c = o();
          if (a2.blockContent.node.type.spec.content === "tableRow+") {
            const f4 = i3.bnBlock.afterPos + 1 + 1 + 1 + 1 + 1;
            c = c.setTextSelection(
              f4
            );
          } else a2.blockContent.node.type.spec.content === "" ? c = c.setNodeSelection(
            a2.blockContent.beforePos
          ) : c = c.setTextSelection(
            a2.blockContent.beforePos + 1
          );
          return c.deleteRange({
            from: i3.bnBlock.beforePos,
            to: i3.bnBlock.afterPos
          }).scrollIntoView().run();
        }
        return false;
      }),
      // Deletes next block if it contains no content and isn't a table,
      // when the selection is empty and at the end of the block. Moves the
      // current block into the deleted block's place.
      () => s.command(({ state: r2 }) => {
        const i3 = Tt(r2);
        if (!i3.isBlockContainer)
          return false;
        const l = r2.selection.from === i3.blockContent.afterPos - 1, a2 = r2.selection.empty, c = _2(
          r2.doc,
          i3.bnBlock.beforePos
        );
        if (!c || !c.isBlockContainer)
          return false;
        if (c && l && a2 && (c.blockContent.node.type.spec.content === "" || c.blockContent.node.type.spec.content === "inline*" && c.blockContent.node.childCount === 0)) {
          const u2 = c.bnBlock.node.lastChild.content;
          return o().deleteRange({
            from: c.bnBlock.beforePos,
            to: c.bnBlock.afterPos
          }).insertContentAt(
            i3.bnBlock.afterPos,
            c.bnBlock.node.childCount === 2 ? u2 : null
          ).run();
        }
        return false;
      })
    ]), t2 = (o = false) => this.editor.commands.first(({ commands: s, tr: r2 }) => [
      // Removes a level of nesting if the block is empty & indented, while the selection is also empty & at the start
      // of the block.
      () => s.command(({ state: i3 }) => {
        const l = Tt(i3);
        if (!l.isBlockContainer)
          return false;
        const { bnBlock: a2, blockContent: c } = l, { depth: d } = i3.doc.resolve(a2.beforePos), u2 = i3.selection.$anchor.parentOffset === 0, p2 = i3.selection.anchor === i3.selection.head, h3 = c.node.childCount === 0, f4 = d > 1;
        return u2 && p2 && h3 && f4 ? s.liftListItem("blockContainer") : false;
      }),
      // Creates a hard break if block is configured to do so.
      () => s.command(({ state: i3 }) => {
        var c;
        const l = Tt(i3), a2 = ((c = this.options.editor.schema.blockSchema[l.blockNoteType].meta) == null ? void 0 : c.hardBreakShortcut) ?? "shift+enter";
        if (a2 === "none")
          return false;
        if (
          // If shortcut is not configured, or is configured as "shift+enter",
          // create a hard break for shift+enter, but not for enter.
          a2 === "shift+enter" && o || // If shortcut is configured as "enter", create a hard break for
          // both enter and shift+enter.
          a2 === "enter"
        ) {
          const d = r2.storedMarks || r2.selection.$head.marks().filter(
            (u2) => this.editor.extensionManager.splittableMarks.includes(
              u2.type.name
            )
          );
          return r2.insert(
            r2.selection.head,
            r2.doc.type.schema.nodes.hardBreak.create()
          ).ensureMarks(d), true;
        }
        return false;
      }),
      // Creates a new block and moves the selection to it if the current one is empty, while the selection is also
      // empty & at the start of the block.
      () => s.command(({ state: i3, dispatch: l, tr: a2 }) => {
        var m3;
        const c = Tt(i3);
        if (!c.isBlockContainer)
          return false;
        const { bnBlock: d, blockContent: u2 } = c, p2 = i3.selection.$anchor.parentOffset === 0, h3 = i3.selection.anchor === i3.selection.head, f4 = u2.node.childCount === 0;
        if (p2 && h3 && f4) {
          const b4 = d.afterPos, g = b4 + 2;
          if (l) {
            const x = i3.schema.nodes.blockContainer.createAndFill(
              void 0,
              [
                i3.schema.nodes.paragraph.createAndFill() || void 0,
                (m3 = c.childContainer) == null ? void 0 : m3.node
              ].filter((y) => y !== void 0)
            );
            a2.insert(b4, x).setSelection(
              new TextSelection(a2.doc.resolve(g))
            ).scrollIntoView(), c.childContainer && a2.delete(
              c.childContainer.beforePos,
              c.childContainer.afterPos
            );
          }
          return true;
        }
        return false;
      }),
      // Splits the current block, moving content inside that's after the cursor to a new text block below. Also
      // deletes the selection beforehand, if it's not empty.
      () => s.command(({ state: i3, chain: l }) => {
        const a2 = Tt(i3);
        if (!a2.isBlockContainer)
          return false;
        const { blockContent: c } = a2, d = i3.selection.$anchor.parentOffset === 0;
        return c.node.childCount === 0 ? false : (l().deleteSelection().command(
          wo(
            i3.selection.from,
            d,
            d
          )
        ).run(), true);
      })
    ]);
    return {
      Backspace: n,
      Delete: e,
      Enter: () => t2(),
      "Shift-Enter": () => t2(true),
      // Always returning true for tab key presses ensures they're not captured by the browser. Otherwise, they blur the
      // editor since the browser will try to use tab for keyboard navigation.
      Tab: () => {
        var o, s;
        return this.options.tabBehavior !== "prefer-indent" && ((o = this.options.editor.getExtension(Ao)) != null && o.store.state || ((s = this.options.editor.getExtension(H)) == null ? void 0 : s.store.state) !== void 0) ? false : we2(this.options.editor);
      },
      "Shift-Tab": () => {
        var o, s;
        return this.options.tabBehavior !== "prefer-indent" && ((o = this.options.editor.getExtension(Ao)) != null && o.store.state || ((s = this.options.editor.getExtension(H)) == null ? void 0 : s.store.state) !== void 0) ? false : this.editor.commands.liftListItem("blockContainer");
      },
      "Shift-Mod-ArrowUp": () => (this.options.editor.moveBlocksUp(), true),
      "Shift-Mod-ArrowDown": () => (this.options.editor.moveBlocksDown(), true),
      "Mod-z": () => this.options.editor.undo(),
      "Mod-y": () => this.options.editor.redo(),
      "Shift-Mod-z": () => this.options.editor.redo()
    };
  }
});
var ln2 = Mark.create({
  name: "insertion",
  inclusive: false,
  excludes: "deletion modification insertion",
  addAttributes() {
    return {
      id: { default: null, validate: "number" }
      // note: validate is supported in prosemirror but not in tiptap, so this doesn't actually work (considered not critical)
    };
  },
  extendMarkSchema(n) {
    return n.name !== "insertion" ? {} : {
      blocknoteIgnore: true,
      inclusive: false,
      toDOM(e, t2) {
        return [
          "ins",
          {
            "data-id": String(e.attrs.id),
            "data-inline": String(t2),
            ...!t2 && { style: "display: contents" }
            // changed to "contents" to make this work for table rows
          },
          0
        ];
      },
      parseDOM: [
        {
          tag: "ins",
          getAttrs(e) {
            return e.dataset.id ? {
              id: parseInt(e.dataset.id, 10)
            } : false;
          }
        }
      ]
    };
  }
});
var dn2 = Mark.create({
  name: "deletion",
  inclusive: false,
  excludes: "insertion modification deletion",
  addAttributes() {
    return {
      id: { default: null, validate: "number" }
      // note: validate is supported in prosemirror but not in tiptap
    };
  },
  extendMarkSchema(n) {
    return n.name !== "deletion" ? {} : {
      blocknoteIgnore: true,
      inclusive: false,
      // attrs: {
      //   id: { validate: "number" },
      // },
      toDOM(e, t2) {
        return [
          "del",
          {
            "data-id": String(e.attrs.id),
            "data-inline": String(t2),
            ...!t2 && { style: "display: contents" }
            // changed to "contents" to make this work for table rows
          },
          0
        ];
      },
      parseDOM: [
        {
          tag: "del",
          getAttrs(e) {
            return e.dataset.id ? {
              id: parseInt(e.dataset.id, 10)
            } : false;
          }
        }
      ]
    };
  }
});
var un2 = Mark.create({
  name: "modification",
  inclusive: false,
  excludes: "deletion insertion",
  addAttributes() {
    return {
      id: { default: null, validate: "number" },
      type: { validate: "string" },
      attrName: { default: null, validate: "string|null" },
      previousValue: { default: null },
      newValue: { default: null }
    };
  },
  extendMarkSchema(n) {
    return n.name !== "modification" ? {} : {
      blocknoteIgnore: true,
      inclusive: false,
      // attrs: {
      //   id: { validate: "number" },
      //   type: { validate: "string" },
      //   attrName: { default: null, validate: "string|null" },
      //   previousValue: { default: null },
      //   newValue: { default: null },
      // },
      toDOM(e, t2) {
        return [
          t2 ? "span" : "div",
          {
            "data-type": "modification",
            "data-id": String(e.attrs.id),
            "data-mod-type": e.attrs.type,
            "data-mod-prev-val": JSON.stringify(e.attrs.previousValue),
            // TODO: Try to serialize marks with toJSON?
            "data-mod-new-val": JSON.stringify(e.attrs.newValue)
          },
          0
        ];
      },
      parseDOM: [
        {
          tag: "span[data-type='modification']",
          getAttrs(e) {
            return e.dataset.id ? {
              id: parseInt(e.dataset.id, 10),
              type: e.dataset.modType,
              previousValue: e.dataset.modPrevVal,
              newValue: e.dataset.modNewVal
            } : false;
          }
        },
        {
          tag: "div[data-type='modification']",
          getAttrs(e) {
            return e.dataset.id ? {
              id: parseInt(e.dataset.id, 10),
              type: e.dataset.modType,
              previousValue: e.dataset.modPrevVal
            } : false;
          }
        }
      ]
    };
  }
});
var pn = Extension.create({
  name: "textAlignment",
  addGlobalAttributes() {
    return [
      {
        // Generally text alignment is handled through props using the custom
        // blocks API. Tables are the only blocks that are created as TipTap
        // nodes and ported to blocks, so we need to add text alignment in a
        // separate extension.
        types: ["tableCell", "tableHeader"],
        attributes: {
          textAlignment: {
            default: "left",
            parseHTML: (n) => n.getAttribute("data-text-alignment"),
            renderHTML: (n) => n.textAlignment === "left" ? {} : {
              "data-text-alignment": n.textAlignment
            }
          }
        }
      }
    ];
  }
});
var fn2 = Extension.create({
  name: "blockTextColor",
  addGlobalAttributes() {
    return [
      {
        types: ["table", "tableCell", "tableHeader"],
        attributes: {
          textColor: xo()
        }
      }
    ];
  }
});
var hn2 = {
  blockColor: "data-block-color",
  blockStyle: "data-block-style",
  id: "data-id",
  depth: "data-depth",
  depthChange: "data-depth-change"
};
var mn2 = Node3.create({
  name: "blockContainer",
  group: "blockGroupChild bnBlock",
  // A block always contains content, and optionally a blockGroup which contains nested blocks
  content: "blockContent blockGroup?",
  // Ensures content-specific keyboard handlers trigger first.
  priority: 50,
  defining: true,
  marks: "insertion modification deletion",
  parseHTML() {
    return [
      {
        tag: "div[data-node-type=" + this.name + "]",
        getAttrs: (n) => {
          if (typeof n == "string")
            return false;
          const e = {};
          for (const [t2, o] of Object.entries(hn2))
            n.getAttribute(o) && (e[t2] = n.getAttribute(o));
          return e;
        }
      },
      // Ignore `blockOuter` divs, but parse the `blockContainer` divs inside them.
      {
        tag: 'div[data-node-type="blockOuter"]',
        skip: true
      }
    ];
  },
  renderHTML({ HTMLAttributes: n }) {
    var s;
    const e = document.createElement("div");
    e.className = "bn-block-outer", e.setAttribute("data-node-type", "blockOuter");
    for (const [r2, i3] of Object.entries(n))
      r2 !== "class" && e.setAttribute(r2, i3);
    const t2 = {
      ...((s = this.options.domAttributes) == null ? void 0 : s.block) || {},
      ...n
    }, o = document.createElement("div");
    o.className = D("bn-block", t2.class), o.setAttribute("data-node-type", this.name);
    for (const [r2, i3] of Object.entries(t2))
      r2 !== "class" && o.setAttribute(r2, i3);
    return e.appendChild(o), {
      dom: e,
      contentDOM: o
    };
  }
});
var kn2 = Node3.create({
  name: "blockGroup",
  group: "childContainer",
  content: "blockGroupChild+",
  marks: "deletion insertion modification",
  parseHTML() {
    return [
      {
        tag: "div",
        getAttrs: (n) => typeof n == "string" ? false : n.getAttribute("data-node-type") === "blockGroup" ? null : false
      }
    ];
  },
  renderHTML({ HTMLAttributes: n }) {
    var o;
    const e = {
      ...((o = this.options.domAttributes) == null ? void 0 : o.blockGroup) || {},
      ...n
    }, t2 = document.createElement("div");
    t2.className = D(
      "bn-block-group",
      e.class
    ), t2.setAttribute("data-node-type", "blockGroup");
    for (const [s, r2] of Object.entries(e))
      s !== "class" && t2.setAttribute(s, r2);
    return {
      dom: t2,
      contentDOM: t2
    };
  }
});
var bn2 = Node3.create({
  name: "doc",
  topNode: true,
  content: "blockGroup",
  marks: "insertion modification deletion"
});
var gn2 = a(
  ({ options: n }) => ({
    key: "collaboration",
    blockNoteExtensions: [
      Oo(n),
      ae(n),
      K(n),
      X(),
      Po2(n)
    ]
  })
);
var he = false;
function Bn2(n, e) {
  const t2 = [
    extensions_exports.ClipboardTextSerializer,
    extensions_exports.Commands,
    extensions_exports.Editable,
    extensions_exports.FocusEvents,
    extensions_exports.Tabindex,
    Gapcursor,
    Q.configure({
      // everything from bnBlock group (nodes that represent a BlockNote block should have an id)
      types: ["blockContainer", "columnList", "column"],
      setIdAttribute: e.setIdAttribute
    }),
    sn2,
    Text,
    // marks:
    ln2,
    dn2,
    un2,
    Link.extend({
      inclusive: false
    }).configure({
      defaultProtocol: Vo,
      // only call this once if we have multiple editors installed. Or fix https://github.com/ueberdosis/tiptap/issues/5450
      protocols: he ? [] : Ro
    }),
    ...Object.values(n.schema.styleSpecs).map((o) => o.implementation.mark.configure({
      editor: n
    })),
    fn2,
    nn2,
    pn,
    // make sure escape blurs editor, so that we can tab to other elements in the host page (accessibility)
    Extension.create({
      name: "OverrideEscape",
      addKeyboardShortcuts: () => ({
        Escape: () => {
          var o;
          return (o = n.getExtension(Vn)) != null && o.shown() ? false : (n.blur(), true);
        }
      })
    }),
    // nodes
    bn2,
    mn2.configure({
      editor: n,
      domAttributes: e.domAttributes
    }),
    cn2.configure({
      editor: n,
      tabBehavior: e.tabBehavior
    }),
    kn2.configure({
      domAttributes: e.domAttributes
    }),
    ...Object.values(n.schema.inlineContentSpecs).filter((o) => o.config !== "link" && o.config !== "text").map((o) => o.implementation.node.configure({
      editor: n
    })),
    ...Object.values(n.schema.blockSpecs).flatMap((o) => [
      // the node extension implementations
      ..."node" in o.implementation ? [
        o.implementation.node.configure({
          editor: n,
          domAttributes: e.domAttributes
        })
      ] : []
    ]),
    on2(n),
    en2(
      n,
      e.pasteHandler || ((o) => o.defaultPasteHandler())
    ),
    $o2(n)
  ];
  return he = true, t2;
}
function yn2(n, e) {
  const t2 = [
    Do(),
    Mo(e),
    H(e),
    Ao(e),
    No(e),
    Ho(),
    $o(e),
    b(e),
    _o(e),
    Vn(e),
    ...e.trailingBlock !== false ? [jo()] : []
  ];
  return e.collaboration ? t2.push(gn2(e.collaboration)) : t2.push(Lo()), "table" in n.schema.blockSpecs && t2.push(Yo(e)), e.animations !== false && t2.push(Fo()), t2;
}
var Cn2 = class {
  constructor(e, t2) {
    k3(this, "disabledExtensions", /* @__PURE__ */ new Set());
    k3(this, "extensions", []);
    k3(this, "abortMap", /* @__PURE__ */ new Map());
    k3(this, "extensionFactories", /* @__PURE__ */ new Map());
    k3(this, "extensionPlugins", /* @__PURE__ */ new Map());
    this.editor = e, this.options = t2, e.onMount(() => {
      for (const o of this.extensions)
        if (o.mount) {
          const s = new window.AbortController(), r2 = o.mount({
            dom: e.prosemirrorView.dom,
            root: e.prosemirrorView.root,
            signal: s.signal
          });
          r2 && s.signal.addEventListener("abort", () => {
            r2();
          }), this.abortMap.set(o, s);
        }
    }), e.onUnmount(() => {
      for (const [o, s] of this.abortMap.entries())
        this.abortMap.delete(o), s.abort();
    }), this.disabledExtensions = new Set(t2.disableExtensions || []);
    for (const o of yn2(this.editor, this.options))
      this.addExtension(o);
    for (const o of this.options.extensions ?? [])
      this.addExtension(o);
    for (const o of Object.values(this.editor.schema.blockSpecs))
      for (const s of o.extensions ?? [])
        this.addExtension(s);
  }
  /**
   * Register one or more extensions to the editor after the editor is initialized.
   *
   * This allows users to switch on & off extensions "at runtime".
   */
  registerExtension(e) {
    var r2;
    const t2 = [].concat(e).filter(Boolean);
    if (!t2.length) {
      console.warn("No extensions found to register", e);
      return;
    }
    const o = t2.map((i3) => this.addExtension(i3)).filter(Boolean), s = /* @__PURE__ */ new Set();
    for (const i3 of o)
      i3 != null && i3.tiptapExtensions && console.warn(
        `Extension ${i3.key} has tiptap extensions, but these cannot be changed after initializing the editor. Please separate the extension into multiple extensions if you want to add them, or re-initialize the editor.`,
        i3
      ), (r2 = i3 == null ? void 0 : i3.inputRules) != null && r2.length && console.warn(
        `Extension ${i3.key} has input rules, but these cannot be changed after initializing the editor. Please separate the extension into multiple extensions if you want to add them, or re-initialize the editor.`,
        i3
      ), this.getProsemirrorPluginsFromExtension(i3).plugins.forEach(
        (l) => {
          s.add(l);
        }
      );
    this.updatePlugins((i3) => [...i3, ...s]);
  }
  /**
   * Register an extension to the editor
   * @param extension - The extension to register
   * @returns The extension instance
   */
  addExtension(e) {
    let t2;
    if (typeof e == "function" ? t2 = e({ editor: this.editor }) : t2 = e, !(!t2 || this.disabledExtensions.has(t2.key))) {
      if (typeof e == "function") {
        const o = t2[r];
        typeof o == "function" && this.extensionFactories.set(o, t2);
      }
      if (this.extensions.push(t2), t2.blockNoteExtensions)
        for (const o of t2.blockNoteExtensions)
          this.addExtension(o);
      return t2;
    }
  }
  /**
   * Resolve an extension or a list of extensions into a list of extension instances
   * @param toResolve - The extension or list of extensions to resolve
   * @returns A list of extension instances
   */
  resolveExtensions(e) {
    const t2 = [];
    if (typeof e == "function") {
      const o = this.extensionFactories.get(e);
      o && t2.push(o);
    } else if (Array.isArray(e))
      for (const o of e)
        t2.push(...this.resolveExtensions(o));
    else if (typeof e == "object" && "key" in e)
      t2.push(e);
    else if (typeof e == "string") {
      const o = this.extensions.find((s) => s.key === e);
      o && t2.push(o);
    }
    return t2;
  }
  /**
   * Unregister an extension from the editor
   * @param toUnregister - The extension to unregister
   * @returns void
   */
  unregisterExtension(e) {
    var r2;
    const t2 = this.resolveExtensions(e);
    if (!t2.length) {
      console.warn("No extensions found to unregister", e);
      return;
    }
    let o = false;
    const s = /* @__PURE__ */ new Set();
    for (const i3 of t2) {
      this.extensions = this.extensions.filter((a2) => a2 !== i3), this.extensionFactories.forEach((a2, c) => {
        a2 === i3 && this.extensionFactories.delete(c);
      }), (r2 = this.abortMap.get(i3)) == null || r2.abort(), this.abortMap.delete(i3);
      const l = this.extensionPlugins.get(i3);
      l == null || l.forEach((a2) => {
        s.add(a2);
      }), this.extensionPlugins.delete(i3), i3.tiptapExtensions && !o && (o = true, console.warn(
        `Extension ${i3.key} has tiptap extensions, but they will not be removed. Please separate the extension into multiple extensions if you want to remove them, or re-initialize the editor.`,
        e
      ));
    }
    this.updatePlugins(
      (i3) => i3.filter((l) => !s.has(l))
    );
  }
  /**
   * Allows resetting the current prosemirror state's plugins
   * @param update - A function that takes the current plugins and returns the new plugins
   * @returns void
   */
  updatePlugins(e) {
    const t2 = this.editor.prosemirrorState, o = t2.reconfigure({
      plugins: e(t2.plugins.slice())
    });
    this.editor.prosemirrorView.updateState(o);
  }
  /**
   * Get all the extensions that are registered to the editor
   */
  getTiptapExtensions() {
    var s;
    const e = Bn2(
      this.editor,
      this.options
    ).filter((r2) => !this.disabledExtensions.has(r2.name)), t2 = P(this.extensions), o = /* @__PURE__ */ new Map();
    for (const r2 of this.extensions) {
      r2.tiptapExtensions && e.push(...r2.tiptapExtensions);
      const i3 = t2(r2.key), { plugins: l, inputRules: a2 } = this.getProsemirrorPluginsFromExtension(r2);
      l.length && e.push(
        Extension.create({
          name: r2.key,
          priority: i3,
          addProseMirrorPlugins: () => l
        })
      ), a2.length && (o.has(i3) || o.set(i3, []), o.get(i3).push(...a2));
    }
    e.push(
      Extension.create({
        name: "blocknote-input-rules",
        addProseMirrorPlugins() {
          const r2 = [];
          return Array.from(o.keys()).sort().reverse().forEach((i3) => {
            r2.push(...o.get(i3));
          }), [inputRules({ rules: r2 })];
        }
      })
    );
    for (const r2 of ((s = this.options._tiptapOptions) == null ? void 0 : s.extensions) ?? [])
      e.push(r2);
    return e;
  }
  /**
   * This maps a blocknote extension into an array of Prosemirror plugins if it has any of the following:
   * - plugins
   * - keyboard shortcuts
   * - input rules
   */
  getProsemirrorPluginsFromExtension(e) {
    var s, r2, i3;
    const t2 = [...e.prosemirrorPlugins ?? []], o = [];
    return !((s = e.prosemirrorPlugins) != null && s.length) && !Object.keys(e.keyboardShortcuts || {}).length && !((r2 = e.inputRules) != null && r2.length) ? { plugins: t2, inputRules: o } : (this.extensionPlugins.set(e, t2), (i3 = e.inputRules) != null && i3.length && o.push(
      ...e.inputRules.map((l) => new InputRule(l.find, (a2, c, d, u2) => {
        const p2 = l.replace({
          match: c,
          range: { from: d, to: u2 },
          editor: this.editor
        });
        if (p2) {
          const h3 = this.editor.getTextCursorPosition();
          if (this.editor.schema.blockSchema[h3.block.type].content !== "inline")
            return null;
          const f4 = Ot(a2.tr), m3 = a2.tr.deleteRange(d, u2);
          return Q2(m3, f4.bnBlock.beforePos, p2), m3;
        }
        return null;
      }))
    ), Object.keys(e.keyboardShortcuts || {}).length && t2.push(
      keymap(
        Object.fromEntries(
          Object.entries(e.keyboardShortcuts).map(([l, a2]) => [
            l,
            () => a2({ editor: this.editor })
          ])
        )
      )
    ), { plugins: t2, inputRules: o });
  }
  /**
   * Get all extensions
   */
  getExtensions() {
    return new Map(
      this.extensions.map((e) => [e.key, e])
    );
  }
  getExtension(e) {
    if (typeof e == "string") {
      const t2 = this.extensions.find((o) => o.key === e);
      return t2 || void 0;
    } else if (typeof e == "function") {
      const t2 = this.extensionFactories.get(e);
      return t2 || void 0;
    }
    throw new Error(`Invalid extension type: ${typeof e}`);
  }
  /**
   * Check if an extension exists
   */
  hasExtension(e) {
    return typeof e == "string" ? this.extensions.some((t2) => t2.key === e) : typeof e == "object" && "key" in e ? this.extensions.some((t2) => t2.key === e.key) : typeof e == "function" ? this.extensionFactories.has(e) : false;
  }
};
function Sn2(n, e) {
  let { $from: t2, $to: o } = e;
  if (t2.pos > t2.start() && t2.pos < n.content.size) {
    const s = n.textBetween(t2.pos, t2.pos + 1);
    if (/^[\w\p{P}]$/u.test(s)) {
      const i3 = n.textBetween(t2.start(), t2.pos).match(/[\w\p{P}]+$/u);
      i3 && (t2 = n.resolve(t2.pos - i3[0].length));
    }
  }
  if (o.pos < o.end() && o.pos > 0) {
    const s = n.textBetween(o.pos - 1, o.pos);
    if (/^[\w\p{P}]$/u.test(s)) {
      const i3 = n.textBetween(o.pos, o.end()).match(/^[\w\p{P}]+/u);
      i3 && (o = n.resolve(o.pos + i3[0].length));
    }
  }
  return { $from: t2, $to: o, from: t2.pos, to: o.pos };
}
function xn(n) {
  const e = ht(n);
  if (n.selection.empty || "node" in n.selection)
    return;
  const t2 = n.doc.resolve(
    Y(n.doc, n.selection.from).posBeforeNode
  ), o = n.doc.resolve(
    Y(n.doc, n.selection.to).posBeforeNode
  ), s = (c, d) => {
    const u2 = t2.posAtIndex(c, d), p2 = n.doc.resolve(u2).nodeAfter;
    if (!p2)
      throw new Error(
        `Error getting selection - node not found at position ${u2}`
      );
    return L(p2, e);
  }, r2 = [], i3 = t2.sharedDepth(o.pos), l = t2.index(i3), a2 = o.index(i3);
  if (t2.depth > i3) {
    r2.push(L(t2.nodeAfter, e));
    for (let c = t2.depth; c > i3; c--)
      if (t2.node(c).type.isInGroup("childContainer")) {
        const u2 = t2.index(c) + 1, p2 = t2.node(c).childCount;
        for (let h3 = u2; h3 < p2; h3++)
          r2.push(s(h3, c));
      }
  } else
    r2.push(s(l, i3));
  for (let c = l + 1; c <= a2; c++)
    r2.push(s(c, i3));
  if (r2.length === 0)
    throw new Error(
      `Error getting selection - selection doesn't span any blocks (${n.selection})`
    );
  return {
    blocks: r2
  };
}
function En(n, e, t2) {
  const o = typeof e == "string" ? e : e.id, s = typeof t2 == "string" ? t2 : t2.id, r2 = ht(n), i3 = J(r2);
  if (o === s)
    throw new Error(
      `Attempting to set selection with the same anchor and head blocks (id ${o})`
    );
  const l = Bt(o, n.doc);
  if (!l)
    throw new Error(`Block with ID ${o} not found`);
  const a2 = Bt(s, n.doc);
  if (!a2)
    throw new Error(`Block with ID ${s} not found`);
  const c = Z(l), d = Z(a2), u2 = i3.blockSchema[c.blockNoteType], p2 = i3.blockSchema[d.blockNoteType];
  if (!c.isBlockContainer || u2.content === "none")
    throw new Error(
      `Attempting to set selection anchor in block without content (id ${o})`
    );
  if (!d.isBlockContainer || p2.content === "none")
    throw new Error(
      `Attempting to set selection anchor in block without content (id ${s})`
    );
  let h3, f4;
  if (u2.content === "table") {
    const m3 = TableMap.get(c.blockContent.node);
    h3 = c.blockContent.beforePos + m3.positionAt(0, 0, c.blockContent.node) + 1 + 2;
  } else
    h3 = c.blockContent.beforePos + 1;
  if (p2.content === "table") {
    const m3 = TableMap.get(d.blockContent.node), b4 = d.blockContent.beforePos + m3.positionAt(
      m3.height - 1,
      m3.width - 1,
      d.blockContent.node
    ) + 1, g = n.doc.resolve(b4).nodeAfter.nodeSize;
    f4 = b4 + g - 2;
  } else
    f4 = d.blockContent.afterPos - 1;
  n.setSelection(TextSelection.create(n.doc, h3, f4));
}
function Pn2(n, e = false) {
  const t2 = ht(n), o = e ? Sn2(n.doc, n.selection) : n.selection;
  let s = o.$from, r2 = o.$to;
  for (; r2.parentOffset >= r2.parent.nodeSize - 2 && r2.depth > 0; )
    r2 = n.doc.resolve(r2.pos + 1);
  for (; r2.parentOffset === 0 && r2.depth > 0; )
    r2 = n.doc.resolve(r2.pos - 1);
  for (; s.parentOffset === 0 && s.depth > 0; )
    s = n.doc.resolve(s.pos - 1);
  for (; s.parentOffset >= s.parent.nodeSize - 2 && s.depth > 0; )
    s = n.doc.resolve(s.pos + 1);
  const i3 = Dt(
    n.doc.slice(s.pos, r2.pos, true),
    t2
  );
  return {
    _meta: {
      startPos: s.pos,
      endPos: r2.pos
    },
    ...i3
  };
}
function Tn(n) {
  const { bnBlock: e } = Ot(n), t2 = ht(n.doc), o = n.doc.resolve(e.beforePos), s = o.nodeBefore, r2 = n.doc.resolve(e.afterPos).nodeAfter;
  let i3;
  return o.depth > 1 && (i3 = o.node(), i3.type.isInGroup("bnBlock") || (i3 = o.node(o.depth - 1))), {
    block: L(e.node, t2),
    prevBlock: s === null ? void 0 : L(s, t2),
    nextBlock: r2 === null ? void 0 : L(r2, t2),
    parentBlock: i3 === void 0 ? void 0 : L(i3, t2)
  };
}
function De(n, e, t2 = "start") {
  const o = typeof e == "string" ? e : e.id, s = ht(n.doc), r2 = J(s), i3 = Bt(o, n.doc);
  if (!i3)
    throw new Error(`Block with ID ${o} not found`);
  const l = Z(i3), a2 = r2.blockSchema[l.blockNoteType].content;
  if (l.isBlockContainer) {
    const c = l.blockContent;
    if (a2 === "none") {
      n.setSelection(NodeSelection.create(n.doc, c.beforePos));
      return;
    }
    if (a2 === "inline")
      t2 === "start" ? n.setSelection(
        TextSelection.create(n.doc, c.beforePos + 1)
      ) : n.setSelection(
        TextSelection.create(n.doc, c.afterPos - 1)
      );
    else if (a2 === "table")
      t2 === "start" ? n.setSelection(
        TextSelection.create(n.doc, c.beforePos + 4)
      ) : n.setSelection(
        TextSelection.create(n.doc, c.afterPos - 4)
      );
    else
      throw new O(a2);
  } else {
    const c = t2 === "start" ? l.childContainer.node.firstChild : l.childContainer.node.lastChild;
    De(n, c.attrs.id, t2);
  }
}
var Mn = class {
  constructor(e) {
    this.editor = e;
  }
  /**
   * Gets a snapshot of the current selection. This contains all blocks (included nested blocks)
   * that the selection spans across.
   *
   * If the selection starts / ends halfway through a block, the returned data will contain the entire block.
   */
  getSelection() {
    return this.editor.transact((e) => xn(e));
  }
  /**
   * Gets a snapshot of the current selection. This contains all blocks (included nested blocks)
   * that the selection spans across.
   *
   * If the selection starts / ends halfway through a block, the returned block will be
   * only the part of the block that is included in the selection.
   */
  getSelectionCutBlocks(e = false) {
    return this.editor.transact(
      (t2) => Pn2(t2, e)
    );
  }
  /**
   * Sets the selection to a range of blocks.
   * @param startBlock The identifier of the block that should be the start of the selection.
   * @param endBlock The identifier of the block that should be the end of the selection.
   */
  setSelection(e, t2) {
    return this.editor.transact((o) => En(o, e, t2));
  }
  /**
   * Gets a snapshot of the current text cursor position.
   * @returns A snapshot of the current text cursor position.
   */
  getTextCursorPosition() {
    return this.editor.transact((e) => Tn(e));
  }
  /**
   * Sets the text cursor position to the start or end of an existing block. Throws an error if the target block could
   * not be found.
   * @param targetBlock The identifier of an existing block that the text cursor should be moved to.
   * @param placement Whether the text cursor should be placed at the start or end of the block.
   */
  setTextCursorPosition(e, t2 = "start") {
    return this.editor.transact(
      (o) => De(o, e, t2)
    );
  }
  /**
   * Gets the bounding box of the current selection.
   */
  getSelectionBoundingBox() {
    if (!this.editor.prosemirrorView)
      return;
    const { selection: e } = this.editor.prosemirrorState, { ranges: t2 } = e, o = Math.min(...t2.map((r2) => r2.$from.pos)), s = Math.max(...t2.map((r2) => r2.$to.pos));
    if (isNodeSelection(e)) {
      const r2 = this.editor.prosemirrorView.nodeDOM(o);
      if (r2)
        return r2.getBoundingClientRect();
    }
    return posToDOMRect(
      this.editor.prosemirrorView,
      o,
      s
    ).toJSON();
  }
};
var wn = class {
  constructor(e) {
    k3(this, "activeTransaction", null);
    k3(this, "isInCan", false);
    this.editor = e;
  }
  /**
   * For any command that can be executed, you can check if it can be executed by calling `editor.can(command)`.
   * @example
   * ```ts
   * if (editor.can(editor.undo)) {
   *   // show button
   * } else {
   *   // hide button
   * }
   */
  can(e) {
    try {
      return this.isInCan = true, e();
    } finally {
      this.isInCan = false;
    }
  }
  /**
   * Execute a prosemirror command. This is mostly for backwards compatibility with older code.
   *
   * @note You should prefer the {@link transact} method when possible, as it will automatically handle the dispatching of the transaction and work across blocknote transactions.
   *
   * @example
   * ```ts
   * editor.exec((state, dispatch, view) => {
   *   dispatch(state.tr.insertText("Hello, world!"));
   * });
   * ```
   */
  exec(e) {
    if (this.activeTransaction)
      throw new Error(
        "`exec` should not be called within a `transact` call, move the `exec` call outside of the `transact` call"
      );
    if (this.isInCan)
      return this.canExec(e);
    const t2 = this.prosemirrorState, o = this.prosemirrorView;
    return e(t2, (r2) => this.prosemirrorView.dispatch(r2), o);
  }
  /**
   * Check if a command can be executed. A command should return `false` if it is not valid in the current state.
   *
   * @example
   * ```ts
   * if (editor.canExec(command)) {
   *   // show button
   * } else {
   *   // hide button
   * }
   * ```
   */
  canExec(e) {
    if (this.activeTransaction)
      throw new Error(
        "`canExec` should not be called within a `transact` call, move the `canExec` call outside of the `transact` call"
      );
    const t2 = this.prosemirrorState, o = this.prosemirrorView;
    return e(t2, void 0, o);
  }
  /**
   * Execute a function within a "blocknote transaction".
   * All changes to the editor within the transaction will be grouped together, so that
   * we can dispatch them as a single operation (thus creating only a single undo step)
   *
   * @note There is no need to dispatch the transaction, as it will be automatically dispatched when the callback is complete.
   *
   * @example
   * ```ts
   * // All changes to the editor will be grouped together
   * editor.transact((tr) => {
   *   tr.insertText("Hello, world!");
   * // These two operations will be grouped together in a single undo step
   *   editor.transact((tr) => {
   *     tr.insertText("Hello, world!");
   *   });
   * });
   * ```
   */
  transact(e) {
    if (this.activeTransaction)
      return e(this.activeTransaction);
    try {
      this.activeTransaction = this.editor._tiptapEditor.state.tr;
      const t2 = e(this.activeTransaction), o = this.activeTransaction;
      return this.activeTransaction = null, o && // Only dispatch if the transaction was actually modified in some way
      (o.docChanged || o.selectionSet || o.scrolledIntoView || o.storedMarksSet || !o.isGeneric) && this.prosemirrorView.dispatch(o), t2;
    } finally {
      this.activeTransaction = null;
    }
  }
  /**
   * Get the underlying prosemirror state
   * @note Prefer using `editor.transact` to read the current editor state, as that will ensure the state is up to date
   * @see https://prosemirror.net/docs/ref/#state.EditorState
   */
  get prosemirrorState() {
    if (this.activeTransaction)
      throw new Error(
        "`prosemirrorState` should not be called within a `transact` call, move the `prosemirrorState` call outside of the `transact` call or use `editor.transact` to read the current editor state"
      );
    return this.editor._tiptapEditor.state;
  }
  /**
   * Get the underlying prosemirror view
   * @see https://prosemirror.net/docs/ref/#view.EditorView
   */
  get prosemirrorView() {
    return this.editor._tiptapEditor.view;
  }
  isFocused() {
    var e;
    return ((e = this.prosemirrorView) == null ? void 0 : e.hasFocus()) || false;
  }
  focus() {
    var e;
    (e = this.prosemirrorView) == null || e.focus();
  }
  /**
   * Checks if the editor is currently editable, or if it's locked.
   * @returns True if the editor is editable, false otherwise.
   */
  get isEditable() {
    if (!this.editor._tiptapEditor) {
      if (!this.editor.headless)
        throw new Error("no editor, but also not headless?");
      return false;
    }
    return this.editor._tiptapEditor.isEditable === void 0 ? true : this.editor._tiptapEditor.isEditable;
  }
  /**
   * Makes the editor editable or locks it, depending on the argument passed.
   * @param editable True to make the editor editable, or false to lock it.
   */
  set isEditable(e) {
    if (!this.editor._tiptapEditor) {
      if (!this.editor.headless)
        throw new Error("no editor, but also not headless?");
      return;
    }
    this.editor._tiptapEditor.options.editable !== e && this.editor._tiptapEditor.setEditable(e);
  }
  /**
   * Undo the last action.
   */
  undo() {
    const e = this.editor.getExtension("yUndo");
    if (e)
      return this.exec(e.undoCommand);
    const t2 = this.editor.getExtension("history");
    if (t2)
      return this.exec(t2.undoCommand);
    throw new Error("No undo plugin found");
  }
  /**
   * Redo the last action.
   */
  redo() {
    const e = this.editor.getExtension("yUndo");
    if (e)
      return this.exec(e.redoCommand);
    const t2 = this.editor.getExtension("history");
    if (t2)
      return this.exec(t2.redoCommand);
    throw new Error("No redo plugin found");
  }
};
function vn(n, e, t2, o = { updateSelection: true }) {
  let { from: s, to: r2 } = typeof e == "number" ? { from: e, to: e } : { from: e.from, to: e.to }, i3 = true, l = true, a2 = "";
  if (t2.forEach((c) => {
    c.check(), i3 && c.isText && c.marks.length === 0 ? a2 += c.text : i3 = false, l = l ? c.isBlock : false;
  }), s === r2 && l) {
    const { parent: c } = n.doc.resolve(s);
    c.isTextblock && !c.type.spec.code && !c.childCount && (s -= 1, r2 += 1);
  }
  return i3 ? n.insertText(a2, s, r2) : n.replaceWith(s, r2, t2), o.updateSelection && selectionToInsertionEnd(n, n.steps.length - 1, -1), true;
}
var In2 = class {
  constructor(e) {
    this.editor = e;
  }
  /**
   * Insert a piece of content at the current cursor position.
   *
   * @param content can be a string, or array of partial inline content elements
   */
  insertInlineContent(e, { updateSelection: t2 = false } = {}) {
    const o = T(e, this.editor.pmSchema);
    this.editor.transact((s) => {
      vn(
        s,
        {
          from: s.selection.from,
          to: s.selection.to
        },
        o,
        {
          updateSelection: t2
        }
      );
    });
  }
  /**
   * Gets the active text styles at the text cursor position or at the end of the current selection if it's active.
   */
  getActiveStyles() {
    return this.editor.transact((e) => {
      const t2 = {}, o = e.selection.$to.marks();
      for (const s of o) {
        const r2 = this.editor.schema.styleSchema[s.type.name];
        if (!r2) {
          s.type.name !== "link" && // "blocknoteIgnore" tagged marks (such as comments) are also not considered BlockNote "styles"
          !s.type.spec.blocknoteIgnore && console.warn("mark not found in styleschema", s.type.name);
          continue;
        }
        r2.propSchema === "boolean" ? t2[r2.type] = true : t2[r2.type] = s.attrs.stringValue;
      }
      return t2;
    });
  }
  /**
   * Adds styles to the currently selected content.
   * @param styles The styles to add.
   */
  addStyles(e) {
    for (const [t2, o] of Object.entries(e)) {
      const s = this.editor.schema.styleSchema[t2];
      if (!s)
        throw new Error(`style ${t2} not found in styleSchema`);
      if (s.propSchema === "boolean")
        this.editor._tiptapEditor.commands.setMark(t2);
      else if (s.propSchema === "string")
        this.editor._tiptapEditor.commands.setMark(t2, {
          stringValue: o
        });
      else
        throw new O(s.propSchema);
    }
  }
  /**
   * Removes styles from the currently selected content.
   * @param styles The styles to remove.
   */
  removeStyles(e) {
    for (const t2 of Object.keys(e))
      this.editor._tiptapEditor.commands.unsetMark(t2);
  }
  /**
   * Toggles styles on the currently selected content.
   * @param styles The styles to toggle.
   */
  toggleStyles(e) {
    for (const [t2, o] of Object.entries(e)) {
      const s = this.editor.schema.styleSchema[t2];
      if (!s)
        throw new Error(`style ${t2} not found in styleSchema`);
      if (s.propSchema === "boolean")
        this.editor._tiptapEditor.commands.toggleMark(t2);
      else if (s.propSchema === "string")
        this.editor._tiptapEditor.commands.toggleMark(t2, {
          stringValue: o
        });
      else
        throw new O(s.propSchema);
    }
  }
  /**
   * Gets the currently selected text.
   */
  getSelectedText() {
    return this.editor.transact((e) => e.doc.textBetween(e.selection.from, e.selection.to));
  }
  /**
   * Gets the URL of the last link in the current selection, or `undefined` if there are no links in the selection.
   */
  getSelectedLinkUrl() {
    return this.editor._tiptapEditor.getAttributes("link").href;
  }
  /**
   * Creates a new link to replace the selected content.
   * @param url The link URL.
   * @param text The text to display the link with.
   */
  createLink(e, t2) {
    if (e === "")
      return;
    const o = this.editor.pmSchema.mark("link", { href: e });
    this.editor.transact((s) => {
      const { from: r2, to: i3 } = s.selection;
      t2 ? s.insertText(t2, r2, i3).addMark(r2, r2 + t2.length, o) : s.setSelection(TextSelection.create(s.doc, i3)).addMark(
        r2,
        i3,
        o
      );
    });
  }
};
function An2(n) {
  return findParentNodeClosestToPos(n.state.selection.$from, (e) => e.type.name === "tableCell" || e.type.name === "tableHeader") !== void 0;
}
function Oe3(n, e) {
  var s;
  const t2 = e.nodes.hardBreak;
  let o = Fragment.empty;
  return n.forEach((r2) => {
    r2.isTextblock && r2.childCount > 0 ? (o = o.append(r2.content), o = o.addToEnd(t2.create())) : r2.isText ? o = o.addToEnd(r2) : r2.isBlock && r2.childCount > 0 && (o = o.append(
      Oe3(r2.content, e)
    ), o = o.addToEnd(t2.create()));
  }), ((s = o.lastChild) == null ? void 0 : s.type) === t2 && (o = o.cut(0, o.size - 1)), o;
}
function Nn2(n, e) {
  const t2 = [];
  return n.forEach((o, s, r2) => {
    r2 !== e && t2.push(o);
  }), Fragment.from(t2);
}
function _n(n, e) {
  const t2 = [];
  for (let o = 0; o < n.childCount; o++)
    if (n.child(o).type.name === "tableRow")
      if (t2.length > 0 && t2[t2.length - 1].type.name === "table") {
        const s = t2[t2.length - 1], r2 = s.copy(s.content.addToEnd(n.child(o)));
        t2[t2.length - 1] = r2;
      } else {
        const s = e.nodes.table.createChecked(
          void 0,
          n.child(o)
        );
        t2.push(s);
      }
    else
      t2.push(n.child(o));
  return n = Fragment.from(t2), n;
}
function Ln(n, e) {
  let t2 = Fragment.from(n.content);
  if (t2 = _n(t2, e.state.schema), An2(e)) {
    let o = false;
    if (t2.descendants((s) => {
      s.type.isInGroup("tableContent") && (o = true);
    }), !o && // is the content valid for a table paragraph?
    !e.state.schema.nodes.tableParagraph.validContent(t2))
      return new Slice(
        Oe3(t2, e.state.schema),
        0,
        0
      );
  }
  if (!Dn2(t2, e))
    return new Slice(t2, n.openStart, n.openEnd);
  for (let o = 0; o < t2.childCount; o++)
    if (t2.child(o).type.spec.group === "blockContent") {
      const s = [t2.child(o)];
      if (o + 1 < t2.childCount && t2.child(o + 1).type.name === "blockGroup") {
        const i3 = t2.child(o + 1).child(0).child(0);
        (i3.type.name === "bulletListItem" || i3.type.name === "numberedListItem" || i3.type.name === "checkListItem") && (s.push(t2.child(o + 1)), t2 = Nn2(t2, o + 1));
      }
      const r2 = e.state.schema.nodes.blockContainer.createChecked(
        void 0,
        s
      );
      t2 = t2.replaceChild(o, r2);
    }
  return new Slice(t2, n.openStart, n.openEnd);
}
function Dn2(n, e) {
  var r2, i3;
  const t2 = n.childCount === 1, o = ((r2 = n.firstChild) == null ? void 0 : r2.type.spec.content) === "inline*", s = ((i3 = n.firstChild) == null ? void 0 : i3.type.spec.content) === "tableRow+";
  if (t2) {
    if (o)
      return false;
    if (s) {
      const l = Tt(e.state);
      if (l.isBlockContainer)
        return !(l.blockContent.node.type.spec.content === "tableRow+");
    }
  }
  return true;
}
var On = {
  enableInputRules: true,
  enablePasteRules: true,
  enableCoreExtensions: false
};
var $e = class _$e extends f2 {
  constructor(t2) {
    var c, d, u2, p2, h3, f4, m3, b4, g, x;
    super();
    k3(this, "pmSchema");
    k3(this, "_tiptapEditor");
    k3(this, "elementRenderer", null);
    k3(this, "blockCache", /* @__PURE__ */ new WeakMap());
    k3(this, "dictionary");
    k3(this, "schema");
    k3(this, "blockImplementations");
    k3(this, "inlineContentImplementations");
    k3(this, "styleImplementations");
    k3(this, "uploadFile");
    k3(this, "onUploadStartCallbacks", []);
    k3(this, "onUploadEndCallbacks", []);
    k3(this, "resolveFileUrl");
    k3(this, "settings");
    k3(this, "_blockManager");
    k3(this, "_eventManager");
    k3(this, "_exportManager");
    k3(this, "_extensionManager");
    k3(this, "_selectionManager");
    k3(this, "_stateManager");
    k3(this, "_styleManager");
    k3(this, "unregisterExtension", (...t3) => this._extensionManager.unregisterExtension(...t3));
    k3(this, "registerExtension", (...t3) => this._extensionManager.registerExtension(...t3));
    k3(this, "getExtension", (...t3) => this._extensionManager.getExtension(...t3));
    k3(this, "mount", (t3) => {
      this._tiptapEditor.mount({ mount: t3 });
    });
    k3(this, "unmount", () => {
      this._tiptapEditor.unmount();
    });
    this.options = t2, this.dictionary = t2.dictionary || i2, this.settings = {
      tables: {
        splitCells: ((c = t2 == null ? void 0 : t2.tables) == null ? void 0 : c.splitCells) ?? false,
        cellBackgroundColor: ((d = t2 == null ? void 0 : t2.tables) == null ? void 0 : d.cellBackgroundColor) ?? false,
        cellTextColor: ((u2 = t2 == null ? void 0 : t2.tables) == null ? void 0 : u2.cellTextColor) ?? false,
        headers: ((p2 = t2 == null ? void 0 : t2.tables) == null ? void 0 : p2.headers) ?? false
      }
    };
    const o = {
      defaultStyles: true,
      schema: t2.schema || h.create(),
      ...t2,
      placeholders: {
        ...this.dictionary.placeholders,
        ...t2.placeholders
      }
    };
    if (this.schema = o.schema, this.blockImplementations = o.schema.blockSpecs, this.inlineContentImplementations = o.schema.inlineContentSpecs, this.styleImplementations = o.schema.styleSpecs, o.uploadFile) {
      const y = o.uploadFile;
      this.uploadFile = async (I3, M2) => {
        this.onUploadStartCallbacks.forEach(
          (A4) => A4.apply(this, [M2])
        );
        try {
          return await y(I3, M2);
        } finally {
          this.onUploadEndCallbacks.forEach(
            (A4) => A4.apply(this, [M2])
          );
        }
      };
    }
    this.resolveFileUrl = o.resolveFileUrl, this._eventManager = new Eo2(this), this._extensionManager = new Cn2(this, o);
    const s = this._extensionManager.getTiptapExtensions(), r2 = this._extensionManager.hasExtension("ySync") || this._extensionManager.hasExtension("liveblocksExtension");
    r2 && o.initialContent && console.warn(
      "When using Collaboration, initialContent might cause conflicts, because changes should come from the collaboration provider"
    );
    const i3 = {
      ...On,
      ...o._tiptapOptions,
      element: null,
      autofocus: o.autofocus ?? false,
      extensions: s,
      editorProps: {
        ...(h3 = o._tiptapOptions) == null ? void 0 : h3.editorProps,
        attributes: {
          // As of TipTap v2.5.0 the tabIndex is removed when the editor is not
          // editable, so you can't focus it. We want to revert this as we have
          // UI behaviour that relies on it.
          tabIndex: "0",
          ...(m3 = (f4 = o._tiptapOptions) == null ? void 0 : f4.editorProps) == null ? void 0 : m3.attributes,
          ...(b4 = o.domAttributes) == null ? void 0 : b4.editor,
          class: D(
            "bn-editor",
            o.defaultStyles ? "bn-default-styles" : "",
            ((x = (g = o.domAttributes) == null ? void 0 : g.editor) == null ? void 0 : x.class) || ""
          )
        },
        transformPasted: Ln
      }
    };
    try {
      const y = o.initialContent || (r2 ? [
        {
          type: "paragraph",
          id: "initialBlockId"
        }
      ] : [
        {
          type: "paragraph",
          id: Q.options.generateID()
        }
      ]);
      if (!Array.isArray(y) || y.length === 0)
        throw new Error(
          "initialContent must be a non-empty array of blocks, received: " + y
        );
      const I3 = getSchema(i3.extensions), M2 = y.map(
        (He) => bt(He, I3, this.schema.styleSchema).toJSON()
      ), A4 = createDocument(
        {
          type: "doc",
          content: [
            {
              type: "blockGroup",
              content: M2
            }
          ]
        },
        I3,
        i3.parseOptions
      );
      this._tiptapEditor = new Editor({
        ...i3,
        content: A4.toJSON()
      }), this.pmSchema = this._tiptapEditor.schema;
    } catch (y) {
      throw new Error(
        "Error creating document from blocks passed as `initialContent`",
        { cause: y }
      );
    }
    let l;
    const a2 = this.pmSchema.nodes.doc.createAndFill;
    this.pmSchema.nodes.doc.createAndFill = (...y) => {
      if (l)
        return l;
      const I3 = a2.apply(this.pmSchema.nodes.doc, y), M2 = JSON.parse(JSON.stringify(I3.toJSON()));
      return M2.content[0].content[0].attrs.id = "initialBlockId", l = Node.fromJSON(this.pmSchema, M2), l;
    }, this.pmSchema.cached.blockNoteEditor = this, this._blockManager = new xo2(this), this._exportManager = new Lo3(this), this._selectionManager = new Mn(this), this._stateManager = new wn(this), this._styleManager = new In2(this), this.emit("create");
  }
  static create(t2) {
    return new _$e(t2 ?? {});
  }
  /**
   * BlockNote extensions that are added to the editor, keyed by the extension key
   */
  get extensions() {
    return this._extensionManager.getExtensions();
  }
  /**
   * Execute a prosemirror command. This is mostly for backwards compatibility with older code.
   *
   * @note You should prefer the {@link transact} method when possible, as it will automatically handle the dispatching of the transaction and work across blocknote transactions.
   *
   * @example
   * ```ts
   * editor.exec((state, dispatch, view) => {
   *   dispatch(state.tr.insertText("Hello, world!"));
   * });
   * ```
   */
  exec(t2) {
    return this._stateManager.exec(t2);
  }
  /**
   * Check if a command can be executed. A command should return `false` if it is not valid in the current state.
   *
   * @example
   * ```ts
   * if (editor.canExec(command)) {
   *   // show button
   * } else {
   *   // hide button
   * }
   * ```
   */
  canExec(t2) {
    return this._stateManager.canExec(t2);
  }
  /**
   * Execute a function within a "blocknote transaction".
   * All changes to the editor within the transaction will be grouped together, so that
   * we can dispatch them as a single operation (thus creating only a single undo step)
   *
   * @note There is no need to dispatch the transaction, as it will be automatically dispatched when the callback is complete.
   *
   * @example
   * ```ts
   * // All changes to the editor will be grouped together
   * editor.transact((tr) => {
   *   tr.insertText("Hello, world!");
   * // These two operations will be grouped together in a single undo step
   *   editor.transact((tr) => {
   *     tr.insertText("Hello, world!");
   *   });
   * });
   * ```
   */
  transact(t2) {
    return this._stateManager.transact(t2);
  }
  /**
   * Get the underlying prosemirror state
   * @note Prefer using `editor.transact` to read the current editor state, as that will ensure the state is up to date
   * @see https://prosemirror.net/docs/ref/#state.EditorState
   */
  get prosemirrorState() {
    return this._stateManager.prosemirrorState;
  }
  /**
   * Get the underlying prosemirror view
   * @see https://prosemirror.net/docs/ref/#view.EditorView
   */
  get prosemirrorView() {
    return this._stateManager.prosemirrorView;
  }
  get domElement() {
    var t2;
    if (!this.headless)
      return (t2 = this.prosemirrorView) == null ? void 0 : t2.dom;
  }
  isFocused() {
    var t2;
    return this.headless ? false : ((t2 = this.prosemirrorView) == null ? void 0 : t2.hasFocus()) || false;
  }
  get headless() {
    return !this._tiptapEditor.isInitialized;
  }
  /**
   * Focus on the editor
   */
  focus() {
    this.headless || this.prosemirrorView.focus();
  }
  /**
   * Blur the editor
   */
  blur() {
    var t2;
    this.headless || (t2 = this.domElement) == null || t2.blur();
  }
  // TODO move to extension
  onUploadStart(t2) {
    return this.onUploadStartCallbacks.push(t2), () => {
      const o = this.onUploadStartCallbacks.indexOf(t2);
      o > -1 && this.onUploadStartCallbacks.splice(o, 1);
    };
  }
  onUploadEnd(t2) {
    return this.onUploadEndCallbacks.push(t2), () => {
      const o = this.onUploadEndCallbacks.indexOf(t2);
      o > -1 && this.onUploadEndCallbacks.splice(o, 1);
    };
  }
  /**
   * @deprecated, use `editor.document` instead
   */
  get topLevelBlocks() {
    return this.document;
  }
  /**
   * Gets a snapshot of all top-level (non-nested) blocks in the editor.
   * @returns A snapshot of all top-level (non-nested) blocks in the editor.
   */
  get document() {
    return this._blockManager.document;
  }
  /**
   * Gets a snapshot of an existing block from the editor.
   * @param blockIdentifier The identifier of an existing block that should be
   * retrieved.
   * @returns The block that matches the identifier, or `undefined` if no
   * matching block was found.
   */
  getBlock(t2) {
    return this._blockManager.getBlock(t2);
  }
  /**
   * Gets a snapshot of the previous sibling of an existing block from the
   * editor.
   * @param blockIdentifier The identifier of an existing block for which the
   * previous sibling should be retrieved.
   * @returns The previous sibling of the block that matches the identifier.
   * `undefined` if no matching block was found, or it's the first child/block
   * in the document.
   */
  getPrevBlock(t2) {
    return this._blockManager.getPrevBlock(t2);
  }
  /**
   * Gets a snapshot of the next sibling of an existing block from the editor.
   * @param blockIdentifier The identifier of an existing block for which the
   * next sibling should be retrieved.
   * @returns The next sibling of the block that matches the identifier.
   * `undefined` if no matching block was found, or it's the last child/block in
   * the document.
   */
  getNextBlock(t2) {
    return this._blockManager.getNextBlock(t2);
  }
  /**
   * Gets a snapshot of the parent of an existing block from the editor.
   * @param blockIdentifier The identifier of an existing block for which the
   * parent should be retrieved.
   * @returns The parent of the block that matches the identifier. `undefined`
   * if no matching block was found, or the block isn't nested.
   */
  getParentBlock(t2) {
    return this._blockManager.getParentBlock(t2);
  }
  /**
   * Traverses all blocks in the editor depth-first, and executes a callback for each.
   * @param callback The callback to execute for each block. Returning `false` stops the traversal.
   * @param reverse Whether the blocks should be traversed in reverse order.
   */
  forEachBlock(t2, o = false) {
    this._blockManager.forEachBlock(t2, o);
  }
  /**
   * Executes a callback whenever the editor's contents change.
   * @param callback The callback to execute.
   *
   * @deprecated use {@link BlockNoteEditor.onChange} instead
   */
  onEditorContentChange(t2) {
    this._tiptapEditor.on("update", t2);
  }
  /**
   * Executes a callback whenever the editor's selection changes.
   * @param callback The callback to execute.
   *
   * @deprecated use `onSelectionChange` instead
   */
  onEditorSelectionChange(t2) {
    this._tiptapEditor.on("selectionUpdate", t2);
  }
  /**
   * Executes a callback before any change is applied to the editor, allowing you to cancel the change.
   * @param callback The callback to execute.
   * @returns A function to remove the callback.
   */
  onBeforeChange(t2) {
    return this._extensionManager.getExtension(Do).subscribe(t2);
  }
  /**
   * Gets a snapshot of the current text cursor position.
   * @returns A snapshot of the current text cursor position.
   */
  getTextCursorPosition() {
    return this._selectionManager.getTextCursorPosition();
  }
  /**
   * Sets the text cursor position to the start or end of an existing block. Throws an error if the target block could
   * not be found.
   * @param targetBlock The identifier of an existing block that the text cursor should be moved to.
   * @param placement Whether the text cursor should be placed at the start or end of the block.
   */
  setTextCursorPosition(t2, o = "start") {
    return this._selectionManager.setTextCursorPosition(t2, o);
  }
  /**
   * Gets a snapshot of the current selection. This contains all blocks (included nested blocks)
   * that the selection spans across.
   *
   * If the selection starts / ends halfway through a block, the returned data will contain the entire block.
   */
  getSelection() {
    return this._selectionManager.getSelection();
  }
  /**
   * Gets a snapshot of the current selection. This contains all blocks (included nested blocks)
   * that the selection spans across.
   *
   * If the selection starts / ends halfway through a block, the returned block will be
   * only the part of the block that is included in the selection.
   */
  getSelectionCutBlocks(t2 = false) {
    return this._selectionManager.getSelectionCutBlocks(t2);
  }
  /**
   * Sets the selection to a range of blocks.
   * @param startBlock The identifier of the block that should be the start of the selection.
   * @param endBlock The identifier of the block that should be the end of the selection.
   */
  setSelection(t2, o) {
    return this._selectionManager.setSelection(t2, o);
  }
  /**
   * Checks if the editor is currently editable, or if it's locked.
   * @returns True if the editor is editable, false otherwise.
   */
  get isEditable() {
    return this._stateManager.isEditable;
  }
  /**
   * Makes the editor editable or locks it, depending on the argument passed.
   * @param editable True to make the editor editable, or false to lock it.
   */
  set isEditable(t2) {
    this._stateManager.isEditable = t2;
  }
  /**
   * Inserts new blocks into the editor. If a block's `id` is undefined, BlockNote generates one automatically. Throws an
   * error if the reference block could not be found.
   * @param blocksToInsert An array of partial blocks that should be inserted.
   * @param referenceBlock An identifier for an existing block, at which the new blocks should be inserted.
   * @param placement Whether the blocks should be inserted just before, just after, or nested inside the
   * `referenceBlock`.
   */
  insertBlocks(t2, o, s = "before") {
    return this._blockManager.insertBlocks(
      t2,
      o,
      s
    );
  }
  /**
   * Updates an existing block in the editor. Since updatedBlock is a PartialBlock object, some fields might not be
   * defined. These undefined fields are kept as-is from the existing block. Throws an error if the block to update could
   * not be found.
   * @param blockToUpdate The block that should be updated.
   * @param update A partial block which defines how the existing block should be changed.
   */
  updateBlock(t2, o) {
    return this._blockManager.updateBlock(t2, o);
  }
  /**
   * Removes existing blocks from the editor. Throws an error if any of the blocks could not be found.
   * @param blocksToRemove An array of identifiers for existing blocks that should be removed.
   */
  removeBlocks(t2) {
    return this._blockManager.removeBlocks(t2);
  }
  /**
   * Replaces existing blocks in the editor with new blocks. If the blocks that should be removed are not adjacent or
   * are at different nesting levels, `blocksToInsert` will be inserted at the position of the first block in
   * `blocksToRemove`. Throws an error if any of the blocks to remove could not be found.
   * @param blocksToRemove An array of blocks that should be replaced.
   * @param blocksToInsert An array of partial blocks to replace the old ones with.
   */
  replaceBlocks(t2, o) {
    return this._blockManager.replaceBlocks(t2, o);
  }
  /**
   * Undo the last action.
   */
  undo() {
    return this._stateManager.undo();
  }
  /**
   * Redo the last action.
   */
  redo() {
    return this._stateManager.redo();
  }
  /**
   * Insert a piece of content at the current cursor position.
   *
   * @param content can be a string, or array of partial inline content elements
   */
  insertInlineContent(t2, { updateSelection: o = false } = {}) {
    this._styleManager.insertInlineContent(t2, { updateSelection: o });
  }
  /**
   * Gets the active text styles at the text cursor position or at the end of the current selection if it's active.
   */
  getActiveStyles() {
    return this._styleManager.getActiveStyles();
  }
  /**
   * Adds styles to the currently selected content.
   * @param styles The styles to add.
   */
  addStyles(t2) {
    this._styleManager.addStyles(t2);
  }
  /**
   * Removes styles from the currently selected content.
   * @param styles The styles to remove.
   */
  removeStyles(t2) {
    this._styleManager.removeStyles(t2);
  }
  /**
   * Toggles styles on the currently selected content.
   * @param styles The styles to toggle.
   */
  toggleStyles(t2) {
    this._styleManager.toggleStyles(t2);
  }
  /**
   * Gets the currently selected text.
   */
  getSelectedText() {
    return this._styleManager.getSelectedText();
  }
  /**
   * Gets the URL of the last link in the current selection, or `undefined` if there are no links in the selection.
   */
  getSelectedLinkUrl() {
    return this._styleManager.getSelectedLinkUrl();
  }
  /**
   * Creates a new link to replace the selected content.
   * @param url The link URL.
   * @param text The text to display the link with.
   */
  createLink(t2, o) {
    this._styleManager.createLink(t2, o);
  }
  /**
   * Checks if the block containing the text cursor can be nested.
   */
  canNestBlock() {
    return this._blockManager.canNestBlock();
  }
  /**
   * Nests the block containing the text cursor into the block above it.
   */
  nestBlock() {
    this._blockManager.nestBlock();
  }
  /**
   * Checks if the block containing the text cursor is nested.
   */
  canUnnestBlock() {
    return this._blockManager.canUnnestBlock();
  }
  /**
   * Lifts the block containing the text cursor out of its parent.
   */
  unnestBlock() {
    this._blockManager.unnestBlock();
  }
  /**
   * Moves the selected blocks up. If the previous block has children, moves
   * them to the end of its children. If there is no previous block, but the
   * current blocks share a common parent, moves them out of & before it.
   */
  moveBlocksUp() {
    return this._blockManager.moveBlocksUp();
  }
  /**
   * Moves the selected blocks down. If the next block has children, moves
   * them to the start of its children. If there is no next block, but the
   * current blocks share a common parent, moves them out of & after it.
   */
  moveBlocksDown() {
    return this._blockManager.moveBlocksDown();
  }
  /**
   * Exports blocks into a simplified HTML string. To better conform to HTML standards, children of blocks which aren't list
   * items are un-nested in the output HTML.
   *
   * @param blocks An array of blocks that should be serialized into HTML.
   * @returns The blocks, serialized as an HTML string.
   */
  blocksToHTMLLossy(t2 = this.document) {
    return this._exportManager.blocksToHTMLLossy(t2);
  }
  /**
   * Serializes blocks into an HTML string in the format that would normally be rendered by the editor.
   *
   * Use this method if you want to server-side render HTML (for example, a blog post that has been edited in BlockNote)
   * and serve it to users without loading the editor on the client (i.e.: displaying the blog post)
   *
   * @param blocks An array of blocks that should be serialized into HTML.
   * @returns The blocks, serialized as an HTML string.
   */
  blocksToFullHTML(t2 = this.document) {
    return this._exportManager.blocksToFullHTML(t2);
  }
  /**
   * Parses blocks from an HTML string. Tries to create `Block` objects out of any HTML block-level elements, and
   * `InlineNode` objects from any HTML inline elements, though not all element types are recognized. If BlockNote
   * doesn't recognize an HTML element's tag, it will parse it as a paragraph or plain text.
   * @param html The HTML string to parse blocks from.
   * @returns The blocks parsed from the HTML string.
   */
  tryParseHTMLToBlocks(t2) {
    return this._exportManager.tryParseHTMLToBlocks(t2);
  }
  /**
   * Serializes blocks into a Markdown string. The output is simplified as Markdown does not support all features of
   * BlockNote - children of blocks which aren't list items are un-nested and certain styles are removed.
   * @param blocks An array of blocks that should be serialized into Markdown.
   * @returns The blocks, serialized as a Markdown string.
   */
  blocksToMarkdownLossy(t2 = this.document) {
    return this._exportManager.blocksToMarkdownLossy(t2);
  }
  /**
   * Creates a list of blocks from a Markdown string. Tries to create `Block` and `InlineNode` objects based on
   * Markdown syntax, though not all symbols are recognized. If BlockNote doesn't recognize a symbol, it will parse it
   * as text.
   * @param markdown The Markdown string to parse blocks from.
   * @returns The blocks parsed from the Markdown string.
   */
  tryParseMarkdownToBlocks(t2) {
    return this._exportManager.tryParseMarkdownToBlocks(t2);
  }
  /**
   * A callback function that runs whenever the editor's contents change.
   *
   * @param callback The callback to execute.
   * @returns A function to remove the callback.
   */
  onChange(t2, o) {
    return this._eventManager.onChange(t2, o);
  }
  /**
   * A callback function that runs whenever the text cursor position or selection changes.
   *
   * @param callback The callback to execute.
   * @returns A function to remove the callback.
   */
  onSelectionChange(t2, o) {
    return this._eventManager.onSelectionChange(
      t2,
      o
    );
  }
  /**
   * A callback function that runs when the editor has been mounted.
   *
   * This can be useful for plugins to initialize themselves after the editor has been mounted.
   *
   * @param callback The callback to execute.
   * @returns A function to remove the callback.
   */
  onMount(t2) {
    this._eventManager.onMount(t2);
  }
  /**
   * A callback function that runs when the editor has been unmounted.
   *
   * This can be useful for plugins to clean up themselves after the editor has been unmounted.
   *
   * @param callback The callback to execute.
   * @returns A function to remove the callback.
   */
  onUnmount(t2) {
    this._eventManager.onUnmount(t2);
  }
  /**
   * Gets the bounding box of the current selection.
   * @returns The bounding box of the current selection.
   */
  getSelectionBoundingBox() {
    return this._selectionManager.getSelectionBoundingBox();
  }
  get isEmpty() {
    const t2 = this.document;
    return t2.length === 0 || t2.length === 1 && t2[0].type === "paragraph" && t2[0].content.length === 0;
  }
  /**
   * Paste HTML into the editor. Defaults to converting HTML to BlockNote HTML.
   * @param html The HTML to paste.
   * @param raw Whether to paste the HTML as is, or to convert it to BlockNote HTML.
   */
  pasteHTML(t2, o = false) {
    this._exportManager.pasteHTML(t2, o);
  }
  /**
   * Paste text into the editor. Defaults to interpreting text as markdown.
   * @param text The text to paste.
   */
  pasteText(t2) {
    return this._exportManager.pasteText(t2);
  }
  /**
   * Paste markdown into the editor.
   * @param markdown The markdown to paste.
   */
  pasteMarkdown(t2) {
    return this._exportManager.pasteMarkdown(t2);
  }
};
var ds = class {
  constructor(e, t2, o) {
    this.mappings = t2, this.options = o;
  }
  async resolveFile(e) {
    var o;
    if (!((o = this.options) != null && o.resolveFileUrl))
      return (await fetch(e)).blob();
    const t2 = await this.options.resolveFileUrl(e);
    return t2 instanceof Blob ? t2 : (await fetch(t2)).blob();
  }
  mapStyles(e) {
    return Object.entries(e).map(([o, s]) => this.mappings.styleMapping[o](s, this));
  }
  mapInlineContent(e) {
    return this.mappings.inlineContentMapping[e.type](
      e,
      this
    );
  }
  transformInlineContent(e) {
    return e.map((t2) => this.mapInlineContent(t2));
  }
  async mapBlock(e, t2, o, s) {
    return this.mappings.blockMapping[e.type](
      e,
      this,
      t2,
      o,
      s
    );
  }
};
function us(n) {
  return {
    createBlockMapping: (e) => e,
    createInlineContentMapping: (e) => e,
    createStyleMapping: (e) => e
  };
}
function ps(n, ...e) {
  const t2 = [...n];
  for (const o of e)
    for (const s of o) {
      const r2 = t2.findLastIndex(
        (i3) => i3.group === s.group
      );
      r2 === -1 ? t2.push(s) : t2.splice(r2 + 1, 0, s);
    }
  return t2;
}

export {
  N,
  R,
  M,
  z,
  L2 as L,
  F2 as F,
  U,
  h,
  f2 as f,
  Xt2 as Xt,
  ls,
  Zt3 as Zt,
  Q3 as Q,
  eo,
  H3 as H,
  ae2 as ae,
  lo,
  Bo2 as Bo,
  yo2 as yo,
  Co2 as Co,
  So2 as So,
  ve,
  Ie,
  _o2 as _o,
  Ne2 as Ne,
  Sn2 as Sn,
  $e,
  ds,
  us,
  ps
};
//# sourceMappingURL=chunk-IO4LENIE.js.map
