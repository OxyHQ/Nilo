"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "DEFAULT_SCHEMA", {
  enumerable: true,
  get: function () {
    return _schema.DEFAULT_SCHEMA;
  }
});
Object.defineProperty(exports, "EditorStore", {
  enumerable: true,
  get: function () {
    return _store.EditorStore;
  }
});
Object.defineProperty(exports, "History", {
  enumerable: true,
  get: function () {
    return _history.History;
  }
});
Object.defineProperty(exports, "INLINE_EQUATION_KIND", {
  enumerable: true,
  get: function () {
    return _markdown.INLINE_EQUATION_KIND;
  }
});
Object.defineProperty(exports, "acceptsChildren", {
  enumerable: true,
  get: function () {
    return _schema.acceptsChildren;
  }
});
Object.defineProperty(exports, "anchorAt", {
  enumerable: true,
  get: function () {
    return _operations.anchorAt;
  }
});
Object.defineProperty(exports, "anchorOf", {
  enumerable: true,
  get: function () {
    return _operations.anchorOf;
  }
});
Object.defineProperty(exports, "appendChild", {
  enumerable: true,
  get: function () {
    return _commands.appendChild;
  }
});
Object.defineProperty(exports, "applyBlockShortcut", {
  enumerable: true,
  get: function () {
    return _markdown.applyBlockShortcut;
  }
});
Object.defineProperty(exports, "applyEdit", {
  enumerable: true,
  get: function () {
    return _commands.applyEdit;
  }
});
Object.defineProperty(exports, "applyInlineEquation", {
  enumerable: true,
  get: function () {
    return _markdown.applyInlineEquation;
  }
});
Object.defineProperty(exports, "applyInlineShortcut", {
  enumerable: true,
  get: function () {
    return _markdown.applyInlineShortcut;
  }
});
Object.defineProperty(exports, "applyOperation", {
  enumerable: true,
  get: function () {
    return _operations.applyOperation;
  }
});
Object.defineProperty(exports, "applyTransaction", {
  enumerable: true,
  get: function () {
    return _operations.applyTransaction;
  }
});
Object.defineProperty(exports, "backspaceAtStart", {
  enumerable: true,
  get: function () {
    return _commands.backspaceAtStart;
  }
});
Object.defineProperty(exports, "blockRange", {
  enumerable: true,
  get: function () {
    return _selection.blockRange;
  }
});
Object.defineProperty(exports, "blockStep", {
  enumerable: true,
  get: function () {
    return _selection.blockStep;
  }
});
Object.defineProperty(exports, "canHold", {
  enumerable: true,
  get: function () {
    return _schema.canHold;
  }
});
Object.defineProperty(exports, "canTurnInto", {
  enumerable: true,
  get: function () {
    return _commands.canTurnInto;
  }
});
Object.defineProperty(exports, "childrenOf", {
  enumerable: true,
  get: function () {
    return _document.childrenOf;
  }
});
Object.defineProperty(exports, "cloneSubtree", {
  enumerable: true,
  get: function () {
    return _commands.cloneSubtree;
  }
});
Object.defineProperty(exports, "composeCommands", {
  enumerable: true,
  get: function () {
    return _commands.composeCommands;
  }
});
Object.defineProperty(exports, "defineSchema", {
  enumerable: true,
  get: function () {
    return _schema.defineSchema;
  }
});
Object.defineProperty(exports, "deleteAtEnd", {
  enumerable: true,
  get: function () {
    return _commands.deleteAtEnd;
  }
});
Object.defineProperty(exports, "depthOf", {
  enumerable: true,
  get: function () {
    return _document.depthOf;
  }
});
Object.defineProperty(exports, "detectBlockShortcut", {
  enumerable: true,
  get: function () {
    return _markdown.detectBlockShortcut;
  }
});
Object.defineProperty(exports, "documentFromSnapshot", {
  enumerable: true,
  get: function () {
    return _snapshot.documentFromSnapshot;
  }
});
Object.defineProperty(exports, "documentToSnapshot", {
  enumerable: true,
  get: function () {
    return _snapshot.documentToSnapshot;
  }
});
Object.defineProperty(exports, "duplicateBlocks", {
  enumerable: true,
  get: function () {
    return _commands.duplicateBlocks;
  }
});
Object.defineProperty(exports, "editText", {
  enumerable: true,
  get: function () {
    return _commands.editText;
  }
});
Object.defineProperty(exports, "emptyDocument", {
  enumerable: true,
  get: function () {
    return _document.emptyDocument;
  }
});
Object.defineProperty(exports, "exportSnapshot", {
  enumerable: true,
  get: function () {
    return _snapshot.exportSnapshot;
  }
});
Object.defineProperty(exports, "extendSchema", {
  enumerable: true,
  get: function () {
    return _schema.extendSchema;
  }
});
Object.defineProperty(exports, "filterSlashItems", {
  enumerable: true,
  get: function () {
    return _slash.filterSlashItems;
  }
});
Object.defineProperty(exports, "formatText", {
  enumerable: true,
  get: function () {
    return _commands.formatText;
  }
});
Object.defineProperty(exports, "getBlock", {
  enumerable: true,
  get: function () {
    return _document.getBlock;
  }
});
Object.defineProperty(exports, "htmlToSnapshot", {
  enumerable: true,
  get: function () {
    return _html.htmlToSnapshot;
  }
});
Object.defineProperty(exports, "indent", {
  enumerable: true,
  get: function () {
    return _commands.indent;
  }
});
Object.defineProperty(exports, "indentBlocks", {
  enumerable: true,
  get: function () {
    return _commands.indentBlocks;
  }
});
Object.defineProperty(exports, "insertBlockAfter", {
  enumerable: true,
  get: function () {
    return _commands.insertBlockAfter;
  }
});
Object.defineProperty(exports, "insertMention", {
  enumerable: true,
  get: function () {
    return _commands.insertMention;
  }
});
Object.defineProperty(exports, "insertSnapshot", {
  enumerable: true,
  get: function () {
    return _snapshot.insertSnapshot;
  }
});
Object.defineProperty(exports, "invertOperation", {
  enumerable: true,
  get: function () {
    return _operations.invertOperation;
  }
});
Object.defineProperty(exports, "invertTransaction", {
  enumerable: true,
  get: function () {
    return _operations.invertTransaction;
  }
});
Object.defineProperty(exports, "isPlainSnapshot", {
  enumerable: true,
  get: function () {
    return _html.isPlainSnapshot;
  }
});
Object.defineProperty(exports, "isStructural", {
  enumerable: true,
  get: function () {
    return _schema.isStructural;
  }
});
Object.defineProperty(exports, "isToggle", {
  enumerable: true,
  get: function () {
    return _schema.isToggle;
  }
});
Object.defineProperty(exports, "isWithin", {
  enumerable: true,
  get: function () {
    return _document.isWithin;
  }
});
Object.defineProperty(exports, "moveBlocks", {
  enumerable: true,
  get: function () {
    return _commands.moveBlocks;
  }
});
Object.defineProperty(exports, "nextTextBlock", {
  enumerable: true,
  get: function () {
    return _commands.nextTextBlock;
  }
});
Object.defineProperty(exports, "outdent", {
  enumerable: true,
  get: function () {
    return _commands.outdent;
  }
});
Object.defineProperty(exports, "outdentBlocks", {
  enumerable: true,
  get: function () {
    return _commands.outdentBlocks;
  }
});
Object.defineProperty(exports, "parentOf", {
  enumerable: true,
  get: function () {
    return _schema.parentOf;
  }
});
Object.defineProperty(exports, "pasteIntoBlock", {
  enumerable: true,
  get: function () {
    return _paste.pasteIntoBlock;
  }
});
Object.defineProperty(exports, "pasteSnapshot", {
  enumerable: true,
  get: function () {
    return _paste.pasteSnapshot;
  }
});
Object.defineProperty(exports, "placeAfter", {
  enumerable: true,
  get: function () {
    return _schema.placeAfter;
  }
});
Object.defineProperty(exports, "positionOf", {
  enumerable: true,
  get: function () {
    return _document.positionOf;
  }
});
Object.defineProperty(exports, "previousTextBlock", {
  enumerable: true,
  get: function () {
    return _commands.previousTextBlock;
  }
});
Object.defineProperty(exports, "propsFor", {
  enumerable: true,
  get: function () {
    return _schema.propsFor;
  }
});
Object.defineProperty(exports, "readingOrder", {
  enumerable: true,
  get: function () {
    return _document.readingOrder;
  }
});
Object.defineProperty(exports, "rebaseOperations", {
  enumerable: true,
  get: function () {
    return _operations.rebaseOperations;
  }
});
Object.defineProperty(exports, "removeBlocks", {
  enumerable: true,
  get: function () {
    return _commands.removeBlocks;
  }
});
Object.defineProperty(exports, "selectableBlock", {
  enumerable: true,
  get: function () {
    return _selection.selectableBlock;
  }
});
Object.defineProperty(exports, "setBlocksProps", {
  enumerable: true,
  get: function () {
    return _commands.setBlocksProps;
  }
});
Object.defineProperty(exports, "setProps", {
  enumerable: true,
  get: function () {
    return _commands.setProps;
  }
});
Object.defineProperty(exports, "slashQuery", {
  enumerable: true,
  get: function () {
    return _slash.slashQuery;
  }
});
Object.defineProperty(exports, "slashTriggerAt", {
  enumerable: true,
  get: function () {
    return _slash.slashTriggerAt;
  }
});
Object.defineProperty(exports, "snapshotToMarkdown", {
  enumerable: true,
  get: function () {
    return _snapshot.snapshotToMarkdown;
  }
});
Object.defineProperty(exports, "specOf", {
  enumerable: true,
  get: function () {
    return _schema.specOf;
  }
});
Object.defineProperty(exports, "splitBlock", {
  enumerable: true,
  get: function () {
    return _commands.splitBlock;
  }
});
Object.defineProperty(exports, "subtreeIds", {
  enumerable: true,
  get: function () {
    return _document.subtreeIds;
  }
});
Object.defineProperty(exports, "turnInto", {
  enumerable: true,
  get: function () {
    return _commands.turnInto;
  }
});
Object.defineProperty(exports, "validateDocument", {
  enumerable: true,
  get: function () {
    return _document.validateDocument;
  }
});
var _document = require("./document.js");
var _schema = require("./schema.js");
var _operations = require("./operations.js");
var _commands = require("./commands.js");
var _history = require("./history.js");
var _store = require("./store.js");
var _snapshot = require("./snapshot.js");
var _markdown = require("./markdown.js");
var _slash = require("./slash.js");
var _paste = require("./paste.js");
var _html = require("./html.js");
var _selection = require("./selection.js");
//# sourceMappingURL=index.js.map