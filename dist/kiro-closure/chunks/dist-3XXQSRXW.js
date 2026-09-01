import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  AjvJsonSchemaValidator,
  CallToolResultSchema,
  CompleteResultSchema,
  CreateMessageRequestSchema,
  CreateMessageResultSchema,
  CreateMessageResultWithToolsSchema,
  CreateTaskResultSchema,
  ElicitRequestSchema,
  ElicitResultSchema,
  EmptyResultSchema,
  ErrorCode,
  GetPromptResultSchema,
  InitializeResultSchema,
  JSONRPCMessageSchema,
  LATEST_PROTOCOL_VERSION,
  ListChangedOptionsBaseSchema,
  ListPromptsResultSchema,
  ListResourceTemplatesResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  McpError,
  NEVER,
  PromptListChangedNotificationSchema,
  Protocol,
  ReadBuffer,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  ToolListChangedNotificationSchema,
  ZodIssueCode,
  any,
  array,
  assertClientRequestTaskCapability,
  assertToolsCallTaskCapability,
  boolean,
  coerce_exports,
  external_exports,
  getLiteralValue,
  getObjectShape,
  isInitializedNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  literal,
  looseObject,
  mergeCapabilities,
  number,
  object,
  safeParse,
  serializeMessage,
  string,
  url
} from "./chunk-Z54RA65E.js";
import {
  launchDaemonDetached
} from "./chunk-GJG4GF5F.js";
import {
  __commonJS,
  __require,
  __toESM
} from "./chunk-GX475RD4.js";

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/umd/main.js
var require_main = __commonJS({
  "node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/umd/main.js"(exports2, module2) {
    (function(factory) {
      if (typeof module2 === "object" && typeof module2.exports === "object") {
        var v = factory(__require, exports2);
        if (v !== void 0) module2.exports = v;
      } else if (typeof define === "function" && define.amd) {
        define(["require", "exports", "./impl/format", "./impl/edit", "./impl/scanner", "./impl/parser"], factory);
      }
    })(function(require2, exports3) {
      "use strict";
      Object.defineProperty(exports3, "__esModule", { value: true });
      exports3.applyEdits = exports3.modify = exports3.format = exports3.printParseErrorCode = exports3.ParseErrorCode = exports3.stripComments = exports3.visit = exports3.getNodeValue = exports3.getNodePath = exports3.findNodeAtOffset = exports3.findNodeAtLocation = exports3.parseTree = exports3.parse = exports3.getLocation = exports3.SyntaxKind = exports3.ScanError = exports3.createScanner = void 0;
      const formatter = require2("./impl/format");
      const edit = require2("./impl/edit");
      const scanner = require2("./impl/scanner");
      const parser = require2("./impl/parser");
      exports3.createScanner = scanner.createScanner;
      var ScanError;
      (function(ScanError2) {
        ScanError2[ScanError2["None"] = 0] = "None";
        ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
        ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
        ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
        ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
        ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
        ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
      })(ScanError || (exports3.ScanError = ScanError = {}));
      var SyntaxKind;
      (function(SyntaxKind2) {
        SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
        SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
        SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
        SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
        SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
        SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
        SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
        SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
        SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
        SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
        SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
        SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
        SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
        SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
        SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
        SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
        SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
      })(SyntaxKind || (exports3.SyntaxKind = SyntaxKind = {}));
      exports3.getLocation = parser.getLocation;
      exports3.parse = parser.parse;
      exports3.parseTree = parser.parseTree;
      exports3.findNodeAtLocation = parser.findNodeAtLocation;
      exports3.findNodeAtOffset = parser.findNodeAtOffset;
      exports3.getNodePath = parser.getNodePath;
      exports3.getNodeValue = parser.getNodeValue;
      exports3.visit = parser.visit;
      exports3.stripComments = parser.stripComments;
      var ParseErrorCode;
      (function(ParseErrorCode2) {
        ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
        ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
        ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
        ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
        ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
        ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
        ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
        ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
        ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
        ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
        ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
        ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
        ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
        ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
        ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
        ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
      })(ParseErrorCode || (exports3.ParseErrorCode = ParseErrorCode = {}));
      function printParseErrorCode2(code) {
        switch (code) {
          case 1:
            return "InvalidSymbol";
          case 2:
            return "InvalidNumberFormat";
          case 3:
            return "PropertyNameExpected";
          case 4:
            return "ValueExpected";
          case 5:
            return "ColonExpected";
          case 6:
            return "CommaExpected";
          case 7:
            return "CloseBraceExpected";
          case 8:
            return "CloseBracketExpected";
          case 9:
            return "EndOfFileExpected";
          case 10:
            return "InvalidCommentToken";
          case 11:
            return "UnexpectedEndOfComment";
          case 12:
            return "UnexpectedEndOfString";
          case 13:
            return "UnexpectedEndOfNumber";
          case 14:
            return "InvalidUnicode";
          case 15:
            return "InvalidEscapeCharacter";
          case 16:
            return "InvalidCharacter";
        }
        return "<unknown ParseErrorCode>";
      }
      exports3.printParseErrorCode = printParseErrorCode2;
      function format(documentText, range, options) {
        return formatter.format(documentText, range, options);
      }
      exports3.format = format;
      function modify(text, path23, value, options) {
        return edit.setProperty(text, path23, value, options);
      }
      exports3.modify = modify;
      function applyEdits(text, edits) {
        let sortedEdits = edits.slice(0).sort((a, b) => {
          const diff = a.offset - b.offset;
          if (diff === 0) {
            return a.length - b.length;
          }
          return diff;
        });
        let lastModifiedOffset = text.length;
        for (let i = sortedEdits.length - 1; i >= 0; i--) {
          let e = sortedEdits[i];
          if (e.offset + e.length <= lastModifiedOffset) {
            text = edit.applyEdit(text, e);
          } else {
            throw new Error("Overlapping edit");
          }
          lastModifiedOffset = e.offset;
        }
        return text;
      }
      exports3.applyEdits = applyEdits;
    });
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/parser.js"(exports2, module2) {
    "use strict";
    var ParserEND = 1114112;
    var ParserError = class _ParserError extends Error {
      /* istanbul ignore next */
      constructor(msg, filename, linenumber) {
        super("[ParserError] " + msg, filename, linenumber);
        this.name = "ParserError";
        this.code = "ParserError";
        if (Error.captureStackTrace) Error.captureStackTrace(this, _ParserError);
      }
    };
    var State = class {
      constructor(parser) {
        this.parser = parser;
        this.buf = "";
        this.returned = null;
        this.result = null;
        this.resultTable = null;
        this.resultArr = null;
      }
    };
    var Parser = class {
      constructor() {
        this.pos = 0;
        this.col = 0;
        this.line = 0;
        this.obj = {};
        this.ctx = this.obj;
        this.stack = [];
        this._buf = "";
        this.char = null;
        this.ii = 0;
        this.state = new State(this.parseStart);
      }
      parse(str) {
        if (str.length === 0 || str.length == null) return;
        this._buf = String(str);
        this.ii = -1;
        this.char = -1;
        let getNext;
        while (getNext === false || this.nextChar()) {
          getNext = this.runOne();
        }
        this._buf = null;
      }
      nextChar() {
        if (this.char === 10) {
          ++this.line;
          this.col = -1;
        }
        ++this.ii;
        this.char = this._buf.codePointAt(this.ii);
        ++this.pos;
        ++this.col;
        return this.haveBuffer();
      }
      haveBuffer() {
        return this.ii < this._buf.length;
      }
      runOne() {
        return this.state.parser.call(this, this.state.returned);
      }
      finish() {
        this.char = ParserEND;
        let last;
        do {
          last = this.state.parser;
          this.runOne();
        } while (this.state.parser !== last);
        this.ctx = null;
        this.state = null;
        this._buf = null;
        return this.obj;
      }
      next(fn) {
        if (typeof fn !== "function") throw new ParserError("Tried to set state to non-existent state: " + JSON.stringify(fn));
        this.state.parser = fn;
      }
      goto(fn) {
        this.next(fn);
        return this.runOne();
      }
      call(fn, returnWith) {
        if (returnWith) this.next(returnWith);
        this.stack.push(this.state);
        this.state = new State(fn);
      }
      callNow(fn, returnWith) {
        this.call(fn, returnWith);
        return this.runOne();
      }
      return(value) {
        if (this.stack.length === 0) throw this.error(new ParserError("Stack underflow"));
        if (value === void 0) value = this.state.buf;
        this.state = this.stack.pop();
        this.state.returned = value;
      }
      returnNow(value) {
        this.return(value);
        return this.runOne();
      }
      consume() {
        if (this.char === ParserEND) throw this.error(new ParserError("Unexpected end-of-buffer"));
        this.state.buf += this._buf[this.ii];
      }
      error(err) {
        err.line = this.line;
        err.col = this.col;
        err.pos = this.pos;
        return err;
      }
      /* istanbul ignore next */
      parseStart() {
        throw new ParserError("Must declare a parseStart method");
      }
    };
    Parser.END = ParserEND;
    Parser.Error = ParserError;
    module2.exports = Parser;
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-datetime.js
var require_create_datetime = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-datetime.js"(exports2, module2) {
    "use strict";
    module2.exports = (value) => {
      const date = new Date(value);
      if (isNaN(date)) {
        throw new TypeError("Invalid Datetime");
      } else {
        return date;
      }
    };
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/format-num.js
var require_format_num = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/format-num.js"(exports2, module2) {
    "use strict";
    module2.exports = (d, num) => {
      num = String(num);
      while (num.length < d) num = "0" + num;
      return num;
    };
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-datetime-float.js
var require_create_datetime_float = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-datetime-float.js"(exports2, module2) {
    "use strict";
    var f = require_format_num();
    var FloatingDateTime = class extends Date {
      constructor(value) {
        super(value + "Z");
        this.isFloating = true;
      }
      toISOString() {
        const date = `${this.getUTCFullYear()}-${f(2, this.getUTCMonth() + 1)}-${f(2, this.getUTCDate())}`;
        const time = `${f(2, this.getUTCHours())}:${f(2, this.getUTCMinutes())}:${f(2, this.getUTCSeconds())}.${f(3, this.getUTCMilliseconds())}`;
        return `${date}T${time}`;
      }
    };
    module2.exports = (value) => {
      const date = new FloatingDateTime(value);
      if (isNaN(date)) {
        throw new TypeError("Invalid Datetime");
      } else {
        return date;
      }
    };
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-date.js
var require_create_date = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-date.js"(exports2, module2) {
    "use strict";
    var f = require_format_num();
    var DateTime = global.Date;
    var Date2 = class extends DateTime {
      constructor(value) {
        super(value);
        this.isDate = true;
      }
      toISOString() {
        return `${this.getUTCFullYear()}-${f(2, this.getUTCMonth() + 1)}-${f(2, this.getUTCDate())}`;
      }
    };
    module2.exports = (value) => {
      const date = new Date2(value);
      if (isNaN(date)) {
        throw new TypeError("Invalid Datetime");
      } else {
        return date;
      }
    };
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-time.js
var require_create_time = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/create-time.js"(exports2, module2) {
    "use strict";
    var f = require_format_num();
    var Time = class extends Date {
      constructor(value) {
        super(`0000-01-01T${value}Z`);
        this.isTime = true;
      }
      toISOString() {
        return `${f(2, this.getUTCHours())}:${f(2, this.getUTCMinutes())}:${f(2, this.getUTCSeconds())}.${f(3, this.getUTCMilliseconds())}`;
      }
    };
    module2.exports = (value) => {
      const date = new Time(value);
      if (isNaN(date)) {
        throw new TypeError("Invalid Datetime");
      } else {
        return date;
      }
    };
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/toml-parser.js
var require_toml_parser = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/lib/toml-parser.js"(exports, module) {
    "use strict";
    module.exports = makeParserClass(require_parser());
    module.exports.makeParserClass = makeParserClass;
    var TomlError = class _TomlError extends Error {
      constructor(msg) {
        super(msg);
        this.name = "TomlError";
        if (Error.captureStackTrace) Error.captureStackTrace(this, _TomlError);
        this.fromTOML = true;
        this.wrapped = null;
      }
    };
    TomlError.wrap = (err) => {
      const terr = new TomlError(err.message);
      terr.code = err.code;
      terr.wrapped = err;
      return terr;
    };
    module.exports.TomlError = TomlError;
    var createDateTime = require_create_datetime();
    var createDateTimeFloat = require_create_datetime_float();
    var createDate = require_create_date();
    var createTime = require_create_time();
    var CTRL_I = 9;
    var CTRL_J = 10;
    var CTRL_M = 13;
    var CTRL_CHAR_BOUNDARY = 31;
    var CHAR_SP = 32;
    var CHAR_QUOT = 34;
    var CHAR_NUM = 35;
    var CHAR_APOS = 39;
    var CHAR_PLUS = 43;
    var CHAR_COMMA = 44;
    var CHAR_HYPHEN = 45;
    var CHAR_PERIOD = 46;
    var CHAR_0 = 48;
    var CHAR_1 = 49;
    var CHAR_7 = 55;
    var CHAR_9 = 57;
    var CHAR_COLON = 58;
    var CHAR_EQUALS = 61;
    var CHAR_A = 65;
    var CHAR_E = 69;
    var CHAR_F = 70;
    var CHAR_T = 84;
    var CHAR_U = 85;
    var CHAR_Z = 90;
    var CHAR_LOWBAR = 95;
    var CHAR_a = 97;
    var CHAR_b = 98;
    var CHAR_e = 101;
    var CHAR_f = 102;
    var CHAR_i = 105;
    var CHAR_l = 108;
    var CHAR_n = 110;
    var CHAR_o = 111;
    var CHAR_r = 114;
    var CHAR_s = 115;
    var CHAR_t = 116;
    var CHAR_u = 117;
    var CHAR_x = 120;
    var CHAR_z = 122;
    var CHAR_LCUB = 123;
    var CHAR_RCUB = 125;
    var CHAR_LSQB = 91;
    var CHAR_BSOL = 92;
    var CHAR_RSQB = 93;
    var CHAR_DEL = 127;
    var SURROGATE_FIRST = 55296;
    var SURROGATE_LAST = 57343;
    var escapes = {
      [CHAR_b]: "\b",
      [CHAR_t]: "	",
      [CHAR_n]: "\n",
      [CHAR_f]: "\f",
      [CHAR_r]: "\r",
      [CHAR_QUOT]: '"',
      [CHAR_BSOL]: "\\"
    };
    function isDigit(cp) {
      return cp >= CHAR_0 && cp <= CHAR_9;
    }
    function isHexit(cp) {
      return cp >= CHAR_A && cp <= CHAR_F || cp >= CHAR_a && cp <= CHAR_f || cp >= CHAR_0 && cp <= CHAR_9;
    }
    function isBit(cp) {
      return cp === CHAR_1 || cp === CHAR_0;
    }
    function isOctit(cp) {
      return cp >= CHAR_0 && cp <= CHAR_7;
    }
    function isAlphaNumQuoteHyphen(cp) {
      return cp >= CHAR_A && cp <= CHAR_Z || cp >= CHAR_a && cp <= CHAR_z || cp >= CHAR_0 && cp <= CHAR_9 || cp === CHAR_APOS || cp === CHAR_QUOT || cp === CHAR_LOWBAR || cp === CHAR_HYPHEN;
    }
    function isAlphaNumHyphen(cp) {
      return cp >= CHAR_A && cp <= CHAR_Z || cp >= CHAR_a && cp <= CHAR_z || cp >= CHAR_0 && cp <= CHAR_9 || cp === CHAR_LOWBAR || cp === CHAR_HYPHEN;
    }
    var _type = Symbol("type");
    var _declared = Symbol("declared");
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    var defineProperty = Object.defineProperty;
    var descriptor = { configurable: true, enumerable: true, writable: true, value: void 0 };
    function hasKey(obj, key) {
      if (hasOwnProperty.call(obj, key)) return true;
      if (key === "__proto__") defineProperty(obj, "__proto__", descriptor);
      return false;
    }
    var INLINE_TABLE = Symbol("inline-table");
    function InlineTable() {
      return Object.defineProperties({}, {
        [_type]: { value: INLINE_TABLE }
      });
    }
    function isInlineTable(obj) {
      if (obj === null || typeof obj !== "object") return false;
      return obj[_type] === INLINE_TABLE;
    }
    var TABLE = Symbol("table");
    function Table() {
      return Object.defineProperties({}, {
        [_type]: { value: TABLE },
        [_declared]: { value: false, writable: true }
      });
    }
    function isTable(obj) {
      if (obj === null || typeof obj !== "object") return false;
      return obj[_type] === TABLE;
    }
    var _contentType = Symbol("content-type");
    var INLINE_LIST = Symbol("inline-list");
    function InlineList(type) {
      return Object.defineProperties([], {
        [_type]: { value: INLINE_LIST },
        [_contentType]: { value: type }
      });
    }
    function isInlineList(obj) {
      if (obj === null || typeof obj !== "object") return false;
      return obj[_type] === INLINE_LIST;
    }
    var LIST = Symbol("list");
    function List() {
      return Object.defineProperties([], {
        [_type]: { value: LIST }
      });
    }
    function isList(obj) {
      if (obj === null || typeof obj !== "object") return false;
      return obj[_type] === LIST;
    }
    var _custom;
    try {
      const utilInspect = eval("require('util').inspect");
      _custom = utilInspect.custom;
    } catch (_) {
    }
    var _inspect = _custom || "inspect";
    var BoxedBigInt = class {
      constructor(value) {
        try {
          this.value = global.BigInt.asIntN(64, value);
        } catch (_) {
          this.value = null;
        }
        Object.defineProperty(this, _type, { value: INTEGER });
      }
      isNaN() {
        return this.value === null;
      }
      /* istanbul ignore next */
      toString() {
        return String(this.value);
      }
      /* istanbul ignore next */
      [_inspect]() {
        return `[BigInt: ${this.toString()}]}`;
      }
      valueOf() {
        return this.value;
      }
    };
    var INTEGER = Symbol("integer");
    function Integer(value) {
      let num = Number(value);
      if (Object.is(num, -0)) num = 0;
      if (global.BigInt && !Number.isSafeInteger(num)) {
        return new BoxedBigInt(value);
      } else {
        return Object.defineProperties(new Number(num), {
          isNaN: { value: function() {
            return isNaN(this);
          } },
          [_type]: { value: INTEGER },
          [_inspect]: { value: () => `[Integer: ${value}]` }
        });
      }
    }
    function isInteger(obj) {
      if (obj === null || typeof obj !== "object") return false;
      return obj[_type] === INTEGER;
    }
    var FLOAT = Symbol("float");
    function Float(value) {
      return Object.defineProperties(new Number(value), {
        [_type]: { value: FLOAT },
        [_inspect]: { value: () => `[Float: ${value}]` }
      });
    }
    function isFloat(obj) {
      if (obj === null || typeof obj !== "object") return false;
      return obj[_type] === FLOAT;
    }
    function tomlType(value) {
      const type = typeof value;
      if (type === "object") {
        if (value === null) return "null";
        if (value instanceof Date) return "datetime";
        if (_type in value) {
          switch (value[_type]) {
            case INLINE_TABLE:
              return "inline-table";
            case INLINE_LIST:
              return "inline-list";
            /* istanbul ignore next */
            case TABLE:
              return "table";
            /* istanbul ignore next */
            case LIST:
              return "list";
            case FLOAT:
              return "float";
            case INTEGER:
              return "integer";
          }
        }
      }
      return type;
    }
    function makeParserClass(Parser) {
      class TOMLParser extends Parser {
        constructor() {
          super();
          this.ctx = this.obj = Table();
        }
        /* MATCH HELPER */
        atEndOfWord() {
          return this.char === CHAR_NUM || this.char === CTRL_I || this.char === CHAR_SP || this.atEndOfLine();
        }
        atEndOfLine() {
          return this.char === Parser.END || this.char === CTRL_J || this.char === CTRL_M;
        }
        parseStart() {
          if (this.char === Parser.END) {
            return null;
          } else if (this.char === CHAR_LSQB) {
            return this.call(this.parseTableOrList);
          } else if (this.char === CHAR_NUM) {
            return this.call(this.parseComment);
          } else if (this.char === CTRL_J || this.char === CHAR_SP || this.char === CTRL_I || this.char === CTRL_M) {
            return null;
          } else if (isAlphaNumQuoteHyphen(this.char)) {
            return this.callNow(this.parseAssignStatement);
          } else {
            throw this.error(new TomlError(`Unknown character "${this.char}"`));
          }
        }
        // HELPER, this strips any whitespace and comments to the end of the line
        // then RETURNS. Last state in a production.
        parseWhitespaceToEOL() {
          if (this.char === CHAR_SP || this.char === CTRL_I || this.char === CTRL_M) {
            return null;
          } else if (this.char === CHAR_NUM) {
            return this.goto(this.parseComment);
          } else if (this.char === Parser.END || this.char === CTRL_J) {
            return this.return();
          } else {
            throw this.error(new TomlError("Unexpected character, expected only whitespace or comments till end of line"));
          }
        }
        /* ASSIGNMENT: key = value */
        parseAssignStatement() {
          return this.callNow(this.parseAssign, this.recordAssignStatement);
        }
        recordAssignStatement(kv) {
          let target = this.ctx;
          let finalKey = kv.key.pop();
          for (let kw of kv.key) {
            if (hasKey(target, kw) && (!isTable(target[kw]) || target[kw][_declared])) {
              throw this.error(new TomlError("Can't redefine existing key"));
            }
            target = target[kw] = target[kw] || Table();
          }
          if (hasKey(target, finalKey)) {
            throw this.error(new TomlError("Can't redefine existing key"));
          }
          if (isInteger(kv.value) || isFloat(kv.value)) {
            target[finalKey] = kv.value.valueOf();
          } else {
            target[finalKey] = kv.value;
          }
          return this.goto(this.parseWhitespaceToEOL);
        }
        /* ASSSIGNMENT expression, key = value possibly inside an inline table */
        parseAssign() {
          return this.callNow(this.parseKeyword, this.recordAssignKeyword);
        }
        recordAssignKeyword(key) {
          if (this.state.resultTable) {
            this.state.resultTable.push(key);
          } else {
            this.state.resultTable = [key];
          }
          return this.goto(this.parseAssignKeywordPreDot);
        }
        parseAssignKeywordPreDot() {
          if (this.char === CHAR_PERIOD) {
            return this.next(this.parseAssignKeywordPostDot);
          } else if (this.char !== CHAR_SP && this.char !== CTRL_I) {
            return this.goto(this.parseAssignEqual);
          }
        }
        parseAssignKeywordPostDot() {
          if (this.char !== CHAR_SP && this.char !== CTRL_I) {
            return this.callNow(this.parseKeyword, this.recordAssignKeyword);
          }
        }
        parseAssignEqual() {
          if (this.char === CHAR_EQUALS) {
            return this.next(this.parseAssignPreValue);
          } else {
            throw this.error(new TomlError('Invalid character, expected "="'));
          }
        }
        parseAssignPreValue() {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else {
            return this.callNow(this.parseValue, this.recordAssignValue);
          }
        }
        recordAssignValue(value) {
          return this.returnNow({ key: this.state.resultTable, value });
        }
        /* COMMENTS: #...eol */
        parseComment() {
          do {
            if (this.char === Parser.END || this.char === CTRL_J) {
              return this.return();
            }
          } while (this.nextChar());
        }
        /* TABLES AND LISTS, [foo] and [[foo]] */
        parseTableOrList() {
          if (this.char === CHAR_LSQB) {
            this.next(this.parseList);
          } else {
            return this.goto(this.parseTable);
          }
        }
        /* TABLE [foo.bar.baz] */
        parseTable() {
          this.ctx = this.obj;
          return this.goto(this.parseTableNext);
        }
        parseTableNext() {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else {
            return this.callNow(this.parseKeyword, this.parseTableMore);
          }
        }
        parseTableMore(keyword) {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else if (this.char === CHAR_RSQB) {
            if (hasKey(this.ctx, keyword) && (!isTable(this.ctx[keyword]) || this.ctx[keyword][_declared])) {
              throw this.error(new TomlError("Can't redefine existing key"));
            } else {
              this.ctx = this.ctx[keyword] = this.ctx[keyword] || Table();
              this.ctx[_declared] = true;
            }
            return this.next(this.parseWhitespaceToEOL);
          } else if (this.char === CHAR_PERIOD) {
            if (!hasKey(this.ctx, keyword)) {
              this.ctx = this.ctx[keyword] = Table();
            } else if (isTable(this.ctx[keyword])) {
              this.ctx = this.ctx[keyword];
            } else if (isList(this.ctx[keyword])) {
              this.ctx = this.ctx[keyword][this.ctx[keyword].length - 1];
            } else {
              throw this.error(new TomlError("Can't redefine existing key"));
            }
            return this.next(this.parseTableNext);
          } else {
            throw this.error(new TomlError("Unexpected character, expected whitespace, . or ]"));
          }
        }
        /* LIST [[a.b.c]] */
        parseList() {
          this.ctx = this.obj;
          return this.goto(this.parseListNext);
        }
        parseListNext() {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else {
            return this.callNow(this.parseKeyword, this.parseListMore);
          }
        }
        parseListMore(keyword) {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else if (this.char === CHAR_RSQB) {
            if (!hasKey(this.ctx, keyword)) {
              this.ctx[keyword] = List();
            }
            if (isInlineList(this.ctx[keyword])) {
              throw this.error(new TomlError("Can't extend an inline array"));
            } else if (isList(this.ctx[keyword])) {
              const next = Table();
              this.ctx[keyword].push(next);
              this.ctx = next;
            } else {
              throw this.error(new TomlError("Can't redefine an existing key"));
            }
            return this.next(this.parseListEnd);
          } else if (this.char === CHAR_PERIOD) {
            if (!hasKey(this.ctx, keyword)) {
              this.ctx = this.ctx[keyword] = Table();
            } else if (isInlineList(this.ctx[keyword])) {
              throw this.error(new TomlError("Can't extend an inline array"));
            } else if (isInlineTable(this.ctx[keyword])) {
              throw this.error(new TomlError("Can't extend an inline table"));
            } else if (isList(this.ctx[keyword])) {
              this.ctx = this.ctx[keyword][this.ctx[keyword].length - 1];
            } else if (isTable(this.ctx[keyword])) {
              this.ctx = this.ctx[keyword];
            } else {
              throw this.error(new TomlError("Can't redefine an existing key"));
            }
            return this.next(this.parseListNext);
          } else {
            throw this.error(new TomlError("Unexpected character, expected whitespace, . or ]"));
          }
        }
        parseListEnd(keyword) {
          if (this.char === CHAR_RSQB) {
            return this.next(this.parseWhitespaceToEOL);
          } else {
            throw this.error(new TomlError("Unexpected character, expected whitespace, . or ]"));
          }
        }
        /* VALUE string, number, boolean, inline list, inline object */
        parseValue() {
          if (this.char === Parser.END) {
            throw this.error(new TomlError("Key without value"));
          } else if (this.char === CHAR_QUOT) {
            return this.next(this.parseDoubleString);
          }
          if (this.char === CHAR_APOS) {
            return this.next(this.parseSingleString);
          } else if (this.char === CHAR_HYPHEN || this.char === CHAR_PLUS) {
            return this.goto(this.parseNumberSign);
          } else if (this.char === CHAR_i) {
            return this.next(this.parseInf);
          } else if (this.char === CHAR_n) {
            return this.next(this.parseNan);
          } else if (isDigit(this.char)) {
            return this.goto(this.parseNumberOrDateTime);
          } else if (this.char === CHAR_t || this.char === CHAR_f) {
            return this.goto(this.parseBoolean);
          } else if (this.char === CHAR_LSQB) {
            return this.call(this.parseInlineList, this.recordValue);
          } else if (this.char === CHAR_LCUB) {
            return this.call(this.parseInlineTable, this.recordValue);
          } else {
            throw this.error(new TomlError("Unexpected character, expecting string, number, datetime, boolean, inline array or inline table"));
          }
        }
        recordValue(value) {
          return this.returnNow(value);
        }
        parseInf() {
          if (this.char === CHAR_n) {
            return this.next(this.parseInf2);
          } else {
            throw this.error(new TomlError('Unexpected character, expected "inf", "+inf" or "-inf"'));
          }
        }
        parseInf2() {
          if (this.char === CHAR_f) {
            if (this.state.buf === "-") {
              return this.return(-Infinity);
            } else {
              return this.return(Infinity);
            }
          } else {
            throw this.error(new TomlError('Unexpected character, expected "inf", "+inf" or "-inf"'));
          }
        }
        parseNan() {
          if (this.char === CHAR_a) {
            return this.next(this.parseNan2);
          } else {
            throw this.error(new TomlError('Unexpected character, expected "nan"'));
          }
        }
        parseNan2() {
          if (this.char === CHAR_n) {
            return this.return(NaN);
          } else {
            throw this.error(new TomlError('Unexpected character, expected "nan"'));
          }
        }
        /* KEYS, barewords or basic, literal, or dotted */
        parseKeyword() {
          if (this.char === CHAR_QUOT) {
            return this.next(this.parseBasicString);
          } else if (this.char === CHAR_APOS) {
            return this.next(this.parseLiteralString);
          } else {
            return this.goto(this.parseBareKey);
          }
        }
        /* KEYS: barewords */
        parseBareKey() {
          do {
            if (this.char === Parser.END) {
              throw this.error(new TomlError("Key ended without value"));
            } else if (isAlphaNumHyphen(this.char)) {
              this.consume();
            } else if (this.state.buf.length === 0) {
              throw this.error(new TomlError("Empty bare keys are not allowed"));
            } else {
              return this.returnNow();
            }
          } while (this.nextChar());
        }
        /* STRINGS, single quoted (literal) */
        parseSingleString() {
          if (this.char === CHAR_APOS) {
            return this.next(this.parseLiteralMultiStringMaybe);
          } else {
            return this.goto(this.parseLiteralString);
          }
        }
        parseLiteralString() {
          do {
            if (this.char === CHAR_APOS) {
              return this.return();
            } else if (this.atEndOfLine()) {
              throw this.error(new TomlError("Unterminated string"));
            } else if (this.char === CHAR_DEL || this.char <= CTRL_CHAR_BOUNDARY && this.char !== CTRL_I) {
              throw this.errorControlCharInString();
            } else {
              this.consume();
            }
          } while (this.nextChar());
        }
        parseLiteralMultiStringMaybe() {
          if (this.char === CHAR_APOS) {
            return this.next(this.parseLiteralMultiString);
          } else {
            return this.returnNow();
          }
        }
        parseLiteralMultiString() {
          if (this.char === CTRL_M) {
            return null;
          } else if (this.char === CTRL_J) {
            return this.next(this.parseLiteralMultiStringContent);
          } else {
            return this.goto(this.parseLiteralMultiStringContent);
          }
        }
        parseLiteralMultiStringContent() {
          do {
            if (this.char === CHAR_APOS) {
              return this.next(this.parseLiteralMultiEnd);
            } else if (this.char === Parser.END) {
              throw this.error(new TomlError("Unterminated multi-line string"));
            } else if (this.char === CHAR_DEL || this.char <= CTRL_CHAR_BOUNDARY && this.char !== CTRL_I && this.char !== CTRL_J && this.char !== CTRL_M) {
              throw this.errorControlCharInString();
            } else {
              this.consume();
            }
          } while (this.nextChar());
        }
        parseLiteralMultiEnd() {
          if (this.char === CHAR_APOS) {
            return this.next(this.parseLiteralMultiEnd2);
          } else {
            this.state.buf += "'";
            return this.goto(this.parseLiteralMultiStringContent);
          }
        }
        parseLiteralMultiEnd2() {
          if (this.char === CHAR_APOS) {
            return this.return();
          } else {
            this.state.buf += "''";
            return this.goto(this.parseLiteralMultiStringContent);
          }
        }
        /* STRINGS double quoted */
        parseDoubleString() {
          if (this.char === CHAR_QUOT) {
            return this.next(this.parseMultiStringMaybe);
          } else {
            return this.goto(this.parseBasicString);
          }
        }
        parseBasicString() {
          do {
            if (this.char === CHAR_BSOL) {
              return this.call(this.parseEscape, this.recordEscapeReplacement);
            } else if (this.char === CHAR_QUOT) {
              return this.return();
            } else if (this.atEndOfLine()) {
              throw this.error(new TomlError("Unterminated string"));
            } else if (this.char === CHAR_DEL || this.char <= CTRL_CHAR_BOUNDARY && this.char !== CTRL_I) {
              throw this.errorControlCharInString();
            } else {
              this.consume();
            }
          } while (this.nextChar());
        }
        recordEscapeReplacement(replacement) {
          this.state.buf += replacement;
          return this.goto(this.parseBasicString);
        }
        parseMultiStringMaybe() {
          if (this.char === CHAR_QUOT) {
            return this.next(this.parseMultiString);
          } else {
            return this.returnNow();
          }
        }
        parseMultiString() {
          if (this.char === CTRL_M) {
            return null;
          } else if (this.char === CTRL_J) {
            return this.next(this.parseMultiStringContent);
          } else {
            return this.goto(this.parseMultiStringContent);
          }
        }
        parseMultiStringContent() {
          do {
            if (this.char === CHAR_BSOL) {
              return this.call(this.parseMultiEscape, this.recordMultiEscapeReplacement);
            } else if (this.char === CHAR_QUOT) {
              return this.next(this.parseMultiEnd);
            } else if (this.char === Parser.END) {
              throw this.error(new TomlError("Unterminated multi-line string"));
            } else if (this.char === CHAR_DEL || this.char <= CTRL_CHAR_BOUNDARY && this.char !== CTRL_I && this.char !== CTRL_J && this.char !== CTRL_M) {
              throw this.errorControlCharInString();
            } else {
              this.consume();
            }
          } while (this.nextChar());
        }
        errorControlCharInString() {
          let displayCode = "\\u00";
          if (this.char < 16) {
            displayCode += "0";
          }
          displayCode += this.char.toString(16);
          return this.error(new TomlError(`Control characters (codes < 0x1f and 0x7f) are not allowed in strings, use ${displayCode} instead`));
        }
        recordMultiEscapeReplacement(replacement) {
          this.state.buf += replacement;
          return this.goto(this.parseMultiStringContent);
        }
        parseMultiEnd() {
          if (this.char === CHAR_QUOT) {
            return this.next(this.parseMultiEnd2);
          } else {
            this.state.buf += '"';
            return this.goto(this.parseMultiStringContent);
          }
        }
        parseMultiEnd2() {
          if (this.char === CHAR_QUOT) {
            return this.return();
          } else {
            this.state.buf += '""';
            return this.goto(this.parseMultiStringContent);
          }
        }
        parseMultiEscape() {
          if (this.char === CTRL_M || this.char === CTRL_J) {
            return this.next(this.parseMultiTrim);
          } else if (this.char === CHAR_SP || this.char === CTRL_I) {
            return this.next(this.parsePreMultiTrim);
          } else {
            return this.goto(this.parseEscape);
          }
        }
        parsePreMultiTrim() {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else if (this.char === CTRL_M || this.char === CTRL_J) {
            return this.next(this.parseMultiTrim);
          } else {
            throw this.error(new TomlError("Can't escape whitespace"));
          }
        }
        parseMultiTrim() {
          if (this.char === CTRL_J || this.char === CHAR_SP || this.char === CTRL_I || this.char === CTRL_M) {
            return null;
          } else {
            return this.returnNow();
          }
        }
        parseEscape() {
          if (this.char in escapes) {
            return this.return(escapes[this.char]);
          } else if (this.char === CHAR_u) {
            return this.call(this.parseSmallUnicode, this.parseUnicodeReturn);
          } else if (this.char === CHAR_U) {
            return this.call(this.parseLargeUnicode, this.parseUnicodeReturn);
          } else {
            throw this.error(new TomlError("Unknown escape character: " + this.char));
          }
        }
        parseUnicodeReturn(char) {
          try {
            const codePoint = parseInt(char, 16);
            if (codePoint >= SURROGATE_FIRST && codePoint <= SURROGATE_LAST) {
              throw this.error(new TomlError("Invalid unicode, character in range 0xD800 - 0xDFFF is reserved"));
            }
            return this.returnNow(String.fromCodePoint(codePoint));
          } catch (err) {
            throw this.error(TomlError.wrap(err));
          }
        }
        parseSmallUnicode() {
          if (!isHexit(this.char)) {
            throw this.error(new TomlError("Invalid character in unicode sequence, expected hex"));
          } else {
            this.consume();
            if (this.state.buf.length >= 4) return this.return();
          }
        }
        parseLargeUnicode() {
          if (!isHexit(this.char)) {
            throw this.error(new TomlError("Invalid character in unicode sequence, expected hex"));
          } else {
            this.consume();
            if (this.state.buf.length >= 8) return this.return();
          }
        }
        /* NUMBERS */
        parseNumberSign() {
          this.consume();
          return this.next(this.parseMaybeSignedInfOrNan);
        }
        parseMaybeSignedInfOrNan() {
          if (this.char === CHAR_i) {
            return this.next(this.parseInf);
          } else if (this.char === CHAR_n) {
            return this.next(this.parseNan);
          } else {
            return this.callNow(this.parseNoUnder, this.parseNumberIntegerStart);
          }
        }
        parseNumberIntegerStart() {
          if (this.char === CHAR_0) {
            this.consume();
            return this.next(this.parseNumberIntegerExponentOrDecimal);
          } else {
            return this.goto(this.parseNumberInteger);
          }
        }
        parseNumberIntegerExponentOrDecimal() {
          if (this.char === CHAR_PERIOD) {
            this.consume();
            return this.call(this.parseNoUnder, this.parseNumberFloat);
          } else if (this.char === CHAR_E || this.char === CHAR_e) {
            this.consume();
            return this.next(this.parseNumberExponentSign);
          } else {
            return this.returnNow(Integer(this.state.buf));
          }
        }
        parseNumberInteger() {
          if (isDigit(this.char)) {
            this.consume();
          } else if (this.char === CHAR_LOWBAR) {
            return this.call(this.parseNoUnder);
          } else if (this.char === CHAR_E || this.char === CHAR_e) {
            this.consume();
            return this.next(this.parseNumberExponentSign);
          } else if (this.char === CHAR_PERIOD) {
            this.consume();
            return this.call(this.parseNoUnder, this.parseNumberFloat);
          } else {
            const result = Integer(this.state.buf);
            if (result.isNaN()) {
              throw this.error(new TomlError("Invalid number"));
            } else {
              return this.returnNow(result);
            }
          }
        }
        parseNoUnder() {
          if (this.char === CHAR_LOWBAR || this.char === CHAR_PERIOD || this.char === CHAR_E || this.char === CHAR_e) {
            throw this.error(new TomlError("Unexpected character, expected digit"));
          } else if (this.atEndOfWord()) {
            throw this.error(new TomlError("Incomplete number"));
          }
          return this.returnNow();
        }
        parseNoUnderHexOctBinLiteral() {
          if (this.char === CHAR_LOWBAR || this.char === CHAR_PERIOD) {
            throw this.error(new TomlError("Unexpected character, expected digit"));
          } else if (this.atEndOfWord()) {
            throw this.error(new TomlError("Incomplete number"));
          }
          return this.returnNow();
        }
        parseNumberFloat() {
          if (this.char === CHAR_LOWBAR) {
            return this.call(this.parseNoUnder, this.parseNumberFloat);
          } else if (isDigit(this.char)) {
            this.consume();
          } else if (this.char === CHAR_E || this.char === CHAR_e) {
            this.consume();
            return this.next(this.parseNumberExponentSign);
          } else {
            return this.returnNow(Float(this.state.buf));
          }
        }
        parseNumberExponentSign() {
          if (isDigit(this.char)) {
            return this.goto(this.parseNumberExponent);
          } else if (this.char === CHAR_HYPHEN || this.char === CHAR_PLUS) {
            this.consume();
            this.call(this.parseNoUnder, this.parseNumberExponent);
          } else {
            throw this.error(new TomlError("Unexpected character, expected -, + or digit"));
          }
        }
        parseNumberExponent() {
          if (isDigit(this.char)) {
            this.consume();
          } else if (this.char === CHAR_LOWBAR) {
            return this.call(this.parseNoUnder);
          } else {
            return this.returnNow(Float(this.state.buf));
          }
        }
        /* NUMBERS or DATETIMES  */
        parseNumberOrDateTime() {
          if (this.char === CHAR_0) {
            this.consume();
            return this.next(this.parseNumberBaseOrDateTime);
          } else {
            return this.goto(this.parseNumberOrDateTimeOnly);
          }
        }
        parseNumberOrDateTimeOnly() {
          if (this.char === CHAR_LOWBAR) {
            return this.call(this.parseNoUnder, this.parseNumberInteger);
          } else if (isDigit(this.char)) {
            this.consume();
            if (this.state.buf.length > 4) this.next(this.parseNumberInteger);
          } else if (this.char === CHAR_E || this.char === CHAR_e) {
            this.consume();
            return this.next(this.parseNumberExponentSign);
          } else if (this.char === CHAR_PERIOD) {
            this.consume();
            return this.call(this.parseNoUnder, this.parseNumberFloat);
          } else if (this.char === CHAR_HYPHEN) {
            return this.goto(this.parseDateTime);
          } else if (this.char === CHAR_COLON) {
            return this.goto(this.parseOnlyTimeHour);
          } else {
            return this.returnNow(Integer(this.state.buf));
          }
        }
        parseDateTimeOnly() {
          if (this.state.buf.length < 4) {
            if (isDigit(this.char)) {
              return this.consume();
            } else if (this.char === CHAR_COLON) {
              return this.goto(this.parseOnlyTimeHour);
            } else {
              throw this.error(new TomlError("Expected digit while parsing year part of a date"));
            }
          } else {
            if (this.char === CHAR_HYPHEN) {
              return this.goto(this.parseDateTime);
            } else {
              throw this.error(new TomlError("Expected hyphen (-) while parsing year part of date"));
            }
          }
        }
        parseNumberBaseOrDateTime() {
          if (this.char === CHAR_b) {
            this.consume();
            return this.call(this.parseNoUnderHexOctBinLiteral, this.parseIntegerBin);
          } else if (this.char === CHAR_o) {
            this.consume();
            return this.call(this.parseNoUnderHexOctBinLiteral, this.parseIntegerOct);
          } else if (this.char === CHAR_x) {
            this.consume();
            return this.call(this.parseNoUnderHexOctBinLiteral, this.parseIntegerHex);
          } else if (this.char === CHAR_PERIOD) {
            return this.goto(this.parseNumberInteger);
          } else if (isDigit(this.char)) {
            return this.goto(this.parseDateTimeOnly);
          } else {
            return this.returnNow(Integer(this.state.buf));
          }
        }
        parseIntegerHex() {
          if (isHexit(this.char)) {
            this.consume();
          } else if (this.char === CHAR_LOWBAR) {
            return this.call(this.parseNoUnderHexOctBinLiteral);
          } else {
            const result = Integer(this.state.buf);
            if (result.isNaN()) {
              throw this.error(new TomlError("Invalid number"));
            } else {
              return this.returnNow(result);
            }
          }
        }
        parseIntegerOct() {
          if (isOctit(this.char)) {
            this.consume();
          } else if (this.char === CHAR_LOWBAR) {
            return this.call(this.parseNoUnderHexOctBinLiteral);
          } else {
            const result = Integer(this.state.buf);
            if (result.isNaN()) {
              throw this.error(new TomlError("Invalid number"));
            } else {
              return this.returnNow(result);
            }
          }
        }
        parseIntegerBin() {
          if (isBit(this.char)) {
            this.consume();
          } else if (this.char === CHAR_LOWBAR) {
            return this.call(this.parseNoUnderHexOctBinLiteral);
          } else {
            const result = Integer(this.state.buf);
            if (result.isNaN()) {
              throw this.error(new TomlError("Invalid number"));
            } else {
              return this.returnNow(result);
            }
          }
        }
        /* DATETIME */
        parseDateTime() {
          if (this.state.buf.length < 4) {
            throw this.error(new TomlError("Years less than 1000 must be zero padded to four characters"));
          }
          this.state.result = this.state.buf;
          this.state.buf = "";
          return this.next(this.parseDateMonth);
        }
        parseDateMonth() {
          if (this.char === CHAR_HYPHEN) {
            if (this.state.buf.length < 2) {
              throw this.error(new TomlError("Months less than 10 must be zero padded to two characters"));
            }
            this.state.result += "-" + this.state.buf;
            this.state.buf = "";
            return this.next(this.parseDateDay);
          } else if (isDigit(this.char)) {
            this.consume();
          } else {
            throw this.error(new TomlError("Incomplete datetime"));
          }
        }
        parseDateDay() {
          if (this.char === CHAR_T || this.char === CHAR_SP) {
            if (this.state.buf.length < 2) {
              throw this.error(new TomlError("Days less than 10 must be zero padded to two characters"));
            }
            this.state.result += "-" + this.state.buf;
            this.state.buf = "";
            return this.next(this.parseStartTimeHour);
          } else if (this.atEndOfWord()) {
            return this.returnNow(createDate(this.state.result + "-" + this.state.buf));
          } else if (isDigit(this.char)) {
            this.consume();
          } else {
            throw this.error(new TomlError("Incomplete datetime"));
          }
        }
        parseStartTimeHour() {
          if (this.atEndOfWord()) {
            return this.returnNow(createDate(this.state.result));
          } else {
            return this.goto(this.parseTimeHour);
          }
        }
        parseTimeHour() {
          if (this.char === CHAR_COLON) {
            if (this.state.buf.length < 2) {
              throw this.error(new TomlError("Hours less than 10 must be zero padded to two characters"));
            }
            this.state.result += "T" + this.state.buf;
            this.state.buf = "";
            return this.next(this.parseTimeMin);
          } else if (isDigit(this.char)) {
            this.consume();
          } else {
            throw this.error(new TomlError("Incomplete datetime"));
          }
        }
        parseTimeMin() {
          if (this.state.buf.length < 2 && isDigit(this.char)) {
            this.consume();
          } else if (this.state.buf.length === 2 && this.char === CHAR_COLON) {
            this.state.result += ":" + this.state.buf;
            this.state.buf = "";
            return this.next(this.parseTimeSec);
          } else {
            throw this.error(new TomlError("Incomplete datetime"));
          }
        }
        parseTimeSec() {
          if (isDigit(this.char)) {
            this.consume();
            if (this.state.buf.length === 2) {
              this.state.result += ":" + this.state.buf;
              this.state.buf = "";
              return this.next(this.parseTimeZoneOrFraction);
            }
          } else {
            throw this.error(new TomlError("Incomplete datetime"));
          }
        }
        parseOnlyTimeHour() {
          if (this.char === CHAR_COLON) {
            if (this.state.buf.length < 2) {
              throw this.error(new TomlError("Hours less than 10 must be zero padded to two characters"));
            }
            this.state.result = this.state.buf;
            this.state.buf = "";
            return this.next(this.parseOnlyTimeMin);
          } else {
            throw this.error(new TomlError("Incomplete time"));
          }
        }
        parseOnlyTimeMin() {
          if (this.state.buf.length < 2 && isDigit(this.char)) {
            this.consume();
          } else if (this.state.buf.length === 2 && this.char === CHAR_COLON) {
            this.state.result += ":" + this.state.buf;
            this.state.buf = "";
            return this.next(this.parseOnlyTimeSec);
          } else {
            throw this.error(new TomlError("Incomplete time"));
          }
        }
        parseOnlyTimeSec() {
          if (isDigit(this.char)) {
            this.consume();
            if (this.state.buf.length === 2) {
              return this.next(this.parseOnlyTimeFractionMaybe);
            }
          } else {
            throw this.error(new TomlError("Incomplete time"));
          }
        }
        parseOnlyTimeFractionMaybe() {
          this.state.result += ":" + this.state.buf;
          if (this.char === CHAR_PERIOD) {
            this.state.buf = "";
            this.next(this.parseOnlyTimeFraction);
          } else {
            return this.return(createTime(this.state.result));
          }
        }
        parseOnlyTimeFraction() {
          if (isDigit(this.char)) {
            this.consume();
          } else if (this.atEndOfWord()) {
            if (this.state.buf.length === 0) throw this.error(new TomlError("Expected digit in milliseconds"));
            return this.returnNow(createTime(this.state.result + "." + this.state.buf));
          } else {
            throw this.error(new TomlError("Unexpected character in datetime, expected period (.), minus (-), plus (+) or Z"));
          }
        }
        parseTimeZoneOrFraction() {
          if (this.char === CHAR_PERIOD) {
            this.consume();
            this.next(this.parseDateTimeFraction);
          } else if (this.char === CHAR_HYPHEN || this.char === CHAR_PLUS) {
            this.consume();
            this.next(this.parseTimeZoneHour);
          } else if (this.char === CHAR_Z) {
            this.consume();
            return this.return(createDateTime(this.state.result + this.state.buf));
          } else if (this.atEndOfWord()) {
            return this.returnNow(createDateTimeFloat(this.state.result + this.state.buf));
          } else {
            throw this.error(new TomlError("Unexpected character in datetime, expected period (.), minus (-), plus (+) or Z"));
          }
        }
        parseDateTimeFraction() {
          if (isDigit(this.char)) {
            this.consume();
          } else if (this.state.buf.length === 1) {
            throw this.error(new TomlError("Expected digit in milliseconds"));
          } else if (this.char === CHAR_HYPHEN || this.char === CHAR_PLUS) {
            this.consume();
            this.next(this.parseTimeZoneHour);
          } else if (this.char === CHAR_Z) {
            this.consume();
            return this.return(createDateTime(this.state.result + this.state.buf));
          } else if (this.atEndOfWord()) {
            return this.returnNow(createDateTimeFloat(this.state.result + this.state.buf));
          } else {
            throw this.error(new TomlError("Unexpected character in datetime, expected period (.), minus (-), plus (+) or Z"));
          }
        }
        parseTimeZoneHour() {
          if (isDigit(this.char)) {
            this.consume();
            if (/\d\d$/.test(this.state.buf)) return this.next(this.parseTimeZoneSep);
          } else {
            throw this.error(new TomlError("Unexpected character in datetime, expected digit"));
          }
        }
        parseTimeZoneSep() {
          if (this.char === CHAR_COLON) {
            this.consume();
            this.next(this.parseTimeZoneMin);
          } else {
            throw this.error(new TomlError("Unexpected character in datetime, expected colon"));
          }
        }
        parseTimeZoneMin() {
          if (isDigit(this.char)) {
            this.consume();
            if (/\d\d$/.test(this.state.buf)) return this.return(createDateTime(this.state.result + this.state.buf));
          } else {
            throw this.error(new TomlError("Unexpected character in datetime, expected digit"));
          }
        }
        /* BOOLEAN */
        parseBoolean() {
          if (this.char === CHAR_t) {
            this.consume();
            return this.next(this.parseTrue_r);
          } else if (this.char === CHAR_f) {
            this.consume();
            return this.next(this.parseFalse_a);
          }
        }
        parseTrue_r() {
          if (this.char === CHAR_r) {
            this.consume();
            return this.next(this.parseTrue_u);
          } else {
            throw this.error(new TomlError("Invalid boolean, expected true or false"));
          }
        }
        parseTrue_u() {
          if (this.char === CHAR_u) {
            this.consume();
            return this.next(this.parseTrue_e);
          } else {
            throw this.error(new TomlError("Invalid boolean, expected true or false"));
          }
        }
        parseTrue_e() {
          if (this.char === CHAR_e) {
            return this.return(true);
          } else {
            throw this.error(new TomlError("Invalid boolean, expected true or false"));
          }
        }
        parseFalse_a() {
          if (this.char === CHAR_a) {
            this.consume();
            return this.next(this.parseFalse_l);
          } else {
            throw this.error(new TomlError("Invalid boolean, expected true or false"));
          }
        }
        parseFalse_l() {
          if (this.char === CHAR_l) {
            this.consume();
            return this.next(this.parseFalse_s);
          } else {
            throw this.error(new TomlError("Invalid boolean, expected true or false"));
          }
        }
        parseFalse_s() {
          if (this.char === CHAR_s) {
            this.consume();
            return this.next(this.parseFalse_e);
          } else {
            throw this.error(new TomlError("Invalid boolean, expected true or false"));
          }
        }
        parseFalse_e() {
          if (this.char === CHAR_e) {
            return this.return(false);
          } else {
            throw this.error(new TomlError("Invalid boolean, expected true or false"));
          }
        }
        /* INLINE LISTS */
        parseInlineList() {
          if (this.char === CHAR_SP || this.char === CTRL_I || this.char === CTRL_M || this.char === CTRL_J) {
            return null;
          } else if (this.char === Parser.END) {
            throw this.error(new TomlError("Unterminated inline array"));
          } else if (this.char === CHAR_NUM) {
            return this.call(this.parseComment);
          } else if (this.char === CHAR_RSQB) {
            return this.return(this.state.resultArr || InlineList());
          } else {
            return this.callNow(this.parseValue, this.recordInlineListValue);
          }
        }
        recordInlineListValue(value) {
          if (this.state.resultArr) {
            const listType = this.state.resultArr[_contentType];
            const valueType = tomlType(value);
            if (listType !== valueType) {
              throw this.error(new TomlError(`Inline lists must be a single type, not a mix of ${listType} and ${valueType}`));
            }
          } else {
            this.state.resultArr = InlineList(tomlType(value));
          }
          if (isFloat(value) || isInteger(value)) {
            this.state.resultArr.push(value.valueOf());
          } else {
            this.state.resultArr.push(value);
          }
          return this.goto(this.parseInlineListNext);
        }
        parseInlineListNext() {
          if (this.char === CHAR_SP || this.char === CTRL_I || this.char === CTRL_M || this.char === CTRL_J) {
            return null;
          } else if (this.char === CHAR_NUM) {
            return this.call(this.parseComment);
          } else if (this.char === CHAR_COMMA) {
            return this.next(this.parseInlineList);
          } else if (this.char === CHAR_RSQB) {
            return this.goto(this.parseInlineList);
          } else {
            throw this.error(new TomlError("Invalid character, expected whitespace, comma (,) or close bracket (])"));
          }
        }
        /* INLINE TABLE */
        parseInlineTable() {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else if (this.char === Parser.END || this.char === CHAR_NUM || this.char === CTRL_J || this.char === CTRL_M) {
            throw this.error(new TomlError("Unterminated inline array"));
          } else if (this.char === CHAR_RCUB) {
            return this.return(this.state.resultTable || InlineTable());
          } else {
            if (!this.state.resultTable) this.state.resultTable = InlineTable();
            return this.callNow(this.parseAssign, this.recordInlineTableValue);
          }
        }
        recordInlineTableValue(kv) {
          let target = this.state.resultTable;
          let finalKey = kv.key.pop();
          for (let kw of kv.key) {
            if (hasKey(target, kw) && (!isTable(target[kw]) || target[kw][_declared])) {
              throw this.error(new TomlError("Can't redefine existing key"));
            }
            target = target[kw] = target[kw] || Table();
          }
          if (hasKey(target, finalKey)) {
            throw this.error(new TomlError("Can't redefine existing key"));
          }
          if (isInteger(kv.value) || isFloat(kv.value)) {
            target[finalKey] = kv.value.valueOf();
          } else {
            target[finalKey] = kv.value;
          }
          return this.goto(this.parseInlineTableNext);
        }
        parseInlineTableNext() {
          if (this.char === CHAR_SP || this.char === CTRL_I) {
            return null;
          } else if (this.char === Parser.END || this.char === CHAR_NUM || this.char === CTRL_J || this.char === CTRL_M) {
            throw this.error(new TomlError("Unterminated inline array"));
          } else if (this.char === CHAR_COMMA) {
            return this.next(this.parseInlineTable);
          } else if (this.char === CHAR_RCUB) {
            return this.goto(this.parseInlineTable);
          } else {
            throw this.error(new TomlError("Invalid character, expected whitespace, comma (,) or close bracket (])"));
          }
        }
      }
      return TOMLParser;
    }
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-pretty-error.js
var require_parse_pretty_error = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-pretty-error.js"(exports2, module2) {
    "use strict";
    module2.exports = prettyError;
    function prettyError(err, buf) {
      if (err.pos == null || err.line == null) return err;
      let msg = err.message;
      msg += ` at row ${err.line + 1}, col ${err.col + 1}, pos ${err.pos}:
`;
      if (buf && buf.split) {
        const lines = buf.split(/\n/);
        const lineNumWidth = String(Math.min(lines.length, err.line + 3)).length;
        let linePadding = " ";
        while (linePadding.length < lineNumWidth) linePadding += " ";
        for (let ii = Math.max(0, err.line - 1); ii < Math.min(lines.length, err.line + 2); ++ii) {
          let lineNum = String(ii + 1);
          if (lineNum.length < lineNumWidth) lineNum = " " + lineNum;
          if (err.line === ii) {
            msg += lineNum + "> " + lines[ii] + "\n";
            msg += linePadding + "  ";
            for (let hh = 0; hh < err.col; ++hh) {
              msg += " ";
            }
            msg += "^\n";
          } else {
            msg += lineNum + ": " + lines[ii] + "\n";
          }
        }
      }
      err.message = msg + "\n";
      return err;
    }
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-string.js
var require_parse_string = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-string.js"(exports2, module2) {
    "use strict";
    module2.exports = parseString;
    var TOMLParser = require_toml_parser();
    var prettyError = require_parse_pretty_error();
    function parseString(str) {
      if (global.Buffer && global.Buffer.isBuffer(str)) {
        str = str.toString("utf8");
      }
      const parser = new TOMLParser();
      try {
        parser.parse(str);
        return parser.finish();
      } catch (err) {
        throw prettyError(err, str);
      }
    }
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-async.js
var require_parse_async = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-async.js"(exports2, module2) {
    "use strict";
    module2.exports = parseAsync;
    var TOMLParser = require_toml_parser();
    var prettyError = require_parse_pretty_error();
    function parseAsync(str, opts) {
      if (!opts) opts = {};
      const index = 0;
      const blocksize = opts.blocksize || 40960;
      const parser = new TOMLParser();
      return new Promise((resolve, reject) => {
        setImmediate(parseAsyncNext, index, blocksize, resolve, reject);
      });
      function parseAsyncNext(index2, blocksize2, resolve, reject) {
        if (index2 >= str.length) {
          try {
            return resolve(parser.finish());
          } catch (err) {
            return reject(prettyError(err, str));
          }
        }
        try {
          parser.parse(str.slice(index2, index2 + blocksize2));
          setImmediate(parseAsyncNext, index2 + blocksize2, blocksize2, resolve, reject);
        } catch (err) {
          reject(prettyError(err, str));
        }
      }
    }
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-stream.js
var require_parse_stream = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse-stream.js"(exports2, module2) {
    "use strict";
    module2.exports = parseStream;
    var stream = __require("stream");
    var TOMLParser = require_toml_parser();
    function parseStream(stm) {
      if (stm) {
        return parseReadable(stm);
      } else {
        return parseTransform(stm);
      }
    }
    function parseReadable(stm) {
      const parser = new TOMLParser();
      stm.setEncoding("utf8");
      return new Promise((resolve, reject) => {
        let readable;
        let ended = false;
        let errored = false;
        function finish() {
          ended = true;
          if (readable) return;
          try {
            resolve(parser.finish());
          } catch (err) {
            reject(err);
          }
        }
        function error(err) {
          errored = true;
          reject(err);
        }
        stm.once("end", finish);
        stm.once("error", error);
        readNext();
        function readNext() {
          readable = true;
          let data;
          while ((data = stm.read()) !== null) {
            try {
              parser.parse(data);
            } catch (err) {
              return error(err);
            }
          }
          readable = false;
          if (ended) return finish();
          if (errored) return;
          stm.once("readable", readNext);
        }
      });
    }
    function parseTransform() {
      const parser = new TOMLParser();
      return new stream.Transform({
        objectMode: true,
        transform(chunk, encoding, cb) {
          try {
            parser.parse(chunk.toString(encoding));
          } catch (err) {
            this.emit("error", err);
          }
          cb();
        },
        flush(cb) {
          try {
            this.push(parser.finish());
          } catch (err) {
            this.emit("error", err);
          }
          cb();
        }
      });
    }
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse.js
var require_parse = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/parse.js"(exports2, module2) {
    "use strict";
    module2.exports = require_parse_string();
    module2.exports.async = require_parse_async();
    module2.exports.stream = require_parse_stream();
    module2.exports.prettyError = require_parse_pretty_error();
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/stringify.js"(exports2, module2) {
    "use strict";
    module2.exports = stringify;
    module2.exports.value = stringifyInline;
    function stringify(obj) {
      if (obj === null) throw typeError("null");
      if (obj === void 0) throw typeError("undefined");
      if (typeof obj !== "object") throw typeError(typeof obj);
      if (typeof obj.toJSON === "function") obj = obj.toJSON();
      if (obj == null) return null;
      const type = tomlType2(obj);
      if (type !== "table") throw typeError(type);
      return stringifyObject("", "", obj);
    }
    function typeError(type) {
      return new Error("Can only stringify objects, not " + type);
    }
    function arrayOneTypeError() {
      return new Error("Array values can't have mixed types");
    }
    function getInlineKeys(obj) {
      return Object.keys(obj).filter((key) => isInline(obj[key]));
    }
    function getComplexKeys(obj) {
      return Object.keys(obj).filter((key) => !isInline(obj[key]));
    }
    function toJSON(obj) {
      let nobj = Array.isArray(obj) ? [] : Object.prototype.hasOwnProperty.call(obj, "__proto__") ? { ["__proto__"]: void 0 } : {};
      for (let prop of Object.keys(obj)) {
        if (obj[prop] && typeof obj[prop].toJSON === "function" && !("toISOString" in obj[prop])) {
          nobj[prop] = obj[prop].toJSON();
        } else {
          nobj[prop] = obj[prop];
        }
      }
      return nobj;
    }
    function stringifyObject(prefix, indent, obj) {
      obj = toJSON(obj);
      var inlineKeys;
      var complexKeys;
      inlineKeys = getInlineKeys(obj);
      complexKeys = getComplexKeys(obj);
      var result = [];
      var inlineIndent = indent || "";
      inlineKeys.forEach((key) => {
        var type = tomlType2(obj[key]);
        if (type !== "undefined" && type !== "null") {
          result.push(inlineIndent + stringifyKey(key) + " = " + stringifyAnyInline(obj[key], true));
        }
      });
      if (result.length > 0) result.push("");
      var complexIndent = prefix && inlineKeys.length > 0 ? indent + "  " : "";
      complexKeys.forEach((key) => {
        result.push(stringifyComplex(prefix, complexIndent, key, obj[key]));
      });
      return result.join("\n");
    }
    function isInline(value) {
      switch (tomlType2(value)) {
        case "undefined":
        case "null":
        case "integer":
        case "nan":
        case "float":
        case "boolean":
        case "string":
        case "datetime":
          return true;
        case "array":
          return value.length === 0 || tomlType2(value[0]) !== "table";
        case "table":
          return Object.keys(value).length === 0;
        /* istanbul ignore next */
        default:
          return false;
      }
    }
    function tomlType2(value) {
      if (value === void 0) {
        return "undefined";
      } else if (value === null) {
        return "null";
      } else if (typeof value === "bigint" || Number.isInteger(value) && !Object.is(value, -0)) {
        return "integer";
      } else if (typeof value === "number") {
        return "float";
      } else if (typeof value === "boolean") {
        return "boolean";
      } else if (typeof value === "string") {
        return "string";
      } else if ("toISOString" in value) {
        return isNaN(value) ? "undefined" : "datetime";
      } else if (Array.isArray(value)) {
        return "array";
      } else {
        return "table";
      }
    }
    function stringifyKey(key) {
      var keyStr = String(key);
      if (/^[-A-Za-z0-9_]+$/.test(keyStr)) {
        return keyStr;
      } else {
        return stringifyBasicString(keyStr);
      }
    }
    function stringifyBasicString(str) {
      return '"' + escapeString(str).replace(/"/g, '\\"') + '"';
    }
    function stringifyLiteralString(str) {
      return "'" + str + "'";
    }
    function numpad(num, str) {
      while (str.length < num) str = "0" + str;
      return str;
    }
    function escapeString(str) {
      return str.replace(/\\/g, "\\\\").replace(/[\b]/g, "\\b").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\f/g, "\\f").replace(/\r/g, "\\r").replace(/([\u0000-\u001f\u007f])/, (c) => "\\u" + numpad(4, c.codePointAt(0).toString(16)));
    }
    function stringifyMultilineString(str) {
      let escaped = str.split(/\n/).map((str2) => {
        return escapeString(str2).replace(/"(?="")/g, '\\"');
      }).join("\n");
      if (escaped.slice(-1) === '"') escaped += "\\\n";
      return '"""\n' + escaped + '"""';
    }
    function stringifyAnyInline(value, multilineOk) {
      let type = tomlType2(value);
      if (type === "string") {
        if (multilineOk && /\n/.test(value)) {
          type = "string-multiline";
        } else if (!/[\b\t\n\f\r']/.test(value) && /"/.test(value)) {
          type = "string-literal";
        }
      }
      return stringifyInline(value, type);
    }
    function stringifyInline(value, type) {
      if (!type) type = tomlType2(value);
      switch (type) {
        case "string-multiline":
          return stringifyMultilineString(value);
        case "string":
          return stringifyBasicString(value);
        case "string-literal":
          return stringifyLiteralString(value);
        case "integer":
          return stringifyInteger(value);
        case "float":
          return stringifyFloat(value);
        case "boolean":
          return stringifyBoolean(value);
        case "datetime":
          return stringifyDatetime(value);
        case "array":
          return stringifyInlineArray(value.filter((_) => tomlType2(_) !== "null" && tomlType2(_) !== "undefined" && tomlType2(_) !== "nan"));
        case "table":
          return stringifyInlineTable(value);
        /* istanbul ignore next */
        default:
          throw typeError(type);
      }
    }
    function stringifyInteger(value) {
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
    }
    function stringifyFloat(value) {
      if (value === Infinity) {
        return "inf";
      } else if (value === -Infinity) {
        return "-inf";
      } else if (Object.is(value, NaN)) {
        return "nan";
      } else if (Object.is(value, -0)) {
        return "-0.0";
      }
      var chunks = String(value).split(".");
      var int = chunks[0];
      var dec = chunks[1] || 0;
      return stringifyInteger(int) + "." + dec;
    }
    function stringifyBoolean(value) {
      return String(value);
    }
    function stringifyDatetime(value) {
      return value.toISOString();
    }
    function isNumber(type) {
      return type === "float" || type === "integer";
    }
    function arrayType(values) {
      var contentType2 = tomlType2(values[0]);
      if (values.every((_) => tomlType2(_) === contentType2)) return contentType2;
      if (values.every((_) => isNumber(tomlType2(_)))) return "float";
      return "mixed";
    }
    function validateArray(values) {
      const type = arrayType(values);
      if (type === "mixed") {
        throw arrayOneTypeError();
      }
      return type;
    }
    function stringifyInlineArray(values) {
      values = toJSON(values);
      const type = validateArray(values);
      var result = "[";
      var stringified = values.map((_) => stringifyInline(_, type));
      if (stringified.join(", ").length > 60 || /\n/.test(stringified)) {
        result += "\n  " + stringified.join(",\n  ") + "\n";
      } else {
        result += " " + stringified.join(", ") + (stringified.length > 0 ? " " : "");
      }
      return result + "]";
    }
    function stringifyInlineTable(value) {
      value = toJSON(value);
      var result = [];
      Object.keys(value).forEach((key) => {
        result.push(stringifyKey(key) + " = " + stringifyAnyInline(value[key], false));
      });
      return "{ " + result.join(", ") + (result.length > 0 ? " " : "") + "}";
    }
    function stringifyComplex(prefix, indent, key, value) {
      var valueType = tomlType2(value);
      if (valueType === "array") {
        return stringifyArrayOfTables(prefix, indent, key, value);
      } else if (valueType === "table") {
        return stringifyComplexTable(prefix, indent, key, value);
      } else {
        throw typeError(valueType);
      }
    }
    function stringifyArrayOfTables(prefix, indent, key, values) {
      values = toJSON(values);
      validateArray(values);
      var firstValueType = tomlType2(values[0]);
      if (firstValueType !== "table") throw typeError(firstValueType);
      var fullKey = prefix + stringifyKey(key);
      var result = "";
      values.forEach((table) => {
        if (result.length > 0) result += "\n";
        result += indent + "[[" + fullKey + "]]\n";
        result += stringifyObject(fullKey + ".", indent, table);
      });
      return result;
    }
    function stringifyComplexTable(prefix, indent, key, value) {
      var fullKey = prefix + stringifyKey(key);
      var result = "";
      if (getInlineKeys(value).length > 0) {
        result += indent + "[" + fullKey + "]\n";
      }
      return result + stringifyObject(fullKey + ".", indent, value);
    }
  }
});

// node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/toml.js
var require_toml = __commonJS({
  "node_modules/.pnpm/@iarna+toml@2.2.5/node_modules/@iarna/toml/toml.js"(exports2) {
    "use strict";
    exports2.parse = require_parse();
    exports2.stringify = require_stringify();
  }
});

// node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/windows.js
var require_windows = __commonJS({
  "node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/windows.js"(exports2, module2) {
    module2.exports = isexe;
    isexe.sync = sync;
    var fs15 = __require("fs");
    function checkPathExt(path23, options) {
      var pathext = options.pathExt !== void 0 ? options.pathExt : process.env.PATHEXT;
      if (!pathext) {
        return true;
      }
      pathext = pathext.split(";");
      if (pathext.indexOf("") !== -1) {
        return true;
      }
      for (var i = 0; i < pathext.length; i++) {
        var p = pathext[i].toLowerCase();
        if (p && path23.substr(-p.length).toLowerCase() === p) {
          return true;
        }
      }
      return false;
    }
    function checkStat(stat, path23, options) {
      if (!stat.isSymbolicLink() && !stat.isFile()) {
        return false;
      }
      return checkPathExt(path23, options);
    }
    function isexe(path23, options, cb) {
      fs15.stat(path23, function(er, stat) {
        cb(er, er ? false : checkStat(stat, path23, options));
      });
    }
    function sync(path23, options) {
      return checkStat(fs15.statSync(path23), path23, options);
    }
  }
});

// node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/mode.js
var require_mode = __commonJS({
  "node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/mode.js"(exports2, module2) {
    module2.exports = isexe;
    isexe.sync = sync;
    var fs15 = __require("fs");
    function isexe(path23, options, cb) {
      fs15.stat(path23, function(er, stat) {
        cb(er, er ? false : checkStat(stat, options));
      });
    }
    function sync(path23, options) {
      return checkStat(fs15.statSync(path23), options);
    }
    function checkStat(stat, options) {
      return stat.isFile() && checkMode(stat, options);
    }
    function checkMode(stat, options) {
      var mod = stat.mode;
      var uid = stat.uid;
      var gid = stat.gid;
      var myUid = options.uid !== void 0 ? options.uid : process.getuid && process.getuid();
      var myGid = options.gid !== void 0 ? options.gid : process.getgid && process.getgid();
      var u = parseInt("100", 8);
      var g = parseInt("010", 8);
      var o = parseInt("001", 8);
      var ug = u | g;
      var ret = mod & o || mod & g && gid === myGid || mod & u && uid === myUid || mod & ug && myUid === 0;
      return ret;
    }
  }
});

// node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/index.js
var require_isexe = __commonJS({
  "node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/index.js"(exports2, module2) {
    var fs15 = __require("fs");
    var core;
    if (process.platform === "win32" || global.TESTING_WINDOWS) {
      core = require_windows();
    } else {
      core = require_mode();
    }
    module2.exports = isexe;
    isexe.sync = sync;
    function isexe(path23, options, cb) {
      if (typeof options === "function") {
        cb = options;
        options = {};
      }
      if (!cb) {
        if (typeof Promise !== "function") {
          throw new TypeError("callback not provided");
        }
        return new Promise(function(resolve, reject) {
          isexe(path23, options || {}, function(er, is) {
            if (er) {
              reject(er);
            } else {
              resolve(is);
            }
          });
        });
      }
      core(path23, options || {}, function(er, is) {
        if (er) {
          if (er.code === "EACCES" || options && options.ignoreErrors) {
            er = null;
            is = false;
          }
        }
        cb(er, is);
      });
    }
    function sync(path23, options) {
      try {
        return core.sync(path23, options || {});
      } catch (er) {
        if (options && options.ignoreErrors || er.code === "EACCES") {
          return false;
        } else {
          throw er;
        }
      }
    }
  }
});

// node_modules/.pnpm/which@2.0.2/node_modules/which/which.js
var require_which = __commonJS({
  "node_modules/.pnpm/which@2.0.2/node_modules/which/which.js"(exports2, module2) {
    var isWindows = process.platform === "win32" || process.env.OSTYPE === "cygwin" || process.env.OSTYPE === "msys";
    var path23 = __require("path");
    var COLON = isWindows ? ";" : ":";
    var isexe = require_isexe();
    var getNotFoundError = (cmd) => Object.assign(new Error(`not found: ${cmd}`), { code: "ENOENT" });
    var getPathInfo = (cmd, opt) => {
      const colon = opt.colon || COLON;
      const pathEnv = cmd.match(/\//) || isWindows && cmd.match(/\\/) ? [""] : [
        // windows always checks the cwd first
        ...isWindows ? [process.cwd()] : [],
        ...(opt.path || process.env.PATH || /* istanbul ignore next: very unusual */
        "").split(colon)
      ];
      const pathExtExe = isWindows ? opt.pathExt || process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM" : "";
      const pathExt = isWindows ? pathExtExe.split(colon) : [""];
      if (isWindows) {
        if (cmd.indexOf(".") !== -1 && pathExt[0] !== "")
          pathExt.unshift("");
      }
      return {
        pathEnv,
        pathExt,
        pathExtExe
      };
    };
    var which = (cmd, opt, cb) => {
      if (typeof opt === "function") {
        cb = opt;
        opt = {};
      }
      if (!opt)
        opt = {};
      const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
      const found = [];
      const step = (i) => new Promise((resolve, reject) => {
        if (i === pathEnv.length)
          return opt.all && found.length ? resolve(found) : reject(getNotFoundError(cmd));
        const ppRaw = pathEnv[i];
        const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
        const pCmd = path23.join(pathPart, cmd);
        const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
        resolve(subStep(p, i, 0));
      });
      const subStep = (p, i, ii) => new Promise((resolve, reject) => {
        if (ii === pathExt.length)
          return resolve(step(i + 1));
        const ext = pathExt[ii];
        isexe(p + ext, { pathExt: pathExtExe }, (er, is) => {
          if (!er && is) {
            if (opt.all)
              found.push(p + ext);
            else
              return resolve(p + ext);
          }
          return resolve(subStep(p, i, ii + 1));
        });
      });
      return cb ? step(0).then((res) => cb(null, res), cb) : step(0);
    };
    var whichSync = (cmd, opt) => {
      opt = opt || {};
      const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
      const found = [];
      for (let i = 0; i < pathEnv.length; i++) {
        const ppRaw = pathEnv[i];
        const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
        const pCmd = path23.join(pathPart, cmd);
        const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
        for (let j = 0; j < pathExt.length; j++) {
          const cur = p + pathExt[j];
          try {
            const is = isexe.sync(cur, { pathExt: pathExtExe });
            if (is) {
              if (opt.all)
                found.push(cur);
              else
                return cur;
            }
          } catch (ex) {
          }
        }
      }
      if (opt.all && found.length)
        return found;
      if (opt.nothrow)
        return null;
      throw getNotFoundError(cmd);
    };
    module2.exports = which;
    which.sync = whichSync;
  }
});

// node_modules/.pnpm/path-key@3.1.1/node_modules/path-key/index.js
var require_path_key = __commonJS({
  "node_modules/.pnpm/path-key@3.1.1/node_modules/path-key/index.js"(exports2, module2) {
    "use strict";
    var pathKey = (options = {}) => {
      const environment = options.env || process.env;
      const platform = options.platform || process.platform;
      if (platform !== "win32") {
        return "PATH";
      }
      return Object.keys(environment).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
    };
    module2.exports = pathKey;
    module2.exports.default = pathKey;
  }
});

// node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/resolveCommand.js
var require_resolveCommand = __commonJS({
  "node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/resolveCommand.js"(exports2, module2) {
    "use strict";
    var path23 = __require("path");
    var which = require_which();
    var getPathKey = require_path_key();
    function resolveCommandAttempt(parsed, withoutPathExt) {
      const env = parsed.options.env || process.env;
      const cwd = process.cwd();
      const hasCustomCwd = parsed.options.cwd != null;
      const shouldSwitchCwd = hasCustomCwd && process.chdir !== void 0 && !process.chdir.disabled;
      if (shouldSwitchCwd) {
        try {
          process.chdir(parsed.options.cwd);
        } catch (err) {
        }
      }
      let resolved;
      try {
        resolved = which.sync(parsed.command, {
          path: env[getPathKey({ env })],
          pathExt: withoutPathExt ? path23.delimiter : void 0
        });
      } catch (e) {
      } finally {
        if (shouldSwitchCwd) {
          process.chdir(cwd);
        }
      }
      if (resolved) {
        resolved = path23.resolve(hasCustomCwd ? parsed.options.cwd : "", resolved);
      }
      return resolved;
    }
    function resolveCommand(parsed) {
      return resolveCommandAttempt(parsed) || resolveCommandAttempt(parsed, true);
    }
    module2.exports = resolveCommand;
  }
});

// node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/escape.js
var require_escape = __commonJS({
  "node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/escape.js"(exports2, module2) {
    "use strict";
    var metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;
    function escapeCommand(arg) {
      arg = arg.replace(metaCharsRegExp, "^$1");
      return arg;
    }
    function escapeArgument(arg, doubleEscapeMetaChars) {
      arg = `${arg}`;
      arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
      arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
      arg = `"${arg}"`;
      arg = arg.replace(metaCharsRegExp, "^$1");
      if (doubleEscapeMetaChars) {
        arg = arg.replace(metaCharsRegExp, "^$1");
      }
      return arg;
    }
    module2.exports.command = escapeCommand;
    module2.exports.argument = escapeArgument;
  }
});

// node_modules/.pnpm/shebang-regex@3.0.0/node_modules/shebang-regex/index.js
var require_shebang_regex = __commonJS({
  "node_modules/.pnpm/shebang-regex@3.0.0/node_modules/shebang-regex/index.js"(exports2, module2) {
    "use strict";
    module2.exports = /^#!(.*)/;
  }
});

// node_modules/.pnpm/shebang-command@2.0.0/node_modules/shebang-command/index.js
var require_shebang_command = __commonJS({
  "node_modules/.pnpm/shebang-command@2.0.0/node_modules/shebang-command/index.js"(exports2, module2) {
    "use strict";
    var shebangRegex = require_shebang_regex();
    module2.exports = (string2 = "") => {
      const match = string2.match(shebangRegex);
      if (!match) {
        return null;
      }
      const [path23, argument] = match[0].replace(/#! ?/, "").split(" ");
      const binary = path23.split("/").pop();
      if (binary === "env") {
        return argument;
      }
      return argument ? `${binary} ${argument}` : binary;
    };
  }
});

// node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/readShebang.js
var require_readShebang = __commonJS({
  "node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/readShebang.js"(exports2, module2) {
    "use strict";
    var fs15 = __require("fs");
    var shebangCommand = require_shebang_command();
    function readShebang(command) {
      const size = 150;
      const buffer = Buffer.alloc(size);
      let fd;
      try {
        fd = fs15.openSync(command, "r");
        fs15.readSync(fd, buffer, 0, size, 0);
        fs15.closeSync(fd);
      } catch (e) {
      }
      return shebangCommand(buffer.toString());
    }
    module2.exports = readShebang;
  }
});

// node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/parse.js
var require_parse2 = __commonJS({
  "node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/parse.js"(exports2, module2) {
    "use strict";
    var path23 = __require("path");
    var resolveCommand = require_resolveCommand();
    var escape = require_escape();
    var readShebang = require_readShebang();
    var isWin = process.platform === "win32";
    var isExecutableRegExp = /\.(?:com|exe)$/i;
    var isCmdShimRegExp = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;
    function detectShebang(parsed) {
      parsed.file = resolveCommand(parsed);
      const shebang = parsed.file && readShebang(parsed.file);
      if (shebang) {
        parsed.args.unshift(parsed.file);
        parsed.command = shebang;
        return resolveCommand(parsed);
      }
      return parsed.file;
    }
    function parseNonShell(parsed) {
      if (!isWin) {
        return parsed;
      }
      const commandFile = detectShebang(parsed);
      const needsShell = !isExecutableRegExp.test(commandFile);
      if (parsed.options.forceShell || needsShell) {
        const needsDoubleEscapeMetaChars = isCmdShimRegExp.test(commandFile);
        parsed.command = path23.normalize(parsed.command);
        parsed.command = escape.command(parsed.command);
        parsed.args = parsed.args.map((arg) => escape.argument(arg, needsDoubleEscapeMetaChars));
        const shellCommand = [parsed.command].concat(parsed.args).join(" ");
        parsed.args = ["/d", "/s", "/c", `"${shellCommand}"`];
        parsed.command = process.env.comspec || "cmd.exe";
        parsed.options.windowsVerbatimArguments = true;
      }
      return parsed;
    }
    function parse(command, args, options) {
      if (args && !Array.isArray(args)) {
        options = args;
        args = null;
      }
      args = args ? args.slice(0) : [];
      options = Object.assign({}, options);
      const parsed = {
        command,
        args,
        options,
        file: void 0,
        original: {
          command,
          args
        }
      };
      return options.shell ? parsed : parseNonShell(parsed);
    }
    module2.exports = parse;
  }
});

// node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/enoent.js
var require_enoent = __commonJS({
  "node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/enoent.js"(exports2, module2) {
    "use strict";
    var isWin = process.platform === "win32";
    function notFoundError(original, syscall) {
      return Object.assign(new Error(`${syscall} ${original.command} ENOENT`), {
        code: "ENOENT",
        errno: "ENOENT",
        syscall: `${syscall} ${original.command}`,
        path: original.command,
        spawnargs: original.args
      });
    }
    function hookChildProcess(cp, parsed) {
      if (!isWin) {
        return;
      }
      const originalEmit = cp.emit;
      cp.emit = function(name, arg1) {
        if (name === "exit") {
          const err = verifyENOENT(arg1, parsed);
          if (err) {
            return originalEmit.call(cp, "error", err);
          }
        }
        return originalEmit.apply(cp, arguments);
      };
    }
    function verifyENOENT(status, parsed) {
      if (isWin && status === 1 && !parsed.file) {
        return notFoundError(parsed.original, "spawn");
      }
      return null;
    }
    function verifyENOENTSync(status, parsed) {
      if (isWin && status === 1 && !parsed.file) {
        return notFoundError(parsed.original, "spawnSync");
      }
      return null;
    }
    module2.exports = {
      hookChildProcess,
      verifyENOENT,
      verifyENOENTSync,
      notFoundError
    };
  }
});

// node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/index.js
var require_cross_spawn = __commonJS({
  "node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/index.js"(exports2, module2) {
    "use strict";
    var cp = __require("child_process");
    var parse = require_parse2();
    var enoent = require_enoent();
    function spawn3(command, args, options) {
      const parsed = parse(command, args, options);
      const spawned = cp.spawn(parsed.command, parsed.args, parsed.options);
      enoent.hookChildProcess(spawned, parsed);
      return spawned;
    }
    function spawnSync(command, args, options) {
      const parsed = parse(command, args, options);
      const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);
      result.error = result.error || enoent.verifyENOENTSync(result.status, parsed);
      return result;
    }
    module2.exports = spawn3;
    module2.exports.spawn = spawn3;
    module2.exports.sync = spawnSync;
    module2.exports._parse = parse;
    module2.exports._enoent = enoent;
  }
});

// node_modules/.pnpm/content-type@1.0.5/node_modules/content-type/index.js
var require_content_type = __commonJS({
  "node_modules/.pnpm/content-type@1.0.5/node_modules/content-type/index.js"(exports2) {
    "use strict";
    var PARAM_REGEXP = /; *([!#$%&'*+.^_`|~0-9A-Za-z-]+) *= *("(?:[\u000b\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\u000b\u0020-\u00ff])*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+) */g;
    var TEXT_REGEXP = /^[\u000b\u0020-\u007e\u0080-\u00ff]+$/;
    var TOKEN_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
    var QESC_REGEXP = /\\([\u000b\u0020-\u00ff])/g;
    var QUOTE_REGEXP = /([\\"])/g;
    var TYPE_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
    exports2.format = format;
    exports2.parse = parse;
    function format(obj) {
      if (!obj || typeof obj !== "object") {
        throw new TypeError("argument obj is required");
      }
      var parameters = obj.parameters;
      var type = obj.type;
      if (!type || !TYPE_REGEXP.test(type)) {
        throw new TypeError("invalid type");
      }
      var string2 = type;
      if (parameters && typeof parameters === "object") {
        var param;
        var params = Object.keys(parameters).sort();
        for (var i = 0; i < params.length; i++) {
          param = params[i];
          if (!TOKEN_REGEXP.test(param)) {
            throw new TypeError("invalid parameter name");
          }
          string2 += "; " + param + "=" + qstring(parameters[param]);
        }
      }
      return string2;
    }
    function parse(string2) {
      if (!string2) {
        throw new TypeError("argument string is required");
      }
      var header = typeof string2 === "object" ? getcontenttype(string2) : string2;
      if (typeof header !== "string") {
        throw new TypeError("argument string is required to be a string");
      }
      var index = header.indexOf(";");
      var type = index !== -1 ? header.slice(0, index).trim() : header.trim();
      if (!TYPE_REGEXP.test(type)) {
        throw new TypeError("invalid media type");
      }
      var obj = new ContentType(type.toLowerCase());
      if (index !== -1) {
        var key;
        var match;
        var value;
        PARAM_REGEXP.lastIndex = index;
        while (match = PARAM_REGEXP.exec(header)) {
          if (match.index !== index) {
            throw new TypeError("invalid parameter format");
          }
          index += match[0].length;
          key = match[1].toLowerCase();
          value = match[2];
          if (value.charCodeAt(0) === 34) {
            value = value.slice(1, -1);
            if (value.indexOf("\\") !== -1) {
              value = value.replace(QESC_REGEXP, "$1");
            }
          }
          obj.parameters[key] = value;
        }
        if (index !== header.length) {
          throw new TypeError("invalid parameter format");
        }
      }
      return obj;
    }
    function getcontenttype(obj) {
      var header;
      if (typeof obj.getHeader === "function") {
        header = obj.getHeader("content-type");
      } else if (typeof obj.headers === "object") {
        header = obj.headers && obj.headers["content-type"];
      }
      if (typeof header !== "string") {
        throw new TypeError("content-type header is missing from object");
      }
      return header;
    }
    function qstring(val) {
      var str = String(val);
      if (TOKEN_REGEXP.test(str)) {
        return str;
      }
      if (str.length > 0 && !TEXT_REGEXP.test(str)) {
        throw new TypeError("invalid parameter value");
      }
      return '"' + str.replace(QUOTE_REGEXP, "\\$1") + '"';
    }
    function ContentType(type) {
      this.parameters = /* @__PURE__ */ Object.create(null);
      this.type = type;
    }
  }
});

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config.js
import path10 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/path-discovery.js
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path3 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/env.js
import os from "node:os";
import path from "node:path";
var ENV_DEFAULT_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-|:|-)?([^}]*)\}$/;
var ENV_INTERPOLATION_PATTERN = /\\?\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;
var ENV_DIRECT_PREFIX = "$env:";
function expandHome(input) {
  if (!input.startsWith("~")) {
    return input;
  }
  const home = os.homedir();
  if (input === "~") {
    return home;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(home, input.slice(2));
  }
  return input;
}
function resolveEnvValue(raw) {
  if (typeof raw !== "string") {
    return String(raw);
  }
  const match = ENV_DEFAULT_PATTERN.exec(raw);
  if (match) {
    const envName = match[1];
    const defaultValue = match[2] ?? "";
    if (!envName) {
      return raw;
    }
    const existing = process.env[envName];
    if (existing && existing !== "") {
      return existing;
    }
    return defaultValue;
  }
  if (raw.startsWith("$")) {
    return resolveEnvPlaceholders(raw);
  }
  return raw;
}
function resolveEnvPlaceholders(value) {
  if (value.startsWith(ENV_DIRECT_PREFIX)) {
    const envName = value.slice(ENV_DIRECT_PREFIX.length);
    const envValue = process.env[envName];
    if (envValue === void 0) {
      throw new Error(`Environment variable '${envName}' is required for MCP header substitution.`);
    }
    return envValue;
  }
  const missing = /* @__PURE__ */ new Set();
  const replaced = value.replace(ENV_INTERPOLATION_PATTERN, (placeholder, envName, fallback) => {
    const envValue = process.env[envName];
    if (envValue !== void 0 && envValue !== "") {
      return envValue;
    }
    if (fallback !== void 0) {
      return fallback;
    }
    if (envValue === void 0) {
      missing.add(envName);
      return placeholder;
    }
    return envValue;
  });
  if (missing.size > 0) {
    const names = [...missing].toSorted().join(", ");
    throw new Error(`Environment variable(s) ${names} must be set for MCP header substitution.`);
  }
  return replaced;
}
async function withEnvOverrides(envOverrides, fn) {
  if (!envOverrides || Object.keys(envOverrides).length === 0) {
    return await fn();
  }
  const applied = [];
  for (const [key, rawValue] of Object.entries(envOverrides)) {
    if (process.env[key]) {
      continue;
    }
    const resolved = resolveEnvValue(rawValue);
    if (resolved === "") {
      continue;
    }
    process.env[key] = resolved;
    applied.push(key);
  }
  try {
    return await fn();
  } finally {
    for (const key of applied) {
      delete process.env[key];
    }
  }
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/paths.js
import os2 from "node:os";
import path2 from "node:path";
var XDG_HOME_ENV = {
  config: "XDG_CONFIG_HOME",
  data: "XDG_DATA_HOME",
  state: "XDG_STATE_HOME",
  cache: "XDG_CACHE_HOME"
};
function legacyMcporterDir() {
  return path2.join(os2.homedir(), ".mcporter");
}
function mcporterDir(kind) {
  const raw = process.env[XDG_HOME_ENV[kind]];
  if (raw && raw.trim().length > 0) {
    const resolved = expandHome(raw.trim());
    if (path2.isAbsolute(resolved)) {
      return path2.join(resolved, "mcporter");
    }
  }
  return legacyMcporterDir();
}
function mcporterConfigCandidates() {
  const base = mcporterDir("config");
  const candidates = [path2.join(base, "mcporter.json"), path2.join(base, "mcporter.jsonc")];
  if (base !== legacyMcporterDir()) {
    const legacy = legacyMcporterDir();
    candidates.push(path2.join(legacy, "mcporter.json"), path2.join(legacy, "mcporter.jsonc"));
  }
  return candidates;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/path-discovery.js
async function listConfigLayerPaths(options = {}, rootDir = process.cwd()) {
  const explicitPath = options.configPath ?? process.env.MCPORTER_CONFIG;
  if (explicitPath) {
    return [path3.resolve(expandHome(explicitPath.trim()))];
  }
  const paths = [];
  const homeCandidates = homeConfigCandidates();
  const existingHome = homeCandidates.find((candidate) => pathExists(candidate));
  if (existingHome) {
    paths.push(existingHome);
  }
  const projectPath = path3.resolve(rootDir, "config", "mcporter.json");
  if (pathExists(projectPath)) {
    paths.push(projectPath);
  }
  return paths;
}
function homeConfigCandidates() {
  return mcporterConfigCandidates();
}
function pathExists(filePath) {
  try {
    fsSync.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}
async function pathExistsAsync(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/read-config.js
import fs3 from "node:fs/promises";
import path4 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config-schema.js
var ImportKindSchema = external_exports.enum(["cursor", "claude-code", "claude-desktop", "codex", "windsurf", "opencode", "vscode"]).describe("Supported editor/client configurations to import MCP servers from");
var DEFAULT_IMPORTS = [
  "cursor",
  "claude-code",
  "claude-desktop",
  "codex",
  "windsurf",
  "opencode",
  "vscode"
];
var RawLifecycleSchema = external_exports.union([
  external_exports.literal("keep-alive").describe("Keep the server connection alive"),
  external_exports.literal("ephemeral").describe("Connect only when needed"),
  external_exports.object({
    mode: external_exports.union([external_exports.literal("keep-alive"), external_exports.literal("ephemeral")]).describe("Connection lifecycle mode"),
    idleTimeoutMs: external_exports.number().int().positive().optional().describe("Idle timeout in milliseconds before disconnecting")
  })
]).describe("Server connection lifecycle: keep-alive maintains persistent connections, ephemeral connects on-demand");
var ToolNamesSchema = external_exports.array(external_exports.string()).describe("Exact MCP tool names");
var RawLoggingSchema = external_exports.object({
  daemon: external_exports.object({
    enabled: external_exports.boolean().optional().describe("Enable daemon logging for this server")
  }).optional().describe("Daemon-specific logging configuration")
}).optional().describe("Logging configuration for the server");
var RawHttpFetchSchema = external_exports.enum(["default", "node-http1"]).describe("HTTP fetch implementation for Streamable HTTP/SSE requests");
var RawRefreshSchema = external_exports.object({
  tokenEndpoint: external_exports.string().optional().describe("OAuth token endpoint used to refresh access tokens"),
  token_endpoint: external_exports.string().optional().describe("OAuth token endpoint used to refresh access tokens"),
  clientIdEnv: external_exports.string().optional().describe("Environment variable containing the OAuth client id"),
  client_id_env: external_exports.string().optional().describe("Environment variable containing the OAuth client id"),
  clientSecretEnv: external_exports.string().optional().describe("Environment variable containing the OAuth client secret"),
  client_secret_env: external_exports.string().optional().describe("Environment variable containing the OAuth client secret"),
  clientAuthMethod: external_exports.string().optional().describe("OAuth token endpoint client auth method"),
  client_auth_method: external_exports.string().optional().describe("OAuth token endpoint client auth method"),
  refreshSkewSeconds: external_exports.number().int().nonnegative().optional().describe("Refresh before expiry by this many seconds"),
  refresh_skew_seconds: external_exports.number().int().nonnegative().optional().describe("Refresh before expiry by this many seconds"),
  accessTokenEnv: external_exports.string().optional().describe("STDIO env var that receives the refreshed access token"),
  access_token_env: external_exports.string().optional().describe("STDIO env var that receives the refreshed access token")
}).describe("Refreshable bearer token settings");
var RawEntrySchema = external_exports.object({
  description: external_exports.string().optional().describe("Human-readable description of the server"),
  baseUrl: external_exports.string().optional().describe("Base URL for HTTP/SSE transport (camelCase)"),
  base_url: external_exports.string().optional().describe("Base URL for HTTP/SSE transport (snake_case)"),
  url: external_exports.string().optional().describe("Server URL for HTTP/SSE transport"),
  serverUrl: external_exports.string().optional().describe("Server URL for HTTP/SSE transport (camelCase)"),
  server_url: external_exports.string().optional().describe("Server URL for HTTP/SSE transport (snake_case)"),
  command: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]).optional().describe("Command to spawn for stdio transport (string or array of arguments)"),
  executable: external_exports.string().optional().describe("Executable path for stdio transport"),
  args: external_exports.array(external_exports.string()).optional().describe("Arguments to pass to the stdio command"),
  cwd: external_exports.string().optional().describe("Working directory for stdio servers. A leading ~ is expanded to $HOME; relative paths resolve against the config file directory"),
  headers: external_exports.record(external_exports.string(), external_exports.string()).optional().describe("HTTP headers for requests. Supports ${VAR}, ${VAR:-fallback}, and $env:VAR placeholders"),
  env: external_exports.record(external_exports.string(), external_exports.string()).optional().describe("Environment variables for stdio commands. Supports ${VAR} and ${VAR:-fallback} placeholders"),
  auth: external_exports.string().optional().describe('Authentication method (e.g., "oauth")'),
  tokenCacheDir: external_exports.string().optional().describe("Directory for caching OAuth tokens (camelCase)"),
  token_cache_dir: external_exports.string().optional().describe("Directory for caching OAuth tokens (snake_case)"),
  clientName: external_exports.string().optional().describe("Client identifier for server telemetry (camelCase)"),
  client_name: external_exports.string().optional().describe("Client identifier for server telemetry (snake_case)"),
  oauthClientId: external_exports.string().optional().describe("Pre-registered OAuth client id (camelCase)"),
  oauth_client_id: external_exports.string().optional().describe("Pre-registered OAuth client id (snake_case)"),
  oauthClientSecret: external_exports.string().optional().describe("Pre-registered OAuth client secret (camelCase)"),
  oauth_client_secret: external_exports.string().optional().describe("Pre-registered OAuth client secret (snake_case)"),
  oauthClientSecretEnv: external_exports.string().optional().describe("Environment variable containing the OAuth client secret"),
  oauth_client_secret_env: external_exports.string().optional().describe("Environment variable containing the OAuth client secret"),
  oauthTokenEndpointAuthMethod: external_exports.string().optional().describe("OAuth token endpoint auth method, e.g. client_secret_post"),
  oauth_token_endpoint_auth_method: external_exports.string().optional().describe("OAuth token endpoint auth method, e.g. client_secret_post"),
  oauthRedirectUrl: external_exports.string().optional().describe("Custom OAuth redirect URL (camelCase)"),
  oauth_redirect_url: external_exports.string().optional().describe("Custom OAuth redirect URL (snake_case)"),
  oauthScope: external_exports.string().optional().describe("OAuth scope override (camelCase)"),
  oauth_scope: external_exports.string().optional().describe("OAuth scope override (snake_case)"),
  oauthCommand: external_exports.object({
    args: external_exports.array(external_exports.string()).describe("Arguments for the OAuth command")
  }).optional().describe("Custom OAuth command configuration for stdio servers (camelCase)"),
  oauth_command: external_exports.object({
    args: external_exports.array(external_exports.string()).describe("Arguments for the OAuth command")
  }).optional().describe("Custom OAuth command configuration for stdio servers (snake_case)"),
  bearerToken: external_exports.string().optional().describe("Static bearer token for authentication (camelCase)"),
  bearer_token: external_exports.string().optional().describe("Static bearer token for authentication (snake_case)"),
  bearerTokenEnv: external_exports.string().optional().describe("Environment variable name containing the bearer token (camelCase)"),
  bearer_token_env: external_exports.string().optional().describe("Environment variable name containing the bearer token (snake_case)"),
  refresh: RawRefreshSchema.optional(),
  httpFetch: RawHttpFetchSchema.optional().describe("HTTP fetch implementation for Streamable HTTP/SSE requests"),
  http_fetch: RawHttpFetchSchema.optional().describe("HTTP fetch implementation for Streamable HTTP/SSE requests"),
  lifecycle: RawLifecycleSchema.optional(),
  logging: RawLoggingSchema,
  allowedTools: ToolNamesSchema.optional().describe("Only these exact tool names are exposed (camelCase)"),
  allowed_tools: ToolNamesSchema.optional().describe("Only these exact tool names are exposed (snake_case)"),
  blockedTools: ToolNamesSchema.optional().describe("These exact tool names are hidden and blocked (camelCase)"),
  blocked_tools: ToolNamesSchema.optional().describe("These exact tool names are hidden and blocked (snake_case)")
}).superRefine((entry, ctx) => {
  const hasAllowed = entry.allowedTools !== void 0 || entry.allowed_tools !== void 0;
  const hasBlocked = entry.blockedTools !== void 0 || entry.blocked_tools !== void 0;
  if (hasAllowed && hasBlocked) {
    ctx.addIssue({
      code: "custom",
      message: "Specify either allowedTools or blockedTools, not both.",
      path: ["allowedTools"]
    });
  }
}).describe("MCP server definition supporting both HTTP/SSE and stdio transports");
var RawConfigSchema = external_exports.object({
  mcpServers: external_exports.record(external_exports.string(), RawEntrySchema).describe("Map of server names to their configurations"),
  daemonIdleTimeoutMs: external_exports.number().int().positive().optional().describe("Idle timeout in milliseconds before shutting down an inactive daemon"),
  daemon_idle_timeout_ms: external_exports.number().int().positive().optional().describe("Idle timeout in milliseconds before shutting down an inactive daemon"),
  imports: external_exports.array(ImportKindSchema).optional().describe("Editor configurations to import servers from. Omit to use defaults, or set to [] to disable imports")
}).describe("mcporter configuration file schema");

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/imports/shared.js
var import_jsonc_parser = __toESM(require_main(), 1);
import fs2 from "node:fs/promises";
async function fileExists(filePath) {
  try {
    await fs2.access(filePath);
    return true;
  } catch {
    return false;
  }
}
function parseJsonBuffer(buffer) {
  const errors = [];
  const parsed = (0, import_jsonc_parser.parse)(buffer, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first) {
    const message = (0, import_jsonc_parser.printParseErrorCode)(first.error);
    throw new SyntaxError(`Failed to parse JSON (offset ${first.offset}): ${message}`);
  }
  return parsed;
}
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/read-config.js
async function loadConfigLayers(options, rootDir) {
  const explicitPath = options.configPath ?? process.env.MCPORTER_CONFIG;
  if (explicitPath) {
    const resolvedPath = path4.resolve(expandHome(explicitPath.trim()));
    const config = await readConfigFile(resolvedPath, true);
    return [{ config, path: resolvedPath, explicit: true }];
  }
  const layers = [];
  const homeCandidates = homeConfigCandidates();
  const existingHome = homeCandidates.find((candidate) => pathExists(candidate));
  if (existingHome) {
    layers.push({ config: await readConfigFile(existingHome, false), path: existingHome, explicit: false });
  }
  const projectPath = path4.resolve(rootDir, "config", "mcporter.json");
  if (pathExists(projectPath)) {
    layers.push({ config: await readConfigFile(projectPath, false), path: projectPath, explicit: false });
  }
  if (layers.length === 0) {
    layers.push({ config: { mcpServers: {} }, path: projectPath, explicit: false });
  }
  return layers;
}
async function readConfigFile(configPath, explicit) {
  if (!explicit && !await pathExistsAsync(configPath)) {
    return { mcpServers: {} };
  }
  try {
    const buffer = await fs3.readFile(configPath, "utf8");
    return RawConfigSchema.parse(parseJsonBuffer(buffer));
  } catch (error) {
    if (!explicit && isMissingConfigError(error)) {
      return { mcpServers: {} };
    }
    if (!explicit && isSyntaxError(error)) {
      warnConfigFallback(configPath, error);
      return { mcpServers: {} };
    }
    throw error;
  }
}
function isErrno(error, code) {
  return Boolean(error && typeof error === "object" && error.code === code);
}
function isMissingConfigError(error) {
  return isErrno(error, "ENOENT") || includesErrnoMessage(error, "ENOENT");
}
function isSyntaxError(error) {
  return error instanceof SyntaxError;
}
var warnedConfigPaths = /* @__PURE__ */ new Set();
function warnConfigFallback(configPath, error) {
  if (warnedConfigPaths.has(configPath)) {
    return;
  }
  warnedConfigPaths.add(configPath);
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`[mcporter] Ignoring config at ${configPath}: ${reason}`);
}
function includesErrnoMessage(error, code) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message = error.message;
  return typeof message === "string" && message.includes(code);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config-imports.js
import { pathToFileURL } from "node:url";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/imports/external.js
var import_toml = __toESM(require_toml(), 1);
import fs4 from "node:fs/promises";
import path6 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/imports/paths-utils.js
import os3 from "node:os";
import path5 from "node:path";
function normalizeProjectPath(input) {
  if (!input || typeof input !== "string") {
    return "";
  }
  return path5.resolve(expandHomeShortcut(input));
}
function expandHomeShortcut(input) {
  if (input === "~") {
    return os3.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path5.join(os3.homedir(), input.slice(2));
  }
  return input;
}
function pathsEqual(a, b) {
  if (!a || !b) {
    return false;
  }
  if (process.platform === "win32") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/imports/external.js
async function readExternalEntries(filePath, options = {}) {
  if (!await fileExists(filePath)) {
    return null;
  }
  const buffer = await fs4.readFile(filePath, "utf8");
  if (!buffer.trim()) {
    return /* @__PURE__ */ new Map();
  }
  try {
    if (filePath.endsWith(".toml")) {
      const parsed2 = (0, import_toml.parse)(buffer);
      return extractFromCodexConfig(parsed2);
    }
    const parsed = parseJsonBuffer(buffer);
    return extractFromMcpJson(parsed, options, filePath);
  } catch (error) {
    if (shouldIgnoreParseError(error)) {
      return /* @__PURE__ */ new Map();
    }
    throw error;
  }
}
function extractFromMcpJson(raw, options, filePath) {
  const map = /* @__PURE__ */ new Map();
  if (!isRecord(raw)) {
    return map;
  }
  const { importKind, projectRoot } = options;
  const descriptor2 = resolveContainerDescriptor(importKind, filePath);
  const containers = [];
  if (descriptor2.allowMcpServers && isRecord(raw.mcpServers)) {
    containers.push(raw.mcpServers);
  }
  if (descriptor2.allowServers && isRecord(raw.servers)) {
    containers.push(raw.servers);
  }
  if (descriptor2.allowMcp && isRecord(raw.mcp)) {
    containers.push(raw.mcp);
  }
  if (descriptor2.allowRootFallback && containers.length === 0) {
    containers.push(raw);
  }
  for (const container of containers) {
    addEntriesFromContainer(container, map);
  }
  if (projectRoot) {
    const projectEntries = extractClaudeProjectEntries(raw, projectRoot);
    for (const [name, entry] of projectEntries) {
      if (!map.has(name)) {
        map.set(name, entry);
      }
    }
  }
  return map;
}
function extractFromCodexConfig(raw) {
  const map = /* @__PURE__ */ new Map();
  const serversRaw = raw.mcp_servers;
  if (!serversRaw || typeof serversRaw !== "object") {
    return map;
  }
  for (const [name, value] of Object.entries(serversRaw)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = convertExternalEntry(value);
    if (entry) {
      map.set(name, entry);
    }
  }
  return map;
}
function convertExternalEntry(value) {
  const result = {};
  if (typeof value.description === "string") {
    result.description = value.description;
  }
  const env = asStringRecord(value.env);
  if (env) {
    result.env = env;
  }
  const headers = buildExternalHeaders(value);
  if (headers) {
    result.headers = headers;
  }
  const auth2 = asString(value.auth);
  if (auth2) {
    result.auth = auth2;
  }
  const tokenCacheDir = asString(value.tokenCacheDir ?? value.token_cache_dir ?? value.token_cacheDir);
  if (tokenCacheDir) {
    result.tokenCacheDir = tokenCacheDir;
  }
  const clientName = asString(value.clientName ?? value.client_name);
  if (clientName) {
    result.clientName = clientName;
  }
  const oauthClientId = asString(value.oauthClientId ?? value.oauth_client_id);
  if (oauthClientId) {
    result.oauthClientId = oauthClientId;
  }
  const oauthClientSecret = asString(value.oauthClientSecret ?? value.oauth_client_secret);
  if (oauthClientSecret) {
    result.oauthClientSecret = oauthClientSecret;
  }
  const oauthClientSecretEnv = asString(value.oauthClientSecretEnv ?? value.oauth_client_secret_env);
  if (oauthClientSecretEnv) {
    result.oauthClientSecretEnv = oauthClientSecretEnv;
  }
  const oauthTokenEndpointAuthMethod = asString(value.oauthTokenEndpointAuthMethod ?? value.oauth_token_endpoint_auth_method);
  if (oauthTokenEndpointAuthMethod) {
    result.oauthTokenEndpointAuthMethod = oauthTokenEndpointAuthMethod;
  }
  const httpFetch = asString(value.httpFetch ?? value.http_fetch);
  if (httpFetch) {
    result.httpFetch = httpFetch;
  }
  const refresh = asRefresh(value.refresh);
  if (refresh) {
    result.refresh = refresh;
  }
  const url2 = asString(value.baseUrl ?? value.base_url ?? value.url ?? value.serverUrl ?? value.server_url);
  if (url2) {
    result.baseUrl = url2;
  }
  const commandValue = value.command ?? value.executable;
  if (Array.isArray(commandValue) && commandValue.every((item) => typeof item === "string")) {
    result.command = commandValue;
  } else if (typeof commandValue === "string") {
    result.command = commandValue;
  }
  if (Array.isArray(value.args) && value.args.every((item) => typeof item === "string")) {
    result.args = value.args;
  }
  const hasHttpTarget = typeof result.baseUrl === "string";
  const hasCommandTarget = typeof result.command === "string" || Array.isArray(result.command) && result.command.length > 0;
  if (!hasHttpTarget && !hasCommandTarget) {
    return null;
  }
  const parsed = RawEntrySchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}
function buildExternalHeaders(record) {
  const headers = {};
  const literalHeaders = asStringRecord(record.headers);
  if (literalHeaders) {
    Object.assign(headers, literalHeaders);
  }
  const bearerToken = asString(record.bearerToken ?? record.bearer_token);
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const bearerTokenEnv = asString(record.bearerTokenEnv ?? record.bearer_token_env);
  if (bearerTokenEnv) {
    headers.Authorization = `$env:${bearerTokenEnv}`;
  }
  return Object.keys(headers).length > 0 ? headers : void 0;
}
function asRefresh(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const record = value;
  const result = {};
  copyString(record, result, "tokenEndpoint", "token_endpoint");
  copyString(record, result, "clientIdEnv", "client_id_env");
  copyString(record, result, "clientSecretEnv", "client_secret_env");
  copyString(record, result, "clientAuthMethod", "client_auth_method");
  copyString(record, result, "accessTokenEnv", "access_token_env");
  const refreshSkewSeconds = record.refreshSkewSeconds ?? record.refresh_skew_seconds;
  if (typeof refreshSkewSeconds === "number" && Number.isInteger(refreshSkewSeconds) && refreshSkewSeconds >= 0) {
    result.refreshSkewSeconds = refreshSkewSeconds;
  }
  return Object.keys(result).length > 0 ? result : void 0;
}
function copyString(source, target, camel, snake) {
  const value = asString(source[camel] ?? source[snake]);
  if (value) {
    target[camel] = value;
  }
}
function extractClaudeProjectEntries(raw, projectRoot) {
  const map = /* @__PURE__ */ new Map();
  if (!isRecord(raw.projects)) {
    return map;
  }
  const projects = raw.projects;
  const targetPath = normalizeProjectPath(projectRoot);
  for (const [projectKey, value] of Object.entries(projects)) {
    if (!isRecord(value) || !isRecord(value.mcpServers)) {
      continue;
    }
    const normalizedKey = normalizeProjectPath(projectKey);
    if (!pathsEqual(normalizedKey, targetPath)) {
      continue;
    }
    addEntriesFromContainer(value.mcpServers, map);
  }
  return map;
}
function addEntriesFromContainer(container, target) {
  for (const [name, value] of Object.entries(container)) {
    if (!isRecord(value)) {
      continue;
    }
    if (target.has(name)) {
      continue;
    }
    const entry = convertExternalEntry(value);
    if (entry) {
      target.set(name, entry);
    }
  }
}
function resolveContainerDescriptor(importKind, filePath) {
  if (importKind === "opencode") {
    return {
      allowMcpServers: false,
      allowServers: false,
      allowMcp: true,
      allowRootFallback: false
    };
  }
  if (importKind === "claude-code" && filePath) {
    const normalized = path6.normalize(filePath);
    const allowRootFallback = normalized.endsWith(".claude.json") || normalized.endsWith(`${path6.sep}.claude${path6.sep}mcp.json`);
    return {
      allowMcpServers: true,
      allowServers: true,
      allowMcp: true,
      allowRootFallback
    };
  }
  return {
    allowMcpServers: true,
    allowServers: true,
    allowMcp: true,
    allowRootFallback: true
  };
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function asStringRecord(input) {
  if (!input || typeof input !== "object") {
    return void 0;
  }
  const record = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      record[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      record[key] = String(value);
    }
  }
  return Object.keys(record).length > 0 ? record : void 0;
}
function shouldIgnoreParseError(error) {
  if (error instanceof SyntaxError) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  return "fromTOML" in error;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config/imports/paths.js
import os4 from "node:os";
import path7 from "node:path";
function pathsForImport(kind, rootDir) {
  switch (kind) {
    case "cursor":
      return dedupePaths([
        path7.resolve(rootDir, ".cursor", "mcp.json"),
        path7.join(os4.homedir(), ".cursor", "mcp.json"),
        ...defaultCursorUserConfigPaths()
      ]);
    case "claude-code":
      return dedupePaths([
        path7.resolve(rootDir, ".claude", "settings.local.json"),
        path7.resolve(rootDir, ".claude", "settings.json"),
        path7.resolve(rootDir, ".claude", "mcp.json"),
        path7.join(os4.homedir(), ".claude", "settings.local.json"),
        path7.join(os4.homedir(), ".claude", "settings.json"),
        path7.join(os4.homedir(), ".claude", "mcp.json"),
        path7.join(os4.homedir(), ".claude.json")
      ]);
    case "claude-desktop":
      return [defaultClaudeDesktopConfigPath()];
    case "codex":
      return [path7.resolve(rootDir, ".codex", "config.toml"), path7.join(os4.homedir(), ".codex", "config.toml")];
    case "windsurf":
      return defaultWindsurfConfigPaths();
    case "opencode":
      return opencodeConfigPaths(rootDir);
    case "vscode":
      return dedupePaths([path7.resolve(rootDir, ".vscode", "mcp.json"), ...defaultVscodeConfigPaths()]);
    default:
      return [];
  }
}
function defaultCursorUserConfigPaths() {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  const configs = xdgConfig ? [path7.join(xdgConfig, "Cursor", "User", "mcp.json")] : [];
  return dedupePaths([
    path7.join(os4.homedir(), "AppData", "Roaming", "Cursor", "User", "mcp.json"),
    path7.join(os4.homedir(), "Library", "Application Support", "Cursor", "User", "mcp.json"),
    ...configs
  ]);
}
function defaultWindsurfConfigPaths() {
  const homeDir = os4.homedir();
  const paths = [
    path7.join(homeDir, ".codeium", "windsurf", "mcp_config.json"),
    path7.join(homeDir, ".codeium", "windsurf-next", "mcp_config.json"),
    path7.join(homeDir, ".windsurf", "mcp_config.json"),
    path7.join(homeDir, ".config", ".codeium", "windsurf", "mcp_config.json")
  ];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path7.join(homeDir, "AppData", "Roaming");
    paths.push(path7.join(appData, "Codeium", "windsurf", "mcp_config.json"));
  }
  return dedupePaths(paths);
}
function defaultVscodeConfigPaths() {
  if (process.platform === "darwin") {
    return [
      path7.join(os4.homedir(), "Library", "Application Support", "Code", "User", "mcp.json"),
      path7.join(os4.homedir(), "Library", "Application Support", "Code - Insiders", "User", "mcp.json")
    ];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path7.join(os4.homedir(), "AppData", "Roaming");
    return [path7.join(appData, "Code", "User", "mcp.json"), path7.join(appData, "Code - Insiders", "User", "mcp.json")];
  }
  return [
    path7.join(os4.homedir(), ".config", "Code", "User", "mcp.json"),
    path7.join(os4.homedir(), ".config", "Code - Insiders", "User", "mcp.json")
  ];
}
function opencodeConfigPaths(rootDir) {
  const overrideConfig = process.env.OPENCODE_CONFIG;
  const overrideDir = process.env.OPENCODE_CONFIG_DIR;
  const envConfigPath = process.env.OPENAI_WORKDIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  const configHome = xdg ?? path7.join(process.env.HOME ?? "", ".config");
  const paths = [
    overrideConfig ?? "",
    path7.resolve(rootDir, "opencode.jsonc"),
    path7.resolve(rootDir, "opencode.json")
  ];
  if (overrideDir && overrideDir.length > 0) {
    paths.push(path7.join(overrideDir, "opencode.jsonc"), path7.join(overrideDir, "opencode.json"));
  }
  paths.push(path7.resolve(rootDir, ".openai", "config.json"), envConfigPath ? path7.resolve(envConfigPath, ".openai", "config.json") : "", path7.join(configHome, "openai", "config.json"));
  for (const dir of defaultOpencodeConfigDirs()) {
    paths.push(path7.join(dir, "opencode.jsonc"), path7.join(dir, "opencode.json"));
  }
  return dedupePaths(paths);
}
function defaultOpencodeConfigDirs() {
  const dirs = [];
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) {
    dirs.push(path7.join(xdg, "opencode"));
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path7.join(os4.homedir(), "AppData", "Roaming");
    dirs.push(path7.join(appData, "opencode"));
  } else {
    dirs.push(path7.join(os4.homedir(), ".config", "opencode"));
  }
  return dirs;
}
function defaultClaudeDesktopConfigPath() {
  const homeDir = os4.homedir();
  const darwinPath = path7.join(homeDir, "Library", "Application Support", "Claude", "settings.json");
  const windowsPath = path7.join(homeDir, "AppData", "Roaming", "Claude", "settings.json");
  const linuxPath = path7.join(homeDir, ".config", "Claude", "settings.json");
  const platform = process.platform;
  if (platform === "darwin") {
    return darwinPath;
  }
  if (platform === "win32") {
    return windowsPath;
  }
  return linuxPath;
}
function dedupePaths(paths) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const candidate of paths) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config-normalize.js
import fs5 from "node:fs";
import path8 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/lifecycle.js
var DEFAULT_KEEP_ALIVE = /* @__PURE__ */ new Set(["chrome-devtools", "mobile-mcp", "playwright", "cloudbase"]);
var includeOverride = parseList(process.env.MCPORTER_KEEPALIVE);
var excludeOverride = parseList(process.env.MCPORTER_DISABLE_KEEPALIVE ?? process.env.MCPORTER_NO_KEEPALIVE);
var KEEP_ALIVE_COMMANDS = [
  { label: "chrome-devtools", fragments: ["chrome-devtools-mcp"] },
  { label: "mobile-mcp", fragments: ["@mobilenext/mobile-mcp", "mobile-mcp"] },
  { label: "playwright", fragments: ["@playwright/mcp", "playwright/mcp"] },
  { label: "cloudbase", fragments: ["@cloudbase/cloudbase-mcp", "cloudbase-mcp"] }
];
var CHROME_DEVTOOLS_URL_PLACEHOLDERS = [String.raw`\${CHROME_DEVTOOLS_URL}`, "$env:CHROME_DEVTOOLS_URL"];
function resolveLifecycle(name, rawLifecycle, command) {
  const normalizedName = name.toLowerCase();
  const canonicalName = canonicalKeepAliveName(command);
  const candidateNames = /* @__PURE__ */ new Set([normalizedName]);
  if (canonicalName) {
    candidateNames.add(canonicalName);
  }
  const forcedDisable = excludeOverride.all || matchesOverride(excludeOverride.names, candidateNames);
  const forcedEnable = includeOverride.all || matchesOverride(includeOverride.names, candidateNames);
  if (forcedEnable) {
    return { mode: "keep-alive" };
  }
  if (forcedDisable) {
    return void 0;
  }
  const lifecycle = rawLifecycle ? coerceLifecycle(rawLifecycle) : void 0;
  if (lifecycle) {
    return lifecycle;
  }
  if (commandRequiresDynamicChromePort(command)) {
    return { mode: "ephemeral" };
  }
  if (Array.from(candidateNames).some((candidate) => DEFAULT_KEEP_ALIVE.has(candidate))) {
    return { mode: "keep-alive" };
  }
  return void 0;
}
function canonicalKeepAliveName(command) {
  if (command.kind !== "stdio") {
    return void 0;
  }
  const tokens = [command.command, ...command.args].map((token) => token.toLowerCase());
  const match = KEEP_ALIVE_COMMANDS.find((signature) => signature.fragments.some((fragment) => tokens.some((token) => token.includes(fragment))));
  return match?.label;
}
function commandRequiresDynamicChromePort(command) {
  if (command.kind !== "stdio") {
    return false;
  }
  const tokens = [command.command, ...command.args];
  return tokens.some((token) => CHROME_DEVTOOLS_URL_PLACEHOLDERS.some((placeholder) => token.includes(placeholder)));
}
function parseList(value) {
  if (!value) {
    return { all: false, names: /* @__PURE__ */ new Set() };
  }
  const names = value.split(",").map((token) => token.trim().toLowerCase()).filter((token) => token.length > 0);
  if (names.includes("*")) {
    return { all: true, names: /* @__PURE__ */ new Set() };
  }
  return { all: false, names: new Set(names) };
}
function matchesOverride(names, candidates) {
  for (const candidate of candidates) {
    if (names.has(candidate)) {
      return true;
    }
  }
  return false;
}
function coerceLifecycle(raw) {
  if (typeof raw === "string") {
    if (raw === "keep-alive") {
      return { mode: "keep-alive" };
    }
    if (raw === "ephemeral") {
      return { mode: "ephemeral" };
    }
    return void 0;
  }
  if (raw.mode === "keep-alive") {
    const timeout = typeof raw.idleTimeoutMs === "number" && Number.isFinite(raw.idleTimeoutMs) && raw.idleTimeoutMs > 0 ? Math.trunc(raw.idleTimeoutMs) : void 0;
    return timeout ? { mode: "keep-alive", idleTimeoutMs: timeout } : { mode: "keep-alive" };
  }
  if (raw.mode === "ephemeral") {
    return { mode: "ephemeral" };
  }
  return void 0;
}
function isKeepAliveServer(definition) {
  return definition?.lifecycle?.mode === "keep-alive";
}
function keepAliveIdleTimeout(definition) {
  if (definition.lifecycle?.mode !== "keep-alive") {
    return void 0;
  }
  return definition.lifecycle.idleTimeoutMs;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config-normalize.js
function normalizeServerEntry(name, raw, baseDir, source, sources) {
  const resolvedRaw = resolveConfigEnvPlaceholders(name, raw);
  raw = resolvedRaw;
  const description = raw.description;
  const env = raw.env ? { ...raw.env } : void 0;
  const auth2 = normalizeAuth(raw.auth);
  const tokenCacheDir = normalizePath(raw.tokenCacheDir ?? raw.token_cache_dir);
  const clientName = raw.clientName ?? raw.client_name;
  const oauthClientId = raw.oauthClientId ?? raw.oauth_client_id ?? void 0;
  const oauthClientSecret = raw.oauthClientSecret ?? raw.oauth_client_secret ?? void 0;
  const oauthClientSecretEnv = raw.oauthClientSecretEnv ?? raw.oauth_client_secret_env ?? void 0;
  const oauthTokenEndpointAuthMethod = raw.oauthTokenEndpointAuthMethod ?? raw.oauth_token_endpoint_auth_method ?? void 0;
  const oauthRedirectUrl = raw.oauthRedirectUrl ?? raw.oauth_redirect_url ?? void 0;
  const oauthScope = raw.oauthScope ?? raw.oauth_scope ?? void 0;
  const refresh = normalizeRefresh(raw.refresh);
  const httpFetch = normalizeHttpFetch(raw.httpFetch ?? raw.http_fetch);
  const oauthCommandRaw = raw.oauthCommand ?? raw.oauth_command;
  const oauthCommand = oauthCommandRaw ? { args: [...oauthCommandRaw.args] } : void 0;
  const headers = buildHeaders(raw);
  const httpUrl = getUrl(raw);
  const stdio = getCommand(raw, baseDir);
  let command;
  if (httpUrl) {
    command = {
      kind: "http",
      url: new URL(httpUrl),
      headers: ensureHttpAcceptHeader(headers)
    };
  } else if (stdio) {
    command = {
      kind: "stdio",
      command: stdio.command,
      args: stdio.args,
      cwd: resolveCwd(raw.cwd, baseDir)
    };
  } else {
    throw new Error(`Server '${name}' is missing a baseUrl/url or command definition in mcporter.json`);
  }
  const lifecycle = resolveLifecycle(name, raw.lifecycle, command);
  const logging = normalizeLogging(raw.logging);
  const allowedTools = raw.allowedTools ?? raw.allowed_tools;
  const blockedTools = raw.blockedTools ?? raw.blocked_tools;
  const defaultedOauthCommand = !oauthCommand && name.toLowerCase() === "gmail" && command.kind === "stdio" ? { args: ["auth", "http://localhost:3000/oauth2callback"] } : oauthCommand;
  return {
    name,
    description,
    command,
    env,
    auth: auth2,
    tokenCacheDir,
    clientName,
    oauthClientId,
    oauthClientSecret,
    oauthClientSecretEnv,
    oauthTokenEndpointAuthMethod,
    oauthRedirectUrl,
    oauthScope,
    oauthCommand: defaultedOauthCommand,
    refresh,
    httpFetch,
    source,
    sources,
    lifecycle,
    logging,
    ...allowedTools !== void 0 ? { allowedTools: [...allowedTools] } : {},
    ...blockedTools !== void 0 ? { blockedTools: [...blockedTools] } : {}
  };
}
function resolveConfigEnvPlaceholders(name, raw) {
  return resolveConfigEnvValue(name, raw, []);
}
function resolveConfigEnvValue(name, value, pathSegments) {
  if (typeof value === "string") {
    if (!value.includes("$") || shouldDeferEnvResolution(pathSegments)) {
      return value;
    }
    try {
      return resolveEnvPlaceholders(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const field = pathSegments.join(".") || "<root>";
      throw new Error(`Server '${name}' field '${field}' has unresolved env placeholder: ${message}`, { cause: error });
    }
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveConfigEnvValue(name, entry, [...pathSegments, String(index)]));
  }
  if (value && typeof value === "object") {
    const resolved = {};
    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = resolveConfigEnvValue(name, entry, [...pathSegments, key]);
    }
    return resolved;
  }
  return value;
}
function shouldDeferEnvResolution(pathSegments) {
  const [root] = pathSegments;
  const field = pathSegments.at(-1) ?? "";
  return root === "headers" || root === "env" || field === "bearerToken" || field === "bearer_token" || field.endsWith("Env") || field.endsWith("_env");
}
function normalizeAuth(auth2) {
  if (!auth2) {
    return void 0;
  }
  if (auth2.toLowerCase() === "oauth") {
    return "oauth";
  }
  if (auth2.toLowerCase() === "refreshable_bearer") {
    return "refreshable_bearer";
  }
  return void 0;
}
function normalizeRefresh(raw) {
  const tokenEndpoint = raw?.tokenEndpoint ?? raw?.token_endpoint;
  if (!tokenEndpoint) {
    return void 0;
  }
  return {
    tokenEndpoint,
    clientIdEnv: raw?.clientIdEnv ?? raw?.client_id_env,
    clientSecretEnv: raw?.clientSecretEnv ?? raw?.client_secret_env,
    clientAuthMethod: raw?.clientAuthMethod ?? raw?.client_auth_method,
    refreshSkewSeconds: raw?.refreshSkewSeconds ?? raw?.refresh_skew_seconds,
    accessTokenEnv: raw?.accessTokenEnv ?? raw?.access_token_env
  };
}
function normalizeHttpFetch(value) {
  return value;
}
function normalizePath(input) {
  if (!input) {
    return void 0;
  }
  return expandHome(input);
}
function resolveCwd(input, baseDir) {
  if (!input) {
    return baseDir;
  }
  return path8.resolve(baseDir, expandHome(input));
}
function getUrl(raw) {
  return raw.baseUrl ?? raw.base_url ?? raw.url ?? raw.serverUrl ?? raw.server_url ?? void 0;
}
function getCommand(raw, baseDir) {
  const commandValue = raw.command ?? raw.executable;
  if (Array.isArray(commandValue)) {
    if (commandValue.length === 0 || typeof commandValue[0] !== "string") {
      return void 0;
    }
    return { command: commandValue[0], args: commandValue.slice(1) };
  }
  if (typeof commandValue === "string" && commandValue.length > 0) {
    const args = Array.isArray(raw.args) ? raw.args : [];
    if (args.length > 0) {
      return { command: commandValue, args };
    }
    if (isExistingCommandPath(commandValue, baseDir)) {
      return { command: commandValue, args: [] };
    }
    const tokens = parseCommandString(commandValue);
    if (tokens.length === 0) {
      return void 0;
    }
    const [commandToken, ...rest] = tokens;
    if (!commandToken) {
      return void 0;
    }
    return { command: commandToken, args: rest };
  }
  return void 0;
}
function isExistingCommandPath(value, baseDir) {
  const trimmed = value.trim();
  if (!trimmed.includes(" ")) {
    return false;
  }
  if (!looksLikePath(trimmed)) {
    return false;
  }
  const expanded = expandHome(trimmed);
  const resolved = path8.isAbsolute(expanded) ? expanded : path8.resolve(baseDir, expanded);
  try {
    return fs5.statSync(resolved).isFile();
  } catch {
    return false;
  }
}
function looksLikePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("~/");
}
function buildHeaders(raw) {
  const headers = {};
  if (raw.headers) {
    Object.assign(headers, raw.headers);
  }
  const bearerToken = raw.bearerToken ?? raw.bearer_token;
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  const bearerTokenEnv = raw.bearerTokenEnv ?? raw.bearer_token_env;
  if (bearerTokenEnv) {
    headers.Authorization = `$env:${bearerTokenEnv}`;
  }
  return Object.keys(headers).length > 0 ? headers : void 0;
}
function ensureHttpAcceptHeader(headers) {
  const requiredAccept = "application/json, text/event-stream";
  const normalized = headers ? { ...headers } : {};
  const acceptKey = Object.keys(normalized).find((key) => key.toLowerCase() === "accept");
  const currentValue = acceptKey ? normalized[acceptKey] : void 0;
  if (!currentValue || !hasRequiredAcceptTokens(currentValue)) {
    normalized[acceptKey ?? "accept"] = requiredAccept;
  }
  return Object.keys(normalized).length > 0 ? normalized : void 0;
}
function hasRequiredAcceptTokens(value) {
  const lower = value.toLowerCase();
  return lower.includes("application/json") && lower.includes("text/event-stream");
}
function parseCommandString(value) {
  const result = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;
  for (const char of value.trim()) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escapeNext) {
    current += "\\";
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result;
}
function normalizeLogging(raw) {
  if (!raw) {
    return void 0;
  }
  if (raw.daemon) {
    const logging = { daemon: { enabled: raw.daemon.enabled } };
    return logging;
  }
  return void 0;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/fs-json.js
import crypto from "node:crypto";
import { constants } from "node:fs";
import fs6 from "node:fs/promises";
import path9 from "node:path";
var DEFAULT_LOCK_TIMEOUT_MS = 3e4;
var LOCK_POLL_MS = 25;
var MALFORMED_LOCK_STALE_MS = 1e3;
var MAX_SYMLINK_DEPTH = 40;
var DEFAULT_ATOMIC_FILE_MODE = 384;
var localLockTails = /* @__PURE__ */ new Map();
async function readJsonFile(filePath) {
  try {
    const content = await fs6.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
async function writeTextFileAtomic(filePath, data) {
  const target = await resolveAtomicWriteTarget(filePath);
  await fs6.mkdir(path9.dirname(target.path), { recursive: true });
  const tempPath = path9.join(path9.dirname(target.path), `.${path9.basename(target.path)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`);
  try {
    if (target.mode !== void 0) {
      await fs6.access(target.path, constants.W_OK);
    }
    await fs6.writeFile(tempPath, data, {
      encoding: "utf8",
      flag: "wx",
      mode: target.mode ?? DEFAULT_ATOMIC_FILE_MODE
    });
    if (target.mode !== void 0) {
      await fs6.chmod(tempPath, target.mode);
    }
    await fs6.rename(tempPath, target.path);
  } catch (error) {
    await fs6.unlink(tempPath).catch(() => {
    });
    if (target.mode !== void 0 && isPermissionError(error)) {
      await fs6.writeFile(filePath, data, "utf8");
      return;
    }
    throw error;
  }
}
async function writeJsonFile(filePath, data) {
  await writeTextFileAtomic(filePath, JSON.stringify(data, null, 2));
}
async function withFileLock(filePath, task, options = {}) {
  const lockTargetPath = await resolvePathFollowingSymlinks(filePath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const startedAt = Date.now();
  return withLocalLock(lockTargetPath, timeoutMs, async () => {
    await fs6.mkdir(path9.dirname(lockTargetPath), { recursive: true });
    let lockPath = `${lockTargetPath}.lock`;
    const fallbackLockPath = lockTargetPath !== filePath ? `${filePath}.lock` : void 0;
    let acquired = false;
    while (!acquired) {
      try {
        await fs6.writeFile(lockPath, `${process.pid}
${(/* @__PURE__ */ new Date()).toISOString()}
`, {
          encoding: "utf8",
          flag: "wx"
        });
        acquired = true;
        break;
      } catch (error) {
        if (fallbackLockPath && lockPath !== fallbackLockPath && isPermissionError(error)) {
          await fs6.mkdir(path9.dirname(fallbackLockPath), { recursive: true });
          lockPath = fallbackLockPath;
          continue;
        }
        if (error.code !== "EEXIST") {
          throw error;
        }
        if (await removeRecoverableLock(lockPath)) {
          continue;
        }
        if (Date.now() - startedAt > timeoutMs) {
          throw new Error(`Timed out waiting for file lock ${lockPath}`, { cause: error });
        }
        await sleep(LOCK_POLL_MS);
      }
    }
    try {
      return await task();
    } finally {
      await fs6.unlink(lockPath).catch((error) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      });
    }
  });
}
function isPermissionError(error) {
  const code = error.code;
  return code === "EACCES" || code === "EPERM";
}
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function withLocalLock(key, timeoutMs, task) {
  const previous = localLockTails.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  localLockTails.set(key, tail);
  try {
    await waitForLocalLock(previous, timeoutMs, key);
    return await task();
  } finally {
    release();
    void tail.then(() => {
      if (localLockTails.get(key) === tail) {
        localLockTails.delete(key);
      }
    });
  }
}
async function waitForLocalLock(previous, timeoutMs, key) {
  let timer;
  try {
    await Promise.race([
      previous,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for file lock ${key}.lock`)), Math.max(0, timeoutMs));
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
async function resolveAtomicWriteTarget(filePath) {
  try {
    const stats = await fs6.lstat(filePath);
    if (stats.isSymbolicLink()) {
      const targetPath = await resolvePathFollowingSymlinks(filePath);
      return { path: targetPath, mode: await readMode(targetPath) };
    }
    return { path: filePath, mode: stats.mode & 511 };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: filePath };
    }
    throw error;
  }
}
async function resolvePathFollowingSymlinks(filePath) {
  let currentPath = await canonicalizeParentDirectory(filePath);
  for (let depth = 0; depth < MAX_SYMLINK_DEPTH; depth += 1) {
    let stats;
    try {
      stats = await fs6.lstat(currentPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return await canonicalizeParentDirectory(currentPath);
      }
      throw error;
    }
    if (!stats.isSymbolicLink()) {
      return currentPath;
    }
    const link = await fs6.readlink(currentPath);
    currentPath = await canonicalizeParentDirectory(path9.isAbsolute(link) ? link : path9.resolve(path9.dirname(currentPath), link));
  }
  throw new Error(`Too many symbolic links while resolving ${filePath}`);
}
async function canonicalizeParentDirectory(filePath) {
  try {
    return path9.join(await fs6.realpath(path9.dirname(filePath)), path9.basename(filePath));
  } catch (error) {
    if (error.code === "ENOENT") {
      return filePath;
    }
    throw error;
  }
}
async function readMode(filePath) {
  try {
    const stats = await fs6.stat(filePath);
    return stats.mode & 511;
  } catch (error) {
    if (error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
async function removeRecoverableLock(lockPath) {
  const breakerPath = `${lockPath}.break`;
  try {
    await fs6.writeFile(breakerPath, `${process.pid}
${(/* @__PURE__ */ new Date()).toISOString()}
`, {
      encoding: "utf8",
      flag: "wx"
    });
  } catch (error) {
    if (error.code !== "EEXIST") {
      return false;
    }
    if (!await isLockRecoverable(breakerPath)) {
      return false;
    }
    await fs6.unlink(breakerPath).catch(() => {
    });
    return false;
  }
  try {
    if (!await isLockRecoverable(lockPath)) {
      return false;
    }
    await fs6.unlink(lockPath);
    return true;
  } catch (error) {
    return error.code === "ENOENT";
  } finally {
    await fs6.unlink(breakerPath).catch(() => {
    });
  }
}
async function isLockRecoverable(lockPath) {
  let contents;
  try {
    contents = await fs6.readFile(lockPath, "utf8");
  } catch (error) {
    return error.code === "ENOENT";
  }
  if (contents.length === 0) {
    return await isMalformedLockStale(lockPath);
  }
  const pid = Number.parseInt(contents.split(/\r?\n/, 1)[0] ?? "", 10);
  if (Number.isInteger(pid) && pid > 0) {
    return !isProcessRunning(pid);
  }
  return await isMalformedLockStale(lockPath);
}
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function isMalformedLockStale(lockPath) {
  try {
    const stats = await fs6.stat(lockPath);
    return Date.now() - stats.mtimeMs > MALFORMED_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/config.js
async function loadServerDefinitions(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const layers = await loadConfigLayers(options, rootDir);
  const merged = /* @__PURE__ */ new Map();
  for (const layer of layers) {
    const configuredImports = layer.config.imports;
    const imports = configuredImports ? configuredImports.length === 0 ? configuredImports : [...configuredImports, ...DEFAULT_IMPORTS.filter((kind) => !configuredImports.includes(kind))] : DEFAULT_IMPORTS;
    for (const importKind of imports) {
      const candidates = pathsForImport(importKind, rootDir);
      for (const candidate of candidates) {
        const resolved = expandHome(candidate);
        const entries = await readExternalEntries(resolved, { projectRoot: rootDir, importKind });
        if (!entries) {
          continue;
        }
        for (const [name, rawEntry] of entries) {
          const source = { kind: "import", path: resolved, importKind };
          const baseDir = path10.dirname(resolved);
          try {
            normalizeServerEntry(name, rawEntry, baseDir, source, [source]);
          } catch {
            continue;
          }
          if (merged.has(name)) {
            continue;
          }
          const existing = merged.get(name);
          if (existing) {
            existing.sources.push(source);
            continue;
          }
          merged.set(name, {
            raw: rawEntry,
            baseDir,
            source,
            sources: [source]
          });
        }
      }
    }
    for (const [name, entryRaw] of Object.entries(layer.config.mcpServers)) {
      const source = { kind: "local", path: layer.path };
      const parsed = RawEntrySchema.parse(entryRaw);
      const existing = merged.get(name);
      if (existing) {
        const sources = [source, ...existing.sources];
        merged.set(name, { raw: parsed, baseDir: path10.dirname(layer.path), source, sources });
        continue;
      }
      merged.set(name, {
        raw: parsed,
        baseDir: path10.dirname(layer.path),
        source,
        sources: [source]
      });
    }
  }
  const servers = [];
  for (const [name, { raw, baseDir: entryBaseDir, source, sources }] of merged) {
    try {
      servers.push(normalizeServerEntry(name, raw, entryBaseDir, source, sources));
    } catch (error) {
      if (source.kind !== "import") {
        throw error;
      }
    }
  }
  return servers;
}
async function loadDaemonConfig(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const layers = await loadConfigLayers(options, rootDir);
  let idleTimeoutMs;
  for (const layer of layers) {
    const raw = layer.config.daemonIdleTimeoutMs ?? layer.config.daemon_idle_timeout_ms;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      idleTimeoutMs = Math.trunc(raw);
    }
  }
  return { idleTimeoutMs };
}
async function listConfigLayerPaths2(options = {}, rootDir = process.cwd()) {
  return await listConfigLayerPaths(options, rootDir);
}
async function writeRawConfig(targetPath, config) {
  const serialized = `${JSON.stringify(config, null, 2)}
`;
  await writeTextFileAtomic(targetPath, serialized);
}

// node_modules/.pnpm/pkce-challenge@5.0.1/node_modules/pkce-challenge/dist/index.node.js
var crypto2;
crypto2 = globalThis.crypto?.webcrypto ?? // Node.js [18-16] REPL
globalThis.crypto ?? // Node.js >18
import("node:crypto").then((m) => m.webcrypto);
async function getRandomValues(size) {
  return (await crypto2).getRandomValues(new Uint8Array(size));
}
async function random(size) {
  const mask = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const evenDistCutoff = Math.pow(2, 8) - Math.pow(2, 8) % mask.length;
  let result = "";
  while (result.length < size) {
    const randomBytes = await getRandomValues(size - result.length);
    for (const randomByte of randomBytes) {
      if (randomByte < evenDistCutoff) {
        result += mask[randomByte % mask.length];
      }
    }
  }
  return result;
}
async function generateVerifier(length) {
  return await random(length);
}
async function generateChallenge(code_verifier) {
  const buffer = await (await crypto2).subtle.digest("SHA-256", new TextEncoder().encode(code_verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\//g, "_").replace(/\+/g, "-").replace(/=/g, "");
}
async function pkceChallenge(length) {
  if (!length)
    length = 43;
  if (length < 43 || length > 128) {
    throw `Expected a length between 43 and 128. Received ${length}.`;
  }
  const verifier = await generateVerifier(length);
  const challenge = await generateChallenge(verifier);
  return {
    code_verifier: verifier,
    code_challenge: challenge
  };
}

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/auth.js
var SafeUrlSchema = url().superRefine((val, ctx) => {
  if (!URL.canParse(val)) {
    ctx.addIssue({
      code: ZodIssueCode.custom,
      message: "URL must be parseable",
      fatal: true
    });
    return NEVER;
  }
}).refine((url2) => {
  const u = new URL(url2);
  return u.protocol !== "javascript:" && u.protocol !== "data:" && u.protocol !== "vbscript:";
}, { message: "URL cannot use javascript:, data:, or vbscript: scheme" });
var OAuthProtectedResourceMetadataSchema = looseObject({
  resource: string().url(),
  authorization_servers: array(SafeUrlSchema).optional(),
  jwks_uri: string().url().optional(),
  scopes_supported: array(string()).optional(),
  bearer_methods_supported: array(string()).optional(),
  resource_signing_alg_values_supported: array(string()).optional(),
  resource_name: string().optional(),
  resource_documentation: string().optional(),
  resource_policy_uri: string().url().optional(),
  resource_tos_uri: string().url().optional(),
  tls_client_certificate_bound_access_tokens: boolean().optional(),
  authorization_details_types_supported: array(string()).optional(),
  dpop_signing_alg_values_supported: array(string()).optional(),
  dpop_bound_access_tokens_required: boolean().optional()
});
var OAuthMetadataSchema = looseObject({
  issuer: string(),
  authorization_endpoint: SafeUrlSchema,
  token_endpoint: SafeUrlSchema,
  registration_endpoint: SafeUrlSchema.optional(),
  scopes_supported: array(string()).optional(),
  response_types_supported: array(string()),
  response_modes_supported: array(string()).optional(),
  grant_types_supported: array(string()).optional(),
  token_endpoint_auth_methods_supported: array(string()).optional(),
  token_endpoint_auth_signing_alg_values_supported: array(string()).optional(),
  service_documentation: SafeUrlSchema.optional(),
  revocation_endpoint: SafeUrlSchema.optional(),
  revocation_endpoint_auth_methods_supported: array(string()).optional(),
  revocation_endpoint_auth_signing_alg_values_supported: array(string()).optional(),
  introspection_endpoint: string().optional(),
  introspection_endpoint_auth_methods_supported: array(string()).optional(),
  introspection_endpoint_auth_signing_alg_values_supported: array(string()).optional(),
  code_challenge_methods_supported: array(string()).optional(),
  client_id_metadata_document_supported: boolean().optional()
});
var OpenIdProviderMetadataSchema = looseObject({
  issuer: string(),
  authorization_endpoint: SafeUrlSchema,
  token_endpoint: SafeUrlSchema,
  userinfo_endpoint: SafeUrlSchema.optional(),
  jwks_uri: SafeUrlSchema,
  registration_endpoint: SafeUrlSchema.optional(),
  scopes_supported: array(string()).optional(),
  response_types_supported: array(string()),
  response_modes_supported: array(string()).optional(),
  grant_types_supported: array(string()).optional(),
  acr_values_supported: array(string()).optional(),
  subject_types_supported: array(string()),
  id_token_signing_alg_values_supported: array(string()),
  id_token_encryption_alg_values_supported: array(string()).optional(),
  id_token_encryption_enc_values_supported: array(string()).optional(),
  userinfo_signing_alg_values_supported: array(string()).optional(),
  userinfo_encryption_alg_values_supported: array(string()).optional(),
  userinfo_encryption_enc_values_supported: array(string()).optional(),
  request_object_signing_alg_values_supported: array(string()).optional(),
  request_object_encryption_alg_values_supported: array(string()).optional(),
  request_object_encryption_enc_values_supported: array(string()).optional(),
  token_endpoint_auth_methods_supported: array(string()).optional(),
  token_endpoint_auth_signing_alg_values_supported: array(string()).optional(),
  display_values_supported: array(string()).optional(),
  claim_types_supported: array(string()).optional(),
  claims_supported: array(string()).optional(),
  service_documentation: string().optional(),
  claims_locales_supported: array(string()).optional(),
  ui_locales_supported: array(string()).optional(),
  claims_parameter_supported: boolean().optional(),
  request_parameter_supported: boolean().optional(),
  request_uri_parameter_supported: boolean().optional(),
  require_request_uri_registration: boolean().optional(),
  op_policy_uri: SafeUrlSchema.optional(),
  op_tos_uri: SafeUrlSchema.optional(),
  client_id_metadata_document_supported: boolean().optional()
});
var OpenIdProviderDiscoveryMetadataSchema = object({
  ...OpenIdProviderMetadataSchema.shape,
  ...OAuthMetadataSchema.pick({
    code_challenge_methods_supported: true
  }).shape
});
var OAuthTokensSchema = object({
  access_token: string(),
  id_token: string().optional(),
  // Optional for OAuth 2.1, but necessary in OpenID Connect
  token_type: string(),
  expires_in: coerce_exports.number().optional(),
  scope: string().optional(),
  refresh_token: string().optional()
}).strip();
var OAuthErrorResponseSchema = object({
  error: string(),
  error_description: string().optional(),
  error_uri: string().optional()
});
var OptionalSafeUrlSchema = SafeUrlSchema.optional().or(literal("").transform(() => void 0));
var OAuthClientMetadataSchema = object({
  redirect_uris: array(SafeUrlSchema),
  token_endpoint_auth_method: string().optional(),
  grant_types: array(string()).optional(),
  response_types: array(string()).optional(),
  client_name: string().optional(),
  client_uri: SafeUrlSchema.optional(),
  logo_uri: OptionalSafeUrlSchema,
  scope: string().optional(),
  contacts: array(string()).optional(),
  tos_uri: OptionalSafeUrlSchema,
  policy_uri: string().optional(),
  jwks_uri: SafeUrlSchema.optional(),
  jwks: any().optional(),
  software_id: string().optional(),
  software_version: string().optional(),
  software_statement: string().optional()
}).strip();
var OAuthClientInformationSchema = object({
  client_id: string(),
  client_secret: string().optional(),
  client_id_issued_at: number().optional(),
  client_secret_expires_at: number().optional()
}).strip();
var OAuthClientInformationFullSchema = OAuthClientMetadataSchema.merge(OAuthClientInformationSchema);
var OAuthClientRegistrationErrorSchema = object({
  error: string(),
  error_description: string().optional()
}).strip();
var OAuthTokenRevocationRequestSchema = object({
  token: string(),
  token_type_hint: string().optional()
}).strip();

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/auth-utils.js
function resourceUrlFromServerUrl(url2) {
  const resourceURL = typeof url2 === "string" ? new URL(url2) : new URL(url2.href);
  resourceURL.hash = "";
  return resourceURL;
}
function checkResourceAllowed({ requestedResource, configuredResource }) {
  const requested = typeof requestedResource === "string" ? new URL(requestedResource) : new URL(requestedResource.href);
  const configured = typeof configuredResource === "string" ? new URL(configuredResource) : new URL(configuredResource.href);
  if (requested.origin !== configured.origin) {
    return false;
  }
  if (requested.pathname.length < configured.pathname.length) {
    return false;
  }
  const requestedPath = requested.pathname.endsWith("/") ? requested.pathname : requested.pathname + "/";
  const configuredPath = configured.pathname.endsWith("/") ? configured.pathname : configured.pathname + "/";
  return requestedPath.startsWith(configuredPath);
}

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/errors.js
var OAuthError = class extends Error {
  constructor(message, errorUri) {
    super(message);
    this.errorUri = errorUri;
    this.name = this.constructor.name;
  }
  /**
   * Converts the error to a standard OAuth error response object
   */
  toResponseObject() {
    const response = {
      error: this.errorCode,
      error_description: this.message
    };
    if (this.errorUri) {
      response.error_uri = this.errorUri;
    }
    return response;
  }
  get errorCode() {
    return this.constructor.errorCode;
  }
};
var InvalidRequestError = class extends OAuthError {
};
InvalidRequestError.errorCode = "invalid_request";
var InvalidClientError = class extends OAuthError {
};
InvalidClientError.errorCode = "invalid_client";
var InvalidGrantError = class extends OAuthError {
};
InvalidGrantError.errorCode = "invalid_grant";
var UnauthorizedClientError = class extends OAuthError {
};
UnauthorizedClientError.errorCode = "unauthorized_client";
var UnsupportedGrantTypeError = class extends OAuthError {
};
UnsupportedGrantTypeError.errorCode = "unsupported_grant_type";
var InvalidScopeError = class extends OAuthError {
};
InvalidScopeError.errorCode = "invalid_scope";
var AccessDeniedError = class extends OAuthError {
};
AccessDeniedError.errorCode = "access_denied";
var ServerError = class extends OAuthError {
};
ServerError.errorCode = "server_error";
var TemporarilyUnavailableError = class extends OAuthError {
};
TemporarilyUnavailableError.errorCode = "temporarily_unavailable";
var UnsupportedResponseTypeError = class extends OAuthError {
};
UnsupportedResponseTypeError.errorCode = "unsupported_response_type";
var UnsupportedTokenTypeError = class extends OAuthError {
};
UnsupportedTokenTypeError.errorCode = "unsupported_token_type";
var InvalidTokenError = class extends OAuthError {
};
InvalidTokenError.errorCode = "invalid_token";
var MethodNotAllowedError = class extends OAuthError {
};
MethodNotAllowedError.errorCode = "method_not_allowed";
var TooManyRequestsError = class extends OAuthError {
};
TooManyRequestsError.errorCode = "too_many_requests";
var InvalidClientMetadataError = class extends OAuthError {
};
InvalidClientMetadataError.errorCode = "invalid_client_metadata";
var InsufficientScopeError = class extends OAuthError {
};
InsufficientScopeError.errorCode = "insufficient_scope";
var InvalidTargetError = class extends OAuthError {
};
InvalidTargetError.errorCode = "invalid_target";
var OAUTH_ERRORS = {
  [InvalidRequestError.errorCode]: InvalidRequestError,
  [InvalidClientError.errorCode]: InvalidClientError,
  [InvalidGrantError.errorCode]: InvalidGrantError,
  [UnauthorizedClientError.errorCode]: UnauthorizedClientError,
  [UnsupportedGrantTypeError.errorCode]: UnsupportedGrantTypeError,
  [InvalidScopeError.errorCode]: InvalidScopeError,
  [AccessDeniedError.errorCode]: AccessDeniedError,
  [ServerError.errorCode]: ServerError,
  [TemporarilyUnavailableError.errorCode]: TemporarilyUnavailableError,
  [UnsupportedResponseTypeError.errorCode]: UnsupportedResponseTypeError,
  [UnsupportedTokenTypeError.errorCode]: UnsupportedTokenTypeError,
  [InvalidTokenError.errorCode]: InvalidTokenError,
  [MethodNotAllowedError.errorCode]: MethodNotAllowedError,
  [TooManyRequestsError.errorCode]: TooManyRequestsError,
  [InvalidClientMetadataError.errorCode]: InvalidClientMetadataError,
  [InsufficientScopeError.errorCode]: InsufficientScopeError,
  [InvalidTargetError.errorCode]: InvalidTargetError
};

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js
var UnauthorizedError = class extends Error {
  constructor(message) {
    super(message ?? "Unauthorized");
  }
};
function isClientAuthMethod(method) {
  return ["client_secret_basic", "client_secret_post", "none"].includes(method);
}
var AUTHORIZATION_CODE_RESPONSE_TYPE = "code";
var AUTHORIZATION_CODE_CHALLENGE_METHOD = "S256";
function selectClientAuthMethod(clientInformation, supportedMethods) {
  const hasClientSecret = clientInformation.client_secret !== void 0;
  if ("token_endpoint_auth_method" in clientInformation && clientInformation.token_endpoint_auth_method && isClientAuthMethod(clientInformation.token_endpoint_auth_method) && (supportedMethods.length === 0 || supportedMethods.includes(clientInformation.token_endpoint_auth_method))) {
    return clientInformation.token_endpoint_auth_method;
  }
  if (supportedMethods.length === 0) {
    return hasClientSecret ? "client_secret_basic" : "none";
  }
  if (hasClientSecret && supportedMethods.includes("client_secret_basic")) {
    return "client_secret_basic";
  }
  if (hasClientSecret && supportedMethods.includes("client_secret_post")) {
    return "client_secret_post";
  }
  if (supportedMethods.includes("none")) {
    return "none";
  }
  return hasClientSecret ? "client_secret_post" : "none";
}
function applyClientAuthentication(method, clientInformation, headers, params) {
  const { client_id, client_secret } = clientInformation;
  switch (method) {
    case "client_secret_basic":
      applyBasicAuth(client_id, client_secret, headers);
      return;
    case "client_secret_post":
      applyPostAuth(client_id, client_secret, params);
      return;
    case "none":
      applyPublicAuth(client_id, params);
      return;
    default:
      throw new Error(`Unsupported client authentication method: ${method}`);
  }
}
function applyBasicAuth(clientId, clientSecret, headers) {
  if (!clientSecret) {
    throw new Error("client_secret_basic authentication requires a client_secret");
  }
  const credentials = btoa(`${clientId}:${clientSecret}`);
  headers.set("Authorization", `Basic ${credentials}`);
}
function applyPostAuth(clientId, clientSecret, params) {
  params.set("client_id", clientId);
  if (clientSecret) {
    params.set("client_secret", clientSecret);
  }
}
function applyPublicAuth(clientId, params) {
  params.set("client_id", clientId);
}
async function parseErrorResponse(input) {
  const statusCode = input instanceof Response ? input.status : void 0;
  const body = input instanceof Response ? await input.text() : input;
  try {
    const result = OAuthErrorResponseSchema.parse(JSON.parse(body));
    const { error, error_description, error_uri } = result;
    const errorClass = OAUTH_ERRORS[error] || ServerError;
    return new errorClass(error_description || "", error_uri);
  } catch (error) {
    const errorMessage = `${statusCode ? `HTTP ${statusCode}: ` : ""}Invalid OAuth error response: ${error}. Raw body: ${body}`;
    return new ServerError(errorMessage);
  }
}
async function auth(provider, options) {
  try {
    return await authInternal(provider, options);
  } catch (error) {
    if (error instanceof InvalidClientError || error instanceof UnauthorizedClientError) {
      await provider.invalidateCredentials?.("all");
      return await authInternal(provider, options);
    } else if (error instanceof InvalidGrantError) {
      await provider.invalidateCredentials?.("tokens");
      return await authInternal(provider, options);
    }
    throw error;
  }
}
async function authInternal(provider, { serverUrl, authorizationCode, scope, resourceMetadataUrl, fetchFn }) {
  const cachedState = await provider.discoveryState?.();
  let resourceMetadata;
  let authorizationServerUrl;
  let metadata;
  let effectiveResourceMetadataUrl = resourceMetadataUrl;
  if (!effectiveResourceMetadataUrl && cachedState?.resourceMetadataUrl) {
    effectiveResourceMetadataUrl = new URL(cachedState.resourceMetadataUrl);
  }
  if (cachedState?.authorizationServerUrl) {
    authorizationServerUrl = cachedState.authorizationServerUrl;
    resourceMetadata = cachedState.resourceMetadata;
    metadata = cachedState.authorizationServerMetadata ?? await discoverAuthorizationServerMetadata(authorizationServerUrl, { fetchFn });
    if (!resourceMetadata) {
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, { resourceMetadataUrl: effectiveResourceMetadataUrl }, fetchFn);
      } catch {
      }
    }
    if (metadata !== cachedState.authorizationServerMetadata || resourceMetadata !== cachedState.resourceMetadata) {
      await provider.saveDiscoveryState?.({
        authorizationServerUrl: String(authorizationServerUrl),
        resourceMetadataUrl: effectiveResourceMetadataUrl?.toString(),
        resourceMetadata,
        authorizationServerMetadata: metadata
      });
    }
  } else {
    const serverInfo = await discoverOAuthServerInfo(serverUrl, { resourceMetadataUrl: effectiveResourceMetadataUrl, fetchFn });
    authorizationServerUrl = serverInfo.authorizationServerUrl;
    metadata = serverInfo.authorizationServerMetadata;
    resourceMetadata = serverInfo.resourceMetadata;
    await provider.saveDiscoveryState?.({
      authorizationServerUrl: String(authorizationServerUrl),
      resourceMetadataUrl: effectiveResourceMetadataUrl?.toString(),
      resourceMetadata,
      authorizationServerMetadata: metadata
    });
  }
  const resource = await selectResourceURL(serverUrl, provider, resourceMetadata);
  const resolvedScope = scope || resourceMetadata?.scopes_supported?.join(" ") || provider.clientMetadata.scope;
  let clientInformation = await Promise.resolve(provider.clientInformation());
  if (!clientInformation) {
    if (authorizationCode !== void 0) {
      throw new Error("Existing OAuth client information is required when exchanging an authorization code");
    }
    const supportsUrlBasedClientId = metadata?.client_id_metadata_document_supported === true;
    const clientMetadataUrl = provider.clientMetadataUrl;
    if (clientMetadataUrl && !isHttpsUrl(clientMetadataUrl)) {
      throw new InvalidClientMetadataError(`clientMetadataUrl must be a valid HTTPS URL with a non-root pathname, got: ${clientMetadataUrl}`);
    }
    const shouldUseUrlBasedClientId = supportsUrlBasedClientId && clientMetadataUrl;
    if (shouldUseUrlBasedClientId) {
      clientInformation = {
        client_id: clientMetadataUrl
      };
      await provider.saveClientInformation?.(clientInformation);
    } else {
      if (!provider.saveClientInformation) {
        throw new Error("OAuth client information must be saveable for dynamic registration");
      }
      const fullInformation = await registerClient(authorizationServerUrl, {
        metadata,
        clientMetadata: provider.clientMetadata,
        scope: resolvedScope,
        fetchFn
      });
      await provider.saveClientInformation(fullInformation);
      clientInformation = fullInformation;
    }
  }
  const nonInteractiveFlow = !provider.redirectUrl;
  if (authorizationCode !== void 0 || nonInteractiveFlow) {
    const tokens2 = await fetchToken(provider, authorizationServerUrl, {
      metadata,
      resource,
      authorizationCode,
      fetchFn
    });
    await provider.saveTokens(tokens2);
    return "AUTHORIZED";
  }
  const tokens = await provider.tokens();
  if (tokens?.refresh_token) {
    try {
      const newTokens = await refreshAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation,
        refreshToken: tokens.refresh_token,
        resource,
        addClientAuthentication: provider.addClientAuthentication,
        fetchFn
      });
      await provider.saveTokens(newTokens);
      return "AUTHORIZED";
    } catch (error) {
      if (!(error instanceof OAuthError) || error instanceof ServerError) {
      } else {
        throw error;
      }
    }
  }
  const state = provider.state ? await provider.state() : void 0;
  const { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
    metadata,
    clientInformation,
    state,
    redirectUrl: provider.redirectUrl,
    scope: resolvedScope,
    resource
  });
  await provider.saveCodeVerifier(codeVerifier);
  await provider.redirectToAuthorization(authorizationUrl);
  return "REDIRECT";
}
function isHttpsUrl(value) {
  if (!value)
    return false;
  try {
    const url2 = new URL(value);
    return url2.protocol === "https:" && url2.pathname !== "/";
  } catch {
    return false;
  }
}
async function selectResourceURL(serverUrl, provider, resourceMetadata) {
  const defaultResource = resourceUrlFromServerUrl(serverUrl);
  if (provider.validateResourceURL) {
    return await provider.validateResourceURL(defaultResource, resourceMetadata?.resource);
  }
  if (!resourceMetadata) {
    return void 0;
  }
  if (!checkResourceAllowed({ requestedResource: defaultResource, configuredResource: resourceMetadata.resource })) {
    throw new Error(`Protected resource ${resourceMetadata.resource} does not match expected ${defaultResource} (or origin)`);
  }
  return new URL(resourceMetadata.resource);
}
function extractWWWAuthenticateParams(res) {
  const authenticateHeader = res.headers.get("WWW-Authenticate");
  if (!authenticateHeader) {
    return {};
  }
  const [type, scheme] = authenticateHeader.split(" ");
  if (type.toLowerCase() !== "bearer" || !scheme) {
    return {};
  }
  const resourceMetadataMatch = extractFieldFromWwwAuth(res, "resource_metadata") || void 0;
  let resourceMetadataUrl;
  if (resourceMetadataMatch) {
    try {
      resourceMetadataUrl = new URL(resourceMetadataMatch);
    } catch {
    }
  }
  const scope = extractFieldFromWwwAuth(res, "scope") || void 0;
  const error = extractFieldFromWwwAuth(res, "error") || void 0;
  return {
    resourceMetadataUrl,
    scope,
    error
  };
}
function extractFieldFromWwwAuth(response, fieldName) {
  const wwwAuthHeader = response.headers.get("WWW-Authenticate");
  if (!wwwAuthHeader) {
    return null;
  }
  const pattern = new RegExp(`${fieldName}=(?:"([^"]+)"|([^\\s,]+))`);
  const match = wwwAuthHeader.match(pattern);
  if (match) {
    return match[1] || match[2];
  }
  return null;
}
async function discoverOAuthProtectedResourceMetadata(serverUrl, opts, fetchFn = fetch) {
  const response = await discoverMetadataWithFallback(serverUrl, "oauth-protected-resource", fetchFn, {
    protocolVersion: opts?.protocolVersion,
    metadataUrl: opts?.resourceMetadataUrl
  });
  if (!response || response.status === 404) {
    await response?.body?.cancel();
    throw new Error(`Resource server does not implement OAuth 2.0 Protected Resource Metadata.`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} trying to load well-known OAuth protected resource metadata.`);
  }
  return OAuthProtectedResourceMetadataSchema.parse(await response.json());
}
async function fetchWithCorsRetry(url2, headers, fetchFn = fetch) {
  try {
    return await fetchFn(url2, { headers });
  } catch (error) {
    if (error instanceof TypeError) {
      if (headers) {
        return fetchWithCorsRetry(url2, void 0, fetchFn);
      } else {
        return void 0;
      }
    }
    throw error;
  }
}
function buildWellKnownPath(wellKnownPrefix, pathname = "", options = {}) {
  if (pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return options.prependPathname ? `${pathname}/.well-known/${wellKnownPrefix}` : `/.well-known/${wellKnownPrefix}${pathname}`;
}
async function tryMetadataDiscovery(url2, protocolVersion, fetchFn = fetch) {
  const headers = {
    "MCP-Protocol-Version": protocolVersion
  };
  return await fetchWithCorsRetry(url2, headers, fetchFn);
}
function shouldAttemptFallback(response, pathname) {
  return !response || response.status >= 400 && response.status < 500 && pathname !== "/";
}
async function discoverMetadataWithFallback(serverUrl, wellKnownType, fetchFn, opts) {
  const issuer = new URL(serverUrl);
  const protocolVersion = opts?.protocolVersion ?? LATEST_PROTOCOL_VERSION;
  let url2;
  if (opts?.metadataUrl) {
    url2 = new URL(opts.metadataUrl);
  } else {
    const wellKnownPath = buildWellKnownPath(wellKnownType, issuer.pathname);
    url2 = new URL(wellKnownPath, opts?.metadataServerUrl ?? issuer);
    url2.search = issuer.search;
  }
  let response = await tryMetadataDiscovery(url2, protocolVersion, fetchFn);
  if (!opts?.metadataUrl && shouldAttemptFallback(response, issuer.pathname)) {
    const rootUrl = new URL(`/.well-known/${wellKnownType}`, issuer);
    response = await tryMetadataDiscovery(rootUrl, protocolVersion, fetchFn);
  }
  return response;
}
function buildDiscoveryUrls(authorizationServerUrl) {
  const url2 = typeof authorizationServerUrl === "string" ? new URL(authorizationServerUrl) : authorizationServerUrl;
  const hasPath = url2.pathname !== "/";
  const urlsToTry = [];
  if (!hasPath) {
    urlsToTry.push({
      url: new URL("/.well-known/oauth-authorization-server", url2.origin),
      type: "oauth"
    });
    urlsToTry.push({
      url: new URL(`/.well-known/openid-configuration`, url2.origin),
      type: "oidc"
    });
    return urlsToTry;
  }
  let pathname = url2.pathname;
  if (pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  urlsToTry.push({
    url: new URL(`/.well-known/oauth-authorization-server${pathname}`, url2.origin),
    type: "oauth"
  });
  urlsToTry.push({
    url: new URL(`/.well-known/openid-configuration${pathname}`, url2.origin),
    type: "oidc"
  });
  urlsToTry.push({
    url: new URL(`${pathname}/.well-known/openid-configuration`, url2.origin),
    type: "oidc"
  });
  return urlsToTry;
}
async function discoverAuthorizationServerMetadata(authorizationServerUrl, { fetchFn = fetch, protocolVersion = LATEST_PROTOCOL_VERSION } = {}) {
  const headers = {
    "MCP-Protocol-Version": protocolVersion,
    Accept: "application/json"
  };
  const urlsToTry = buildDiscoveryUrls(authorizationServerUrl);
  for (const { url: endpointUrl, type } of urlsToTry) {
    const response = await fetchWithCorsRetry(endpointUrl, headers, fetchFn);
    if (!response) {
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 400 && response.status < 500) {
        continue;
      }
      throw new Error(`HTTP ${response.status} trying to load ${type === "oauth" ? "OAuth" : "OpenID provider"} metadata from ${endpointUrl}`);
    }
    if (type === "oauth") {
      return OAuthMetadataSchema.parse(await response.json());
    } else {
      return OpenIdProviderDiscoveryMetadataSchema.parse(await response.json());
    }
  }
  return void 0;
}
async function discoverOAuthServerInfo(serverUrl, opts) {
  let resourceMetadata;
  let authorizationServerUrl;
  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, { resourceMetadataUrl: opts?.resourceMetadataUrl }, opts?.fetchFn);
    if (resourceMetadata.authorization_servers && resourceMetadata.authorization_servers.length > 0) {
      authorizationServerUrl = resourceMetadata.authorization_servers[0];
    }
  } catch {
  }
  if (!authorizationServerUrl) {
    authorizationServerUrl = String(new URL("/", serverUrl));
  }
  const authorizationServerMetadata = await discoverAuthorizationServerMetadata(authorizationServerUrl, { fetchFn: opts?.fetchFn });
  return {
    authorizationServerUrl,
    authorizationServerMetadata,
    resourceMetadata
  };
}
async function startAuthorization(authorizationServerUrl, { metadata, clientInformation, redirectUrl, scope, state, resource }) {
  let authorizationUrl;
  if (metadata) {
    authorizationUrl = new URL(metadata.authorization_endpoint);
    if (!metadata.response_types_supported.includes(AUTHORIZATION_CODE_RESPONSE_TYPE)) {
      throw new Error(`Incompatible auth server: does not support response type ${AUTHORIZATION_CODE_RESPONSE_TYPE}`);
    }
    if (metadata.code_challenge_methods_supported && !metadata.code_challenge_methods_supported.includes(AUTHORIZATION_CODE_CHALLENGE_METHOD)) {
      throw new Error(`Incompatible auth server: does not support code challenge method ${AUTHORIZATION_CODE_CHALLENGE_METHOD}`);
    }
  } else {
    authorizationUrl = new URL("/authorize", authorizationServerUrl);
  }
  const challenge = await pkceChallenge();
  const codeVerifier = challenge.code_verifier;
  const codeChallenge = challenge.code_challenge;
  authorizationUrl.searchParams.set("response_type", AUTHORIZATION_CODE_RESPONSE_TYPE);
  authorizationUrl.searchParams.set("client_id", clientInformation.client_id);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", AUTHORIZATION_CODE_CHALLENGE_METHOD);
  authorizationUrl.searchParams.set("redirect_uri", String(redirectUrl));
  if (state) {
    authorizationUrl.searchParams.set("state", state);
  }
  if (scope) {
    authorizationUrl.searchParams.set("scope", scope);
  }
  if (scope?.includes("offline_access")) {
    authorizationUrl.searchParams.append("prompt", "consent");
  }
  if (resource) {
    authorizationUrl.searchParams.set("resource", resource.href);
  }
  return { authorizationUrl, codeVerifier };
}
function prepareAuthorizationCodeRequest(authorizationCode, codeVerifier, redirectUri) {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: String(redirectUri)
  });
}
async function executeTokenRequest(authorizationServerUrl, { metadata, tokenRequestParams, clientInformation, addClientAuthentication, resource, fetchFn }) {
  const tokenUrl = metadata?.token_endpoint ? new URL(metadata.token_endpoint) : new URL("/token", authorizationServerUrl);
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json"
  });
  if (resource) {
    tokenRequestParams.set("resource", resource.href);
  }
  if (addClientAuthentication) {
    await addClientAuthentication(headers, tokenRequestParams, tokenUrl, metadata);
  } else if (clientInformation) {
    const supportedMethods = metadata?.token_endpoint_auth_methods_supported ?? [];
    const authMethod = selectClientAuthMethod(clientInformation, supportedMethods);
    applyClientAuthentication(authMethod, clientInformation, headers, tokenRequestParams);
  }
  const response = await (fetchFn ?? fetch)(tokenUrl, {
    method: "POST",
    headers,
    body: tokenRequestParams
  });
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return OAuthTokensSchema.parse(await response.json());
}
async function refreshAuthorization(authorizationServerUrl, { metadata, clientInformation, refreshToken, resource, addClientAuthentication, fetchFn }) {
  const tokenRequestParams = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const tokens = await executeTokenRequest(authorizationServerUrl, {
    metadata,
    tokenRequestParams,
    clientInformation,
    addClientAuthentication,
    resource,
    fetchFn
  });
  return { refresh_token: refreshToken, ...tokens };
}
async function fetchToken(provider, authorizationServerUrl, { metadata, resource, authorizationCode, fetchFn } = {}) {
  const scope = provider.clientMetadata.scope;
  let tokenRequestParams;
  if (provider.prepareTokenRequest) {
    tokenRequestParams = await provider.prepareTokenRequest(scope);
  }
  if (!tokenRequestParams) {
    if (!authorizationCode) {
      throw new Error("Either provider.prepareTokenRequest() or authorizationCode is required");
    }
    if (!provider.redirectUrl) {
      throw new Error("redirectUrl is required for authorization_code flow");
    }
    const codeVerifier = await provider.codeVerifier();
    tokenRequestParams = prepareAuthorizationCodeRequest(authorizationCode, codeVerifier, provider.redirectUrl);
  }
  const clientInformation = await provider.clientInformation();
  return executeTokenRequest(authorizationServerUrl, {
    metadata,
    tokenRequestParams,
    clientInformation: clientInformation ?? void 0,
    addClientAuthentication: provider.addClientAuthentication,
    resource,
    fetchFn
  });
}
async function registerClient(authorizationServerUrl, { metadata, clientMetadata, scope, fetchFn }) {
  let registrationUrl;
  if (metadata) {
    if (!metadata.registration_endpoint) {
      throw new Error("Incompatible auth server: does not support dynamic client registration");
    }
    registrationUrl = new URL(metadata.registration_endpoint);
  } else {
    registrationUrl = new URL("/register", authorizationServerUrl);
  }
  const response = await (fetchFn ?? fetch)(registrationUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...clientMetadata,
      ...scope !== void 0 ? { scope } : {}
    })
  });
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return OAuthClientInformationFullSchema.parse(await response.json());
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/error-classifier.js
var AUTH_STATUSES = /* @__PURE__ */ new Set([401, 403]);
var OFFLINE_PATTERNS = [
  "fetch failed",
  "econnrefused",
  "connection refused",
  "connection closed",
  "connection reset",
  "socket hang up",
  "connect timeout",
  "network is unreachable",
  "timed out",
  "timeout",
  "timeout after",
  "getaddrinfo",
  "enotfound",
  "enoent",
  "eai_again",
  "econnaborted",
  "ehostunreach",
  "no such host",
  "failed to start",
  "spawn enoent"
];
var HTTP_STATUS_FALLBACK = /\bhttps?:\/\/[^\s]+(?:\s+returned\s+)?(?:status|code)?\s*(\d{3})\b/i;
var STATUS_DIRECT_PATTERN = /\b(?:status(?:\s+code)?|http(?:\s+(?:status|code|error))?)[:\s]*(\d{3})\b/i;
var STDIO_EXIT_PATTERN = /exit(?:ed)?(?:\s+with)?(?:\s+(?:code|status))\s+(-?\d+)/i;
var STDIO_SIGNAL_PATTERN = /signal\s+([A-Z0-9]+)/i;
function analyzeConnectionError(error) {
  const rawMessage = extractMessage(error);
  if (error instanceof UnauthorizedError) {
    return { kind: "auth", rawMessage };
  }
  const stdio = extractStdioExit(rawMessage);
  if (stdio) {
    return { kind: "stdio-exit", rawMessage, ...stdio };
  }
  const errorCode = extractErrorCode(error);
  const statusCode = errorCode ?? extractStatusCode(rawMessage);
  const normalized = rawMessage.toLowerCase();
  if (AUTH_STATUSES.has(statusCode ?? -1) || containsAuthToken(normalized)) {
    return { kind: "auth", rawMessage, statusCode };
  }
  if (statusCode && statusCode >= 400) {
    return { kind: "http", rawMessage, statusCode };
  }
  if (OFFLINE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return { kind: "offline", rawMessage };
  }
  return { kind: "other", rawMessage };
}
function extractMessage(error) {
  if (error instanceof Error) {
    return error.message ?? "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === void 0 || error === null) {
    return "";
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}
function extractErrorCode(error) {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "number" && Number.isFinite(code) && code >= 100 && code < 600) {
      return code;
    }
  }
  return void 0;
}
function extractStatusCode(message) {
  const candidates = [
    message.match(/status code\s*\((\d{3})\)/i)?.[1],
    message.match(STATUS_DIRECT_PATTERN)?.[1],
    message.match(HTTP_STATUS_FALLBACK)?.[1]
  ].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  const trimmed = message.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const candidate = findStatusInObject(parsed);
      if (typeof candidate === "number") {
        return candidate;
      }
      if (typeof candidate === "string") {
        const numeric = Number.parseInt(candidate, 10);
        if (Number.isFinite(numeric)) {
          return numeric;
        }
      }
    } catch {
    }
  }
  return void 0;
}
function containsAuthToken(normalizedMessage) {
  return normalizedMessage.includes("401") || normalizedMessage.includes("unauthorized") || normalizedMessage.includes("invalid_token") || normalizedMessage.includes("forbidden");
}
function extractStdioExit(message) {
  if (!message.toLowerCase().includes("stdio") && !STDIO_EXIT_PATTERN.test(message)) {
    return void 0;
  }
  const exitMatch = message.match(STDIO_EXIT_PATTERN);
  const signalMatch = message.match(STDIO_SIGNAL_PATTERN);
  if (!exitMatch && !signalMatch) {
    return void 0;
  }
  const exitCode = exitMatch ? Number.parseInt(exitMatch[1] ?? "", 10) : void 0;
  return {
    stdioExitCode: Number.isFinite(exitCode) ? exitCode : void 0,
    stdioSignal: signalMatch?.[1]
  };
}
function findStatusInObject(value) {
  if (!value || typeof value !== "object") {
    return void 0;
  }
  const record = value;
  if (typeof record.status === "number" || typeof record.status === "string") {
    return record.status;
  }
  if (typeof record.code === "number" || typeof record.code === "string") {
    return record.code;
  }
  if (typeof record.error === "object" && record.error !== null) {
    return findStatusInObject(record.error);
  }
  return void 0;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/result-utils.js
function extractEnvelope(raw) {
  return collectEnvelopeFields(raw, { content: null, structuredContent: null }, 0);
}
function collectEnvelopeFields(raw, envelope, depth) {
  if (!raw || typeof raw !== "object") {
    return envelope;
  }
  const obj = raw;
  let { content, structuredContent } = envelope;
  if (!content && "content" in obj && Array.isArray(obj.content)) {
    content = obj.content;
  }
  if (structuredContent === null && "structuredContent" in obj) {
    structuredContent = obj.structuredContent;
  }
  const updated = { content, structuredContent };
  if (depth >= 2) {
    return updated;
  }
  let nested = updated;
  if ("raw" in obj) {
    nested = collectEnvelopeFields(obj.raw, nested, depth + 1);
  }
  if ("result" in obj) {
    nested = collectEnvelopeFields(obj.result, nested, depth + 1);
  }
  return nested;
}
function asString2(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "text" in value) {
    const text = value.text;
    return typeof text === "string" ? text : null;
  }
  return null;
}
function collectCallContent(raw) {
  const envelope = extractEnvelope(raw);
  const textEntries = [];
  const markdownEntries = [];
  const jsonCandidates = [];
  const images = [];
  const rawContents = raw && typeof raw === "object" && Array.isArray(raw.contents) ? raw.contents ?? [] : void 0;
  if (rawContents) {
    for (const resource of rawContents) {
      collectResourcePayload(resource, textEntries, markdownEntries, jsonCandidates);
    }
  }
  if (!envelope.content) {
    return {
      content: envelope.content,
      structuredContent: envelope.structuredContent,
      textEntries,
      markdownEntries,
      jsonCandidates,
      images
    };
  }
  for (const entry of envelope.content) {
    if (typeof entry === "string") {
      const parsed2 = tryParseJson(entry);
      if (parsed2 !== null) {
        jsonCandidates.push(parsed2);
      }
      continue;
    }
    if (!entry || typeof entry !== "object" || !("type" in entry)) {
      continue;
    }
    const typedEntry = entry;
    if (typedEntry.type === "json") {
      const parsed2 = tryParseJson(entry);
      if (parsed2 !== null) {
        jsonCandidates.push(parsed2);
      }
      continue;
    }
    if (typedEntry.type === "image") {
      const data = typedEntry.data;
      const mimeType = typedEntry.mimeType ?? "image/png";
      if (typeof data === "string" && typeof mimeType === "string") {
        images.push({ data, mimeType });
      }
      continue;
    }
    if (typedEntry.type === "resource") {
      const resource = typedEntry.resource;
      collectResourcePayload(resource, textEntries, markdownEntries, jsonCandidates);
      continue;
    }
    if (typedEntry.type !== "text" && typedEntry.type !== "markdown") {
      continue;
    }
    const text = asString2(entry);
    if (!text) {
      continue;
    }
    textEntries.push(text);
    if (typedEntry.type === "markdown") {
      markdownEntries.push(text);
    }
    const parsed = tryParseJson(text);
    if (parsed !== null) {
      jsonCandidates.push(parsed);
    }
  }
  return {
    content: envelope.content,
    structuredContent: envelope.structuredContent,
    textEntries,
    markdownEntries,
    jsonCandidates,
    images
  };
}
function collectResourcePayload(resource, textEntries, markdownEntries, jsonCandidates) {
  if (!resource || typeof resource !== "object") {
    return;
  }
  const record = resource;
  const uri = typeof record.uri === "string" ? record.uri : "";
  const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
  if (typeof record.text === "string") {
    textEntries.push(record.text);
    if (mimeType.toLowerCase().includes("markdown")) {
      markdownEntries.push(record.text);
    }
    const parsed = tryParseJson(record.text);
    if (parsed !== null) {
      jsonCandidates.push(parsed);
    }
  } else if (typeof record.blob === "string") {
    textEntries.push(`[Binary resource: ${uri}]`);
  }
}
function collectText(entries, joiner) {
  if (entries.length === 0) {
    return null;
  }
  return entries.join(joiner);
}
function collectImages(images) {
  if (images.length === 0) {
    return null;
  }
  return images;
}
function unwrapJsonEnvelope(record, fallback) {
  if ("json" in record) {
    return record.json ?? null;
  }
  if ("data" in record) {
    return Object.keys(record).length === 1 ? record.data ?? null : fallback;
  }
  return null;
}
function parseStructuredContent(value) {
  if (value === void 0 || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return tryParseJson(value);
  }
  if (typeof value !== "object") {
    return null;
  }
  const unwrapped = unwrapJsonEnvelope(value, value);
  return unwrapped ?? value;
}
function tryParseJson(value) {
  if (value === void 0 || value === null) {
    return null;
  }
  if (typeof value === "object") {
    const unwrapped = unwrapJsonEnvelope(value, value);
    if (unwrapped !== null) {
      return unwrapped;
    }
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}
function createCallResult(raw) {
  let cachedContent;
  const getCollectedContent = () => {
    if (cachedContent) {
      return cachedContent;
    }
    cachedContent = collectCallContent(raw);
    return cachedContent;
  };
  return {
    raw,
    text(joiner = "\n") {
      if (raw == null) {
        return null;
      }
      if (typeof raw === "string") {
        return raw;
      }
      const collected = getCollectedContent();
      const combinedText = collectText(collected.textEntries, joiner);
      if (combinedText) {
        return combinedText;
      }
      return asString2(collected.structuredContent);
    },
    markdown(joiner = "\n") {
      const collected = getCollectedContent();
      const structured = collected.structuredContent;
      if (structured && typeof structured === "object") {
        const markdown = structured.markdown;
        if (typeof markdown === "string") {
          return markdown;
        }
      }
      return collectText(collected.markdownEntries, joiner);
    },
    json() {
      const collected = getCollectedContent();
      const parsedStructured = parseStructuredContent(collected.structuredContent);
      if (parsedStructured !== null) {
        return parsedStructured;
      }
      if (collected.jsonCandidates.length === 1) {
        return collected.jsonCandidates[0];
      }
      if (collected.jsonCandidates.length > 1) {
        return collected.jsonCandidates;
      }
      if (typeof raw === "string") {
        const parsedRaw = tryParseJson(raw);
        if (parsedRaw !== null) {
          return parsedRaw;
        }
      }
      const textContent = this.text?.();
      if (typeof textContent === "string") {
        const parsedText = tryParseJson(textContent);
        if (parsedText !== null) {
          return parsedText;
        }
      }
      const markdownContent = this.markdown?.();
      if (typeof markdownContent === "string") {
        const parsedMarkdown = tryParseJson(markdownContent);
        if (parsedMarkdown !== null) {
          return parsedMarkdown;
        }
      }
      return null;
    },
    images() {
      const collected = getCollectedContent();
      return collectImages(collected.images);
    },
    content() {
      return getCollectedContent().content;
    },
    structuredContent() {
      return getCollectedContent().structuredContent;
    }
  };
}
function describeConnectionIssue(error) {
  return analyzeConnectionError(error);
}
function wrapCallResult(raw) {
  return { raw, callResult: createCallResult(raw) };
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/logging.js
var LOG_LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
var LOG_LEVEL_ALIASES = {
  warning: "warn",
  verbose: "debug"
};
function parseLogLevel(value, defaultLevel = "warn") {
  if (!value) {
    return defaultLevel;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultLevel;
  }
  const alias = LOG_LEVEL_ALIASES[normalized];
  const candidate = alias ?? (normalized in LOG_LEVEL_ORDER ? normalized : void 0);
  if (!candidate) {
    const allowed = [...Object.keys(LOG_LEVEL_ORDER), ...Object.keys(LOG_LEVEL_ALIASES)].filter((key, index, array2) => array2.indexOf(key) === index).join(", ");
    throw new Error(`Invalid log level '${value}'. Expected one of: ${allowed}.`);
  }
  return candidate;
}
function resolveLogLevelFromEnv(env = process.env, defaultLevel = "warn") {
  try {
    return parseLogLevel(env.MCPORTER_LOG_LEVEL, defaultLevel);
  } catch (error) {
    const raw = env.MCPORTER_LOG_LEVEL;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[mcporter] Ignoring invalid MCPORTER_LOG_LEVEL value '${raw ?? ""}': ${message}`);
    return defaultLevel;
  }
}
function shouldLog(level, threshold) {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[threshold];
}
function createPrefixedConsoleLogger(prefix, level) {
  const threshold = parseLogLevel(level);
  const format = (message) => `[${prefix}] ${message}`;
  return {
    debug(message) {
      if (shouldLog("debug", threshold)) {
        console.debug(format(message));
      }
    },
    info(message) {
      if (shouldLog("info", threshold)) {
        console.log(format(message));
      }
    },
    warn(message) {
      if (shouldLog("warn", threshold)) {
        console.warn(format(message));
      }
    },
    error(message, error) {
      if (shouldLog("error", threshold)) {
        console.error(format(message));
        if (error) {
          console.error(error);
        }
      }
    }
  };
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime-process-utils.js
import { execFile } from "node:child_process";

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js
var import_cross_spawn = __toESM(require_cross_spawn(), 1);
import process2 from "node:process";
import { PassThrough } from "node:stream";
var DEFAULT_INHERITED_ENV_VARS = process2.platform === "win32" ? [
  "APPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "PATH",
  "PROCESSOR_ARCHITECTURE",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERNAME",
  "USERPROFILE",
  "PROGRAMFILES"
] : (
  /* list inspired by the default env inheritance of sudo */
  ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"]
);
function getDefaultEnvironment() {
  const env = {};
  for (const key of DEFAULT_INHERITED_ENV_VARS) {
    const value = process2.env[key];
    if (value === void 0) {
      continue;
    }
    if (value.startsWith("()")) {
      continue;
    }
    env[key] = value;
  }
  return env;
}
var StdioClientTransport = class {
  constructor(server) {
    this._stderrStream = null;
    this._serverParams = server;
    this._readBuffer = new ReadBuffer({ maxBufferSize: server.maxBufferSize });
    if (server.stderr === "pipe" || server.stderr === "overlapped") {
      this._stderrStream = new PassThrough();
    }
  }
  /**
   * Starts the server process and prepares to communicate with it.
   */
  async start() {
    if (this._process) {
      throw new Error("StdioClientTransport already started! If using Client class, note that connect() calls start() automatically.");
    }
    return new Promise((resolve, reject) => {
      this._process = (0, import_cross_spawn.default)(this._serverParams.command, this._serverParams.args ?? [], {
        // merge default env with server env because mcp server needs some env vars
        env: {
          ...getDefaultEnvironment(),
          ...this._serverParams.env
        },
        stdio: ["pipe", "pipe", this._serverParams.stderr ?? "inherit"],
        shell: false,
        windowsHide: process2.platform === "win32",
        cwd: this._serverParams.cwd
      });
      this._process.on("error", (error) => {
        reject(error);
        this.onerror?.(error);
      });
      this._process.on("spawn", () => {
        resolve();
      });
      this._process.on("close", (_code) => {
        this._process = void 0;
        this.onclose?.();
      });
      this._process.stdin?.on("error", (error) => {
        this.onerror?.(error);
      });
      this._process.stdout?.on("data", (chunk) => {
        try {
          this._readBuffer.append(chunk);
          this.processReadBuffer();
        } catch (error) {
          this.onerror?.(error);
          this.close().catch(() => {
          });
        }
      });
      this._process.stdout?.on("error", (error) => {
        this.onerror?.(error);
      });
      if (this._stderrStream && this._process.stderr) {
        this._process.stderr.pipe(this._stderrStream);
      }
    });
  }
  /**
   * The stderr stream of the child process, if `StdioServerParameters.stderr` was set to "pipe" or "overlapped".
   *
   * If stderr piping was requested, a PassThrough stream is returned _immediately_, allowing callers to
   * attach listeners before the start method is invoked. This prevents loss of any early
   * error output emitted by the child process.
   */
  get stderr() {
    if (this._stderrStream) {
      return this._stderrStream;
    }
    return this._process?.stderr ?? null;
  }
  /**
   * The child process pid spawned by this transport.
   *
   * This is only available after the transport has been started.
   */
  get pid() {
    return this._process?.pid ?? null;
  }
  processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }
  async close() {
    if (this._process) {
      const processToClose = this._process;
      this._process = void 0;
      const closePromise = new Promise((resolve) => {
        processToClose.once("close", () => {
          resolve();
        });
      });
      try {
        processToClose.stdin?.end();
      } catch {
      }
      await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, 2e3).unref())]);
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGTERM");
        } catch {
        }
        await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, 2e3).unref())]);
      }
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGKILL");
        } catch {
        }
      }
    }
    this._readBuffer.clear();
  }
  send(message) {
    return new Promise((resolve) => {
      if (!this._process?.stdin) {
        throw new Error("Not connected");
      }
      const json = serializeMessage(message);
      if (this._process.stdin.write(json)) {
        resolve();
      } else {
        this._process.stdin.once("drain", resolve);
      }
    });
  }
};

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime-process-utils.js
async function closeTransportAndWait(logger, transport, options = {}) {
  const pidBeforeClose = getTransportPid(transport);
  const childProcess = transport instanceof StdioClientTransport ? transport._process ?? null : null;
  let closeError;
  try {
    await transport.close();
  } catch (error) {
    if (options.throwOnCloseError) {
      closeError = error;
    } else {
      logger.warn(`Failed to close transport cleanly: ${error.message}`);
    }
  }
  if (childProcess) {
    await waitForChildClose(childProcess, 1e3).catch(() => {
    });
  }
  if (closeError) {
    throw closeError;
  }
  if (!pidBeforeClose) {
    return;
  }
  await ensureProcessTerminated(logger, pidBeforeClose);
}
function getTransportPid(transport) {
  if (transport instanceof StdioClientTransport) {
    const pid = transport.pid;
    return typeof pid === "number" && pid > 0 ? pid : null;
  }
  if ("pid" in transport) {
    const candidate = transport.pid;
    if (typeof candidate === "number" && candidate > 0) {
      return candidate;
    }
  }
  const rawPid = transport._process?.pid;
  return typeof rawPid === "number" && rawPid > 0 ? rawPid : null;
}
async function ensureProcessTerminated(logger, pid) {
  await ensureProcessTreeTerminated(logger, pid);
}
async function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null && child.exitCode !== void 0) {
    return;
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const timeout = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`Timed out waiting ${timeoutMs}ms for child process to close.`));
    };
    const cleanup = () => {
      child.removeListener("close", finish);
      child.removeListener("exit", finish);
      child.removeListener("error", finish);
      if (timer) {
        clearTimeout(timer);
      }
    };
    child.once("close", finish);
    child.once("exit", finish);
    child.once("error", finish);
    let timer;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(timeout, timeoutMs);
      timer.unref?.();
    }
  });
  try {
    child.stdin?.end?.();
  } catch {
  }
  try {
    child.stdout?.destroy?.();
    child.stdout?.removeAllListeners?.();
    child.stdout?.unref?.();
  } catch {
  }
  try {
    child.stderr?.destroy?.();
    child.stderr?.removeAllListeners?.();
    child.stderr?.unref?.();
  } catch {
  }
  try {
    const stdio = child.stdio;
    if (Array.isArray(stdio)) {
      for (const stream of stdio) {
        if (!stream || typeof stream !== "object") {
          continue;
        }
        try {
          stream.removeAllListeners?.();
          stream.destroy?.();
          stream.end?.();
        } catch {
        }
      }
    }
  } catch {
  }
  try {
    child.removeAllListeners();
  } catch {
  }
  try {
    child.unref?.();
  } catch {
  }
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function ensureProcessTreeTerminated(logger, rootPid) {
  if (!isProcessAlive(rootPid)) {
    return;
  }
  let targets = await collectProcessTreePids(rootPid);
  if (await waitForTreeExit(targets, 300)) {
    return;
  }
  await sendSignalToTargets(targets, "SIGTERM");
  targets = await collectProcessTreePids(rootPid);
  if (await waitForTreeExit(targets, 700)) {
    return;
  }
  targets = await collectProcessTreePids(rootPid);
  await sendSignalToTargets(targets, "SIGKILL");
  if (await waitForTreeExit(targets, 500)) {
    return;
  }
  logger.warn(`Process tree rooted at pid=${rootPid} did not exit after SIGKILL.`);
}
async function sendSignalToTargets(pids, signal) {
  const seen = /* @__PURE__ */ new Set();
  for (const pid of pids) {
    if (seen.has(pid)) {
      continue;
    }
    seen.add(pid);
    sendSignal(pid, signal);
  }
}
function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
}
async function listDescendantPids(rootPid) {
  if (!isProcessAlive(rootPid)) {
    return [];
  }
  if (process.platform === "win32") {
    return listDescendantPidsWindows(rootPid);
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid="]);
    const children = /* @__PURE__ */ new Map();
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const [pidText, ppidText] = trimmed.split(/\s+/, 2);
      const pid = Number.parseInt(pidText ?? "", 10);
      const ppid = Number.parseInt(ppidText ?? "", 10);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
        continue;
      }
      const bucket = children.get(ppid) ?? [];
      bucket.push(pid);
      children.set(ppid, bucket);
    }
    return collectDescendantsFromChildren(rootPid, children);
  } catch {
    return [];
  }
}
async function listDescendantPidsWindows(rootPid) {
  try {
    const powershellScript = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", powershellScript]);
    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }
    const parsed = JSON.parse(trimmed);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const children = /* @__PURE__ */ new Map();
    for (const entry of entries) {
      const pidCandidate = entry?.ProcessId;
      const ppidCandidate = entry?.ParentProcessId;
      if (typeof pidCandidate !== "number" || typeof ppidCandidate !== "number") {
        continue;
      }
      const pid = Number.isFinite(pidCandidate) ? pidCandidate : void 0;
      const ppid = Number.isFinite(ppidCandidate) ? ppidCandidate : void 0;
      if (pid === void 0 || ppid === void 0) {
        continue;
      }
      const bucket = children.get(ppid) ?? [];
      bucket.push(pid);
      children.set(ppid, bucket);
    }
    return collectDescendantsFromChildren(rootPid, children);
  } catch {
    return [];
  }
}
function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
async function collectProcessTreePids(rootPid) {
  const descendants = await listDescendantPids(rootPid);
  return [...descendants, rootPid];
}
function collectDescendantsFromChildren(rootPid, children) {
  const result = [];
  const queue = [...children.get(rootPid) ?? []];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === void 0) {
      continue;
    }
    result.push(current);
    for (const child of children.get(current) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}
async function waitForTreeExit(pids, durationMs) {
  const deadline = Date.now() + durationMs;
  while (true) {
    if (pids.every((pid) => !isProcessAlive(pid))) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    const remaining = Math.max(10, Math.min(100, deadline - Date.now()));
    await delay(remaining);
  }
}
function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === "function") {
      timer.unref?.();
    }
  });
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/sdk-patches.js
var PROCESS_BUFFERS = /* @__PURE__ */ new WeakMap();
var TRANSPORT_BUFFERS = /* @__PURE__ */ new WeakMap();
var STDIO_LOGS_FORCED = process.env.MCPORTER_STDIO_LOGS === "1";
var STDIO_TRACE_ENABLED = process.env.MCPORTER_STDIO_TRACE === "1";
var stdioLogMode = STDIO_LOGS_FORCED ? "always" : "auto";
function evaluateStdioLogPolicy(mode, hasStderr, exitCode) {
  if (!hasStderr) {
    return false;
  }
  if (mode === "silent") {
    return false;
  }
  if (mode === "always") {
    return true;
  }
  return typeof exitCode === "number" && exitCode !== 0;
}
function shouldPrintStdioLogs(meta) {
  return evaluateStdioLogPolicy(stdioLogMode, meta.stderrChunks.length > 0, meta.code);
}
if (STDIO_TRACE_ENABLED) {
  console.log("[mcporter] STDIO trace logging enabled (set MCPORTER_STDIO_TRACE=0 to disable).");
}
function ignoreEmitterError() {
}
function destroyStream(stream) {
  if (!stream || typeof stream !== "object") {
    return;
  }
  const emitter = stream;
  try {
    emitter.on?.("error", ignoreEmitterError);
  } catch {
  }
  try {
    emitter.destroy?.();
  } catch {
  }
  try {
    emitter.end?.();
  } catch {
  }
  try {
    emitter.unref?.();
  } catch {
  }
  try {
    emitter.off?.("error", ignoreEmitterError);
  } catch {
  }
  try {
    emitter.removeListener?.("error", ignoreEmitterError);
  } catch {
  }
}
function waitForChildClose2(child, timeoutMs) {
  if (!child) {
    return Promise.resolve();
  }
  if (child.exitCode !== null && child.exitCode !== void 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    try {
      child.on?.("error", ignoreEmitterError);
    } catch {
    }
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const timeout = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error(`Timed out waiting ${timeoutMs}ms for child process to close.`));
    };
    const cleanup = () => {
      child.removeListener("exit", finish);
      child.removeListener("close", finish);
      child.removeListener("error", finish);
      try {
        child.removeListener?.("error", ignoreEmitterError);
      } catch {
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
    child.once("exit", finish);
    child.once("close", finish);
    child.once("error", finish);
    let timer;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(timeout, timeoutMs);
      timer.unref?.();
    }
  });
}
function flushProcessLogs(_child, meta) {
  if (meta.flushed) {
    return;
  }
  meta.flushed = true;
  if (STDIO_TRACE_ENABLED) {
    const stderrChunks = meta.stderrChunks.length;
    const stdoutChunks = meta.stdoutChunks?.length ?? 0;
    const stdinChunks = meta.stdinChunks?.length ?? 0;
    const label = meta.command ?? "stdio server";
    console.log(`[mcporter] STDIO trace summary for ${label}: stdin=${stdinChunks} message(s), stdout=${stdoutChunks} chunk(s), stderr=${stderrChunks} chunk(s).`);
  }
  for (const { stream, event, handler } of meta.listeners) {
    try {
      stream.removeListener?.(event, handler);
    } catch {
    }
  }
  meta.listeners.length = 0;
  if (shouldPrintStdioLogs(meta)) {
    const heading = meta.command ? `[mcporter] stderr from ${meta.command}` : "[mcporter] stderr from stdio server";
    console.log(heading);
    process.stdout.write(meta.stderrChunks.join(""));
    if (!meta.stderrChunks[meta.stderrChunks.length - 1]?.endsWith("\n")) {
      console.log("");
    }
  }
  if (STDIO_TRACE_ENABLED && meta.stdoutChunks && meta.stdoutChunks.length > 0) {
    const heading = meta.command ? `[mcporter] stdout from ${meta.command}` : "[mcporter] stdout from stdio server";
    console.log(heading);
    process.stdout.write(meta.stdoutChunks.join(""));
    if (!meta.stdoutChunks[meta.stdoutChunks.length - 1]?.endsWith("\n")) {
      console.log("");
    }
  }
  if (STDIO_TRACE_ENABLED && meta.stdinChunks && meta.stdinChunks.length > 0) {
    const heading = meta.command ? `[mcporter] stdin to ${meta.command}` : "[mcporter] stdin to stdio server";
    console.log(heading);
    for (const entry of meta.stdinChunks) {
      console.log(entry);
    }
  }
  if (meta.child) {
    PROCESS_BUFFERS.delete(meta.child);
  }
  if (meta.transport) {
    TRANSPORT_BUFFERS.delete(meta.transport);
  }
}
function patchStdioClose() {
  const marker = Symbol.for("mcporter.stdio.patched");
  const proto = StdioClientTransport.prototype;
  if (proto[marker]) {
    return;
  }
  patchStdioStart();
  StdioClientTransport.prototype.close = async function patchedClose() {
    const transport = this;
    const child = transport._process ?? null;
    const stderrStream = transport._stderrStream ?? null;
    const meta = (child ? PROCESS_BUFFERS.get(child) : void 0) ?? TRANSPORT_BUFFERS.get(transport);
    if (stderrStream) {
      destroyStream(stderrStream);
      transport._stderrStream = null;
    }
    transport._abortController?.abort();
    transport._abortController = null;
    transport._readBuffer?.clear?.();
    transport._readBuffer = null;
    if (!child) {
      transport.onclose?.();
      return;
    }
    destroyStream(child.stdin);
    destroyStream(child.stdout);
    destroyStream(child.stderr);
    const stdio = Array.isArray(child.stdio) ? child.stdio : [];
    for (const stream of stdio) {
      destroyStream(stream);
    }
    let exited = await waitForChildClose2(child, 700).then(() => true, () => false);
    if (!exited) {
      try {
        child.kill("SIGTERM");
      } catch {
      }
      exited = await waitForChildClose2(child, 700).then(() => true, () => false);
    }
    if (!exited) {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      await waitForChildClose2(child, 500).catch(() => {
      });
    }
    destroyStream(child.stdin);
    destroyStream(child.stdout);
    destroyStream(child.stderr);
    const stdioAfter = Array.isArray(child.stdio) ? child.stdio : [];
    for (const stream of stdioAfter) {
      destroyStream(stream);
    }
    child.unref?.();
    if (meta) {
      flushProcessLogs(meta.child ?? child, meta);
    } else if (STDIO_TRACE_ENABLED) {
      console.log("[mcporter] STDIO trace: attempted to close transport without recorded metadata.");
    }
    transport._process = null;
    transport.onclose?.();
  };
  proto[marker] = true;
}
function patchStdioStart() {
  const marker = Symbol.for("mcporter.stdio.startPatched");
  const proto = StdioClientTransport.prototype;
  if (proto[marker]) {
    return;
  }
  const originalStart = StdioClientTransport.prototype.start;
  StdioClientTransport.prototype.start = async function patchedStart() {
    const transport = this;
    if (STDIO_TRACE_ENABLED) {
      console.log("[mcporter] STDIO trace: start() invoked for stdio transport.");
    }
    if (transport._serverParams && transport._serverParams.stderr !== "pipe") {
      transport._serverParams = {
        ...transport._serverParams,
        stderr: "pipe"
      };
    }
    const startPromise = originalStart.apply(this);
    const child = transport._process ?? null;
    const meta = {
      stderrChunks: [],
      stdoutChunks: STDIO_TRACE_ENABLED ? [] : void 0,
      stdinChunks: STDIO_TRACE_ENABLED ? [] : void 0,
      command: transport._serverParams?.command,
      code: null,
      listeners: [],
      child,
      transport
    };
    TRANSPORT_BUFFERS.set(transport, meta);
    if (child) {
      PROCESS_BUFFERS.set(child, meta);
      if (STDIO_TRACE_ENABLED) {
        const pid = typeof child.pid === "number" ? child.pid : "unknown";
        console.log(`[mcporter] STDIO trace: spawned ${meta.command ?? "stdio server"} (pid=${pid}).`);
      }
    } else if (STDIO_TRACE_ENABLED) {
      console.log(`[mcporter] STDIO trace: transport for ${meta.command ?? "stdio server"} exited before spawn listeners attached.`);
    }
    const targetStream = transport._stderrStream ?? child?.stderr ?? null;
    if (targetStream) {
      if (typeof targetStream.setEncoding === "function") {
        targetStream.setEncoding?.("utf8");
      }
      const handleChunk = (chunk) => {
        if (typeof chunk === "string") {
          meta.stderrChunks.push(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          meta.stderrChunks.push(chunk.toString("utf8"));
        }
      };
      targetStream.on("data", handleChunk);
      targetStream.on("error", ignoreEmitterError);
      meta.listeners.push({
        stream: targetStream,
        event: "data",
        handler: handleChunk
      });
      meta.listeners.push({
        stream: targetStream,
        event: "error",
        handler: ignoreEmitterError
      });
    }
    if (STDIO_TRACE_ENABLED && child?.stdout) {
      const stdoutStream = child.stdout;
      const handleStdout = (chunk) => {
        if (!meta.stdoutChunks) {
          meta.stdoutChunks = [];
        }
        if (typeof chunk === "string") {
          meta.stdoutChunks.push(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          meta.stdoutChunks.push(chunk.toString("utf8"));
        }
      };
      stdoutStream.on("data", handleStdout);
      stdoutStream.on("error", ignoreEmitterError);
      meta.listeners.push({
        stream: stdoutStream,
        event: "data",
        handler: handleStdout
      });
      meta.listeners.push({
        stream: stdoutStream,
        event: "error",
        handler: ignoreEmitterError
      });
    }
    if (child) {
      child.once("exit", (code) => {
        const entry = PROCESS_BUFFERS.get(child);
        if (entry) {
          entry.code = code;
          flushProcessLogs(child, entry);
        }
      });
    }
    await startPromise;
  };
  proto[marker] = true;
}
patchStdioClose();
patchStdioSend();
function patchStdioSend() {
  if (!STDIO_TRACE_ENABLED) {
    return;
  }
  const marker = Symbol.for("mcporter.stdio.sendPatched");
  const proto = StdioClientTransport.prototype;
  if (proto[marker]) {
    return;
  }
  const originalSend = StdioClientTransport.prototype.send;
  StdioClientTransport.prototype.send = function patchedSend(message) {
    if (STDIO_TRACE_ENABLED) {
      try {
        const transport = this;
        const child = transport._process ?? null;
        if (child) {
          const meta = PROCESS_BUFFERS.get(child);
          if (meta) {
            if (!meta.stdinChunks) {
              meta.stdinChunks = [];
            }
            meta.stdinChunks.push(JSON.stringify(message));
          }
        }
      } catch {
      }
    }
    return originalSend.call(this, message);
  };
  proto[marker] = true;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime/errors.js
var NON_FATAL_MCP_ERROR_CODES = /* @__PURE__ */ new Set([
  ErrorCode.InvalidRequest,
  ErrorCode.MethodNotFound,
  ErrorCode.InvalidParams
]);
function shouldResetConnection(error) {
  if (!error) {
    return false;
  }
  if (error instanceof McpError) {
    return !NON_FATAL_MCP_ERROR_CODES.has(error.code);
  }
  return error instanceof Error;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime-oauth-support.js
function maybeEnableOAuth(definition, logger) {
  if (definition.auth === "oauth" || definition.auth === "refreshable_bearer") {
    return void 0;
  }
  if (definition.command.kind !== "http") {
    return void 0;
  }
  logger.info(`Detected OAuth requirement for '${definition.name}'. Launching browser flow...`);
  return {
    ...definition,
    auth: "oauth"
  };
}
function isUnauthorizedError(error) {
  const issue = analyzeConnectionError(error);
  return issue.kind === "auth";
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime/oauth.js
var DEFAULT_OAUTH_CODE_TIMEOUT_MS = 3e5;
var OAUTH_FLOW_ERROR = Symbol("oauth-flow-error");
var POST_AUTH_CONNECT_ERROR = Symbol("post-auth-connect-error");
var MAX_OAUTH_ERROR_DETAIL_LENGTH = 1200;
var PROACTIVE_TOKEN_SKEW_SECONDS = 60;
var OAuthTimeoutError = class extends Error {
  timeoutMs;
  serverName;
  constructor(serverName, timeoutMs) {
    const seconds = Math.round(timeoutMs / 1e3);
    super(`OAuth authorization for '${serverName}' timed out after ${seconds}s; aborting.`);
    this.name = "OAuthTimeoutError";
    this.timeoutMs = timeoutMs;
    this.serverName = serverName;
  }
};
var OAuthAuthorizationNotStartedError = class extends Error {
  serverName;
  constructor(serverName, cause) {
    const causeMessage = formatOAuthErrorDetail(cause);
    const detail = causeMessage ? ` Last error: ${causeMessage}` : "";
    super(`OAuth authorization for '${serverName}' did not produce an authorization URL; aborting instead of waiting for a browser callback.${detail}`);
    this.name = "OAuthAuthorizationNotStartedError";
    this.serverName = serverName;
  }
};
function formatOAuthErrorDetail(cause) {
  if (!(cause instanceof Error) || !cause.message) {
    return "";
  }
  return truncateOAuthErrorDetail(cause.message);
}
function truncateOAuthErrorDetail(message) {
  if (message.length <= MAX_OAUTH_ERROR_DETAIL_LENGTH) {
    return message;
  }
  const truncated = message.length - MAX_OAUTH_ERROR_DETAIL_LENGTH;
  return `${message.slice(0, MAX_OAUTH_ERROR_DETAIL_LENGTH)}... [truncated ${truncated} chars]`;
}
function markOAuthFlowError(error) {
  return markError(error, OAUTH_FLOW_ERROR);
}
function isOAuthFlowError(error) {
  return hasErrorMarker(error, OAUTH_FLOW_ERROR);
}
function markPostAuthConnectError(error) {
  return markError(error, POST_AUTH_CONNECT_ERROR);
}
function isPostAuthConnectError(error) {
  return hasErrorMarker(error, POST_AUTH_CONNECT_ERROR);
}
function markError(error, marker) {
  if (!error || typeof error !== "object" && typeof error !== "function") {
    return error;
  }
  Object.defineProperty(error, marker, {
    value: true,
    enumerable: false,
    configurable: true
  });
  return error;
}
function hasErrorMarker(error, marker) {
  return !!error && (typeof error === "object" || typeof error === "function") && marker in error && Boolean(error[marker]);
}
function hasUsableCachedAccessToken(tokens) {
  if (!tokens || typeof tokens.access_token !== "string" || tokens.access_token.trim().length === 0) {
    return false;
  }
  const stored = tokens;
  const expiresAt = typeof stored.expires_at === "number" ? stored.expires_at : stored.expiresAt;
  return typeof expiresAt === "number" && expiresAt > Math.floor(Date.now() / 1e3) + PROACTIVE_TOKEN_SKEW_SECONDS;
}
async function connectWithAuth(client, transport, session, logger, options = {}) {
  const { serverName, maxAttempts = 3, oauthTimeoutMs = DEFAULT_OAUTH_CODE_TIMEOUT_MS, recreateTransport } = options;
  const state = {
    activeTransport: transport,
    attempt: 0,
    hasCompletedAuthFlow: false
  };
  while (true) {
    try {
      await attemptTransportConnect(client, state);
      if (session && !state.hasCompletedAuthFlow && options.serverUrl) {
        await completeProactiveAuthorization(state.activeTransport, session, logger, {
          serverName,
          oauthTimeoutMs,
          serverUrl: options.serverUrl,
          fetchFn: options.fetchFn
        });
        state.hasCompletedAuthFlow = true;
      }
      if (session && state.hasCompletedAuthFlow) {
        await session.close().catch(() => {
        });
      }
      return state.activeTransport;
    } catch (error) {
      const unauthorized = isUnauthorizedError(error);
      if (!shouldRetryAuthorization(state, unauthorized, session)) {
        await closeReplacementTransport(transport, state.activeTransport);
        throw state.hasCompletedAuthFlow && !unauthorized ? markPostAuthConnectError(error) : error;
      }
      state.attempt += 1;
      if (state.attempt > maxAttempts) {
        await closeReplacementTransport(transport, state.activeTransport);
        throw state.hasCompletedAuthFlow ? markPostAuthConnectError(error) : error;
      }
      if (session.hasAuthorizationRedirectStarted?.() !== false) {
        logger.warn(`OAuth authorization required for '${serverName ?? "unknown"}'. Waiting for browser approval...`);
      }
      try {
        state.activeTransport = await completeAuthorizationChallenge(state.activeTransport, session, logger, error, {
          serverName,
          oauthTimeoutMs,
          recreateTransport
        });
        state.hasCompletedAuthFlow = true;
        logger.info("Authorization code accepted. Retrying connection...");
      } catch (authError) {
        const message = authError instanceof OAuthAuthorizationNotStartedError ? "OAuth authorization could not start." : "OAuth authorization failed while waiting for callback.";
        logger.error(message, authError);
        await closeReplacementTransport(transport, state.activeTransport);
        throw markOAuthFlowError(authError);
      }
    }
  }
}
async function attemptTransportConnect(client, state) {
  await client.connect(state.activeTransport);
  return state.activeTransport;
}
function shouldRetryAuthorization(_state, unauthorized, session) {
  if (!session || !unauthorized) {
    return false;
  }
  return true;
}
async function closeReplacementTransport(originalTransport, activeTransport) {
  if (activeTransport === originalTransport) {
    return;
  }
  await activeTransport.close().catch(() => {
  });
}
async function completeAuthorizationChallenge(transport, session, logger, connectError, options) {
  if (session.hasAuthorizationRedirectStarted?.() === false) {
    throw new OAuthAuthorizationNotStartedError(options.serverName ?? "unknown", connectError);
  }
  const code = await waitForAuthorizationCodeWithTimeout(session, logger, options.serverName, options.oauthTimeoutMs ?? DEFAULT_OAUTH_CODE_TIMEOUT_MS);
  if (typeof transport.finishAuth !== "function") {
    logger.warn("Transport does not support finishAuth; cannot complete OAuth flow automatically.");
    throw connectError;
  }
  await transport.finishAuth(code);
  if (!options.recreateTransport) {
    return transport;
  }
  const nextTransport = await options.recreateTransport(transport);
  await transport.close().catch(() => {
  });
  return nextTransport;
}
async function completeProactiveAuthorization(transport, session, logger, options) {
  if (!options.serverUrl) {
    return;
  }
  try {
    const cachedTokens = await session.provider.tokens?.();
    if (hasUsableCachedAccessToken(cachedTokens)) {
      return;
    }
    const result = await auth(session.provider, {
      serverUrl: options.serverUrl,
      fetchFn: options.fetchFn
    });
    if (result !== "REDIRECT") {
      await session.close().catch(() => {
      });
      return;
    }
    if (session.hasAuthorizationRedirectStarted?.() === false) {
      throw new OAuthAuthorizationNotStartedError(options.serverName ?? "unknown");
    }
    logger.warn(`OAuth authorization required for '${options.serverName ?? "unknown"}'. Waiting for browser approval...`);
    if (typeof transport.finishAuth !== "function") {
      throw new Error("Transport does not support finishAuth; cannot complete OAuth flow automatically.");
    }
    const code = await waitForAuthorizationCodeWithTimeout(session, logger, options.serverName, options.oauthTimeoutMs ?? DEFAULT_OAUTH_CODE_TIMEOUT_MS);
    await transport.finishAuth(code);
    await session.close().catch(() => {
    });
  } catch (error) {
    throw markOAuthFlowError(error);
  }
}
function waitForAuthorizationCodeWithTimeout(session, logger, serverName, timeoutMs = DEFAULT_OAUTH_CODE_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return session.waitForAuthorizationCode();
  }
  const displayName = serverName ?? "unknown";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new OAuthTimeoutError(displayName, timeoutMs);
      logger.warn(error.message);
      reject(error);
    }, timeoutMs);
    session.waitForAuthorizationCode().then((code) => {
      clearTimeout(timer);
      resolve(code);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function parseOAuthTimeout(raw) {
  if (!raw) {
    return DEFAULT_OAUTH_CODE_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OAUTH_CODE_TIMEOUT_MS;
  }
  return parsed;
}
function resolveOAuthTimeoutFromEnv() {
  return parseOAuthTimeout(process.env.MCPORTER_OAUTH_TIMEOUT_MS ?? process.env.MCPORTER_OAUTH_TIMEOUT);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime/record-transport.js
import fs7 from "node:fs/promises";
import path11 from "node:path";
var initializedRecordingPaths = /* @__PURE__ */ new Map();
var PRIVATE_RECORDING_DIR_MODE = 448;
var PRIVATE_RECORDING_FILE_MODE = 384;
var RecordTransport = class {
  opts;
  onclose;
  onerror;
  onmessage;
  sessionId;
  finishAuth;
  writes = Promise.resolve();
  closeRecorded = false;
  constructor(opts) {
    this.opts = opts;
    this.sessionId = opts.inner.sessionId;
    const finishAuth = opts.inner.finishAuth;
    if (finishAuth) {
      this.finishAuth = (authorizationCode) => finishAuth.call(opts.inner, authorizationCode);
    }
  }
  get pid() {
    const pid = this.opts.inner.pid;
    return typeof pid === "number" && pid > 0 ? pid : null;
  }
  get _process() {
    return this.opts.inner._process ?? null;
  }
  async start() {
    await initializeRecordingFile(this.opts.recordPath);
    this.opts.inner.onclose = () => {
      void this.appendCloseOnce();
      this.onclose?.();
    };
    this.opts.inner.onerror = (error) => {
      this.onerror?.(error);
    };
    this.opts.inner.onmessage = (message) => {
      void this.appendLine(this.withMeta(message, "recv"));
      this.onmessage?.(message);
    };
    await this.appendLifecycle("start");
    await this.opts.inner.start();
    this.sessionId = this.opts.inner.sessionId;
  }
  async send(message, options) {
    await this.appendLine(this.withMeta(message, "send"));
    await this.opts.inner.send(message, options);
  }
  async close() {
    await this.appendCloseOnce();
    await this.opts.inner.close();
    await this.writes;
  }
  setProtocolVersion(version) {
    this.opts.inner.setProtocolVersion?.(version);
  }
  async appendLifecycle(event) {
    await this.appendLine(this.withMeta({
      jsonrpc: "2.0",
      method: `$transport/${event}`
    }, "lifecycle"));
  }
  async appendCloseOnce() {
    if (this.closeRecorded) {
      return;
    }
    this.closeRecorded = true;
    await this.appendLifecycle("close");
  }
  withMeta(message, dir) {
    return {
      ...message,
      _meta: {
        dir,
        server: this.opts.server,
        ts: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
  }
  async appendLine(message) {
    const line = `${JSON.stringify(message)}
`;
    this.writes = this.writes.then(async () => {
      await ensurePrivateRecordingDir(this.opts.recordPath);
      await fs7.appendFile(this.opts.recordPath, line, {
        encoding: "utf8",
        mode: PRIVATE_RECORDING_FILE_MODE
      });
    });
    await this.writes;
  }
};
function initializeRecordingFile(recordPath) {
  const existing = initializedRecordingPaths.get(recordPath);
  if (existing) {
    return existing;
  }
  const initialization = ensurePrivateRecordingDir(recordPath).then(() => fs7.writeFile(recordPath, "", {
    encoding: "utf8",
    mode: PRIVATE_RECORDING_FILE_MODE
  })).then(() => fs7.chmod(recordPath, PRIVATE_RECORDING_FILE_MODE)).catch((error) => {
    initializedRecordingPaths.delete(recordPath);
    throw error;
  });
  initializedRecordingPaths.set(recordPath, initialization);
  return initialization;
}
async function ensurePrivateRecordingDir(recordPath) {
  const recordingDir = path11.dirname(recordPath);
  await fs7.mkdir(recordingDir, {
    recursive: true,
    mode: PRIVATE_RECORDING_DIR_MODE
  });
  await fs7.chmod(recordingDir, PRIVATE_RECORDING_DIR_MODE);
}
function resolveRecordingPath(sessionName) {
  const normalized = normalizeRecordingSessionName(sessionName);
  return path11.join(legacyMcporterDir(), "recordings", `${normalized}.ndjson`);
}
function normalizeRecordingSessionName(sessionName) {
  const normalized = sessionName.trim();
  if (!normalized) {
    throw new Error("Recording session name is required.");
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized === "..") {
    throw new Error(`Invalid recording session name '${sessionName}'. Use a simple file name without path separators.`);
  }
  return normalized;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime/replay-transport.js
import fs8 from "node:fs";
import { isDeepStrictEqual } from "node:util";
var ReplayTransport = class {
  opts;
  onclose;
  onerror;
  onmessage;
  sessionId;
  expectedSends;
  constructor(opts) {
    this.opts = opts;
    this.expectedSends = buildReplayQueue(readRecordedMessages(opts.recordPath), opts.server);
  }
  async start() {
  }
  async send(message, _options) {
    const request = requestDetails(message);
    if (!request) {
      return;
    }
    const expected = this.expectedSends[0];
    if (!expected || expected.method !== request.method || !isDeepStrictEqual(expected.params, request.params)) {
      throw new Error(formatReplayMismatch(this.opts.server, request, expected));
    }
    this.expectedSends.shift();
    if (expected.response) {
      const response = withActiveRequestId(expected.response, request.id);
      queueMicrotask(() => this.onmessage?.(response));
    }
  }
  async close() {
    if (this.expectedSends.length > 0) {
      throw new Error(formatReplayRemainder(this.opts.server, this.expectedSends));
    }
    this.onclose?.();
  }
};
function readRecordedMessages(recordPath) {
  try {
    const contents = fs8.readFileSync(recordPath, "utf8");
    return contents.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on recording line ${index + 1} in ${recordPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Replay recording not found: ${recordPath}`, { cause: error });
    }
    throw error;
  }
}
function buildReplayQueue(messages, server) {
  const pendingRequests = /* @__PURE__ */ new Map();
  const expected = [];
  for (const entry of messages) {
    if (entry._meta?.server !== server) {
      continue;
    }
    if (entry._meta.dir === "lifecycle") {
      continue;
    }
    const clean = stripMeta(entry);
    if (entry._meta.dir === "send") {
      const request = requestDetails(clean);
      if (!request) {
        continue;
      }
      const expectedSend = {
        method: request.method,
        params: request.params,
        expectsResponse: request.id !== void 0
      };
      expected.push(expectedSend);
      if (request.id !== void 0) {
        pendingRequests.set(String(request.id), expectedSend);
      }
      continue;
    }
    if (entry._meta.dir === "recv") {
      const responseId = responseIdOf(clean);
      if (responseId === void 0) {
        continue;
      }
      const pending = pendingRequests.get(String(responseId));
      if (pending) {
        pendingRequests.delete(String(responseId));
        pending.response = clean;
      }
    }
  }
  return expected.filter((entry) => !entry.expectsResponse || entry.response);
}
function stripMeta(message) {
  const { _meta, ...jsonrpc } = message;
  return jsonrpc;
}
function requestDetails(message) {
  const record = message;
  if (typeof record.method !== "string") {
    return void 0;
  }
  if (record.method.startsWith("$transport/")) {
    return void 0;
  }
  return {
    id: typeof record.id === "string" || typeof record.id === "number" ? record.id : void 0,
    method: record.method,
    params: record.params
  };
}
function responseIdOf(message) {
  const record = message;
  if (!("result" in record) && !("error" in record)) {
    return void 0;
  }
  const id = record.id;
  return typeof id === "string" || typeof id === "number" ? id : void 0;
}
function withActiveRequestId(response, requestId) {
  if (requestId === void 0) {
    return response;
  }
  return {
    ...response,
    id: requestId
  };
}
function formatReplayMismatch(server, request, expected) {
  const expectedText = expected ? `${expected.method} ${JSON.stringify(expected.params ?? {})}` : "no remaining recorded recv";
  return `Replay mismatch for server '${server}': request ${request.method} ${JSON.stringify(request.params ?? {})} did not match next expected recv ${expectedText}.`;
}
function formatReplayRemainder(server, expectedSends) {
  const expected = expectedSends[0];
  const count = expectedSends.length;
  const requestText = count === 1 ? "request" : "requests";
  const expectedText = expected ? `${expected.method} ${JSON.stringify(expected.params ?? {})}` : "no remaining recorded recv";
  return `Replay ended for server '${server}' with ${count} recorded ${requestText} still unused; next expected recv ${expectedText}.`;
}

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/client.js
var ExperimentalClientTasks = class {
  constructor(_client) {
    this._client = _client;
  }
  /**
   * Calls a tool and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * This method provides streaming access to tool execution, allowing you to
   * observe intermediate task status updates for long-running tool calls.
   * Automatically validates structured output if the tool has an outputSchema.
   *
   * @example
   * ```typescript
   * const stream = client.experimental.tasks.callToolStream({ name: 'myTool', arguments: {} });
   * for await (const message of stream) {
   *   switch (message.type) {
   *     case 'taskCreated':
   *       console.log('Tool execution started:', message.task.taskId);
   *       break;
   *     case 'taskStatus':
   *       console.log('Tool status:', message.task.status);
   *       break;
   *     case 'result':
   *       console.log('Tool result:', message.result);
   *       break;
   *     case 'error':
   *       console.error('Tool error:', message.error);
   *       break;
   *   }
   * }
   * ```
   *
   * @param params - Tool call parameters (name and arguments)
   * @param resultSchema - Zod schema for validating the result (defaults to CallToolResultSchema)
   * @param options - Optional request options (timeout, signal, task creation params, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  async *callToolStream(params, resultSchema = CallToolResultSchema, options) {
    const clientInternal = this._client;
    const optionsWithTask = {
      ...options,
      // We check if the tool is known to be a task during auto-configuration, but assume
      // the caller knows what they're doing if they pass this explicitly
      task: options?.task ?? (clientInternal.isToolTask(params.name) ? {} : void 0)
    };
    const stream = clientInternal.requestStream({ method: "tools/call", params }, resultSchema, optionsWithTask);
    const validator = clientInternal.getToolOutputValidator(params.name);
    for await (const message of stream) {
      if (message.type === "result" && validator) {
        const result = message.result;
        if (!result.structuredContent && !result.isError) {
          yield {
            type: "error",
            error: new McpError(ErrorCode.InvalidRequest, `Tool ${params.name} has an output schema but did not return structured content`)
          };
          return;
        }
        if (result.structuredContent) {
          try {
            const validationResult = validator(result.structuredContent);
            if (!validationResult.valid) {
              yield {
                type: "error",
                error: new McpError(ErrorCode.InvalidParams, `Structured content does not match the tool's output schema: ${validationResult.errorMessage}`)
              };
              return;
            }
          } catch (error) {
            if (error instanceof McpError) {
              yield { type: "error", error };
              return;
            }
            yield {
              type: "error",
              error: new McpError(ErrorCode.InvalidParams, `Failed to validate structured content: ${error instanceof Error ? error.message : String(error)}`)
            };
            return;
          }
        }
      }
      yield message;
    }
  }
  /**
   * Gets the current status of a task.
   *
   * @param taskId - The task identifier
   * @param options - Optional request options
   * @returns The task status
   *
   * @experimental
   */
  async getTask(taskId, options) {
    return this._client.getTask({ taskId }, options);
  }
  /**
   * Retrieves the result of a completed task.
   *
   * @param taskId - The task identifier
   * @param resultSchema - Zod schema for validating the result
   * @param options - Optional request options
   * @returns The task result
   *
   * @experimental
   */
  async getTaskResult(taskId, resultSchema, options) {
    return this._client.getTaskResult({ taskId }, resultSchema, options);
  }
  /**
   * Lists tasks with optional pagination.
   *
   * @param cursor - Optional pagination cursor
   * @param options - Optional request options
   * @returns List of tasks with optional next cursor
   *
   * @experimental
   */
  async listTasks(cursor, options) {
    return this._client.listTasks(cursor ? { cursor } : void 0, options);
  }
  /**
   * Cancels a running task.
   *
   * @param taskId - The task identifier
   * @param options - Optional request options
   *
   * @experimental
   */
  async cancelTask(taskId, options) {
    return this._client.cancelTask({ taskId }, options);
  }
  /**
   * Sends a request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * This method provides streaming access to request processing, allowing you to
   * observe intermediate task status updates for task-augmented requests.
   *
   * @param request - The request to send
   * @param resultSchema - Zod schema for validating the result
   * @param options - Optional request options (timeout, signal, task creation params, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  requestStream(request, resultSchema, options) {
    return this._client.requestStream(request, resultSchema, options);
  }
};

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js
function applyElicitationDefaults(schema, data) {
  if (!schema || data === null || typeof data !== "object")
    return;
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const obj = data;
    const props = schema.properties;
    for (const key of Object.keys(props)) {
      const propSchema = props[key];
      if (obj[key] === void 0 && Object.prototype.hasOwnProperty.call(propSchema, "default")) {
        obj[key] = propSchema.default;
      }
      if (obj[key] !== void 0) {
        applyElicitationDefaults(propSchema, obj[key]);
      }
    }
  }
  if (Array.isArray(schema.anyOf)) {
    for (const sub of schema.anyOf) {
      if (typeof sub !== "boolean") {
        applyElicitationDefaults(sub, data);
      }
    }
  }
  if (Array.isArray(schema.oneOf)) {
    for (const sub of schema.oneOf) {
      if (typeof sub !== "boolean") {
        applyElicitationDefaults(sub, data);
      }
    }
  }
}
function getSupportedElicitationModes(capabilities) {
  if (!capabilities) {
    return { supportsFormMode: false, supportsUrlMode: false };
  }
  const hasFormCapability = capabilities.form !== void 0;
  const hasUrlCapability = capabilities.url !== void 0;
  const supportsFormMode = hasFormCapability || !hasFormCapability && !hasUrlCapability;
  const supportsUrlMode = hasUrlCapability;
  return { supportsFormMode, supportsUrlMode };
}
var Client = class extends Protocol {
  /**
   * Initializes this client with the given name and version information.
   */
  constructor(_clientInfo, options) {
    super(options);
    this._clientInfo = _clientInfo;
    this._cachedToolOutputValidators = /* @__PURE__ */ new Map();
    this._cachedKnownTaskTools = /* @__PURE__ */ new Set();
    this._cachedRequiredTaskTools = /* @__PURE__ */ new Set();
    this._listChangedDebounceTimers = /* @__PURE__ */ new Map();
    this._capabilities = options?.capabilities ?? {};
    this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator();
    if (options?.listChanged) {
      this._pendingListChangedConfig = options.listChanged;
    }
  }
  /**
   * Set up handlers for list changed notifications based on config and server capabilities.
   * This should only be called after initialization when server capabilities are known.
   * Handlers are silently skipped if the server doesn't advertise the corresponding listChanged capability.
   * @internal
   */
  _setupListChangedHandlers(config) {
    if (config.tools && this._serverCapabilities?.tools?.listChanged) {
      this._setupListChangedHandler("tools", ToolListChangedNotificationSchema, config.tools, async () => {
        const result = await this.listTools();
        return result.tools;
      });
    }
    if (config.prompts && this._serverCapabilities?.prompts?.listChanged) {
      this._setupListChangedHandler("prompts", PromptListChangedNotificationSchema, config.prompts, async () => {
        const result = await this.listPrompts();
        return result.prompts;
      });
    }
    if (config.resources && this._serverCapabilities?.resources?.listChanged) {
      this._setupListChangedHandler("resources", ResourceListChangedNotificationSchema, config.resources, async () => {
        const result = await this.listResources();
        return result.resources;
      });
    }
  }
  /**
   * Access experimental features.
   *
   * WARNING: These APIs are experimental and may change without notice.
   *
   * @experimental
   */
  get experimental() {
    if (!this._experimental) {
      this._experimental = {
        tasks: new ExperimentalClientTasks(this)
      };
    }
    return this._experimental;
  }
  /**
   * Registers new capabilities. This can only be called before connecting to a transport.
   *
   * The new capabilities will be merged with any existing capabilities previously given (e.g., at initialization).
   */
  registerCapabilities(capabilities) {
    if (this.transport) {
      throw new Error("Cannot register capabilities after connecting to transport");
    }
    this._capabilities = mergeCapabilities(this._capabilities, capabilities);
  }
  /**
   * Override request handler registration to enforce client-side validation for elicitation.
   */
  setRequestHandler(requestSchema, handler) {
    const shape = getObjectShape(requestSchema);
    const methodSchema = shape?.method;
    if (!methodSchema) {
      throw new Error("Schema is missing a method literal");
    }
    const methodValue = getLiteralValue(methodSchema);
    if (typeof methodValue !== "string") {
      throw new Error("Schema method literal must be a string");
    }
    const method = methodValue;
    if (method === "elicitation/create") {
      const wrappedHandler = async (request, extra) => {
        const validatedRequest = safeParse(ElicitRequestSchema, request);
        if (!validatedRequest.success) {
          const errorMessage = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid elicitation request: ${errorMessage}`);
        }
        const { params } = validatedRequest.data;
        params.mode = params.mode ?? "form";
        const { supportsFormMode, supportsUrlMode } = getSupportedElicitationModes(this._capabilities.elicitation);
        if (params.mode === "form" && !supportsFormMode) {
          throw new McpError(ErrorCode.InvalidParams, "Client does not support form-mode elicitation requests");
        }
        if (params.mode === "url" && !supportsUrlMode) {
          throw new McpError(ErrorCode.InvalidParams, "Client does not support URL-mode elicitation requests");
        }
        const result = await Promise.resolve(handler(request, extra));
        if (params.task) {
          const taskValidationResult = safeParse(CreateTaskResultSchema, result);
          if (!taskValidationResult.success) {
            const errorMessage = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage}`);
          }
          return taskValidationResult.data;
        }
        const validationResult = safeParse(ElicitResultSchema, result);
        if (!validationResult.success) {
          const errorMessage = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid elicitation result: ${errorMessage}`);
        }
        const validatedResult = validationResult.data;
        const requestedSchema = params.mode === "form" ? params.requestedSchema : void 0;
        if (params.mode === "form" && validatedResult.action === "accept" && validatedResult.content && requestedSchema) {
          if (this._capabilities.elicitation?.form?.applyDefaults) {
            try {
              applyElicitationDefaults(requestedSchema, validatedResult.content);
            } catch {
            }
          }
        }
        return validatedResult;
      };
      return super.setRequestHandler(requestSchema, wrappedHandler);
    }
    if (method === "sampling/createMessage") {
      const wrappedHandler = async (request, extra) => {
        const validatedRequest = safeParse(CreateMessageRequestSchema, request);
        if (!validatedRequest.success) {
          const errorMessage = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid sampling request: ${errorMessage}`);
        }
        const { params } = validatedRequest.data;
        const result = await Promise.resolve(handler(request, extra));
        if (params.task) {
          const taskValidationResult = safeParse(CreateTaskResultSchema, result);
          if (!taskValidationResult.success) {
            const errorMessage = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage}`);
          }
          return taskValidationResult.data;
        }
        const hasTools = params.tools || params.toolChoice;
        const resultSchema = hasTools ? CreateMessageResultWithToolsSchema : CreateMessageResultSchema;
        const validationResult = safeParse(resultSchema, result);
        if (!validationResult.success) {
          const errorMessage = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid sampling result: ${errorMessage}`);
        }
        return validationResult.data;
      };
      return super.setRequestHandler(requestSchema, wrappedHandler);
    }
    return super.setRequestHandler(requestSchema, handler);
  }
  assertCapability(capability, method) {
    if (!this._serverCapabilities?.[capability]) {
      throw new Error(`Server does not support ${capability} (required for ${method})`);
    }
  }
  async connect(transport, options) {
    await super.connect(transport);
    if (transport.sessionId !== void 0) {
      return;
    }
    try {
      const result = await this.request({
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: this._capabilities,
          clientInfo: this._clientInfo
        }
      }, InitializeResultSchema, options);
      if (result === void 0) {
        throw new Error(`Server sent invalid initialize result: ${result}`);
      }
      if (!SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) {
        throw new Error(`Server's protocol version is not supported: ${result.protocolVersion}`);
      }
      this._serverCapabilities = result.capabilities;
      this._serverVersion = result.serverInfo;
      if (transport.setProtocolVersion) {
        transport.setProtocolVersion(result.protocolVersion);
      }
      this._instructions = result.instructions;
      await this.notification({
        method: "notifications/initialized"
      });
      if (this._pendingListChangedConfig) {
        this._setupListChangedHandlers(this._pendingListChangedConfig);
        this._pendingListChangedConfig = void 0;
      }
    } catch (error) {
      void this.close();
      throw error;
    }
  }
  /**
   * After initialization has completed, this will be populated with the server's reported capabilities.
   */
  getServerCapabilities() {
    return this._serverCapabilities;
  }
  /**
   * After initialization has completed, this will be populated with information about the server's name and version.
   */
  getServerVersion() {
    return this._serverVersion;
  }
  /**
   * After initialization has completed, this may be populated with information about the server's instructions.
   */
  getInstructions() {
    return this._instructions;
  }
  assertCapabilityForMethod(method) {
    switch (method) {
      case "logging/setLevel":
        if (!this._serverCapabilities?.logging) {
          throw new Error(`Server does not support logging (required for ${method})`);
        }
        break;
      case "prompts/get":
      case "prompts/list":
        if (!this._serverCapabilities?.prompts) {
          throw new Error(`Server does not support prompts (required for ${method})`);
        }
        break;
      case "resources/list":
      case "resources/templates/list":
      case "resources/read":
      case "resources/subscribe":
      case "resources/unsubscribe":
        if (!this._serverCapabilities?.resources) {
          throw new Error(`Server does not support resources (required for ${method})`);
        }
        if (method === "resources/subscribe" && !this._serverCapabilities.resources.subscribe) {
          throw new Error(`Server does not support resource subscriptions (required for ${method})`);
        }
        break;
      case "tools/call":
      case "tools/list":
        if (!this._serverCapabilities?.tools) {
          throw new Error(`Server does not support tools (required for ${method})`);
        }
        break;
      case "completion/complete":
        if (!this._serverCapabilities?.completions) {
          throw new Error(`Server does not support completions (required for ${method})`);
        }
        break;
      case "initialize":
        break;
      case "ping":
        break;
    }
  }
  assertNotificationCapability(method) {
    switch (method) {
      case "notifications/roots/list_changed":
        if (!this._capabilities.roots?.listChanged) {
          throw new Error(`Client does not support roots list changed notifications (required for ${method})`);
        }
        break;
      case "notifications/initialized":
        break;
      case "notifications/cancelled":
        break;
      case "notifications/progress":
        break;
    }
  }
  assertRequestHandlerCapability(method) {
    if (!this._capabilities) {
      return;
    }
    switch (method) {
      case "sampling/createMessage":
        if (!this._capabilities.sampling) {
          throw new Error(`Client does not support sampling capability (required for ${method})`);
        }
        break;
      case "elicitation/create":
        if (!this._capabilities.elicitation) {
          throw new Error(`Client does not support elicitation capability (required for ${method})`);
        }
        break;
      case "roots/list":
        if (!this._capabilities.roots) {
          throw new Error(`Client does not support roots capability (required for ${method})`);
        }
        break;
      case "tasks/get":
      case "tasks/list":
      case "tasks/result":
      case "tasks/cancel":
        if (!this._capabilities.tasks) {
          throw new Error(`Client does not support tasks capability (required for ${method})`);
        }
        break;
      case "ping":
        break;
    }
  }
  assertTaskCapability(method) {
    assertToolsCallTaskCapability(this._serverCapabilities?.tasks?.requests, method, "Server");
  }
  assertTaskHandlerCapability(method) {
    if (!this._capabilities) {
      return;
    }
    assertClientRequestTaskCapability(this._capabilities.tasks?.requests, method, "Client");
  }
  async ping(options) {
    return this.request({ method: "ping" }, EmptyResultSchema, options);
  }
  async complete(params, options) {
    return this.request({ method: "completion/complete", params }, CompleteResultSchema, options);
  }
  async setLoggingLevel(level, options) {
    return this.request({ method: "logging/setLevel", params: { level } }, EmptyResultSchema, options);
  }
  async getPrompt(params, options) {
    return this.request({ method: "prompts/get", params }, GetPromptResultSchema, options);
  }
  async listPrompts(params, options) {
    return this.request({ method: "prompts/list", params }, ListPromptsResultSchema, options);
  }
  async listResources(params, options) {
    return this.request({ method: "resources/list", params }, ListResourcesResultSchema, options);
  }
  async listResourceTemplates(params, options) {
    return this.request({ method: "resources/templates/list", params }, ListResourceTemplatesResultSchema, options);
  }
  async readResource(params, options) {
    return this.request({ method: "resources/read", params }, ReadResourceResultSchema, options);
  }
  async subscribeResource(params, options) {
    return this.request({ method: "resources/subscribe", params }, EmptyResultSchema, options);
  }
  async unsubscribeResource(params, options) {
    return this.request({ method: "resources/unsubscribe", params }, EmptyResultSchema, options);
  }
  /**
   * Calls a tool and waits for the result. Automatically validates structured output if the tool has an outputSchema.
   *
   * For task-based execution with streaming behavior, use client.experimental.tasks.callToolStream() instead.
   */
  async callTool(params, resultSchema = CallToolResultSchema, options) {
    if (this.isToolTaskRequired(params.name)) {
      throw new McpError(ErrorCode.InvalidRequest, `Tool "${params.name}" requires task-based execution. Use client.experimental.tasks.callToolStream() instead.`);
    }
    const result = await this.request({ method: "tools/call", params }, resultSchema, options);
    const validator = this.getToolOutputValidator(params.name);
    if (validator) {
      if (!result.structuredContent && !result.isError) {
        throw new McpError(ErrorCode.InvalidRequest, `Tool ${params.name} has an output schema but did not return structured content`);
      }
      if (result.structuredContent) {
        try {
          const validationResult = validator(result.structuredContent);
          if (!validationResult.valid) {
            throw new McpError(ErrorCode.InvalidParams, `Structured content does not match the tool's output schema: ${validationResult.errorMessage}`);
          }
        } catch (error) {
          if (error instanceof McpError) {
            throw error;
          }
          throw new McpError(ErrorCode.InvalidParams, `Failed to validate structured content: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return result;
  }
  isToolTask(toolName) {
    if (!this._serverCapabilities?.tasks?.requests?.tools?.call) {
      return false;
    }
    return this._cachedKnownTaskTools.has(toolName);
  }
  /**
   * Check if a tool requires task-based execution.
   * Unlike isToolTask which includes 'optional' tools, this only checks for 'required'.
   */
  isToolTaskRequired(toolName) {
    return this._cachedRequiredTaskTools.has(toolName);
  }
  /**
   * Cache validators for tool output schemas.
   * Called after listTools() to pre-compile validators for better performance.
   */
  cacheToolMetadata(tools) {
    this._cachedToolOutputValidators.clear();
    this._cachedKnownTaskTools.clear();
    this._cachedRequiredTaskTools.clear();
    for (const tool of tools) {
      if (tool.outputSchema) {
        const toolValidator = this._jsonSchemaValidator.getValidator(tool.outputSchema);
        this._cachedToolOutputValidators.set(tool.name, toolValidator);
      }
      const taskSupport = tool.execution?.taskSupport;
      if (taskSupport === "required" || taskSupport === "optional") {
        this._cachedKnownTaskTools.add(tool.name);
      }
      if (taskSupport === "required") {
        this._cachedRequiredTaskTools.add(tool.name);
      }
    }
  }
  /**
   * Get cached validator for a tool
   */
  getToolOutputValidator(toolName) {
    return this._cachedToolOutputValidators.get(toolName);
  }
  async listTools(params, options) {
    const result = await this.request({ method: "tools/list", params }, ListToolsResultSchema, options);
    this.cacheToolMetadata(result.tools);
    return result;
  }
  /**
   * Set up a single list changed handler.
   * @internal
   */
  _setupListChangedHandler(listType, notificationSchema, options, fetcher) {
    const parseResult = ListChangedOptionsBaseSchema.safeParse(options);
    if (!parseResult.success) {
      throw new Error(`Invalid ${listType} listChanged options: ${parseResult.error.message}`);
    }
    if (typeof options.onChanged !== "function") {
      throw new Error(`Invalid ${listType} listChanged options: onChanged must be a function`);
    }
    const { autoRefresh, debounceMs } = parseResult.data;
    const { onChanged } = options;
    const refresh = async () => {
      if (!autoRefresh) {
        onChanged(null, null);
        return;
      }
      try {
        const items = await fetcher();
        onChanged(null, items);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        onChanged(error, null);
      }
    };
    const handler = () => {
      if (debounceMs) {
        const existingTimer = this._listChangedDebounceTimers.get(listType);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        const timer = setTimeout(refresh, debounceMs);
        this._listChangedDebounceTimers.set(listType, timer);
      } else {
        refresh();
      }
    };
    this.setNotificationHandler(notificationSchema, handler);
  }
  async sendRootsListChanged() {
    return this.notification({ method: "notifications/roots/list_changed" });
  }
};

// node_modules/.pnpm/eventsource-parser@3.1.0/node_modules/eventsource-parser/dist/index.js
var ParseError = class extends Error {
  constructor(message, options) {
    super(message), this.name = "ParseError", this.type = options.type, this.field = options.field, this.value = options.value, this.line = options.line;
  }
};
var LF = 10;
var CR = 13;
var SPACE = 32;
function noop(_arg) {
}
function createParser(config) {
  if (typeof config == "function")
    throw new TypeError(
      "`config` must be an object, got a function instead. Did you mean `createParser({onEvent: fn})`?"
    );
  const { onEvent = noop, onError = noop, onRetry = noop, onComment, maxBufferSize } = config, pendingFragments = [];
  let pendingFragmentsLength = 0, isFirstChunk = true, id, data = "", dataLines = 0, eventType, terminated = false;
  function feed(chunk) {
    if (terminated)
      throw new Error(
        "Cannot feed parser: it was terminated after exceeding the configured max buffer size. Call `reset()` to resume parsing."
      );
    if (isFirstChunk && (isFirstChunk = false, chunk.charCodeAt(0) === 239 && chunk.charCodeAt(1) === 187 && chunk.charCodeAt(2) === 191 && (chunk = chunk.slice(3))), pendingFragments.length === 0) {
      const trailing2 = processLines(chunk);
      trailing2 !== "" && (pendingFragments.push(trailing2), pendingFragmentsLength = trailing2.length), checkBufferSize();
      return;
    }
    if (chunk.indexOf(`
`) === -1 && chunk.indexOf("\r") === -1) {
      pendingFragments.push(chunk), pendingFragmentsLength += chunk.length, checkBufferSize();
      return;
    }
    pendingFragments.push(chunk);
    const input = pendingFragments.join("");
    pendingFragments.length = 0, pendingFragmentsLength = 0;
    const trailing = processLines(input);
    trailing !== "" && (pendingFragments.push(trailing), pendingFragmentsLength = trailing.length), checkBufferSize();
  }
  function checkBufferSize() {
    maxBufferSize !== void 0 && (pendingFragmentsLength + data.length <= maxBufferSize || (terminated = true, pendingFragments.length = 0, pendingFragmentsLength = 0, id = void 0, data = "", dataLines = 0, eventType = void 0, onError(
      new ParseError(`Buffered data exceeded max buffer size of ${maxBufferSize} characters`, {
        type: "max-buffer-size-exceeded"
      })
    )));
  }
  function processLines(chunk) {
    let searchIndex = 0;
    if (chunk.indexOf("\r") === -1) {
      let lfIndex = chunk.indexOf(`
`, searchIndex);
      for (; lfIndex !== -1; ) {
        if (searchIndex === lfIndex) {
          dataLines > 0 && onEvent({ id, event: eventType, data }), id = void 0, data = "", dataLines = 0, eventType = void 0, searchIndex = lfIndex + 1, lfIndex = chunk.indexOf(`
`, searchIndex);
          continue;
        }
        const firstCharCode = chunk.charCodeAt(searchIndex);
        if (isDataPrefix(chunk, searchIndex, firstCharCode)) {
          const valueStart = chunk.charCodeAt(searchIndex + 5) === SPACE ? searchIndex + 6 : searchIndex + 5, value = chunk.slice(valueStart, lfIndex);
          if (dataLines === 0 && chunk.charCodeAt(lfIndex + 1) === LF) {
            onEvent({ id, event: eventType, data: value }), id = void 0, data = "", eventType = void 0, searchIndex = lfIndex + 2, lfIndex = chunk.indexOf(`
`, searchIndex);
            continue;
          }
          data = dataLines === 0 ? value : `${data}
${value}`, dataLines++;
        } else isEventPrefix(chunk, searchIndex, firstCharCode) ? eventType = chunk.slice(
          chunk.charCodeAt(searchIndex + 6) === SPACE ? searchIndex + 7 : searchIndex + 6,
          lfIndex
        ) || void 0 : parseLine(chunk, searchIndex, lfIndex);
        searchIndex = lfIndex + 1, lfIndex = chunk.indexOf(`
`, searchIndex);
      }
      return chunk.slice(searchIndex);
    }
    for (; searchIndex < chunk.length; ) {
      const crIndex = chunk.indexOf("\r", searchIndex), lfIndex = chunk.indexOf(`
`, searchIndex);
      let lineEnd = -1;
      if (crIndex !== -1 && lfIndex !== -1 ? lineEnd = crIndex < lfIndex ? crIndex : lfIndex : crIndex !== -1 ? crIndex === chunk.length - 1 ? lineEnd = -1 : lineEnd = crIndex : lfIndex !== -1 && (lineEnd = lfIndex), lineEnd === -1)
        break;
      parseLine(chunk, searchIndex, lineEnd), searchIndex = lineEnd + 1, chunk.charCodeAt(searchIndex - 1) === CR && chunk.charCodeAt(searchIndex) === LF && searchIndex++;
    }
    return chunk.slice(searchIndex);
  }
  function parseLine(chunk, start, end) {
    if (start === end) {
      dispatchEvent();
      return;
    }
    const firstCharCode = chunk.charCodeAt(start);
    if (isDataPrefix(chunk, start, firstCharCode)) {
      const valueStart = chunk.charCodeAt(start + 5) === SPACE ? start + 6 : start + 5, value2 = chunk.slice(valueStart, end);
      data = dataLines === 0 ? value2 : `${data}
${value2}`, dataLines++;
      return;
    }
    if (isEventPrefix(chunk, start, firstCharCode)) {
      eventType = chunk.slice(chunk.charCodeAt(start + 6) === SPACE ? start + 7 : start + 6, end) || void 0;
      return;
    }
    if (firstCharCode === 105 && chunk.charCodeAt(start + 1) === 100 && chunk.charCodeAt(start + 2) === 58) {
      const value2 = chunk.slice(chunk.charCodeAt(start + 3) === SPACE ? start + 4 : start + 3, end);
      id = value2.includes("\0") ? void 0 : value2;
      return;
    }
    if (firstCharCode === 58) {
      if (onComment) {
        const line2 = chunk.slice(start, end);
        onComment(line2.slice(chunk.charCodeAt(start + 1) === SPACE ? 2 : 1));
      }
      return;
    }
    const line = chunk.slice(start, end), fieldSeparatorIndex = line.indexOf(":");
    if (fieldSeparatorIndex === -1) {
      processField(line, "", line);
      return;
    }
    const field = line.slice(0, fieldSeparatorIndex), offset = line.charCodeAt(fieldSeparatorIndex + 1) === SPACE ? 2 : 1, value = line.slice(fieldSeparatorIndex + offset);
    processField(field, value, line);
  }
  function processField(field, value, line) {
    switch (field) {
      case "event":
        eventType = value || void 0;
        break;
      case "data":
        data = dataLines === 0 ? value : `${data}
${value}`, dataLines++;
        break;
      case "id":
        id = value.includes("\0") ? void 0 : value;
        break;
      case "retry":
        /^\d+$/.test(value) ? onRetry(parseInt(value, 10)) : onError(
          new ParseError(`Invalid \`retry\` value: "${value}"`, {
            type: "invalid-retry",
            value,
            line
          })
        );
        break;
      default:
        onError(
          new ParseError(
            `Unknown field "${field.length > 20 ? `${field.slice(0, 20)}\u2026` : field}"`,
            { type: "unknown-field", field, value, line }
          )
        );
        break;
    }
  }
  function dispatchEvent() {
    dataLines > 0 && onEvent({
      id,
      event: eventType,
      data
    }), id = void 0, data = "", dataLines = 0, eventType = void 0;
  }
  function reset(options = {}) {
    if (options.consume && pendingFragments.length > 0) {
      const incompleteLine = pendingFragments.join("");
      parseLine(incompleteLine, 0, incompleteLine.length);
    }
    isFirstChunk = true, id = void 0, data = "", dataLines = 0, eventType = void 0, pendingFragments.length = 0, pendingFragmentsLength = 0, terminated = false;
  }
  return { feed, reset };
}
function isDataPrefix(chunk, i, firstCharCode) {
  return firstCharCode === 100 && chunk.charCodeAt(i + 1) === 97 && chunk.charCodeAt(i + 2) === 116 && chunk.charCodeAt(i + 3) === 97 && chunk.charCodeAt(i + 4) === 58;
}
function isEventPrefix(chunk, i, firstCharCode) {
  return firstCharCode === 101 && chunk.charCodeAt(i + 1) === 118 && chunk.charCodeAt(i + 2) === 101 && chunk.charCodeAt(i + 3) === 110 && chunk.charCodeAt(i + 4) === 116 && chunk.charCodeAt(i + 5) === 58;
}

// node_modules/.pnpm/eventsource@3.0.7/node_modules/eventsource/dist/index.js
var ErrorEvent = class extends Event {
  /**
   * Constructs a new `ErrorEvent` instance. This is typically not called directly,
   * but rather emitted by the `EventSource` object when an error occurs.
   *
   * @param type - The type of the event (should be "error")
   * @param errorEventInitDict - Optional properties to include in the error event
   */
  constructor(type, errorEventInitDict) {
    var _a, _b;
    super(type), this.code = (_a = errorEventInitDict == null ? void 0 : errorEventInitDict.code) != null ? _a : void 0, this.message = (_b = errorEventInitDict == null ? void 0 : errorEventInitDict.message) != null ? _b : void 0;
  }
  /**
   * Node.js "hides" the `message` and `code` properties of the `ErrorEvent` instance,
   * when it is `console.log`'ed. This makes it harder to debug errors. To ease debugging,
   * we explicitly include the properties in the `inspect` method.
   *
   * This is automatically called by Node.js when you `console.log` an instance of this class.
   *
   * @param _depth - The current depth
   * @param options - The options passed to `util.inspect`
   * @param inspect - The inspect function to use (prevents having to import it from `util`)
   * @returns A string representation of the error
   */
  [Symbol.for("nodejs.util.inspect.custom")](_depth, options, inspect) {
    return inspect(inspectableError(this), options);
  }
  /**
   * Deno "hides" the `message` and `code` properties of the `ErrorEvent` instance,
   * when it is `console.log`'ed. This makes it harder to debug errors. To ease debugging,
   * we explicitly include the properties in the `inspect` method.
   *
   * This is automatically called by Deno when you `console.log` an instance of this class.
   *
   * @param inspect - The inspect function to use (prevents having to import it from `util`)
   * @param options - The options passed to `Deno.inspect`
   * @returns A string representation of the error
   */
  [Symbol.for("Deno.customInspect")](inspect, options) {
    return inspect(inspectableError(this), options);
  }
};
function syntaxError(message) {
  const DomException = globalThis.DOMException;
  return typeof DomException == "function" ? new DomException(message, "SyntaxError") : new SyntaxError(message);
}
function flattenError(err) {
  return err instanceof Error ? "errors" in err && Array.isArray(err.errors) ? err.errors.map(flattenError).join(", ") : "cause" in err && err.cause instanceof Error ? `${err}: ${flattenError(err.cause)}` : err.message : `${err}`;
}
function inspectableError(err) {
  return {
    type: err.type,
    message: err.message,
    code: err.code,
    defaultPrevented: err.defaultPrevented,
    cancelable: err.cancelable,
    timeStamp: err.timeStamp
  };
}
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _readyState;
var _url;
var _redirectUrl;
var _withCredentials;
var _fetch;
var _reconnectInterval;
var _reconnectTimer;
var _lastEventId;
var _controller;
var _parser;
var _onError;
var _onMessage;
var _onOpen;
var _EventSource_instances;
var connect_fn;
var _onFetchResponse;
var _onFetchError;
var getRequestOptions_fn;
var _onEvent;
var _onRetryChange;
var failConnection_fn;
var scheduleReconnect_fn;
var _reconnect;
var EventSource = class extends EventTarget {
  constructor(url2, eventSourceInitDict) {
    var _a, _b;
    super(), __privateAdd(this, _EventSource_instances), this.CONNECTING = 0, this.OPEN = 1, this.CLOSED = 2, __privateAdd(this, _readyState), __privateAdd(this, _url), __privateAdd(this, _redirectUrl), __privateAdd(this, _withCredentials), __privateAdd(this, _fetch), __privateAdd(this, _reconnectInterval), __privateAdd(this, _reconnectTimer), __privateAdd(this, _lastEventId, null), __privateAdd(this, _controller), __privateAdd(this, _parser), __privateAdd(this, _onError, null), __privateAdd(this, _onMessage, null), __privateAdd(this, _onOpen, null), __privateAdd(this, _onFetchResponse, async (response) => {
      var _a2;
      __privateGet(this, _parser).reset();
      const { body, redirected, status, headers } = response;
      if (status === 204) {
        __privateMethod(this, _EventSource_instances, failConnection_fn).call(this, "Server sent HTTP 204, not reconnecting", 204), this.close();
        return;
      }
      if (redirected ? __privateSet(this, _redirectUrl, new URL(response.url)) : __privateSet(this, _redirectUrl, void 0), status !== 200) {
        __privateMethod(this, _EventSource_instances, failConnection_fn).call(this, `Non-200 status code (${status})`, status);
        return;
      }
      if (!(headers.get("content-type") || "").startsWith("text/event-stream")) {
        __privateMethod(this, _EventSource_instances, failConnection_fn).call(this, 'Invalid content type, expected "text/event-stream"', status);
        return;
      }
      if (__privateGet(this, _readyState) === this.CLOSED)
        return;
      __privateSet(this, _readyState, this.OPEN);
      const openEvent = new Event("open");
      if ((_a2 = __privateGet(this, _onOpen)) == null || _a2.call(this, openEvent), this.dispatchEvent(openEvent), typeof body != "object" || !body || !("getReader" in body)) {
        __privateMethod(this, _EventSource_instances, failConnection_fn).call(this, "Invalid response body, expected a web ReadableStream", status), this.close();
        return;
      }
      const decoder = new TextDecoder(), reader = body.getReader();
      let open = true;
      do {
        const { done, value } = await reader.read();
        value && __privateGet(this, _parser).feed(decoder.decode(value, { stream: !done })), done && (open = false, __privateGet(this, _parser).reset(), __privateMethod(this, _EventSource_instances, scheduleReconnect_fn).call(this));
      } while (open);
    }), __privateAdd(this, _onFetchError, (err) => {
      __privateSet(this, _controller, void 0), !(err.name === "AbortError" || err.type === "aborted") && __privateMethod(this, _EventSource_instances, scheduleReconnect_fn).call(this, flattenError(err));
    }), __privateAdd(this, _onEvent, (event) => {
      typeof event.id == "string" && __privateSet(this, _lastEventId, event.id);
      const messageEvent = new MessageEvent(event.event || "message", {
        data: event.data,
        origin: __privateGet(this, _redirectUrl) ? __privateGet(this, _redirectUrl).origin : __privateGet(this, _url).origin,
        lastEventId: event.id || ""
      });
      __privateGet(this, _onMessage) && (!event.event || event.event === "message") && __privateGet(this, _onMessage).call(this, messageEvent), this.dispatchEvent(messageEvent);
    }), __privateAdd(this, _onRetryChange, (value) => {
      __privateSet(this, _reconnectInterval, value);
    }), __privateAdd(this, _reconnect, () => {
      __privateSet(this, _reconnectTimer, void 0), __privateGet(this, _readyState) === this.CONNECTING && __privateMethod(this, _EventSource_instances, connect_fn).call(this);
    });
    try {
      if (url2 instanceof URL)
        __privateSet(this, _url, url2);
      else if (typeof url2 == "string")
        __privateSet(this, _url, new URL(url2, getBaseURL()));
      else
        throw new Error("Invalid URL");
    } catch {
      throw syntaxError("An invalid or illegal string was specified");
    }
    __privateSet(this, _parser, createParser({
      onEvent: __privateGet(this, _onEvent),
      onRetry: __privateGet(this, _onRetryChange)
    })), __privateSet(this, _readyState, this.CONNECTING), __privateSet(this, _reconnectInterval, 3e3), __privateSet(this, _fetch, (_a = eventSourceInitDict == null ? void 0 : eventSourceInitDict.fetch) != null ? _a : globalThis.fetch), __privateSet(this, _withCredentials, (_b = eventSourceInitDict == null ? void 0 : eventSourceInitDict.withCredentials) != null ? _b : false), __privateMethod(this, _EventSource_instances, connect_fn).call(this);
  }
  /**
   * Returns the state of this EventSource object's connection. It can have the values described below.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/readyState)
   *
   * Note: typed as `number` instead of `0 | 1 | 2` for compatibility with the `EventSource` interface,
   * defined in the TypeScript `dom` library.
   *
   * @public
   */
  get readyState() {
    return __privateGet(this, _readyState);
  }
  /**
   * Returns the URL providing the event stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/url)
   *
   * @public
   */
  get url() {
    return __privateGet(this, _url).href;
  }
  /**
   * Returns true if the credentials mode for connection requests to the URL providing the event stream is set to "include", and false otherwise.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/withCredentials)
   */
  get withCredentials() {
    return __privateGet(this, _withCredentials);
  }
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/error_event) */
  get onerror() {
    return __privateGet(this, _onError);
  }
  set onerror(value) {
    __privateSet(this, _onError, value);
  }
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/message_event) */
  get onmessage() {
    return __privateGet(this, _onMessage);
  }
  set onmessage(value) {
    __privateSet(this, _onMessage, value);
  }
  /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/open_event) */
  get onopen() {
    return __privateGet(this, _onOpen);
  }
  set onopen(value) {
    __privateSet(this, _onOpen, value);
  }
  addEventListener(type, listener, options) {
    const listen = listener;
    super.addEventListener(type, listen, options);
  }
  removeEventListener(type, listener, options) {
    const listen = listener;
    super.removeEventListener(type, listen, options);
  }
  /**
   * Aborts any instances of the fetch algorithm started for this EventSource object, and sets the readyState attribute to CLOSED.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventSource/close)
   *
   * @public
   */
  close() {
    __privateGet(this, _reconnectTimer) && clearTimeout(__privateGet(this, _reconnectTimer)), __privateGet(this, _readyState) !== this.CLOSED && (__privateGet(this, _controller) && __privateGet(this, _controller).abort(), __privateSet(this, _readyState, this.CLOSED), __privateSet(this, _controller, void 0));
  }
};
_readyState = /* @__PURE__ */ new WeakMap(), _url = /* @__PURE__ */ new WeakMap(), _redirectUrl = /* @__PURE__ */ new WeakMap(), _withCredentials = /* @__PURE__ */ new WeakMap(), _fetch = /* @__PURE__ */ new WeakMap(), _reconnectInterval = /* @__PURE__ */ new WeakMap(), _reconnectTimer = /* @__PURE__ */ new WeakMap(), _lastEventId = /* @__PURE__ */ new WeakMap(), _controller = /* @__PURE__ */ new WeakMap(), _parser = /* @__PURE__ */ new WeakMap(), _onError = /* @__PURE__ */ new WeakMap(), _onMessage = /* @__PURE__ */ new WeakMap(), _onOpen = /* @__PURE__ */ new WeakMap(), _EventSource_instances = /* @__PURE__ */ new WeakSet(), /**
* Connect to the given URL and start receiving events
*
* @internal
*/
connect_fn = function() {
  __privateSet(this, _readyState, this.CONNECTING), __privateSet(this, _controller, new AbortController()), __privateGet(this, _fetch)(__privateGet(this, _url), __privateMethod(this, _EventSource_instances, getRequestOptions_fn).call(this)).then(__privateGet(this, _onFetchResponse)).catch(__privateGet(this, _onFetchError));
}, _onFetchResponse = /* @__PURE__ */ new WeakMap(), _onFetchError = /* @__PURE__ */ new WeakMap(), /**
* Get request options for the `fetch()` request
*
* @returns The request options
* @internal
*/
getRequestOptions_fn = function() {
  var _a;
  const init = {
    // [spec] Let `corsAttributeState` be `Anonymous`…
    // [spec] …will have their mode set to "cors"…
    mode: "cors",
    redirect: "follow",
    headers: { Accept: "text/event-stream", ...__privateGet(this, _lastEventId) ? { "Last-Event-ID": __privateGet(this, _lastEventId) } : void 0 },
    cache: "no-store",
    signal: (_a = __privateGet(this, _controller)) == null ? void 0 : _a.signal
  };
  return "window" in globalThis && (init.credentials = this.withCredentials ? "include" : "same-origin"), init;
}, _onEvent = /* @__PURE__ */ new WeakMap(), _onRetryChange = /* @__PURE__ */ new WeakMap(), /**
* Handles the process referred to in the EventSource specification as "failing a connection".
*
* @param error - The error causing the connection to fail
* @param code - The HTTP status code, if available
* @internal
*/
failConnection_fn = function(message, code) {
  var _a;
  __privateGet(this, _readyState) !== this.CLOSED && __privateSet(this, _readyState, this.CLOSED);
  const errorEvent = new ErrorEvent("error", { code, message });
  (_a = __privateGet(this, _onError)) == null || _a.call(this, errorEvent), this.dispatchEvent(errorEvent);
}, /**
* Schedules a reconnection attempt against the EventSource endpoint.
*
* @param message - The error causing the connection to fail
* @param code - The HTTP status code, if available
* @internal
*/
scheduleReconnect_fn = function(message, code) {
  var _a;
  if (__privateGet(this, _readyState) === this.CLOSED)
    return;
  __privateSet(this, _readyState, this.CONNECTING);
  const errorEvent = new ErrorEvent("error", { code, message });
  (_a = __privateGet(this, _onError)) == null || _a.call(this, errorEvent), this.dispatchEvent(errorEvent), __privateSet(this, _reconnectTimer, setTimeout(__privateGet(this, _reconnect), __privateGet(this, _reconnectInterval)));
}, _reconnect = /* @__PURE__ */ new WeakMap(), /**
* ReadyState representing an EventSource currently trying to connect
*
* @public
*/
EventSource.CONNECTING = 0, /**
* ReadyState representing an EventSource connection that is open (eg connected)
*
* @public
*/
EventSource.OPEN = 1, /**
* ReadyState representing an EventSource connection that is closed (eg disconnected)
*
* @public
*/
EventSource.CLOSED = 2;
function getBaseURL() {
  const doc = "document" in globalThis ? globalThis.document : void 0;
  return doc && typeof doc == "object" && "baseURI" in doc && typeof doc.baseURI == "string" ? doc.baseURI : void 0;
}

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/transport.js
function normalizeHeaders(headers) {
  if (!headers)
    return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}
function createFetchWithInit(baseFetch = fetch, baseInit) {
  if (!baseInit) {
    return baseFetch;
  }
  return async (url2, init) => {
    const mergedInit = {
      ...baseInit,
      ...init,
      // Headers need special handling - merge instead of replace
      headers: init?.headers ? { ...normalizeHeaders(baseInit.headers), ...normalizeHeaders(init.headers) } : baseInit.headers
    };
    return baseFetch(url2, mergedInit);
  };
}

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/client/sse.js
var SseError = class extends Error {
  constructor(code, message, event) {
    super(`SSE error: ${message}`);
    this.code = code;
    this.event = event;
  }
};
var SSEClientTransport = class {
  constructor(url2, opts) {
    this._url = url2;
    this._resourceMetadataUrl = void 0;
    this._scope = void 0;
    this._eventSourceInit = opts?.eventSourceInit;
    this._requestInit = opts?.requestInit;
    this._authProvider = opts?.authProvider;
    this._fetch = opts?.fetch;
    this._fetchWithInit = createFetchWithInit(opts?.fetch, opts?.requestInit);
  }
  async _authThenStart() {
    if (!this._authProvider) {
      throw new UnauthorizedError("No auth provider");
    }
    let result;
    try {
      result = await auth(this._authProvider, {
        serverUrl: this._url,
        resourceMetadataUrl: this._resourceMetadataUrl,
        scope: this._scope,
        fetchFn: this._fetchWithInit
      });
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
    if (result !== "AUTHORIZED") {
      throw new UnauthorizedError();
    }
    return await this._startOrAuth();
  }
  async _commonHeaders() {
    const headers = {};
    if (this._authProvider) {
      const tokens = await this._authProvider.tokens();
      if (tokens) {
        headers["Authorization"] = `Bearer ${tokens.access_token}`;
      }
    }
    if (this._protocolVersion) {
      headers["mcp-protocol-version"] = this._protocolVersion;
    }
    const extraHeaders = normalizeHeaders(this._requestInit?.headers);
    return new Headers({
      ...headers,
      ...extraHeaders
    });
  }
  _startOrAuth() {
    const fetchImpl = this?._eventSourceInit?.fetch ?? this._fetch ?? fetch;
    return new Promise((resolve, reject) => {
      this._eventSource = new EventSource(this._url.href, {
        ...this._eventSourceInit,
        fetch: async (url2, init) => {
          const headers = await this._commonHeaders();
          headers.set("Accept", "text/event-stream");
          const response = await fetchImpl(url2, {
            ...init,
            headers
          });
          if (response.status === 401 && response.headers.has("www-authenticate")) {
            const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
            this._resourceMetadataUrl = resourceMetadataUrl;
            this._scope = scope;
          }
          return response;
        }
      });
      this._abortController = new AbortController();
      this._eventSource.onerror = (event) => {
        if (event.code === 401 && this._authProvider) {
          this._authThenStart().then(resolve, reject);
          return;
        }
        const error = new SseError(event.code, event.message, event);
        reject(error);
        this.onerror?.(error);
      };
      this._eventSource.onopen = () => {
      };
      this._eventSource.addEventListener("endpoint", (event) => {
        const messageEvent = event;
        try {
          this._endpoint = new URL(messageEvent.data, this._url);
          if (this._endpoint.origin !== this._url.origin) {
            throw new Error(`Endpoint origin does not match connection origin: ${this._endpoint.origin}`);
          }
        } catch (error) {
          reject(error);
          this.onerror?.(error);
          void this.close();
          return;
        }
        resolve();
      });
      this._eventSource.onmessage = (event) => {
        const messageEvent = event;
        let message;
        try {
          message = JSONRPCMessageSchema.parse(JSON.parse(messageEvent.data));
        } catch (error) {
          this.onerror?.(error);
          return;
        }
        this.onmessage?.(message);
      };
    });
  }
  async start() {
    if (this._eventSource) {
      throw new Error("SSEClientTransport already started! If using Client class, note that connect() calls start() automatically.");
    }
    return await this._startOrAuth();
  }
  /**
   * Call this method after the user has finished authorizing via their user agent and is redirected back to the MCP client application. This will exchange the authorization code for an access token, enabling the next connection attempt to successfully auth.
   */
  async finishAuth(authorizationCode) {
    if (!this._authProvider) {
      throw new UnauthorizedError("No auth provider");
    }
    const result = await auth(this._authProvider, {
      serverUrl: this._url,
      authorizationCode,
      resourceMetadataUrl: this._resourceMetadataUrl,
      scope: this._scope,
      fetchFn: this._fetchWithInit
    });
    if (result !== "AUTHORIZED") {
      throw new UnauthorizedError("Failed to authorize");
    }
  }
  async close() {
    this._abortController?.abort();
    this._eventSource?.close();
    this.onclose?.();
  }
  async send(message) {
    if (!this._endpoint) {
      throw new Error("Not connected");
    }
    try {
      const headers = await this._commonHeaders();
      headers.set("content-type", "application/json");
      const init = {
        ...this._requestInit,
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: this._abortController?.signal
      };
      const response = await (this._fetch ?? fetch)(this._endpoint, init);
      if (!response.ok) {
        const text = await response.text().catch(() => null);
        if (response.status === 401 && this._authProvider) {
          const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
          this._resourceMetadataUrl = resourceMetadataUrl;
          this._scope = scope;
          const result = await auth(this._authProvider, {
            serverUrl: this._url,
            resourceMetadataUrl: this._resourceMetadataUrl,
            scope: this._scope,
            fetchFn: this._fetchWithInit
          });
          if (result !== "AUTHORIZED") {
            throw new UnauthorizedError();
          }
          return this.send(message);
        }
        throw new Error(`Error POSTing to endpoint (HTTP ${response.status}): ${text}`);
      }
      await response.body?.cancel();
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
  }
  setProtocolVersion(version) {
    this._protocolVersion = version;
  }
};

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/mediaType.js
var import_content_type = __toESM(require_content_type(), 1);
function mediaTypeEssence(header) {
  if (!header) {
    return void 0;
  }
  try {
    return import_content_type.default.parse(header).type;
  } catch {
    const essence = (header.split(";", 1)[0] ?? "").trim().toLowerCase();
    if (essence === "" || header.slice(essence.length).includes(",")) {
      return void 0;
    }
    return essence;
  }
}

// node_modules/.pnpm/eventsource-parser@3.1.0/node_modules/eventsource-parser/dist/stream.js
var EventSourceParserStream = class extends TransformStream {
  constructor({ onError, onRetry, onComment, maxBufferSize } = {}) {
    let parser;
    super({
      start(controller) {
        parser = createParser({
          onEvent: (event) => {
            controller.enqueue(event);
          },
          onError(error) {
            typeof onError == "function" && onError(error), (onError === "terminate" || error.type === "max-buffer-size-exceeded") && controller.error(error);
          },
          onRetry,
          onComment,
          maxBufferSize
        });
      },
      transform(chunk) {
        parser.feed(chunk);
      }
    });
  }
};

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js
var DEFAULT_STREAMABLE_HTTP_RECONNECTION_OPTIONS = {
  initialReconnectionDelay: 1e3,
  maxReconnectionDelay: 3e4,
  reconnectionDelayGrowFactor: 1.5,
  maxRetries: 2
};
var StreamableHTTPError = class extends Error {
  constructor(code, message) {
    super(`Streamable HTTP error: ${message}`);
    this.code = code;
  }
};
var StreamableHTTPClientTransport = class {
  constructor(url2, opts) {
    this._hasCompletedAuthFlow = false;
    this._url = url2;
    this._resourceMetadataUrl = void 0;
    this._scope = void 0;
    this._requestInit = opts?.requestInit;
    this._authProvider = opts?.authProvider;
    this._fetch = opts?.fetch;
    this._fetchWithInit = createFetchWithInit(opts?.fetch, opts?.requestInit);
    this._sessionId = opts?.sessionId;
    this._reconnectionOptions = opts?.reconnectionOptions ?? DEFAULT_STREAMABLE_HTTP_RECONNECTION_OPTIONS;
  }
  async _authThenStart() {
    if (!this._authProvider) {
      throw new UnauthorizedError("No auth provider");
    }
    let result;
    try {
      result = await auth(this._authProvider, {
        serverUrl: this._url,
        resourceMetadataUrl: this._resourceMetadataUrl,
        scope: this._scope,
        fetchFn: this._fetchWithInit
      });
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
    if (result !== "AUTHORIZED") {
      throw new UnauthorizedError();
    }
    return await this._startOrAuthSse({ resumptionToken: void 0 });
  }
  async _commonHeaders() {
    const headers = {};
    if (this._authProvider) {
      const tokens = await this._authProvider.tokens();
      if (tokens) {
        headers["Authorization"] = `Bearer ${tokens.access_token}`;
      }
    }
    if (this._sessionId) {
      headers["mcp-session-id"] = this._sessionId;
    }
    if (this._protocolVersion) {
      headers["mcp-protocol-version"] = this._protocolVersion;
    }
    const extraHeaders = normalizeHeaders(this._requestInit?.headers);
    return new Headers({
      ...headers,
      ...extraHeaders
    });
  }
  async _startOrAuthSse(options) {
    const { resumptionToken } = options;
    try {
      const headers = await this._commonHeaders();
      headers.set("Accept", "text/event-stream");
      if (resumptionToken) {
        headers.set("last-event-id", resumptionToken);
      }
      const response = await (this._fetch ?? fetch)(this._url, {
        method: "GET",
        headers,
        signal: this._abortController?.signal
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 && this._authProvider) {
          return await this._authThenStart();
        }
        if (response.status === 405) {
          return;
        }
        throw new StreamableHTTPError(response.status, `Failed to open SSE stream: ${response.statusText}`);
      }
      this._handleSseStream(response.body, options, true);
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
  }
  /**
   * Calculates the next reconnection delay using  backoff algorithm
   *
   * @param attempt Current reconnection attempt count for the specific stream
   * @returns Time to wait in milliseconds before next reconnection attempt
   */
  _getNextReconnectionDelay(attempt) {
    if (this._serverRetryMs !== void 0) {
      return this._serverRetryMs;
    }
    const initialDelay = this._reconnectionOptions.initialReconnectionDelay;
    const growFactor = this._reconnectionOptions.reconnectionDelayGrowFactor;
    const maxDelay = this._reconnectionOptions.maxReconnectionDelay;
    return Math.min(initialDelay * Math.pow(growFactor, attempt), maxDelay);
  }
  /**
   * Schedule a reconnection attempt using server-provided retry interval or backoff
   *
   * @param lastEventId The ID of the last received event for resumability
   * @param attemptCount Current reconnection attempt count for this specific stream
   */
  _scheduleReconnection(options, attemptCount = 0) {
    const maxRetries = this._reconnectionOptions.maxRetries;
    if (attemptCount >= maxRetries) {
      this.onerror?.(new Error(`Maximum reconnection attempts (${maxRetries}) exceeded.`));
      return;
    }
    const delay5 = this._getNextReconnectionDelay(attemptCount);
    this._reconnectionTimeout = setTimeout(() => {
      this._startOrAuthSse(options).catch((error) => {
        this.onerror?.(new Error(`Failed to reconnect SSE stream: ${error instanceof Error ? error.message : String(error)}`));
        this._scheduleReconnection(options, attemptCount + 1);
      });
    }, delay5);
  }
  _handleSseStream(stream, options, isReconnectable) {
    if (!stream) {
      return;
    }
    const { onresumptiontoken, replayMessageId } = options;
    let lastEventId;
    let hasPrimingEvent = false;
    let receivedResponse = false;
    const processStream = async () => {
      try {
        const reader = stream.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream({
          onRetry: (retryMs) => {
            this._serverRetryMs = retryMs;
          }
        })).getReader();
        while (true) {
          const { value: event, done } = await reader.read();
          if (done) {
            break;
          }
          if (event.id) {
            lastEventId = event.id;
            hasPrimingEvent = true;
            onresumptiontoken?.(event.id);
          }
          if (!event.data) {
            continue;
          }
          if (!event.event || event.event === "message") {
            try {
              const message = JSONRPCMessageSchema.parse(JSON.parse(event.data));
              if (isJSONRPCResultResponse(message)) {
                receivedResponse = true;
                if (replayMessageId !== void 0) {
                  message.id = replayMessageId;
                }
              }
              this.onmessage?.(message);
            } catch (error) {
              this.onerror?.(error);
            }
          }
        }
        const canResume = isReconnectable || hasPrimingEvent;
        const needsReconnect = canResume && !receivedResponse;
        if (needsReconnect && this._abortController && !this._abortController.signal.aborted) {
          this._scheduleReconnection({
            resumptionToken: lastEventId,
            onresumptiontoken,
            replayMessageId
          }, 0);
        }
      } catch (error) {
        this.onerror?.(new Error(`SSE stream disconnected: ${error}`));
        const canResume = isReconnectable || hasPrimingEvent;
        const needsReconnect = canResume && !receivedResponse;
        if (needsReconnect && this._abortController && !this._abortController.signal.aborted) {
          try {
            this._scheduleReconnection({
              resumptionToken: lastEventId,
              onresumptiontoken,
              replayMessageId
            }, 0);
          } catch (error2) {
            this.onerror?.(new Error(`Failed to reconnect: ${error2 instanceof Error ? error2.message : String(error2)}`));
          }
        }
      }
    };
    processStream();
  }
  async start() {
    if (this._abortController) {
      throw new Error("StreamableHTTPClientTransport already started! If using Client class, note that connect() calls start() automatically.");
    }
    this._abortController = new AbortController();
  }
  /**
   * Call this method after the user has finished authorizing via their user agent and is redirected back to the MCP client application. This will exchange the authorization code for an access token, enabling the next connection attempt to successfully auth.
   */
  async finishAuth(authorizationCode) {
    if (!this._authProvider) {
      throw new UnauthorizedError("No auth provider");
    }
    const result = await auth(this._authProvider, {
      serverUrl: this._url,
      authorizationCode,
      resourceMetadataUrl: this._resourceMetadataUrl,
      scope: this._scope,
      fetchFn: this._fetchWithInit
    });
    if (result !== "AUTHORIZED") {
      throw new UnauthorizedError("Failed to authorize");
    }
  }
  async close() {
    if (this._reconnectionTimeout) {
      clearTimeout(this._reconnectionTimeout);
      this._reconnectionTimeout = void 0;
    }
    this._abortController?.abort();
    this.onclose?.();
  }
  async send(message, options) {
    try {
      const { resumptionToken, onresumptiontoken } = options || {};
      if (resumptionToken) {
        this._startOrAuthSse({ resumptionToken, replayMessageId: isJSONRPCRequest(message) ? message.id : void 0 }).catch((err) => this.onerror?.(err));
        return;
      }
      const headers = await this._commonHeaders();
      headers.set("content-type", "application/json");
      headers.set("accept", "application/json, text/event-stream");
      const init = {
        ...this._requestInit,
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: this._abortController?.signal
      };
      const response = await (this._fetch ?? fetch)(this._url, init);
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) {
        this._sessionId = sessionId;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => null);
        if (response.status === 401 && this._authProvider) {
          if (this._hasCompletedAuthFlow) {
            throw new StreamableHTTPError(401, "Server returned 401 after successful authentication");
          }
          const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
          this._resourceMetadataUrl = resourceMetadataUrl;
          this._scope = scope;
          const result = await auth(this._authProvider, {
            serverUrl: this._url,
            resourceMetadataUrl: this._resourceMetadataUrl,
            scope: this._scope,
            fetchFn: this._fetchWithInit
          });
          if (result !== "AUTHORIZED") {
            throw new UnauthorizedError();
          }
          this._hasCompletedAuthFlow = true;
          return this.send(message);
        }
        if (response.status === 403 && this._authProvider) {
          const { resourceMetadataUrl, scope, error } = extractWWWAuthenticateParams(response);
          if (error === "insufficient_scope") {
            const wwwAuthHeader = response.headers.get("WWW-Authenticate");
            if (this._lastUpscopingHeader === wwwAuthHeader) {
              throw new StreamableHTTPError(403, "Server returned 403 after trying upscoping");
            }
            if (scope) {
              this._scope = scope;
            }
            if (resourceMetadataUrl) {
              this._resourceMetadataUrl = resourceMetadataUrl;
            }
            this._lastUpscopingHeader = wwwAuthHeader ?? void 0;
            const result = await auth(this._authProvider, {
              serverUrl: this._url,
              resourceMetadataUrl: this._resourceMetadataUrl,
              scope: this._scope,
              fetchFn: this._fetch
            });
            if (result !== "AUTHORIZED") {
              throw new UnauthorizedError();
            }
            return this.send(message);
          }
        }
        throw new StreamableHTTPError(response.status, `Error POSTing to endpoint: ${text}`);
      }
      this._hasCompletedAuthFlow = false;
      this._lastUpscopingHeader = void 0;
      if (response.status === 202) {
        await response.body?.cancel();
        if (isInitializedNotification(message)) {
          this._startOrAuthSse({ resumptionToken: void 0 }).catch((err) => this.onerror?.(err));
        }
        return;
      }
      const messages = Array.isArray(message) ? message : [message];
      const hasRequests = messages.filter((msg) => "method" in msg && "id" in msg && msg.id !== void 0).length > 0;
      const contentType2 = response.headers.get("content-type");
      const responseMediaType = mediaTypeEssence(contentType2);
      if (hasRequests) {
        if (responseMediaType === "text/event-stream") {
          this._handleSseStream(response.body, { onresumptiontoken }, false);
        } else if (responseMediaType === "application/json") {
          const data = await response.json();
          const responseMessages = Array.isArray(data) ? data.map((msg) => JSONRPCMessageSchema.parse(msg)) : [JSONRPCMessageSchema.parse(data)];
          for (const msg of responseMessages) {
            this.onmessage?.(msg);
          }
        } else {
          await response.body?.cancel();
          throw new StreamableHTTPError(-1, `Unexpected content type: ${contentType2}`);
        }
      } else {
        await response.body?.cancel();
      }
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
  }
  get sessionId() {
    return this._sessionId;
  }
  /**
   * Terminates the current session by sending a DELETE request to the server.
   *
   * Clients that no longer need a particular session
   * (e.g., because the user is leaving the client application) SHOULD send an
   * HTTP DELETE to the MCP endpoint with the Mcp-Session-Id header to explicitly
   * terminate the session.
   *
   * The server MAY respond with HTTP 405 Method Not Allowed, indicating that
   * the server does not allow clients to terminate sessions.
   */
  async terminateSession() {
    if (!this._sessionId) {
      return;
    }
    try {
      const headers = await this._commonHeaders();
      const init = {
        ...this._requestInit,
        method: "DELETE",
        headers,
        signal: this._abortController?.signal
      };
      const response = await (this._fetch ?? fetch)(this._url, init);
      await response.body?.cancel();
      if (!response.ok && response.status !== 405) {
        throw new StreamableHTTPError(response.status, `Failed to terminate session: ${response.statusText}`);
      }
      this._sessionId = void 0;
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
  }
  setProtocolVersion(version) {
    this._protocolVersion = version;
  }
  get protocolVersion() {
    return this._protocolVersion;
  }
  /**
   * Resume an SSE stream from a previous event ID.
   * Opens a GET SSE connection with Last-Event-ID header to replay missed events.
   *
   * @param lastEventId The event ID to resume from
   * @param options Optional callback to receive new resumption tokens
   */
  async resumeStream(lastEventId, options) {
    await this._startOrAuthSse({
      resumptionToken: lastEventId,
      onresumptiontoken: options?.onresumptiontoken
    });
  }
};

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/chrome-devtools-compat.js
import fs9 from "node:fs";
import os5 from "node:os";
import path12 from "node:path";
import { fileURLToPath, pathToFileURL as pathToFileURL2 } from "node:url";
var AUTO_CONNECT_FLAGS = /* @__PURE__ */ new Set(["--autoConnect", "--auto-connect"]);
var FALLBACK_PATCH_FILENAME = "mcporter-chrome-devtools-auto-connect-patch.js";
var FALLBACK_PATCH_SOURCE = `import fs from 'node:fs';
import path from 'node:path';

const MARKER = 'MCPORTER_DEVTOOLS_TIMEOUT_PATCH';
const HELPER = \`// \${MARKER}
const MCPORTER_DEVTOOLS_DETECTION_TIMEOUT = 1_000;
async function mcporterWithTimeout(promise, fallback) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise(resolve => {
                timer = setTimeout(resolve, MCPORTER_DEVTOOLS_DETECTION_TIMEOUT, fallback);
                timer.unref?.();
            }),
        ]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
\`;

const DETECTION_BLOCK = \`if (await page.hasDevTools()) {
                    mcpPage.devToolsPage = await page.openDevTools();
                }\`;

const PATCHED_DETECTION_BLOCK = \`if (await mcporterWithTimeout(page.hasDevTools(), false)) {
                    mcpPage.devToolsPage = await mcporterWithTimeout(page.openDevTools(), undefined);
                }\`;

patchChromeDevtoolsMcp();

function patchChromeDevtoolsMcp(mainPath = process.argv[1]) {
  if (!mainPath || !mainPath.includes('chrome-devtools-mcp')) {
    return;
  }
  let resolvedMainPath;
  try {
    resolvedMainPath = fs.realpathSync(mainPath);
  } catch {
    return;
  }
  if (!resolvedMainPath.endsWith(path.join('bin', 'chrome-devtools-mcp.js'))) {
    return;
  }
  const contextPath = path.resolve(path.dirname(resolvedMainPath), '..', 'McpContext.js');
  let source;
  try {
    source = fs.readFileSync(contextPath, 'utf8');
  } catch {
    return;
  }
  if (source.includes(MARKER)) {
    return;
  }
  if (!source.includes(DETECTION_BLOCK)) {
    return;
  }
  const withHelper = source.replace(
    'const NAVIGATION_TIMEOUT = 10_000;\\n',
    \`const NAVIGATION_TIMEOUT = 10_000;\\n\${HELPER}\`
  );
  const patched = withHelper.replace(DETECTION_BLOCK, PATCHED_DETECTION_BLOCK);
  try {
    fs.writeFileSync(contextPath, patched);
  } catch {
    return;
  }
}
`;
function applyChromeDevtoolsCompat(env, command, args) {
  if (!shouldApplyChromeDevtoolsCompat(command, args, env)) {
    return { env, applied: false };
  }
  const patchPath = resolveChromeDevtoolsCompatPatchPath();
  if (!patchPath) {
    return { env, applied: false };
  }
  const importFlag = `--import=${pathToFileURL2(patchPath).href}`;
  const existingOptions = env.NODE_OPTIONS?.trim();
  if (existingOptions?.includes(importFlag)) {
    return { env, applied: true, patchPath };
  }
  return {
    env: {
      ...env,
      NODE_OPTIONS: existingOptions ? `${existingOptions} ${importFlag}` : importFlag
    },
    applied: true,
    patchPath
  };
}
function shouldApplyChromeDevtoolsCompat(command, args, env = process.env) {
  if (env.MCPORTER_DISABLE_CHROME_DEVTOOLS_COMPAT === "1") {
    return false;
  }
  const tokens = [command, ...args];
  return tokens.some(isChromeDevtoolsToken) && args.some((arg) => AUTO_CONNECT_FLAGS.has(arg));
}
function isChromeDevtoolsToken(token) {
  return token === "chrome-devtools-mcp" || token.startsWith("chrome-devtools-mcp@") || token.includes("/chrome-devtools-mcp");
}
function resolveChromeDevtoolsCompatPatchPath(candidates = defaultChromeDevtoolsPatchCandidates(), fallbackDir = os5.tmpdir()) {
  const existing = candidates.find((candidate) => fs9.existsSync(candidate));
  if (existing) {
    return existing;
  }
  return writeFallbackPatch(fallbackDir);
}
function defaultChromeDevtoolsPatchCandidates() {
  const here = path12.dirname(fileURLToPath(import.meta.url));
  return [
    path12.join(here, "chrome-devtools-auto-connect-patch.js"),
    path12.resolve(here, "..", "dist", "chrome-devtools-auto-connect-patch.js")
  ];
}
function writeFallbackPatch(fallbackDir) {
  const patchPath = path12.join(fallbackDir, FALLBACK_PATCH_FILENAME);
  try {
    fs9.writeFileSync(patchPath, FALLBACK_PATCH_SOURCE, { mode: 384 });
    return patchPath;
  } catch {
    return void 0;
  }
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/oauth.js
import { spawn as spawn2 } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { URL as URL2 } from "node:url";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/oauth-client-info.js
function buildStaticClientInformation(definition, options = {}) {
  if (!definition.oauthClientId) {
    return void 0;
  }
  const clientSecret = resolveOAuthClientSecret(definition);
  return {
    client_id: definition.oauthClientId,
    ...clientSecret ? { client_secret: clientSecret } : {},
    ...options.redirectUrl ? { redirect_uris: [options.redirectUrl.toString()] } : {},
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    ...definition.oauthTokenEndpointAuthMethod ? { token_endpoint_auth_method: definition.oauthTokenEndpointAuthMethod } : {}
  };
}
function resolveOAuthClientSecret(definition) {
  if (definition.oauthClientSecretEnv) {
    const value = process.env[definition.oauthClientSecretEnv];
    if (!value) {
      throw new Error(`Environment variable '${definition.oauthClientSecretEnv}' is required for OAuth client secret.`);
    }
    return value;
  }
  return definition.oauthClientSecret;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/oauth-persistence.js
import fs10 from "node:fs/promises";
import { Buffer as Buffer2 } from "node:buffer";
import os6 from "node:os";
import path14 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/oauth-vault.js
import crypto3 from "node:crypto";
import path13 from "node:path";
function getOAuthVaultPath() {
  return path13.join(mcporterDir("data"), "credentials.json");
}
async function readVaultState() {
  try {
    const existing = await readJsonFile(getOAuthVaultPath());
    if (existing && existing.version === 1 && existing.entries && typeof existing.entries === "object") {
      return { vault: existing, needsRepair: false };
    }
    if (existing !== void 0) {
      return { vault: emptyVault(), needsRepair: true };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return { vault: emptyVault(), needsRepair: true };
  }
  return { vault: emptyVault(), needsRepair: false };
}
async function readVault() {
  return (await readVaultState()).vault;
}
function emptyVault() {
  return { version: 1, entries: {} };
}
async function writeVault(contents) {
  await writeJsonFile(getOAuthVaultPath(), contents);
}
function vaultKeyForDefinition(definition) {
  const descriptor2 = {
    name: definition.name,
    url: definition.command.kind === "http" ? definition.command.url.toString() : null,
    command: definition.command.kind === "stdio" ? { command: definition.command.command, args: definition.command.args ?? [] } : null
  };
  const hash = crypto3.createHash("sha256").update(JSON.stringify(descriptor2)).digest("hex").slice(0, 16);
  return `${definition.name}|${hash}`;
}
async function loadVaultEntry(definition) {
  const vault = await readVault();
  const key = vaultKeyForDefinition(definition);
  const exact = isVaultEntry(vault.entries[key]) ? vault.entries[key] : void 0;
  const fallback = findSameUrlCredentials(vault, definition, key, exact);
  if (!fallback.tokens && !fallback.clientInfo) {
    return exact;
  }
  if (!exact) {
    return {
      serverName: definition.name,
      serverUrl: definition.command.kind === "http" ? definition.command.url.toString() : void 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      tokens: fallback.tokens,
      clientInfo: fallback.clientInfo
    };
  }
  return {
    ...exact,
    tokens: exact.tokens ?? fallback.tokens,
    clientInfo: exact.clientInfo ?? (exact.tokens ? void 0 : fallback.clientInfo)
  };
}
function findSameUrlCredentials(vault, definition, exactKey, exact) {
  if (definition.command.kind !== "http") {
    return { sourceKeys: [] };
  }
  const serverUrl = definition.command.url.toString();
  const candidates = Object.entries(vault.entries).filter(([key, entry]) => key !== exactKey && isVaultEntry(entry) && entry.serverUrl === serverUrl && isLegacyOAuthRenameCandidate(definition, entry) && (entry.tokens || entry.clientInfo)).map(([key, entry]) => ({ key, entry })).toSorted((a, b) => Date.parse(b.entry.updatedAt) - Date.parse(a.entry.updatedAt));
  const requiredClientId = definition.oauthClientId ?? clientIdFromEntry(exact);
  if (requiredClientId) {
    const tokenSource = candidates.find(({ entry }) => (entry.tokens || entry.clientInfo) && clientIdFromEntry(entry) === requiredClientId);
    return {
      tokens: tokenSource?.entry.tokens,
      clientInfo: exact?.clientInfo ? void 0 : tokenSource?.entry.clientInfo,
      sourceKeys: tokenSource ? [tokenSource.key] : []
    };
  }
  const source = candidates.find(({ entry }) => entry.clientInfo && clientIdFromEntry(entry));
  return {
    tokens: source?.entry.tokens,
    clientInfo: source?.entry.clientInfo,
    sourceKeys: source ? [source.key] : []
  };
}
function isLegacyOAuthRenameCandidate(definition, entry) {
  return entry.serverName === `${definition.name}-oauth`;
}
function legacyOAuthRenameKeys(vault, definition, exactKey) {
  if (definition.command.kind !== "http") {
    return [];
  }
  const serverUrl = definition.command.url.toString();
  return Object.entries(vault.entries).filter(([key, entry]) => key !== exactKey && isVaultEntry(entry) && entry.serverUrl === serverUrl && isLegacyOAuthRenameCandidate(definition, entry)).map(([key]) => key);
}
function isVaultEntry(entry) {
  return Boolean(entry && typeof entry === "object" && typeof entry.serverName === "string" && typeof entry.updatedAt === "string");
}
function clientIdFromEntry(entry) {
  const clientId = entry?.clientInfo?.client_id;
  return typeof clientId === "string" && clientId.length > 0 ? clientId : void 0;
}
async function saveVaultEntry(definition, patch) {
  await withFileLock(getOAuthVaultPath(), async () => {
    const vault = await readVault();
    const key = vaultKeyForDefinition(definition);
    const existing = isVaultEntry(vault.entries[key]) ? vault.entries[key] : void 0;
    const fallback = findSameUrlCredentials(vault, definition, key, existing);
    const current = existing ?? {
      serverName: definition.name,
      serverUrl: definition.command.kind === "http" ? definition.command.url.toString() : void 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    vault.entries[key] = {
      ...current,
      ...patch,
      clientInfo: patch.clientInfo ?? current.clientInfo ?? (patch.tokens && !current.tokens ? fallback.clientInfo : void 0),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeVault(vault);
  });
}
async function clearVaultEntry(definition, scope) {
  const key = vaultKeyForDefinition(definition);
  await withFileLock(getOAuthVaultPath(), async () => {
    const { vault, needsRepair } = await readVaultState();
    const existing = isVaultEntry(vault.entries[key]) ? vault.entries[key] : void 0;
    const fallback = findSameUrlCredentials(vault, definition, key, existing);
    const inheritedKeys = scope === "all" ? legacyOAuthRenameKeys(vault, definition, key) : fallback.sourceKeys;
    if (!existing && inheritedKeys.length === 0) {
      if (needsRepair) {
        await writeVault(vault);
      }
      return;
    }
    if (scope === "all") {
      delete vault.entries[key];
    } else if (existing) {
      const updated = { ...existing };
      if (scope === "tokens") {
        delete updated.tokens;
      }
      if (scope === "client") {
        delete updated.clientInfo;
      }
      if (scope === "verifier") {
        delete updated.codeVerifier;
      }
      if (scope === "state") {
        delete updated.state;
      }
      updated.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      vault.entries[key] = updated;
    }
    for (const fallbackKey of inheritedKeys) {
      const inherited = vault.entries[fallbackKey];
      if (!inherited) {
        continue;
      }
      if (scope === "all") {
        delete vault.entries[fallbackKey];
        continue;
      }
      const updated = { ...inherited };
      if (scope === "tokens") {
        delete updated.tokens;
      }
      if (scope === "client") {
        delete updated.clientInfo;
      }
      updated.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      vault.entries[fallbackKey] = updated;
    }
    await writeVault(vault);
  });
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/oauth-persistence.js
var TOKEN_EXPIRY_SKEW_SECONDS = 60;
function withStoredExpiry(tokens) {
  const stored = tokens;
  if (typeof stored.expires_at === "number" || typeof stored.expiresAt === "number") {
    return tokens;
  }
  if (typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in)) {
    return {
      ...tokens,
      expires_at: Math.floor(Date.now() / 1e3) + tokens.expires_in
    };
  }
  return tokens;
}
function tokenExpirySeconds(tokens) {
  const stored = tokens;
  for (const candidate of [stored.expires_at, stored.expiresAt]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return void 0;
}
function cachedTokensChanged(original, current) {
  if (!current || typeof current.access_token !== "string" || current.access_token.trim().length === 0) {
    return false;
  }
  if (typeof original.refresh_token === "string" && typeof current.refresh_token === "string") {
    return current.refresh_token !== original.refresh_token || current.access_token !== original.access_token;
  }
  return current.access_token !== original.access_token;
}
function shouldRefreshCachedToken(tokens, skewSeconds = TOKEN_EXPIRY_SKEW_SECONDS) {
  const expiresAt = tokenExpirySeconds(tokens);
  if (expiresAt !== void 0) {
    return expiresAt <= Math.floor(Date.now() / 1e3) + skewSeconds;
  }
  return typeof tokens.expires_in === "number" && typeof tokens.refresh_token === "string";
}
function resourceForRefresh(serverUrl, resourceMetadata) {
  if (!resourceMetadata) {
    return void 0;
  }
  const defaultResource = resourceUrlFromServerUrl(serverUrl);
  if (!checkResourceAllowed({ requestedResource: defaultResource, configuredResource: resourceMetadata.resource })) {
    throw new Error(`Protected resource ${resourceMetadata.resource} does not match expected ${defaultResource} (or origin)`);
  }
  return new URL(resourceMetadata.resource);
}
function unrecoverableOAuthRefreshCode(error) {
  const errorCode = oauthErrorCode(error);
  if (errorCode && ["invalid_client", "invalid_grant", "unauthorized_client"].includes(errorCode)) {
    return errorCode;
  }
  return void 0;
}
function oauthErrorCode(error) {
  if (!error || typeof error !== "object") {
    return void 0;
  }
  const { errorCode, name } = error;
  if (typeof errorCode === "string" && errorCode.length > 0) {
    return errorCode.toLowerCase();
  }
  if (typeof name === "string") {
    const normalized = name.toLowerCase();
    if (normalized === "invalidclienterror") {
      return "invalid_client";
    }
    if (normalized === "invalidgranterror") {
      return "invalid_grant";
    }
    if (normalized === "unauthorizedclienterror") {
      return "unauthorized_client";
    }
  }
  return void 0;
}
var DirectoryPersistence = class {
  root;
  logger;
  tokenPath;
  clientInfoPath;
  codeVerifierPath;
  statePath;
  constructor(root, logger) {
    this.root = root;
    this.logger = logger;
    this.tokenPath = path14.join(root, "tokens.json");
    this.clientInfoPath = path14.join(root, "client.json");
    this.codeVerifierPath = path14.join(root, "code_verifier.txt");
    this.statePath = path14.join(root, "state.txt");
  }
  describe() {
    return this.root;
  }
  async ensureDir() {
    await fs10.mkdir(this.root, { recursive: true });
  }
  async readTokens() {
    return this.readJsonOrUndefined(this.tokenPath);
  }
  async saveTokens(tokens) {
    await this.ensureDir();
    await writeJsonFile(this.tokenPath, withStoredExpiry(tokens));
    this.logger?.debug?.(`Saved tokens to ${this.tokenPath}`);
  }
  async readClientInfo() {
    return this.readJsonOrUndefined(this.clientInfoPath);
  }
  async saveClientInfo(info) {
    await this.ensureDir();
    await writeJsonFile(this.clientInfoPath, info);
  }
  async readCodeVerifier() {
    try {
      return (await fs10.readFile(this.codeVerifierPath, "utf8")).trim();
    } catch (error) {
      if (error.code === "ENOENT") {
        return void 0;
      }
      throw error;
    }
  }
  async saveCodeVerifier(value) {
    await this.ensureDir();
    await writeTextFileAtomic(this.codeVerifierPath, value);
  }
  async readState() {
    return readJsonFile(this.statePath);
  }
  // A present-but-corrupt credential cache (tokens/client) means "no usable
  // credentials": degrade to re-auth instead of crashing the connection,
  // mirroring VaultPersistence and the daemon/server-proxy readers. Genuine I/O
  // faults still propagate (readJsonFile re-throws everything except ENOENT).
  // OAuth state is intentionally excluded (see readState) so its CSRF check
  // still fails closed on a corrupt state file.
  async readJsonOrUndefined(filePath) {
    try {
      return await readJsonFile(filePath);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      this.logger?.debug?.(`Ignoring corrupt OAuth cache file ${filePath}: ${error.message}`);
      return void 0;
    }
  }
  async saveState(value) {
    await this.ensureDir();
    await writeJsonFile(this.statePath, value);
  }
  async clear(scope) {
    const files = [];
    if (scope === "all" || scope === "tokens") {
      files.push(this.tokenPath);
    }
    if (scope === "all" || scope === "client") {
      files.push(this.clientInfoPath);
    }
    if (scope === "all" || scope === "verifier") {
      files.push(this.codeVerifierPath);
    }
    if (scope === "all" || scope === "state") {
      files.push(this.statePath);
    }
    await Promise.all(files.map(async (file) => {
      try {
        await fs10.unlink(file);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }));
  }
};
var VaultPersistence = class {
  definition;
  constructor(definition) {
    this.definition = definition;
  }
  describe() {
    return `${getOAuthVaultPath()} (vault)`;
  }
  async readTokens() {
    return (await loadVaultEntry(this.definition))?.tokens;
  }
  async saveTokens(tokens) {
    await saveVaultEntry(this.definition, { tokens: withStoredExpiry(tokens) });
  }
  async readClientInfo() {
    return (await loadVaultEntry(this.definition))?.clientInfo;
  }
  async saveClientInfo(info) {
    await saveVaultEntry(this.definition, { clientInfo: info });
  }
  async readCodeVerifier() {
    return (await loadVaultEntry(this.definition))?.codeVerifier;
  }
  async saveCodeVerifier(value) {
    await saveVaultEntry(this.definition, { codeVerifier: value });
  }
  async readState() {
    return (await loadVaultEntry(this.definition))?.state;
  }
  async saveState(value) {
    await saveVaultEntry(this.definition, { state: value });
  }
  async clear(scope) {
    await clearVaultEntry(this.definition, scope);
  }
};
var CompositePersistence = class {
  stores;
  constructor(stores) {
    this.stores = stores;
  }
  describe() {
    return this.stores.map((store) => store.describe()).join(" + ");
  }
  async readTokens() {
    for (const store of this.stores) {
      const result = await store.readTokens();
      if (result) {
        return result;
      }
    }
    return void 0;
  }
  async saveTokens(tokens) {
    await Promise.all(this.stores.map((store) => store.saveTokens(tokens)));
  }
  async readClientInfo() {
    for (const store of this.stores) {
      const result = await store.readClientInfo();
      if (result) {
        return result;
      }
    }
    return void 0;
  }
  async saveClientInfo(info) {
    await Promise.all(this.stores.map((store) => store.saveClientInfo(info)));
  }
  async readCodeVerifier() {
    for (const store of this.stores) {
      const result = await store.readCodeVerifier();
      if (result) {
        return result;
      }
    }
    return void 0;
  }
  async saveCodeVerifier(value) {
    await Promise.all(this.stores.map((store) => store.saveCodeVerifier(value)));
  }
  async readState() {
    for (const store of this.stores) {
      const result = await store.readState();
      if (result) {
        return result;
      }
    }
    return void 0;
  }
  async saveState(value) {
    await Promise.all(this.stores.map((store) => store.saveState(value)));
  }
  async clear(scope) {
    await Promise.all(this.stores.map((store) => store.clear(scope)));
  }
};
async function buildOAuthPersistence(definition, logger) {
  const vault = new VaultPersistence(definition);
  const stores = [vault];
  if (definition.tokenCacheDir) {
    stores.unshift(new DirectoryPersistence(definition.tokenCacheDir, logger));
  }
  const legacyDir = path14.join(legacyMcporterDir(), definition.name);
  if (!definition.tokenCacheDir && legacyDir) {
    const legacy = new DirectoryPersistence(legacyDir, logger);
    const legacyTokens = await legacy.readTokens();
    const legacyClient = await legacy.readClientInfo();
    const legacyVerifier = await legacy.readCodeVerifier();
    const legacyState = await legacy.readState();
    if (legacyTokens || legacyClient || legacyVerifier || legacyState) {
      if (legacyTokens) {
        await vault.saveTokens(legacyTokens);
      }
      if (legacyClient) {
        await vault.saveClientInfo(legacyClient);
      }
      if (legacyVerifier) {
        await vault.saveCodeVerifier(legacyVerifier);
      }
      if (legacyState) {
        await vault.saveState(legacyState);
      }
      logger?.info?.(`Migrated legacy OAuth cache for '${definition.name}' into vault.`);
    }
  }
  return stores.length === 1 ? vault : new CompositePersistence(stores);
}
async function clearOAuthCaches(definition, logger, scope = "all") {
  const persistence = await buildOAuthPersistence(definition, logger);
  await persistence.clear(scope);
  const legacyDir = path14.join(legacyMcporterDir(), definition.name);
  if (legacyDir && (!definition.tokenCacheDir || legacyDir !== definition.tokenCacheDir)) {
    const legacy = new DirectoryPersistence(legacyDir, logger);
    await legacy.clear(scope);
  }
  if (definition.tokenCacheDir && scope === "all") {
    await fs10.rm(definition.tokenCacheDir, { recursive: true, force: true });
  }
  const legacyFiles = [];
  if (definition.name.toLowerCase() === "gmail") {
    legacyFiles.push(path14.join(os6.homedir(), ".gmail-mcp", "credentials.json"));
  }
  await Promise.all(legacyFiles.map(async (file) => {
    try {
      await fs10.unlink(file);
      logger?.info?.(`Cleared legacy OAuth cache file ${file}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }));
}
async function readCachedAccessToken(definition, logger) {
  const persistence = await buildOAuthPersistence(definition, logger);
  const tokens = await persistence.readTokens();
  if (!tokens || typeof tokens.access_token !== "string" || tokens.access_token.trim().length === 0) {
    return void 0;
  }
  if (definition.auth === "refreshable_bearer") {
    return await readExplicitRefreshableBearerToken(definition, persistence, tokens, logger);
  }
  if (!shouldRefreshCachedToken(tokens)) {
    return tokens.access_token;
  }
  if (typeof tokens.refresh_token !== "string" || tokens.refresh_token.trim().length === 0) {
    return tokens.access_token;
  }
  try {
    const clientInformation = buildStaticClientInformation(definition) ?? await persistence.readClientInfo();
    if (!clientInformation) {
      logger?.debug?.(`Cached OAuth token for '${definition.name}' is expired, but no client information is available.`);
      return tokens.access_token;
    }
    if (definition.command.kind !== "http") {
      return tokens.access_token;
    }
    const serverInfo = await discoverOAuthServerInfo(definition.command.url);
    const resource = resourceForRefresh(definition.command.url, serverInfo.resourceMetadata);
    const refreshed = await refreshAuthorization(serverInfo.authorizationServerUrl, {
      metadata: serverInfo.authorizationServerMetadata,
      clientInformation,
      refreshToken: tokens.refresh_token,
      ...resource ? { resource } : {}
    });
    await persistence.saveTokens(refreshed);
    logger?.debug?.(`Refreshed cached OAuth access token for '${definition.name}' (non-interactive).`);
    return refreshed.access_token;
  } catch (error) {
    logger?.debug?.(`Failed to refresh cached OAuth token for '${definition.name}' non-interactively: ${error instanceof Error ? error.message : String(error)}`);
    const unrecoverableCode = unrecoverableOAuthRefreshCode(error);
    if (unrecoverableCode) {
      const latestTokens = await persistence.readTokens();
      if (cachedTokensChanged(tokens, latestTokens)) {
        logger?.debug?.(`Kept cached OAuth token for '${definition.name}' because another refresh updated it first.`);
        return latestTokens?.access_token;
      }
      const scope = unrecoverableCode === "invalid_grant" ? "tokens" : "all";
      await clearOAuthCaches(definition, logger, scope);
      logger?.debug?.(`Cleared cached OAuth ${scope === "all" ? "credentials" : "token"} for '${definition.name}' after unrecoverable refresh failure.`);
      return void 0;
    }
    return tokens.access_token;
  }
}
async function readExplicitRefreshableBearerToken(definition, persistence, tokens, logger) {
  const refresh = definition.refresh;
  const skewSeconds = refresh?.refreshSkewSeconds ?? TOKEN_EXPIRY_SKEW_SECONDS;
  if (!shouldRefreshCachedToken(tokens, skewSeconds)) {
    return tokens.access_token;
  }
  if (!refresh) {
    throw new Error(`Cached bearer token for '${definition.name}' is expired, but refresh is not configured.`);
  }
  if (typeof tokens.refresh_token !== "string" || tokens.refresh_token.trim().length === 0) {
    throw new Error(`Cached bearer token for '${definition.name}' is expired, but no refresh_token is available.`);
  }
  try {
    const refreshed = await refreshBearerToken(definition, tokens.refresh_token);
    await persistence.saveTokens(refreshed);
    logger?.debug?.(`Refreshed bearer access token for '${definition.name}' (non-interactive).`);
    return refreshed.access_token;
  } catch (error) {
    logger?.debug?.(`Failed to refresh bearer token for '${definition.name}' non-interactively: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(`Failed to refresh cached bearer token for '${definition.name}': ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
async function refreshBearerToken(definition, refreshToken) {
  const refresh = definition.refresh;
  if (!refresh) {
    throw new Error("Missing refresh configuration.");
  }
  const clientId = readEnvOrConfig(refresh.clientIdEnv, definition.oauthClientId);
  const method = refresh.clientAuthMethod ?? definition.oauthTokenEndpointAuthMethod ?? "client_secret_basic";
  const clientSecret = method === "none" ? void 0 : readClientSecret(definition, refresh.clientSecretEnv);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const headers = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded"
  };
  if (method === "client_secret_post") {
    if (clientId) {
      body.set("client_id", clientId);
    }
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }
  } else if (method === "none") {
    if (clientId) {
      body.set("client_id", clientId);
    }
  } else {
    if (!clientId || !clientSecret) {
      throw new Error(`Refresh client credentials are required for '${method}'.`);
    }
    headers.authorization = `Basic ${Buffer2.from(`${formEncodeCredential(clientId)}:${formEncodeCredential(clientSecret)}`).toString("base64")}`;
  }
  const response = await fetch(refresh.tokenEndpoint, {
    method: "POST",
    headers,
    body
  });
  if (!response.ok) {
    throw new Error(`Token endpoint returned HTTP ${response.status}.`);
  }
  const payload = normalizeBearerTokenResponse(await response.json());
  return {
    ...payload,
    ...payload.refresh_token ? {} : { refresh_token: refreshToken }
  };
}
function normalizeBearerTokenResponse(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Token endpoint did not return a JSON object.");
  }
  const payload = value;
  if (typeof payload.access_token !== "string" || payload.access_token.trim().length === 0) {
    throw new Error("Token endpoint did not return an access_token.");
  }
  return {
    access_token: payload.access_token,
    token_type: typeof payload.token_type === "string" && payload.token_type ? payload.token_type : "Bearer",
    ...typeof payload.id_token === "string" ? { id_token: payload.id_token } : {},
    ...typeof payload.scope === "string" ? { scope: payload.scope } : {},
    ...typeof payload.refresh_token === "string" && payload.refresh_token ? { refresh_token: payload.refresh_token } : {},
    ...coerceExpiresIn(payload.expires_in)
  };
}
function coerceExpiresIn(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { expires_in: value };
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return { expires_in: parsed };
    }
  }
  return {};
}
function readEnvOrConfig(envName, fallback) {
  if (!envName) {
    return fallback;
  }
  const value = process.env[envName];
  if (value === void 0 || value.trim().length === 0) {
    throw new Error(`Environment variable '${envName}' is required for bearer token refresh.`);
  }
  return value;
}
function formEncodeCredential(value) {
  return new URLSearchParams([["", value]]).toString().slice(1);
}
function readClientSecret(definition, refreshClientSecretEnv) {
  if (refreshClientSecretEnv) {
    return readEnvOrConfig(refreshClientSecretEnv, void 0);
  }
  return resolveOAuthClientSecret2(definition);
}
function resolveOAuthClientSecret2(definition) {
  if (definition.oauthClientSecretEnv) {
    const value = process.env[definition.oauthClientSecretEnv];
    if (value === void 0 || value.trim().length === 0) {
      throw new Error(`Environment variable '${definition.oauthClientSecretEnv}' is required for OAuth client secret.`);
    }
    return value;
  }
  return definition.oauthClientSecret;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/oauth.js
var CALLBACK_HOST = "127.0.0.1";
var CALLBACK_PATH = "/callback";
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function openExternal(url2, platform = process.platform, launch = spawn2) {
  const stdio = "ignore";
  try {
    if (platform === "darwin") {
      const child = launch("open", [url2], { stdio, detached: true });
      child.unref();
    } else if (platform === "win32") {
      const child = launch("cmd", ["/s", "/c", `start "" "${url2}"`], {
        stdio,
        detached: true,
        windowsVerbatimArguments: true
      });
      child.unref();
    } else {
      try {
        const child = launch("xdg-open", [url2], { stdio, detached: true });
        child.on("error", () => {
        });
        child.unref();
      } catch {
      }
    }
  } catch {
  }
}
var PersistentOAuthClientProvider = class _PersistentOAuthClientProvider {
  definition;
  options;
  metadata;
  logger;
  persistence;
  redirectUrlValue;
  authorizationDeferred = null;
  authorizationRedirectStarted = false;
  server;
  constructor(definition, persistence, redirectUrl, logger, options = {}) {
    this.definition = definition;
    this.options = options;
    this.redirectUrlValue = redirectUrl;
    this.logger = logger;
    this.persistence = persistence;
    this.metadata = {
      client_name: definition.clientName ?? `mcporter (${definition.name})`,
      redirect_uris: [this.redirectUrlValue.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      // Omit scope so the MCP SDK can derive it from the server's metadata
      // (resource metadata scopes_supported or auth server scopes_supported).
      // Hardcoding 'mcp:tools' breaks providers like Granola whose auth server
      // does not recognise that scope value.
      // If oauthScope is explicitly configured, prefer that exact value.
      ...definition.oauthScope !== void 0 ? { scope: definition.oauthScope || void 0 } : {}
    };
  }
  static async create(definition, logger, options = {}) {
    const persistence = await buildOAuthPersistence(definition, logger);
    const server = http.createServer();
    const overrideRedirect = definition.oauthRedirectUrl ? new URL2(definition.oauthRedirectUrl) : null;
    const listenHost = overrideRedirect?.hostname ?? CALLBACK_HOST;
    const overridePort = overrideRedirect?.port ?? "";
    const usesDynamicPort = !overrideRedirect || overridePort === "" || overridePort === "0";
    const desiredPort = usesDynamicPort ? void 0 : Number.parseInt(overridePort, 10);
    const callbackPath = overrideRedirect?.pathname && overrideRedirect.pathname !== "/" ? overrideRedirect.pathname : CALLBACK_PATH;
    const port = await new Promise((resolve, reject) => {
      server.listen(desiredPort ?? 0, listenHost, () => {
        const address = server.address();
        if (typeof address === "object" && address && "port" in address) {
          resolve(address.port);
        } else {
          reject(new Error("Failed to determine callback port"));
        }
      });
      server.once("error", (error) => reject(error));
    });
    const redirectUrl = overrideRedirect ? new URL2(overrideRedirect.toString()) : new URL2(`http://${listenHost}:${port}${callbackPath}`);
    if (usesDynamicPort) {
      redirectUrl.port = String(port);
    }
    if (!overrideRedirect || overrideRedirect.pathname === "/" || overrideRedirect.pathname === "") {
      redirectUrl.pathname = callbackPath;
    }
    if (usesDynamicPort) {
      try {
        const cachedClient = await persistence.readClientInfo();
        const cachedRedirect = firstRedirectUri(cachedClient);
        if (cachedRedirect && cachedRedirect !== redirectUrl.toString()) {
          logger.info(`Redirect URI changed (${cachedRedirect} \u2192 ${redirectUrl.toString()}); clearing stale client registration.`);
          await persistence.clear("client");
        }
      } catch (error) {
        await new Promise((resolve) => {
          server.close(() => resolve());
        });
        throw error;
      }
    }
    const provider = new _PersistentOAuthClientProvider(definition, persistence, redirectUrl, logger, options);
    provider.attachServer(server);
    return {
      provider,
      close: async () => {
        await provider.close();
      }
    };
  }
  // attachServer listens for the OAuth redirect and resolves/rejects the deferred code promise.
  attachServer(server) {
    this.server = server;
    server.on("request", async (req, res) => {
      try {
        const url2 = req.url ?? "";
        const parsed = new URL2(url2, this.redirectUrlValue);
        const expectedPath = this.redirectUrlValue.pathname || "/callback";
        if (parsed.pathname !== expectedPath) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        const code = parsed.searchParams.get("code");
        const error = parsed.searchParams.get("error");
        const receivedState = parsed.searchParams.get("state");
        const expectedState = await this.persistence.readState();
        if (expectedState && receivedState !== expectedState) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html");
          res.end("<html><body><h1>Authorization failed</h1><p>Invalid OAuth state</p></body></html>");
          this.authorizationDeferred?.reject(new Error("Invalid OAuth state"));
          this.authorizationDeferred = null;
          return;
        }
        if (code) {
          this.logger.info(`Received OAuth authorization code for ${this.definition.name}`);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          res.end("<html><body><h1>Authorization successful</h1><p>You can return to the CLI.</p></body></html>");
          this.authorizationDeferred?.resolve(code);
          this.authorizationDeferred = null;
        } else if (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html");
          res.end(`<html><body><h1>Authorization failed</h1><p>${error}</p></body></html>`);
          this.authorizationDeferred?.reject(new Error(`OAuth error: ${error}`));
          this.authorizationDeferred = null;
        } else {
          res.statusCode = 400;
          res.end("Missing authorization code");
          this.authorizationDeferred?.reject(new Error("Missing authorization code"));
          this.authorizationDeferred = null;
        }
      } catch (error) {
        this.authorizationDeferred?.reject(error);
        this.authorizationDeferred = null;
      }
    });
  }
  get redirectUrl() {
    return this.redirectUrlValue;
  }
  get clientMetadata() {
    return this.metadata;
  }
  async state() {
    const existing = await this.persistence.readState();
    if (existing) {
      return existing;
    }
    const state = randomUUID();
    await this.persistence.saveState(state);
    return state;
  }
  async clientInformation() {
    const staticClient = buildStaticClientInformation(this.definition, { redirectUrl: this.redirectUrlValue });
    if (staticClient) {
      return staticClient;
    }
    return this.persistence.readClientInfo();
  }
  async saveClientInformation(clientInformation) {
    await this.persistence.saveClientInfo(clientInformation);
  }
  async tokens() {
    return this.persistence.readTokens();
  }
  async saveTokens(tokens) {
    await this.persistence.saveTokens(tokens);
    this.logger.info(`Saved OAuth tokens for ${this.definition.name} (${this.persistence.describe()})`);
  }
  async redirectToAuthorization(authorizationUrl) {
    this.authorizationRedirectStarted = true;
    this.ensureAuthorizationDeferred();
    const request = {
      authorizationUrl: authorizationUrl.toString(),
      redirectUrl: this.redirectUrlValue.toString()
    };
    if (this.options.suppressBrowserLaunch) {
      await this.options.onAuthorizationUrl?.(request);
      return;
    }
    this.logger.info(`Authorization required for ${this.definition.name}. Opening browser...`);
    __oauthInternals.openExternal(request.authorizationUrl);
    this.logger.warn(`If the browser did not open, visit ${request.authorizationUrl} manually.`);
  }
  hasAuthorizationRedirectStarted() {
    return this.authorizationRedirectStarted;
  }
  async saveCodeVerifier(codeVerifier) {
    await this.persistence.saveCodeVerifier(codeVerifier);
  }
  async codeVerifier() {
    const value = await this.persistence.readCodeVerifier();
    if (!value) {
      throw new Error(`Missing PKCE code verifier for ${this.definition.name}`);
    }
    return value.trim();
  }
  // invalidateCredentials removes cached files to force the next OAuth flow.
  async invalidateCredentials(scope) {
    await this.persistence.clear(scope);
  }
  // waitForAuthorizationCode resolves once the local callback server captures a redirect.
  // The same deferred is shared with redirectToAuthorization so callback resolution is stable.
  async waitForAuthorizationCode() {
    return this.ensureAuthorizationDeferred().promise;
  }
  // close stops the temporary callback server created for the OAuth session.
  async close() {
    if (this.authorizationDeferred) {
      this.authorizationDeferred.reject(new Error("OAuth session closed before receiving authorization code."));
      this.authorizationDeferred = null;
    }
    if (!this.server) {
      return;
    }
    this.server.closeAllConnections?.();
    const server = this.server;
    this.server = void 0;
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
  ensureAuthorizationDeferred() {
    if (!this.authorizationDeferred) {
      this.authorizationDeferred = createDeferred();
    }
    return this.authorizationDeferred;
  }
};
async function createOAuthSession(definition, logger, options = {}) {
  const { provider, close } = await PersistentOAuthClientProvider.create(definition, logger, options);
  const waitForAuthorizationCode = () => provider.waitForAuthorizationCode();
  const hasAuthorizationRedirectStarted = () => provider.hasAuthorizationRedirectStarted();
  return {
    provider,
    waitForAuthorizationCode,
    hasAuthorizationRedirectStarted,
    close
  };
}
function firstRedirectUri(client) {
  if (!client || typeof client !== "object") {
    return void 0;
  }
  const redirectUris = client.redirect_uris;
  if (!Array.isArray(redirectUris)) {
    return void 0;
  }
  const [first] = redirectUris;
  return typeof first === "string" ? first : void 0;
}
var __oauthInternals = {
  openExternal
};

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime-header-utils.js
function materializeHeaders(headers, serverName) {
  if (!headers) {
    return void 0;
  }
  const resolved = {};
  for (const [key, value] of Object.entries(headers)) {
    try {
      resolved[key] = resolveEnvPlaceholders(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to resolve header '${key}' for server '${serverName}': ${message}`, { cause: error });
    }
  }
  return resolved;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime/node-http-fetch.js
import http2 from "node:http";
import https from "node:https";
import { Buffer as Buffer3 } from "node:buffer";
import { Readable } from "node:stream";
var MAX_REDIRECTS = 20;
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
var NULL_BODY_STATUSES = /* @__PURE__ */ new Set([204, 205, 304]);
var nodeHttp1Fetch = async (input, init = {}) => {
  return nodeHttp1FetchWithRedirects(input, init, 0);
};
async function nodeHttp1FetchWithRedirects(input, init, redirectCount) {
  const url2 = input instanceof URL ? input : new URL(input);
  if (url2.protocol !== "http:" && url2.protocol !== "https:") {
    throw new TypeError(`node-http1 fetch only supports http: and https: URLs, got ${url2.protocol}`);
  }
  if (init.signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  const headers = normalizeRequestHeaders(init.headers);
  const body = await materializeRequestBody(init.body);
  if (body !== void 0 && !hasHeader(headers, "content-length") && !hasHeader(headers, "transfer-encoding")) {
    headers["content-length"] = String(Buffer3.byteLength(body));
  }
  return new Promise((resolve, reject) => {
    const client = url2.protocol === "https:" ? https : http2;
    const request = client.request(url2, {
      method: init.method ?? "GET",
      headers
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            responseHeaders.append(key, item);
          }
        } else if (value !== void 0) {
          responseHeaders.set(key, String(value));
        }
      }
      const status = response.statusCode ?? 502;
      const location = responseHeaders.get("location");
      if (REDIRECT_STATUSES.has(status) && location && init.redirect !== "manual") {
        response.resume();
        if (init.redirect === "error") {
          reject(new TypeError(`Redirect encountered for ${url2.href}`));
          return;
        }
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new TypeError(`Too many redirects while fetching ${url2.href}`));
          return;
        }
        let nextUrl;
        try {
          nextUrl = new URL(location, url2);
        } catch (error) {
          reject(error);
          return;
        }
        resolve(nodeHttp1FetchWithRedirects(nextUrl, buildRedirectInit(init, status, url2, nextUrl), redirectCount + 1));
        return;
      }
      if (NULL_BODY_STATUSES.has(status)) {
        response.resume();
      }
      resolve(new Response(NULL_BODY_STATUSES.has(status) ? null : Readable.toWeb(response), {
        status,
        statusText: response.statusMessage,
        headers: responseHeaders
      }));
    });
    const abort = () => {
      request.destroy(new DOMException("The operation was aborted.", "AbortError"));
    };
    init.signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => init.signal?.removeEventListener("abort", abort));
    request.once("error", reject);
    if (body !== void 0) {
      request.write(body);
    }
    request.end();
  });
}
function buildRedirectInit(init, status, currentUrl, nextUrl) {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (currentUrl.origin !== nextUrl.origin) {
    stripCrossOriginRedirectHeaders(headers);
  }
  if ((status === 301 || status === 302 || status === 303) && method !== "GET" && method !== "HEAD") {
    headers.delete("content-length");
    headers.delete("content-type");
    return {
      ...init,
      method: "GET",
      body: null,
      headers
    };
  }
  return {
    ...init,
    headers
  };
}
function stripCrossOriginRedirectHeaders(headers) {
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("proxy-authorization");
}
function normalizeRequestHeaders(headers) {
  const normalized = {};
  if (!headers) {
    return normalized;
  }
  new Headers(headers).forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
}
function hasHeader(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}
async function materializeRequestBody(body) {
  if (body == null) {
    return void 0;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Blob) {
    return Buffer3.from(await body.arrayBuffer());
  }
  if (body instanceof ArrayBuffer) {
    return Buffer3.from(body);
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer3.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError("node-http1 fetch does not support streaming request bodies.");
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime/utils.js
var ENV_PLACEHOLDER_PATTERN = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/;
function resolveCommandArgument(value) {
  if (!value) {
    return value;
  }
  if (!value.includes("$")) {
    return value;
  }
  const needsInterpolation = value.startsWith("$env:") || ENV_PLACEHOLDER_PATTERN.test(value);
  if (!needsInterpolation) {
    return value;
  }
  return resolveEnvPlaceholders(value);
}
function resolveCommandArguments(args) {
  if (!args || args.length === 0) {
    return [];
  }
  return args.map((arg) => resolveCommandArgument(arg));
}
function normalizeTimeout(raw) {
  if (raw == null) {
    return void 0;
  }
  if (!Number.isFinite(raw)) {
    return void 0;
  }
  const coerced = Math.trunc(raw);
  return coerced > 0 ? coerced : void 0;
}
function raceWithTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timeout"));
    }, timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime/transport.js
var STDIO_TRACE_ENABLED2 = process.env.MCPORTER_STDIO_TRACE === "1";
function extractTransportStatusCode(error) {
  if (!error || typeof error !== "object") {
    return void 0;
  }
  const record = error;
  for (const candidate of [record.code, record.status, record.statusCode]) {
    if (typeof candidate === "number") {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number.parseInt(candidate, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return void 0;
}
function isLegacySseTransportMismatch(error) {
  if (error instanceof StreamableHTTPError) {
    return error.code === 404 || error.code === 405;
  }
  const directStatusCode = extractTransportStatusCode(error);
  if (directStatusCode === 404 || directStatusCode === 405) {
    return true;
  }
  const issue = analyzeConnectionError(error);
  return issue.kind === "http" && (issue.statusCode === 404 || issue.statusCode === 405);
}
function attachStdioTraceLogging(_transport, _label) {
}
function removeAuthorizationHeader(headers) {
  if (!headers) {
    return void 0;
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "authorization") {
      delete headers[key];
    }
  }
  return Object.keys(headers).length > 0 ? headers : void 0;
}
function createHttpTransportOptions(definition, oauthSession, shouldEstablishOAuth) {
  const command = definition.command;
  if (command.kind !== "http") {
    throw new Error(`Server '${definition.name}' is not configured for HTTP transport.`);
  }
  const resolvedHeaders = materializeHeaders(command.headers, definition.name);
  const effectiveHeaders = shouldEstablishOAuth ? removeAuthorizationHeader(resolvedHeaders) : resolvedHeaders;
  return {
    requestInit: effectiveHeaders ? { headers: effectiveHeaders } : void 0,
    authProvider: oauthSession?.provider,
    fetch: resolveHttpFetchOverride(definition)
  };
}
function resolveHttpFetchOverride(definition) {
  if (definition.command.kind !== "http") {
    return void 0;
  }
  if (definition.httpFetch === "default") {
    return void 0;
  }
  if (definition.httpFetch === "node-http1") {
    return nodeHttp1Fetch;
  }
  if (definition.command.url.hostname.toLowerCase() === "api.sunsama.com") {
    return nodeHttp1Fetch;
  }
  return void 0;
}
async function closeOAuthSession(oauthSession) {
  await oauthSession?.close().catch(() => {
  });
}
function shouldUseModeForServer(definition, serverFilter) {
  return !serverFilter || serverFilter === definition.name;
}
function wrapRecordTransport(transport, definition, options) {
  if (!options.recordPath || !shouldUseModeForServer(definition, process.env.MCPORTER_RECORD_SERVER)) {
    return transport;
  }
  return new RecordTransport({
    inner: transport,
    recordPath: options.recordPath,
    server: definition.name
  });
}
async function createReplayClientContext(client, definition, replayPath) {
  const transport = new ReplayTransport({
    recordPath: replayPath,
    server: definition.name
  });
  await client.connect(transport);
  return { client, transport, definition, oauthSession: void 0 };
}
function shouldAbortSseFallback(error) {
  if (isPostAuthConnectError(error)) {
    return !isLegacySseTransportMismatch(error);
  }
  return isOAuthFlowError(error) || error instanceof OAuthTimeoutError;
}
function hasAuthorizationHeader(headers) {
  return Boolean(headers && Object.keys(headers).some((key) => key.toLowerCase() === "authorization"));
}
function maybePromoteHttpDefinition(definition, logger, options) {
  if (options.maxOAuthAttempts === 0 || options.disableOAuth === true) {
    return void 0;
  }
  return maybeEnableOAuth(definition, logger);
}
async function connectHttpTransport(client, transport, oauthSession, logger, connectOptions) {
  try {
    return await connectWithAuth(client, transport, oauthSession, logger, connectOptions);
  } catch (error) {
    await closeTransportAndWait(logger, transport).catch(() => {
    });
    throw error;
  }
}
async function applyCachedAuthIfAvailable(definition, logger, allowCachedAuth) {
  if (!allowCachedAuth && definition.auth !== "refreshable_bearer") {
    return definition;
  }
  if (definition.auth === "refreshable_bearer" && definition.command.kind === "stdio" && !definition.refresh?.accessTokenEnv) {
    throw new Error(`Server '${definition.name}' uses refreshable_bearer stdio auth but is missing refresh.accessTokenEnv.`);
  }
  if (definition.command.kind === "http" && hasAuthorizationHeader(definition.command.headers)) {
    return definition;
  }
  try {
    const cached = await readCachedAccessToken(definition, logger);
    if (!cached) {
      if (definition.auth === "refreshable_bearer") {
        throw new Error(`Server '${definition.name}' uses refreshable_bearer auth but has no cached access token.`);
      }
      return definition;
    }
    if (definition.command.kind === "stdio") {
      if (definition.auth !== "refreshable_bearer") {
        return definition;
      }
      const accessTokenEnv = definition.refresh?.accessTokenEnv;
      if (!accessTokenEnv) {
        throw new Error(`Server '${definition.name}' uses refreshable_bearer stdio auth but is missing refresh.accessTokenEnv.`);
      }
      logger.debug?.(`Using cached bearer access token for '${definition.name}' stdio env.`);
      return {
        ...definition,
        env: {
          ...definition.env,
          [accessTokenEnv]: cached
        }
      };
    }
    const existingHeaders = definition.command.headers ?? {};
    if (hasAuthorizationHeader(existingHeaders)) {
      return definition;
    }
    logger.debug?.(`Using cached OAuth access token for '${definition.name}' (non-interactive).`);
    return {
      ...definition,
      command: {
        ...definition.command,
        headers: {
          ...existingHeaders,
          Authorization: `Bearer ${cached}`
        }
      }
    };
  } catch (error) {
    if (definition.auth === "refreshable_bearer") {
      throw error;
    }
    logger.debug?.(`Failed to read cached OAuth token for '${definition.name}': ${error instanceof Error ? error.message : String(error)}`);
    return definition;
  }
}
async function createStdioClientContext(client, definition, logger, options) {
  const resolvedEnvOverrides = definition.env && Object.keys(definition.env).length > 0 ? Object.fromEntries(Object.entries(definition.env).map(([key, raw]) => [key, resolveEnvValue(raw)]).filter(([, value]) => value !== "")) : void 0;
  const mergedEnv = resolvedEnvOverrides && Object.keys(resolvedEnvOverrides).length > 0 ? { ...process.env, ...resolvedEnvOverrides } : { ...process.env };
  const command = resolveCommandArgument(definition.command.command);
  const commandArgs = resolveCommandArguments(definition.command.args);
  const compat = applyChromeDevtoolsCompat(mergedEnv, command, commandArgs);
  if (compat.applied) {
    logger.info(`Injecting chrome-devtools-mcp --autoConnect compatibility patch from ${compat.patchPath}.`);
  }
  const rawTransport = new StdioClientTransport({
    command,
    args: commandArgs,
    cwd: definition.command.cwd,
    env: compat.env
  });
  if (STDIO_TRACE_ENABLED2) {
    attachStdioTraceLogging(rawTransport, definition.name ?? definition.command.command);
  }
  const transport = wrapRecordTransport(rawTransport, definition, options);
  try {
    await client.connect(transport);
  } catch (error) {
    await closeTransportAndWait(logger, transport).catch(() => {
    });
    throw error;
  }
  return { client, transport, definition, oauthSession: void 0 };
}
async function retryHttpTransportWithFallback(client, definition, logger, options) {
  let activeDefinition = definition;
  while (true) {
    const attempt = await attemptHttpClientContext(client, activeDefinition, logger, options);
    if (!attempt.nextDefinition) {
      return attempt.context;
    }
    activeDefinition = attempt.nextDefinition;
    options.onDefinitionPromoted?.(activeDefinition);
  }
}
async function attemptHttpClientContext(client, activeDefinition, logger, options) {
  const command = activeDefinition.command;
  if (command.kind !== "http") {
    throw new Error(`Server '${activeDefinition.name}' is not configured for HTTP transport.`);
  }
  let oauthSession;
  const shouldEstablishOAuth = activeDefinition.auth === "oauth" && options.maxOAuthAttempts !== 0 && options.disableOAuth !== true;
  if (shouldEstablishOAuth) {
    oauthSession = await createOAuthSession(activeDefinition, logger, options.oauthSessionOptions);
  }
  const transportOptions = createHttpTransportOptions(activeDefinition, oauthSession, shouldEstablishOAuth);
  try {
    const context = await connectPrimaryHttpTransport(client, activeDefinition, command, transportOptions, oauthSession, logger, options);
    return { context };
  } catch (primaryError) {
    if (shouldAbortSseFallback(primaryError)) {
      await closeOAuthSession(oauthSession);
      throw primaryError;
    }
    if (isUnauthorizedError(primaryError)) {
      await closeOAuthSession(oauthSession);
      const promoted = maybePromoteHttpDefinition(activeDefinition, logger, options);
      if (promoted) {
        return { nextDefinition: promoted };
      }
      if (activeDefinition.auth) {
        throw primaryError;
      }
      oauthSession = void 0;
    }
    if (primaryError instanceof Error) {
      logger.info(`Falling back to SSE transport for '${activeDefinition.name}': ${primaryError.message}`);
    }
    return {
      context: await connectSseFallbackTransport(client, activeDefinition, command, transportOptions, oauthSession, logger, options)
    };
  }
}
async function connectPrimaryHttpTransport(client, definition, command, transportOptions, oauthSession, logger, options) {
  const createStreamableTransport = () => wrapRecordTransport(new StreamableHTTPClientTransport(command.url, transportOptions), definition, options);
  const transport = await connectHttpTransport(client, createStreamableTransport(), oauthSession, logger, {
    serverName: definition.name,
    serverUrl: command.url,
    maxAttempts: options.maxOAuthAttempts,
    oauthTimeoutMs: options.oauthTimeoutMs,
    recreateTransport: async () => createStreamableTransport()
  });
  return {
    client,
    transport,
    definition,
    oauthSession
  };
}
async function connectSseFallbackTransport(client, definition, command, transportOptions, oauthSession, logger, options) {
  try {
    const transport = await connectHttpTransport(client, wrapRecordTransport(new SSEClientTransport(command.url, transportOptions), definition, options), oauthSession, logger, {
      serverName: definition.name,
      serverUrl: command.url,
      maxAttempts: options.maxOAuthAttempts,
      oauthTimeoutMs: options.oauthTimeoutMs
    });
    return { client, transport, definition, oauthSession };
  } catch (sseError) {
    await closeOAuthSession(oauthSession);
    if (sseError instanceof OAuthTimeoutError) {
      throw sseError;
    }
    if (isUnauthorizedError(sseError)) {
      const promoted = maybePromoteHttpDefinition(definition, logger, options);
      if (promoted) {
        options.onDefinitionPromoted?.(promoted);
        return retryHttpTransportWithFallback(client, promoted, logger, options);
      }
      if (definition.auth) {
        throw sseError;
      }
    }
    throw sseError;
  }
}
async function createClientContext(definition, logger, clientInfo, options = {}) {
  const client = new Client(clientInfo);
  if (options.replayPath && shouldUseModeForServer(definition, process.env.MCPORTER_REPLAY_SERVER)) {
    return createReplayClientContext(client, definition, options.replayPath);
  }
  const activeDefinition = await applyCachedAuthIfAvailable(definition, logger, options.allowCachedAuth);
  return withEnvOverrides(activeDefinition.env, async () => {
    if (activeDefinition.command.kind === "stdio") {
      return createStdioClientContext(client, activeDefinition, logger, options);
    }
    return retryHttpTransportWithFallback(client, activeDefinition, logger, options);
  });
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/tool-filters.js
function validateToolFilters(name, filter) {
  if (filter.allowedTools !== void 0 && filter.blockedTools !== void 0) {
    throw new Error(`Server '${name}' cannot specify both allowedTools and blockedTools.`);
  }
}
function isToolAllowed(toolName, filter) {
  if (!filter) {
    return true;
  }
  if (filter.allowedTools !== void 0) {
    return filter.allowedTools.includes(toolName);
  }
  if (filter.blockedTools !== void 0) {
    return !filter.blockedTools.includes(toolName);
  }
  return true;
}
function filterTools(tools, filter) {
  return tools.filter((tool) => isToolAllowed(tool.name, filter));
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/version.js
import { createRequire } from "node:module";
var MCPORTER_VERSION = (() => {
  try {
    return createRequire(import.meta.url)("../package.json").version;
  } catch {
    return process.env.MCPORTER_VERSION ?? "0.0.0-dev";
  }
})();

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/runtime.js
var PACKAGE_NAME = "mcporter";
var OAUTH_CODE_TIMEOUT_MS = resolveOAuthTimeoutFromEnv();
async function createRuntime(options = {}) {
  const servers = options.servers ?? await loadServerDefinitions({
    configPath: options.configPath,
    rootDir: options.rootDir
  });
  const runtime = new McpRuntime(servers, options);
  return runtime;
}
async function callOnce(params) {
  const runtime = await createRuntime({ configPath: params.configPath });
  try {
    return await runtime.callTool(params.server, params.toolName, {
      args: params.args,
      disableOAuth: params.disableOAuth
    });
  } finally {
    await runtime.close(params.server);
  }
}
var McpRuntime = class {
  definitions;
  clients = /* @__PURE__ */ new Map();
  activeClientKeys = /* @__PURE__ */ new Map();
  contextCacheKeys = /* @__PURE__ */ new WeakMap();
  contextCachePromises = /* @__PURE__ */ new WeakMap();
  connectionSetupTails = /* @__PURE__ */ new Map();
  serverGenerations = /* @__PURE__ */ new Map();
  retirementPromises = /* @__PURE__ */ new Map();
  logger;
  clientInfo;
  oauthTimeoutMs;
  recordPath;
  replayPath;
  constructor(servers, options = {}) {
    for (const server of servers) {
      validateToolFilters(server.name, server);
    }
    this.definitions = new Map(servers.map((entry) => [entry.name, entry]));
    this.logger = options.logger ?? createConsoleLogger();
    this.clientInfo = options.clientInfo ?? {
      name: PACKAGE_NAME,
      version: MCPORTER_VERSION
    };
    this.oauthTimeoutMs = options.oauthTimeoutMs;
    const recordSession = process.env.MCPORTER_RECORD;
    const replaySession = process.env.MCPORTER_REPLAY;
    if (recordSession && replaySession) {
      this.logger.warn("Both MCPORTER_RECORD and MCPORTER_REPLAY are set; recording mode wins.");
    }
    this.recordPath = recordSession ? resolveRecordingPath(recordSession) : void 0;
    this.replayPath = !recordSession && replaySession ? resolveRecordingPath(replaySession) : void 0;
  }
  // listServers returns configured names sorted alphabetically for stable CLI output.
  listServers() {
    return [...this.definitions.keys()].toSorted((a, b) => a.localeCompare(b));
  }
  // getDefinitions exposes raw server metadata to consumers such as the CLI.
  getDefinitions() {
    return [...this.definitions.values()];
  }
  // getDefinition throws when the caller requests an unknown server name.
  getDefinition(server) {
    const definition = this.definitions.get(server);
    if (!definition) {
      throw new Error(`Unknown MCP server '${server}'.`);
    }
    return definition;
  }
  registerDefinition(definition, options = {}) {
    validateToolFilters(definition.name, definition);
    if (!options.overwrite && this.definitions.has(definition.name)) {
      throw new Error(`MCP server '${definition.name}' already exists.`);
    }
    this.bumpServerGeneration(definition.name);
    this.definitions.set(definition.name, definition);
    this.retireCachedEntriesForServer(definition.name);
  }
  async getInstructions(server) {
    const active = this.activeClientForServer(server);
    const fallbackEntries = active ? [] : this.cachedEntriesForServer(server);
    const cached = active ?? (fallbackEntries.length === 1 ? fallbackEntries[0] : void 0);
    if (!cached) {
      return void 0;
    }
    try {
      const context = await cached.promise;
      const instructions = typeof context.client.getInstructions === "function" ? context.client.getInstructions() : void 0;
      if (typeof instructions !== "string") {
        return void 0;
      }
      const trimmed = instructions.trim();
      return trimmed.length > 0 ? trimmed : void 0;
    } catch {
      return void 0;
    }
  }
  // listTools queries tool metadata and optionally includes schemas when requested.
  async listTools(server, options = {}) {
    const autoAuthorize = options.autoAuthorize !== false;
    const disableOAuth = this.effectiveDisableOAuthForOperation(server, options.disableOAuth);
    const allowCachedAuth = this.effectiveAllowCachedAuthForOperation(server, options.allowCachedAuth, disableOAuth, true);
    const useLegacyNoAuthorize = !autoAuthorize && disableOAuth !== true;
    const context = await this.connect(server, {
      maxOAuthAttempts: useLegacyNoAuthorize ? 0 : void 0,
      skipCache: useLegacyNoAuthorize,
      allowCachedAuth,
      oauthSessionOptions: options.oauthSessionOptions,
      disableOAuth
    });
    let closeError;
    const tools = [];
    try {
      let cursor;
      do {
        const response = await context.client.listTools(cursor ? { cursor } : void 0);
        tools.push(...(response.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description ?? void 0,
          inputSchema: options.includeSchema ? tool.inputSchema : void 0,
          outputSchema: options.includeSchema ? tool.outputSchema : void 0
        })));
        cursor = response.nextCursor ?? void 0;
      } while (cursor);
    } catch (error) {
      await this.resetConnectionOnError(server, error, context);
      throw error;
    } finally {
      if (useLegacyNoAuthorize) {
        try {
          await this.closeContext(context);
        } catch (error) {
          closeError = error;
        }
      }
    }
    if (closeError !== void 0) {
      throw closeError;
    }
    return filterTools(tools, this.definitions.get(server.trim()));
  }
  // callTool executes a tool using the args provided by the caller.
  async callTool(server, toolName, options = {}) {
    const definition = this.definitions.get(server.trim());
    if (definition && !isToolAllowed(toolName, definition)) {
      throw new Error(`Tool '${toolName}' is not accessible on server '${definition.name}' (blocked by configuration).`);
    }
    let context;
    try {
      const disableOAuth = this.effectiveDisableOAuthForOperation(server, options.disableOAuth);
      context = await this.connect(server, {
        allowCachedAuth: this.effectiveAllowCachedAuthForOperation(server, void 0, disableOAuth, true),
        disableOAuth
      });
      const { client } = context;
      const params = {
        name: toolName,
        arguments: options.args ?? {}
      };
      const timeoutMs = normalizeTimeout(options.timeoutMs);
      const resultPromise = client.callTool(params, void 0, {
        timeout: timeoutMs,
        // Long runs (e.g., GPT-5 Pro) emit progress/logging; allow that to refresh the timer.
        resetTimeoutOnProgress: true,
        maxTotalTimeout: timeoutMs
      });
      if (!timeoutMs) {
        return await resultPromise;
      }
      return await raceWithTimeout(resultPromise, timeoutMs);
    } catch (error) {
      await this.resetConnectionOnError(server, error, context);
      throw error;
    }
  }
  // listResources delegates to the MCP resources/list method with passthrough params.
  async listResources(server, options = {}) {
    const { allowCachedAuth, disableOAuth, oauthSessionOptions, ...params } = options;
    let context;
    try {
      const effectiveDisableOAuth = this.effectiveDisableOAuthForOperation(server, disableOAuth);
      context = await this.connect(server, {
        allowCachedAuth: this.effectiveAllowCachedAuthForOperation(server, allowCachedAuth, effectiveDisableOAuth, void 0),
        oauthSessionOptions,
        disableOAuth: effectiveDisableOAuth
      });
      const { client } = context;
      return await client.listResources(params);
    } catch (error) {
      await this.resetConnectionOnError(server, error, context);
      throw error;
    }
  }
  async readResource(server, uri, options = {}) {
    let context;
    try {
      const effectiveDisableOAuth = this.effectiveDisableOAuthForOperation(server, options.disableOAuth);
      context = await this.connect(server, {
        allowCachedAuth: this.effectiveAllowCachedAuthForOperation(server, options.allowCachedAuth, effectiveDisableOAuth, void 0),
        oauthSessionOptions: options.oauthSessionOptions,
        disableOAuth: effectiveDisableOAuth
      });
      const { client } = context;
      return await client.readResource({ uri });
    } catch (error) {
      await this.resetConnectionOnError(server, error, context);
      throw error;
    }
  }
  effectiveDisableOAuthForOperation(server, requested) {
    if (requested !== void 0) {
      return requested;
    }
    const cached = this.cachedEntriesForServer(server);
    const active = this.activeClientForServer(server);
    if (active) {
      return active.disableOAuth;
    }
    if (cached.length === 0) {
      return void 0;
    }
    const [first] = cached;
    return cached.every((entry) => entry.disableOAuth === first?.disableOAuth) ? first?.disableOAuth : void 0;
  }
  effectiveAllowCachedAuthForOperation(server, requested, disableOAuth, defaultValue) {
    if (requested !== void 0) {
      return requested;
    }
    if (disableOAuth !== true) {
      return defaultValue;
    }
    const active = this.activeClientForServer(server);
    if (active?.disableOAuth === true) {
      return active.allowCachedAuth;
    }
    const cached = this.cachedEntriesForServer(server).filter((entry) => entry.disableOAuth);
    return cached.length === 1 ? cached[0]?.allowCachedAuth : defaultValue;
  }
  cachedEntriesForServer(server) {
    const normalized = server.trim();
    return [...this.clients.values()].filter((entry) => entry.server === normalized);
  }
  retireCachedEntriesForServer(server) {
    const normalized = server.trim();
    const retired = [];
    for (const [key, cached] of this.clients.entries()) {
      if (cached.server === normalized) {
        this.clients.delete(key);
        retired.push(cached);
      }
    }
    this.activeClientKeys.delete(normalized);
    if (retired.length > 0) {
      const retirement = this.trackRetirement(normalized, this.closeCachedEntries(retired));
      void retirement.catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to close retired '${normalized}' connection: ${detail}`);
      });
    }
  }
  activeClientForServer(server) {
    const normalized = server.trim();
    const activeKey = this.activeClientKeys.get(normalized);
    if (!activeKey) {
      return void 0;
    }
    const active = this.clients.get(activeKey);
    return active?.server === normalized ? active : void 0;
  }
  serverGeneration(server) {
    return this.serverGenerations.get(server.trim()) ?? 0;
  }
  bumpServerGeneration(server) {
    const normalized = server.trim();
    this.serverGenerations.set(normalized, this.serverGeneration(normalized) + 1);
  }
  bumpAllServerGenerations() {
    const servers = /* @__PURE__ */ new Set([
      ...this.definitions.keys(),
      ...[...this.clients.values()].map((entry) => entry.server),
      ...this.connectionSetupTails.keys()
    ]);
    for (const server of servers) {
      this.bumpServerGeneration(server);
    }
  }
  // connect lazily instantiates a client context per server and memoizes it.
  async connect(server, options = {}) {
    const normalized = server.trim();
    let definition = this.definitions.get(normalized);
    if (!definition) {
      throw new Error(`Unknown MCP server '${normalized}'.`);
    }
    const generation = this.serverGeneration(normalized);
    const disableOAuth = options.disableOAuth === true;
    const effectiveAllowCachedAuth = options.allowCachedAuth ?? (disableOAuth ? true : void 0);
    const useCache = options.skipCache !== true && options.maxOAuthAttempts === void 0;
    let ignoresAuthCachePolicy = this.ignoresAuthCachePolicy(definition);
    let cacheAllowCachedAuth = ignoresAuthCachePolicy ? void 0 : effectiveAllowCachedAuth;
    let cacheDisableOAuth = ignoresAuthCachePolicy ? false : disableOAuth;
    let cacheKey = this.cacheKey(normalized, cacheAllowCachedAuth, cacheDisableOAuth);
    if (useCache) {
      const existing = this.findCachedEntryForRequest(normalized, definition, ignoresAuthCachePolicy ? void 0 : options.allowCachedAuth, cacheAllowCachedAuth, cacheDisableOAuth);
      if (existing) {
        const [existingKey, cached] = existing;
        const activeEntry = ignoresAuthCachePolicy ? {
          ...cached,
          allowCachedAuth: effectiveAllowCachedAuth,
          disableOAuth
        } : cached;
        if (activeEntry !== cached) {
          this.clients.set(existingKey, activeEntry);
        }
        this.activeClientKeys.set(normalized, existingKey);
        return activeEntry.promise;
      }
    }
    let releaseConnectionSetup;
    if (useCache && this.shouldSerializeConnectionSetup(definition, disableOAuth)) {
      releaseConnectionSetup = await this.enterConnectionSetup(normalized);
      try {
        if (this.serverGeneration(normalized) !== generation) {
          throw new Error(`Connection setup for MCP server '${normalized}' was superseded.`);
        }
        const refreshedDefinition = this.definitions.get(normalized);
        if (!refreshedDefinition) {
          throw new Error(`Unknown MCP server '${normalized}'.`);
        }
        definition = refreshedDefinition;
        ignoresAuthCachePolicy = this.ignoresAuthCachePolicy(definition);
        cacheAllowCachedAuth = ignoresAuthCachePolicy ? void 0 : effectiveAllowCachedAuth;
        cacheDisableOAuth = ignoresAuthCachePolicy ? false : disableOAuth;
        cacheKey = this.cacheKey(normalized, cacheAllowCachedAuth, cacheDisableOAuth);
        const existing = this.findCachedEntryForRequest(normalized, definition, ignoresAuthCachePolicy ? void 0 : options.allowCachedAuth, cacheAllowCachedAuth, cacheDisableOAuth);
        if (existing) {
          releaseConnectionSetup();
          releaseConnectionSetup = void 0;
          const [existingKey, cached] = existing;
          this.activeClientKeys.set(normalized, existingKey);
          return cached.promise;
        }
        await this.retireConflictingOAuthEntries(normalized, cacheKey);
        if (this.serverGeneration(normalized) !== generation) {
          throw new Error(`Connection setup for MCP server '${normalized}' was superseded.`);
        }
        const latestDefinition = this.definitions.get(normalized);
        if (!latestDefinition) {
          throw new Error(`Unknown MCP server '${normalized}'.`);
        }
        definition = latestDefinition;
      } catch (error) {
        releaseConnectionSetup?.();
        releaseConnectionSetup = void 0;
        throw error;
      }
    }
    let connectionDefinition = definition;
    let contextPromise = createClientContext(definition, this.logger, this.clientInfo, {
      maxOAuthAttempts: options.maxOAuthAttempts,
      oauthTimeoutMs: this.oauthTimeoutMs ?? OAUTH_CODE_TIMEOUT_MS,
      onDefinitionPromoted: (promoted) => {
        if (this.serverGeneration(normalized) === generation && this.definitions.get(normalized) === connectionDefinition) {
          this.definitions.set(promoted.name, promoted);
          connectionDefinition = promoted;
        }
      },
      allowCachedAuth: effectiveAllowCachedAuth,
      oauthSessionOptions: options.oauthSessionOptions,
      disableOAuth,
      recordPath: this.recordPath,
      replayPath: this.replayPath
    });
    if (useCache) {
      const previousActiveKey = this.activeClientKeys.get(normalized);
      contextPromise = contextPromise.then((context) => {
        this.contextCacheKeys.set(context, cacheKey);
        this.contextCachePromises.set(context, contextPromise);
        return context;
      });
      let connection;
      connection = contextPromise.then((context) => {
        const stillCached = this.clients.get(cacheKey)?.promise === connection;
        if (this.serverGeneration(normalized) !== generation || !stillCached) {
          this.contextCacheKeys.delete(context);
          this.contextCachePromises.delete(context);
          throw new Error(`Connection setup for MCP server '${normalized}' was superseded.`);
        }
        return context;
      });
      this.activeClientKeys.set(normalized, cacheKey);
      this.clients.set(cacheKey, {
        server: normalized,
        promise: connection,
        contextPromise,
        allowCachedAuth: ignoresAuthCachePolicy ? effectiveAllowCachedAuth : cacheAllowCachedAuth,
        disableOAuth: ignoresAuthCachePolicy ? disableOAuth : cacheDisableOAuth
      });
      try {
        return await connection;
      } catch (error) {
        const ownsCacheEntry = this.clients.get(cacheKey)?.promise === connection;
        if (ownsCacheEntry) {
          this.clients.delete(cacheKey);
          if (this.activeClientKeys.get(normalized) === cacheKey && previousActiveKey && this.clients.has(previousActiveKey)) {
            this.activeClientKeys.set(normalized, previousActiveKey);
          } else if (this.activeClientKeys.get(normalized) === cacheKey || this.cachedEntriesForServer(normalized).length === 0) {
            this.activeClientKeys.delete(normalized);
          }
        }
        throw error;
      } finally {
        releaseConnectionSetup?.();
      }
    }
    releaseConnectionSetup?.();
    return contextPromise;
  }
  // close tears down transports (and OAuth sessions) for a single server or all servers.
  async close(server) {
    if (server) {
      const normalized = server.trim();
      this.bumpServerGeneration(normalized);
      const entries2 = [...this.clients.entries()].filter(([, cached]) => cached.server === normalized);
      if (entries2.length === 0) {
        this.activeClientKeys.delete(normalized);
      }
      for (const [key] of entries2) {
        this.clients.delete(key);
      }
      this.activeClientKeys.delete(normalized);
      if (entries2.length > 0) {
        void this.trackRetirement(normalized, this.closeCachedEntries(entries2.map(([, cached]) => cached)));
      }
      await this.awaitRetirements(normalized);
      return;
    }
    this.bumpAllServerGenerations();
    const entries = [...this.clients.entries()];
    this.clients.clear();
    this.activeClientKeys.clear();
    const byServer = /* @__PURE__ */ new Map();
    for (const [, cached] of entries) {
      const serverEntries = byServer.get(cached.server) ?? [];
      serverEntries.push(cached);
      byServer.set(cached.server, serverEntries);
    }
    for (const [serverName, serverEntries] of byServer) {
      void this.trackRetirement(serverName, this.closeCachedEntries(serverEntries));
    }
    await this.awaitRetirements();
  }
  contextPromiseFor(cached) {
    return cached.contextPromise ?? cached.promise;
  }
  async closeCachedEntries(entries) {
    const results = await Promise.allSettled(entries.map(async (cached) => {
      const context = await this.contextPromiseFor(cached);
      try {
        await this.closeContext(context);
      } finally {
        this.contextCacheKeys.delete(context);
        this.contextCachePromises.delete(context);
      }
    }));
    const firstFailure = results.find((result) => result.status === "rejected");
    if (firstFailure) {
      throw firstFailure.reason;
    }
  }
  async closeContext(context) {
    const propagateReplayCloseErrors = context.transport instanceof ReplayTransport;
    let closeError;
    try {
      await context.client.close();
    } catch (error) {
      if (propagateReplayCloseErrors) {
        closeError ??= error;
      }
    }
    try {
      await closeTransportAndWait(this.logger, context.transport, {
        throwOnCloseError: propagateReplayCloseErrors
      });
    } catch (error) {
      if (propagateReplayCloseErrors) {
        closeError ??= error;
      }
    }
    await context.oauthSession?.close().catch(() => {
    });
    if (closeError) {
      throw closeError;
    }
  }
  async resetConnectionOnError(server, error, failedContext) {
    if (!shouldResetConnection(error)) {
      return;
    }
    const normalized = server.trim();
    if (!failedContext) {
      return;
    }
    try {
      const failedKey = this.contextCacheKeys.get(failedContext);
      const failedEntry = failedKey ? this.clients.get(failedKey) : void 0;
      const failedContextPromise = this.contextCachePromises.get(failedContext);
      if (!failedKey || failedEntry?.server !== normalized || !failedContextPromise || this.contextPromiseFor(failedEntry) !== failedContextPromise) {
        return;
      }
      if (this.clients.get(failedKey)?.promise !== failedEntry.promise) {
        return;
      }
      this.clients.delete(failedKey);
      if (this.activeClientKeys.get(normalized) === failedKey || this.cachedEntriesForServer(normalized).length === 0) {
        this.activeClientKeys.delete(normalized);
      }
      try {
        await this.closeContext(failedContext);
      } finally {
        this.contextCacheKeys.delete(failedContext);
        this.contextCachePromises.delete(failedContext);
      }
    } catch (closeError) {
      const detail = closeError instanceof Error ? closeError.message : String(closeError);
      this.logger.warn(`Failed to reset '${normalized}' after error: ${detail}`);
    }
  }
  findCachedEntryForRequest(server, definition, requestedAllowCachedAuth, effectiveAllowCachedAuth, disableOAuth) {
    const exactKey = this.cacheKey(server, effectiveAllowCachedAuth, disableOAuth);
    if (this.ignoresAuthCachePolicy(definition)) {
      const exact2 = this.clients.get(exactKey);
      return exact2 ? [exactKey, exact2] : void 0;
    }
    if (requestedAllowCachedAuth !== void 0) {
      const exact2 = this.clients.get(exactKey);
      return exact2 ? [exactKey, exact2] : void 0;
    }
    const activeKey = this.activeClientKeys.get(server);
    const active = activeKey ? this.clients.get(activeKey) : void 0;
    const policyMatches = (cached) => effectiveAllowCachedAuth === void 0 || cached.allowCachedAuth === effectiveAllowCachedAuth;
    if (activeKey && active?.server === server && active.disableOAuth === disableOAuth && policyMatches(active)) {
      return [activeKey, active];
    }
    const matches = [...this.clients.entries()].filter(([, cached]) => cached.server === server && cached.disableOAuth === disableOAuth && policyMatches(cached));
    if (matches.length === 1) {
      return matches[0];
    }
    const exact = this.clients.get(exactKey);
    return exact ? [exactKey, exact] : void 0;
  }
  async retireConflictingOAuthEntries(server, keepKey) {
    const conflicting = [...this.clients.entries()].filter(([key, cached]) => key !== keepKey && cached.server === server && !cached.disableOAuth);
    if (conflicting.length === 0) {
      return;
    }
    for (const [key] of conflicting) {
      this.clients.delete(key);
      if (this.activeClientKeys.get(server) === key) {
        this.activeClientKeys.delete(server);
      }
    }
    await this.trackRetirement(server, this.closeCachedEntries(conflicting.map(([, cached]) => cached)));
  }
  shouldSerializeConnectionSetup(definition, disableOAuth) {
    return definition.command.kind === "http" && !disableOAuth && !this.ignoresAuthCachePolicy(definition);
  }
  ignoresAuthCachePolicy(definition) {
    const replayServer = process.env.MCPORTER_REPLAY_SERVER;
    const replaysDefinition = Boolean(this.replayPath) && (!replayServer || replayServer === definition.name);
    return definition.command.kind === "stdio" || replaysDefinition;
  }
  trackRetirement(server, retirement) {
    const pending = this.retirementPromises.get(server) ?? /* @__PURE__ */ new Set();
    pending.add(retirement);
    this.retirementPromises.set(server, pending);
    const cleanup = () => {
      pending.delete(retirement);
      if (pending.size === 0) {
        this.retirementPromises.delete(server);
      }
    };
    retirement.then(cleanup, cleanup);
    return retirement;
  }
  async awaitRetirements(server) {
    const pending = server ? [...this.retirementPromises.get(server) ?? []] : [];
    if (!server) {
      for (const retirements of this.retirementPromises.values()) {
        pending.push(...retirements);
      }
    }
    const results = await Promise.allSettled(pending);
    const firstFailure = results.find((result) => result.status === "rejected");
    if (firstFailure) {
      throw firstFailure.reason;
    }
  }
  async enterConnectionSetup(server) {
    const previous = this.connectionSetupTails.get(server) ?? Promise.resolve();
    let releaseCurrent;
    const current = new Promise((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => {
    }).then(() => current);
    this.connectionSetupTails.set(server, tail);
    await previous.catch(() => {
    });
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      releaseCurrent();
      void tail.finally(() => {
        if (this.connectionSetupTails.get(server) === tail) {
          this.connectionSetupTails.delete(server);
        }
      });
    };
  }
  cacheKey(server, allowCachedAuth, disableOAuth) {
    const cachedAuthKey = allowCachedAuth === true ? "cached-auth-on" : allowCachedAuth === false ? "cached-auth-off" : "cached-auth-unset";
    return `${server}\0oauth-disabled:${disableOAuth ? "1" : "0"}\0${cachedAuthKey}`;
  }
};
function createConsoleLogger(level = resolveLogLevelFromEnv()) {
  return createPrefixedConsoleLogger("mcporter", level);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/generated-daemon-runtime.js
import crypto5 from "node:crypto";
import fs12 from "node:fs/promises";
import path17 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/client.js
import crypto4, { randomUUID as randomUUID2 } from "node:crypto";
import fs11 from "node:fs/promises";
import net from "node:net";
import path16 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/paths.js
import path15 from "node:path";
function resolveBaseDir() {
  const override = process.env.MCPORTER_DAEMON_DIR;
  if (override && override.trim().length > 0) {
    return path15.resolve(expandHome(override.trim()));
  }
  return mcporterDir("state");
}
function ensureRunDir() {
  return path15.join(resolveBaseDir(), "daemon");
}
function getDaemonMetadataPath(configKey) {
  return path15.join(ensureRunDir(), `daemon-${configKey}.json`);
}
function getDaemonSocketPath(configKey) {
  const runDir = ensureRunDir();
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mcporter-daemon-${configKey}`;
  }
  return path15.join(runDir, `daemon-${configKey}.sock`);
}
function getDaemonLogPath(configKey) {
  return path15.join(ensureRunDir(), `daemon-${configKey}.log`);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/client.js
var DEFAULT_DAEMON_TIMEOUT_MS = 3e4;
var MIN_DAEMON_STATUS_TIMEOUT_MS = 1e3;
function resolveDaemonPaths(configPath) {
  const key = deriveConfigKey(configPath);
  return {
    key,
    socketPath: getDaemonSocketPath(key),
    metadataPath: getDaemonMetadataPath(key)
  };
}
var DaemonClient = class {
  options;
  socketPath;
  metadataPath;
  startingPromise = null;
  constructor(options) {
    this.options = options;
    const paths = resolveDaemonPaths(options.configPath);
    this.socketPath = paths.socketPath;
    this.metadataPath = paths.metadataPath;
  }
  async callTool(params) {
    return this.invoke("callTool", params, params.timeoutMs);
  }
  async listTools(params) {
    return this.invoke("listTools", params);
  }
  async listResources(params) {
    return this.invoke("listResources", params);
  }
  async readResource(params) {
    return this.invoke("readResource", params);
  }
  async closeServer(params) {
    await this.invoke("closeServer", params);
  }
  async status() {
    return await this.readVerifiedStatus();
  }
  async stop() {
    try {
      await this.sendRequest("stop", {});
    } catch (error) {
      if (isTransportError(error)) {
        return;
      }
      throw error;
    }
  }
  async invoke(method, params, timeoutMs) {
    await this.ensureDaemon(timeoutMs);
    try {
      return await this.sendRequest(method, params, timeoutMs);
    } catch (error) {
      if (isTransportError(error)) {
        await this.restartDaemon();
        return await this.sendRequest(method, params, timeoutMs);
      }
      throw error;
    }
  }
  async ensureDaemon(timeoutMs) {
    const statusTimeoutMs = resolveDaemonStatusTimeout(timeoutMs);
    const metadata = await readDaemonMetadata(this.metadataPath);
    const configState = await this.checkConfigState(metadata);
    if (configState === "stale") {
      await this.restartDaemon({ reason: "stale-config", expectedPid: metadata?.pid });
      return;
    }
    if (configState === "fresh") {
      if (await this.isResponsive(statusTimeoutMs)) {
        return;
      }
    }
    await this.startDaemon({ preflightTimeoutMs: statusTimeoutMs });
  }
  async restartDaemon(options = {}) {
    await this.startingWithLock(async () => {
      const currentStatus = await this.readVerifiedStatus();
      if (currentStatus && options.expectedPid !== void 0 && currentStatus.pid !== options.expectedPid && await this.checkConfigState() === "fresh") {
        return;
      }
      if (options.reason === "stale-config" && currentStatus && await this.checkConfigState() === "fresh") {
        return;
      }
      await this.stop().catch(() => {
      });
      await this.waitForStopped();
      await this.launchDaemonAndWait();
    });
  }
  async startDaemon(options = {}) {
    await this.startingWithLock(async () => {
      if (await this.isResponsive(options.preflightTimeoutMs)) {
        return;
      }
      await this.launchDaemonAndWait();
    });
  }
  async startingWithLock(task) {
    if (this.startingPromise) {
      await this.startingPromise;
      return;
    }
    this.startingPromise = withFileLock(this.metadataPath, async () => {
      await task();
    }).finally(() => {
      this.startingPromise = null;
    });
    await this.startingPromise;
  }
  async launchDaemonAndWait() {
    const { launchDaemonDetached: launchDaemonDetached2 } = await import("./launch-EDFGGXR3.js");
    launchDaemonDetached2({
      configPath: this.options.configPath,
      configExplicit: this.options.configExplicit,
      rootDir: this.options.rootDir,
      metadataPath: this.metadataPath,
      socketPath: this.socketPath
    });
    await this.waitForReady();
  }
  async waitForStopped() {
    const deadline = Date.now() + 5e3;
    while (Date.now() < deadline) {
      if (!await this.isResponsive()) {
        return;
      }
      await delay2(100);
    }
    throw new Error("Daemon did not stop before restart could begin.");
  }
  async waitForReady() {
    const deadline = Date.now() + 1e4;
    while (Date.now() < deadline) {
      if (await this.isResponsive()) {
        return;
      }
      await delay2(100);
    }
    throw new Error("Timeout while waiting for MCPorter daemon to start.");
  }
  async isResponsive(timeoutMs) {
    return await this.readVerifiedStatus(timeoutMs) !== null;
  }
  async readVerifiedStatus(timeoutMs) {
    const metadata = await readDaemonMetadata(this.metadataPath);
    if (!metadata || metadata.socketPath !== this.socketPath || !isProcessRunning2(metadata.pid)) {
      return null;
    }
    try {
      const status = await this.sendRequest("status", {}, timeoutMs);
      if (status.pid !== metadata.pid || status.socketPath !== metadata.socketPath) {
        return null;
      }
      return status;
    } catch (error) {
      if (isTransportError(error)) {
        return null;
      }
      throw error;
    }
  }
  async checkConfigState(metadata) {
    metadata ??= await readDaemonMetadata(this.metadataPath);
    if (!metadata) {
      return "missing";
    }
    const currentLayers = normalizeLayers(await collectConfigLayers(this.options));
    const metadataLayers = normalizeLayers(metadata.configLayers ?? [{ path: metadata.configPath, mtimeMs: metadata.configMtimeMs ?? null }]);
    if (currentLayers.length !== metadataLayers.length) {
      return "stale";
    }
    for (let i = 0; i < currentLayers.length; i += 1) {
      const current = currentLayers[i];
      const previous = metadataLayers[i];
      if (!current || !previous || current.path !== previous.path || current.mtimeMs !== previous.mtimeMs) {
        return "stale";
      }
    }
    return "fresh";
  }
  async sendRequest(method, params, timeoutOverrideMs) {
    const request = {
      id: randomUUID2(),
      method,
      params
    };
    const payload = JSON.stringify(request);
    const timeoutMs = resolveDaemonTimeout(timeoutOverrideMs);
    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      let settled = false;
      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };
      const finishResolve = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      socket.setTimeout(timeoutMs, () => {
        socket.destroy(Object.assign(new Error("Daemon request timed out."), {
          code: "ETIMEDOUT"
        }));
      });
      let buffer = "";
      socket.on("connect", () => {
        socket.write(payload, (error) => {
          if (error) {
            finishReject(error);
          }
        });
      });
      socket.on("data", (chunk) => {
        buffer += chunk.toString();
      });
      socket.on("end", () => finishResolve(buffer));
      socket.on("error", (error) => {
        finishReject(error);
      });
    });
    const trimmed = response.trim();
    if (!trimmed) {
      const error = new Error("Empty daemon response.");
      error.code = "ECONNRESET";
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const parseError = new Error("Failed to parse daemon response.");
      parseError.code = "ECONNRESET";
      throw parseError;
    }
    if (!parsed.ok) {
      const error = new Error(parsed.error?.message ?? "Daemon error");
      error.code = parsed.error?.code;
      throw error;
    }
    return parsed.result;
  }
};
function deriveConfigKey(configPath) {
  const absolute = path16.resolve(configPath);
  return crypto4.createHash("sha1").update(absolute).digest("hex").slice(0, 12);
}
function isTransportError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = error.code;
  return code === "ECONNREFUSED" || code === "ENOENT" || code === "ETIMEDOUT" || code === "ECONNRESET";
}
function isProcessRunning2(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function resolveDaemonTimeout(override) {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  const raw = process.env.MCPORTER_DAEMON_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_DAEMON_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DAEMON_TIMEOUT_MS;
  }
  return parsed;
}
function resolveDaemonStatusTimeout(override) {
  if (typeof override !== "number" || !Number.isFinite(override) || override <= 0) {
    return void 0;
  }
  return Math.max(override, MIN_DAEMON_STATUS_TIMEOUT_MS);
}
async function statConfigMtime(configPath) {
  try {
    const stats = await fs11.stat(configPath);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}
async function collectConfigLayers(options) {
  const layerPaths = await listConfigLayerPaths(options.configExplicit ? { configPath: options.configPath } : {}, options.rootDir ?? process.cwd());
  const layers = [];
  for (const layerPath of layerPaths) {
    layers.push({ path: layerPath, mtimeMs: await statConfigMtime(layerPath) });
  }
  if (layers.length === 0) {
    layers.push({ path: path16.resolve(options.configPath), mtimeMs: await statConfigMtime(options.configPath) });
  }
  return layers;
}
async function readDaemonMetadata(metadataPath) {
  try {
    const raw = await fs11.readFile(metadataPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function delay2(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function normalizeLayers(layers) {
  const normalized = layers.map((entry) => ({
    path: path16.isAbsolute(entry.path) ? entry.path : path16.resolve(entry.path),
    mtimeMs: entry.mtimeMs ?? null
  }));
  if (normalized.length < 2) {
    return normalized;
  }
  return normalized.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/runtime-wrapper.js
function createKeepAliveRuntime(base, options) {
  if (!options.daemonClient || options.keepAliveServers.size === 0) {
    return base;
  }
  return new KeepAliveRuntime(base, options.daemonClient, options.keepAliveServers);
}
var KeepAliveRuntime = class {
  base;
  daemon;
  keepAliveServers;
  restartPromises = /* @__PURE__ */ new Map();
  constructor(base, daemon, keepAliveServers) {
    this.base = base;
    this.daemon = daemon;
    this.keepAliveServers = keepAliveServers;
  }
  listServers() {
    return this.base.listServers();
  }
  getDefinitions() {
    return this.base.getDefinitions();
  }
  getDefinition(server) {
    return this.base.getDefinition(server);
  }
  registerDefinition(definition, options) {
    this.base.registerDefinition(definition, options);
    if (isKeepAliveServer(definition)) {
      this.keepAliveServers.add(definition.name);
    } else {
      this.keepAliveServers.delete(definition.name);
    }
  }
  async getInstructions(server) {
    return this.base.getInstructions?.(server);
  }
  async listTools(server, options) {
    if (options?.oauthSessionOptions) {
      return this.base.listTools(server, options);
    }
    if (this.shouldUseDaemon(server)) {
      return await this.invokeWithRestart(server, "listTools", () => this.daemon.listTools({
        server,
        includeSchema: options?.includeSchema,
        autoAuthorize: options?.autoAuthorize,
        allowCachedAuth: options?.allowCachedAuth ?? true,
        disableOAuth: options?.disableOAuth
      }));
    }
    return this.base.listTools(server, options);
  }
  async callTool(server, toolName, options) {
    if (this.shouldUseDaemon(server)) {
      return this.invokeWithRestart(server, "callTool", () => this.daemon.callTool({
        server,
        tool: toolName,
        args: options?.args,
        timeoutMs: options?.timeoutMs,
        disableOAuth: options?.disableOAuth
      }));
    }
    return this.base.callTool(server, toolName, options);
  }
  async listResources(server, options) {
    if (options?.oauthSessionOptions) {
      return this.base.listResources(server, options);
    }
    const { allowCachedAuth, disableOAuth, ...params } = options ?? {};
    if (this.shouldUseDaemon(server)) {
      return this.invokeWithRestart(server, "listResources", () => this.daemon.listResources({ server, params, allowCachedAuth, disableOAuth }));
    }
    return this.base.listResources(server, options);
  }
  async readResource(server, uri, options) {
    if (options?.oauthSessionOptions) {
      return this.base.readResource(server, uri, options);
    }
    if (this.shouldUseDaemon(server)) {
      return this.invokeWithRestart(server, "readResource", () => this.daemon.readResource({
        server,
        uri,
        allowCachedAuth: options?.allowCachedAuth,
        disableOAuth: options?.disableOAuth
      }));
    }
    return this.base.readResource(server, uri, options);
  }
  async connect(server, options) {
    return this.base.connect(server, options);
  }
  async close(server) {
    if (!server) {
      await this.base.close();
      return;
    }
    if (this.shouldUseDaemon(server)) {
      await this.daemon.closeServer({ server }).catch(() => {
      });
      return;
    }
    await this.base.close(server);
  }
  shouldUseDaemon(server) {
    return this.keepAliveServers.has(server);
  }
  async invokeWithRestart(server, operation, action) {
    try {
      return await action();
    } catch (error) {
      if (!shouldRestartDaemonServer(error)) {
        throw error;
      }
      logDaemonRetry(server, operation, error);
      await this.restartServer(server);
      return action();
    }
  }
  async restartServer(server) {
    const existing = this.restartPromises.get(server);
    if (existing) {
      await existing;
      return;
    }
    const restart = this.daemon.closeServer({ server }).catch(() => {
    });
    this.restartPromises.set(server, restart);
    try {
      await restart;
    } finally {
      this.restartPromises.delete(server);
    }
  }
};
var NON_FATAL_CODES = /* @__PURE__ */ new Set([ErrorCode.InvalidRequest, ErrorCode.MethodNotFound, ErrorCode.InvalidParams]);
function shouldRestartDaemonServer(error) {
  if (!error) {
    return false;
  }
  if (error instanceof McpError) {
    return !NON_FATAL_CODES.has(error.code);
  }
  return true;
}
function logDaemonRetry(server, operation, error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[mcporter] Restarting '${server}' before retrying ${operation}: ${reason}`);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/generated-daemon-runtime.js
async function createGeneratedKeepAliveRuntime(base, server) {
  if (!isKeepAliveServer(server)) {
    return {
      runtime: base,
      close: async (target) => {
        await base.close(target);
      }
    };
  }
  const configPath = await ensureGeneratedDaemonConfig(server);
  const runtime = createKeepAliveRuntime(base, {
    daemonClient: new DaemonClient({ configPath, configExplicit: true }),
    keepAliveServers: /* @__PURE__ */ new Set([server.name])
  });
  return {
    runtime,
    close: async () => {
      await base.close();
    }
  };
}
async function ensureGeneratedDaemonConfig(server) {
  const rawConfig = {
    imports: [],
    mcpServers: {
      [server.name]: serializeRawEntry(server)
    }
  };
  const payload = `${JSON.stringify(rawConfig, null, 2)}
`;
  const key = crypto5.createHash("sha1").update(payload).digest("hex").slice(0, 12);
  const dir = process.env.MCPORTER_GENERATED_CONFIG_DIR ? path17.resolve(process.env.MCPORTER_GENERATED_CONFIG_DIR) : path17.join(mcporterDir("state"), "generated");
  const configPath = path17.join(dir, `generated-${key}.json`);
  await fs12.mkdir(dir, { recursive: true });
  try {
    const existing = await fs12.readFile(configPath, "utf8");
    if (existing === payload) {
      return configPath;
    }
  } catch {
  }
  await writeRawConfig(configPath, rawConfig);
  return configPath;
}
function serializeRawEntry(server) {
  const common = {
    ...server.description ? { description: server.description } : {},
    ...server.env ? { env: server.env } : {},
    ...server.auth ? { auth: server.auth } : {},
    ...server.tokenCacheDir ? { tokenCacheDir: server.tokenCacheDir } : {},
    ...server.clientName ? { clientName: server.clientName } : {},
    ...server.oauthClientId ? { oauthClientId: server.oauthClientId } : {},
    ...server.oauthClientSecretEnv ? { oauthClientSecretEnv: server.oauthClientSecretEnv } : {},
    ...server.oauthTokenEndpointAuthMethod ? { oauthTokenEndpointAuthMethod: server.oauthTokenEndpointAuthMethod } : {},
    ...server.oauthRedirectUrl ? { oauthRedirectUrl: server.oauthRedirectUrl } : {},
    ...server.oauthScope ? { oauthScope: server.oauthScope } : {},
    ...server.oauthCommand ? { oauthCommand: server.oauthCommand } : {},
    ...server.refresh ? { refresh: server.refresh } : {},
    ...server.httpFetch ? { httpFetch: server.httpFetch } : {},
    ...server.lifecycle ? { lifecycle: serializeLifecycle(server.lifecycle) } : {},
    ...server.logging ? { logging: server.logging } : {},
    ...server.allowedTools ? { allowedTools: [...server.allowedTools] } : {},
    ...server.blockedTools ? { blockedTools: [...server.blockedTools] } : {}
  };
  if (server.command.kind === "http") {
    return {
      ...common,
      url: server.command.url.toString(),
      ...server.command.headers ? { headers: server.command.headers } : {}
    };
  }
  return {
    ...common,
    command: server.command.command,
    args: [...server.command.args],
    cwd: server.command.cwd
  };
}
function serializeLifecycle(lifecycle) {
  if (!lifecycle) {
    return void 0;
  }
  if (lifecycle.mode === "keep-alive" && lifecycle.idleTimeoutMs === void 0) {
    return "keep-alive";
  }
  if (lifecycle.mode === "ephemeral") {
    return "ephemeral";
  }
  return lifecycle;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/cli/daemon-command.js
import fsPromises from "node:fs/promises";
import path21 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/host.js
import { randomUUID as randomUUID3 } from "node:crypto";
import fs14 from "node:fs/promises";
import net2 from "node:net";
import path20 from "node:path";

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/config-layers.js
import fs13 from "node:fs/promises";
import path18 from "node:path";
async function statConfigMtime2(configPath) {
  try {
    const stats = await fs13.stat(configPath);
    return stats.mtimeMs;
  } catch {
    return null;
  }
}
async function collectConfigLayers2(options) {
  const layerPaths = await listConfigLayerPaths2(options, options.rootDir ?? process.cwd());
  const entries = [];
  for (const layerPath of layerPaths) {
    entries.push({ path: layerPath, mtimeMs: await statConfigMtime2(layerPath) });
  }
  if (entries.length === 0 && options.configPath) {
    entries.push({ path: path18.resolve(options.configPath), mtimeMs: await statConfigMtime2(options.configPath) });
  }
  return entries;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/definition-hash.js
import { createHash } from "node:crypto";
function hashDaemonDefinitions(definitions) {
  const sorted = definitions.toSorted((a, b) => a.name.localeCompare(b.name));
  return createHash("sha256").update(stableJsonStringify(sorted)).digest("hex").slice(0, 16);
}
function stableJsonStringify(value) {
  const json = JSON.stringify(sortJsonValue(value));
  if (json === void 0) {
    throw new TypeError("Cannot serialize unsupported JSON root value.");
  }
  return json;
}
function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const result = {};
  for (const key of Object.keys(value).toSorted()) {
    const entry = value[key];
    if (entry !== void 0) {
      result[key] = sortJsonValue(entry);
    }
  }
  return result;
}
function isPlainObject(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/log-context.js
import fsSync2 from "node:fs";
import path19 from "node:path";
function createLogContext(options) {
  const derivedEnabled = options.enabled || options.logAllServers || options.servers.size > 0;
  const context = {
    enabled: derivedEnabled,
    logAllServers: options.logAllServers,
    servers: options.servers
  };
  if (derivedEnabled && options.logPath) {
    try {
      fsSync2.mkdirSync(path19.dirname(options.logPath), { recursive: true });
      context.writer = fsSync2.createWriteStream(options.logPath, {
        flags: "a"
      });
    } catch (error) {
      console.warn(`[daemon] Failed to open log file ${options.logPath}: ${error.message}`);
    }
  }
  return context;
}
function logEvent(context, message) {
  if (!context.enabled) {
    return;
  }
  const line = `[daemon] ${(/* @__PURE__ */ new Date()).toISOString()} ${message}`;
  console.log(line);
  try {
    context.writer?.write(`${line}
`);
  } catch {
  }
}
async function disposeLogContext(context) {
  const writer = context.writer;
  if (!writer) {
    return;
  }
  await new Promise((resolve) => {
    writer.end(() => resolve());
    writer.on("error", () => resolve());
  });
}
function shouldLogServer(context, server) {
  if (!context.enabled) {
    return false;
  }
  if (context.logAllServers) {
    return true;
  }
  return context.servers.has(server);
}
function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "unknown";
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/request-utils.js
function ensureManaged(server, managedServers) {
  if (!managedServers.has(server)) {
    throw new Error(`Server '${server}' is not managed by the daemon.`);
  }
}
function markActivity(server, activity) {
  const entry = activity.get(server);
  if (entry) {
    entry.connected = true;
    entry.lastUsedAt = Date.now();
  } else {
    activity.set(server, { connected: true, lastUsedAt: Date.now() });
  }
}
async function evictIdleServers(runtime, managedServers, activity) {
  const now = Date.now();
  await Promise.all(Array.from(managedServers.entries()).map(async ([name, definition]) => {
    const timeout = keepAliveIdleTimeout(definition);
    if (!timeout) {
      return;
    }
    const entry = activity.get(name);
    if (!entry?.lastUsedAt) {
      return;
    }
    if (now - entry.lastUsedAt < timeout) {
      return;
    }
    await runtime.close(name).catch(() => {
    });
    activity.set(name, { connected: false });
  }));
}
function shouldShutdownDaemonForIdle(lastActivityAt, now, idleTimeoutMs, activeRequests = 0) {
  return activeRequests <= 0 && typeof idleTimeoutMs === "number" && idleTimeoutMs > 0 && now - lastActivityAt >= idleTimeoutMs;
}
function daemonIdleWatcherInterval(idleTimeoutMs) {
  if (!idleTimeoutMs) {
    return 3e4;
  }
  return Math.min(3e4, Math.max(100, Math.floor(idleTimeoutMs / 2)));
}
function buildErrorResponse(id, code, error) {
  let message = code;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }
  return {
    id,
    ok: false,
    error: {
      code,
      message
    }
  };
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/daemon/host.js
async function runDaemonHost(options) {
  const configLayers = await collectConfigLayers2({
    configPath: options.configExplicit ? options.configPath : void 0,
    rootDir: options.rootDir
  });
  const daemonConfig = await loadDaemonConfig({
    configPath: options.configExplicit ? options.configPath : void 0,
    rootDir: options.rootDir
  });
  const runtime = await createRuntime({
    configPath: options.configExplicit ? options.configPath : void 0,
    rootDir: options.rootDir
  });
  const keepAliveDefinitions = runtime.getDefinitions().filter(isKeepAliveServer);
  const definitionHash = hashDaemonDefinitions(keepAliveDefinitions);
  if (keepAliveDefinitions.length === 0) {
    throw new Error("No MCP servers require keep-alive; daemon will not start.");
  }
  const managedServers = /* @__PURE__ */ new Map();
  for (const definition of keepAliveDefinitions) {
    managedServers.set(definition.name, definition);
  }
  const serverLoggingOverrides = /* @__PURE__ */ new Set();
  for (const definition of keepAliveDefinitions) {
    if (definition.logging?.daemon?.enabled) {
      serverLoggingOverrides.add(definition.name);
    }
  }
  const combinedServerLogs = /* @__PURE__ */ new Set([
    ...serverLoggingOverrides,
    ...options.logServers ? Array.from(options.logServers) : []
  ]);
  const logContext = createLogContext({
    enabled: Boolean(options.logPath),
    logAllServers: options.logAllServers ?? false,
    servers: combinedServerLogs,
    logPath: options.logPath
  });
  await fs14.mkdir(path20.dirname(options.metadataPath), { recursive: true });
  const configMtimeMs = await statConfigMtime2(options.configPath);
  const activity = /* @__PURE__ */ new Map();
  for (const definition of keepAliveDefinitions) {
    activity.set(definition.name, { connected: false });
  }
  let shuttingDown = false;
  let idleWatcher;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logEvent(logContext, "Shutting down daemon host.");
    if (idleWatcher) {
      clearInterval(idleWatcher);
    }
    server.close();
    await runtime.close().catch(() => {
    });
    await disposeLogContext(logContext).catch(() => {
    });
    await cleanupArtifacts(options);
    process.exit(0);
  };
  let lastDaemonActivityAt = Date.now();
  let activeDaemonRequests = 0;
  idleWatcher = setInterval(() => {
    void (async () => {
      await evictIdleServers(runtime, managedServers, activity);
      if (shouldShutdownDaemonForIdle(lastDaemonActivityAt, Date.now(), daemonConfig.idleTimeoutMs, activeDaemonRequests)) {
        logEvent(logContext, "Daemon idle timeout reached.");
        await shutdown();
      }
    })();
  }, daemonIdleWatcherInterval(daemonConfig.idleTimeoutMs));
  idleWatcher.unref();
  logEvent(logContext, "Daemon host started.");
  const startedAt = Date.now();
  const server = net2.createServer({ allowHalfOpen: true }, (socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    const tryHandle = () => {
      if (handled) {
        return;
      }
      const trimmed = buffer.trim();
      if (trimmed.length === 0) {
        return;
      }
      let parsedRequest;
      try {
        parsedRequest = JSON.parse(trimmed);
      } catch {
        return;
      }
      handled = true;
      lastDaemonActivityAt = Date.now();
      activeDaemonRequests += 1;
      void handleSocketRequest(trimmed, socket, runtime, managedServers, activity, {
        configPath: options.configPath,
        configLayers,
        socketPath: options.socketPath,
        startedAt,
        logPath: options.logPath ?? null,
        configMtimeMs,
        definitionHash
      }, logContext, shutdown, parsedRequest).finally(() => {
        activeDaemonRequests -= 1;
        lastDaemonActivityAt = Date.now();
      });
    };
    socket.on("data", (chunk) => {
      buffer += chunk;
      tryHandle();
    });
    socket.on("end", () => {
      if (!handled) {
        tryHandle();
      }
    });
    socket.on("error", () => {
      socket.destroy();
    });
  });
  let claimed = false;
  await withFileLock(`${options.metadataPath}.bind`, async () => {
    const live = await probeLiveDaemon(options.socketPath);
    if (live) {
      if (daemonConfigMatches(live, configLayers, options.configPath, configMtimeMs, definitionHash)) {
        if (!await metadataMatches(options.metadataPath, live)) {
          await writeJsonFile(options.metadataPath, metadataFromStatus(live, configLayers));
        }
        return;
      }
      await stopLiveDaemon(options.socketPath, live.pid);
    }
    await prepareSocket(options.socketPath);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    await writeJsonFile(options.metadataPath, {
      pid: process.pid,
      socketPath: options.socketPath,
      configPath: options.configPath,
      configLayers,
      startedAt: Date.now(),
      logPath: options.logPath ?? null,
      configMtimeMs,
      definitionHash
    });
    claimed = true;
  });
  if (!claimed) {
    logEvent(logContext, "Daemon already running for this config; exiting without rebinding.");
    server.close();
    await runtime.close().catch(() => {
    });
    await disposeLogContext(logContext).catch(() => {
    });
    process.exit(0);
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGQUIT", shutdown);
}
var DAEMON_PROBE_TIMEOUT_MS = 2e3;
async function probeLiveDaemon(socketPath) {
  const status = await probeDaemonStatus(socketPath);
  if (!status || status.socketPath !== socketPath || !isProcessAlive2(status.pid)) {
    return null;
  }
  return status;
}
async function metadataMatches(metadataPath, live) {
  try {
    const existing = await readJsonFile(metadataPath);
    return existing?.pid === live.pid && existing?.socketPath === live.socketPath;
  } catch {
    return false;
  }
}
function metadataFromStatus(status, fallbackConfigLayers) {
  return {
    pid: status.pid,
    socketPath: status.socketPath,
    configPath: status.configPath,
    configLayers: status.configLayers && status.configLayers.length > 0 ? status.configLayers : fallbackConfigLayers,
    startedAt: status.startedAt,
    logPath: status.logPath ?? null,
    configMtimeMs: status.configMtimeMs ?? null,
    definitionHash: status.definitionHash
  };
}
function daemonConfigMatches(live, currentLayers, currentConfigPath, currentConfigMtimeMs, currentDefinitionHash) {
  if (live.definitionHash !== currentDefinitionHash) {
    return false;
  }
  const liveLayers = normalizeLayers2(live.configLayers && live.configLayers.length > 0 ? live.configLayers : [{ path: live.configPath, mtimeMs: live.configMtimeMs ?? null }]);
  const expectedLayers = normalizeLayers2(currentLayers.length > 0 ? currentLayers : [{ path: currentConfigPath, mtimeMs: currentConfigMtimeMs }]);
  if (liveLayers.length !== expectedLayers.length) {
    return false;
  }
  return liveLayers.every((entry, index) => {
    const expected = expectedLayers[index];
    return Boolean(expected && entry.path === expected.path && entry.mtimeMs === expected.mtimeMs);
  });
}
function normalizeLayers2(layers) {
  const normalized = layers.map((entry) => ({
    path: path20.isAbsolute(entry.path) ? entry.path : path20.resolve(entry.path),
    mtimeMs: entry.mtimeMs ?? null
  }));
  if (normalized.length < 2) {
    return normalized;
  }
  return normalized.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
async function stopLiveDaemon(socketPath, livePid) {
  const stopped = await sendDaemonStop(socketPath);
  if (!stopped) {
    throw new Error("Live daemon did not accept stop before rebinding.");
  }
  const deadline = Date.now() + 5e3;
  while (Date.now() < deadline) {
    if (!isProcessAlive2(livePid)) {
      return;
    }
    await delay3(100);
  }
  throw new Error("Live daemon did not stop before rebinding.");
}
async function sendDaemonStop(socketPath) {
  return await new Promise((resolve) => {
    const request = {
      id: randomUUID3(),
      method: "stop",
      params: {}
    };
    const socket = net2.createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(DAEMON_PROBE_TIMEOUT_MS, () => finish(false));
    socket.once("connect", () => {
      socket.write(JSON.stringify(request));
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
    });
    socket.once("end", () => {
      try {
        const response = JSON.parse(buffer.trim());
        finish(response.ok);
      } catch {
        finish(false);
      }
    });
    socket.once("error", () => finish(false));
  });
}
function delay3(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function isProcessAlive2(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
async function probeDaemonStatus(socketPath) {
  return await new Promise((resolve) => {
    const probe = net2.createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const finish = (status) => {
      if (settled) {
        return;
      }
      settled = true;
      probe.removeAllListeners();
      probe.destroy();
      resolve(status);
    };
    const parse = () => {
      try {
        const response = JSON.parse(buffer.trim());
        return response.ok && response.result ? response.result : null;
      } catch {
        return null;
      }
    };
    probe.setTimeout(DAEMON_PROBE_TIMEOUT_MS, () => finish(null));
    probe.once("connect", () => {
      probe.write(JSON.stringify({ id: randomUUID3(), method: "status", params: {} }));
    });
    probe.on("data", (chunk) => {
      buffer += chunk.toString();
      const status = parse();
      if (status) {
        finish(status);
      }
    });
    probe.once("end", () => finish(parse()));
    probe.once("error", () => finish(null));
  });
}
async function prepareSocket(socketPath) {
  if (process.platform === "win32") {
    return;
  }
  try {
    await fs14.unlink(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await fs14.mkdir(path20.dirname(socketPath), { recursive: true });
}
async function cleanupArtifacts(options) {
  await cleanupDaemonArtifactsIfOwned(options, process.pid);
}
async function cleanupDaemonArtifactsIfOwned(paths, ownerPid) {
  const metadata = await readJsonFile(paths.metadataPath).catch(() => void 0);
  if (metadata?.pid !== ownerPid || metadata.socketPath !== paths.socketPath) {
    return;
  }
  if (process.platform !== "win32") {
    await fs14.unlink(paths.socketPath).catch(() => {
    });
  }
  await fs14.unlink(paths.metadataPath).catch(() => {
  });
}
async function handleSocketRequest(rawPayload, socket, runtime, managedServers, activity, metadata, logContext, shutdown, preParsedRequest) {
  const { response, shouldShutdown } = await processRequest(rawPayload, runtime, managedServers, activity, metadata, logContext, preParsedRequest);
  socket.write(JSON.stringify(response), () => {
    socket.end(() => {
      if (shouldShutdown) {
        void shutdown();
      }
    });
  });
}
function normalizeDaemonDisableOAuth(value) {
  return value === true;
}
async function processRequest(rawPayload, runtime, managedServers, activity, metadata, logContext, preParsedRequest) {
  const trimmed = rawPayload.trim();
  if (!trimmed && !preParsedRequest) {
    return {
      response: buildErrorResponse("unknown", "empty_request"),
      shouldShutdown: false
    };
  }
  let request;
  if (preParsedRequest) {
    request = preParsedRequest;
  } else {
    try {
      request = JSON.parse(trimmed);
    } catch (error) {
      return {
        response: buildErrorResponse("unknown", "invalid_json", error),
        shouldShutdown: false
      };
    }
  }
  const id = request.id ?? "unknown";
  try {
    switch (request.method) {
      case "callTool": {
        const params = request.params;
        ensureManaged(params.server, managedServers);
        const loggable = shouldLogServer(logContext, params.server);
        if (loggable) {
          logEvent(logContext, `callTool start server=${params.server} tool=${params.tool}`);
        }
        try {
          const result = await runtime.callTool(params.server, params.tool, {
            args: params.args ?? {},
            timeoutMs: params.timeoutMs,
            disableOAuth: normalizeDaemonDisableOAuth(params.disableOAuth)
          });
          markActivity(params.server, activity);
          if (loggable) {
            logEvent(logContext, `callTool success server=${params.server} tool=${params.tool}`);
          }
          return { response: { id, ok: true, result }, shouldShutdown: false };
        } catch (error) {
          if (loggable) {
            const detail = formatError(error);
            logEvent(logContext, `callTool error server=${params.server} tool=${params.tool} err=${detail}`);
          }
          throw error;
        }
      }
      case "listTools": {
        const params = request.params;
        ensureManaged(params.server, managedServers);
        const definition = managedServers.get(params.server);
        const loggable = shouldLogServer(logContext, params.server);
        if (loggable) {
          logEvent(logContext, `listTools start server=${params.server}`);
        }
        try {
          const result = await runtime.listTools(params.server, {
            includeSchema: params.includeSchema,
            autoAuthorize: resolveDaemonListToolsAutoAuthorize(params, definition),
            allowCachedAuth: params.allowCachedAuth ?? true,
            disableOAuth: normalizeDaemonDisableOAuth(params.disableOAuth)
          });
          markActivity(params.server, activity);
          if (loggable) {
            logEvent(logContext, `listTools success server=${params.server}`);
          }
          return { response: { id, ok: true, result }, shouldShutdown: false };
        } catch (error) {
          if (loggable) {
            const detail = formatError(error);
            logEvent(logContext, `listTools error server=${params.server} err=${detail}`);
          }
          throw error;
        }
      }
      case "listResources": {
        const params = request.params;
        ensureManaged(params.server, managedServers);
        const loggable = shouldLogServer(logContext, params.server);
        if (loggable) {
          logEvent(logContext, `listResources start server=${params.server}`);
        }
        try {
          const result = await runtime.listResources(params.server, {
            ...params.params,
            allowCachedAuth: params.allowCachedAuth,
            disableOAuth: normalizeDaemonDisableOAuth(params.disableOAuth)
          });
          markActivity(params.server, activity);
          if (loggable) {
            logEvent(logContext, `listResources success server=${params.server}`);
          }
          return { response: { id, ok: true, result }, shouldShutdown: false };
        } catch (error) {
          if (loggable) {
            const detail = formatError(error);
            logEvent(logContext, `listResources error server=${params.server} err=${detail}`);
          }
          throw error;
        }
      }
      case "readResource": {
        const params = request.params;
        ensureManaged(params.server, managedServers);
        const loggable = shouldLogServer(logContext, params.server);
        if (loggable) {
          logEvent(logContext, `readResource start server=${params.server} uri=${params.uri}`);
        }
        try {
          const result = await runtime.readResource(params.server, params.uri, {
            allowCachedAuth: params.allowCachedAuth,
            disableOAuth: normalizeDaemonDisableOAuth(params.disableOAuth)
          });
          markActivity(params.server, activity);
          if (loggable) {
            logEvent(logContext, `readResource success server=${params.server}`);
          }
          return { response: { id, ok: true, result }, shouldShutdown: false };
        } catch (error) {
          if (loggable) {
            const detail = formatError(error);
            logEvent(logContext, `readResource error server=${params.server} err=${detail}`);
          }
          throw error;
        }
      }
      case "closeServer": {
        const params = request.params;
        ensureManaged(params.server, managedServers);
        const loggable = shouldLogServer(logContext, params.server);
        if (loggable) {
          logEvent(logContext, `closeServer start server=${params.server}`);
        }
        try {
          await runtime.close(params.server);
          activity.set(params.server, { connected: false });
          if (loggable) {
            logEvent(logContext, `closeServer success server=${params.server}`);
          }
          return {
            response: { id, ok: true, result: true },
            shouldShutdown: false
          };
        } catch (error) {
          if (loggable) {
            const detail = formatError(error);
            logEvent(logContext, `closeServer error server=${params.server} err=${detail}`);
          }
          throw error;
        }
      }
      case "status": {
        const result = {
          pid: process.pid,
          startedAt: metadata.startedAt,
          configPath: metadata.configPath,
          configLayers: metadata.configLayers,
          configMtimeMs: metadata.configMtimeMs,
          definitionHash: metadata.definitionHash,
          socketPath: metadata.socketPath,
          logPath: metadata.logPath ?? void 0,
          servers: Array.from(managedServers.values()).map((def) => {
            const entry = activity.get(def.name);
            return {
              name: def.name,
              connected: Boolean(entry?.connected),
              lastUsedAt: entry?.lastUsedAt
            };
          })
        };
        return { response: { id, ok: true, result }, shouldShutdown: false };
      }
      case "stop": {
        logEvent(logContext, "Received stop request.");
        return {
          response: { id, ok: true, result: true },
          shouldShutdown: true
        };
      }
      default:
        return {
          response: buildErrorResponse(id, "unknown_method"),
          shouldShutdown: false
        };
    }
  } catch (error) {
    return {
      response: buildErrorResponse(id, "runtime_error", error),
      shouldShutdown: false
    };
  }
}
function resolveDaemonListToolsAutoAuthorize(params, definition) {
  if (params.autoAuthorize === false && definition.command.kind === "stdio") {
    return void 0;
  }
  return params.autoAuthorize;
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/cli/daemon-command.js
async function handleDaemonCli(args, options) {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printDaemonHelp();
    return;
  }
  const client = new DaemonClient({
    configPath: options.configPath,
    configExplicit: options.configExplicit,
    rootDir: options.rootDir
  });
  if (subcommand === "start") {
    await handleDaemonStart(args, options, client);
    return;
  }
  if (subcommand === "status") {
    await handleDaemonStatus(client);
    return;
  }
  if (subcommand === "stop") {
    await client.stop();
    console.log("Daemon stopped (if it was running).");
    return;
  }
  if (subcommand === "restart") {
    await handleDaemonRestart(args, options, client);
    return;
  }
  throw new Error(`Unknown daemon subcommand '${subcommand}'.`);
}
function printDaemonHelp() {
  console.log(`Usage: mcporter daemon <start|status|stop|restart>

Commands:
  start    Start the keep-alive daemon (auto-detects keep-alive servers).
  status   Show whether the daemon is running and which servers are active.
  stop     Shut down the daemon and all managed servers.
  restart  Stop the daemon (if running) and start a fresh instance.

Flags:
  --foreground        Run the daemon in the current process (debug only).
  --log               Enable daemon logging (defaults to ~/.mcporter/daemon/daemon-<hash>.log,
                      or $XDG_STATE_HOME/mcporter/daemon/... when set).
  --log-file <path>   Write daemon stdout/stderr to a specific log file.
  --log-servers <csv> Only log call activity for the listed servers (implies --log).`);
}
async function handleDaemonStart(args, options, client) {
  const foregroundFlag = consumeFlag(args, "--foreground");
  const isChildLaunch = process.env.MCPORTER_DAEMON_CHILD === "1";
  const foreground = foregroundFlag || isChildLaunch;
  const paths = resolveDaemonPaths(options.configPath);
  const socketPath = process.env.MCPORTER_DAEMON_SOCKET ?? paths.socketPath;
  const metadataPath = process.env.MCPORTER_DAEMON_METADATA ?? paths.metadataPath;
  const logging = await resolveDaemonLoggingOptions(args, paths.key);
  const runtime = await createRuntime({
    configPath: options.configExplicit ? options.configPath : void 0,
    rootDir: options.rootDir
  });
  const keepAlive = runtime.getDefinitions().filter(isKeepAliveServer);
  await runtime.close().catch(() => {
  });
  if (keepAlive.length === 0) {
    console.log("No MCP servers are configured for keep-alive; daemon not started.");
    return;
  }
  if (foreground) {
    await runDaemonHost({
      socketPath,
      metadataPath,
      configPath: options.configPath,
      configExplicit: options.configExplicit,
      rootDir: options.rootDir,
      logPath: logging.enabled ? logging.logPath : void 0,
      logServers: logging.serverFilter,
      logAllServers: logging.logAllServers
    });
    return;
  }
  const existing = await client.status();
  if (existing) {
    console.log(`Daemon already running (pid ${existing.pid}).`);
    return;
  }
  const forwardedArgs = [];
  if (logging.enabled && logging.logPath) {
    forwardedArgs.push("--log-file", logging.logPath);
  }
  if (logging.serverFilter.size > 0) {
    forwardedArgs.push("--log-servers", Array.from(logging.serverFilter).join(","));
  }
  launchDaemonDetached({
    configPath: options.configPath,
    configExplicit: options.configExplicit,
    rootDir: options.rootDir,
    metadataPath,
    socketPath,
    extraArgs: forwardedArgs
  });
  const ready = await waitFor(() => client.status(), 1e4, 100);
  if (!ready) {
    throw new Error("Failed to start daemon before timeout expired.");
  }
  console.log(`Daemon started for ${keepAlive.length} server(s).`);
}
async function handleDaemonRestart(args, options, client) {
  await client.stop();
  console.log("Daemon stopped (if it was running).");
  const stopped = await waitFor(async () => {
    const status = await client.status();
    return status ? null : true;
  }, 5e3, 100);
  if (!stopped) {
    throw new Error("Daemon did not stop before restart could begin.");
  }
  await handleDaemonStart(args, options, client);
}
async function handleDaemonStatus(client) {
  const status = await client.status();
  if (!status) {
    console.log("Daemon is not running.");
    return;
  }
  console.log(`Daemon pid ${status.pid} \u2014 socket: ${status.socketPath}`);
  if (status.logPath) {
    console.log(`Log file: ${status.logPath}`);
  }
  if (status.servers.length === 0) {
    console.log("No keep-alive servers registered.");
    return;
  }
  status.servers.forEach((server) => {
    const state = server.connected ? "connected" : "idle";
    const lastUsed = server.lastUsedAt ? ` (last used ${new Date(server.lastUsedAt).toISOString()})` : "";
    console.log(`- ${server.name}: ${state}${lastUsed}`);
  });
}
function consumeFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}
function consumeValueFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return void 0;
  }
  if (index + 1 >= args.length) {
    throw new Error(`Flag '${flag}' requires a value.`);
  }
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}
async function waitFor(probe, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) {
      return result;
    }
    await delay4(intervalMs);
  }
  return null;
}
function delay4(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
async function resolveDaemonLoggingOptions(args, configKey) {
  const logFlag = consumeFlag(args, "--log");
  const logFileValue = consumeValueFlag(args, "--log-file");
  const logServersValue = consumeValueFlag(args, "--log-servers");
  const envLogEnabled = process.env.MCPORTER_DAEMON_LOG === "1";
  const envLogPath = process.env.MCPORTER_DAEMON_LOG_PATH;
  const envLogServers = process.env.MCPORTER_DAEMON_LOG_SERVERS;
  const serverFilter = parseServerList(logServersValue ?? envLogServers);
  const explicitServerLogging = serverFilter.size > 0;
  const resolvedFileFlag = logFileValue ? path21.resolve(expandHome(logFileValue)) : void 0;
  const resolvedEnvFile = envLogPath ? path21.resolve(expandHome(envLogPath)) : void 0;
  const enabled = logFlag || Boolean(resolvedFileFlag) || envLogEnabled || Boolean(resolvedEnvFile) || explicitServerLogging;
  if (!enabled) {
    return {
      enabled: false,
      logPath: void 0,
      logAllServers: false,
      serverFilter
    };
  }
  const logPath = resolvedFileFlag ?? resolvedEnvFile ?? getDaemonLogPath(configKey);
  await fsPromises.mkdir(path21.dirname(logPath), { recursive: true });
  return {
    enabled: true,
    logPath,
    logAllServers: serverFilter.size === 0,
    serverFilter
  };
}
function parseServerList(value) {
  if (!value) {
    return /* @__PURE__ */ new Set();
  }
  const entries = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return new Set(entries);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/schema-cache.js
import path22 from "node:path";
var SCHEMA_FILENAME = "schema.json";
function resolveSchemaCacheDir(definition) {
  return definition.tokenCacheDir ?? path22.join(mcporterDir("cache"), definition.name);
}
function resolveSchemaCachePath(definition) {
  return path22.join(resolveSchemaCacheDir(definition), SCHEMA_FILENAME);
}
async function readSchemaCache(definition) {
  const filePath = resolveSchemaCachePath(definition);
  try {
    const parsed = await readJsonFile(filePath);
    if (!parsed || typeof parsed !== "object") {
      return void 0;
    }
    if (!parsed.tools || typeof parsed.tools !== "object") {
      return void 0;
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return void 0;
    }
    throw error;
  }
}
async function writeSchemaCache(definition, snapshot) {
  await writeJsonFile(resolveSchemaCachePath(definition), snapshot);
}

// node_modules/.pnpm/mcporter@0.12.3/node_modules/mcporter/dist/server-proxy.js
var KNOWN_OPTION_KEYS = /* @__PURE__ */ new Set([
  "disableOAuth",
  "tailLog",
  "timeout",
  "stream",
  "streamLog",
  "mimeType",
  "metadata",
  "log"
]);
function defaultToolNameMapper(propertyKey) {
  if (typeof propertyKey !== "string") {
    throw new TypeError("Tool name must be a string when using server proxy.");
  }
  return propertyKey.replace(/([a-z\d])([A-Z])/g, "$1-$2").toLowerCase();
}
function canonicalizeToolName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isProxyOptionKey(key) {
  return key === "args" || KNOWN_OPTION_KEYS.has(key);
}
function inferMetadataOptions(callArgs) {
  const options = {};
  const optionObjects = /* @__PURE__ */ new Set();
  for (const [index, arg] of callArgs.entries()) {
    if (!isPlainObject2(arg) || arg.disableOAuth !== true) {
      continue;
    }
    const keys = Object.keys(arg);
    const isOptionsOnlyObject = keys.length > 0 && keys.every(isProxyOptionKey);
    const hasClearlySeparateToolArgs = callArgs.some((other, otherIndex) => {
      if (otherIndex === index) {
        return false;
      }
      if (!isPlainObject2(other)) {
        return false;
      }
      return Object.hasOwn(other, "args") || Object.keys(other).some((key) => !isProxyOptionKey(key));
    });
    const hasExplicitArgsEnvelope = Object.hasOwn(arg, "args");
    const isUnambiguousOptionsObject = isOptionsOnlyObject && (hasClearlySeparateToolArgs || hasExplicitArgsEnvelope);
    if (isUnambiguousOptionsObject) {
      options.disableOAuth = true;
    } else if (isOptionsOnlyObject && callArgs.length > 1 && options.disableOAuth !== true) {
      options.autoAuthorize = false;
    }
    if (isUnambiguousOptionsObject) {
      optionObjects.add(arg);
    }
  }
  return { options, optionObjects };
}
function createToolSchemaInfo(schemaRaw) {
  if (!schemaRaw || typeof schemaRaw !== "object") {
    return void 0;
  }
  const schema = schemaRaw;
  const propertiesRaw = schema.properties;
  const propertyKeys = propertiesRaw && typeof propertiesRaw === "object" ? Object.keys(propertiesRaw) : [];
  const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
  const orderedKeys = [];
  const seen = /* @__PURE__ */ new Set();
  for (const key of requiredKeys) {
    if (typeof key === "string" && !seen.has(key)) {
      orderedKeys.push(key);
      seen.add(key);
    }
  }
  for (const key of propertyKeys) {
    if (!seen.has(key)) {
      orderedKeys.push(key);
      seen.add(key);
    }
  }
  return {
    schema,
    orderedKeys,
    requiredKeys,
    propertySet: /* @__PURE__ */ new Set([...propertyKeys, ...requiredKeys])
  };
}
function applyDefaults(meta, args) {
  const propertiesRaw = meta.schema.properties;
  if (!propertiesRaw || typeof propertiesRaw !== "object") {
    return args;
  }
  const result = isPlainObject2(args) ? { ...args } : {};
  for (const [key, value] of Object.entries(propertiesRaw)) {
    if (value && typeof value === "object" && "default" in value && result[key] === void 0) {
      result[key] = value.default;
    }
  }
  if (Object.keys(result).length === 0 && !isPlainObject2(args)) {
    return args;
  }
  return result;
}
function validateRequired(meta, args) {
  if (meta.requiredKeys.length === 0) {
    return;
  }
  if (!isPlainObject2(args)) {
    throw new Error(`Missing required arguments: ${meta.requiredKeys.join(", ")}`);
  }
  const missing = meta.requiredKeys.filter((key) => args[key] === void 0);
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.join(", ")}`);
  }
}
function createServerProxy(runtime, serverName, mapOrOptions, maybeOptions) {
  let mapPropertyToTool = defaultToolNameMapper;
  let options;
  if (typeof mapOrOptions === "function") {
    mapPropertyToTool = mapOrOptions;
    options = maybeOptions;
  } else if (mapOrOptions) {
    options = mapOrOptions;
    if (typeof mapOrOptions.mapPropertyToTool === "function") {
      mapPropertyToTool = mapOrOptions.mapPropertyToTool;
    }
  }
  const cacheSchemas = options?.cacheSchemas ?? true;
  const initialSchemas = options?.initialSchemas ?? void 0;
  const toolSchemaCache = /* @__PURE__ */ new Map();
  const persistedSchemas = /* @__PURE__ */ new Map();
  const toolAliasMap = /* @__PURE__ */ new Map();
  const schemaFetches = /* @__PURE__ */ new Map();
  let diskLoad = null;
  let persistPromise = null;
  let refreshPending = false;
  let definitionForCache;
  if (cacheSchemas) {
    try {
      definitionForCache = runtime.getDefinition(serverName);
    } catch {
      definitionForCache = void 0;
    }
  }
  if (cacheSchemas && !initialSchemas && definitionForCache) {
    diskLoad = loadSchemasFromDisk(definitionForCache);
    refreshPending = true;
  }
  if (initialSchemas) {
    for (const [key, schemaRaw] of Object.entries(initialSchemas)) {
      storeSchema(key, schemaRaw);
    }
    persistPromise = persistSchemas();
  }
  async function consumePersist() {
    if (!persistPromise) {
      return;
    }
    try {
      await persistPromise;
    } finally {
      persistPromise = null;
    }
  }
  async function ensureMetadata(toolName, metadataOptions = {}) {
    await consumePersist();
    const cached = toolSchemaCache.get(toolName);
    if (cached && !refreshPending) {
      return cached;
    }
    if (diskLoad) {
      try {
        await diskLoad;
      } finally {
        diskLoad = null;
      }
      if (toolSchemaCache.has(toolName) && !refreshPending) {
        return toolSchemaCache.get(toolName);
      }
    }
    const disableOAuth = metadataOptions.disableOAuth === true;
    const schemaFetchKey = disableOAuth ? "disable-oauth" : metadataOptions.autoAuthorize === false ? "no-authorize" : "default";
    let schemaFetch = schemaFetches.get(schemaFetchKey);
    if (!schemaFetch) {
      const listToolsOptions = {
        includeSchema: true
      };
      if (disableOAuth) {
        listToolsOptions.disableOAuth = true;
      } else if (metadataOptions.autoAuthorize === false) {
        listToolsOptions.autoAuthorize = false;
      }
      schemaFetch = runtime.listTools(serverName, listToolsOptions).then((tools) => {
        for (const tool of tools) {
          if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
            continue;
          }
          storeSchema(tool.name, tool.inputSchema);
        }
        persistPromise = persistSchemas();
        refreshPending = false;
      }).catch((error) => {
        if (schemaFetches.get(schemaFetchKey) === schemaFetch) {
          schemaFetches.delete(schemaFetchKey);
        }
        throw error;
      });
      schemaFetches.set(schemaFetchKey, schemaFetch);
    }
    await schemaFetch;
    await consumePersist();
    return toolSchemaCache.get(toolName);
  }
  function storeSchema(key, schemaRaw) {
    const info = createToolSchemaInfo(schemaRaw);
    if (!info) {
      return;
    }
    const canonical = mapPropertyToTool(key);
    toolSchemaCache.set(canonical, info);
    if (canonical !== key) {
      toolSchemaCache.set(key, info);
    }
    const canonicalAlias = canonicalizeToolName(key);
    if (!toolAliasMap.has(canonicalAlias)) {
      toolAliasMap.set(canonicalAlias, key);
    }
    const mapperAlias = canonicalizeToolName(canonical);
    if (!toolAliasMap.has(mapperAlias)) {
      toolAliasMap.set(mapperAlias, key);
    }
    if (cacheSchemas && definitionForCache && isPlainObject2(schemaRaw)) {
      persistedSchemas.set(canonical, schemaRaw);
    }
  }
  async function loadSchemasFromDisk(definition) {
    try {
      const snapshot = await readSchemaCache(definition);
      if (!snapshot) {
        return;
      }
      for (const [key, schemaRaw] of Object.entries(snapshot.tools)) {
        storeSchema(key, schemaRaw);
      }
    } catch {
    }
  }
  function persistSchemas() {
    if (!cacheSchemas || !definitionForCache || persistedSchemas.size === 0) {
      return null;
    }
    const definition = definitionForCache;
    const snapshot = {
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      tools: Object.fromEntries(persistedSchemas.entries())
    };
    return writeSchemaCache(definition, snapshot).catch(() => {
    });
  }
  const base = {
    call: async (toolName, callOptions) => {
      const result = await runtime.callTool(serverName, toolName, callOptions ?? {});
      return createCallResult(result);
    },
    listTools: (listOptions) => runtime.listTools(serverName, listOptions)
  };
  return new Proxy(base, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      const propertyKey = property;
      const canonicalKey = typeof propertyKey === "string" ? canonicalizeToolName(propertyKey) : null;
      let resolvedToolName = typeof propertyKey === "string" && canonicalKey ? toolAliasMap.get(canonicalKey) ?? mapPropertyToTool(propertyKey) : mapPropertyToTool(propertyKey);
      return async (...callArgs) => {
        const { options: metadataOptions, optionObjects } = inferMetadataOptions(callArgs);
        let schemaInfo;
        try {
          schemaInfo = await ensureMetadata(resolvedToolName, metadataOptions);
        } catch {
          schemaInfo = void 0;
        }
        if (typeof propertyKey === "string" && canonicalKey) {
          const alias = toolAliasMap.get(canonicalKey);
          if (alias && alias !== resolvedToolName) {
            resolvedToolName = alias;
            try {
              schemaInfo = await ensureMetadata(resolvedToolName, metadataOptions);
            } catch {
            }
          }
        }
        const positional = [];
        const argsAccumulator = {};
        const optionsAccumulator = {};
        for (const arg of callArgs) {
          if (isPlainObject2(arg)) {
            const keys = Object.keys(arg);
            const treatAsArgs = !optionObjects.has(arg) && schemaInfo !== void 0 && keys.length > 0 && (keys.every((key) => schemaInfo.propertySet.has(key)) || keys.every((key) => !KNOWN_OPTION_KEYS.has(key)));
            if (treatAsArgs) {
              Object.assign(argsAccumulator, arg);
            } else {
              Object.assign(optionsAccumulator, arg);
            }
          } else {
            positional.push(arg);
          }
        }
        const explicitArgs = optionsAccumulator.args;
        if (explicitArgs !== void 0) {
          delete optionsAccumulator.args;
        }
        const finalOptions = { ...optionsAccumulator };
        let combinedArgs = explicitArgs;
        if (schemaInfo) {
          const schema = schemaInfo;
          if (positional.length > schema.orderedKeys.length) {
            throw new Error(`Too many positional arguments for tool "${resolvedToolName}"`);
          }
          if (positional.length > 0) {
            const baseArgs = isPlainObject2(combinedArgs) ? { ...combinedArgs } : {};
            positional.forEach((value, idx) => {
              const key = schema.orderedKeys[idx];
              if (key) {
                baseArgs[key] = value;
              }
            });
            combinedArgs = baseArgs;
          }
          if (Object.keys(argsAccumulator).length > 0) {
            const baseArgs = isPlainObject2(combinedArgs) ? { ...combinedArgs } : {};
            Object.assign(baseArgs, argsAccumulator);
            combinedArgs = baseArgs;
          }
          if (combinedArgs !== void 0) {
            combinedArgs = applyDefaults(schema, combinedArgs);
          } else {
            const defaults = applyDefaults(schema, void 0);
            if (defaults && typeof defaults === "object") {
              combinedArgs = defaults;
            }
          }
          validateRequired(schema, combinedArgs);
        } else {
          if (positional.length > 0) {
            combinedArgs = positional;
          }
          if (Object.keys(argsAccumulator).length > 0) {
            const baseArgs = isPlainObject2(combinedArgs) ? { ...combinedArgs } : {};
            Object.assign(baseArgs, argsAccumulator);
            combinedArgs = baseArgs;
          }
        }
        if (combinedArgs !== void 0) {
          finalOptions.args = combinedArgs;
        }
        const result = await runtime.callTool(serverName, resolvedToolName, finalOptions);
        return createCallResult(result);
      };
    }
  });
}
export {
  callOnce,
  createCallResult,
  createGeneratedKeepAliveRuntime,
  createRuntime,
  createServerProxy,
  describeConnectionIssue,
  handleDaemonCli,
  loadServerDefinitions,
  wrapCallResult
};
/*! Bundled license information:

content-type/index.js:
  (*!
   * content-type
   * Copyright(c) 2015 Douglas Christopher Wilson
   * MIT Licensed
   *)
*/
