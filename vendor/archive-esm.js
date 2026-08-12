const __AW_WASM_B64 = ""; var wasmBinary = null; var wasmBinaryFile = "libarchive.wasm"; function __awDecode(b64){const bin=atob(b64);const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return u8.buffer;} wasmBinary = __awDecode(__AW_WASM_B64); function __awFetch(url, opts){ if (typeof url === "string" && url.indexOf("data:") === 0) return globalThis["fetch"](url, opts); throw new Error("offline"); }

// package/src/path.mjs
var CHAR_DOT = 46;
var CHAR_FORWARD_SLASH = 47;
function isPosixPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH;
}
function normalizeString(path, allowAboveRoot, separator, isPathSeparator) {
  let res = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isPathSeparator(code)) {
      break;
    } else {
      code = CHAR_FORWARD_SLASH;
    }
    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== CHAR_DOT || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.lastIndexOf(separator);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          }
          if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${separator}..` : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += `${separator}${path.slice(lastSlash + 1, i)}`;
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}
function resolve(...args) {
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
    const path = args[i];
    if (typeof path !== "string") {
      throw new TypeError(`Expected a string for paths[${i}]`);
    }
    if (path.length === 0) {
      continue;
    }
    resolvedPath = `${path}/${resolvedPath}`;
    resolvedAbsolute = path?.charCodeAt(0) === CHAR_FORWARD_SLASH;
  }
  if (!resolvedAbsolute) {
    resolvedPath = `/${resolvedPath}`;
    resolvedAbsolute = true;
  }
  resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
  return resolvedAbsolute ? `/${resolvedPath}` : resolvedPath.length > 0 ? resolvedPath : ".";
}
function normalize(path) {
  if (typeof path !== "string") {
    throw new TypeError(`Expected a string for path`);
  }
  if (path.length === 0) return ".";
  const isAbsolute2 = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  path = normalizeString(path, !isAbsolute2, "/", isPosixPathSeparator);
  return path.length === 0 ? isAbsolute2 ? "/" : "." : isAbsolute2 ? `/${path}` : path;
}
function isAbsolute(path) {
  if (typeof path !== "string") {
    throw new TypeError(`Expected a string for path`);
  }
  return path.length > 0 && path.charCodeAt(0) === CHAR_FORWARD_SLASH;
}
function relative(from, to) {
  if (typeof from !== "string") {
    throw new TypeError(`Expected a string for from`);
  }
  if (typeof to !== "string") {
    throw new TypeError(`Expected a string for to`);
  }
  if (from === to) {
    return "";
  }
  from = resolve(from);
  to = resolve(to);
  if (from === to) {
    return "";
  }
  const fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  const toStart = 1;
  const toLen = to.length - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i < length; i++) {
    const fromCode = from.charCodeAt(fromStart + i);
    if (fromCode !== to.charCodeAt(toStart + i)) {
      break;
    }
    if (fromCode === CHAR_FORWARD_SLASH) {
      lastCommonSep = i;
    }
  }
  if (i === length) {
    if (toLen > length) {
      if (to.charCodeAt(toStart + i) === CHAR_FORWARD_SLASH) {
        return to.slice(toStart + i + 1);
      }
      if (i === 0) {
        return to.slice(toStart + i);
      }
    } else if (fromLen > length) {
      if (from.charCodeAt(fromStart + i) === CHAR_FORWARD_SLASH) {
        lastCommonSep = i;
      } else if (i === 0) {
        lastCommonSep = 0;
      }
    }
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      out += out.length === 0 ? ".." : "/..";
    }
  }
  return `${out}${to.slice(toStart + lastCommonSep)}`;
}
function dirname(path) {
  if (typeof path !== "string") {
    throw new TypeError(`Expected a string for path`);
  }
  if (path.length === 0) {
    return ".";
  }
  const hasRoot = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === CHAR_FORWARD_SLASH) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    return hasRoot ? "/" : ".";
  }
  if (hasRoot && end === 1) {
    return "//";
  }
  return path.slice(0, end);
}
var path_default = {
  resolve,
  normalize,
  isAbsolute,
  relative,
  dirname
};

// package/src/wasm/enums.mjs
var ReturnCode = {
  OK: 0,
  EOF: 1,
  RETRY: -10,
  WARN: -20,
  FAILED: -25,
  FATAL: -30
};
var EntryType = {
  FILE: 32768,
  SYMBOLIC_LINK: 40960,
  SOCKET: 49152,
  CHARACTER_DEVICE: 8192,
  BLOCK_DEVICE: 24576,
  DIR: 16384,
  NAMED_PIPE: 4096
};
var EntryTypeName = {
  /** @type {EntryTypeName} */
  [EntryType.FILE]: "FILE",
  /** @type {EntryTypeName} */
  [EntryType.NAMED_PIPE]: "NAMED_PIPE",
  /** @type {EntryTypeName} */
  [EntryType.SOCKET]: "SOCKET",
  /** @type {EntryTypeName} */
  [EntryType.DIR]: "DIR",
  /** @type {EntryTypeName} */
  [EntryType.BLOCK_DEVICE]: "BLOCK_DEVICE",
  /** @type {EntryTypeName} */
  [EntryType.SYMBOLIC_LINK]: "SYMBOLIC_LINK",
  /** @type {EntryTypeName} */
  [EntryType.CHARACTER_DEVICE]: "CHARACTER_DEVICE"
};
var FILETYPE_FLAG = 61440;

// package/src/wasm/errors.mjs
var EPASS = -37455;
var ENULL = -37456;
var ARCHIVE_ERRNO_MISC = -1;
var ARCHIVE_ERRNO_FILE_FORMAT = -2;
var ARCHIVE_ERRNO_PROGRAMMER_ERROR = -3;
var ArchiveError = class extends Error {
  /**
   * Creates a new ArchiveError instance.
   * @param {number} code The error code.
   * @param {string} [message] The error message.
   */
  constructor(code, message) {
    super(message || "Unknown error");
    this.code = code;
    this.name = this.constructor.name;
  }
};
var NullError = class extends ArchiveError {
  /**
   * Creates a new NullError instance.
   * @param {string} [message] The error message.
   */
  constructor(message) {
    super(ENULL, message || "Unexpected Pointer.NULL");
  }
};
var RetryError = class extends ArchiveError {
};
var FatalError = class extends ArchiveError {
};
var FailedError = class extends ArchiveError {
};
var FileReadError = class extends ArchiveError {
};
var PassphraseError = class extends ArchiveError {
  /**
   * Creates a new PassphraseError instance.
   * @param {number} code The error code.
   * @param {string} [message] The error message.
   */
  constructor(code, message) {
    super(code, message || "Passphrase required for this entry");
  }
};
var ExceedSizeLimitError = class extends ArchiveError {
  /**
   * Creates a new ExceedSizeLimitError instance.
   * @param {string} [message] The error message.
   */
  constructor(message) {
    super(ARCHIVE_ERRNO_MISC, message || "Archive exceeds the size limit");
  }
};
var ExceedRecursionLimitError = class extends ArchiveError {
  /**
   * Creates a new ExceedRecursionLimitError instance.
   * @param {string} [message] The error message.
   */
  constructor(message) {
    super(ARCHIVE_ERRNO_MISC, message || "Archive exceeds the recursion limit");
  }
};

// package/src/wasm/libarchive.mjs
var wasmFactory = /* @__PURE__ */ (() => {
  var _scriptName = "";
  return async function(moduleArg = {}) {
    var moduleRtn;
    var Module = moduleArg;
    var readyPromiseResolve, readyPromiseReject;
    var readyPromise = new Promise((resolve2, reject) => {
      readyPromiseResolve = resolve2;
      readyPromiseReject = reject;
    });
    var ENVIRONMENT_IS_WEB = typeof window == "object";
    var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != "undefined";
    var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string" && process.type != "renderer";
    var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
    if (ENVIRONMENT_IS_NODE) {
      const { createRequire } = await import("module");
      var require2 = createRequire("");
    }
    var moduleOverrides = {
      ...Module
    };
    var arguments_ = [];
    var thisProgram = "./this.program";
    var quit_ = (status, toThrow) => {
      throw toThrow;
    };
    var scriptDirectory = "";
    function locateFile(path) {
      return scriptDirectory + path;
    }
    var readAsync, readBinary;
    if (ENVIRONMENT_IS_NODE) {
      if (typeof process == "undefined" || !process.release || process.release.name !== "node")
        throw new Error(
          "not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)"
        );
      var nodeVersion = process.versions.node;
      var numericVersion = nodeVersion.split(".").slice(0, 3);
      numericVersion = numericVersion[0] * 1e4 + numericVersion[1] * 100 + numericVersion[2].split("-")[0] * 1;
      if (numericVersion < 18e4) {
        throw new Error(
          "This emscripten-generated code requires node v18.0.0 (detected v" + nodeVersion + ")"
        );
      }
      var fs = require2("fs");
      var nodePath = require2("path");
      if (!"".startsWith("data:")) {
        scriptDirectory = nodePath.dirname(require2("url").fileURLToPath("")) + "/";
      }
      readBinary = (filename) => {
        filename = isFileURI(filename) ? new URL(filename) : filename;
        var ret = fs.readFileSync(filename);
        assert(Buffer.isBuffer(ret));
        return ret;
      };
      readAsync = async (filename, binary = true) => {
        filename = isFileURI(filename) ? new URL(filename) : filename;
        var ret = fs.readFileSync(filename, binary ? void 0 : "utf8");
        assert(binary ? Buffer.isBuffer(ret) : typeof ret == "string");
        return ret;
      };
      if (!Module["thisProgram"] && process.argv.length > 1) {
        thisProgram = process.argv[1].replace(/\\/g, "/");
      }
      arguments_ = process.argv.slice(2);
      quit_ = (status, toThrow) => {
        process.exitCode = status;
        throw toThrow;
      };
    } else if (ENVIRONMENT_IS_SHELL) {
      if (typeof process == "object" && typeof require2 === "function" || typeof window == "object" || typeof WorkerGlobalScope != "undefined")
        throw new Error(
          "not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)"
        );
    } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      if (ENVIRONMENT_IS_WORKER) {
        scriptDirectory = self.location.href;
      } else if (typeof document != "undefined" && document.currentScript) {
        scriptDirectory = document.currentScript.src;
      }
      if (_scriptName) {
        scriptDirectory = _scriptName;
      }
      if (scriptDirectory.startsWith("blob:")) {
        scriptDirectory = "";
      } else {
        scriptDirectory = scriptDirectory.slice(
          0,
          scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1
        );
      }
      if (!(typeof window == "object" || typeof WorkerGlobalScope != "undefined"))
        throw new Error(
          "not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)"
        );
      {
        if (ENVIRONMENT_IS_WORKER) {
          readBinary = (url) => {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            xhr.responseType = "arraybuffer";
            xhr.send(null);
            return new Uint8Array(
              /** @type{!ArrayBuffer} */
              xhr.response
            );
          };
        }
        readAsync = async (url) => {
          if (isFileURI(url)) {
            return new Promise((resolve2, reject) => {
              var xhr = new XMLHttpRequest();
              xhr.open("GET", url, true);
              xhr.responseType = "arraybuffer";
              xhr.onload = () => {
                if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                  resolve2(xhr.response);
                  return;
                }
                reject(xhr.status);
              };
              xhr.onerror = reject;
              xhr.send(null);
            });
          }
          var response = await fetch(url, {
            credentials: "same-origin"
          });
          if (response.ok) {
            return response.arrayBuffer();
          }
          throw new Error(response.status + " : " + response.url);
        };
      }
    } else {
      throw new Error("environment detection error");
    }
    var out = console.log.bind(console);
    var err = console.error.bind(console);
    Object.assign(Module, moduleOverrides);
    moduleOverrides = null;
    checkIncomingModuleAPI();
    legacyModuleProp("arguments", "arguments_");
    legacyModuleProp("thisProgram", "thisProgram");
    assert(
      typeof Module["memoryInitializerPrefixURL"] == "undefined",
      "Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead"
    );
    assert(
      typeof Module["pthreadMainPrefixURL"] == "undefined",
      "Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead"
    );
    assert(
      typeof Module["cdInitializerPrefixURL"] == "undefined",
      "Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead"
    );
    assert(
      typeof Module["filePackagePrefixURL"] == "undefined",
      "Module.filePackagePrefixURL option was removed, use Module.locateFile instead"
    );
    assert(typeof Module["read"] == "undefined", "Module.read option was removed");
    assert(
      typeof Module["readAsync"] == "undefined",
      "Module.readAsync option was removed (modify readAsync in JS)"
    );
    assert(
      typeof Module["readBinary"] == "undefined",
      "Module.readBinary option was removed (modify readBinary in JS)"
    );
    assert(
      typeof Module["setWindowTitle"] == "undefined",
      "Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)"
    );
    assert(
      typeof Module["TOTAL_MEMORY"] == "undefined",
      "Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY"
    );
    legacyModuleProp("asm", "wasmExports");
    legacyModuleProp("readAsync", "readAsync");
    legacyModuleProp("readBinary", "readBinary");
    legacyModuleProp("setWindowTitle", "setWindowTitle");
    assert(
      !ENVIRONMENT_IS_SHELL,
      "shell environment detected but not enabled at build time.  Add `shell` to `-sENVIRONMENT` to enable."
    );
    var wasmBinary;
    legacyModuleProp("wasmBinary", "wasmBinary");
    if (typeof WebAssembly != "object") {
      err("no native wasm support detected");
    }
    var wasmMemory;
    var ABORT = false;
    var EXITSTATUS;
    function assert(condition, text) {
      if (!condition) {
        abort("Assertion failed" + (text ? ": " + text : ""));
      }
    }
    var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAP64, HEAPU64, HEAPF64;
    var HEAP_DATA_VIEW;
    var runtimeInitialized = false;
    var isFileURI = (filename) => filename.startsWith("file://");
    function writeStackCookie() {
      var max = _emscripten_stack_get_end();
      assert((max & 3) == 0);
      if (max == 0) {
        max += 4;
      }
      LE_HEAP_STORE_U32((max >> 2) * 4, 34821223);
      LE_HEAP_STORE_U32((max + 4 >> 2) * 4, 2310721022);
      LE_HEAP_STORE_U32((0 >> 2) * 4, 1668509029);
    }
    function checkStackCookie() {
      if (ABORT) return;
      var max = _emscripten_stack_get_end();
      if (max == 0) {
        max += 4;
      }
      var cookie1 = LE_HEAP_LOAD_U32((max >> 2) * 4);
      var cookie2 = LE_HEAP_LOAD_U32((max + 4 >> 2) * 4);
      if (cookie1 != 34821223 || cookie2 != 2310721022) {
        abort(
          `Stack overflow! Stack cookie has been overwritten at ${ptrToString(max)}, expected hex dwords 0x89BACDFE and 0x2135467, but received ${ptrToString(cookie2)} ${ptrToString(cookie1)}`
        );
      }
      if (LE_HEAP_LOAD_U32((0 >> 2) * 4) != 1668509029) {
        abort("Runtime error: The application has corrupted its heap memory area (address zero)!");
      }
    }
    if (Module["ENVIRONMENT"]) {
      throw new Error(
        "Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)"
      );
    }
    function legacyModuleProp(prop, newName, incoming = true) {
      if (!Object.getOwnPropertyDescriptor(Module, prop)) {
        Object.defineProperty(Module, prop, {
          configurable: true,
          get() {
            let extra = incoming ? " (the initial value can be provided on Module, but after startup the value is only looked for on a local variable of that name)" : "";
            abort(`\`Module.${prop}\` has been replaced by \`${newName}\`` + extra);
          }
        });
      }
    }
    function ignoredModuleProp(prop) {
      if (Object.getOwnPropertyDescriptor(Module, prop)) {
        abort(
          `\`Module.${prop}\` was supplied but \`${prop}\` not included in INCOMING_MODULE_JS_API`
        );
      }
    }
    function isExportedByForceFilesystem(name) {
      return name === "FS_createPath" || name === "FS_createDataFile" || name === "FS_createPreloadedFile" || name === "FS_unlink" || name === "addRunDependency" || // The old FS has some functionality that WasmFS lacks.
      name === "FS_createLazyFile" || name === "FS_createDevice" || name === "removeRunDependency";
    }
    function hookGlobalSymbolAccess(sym, func) {
      if (typeof globalThis != "undefined" && !Object.getOwnPropertyDescriptor(globalThis, sym)) {
        Object.defineProperty(globalThis, sym, {
          configurable: true,
          get() {
            func();
            return void 0;
          }
        });
      }
    }
    function missingGlobal(sym, msg) {
      hookGlobalSymbolAccess(sym, () => {
        warnOnce(`\`${sym}\` is not longer defined by emscripten. ${msg}`);
      });
    }
    missingGlobal("buffer", "Please use HEAP8.buffer or wasmMemory.buffer");
    missingGlobal("asm", "Please use wasmExports instead");
    function missingLibrarySymbol(sym) {
      hookGlobalSymbolAccess(sym, () => {
        var msg = `\`${sym}\` is a library symbol and not included by default; add it to your library.js __deps or to DEFAULT_LIBRARY_FUNCS_TO_INCLUDE on the command line`;
        var librarySymbol = sym;
        if (!librarySymbol.startsWith("_")) {
          librarySymbol = "$" + sym;
        }
        msg += ` (e.g. -sDEFAULT_LIBRARY_FUNCS_TO_INCLUDE='${librarySymbol}')`;
        if (isExportedByForceFilesystem(sym)) {
          msg += ". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you";
        }
        warnOnce(msg);
      });
      unexportedRuntimeSymbol(sym);
    }
    function unexportedRuntimeSymbol(sym) {
      if (!Object.getOwnPropertyDescriptor(Module, sym)) {
        Object.defineProperty(Module, sym, {
          configurable: true,
          get() {
            var msg = `'${sym}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;
            if (isExportedByForceFilesystem(sym)) {
              msg += ". Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you";
            }
            abort(msg);
          }
        });
      }
    }
    var runtimeDebug = true;
    function updateMemoryViews() {
      var b = wasmMemory.buffer;
      Module["HEAP8"] = HEAP8 = new Int8Array(b);
      HEAP16 = new Int16Array(b);
      HEAPU8 = new Uint8Array(b);
      HEAPU16 = new Uint16Array(b);
      HEAP32 = new Int32Array(b);
      HEAPU32 = new Uint32Array(b);
      HEAPF32 = new Float32Array(b);
      HEAPF64 = new Float64Array(b);
      HEAP64 = new BigInt64Array(b);
      HEAPU64 = new BigUint64Array(b);
      Module["HEAP_DATA_VIEW"] = HEAP_DATA_VIEW = new DataView(b);
      LE_HEAP_UPDATE();
    }
    assert(
      !Module["STACK_SIZE"],
      "STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time"
    );
    assert(
      typeof Int32Array != "undefined" && typeof Float64Array !== "undefined" && Int32Array.prototype.subarray != void 0 && Int32Array.prototype.set != void 0,
      "JS engine does not provide full typed array support"
    );
    {
      var INITIAL_MEMORY = 16777216;
      legacyModuleProp("INITIAL_MEMORY", "INITIAL_MEMORY");
      assert(
        INITIAL_MEMORY >= 65536,
        "INITIAL_MEMORY should be larger than STACK_SIZE, was " + INITIAL_MEMORY + "! (STACK_SIZE=65536)"
      );
      wasmMemory = new WebAssembly.Memory({
        initial: INITIAL_MEMORY / 65536,
        // In theory we should not need to emit the maximum if we want "unlimited"
        // or 4GB of memory, but VMs error on that atm, see
        // 
        // And in the pthreads case we definitely need to emit a maximum. So
        // always emit one.
        maximum: 32768
      });
    }
    updateMemoryViews();
    var __RELOC_FUNCS__ = [];
    function preRun() {
    }
    function initRuntime() {
      assert(!runtimeInitialized);
      runtimeInitialized = true;
      checkStackCookie();
      setStackLimits();
      callRuntimeCallbacks(__RELOC_FUNCS__);
    }
    function preMain() {
      checkStackCookie();
    }
    function postRun() {
      checkStackCookie();
    }
    var runDependencies = 0;
    var dependenciesFulfilled = null;
    var runDependencyTracking = {};
    var runDependencyWatcher = null;
    function addRunDependency(id) {
      runDependencies++;
      if (id) {
        assert(!runDependencyTracking[id]);
        runDependencyTracking[id] = 1;
        if (runDependencyWatcher === null && typeof setInterval != "undefined") {
          runDependencyWatcher = setInterval(() => {
            if (ABORT) {
              clearInterval(runDependencyWatcher);
              runDependencyWatcher = null;
              return;
            }
            var shown = false;
            for (var dep in runDependencyTracking) {
              if (!shown) {
                shown = true;
                err("still waiting on run dependencies:");
              }
              err(`dependency: ${dep}`);
            }
            if (shown) {
              err("(end of list)");
            }
          }, 1e4);
        }
      } else {
        err("warning: run dependency added without ID");
      }
    }
    function removeRunDependency(id) {
      runDependencies--;
      if (id) {
        assert(runDependencyTracking[id]);
        delete runDependencyTracking[id];
      } else {
        err("warning: run dependency removed without ID");
      }
      if (runDependencies == 0) {
        if (runDependencyWatcher !== null) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
        }
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback();
        }
      }
    }
    function abort(what) {
      what = "Aborted(" + what + ")";
      err(what);
      ABORT = true;
      if (runtimeInitialized) {
        ___trap();
      }
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject(e);
      throw e;
    }
    var FS = {
      error() {
        abort(
          "Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with -sFORCE_FILESYSTEM"
        );
      },
      init() {
        FS.error();
      },
      createDataFile() {
        FS.error();
      },
      createPreloadedFile() {
        FS.error();
      },
      createLazyFile() {
        FS.error();
      },
      open() {
        FS.error();
      },
      mkdev() {
        FS.error();
      },
      registerDevice() {
        FS.error();
      },
      analyzePath() {
        FS.error();
      },
      ErrnoError() {
        FS.error();
      }
    };
    Module["FS_createDataFile"] = FS.createDataFile;
    Module["FS_createPreloadedFile"] = FS.createPreloadedFile;
    function createExportWrapper(name, nargs) {
      return (...args) => {
        assert(
          runtimeInitialized,
          `native function \`${name}\` called before runtime initialization`
        );
        var f = wasmExports[name];
        assert(f, `exported native function \`${name}\` not found`);
        assert(
          args.length <= nargs,
          `native function \`${name}\` called with ${args.length} args but expects ${nargs}`
        );
        return f(...args);
      };
    }
    var wasmBinaryFile;
    function findWasmBinary() {
      if (Module["locateFile"]) {
        return locateFile("libarchive.wasm");
      }
      return new URL("libarchive.wasm", "").href;
    }
    function getBinarySync(file) {
      if (file == wasmBinaryFile && wasmBinary) {
        return new Uint8Array(wasmBinary);
      }
      if (readBinary) {
        return readBinary(file);
      }
      throw "both async and sync fetching of the wasm failed";
    }
    async function getWasmBinary(binaryFile) {
      if (!wasmBinary) {
        try {
          var response = await readAsync(binaryFile);
          return new Uint8Array(response);
        } catch {
        }
      }
      return getBinarySync(binaryFile);
    }
    async function instantiateArrayBuffer(binaryFile, imports) {
      try {
        var binary = await getWasmBinary(binaryFile);
        var instance = await WebAssembly.instantiate(binary, imports);
        return instance;
      } catch (reason) {
        err(`failed to asynchronously prepare wasm: ${reason}`);
        if (isFileURI(wasmBinaryFile)) {
          err(
            `warning: Loading from a file URI (${wasmBinaryFile}) is not supported in most browsers. See `
          );
        }
        abort(reason);
      }
    }
    async function instantiateAsync(binary, binaryFile, imports) {
      if (!binary && typeof WebAssembly.instantiateStreaming == "function" && !isFileURI(binaryFile) && !ENVIRONMENT_IS_NODE) {
        try {
          var response = fetch(binaryFile, {
            credentials: "same-origin"
          });
          var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
          return instantiationResult;
        } catch (reason) {
          err(`wasm streaming compile failed: ${reason}`);
          err("falling back to ArrayBuffer instantiation");
        }
      }
      return instantiateArrayBuffer(binaryFile, imports);
    }
    function getWasmImports() {
      return {
        "env": wasmImports,
        "wasi_snapshot_preview1": wasmImports,
        "GOT.mem": new Proxy(wasmImports, GOTHandler),
        "GOT.func": new Proxy(wasmImports, GOTHandler)
      };
    }
    async function createWasm() {
      function receiveInstance(instance, module) {
        wasmExports = instance.exports;
        wasmExports = relocateExports(wasmExports, 1024);
        reportUndefinedSymbols();
        __RELOC_FUNCS__.push(wasmExports["__wasm_apply_data_relocs"]);
        removeRunDependency("wasm-instantiate");
        return wasmExports;
      }
      addRunDependency("wasm-instantiate");
      var trueModule = Module;
      function receiveInstantiationResult(result2) {
        assert(
          Module === trueModule,
          "the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?"
        );
        trueModule = null;
        return receiveInstance(result2["instance"], result2["module"]);
      }
      var info = getWasmImports();
      wasmBinaryFile ??= findWasmBinary();
      try {
        var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
        var exports = receiveInstantiationResult(result);
        return exports;
      } catch (e) {
        readyPromiseReject(e);
        return Promise.reject(e);
      }
    }
    class ExitStatus {
      name = "ExitStatus";
      constructor(status) {
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }
    var GOT = {};
    var currentModuleWeakSymbols = /* @__PURE__ */ new Set([]);
    var GOTHandler = {
      get(obj, symName) {
        var rtn = GOT[symName];
        if (!rtn) {
          rtn = GOT[symName] = new WebAssembly.Global({
            value: "i32",
            mutable: true
          });
        }
        if (!currentModuleWeakSymbols.has(symName)) {
          rtn.required = true;
        }
        return rtn;
      }
    };
    var LE_ATOMICS_NATIVE_BYTE_ORDER = [];
    var LE_HEAP_LOAD_F32 = (byteOffset) => HEAP_DATA_VIEW.getFloat32(byteOffset, true);
    var LE_HEAP_LOAD_F64 = (byteOffset) => HEAP_DATA_VIEW.getFloat64(byteOffset, true);
    var LE_HEAP_LOAD_I16 = (byteOffset) => HEAP_DATA_VIEW.getInt16(byteOffset, true);
    var LE_HEAP_LOAD_I32 = (byteOffset) => HEAP_DATA_VIEW.getInt32(byteOffset, true);
    var LE_HEAP_LOAD_U32 = (byteOffset) => HEAP_DATA_VIEW.getUint32(byteOffset, true);
    var LE_HEAP_STORE_F32 = (byteOffset, value) => HEAP_DATA_VIEW.setFloat32(byteOffset, value, true);
    var LE_HEAP_STORE_F64 = (byteOffset, value) => HEAP_DATA_VIEW.setFloat64(byteOffset, value, true);
    var LE_HEAP_STORE_I16 = (byteOffset, value) => HEAP_DATA_VIEW.setInt16(byteOffset, value, true);
    var LE_HEAP_STORE_I32 = (byteOffset, value) => HEAP_DATA_VIEW.setInt32(byteOffset, value, true);
    var LE_HEAP_STORE_U32 = (byteOffset, value) => HEAP_DATA_VIEW.setUint32(byteOffset, value, true);
    var callRuntimeCallbacks = (callbacks) => {
      while (callbacks.length > 0) {
        callbacks.shift()(Module);
      }
    };
    var ptrToString = (ptr) => {
      assert(typeof ptr === "number");
      ptr >>>= 0;
      return "0x" + ptr.toString(16).padStart(8, "0");
    };
    var isInternalSym = (symName) => [
      "__cpp_exception",
      "__c_longjmp",
      "__wasm_apply_data_relocs",
      "__dso_handle",
      "__tls_size",
      "__tls_align",
      "__set_stack_limits",
      "_emscripten_tls_init",
      "__wasm_init_tls",
      "__wasm_call_ctors",
      "__start_em_asm",
      "__stop_em_asm",
      "__start_em_js",
      "__stop_em_js"
    ].includes(symName) || symName.startsWith("__em_js__");
    var uleb128Encode = (n, target) => {
      assert(n < 16384);
      if (n < 128) {
        target.push(n);
      } else {
        target.push(n % 128 | 128, n >> 7);
      }
    };
    var sigToWasmTypes = (sig) => {
      var typeNames = {
        i: "i32",
        j: "i64",
        f: "f32",
        d: "f64",
        e: "externref",
        p: "i32"
      };
      var type = {
        parameters: [],
        results: sig[0] == "v" ? [] : [typeNames[sig[0]]]
      };
      for (var i = 1; i < sig.length; ++i) {
        assert(sig[i] in typeNames, "invalid signature char: " + sig[i]);
        type.parameters.push(typeNames[sig[i]]);
      }
      return type;
    };
    var generateFuncType = (sig, target) => {
      var sigRet = sig.slice(0, 1);
      var sigParam = sig.slice(1);
      var typeCodes = {
        i: 127,
        // i32
        p: 127,
        // i32
        j: 126,
        // i64
        f: 125,
        // f32
        d: 124,
        // f64
        e: 111
      };
      target.push(96);
      uleb128Encode(sigParam.length, target);
      for (var paramType of sigParam) {
        assert(paramType in typeCodes, `invalid signature char: ${paramType}`);
        target.push(typeCodes[paramType]);
      }
      if (sigRet == "v") {
        target.push(0);
      } else {
        target.push(1, typeCodes[sigRet]);
      }
    };
    var convertJsFunctionToWasm = (func, sig) => {
      if (typeof WebAssembly.Function == "function") {
        return new WebAssembly.Function(sigToWasmTypes(sig), func);
      }
      var typeSectionBody = [1];
      generateFuncType(sig, typeSectionBody);
      var bytes = [
        0,
        97,
        115,
        109,
        // magic ("\0asm")
        1,
        0,
        0,
        0,
        // version: 1
        1
      ];
      uleb128Encode(typeSectionBody.length, bytes);
      bytes.push(...typeSectionBody);
      bytes.push(
        2,
        7,
        // import section
        // (import "e" "f" (func 0 (type 0)))
        1,
        1,
        101,
        1,
        102,
        0,
        0,
        7,
        5,
        // export section
        // (export "f" (func 0 (type 0)))
        1,
        1,
        102,
        0,
        0
      );
      var module = new WebAssembly.Module(new Uint8Array(bytes));
      var instance = new WebAssembly.Instance(module, {
        e: {
          f: func
        }
      });
      var wrappedFunc = instance.exports["f"];
      return wrappedFunc;
    };
    var wasmTable = new WebAssembly.Table({
      initial: 263,
      element: "anyfunc"
    });
    var getWasmTableEntry = (funcPtr) => wasmTable.get(funcPtr);
    var updateTableMap = (offset, count) => {
      if (functionsInTableMap) {
        for (var i = offset; i < offset + count; i++) {
          var item = getWasmTableEntry(i);
          if (item) {
            functionsInTableMap.set(item, i);
          }
        }
      }
    };
    var functionsInTableMap;
    var getFunctionAddress = (func) => {
      if (!functionsInTableMap) {
        functionsInTableMap = /* @__PURE__ */ new WeakMap();
        updateTableMap(0, wasmTable.length);
      }
      return functionsInTableMap.get(func) || 0;
    };
    var freeTableIndexes = [];
    var getEmptyTableSlot = () => {
      if (freeTableIndexes.length) {
        return freeTableIndexes.pop();
      }
      try {
        wasmTable.grow(1);
      } catch (err2) {
        if (!(err2 instanceof RangeError)) {
          throw err2;
        }
        throw "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.";
      }
      return wasmTable.length - 1;
    };
    var setWasmTableEntry = (idx, func) => wasmTable.set(idx, func);
    var addFunction = (func, sig) => {
      assert(typeof func != "undefined");
      var rtn = getFunctionAddress(func);
      if (rtn) {
        return rtn;
      }
      var ret = getEmptyTableSlot();
      try {
        setWasmTableEntry(ret, func);
      } catch (err2) {
        if (!(err2 instanceof TypeError)) {
          throw err2;
        }
        assert(typeof sig != "undefined", "Missing signature argument to addFunction: " + func);
        var wrapped = convertJsFunctionToWasm(func, sig);
        setWasmTableEntry(ret, wrapped);
      }
      functionsInTableMap.set(func, ret);
      return ret;
    };
    var updateGOT = (exports, replace) => {
      for (var symName in exports) {
        if (isInternalSym(symName)) {
          continue;
        }
        var value = exports[symName];
        GOT[symName] ||= new WebAssembly.Global({
          value: "i32",
          mutable: true
        });
        if (replace || GOT[symName].value == 0) {
          if (typeof value == "function") {
            GOT[symName].value = addFunction(value);
          } else if (typeof value == "number") {
            GOT[symName].value = value;
          } else {
            err(`unhandled export type for '${symName}': ${typeof value}`);
          }
        }
      }
    };
    var relocateExports = (exports, memoryBase, replace) => {
      var relocated = {};
      for (var e in exports) {
        var value = exports[e];
        if (typeof value == "object") {
          value = value.value;
        }
        if (typeof value == "number") {
          value += memoryBase;
        }
        relocated[e] = value;
      }
      updateGOT(relocated, replace);
      return relocated;
    };
    var isSymbolDefined = (symName) => {
      var existing = wasmImports[symName];
      if (!existing || existing.stub) {
        return false;
      }
      return true;
    };
    var resolveGlobalSymbol = (symName, direct = false) => {
      var sym;
      if (isSymbolDefined(symName)) {
        sym = wasmImports[symName];
      }
      return {
        sym,
        name: symName
      };
    };
    var reportUndefinedSymbols = () => {
      for (var [symName, entry] of Object.entries(GOT)) {
        if (entry.value == 0) {
          var value = resolveGlobalSymbol(symName, true).sym;
          if (!value && !entry.required) {
            continue;
          }
          assert(
            value,
            `undefined symbol '${symName}'. perhaps a side module was not linked in? if this global was expected to arrive from a system library, try to build the MAIN_MODULE with EMCC_FORCE_STDLIBS=1 in the environment`
          );
          if (typeof value == "function") {
            entry.value = addFunction(value, value.sig);
          } else if (typeof value == "number") {
            entry.value = value;
          } else {
            throw new Error(`bad export type for '${symName}': ${typeof value}`);
          }
        }
      }
    };
    var setStackLimits = () => {
      var stackLow = _emscripten_stack_get_base();
      var stackHigh = _emscripten_stack_get_end();
      ___set_stack_limits(stackLow, stackHigh);
    };
    var warnOnce = (text) => {
      warnOnce.shown ||= {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        if (ENVIRONMENT_IS_NODE) text = "warning: " + text;
        err(text);
      }
    };
    var ___heap_base = 152880;
    var ___memory_base = new WebAssembly.Global(
      {
        value: "i32",
        mutable: false
      },
      1024
    );
    var ___stack_high = 152880;
    var ___stack_low = 87344;
    var ___stack_pointer = new WebAssembly.Global(
      {
        value: "i32",
        mutable: true
      },
      152880
    );
    var ___table_base = new WebAssembly.Global(
      {
        value: "i32",
        mutable: false
      },
      1
    );
    var _emscripten_notify_memory_growth = (memoryIndex) => {
      assert(memoryIndex == 0);
      updateMemoryViews();
    };
    _emscripten_notify_memory_growth.sig = "vp";
    var ENV = {};
    var getExecutableName = () => thisProgram || "./this.program";
    var getEnvStrings = () => {
      if (!getEnvStrings.strings) {
        var lang = (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8";
        var env = {
          USER: "web_user",
          LOGNAME: "web_user",
          PATH: "/",
          PWD: "/",
          HOME: "/home/web_user",
          LANG: lang,
          _: getExecutableName()
        };
        for (var x in ENV) {
          if (ENV[x] === void 0) delete env[x];
          else env[x] = ENV[x];
        }
        var strings = [];
        for (var x in env) {
          strings.push(`${x}=${env[x]}`);
        }
        getEnvStrings.strings = strings;
      }
      return getEnvStrings.strings;
    };
    var stringToAscii = (str, buffer) => {
      for (var i = 0; i < str.length; ++i) {
        assert(str.charCodeAt(i) === (str.charCodeAt(i) & 255));
        HEAP8[buffer++] = str.charCodeAt(i);
      }
      HEAP8[buffer] = 0;
    };
    var _environ_get = (__environ, environ_buf) => {
      var bufSize = 0;
      getEnvStrings().forEach((string, i) => {
        var ptr = environ_buf + bufSize;
        LE_HEAP_STORE_U32((__environ + i * 4 >> 2) * 4, ptr);
        stringToAscii(string, ptr);
        bufSize += string.length + 1;
      });
      return 0;
    };
    _environ_get.sig = "ipp";
    var _environ_sizes_get = (penviron_count, penviron_buf_size) => {
      var strings = getEnvStrings();
      LE_HEAP_STORE_U32((penviron_count >> 2) * 4, strings.length);
      var bufSize = 0;
      strings.forEach((string) => bufSize += string.length + 1);
      LE_HEAP_STORE_U32((penviron_buf_size >> 2) * 4, bufSize);
      return 0;
    };
    _environ_sizes_get.sig = "ipp";
    var UTF8Decoder = new TextDecoder();
    var UTF8ToString = (ptr, maxBytesToRead) => {
      assert(typeof ptr == "number", `UTF8ToString expects a number (got ${typeof ptr})`);
      if (!ptr) return "";
      var maxPtr = ptr + maxBytesToRead;
      for (var end = ptr; !(end >= maxPtr) && HEAPU8[end]; ) ++end;
      return UTF8Decoder.decode(HEAPU8.subarray(ptr, end));
    };
    var _fd_close = (fd) => {
      abort("fd_close called without SYSCALLS_REQUIRE_FILESYSTEM");
    };
    _fd_close.sig = "ii";
    var _fd_read = (fd, iov, iovcnt, pnum) => {
      abort("fd_read called without SYSCALLS_REQUIRE_FILESYSTEM");
    };
    _fd_read.sig = "iippp";
    var INT53_MAX = 9007199254740992;
    var INT53_MIN = -9007199254740992;
    var bigintToI53Checked = (num) => num < INT53_MIN || num > INT53_MAX ? NaN : Number(num);
    function _fd_seek(fd, offset, whence, newOffset) {
      offset = bigintToI53Checked(offset);
      return 70;
    }
    _fd_seek.sig = "iijip";
    var printCharBuffers = [null, [], []];
    var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead = NaN) => {
      var endIdx = idx + maxBytesToRead;
      var endPtr = idx;
      while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
      return UTF8Decoder.decode(
        heapOrArray.buffer ? heapOrArray.subarray(idx, endPtr) : new Uint8Array(heapOrArray.slice(idx, endPtr))
      );
    };
    var printChar = (stream, curr) => {
      var buffer = printCharBuffers[stream];
      assert(buffer);
      if (curr === 0 || curr === 10) {
        ;
        (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
        buffer.length = 0;
      } else {
        buffer.push(curr);
      }
    };
    var flush_NO_FILESYSTEM = () => {
      if (printCharBuffers[1].length) printChar(1, 10);
      if (printCharBuffers[2].length) printChar(2, 10);
    };
    var _fd_write = (fd, iov, iovcnt, pnum) => {
      var num = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = LE_HEAP_LOAD_U32((iov >> 2) * 4);
        var len = LE_HEAP_LOAD_U32((iov + 4 >> 2) * 4);
        iov += 8;
        for (var j = 0; j < len; j++) {
          printChar(fd, HEAPU8[ptr + j]);
        }
        num += len;
      }
      LE_HEAP_STORE_U32((pnum >> 2) * 4, num);
      return 0;
    };
    _fd_write.sig = "iippp";
    var keepRuntimeAlive = () => true;
    var _proc_exit = (code) => {
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    };
    _proc_exit.sig = "vi";
    var runtimeKeepaliveCounter = 0;
    var exitJS = (status, implicit) => {
      EXITSTATUS = status;
      checkUnflushedContent();
      if (keepRuntimeAlive() && !implicit) {
        var msg = `program exited (with status: ${status}), but keepRuntimeAlive() is set (counter=${runtimeKeepaliveCounter}) due to an async operation, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)`;
        readyPromiseReject(msg);
        err(msg);
      }
      _proc_exit(status);
    };
    var handleException = (e) => {
      if (e instanceof ExitStatus || e == "unwind") {
        return EXITSTATUS;
      }
      checkStackCookie();
      if (e instanceof WebAssembly.RuntimeError) {
        if (_emscripten_stack_get_current() <= 0) {
          err(
            "Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 65536)"
          );
        }
      }
      quit_(1, e);
    };
    var getCFunc = (ident) => {
      var func = Module["_" + ident];
      assert(func, "Cannot call unknown function " + ident + ", make sure it is exported");
      return func;
    };
    var writeArrayToMemory = (array, buffer) => {
      assert(
        array.length >= 0,
        "writeArrayToMemory array must have a length (should be an array or typed array)"
      );
      HEAP8.set(array, buffer);
    };
    var lengthBytesUTF8 = (str) => {
      var len = 0;
      for (var i = 0; i < str.length; ++i) {
        var c = str.charCodeAt(i);
        if (c <= 127) {
          len++;
        } else if (c <= 2047) {
          len += 2;
        } else if (c >= 55296 && c <= 57343) {
          len += 4;
          ++i;
        } else {
          len += 3;
        }
      }
      return len;
    };
    var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
      assert(typeof str === "string", `stringToUTF8Array expects a string (got ${typeof str})`);
      if (!(maxBytesToWrite > 0)) return 0;
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1;
      for (var i = 0; i < str.length; ++i) {
        var u = str.charCodeAt(i);
        if (u >= 55296 && u <= 57343) {
          var u1 = str.charCodeAt(++i);
          u = 65536 + ((u & 1023) << 10) | u1 & 1023;
        }
        if (u <= 127) {
          if (outIdx >= endIdx) break;
          heap[outIdx++] = u;
        } else if (u <= 2047) {
          if (outIdx + 1 >= endIdx) break;
          heap[outIdx++] = 192 | u >> 6;
          heap[outIdx++] = 128 | u & 63;
        } else if (u <= 65535) {
          if (outIdx + 2 >= endIdx) break;
          heap[outIdx++] = 224 | u >> 12;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        } else {
          if (outIdx + 3 >= endIdx) break;
          if (u > 1114111)
            warnOnce(
              "Invalid Unicode code point " + ptrToString(u) + " encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF)."
            );
          heap[outIdx++] = 240 | u >> 18;
          heap[outIdx++] = 128 | u >> 12 & 63;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        }
      }
      heap[outIdx] = 0;
      return outIdx - startIdx;
    };
    var stringToUTF8 = (str, outPtr, maxBytesToWrite) => {
      assert(
        typeof maxBytesToWrite == "number",
        "stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!"
      );
      return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
    };
    var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
    var stringToUTF8OnStack = (str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    };
    var stackSave = () => _emscripten_stack_get_current();
    var stackRestore = (val) => __emscripten_stack_restore(val);
    var ccall = (ident, returnType, argTypes, args, opts) => {
      var toC = {
        string: (str) => {
          var ret2 = 0;
          if (str !== null && str !== void 0 && str !== 0) {
            ret2 = stringToUTF8OnStack(str);
          }
          return ret2;
        },
        array: (arr) => {
          var ret2 = stackAlloc(arr.length);
          writeArrayToMemory(arr, ret2);
          return ret2;
        }
      };
      function convertReturnValue(ret2) {
        if (returnType === "string") {
          return UTF8ToString(ret2);
        }
        if (returnType === "boolean") return Boolean(ret2);
        return ret2;
      }
      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      assert(returnType !== "array", 'Return type should not be "array".');
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (stack === 0) stack = stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }
      var ret = func(...cArgs);
      function onDone(ret2) {
        if (stack !== 0) stackRestore(stack);
        return convertReturnValue(ret2);
      }
      ret = onDone(ret);
      return ret;
    };
    var cwrap = (ident, returnType, argTypes, opts) => (...args) => ccall(ident, returnType, argTypes, args, opts);
    LE_ATOMICS_NATIVE_BYTE_ORDER = new Int8Array(new Int16Array([1]).buffer)[0] === 1 ? [
      /* little endian */
      (x) => x,
      (x) => x,
      void 0,
      (x) => x
    ] : [
      /* big endian */
      (x) => x,
      (x) => ((x & 65280) << 8 | (x & 255) << 24) >> 16,
      void 0,
      (x) => x >> 24 & 255 | x >> 8 & 65280 | (x & 65280) << 8 | (x & 255) << 24
    ];
    function LE_HEAP_UPDATE() {
      HEAPU16.unsigned = (x) => x & 65535;
      HEAPU32.unsigned = (x) => x >>> 0;
    }
    function checkIncomingModuleAPI() {
      ignoredModuleProp("ENVIRONMENT");
      ignoredModuleProp("GL_MAX_TEXTURE_IMAGE_UNITS");
      ignoredModuleProp("SDL_canPlayWithWebAudio");
      ignoredModuleProp("SDL_numSimultaneouslyQueuedBuffers");
      ignoredModuleProp("INITIAL_MEMORY");
      ignoredModuleProp("wasmMemory");
      ignoredModuleProp("arguments");
      ignoredModuleProp("buffer");
      ignoredModuleProp("canvas");
      ignoredModuleProp("doNotCaptureKeyboard");
      ignoredModuleProp("dynamicLibraries");
      ignoredModuleProp("elementPointerLock");
      ignoredModuleProp("extraStackTrace");
      ignoredModuleProp("forcedAspectRatio");
      ignoredModuleProp("instantiateWasm");
      ignoredModuleProp("keyboardListeningElement");
      ignoredModuleProp("freePreloadedMediaOnUse");
      ignoredModuleProp("loadSplitModule");
      ignoredModuleProp("locateFile");
      ignoredModuleProp("logReadFiles");
      ignoredModuleProp("mainScriptUrlOrBlob");
      ignoredModuleProp("mem");
      ignoredModuleProp("monitorRunDependencies");
      ignoredModuleProp("noExitRuntime");
      ignoredModuleProp("noInitialRun");
      ignoredModuleProp("onAbort");
      ignoredModuleProp("onCustomMessage");
      ignoredModuleProp("onExit");
      ignoredModuleProp("onFree");
      ignoredModuleProp("onFullScreen");
      ignoredModuleProp("onMalloc");
      ignoredModuleProp("onRealloc");
      ignoredModuleProp("onRuntimeInitialized");
      ignoredModuleProp("postMainLoop");
      ignoredModuleProp("postRun");
      ignoredModuleProp("preInit");
      ignoredModuleProp("preMainLoop");
      ignoredModuleProp("preRun");
      ignoredModuleProp("preinitializedWebGLContext");
      ignoredModuleProp("preloadPlugins");
      ignoredModuleProp("print");
      ignoredModuleProp("printErr");
      ignoredModuleProp("setStatus");
      ignoredModuleProp("statusMessage");
      ignoredModuleProp("stderr");
      ignoredModuleProp("stdin");
      ignoredModuleProp("stdout");
      ignoredModuleProp("thisProgram");
      ignoredModuleProp("wasm");
      ignoredModuleProp("wasmBinary");
      ignoredModuleProp("websocket");
      ignoredModuleProp("fetchSettings");
    }
    var wasmImports = {
      /** @export */
      __heap_base: ___heap_base,
      /** @export */
      __indirect_function_table: wasmTable,
      /** @export */
      __memory_base: ___memory_base,
      /** @export */
      __stack_high: ___stack_high,
      /** @export */
      __stack_low: ___stack_low,
      /** @export */
      __stack_pointer: ___stack_pointer,
      /** @export */
      __table_base: ___table_base,
      /** @export */
      emscripten_notify_memory_growth: _emscripten_notify_memory_growth,
      /** @export */
      environ_get: _environ_get,
      /** @export */
      environ_sizes_get: _environ_sizes_get,
      /** @export */
      fd_close: _fd_close,
      /** @export */
      fd_read: _fd_read,
      /** @export */
      fd_seek: _fd_seek,
      /** @export */
      fd_write: _fd_write,
      /** @export */
      memory: wasmMemory,
      /** @export */
      proc_exit: _proc_exit
    };
    var wasmExports = await createWasm();
    var _archive_clear_error = Module["_archive_clear_error"] = createExportWrapper(
      "archive_clear_error",
      1
    );
    var _open_archive = Module["_open_archive"] = createExportWrapper("open_archive", 4);
    var _archive_error_string = Module["_archive_error_string"] = createExportWrapper(
      "archive_error_string",
      1
    );
    var _get_next_entry = Module["_get_next_entry"] = createExportWrapper("get_next_entry", 1);
    var _get_filedata = Module["_get_filedata"] = createExportWrapper("get_filedata", 2);
    var _malloc = Module["_malloc"] = createExportWrapper("malloc", 1);
    var _free = Module["_free"] = createExportWrapper("free", 1);
    var _archive_entry_atime = Module["_archive_entry_atime"] = createExportWrapper(
      "archive_entry_atime",
      1
    );
    var _archive_entry_birthtime = Module["_archive_entry_birthtime"] = createExportWrapper(
      "archive_entry_birthtime",
      1
    );
    var _archive_entry_ctime = Module["_archive_entry_ctime"] = createExportWrapper(
      "archive_entry_ctime",
      1
    );
    var _archive_entry_hardlink = Module["_archive_entry_hardlink"] = createExportWrapper(
      "archive_entry_hardlink",
      1
    );
    var _archive_entry_hardlink_utf8 = Module["_archive_entry_hardlink_utf8"] = createExportWrapper("archive_entry_hardlink_utf8", 1);
    var _archive_entry_mode = Module["_archive_entry_mode"] = createExportWrapper(
      "archive_entry_mode",
      1
    );
    var _archive_entry_mtime = Module["_archive_entry_mtime"] = createExportWrapper(
      "archive_entry_mtime",
      1
    );
    var _archive_entry_pathname = Module["_archive_entry_pathname"] = createExportWrapper(
      "archive_entry_pathname",
      1
    );
    var _archive_entry_pathname_utf8 = Module["_archive_entry_pathname_utf8"] = createExportWrapper("archive_entry_pathname_utf8", 1);
    var _archive_entry_size = Module["_archive_entry_size"] = createExportWrapper(
      "archive_entry_size",
      1
    );
    var _archive_entry_symlink = Module["_archive_entry_symlink"] = createExportWrapper(
      "archive_entry_symlink",
      1
    );
    var _archive_entry_symlink_utf8 = Module["_archive_entry_symlink_utf8"] = createExportWrapper(
      "archive_entry_symlink_utf8",
      1
    );
    var _archive_errno = Module["_archive_errno"] = createExportWrapper("archive_errno", 1);
    var _archive_read_free = Module["_archive_read_free"] = createExportWrapper(
      "archive_read_free",
      1
    );
    var __initialize = Module["__initialize"] = createExportWrapper("_initialize", 0);
    var ___trap = wasmExports["__trap"];
    var _emscripten_stack_set_limits = wasmExports["emscripten_stack_set_limits"];
    var _emscripten_stack_get_free = wasmExports["emscripten_stack_get_free"];
    var _emscripten_stack_get_base = wasmExports["emscripten_stack_get_base"];
    var _emscripten_stack_get_end = wasmExports["emscripten_stack_get_end"];
    var __emscripten_stack_restore = wasmExports["_emscripten_stack_restore"];
    var __emscripten_stack_alloc = wasmExports["_emscripten_stack_alloc"];
    var _emscripten_stack_get_current = wasmExports["emscripten_stack_get_current"];
    var ___wasm_apply_data_relocs = createExportWrapper("__wasm_apply_data_relocs", 0);
    var ___set_stack_limits = Module["___set_stack_limits"] = createExportWrapper(
      "__set_stack_limits",
      2
    );
    Module["ccall"] = ccall;
    Module["cwrap"] = cwrap;
    var missingLibrarySymbols = [
      "writeI53ToI64",
      "writeI53ToI64Clamped",
      "writeI53ToI64Signaling",
      "writeI53ToU64Clamped",
      "writeI53ToU64Signaling",
      "readI53FromI64",
      "readI53FromU64",
      "convertI32PairToI53",
      "convertI32PairToI53Checked",
      "convertU32PairToI53",
      "getTempRet0",
      "setTempRet0",
      "zeroMemory",
      "getHeapMax",
      "growMemory",
      "strError",
      "inetPton4",
      "inetNtop4",
      "inetPton6",
      "inetNtop6",
      "readSockaddr",
      "writeSockaddr",
      "emscriptenLog",
      "readEmAsmArgs",
      "jstoi_q",
      "listenOnce",
      "autoResumeAudioContext",
      "getDynCaller",
      "dynCall",
      "runtimeKeepalivePush",
      "runtimeKeepalivePop",
      "callUserCallback",
      "maybeExit",
      "asmjsMangle",
      "asyncLoad",
      "alignMemory",
      "mmapAlloc",
      "HandleAllocator",
      "getNativeTypeSize",
      "addOnPreRun",
      "addOnInit",
      "addOnPostCtor",
      "addOnPreMain",
      "addOnExit",
      "addOnPostRun",
      "STACK_SIZE",
      "STACK_ALIGN",
      "POINTER_SIZE",
      "ASSERTIONS",
      "removeFunction",
      "reallyNegative",
      "unSign",
      "strLen",
      "reSign",
      "formatString",
      "intArrayFromString",
      "intArrayToString",
      "AsciiToString",
      "UTF16ToString",
      "stringToUTF16",
      "lengthBytesUTF16",
      "UTF32ToString",
      "stringToUTF32",
      "lengthBytesUTF32",
      "stringToNewUTF8",
      "registerKeyEventCallback",
      "maybeCStringToJsString",
      "findEventTarget",
      "getBoundingClientRect",
      "fillMouseEventData",
      "registerMouseEventCallback",
      "registerWheelEventCallback",
      "registerUiEventCallback",
      "registerFocusEventCallback",
      "fillDeviceOrientationEventData",
      "registerDeviceOrientationEventCallback",
      "fillDeviceMotionEventData",
      "registerDeviceMotionEventCallback",
      "screenOrientation",
      "fillOrientationChangeEventData",
      "registerOrientationChangeEventCallback",
      "fillFullscreenChangeEventData",
      "registerFullscreenChangeEventCallback",
      "JSEvents_requestFullscreen",
      "JSEvents_resizeCanvasForFullscreen",
      "registerRestoreOldStyle",
      "hideEverythingExceptGivenElement",
      "restoreHiddenElements",
      "setLetterbox",
      "softFullscreenResizeWebGLRenderTarget",
      "doRequestFullscreen",
      "fillPointerlockChangeEventData",
      "registerPointerlockChangeEventCallback",
      "registerPointerlockErrorEventCallback",
      "requestPointerLock",
      "fillVisibilityChangeEventData",
      "registerVisibilityChangeEventCallback",
      "registerTouchEventCallback",
      "fillGamepadEventData",
      "registerGamepadEventCallback",
      "registerBeforeUnloadEventCallback",
      "fillBatteryEventData",
      "battery",
      "registerBatteryEventCallback",
      "setCanvasElementSize",
      "getCanvasElementSize",
      "jsStackTrace",
      "getCallstack",
      "convertPCtoSourceLocation",
      "checkWasiClock",
      "wasiRightsToMuslOFlags",
      "wasiOFlagsToMuslOFlags",
      "initRandomFill",
      "randomFill",
      "safeSetTimeout",
      "setImmediateWrapped",
      "safeRequestAnimationFrame",
      "clearImmediateWrapped",
      "registerPostMainLoop",
      "registerPreMainLoop",
      "getPromise",
      "makePromise",
      "idsToPromises",
      "makePromiseCallback",
      "Browser_asyncPrepareDataCounter",
      "getSocketFromFD",
      "getSocketAddress",
      "getMemory",
      "mergeLibSymbols",
      "loadWebAssemblyModule",
      "setDylinkStackLimits",
      "newDSO",
      "loadDynamicLibrary",
      "dlopenInternal"
    ];
    missingLibrarySymbols.forEach(missingLibrarySymbol);
    var unexportedSymbols = [
      "run",
      "addRunDependency",
      "removeRunDependency",
      "out",
      "err",
      "callMain",
      "abort",
      "wasmMemory",
      "wasmExports",
      "HEAPF32",
      "HEAPF64",
      "HEAPU8",
      "HEAP16",
      "HEAPU16",
      "HEAP32",
      "HEAPU32",
      "HEAP64",
      "HEAPU64",
      "writeStackCookie",
      "checkStackCookie",
      "INT53_MAX",
      "INT53_MIN",
      "bigintToI53Checked",
      "stackSave",
      "stackRestore",
      "stackAlloc",
      "ptrToString",
      "exitJS",
      "ENV",
      "setStackLimits",
      "ERRNO_CODES",
      "DNS",
      "Protocols",
      "Sockets",
      "timers",
      "warnOnce",
      "readEmAsmArgsArray",
      "jstoi_s",
      "getExecutableName",
      "setWasmTableEntry",
      "getWasmTableEntry",
      "handleException",
      "keepRuntimeAlive",
      "wasmTable",
      "noExitRuntime",
      "getCFunc",
      "uleb128Encode",
      "sigToWasmTypes",
      "generateFuncType",
      "convertJsFunctionToWasm",
      "freeTableIndexes",
      "functionsInTableMap",
      "getEmptyTableSlot",
      "updateTableMap",
      "getFunctionAddress",
      "addFunction",
      "setValue",
      "getValue",
      "PATH",
      "PATH_FS",
      "UTF8Decoder",
      "UTF8ArrayToString",
      "UTF8ToString",
      "stringToUTF8Array",
      "stringToUTF8",
      "lengthBytesUTF8",
      "stringToAscii",
      "UTF16Decoder",
      "stringToUTF8OnStack",
      "writeArrayToMemory",
      "JSEvents",
      "specialHTMLTargets",
      "findCanvasEventTarget",
      "currentFullscreenStrategy",
      "restoreOldWindowedStyle",
      "UNWIND_CACHE",
      "ExitStatus",
      "getEnvStrings",
      "flush_NO_FILESYSTEM",
      "emSetImmediate",
      "emClearImmediate_deps",
      "emClearImmediate",
      "promiseMap",
      "Browser",
      "getPreloadedImageData__data",
      "wget",
      "SYSCALLS",
      "isSymbolDefined",
      "GOT",
      "currentModuleWeakSymbols",
      "LDSO",
      "LE_HEAP_STORE_U16",
      "LE_HEAP_STORE_I16",
      "LE_HEAP_STORE_U32",
      "LE_HEAP_STORE_I32",
      "LE_HEAP_STORE_F32",
      "LE_HEAP_STORE_F64",
      "LE_HEAP_LOAD_U16",
      "LE_HEAP_LOAD_I16",
      "LE_HEAP_LOAD_U32",
      "LE_HEAP_LOAD_I32",
      "LE_HEAP_LOAD_F32",
      "LE_HEAP_LOAD_F64",
      "LE_ATOMICS_NATIVE_BYTE_ORDER",
      "LE_ATOMICS_ADD",
      "LE_ATOMICS_AND",
      "LE_ATOMICS_COMPAREEXCHANGE",
      "LE_ATOMICS_EXCHANGE",
      "LE_ATOMICS_ISLOCKFREE",
      "LE_ATOMICS_LOAD",
      "LE_ATOMICS_NOTIFY",
      "LE_ATOMICS_OR",
      "LE_ATOMICS_STORE",
      "LE_ATOMICS_SUB",
      "LE_ATOMICS_WAIT",
      "LE_ATOMICS_WAITASYNC",
      "LE_ATOMICS_XOR"
    ];
    unexportedSymbols.forEach(unexportedRuntimeSymbol);
    var calledRun;
    var mainArgs = void 0;
    function callMain(args = []) {
      assert(
        runDependencies == 0,
        'cannot call main when async dependencies remain! (listen on Module["onRuntimeInitialized"])'
      );
      assert(
        typeof onPreRuns === "undefined" || onPreRuns.length == 0,
        "cannot call main when preRun functions remain to be called"
      );
      var entryFunction = __initialize;
      mainArgs = [thisProgram].concat(args);
      try {
        entryFunction();
        var ret = 0;
        exitJS(
          ret,
          /* implicit = */
          true
        );
        return ret;
      } catch (e) {
        return handleException(e);
      }
    }
    function stackCheckInit() {
      _emscripten_stack_set_limits(152880, 87344);
      writeStackCookie();
    }
    function run(args = arguments_) {
      if (runDependencies > 0) {
        dependenciesFulfilled = run;
        return;
      }
      stackCheckInit();
      preRun();
      if (runDependencies > 0) {
        dependenciesFulfilled = run;
        return;
      }
      function doRun() {
        assert(!calledRun);
        calledRun = true;
        Module["calledRun"] = true;
        if (ABORT) return;
        initRuntime();
        preMain();
        readyPromiseResolve(Module);
        var noInitialRun = true;
        legacyModuleProp("noInitialRun", "noInitialRun");
        if (!noInitialRun) callMain(args);
        postRun();
      }
      {
        doRun();
      }
      checkStackCookie();
    }
    function checkUnflushedContent() {
      var oldOut = out;
      var oldErr = err;
      var has = false;
      out = err = (x) => {
        has = true;
      };
      try {
        flush_NO_FILESYSTEM();
      } catch (e) {
      }
      out = oldOut;
      err = oldErr;
      if (has) {
        warnOnce(
          "stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc."
        );
        warnOnce(
          "(this may also be due to not including full filesystem support - try building with -sFORCE_FILESYSTEM)"
        );
      }
    }
    run();
    moduleRtn = readyPromise;
    for (const prop of Object.keys(Module)) {
      if (!(prop in moduleArg)) {
        Object.defineProperty(moduleArg, prop, {
          configurable: true,
          get() {
            abort(
              `Access to module property ('${prop}') is no longer possible via the module constructor argument; Instead, use the result of the module constructor.`
            );
          }
        });
      }
    }
    return moduleRtn;
  };
})();
(() => {
  var real_wasmFactory = wasmFactory;
  wasmFactory = function(arg) {
    if (new.target) throw new Error("wasmFactory() should not be called with `new wasmFactory()`");
    return real_wasmFactory(arg);
  };
})();
var wasm = await wasmFactory();

// package/src/wasm/pointer.mjs
var fallbackEncodings = Object.entries({
  cp1251: ["ru", "uk", "be", "bg", "sr", "bs", "mk"],
  gb18030: ["zh"],
  cseuckr: ["ko"],
  csshiftjis: ["ja"]
}).reduce(
  (mapping, [encoding, languages]) => {
    for (const language of languages) mapping[language] = encoding;
    return mapping;
  },
  /** @type {Record.<string, string>} */
  {}
);
var malloc = (
  /** @type {MallocCB} */
  wasm.cwrap("malloc", "number", ["number"])
);
var free = (
  /** @type {FreeCB} */
  wasm.cwrap("free", null, ["number"])
);
var MemoryRegistry = new FinalizationRegistry((pointer) => {
  free(pointer);
});
var Pointer = class _Pointer {
  static NIL = new _Pointer(0);
  static NULL = 0;
  /**
   * Free raw pointer
   * @param {number} pointer Raw C pointer
   */
  static free(pointer) {
    if (pointer === _Pointer.NULL) return;
    free(pointer);
  }
  /** @type {number} */
  #size;
  /** @type {number} */
  #pointer;
  /**
   * High level representation of a WASM memory pointer
   * @param {number} [size] Pointer size, 0 means that pointer is managed
   * @param {number} [pointer] Raw C pointer
   */
  constructor(size, pointer) {
    if (typeof size === "number" && size < 0) throw new Error("Size must be >= 0");
    this.#size = size ?? 0;
    if (pointer == null && this.#size > 0) {
      this.#pointer = malloc(this.#size);
      if (this.isNull()) throw new NullError("Failed to allocate memory");
    } else {
      this.#pointer = pointer ?? _Pointer.NULL;
    }
    if (!(this.isNull() || this.isManaged())) MemoryRegistry.register(this, this.#pointer, this);
  }
  /**
   * Get underlining raw pointer
   * @returns {number} Raw C pointer
   */
  get raw() {
    return this.#pointer;
  }
  /**
   * Get possible allocated size for pointer
   *
   * > This can be null if pointer is externally managed
   *
   * > This will be zero when pointer is NULL
   * @returns {number?} Allocated pointer size
   */
  get size() {
    return this.isManaged() ? null : this.#size;
  }
  /**
   * Fill memory with data
   *
   * > When grow is false, this method throws when trying to fill a Pointer.NULL pointer,
   *   otherwise it will realloc the Pointer so it can fit the given data
   * @param {bigint | number | string | ArrayLike.<number> | ArrayBufferView | ArrayBufferLike} data to copy to memory
   * @param {boolean} [grow] Wheter to alloc more data to make sure data fits inside {@link Pointer}
   * @returns {Pointer} This pointer
   */
  fill(data, grow = false) {
    if (this.isManaged()) throw new Error("Can't modify managed Pointer");
    let array;
    switch (typeof data) {
      case "string":
        array = new TextEncoder().encode(data);
        break;
      case "number":
        array = new Uint8Array([data]);
        break;
      case "bigint":
        array = Uint8Array.from(new BigInt64Array([data]));
        break;
      default:
        if (data instanceof ArrayBuffer) {
          array = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
          array = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof SharedArrayBuffer) {
          array = new Uint8Array(data);
        } else if (!(data instanceof Uint8Array)) {
          array = new Uint8Array(data);
        } else {
          array = data;
        }
    }
    if (grow) {
      this.realloc(array.byteLength, true);
    } else if (array.byteLength > this.#size) {
      array = array.subarray(0, this.#size);
    }
    if (this.isNull()) throw new NullError("Failed to fill due to Pointer.NULL");
    wasm.HEAP8.set(array, this.#pointer);
    return this;
  }
  /**
   * Copy data from WASM memory and return it
   * @param {number} [size] How much to read from memory
   * @returns {ArrayBuffer} Memory view
   */
  read(size) {
    if (size == null) {
      size = this.#size;
    } else if (size > this.#size) {
      throw new Error("Attempting to read past the pointer allocated memory");
    } else if (size < 0) {
      throw new Error("Size must be a positive number");
    }
    if (this.isNull()) {
      throw new NullError("failed to read due to Pointer.NULL");
    } else if (this.isManaged()) {
      throw new Error("Reading managed pointer");
    }
    return wasm.HEAP_DATA_VIEW.buffer.slice(this.#pointer, this.#pointer + size);
  }
  /**
   * Copy data from WASM memory and decode it as a string
   * @param {string} [encoding] Decoder label
   * @returns {string} String representation
   */
  readString(encoding) {
    if (this.isNull()) return "";
    let dataView = new Uint8Array(
      wasm.HEAP_DATA_VIEW.buffer,
      this.#pointer,
      this.#size === 0 ? void 0 : this.#size
    );
    let endPointer = -1;
    while ((dataView[++endPointer] ?? 0) !== 0) ;
    if (endPointer === this.#pointer) return "";
    dataView = dataView.slice(0, endPointer);
    if (encoding) return new TextDecoder(encoding).decode(dataView);
    try {
      const lang = Intl.DateTimeFormat().resolvedOptions().locale.split("-")[0];
      if (lang) {
        const fallbackEncoding = fallbackEncodings[lang];
        if (fallbackEncoding)
          return new TextDecoder(fallbackEncoding, { fatal: true }).decode(dataView);
      }
    } catch {
    }
    try {
      return new TextDecoder("latin1", { fatal: true }).decode(dataView);
    } catch {
    }
    return new TextDecoder("utf8").decode(dataView);
  }
  /**
   * Free internal pointer
   */
  free() {
    if (!this.isManaged()) {
      this.#size = 0;
      _Pointer.free(this.#pointer);
      MemoryRegistry.unregister(this);
    }
    this.#pointer = _Pointer.NULL;
  }
  isNull() {
    return this.#pointer === _Pointer.NULL;
  }
  /**
   * Change pointer size
   * @param {number} size New pointer size, 0 frees the pointer
   * @param {boolean} avoidShrinking Don't reallocate when size is less then current allocated size
   * @returns {Pointer} This pointer
   */
  realloc(size, avoidShrinking = false) {
    if (size < 0) throw new Error("Size must be >= 0");
    if (this.isManaged() || size === this.#size || avoidShrinking && size < this.#size)
      return this;
    let pointer;
    if (size > 0) {
      pointer = malloc(size);
      if (pointer === _Pointer.NULL) throw new NullError("Failed to allocate memory");
      if (!this.isNull()) {
        wasm.HEAP8.copyWithin(pointer, this.#pointer, this.#pointer + Math.min(size, this.#size));
        this.free();
      }
      this.#pointer = pointer;
      MemoryRegistry.register(this, this.#pointer, this);
    } else {
      this.free();
    }
    this.#size = size;
    return this;
  }
  isManaged() {
    return this.#size === 0 && !this.isNull();
  }
};

// package/src/wasm/bridge.mjs
var WARNING = true;
function disableWarning() {
  WARNING = false;
}
var utf8Labels = /* @__PURE__ */ new Set(["unicode-1-1-utf-8", "utf-8", "utf8"]);
var getError = (
  /** @type {GetErrorCb} */
  wasm.cwrap("archive_error_string", "string", ["number"])
);
var getErrorCode = (
  /** @type {getErrorCodeCb} */
  wasm.cwrap("archive_errno", "number", ["number"])
);
var clearError = (
  /** @type {clearErrorCb} */
  wasm.cwrap("archive_clear_error", null, ["number"])
);
function errorCheck(cb, checkReturn) {
  function errorCheckWrapper(archive, ...args) {
    if (archive.isNull()) throw new NullError("Archive pointer is Pointer.NULL");
    const returnCode = cb(archive.raw, ...args);
    if (archive.isNull()) return returnCode;
    const errorMsg = getError(archive.raw) ?? "Unknown error";
    const errorCode = getErrorCode(archive.raw);
    if (WARNING && errorCode === ARCHIVE_ERRNO_PROGRAMMER_ERROR)
      console.warn(
        "LibArchive Programming Error occurred. Please report this to  %s",
        cb.name,
        errorMsg
      );
    try {
      if (checkReturn) {
        switch (returnCode) {
          case ReturnCode.WARN:
            if (WARNING) console.warn(`${cb.name}: ${errorMsg}`);
          // eslint-disable-next-line no-fallthrough
          case ReturnCode.OK:
          case ReturnCode.EOF:
            return;
          case ReturnCode.RETRY:
            throw new RetryError(errorCode, errorMsg);
          case ReturnCode.FATAL:
            throw new FatalError(errorCode, errorMsg);
          case ReturnCode.FAILED:
            throw new FailedError(errorCode, errorMsg);
          default:
            throw new Error("Invalid return code");
        }
      } else {
        if (errorCode !== 0) throw new ArchiveError(errorCode, errorMsg);
        if (checkReturn === null) {
          const pointer = new Pointer(0, returnCode);
          if (pointer.isNull()) throw new NullError("Returned unexpected Pointer.NULL");
          return pointer;
        }
        return returnCode;
      }
    } finally {
      clearError(archive.raw);
    }
  }
  return errorCheckWrapper;
}
var _openArchive = (
  /** @type {OpenArchiveCb} */
  wasm.cwrap("open_archive", "number", ["number", "number", "string", "boolean"])
);
var _openArchiveBuffMap = /* @__PURE__ */ new WeakMap();
function openArchive(buffer, passphrase, recursive) {
  if (buffer.size == null || buffer.isNull())
    throw new NullError("Archive data must be a malloc'd buffer, not NULL or externally managed");
  if (passphrase == null) passphrase = "";
  const archive = new Pointer(
    0,
    _openArchive(buffer.raw, buffer.size, passphrase, recursive || false)
  );
  if (archive.isNull()) throw new NullError("Failed to allocate memory");
  const errorCode = getErrorCode(archive.raw);
  if (errorCode !== 0) {
    const errorMsg = getError(archive.raw);
    clearError(archive.raw);
    closeArchive(archive);
    throw new (errorCode === EPASS ? PassphraseError : ArchiveError)(errorCode, errorMsg);
  }
  _openArchiveBuffMap.set(archive, buffer);
  return archive;
}
var getNextEntry = (
  /** @type {GetNextEntryCb} */
  errorCheck(wasm.cwrap("get_next_entry", "number", ["number"]), null)
);
var _getFileData = (
  /** @type {GetFileDataCb} */
  wasm.cwrap("get_filedata", "number", ["number", "number"])
);
function getFileData(archive, buffsize) {
  if (archive.isNull()) throw new NullError("Archive pointer is Pointer.NULL");
  if (buffsize === 0n) return new Pointer();
  const size = Number(buffsize);
  if (size > Number.MAX_SAFE_INTEGER) {
    throw new FileReadError(
      ARCHIVE_ERRNO_MISC,
      `Couldn't read entry data due to it's size exceeding MAX_SAFE_INTEGER: ${buffsize}`
    );
  }
  const fileDataPointer = new Pointer(size, _getFileData(archive.raw, size));
  let readLen, errorMsg, errorCode;
  if (archive.isNull()) {
    errorMsg = "Archive pointer is Pointer.NULL";
    errorCode = ENULL;
  } else {
    errorMsg = getError(archive.raw);
    errorCode = getErrorCode(archive.raw);
  }
  try {
    if (errorCode !== 0) {
      throw errorCode === ARCHIVE_ERRNO_MISC && errorMsg.toLocaleLowerCase().includes("passphrase") ? new PassphraseError(EPASS, errorMsg) : new FileReadError(errorCode, errorMsg || "Failed to read archive data");
    }
    if (fileDataPointer.isNull()) throw new NullError("Failed to allocate memory for archive data");
    readLen = Number.parseInt(errorMsg);
    if (Number.isNaN(readLen) || readLen < 0)
      throw new FileReadError(ARCHIVE_ERRNO_MISC, "Invalid size for archive data");
  } finally {
    if (!archive.isNull()) clearError(archive.raw);
  }
  return fileDataPointer.realloc(readLen, true);
}
var _closeArchive = (
  /** @type {CloseArchiveCb} */
  errorCheck(wasm.cwrap("archive_read_free", "number", ["number"]), true)
);
function closeArchive(archive) {
  try {
    if (!archive.isNull()) _closeArchive(archive);
  } finally {
    _openArchiveBuffMap.delete(archive);
    archive.free();
  }
}
var getEntrySize = (
  /** @type {GetEntrySizeCb} */
  errorCheck(wasm.cwrap("archive_entry_size", "number", ["number"]), false)
);
var getEntryMode = (
  /** @type {GetEntryModeCb} */
  errorCheck(wasm.cwrap("archive_entry_mode", "number", ["number"]), false)
);
var getEntryAtime = (
  /** @type {GetEntryAtimeCb} */
  errorCheck(wasm.cwrap("archive_entry_atime", "number", ["number"]), false)
);
var getEntryCtime = (
  /** @type {GetEntryCtimeCb} */
  errorCheck(wasm.cwrap("archive_entry_ctime", "number", ["number"]), false)
);
var getEntryMtime = (
  /** @type {GetEntryMtimeCb} */
  errorCheck(wasm.cwrap("archive_entry_mtime", "number", ["number"]), false)
);
var getEntryBirthtime = (
  /** @type {GetEntryBirthtimeCb} */
  errorCheck(wasm.cwrap("archive_entry_birthtime", "number", ["number"]), false)
);
function wrapGetEntryStringValue(cFuncName) {
  return (entry, encoding) => {
    let value = null;
    if (encoding == null || utf8Labels.has(encoding))
      value = wasm.ccall(`${cFuncName}_utf8`, "string", ["number"], [entry.raw]);
    if (!value) {
      const pointer = new Pointer(
        0,
        /** @type {number} */
        wasm.ccall(cFuncName, "number", ["number"], [entry.raw])
      );
      if (!pointer.isNull()) value = pointer.readString(encoding);
    }
    return value || null;
  };
}
var getEntrySymlink = wrapGetEntryStringValue("archive_entry_symlink");
var getEntryHardlink = wrapGetEntryStringValue("archive_entry_hardlink");
var getEntryPathName = wrapGetEntryStringValue("archive_entry_pathname");

// package/src/archive.mjs
var MAX_RECURSIONS_DEPTH = 16;
var isObject = (input) => {
  return typeof input === "object" && input !== null && !Array.isArray(input);
};
var isRegexArray = (input) => {
  return Array.isArray(input) && input.every((re) => re instanceof RegExp);
};
function reopenArchive(buffer, offset, passphrase) {
  let skips = offset + 1;
  const archive = openArchive(buffer, passphrase);
  try {
    while (--skips >= 0) {
      try {
        getNextEntry(archive);
      } catch (error) {
        throw error instanceof NullError ? new FileReadError(ENULL, `Couldn't find entry ${offset} inside archive`) : error;
      }
    }
    return archive;
  } catch (error) {
    closeArchive(archive);
    throw error;
  }
}
function processOptions(opts) {
  let include = false;
  let exclude = false;
  let baseDir;
  let encoding;
  let normalize2 = true;
  let recursive = false;
  let passphrase;
  let ignoreDotDir = true;
  let recursionDepth = 0;
  let stripComponents = 0;
  if (opts) {
    if (typeof opts === "string") passphrase = opts;
    else if (isObject(opts)) {
      baseDir = opts.baseDir;
      if (typeof baseDir !== "string" && baseDir !== void 0)
        throw new TypeError("Invalid baseDir option, expected a string");
      encoding = opts.encoding;
      if (typeof encoding !== "string" && encoding !== void 0)
        throw new TypeError("Invalid encoding option, expected a string");
      passphrase = opts.passphrase;
      if (typeof passphrase !== "string" && passphrase !== void 0)
        throw new TypeError("Invalid passphrase option, expected a string");
      if (opts.include != null) {
        if (!isRegexArray(opts.include))
          throw new TypeError("Invalid include option, expected an array of RegExp");
        include = opts.include;
      }
      if (opts.exclude != null) {
        if (!isRegexArray(opts.exclude))
          throw new TypeError("Invalid exclude option, expected an array of RegExp");
        exclude = opts.exclude;
      }
      if (opts.normalize != null) {
        if (typeof opts.normalize !== "boolean")
          throw new TypeError("Invalid normalize option, expected a boolean");
        normalize2 = opts.normalize;
      }
      if (opts.ignoreDotDir != null) {
        if (typeof opts.ignoreDotDir !== "boolean")
          throw new TypeError("Invalid ignoreDotDir option, expected a boolean");
        ignoreDotDir = opts.ignoreDotDir;
      }
      if (opts.stripComponents != null) {
        if (typeof opts.stripComponents !== "number")
          throw new TypeError("Invalid stripComponents option, expected a number");
        stripComponents = opts.stripComponents;
      }
      if (typeof opts.recursive === "boolean") {
        recursive = opts.recursive;
      } else if (typeof opts.recursive === "object" && opts.recursive != null && typeof opts.recursive.valueOf() === "boolean" && "depth" in opts.recursive && typeof opts.recursive.depth === "number") {
        recursive = /** @type {boolean} */
        opts.recursive.valueOf();
        recursionDepth = opts.recursive.depth;
      }
    } else {
      throw new TypeError("Invalid options type, expected string or object");
    }
  }
  if (recursionDepth >= MAX_RECURSIONS_DEPTH) throw new ExceedRecursionLimitError();
  return {
    include,
    exclude,
    baseDir,
    encoding,
    normalize: normalize2,
    recursive,
    recursionDepth,
    stripComponents,
    passphrase,
    ignoreDotDir
  };
}
function* extract(data, opts) {
  let offset = -1;
  const {
    include,
    exclude,
    baseDir,
    encoding,
    normalize: normalize2,
    recursive,
    recursionDepth,
    stripComponents,
    passphrase,
    ignoreDotDir
  } = processOptions(opts);
  const buffer = data instanceof Pointer ? data : new Pointer().fill(data, true);
  let archive = openArchive(buffer, passphrase, recursionDepth > 0);
  try {
    while (true) {
      offset++;
      let pointer;
      try {
        pointer = getNextEntry(archive);
      } catch (error) {
        if (error instanceof NullError) return;
        throw error;
      }
      const mode = getEntryMode(pointer);
      const type = EntryTypeName[FILETYPE_FLAG & mode] ?? null;
      let rawPath = getEntryPathName(pointer, encoding);
      if (rawPath) {
        const normalizedPath = path_default.normalize(path_default.relative("/", path_default.resolve(rawPath)));
        if (include && !include.some((re) => re.test(normalizedPath)) || exclude && exclude.some((re) => re.test(normalizedPath)) || ignoreDotDir && type === "DIR" && normalizedPath === ".")
          continue;
        if (stripComponents > 0 && !path_default.isAbsolute(rawPath)) {
          const parts = normalizedPath.split("/").slice(stripComponents);
          if (parts.length === 0) continue;
          rawPath = parts.join("/");
        } else if (normalize2) {
          rawPath = normalizedPath;
        }
      }
      let fileData = null;
      const entry = {
        perm: ~FILETYPE_FLAG & mode,
        size: getEntrySize(pointer),
        type,
        path: rawPath && !path_default.isAbsolute(rawPath) && baseDir ? path_default.relative("/", path_default.resolve(baseDir)) + "/" + path_default.relative(baseDir, path_default.resolve(baseDir, rawPath)) : rawPath,
        link: getEntrySymlink(pointer, encoding) ?? getEntryHardlink(pointer, encoding),
        atime: getEntryAtime(pointer),
        ctime: getEntryCtime(pointer),
        mtime: getEntryMtime(pointer),
        birthtime: getEntryBirthtime(pointer),
        get data() {
          if (fileData == null) fileData = getFileData(archive, entry.size);
          const data2 = fileData.isNull() ? new ArrayBuffer(0) : fileData.read();
          Object.defineProperty(entry, "data", { value: data2 });
          return data2;
        }
      };
      if (recursive && entry.type === "FILE" && entry.path && !entry.link) {
        const innerData = entry.data;
        if (innerData != null && innerData.byteLength > 0) {
          if (offset === 10 && WARNING)
            console.warn(
              "Using the recursive feature for large archives has a considerable performance impact"
            );
          closeArchive(archive);
          archive = Pointer.NIL;
          const recursion = new Boolean(recursive);
          Object.defineProperty(recursion, "depth", { value: recursionDepth + 1 });
          let entryIsArchive = false;
          try {
            yield* extract(innerData, {
              baseDir: path_default.dirname(entry.path),
              encoding,
              // @ts-expect-error Major hack, dont do this at home kids XD
              recursive: recursion,
              passphrase,
              ignoreDotDir
            });
            entryIsArchive = true;
          } catch (error) {
            if (!(error instanceof ArchiveError && error.code === ARCHIVE_ERRNO_FILE_FORMAT)) {
              throw error;
            }
          }
          archive = reopenArchive(buffer, offset, passphrase);
          if (entryIsArchive) continue;
        }
      }
      yield entry;
      const entryDataGetter = Object.getOwnPropertyDescriptor(entry, "data")?.get;
      if (typeof entryDataGetter === "function") {
        const entryOffset = offset;
        Object.defineProperty(entry, "data", {
          get: () => {
            if (WARNING)
              console.warn(
                "Accessing entry's data after the extract loop results in worse performance"
              );
            archive = reopenArchive(buffer, entryOffset, passphrase);
            try {
              return entryDataGetter();
            } finally {
              closeArchive(archive);
              archive = Pointer.NIL;
            }
          }
        });
      }
    }
  } finally {
    closeArchive(archive);
    archive = Pointer.NIL;
  }
}
function extractAll(data, opts) {
  let sizeLimit = (
    /** @type {bigint?} */
    128n * 1024n * 1024n
  );
  if (opts && typeof opts === "object") {
    if (opts.sizeLimit != null) {
      if (typeof opts.sizeLimit !== "bigint")
        throw new TypeError("Invalid sizeLimit option, expected a bigint");
      sizeLimit = opts.sizeLimit;
    }
  }
  return Array.from(extract(data, opts), (e) => {
    if (sizeLimit != null && (sizeLimit -= e.size) < 0) throw new ExceedSizeLimitError();
    void e.data;
    return e;
  });
}
export {
  ArchiveError,
  EntryTypeName,
  ExceedRecursionLimitError,
  ExceedSizeLimitError,
  FailedError,
  FatalError,
  FileReadError,
  NullError,
  PassphraseError,
  RetryError,
  disableWarning,
  extract,
  extractAll
};
/*!
 * archive-wasm - LibArchive compiled to WASM with a idiomatic JS API
 * Copyright (C) 2023 Spacedrive Technology Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <
 */
/**
 * @license
 * Copyright 2010 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */
window.ArchiveWasm = { extractAll, extract };
