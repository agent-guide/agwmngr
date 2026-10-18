import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const rootOption = process.argv.indexOf("--root");
const root =
  rootOption < 0
    ? resolve(import.meta.dir, "..")
    : resolve(process.argv[rootOption + 1]);
const packageRoot = resolve(root, "packages");
const layers = ["contracts", "platform", "gateway-client"] as const;
type Layer = (typeof layers)[number];

const forbiddenDomainGlobals = new Set([
  "Request",
  "Response",
  "Headers",
  "fetch",
  "window",
  "document",
  "localStorage",
  "sessionStorage",
]);
const allowedDependencies: Record<Layer, readonly Layer[]> = {
  contracts: ["contracts"],
  platform: ["contracts", "platform"],
  "gateway-client": ["contracts", "gateway-client"],
};

const errors: string[] = [];
let checked = 0;

function visitFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return visitFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

for (const layer of layers) {
  for (const path of visitFiles(resolve(packageRoot, layer))) {
    checked++;
    const label = relative(root, path);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );

    function fail(message: string) {
      errors.push(`${label}: ${message}`);
    }

    function checkImport(specifier: string) {
      const target = specifier.startsWith(".")
        ? resolve(dirname(path), specifier)
        : specifier.startsWith("@/")
          ? resolve(root, specifier.slice(2))
          : undefined;

      if (!target) {
        fail(`external import ${specifier} is not allowed in ${layer}`);
        return;
      }

      const targetLayer = relative(packageRoot, target).split(/[\\/]/)[0] as Layer;
      if (!allowedDependencies[layer].includes(targetLayer)) {
        fail(`import ${specifier} crosses the ${layer} boundary`);
      }

      const packageLabel = relative(packageRoot, path).replaceAll("\\", "/");
      const targetLabel = relative(packageRoot, target)
        .replaceAll("\\", "/")
        .replace(/\.(?:ts|tsx)$/, "");
      if (
        packageLabel === "platform/authorization/gateway.ts" &&
        targetLabel.startsWith("contracts/platform/")
      ) {
        fail("Gateway compatibility authorization must not depend on Tenant contracts");
      }
      if (
        packageLabel.startsWith("platform/services/") &&
        targetLabel === "platform/authorization/gateway"
      ) {
        fail("platform services must not consume Gateway compatibility authority");
      }
    }

    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          checkImport(node.moduleSpecifier.text);
        }
      }

      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        checkImport(node.argument.literal.text);
      }

      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        const specifier = node.moduleReference.expression;
        if (specifier && ts.isStringLiteral(specifier)) checkImport(specifier.text);
      }

      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        const specifier = node.arguments[0];
        if (!specifier || !ts.isStringLiteral(specifier)) {
          fail("computed module loading is not allowed");
        } else {
          checkImport(specifier.text);
        }
      }

      if (
        layer !== "gateway-client" &&
        ts.isIdentifier(node) &&
        forbiddenDomainGlobals.has(node.text)
      ) {
        fail(`HTTP/browser identifier ${node.text} is not allowed in ${layer}`);
      }

      if (
        ts.isJsxElement(node) ||
        ts.isJsxSelfClosingElement(node) ||
        ts.isJsxFragment(node)
      ) {
        fail("JSX is not allowed in shared packages");
      }

      ts.forEachChild(node, walk);
    }

    walk(source);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Package boundaries passed for ${checked} files.`);
}
