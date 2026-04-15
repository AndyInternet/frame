import Parser from "web-tree-sitter";
import type {
  Parameter,
  ParseResult,
  RawSymbol,
  SymbolKind,
} from "../../core/schema.ts";

/** Strip comment nodes from AST node text, normalize whitespace for stable hashing */
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

  // Normalize whitespace so comment removal doesn't create hash-affecting artifacts
  return result.replace(/\s+/g, " ").trim();
}

/** Extract parameters from formal_parameters node */
function extractParameters(paramsNode: Parser.SyntaxNode): Parameter[] {
  const params: Parameter[] = [];
  for (let i = 0; i < paramsNode.namedChildCount; i++) {
    const param = paramsNode.namedChild(i);
    if (!param) continue;
    if (
      param.type === "required_parameter" ||
      param.type === "optional_parameter"
    ) {
      const nameNode = param.namedChildren.find((c) => c.type === "identifier");
      const typeNode = param.namedChildren.find(
        (c) => c.type === "type_annotation",
      );
      params.push({
        name: nameNode?.text ?? "unknown",
        type: typeNode ? typeNode.text.replace(/^:\s*/, "") : "unknown",
      });
    }
  }
  return params;
}

/** Extract return type from type_annotation child */
function extractReturns(node: Parser.SyntaxNode): string[] {
  const typeAnnotation = node.namedChildren.find(
    (c) => c.type === "type_annotation",
  );
  if (!typeAnnotation) return [];
  return [typeAnnotation.text.replace(/^:\s*/, "")];
}

/** Extract generic type parameters */
function extractGenericParams(node: Parser.SyntaxNode): string[] {
  const typeParams = node.namedChildren.find(
    (c) => c.type === "type_parameters",
  );
  if (!typeParams) return [];
  return typeParams.namedChildren
    .filter((c) => c.type === "type_parameter")
    .map((c) => c.text);
}

/** Check for async keyword in node children */
function hasAsync(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === "async") return true;
  }
  return false;
}

/** Extract @throws tags from JSDoc comment preceding a node */
function extractThrows(source: string, node: Parser.SyntaxNode): string[] {
  const textBefore = source.slice(0, node.startIndex);
  const commentMatch = textBefore.match(/\/\*\*[\s\S]*?\*\/\s*$/);
  if (!commentMatch) return [];
  const throws: string[] = [];
  const re = /@throws\s+\{([^}]+)\}/g;
  let m: RegExpExecArray | null = re.exec(commentMatch[0]);
  while (m !== null) {
    if (m[1]) throws.push(m[1]);
    m = re.exec(commentMatch[0]);
  }
  return throws;
}

/** Get accessibility modifier (public/private/protected) */
function getVisibility(node: Parser.SyntaxNode): string {
  const mod = node.namedChildren.find(
    (c) => c.type === "accessibility_modifier",
  );
  return mod?.text ?? "public";
}

/** Get const or let from lexical_declaration */
function getDeclKind(node: Parser.SyntaxNode): "const" | "let" {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.isNamed && child.type === "let") return "let";
  }
  return "const";
}

/** Parse TypeScript/TSX source using tree-sitter AST. Caller owns `parser`. */
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
    const strNode = node.namedChildren.find((c) => c.type === "string");
    if (strNode) {
      const fragment = strNode.namedChildren.find(
        (c) => c.type === "string_fragment",
      );
      if (fragment) imports.push(fragment.text);
    }
  }

  function processFunction(node: Parser.SyntaxNode, exported: boolean): void {
    const nameNode = node.namedChildren.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? "default";
    const params = node.namedChildren.find(
      (c) => c.type === "formal_parameters",
    );
    const gp = extractGenericParams(node);
    const astText = stripComments(node);

    symbols.push({
      name,
      kind: "function",
      exported,
      parameters: params ? extractParameters(params) : [],
      returns: extractReturns(node),
      ...(gp.length > 0 ? { genericParams: gp } : {}),
      languageFeatures: {
        async: hasAsync(node),
        throws: extractThrows(source, node),
      },
      astText,
    });
  }

  function processLexical(node: Parser.SyntaxNode, exported: boolean): void {
    const declKind = getDeclKind(node);

    for (const declarator of node.namedChildren) {
      if (declarator.type !== "variable_declarator") continue;

      const nameNode = declarator.namedChildren.find(
        (c) => c.type === "identifier",
      );
      const name = nameNode?.text ?? "unknown";
      const astText = stripComments(node);

      const arrowFn = declarator.namedChildren.find(
        (c) => c.type === "arrow_function",
      );

      if (arrowFn) {
        const params = arrowFn.namedChildren.find(
          (c) => c.type === "formal_parameters",
        );
        const gp = extractGenericParams(arrowFn);
        symbols.push({
          name,
          kind: "function",
          exported,
          parameters: params ? extractParameters(params) : [],
          returns: extractReturns(arrowFn),
          ...(gp.length > 0 ? { genericParams: gp } : {}),
          languageFeatures: {
            async: hasAsync(arrowFn),
            throws: extractThrows(source, node),
          },
          astText,
        });
      } else {
        const kind: SymbolKind = declKind === "const" ? "constant" : "variable";
        let value: string | undefined;
        for (const child of declarator.namedChildren) {
          if (child.type !== "identifier" && child.type !== "type_annotation") {
            if (child.type === "number") {
              value = child.text;
            } else if (child.type === "string") {
              const frag = child.namedChildren.find(
                (c) => c.type === "string_fragment",
              );
              value = frag?.text ?? child.text;
            } else if (child.type === "true" || child.type === "false") {
              value = child.text;
            }
          }
        }
        symbols.push({
          name,
          kind,
          exported,
          languageFeatures: {
            declarationKind: declKind,
            ...(value !== undefined ? { value } : {}),
          },
          astText,
        });
      }
    }
  }

  function processVariable(node: Parser.SyntaxNode, exported: boolean): void {
    for (const declarator of node.namedChildren) {
      if (declarator.type !== "variable_declarator") continue;

      const nameNode = declarator.namedChildren.find(
        (c) => c.type === "identifier",
      );
      const name = nameNode?.text ?? "unknown";

      symbols.push({
        name,
        kind: "variable",
        exported,
        languageFeatures: { declarationKind: "var" },
        astText: stripComments(node),
      });
    }
  }

  function processClass(node: Parser.SyntaxNode, exported: boolean): void {
    const nameNode = node.namedChildren.find(
      (c) => c.type === "type_identifier",
    );
    const name = nameNode?.text ?? "default";
    const gp = extractGenericParams(node);
    const classBody = node.namedChildren.find((c) => c.type === "class_body");

    // Extends / implements detection
    let extendsName: string | undefined;
    const implementsList: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === "extends_clause" || child.type === "class_heritage") {
        for (const sub of child.namedChildren) {
          if (
            !extendsName &&
            (sub.type === "type_identifier" || sub.type === "identifier")
          ) {
            extendsName = sub.text;
          }
        }
      }
      if (child.type === "implements_clause") {
        for (const sub of child.namedChildren) {
          if (sub.type === "type_identifier" || sub.type === "identifier") {
            implementsList.push(sub.text);
          }
        }
      }
    }

    let constructorParams: Parameter[] | undefined;
    const properties: Array<{
      name: string;
      type: string;
      visibility: string;
    }> = [];
    const methodNames: string[] = [];

    if (classBody) {
      for (const member of classBody.namedChildren) {
        if (member.type === "method_definition") {
          const mNameNode = member.namedChildren.find(
            (c) => c.type === "property_identifier",
          );
          const mName = mNameNode?.text ?? "unknown";

          if (mName === "constructor") {
            const params = member.namedChildren.find(
              (c) => c.type === "formal_parameters",
            );
            constructorParams = params ? extractParameters(params) : [];
          }

          methodNames.push(mName);

          const params = member.namedChildren.find(
            (c) => c.type === "formal_parameters",
          );

          symbols.push({
            name: mName,
            kind: "method",
            exported: false,
            parameters: params ? extractParameters(params) : [],
            returns: extractReturns(member),
            languageFeatures: {
              async: hasAsync(member),
              throws: extractThrows(source, member),
              class: name,
            },
            astText: stripComments(member),
          });
        } else if (member.type === "public_field_definition") {
          const propName =
            member.namedChildren.find((c) => c.type === "property_identifier")
              ?.text ?? "unknown";
          const typeAnnotation = member.namedChildren.find(
            (c) => c.type === "type_annotation",
          );
          const propType = typeAnnotation
            ? typeAnnotation.text.replace(/^:\s*/, "")
            : "unknown";
          properties.push({
            name: propName,
            type: propType,
            visibility: getVisibility(member),
          });
        }
      }
    }

    const classFeatures: Record<string, unknown> = {
      methods: methodNames,
      properties,
    };
    if (constructorParams !== undefined) {
      classFeatures.constructor = { parameters: constructorParams };
    }
    if (extendsName) classFeatures.extends = extendsName;
    if (implementsList.length > 0) classFeatures.implements = implementsList;

    symbols.push({
      name,
      kind: "class",
      exported,
      ...(gp.length > 0 ? { genericParams: gp } : {}),
      languageFeatures: classFeatures,
      astText: stripComments(node),
    });
  }

  function processInterface(node: Parser.SyntaxNode, exported: boolean): void {
    const nameNode = node.namedChildren.find(
      (c) => c.type === "type_identifier",
    );
    const name = nameNode?.text ?? "unknown";
    const body = node.namedChildren.find(
      (c) => c.type === "interface_body" || c.type === "object_type",
    );
    const gp = extractGenericParams(node);

    // Extends
    const extendsList: string[] = [];
    const extendsClause = node.namedChildren.find(
      (c) => c.type === "extends_type_clause",
    );
    if (extendsClause) {
      for (const child of extendsClause.namedChildren) {
        if (child.type === "type_identifier") extendsList.push(child.text);
      }
    }

    const members: Array<{ name: string; type: string }> = [];
    if (body) {
      for (const member of body.namedChildren) {
        if (member.type === "method_signature") {
          const memberName =
            member.namedChildren.find((c) => c.type === "property_identifier")
              ?.text ?? "unknown";
          const params =
            member.namedChildren.find((c) => c.type === "formal_parameters")
              ?.text ?? "()";
          const returnType =
            member.namedChildren
              .find((c) => c.type === "type_annotation")
              ?.text.replace(/^:\s*/, "") ?? "void";
          members.push({
            name: memberName,
            type: `${params} => ${returnType}`,
          });
        } else if (member.type === "property_signature") {
          const memberName =
            member.namedChildren.find((c) => c.type === "property_identifier")
              ?.text ?? "unknown";
          const typeAnnotation = member.namedChildren.find(
            (c) => c.type === "type_annotation",
          );
          members.push({
            name: memberName,
            type: typeAnnotation
              ? typeAnnotation.text.replace(/^:\s*/, "")
              : "unknown",
          });
        }
      }
    }

    const features: Record<string, unknown> = {
      structural: false,
      members,
    };
    if (extendsList.length > 0) features.extends = extendsList;

    symbols.push({
      name,
      kind: "interface",
      exported,
      ...(gp.length > 0 ? { genericParams: gp } : {}),
      languageFeatures: features,
      astText: stripComments(node),
    });
  }

  function processTypeAlias(node: Parser.SyntaxNode, exported: boolean): void {
    const nameNode = node.namedChildren.find(
      (c) => c.type === "type_identifier",
    );
    const name = nameNode?.text ?? "unknown";
    const gp = extractGenericParams(node);

    // RHS definition: last named child that isn't name or type_parameters
    let definition = "";
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (
        child &&
        child.type !== "type_identifier" &&
        child.type !== "type_parameters"
      ) {
        definition = child.text;
      }
    }

    symbols.push({
      name,
      kind: "type",
      exported,
      ...(gp.length > 0 ? { genericParams: gp } : {}),
      languageFeatures: { definition },
      astText: stripComments(node),
    });
  }

  function processEnum(node: Parser.SyntaxNode, exported: boolean): void {
    const nameNode = node.namedChildren.find((c) => c.type === "identifier");
    const name = nameNode?.text ?? "unknown";
    const enumBody = node.namedChildren.find((c) => c.type === "enum_body");

    const members: Array<{ name: string; value?: string }> = [];
    if (enumBody) {
      for (let i = 0; i < enumBody.namedChildCount; i++) {
        const member = enumBody.namedChild(i);
        if (member && member.type === "enum_assignment") {
          const memberName =
            member.namedChildren.find((c) => c.type === "property_identifier")
              ?.text ?? "unknown";
          const valueNode = member.namedChildren.find(
            (c) => c.type === "string" || c.type === "number",
          );
          let value: string | undefined;
          if (valueNode) {
            if (valueNode.type === "string") {
              const frag = valueNode.namedChildren.find(
                (c) => c.type === "string_fragment",
              );
              value = frag?.text ?? valueNode.text;
            } else {
              value = valueNode.text;
            }
          }
          members.push({
            name: memberName,
            ...(value !== undefined ? { value } : {}),
          });
        }
      }
    }

    symbols.push({
      name,
      kind: "enum",
      exported,
      languageFeatures: { members },
      astText: stripComments(node),
    });
  }

  function processExport(node: Parser.SyntaxNode): void {
    // Named export clause: export { foo } or export { foo } from './bar'
    const exportClause = node.namedChildren.find(
      (c) => c.type === "export_clause",
    );
    if (exportClause) {
      // Re-export source path
      const fromStr = node.namedChildren.find((c) => c.type === "string");
      if (fromStr) {
        const fragment = fromStr.namedChildren.find(
          (c) => c.type === "string_fragment",
        );
        if (fragment) imports.push(fragment.text);
      }
      return;
    }

    // Wrapped declaration — process as exported
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) processTopLevel(child, true);
    }
  }

  function processTopLevel(node: Parser.SyntaxNode, exported: boolean): void {
    switch (node.type) {
      case "import_statement":
        processImport(node);
        break;
      case "export_statement":
        processExport(node);
        break;
      case "function_declaration":
        processFunction(node, exported);
        break;
      case "lexical_declaration":
        processLexical(node, exported);
        break;
      case "variable_declaration":
        processVariable(node, exported);
        break;
      case "class_declaration":
      case "abstract_class_declaration":
        processClass(node, exported);
        break;
      case "interface_declaration":
        processInterface(node, exported);
        break;
      case "type_alias_declaration":
        processTypeAlias(node, exported);
        break;
      case "enum_declaration":
        processEnum(node, exported);
        break;
    }
  }

  // Traverse root children
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (child?.isNamed) {
      processTopLevel(child, false);
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
