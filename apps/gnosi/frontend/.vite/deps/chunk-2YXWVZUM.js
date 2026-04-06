import {
  __commonJS,
  __export,
  __toESM
} from "./chunk-G3PMV62Z.js";

// node_modules/lodash.isequal/index.js
var require_lodash = __commonJS({
  "node_modules/lodash.isequal/index.js"(exports, module) {
    var LARGE_ARRAY_SIZE = 200;
    var HASH_UNDEFINED = "__lodash_hash_undefined__";
    var COMPARE_PARTIAL_FLAG = 1;
    var COMPARE_UNORDERED_FLAG = 2;
    var MAX_SAFE_INTEGER = 9007199254740991;
    var argsTag = "[object Arguments]";
    var arrayTag = "[object Array]";
    var asyncTag = "[object AsyncFunction]";
    var boolTag = "[object Boolean]";
    var dateTag = "[object Date]";
    var errorTag = "[object Error]";
    var funcTag = "[object Function]";
    var genTag = "[object GeneratorFunction]";
    var mapTag = "[object Map]";
    var numberTag = "[object Number]";
    var nullTag = "[object Null]";
    var objectTag = "[object Object]";
    var promiseTag = "[object Promise]";
    var proxyTag = "[object Proxy]";
    var regexpTag = "[object RegExp]";
    var setTag = "[object Set]";
    var stringTag = "[object String]";
    var symbolTag = "[object Symbol]";
    var undefinedTag = "[object Undefined]";
    var weakMapTag = "[object WeakMap]";
    var arrayBufferTag = "[object ArrayBuffer]";
    var dataViewTag = "[object DataView]";
    var float32Tag = "[object Float32Array]";
    var float64Tag = "[object Float64Array]";
    var int8Tag = "[object Int8Array]";
    var int16Tag = "[object Int16Array]";
    var int32Tag = "[object Int32Array]";
    var uint8Tag = "[object Uint8Array]";
    var uint8ClampedTag = "[object Uint8ClampedArray]";
    var uint16Tag = "[object Uint16Array]";
    var uint32Tag = "[object Uint32Array]";
    var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
    var reIsHostCtor = /^\[object .+?Constructor\]$/;
    var reIsUint = /^(?:0|[1-9]\d*)$/;
    var typedArrayTags = {};
    typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
    typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
    var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
    var freeSelf = typeof self == "object" && self && self.Object === Object && self;
    var root = freeGlobal || freeSelf || Function("return this")();
    var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
    var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
    var moduleExports = freeModule && freeModule.exports === freeExports;
    var freeProcess = moduleExports && freeGlobal.process;
    var nodeUtil = (function() {
      try {
        return freeProcess && freeProcess.binding && freeProcess.binding("util");
      } catch (e) {
      }
    })();
    var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
    function arrayFilter(array2, predicate) {
      var index = -1, length = array2 == null ? 0 : array2.length, resIndex = 0, result = [];
      while (++index < length) {
        var value = array2[index];
        if (predicate(value, index, array2)) {
          result[resIndex++] = value;
        }
      }
      return result;
    }
    function arrayPush(array2, values) {
      var index = -1, length = values.length, offset = array2.length;
      while (++index < length) {
        array2[offset + index] = values[index];
      }
      return array2;
    }
    function arraySome(array2, predicate) {
      var index = -1, length = array2 == null ? 0 : array2.length;
      while (++index < length) {
        if (predicate(array2[index], index, array2)) {
          return true;
        }
      }
      return false;
    }
    function baseTimes(n, iteratee) {
      var index = -1, result = Array(n);
      while (++index < n) {
        result[index] = iteratee(index);
      }
      return result;
    }
    function baseUnary(func) {
      return function(value) {
        return func(value);
      };
    }
    function cacheHas(cache, key) {
      return cache.has(key);
    }
    function getValue(object2, key) {
      return object2 == null ? void 0 : object2[key];
    }
    function mapToArray(map) {
      var index = -1, result = Array(map.size);
      map.forEach(function(value, key) {
        result[++index] = [key, value];
      });
      return result;
    }
    function overArg(func, transform) {
      return function(arg) {
        return func(transform(arg));
      };
    }
    function setToArray(set) {
      var index = -1, result = Array(set.size);
      set.forEach(function(value) {
        result[++index] = value;
      });
      return result;
    }
    var arrayProto = Array.prototype;
    var funcProto = Function.prototype;
    var objectProto = Object.prototype;
    var coreJsData = root["__core-js_shared__"];
    var funcToString = funcProto.toString;
    var hasOwnProperty2 = objectProto.hasOwnProperty;
    var maskSrcKey = (function() {
      var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
      return uid ? "Symbol(src)_1." + uid : "";
    })();
    var nativeObjectToString = objectProto.toString;
    var reIsNative = RegExp(
      "^" + funcToString.call(hasOwnProperty2).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
    );
    var Buffer2 = moduleExports ? root.Buffer : void 0;
    var Symbol2 = root.Symbol;
    var Uint8Array2 = root.Uint8Array;
    var propertyIsEnumerable = objectProto.propertyIsEnumerable;
    var splice = arrayProto.splice;
    var symToStringTag = Symbol2 ? Symbol2.toStringTag : void 0;
    var nativeGetSymbols = Object.getOwnPropertySymbols;
    var nativeIsBuffer = Buffer2 ? Buffer2.isBuffer : void 0;
    var nativeKeys = overArg(Object.keys, Object);
    var DataView2 = getNative(root, "DataView");
    var Map2 = getNative(root, "Map");
    var Promise2 = getNative(root, "Promise");
    var Set2 = getNative(root, "Set");
    var WeakMap2 = getNative(root, "WeakMap");
    var nativeCreate = getNative(Object, "create");
    var dataViewCtorString = toSource(DataView2);
    var mapCtorString = toSource(Map2);
    var promiseCtorString = toSource(Promise2);
    var setCtorString = toSource(Set2);
    var weakMapCtorString = toSource(WeakMap2);
    var symbolProto = Symbol2 ? Symbol2.prototype : void 0;
    var symbolValueOf = symbolProto ? symbolProto.valueOf : void 0;
    function Hash(entries) {
      var index = -1, length = entries == null ? 0 : entries.length;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function hashClear() {
      this.__data__ = nativeCreate ? nativeCreate(null) : {};
      this.size = 0;
    }
    function hashDelete(key) {
      var result = this.has(key) && delete this.__data__[key];
      this.size -= result ? 1 : 0;
      return result;
    }
    function hashGet(key) {
      var data = this.__data__;
      if (nativeCreate) {
        var result = data[key];
        return result === HASH_UNDEFINED ? void 0 : result;
      }
      return hasOwnProperty2.call(data, key) ? data[key] : void 0;
    }
    function hashHas(key) {
      var data = this.__data__;
      return nativeCreate ? data[key] !== void 0 : hasOwnProperty2.call(data, key);
    }
    function hashSet(key, value) {
      var data = this.__data__;
      this.size += this.has(key) ? 0 : 1;
      data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
      return this;
    }
    Hash.prototype.clear = hashClear;
    Hash.prototype["delete"] = hashDelete;
    Hash.prototype.get = hashGet;
    Hash.prototype.has = hashHas;
    Hash.prototype.set = hashSet;
    function ListCache(entries) {
      var index = -1, length = entries == null ? 0 : entries.length;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function listCacheClear() {
      this.__data__ = [];
      this.size = 0;
    }
    function listCacheDelete(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        return false;
      }
      var lastIndex = data.length - 1;
      if (index == lastIndex) {
        data.pop();
      } else {
        splice.call(data, index, 1);
      }
      --this.size;
      return true;
    }
    function listCacheGet(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      return index < 0 ? void 0 : data[index][1];
    }
    function listCacheHas(key) {
      return assocIndexOf(this.__data__, key) > -1;
    }
    function listCacheSet(key, value) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        ++this.size;
        data.push([key, value]);
      } else {
        data[index][1] = value;
      }
      return this;
    }
    ListCache.prototype.clear = listCacheClear;
    ListCache.prototype["delete"] = listCacheDelete;
    ListCache.prototype.get = listCacheGet;
    ListCache.prototype.has = listCacheHas;
    ListCache.prototype.set = listCacheSet;
    function MapCache(entries) {
      var index = -1, length = entries == null ? 0 : entries.length;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function mapCacheClear() {
      this.size = 0;
      this.__data__ = {
        "hash": new Hash(),
        "map": new (Map2 || ListCache)(),
        "string": new Hash()
      };
    }
    function mapCacheDelete(key) {
      var result = getMapData(this, key)["delete"](key);
      this.size -= result ? 1 : 0;
      return result;
    }
    function mapCacheGet(key) {
      return getMapData(this, key).get(key);
    }
    function mapCacheHas(key) {
      return getMapData(this, key).has(key);
    }
    function mapCacheSet(key, value) {
      var data = getMapData(this, key), size = data.size;
      data.set(key, value);
      this.size += data.size == size ? 0 : 1;
      return this;
    }
    MapCache.prototype.clear = mapCacheClear;
    MapCache.prototype["delete"] = mapCacheDelete;
    MapCache.prototype.get = mapCacheGet;
    MapCache.prototype.has = mapCacheHas;
    MapCache.prototype.set = mapCacheSet;
    function SetCache(values) {
      var index = -1, length = values == null ? 0 : values.length;
      this.__data__ = new MapCache();
      while (++index < length) {
        this.add(values[index]);
      }
    }
    function setCacheAdd(value) {
      this.__data__.set(value, HASH_UNDEFINED);
      return this;
    }
    function setCacheHas(value) {
      return this.__data__.has(value);
    }
    SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
    SetCache.prototype.has = setCacheHas;
    function Stack(entries) {
      var data = this.__data__ = new ListCache(entries);
      this.size = data.size;
    }
    function stackClear() {
      this.__data__ = new ListCache();
      this.size = 0;
    }
    function stackDelete(key) {
      var data = this.__data__, result = data["delete"](key);
      this.size = data.size;
      return result;
    }
    function stackGet(key) {
      return this.__data__.get(key);
    }
    function stackHas(key) {
      return this.__data__.has(key);
    }
    function stackSet(key, value) {
      var data = this.__data__;
      if (data instanceof ListCache) {
        var pairs = data.__data__;
        if (!Map2 || pairs.length < LARGE_ARRAY_SIZE - 1) {
          pairs.push([key, value]);
          this.size = ++data.size;
          return this;
        }
        data = this.__data__ = new MapCache(pairs);
      }
      data.set(key, value);
      this.size = data.size;
      return this;
    }
    Stack.prototype.clear = stackClear;
    Stack.prototype["delete"] = stackDelete;
    Stack.prototype.get = stackGet;
    Stack.prototype.has = stackHas;
    Stack.prototype.set = stackSet;
    function arrayLikeKeys(value, inherited) {
      var isArr = isArray(value), isArg = !isArr && isArguments(value), isBuff = !isArr && !isArg && isBuffer(value), isType = !isArr && !isArg && !isBuff && isTypedArray(value), skipIndexes = isArr || isArg || isBuff || isType, result = skipIndexes ? baseTimes(value.length, String) : [], length = result.length;
      for (var key in value) {
        if ((inherited || hasOwnProperty2.call(value, key)) && !(skipIndexes && // Safari 9 has enumerable `arguments.length` in strict mode.
        (key == "length" || // Node.js 0.10 has enumerable non-index properties on buffers.
        isBuff && (key == "offset" || key == "parent") || // PhantomJS 2 has enumerable non-index properties on typed arrays.
        isType && (key == "buffer" || key == "byteLength" || key == "byteOffset") || // Skip index properties.
        isIndex(key, length)))) {
          result.push(key);
        }
      }
      return result;
    }
    function assocIndexOf(array2, key) {
      var length = array2.length;
      while (length--) {
        if (eq(array2[length][0], key)) {
          return length;
        }
      }
      return -1;
    }
    function baseGetAllKeys(object2, keysFunc, symbolsFunc) {
      var result = keysFunc(object2);
      return isArray(object2) ? result : arrayPush(result, symbolsFunc(object2));
    }
    function baseGetTag(value) {
      if (value == null) {
        return value === void 0 ? undefinedTag : nullTag;
      }
      return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
    }
    function baseIsArguments(value) {
      return isObjectLike(value) && baseGetTag(value) == argsTag;
    }
    function baseIsEqual(value, other, bitmask, customizer, stack) {
      if (value === other) {
        return true;
      }
      if (value == null || other == null || !isObjectLike(value) && !isObjectLike(other)) {
        return value !== value && other !== other;
      }
      return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
    }
    function baseIsEqualDeep(object2, other, bitmask, customizer, equalFunc, stack) {
      var objIsArr = isArray(object2), othIsArr = isArray(other), objTag = objIsArr ? arrayTag : getTag(object2), othTag = othIsArr ? arrayTag : getTag(other);
      objTag = objTag == argsTag ? objectTag : objTag;
      othTag = othTag == argsTag ? objectTag : othTag;
      var objIsObj = objTag == objectTag, othIsObj = othTag == objectTag, isSameTag = objTag == othTag;
      if (isSameTag && isBuffer(object2)) {
        if (!isBuffer(other)) {
          return false;
        }
        objIsArr = true;
        objIsObj = false;
      }
      if (isSameTag && !objIsObj) {
        stack || (stack = new Stack());
        return objIsArr || isTypedArray(object2) ? equalArrays(object2, other, bitmask, customizer, equalFunc, stack) : equalByTag(object2, other, objTag, bitmask, customizer, equalFunc, stack);
      }
      if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
        var objIsWrapped = objIsObj && hasOwnProperty2.call(object2, "__wrapped__"), othIsWrapped = othIsObj && hasOwnProperty2.call(other, "__wrapped__");
        if (objIsWrapped || othIsWrapped) {
          var objUnwrapped = objIsWrapped ? object2.value() : object2, othUnwrapped = othIsWrapped ? other.value() : other;
          stack || (stack = new Stack());
          return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
        }
      }
      if (!isSameTag) {
        return false;
      }
      stack || (stack = new Stack());
      return equalObjects(object2, other, bitmask, customizer, equalFunc, stack);
    }
    function baseIsNative(value) {
      if (!isObject(value) || isMasked(value)) {
        return false;
      }
      var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
      return pattern.test(toSource(value));
    }
    function baseIsTypedArray(value) {
      return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
    }
    function baseKeys(object2) {
      if (!isPrototype(object2)) {
        return nativeKeys(object2);
      }
      var result = [];
      for (var key in Object(object2)) {
        if (hasOwnProperty2.call(object2, key) && key != "constructor") {
          result.push(key);
        }
      }
      return result;
    }
    function equalArrays(array2, other, bitmask, customizer, equalFunc, stack) {
      var isPartial = bitmask & COMPARE_PARTIAL_FLAG, arrLength = array2.length, othLength = other.length;
      if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
        return false;
      }
      var stacked = stack.get(array2);
      if (stacked && stack.get(other)) {
        return stacked == other;
      }
      var index = -1, result = true, seen = bitmask & COMPARE_UNORDERED_FLAG ? new SetCache() : void 0;
      stack.set(array2, other);
      stack.set(other, array2);
      while (++index < arrLength) {
        var arrValue = array2[index], othValue = other[index];
        if (customizer) {
          var compared = isPartial ? customizer(othValue, arrValue, index, other, array2, stack) : customizer(arrValue, othValue, index, array2, other, stack);
        }
        if (compared !== void 0) {
          if (compared) {
            continue;
          }
          result = false;
          break;
        }
        if (seen) {
          if (!arraySome(other, function(othValue2, othIndex) {
            if (!cacheHas(seen, othIndex) && (arrValue === othValue2 || equalFunc(arrValue, othValue2, bitmask, customizer, stack))) {
              return seen.push(othIndex);
            }
          })) {
            result = false;
            break;
          }
        } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
          result = false;
          break;
        }
      }
      stack["delete"](array2);
      stack["delete"](other);
      return result;
    }
    function equalByTag(object2, other, tag, bitmask, customizer, equalFunc, stack) {
      switch (tag) {
        case dataViewTag:
          if (object2.byteLength != other.byteLength || object2.byteOffset != other.byteOffset) {
            return false;
          }
          object2 = object2.buffer;
          other = other.buffer;
        case arrayBufferTag:
          if (object2.byteLength != other.byteLength || !equalFunc(new Uint8Array2(object2), new Uint8Array2(other))) {
            return false;
          }
          return true;
        case boolTag:
        case dateTag:
        case numberTag:
          return eq(+object2, +other);
        case errorTag:
          return object2.name == other.name && object2.message == other.message;
        case regexpTag:
        case stringTag:
          return object2 == other + "";
        case mapTag:
          var convert = mapToArray;
        case setTag:
          var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
          convert || (convert = setToArray);
          if (object2.size != other.size && !isPartial) {
            return false;
          }
          var stacked = stack.get(object2);
          if (stacked) {
            return stacked == other;
          }
          bitmask |= COMPARE_UNORDERED_FLAG;
          stack.set(object2, other);
          var result = equalArrays(convert(object2), convert(other), bitmask, customizer, equalFunc, stack);
          stack["delete"](object2);
          return result;
        case symbolTag:
          if (symbolValueOf) {
            return symbolValueOf.call(object2) == symbolValueOf.call(other);
          }
      }
      return false;
    }
    function equalObjects(object2, other, bitmask, customizer, equalFunc, stack) {
      var isPartial = bitmask & COMPARE_PARTIAL_FLAG, objProps = getAllKeys(object2), objLength = objProps.length, othProps = getAllKeys(other), othLength = othProps.length;
      if (objLength != othLength && !isPartial) {
        return false;
      }
      var index = objLength;
      while (index--) {
        var key = objProps[index];
        if (!(isPartial ? key in other : hasOwnProperty2.call(other, key))) {
          return false;
        }
      }
      var stacked = stack.get(object2);
      if (stacked && stack.get(other)) {
        return stacked == other;
      }
      var result = true;
      stack.set(object2, other);
      stack.set(other, object2);
      var skipCtor = isPartial;
      while (++index < objLength) {
        key = objProps[index];
        var objValue = object2[key], othValue = other[key];
        if (customizer) {
          var compared = isPartial ? customizer(othValue, objValue, key, other, object2, stack) : customizer(objValue, othValue, key, object2, other, stack);
        }
        if (!(compared === void 0 ? objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack) : compared)) {
          result = false;
          break;
        }
        skipCtor || (skipCtor = key == "constructor");
      }
      if (result && !skipCtor) {
        var objCtor = object2.constructor, othCtor = other.constructor;
        if (objCtor != othCtor && ("constructor" in object2 && "constructor" in other) && !(typeof objCtor == "function" && objCtor instanceof objCtor && typeof othCtor == "function" && othCtor instanceof othCtor)) {
          result = false;
        }
      }
      stack["delete"](object2);
      stack["delete"](other);
      return result;
    }
    function getAllKeys(object2) {
      return baseGetAllKeys(object2, keys, getSymbols);
    }
    function getMapData(map, key) {
      var data = map.__data__;
      return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
    }
    function getNative(object2, key) {
      var value = getValue(object2, key);
      return baseIsNative(value) ? value : void 0;
    }
    function getRawTag(value) {
      var isOwn = hasOwnProperty2.call(value, symToStringTag), tag = value[symToStringTag];
      try {
        value[symToStringTag] = void 0;
        var unmasked = true;
      } catch (e) {
      }
      var result = nativeObjectToString.call(value);
      if (unmasked) {
        if (isOwn) {
          value[symToStringTag] = tag;
        } else {
          delete value[symToStringTag];
        }
      }
      return result;
    }
    var getSymbols = !nativeGetSymbols ? stubArray : function(object2) {
      if (object2 == null) {
        return [];
      }
      object2 = Object(object2);
      return arrayFilter(nativeGetSymbols(object2), function(symbol) {
        return propertyIsEnumerable.call(object2, symbol);
      });
    };
    var getTag = baseGetTag;
    if (DataView2 && getTag(new DataView2(new ArrayBuffer(1))) != dataViewTag || Map2 && getTag(new Map2()) != mapTag || Promise2 && getTag(Promise2.resolve()) != promiseTag || Set2 && getTag(new Set2()) != setTag || WeakMap2 && getTag(new WeakMap2()) != weakMapTag) {
      getTag = function(value) {
        var result = baseGetTag(value), Ctor = result == objectTag ? value.constructor : void 0, ctorString = Ctor ? toSource(Ctor) : "";
        if (ctorString) {
          switch (ctorString) {
            case dataViewCtorString:
              return dataViewTag;
            case mapCtorString:
              return mapTag;
            case promiseCtorString:
              return promiseTag;
            case setCtorString:
              return setTag;
            case weakMapCtorString:
              return weakMapTag;
          }
        }
        return result;
      };
    }
    function isIndex(value, length) {
      length = length == null ? MAX_SAFE_INTEGER : length;
      return !!length && (typeof value == "number" || reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length);
    }
    function isKeyable(value) {
      var type = typeof value;
      return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
    }
    function isMasked(func) {
      return !!maskSrcKey && maskSrcKey in func;
    }
    function isPrototype(value) {
      var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto;
      return value === proto;
    }
    function objectToString(value) {
      return nativeObjectToString.call(value);
    }
    function toSource(func) {
      if (func != null) {
        try {
          return funcToString.call(func);
        } catch (e) {
        }
        try {
          return func + "";
        } catch (e) {
        }
      }
      return "";
    }
    function eq(value, other) {
      return value === other || value !== value && other !== other;
    }
    var isArguments = baseIsArguments(/* @__PURE__ */ (function() {
      return arguments;
    })()) ? baseIsArguments : function(value) {
      return isObjectLike(value) && hasOwnProperty2.call(value, "callee") && !propertyIsEnumerable.call(value, "callee");
    };
    var isArray = Array.isArray;
    function isArrayLike(value) {
      return value != null && isLength(value.length) && !isFunction(value);
    }
    var isBuffer = nativeIsBuffer || stubFalse;
    function isEqual(value, other) {
      return baseIsEqual(value, other);
    }
    function isFunction(value) {
      if (!isObject(value)) {
        return false;
      }
      var tag = baseGetTag(value);
      return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
    }
    function isLength(value) {
      return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
    }
    function isObject(value) {
      var type = typeof value;
      return value != null && (type == "object" || type == "function");
    }
    function isObjectLike(value) {
      return value != null && typeof value == "object";
    }
    var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
    function keys(object2) {
      return isArrayLike(object2) ? arrayLikeKeys(object2) : baseKeys(object2);
    }
    function stubArray() {
      return [];
    }
    function stubFalse() {
      return false;
    }
    module.exports = isEqual;
  }
});

// node_modules/lodash.isequalwith/index.js
var require_lodash2 = __commonJS({
  "node_modules/lodash.isequalwith/index.js"(exports, module) {
    var LARGE_ARRAY_SIZE = 200;
    var HASH_UNDEFINED = "__lodash_hash_undefined__";
    var UNORDERED_COMPARE_FLAG = 1;
    var PARTIAL_COMPARE_FLAG = 2;
    var MAX_SAFE_INTEGER = 9007199254740991;
    var argsTag = "[object Arguments]";
    var arrayTag = "[object Array]";
    var boolTag = "[object Boolean]";
    var dateTag = "[object Date]";
    var errorTag = "[object Error]";
    var funcTag = "[object Function]";
    var genTag = "[object GeneratorFunction]";
    var mapTag = "[object Map]";
    var numberTag = "[object Number]";
    var objectTag = "[object Object]";
    var promiseTag = "[object Promise]";
    var regexpTag = "[object RegExp]";
    var setTag = "[object Set]";
    var stringTag = "[object String]";
    var symbolTag = "[object Symbol]";
    var weakMapTag = "[object WeakMap]";
    var arrayBufferTag = "[object ArrayBuffer]";
    var dataViewTag = "[object DataView]";
    var float32Tag = "[object Float32Array]";
    var float64Tag = "[object Float64Array]";
    var int8Tag = "[object Int8Array]";
    var int16Tag = "[object Int16Array]";
    var int32Tag = "[object Int32Array]";
    var uint8Tag = "[object Uint8Array]";
    var uint8ClampedTag = "[object Uint8ClampedArray]";
    var uint16Tag = "[object Uint16Array]";
    var uint32Tag = "[object Uint32Array]";
    var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
    var reIsHostCtor = /^\[object .+?Constructor\]$/;
    var reIsUint = /^(?:0|[1-9]\d*)$/;
    var typedArrayTags = {};
    typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
    typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
    var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
    var freeSelf = typeof self == "object" && self && self.Object === Object && self;
    var root = freeGlobal || freeSelf || Function("return this")();
    var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
    var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
    var moduleExports = freeModule && freeModule.exports === freeExports;
    var freeProcess = moduleExports && freeGlobal.process;
    var nodeUtil = (function() {
      try {
        return freeProcess && freeProcess.binding("util");
      } catch (e) {
      }
    })();
    var nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
    function arraySome(array2, predicate) {
      var index = -1, length = array2 ? array2.length : 0;
      while (++index < length) {
        if (predicate(array2[index], index, array2)) {
          return true;
        }
      }
      return false;
    }
    function baseTimes(n, iteratee) {
      var index = -1, result = Array(n);
      while (++index < n) {
        result[index] = iteratee(index);
      }
      return result;
    }
    function baseUnary(func) {
      return function(value) {
        return func(value);
      };
    }
    function getValue(object2, key) {
      return object2 == null ? void 0 : object2[key];
    }
    function isHostObject(value) {
      var result = false;
      if (value != null && typeof value.toString != "function") {
        try {
          result = !!(value + "");
        } catch (e) {
        }
      }
      return result;
    }
    function mapToArray(map) {
      var index = -1, result = Array(map.size);
      map.forEach(function(value, key) {
        result[++index] = [key, value];
      });
      return result;
    }
    function overArg(func, transform) {
      return function(arg) {
        return func(transform(arg));
      };
    }
    function setToArray(set) {
      var index = -1, result = Array(set.size);
      set.forEach(function(value) {
        result[++index] = value;
      });
      return result;
    }
    var arrayProto = Array.prototype;
    var funcProto = Function.prototype;
    var objectProto = Object.prototype;
    var coreJsData = root["__core-js_shared__"];
    var maskSrcKey = (function() {
      var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
      return uid ? "Symbol(src)_1." + uid : "";
    })();
    var funcToString = funcProto.toString;
    var hasOwnProperty2 = objectProto.hasOwnProperty;
    var objectToString = objectProto.toString;
    var reIsNative = RegExp(
      "^" + funcToString.call(hasOwnProperty2).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
    );
    var Symbol2 = root.Symbol;
    var Uint8Array2 = root.Uint8Array;
    var propertyIsEnumerable = objectProto.propertyIsEnumerable;
    var splice = arrayProto.splice;
    var nativeKeys = overArg(Object.keys, Object);
    var DataView2 = getNative(root, "DataView");
    var Map2 = getNative(root, "Map");
    var Promise2 = getNative(root, "Promise");
    var Set2 = getNative(root, "Set");
    var WeakMap2 = getNative(root, "WeakMap");
    var nativeCreate = getNative(Object, "create");
    var dataViewCtorString = toSource(DataView2);
    var mapCtorString = toSource(Map2);
    var promiseCtorString = toSource(Promise2);
    var setCtorString = toSource(Set2);
    var weakMapCtorString = toSource(WeakMap2);
    var symbolProto = Symbol2 ? Symbol2.prototype : void 0;
    var symbolValueOf = symbolProto ? symbolProto.valueOf : void 0;
    function Hash(entries) {
      var index = -1, length = entries ? entries.length : 0;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function hashClear() {
      this.__data__ = nativeCreate ? nativeCreate(null) : {};
    }
    function hashDelete(key) {
      return this.has(key) && delete this.__data__[key];
    }
    function hashGet(key) {
      var data = this.__data__;
      if (nativeCreate) {
        var result = data[key];
        return result === HASH_UNDEFINED ? void 0 : result;
      }
      return hasOwnProperty2.call(data, key) ? data[key] : void 0;
    }
    function hashHas(key) {
      var data = this.__data__;
      return nativeCreate ? data[key] !== void 0 : hasOwnProperty2.call(data, key);
    }
    function hashSet(key, value) {
      var data = this.__data__;
      data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
      return this;
    }
    Hash.prototype.clear = hashClear;
    Hash.prototype["delete"] = hashDelete;
    Hash.prototype.get = hashGet;
    Hash.prototype.has = hashHas;
    Hash.prototype.set = hashSet;
    function ListCache(entries) {
      var index = -1, length = entries ? entries.length : 0;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function listCacheClear() {
      this.__data__ = [];
    }
    function listCacheDelete(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        return false;
      }
      var lastIndex = data.length - 1;
      if (index == lastIndex) {
        data.pop();
      } else {
        splice.call(data, index, 1);
      }
      return true;
    }
    function listCacheGet(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      return index < 0 ? void 0 : data[index][1];
    }
    function listCacheHas(key) {
      return assocIndexOf(this.__data__, key) > -1;
    }
    function listCacheSet(key, value) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        data.push([key, value]);
      } else {
        data[index][1] = value;
      }
      return this;
    }
    ListCache.prototype.clear = listCacheClear;
    ListCache.prototype["delete"] = listCacheDelete;
    ListCache.prototype.get = listCacheGet;
    ListCache.prototype.has = listCacheHas;
    ListCache.prototype.set = listCacheSet;
    function MapCache(entries) {
      var index = -1, length = entries ? entries.length : 0;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function mapCacheClear() {
      this.__data__ = {
        "hash": new Hash(),
        "map": new (Map2 || ListCache)(),
        "string": new Hash()
      };
    }
    function mapCacheDelete(key) {
      return getMapData(this, key)["delete"](key);
    }
    function mapCacheGet(key) {
      return getMapData(this, key).get(key);
    }
    function mapCacheHas(key) {
      return getMapData(this, key).has(key);
    }
    function mapCacheSet(key, value) {
      getMapData(this, key).set(key, value);
      return this;
    }
    MapCache.prototype.clear = mapCacheClear;
    MapCache.prototype["delete"] = mapCacheDelete;
    MapCache.prototype.get = mapCacheGet;
    MapCache.prototype.has = mapCacheHas;
    MapCache.prototype.set = mapCacheSet;
    function SetCache(values) {
      var index = -1, length = values ? values.length : 0;
      this.__data__ = new MapCache();
      while (++index < length) {
        this.add(values[index]);
      }
    }
    function setCacheAdd(value) {
      this.__data__.set(value, HASH_UNDEFINED);
      return this;
    }
    function setCacheHas(value) {
      return this.__data__.has(value);
    }
    SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
    SetCache.prototype.has = setCacheHas;
    function Stack(entries) {
      this.__data__ = new ListCache(entries);
    }
    function stackClear() {
      this.__data__ = new ListCache();
    }
    function stackDelete(key) {
      return this.__data__["delete"](key);
    }
    function stackGet(key) {
      return this.__data__.get(key);
    }
    function stackHas(key) {
      return this.__data__.has(key);
    }
    function stackSet(key, value) {
      var cache = this.__data__;
      if (cache instanceof ListCache) {
        var pairs = cache.__data__;
        if (!Map2 || pairs.length < LARGE_ARRAY_SIZE - 1) {
          pairs.push([key, value]);
          return this;
        }
        cache = this.__data__ = new MapCache(pairs);
      }
      cache.set(key, value);
      return this;
    }
    Stack.prototype.clear = stackClear;
    Stack.prototype["delete"] = stackDelete;
    Stack.prototype.get = stackGet;
    Stack.prototype.has = stackHas;
    Stack.prototype.set = stackSet;
    function arrayLikeKeys(value, inherited) {
      var result = isArray(value) || isArguments(value) ? baseTimes(value.length, String) : [];
      var length = result.length, skipIndexes = !!length;
      for (var key in value) {
        if ((inherited || hasOwnProperty2.call(value, key)) && !(skipIndexes && (key == "length" || isIndex(key, length)))) {
          result.push(key);
        }
      }
      return result;
    }
    function assocIndexOf(array2, key) {
      var length = array2.length;
      while (length--) {
        if (eq(array2[length][0], key)) {
          return length;
        }
      }
      return -1;
    }
    function baseGetTag(value) {
      return objectToString.call(value);
    }
    function baseIsEqual(value, other, customizer, bitmask, stack) {
      if (value === other) {
        return true;
      }
      if (value == null || other == null || !isObject(value) && !isObjectLike(other)) {
        return value !== value && other !== other;
      }
      return baseIsEqualDeep(value, other, baseIsEqual, customizer, bitmask, stack);
    }
    function baseIsEqualDeep(object2, other, equalFunc, customizer, bitmask, stack) {
      var objIsArr = isArray(object2), othIsArr = isArray(other), objTag = arrayTag, othTag = arrayTag;
      if (!objIsArr) {
        objTag = getTag(object2);
        objTag = objTag == argsTag ? objectTag : objTag;
      }
      if (!othIsArr) {
        othTag = getTag(other);
        othTag = othTag == argsTag ? objectTag : othTag;
      }
      var objIsObj = objTag == objectTag && !isHostObject(object2), othIsObj = othTag == objectTag && !isHostObject(other), isSameTag = objTag == othTag;
      if (isSameTag && !objIsObj) {
        stack || (stack = new Stack());
        return objIsArr || isTypedArray(object2) ? equalArrays(object2, other, equalFunc, customizer, bitmask, stack) : equalByTag(object2, other, objTag, equalFunc, customizer, bitmask, stack);
      }
      if (!(bitmask & PARTIAL_COMPARE_FLAG)) {
        var objIsWrapped = objIsObj && hasOwnProperty2.call(object2, "__wrapped__"), othIsWrapped = othIsObj && hasOwnProperty2.call(other, "__wrapped__");
        if (objIsWrapped || othIsWrapped) {
          var objUnwrapped = objIsWrapped ? object2.value() : object2, othUnwrapped = othIsWrapped ? other.value() : other;
          stack || (stack = new Stack());
          return equalFunc(objUnwrapped, othUnwrapped, customizer, bitmask, stack);
        }
      }
      if (!isSameTag) {
        return false;
      }
      stack || (stack = new Stack());
      return equalObjects(object2, other, equalFunc, customizer, bitmask, stack);
    }
    function baseIsNative(value) {
      if (!isObject(value) || isMasked(value)) {
        return false;
      }
      var pattern = isFunction(value) || isHostObject(value) ? reIsNative : reIsHostCtor;
      return pattern.test(toSource(value));
    }
    function baseIsTypedArray(value) {
      return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[objectToString.call(value)];
    }
    function baseKeys(object2) {
      if (!isPrototype(object2)) {
        return nativeKeys(object2);
      }
      var result = [];
      for (var key in Object(object2)) {
        if (hasOwnProperty2.call(object2, key) && key != "constructor") {
          result.push(key);
        }
      }
      return result;
    }
    function equalArrays(array2, other, equalFunc, customizer, bitmask, stack) {
      var isPartial = bitmask & PARTIAL_COMPARE_FLAG, arrLength = array2.length, othLength = other.length;
      if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
        return false;
      }
      var stacked = stack.get(array2);
      if (stacked && stack.get(other)) {
        return stacked == other;
      }
      var index = -1, result = true, seen = bitmask & UNORDERED_COMPARE_FLAG ? new SetCache() : void 0;
      stack.set(array2, other);
      stack.set(other, array2);
      while (++index < arrLength) {
        var arrValue = array2[index], othValue = other[index];
        if (customizer) {
          var compared = isPartial ? customizer(othValue, arrValue, index, other, array2, stack) : customizer(arrValue, othValue, index, array2, other, stack);
        }
        if (compared !== void 0) {
          if (compared) {
            continue;
          }
          result = false;
          break;
        }
        if (seen) {
          if (!arraySome(other, function(othValue2, othIndex) {
            if (!seen.has(othIndex) && (arrValue === othValue2 || equalFunc(arrValue, othValue2, customizer, bitmask, stack))) {
              return seen.add(othIndex);
            }
          })) {
            result = false;
            break;
          }
        } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, customizer, bitmask, stack))) {
          result = false;
          break;
        }
      }
      stack["delete"](array2);
      stack["delete"](other);
      return result;
    }
    function equalByTag(object2, other, tag, equalFunc, customizer, bitmask, stack) {
      switch (tag) {
        case dataViewTag:
          if (object2.byteLength != other.byteLength || object2.byteOffset != other.byteOffset) {
            return false;
          }
          object2 = object2.buffer;
          other = other.buffer;
        case arrayBufferTag:
          if (object2.byteLength != other.byteLength || !equalFunc(new Uint8Array2(object2), new Uint8Array2(other))) {
            return false;
          }
          return true;
        case boolTag:
        case dateTag:
        case numberTag:
          return eq(+object2, +other);
        case errorTag:
          return object2.name == other.name && object2.message == other.message;
        case regexpTag:
        case stringTag:
          return object2 == other + "";
        case mapTag:
          var convert = mapToArray;
        case setTag:
          var isPartial = bitmask & PARTIAL_COMPARE_FLAG;
          convert || (convert = setToArray);
          if (object2.size != other.size && !isPartial) {
            return false;
          }
          var stacked = stack.get(object2);
          if (stacked) {
            return stacked == other;
          }
          bitmask |= UNORDERED_COMPARE_FLAG;
          stack.set(object2, other);
          var result = equalArrays(convert(object2), convert(other), equalFunc, customizer, bitmask, stack);
          stack["delete"](object2);
          return result;
        case symbolTag:
          if (symbolValueOf) {
            return symbolValueOf.call(object2) == symbolValueOf.call(other);
          }
      }
      return false;
    }
    function equalObjects(object2, other, equalFunc, customizer, bitmask, stack) {
      var isPartial = bitmask & PARTIAL_COMPARE_FLAG, objProps = keys(object2), objLength = objProps.length, othProps = keys(other), othLength = othProps.length;
      if (objLength != othLength && !isPartial) {
        return false;
      }
      var index = objLength;
      while (index--) {
        var key = objProps[index];
        if (!(isPartial ? key in other : hasOwnProperty2.call(other, key))) {
          return false;
        }
      }
      var stacked = stack.get(object2);
      if (stacked && stack.get(other)) {
        return stacked == other;
      }
      var result = true;
      stack.set(object2, other);
      stack.set(other, object2);
      var skipCtor = isPartial;
      while (++index < objLength) {
        key = objProps[index];
        var objValue = object2[key], othValue = other[key];
        if (customizer) {
          var compared = isPartial ? customizer(othValue, objValue, key, other, object2, stack) : customizer(objValue, othValue, key, object2, other, stack);
        }
        if (!(compared === void 0 ? objValue === othValue || equalFunc(objValue, othValue, customizer, bitmask, stack) : compared)) {
          result = false;
          break;
        }
        skipCtor || (skipCtor = key == "constructor");
      }
      if (result && !skipCtor) {
        var objCtor = object2.constructor, othCtor = other.constructor;
        if (objCtor != othCtor && ("constructor" in object2 && "constructor" in other) && !(typeof objCtor == "function" && objCtor instanceof objCtor && typeof othCtor == "function" && othCtor instanceof othCtor)) {
          result = false;
        }
      }
      stack["delete"](object2);
      stack["delete"](other);
      return result;
    }
    function getMapData(map, key) {
      var data = map.__data__;
      return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
    }
    function getNative(object2, key) {
      var value = getValue(object2, key);
      return baseIsNative(value) ? value : void 0;
    }
    var getTag = baseGetTag;
    if (DataView2 && getTag(new DataView2(new ArrayBuffer(1))) != dataViewTag || Map2 && getTag(new Map2()) != mapTag || Promise2 && getTag(Promise2.resolve()) != promiseTag || Set2 && getTag(new Set2()) != setTag || WeakMap2 && getTag(new WeakMap2()) != weakMapTag) {
      getTag = function(value) {
        var result = objectToString.call(value), Ctor = result == objectTag ? value.constructor : void 0, ctorString = Ctor ? toSource(Ctor) : void 0;
        if (ctorString) {
          switch (ctorString) {
            case dataViewCtorString:
              return dataViewTag;
            case mapCtorString:
              return mapTag;
            case promiseCtorString:
              return promiseTag;
            case setCtorString:
              return setTag;
            case weakMapCtorString:
              return weakMapTag;
          }
        }
        return result;
      };
    }
    function isIndex(value, length) {
      length = length == null ? MAX_SAFE_INTEGER : length;
      return !!length && (typeof value == "number" || reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length);
    }
    function isKeyable(value) {
      var type = typeof value;
      return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
    }
    function isMasked(func) {
      return !!maskSrcKey && maskSrcKey in func;
    }
    function isPrototype(value) {
      var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto;
      return value === proto;
    }
    function toSource(func) {
      if (func != null) {
        try {
          return funcToString.call(func);
        } catch (e) {
        }
        try {
          return func + "";
        } catch (e) {
        }
      }
      return "";
    }
    function eq(value, other) {
      return value === other || value !== value && other !== other;
    }
    function isArguments(value) {
      return isArrayLikeObject(value) && hasOwnProperty2.call(value, "callee") && (!propertyIsEnumerable.call(value, "callee") || objectToString.call(value) == argsTag);
    }
    var isArray = Array.isArray;
    function isArrayLike(value) {
      return value != null && isLength(value.length) && !isFunction(value);
    }
    function isArrayLikeObject(value) {
      return isObjectLike(value) && isArrayLike(value);
    }
    function isEqualWith2(value, other, customizer) {
      customizer = typeof customizer == "function" ? customizer : void 0;
      var result = customizer ? customizer(value, other) : void 0;
      return result === void 0 ? baseIsEqual(value, other, customizer) : !!result;
    }
    function isFunction(value) {
      var tag = isObject(value) ? objectToString.call(value) : "";
      return tag == funcTag || tag == genTag;
    }
    function isLength(value) {
      return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
    }
    function isObject(value) {
      var type = typeof value;
      return !!value && (type == "object" || type == "function");
    }
    function isObjectLike(value) {
      return !!value && typeof value == "object";
    }
    var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
    function keys(object2) {
      return isArrayLike(object2) ? arrayLikeKeys(object2) : baseKeys(object2);
    }
    module.exports = isEqualWith2;
  }
});

// node_modules/lodash.throttle/index.js
var require_lodash3 = __commonJS({
  "node_modules/lodash.throttle/index.js"(exports, module) {
    var FUNC_ERROR_TEXT = "Expected a function";
    var NAN = 0 / 0;
    var symbolTag = "[object Symbol]";
    var reTrim = /^\s+|\s+$/g;
    var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
    var reIsBinary = /^0b[01]+$/i;
    var reIsOctal = /^0o[0-7]+$/i;
    var freeParseInt = parseInt;
    var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
    var freeSelf = typeof self == "object" && self && self.Object === Object && self;
    var root = freeGlobal || freeSelf || Function("return this")();
    var objectProto = Object.prototype;
    var objectToString = objectProto.toString;
    var nativeMax = Math.max;
    var nativeMin = Math.min;
    var now = function() {
      return root.Date.now();
    };
    function debounce2(func, wait, options) {
      var lastArgs, lastThis, maxWait, result, timerId, lastCallTime, lastInvokeTime = 0, leading = false, maxing = false, trailing = true;
      if (typeof func != "function") {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      wait = toNumber(wait) || 0;
      if (isObject(options)) {
        leading = !!options.leading;
        maxing = "maxWait" in options;
        maxWait = maxing ? nativeMax(toNumber(options.maxWait) || 0, wait) : maxWait;
        trailing = "trailing" in options ? !!options.trailing : trailing;
      }
      function invokeFunc(time) {
        var args = lastArgs, thisArg = lastThis;
        lastArgs = lastThis = void 0;
        lastInvokeTime = time;
        result = func.apply(thisArg, args);
        return result;
      }
      function leadingEdge(time) {
        lastInvokeTime = time;
        timerId = setTimeout(timerExpired, wait);
        return leading ? invokeFunc(time) : result;
      }
      function remainingWait(time) {
        var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime, result2 = wait - timeSinceLastCall;
        return maxing ? nativeMin(result2, maxWait - timeSinceLastInvoke) : result2;
      }
      function shouldInvoke(time) {
        var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime;
        return lastCallTime === void 0 || timeSinceLastCall >= wait || timeSinceLastCall < 0 || maxing && timeSinceLastInvoke >= maxWait;
      }
      function timerExpired() {
        var time = now();
        if (shouldInvoke(time)) {
          return trailingEdge(time);
        }
        timerId = setTimeout(timerExpired, remainingWait(time));
      }
      function trailingEdge(time) {
        timerId = void 0;
        if (trailing && lastArgs) {
          return invokeFunc(time);
        }
        lastArgs = lastThis = void 0;
        return result;
      }
      function cancel() {
        if (timerId !== void 0) {
          clearTimeout(timerId);
        }
        lastInvokeTime = 0;
        lastArgs = lastCallTime = lastThis = timerId = void 0;
      }
      function flush2() {
        return timerId === void 0 ? result : trailingEdge(now());
      }
      function debounced() {
        var time = now(), isInvoking = shouldInvoke(time);
        lastArgs = arguments;
        lastThis = this;
        lastCallTime = time;
        if (isInvoking) {
          if (timerId === void 0) {
            return leadingEdge(lastCallTime);
          }
          if (maxing) {
            timerId = setTimeout(timerExpired, wait);
            return invokeFunc(lastCallTime);
          }
        }
        if (timerId === void 0) {
          timerId = setTimeout(timerExpired, wait);
        }
        return result;
      }
      debounced.cancel = cancel;
      debounced.flush = flush2;
      return debounced;
    }
    function throttle(func, wait, options) {
      var leading = true, trailing = true;
      if (typeof func != "function") {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      if (isObject(options)) {
        leading = "leading" in options ? !!options.leading : leading;
        trailing = "trailing" in options ? !!options.trailing : trailing;
      }
      return debounce2(func, wait, {
        "leading": leading,
        "maxWait": wait,
        "trailing": trailing
      });
    }
    function isObject(value) {
      var type = typeof value;
      return !!value && (type == "object" || type == "function");
    }
    function isObjectLike(value) {
      return !!value && typeof value == "object";
    }
    function isSymbol(value) {
      return typeof value == "symbol" || isObjectLike(value) && objectToString.call(value) == symbolTag;
    }
    function toNumber(value) {
      if (typeof value == "number") {
        return value;
      }
      if (isSymbol(value)) {
        return NAN;
      }
      if (isObject(value)) {
        var other = typeof value.valueOf == "function" ? value.valueOf() : value;
        value = isObject(other) ? other + "" : other;
      }
      if (typeof value != "string") {
        return value === 0 ? value : +value;
      }
      value = value.replace(reTrim, "");
      var isBinary = reIsBinary.test(value);
      return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
    }
    module.exports = throttle;
  }
});

// node_modules/lodash.uniq/index.js
var require_lodash4 = __commonJS({
  "node_modules/lodash.uniq/index.js"(exports, module) {
    var LARGE_ARRAY_SIZE = 200;
    var HASH_UNDEFINED = "__lodash_hash_undefined__";
    var INFINITY = 1 / 0;
    var funcTag = "[object Function]";
    var genTag = "[object GeneratorFunction]";
    var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
    var reIsHostCtor = /^\[object .+?Constructor\]$/;
    var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
    var freeSelf = typeof self == "object" && self && self.Object === Object && self;
    var root = freeGlobal || freeSelf || Function("return this")();
    function arrayIncludes(array2, value) {
      var length = array2 ? array2.length : 0;
      return !!length && baseIndexOf(array2, value, 0) > -1;
    }
    function arrayIncludesWith(array2, value, comparator) {
      var index = -1, length = array2 ? array2.length : 0;
      while (++index < length) {
        if (comparator(value, array2[index])) {
          return true;
        }
      }
      return false;
    }
    function baseFindIndex(array2, predicate, fromIndex, fromRight) {
      var length = array2.length, index = fromIndex + (fromRight ? 1 : -1);
      while (fromRight ? index-- : ++index < length) {
        if (predicate(array2[index], index, array2)) {
          return index;
        }
      }
      return -1;
    }
    function baseIndexOf(array2, value, fromIndex) {
      if (value !== value) {
        return baseFindIndex(array2, baseIsNaN, fromIndex);
      }
      var index = fromIndex - 1, length = array2.length;
      while (++index < length) {
        if (array2[index] === value) {
          return index;
        }
      }
      return -1;
    }
    function baseIsNaN(value) {
      return value !== value;
    }
    function cacheHas(cache, key) {
      return cache.has(key);
    }
    function getValue(object2, key) {
      return object2 == null ? void 0 : object2[key];
    }
    function isHostObject(value) {
      var result = false;
      if (value != null && typeof value.toString != "function") {
        try {
          result = !!(value + "");
        } catch (e) {
        }
      }
      return result;
    }
    function setToArray(set) {
      var index = -1, result = Array(set.size);
      set.forEach(function(value) {
        result[++index] = value;
      });
      return result;
    }
    var arrayProto = Array.prototype;
    var funcProto = Function.prototype;
    var objectProto = Object.prototype;
    var coreJsData = root["__core-js_shared__"];
    var maskSrcKey = (function() {
      var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
      return uid ? "Symbol(src)_1." + uid : "";
    })();
    var funcToString = funcProto.toString;
    var hasOwnProperty2 = objectProto.hasOwnProperty;
    var objectToString = objectProto.toString;
    var reIsNative = RegExp(
      "^" + funcToString.call(hasOwnProperty2).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
    );
    var splice = arrayProto.splice;
    var Map2 = getNative(root, "Map");
    var Set2 = getNative(root, "Set");
    var nativeCreate = getNative(Object, "create");
    function Hash(entries) {
      var index = -1, length = entries ? entries.length : 0;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function hashClear() {
      this.__data__ = nativeCreate ? nativeCreate(null) : {};
    }
    function hashDelete(key) {
      return this.has(key) && delete this.__data__[key];
    }
    function hashGet(key) {
      var data = this.__data__;
      if (nativeCreate) {
        var result = data[key];
        return result === HASH_UNDEFINED ? void 0 : result;
      }
      return hasOwnProperty2.call(data, key) ? data[key] : void 0;
    }
    function hashHas(key) {
      var data = this.__data__;
      return nativeCreate ? data[key] !== void 0 : hasOwnProperty2.call(data, key);
    }
    function hashSet(key, value) {
      var data = this.__data__;
      data[key] = nativeCreate && value === void 0 ? HASH_UNDEFINED : value;
      return this;
    }
    Hash.prototype.clear = hashClear;
    Hash.prototype["delete"] = hashDelete;
    Hash.prototype.get = hashGet;
    Hash.prototype.has = hashHas;
    Hash.prototype.set = hashSet;
    function ListCache(entries) {
      var index = -1, length = entries ? entries.length : 0;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function listCacheClear() {
      this.__data__ = [];
    }
    function listCacheDelete(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        return false;
      }
      var lastIndex = data.length - 1;
      if (index == lastIndex) {
        data.pop();
      } else {
        splice.call(data, index, 1);
      }
      return true;
    }
    function listCacheGet(key) {
      var data = this.__data__, index = assocIndexOf(data, key);
      return index < 0 ? void 0 : data[index][1];
    }
    function listCacheHas(key) {
      return assocIndexOf(this.__data__, key) > -1;
    }
    function listCacheSet(key, value) {
      var data = this.__data__, index = assocIndexOf(data, key);
      if (index < 0) {
        data.push([key, value]);
      } else {
        data[index][1] = value;
      }
      return this;
    }
    ListCache.prototype.clear = listCacheClear;
    ListCache.prototype["delete"] = listCacheDelete;
    ListCache.prototype.get = listCacheGet;
    ListCache.prototype.has = listCacheHas;
    ListCache.prototype.set = listCacheSet;
    function MapCache(entries) {
      var index = -1, length = entries ? entries.length : 0;
      this.clear();
      while (++index < length) {
        var entry2 = entries[index];
        this.set(entry2[0], entry2[1]);
      }
    }
    function mapCacheClear() {
      this.__data__ = {
        "hash": new Hash(),
        "map": new (Map2 || ListCache)(),
        "string": new Hash()
      };
    }
    function mapCacheDelete(key) {
      return getMapData(this, key)["delete"](key);
    }
    function mapCacheGet(key) {
      return getMapData(this, key).get(key);
    }
    function mapCacheHas(key) {
      return getMapData(this, key).has(key);
    }
    function mapCacheSet(key, value) {
      getMapData(this, key).set(key, value);
      return this;
    }
    MapCache.prototype.clear = mapCacheClear;
    MapCache.prototype["delete"] = mapCacheDelete;
    MapCache.prototype.get = mapCacheGet;
    MapCache.prototype.has = mapCacheHas;
    MapCache.prototype.set = mapCacheSet;
    function SetCache(values) {
      var index = -1, length = values ? values.length : 0;
      this.__data__ = new MapCache();
      while (++index < length) {
        this.add(values[index]);
      }
    }
    function setCacheAdd(value) {
      this.__data__.set(value, HASH_UNDEFINED);
      return this;
    }
    function setCacheHas(value) {
      return this.__data__.has(value);
    }
    SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
    SetCache.prototype.has = setCacheHas;
    function assocIndexOf(array2, key) {
      var length = array2.length;
      while (length--) {
        if (eq(array2[length][0], key)) {
          return length;
        }
      }
      return -1;
    }
    function baseIsNative(value) {
      if (!isObject(value) || isMasked(value)) {
        return false;
      }
      var pattern = isFunction(value) || isHostObject(value) ? reIsNative : reIsHostCtor;
      return pattern.test(toSource(value));
    }
    function baseUniq(array2, iteratee, comparator) {
      var index = -1, includes = arrayIncludes, length = array2.length, isCommon = true, result = [], seen = result;
      if (comparator) {
        isCommon = false;
        includes = arrayIncludesWith;
      } else if (length >= LARGE_ARRAY_SIZE) {
        var set = iteratee ? null : createSet(array2);
        if (set) {
          return setToArray(set);
        }
        isCommon = false;
        includes = cacheHas;
        seen = new SetCache();
      } else {
        seen = iteratee ? [] : result;
      }
      outer:
        while (++index < length) {
          var value = array2[index], computed2 = iteratee ? iteratee(value) : value;
          value = comparator || value !== 0 ? value : 0;
          if (isCommon && computed2 === computed2) {
            var seenIndex = seen.length;
            while (seenIndex--) {
              if (seen[seenIndex] === computed2) {
                continue outer;
              }
            }
            if (iteratee) {
              seen.push(computed2);
            }
            result.push(value);
          } else if (!includes(seen, computed2, comparator)) {
            if (seen !== result) {
              seen.push(computed2);
            }
            result.push(value);
          }
        }
      return result;
    }
    var createSet = !(Set2 && 1 / setToArray(new Set2([, -0]))[1] == INFINITY) ? noop2 : function(values) {
      return new Set2(values);
    };
    function getMapData(map, key) {
      var data = map.__data__;
      return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
    }
    function getNative(object2, key) {
      var value = getValue(object2, key);
      return baseIsNative(value) ? value : void 0;
    }
    function isKeyable(value) {
      var type = typeof value;
      return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
    }
    function isMasked(func) {
      return !!maskSrcKey && maskSrcKey in func;
    }
    function toSource(func) {
      if (func != null) {
        try {
          return funcToString.call(func);
        } catch (e) {
        }
        try {
          return func + "";
        } catch (e) {
        }
      }
      return "";
    }
    function uniq(array2) {
      return array2 && array2.length ? baseUniq(array2) : [];
    }
    function eq(value, other) {
      return value === other || value !== value && other !== other;
    }
    function isFunction(value) {
      var tag = isObject(value) ? objectToString.call(value) : "";
      return tag == funcTag || tag == genTag;
    }
    function isObject(value) {
      var type = typeof value;
      return !!value && (type == "object" || type == "function");
    }
    function noop2() {
    }
    module.exports = uniq;
  }
});

// node_modules/@tldraw/utils/dist-esm/lib/version.mjs
var TLDRAW_LIBRARY_VERSION_KEY = "__TLDRAW_LIBRARY_VERSIONS__";
function getLibraryVersions() {
  if (globalThis[TLDRAW_LIBRARY_VERSION_KEY]) {
    return globalThis[TLDRAW_LIBRARY_VERSION_KEY];
  }
  const info = {
    versions: [],
    didWarn: false,
    scheduledNotice: null
  };
  Object.defineProperty(globalThis, TLDRAW_LIBRARY_VERSION_KEY, {
    value: info,
    writable: false,
    configurable: false,
    enumerable: false
  });
  return info;
}
function registerTldrawLibraryVersion(name, version, modules) {
  if (!name || !version || !modules) {
    if (true) {
      throw new Error("Missing name/version/module system in built version of tldraw library");
    }
    return;
  }
  const info = getLibraryVersions();
  info.versions.push({ name, version, modules });
  if (!info.scheduledNotice) {
    try {
      info.scheduledNotice = setTimeout(() => {
        info.scheduledNotice = null;
        checkLibraryVersions(info);
      }, 100);
    } catch {
      checkLibraryVersions(info);
    }
  }
}
function checkLibraryVersions(info) {
  if (!info.versions.length) return;
  if (info.didWarn) return;
  const sorted = info.versions.sort((a, b) => compareVersions(a.version, b.version));
  const latestVersion = sorted[sorted.length - 1].version;
  const matchingVersions = /* @__PURE__ */ new Set();
  const nonMatchingVersions = /* @__PURE__ */ new Map();
  for (const lib of sorted) {
    if (nonMatchingVersions.has(lib.name)) {
      matchingVersions.delete(lib.name);
      entry(nonMatchingVersions, lib.name, /* @__PURE__ */ new Set()).add(lib.version);
      continue;
    }
    if (lib.version === latestVersion) {
      matchingVersions.add(lib.name);
    } else {
      matchingVersions.delete(lib.name);
      entry(nonMatchingVersions, lib.name, /* @__PURE__ */ new Set()).add(lib.version);
    }
  }
  if (nonMatchingVersions.size > 0) {
    const message = [
      `${format("[tldraw]", ["bold", "bgRed", "textWhite"])} ${format("You have multiple versions of tldraw libraries installed. This can lead to bugs and unexpected behavior.", ["textRed", "bold"])}`,
      "",
      `The latest version you have installed is ${format(`v${latestVersion}`, ["bold", "textBlue"])}. The following libraries are on the latest version:`,
      ...Array.from(matchingVersions, (name) => `  • ✅ ${format(name, ["bold"])}`),
      "",
      `The following libraries are not on the latest version, or have multiple versions installed:`,
      ...Array.from(nonMatchingVersions, ([name, versions]) => {
        const sortedVersions = Array.from(versions).sort(compareVersions).map((v) => format(`v${v}`, v === latestVersion ? ["textGreen"] : ["textRed"]));
        return `  • ❌ ${format(name, ["bold"])} (${sortedVersions.join(", ")})`;
      })
    ];
    console.log(message.join("\n"));
    info.didWarn = true;
    return;
  }
  const potentialDuplicates = /* @__PURE__ */ new Map();
  for (const lib of sorted) {
    entry(potentialDuplicates, lib.name, { version: lib.version, modules: [] }).modules.push(
      lib.modules
    );
  }
  const duplicates = /* @__PURE__ */ new Map();
  for (const [name, lib] of potentialDuplicates) {
    if (lib.modules.length > 1) duplicates.set(name, lib);
  }
  if (duplicates.size > 0) {
    const message = [
      `${format("[tldraw]", ["bold", "bgRed", "textWhite"])} ${format("You have multiple instances of some tldraw libraries active. This can lead to bugs and unexpected behavior. ", ["textRed", "bold"])}`,
      "",
      "This usually means that your bundler is misconfigured, and is importing the same library multiple times - usually once as an ES Module, and once as a CommonJS module.",
      "",
      "The following libraries have been imported multiple times:",
      ...Array.from(duplicates, ([name, lib]) => {
        const modules = lib.modules.map((m, i) => m === "esm" ? `      ${i + 1}. ES Modules` : `      ${i + 1}. CommonJS`).join("\n");
        return `  • ❌ ${format(name, ["bold"])} v${lib.version}: 
${modules}`;
      }),
      "",
      "You should configure your bundler to only import one version of each library."
    ];
    console.log(message.join("\n"));
    info.didWarn = true;
    return;
  }
}
function compareVersions(a, b) {
  const aMatch = a.match(/^(\d+)\.(\d+)\.(\d+)(?:-(\w+))?$/);
  const bMatch = b.match(/^(\d+)\.(\d+)\.(\d+)(?:-(\w+))?$/);
  if (!aMatch || !bMatch) return a.localeCompare(b);
  if (aMatch[1] !== bMatch[1]) return Number(aMatch[1]) - Number(bMatch[1]);
  if (aMatch[2] !== bMatch[2]) return Number(aMatch[2]) - Number(bMatch[2]);
  if (aMatch[3] !== bMatch[3]) return Number(aMatch[3]) - Number(bMatch[3]);
  if (aMatch[4] && bMatch[4]) return aMatch[4].localeCompare(bMatch[4]);
  if (aMatch[4]) return 1;
  if (bMatch[4]) return -1;
  return 0;
}
var formats = {
  bold: "1",
  textBlue: "94",
  textRed: "31",
  textGreen: "32",
  bgRed: "41",
  textWhite: "97"
};
function format(value, formatters = []) {
  return `\x1B[${formatters.map((f) => formats[f]).join(";")}m${value}\x1B[m`;
}
function entry(map, key, defaultValue) {
  if (map.has(key)) {
    return map.get(key);
  }
  map.set(key, defaultValue);
  return defaultValue;
}

// node_modules/@tldraw/utils/dist-esm/index.mjs
var import_lodash2 = __toESM(require_lodash(), 1);
var import_lodash3 = __toESM(require_lodash2(), 1);
var import_lodash4 = __toESM(require_lodash3(), 1);
var import_lodash5 = __toESM(require_lodash4(), 1);

// node_modules/@tldraw/utils/dist-esm/lib/array.mjs
function rotateArray(arr, offset) {
  return arr.map((_, i) => arr[(i + offset) % arr.length]);
}
function dedupe(input, equals2) {
  const result = [];
  mainLoop: for (const item of input) {
    for (const existing of result) {
      if (equals2 ? equals2(item, existing) : item === existing) {
        continue mainLoop;
      }
    }
    result.push(item);
  }
  return result;
}
function compact(arr) {
  return arr.filter((i) => i !== void 0 && i !== null);
}
function last(arr) {
  return arr[arr.length - 1];
}
function minBy(arr, fn) {
  let min;
  let minVal = Infinity;
  for (const item of arr) {
    const val = fn(item);
    if (val < minVal) {
      min = item;
      minVal = val;
    }
  }
  return min;
}
function maxBy(arr, fn) {
  let max;
  let maxVal = -Infinity;
  for (const item of arr) {
    const val = fn(item);
    if (val > maxVal) {
      max = item;
      maxVal = val;
    }
  }
  return max;
}
function partition(arr, predicate) {
  const satisfies = [];
  const doesNotSatisfy = [];
  for (const item of arr) {
    if (predicate(item)) {
      satisfies.push(item);
    } else {
      doesNotSatisfy.push(item);
    }
  }
  return [satisfies, doesNotSatisfy];
}
function areArraysShallowEqual(arr1, arr2) {
  if (arr1 === arr2) return true;
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (!Object.is(arr1[i], arr2[i])) {
      return false;
    }
  }
  return true;
}
function mergeArraysAndReplaceDefaults(key, customEntries, defaults) {
  const overrideTypes = new Set(customEntries.map((entry2) => entry2[key]));
  const result = [];
  for (const defaultEntry of defaults) {
    if (overrideTypes.has(defaultEntry[key])) continue;
    result.push(defaultEntry);
  }
  for (const customEntry of customEntries) {
    result.push(customEntry);
  }
  return result;
}

// node_modules/@tldraw/utils/dist-esm/lib/function.mjs
function omitFromStackTrace(fn) {
  const wrappedFn = (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof Error && Error.captureStackTrace) {
        Error.captureStackTrace(error, wrappedFn);
      }
      throw error;
    }
  };
  return wrappedFn;
}
var noop = () => {
};

// node_modules/@tldraw/utils/dist-esm/lib/control.mjs
var Result = {
  ok(value) {
    return { ok: true, value };
  },
  err(error) {
    return { ok: false, error };
  }
};
function exhaustiveSwitchError(value, property) {
  const debugValue = property && value && typeof value === "object" && property in value ? value[property] : value;
  throw new Error(`Unknown switch case ${debugValue}`);
}
var assert = omitFromStackTrace(
  (value, message) => {
    if (!value) {
      throw new Error(message || "Assertion Error");
    }
  }
);
var assertExists = omitFromStackTrace((value, message) => {
  if (value == null) {
    throw new Error(message ?? "value must be defined");
  }
  return value;
});
function promiseWithResolve() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return Object.assign(promise, {
    resolve,
    reject
  });
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// node_modules/@tldraw/utils/dist-esm/lib/bind.mjs
function bind(...args) {
  if (args.length === 2) {
    const [originalMethod, context] = args;
    context.addInitializer(function initializeMethod() {
      assert(Reflect.isExtensible(this), "Cannot bind to a non-extensible class.");
      const value = originalMethod.bind(this);
      const ok = Reflect.defineProperty(this, context.name, {
        value,
        writable: true,
        configurable: true
      });
      assert(ok, "Cannot bind a non-configurable class method.");
    });
  } else {
    const [_target, propertyKey, descriptor] = args;
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new TypeError(
        `Only methods can be decorated with @bind. <${propertyKey}> is not a method!`
      );
    }
    return {
      configurable: true,
      get() {
        const bound = descriptor.value.bind(this);
        Object.defineProperty(this, propertyKey, {
          value: bound,
          configurable: true,
          writable: true
        });
        return bound;
      }
    };
  }
}

// node_modules/@tldraw/utils/dist-esm/lib/cache.mjs
var WeakCache = class {
  /** The map of items to their cached values. */
  items = /* @__PURE__ */ new WeakMap();
  /**
   * Get the cached value for a given record. If the record is not present in the map, the callback
   * will be used to create the value (with the result being stored in the cache for next time).
   *
   * @param item - The item to get.
   * @param cb - The callback to use to create the value when a cached value is not found.
   */
  get(item, cb) {
    if (!this.items.has(item)) {
      this.items.set(item, cb(item));
    }
    return this.items.get(item);
  }
};

// node_modules/@tldraw/utils/dist-esm/lib/debounce.mjs
function debounce(callback, wait) {
  let state = void 0;
  const fn = (...args) => {
    if (!state) {
      state = {};
      state.promise = new Promise((resolve, reject) => {
        state.resolve = resolve;
        state.reject = reject;
      });
    }
    clearTimeout(state.timeout);
    state.latestArgs = args;
    state.timeout = setTimeout(() => {
      const s = state;
      state = void 0;
      try {
        s.resolve(callback(...s.latestArgs));
      } catch (e) {
        s.reject(e);
      }
    }, wait);
    return state.promise;
  };
  fn.cancel = () => {
    if (!state) return;
    clearTimeout(state.timeout);
  };
  return fn;
}

// node_modules/@tldraw/utils/dist-esm/lib/error.mjs
var annotationsByError = /* @__PURE__ */ new WeakMap();
function annotateError(error, annotations) {
  if (typeof error !== "object" || error === null) return;
  let currentAnnotations = annotationsByError.get(error);
  if (!currentAnnotations) {
    currentAnnotations = { tags: {}, extras: {} };
    annotationsByError.set(error, currentAnnotations);
  }
  if (annotations.tags) {
    currentAnnotations.tags = {
      ...currentAnnotations.tags,
      ...annotations.tags
    };
  }
  if (annotations.extras) {
    currentAnnotations.extras = {
      ...currentAnnotations.extras,
      ...annotations.extras
    };
  }
}
function getErrorAnnotations(error) {
  return annotationsByError.get(error) ?? { tags: {}, extras: {} };
}

// node_modules/@tldraw/utils/dist-esm/lib/ExecutionQueue.mjs
var ExecutionQueue = class {
  constructor(timeout) {
    this.timeout = timeout;
  }
  queue = [];
  running = false;
  isEmpty() {
    return this.queue.length === 0 && !this.running;
  }
  async run() {
    if (this.running) return;
    try {
      this.running = true;
      while (this.queue.length) {
        const task = this.queue.shift();
        await task();
        if (this.timeout) {
          await sleep(this.timeout);
        }
      }
    } finally {
      this.running = false;
    }
  }
  async push(task) {
    return new Promise((resolve, reject) => {
      this.queue.push(() => Promise.resolve(task()).then(resolve).catch(reject));
      this.run();
    });
  }
  close() {
    this.queue = [];
  }
};

// node_modules/@tldraw/utils/dist-esm/lib/network.mjs
async function fetch(input, init) {
  return window.fetch(input, {
    // We want to make sure that the referrer is not sent to other domains.
    referrerPolicy: "strict-origin-when-cross-origin",
    ...init
  });
}
var Image = (width, height) => {
  const img = new window.Image(width, height);
  img.referrerPolicy = "strict-origin-when-cross-origin";
  return img;
};

// node_modules/@tldraw/utils/dist-esm/lib/file.mjs
var FileHelpers = class _FileHelpers {
  /**
   * @deprecated Use `urlToArrayBuffer` instead.
   */
  static async dataUrlToArrayBuffer(dataURL) {
    return fetch(dataURL).then(function(result) {
      return result.arrayBuffer();
    });
  }
  /**
   * @param url - The url of the file.
   */
  static async urlToArrayBuffer(url) {
    const response = await fetch(url);
    return await response.arrayBuffer();
  }
  static async urlToBlob(url) {
    const response = await fetch(url);
    return await response.blob();
  }
  static async urlToDataUrl(url) {
    if (url.startsWith("data:")) return url;
    const blob = await _FileHelpers.urlToBlob(url);
    return await _FileHelpers.blobToDataUrl(blob);
  }
  /**
   * Convert a file to a base64 encoded data url.
   *
   * @example
   *
   * ```ts
   * const A = FileHelpers.toDataUrl(myImageFile)
   * ```
   *
   * @param file - The file as a blob.
   */
  static async blobToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      if (file) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.onabort = (error) => reject(error);
        reader.readAsDataURL(file);
      }
    });
  }
  /**
   * Convert a file to a unicode text string.
   *
   * @example
   *
   * ```ts
   * const A = FileHelpers.fileToDataUrl(myTextFile)
   * ```
   *
   * @param file - The file as a blob.
   */
  static async blobToText(file) {
    return await new Promise((resolve, reject) => {
      if (file) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        reader.onabort = (error) => reject(error);
        reader.readAsText(file);
      }
    });
  }
  static rewriteMimeType(blob, newMimeType) {
    if (blob.type === newMimeType) return blob;
    if (blob instanceof File) {
      return new File([blob], blob.name, { type: newMimeType });
    }
    return new Blob([blob], { type: newMimeType });
  }
};

// node_modules/@tldraw/utils/dist-esm/lib/hash.mjs
function getHashForString(string2) {
  let hash2 = 0;
  for (let i = 0; i < string2.length; i++) {
    hash2 = (hash2 << 5) - hash2 + string2.charCodeAt(i);
    hash2 |= 0;
  }
  return hash2 + "";
}
function getHashForObject(obj) {
  return getHashForString(JSON.stringify(obj));
}
function getHashForBuffer(buffer) {
  const view = new DataView(buffer);
  let hash2 = 0;
  for (let i = 0; i < view.byteLength; i++) {
    hash2 = (hash2 << 5) - hash2 + view.getUint8(i);
    hash2 |= 0;
  }
  return hash2 + "";
}
function lns(str) {
  const result = str.split("");
  result.push(...result.splice(0, Math.round(result.length / 5)));
  result.push(...result.splice(0, Math.round(result.length / 4)));
  result.push(...result.splice(0, Math.round(result.length / 3)));
  result.push(...result.splice(0, Math.round(result.length / 2)));
  return result.reverse().map((n) => +n ? +n < 5 ? 5 + +n : +n > 5 ? +n - 5 : n : n).join("");
}

// node_modules/@tldraw/utils/dist-esm/lib/id.mjs
var crypto = globalThis.crypto;
var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
var POOL_SIZE_MULTIPLIER = 128;
var pool;
var poolOffset;
function fillPool(bytes) {
  if (!pool || pool.length < bytes) {
    pool = new Uint8Array(bytes * POOL_SIZE_MULTIPLIER);
    crypto.getRandomValues(pool);
    poolOffset = 0;
  } else if (poolOffset + bytes > pool.length) {
    crypto.getRandomValues(pool);
    poolOffset = 0;
  }
  poolOffset += bytes;
}
function nanoid(size = 21) {
  fillPool(size -= 0);
  let id = "";
  for (let i = poolOffset - size; i < poolOffset; i++) {
    id += urlAlphabet[pool[i] & 63];
  }
  return id;
}
var impl = nanoid;
function mockUniqueId(fn) {
  impl = fn;
}
function restoreUniqueId() {
  impl = nanoid;
}
function uniqueId(size) {
  return impl(size);
}

// node_modules/@tldraw/utils/dist-esm/lib/iterable.mjs
function getFirstFromIterable(set) {
  return set.values().next().value;
}

// node_modules/@tldraw/utils/dist-esm/lib/media/apng.mjs
function isApngAnimated(buffer) {
  const view = new Uint8Array(buffer);
  if (!view || !(typeof Buffer !== "undefined" && Buffer.isBuffer(view) || view instanceof Uint8Array) || view.length < 16) {
    return false;
  }
  const isPNG = view[0] === 137 && view[1] === 80 && view[2] === 78 && view[3] === 71 && view[4] === 13 && view[5] === 10 && view[6] === 26 && view[7] === 10;
  if (!isPNG) {
    return false;
  }
  function indexOfSubstring(haystack, needle, fromIndex, upToIndex, chunksize = 1024) {
    if (!needle) {
      return -1;
    }
    needle = new RegExp(needle, "g");
    const needle_length = needle.source.length;
    const decoder = new TextDecoder();
    const full_haystack_length = haystack.length;
    if (typeof upToIndex === "undefined") {
      upToIndex = full_haystack_length;
    }
    if (fromIndex >= full_haystack_length || upToIndex <= 0 || fromIndex >= upToIndex) {
      return -1;
    }
    haystack = haystack.subarray(fromIndex, upToIndex);
    let position = -1;
    let current_index = 0;
    let full_length = 0;
    let needle_buffer = "";
    outer: while (current_index < haystack.length) {
      const next_index = current_index + chunksize;
      const chunk = haystack.subarray(current_index, next_index);
      const decoded = decoder.decode(chunk, { stream: true });
      const text = needle_buffer + decoded;
      let match;
      let last_index = -1;
      while ((match = needle.exec(text)) !== null) {
        last_index = match.index - needle_buffer.length;
        position = full_length + last_index;
        break outer;
      }
      current_index = next_index;
      full_length += decoded.length;
      const needle_index = last_index > -1 ? last_index + needle_length : decoded.length - needle_length;
      needle_buffer = decoded.slice(needle_index);
    }
    if (position >= 0) {
      position += fromIndex >= 0 ? fromIndex : full_haystack_length + fromIndex;
    }
    return position;
  }
  const idatIdx = indexOfSubstring(view, "IDAT", 12);
  if (idatIdx >= 12) {
    const actlIdx = indexOfSubstring(view, "acTL", 8, idatIdx);
    return actlIdx >= 8;
  }
  return false;
}

// node_modules/@tldraw/utils/dist-esm/lib/media/avif.mjs
var isAvifAnimated = (buffer) => {
  const view = new Uint8Array(buffer);
  return view[3] === 44;
};

// node_modules/@tldraw/utils/dist-esm/lib/media/gif.mjs
function getDataBlocksLength(buffer, offset) {
  let length = 0;
  while (buffer[offset + length]) {
    length += buffer[offset + length] + 1;
  }
  return length + 1;
}
function isGIF(buffer) {
  const enc = new TextDecoder("ascii");
  const header = enc.decode(buffer.slice(0, 3));
  return header === "GIF";
}
function isGifAnimated(buffer) {
  const view = new Uint8Array(buffer);
  let hasColorTable, colorTableSize;
  let offset = 0;
  let imagesCount = 0;
  if (!isGIF(buffer)) {
    return false;
  }
  hasColorTable = view[10] & 128;
  colorTableSize = view[10] & 7;
  offset += 6;
  offset += 7;
  offset += hasColorTable ? 3 * Math.pow(2, colorTableSize + 1) : 0;
  while (imagesCount < 2 && offset < view.length) {
    switch (view[offset]) {
      // Image descriptor block. According to specification there could be any
      // number of these blocks (even zero). When there is more than one image
      // descriptor browsers will display animation (they shouldn't when there
      // is no delays defined, but they do it anyway).
      case 44:
        imagesCount += 1;
        hasColorTable = view[offset + 9] & 128;
        colorTableSize = view[offset + 9] & 7;
        offset += 10;
        offset += hasColorTable ? 3 * Math.pow(2, colorTableSize + 1) : 0;
        offset += getDataBlocksLength(view, offset + 1) + 1;
        break;
      // Skip all extension blocks. In theory this "plain text extension" blocks
      // could be frames of animation, but no browser renders them.
      case 33:
        offset += 2;
        offset += getDataBlocksLength(view, offset);
        break;
      // Stop processing on trailer block,
      // all data after this point will is ignored by decoders
      case 59:
        offset = view.length;
        break;
      // Oops! This GIF seems to be invalid
      default:
        offset = view.length;
        break;
    }
  }
  return imagesCount > 1;
}

// node_modules/@tldraw/utils/dist-esm/lib/media/png.mjs
var TABLE = [
  0,
  1996959894,
  3993919788,
  2567524794,
  124634137,
  1886057615,
  3915621685,
  2657392035,
  249268274,
  2044508324,
  3772115230,
  2547177864,
  162941995,
  2125561021,
  3887607047,
  2428444049,
  498536548,
  1789927666,
  4089016648,
  2227061214,
  450548861,
  1843258603,
  4107580753,
  2211677639,
  325883990,
  1684777152,
  4251122042,
  2321926636,
  335633487,
  1661365465,
  4195302755,
  2366115317,
  997073096,
  1281953886,
  3579855332,
  2724688242,
  1006888145,
  1258607687,
  3524101629,
  2768942443,
  901097722,
  1119000684,
  3686517206,
  2898065728,
  853044451,
  1172266101,
  3705015759,
  2882616665,
  651767980,
  1373503546,
  3369554304,
  3218104598,
  565507253,
  1454621731,
  3485111705,
  3099436303,
  671266974,
  1594198024,
  3322730930,
  2970347812,
  795835527,
  1483230225,
  3244367275,
  3060149565,
  1994146192,
  31158534,
  2563907772,
  4023717930,
  1907459465,
  112637215,
  2680153253,
  3904427059,
  2013776290,
  251722036,
  2517215374,
  3775830040,
  2137656763,
  141376813,
  2439277719,
  3865271297,
  1802195444,
  476864866,
  2238001368,
  4066508878,
  1812370925,
  453092731,
  2181625025,
  4111451223,
  1706088902,
  314042704,
  2344532202,
  4240017532,
  1658658271,
  366619977,
  2362670323,
  4224994405,
  1303535960,
  984961486,
  2747007092,
  3569037538,
  1256170817,
  1037604311,
  2765210733,
  3554079995,
  1131014506,
  879679996,
  2909243462,
  3663771856,
  1141124467,
  855842277,
  2852801631,
  3708648649,
  1342533948,
  654459306,
  3188396048,
  3373015174,
  1466479909,
  544179635,
  3110523913,
  3462522015,
  1591671054,
  702138776,
  2966460450,
  3352799412,
  1504918807,
  783551873,
  3082640443,
  3233442989,
  3988292384,
  2596254646,
  62317068,
  1957810842,
  3939845945,
  2647816111,
  81470997,
  1943803523,
  3814918930,
  2489596804,
  225274430,
  2053790376,
  3826175755,
  2466906013,
  167816743,
  2097651377,
  4027552580,
  2265490386,
  503444072,
  1762050814,
  4150417245,
  2154129355,
  426522225,
  1852507879,
  4275313526,
  2312317920,
  282753626,
  1742555852,
  4189708143,
  2394877945,
  397917763,
  1622183637,
  3604390888,
  2714866558,
  953729732,
  1340076626,
  3518719985,
  2797360999,
  1068828381,
  1219638859,
  3624741850,
  2936675148,
  906185462,
  1090812512,
  3747672003,
  2825379669,
  829329135,
  1181335161,
  3412177804,
  3160834842,
  628085408,
  1382605366,
  3423369109,
  3138078467,
  570562233,
  1426400815,
  3317316542,
  2998733608,
  733239954,
  1555261956,
  3268935591,
  3050360625,
  752459403,
  1541320221,
  2607071920,
  3965973030,
  1969922972,
  40735498,
  2617837225,
  3943577151,
  1913087877,
  83908371,
  2512341634,
  3803740692,
  2075208622,
  213261112,
  2463272603,
  3855990285,
  2094854071,
  198958881,
  2262029012,
  4057260610,
  1759359992,
  534414190,
  2176718541,
  4139329115,
  1873836001,
  414664567,
  2282248934,
  4279200368,
  1711684554,
  285281116,
  2405801727,
  4167216745,
  1634467795,
  376229701,
  2685067896,
  3608007406,
  1308918612,
  956543938,
  2808555105,
  3495958263,
  1231636301,
  1047427035,
  2932959818,
  3654703836,
  1088359270,
  936918e3,
  2847714899,
  3736837829,
  1202900863,
  817233897,
  3183342108,
  3401237130,
  1404277552,
  615818150,
  3134207493,
  3453421203,
  1423857449,
  601450431,
  3009837614,
  3294710456,
  1567103746,
  711928724,
  3020668471,
  3272380065,
  1510334235,
  755167117
];
if (typeof Int32Array !== "undefined") {
  TABLE = new Int32Array(TABLE);
}
var crc = (current, previous) => {
  let crc2 = previous === 0 ? 0 : ~~previous ^ -1;
  for (let index = 0; index < current.length; index++) {
    crc2 = TABLE[(crc2 ^ current[index]) & 255] ^ crc2 >>> 8;
  }
  return crc2 ^ -1;
};
var LEN_SIZE = 4;
var CRC_SIZE = 4;
var PngHelpers = class _PngHelpers {
  static isPng(view, offset) {
    if (view.getUint8(offset + 0) === 137 && view.getUint8(offset + 1) === 80 && view.getUint8(offset + 2) === 78 && view.getUint8(offset + 3) === 71 && view.getUint8(offset + 4) === 13 && view.getUint8(offset + 5) === 10 && view.getUint8(offset + 6) === 26 && view.getUint8(offset + 7) === 10) {
      return true;
    }
    return false;
  }
  static getChunkType(view, offset) {
    return [
      String.fromCharCode(view.getUint8(offset)),
      String.fromCharCode(view.getUint8(offset + 1)),
      String.fromCharCode(view.getUint8(offset + 2)),
      String.fromCharCode(view.getUint8(offset + 3))
    ].join("");
  }
  static readChunks(view, offset = 0) {
    const chunks = {};
    if (!_PngHelpers.isPng(view, offset)) {
      throw new Error("Not a PNG");
    }
    offset += 8;
    while (offset <= view.buffer.byteLength) {
      const start = offset;
      const len = view.getInt32(offset);
      offset += 4;
      const chunkType = _PngHelpers.getChunkType(view, offset);
      if (chunkType === "IDAT" && chunks[chunkType]) {
        offset += len + LEN_SIZE + CRC_SIZE;
        continue;
      }
      if (chunkType === "IEND") {
        break;
      }
      chunks[chunkType] = {
        start,
        dataOffset: offset + 4,
        size: len
      };
      offset += len + LEN_SIZE + CRC_SIZE;
    }
    return chunks;
  }
  static parsePhys(view, offset) {
    return {
      ppux: view.getUint32(offset),
      ppuy: view.getUint32(offset + 4),
      unit: view.getUint8(offset + 4)
    };
  }
  static findChunk(view, type) {
    const chunks = _PngHelpers.readChunks(view);
    return chunks[type];
  }
  static setPhysChunk(view, dpr = 1, options) {
    let offset = 46;
    let size = 0;
    const res1 = _PngHelpers.findChunk(view, "pHYs");
    if (res1) {
      offset = res1.start;
      size = res1.size;
    }
    const res2 = _PngHelpers.findChunk(view, "IDAT");
    if (res2) {
      offset = res2.start;
      size = 0;
    }
    const pHYsData = new ArrayBuffer(21);
    const pHYsDataView = new DataView(pHYsData);
    pHYsDataView.setUint32(0, 9);
    pHYsDataView.setUint8(4, "p".charCodeAt(0));
    pHYsDataView.setUint8(5, "H".charCodeAt(0));
    pHYsDataView.setUint8(6, "Y".charCodeAt(0));
    pHYsDataView.setUint8(7, "s".charCodeAt(0));
    const DPI_96 = 2835.5;
    pHYsDataView.setInt32(8, DPI_96 * dpr);
    pHYsDataView.setInt32(12, DPI_96 * dpr);
    pHYsDataView.setInt8(16, 1);
    const crcBit = new Uint8Array(pHYsData.slice(4, 17));
    pHYsDataView.setInt32(17, crc(crcBit));
    const startBuf = view.buffer.slice(0, offset);
    const endBuf = view.buffer.slice(offset + size);
    return new Blob([startBuf, pHYsData, endBuf], options);
  }
};

// node_modules/@tldraw/utils/dist-esm/lib/media/webp.mjs
function isWebp(view) {
  if (!view || view.length < 12) {
    return false;
  }
  return view[8] === 87 && view[9] === 69 && view[10] === 66 && view[11] === 80;
}
function isWebpAnimated(buffer) {
  const view = new Uint8Array(buffer);
  if (!isWebp(view)) {
    return false;
  }
  if (!view || view.length < 21) {
    return false;
  }
  return (view[20] >> 1 & 1) === 1;
}

// node_modules/@tldraw/utils/dist-esm/lib/media/media.mjs
var DEFAULT_SUPPORTED_VECTOR_IMAGE_TYPES = Object.freeze(["image/svg+xml"]);
var DEFAULT_SUPPORTED_STATIC_IMAGE_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp"
]);
var DEFAULT_SUPPORTED_ANIMATED_IMAGE_TYPES = Object.freeze([
  "image/gif",
  "image/apng",
  "image/avif"
]);
var DEFAULT_SUPPORTED_IMAGE_TYPES = Object.freeze([
  ...DEFAULT_SUPPORTED_STATIC_IMAGE_TYPES,
  ...DEFAULT_SUPPORTED_VECTOR_IMAGE_TYPES,
  ...DEFAULT_SUPPORTED_ANIMATED_IMAGE_TYPES
]);
var DEFAULT_SUPPORT_VIDEO_TYPES = Object.freeze([
  "video/mp4",
  "video/webm",
  "video/quicktime"
]);
var DEFAULT_SUPPORTED_MEDIA_TYPES = Object.freeze([
  ...DEFAULT_SUPPORTED_IMAGE_TYPES,
  ...DEFAULT_SUPPORT_VIDEO_TYPES
]);
var DEFAULT_SUPPORTED_MEDIA_TYPE_LIST = DEFAULT_SUPPORTED_MEDIA_TYPES.join(",");
var MediaHelpers = class _MediaHelpers {
  /**
   * Load a video from a url.
   * @public
   */
  static loadVideo(src) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.onloadeddata = () => resolve(video);
      video.onerror = (e) => {
        console.error(e);
        reject(new Error("Could not load video"));
      };
      video.crossOrigin = "anonymous";
      video.src = src;
    });
  }
  static async getVideoFrameAsDataUrl(video, time = 0) {
    const promise = promiseWithResolve();
    let didSetTime = false;
    const onReadyStateChanged = () => {
      if (!didSetTime) {
        if (video.readyState >= video.HAVE_METADATA) {
          didSetTime = true;
          video.currentTime = time;
        } else {
          return;
        }
      }
      if (video.readyState >= video.HAVE_CURRENT_DATA) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Could not get 2d context");
        }
        ctx.drawImage(video, 0, 0);
        promise.resolve(canvas.toDataURL());
      }
    };
    const onError = (e) => {
      console.error(e);
      promise.reject(new Error("Could not get video frame"));
    };
    video.addEventListener("loadedmetadata", onReadyStateChanged);
    video.addEventListener("loadeddata", onReadyStateChanged);
    video.addEventListener("canplay", onReadyStateChanged);
    video.addEventListener("seeked", onReadyStateChanged);
    video.addEventListener("error", onError);
    video.addEventListener("stalled", onError);
    onReadyStateChanged();
    try {
      return await promise;
    } finally {
      video.removeEventListener("loadedmetadata", onReadyStateChanged);
      video.removeEventListener("loadeddata", onReadyStateChanged);
      video.removeEventListener("canplay", onReadyStateChanged);
      video.removeEventListener("seeked", onReadyStateChanged);
      video.removeEventListener("error", onError);
      video.removeEventListener("stalled", onError);
    }
  }
  /**
   * Load an image from a url.
   * @public
   */
  static getImageAndDimensions(src) {
    return new Promise((resolve, reject) => {
      const img = Image();
      img.onload = () => {
        let dimensions;
        if (img.naturalWidth) {
          dimensions = {
            w: img.naturalWidth,
            h: img.naturalHeight
          };
        } else {
          document.body.appendChild(img);
          dimensions = {
            w: img.clientWidth,
            h: img.clientHeight
          };
          document.body.removeChild(img);
        }
        resolve({ ...dimensions, image: img });
      };
      img.onerror = (e) => {
        console.error(e);
        reject(new Error("Could not load image"));
      };
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "strict-origin-when-cross-origin";
      img.style.visibility = "hidden";
      img.style.position = "absolute";
      img.style.opacity = "0";
      img.style.zIndex = "-9999";
      img.src = src;
    });
  }
  /**
   * Get the size of a video blob
   *
   * @param blob - A SharedBlob containing the video
   * @public
   */
  static async getVideoSize(blob) {
    return _MediaHelpers.usingObjectURL(blob, async (url) => {
      const video = await _MediaHelpers.loadVideo(url);
      return { w: video.videoWidth, h: video.videoHeight };
    });
  }
  /**
   * Get the size of an image blob
   *
   * @param blob - A Blob containing the image.
   * @public
   */
  static async getImageSize(blob) {
    const { w, h } = await _MediaHelpers.usingObjectURL(blob, _MediaHelpers.getImageAndDimensions);
    try {
      if (blob.type === "image/png") {
        const view = new DataView(await blob.arrayBuffer());
        if (PngHelpers.isPng(view, 0)) {
          const physChunk = PngHelpers.findChunk(view, "pHYs");
          if (physChunk) {
            const physData = PngHelpers.parsePhys(view, physChunk.dataOffset);
            if (physData.unit === 0 && physData.ppux === physData.ppuy) {
              const pixelsPerMeter = 72 / 0.0254;
              const pixelRatio = Math.max(physData.ppux / pixelsPerMeter, 1);
              return {
                w: Math.round(w / pixelRatio),
                h: Math.round(h / pixelRatio)
              };
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      return { w, h };
    }
    return { w, h };
  }
  static async isAnimated(file) {
    if (file.type === "image/gif") {
      return isGifAnimated(await file.arrayBuffer());
    }
    if (file.type === "image/avif") {
      return isAvifAnimated(await file.arrayBuffer());
    }
    if (file.type === "image/webp") {
      return isWebpAnimated(await file.arrayBuffer());
    }
    if (file.type === "image/apng") {
      return isApngAnimated(await file.arrayBuffer());
    }
    return false;
  }
  static isAnimatedImageType(mimeType) {
    return DEFAULT_SUPPORTED_ANIMATED_IMAGE_TYPES.includes(mimeType || "");
  }
  static isStaticImageType(mimeType) {
    return DEFAULT_SUPPORTED_STATIC_IMAGE_TYPES.includes(mimeType || "");
  }
  static isVectorImageType(mimeType) {
    return DEFAULT_SUPPORTED_VECTOR_IMAGE_TYPES.includes(mimeType || "");
  }
  static isImageType(mimeType) {
    return DEFAULT_SUPPORTED_IMAGE_TYPES.includes(mimeType || "");
  }
  static async usingObjectURL(blob, fn) {
    const url = URL.createObjectURL(blob);
    try {
      return await fn(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
};

// node_modules/@tldraw/utils/dist-esm/lib/number.mjs
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function invLerp(a, b, t) {
  return (t - a) / (b - a);
}
function rng(seed = "") {
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 0;
  function next() {
    const t = x ^ x << 11;
    x = y;
    y = z;
    z = w;
    w ^= (w >>> 19 ^ t ^ t >>> 8) >>> 0;
    return w / 4294967296 * 2;
  }
  for (let k = 0; k < seed.length + 64; k++) {
    x ^= seed.charCodeAt(k) | 0;
    next();
  }
  return next;
}
function modulate(value, rangeA, rangeB, clamp = false) {
  const [fromLow, fromHigh] = rangeA;
  const [v0, v1] = rangeB;
  const result = v0 + (value - fromLow) / (fromHigh - fromLow) * (v1 - v0);
  return clamp ? v0 < v1 ? Math.max(Math.min(result, v1), v0) : Math.max(Math.min(result, v0), v1) : result;
}

// node_modules/@tldraw/utils/dist-esm/lib/object.mjs
var import_lodash = __toESM(require_lodash2(), 1);
function hasOwnProperty(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function getOwnProperty(obj, key) {
  if (!hasOwnProperty(obj, key)) {
    return void 0;
  }
  return obj[key];
}
function objectMapKeys(object2) {
  return Object.keys(object2);
}
function objectMapValues(object2) {
  return Object.values(object2);
}
function objectMapEntries(object2) {
  return Object.entries(object2);
}
function objectMapFromEntries(entries) {
  return Object.fromEntries(entries);
}
function filterEntries(object2, predicate) {
  const result = {};
  let didChange = false;
  for (const [key, value] of objectMapEntries(object2)) {
    if (predicate(key, value)) {
      result[key] = value;
    } else {
      didChange = true;
    }
  }
  return didChange ? result : object2;
}
function mapObjectMapValues(object2, mapper) {
  const result = {};
  for (const [key, value] of objectMapEntries(object2)) {
    const newValue = mapper(key, value);
    result[key] = newValue;
  }
  return result;
}
function areObjectsShallowEqual(obj1, obj2) {
  if (obj1 === obj2) return true;
  const keys1 = new Set(Object.keys(obj1));
  const keys2 = new Set(Object.keys(obj2));
  if (keys1.size !== keys2.size) return false;
  for (const key of keys1) {
    if (!keys2.has(key)) return false;
    if (!Object.is(obj1[key], obj2[key])) return false;
  }
  return true;
}
function groupBy(array2, keySelector) {
  const result = {};
  for (const value of array2) {
    const key = keySelector(value);
    if (!result[key]) result[key] = [];
    result[key].push(value);
  }
  return result;
}
function omit(obj, keys) {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}
function getChangedKeys(obj1, obj2) {
  const result = [];
  for (const key in obj1) {
    if (!Object.is(obj1[key], obj2[key])) {
      result.push(key);
    }
  }
  return result;
}
function isEqualAllowingForFloatingPointErrors(obj1, obj2, threshold = 1e-6) {
  return (0, import_lodash.default)(obj1, obj2, (value1, value2) => {
    if (typeof value1 === "number" && typeof value2 === "number") {
      return Math.abs(value1 - value2) < threshold;
    }
    return void 0;
  });
}

// node_modules/@tldraw/utils/dist-esm/lib/perf.mjs
var PERFORMANCE_COLORS = {
  Good: "#40C057",
  Mid: "#FFC078",
  Poor: "#E03131"
};
var PERFORMANCE_PREFIX_COLOR = PERFORMANCE_COLORS.Good;
function measureCbDuration(name, cb) {
  const start = performance.now();
  const result = cb();
  console.debug(
    `%cPerf%c ${name} took ${performance.now() - start}ms`,
    `color: white; background: ${PERFORMANCE_PREFIX_COLOR};padding: 2px;border-radius: 3px;`,
    "font-weight: normal"
  );
  return result;
}
function measureDuration(_target, propertyKey, descriptor) {
  const originalMethod = descriptor.value;
  descriptor.value = function(...args) {
    const start = performance.now();
    const result = originalMethod.apply(this, args);
    console.debug(
      `%cPerf%c ${propertyKey} took: ${performance.now() - start}ms`,
      `color: white; background: ${PERFORMANCE_PREFIX_COLOR};padding: 2px;border-radius: 3px;`,
      "font-weight: normal"
    );
    return result;
  };
  return descriptor;
}
var averages = /* @__PURE__ */ new Map();
function measureAverageDuration(_target, propertyKey, descriptor) {
  const originalMethod = descriptor.value;
  descriptor.value = function(...args) {
    const start = performance.now();
    const result = originalMethod.apply(this, args);
    const end = performance.now();
    const length = end - start;
    if (length !== 0) {
      const value = averages.get(descriptor.value);
      const total = value.total + length;
      const count = value.count + 1;
      averages.set(descriptor.value, { total, count });
      console.debug(
        `%cPerf%c ${propertyKey} took ${(end - start).toFixed(2)}ms | average ${(total / count).toFixed(2)}ms`,
        `color: white; background: ${PERFORMANCE_PREFIX_COLOR};padding: 2px;border-radius: 3px;`,
        "font-weight: normal"
      );
    }
    return result;
  };
  averages.set(descriptor.value, { total: 0, count: 0 });
  return descriptor;
}

// node_modules/@tldraw/utils/dist-esm/lib/PerformanceTracker.mjs
var PerformanceTracker = class {
  startTime = 0;
  name = "";
  frames = 0;
  started = false;
  frame = null;
  // eslint-disable-next-line local/prefer-class-methods
  recordFrame = () => {
    this.frames++;
    if (!this.started) return;
    this.frame = requestAnimationFrame(this.recordFrame);
  };
  start(name) {
    this.name = name;
    this.frames = 0;
    this.started = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.recordFrame);
    this.startTime = performance.now();
  }
  stop() {
    this.started = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    const duration = (performance.now() - this.startTime) / 1e3;
    const fps = duration === 0 ? 0 : Math.floor(this.frames / duration);
    const background = fps > 55 ? PERFORMANCE_COLORS.Good : fps > 30 ? PERFORMANCE_COLORS.Mid : PERFORMANCE_COLORS.Poor;
    const color = background === PERFORMANCE_COLORS.Mid ? "black" : "white";
    const capitalized = this.name[0].toUpperCase() + this.name.slice(1);
    console.debug(
      `%cPerf%c ${capitalized} %c${fps}%c fps`,
      `color: white; background: ${PERFORMANCE_PREFIX_COLOR};padding: 2px;border-radius: 3px;`,
      "font-weight: normal",
      `font-weight: bold; padding: 2px; background: ${background};color: ${color};`,
      "font-weight: normal"
    );
  }
  isStarted() {
    return this.started;
  }
};

// node_modules/fractional-indexing-jittered/lib/index.js
function indexCharacterSet(options) {
  const dicts = createCharSetDicts(options.chars);
  const limits = integerLimits(
    dicts,
    options.firstPositive,
    options.mostPositive,
    options.mostNegative
  );
  const jitterRange = options.jitterRange ?? Math.floor(Math.pow(dicts.length, 3) / 5);
  const paddingRange = paddingDict(jitterRange, dicts.length);
  return {
    chars: options.chars,
    byChar: dicts.byChar,
    byCode: dicts.byCode,
    length: dicts.length,
    first: dicts.byCode[0],
    last: dicts.byCode[dicts.length - 1],
    firstPositive: limits.firstPositive,
    mostPositive: limits.mostPositive,
    firstNegative: limits.firstNegative,
    mostNegative: limits.mostNegative,
    jitterRange,
    paddingDict: paddingRange
  };
}
function createCharSetDicts(charSet) {
  const byCode = {};
  const byChar = {};
  const length = charSet.length;
  for (let i = 0; i < length; i++) {
    const char = charSet[i];
    byCode[i] = char;
    byChar[char] = i;
  }
  return {
    byCode,
    byChar,
    length
  };
}
function integerLimits(dicts, firstPositive, mostPositive, mostNegative) {
  const firstPositiveIndex = firstPositive ? dicts.byChar[firstPositive] : Math.ceil(dicts.length / 2);
  const mostPositiveIndex = mostPositive ? dicts.byChar[mostPositive] : dicts.length - 1;
  const mostNegativeIndex = mostNegative ? dicts.byChar[mostNegative] : 0;
  if (firstPositiveIndex === void 0 || mostPositiveIndex === void 0 || mostNegativeIndex === void 0) {
    throw new Error("invalid charSet");
  }
  if (mostPositiveIndex - firstPositiveIndex < 3) {
    throw new Error(
      "mostPositive must be at least 3 characters away from neutral"
    );
  }
  if (firstPositiveIndex - mostNegativeIndex < 3) {
    throw new Error(
      "mostNegative must be at least 3 characters away from neutral"
    );
  }
  return {
    firstPositive: dicts.byCode[firstPositiveIndex],
    mostPositive: dicts.byCode[mostPositiveIndex],
    firstNegative: dicts.byCode[firstPositiveIndex - 1],
    mostNegative: dicts.byCode[mostNegativeIndex]
  };
}
function paddingDict(jitterRange, charSetLength) {
  const paddingDict2 = {};
  let distance = 0;
  for (let i = 0; i < 100; i++) {
    paddingDict2[i] = Math.pow(charSetLength, i);
    if (paddingDict2[i] > jitterRange) {
      break;
    }
  }
  return paddingDict2;
}
var _base62CharSet = null;
function base62CharSet() {
  if (_base62CharSet)
    return _base62CharSet;
  return _base62CharSet = indexCharacterSet({
    // Base62 are all the alphanumeric characters, database and user friendly
    // For shorter strings and more room you could opt for more characters
    chars: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    // This gives us nice human readable keys to start with a0 a1 etc
    firstPositive: "a",
    mostPositive: "z",
    mostNegative: "A"
  });
}
function distanceBetween(a, b, charSet) {
  const indexA = charSet.byChar[a];
  const indexB = charSet.byChar[b];
  return Math.abs(indexA - indexB);
}
function integerLength(head, charSet) {
  const firstChar = head[0];
  if (firstChar > charSet.mostPositive || firstChar < charSet.mostNegative) {
    throw new Error("invalid firstChar on key");
  }
  if (firstChar === charSet.mostPositive) {
    const firstLevel = distanceBetween(firstChar, charSet.firstPositive, charSet) + 1;
    return firstLevel + integerLengthFromSecondLevel(head.slice(1), "positive", charSet);
  }
  if (firstChar === charSet.mostNegative) {
    const firstLevel = distanceBetween(firstChar, charSet.firstNegative, charSet) + 1;
    return firstLevel + integerLengthFromSecondLevel(head.slice(1), "negative", charSet);
  }
  const isPositiveRange = firstChar >= charSet.firstPositive;
  if (isPositiveRange) {
    return distanceBetween(firstChar, charSet.firstPositive, charSet) + 2;
  } else {
    return distanceBetween(firstChar, charSet.firstNegative, charSet) + 2;
  }
}
function integerLengthFromSecondLevel(key, direction, charSet) {
  const firstChar = key[0];
  if (firstChar > charSet.mostPositive || firstChar < charSet.mostNegative) {
    throw new Error("invalid firstChar on key");
  }
  if (firstChar === charSet.mostPositive && direction === "positive") {
    const totalPositiveRoom = distanceBetween(firstChar, charSet.mostNegative, charSet) + 1;
    return totalPositiveRoom + integerLengthFromSecondLevel(key.slice(1), direction, charSet);
  }
  if (firstChar === charSet.mostNegative && direction === "negative") {
    const totalNegativeRoom = distanceBetween(firstChar, charSet.mostPositive, charSet) + 1;
    return totalNegativeRoom + integerLengthFromSecondLevel(key.slice(1), direction, charSet);
  }
  if (direction === "positive") {
    return distanceBetween(firstChar, charSet.mostNegative, charSet) + 2;
  } else {
    return distanceBetween(firstChar, charSet.mostPositive, charSet) + 2;
  }
}
function makeSameLength(a, b, pad, fillChar, forceLength) {
  const max = forceLength ?? Math.max(a.length, b.length);
  if (pad === "start") {
    return [a.padStart(max, fillChar), b.padStart(max, fillChar)];
  }
  return [a.padEnd(max, fillChar), b.padEnd(max, fillChar)];
}
function midPoint(lower, upper, charSet) {
  let [paddedLower, paddedUpper] = makeSameLength(
    lower,
    upper,
    "end",
    charSet.first
  );
  let distance = lexicalDistance(paddedLower, paddedUpper, charSet);
  if (distance === 1) {
    paddedLower = paddedLower.padEnd(paddedLower.length + 1, charSet.first);
    distance = charSet.length;
  }
  const mid = encodeToCharSet(Math.floor(distance / 2), charSet);
  return addCharSetKeys(paddedLower, mid, charSet);
}
function lexicalDistance(a, b, charSet) {
  const [lower, upper] = makeSameLength(a, b, "end", charSet.first).sort();
  const distance = subtractCharSetKeys(upper, lower, charSet);
  return decodeCharSetToNumber(distance, charSet);
}
function addCharSetKeys(a, b, charSet) {
  const base = charSet.length;
  const [paddedA, paddedB] = makeSameLength(a, b, "start", charSet.first);
  const result = [];
  let carry = 0;
  for (let i = paddedA.length - 1; i >= 0; i--) {
    const digitA = charSet.byChar[paddedA[i]];
    const digitB = charSet.byChar[paddedB[i]];
    const sum = digitA + digitB + carry;
    carry = Math.floor(sum / base);
    const remainder = sum % base;
    result.unshift(charSet.byCode[remainder]);
  }
  if (carry > 0) {
    result.unshift(charSet.byCode[carry]);
  }
  return result.join("");
}
function subtractCharSetKeys(a, b, charSet, stripLeadingZeros = true) {
  const base = charSet.length;
  const [paddedA, paddedB] = makeSameLength(a, b, "start", charSet.first);
  const result = [];
  let borrow = 0;
  for (let i = paddedA.length - 1; i >= 0; i--) {
    let digitA = charSet.byChar[paddedA[i]];
    const digitB = charSet.byChar[paddedB[i]] + borrow;
    if (digitA < digitB) {
      borrow = 1;
      digitA += base;
    } else {
      borrow = 0;
    }
    const difference = digitA - digitB;
    result.unshift(charSet.byCode[difference]);
  }
  if (borrow > 0) {
    throw new Error(
      "Subtraction result is negative. Ensure a is greater than or equal to b."
    );
  }
  while (stripLeadingZeros && result.length > 1 && result[0] === charSet.first) {
    result.shift();
  }
  return result.join("");
}
function incrementKey(key, charSet) {
  return addCharSetKeys(key, charSet.byCode[1], charSet);
}
function decrementKey(key, charSet) {
  return subtractCharSetKeys(key, charSet.byCode[1], charSet, false);
}
function encodeToCharSet(int, charSet) {
  if (int === 0) {
    return charSet.byCode[0];
  }
  let res = "";
  const max = charSet.length;
  while (int > 0) {
    res = charSet.byCode[int % max] + res;
    int = Math.floor(int / max);
  }
  return res;
}
function decodeCharSetToNumber(key, charSet) {
  let res = 0;
  const length = key.length;
  const max = charSet.length;
  for (let i = 0; i < length; i++) {
    res += charSet.byChar[key[i]] * Math.pow(max, length - i - 1);
  }
  return res;
}
function startKey(charSet) {
  return charSet.firstPositive + charSet.byCode[0];
}
function validInteger(integer2, charSet) {
  const length = integerLength(integer2, charSet);
  return length === integer2.length;
}
function validateOrderKey(orderKey, charSet) {
  getIntegerPart(orderKey, charSet);
}
function getIntegerPart(orderKey, charSet) {
  const head = integerHead(orderKey, charSet);
  const integerPartLength = integerLength(head, charSet);
  if (integerPartLength > orderKey.length) {
    throw new Error("invalid order key length: " + orderKey);
  }
  return orderKey.slice(0, integerPartLength);
}
function validateInteger(integer2, charSet) {
  if (!validInteger(integer2, charSet)) {
    throw new Error("invalid integer length: " + integer2);
  }
}
function incrementInteger(integer2, charSet) {
  validateInteger(integer2, charSet);
  const [head, digs] = splitInteger(integer2, charSet);
  const anyNonMaxedDigit = digs.split("").some((d) => d !== charSet.byCode[charSet.length - 1]);
  if (anyNonMaxedDigit) {
    const newDigits = incrementKey(digs, charSet);
    return head + newDigits;
  }
  const nextHead = incrementIntegerHead(head, charSet);
  return startOnNewHead(nextHead, "lower", charSet);
}
function decrementInteger(integer2, charSet) {
  validateInteger(integer2, charSet);
  const [head, digs] = splitInteger(integer2, charSet);
  const anyNonLimitDigit = digs.split("").some((d) => d !== charSet.byCode[0]);
  if (anyNonLimitDigit) {
    const newDigits = decrementKey(digs, charSet);
    return head + newDigits;
  }
  const nextHead = decrementIntegerHead(head, charSet);
  return startOnNewHead(nextHead, "upper", charSet);
}
function integerHead(integer2, charSet) {
  let i = 0;
  if (integer2[0] === charSet.mostPositive) {
    while (integer2[i] === charSet.mostPositive) {
      i = i + 1;
    }
  }
  if (integer2[0] === charSet.mostNegative) {
    while (integer2[i] === charSet.mostNegative) {
      i = i + 1;
    }
  }
  return integer2.slice(0, i + 1);
}
function splitInteger(integer2, charSet) {
  const head = integerHead(integer2, charSet);
  const tail = integer2.slice(head.length);
  return [head, tail];
}
function incrementIntegerHead(head, charSet) {
  const inPositiveRange = head >= charSet.firstPositive;
  const nextHead = incrementKey(head, charSet);
  const headIsLimitMax = head[head.length - 1] === charSet.mostPositive;
  const nextHeadIsLimitMax = nextHead[nextHead.length - 1] === charSet.mostPositive;
  if (inPositiveRange && nextHeadIsLimitMax) {
    return nextHead + charSet.mostNegative;
  }
  if (!inPositiveRange && headIsLimitMax) {
    return head.slice(0, head.length - 1);
  }
  return nextHead;
}
function decrementIntegerHead(head, charSet) {
  const inPositiveRange = head >= charSet.firstPositive;
  const headIsLimitMin = head[head.length - 1] === charSet.mostNegative;
  if (inPositiveRange && headIsLimitMin) {
    const nextLevel = head.slice(0, head.length - 1);
    return decrementKey(nextLevel, charSet);
  }
  if (!inPositiveRange && headIsLimitMin) {
    return head + charSet.mostPositive;
  }
  return decrementKey(head, charSet);
}
function startOnNewHead(head, limit, charSet) {
  const newLength = integerLength(head, charSet);
  const fillChar = limit === "upper" ? charSet.byCode[charSet.length - 1] : charSet.byCode[0];
  return head + fillChar.repeat(newLength - head.length);
}
function jitterString(orderKey, charSet) {
  const shift = encodeToCharSet(
    Math.floor(Math.random() * charSet.jitterRange),
    charSet
  );
  return addCharSetKeys(orderKey, shift, charSet);
}
function padAndJitterString(orderKey, numberOfChars, charSet) {
  const paddedKey = orderKey.padEnd(
    orderKey.length + numberOfChars,
    charSet.first
  );
  return jitterString(paddedKey, charSet);
}
function paddingNeededForJitter(orderKey, b, charSet) {
  const integer2 = getIntegerPart(orderKey, charSet);
  const nextInteger = incrementInteger(integer2, charSet);
  let needed = 0;
  if (b !== null) {
    const distanceToB = lexicalDistance(orderKey, b, charSet);
    if (distanceToB < charSet.jitterRange + 1) {
      needed = Math.max(needed, paddingNeededForDistance(distanceToB, charSet));
    }
  }
  const distanceToNextInteger = lexicalDistance(orderKey, nextInteger, charSet);
  if (distanceToNextInteger < charSet.jitterRange + 1) {
    needed = Math.max(
      needed,
      paddingNeededForDistance(distanceToNextInteger, charSet)
    );
  }
  return needed;
}
function paddingNeededForDistance(distance, charSet) {
  const gap = charSet.jitterRange - distance;
  const firstBigger = Object.entries(charSet.paddingDict).find(
    ([_key, value]) => {
      return value > gap;
    }
  );
  return firstBigger ? parseInt(firstBigger[0]) : 0;
}
function generateKeyBetween(lower, upper, charSet = base62CharSet()) {
  if (lower !== null) {
    validateOrderKey(lower, charSet);
  }
  if (upper !== null) {
    validateOrderKey(upper, charSet);
  }
  if (lower === null && upper === null) {
    return startKey(charSet);
  }
  if (lower === null) {
    const integer2 = getIntegerPart(upper, charSet);
    return decrementInteger(integer2, charSet);
  }
  if (upper === null) {
    const integer2 = getIntegerPart(lower, charSet);
    return incrementInteger(integer2, charSet);
  }
  if (lower >= upper) {
    throw new Error(lower + " >= " + upper);
  }
  return midPoint(lower, upper, charSet);
}
function generateJitteredKeyBetween(lower, upper, charSet = base62CharSet()) {
  const key = generateKeyBetween(lower, upper, charSet);
  const paddingNeeded = paddingNeededForJitter(key, upper, charSet);
  if (paddingNeeded) {
    return padAndJitterString(key, paddingNeeded, charSet);
  }
  return jitterString(key, charSet);
}
function generateNJitteredKeysBetween(lower, upper, n, charSet = base62CharSet()) {
  return spreadGeneratorResults(
    lower,
    upper,
    n,
    charSet,
    generateJitteredKeyBetween,
    generateNJitteredKeysBetween
  );
}
function spreadGeneratorResults(lower, upper, n, charSet, generateKey, generateNKeys) {
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [generateKey(lower, upper, charSet)];
  }
  if (upper == null) {
    let newUpper = generateKey(lower, upper, charSet);
    const result = [newUpper];
    for (let i = 0; i < n - 1; i++) {
      newUpper = generateKey(newUpper, upper, charSet);
      result.push(newUpper);
    }
    return result;
  }
  if (lower == null) {
    let newLower = generateKey(lower, upper, charSet);
    const result = [newLower];
    for (let i = 0; i < n - 1; i++) {
      newLower = generateKey(lower, newLower, charSet);
      result.push(newLower);
    }
    result.reverse();
    return result;
  }
  const mid = Math.floor(n / 2);
  const midOrderKey = generateKey(lower, upper, charSet);
  return [
    ...generateNKeys(lower, midOrderKey, mid, charSet),
    midOrderKey,
    ...generateNKeys(midOrderKey, upper, n - mid - 1, charSet)
  ];
}

// node_modules/@tldraw/utils/dist-esm/lib/reordering.mjs
var generateKeysFn = false ? generateNKeysBetween : generateNJitteredKeysBetween;
var ZERO_INDEX_KEY = "a0";
function validateIndexKey(index) {
  try {
    generateJitteredKeyBetween(index, null);
  } catch {
    throw new Error("invalid index: " + index);
  }
}
function getIndicesBetween(below, above, n) {
  return generateKeysFn(below ?? null, above ?? null, n);
}
function getIndicesAbove(below, n) {
  return generateKeysFn(below ?? null, null, n);
}
function getIndicesBelow(above, n) {
  return generateKeysFn(null, above ?? null, n);
}
function getIndexBetween(below, above) {
  return generateKeysFn(below ?? null, above ?? null, 1)[0];
}
function getIndexAbove(below = null) {
  return generateKeysFn(below, null, 1)[0];
}
function getIndexBelow(above = null) {
  return generateKeysFn(null, above, 1)[0];
}
function getIndices(n, start = "a1") {
  return [start, ...generateKeysFn(start, null, n)];
}
function sortByIndex(a, b) {
  if (a.index < b.index) {
    return -1;
  } else if (a.index > b.index) {
    return 1;
  }
  return 0;
}

// node_modules/@tldraw/utils/dist-esm/lib/retry.mjs
async function retry(fn, {
  attempts = 3,
  waitDuration = 1e3,
  abortSignal,
  matchError
} = {}) {
  let error = null;
  for (let i = 0; i < attempts; i++) {
    if (abortSignal?.aborted) throw new Error("aborted");
    try {
      return await fn();
    } catch (e) {
      if (matchError && !matchError(e)) throw e;
      error = e;
      await sleep(waitDuration);
    }
  }
  throw error;
}

// node_modules/@tldraw/utils/dist-esm/lib/sort.mjs
function sortById(a, b) {
  return a.id > b.id ? 1 : -1;
}

// node_modules/@tldraw/utils/dist-esm/lib/storage.mjs
function getFromLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function setInLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}
function deleteFromLocalStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
  }
}
function clearLocalStorage() {
  try {
    localStorage.clear();
  } catch {
  }
}
function getFromSessionStorage(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function setInSessionStorage(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
  }
}
function deleteFromSessionStorage(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
  }
}
function clearSessionStorage() {
  try {
    sessionStorage.clear();
  } catch {
  }
}

// node_modules/@tldraw/utils/dist-esm/lib/stringEnum.mjs
function stringEnum(...values) {
  const obj = {};
  for (const value of values) {
    obj[value] = value;
  }
  return obj;
}

// node_modules/@tldraw/utils/dist-esm/lib/throttle.mjs
var isTest = () => typeof process !== "undefined" && false;
var fpsQueue = [];
var targetFps = 60;
var targetTimePerFrame = Math.floor(1e3 / targetFps) * 0.9;
var frameRaf;
var flushRaf;
var lastFlushTime = -targetTimePerFrame;
var flush = () => {
  const queue = fpsQueue.splice(0, fpsQueue.length);
  for (const fn of queue) {
    fn();
  }
};
function tick(isOnNextFrame = false) {
  if (frameRaf) return;
  const now = Date.now();
  const elapsed = now - lastFlushTime;
  if (elapsed < targetTimePerFrame) {
    frameRaf = requestAnimationFrame(() => {
      frameRaf = void 0;
      tick(true);
    });
    return;
  }
  if (isOnNextFrame) {
    if (flushRaf) return;
    lastFlushTime = now;
    flush();
  } else {
    if (flushRaf) return;
    flushRaf = requestAnimationFrame(() => {
      flushRaf = void 0;
      lastFlushTime = now;
      flush();
    });
  }
}
function fpsThrottle(fn) {
  if (isTest()) {
    fn.cancel = () => {
      if (frameRaf) {
        cancelAnimationFrame(frameRaf);
        frameRaf = void 0;
      }
      if (flushRaf) {
        cancelAnimationFrame(flushRaf);
        flushRaf = void 0;
      }
    };
    return fn;
  }
  const throttledFn = () => {
    if (fpsQueue.includes(fn)) {
      return;
    }
    fpsQueue.push(fn);
    tick();
  };
  throttledFn.cancel = () => {
    const index = fpsQueue.indexOf(fn);
    if (index > -1) {
      fpsQueue.splice(index, 1);
    }
  };
  return throttledFn;
}
function throttleToNextFrame(fn) {
  if (isTest()) {
    fn();
    return () => void 0;
  }
  if (!fpsQueue.includes(fn)) {
    fpsQueue.push(fn);
    tick();
  }
  return () => {
    const index = fpsQueue.indexOf(fn);
    if (index > -1) {
      fpsQueue.splice(index, 1);
    }
  };
}

// node_modules/@tldraw/utils/dist-esm/lib/timers.mjs
var Timers = class {
  timeouts = /* @__PURE__ */ new Map();
  intervals = /* @__PURE__ */ new Map();
  rafs = /* @__PURE__ */ new Map();
  constructor() {
    this.setTimeout = this.setTimeout.bind(this);
    this.setInterval = this.setInterval.bind(this);
    this.requestAnimationFrame = this.requestAnimationFrame.bind(this);
    this.dispose = this.dispose.bind(this);
  }
  /** @public */
  setTimeout(contextId, handler, timeout, ...args) {
    const id = window.setTimeout(handler, timeout, args);
    const current = this.timeouts.get(contextId) ?? [];
    this.timeouts.set(contextId, [...current, id]);
    return id;
  }
  /** @public */
  setInterval(contextId, handler, timeout, ...args) {
    const id = window.setInterval(handler, timeout, args);
    const current = this.intervals.get(contextId) ?? [];
    this.intervals.set(contextId, [...current, id]);
    return id;
  }
  /** @public */
  requestAnimationFrame(contextId, callback) {
    const id = window.requestAnimationFrame(callback);
    const current = this.rafs.get(contextId) ?? [];
    this.rafs.set(contextId, [...current, id]);
    return id;
  }
  /** @public */
  dispose(contextId) {
    this.timeouts.get(contextId)?.forEach((id) => clearTimeout(id));
    this.intervals.get(contextId)?.forEach((id) => clearInterval(id));
    this.rafs.get(contextId)?.forEach((id) => cancelAnimationFrame(id));
    this.timeouts.delete(contextId);
    this.intervals.delete(contextId);
    this.rafs.delete(contextId);
  }
  disposeAll() {
    for (const contextId of this.timeouts.keys()) {
      this.dispose(contextId);
    }
  }
  forContext(contextId) {
    return {
      setTimeout: (handler, timeout, ...args) => this.setTimeout(contextId, handler, timeout, args),
      setInterval: (handler, timeout, ...args) => this.setInterval(contextId, handler, timeout, args),
      requestAnimationFrame: (callback) => this.requestAnimationFrame(contextId, callback),
      dispose: () => this.dispose(contextId)
    };
  }
};

// node_modules/@tldraw/utils/dist-esm/lib/url.mjs
var safeParseUrl = (url, baseUrl) => {
  try {
    return new URL(url, baseUrl);
  } catch {
    return;
  }
};

// node_modules/@tldraw/utils/dist-esm/lib/value.mjs
function isDefined(value) {
  return value !== void 0;
}
function isNonNull(value) {
  return value !== null;
}
function isNonNullish(value) {
  return value !== null && value !== void 0;
}
function getStructuredClone() {
  if (typeof globalThis !== "undefined" && globalThis.structuredClone) {
    return [globalThis.structuredClone, true];
  }
  if (typeof global !== "undefined" && global.structuredClone) {
    return [global.structuredClone, true];
  }
  if (typeof window !== "undefined" && window.structuredClone) {
    return [window.structuredClone, true];
  }
  return [(i) => i ? JSON.parse(JSON.stringify(i)) : i, false];
}
var _structuredClone = getStructuredClone();
var structuredClone = _structuredClone[0];
var isNativeStructuredClone = _structuredClone[1];
var STRUCTURED_CLONE_OBJECT_PROTOTYPE = Object.getPrototypeOf(structuredClone({}));

// node_modules/@tldraw/utils/dist-esm/lib/warn.mjs
var usedWarnings = /* @__PURE__ */ new Set();
function warnDeprecatedGetter(name) {
  warnOnce(
    `Using '${name}' is deprecated and will be removed in the near future. Please refactor to use 'get${name[0].toLocaleUpperCase()}${name.slice(
      1
    )}' instead.`
  );
}
function warnOnce(message) {
  if (usedWarnings.has(message)) return;
  usedWarnings.add(message);
  console.warn(`[tldraw] ${message}`);
}

// node_modules/@tldraw/utils/dist-esm/index.mjs
registerTldrawLibraryVersion(
  "@tldraw/utils",
  "3.15.6",
  "esm"
);

// node_modules/@tldraw/validate/dist-esm/lib/validation.mjs
var validation_exports = {};
__export(validation_exports, {
  ArrayOfValidator: () => ArrayOfValidator,
  DictValidator: () => DictValidator,
  ObjectValidator: () => ObjectValidator,
  UnionValidator: () => UnionValidator,
  ValidationError: () => ValidationError,
  Validator: () => Validator,
  any: () => any,
  array: () => array,
  arrayOf: () => arrayOf,
  bigint: () => bigint,
  boolean: () => boolean,
  dict: () => dict,
  httpUrl: () => httpUrl,
  indexKey: () => indexKey,
  integer: () => integer,
  jsonDict: () => jsonDict,
  jsonValue: () => jsonValue,
  linkUrl: () => linkUrl,
  literal: () => literal,
  literalEnum: () => literalEnum,
  model: () => model,
  nonZeroInteger: () => nonZeroInteger,
  nonZeroNumber: () => nonZeroNumber,
  nullable: () => nullable,
  number: () => number,
  numberUnion: () => numberUnion,
  object: () => object,
  optional: () => optional,
  or: () => or,
  positiveInteger: () => positiveInteger,
  positiveNumber: () => positiveNumber,
  setEnum: () => setEnum,
  srcUrl: () => srcUrl,
  string: () => string,
  union: () => union,
  unknown: () => unknown,
  unknownObject: () => unknownObject
});
function formatPath(path) {
  if (!path.length) {
    return null;
  }
  let formattedPath = "";
  for (const item of path) {
    if (typeof item === "number") {
      formattedPath += `.${item}`;
    } else if (item.startsWith("(")) {
      if (formattedPath.endsWith(")")) {
        formattedPath = `${formattedPath.slice(0, -1)}, ${item.slice(1)}`;
      } else {
        formattedPath += item;
      }
    } else {
      formattedPath += `.${item}`;
    }
  }
  formattedPath = formattedPath.replace(/id = [^,]+, /, "").replace(/id = [^)]+/, "");
  if (formattedPath.startsWith(".")) {
    return formattedPath.slice(1);
  }
  return formattedPath;
}
var ValidationError = class extends Error {
  constructor(rawMessage, path = []) {
    const formattedPath = formatPath(path);
    const indentedMessage = rawMessage.split("\n").map((line, i) => i === 0 ? line : `  ${line}`).join("\n");
    super(path ? `At ${formattedPath}: ${indentedMessage}` : indentedMessage);
    this.rawMessage = rawMessage;
    this.path = path;
  }
  name = "ValidationError";
};
function prefixError(path, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new ValidationError(err.rawMessage, [path, ...err.path]);
    }
    throw new ValidationError(err.toString(), [path]);
  }
}
function typeToString(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const type = typeof value;
  switch (type) {
    case "bigint":
    case "boolean":
    case "function":
    case "number":
    case "string":
    case "symbol":
      return `a ${type}`;
    case "object":
      return `an ${type}`;
    case "undefined":
      return "undefined";
    default:
      exhaustiveSwitchError(type);
  }
}
var Validator = class _Validator {
  constructor(validationFn, validateUsingKnownGoodVersionFn) {
    this.validationFn = validationFn;
    this.validateUsingKnownGoodVersionFn = validateUsingKnownGoodVersionFn;
  }
  /**
   * Asserts that the passed value is of the correct type and returns it. The returned value is
   * guaranteed to be referentially equal to the passed value.
   */
  validate(value) {
    const validated = this.validationFn(value);
    if (!Object.is(value, validated)) {
      throw new ValidationError("Validator functions must return the same value they were passed");
    }
    return validated;
  }
  validateUsingKnownGoodVersion(knownGoodValue, newValue) {
    if (Object.is(knownGoodValue, newValue)) {
      return knownGoodValue;
    }
    if (this.validateUsingKnownGoodVersionFn) {
      return this.validateUsingKnownGoodVersionFn(knownGoodValue, newValue);
    }
    return this.validate(newValue);
  }
  /** Checks that the passed value is of the correct type. */
  isValid(value) {
    try {
      this.validate(value);
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Returns a new validator that also accepts null or undefined. The resulting value will always be
   * null.
   */
  nullable() {
    return nullable(this);
  }
  /**
   * Returns a new validator that also accepts null or undefined. The resulting value will always be
   * null.
   */
  optional() {
    return optional(this);
  }
  /**
   * Refine this validation to a new type. The passed-in validation function should throw an error
   * if the value can't be converted to the new type, or return the new type otherwise.
   */
  refine(otherValidationFn) {
    return new _Validator(
      (value) => {
        return otherValidationFn(this.validate(value));
      },
      (knownGoodValue, newValue) => {
        const validated = this.validateUsingKnownGoodVersion(knownGoodValue, newValue);
        if (Object.is(knownGoodValue, validated)) {
          return knownGoodValue;
        }
        return otherValidationFn(validated);
      }
    );
  }
  check(nameOrCheckFn, checkFn) {
    if (typeof nameOrCheckFn === "string") {
      return this.refine((value) => {
        prefixError(`(check ${nameOrCheckFn})`, () => checkFn(value));
        return value;
      });
    } else {
      return this.refine((value) => {
        nameOrCheckFn(value);
        return value;
      });
    }
  }
};
var ArrayOfValidator = class extends Validator {
  constructor(itemValidator) {
    super(
      (value) => {
        const arr = array.validate(value);
        for (let i = 0; i < arr.length; i++) {
          prefixError(i, () => itemValidator.validate(arr[i]));
        }
        return arr;
      },
      (knownGoodValue, newValue) => {
        if (!itemValidator.validateUsingKnownGoodVersion) return this.validate(newValue);
        const arr = array.validate(newValue);
        let isDifferent = knownGoodValue.length !== arr.length;
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i];
          if (i >= knownGoodValue.length) {
            isDifferent = true;
            prefixError(i, () => itemValidator.validate(item));
            continue;
          }
          if (Object.is(knownGoodValue[i], item)) {
            continue;
          }
          const checkedItem = prefixError(
            i,
            () => itemValidator.validateUsingKnownGoodVersion(knownGoodValue[i], item)
          );
          if (!Object.is(checkedItem, knownGoodValue[i])) {
            isDifferent = true;
          }
        }
        return isDifferent ? newValue : knownGoodValue;
      }
    );
    this.itemValidator = itemValidator;
  }
  nonEmpty() {
    return this.check((value) => {
      if (value.length === 0) {
        throw new ValidationError("Expected a non-empty array");
      }
    });
  }
  lengthGreaterThan1() {
    return this.check((value) => {
      if (value.length <= 1) {
        throw new ValidationError("Expected an array with length greater than 1");
      }
    });
  }
};
var ObjectValidator = class _ObjectValidator extends Validator {
  constructor(config, shouldAllowUnknownProperties = false) {
    super(
      (object2) => {
        if (typeof object2 !== "object" || object2 === null) {
          throw new ValidationError(`Expected object, got ${typeToString(object2)}`);
        }
        for (const [key, validator] of Object.entries(config)) {
          prefixError(key, () => {
            ;
            validator.validate(getOwnProperty(object2, key));
          });
        }
        if (!shouldAllowUnknownProperties) {
          for (const key of Object.keys(object2)) {
            if (!hasOwnProperty(config, key)) {
              throw new ValidationError(`Unexpected property`, [key]);
            }
          }
        }
        return object2;
      },
      (knownGoodValue, newValue) => {
        if (typeof newValue !== "object" || newValue === null) {
          throw new ValidationError(`Expected object, got ${typeToString(newValue)}`);
        }
        let isDifferent = false;
        for (const [key, validator] of Object.entries(config)) {
          const prev = getOwnProperty(knownGoodValue, key);
          const next = getOwnProperty(newValue, key);
          if (Object.is(prev, next)) {
            continue;
          }
          const checked = prefixError(key, () => {
            const validatable = validator;
            if (validatable.validateUsingKnownGoodVersion) {
              return validatable.validateUsingKnownGoodVersion(prev, next);
            } else {
              return validatable.validate(next);
            }
          });
          if (!Object.is(checked, prev)) {
            isDifferent = true;
          }
        }
        if (!shouldAllowUnknownProperties) {
          for (const key of Object.keys(newValue)) {
            if (!hasOwnProperty(config, key)) {
              throw new ValidationError(`Unexpected property`, [key]);
            }
          }
        }
        for (const key of Object.keys(knownGoodValue)) {
          if (!hasOwnProperty(newValue, key)) {
            isDifferent = true;
            break;
          }
        }
        return isDifferent ? newValue : knownGoodValue;
      }
    );
    this.config = config;
    this.shouldAllowUnknownProperties = shouldAllowUnknownProperties;
  }
  allowUnknownProperties() {
    return new _ObjectValidator(this.config, true);
  }
  /**
   * Extend an object validator by adding additional properties.
   *
   * @example
   *
   * ```ts
   * const animalValidator = T.object({
   * 	name: T.string,
   * })
   * const catValidator = animalValidator.extend({
   * 	meowVolume: T.number,
   * })
   * ```
   */
  extend(extension) {
    return new _ObjectValidator({ ...this.config, ...extension });
  }
};
var UnionValidator = class _UnionValidator extends Validator {
  constructor(key, config, unknownValueValidation, useNumberKeys) {
    super(
      (input) => {
        this.expectObject(input);
        const { matchingSchema, variant } = this.getMatchingSchemaAndVariant(input);
        if (matchingSchema === void 0) {
          return this.unknownValueValidation(input, variant);
        }
        return prefixError(`(${key} = ${variant})`, () => matchingSchema.validate(input));
      },
      (prevValue, newValue) => {
        this.expectObject(newValue);
        this.expectObject(prevValue);
        const { matchingSchema, variant } = this.getMatchingSchemaAndVariant(newValue);
        if (matchingSchema === void 0) {
          return this.unknownValueValidation(newValue, variant);
        }
        if (getOwnProperty(prevValue, key) !== getOwnProperty(newValue, key)) {
          return prefixError(`(${key} = ${variant})`, () => matchingSchema.validate(newValue));
        }
        return prefixError(`(${key} = ${variant})`, () => {
          if (matchingSchema.validateUsingKnownGoodVersion) {
            return matchingSchema.validateUsingKnownGoodVersion(prevValue, newValue);
          } else {
            return matchingSchema.validate(newValue);
          }
        });
      }
    );
    this.key = key;
    this.config = config;
    this.unknownValueValidation = unknownValueValidation;
    this.useNumberKeys = useNumberKeys;
  }
  expectObject(value) {
    if (typeof value !== "object" || value === null) {
      throw new ValidationError(`Expected an object, got ${typeToString(value)}`, []);
    }
  }
  getMatchingSchemaAndVariant(object2) {
    const variant = getOwnProperty(object2, this.key);
    if (!this.useNumberKeys && typeof variant !== "string") {
      throw new ValidationError(
        `Expected a string for key "${this.key}", got ${typeToString(variant)}`
      );
    } else if (this.useNumberKeys && !Number.isFinite(Number(variant))) {
      throw new ValidationError(`Expected a number for key "${this.key}", got "${variant}"`);
    }
    const matchingSchema = hasOwnProperty(this.config, variant) ? this.config[variant] : void 0;
    return { matchingSchema, variant };
  }
  validateUnknownVariants(unknownValueValidation) {
    return new _UnionValidator(this.key, this.config, unknownValueValidation, this.useNumberKeys);
  }
};
var DictValidator = class extends Validator {
  constructor(keyValidator, valueValidator) {
    super(
      (object2) => {
        if (typeof object2 !== "object" || object2 === null) {
          throw new ValidationError(`Expected object, got ${typeToString(object2)}`);
        }
        for (const [key, value] of Object.entries(object2)) {
          prefixError(key, () => {
            keyValidator.validate(key);
            valueValidator.validate(value);
          });
        }
        return object2;
      },
      (knownGoodValue, newValue) => {
        if (typeof newValue !== "object" || newValue === null) {
          throw new ValidationError(`Expected object, got ${typeToString(newValue)}`);
        }
        let isDifferent = false;
        for (const [key, value] of Object.entries(newValue)) {
          if (!hasOwnProperty(knownGoodValue, key)) {
            isDifferent = true;
            prefixError(key, () => {
              keyValidator.validate(key);
              valueValidator.validate(value);
            });
            continue;
          }
          const prev = getOwnProperty(knownGoodValue, key);
          const next = value;
          if (Object.is(prev, next)) {
            continue;
          }
          const checked = prefixError(key, () => {
            if (valueValidator.validateUsingKnownGoodVersion) {
              return valueValidator.validateUsingKnownGoodVersion(prev, next);
            } else {
              return valueValidator.validate(next);
            }
          });
          if (!Object.is(checked, prev)) {
            isDifferent = true;
          }
        }
        for (const key of Object.keys(knownGoodValue)) {
          if (!hasOwnProperty(newValue, key)) {
            isDifferent = true;
            break;
          }
        }
        return isDifferent ? newValue : knownGoodValue;
      }
    );
    this.keyValidator = keyValidator;
    this.valueValidator = valueValidator;
  }
};
function typeofValidator(type) {
  return new Validator((value) => {
    if (typeof value !== type) {
      throw new ValidationError(`Expected ${type}, got ${typeToString(value)}`);
    }
    return value;
  });
}
var unknown = new Validator((value) => value);
var any = new Validator((value) => value);
var string = typeofValidator("string");
var number = typeofValidator("number").check((number2) => {
  if (Number.isNaN(number2)) {
    throw new ValidationError("Expected a number, got NaN");
  }
  if (!Number.isFinite(number2)) {
    throw new ValidationError(`Expected a finite number, got ${number2}`);
  }
});
var positiveNumber = number.check((value) => {
  if (value < 0) throw new ValidationError(`Expected a positive number, got ${value}`);
});
var nonZeroNumber = number.check((value) => {
  if (value <= 0) throw new ValidationError(`Expected a non-zero positive number, got ${value}`);
});
var integer = number.check((value) => {
  if (!Number.isInteger(value)) throw new ValidationError(`Expected an integer, got ${value}`);
});
var positiveInteger = integer.check((value) => {
  if (value < 0) throw new ValidationError(`Expected a positive integer, got ${value}`);
});
var nonZeroInteger = integer.check((value) => {
  if (value <= 0) throw new ValidationError(`Expected a non-zero positive integer, got ${value}`);
});
var boolean = typeofValidator("boolean");
var bigint = typeofValidator("bigint");
function literal(expectedValue) {
  return new Validator((actualValue) => {
    if (actualValue !== expectedValue) {
      throw new ValidationError(`Expected ${expectedValue}, got ${JSON.stringify(actualValue)}`);
    }
    return expectedValue;
  });
}
var array = new Validator((value) => {
  if (!Array.isArray(value)) {
    throw new ValidationError(`Expected an array, got ${typeToString(value)}`);
  }
  return value;
});
function arrayOf(itemValidator) {
  return new ArrayOfValidator(itemValidator);
}
var unknownObject = new Validator((value) => {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`Expected object, got ${typeToString(value)}`);
  }
  return value;
});
function object(config) {
  return new ObjectValidator(config);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === STRUCTURED_CLONE_OBJECT_PROTOTYPE);
}
function isValidJson(value) {
  if (value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isValidJson);
  }
  if (isPlainObject(value)) {
    return Object.values(value).every(isValidJson);
  }
  return false;
}
var jsonValue = new Validator(
  (value) => {
    if (isValidJson(value)) {
      return value;
    }
    throw new ValidationError(`Expected json serializable value, got ${typeof value}`);
  },
  (knownGoodValue, newValue) => {
    if (Array.isArray(knownGoodValue) && Array.isArray(newValue)) {
      let isDifferent = knownGoodValue.length !== newValue.length;
      for (let i = 0; i < newValue.length; i++) {
        if (i >= knownGoodValue.length) {
          isDifferent = true;
          jsonValue.validate(newValue[i]);
          continue;
        }
        const prev = knownGoodValue[i];
        const next = newValue[i];
        if (Object.is(prev, next)) {
          continue;
        }
        const checked = jsonValue.validateUsingKnownGoodVersion(prev, next);
        if (!Object.is(checked, prev)) {
          isDifferent = true;
        }
      }
      return isDifferent ? newValue : knownGoodValue;
    } else if (isPlainObject(knownGoodValue) && isPlainObject(newValue)) {
      let isDifferent = false;
      for (const key of Object.keys(newValue)) {
        if (!hasOwnProperty(knownGoodValue, key)) {
          isDifferent = true;
          jsonValue.validate(newValue[key]);
          continue;
        }
        const prev = knownGoodValue[key];
        const next = newValue[key];
        if (Object.is(prev, next)) {
          continue;
        }
        const checked = jsonValue.validateUsingKnownGoodVersion(prev, next);
        if (!Object.is(checked, prev)) {
          isDifferent = true;
        }
      }
      for (const key of Object.keys(knownGoodValue)) {
        if (!hasOwnProperty(newValue, key)) {
          isDifferent = true;
          break;
        }
      }
      return isDifferent ? newValue : knownGoodValue;
    } else {
      return jsonValue.validate(newValue);
    }
  }
);
function jsonDict() {
  return dict(string, jsonValue);
}
function dict(keyValidator, valueValidator) {
  return new DictValidator(keyValidator, valueValidator);
}
function union(key, config) {
  return new UnionValidator(
    key,
    config,
    (_unknownValue, unknownVariant) => {
      throw new ValidationError(
        `Expected one of ${Object.keys(config).map((key2) => JSON.stringify(key2)).join(" or ")}, got ${JSON.stringify(unknownVariant)}`,
        [key]
      );
    },
    false
  );
}
function numberUnion(key, config) {
  return new UnionValidator(
    key,
    config,
    (unknownValue, unknownVariant) => {
      throw new ValidationError(
        `Expected one of ${Object.keys(config).map((key2) => JSON.stringify(key2)).join(" or ")}, got ${JSON.stringify(unknownVariant)}`,
        [key]
      );
    },
    true
  );
}
function model(name, validator) {
  return new Validator(
    (value) => {
      return prefixError(name, () => validator.validate(value));
    },
    (prevValue, newValue) => {
      return prefixError(name, () => {
        if (validator.validateUsingKnownGoodVersion) {
          return validator.validateUsingKnownGoodVersion(prevValue, newValue);
        } else {
          return validator.validate(newValue);
        }
      });
    }
  );
}
function setEnum(values) {
  return new Validator((value) => {
    if (!values.has(value)) {
      const valuesString = Array.from(values, (value2) => JSON.stringify(value2)).join(" or ");
      throw new ValidationError(`Expected ${valuesString}, got ${value}`);
    }
    return value;
  });
}
function optional(validator) {
  return new Validator(
    (value) => {
      if (value === void 0) return void 0;
      return validator.validate(value);
    },
    (knownGoodValue, newValue) => {
      if (knownGoodValue === void 0 && newValue === void 0) return void 0;
      if (newValue === void 0) return void 0;
      if (validator.validateUsingKnownGoodVersion && knownGoodValue !== void 0) {
        return validator.validateUsingKnownGoodVersion(knownGoodValue, newValue);
      }
      return validator.validate(newValue);
    }
  );
}
function nullable(validator) {
  return new Validator(
    (value) => {
      if (value === null) return null;
      return validator.validate(value);
    },
    (knownGoodValue, newValue) => {
      if (newValue === null) return null;
      if (validator.validateUsingKnownGoodVersion && knownGoodValue !== null) {
        return validator.validateUsingKnownGoodVersion(knownGoodValue, newValue);
      }
      return validator.validate(newValue);
    }
  );
}
function literalEnum(...values) {
  return setEnum(new Set(values));
}
function parseUrl(str) {
  try {
    return new URL(str);
  } catch {
    if (str.startsWith("/") || str.startsWith("./")) {
      try {
        return new URL(str, "http://example.com");
      } catch {
        throw new ValidationError(`Expected a valid url, got ${JSON.stringify(str)}`);
      }
    }
    throw new ValidationError(`Expected a valid url, got ${JSON.stringify(str)}`);
  }
}
var validLinkProtocols = /* @__PURE__ */ new Set(["http:", "https:", "mailto:"]);
var linkUrl = string.check((value) => {
  if (value === "") return;
  const url = parseUrl(value);
  if (!validLinkProtocols.has(url.protocol.toLowerCase())) {
    throw new ValidationError(
      `Expected a valid url, got ${JSON.stringify(value)} (invalid protocol)`
    );
  }
});
var validSrcProtocols = /* @__PURE__ */ new Set(["http:", "https:", "data:", "asset:"]);
var srcUrl = string.check((value) => {
  if (value === "") return;
  const url = parseUrl(value);
  if (!validSrcProtocols.has(url.protocol.toLowerCase())) {
    throw new ValidationError(
      `Expected a valid url, got ${JSON.stringify(value)} (invalid protocol)`
    );
  }
});
var httpUrl = string.check((value) => {
  if (value === "") return;
  const url = parseUrl(value);
  if (!url.protocol.toLowerCase().match(/^https?:$/)) {
    throw new ValidationError(
      `Expected a valid url, got ${JSON.stringify(value)} (invalid protocol)`
    );
  }
});
var indexKey = string.refine((key) => {
  try {
    validateIndexKey(key);
    return key;
  } catch {
    throw new ValidationError(`Expected an index key, got ${JSON.stringify(key)}`);
  }
});
function or(v1, v2) {
  return new Validator((value) => {
    try {
      return v1.validate(value);
    } catch {
      return v2.validate(value);
    }
  });
}

// node_modules/@tldraw/validate/dist-esm/index.mjs
registerTldrawLibraryVersion(
  "@tldraw/validate",
  "3.15.6",
  "esm"
);

// node_modules/@tldraw/tlschema/dist-esm/misc/id-validator.mjs
function idValidator(prefix) {
  return validation_exports.string.refine((id) => {
    if (!id.startsWith(`${prefix}:`)) {
      throw new Error(`${prefix} ID must start with "${prefix}:"`);
    }
    return id;
  });
}

// node_modules/@tldraw/tlschema/dist-esm/assets/TLBaseAsset.mjs
var assetIdValidator = idValidator("asset");
function createAssetValidator(type, props) {
  return validation_exports.object({
    id: assetIdValidator,
    typeName: validation_exports.literal("asset"),
    type: validation_exports.literal(type),
    props,
    meta: validation_exports.jsonValue
  });
}

// node_modules/@tldraw/tlschema/dist-esm/misc/geometry-types.mjs
var vecModelValidator = validation_exports.object({
  x: validation_exports.number,
  y: validation_exports.number,
  z: validation_exports.number.optional()
});
var boxModelValidator = validation_exports.object({
  x: validation_exports.number,
  y: validation_exports.number,
  w: validation_exports.number,
  h: validation_exports.number
});

// node_modules/@tldraw/state/dist-esm/lib/helpers.mjs
function isChild(x) {
  return x && typeof x === "object" && "parents" in x;
}
function haveParentsChanged(child) {
  for (let i = 0, n = child.parents.length; i < n; i++) {
    child.parents[i].__unsafe__getWithoutCapture(true);
    if (child.parents[i].lastChangedEpoch !== child.parentEpochs[i]) {
      return true;
    }
  }
  return false;
}
function detach(parent, child) {
  if (!parent.children.remove(child)) {
    return;
  }
  if (parent.children.isEmpty && isChild(parent)) {
    for (let i = 0, n = parent.parents.length; i < n; i++) {
      detach(parent.parents[i], parent);
    }
  }
}
function attach(parent, child) {
  if (!parent.children.add(child)) {
    return;
  }
  if (isChild(parent)) {
    for (let i = 0, n = parent.parents.length; i < n; i++) {
      attach(parent.parents[i], parent);
    }
  }
}
function equals(a, b) {
  const shallowEquals = a === b || Object.is(a, b) || Boolean(a && b && typeof a.equals === "function" && a.equals(b));
  return shallowEquals;
}
function singleton(key, init) {
  const symbol = /* @__PURE__ */ Symbol.for(`com.tldraw.state/${key}`);
  const global2 = globalThis;
  global2[symbol] ??= init();
  return global2[symbol];
}
var EMPTY_ARRAY = singleton("empty_array", () => Object.freeze([]));

// node_modules/@tldraw/state/dist-esm/lib/ArraySet.mjs
var ARRAY_SIZE_THRESHOLD = 8;
var ArraySet = class {
  arraySize = 0;
  array = Array(ARRAY_SIZE_THRESHOLD);
  set = null;
  /**
   * Get whether this ArraySet has any elements.
   *
   * @returns True if this ArraySet has any elements, false otherwise.
   */
  // eslint-disable-next-line no-restricted-syntax
  get isEmpty() {
    if (this.array) {
      return this.arraySize === 0;
    }
    if (this.set) {
      return this.set.size === 0;
    }
    throw new Error("no set or array");
  }
  /**
   * Add an item to the ArraySet if it is not already present.
   *
   * @param elem - The element to add.
   */
  add(elem) {
    if (this.array) {
      const idx = this.array.indexOf(elem);
      if (idx !== -1) {
        return false;
      }
      if (this.arraySize < ARRAY_SIZE_THRESHOLD) {
        this.array[this.arraySize] = elem;
        this.arraySize++;
        return true;
      } else {
        this.set = new Set(this.array);
        this.array = null;
        this.set.add(elem);
        return true;
      }
    }
    if (this.set) {
      if (this.set.has(elem)) {
        return false;
      }
      this.set.add(elem);
      return true;
    }
    throw new Error("no set or array");
  }
  /**
   * Remove an item from the ArraySet if it is present.
   *
   * @param elem - The element to remove
   */
  remove(elem) {
    if (this.array) {
      const idx = this.array.indexOf(elem);
      if (idx === -1) {
        return false;
      }
      this.array[idx] = void 0;
      this.arraySize--;
      if (idx !== this.arraySize) {
        this.array[idx] = this.array[this.arraySize];
        this.array[this.arraySize] = void 0;
      }
      return true;
    }
    if (this.set) {
      if (!this.set.has(elem)) {
        return false;
      }
      this.set.delete(elem);
      return true;
    }
    throw new Error("no set or array");
  }
  /**
   * Run a callback for each element in the ArraySet.
   *
   * @param visitor - The callback to run for each element.
   */
  visit(visitor) {
    if (this.array) {
      for (let i = 0; i < this.arraySize; i++) {
        const elem = this.array[i];
        if (typeof elem !== "undefined") {
          visitor(elem);
        }
      }
      return;
    }
    if (this.set) {
      this.set.forEach(visitor);
      return;
    }
    throw new Error("no set or array");
  }
  *[Symbol.iterator]() {
    if (this.array) {
      for (let i = 0; i < this.arraySize; i++) {
        const elem = this.array[i];
        if (typeof elem !== "undefined") {
          yield elem;
        }
      }
    } else if (this.set) {
      yield* this.set;
    } else {
      throw new Error("no set or array");
    }
  }
  has(elem) {
    if (this.array) {
      return this.array.indexOf(elem) !== -1;
    } else {
      return this.set.has(elem);
    }
  }
  clear() {
    if (this.set) {
      this.set.clear();
    } else {
      this.arraySize = 0;
      this.array = [];
    }
  }
  size() {
    if (this.set) {
      return this.set.size;
    } else {
      return this.arraySize;
    }
  }
};

// node_modules/@tldraw/state/dist-esm/lib/types.mjs
var RESET_VALUE = /* @__PURE__ */ Symbol.for("com.tldraw.state/RESET_VALUE");

// node_modules/@tldraw/state/dist-esm/lib/HistoryBuffer.mjs
var HistoryBuffer = class {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }
  index = 0;
  // use a wrap around buffer to store the last N values
  buffer;
  /**
   * Add a diff to the history buffer.
   *
   * @param lastComputedEpoch - The epoch when the diff was computed.
   * @param currentEpoch - The current epoch.
   * @param diff - The diff to add, or else a reset value.
   */
  pushEntry(lastComputedEpoch, currentEpoch, diff) {
    if (diff === void 0) {
      return;
    }
    if (diff === RESET_VALUE) {
      this.clear();
      return;
    }
    this.buffer[this.index] = [lastComputedEpoch, currentEpoch, diff];
    this.index = (this.index + 1) % this.capacity;
  }
  /**
   * Clear the history buffer.
   */
  clear() {
    this.index = 0;
    this.buffer.fill(void 0);
  }
  /**
   * Get the diffs since the given epoch.
   *
   * @param sinceEpoch - The epoch to get diffs since.
   * @returns An array of diffs or a flag to reset the history buffer.
   */
  getChangesSince(sinceEpoch) {
    const { index, capacity, buffer } = this;
    for (let i = 0; i < capacity; i++) {
      const offset = (index - 1 + capacity - i) % capacity;
      const elem = buffer[offset];
      if (!elem) {
        return RESET_VALUE;
      }
      const [fromEpoch, toEpoch] = elem;
      if (i === 0 && sinceEpoch >= toEpoch) {
        return [];
      }
      if (fromEpoch <= sinceEpoch && sinceEpoch < toEpoch) {
        const len = i + 1;
        const result = new Array(len);
        for (let j = 0; j < len; j++) {
          result[j] = buffer[(offset + j) % capacity][2];
        }
        return result;
      }
    }
    return RESET_VALUE;
  }
};

// node_modules/@tldraw/state/dist-esm/lib/constants.mjs
var GLOBAL_START_EPOCH = -1;

// node_modules/@tldraw/state/dist-esm/lib/EffectScheduler.mjs
var __EffectScheduler__ = class {
  constructor(name, runEffect, options) {
    this.name = name;
    this.runEffect = runEffect;
    this._scheduleEffect = options?.scheduleEffect;
  }
  _isActivelyListening = false;
  /**
   * Whether this scheduler is attached and actively listening to its parents.
   * @public
   */
  // eslint-disable-next-line no-restricted-syntax
  get isActivelyListening() {
    return this._isActivelyListening;
  }
  /** @internal */
  lastTraversedEpoch = GLOBAL_START_EPOCH;
  lastReactedEpoch = GLOBAL_START_EPOCH;
  _scheduleCount = 0;
  __debug_ancestor_epochs__ = null;
  /**
   * The number of times this effect has been scheduled.
   * @public
   */
  // eslint-disable-next-line no-restricted-syntax
  get scheduleCount() {
    return this._scheduleCount;
  }
  /** @internal */
  parentSet = new ArraySet();
  /** @internal */
  parentEpochs = [];
  /** @internal */
  parents = [];
  _scheduleEffect;
  /** @internal */
  maybeScheduleEffect() {
    if (!this._isActivelyListening) return;
    if (this.lastReactedEpoch === getGlobalEpoch()) return;
    if (this.parents.length && !haveParentsChanged(this)) {
      this.lastReactedEpoch = getGlobalEpoch();
      return;
    }
    this.scheduleEffect();
  }
  /** @internal */
  scheduleEffect() {
    this._scheduleCount++;
    if (this._scheduleEffect) {
      this._scheduleEffect(this.maybeExecute);
    } else {
      this.execute();
    }
  }
  /** @internal */
  // eslint-disable-next-line local/prefer-class-methods
  maybeExecute = () => {
    if (!this._isActivelyListening) return;
    this.execute();
  };
  /**
   * Makes this scheduler become 'actively listening' to its parents.
   * If it has been executed before it will immediately become eligible to receive 'maybeScheduleEffect' calls.
   * If it has not executed before it will need to be manually executed once to become eligible for scheduling, i.e. by calling `EffectScheduler.execute`.
   * @public
   */
  attach() {
    this._isActivelyListening = true;
    for (let i = 0, n = this.parents.length; i < n; i++) {
      attach(this.parents[i], this);
    }
  }
  /**
   * Makes this scheduler stop 'actively listening' to its parents.
   * It will no longer be eligible to receive 'maybeScheduleEffect' calls until `EffectScheduler.attach` is called again.
   */
  detach() {
    this._isActivelyListening = false;
    for (let i = 0, n = this.parents.length; i < n; i++) {
      detach(this.parents[i], this);
    }
  }
  /**
   * Executes the effect immediately and returns the result.
   * @returns The result of the effect.
   */
  execute() {
    try {
      startCapturingParents(this);
      const currentEpoch = getGlobalEpoch();
      const result = this.runEffect(this.lastReactedEpoch);
      this.lastReactedEpoch = currentEpoch;
      return result;
    } finally {
      stopCapturingParents();
    }
  }
};
var EffectScheduler = singleton(
  "EffectScheduler",
  () => __EffectScheduler__
);
function react(name, fn, options) {
  const scheduler = new EffectScheduler(name, fn, options);
  scheduler.attach();
  scheduler.scheduleEffect();
  return () => {
    scheduler.detach();
  };
}
function reactor(name, fn, options) {
  const scheduler = new EffectScheduler(name, fn, options);
  return {
    scheduler,
    start: (options2) => {
      const force = options2?.force ?? false;
      scheduler.attach();
      if (force) {
        scheduler.scheduleEffect();
      } else {
        scheduler.maybeScheduleEffect();
      }
    },
    stop: () => {
      scheduler.detach();
    }
  };
}

// node_modules/@tldraw/state/dist-esm/lib/transactions.mjs
var Transaction = class {
  constructor(parent, isSync) {
    this.parent = parent;
    this.isSync = isSync;
  }
  asyncProcessCount = 0;
  initialAtomValues = /* @__PURE__ */ new Map();
  /**
   * Get whether this transaction is a root (no parents).
   *
   * @public
   */
  // eslint-disable-next-line no-restricted-syntax
  get isRoot() {
    return this.parent === null;
  }
  /**
   * Commit the transaction's changes.
   *
   * @public
   */
  commit() {
    if (inst.globalIsReacting) {
      for (const atom2 of this.initialAtomValues.keys()) {
        traverseAtomForCleanup(atom2);
      }
    } else if (this.isRoot) {
      flushChanges(this.initialAtomValues.keys());
    } else {
      this.initialAtomValues.forEach((value, atom2) => {
        if (!this.parent.initialAtomValues.has(atom2)) {
          this.parent.initialAtomValues.set(atom2, value);
        }
      });
    }
  }
  /**
   * Abort the transaction.
   *
   * @public
   */
  abort() {
    inst.globalEpoch++;
    this.initialAtomValues.forEach((value, atom2) => {
      atom2.set(value);
      atom2.historyBuffer?.clear();
    });
    this.commit();
  }
};
var inst = singleton("transactions", () => ({
  // The current epoch (global to all atoms).
  globalEpoch: GLOBAL_START_EPOCH + 1,
  // Whether any transaction is reacting.
  globalIsReacting: false,
  currentTransaction: null,
  cleanupReactors: null,
  reactionEpoch: GLOBAL_START_EPOCH + 1
}));
function getReactionEpoch() {
  return inst.reactionEpoch;
}
function getGlobalEpoch() {
  return inst.globalEpoch;
}
function getIsReacting() {
  return inst.globalIsReacting;
}
function traverse(reactors, child) {
  if (child.lastTraversedEpoch === inst.globalEpoch) {
    return;
  }
  child.lastTraversedEpoch = inst.globalEpoch;
  if (child instanceof EffectScheduler) {
    reactors.add(child);
  } else {
    ;
    child.children.visit((c) => traverse(reactors, c));
  }
}
function flushChanges(atoms) {
  if (inst.globalIsReacting) {
    throw new Error("flushChanges cannot be called during a reaction");
  }
  const outerTxn = inst.currentTransaction;
  try {
    inst.currentTransaction = null;
    inst.globalIsReacting = true;
    inst.reactionEpoch = inst.globalEpoch;
    const reactors = /* @__PURE__ */ new Set();
    for (const atom2 of atoms) {
      atom2.children.visit((child) => traverse(reactors, child));
    }
    for (const r of reactors) {
      r.maybeScheduleEffect();
    }
    let updateDepth = 0;
    while (inst.cleanupReactors?.size) {
      if (updateDepth++ > 1e3) {
        throw new Error("Reaction update depth limit exceeded");
      }
      const reactors2 = inst.cleanupReactors;
      inst.cleanupReactors = null;
      for (const r of reactors2) {
        r.maybeScheduleEffect();
      }
    }
  } finally {
    inst.cleanupReactors = null;
    inst.globalIsReacting = false;
    inst.currentTransaction = outerTxn;
  }
}
function atomDidChange(atom2, previousValue) {
  if (inst.currentTransaction) {
    if (!inst.currentTransaction.initialAtomValues.has(atom2)) {
      inst.currentTransaction.initialAtomValues.set(atom2, previousValue);
    }
  } else if (inst.globalIsReacting) {
    traverseAtomForCleanup(atom2);
  } else {
    flushChanges([atom2]);
  }
}
function traverseAtomForCleanup(atom2) {
  const rs = inst.cleanupReactors ??= /* @__PURE__ */ new Set();
  atom2.children.visit((child) => traverse(rs, child));
}
function advanceGlobalEpoch() {
  inst.globalEpoch++;
}
function transaction(fn) {
  const txn = new Transaction(inst.currentTransaction, true);
  inst.currentTransaction = txn;
  try {
    let result = void 0;
    let rollback = false;
    try {
      result = fn(() => rollback = true);
    } catch (e) {
      txn.abort();
      throw e;
    }
    if (inst.currentTransaction !== txn) {
      throw new Error("Transaction boundaries overlap");
    }
    if (rollback) {
      txn.abort();
    } else {
      txn.commit();
    }
    return result;
  } finally {
    inst.currentTransaction = txn.parent;
  }
}
function transact(fn) {
  if (inst.currentTransaction) {
    return fn();
  }
  return transaction(fn);
}
async function deferAsyncEffects(fn) {
  if (inst.currentTransaction?.isSync) {
    throw new Error("deferAsyncEffects cannot be called during a sync transaction");
  }
  while (inst.globalIsReacting) {
    await new Promise((r) => queueMicrotask(() => r(null)));
  }
  const txn = inst.currentTransaction ?? new Transaction(null, false);
  if (txn.isSync) throw new Error("deferAsyncEffects cannot be called during a sync transaction");
  inst.currentTransaction = txn;
  txn.asyncProcessCount++;
  let result = void 0;
  let error = void 0;
  try {
    result = await fn();
  } catch (e) {
    error = e ?? null;
  }
  if (--txn.asyncProcessCount > 0) {
    if (typeof error !== "undefined") {
      throw error;
    } else {
      return result;
    }
  }
  inst.currentTransaction = null;
  if (typeof error !== "undefined") {
    txn.abort();
    throw error;
  } else {
    txn.commit();
    return result;
  }
}

// node_modules/@tldraw/state/dist-esm/lib/warnings.mjs
var didWarnComputedGetter = false;
function logComputedGetterWarning() {
  if (didWarnComputedGetter) return;
  didWarnComputedGetter = true;
  console.warn(
    `Using \`@computed\` as a decorator for getters is deprecated and will be removed in the near future. Please refactor to use \`@computed\` as a decorator for methods.

// Before
@computed
get foo() {
	return 'foo'
}

// After
@computed
getFoo() {
	return 'foo'
}
`
  );
}

// node_modules/@tldraw/state/dist-esm/lib/Computed.mjs
var UNINITIALIZED = /* @__PURE__ */ Symbol.for("com.tldraw.state/UNINITIALIZED");
function isUninitialized(value) {
  return value === UNINITIALIZED;
}
var WithDiff = singleton(
  "WithDiff",
  () => class WithDiff {
    constructor(value, diff) {
      this.value = value;
      this.diff = diff;
    }
  }
);
function withDiff(value, diff) {
  return new WithDiff(value, diff);
}
var __UNSAFE__Computed = class {
  constructor(name, derive, options) {
    this.name = name;
    this.derive = derive;
    if (options?.historyLength) {
      this.historyBuffer = new HistoryBuffer(options.historyLength);
    }
    this.computeDiff = options?.computeDiff;
    this.isEqual = options?.isEqual ?? equals;
  }
  lastChangedEpoch = GLOBAL_START_EPOCH;
  lastTraversedEpoch = GLOBAL_START_EPOCH;
  __debug_ancestor_epochs__ = null;
  /**
   * The epoch when the reactor was last checked.
   */
  lastCheckedEpoch = GLOBAL_START_EPOCH;
  parentSet = new ArraySet();
  parents = [];
  parentEpochs = [];
  children = new ArraySet();
  // eslint-disable-next-line no-restricted-syntax
  get isActivelyListening() {
    return !this.children.isEmpty;
  }
  historyBuffer;
  // The last-computed value of this signal.
  state = UNINITIALIZED;
  // If the signal throws an error we stash it so we can rethrow it on the next get()
  error = null;
  computeDiff;
  isEqual;
  __unsafe__getWithoutCapture(ignoreErrors) {
    const isNew = this.lastChangedEpoch === GLOBAL_START_EPOCH;
    const globalEpoch = getGlobalEpoch();
    if (!isNew && (this.lastCheckedEpoch === globalEpoch || this.isActivelyListening && getIsReacting() && this.lastTraversedEpoch < getReactionEpoch() || !haveParentsChanged(this))) {
      this.lastCheckedEpoch = globalEpoch;
      if (this.error) {
        if (!ignoreErrors) {
          throw this.error.thrownValue;
        } else {
          return this.state;
        }
      } else {
        return this.state;
      }
    }
    try {
      startCapturingParents(this);
      const result = this.derive(this.state, this.lastCheckedEpoch);
      const newState = result instanceof WithDiff ? result.value : result;
      const isUninitialized2 = this.state === UNINITIALIZED;
      if (isUninitialized2 || !this.isEqual(newState, this.state)) {
        if (this.historyBuffer && !isUninitialized2) {
          const diff = result instanceof WithDiff ? result.diff : void 0;
          this.historyBuffer.pushEntry(
            this.lastChangedEpoch,
            getGlobalEpoch(),
            diff ?? this.computeDiff?.(this.state, newState, this.lastCheckedEpoch, getGlobalEpoch()) ?? RESET_VALUE
          );
        }
        this.lastChangedEpoch = getGlobalEpoch();
        this.state = newState;
      }
      this.error = null;
      this.lastCheckedEpoch = getGlobalEpoch();
      return this.state;
    } catch (e) {
      if (this.state !== UNINITIALIZED) {
        this.state = UNINITIALIZED;
        this.lastChangedEpoch = getGlobalEpoch();
      }
      this.lastCheckedEpoch = getGlobalEpoch();
      if (this.historyBuffer) {
        this.historyBuffer.clear();
      }
      this.error = { thrownValue: e };
      if (!ignoreErrors) throw e;
      return this.state;
    } finally {
      stopCapturingParents();
    }
  }
  get() {
    try {
      return this.__unsafe__getWithoutCapture();
    } finally {
      maybeCaptureParent(this);
    }
  }
  getDiffSince(epoch) {
    this.__unsafe__getWithoutCapture(true);
    maybeCaptureParent(this);
    if (epoch >= this.lastChangedEpoch) {
      return EMPTY_ARRAY;
    }
    return this.historyBuffer?.getChangesSince(epoch) ?? RESET_VALUE;
  }
};
var _Computed = singleton("Computed", () => __UNSAFE__Computed);
function computedMethodLegacyDecorator(options = {}, _target, key, descriptor) {
  const originalMethod = descriptor.value;
  const derivationKey = /* @__PURE__ */ Symbol.for("__@tldraw/state__computed__" + key);
  descriptor.value = function() {
    let d = this[derivationKey];
    if (!d) {
      d = new _Computed(key, originalMethod.bind(this), options);
      Object.defineProperty(this, derivationKey, {
        enumerable: false,
        configurable: false,
        writable: false,
        value: d
      });
    }
    return d.get();
  };
  descriptor.value[isComputedMethodKey] = true;
  return descriptor;
}
function computedGetterLegacyDecorator(options = {}, _target, key, descriptor) {
  const originalMethod = descriptor.get;
  const derivationKey = /* @__PURE__ */ Symbol.for("__@tldraw/state__computed__" + key);
  descriptor.get = function() {
    let d = this[derivationKey];
    if (!d) {
      d = new _Computed(key, originalMethod.bind(this), options);
      Object.defineProperty(this, derivationKey, {
        enumerable: false,
        configurable: false,
        writable: false,
        value: d
      });
    }
    return d.get();
  };
  return descriptor;
}
function computedMethodTc39Decorator(options, compute, context) {
  assert(context.kind === "method", "@computed can only be used on methods");
  const derivationKey = /* @__PURE__ */ Symbol.for("__@tldraw/state__computed__" + String(context.name));
  const fn = function() {
    let d = this[derivationKey];
    if (!d) {
      d = new _Computed(String(context.name), compute.bind(this), options);
      Object.defineProperty(this, derivationKey, {
        enumerable: false,
        configurable: false,
        writable: false,
        value: d
      });
    }
    return d.get();
  };
  fn[isComputedMethodKey] = true;
  return fn;
}
function computedDecorator(options = {}, args) {
  if (args.length === 2) {
    const [originalMethod, context] = args;
    return computedMethodTc39Decorator(options, originalMethod, context);
  } else {
    const [_target, key, descriptor] = args;
    if (descriptor.get) {
      logComputedGetterWarning();
      return computedGetterLegacyDecorator(options, _target, key, descriptor);
    } else {
      return computedMethodLegacyDecorator(options, _target, key, descriptor);
    }
  }
}
var isComputedMethodKey = "@@__isComputedMethod__@@";
function getComputedInstance(obj, propertyName) {
  const key = /* @__PURE__ */ Symbol.for("__@tldraw/state__computed__" + propertyName.toString());
  let inst3 = obj[key];
  if (!inst3) {
    const val = obj[propertyName];
    if (typeof val === "function" && val[isComputedMethodKey]) {
      val.call(obj);
    }
    inst3 = obj[key];
  }
  return inst3;
}
function computed() {
  if (arguments.length === 1) {
    const options = arguments[0];
    return (...args) => computedDecorator(options, args);
  } else if (typeof arguments[0] === "string") {
    return new _Computed(arguments[0], arguments[1], arguments[2]);
  } else {
    return computedDecorator(void 0, arguments);
  }
}
function isComputed(value) {
  return value && value instanceof _Computed;
}

// node_modules/@tldraw/state/dist-esm/lib/capture.mjs
var CaptureStackFrame = class {
  constructor(below, child) {
    this.below = below;
    this.child = child;
  }
  offset = 0;
  maybeRemoved;
};
var inst2 = singleton("capture", () => ({ stack: null }));
function unsafe__withoutCapture(fn) {
  const oldStack = inst2.stack;
  inst2.stack = null;
  try {
    return fn();
  } finally {
    inst2.stack = oldStack;
  }
}
function startCapturingParents(child) {
  inst2.stack = new CaptureStackFrame(inst2.stack, child);
  if (child.__debug_ancestor_epochs__) {
    const previousAncestorEpochs = child.__debug_ancestor_epochs__;
    child.__debug_ancestor_epochs__ = null;
    for (const p of child.parents) {
      p.__unsafe__getWithoutCapture(true);
    }
    logChangedAncestors(child, previousAncestorEpochs);
  }
  child.parentSet.clear();
}
function stopCapturingParents() {
  const frame = inst2.stack;
  inst2.stack = frame.below;
  if (frame.offset < frame.child.parents.length) {
    for (let i = frame.offset; i < frame.child.parents.length; i++) {
      const maybeRemovedParent = frame.child.parents[i];
      if (!frame.child.parentSet.has(maybeRemovedParent)) {
        detach(maybeRemovedParent, frame.child);
      }
    }
    frame.child.parents.length = frame.offset;
    frame.child.parentEpochs.length = frame.offset;
  }
  if (frame.maybeRemoved) {
    for (let i = 0; i < frame.maybeRemoved.length; i++) {
      const maybeRemovedParent = frame.maybeRemoved[i];
      if (!frame.child.parentSet.has(maybeRemovedParent)) {
        detach(maybeRemovedParent, frame.child);
      }
    }
  }
  if (frame.child.__debug_ancestor_epochs__) {
    captureAncestorEpochs(frame.child, frame.child.__debug_ancestor_epochs__);
  }
}
function maybeCaptureParent(p) {
  if (inst2.stack) {
    const wasCapturedAlready = inst2.stack.child.parentSet.has(p);
    if (wasCapturedAlready) {
      return;
    }
    inst2.stack.child.parentSet.add(p);
    if (inst2.stack.child.isActivelyListening) {
      attach(p, inst2.stack.child);
    }
    if (inst2.stack.offset < inst2.stack.child.parents.length) {
      const maybeRemovedParent = inst2.stack.child.parents[inst2.stack.offset];
      if (maybeRemovedParent !== p) {
        if (!inst2.stack.maybeRemoved) {
          inst2.stack.maybeRemoved = [maybeRemovedParent];
        } else {
          inst2.stack.maybeRemoved.push(maybeRemovedParent);
        }
      }
    }
    inst2.stack.child.parents[inst2.stack.offset] = p;
    inst2.stack.child.parentEpochs[inst2.stack.offset] = p.lastChangedEpoch;
    inst2.stack.offset++;
  }
}
function whyAmIRunning() {
  const child = inst2.stack?.child;
  if (!child) {
    throw new Error("whyAmIRunning() called outside of a reactive context");
  }
  child.__debug_ancestor_epochs__ = /* @__PURE__ */ new Map();
}
function captureAncestorEpochs(child, ancestorEpochs) {
  for (let i = 0; i < child.parents.length; i++) {
    const parent = child.parents[i];
    const epoch = child.parentEpochs[i];
    ancestorEpochs.set(parent, epoch);
    if (isComputed(parent)) {
      captureAncestorEpochs(parent, ancestorEpochs);
    }
  }
  return ancestorEpochs;
}
function collectChangedAncestors(child, ancestorEpochs) {
  const changeTree = {};
  for (let i = 0; i < child.parents.length; i++) {
    const parent = child.parents[i];
    if (!ancestorEpochs.has(parent)) {
      continue;
    }
    const prevEpoch = ancestorEpochs.get(parent);
    const currentEpoch = parent.lastChangedEpoch;
    if (currentEpoch !== prevEpoch) {
      if (isComputed(parent)) {
        changeTree[parent.name] = collectChangedAncestors(parent, ancestorEpochs);
      } else {
        changeTree[parent.name] = null;
      }
    }
  }
  return changeTree;
}
function logChangedAncestors(child, ancestorEpochs) {
  const changeTree = collectChangedAncestors(child, ancestorEpochs);
  if (Object.keys(changeTree).length === 0) {
    console.log(`Effect(${child.name}) was executed manually.`);
    return;
  }
  let str = isComputed(child) ? `Computed(${child.name}) is recomputing because:` : `Effect(${child.name}) is executing because:`;
  function logParent(tree, indent) {
    const indentStr = "\n" + " ".repeat(indent) + "↳ ";
    for (const [name, val] of Object.entries(tree)) {
      if (val) {
        str += `${indentStr}Computed(${name}) changed`;
        logParent(val, indent + 2);
      } else {
        str += `${indentStr}Atom(${name}) changed`;
      }
    }
  }
  logParent(changeTree, 1);
  console.log(str);
}

// node_modules/@tldraw/state/dist-esm/lib/Atom.mjs
var __Atom__ = class {
  constructor(name, current, options) {
    this.name = name;
    this.current = current;
    this.isEqual = options?.isEqual ?? null;
    if (!options) return;
    if (options.historyLength) {
      this.historyBuffer = new HistoryBuffer(options.historyLength);
    }
    this.computeDiff = options.computeDiff;
  }
  isEqual;
  computeDiff;
  lastChangedEpoch = getGlobalEpoch();
  children = new ArraySet();
  historyBuffer;
  __unsafe__getWithoutCapture(_ignoreErrors) {
    return this.current;
  }
  get() {
    maybeCaptureParent(this);
    return this.current;
  }
  set(value, diff) {
    if (this.isEqual?.(this.current, value) ?? equals(this.current, value)) {
      return this.current;
    }
    advanceGlobalEpoch();
    if (this.historyBuffer) {
      this.historyBuffer.pushEntry(
        this.lastChangedEpoch,
        getGlobalEpoch(),
        diff ?? this.computeDiff?.(this.current, value, this.lastChangedEpoch, getGlobalEpoch()) ?? RESET_VALUE
      );
    }
    this.lastChangedEpoch = getGlobalEpoch();
    const oldValue = this.current;
    this.current = value;
    atomDidChange(this, oldValue);
    return value;
  }
  update(updater) {
    return this.set(updater(this.current));
  }
  getDiffSince(epoch) {
    maybeCaptureParent(this);
    if (epoch >= this.lastChangedEpoch) {
      return EMPTY_ARRAY;
    }
    return this.historyBuffer?.getChangesSince(epoch) ?? RESET_VALUE;
  }
};
var _Atom = singleton("Atom", () => __Atom__);
function atom(name, initialValue, options) {
  return new _Atom(name, initialValue, options);
}
function isAtom(value) {
  return value instanceof _Atom;
}

// node_modules/@tldraw/state/dist-esm/lib/isSignal.mjs
function isSignal(value) {
  return value instanceof _Atom || value instanceof _Computed;
}

// node_modules/@tldraw/state/dist-esm/index.mjs
var currentApiVersion = 1;
var actualApiVersion = singleton("apiVersion", () => currentApiVersion);
if (actualApiVersion !== currentApiVersion) {
  throw new Error(
    `You have multiple incompatible versions of @tldraw/state in your app. Please deduplicate the package.`
  );
}
registerTldrawLibraryVersion(
  "@tldraw/state",
  "3.15.6",
  "esm"
);

// node_modules/@tldraw/store/dist-esm/lib/ImmutableMap.mjs
function smi(i32) {
  return i32 >>> 1 & 1073741824 | i32 & 3221225471;
}
var defaultValueOf = Object.prototype.valueOf;
function hash(o) {
  if (o == null) {
    return hashNullish(o);
  }
  if (typeof o.hashCode === "function") {
    return smi(o.hashCode(o));
  }
  const v = valueOf(o);
  if (v == null) {
    return hashNullish(v);
  }
  switch (typeof v) {
    case "boolean":
      return v ? 1108378657 : 1108378656;
    case "number":
      return hashNumber(v);
    case "string":
      return v.length > STRING_HASH_CACHE_MIN_STRLEN ? cachedHashString(v) : hashString(v);
    case "object":
    case "function":
      return hashJSObj(v);
    case "symbol":
      return hashSymbol(v);
    default:
      if (typeof v.toString === "function") {
        return hashString(v.toString());
      }
      throw new Error("Value type " + typeof v + " cannot be hashed.");
  }
}
function hashNullish(nullish) {
  return nullish === null ? 1108378658 : (
    /* undefined */
    1108378659
  );
}
function hashNumber(n) {
  if (n !== n || n === Infinity) {
    return 0;
  }
  let hash2 = n | 0;
  if (hash2 !== n) {
    hash2 ^= n * 4294967295;
  }
  while (n > 4294967295) {
    n /= 4294967295;
    hash2 ^= n;
  }
  return smi(hash2);
}
function cachedHashString(string2) {
  let hashed = stringHashCache[string2];
  if (hashed === void 0) {
    hashed = hashString(string2);
    if (STRING_HASH_CACHE_SIZE === STRING_HASH_CACHE_MAX_SIZE) {
      STRING_HASH_CACHE_SIZE = 0;
      stringHashCache = {};
    }
    STRING_HASH_CACHE_SIZE++;
    stringHashCache[string2] = hashed;
  }
  return hashed;
}
function hashString(string2) {
  let hashed = 0;
  for (let ii = 0; ii < string2.length; ii++) {
    hashed = 31 * hashed + string2.charCodeAt(ii) | 0;
  }
  return smi(hashed);
}
function hashSymbol(sym) {
  let hashed = symbolMap[sym];
  if (hashed !== void 0) {
    return hashed;
  }
  hashed = nextHash();
  symbolMap[sym] = hashed;
  return hashed;
}
function hashJSObj(obj) {
  let hashed = weakMap.get(obj);
  if (hashed !== void 0) {
    return hashed;
  }
  hashed = nextHash();
  weakMap.set(obj, hashed);
  return hashed;
}
function valueOf(obj) {
  return obj.valueOf !== defaultValueOf && typeof obj.valueOf === "function" ? obj.valueOf(obj) : obj;
}
function nextHash() {
  const nextHash2 = ++_objHashUID;
  if (_objHashUID & 1073741824) {
    _objHashUID = 0;
  }
  return nextHash2;
}
var weakMap = /* @__PURE__ */ new WeakMap();
var symbolMap = /* @__PURE__ */ Object.create(null);
var _objHashUID = 0;
var STRING_HASH_CACHE_MIN_STRLEN = 16;
var STRING_HASH_CACHE_MAX_SIZE = 255;
var STRING_HASH_CACHE_SIZE = 0;
var stringHashCache = {};
var SHIFT = 5;
var SIZE = 1 << SHIFT;
var MASK = SIZE - 1;
var NOT_SET = {};
function MakeRef() {
  return { value: false };
}
function SetRef(ref) {
  if (ref) {
    ref.value = true;
  }
}
function arrCopy(arr, offset) {
  offset = offset || 0;
  const len = Math.max(0, arr.length - offset);
  const newArr = new Array(len);
  for (let ii = 0; ii < len; ii++) {
    newArr[ii] = arr[ii + offset];
  }
  return newArr;
}
var is = Object.is;
var OwnerID = class {
};
var ImmutableMap = class _ImmutableMap {
  // @pragma Construction
  // @ts-ignore
  _root;
  // @ts-ignore
  size;
  // @ts-ignore
  __ownerID;
  // @ts-ignore
  __hash;
  // @ts-ignore
  __altered;
  constructor(value) {
    return value === void 0 || value === null ? emptyMap() : value instanceof _ImmutableMap ? value : emptyMap().withMutations((map) => {
      for (const [k, v] of value) {
        map.set(k, v);
      }
    });
  }
  get(k, notSetValue) {
    return this._root ? this._root.get(0, void 0, k, notSetValue) : notSetValue;
  }
  set(k, v) {
    return updateMap(this, k, v);
  }
  delete(k) {
    return updateMap(this, k, NOT_SET);
  }
  deleteAll(keys) {
    return this.withMutations((map) => {
      for (const key of keys) {
        map.delete(key);
      }
    });
  }
  __ensureOwner(ownerID) {
    if (ownerID === this.__ownerID) {
      return this;
    }
    if (!ownerID) {
      if (this.size === 0) {
        return emptyMap();
      }
      this.__ownerID = ownerID;
      this.__altered = false;
      return this;
    }
    return makeMap(this.size, this._root, ownerID, this.__hash);
  }
  withMutations(fn) {
    const mutable = this.asMutable();
    fn(mutable);
    return mutable.wasAltered() ? mutable.__ensureOwner(this.__ownerID) : this;
  }
  wasAltered() {
    return this.__altered;
  }
  asMutable() {
    return this.__ownerID ? this : this.__ensureOwner(new OwnerID());
  }
  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
  entries() {
    return new MapIterator(this, ITERATE_ENTRIES, false);
  }
  keys() {
    return new MapIterator(this, ITERATE_KEYS, false);
  }
  values() {
    return new MapIterator(this, ITERATE_VALUES, false);
  }
};
var ArrayMapNode = class _ArrayMapNode {
  constructor(ownerID, entries) {
    this.ownerID = ownerID;
    this.entries = entries;
  }
  get(_shift, _keyHash, key, notSetValue) {
    const entries = this.entries;
    for (let ii = 0, len = entries.length; ii < len; ii++) {
      if (is(key, entries[ii][0])) {
        return entries[ii][1];
      }
    }
    return notSetValue;
  }
  update(ownerID, _shift, _keyHash, key, value, didChangeSize, didAlter) {
    const removed = value === NOT_SET;
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (; idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    (removed || !exists) && SetRef(didChangeSize);
    if (removed && entries.length === 1) {
      return;
    }
    if (!exists && !removed && entries.length >= MAX_ARRAY_MAP_SIZE) {
      return createNodes(ownerID, entries, key, value);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : arrCopy(entries);
    if (exists) {
      if (removed) {
        idx === len - 1 ? newEntries.pop() : newEntries[idx] = newEntries.pop();
      } else {
        newEntries[idx] = [key, value];
      }
    } else {
      newEntries.push([key, value]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new _ArrayMapNode(ownerID, newEntries);
  }
};
var BitmapIndexedNode = class _BitmapIndexedNode {
  constructor(ownerID, bitmap, nodes) {
    this.ownerID = ownerID;
    this.bitmap = bitmap;
    this.nodes = nodes;
  }
  get(shift, keyHash, key, notSetValue) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const bit = 1 << ((shift === 0 ? keyHash : keyHash >>> shift) & MASK);
    const bitmap = this.bitmap;
    return (bitmap & bit) === 0 ? notSetValue : this.nodes[popCount(bitmap & bit - 1)].get(shift + SHIFT, keyHash, key, notSetValue);
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const keyHashFrag = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const bit = 1 << keyHashFrag;
    const bitmap = this.bitmap;
    const exists = (bitmap & bit) !== 0;
    if (!exists && value === NOT_SET) {
      return this;
    }
    const idx = popCount(bitmap & bit - 1);
    const nodes = this.nodes;
    const node = exists ? nodes[idx] : void 0;
    const newNode = updateNode(
      node,
      ownerID,
      shift + SHIFT,
      keyHash,
      key,
      value,
      didChangeSize,
      didAlter
    );
    if (newNode === node) {
      return this;
    }
    if (!exists && newNode && nodes.length >= MAX_BITMAP_INDEXED_SIZE) {
      return expandNodes(ownerID, nodes, bitmap, keyHashFrag, newNode);
    }
    if (exists && !newNode && nodes.length === 2 && isLeafNode(nodes[idx ^ 1])) {
      return nodes[idx ^ 1];
    }
    if (exists && newNode && nodes.length === 1 && isLeafNode(newNode)) {
      return newNode;
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newBitmap = exists ? newNode ? bitmap : bitmap ^ bit : bitmap | bit;
    const newNodes = exists ? newNode ? setAt(nodes, idx, newNode, isEditable) : spliceOut(nodes, idx, isEditable) : spliceIn(nodes, idx, newNode, isEditable);
    if (isEditable) {
      this.bitmap = newBitmap;
      this.nodes = newNodes;
      return this;
    }
    return new _BitmapIndexedNode(ownerID, newBitmap, newNodes);
  }
};
var HashArrayMapNode = class _HashArrayMapNode {
  constructor(ownerID, count, nodes) {
    this.ownerID = ownerID;
    this.count = count;
    this.nodes = nodes;
  }
  get(shift, keyHash, key, notSetValue) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const node = this.nodes[idx];
    return node ? node.get(shift + SHIFT, keyHash, key, notSetValue) : notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const idx = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
    const removed = value === NOT_SET;
    const nodes = this.nodes;
    const node = nodes[idx];
    if (removed && !node) {
      return this;
    }
    const newNode = updateNode(
      node,
      ownerID,
      shift + SHIFT,
      keyHash,
      key,
      value,
      didChangeSize,
      didAlter
    );
    if (newNode === node) {
      return this;
    }
    let newCount = this.count;
    if (!node) {
      newCount++;
    } else if (!newNode) {
      newCount--;
      if (newCount < MIN_HASH_ARRAY_MAP_SIZE) {
        return packNodes(ownerID, nodes, newCount, idx);
      }
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newNodes = setAt(nodes, idx, newNode, isEditable);
    if (isEditable) {
      this.count = newCount;
      this.nodes = newNodes;
      return this;
    }
    return new _HashArrayMapNode(ownerID, newCount, newNodes);
  }
};
var HashCollisionNode = class _HashCollisionNode {
  constructor(ownerID, keyHash, entries) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entries = entries;
  }
  get(shift, keyHash, key, notSetValue) {
    const entries = this.entries;
    for (let ii = 0, len = entries.length; ii < len; ii++) {
      if (is(key, entries[ii][0])) {
        return entries[ii][1];
      }
    }
    return notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    if (keyHash === void 0) {
      keyHash = hash(key);
    }
    const removed = value === NOT_SET;
    if (keyHash !== this.keyHash) {
      if (removed) {
        return this;
      }
      SetRef(didAlter);
      SetRef(didChangeSize);
      return mergeIntoNode(this, ownerID, shift, keyHash, [key, value]);
    }
    const entries = this.entries;
    let idx = 0;
    const len = entries.length;
    for (; idx < len; idx++) {
      if (is(key, entries[idx][0])) {
        break;
      }
    }
    const exists = idx < len;
    if (exists ? entries[idx][1] === value : removed) {
      return this;
    }
    SetRef(didAlter);
    (removed || !exists) && SetRef(didChangeSize);
    if (removed && len === 2) {
      return new ValueNode(ownerID, this.keyHash, entries[idx ^ 1]);
    }
    const isEditable = ownerID && ownerID === this.ownerID;
    const newEntries = isEditable ? entries : arrCopy(entries);
    if (exists) {
      if (removed) {
        idx === len - 1 ? newEntries.pop() : newEntries[idx] = newEntries.pop();
      } else {
        newEntries[idx] = [key, value];
      }
    } else {
      newEntries.push([key, value]);
    }
    if (isEditable) {
      this.entries = newEntries;
      return this;
    }
    return new _HashCollisionNode(ownerID, this.keyHash, newEntries);
  }
};
var ValueNode = class _ValueNode {
  constructor(ownerID, keyHash, entry2) {
    this.ownerID = ownerID;
    this.keyHash = keyHash;
    this.entry = entry2;
  }
  get(shift, keyHash, key, notSetValue) {
    return is(key, this.entry[0]) ? this.entry[1] : notSetValue;
  }
  update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
    const removed = value === NOT_SET;
    const keyMatch = is(key, this.entry[0]);
    if (keyMatch ? value === this.entry[1] : removed) {
      return this;
    }
    SetRef(didAlter);
    if (removed) {
      SetRef(didChangeSize);
      return;
    }
    if (keyMatch) {
      if (ownerID && ownerID === this.ownerID) {
        this.entry[1] = value;
        return this;
      }
      return new _ValueNode(ownerID, this.keyHash, [key, value]);
    }
    SetRef(didChangeSize);
    return mergeIntoNode(this, ownerID, shift, hash(key), [key, value]);
  }
};
var MapIterator = class {
  constructor(map, _type, _reverse) {
    this._type = _type;
    this._reverse = _reverse;
    this._stack = map._root && mapIteratorFrame(map._root);
  }
  _stack;
  [Symbol.iterator]() {
    return this;
  }
  next() {
    const type = this._type;
    let stack = this._stack;
    while (stack) {
      const node = stack.node;
      const index = stack.index++;
      let maxIndex;
      if (node.entry) {
        if (index === 0) {
          return mapIteratorValue(type, node.entry);
        }
      } else if ("entries" in node && node.entries) {
        maxIndex = node.entries.length - 1;
        if (index <= maxIndex) {
          return mapIteratorValue(type, node.entries[this._reverse ? maxIndex - index : index]);
        }
      } else {
        maxIndex = node.nodes.length - 1;
        if (index <= maxIndex) {
          const subNode = node.nodes[this._reverse ? maxIndex - index : index];
          if (subNode) {
            if (subNode.entry) {
              return mapIteratorValue(type, subNode.entry);
            }
            stack = this._stack = mapIteratorFrame(subNode, stack);
          }
          continue;
        }
      }
      stack = this._stack = this._stack.__prev;
    }
    return iteratorDone();
  }
};
function mapIteratorValue(type, entry2) {
  return iteratorValue(type, entry2[0], entry2[1]);
}
function mapIteratorFrame(node, prev) {
  return {
    node,
    index: 0,
    __prev: prev
  };
}
var ITERATE_KEYS = 0;
var ITERATE_VALUES = 1;
var ITERATE_ENTRIES = 2;
function iteratorValue(type, k, v, iteratorResult) {
  const value = type === ITERATE_KEYS ? k : type === ITERATE_VALUES ? v : [k, v];
  iteratorResult ? iteratorResult.value = value : iteratorResult = {
    value,
    done: false
  };
  return iteratorResult;
}
function iteratorDone() {
  return { value: void 0, done: true };
}
function makeMap(size, root, ownerID, hash2) {
  const map = Object.create(ImmutableMap.prototype);
  map.size = size;
  map._root = root;
  map.__ownerID = ownerID;
  map.__hash = hash2;
  map.__altered = false;
  return map;
}
var EMPTY_MAP;
function emptyMap() {
  return EMPTY_MAP || (EMPTY_MAP = makeMap(0));
}
function updateMap(map, k, v) {
  let newRoot;
  let newSize;
  if (!map._root) {
    if (v === NOT_SET) {
      return map;
    }
    newSize = 1;
    newRoot = new ArrayMapNode(map.__ownerID, [[k, v]]);
  } else {
    const didChangeSize = MakeRef();
    const didAlter = MakeRef();
    newRoot = updateNode(map._root, map.__ownerID, 0, void 0, k, v, didChangeSize, didAlter);
    if (!didAlter.value) {
      return map;
    }
    newSize = map.size + (didChangeSize.value ? v === NOT_SET ? -1 : 1 : 0);
  }
  if (map.__ownerID) {
    map.size = newSize;
    map._root = newRoot;
    map.__hash = void 0;
    map.__altered = true;
    return map;
  }
  return newRoot ? makeMap(newSize, newRoot) : emptyMap();
}
function updateNode(node, ownerID, shift, keyHash, key, value, didChangeSize, didAlter) {
  if (!node) {
    if (value === NOT_SET) {
      return node;
    }
    SetRef(didAlter);
    SetRef(didChangeSize);
    return new ValueNode(ownerID, keyHash, [key, value]);
  }
  return node.update(ownerID, shift, keyHash, key, value, didChangeSize, didAlter);
}
function isLeafNode(node) {
  return node.constructor === ValueNode || node.constructor === HashCollisionNode;
}
function mergeIntoNode(node, ownerID, shift, keyHash, entry2) {
  if (node.keyHash === keyHash) {
    return new HashCollisionNode(ownerID, keyHash, [node.entry, entry2]);
  }
  const idx1 = (shift === 0 ? node.keyHash : node.keyHash >>> shift) & MASK;
  const idx2 = (shift === 0 ? keyHash : keyHash >>> shift) & MASK;
  let newNode;
  const nodes = idx1 === idx2 ? [mergeIntoNode(node, ownerID, shift + SHIFT, keyHash, entry2)] : (newNode = new ValueNode(ownerID, keyHash, entry2), idx1 < idx2 ? [node, newNode] : [newNode, node]);
  return new BitmapIndexedNode(ownerID, 1 << idx1 | 1 << idx2, nodes);
}
function createNodes(ownerID, entries, key, value) {
  if (!ownerID) {
    ownerID = new OwnerID();
  }
  let node = new ValueNode(ownerID, hash(key), [key, value]);
  for (let ii = 0; ii < entries.length; ii++) {
    const entry2 = entries[ii];
    node = node.update(ownerID, 0, void 0, entry2[0], entry2[1]);
  }
  return node;
}
function packNodes(ownerID, nodes, count, excluding) {
  let bitmap = 0;
  let packedII = 0;
  const packedNodes = new Array(count);
  for (let ii = 0, bit = 1, len = nodes.length; ii < len; ii++, bit <<= 1) {
    const node = nodes[ii];
    if (node !== void 0 && ii !== excluding) {
      bitmap |= bit;
      packedNodes[packedII++] = node;
    }
  }
  return new BitmapIndexedNode(ownerID, bitmap, packedNodes);
}
function expandNodes(ownerID, nodes, bitmap, including, node) {
  let count = 0;
  const expandedNodes = new Array(SIZE);
  for (let ii = 0; bitmap !== 0; ii++, bitmap >>>= 1) {
    expandedNodes[ii] = bitmap & 1 ? nodes[count++] : void 0;
  }
  expandedNodes[including] = node;
  return new HashArrayMapNode(ownerID, count + 1, expandedNodes);
}
function popCount(x) {
  x -= x >> 1 & 1431655765;
  x = (x & 858993459) + (x >> 2 & 858993459);
  x = x + (x >> 4) & 252645135;
  x += x >> 8;
  x += x >> 16;
  return x & 127;
}
function setAt(array2, idx, val, canEdit) {
  const newArray = canEdit ? array2 : arrCopy(array2);
  newArray[idx] = val;
  return newArray;
}
function spliceIn(array2, idx, val, canEdit) {
  const newLen = array2.length + 1;
  if (canEdit && idx + 1 === newLen) {
    array2[idx] = val;
    return array2;
  }
  const newArray = new Array(newLen);
  let after = 0;
  for (let ii = 0; ii < newLen; ii++) {
    if (ii === idx) {
      newArray[ii] = val;
      after = -1;
    } else {
      newArray[ii] = array2[ii + after];
    }
  }
  return newArray;
}
function spliceOut(array2, idx, canEdit) {
  const newLen = array2.length - 1;
  if (canEdit && idx === newLen) {
    array2.pop();
    return array2;
  }
  const newArray = new Array(newLen);
  let after = 0;
  for (let ii = 0; ii < newLen; ii++) {
    if (ii === idx) {
      after = 1;
    }
    newArray[ii] = array2[ii + after];
  }
  return newArray;
}
var MAX_ARRAY_MAP_SIZE = SIZE / 4;
var MAX_BITMAP_INDEXED_SIZE = SIZE / 2;
var MIN_HASH_ARRAY_MAP_SIZE = SIZE / 4;

// node_modules/@tldraw/store/dist-esm/lib/AtomMap.mjs
var AtomMap = class {
  constructor(name, entries) {
    this.name = name;
    let atoms = emptyMap();
    if (entries) {
      atoms = atoms.withMutations((atoms2) => {
        for (const [k, v] of entries) {
          atoms2.set(k, atom(`${name}:${String(k)}`, v));
        }
      });
    }
    this.atoms = atom(`${name}:atoms`, atoms);
  }
  atoms;
  /** @internal */
  getAtom(key) {
    const valueAtom = this.atoms.__unsafe__getWithoutCapture().get(key);
    if (!valueAtom) {
      this.atoms.get();
      return void 0;
    }
    return valueAtom;
  }
  get(key) {
    const value = this.getAtom(key)?.get();
    assert(value !== UNINITIALIZED);
    return value;
  }
  __unsafe__getWithoutCapture(key) {
    const valueAtom = this.atoms.__unsafe__getWithoutCapture().get(key);
    if (!valueAtom) return void 0;
    const value = valueAtom.__unsafe__getWithoutCapture();
    assert(value !== UNINITIALIZED);
    return value;
  }
  has(key) {
    const valueAtom = this.getAtom(key);
    if (!valueAtom) {
      return false;
    }
    return valueAtom.get() !== UNINITIALIZED;
  }
  __unsafe__hasWithoutCapture(key) {
    const valueAtom = this.atoms.__unsafe__getWithoutCapture().get(key);
    if (!valueAtom) return false;
    assert(valueAtom.__unsafe__getWithoutCapture() !== UNINITIALIZED);
    return true;
  }
  set(key, value) {
    const existingAtom = this.atoms.__unsafe__getWithoutCapture().get(key);
    if (existingAtom) {
      existingAtom.set(value);
    } else {
      this.atoms.update((atoms) => {
        return atoms.set(key, atom(`${this.name}:${String(key)}`, value));
      });
    }
    return this;
  }
  update(key, updater) {
    const valueAtom = this.atoms.__unsafe__getWithoutCapture().get(key);
    if (!valueAtom) {
      throw new Error(`AtomMap: key ${key} not found`);
    }
    const value = valueAtom.__unsafe__getWithoutCapture();
    assert(value !== UNINITIALIZED);
    valueAtom.set(updater(value));
  }
  delete(key) {
    const valueAtom = this.atoms.__unsafe__getWithoutCapture().get(key);
    if (!valueAtom) {
      return false;
    }
    transact(() => {
      valueAtom.set(UNINITIALIZED);
      this.atoms.update((atoms) => {
        return atoms.delete(key);
      });
    });
    return true;
  }
  deleteMany(keys) {
    return transact(() => {
      const deleted = [];
      const newAtoms = this.atoms.get().withMutations((atoms) => {
        for (const key of keys) {
          const valueAtom = atoms.get(key);
          if (!valueAtom) continue;
          const oldValue = valueAtom.get();
          assert(oldValue !== UNINITIALIZED);
          deleted.push([key, oldValue]);
          atoms.delete(key);
          valueAtom.set(UNINITIALIZED);
        }
      });
      if (deleted.length) {
        this.atoms.set(newAtoms);
      }
      return deleted;
    });
  }
  clear() {
    return transact(() => {
      for (const valueAtom of this.atoms.__unsafe__getWithoutCapture().values()) {
        valueAtom.set(UNINITIALIZED);
      }
      this.atoms.set(emptyMap());
    });
  }
  *entries() {
    for (const [key, valueAtom] of this.atoms.get()) {
      const value = valueAtom.get();
      assert(value !== UNINITIALIZED);
      yield [key, value];
    }
  }
  *keys() {
    for (const key of this.atoms.get().keys()) {
      yield key;
    }
  }
  *values() {
    for (const valueAtom of this.atoms.get().values()) {
      const value = valueAtom.get();
      assert(value !== UNINITIALIZED);
      yield value;
    }
  }
  // eslint-disable-next-line no-restricted-syntax
  get size() {
    return this.atoms.get().size;
  }
  forEach(callbackfn, thisArg) {
    for (const [key, value] of this.entries()) {
      callbackfn.call(thisArg, value, key, this);
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  [Symbol.toStringTag] = "AtomMap";
};

// node_modules/@tldraw/store/dist-esm/lib/devFreeze.mjs
function devFreeze(object2) {
  if (false) {
    return object2;
  }
  const proto = Object.getPrototypeOf(object2);
  if (proto && !(Array.isArray(object2) || proto === Object.prototype || proto === null || proto === STRUCTURED_CLONE_OBJECT_PROTOTYPE)) {
    console.error("cannot include non-js data in a record", object2);
    throw new Error("cannot include non-js data in a record");
  }
  const propNames = Object.getOwnPropertyNames(object2);
  for (const name of propNames) {
    const value = object2[name];
    if (value && typeof value === "object") {
      devFreeze(value);
    }
  }
  return Object.freeze(object2);
}

// node_modules/@tldraw/store/dist-esm/lib/IncrementalSetConstructor.mjs
var IncrementalSetConstructor = class {
  constructor(previousValue) {
    this.previousValue = previousValue;
  }
  /**
   * The next value of the set.
   *
   * @internal
   */
  nextValue;
  /**
   * The diff of the set.
   *
   * @internal
   */
  diff;
  /**
   * Get the next value of the set.
   *
   * @public
   */
  get() {
    const numRemoved = this.diff?.removed?.size ?? 0;
    const numAdded = this.diff?.added?.size ?? 0;
    if (numRemoved === 0 && numAdded === 0) {
      return void 0;
    }
    return { value: this.nextValue, diff: this.diff };
  }
  /**
   * Add an item to the set.
   *
   * @param item - The item to add.
   * @param wasAlreadyPresent - Whether the item was already present in the set.
   * @internal
   */
  _add(item, wasAlreadyPresent) {
    this.nextValue ??= new Set(this.previousValue);
    this.nextValue.add(item);
    this.diff ??= {};
    if (wasAlreadyPresent) {
      this.diff.removed?.delete(item);
    } else {
      this.diff.added ??= /* @__PURE__ */ new Set();
      this.diff.added.add(item);
    }
  }
  /**
   * Add an item to the set.
   *
   * @param item - The item to add.
   * @public
   */
  add(item) {
    const wasAlreadyPresent = this.previousValue.has(item);
    if (wasAlreadyPresent) {
      const wasRemoved = this.diff?.removed?.has(item);
      if (!wasRemoved) return;
      return this._add(item, wasAlreadyPresent);
    }
    const isCurrentlyPresent = this.nextValue?.has(item);
    if (isCurrentlyPresent) return;
    this._add(item, wasAlreadyPresent);
  }
  /**
   * Remove an item from the set.
   *
   * @param item - The item to remove.
   * @param wasAlreadyPresent - Whether the item was already present in the set.
   * @internal
   */
  _remove(item, wasAlreadyPresent) {
    this.nextValue ??= new Set(this.previousValue);
    this.nextValue.delete(item);
    this.diff ??= {};
    if (wasAlreadyPresent) {
      this.diff.removed ??= /* @__PURE__ */ new Set();
      this.diff.removed.add(item);
    } else {
      this.diff.added?.delete(item);
    }
  }
  /**
   * Remove an item from the set.
   *
   * @param item - The item to remove.
   * @public
   */
  remove(item) {
    const wasAlreadyPresent = this.previousValue.has(item);
    if (!wasAlreadyPresent) {
      const wasAdded = this.diff?.added?.has(item);
      if (!wasAdded) return;
      return this._remove(item, wasAlreadyPresent);
    }
    const hasAlreadyBeenRemoved = this.diff?.removed?.has(item);
    if (hasAlreadyBeenRemoved) return;
    this._remove(item, wasAlreadyPresent);
  }
};

// node_modules/@tldraw/store/dist-esm/lib/migrate.mjs
var didWarn = false;
function defineMigrations(opts) {
  const { currentVersion, firstVersion, migrators = {}, subTypeKey, subTypeMigrations } = opts;
  if (!didWarn) {
    console.warn(
      `The 'defineMigrations' function is deprecated and will be removed in a future release. Use the new migrations API instead. See the migration guide for more info: https://tldraw.dev/docs/persistence#Updating-legacy-shape-migrations-defineMigrations`
    );
    didWarn = true;
  }
  if (typeof currentVersion === "number" && typeof firstVersion === "number") {
    if (currentVersion === firstVersion) {
      throw Error(`Current version is equal to initial version.`);
    } else if (currentVersion < firstVersion) {
      throw Error(`Current version is lower than initial version.`);
    }
  }
  return {
    firstVersion: firstVersion ?? 0,
    // defaults
    currentVersion: currentVersion ?? 0,
    // defaults
    migrators,
    subTypeKey,
    subTypeMigrations
  };
}
function squashDependsOn(sequence) {
  const result = [];
  for (let i = sequence.length - 1; i >= 0; i--) {
    const elem = sequence[i];
    if (!("id" in elem)) {
      const dependsOn = elem.dependsOn;
      const prev = result[0];
      if (prev) {
        result[0] = {
          ...prev,
          dependsOn: dependsOn.concat(prev.dependsOn ?? [])
        };
      }
    } else {
      result.unshift(elem);
    }
  }
  return result;
}
function createMigrationSequence({
  sequence,
  sequenceId,
  retroactive = true
}) {
  const migrations = {
    sequenceId,
    retroactive,
    sequence: squashDependsOn(sequence)
  };
  validateMigrations(migrations);
  return migrations;
}
function createMigrationIds(sequenceId, versions) {
  return Object.fromEntries(
    objectMapEntries(versions).map(([key, version]) => [key, `${sequenceId}/${version}`])
  );
}
function createRecordMigrationSequence(opts) {
  const sequenceId = opts.sequenceId;
  return createMigrationSequence({
    sequenceId,
    retroactive: opts.retroactive ?? true,
    sequence: opts.sequence.map(
      (m) => "id" in m ? {
        ...m,
        scope: "record",
        filter: (r) => r.typeName === opts.recordType && (m.filter?.(r) ?? true) && (opts.filter?.(r) ?? true)
      } : m
    )
  });
}
function sortMigrations(migrations) {
  const byId = new Map(migrations.map((m) => [m.id, m]));
  const isProcessing = /* @__PURE__ */ new Set();
  const result = [];
  function process2(m) {
    assert(!isProcessing.has(m.id), `Circular dependency in migrations: ${m.id}`);
    isProcessing.add(m.id);
    const { version, sequenceId } = parseMigrationId(m.id);
    const parent = byId.get(`${sequenceId}/${version - 1}`);
    if (parent) {
      process2(parent);
    }
    if (m.dependsOn) {
      for (const dep of m.dependsOn) {
        const depMigration = byId.get(dep);
        if (depMigration) {
          process2(depMigration);
        }
      }
    }
    byId.delete(m.id);
    result.push(m);
  }
  for (const m of byId.values()) {
    process2(m);
  }
  return result;
}
function parseMigrationId(id) {
  const [sequenceId, version] = id.split("/");
  return { sequenceId, version: parseInt(version) };
}
function validateMigrationId(id, expectedSequenceId) {
  if (expectedSequenceId) {
    assert(
      id.startsWith(expectedSequenceId + "/"),
      `Every migration in sequence '${expectedSequenceId}' must have an id starting with '${expectedSequenceId}/'. Got invalid id: '${id}'`
    );
  }
  assert(id.match(/^(.*?)\/(0|[1-9]\d*)$/), `Invalid migration id: '${id}'`);
}
function validateMigrations(migrations) {
  assert(
    !migrations.sequenceId.includes("/"),
    `sequenceId cannot contain a '/', got ${migrations.sequenceId}`
  );
  assert(migrations.sequenceId.length, "sequenceId must be a non-empty string");
  if (migrations.sequence.length === 0) {
    return;
  }
  validateMigrationId(migrations.sequence[0].id, migrations.sequenceId);
  let n = parseMigrationId(migrations.sequence[0].id).version;
  assert(
    n === 1,
    `Expected the first migrationId to be '${migrations.sequenceId}/1' but got '${migrations.sequence[0].id}'`
  );
  for (let i = 1; i < migrations.sequence.length; i++) {
    const id = migrations.sequence[i].id;
    validateMigrationId(id, migrations.sequenceId);
    const m = parseMigrationId(id).version;
    assert(
      m === n + 1,
      `Migration id numbers must increase in increments of 1, expected ${migrations.sequenceId}/${n + 1} but got '${migrations.sequence[i].id}'`
    );
    n = m;
  }
}
var MigrationFailureReason = ((MigrationFailureReason2) => {
  MigrationFailureReason2["IncompatibleSubtype"] = "incompatible-subtype";
  MigrationFailureReason2["UnknownType"] = "unknown-type";
  MigrationFailureReason2["TargetVersionTooNew"] = "target-version-too-new";
  MigrationFailureReason2["TargetVersionTooOld"] = "target-version-too-old";
  MigrationFailureReason2["MigrationError"] = "migration-error";
  MigrationFailureReason2["UnrecognizedSubtype"] = "unrecognized-subtype";
  return MigrationFailureReason2;
})(MigrationFailureReason || {});

// node_modules/@tldraw/store/dist-esm/lib/RecordsDiff.mjs
function createEmptyRecordsDiff() {
  return { added: {}, updated: {}, removed: {} };
}
function reverseRecordsDiff(diff) {
  const result = { added: diff.removed, removed: diff.added, updated: {} };
  for (const [from, to] of Object.values(diff.updated)) {
    result.updated[from.id] = [to, from];
  }
  return result;
}
function isRecordsDiffEmpty(diff) {
  return Object.keys(diff.added).length === 0 && Object.keys(diff.updated).length === 0 && Object.keys(diff.removed).length === 0;
}
function squashRecordDiffs(diffs) {
  const result = { added: {}, removed: {}, updated: {} };
  squashRecordDiffsMutable(result, diffs);
  return result;
}
function squashRecordDiffsMutable(target, diffs) {
  for (const diff of diffs) {
    for (const [id, value] of objectMapEntries(diff.added)) {
      if (target.removed[id]) {
        const original = target.removed[id];
        delete target.removed[id];
        if (original !== value) {
          target.updated[id] = [original, value];
        }
      } else {
        target.added[id] = value;
      }
    }
    for (const [id, [_from, to]] of objectMapEntries(diff.updated)) {
      if (target.added[id]) {
        target.added[id] = to;
        delete target.updated[id];
        delete target.removed[id];
        continue;
      }
      if (target.updated[id]) {
        target.updated[id] = [target.updated[id][0], to];
        delete target.removed[id];
        continue;
      }
      target.updated[id] = diff.updated[id];
      delete target.removed[id];
    }
    for (const [id, value] of objectMapEntries(diff.removed)) {
      if (target.added[id]) {
        delete target.added[id];
      } else if (target.updated[id]) {
        target.removed[id] = target.updated[id][0];
        delete target.updated[id];
      } else {
        target.removed[id] = value;
      }
    }
  }
}

// node_modules/@tldraw/store/dist-esm/lib/RecordType.mjs
var RecordType = class _RecordType {
  constructor(typeName, config) {
    this.typeName = typeName;
    this.createDefaultProperties = config.createDefaultProperties;
    this.validator = config.validator ?? { validate: (r) => r };
    this.scope = config.scope ?? "document";
    this.ephemeralKeys = config.ephemeralKeys;
    const ephemeralKeySet = /* @__PURE__ */ new Set();
    if (config.ephemeralKeys) {
      for (const [key, isEphemeral] of objectMapEntries(config.ephemeralKeys)) {
        if (isEphemeral) ephemeralKeySet.add(key);
      }
    }
    this.ephemeralKeySet = ephemeralKeySet;
  }
  createDefaultProperties;
  validator;
  ephemeralKeys;
  ephemeralKeySet;
  scope;
  /**
   * Create a new record of this type.
   *
   * @param properties - The properties of the record.
   * @returns The new record.
   */
  create(properties) {
    const result = {
      ...this.createDefaultProperties(),
      id: "id" in properties ? properties.id : this.createId()
    };
    for (const [k, v] of Object.entries(properties)) {
      if (v !== void 0) {
        result[k] = v;
      }
    }
    result.typeName = this.typeName;
    return result;
  }
  /**
   * Clone a record of this type.
   *
   * @param record - The record to clone.
   * @returns The cloned record.
   * @public
   */
  clone(record) {
    return { ...structuredClone(record), id: this.createId() };
  }
  /**
   * Create a new ID for this record type.
   *
   * @example
   *
   * ```ts
   * const id = recordType.createId()
   * ```
   *
   * @returns The new ID.
   * @public
   */
  createId(customUniquePart) {
    return this.typeName + ":" + (customUniquePart ?? uniqueId());
  }
  /**
   * Create a new ID for this record type based on the given ID.
   *
   * @example
   *
   * ```ts
   * const id = recordType.createCustomId('myId')
   * ```
   *
   * @deprecated - Use `createId` instead.
   * @param id - The ID to base the new ID on.
   * @returns The new ID.
   */
  createCustomId(id) {
    return this.typeName + ":" + id;
  }
  /**
   * Takes an id like `user:123` and returns the part after the colon `123`
   *
   * @param id - The id
   * @returns
   */
  parseId(id) {
    if (!this.isId(id)) {
      throw new Error(`ID "${id}" is not a valid ID for type "${this.typeName}"`);
    }
    return id.slice(this.typeName.length + 1);
  }
  /**
   * Check whether a record is an instance of this record type.
   *
   * @example
   *
   * ```ts
   * const result = recordType.isInstance(someRecord)
   * ```
   *
   * @param record - The record to check.
   * @returns Whether the record is an instance of this record type.
   */
  isInstance(record) {
    return record?.typeName === this.typeName;
  }
  /**
   * Check whether an id is an id of this type.
   *
   * @example
   *
   * ```ts
   * const result = recordType.isIn('someId')
   * ```
   *
   * @param id - The id to check.
   * @returns Whether the id is an id of this type.
   */
  isId(id) {
    if (!id) return false;
    for (let i = 0; i < this.typeName.length; i++) {
      if (id[i] !== this.typeName[i]) return false;
    }
    return id[this.typeName.length] === ":";
  }
  /**
   * Create a new RecordType that has the same type name as this RecordType and includes the given
   * default properties.
   *
   * @example
   *
   * ```ts
   * const authorType = createRecordType('author', () => ({ living: true }))
   * const deadAuthorType = authorType.withDefaultProperties({ living: false })
   * ```
   *
   * @param createDefaultProperties - A function that returns the default properties of the new RecordType.
   * @returns The new RecordType.
   */
  withDefaultProperties(createDefaultProperties) {
    return new _RecordType(this.typeName, {
      createDefaultProperties,
      validator: this.validator,
      scope: this.scope,
      ephemeralKeys: this.ephemeralKeys
    });
  }
  /**
   * Check that the passed in record passes the validations for this type. Returns its input
   * correctly typed if it does, but throws an error otherwise.
   */
  validate(record, recordBefore) {
    if (recordBefore && this.validator.validateUsingKnownGoodVersion) {
      return this.validator.validateUsingKnownGoodVersion(recordBefore, record);
    }
    return this.validator.validate(record);
  }
};
function createRecordType(typeName, config) {
  return new RecordType(typeName, {
    createDefaultProperties: () => ({}),
    validator: config.validator,
    scope: config.scope,
    ephemeralKeys: config.ephemeralKeys
  });
}
function assertIdType(id, type) {
  if (!id || !type.isId(id)) {
    throw new Error(`string ${JSON.stringify(id)} is not a valid ${type.typeName} id`);
  }
}

// node_modules/@tldraw/store/dist-esm/lib/setUtils.mjs
function intersectSets(sets) {
  if (sets.length === 0) return /* @__PURE__ */ new Set();
  const first = sets[0];
  const rest = sets.slice(1);
  const result = /* @__PURE__ */ new Set();
  for (const val of first) {
    if (rest.every((set) => set.has(val))) {
      result.add(val);
    }
  }
  return result;
}
function diffSets(prev, next) {
  const result = {};
  for (const val of next) {
    if (!prev.has(val)) {
      result.added ??= /* @__PURE__ */ new Set();
      result.added.add(val);
    }
  }
  for (const val of prev) {
    if (!next.has(val)) {
      result.removed ??= /* @__PURE__ */ new Set();
      result.removed.add(val);
    }
  }
  return result.added || result.removed ? result : void 0;
}

// node_modules/@tldraw/store/dist-esm/lib/executeQuery.mjs
function objectMatchesQuery(query, object2) {
  for (const [key, _matcher] of Object.entries(query)) {
    const matcher = _matcher;
    const value = object2[key];
    if ("eq" in matcher && value !== matcher.eq) return false;
    if ("neq" in matcher && value === matcher.neq) return false;
    if ("gt" in matcher && (typeof value !== "number" || value <= matcher.gt)) return false;
  }
  return true;
}
function executeQuery(store, typeName, query) {
  const matchIds = Object.fromEntries(Object.keys(query).map((key) => [key, /* @__PURE__ */ new Set()]));
  for (const [k, matcher] of Object.entries(query)) {
    if ("eq" in matcher) {
      const index = store.index(typeName, k);
      const ids = index.get().get(matcher.eq);
      if (ids) {
        for (const id of ids) {
          matchIds[k].add(id);
        }
      }
    } else if ("neq" in matcher) {
      const index = store.index(typeName, k);
      for (const [value, ids] of index.get()) {
        if (value !== matcher.neq) {
          for (const id of ids) {
            matchIds[k].add(id);
          }
        }
      }
    } else if ("gt" in matcher) {
      const index = store.index(typeName, k);
      for (const [value, ids] of index.get()) {
        if (value > matcher.gt) {
          for (const id of ids) {
            matchIds[k].add(id);
          }
        }
      }
    }
  }
  return intersectSets(Object.values(matchIds));
}

// node_modules/@tldraw/store/dist-esm/lib/StoreQueries.mjs
var StoreQueries = class {
  constructor(recordMap, history) {
    this.recordMap = recordMap;
    this.history = history;
  }
  /**
   * A cache of derivations (indexes).
   *
   * @internal
   */
  indexCache = /* @__PURE__ */ new Map();
  /**
   * A cache of derivations (filtered histories).
   *
   * @internal
   */
  historyCache = /* @__PURE__ */ new Map();
  /**
   * Create a derivation that contains the history for a given type
   *
   * @param typeName - The name of the type to filter by.
   * @returns A derivation that returns the ids of all records of the given type.
   * @public
   */
  filterHistory(typeName) {
    if (this.historyCache.has(typeName)) {
      return this.historyCache.get(typeName);
    }
    const filtered = computed(
      "filterHistory:" + typeName,
      (lastValue, lastComputedEpoch) => {
        if (isUninitialized(lastValue)) {
          return this.history.get();
        }
        const diff = this.history.getDiffSince(lastComputedEpoch);
        if (diff === RESET_VALUE) return this.history.get();
        const res = { added: {}, removed: {}, updated: {} };
        let numAdded = 0;
        let numRemoved = 0;
        let numUpdated = 0;
        for (const changes of diff) {
          for (const added of objectMapValues(changes.added)) {
            if (added.typeName === typeName) {
              if (res.removed[added.id]) {
                const original = res.removed[added.id];
                delete res.removed[added.id];
                numRemoved--;
                if (original !== added) {
                  res.updated[added.id] = [original, added];
                  numUpdated++;
                }
              } else {
                res.added[added.id] = added;
                numAdded++;
              }
            }
          }
          for (const [from, to] of objectMapValues(changes.updated)) {
            if (to.typeName === typeName) {
              if (res.added[to.id]) {
                res.added[to.id] = to;
              } else if (res.updated[to.id]) {
                res.updated[to.id] = [res.updated[to.id][0], to];
              } else {
                res.updated[to.id] = [from, to];
                numUpdated++;
              }
            }
          }
          for (const removed of objectMapValues(changes.removed)) {
            if (removed.typeName === typeName) {
              if (res.added[removed.id]) {
                delete res.added[removed.id];
                numAdded--;
              } else if (res.updated[removed.id]) {
                res.removed[removed.id] = res.updated[removed.id][0];
                delete res.updated[removed.id];
                numUpdated--;
                numRemoved++;
              } else {
                res.removed[removed.id] = removed;
                numRemoved++;
              }
            }
          }
        }
        if (numAdded || numRemoved || numUpdated) {
          return withDiff(this.history.get(), res);
        } else {
          return lastValue;
        }
      },
      { historyLength: 100 }
    );
    this.historyCache.set(typeName, filtered);
    return filtered;
  }
  /**
   * Create a derivation that returns an index on a property for the given type.
   *
   * @param typeName - The name of the type.
   * @param property - The name of the property.
   * @public
   */
  index(typeName, property) {
    const cacheKey = typeName + ":" + property;
    if (this.indexCache.has(cacheKey)) {
      return this.indexCache.get(cacheKey);
    }
    const index = this.__uncached_createIndex(typeName, property);
    this.indexCache.set(cacheKey, index);
    return index;
  }
  /**
   * Create a derivation that returns an index on a property for the given type.
   *
   * @param typeName - The name of the type?.
   * @param property - The name of the property?.
   * @internal
   */
  __uncached_createIndex(typeName, property) {
    const typeHistory = this.filterHistory(typeName);
    const fromScratch = () => {
      typeHistory.get();
      const res = /* @__PURE__ */ new Map();
      for (const record of this.recordMap.values()) {
        if (record.typeName === typeName) {
          const value = record[property];
          if (!res.has(value)) {
            res.set(value, /* @__PURE__ */ new Set());
          }
          res.get(value).add(record.id);
        }
      }
      return res;
    };
    return computed(
      "index:" + typeName + ":" + property,
      (prevValue, lastComputedEpoch) => {
        if (isUninitialized(prevValue)) return fromScratch();
        const history = typeHistory.getDiffSince(lastComputedEpoch);
        if (history === RESET_VALUE) {
          return fromScratch();
        }
        const setConstructors = /* @__PURE__ */ new Map();
        const add = (value, id) => {
          let setConstructor = setConstructors.get(value);
          if (!setConstructor)
            setConstructor = new IncrementalSetConstructor(
              prevValue.get(value) ?? /* @__PURE__ */ new Set()
            );
          setConstructor.add(id);
          setConstructors.set(value, setConstructor);
        };
        const remove2 = (value, id) => {
          let set = setConstructors.get(value);
          if (!set) set = new IncrementalSetConstructor(prevValue.get(value) ?? /* @__PURE__ */ new Set());
          set.remove(id);
          setConstructors.set(value, set);
        };
        for (const changes of history) {
          for (const record of objectMapValues(changes.added)) {
            if (record.typeName === typeName) {
              const value = record[property];
              add(value, record.id);
            }
          }
          for (const [from, to] of objectMapValues(changes.updated)) {
            if (to.typeName === typeName) {
              const prev = from[property];
              const next = to[property];
              if (prev !== next) {
                remove2(prev, to.id);
                add(next, to.id);
              }
            }
          }
          for (const record of objectMapValues(changes.removed)) {
            if (record.typeName === typeName) {
              const value = record[property];
              remove2(value, record.id);
            }
          }
        }
        let nextValue = void 0;
        let nextDiff = void 0;
        for (const [value, setConstructor] of setConstructors) {
          const result = setConstructor.get();
          if (!result) continue;
          if (!nextValue) nextValue = new Map(prevValue);
          if (!nextDiff) nextDiff = /* @__PURE__ */ new Map();
          if (result.value.size === 0) {
            nextValue.delete(value);
          } else {
            nextValue.set(value, result.value);
          }
          nextDiff.set(value, result.diff);
        }
        if (nextValue && nextDiff) {
          return withDiff(nextValue, nextDiff);
        }
        return prevValue;
      },
      { historyLength: 100 }
    );
  }
  /**
   * Create a derivation that will return a signle record matching the given query.
   *
   * It will return undefined if there is no matching record
   *
   * @param typeName - The name of the type?
   * @param queryCreator - A function that returns the query expression.
   * @param name - (optional) The name of the query.
   */
  record(typeName, queryCreator = () => ({}), name = "record:" + typeName + (queryCreator ? ":" + queryCreator.toString() : "")) {
    const ids = this.ids(typeName, queryCreator, name);
    return computed(name, () => {
      for (const id of ids.get()) {
        return this.recordMap.get(id);
      }
      return void 0;
    });
  }
  /**
   * Create a derivation that will return an array of records matching the given query
   *
   * @param typeName - The name of the type?
   * @param queryCreator - A function that returns the query expression.
   * @param name - (optinal) The name of the query.
   */
  records(typeName, queryCreator = () => ({}), name = "records:" + typeName + (queryCreator ? ":" + queryCreator.toString() : "")) {
    const ids = this.ids(typeName, queryCreator, "ids:" + name);
    return computed(
      name,
      () => {
        return Array.from(ids.get(), (id) => this.recordMap.get(id));
      },
      {
        isEqual: areArraysShallowEqual
      }
    );
  }
  /**
   * Create a derivation that will return the ids of all records of the given type.
   *
   * @param typeName - The name of the type.
   * @param queryCreator - A function that returns the query expression.
   * @param name - (optinal) The name of the query.
   */
  ids(typeName, queryCreator = () => ({}), name = "ids:" + typeName + (queryCreator ? ":" + queryCreator.toString() : "")) {
    const typeHistory = this.filterHistory(typeName);
    const fromScratch = () => {
      typeHistory.get();
      const query = queryCreator();
      if (Object.keys(query).length === 0) {
        const ids = /* @__PURE__ */ new Set();
        for (const record of this.recordMap.values()) {
          if (record.typeName === typeName) ids.add(record.id);
        }
        return ids;
      }
      return executeQuery(this, typeName, query);
    };
    const fromScratchWithDiff = (prevValue) => {
      const nextValue = fromScratch();
      const diff = diffSets(prevValue, nextValue);
      if (diff) {
        return withDiff(nextValue, diff);
      } else {
        return prevValue;
      }
    };
    const cachedQuery = computed("ids_query:" + name, queryCreator, {
      isEqual: import_lodash2.default
    });
    return computed(
      "query:" + name,
      (prevValue, lastComputedEpoch) => {
        const query = cachedQuery.get();
        if (isUninitialized(prevValue)) {
          return fromScratch();
        }
        if (lastComputedEpoch < cachedQuery.lastChangedEpoch) {
          return fromScratchWithDiff(prevValue);
        }
        const history = typeHistory.getDiffSince(lastComputedEpoch);
        if (history === RESET_VALUE) {
          return fromScratchWithDiff(prevValue);
        }
        const setConstructor = new IncrementalSetConstructor(
          prevValue
        );
        for (const changes of history) {
          for (const added of objectMapValues(changes.added)) {
            if (added.typeName === typeName && objectMatchesQuery(query, added)) {
              setConstructor.add(added.id);
            }
          }
          for (const [_, updated] of objectMapValues(changes.updated)) {
            if (updated.typeName === typeName) {
              if (objectMatchesQuery(query, updated)) {
                setConstructor.add(updated.id);
              } else {
                setConstructor.remove(updated.id);
              }
            }
          }
          for (const removed of objectMapValues(changes.removed)) {
            if (removed.typeName === typeName) {
              setConstructor.remove(removed.id);
            }
          }
        }
        const result = setConstructor.get();
        if (!result) {
          return prevValue;
        }
        return withDiff(result.value, result.diff);
      },
      { historyLength: 50 }
    );
  }
  exec(typeName, query) {
    const ids = executeQuery(this, typeName, query);
    if (ids.size === 0) {
      return EMPTY_ARRAY;
    }
    return Array.from(ids, (id) => this.recordMap.get(id));
  }
};

// node_modules/@tldraw/store/dist-esm/lib/StoreSideEffects.mjs
var StoreSideEffects = class {
  constructor(store) {
    this.store = store;
  }
  _beforeCreateHandlers = {};
  _afterCreateHandlers = {};
  _beforeChangeHandlers = {};
  _afterChangeHandlers = {};
  _beforeDeleteHandlers = {};
  _afterDeleteHandlers = {};
  _operationCompleteHandlers = [];
  _isEnabled = true;
  /** @internal */
  isEnabled() {
    return this._isEnabled;
  }
  /** @internal */
  setIsEnabled(enabled) {
    this._isEnabled = enabled;
  }
  /** @internal */
  handleBeforeCreate(record, source) {
    if (!this._isEnabled) return record;
    const handlers = this._beforeCreateHandlers[record.typeName];
    if (handlers) {
      let r = record;
      for (const handler of handlers) {
        r = handler(r, source);
      }
      return r;
    }
    return record;
  }
  /** @internal */
  handleAfterCreate(record, source) {
    if (!this._isEnabled) return;
    const handlers = this._afterCreateHandlers[record.typeName];
    if (handlers) {
      for (const handler of handlers) {
        handler(record, source);
      }
    }
  }
  /** @internal */
  handleBeforeChange(prev, next, source) {
    if (!this._isEnabled) return next;
    const handlers = this._beforeChangeHandlers[next.typeName];
    if (handlers) {
      let r = next;
      for (const handler of handlers) {
        r = handler(prev, r, source);
      }
      return r;
    }
    return next;
  }
  /** @internal */
  handleAfterChange(prev, next, source) {
    if (!this._isEnabled) return;
    const handlers = this._afterChangeHandlers[next.typeName];
    if (handlers) {
      for (const handler of handlers) {
        handler(prev, next, source);
      }
    }
  }
  /** @internal */
  handleBeforeDelete(record, source) {
    if (!this._isEnabled) return true;
    const handlers = this._beforeDeleteHandlers[record.typeName];
    if (handlers) {
      for (const handler of handlers) {
        if (handler(record, source) === false) {
          return false;
        }
      }
    }
    return true;
  }
  /** @internal */
  handleAfterDelete(record, source) {
    if (!this._isEnabled) return;
    const handlers = this._afterDeleteHandlers[record.typeName];
    if (handlers) {
      for (const handler of handlers) {
        handler(record, source);
      }
    }
  }
  /** @internal */
  handleOperationComplete(source) {
    if (!this._isEnabled) return;
    for (const handler of this._operationCompleteHandlers) {
      handler(source);
    }
  }
  /**
   * Internal helper for registering a bunch of side effects at once and keeping them organized.
   * @internal
   */
  register(handlersByType) {
    const disposes = [];
    for (const [type, handlers] of Object.entries(handlersByType)) {
      if (handlers?.beforeCreate) {
        disposes.push(this.registerBeforeCreateHandler(type, handlers.beforeCreate));
      }
      if (handlers?.afterCreate) {
        disposes.push(this.registerAfterCreateHandler(type, handlers.afterCreate));
      }
      if (handlers?.beforeChange) {
        disposes.push(this.registerBeforeChangeHandler(type, handlers.beforeChange));
      }
      if (handlers?.afterChange) {
        disposes.push(this.registerAfterChangeHandler(type, handlers.afterChange));
      }
      if (handlers?.beforeDelete) {
        disposes.push(this.registerBeforeDeleteHandler(type, handlers.beforeDelete));
      }
      if (handlers?.afterDelete) {
        disposes.push(this.registerAfterDeleteHandler(type, handlers.afterDelete));
      }
    }
    return () => {
      for (const dispose of disposes) dispose();
    };
  }
  /**
   * Register a handler to be called before a record of a certain type is created. Return a
   * modified record from the handler to change the record that will be created.
   *
   * Use this handle only to modify the creation of the record itself. If you want to trigger a
   * side-effect on a different record (for example, moving one shape when another is created),
   * use {@link StoreSideEffects.registerAfterCreateHandler} instead.
   *
   * @example
   * ```ts
   * editor.sideEffects.registerBeforeCreateHandler('shape', (shape, source) => {
   *     // only modify shapes created by the user
   *     if (source !== 'user') return shape
   *
   *     //by default, arrow shapes have no label. Let's make sure they always have a label.
   *     if (shape.type === 'arrow') {
   *         return {...shape, props: {...shape.props, text: 'an arrow'}}
   *     }
   *
   *     // other shapes get returned unmodified
   *     return shape
   * })
   * ```
   *
   * @param typeName - The type of record to listen for
   * @param handler - The handler to call
   *
   * @returns A callback that removes the handler.
   */
  registerBeforeCreateHandler(typeName, handler) {
    const handlers = this._beforeCreateHandlers[typeName];
    if (!handlers) this._beforeCreateHandlers[typeName] = [];
    this._beforeCreateHandlers[typeName].push(handler);
    return () => remove(this._beforeCreateHandlers[typeName], handler);
  }
  /**
   * Register a handler to be called after a record is created. This is useful for side-effects
   * that would update _other_ records. If you want to modify the record being created use
   * {@link StoreSideEffects.registerBeforeCreateHandler} instead.
   *
   * @example
   * ```ts
   * editor.sideEffects.registerAfterCreateHandler('page', (page, source) => {
   *     // Automatically create a shape when a page is created
   *     editor.createShape<TLTextShape>({
   *         id: createShapeId(),
   *         type: 'text',
   *         props: { richText: toRichText(page.name) },
   *     })
   * })
   * ```
   *
   * @param typeName - The type of record to listen for
   * @param handler - The handler to call
   *
   * @returns A callback that removes the handler.
   */
  registerAfterCreateHandler(typeName, handler) {
    const handlers = this._afterCreateHandlers[typeName];
    if (!handlers) this._afterCreateHandlers[typeName] = [];
    this._afterCreateHandlers[typeName].push(handler);
    return () => remove(this._afterCreateHandlers[typeName], handler);
  }
  /**
   * Register a handler to be called before a record is changed. The handler is given the old and
   * new record - you can return a modified record to apply a different update, or the old record
   * to block the update entirely.
   *
   * Use this handler only for intercepting updates to the record itself. If you want to update
   * other records in response to a change, use
   * {@link StoreSideEffects.registerAfterChangeHandler} instead.
   *
   * @example
   * ```ts
   * editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next, source) => {
   *     if (next.isLocked && !prev.isLocked) {
   *         // prevent shapes from ever being locked:
   *         return prev
   *     }
   *     // other types of change are allowed
   *     return next
   * })
   * ```
   *
   * @param typeName - The type of record to listen for
   * @param handler - The handler to call
   *
   * @returns A callback that removes the handler.
   */
  registerBeforeChangeHandler(typeName, handler) {
    const handlers = this._beforeChangeHandlers[typeName];
    if (!handlers) this._beforeChangeHandlers[typeName] = [];
    this._beforeChangeHandlers[typeName].push(handler);
    return () => remove(this._beforeChangeHandlers[typeName], handler);
  }
  /**
   * Register a handler to be called after a record is changed. This is useful for side-effects
   * that would update _other_ records - if you want to modify the record being changed, use
   * {@link StoreSideEffects.registerBeforeChangeHandler} instead.
   *
   * @example
   * ```ts
   * editor.sideEffects.registerAfterChangeHandler('shape', (prev, next, source) => {
   *     if (next.props.color === 'red') {
   *         // there can only be one red shape at a time:
   *         const otherRedShapes = editor.getCurrentPageShapes().filter(s => s.props.color === 'red' && s.id !== next.id)
   *         editor.updateShapes(otherRedShapes.map(s => ({...s, props: {...s.props, color: 'blue'}})))
   *     }
   * })
   * ```
   *
   * @param typeName - The type of record to listen for
   * @param handler - The handler to call
   *
   * @returns A callback that removes the handler.
   */
  registerAfterChangeHandler(typeName, handler) {
    const handlers = this._afterChangeHandlers[typeName];
    if (!handlers) this._afterChangeHandlers[typeName] = [];
    this._afterChangeHandlers[typeName].push(handler);
    return () => remove(this._afterChangeHandlers[typeName], handler);
  }
  /**
   * Register a handler to be called before a record is deleted. The handler can return `false` to
   * prevent the deletion.
   *
   * Use this handler only for intercepting deletions of the record itself. If you want to do
   * something to other records in response to a deletion, use
   * {@link StoreSideEffects.registerAfterDeleteHandler} instead.
   *
   * @example
   * ```ts
   * editor.sideEffects.registerBeforeDeleteHandler('shape', (shape, source) => {
   *     if (shape.props.color === 'red') {
   *         // prevent red shapes from being deleted
   * 	       return false
   *     }
   * })
   * ```
   *
   * @param typeName - The type of record to listen for
   * @param handler - The handler to call
   *
   * @returns A callback that removes the handler.
   */
  registerBeforeDeleteHandler(typeName, handler) {
    const handlers = this._beforeDeleteHandlers[typeName];
    if (!handlers) this._beforeDeleteHandlers[typeName] = [];
    this._beforeDeleteHandlers[typeName].push(handler);
    return () => remove(this._beforeDeleteHandlers[typeName], handler);
  }
  /**
   * Register a handler to be called after a record is deleted. This is useful for side-effects
   * that would update _other_ records - if you want to block the deletion of the record itself,
   * use {@link StoreSideEffects.registerBeforeDeleteHandler} instead.
   *
   * @example
   * ```ts
   * editor.sideEffects.registerAfterDeleteHandler('shape', (shape, source) => {
   *     // if the last shape in a frame is deleted, delete the frame too:
   *     const parentFrame = editor.getShape(shape.parentId)
   *     if (!parentFrame || parentFrame.type !== 'frame') return
   *
   *     const siblings = editor.getSortedChildIdsForParent(parentFrame)
   *     if (siblings.length === 0) {
   *         editor.deleteShape(parentFrame.id)
   *     }
   * })
   * ```
   *
   * @param typeName - The type of record to listen for
   * @param handler - The handler to call
   *
   * @returns A callback that removes the handler.
   */
  registerAfterDeleteHandler(typeName, handler) {
    const handlers = this._afterDeleteHandlers[typeName];
    if (!handlers) this._afterDeleteHandlers[typeName] = [];
    this._afterDeleteHandlers[typeName].push(handler);
    return () => remove(this._afterDeleteHandlers[typeName], handler);
  }
  /**
   * Register a handler to be called when a store completes an atomic operation.
   *
   * @example
   * ```ts
   * let count = 0
   *
   * editor.sideEffects.registerOperationCompleteHandler(() => count++)
   *
   * editor.selectAll()
   * expect(count).toBe(1)
   *
   * editor.store.atomic(() => {
   *	editor.selectNone()
   * 	editor.selectAll()
   * })
   *
   * expect(count).toBe(2)
   * ```
   *
   * @param handler - The handler to call
   *
   * @returns A callback that removes the handler.
   *
   * @public
   */
  registerOperationCompleteHandler(handler) {
    this._operationCompleteHandlers.push(handler);
    return () => remove(this._operationCompleteHandlers, handler);
  }
};
function remove(array2, item) {
  const index = array2.indexOf(item);
  if (index >= 0) {
    array2.splice(index, 1);
  }
}

// node_modules/@tldraw/store/dist-esm/lib/Store.mjs
var Store = class {
  /**
   * The random id of the store.
   */
  id;
  /**
   * An AtomMap containing the stores records.
   *
   * @internal
   * @readonly
   */
  records;
  /**
   * An atom containing the store's history.
   *
   * @public
   * @readonly
   */
  history = atom("history", 0, {
    historyLength: 1e3
  });
  /**
   * A StoreQueries instance for this store.
   *
   * @public
   * @readonly
   */
  query;
  /**
   * A set containing listeners that have been added to this store.
   *
   * @internal
   */
  listeners = /* @__PURE__ */ new Set();
  /**
   * An array of history entries that have not yet been flushed.
   *
   * @internal
   */
  historyAccumulator = new HistoryAccumulator();
  /**
   * A reactor that responds to changes to the history by squashing the accumulated history and
   * notifying listeners of the changes.
   *
   * @internal
   */
  historyReactor;
  /**
   * Function to dispose of any in-flight timeouts.
   *
   * @internal
   */
  cancelHistoryReactor() {
  }
  schema;
  props;
  scopedTypes;
  sideEffects = new StoreSideEffects(this);
  constructor(config) {
    const { initialData, schema, id } = config;
    this.id = id ?? uniqueId();
    this.schema = schema;
    this.props = config.props;
    if (initialData) {
      this.records = new AtomMap(
        "store",
        objectMapEntries(initialData).map(([id2, record]) => [
          id2,
          devFreeze(this.schema.validateRecord(this, record, "initialize", null))
        ])
      );
    } else {
      this.records = new AtomMap("store");
    }
    this.query = new StoreQueries(this.records, this.history);
    this.historyReactor = reactor(
      "Store.historyReactor",
      () => {
        this.history.get();
        this._flushHistory();
      },
      { scheduleEffect: (cb) => this.cancelHistoryReactor = throttleToNextFrame(cb) }
    );
    this.scopedTypes = {
      document: new Set(
        objectMapValues(this.schema.types).filter((t) => t.scope === "document").map((t) => t.typeName)
      ),
      session: new Set(
        objectMapValues(this.schema.types).filter((t) => t.scope === "session").map((t) => t.typeName)
      ),
      presence: new Set(
        objectMapValues(this.schema.types).filter((t) => t.scope === "presence").map((t) => t.typeName)
      )
    };
  }
  _flushHistory() {
    if (this.historyAccumulator.hasChanges()) {
      const entries = this.historyAccumulator.flush();
      for (const { changes, source } of entries) {
        let instanceChanges = null;
        let documentChanges = null;
        let presenceChanges = null;
        for (const { onHistory, filters } of this.listeners) {
          if (filters.source !== "all" && filters.source !== source) {
            continue;
          }
          if (filters.scope !== "all") {
            if (filters.scope === "document") {
              documentChanges ??= this.filterChangesByScope(changes, "document");
              if (!documentChanges) continue;
              onHistory({ changes: documentChanges, source });
            } else if (filters.scope === "session") {
              instanceChanges ??= this.filterChangesByScope(changes, "session");
              if (!instanceChanges) continue;
              onHistory({ changes: instanceChanges, source });
            } else {
              presenceChanges ??= this.filterChangesByScope(changes, "presence");
              if (!presenceChanges) continue;
              onHistory({ changes: presenceChanges, source });
            }
          } else {
            onHistory({ changes, source });
          }
        }
      }
    }
  }
  dispose() {
    this.cancelHistoryReactor();
  }
  /**
   * Filters out non-document changes from a diff. Returns null if there are no changes left.
   * @param change - the records diff
   * @param scope - the records scope
   * @returns
   */
  filterChangesByScope(change, scope) {
    const result = {
      added: filterEntries(change.added, (_, r) => this.scopedTypes[scope].has(r.typeName)),
      updated: filterEntries(change.updated, (_, r) => this.scopedTypes[scope].has(r[1].typeName)),
      removed: filterEntries(change.removed, (_, r) => this.scopedTypes[scope].has(r.typeName))
    };
    if (Object.keys(result.added).length === 0 && Object.keys(result.updated).length === 0 && Object.keys(result.removed).length === 0) {
      return null;
    }
    return result;
  }
  /**
   * Update the history with a diff of changes.
   *
   * @param changes - The changes to add to the history.
   */
  updateHistory(changes) {
    this.historyAccumulator.add({
      changes,
      source: this.isMergingRemoteChanges ? "remote" : "user"
    });
    if (this.listeners.size === 0) {
      this.historyAccumulator.clear();
    }
    this.history.set(this.history.get() + 1, changes);
  }
  validate(phase) {
    this.allRecords().forEach((record) => this.schema.validateRecord(this, record, phase, null));
  }
  /**
   * Add some records to the store. It's an error if they already exist.
   *
   * @param records - The records to add.
   * @param phaseOverride - The phase override.
   * @public
   */
  put(records, phaseOverride) {
    this.atomic(() => {
      const updates = {};
      const additions = {};
      let record;
      let didChange = false;
      const source = this.isMergingRemoteChanges ? "remote" : "user";
      for (let i = 0, n = records.length; i < n; i++) {
        record = records[i];
        const initialValue = this.records.__unsafe__getWithoutCapture(record.id);
        if (initialValue) {
          record = this.sideEffects.handleBeforeChange(initialValue, record, source);
          const validated = this.schema.validateRecord(
            this,
            record,
            phaseOverride ?? "updateRecord",
            initialValue
          );
          if (validated === initialValue) continue;
          record = devFreeze(record);
          this.records.set(record.id, record);
          didChange = true;
          updates[record.id] = [initialValue, record];
          this.addDiffForAfterEvent(initialValue, record);
        } else {
          record = this.sideEffects.handleBeforeCreate(record, source);
          didChange = true;
          record = this.schema.validateRecord(
            this,
            record,
            phaseOverride ?? "createRecord",
            null
          );
          record = devFreeze(record);
          additions[record.id] = record;
          this.addDiffForAfterEvent(null, record);
          this.records.set(record.id, record);
        }
      }
      if (!didChange) return;
      this.updateHistory({
        added: additions,
        updated: updates,
        removed: {}
      });
    });
  }
  /**
   * Remove some records from the store via their ids.
   *
   * @param ids - The ids of the records to remove.
   * @public
   */
  remove(ids) {
    this.atomic(() => {
      const toDelete = new Set(ids);
      const source = this.isMergingRemoteChanges ? "remote" : "user";
      if (this.sideEffects.isEnabled()) {
        for (const id of ids) {
          const record = this.records.__unsafe__getWithoutCapture(id);
          if (!record) continue;
          if (this.sideEffects.handleBeforeDelete(record, source) === false) {
            toDelete.delete(id);
          }
        }
      }
      const actuallyDeleted = this.records.deleteMany(toDelete);
      if (actuallyDeleted.length === 0) return;
      const removed = {};
      for (const [id, record] of actuallyDeleted) {
        removed[id] = record;
        this.addDiffForAfterEvent(record, null);
      }
      this.updateHistory({ added: {}, updated: {}, removed });
    });
  }
  /**
   * Get the value of a store record by its id.
   *
   * @param id - The id of the record to get.
   * @public
   */
  get(id) {
    return this.records.get(id);
  }
  /**
   * Get the value of a store record by its id without updating its epoch.
   *
   * @param id - The id of the record to get.
   * @public
   */
  unsafeGetWithoutCapture(id) {
    return this.records.__unsafe__getWithoutCapture(id);
  }
  /**
   * Creates a JSON payload from the record store.
   *
   * @param scope - The scope of records to serialize. Defaults to 'document'.
   * @returns The record store snapshot as a JSON payload.
   */
  serialize(scope = "document") {
    const result = {};
    for (const [id, record] of this.records) {
      if (scope === "all" || this.scopedTypes[scope].has(record.typeName)) {
        result[id] = record;
      }
    }
    return result;
  }
  /**
   * Get a serialized snapshot of the store and its schema.
   *
   * ```ts
   * const snapshot = store.getStoreSnapshot()
   * store.loadStoreSnapshot(snapshot)
   * ```
   *
   * @param scope - The scope of records to serialize. Defaults to 'document'.
   *
   * @public
   */
  getStoreSnapshot(scope = "document") {
    return {
      store: this.serialize(scope),
      schema: this.schema.serialize()
    };
  }
  /**
   * @deprecated use `getSnapshot` from the 'tldraw' package instead.
   */
  getSnapshot(scope = "document") {
    console.warn(
      "[tldraw] `Store.getSnapshot` is deprecated and will be removed in a future release. Use `getSnapshot` from the `tldraw` package instead."
    );
    return this.getStoreSnapshot(scope);
  }
  /**
   * Migrate a serialized snapshot of the store and its schema.
   *
   * ```ts
   * const snapshot = store.getSnapshot()
   * store.migrateSnapshot(snapshot)
   * ```
   *
   * @param snapshot - The snapshot to load.
   * @public
   */
  migrateSnapshot(snapshot) {
    const migrationResult = this.schema.migrateStoreSnapshot(snapshot);
    if (migrationResult.type === "error") {
      throw new Error(`Failed to migrate snapshot: ${migrationResult.reason}`);
    }
    return {
      store: migrationResult.value,
      schema: this.schema.serialize()
    };
  }
  /**
   * Load a serialized snapshot.
   *
   * ```ts
   * const snapshot = store.getStoreSnapshot()
   * store.loadStoreSnapshot(snapshot)
   * ```
   *
   * @param snapshot - The snapshot to load.
   * @public
   */
  loadStoreSnapshot(snapshot) {
    const migrationResult = this.schema.migrateStoreSnapshot(snapshot);
    if (migrationResult.type === "error") {
      throw new Error(`Failed to migrate snapshot: ${migrationResult.reason}`);
    }
    const prevSideEffectsEnabled = this.sideEffects.isEnabled();
    try {
      this.sideEffects.setIsEnabled(false);
      this.atomic(() => {
        this.clear();
        this.put(Object.values(migrationResult.value));
        this.ensureStoreIsUsable();
      });
    } finally {
      this.sideEffects.setIsEnabled(prevSideEffectsEnabled);
    }
  }
  /**
   * @public
   * @deprecated use `loadSnapshot` from the 'tldraw' package instead.
   */
  loadSnapshot(snapshot) {
    console.warn(
      "[tldraw] `Store.loadSnapshot` is deprecated and will be removed in a future release. Use `loadSnapshot` from the 'tldraw' package instead."
    );
    this.loadStoreSnapshot(snapshot);
  }
  /**
   * Get an array of all values in the store.
   *
   * @returns An array of all values in the store.
   * @public
   */
  allRecords() {
    return Array.from(this.records.values());
  }
  /**
   * Removes all records from the store.
   *
   * @public
   */
  clear() {
    this.remove(Array.from(this.records.keys()));
  }
  /**
   * Update a record. To update multiple records at once, use the `update` method of the
   * `TypedStore` class.
   *
   * @param id - The id of the record to update.
   * @param updater - A function that updates the record.
   */
  update(id, updater) {
    const existing = this.unsafeGetWithoutCapture(id);
    if (!existing) {
      console.error(`Record ${id} not found. This is probably an error`);
      return;
    }
    this.put([updater(existing)]);
  }
  /**
   * Get whether the record store has a id.
   *
   * @param id - The id of the record to check.
   * @public
   */
  has(id) {
    return this.records.has(id);
  }
  /**
   * Add a new listener to the store.
   *
   * @param onHistory - The listener to call when the store updates.
   * @param filters - Filters to apply to the listener.
   * @returns A function to remove the listener.
   */
  listen(onHistory, filters) {
    this._flushHistory();
    const listener = {
      onHistory,
      filters: {
        source: filters?.source ?? "all",
        scope: filters?.scope ?? "all"
      }
    };
    if (!this.historyReactor.scheduler.isActivelyListening) {
      this.historyReactor.start();
      this.historyReactor.scheduler.execute();
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.historyReactor.stop();
      }
    };
  }
  isMergingRemoteChanges = false;
  /**
   * Merge changes from a remote source
   *
   * @param fn - A function that merges the external changes.
   * @public
   */
  mergeRemoteChanges(fn) {
    if (this.isMergingRemoteChanges) {
      return fn();
    }
    if (this._isInAtomicOp) {
      throw new Error("Cannot merge remote changes while in atomic operation");
    }
    try {
      this.atomic(fn, true, true);
    } finally {
      this.ensureStoreIsUsable();
    }
  }
  /**
   * Run `fn` and return a {@link RecordsDiff} of the changes that occurred as a result.
   */
  extractingChanges(fn) {
    const changes = [];
    const dispose = this.historyAccumulator.addInterceptor((entry2) => changes.push(entry2.changes));
    try {
      transact(fn);
      return squashRecordDiffs(changes);
    } finally {
      dispose();
    }
  }
  applyDiff(diff, {
    runCallbacks = true,
    ignoreEphemeralKeys = false
  } = {}) {
    this.atomic(() => {
      const toPut = objectMapValues(diff.added);
      for (const [_from, to] of objectMapValues(diff.updated)) {
        const type = this.schema.getType(to.typeName);
        if (ignoreEphemeralKeys && type.ephemeralKeySet.size) {
          const existing = this.get(to.id);
          if (!existing) {
            toPut.push(to);
            continue;
          }
          let changed = null;
          for (const [key, value] of Object.entries(to)) {
            if (type.ephemeralKeySet.has(key) || Object.is(value, getOwnProperty(existing, key))) {
              continue;
            }
            if (!changed) changed = { ...existing };
            changed[key] = value;
          }
          if (changed) toPut.push(changed);
        } else {
          toPut.push(to);
        }
      }
      const toRemove = objectMapKeys(diff.removed);
      if (toPut.length) {
        this.put(toPut);
      }
      if (toRemove.length) {
        this.remove(toRemove);
      }
    }, runCallbacks);
  }
  /**
   * Create a cache based on values in the store. Pass in a function that takes and ID and a
   * signal for the underlying record. Return a signal (usually a computed) for the cached value.
   * For simple derivations, use {@link Store.createComputedCache}. This function is useful if you
   * need more precise control over intermediate values.
   */
  createCache(create) {
    const cache = new WeakCache();
    return {
      get: (id) => {
        const atom2 = this.records.getAtom(id);
        if (!atom2) return void 0;
        return cache.get(atom2, () => create(id, atom2)).get();
      }
    };
  }
  /**
   * Create a computed cache.
   *
   * @param name - The name of the derivation cache.
   * @param derive - A function used to derive the value of the cache.
   * @param opts - Options for the computed cache.
   * @public
   */
  createComputedCache(name, derive, opts) {
    return this.createCache((id, record) => {
      const recordSignal = opts?.areRecordsEqual ? computed(`${name}:${id}:isEqual`, () => record.get(), { isEqual: opts.areRecordsEqual }) : record;
      return computed(
        name + ":" + id,
        () => {
          return derive(recordSignal.get());
        },
        {
          isEqual: opts?.areResultsEqual
        }
      );
    });
  }
  _integrityChecker;
  /** @internal */
  ensureStoreIsUsable() {
    this.atomic(() => {
      this._integrityChecker ??= this.schema.createIntegrityChecker(this);
      this._integrityChecker?.();
    });
  }
  _isPossiblyCorrupted = false;
  /** @internal */
  markAsPossiblyCorrupted() {
    this._isPossiblyCorrupted = true;
  }
  /** @internal */
  isPossiblyCorrupted() {
    return this._isPossiblyCorrupted;
  }
  pendingAfterEvents = null;
  addDiffForAfterEvent(before, after) {
    assert(this.pendingAfterEvents, "must be in event operation");
    if (before === after) return;
    if (before && after) assert(before.id === after.id);
    if (!before && !after) return;
    const id = (before || after).id;
    const existing = this.pendingAfterEvents.get(id);
    if (existing) {
      existing.after = after;
    } else {
      this.pendingAfterEvents.set(id, { before, after });
    }
  }
  flushAtomicCallbacks(isMergingRemoteChanges) {
    let updateDepth = 0;
    let source = isMergingRemoteChanges ? "remote" : "user";
    while (this.pendingAfterEvents) {
      const events = this.pendingAfterEvents;
      this.pendingAfterEvents = null;
      if (!this.sideEffects.isEnabled()) continue;
      updateDepth++;
      if (updateDepth > 100) {
        throw new Error("Maximum store update depth exceeded, bailing out");
      }
      for (const { before, after } of events.values()) {
        if (before && after && before !== after && !(0, import_lodash2.default)(before, after)) {
          this.sideEffects.handleAfterChange(before, after, source);
        } else if (before && !after) {
          this.sideEffects.handleAfterDelete(before, source);
        } else if (!before && after) {
          this.sideEffects.handleAfterCreate(after, source);
        }
      }
      if (!this.pendingAfterEvents) {
        this.sideEffects.handleOperationComplete(source);
      } else {
        source = "user";
      }
    }
  }
  _isInAtomicOp = false;
  /** @internal */
  atomic(fn, runCallbacks = true, isMergingRemoteChanges = false) {
    return transact(() => {
      if (this._isInAtomicOp) {
        if (!this.pendingAfterEvents) this.pendingAfterEvents = /* @__PURE__ */ new Map();
        const prevSideEffectsEnabled2 = this.sideEffects.isEnabled();
        assert(!isMergingRemoteChanges, "cannot call mergeRemoteChanges while in atomic operation");
        try {
          if (prevSideEffectsEnabled2 && !runCallbacks) {
            this.sideEffects.setIsEnabled(false);
          }
          return fn();
        } finally {
          this.sideEffects.setIsEnabled(prevSideEffectsEnabled2);
        }
      }
      this.pendingAfterEvents = /* @__PURE__ */ new Map();
      const prevSideEffectsEnabled = this.sideEffects.isEnabled();
      this.sideEffects.setIsEnabled(runCallbacks ?? prevSideEffectsEnabled);
      this._isInAtomicOp = true;
      if (isMergingRemoteChanges) {
        this.isMergingRemoteChanges = true;
      }
      try {
        const result = fn();
        this.isMergingRemoteChanges = false;
        this.flushAtomicCallbacks(isMergingRemoteChanges);
        return result;
      } finally {
        this.pendingAfterEvents = null;
        this.sideEffects.setIsEnabled(prevSideEffectsEnabled);
        this._isInAtomicOp = false;
        this.isMergingRemoteChanges = false;
      }
    });
  }
  /** @internal */
  addHistoryInterceptor(fn) {
    return this.historyAccumulator.addInterceptor(
      (entry2) => fn(entry2, this.isMergingRemoteChanges ? "remote" : "user")
    );
  }
};
function squashHistoryEntries(entries) {
  if (entries.length === 0) return [];
  const chunked = [];
  let chunk = [entries[0]];
  let entry2;
  for (let i = 1, n = entries.length; i < n; i++) {
    entry2 = entries[i];
    if (chunk[0].source !== entry2.source) {
      chunked.push(chunk);
      chunk = [];
    }
    chunk.push(entry2);
  }
  chunked.push(chunk);
  return devFreeze(
    chunked.map((chunk2) => ({
      source: chunk2[0].source,
      changes: squashRecordDiffs(chunk2.map((e) => e.changes))
    }))
  );
}
var HistoryAccumulator = class {
  _history = [];
  _interceptors = /* @__PURE__ */ new Set();
  addInterceptor(fn) {
    this._interceptors.add(fn);
    return () => {
      this._interceptors.delete(fn);
    };
  }
  add(entry2) {
    this._history.push(entry2);
    for (const interceptor of this._interceptors) {
      interceptor(entry2);
    }
  }
  flush() {
    const history = squashHistoryEntries(this._history);
    this._history = [];
    return history;
  }
  clear() {
    this._history = [];
  }
  hasChanges() {
    return this._history.length > 0;
  }
};
function createComputedCache(name, derive, opts) {
  const cache = new WeakCache();
  return {
    get(context, id) {
      const computedCache = cache.get(context, () => {
        const store = context instanceof Store ? context : context.store;
        return store.createComputedCache(name, (record) => derive(context, record), opts);
      });
      return computedCache.get(id);
    }
  };
}

// node_modules/@tldraw/store/dist-esm/lib/StoreSchema.mjs
function upgradeSchema(schema) {
  if (schema.schemaVersion > 2 || schema.schemaVersion < 1) return Result.err("Bad schema version");
  if (schema.schemaVersion === 2) return Result.ok(schema);
  const result = {
    schemaVersion: 2,
    sequences: {
      "com.tldraw.store": schema.storeVersion
    }
  };
  for (const [typeName, recordVersion] of Object.entries(schema.recordVersions)) {
    result.sequences[`com.tldraw.${typeName}`] = recordVersion.version;
    if ("subTypeKey" in recordVersion) {
      for (const [subType, version] of Object.entries(recordVersion.subTypeVersions)) {
        result.sequences[`com.tldraw.${typeName}.${subType}`] = version;
      }
    }
  }
  return Result.ok(result);
}
var StoreSchema = class _StoreSchema {
  constructor(types, options) {
    this.types = types;
    this.options = options;
    for (const m of options.migrations ?? []) {
      assert(!this.migrations[m.sequenceId], `Duplicate migration sequenceId ${m.sequenceId}`);
      validateMigrations(m);
      this.migrations[m.sequenceId] = m;
    }
    const allMigrations = Object.values(this.migrations).flatMap((m) => m.sequence);
    this.sortedMigrations = sortMigrations(allMigrations);
    for (const migration of this.sortedMigrations) {
      if (!migration.dependsOn?.length) continue;
      for (const dep of migration.dependsOn) {
        const depMigration = allMigrations.find((m) => m.id === dep);
        assert(depMigration, `Migration '${migration.id}' depends on missing migration '${dep}'`);
      }
    }
  }
  static create(types, options) {
    return new _StoreSchema(types, options ?? {});
  }
  migrations = {};
  sortedMigrations;
  validateRecord(store, record, phase, recordBefore) {
    try {
      const recordType = getOwnProperty(this.types, record.typeName);
      if (!recordType) {
        throw new Error(`Missing definition for record type ${record.typeName}`);
      }
      return recordType.validate(record, recordBefore ?? void 0);
    } catch (error) {
      if (this.options.onValidationFailure) {
        return this.options.onValidationFailure({
          store,
          record,
          phase,
          recordBefore,
          error
        });
      } else {
        throw error;
      }
    }
  }
  // TODO: use a weakmap to store the result of this function
  getMigrationsSince(persistedSchema) {
    const upgradeResult = upgradeSchema(persistedSchema);
    if (!upgradeResult.ok) {
      return upgradeResult;
    }
    const schema = upgradeResult.value;
    const sequenceIdsToInclude = new Set(
      // start with any shared sequences
      Object.keys(schema.sequences).filter((sequenceId) => this.migrations[sequenceId])
    );
    for (const sequenceId in this.migrations) {
      if (schema.sequences[sequenceId] === void 0 && this.migrations[sequenceId].retroactive) {
        sequenceIdsToInclude.add(sequenceId);
      }
    }
    if (sequenceIdsToInclude.size === 0) {
      return Result.ok([]);
    }
    const allMigrationsToInclude = /* @__PURE__ */ new Set();
    for (const sequenceId of sequenceIdsToInclude) {
      const theirVersion = schema.sequences[sequenceId];
      if (typeof theirVersion !== "number" && this.migrations[sequenceId].retroactive || theirVersion === 0) {
        for (const migration of this.migrations[sequenceId].sequence) {
          allMigrationsToInclude.add(migration.id);
        }
        continue;
      }
      const theirVersionId = `${sequenceId}/${theirVersion}`;
      const idx = this.migrations[sequenceId].sequence.findIndex((m) => m.id === theirVersionId);
      if (idx === -1) {
        return Result.err("Incompatible schema?");
      }
      for (const migration of this.migrations[sequenceId].sequence.slice(idx + 1)) {
        allMigrationsToInclude.add(migration.id);
      }
    }
    return Result.ok(this.sortedMigrations.filter(({ id }) => allMigrationsToInclude.has(id)));
  }
  migratePersistedRecord(record, persistedSchema, direction = "up") {
    const migrations = this.getMigrationsSince(persistedSchema);
    if (!migrations.ok) {
      console.error("Error migrating record", migrations.error);
      return { type: "error", reason: MigrationFailureReason.MigrationError };
    }
    let migrationsToApply = migrations.value;
    if (migrationsToApply.length === 0) {
      return { type: "success", value: record };
    }
    if (migrationsToApply.some((m) => m.scope === "store")) {
      return {
        type: "error",
        reason: direction === "down" ? MigrationFailureReason.TargetVersionTooOld : MigrationFailureReason.TargetVersionTooNew
      };
    }
    if (direction === "down") {
      if (!migrationsToApply.every((m) => m.down)) {
        return {
          type: "error",
          reason: MigrationFailureReason.TargetVersionTooOld
        };
      }
      migrationsToApply = migrationsToApply.slice().reverse();
    }
    record = structuredClone(record);
    try {
      for (const migration of migrationsToApply) {
        if (migration.scope === "store") throw new Error(
          /* won't happen, just for TS */
        );
        const shouldApply = migration.filter ? migration.filter(record) : true;
        if (!shouldApply) continue;
        const result = migration[direction](record);
        if (result) {
          record = structuredClone(result);
        }
      }
    } catch (e) {
      console.error("Error migrating record", e);
      return { type: "error", reason: MigrationFailureReason.MigrationError };
    }
    return { type: "success", value: record };
  }
  migrateStoreSnapshot(snapshot) {
    let { store } = snapshot;
    const migrations = this.getMigrationsSince(snapshot.schema);
    if (!migrations.ok) {
      console.error("Error migrating store", migrations.error);
      return { type: "error", reason: MigrationFailureReason.MigrationError };
    }
    const migrationsToApply = migrations.value;
    if (migrationsToApply.length === 0) {
      return { type: "success", value: store };
    }
    store = structuredClone(store);
    try {
      for (const migration of migrationsToApply) {
        if (migration.scope === "record") {
          for (const [id, record] of Object.entries(store)) {
            const shouldApply = migration.filter ? migration.filter(record) : true;
            if (!shouldApply) continue;
            const result = migration.up(record);
            if (result) {
              store[id] = structuredClone(result);
            }
          }
        } else if (migration.scope === "store") {
          const result = migration.up(store);
          if (result) {
            store = structuredClone(result);
          }
        } else {
          exhaustiveSwitchError(migration);
        }
      }
    } catch (e) {
      console.error("Error migrating store", e);
      return { type: "error", reason: MigrationFailureReason.MigrationError };
    }
    return { type: "success", value: store };
  }
  /** @internal */
  createIntegrityChecker(store) {
    return this.options.createIntegrityChecker?.(store) ?? void 0;
  }
  serialize() {
    return {
      schemaVersion: 2,
      sequences: Object.fromEntries(
        Object.values(this.migrations).map(({ sequenceId, sequence }) => [
          sequenceId,
          sequence.length ? parseMigrationId(sequence.at(-1).id).version : 0
        ])
      )
    };
  }
  /**
   * @deprecated This is only here for legacy reasons, don't use it unless you have david's blessing!
   */
  serializeEarliestVersion() {
    return {
      schemaVersion: 2,
      sequences: Object.fromEntries(
        Object.values(this.migrations).map(({ sequenceId }) => [sequenceId, 0])
      )
    };
  }
  /** @internal */
  getType(typeName) {
    const type = getOwnProperty(this.types, typeName);
    assert(type, "record type does not exists");
    return type;
  }
};

// node_modules/@tldraw/store/dist-esm/index.mjs
registerTldrawLibraryVersion(
  "@tldraw/store",
  "3.15.6",
  "esm"
);

// node_modules/@tldraw/tlschema/dist-esm/misc/TLOpacity.mjs
var opacityValidator = validation_exports.number.check((n) => {
  if (n < 0 || n > 1) {
    throw new validation_exports.ValidationError("Opacity must be between 0 and 1");
  }
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLBaseShape.mjs
var parentIdValidator = validation_exports.string.refine((id) => {
  if (!id.startsWith("page:") && !id.startsWith("shape:")) {
    throw new Error('Parent ID must start with "page:" or "shape:"');
  }
  return id;
});
var shapeIdValidator = idValidator("shape");
function createShapeValidator(type, props, meta) {
  return validation_exports.object({
    id: shapeIdValidator,
    typeName: validation_exports.literal("shape"),
    x: validation_exports.number,
    y: validation_exports.number,
    rotation: validation_exports.number,
    index: validation_exports.indexKey,
    parentId: parentIdValidator,
    type: validation_exports.literal(type),
    isLocked: validation_exports.boolean,
    opacity: opacityValidator,
    props: props ? validation_exports.object(props) : validation_exports.jsonValue,
    meta: meta ? validation_exports.object(meta) : validation_exports.jsonValue
  });
}

// node_modules/@tldraw/tlschema/dist-esm/bindings/TLBaseBinding.mjs
var bindingIdValidator = idValidator("binding");
function createBindingValidator(type, props, meta) {
  return validation_exports.object({
    id: bindingIdValidator,
    typeName: validation_exports.literal("binding"),
    type: validation_exports.literal(type),
    fromId: shapeIdValidator,
    toId: shapeIdValidator,
    props: props ? validation_exports.object(props) : validation_exports.jsonValue,
    meta: meta ? validation_exports.object(meta) : validation_exports.jsonValue
  });
}

// node_modules/@tldraw/tlschema/dist-esm/records/TLBinding.mjs
var rootBindingVersions = createMigrationIds("com.tldraw.binding", {});
var rootBindingMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.binding",
  recordType: "binding",
  sequence: []
});
function isBinding(record) {
  if (!record) return false;
  return record.typeName === "binding";
}
function isBindingId(id) {
  if (!id) return false;
  return id.startsWith("binding:");
}
function createBindingId(id) {
  return `binding:${id ?? uniqueId()}`;
}
function createBindingPropsMigrationSequence(migrations) {
  return migrations;
}
function createBindingPropsMigrationIds(bindingType, ids) {
  return mapObjectMapValues(ids, (_k, v) => `com.tldraw.binding.${bindingType}/${v}`);
}
function createBindingRecordType(bindings) {
  return createRecordType("binding", {
    scope: "document",
    validator: validation_exports.model(
      "binding",
      validation_exports.union(
        "type",
        mapObjectMapValues(
          bindings,
          (type, { props, meta }) => createBindingValidator(type, props, meta)
        )
      )
    )
  }).withDefaultProperties(() => ({
    meta: {}
  }));
}

// node_modules/@tldraw/tlschema/dist-esm/styles/StyleProp.mjs
var StyleProp = class _StyleProp {
  /** @internal */
  constructor(id, defaultValue, type) {
    this.id = id;
    this.defaultValue = defaultValue;
    this.type = type;
  }
  /**
   * Define a new {@link StyleProp}.
   *
   * @param uniqueId - Each StyleProp must have a unique ID. We recommend you prefix this with
   * your app/library name.
   * @param options -
   * - `defaultValue`: The default value for this style prop.
   *
   * - `type`: Optionally, describe what type of data you expect for this style prop.
   *
   * @example
   * ```ts
   * import {T} from '@tldraw/validate'
   * import {StyleProp} from '@tldraw/tlschema'
   *
   * const MyLineWidthProp = StyleProp.define('myApp:lineWidth', {
   *   defaultValue: 1,
   *   type: T.number,
   * })
   * ```
   * @public
   */
  static define(uniqueId2, options) {
    const { defaultValue, type = validation_exports.any } = options;
    return new _StyleProp(uniqueId2, defaultValue, type);
  }
  /**
   * Define a new {@link StyleProp} as a list of possible values.
   *
   * @param uniqueId - Each StyleProp must have a unique ID. We recommend you prefix this with
   * your app/library name.
   * @param options -
   * - `defaultValue`: The default value for this style prop.
   *
   * - `values`: An array of possible values of this style prop.
   *
   * @example
   * ```ts
   * import {StyleProp} from '@tldraw/tlschema'
   *
   * const MySizeProp = StyleProp.defineEnum('myApp:size', {
   *   defaultValue: 'medium',
   *   values: ['small', 'medium', 'large'],
   * })
   * ```
   */
  static defineEnum(uniqueId2, options) {
    const { defaultValue, values } = options;
    return new EnumStyleProp(uniqueId2, defaultValue, values);
  }
  setDefaultValue(value) {
    this.defaultValue = value;
  }
  validate(value) {
    return this.type.validate(value);
  }
  validateUsingKnownGoodVersion(prevValue, newValue) {
    if (this.type.validateUsingKnownGoodVersion) {
      return this.type.validateUsingKnownGoodVersion(prevValue, newValue);
    } else {
      return this.validate(newValue);
    }
  }
};
var EnumStyleProp = class extends StyleProp {
  /** @internal */
  constructor(id, defaultValue, values) {
    super(id, defaultValue, validation_exports.literalEnum(...values));
    this.values = values;
  }
};

// node_modules/@tldraw/tlschema/dist-esm/records/TLShape.mjs
var rootShapeVersions = createMigrationIds("com.tldraw.shape", {
  AddIsLocked: 1,
  HoistOpacity: 2,
  AddMeta: 3,
  AddWhite: 4
});
var rootShapeMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.shape",
  recordType: "shape",
  sequence: [
    {
      id: rootShapeVersions.AddIsLocked,
      up: (record) => {
        record.isLocked = false;
      },
      down: (record) => {
        delete record.isLocked;
      }
    },
    {
      id: rootShapeVersions.HoistOpacity,
      up: (record) => {
        record.opacity = Number(record.props.opacity ?? "1");
        delete record.props.opacity;
      },
      down: (record) => {
        const opacity = record.opacity;
        delete record.opacity;
        record.props.opacity = opacity < 0.175 ? "0.1" : opacity < 0.375 ? "0.25" : opacity < 0.625 ? "0.5" : opacity < 0.875 ? "0.75" : "1";
      }
    },
    {
      id: rootShapeVersions.AddMeta,
      up: (record) => {
        record.meta = {};
      }
    },
    {
      id: rootShapeVersions.AddWhite,
      up: (_record) => {
      },
      down: (record) => {
        if (record.props.color === "white") {
          record.props.color = "black";
        }
      }
    }
  ]
});
function isShape(record) {
  if (!record) return false;
  return record.typeName === "shape";
}
function isShapeId(id) {
  if (!id) return false;
  return id.startsWith("shape:");
}
function createShapeId(id) {
  return `shape:${id ?? uniqueId()}`;
}
function getShapePropKeysByStyle(props) {
  const propKeysByStyle = /* @__PURE__ */ new Map();
  for (const [key, prop] of Object.entries(props)) {
    if (prop instanceof StyleProp) {
      if (propKeysByStyle.has(prop)) {
        throw new Error(
          `Duplicate style prop ${prop.id}. Each style prop can only be used once within a shape.`
        );
      }
      propKeysByStyle.set(prop, key);
    }
  }
  return propKeysByStyle;
}
function createShapePropsMigrationSequence(migrations) {
  return migrations;
}
function createShapePropsMigrationIds(shapeType, ids) {
  return mapObjectMapValues(ids, (_k, v) => `com.tldraw.shape.${shapeType}/${v}`);
}
function createShapeRecordType(shapes) {
  return createRecordType("shape", {
    scope: "document",
    validator: validation_exports.model(
      "shape",
      validation_exports.union(
        "type",
        mapObjectMapValues(
          shapes,
          (type, { props, meta }) => createShapeValidator(type, props, meta)
        )
      )
    )
  }).withDefaultProperties(() => ({
    x: 0,
    y: 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {}
  }));
}

// node_modules/@tldraw/tlschema/dist-esm/recordsWithProps.mjs
function processPropsMigrations(typeName, records) {
  const result = [];
  for (const [subType, { migrations }] of Object.entries(records)) {
    const sequenceId = `com.tldraw.${typeName}.${subType}`;
    if (!migrations) {
      result.push(
        createMigrationSequence({
          sequenceId,
          retroactive: true,
          sequence: []
        })
      );
    } else if ("sequenceId" in migrations) {
      assert(
        sequenceId === migrations.sequenceId,
        `sequenceId mismatch for ${subType} ${RecordType} migrations. Expected '${sequenceId}', got '${migrations.sequenceId}'`
      );
      result.push(migrations);
    } else if ("sequence" in migrations) {
      result.push(
        createMigrationSequence({
          sequenceId,
          retroactive: true,
          sequence: migrations.sequence.map(
            (m) => "id" in m ? createPropsMigration(typeName, subType, m) : m
          )
        })
      );
    } else {
      result.push(
        createMigrationSequence({
          sequenceId,
          retroactive: true,
          sequence: Object.keys(migrations.migrators).map((k) => Number(k)).sort((a, b) => a - b).map(
            (version) => ({
              id: `${sequenceId}/${version}`,
              scope: "record",
              filter: (r) => r.typeName === typeName && r.type === subType,
              up: (record) => {
                const result2 = migrations.migrators[version].up(record);
                if (result2) {
                  return result2;
                }
              },
              down: (record) => {
                const result2 = migrations.migrators[version].down(record);
                if (result2) {
                  return result2;
                }
              }
            })
          )
        })
      );
    }
  }
  return result;
}
function createPropsMigration(typeName, subType, m) {
  return {
    id: m.id,
    dependsOn: m.dependsOn,
    scope: "record",
    filter: (r) => r.typeName === typeName && r.type === subType,
    up: (record) => {
      const result = m.up(record.props);
      if (result) {
        record.props = result;
      }
    },
    down: typeof m.down === "function" ? (record) => {
      const result = m.down(record.props);
      if (result) {
        record.props = result;
      }
    } : void 0
  };
}

// node_modules/@tldraw/tlschema/dist-esm/styles/TLColorStyle.mjs
var defaultColorNames = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "white"
];
var DefaultColorThemePalette = {
  lightMode: {
    id: "light",
    text: "#000000",
    background: "#f9fafb",
    solid: "#fcfffe",
    black: {
      solid: "#1d1d1d",
      fill: "#1d1d1d",
      frame: {
        headingStroke: "#717171",
        headingFill: "#ffffff",
        stroke: "#717171",
        fill: "#ffffff",
        text: "#000000"
      },
      note: {
        fill: "#FCE19C",
        text: "#000000"
      },
      semi: "#e8e8e8",
      pattern: "#494949",
      highlight: {
        srgb: "#fddd00",
        p3: "color(display-p3 0.972 0.8205 0.05)"
      }
    },
    blue: {
      solid: "#4465e9",
      fill: "#4465e9",
      frame: {
        headingStroke: "#6681ec",
        headingFill: "#f9fafe",
        stroke: "#6681ec",
        fill: "#f9fafe",
        text: "#000000"
      },
      note: {
        fill: "#8AA3FF",
        text: "#000000"
      },
      semi: "#dce1f8",
      pattern: "#6681ee",
      highlight: {
        srgb: "#10acff",
        p3: "color(display-p3 0.308 0.6632 0.9996)"
      }
    },
    green: {
      solid: "#099268",
      fill: "#099268",
      frame: {
        headingStroke: "#37a684",
        headingFill: "#f8fcfa",
        stroke: "#37a684",
        fill: "#f8fcfa",
        text: "#000000"
      },
      note: {
        fill: "#6FC896",
        text: "#000000"
      },
      semi: "#d3e9e3",
      pattern: "#39a785",
      highlight: {
        srgb: "#00ffc8",
        p3: "color(display-p3 0.2536 0.984 0.7981)"
      }
    },
    grey: {
      solid: "#9fa8b2",
      fill: "#9fa8b2",
      frame: {
        headingStroke: "#aaaaab",
        headingFill: "#fbfcfc",
        stroke: "#aaaaab",
        fill: "#fcfcfd",
        text: "#000000"
      },
      note: {
        fill: "#C0CAD3",
        text: "#000000"
      },
      semi: "#eceef0",
      pattern: "#bcc3c9",
      highlight: {
        srgb: "#cbe7f1",
        p3: "color(display-p3 0.8163 0.9023 0.9416)"
      }
    },
    "light-blue": {
      solid: "#4ba1f1",
      fill: "#4ba1f1",
      frame: {
        headingStroke: "#6cb2f3",
        headingFill: "#f8fbfe",
        stroke: "#6cb2f3",
        fill: "#fafcff",
        text: "#000000"
      },
      note: {
        fill: "#9BC4FD",
        text: "#000000"
      },
      semi: "#ddedfa",
      pattern: "#6fbbf8",
      highlight: {
        srgb: "#00f4ff",
        p3: "color(display-p3 0.1512 0.9414 0.9996)"
      }
    },
    "light-green": {
      solid: "#4cb05e",
      fill: "#4cb05e",
      frame: {
        headingStroke: "#6dbe7c",
        headingFill: "#f8fcf9",
        stroke: "#6dbe7c",
        fill: "#fafdfa",
        text: "#000000"
      },
      note: {
        fill: "#98D08A",
        text: "#000000"
      },
      semi: "#dbf0e0",
      pattern: "#65cb78",
      highlight: {
        srgb: "#65f641",
        p3: "color(display-p3 0.563 0.9495 0.3857)"
      }
    },
    "light-red": {
      solid: "#f87777",
      fill: "#f87777",
      frame: {
        headingStroke: "#f89090",
        headingFill: "#fffafa",
        stroke: "#f89090",
        fill: "#fffbfb",
        text: "#000000"
      },
      note: {
        fill: "#F7A5A1",
        text: "#000000"
      },
      semi: "#f4dadb",
      pattern: "#fe9e9e",
      highlight: {
        srgb: "#ff7fa3",
        p3: "color(display-p3 0.9988 0.5301 0.6397)"
      }
    },
    "light-violet": {
      solid: "#e085f4",
      fill: "#e085f4",
      frame: {
        headingStroke: "#e59bf5",
        headingFill: "#fefaff",
        stroke: "#e59bf5",
        fill: "#fefbff",
        text: "#000000"
      },
      note: {
        fill: "#DFB0F9",
        text: "#000000"
      },
      semi: "#f5eafa",
      pattern: "#e9acf8",
      highlight: {
        srgb: "#ff88ff",
        p3: "color(display-p3 0.9676 0.5652 0.9999)"
      }
    },
    orange: {
      solid: "#e16919",
      fill: "#e16919",
      frame: {
        headingStroke: "#e68544",
        headingFill: "#fef9f6",
        stroke: "#e68544",
        fill: "#fef9f6",
        text: "#000000"
      },
      note: {
        fill: "#FAA475",
        text: "#000000"
      },
      semi: "#f8e2d4",
      pattern: "#f78438",
      highlight: {
        srgb: "#ffa500",
        p3: "color(display-p3 0.9988 0.6905 0.266)"
      }
    },
    red: {
      solid: "#e03131",
      fill: "#e03131",
      frame: {
        headingStroke: "#e55757",
        headingFill: "#fef7f7",
        stroke: "#e55757",
        fill: "#fef9f9",
        text: "#000000"
      },
      note: {
        fill: "#FC8282",
        text: "#000000"
      },
      semi: "#f4dadb",
      pattern: "#e55959",
      highlight: {
        srgb: "#ff636e",
        p3: "color(display-p3 0.9992 0.4376 0.45)"
      }
    },
    violet: {
      solid: "#ae3ec9",
      fill: "#ae3ec9",
      frame: {
        headingStroke: "#bc62d3",
        headingFill: "#fcf7fd",
        stroke: "#bc62d3",
        fill: "#fdf9fd",
        text: "#000000"
      },
      note: {
        fill: "#DB91FD",
        text: "#000000"
      },
      semi: "#ecdcf2",
      pattern: "#bd63d3",
      highlight: {
        srgb: "#c77cff",
        p3: "color(display-p3 0.7469 0.5089 0.9995)"
      }
    },
    yellow: {
      solid: "#f1ac4b",
      fill: "#f1ac4b",
      frame: {
        headingStroke: "#f3bb6c",
        headingFill: "#fefcf8",
        stroke: "#f3bb6c",
        fill: "#fffdfa",
        text: "#000000"
      },
      note: {
        fill: "#FED49A",
        text: "#000000"
      },
      semi: "#f9f0e6",
      pattern: "#fecb92",
      highlight: {
        srgb: "#fddd00",
        p3: "color(display-p3 0.972 0.8705 0.05)"
      }
    },
    white: {
      solid: "#FFFFFF",
      fill: "#FFFFFF",
      semi: "#f5f5f5",
      pattern: "#f9f9f9",
      frame: {
        headingStroke: "#7d7d7d",
        headingFill: "#ffffff",
        stroke: "#7d7d7d",
        fill: "#ffffff",
        text: "#000000"
      },
      note: {
        fill: "#FFFFFF",
        text: "#000000"
      },
      highlight: {
        srgb: "#ffffff",
        p3: "color(display-p3 1 1 1)"
      }
    }
  },
  darkMode: {
    id: "dark",
    text: "hsl(210, 17%, 98%)",
    background: "hsl(240, 5%, 6.5%)",
    solid: "#010403",
    black: {
      solid: "#f2f2f2",
      fill: "#f2f2f2",
      frame: {
        headingStroke: "#5c5c5c",
        headingFill: "#252525",
        stroke: "#5c5c5c",
        fill: "#0c0c0c",
        text: "#f2f2f2"
      },
      note: {
        fill: "#2c2c2c",
        text: "#f2f2f2"
      },
      semi: "#2c3036",
      pattern: "#989898",
      highlight: {
        srgb: "#d2b700",
        p3: "color(display-p3 0.8078 0.6225 0.0312)"
      }
    },
    blue: {
      solid: "#4f72fc",
      // 3c60f0
      fill: "#4f72fc",
      frame: {
        headingStroke: "#384994",
        headingFill: "#1C2036",
        stroke: "#384994",
        fill: "#11141f",
        text: "#f2f2f2"
      },
      note: {
        fill: "#2A3F98",
        text: "#f2f2f2"
      },
      semi: "#262d40",
      pattern: "#3a4b9e",
      highlight: {
        srgb: "#0079d2",
        p3: "color(display-p3 0.0032 0.4655 0.7991)"
      }
    },
    green: {
      solid: "#099268",
      fill: "#099268",
      frame: {
        headingStroke: "#10513C",
        headingFill: "#14241f",
        stroke: "#10513C",
        fill: "#0E1614",
        text: "#f2f2f2"
      },
      note: {
        fill: "#014429",
        text: "#f2f2f2"
      },
      semi: "#253231",
      pattern: "#366a53",
      highlight: {
        srgb: "#009774",
        p3: "color(display-p3 0.0085 0.582 0.4604)"
      }
    },
    grey: {
      solid: "#9398b0",
      fill: "#9398b0",
      frame: {
        headingStroke: "#42474D",
        headingFill: "#23262A",
        stroke: "#42474D",
        fill: "#151719",
        text: "#f2f2f2"
      },
      note: {
        fill: "#56595F",
        text: "#f2f2f2"
      },
      semi: "#33373c",
      pattern: "#7c8187",
      highlight: {
        srgb: "#9cb4cb",
        p3: "color(display-p3 0.6299 0.7012 0.7856)"
      }
    },
    "light-blue": {
      solid: "#4dabf7",
      fill: "#4dabf7",
      frame: {
        headingStroke: "#075797",
        headingFill: "#142839",
        stroke: "#075797",
        fill: "#0B1823",
        text: "#f2f2f2"
      },
      note: {
        fill: "#1F5495",
        text: "#f2f2f2"
      },
      semi: "#2a3642",
      pattern: "#4d7aa9",
      highlight: {
        srgb: "#00bdc8",
        p3: "color(display-p3 0.0023 0.7259 0.7735)"
      }
    },
    "light-green": {
      solid: "#40c057",
      fill: "#40c057",
      frame: {
        headingStroke: "#1C5427",
        headingFill: "#18251A",
        stroke: "#1C5427",
        fill: "#0F1911",
        text: "#f2f2f2"
      },
      note: {
        fill: "#21581D",
        text: "#f2f2f2"
      },
      semi: "#2a3830",
      pattern: "#4e874e",
      highlight: {
        srgb: "#00a000",
        p3: "color(display-p3 0.2711 0.6172 0.0195)"
      }
    },
    "light-red": {
      solid: "#ff8787",
      fill: "#ff8787",
      frame: {
        headingStroke: "#6f3232",
        // Darker and desaturated variant of solid
        headingFill: "#341818",
        // Deep, muted dark red
        stroke: "#6f3232",
        // Matches headingStroke
        fill: "#181212",
        // Darker, muted background shade
        text: "#f2f2f2"
        // Consistent bright text color
      },
      note: {
        fill: "#7a3333",
        // Medium-dark, muted variant of solid
        text: "#f2f2f2"
      },
      semi: "#3c2b2b",
      // Subdued, darker neutral-red tone
      pattern: "#a56767",
      // Existing pattern shade retained
      highlight: {
        srgb: "#db005b",
        p3: "color(display-p3 0.7849 0.0585 0.3589)"
      }
    },
    "light-violet": {
      solid: "#e599f7",
      fill: "#e599f7",
      frame: {
        headingStroke: "#6c367a",
        headingFill: "#2D2230",
        stroke: "#6c367a",
        fill: "#1C151E",
        text: "#f2f2f2"
      },
      note: {
        fill: "#762F8E",
        text: "#f2f2f2"
      },
      semi: "#383442",
      pattern: "#9770a9",
      highlight: {
        srgb: "#c400c7",
        p3: "color(display-p3 0.7024 0.0403 0.753)"
      }
    },
    orange: {
      solid: "#f76707",
      fill: "#f76707",
      frame: {
        headingStroke: "#773a0e",
        // Darker, muted version of solid
        headingFill: "#2f1d13",
        // Deep, warm, muted background
        stroke: "#773a0e",
        // Matches headingStroke
        fill: "#1c1512",
        // Darker, richer muted background
        text: "#f2f2f2"
        // Bright text for contrast
      },
      note: {
        fill: "#7c3905",
        // Muted dark variant for note fill
        text: "#f2f2f2"
      },
      semi: "#3b2e27",
      // Muted neutral-orange tone
      pattern: "#9f552d",
      // Retained existing shade
      highlight: {
        srgb: "#d07a00",
        p3: "color(display-p3 0.7699 0.4937 0.0085)"
      }
    },
    red: {
      solid: "#e03131",
      fill: "#e03131",
      frame: {
        headingStroke: "#701e1e",
        // Darker, muted variation of solid
        headingFill: "#301616",
        // Deep, muted reddish backdrop
        stroke: "#701e1e",
        // Matches headingStroke
        fill: "#1b1313",
        // Rich, dark muted background
        text: "#f2f2f2"
        // Bright text for readability
      },
      note: {
        fill: "#7e201f",
        // Muted dark variant for note fill
        text: "#f2f2f2"
      },
      semi: "#382726",
      // Dark neutral-red tone
      pattern: "#8f3734",
      // Existing pattern color retained
      highlight: {
        srgb: "#de002c",
        p3: "color(display-p3 0.7978 0.0509 0.2035)"
      }
    },
    violet: {
      solid: "#ae3ec9",
      fill: "#ae3ec9",
      frame: {
        headingStroke: "#6d1583",
        // Darker, muted variation of solid
        headingFill: "#27152e",
        // Deep, rich muted violet backdrop
        stroke: "#6d1583",
        // Matches headingStroke
        fill: "#1b0f21",
        // Darker muted violet background
        text: "#f2f2f2"
        // Consistent bright text color
      },
      note: {
        fill: "#5f1c70",
        // Muted dark variant for note fill
        text: "#f2f2f2"
      },
      semi: "#342938",
      // Dark neutral-violet tone
      pattern: "#763a8b",
      // Retained existing pattern color
      highlight: {
        srgb: "#9e00ee",
        p3: "color(display-p3 0.5651 0.0079 0.8986)"
      }
    },
    yellow: {
      solid: "#ffc034",
      fill: "#ffc034",
      frame: {
        headingStroke: "#684e12",
        // Darker, muted variant of solid
        headingFill: "#2a2113",
        // Rich, muted dark-yellow background
        stroke: "#684e12",
        // Matches headingStroke
        fill: "#1e1911",
        // Darker muted shade for background fill
        text: "#f2f2f2"
        // Bright text color for readability
      },
      note: {
        fill: "#8a5e1c",
        // Muted, dark complementary variant
        text: "#f2f2f2"
      },
      semi: "#3b352b",
      // Dark muted neutral-yellow tone
      pattern: "#fecb92",
      // Existing shade retained
      highlight: {
        srgb: "#d2b700",
        p3: "color(display-p3 0.8078 0.7225 0.0312)"
      }
    },
    white: {
      solid: "#f3f3f3",
      fill: "#f3f3f3",
      semi: "#f5f5f5",
      pattern: "#f9f9f9",
      frame: {
        headingStroke: "#ffffff",
        headingFill: "#ffffff",
        stroke: "#ffffff",
        fill: "#ffffff",
        text: "#000000"
      },
      note: {
        fill: "#eaeaea",
        text: "#1d1d1d"
      },
      highlight: {
        srgb: "#ffffff",
        p3: "color(display-p3 1 1 1)"
      }
    }
  }
};
function getDefaultColorTheme(opts) {
  return opts.isDarkMode ? DefaultColorThemePalette.darkMode : DefaultColorThemePalette.lightMode;
}
var DefaultColorStyle = StyleProp.defineEnum("tldraw:color", {
  defaultValue: "black",
  values: defaultColorNames
});
var DefaultLabelColorStyle = StyleProp.defineEnum("tldraw:labelColor", {
  defaultValue: "black",
  values: defaultColorNames
});

// node_modules/@tldraw/tlschema/dist-esm/styles/TLDashStyle.mjs
var DefaultDashStyle = StyleProp.defineEnum("tldraw:dash", {
  defaultValue: "draw",
  values: ["draw", "solid", "dashed", "dotted"]
});

// node_modules/@tldraw/tlschema/dist-esm/styles/TLFillStyle.mjs
var DefaultFillStyle = StyleProp.defineEnum("tldraw:fill", {
  defaultValue: "none",
  values: ["none", "semi", "solid", "pattern", "fill"]
});

// node_modules/@tldraw/tlschema/dist-esm/styles/TLFontStyle.mjs
var DefaultFontStyle = StyleProp.defineEnum("tldraw:font", {
  defaultValue: "draw",
  values: ["draw", "sans", "serif", "mono"]
});
var DefaultFontFamilies = {
  draw: "'tldraw_draw', sans-serif",
  sans: "'tldraw_sans', sans-serif",
  serif: "'tldraw_serif', serif",
  mono: "'tldraw_mono', monospace"
};

// node_modules/@tldraw/tlschema/dist-esm/styles/TLSizeStyle.mjs
var DefaultSizeStyle = StyleProp.defineEnum("tldraw:size", {
  defaultValue: "m",
  values: ["s", "m", "l", "xl"]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLArrowShape.mjs
var arrowKinds = ["arc", "elbow"];
var ArrowShapeKindStyle = StyleProp.defineEnum("tldraw:arrowKind", {
  defaultValue: "arc",
  values: arrowKinds
});
var arrowheadTypes = [
  "arrow",
  "triangle",
  "square",
  "dot",
  "pipe",
  "diamond",
  "inverted",
  "bar",
  "none"
];
var ArrowShapeArrowheadStartStyle = StyleProp.defineEnum("tldraw:arrowheadStart", {
  defaultValue: "none",
  values: arrowheadTypes
});
var ArrowShapeArrowheadEndStyle = StyleProp.defineEnum("tldraw:arrowheadEnd", {
  defaultValue: "arrow",
  values: arrowheadTypes
});
var arrowShapeProps = {
  kind: ArrowShapeKindStyle,
  labelColor: DefaultLabelColorStyle,
  color: DefaultColorStyle,
  fill: DefaultFillStyle,
  dash: DefaultDashStyle,
  size: DefaultSizeStyle,
  arrowheadStart: ArrowShapeArrowheadStartStyle,
  arrowheadEnd: ArrowShapeArrowheadEndStyle,
  font: DefaultFontStyle,
  start: vecModelValidator,
  end: vecModelValidator,
  bend: validation_exports.number,
  text: validation_exports.string,
  labelPosition: validation_exports.number,
  scale: validation_exports.nonZeroNumber,
  elbowMidPoint: validation_exports.number
};
var arrowShapeVersions = createShapePropsMigrationIds("arrow", {
  AddLabelColor: 1,
  AddIsPrecise: 2,
  AddLabelPosition: 3,
  ExtractBindings: 4,
  AddScale: 5,
  AddElbow: 6
});
function propsMigration(migration) {
  return createPropsMigration("shape", "arrow", migration);
}
var arrowShapeMigrations = createMigrationSequence({
  sequenceId: "com.tldraw.shape.arrow",
  retroactive: false,
  sequence: [
    propsMigration({
      id: arrowShapeVersions.AddLabelColor,
      up: (props) => {
        props.labelColor = "black";
      },
      down: "retired"
    }),
    propsMigration({
      id: arrowShapeVersions.AddIsPrecise,
      up: ({ start, end }) => {
        if (start.type === "binding") {
          start.isPrecise = !(start.normalizedAnchor.x === 0.5 && start.normalizedAnchor.y === 0.5);
        }
        if (end.type === "binding") {
          end.isPrecise = !(end.normalizedAnchor.x === 0.5 && end.normalizedAnchor.y === 0.5);
        }
      },
      down: ({ start, end }) => {
        if (start.type === "binding") {
          if (!start.isPrecise) {
            start.normalizedAnchor = { x: 0.5, y: 0.5 };
          }
          delete start.isPrecise;
        }
        if (end.type === "binding") {
          if (!end.isPrecise) {
            end.normalizedAnchor = { x: 0.5, y: 0.5 };
          }
          delete end.isPrecise;
        }
      }
    }),
    propsMigration({
      id: arrowShapeVersions.AddLabelPosition,
      up: (props) => {
        props.labelPosition = 0.5;
      },
      down: (props) => {
        delete props.labelPosition;
      }
    }),
    {
      id: arrowShapeVersions.ExtractBindings,
      scope: "store",
      up: (oldStore) => {
        const arrows = Object.values(oldStore).filter(
          (r) => r.typeName === "shape" && r.type === "arrow"
        );
        for (const arrow of arrows) {
          const { start, end } = arrow.props;
          if (start.type === "binding") {
            const id = createBindingId();
            const binding = {
              typeName: "binding",
              id,
              type: "arrow",
              fromId: arrow.id,
              toId: start.boundShapeId,
              meta: {},
              props: {
                terminal: "start",
                normalizedAnchor: start.normalizedAnchor,
                isExact: start.isExact,
                isPrecise: start.isPrecise
              }
            };
            oldStore[id] = binding;
            arrow.props.start = { x: 0, y: 0 };
          } else {
            delete arrow.props.start.type;
          }
          if (end.type === "binding") {
            const id = createBindingId();
            const binding = {
              typeName: "binding",
              id,
              type: "arrow",
              fromId: arrow.id,
              toId: end.boundShapeId,
              meta: {},
              props: {
                terminal: "end",
                normalizedAnchor: end.normalizedAnchor,
                isExact: end.isExact,
                isPrecise: end.isPrecise
              }
            };
            oldStore[id] = binding;
            arrow.props.end = { x: 0, y: 0 };
          } else {
            delete arrow.props.end.type;
          }
        }
      }
    },
    propsMigration({
      id: arrowShapeVersions.AddScale,
      up: (props) => {
        props.scale = 1;
      },
      down: (props) => {
        delete props.scale;
      }
    }),
    propsMigration({
      id: arrowShapeVersions.AddElbow,
      up: (props) => {
        props.kind = "arc";
        props.elbowMidPoint = 0.5;
      },
      down: (props) => {
        delete props.kind;
        delete props.elbowMidPoint;
      }
    })
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/bindings/TLArrowBinding.mjs
var ElbowArrowSnap = validation_exports.literalEnum("center", "edge-point", "edge", "none");
var arrowBindingProps = {
  terminal: validation_exports.literalEnum("start", "end"),
  normalizedAnchor: vecModelValidator,
  isExact: validation_exports.boolean,
  isPrecise: validation_exports.boolean,
  snap: ElbowArrowSnap
};
var arrowBindingVersions = createBindingPropsMigrationIds("arrow", {
  AddSnap: 1
});
var arrowBindingMigrations = createBindingPropsMigrationSequence({
  sequence: [
    { dependsOn: [arrowShapeVersions.ExtractBindings] },
    {
      id: arrowBindingVersions.AddSnap,
      up: (props) => {
        props.snap = "none";
      },
      down: (props) => {
        delete props.snap;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/records/TLCamera.mjs
var cameraValidator = validation_exports.model(
  "camera",
  validation_exports.object({
    typeName: validation_exports.literal("camera"),
    id: idValidator("camera"),
    x: validation_exports.number,
    y: validation_exports.number,
    z: validation_exports.number,
    meta: validation_exports.jsonValue
  })
);
var cameraVersions = createMigrationIds("com.tldraw.camera", {
  AddMeta: 1
});
var cameraMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.camera",
  recordType: "camera",
  sequence: [
    {
      id: cameraVersions.AddMeta,
      up: (record) => {
        ;
        record.meta = {};
      }
    }
  ]
});
var CameraRecordType = createRecordType("camera", {
  validator: cameraValidator,
  scope: "session"
}).withDefaultProperties(
  () => ({
    x: 0,
    y: 0,
    z: 1,
    meta: {}
  })
);

// node_modules/@tldraw/tlschema/dist-esm/misc/TLCursor.mjs
var TL_CURSOR_TYPES = /* @__PURE__ */ new Set([
  "none",
  "default",
  "pointer",
  "cross",
  "grab",
  "rotate",
  "grabbing",
  "resize-edge",
  "resize-corner",
  "text",
  "move",
  "ew-resize",
  "ns-resize",
  "nesw-resize",
  "nwse-resize",
  "nesw-rotate",
  "nwse-rotate",
  "swne-rotate",
  "senw-rotate",
  "zoom-in",
  "zoom-out"
]);
var cursorTypeValidator = validation_exports.setEnum(TL_CURSOR_TYPES);
var cursorValidator = validation_exports.object({
  type: cursorTypeValidator,
  rotation: validation_exports.number
});

// node_modules/@tldraw/tlschema/dist-esm/misc/TLColor.mjs
var TL_CANVAS_UI_COLOR_TYPES = /* @__PURE__ */ new Set([
  "accent",
  "white",
  "black",
  "selection-stroke",
  "selection-fill",
  "laser",
  "muted-1"
]);
var canvasUiColorTypeValidator = validation_exports.setEnum(TL_CANVAS_UI_COLOR_TYPES);

// node_modules/@tldraw/tlschema/dist-esm/misc/TLScribble.mjs
var TL_SCRIBBLE_STATES = /* @__PURE__ */ new Set(["starting", "paused", "active", "stopping"]);
var scribbleValidator = validation_exports.object({
  id: validation_exports.string,
  points: validation_exports.arrayOf(vecModelValidator),
  size: validation_exports.positiveNumber,
  color: canvasUiColorTypeValidator,
  opacity: validation_exports.number,
  state: validation_exports.setEnum(TL_SCRIBBLE_STATES),
  delay: validation_exports.number,
  shrink: validation_exports.number,
  taper: validation_exports.boolean
});

// node_modules/@tldraw/tlschema/dist-esm/records/TLPage.mjs
var pageIdValidator = idValidator("page");
var pageValidator = validation_exports.model(
  "page",
  validation_exports.object({
    typeName: validation_exports.literal("page"),
    id: pageIdValidator,
    name: validation_exports.string,
    index: validation_exports.indexKey,
    meta: validation_exports.jsonValue
  })
);
var pageVersions = createMigrationIds("com.tldraw.page", {
  AddMeta: 1
});
var pageMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.page",
  recordType: "page",
  sequence: [
    {
      id: pageVersions.AddMeta,
      up: (record) => {
        record.meta = {};
      }
    }
  ]
});
var PageRecordType = createRecordType("page", {
  validator: pageValidator,
  scope: "document"
}).withDefaultProperties(() => ({
  meta: {}
}));
function isPageId(id) {
  return PageRecordType.isId(id);
}

// node_modules/@tldraw/tlschema/dist-esm/records/TLInstance.mjs
var shouldKeyBePreservedBetweenSessions = {
  // This object defines keys that should be preserved across calls to loadSnapshot()
  id: false,
  // meta
  typeName: false,
  // meta
  currentPageId: false,
  // does not preserve because who knows if the page still exists
  opacityForNextShape: false,
  // does not preserve because it's a temporary state
  stylesForNextShape: false,
  // does not preserve because it's a temporary state
  followingUserId: false,
  // does not preserve because it's a temporary state
  highlightedUserIds: false,
  // does not preserve because it's a temporary state
  brush: false,
  // does not preserve because it's a temporary state
  cursor: false,
  // does not preserve because it's a temporary state
  scribbles: false,
  // does not preserve because it's a temporary state
  isFocusMode: true,
  // preserves because it's a user preference
  isDebugMode: true,
  // preserves because it's a user preference
  isToolLocked: true,
  // preserves because it's a user preference
  exportBackground: true,
  // preserves because it's a user preference
  screenBounds: true,
  // preserves because it's capturing the user's screen state
  insets: true,
  // preserves because it's capturing the user's screen state
  zoomBrush: false,
  // does not preserve because it's a temporary state
  chatMessage: false,
  // does not preserve because it's a temporary state
  isChatting: false,
  // does not preserve because it's a temporary state
  isPenMode: false,
  // does not preserve because it's a temporary state
  isGridMode: true,
  // preserves because it's a user preference
  isFocused: true,
  // preserves because obviously
  devicePixelRatio: true,
  // preserves because it captures the user's screen state
  isCoarsePointer: true,
  // preserves because it captures the user's screen state
  isHoveringCanvas: false,
  // does not preserve because it's a temporary state
  openMenus: false,
  // does not preserve because it's a temporary state
  isChangingStyle: false,
  // does not preserve because it's a temporary state
  isReadonly: true,
  // preserves because it's a config option
  meta: false,
  // does not preserve because who knows what's in there, leave it up to sdk users to save and reinstate
  duplicateProps: false
  //
};
function pluckPreservingValues(val) {
  return val ? filterEntries(val, (key) => {
    return shouldKeyBePreservedBetweenSessions[key];
  }) : null;
}
var instanceIdValidator = idValidator("instance");
function createInstanceRecordType(stylesById) {
  const stylesForNextShapeValidators = {};
  for (const [id, style] of stylesById) {
    stylesForNextShapeValidators[id] = validation_exports.optional(style);
  }
  const instanceTypeValidator = validation_exports.model(
    "instance",
    validation_exports.object({
      typeName: validation_exports.literal("instance"),
      id: idValidator("instance"),
      currentPageId: pageIdValidator,
      followingUserId: validation_exports.string.nullable(),
      brush: boxModelValidator.nullable(),
      opacityForNextShape: opacityValidator,
      stylesForNextShape: validation_exports.object(stylesForNextShapeValidators),
      cursor: cursorValidator,
      scribbles: validation_exports.arrayOf(scribbleValidator),
      isFocusMode: validation_exports.boolean,
      isDebugMode: validation_exports.boolean,
      isToolLocked: validation_exports.boolean,
      exportBackground: validation_exports.boolean,
      screenBounds: boxModelValidator,
      insets: validation_exports.arrayOf(validation_exports.boolean),
      zoomBrush: boxModelValidator.nullable(),
      isPenMode: validation_exports.boolean,
      isGridMode: validation_exports.boolean,
      chatMessage: validation_exports.string,
      isChatting: validation_exports.boolean,
      highlightedUserIds: validation_exports.arrayOf(validation_exports.string),
      isFocused: validation_exports.boolean,
      devicePixelRatio: validation_exports.number,
      isCoarsePointer: validation_exports.boolean,
      isHoveringCanvas: validation_exports.boolean.nullable(),
      openMenus: validation_exports.arrayOf(validation_exports.string),
      isChangingStyle: validation_exports.boolean,
      isReadonly: validation_exports.boolean,
      meta: validation_exports.jsonValue,
      duplicateProps: validation_exports.object({
        shapeIds: validation_exports.arrayOf(idValidator("shape")),
        offset: validation_exports.object({
          x: validation_exports.number,
          y: validation_exports.number
        })
      }).nullable()
    })
  );
  return createRecordType("instance", {
    validator: instanceTypeValidator,
    scope: "session",
    ephemeralKeys: {
      currentPageId: false,
      meta: false,
      followingUserId: true,
      opacityForNextShape: true,
      stylesForNextShape: true,
      brush: true,
      cursor: true,
      scribbles: true,
      isFocusMode: true,
      isDebugMode: true,
      isToolLocked: true,
      exportBackground: true,
      screenBounds: true,
      insets: true,
      zoomBrush: true,
      isPenMode: true,
      isGridMode: true,
      chatMessage: true,
      isChatting: true,
      highlightedUserIds: true,
      isFocused: true,
      devicePixelRatio: true,
      isCoarsePointer: true,
      isHoveringCanvas: true,
      openMenus: true,
      isChangingStyle: true,
      isReadonly: true,
      duplicateProps: true
    }
  }).withDefaultProperties(
    () => ({
      followingUserId: null,
      opacityForNextShape: 1,
      stylesForNextShape: {},
      brush: null,
      scribbles: [],
      cursor: {
        type: "default",
        rotation: 0
      },
      isFocusMode: false,
      exportBackground: false,
      isDebugMode: false,
      isToolLocked: false,
      screenBounds: { x: 0, y: 0, w: 1080, h: 720 },
      insets: [false, false, false, false],
      zoomBrush: null,
      isGridMode: false,
      isPenMode: false,
      chatMessage: "",
      isChatting: false,
      highlightedUserIds: [],
      isFocused: false,
      devicePixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
      isCoarsePointer: false,
      isHoveringCanvas: null,
      openMenus: [],
      isChangingStyle: false,
      isReadonly: false,
      meta: {},
      duplicateProps: null
    })
  );
}
var instanceVersions = createMigrationIds("com.tldraw.instance", {
  AddTransparentExportBgs: 1,
  RemoveDialog: 2,
  AddToolLockMode: 3,
  RemoveExtraPropsForNextShape: 4,
  AddLabelColor: 5,
  AddFollowingUserId: 6,
  RemoveAlignJustify: 7,
  AddZoom: 8,
  AddVerticalAlign: 9,
  AddScribbleDelay: 10,
  RemoveUserId: 11,
  AddIsPenModeAndIsGridMode: 12,
  HoistOpacity: 13,
  AddChat: 14,
  AddHighlightedUserIds: 15,
  ReplacePropsForNextShapeWithStylesForNextShape: 16,
  AddMeta: 17,
  RemoveCursorColor: 18,
  AddLonelyProperties: 19,
  ReadOnlyReadonly: 20,
  AddHoveringCanvas: 21,
  AddScribbles: 22,
  AddInset: 23,
  AddDuplicateProps: 24,
  RemoveCanMoveCamera: 25
});
var instanceMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.instance",
  recordType: "instance",
  sequence: [
    {
      id: instanceVersions.AddTransparentExportBgs,
      up: (instance) => {
        return { ...instance, exportBackground: true };
      }
    },
    {
      id: instanceVersions.RemoveDialog,
      up: ({ dialog: _, ...instance }) => {
        return instance;
      }
    },
    {
      id: instanceVersions.AddToolLockMode,
      up: (instance) => {
        return { ...instance, isToolLocked: false };
      }
    },
    {
      id: instanceVersions.RemoveExtraPropsForNextShape,
      up: ({ propsForNextShape, ...instance }) => {
        return {
          ...instance,
          propsForNextShape: Object.fromEntries(
            Object.entries(propsForNextShape).filter(
              ([key]) => [
                "color",
                "labelColor",
                "dash",
                "fill",
                "size",
                "font",
                "align",
                "verticalAlign",
                "icon",
                "geo",
                "arrowheadStart",
                "arrowheadEnd",
                "spline"
              ].includes(key)
            )
          )
        };
      }
    },
    {
      id: instanceVersions.AddLabelColor,
      up: ({ propsForNextShape, ...instance }) => {
        return {
          ...instance,
          propsForNextShape: {
            ...propsForNextShape,
            labelColor: "black"
          }
        };
      }
    },
    {
      id: instanceVersions.AddFollowingUserId,
      up: (instance) => {
        return { ...instance, followingUserId: null };
      }
    },
    {
      id: instanceVersions.RemoveAlignJustify,
      up: (instance) => {
        let newAlign = instance.propsForNextShape.align;
        if (newAlign === "justify") {
          newAlign = "start";
        }
        return {
          ...instance,
          propsForNextShape: {
            ...instance.propsForNextShape,
            align: newAlign
          }
        };
      }
    },
    {
      id: instanceVersions.AddZoom,
      up: (instance) => {
        return { ...instance, zoomBrush: null };
      }
    },
    {
      id: instanceVersions.AddVerticalAlign,
      up: (instance) => {
        return {
          ...instance,
          propsForNextShape: {
            ...instance.propsForNextShape,
            verticalAlign: "middle"
          }
        };
      }
    },
    {
      id: instanceVersions.AddScribbleDelay,
      up: (instance) => {
        if (instance.scribble !== null) {
          return { ...instance, scribble: { ...instance.scribble, delay: 0 } };
        }
        return { ...instance };
      }
    },
    {
      id: instanceVersions.RemoveUserId,
      up: ({ userId: _, ...instance }) => {
        return instance;
      }
    },
    {
      id: instanceVersions.AddIsPenModeAndIsGridMode,
      up: (instance) => {
        return { ...instance, isPenMode: false, isGridMode: false };
      }
    },
    {
      id: instanceVersions.HoistOpacity,
      up: ({ propsForNextShape: { opacity, ...propsForNextShape }, ...instance }) => {
        return { ...instance, opacityForNextShape: Number(opacity ?? "1"), propsForNextShape };
      }
    },
    {
      id: instanceVersions.AddChat,
      up: (instance) => {
        return { ...instance, chatMessage: "", isChatting: false };
      }
    },
    {
      id: instanceVersions.AddHighlightedUserIds,
      up: (instance) => {
        return { ...instance, highlightedUserIds: [] };
      }
    },
    {
      id: instanceVersions.ReplacePropsForNextShapeWithStylesForNextShape,
      up: ({ propsForNextShape: _, ...instance }) => {
        return { ...instance, stylesForNextShape: {} };
      }
    },
    {
      id: instanceVersions.AddMeta,
      up: (record) => {
        return {
          ...record,
          meta: {}
        };
      }
    },
    {
      id: instanceVersions.RemoveCursorColor,
      up: (record) => {
        const { color: _, ...cursor } = record.cursor;
        return {
          ...record,
          cursor
        };
      }
    },
    {
      id: instanceVersions.AddLonelyProperties,
      up: (record) => {
        return {
          ...record,
          canMoveCamera: true,
          isFocused: false,
          devicePixelRatio: 1,
          isCoarsePointer: false,
          openMenus: [],
          isChangingStyle: false,
          isReadOnly: false
        };
      }
    },
    {
      id: instanceVersions.ReadOnlyReadonly,
      up: ({ isReadOnly: _isReadOnly, ...record }) => {
        return {
          ...record,
          isReadonly: _isReadOnly
        };
      }
    },
    {
      id: instanceVersions.AddHoveringCanvas,
      up: (record) => {
        return {
          ...record,
          isHoveringCanvas: null
        };
      }
    },
    {
      id: instanceVersions.AddScribbles,
      up: ({ scribble: _, ...record }) => {
        return {
          ...record,
          scribbles: []
        };
      }
    },
    {
      id: instanceVersions.AddInset,
      up: (record) => {
        return {
          ...record,
          insets: [false, false, false, false]
        };
      },
      down: ({ insets: _, ...record }) => {
        return {
          ...record
        };
      }
    },
    {
      id: instanceVersions.AddDuplicateProps,
      up: (record) => {
        return {
          ...record,
          duplicateProps: null
        };
      },
      down: ({ duplicateProps: _, ...record }) => {
        return {
          ...record
        };
      }
    },
    {
      id: instanceVersions.RemoveCanMoveCamera,
      up: ({ canMoveCamera: _, ...record }) => {
        return {
          ...record
        };
      },
      down: (instance) => {
        return { ...instance, canMoveCamera: true };
      }
    }
  ]
});
var TLINSTANCE_ID = "instance:instance";

// node_modules/@tldraw/tlschema/dist-esm/records/TLPageState.mjs
var instancePageStateValidator = validation_exports.model(
  "instance_page_state",
  validation_exports.object({
    typeName: validation_exports.literal("instance_page_state"),
    id: idValidator("instance_page_state"),
    pageId: pageIdValidator,
    selectedShapeIds: validation_exports.arrayOf(shapeIdValidator),
    hintingShapeIds: validation_exports.arrayOf(shapeIdValidator),
    erasingShapeIds: validation_exports.arrayOf(shapeIdValidator),
    hoveredShapeId: shapeIdValidator.nullable(),
    editingShapeId: shapeIdValidator.nullable(),
    croppingShapeId: shapeIdValidator.nullable(),
    focusedGroupId: shapeIdValidator.nullable(),
    meta: validation_exports.jsonValue
  })
);
var instancePageStateVersions = createMigrationIds("com.tldraw.instance_page_state", {
  AddCroppingId: 1,
  RemoveInstanceIdAndCameraId: 2,
  AddMeta: 3,
  RenameProperties: 4,
  RenamePropertiesAgain: 5
});
var instancePageStateMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.instance_page_state",
  recordType: "instance_page_state",
  sequence: [
    {
      id: instancePageStateVersions.AddCroppingId,
      up(instance) {
        instance.croppingShapeId = null;
      }
    },
    {
      id: instancePageStateVersions.RemoveInstanceIdAndCameraId,
      up(instance) {
        delete instance.instanceId;
        delete instance.cameraId;
      }
    },
    {
      id: instancePageStateVersions.AddMeta,
      up: (record) => {
        record.meta = {};
      }
    },
    {
      id: instancePageStateVersions.RenameProperties,
      // this migration is cursed: it was written wrong and doesn't do anything.
      // rather than replace it, I've added another migration below that fixes it.
      up: (_record) => {
      },
      down: (_record) => {
      }
    },
    {
      id: instancePageStateVersions.RenamePropertiesAgain,
      up: (record) => {
        record.selectedShapeIds = record.selectedIds;
        delete record.selectedIds;
        record.hintingShapeIds = record.hintingIds;
        delete record.hintingIds;
        record.erasingShapeIds = record.erasingIds;
        delete record.erasingIds;
        record.hoveredShapeId = record.hoveredId;
        delete record.hoveredId;
        record.editingShapeId = record.editingId;
        delete record.editingId;
        record.croppingShapeId = record.croppingShapeId ?? record.croppingId ?? null;
        delete record.croppingId;
        record.focusedGroupId = record.focusLayerId;
        delete record.focusLayerId;
      },
      down: (record) => {
        record.selectedIds = record.selectedShapeIds;
        delete record.selectedShapeIds;
        record.hintingIds = record.hintingShapeIds;
        delete record.hintingShapeIds;
        record.erasingIds = record.erasingShapeIds;
        delete record.erasingShapeIds;
        record.hoveredId = record.hoveredShapeId;
        delete record.hoveredShapeId;
        record.editingId = record.editingShapeId;
        delete record.editingShapeId;
        record.croppingId = record.croppingShapeId;
        delete record.croppingShapeId;
        record.focusLayerId = record.focusedGroupId;
        delete record.focusedGroupId;
      }
    }
  ]
});
var InstancePageStateRecordType = createRecordType(
  "instance_page_state",
  {
    validator: instancePageStateValidator,
    scope: "session",
    ephemeralKeys: {
      pageId: false,
      selectedShapeIds: false,
      editingShapeId: false,
      croppingShapeId: false,
      meta: false,
      hintingShapeIds: true,
      erasingShapeIds: true,
      hoveredShapeId: true,
      focusedGroupId: true
    }
  }
).withDefaultProperties(
  () => ({
    editingShapeId: null,
    croppingShapeId: null,
    selectedShapeIds: [],
    hoveredShapeId: null,
    erasingShapeIds: [],
    hintingShapeIds: [],
    focusedGroupId: null,
    meta: {}
  })
);

// node_modules/@tldraw/tlschema/dist-esm/records/TLPointer.mjs
var pointerValidator = validation_exports.model(
  "pointer",
  validation_exports.object({
    typeName: validation_exports.literal("pointer"),
    id: idValidator("pointer"),
    x: validation_exports.number,
    y: validation_exports.number,
    lastActivityTimestamp: validation_exports.number,
    meta: validation_exports.jsonValue
  })
);
var pointerVersions = createMigrationIds("com.tldraw.pointer", {
  AddMeta: 1
});
var pointerMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.pointer",
  recordType: "pointer",
  sequence: [
    {
      id: pointerVersions.AddMeta,
      up: (record) => {
        record.meta = {};
      }
    }
  ]
});
var PointerRecordType = createRecordType("pointer", {
  validator: pointerValidator,
  scope: "session"
}).withDefaultProperties(
  () => ({
    x: 0,
    y: 0,
    lastActivityTimestamp: 0,
    meta: {}
  })
);
var TLPOINTER_ID = PointerRecordType.createId("pointer");

// node_modules/@tldraw/tlschema/dist-esm/records/TLPresence.mjs
var instancePresenceValidator = validation_exports.model(
  "instance_presence",
  validation_exports.object({
    typeName: validation_exports.literal("instance_presence"),
    id: idValidator("instance_presence"),
    userId: validation_exports.string,
    userName: validation_exports.string,
    lastActivityTimestamp: validation_exports.number.nullable(),
    followingUserId: validation_exports.string.nullable(),
    cursor: validation_exports.object({
      x: validation_exports.number,
      y: validation_exports.number,
      type: cursorTypeValidator,
      rotation: validation_exports.number
    }).nullable(),
    color: validation_exports.string,
    camera: validation_exports.object({
      x: validation_exports.number,
      y: validation_exports.number,
      z: validation_exports.number
    }).nullable(),
    screenBounds: boxModelValidator.nullable(),
    selectedShapeIds: validation_exports.arrayOf(idValidator("shape")),
    currentPageId: idValidator("page"),
    brush: boxModelValidator.nullable(),
    scribbles: validation_exports.arrayOf(scribbleValidator),
    chatMessage: validation_exports.string,
    meta: validation_exports.jsonValue
  })
);
var instancePresenceVersions = createMigrationIds("com.tldraw.instance_presence", {
  AddScribbleDelay: 1,
  RemoveInstanceId: 2,
  AddChatMessage: 3,
  AddMeta: 4,
  RenameSelectedShapeIds: 5,
  NullableCameraCursor: 6
});
var instancePresenceMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.instance_presence",
  recordType: "instance_presence",
  sequence: [
    {
      id: instancePresenceVersions.AddScribbleDelay,
      up: (instance) => {
        if (instance.scribble !== null) {
          instance.scribble.delay = 0;
        }
      }
    },
    {
      id: instancePresenceVersions.RemoveInstanceId,
      up: (instance) => {
        delete instance.instanceId;
      }
    },
    {
      id: instancePresenceVersions.AddChatMessage,
      up: (instance) => {
        instance.chatMessage = "";
      }
    },
    {
      id: instancePresenceVersions.AddMeta,
      up: (record) => {
        record.meta = {};
      }
    },
    {
      id: instancePresenceVersions.RenameSelectedShapeIds,
      up: (_record) => {
      }
    },
    {
      id: instancePresenceVersions.NullableCameraCursor,
      up: (_record) => {
      },
      down: (record) => {
        if (record.camera === null) {
          record.camera = { x: 0, y: 0, z: 1 };
        }
        if (record.lastActivityTimestamp === null) {
          record.lastActivityTimestamp = 0;
        }
        if (record.cursor === null) {
          record.cursor = { type: "default", x: 0, y: 0, rotation: 0 };
        }
        if (record.screenBounds === null) {
          record.screenBounds = { x: 0, y: 0, w: 1, h: 1 };
        }
      }
    }
  ]
});
var InstancePresenceRecordType = createRecordType(
  "instance_presence",
  {
    validator: instancePresenceValidator,
    scope: "presence"
  }
).withDefaultProperties(() => ({
  lastActivityTimestamp: null,
  followingUserId: null,
  color: "#FF0000",
  camera: null,
  cursor: null,
  screenBounds: null,
  selectedShapeIds: [],
  brush: null,
  scribbles: [],
  chatMessage: "",
  meta: {}
}));

// node_modules/@tldraw/tlschema/dist-esm/createPresenceStateDerivation.mjs
function createPresenceStateDerivation($user, instanceId) {
  return (store) => {
    return computed("instancePresence", () => {
      const user = $user.get();
      if (!user) return null;
      const state = getDefaultUserPresence(store, user);
      if (!state) return null;
      return InstancePresenceRecordType.create({
        ...state,
        id: instanceId ?? InstancePresenceRecordType.createId(store.id)
      });
    });
  };
}
function getDefaultUserPresence(store, user) {
  const instance = store.get(TLINSTANCE_ID);
  const pageState = store.get(InstancePageStateRecordType.createId(instance?.currentPageId));
  const camera = store.get(CameraRecordType.createId(instance?.currentPageId));
  const pointer = store.get(TLPOINTER_ID);
  if (!pageState || !instance || !camera || !pointer) {
    return null;
  }
  return {
    selectedShapeIds: pageState.selectedShapeIds,
    brush: instance.brush,
    scribbles: instance.scribbles,
    userId: user.id,
    userName: user.name ?? "",
    followingUserId: instance.followingUserId,
    camera: {
      x: camera.x,
      y: camera.y,
      z: camera.z
    },
    color: user.color ?? "#FF0000",
    currentPageId: instance.currentPageId,
    cursor: {
      x: pointer.x,
      y: pointer.y,
      rotation: instance.cursor.rotation,
      type: instance.cursor.type
    },
    lastActivityTimestamp: pointer.lastActivityTimestamp,
    screenBounds: instance.screenBounds,
    chatMessage: instance.chatMessage,
    meta: {}
  };
}

// node_modules/@tldraw/tlschema/dist-esm/records/TLDocument.mjs
var documentValidator = validation_exports.model(
  "document",
  validation_exports.object({
    typeName: validation_exports.literal("document"),
    id: validation_exports.literal("document:document"),
    gridSize: validation_exports.number,
    name: validation_exports.string,
    meta: validation_exports.jsonValue
  })
);
function isDocument(record) {
  if (!record) return false;
  return record.typeName === "document";
}
var documentVersions = createMigrationIds("com.tldraw.document", {
  AddName: 1,
  AddMeta: 2
});
var documentMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.document",
  recordType: "document",
  sequence: [
    {
      id: documentVersions.AddName,
      up: (document2) => {
        ;
        document2.name = "";
      },
      down: (document2) => {
        delete document2.name;
      }
    },
    {
      id: documentVersions.AddMeta,
      up: (record) => {
        ;
        record.meta = {};
      }
    }
  ]
});
var DocumentRecordType = createRecordType("document", {
  validator: documentValidator,
  scope: "document"
}).withDefaultProperties(
  () => ({
    gridSize: 10,
    name: "",
    meta: {}
  })
);
var TLDOCUMENT_ID = DocumentRecordType.createId("document");

// node_modules/@tldraw/tlschema/dist-esm/TLStore.mjs
function sortByIndex2(a, b) {
  if (a.index < b.index) {
    return -1;
  } else if (a.index > b.index) {
    return 1;
  }
  return 0;
}
function redactRecordForErrorReporting(record) {
  if (record.typeName === "asset") {
    if ("src" in record) {
      record.src = "<redacted>";
    }
    if ("src" in record.props) {
      record.props.src = "<redacted>";
    }
  }
}
function onValidationFailure({
  error,
  phase,
  record,
  recordBefore
}) {
  const isExistingValidationIssue = (
    // if we're initializing the store for the first time, we should
    // allow invalid records so people can load old buggy data:
    phase === "initialize"
  );
  annotateError(error, {
    tags: {
      origin: "store.validateRecord",
      storePhase: phase,
      isExistingValidationIssue
    },
    extras: {
      recordBefore: recordBefore ? redactRecordForErrorReporting(structuredClone(recordBefore)) : void 0,
      recordAfter: redactRecordForErrorReporting(structuredClone(record))
    }
  });
  throw error;
}
function getDefaultPages() {
  return [
    PageRecordType.create({
      id: "page:page",
      name: "Page 1",
      index: "a1",
      meta: {}
    })
  ];
}
function createIntegrityChecker(store) {
  const $pageIds = store.query.ids("page");
  const $pageStates = store.query.records("instance_page_state");
  const ensureStoreIsUsable = () => {
    if (!store.has(TLDOCUMENT_ID)) {
      store.put([DocumentRecordType.create({ id: TLDOCUMENT_ID, name: store.props.defaultName })]);
      return ensureStoreIsUsable();
    }
    if (!store.has(TLPOINTER_ID)) {
      store.put([PointerRecordType.create({ id: TLPOINTER_ID })]);
      return ensureStoreIsUsable();
    }
    const pageIds = $pageIds.get();
    if (pageIds.size === 0) {
      store.put(getDefaultPages());
      return ensureStoreIsUsable();
    }
    const getFirstPageId = () => [...pageIds].map((id) => store.get(id)).sort(sortByIndex2)[0].id;
    const instanceState = store.get(TLINSTANCE_ID);
    if (!instanceState) {
      store.put([
        store.schema.types.instance.create({
          id: TLINSTANCE_ID,
          currentPageId: getFirstPageId(),
          exportBackground: true
        })
      ]);
      return ensureStoreIsUsable();
    } else if (!pageIds.has(instanceState.currentPageId)) {
      store.put([{ ...instanceState, currentPageId: getFirstPageId() }]);
      return ensureStoreIsUsable();
    }
    const missingPageStateIds = /* @__PURE__ */ new Set();
    const missingCameraIds = /* @__PURE__ */ new Set();
    for (const id of pageIds) {
      const pageStateId = InstancePageStateRecordType.createId(id);
      const pageState = store.get(pageStateId);
      if (!pageState) {
        missingPageStateIds.add(pageStateId);
      }
      const cameraId = CameraRecordType.createId(id);
      if (!store.has(cameraId)) {
        missingCameraIds.add(cameraId);
      }
    }
    if (missingPageStateIds.size > 0) {
      store.put(
        [...missingPageStateIds].map(
          (id) => InstancePageStateRecordType.create({
            id,
            pageId: InstancePageStateRecordType.parseId(id)
          })
        )
      );
    }
    if (missingCameraIds.size > 0) {
      store.put([...missingCameraIds].map((id) => CameraRecordType.create({ id })));
    }
    const pageStates = $pageStates.get();
    for (const pageState of pageStates) {
      if (!pageIds.has(pageState.pageId)) {
        store.remove([pageState.id]);
        continue;
      }
      if (pageState.croppingShapeId && !store.has(pageState.croppingShapeId)) {
        store.put([{ ...pageState, croppingShapeId: null }]);
        return ensureStoreIsUsable();
      }
      if (pageState.focusedGroupId && !store.has(pageState.focusedGroupId)) {
        store.put([{ ...pageState, focusedGroupId: null }]);
        return ensureStoreIsUsable();
      }
      if (pageState.hoveredShapeId && !store.has(pageState.hoveredShapeId)) {
        store.put([{ ...pageState, hoveredShapeId: null }]);
        return ensureStoreIsUsable();
      }
      const filteredSelectedIds = pageState.selectedShapeIds.filter((id) => store.has(id));
      if (filteredSelectedIds.length !== pageState.selectedShapeIds.length) {
        store.put([{ ...pageState, selectedShapeIds: filteredSelectedIds }]);
        return ensureStoreIsUsable();
      }
      const filteredHintingIds = pageState.hintingShapeIds.filter((id) => store.has(id));
      if (filteredHintingIds.length !== pageState.hintingShapeIds.length) {
        store.put([{ ...pageState, hintingShapeIds: filteredHintingIds }]);
        return ensureStoreIsUsable();
      }
      const filteredErasingIds = pageState.erasingShapeIds.filter((id) => store.has(id));
      if (filteredErasingIds.length !== pageState.erasingShapeIds.length) {
        store.put([{ ...pageState, erasingShapeIds: filteredErasingIds }]);
        return ensureStoreIsUsable();
      }
    }
  };
  return ensureStoreIsUsable;
}

// node_modules/@tldraw/tlschema/dist-esm/assets/TLBookmarkAsset.mjs
var bookmarkAssetValidator = createAssetValidator(
  "bookmark",
  validation_exports.object({
    title: validation_exports.string,
    description: validation_exports.string,
    image: validation_exports.string,
    favicon: validation_exports.string,
    src: validation_exports.srcUrl.nullable()
  })
);
var Versions = createMigrationIds("com.tldraw.asset.bookmark", {
  MakeUrlsValid: 1,
  AddFavicon: 2
});
var bookmarkAssetMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.asset.bookmark",
  recordType: "asset",
  filter: (asset) => asset.type === "bookmark",
  sequence: [
    {
      id: Versions.MakeUrlsValid,
      up: (asset) => {
        if (!validation_exports.srcUrl.isValid(asset.props.src)) {
          asset.props.src = "";
        }
      },
      down: (_asset) => {
      }
    },
    {
      id: Versions.AddFavicon,
      up: (asset) => {
        if (!validation_exports.srcUrl.isValid(asset.props.favicon)) {
          asset.props.favicon = "";
        }
      },
      down: (asset) => {
        delete asset.props.favicon;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/assets/TLImageAsset.mjs
var imageAssetValidator = createAssetValidator(
  "image",
  validation_exports.object({
    w: validation_exports.number,
    h: validation_exports.number,
    name: validation_exports.string,
    isAnimated: validation_exports.boolean,
    mimeType: validation_exports.string.nullable(),
    src: validation_exports.srcUrl.nullable(),
    fileSize: validation_exports.nonZeroNumber.optional()
  })
);
var Versions2 = createMigrationIds("com.tldraw.asset.image", {
  AddIsAnimated: 1,
  RenameWidthHeight: 2,
  MakeUrlsValid: 3,
  AddFileSize: 4,
  MakeFileSizeOptional: 5
});
var imageAssetMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.asset.image",
  recordType: "asset",
  filter: (asset) => asset.type === "image",
  sequence: [
    {
      id: Versions2.AddIsAnimated,
      up: (asset) => {
        asset.props.isAnimated = false;
      },
      down: (asset) => {
        delete asset.props.isAnimated;
      }
    },
    {
      id: Versions2.RenameWidthHeight,
      up: (asset) => {
        asset.props.w = asset.props.width;
        asset.props.h = asset.props.height;
        delete asset.props.width;
        delete asset.props.height;
      },
      down: (asset) => {
        asset.props.width = asset.props.w;
        asset.props.height = asset.props.h;
        delete asset.props.w;
        delete asset.props.h;
      }
    },
    {
      id: Versions2.MakeUrlsValid,
      up: (asset) => {
        if (!validation_exports.srcUrl.isValid(asset.props.src)) {
          asset.props.src = "";
        }
      },
      down: (_asset) => {
      }
    },
    {
      id: Versions2.AddFileSize,
      up: (asset) => {
        asset.props.fileSize = -1;
      },
      down: (asset) => {
        delete asset.props.fileSize;
      }
    },
    {
      id: Versions2.MakeFileSizeOptional,
      up: (asset) => {
        if (asset.props.fileSize === -1) {
          asset.props.fileSize = void 0;
        }
      },
      down: (asset) => {
        if (asset.props.fileSize === void 0) {
          asset.props.fileSize = -1;
        }
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/assets/TLVideoAsset.mjs
var videoAssetValidator = createAssetValidator(
  "video",
  validation_exports.object({
    w: validation_exports.number,
    h: validation_exports.number,
    name: validation_exports.string,
    isAnimated: validation_exports.boolean,
    mimeType: validation_exports.string.nullable(),
    src: validation_exports.srcUrl.nullable(),
    fileSize: validation_exports.number.optional()
  })
);
var Versions3 = createMigrationIds("com.tldraw.asset.video", {
  AddIsAnimated: 1,
  RenameWidthHeight: 2,
  MakeUrlsValid: 3,
  AddFileSize: 4,
  MakeFileSizeOptional: 5
});
var videoAssetMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.asset.video",
  recordType: "asset",
  filter: (asset) => asset.type === "video",
  sequence: [
    {
      id: Versions3.AddIsAnimated,
      up: (asset) => {
        asset.props.isAnimated = false;
      },
      down: (asset) => {
        delete asset.props.isAnimated;
      }
    },
    {
      id: Versions3.RenameWidthHeight,
      up: (asset) => {
        asset.props.w = asset.props.width;
        asset.props.h = asset.props.height;
        delete asset.props.width;
        delete asset.props.height;
      },
      down: (asset) => {
        asset.props.width = asset.props.w;
        asset.props.height = asset.props.h;
        delete asset.props.w;
        delete asset.props.h;
      }
    },
    {
      id: Versions3.MakeUrlsValid,
      up: (asset) => {
        if (!validation_exports.srcUrl.isValid(asset.props.src)) {
          asset.props.src = "";
        }
      },
      down: (_asset) => {
      }
    },
    {
      id: Versions3.AddFileSize,
      up: (asset) => {
        asset.props.fileSize = -1;
      },
      down: (asset) => {
        delete asset.props.fileSize;
      }
    },
    {
      id: Versions3.MakeFileSizeOptional,
      up: (asset) => {
        if (asset.props.fileSize === -1) {
          asset.props.fileSize = void 0;
        }
      },
      down: (asset) => {
        if (asset.props.fileSize === void 0) {
          asset.props.fileSize = -1;
        }
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/records/TLAsset.mjs
var assetValidator = validation_exports.model(
  "asset",
  validation_exports.union("type", {
    image: imageAssetValidator,
    video: videoAssetValidator,
    bookmark: bookmarkAssetValidator
  })
);
var assetVersions = createMigrationIds("com.tldraw.asset", {
  AddMeta: 1
});
var assetMigrations = createRecordMigrationSequence({
  sequenceId: "com.tldraw.asset",
  recordType: "asset",
  sequence: [
    {
      id: assetVersions.AddMeta,
      up: (record) => {
        ;
        record.meta = {};
      }
    }
  ]
});
var AssetRecordType = createRecordType("asset", {
  validator: assetValidator,
  scope: "document"
}).withDefaultProperties(() => ({
  meta: {}
}));

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLBookmarkShape.mjs
var bookmarkShapeProps = {
  w: validation_exports.nonZeroNumber,
  h: validation_exports.nonZeroNumber,
  assetId: assetIdValidator.nullable(),
  url: validation_exports.linkUrl
};
var Versions4 = createShapePropsMigrationIds("bookmark", {
  NullAssetId: 1,
  MakeUrlsValid: 2
});
var bookmarkShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions4.NullAssetId,
      up: (props) => {
        if (props.assetId === void 0) {
          props.assetId = null;
        }
      },
      down: "retired"
    },
    {
      id: Versions4.MakeUrlsValid,
      up: (props) => {
        if (!validation_exports.linkUrl.isValid(props.url)) {
          props.url = "";
        }
      },
      down: (_props) => {
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLDrawShape.mjs
var DrawShapeSegment = validation_exports.object({
  type: validation_exports.literalEnum("free", "straight"),
  points: validation_exports.arrayOf(vecModelValidator)
});
var drawShapeProps = {
  color: DefaultColorStyle,
  fill: DefaultFillStyle,
  dash: DefaultDashStyle,
  size: DefaultSizeStyle,
  segments: validation_exports.arrayOf(DrawShapeSegment),
  isComplete: validation_exports.boolean,
  isClosed: validation_exports.boolean,
  isPen: validation_exports.boolean,
  scale: validation_exports.nonZeroNumber
};
var Versions5 = createShapePropsMigrationIds("draw", {
  AddInPen: 1,
  AddScale: 2
});
var drawShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions5.AddInPen,
      up: (props) => {
        const { points } = props.segments[0];
        if (points.length === 0) {
          props.isPen = false;
          return;
        }
        let isPen = !(points[0].z === 0 || points[0].z === 0.5);
        if (points[1]) {
          isPen = isPen && !(points[1].z === 0 || points[1].z === 0.5);
        }
        props.isPen = isPen;
      },
      down: "retired"
    },
    {
      id: Versions5.AddScale,
      up: (props) => {
        props.scale = 1;
      },
      down: (props) => {
        delete props.scale;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLEmbedShape.mjs
var TLDRAW_APP_RE = /(^\/r\/[^/]+\/?$)/;
var EMBED_DEFINITIONS = [
  {
    hostnames: ["beta.tldraw.com", "tldraw.com", "localhost:3000"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.pathname.match(TLDRAW_APP_RE)) {
        return url;
      }
      return;
    }
  },
  {
    hostnames: ["figma.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.pathname.match(/^\/embed\/?$/)) {
        const outUrl = urlObj.searchParams.get("url");
        if (outUrl) {
          return outUrl;
        }
      }
      return;
    }
  },
  {
    hostnames: ["google.*"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (!urlObj) return;
      const matches = urlObj.pathname.match(/^\/maps\/embed\/v1\/view\/?$/);
      if (matches && urlObj.searchParams.has("center") && urlObj.searchParams.get("zoom")) {
        const zoom = urlObj.searchParams.get("zoom");
        const [lat, lon] = urlObj.searchParams.get("center").split(",");
        return `https://www.google.com/maps/@${lat},${lon},${zoom}z`;
      }
      return;
    }
  },
  {
    hostnames: ["val.town"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      const matches = urlObj && urlObj.pathname.match(/\/embed\/(.+)\/?/);
      if (matches) {
        return `https://www.val.town/v/${matches[1]}`;
      }
      return;
    }
  },
  {
    hostnames: ["codesandbox.io"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      const matches = urlObj && urlObj.pathname.match(/\/embed\/([^/]+)\/?/);
      if (matches) {
        return `https://codesandbox.io/s/${matches[1]}`;
      }
      return;
    }
  },
  {
    hostnames: ["codepen.io"],
    fromEmbedUrl: (url) => {
      const CODEPEN_EMBED_REGEXP = /https:\/\/codepen.io\/([^/]+)\/embed\/([^/]+)/;
      const matches = url.match(CODEPEN_EMBED_REGEXP);
      if (matches) {
        const [_, user, id] = matches;
        return `https://codepen.io/${user}/pen/${id}`;
      }
      return;
    }
  },
  {
    hostnames: ["scratch.mit.edu"],
    fromEmbedUrl: (url) => {
      const SCRATCH_EMBED_REGEXP = /https:\/\/scratch.mit.edu\/projects\/embed\/([^/]+)/;
      const matches = url.match(SCRATCH_EMBED_REGEXP);
      if (matches) {
        const [_, id] = matches;
        return `https://scratch.mit.edu/projects/${id}`;
      }
      return;
    }
  },
  {
    hostnames: ["*.youtube.com", "youtube.com", "youtu.be"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (!urlObj) return;
      const hostname = urlObj.hostname.replace(/^www./, "");
      if (hostname === "youtube.com") {
        const matches = urlObj.pathname.match(/^\/embed\/([^/]+)\/?/);
        if (matches) {
          return `https://www.youtube.com/watch?v=${matches[1]}`;
        }
      }
      return;
    }
  },
  {
    hostnames: ["calendar.google.*"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      const srcQs = urlObj?.searchParams.get("src");
      if (urlObj?.pathname.match(/\/calendar\/embed/) && srcQs) {
        urlObj.pathname = "/calendar/u/0";
        const keys = Array.from(urlObj.searchParams.keys());
        for (const key of keys) {
          urlObj.searchParams.delete(key);
        }
        urlObj.searchParams.set("cid", srcQs);
        return urlObj.href;
      }
      return;
    }
  },
  {
    hostnames: ["docs.google.*"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj?.pathname.match(/^\/presentation/) && urlObj?.pathname.match(/\/embed\/?$/)) {
        urlObj.pathname = urlObj.pathname.replace(/\/embed$/, "/pub");
        const keys = Array.from(urlObj.searchParams.keys());
        for (const key of keys) {
          urlObj.searchParams.delete(key);
        }
        return urlObj.href;
      }
      return;
    }
  },
  {
    hostnames: ["gist.github.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.pathname.match(/\/([^/]+)\/([^/]+)/)) {
        if (!url.split("/").pop()) return;
        return url;
      }
      return;
    }
  },
  {
    hostnames: ["replit.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.pathname.match(/\/@([^/]+)\/([^/]+)/) && urlObj.searchParams.has("embed")) {
        urlObj.searchParams.delete("embed");
        return urlObj.href;
      }
      return;
    }
  },
  {
    hostnames: ["felt.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.pathname.match(/^\/embed\/map\//)) {
        urlObj.pathname = urlObj.pathname.replace(/^\/embed/, "");
        return urlObj.href;
      }
      return;
    }
  },
  {
    hostnames: ["open.spotify.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.pathname.match(/^\/embed\/(artist|album)\//)) {
        return urlObj.origin + urlObj.pathname.replace(/^\/embed/, "");
      }
      return;
    }
  },
  {
    hostnames: ["vimeo.com", "player.vimeo.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.hostname === "player.vimeo.com") {
        const matches = urlObj.pathname.match(/^\/video\/([^/]+)\/?$/);
        if (matches) {
          return "https://vimeo.com/" + matches[1];
        }
      }
      return;
    }
  },
  {
    hostnames: ["excalidraw.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.hash.match(/#room=/)) {
        return url;
      }
      return;
    }
  },
  {
    hostnames: ["observablehq.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.pathname.match(/^\/embed\/@([^/]+)\/([^/]+)\/?$/)) {
        return `${urlObj.origin}${urlObj.pathname.replace("/embed", "")}#cell-*`;
      }
      if (urlObj && urlObj.pathname.match(/^\/embed\/([^/]+)\/?$/)) {
        return `${urlObj.origin}${urlObj.pathname.replace("/embed", "/d")}#cell-*`;
      }
      return;
    }
  },
  {
    hostnames: ["desmos.com"],
    fromEmbedUrl: (url) => {
      const urlObj = safeParseUrl(url);
      if (urlObj && urlObj.hostname === "www.desmos.com" && urlObj.pathname.match(/^\/calculator\/([^/]+)\/?$/) && urlObj.search === "?embed" && urlObj.hash === "") {
        return url.replace("?embed", "");
      }
      return;
    }
  }
];
var embedShapeProps = {
  w: validation_exports.nonZeroNumber,
  h: validation_exports.nonZeroNumber,
  url: validation_exports.string
};
var Versions6 = createShapePropsMigrationIds("embed", {
  GenOriginalUrlInEmbed: 1,
  RemoveDoesResize: 2,
  RemoveTmpOldUrl: 3,
  RemovePermissionOverrides: 4
});
var embedShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions6.GenOriginalUrlInEmbed,
      // add tmpOldUrl property
      up: (props) => {
        try {
          const url = props.url;
          const host = new URL(url).host.replace("www.", "");
          let originalUrl;
          for (const localEmbedDef of EMBED_DEFINITIONS) {
            if (localEmbedDef.hostnames.includes(host)) {
              try {
                originalUrl = localEmbedDef.fromEmbedUrl(url);
              } catch (err) {
                console.warn(err);
              }
            }
          }
          props.tmpOldUrl = props.url;
          props.url = originalUrl ?? "";
        } catch {
          props.url = "";
          props.tmpOldUrl = props.url;
        }
      },
      down: "retired"
    },
    {
      id: Versions6.RemoveDoesResize,
      up: (props) => {
        delete props.doesResize;
      },
      down: "retired"
    },
    {
      id: Versions6.RemoveTmpOldUrl,
      up: (props) => {
        delete props.tmpOldUrl;
      },
      down: "retired"
    },
    {
      id: Versions6.RemovePermissionOverrides,
      up: (props) => {
        delete props.overridePermissions;
      },
      down: "retired"
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLFrameShape.mjs
var frameShapeProps = {
  w: validation_exports.nonZeroNumber,
  h: validation_exports.nonZeroNumber,
  name: validation_exports.string,
  // because shape colors are an option, we don't want them to be picked up by the editor as a
  // style prop by default, so instead of a proper style we just supply an equivalent validator.
  // Check `FrameShapeUtil.configure` for how we replace this with the original
  // `DefaultColorStyle` style when the option is turned on.
  color: validation_exports.literalEnum(...DefaultColorStyle.values)
};
var Versions7 = createShapePropsMigrationIds("frame", {
  AddColorProp: 1
});
var frameShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions7.AddColorProp,
      up: (props) => {
        props.color = "black";
      },
      down: (props) => {
        delete props.color;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/misc/TLRichText.mjs
var richTextValidator = validation_exports.object({ type: validation_exports.string, content: validation_exports.arrayOf(validation_exports.unknown) });
function toRichText(text) {
  const lines = text.split("\n");
  const content = lines.map((text2) => {
    if (!text2) {
      return {
        type: "paragraph"
      };
    }
    return {
      type: "paragraph",
      content: [{ type: "text", text: text2 }]
    };
  });
  return {
    type: "doc",
    content
  };
}

// node_modules/@tldraw/tlschema/dist-esm/styles/TLHorizontalAlignStyle.mjs
var DefaultHorizontalAlignStyle = StyleProp.defineEnum("tldraw:horizontalAlign", {
  defaultValue: "middle",
  values: ["start", "middle", "end", "start-legacy", "end-legacy", "middle-legacy"]
});

// node_modules/@tldraw/tlschema/dist-esm/styles/TLVerticalAlignStyle.mjs
var DefaultVerticalAlignStyle = StyleProp.defineEnum("tldraw:verticalAlign", {
  defaultValue: "middle",
  values: ["start", "middle", "end"]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLGeoShape.mjs
var GeoShapeGeoStyle = StyleProp.defineEnum("tldraw:geo", {
  defaultValue: "rectangle",
  values: [
    "cloud",
    "rectangle",
    "ellipse",
    "triangle",
    "diamond",
    "pentagon",
    "hexagon",
    "octagon",
    "star",
    "rhombus",
    "rhombus-2",
    "oval",
    "trapezoid",
    "arrow-right",
    "arrow-left",
    "arrow-up",
    "arrow-down",
    "x-box",
    "check-box",
    "heart"
  ]
});
var geoShapeProps = {
  geo: GeoShapeGeoStyle,
  dash: DefaultDashStyle,
  url: validation_exports.linkUrl,
  w: validation_exports.nonZeroNumber,
  h: validation_exports.nonZeroNumber,
  growY: validation_exports.positiveNumber,
  scale: validation_exports.nonZeroNumber,
  // Text properties
  labelColor: DefaultLabelColorStyle,
  color: DefaultColorStyle,
  fill: DefaultFillStyle,
  size: DefaultSizeStyle,
  font: DefaultFontStyle,
  align: DefaultHorizontalAlignStyle,
  verticalAlign: DefaultVerticalAlignStyle,
  richText: richTextValidator
};
var geoShapeVersions = createShapePropsMigrationIds("geo", {
  AddUrlProp: 1,
  AddLabelColor: 2,
  RemoveJustify: 3,
  AddCheckBox: 4,
  AddVerticalAlign: 5,
  MigrateLegacyAlign: 6,
  AddCloud: 7,
  MakeUrlsValid: 8,
  AddScale: 9,
  AddRichText: 10
});
var geoShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: geoShapeVersions.AddUrlProp,
      up: (props) => {
        props.url = "";
      },
      down: "retired"
    },
    {
      id: geoShapeVersions.AddLabelColor,
      up: (props) => {
        props.labelColor = "black";
      },
      down: "retired"
    },
    {
      id: geoShapeVersions.RemoveJustify,
      up: (props) => {
        if (props.align === "justify") {
          props.align = "start";
        }
      },
      down: "retired"
    },
    {
      id: geoShapeVersions.AddCheckBox,
      up: (_props) => {
      },
      down: "retired"
    },
    {
      id: geoShapeVersions.AddVerticalAlign,
      up: (props) => {
        props.verticalAlign = "middle";
      },
      down: "retired"
    },
    {
      id: geoShapeVersions.MigrateLegacyAlign,
      up: (props) => {
        let newAlign;
        switch (props.align) {
          case "start":
            newAlign = "start-legacy";
            break;
          case "end":
            newAlign = "end-legacy";
            break;
          default:
            newAlign = "middle-legacy";
            break;
        }
        props.align = newAlign;
      },
      down: "retired"
    },
    {
      id: geoShapeVersions.AddCloud,
      up: (_props) => {
      },
      down: "retired"
    },
    {
      id: geoShapeVersions.MakeUrlsValid,
      up: (props) => {
        if (!validation_exports.linkUrl.isValid(props.url)) {
          props.url = "";
        }
      },
      down: (_props) => {
      }
    },
    {
      id: geoShapeVersions.AddScale,
      up: (props) => {
        props.scale = 1;
      },
      down: (props) => {
        delete props.scale;
      }
    },
    {
      id: geoShapeVersions.AddRichText,
      up: (props) => {
        props.richText = toRichText(props.text);
        delete props.text;
      }
      // N.B. Explicitly no down state so that we force clients to update.
      // down: (props) => {
      // 	delete props.richText
      // },
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLGroupShape.mjs
var groupShapeProps = {};
var groupShapeMigrations = createShapePropsMigrationSequence({ sequence: [] });

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLHighlightShape.mjs
var highlightShapeProps = {
  color: DefaultColorStyle,
  size: DefaultSizeStyle,
  segments: validation_exports.arrayOf(DrawShapeSegment),
  isComplete: validation_exports.boolean,
  isPen: validation_exports.boolean,
  scale: validation_exports.nonZeroNumber
};
var Versions8 = createShapePropsMigrationIds("highlight", {
  AddScale: 1
});
var highlightShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions8.AddScale,
      up: (props) => {
        props.scale = 1;
      },
      down: (props) => {
        delete props.scale;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLImageShape.mjs
var ImageShapeCrop = validation_exports.object({
  topLeft: vecModelValidator,
  bottomRight: vecModelValidator,
  isCircle: validation_exports.boolean.optional()
});
var imageShapeProps = {
  w: validation_exports.nonZeroNumber,
  h: validation_exports.nonZeroNumber,
  playing: validation_exports.boolean,
  url: validation_exports.linkUrl,
  assetId: assetIdValidator.nullable(),
  crop: ImageShapeCrop.nullable(),
  flipX: validation_exports.boolean,
  flipY: validation_exports.boolean,
  altText: validation_exports.string
};
var Versions9 = createShapePropsMigrationIds("image", {
  AddUrlProp: 1,
  AddCropProp: 2,
  MakeUrlsValid: 3,
  AddFlipProps: 4,
  AddAltText: 5
});
var imageShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions9.AddUrlProp,
      up: (props) => {
        props.url = "";
      },
      down: "retired"
    },
    {
      id: Versions9.AddCropProp,
      up: (props) => {
        props.crop = null;
      },
      down: (props) => {
        delete props.crop;
      }
    },
    {
      id: Versions9.MakeUrlsValid,
      up: (props) => {
        if (!validation_exports.linkUrl.isValid(props.url)) {
          props.url = "";
        }
      },
      down: (_props) => {
      }
    },
    {
      id: Versions9.AddFlipProps,
      up: (props) => {
        props.flipX = false;
        props.flipY = false;
      },
      down: (props) => {
        delete props.flipX;
        delete props.flipY;
      }
    },
    {
      id: Versions9.AddAltText,
      up: (props) => {
        props.altText = "";
      },
      down: (props) => {
        delete props.altText;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLLineShape.mjs
var LineShapeSplineStyle = StyleProp.defineEnum("tldraw:spline", {
  defaultValue: "line",
  values: ["cubic", "line"]
});
var lineShapePointValidator = validation_exports.object({
  id: validation_exports.string,
  index: validation_exports.indexKey,
  x: validation_exports.number,
  y: validation_exports.number
});
var lineShapeProps = {
  color: DefaultColorStyle,
  dash: DefaultDashStyle,
  size: DefaultSizeStyle,
  spline: LineShapeSplineStyle,
  points: validation_exports.dict(validation_exports.string, lineShapePointValidator),
  scale: validation_exports.nonZeroNumber
};
var lineShapeVersions = createShapePropsMigrationIds("line", {
  AddSnapHandles: 1,
  RemoveExtraHandleProps: 2,
  HandlesToPoints: 3,
  PointIndexIds: 4,
  AddScale: 5
});
var lineShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: lineShapeVersions.AddSnapHandles,
      up: (props) => {
        for (const handle of Object.values(props.handles)) {
          ;
          handle.canSnap = true;
        }
      },
      down: "retired"
    },
    {
      id: lineShapeVersions.RemoveExtraHandleProps,
      up: (props) => {
        props.handles = objectMapFromEntries(
          Object.values(props.handles).map((handle) => [
            handle.index,
            {
              x: handle.x,
              y: handle.y
            }
          ])
        );
      },
      down: (props) => {
        const handles = Object.entries(props.handles).map(([index, handle]) => ({ index, ...handle })).sort(sortByIndex);
        props.handles = Object.fromEntries(
          handles.map((handle, i) => {
            const id = i === 0 ? "start" : i === handles.length - 1 ? "end" : `handle:${handle.index}`;
            return [
              id,
              {
                id,
                type: "vertex",
                canBind: false,
                canSnap: true,
                index: handle.index,
                x: handle.x,
                y: handle.y
              }
            ];
          })
        );
      }
    },
    {
      id: lineShapeVersions.HandlesToPoints,
      up: (props) => {
        const sortedHandles = Object.entries(props.handles).map(([index, { x, y }]) => ({ x, y, index })).sort(sortByIndex);
        props.points = sortedHandles.map(({ x, y }) => ({ x, y }));
        delete props.handles;
      },
      down: (props) => {
        const indices = getIndices(props.points.length);
        props.handles = Object.fromEntries(
          props.points.map((handle, i) => {
            const index = indices[i];
            return [
              index,
              {
                x: handle.x,
                y: handle.y
              }
            ];
          })
        );
        delete props.points;
      }
    },
    {
      id: lineShapeVersions.PointIndexIds,
      up: (props) => {
        const indices = getIndices(props.points.length);
        props.points = Object.fromEntries(
          props.points.map((point, i) => {
            const id = indices[i];
            return [
              id,
              {
                id,
                index: id,
                x: point.x,
                y: point.y
              }
            ];
          })
        );
      },
      down: (props) => {
        const sortedHandles = Object.values(props.points).sort(sortByIndex);
        props.points = sortedHandles.map(({ x, y }) => ({ x, y }));
      }
    },
    {
      id: lineShapeVersions.AddScale,
      up: (props) => {
        props.scale = 1;
      },
      down: (props) => {
        delete props.scale;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLNoteShape.mjs
var noteShapeProps = {
  color: DefaultColorStyle,
  labelColor: DefaultLabelColorStyle,
  size: DefaultSizeStyle,
  font: DefaultFontStyle,
  fontSizeAdjustment: validation_exports.positiveNumber,
  align: DefaultHorizontalAlignStyle,
  verticalAlign: DefaultVerticalAlignStyle,
  growY: validation_exports.positiveNumber,
  url: validation_exports.linkUrl,
  richText: richTextValidator,
  scale: validation_exports.nonZeroNumber
};
var Versions10 = createShapePropsMigrationIds("note", {
  AddUrlProp: 1,
  RemoveJustify: 2,
  MigrateLegacyAlign: 3,
  AddVerticalAlign: 4,
  MakeUrlsValid: 5,
  AddFontSizeAdjustment: 6,
  AddScale: 7,
  AddLabelColor: 8,
  AddRichText: 9
});
var noteShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions10.AddUrlProp,
      up: (props) => {
        props.url = "";
      },
      down: "retired"
    },
    {
      id: Versions10.RemoveJustify,
      up: (props) => {
        if (props.align === "justify") {
          props.align = "start";
        }
      },
      down: "retired"
    },
    {
      id: Versions10.MigrateLegacyAlign,
      up: (props) => {
        switch (props.align) {
          case "start":
            props.align = "start-legacy";
            return;
          case "end":
            props.align = "end-legacy";
            return;
          default:
            props.align = "middle-legacy";
            return;
        }
      },
      down: "retired"
    },
    {
      id: Versions10.AddVerticalAlign,
      up: (props) => {
        props.verticalAlign = "middle";
      },
      down: "retired"
    },
    {
      id: Versions10.MakeUrlsValid,
      up: (props) => {
        if (!validation_exports.linkUrl.isValid(props.url)) {
          props.url = "";
        }
      },
      down: (_props) => {
      }
    },
    {
      id: Versions10.AddFontSizeAdjustment,
      up: (props) => {
        props.fontSizeAdjustment = 0;
      },
      down: (props) => {
        delete props.fontSizeAdjustment;
      }
    },
    {
      id: Versions10.AddScale,
      up: (props) => {
        props.scale = 1;
      },
      down: (props) => {
        delete props.scale;
      }
    },
    {
      id: Versions10.AddLabelColor,
      up: (props) => {
        props.labelColor = "black";
      },
      down: (props) => {
        delete props.labelColor;
      }
    },
    {
      id: Versions10.AddRichText,
      up: (props) => {
        props.richText = toRichText(props.text);
        delete props.text;
      }
      // N.B. Explicitly no down state so that we force clients to update.
      // down: (props) => {
      // 	delete props.richText
      // },
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/styles/TLTextAlignStyle.mjs
var DefaultTextAlignStyle = StyleProp.defineEnum("tldraw:textAlign", {
  defaultValue: "start",
  values: ["start", "middle", "end"]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLTextShape.mjs
var textShapeProps = {
  color: DefaultColorStyle,
  size: DefaultSizeStyle,
  font: DefaultFontStyle,
  textAlign: DefaultTextAlignStyle,
  w: validation_exports.nonZeroNumber,
  richText: richTextValidator,
  scale: validation_exports.nonZeroNumber,
  autoSize: validation_exports.boolean
};
var Versions11 = createShapePropsMigrationIds("text", {
  RemoveJustify: 1,
  AddTextAlign: 2,
  AddRichText: 3
});
var textShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions11.RemoveJustify,
      up: (props) => {
        if (props.align === "justify") {
          props.align = "start";
        }
      },
      down: "retired"
    },
    {
      id: Versions11.AddTextAlign,
      up: (props) => {
        props.textAlign = props.align;
        delete props.align;
      },
      down: (props) => {
        props.align = props.textAlign;
        delete props.textAlign;
      }
    },
    {
      id: Versions11.AddRichText,
      up: (props) => {
        props.richText = toRichText(props.text);
        delete props.text;
      }
      // N.B. Explicitly no down state so that we force clients to update.
      // down: (props) => {
      // 	delete props.richText
      // },
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/shapes/TLVideoShape.mjs
var videoShapeProps = {
  w: validation_exports.nonZeroNumber,
  h: validation_exports.nonZeroNumber,
  time: validation_exports.number,
  playing: validation_exports.boolean,
  autoplay: validation_exports.boolean,
  url: validation_exports.linkUrl,
  assetId: assetIdValidator.nullable(),
  altText: validation_exports.string
};
var Versions12 = createShapePropsMigrationIds("video", {
  AddUrlProp: 1,
  MakeUrlsValid: 2,
  AddAltText: 3,
  AddAutoplay: 4
});
var videoShapeMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: Versions12.AddUrlProp,
      up: (props) => {
        props.url = "";
      },
      down: "retired"
    },
    {
      id: Versions12.MakeUrlsValid,
      up: (props) => {
        if (!validation_exports.linkUrl.isValid(props.url)) {
          props.url = "";
        }
      },
      down: (_props) => {
      }
    },
    {
      id: Versions12.AddAltText,
      up: (props) => {
        props.altText = "";
      },
      down: (props) => {
        delete props.altText;
      }
    },
    {
      id: Versions12.AddAutoplay,
      up: (props) => {
        props.autoplay = true;
      },
      down: (props) => {
        delete props.autoplay;
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/store-migrations.mjs
var Versions13 = createMigrationIds("com.tldraw.store", {
  RemoveCodeAndIconShapeTypes: 1,
  AddInstancePresenceType: 2,
  RemoveTLUserAndPresenceAndAddPointer: 3,
  RemoveUserDocument: 4
});
var storeMigrations = createMigrationSequence({
  sequenceId: "com.tldraw.store",
  retroactive: false,
  sequence: [
    {
      id: Versions13.RemoveCodeAndIconShapeTypes,
      scope: "store",
      up: (store) => {
        for (const [id, record] of objectMapEntries(store)) {
          if (record.typeName === "shape" && (record.type === "icon" || record.type === "code")) {
            delete store[id];
          }
        }
      }
    },
    {
      id: Versions13.AddInstancePresenceType,
      scope: "store",
      up(_store) {
      }
    },
    {
      // remove user and presence records and add pointer records
      id: Versions13.RemoveTLUserAndPresenceAndAddPointer,
      scope: "store",
      up: (store) => {
        for (const [id, record] of objectMapEntries(store)) {
          if (record.typeName.match(/^(user|user_presence)$/)) {
            delete store[id];
          }
        }
      }
    },
    {
      // remove user document records
      id: Versions13.RemoveUserDocument,
      scope: "store",
      up: (store) => {
        for (const [id, record] of objectMapEntries(store)) {
          if (record.typeName.match("user_document")) {
            delete store[id];
          }
        }
      }
    }
  ]
});

// node_modules/@tldraw/tlschema/dist-esm/createTLSchema.mjs
var defaultShapeSchemas = {
  arrow: { migrations: arrowShapeMigrations, props: arrowShapeProps },
  bookmark: { migrations: bookmarkShapeMigrations, props: bookmarkShapeProps },
  draw: { migrations: drawShapeMigrations, props: drawShapeProps },
  embed: { migrations: embedShapeMigrations, props: embedShapeProps },
  frame: { migrations: frameShapeMigrations, props: frameShapeProps },
  geo: { migrations: geoShapeMigrations, props: geoShapeProps },
  group: { migrations: groupShapeMigrations, props: groupShapeProps },
  highlight: { migrations: highlightShapeMigrations, props: highlightShapeProps },
  image: { migrations: imageShapeMigrations, props: imageShapeProps },
  line: { migrations: lineShapeMigrations, props: lineShapeProps },
  note: { migrations: noteShapeMigrations, props: noteShapeProps },
  text: { migrations: textShapeMigrations, props: textShapeProps },
  video: { migrations: videoShapeMigrations, props: videoShapeProps }
};
var defaultBindingSchemas = {
  arrow: { migrations: arrowBindingMigrations, props: arrowBindingProps }
};
function createTLSchema({
  shapes = defaultShapeSchemas,
  bindings = defaultBindingSchemas,
  migrations
} = {}) {
  const stylesById = /* @__PURE__ */ new Map();
  for (const shape of objectMapValues(shapes)) {
    for (const style of getShapePropKeysByStyle(shape.props ?? {}).keys()) {
      if (stylesById.has(style.id) && stylesById.get(style.id) !== style) {
        throw new Error(`Multiple StyleProp instances with the same id: ${style.id}`);
      }
      stylesById.set(style.id, style);
    }
  }
  const ShapeRecordType = createShapeRecordType(shapes);
  const BindingRecordType = createBindingRecordType(bindings);
  const InstanceRecordType = createInstanceRecordType(stylesById);
  return StoreSchema.create(
    {
      asset: AssetRecordType,
      binding: BindingRecordType,
      camera: CameraRecordType,
      document: DocumentRecordType,
      instance: InstanceRecordType,
      instance_page_state: InstancePageStateRecordType,
      page: PageRecordType,
      instance_presence: InstancePresenceRecordType,
      pointer: PointerRecordType,
      shape: ShapeRecordType
    },
    {
      migrations: [
        storeMigrations,
        assetMigrations,
        cameraMigrations,
        documentMigrations,
        instanceMigrations,
        instancePageStateMigrations,
        pageMigrations,
        instancePresenceMigrations,
        pointerMigrations,
        rootShapeMigrations,
        bookmarkAssetMigrations,
        imageAssetMigrations,
        videoAssetMigrations,
        ...processPropsMigrations("shape", shapes),
        ...processPropsMigrations("binding", bindings),
        ...migrations ?? []
      ],
      onValidationFailure,
      createIntegrityChecker
    }
  );
}

// node_modules/@tldraw/tlschema/dist-esm/misc/TLHandle.mjs
var TL_HANDLE_TYPES = /* @__PURE__ */ new Set(["vertex", "virtual", "create", "clone"]);

// node_modules/@tldraw/tlschema/dist-esm/translations/languages.mjs
var LANGUAGES = [
  { locale: "id", label: "Bahasa Indonesia" },
  { locale: "ms", label: "Bahasa Melayu" },
  { locale: "ca", label: "Català" },
  { locale: "cs", label: "Čeština" },
  { locale: "da", label: "Danish" },
  { locale: "de", label: "Deutsch" },
  { locale: "en", label: "English" },
  { locale: "es", label: "Español" },
  { locale: "tl", label: "Filipino" },
  { locale: "fr", label: "Français" },
  { locale: "gl", label: "Galego" },
  { locale: "hr", label: "Hrvatski" },
  { locale: "it", label: "Italiano" },
  { locale: "hu", label: "Magyar" },
  { locale: "nl", label: "Nederlands" },
  { locale: "no", label: "Norwegian" },
  { locale: "pl", label: "Polski" },
  { locale: "pt-br", label: "Português - Brasil" },
  { locale: "pt-pt", label: "Português - Europeu" },
  { locale: "ro", label: "Română" },
  { locale: "sl", label: "Slovenščina" },
  { locale: "so", label: "Somali" },
  { locale: "fi", label: "Suomi" },
  { locale: "sv", label: "Svenska" },
  { locale: "vi", label: "Tiếng Việt" },
  { locale: "tr", label: "Türkçe" },
  { locale: "el", label: "Ελληνικά" },
  { locale: "ru", label: "Русский" },
  { locale: "uk", label: "Українська" },
  { locale: "he", label: "עברית" },
  { locale: "ur", label: "اردو" },
  { locale: "ar", label: "عربي" },
  { locale: "fa", label: "فارسی" },
  { locale: "ne", label: "नेपाली" },
  { locale: "mr", label: "मराठी" },
  { locale: "hi-in", label: "हिन्दी" },
  { locale: "bn", label: "বাংলা" },
  { locale: "pa", label: "ਪੰਜਾਬੀ" },
  { locale: "gu-in", label: "ગુજરાતી" },
  { locale: "ta", label: "தமிழ்" },
  { locale: "te", label: "తెలుగు" },
  { locale: "kn", label: "ಕನ್ನಡ" },
  { locale: "ml", label: "മലയാളം" },
  { locale: "th", label: "ภาษาไทย" },
  { locale: "km-kh", label: "ភាសាខ្មែរ" },
  { locale: "ko-kr", label: "한국어" },
  { locale: "ja", label: "日本語" },
  { locale: "zh-cn", label: "简体中文" },
  { locale: "zh-tw", label: "繁體中文 (台灣)" }
];

// node_modules/@tldraw/tlschema/dist-esm/translations/translations.mjs
function getDefaultTranslationLocale() {
  const locales = typeof window !== "undefined" ? window.navigator.languages ?? ["en"] : ["en"];
  return _getDefaultTranslationLocale(locales);
}
function _getDefaultTranslationLocale(locales) {
  for (const locale of locales) {
    const supportedLocale = getSupportedLocale(locale);
    if (supportedLocale) {
      return supportedLocale;
    }
  }
  return "en";
}
var DEFAULT_LOCALE_REGIONS = {
  zh: "zh-cn",
  pt: "pt-br",
  ko: "ko-kr",
  hi: "hi-in"
};
function getSupportedLocale(locale) {
  const exactMatch = LANGUAGES.find((t) => t.locale === locale.toLowerCase());
  if (exactMatch) {
    return exactMatch.locale;
  }
  const [language, region] = locale.split(/[-_]/).map((s) => s.toLowerCase());
  if (region) {
    const languageMatch = LANGUAGES.find((t) => t.locale === language);
    if (languageMatch) {
      return languageMatch.locale;
    }
  }
  if (language in DEFAULT_LOCALE_REGIONS) {
    return DEFAULT_LOCALE_REGIONS[language];
  }
  return null;
}

// node_modules/@tldraw/tlschema/dist-esm/index.mjs
registerTldrawLibraryVersion(
  "@tldraw/tlschema",
  "3.15.6",
  "esm"
);

export {
  registerTldrawLibraryVersion,
  rotateArray,
  dedupe,
  compact,
  last,
  minBy,
  maxBy,
  partition,
  areArraysShallowEqual,
  mergeArraysAndReplaceDefaults,
  omitFromStackTrace,
  noop,
  Result,
  exhaustiveSwitchError,
  assert,
  assertExists,
  promiseWithResolve,
  sleep,
  bind,
  WeakCache,
  debounce,
  annotateError,
  getErrorAnnotations,
  ExecutionQueue,
  fetch,
  Image,
  FileHelpers,
  getHashForString,
  getHashForObject,
  getHashForBuffer,
  lns,
  mockUniqueId,
  restoreUniqueId,
  uniqueId,
  getFirstFromIterable,
  PngHelpers,
  DEFAULT_SUPPORTED_IMAGE_TYPES,
  DEFAULT_SUPPORT_VIDEO_TYPES,
  DEFAULT_SUPPORTED_MEDIA_TYPES,
  DEFAULT_SUPPORTED_MEDIA_TYPE_LIST,
  MediaHelpers,
  lerp,
  invLerp,
  rng,
  modulate,
  hasOwnProperty,
  getOwnProperty,
  objectMapKeys,
  objectMapValues,
  objectMapEntries,
  objectMapFromEntries,
  filterEntries,
  mapObjectMapValues,
  areObjectsShallowEqual,
  groupBy,
  omit,
  getChangedKeys,
  isEqualAllowingForFloatingPointErrors,
  measureCbDuration,
  measureDuration,
  measureAverageDuration,
  PerformanceTracker,
  ZERO_INDEX_KEY,
  validateIndexKey,
  getIndicesBetween,
  getIndicesAbove,
  getIndicesBelow,
  getIndexBetween,
  getIndexAbove,
  getIndexBelow,
  getIndices,
  sortByIndex,
  retry,
  sortById,
  getFromLocalStorage,
  setInLocalStorage,
  deleteFromLocalStorage,
  clearLocalStorage,
  getFromSessionStorage,
  setInSessionStorage,
  deleteFromSessionStorage,
  clearSessionStorage,
  stringEnum,
  fpsThrottle,
  throttleToNextFrame,
  Timers,
  safeParseUrl,
  isDefined,
  isNonNull,
  isNonNullish,
  structuredClone,
  isNativeStructuredClone,
  STRUCTURED_CLONE_OBJECT_PROTOTYPE,
  warnDeprecatedGetter,
  warnOnce,
  import_lodash2 as import_lodash,
  import_lodash3 as import_lodash2,
  import_lodash4 as import_lodash3,
  import_lodash5 as import_lodash4,
  Validator,
  ArrayOfValidator,
  ObjectValidator,
  UnionValidator,
  DictValidator,
  validation_exports,
  idValidator,
  assetIdValidator,
  createAssetValidator,
  vecModelValidator,
  boxModelValidator,
  EMPTY_ARRAY,
  ArraySet,
  RESET_VALUE,
  EffectScheduler,
  react,
  reactor,
  transaction,
  transact,
  deferAsyncEffects,
  UNINITIALIZED,
  isUninitialized,
  withDiff,
  getComputedInstance,
  computed,
  unsafe__withoutCapture,
  whyAmIRunning,
  atom,
  isAtom,
  isSignal,
  AtomMap,
  devFreeze,
  IncrementalSetConstructor,
  defineMigrations,
  createMigrationSequence,
  createMigrationIds,
  createRecordMigrationSequence,
  parseMigrationId,
  MigrationFailureReason,
  createEmptyRecordsDiff,
  reverseRecordsDiff,
  isRecordsDiffEmpty,
  squashRecordDiffs,
  squashRecordDiffsMutable,
  RecordType,
  createRecordType,
  assertIdType,
  StoreQueries,
  StoreSideEffects,
  Store,
  createComputedCache,
  StoreSchema,
  opacityValidator,
  parentIdValidator,
  shapeIdValidator,
  createShapeValidator,
  bindingIdValidator,
  createBindingValidator,
  rootBindingMigrations,
  isBinding,
  isBindingId,
  createBindingId,
  createBindingPropsMigrationSequence,
  createBindingPropsMigrationIds,
  StyleProp,
  EnumStyleProp,
  rootShapeMigrations,
  isShape,
  isShapeId,
  createShapeId,
  getShapePropKeysByStyle,
  createShapePropsMigrationSequence,
  createShapePropsMigrationIds,
  defaultColorNames,
  DefaultColorThemePalette,
  getDefaultColorTheme,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultFontFamilies,
  DefaultSizeStyle,
  ArrowShapeKindStyle,
  ArrowShapeArrowheadStartStyle,
  ArrowShapeArrowheadEndStyle,
  arrowShapeProps,
  arrowShapeVersions,
  arrowShapeMigrations,
  ElbowArrowSnap,
  arrowBindingProps,
  arrowBindingVersions,
  arrowBindingMigrations,
  CameraRecordType,
  TL_CURSOR_TYPES,
  TL_CANVAS_UI_COLOR_TYPES,
  canvasUiColorTypeValidator,
  TL_SCRIBBLE_STATES,
  scribbleValidator,
  pageIdValidator,
  PageRecordType,
  isPageId,
  pluckPreservingValues,
  TLINSTANCE_ID,
  InstancePageStateRecordType,
  PointerRecordType,
  TLPOINTER_ID,
  InstancePresenceRecordType,
  createPresenceStateDerivation,
  getDefaultUserPresence,
  isDocument,
  DocumentRecordType,
  TLDOCUMENT_ID,
  assetValidator,
  assetMigrations,
  AssetRecordType,
  bookmarkShapeProps,
  bookmarkShapeMigrations,
  drawShapeProps,
  drawShapeMigrations,
  embedShapeProps,
  embedShapeMigrations,
  frameShapeProps,
  frameShapeMigrations,
  richTextValidator,
  toRichText,
  DefaultHorizontalAlignStyle,
  DefaultVerticalAlignStyle,
  GeoShapeGeoStyle,
  geoShapeProps,
  geoShapeMigrations,
  groupShapeProps,
  groupShapeMigrations,
  highlightShapeProps,
  highlightShapeMigrations,
  ImageShapeCrop,
  imageShapeProps,
  imageShapeMigrations,
  LineShapeSplineStyle,
  lineShapeProps,
  lineShapeMigrations,
  noteShapeProps,
  noteShapeMigrations,
  DefaultTextAlignStyle,
  textShapeProps,
  textShapeMigrations,
  videoShapeProps,
  videoShapeMigrations,
  defaultShapeSchemas,
  defaultBindingSchemas,
  createTLSchema,
  TL_HANDLE_TYPES,
  LANGUAGES,
  getDefaultTranslationLocale
};
//# sourceMappingURL=chunk-2YXWVZUM.js.map
