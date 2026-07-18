export const urlEncodedFormMaximumBytes = 16 * 1024;
export const urlEncodedFormMaximumFields = 32;

export class UrlEncodedFormError extends TypeError {
  public readonly name = "UrlEncodedFormError";
}

export async function* serializeUrlEncodedForm(
  entity: Record<string, unknown> | Promise<Record<string, unknown>>,
): AsyncIterable<Uint8Array> {
  const parameters = new URLSearchParams();

  for (const [name, value] of Object.entries(await entity)) {
    if (value === undefined) {
      continue;
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean" &&
      typeof value !== "bigint"
    ) {
      throw new UrlEncodedFormError("URL-encoded form values must be scalar");
    }
    parameters.append(name, value === null ? "" : String(value));
  }

  const encoded = new TextEncoder().encode(parameters.toString());
  if (encoded.byteLength > urlEncodedFormMaximumBytes) {
    throw new UrlEncodedFormError("URL-encoded form exceeds the maximum size");
  }
  yield encoded;
}

export async function deserializeUrlEncodedForm(
  stream: (signal?: AbortSignal) => AsyncIterable<Uint8Array>,
): Promise<Record<string, string>> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let encoded = "";

  for await (const chunk of stream()) {
    byteLength += chunk.byteLength;
    if (byteLength > urlEncodedFormMaximumBytes) {
      throw new UrlEncodedFormError("URL-encoded form exceeds the maximum size");
    }
    try {
      encoded += decoder.decode(chunk, { stream: true });
    } catch {
      throw new UrlEncodedFormError("URL-encoded form is not valid UTF-8");
    }
  }
  try {
    encoded += decoder.decode();
  } catch {
    throw new UrlEncodedFormError("URL-encoded form is not valid UTF-8");
  }

  const result = Object.create(null) as Record<string, string>;
  let fieldCount = 0;
  for (const field of encoded.split("&")) {
    if (field === "") {
      continue;
    }
    fieldCount++;
    if (fieldCount > urlEncodedFormMaximumFields) {
      throw new UrlEncodedFormError("URL-encoded form has too many fields");
    }

    const assignmentIndex = field.indexOf("=");
    const encodedName = assignmentIndex < 0 ? field : field.slice(0, assignmentIndex);
    const encodedValue = assignmentIndex < 0 ? "" : field.slice(assignmentIndex + 1);
    const name = decodeFormComponent(encodedName);
    const value = decodeFormComponent(encodedValue);

    if (Object.hasOwn(result, name)) {
      throw new UrlEncodedFormError("URL-encoded form contains a duplicate field");
    }
    result[name] = value;
  }

  return result;
}

function decodeFormComponent(value: string): string {
  if (/%(?![0-9A-Fa-f]{2})/.test(value)) {
    throw new UrlEncodedFormError("URL-encoded form contains invalid percent encoding");
  }
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    throw new UrlEncodedFormError("URL-encoded form contains invalid percent encoding");
  }
}
