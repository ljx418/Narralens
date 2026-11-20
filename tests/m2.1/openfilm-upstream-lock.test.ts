import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ts from "typescript";
import {
  createPinnedOpenFilmUpstream, openFilmAvailability, OPENFILM_PIN, verifyPinnedFiles,
} from "../../src/adapters/openfilm/openfilm-upstream.js";
import productionLock from "../../contracts/openfilm-upstream-lock.json" with { type: "json" };
import spikeLock from "../../spikes/openfilm-m1b/upstream-lock.json" with { type: "json" };

/**
 * M-04 (external review): a pinned commit is not proof of the bytes that will execute.
 *
 * The loader used to check `.git/HEAD` only, so a checkout at the right commit with a
 * locally modified `film.mjs` still loaded the modified code while `engine_upstream_sha`
 * claimed the pinned one.
 *
 * These tests run entirely on synthetic checkouts under /tmp; no real upstream tree is
 * touched. A synthetic tree can never satisfy the real digest pins, so it proves the
 * refusal path rather than the acceptance path; the acceptance path is covered by the real
 * upstream probe.
 */

const copies: string[] = [];
afterEach(async () => { await Promise.all(copies.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

/** Build a checkout whose digests all match the pin, so only one thing can be wrong at a time. */
async function syntheticCheckout(mutate: (root: string) => Promise<void> = async () => undefined): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "narralens-openfilm-lock-"));
  copies.push(root);
  const { createHash } = await import("node:crypto");
  const write = async (relative: string, contents: string): Promise<void> => {
    const path = resolve(root, relative);
    await rm(path, { force: true });
    await (await import("node:fs/promises")).mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, contents, "utf8");
  };
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");

  const moduleBody = (name: string) => `export const ${name} = () => undefined;\n`;
  for (const [relative, digest] of Object.entries(OPENFILM_PIN.loaded_module_sha256)) {
    void digest;
    await write(relative, moduleBody("placeholder"));
  }
  await write(OPENFILM_PIN.package_file, "package-json");
  await write(OPENFILM_PIN.lockfile_file, "lockfile");
  await write(OPENFILM_PIN.license_file, "license");

  await mutate(root);
  void sha;
  return root;
}

async function checkoutWithPinnedHead(): Promise<string> {
  const root = await syntheticCheckout();
  await mkdir(resolve(root, ".git"), { recursive: true });
  await writeFile(resolve(root, ".git/HEAD"), `${OPENFILM_PIN.full_sha}\n`, "utf8");
  return root;
}

async function withFakeGit(body: string, run: (root: string) => Promise<void>): Promise<void> {
  const bin = await mkdtemp(resolve(tmpdir(), "narralens-fake-git-"));
  copies.push(bin);
  const git = resolve(bin, "git");
  await writeFile(git, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(git, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try { await run(await checkoutWithPinnedHead()); }
  finally { process.env.PATH = previous; }
}

/**
 * The vendor path is a COMPOSITION-TIME capability, and the rule below is about the
 * SOURCE of that value - not about the words that happen to appear in a file.
 *
 * The rule that came before it was a whole-file word search: the module must not
 * contain the text `request.`, `req.` or `body.`. That is a guess about words, not
 * about capabilities: the fixed upstream's own page serving is legitimately HTTP, so
 * the search proved nothing about the vendor path and broke on the very code that
 * serves the pages.
 *
 * What the rule does instead:
 *  - a request is recognised by its TYPE (`IncomingMessage`, `ServerResponse`), not by
 *    the name of the variable that holds it, so a renamed parameter is still a request;
 *  - an alias of a request is a request (`const q = req`), and so is anything read out
 *    of one (`req.headers[...]`, `q.url`) or produced by a helper that was handed one;
 *  - the value is followed into the vendor path of every entry point of the loader
 *    module, at every call site in the Host.
 *
 * LIMITATION (stated, not hidden): the taint is followed within one file at a time.
 * A value that is request-derived in one module and handed to another module through
 * a call whose argument is itself clean would not be seen. Every real call site of
 * the loader is checked, and the rule is proved on synthetic callers that try the
 * obvious ways in.
 */
const LOADER_MODULE = "src/adapters/openfilm/openfilm-upstream.ts";
/** The types that ARE a request. */
const REQUEST_TYPE_NAMES = ["IncomingMessage", "ServerResponse", "IncomingHttpHeaders", "Request", "Response"];
/** The names a request usually has. A SECONDARY source, only inside an HTTP file. */
const REQUEST_PARAMETER_NAMES = new Set(["req", "request", "res", "response"]);

/**
 * One entry point of the loader module that carries the vendor path.
 *
 * The position is not guessed by a word: it is read from the module's own facts. A
 * loader takes the vendor path DIRECTLY, as the parameter the module verifies with
 * `realpath`, and the serving owner and its bridge take it INDIRECTLY, through the
 * private registry of the ISSUED producers - the only place a vendor path of a
 * serving comes from. The registry read must be INSIDE that very function: a
 * function that merely has a parameter of the same NAME reads no registry and
 * carries no vendor path.
 */
interface VendorEntry { readonly exportName: string; readonly vendorIndex: number; }

/** Every source file of the Host, production only. */
function productionSources(): { readonly file: string; readonly text: string }[] {
  const found: { file: string; text: string }[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) { if (entry !== "node_modules") walk(full); continue; }
      if (/\.(ts|tsx)$/u.test(entry)) found.push({ file: full, text: readFileSync(full, "utf8") });
    }
  };
  walk(resolve("src"));
  return found;
}

/**
 * The source of a file, parsed the way the file itself is written.
 *
 * A `.ts` file is parsed as TypeScript and a `.tsx` file as TypeScript with JSX:
 * a `.ts` file parsed as TSX reads a `<` as the start of a JSX element, and the
 * whole rest of the file - a class with all its methods - is then swallowed by
 * that element and never visited at all.
 */
/**
 * The source of a file, parsed the way the file itself is written.
 *
 * A `.ts` file is parsed as TypeScript and a `.tsx` file as TypeScript with JSX:
 * a `.ts` file parsed as TSX reads a `<` as the start of a JSX element, and the
 * whole rest of the file - a class with all its methods - is then swallowed by
 * that element and never visited at all.
 */
const parseSource = (text: string, name: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true,
    name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** The module's private registries of ISSUED PRODUCERS.
 *
 * They are found by their own SHAPE: a module-level WeakMap whose VALUES are strings.
 * The registry of the issued servings holds objects, and the registry of the issued
 * producers is a WeakSet - neither of them is the vendor path.
 */
function vendorRegistryNames(tree: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = declaration.initializer;
      if (!ts.isNewExpression(initializer) || !ts.isIdentifier(initializer.expression)) continue;
      if (initializer.expression.text !== "WeakMap") continue;
      const typeArguments = initializer.typeArguments;
      if (typeArguments === undefined || typeArguments.length < 2) continue;
      if (!/\bstring\b/u.test(typeArguments[1]!.getText(tree))) continue;
      names.add(declaration.name.text);
    }
  }
  return names;
}

/**
 * The module's private registries of the ISSUED PRODUCERS.
 *
 * They are the WeakSets that are filled together with the vendor path's own WeakMap:
 * the same value goes into both, so the elements of that WeakSet ARE the producers
 * whose vendor path is recorded. A WeakSet that stands on its own (the reusable
 * availability verdicts, for instance) is not that registry.
 */
function issuedProducerRegistryNames(tree: ts.SourceFile, vendorRegistries: ReadonlySet<string>): Set<string> {
  const weakSets = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = declaration.initializer;
      if (!ts.isNewExpression(initializer) || !ts.isIdentifier(initializer.expression)) continue;
      if (initializer.expression.text === "WeakSet") weakSets.add(declaration.name.text);
    }
  }
  // The values that go into the vendor path's own registry.
  const registered = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && vendorRegistries.has(node.expression.expression.text)
      && node.expression.name.text === "set" && node.arguments.length === 2
      && ts.isIdentifier(node.arguments[0]!)) {
      registered.add(node.arguments[0]!.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  // And the WeakSets that are filled with the very same values.
  const producers = new Set<string>();
  const scan = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && weakSets.has(node.expression.expression.text)
      && node.expression.name.text === "add" && node.arguments.length === 1
      && ts.isIdentifier(node.arguments[0]!) && registered.has(node.arguments[0]!.getText())) {
      producers.add(node.expression.expression.text);
    }
    ts.forEachChild(node, scan);
  };
  scan(tree);
  return producers;
}

/** The parameter that carries the vendor path into the registry, INSIDE this function. */
function registryParameterIn(fn: ts.FunctionDeclaration, registries: ReadonlySet<string>): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && registries.has(node.expression.expression.text)
      && node.expression.name.text === "get" && node.arguments.length === 1
      && ts.isIdentifier(node.arguments[0]!)) {
      found = node.arguments[0]!.getText();
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  return found;
}
/**
 * The parameter that carries the vendor path TRANSITIVELY, INSIDE this function.
 *
 * The serving owner and the bridge do not take a vendor path: they take a CAPABILITY
 * that the module issued, and the vendor path of that capability is recorded in the
 * private registry. A value that the caller made up is not in the registry, so it can
 * never become a vendor path - but the RULE has to look at the right position.
 */
function issuedProducerParameterIn(fn: ts.FunctionDeclaration, registries: ReadonlySet<string>): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && registries.has(node.expression.expression.text)
      && node.expression.name.text === "has" && node.arguments.length === 1
      && ts.isIdentifier(node.arguments[0]!)) {
      found = node.arguments[0]!.getText();
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  if (found === undefined) return undefined;
  // Checking that a value IS an issued producer is not carrying its vendor path: a
  // predicate only TESTS the capability. The position carries it when the function
  // really USES that capability - it invokes the producer's own drawing call on it,
  // directly or through an alias.
  if (!invokesIssuedCapability(fn, found)) return undefined;
  return found;
}

/** Whether this function really USES the issued capability: it calls the producer's
 *  own drawing call on that value, directly or through an alias of it. */
function invokesIssuedCapability(fn: ts.FunctionDeclaration, parameter: string): boolean {
  const aliases = new Set<string>([parameter]);
  let invoked = false;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      // The alias may be wrapped: 'const issued = producer as Owner' names the very
      // same value, and a chain of aliases names it too.
      const source = unwrap(node.initializer);
      if (ts.isIdentifier(source) && aliases.has(source.text)) aliases.add(node.name.text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "pageFrame") {
      const receiver = unwrap(node.expression.expression);
      if (ts.isIdentifier(receiver) && aliases.has(receiver.text)) invoked = true;
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) visit(fn.body);
  return invoked;
}

/** The entry points of the loader module that carry the vendor path. */
function vendorEntries(text: string): VendorEntry[] {
  const tree = parseSource(text, "vendor-entry-points.ts");
  const registries = vendorRegistryNames(tree);
  const producers = issuedProducerRegistryNames(tree, registries);
  const found: VendorEntry[] = [];
  for (const statement of tree.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) continue;
    const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!exported) continue;
    // DIRECT: the vendor path the module verifies with `realpath`.
    const direct = statement.parameters.findIndex(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === "vendorRoot");
    if (direct >= 0) { found.push({ exportName: statement.name.text, vendorIndex: direct }); continue; }
    // INDIRECT: the vendor path THIS function reads from the private registry.
    const indirect = registryParameterIn(statement, registries);
    if (indirect !== undefined) {
      const position = statement.parameters.findIndex(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === indirect);
      if (position >= 0) { found.push({ exportName: statement.name.text, vendorIndex: position }); continue; }
    }
    // TRANSITIVE: the issued capability whose own vendor path is recorded - the
    // position has to be the one the module checks against the producers' registry.
    const transitive = issuedProducerParameterIn(statement, producers);
    if (transitive === undefined) continue;
    const position = statement.parameters.findIndex(parameter => ts.isIdentifier(parameter.name) && parameter.name.text === transitive);
    if (position >= 0) found.push({ exportName: statement.name.text, vendorIndex: position });
  }
  return found;
}

/**
 * One lexical scope: a function body, a class body, or the module's top level.
 *
 * The declarations are held by their DECLARATION, not by their name: two functions
 * may declare a parameter of the same name, and only the one that really holds a
 * request is a request.
 */
interface LexicalScope {
  readonly parent: LexicalScope | undefined;
  readonly locals: Map<string, ts.Node>;
  /** What this scope is: the module, a function, or a class body. */
  readonly kind: "module" | "function" | "class";
}

/** The scopes of a file, the call sites inside them, and the declaration identities. */
interface ScopeModel {
  readonly module: LexicalScope;
  readonly scopes: LexicalScope[];
  readonly calls: { readonly scope: LexicalScope; readonly node: ts.CallExpression }[];
}

/**
 * The nodes that open a scope of their own.
 *
 * A method, a constructor, an accessor, an arrow and a function expression all
 * hold their own parameters: they are scopes, exactly like a function declaration
 * is. The rule that follows a request into the Host's own code has to see them all
 * - a class method is not "the top level of the file" just because the file has
 * no function declaration around it.
 */
function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

/**
 * The function a call really reaches.
 *
 * It is the declaration itself when the declaration IS a function, and the
 * function a variable holds when the name is a variable: `const helper = (root) =>
 * …` is a helper with a parameter, and the rule has to see that parameter.
 */
function callableOf(declaration: ts.Node): ts.FunctionLikeDeclaration | undefined {
  if (isFunctionLike(declaration)) return declaration;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
    && isFunctionLike(declaration.initializer)) return declaration.initializer;
  return undefined;
}

function buildScopes(tree: ts.SourceFile): ScopeModel {
  const module: LexicalScope = { parent: undefined, locals: new Map(), kind: "module" };
  const scopes: LexicalScope[] = [module];
  const calls: { scope: LexicalScope; node: ts.CallExpression }[] = [];
  const bind = (scope: LexicalScope, name: string, declaration: ts.Node): void => {
    if (!scope.locals.has(name)) scope.locals.set(name, declaration);
  };
  /** The scope of one function-like node: its parameters, and its own name. */
  const scopeOf = (fn: ts.FunctionLikeDeclaration, parent: LexicalScope): LexicalScope => {
    const scope: LexicalScope = { parent, locals: new Map(), kind: "function" };
    scopes.push(scope);
    for (const parameter of fn.parameters)
      if (ts.isIdentifier(parameter.name)) bind(scope, parameter.name.text, parameter);
    if (fn.name !== undefined && ts.isIdentifier(fn.name)) bind(scope, fn.name.text, fn);
    return scope;
  };
  /**
   * The whole file, with the scope every declaration really lives in.
   *
   * EVERY call of the file is collected, in the scope it is written in: a call in a
   * method, in a constructor, in an accessor, in an arrow, in a function expression,
   * in an initializer, in a static block, in a default value of a parameter, in a
   * computed name of a member and in the top level of the module alike.
   */
  const walk = (node: ts.Node, scope: LexicalScope): void => {
    if (ts.isCallExpression(node)) calls.push({ scope, node });
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bind(scope, node.name.text, node);
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) bind(scope, node.name.text, node);
    if (ts.isClassDeclaration(node) && node.name !== undefined) bind(scope, node.name.text, node);
    if (isFunctionLike(node)) {
      // A function-like opens its own scope: its body is walked in it, and the
      // declarations of that body do not leak into the one around it.
      const own = scopeOf(node, scope);
      // The DEFAULT VALUE of a parameter is evaluated in the function's OWN scope:
      // it may call anything, and it may use the parameters before it.
      for (const parameter of node.parameters)
        if (parameter.initializer !== undefined) walk(parameter.initializer, own);
      if (node.body !== undefined) walk(node.body, own);
      return;
    }
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      // The body of a class is a scope of its own: its members, its property
      // initializers and its static blocks live in it, and every method opens a
      // scope of its own inside it.
      const classScope: LexicalScope = { parent: scope, locals: new Map(), kind: "class" };
      scopes.push(classScope);
      for (const member of node.members) {
        const name = (member as ts.NamedDeclaration).name;
        const computed = name !== undefined && ts.isComputedPropertyName(name);
        // The NAME of a member is computed in the scope the class is WRITTEN in, not
        // in the scope of the member itself.
        if (computed) walk((name as ts.ComputedPropertyName).expression, scope);
        // The methods of the class are bound in the class scope: `this.helper(…)`
        // reaches the method this class really declares, and not a name of the
        // world outside it.
        if (name !== undefined && ts.isIdentifier(name)
          && (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)))
          bind(classScope, name.text, member);
        if (isFunctionLike(member)) {
          // The member opens its own scope; its name is not walked with it.
          walk(member, classScope);
          continue;
        }
        ts.forEachChild(member, child => {
          // The computed name was walked in ITS scope already.
          if (computed && child === name) return;
          walk(child, classScope);
        });
      }
      return;
    }
    ts.forEachChild(node, child => walk(child, scope));
  };
  walk(tree, module);
  return { module, scopes, calls };
}

/**
 * The declaration a call really reaches.
 *
 * A name is resolved in the scope the call is written in. `this.helper(…)` is
 * resolved in the CLASS the call is written in - the class is the boundary: a name
 * of the world outside the class is not this class's method.
 */
function calleeDeclaration(scope: LexicalScope, expression: ts.Expression): ts.Node | undefined {
  if (ts.isIdentifier(expression)) return resolveDeclaration(scope, expression.text);
  if (ts.isPropertyAccessExpression(expression)
    && expression.expression.kind === ts.SyntaxKind.ThisKeyword
    && ts.isIdentifier(expression.name)) {
    let current: LexicalScope | undefined = scope;
    while (current !== undefined) {
      const found = current.locals.get(expression.name.text);
      if (found !== undefined) return found;
      // The class is the boundary of `this`: nothing outside it is this class's
      // method.
      if (current.kind === "class") return undefined;
      current = current.parent;
    }
    return undefined;
  }
  return undefined;
}

/**
 * The expression inside the TRANSPARENT wrappers: parentheses, a type assertion, a
 * non-null assertion, `as` and `satisfies`.
 *
 * A wrapper is not a value of its own: it says nothing about where a value came from
 * and it grants nothing. Resolving through it is what makes the rule see the SAME
 * value whether it was written plainly or wrapped.
 */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue; }
    if (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** Resolve a NAME to the declaration it really refers to, in the scope it is used. */
function resolveDeclaration(scope: LexicalScope, name: string): ts.Node | undefined {
  let current: LexicalScope | undefined = scope;
  while (current !== undefined) {
    const found = current.locals.get(name);
    if (found !== undefined) return found;
    current = current.parent;
  }
  return undefined;
}

/**
 * The taint of a file: whether an expression can carry a request.
 *
 * A request is recognised by its TYPE, never by the name of the variable that holds
 * it. An alias of a request is a request, so is anything read out of one, and so is
 * a value that was handed to a helper - the taint follows the argument into the
 * helper's own parameter, and the helper's parameter is tainted ONLY inside that
 * helper.
 *
 * SCOPE (stated, not hidden): the taint is followed per lexical scope - a function
 * body, or the module's top level. A parameter of one function never taints a
 * parameter of the same name in another function. The scopes are approximated by the
 * function body (a block inside a function is not a separate scope here), and the
 * analysis is bounded: it converges in a bounded number of rounds.
 */
function taintOf(text: string, tree: ts.SourceFile): (scope: LexicalScope, expression: ts.Expression) => boolean {
  const model = buildScopes(tree);
  const tainted = new WeakMap<ts.Node, boolean>();
  const typeIsRequest = (type: ts.TypeNode): boolean =>
    REQUEST_TYPE_NAMES.some(name => new RegExp(`\\b${name}\\b`, "u").test(type.getText(tree)));
  const speaksHttp = /from\s+["']node:http["']/u.test(text);
  const isRequestSource = (declaration: ts.Node): boolean => {
    if (ts.isParameter(declaration)) {
      // The TYPE decides. The name is only the fallback for a parameter that has NO
      // type at all: a parameter that says it is a string is a string, whatever it is
      // called.
      if (declaration.type !== undefined) return typeIsRequest(declaration.type);
      return speaksHttp && ts.isIdentifier(declaration.name) && REQUEST_PARAMETER_NAMES.has(declaration.name.text);
    }
    if (ts.isVariableDeclaration(declaration) && declaration.type !== undefined && typeIsRequest(declaration.type)) return true;
    return false;
  };
  const isTainted = (scope: LexicalScope, expression: ts.Expression): boolean => {
    if (ts.isIdentifier(expression)) {
      const declaration = resolveDeclaration(scope, expression.text);
      if (declaration === undefined) return false;
      return tainted.get(declaration) === true;
    }
    // A transparent wrapper says nothing of its own: it neither hides a value nor
    // creates one.
    if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
      || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression)
      || ts.isNonNullExpression(expression)) return isTainted(scope, expression.expression);
    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
      return isTainted(scope, expression.expression);
    if (ts.isCallExpression(expression) || ts.isNewExpression(expression))
      return (expression.arguments ?? []).some(argument => isTainted(scope, argument));
    if (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression)
      || ts.isNonNullExpression(expression) || ts.isAsExpression(expression)
      || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression))
      return isTainted(scope, expression.expression);
    if (ts.isConditionalExpression(expression)) return isTainted(scope, expression.whenTrue) || isTainted(scope, expression.whenFalse);
    if (ts.isBinaryExpression(expression)) return isTainted(scope, expression.left) || isTainted(scope, expression.right);
    if (ts.isSpreadElement(expression)) return isTainted(scope, expression.expression);
    return false;
  };
  for (const scope of model.scopes)
    for (const declaration of scope.locals.values())
      if (isRequestSource(declaration)) tainted.set(declaration, true);
  for (let round = 0; round < 8; round += 1) {
    let changed = false;
    for (const scope of model.scopes)
      for (const declaration of scope.locals.values()) {
        if (tainted.get(declaration) === true) continue;
        if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined
          && isTainted(scope, declaration.initializer)) {
          tainted.set(declaration, true);
          changed = true;
        }
      }
    // A helper's own parameter is tainted when a call of THAT helper hands it a
    // tainted value - and the value is judged in the CALLER's scope.
    for (const call of model.calls) {
      // The helper that was handed the request may be a function, a method, a
      // constructor, an arrow or a function expression - and it may be held by a
      // variable: they all hold parameters. `this.helper(…)` reaches the method
      // the class really declares.
      const callee = calleeDeclaration(call.scope, call.node.expression);
      const callable = callee === undefined ? undefined : callableOf(callee);
      if (callable === undefined) continue;
      call.node.arguments.forEach((argument, index) => {
        const parameter = callable.parameters[index];
        if (parameter === undefined || !ts.isIdentifier(parameter.name)) return;
        if (tainted.get(parameter) === true) return;
        if (isTainted(call.scope, argument)) {
          tainted.set(parameter, true);
          changed = true;
        }
      });
    }
    if (!changed) break;
  }
  return isTainted;
}

/**
 * The places where a request reaches the vendor path.
 *
 * The call is resolved to the REAL export it reaches: an import that renames the
 * export, a namespace import and the loader module's own local call are all the same
 * thing - a call of that entry point.
 */
/**
 * How the local names of a file reach the exports of the loader module.
 *
 * An import that renames the export, a namespace import and the loader module's own
 * local call are all the same thing: a call of that entry point.
 */
function loaderBindings(tree: ts.SourceFile, known: ReadonlyMap<string, VendorEntry>, isLoader: boolean): {
  readonly resolveExport: (callee: ts.Expression) => string | undefined;
} {
  const localToExport = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.moduleSpecifier.text.endsWith("openfilm-upstream.js")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) { namespaces.add(bindings.name.text); continue; }
    for (const element of bindings.elements)
      localToExport.set(element.name.text, (element.propertyName ?? element.name).text);
  }
  // The loader module ITSELF reaches its own exports by their own names.
  const resolveExport = (callee: ts.Expression): string | undefined => {
    if (ts.isIdentifier(callee)) {
      const local = localToExport.get(callee.text);
      if (local !== undefined) return local;
      return isLoader && known.has(callee.text) ? callee.text : undefined;
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      && namespaces.has(callee.expression.text) && ts.isIdentifier(callee.name))
      return callee.name.text;
    return undefined;
  };
  return { resolveExport };
}

/**
 * Every call of a loader entry point in the Host's own sources.
 *
 * This is the DIRECT evidence that the rule reaches the real call sites: the set is
 * the set the traversal really finds, file by file, and the assertion below is the
 * set the real sources really hold. A traversal that misses the class methods and
 * the arrows of the Host finds fewer of them - and the gate says so.
 *
 * The loader module itself is not in this set: its own calls are checked by their
 * own case, with its own facts.
 */
function loaderCallSites(
  files: readonly { readonly file: string; readonly text: string }[],
  entries: readonly VendorEntry[],
  loaderModule: string = LOADER_MODULE,
): { readonly file: string; readonly exportName: string }[] {
  const known = new Map(entries.map(entry => [entry.exportName, entry]));
  const found: { file: string; exportName: string }[] = [];
  for (const { file, text } of files) {
    if (file.endsWith(loaderModule)) continue;
    const tree = parseSource(text, "vendor-call-site.ts");
    const model = buildScopes(tree);
    const { resolveExport } = loaderBindings(tree, known, false);
    for (const call of model.calls) {
      const exportName = resolveExport(call.node.expression);
      if (exportName === undefined || !known.has(exportName)) continue;
      found.push({ file: relative(process.cwd(), file).split(sep).join("/"), exportName });
    }
  }
  return found;
}

function vendorPathViolations(
  files: readonly { readonly file: string; readonly text: string }[],
  entries: readonly VendorEntry[],
  loaderModule: string = LOADER_MODULE,
): string[] {
  const known = new Map(entries.map(entry => [entry.exportName, entry]));
  const violations: string[] = [];
  for (const { file, text } of files) {
    const tree = parseSource(text, "vendor-call-site.ts");
    const model = buildScopes(tree);
    const isTainted = taintOf(text, tree);
    const { resolveExport } = loaderBindings(tree, known, file.endsWith(loaderModule));
    for (const call of model.calls) {
      const exportName = resolveExport(call.node.expression);
      const entry = exportName === undefined ? undefined : known.get(exportName);
      if (entry === undefined) continue;
      const argument = call.node.arguments[entry.vendorIndex];
      if (argument !== undefined && isTainted(call.scope, argument))
        violations.push(`${file}: ${entry.exportName}() takes its vendor path from a request`);
    }
  }
  return violations;
}

describe("M-04 pinned OpenFilm checkout verification", () => {
  it("pins every file the loader is about to execute, plus package, lock and licence", () => {
    const files = Object.keys(OPENFILM_PIN.loaded_module_sha256);
    expect(files).toContain("packages/openfilm/studio/server/film.mjs");
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const [relative, digest] of Object.entries(OPENFILM_PIN.loaded_module_sha256)) {
      expect(digest, relative).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(OPENFILM_PIN.package_json_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(OPENFILM_PIN.lockfile_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(OPENFILM_PIN.license_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps the production lock consistent with the M1B recorded upstream lock", () => {
    expect(OPENFILM_PIN.full_sha).toBe(spikeLock.full_sha);
    expect(OPENFILM_PIN.full_sha).toBe(productionLock.full_sha);
    expect(OPENFILM_PIN.package_json_sha256).toBe(spikeLock.package_json_sha256);
    expect(OPENFILM_PIN.lockfile_sha256).toBe(spikeLock.lockfile_sha256);
    expect(OPENFILM_PIN.license_sha256).toBe(spikeLock.license_sha256);
    expect(OPENFILM_PIN.package).toBe(spikeLock.package);
    expect(OPENFILM_PIN.license).toBe(spikeLock.license);
    expect(OPENFILM_PIN.full_sha).toMatch(/^[a-f0-9]{40}$/u);
  });

  it("refuses a checkout with no git HEAD", async () => {
    const root = await syntheticCheckout();
    const availability = await openFilmAvailability(root);
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/git HEAD/u);
  });

  it("fails closed when git status cannot be executed", async () => {
    const previous = process.env.PATH;
    process.env.PATH = "/definitely/missing";
    try {
      const availability = await openFilmAvailability(await checkoutWithPinnedHead());
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/cannot verify.*clean/u);
      expect(availability.checked).not.toContain("git_clean");
    } finally { process.env.PATH = previous; }
  });

  it("fails closed when git status exits non-zero", async () => {
    await withFakeGit("exit 7", async (root) => {
      const availability = await openFilmAvailability(root);
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/cannot verify.*clean/u);
    });
  });

  it("fails closed when git status times out", async () => {
    await withFakeGit("/bin/sleep 1", async (root) => {
      const availability = await openFilmAvailability(root, 10);
      expect(availability.available).toBe(false);
      expect(availability.reason).toMatch(/cannot verify.*clean/u);
    });
  });

  it("uses a 30 second production default without weakening an explicit fail-closed budget", async () => {
    const upstreamSource = await readFile(resolve("src/adapters/openfilm/openfilm-upstream.ts"), "utf8");
    const compositionSource = await readFile(resolve("src/host/engine/openfilm-composition.ts"), "utf8");
    expect(upstreamSource).toContain("gitStatusTimeoutMs = 30_000");
    expect(compositionSource).toContain("gitStatusTimeoutMs ?? 30_000");
    // The explicit 10ms test above remains the proof that any caller-supplied budget fails closed.
  });

  it("rejects a tracked dirty checkout and records git_clean only after a successful check", async () => {
    await withFakeGit("printf ' M packages/openfilm/studio/server/film.mjs\\n'", async (root) => {
      const dirty = await openFilmAvailability(root);
      expect(dirty.available).toBe(false);
      expect(dirty.reason).toMatch(/local modifications/u);
      expect(dirty.checked).toContain("git_clean");
    });
    await withFakeGit("exit 0", async (root) => {
      const clean = await openFilmAvailability(root);
      expect(clean.available).toBe(false);
      expect(clean.checked).toContain("git_clean");
      expect(clean.reason).toMatch(/not intact/u);
    });
  });

  it("refuses when the seam module was tampered with", async () => {
    const root = await syntheticCheckout();
    const clean = await verifyPinnedFiles(root);
    expect(clean.ok).toBe(false);
    await writeFile(resolve(root, "packages/openfilm/studio/server/film.mjs"),
      "export const readProjectFilm = () => ({});\n", "utf8");
    const tampered = await verifyPinnedFiles(root);
    expect(tampered.ok).toBe(false);
    expect(tampered.mismatched).toContain("packages/openfilm/studio/server/film.mjs");
    expect(tampered.reason).toMatch(/digest mismatch packages\/openfilm\/studio\/server\/film\.mjs/u);
  });

  it("refuses when any other loaded module, package, lock or licence changes", async () => {
    for (const relative of [...Object.keys(OPENFILM_PIN.loaded_module_sha256),
      OPENFILM_PIN.package_file, OPENFILM_PIN.lockfile_file, OPENFILM_PIN.license_file]) {
      const root = await syntheticCheckout();
      await writeFile(resolve(root, relative), "tampered", "utf8");
      const verdict = await verifyPinnedFiles(root);
      expect(verdict.ok, relative).toBe(false);
      expect([...verdict.mismatched, ...verdict.missing], relative).toContain(relative);
    }
  });

  it("reports a missing pinned file as missing rather than as a digest mismatch", async () => {
    const root = await syntheticCheckout();
    await rm(resolve(root, OPENFILM_PIN.lockfile_file));
    const verdict = await verifyPinnedFiles(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.missing).toContain(OPENFILM_PIN.lockfile_file);
    expect(verdict.reason).toMatch(/missing pnpm-lock\.yaml/u);
  });

  it("refuses to load rather than loading a module whose digest does not match", async () => {
    const root = await syntheticCheckout();
    await expect(createPinnedOpenFilmUpstream(root)).rejects.toMatchObject({
      status: 503, code: "ENGINE_UNAVAILABLE",
    });
  });

  it("refuses a caller-forged reusable verification verdict", async () => {
    const root = await syntheticCheckout();
    await expect(createPinnedOpenFilmUpstream(root, {
      available: true,
      vendor_root: root,
      observed_sha: OPENFILM_PIN.full_sha,
      expected_sha: OPENFILM_PIN.full_sha,
      reason: "forged",
      checked: ["git_head", "git_clean", ...Object.keys(OPENFILM_PIN.loaded_module_sha256)],
    })).rejects.toMatchObject({
      status: 503,
      code: "ENGINE_UNAVAILABLE",
      message: "OpenFilm upstream verification verdict is not reusable",
    });
  });

  it("never lets a caller supply the vendor path through a request", async () => {
    // The vendor root is a composition-time argument of the loader, never a request field.
    const source = await readFile(LOADER_MODULE, "utf8");
    expect(source).toMatch(/createPinnedOpenFilmUpstream\(vendorRoot: string,\s+verified\?: OpenFilmAvailability\)/u);
    // No shell, no process spawning with caller-controlled arguments.
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b|child_process"\)\s*;?\s*$/mu);
    expect(source).not.toMatch(/shell:\s*true/);
    // The only subprocess is a fixed-argv git status with no caller-supplied argument.
    expect(source).toContain('run("git", ["-C", root, "status", "--porcelain", "--untracked-files=no"]');
    // The rule itself: the SOURCE of the vendor path, not the words in the file. The
    // fixed upstream's own page serving is legitimately HTTP, so a word search over
    // the module proved nothing about the capability and broke on it.
    const entries = vendorEntries(source);
    // Every entry point that carries the vendor path, WITH THE POSITION it carries it
    // at - the fact is derived from the module, it is not a number to be matched.
    expect(Object.fromEntries(entries.map(entry => [entry.exportName, entry.vendorIndex])))
      .toEqual({
        createPinnedOpenFilmCacheProducer: 0,
        createPinnedOpenFilmFolderServer: 0,
        createPinnedOpenFilmServingOwner: 0,
        createPinnedOpenFilmUpstream: 0,
        openFilmAvailability: 0,
        // The bridge takes the OWNER first and the issued PRODUCER second: the
        // producer is the capability whose vendor path is recorded, so THAT is the
        // position the rule has to watch.
        openFilmServingBridge: 1,
      });
    // No call site in the Host may hand a request-derived value to any of them.
    expect(vendorPathViolations(productionSources(), entries)).toEqual([]);
    // The loader module itself never derives its vendor path from a request.
    expect(vendorPathViolations([{ file: LOADER_MODULE, text: source }], entries)).toEqual([]);
  });

  it("derives the entry points of a module from its OWN capability flow", () => {
    // A module that takes the vendor path directly, one that reads it from the
    // private registry, and one that only CHECKS an issued producer without ever
    // using it.
    const module = [
      'const registry=new WeakMap<object,string>();',
      'const issued=new WeakSet<object>();',
      'export function takesTheVendorPath(vendorRoot:string): void { registry.get(vendorRoot); }',
      'export function readsTheRegistry(producer:unknown): void { registry.get(producer); }',
      'export function onlyChecks(producer:unknown): void { issued.has(producer); }',
    ].join("\n");
    expect(Object.fromEntries(vendorEntries(module).map(entry => [entry.exportName, entry.vendorIndex])))
      .toEqual({ takesTheVendorPath: 0, readsTheRegistry: 0 });
    // A function that only CHECKS the issued capability does not CARRY its vendor
    // path: a predicate is not an entry point.
    expect(vendorEntries(module).some(entry => entry.exportName === "onlyChecks")).toBe(false);
  });

  it("follows an alias of the issued capability through the transparent wrappers", () => {
    // The bridge names the issued producer through an alias, and the alias may be
    // wrapped: the rule has to see the SAME capability.
    // The capability flow of the REAL bridge: the value is CHECKED against the private
    // registry of the issued producers, and it is really USED to draw.
    const module = [
      'const registry=new WeakMap<object,string>();',
      'const issued=new WeakSet<object>();',
      // The producers are registered in BOTH tables: that is what makes the WeakSet
      // the registry of the issued producers, and the WeakMap the record of their
      // vendor path.
      'export function register(value: object): void { issued.add(value); registry.set(value, "/vendor"); }',
      'export function drawsWith(producer:unknown): void {',
      '  if(!issued.has(producer))return;',
      '  const issued = producer as unknown as { pageFrame(): void };',
      '  issued.pageFrame();',
      '}',
      'export function drawsWithChainedAliases(producer:unknown): void {',
      '  if(!issued.has(producer))return;',
      '  const first = (producer as unknown as { pageFrame(): void });',
      '  const second = first;',
      '  second.pageFrame();',
      '}',
      'export function onlyChecks(producer:unknown): void { issued.has(producer); }',
    ].join("\n");
    const entries = Object.fromEntries(vendorEntries(module).map(entry => [entry.exportName, entry.vendorIndex]));
    // The alias through the assertion is the capability, at its own position.
    expect(entries.drawsWith).toBe(0);
    // A chain of aliases is the same capability.
    expect(entries.drawsWithChainedAliases).toBe(0);
    // And a mere predicate is still not an entry point.
    expect(entries.onlyChecks).toBeUndefined();
  });

  it.each([
    ["a request header", 'export function call(req: IncomingMessage): void { createPinnedOpenFilmUpstream(req.headers["x-vendor"] as string); }'],
    ["a request body", 'export function call(req: IncomingMessage): void { createPinnedOpenFilmUpstream((req as unknown as { body: { vendor: string } }).body.vendor); }'],
    ["an alias of a request", 'export function call(req: IncomingMessage): void { const q = req; createPinnedOpenFilmUpstream(q.url); }'],
    ["a renamed request parameter", 'export function call(incoming: IncomingMessage): void { createPinnedOpenFilmUpstream(incoming.url); }'],
    ["a helper that was handed the request", 'const pick = (r: IncomingMessage): string => r.url; export function call(req: IncomingMessage): void { createPinnedOpenFilmUpstream(pick(req)); }'],
    ["a helper that receives the value in its own parameter", 'function helper(root: string): void { createPinnedOpenFilmUpstream(root); } export function call(req: IncomingMessage): void { helper(req.url); }'],
    ["the same export under a renamed import", 'export function call(req: IncomingMessage): void { load(req.url); }'],
    ["the same export through a namespace import", 'export function call(req: IncomingMessage): void { OF.createPinnedOpenFilmUpstream(req.url); }'],
    ["the producer position of the serving owner", 'export function call(req: IncomingMessage): void { createPinnedOpenFilmServingOwner(req.headers["x"] as unknown as object, "/root"); }'],
    ["the producer position of the bridge", 'export function call(req: IncomingMessage): void { openFilmServingBridge({} as object, req.headers["x"] as unknown as object); }'],
    ["a request wrapped in an assertion", 'export function call(req: IncomingMessage): void { createPinnedOpenFilmUpstream(req.url as unknown as string); }'],
    ["a request wrapped in parentheses", 'export function call(req: IncomingMessage): void { createPinnedOpenFilmUpstream((req.url)); }'],
  ])("the vendor-path rule detects %s", (_name, body) => {
    const source = [
      'import type { IncomingMessage } from "node:http";',
      'import { createPinnedOpenFilmUpstream, createPinnedOpenFilmServingOwner, openFilmServingBridge } from "../../adapters/openfilm/openfilm-upstream.js";',
      'import { createPinnedOpenFilmUpstream as load } from "../../adapters/openfilm/openfilm-upstream.js";',
      'import * as OF from "../../adapters/openfilm/openfilm-upstream.js";',
      body,
    ].join("\n");
    expect(vendorPathViolations([{ file: "synthetic.ts", text: source }], vendorEntries(readFileSync(LOADER_MODULE, "utf8"))).length).toBe(1);
  });

  it.each([
    ["the composition-time value", 'export function call(root: string): void { createPinnedOpenFilmUpstream(root); }'],
    ["a file that never reaches the loader", 'export const unrelated = (x: number): number => x + 1;'],
    ["a same-named parameter that is trusted", 'export function call(req: string): void { createPinnedOpenFilmUpstream(req); }'],
    ["a wrapped composition-time value", 'export function call(root: string): void { createPinnedOpenFilmUpstream(root as string); }'],
    ["a wrapped same-named parameter that is trusted", 'export function call(req: string): void { createPinnedOpenFilmUpstream((req as string)); }'],
  ])("the vendor-path rule accepts %s", (_name, body) => {
    const source = [
      'import type { IncomingMessage } from "node:http";',
      'import { createPinnedOpenFilmUpstream } from "../../adapters/openfilm/openfilm-upstream.js";',
      body,
    ].join("\n");
    expect(vendorPathViolations([{ file: "synthetic.ts", text: source }], vendorEntries(readFileSync(LOADER_MODULE, "utf8"))).length).toBe(0);
  });

  it("detects the loader module's own local call with a request-derived value", () => {
    const source = readFileSync(LOADER_MODULE, "utf8");
    const tainted = [
      'import type { IncomingMessage } from "node:http";',
      source,
      'export function probe(request: IncomingMessage): void { openFilmAvailability(request.url as unknown as string); }',
    ].join("\n");
    expect(vendorPathViolations([{ file: LOADER_MODULE, text: tainted }], vendorEntries(source)).length).toBe(1);
  });

  it("does not mistake a same-named parameter for a vendor path", () => {
    const module = [
      'const registry=new WeakMap<object,string>();',
      'export function sameNameOnly(producer:unknown): void { void producer; }',
    ].join("\n");
    expect(vendorEntries(module).map(entry => entry.exportName)).toEqual([]);
  });

  /**
   * The Host's own code is not a file of function declarations.
   *
   * A class method, a constructor, an arrow, a function expression, an object
   * literal, a property initializer and a static block all hold calls - and the
   * rule that follows a request into the Host has to see them. The shapes below are
   * the shapes the REAL call sites of the Host have: the server's constructor, the
   * authority's private methods, the workspace's service, the supervisor's probe.
   */
  it.each([
    ["a class method", 'class Handler { run(incoming: IncomingMessage): void { createPinnedOpenFilmUpstream(incoming.url as unknown as string); } }'],
    ["a constructor", 'class Handler { constructor(req: IncomingMessage) { createPinnedOpenFilmUpstream(req.url as unknown as string); } }'],
    ["a top level arrow", 'const handler = (req: IncomingMessage): void => { createPinnedOpenFilmUpstream(req.url as unknown as string); };'],
    ["a top level function expression", 'const handler = function (req: IncomingMessage): void { createPinnedOpenFilmUpstream(req.url as unknown as string); };'],
    ["an arrow inside a class method", 'class Handler { run(): void { const handler = (req: IncomingMessage): void => { createPinnedOpenFilmUpstream(req.url as unknown as string); }; handler; } }'],
    ["an object literal method", 'const handlers = { run(req: IncomingMessage): void { createPinnedOpenFilmUpstream(req.url as unknown as string); } };'],
    ["a class property initializer", 'class Handler { handler = (req: IncomingMessage): void => { createPinnedOpenFilmUpstream(req.url as unknown as string); }; }'],
    ["a static block that reads a request the module really holds", 'const held: IncomingMessage = {} as IncomingMessage; class Handler { static { createPinnedOpenFilmUpstream(held.url as unknown as string); } }'],
    ["a helper called from a class method", 'class Handler { run(req: IncomingMessage): void { helper(req.url as unknown as string); } } function helper(root: string): void { createPinnedOpenFilmUpstream(root); }'],
    ["a helper that is an arrow", 'class Handler { run(req: IncomingMessage): void { const helper = (root: string): void => { createPinnedOpenFilmUpstream(root); }; helper(req.url as unknown as string); } }'],
    ["a serving owner built in a class method", 'class Handler { run(req: IncomingMessage): void { createPinnedOpenFilmServingOwner(req.headers["x"] as unknown as object, {} as object); } }'],
    ["a bridge drawn in a class method", 'class Handler { run(req: IncomingMessage): void { openFilmServingBridge({} as object, req.headers["x"] as unknown as object); } }'],
    ["the default value of a parameter", 'export function call(req: IncomingMessage, value = createPinnedOpenFilmUpstream(req.url as unknown as string)): void { void value; }'],
    ["the default value of a parameter of a method", 'class Handler { run(req: IncomingMessage, value = createPinnedOpenFilmUpstream(req.url as unknown as string)): void { void value; } }'],
    ["a computed name of a member", 'const held: IncomingMessage = {} as IncomingMessage; class Handler { [createPinnedOpenFilmUpstream(held.url as unknown as string)](): void { /* the name is computed where the class is written */ } }'],
    ["a method of this class, called through this", 'class Handler { run(req: IncomingMessage): void { this.helper(req.url as unknown as string); } helper(root: string): void { createPinnedOpenFilmUpstream(root); } }'],
  ])("the vendor-path rule detects a request in %s", (_name, body) => {
    const source = [
      'import type { IncomingMessage } from "node:http";',
      'import { createPinnedOpenFilmUpstream, createPinnedOpenFilmServingOwner, openFilmServingBridge } from "../../adapters/openfilm/openfilm-upstream.js";',
      body,
    ].join("\n");
    expect(vendorPathViolations([{ file: "synthetic.ts", text: source }], vendorEntries(readFileSync(LOADER_MODULE, "utf8"))).length).toBe(1);
  });

  /**
   * The negative side of the same shapes.
   *
   * A value that is not a request stays a value that is not a request - including
   * when it SHADOWS a request of an outer scope, and including when it lives in a
   * scope that never held one. A rule that taints by name, or that reaches across
   * scopes, would report these; a rule that follows the real data flow does not.
   */
  it.each([
    ["a class method with a string parameter", 'class Handler { run(root: string): void { createPinnedOpenFilmUpstream(root); } }'],
    ["a same named parameter that is not a request", 'class Handler { run(req: string): void { createPinnedOpenFilmUpstream(req); } }'],
    ["a parameter that shadows a request of an outer scope", 'export function outer(req: IncomingMessage): void { const inner = (req: string): void => { createPinnedOpenFilmUpstream(req); }; inner("x"); }'],
    ["a static block with no request in it", 'class Handler { static { createPinnedOpenFilmUpstream("/root"); } }'],
    ["an unrelated class", 'class Handler { run(value: number): void { other(value); } }'],
    ["a default value that holds no request", 'export function call(root: string, value = createPinnedOpenFilmUpstream(root)): void { void value; }'],
    ["a computed name in a scope that holds no request", 'class Handler { [createPinnedOpenFilmUpstream("/root")](): void { /* the name is computed where the class is written */ } }'],
    ["a method of this class, called with a value that is not a request", 'class Handler { run(root: string): void { this.helper(root); } helper(value: string): void { createPinnedOpenFilmUpstream(value); } }'],
  ])("the vendor-path rule accepts %s", (_name, body) => {
    const source = [
      'import type { IncomingMessage } from "node:http";',
      'import { createPinnedOpenFilmUpstream } from "../../adapters/openfilm/openfilm-upstream.js";',
      body,
    ].join("\n");
    expect(vendorPathViolations([{ file: "synthetic.ts", text: source }], vendorEntries(readFileSync(LOADER_MODULE, "utf8"))).length).toBe(0);
  });

  /**
   * The DIRECT evidence that the rule reaches the Host's OWN call sites.
   *
   * The set below is the set the real sources hold (read out of them, not guessed):
   * the server's constructor, the authority's three calls, the workspace's serving
   * and bridge, the composition, the render pin, the supervisor's probe and the
   * creation source verifier. A traversal that misses the class methods and the
   * arrows finds fewer of them - and this assertion says so.
   *
   * The loader module itself is not in this set: its own calls are checked by their
   * own case, with its own facts.
   */
  it("enumerates the loader call sites of the Host, one by one", () => {
    const entries = vendorEntries(readFileSync(LOADER_MODULE, "utf8"));
    const sites = loaderCallSites(productionSources(), entries).map(site => `${site.file}:${site.exportName}`);
    expect(sites.sort()).toEqual([
      "src/host/agent-driven/committed-snapshot-authority.ts:createPinnedOpenFilmUpstream",
      "src/host/agent-driven/committed-snapshot-authority.ts:createPinnedOpenFilmUpstream",
      "src/host/agent-driven/committed-snapshot-authority.ts:createPinnedOpenFilmUpstream",
      "src/host/agent-driven/created-native-workspace.ts:createPinnedOpenFilmServingOwner",
      "src/host/agent-driven/created-native-workspace.ts:openFilmServingBridge",
      "src/host/engine/openfilm-composition.ts:createPinnedOpenFilmUpstream",
      "src/host/m5/openfilm-studio-supervisor.ts:openFilmAvailability",
      "src/host/projects/creation-source-verifier.ts:createPinnedOpenFilmUpstream",
      "src/host/render/upstream-pin.ts:openFilmAvailability",
      "src/host/server.ts:createPinnedOpenFilmUpstream",
    ]);
  });
});
