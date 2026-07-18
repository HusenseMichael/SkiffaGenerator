import assert from "node:assert/strict";
import test from "node:test";
import {
  UrlEncodedFormError,
  deserializeUrlEncodedForm,
  serializeUrlEncodedForm,
  urlEncodedFormMaximumBytes,
  urlEncodedFormMaximumFields,
} from "./urlencoded.js";

test("round trips scalar fields with form percent and plus encoding", async () => {
  const body = await collect(
    serializeUrlEncodedForm({
      csrfToken: "a+b c/%",
      returnTo: "/spaces?name=\u732b",
      enabled: true,
      count: 2,
      omitted: undefined,
    }),
  );

  assert.equal(
    new TextDecoder().decode(body),
    // cspell:disable-next-line
    "csrfToken=a%2Bb+c%2F%25&returnTo=%2Fspaces%3Fname%3D%E7%8C%AB&enabled=true&count=2",
  );
  const result = await deserializeUrlEncodedForm(asStream(body));
  assert.equal(Object.getPrototypeOf(result), null);
  assert.deepEqual(
    { ...result },
    {
      csrfToken: "a+b c/%",
      returnTo: "/spaces?name=\u732b",
      enabled: "true",
      count: "2",
    },
  );
});

test("rejects duplicate singleton fields", async () => {
  await assert.rejects(
    deserializeUrlEncodedForm(asStream("csrfToken=first&csrfToken=second")),
    UrlEncodedFormError,
  );
});

test("rejects malformed percent encoding and encoded invalid UTF-8", async () => {
  await assert.rejects(deserializeUrlEncodedForm(asStream("value=%")), UrlEncodedFormError);
  await assert.rejects(deserializeUrlEncodedForm(asStream("value=%C3%28")), UrlEncodedFormError);
});

test("rejects invalid UTF-8 transport bytes", async () => {
  await assert.rejects(
    deserializeUrlEncodedForm(asStream(new Uint8Array([0xc3, 0x28]))),
    UrlEncodedFormError,
  );
});

test("preserves transport failures", async () => {
  const transportError = new Error("transport failed");
  await assert.rejects(
    deserializeUrlEncodedForm(async function* () {
      throw transportError;
    }),
    (error) => error === transportError,
  );
});

test("rejects oversized and overpopulated forms", async () => {
  await assert.rejects(
    deserializeUrlEncodedForm(asStream(new Uint8Array(urlEncodedFormMaximumBytes + 1))),
    UrlEncodedFormError,
  );
  const fields = Array.from(
    { length: urlEncodedFormMaximumFields + 1 },
    (_, index) => `f${index}=v`,
  ).join("&");
  await assert.rejects(deserializeUrlEncodedForm(asStream(fields)), UrlEncodedFormError);
});

test("does not permit prototype pollution", async () => {
  const result = await deserializeUrlEncodedForm(
    asStream("__proto__=polluted&constructor=also-safe&csrfToken=valid"),
  );

  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(result.__proto__, "polluted");
  assert.equal(result.constructor, "also-safe");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("rejects non-scalar client values and oversized output", async () => {
  await assert.rejects(collect(serializeUrlEncodedForm({ field: ["value"] })), UrlEncodedFormError);
  await assert.rejects(
    collect(serializeUrlEncodedForm({ field: "x".repeat(urlEncodedFormMaximumBytes) })),
    UrlEncodedFormError,
  );
});

function asStream(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return async function* () {
    yield bytes;
  };
}

async function collect(iterable: AsyncIterable<Uint8Array>) {
  const chunks = new Array<Uint8Array>();
  let length = 0;
  for await (const chunk of iterable) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
