import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as lib from "@skiffa/lib";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "../../../../..");

test("generated URL-encoded client and server use a strict typed transport", async (context) => {
  const generatedRoot = path.join(projectRoot, "generated");
  mkdirSync(generatedRoot, { recursive: true });
  const packageDirectory = mkdtempSync(path.join(generatedRoot, "urlencoded-test-"));
  context.after(() => rmSync(packageDirectory, { recursive: true, force: true }));

  execFileSync(
    process.execPath,
    [
      path.join(projectRoot, "packages/npm/skiffa-generator/bundled/program.js"),
      "package",
      path.join(projectRoot, "fixtures/specifications/urlencoded.yaml"),
      "--package-directory",
      packageDirectory,
      "--package-name",
      "urlencoded-test",
      "--package-version",
      "0.0.0",
      "--request-types",
      "application/x-www-form-urlencoded",
    ],
    { cwd: projectRoot },
  );
  execFileSync(path.join(projectRoot, "node_modules/.bin/tsc"), ["--project", packageDirectory], {
    cwd: projectRoot,
  });
  const generatedServer = await import(
    pathToFileURL(path.join(packageDirectory, "transpiled/server.js")).href
  );
  const generatedClient = await import(
    pathToFileURL(path.join(packageDirectory, "transpiled/client.js")).href
  );
  const apiServer = new generatedServer.Server({
    validateIncomingEntity: true,
  });
  let handlerCalls = 0;
  let receivedEntity: unknown;
  apiServer.registerLogoutOperation(async (entity: unknown) => {
    handlerCalls++;
    receivedEntity = entity;
  });
  apiServer.registerMiddleware(lib.createErrorMiddleware());

  await using listener = await lib.listen(apiServer, {});
  const baseUrl = new URL(`http://localhost:${listener.port}`);
  const url = new URL("/logout", baseUrl);

  await generatedClient.logout(
    {
      csrfToken: "a+b c/%",
      returnTo: "/spaces?name=\u732b",
    },
    { baseUrl },
  );
  assert.equal(handlerCalls, 1);
  assert.equal(Object.getPrototypeOf(receivedEntity), null);
  const receivedForm = receivedEntity as Record<string, string>;
  assert.equal(receivedForm.csrfToken, "a+b c/%");
  assert.equal(receivedForm.returnTo, "/spaces?name=\u732b");

  const prototypeResponse = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "csrfToken=value&__proto__=safe",
  });
  assert.equal(prototypeResponse.status, 204);
  assert.equal(handlerCalls, 2);
  assert.equal(Object.getPrototypeOf(receivedEntity), null);
  const prototypeForm = receivedEntity as Record<string, string>;
  assert.equal(prototypeForm.__proto__, "safe");
  assert.equal(Object.hasOwn(prototypeForm, "__proto__"), true);
  assert.equal(({} as Record<string, unknown>).safe, undefined);

  const duplicateResponse = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "csrfToken=first&csrfToken=second",
  });
  assert.equal(duplicateResponse.status, 400);
  assert.equal(handlerCalls, 2);

  const oversizedResponse = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `csrfToken=${"x".repeat(lib.urlEncodedFormMaximumBytes)}`,
  });
  assert.equal(oversizedResponse.status, 400);
  assert.equal(handlerCalls, 2);

  const wrongMediaTypeResponse = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: "csrfToken=value",
  });
  assert.equal(wrongMediaTypeResponse.status, 415);
  assert.equal(handlerCalls, 2);
});
