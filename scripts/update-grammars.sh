#!/usr/bin/env bash
set -euo pipefail
DIR="grammars"
mkdir -p "$DIR"
cp node_modules/web-tree-sitter/tree-sitter.wasm "$DIR/"
# tsx grammar used for both .ts and .tsx — it's a superset
cp node_modules/tree-sitter-typescript/tree-sitter-tsx.wasm "$DIR/tree-sitter-typescript.wasm"
cp node_modules/tree-sitter-go/tree-sitter-go.wasm "$DIR/"
echo "Updated grammar files in $DIR/"
