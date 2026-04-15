var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined")
    return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/CoreCryptoError.ts
class CoreCryptoError extends Error {
  errorStack;
  context;
  type;
  constructor(richError, ...params) {
    super(richError.message, ...params);
    Object.setPrototypeOf(this, new.target.prototype);
    if (richError.error_name) {
      this.name = richError.error_name;
    }
    if (richError.error_stack) {
      this.errorStack = richError.error_stack;
    } else {
      this.errorStack = [];
    }
    if (richError.context && richError.type && Object.values(ErrorType).includes(richError.type)) {
      this.context = richError.context;
      this.type = richError.type;
    }
  }
  static fallback(message, ...params) {
    return new CoreCryptoError({ message }, ...params);
  }
  static build(msg, ...params) {
    try {
      const richError = JSON.parse(msg);
      return new this(richError, ...params);
    } catch {
      return this.fallback(msg, ...params);
    }
  }
  static fromStdError(e) {
    if (isCcErrorGeneric(e)) {
      return e;
    }
    const opts = {
      cause: e.cause || undefined,
      stack: e.stack || undefined
    };
    return this.build(e.message, opts);
  }
  static async asyncMapErr(p) {
    const mappedErrorPromise = p.catch((e) => {
      if (isCcErrorGeneric(e)) {
        throw e;
      } else {
        throw this.fromStdError(e);
      }
    });
    return await mappedErrorPromise;
  }
}
var ErrorType;
((ErrorType2) => {
  ErrorType2["Mls"] = "Mls";
  ErrorType2["Proteus"] = "Proteus";
  ErrorType2["E2ei"] = "E2ei";
  ErrorType2["TransactionFailed"] = "TransactionFailed";
  ErrorType2["Other"] = "Other";
})(ErrorType ||= {});
function isCcErrorGeneric(error) {
  return typeof error === "object" && error !== null && "errorStack" in error && "context" in error && "type" in error;
}
function isCcError(error, errorType) {
  return isCcErrorGeneric(error) && error.type === errorType;
}
function isE2eiError(error) {
  return isCcError(error, "E2ei" /* E2ei */);
}
function isTransactionFailedError(error) {
  return isCcError(error, "TransactionFailed" /* TransactionFailed */);
}
function isOtherError(error) {
  return isCcError(error, "Other" /* Other */);
}
var MlsErrorType;
((MlsErrorType2) => {
  MlsErrorType2["ConversationAlreadyExists"] = "ConversationAlreadyExists";
  MlsErrorType2["DuplicateMessage"] = "DuplicateMessage";
  MlsErrorType2["BufferedFutureMessage"] = "BufferedFutureMessage";
  MlsErrorType2["WrongEpoch"] = "WrongEpoch";
  MlsErrorType2["BufferedCommit"] = "BufferedCommit";
  MlsErrorType2["MessageEpochTooOld"] = "MessageEpochTooOld";
  MlsErrorType2["SelfCommitIgnored"] = "SelfCommitIgnored";
  MlsErrorType2["UnmergedPendingGroup"] = "UnmergedPendingGroup";
  MlsErrorType2["StaleProposal"] = "StaleProposal";
  MlsErrorType2["StaleCommit"] = "StaleCommit";
  MlsErrorType2["OrphanWelcome"] = "OrphanWelcome";
  MlsErrorType2["MessageRejected"] = "MessageRejected";
  MlsErrorType2["Other"] = "Other";
})(MlsErrorType ||= {});
function isMlsError(error, errorType) {
  return isCcError(error, "Mls" /* Mls */) && error.context !== undefined && error.context.type === errorType;
}
function isMlsConversationAlreadyExistsError(error) {
  return isMlsError(error, "ConversationAlreadyExists" /* ConversationAlreadyExists */);
}
function isMlsDuplicateMessageError(error) {
  return isMlsError(error, "DuplicateMessage" /* DuplicateMessage */);
}
function isMlsBufferedFutureMessageError(error) {
  return isMlsError(error, "BufferedFutureMessage" /* BufferedFutureMessage */);
}
function isMlsWrongEpochError(error) {
  return isMlsError(error, "WrongEpoch" /* WrongEpoch */);
}
function isMlsBufferedCommitError(error) {
  return isMlsError(error, "BufferedCommit" /* BufferedCommit */);
}
function isMlsSelfCommitIgnoredError(error) {
  return isMlsError(error, "SelfCommitIgnored" /* SelfCommitIgnored */);
}
function isMlsUnmergedPendingGroupError(error) {
  return isMlsError(error, "UnmergedPendingGroup" /* UnmergedPendingGroup */);
}
function isMlsStaleProposalError(error) {
  return isMlsError(error, "StaleProposal" /* StaleProposal */);
}
function isMlsStaleCommitError(error) {
  return isMlsError(error, "StaleCommit" /* StaleCommit */);
}
function isMlsOrphanWelcomeError(error) {
  return isMlsError(error, "OrphanWelcome" /* OrphanWelcome */);
}
function isMlsMessageRejectedError(error) {
  return isMlsError(error, "MessageRejected" /* MessageRejected */);
}
function isMlsOtherError(error) {
  return isMlsError(error, "Other" /* Other */);
}
var ProteusErrorType;
((ProteusErrorType2) => {
  ProteusErrorType2["SessionNotFound"] = "SessionNotFound";
  ProteusErrorType2["DuplicateMessage"] = "DuplicateMessage";
  ProteusErrorType2["RemoteIdentityChanged"] = "RemoteIdentityChanged";
  ProteusErrorType2["Other"] = "Other";
})(ProteusErrorType ||= {});
function isProteusError(error, errorType) {
  return isCcError(error, "Proteus" /* Proteus */) && error.context !== undefined && error.context.type === errorType;
}
function isProteusSessionNotFoundError(error) {
  return isProteusError(error, "SessionNotFound" /* SessionNotFound */);
}
function isProteusDuplicateMessageError(error) {
  return isProteusError(error, "DuplicateMessage" /* DuplicateMessage */);
}
function isProteusRemoteIdentityChangedError(error) {
  return isProteusError(error, "RemoteIdentityChanged" /* RemoteIdentityChanged */);
}
function isProteusOtherError(error) {
  return isProteusError(error, "Other" /* Other */);
}
// src/autogenerated/core-crypto-ffi.js
var wasm;
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return decodeText(ptr, len);
}
var WASM_VECTOR_LEN = 0;
var cachedTextEncoder = new TextEncoder;
if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (;offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127)
      break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}
function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_export_4.set(idx, obj);
  return idx;
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    const idx = addToExternrefTable0(e);
    wasm.__wbindgen_exn_store(idx);
  }
}
function isLikeNone(x) {
  return x === undefined || x === null;
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
function debugString(val) {
  const type = typeof val;
  if (type == "number" || type == "boolean" || val == null) {
    return `${val}`;
  }
  if (type == "string") {
    return `"${val}"`;
  }
  if (type == "symbol") {
    const description = val.description;
    if (description == null) {
      return "Symbol";
    } else {
      return `Symbol(${description})`;
    }
  }
  if (type == "function") {
    const name = val.name;
    if (typeof name == "string" && name.length > 0) {
      return `Function(${name})`;
    } else {
      return "Function";
    }
  }
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = "[";
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1;i < length; i++) {
      debug += ", " + debugString(val[i]);
    }
    debug += "]";
    return debug;
  }
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  let className;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    return toString.call(val);
  }
  if (className == "Object") {
    try {
      return "Object(" + JSON.stringify(val) + ")";
    } catch (_) {
      return "Object";
    }
  }
  if (val instanceof Error) {
    return `${val.name}: ${val.message}
${val.stack}`;
  }
  return className;
}
function getArrayJsValueFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  const mem = getDataViewMemory0();
  const result = [];
  for (let i = ptr;i < ptr + 4 * len; i += 4) {
    result.push(wasm.__wbindgen_export_4.get(mem.getUint32(i, true)));
  }
  wasm.__externref_drop_slice(ptr, len);
  return result;
}
var CLOSURE_DTORS = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((state) => {
  wasm.__wbindgen_export_7.get(state.dtor)(state.a, state.b);
});
function makeMutClosure(arg0, arg1, dtor, f) {
  const state = { a: arg0, b: arg1, cnt: 1, dtor };
  const real = (...args) => {
    state.cnt++;
    const a = state.a;
    state.a = 0;
    try {
      return f(a, state.b, ...args);
    } finally {
      if (--state.cnt === 0) {
        wasm.__wbindgen_export_7.get(state.dtor)(a, state.b);
        CLOSURE_DTORS.unregister(state);
      } else {
        state.a = a;
      }
    }
  };
  real.original = state;
  CLOSURE_DTORS.register(real, state, state);
  return real;
}
function _assertClass(instance, klass) {
  if (!(instance instanceof klass)) {
    throw new Error(`expected instance of ${klass.name}`);
  }
}
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
function takeFromExternrefTable0(idx) {
  const value = wasm.__wbindgen_export_4.get(idx);
  wasm.__externref_table_dealloc(idx);
  return value;
}
function ciphersuiteFromU16(discriminant) {
  const ret = wasm.ciphersuiteFromU16(discriminant);
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return ret[0];
}
function ciphersuiteDefault() {
  const ret = wasm.ciphersuiteDefault();
  return ret;
}
function passArrayJsValueToWasm0(array, malloc) {
  const ptr = malloc(array.length * 4, 4) >>> 0;
  for (let i = 0;i < array.length; i++) {
    const add = addToExternrefTable0(array[i]);
    getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
  }
  WASM_VECTOR_LEN = array.length;
  return ptr;
}
function migrateDatabaseKeyTypeToBytes(path, old_key, new_key) {
  const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(old_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len1 = WASM_VECTOR_LEN;
  _assertClass(new_key, DatabaseKey);
  const ret = wasm.migrateDatabaseKeyTypeToBytes(ptr0, len0, ptr1, len1, new_key.__wbg_ptr);
  return ret;
}
function updateDatabaseKey(name, old_key, new_key) {
  const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len0 = WASM_VECTOR_LEN;
  _assertClass(old_key, DatabaseKey);
  _assertClass(new_key, DatabaseKey);
  const ret = wasm.updateDatabaseKey(ptr0, len0, old_key.__wbg_ptr, new_key.__wbg_ptr);
  return ret;
}
function openDatabase(name, key) {
  const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len0 = WASM_VECTOR_LEN;
  _assertClass(key, DatabaseKey);
  var ptr1 = key.__destroy_into_raw();
  const ret = wasm.openDatabase(ptr0, len0, ptr1);
  return ret;
}
function version() {
  let deferred1_0;
  let deferred1_1;
  try {
    const ret = wasm.version();
    deferred1_0 = ret[0];
    deferred1_1 = ret[1];
    return getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}
function build_metadata() {
  const ret = wasm.build_metadata();
  return BuildMetadata.__wrap(ret);
}
function __wbg_adapter_24(arg0, arg1, arg2) {
  wasm.closure2906_externref_shim(arg0, arg1, arg2);
}
function __wbg_adapter_27(arg0, arg1, arg2) {
  wasm.closure1026_externref_shim(arg0, arg1, arg2);
}
function __wbg_adapter_30(arg0, arg1, arg2) {
  wasm.closure2597_externref_shim(arg0, arg1, arg2);
}
function __wbg_adapter_511(arg0, arg1, arg2, arg3) {
  wasm.closure3008_externref_shim(arg0, arg1, arg2, arg3);
}
var Ciphersuite = Object.freeze({
  MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519: 1,
  "1": "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
  MLS_128_DHKEMP256_AES128GCM_SHA256_P256: 2,
  "2": "MLS_128_DHKEMP256_AES128GCM_SHA256_P256",
  MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519: 3,
  "3": "MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519",
  MLS_256_DHKEMX448_AES256GCM_SHA512_Ed448: 4,
  "4": "MLS_256_DHKEMX448_AES256GCM_SHA512_Ed448",
  MLS_256_DHKEMP521_AES256GCM_SHA512_P521: 5,
  "5": "MLS_256_DHKEMP521_AES256GCM_SHA512_P521",
  MLS_256_DHKEMX448_CHACHA20POLY1305_SHA512_Ed448: 6,
  "6": "MLS_256_DHKEMX448_CHACHA20POLY1305_SHA512_Ed448",
  MLS_256_DHKEMP384_AES256GCM_SHA384_P384: 7,
  "7": "MLS_256_DHKEMP384_AES256GCM_SHA384_P384"
});
var CoreCryptoLogLevel = Object.freeze({
  Off: 1,
  "1": "Off",
  Trace: 2,
  "2": "Trace",
  Debug: 3,
  "3": "Debug",
  Info: 4,
  "4": "Info",
  Warn: 5,
  "5": "Warn",
  Error: 6,
  "6": "Error"
});
var CredentialType = Object.freeze({
  Basic: 1,
  "1": "Basic",
  X509: 2,
  "2": "X509"
});
var DeviceStatus = Object.freeze({
  Valid: 1,
  "1": "Valid",
  Expired: 2,
  "2": "Expired",
  Revoked: 3,
  "3": "Revoked"
});
var E2eiConversationState = Object.freeze({
  Verified: 1,
  "1": "Verified",
  NotVerified: 2,
  "2": "NotVerified",
  NotEnabled: 3,
  "3": "NotEnabled"
});
var MlsGroupInfoEncryptionType = Object.freeze({
  Plaintext: 1,
  "1": "Plaintext",
  JweEncrypted: 2,
  "2": "JweEncrypted"
});
var MlsRatchetTreeType = Object.freeze({
  Full: 1,
  "1": "Full",
  Delta: 2,
  "2": "Delta",
  ByRef: 3,
  "3": "ByRef"
});
var MlsTransportResponseVariant = Object.freeze({
  Success: 1,
  "1": "Success",
  Retry: 2,
  "2": "Retry",
  Abort: 3,
  "3": "Abort"
});
var WirePolicy = Object.freeze({
  Plaintext: 1,
  "1": "Plaintext",
  Ciphertext: 2,
  "2": "Ciphertext"
});
var __wbindgen_enum_IdbTransactionMode = ["readonly", "readwrite", "versionchange", "readwriteflush", "cleanup"];
var AcmeChallengeFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_acmechallenge_free(ptr >>> 0, 1));

class AcmeChallenge {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(AcmeChallenge.prototype);
    obj.__wbg_ptr = ptr;
    AcmeChallengeFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    AcmeChallengeFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_acmechallenge_free(ptr, 0);
  }
  get delegate() {
    const ret = wasm.__wbg_get_acmechallenge_delegate(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  get url() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_acmechallenge_url(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get target() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_acmechallenge_target(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
}
if (Symbol.dispose)
  AcmeChallenge.prototype[Symbol.dispose] = AcmeChallenge.prototype.free;
var AcmeDirectoryFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_acmedirectory_free(ptr >>> 0, 1));

class AcmeDirectory {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(AcmeDirectory.prototype);
    obj.__wbg_ptr = ptr;
    AcmeDirectoryFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    AcmeDirectoryFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_acmedirectory_free(ptr, 0);
  }
  get newNonce() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_acmedirectory_newNonce(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get newAccount() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_acmedirectory_newAccount(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get newOrder() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_acmedirectory_newOrder(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get revokeCert() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_acmedirectory_revokeCert(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
}
if (Symbol.dispose)
  AcmeDirectory.prototype[Symbol.dispose] = AcmeDirectory.prototype.free;
var BufferedDecryptedMessageFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_buffereddecryptedmessage_free(ptr >>> 0, 1));

class BufferedDecryptedMessage {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(BufferedDecryptedMessage.prototype);
    obj.__wbg_ptr = ptr;
    BufferedDecryptedMessageFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    BufferedDecryptedMessageFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_buffereddecryptedmessage_free(ptr, 0);
  }
  get message() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_message(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
  }
  get isActive() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_isActive(this.__wbg_ptr);
    return ret !== 0;
  }
  get commitDelay() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_commitDelay(this.__wbg_ptr);
    return ret[0] === 0 ? undefined : BigInt.asUintN(64, ret[1]);
  }
  get senderClientId() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_senderClientId(this.__wbg_ptr);
    return ret === 0 ? undefined : ClientId.__wrap(ret);
  }
  get hasEpochChanged() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_hasEpochChanged(this.__wbg_ptr);
    return ret !== 0;
  }
  get identity() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_identity(this.__wbg_ptr);
    return WireIdentity.__wrap(ret);
  }
  get crlNewDistributionPoints() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_crlNewDistributionPoints(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    }
    return v1;
  }
}
if (Symbol.dispose)
  BufferedDecryptedMessage.prototype[Symbol.dispose] = BufferedDecryptedMessage.prototype.free;
var BuildMetadataFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_buildmetadata_free(ptr >>> 0, 1));

class BuildMetadata {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(BuildMetadata.prototype);
    obj.__wbg_ptr = ptr;
    BuildMetadataFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  toJSON() {
    return {
      timestamp: this.timestamp,
      cargoDebug: this.cargoDebug,
      cargoFeatures: this.cargoFeatures,
      optLevel: this.optLevel,
      targetTriple: this.targetTriple,
      gitBranch: this.gitBranch,
      gitDescribe: this.gitDescribe,
      gitSha: this.gitSha,
      gitDirty: this.gitDirty
    };
  }
  toString() {
    return JSON.stringify(this);
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    BuildMetadataFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_buildmetadata_free(ptr, 0);
  }
  get timestamp() {
    const ret = wasm.__wbg_get_buildmetadata_timestamp(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get cargoDebug() {
    const ret = wasm.__wbg_get_buildmetadata_cargoDebug(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get cargoFeatures() {
    const ret = wasm.__wbg_get_buildmetadata_cargoFeatures(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get optLevel() {
    const ret = wasm.__wbg_get_buildmetadata_optLevel(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get targetTriple() {
    const ret = wasm.__wbg_get_buildmetadata_targetTriple(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get gitBranch() {
    const ret = wasm.__wbg_get_buildmetadata_gitBranch(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get gitDescribe() {
    const ret = wasm.__wbg_get_buildmetadata_gitDescribe(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get gitSha() {
    const ret = wasm.__wbg_get_buildmetadata_gitSha(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
  get gitDirty() {
    const ret = wasm.__wbg_get_buildmetadata_gitDirty(this.__wbg_ptr);
    return getStringFromWasm0(ret[0], ret[1]);
  }
}
if (Symbol.dispose)
  BuildMetadata.prototype[Symbol.dispose] = BuildMetadata.prototype.free;
var ClientIdFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_clientid_free(ptr >>> 0, 1));

class ClientId {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(ClientId.prototype);
    obj.__wbg_ptr = ptr;
    ClientIdFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  static __unwrap(jsValue) {
    if (!(jsValue instanceof ClientId)) {
      return 0;
    }
    return jsValue.__destroy_into_raw();
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ClientIdFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_clientid_free(ptr, 0);
  }
  constructor(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clientid_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    ClientIdFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  copyBytes() {
    const ret = wasm.clientid_copyBytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  ClientId.prototype[Symbol.dispose] = ClientId.prototype.free;
var CommitBundleFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_commitbundle_free(ptr >>> 0, 1));

class CommitBundle {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(CommitBundle.prototype);
    obj.__wbg_ptr = ptr;
    CommitBundleFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    CommitBundleFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_commitbundle_free(ptr, 0);
  }
  get welcome() {
    const ret = wasm.__wbg_get_commitbundle_welcome(this.__wbg_ptr);
    return ret === 0 ? undefined : Welcome.__wrap(ret);
  }
  set welcome(arg0) {
    let ptr0 = 0;
    if (!isLikeNone(arg0)) {
      _assertClass(arg0, Welcome);
      ptr0 = arg0.__destroy_into_raw();
    }
    wasm.__wbg_set_commitbundle_welcome(this.__wbg_ptr, ptr0);
  }
  get commit() {
    const ret = wasm.__wbg_get_commitbundle_commit(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  set commit(arg0) {
    const ptr0 = passArray8ToWasm0(arg0, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_commitbundle_commit(this.__wbg_ptr, ptr0, len0);
  }
  get group_info() {
    const ret = wasm.__wbg_get_commitbundle_group_info(this.__wbg_ptr);
    return GroupInfoBundle.__wrap(ret);
  }
  set group_info(arg0) {
    _assertClass(arg0, GroupInfoBundle);
    var ptr0 = arg0.__destroy_into_raw();
    wasm.__wbg_set_commitbundle_group_info(this.__wbg_ptr, ptr0);
  }
  get encryptedMessage() {
    const ret = wasm.__wbg_get_commitbundle_encryptedMessage(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
  }
}
if (Symbol.dispose)
  CommitBundle.prototype[Symbol.dispose] = CommitBundle.prototype.free;
var ConversationConfigurationFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_conversationconfiguration_free(ptr >>> 0, 1));

class ConversationConfiguration {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ConversationConfigurationFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_conversationconfiguration_free(ptr, 0);
  }
  get ciphersuite() {
    const ret = wasm.__wbg_get_conversationconfiguration_ciphersuite(this.__wbg_ptr);
    return ret === 0 ? undefined : ret;
  }
  get externalSenders() {
    const ret = wasm.__wbg_get_conversationconfiguration_externalSenders(this.__wbg_ptr);
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
  }
  get custom() {
    const ret = wasm.__wbg_get_conversationconfiguration_custom(this.__wbg_ptr);
    return CustomConfiguration.__wrap(ret);
  }
  constructor(ciphersuite, external_senders, key_rotation_span, wire_policy) {
    var ptr0 = isLikeNone(external_senders) ? 0 : passArrayJsValueToWasm0(external_senders, wasm.__wbindgen_malloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.conversationconfiguration_new(isLikeNone(ciphersuite) ? 0 : ciphersuite, ptr0, len0, isLikeNone(key_rotation_span) ? 4294967297 : key_rotation_span >>> 0, isLikeNone(wire_policy) ? 0 : wire_policy);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    ConversationConfigurationFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  ConversationConfiguration.prototype[Symbol.dispose] = ConversationConfiguration.prototype.free;
var ConversationIdFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_conversationid_free(ptr >>> 0, 1));

class ConversationId {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(ConversationId.prototype);
    obj.__wbg_ptr = ptr;
    ConversationIdFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ConversationIdFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_conversationid_free(ptr, 0);
  }
  constructor(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clientid_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    ConversationIdFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  copyBytes() {
    const ret = wasm.conversationid_copyBytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  ConversationId.prototype[Symbol.dispose] = ConversationId.prototype.free;
var CoreCryptoFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_corecrypto_free(ptr >>> 0, 1));

class CoreCrypto {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(CoreCrypto.prototype);
    obj.__wbg_ptr = ptr;
    CoreCryptoFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    CoreCryptoFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_corecrypto_free(ptr, 0);
  }
  client_public_key(ciphersuite, credential_type) {
    const ret = wasm.corecrypto_client_public_key(this.__wbg_ptr, ciphersuite, credential_type);
    return ret;
  }
  transaction(command) {
    const ret = wasm.corecrypto_transaction(this.__wbg_ptr, command);
    return ret;
  }
  conversation_epoch(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_conversation_epoch(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  conversation_ciphersuite(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_conversation_ciphersuite(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  conversation_exists(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_conversation_exists(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  get_client_ids(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_get_client_ids(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  get_external_sender(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_get_external_sender(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  export_secret_key(conversation_id, key_length) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_export_secret_key(this.__wbg_ptr, conversation_id.__wbg_ptr, key_length);
    return ret;
  }
  is_history_sharing_enabled(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_is_history_sharing_enabled(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  get_device_identities(conversation_id, device_ids) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArrayJsValueToWasm0(device_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_get_device_identities(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  get_user_identities(conversation_id, user_ids) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArrayJsValueToWasm0(user_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_get_user_identities(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  e2ei_is_pki_env_setup() {
    const ret = wasm.corecrypto_e2ei_is_pki_env_setup(this.__wbg_ptr);
    return ret;
  }
  e2ei_is_enabled(ciphersuite) {
    const ret = wasm.corecrypto_e2ei_is_enabled(this.__wbg_ptr, ciphersuite);
    return ret;
  }
  e2ei_conversation_state(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecrypto_e2ei_conversation_state(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  register_epoch_observer(epoch_observer) {
    _assertClass(epoch_observer, EpochObserver);
    var ptr0 = epoch_observer.__destroy_into_raw();
    const ret = wasm.corecrypto_register_epoch_observer(this.__wbg_ptr, ptr0);
    return ret;
  }
  register_history_observer(history_observer) {
    _assertClass(history_observer, HistoryObserver);
    var ptr0 = history_observer.__destroy_into_raw();
    const ret = wasm.corecrypto_register_history_observer(this.__wbg_ptr, ptr0);
    return ret;
  }
  static set_logger(logger) {
    _assertClass(logger, CoreCryptoLogger);
    var ptr0 = logger.__destroy_into_raw();
    wasm.corecrypto_set_logger(ptr0);
  }
  static set_max_log_level(level) {
    wasm.corecrypto_set_max_log_level(level);
  }
  provide_transport(callbacks) {
    _assertClass(callbacks, MlsTransport);
    var ptr0 = callbacks.__destroy_into_raw();
    const ret = wasm.corecrypto_provide_transport(this.__wbg_ptr, ptr0);
    return ret;
  }
  proteus_session_exists(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_proteus_session_exists(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  proteus_fingerprint() {
    const ret = wasm.corecrypto_proteus_fingerprint(this.__wbg_ptr);
    return ret;
  }
  proteus_fingerprint_local(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_proteus_fingerprint_local(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  proteus_fingerprint_remote(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_proteus_fingerprint_remote(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  static proteus_last_resort_prekey_id() {
    const ret = wasm.corecrypto_proteus_last_resort_prekey_id();
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
  }
  static proteus_fingerprint_prekeybundle(prekey) {
    let deferred3_0;
    let deferred3_1;
    try {
      const ptr0 = passArray8ToWasm0(prekey, wasm.__wbindgen_malloc);
      const len0 = WASM_VECTOR_LEN;
      const ret = wasm.corecrypto_proteus_fingerprint_prekeybundle(ptr0, len0);
      var ptr2 = ret[0];
      var len2 = ret[1];
      if (ret[3]) {
        ptr2 = 0;
        len2 = 0;
        throw takeFromExternrefTable0(ret[2]);
      }
      deferred3_0 = ptr2;
      deferred3_1 = len2;
      return getStringFromWasm0(ptr2, len2);
    } finally {
      wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
  }
  random_bytes(len) {
    const ret = wasm.corecrypto_random_bytes(this.__wbg_ptr, len);
    return ret;
  }
  reseed_rng(seed) {
    const ptr0 = passArray8ToWasm0(seed, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_reseed_rng(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  static async_new(path, key, client_id, ciphersuites, entropy_seed, nb_key_package) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(key, DatabaseKey);
    var ptr1 = key.__destroy_into_raw();
    let ptr2 = 0;
    if (!isLikeNone(client_id)) {
      _assertClass(client_id, ClientId);
      ptr2 = client_id.__destroy_into_raw();
    }
    var ptr3 = isLikeNone(ciphersuites) ? 0 : passArrayJsValueToWasm0(ciphersuites, wasm.__wbindgen_malloc);
    var len3 = WASM_VECTOR_LEN;
    var ptr4 = isLikeNone(entropy_seed) ? 0 : passArray8ToWasm0(entropy_seed, wasm.__wbindgen_malloc);
    var len4 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_async_new(ptr0, len0, ptr1, ptr2, ptr3, len3, ptr4, len4, isLikeNone(nb_key_package) ? 4294967297 : nb_key_package >>> 0);
    return ret;
  }
  static deferred_init(path, key, entropy_seed) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(key, DatabaseKey);
    var ptr1 = key.__destroy_into_raw();
    var ptr2 = isLikeNone(entropy_seed) ? 0 : passArray8ToWasm0(entropy_seed, wasm.__wbindgen_malloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.corecrypto_deferred_init(ptr0, len0, ptr1, ptr2, len2);
    return ret;
  }
  close() {
    const ptr = this.__destroy_into_raw();
    const ret = wasm.corecrypto_close(ptr);
    return ret;
  }
  static history_client(history_secret) {
    _assertClass(history_secret, HistorySecret);
    var ptr0 = history_secret.__destroy_into_raw();
    const ret = wasm.corecrypto_history_client(ptr0);
    return ret;
  }
}
if (Symbol.dispose)
  CoreCrypto.prototype[Symbol.dispose] = CoreCrypto.prototype.free;
var CoreCryptoContextFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_corecryptocontext_free(ptr >>> 0, 1));

class CoreCryptoContext {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(CoreCryptoContext.prototype);
    obj.__wbg_ptr = ptr;
    CoreCryptoContextFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    CoreCryptoContextFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_corecryptocontext_free(ptr, 0);
  }
  e2ei_new_enrollment(client_id, display_name, handle, team, expiry_sec, ciphersuite) {
    const ptr0 = passStringToWasm0(client_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(display_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(handle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    var ptr3 = isLikeNone(team) ? 0 : passStringToWasm0(team, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len3 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_new_enrollment(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, expiry_sec, ciphersuite);
    return ret;
  }
  e2ei_new_activation_enrollment(display_name, handle, team, expiry_sec, ciphersuite) {
    const ptr0 = passStringToWasm0(display_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(handle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(team) ? 0 : passStringToWasm0(team, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_new_activation_enrollment(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, expiry_sec, ciphersuite);
    return ret;
  }
  e2ei_new_rotate_enrollment(display_name, handle, team, expiry_sec, ciphersuite) {
    var ptr0 = isLikeNone(display_name) ? 0 : passStringToWasm0(display_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(handle) ? 0 : passStringToWasm0(handle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(team) ? 0 : passStringToWasm0(team, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_new_rotate_enrollment(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, expiry_sec, ciphersuite);
    return ret;
  }
  e2ei_register_acme_ca(trust_anchor_pem) {
    const ptr0 = passStringToWasm0(trust_anchor_pem, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_register_acme_ca(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  e2ei_register_intermediate_ca(cert_pem) {
    const ptr0 = passStringToWasm0(cert_pem, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_register_intermediate_ca(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  e2ei_register_crl(crl_dp, crl_der) {
    const ptr0 = passStringToWasm0(crl_dp, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(crl_der, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_register_crl(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  e2ei_mls_init_only(enrollment, certificate_chain, nb_key_package) {
    _assertClass(enrollment, FfiWireE2EIdentity);
    var ptr0 = enrollment.__destroy_into_raw();
    const ptr1 = passStringToWasm0(certificate_chain, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_mls_init_only(this.__wbg_ptr, ptr0, ptr1, len1, isLikeNone(nb_key_package) ? 4294967297 : nb_key_package >>> 0);
    return ret;
  }
  e2ei_rotate(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_e2ei_rotate(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  save_x509_credential(enrollment, certificate_chain) {
    _assertClass(enrollment, FfiWireE2EIdentity);
    var ptr0 = enrollment.__destroy_into_raw();
    const ptr1 = passStringToWasm0(certificate_chain, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_save_x509_credential(this.__wbg_ptr, ptr0, ptr1, len1);
    return ret;
  }
  delete_stale_key_packages(ciphersuite) {
    const ret = wasm.corecryptocontext_delete_stale_key_packages(this.__wbg_ptr, ciphersuite);
    return ret;
  }
  e2ei_enrollment_stash(enrollment) {
    _assertClass(enrollment, FfiWireE2EIdentity);
    var ptr0 = enrollment.__destroy_into_raw();
    const ret = wasm.corecryptocontext_e2ei_enrollment_stash(this.__wbg_ptr, ptr0);
    return ret;
  }
  e2ei_enrollment_stash_pop(handle) {
    const ptr0 = passArray8ToWasm0(handle, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_e2ei_enrollment_stash_pop(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  e2ei_conversation_state(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_e2ei_conversation_state(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  e2ei_is_enabled(ciphersuite) {
    const ret = wasm.corecryptocontext_e2ei_is_enabled(this.__wbg_ptr, ciphersuite);
    return ret;
  }
  get_device_identities(conversation_id, device_ids) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArrayJsValueToWasm0(device_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_get_device_identities(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  get_user_identities(conversation_id, user_ids) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArrayJsValueToWasm0(user_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_get_user_identities(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  e2ei_is_pki_env_setup() {
    const ret = wasm.corecryptocontext_e2ei_is_pki_env_setup(this.__wbg_ptr);
    return ret;
  }
  mls_init(client_id, ciphersuites, nb_key_package) {
    _assertClass(client_id, ClientId);
    var ptr0 = client_id.__destroy_into_raw();
    const ptr1 = passArrayJsValueToWasm0(ciphersuites, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_mls_init(this.__wbg_ptr, ptr0, ptr1, len1, isLikeNone(nb_key_package) ? 4294967297 : nb_key_package >>> 0);
    return ret;
  }
  client_public_key(ciphersuite, credential_type) {
    const ret = wasm.corecryptocontext_client_public_key(this.__wbg_ptr, ciphersuite, credential_type);
    return ret;
  }
  conversation_epoch(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_conversation_epoch(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  conversation_ciphersuite(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_conversation_ciphersuite(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  conversation_exists(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_conversation_exists(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  get_client_ids(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_get_client_ids(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  export_secret_key(conversation_id, key_length) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_export_secret_key(this.__wbg_ptr, conversation_id.__wbg_ptr, key_length);
    return ret;
  }
  get_external_sender(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_get_external_sender(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  client_keypackages(ciphersuite, credential_type, amount_requested) {
    const ret = wasm.corecryptocontext_client_keypackages(this.__wbg_ptr, ciphersuite, credential_type, amount_requested);
    return ret;
  }
  client_valid_keypackages_count(ciphersuite, credential_type) {
    const ret = wasm.corecryptocontext_client_valid_keypackages_count(this.__wbg_ptr, ciphersuite, credential_type);
    return ret;
  }
  create_conversation(conversation_id, creator_credential_type, config) {
    _assertClass(conversation_id, ConversationId);
    _assertClass(config, ConversationConfiguration);
    var ptr0 = config.__destroy_into_raw();
    const ret = wasm.corecryptocontext_create_conversation(this.__wbg_ptr, conversation_id.__wbg_ptr, creator_credential_type, ptr0);
    return ret;
  }
  process_welcome_message(welcome_message, custom_configuration) {
    _assertClass(welcome_message, Welcome);
    var ptr0 = welcome_message.__destroy_into_raw();
    _assertClass(custom_configuration, CustomConfiguration);
    var ptr1 = custom_configuration.__destroy_into_raw();
    const ret = wasm.corecryptocontext_process_welcome_message(this.__wbg_ptr, ptr0, ptr1);
    return ret;
  }
  add_clients_to_conversation(conversation_id, key_packages) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArrayJsValueToWasm0(key_packages, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_add_clients_to_conversation(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  remove_clients_from_conversation(conversation_id, clients) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArrayJsValueToWasm0(clients, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_remove_clients_from_conversation(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  mark_conversation_as_child_of(child_id, parent_id) {
    _assertClass(child_id, ConversationId);
    _assertClass(parent_id, ConversationId);
    const ret = wasm.corecryptocontext_mark_conversation_as_child_of(this.__wbg_ptr, child_id.__wbg_ptr, parent_id.__wbg_ptr);
    return ret;
  }
  update_keying_material(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_update_keying_material(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  commit_pending_proposals(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_commit_pending_proposals(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  wipe_conversation(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_wipe_conversation(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  decrypt_message(conversation_id, payload) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArray8ToWasm0(payload, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_decrypt_message(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  encrypt_message(conversation_id, message) {
    _assertClass(conversation_id, ConversationId);
    const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_encrypt_message(this.__wbg_ptr, conversation_id.__wbg_ptr, ptr0, len0);
    return ret;
  }
  join_by_external_commit(group_info, custom_configuration, credential_type) {
    _assertClass(group_info, GroupInfo);
    var ptr0 = group_info.__destroy_into_raw();
    _assertClass(custom_configuration, CustomConfiguration);
    var ptr1 = custom_configuration.__destroy_into_raw();
    const ret = wasm.corecryptocontext_join_by_external_commit(this.__wbg_ptr, ptr0, ptr1, credential_type);
    return ret;
  }
  enable_history_sharing(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_enable_history_sharing(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  disable_history_sharing(conversation_id) {
    _assertClass(conversation_id, ConversationId);
    const ret = wasm.corecryptocontext_disable_history_sharing(this.__wbg_ptr, conversation_id.__wbg_ptr);
    return ret;
  }
  proteus_init() {
    const ret = wasm.corecryptocontext_proteus_init(this.__wbg_ptr);
    return ret;
  }
  proteus_session_from_prekey(session_id, prekey) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(prekey, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_session_from_prekey(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  proteus_session_from_message(session_id, envelope) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(envelope, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_session_from_message(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  proteus_session_save(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_session_save(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  proteus_session_delete(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_session_delete(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  proteus_session_exists(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_session_exists(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  proteus_decrypt(session_id, ciphertext) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_decrypt(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  proteus_decrypt_safe(session_id, ciphertext) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_decrypt_safe(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  proteus_encrypt(session_id, plaintext) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_encrypt(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  proteus_encrypt_batched(sessions, plaintext) {
    const ptr0 = passArrayJsValueToWasm0(sessions, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_encrypt_batched(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  proteus_new_prekey(prekey_id) {
    const ret = wasm.corecryptocontext_proteus_new_prekey(this.__wbg_ptr, prekey_id);
    return ret;
  }
  proteus_new_prekey_auto() {
    const ret = wasm.corecryptocontext_proteus_new_prekey_auto(this.__wbg_ptr);
    return ret;
  }
  proteus_last_resort_prekey() {
    const ret = wasm.corecryptocontext_proteus_last_resort_prekey(this.__wbg_ptr);
    return ret;
  }
  proteus_fingerprint() {
    const ret = wasm.corecryptocontext_proteus_fingerprint(this.__wbg_ptr);
    return ret;
  }
  proteus_fingerprint_local(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_fingerprint_local(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  proteus_fingerprint_remote(session_id) {
    const ptr0 = passStringToWasm0(session_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_proteus_fingerprint_remote(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  proteus_reload_sessions() {
    const ret = wasm.corecryptocontext_proteus_reload_sessions(this.__wbg_ptr);
    return ret;
  }
  static proteus_last_resort_prekey_id() {
    const ret = wasm.corecryptocontext_proteus_last_resort_prekey_id();
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
  }
  static proteus_fingerprint_prekeybundle(prekey) {
    let deferred3_0;
    let deferred3_1;
    try {
      const ptr0 = passArray8ToWasm0(prekey, wasm.__wbindgen_malloc);
      const len0 = WASM_VECTOR_LEN;
      const ret = wasm.corecryptocontext_proteus_fingerprint_prekeybundle(ptr0, len0);
      var ptr2 = ret[0];
      var len2 = ret[1];
      if (ret[3]) {
        ptr2 = 0;
        len2 = 0;
        throw takeFromExternrefTable0(ret[2]);
      }
      deferred3_0 = ptr2;
      deferred3_1 = len2;
      return getStringFromWasm0(ptr2, len2);
    } finally {
      wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
  }
  set_data(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.corecryptocontext_set_data(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  get_data() {
    const ret = wasm.corecryptocontext_get_data(this.__wbg_ptr);
    return ret;
  }
  random_bytes(len) {
    const ret = wasm.corecryptocontext_random_bytes(this.__wbg_ptr, len);
    return ret;
  }
}
if (Symbol.dispose)
  CoreCryptoContext.prototype[Symbol.dispose] = CoreCryptoContext.prototype.free;
var CoreCryptoLoggerFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_corecryptologger_free(ptr >>> 0, 1));

class CoreCryptoLogger {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    CoreCryptoLoggerFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_corecryptologger_free(ptr, 0);
  }
  constructor(logger, _this) {
    const ret = wasm.corecryptologger_new(logger, _this);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    CoreCryptoLoggerFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  CoreCryptoLogger.prototype[Symbol.dispose] = CoreCryptoLogger.prototype.free;
var CrlRegistrationFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_crlregistration_free(ptr >>> 0, 1));

class CrlRegistration {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(CrlRegistration.prototype);
    obj.__wbg_ptr = ptr;
    CrlRegistrationFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    CrlRegistrationFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_crlregistration_free(ptr, 0);
  }
  get dirty() {
    const ret = wasm.__wbg_get_crlregistration_dirty(this.__wbg_ptr);
    return ret !== 0;
  }
  set dirty(arg0) {
    wasm.__wbg_set_crlregistration_dirty(this.__wbg_ptr, arg0);
  }
  get expiration() {
    const ret = wasm.__wbg_get_crlregistration_expiration(this.__wbg_ptr);
    return ret[0] === 0 ? undefined : BigInt.asUintN(64, ret[1]);
  }
  set expiration(arg0) {
    wasm.__wbg_set_crlregistration_expiration(this.__wbg_ptr, !isLikeNone(arg0), isLikeNone(arg0) ? BigInt(0) : arg0);
  }
  constructor(dirty, expiration) {
    const ret = wasm.crlregistration_new(dirty, !isLikeNone(expiration), isLikeNone(expiration) ? BigInt(0) : expiration);
    this.__wbg_ptr = ret >>> 0;
    CrlRegistrationFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  CrlRegistration.prototype[Symbol.dispose] = CrlRegistration.prototype.free;
var CustomConfigurationFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_customconfiguration_free(ptr >>> 0, 1));

class CustomConfiguration {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(CustomConfiguration.prototype);
    obj.__wbg_ptr = ptr;
    CustomConfigurationFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    CustomConfigurationFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_customconfiguration_free(ptr, 0);
  }
  get keyRotationSpan() {
    const ret = wasm.__wbg_get_customconfiguration_keyRotationSpan(this.__wbg_ptr);
    return ret === 4294967297 ? undefined : ret;
  }
  set keyRotationSpan(arg0) {
    wasm.__wbg_set_customconfiguration_keyRotationSpan(this.__wbg_ptr, isLikeNone(arg0) ? 4294967297 : arg0 >>> 0);
  }
  get wirePolicy() {
    const ret = wasm.__wbg_get_customconfiguration_wirePolicy(this.__wbg_ptr);
    return ret === 0 ? undefined : ret;
  }
  set wirePolicy(arg0) {
    wasm.__wbg_set_customconfiguration_wirePolicy(this.__wbg_ptr, isLikeNone(arg0) ? 0 : arg0);
  }
  constructor(key_rotation_span, wire_policy) {
    const ret = wasm.customconfiguration_new(isLikeNone(key_rotation_span) ? 4294967297 : key_rotation_span >>> 0, isLikeNone(wire_policy) ? 0 : wire_policy);
    this.__wbg_ptr = ret >>> 0;
    CustomConfigurationFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  CustomConfiguration.prototype[Symbol.dispose] = CustomConfiguration.prototype.free;
var DatabaseFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_database_free(ptr >>> 0, 1));

class Database {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(Database.prototype);
    obj.__wbg_ptr = ptr;
    DatabaseFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    DatabaseFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_database_free(ptr, 0);
  }
}
if (Symbol.dispose)
  Database.prototype[Symbol.dispose] = Database.prototype.free;
var DatabaseKeyFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_databasekey_free(ptr >>> 0, 1));

class DatabaseKey {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    DatabaseKeyFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_databasekey_free(ptr, 0);
  }
  constructor(buf) {
    const ptr0 = passArray8ToWasm0(buf, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.databasekey_new(ptr0, len0);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    DatabaseKeyFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  DatabaseKey.prototype[Symbol.dispose] = DatabaseKey.prototype.free;
var DecryptedMessageFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_decryptedmessage_free(ptr >>> 0, 1));

class DecryptedMessage {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(DecryptedMessage.prototype);
    obj.__wbg_ptr = ptr;
    DecryptedMessageFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    DecryptedMessageFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_decryptedmessage_free(ptr, 0);
  }
  get message() {
    const ret = wasm.__wbg_get_decryptedmessage_message(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
  }
  get isActive() {
    const ret = wasm.__wbg_get_decryptedmessage_isActive(this.__wbg_ptr);
    return ret !== 0;
  }
  get commitDelay() {
    const ret = wasm.__wbg_get_decryptedmessage_commitDelay(this.__wbg_ptr);
    return ret[0] === 0 ? undefined : BigInt.asUintN(64, ret[1]);
  }
  get senderClientId() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_senderClientId(this.__wbg_ptr);
    return ret === 0 ? undefined : ClientId.__wrap(ret);
  }
  get hasEpochChanged() {
    const ret = wasm.__wbg_get_decryptedmessage_hasEpochChanged(this.__wbg_ptr);
    return ret !== 0;
  }
  get identity() {
    const ret = wasm.__wbg_get_buffereddecryptedmessage_identity(this.__wbg_ptr);
    return WireIdentity.__wrap(ret);
  }
  get bufferedMessages() {
    const ret = wasm.__wbg_get_decryptedmessage_bufferedMessages(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    }
    return v1;
  }
  get crlNewDistributionPoints() {
    const ret = wasm.__wbg_get_decryptedmessage_crlNewDistributionPoints(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    }
    return v1;
  }
}
if (Symbol.dispose)
  DecryptedMessage.prototype[Symbol.dispose] = DecryptedMessage.prototype.free;
var EpochObserverFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_epochobserver_free(ptr >>> 0, 1));

class EpochObserver {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    EpochObserverFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_epochobserver_free(ptr, 0);
  }
  constructor(this_context, epoch_changed) {
    const ret = wasm.epochobserver_new(this_context, epoch_changed);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    EpochObserverFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  EpochObserver.prototype[Symbol.dispose] = EpochObserver.prototype.free;
var ExternalSenderKeyFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_externalsenderkey_free(ptr >>> 0, 1));

class ExternalSenderKey {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(ExternalSenderKey.prototype);
    obj.__wbg_ptr = ptr;
    ExternalSenderKeyFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  static __unwrap(jsValue) {
    if (!(jsValue instanceof ExternalSenderKey)) {
      return 0;
    }
    return jsValue.__destroy_into_raw();
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ExternalSenderKeyFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_externalsenderkey_free(ptr, 0);
  }
  constructor(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clientid_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    ExternalSenderKeyFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  copyBytes() {
    const ret = wasm.externalsenderkey_copyBytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  ExternalSenderKey.prototype[Symbol.dispose] = ExternalSenderKey.prototype.free;
var FfiWireE2EIdentityFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_ffiwiree2eidentity_free(ptr >>> 0, 1));

class FfiWireE2EIdentity {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(FfiWireE2EIdentity.prototype);
    obj.__wbg_ptr = ptr;
    FfiWireE2EIdentityFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    FfiWireE2EIdentityFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_ffiwiree2eidentity_free(ptr, 0);
  }
  directory_response(directory) {
    const ptr0 = passArray8ToWasm0(directory, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_directory_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  new_account_request(previous_nonce) {
    const ptr0 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_account_request(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  new_account_response(account) {
    const ptr0 = passArray8ToWasm0(account, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_account_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  new_order_request(previous_nonce) {
    const ptr0 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_order_request(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  new_order_response(order) {
    const ptr0 = passArray8ToWasm0(order, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_order_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  new_authz_request(url, previous_nonce) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_authz_request(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  new_authz_response(authz) {
    const ptr0 = passArray8ToWasm0(authz, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_authz_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  create_dpop_token(expiry_secs, backend_nonce) {
    const ptr0 = passStringToWasm0(backend_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_create_dpop_token(this.__wbg_ptr, expiry_secs, ptr0, len0);
    return ret;
  }
  new_dpop_challenge_request(access_token, previous_nonce) {
    const ptr0 = passStringToWasm0(access_token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_dpop_challenge_request(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  new_dpop_challenge_response(challenge) {
    const ptr0 = passArray8ToWasm0(challenge, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_dpop_challenge_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  check_order_request(order_url, previous_nonce) {
    const ptr0 = passStringToWasm0(order_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_check_order_request(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  check_order_response(order) {
    const ptr0 = passArray8ToWasm0(order, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_check_order_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  finalize_request(previous_nonce) {
    const ptr0 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_finalize_request(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  finalize_response(finalize) {
    const ptr0 = passArray8ToWasm0(finalize, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_finalize_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  certificate_request(previous_nonce) {
    const ptr0 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_certificate_request(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
  new_oidc_challenge_request(id_token, previous_nonce) {
    const ptr0 = passStringToWasm0(id_token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(previous_nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_oidc_challenge_request(this.__wbg_ptr, ptr0, len0, ptr1, len1);
    return ret;
  }
  new_oidc_challenge_response(challenge) {
    const ptr0 = passArray8ToWasm0(challenge, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.ffiwiree2eidentity_new_oidc_challenge_response(this.__wbg_ptr, ptr0, len0);
    return ret;
  }
}
if (Symbol.dispose)
  FfiWireE2EIdentity.prototype[Symbol.dispose] = FfiWireE2EIdentity.prototype.free;
var GroupInfoFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_groupinfo_free(ptr >>> 0, 1));

class GroupInfo {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(GroupInfo.prototype);
    obj.__wbg_ptr = ptr;
    GroupInfoFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    GroupInfoFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_groupinfo_free(ptr, 0);
  }
  constructor(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clientid_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    GroupInfoFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  copyBytes() {
    const ret = wasm.groupinfo_copyBytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  GroupInfo.prototype[Symbol.dispose] = GroupInfo.prototype.free;
var GroupInfoBundleFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_groupinfobundle_free(ptr >>> 0, 1));

class GroupInfoBundle {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(GroupInfoBundle.prototype);
    obj.__wbg_ptr = ptr;
    GroupInfoBundleFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    GroupInfoBundleFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_groupinfobundle_free(ptr, 0);
  }
  get encryption_type() {
    const ret = wasm.__wbg_get_groupinfobundle_encryption_type(this.__wbg_ptr);
    return ret;
  }
  set encryption_type(arg0) {
    wasm.__wbg_set_groupinfobundle_encryption_type(this.__wbg_ptr, arg0);
  }
  get ratchet_tree_type() {
    const ret = wasm.__wbg_get_groupinfobundle_ratchet_tree_type(this.__wbg_ptr);
    return ret;
  }
  set ratchet_tree_type(arg0) {
    wasm.__wbg_set_groupinfobundle_ratchet_tree_type(this.__wbg_ptr, arg0);
  }
  get payload() {
    const ret = wasm.__wbg_get_groupinfobundle_payload(this.__wbg_ptr);
    return GroupInfo.__wrap(ret);
  }
  set payload(arg0) {
    _assertClass(arg0, GroupInfo);
    var ptr0 = arg0.__destroy_into_raw();
    wasm.__wbg_set_groupinfobundle_payload(this.__wbg_ptr, ptr0);
  }
}
if (Symbol.dispose)
  GroupInfoBundle.prototype[Symbol.dispose] = GroupInfoBundle.prototype.free;
var HistoryObserverFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_historyobserver_free(ptr >>> 0, 1));

class HistoryObserver {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    HistoryObserverFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_historyobserver_free(ptr, 0);
  }
  constructor(this_context, history_client_created) {
    const ret = wasm.historyobserver_new(this_context, history_client_created);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    HistoryObserverFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  HistoryObserver.prototype[Symbol.dispose] = HistoryObserver.prototype.free;
var HistorySecretFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_historysecret_free(ptr >>> 0, 1));

class HistorySecret {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(HistorySecret.prototype);
    obj.__wbg_ptr = ptr;
    HistorySecretFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    HistorySecretFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_historysecret_free(ptr, 0);
  }
  get clientId() {
    const ret = wasm.__wbg_get_historysecret_clientId(this.__wbg_ptr);
    return ClientId.__wrap(ret);
  }
  get data() {
    const ret = wasm.__wbg_get_historysecret_data(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  constructor(client_id, data) {
    _assertClass(client_id, ClientId);
    var ptr0 = client_id.__destroy_into_raw();
    const ptr1 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.historysecret_new(ptr0, ptr1, len1);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    HistorySecretFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  HistorySecret.prototype[Symbol.dispose] = HistorySecret.prototype.free;
var KeyPackageFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_keypackage_free(ptr >>> 0, 1));

class KeyPackage {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(KeyPackage.prototype);
    obj.__wbg_ptr = ptr;
    KeyPackageFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  static __unwrap(jsValue) {
    if (!(jsValue instanceof KeyPackage)) {
      return 0;
    }
    return jsValue.__destroy_into_raw();
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    KeyPackageFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_keypackage_free(ptr, 0);
  }
  constructor(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clientid_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    KeyPackageFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  copyBytes() {
    const ret = wasm.keypackage_copyBytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  KeyPackage.prototype[Symbol.dispose] = KeyPackage.prototype.free;
var MlsTransportFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_mlstransport_free(ptr >>> 0, 1));

class MlsTransport {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    MlsTransportFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_mlstransport_free(ptr, 0);
  }
  constructor(this_context, send_commit_bundle, send_message, prepare_for_transport) {
    const ret = wasm.mlstransport_new(this_context, send_commit_bundle, send_message, prepare_for_transport);
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1]);
    }
    this.__wbg_ptr = ret[0] >>> 0;
    MlsTransportFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  MlsTransport.prototype[Symbol.dispose] = MlsTransport.prototype.free;
var MlsTransportDataFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_mlstransportdata_free(ptr >>> 0, 1));

class MlsTransportData {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    MlsTransportDataFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_mlstransportdata_free(ptr, 0);
  }
  get data() {
    const ret = wasm.__wbg_get_mlstransportdata_data(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  constructor(buf) {
    const ptr0 = passArray8ToWasm0(buf, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.mlstransportdata_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    MlsTransportDataFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  MlsTransportData.prototype[Symbol.dispose] = MlsTransportData.prototype.free;
var MlsTransportResponseFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_mlstransportresponse_free(ptr >>> 0, 1));

class MlsTransportResponse {
  toJSON() {
    return {
      variant: this.variant,
      abort_reason: this.abort_reason
    };
  }
  toString() {
    return JSON.stringify(this);
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    MlsTransportResponseFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_mlstransportresponse_free(ptr, 0);
  }
  get variant() {
    const ret = wasm.__wbg_get_mlstransportresponse_variant(this.__wbg_ptr);
    return ret;
  }
  set variant(arg0) {
    wasm.__wbg_set_mlstransportresponse_variant(this.__wbg_ptr, arg0);
  }
  get abort_reason() {
    const ret = wasm.__wbg_get_mlstransportresponse_abort_reason(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getStringFromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
  }
  set abort_reason(arg0) {
    var ptr0 = isLikeNone(arg0) ? 0 : passStringToWasm0(arg0, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    wasm.__wbg_set_mlstransportresponse_abort_reason(this.__wbg_ptr, ptr0, len0);
  }
  constructor(variant, abort_reason) {
    var ptr0 = isLikeNone(abort_reason) ? 0 : passStringToWasm0(abort_reason, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.mlstransportresponse_new(variant, ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    MlsTransportResponseFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
}
if (Symbol.dispose)
  MlsTransportResponse.prototype[Symbol.dispose] = MlsTransportResponse.prototype.free;
var NewAcmeAuthzFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_newacmeauthz_free(ptr >>> 0, 1));

class NewAcmeAuthz {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(NewAcmeAuthz.prototype);
    obj.__wbg_ptr = ptr;
    NewAcmeAuthzFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    NewAcmeAuthzFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_newacmeauthz_free(ptr, 0);
  }
  get identifier() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_newacmeauthz_identifier(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get keyauth() {
    const ret = wasm.__wbg_get_newacmeauthz_keyauth(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getStringFromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
  }
  get challenge() {
    const ret = wasm.__wbg_get_newacmeauthz_challenge(this.__wbg_ptr);
    return AcmeChallenge.__wrap(ret);
  }
}
if (Symbol.dispose)
  NewAcmeAuthz.prototype[Symbol.dispose] = NewAcmeAuthz.prototype.free;
var NewAcmeOrderFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_newacmeorder_free(ptr >>> 0, 1));

class NewAcmeOrder {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(NewAcmeOrder.prototype);
    obj.__wbg_ptr = ptr;
    NewAcmeOrderFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    NewAcmeOrderFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_newacmeorder_free(ptr, 0);
  }
  get delegate() {
    const ret = wasm.__wbg_get_newacmeorder_delegate(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
  get authorizations() {
    const ret = wasm.__wbg_get_newacmeorder_authorizations(this.__wbg_ptr);
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
  }
}
if (Symbol.dispose)
  NewAcmeOrder.prototype[Symbol.dispose] = NewAcmeOrder.prototype.free;
var ProteusAutoPrekeyBundleFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_proteusautoprekeybundle_free(ptr >>> 0, 1));

class ProteusAutoPrekeyBundle {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(ProteusAutoPrekeyBundle.prototype);
    obj.__wbg_ptr = ptr;
    ProteusAutoPrekeyBundleFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    ProteusAutoPrekeyBundleFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_proteusautoprekeybundle_free(ptr, 0);
  }
  get id() {
    const ret = wasm.__wbg_get_proteusautoprekeybundle_id(this.__wbg_ptr);
    return ret;
  }
  get pkb() {
    const ret = wasm.__wbg_get_proteusautoprekeybundle_pkb(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  ProteusAutoPrekeyBundle.prototype[Symbol.dispose] = ProteusAutoPrekeyBundle.prototype.free;
var SecretKeyFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_secretkey_free(ptr >>> 0, 1));

class SecretKey {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(SecretKey.prototype);
    obj.__wbg_ptr = ptr;
    SecretKeyFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    SecretKeyFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_secretkey_free(ptr, 0);
  }
  constructor(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clientid_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    SecretKeyFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  copyBytes() {
    const ret = wasm.secretkey_copyBytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  SecretKey.prototype[Symbol.dispose] = SecretKey.prototype.free;
var WelcomeFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_welcome_free(ptr >>> 0, 1));

class Welcome {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(Welcome.prototype);
    obj.__wbg_ptr = ptr;
    WelcomeFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WelcomeFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_welcome_free(ptr, 0);
  }
  constructor(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clientid_new(ptr0, len0);
    this.__wbg_ptr = ret >>> 0;
    WelcomeFinalization.register(this, this.__wbg_ptr, this);
    return this;
  }
  copyBytes() {
    const ret = wasm.welcome_copyBytes(this.__wbg_ptr);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
  }
}
if (Symbol.dispose)
  Welcome.prototype[Symbol.dispose] = Welcome.prototype.free;
var WelcomeBundleFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_welcomebundle_free(ptr >>> 0, 1));

class WelcomeBundle {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(WelcomeBundle.prototype);
    obj.__wbg_ptr = ptr;
    WelcomeBundleFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WelcomeBundleFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_welcomebundle_free(ptr, 0);
  }
  get id() {
    const ret = wasm.__wbg_get_welcomebundle_id(this.__wbg_ptr);
    return ConversationId.__wrap(ret);
  }
  get crlNewDistributionPoints() {
    const ret = wasm.__wbg_get_welcomebundle_crlNewDistributionPoints(this.__wbg_ptr);
    let v1;
    if (ret[0] !== 0) {
      v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
      wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    }
    return v1;
  }
}
if (Symbol.dispose)
  WelcomeBundle.prototype[Symbol.dispose] = WelcomeBundle.prototype.free;
var WireIdentityFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_wireidentity_free(ptr >>> 0, 1));

class WireIdentity {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(WireIdentity.prototype);
    obj.__wbg_ptr = ptr;
    WireIdentityFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    WireIdentityFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_wireidentity_free(ptr, 0);
  }
  get clientId() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_wireidentity_clientId(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get status() {
    const ret = wasm.__wbg_get_wireidentity_status(this.__wbg_ptr);
    return ret;
  }
  get thumbprint() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_wireidentity_thumbprint(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get credentialType() {
    const ret = wasm.__wbg_get_wireidentity_credentialType(this.__wbg_ptr);
    return ret;
  }
  set credentialType(arg0) {
    wasm.__wbg_set_wireidentity_credentialType(this.__wbg_ptr, arg0);
  }
  get x509Identity() {
    const ret = wasm.__wbg_get_wireidentity_x509Identity(this.__wbg_ptr);
    return ret === 0 ? undefined : X509Identity.__wrap(ret);
  }
}
if (Symbol.dispose)
  WireIdentity.prototype[Symbol.dispose] = WireIdentity.prototype.free;
var X509IdentityFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {}, unregister: () => {} } : new FinalizationRegistry((ptr) => wasm.__wbg_x509identity_free(ptr >>> 0, 1));

class X509Identity {
  static __wrap(ptr) {
    ptr = ptr >>> 0;
    const obj = Object.create(X509Identity.prototype);
    obj.__wbg_ptr = ptr;
    X509IdentityFinalization.register(obj, obj.__wbg_ptr, obj);
    return obj;
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    X509IdentityFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_x509identity_free(ptr, 0);
  }
  get handle() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_x509identity_handle(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get displayName() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_x509identity_displayName(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get domain() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_x509identity_domain(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get certificate() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_x509identity_certificate(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get serialNumber() {
    let deferred1_0;
    let deferred1_1;
    try {
      const ret = wasm.__wbg_get_x509identity_serialNumber(this.__wbg_ptr);
      deferred1_0 = ret[0];
      deferred1_1 = ret[1];
      return getStringFromWasm0(ret[0], ret[1]);
    } finally {
      wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
  }
  get notBefore() {
    const ret = wasm.__wbg_get_x509identity_notBefore(this.__wbg_ptr);
    return BigInt.asUintN(64, ret);
  }
  get notAfter() {
    const ret = wasm.__wbg_get_x509identity_notAfter(this.__wbg_ptr);
    return BigInt.asUintN(64, ret);
  }
}
if (Symbol.dispose)
  X509Identity.prototype[Symbol.dispose] = X509Identity.prototype.free;
var EXPECTED_RESPONSE_TYPES = new Set(["basic", "cors", "default"]);
async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);
        if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_Error_e17e777aac105295 = function(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_Number_998bea33bd87c3e0 = function(arg0) {
    const ret = Number(arg0);
    return ret;
  };
  imports.wbg.__wbg_String_8f0eb39a4a4c2f66 = function(arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_acmedirectory_new = function(arg0) {
    const ret = AcmeDirectory.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_buffereddecryptedmessage_new = function(arg0) {
    const ret = BufferedDecryptedMessage.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_call_13410aac570ffff7 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.call(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_call_641db1bb5db5a579 = function() {
    return handleError(function(arg0, arg1, arg2, arg3) {
      const ret = arg0.call(arg1, arg2, arg3);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_call_a5400b25a865cfd8 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.call(arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_call_f1fd202ba222e0ec = function() {
    return handleError(function(arg0, arg1, arg2, arg3, arg4) {
      const ret = arg0.call(arg1, arg2, arg3, arg4);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_clientid_new = function(arg0) {
    const ret = ClientId.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_clientid_unwrap = function(arg0) {
    const ret = ClientId.__unwrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_close_bec476a5be366c27 = function(arg0) {
    arg0.close();
  };
  imports.wbg.__wbg_commitbundle_new = function(arg0) {
    const ret = CommitBundle.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_conversationid_new = function(arg0) {
    const ret = ConversationId.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_corecrypto_new = function(arg0) {
    const ret = CoreCrypto.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_count_1cff3c6a8d01b472 = function() {
    return handleError(function(arg0) {
      const ret = arg0.count();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_count_4fa636eb52ae7a3d = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.count(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_createIndex_1c6d4ccd9a4ba42a = function() {
    return handleError(function(arg0, arg1, arg2, arg3, arg4) {
      const ret = arg0.createIndex(getStringFromWasm0(arg1, arg2), arg3, arg4);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_createIndex_bdb2cf253d016348 = function() {
    return handleError(function(arg0, arg1, arg2, arg3) {
      const ret = arg0.createIndex(getStringFromWasm0(arg1, arg2), arg3);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_createObjectStore_2112aa8eea18ea9d = function() {
    return handleError(function(arg0, arg1, arg2, arg3) {
      const ret = arg0.createObjectStore(getStringFromWasm0(arg1, arg2), arg3);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_crlregistration_new = function(arg0) {
    const ret = CrlRegistration.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_crypto_ed58b8e10a292839 = function(arg0) {
    const ret = arg0.crypto;
    return ret;
  };
  imports.wbg.__wbg_database_new = function(arg0) {
    const ret = Database.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_decryptedmessage_new = function(arg0) {
    const ret = DecryptedMessage.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_deleteIndex_3f4cceeb511f4f95 = function() {
    return handleError(function(arg0, arg1, arg2) {
      arg0.deleteIndex(getStringFromWasm0(arg1, arg2));
    }, arguments);
  };
  imports.wbg.__wbg_deleteObjectStore_10ef920e4da8ac48 = function() {
    return handleError(function(arg0, arg1, arg2) {
      arg0.deleteObjectStore(getStringFromWasm0(arg1, arg2));
    }, arguments);
  };
  imports.wbg.__wbg_delete_33e805b6d49fa644 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.delete(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_done_75ed0ee6dd243d9d = function(arg0) {
    const ret = arg0.done;
    return ret;
  };
  imports.wbg.__wbg_error_031686f9958973bd = function(arg0) {
    const ret = arg0.error;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_error_118f1b830b6ccf22 = function() {
    return handleError(function(arg0) {
      const ret = arg0.error;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    }, arguments);
  };
  imports.wbg.__wbg_error_4700bbeb78363714 = function(arg0, arg1) {
    console.error(arg0, arg1);
  };
  imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
      deferred0_0 = arg0;
      deferred0_1 = arg1;
      console.error(getStringFromWasm0(arg0, arg1));
    } finally {
      wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
    }
  };
  imports.wbg.__wbg_execute_df0397759f250cb7 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.execute(CoreCryptoContext.__wrap(arg1));
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_externalsenderkey_new = function(arg0) {
    const ret = ExternalSenderKey.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_externalsenderkey_unwrap = function(arg0) {
    const ret = ExternalSenderKey.__unwrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_ffiwiree2eidentity_new = function(arg0) {
    const ret = FfiWireE2EIdentity.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_getAll_2783028eb1814671 = function() {
    return handleError(function(arg0) {
      const ret = arg0.getAll();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_getAll_32ab1618e54bf9e5 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.getAll(arg1, arg2 >>> 0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_getAll_ff5bd24743b1031a = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.getAll(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_getRandomValues_9b655bdd369112f2 = function() {
    return handleError(function(arg0, arg1) {
      globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
    }, arguments);
  };
  imports.wbg.__wbg_getRandomValues_bcb4912f16000dc4 = function() {
    return handleError(function(arg0, arg1) {
      arg0.getRandomValues(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_getTime_6bb3f64e0f18f817 = function(arg0) {
    const ret = arg0.getTime();
    return ret;
  };
  imports.wbg.__wbg_get_0da715ceaecea5c8 = function(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
  };
  imports.wbg.__wbg_get_1167dc45047c17fe = function(arg0, arg1, arg2) {
    const ret = arg1[arg2 >>> 0];
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_get_1b2c33a63c4be73f = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.get(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_get_3c4b098dc7bc7177 = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.get(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_get_458e874b43b18b25 = function() {
    return handleError(function(arg0, arg1) {
      const ret = Reflect.get(arg0, arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_getwithrefkey_1dc361bd10053bfe = function(arg0, arg1) {
    const ret = arg0[arg1];
    return ret;
  };
  imports.wbg.__wbg_historysecret_new = function(arg0) {
    const ret = HistorySecret.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_indexNames_c4e1ac3fa4f35161 = function(arg0) {
    const ret = arg0.indexNames;
    return ret;
  };
  imports.wbg.__wbg_index_cc440bc9f1ad368b = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.index(getStringFromWasm0(arg1, arg2));
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_instanceof_ArrayBuffer_67f3012529f6a2dd = function(arg0) {
    let result;
    try {
      result = arg0 instanceof ArrayBuffer;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_IdbDatabase_6e6efef94c4a355d = function(arg0) {
    let result;
    try {
      result = arg0 instanceof IDBDatabase;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_IdbFactory_653c0aade11afa7c = function(arg0) {
    let result;
    try {
      result = arg0 instanceof IDBFactory;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_IdbOpenDbRequest_2be27facb05c6739 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof IDBOpenDBRequest;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_IdbRequest_a4a68ff63181a915 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof IDBRequest;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_IdbTransaction_b45e4045df14b84a = function(arg0) {
    let result;
    try {
      result = arg0 instanceof IDBTransaction;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Promise_3ec9e849bf41bdb6 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Promise;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_instanceof_Uint8Array_9a8378d955933db7 = function(arg0) {
    let result;
    try {
      result = arg0 instanceof Uint8Array;
    } catch (_) {
      result = false;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_isArray_030cce220591fb41 = function(arg0) {
    const ret = Array.isArray(arg0);
    return ret;
  };
  imports.wbg.__wbg_isSafeInteger_1c0d1af5542e102a = function(arg0) {
    const ret = Number.isSafeInteger(arg0);
    return ret;
  };
  imports.wbg.__wbg_iterator_f370b34483c71a1c = function() {
    const ret = Symbol.iterator;
    return ret;
  };
  imports.wbg.__wbg_keyPath_d301f5a3d841ece2 = function() {
    return handleError(function(arg0) {
      const ret = arg0.keyPath;
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_keypackage_new = function(arg0) {
    const ret = KeyPackage.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_keypackage_unwrap = function(arg0) {
    const ret = KeyPackage.__unwrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_length_186546c51cd61acd = function(arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_length_31ac538ef83e5e52 = function(arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_length_6bb7e81f9d7713e4 = function(arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_length_afebfa9c2d66f7e4 = function(arg0) {
    const ret = arg0.length;
    return ret;
  };
  imports.wbg.__wbg_msCrypto_0a36e2ec3a343d26 = function(arg0) {
    const ret = arg0.msCrypto;
    return ret;
  };
  imports.wbg.__wbg_multiEntry_4c5aa2196418a921 = function(arg0) {
    const ret = arg0.multiEntry;
    return ret;
  };
  imports.wbg.__wbg_name_fce5a6feaba74055 = function(arg0, arg1) {
    const ret = arg1.name;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_new0_b0a0a38c201e6df5 = function() {
    const ret = new Date;
    return ret;
  };
  imports.wbg.__wbg_new_19c25a3f2fa63a02 = function() {
    const ret = new Object;
    return ret;
  };
  imports.wbg.__wbg_new_1f3a344cf3123716 = function() {
    const ret = new Array;
    return ret;
  };
  imports.wbg.__wbg_new_2e3c58a15f39f5f9 = function(arg0, arg1) {
    try {
      var state0 = { a: arg0, b: arg1 };
      var cb0 = (arg02, arg12) => {
        const a = state0.a;
        state0.a = 0;
        try {
          return __wbg_adapter_511(a, state0.b, arg02, arg12);
        } finally {
          state0.a = a;
        }
      };
      const ret = new Promise(cb0);
      return ret;
    } finally {
      state0.a = state0.b = 0;
    }
  };
  imports.wbg.__wbg_new_2ff1f68f3676ea53 = function() {
    const ret = new Map;
    return ret;
  };
  imports.wbg.__wbg_new_638ebfaedbf32a5e = function(arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
  };
  imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
    const ret = new Error;
    return ret;
  };
  imports.wbg.__wbg_new_da9dc54c5db29dfa = function(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_newacmeauthz_new = function(arg0) {
    const ret = NewAcmeAuthz.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_newacmeorder_new = function(arg0) {
    const ret = NewAcmeOrder.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_newfromslice_074c56947bd43469 = function(arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_newnoargs_254190557c45b4ec = function(arg0, arg1) {
    const ret = new Function(getStringFromWasm0(arg0, arg1));
    return ret;
  };
  imports.wbg.__wbg_newwithlength_a167dcc7aaa3ba77 = function(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_next_5b3530e612fde77d = function(arg0) {
    const ret = arg0.next;
    return ret;
  };
  imports.wbg.__wbg_next_692e82279131b03c = function() {
    return handleError(function(arg0) {
      const ret = arg0.next();
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_node_02999533c4ea02e3 = function(arg0) {
    const ret = arg0.node;
    return ret;
  };
  imports.wbg.__wbg_now_1e80617bcee43265 = function() {
    const ret = Date.now();
    return ret;
  };
  imports.wbg.__wbg_now_4feb08c548aa0974 = function() {
    const ret = Date.now();
    return ret;
  };
  imports.wbg.__wbg_objectStoreNames_31ac72154caf5a01 = function(arg0) {
    const ret = arg0.objectStoreNames;
    return ret;
  };
  imports.wbg.__wbg_objectStore_b2a5b80b2e5c5f8b = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.objectStore(getStringFromWasm0(arg1, arg2));
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_open_7281831ed8ff7bd2 = function() {
    return handleError(function(arg0, arg1, arg2, arg3) {
      const ret = arg0.open(getStringFromWasm0(arg1, arg2), arg3 >>> 0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_open_f25e984ff3e90fbe = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.open(getStringFromWasm0(arg1, arg2));
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_process_5c1d670bc53614b8 = function(arg0) {
    const ret = arg0.process;
    return ret;
  };
  imports.wbg.__wbg_proteusautoprekeybundle_new = function(arg0) {
    const ret = ProteusAutoPrekeyBundle.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_prototypesetcall_3d4a26c1ed734349 = function(arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
  };
  imports.wbg.__wbg_push_330b2eb93e4e1212 = function(arg0, arg1) {
    const ret = arg0.push(arg1);
    return ret;
  };
  imports.wbg.__wbg_put_cdfadd5d7f714201 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.put(arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_put_f777be76774b073e = function() {
    return handleError(function(arg0, arg1) {
      const ret = arg0.put(arg1);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_queueMicrotask_25d0739ac89e8c88 = function(arg0) {
    queueMicrotask(arg0);
  };
  imports.wbg.__wbg_queueMicrotask_4488407636f5bf24 = function(arg0) {
    const ret = arg0.queueMicrotask;
    return ret;
  };
  imports.wbg.__wbg_randomFillSync_ab2cfe79ebbf2740 = function() {
    return handleError(function(arg0, arg1) {
      arg0.randomFillSync(arg1);
    }, arguments);
  };
  imports.wbg.__wbg_require_79b1e9274cde3c87 = function() {
    return handleError(function() {
      const ret = module_core_crypto_ffi.require;
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_resolve_4055c623acdd6a1b = function(arg0) {
    const ret = Promise.resolve(arg0);
    return ret;
  };
  imports.wbg.__wbg_result_825a6aeeb31189d2 = function() {
    return handleError(function(arg0) {
      const ret = arg0.result;
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_secretkey_new = function(arg0) {
    const ret = SecretKey.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_set_3f1d0b984ed272ed = function(arg0, arg1, arg2) {
    arg0[arg1] = arg2;
  };
  imports.wbg.__wbg_set_453345bcda80b89a = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = Reflect.set(arg0, arg1, arg2);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_set_90f6c0f7bd8c0415 = function(arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
  };
  imports.wbg.__wbg_set_b7f1cf4fae26fe2a = function(arg0, arg1, arg2) {
    const ret = arg0.set(arg1, arg2);
    return ret;
  };
  imports.wbg.__wbg_setautoincrement_50a19db9199c2ec6 = function(arg0, arg1) {
    arg0.autoIncrement = arg1 !== 0;
  };
  imports.wbg.__wbg_setcause_b436bba24efd40ba = function(arg0, arg1) {
    arg0.cause = arg1;
  };
  imports.wbg.__wbg_setkeypath_3a5536ae3a5f612c = function(arg0, arg1) {
    arg0.keyPath = arg1;
  };
  imports.wbg.__wbg_setmultientry_7e7416b8acaeb4d0 = function(arg0, arg1) {
    arg0.multiEntry = arg1 !== 0;
  };
  imports.wbg.__wbg_setname_832b43d4602cb930 = function(arg0, arg1, arg2) {
    arg0.name = getStringFromWasm0(arg1, arg2);
  };
  imports.wbg.__wbg_setonabort_4edac498cf4576fe = function(arg0, arg1) {
    arg0.onabort = arg1;
  };
  imports.wbg.__wbg_setoncomplete_8a32ad2d1ca4f49b = function(arg0, arg1) {
    arg0.oncomplete = arg1;
  };
  imports.wbg.__wbg_setonerror_4b0c685c365f600d = function(arg0, arg1) {
    arg0.onerror = arg1;
  };
  imports.wbg.__wbg_setonerror_bcdbd7f3921ffb1f = function(arg0, arg1) {
    arg0.onerror = arg1;
  };
  imports.wbg.__wbg_setonsuccess_ffb2ddb27ce681d8 = function(arg0, arg1) {
    arg0.onsuccess = arg1;
  };
  imports.wbg.__wbg_setonupgradeneeded_4e32d1c6a08c4257 = function(arg0, arg1) {
    arg0.onupgradeneeded = arg1;
  };
  imports.wbg.__wbg_setonversionchange_3d3385e00121e4b2 = function(arg0, arg1) {
    arg0.onversionchange = arg1;
  };
  imports.wbg.__wbg_setunique_a562a12b425d2be8 = function(arg0, arg1) {
    arg0.unique = arg1 !== 0;
  };
  imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
    const ret = arg1.stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_static_accessor_GLOBAL_8921f820c2ce3f12 = function() {
    const ret = typeof global === "undefined" ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_static_accessor_GLOBAL_THIS_f0a4409105898184 = function() {
    const ret = typeof globalThis === "undefined" ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_static_accessor_SELF_995b214ae681ff99 = function() {
    const ret = typeof self === "undefined" ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_static_accessor_WINDOW_cde3890479c675ea = function() {
    const ret = typeof window === "undefined" ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_stringify_b98c93d0a190446a = function() {
    return handleError(function(arg0) {
      const ret = JSON.stringify(arg0);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_subarray_70fd07feefe14294 = function(arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
  };
  imports.wbg.__wbg_target_f2c963b447be6283 = function(arg0) {
    const ret = arg0.target;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_then_b33a773d723afa3e = function(arg0, arg1, arg2) {
    const ret = arg0.then(arg1, arg2);
    return ret;
  };
  imports.wbg.__wbg_then_e22500defe16819f = function(arg0, arg1) {
    const ret = arg0.then(arg1);
    return ret;
  };
  imports.wbg.__wbg_toString_78df35411a4fd40c = function(arg0) {
    const ret = arg0.toString();
    return ret;
  };
  imports.wbg.__wbg_transaction_42140e08ae7013b5 = function(arg0) {
    const ret = arg0.transaction;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
  };
  imports.wbg.__wbg_transaction_e94a54f60797ce82 = function() {
    return handleError(function(arg0, arg1, arg2) {
      const ret = arg0.transaction(arg1, __wbindgen_enum_IdbTransactionMode[arg2]);
      return ret;
    }, arguments);
  };
  imports.wbg.__wbg_unique_aaacd391eee88edb = function(arg0) {
    const ret = arg0.unique;
    return ret;
  };
  imports.wbg.__wbg_value_dd9372230531eade = function(arg0) {
    const ret = arg0.value;
    return ret;
  };
  imports.wbg.__wbg_version_36bb3ddd830c5504 = function(arg0) {
    const ret = arg0.version;
    return ret;
  };
  imports.wbg.__wbg_versions_c71aa1626a93e0a1 = function(arg0) {
    const ret = arg0.versions;
    return ret;
  };
  imports.wbg.__wbg_wbindgenbigintgetasi64_ac743ece6ab9bba1 = function(arg0, arg1) {
    const v = arg1;
    const ret = typeof v === "bigint" ? v : undefined;
    getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
  };
  imports.wbg.__wbg_wbindgenbooleanget_3fe6f642c7d97746 = function(arg0) {
    const v = arg0;
    const ret = typeof v === "boolean" ? v : undefined;
    return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
  };
  imports.wbg.__wbg_wbindgencbdrop_eb10308566512b88 = function(arg0) {
    const obj = arg0.original;
    if (obj.cnt-- == 1) {
      obj.a = 0;
      return true;
    }
    const ret = false;
    return ret;
  };
  imports.wbg.__wbg_wbindgendebugstring_99ef257a3ddda34d = function(arg0, arg1) {
    const ret = debugString(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_wbindgenin_d7a1ee10933d2d55 = function(arg0, arg1) {
    const ret = arg0 in arg1;
    return ret;
  };
  imports.wbg.__wbg_wbindgenisbigint_ecb90cc08a5a9154 = function(arg0) {
    const ret = typeof arg0 === "bigint";
    return ret;
  };
  imports.wbg.__wbg_wbindgenisfunction_8cee7dce3725ae74 = function(arg0) {
    const ret = typeof arg0 === "function";
    return ret;
  };
  imports.wbg.__wbg_wbindgenisnull_f3037694abe4d97a = function(arg0) {
    const ret = arg0 === null;
    return ret;
  };
  imports.wbg.__wbg_wbindgenisobject_307a53c6bd97fbf8 = function(arg0) {
    const val = arg0;
    const ret = typeof val === "object" && val !== null;
    return ret;
  };
  imports.wbg.__wbg_wbindgenisstring_d4fa939789f003b0 = function(arg0) {
    const ret = typeof arg0 === "string";
    return ret;
  };
  imports.wbg.__wbg_wbindgenisundefined_c4b71d073b92f3c5 = function(arg0) {
    const ret = arg0 === undefined;
    return ret;
  };
  imports.wbg.__wbg_wbindgenjsvaleq_e6f2ad59ccae1b58 = function(arg0, arg1) {
    const ret = arg0 === arg1;
    return ret;
  };
  imports.wbg.__wbg_wbindgenjsvallooseeq_9bec8c9be826bed1 = function(arg0, arg1) {
    const ret = arg0 == arg1;
    return ret;
  };
  imports.wbg.__wbg_wbindgennumberget_f74b4c7525ac05cb = function(arg0, arg1) {
    const obj = arg1;
    const ret = typeof obj === "number" ? obj : undefined;
    getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
  };
  imports.wbg.__wbg_wbindgenstringget_0f16a6ddddef376f = function(arg0, arg1) {
    const obj = arg1;
    const ret = typeof obj === "string" ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
  };
  imports.wbg.__wbg_wbindgenthrow_451ec1a8469d7eb6 = function(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  };
  imports.wbg.__wbg_wbindgentryintonumber_aef53fe1d23c5fd4 = function(arg0) {
    let result;
    try {
      result = +arg0;
    } catch (e) {
      result = e;
    }
    const ret = result;
    return ret;
  };
  imports.wbg.__wbg_welcomebundle_new = function(arg0) {
    const ret = WelcomeBundle.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbg_wireidentity_new = function(arg0) {
    const ret = WireIdentity.__wrap(arg0);
    return ret;
  };
  imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
  };
  imports.wbg.__wbindgen_cast_25a0a844437d0e92 = function(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    const ret = v0;
    return ret;
  };
  imports.wbg.__wbindgen_cast_2e1c22bbccdbf7b5 = function(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    const ret = v0;
    return ret;
  };
  imports.wbg.__wbindgen_cast_4625c577ab2ec9ee = function(arg0) {
    const ret = BigInt.asUintN(64, arg0);
    return ret;
  };
  imports.wbg.__wbindgen_cast_48a7b66c2e868dde = function(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    const ret = v0;
    return ret;
  };
  imports.wbg.__wbindgen_cast_77ac86d8075f2f98 = function(arg0, arg1) {
    const ret = makeMutClosure(arg0, arg1, 1025, __wbg_adapter_27);
    return ret;
  };
  imports.wbg.__wbindgen_cast_77bc3e92745e9a35 = function(arg0, arg1) {
    var v0 = getArrayU8FromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 1, 1);
    const ret = v0;
    return ret;
  };
  imports.wbg.__wbindgen_cast_9366269b35ccbb69 = function(arg0, arg1) {
    const ret = makeMutClosure(arg0, arg1, 2905, __wbg_adapter_24);
    return ret;
  };
  imports.wbg.__wbindgen_cast_a834b411bd2663eb = function(arg0, arg1) {
    const ret = makeMutClosure(arg0, arg1, 2596, __wbg_adapter_30);
    return ret;
  };
  imports.wbg.__wbindgen_cast_b77aa29fa8fe8560 = function(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    const ret = v0;
    return ret;
  };
  imports.wbg.__wbindgen_cast_cb9088102bce6b30 = function(arg0, arg1) {
    const ret = getArrayU8FromWasm0(arg0, arg1);
    return ret;
  };
  imports.wbg.__wbindgen_cast_d6cd19b81560fd6e = function(arg0) {
    const ret = arg0;
    return ret;
  };
  imports.wbg.__wbindgen_init_externref_table = function() {
    const table = wasm.__wbindgen_export_4;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
  };
  return imports;
}
function __wbg_init_memory(imports, memory) {}
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  __wbg_init.__wbindgen_wasm_module = module;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}
async function __wbg_init(module_or_path) {
  if (wasm !== undefined)
    return wasm;
  if (typeof module_or_path !== "undefined") {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path } = module_or_path);
    } else {
      console.warn("using deprecated parameters for the initialization function; pass a single object instead");
    }
  }
  if (typeof module_or_path === "undefined") {
    module_or_path = new URL("core-crypto-ffi_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports();
  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
    module_or_path = fetch(module_or_path);
  }
  __wbg_init_memory(imports);
  const { instance, module } = await __wbg_load(await module_or_path, imports);
  return __wbg_finalize_init(instance, module);
}
var core_crypto_ffi_default = __wbg_init;

// src/Conversions.ts
function safeBigintToNumber(x) {
  if (x > BigInt(Number.MAX_SAFE_INTEGER) || x < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`"${x}" is too large to be safely contained in a JS number`);
  }
  return new Number(x).valueOf();
}
function safeBigIntOrUndefinedToNumberOrUndefined(x) {
  if (x === undefined || x === null) {
    return;
  }
  return safeBigintToNumber(x);
}

// src/CoreCryptoMLS.ts
function commitBundleFromFfi(commitBundle) {
  return {
    commit: commitBundle.commit,
    welcome: commitBundle.welcome,
    groupInfo: {
      encryptionType: commitBundle.group_info.encryption_type,
      ratchetTreeType: commitBundle.group_info.ratchet_tree_type,
      payload: commitBundle.group_info.payload
    },
    encryptedMessage: commitBundle.encryptedMessage
  };
}
function decryptedMessageFromFfi(m) {
  return {
    bufferedMessages: m.bufferedMessages?.map((msg) => bufferedDecryptedMessageFromFfi(msg)) ?? undefined,
    ...bufferedDecryptedMessageFromFfi(m)
  };
}
function bufferedDecryptedMessageFromFfi(m) {
  return {
    message: m.message,
    isActive: m.isActive,
    commitDelay: safeBigIntOrUndefinedToNumberOrUndefined(m.commitDelay),
    senderClientId: m.senderClientId,
    hasEpochChanged: m.hasEpochChanged,
    identity: m.identity,
    crlNewDistributionPoints: m.crlNewDistributionPoints
  };
}
function mapTransportResponseToFfi(response) {
  if (response === "success") {
    return new MlsTransportResponse(MlsTransportResponseVariant.Success);
  }
  if (response === "retry") {
    return new MlsTransportResponse(MlsTransportResponseVariant.Retry);
  }
  if (response?.abort?.reason !== undefined) {
    return new MlsTransportResponse(MlsTransportResponseVariant.Abort, response.abort.reason);
  }
  throw new Error(`Invalid MlsTransportResponse returned from callback: ${response}
         Not a member of the MlsTransportResponse type.`);
}

class MlsTransportFfiShim {
  inner;
  constructor(inner) {
    this.inner = inner;
  }
  async sendCommitBundle(commitBundle) {
    const cb = commitBundleFromFfi(commitBundle);
    const response = await this.inner.sendCommitBundle(cb);
    return mapTransportResponseToFfi(response);
  }
  async sendMessage(message) {
    const response = await this.inner.sendMessage(message);
    return mapTransportResponseToFfi(response);
  }
  async prepareForTransport(secret) {
    return await this.inner.prepareForTransport(secret);
  }
}
function mlsTransportToFfi(mlsTransport) {
  const shim = new MlsTransportFfiShim(mlsTransport);
  return new MlsTransport(shim, shim.sendCommitBundle, shim.sendMessage, shim.prepareForTransport);
}

// src/CoreCryptoE2EI.ts
function crlRegistrationFromFfi(r) {
  return {
    dirty: r.dirty,
    expiration: safeBigIntOrUndefinedToNumberOrUndefined(r.expiration)
  };
}
function normalizeEnum(enumType, value) {
  const enumAsString = enumType[value];
  const enumAsDiscriminant = enumType[enumAsString];
  return enumAsDiscriminant;
}

class E2eiEnrollment {
  #enrollment;
  constructor(e2ei) {
    this.#enrollment = e2ei;
  }
  free() {
    this.#enrollment.free();
  }
  inner() {
    return this.#enrollment;
  }
  async directoryResponse(directory) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.directory_response(directory));
  }
  async newAccountRequest(previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_account_request(previousNonce));
  }
  async newAccountResponse(account) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_account_response(account));
  }
  async newOrderRequest(previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_order_request(previousNonce));
  }
  async newOrderResponse(order) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_order_response(order));
  }
  async newAuthzRequest(url, previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_authz_request(url, previousNonce));
  }
  async newAuthzResponse(authz) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_authz_response(authz));
  }
  async createDpopToken(expirySecs, backendNonce) {
    const token = await CoreCryptoError.asyncMapErr(this.#enrollment.create_dpop_token(expirySecs, backendNonce));
    return new TextEncoder().encode(token);
  }
  async newDpopChallengeRequest(accessToken, previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_dpop_challenge_request(accessToken, previousNonce));
  }
  async newDpopChallengeResponse(challenge) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_dpop_challenge_response(challenge));
  }
  async newOidcChallengeRequest(idToken, previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_oidc_challenge_request(idToken, previousNonce));
  }
  async newOidcChallengeResponse(challenge) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.new_oidc_challenge_response(challenge));
  }
  async checkOrderRequest(orderUrl, previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.check_order_request(orderUrl, previousNonce));
  }
  async checkOrderResponse(order) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.check_order_response(order));
  }
  async finalizeRequest(previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.finalize_request(previousNonce));
  }
  async finalizeResponse(finalize) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.finalize_response(finalize));
  }
  async certificateRequest(previousNonce) {
    return await CoreCryptoError.asyncMapErr(this.#enrollment.certificate_request(previousNonce));
  }
}
var E2eiConversationState2;
((E2eiConversationState3) => {
  E2eiConversationState3[E2eiConversationState3["Verified"] = 1] = "Verified";
  E2eiConversationState3[E2eiConversationState3["NotVerified"] = 2] = "NotVerified";
  E2eiConversationState3[E2eiConversationState3["NotEnabled"] = 3] = "NotEnabled";
})(E2eiConversationState2 ||= {});

// src/ConversationConfiguration.ts
function conversationConfigurationToFfi(cc) {
  return new ConversationConfiguration(cc.ciphersuite, cc.externalSenders, cc.keyRotationSpan, cc.wirePolicy);
}

// src/CoreCryptoContext.ts
class CoreCryptoContext2 {
  #ctx;
  constructor(ctx) {
    this.#ctx = ctx;
  }
  static fromFfiContext(ctx) {
    return new CoreCryptoContext2(ctx);
  }
  async setData(data) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.set_data(data));
  }
  async getData() {
    return await CoreCryptoError.asyncMapErr(this.#ctx.get_data());
  }
  async mlsInit(clientId, ciphersuites, nbKeyPackage) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.mls_init(clientId, ciphersuites, nbKeyPackage));
  }
  async conversationExists(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.conversation_exists(conversationId));
  }
  async markConversationAsChildOf(childId, parentId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.mark_conversation_as_child_of(childId, parentId));
  }
  async conversationEpoch(conversationId) {
    const epoch = await CoreCryptoError.asyncMapErr(this.#ctx.conversation_epoch(conversationId));
    return safeBigintToNumber(epoch);
  }
  async conversationCiphersuite(conversationId) {
    const cs = await CoreCryptoError.asyncMapErr(this.#ctx.conversation_ciphersuite(conversationId));
    return cs;
  }
  async wipeConversation(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.wipe_conversation(conversationId));
  }
  async createConversation(conversationId, creatorCredentialType, configuration = {}) {
    const config = conversationConfigurationToFfi(configuration);
    return await CoreCryptoError.asyncMapErr(this.#ctx.create_conversation(conversationId, creatorCredentialType, config));
  }
  async decryptMessage(conversationId, payload) {
    if (!payload?.length) {
      throw new Error("decryptMessage payload is empty or null");
    }
    const ffiDecryptedMessage = await CoreCryptoError.asyncMapErr(this.#ctx.decrypt_message(conversationId, payload));
    return decryptedMessageFromFfi(ffiDecryptedMessage);
  }
  async encryptMessage(conversationId, message) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.encrypt_message(conversationId, message));
  }
  async processWelcomeMessage(welcomeMessage, configuration = {}) {
    const { keyRotationSpan, wirePolicy } = configuration || {};
    const config = new CustomConfiguration(keyRotationSpan, wirePolicy);
    return await CoreCryptoError.asyncMapErr(this.#ctx.process_welcome_message(welcomeMessage, config));
  }
  async clientPublicKey(ciphersuite, credentialType) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.client_public_key(ciphersuite, credentialType));
  }
  async clientValidKeypackagesCount(ciphersuite, credentialType) {
    const kpCount = await CoreCryptoError.asyncMapErr(this.#ctx.client_valid_keypackages_count(ciphersuite, credentialType));
    return safeBigintToNumber(kpCount);
  }
  async clientKeypackages(ciphersuite, credentialType, amountRequested) {
    const kps = await CoreCryptoError.asyncMapErr(this.#ctx.client_keypackages(ciphersuite, credentialType, amountRequested));
    return kps.map((kp) => kp.copyBytes());
  }
  async addClientsToConversation(conversationId, keyPackages) {
    const kps = keyPackages.map((bytes) => new KeyPackage(bytes));
    return await CoreCryptoError.asyncMapErr(this.#ctx.add_clients_to_conversation(conversationId, kps));
  }
  async removeClientsFromConversation(conversationId, clientIds) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.remove_clients_from_conversation(conversationId, clientIds));
  }
  async updateKeyingMaterial(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.update_keying_material(conversationId));
  }
  async commitPendingProposals(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.commit_pending_proposals(conversationId));
  }
  async joinByExternalCommit(groupInfo, credentialType, configuration = {}) {
    const { keyRotationSpan, wirePolicy } = configuration || {};
    const config = new CustomConfiguration(keyRotationSpan, wirePolicy);
    return await CoreCryptoError.asyncMapErr(this.#ctx.join_by_external_commit(groupInfo, config, credentialType));
  }
  async enableHistorySharing(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.enable_history_sharing(conversationId));
  }
  async disableHistorySharing(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.disable_history_sharing(conversationId));
  }
  async exportSecretKey(conversationId, keyLength) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.export_secret_key(conversationId, keyLength));
  }
  async getExternalSender(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.get_external_sender(conversationId));
  }
  async getClientIds(conversationId) {
    const ids = await CoreCryptoError.asyncMapErr(this.#ctx.get_client_ids(conversationId));
    return ids;
  }
  async randomBytes(length) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.random_bytes(length));
  }
  async proteusInit() {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_init());
  }
  async proteusSessionFromPrekey(sessionId, prekey) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_session_from_prekey(sessionId, prekey));
  }
  async proteusSessionFromMessage(sessionId, envelope) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_session_from_message(sessionId, envelope));
  }
  async proteusSessionSave(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_session_save(sessionId));
  }
  async proteusSessionDelete(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_session_delete(sessionId));
  }
  async proteusSessionExists(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_session_exists(sessionId));
  }
  async proteusDecrypt(sessionId, ciphertext) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_decrypt(sessionId, ciphertext));
  }
  async proteusEncrypt(sessionId, plaintext) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_encrypt(sessionId, plaintext));
  }
  async proteusEncryptBatched(sessions, plaintext) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_encrypt_batched(sessions, plaintext));
  }
  async proteusNewPrekey(prekeyId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_new_prekey(prekeyId));
  }
  async proteusNewPrekeyAuto() {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_new_prekey_auto());
  }
  async proteusLastResortPrekey() {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_last_resort_prekey());
  }
  static proteusLastResortPrekeyId() {
    return CoreCryptoContext.proteus_last_resort_prekey_id();
  }
  async proteusFingerprint() {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_fingerprint());
  }
  async proteusFingerprintLocal(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_fingerprint_local(sessionId));
  }
  async proteusFingerprintRemote(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.proteus_fingerprint_remote(sessionId));
  }
  static proteusFingerprintPrekeybundle(prekey) {
    try {
      return CoreCryptoContext.proteus_fingerprint_prekeybundle(prekey);
    } catch (e) {
      throw CoreCryptoError.fromStdError(e);
    }
  }
  async e2eiNewEnrollment(clientId, displayName, handle, expirySec, ciphersuite, team) {
    const e2ei = await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_new_enrollment(clientId, displayName, handle, team, expirySec, ciphersuite));
    return new E2eiEnrollment(e2ei);
  }
  async e2eiNewActivationEnrollment(displayName, handle, expirySec, ciphersuite, team) {
    const e2ei = await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_new_activation_enrollment(displayName, handle, team, expirySec, ciphersuite));
    return new E2eiEnrollment(e2ei);
  }
  async e2eiNewRotateEnrollment(expirySec, ciphersuite, displayName, handle, team) {
    const e2ei = await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_new_rotate_enrollment(displayName, handle, team, expirySec, ciphersuite));
    return new E2eiEnrollment(e2ei);
  }
  async e2eiMlsInitOnly(enrollment, certificateChain, nbKeyPackage) {
    return await this.#ctx.e2ei_mls_init_only(enrollment.inner(), certificateChain, nbKeyPackage);
  }
  async e2eiIsPKIEnvSetup() {
    return await this.#ctx.e2ei_is_pki_env_setup();
  }
  async e2eiRegisterAcmeCA(trustAnchorPEM) {
    return await this.#ctx.e2ei_register_acme_ca(trustAnchorPEM);
  }
  async e2eiRegisterIntermediateCA(certPEM) {
    return await this.#ctx.e2ei_register_intermediate_ca(certPEM);
  }
  async e2eiRegisterCRL(crlDP, crlDER) {
    const reg = await this.#ctx.e2ei_register_crl(crlDP, crlDER);
    return crlRegistrationFromFfi(reg);
  }
  async e2eiRotate(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_rotate(conversationId));
  }
  async saveX509Credential(enrollment, certificateChain) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.save_x509_credential(enrollment.inner(), certificateChain));
  }
  async deleteStaleKeyPackages(ciphersuite) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.delete_stale_key_packages(ciphersuite));
  }
  async e2eiEnrollmentStash(enrollment) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_enrollment_stash(enrollment.inner()));
  }
  async e2eiEnrollmentStashPop(handle) {
    const e2ei = await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_enrollment_stash_pop(handle));
    return new E2eiEnrollment(e2ei);
  }
  async e2eiConversationState(conversationId) {
    const state = await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_conversation_state(conversationId));
    return normalizeEnum(E2eiConversationState2, state);
  }
  async e2eiIsEnabled(ciphersuite) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.e2ei_is_enabled(ciphersuite));
  }
  async getDeviceIdentities(conversationId, deviceIds) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.get_device_identities(conversationId, deviceIds));
  }
  async getUserIdentities(conversationId, userIds) {
    return await CoreCryptoError.asyncMapErr(this.#ctx.get_user_identities(conversationId, userIds));
  }
}
// src/autogenerated/core-crypto-ffi.d.ts
class BuildMetadata2 {
  timestamp;
  cargoDebug;
  cargoFeatures;
  optLevel;
  targetTriple;
  gitBranch;
  gitDescribe;
  gitSha;
  gitDirty;
}
class WireIdentity4 {
  clientId;
  status;
  thumbprint;
  credentialType;
  x509Identity;
}

class X509Identity2 {
  handle;
  displayName;
  domain;
  certificate;
  serialNumber;
  notBefore;
  notAfter;
}
// src/CoreCryptoInstance.ts
class EpochObserverShim {
  inner;
  constructor(inner) {
    this.inner = inner;
  }
  async epochChanged(conversationId, epoch) {
    return this.inner.epochChanged(conversationId, safeBigintToNumber(epoch));
  }
}

class HistoryObserverShim {
  inner;
  constructor(inner) {
    this.inner = inner;
  }
  async historyClientCreated(conversationId, secret) {
    return this.inner.historyClientCreated(conversationId, secret);
  }
}
function historySecretIntoFfi(secret) {
  return new HistorySecret(secret.clientId, secret.data);
}
function setLogger(logger) {
  CoreCrypto.set_logger(loggerIntoFfi(logger));
}
function loggerIntoFfi(logger) {
  const logFn = logger.log;
  const logThis = logger;
  return new CoreCryptoLogger(logFn, logThis);
}
var CoreCryptoLogLevel2;
((CoreCryptoLogLevel3) => {
  CoreCryptoLogLevel3[CoreCryptoLogLevel3["Off"] = 1] = "Off";
  CoreCryptoLogLevel3[CoreCryptoLogLevel3["Trace"] = 2] = "Trace";
  CoreCryptoLogLevel3[CoreCryptoLogLevel3["Debug"] = 3] = "Debug";
  CoreCryptoLogLevel3[CoreCryptoLogLevel3["Info"] = 4] = "Info";
  CoreCryptoLogLevel3[CoreCryptoLogLevel3["Warn"] = 5] = "Warn";
  CoreCryptoLogLevel3[CoreCryptoLogLevel3["Error"] = 6] = "Error";
})(CoreCryptoLogLevel2 ||= {});
function setMaxLogLevel(level) {
  CoreCrypto2.setMaxLogLevel(level);
}
function buildMetadata() {
  return build_metadata();
}
function version2() {
  return version();
}

class CoreCrypto2 {
  #cc;
  inner() {
    return this.#cc;
  }
  static setLogger(logger) {
    CoreCrypto.set_logger(loggerIntoFfi(logger));
  }
  static setMaxLogLevel(level) {
    CoreCrypto.set_max_log_level(level);
  }
  static async init({
    databaseName,
    key,
    clientId,
    ciphersuites,
    entropySeed,
    nbKeyPackage
  }) {
    return new this(await CoreCryptoError.asyncMapErr(CoreCrypto.async_new(databaseName, key, clientId, ciphersuites, entropySeed, nbKeyPackage)));
  }
  static async deferredInit({
    databaseName,
    key,
    entropySeed
  }) {
    const cc = await CoreCryptoError.asyncMapErr(CoreCrypto.deferred_init(databaseName, key, entropySeed));
    return new this(cc);
  }
  static async historyClient(historySecret) {
    const cc = await CoreCryptoError.asyncMapErr(CoreCrypto.history_client(historySecretIntoFfi(historySecret)));
    return new this(cc);
  }
  async transaction(callback) {
    let result;
    let error = null;
    try {
      await CoreCryptoError.asyncMapErr(this.#cc.transaction({
        execute: async (ctx) => {
          try {
            result = await CoreCryptoError.asyncMapErr(callback(CoreCryptoContext2.fromFfiContext(ctx)));
          } catch (e) {
            error = e;
            throw error;
          }
        }
      }));
    } catch (e) {
      if (error === null) {
        error = e;
      }
    }
    if (error !== null) {
      throw error;
    }
    return result;
  }
  constructor(cc) {
    this.#cc = cc;
  }
  async close() {
    await CoreCryptoError.asyncMapErr(this.#cc.close());
  }
  async provideTransport(transportProvider, _ctx = null) {
    const transport = mlsTransportToFfi(transportProvider);
    return await CoreCryptoError.asyncMapErr(this.#cc.provide_transport(transport));
  }
  async conversationExists(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#cc.conversation_exists(conversationId));
  }
  async conversationEpoch(conversationId) {
    const epoch = await CoreCryptoError.asyncMapErr(this.#cc.conversation_epoch(conversationId));
    return safeBigintToNumber(epoch);
  }
  async conversationCiphersuite(conversationId) {
    const cs = await CoreCryptoError.asyncMapErr(this.#cc.conversation_ciphersuite(conversationId));
    return cs;
  }
  async clientPublicKey(ciphersuite, credentialType) {
    return await CoreCryptoError.asyncMapErr(this.#cc.client_public_key(ciphersuite, credentialType));
  }
  async exportSecretKey(conversationId, keyLength) {
    return await CoreCryptoError.asyncMapErr(this.#cc.export_secret_key(conversationId, keyLength));
  }
  async isHistorySharingEnabled(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#cc.is_history_sharing_enabled(conversationId));
  }
  async getExternalSender(conversationId) {
    return await CoreCryptoError.asyncMapErr(this.#cc.get_external_sender(conversationId));
  }
  async getClientIds(conversationId) {
    const cids = await CoreCryptoError.asyncMapErr(this.#cc.get_client_ids(conversationId));
    return cids;
  }
  async randomBytes(length) {
    return await CoreCryptoError.asyncMapErr(this.#cc.random_bytes(length));
  }
  async reseedRng(seed) {
    if (seed.length !== 32) {
      throw new Error(`The seed length needs to be exactly 32 bytes. ${seed.length} bytes provided.`);
    }
    return await CoreCryptoError.asyncMapErr(this.#cc.reseed_rng(seed));
  }
  async proteusSessionExists(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#cc.proteus_session_exists(sessionId));
  }
  static proteusLastResortPrekeyId() {
    return CoreCrypto.proteus_last_resort_prekey_id();
  }
  async proteusFingerprint() {
    return await CoreCryptoError.asyncMapErr(this.#cc.proteus_fingerprint());
  }
  async proteusFingerprintLocal(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#cc.proteus_fingerprint_local(sessionId));
  }
  async proteusFingerprintRemote(sessionId) {
    return await CoreCryptoError.asyncMapErr(this.#cc.proteus_fingerprint_remote(sessionId));
  }
  static proteusFingerprintPrekeybundle(prekey) {
    try {
      return CoreCrypto.proteus_fingerprint_prekeybundle(prekey);
    } catch (e) {
      throw CoreCryptoError.fromStdError(e);
    }
  }
  async e2eiIsPKIEnvSetup() {
    return await this.#cc.e2ei_is_pki_env_setup();
  }
  async e2eiIsEnabled(ciphersuite) {
    return await CoreCryptoError.asyncMapErr(this.#cc.e2ei_is_enabled(ciphersuite));
  }
  async getDeviceIdentities(conversationId, deviceIds) {
    return await CoreCryptoError.asyncMapErr(this.#cc.get_device_identities(conversationId, deviceIds));
  }
  async getUserIdentities(conversationId, userIds) {
    return await CoreCryptoError.asyncMapErr(this.#cc.get_user_identities(conversationId, userIds));
  }
  async registerEpochObserver(observer) {
    const shim = new EpochObserverShim(observer);
    const ffi = new EpochObserver(shim, shim.epochChanged);
    return await CoreCryptoError.asyncMapErr(this.#cc.register_epoch_observer(ffi));
  }
  async registerHistoryObserver(observer) {
    const shim = new HistoryObserverShim(observer);
    const ffi = new HistoryObserver(shim, shim.historyClientCreated);
    return await CoreCryptoError.asyncMapErr(this.#cc.register_history_observer(ffi));
  }
}
// src/CoreCrypto.ts
async function initWasmModule(location = undefined) {
  if (typeof window !== "undefined") {
    if (typeof location === "string") {
      const path = `${location}core-crypto-ffi_bg.wasm`;
      await core_crypto_ffi_default({ module_or_path: path });
    } else {
      await core_crypto_ffi_default({});
    }
  } else {
    const fs = await import("fs/promises");
    const path = new URL(`${location}core-crypto-ffi_bg.wasm`, import.meta.url);
    const file = await fs.open(path);
    const buffer = await file.readFile();
    const module = new WebAssembly.Module(new Uint8Array(buffer));
    await core_crypto_ffi_default({ module_or_path: module });
  }
}
export {
  version2 as version,
  updateDatabaseKey,
  setMaxLogLevel,
  setLogger,
  openDatabase,
  migrateDatabaseKeyTypeToBytes,
  isTransactionFailedError,
  isProteusSessionNotFoundError,
  isProteusRemoteIdentityChangedError,
  isProteusOtherError,
  isProteusError,
  isProteusDuplicateMessageError,
  isOtherError,
  isMlsWrongEpochError,
  isMlsUnmergedPendingGroupError,
  isMlsStaleProposalError,
  isMlsStaleCommitError,
  isMlsSelfCommitIgnoredError,
  isMlsOtherError,
  isMlsOrphanWelcomeError,
  isMlsMessageRejectedError,
  isMlsError,
  isMlsDuplicateMessageError,
  isMlsConversationAlreadyExistsError,
  isMlsBufferedFutureMessageError,
  isMlsBufferedCommitError,
  isE2eiError,
  isCcError,
  initWasmModule,
  ciphersuiteFromU16,
  ciphersuiteDefault,
  buildMetadata,
  X509Identity2 as X509Identity,
  WirePolicy,
  WireIdentity4 as WireIdentity,
  WelcomeBundle,
  Welcome,
  SecretKey,
  MlsRatchetTreeType as RatchetTreeType,
  ProteusErrorType,
  NewAcmeOrder,
  NewAcmeAuthz,
  MlsTransportData,
  MlsErrorType,
  MlsGroupInfoEncryptionType as GroupInfoEncryptionType,
  GroupInfo,
  ExternalSenderKey,
  ErrorType,
  E2eiEnrollment,
  E2eiConversationState2 as E2eiConversationState,
  DeviceStatus,
  DatabaseKey,
  Database,
  CustomConfiguration,
  CredentialType,
  CoreCryptoLogLevel2 as CoreCryptoLogLevel,
  CoreCryptoError,
  CoreCryptoContext2 as CoreCryptoContext,
  CoreCrypto2 as CoreCrypto,
  ConversationId,
  ClientId,
  Ciphersuite,
  BuildMetadata2 as BuildMetadata,
  AcmeChallenge
};
