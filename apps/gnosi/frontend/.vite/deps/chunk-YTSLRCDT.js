import {
  __commonJS
} from "./chunk-G3PMV62Z.js";

// node_modules/graphology-utils/is-graph.js
var require_is_graph = __commonJS({
  "node_modules/graphology-utils/is-graph.js"(exports, module) {
    module.exports = function isGraph(value) {
      return value !== null && typeof value === "object" && typeof value.addUndirectedEdgeWithKey === "function" && typeof value.dropNode === "function" && typeof value.multi === "boolean";
    };
  }
});

export {
  require_is_graph
};
//# sourceMappingURL=chunk-YTSLRCDT.js.map
