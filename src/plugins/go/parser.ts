import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Parser from "web-tree-sitter";
import type {
  Parameter,
  ParseResult,
  RawSymbol,
  SymbolKind,
} from "../../core/schema.ts";

// --- go.mod module path cache ---
const goModCache = new Map<string, string | null>();

function getModulePath(projectRoot: string): string | null {
  if (goModCache.has(projectRoot)) {
    return goModCache.get(projectRoot) as string | null;
  }
  const goModPath = join(projectRoot, "go.mod");
  if (!existsSync(goModPath)) {
    goModCache.set(projectRoot, null);
    return null;
  }
  const content = readFileSync(goModPath, "utf-8");
  const match = content.match(/^module\s+(\S+)/m);
  const modulePath = match ? match[1] : null;
  goModCache.set(projectRoot, modulePath);
  return modulePath;
}

/** Classify import as internal (project module) or external */
export function classifyImport(
  importPath: string,
  projectRoot: string,
): "internal" | "external" {
  const modulePath = getModulePath(projectRoot);
  if (modulePath && importPath.startsWith(modulePath)) {
    return "internal";
  }
  return "external";
}

/** Strip comment nodes from AST text, normalize whitespace for stable hashing */
function stripComments(node: Parser.SyntaxNode): string {
  const nodeText = node.text;
  const nodeStart = node.startIndex;
  const comments: Array<{ start: number; end: number }> = [];

  function findComments(n: Parser.SyntaxNode): void {
    if (n.type === "comment") {
      comments.push({
        start: n.startIndex - nodeStart,
        end: n.endIndex - nodeStart,
      });
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) findComments(c);
    }
  }

  findComments(node);

  let result = nodeText;
  if (comments.length > 0) {
    comments.sort((a, b) => b.start - a.start);
    for (const c of comments) {
      result = result.slice(0, c.start) + result.slice(c.end);
    }
  }

  return result.replace(/\s+/g, " ").trim();
}

/** Check if Go identifier is exported (first char uppercase) */
function isExported(name: string): boolean {
  if (name.length === 0) return false;
  const first = name.charCodeAt(0);
  return first >= 65 && first <= 90; // A-Z
}

/** Extract parameters from a Go parameter_list node */
function extractParameters(paramList: Parser.SyntaxNode): Parameter[] {
  const params: Parameter[] = [];
  for (const child of paramList.namedChildren) {
    if (child.type !== "parameter_declaration") continue;
    // Find identifiers and type — in Go, multiple names share one type
    const identifiers: string[] = [];
    let typeText = "unknown";
    for (const sub of child.namedChildren) {
      if (sub.type === "identifier") {
        identifiers.push(sub.text);
      } else if (sub.type !== "identifier") {
        // Everything that isn't an identifier is the type
        typeText = sub.text;
      }
    }
    if (identifiers.length === 0) {
      // Unnamed parameter (just type, like in return lists)
      params.push({ name: "", type: typeText });
    } else {
      for (const name of identifiers) {
        params.push({ name, type: typeText });
      }
    }
  }
  return params;
}

/** Extract return types from function/method node.
 *  Returns can be: single type_identifier, or parameter_list (tuple). */
function extractReturns(node: Parser.SyntaxNode): string[] {
  // In tree-sitter-go, after the params parameter_list:
  // - single return: type_identifier or pointer_type etc. directly
  // - multiple returns: a second parameter_list
  const children: Parser.SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) children.push(c);
  }

  // Find params list index (first parameter_list)
  let paramsIdx = -1;
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === "parameter_list") {
      paramsIdx = i;
      break;
    }
  }
  if (paramsIdx === -1) return [];

  // For method_declaration, receiver is first param_list, then name, then params
  // For function_declaration, params is first param_list
  // After the params list, look for return types before block
  const afterParams: Parser.SyntaxNode[] = [];
  let foundFirstParams = false;
  const isMethod = node.type === "method_declaration";
  let paramListCount = 0;

  for (const c of children) {
    if (c.type === "parameter_list") {
      paramListCount++;
      if (isMethod && paramListCount === 1) {
        // Skip receiver list
        continue;
      }
      if (!foundFirstParams) {
        foundFirstParams = true;
        continue;
      }
    }
    if (foundFirstParams && c.type !== "block") {
      afterParams.push(c);
    }
  }

  if (afterParams.length === 0) return [];

  const returns: string[] = [];
  for (const c of afterParams) {
    if (c.type === "parameter_list") {
      // Multi-return: (type1, type2)
      for (const pd of c.namedChildren) {
        if (pd.type === "parameter_declaration") {
          // Get the type part — could be named or unnamed
          const typeNode =
            pd.namedChildren.find((n) => n.type !== "identifier") ?? pd;
          if (typeNode.type === "parameter_declaration") {
            // Unnamed: just the type
            returns.push(pd.text);
          } else {
            returns.push(typeNode.text);
          }
        }
      }
    } else if (c.isNamed) {
      // Single return type
      returns.push(c.text);
    }
  }

  return returns;
}

/** Check if function body contains `go` keyword (goroutine launch) */
function hasGoroutineHint(node: Parser.SyntaxNode): boolean {
  const block = node.namedChildren.find((c) => c.type === "block");
  if (!block) return false;

  function searchGo(n: Parser.SyntaxNode): boolean {
    if (n.type === "go_statement") return true;
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c && searchGo(c)) return true;
    }
    return false;
  }

  return searchGo(block);
}

/** Check if last return type is `error` */
function hasErrorReturn(returns: string[]): boolean {
  if (returns.length === 0) return false;
  return returns[returns.length - 1] === "error";
}

/** Parse struct tags string like `json:"name" db:"name"` into object */
function parseTags(tagText: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const re = /(\w+):"([^"]*)"/g;
  let m: RegExpExecArray | null = re.exec(tagText);
  while (m !== null) {
    if (m[1] && m[2] !== undefined) {
      tags[m[1]] = m[2];
    }
    m = re.exec(tagText);
  }
  return tags;
}

/** Parse Go source using tree-sitter AST. Caller owns `parser`. */
export async function parse(
  filePath: string,
  source: string,
  parser: Parser,
): Promise<ParseResult> {
  const tree = parser.parse(source);
  const root = tree.rootNode;

  // Reject files with parse errors
  if (root.hasError) {
    const errors: string[] = [];
    function collectErrors(n: Parser.SyntaxNode): void {
      if (n.type === "ERROR") {
        errors.push(
          `Syntax error at line ${n.startPosition.row + 1}:${n.startPosition.column}`,
        );
      }
      if (n.isMissing) {
        errors.push(
          `Missing ${n.type} at line ${n.startPosition.row + 1}:${n.startPosition.column}`,
        );
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c) collectErrors(c);
      }
    }
    collectErrors(root);
    tree.delete();
    return {
      ok: false,
      error: errors.length > 0 ? errors.join("; ") : "Parse error",
    };
  }

  const symbols: RawSymbol[] = [];
  const imports: string[] = [];

  // --- Node processors ---

  function processImport(node: Parser.SyntaxNode): void {
    // Single import: import "fmt"
    const singleSpec = node.namedChildren.find((c) => c.type === "import_spec");
    if (singleSpec) {
      extractImportPath(singleSpec);
    }
    // Grouped import: import ( "fmt" \n "os" )
    const specList = node.namedChildren.find(
      (c) => c.type === "import_spec_list",
    );
    if (specList) {
      for (const spec of specList.namedChildren) {
        if (spec.type === "import_spec") {
          extractImportPath(spec);
        }
      }
    }
  }

  function extractImportPath(spec: Parser.SyntaxNode): void {
    const strLit = spec.namedChildren.find(
      (c) => c.type === "interpreted_string_literal",
    );
    if (strLit) {
      const content = strLit.namedChildren.find(
        (c) => c.type === "interpreted_string_literal_content",
      );
      if (content) {
        imports.push(content.text);
      }
    }
  }

  function processFunction(node: Parser.SyntaxNode): void {
    const nameNode = node.namedChildren.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? "unknown";
    const exported = isExported(name);
    const astText = stripComments(node);

    // First parameter_list is the params
    const paramList = node.namedChildren.find(
      (c) => c.type === "parameter_list",
    );
    const params = paramList ? extractParameters(paramList) : [];
    const returns = extractReturns(node);

    const features: Record<string, unknown> = {
      errorReturn: hasErrorReturn(returns),
      goroutineHint: hasGoroutineHint(node),
      initFunc: name === "init",
    };

    symbols.push({
      name,
      kind: "function",
      exported: name === "init" ? false : exported,
      parameters: params,
      returns: returns.length > 0 ? returns : undefined,
      languageFeatures: features,
      astText,
    });
  }

  function processMethod(node: Parser.SyntaxNode): void {
    const nameNode = node.namedChildren.find(
      (c) => c.type === "field_identifier",
    );
    const name = nameNode?.text ?? "unknown";
    const exported = isExported(name);
    const astText = stripComments(node);

    // First parameter_list is receiver
    const paramLists = node.namedChildren.filter(
      (c) => c.type === "parameter_list",
    );
    const receiverList = paramLists[0];
    const paramList = paramLists[1];

    // Extract receiver info
    let receiverType = "unknown";
    let receiverPointer = false;
    if (receiverList) {
      const recvDecl = receiverList.namedChildren.find(
        (c) => c.type === "parameter_declaration",
      );
      if (recvDecl) {
        const ptrType = recvDecl.namedChildren.find(
          (c) => c.type === "pointer_type",
        );
        if (ptrType) {
          receiverPointer = true;
          const typeId = ptrType.namedChildren.find(
            (c) => c.type === "type_identifier",
          );
          receiverType = typeId?.text ?? "unknown";
        } else {
          const typeId = recvDecl.namedChildren.find(
            (c) => c.type === "type_identifier",
          );
          receiverType = typeId?.text ?? "unknown";
        }
      }
    }

    const params = paramList ? extractParameters(paramList) : [];
    const returns = extractReturns(node);

    const features: Record<string, unknown> = {
      receiver: {
        type: receiverType,
        pointer: receiverPointer,
      },
      errorReturn: hasErrorReturn(returns),
      goroutineHint: hasGoroutineHint(node),
    };

    symbols.push({
      name,
      kind: "method",
      exported,
      parameters: params,
      returns: returns.length > 0 ? returns : undefined,
      languageFeatures: features,
      astText,
    });
  }

  function processTypeDecl(node: Parser.SyntaxNode): void {
    const spec = node.namedChildren.find((c) => c.type === "type_spec");
    if (!spec) return;

    const nameNode = spec.namedChildren.find(
      (c) => c.type === "type_identifier",
    );
    const name = nameNode?.text ?? "unknown";
    const exported = isExported(name);

    const structType = spec.namedChildren.find((c) => c.type === "struct_type");
    if (structType) {
      processStruct(node, name, exported, structType);
      return;
    }

    const interfaceType = spec.namedChildren.find(
      (c) => c.type === "interface_type",
    );
    if (interfaceType) {
      processInterface(node, name, exported, interfaceType);
      return;
    }

    // Plain type alias (e.g. type Color int)
    // Not emitting these as separate symbols beyond struct/interface
    // unless there's a const iota block referencing it
  }

  function processStruct(
    declNode: Parser.SyntaxNode,
    name: string,
    exported: boolean,
    structType: Parser.SyntaxNode,
  ): void {
    const fieldList = structType.namedChildren.find(
      (c) => c.type === "field_declaration_list",
    );
    const fields: Array<{
      name: string;
      type: string;
      exported: boolean;
      tags: Record<string, string>;
    }> = [];

    if (fieldList) {
      for (const field of fieldList.namedChildren) {
        if (field.type !== "field_declaration") continue;

        const fieldNameNode = field.namedChildren.find(
          (c) => c.type === "field_identifier",
        );
        // Type can be type_identifier, pointer_type, slice_type, etc.
        const typeNode = field.namedChildren.find(
          (c) =>
            c.type !== "field_identifier" &&
            c.type !== "raw_string_literal" &&
            c.type !== "interpreted_string_literal",
        );
        const tagNode = field.namedChildren.find(
          (c) =>
            c.type === "raw_string_literal" ||
            c.type === "interpreted_string_literal",
        );

        // Embedded field: no field_identifier, use type name
        const fieldName = fieldNameNode
          ? fieldNameNode.text
          : (typeNode?.text ?? "unknown");
        const fieldType = typeNode?.text ?? "unknown";
        const tags = tagNode
          ? parseTags(
              tagNode.namedChildren.find(
                (c) => c.type === "raw_string_literal_content",
              )?.text ?? "",
            )
          : {};

        fields.push({
          name: fieldName,
          type: fieldType,
          exported: isExported(fieldName),
          tags,
        });
      }
    }

    symbols.push({
      name,
      kind: "struct" as SymbolKind,
      exported,
      languageFeatures: { fields },
      astText: stripComments(declNode),
    });
  }

  function processInterface(
    declNode: Parser.SyntaxNode,
    name: string,
    exported: boolean,
    interfaceType: Parser.SyntaxNode,
  ): void {
    const members: Array<{ name: string; type: string }> = [];

    for (const child of interfaceType.namedChildren) {
      if (child.type === "method_elem") {
        const methodName = child.namedChildren.find(
          (c) => c.type === "field_identifier",
        );
        if (methodName) {
          // Build signature from parameter lists and return type
          const paramLists = child.namedChildren.filter(
            (c) => c.type === "parameter_list",
          );
          const paramsText = paramLists[0]?.text ?? "()";
          let returnText = "";
          if (paramLists.length > 1) {
            returnText = ` ${paramLists[1].text}`;
          } else {
            // Single return type
            const retType = child.namedChildren.find(
              (c) =>
                c.type === "type_identifier" ||
                c.type === "pointer_type" ||
                c.type === "slice_type",
            );
            if (retType) returnText = ` ${retType.text}`;
          }
          members.push({
            name: methodName.text,
            type: `${paramsText}${returnText}`,
          });
        }
      }
    }

    symbols.push({
      name,
      kind: "interface",
      exported,
      languageFeatures: { structural: true, members },
      astText: stripComments(declNode),
    });
  }

  function processConst(node: Parser.SyntaxNode): void {
    // Check if this is a grouped const with iota
    const hasParens =
      node.children.some((c) => !c.isNamed && c.type === "(") ?? false;

    if (hasParens) {
      processConstBlock(node);
    } else {
      // Single const
      const specs = node.namedChildren.filter((c) => c.type === "const_spec");
      for (const spec of specs) {
        processSingleConst(spec, node);
      }
    }
  }

  function processConstBlock(node: Parser.SyntaxNode): void {
    const specs = node.namedChildren.filter((c) => c.type === "const_spec");

    // Check if this is an iota block
    let hasIota = false;
    let iotaTypeName: string | null = null;

    for (const spec of specs) {
      const exprList = spec.namedChildren.find(
        (c) => c.type === "expression_list",
      );
      if (exprList) {
        const iotaNode = exprList.namedChildren.find((c) => c.type === "iota");
        if (iotaNode) {
          hasIota = true;
          // Get the type from the first spec with iota
          const typeNode = spec.namedChildren.find(
            (c) => c.type === "type_identifier",
          );
          if (typeNode) iotaTypeName = typeNode.text;
          break;
        }
      }
    }

    if (hasIota) {
      // Emit as enum
      const blockName =
        iotaTypeName ??
        specs[0]?.namedChildren.find((c) => c.type === "identifier")?.text ??
        "unknown";
      const members: Array<{ name: string; value?: string }> = [];

      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const nameNode = spec.namedChildren.find(
          (c) => c.type === "identifier",
        );
        if (nameNode) {
          members.push({ name: nameNode.text });
        }
      }

      symbols.push({
        name: blockName,
        kind: "enum" as SymbolKind,
        exported: isExported(blockName),
        languageFeatures: {
          kind: "iota",
          iotaBlock: blockName,
          members,
        },
        astText: stripComments(node),
      });
    } else {
      // Non-iota grouped const — emit each as constant
      for (const spec of specs) {
        processSingleConst(spec, node);
      }
    }
  }

  function processSingleConst(
    spec: Parser.SyntaxNode,
    parentNode: Parser.SyntaxNode,
  ): void {
    const nameNode = spec.namedChildren.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? "unknown";
    const exprList = spec.namedChildren.find(
      (c) => c.type === "expression_list",
    );
    let value: string | undefined;
    if (exprList && exprList.namedChildCount > 0) {
      const firstExpr = exprList.namedChild(0);
      if (firstExpr) {
        value = firstExpr.text;
      }
    }

    const features: Record<string, unknown> = {};
    if (value !== undefined) features.value = value;

    symbols.push({
      name,
      kind: "constant",
      exported: isExported(name),
      languageFeatures: features,
      astText: stripComments(parentNode),
    });
  }

  function processVar(node: Parser.SyntaxNode): void {
    const specs = node.namedChildren.filter((c) => c.type === "var_spec");
    for (const spec of specs) {
      const nameNode = spec.namedChildren.find((c) => c.type === "identifier");
      const name = nameNode?.text ?? "unknown";

      symbols.push({
        name,
        kind: "variable",
        exported: isExported(name),
        languageFeatures: { declarationKind: "var" },
        astText: stripComments(node),
      });
    }
  }

  // Traverse root children
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child?.isNamed) continue;

    switch (child.type) {
      case "import_declaration":
        processImport(child);
        break;
      case "function_declaration":
        processFunction(child);
        break;
      case "method_declaration":
        processMethod(child);
        break;
      case "type_declaration":
        processTypeDecl(child);
        break;
      case "const_declaration":
        processConst(child);
        break;
      case "var_declaration":
        processVar(child);
        break;
    }
  }

  tree.delete();

  const fileAstText = symbols.map((s) => s.astText).join("\n");

  return {
    ok: true,
    parsed: {
      filePath,
      symbols,
      imports,
      astText: fileAstText,
    },
  };
}
