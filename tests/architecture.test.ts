import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

type Rule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type Violation = {
  rule: Rule;
  file: string;
  line: number;
  // Scanner results always set this; existing baseline entries omit it for zero.
  occurrence?: number;
  detail: string;
  baselineGroup?: "legacy-global-client-call";
};
type ModuleReference = {
  specifier: string;
  node: ts.Node;
  typeOnly: boolean;
};
type SourceRecord = {
  relativePath: string;
  moduleKey: string;
  sourceFile: ts.SourceFile;
  moduleReferences: ModuleReference[];
};
type ArchitectureOptions = { activityWriteAllowlist?: ReadonlySet<string> };
type ArchitectureReport = {
  violations: Violation[];
  activityWrites: string[];
  legacyGlobalClientCalls: Record<string, number>;
};
type SingletonDiscovery = {
  modules: Set<string>;
  exportsByModule: Map<string, ReadonlySet<string>>;
};

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const STRIPPABLE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const EXPLICIT_SINGLETON_MODULES = new Set([
  "src/lib/prisma",
  "src/server/prisma/client"
]);
const MODULE_EDGES: Readonly<Record<string, ReadonlySet<string>>> = {
  planning: new Set(["projects"]),
  focus: new Set(["planning", "projects", "evidence"]),
  evidence: new Set(["planning", "projects"]),
  journal: new Set(["planning", "projects"]),
  review: new Set(["planning", "evidence", "journal", "projects"]),
  projects: new Set(),
  "data-ops": new Set()
};

// Current production ActivityEntry writes. Rule 7 scans src/**, so prisma/seed.ts
// and scripts/** are intentionally excluded instead of allowlisted.
const ACTIVITY_WRITE_ALLOWLIST = new Set([
  "src/modules/evidence/services/activities.ts:120:activityEntry.deleteMany",
  "src/modules/evidence/services/activities.ts:25:activityEntry.create",
  "src/modules/evidence/services/activities.ts:74:activityEntry.updateMany",
  "src/modules/evidence/services/focus-activity.ts:17:activityEntry.upsert",
  "src/modules/evidence/services/focus-activity.ts:40:activityEntry.upsert",
  "src/lib/focus-sessions.ts:268:activityEntry.upsert",
  "src/lib/focus-sessions.ts:373:activityEntry.upsert",
  "src/server/workflows/delete-project.ts:15:activityEntry.updateMany"
]);

// Legacy src/lib call counts are ratcheted per file so line movement is harmless,
// while any increase (or stale decrease) fails the real-tree assertion.
const LEGACY_GLOBAL_CLIENT_CALL_BASELINE = [
  legacyClientCalls("src/lib/focus-sessions.ts", 7, "Phase 3: focus services"),
] as const;

function legacyClientCalls(file: string, count: number, migration: string) {
  return { file, count, migration };
}

// Call-site-specific entries ensure that a second violation in the same file fails.
// Remove each entry with its named migration phase.
const BASELINE: ReadonlyArray<Violation & { migration: string }> = [
  baseline(6, "src/lib/focus-sessions.ts", 181, "Phase 3: focus services"),
  baseline(6, "src/lib/focus-sessions.ts", 265, "Phase 3: focus services"),
  baseline(6, "src/lib/focus-sessions.ts", 348, "Phase 3: focus services"),
  baseline(6, "src/lib/journal-history.ts", 140, "Phase 3: journal services"),
  baseline(6, "src/lib/workspace-readiness.ts", 4, "Phase 3: read models"),
  baseline(8, "src/lib/backup-management.ts", 42, "Phase 4: backup engine")
];

function baseline(rule: Rule, file: string, line: number, migration: string) {
  return { rule, file, line, detail: "known violation", migration };
}

function scanArchitecture(
  root: string,
  options: ArchitectureOptions = {}
): ArchitectureReport {
  const records = collectSources(root);
  const singletonModules = discoverSingletonModules(records);
  const activityWriteAllowlist =
    options.activityWriteAllowlist ?? ACTIVITY_WRITE_ALLOWLIST;
  const violations: Violation[] = [];
  const occurrences = new Map<string, number>();
  const activityWrites: string[] = [];
  const legacyGlobalClientCalls: Record<string, number> = {};
  const add = (
    record: SourceRecord,
    rule: Rule,
    node: ts.Node,
    detail: string,
    baselineGroup?: Violation["baselineGroup"]
  ) => {
    const line = lineOf(record.sourceFile, node);
    const group = `${rule}:${record.relativePath}:${line}`;
    // Sorted files and deterministic AST traversal keep numbering stable per rule.
    const occurrence = occurrences.get(group) ?? 0;
    occurrences.set(group, occurrence + 1);
    violations.push({
      rule,
      file: record.relativePath,
      line,
      occurrence,
      detail,
      baselineGroup
    });
  };

  for (const record of records) {
    const sourceModule = moduleLocation(record.relativePath);
    const domainRoot = domainLocation(record.relativePath);
    const isUi = /^src\/modules\/[^/]+\/ui(?:\/|$)/.test(record.relativePath);
    const isService = /^src\/modules\/[^/]+\/services(?:\/|$)/.test(
      record.relativePath
    );

    for (const reference of record.moduleReferences) {
      const target = internalTarget(record.relativePath, reference.specifier);
      const targetModule = target ? moduleLocation(target) : null;
      if (
        sourceModule &&
        targetModule &&
        sourceModule !== targetModule &&
        !MODULE_EDGES[sourceModule]?.has(targetModule)
      ) {
        add(record, 1, reference.node, `forbidden module edge ${sourceModule} -> ${targetModule}`);
      }

      if (
        sourceModule &&
        target !== null &&
        (target === "src/server" || target.startsWith("src/server/"))
      ) {
        add(record, 1, reference.node, `module ${sourceModule} cannot import server ${reference.specifier}`);
      }

      // Legacy app -> lib/components imports remain valid during migration. Imports
      // into the new modules namespace must use only its domain or ui surface.
      if (record.relativePath.startsWith("src/app/") && targetModule) {
        const layer = target?.split("/")[3];
        if (layer !== "domain" && layer !== "ui") {
          add(
            record,
            1,
            reference.node,
            `app imports non-public module layer ${targetModule}/${layer ?? "<root>"}`
          );
        }
      }

      if (domainRoot) {
        const insideSameDomain =
          target !== null &&
          (target === domainRoot || target.startsWith(`${domainRoot}/`));
        const sharedKernel =
          target === "src/shared/kernel" || target?.startsWith("src/shared/kernel/");
        if (!insideSameDomain && !sharedKernel) {
          add(record, 2, reference.node, `domain imports ${reference.specifier}`);
        }
      }

      if (isUi) {
        const importsModuleServices =
          target !== null && /^src\/modules\/[^/]+\/services(?:\/|$)/.test(target);
        if (
          importsModuleServices ||
          isPrismaPackage(reference.specifier) ||
          isSingletonReference(record, reference, singletonModules) ||
          target === "src/server" ||
          target?.startsWith("src/server/")
        ) {
          add(record, 3, reference.node, `ui imports ${reference.specifier}`);
        }
      }

      if (isService) {
        const importsServer =
          target === "src/server" || target?.startsWith("src/server/");
        const importsForbiddenPrisma =
          isSingletonReference(record, reference, singletonModules) ||
          (isPrismaPackage(reference.specifier) && !reference.typeOnly);
        if (importsServer || importsForbiddenPrisma) {
          add(
            record,
            4,
            reference.node,
            importsServer
              ? `service imports server module ${reference.specifier}`
              : `service imports forbidden Prisma module ${reference.specifier}`
          );
        }
      }

      if (
        record.relativePath.startsWith("src/") &&
        target !== null &&
        (target === "scripts" || target.startsWith("scripts/"))
      ) {
        add(record, 8, reference.node, `src imports ${reference.specifier}`);
      }
    }

    const globalBindings = findGlobalClientBindings(record, singletonModules);
    visit(record.sourceFile, (node) => {
      // Discovery identifies clients for import checks; it does not authorize
      // new client owners beyond the explicitly named singleton modules.
      if (
        record.relativePath.startsWith("src/") &&
        isNewPrismaClient(node) &&
        !EXPLICIT_SINGLETON_MODULES.has(record.moduleKey)
      ) {
        add(record, 4, node, "constructs PrismaClient outside an explicit singleton module");
      }
      if (isService && ts.isCallExpression(node) && callMethod(node) === "$transaction") {
        add(record, 4, node, "service opens a transaction");
      }
      if (
        ts.isCallExpression(node) &&
        globalBindings.size > 0 &&
        callUsesGlobalClient(node, globalBindings) &&
        !singletonModules.modules.has(record.moduleKey) &&
        record.relativePath !== "src/lib/idempotent-mutations.ts" &&
        (isService || record.relativePath.startsWith("src/lib/"))
      ) {
        const legacy = record.relativePath.startsWith("src/lib/");
        if (legacy) {
          legacyGlobalClientCalls[record.relativePath] =
            (legacyGlobalClientCalls[record.relativePath] ?? 0) + 1;
        }
        add(
          record,
          4,
          node,
          `calls through the global Prisma client: ${node.expression.getText(record.sourceFile)}`,
          legacy ? "legacy-global-client-call" : undefined
        );
      }
      if (
        record.relativePath.startsWith("src/") &&
        ts.isCallExpression(node) &&
        callMethod(node) === "$transaction" &&
        !isAllowedTransactionRoot(record.relativePath)
      ) {
        add(record, 6, node, "transaction root is not allowlisted");
      }
      if (record.relativePath.startsWith("src/") && ts.isCallExpression(node)) {
        const activityMethod = activityWriteMethod(node);
        if (activityMethod) {
          const key = `${record.relativePath}:${lineOf(record.sourceFile, node)}:${activityMethod}`;
          activityWrites.push(key);
          if (!activityWriteAllowlist.has(key)) {
            add(record, 7, node, `${activityMethod} is not allowlisted`);
          }
        }
      }
      if (
        record.relativePath.startsWith("src/") &&
        isStringLike(node)
      ) {
        const operation = activitySqlWriteOperation(nodeText(node));
        if (!operation) return;
        const key = `${record.relativePath}:${lineOf(record.sourceFile, node)}:SQL ${operation} ActivityEntry`;
        activityWrites.push(key);
        if (!activityWriteAllowlist.has(key)) {
          add(record, 7, node, `SQL ${operation} ActivityEntry is not allowlisted`);
        }
      }
    });

    if (record.relativePath.startsWith("src/") && globalBindings.size > 0) {
      findGlobalClientParameterFallbacks(record, globalBindings, (node, detail) =>
        add(record, 5, node, detail)
      );
    }
  }
  return {
    violations: violations.sort(compareViolations),
    activityWrites: activityWrites.sort(),
    legacyGlobalClientCalls
  };
}

function checkArchitecture(root: string, options: ArchitectureOptions = {}) {
  return scanArchitecture(root, options).violations;
}

function collectSources(root: string): SourceRecord[] {
  const files: string[] = [];
  for (const topLevel of ["src", "scripts"]) collectDirectory(join(root, topLevel), files);
  return files.sort().map((absolutePath) => {
    const relativePath = toPosix(relative(root, absolutePath));
    const sourceFile = ts.createSourceFile(
      relativePath,
      readFileSync(absolutePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      relativePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    return {
      relativePath,
      moduleKey: stripExtension(relativePath),
      sourceFile,
      moduleReferences: collectModuleReferences(sourceFile)
    };
  });
}

function collectDirectory(directory: string, files: string[]) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectDirectory(path, files);
    else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) files.push(path);
  }
}

function collectModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  visit(sourceFile, (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        specifier: node.moduleSpecifier.text,
        node: node.moduleSpecifier,
        typeOnly: moduleReferenceIsTypeOnly(node)
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      references.push({
        specifier: node.moduleReference.expression.text,
        node: node.moduleReference.expression,
        typeOnly: node.isTypeOnly
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.push({
        specifier: node.argument.literal.text,
        node: node.argument.literal,
        // Both import("pkg").Type and typeof import("pkg") are erased types.
        typeOnly: true
      });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      references.push({ specifier: node.arguments[0].text, node, typeOnly: false });
    }
  });
  return references;
}

function moduleReferenceIsTypeOnly(
  node: ts.ImportDeclaration | ts.ExportDeclaration
) {
  if (ts.isExportDeclaration(node)) {
    return (
      node.isTypeOnly ||
      (node.exportClause !== undefined &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 &&
        node.exportClause.elements.every((element) => element.isTypeOnly))
    );
  }
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return false;
  }
  return (
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function discoverSingletonModules(records: SourceRecord[]): SingletonDiscovery {
  const base: SingletonDiscovery = {
    modules: new Set(),
    exportsByModule: new Map()
  };
  for (const moduleKey of EXPLICIT_SINGLETON_MODULES) {
    addSingletonModule(base, moduleKey, new Set(["prisma", "getPrisma"]));
  }
  for (const record of records) {
    if (containsNewPrismaClient(record.sourceFile)) {
      addSingletonModule(
        base,
        record.moduleKey,
        exportedNewPrismaClientBindings(record.sourceFile)
      );
    }
  }

  // Deliberately freeze the source set: barrels get one hop from explicit/direct
  // client modules, but a barrel of a barrel does not create a transitive closure.
  const discovered: SingletonDiscovery = {
    modules: new Set(base.modules),
    exportsByModule: new Map(base.exportsByModule)
  };
  for (const record of records) {
    if (base.modules.has(record.moduleKey)) continue;
    const names = oneHopSingletonExports(record, base);
    if (names.size > 0) {
      addSingletonModule(discovered, record.moduleKey, names);
    }
  }
  return discovered;
}

function addSingletonModule(
  discovery: SingletonDiscovery,
  moduleKey: string,
  exportNames: ReadonlySet<string>
) {
  const keys = [moduleKey];
  if (posix.basename(moduleKey) === "index") keys.push(posix.dirname(moduleKey));
  for (const key of keys) {
    discovery.modules.add(key);
    discovery.exportsByModule.set(key, new Set(exportNames));
  }
}

function isNewPrismaClient(node: ts.Node) {
  return (
    ts.isNewExpression(node) &&
    ((ts.isIdentifier(node.expression) && node.expression.text === "PrismaClient") ||
      (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "PrismaClient"))
  );
}

function containsNewPrismaClient(node: ts.Node) {
  let found = false;
  visit(node, (child) => {
    if (isNewPrismaClient(child)) found = true;
  });
  return found;
}

function exportedNewPrismaClientBindings(sourceFile: ts.SourceFile) {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          containsNewPrismaClient(declaration.initializer)
        ) names.add(declaration.name.text);
      }
    }
  }
  return names;
}

function oneHopSingletonExports(
  record: SourceRecord,
  base: SingletonDiscovery
) {
  const exportedNames = new Set<string>();
  const importedBindings = new Set<string>();

  for (const statement of record.sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      const targetKey = singletonTargetKey(
        record.relativePath,
        statement.moduleSpecifier.text,
        base
      );
      if (!targetKey) continue;
      const available = base.exportsByModule.get(targetKey) ?? new Set<string>();
      const named = statement.importClause.namedBindings;
      if (statement.importClause.name && available.has("default")) {
        importedBindings.add(statement.importClause.name.text);
      }
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (available.has(importedName)) importedBindings.add(element.name.text);
        }
      } else if (named && ts.isNamespaceImport(named)) {
        for (const exportName of available) {
          importedBindings.add(`${named.name.text}.${exportName}`);
        }
      }
    }
  }

  for (const statement of record.sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const targetKey = singletonTargetKey(
          record.relativePath,
          statement.moduleSpecifier.text,
          base
        );
        if (!targetKey) continue;
        const available = base.exportsByModule.get(targetKey) ?? new Set<string>();
        if (!statement.exportClause) {
          for (const name of available) exportedNames.add(name);
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (available.has(importedName)) exportedNames.add(element.name.text);
          }
        }
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text;
          if (importedBindings.has(localName)) exportedNames.add(element.name.text);
        }
      }
    } else if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          expressionIsGlobalBinding(declaration.initializer, importedBindings)
        ) exportedNames.add(declaration.name.text);
      }
    }
  }
  return exportedNames;
}

function expressionIsGlobalBinding(
  expression: ts.Expression,
  bindings: ReadonlySet<string>
) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) return bindings.has(current.text);
  if (ts.isPropertyAccessExpression(current)) {
    return bindings.has(`${current.expression.getText()}.${current.name.text}`);
  }
  return false;
}

function isSingletonReference(
  record: SourceRecord,
  reference: ModuleReference,
  singletonModules: SingletonDiscovery
) {
  return singletonTargetKey(
    record.relativePath,
    reference.specifier,
    singletonModules
  ) !== null;
}

function singletonTargetKey(
  fromFile: string,
  specifier: string,
  singletonModules: SingletonDiscovery
) {
  const target = internalTarget(fromFile, specifier);
  if (target === null) return null;
  const key = stripExtension(target);
  return singletonModules.modules.has(key) ? key : null;
}

function findGlobalClientBindings(
  record: SourceRecord,
  singletonModules: SingletonDiscovery
) {
  const bindings = new Set<string>();
  for (const statement of record.sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) continue;
    const targetKey = singletonTargetKey(
      record.relativePath,
      statement.moduleSpecifier.text,
      singletonModules
    );
    if (!targetKey) continue;
    const available = singletonModules.exportsByModule.get(targetKey) ?? new Set<string>();
    if (statement.importClause.name && available.has("default")) {
      bindings.add(statement.importClause.name.text);
    }
    const named = statement.importClause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (available.has(importedName)) bindings.add(element.name.text);
      }
    } else if (named && ts.isNamespaceImport(named)) {
      for (const exportName of available) {
        bindings.add(`${named.name.text}.${exportName}`);
      }
    }
  }
  return bindings;
}

function findGlobalClientParameterFallbacks(
  record: SourceRecord,
  globalBindings: ReadonlySet<string>,
  add: (node: ts.Node, detail: string) => void
) {
  const inspect = (
    node: ts.Node,
    parameterNames: ReadonlySet<string>,
    visibleGlobals: ReadonlySet<string>
  ) => {
    if (isFunctionLike(node)) {
      if (!node.body) return;
      const ownParameters = new Set<string>();
      for (const parameter of node.parameters) {
        collectBindingNames(parameter.name, ownParameters);
      }
      // A shadowing parameter is still a parameter, but a shadowed imported
      // client (including a namespace root) is no longer global in this scope.
      const nestedParameters = new Set([...parameterNames, ...ownParameters]);
      const nestedGlobals = new Set(
        [...visibleGlobals].filter((binding) => !ownParameters.has(binding.split(".")[0]))
      );
      for (const parameter of node.parameters) {
        if (
          parameter.initializer &&
          expressionContainsGlobal(parameter.initializer, nestedGlobals)
        ) add(parameter, "function parameter defaults to the global Prisma client");
      }
      ts.forEachChild(node, (child) => inspect(child, nestedParameters, nestedGlobals));
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) &&
      expressionContainsGlobal(node.right, visibleGlobals) &&
      expressionReferencesParameter(node.left, parameterNames)
    ) add(node, "function parameter falls back to the global Prisma client");
    ts.forEachChild(node, (child) => inspect(child, parameterNames, visibleGlobals));
  };
  inspect(record.sourceFile, new Set(), globalBindings);
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function collectBindingNames(name: ts.BindingName, names: Set<string>) {
  if (ts.isIdentifier(name)) names.add(name.text);
  else for (const element of name.elements) {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, names);
  }
}

function expressionContainsGlobal(expression: ts.Expression, bindings: ReadonlySet<string>) {
  let found = false;
  visit(expression, (node) => {
    if (ts.isIdentifier(node) && bindings.has(node.text)) found = true;
    if (
      ts.isPropertyAccessExpression(node) &&
      bindings.has(`${node.expression.getText()}.${node.name.text}`)
    ) found = true;
  });
  return found;
}

function expressionReferencesParameter(expression: ts.Expression, names: ReadonlySet<string>) {
  let found = false;
  visit(expression, (node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) found = true;
  });
  return found;
}

function callUsesGlobalClient(
  call: ts.CallExpression,
  bindings: ReadonlySet<string>
) {
  if (
    !ts.isPropertyAccessExpression(call.expression) &&
    !ts.isElementAccessExpression(call.expression)
  ) return false;
  const callee = call.expression.getText();
  for (const binding of bindings) {
    if (
      callee.startsWith(`${binding}.`) ||
      callee.startsWith(`${binding}[`) ||
      callee.startsWith(`${binding}?.`)
    ) return true;
  }
  return false;
}

function isAllowedTransactionRoot(file: string) {
  return (
    file.startsWith("src/app/api/") ||
    file.startsWith("src/server/") ||
    file === "src/lib/idempotent-mutations.ts"
  );
}

function activityWriteMethod(call: ts.CallExpression): string | null {
  const method = callMethod(call);
  if (
    !method ||
    !["create", "upsert", "createMany", "update", "updateMany", "delete", "deleteMany"].includes(method)
  ) return null;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return null;
  const target = ts.isIdentifier(callee.expression)
    ? callee.expression.text
    : propertyName(callee.expression);
  return target === "activityEntry" ? `activityEntry.${method}` : null;
}

function callMethod(call: ts.CallExpression) {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  return propertyName(call.expression);
}

function propertyName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) return expression.argumentExpression.text;
  return null;
}

function isStringLike(node: ts.Node): node is ts.StringLiteralLike | ts.TemplateExpression {
  return ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);
}

function nodeText(node: ts.StringLiteralLike | ts.TemplateExpression) {
  return ts.isStringLiteralLike(node) ? node.text : node.getText();
}

function activitySqlWriteOperation(sql: string): "INSERT INTO" | "UPDATE" | "DELETE FROM" | null {
  // A schema may be bare, double-quoted, bracketed, or backtick-quoted.
  // Double quotes and backticks escape themselves by doubling.
  const schema = /(?:[a-z_\u0080-\uffff][\w$\u0080-\uffff]*|"(?:[^"]|"")+"|\[[^\]]+\]|`(?:[^`]|``)+`)/.source;
  // Retain single-quoted tables too, but require the whole identifier to match.
  // The dot check prevents treating an ActivityEntry schema as the target table.
  const table = /(?:"ActivityEntry"|\[ActivityEntry\]|`ActivityEntry`|'ActivityEntry'|ActivityEntry)(?![\w$\u0080-\uffff"'`\]])(?!\s*\.)/.source;
  const match = new RegExp(
    `\\b(insert(?:\\s+or\\s+(?:ignore|replace))?\\s+into|update|delete\\s+from)\\s+(?:${schema}\\s*\\.\\s*)?${table}`,
    "i"
  ).exec(sql);
  if (!match) return null;
  const operation = match[1].toUpperCase();
  if (operation === "UPDATE") return "UPDATE";
  return operation.startsWith("DELETE") ? "DELETE FROM" : "INSERT INTO";
}

function isPrismaPackage(specifier: string) {
  return specifier === "@prisma/client" || specifier.startsWith("@prisma/client/");
}

function moduleLocation(file: string) {
  return /^src\/modules\/([^/]+)(?:\/|$)/.exec(file)?.[1] ?? null;
}

function domainLocation(file: string) {
  return /^(src\/modules\/[^/]+\/domain)(?:\/|$)/.exec(file)?.[1] ?? null;
}

function internalTarget(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return posix.normalize(`src/${specifier.slice(2)}`);
  if (specifier.startsWith("src/") || specifier.startsWith("scripts/")) return posix.normalize(specifier);
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  return null;
}

function stripExtension(path: string) {
  return path.replace(STRIPPABLE_EXTENSION, "");
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function visit(node: ts.Node, inspect: (node: ts.Node) => void) {
  inspect(node);
  ts.forEachChild(node, (child) => visit(child, inspect));
}

function toPosix(path: string) {
  return path.split("\\").join("/");
}

function compareViolations(left: Violation, right: Violation) {
  return (
    left.rule - right.rule ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    (left.occurrence ?? 0) - (right.occurrence ?? 0) ||
    left.detail.localeCompare(right.detail)
  );
}

function violationKey(violation: Pick<Violation, "rule" | "file" | "line" | "occurrence">) {
  return `${violation.rule}:${violation.file}:${violation.line}:${violation.occurrence ?? 0}`;
}

function withFixture(files: Record<string, string>, run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "dayflow-architecture-"));
  try {
    for (const [file, source] of Object.entries(files)) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function locations(root: string, rule: Rule, options?: ArchitectureOptions) {
  return checkArchitecture(root, options)
    .filter((violation) => violation.rule === rule)
    .map(({ file, line }) => `${file}:${line}`);
}

test("Rule 1: module imports follow the directed graph", () => {
  withFixture(
    {
      "src/modules/planning/application/pass.ts": 'import "@/modules/projects/application/index";\n',
      "src/modules/projects/application/fail.ts": 'import "@/modules/review/application/index";\n',
      "src/server/workflows/pass.ts": 'import "@/modules/review/application/index";\n'
    },
    (root) => assert.deepEqual(locations(root, 1), ["src/modules/projects/application/fail.ts:1"])
  );
});

test("Rule 1: app imports only public module layers", () => {
  withFixture(
    {
      "src/app/pass.ts": [
        'import "@/server/http";',
        'import "@/shared/kernel/errors";',
        'import "@/modules/planning/domain/task";',
        'import "@/modules/planning/ui/task";'
      ].join("\n"),
      "src/app/fail.ts": 'import "@/modules/planning/services/task";\n'
    },
    (root) => assert.deepEqual(locations(root, 1), ["src/app/fail.ts:1"])
  );
});

test("Rule 2: domain imports only its own domain and shared kernel", () => {
  withFixture(
    {
      "src/modules/planning/domain/pass.ts": [
        'import "./value";',
        'import "@/modules/planning/domain/aliased-value";',
        'import "@/shared/kernel/errors";'
      ].join("\n"),
      "src/modules/planning/domain/fail.ts": 'import React from "react";\n'
    },
    (root) => assert.deepEqual(locations(root, 2), ["src/modules/planning/domain/fail.ts:1"])
  );
});

test("Rule 3: ui does not reach services, Prisma, or server", () => {
  withFixture(
    {
      "src/modules/planning/ui/pass.ts": 'import "../domain/task";\n',
      "src/modules/planning/ui/pass-external.ts": 'import "@acme/services/client";\n',
      "src/modules/planning/ui/fail-services.ts": 'import "../services/save-task";\n',
      "src/modules/planning/ui/fail-prisma.ts": 'import type { Prisma } from "@prisma/client/runtime/library";\n',
      "src/modules/planning/ui/fail-server.ts": 'import "@/server/http";\n'
    },
    (root) => assert.deepEqual(locations(root, 3), [
      "src/modules/planning/ui/fail-prisma.ts:1",
      "src/modules/planning/ui/fail-server.ts:1",
      "src/modules/planning/ui/fail-services.ts:1"
    ])
  );
});

for (const [layer, rule] of [["domain", 2], ["ui", 3]] as const) {
  for (const source of [
    'type DB = import("@prisma/client").PrismaClient;',
    'type DB = typeof import("@prisma/client");',
    'function nested() { return () => { type DB = { client: Promise<import("@prisma/client").PrismaClient> }; }; }'
  ]) {
    test(`Rule ${rule}: import type nodes in ${layer}: ${source}`, () => {
      const file = `src/modules/planning/${layer}/types.ts`;
      withFixture({ [file]: source }, (root) => {
        assert.deepEqual(locations(root, rule), [`${file}:1`]);
      });
    });
  }
}

test("Import type nodes preserve permitted type-only dependencies", () => {
  withFixture(
    {
      "src/modules/planning/services/types.ts": [
        'import type { Prisma } from "@prisma/client";',
        'type Tx = import("@prisma/client").Prisma.TransactionClient;',
        'type DB = typeof import("@prisma/client");',
        'type Runtime = typeof import("@prisma/client/runtime/library");'
      ].join("\n"),
      "src/modules/planning/domain/types.ts": [
        'type Task = import("./task").Task;',
        'type Error = import("@/shared/kernel/errors").DomainError;'
      ].join("\n"),
      "src/modules/planning/ui/types.ts": 'type Task = import("../domain/task").Task;'
    },
    (root) => assert.deepEqual(checkArchitecture(root), [])
  );
});

test("Import type nodes enforce module, singleton, server, and script boundaries", () => {
  withFixture(
    {
      "src/modules/projects/application/types.ts": 'type T = import("@/modules/review/domain/types").T;',
      "src/app/types.ts": 'type T = import("@/modules/planning/services/types").T;',
      "src/modules/planning/services/client.ts": 'type T = typeof import("@/lib/prisma");',
      "src/modules/planning/services/server.ts": 'type T = typeof import("@/server/http");',
      "src/types.ts": 'type T = typeof import("../scripts/task");'
    },
    (root) => assert.deepEqual(
      checkArchitecture(root).map(({ rule, file }) => ({ rule, file })),
      [
        { rule: 1, file: "src/app/types.ts" },
        { rule: 1, file: "src/modules/planning/services/server.ts" },
        { rule: 1, file: "src/modules/projects/application/types.ts" },
        { rule: 4, file: "src/modules/planning/services/client.ts" },
        { rule: 4, file: "src/modules/planning/services/server.ts" },
        { rule: 8, file: "src/types.ts" }
      ]
    )
  );
});

test("Rule 4: services neither import the singleton nor open transactions", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/modules/planning/services/pass.ts": "export async function pass(repository: { save(): Promise<void> }) { await repository.save(); }\n",
      "src/modules/planning/services/fail-import.ts": 'import { prisma } from "@/lib/prisma"; void prisma;\n',
      "src/modules/planning/services/fail-prisma-subpath.ts": 'import { PrismaClient } from "@prisma/client/runtime/library"; void PrismaClient;\n',
      "src/modules/planning/services/fail-transaction.ts": "export async function fail(database: any) { await database.$transaction(() => null); }\n"
    },
    (root) => assert.deepEqual(locations(root, 4), [
      "src/modules/planning/services/fail-import.ts:1",
      "src/modules/planning/services/fail-prisma-subpath.ts:1",
      "src/modules/planning/services/fail-transaction.ts:1"
    ])
  );
});

test("Rule 4: stray PrismaClient construction is actionable without legacy calls", () => {
  withFixture(
    {
      "src/lib/stray.ts": [
        'import { PrismaClient } from "@prisma/client";',
        "const database = new PrismaClient();",
        "export const list = () => database.task.findMany();"
      ].join("\n"),
      "src/lib/exported.ts": 'export const database = new PrismaClient();\n',
      "src/lib/namespace.ts": 'import * as Prisma from "@prisma/client";\nconst database = new Prisma.PrismaClient();\n',
      "src/app/stray.ts": "const database = new PrismaClient();\n",
      "src/modules/planning/services/stray.ts": "const database = new PrismaClient();\n",
      "src/server/stray.ts": "const database = new PrismaClient();\n"
    },
    (root) => {
      const report = scanArchitecture(root);
      assert.deepEqual(report.legacyGlobalClientCalls, {});
      assert.deepEqual(
        report.violations.map(({ rule, file, line, baselineGroup }) => ({ rule, file, line, baselineGroup })),
        [
          ["src/app/stray.ts", 1],
          ["src/lib/exported.ts", 1],
          ["src/lib/namespace.ts", 2],
          ["src/lib/stray.ts", 2],
          ["src/modules/planning/services/stray.ts", 1],
          ["src/server/stray.ts", 1]
        ].map(([file, line]) => ({ rule: 4, file, line, baselineGroup: undefined }))
      );
      assert.ok(report.violations.every(({ detail }) => detail.includes("constructs PrismaClient")));
    }
  );
});

test("Rule 4: canonical clients, scripts, and tests may construct PrismaClient", () => {
  const source = 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n';
  withFixture(
    {
      ...Object.fromEntries([...EXPLICIT_SINGLETON_MODULES].map((key) => [`${key}.ts`, source])),
      "scripts/database.ts": source,
      "tests/database.test.ts": source,
      "src/lib/unrelated.ts": "const client = new OtherClient();\n",
      "src/lib/prisma-barrel.ts": 'export { prisma } from "@/lib/prisma";\n'
    },
    (root) => assert.deepEqual(checkArchitecture(root), [])
  );
});

test("Rule 4: singleton detection is limited to an explicit one-hop re-export", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/lib/legacy-projects.ts": 'import { prisma } from "@/lib/prisma"; export function validateProjectPlacement() { return "ok"; } void prisma;\n',
      "src/lib/prisma-barrel.ts": 'export { prisma as db } from "@/lib/prisma";\n',
      "src/lib/prisma-barrel-2.ts": 'export { db as client } from "@/lib/prisma-barrel";\n',
      "src/modules/planning/services/pass.ts": 'import { validateProjectPlacement } from "@/lib/legacy-projects"; void validateProjectPlacement;\n',
      "src/modules/planning/services/two-hop.ts": 'import { client } from "@/lib/prisma-barrel-2"; void client;\n',
      "src/modules/planning/services/fail.ts": 'import { db } from "@/lib/prisma-barrel"; void db;\n'
    },
    (root) => assert.deepEqual(locations(root, 4), [
      "src/modules/planning/services/fail.ts:1"
    ])
  );
});

test("Rule 4: services allow Prisma type imports but reject Prisma values", () => {
  withFixture(
    {
      "src/modules/planning/services/pass-type.ts":
        'import type { Prisma } from "@prisma/client"; export async function pass(_tx: Prisma.TransactionClient) {}\n',
      "src/modules/planning/services/fail-value.ts":
        'import { PrismaClient } from "@prisma/client/runtime/library"; void PrismaClient;\n'
    },
    (root) => assert.deepEqual(locations(root, 4), [
      "src/modules/planning/services/fail-value.ts:1"
    ])
  );
});

test("Rule 4: services cannot import server modules", () => {
  withFixture(
    {
      "src/modules/planning/services/pass.ts": 'import type { Task } from "../domain/task"; void (0 as unknown as Task);\n',
      "src/modules/planning/services/fail.ts": 'import { database } from "@/server/database"; void database;\n'
    },
    (root) => assert.deepEqual(locations(root, 4), [
      "src/modules/planning/services/fail.ts:1"
    ])
  );
});

test("Rule 4: services cannot call through the global client binding", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/modules/planning/services/pass.ts": 'export function pass(tx: any) { return tx.task.findMany(); }\n',
      "src/modules/planning/services/fail.ts": 'import { prisma } from "@/lib/prisma"; export function fail() { return prisma.task.findMany(); }\n'
    },
    (root) => assert.deepEqual(
      checkArchitecture(root)
        .filter((violation) => violation.rule === 4 && violation.detail.includes("calls through"))
        .map(({ file, line }) => `${file}:${line}`),
      ["src/modules/planning/services/fail.ts:1"]
    )
  );
});

test("Rule 4: a concise-arrow service call through the global client is counted", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/modules/planning/services/fail.ts": 'import { prisma } from "@/lib/prisma"; export const list = () => prisma.task.findMany();\n'
    },
    (root) => assert.deepEqual(
      checkArchitecture(root)
        .filter((violation) => violation.rule === 4 && violation.detail.includes("calls through"))
        .map(({ file, line }) => `${file}:${line}`),
      ["src/modules/planning/services/fail.ts:1"]
    )
  );
});

test("Rule 4: src/lib global-client use is counted per file; modules are per site", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/lib/counted.ts": 'import { prisma } from "@/lib/prisma"; export function a() { return prisma.task.findMany(); } export function b() { return prisma.task.findMany(); }\n',
      "src/modules/planning/services/two.ts": 'import { prisma } from "@/lib/prisma"; export function a() { return prisma.task.findMany(); } export function b() { return prisma.task.findMany(); }\n'
    },
    (root) => {
      const report = scanArchitecture(root);
      assert.equal(report.legacyGlobalClientCalls["src/lib/counted.ts"], 2);
      assert.equal(
        report.legacyGlobalClientCalls["src/modules/planning/services/two.ts"],
        undefined
      );
      assert.equal(
        report.violations.filter(
          (violation) =>
            violation.rule === 4 &&
            violation.file === "src/modules/planning/services/two.ts" &&
            violation.detail.includes("calls through")
        ).length,
        2
      );
    }
  );
});

test("Rule 5: parameters do not default or fall back to the singleton", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/pass.ts": "const local = {}; export function pass(client = local) { return client; }\n",
      "src/fail-default.ts": 'import { prisma } from "@/lib/prisma"; export function fail(client = prisma) { return client; }\n',
      "src/fail-fallback.ts": 'import { prisma } from "@/lib/prisma"; export function fail(client?: object) { return client ?? prisma; }\n',
      "src/fail-or.ts": 'import { prisma as globalClient } from "@/lib/prisma"; export function fail(client?: object) { return client || globalClient; }\n'
    },
    (root) => assert.deepEqual(locations(root, 5), [
      "src/fail-default.ts:1",
      "src/fail-fallback.ts:1",
      "src/fail-or.ts:1"
    ])
  );
});

for (const body of [
  "return () => tx ?? prisma;",
  "return function () { return tx || prisma; };",
  "function inner() { return tx ?? prisma; } return inner;",
  "return { inner() { return tx ?? prisma; } };",
  "return () => function () { return { inner() { function deepest() { return tx ?? prisma; } return deepest; } }; };",
  "return () => () => { tx ??= prisma; };",
  "return () => () => { tx ||= prisma; };",
  "return () => class { constructor() { tx ??= prisma; } };",
  "return { get client() { return tx ?? prisma; } };",
  "return { set client(value: Tx) { tx ||= prisma; } };"
]) {
  test(`Rule 5: nested closures retain outer parameters: ${body}`, () => {
    withFixture(
      { "src/nested.ts": `import { prisma } from "@/lib/prisma"; function run(tx?: Tx) { ${body} }` },
      (root) => assert.deepEqual(locations(root, 5), ["src/nested.ts:1"])
    );
  });
}

test("Rule 5: nested parameter shadowing does not invent a global fallback", () => {
  withFixture(
    {
      "src/shadow.ts": [
        'import { prisma } from "@/lib/prisma";',
        'function run(tx?: Tx) {',
        '  const a = (prisma: Tx) => () => tx ?? prisma;',
        '  const b = function (prisma: Tx) { return tx || prisma; };',
        '  function c(prisma: Tx) { return { inner() { return tx ?? prisma; } }; }',
        '  const d = { inner({ prisma }: { prisma: Tx }) { return tx ?? prisma; } };',
        '  const e = (tx: Tx) => tx ?? localClient;',
        '  return [a, b, c, d, e];',
        '}'
      ].join("\n"),
      "src/shadow-namespace.ts": 'import * as db from "@/lib/prisma"; function run(tx?: Tx) { return (db: Local) => () => tx ?? db.prisma; }'
    },
    (root) => assert.deepEqual(checkArchitecture(root), [])
  );
});

test("Rule 5: a shadowing inner transaction parameter is checked once in its own scope", () => {
  withFixture(
    {
      "src/shadow.ts": [
        'import { prisma } from "@/lib/prisma";',
        'function run(tx?: Tx) {',
        '  const safe = (prisma: Tx) => tx ?? prisma;',
        '  const unsafe = (tx?: Tx) => () => tx ?? prisma;',
        '  return [safe, unsafe];',
        '}'
      ].join("\n")
    },
    (root) => assert.deepEqual(locations(root, 5), ["src/shadow.ts:4"])
  );
});

test("Rule 6: transaction roots are confined to their allowlisted directories", () => {
  withFixture(
    {
      "src/app/api/pass/route.ts": "export async function pass(database: any) { return database.$transaction(() => null); }\n",
      "src/lib/fail.ts": "export async function fail(database: any) { return database.$transaction(() => null); }\n"
    },
    (root) => assert.deepEqual(locations(root, 6), ["src/lib/fail.ts:1"])
  );
});

test("Baseline identity: a second same-line transaction remains actionable", () => {
  const file = "src/lib/transactions.ts";
  const known = baseline(6, file, 1, "fixture migration");
  withFixture(
    { [file]: "database.$transaction(() => null); database.$transaction(() => null);\n" },
    (root) => {
      const report = scanArchitecture(root);
      const baselineByKey = new Map([[violationKey(known), known]]);
      const actionable = report.violations.filter((entry) => !baselineByKey.has(violationKey(entry)));
      assert.equal(report.violations.length, 2);
      assert.equal(actionable.length, 1);
      assert.deepEqual(report.violations.map(violationKey), [`6:${file}:1:0`, `6:${file}:1:1`]);
      assert.equal(violationKey(known), `6:${file}:1:0`);
      assert.equal(violationKey(actionable[0]), `6:${file}:1:1`);
      assert.deepEqual(report.legacyGlobalClientCalls, {});
      const secondKnown = { ...known, occurrence: 1 };
      assert.equal(violationKey(secondKnown), violationKey(actionable[0]));
    }
  );
});

test("Baseline identity: another rule on the same line does not shift occurrences", () => {
  const file = "src/lib/transactions.ts";
  const source = "database.$transaction(() => null); database.$transaction(() => null);\n";
  withFixture({ [file]: source }, (root) => {
    const before = checkArchitecture(root).map(violationKey);
    writeFileSync(join(root, file), 'import "../../scripts/helper"; ' + source);
    const after = checkArchitecture(root);
    assert.deepEqual(after.filter(({ rule }) => rule === 6).map(violationKey), before);
    assert.deepEqual(after.filter(({ rule }) => rule === 8).map(violationKey), [`8:${file}:1:0`]);
    assert.equal(before[0], violationKey(baseline(6, file, 1, "fixture migration")));
  });
});

test("Baseline identity: removing a transaction makes its baseline stale", () => {
  const file = "src/lib/transactions.ts";
  const entries = [baseline(6, file, 1, "fixture migration")];
  withFixture({ [file]: "database.$transaction(() => null);\n" }, (root) => {
    const staleEntries = () => {
      const actualByKey = new Map(checkArchitecture(root).map((entry) => [violationKey(entry), entry]));
      return entries.filter((entry) => !actualByKey.has(violationKey(entry)));
    };
    assert.deepEqual(staleEntries(), []);
    writeFileSync(join(root, file), "export const removed = true;\n");
    assert.deepEqual(staleEntries(), entries);
  });
});

for (const verb of ["UPDATE", "INSERT INTO", "INSERT OR IGNORE INTO", "INSERT OR REPLACE INTO", "DELETE FROM"]) {
  test(`Rule 7: qualified ${verb} matches schema and table quoting variants`, () => {
    const schemas = ["main", '"ma""in"', "[main schema]", "`ma``in`"];
    const tables = ["ActivityEntry", '"ActivityEntry"', "[ActivityEntry]", "`ActivityEntry`", "'ActivityEntry'"];
    const files: Record<string, string> = {};
    for (const [schemaIndex, schema] of schemas.entries()) {
      for (const [tableIndex, table] of tables.entries()) {
        const tail = verb === "DELETE FROM" ? " WHERE id = 1" : verb === "UPDATE" ? " SET id = 1" : " (id) VALUES (1)";
        const sql = `${verb.toLowerCase().replaceAll(" ", "\t")} ${schema} \n.\t ${table}${tail}`;
        files[`src/write-${schemaIndex}-${tableIndex}.ts`] = `export const sql = ${JSON.stringify(sql)};\n`;
      }
    }
    // Include the exact qualified spelling from the report and an unqualified control.
    const tail = verb === "DELETE FROM" ? " WHERE id = 1" : verb === "UPDATE" ? " SET id = 1" : " (id) VALUES (1)";
    files["src/exact.ts"] = `export const sql = ${JSON.stringify(`${verb} main."ActivityEntry"${tail}`)};\n`;
    files["src/control.ts"] = `export const sql = ${JSON.stringify(`${verb} "ActivityEntry"${tail}`)};\n`;
    withFixture(files, (root) => {
      const report = scanArchitecture(root);
      const operation = verb.startsWith("INSERT") ? "INSERT INTO" : verb;
      assert.deepEqual(
        report.activityWrites,
        Object.keys(files).map((file) => `${file}:1:SQL ${operation} ActivityEntry`).sort()
      );
      assert.deepEqual(
        report.violations.map(({ rule, file, detail }) => ({ rule, file, detail })),
        Object.keys(files).sort().map((file) => ({
          rule: 7, file, detail: `SQL ${operation} ActivityEntry is not allowlisted`
        }))
      );
    });
  });
}

test("Rule 7: qualified writes retain the existing allowlist key spelling", () => {
  const activityWriteAllowlist = new Set([
    "src/delete.ts:1:SQL DELETE FROM ActivityEntry",
    "src/insert.ts:1:SQL INSERT INTO ActivityEntry",
    "src/update.ts:1:SQL UPDATE ActivityEntry"
  ]);
  withFixture(
    {
      "src/delete.ts": 'export const sql = `DELETE FROM "main" . [ActivityEntry] WHERE id = 1`;\n',
      "src/insert.ts": 'export const sql = `INSERT OR IGNORE INTO main."ActivityEntry" (id) VALUES (1)`;\n',
      "src/update.ts": 'export const sql = `UPDATE "main" . [ActivityEntry] SET id = 1`;\n'
    },
    (root) => {
      const report = scanArchitecture(root, { activityWriteAllowlist });
      assert.deepEqual(report.violations, []);
      assert.deepEqual(report.activityWrites, [...activityWriteAllowlist].sort());
    }
  );
});

test("Rule 7: SQL operation comes from the same Activity write match", () => {
  withFixture(
    {
      "src/write.ts": 'export const sql = `INSERT INTO main."ActivityEntry" (id) VALUES (1); UPDATE "ActivityEntry" SET id = 2`;\n'
    },
    (root) => assert.deepEqual(scanArchitecture(root).activityWrites, [
      "src/write.ts:1:SQL INSERT INTO ActivityEntry"
    ])
  );
});

test("Rule 7: unrelated and suffixed SQL table names do not match", () => {
  const tables = [
    "Task", "ActivityEntryArchive", "ActivityEntry_backup", "ActivityEntry$archive", "ActivityEntryé",
    '"ActivityEntryArchive"', '"ActivityEntry archive"', '"ActivityEntry""archive"',
    "[ActivityEntryArchive]", "`ActivityEntryArchive`", "`ActivityEntry``archive`", "'ActivityEntryArchive'"
  ];
  const files: Record<string, string> = {};
  for (const [index, table] of tables.entries()) {
    for (const [prefixIndex, prefix] of ["", "main.", '"main" . ', "[main] . ", "`main` . "].entries()) {
      const sql = `UPDATE ${prefix}${table} SET id = 1; INSERT OR IGNORE INTO ${prefix}${table} (id) VALUES (1); DELETE FROM ${prefix}${table} WHERE id = 1`;
      files[`src/negative-${index}-${prefixIndex}.ts`] = `export const sql = ${JSON.stringify(sql)};\n`;
    }
  }
  files["src/schema-only.ts"] = 'export const sql = `UPDATE ActivityEntry.Task SET id = 1; INSERT INTO "ActivityEntry" . "Task" (id) VALUES (1); DELETE FROM "ActivityEntry" . "Task" WHERE id = 1`;\n';
  withFixture(files, (root) => {
    const report = scanArchitecture(root);
    assert.deepEqual(report.activityWrites, []);
    assert.deepEqual(report.violations, []);
  });
});

test("Rule 7: every ActivityEntry write has a call-site allowlist entry", () => {
  withFixture(
    {
      "src/allowed.ts": "export const pass = (database: any) => database.activityEntry.create({});\n",
      "src/fail.ts": "export const fail = (database: any) => database.activityEntry.upsert({});\n"
    },
    (root) => assert.deepEqual(
      locations(root, 7, { activityWriteAllowlist: new Set(["src/allowed.ts:1:activityEntry.create"]) }),
      ["src/fail.ts:1"]
    )
  );
});

test("Rule 7: raw SQL ActivityEntry inserts also require allowlisting", () => {
  withFixture(
    {
      "src/allowed.ts": 'export const pass = `INSERT INTO "ActivityEntry" ("id") VALUES (1)`;\n',
      "src/fail.ts": 'export const fail = `INSERT INTO "ActivityEntry" ("id") VALUES (2)`;\n'
    },
    (root) => assert.deepEqual(
      locations(root, 7, {
        activityWriteAllowlist: new Set([
          "src/allowed.ts:1:SQL INSERT INTO ActivityEntry"
        ])
      }),
      ["src/fail.ts:1"]
    )
  );
});

test("Rule 7: ActivityEntry updates and raw SQL updates require allowlisting", () => {
  withFixture(
    {
      "src/allowed.ts": "export const pass = (database: any) => database.activityEntry.update({});\n",
      "src/fail-update-many.ts": "export const fail = (database: any) => database.activityEntry.updateMany({});\n",
      "src/fail-sql.ts": 'export const fail = `UPDATE "ActivityEntry" SET "origin" = \'FOCUS\'`;\n'
    },
    (root) => assert.deepEqual(
      locations(root, 7, {
        activityWriteAllowlist: new Set([
          "src/allowed.ts:1:activityEntry.update"
        ])
      }),
      ["src/fail-sql.ts:1", "src/fail-update-many.ts:1"]
    )
  );
});

test("Rule 7: ActivityEntry deletions require exact call-site allowlisting", () => {
  const activityWriteAllowlist = new Set(["src/allowed.ts:1:activityEntry.deleteMany"]);
  withFixture(
    {
      "src/allowed.ts": "database.activityEntry.deleteMany({});\n",
      "src/delete.ts": "database.activityEntry.delete({});\n",
      "src/delete-many.ts": "database.activityEntry.deleteMany({});\n",
      "src/unrelated.ts": "database.task.delete({}); database.task.deleteMany({});\n",
      "scripts/delete.ts": "database.activityEntry.deleteMany({});\n",
      "tests/delete.test.ts": "database.activityEntry.delete({});\n"
    },
    (root) => {
      const report = scanArchitecture(root, { activityWriteAllowlist });
      assert.deepEqual(report.activityWrites, [
        "src/allowed.ts:1:activityEntry.deleteMany",
        "src/delete-many.ts:1:activityEntry.deleteMany",
        "src/delete.ts:1:activityEntry.delete"
      ]);
      assert.deepEqual(
        report.violations.map(({ rule, file, line }) => ({ rule, file, line })),
        [
          { rule: 7, file: "src/delete-many.ts", line: 1 },
          { rule: 7, file: "src/delete.ts", line: 1 }
        ]
      );
    }
  );
});

test("Rule 8: scripts may import src, never the reverse", () => {
  withFixture(
    {
      "scripts/pass.ts": 'import "../src/lib/value";\n',
      "src/fail.ts": 'import "../scripts/task";\n'
    },
    (root) => assert.deepEqual(locations(root, 8), ["src/fail.ts:1"])
  );
});

// ============================================================================
// Red-Team Evasion Test Cases (Rules 1-8)
// ============================================================================

test("Red-team Rule 1: module importing src/server/** is caught", () => {
  withFixture(
    {
      "src/modules/planning/services/task.ts": 'import { http } from "@/server/http";\nexport const t = 1;\n'
    },
    (root) => assert.deepEqual(locations(root, 1), ["src/modules/planning/services/task.ts:1"])
  );
});

test("Red-team Rule 1 (todo): transitive barrel re-export through src/shared", { todo: "Transitive re-exports across intermediate barrel files require multi-hop dependency analysis" }, () => {
  withFixture(
    {
      "src/modules/planning/domain/task.ts": 'export const task = 1;\n',
      "src/shared/planning-barrel.ts": 'export * from "@/modules/planning/domain/task";\n',
      "src/modules/projects/services/leak.ts": 'import { task } from "@/shared/planning-barrel";\nexport const p = task;\n'
    },
    (root) => assert.deepEqual(locations(root, 1), ["src/modules/projects/services/leak.ts:1"])
  );
});

test("Red-team Rule 2 (todo): leaky barrel re-export in src/shared/kernel laundering Prisma types", { todo: "Transitive re-export tracking through shared/kernel requires export symbol resolution" }, () => {
  withFixture(
    {
      "src/shared/kernel/db-types.ts": 'export type { PrismaClient } from "@prisma/client";\n',
      "src/modules/planning/domain/task.ts": 'import type { PrismaClient } from "@/shared/kernel/db-types";\nexport type T = PrismaClient;\n'
    },
    (root) => assert.deepEqual(locations(root, 2), ["src/modules/planning/domain/task.ts:1"])
  );
});

test("Red-team Rule 3: ui importing global Prisma client via @/lib/prisma is caught", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/modules/planning/ui/task-card.tsx": 'import { prisma } from "@/lib/prisma";\nexport const Card = () => { void prisma; return null; };\n'
    },
    (root) => assert.deepEqual(locations(root, 3), ["src/modules/planning/ui/task-card.tsx:1"])
  );
});

test("Red-team Rule 3 (todo): ui importing services re-exported from module root barrel", { todo: "Detecting service imports through module-root index barrels requires AST export graph resolution" }, () => {
  withFixture(
    {
      "src/modules/planning/services/save-task.ts": 'export const saveTask = () => {};\n',
      "src/modules/planning/index.ts": 'export * from "./services/save-task";\n',
      "src/modules/planning/ui/task-card.tsx": 'import { saveTask } from "@/modules/planning";\nexport const Card = () => { saveTask(); return null; };\n'
    },
    (root) => assert.deepEqual(locations(root, 3), ["src/modules/planning/ui/task-card.tsx:1"])
  );
});

test("Red-team Rule 4: services calling destructured $transaction is caught", () => {
  withFixture(
    {
      "src/modules/planning/services/task.ts": 'export async function run(database: any) { const { $transaction } = database; return $transaction(() => null); }\n'
    },
    (root) => assert.deepEqual(locations(root, 4), ["src/modules/planning/services/task.ts:1"])
  );
});

test("Red-team Rule 4 (todo): two-hop barrel re-export of prisma singleton", { todo: "Singleton discovery is deliberately bounded to 1 hop to prevent transitive closure explosion" }, () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/shared/db.ts": 'export { prisma as db } from "@/lib/prisma";\n',
      "src/shared/index.ts": 'export { db } from "./db";\n',
      "src/modules/planning/services/task.ts": 'import { db } from "@/shared/index";\nexport function run() { return db.task.findMany(); }\n'
    },
    (root) => assert.deepEqual(locations(root, 4), ["src/modules/planning/services/task.ts:1"])
  );
});

test("Red-team Rule 5: parameter fallback via ??= and ||= is caught", () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/fail-nullish-assign.ts": 'import { prisma } from "@/lib/prisma"; export function f(client?: any) { client ??= prisma; return client; }\n',
      "src/fail-or-assign.ts": 'import { prisma } from "@/lib/prisma"; export function f(client?: any) { client ||= prisma; return client; }\n'
    },
    (root) => assert.deepEqual(locations(root, 5), [
      "src/fail-nullish-assign.ts:1",
      "src/fail-or-assign.ts:1"
    ])
  );
});

test("Red-team Rule 5 (todo): parameter fallback via ternary conditional expression", { todo: "Detecting fallbacks in ternary expressions requires branch-aware data-flow analysis" }, () => {
  withFixture(
    {
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();\n',
      "src/fail-ternary.ts": 'import { prisma } from "@/lib/prisma"; export function f(client?: any) { const db = client ? client : prisma; return db; }\n'
    },
    (root) => assert.deepEqual(locations(root, 5), ["src/fail-ternary.ts:1"])
  );
});

test("Red-team Rule 6: non-allowlisted destructured $transaction is caught", () => {
  withFixture(
    {
      "src/lib/destructured-tx.ts": 'export async function run(database: any) { const { $transaction } = database; return $transaction(() => null); }\n'
    },
    (root) => assert.deepEqual(locations(root, 6), ["src/lib/destructured-tx.ts:1"])
  );
});

test("Red-team Rule 6 (todo): $transaction called via computed property variable", { todo: "Tracking variable-assigned member names (e.g. database[tx]) requires constant-propagation analysis" }, () => {
  withFixture(
    {
      "src/lib/computed-tx.ts": 'const tx = "$transaction" as const; export async function run(database: any) { return database[tx](() => null); }\n'
    },
    (root) => assert.deepEqual(locations(root, 6), ["src/lib/computed-tx.ts:1"])
  );
});

test("Red-team Rule 7: destructured activityEntry.create write is caught", () => {
  withFixture(
    {
      "src/lib/destructured-activity.ts": 'export const run = (database: any) => { const { activityEntry } = database; return activityEntry.create({}); };\n'
    },
    (root) => assert.deepEqual(locations(root, 7), ["src/lib/destructured-activity.ts:1"])
  );
});

test("Red-team Rule 7: raw SQL with INSERT OR REPLACE/IGNORE INTO ActivityEntry is caught", () => {
  withFixture(
    {
      "src/fail-replace.ts": 'export const sql = `INSERT OR REPLACE INTO "ActivityEntry" ("id") VALUES (1)`;\n',
      "src/fail-ignore.ts": 'export const sql = `INSERT OR IGNORE INTO "ActivityEntry" ("id") VALUES (2)`;\n'
    },
    (root) => assert.deepEqual(locations(root, 7), [
      "src/fail-ignore.ts:1",
      "src/fail-replace.ts:1"
    ])
  );
});

test("Red-team Rule 7 (todo): aliased model reference model.create({})", { todo: "Local variable aliasing (const m = db.activityEntry; m.create()) requires local symbol tracking" }, () => {
  withFixture(
    {
      "src/lib/aliased-activity.ts": 'export const run = (database: any) => { const m = database.activityEntry; return m.create({}); };\n'
    },
    (root) => assert.deepEqual(locations(root, 7), ["src/lib/aliased-activity.ts:1"])
  );
});

test("Red-team Rule 8: dynamic import with second argument (options) is caught", () => {
  withFixture(
    {
      "src/lib/dynamic-import.ts": 'export async function run() { await import("../../scripts/database-backup", { with: { type: "json" } }); }\n'
    },
    (root) => assert.deepEqual(locations(root, 8), ["src/lib/dynamic-import.ts:1"])
  );
});

test("Red-team Rule 8 (todo): indirect import via createRequire", { todo: "User-instantiated require functions are indistinguishable from normal calls without type checking" }, () => {
  withFixture(
    {
      "src/lib/custom-require.ts": 'import { createRequire } from "node:module"; const req = createRequire(import.meta.url); req("../../scripts/database-backup");\n'
    },
    (root) => assert.deepEqual(locations(root, 8), ["src/lib/custom-require.ts:1"])
  );
});

test("the real tree has no architecture violations beyond the explicit baseline", () => {
  const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const report = scanArchitecture(repositoryRoot);
  const baselineByKey = new Map(BASELINE.map((entry) => [violationKey(entry), entry]));
  const actualByKey = new Map(report.violations.map((entry) => [violationKey(entry), entry]));
  const legacyBaselineByFile = new Map(
    LEGACY_GLOBAL_CLIENT_CALL_BASELINE.map((entry) => [entry.file, entry])
  );
  const legacyCountMatches = (file: string) => {
    const expected = legacyBaselineByFile.get(file);
    return expected !== undefined && report.legacyGlobalClientCalls[file] === expected.count;
  };
  const isBaselined = (entry: Violation) =>
    baselineByKey.has(violationKey(entry)) ||
    (entry.baselineGroup === "legacy-global-client-call" &&
      legacyCountMatches(entry.file));
  const strict = process.env.ARCHITECTURE_STRICT === "1";
  const actionable = strict
    ? report.violations
    : report.violations.filter((entry) => !isBaselined(entry));
  const staleBaseline = strict ? [] : BASELINE.filter((entry) => !actualByKey.has(violationKey(entry)));

  console.log(`Architecture ${strict ? "strict" : "baseline"}: ${report.violations.length} violation(s)`);
  for (const violation of report.violations) {
    const known = baselineByKey.get(violationKey(violation));
    const legacyKnown =
      violation.baselineGroup === "legacy-global-client-call" &&
      legacyCountMatches(violation.file)
        ? legacyBaselineByFile.get(violation.file)
        : undefined;
    const suffix = !strict && (known || legacyKnown)
      ? ` [BASELINE: ${(known ?? legacyKnown)?.migration}${legacyKnown ? `; file count ${legacyKnown.count}` : ""}]`
      : "";
    console.log(`R${violation.rule} ${violation.file}:${violation.line} - ${violation.detail}${suffix}`);
  }
  const legacyCallCount = Object.values(report.legacyGlobalClientCalls).reduce(
    (total, count) => total + count,
    0
  );
  console.log(
    `Legacy global-client baseline: ${legacyCallCount} call site(s) across ${Object.keys(report.legacyGlobalClientCalls).length} file(s)`
  );
  console.log(`Activity write allowlist: ${report.activityWrites.length} call site(s)`);
  for (const activityWrite of report.activityWrites) console.log(activityWrite);

  assert.deepEqual(
    report.activityWrites,
    [...ACTIVITY_WRITE_ALLOWLIST].sort(),
    "Update the explicit ActivityEntry write allowlist when a governed call site changes."
  );
  assert.deepEqual(
    Object.entries(report.legacyGlobalClientCalls).sort(([left], [right]) =>
      left.localeCompare(right)
    ),
    LEGACY_GLOBAL_CLIENT_CALL_BASELINE.map(({ file, count }) => [file, count]),
    "Update the per-file legacy global-client baseline when an escape site changes."
  );
  assert.deepEqual(
    staleBaseline.map(violationKey),
    [],
    "Remove stale architecture baseline entries after completing their migration phase."
  );
  assert.equal(
    actionable.length,
    0,
    strict
      ? "ARCHITECTURE_STRICT=1 ignores the baseline."
      : "New architecture violations must be fixed or explicitly baselined."
  );
});
